/**
 * Anime Tracker — AniList shared core
 *
 * GraphQL client + push engine, loadable by BOTH the background service
 * worker (importScripts) and the popup (<script>). No DOM, no chrome.identity
 * — only `fetch` + `chrome.storage`, which exist in both contexts.
 *
 * Exposed on globalThis.AniListCore.
 */
(function () {
    'use strict';

    const GQL_ENDPOINT = 'https://graphql.anilist.co';
    const REQUEST_GAP_MS = 1800;                        // pace API calls — AniList rate-limits hard
    const MEDIA_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
    const MEDIA_NOTFOUND_TTL = 7 * 24 * 60 * 60 * 1000;

    const AUTH_KEY = 'anilist_auth';
    const MEDIA_MAP_KEY = 'anilist_media_map';
    const PUSHED_KEY = 'anilist_pushed';
    const SCHEMA_KEY = 'anilist_push_schema';
    const PUSH_SCHEMA = 2;       // bump to force a one-time re-push (mutation shape changed)

    function sget(keys) {
        return new Promise((res) => {
            try { chrome.storage.local.get(keys, (r) => res(chrome.runtime.lastError ? {} : (r || {}))); }
            catch { res({}); }
        });
    }
    function sset(obj) {
        return new Promise((res) => {
            try { chrome.storage.local.set(obj, () => { void chrome.runtime.lastError; res(); }); }
            catch { res(); }
        });
    }
    function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

    function slugify(title) {
        return String(title || '').toLowerCase().trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    // ── GraphQL ──────────────────────────────────────────────────────────
    let _lastReqAt = 0;
    async function paced() {
        const wait = REQUEST_GAP_MS - (Date.now() - _lastReqAt);
        if (wait > 0) await sleep(wait);
        _lastReqAt = Date.now();
    }

    async function gql(query, variables, token) {
        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;

        for (let attempt = 0; attempt < 2; attempt++) {
            await paced();
            let res;
            try {
                res = await fetch(GQL_ENDPOINT, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ query, variables: variables || {} })
                });
            } catch (e) {
                throw new Error(`network: ${e?.message || e}`);
            }

            if (res.status === 429) {
                const ra = parseInt(res.headers.get('Retry-After') || '', 10);
                const waitMs = (Number.isFinite(ra) && ra > 0 ? ra : 60) * 1000;
                if (attempt === 0) { await sleep(Math.min(waitMs, 65000)); continue; }
                throw new Error('rate_limited');
            }

            const json = await res.json().catch(() => null);
            if (json && Array.isArray(json.errors) && json.errors.length) {
                throw new Error(json.errors[0]?.message || 'graphql_error');
            }
            if (!res.ok || !json) throw new Error(`http_${res.status}`);
            return json.data;
        }
        throw new Error('rate_limited');
    }

    // ── Library → AniList mapping helpers ────────────────────────────────
    function localProgress(entry) {
        const eps = Array.isArray(entry?.episodes) ? entry.episodes : [];
        let max = 0;
        for (const ep of eps) {
            const n = Number(ep && ep.number) || 0;
            if (n > max) max = n;
        }
        return max;
    }

    function pushStatus(entry, progress) {
        if (entry.listState === 'completed' || entry.completedAt) return 'COMPLETED';
        if (entry.listState === 'dropped' || entry.droppedAt) return 'DROPPED';
        if (entry.listState === 'on_hold' || entry.onHoldAt) return 'PAUSED';
        const total = Number(entry.totalEpisodes) || 0;
        if (total > 0 && progress >= total) return 'COMPLETED';
        return 'CURRENT';
    }

    // FuzzyDate (AniList's {year,month,day}) from an episode's ISO watchedAt.
    function isoToFuzzyDate(iso) {
        if (!iso) return null;
        const d = new Date(iso);
        if (!Number.isFinite(d.getTime())) return null;
        return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
    }

    // Real watch dates for an entry: startedAt = first episode watched,
    // completedAt = last (only when finished). Imported episodes
    // (durationSource 'anilist') carry the import time, not a real watch
    // date, so they are excluded — their AniList dates must stay untouched.
    function watchDates(entry, status) {
        const eps = Array.isArray(entry && entry.episodes) ? entry.episodes : [];
        let minIso = null, maxIso = null, minTs = Infinity, maxTs = -Infinity;
        for (const ep of eps) {
            if (!ep || ep.durationSource === 'anilist') continue;
            const ts = ep.watchedAt ? new Date(ep.watchedAt).getTime() : NaN;
            if (!Number.isFinite(ts)) continue;
            if (ts < minTs) { minTs = ts; minIso = ep.watchedAt; }
            if (ts > maxTs) { maxTs = ts; maxIso = ep.watchedAt; }
        }
        // If no real episode dates exist for a completed entry, fall back to
        // entry.completedAt — but only when the entry has at least one
        // non-anilist episode (i.e. the user actually watched something here)
        // or a manual marker (listStateUpdatedAt without any anilist episodes).
        // For pure AniList-import entries we leave completedAt null so we
        // never clobber the date AniList already holds.
        const hasRealEpisode = eps.some(ep => ep && ep.durationSource !== 'anilist');
        const completedIso = status === 'COMPLETED'
            ? (maxIso || (hasRealEpisode && entry && entry.completedAt) || null)
            : null;
        return {
            startedAt: isoToFuzzyDate(minIso),
            completedAt: isoToFuzzyDate(completedIso)
        };
    }

    async function resolveMedia(slug, title) {
        const store = await sget([MEDIA_MAP_KEY]);
        const map = store[MEDIA_MAP_KEY] || {};
        const now = Date.now();
        const cached = map[slug];

        if (cached) {
            if (cached.notFound && (now - (cached.cachedAt || 0)) < MEDIA_NOTFOUND_TTL) return null;
            if (!cached.notFound && cached.mediaId && (now - (cached.cachedAt || 0)) < MEDIA_CACHE_TTL) {
                return cached;
            }
        }

        let result = null;
        try {
            const data = await gql('query($s:String){Media(search:$s,type:ANIME){id episodes}}', { s: title }, null);
            const m = data && data.Media;
            if (m && m.id) result = { mediaId: m.id, episodes: m.episodes || null, cachedAt: now };
        } catch (e) {
            const msg = String(e?.message || '');
            // Genuine "no match" → cache as notFound. Network / rate errors
            // must NOT be cached so a transient failure doesn't stick.
            if (/not found/i.test(msg) || msg === 'http_404') result = null;
            else throw e;
        }

        map[slug] = result || { notFound: true, cachedAt: now };
        await sset({ [MEDIA_MAP_KEY]: map });
        return result;
    }

    /**
     * Push local library progress to AniList.
     *
     * Batched + resumable: stops after `maxWork` real network pushes and
     * reports `truncated` so the caller (the SW) can re-schedule and finish
     * later — this keeps each run well under the MV3 service-worker lifetime.
     * Dedup via `anilist_pushed` makes everything after the first sync cheap.
     */
    async function runPush({ token, maxWork = 1e9, onProgress } = {}) {
        if (!token) throw new Error('not_connected');

        const store = await sget(['animeData', PUSHED_KEY, SCHEMA_KEY]);
        const animeData = store.animeData || {};
        let pushed = store[PUSHED_KEY] || {};
        // Mutation shape changed (now sends watch dates) — drop the dedup cache
        // once so every entry re-pushes with correct startedAt / completedAt.
        if (Number(store[SCHEMA_KEY]) !== PUSH_SCHEMA) {
            pushed = {};
            await sset({ [SCHEMA_KEY]: PUSH_SCHEMA });
        }
        const slugs = Object.keys(animeData);
        const total = slugs.length;

        let done = 0, ok = 0, skipped = 0, failed = 0, retryableFailed = 0, work = 0, truncated = false;

        for (const slug of slugs) {
            const entry = animeData[slug];
            const progress = localProgress(entry);

            if (progress <= 0) {
                done++; skipped++;
                if (onProgress) onProgress({ done, total, ok, skipped, failed });
                continue;
            }

            const status = pushStatus(entry, progress);
            const prev = pushed[slug];

            // Migration: a pre-existing pushed record (from before datesLocked
            // was introduced) for an entry that is now a pure AniList import
            // (every episode is durationSource 'anilist') should have its lock
            // backfilled — otherwise the dedupe below skips and we never get
            // a chance to write the lock.
            const eps = Array.isArray(entry.episodes) ? entry.episodes : [];
            const isPureAniListImport = eps.length > 0 && eps.every(ep => ep && ep.durationSource === 'anilist');
            if (prev && isPureAniListImport && prev.datesLocked == null) {
                prev.datesLocked = true;
                pushed[slug] = prev;
                await sset({ [PUSHED_KEY]: pushed });
            }

            // datesLocked: set on import preseed so we never overwrite AniList's
            // existing history with a "today" date from a newly-promoted episode.
            // The lock is cleared when the user watches beyond the imported count.
            const datesLocked = !!(prev && prev.datesLocked && progress <= (prev.progress || 0));
            const { startedAt, completedAt } = datesLocked ? { startedAt: null, completedAt: null } : watchDates(entry, status);
            const startedAtKey = startedAt ? `${startedAt.year}-${startedAt.month}-${startedAt.day}` : '';
            const completedAtKey = completedAt ? `${completedAt.year}-${completedAt.month}-${completedAt.day}` : '';

            if (prev &&
                prev.progress === progress &&
                prev.status === status &&
                (prev.startedAtKey || '') === startedAtKey &&
                (prev.completedAtKey || '') === completedAtKey) {
                done++; skipped++;
                if (onProgress) onProgress({ done, total, ok, skipped, failed });
                continue;
            }

            // This entry needs a real network push. Stop if the batch is full.
            if (work >= maxWork) { truncated = true; break; }
            work++;

            try {
                const media = await resolveMedia(slug, entry.title || slug);
                if (!media || !media.mediaId) {
                    failed++;
                } else {
                    const varDefs = ['$m:Int', '$p:Int', '$s:MediaListStatus'];
                    const args = ['mediaId:$m', 'progress:$p', 'status:$s'];
                    const vars = { m: media.mediaId, p: progress, s: status };
                    if (startedAt) {
                        varDefs.push('$sa:FuzzyDateInput'); args.push('startedAt:$sa'); vars.sa = startedAt;
                    }
                    if (completedAt) {
                        varDefs.push('$ca:FuzzyDateInput'); args.push('completedAt:$ca'); vars.ca = completedAt;
                    }
                    await gql(
                        `mutation(${varDefs.join(',')}){SaveMediaListEntry(${args.join(',')}){id}}`,
                        vars,
                        token
                    );
                    pushed[slug] = { progress, status, startedAtKey, completedAtKey };
                    // If progress advanced beyond the locked import count, the
                    // lock is no longer needed — future pushes can send dates.
                    if (prev && prev.datesLocked && progress > (prev.progress || 0)) {
                        pushed[slug].datesLocked = false;
                    }
                    await sset({ [PUSHED_KEY]: pushed });
                    ok++;
                }
            } catch (e) {
                const msg = String(e?.message || '');
                if (/invalid token|unauthor/i.test(msg)) throw new Error('reconnect');
                if (msg === 'rate_limited') await sleep(60000);
                const isRetryable = msg === 'rate_limited' || msg.startsWith('network:') || msg.startsWith('http_5');
                if (isRetryable) retryableFailed++; else failed++;
            }

            done++;
            if (onProgress) onProgress({ done, total, ok, skipped, failed });
        }

        return { total, done, ok, skipped, failed, retryableFailed, work, truncated };
    }

    const root = typeof globalThis !== 'undefined' ? globalThis : self;
    root.AniListCore = {
        gql, slugify, localProgress, pushStatus, resolveMedia, runPush,
        AUTH_KEY, MEDIA_MAP_KEY, PUSHED_KEY, SCHEMA_KEY, PUSH_SCHEMA
    };
})();
