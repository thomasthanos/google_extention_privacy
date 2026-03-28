/**
 * Anime Tracker - Shared Merge Utilities
 *
 * Single source of truth for local <-> cloud merge logic.
 * Loaded in popup, content scripts, and background service worker.
 */

(function () {
    'use strict';

    // ─── videoProgress merge ──────────────────────────────────────────────────
    // Primary conflict resolver: currentTime (clock-independent).
    // Timestamps used only as tiebreaker or for tombstone ordering.
    // TOMBSTONE_GRACE_MS ensures a tombstone must be meaningfully later than
    // the live entry's savedAt before it wins, guarding against clock skew.

    const TOMBSTONE_GRACE_MS = 5000; // 5 s

    function mergeVideoProgress(local, cloud) {
        const merged = { ...(cloud || {}) };

        for (const [id, lp] of Object.entries(local || {})) {
            const cp = merged[id];
            if (!cp) {
                merged[id] = lp;
                continue;
            }

            const localDeleted = !!lp.deleted;
            const cloudDeleted = !!cp.deleted;

            if (localDeleted && !cloudDeleted) {
                const localDeletedAt = lp.deletedAt ? +new Date(lp.deletedAt) : 0;
                const cloudSavedAt   = cp.savedAt   ? +new Date(cp.savedAt)   : 0;
                if (localDeletedAt > cloudSavedAt + TOMBSTONE_GRACE_MS) {
                    merged[id] = lp;
                }
            } else if (!localDeleted && cloudDeleted) {
                const cloudDeletedAt = cp.deletedAt ? +new Date(cp.deletedAt) : 0;
                const localSavedAt   = lp.savedAt   ? +new Date(lp.savedAt)   : 0;
                if (localSavedAt > cloudDeletedAt + TOMBSTONE_GRACE_MS) {
                    merged[id] = lp;
                }
            } else if (!localDeleted && !cloudDeleted) {
                const localCurrentTime = lp.currentTime || 0;
                const cloudCurrentTime = cp.currentTime || 0;

                if (localCurrentTime > cloudCurrentTime) {
                    merged[id] = lp;
                } else if (localCurrentTime === cloudCurrentTime) {
                    const localSavedAt = lp.savedAt ? +new Date(lp.savedAt) : 0;
                    const cloudSavedAt = cp.savedAt ? +new Date(cp.savedAt) : 0;
                    if (localSavedAt > cloudSavedAt) {
                        merged[id] = lp;
                    }
                }
            }
        }

        return merged;
    }

    // ─── animeData merge ──────────────────────────────────────────────────────

    function mergeAnimeData(localData, cloudData) {
        const merged = { ...(cloudData || {}), ...(localData || {}) };

        for (const slug of Object.keys(merged)) {
            const cloudAnime = cloudData?.[slug];
            const localAnime = localData?.[slug];
            if (!cloudAnime || !localAnime) continue;

            const episodesByNumber = new Map();
            for (const episode of [
                ...(Array.isArray(cloudAnime.episodes) ? cloudAnime.episodes : []),
                ...(Array.isArray(localAnime.episodes) ? localAnime.episodes : [])
            ]) {
                if (!episode || typeof episode.number !== 'number' || isNaN(episode.number)) continue;

                const existing = episodesByNumber.get(episode.number);
                if (!existing) {
                    episodesByNumber.set(episode.number, episode);
                    continue;
                }

                const existingWatchedAt = existing.watchedAt ? +new Date(existing.watchedAt) : 0;
                const episodeWatchedAt  = episode.watchedAt  ? +new Date(episode.watchedAt)  : 0;

                if (episodeWatchedAt > existingWatchedAt) {
                    episodesByNumber.set(episode.number, episode);
                } else if (episodeWatchedAt === existingWatchedAt) {
                    const existingIsVideo  = existing.durationSource === 'video';
                    const episodeIsVideo   = episode.durationSource  === 'video';
                    const existingDuration = Number(existing.duration) || 0;
                    const episodeDuration  = Number(episode.duration)  || 0;

                    if ((episodeIsVideo && !existingIsVideo) ||
                        (episodeIsVideo === existingIsVideo && episodeDuration > existingDuration)) {
                        episodesByNumber.set(episode.number, episode);
                    }
                }
            }

            const mergedMetadata = { ...localAnime };
            if (!mergedMetadata.coverImage && cloudAnime.coverImage) {
                mergedMetadata.coverImage = cloudAnime.coverImage;
            }

            const localTotal = Number.isFinite(localAnime.totalEpisodes) && localAnime.totalEpisodes > 0
                ? localAnime.totalEpisodes : 0;
            const cloudTotal = Number.isFinite(cloudAnime.totalEpisodes) && cloudAnime.totalEpisodes > 0
                ? cloudAnime.totalEpisodes : 0;
            const bestTotal = Math.max(localTotal, cloudTotal);
            mergedMetadata.totalEpisodes = bestTotal > 0 ? bestTotal : null;

            mergedMetadata.episodes = Array.from(episodesByNumber.values()).sort((a, b) => a.number - b.number);
            mergedMetadata.totalWatchTime = mergedMetadata.episodes.reduce((sum, ep) => sum + (ep.duration || 0), 0);
            merged[slug] = mergedMetadata;
        }

        return merged;
    }

    // ─── deletedAnime merge ───────────────────────────────────────────────────

    function mergeDeletedAnime(local, cloud) {
        const merged = { ...(cloud || {}) };

        for (const [slug, info] of Object.entries(local || {})) {
            if (!merged[slug] || new Date(info.deletedAt) > new Date(merged[slug].deletedAt)) {
                merged[slug] = info;
            }
        }

        const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
        for (const [slug, info] of Object.entries(merged)) {
            if (new Date(info.deletedAt).getTime() < cutoff) {
                delete merged[slug];
            }
        }

        return merged;
    }

    function applyDeletedAnime(animeData, deletedAnime) {
        for (const [slug, info] of Object.entries(deletedAnime || {})) {
            if (!animeData[slug]) continue;

            const deletedAt   = new Date(info.deletedAt).getTime();
            const lastWatched = animeData[slug].lastWatched
                ? new Date(animeData[slug].lastWatched).getTime()
                : 0;

            if (deletedAt >= lastWatched) {
                delete animeData[slug];
            }
        }
        return animeData;
    }

    // ─── groupCoverImages merge ───────────────────────────────────────────────
    // Entries are { url, coverSetAt } or plain strings (legacy, treated as coverSetAt = 0).
    // Newer coverSetAt wins; legacy strings always lose to timestamped entries.

    function getCoverUrl(entry) {
        if (!entry) return null;
        if (typeof entry === 'string') return entry;
        return entry.url || null;
    }

    function getCoverSetAt(entry) {
        if (!entry) return 0;
        if (typeof entry === 'string') return 0;
        return Number(entry.coverSetAt) || 0;
    }

    function mergeGroupCoverImages(local, cloud) {
        const localObj = local || {};
        const cloudObj = cloud || {};
        const result   = { ...cloudObj };

        for (const [slug, localEntry] of Object.entries(localObj)) {
            const cloudEntry = cloudObj[slug];
            const localSetAt = getCoverSetAt(localEntry);
            const cloudSetAt = getCoverSetAt(cloudEntry);

            if (!cloudEntry || localSetAt >= cloudSetAt) {
                result[slug] = localEntry;
            }
        }

        return result;
    }

    const root = typeof globalThis !== 'undefined' ? globalThis : self;
    root.AnimeTrackerMergeUtils = {
        mergeVideoProgress,
        mergeAnimeData,
        mergeDeletedAnime,
        applyDeletedAnime,
        mergeGroupCoverImages,
        getCoverUrl,
        getCoverSetAt
    };
})();
