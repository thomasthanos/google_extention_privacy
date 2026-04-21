/**
 * Anime Tracker - Episode Writer
 * Shared synchronous writer for tracked episodes.
 */

const EpisodeWriter = {
    MAX_REASONABLE_DURATION_SECONDS: 6 * 60 * 60,

    _compactNow() {
        return new Date().toISOString().split('.')[0] + 'Z';
    },

    _isPlaceholderDuration(duration) {
        const d = Number(duration) || 0;
        return d <= 0 || d === 1440 || d === 6000 || d === 7200;
    },

    _normalizeDuration(duration, logPrefix = 'EpisodeWriter') {
        const { Logger } = window.AnimeTrackerContent;
        let validDuration = Math.round(Number(duration) || 0);
        if (!Number.isFinite(validDuration) || validDuration <= 0) {
            validDuration = 0;
        }
        if (validDuration > this.MAX_REASONABLE_DURATION_SECONDS) {
            Logger.warn(`${logPrefix}: invalid duration ${validDuration}s, capping to ${this.MAX_REASONABLE_DURATION_SECONDS}s`);
            validDuration = this.MAX_REASONABLE_DURATION_SECONDS;
        }
        return validDuration;
    },

    _normalizeEpisodeNumber(value) {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : value;
    },

    _syncWatching(siteAnimeId, slug = null) {
        try {
            const { WatchlistSync } = window.AnimeTrackerContent;
            if (WatchlistSync && siteAnimeId) {
                WatchlistSync.syncFromStorage(siteAnimeId, slug, { fallbackType: 'watching' });
            }
        } catch {
            // Non-critical sync path.
        }
    },

    _setListState(entry, state, at) {
        if (!entry) return;
        entry.listState = state;
        entry.listStateUpdatedAt = at;

        if (state === 'completed') {
            entry.completedAt = entry.completedAt || at;
            delete entry.droppedAt;
            delete entry.onHoldAt;
            return;
        }

        if (state === 'active') {
            delete entry.completedAt;
            delete entry.droppedAt;
            delete entry.onHoldAt;
        }
    },

    /**
     * Mutates animeData with the newly watched episode, if needed.
     * Returns an operation result for callers to decide follow-up actions.
     */
    writeEpisode(info, duration, animeData, options = {}) {
        if (!info || !info.animeSlug || !info.episodeNumber) {
            return { changed: false, changeType: 'none', createdAnime: false };
        }

        const logPrefix = options.logPrefix || 'EpisodeWriter';
        const slug = info.animeSlug;
        let createdAnime = false;

        if (!animeData[slug]) {
            animeData[slug] = {
                title: info.animeTitle,
                slug,
                episodes: [],
                totalWatchTime: 0,
                lastWatched: null,
                totalEpisodes: Number.isFinite(info.totalEpisodes) ? info.totalEpisodes : null,
                coverImage: info.coverImage || null,
                siteAnimeId: info.siteAnimeId || null
            };
            createdAnime = true;
        } else if (info.siteAnimeId && !animeData[slug].siteAnimeId) {
            animeData[slug].siteAnimeId = info.siteAnimeId;
        }

        if (!animeData[slug].coverImage && info.coverImage) {
            animeData[slug].coverImage = info.coverImage;
        }

        if (Number.isFinite(info.totalEpisodes) && info.totalEpisodes > 0 && info.totalEpisodes < 10000) {
            const trackedEpisodes = animeData[slug].episodes || [];
            const maxTracked = Math.max(
                0,
                ...trackedEpisodes.map(ep => Number(ep.number) || 0),
                Number(info.episodeNumber) || 0,
                Number(info.secondEpisodeNumber) || 0
            );
            if (info.totalEpisodes >= maxTracked) {
                animeData[slug].totalEpisodes = info.totalEpisodes;
            }
        }

        if (!Array.isArray(animeData[slug].episodes)) {
            animeData[slug].episodes = [];
        }

        if (animeData[slug].onHoldAt) {
            delete animeData[slug].onHoldAt;
            animeData[slug].listState = 'active';
            animeData[slug].listStateUpdatedAt = this._compactNow();
            this._syncWatching(animeData[slug].siteAnimeId || info.siteAnimeId, slug);
        }

        if (animeData[slug].droppedAt) {
            delete animeData[slug].droppedAt;
            animeData[slug].listState = 'active';
            animeData[slug].listStateUpdatedAt = this._compactNow();
            this._syncWatching(animeData[slug].siteAnimeId || info.siteAnimeId, slug);
        }

        const validDuration = this._normalizeDuration(duration, logPrefix);
        const targetEpisode = Number(info.episodeNumber) || info.episodeNumber;
        const existingIndex = animeData[slug].episodes
            .findIndex(ep => Number(ep?.number) === Number(targetEpisode));

        if (existingIndex !== -1) {
            const existingEpisode = animeData[slug].episodes[existingIndex] || {};
            const currentDuration = Number(existingEpisode.duration) || 0;
            if (this._isPlaceholderDuration(currentDuration) && validDuration > 0 && currentDuration !== validDuration) {
                animeData[slug].episodes[existingIndex] = {
                    ...existingEpisode,
                    duration: validDuration,
                    durationSource: 'video'
                };
                animeData[slug].totalWatchTime = animeData[slug].episodes
                    .reduce((sum, ep) => sum + (Number(ep?.duration) || 0), 0);
                animeData[slug].lastWatched = this._compactNow();
                return { changed: true, changeType: 'updated-placeholder', createdAnime };
            }
            return { changed: false, changeType: 'none', createdAnime };
        }

        const watchedAt = this._compactNow();
        animeData[slug].episodes.push({
            number: this._normalizeEpisodeNumber(info.episodeNumber),
            watchedAt,
            duration: validDuration,
            durationSource: 'video'
        });

        if (info.isDoubleEpisode && info.secondEpisodeNumber) {
            const secondEpisodeNumber = this._normalizeEpisodeNumber(info.secondEpisodeNumber);
            const alreadyHasSecond = animeData[slug].episodes
                .some(ep => Number(ep?.number) === Number(secondEpisodeNumber));
            if (!alreadyHasSecond) {
                animeData[slug].episodes.push({
                    number: secondEpisodeNumber,
                    watchedAt,
                    duration: validDuration,
                    durationSource: 'video'
                });
            }
        }

        // Recompute from episodes so double-episode pushes are counted correctly.
        animeData[slug].totalWatchTime = animeData[slug].episodes
            .reduce((sum, ep) => sum + (Number(ep?.duration) || 0), 0);
        const nowIso = this._compactNow();
        animeData[slug].lastWatched = nowIso;
        animeData[slug].episodes.sort((a, b) => (Number(a?.number) || 0) - (Number(b?.number) || 0));

        const trackedCount = animeData[slug].episodes.length;
        const totalEpisodes = Number(animeData[slug].totalEpisodes) || 0;
        if (totalEpisodes > 0 && trackedCount >= totalEpisodes) {
            this._setListState(animeData[slug], 'completed', nowIso);
        } else if (animeData[slug].listState === 'completed' && totalEpisodes > trackedCount) {
            this._setListState(animeData[slug], 'active', nowIso);
        }

        return { changed: true, changeType: 'added-episode', createdAnime };
    }
};

window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.EpisodeWriter = EpisodeWriter;
