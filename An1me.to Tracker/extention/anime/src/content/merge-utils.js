/**
 * Anime Tracker - Content Script Merge Utilities
 *
 * Single source of truth for merge logic in the content-script context.
 * Loaded by the manifest before cloud-sync.js so both Chrome and Orion
 * paths share exactly the same conflict-resolution rules.
 *
 * NOTE: The popup context has its own copy at src/popup/merge-utils.js
 * (registered on window.AnimeTracker.MergeUtils) and the service worker
 * background.js has inline copies — all three implement identical logic.
 * When a build pipeline is available these should be unified into one file.
 *
 * Conflict-resolution rules (mirrors popup/merge-utils.js exactly)
 * ──────────────────────────────────────────────────────────────────
 * mergeVideoProgress
 *   both active     → higher currentTime wins; savedAt as tiebreaker
 *   local deleted   → kept if deletedAt > cloud savedAt
 *   cloud deleted   → kept unless local savedAt > cloud deletedAt
 *   both deleted    → cloud version kept (equivalent either way)
 *
 * mergeAnimeData
 *   Per slug: episodes union-merged by number; the more recently watched
 *   copy of each episode (watchedAt) is kept. Metadata taken from local.
 *
 * mergeDeletedAnime
 *   Union of both maps; newest deletedAt wins per slug.
 *   Entries older than 60 days are pruned.
 *
 * applyDeletedAnime
 *   Removes slugs from animeData whose deletedAt >= lastWatched.
 *   Mutates the passed-in object in-place.
 */

(function () {
    'use strict';

    // ─── mergeVideoProgress ──────────────────────────────────────────────────

    function mergeVideoProgress(local, cloud) {
        const merged = { ...(cloud || {}) };

        for (const [id, lp] of Object.entries(local || {})) {
            const cp = merged[id];
            if (!cp) { merged[id] = lp; continue; }

            const lDel = !!lp.deleted;
            const cDel = !!cp.deleted;

            if (lDel && !cDel) {
                if ((lp.deletedAt ? +new Date(lp.deletedAt) : 0) > (cp.savedAt ? +new Date(cp.savedAt) : 0))
                    merged[id] = lp;
            } else if (!lDel && cDel) {
                if ((lp.savedAt ? +new Date(lp.savedAt) : 0) > (cp.deletedAt ? +new Date(cp.deletedAt) : 0))
                    merged[id] = lp;
            } else if (!lDel && !cDel) {
                const lCT = lp.currentTime || 0;
                const cCT = cp.currentTime || 0;
                if (lCT > cCT) {
                    merged[id] = lp;
                } else if (lCT === cCT) {
                    const lSaved = lp.savedAt ? +new Date(lp.savedAt) : 0;
                    const cSaved = cp.savedAt ? +new Date(cp.savedAt) : 0;
                    if (lSaved > cSaved) merged[id] = lp;
                }
            }
            // both deleted → cloud wins by default
        }

        return merged;
    }

    // ─── mergeAnimeData ──────────────────────────────────────────────────────

    function mergeAnimeData(localData, cloudData) {
        const merged = { ...(cloudData || {}), ...(localData || {}) };

        for (const slug of Object.keys(merged)) {
            const c = cloudData?.[slug];
            const l = localData?.[slug];
            if (!c || !l) continue;

            const map = new Map();
            for (const ep of [
                ...(Array.isArray(c.episodes) ? c.episodes : []),
                ...(Array.isArray(l.episodes) ? l.episodes : [])
            ]) {
                if (!ep || typeof ep.number !== 'number' || isNaN(ep.number)) continue;
                const existing = map.get(ep.number);
                if (!existing) {
                    map.set(ep.number, ep);
                } else {
                    const existingTs = existing.watchedAt ? +new Date(existing.watchedAt) : 0;
                    const epTs       = ep.watchedAt      ? +new Date(ep.watchedAt)      : 0;
                    if (epTs > existingTs) map.set(ep.number, ep);
                }
            }

            merged[slug] = { ...l };
            merged[slug].episodes       = Array.from(map.values()).sort((a, b) => a.number - b.number);
            merged[slug].totalWatchTime = merged[slug].episodes.reduce((s, ep) => s + (ep.duration || 0), 0);
        }

        return merged;
    }

    // ─── mergeDeletedAnime ───────────────────────────────────────────────────

    function mergeDeletedAnime(local, cloud) {
        const merged = { ...(cloud || {}) };

        for (const [slug, info] of Object.entries(local || {})) {
            if (!merged[slug] || new Date(info.deletedAt) > new Date(merged[slug].deletedAt)) {
                merged[slug] = info;
            }
        }

        const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
        for (const [slug, info] of Object.entries(merged)) {
            if (new Date(info.deletedAt).getTime() < cutoff) delete merged[slug];
        }

        return merged;
    }

    // ─── applyDeletedAnime ───────────────────────────────────────────────────

    function applyDeletedAnime(animeData, deletedAnime) {
        for (const [slug, info] of Object.entries(deletedAnime || {})) {
            if (!animeData[slug]) continue;
            const deletedAt   = new Date(info.deletedAt).getTime();
            const lastWatched = animeData[slug].lastWatched
                ? new Date(animeData[slug].lastWatched).getTime() : 0;
            if (deletedAt >= lastWatched) delete animeData[slug];
        }
    }

    // ─── Register ────────────────────────────────────────────────────────────

    const ATC = (window.AnimeTrackerContent = window.AnimeTrackerContent || {});
    ATC.MergeUtils = { mergeVideoProgress, mergeAnimeData, mergeDeletedAnime, applyDeletedAnime };

})();
