


(function () {
    'use strict';

    const STATE_KEY = '_slugMigrationStateV1';


    const RUN_GAP_MS = 7 * 24 * 3600 * 1000;
    const PER_SLUG_COOLDOWN_MS = 24 * 3600 * 1000;
    const PROBE_TIMEOUT_MS = 8000;
    const PROBE_GAP_MS = 700;
    const SEARCH_PROBE_GAP_MS = 1500;
    const MAX_RENAMES_PER_RUN = 25;


    const SKIP_PATTERNS = [
        /-(?:movie|special|ova|ona|recap|pv|music|short)(?:-|$)/i,
        /-hen-movie$/i
    ];
    function isMovieOrSpecialSlug(slug) {
        for (const re of SKIP_PATTERNS) {
            if (re.test(slug)) return true;
        }
        return false;
    }
    function shouldSkipSlugForMigration(slug) {
        // No longer skip movie/ova/special slugs upfront; we check for compatibility when resolving.
        return false;
    }

    function fallbackSlugify(title) {


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
        try { console.log('[SlugMigration]', ...args); } catch {            }
    }
    function logWarn(...args) {
        try { console.warn('[SlugMigration]', ...args); } catch {            }
    }


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

            return res.ok;
        } catch {
            return false;
        } finally {
            clearTimeout(timer);
        }
    }


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

            const re = /\/anime\/([a-z0-9][a-z0-9-]*)\/?(?:["'?#])/gi;
            const seen = new Set();
            let m;
            while ((m = re.exec(html)) !== null) {
                const cand = m[1].toLowerCase();
                if (cand && !seen.has(cand)) {
                    seen.add(cand);

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


    function relocateSidecars(stores, from, to) {
        const { videoProgress, deletedAnime, groupCoverImages } = stores;


        const fromPrefix = `${from}__episode-`;
        for (const key of Object.keys(videoProgress)) {
            if (!key.startsWith(fromPrefix)) continue;
            const newKey = `${to}__episode-${key.slice(fromPrefix.length)}`;
            const incoming = videoProgress[key];
            const existing = videoProgress[newKey];
            if (!existing) {
                videoProgress[newKey] = incoming;
            } else {

                const aTs = new Date(existing.savedAt || 0).getTime() || 0;
                const bTs = new Date(incoming.savedAt || 0).getTime() || 0;
                videoProgress[newKey] = bTs > aTs ? incoming : existing;
            }
            delete videoProgress[key];
        }


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


        if (groupCoverImages[from]) {
            if (!groupCoverImages[to]) groupCoverImages[to] = groupCoverImages[from];
            delete groupCoverImages[from];
        }
    }


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


            movedEntry.listStateUpdatedAt = movedEntry.listStateUpdatedAt
                || movedEntry.lastWatched
                || new Date().toISOString();

            if (animeData[to]) {


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


    function buildCandidatesForEntry(slug, entry) {
        const out = [];
        const seen = new Set([slug]);
        const slugify = getSlugify();
        const add = (cand) => {
            if (!cand || seen.has(cand)) return;
            seen.add(cand);
            out.push(cand);
        };


        add(slugify(entry.title));


        add(slugify(entry.romajiTitle));
        add(slugify(entry.englishTitle));
        add(slugify(entry.nativeTitle));


        const stripped = slug.replace(/-(?:ntr|tv|ova|sub|dub)$/i, '');
        if (stripped && stripped !== slug) add(stripped);

        return out;
    }


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


        const cacheKeys = slugs.map((s) => `animeinfo_${s}`);
        const caches = cacheKeys.length > 0 ? await sget(cacheKeys) : {};


        const suspects = [];
        for (const slug of slugs) {
            const cache = caches[`animeinfo_${slug}`];
            if (!cache || !cache.notFound) continue;
            const triedAt = (state.perSlug[slug] && state.perSlug[slug].triedAt) || 0;
            if (!force && (Date.now() - triedAt < PER_SLUG_COOLDOWN_MS)) continue;


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

                if (await probeSlug(cand)) {
                    resolved = cand;
                    break;
                }
                await sleep(PROBE_GAP_MS);
            }


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


            state.perSlug[slug] = { triedAt: Date.now(), resolved: resolved || null };

            if (resolved) {
                const sourceIsMovie = isMovieOrSpecialSlug(slug);
                const targetIsMovie = isMovieOrSpecialSlug(resolved);
                if (sourceIsMovie === targetIsMovie) {
                    renames.push({ from: slug, to: resolved });
                    logInfo(`Found target for "${slug}" → "${resolved}"`);
                } else {
                    logWarn(`Skipping incompatible rename for "${slug}" → "${resolved}" (movie/series type mismatch)`);
                }
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
