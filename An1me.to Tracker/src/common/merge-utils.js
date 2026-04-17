/**
 * Anime Tracker - Shared Merge Utilities
 *
 * Single source of truth for local <-> cloud merge logic.
 * Loaded in popup, content scripts, and background service worker.
 */

(function () {
    'use strict';

    function toMillis(value) {
        if (!value) return 0;
        const ts = new Date(value).getTime();
        return Number.isFinite(ts) ? ts : 0;
    }

    function pickLatestIso(a, b) {
        const aTs = toMillis(a);
        const bTs = toMillis(b);
        if (!aTs && !bTs) return null;
        return bTs > aTs ? b : a;
    }

    function getSafeString(value) {
        return typeof value === 'string' ? value : '';
    }

    function getSafeNumber(value) {
        return Number.isFinite(value) ? value : 0;
    }

    function getExplicitListState(anime) {
        const state = anime?.listState;
        return state === 'completed' || state === 'dropped' || state === 'active' || state === 'on_hold'
            ? state
            : null;
    }

    function getResolvedListState(anime) {
        const explicitState = getExplicitListState(anime);
        if (explicitState) return explicitState;
        const completedAt = toMillis(anime?.completedAt);
        const droppedAt = toMillis(anime?.droppedAt);
        const onHoldAt = toMillis(anime?.onHoldAt);
        const latestStateTs = Math.max(completedAt, droppedAt, onHoldAt);

        if (!latestStateTs) return 'active';
        if (onHoldAt === latestStateTs) return 'on_hold';
        return droppedAt === latestStateTs ? 'dropped' : 'completed';
    }

    function getAnimeActivityTimestamp(anime) {
        if (!anime || typeof anime !== 'object') return 0;

        let latest = Math.max(
            toMillis(anime.lastWatched),
            toMillis(anime.listStateUpdatedAt),
            toMillis(anime.titleUpdatedAt),
            toMillis(anime.completedAt),
            toMillis(anime.droppedAt),
            toMillis(anime.onHoldAt)
        );

        for (const episode of Array.isArray(anime.episodes) ? anime.episodes : []) {
            latest = Math.max(latest, toMillis(episode?.watchedAt));
        }

        return latest;
    }

    function getTitleSelection(localAnime, cloudAnime, slug) {
        const localTitle = getSafeString(localAnime?.title).trim();
        const cloudTitle = getSafeString(cloudAnime?.title).trim();
        const localTitleTs = toMillis(localAnime?.titleUpdatedAt);
        const cloudTitleTs = toMillis(cloudAnime?.titleUpdatedAt);

        let title = localTitle || cloudTitle || slug;
        let titleUpdatedAt = null;

        if (localTitleTs || cloudTitleTs) {
            if (cloudTitleTs > localTitleTs) {
                title = cloudTitle || localTitle || slug;
                titleUpdatedAt = cloudAnime?.titleUpdatedAt || null;
            } else {
                title = localTitle || cloudTitle || slug;
                titleUpdatedAt = localAnime?.titleUpdatedAt || null;
            }
        } else if (!localTitle && cloudTitle) {
            title = cloudTitle;
        }

        return { title, titleUpdatedAt };
    }

    function applyMergedListState(target, localAnime, cloudAnime) {
        const localListTs = toMillis(localAnime?.listStateUpdatedAt);
        const cloudListTs = toMillis(cloudAnime?.listStateUpdatedAt);

        delete target.completedAt;
        delete target.droppedAt;
        delete target.onHoldAt;
        delete target.listState;
        delete target.listStateUpdatedAt;

        if (localListTs || cloudListTs) {
            const sourceAnime = cloudListTs > localListTs ? cloudAnime : localAnime;
            const state = getResolvedListState(sourceAnime);
            const updatedAt = sourceAnime?.listStateUpdatedAt || pickLatestIso(localAnime?.listStateUpdatedAt, cloudAnime?.listStateUpdatedAt);

            if (state === 'completed') {
                target.completedAt = sourceAnime?.completedAt || pickLatestIso(localAnime?.completedAt, cloudAnime?.completedAt);
            } else if (state === 'dropped') {
                target.droppedAt = sourceAnime?.droppedAt || pickLatestIso(localAnime?.droppedAt, cloudAnime?.droppedAt);
            } else if (state === 'on_hold') {
                target.onHoldAt = sourceAnime?.onHoldAt
                    || pickLatestIso(localAnime?.onHoldAt, cloudAnime?.onHoldAt)
                    || updatedAt
                    || null;
            }

            target.listState = state;
            if (updatedAt) target.listStateUpdatedAt = updatedAt;
            return;
        }

        const completedAt = pickLatestIso(localAnime?.completedAt, cloudAnime?.completedAt);
        const droppedAt = pickLatestIso(localAnime?.droppedAt, cloudAnime?.droppedAt);
        const onHoldAt = pickLatestIso(localAnime?.onHoldAt, cloudAnime?.onHoldAt);
        const completedTs = toMillis(completedAt);
        const droppedTs = toMillis(droppedAt);
        const onHoldTs = toMillis(onHoldAt);

        if (!completedTs && !droppedTs && !onHoldTs) return;
        if (onHoldTs >= droppedTs && onHoldTs >= completedTs) {
            target.onHoldAt = onHoldAt;
            target.listState = 'on_hold';
            if (onHoldAt) target.listStateUpdatedAt = onHoldAt;
            return;
        }
        if (droppedTs > completedTs) {
            target.droppedAt = droppedAt;
            target.listState = 'dropped';
            if (droppedAt) target.listStateUpdatedAt = droppedAt;
            return;
        }
        target.completedAt = completedAt;
        target.listState = 'completed';
        if (completedAt) target.listStateUpdatedAt = completedAt;
    }

    function areEpisodesEqual(aEpisodes, bEpisodes) {
        const left = Array.isArray(aEpisodes) ? aEpisodes : [];
        const right = Array.isArray(bEpisodes) ? bEpisodes : [];
        if (left.length !== right.length) return false;

        for (let i = 0; i < left.length; i++) {
            const a = left[i] || {};
            const b = right[i] || {};
            if (getSafeNumber(Number(a.number)) !== getSafeNumber(Number(b.number))) return false;
            if (getSafeString(a.watchedAt) !== getSafeString(b.watchedAt)) return false;
            if (getSafeNumber(Number(a.duration)) !== getSafeNumber(Number(b.duration))) return false;
            if (getSafeString(a.durationSource) !== getSafeString(b.durationSource)) return false;
        }

        return true;
    }

    function areAnimeEntriesEqual(aAnime, bAnime) {
        const a = aAnime || {};
        const b = bAnime || {};

        if (getSafeString(a.title) !== getSafeString(b.title)) return false;
        if (getSafeString(a.titleUpdatedAt) !== getSafeString(b.titleUpdatedAt)) return false;
        if (getSafeString(a.coverImage) !== getSafeString(b.coverImage)) return false;
        if (getSafeString(a.lastWatched) !== getSafeString(b.lastWatched)) return false;
        if (getSafeString(a.completedAt) !== getSafeString(b.completedAt)) return false;
        if (getSafeString(a.droppedAt) !== getSafeString(b.droppedAt)) return false;
        if (getSafeString(a.onHoldAt) !== getSafeString(b.onHoldAt)) return false;
        if (getSafeString(a.listState) !== getSafeString(b.listState)) return false;
        if (getSafeString(a.listStateUpdatedAt) !== getSafeString(b.listStateUpdatedAt)) return false;
        if (getSafeNumber(Number(a.totalEpisodes)) !== getSafeNumber(Number(b.totalEpisodes))) return false;
        if (getSafeNumber(Number(a.totalWatchTime)) !== getSafeNumber(Number(b.totalWatchTime))) return false;
        if (!areEpisodesEqual(a.episodes, b.episodes)) return false;

        return true;
    }

    function areAnimeDataMapsEqual(aData, bData) {
        if (aData === bData) return true; // reference-equality fast path
        const a = aData || {};
        const b = bData || {};
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);

        if (aKeys.length !== bKeys.length) return false;

        for (const slug of aKeys) {
            if (!Object.prototype.hasOwnProperty.call(b, slug)) return false;
            if (!areAnimeEntriesEqual(a[slug], b[slug])) return false;
        }

        return true;
    }

    function areProgressMapsEqual(aProgress, bProgress) {
        if (aProgress === bProgress) return true; // reference-equality fast path
        const a = aProgress || {};
        const b = bProgress || {};
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);

        if (aKeys.length !== bKeys.length) return false;

        for (const id of aKeys) {
            const ap = a[id];
            const bp = b[id];
            if (!bp) return false;

            if (getSafeNumber(Number(ap?.currentTime)) !== getSafeNumber(Number(bp?.currentTime))) return false;
            if (getSafeNumber(Number(ap?.duration)) !== getSafeNumber(Number(bp?.duration))) return false;
            if (getSafeNumber(Number(ap?.percentage)) !== getSafeNumber(Number(bp?.percentage))) return false;
            if (!!ap?.deleted !== !!bp?.deleted) return false;
            if (getSafeString(ap?.savedAt) !== getSafeString(bp?.savedAt)) return false;
            if (getSafeString(ap?.deletedAt) !== getSafeString(bp?.deletedAt)) return false;
        }

        return true;
    }

    function shallowEqualDeletedAnime(aDeleted, bDeleted) {
        if (aDeleted === bDeleted) return true;
        const a = aDeleted || {};
        const b = bDeleted || {};
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);

        if (aKeys.length !== bKeys.length) return false;

        for (const slug of aKeys) {
            if (!Object.prototype.hasOwnProperty.call(b, slug)) return false;
            if (getSafeString(a[slug]?.deletedAt) !== getSafeString(b[slug]?.deletedAt)) return false;
        }

        return true;
    }

    function shallowEqualStringMap(aMap, bMap) {
        if (aMap === bMap) return true;
        const a = aMap || {};
        const b = bMap || {};
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);

        if (aKeys.length !== bKeys.length) return false;

        for (const key of aKeys) {
            if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
            if (getSafeString(a[key]) !== getSafeString(b[key])) return false;
        }

        return true;
    }

    function shallowEqualObjectMap(aMap, bMap) {
        const a = aMap || {};
        const b = bMap || {};
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);

        if (aKeys.length !== bKeys.length) return false;

        for (const key of aKeys) {
            if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
            if (JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null)) return false;
        }

        return true;
    }

    function isLikelyMovieSlug(slug) {
        const value = getSafeString(slug);
        if (!value) return false;

        const moviePatterns = [
            /-movie(-|$)/i,
            /-film(-|$)/i,
            /-gekijouban/i,
            /-the-movie/i,
            /^.*-movie-\d+/i,
            /-3d-/i,
            /-ova(-|$)/i,
            /-special(-|$)/i,
            /-recap(-|$)/i
        ];

        return moviePatterns.some((pattern) => pattern.test(value));
    }

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

            const mergedMetadata = { ...(cloudAnime || {}), ...(localAnime || {}) };
            const { title, titleUpdatedAt } = getTitleSelection(localAnime, cloudAnime, slug);
            mergedMetadata.title = title;
            if (titleUpdatedAt) {
                mergedMetadata.titleUpdatedAt = titleUpdatedAt;
            } else {
                delete mergedMetadata.titleUpdatedAt;
            }

            if (!mergedMetadata.coverImage && cloudAnime.coverImage) {
                mergedMetadata.coverImage = cloudAnime.coverImage;
            }

            const localTotal = Number.isFinite(localAnime.totalEpisodes) && localAnime.totalEpisodes > 0
                ? localAnime.totalEpisodes : 0;
            const cloudTotal = Number.isFinite(cloudAnime.totalEpisodes) && cloudAnime.totalEpisodes > 0
                ? cloudAnime.totalEpisodes : 0;
            const bestTotal = Math.max(localTotal, cloudTotal);
            mergedMetadata.totalEpisodes = bestTotal > 0 ? bestTotal : null;
            mergedMetadata.lastWatched = pickLatestIso(localAnime.lastWatched, cloudAnime.lastWatched);

            applyMergedListState(mergedMetadata, localAnime, cloudAnime);

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
            const localDeletedAt = toMillis(info?.deletedAt || info);
            const cloudDeletedAt = toMillis(merged[slug]?.deletedAt || merged[slug]);
            if (!merged[slug] || localDeletedAt > cloudDeletedAt) {
                merged[slug] = info;
            }
        }

        return merged;
    }

    function applyDeletedAnime(animeData, deletedAnime) {
        for (const [slug, info] of Object.entries(deletedAnime || {})) {
            if (!animeData[slug]) continue;

            const deletedAt = toMillis(info?.deletedAt || info);
            if (!deletedAt) continue;

            if (deletedAt > getAnimeActivityTimestamp(animeData[slug])) {
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
        getCoverSetAt,
        areAnimeDataMapsEqual,
        areProgressMapsEqual,
        shallowEqualDeletedAnime,
        shallowEqualStringMap,
        shallowEqualObjectMap,
        isLikelyMovieSlug
    };
})();
