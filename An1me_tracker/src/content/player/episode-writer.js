// episode-writer.js — writes an episode's progress data (durations, timestamps) to storage.
const EpisodeWriter = {
  MAX_REASONABLE_DURATION_SECONDS: 6 * 60 * 60,

  _compactNow() {
    return new Date().toISOString().split(".")[0] + "Z";
  },

  _isPlaceholderDuration(duration) {
    const shared = globalThis.AnimeTrackerMergeUtils;
    if (shared?.isPlaceholderDuration) return shared.isPlaceholderDuration(duration);
    const d = Number(duration) || 0;
    return d <= 0 || d === 1440 || d === 6000 || d === 7200;
  },

  _normalizeDuration(duration, logPrefix = "EpisodeWriter") {
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
        WatchlistSync.syncFromStorage(siteAnimeId, slug, { fallbackType: "watching" });
      }
    } catch {}
  },

  _setListState(entry, state, at) {
    globalThis.AnimeTrackerEntryState?.setListState(entry, state, at);
  },

  _reconcileCompletionState(entry, info, at) {
    return globalThis.AnimeTrackerEntryState?.reconcileCompletionState(entry, info, at) || false;
  },

  writeEpisode(info, duration, animeData, options = {}) {
    // Reject non-numeric episode numbers too: findIndex would never match them, so every
    // call would push a fresh duplicate entry.
    if (!info || !info.animeSlug || !Number.isFinite(Number(info.episodeNumber)) || Number(info.episodeNumber) <= 0) {
      return { changed: false, changeType: "none" };
    }

    const logPrefix = options.logPrefix || "EpisodeWriter";
    const slug = info.animeSlug;
    const mediaType = globalThis.AnimeTrackerMediaType?.normalize(info.mediaType) || null;
    let metadataChanged = false;

    if (!animeData[slug]) {
      const createdAt = this._compactNow();
      animeData[slug] = {
        title: info.animeTitle,
        slug,
        episodes: [],
        totalWatchTime: 0,
        lastWatched: null,
        totalEpisodes: Number.isFinite(info.totalEpisodes) ? info.totalEpisodes : null,
        totalEpisodesUpdatedAt: Number.isFinite(info.totalEpisodes) ? createdAt : null,
        totalEpisodesSource: Number.isFinite(info.totalEpisodes) ? "an1me" : null,
        coverImage: info.coverImage || null,
        siteAnimeId: info.siteAnimeId || null,
        mediaType,
        mediaTypeUpdatedAt: mediaType ? createdAt : null,
        mediaTypeSource: mediaType ? "an1me" : null,
        releaseStatus: info.releaseStatus || null,
        releaseStatusUpdatedAt: info.releaseStatus ? createdAt : null,
        releaseStatusSource: info.releaseStatus ? "an1me" : null,
      };
    } else if (info.siteAnimeId && !animeData[slug].siteAnimeId) {
      animeData[slug].siteAnimeId = info.siteAnimeId;
      metadataChanged = true;
    }

    if (!animeData[slug].coverImage && info.coverImage) {
      animeData[slug].coverImage = info.coverImage;
      metadataChanged = true;
    }

    if (mediaType && (animeData[slug].mediaType !== mediaType || animeData[slug].mediaTypeSource !== "an1me")) {
      animeData[slug].mediaType = mediaType;
      animeData[slug].mediaTypeUpdatedAt = this._compactNow();
      animeData[slug].mediaTypeSource = "an1me";
      metadataChanged = true;
    }

    if (info.releaseStatus && (animeData[slug].releaseStatus !== info.releaseStatus || animeData[slug].releaseStatusSource !== "an1me")) {
      animeData[slug].releaseStatus = info.releaseStatus;
      animeData[slug].releaseStatusUpdatedAt = this._compactNow();
      animeData[slug].releaseStatusSource = "an1me";
      metadataChanged = true;
    }

    if (Number.isFinite(info.totalEpisodes) && info.totalEpisodes > 0 && info.totalEpisodes < 10000) {
      const trackedEpisodes = animeData[slug].episodes || [];
      const maxTracked = Math.max(
        0,
        ...trackedEpisodes.map((ep) => Number(ep.number) || 0),
        Number(info.episodeNumber) || 0,
        Number(info.secondEpisodeNumber) || 0,
      );
      if (
        info.totalEpisodes >= maxTracked &&
        (animeData[slug].totalEpisodes !== info.totalEpisodes || animeData[slug].totalEpisodesSource !== "an1me")
      ) {
        animeData[slug].totalEpisodes = info.totalEpisodes;
        animeData[slug].totalEpisodesUpdatedAt = this._compactNow();
        animeData[slug].totalEpisodesSource = "an1me";
        metadataChanged = true;
      }
    }

    if (!Array.isArray(animeData[slug].episodes)) {
      animeData[slug].episodes = [];
    }

    const resumedFromInactiveState =
      globalThis.AnimeTrackerEntryState?.resumeInactiveState(animeData[slug], this._compactNow()) || false;
    if (resumedFromInactiveState) {
      this._syncWatching(animeData[slug].siteAnimeId || info.siteAnimeId, slug);
    }

    const validDuration = this._normalizeDuration(duration, logPrefix);
    const targetEpisode = Number(info.episodeNumber);
    const existingIndex = animeData[slug].episodes.findIndex((ep) => Number(ep?.number) === targetEpisode);

    if (existingIndex !== -1) {
      const completionChanged = this._reconcileCompletionState(animeData[slug], info, this._compactNow());
      const existingEpisode = animeData[slug].episodes[existingIndex] || {};
      const currentDuration = Number(existingEpisode.duration) || 0;

      if (existingEpisode.durationSource === "anilist") {
        const nowIso = this._compactNow();
        animeData[slug].episodes[existingIndex] = {
          ...existingEpisode,
          watchedAt: nowIso,
          duration: validDuration > 0 ? validDuration : currentDuration,
          durationSource: "video",
        };

        if (info.isDoubleEpisode && info.secondEpisodeNumber) {
          const secondNum = this._normalizeEpisodeNumber(info.secondEpisodeNumber);
          const secondIdx = animeData[slug].episodes.findIndex((ep) => Number(ep?.number) === Number(secondNum));
          if (secondIdx !== -1 && animeData[slug].episodes[secondIdx]?.durationSource === "anilist") {
            animeData[slug].episodes[secondIdx] = {
              ...animeData[slug].episodes[secondIdx],
              watchedAt: nowIso,
              duration: validDuration > 0 ? validDuration : Number(animeData[slug].episodes[secondIdx].duration) || 0,
              durationSource: "video",
            };
          }
        }
        animeData[slug].totalWatchTime = animeData[slug].episodes.reduce((sum, ep) => sum + (Number(ep?.duration) || 0), 0);
        animeData[slug].lastWatched = nowIso;
        return { changed: true, changeType: "promoted-import" };
      }
      if (this._isPlaceholderDuration(currentDuration) && validDuration > 0 && currentDuration !== validDuration) {
        animeData[slug].episodes[existingIndex] = {
          ...existingEpisode,
          duration: validDuration,
          durationSource: "video",
        };
        animeData[slug].totalWatchTime = animeData[slug].episodes.reduce((sum, ep) => sum + (Number(ep?.duration) || 0), 0);
        animeData[slug].lastWatched = this._compactNow();
        return { changed: true, changeType: "updated-placeholder" };
      }
      if (resumedFromInactiveState) {
        animeData[slug].lastWatched = this._compactNow();
        return { changed: true, changeType: "resumed-existing" };
      }
      if (metadataChanged || completionChanged) return { changed: true, changeType: completionChanged ? "status" : "metadata" };
      return { changed: false, changeType: "none" };
    }

    const watchedAt = this._compactNow();
    animeData[slug].episodes.push({
      number: this._normalizeEpisodeNumber(info.episodeNumber),
      watchedAt,
      duration: validDuration,
      durationSource: "video",
    });

    if (info.isDoubleEpisode && info.secondEpisodeNumber) {
      const secondEpisodeNumber = this._normalizeEpisodeNumber(info.secondEpisodeNumber);
      const alreadyHasSecond = animeData[slug].episodes.some((ep) => Number(ep?.number) === Number(secondEpisodeNumber));
      if (!alreadyHasSecond) {
        animeData[slug].episodes.push({
          number: secondEpisodeNumber,
          watchedAt,
          duration: validDuration,
          durationSource: "video",
        });
      }
    }

    animeData[slug].totalWatchTime = animeData[slug].episodes.reduce((sum, ep) => sum + (Number(ep?.duration) || 0), 0);
    const nowIso = this._compactNow();
    animeData[slug].lastWatched = nowIso;
    animeData[slug].episodes.sort((a, b) => (Number(a?.number) || 0) - (Number(b?.number) || 0));

    this._reconcileCompletionState(animeData[slug], info, nowIso);

    return { changed: true, changeType: "added-episode" };
  },
};

window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.EpisodeWriter = EpisodeWriter;
