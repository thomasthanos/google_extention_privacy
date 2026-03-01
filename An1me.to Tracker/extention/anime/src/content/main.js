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
    let currentEpisodeId = null;

    /**
     * Immediately track episode (no debounce, synchronous)
     * Used when we need to track RIGHT NOW before navigation
     */
    function trackImmediately() {
        const { Logger, ProgressTracker, VideoMonitor, Notifications } = AT;
        const videoElement = VideoMonitor.getVideoElement();
        
        if (!animeInfo || isTracked || !videoElement) return;
        
        const duration = videoElement.duration;
        const currentTime = videoElement.currentTime;
        
        if (!duration || !ProgressTracker.shouldMarkComplete(currentTime, duration)) return;
        
        isTracked = true;
        
        // Synchronous save using chrome.storage.local directly
        try {
            chrome.storage.local.get(['animeData'], (result) => {
                if (chrome.runtime.lastError) return;
                
                const animeData = result.animeData || {};
                
                if (!animeData[animeInfo.animeSlug]) {
                    animeData[animeInfo.animeSlug] = {
                        title: animeInfo.animeTitle,
                        slug: animeInfo.animeSlug,
                        episodes: [],
                        totalWatchTime: 0,
                        lastWatched: null,
                        totalEpisodes: null
                    };
                }
                
                if (!Array.isArray(animeData[animeInfo.animeSlug].episodes)) {
                    animeData[animeInfo.animeSlug].episodes = [];
                }
                
                const exists = animeData[animeInfo.animeSlug].episodes
                    .some(ep => ep.number === animeInfo.episodeNumber);
                
                if (!exists) {
                    // Validate duration (typical anime: 20-30 min = 1200-1800s, max 2h = 7200s)
                    let validDuration = Math.round(duration);
                    if (validDuration > 7200) {
                        Logger.warn(`Invalid duration ${validDuration}s, capping to 1800s`);
                        validDuration = 1800;
                    }

                    const watchedAt = new Date().toISOString().split('.')[0] + 'Z';
                    animeData[animeInfo.animeSlug].episodes.push({
                        number: animeInfo.episodeNumber,
                        watchedAt,
                        duration: validDuration
                    });
                    animeData[animeInfo.animeSlug].totalWatchTime =
                        (animeData[animeInfo.animeSlug].totalWatchTime || 0) + validDuration;

                    // ── Double episode: also save the second episode ──
                    if (animeInfo.isDoubleEpisode && animeInfo.secondEpisodeNumber) {
                        const alreadyHasSecond = animeData[animeInfo.animeSlug].episodes
                            .some(ep => ep.number === animeInfo.secondEpisodeNumber);
                        if (!alreadyHasSecond) {
                            animeData[animeInfo.animeSlug].episodes.push({
                                number: animeInfo.secondEpisodeNumber,
                                watchedAt,
                                duration: validDuration
                            });
                            animeData[animeInfo.animeSlug].totalWatchTime += validDuration;
                        }
                    }

                    animeData[animeInfo.animeSlug].lastWatched = new Date().toISOString();
                    animeData[animeInfo.animeSlug].episodes.sort((a, b) => a.number - b.number);
                    
                    chrome.storage.local.set({ animeData }, () => {
                        if (!chrome.runtime.lastError) {
                            Logger.success('✓ Immediate track successful');
                            Notifications.showCompletion(animeInfo);
                            
                            // Clear progress
                            chrome.storage.local.get(['videoProgress'], (progressResult) => {
                                if (!chrome.runtime.lastError) {
                                    const videoProgress = progressResult.videoProgress || {};
                                    delete videoProgress[animeInfo.uniqueId];
                                    chrome.storage.local.set({ videoProgress });
                                }
                            });
                        }
                    });
                }
            });
        } catch (e) {
            Logger.error('Immediate track failed:', e);
        }
    }

    /**
     * Debounce function
     */
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

    // Track if we've already done the early track for this episode
    let earlyTrackDone = false;

    /**
     * Raw timeupdate handler for early/immediate tracking
     * This runs WITHOUT debounce to catch the threshold moment
     */
    const handleTimeUpdateRaw = () => {
        const { ProgressTracker, VideoMonitor, Logger } = AT;
        const videoElement = VideoMonitor.getVideoElement();
        
        if (!videoElement || isTracked || earlyTrackDone || !animeInfo) return;
        
        const duration = videoElement.duration;
        const currentTime = videoElement.currentTime;
        
        if (!duration || duration === 0 || isNaN(duration)) return;
        
        // Check if we've hit the threshold
        if (ProgressTracker.shouldMarkComplete(currentTime, duration)) {
            earlyTrackDone = true;
            Logger.info('Threshold reached, tracking immediately (no debounce)');
            trackImmediately();
        }
    };

    /**
     * Handle video time update
     */
    const handleTimeUpdate = debounce(async function() {
        const { CONFIG, Logger, ProgressTracker, VideoMonitor } = AT;
        const videoElement = VideoMonitor.getVideoElement();
        
        if (!videoElement || isTracked || !animeInfo) return;

        // Check if episode changed
        if (currentEpisodeId && currentEpisodeId !== animeInfo.uniqueId) {
            Logger.info('Episode changed, resetting isTracked');
            isTracked = false;
            currentEpisodeId = animeInfo.uniqueId;
        }

        const duration = videoElement.duration;
        const currentTime = videoElement.currentTime;

        if (!duration || duration === 0 || isNaN(duration)) return;

        // Save progress if not yet complete
        if (currentTime > CONFIG.MIN_PROGRESS_TO_SAVE && !ProgressTracker.shouldMarkComplete(currentTime, duration)) {
            ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration);
        }

        // Check if should mark as complete
        if (ProgressTracker.shouldMarkComplete(currentTime, duration)) {
            if (isTrackingInProgress) {
                Logger.debug('Tracking already in progress, skipping');
                return;
            }

            const remainingTime = Math.round(duration - currentTime);
            const progress = Math.round((currentTime / duration) * 100);
            const durationMins = Math.floor(duration / 60);
            const durationSecs = Math.floor(duration % 60);
            Logger.info(`Marking complete: ${progress}% watched (need 85%), ${remainingTime}s remaining of ${durationMins}:${String(durationSecs).padStart(2, '0')}`);

            const alreadyTracked = await ProgressTracker.isEpisodeTracked(animeInfo.uniqueId);
            if (alreadyTracked) {
                Logger.debug('Already tracked, skipping');
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

    /**
     * Handle video pause
     */
    const handlePause = () => {
        const { ProgressTracker, VideoMonitor } = AT;
        const videoElement = VideoMonitor.getVideoElement();
        
        if (animeInfo && !isTracked && videoElement && videoElement.currentTime > 0) {
            ProgressTracker.saveVideoProgress(animeInfo.uniqueId, videoElement.currentTime, videoElement.duration, true);
        }
    };

    /**
     * Handle video seeked
     */
    const handleSeeked = () => {
        const { ProgressTracker, VideoMonitor } = AT;
        const videoElement = VideoMonitor.getVideoElement();
        
        if (animeInfo && !isTracked && videoElement && videoElement.currentTime > 0) {
            ProgressTracker.saveVideoProgress(animeInfo.uniqueId, videoElement.currentTime, videoElement.duration, false);
        }
    };

    /**
     * Handle video ended
     */
    const handleEnded = async () => {
        const { Logger, ProgressTracker, VideoMonitor, Notifications } = AT;
        const videoElement = VideoMonitor.getVideoElement();

        if (animeInfo && videoElement) {
            // Always show notification when episode ends, even if already tracked
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
                    // Notification is shown by saveWatchedEpisode
                } catch (error) {
                    Logger.error('End track failed', error);
                }
            } else {
                // Episode was already tracked, but video just ended - show notification
                Logger.info('Episode ended (was tracked before), showing notification');
                Notifications.showCompletion(animeInfo);
            }
        }
    };

    /**
     * Handle visibility change
     */
    const handleVisibilityChange = async () => {
        const { Logger, ProgressTracker, VideoMonitor } = AT;
        const videoElement = VideoMonitor.getVideoElement();
        
        if (document.hidden && animeInfo && !isTracked && videoElement && videoElement.currentTime > 0) {
            const duration = videoElement.duration;
            const currentTime = videoElement.currentTime;

            if (ProgressTracker.shouldMarkComplete(currentTime, duration)) {
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
                }
            } else {
                ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration, true);
            }
        }
    };

    /**
     * Handle before unload
     */
    const handleBeforeUnload = () => {
        const { CONFIG, Logger, ProgressTracker, VideoMonitor, Notifications } = AT;
        const videoElement = VideoMonitor.getVideoElement();
        
        if (animeInfo && !isTracked && videoElement && videoElement.currentTime > 0) {
            const duration = videoElement.duration;
            const currentTime = videoElement.currentTime;

            if (ProgressTracker.shouldMarkComplete(currentTime, duration)) {
                isTracked = true;

                // Use synchronous storage API for immediate save
                try {
                    chrome.storage.local.get(['animeData'], (result) => {
                        if (chrome.runtime.lastError) {
                            Logger.warn('beforeunload: Failed to get animeData');
                            return;
                        }

                        const animeData = result.animeData || {};

                        if (!animeData[animeInfo.animeSlug]) {
                            animeData[animeInfo.animeSlug] = {
                                title: animeInfo.animeTitle,
                                slug: animeInfo.animeSlug,
                                episodes: [],
                                totalWatchTime: 0,
                                lastWatched: null,
                                totalEpisodes: null
                            };
                        }

                        if (!Array.isArray(animeData[animeInfo.animeSlug].episodes)) {
                            animeData[animeInfo.animeSlug].episodes = [];
                        }

                        const existingIndex = animeData[animeInfo.animeSlug].episodes
                            .findIndex(ep => ep.number === animeInfo.episodeNumber);

                        if (existingIndex === -1) {
                            const now = new Date();
                            // Validate duration (typical anime: 20-30 min = 1200-1800s, max 2h = 7200s)
                            let validDuration = Math.round(duration);
                            if (validDuration > 7200) {
                                Logger.warn(`Invalid duration ${validDuration}s, capping to 1800s`);
                                validDuration = 1800;
                            }

                            const watchedAt = now.toISOString().split('.')[0] + 'Z';
                            const episodeData = {
                                number: animeInfo.episodeNumber,
                                watchedAt,
                                duration: validDuration
                            };

                            animeData[animeInfo.animeSlug].episodes.push(episodeData);
                            animeData[animeInfo.animeSlug].totalWatchTime =
                                (animeData[animeInfo.animeSlug].totalWatchTime || 0) + validDuration;

                            // ── Double episode: also save the second episode ──
                            if (animeInfo.isDoubleEpisode && animeInfo.secondEpisodeNumber) {
                                const alreadyHasSecond = animeData[animeInfo.animeSlug].episodes
                                    .some(ep => ep.number === animeInfo.secondEpisodeNumber);
                                if (!alreadyHasSecond) {
                                    animeData[animeInfo.animeSlug].episodes.push({
                                        number: animeInfo.secondEpisodeNumber,
                                        watchedAt,
                                        duration: validDuration
                                    });
                                    animeData[animeInfo.animeSlug].totalWatchTime += validDuration;
                                }
                            }

                            animeData[animeInfo.animeSlug].lastWatched = new Date().toISOString();
                            animeData[animeInfo.animeSlug].episodes.sort((a, b) => a.number - b.number);

                            chrome.storage.local.set({ animeData }, () => {
                                if (!chrome.runtime.lastError) {
                                    Logger.success('✓ Tracked on beforeunload (synchronous)');
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
                            Logger.debug('Episode already tracked in beforeunload');
                        }
                    });
                } catch (error) {
                    Logger.error('beforeunload sync save failed:', error);
                }
            } else {
                ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration, true);
            }
        }
    };

    // Event handlers object
    const eventHandlers = {
        handleTimeUpdate,
        handleTimeUpdateRaw,
        handlePause,
        handleSeeked,
        handleEnded,
        handleVisibilityChange,
        handleBeforeUnload
    };

    /**
     * Initialize tracker
     */
    async function init() {
        const { Logger, AnimeParser, ProgressTracker, VideoMonitor, Notifications } = AT;
        
        Logger.info('Init', window.location.pathname);

        // Cleanup
        VideoMonitor.cleanup();
        Notifications.cleanup();
        ProgressTracker.reset();

        // Reset state
        isTracked = false;
        isTrackingInProgress = false;
        currentEpisodeId = null;
        earlyTrackDone = false;

        animeInfo = AnimeParser.extractAnimeInfo();
        if (!animeInfo) {
            Logger.debug('No anime info found');
            return;
        }

        Logger.info(`Detected: ${animeInfo.animeTitle} Ep${animeInfo.episodeNumber}`);
        Logger.debug(`ID: ${animeInfo.uniqueId}`);

        // Check if already tracked
        const alreadyTracked = await ProgressTracker.isEpisodeTracked(animeInfo.uniqueId);
        if (alreadyTracked) {
            isTracked = true;
            Logger.debug('Already tracked');
            return;
        }

        // Start watching for video
        VideoMonitor.startWatching(animeInfo, eventHandlers);

        // Periodic check to catch missed episodes (every 5 seconds)
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
                    Logger.info('Periodic check: threshold reached, tracking');
                    clearInterval(periodicCheck);
                    trackImmediately();
                }
            }
        }, 5000);

        // Cleanup interval after 30 minutes
        const periodicCheckTimeout = setTimeout(() => clearInterval(periodicCheck), 30 * 60 * 1000);

        // Register for cleanup on navigation - prevents interval leak across episodes
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
        const { Logger, ProgressTracker, VideoMonitor, Notifications } = AT;
        
        if (navigationObserver) {
            navigationObserver.disconnect();
        }

        // Listen for clicks on navigation elements (next episode, etc.)
        document.addEventListener('click', (e) => {
            const target = e.target.closest('[data-open-nav-episode], .episode-navigation, .next-episode, .prev-episode, .episode-list-item, a, button');
            if (!target) return;
            
            // Check if it's a navigation element specific to an1me.to
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
            
            // Fallback: Check generic navigation patterns
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

        // Also track on any link click that might navigate away
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a[href]');
            if (link && link.href && link.href !== location.href) {
                trackImmediately();
            }
        }, { capture: true, passive: true });

        navigationObserver = new MutationObserver(() => {
            if (location.href === lastUrl) return;

            // Track before URL change is processed
            trackImmediately();

            if (navigationDebounceTimeout) {
                clearTimeout(navigationDebounceTimeout);
            }

            navigationDebounceTimeout = setTimeout(() => {
                if (location.href !== lastUrl) {
                    lastUrl = location.href;
                    Logger.info('URL changed, reinit...');

                    // Reset state
                    isTracked = false;
                    isTrackingInProgress = false;
                    currentEpisodeId = null;
                    earlyTrackDone = false;

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

        // Add cleanup
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
