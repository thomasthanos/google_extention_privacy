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

    /**
     * Shared helper: write a completed episode into animeData synchronously.
     * Used by both trackImmediately() and handleBeforeUnload() to avoid duplicated logic.
     *
     * @param {object} info      - animeInfo object
     * @param {number} duration  - video duration in seconds
     * @param {object} animeData - mutable animeData from storage
     * @param {string} logPrefix - label for log messages ('Immediate' | 'beforeunload')
     * @returns {boolean} true if the episode was newly written, false if already existed
     */
    function writeSyncEpisode(info, duration, animeData, logPrefix) {
        const { Logger, Notifications } = AT;

        if (!animeData[info.animeSlug]) {
            // When encountering a new anime slug for the first time, initialise the
            // record with the provided metadata. Include the coverImage if it exists
            // in the parsed info. Without this, only episodes and watch time are
            // stored, which would cause the popup to miss the cover image.
            animeData[info.animeSlug] = {
                title: info.animeTitle,
                slug: info.animeSlug,
                episodes: [],
                totalWatchTime: 0,
                lastWatched: null,
                totalEpisodes: null,
                coverImage: info.coverImage || null
            };
        }

        // If a cover image was parsed and the stored anime record does not yet
        // have one, persist it. We deliberately do not overwrite an existing
        // coverImage to avoid replacing a user-edited or previously saved image.
        if (!animeData[info.animeSlug].coverImage && info.coverImage) {
            animeData[info.animeSlug].coverImage = info.coverImage;
        }

        if (!Array.isArray(animeData[info.animeSlug].episodes)) {
            animeData[info.animeSlug].episodes = [];
        }

        const exists = animeData[info.animeSlug].episodes
            .some(ep => ep.number === info.episodeNumber);

        if (exists) {
            Logger.debug(`${logPrefix}: episode already tracked`);
            return false;
        }

        // Validate duration (typical anime: 20-30 min = 1200-1800s, max 2h = 7200s)
        let validDuration = Math.round(duration);
        if (validDuration > 7200) {
            Logger.warn(`${logPrefix}: invalid duration ${validDuration}s, capping to 1800s`);
            validDuration = 1800;
        }

        const watchedAt = new Date().toISOString().split('.')[0] + 'Z';
        animeData[info.animeSlug].episodes.push({
            number: info.episodeNumber,
            watchedAt,
            duration: validDuration
        });
        animeData[info.animeSlug].totalWatchTime =
            (animeData[info.animeSlug].totalWatchTime || 0) + validDuration;

        // Double episode: also save the second episode (e.g. ep 119 + 120)
        if (info.isDoubleEpisode && info.secondEpisodeNumber) {
            const alreadyHasSecond = animeData[info.animeSlug].episodes
                .some(ep => ep.number === info.secondEpisodeNumber);
            if (!alreadyHasSecond) {
                animeData[info.animeSlug].episodes.push({
                    number: info.secondEpisodeNumber,
                    watchedAt,
                    duration: validDuration
                });
                animeData[info.animeSlug].totalWatchTime += validDuration;
            }
        }

        animeData[info.animeSlug].lastWatched = new Date().toISOString();
        animeData[info.animeSlug].episodes.sort((a, b) => a.number - b.number);
        return true;
    }

    /**
     * Immediately track episode (no debounce, synchronous)
     * Used when we need to track RIGHT NOW before navigation
     */
    function trackImmediately() {
        const { Logger, ProgressTracker, VideoMonitor, Notifications } = AT;
        const videoElement = VideoMonitor.getVideoElement();

        // Guard: already tracked, no info, no video, or another call already in flight
        if (!animeInfo || isTracked || !videoElement || isTrackingImmediate) return;

        const duration    = videoElement.duration;
        const currentTime = videoElement.currentTime;

        if (!duration || !ProgressTracker.shouldMarkComplete(currentTime, duration)) return;

        // Lock immediately before the async storage read to prevent race conditions
        isTrackingImmediate = true;
        isTracked = true;

        try {
            chrome.storage.local.get(['animeData'], (result) => {
                if (chrome.runtime.lastError) {
                    isTrackingImmediate = false;
                    return;
                }

                const animeData = result.animeData || {};
                const written   = writeSyncEpisode(animeInfo, duration, animeData, 'Immediate');

                if (written) {
                    chrome.storage.local.set({ animeData }, () => {
                        isTrackingImmediate = false;
                        if (!chrome.runtime.lastError) {
                            Logger.success('✓ Immediate track successful');
                            Notifications.showCompletion(animeInfo);

                            // Clear in-progress record
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
        const { Logger, ProgressTracker, VideoMonitor, Notifications } = AT;
        const videoElement = VideoMonitor.getVideoElement();

        if (animeInfo && !isTracked && videoElement && videoElement.currentTime > 0) {
            const duration = videoElement.duration;
            const currentTime = videoElement.currentTime;

            if (ProgressTracker.shouldMarkComplete(currentTime, duration)) {
                isTracked = true;

                try {
                    chrome.storage.local.get(['animeData'], (result) => {
                        if (chrome.runtime.lastError) {
                            Logger.warn('beforeunload: Failed to get animeData');
                            return;
                        }

                        const animeData = result.animeData || {};
                        const written = writeSyncEpisode(animeInfo, duration, animeData, 'beforeunload');

                        if (written) {
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

    // ─── Utility: Compute base slug for grouping ──────────────────────────
    // Groups anime by removing season/part indicators and special cases. This
    // replicates the logic used in the popup's SeasonGrouping.getBaseSlug() but
    // simplified for use in the content script. It returns a consistent base
    // slug used to map multiple seasons (e.g. "naruto-shippuuden" → "naruto").
    function getBaseSlug(slug) {
        if (!slug || typeof slug !== 'string') return slug || '';
        const lower = slug.toLowerCase();
        // Special cases – group all related seasons under a single slug
        if (lower.startsWith('naruto')) return 'naruto';
        if (lower.startsWith('one-punch-man')) return 'one-punch-man';
        if (lower.startsWith('kimetsu-no-yaiba')) return 'kimetsu-no-yaiba';
        if (lower.startsWith('shingeki-no-kyojin')) return 'shingeki-no-kyojin';
        if (lower.startsWith('initial-d')) return 'initial-d';
        if (lower.startsWith('bleach')) return 'bleach';
        // Generic: strip season/part indicators, years, roman numerals, and arc suffixes
        return lower
            .replace(/-season-?\d+(-[a-z-]+)?$/i, '')
            .replace(/-s\d+$/i, '')
            .replace(/-\d+(st|nd|rd|th)-season$/i, '')
            .replace(/-(part|cour)-?\d+(-[a-z-]+)?$/i, '')
            .replace(/-20\d{2}$/i, '')
            .replace(/-(ii|iii|iv|v|vi)$/i, '')
            .replace(/-[a-z]+-hen$/i, '');
    }

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
        isTrackingImmediate = false;
        currentEpisodeId = null;
        earlyTrackDone = false;

        animeInfo = AnimeParser.extractAnimeInfo();
        if (!animeInfo) {
            Logger.debug('No anime info found');
            return;
        }

        // ── Persist cover image on first page load (even if episode not completed) ──
        // If the current anime exists in storage but lacks a cover image, and the
        // parser was able to extract one, update the stored record. This ensures
        // that posters appear for partially watched anime (those with in-progress
        // episodes) without requiring the episode to be marked as completed.
        if (animeInfo.coverImage) {
            try {
                // Fetch animeData and groupCoverImages together. If the current
                // anime exists, update its cover image. If it doesn't exist, create
                // a minimal entry so that posters appear even for in-progress anime.
                // Also compute the baseSlug and persist a group cover image if not
                // already stored for this group. This ensures group cards show a
                // consistent poster across all seasons, and avoids overwriting once
                // a group cover has been set.
                chrome.storage.local.get(['animeData', 'groupCoverImages'], (result) => {
                    if (chrome.runtime.lastError) return;
                    const animeData = result.animeData || {};
                    const groupCoverImages = result.groupCoverImages || {};
                    const slug = animeInfo.animeSlug;
                    // Update or create anime entry with cover image
                    if (animeData[slug]) {
                        if (!animeData[slug].coverImage) {
                            animeData[slug].coverImage = animeInfo.coverImage;
                        }
                    } else {
                        animeData[slug] = {
                            title: animeInfo.animeTitle,
                            slug: slug,
                            episodes: [],
                            totalWatchTime: 0,
                            lastWatched: null,
                            totalEpisodes: null,
                            coverImage: animeInfo.coverImage
                        };
                    }

                    // Determine the group base slug for this anime and set group cover
                    // only if it hasn't been set previously. This uses the utility
                    // defined above. We don't overwrite an existing group cover to
                    // respect the user's request to keep the first assigned cover.
                    try {
                        const baseSlug = getBaseSlug(slug);
                        if (animeInfo.coverImage && !groupCoverImages[baseSlug]) {
                            groupCoverImages[baseSlug] = animeInfo.coverImage;
                        }
                    } catch (_) {
                        // Ignore baseSlug errors; group cover won't be set
                    }

                    chrome.storage.local.set({ animeData, groupCoverImages });
                });
            } catch (e) {
                // Silent catch: storage errors should not block init
                Logger.warn('Cover image update failed:', e);
            }
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

        // Single merged click listener: handles an1me.to nav, generic nav patterns, and any outbound link
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

            // Check for any outbound link click
            const link = e.target.closest('a[href]');
            if (link && link.href && link.href !== location.href) {
                trackImmediately();
                return;
            }

            // Fallback: generic navigation patterns
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
