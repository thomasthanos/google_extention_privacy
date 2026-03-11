/**
 * Anime Tracker - Merge Utilities
 *
 * Single source of truth for merging local ↔ cloud data.
 * Used by: firebase-sync.js, progress-manager.js
 *
 * NOTE: background.js and src/content/cloud-sync.js run in separate JS contexts
 * (service worker and content script respectively) and currently maintain their
 * own inline copies of these functions.  They should be migrated to import a
 * shared version when the build pipeline supports it.
 *
 * Conflict-resolution rules
 * ─────────────────────────
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
                // Local deleted, cloud active → keep deleted only if newer than last cloud save
                if ((lp.deletedAt ? +new Date(lp.deletedAt) : 0) > (cp.savedAt ? +new Date(cp.savedAt) : 0))
                    merged[id] = lp;

            } else if (!lDel && cDel) {
                // Cloud deleted, local active → keep local only if saved after cloud deletion
                if ((lp.savedAt ? +new Date(lp.savedAt) : 0) > (cp.deletedAt ? +new Date(cp.deletedAt) : 0))
                    merged[id] = lp;

            } else if (!lDel && !cDel) {
                // Both active → higher currentTime wins; savedAt as tiebreaker
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
            // both deleted → cloud wins by default (no change needed)
        }

        return merged;
    }

    // ─── mergeAnimeData ──────────────────────────────────────────────────────

    function mergeAnimeData(localData, cloudData) {
        // Local metadata wins (spread order: cloud first, local overwrites)
        const merged = { ...(cloudData || {}), ...(localData || {}) };

        for (const slug of Object.keys(merged)) {
            const c = cloudData?.[slug];
            const l = localData?.[slug];
            if (!c || !l) continue; // only in one source — already in merged

            // Union-merge episodes by number; keep the more recently watched copy
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

            merged[slug] = { ...l }; // local metadata wins
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

        // Purge entries older than 60 days (no longer needed for conflict detection)
        const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
        for (const [slug, info] of Object.entries(merged)) {
            if (new Date(info.deletedAt).getTime() < cutoff) {
                delete merged[slug];
            }
        }

        return merged;
    }

    // ─── applyDeletedAnime ─────────────────────────────────────────────────────
    //
    // Removes slugs from animeData that appear in deletedAnime with a
    // deletedAt timestamp >= the anime's own lastWatched timestamp.
    // Mutates animeData in-place and returns it for convenience.

    function applyDeletedAnime(animeData, deletedAnime) {
        for (const [slug, info] of Object.entries(deletedAnime || {})) {
            if (!animeData[slug]) continue;
            const deletedAt   = new Date(info.deletedAt).getTime();
            const lastWatched = animeData[slug].lastWatched
                ? new Date(animeData[slug].lastWatched).getTime() : 0;
            if (deletedAt >= lastWatched) {
                delete animeData[slug];
            }
        }
        return animeData;
    }

    // ─── Register ────────────────────────────────────────────────────────────

    const AT = (window.AnimeTracker = window.AnimeTracker || {});
    AT.MergeUtils = { mergeVideoProgress, mergeAnimeData, mergeDeletedAnime, applyDeletedAnime };

})();
