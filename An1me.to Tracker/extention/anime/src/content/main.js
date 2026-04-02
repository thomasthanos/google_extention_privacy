/**
 * Anime Tracker - Content Script Main Entry Point
 * Monitors video playback and tracks episodes when 80% watched
 */

(function() {
    'use strict';

    // Only run on main watch pages, not in iframes
    if (window.self !== window.top) {
        return;
    }

    // Wait for modules to load
    const AT = window.AnimeTrackerContent;

    // State
    let animeInfo = null;
    let isTracked = false;
    let isTrackingInProgress = false;
    let isTrackingImmediate = false; // guard against concurrent trackImmediately() calls
    let currentEpisodeId = null;
    let durationRefreshAttempted = false;
    let durationRefreshAttempts = 0;
    const MAX_DURATION_REFRESH_ATTEMPTS = 5;
    let accumulatedPlaybackSeconds = 0;
    let lastTimeupdateTime = 0; // last currentTime from timeupdate, for accumulating real playback

    /**
     * Shared helper: write a completed episode into animeData synchronously.
     * Used by trackImmediately() to avoid Chrome storage async limitations.
     */
    function writeSyncEpisode(info, duration, animeData, logPrefix) {
        const { Logger } = AT;

        if (!animeData[info.animeSlug]) {
            animeData[info.animeSlug] = {
                title: info.animeTitle,
                slug: info.animeSlug,
                episodes: [],
                totalWatchTime: 0,
                lastWatched: null,
                totalEpisodes: Number.isFinite(info.totalEpisodes) ? info.totalEpisodes : null,
                coverImage: info.coverImage || null
            };
        }

        if (!animeData[info.animeSlug].coverImage && info.coverImage) {
            animeData[info.animeSlug].coverImage = info.coverImage;
        }

        if (Number.isFinite(info.totalEpisodes) && info.totalEpisodes > 0 && info.totalEpisodes < 10000) {
            const trackedEpisodes = animeData[info.animeSlug].episodes || [];
            const maxTracked = Math.max(
                0,
                ...trackedEpisodes.map(ep => Number(ep.number) || 0),
                Number(info.episodeNumber) || 0,
                Number(info.secondEpisodeNumber) || 0
            );
            if (info.totalEpisodes >= maxTracked) {
                animeData[info.animeSlug].totalEpisodes = info.totalEpisodes;
            }
        }

        if (!Array.isArray(animeData[info.animeSlug].episodes)) {
            animeData[info.animeSlug].episodes = [];
        }

        // Auto-undrop: if user watches a new episode of a dropped anime, undrop it
        if (animeData[info.animeSlug].droppedAt) {
            delete animeData[info.animeSlug].droppedAt;
            animeData[info.animeSlug].listState = 'active';
            animeData[info.animeSlug].listStateUpdatedAt = new Date().toISOString();
        }

        const MAX_REASONABLE_DURATION_SECONDS = 6 * 60 * 60;
        let validDuration = Math.round(Number(duration) || 0);
        if (!Number.isFinite(validDuration) || validDuration <= 0) {
            validDuration = 0;
        }
        if (validDuration > MAX_REASONABLE_DURATION_SECONDS) {
            Logger.warn(`${logPrefix}: invalid duration ${validDuration}s, capping to ${MAX_REASONABLE_DURATION_SECONDS}s`);
            validDuration = MAX_REASONABLE_DURATION_SECONDS;
        }

        const existingIndex = animeData[info.animeSlug].episodes
            .findIndex(ep => ep.number === info.episodeNumber);

        if (existingIndex !== -1) {
            const existingEpisode = animeData[info.animeSlug].episodes[existingIndex] || {};
            const currentDuration = Number(existingEpisode.duration) || 0;
            const isPlaceholderDuration = currentDuration <= 0 || currentDuration === 1440 || currentDuration === 6000 || currentDuration === 7200;

            if (isPlaceholderDuration && validDuration > 0 && currentDuration !== validDuration) {
                animeData[info.animeSlug].episodes[existingIndex] = {
                    ...existingEpisode,
                    duration: validDuration,
                    durationSource: 'video'
                };
                animeData[info.animeSlug].totalWatchTime = animeData[info.animeSlug].episodes
                    .reduce((sum, ep) => sum + (Number(ep?.duration) || 0), 0);
                animeData[info.animeSlug].lastWatched = new Date().toISOString();
                return true;
            }

            return false;
        }

        const watchedAt = new Date().toISOString().split('.')[0] + 'Z';
        animeData[info.animeSlug].episodes.push({
            number: info.episodeNumber,
            watchedAt,
            duration: validDuration,
            durationSource: 'video'
        });
        animeData[info.animeSlug].totalWatchTime =
            (animeData[info.animeSlug].totalWatchTime || 0) + validDuration;

        if (info.isDoubleEpisode && info.secondEpisodeNumber) {
            const alreadyHasSecond = animeData[info.animeSlug].episodes
                .some(ep => ep.number === info.secondEpisodeNumber);
            if (!alreadyHasSecond) {
                animeData[info.animeSlug].episodes.push({
                    number: info.secondEpisodeNumber,
                    watchedAt,
                    duration: validDuration,
                    durationSource: 'video'
                });
            }
        }

        animeData[info.animeSlug].lastWatched = new Date().toISOString();
        animeData[info.animeSlug].episodes.sort((a, b) => a.number - b.number);
        return true;
    }

    /**
     * Immediately track episode (no debounce, synchronous storage path).
     * Used when we need to track RIGHT NOW before navigation.
     */
    function trackImmediately() {
        const { Logger, ProgressTracker, VideoMonitor, Notifications, CONFIG } = AT;
        const videoElement = VideoMonitor.getVideoElement();

        if (!animeInfo || isTracked || !videoElement || isTrackingImmediate) return;

        const duration    = videoElement.duration;
        const currentTime = videoElement.currentTime;

        if (!duration || !ProgressTracker.shouldMarkComplete(currentTime, duration)) return;

        // Misclick guard: require minimum real playback before allowing completion
        const minWatch = CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
        if (accumulatedPlaybackSeconds < minWatch) {
            Logger.debug(`trackImmediately: only ${Math.round(accumulatedPlaybackSeconds)}s of real playback (need ${minWatch}s), skipping`);
            return;
        }

        isTrackingImmediate = true;
        isTracked = true;

        try {
            chrome.storage.local.get(['animeData', 'deletedAnime'], (result) => {
                if (chrome.runtime.lastError) {
                    isTrackingImmediate = false;
                    return;
                }

                const animeData = result.animeData || {};
                const deletedAnime = { ...(result.deletedAnime || {}) };
                const written   = writeSyncEpisode(animeInfo, duration, animeData, 'Immediate');

                if (written) {
                    delete deletedAnime[animeInfo.animeSlug];
                    chrome.storage.local.set({ animeData, deletedAnime }, () => {
                        isTrackingImmediate = false;
                        if (!chrome.runtime.lastError) {
                            Logger.success('✓ Immediate track successful');
                            Notifications.showCompletion(animeInfo);

                            chrome.storage.local.get(['videoProgress'], (progressResult) => {
                                if (!chrome.runtime.lastError) {
                                    const videoProgress = progressResult.videoProgress || {};
                                    delete videoProgress[animeInfo.uniqueId];
                                    chrome.storage.local.set({ videoProgress });
                                }
                            });
                        }
                    });
                } else {
                    isTrackingImmediate = false;
                }
            });
        } catch (e) {
            isTrackingImmediate = false;
            Logger.error('Immediate track failed:', e);
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

    let earlyTrackDone = false;

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
                if (durationRefreshAttempts >= MAX_DURATION_REFRESH_ATTEMPTS) {
                    durationRefreshAttempted = true;
                }
            }
        } catch (error) {
            Logger.warn(`Duration refresh failed via ${reason}:`, error);
        }
    }

    /**
     * Raw timeupdate handler — runs WITHOUT debounce to catch the threshold moment.
     */
    const handleTimeUpdateRaw = async () => {
        const { ProgressTracker, VideoMonitor, Logger, CONFIG } = AT;
        const videoElement = VideoMonitor.getVideoElement();

        if (!videoElement || isTracked || earlyTrackDone || !animeInfo) return;

        const duration = videoElement.duration;
        const currentTime = videoElement.currentTime;

        if (!duration || duration === 0 || isNaN(duration)) return;

        // Accumulate real playback time (small forward deltas only, ignore seeks)
        if (lastTimeupdateTime > 0) {
            const delta = currentTime - lastTimeupdateTime;
            if (delta > 0 && delta < 2) { // normal playback deltas are < 1s; ignore seeks
                accumulatedPlaybackSeconds += delta;
            }
        }
        lastTimeupdateTime = currentTime;

        await tryRefreshTrackedDuration(videoElement, 'timeupdate');

        if (ProgressTracker.shouldMarkComplete(currentTime, duration)) {
            // Misclick guard: require minimum real playback before allowing completion
            const minWatch = CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
            if (accumulatedPlaybackSeconds < minWatch) {
                Logger.debug(`Threshold reached but only ${Math.round(accumulatedPlaybackSeconds)}s of real playback (need ${minWatch}s), waiting...`);
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
    };

    const handleTimeUpdate = debounce(async function() {
        const { CONFIG, Logger, ProgressTracker, VideoMonitor } = AT;
        const videoElement = VideoMonitor.getVideoElement();

        if (!videoElement || isTracked || !animeInfo) return;

        if (currentEpisodeId && currentEpisodeId !== animeInfo.uniqueId) {
            Logger.info('Episode changed, resetting isTracked');
            isTracked = false;
            currentEpisodeId = animeInfo.uniqueId;
        }

        const duration = videoElement.duration;
        const currentTime = videoElement.currentTime;

        if (!duration || duration === 0 || isNaN(duration)) return;

        if (currentTime > CONFIG.MIN_PROGRESS_TO_SAVE && !ProgressTracker.shouldMarkComplete(currentTime, duration)) {
            ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration);
        }

        if (ProgressTracker.shouldMarkComplete(currentTime, duration)) {
            if (isTrackingInProgress) {
                return;
            }

            // Misclick guard: require minimum real playback before allowing completion
            const minWatch = CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
            if (accumulatedPlaybackSeconds < minWatch) {
                Logger.debug(`Debounced: threshold reached but only ${Math.round(accumulatedPlaybackSeconds)}s of real playback (need ${minWatch}s), waiting...`);
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
                if (refreshed) {
                    await ProgressTracker.clearSavedProgress(animeInfo.uniqueId);
                }
                isTracked = true;
                return;
            }

            isTrackingInProgress = true;
            isTracked = true;
            currentEpisodeId = animeInfo.uniqueId;

            const trackingOperation = async () => {
                await ProgressTracker.saveWatchedEpisode(animeInfo, duration);
                await ProgressTracker.clearSavedProgress(animeInfo.uniqueId);
            };

            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('handleTimeUpdate timeout')), 10000)
            );

            try {
                await Promise.race([trackingOperation(), timeoutPromise]);
                Logger.success('Auto-tracked on timeupdate');
            } catch (error) {
                if (error.message === 'handleTimeUpdate timeout') {
                    Logger.warn('Tracking operation timed out, will retry');
                } else {
                    Logger.error('Track failed', error);
                }
                isTracked = false;
            } finally {
                isTrackingInProgress = false;
            }
        }
    }, AT.CONFIG.DEBOUNCE_DELAY);

    const handlePause = () => {
        const { ProgressTracker, VideoMonitor } = AT;
        const videoElement = VideoMonitor.getVideoElement();

        if (animeInfo && !isTracked && videoElement && videoElement.currentTime > 0) {
            ProgressTracker.saveVideoProgress(animeInfo.uniqueId, videoElement.currentTime, videoElement.duration, true);
        }
    };

    const handleSeeked = () => {
        const { ProgressTracker, VideoMonitor } = AT;
        const videoElement = VideoMonitor.getVideoElement();

        if (animeInfo && !isTracked && videoElement && videoElement.currentTime > 0) {
            ProgressTracker.saveVideoProgress(animeInfo.uniqueId, videoElement.currentTime, videoElement.duration, false);
        }
    };

    const handleEnded = async () => {
        const { Logger, ProgressTracker, VideoMonitor, Notifications, CONFIG } = AT;
        const videoElement = VideoMonitor.getVideoElement();

        if (animeInfo && videoElement) {
            // Misclick guard on ended event too
            const minWatch = CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
            if (!isTracked && accumulatedPlaybackSeconds < minWatch) {
                Logger.debug(`Video ended but only ${Math.round(accumulatedPlaybackSeconds)}s of real playback (need ${minWatch}s), not tracking`);
                return;
            }
            if (isTracked) {
                Logger.info('Episode ended (already tracked), showing notification');
                Notifications.showCompletion(animeInfo);
                return;
            }

            isTracked = true;
            const alreadyTracked = await ProgressTracker.isEpisodeTracked(animeInfo.uniqueId);
            if (!alreadyTracked) {
                try {
                    await ProgressTracker.saveWatchedEpisode(animeInfo, videoElement.duration);
                    await ProgressTracker.clearSavedProgress(animeInfo.uniqueId);
                } catch (error) {
                    Logger.error('End track failed', error);
                }
            } else {
                try {
                    const refreshed = await ProgressTracker.refreshTrackedEpisodeDuration(animeInfo, videoElement.duration);
                    if (refreshed) {
                        await ProgressTracker.clearSavedProgress(animeInfo.uniqueId);
                    }
                } catch (error) {
                    Logger.warn('Failed to refresh duration on end:', error);
                }
                Logger.info('Episode ended (was tracked before), showing notification');
                Notifications.showCompletion(animeInfo);
            }
        }
    };

    const handleVisibilityChange = async () => {
        const { Logger, ProgressTracker, VideoMonitor, CONFIG } = AT;
        const videoElement = VideoMonitor.getVideoElement();

        if (document.hidden && animeInfo && !isTracked && videoElement && videoElement.currentTime > 0) {
            const duration = videoElement.duration;
            const currentTime = videoElement.currentTime;

            if (ProgressTracker.shouldMarkComplete(currentTime, duration)) {
                // Misclick guard
                const minWatch = CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
                if (accumulatedPlaybackSeconds < minWatch) {
                    Logger.debug(`Visibility change: only ${Math.round(accumulatedPlaybackSeconds)}s of real playback (need ${minWatch}s), saving progress instead`);
                    ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration, true);
                    return;
                }
                isTracked = true;
                const alreadyTracked = await ProgressTracker.isEpisodeTracked(animeInfo.uniqueId);
                if (!alreadyTracked) {
                    try {
                        await ProgressTracker.saveWatchedEpisode(animeInfo, duration);
                        await ProgressTracker.clearSavedProgress(animeInfo.uniqueId);
                        Logger.success('Auto-tracked on visibility change');
                    } catch (error) {
                        Logger.error('Auto-track failed on visibility change', error);
                        isTracked = false;
                    }
                } else {
                    try {
                        const refreshed = await ProgressTracker.refreshTrackedEpisodeDuration(animeInfo, duration);
                        if (refreshed) {
                            await ProgressTracker.clearSavedProgress(animeInfo.uniqueId);
                        }
                    } catch (error) {
                        Logger.warn('Failed to refresh duration on visibility change:', error);
                    }
                }
            } else {
                ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration, true);
            }
        }
    };

    const handleBeforeUnload = () => {
        const { Logger, ProgressTracker, VideoMonitor, CONFIG } = AT;
        const videoElement = VideoMonitor.getVideoElement();

        if (!animeInfo || !videoElement || videoElement.currentTime <= 0) return;

        const duration = videoElement.duration;
        const currentTime = videoElement.currentTime;

        if (ProgressTracker.shouldMarkComplete(currentTime, duration)) {
            if (isTracked) return;

            // Misclick guard
            const minWatch = CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
            if (accumulatedPlaybackSeconds < minWatch) {
                ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration, true);
                return;
            }

            isTracked = true;

            try {
                chrome.runtime.sendMessage({
                    type: 'TRACK_BEFORE_UNLOAD',
                    animeInfo: {
                        animeSlug:          animeInfo.animeSlug,
                        animeTitle:         animeInfo.animeTitle,
                        episodeNumber:      animeInfo.episodeNumber,
                        secondEpisodeNumber: animeInfo.secondEpisodeNumber,
                        isDoubleEpisode:    animeInfo.isDoubleEpisode,
                        uniqueId:           animeInfo.uniqueId,
                        totalEpisodes:      animeInfo.totalEpisodes,
                        coverImage:         animeInfo.coverImage
                    },
                    duration
                }, () => { void chrome.runtime.lastError; });
            } catch {}
        } else {
            ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration, true);
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

    async function init() {
        const { Logger, AnimeParser, ProgressTracker, VideoMonitor, Notifications } = AT;

        Logger.info('Init', window.location.pathname);

        VideoMonitor.cleanup();
        Notifications.cleanup();
        ProgressTracker.reset();

        isTracked = false;
        isTrackingInProgress = false;
        isTrackingImmediate = false;
        currentEpisodeId = null;
        earlyTrackDone = false;
        durationRefreshAttempted = false;
        durationRefreshAttempts = 0;
        accumulatedPlaybackSeconds = 0;
        lastTimeupdateTime = 0;

        animeInfo = AnimeParser.extractAnimeInfo();
        if (!animeInfo) {
            Logger.debug('No anime info found');
            return;
        }

        const hasDetectedTotal = Number.isFinite(animeInfo.totalEpisodes) &&
            animeInfo.totalEpisodes > 0 &&
            animeInfo.totalEpisodes < 10000;

        if (animeInfo.coverImage || hasDetectedTotal) {
            try {
                chrome.storage.local.get(['animeData', 'groupCoverImages'], (result) => {
                    if (chrome.runtime.lastError) return;
                    const animeData = result.animeData || {};
                    const groupCoverImages = result.groupCoverImages || {};
                    const slug = animeInfo.animeSlug;

                    if (animeData[slug]) {
                        // Only update existing entries — don't create new ones just from visiting a page
                        if (!animeData[slug].coverImage && animeInfo.coverImage) {
                            animeData[slug].coverImage = animeInfo.coverImage;
                        }
                        if (hasDetectedTotal) {
                            const existingMaxEpisode = Math.max(
                                0,
                                ...((animeData[slug].episodes || []).map(ep => Number(ep.number) || 0))
                            );
                            if (animeInfo.totalEpisodes >= existingMaxEpisode) {
                                animeData[slug].totalEpisodes = animeInfo.totalEpisodes;
                            }
                        }
                    }
                    // Don't create new animeData entries here — they will be created
                    // when the user actually watches enough to trigger episode tracking.

                    try {
                        const baseSlug = getBaseSlug(slug);
                        if (animeInfo.coverImage && !groupCoverImages[baseSlug]) {
                            groupCoverImages[baseSlug] = animeInfo.coverImage;
                        }
                    } catch {
                        // Ignore baseSlug errors; group cover won't be set
                    }

                    chrome.storage.local.set({ animeData, groupCoverImages });
                });
            } catch (e) {
                Logger.warn('Cover image update failed:', e);
            }
        }

        Logger.info(`Detected: ${animeInfo.animeTitle} Ep${animeInfo.episodeNumber}`);

        const alreadyTracked = await ProgressTracker.isEpisodeTracked(animeInfo.uniqueId);
        if (alreadyTracked) {
            isTracked = true;
            Logger.debug('Already tracked (monitoring metadata for duration refresh)');
        }

        VideoMonitor.startWatching(animeInfo, eventHandlers);

        const periodicCheck = setInterval(() => {
            if (isTracked || !animeInfo) {
                clearInterval(periodicCheck);
                return;
            }

            const videoElement = VideoMonitor.getVideoElement();
            if (videoElement && videoElement.duration > 0) {
                const currentTime = videoElement.currentTime;
                const duration = videoElement.duration;

                if (ProgressTracker.shouldMarkComplete(currentTime, duration)) {
                    const minWatch = CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
                    if (accumulatedPlaybackSeconds >= minWatch) {
                        Logger.info('Periodic check: threshold reached, tracking');
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

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(init, 1000);
        });
    } else {
        setTimeout(init, 1000);
    }

    // Handle SPA navigation
    let lastUrl = location.href;
    let navigationObserver = null;
    let navigationDebounceTimeout = null;

    const setupNavigationObserver = () => {
        const { Logger, ProgressTracker, VideoMonitor } = AT;

        if (navigationObserver) {
            navigationObserver.disconnect();
        }

        document.addEventListener('click', (e) => {
            const target = e.target.closest('[data-open-nav-episode], .episode-navigation, .next-episode, .prev-episode, .episode-list-item, a, button');
            if (!target) return;

            const isAn1meNav =
                target.hasAttribute('data-open-nav-episode') ||
                target.classList.contains('episode-navigation') ||
                target.classList.contains('next-episode') ||
                target.classList.contains('prev-episode') ||
                target.classList.contains('episode-list-item') ||
                target.closest('[data-open-nav-episode]') ||
                target.closest('.episode-navigation');

            if (isAn1meNav) {
                Logger.debug('An1me.to navigation detected, tracking immediately');
                trackImmediately();
                return;
            }

            const link = e.target.closest('a[href]');
            if (link && link.href && link.href !== location.href) {
                trackImmediately();
                return;
            }

            const href = target.getAttribute('href') || '';
            const text = (target.textContent || '').toLowerCase();
            const className = (target.className || '').toLowerCase();

            const isNavigation =
                href.includes('/watch/') ||
                href.includes('episode') ||
                text.includes('next') ||
                text.includes('previous') ||
                text.includes('prev') ||
                className.includes('next') ||
                className.includes('prev') ||
                className.includes('episode');

            if (isNavigation) {
                Logger.debug('Navigation click detected, tracking immediately');
                trackImmediately();
            }
        }, { capture: true, passive: true });

        navigationObserver = new MutationObserver(() => {
            if (location.href === lastUrl) return;

            trackImmediately();

            if (navigationDebounceTimeout) {
                clearTimeout(navigationDebounceTimeout);
            }

            navigationDebounceTimeout = setTimeout(() => {
                if (location.href !== lastUrl) {
                    lastUrl = location.href;
                    Logger.info('URL changed, reinit...');

                    isTracked = false;
                    isTrackingInProgress = false;
                    currentEpisodeId = null;
                    earlyTrackDone = false;
                    durationRefreshAttempted = false;
                    durationRefreshAttempts = 0;
                    accumulatedPlaybackSeconds = 0;
                    lastTimeupdateTime = 0;

                    ProgressTracker.reset();

                    setTimeout(init, 1000);
                }
            }, 200);
        });

        if (document.body) {
            navigationObserver.observe(document.body, {
                subtree: true,
                childList: true,
                attributes: false,
                characterData: false
            });
        }

        VideoMonitor.addCleanup(() => {
            if (navigationDebounceTimeout) {
                clearTimeout(navigationDebounceTimeout);
                navigationDebounceTimeout = null;
            }
            if (navigationObserver) {
                navigationObserver.disconnect();
                navigationObserver = null;
            }
        });
    };

    setupNavigationObserver();

})();
