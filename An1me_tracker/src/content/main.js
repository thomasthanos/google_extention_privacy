(function () {
    'use strict';

    if (window.self !== window.top) return;

    const AT = window.AnimeTrackerContent;
    const FILLER_STAY_SELECTIONS_KEY = 'fillerStaySelections';

    const TrackingState = { IDLE: 'idle', TRACKING: 'tracking', COMPLETED: 'completed' };
    let trackingState = TrackingState.IDLE;
    let animeInfo = null;
    let currentEpisodeId = null;
    let durationRefreshAttempted = false;
    let durationRefreshAttempts = 0;
    const MAX_DURATION_REFRESH_ATTEMPTS = 5;
    let accumulatedPlaybackSeconds = 0;
    let lastTimeupdateTime = 0;
    let lastVideoSource = '';
    let earlyTrackDone = false;



    let completionNotificationShown = false;
    function showCompletionOnce() {
        if (completionNotificationShown) return;
        completionNotificationShown = true;
        AT.Notifications.showCompletion(animeInfo);
    }





    let cachedOutroStartSec = null;
    function parseSkipTime(text) {
        if (!text || typeof text !== 'string') return 0;
        const parts = text.trim().split(':').map(Number);
        if (parts.some(Number.isNaN)) return 0;
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        return 0;
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
                if (sec > 0) { cachedOutroStartSec = sec; return; }
            }
        } catch {                               }




        try {
            const video = AT.VideoMonitor?.getVideoElement?.();
            const len = (video?.duration && Number.isFinite(video.duration)) ? Math.round(video.duration) : 0;
            const resp = await new Promise((resolve) => {
                try {
                    chrome.runtime.sendMessage({
                        type: 'GET_OUTRO_START',
                        animeSlug: info.animeSlug,
                        animeTitle: info.animeTitle || null,
                        episodeNumber: epNum,
                        episodeLength: len
                    }, (r) => {
                        if (chrome.runtime.lastError) { resolve(null); return; }
                        resolve(r || null);
                    });
                } catch { resolve(null); }
            });
            const sec = Number(resp?.outroStart) || 0;
            if (sec > 0) cachedOutroStartSec = sec;
        } catch {                                                         }
    }


    window.AnimeTrackerContent = window.AnimeTrackerContent || {};
    window.AnimeTrackerContent.getCachedOutroStartSec = () => cachedOutroStartSec;

    function normalizeStayedFillers(rawSelections) {
        if (!rawSelections || typeof rawSelections !== 'object') return {};

        const normalized = {};
        for (const [slug, values] of Object.entries(rawSelections)) {
            if (!slug) continue;

            const episodes = Array.isArray(values) ? values : Object.keys(values || {});
            const cleaned = [...new Set(
                episodes
                    .map((ep) => Number(ep))
                    .filter((ep) => Number.isInteger(ep) && ep > 0)
            )].sort((a, b) => a - b);

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
            const result = await Storage.get([FILLER_STAY_SELECTIONS_KEY]);
            if (result?.__timedOut) {
                Logger.warn('Skip rememberStayedFillerEpisode: storage read timed out');
                return;
            }
            const selections = normalizeStayedFillers(result?.[FILLER_STAY_SELECTIONS_KEY] || {});
            const key = String(slug).toLowerCase();
            const nextEpisodes = new Set(selections[key] || []);
            nextEpisodes.add(Number(episodeNumber));
            selections[key] = [...nextEpisodes].sort((a, b) => a - b);
            await Storage.set({ [FILLER_STAY_SELECTIONS_KEY]: selections });
            Logger.debug(`Remembered filler stay for ${key} Ep ${episodeNumber}`);
        } catch (error) {
            Logger.warn('Failed to remember filler stay selection:', error);
        }
    }

    async function clearStayedFillerEpisode(slug, episodeNumber) {
        const { Storage, Logger } = AT;
        if (!slug || !Number.isInteger(Number(episodeNumber))) return;

        try {
            const result = await Storage.get([FILLER_STAY_SELECTIONS_KEY]);
            if (result?.__timedOut) {
                Logger.warn('Skip clearStayedFillerEpisode: storage read timed out');
                return;
            }
            const selections = normalizeStayedFillers(result?.[FILLER_STAY_SELECTIONS_KEY] || {});
            const key = String(slug).toLowerCase();
            const current = selections[key];
            if (!Array.isArray(current) || current.length === 0) return;

            const nextEpisodes = current.filter((ep) => ep !== Number(episodeNumber));
            if (nextEpisodes.length > 0) {
                selections[key] = nextEpisodes;
            } else {
                delete selections[key];
            }

            await Storage.set({ [FILLER_STAY_SELECTIONS_KEY]: selections });
            Logger.debug(`Cleared filler stay for ${key} Ep ${episodeNumber}`);
        } catch (error) {
            Logger.warn('Failed to clear filler stay selection:', error);
        }
    }

    function resetPlaybackAccumulator(reason = '') {
        if (reason && AT?.Logger) AT.Logger.debug(`Reset playback accumulator: ${reason}`);
        accumulatedPlaybackSeconds = 0;
        lastTimeupdateTime = 0;
    }

    function resetEpisodeTrackingState(reason = '') {
        resetPlaybackAccumulator(reason);
        earlyTrackDone = false;
        trackingState = TrackingState.IDLE;
        durationRefreshAttempted = false;
        durationRefreshAttempts = 0;
        completionNotificationShown = false;
    }

    function syncVideoSourceEpisodeBoundary(videoElement) {
        const src = (videoElement?.currentSrc || videoElement?.src || '').trim();
        if (!src) return false;
        if (!lastVideoSource) { lastVideoSource = src; return false; }
        if (src === lastVideoSource) return false;
        lastVideoSource = src;




        if (currentEpisodeId && animeInfo && currentEpisodeId !== animeInfo.uniqueId) {
            resetEpisodeTrackingState('episode id changed via video source');
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
            const mutateResult = await Storage.mutate(['animeData', 'deletedAnime'], (data) => {
                const ad = data.animeData = data.animeData || {};
                const del = data.deletedAnime = data.deletedAnime || {};
                written = writeSyncEpisode(animeInfo, duration, ad, 'Immediate');
                if (written) delete del[animeInfo.animeSlug];
                animeData = ad;
            });
            if (mutateResult?.__timedOut) {
                Logger.warn('Immediate track skipped: storage read timed out');
                trackingState = TrackingState.IDLE;
                earlyTrackDone = false;
                return;
            }

            if (written) {
                await clearStayedFillerEpisode(animeInfo.animeSlug, animeInfo.episodeNumber);
                trackingState = TrackingState.COMPLETED;
                Logger.success('✓ Immediate track successful');
                showCompletionOnce();

                try {
                    const { WatchlistSync } = AT;
                    const slug = animeInfo.animeSlug;
                    const entry = animeData[slug];
                    const siteId = entry?.siteAnimeId || animeInfo.siteAnimeId;
                    if (WatchlistSync && siteId) {
                        WatchlistSync.syncFromStorage(siteId, slug, {
                            fallbackType: 'watching',
                            keepFirstEpisodeAsPlanToWatch: true
                        });
                    }
                } catch { }

                try {
                    const progressResult = await Storage.get(['videoProgress']);
                    if (progressResult?.__timedOut) return;
                    const videoProgress = progressResult.videoProgress || {};
                    delete videoProgress[animeInfo.uniqueId];
                    await Storage.set({ videoProgress });
                } catch { }
            } else {
                trackingState = TrackingState.COMPLETED;
            }
        } catch (e) {




            trackingState = TrackingState.IDLE;
            earlyTrackDone = false;
            if (e?.message?.includes('Extension context invalidated') || !Storage.isContextValid()) {
                Logger.debug('Immediate track aborted: extension context invalidated');
                return;
            }
            Logger.error('Immediate track failed:', e);
        }
    }

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => { clearTimeout(timeout); func(...args); };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    async function tryRefreshTrackedDuration(videoElement, reason = 'metadata') {
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
            await tryRefreshTrackedDuration(videoElement, 'timeupdate');
        }






        if (ProgressTracker.shouldMarkComplete(currentTime, duration, cachedOutroStartSec)) {
            if (shouldBlockCompletion(currentTime, duration)) {
                const minWatch = CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
                Logger.throttled('block-completion-raw', 'DEBUG', 10000, `Threshold reached but only ${Math.round(accumulatedPlaybackSeconds)}s of real playback (need ${minWatch}s), waiting...`);
                return;
            }
            earlyTrackDone = true;
            Logger.info('Threshold reached, tracking immediately (no debounce)');
            trackImmediately();
        }
    };

    const handleVideoMetadata = async () => {
        const { VideoMonitor } = AT;
        const videoElement = VideoMonitor.getVideoElement();
        await tryRefreshTrackedDuration(videoElement, 'loadedmetadata');



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
            Logger.info('Episode changed, resetting tracking state');
            resetEpisodeTrackingState('episode id changed');
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
                Logger.throttled('block-completion-debounced', 'DEBUG', 10000, `Debounced: threshold reached but only ${Math.round(accumulatedPlaybackSeconds)}s of real playback (need ${minWatch}s), waiting...`);
                return;
            }

            const remainingTime = Math.round(duration - currentTime);
            const progress = Math.round((currentTime / duration) * 100);
            const durationMins = Math.floor(duration / 60);
            const durationSecs = Math.floor(duration % 60);
            Logger.info(`Marking complete: ${progress}% watched (need ${CONFIG.COMPLETED_PERCENTAGE}%), ${remainingTime}s remaining of ${durationMins}:${String(durationSecs).padStart(2, '0')}`);

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

            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('handleTimeUpdate timeout')), 10000));

            try {
                await Promise.race([trackingOperation(), timeoutPromise]);
                Logger.success('Auto-tracked on timeupdate');
            } catch (error) {
                if (error.message === 'handleTimeUpdate timeout') Logger.warn('Tracking operation timed out, will retry');
                else Logger.error('Track failed', error);
                trackingState = TrackingState.IDLE;
            } finally {
                if (trackingState === TrackingState.TRACKING) trackingState = TrackingState.COMPLETED;
            }
        }
    }, AT.CONFIG.DEBOUNCE_DELAY);

    const handlePause = () => {
        const { ProgressTracker, VideoMonitor } = AT;
        const videoElement = VideoMonitor.getVideoElement();
        if (animeInfo && trackingState !== TrackingState.COMPLETED && videoElement && videoElement.currentTime > 0) {
            ProgressTracker.saveVideoProgress(animeInfo.uniqueId, videoElement.currentTime, videoElement.duration, true, false);
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




            if (trackingState !== TrackingState.COMPLETED
                && shouldBlockCompletion(currentTime, duration)) {
                const minWatch = CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
                Logger.debug(`Video ended but only ${Math.round(accumulatedPlaybackSeconds)}s of real playback (need ${minWatch}s), not tracking`);
                return;
            }
            if (trackingState === TrackingState.COMPLETED) {
                Logger.info('Episode ended (already tracked)');
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
                } catch (error) {
                    Logger.error('End track failed', error);
                    trackingState = TrackingState.IDLE;
                }
            } else {
                trackingState = TrackingState.COMPLETED;
                try {
                    const refreshed = await ProgressTracker.refreshTrackedEpisodeDuration(animeInfo, videoElement.duration);
                    if (refreshed) await ProgressTracker.clearSavedProgress(animeInfo.uniqueId);
                } catch (error) { Logger.warn(`Failed to refresh duration on end: ${error?.message}`); }
                Logger.info('Episode ended (was tracked before)');
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
                    Logger.debug(`Visibility change: only ${Math.round(accumulatedPlaybackSeconds)}s of real playback (need ${minWatch}s), saving progress instead`);
                    ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration, true, true);
                    return;
                }
                trackingState = TrackingState.TRACKING;
                const alreadyTracked = await ProgressTracker.isEpisodeTracked(animeInfo.uniqueId);
                if (!alreadyTracked) {
                    try {
                        await ProgressTracker.saveWatchedEpisode(animeInfo, duration);
                        await ProgressTracker.clearSavedProgress(animeInfo.uniqueId);
                        trackingState = TrackingState.COMPLETED;
                        Logger.success('Auto-tracked on visibility change');
                    } catch (error) {
                        Logger.error('Auto-track failed on visibility change', error);
                        trackingState = TrackingState.IDLE;
                    }
                } else {
                    trackingState = TrackingState.COMPLETED;
                    try {
                        const refreshed = await ProgressTracker.refreshTrackedEpisodeDuration(animeInfo, duration);
                        if (refreshed) await ProgressTracker.clearSavedProgress(animeInfo.uniqueId);
                    } catch (error) { Logger.warn('Failed to refresh duration on visibility change:', error); }
                }
            } else {
                ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration, true, true);
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

            try { ProgressTracker.saveWatchedEpisode(animeInfo, duration).catch(() => { }); } catch { }
            try {
                chrome.runtime.sendMessage({
                    type: 'TRACK_BEFORE_UNLOAD',
                    animeInfo: {
                        animeSlug: animeInfo.animeSlug,
                        animeTitle: animeInfo.animeTitle,
                        episodeNumber: animeInfo.episodeNumber,
                        secondEpisodeNumber: animeInfo.secondEpisodeNumber,
                        isDoubleEpisode: animeInfo.isDoubleEpisode,
                        uniqueId: animeInfo.uniqueId,
                        totalEpisodes: animeInfo.totalEpisodes,
                        coverImage: animeInfo.coverImage
                    },
                    duration
                }, () => { void chrome.runtime.lastError; });
            } catch { }

            try {
                chrome.runtime.sendMessage({ type: 'SYNC_TO_FIREBASE_IMMEDIATE' }, () => { void chrome.runtime.lastError; });
            } catch { }
        } else {
            ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration, true, true);
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
        handleBeforeUnload
    };

    function getBaseSlug(slug) {
        if (!slug || typeof slug !== 'string') return slug || '';
        const lower = slug.toLowerCase();
        if (lower.startsWith('naruto')) return 'naruto';
        if (lower.startsWith('one-punch-man')) return 'one-punch-man';
        if (lower.startsWith('kimetsu-no-yaiba')) return 'kimetsu-no-yaiba';
        if (lower.startsWith('shingeki-no-kyojin')) return 'shingeki-no-kyojin';
        if (lower.startsWith('initial-d')) return 'initial-d';
        if (lower.startsWith('bleach')) return 'bleach';
        return lower
            .replace(/-season-?\d+(-[a-z-]+)?$/i, '')
            .replace(/-s\d+$/i, '')
            .replace(/-\d+(st|nd|rd|th)-season$/i, '')
            .replace(/-(part|cour)-?\d+(-[a-z-]+)?$/i, '')
            .replace(/-20\d{2}$/i, '')
            .replace(/-(ii|iii|iv|v|vi)$/i, '')
            .replace(/-[a-z]+-hen$/i, '');
    }

    let _highlightStorageListener = null;
    function clearHighlightStorageListener() {
        if (_highlightStorageListener) {
            try { chrome.storage.onChanged.removeListener(_highlightStorageListener); } catch { }
            _highlightStorageListener = null;
        }
    }

    function highlightWatchedEpisodes(slug) {
        const { Logger } = AT;
        clearHighlightStorageListener();
        injectEpisodeBadgeStyles();

        function applyHighlights(watchedSet) {
            const items = document.querySelectorAll('.episode-list-item[data-episode-search-query]');
            let highlighted = 0;
            for (const item of items) {
                const epNum = parseInt(item.getAttribute('data-episode-search-query'), 10);
                if (isNaN(epNum)) continue;
                if (watchedSet.has(epNum)) {
                    item.style.opacity = '';
                    item.style.color = '';
                    if (!item.classList.contains('at-watched-episode')) {
                        item.classList.add('at-watched-episode');
                        if (!item.querySelector('.at-watched-badge')) {
                            const badge = document.createElement('span');
                            badge.className = 'at-watched-badge';
                            badge.textContent = 'WATCHED';
                            item.appendChild(badge);
                        }
                    }
                    highlighted++;
                } else if (item.classList.contains('at-watched-episode')) {
                    item.classList.remove('at-watched-episode');
                    item.querySelector('.at-watched-badge')?.remove();
                }
            }
            return highlighted;
        }

        chrome.storage.local.get(['animeData'], (result) => {
            if (chrome.runtime.lastError || !result.animeData) return;
            const anime = result.animeData[slug];
            if (!anime?.episodes?.length) return;

            const watchedSet = new Set(anime.episodes.map(ep => Number(ep.number)));
            if (watchedSet.size === 0) return;

            const count = applyHighlights(watchedSet);
            if (count > 0) {
                Logger.debug(`Highlighted ${count} watched episodes in episode list`);
            } else {
                const container = document.querySelector('.episode-list-display-box');
                const target = container || document.body;
                let retryDebounce = null;
                const obs = new MutationObserver(() => {
                    if (retryDebounce) return;
                    retryDebounce = setTimeout(() => {
                        retryDebounce = null;
                        const retry = applyHighlights(watchedSet);
                        if (retry > 0) obs.disconnect();
                    }, 150);
                });
                obs.observe(target, { childList: true, subtree: true });
                setTimeout(() => { obs.disconnect(); if (retryDebounce) clearTimeout(retryDebounce); }, 10000);
            }
        });

        _highlightStorageListener = (changes) => {
            if (!changes.animeData) return;
            const newData = changes.animeData.newValue || {};
            const anime = newData[slug];
            if (!anime?.episodes?.length) return;
            const watchedSet = new Set(anime.episodes.map(ep => Number(ep.number)));
            applyHighlights(watchedSet);
        };
        chrome.storage.onChanged.addListener(_highlightStorageListener);
    }

    function injectEpisodeBadgeStyles() {
        if (document.querySelector('#anime-tracker-episode-styles')) return;

        let proxonUrl = '', comicSansUrl = '';
        try {
            proxonUrl = chrome.runtime.getURL('src/fonts/PROXON.ttf');
            comicSansUrl = chrome.runtime.getURL('src/fonts/comic_sans.ttf');
        } catch { }

        const style = document.createElement('style');
        style.id = 'anime-tracker-episode-styles';
        style.textContent = `
            @font-face { font-family: 'AT-PROXON'; src: url('${proxonUrl}') format('truetype'); font-weight: 400 900; font-display: swap; }
            @font-face { font-family: 'AT-ComicSans'; src: url('${comicSansUrl}') format('truetype'); font-weight: 400 900; font-display: swap; }
            .episode-list-item.at-watched-episode { border: 1px solid rgba(233, 171, 56, 0.22) !important; border-left: 3px solid #e9ab38 !important; border-radius: 4px !important; }
            .episode-list-item.at-watched-episode:not(.current-episode) { opacity: 0.78 !important; background: linear-gradient(90deg, rgba(233, 171, 56, 0.12), transparent 70%) !important; }
            .episode-list-item.at-watched-episode .episode-list-item-title, .episode-list-item.at-watched-episode .episode-list-item-number { color: #e9ab38 !important; }
            .episode-list-item.at-watched-episode .episode-list-item-title { font-family: 'AT-PROXON', inherit !important; letter-spacing: 0.3px !important; }
            .episode-list-item.at-watched-episode .episode-list-item-number { font-family: 'AT-ComicSans', inherit !important; }
            .episode-list-item.at-watched-episode .at-watched-badge { display: inline-block; margin-left: 6px; padding: 1px 6px; font-size: 10px; font-weight: 700; line-height: 1.2; color: #1a1a1a; background: linear-gradient(135deg, #f5c66e, #e9ab38); border-radius: 4px; letter-spacing: 0.3px; vertical-align: middle; box-shadow: 0 1px 2px rgba(0,0,0,0.25); }
            .episode-list-item.at-filler-episode { border: 1px solid rgba(168, 85, 247, 0.22) !important; border-left: 3px solid #a855f7 !important; border-radius: 4px !important; }
            .episode-list-item.at-filler-episode:not(.current-episode) { background: linear-gradient(90deg, rgba(168, 85, 247, 0.12), transparent 70%) !important; }
            .episode-list-item.at-filler-episode .at-filler-badge { display: inline-block; margin-left: 6px; padding: 1px 6px; font-size: 10px; font-weight: 700; line-height: 1.2; color: #fff; background: linear-gradient(135deg, #c084fc, #a855f7); border-radius: 4px; letter-spacing: 0.3px; vertical-align: middle; box-shadow: 0 1px 2px rgba(0,0,0,0.25); }
            .episode-list-item.at-watched-episode.at-filler-episode { border-left-color: #a855f7 !important; }
            .episode-head .episode-list-display-box .episode-list-item.current-episode, .episode-list-item.current-episode { color: inherit !important; }
            .episode-head .episode-list-display-box .episode-list-item.current-episode::after, .episode-list-item.current-episode::after,
            .episode-head .episode-list-display-box .episode-list-item.current-episode::before, .episode-list-item.current-episode::before { content: none !important; display: none !important; background-color: transparent !important; border: 0 !important; width: 0 !important; height: 0 !important; }
            .episode-list-item.current-episode { border: 1px solid rgba(79, 195, 247, 0.38) !important; border-left: 3px solid #4fc3f7 !important; border-radius: 4px !important; background: linear-gradient(90deg, rgba(79, 195, 247, 0.22), rgba(79, 195, 247, 0.05) 70%) !important; box-shadow: 0 0 0 1px rgba(79, 195, 247, 0.18), 0 2px 12px rgba(79, 195, 247, 0.15) !important; position: relative !important; }
            .episode-list-item.current-episode .episode-list-item-title { color: #e8f6ff !important; font-family: 'AT-PROXON', inherit !important; letter-spacing: 0.3px !important; font-weight: 600 !important; }
            .episode-list-item.current-episode .episode-list-item-number { color: #4fc3f7 !important; font-family: 'AT-ComicSans', inherit !important; font-weight: 700 !important; }
            .episode-list-item.current-episode .at-current-badge { display: inline-block; margin-left: 6px; padding: 1px 7px; font-size: 10px; font-weight: 700; line-height: 1.2; color: #0e1117; background: linear-gradient(135deg, #7dd3fc, #4fc3f7); border-radius: 4px; letter-spacing: 0.5px; vertical-align: middle; box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 0 8px rgba(79, 195, 247, 0.45); text-transform: uppercase; animation: at-current-pulse 2.2s ease-in-out infinite; }
            @keyframes at-current-pulse { 0%, 100% { box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 0 8px rgba(79, 195, 247, 0.45); } 50% { box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 0 14px rgba(79, 195, 247, 0.75); } }
            .episode-list-item.current-episode.at-watched-episode, .episode-list-item.current-episode.at-filler-episode { border-left-color: #4fc3f7 !important; opacity: 1 !important; }
            @media (prefers-reduced-motion: reduce) {
                .episode-list-item.current-episode .at-current-badge { animation: none !important; }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
        decorateCurrentEpisode();
    }

    let _currentEpisodeObserver = null;
    let _currentEpisodeObserverTimeout = null;
    function decorateCurrentEpisode() {
        const apply = () => {
            document.querySelectorAll('.at-current-badge').forEach(badge => {
                const item = badge.closest('.episode-list-item');
                if (!item || !item.classList.contains('current-episode')) badge.remove();
            });
            const items = document.querySelectorAll('.episode-list-item.current-episode');
            items.forEach(item => {
                if (item.querySelector('.at-current-badge')) return;
                const badge = document.createElement('span');
                badge.className = 'at-current-badge';
                badge.textContent = 'NOW';
                item.appendChild(badge);
            });
        };
        apply();



        if (_currentEpisodeObserver) { try { _currentEpisodeObserver.disconnect(); } catch { } _currentEpisodeObserver = null; }
        if (_currentEpisodeObserverTimeout) { clearTimeout(_currentEpisodeObserverTimeout); _currentEpisodeObserverTimeout = null; }



        const target = document.querySelector('.episode-list-display-box')
            || document.querySelector('.episode-head')
            || document.body;
        let _applyDebounce = null;
        _currentEpisodeObserver = new MutationObserver(() => {
            if (_applyDebounce) return;
            _applyDebounce = setTimeout(() => { _applyDebounce = null; apply(); }, 150);
        });
        _currentEpisodeObserver.observe(target, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['class']
        });


        _currentEpisodeObserverTimeout = setTimeout(() => {
            try { _currentEpisodeObserver?.disconnect(); } catch { }
            _currentEpisodeObserver = null;
            _currentEpisodeObserverTimeout = null;
        }, 60000);
    }

    function highlightFillerEpisodes(slug, title) {
        const { Logger } = AT;
        if (!slug) return;

        try {
            chrome.runtime.sendMessage({ type: 'GET_FILLER_EPISODES', animeSlug: slug, animeTitle: title || null }, (response) => {
                if (chrome.runtime.lastError || !response?.fillers) return;
                const fillerSet = new Set(response.fillers.map(Number).filter(n => Number.isFinite(n)));
                if (fillerSet.size === 0) return;

                injectEpisodeBadgeStyles();

                const applyFiller = () => {
                    const items = document.querySelectorAll('.episode-list-item[data-episode-search-query]');
                    let tagged = 0;
                    for (const item of items) {
                        const epNum = parseInt(item.getAttribute('data-episode-search-query'), 10);
                        if (!Number.isFinite(epNum)) continue;
                        const isFiller = fillerSet.has(epNum);
                        if (isFiller && !item.classList.contains('at-filler-episode')) {
                            item.classList.add('at-filler-episode');
                            if (!item.querySelector('.at-filler-badge')) {
                                const badge = document.createElement('span');
                                badge.className = 'at-filler-badge';
                                badge.textContent = 'FILLER';
                                item.appendChild(badge);
                            }
                            tagged++;
                        } else if (!isFiller && item.classList.contains('at-filler-episode')) {
                            item.classList.remove('at-filler-episode');
                            item.querySelector('.at-filler-badge')?.remove();
                        }
                    }
                    return tagged;
                };

                if (applyFiller() === 0) {
                    const target = document.querySelector('.episode-list-display-box') || document.body;
                    let fillerRetryDebounce = null;
                    const obs = new MutationObserver(() => {
                        if (fillerRetryDebounce) return;
                        fillerRetryDebounce = setTimeout(() => {
                            fillerRetryDebounce = null;
                            if (applyFiller() > 0) obs.disconnect();
                        }, 150);
                    });
                    obs.observe(target, { childList: true, subtree: true });
                    setTimeout(() => {
                        obs.disconnect();
                        if (fillerRetryDebounce) clearTimeout(fillerRetryDebounce);
                    }, 10000);
                } else {
                    Logger.debug(`Tagged filler episodes for ${slug}`);
                }
            });
        } catch (e) { Logger.debug('Filler coloring failed:', e.message); }
    }

    function detectPageMaxEpisode(animeSlug, currentEpisodeNumber) {
        let pageMax = 0;
        try {
            const escaped = String(animeSlug || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (!escaped) return Number(currentEpisodeNumber) || 0;
            const hrefPattern = new RegExp(`/watch/${escaped}-episode-(\\d+)`, 'i');

            const grid = document.querySelector('#episodeGrid');
            if (grid) {
                const items = grid.querySelectorAll('a[data-search], a[href*="-episode-"]');
                for (const a of items) {
                    const ds = parseInt(a.getAttribute('data-search') || '', 10);
                    if (Number.isFinite(ds) && ds > pageMax) pageMax = ds;
                    const m = (a.getAttribute('href') || '').match(hrefPattern);
                    if (m) {
                        const n = parseInt(m[1], 10);
                        if (Number.isFinite(n) && n > pageMax) pageMax = n;
                    }
                }
            }

            const allLinks = document.querySelectorAll(`a[href*="${animeSlug}-episode-"]`);
            for (const a of allLinks) {
                const m = (a.getAttribute('href') || '').match(hrefPattern);
                if (!m) continue;
                const n = parseInt(m[1], 10);
                if (!Number.isFinite(n) || n <= 0 || n > 9999) continue;
                if (n > pageMax) pageMax = n;
            }
        } catch {}

        const cur = Number(currentEpisodeNumber) || 0;
        if (cur > pageMax) pageMax = cur;
        return pageMax;
    }

    async function bumpLatestEpisodeFromPage(info) {
        if (!info?.animeSlug) return;
        try {
            const pageMax = detectPageMaxEpisode(info.animeSlug, info.episodeNumber);
            if (!(pageMax > 0)) return;

            const key = `animeinfo_${info.animeSlug}`;
            const result = await new Promise((resolve) => {
                try { chrome.storage.local.get([key], (r) => resolve(r || {})); }
                catch { resolve({}); }
            });
            const cached = (result && result[key]) || null;
            const cachedLatest = Number(cached?.latestEpisode) || 0;
            if (pageMax <= cachedLatest) return;

            const updated = { ...(cached || {}), latestEpisode: pageMax };
            await new Promise((resolve) => {
                try { chrome.storage.local.set({ [key]: updated }, () => resolve()); }
                catch { resolve(); }
            });
            AT.Logger?.debug?.(`Bumped ${key}.latestEpisode → ${pageMax}`);
        } catch (e) {
            AT.Logger?.warn?.('bumpLatestEpisodeFromPage failed:', e?.message || e);
        }
    }

    async function init() {
        const { Logger, AnimeParser, ProgressTracker, VideoMonitor, Notifications } = AT;
        Logger.debug('Init', window.location.pathname);

        VideoMonitor.cleanup();
        Notifications.cleanup();
        ProgressTracker.reset();
        clearHighlightStorageListener();

        trackingState = TrackingState.IDLE;
        currentEpisodeId = null;
        earlyTrackDone = false;
        durationRefreshAttempted = false;
        durationRefreshAttempts = 0;
        resetPlaybackAccumulator('init');
        lastVideoSource = '';

        animeInfo = AnimeParser.extractAnimeInfo();
        if (!animeInfo) { Logger.debug('No anime info found'); return; }
        currentEpisodeId = animeInfo.uniqueId;
        loadOutroStartFor(animeInfo);
        bumpLatestEpisodeFromPage(animeInfo).catch(() => {});

        const hasDetectedTotal = Number.isFinite(animeInfo.totalEpisodes) && animeInfo.totalEpisodes > 0 && animeInfo.totalEpisodes < 10000;

        if (animeInfo.coverImage || hasDetectedTotal || animeInfo.siteAnimeId) {
            try {
                chrome.storage.local.get(['animeData', 'groupCoverImages'], (result) => {
                    if (chrome.runtime.lastError) return;
                    const animeData = result.animeData || {};
                    const groupCoverImages = result.groupCoverImages || {};
                    const slug = animeInfo.animeSlug;

                    let animeChanged = false, groupChanged = false;

                    if (animeData[slug]) {
                        if (!animeData[slug].coverImage && animeInfo.coverImage) {
                            animeData[slug].coverImage = animeInfo.coverImage;
                            animeChanged = true;
                        }
                        if (animeInfo.siteAnimeId && !animeData[slug].siteAnimeId) {
                            animeData[slug].siteAnimeId = animeInfo.siteAnimeId;
                            animeChanged = true;
                        }
                        if (hasDetectedTotal) {
                            const existingMaxEpisode = Math.max(0, ...((animeData[slug].episodes || []).map(ep => Number(ep.number) || 0)));
                            if (animeInfo.totalEpisodes >= existingMaxEpisode && animeData[slug].totalEpisodes !== animeInfo.totalEpisodes) {
                                animeData[slug].totalEpisodes = animeInfo.totalEpisodes;
                                animeChanged = true;
                            }
                        }
                    }

                    try {
                        const baseSlug = getBaseSlug(slug);
                        if (animeInfo.coverImage && !groupCoverImages[baseSlug]) {
                            groupCoverImages[baseSlug] = animeInfo.coverImage;
                            groupChanged = true;
                        }
                    } catch { }

                    if (!animeChanged && !groupChanged) return;
                    const patch = {};
                    if (animeChanged) patch.animeData = animeData;
                    if (groupChanged) patch.groupCoverImages = groupCoverImages;
                    chrome.storage.local.set(patch);
                });
            } catch (e) { Logger.warn(`Cover image update failed: ${e?.message}`); }
        }

        Logger.debug(`Detected: ${animeInfo.animeTitle} Ep${animeInfo.episodeNumber}`);

        try {
            const skipResult = await chrome.storage.local.get(['autoSkipFillers', FILLER_STAY_SELECTIONS_KEY]);
            if (skipResult.autoSkipFillers === true) {
                const stayedFillers = normalizeStayedFillers(skipResult[FILLER_STAY_SELECTIONS_KEY] || {});
                const stayedEpisodes = stayedFillers[String(animeInfo.animeSlug).toLowerCase()] || [];
                const fillerResponse = await chrome.runtime.sendMessage({ type: 'GET_FILLER_EPISODES', animeSlug: animeInfo.animeSlug });
                const fillerEpisodes = fillerResponse?.fillers;
                if (Array.isArray(fillerEpisodes) && fillerEpisodes.includes(animeInfo.episodeNumber)) {
                    if (stayedEpisodes.includes(animeInfo.episodeNumber)) {
                        Logger.info(`Filler stay remembered for Ep ${animeInfo.episodeNumber}; auto-skip suppressed`);
                    } else {
                        let nextCanon = animeInfo.episodeNumber + 1;
                        const maxSearch = (animeInfo.totalEpisodes || 9999);
                        while (fillerEpisodes.includes(nextCanon) && nextCanon <= maxSearch) nextCanon++;
                        if (nextCanon <= maxSearch) {
                        Logger.info(`⏭ Filler detected (Ep ${animeInfo.episodeNumber}), skipping to Ep ${nextCanon}`);





                        let cancelled = false;
                        const skipDelayMs = 4500;
                        try {
                            const toast = document.createElement('div');
                            Object.assign(toast.style, {
                                position: 'fixed', top: '22px', left: '50%', transform: 'translateX(-50%)', zIndex: '2147483647',
                                width: 'min(620px, calc(100vw - 28px))', padding: '18px 20px', borderRadius: '20px',
                                fontSize: '15px', fontWeight: '700', color: '#f7f7ff',
                                background: 'linear-gradient(180deg, rgba(28,29,44,0.97), rgba(20,21,34,0.98))', backdropFilter: 'blur(16px)',
                                boxShadow: '0 18px 45px rgba(0,0,0,0.42)', fontFamily: 'system-ui, sans-serif',
                                border: '1px solid rgba(140,160,255,0.18)', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap',
                                transition: 'opacity 200ms ease, transform 200ms ease'
                            });
                            const text = document.createElement('div');
                            text.style.flex = '1';
                            text.style.minWidth = '0';
                            const kicker = document.createElement('div');
                            kicker.style.cssText = 'font-size:11px;font-weight:800;letter-spacing:.12em;color:#8eb5ff;margin-bottom:4px;';
                            kicker.textContent = 'AUTO SKIP FILLER';
                            const headline = document.createElement('div');
                            headline.style.cssText = 'font-size:24px;line-height:1.1;font-weight:800;color:#fff;';
                            headline.textContent = `Episode ${animeInfo.episodeNumber} is filler`;
                            const subline = document.createElement('div');
                            subline.style.cssText = 'margin-top:6px;font-size:14px;line-height:1.45;color:rgba(235,238,255,0.84);';
                            subline.textContent = `Jumping to canon Episode ${nextCanon} soon unless you stay here.`;
                            text.append(kicker, headline, subline);
                            const actionWrap = document.createElement('div');
                            Object.assign(actionWrap.style, {
                                display: 'flex', alignItems: 'center', gap: '10px', flexShrink: '0', marginLeft: 'auto'
                            });
                            const skipBtn = document.createElement('button');
                            skipBtn.textContent = 'Skip Now';
                            Object.assign(skipBtn.style, {
                                padding: '11px 16px', border: 'none', borderRadius: '12px',
                                background: 'linear-gradient(135deg, #6ea8ff, #8f7dff)', color: '#0f1320',
                                fontWeight: '800', cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap',
                                boxShadow: '0 8px 20px rgba(110,168,255,0.28)'
                            });
                            const cancelBtn = document.createElement('button');
                            cancelBtn.textContent = 'Stay Here';
                            Object.assign(cancelBtn.style, {
                                padding: '11px 16px', border: '1px solid rgba(255,255,255,0.16)',
                                background: 'rgba(255,255,255,0.06)', color: '#fff', borderRadius: '12px',
                                fontWeight: '800', cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap'
                            });
                            cancelBtn.addEventListener('click', () => {
                                cancelled = true;
                                void rememberStayedFillerEpisode(animeInfo.animeSlug, animeInfo.episodeNumber);
                                try { toast.remove(); } catch {}
                            });
                            skipBtn.addEventListener('click', () => {
                                cancelled = false;
                                window.location.href = `https://an1me.to/watch/${animeInfo.animeSlug}-episode-${nextCanon}`;
                            });
                            toast.appendChild(text);
                            actionWrap.appendChild(skipBtn);
                            actionWrap.appendChild(cancelBtn);
                            toast.appendChild(actionWrap);
                            document.body.appendChild(toast);

                            window.addEventListener('beforeunload', () => { cancelled = true; }, { once: true });
                        } catch { }
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
        } catch (e) { Logger.warn(`Auto-skip filler check failed: ${e?.message}`); }

        highlightWatchedEpisodes(animeInfo.animeSlug);
        highlightFillerEpisodes(animeInfo.animeSlug, animeInfo.animeTitle);
        injectEpisodeBadgeStyles();
        decorateCurrentEpisode();

        const alreadyTracked = await ProgressTracker.isEpisodeTracked(animeInfo.uniqueId);
        if (alreadyTracked) {
            trackingState = TrackingState.COMPLETED;
            Logger.debug('Already tracked (monitoring metadata for duration refresh)');
        }

        VideoMonitor.startWatching(animeInfo, eventHandlers);

        try { setupServerSwitchObserver(); }
        catch (err) { Logger.warn('setupServerSwitchObserver failed:', err); }

        try { maybeFallbackInvalidActiveServer(); }
        catch (err) { Logger.warn('maybeFallbackInvalidActiveServer failed:', err); }

        try {
            const result = await chrome.storage.local.get(['auto4kServerEnabled']);
            const enabled = result.auto4kServerEnabled !== false;
            if (enabled) maybeAutoSelect4kServer();
        } catch (err) {
            Logger.warn('Auto-4k setting read failed (defaulting ON):', err);
            try { maybeAutoSelect4kServer(); } catch {}
        }

        const periodicCheck = setInterval(() => {
            if (trackingState === TrackingState.COMPLETED || !animeInfo) { clearInterval(periodicCheck); return; }
            const videoElement = VideoMonitor.getVideoElement();
            if (videoElement && videoElement.duration > 0) {
                const currentTime = videoElement.currentTime;
                const duration = videoElement.duration;
                if (ProgressTracker.shouldMarkComplete(currentTime, duration, cachedOutroStartSec)) {
                    const minWatch = AT.CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
                    if (accumulatedPlaybackSeconds >= minWatch) {
                        Logger.info('Periodic check: threshold reached, tracking');
                        clearInterval(periodicCheck);
                        trackImmediately();
                    }
                }
            }
        }, 5000);

        const periodicCheckTimeout = setTimeout(() => clearInterval(periodicCheck), 30 * 60 * 1000);
        VideoMonitor.addCleanup(() => { clearInterval(periodicCheck); clearTimeout(periodicCheckTimeout); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { setTimeout(init, 1000); });
    else setTimeout(init, 1000);

    let lastUrl = location.href;
    let navigationDebounceTimeout = null;
    let historyPatched = false;

    let _autoServerClickInFlight = false;
    const _SERVER_SWITCH_REBIND_DELAY_MS = 700;

    function isValidEmbedPayload(span) {
        const enc = span?.getAttribute?.('data-embed-id') || '';
        const idx = enc.indexOf(':');
        if (idx < 0) return false;
        let html = '';
        try { html = atob(enc.slice(idx + 1)); } catch { return false; }
        if (!html) return false;
        if (/<div\s+class\s*=\s*["']?error["']?/i.test(html)) return false;
        if (/invalid\s+video\s+url/i.test(html)) return false;
        const m = html.match(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
        if (!m) return false;
        const src = (m[1] || '').trim();
        if (!src) return false;
        if (/^about:blank$/i.test(src)) return false;
        return true;
    }

    function findFirstValidAlternative(container, except) {
        const spans = Array.from(container.querySelectorAll('[data-embed-id]'));
        for (const s of spans) {
            if (s === except) continue;
            if (/4k/i.test(s.textContent || '')) continue;
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
            const span = e.target?.closest?.('.player-selection [data-embed-id]');
            if (!span) return;
            if (span.classList.contains('active')) return;
            if (!animeInfo) return;

            const v = VideoMonitor.getVideoElement?.();
            if (!_autoServerClickInFlight && v && v.currentTime > 0 && v.duration > 0) {
                try {
                    ProgressTracker.saveVideoProgress(
                        animeInfo.uniqueId,
                        v.currentTime,
                        v.duration,
                        true,
                        true
                    );
                } catch (err) {
                    Logger.warn('Server switch: urgent save failed:', err);
                }
            }

            VideoMonitor.armSilentResume(animeInfo.uniqueId);
            Logger.info('Server switch detected — re-binding video monitor');

            setTimeout(() => {
                try { VideoMonitor.rebindAfterServerSwitch(animeInfo, eventHandlers); }
                catch (err) { Logger.warn('rebindAfterServerSwitch failed:', err); }
            }, _SERVER_SWITCH_REBIND_DELAY_MS);
        };

        document.addEventListener('click', handleServerClick, { capture: true, passive: true });
        VideoMonitor.addCleanup(() => {
            document.removeEventListener('click', handleServerClick, { capture: true });
        });
    }

    function maybeAutoSelect4kServer() {
        const { Logger } = AT;
        if (!animeInfo) return;

        window.__atAuto4kClickedFor = window.__atAuto4kClickedFor || new Set();
        if (window.__atAuto4kClickedFor.has(animeInfo.uniqueId)) return;

        let triggered = false;
        let pollTimer = null;
        let mo = null;
        let killTimer = null;

        const cleanup = () => {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            if (mo) { try { mo.disconnect(); } catch {} mo = null; }
            if (killTimer) { clearTimeout(killTimer); killTimer = null; }
        };

        const tryClick = () => {
            if (triggered) return true;
            const containers = document.querySelectorAll('.player-selection');
            for (const container of containers) {
                if (container.offsetParent === null) continue;
                const activeSpan = container.querySelector('[data-embed-id].active');
                if (!activeSpan) continue;

                const spans = container.querySelectorAll('[data-embed-id]');
                let fourK = null;
                for (const s of spans) {
                    if (/4k/i.test(s.textContent || '')) { fourK = s; break; }
                }
                if (!fourK) continue;

                if (!isValidEmbedPayload(fourK)) {
                    triggered = true;
                    window.__atAuto4kClickedFor.add(animeInfo.uniqueId);
                    Logger.debug('Auto-4k: 4k chip present but payload invalid — skipping');
                    return true;
                }

                if (fourK === activeSpan) {
                    triggered = true;
                    window.__atAuto4kClickedFor.add(animeInfo.uniqueId);
                    Logger.debug('Auto-4k: 4k server is already active');
                    return true;
                }

                _autoServerClickInFlight = true;
                try {
                    fourK.click();
                    triggered = true;
                    window.__atAuto4kClickedFor.add(animeInfo.uniqueId);
                    Logger.info(`Auto-4k: clicked "${(fourK.textContent || '').trim()}"`);
                } catch (err) {
                    Logger.warn('Auto-4k click failed:', err);
                } finally {
                    setTimeout(() => { _autoServerClickInFlight = false; }, 200);
                }
                return true;
            }
            return false;
        };

        if (tryClick()) return;

        pollTimer = setInterval(() => {
            if (tryClick()) cleanup();
        }, 500);

        mo = new MutationObserver(() => {
            if (tryClick()) cleanup();
        });
        try { mo.observe(document.body, { childList: true, subtree: true }); }
        catch {}

        killTimer = setTimeout(cleanup, 30000);

        AT.VideoMonitor.addCleanup(cleanup);
    }

    function maybeFallbackInvalidActiveServer() {
        const { Logger } = AT;
        if (!animeInfo) return;

        window.__atFallbackDoneFor = window.__atFallbackDoneFor || new Set();
        if (window.__atFallbackDoneFor.has(animeInfo.uniqueId)) return;

        let triggered = false;
        let pollTimer = null;
        let mo = null;
        let killTimer = null;

        const cleanup = () => {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            if (mo) { try { mo.disconnect(); } catch {} mo = null; }
            if (killTimer) { clearTimeout(killTimer); killTimer = null; }
        };

        const tryFallback = () => {
            if (triggered) return true;
            const containers = document.querySelectorAll('.player-selection');
            for (const container of containers) {
                if (container.offsetParent === null) continue;
                const active = container.querySelector('[data-embed-id].active');
                if (!active) continue;
                if (isValidEmbedPayload(active)) continue;

                const replacement = findFirstValidAlternative(container, active);
                if (!replacement) {
                    Logger.warn('Active server invalid but no valid alternative in this row');
                    continue;
                }

                _autoServerClickInFlight = true;
                try {
                    replacement.click();
                    triggered = true;
                    window.__atFallbackDoneFor.add(animeInfo.uniqueId);
                    Logger.info(`Active server invalid — fell back to "${(replacement.textContent || '').trim()}"`);
                } catch (err) {
                    Logger.warn('Invalid-server fallback click failed:', err);
                } finally {
                    setTimeout(() => { _autoServerClickInFlight = false; }, 200);
                }
                return true;
            }
            return false;
        };

        if (tryFallback()) return;

        pollTimer = setInterval(() => {
            if (tryFallback()) cleanup();
        }, 500);

        mo = new MutationObserver(() => {
            if (tryFallback()) cleanup();
        });
        try { mo.observe(document.body, { childList: true, subtree: true }); }
        catch {}

        killTimer = setTimeout(cleanup, 30000);

        AT.VideoMonitor.addCleanup(cleanup);
    }

    const setupNavigationObserver = () => {
        const { Logger, ProgressTracker, VideoMonitor } = AT;












        if (!historyPatched && !window.__atHistoryPatched) {
            historyPatched = true;
            window.__atHistoryPatched = true;
            const dispatchUrlChange = () => {
                try { window.dispatchEvent(new Event('at:locationchange')); } catch {}
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
            window.addEventListener('popstate', dispatchUrlChange);
        }






        const _pathOf = (href) => {
            try { return new URL(href, location.origin).pathname; }
            catch { return href; }
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
                    Logger.info('URL changed, reinit...');
                    trackingState = TrackingState.IDLE;
                    currentEpisodeId = null;
                    earlyTrackDone = false;
                    durationRefreshAttempted = false;
                    durationRefreshAttempts = 0;
                    resetPlaybackAccumulator('spa navigation');
                    lastVideoSource = '';
                    clearHighlightStorageListener();
                    ProgressTracker.reset();
                    setTimeout(init, 1000);
                }
            }, 200);
        };
        window.addEventListener('at:locationchange', handleUrlChange);
        VideoMonitor.addCleanup(() => {
            window.removeEventListener('at:locationchange', handleUrlChange);
        });

        document.addEventListener('click', (e) => {
            const target = e.target.closest('[data-open-nav-episode], .episode-navigation, .next-episode, .prev-episode, .episode-list-item, a, button');
            if (!target) return;

            const isAn1meNav = target.hasAttribute('data-open-nav-episode') ||
                target.classList.contains('episode-navigation') ||
                target.classList.contains('next-episode') ||
                target.classList.contains('prev-episode') ||
                target.classList.contains('episode-list-item') ||
                target.closest('[data-open-nav-episode]') ||
                target.closest('.episode-navigation');

            if (isAn1meNav) { Logger.debug('An1me.to navigation detected, tracking immediately'); trackImmediately(); return; }

            const link = e.target.closest('a[href]');
            if (link && link.href && link.href !== location.href) { trackImmediately(); return; }

            const href = target.getAttribute('href') || '';
            const text = (target.textContent || '').toLowerCase();
            const className = (target.className || '').toLowerCase();

            const isNavigation = href.includes('/watch/') || href.includes('episode') ||
                text.includes('next') || text.includes('previous') || text.includes('prev') ||
                className.includes('next') || className.includes('prev') || className.includes('episode');

            if (isNavigation) { Logger.debug('Navigation click detected, tracking immediately'); trackImmediately(); }
        }, { capture: true, passive: true });



        VideoMonitor.addCleanup(() => {
            if (navigationDebounceTimeout) { clearTimeout(navigationDebounceTimeout); navigationDebounceTimeout = null; }
        });
    };

    setupNavigationObserver();
})();
