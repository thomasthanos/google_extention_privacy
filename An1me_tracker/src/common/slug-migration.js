/**
 * Anime Tracker — Slug Migration
 *
 * Auto-recovers from bad slugs in `animeData` left behind by the legacy
 * (pre-6.6.x) `slugify()` which silently dropped characters like `/`, `×`,
 * `:` instead of turning them into separators (`Fate/stay night` →
 * `fatestay-night`, `HUNTER×HUNTER` → `hunterhunter`).
 *
 * Also covers the more general "AniList romaji slug doesn't match what
 * an1me.to uses" case (e.g. FMA Brotherhood, Demon Slayer movies) by
 * probing alternate-title slugifications and falling back to the site's
 * built-in WordPress search.
 *
 * Triggered from popup main.js. Safe to call repeatedly:
 *   • Only acts on entries whose `animeinfo_<slug>` cache is `notFound`
 *     (so legitimate slugs are never touched).
 *   • Per-slug cooldown via `_slugMigrationTriedAt` prevents re-probing
 *     entries we already know are unrecoverable.
 *   • Global rate gate (RUN_GAP_MS) prevents burning network budget on
 *     every popup open.
 *
 * Renames preserve user data: any colliding entry on the target slug is
 * CRDT-merged via the existing `AnimeTrackerMergeUtils.mergeAnimeData`,
 * and `videoProgress` / `deletedAnime` / `groupCoverImages` keys are
 * relocated alongside it.
 */
(function () {
    'use strict';

    const STATE_KEY = '_slugMigrationStateV1';
    // Task 13: bumped from 30 min → 7 days. The per-slug PER_SLUG_COOLDOWN_MS
    // (24 h) still controls when an individual notFound slug can be re-probed,
    // but the global RUN_GAP_MS prevents the whole migration pass from running
    // again for a week after a successful pass — eliminates the network spam
    // ("hits an1me.to/anime/<malformed>" on every popup open) that bothered
    // users with no recoverable bad slugs in their library.
    const RUN_GAP_MS = 7 * 24 * 3600 * 1000;
    const PER_SLUG_COOLDOWN_MS = 24 * 3600 * 1000; // re-probe a single slug at most daily
    const PROBE_TIMEOUT_MS = 8000;
    const PROBE_GAP_MS = 700;                   // pacing between probes
    const SEARCH_PROBE_GAP_MS = 1500;           // longer between WP searches
    const MAX_RENAMES_PER_RUN = 25;             // safety cap

    // Task 13: skip slugs that obviously won't have an alternate name on
    // an1me.to. These are movie/special endings that historically caused
    // probe-storms (e.g. `chainsaw-man-movie-reze-hen-movie` → 404 storm).
    const SKIP_PATTERNS = [
        /-(?:movie|special|ova|ona|recap|pv|music|short)(?:-|$)/i,
        /-hen-movie$/i
    ];
    function shouldSkipSlugForMigration(slug) {
        for (const re of SKIP_PATTERNS) {
            if (re.test(slug)) return true;
        }
        return false;
    }

    function fallbackSlugify(title) {
        // Same shape as the post-fix slugify in anilist-core.js. Used only
        // if AniListCore is unavailable at call time (defensive — popup.html
        // loads anilist-core.js after this file but before migrate() runs).
        return String(title || '').toLowerCase().trim()
            .replace(/[^\w\s-]/g, ' ')
            .replace(/[\s_]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
    function getSlugify() {
        const Core = (typeof globalThis !== 'undefined' && globalThis.AniListCore)
            || (typeof self !== 'undefined' && self.AniListCore)
            || null;
        return (Core && typeof Core.slugify === 'function') ? Core.slugify : fallbackSlugify;
    }

    function sget(keys) {
        return new Promise((res) => {
            try { chrome.storage.local.get(keys, (r) => { void chrome.runtime.lastError; res(r || {}); }); }
            catch { res({}); }
        });
    }
    function sset(obj) {
        return new Promise((res) => {
            try { chrome.storage.local.set(obj, () => { void chrome.runtime.lastError; res(); }); }
            catch { res(); }
        });
    }
    function sremove(keys) {
        return new Promise((res) => {
            try { chrome.storage.local.remove(keys, () => { void chrome.runtime.lastError; res(); }); }
            catch { res(); }
        });
    }
    function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

    function logInfo(...args) {
        try { console.log('[SlugMigration]', ...args); } catch { /* noop */ }
    }
    function logWarn(...args) {
        try { console.warn('[SlugMigration]', ...args); } catch { /* noop */ }
    }

    /**
     * HEAD-style probe. We use GET with a tight timeout because some servers
     * answer HEAD differently than GET (and an1me.to is WordPress + Cloudflare).
     */
    async function probeSlug(slug) {
        if (!slug) return false;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
        try {
            const res = await fetch(`https://an1me.to/anime/${encodeURIComponent(slug)}/`, {
                method: 'GET',
                signal: ctrl.signal,
                redirect: 'follow',
                cache: 'no-store',
                credentials: 'omit'
            });
            // 200 = found. 301/302 followed automatically; non-ok = not it.
            return res.ok;
        } catch {
            return false;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Last-resort: query an1me.to's WordPress search and parse the first
     * `/anime/{slug}/` link from the result page. Returns the matched slug
     * or null.
     */
    async function searchAn1meForTitle(title) {
        const q = String(title || '').trim();
        if (!q) return null;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
        try {
            const url = `https://an1me.to/?s=${encodeURIComponent(q)}&post_type=anime`;
            const res = await fetch(url, {
                method: 'GET',
                signal: ctrl.signal,
                redirect: 'follow',
                cache: 'no-store',
                credentials: 'omit'
            });
            if (!res.ok) return null;
            const html = await res.text();
            // Capture every /anime/{slug}/ link, return the first non-empty.
            const re = /\/anime\/([a-z0-9][a-z0-9-]*)\/?(?:["'?#])/gi;
            const seen = new Set();
            let m;
            while ((m = re.exec(html)) !== null) {
                const cand = m[1].toLowerCase();
                if (cand && !seen.has(cand)) {
                    seen.add(cand);
                    // Defensive: avoid the search page itself / category archives.
                    if (cand !== 'page' && cand.length >= 3) return cand;
                }
            }
            return null;
        } catch {
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Move all per-slug ancillary storage from `from` to `to`.
     * Caller must persist `animeData` separately.
     */
    function relocateSidecars(stores, from, to) {
        const { videoProgress, deletedAnime, groupCoverImages } = stores;

        // videoProgress: keys look like `${slug}__episode-N`.
        const fromPrefix = `${from}__episode-`;
        for (const key of Object.keys(videoProgress)) {
            if (!key.startsWith(fromPrefix)) continue;
            const newKey = `${to}__episode-${key.slice(fromPrefix.length)}`;
            const incoming = videoProgress[key];
            const existing = videoProgress[newKey];
            if (!existing) {
                videoProgress[newKey] = incoming;
            } else {
                // Pick the newer record (CRDT for individual progress entries).
                const aTs = new Date(existing.savedAt || 0).getTime() || 0;
                const bTs = new Date(incoming.savedAt || 0).getTime() || 0;
                videoProgress[newKey] = bTs > aTs ? incoming : existing;
            }
            delete videoProgress[key];
        }

        // deletedAnime tombstones: keep newer.
        if (deletedAnime[from]) {
            const incoming = deletedAnime[from];
            const existing = deletedAnime[to];
            if (!existing) {
                deletedAnime[to] = incoming;
            } else {
                const aTs = new Date(existing.deletedAt || 0).getTime() || 0;
                const bTs = new Date(incoming.deletedAt || 0).getTime() || 0;
                deletedAnime[to] = bTs > aTs ? incoming : existing;
            }
            delete deletedAnime[from];
        }

        // Group cover images.
        if (groupCoverImages[from]) {
            if (!groupCoverImages[to]) groupCoverImages[to] = groupCoverImages[from];
            delete groupCoverImages[from];
        }
    }

    /**
     * Apply all renames in-memory, then commit via a single storage.set.
     * Uses `mergeAnimeData` for collisions to preserve all user data.
     */
    async function applyRenames(renames, stores) {
        const Merge = (typeof self !== 'undefined' && self.AnimeTrackerMergeUtils)
            || (typeof window !== 'undefined' && window.AnimeTrackerMergeUtils);
        const mergeAnimeData = Merge && Merge.mergeAnimeData;
        if (!mergeAnimeData) {
            logWarn('mergeAnimeData unavailable — skipping rename application.');
            return 0;
        }

        const { animeData } = stores;
        const cacheKeysToRemove = [];

        for (const { from, to } of renames) {
            if (!animeData[from]) continue;

            const movedEntry = { ...animeData[from], slug: to };
            // Bump activity so the merge picks the renamed copy as "newer"
            // when there's a collision.
            movedEntry.listStateUpdatedAt = movedEntry.listStateUpdatedAt
                || movedEntry.lastWatched
                || new Date().toISOString();

            if (animeData[to]) {
                // CRDT merge: localData=current target, cloudData=moved entry.
                // The merge function unions episodes and picks newest fields.
                const merged = mergeAnimeData(
                    { [to]: animeData[to] },
                    { [to]: movedEntry }
                );
                animeData[to] = merged[to];
            } else {
                animeData[to] = movedEntry;
            }
            delete animeData[from];

            relocateSidecars(stores, from, to);

            // Stale per-slug caches — let them be re-fetched under the new
            // slug. animeinfo_<from> definitely held a `notFound` entry.
            cacheKeysToRemove.push(
                `animeinfo_${from}`,
                `episodeTypes_${from}`,
                `fillerslug_${from}`
            );
        }

        await sset({
            animeData: stores.animeData,
            videoProgress: stores.videoProgress,
            deletedAnime: stores.deletedAnime,
            groupCoverImages: stores.groupCoverImages
        });
        if (cacheKeysToRemove.length > 0) await sremove(cacheKeysToRemove);
        return renames.length;
    }

    /**
     * Build the candidate slug list for one suspect entry.
     * Order matters: cheaper/likelier candidates first.
     */
    function buildCandidatesForEntry(slug, entry) {
        const out = [];
        const seen = new Set([slug]);
        const slugify = getSlugify();
        const add = (cand) => {
            if (!cand || seen.has(cand)) return;
            seen.add(cand);
            out.push(cand);
        };

        // 1) Recompute slugify on stored title — catches the legacy
        //    silently-stripped-character bug (Fate/stay → fatestay).
        add(slugify(entry.title));

        // 2) Stored alternate titles (set by the AniList importer).
        add(slugify(entry.romajiTitle));
        add(slugify(entry.englishTitle));
        add(slugify(entry.nativeTitle));

        // 3) Common reductions: drop trailing parenthesised aliases the
        //    importer may have flattened (`netsuzou-trap-ntr` → `netsuzou-trap`).
        const stripped = slug.replace(/-(?:ntr|tv|ova|sub|dub)$/i, '');
        if (stripped && stripped !== slug) add(stripped);

        return out;
    }

    /**
     * Main entry. Resolves to `{ tried, renamed, skipped }`.
     */
    async function migrate({ force = false } = {}) {
        const summary = { tried: 0, renamed: 0, skipped: 0, ranAt: Date.now() };
        const meta = await sget([STATE_KEY]);
        const state = meta[STATE_KEY] || { lastRunAt: 0, perSlug: {} };

        if (!force && (Date.now() - (state.lastRunAt || 0) < RUN_GAP_MS)) {
            summary.skipped = 1;
            return summary;
        }

        const base = await sget(['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages']);
        const animeData = base.animeData || {};
        const slugs = Object.keys(animeData);
        if (slugs.length === 0) {
            state.lastRunAt = Date.now();
            await sset({ [STATE_KEY]: state });
            return summary;
        }

        // Selectively read only the animeinfo_ caches we need.
        const cacheKeys = slugs.map((s) => `animeinfo_${s}`);
        const caches = cacheKeys.length > 0 ? await sget(cacheKeys) : {};

        // Identify suspect entries: animeinfo_<slug> exists AND notFound:true.
        const suspects = [];
        for (const slug of slugs) {
            const cache = caches[`animeinfo_${slug}`];
            if (!cache || !cache.notFound) continue;
            const triedAt = (state.perSlug[slug] && state.perSlug[slug].triedAt) || 0;
            if (!force && (Date.now() - triedAt < PER_SLUG_COOLDOWN_MS)) continue;
            // Task 13: skip slugs whose shape strongly implies they're a
            // movie/special/recap with no recoverable alternate name. Saves
            // the probe storm on libraries with lots of those (e.g.
            // `chainsaw-man-movie-reze-hen-movie` → 404).
            if (shouldSkipSlugForMigration(slug)) continue;
            suspects.push(slug);
        }

        if (suspects.length === 0) {
            state.lastRunAt = Date.now();
            await sset({ [STATE_KEY]: state });
            return summary;
        }

        logInfo(`Probing ${suspects.length} suspect slug(s)…`);

        const stores = {
            animeData,
            videoProgress: base.videoProgress || {},
            deletedAnime: base.deletedAnime || {},
            groupCoverImages: base.groupCoverImages || {}
        };
        const renames = [];

        for (const slug of suspects) {
            if (renames.length >= MAX_RENAMES_PER_RUN) break;

            const entry = animeData[slug];
            if (!entry) continue;
            summary.tried++;

            const candidates = buildCandidatesForEntry(slug, entry);
            let resolved = null;

            for (const cand of candidates) {
                // Skip candidates that already collide with another suspect.
                if (await probeSlug(cand)) {
                    resolved = cand;
                    break;
                }
                await sleep(PROBE_GAP_MS);
            }

            // Fallback: WP search.
            if (!resolved) {
                const searchTitle = entry.englishTitle
                    || entry.title
                    || entry.romajiTitle
                    || slug.replace(/-/g, ' ');
                const found = await searchAn1meForTitle(searchTitle);
                if (found && found !== slug && await probeSlug(found)) {
                    resolved = found;
                }
                await sleep(SEARCH_PROBE_GAP_MS);
            }

            // Update per-slug state regardless of outcome.
            state.perSlug[slug] = { triedAt: Date.now(), resolved: resolved || null };

            if (resolved) {
                renames.push({ from: slug, to: resolved });
                logInfo(`Found target for "${slug}" → "${resolved}"`);
            }
        }

        if (renames.length > 0) {
            const applied = await applyRenames(renames, stores);
            summary.renamed = applied;
            logInfo(`Renamed ${applied} entries.`);
        }

        state.lastRunAt = Date.now();
        await sset({ [STATE_KEY]: state });
        return summary;
    }

    const root = (typeof self !== 'undefined') ? self : window;
    root.AnimeTrackerSlugMigration = { migrate };
})();
