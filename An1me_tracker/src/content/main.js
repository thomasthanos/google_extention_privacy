// main.js — watch-page brain: starts/stops tracking, detects the playing episode,
// handles server switches, and saves progress. Coordinates the player modules.
(function () {
  "use strict";

  if (window.self !== window.top) return;

  const AT = window.AnimeTrackerContent;
  const FILLER_STAY_SELECTIONS_KEY = "fillerStaySelections";

  const TrackingState = { IDLE: "idle", TRACKING: "tracking", COMPLETED: "completed" };
  let trackingState = TrackingState.IDLE;
  let animeInfo = null;
  let currentEpisodeId = null;
  let durationRefreshAttempted = false;
  let durationRefreshAttempts = 0;
  const MAX_DURATION_REFRESH_ATTEMPTS = 5;
  let accumulatedPlaybackSeconds = 0;
  let lastTimeupdateTime = 0;
  let lastVideoSource = "";
  let earlyTrackDone = false;

  let completionNotificationShown = false;
  function showCompletionOnce() {
    if (completionNotificationShown) return;
    completionNotificationShown = true;
    AT.Notifications.showCompletion(animeInfo);
    maybePromptBacklog();
  }

  let backlogPromptHandled = false;

  async function maybePromptBacklog() {
    const { Storage, Logger, Notifications } = AT;
    if (backlogPromptHandled) return;
    if (!animeInfo || !animeInfo.animeSlug || !animeInfo.episodeNumber) return;

    const currentEp = Number(animeInfo.episodeNumber) || 0;
    if (currentEp <= 1) return;
    backlogPromptHandled = true;

    try {
      const result = await Storage.get(["animeData"]);
      if (Storage.isAbortResult(result)) return;
      const animeData = result.animeData || {};
      const entry = animeData[animeInfo.animeSlug];
      if (!entry || !Array.isArray(entry.episodes)) return;

      const watched = new Set(entry.episodes.map((ep) => Number(ep?.number)).filter((n) => Number.isFinite(n)));

      let fillers = [];
      try {
        const resp = await chrome.runtime.sendMessage({
          type: "GET_FILLER_EPISODES",
          animeSlug: animeInfo.animeSlug,
          animeTitle: animeInfo.animeTitle || null,
        });
        if (Array.isArray(resp?.fillers)) fillers = resp.fillers;
      } catch {}
      const fillerSet = new Set(fillers.map((n) => Number(n)));

      const missing = [];
      for (let n = 1; n < currentEp; n++) {
        if (watched.has(n)) continue;
        if (fillerSet.has(n)) continue;
        missing.push(n);
      }

      if (missing.length === 0 || missing.length > 2) return;

      Notifications.showBacklogPrompt(
        animeInfo.animeTitle,
        missing,
        () => {
          void markEpisodesWatched(animeInfo.animeSlug, missing);
        },
        () => {
          Logger.debug(`Backlog prompt dismissed for ${missing.join(", ")}`);
        },
      );
    } catch (e) {
      Logger.warn("Backlog prompt check failed:", e?.message || e);
    }
  }

  async function markEpisodesWatched(slug, episodeNumbers) {
    const { Storage, Logger, EpisodeWriter } = AT;
    if (!slug || !Array.isArray(episodeNumbers) || episodeNumbers.length === 0) return;

    try {
      let changed = false;
      const mutateResult = await Storage.mutate(["animeData", "deletedAnime"], (data) => {
        const animeData = (data.animeData = data.animeData || {});
        const del = (data.deletedAnime = data.deletedAnime || {});
        const entry = animeData[slug];

        let inferredDuration = 1440;
        if (entry && Array.isArray(entry.episodes)) {
          const realDurs = entry.episodes
            .filter((ep) => (ep?.durationSource || "video") === "video" && Number(ep.duration) > 0)
            .map((ep) => Number(ep.duration))
            .sort((a, b) => a - b);
          if (realDurs.length > 0) {
            inferredDuration = realDurs[Math.floor(realDurs.length / 2)];
          }
        }

        for (const num of episodeNumbers) {
          const info = {
            animeSlug: slug,
            animeTitle: (entry && entry.title) || animeInfo?.animeTitle || slug,
            episodeNumber: num,
            siteAnimeId: entry?.siteAnimeId || animeInfo?.siteAnimeId || null,
            coverImage: entry?.coverImage || animeInfo?.coverImage || null,
            totalEpisodes: entry?.totalEpisodes ?? animeInfo?.totalEpisodes ?? null,
            mediaType: entry?.mediaType || animeInfo?.mediaType || null,
          };
          const r = EpisodeWriter.writeEpisode(info, inferredDuration, animeData, { logPrefix: "BacklogMark" });
          if (r?.changed) {
            changed = true;
            delete del[slug];
          }
        }
        if (!changed) return false;
      });

      if (Storage.isAbortResult(mutateResult)) {
        Logger.warn("Backlog mark skipped: storage read unavailable");
        return;
      }
      if (!changed) return;

      try {
        AT.ProgressTracker._adCache = null;
        AT.ProgressTracker._adCacheTime = 0;
      } catch {}

      Logger.success(`Backlog: marked episode(s) ${episodeNumbers.join(", ")} as watched`);

      try {
        highlightWatchedEpisodes(slug);
      } catch {}
      try {
        chrome.runtime.sendMessage({ type: "SYNC_TO_FIREBASE_IMMEDIATE" }, () => {
          void chrome.runtime.lastError;
        });
      } catch {}
    } catch (e) {
      Logger.warn("Backlog mark failed:", e?.message || e);
    }
  }

  let cachedOutroStartSec = null;
  function parseSkipTime(text) {
    return window.AnimeTrackerContent.AnimeParser.parseTimeToSeconds(text);
  }
  async function loadOutroStartFor(info) {
    cachedOutroStartSec = null;
    if (!info?.animeSlug || !info?.episodeNumber) return;
    const epNum = Number(info.episodeNumber);

    try {
      const key = `skiptimeCache:${info.animeSlug}__episode-${epNum}`;
      const result = await chrome.storage.local.get([key]);
      const stored = result?.[key];
      if (stored?.outroStart) {
        const sec = parseSkipTime(stored.outroStart);
        if (sec > 0) {
          cachedOutroStartSec = sec;
          return;
        }
      }
    } catch {}

    try {
      const video = AT.VideoMonitor?.getVideoElement?.();
      const len = video?.duration && Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
      const resp = await new Promise((resolve) => {
        let settled = false;
        const done = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(to);
          resolve(value);
        };
        const to = setTimeout(() => done(null), AT.CONFIG.DELAYS.OUTRO_RPC_TIMEOUT);
        try {
          chrome.runtime.sendMessage(
            {
              type: "GET_OUTRO_START",
              animeSlug: info.animeSlug,
              animeTitle: info.animeTitle || null,
              episodeNumber: epNum,
              episodeLength: len,
            },
            (r) => {
              if (chrome.runtime.lastError) {
                done(null);
                return;
              }
              done(r || null);
            },
          );
        } catch {
          done(null);
        }
      });
      const sec = Number(resp?.outroStart) || 0;
      if (sec > 0) cachedOutroStartSec = sec;
    } catch {}
  }

  window.AnimeTrackerContent = window.AnimeTrackerContent || {};
  window.AnimeTrackerContent.getCachedOutroStartSec = () => cachedOutroStartSec;

  function normalizeStayedFillers(rawSelections) {
    if (!rawSelections || typeof rawSelections !== "object") return {};

    const normalized = {};
    for (const [slug, values] of Object.entries(rawSelections)) {
      if (!slug) continue;

      const episodes = Array.isArray(values) ? values : Object.keys(values || {});
      const cleaned = [...new Set(episodes.map((ep) => Number(ep)).filter((ep) => Number.isInteger(ep) && ep > 0))].sort((a, b) => a - b);

      if (cleaned.length > 0) {
        normalized[String(slug).toLowerCase()] = cleaned;
      }
    }

    return normalized;
  }

  async function rememberStayedFillerEpisode(slug, episodeNumber) {
    const { Storage, Logger } = AT;
    if (!slug || !Number.isInteger(Number(episodeNumber))) return;

    try {
      const key = String(slug).toLowerCase();
      const mutation = await Storage.mutate([FILLER_STAY_SELECTIONS_KEY], (data) => {
        const selections = normalizeStayedFillers(data?.[FILLER_STAY_SELECTIONS_KEY] || {});
        const nextEpisodes = new Set(selections[key] || []);
        const beforeSize = nextEpisodes.size;
        nextEpisodes.add(Number(episodeNumber));
        if (nextEpisodes.size === beforeSize) return false;
        selections[key] = [...nextEpisodes].sort((a, b) => a - b);
        data[FILLER_STAY_SELECTIONS_KEY] = selections;
        return true;
      });
      if (Storage.isAbortResult(mutation)) {
        Logger.warn("Skip rememberStayedFillerEpisode: storage unavailable");
        return;
      }
      Logger.debug(`Remembered filler stay for ${key} Ep ${episodeNumber}`);
    } catch (error) {
      Logger.warn("Failed to remember filler stay selection:", error);
    }
  }

  async function clearStayedFillerEpisode(slug, episodeNumber) {
    const { Storage, Logger } = AT;
    if (!slug || !Number.isInteger(Number(episodeNumber))) return;

    try {
      const key = String(slug).toLowerCase();
      const mutation = await Storage.mutate([FILLER_STAY_SELECTIONS_KEY], (data) => {
        const selections = normalizeStayedFillers(data?.[FILLER_STAY_SELECTIONS_KEY] || {});
        const current = selections[key];
        if (!Array.isArray(current) || current.length === 0) return false;

        const nextEpisodes = current.filter((ep) => ep !== Number(episodeNumber));
        if (nextEpisodes.length === current.length) return false;
        if (nextEpisodes.length > 0) selections[key] = nextEpisodes;
        else delete selections[key];
        data[FILLER_STAY_SELECTIONS_KEY] = selections;
        return true;
      });
      if (Storage.isAbortResult(mutation)) {
        Logger.warn("Skip clearStayedFillerEpisode: storage unavailable");
        return;
      }
      Logger.debug(`Cleared filler stay for ${key} Ep ${episodeNumber}`);
    } catch (error) {
      Logger.warn("Failed to clear filler stay selection:", error);
    }
  }

  function resetPlaybackAccumulator(reason = "") {
    if (reason && AT?.Logger) AT.Logger.debug(`Reset playback accumulator: ${reason}`);
    accumulatedPlaybackSeconds = 0;
    lastTimeupdateTime = 0;
  }

  function resetEpisodeTrackingState(reason = "") {
    resetPlaybackAccumulator(reason);
    earlyTrackDone = false;
    trackingState = TrackingState.IDLE;
    durationRefreshAttempted = false;
    durationRefreshAttempts = 0;
    completionNotificationShown = false;
    backlogPromptHandled = false;
  }

  function syncVideoSourceEpisodeBoundary(videoElement) {
    const src = (videoElement?.currentSrc || videoElement?.src || "").trim();
    if (!src) return false;
    if (!lastVideoSource) {
      lastVideoSource = src;
      return false;
    }
    if (src === lastVideoSource) return false;
    lastVideoSource = src;

    if (currentEpisodeId && animeInfo && currentEpisodeId !== animeInfo.uniqueId) {
      resetEpisodeTrackingState("episode id changed via video source");
      return true;
    }
    return false;
  }

  function isNearEnd(currentTime, duration) {
    if (!duration || duration <= 0) return false;
    const remaining = duration - currentTime;
    const progress = currentTime / duration;
    return remaining <= 30 || progress >= 0.95;
  }

  function shouldBlockCompletion(currentTime, duration) {
    const { CONFIG } = AT;
    const minWatch = CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
    const hardMin = CONFIG.HARD_MIN_WATCH_SECONDS ?? 30;
    if (accumulatedPlaybackSeconds < hardMin) return true;
    if (accumulatedPlaybackSeconds < minWatch && !isNearEnd(currentTime, duration)) return true;
    return false;
  }

  function writeSyncEpisode(info, duration, animeData, logPrefix) {
    const { EpisodeWriter } = AT;
    const result = EpisodeWriter.writeEpisode(info, duration, animeData, { logPrefix });
    return !!result?.changed;
  }

  async function trackImmediately() {
    const { Logger, ProgressTracker, VideoMonitor, Notifications, CONFIG, Storage } = AT;
    const videoElement = VideoMonitor.getVideoElement();

    if (!animeInfo || trackingState !== TrackingState.IDLE || !videoElement) return;

    const duration = videoElement.duration;
    const currentTime = videoElement.currentTime;

    if (!duration || !ProgressTracker.shouldMarkComplete(currentTime, duration, cachedOutroStartSec)) return;

    if (shouldBlockCompletion(currentTime, duration)) {
      const minWatch = CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
      Logger.debug(`trackImmediately: only ${Math.round(accumulatedPlaybackSeconds)}s of real playback (need ${minWatch}s), skipping`);
      return;
    }

    trackingState = TrackingState.TRACKING;

    try {
      let written = false;
      let animeData = null;
      const mutateResult = await Storage.mutate(["animeData", "deletedAnime"], (data) => {
        const ad = (data.animeData = data.animeData || {});
        const del = (data.deletedAnime = data.deletedAnime || {});
        written = writeSyncEpisode(animeInfo, duration, ad, "Immediate");
        if (written) delete del[animeInfo.animeSlug];
        animeData = ad;
        if (!written) return false;
      });
      if (Storage.isAbortResult(mutateResult)) {
        Logger.warn("Immediate track skipped: storage read unavailable");
        trackingState = TrackingState.IDLE;
        earlyTrackDone = false;
        return;
      }

      if (written) {
        await clearStayedFillerEpisode(animeInfo.animeSlug, animeInfo.episodeNumber);
        trackingState = TrackingState.COMPLETED;
        Logger.success("✓ Immediate track successful");
        showCompletionOnce();

        try {
          const { WatchlistSync } = AT;
          const slug = animeInfo.animeSlug;
          const entry = animeData[slug];
          const siteId = entry?.siteAnimeId || animeInfo.siteAnimeId;
          if (WatchlistSync && siteId) {
            WatchlistSync.syncFromStorage(siteId, slug, {
              fallbackType: "watching",
              keepFirstEpisodeAsPlanToWatch: true,
            });
          }
        } catch {}

        try {
          const progressResult = await Storage.mutate(["videoProgress"], (data) => {
            const videoProgress = (data.videoProgress = data.videoProgress || {});
            if (!videoProgress[animeInfo.uniqueId]) return false;
            delete videoProgress[animeInfo.uniqueId];
          });
          if (Storage.isAbortResult(progressResult)) return;
        } catch {}
      } else {
        trackingState = TrackingState.COMPLETED;
      }
    } catch (e) {
      trackingState = TrackingState.IDLE;
      earlyTrackDone = false;
      if (e?.message?.includes("Extension context invalidated") || !Storage.isContextValid()) {
        Logger.debug("Immediate track aborted: extension context invalidated");
        return;
      }
      Logger.error("Immediate track failed:", e);
    }
  }

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  async function tryRefreshTrackedDuration(videoElement, reason = "metadata") {
    const { ProgressTracker, Logger } = AT;
    if (!videoElement || !animeInfo?.uniqueId || durationRefreshAttempted) return;
    if (durationRefreshAttempts >= MAX_DURATION_REFRESH_ATTEMPTS) return;

    const duration = Number(videoElement.duration) || 0;
    if (!Number.isFinite(duration) || duration <= 0) return;

    try {
      durationRefreshAttempts += 1;
      const refreshed = await ProgressTracker.refreshTrackedEpisodeDuration(animeInfo, duration);
      if (refreshed) {
        durationRefreshAttempted = true;
        await ProgressTracker.clearSavedProgress(animeInfo.uniqueId);
      } else {
        if (durationRefreshAttempts >= MAX_DURATION_REFRESH_ATTEMPTS) durationRefreshAttempted = true;
      }
    } catch (error) {
      Logger.warn(`Duration refresh failed via ${reason}:`, error);
    }
  }

  const handleTimeUpdateRaw = async () => {
    const { ProgressTracker, VideoMonitor, Logger, CONFIG } = AT;
    const videoElement = VideoMonitor.getVideoElement();

    if (!videoElement || trackingState === TrackingState.COMPLETED || earlyTrackDone || !animeInfo) return;

    syncVideoSourceEpisodeBoundary(videoElement);

    const duration = videoElement.duration;
    const currentTime = videoElement.currentTime;

    if (!duration || duration === 0 || isNaN(duration)) return;

    if (lastTimeupdateTime > 0) {
      const delta = currentTime - lastTimeupdateTime;
      const rate = Number(videoElement.playbackRate) || 1;
      const maxDelta = Math.max(2, 3 * rate);
      if (delta > 0 && delta < maxDelta) accumulatedPlaybackSeconds += delta;
    }
    lastTimeupdateTime = currentTime;

    if (!durationRefreshAttempted && durationRefreshAttempts < MAX_DURATION_REFRESH_ATTEMPTS) {
      await tryRefreshTrackedDuration(videoElement, "timeupdate");
    }

    if (ProgressTracker.shouldMarkComplete(currentTime, duration, cachedOutroStartSec)) {
      if (shouldBlockCompletion(currentTime, duration)) {
        const minWatch = CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
        Logger.throttled(
          "block-completion-raw",
          "DEBUG",
          10000,
          `Threshold reached but only ${Math.round(accumulatedPlaybackSeconds)}s of real playback (need ${minWatch}s), waiting...`,
        );
        return;
      }
      earlyTrackDone = true;
      Logger.info("Threshold reached, tracking immediately (no debounce)");
      trackImmediately();
    }
  };

  const handleVideoMetadata = async () => {
    const { VideoMonitor } = AT;
    const videoElement = VideoMonitor.getVideoElement();
    await tryRefreshTrackedDuration(videoElement, "loadedmetadata");

    if (animeInfo && cachedOutroStartSec === null) {
      loadOutroStartFor(animeInfo);
    }
  };

  const handleTimeUpdate = debounce(async function () {
    const { CONFIG, Logger, ProgressTracker, VideoMonitor } = AT;
    const videoElement = VideoMonitor.getVideoElement();

    if (!videoElement || trackingState === TrackingState.COMPLETED || !animeInfo) return;

    syncVideoSourceEpisodeBoundary(videoElement);

    if (currentEpisodeId && currentEpisodeId !== animeInfo.uniqueId) {
      Logger.info("Episode changed, resetting tracking state");
      resetEpisodeTrackingState("episode id changed");
      currentEpisodeId = animeInfo.uniqueId;
    }

    const duration = videoElement.duration;
    const currentTime = videoElement.currentTime;

    if (!duration || duration === 0 || isNaN(duration)) return;

    if (currentTime > CONFIG.MIN_PROGRESS_TO_SAVE && !ProgressTracker.shouldMarkComplete(currentTime, duration, cachedOutroStartSec)) {
      ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration);
    }

    if (ProgressTracker.shouldMarkComplete(currentTime, duration, cachedOutroStartSec)) {
      if (trackingState !== TrackingState.IDLE) return;

      if (shouldBlockCompletion(currentTime, duration)) {
        const minWatch = CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
        Logger.throttled(
          "block-completion-debounced",
          "DEBUG",
          10000,
          `Debounced: threshold reached but only ${Math.round(accumulatedPlaybackSeconds)}s of real playback (need ${minWatch}s), waiting...`,
        );
        return;
      }

      const remainingTime = Math.round(duration - currentTime);
      const progress = Math.round((currentTime / duration) * 100);
      const durationMins = Math.floor(duration / 60);
      const durationSecs = Math.floor(duration % 60);
      Logger.info(
        `Marking complete: ${progress}% watched (need ${CONFIG.COMPLETED_PERCENTAGE}%), ${remainingTime}s remaining of ${durationMins}:${String(durationSecs).padStart(2, "0")}`,
      );

      const alreadyTracked = await ProgressTracker.isEpisodeTracked(animeInfo.uniqueId);
      if (alreadyTracked) {
        const refreshed = await ProgressTracker.refreshTrackedEpisodeDuration(animeInfo, duration);
        if (refreshed) await ProgressTracker.clearSavedProgress(animeInfo.uniqueId);
        trackingState = TrackingState.COMPLETED;
        return;
      }

      trackingState = TrackingState.TRACKING;
      currentEpisodeId = animeInfo.uniqueId;

      const trackingOperation = async () => {
        await ProgressTracker.saveWatchedEpisode(animeInfo, duration);
        await ProgressTracker.clearSavedProgress(animeInfo.uniqueId);
      };

      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("handleTimeUpdate timeout")), AT.CONFIG.DELAYS.TRACK_TIMEOUT);
      });

      try {
        await Promise.race([trackingOperation(), timeoutPromise]);
        Logger.success("Auto-tracked on timeupdate");
        maybePromptBacklog();
      } catch (error) {
        if (error.message === "handleTimeUpdate timeout") Logger.warn("Tracking operation timed out, will retry");
        else Logger.error("Track failed", error);
        trackingState = TrackingState.IDLE;
      } finally {
        clearTimeout(timeoutId);
        if (trackingState === TrackingState.TRACKING) trackingState = TrackingState.COMPLETED;
      }
    }
  }, AT.CONFIG.DEBOUNCE_DELAY);

  const requestProgressSync = (force = false) => {
    try {
      chrome.runtime.sendMessage({ type: "SYNC_PROGRESS_ONLY", force }, () => {
        void chrome.runtime.lastError;
      });
    } catch {}
  };

  const handlePause = () => {
    const { ProgressTracker, VideoMonitor } = AT;
    const videoElement = VideoMonitor.getVideoElement();
    if (animeInfo && trackingState !== TrackingState.COMPLETED && videoElement && videoElement.currentTime > 0) {
      ProgressTracker.saveVideoProgress(animeInfo.uniqueId, videoElement.currentTime, videoElement.duration, true, false);
      requestProgressSync();
    }
  };

  const handleSeeked = () => {
    const { ProgressTracker, VideoMonitor } = AT;
    const videoElement = VideoMonitor.getVideoElement();
    if (animeInfo && trackingState !== TrackingState.COMPLETED && videoElement && videoElement.currentTime > 0) {
      ProgressTracker.saveVideoProgress(animeInfo.uniqueId, videoElement.currentTime, videoElement.duration, true, false);
    }
  };

  const handleEnded = async () => {
    const { Logger, ProgressTracker, VideoMonitor, Notifications, CONFIG } = AT;
    const videoElement = VideoMonitor.getVideoElement();

    if (animeInfo && videoElement) {
      const duration = videoElement.duration || 0;
      const currentTime = videoElement.currentTime || 0;

      if (trackingState !== TrackingState.COMPLETED && shouldBlockCompletion(currentTime, duration)) {
        const minWatch = CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
        Logger.debug(`Video ended but only ${Math.round(accumulatedPlaybackSeconds)}s of real playback (need ${minWatch}s), not tracking`);
        return;
      }
      if (trackingState === TrackingState.COMPLETED) {
        Logger.info("Episode ended (already tracked)");
        showCompletionOnce();
        return;
      }

      if (trackingState !== TrackingState.IDLE) return;
      trackingState = TrackingState.TRACKING;

      const alreadyTracked = await ProgressTracker.isEpisodeTracked(animeInfo.uniqueId);
      if (!alreadyTracked) {
        try {
          await ProgressTracker.saveWatchedEpisode(animeInfo, videoElement.duration);
          await ProgressTracker.clearSavedProgress(animeInfo.uniqueId);
          trackingState = TrackingState.COMPLETED;
          maybePromptBacklog();
        } catch (error) {
          Logger.error("End track failed", error);
          trackingState = TrackingState.IDLE;
        }
      } else {
        trackingState = TrackingState.COMPLETED;
        try {
          const refreshed = await ProgressTracker.refreshTrackedEpisodeDuration(animeInfo, videoElement.duration);
          if (refreshed) await ProgressTracker.clearSavedProgress(animeInfo.uniqueId);
        } catch (error) {
          Logger.warn(`Failed to refresh duration on end: ${error?.message}`);
        }
        Logger.info("Episode ended (was tracked before)");
        showCompletionOnce();
      }
    }
  };

  const handleVisibilityChange = async () => {
    const { Logger, ProgressTracker, VideoMonitor, CONFIG } = AT;
    const videoElement = VideoMonitor.getVideoElement();

    if (document.hidden && animeInfo && trackingState === TrackingState.IDLE && videoElement && videoElement.currentTime > 0) {
      const duration = videoElement.duration;
      const currentTime = videoElement.currentTime;

      if (ProgressTracker.shouldMarkComplete(currentTime, duration, cachedOutroStartSec)) {
        if (shouldBlockCompletion(currentTime, duration)) {
          const minWatch = CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
          Logger.debug(
            `Visibility change: only ${Math.round(accumulatedPlaybackSeconds)}s of real playback (need ${minWatch}s), saving progress instead`,
          );
          ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration, true, true);
          requestProgressSync();
          return;
        }
        trackingState = TrackingState.TRACKING;
        const alreadyTracked = await ProgressTracker.isEpisodeTracked(animeInfo.uniqueId);
        if (!alreadyTracked) {
          try {
            await ProgressTracker.saveWatchedEpisode(animeInfo, duration);
            await ProgressTracker.clearSavedProgress(animeInfo.uniqueId);
            trackingState = TrackingState.COMPLETED;
            Logger.success("Auto-tracked on visibility change");
            maybePromptBacklog();
          } catch (error) {
            Logger.error("Auto-track failed on visibility change", error);
            trackingState = TrackingState.IDLE;
          }
        } else {
          trackingState = TrackingState.COMPLETED;
          try {
            const refreshed = await ProgressTracker.refreshTrackedEpisodeDuration(animeInfo, duration);
            if (refreshed) await ProgressTracker.clearSavedProgress(animeInfo.uniqueId);
          } catch (error) {
            Logger.warn("Failed to refresh duration on visibility change:", error);
          }
        }
      } else {
        ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration, true, true);
        requestProgressSync();
      }
    }
  };

  const handleBeforeUnload = () => {
    const { Logger, ProgressTracker, VideoMonitor, CONFIG } = AT;
    const videoElement = VideoMonitor.getVideoElement();

    if (!animeInfo || !videoElement || videoElement.currentTime <= 0) return;

    const duration = videoElement.duration;
    const currentTime = videoElement.currentTime;

    if (ProgressTracker.shouldMarkComplete(currentTime, duration, cachedOutroStartSec)) {
      if (trackingState === TrackingState.COMPLETED) return;

      if (shouldBlockCompletion(currentTime, duration)) {
        ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration, true, true);
        return;
      }

      trackingState = TrackingState.COMPLETED;

      try {
        ProgressTracker.saveWatchedEpisode(animeInfo, duration).catch((e) => window.__atSwallow("saveWatchedEpisode", e));
      } catch {}
      try {
        chrome.runtime.sendMessage(
          {
            type: "TRACK_BEFORE_UNLOAD",
            animeInfo: {
              animeSlug: animeInfo.animeSlug,
              animeTitle: animeInfo.animeTitle,
              episodeNumber: animeInfo.episodeNumber,
              secondEpisodeNumber: animeInfo.secondEpisodeNumber,
              isDoubleEpisode: animeInfo.isDoubleEpisode,
              uniqueId: animeInfo.uniqueId,
              totalEpisodes: animeInfo.totalEpisodes,
              mediaType: animeInfo.mediaType,
              releaseStatus: animeInfo.releaseStatus,
              siteAnimeId: animeInfo.siteAnimeId,
              coverImage: animeInfo.coverImage,
            },
            duration,
          },
          () => {
            void chrome.runtime.lastError;
          },
        );
      } catch {}

      try {
        chrome.runtime.sendMessage({ type: "SYNC_TO_FIREBASE_IMMEDIATE" }, () => {
          void chrome.runtime.lastError;
        });
      } catch {}
    } else {
      ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration, true, true);
      requestProgressSync(true);
    }
  };

  const eventHandlers = {
    handleTimeUpdate,
    handleTimeUpdateRaw,
    handleVideoMetadata,
    handlePause,
    handleSeeked,
    handleEnded,
    handleVisibilityChange,
    handleBeforeUnload,
  };

  const {
    getBaseSlug,
    clearHighlightStorageListener,
    highlightWatchedEpisodes,
    injectEpisodeBadgeStyles,
    decorateCurrentEpisode,
    highlightFillerEpisodes,
    bumpLatestEpisodeFromPage,
  } = AT.EpisodeHighlight;

  async function init() {
    const { Logger, AnimeParser, ProgressTracker, VideoMonitor, Notifications } = AT;
    Logger.debug("Init", window.location.pathname);

    VideoMonitor.cleanup();
    Notifications.cleanup();
    ProgressTracker.reset();
    clearHighlightStorageListener();

    trackingState = TrackingState.IDLE;
    currentEpisodeId = null;
    earlyTrackDone = false;
    durationRefreshAttempted = false;
    durationRefreshAttempts = 0;
    resetPlaybackAccumulator("init");
    lastVideoSource = "";

    animeInfo = AnimeParser.extractAnimeInfo();
    if (!animeInfo) {
      Logger.debug("No anime info found");
      return;
    }
    currentEpisodeId = animeInfo.uniqueId;
    loadOutroStartFor(animeInfo);
    bumpLatestEpisodeFromPage(animeInfo).catch((e) => window.__atSwallow("bumpLatestEpisode", e));

    const metadataInfo = {
      animeSlug: animeInfo.animeSlug,
      coverImage: animeInfo.coverImage || null,
      siteAnimeId: animeInfo.siteAnimeId || null,
      totalEpisodes: animeInfo.totalEpisodes,
      mediaType: animeInfo.mediaType || null,
      releaseStatus: animeInfo.releaseStatus || null,
    };
    const hasDetectedTotal =
      Number.isFinite(metadataInfo.totalEpisodes) && metadataInfo.totalEpisodes > 0 && metadataInfo.totalEpisodes < 10000;
    const detectedMediaType = globalThis.AnimeTrackerMediaType?.normalize(metadataInfo.mediaType) || null;

    if (metadataInfo.coverImage || hasDetectedTotal || metadataInfo.siteAnimeId || detectedMediaType || metadataInfo.releaseStatus) {
      void AT.Storage.mutate(["animeData", "groupCoverImages"], (data) => {
          const animeData = (data.animeData = data.animeData || {});
          const groupCoverImages = (data.groupCoverImages = data.groupCoverImages || {});
          const slug = metadataInfo.animeSlug;
          const updatedAt = new Date().toISOString();
          let changed = false;

          if (animeData[slug]) {
            if (!animeData[slug].coverImage && metadataInfo.coverImage) {
              animeData[slug].coverImage = metadataInfo.coverImage;
              changed = true;
            }
            if (metadataInfo.siteAnimeId && !animeData[slug].siteAnimeId) {
              animeData[slug].siteAnimeId = metadataInfo.siteAnimeId;
              changed = true;
            }
            if (hasDetectedTotal) {
              const existingMaxEpisode = Math.max(0, ...(animeData[slug].episodes || []).map((ep) => Number(ep.number) || 0));
              if (
                metadataInfo.totalEpisodes >= existingMaxEpisode &&
                (animeData[slug].totalEpisodes !== metadataInfo.totalEpisodes || animeData[slug].totalEpisodesSource !== "an1me")
              ) {
                animeData[slug].totalEpisodes = metadataInfo.totalEpisodes;
                animeData[slug].totalEpisodesUpdatedAt = updatedAt;
                animeData[slug].totalEpisodesSource = "an1me";
                changed = true;
              }
            }
            if (detectedMediaType && (animeData[slug].mediaType !== detectedMediaType || animeData[slug].mediaTypeSource !== "an1me")) {
              animeData[slug].mediaType = detectedMediaType;
              animeData[slug].mediaTypeUpdatedAt = updatedAt;
              animeData[slug].mediaTypeSource = "an1me";
              changed = true;
            }
            if (
              metadataInfo.releaseStatus &&
              (animeData[slug].releaseStatus !== metadataInfo.releaseStatus || animeData[slug].releaseStatusSource !== "an1me")
            ) {
              animeData[slug].releaseStatus = metadataInfo.releaseStatus;
              animeData[slug].releaseStatusUpdatedAt = updatedAt;
              animeData[slug].releaseStatusSource = "an1me";
              changed = true;
            }
          }

          try {
            const baseSlug = getBaseSlug(slug);
            if (metadataInfo.coverImage && !groupCoverImages[baseSlug]) {
              groupCoverImages[baseSlug] = metadataInfo.coverImage;
              changed = true;
            }
          } catch {}
          if (!changed) return false;
        }).catch((e) => Logger.warn(`Cover image update failed: ${e?.message}`));
    }

    Logger.debug(`Detected: ${animeInfo.animeTitle} Ep${animeInfo.episodeNumber}`);

    try {
      const skipResult = await chrome.storage.local.get(["autoSkipFillers", FILLER_STAY_SELECTIONS_KEY]);
      if (skipResult.autoSkipFillers === true) {
        const stayedFillers = normalizeStayedFillers(skipResult[FILLER_STAY_SELECTIONS_KEY] || {});
        const stayedEpisodes = stayedFillers[String(animeInfo.animeSlug).toLowerCase()] || [];
        const fillerResponse = await chrome.runtime.sendMessage({ type: "GET_FILLER_EPISODES", animeSlug: animeInfo.animeSlug });
        const fillerEpisodes = fillerResponse?.fillers;
        if (Array.isArray(fillerEpisodes) && fillerEpisodes.includes(animeInfo.episodeNumber)) {
          if (stayedEpisodes.includes(animeInfo.episodeNumber)) {
            Logger.info(`Filler stay remembered for Ep ${animeInfo.episodeNumber}; auto-skip suppressed`);
          } else {
            let nextCanon = animeInfo.episodeNumber + 1;
            const maxSearch = animeInfo.totalEpisodes || 9999;
            while (fillerEpisodes.includes(nextCanon) && nextCanon <= maxSearch) nextCanon++;
            if (nextCanon <= maxSearch) {
              Logger.info(`⏭ Filler detected (Ep ${animeInfo.episodeNumber}), skipping to Ep ${nextCanon}`);

              let cancelled = false;
              const skipDelayMs = 4500;
              try {
                const toast = document.createElement("div");
                Object.assign(toast.style, {
                  position: "fixed",
                  top: "22px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: "2147483647",
                  width: "min(620px, calc(100vw - 28px))",
                  padding: "18px 20px",
                  borderRadius: "20px",
                  fontSize: "15px",
                  fontWeight: "700",
                  color: "#f7f7ff",
                  background: "linear-gradient(180deg, rgba(28,29,44,0.97), rgba(20,21,34,0.98))",
                  backdropFilter: "blur(16px)",
                  boxShadow: "0 18px 45px rgba(0,0,0,0.42)",
                  fontFamily: "system-ui, sans-serif",
                  border: "1px solid rgba(140,160,255,0.18)",
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  flexWrap: "wrap",
                  transition: "opacity 200ms ease, transform 200ms ease",
                });
                const text = document.createElement("div");
                text.style.flex = "1";
                text.style.minWidth = "0";
                const kicker = document.createElement("div");
                kicker.style.cssText = "font-size:11px;font-weight:800;letter-spacing:.12em;color:#8eb5ff;margin-bottom:4px;";
                kicker.textContent = "AUTO SKIP FILLER";
                const headline = document.createElement("div");
                headline.style.cssText = "font-size:24px;line-height:1.1;font-weight:800;color:#fff;";
                headline.textContent = `Episode ${animeInfo.episodeNumber} is filler`;
                const subline = document.createElement("div");
                subline.style.cssText = "margin-top:6px;font-size:14px;line-height:1.45;color:rgba(235,238,255,0.84);";
                subline.textContent = `Jumping to canon Episode ${nextCanon} soon unless you stay here.`;
                text.append(kicker, headline, subline);
                const actionWrap = document.createElement("div");
                Object.assign(actionWrap.style, {
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  flexShrink: "0",
                  marginLeft: "auto",
                });
                const skipBtn = document.createElement("button");
                skipBtn.textContent = "Skip Now";
                Object.assign(skipBtn.style, {
                  padding: "11px 16px",
                  border: "none",
                  borderRadius: "12px",
                  background: "linear-gradient(135deg, #6ea8ff, #8f7dff)",
                  color: "#0f1320",
                  fontWeight: "800",
                  cursor: "pointer",
                  fontSize: "13px",
                  whiteSpace: "nowrap",
                  boxShadow: "0 8px 20px rgba(110,168,255,0.28)",
                });
                const cancelBtn = document.createElement("button");
                cancelBtn.textContent = "Stay Here";
                Object.assign(cancelBtn.style, {
                  padding: "11px 16px",
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#fff",
                  borderRadius: "12px",
                  fontWeight: "800",
                  cursor: "pointer",
                  fontSize: "13px",
                  whiteSpace: "nowrap",
                });
                cancelBtn.addEventListener("click", () => {
                  cancelled = true;
                  void rememberStayedFillerEpisode(animeInfo.animeSlug, animeInfo.episodeNumber);
                  try {
                    toast.remove();
                  } catch {}
                });
                skipBtn.addEventListener("click", () => {
                  cancelled = false;
                  window.location.href = `https://an1me.to/watch/${animeInfo.animeSlug}-episode-${nextCanon}`;
                });
                toast.appendChild(text);
                actionWrap.appendChild(skipBtn);
                actionWrap.appendChild(cancelBtn);
                toast.appendChild(actionWrap);
                document.body.appendChild(toast);

                window.addEventListener(
                  "beforeunload",
                  () => {
                    cancelled = true;
                  },
                  { once: true },
                );
              } catch {}
              setTimeout(() => {
                if (cancelled) {
                  Logger.info(`Filler skip cancelled for Ep ${animeInfo.episodeNumber}`);
                  return;
                }
                window.location.href = `https://an1me.to/watch/${animeInfo.animeSlug}-episode-${nextCanon}`;
              }, skipDelayMs);
              return;
            }
            Logger.info(`⏭ Filler detected (Ep ${animeInfo.episodeNumber}) but no more canon episodes found`);
          }
        }
      }
    } catch (e) {
      Logger.warn(`Auto-skip filler check failed: ${e?.message}`);
    }

    highlightWatchedEpisodes(animeInfo.animeSlug);
    highlightFillerEpisodes(animeInfo.animeSlug, animeInfo.animeTitle);
    injectEpisodeBadgeStyles();
    decorateCurrentEpisode();

    const alreadyTracked = await ProgressTracker.isEpisodeTracked(animeInfo.uniqueId);
    if (alreadyTracked) {
      trackingState = TrackingState.COMPLETED;
      Logger.debug("Already tracked (monitoring metadata for duration refresh)");
    }

    VideoMonitor.startWatching(animeInfo, eventHandlers);

    try {
      setupServerSwitchObserver();
    } catch (err) {
      Logger.warn("setupServerSwitchObserver failed:", err);
    }

    try {
      maybeFallbackInvalidActiveServer();
    } catch (err) {
      Logger.warn("maybeFallbackInvalidActiveServer failed:", err);
    }

    try {
      const result = await chrome.storage.local.get(["auto4kServerEnabled"]);
      const enabled = result.auto4kServerEnabled !== false;
      if (enabled) maybeAutoSelect4kServer();
    } catch (err) {
      Logger.warn("Auto-4k setting read failed (defaulting ON):", err);
    }

    const periodicCheck = setInterval(() => {
      if (trackingState === TrackingState.COMPLETED || !animeInfo) {
        clearInterval(periodicCheck);
        return;
      }
      const videoElement = VideoMonitor.getVideoElement();
      if (videoElement && videoElement.duration > 0) {
        const currentTime = videoElement.currentTime;
        const duration = videoElement.duration;
        if (ProgressTracker.shouldMarkComplete(currentTime, duration, cachedOutroStartSec)) {
          const minWatch = AT.CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
          if (accumulatedPlaybackSeconds >= minWatch) {
            Logger.info("Periodic check: threshold reached, tracking");
            clearInterval(periodicCheck);
            trackImmediately();
          }
        }
      }
    }, 5000);

    const periodicCheckTimeout = setTimeout(() => clearInterval(periodicCheck), 30 * 60 * 1000);
    VideoMonitor.addCleanup(() => {
      clearInterval(periodicCheck);
      clearTimeout(periodicCheckTimeout);
    });
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(init, AT.CONFIG.DELAYS.INIT);
    });
  else setTimeout(init, AT.CONFIG.DELAYS.INIT);

  let lastUrl = location.href;
  let navigationDebounceTimeout = null;
  let historyPatched = false;

  const _SERVER_SWITCH_REBIND_DELAY_MS = 700;

  function isValidEmbedPayload(span) {
    const enc = span?.getAttribute?.("data-embed-id") || "";
    const idx = enc.indexOf(":");
    if (idx < 0) return false;
    let html = "";
    try {
      html = atob(enc.slice(idx + 1));
    } catch {
      return false;
    }
    if (!html) return false;
    if (/<div\s+class\s*=\s*["']?error["']?/i.test(html)) return false;
    if (/invalid\s+video\s+url/i.test(html)) return false;
    const m = html.match(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
    if (!m) return false;
    const src = (m[1] || "").trim();
    if (!src) return false;
    if (/^about:blank$/i.test(src)) return false;
    return true;
  }

  function findFirstValidAlternative(container, except) {
    const spans = Array.from(container.querySelectorAll("[data-embed-id]"));
    for (const s of spans) {
      if (s === except) continue;
      if (/4k/i.test(s.textContent || "")) continue;
      if (!isValidEmbedPayload(s)) continue;
      return s;
    }
    for (const s of spans) {
      if (s === except) continue;
      if (!isValidEmbedPayload(s)) continue;
      return s;
    }
    return null;
  }

  function setupServerSwitchObserver() {
    const { Logger, ProgressTracker, VideoMonitor } = AT;

    const handleServerClick = (e) => {
      const span = e.target?.closest?.(".player-selection [data-embed-id]");
      if (!span) return;
      if (span.classList.contains("active")) return;
      if (!animeInfo) return;

      const v = VideoMonitor.getVideoElement?.();
      const switchTime = v && v.currentTime > 0 && v.duration > 0 ? v.currentTime : 0;
      if (switchTime > 0) {
        try {
          ProgressTracker.saveVideoProgress(animeInfo.uniqueId, switchTime, v.duration, true, true);
        } catch (err) {
          Logger.warn("Server switch: urgent save failed:", err);
        }
      }

      VideoMonitor.armSilentResume(animeInfo.uniqueId, switchTime);
      Logger.info("Server switch detected — re-binding video monitor");

      setTimeout(() => {
        try {
          VideoMonitor.rebindAfterServerSwitch(animeInfo, eventHandlers);
        } catch (err) {
          Logger.warn("rebindAfterServerSwitch failed:", err);
        }
      }, _SERVER_SWITCH_REBIND_DELAY_MS);
    };

    document.addEventListener("click", handleServerClick, { capture: true, passive: true });
    VideoMonitor.addCleanup(() => {
      document.removeEventListener("click", handleServerClick, { capture: true });
    });
  }

  function runServerSelectionWatcher(guardSetKey, worker) {
    const { Logger, CONFIG } = AT;
    if (!animeInfo) return;

    const guard = (window[guardSetKey] = window[guardSetKey] || new Set());
    if (guard.has(animeInfo.uniqueId)) return;

    let triggered = false;
    let pollTimer = null;
    let mo = null;
    let killTimer = null;

    const cleanup = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (mo) {
        try {
          mo.disconnect();
        } catch {}
        mo = null;
      }
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
    };

    const markDone = () => {
      triggered = true;
      guard.add(animeInfo.uniqueId);
    };

    const run = () => {
      if (triggered) return true;
      for (const container of document.querySelectorAll(CONFIG.SELECTORS.PLAYER_SELECTION)) {
        if (container.offsetParent === null) continue;
        const active = container.querySelector(CONFIG.SELECTORS.ACTIVE_EMBED);
        if (!active) continue;
        if (worker(container, active, markDone, Logger)) return true;
      }
      return false;
    };

    if (run()) return;

    pollTimer = setInterval(() => {
      if (run()) cleanup();
    }, CONFIG.DELAYS.SERVER_WATCH_POLL);

    let moThrottle = null;
    mo = new MutationObserver(() => {
      if (moThrottle) return;
      moThrottle = setTimeout(() => {
        moThrottle = null;
        if (!mo) return;
        if (run()) cleanup();
      }, CONFIG.DELAYS.SERVER_WATCH_MO_DEBOUNCE);
    });
    try {
      mo.observe(document.body, { childList: true, subtree: true });
    } catch {}

    killTimer = setTimeout(cleanup, CONFIG.DELAYS.SERVER_WATCH_KILL);

    AT.VideoMonitor.addCleanup(cleanup);
  }

  function maybeAutoSelect4kServer() {
    runServerSelectionWatcher("__atAuto4kClickedFor", (container, activeSpan, markDone, Logger) => {
      const spans = container.querySelectorAll(AT.CONFIG.SELECTORS.EMBED);
      let fourK = null;
      for (const s of spans) {
        if (/4k/i.test(s.textContent || "")) {
          fourK = s;
          break;
        }
      }
      if (!fourK) return false;

      if (!isValidEmbedPayload(fourK)) {
        markDone();
        Logger.debug("Auto-4k: 4k chip present but payload invalid — skipping");
        return true;
      }

      if (fourK === activeSpan) {
        markDone();
        Logger.debug("Auto-4k: 4k server is already active");
        return true;
      }

      try {
        fourK.click();
        markDone();
        Logger.info(`Auto-4k: clicked "${(fourK.textContent || "").trim()}"`);
      } catch (err) {
        Logger.warn("Auto-4k click failed:", err);
      }
      return true;
    });
  }

  function maybeFallbackInvalidActiveServer() {
    runServerSelectionWatcher("__atFallbackDoneFor", (container, active, markDone, Logger) => {
      if (isValidEmbedPayload(active)) return false;

      const replacement = findFirstValidAlternative(container, active);
      if (!replacement) {
        Logger.warn("Active server invalid but no valid alternative in this row");
        return false;
      }

      try {
        replacement.click();
        markDone();
        Logger.info(`Active server invalid — fell back to "${(replacement.textContent || "").trim()}"`);
      } catch (err) {
        Logger.warn("Invalid-server fallback click failed:", err);
      }
      return true;
    });
  }

  const setupNavigationObserver = () => {
    const { Logger, ProgressTracker, VideoMonitor } = AT;

    // Patched once for the document lifetime — intentionally NOT tied to VideoMonitor.cleanup() (runs each init), or SPA re-init would die after the first episode.
    if (!historyPatched && !window.__atHistoryPatched) {
      historyPatched = true;
      window.__atHistoryPatched = true;
      const dispatchUrlChange = () => {
        try {
          window.dispatchEvent(new Event("at:locationchange"));
        } catch {}
      };
      const origPush = history.pushState;
      const origReplace = history.replaceState;
      history.pushState = function (...args) {
        const ret = origPush.apply(this, args);
        dispatchUrlChange();
        return ret;
      };
      history.replaceState = function (...args) {
        const ret = origReplace.apply(this, args);
        dispatchUrlChange();
        return ret;
      };
      window.addEventListener("popstate", dispatchUrlChange);
    }

    const _pathOf = (href) => {
      try {
        return new URL(href, location.origin).pathname;
      } catch {
        return href;
      }
    };
    const _isWatchPath = (href) => /\/watch\//.test(_pathOf(href));

    const handleUrlChange = () => {
      const prevPath = _pathOf(lastUrl);
      const currPath = _pathOf(location.href);
      if (prevPath === currPath) return;
      const previousUrl = lastUrl;
      lastUrl = location.href;

      if (_isWatchPath(previousUrl)) {
        trackImmediately();
      }

      if (!_isWatchPath(location.href)) return;

      if (navigationDebounceTimeout) clearTimeout(navigationDebounceTimeout);
      navigationDebounceTimeout = setTimeout(() => {
        if (_pathOf(location.href) === currPath) {
          Logger.info("URL changed, reinit...");
          trackingState = TrackingState.IDLE;
          currentEpisodeId = null;
          earlyTrackDone = false;
          durationRefreshAttempted = false;
          durationRefreshAttempts = 0;
          resetPlaybackAccumulator("spa navigation");
          lastVideoSource = "";
          clearHighlightStorageListener();
          ProgressTracker.reset();
          setTimeout(init, AT.CONFIG.DELAYS.INIT);
        }
      }, 200);
    };
    window.addEventListener("at:locationchange", handleUrlChange);

    document.addEventListener(
      "click",
      (e) => {
        const target = e.target.closest(
          "[data-open-nav-episode], .episode-navigation, .next-episode, .prev-episode, .episode-list-item, a, button",
        );
        if (!target) return;

        const isAn1meNav =
          target.hasAttribute("data-open-nav-episode") ||
          target.classList.contains("episode-navigation") ||
          target.classList.contains("next-episode") ||
          target.classList.contains("prev-episode") ||
          target.classList.contains("episode-list-item") ||
          target.closest("[data-open-nav-episode]") ||
          target.closest(".episode-navigation");

        if (isAn1meNav) {
          Logger.debug("An1me.to navigation detected, tracking immediately");
          trackImmediately();
          return;
        }

        const link = e.target.closest("a[href]");
        if (link && link.href && link.href !== location.href) {
          trackImmediately();
          return;
        }

        const href = target.getAttribute("href") || "";
        const text = (target.textContent || "").toLowerCase();
        const className = (target.className || "").toLowerCase();

        const isNavigation =
          href.includes("/watch/") ||
          href.includes("episode") ||
          text.includes("next") ||
          text.includes("previous") ||
          text.includes("prev") ||
          className.includes("next") ||
          className.includes("prev") ||
          className.includes("episode");

        if (isNavigation) {
          Logger.debug("Navigation click detected, tracking immediately");
          trackImmediately();
        }
      },
      { capture: true, passive: true },
    );

    VideoMonitor.addCleanup(() => {
      if (navigationDebounceTimeout) {
        clearTimeout(navigationDebounceTimeout);
        navigationDebounceTimeout = null;
      }
    });
  };

  setupNavigationObserver();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "GET_CURRENT_WATCH_INFO") return false;
    try {
      const info = animeInfo || AnimeParser.extractAnimeInfo({ silent: true });
      if (info && info.animeSlug) {
        sendResponse({
          slug: info.animeSlug,
          title: info.animeTitle || null,
          episode: info.episodeNumber || null,
          secondEpisode: info.secondEpisodeNumber || null,
          totalEpisodes: info.totalEpisodes || null,
          mediaType: info.mediaType || null,
          releaseStatus: info.releaseStatus || null,
          coverImage: info.coverImage || null,
          link: info.url || window.location.href,
        });
      } else {
        sendResponse(null);
      }
    } catch {
      sendResponse(null);
    }
    return true;
  });
})();
