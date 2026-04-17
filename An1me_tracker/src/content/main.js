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

    // State — single enum prevents race conditions between concurrent tracking paths
    const TrackingState = { IDLE: 'idle', TRACKING: 'tracking', COMPLETED: 'completed' };
    let trackingState = TrackingState.IDLE;
    let animeInfo = null;
    let currentEpisodeId = null;
    let durationRefreshAttempted = false;
    let durationRefreshAttempts = 0;
    const MAX_DURATION_REFRESH_ATTEMPTS = 5;
    let accumulatedPlaybackSeconds = 0;
    let lastTimeupdateTime = 0; // last currentTime from timeupdate, for accumulating real playback
    let lastVideoSource = '';
    let earlyTrackDone = false;

    function resetPlaybackAccumulator(reason = '') {
        if (reason && AT?.Logger) {
            AT.Logger.debug(`Reset playback accumulator: ${reason}`);
        }
        accumulatedPlaybackSeconds = 0;
        lastTimeupdateTime = 0;
    }

    function resetEpisodeTrackingState(reason = '') {
        resetPlaybackAccumulator(reason);
        earlyTrackDone = false;
        trackingState = TrackingState.IDLE;
        durationRefreshAttempted = false;
        durationRefreshAttempts = 0;
    }

    function syncVideoSourceEpisodeBoundary(videoElement) {
        const src = (videoElement?.currentSrc || videoElement?.src || '').trim();
        if (!src) return false;
        if (!lastVideoSource) {
            lastVideoSource = src;
            return false;
        }
        if (src === lastVideoSource) return false;

        lastVideoSource = src;
        resetEpisodeTrackingState('video source changed');
        return true;
    }

    /**
     * Shared helper: write a completed episode into animeData synchronously.
     * Used by trackImmediately() to avoid Chrome storage async limitations.
     */
    function writeSyncEpisode(info, duration, animeData, logPrefix) {
        const { EpisodeWriter } = AT;
        const result = EpisodeWriter.writeEpisode(info, duration, animeData, { logPrefix });
        return !!result?.changed;
    }

    /**
     * Immediately track episode (no debounce, synchronous storage path).
     * Used when we need to track RIGHT NOW before navigation.
     */
    async function trackImmediately() {
        const { Logger, ProgressTracker, VideoMonitor, Notifications, CONFIG } = AT;
        const videoElement = VideoMonitor.getVideoElement();

        if (!animeInfo || trackingState !== TrackingState.IDLE || !videoElement) return;

        const duration    = videoElement.duration;
        const currentTime = videoElement.currentTime;

        if (!duration || !ProgressTracker.shouldMarkComplete(currentTime, duration)) return;

        // Misclick guard: require minimum real playback before allowing completion
        const minWatch = CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
        if (accumulatedPlaybackSeconds < minWatch) {
            Logger.debug(`trackImmediately: only ${Math.round(accumulatedPlaybackSeconds)}s of real playback (need ${minWatch}s), skipping`);
            return;
        }

        trackingState = TrackingState.TRACKING;

        try {
            const result = await chrome.storage.local.get(['animeData', 'deletedAnime']);
            const animeData = result.animeData || {};
            const deletedAnime = { ...(result.deletedAnime || {}) };
            const written = writeSyncEpisode(animeInfo, duration, animeData, 'Immediate');

            if (written) {
                delete deletedAnime[animeInfo.animeSlug];
                await chrome.storage.local.set({ animeData, deletedAnime });
                trackingState = TrackingState.COMPLETED;
                Logger.success('✓ Immediate track successful');
                Notifications.showCompletion(animeInfo);

                // ── Watchlist sync: completed if last episode, else watching ──
                try {
                    const { WatchlistSync } = AT;
                    const slug = animeInfo.animeSlug;
                    const entry = animeData[slug];
                    const siteId = entry?.siteAnimeId || animeInfo.siteAnimeId;
                    if (WatchlistSync && siteId) {
                        const watchedEps = entry?.episodes?.length || 0;
                        const totalEps = entry?.totalEpisodes;
                        if (totalEps && watchedEps >= totalEps) {
                            WatchlistSync.updateStatus(siteId, 'completed', slug);
                        } else {
                            WatchlistSync.updateStatus(siteId, 'watching', slug);
                        }
                    }
                } catch { /* non-critical */ }

                try {
                    const progressResult = await chrome.storage.local.get(['videoProgress']);
                    const videoProgress = progressResult.videoProgress || {};
                    delete videoProgress[animeInfo.uniqueId];
                    await chrome.storage.local.set({ videoProgress });
                } catch {
                    // Non-critical: progress cleanup can fail silently
                }
            } else {
                trackingState = TrackingState.COMPLETED;
            }
        } catch (e) {
            trackingState = TrackingState.IDLE;
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

        if (!videoElement || trackingState === TrackingState.COMPLETED || earlyTrackDone || !animeInfo) return;

        syncVideoSourceEpisodeBoundary(videoElement);

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

        // Skip duration refresh once we've succeeded (or exhausted retries) —
        // avoids a microtask on every timeupdate tick (~5× per second).
        if (!durationRefreshAttempted && durationRefreshAttempts < MAX_DURATION_REFRESH_ATTEMPTS) {
            await tryRefreshTrackedDuration(videoElement, 'timeupdate');
        }

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

        if (currentTime > CONFIG.MIN_PROGRESS_TO_SAVE && !ProgressTracker.shouldMarkComplete(currentTime, duration)) {
            ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration);
        }

        if (ProgressTracker.shouldMarkComplete(currentTime, duration)) {
            if (trackingState !== TrackingState.IDLE) {
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
                trackingState = TrackingState.COMPLETED;
                return;
            }

            trackingState = TrackingState.TRACKING;
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
            // force=true, urgent=false → pause throttle (15s)
            ProgressTracker.saveVideoProgress(animeInfo.uniqueId, videoElement.currentTime, videoElement.duration, true, false);
        }
    };

    const handleSeeked = () => {
        const { ProgressTracker, VideoMonitor } = AT;
        const videoElement = VideoMonitor.getVideoElement();

        if (animeInfo && trackingState !== TrackingState.COMPLETED && videoElement && videoElement.currentTime > 0) {
            ProgressTracker.saveVideoProgress(animeInfo.uniqueId, videoElement.currentTime, videoElement.duration, false);
        }
    };

    const handleEnded = async () => {
        const { Logger, ProgressTracker, VideoMonitor, Notifications, CONFIG } = AT;
        const videoElement = VideoMonitor.getVideoElement();

        if (animeInfo && videoElement) {
            // Misclick guard on ended event too
            const minWatch = CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
            if (trackingState !== TrackingState.COMPLETED && accumulatedPlaybackSeconds < minWatch) {
                Logger.debug(`Video ended but only ${Math.round(accumulatedPlaybackSeconds)}s of real playback (need ${minWatch}s), not tracking`);
                return;
            }
            if (trackingState === TrackingState.COMPLETED) {
                Logger.info('Episode ended (already tracked), showing notification');
                Notifications.showCompletion(animeInfo);
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

        if (document.hidden && animeInfo && trackingState === TrackingState.IDLE && videoElement && videoElement.currentTime > 0) {
            const duration = videoElement.duration;
            const currentTime = videoElement.currentTime;

            if (ProgressTracker.shouldMarkComplete(currentTime, duration)) {
                // Misclick guard
                const minWatch = CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
                if (accumulatedPlaybackSeconds < minWatch) {
                    Logger.debug(`Visibility change: only ${Math.round(accumulatedPlaybackSeconds)}s of real playback (need ${minWatch}s), saving progress instead`);
                    // urgent: tab hidden, snapshot fast
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
                        if (refreshed) {
                            await ProgressTracker.clearSavedProgress(animeInfo.uniqueId);
                        }
                    } catch (error) {
                        Logger.warn('Failed to refresh duration on visibility change:', error);
                    }
                }
            } else {
                // urgent: tab hidden, snapshot fast
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

        if (ProgressTracker.shouldMarkComplete(currentTime, duration)) {
            if (trackingState === TrackingState.COMPLETED) return;

            // Misclick guard
            const minWatch = CONFIG.MIN_WATCH_SECONDS_BEFORE_COMPLETE || 120;
            if (accumulatedPlaybackSeconds < minWatch) {
                // urgent: page unloading, snapshot fast
                ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration, true, true);
                return;
            }

            trackingState = TrackingState.COMPLETED;

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
            // urgent: page unloading, snapshot fast
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

    /**
     * Highlight watched episodes in the page's episode list sidebar.
     * Reads tracked episodes from storage and applies a persistent style
     * (dark orange text + reduced opacity) so the user can see progress
     * even after browser cache is cleared.
     */
    let _highlightStorageListener = null;
    function clearHighlightStorageListener() {
        if (_highlightStorageListener) {
            try {
                chrome.storage.onChanged.removeListener(_highlightStorageListener);
            } catch {
                // Ignore remove errors; listener reference is still cleared.
            }
            _highlightStorageListener = null;
        }
    }

    function highlightWatchedEpisodes(slug) {
        const { Logger } = AT;

        // Remove previous listener to prevent leaks on SPA navigation
        clearHighlightStorageListener();

        injectEpisodeBadgeStyles();

        function applyHighlights(watchedSet) {
            const items = document.querySelectorAll('.episode-list-item[data-episode-search-query]');
            let highlighted = 0;
            for (const item of items) {
                const epNum = parseInt(item.getAttribute('data-episode-search-query'), 10);
                if (isNaN(epNum)) continue;
                if (watchedSet.has(epNum)) {
                    // Clear legacy inline styles in case they were applied earlier
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
                // Episode list may not be in DOM yet (lazy/SPA load) — retry when it appears
                const container = document.querySelector('.episode-list-display-box');
                const target = container || document.body;
                let retryDebounce = null;
                const obs = new MutationObserver(() => {
                    if (retryDebounce) return; // coalesce mutation bursts
                    retryDebounce = setTimeout(() => {
                        retryDebounce = null;
                        const retry = applyHighlights(watchedSet);
                        if (retry > 0) {
                            Logger.debug(`Highlighted ${retry} watched episodes (deferred)`);
                            obs.disconnect();
                        }
                    }, 150);
                });
                obs.observe(target, { childList: true, subtree: true });
                // Stop observing after 10s to avoid leaks
                setTimeout(() => {
                    obs.disconnect();
                    if (retryDebounce) { clearTimeout(retryDebounce); retryDebounce = null; }
                }, 10000);
            }
        });

        // Re-highlight when storage updates (e.g. user just finished an episode)
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

    // ── Episode badges (watched + filler) ─────────────────────────────────
    // Unified styles for the sidebar episode list. Filler is purple (the
    // community convention), watched is gold. Both use a left accent bar +
    // subtle gradient + a compact pill badge.
    function injectEpisodeBadgeStyles() {
        if (document.querySelector('#anime-tracker-episode-styles')) return;

        // Load bundled fonts via extension URL so they can render on an1me.to.
        // These must be listed in manifest.web_accessible_resources.
        let proxonUrl = '';
        let comicSansUrl = '';
        try {
            proxonUrl = chrome.runtime.getURL('src/fonts/PROXON.ttf');
            comicSansUrl = chrome.runtime.getURL('src/fonts/comic_sans.ttf');
        } catch { /* context invalidated — fonts just won't render */ }

        const style = document.createElement('style');
        style.id = 'anime-tracker-episode-styles';
        style.textContent = `
            /* ── Bundled fonts (only applied to extension-injected UI) ── */
            @font-face {
                font-family: 'AT-PROXON';
                src: url('${proxonUrl}') format('truetype');
                font-weight: 400 900;
                font-display: swap;
            }
            @font-face {
                font-family: 'AT-ComicSans';
                src: url('${comicSansUrl}') format('truetype');
                font-weight: 400 900;
                font-display: swap;
            }

            /* ── Watched ── */
            .episode-list-item.at-watched-episode {
                border: 1px solid rgba(233, 171, 56, 0.22) !important;
                border-left: 3px solid #e9ab38 !important;
                border-radius: 4px !important;
            }
            .episode-list-item.at-watched-episode:not(.current-episode) {
                opacity: 0.78 !important;
                background: linear-gradient(90deg, rgba(233, 171, 56, 0.12), transparent 70%) !important;
            }
            .episode-list-item.at-watched-episode .episode-list-item-title,
            .episode-list-item.at-watched-episode .episode-list-item-number {
                color: #e9ab38 !important;
            }
            .episode-list-item.at-watched-episode .episode-list-item-title {
                font-family: 'AT-PROXON', inherit !important;
                letter-spacing: 0.3px !important;
            }
            .episode-list-item.at-watched-episode .episode-list-item-number {
                font-family: 'AT-ComicSans', inherit !important;
            }
            .episode-list-item.at-watched-episode .at-watched-badge {
                display: inline-block;
                margin-left: 6px;
                padding: 1px 6px;
                font-size: 10px;
                font-weight: 700;
                line-height: 1.2;
                color: #1a1a1a;
                background: linear-gradient(135deg, #f5c66e, #e9ab38);
                border-radius: 4px;
                letter-spacing: 0.3px;
                vertical-align: middle;
                box-shadow: 0 1px 2px rgba(0,0,0,0.25);
            }

            /* ── Filler (purple, community convention) ── */
            .episode-list-item.at-filler-episode {
                border: 1px solid rgba(168, 85, 247, 0.22) !important;
                border-left: 3px solid #a855f7 !important;
                border-radius: 4px !important;
            }
            .episode-list-item.at-filler-episode:not(.current-episode) {
                background: linear-gradient(90deg, rgba(168, 85, 247, 0.12), transparent 70%) !important;
            }
            .episode-list-item.at-filler-episode .at-filler-badge {
                display: inline-block;
                margin-left: 6px;
                padding: 1px 6px;
                font-size: 10px;
                font-weight: 700;
                line-height: 1.2;
                color: #fff;
                background: linear-gradient(135deg, #c084fc, #a855f7);
                border-radius: 4px;
                letter-spacing: 0.3px;
                vertical-align: middle;
                box-shadow: 0 1px 2px rgba(0,0,0,0.25);
            }

            /* When an episode is both watched and filler, keep filler accent
               on the left bar but still show both badges. */
            .episode-list-item.at-watched-episode.at-filler-episode {
                border-left-color: #a855f7 !important;
            }

            /* ── Current episode (the one being watched now) ── */
            /* Neutralize an1me.to's native current-episode styles (accent-2
               text color + arrow indicator on :after) so our cyan theme and
               "NOW" badge are the only current-episode signal. */
            .episode-head .episode-list-display-box .episode-list-item.current-episode,
            .episode-list-item.current-episode {
                color: inherit !important;
            }
            .episode-head .episode-list-display-box .episode-list-item.current-episode::after,
            .episode-list-item.current-episode::after,
            .episode-head .episode-list-display-box .episode-list-item.current-episode::before,
            .episode-list-item.current-episode::before {
                content: none !important;
                display: none !important;
                background-color: transparent !important;
                border: 0 !important;
                width: 0 !important;
                height: 0 !important;
            }
            /* Cyan accent to match the extension's primary color. Uses the
               same visual language as watched/filler: left bar + gradient +
               pill badge. Takes precedence over watched/filler accents. */
            .episode-list-item.current-episode {
                border: 1px solid rgba(79, 195, 247, 0.38) !important;
                border-left: 3px solid #4fc3f7 !important;
                border-radius: 4px !important;
                background: linear-gradient(90deg, rgba(79, 195, 247, 0.22), rgba(79, 195, 247, 0.05) 70%) !important;
                box-shadow: 0 0 0 1px rgba(79, 195, 247, 0.18), 0 2px 12px rgba(79, 195, 247, 0.15) !important;
                position: relative !important;
            }
            .episode-list-item.current-episode .episode-list-item-title {
                color: #e8f6ff !important;
                font-family: 'AT-PROXON', inherit !important;
                letter-spacing: 0.3px !important;
                font-weight: 600 !important;
            }
            .episode-list-item.current-episode .episode-list-item-number {
                color: #4fc3f7 !important;
                font-family: 'AT-ComicSans', inherit !important;
                font-weight: 700 !important;
            }
            /* "NOW" pill badge appended via JS */
            .episode-list-item.current-episode .at-current-badge {
                display: inline-block;
                margin-left: 6px;
                padding: 1px 7px;
                font-size: 10px;
                font-weight: 700;
                line-height: 1.2;
                color: #0e1117;
                background: linear-gradient(135deg, #7dd3fc, #4fc3f7);
                border-radius: 4px;
                letter-spacing: 0.5px;
                vertical-align: middle;
                box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 0 8px rgba(79, 195, 247, 0.45);
                text-transform: uppercase;
                animation: at-current-pulse 2.2s ease-in-out infinite;
            }
            @keyframes at-current-pulse {
                0%, 100% { box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 0 8px rgba(79, 195, 247, 0.45); }
                50%      { box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 0 14px rgba(79, 195, 247, 0.75); }
            }
            /* When current episode is also watched/filler, keep cyan visible
               but preserve the secondary badge. */
            .episode-list-item.current-episode.at-watched-episode,
            .episode-list-item.current-episode.at-filler-episode {
                border-left-color: #4fc3f7 !important;
                opacity: 1 !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);

        // Append a "NOW" badge to the current episode if an1me.to marked one.
        // Runs deferred so the list is already in DOM; also observes mutations
        // for SPA navigations that swap which item is .current-episode.
        decorateCurrentEpisode();
    }

    let _currentEpisodeObserver = null;
    function decorateCurrentEpisode() {
        const apply = () => {
            // Remove stale badges from items that are no longer .current-episode
            // (happens on SPA nav when an1me.to swaps which item has the class).
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

        if (_currentEpisodeObserver) {
            try { _currentEpisodeObserver.disconnect(); } catch { /* noop */ }
        }
        const target = document.querySelector('.episode-list-display-box')?.parentElement
            || document.body;
        let _applyDebounce = null;
        _currentEpisodeObserver = new MutationObserver(() => {
            if (_applyDebounce) return; // coalesce mutation bursts
            _applyDebounce = setTimeout(() => {
                _applyDebounce = null;
                apply();
            }, 150);
        });
        _currentEpisodeObserver.observe(target, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['class']
        });
        // Disconnect after 15s to avoid long-running observer leaks; the
        // initial apply + short window covers SPA-driven class toggles.
        setTimeout(() => {
            try { _currentEpisodeObserver?.disconnect(); } catch { /* noop */ }
            _currentEpisodeObserver = null;
        }, 15000);
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
                    // Episode list may not be in DOM yet — observe briefly
                    const target = document.querySelector('.episode-list-display-box') || document.body;
                    const obs = new MutationObserver(() => { if (applyFiller() > 0) obs.disconnect(); });
                    obs.observe(target, { childList: true, subtree: true });
                    setTimeout(() => obs.disconnect(), 10000);
                } else {
                    Logger.debug(`Tagged filler episodes for ${slug}`);
                }
            });
        } catch (e) {
            Logger.debug('Filler coloring failed:', e.message);
        }
    }

    async function init() {
        const { Logger, AnimeParser, ProgressTracker, VideoMonitor, Notifications } = AT;

        Logger.info('Init', window.location.pathname);

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
        if (!animeInfo) {
            Logger.debug('No anime info found');
            return;
        }
        currentEpisodeId = animeInfo.uniqueId;

        const hasDetectedTotal = Number.isFinite(animeInfo.totalEpisodes) &&
            animeInfo.totalEpisodes > 0 &&
            animeInfo.totalEpisodes < 10000;

        if (animeInfo.coverImage || hasDetectedTotal || animeInfo.siteAnimeId) {
            try {
                chrome.storage.local.get(['animeData', 'groupCoverImages'], (result) => {
                    if (chrome.runtime.lastError) return;
                    const animeData = result.animeData || {};
                    const groupCoverImages = result.groupCoverImages || {};
                    const slug = animeInfo.animeSlug;

                    // Track whether anything actually changed — only write if yes,
                    // so we don't fire onChanged → full cloud sync for no-op updates.
                    let animeChanged = false;
                    let groupChanged = false;

                    if (animeData[slug]) {
                        // Only update existing entries — don't create new ones just from visiting a page
                        if (!animeData[slug].coverImage && animeInfo.coverImage) {
                            animeData[slug].coverImage = animeInfo.coverImage;
                            animeChanged = true;
                        }
                        // Store site's numeric anime ID for watchlist sync
                        if (animeInfo.siteAnimeId && !animeData[slug].siteAnimeId) {
                            animeData[slug].siteAnimeId = animeInfo.siteAnimeId;
                            animeChanged = true;
                        }
                        if (hasDetectedTotal) {
                            const existingMaxEpisode = Math.max(
                                0,
                                ...((animeData[slug].episodes || []).map(ep => Number(ep.number) || 0))
                            );
                            if (animeInfo.totalEpisodes >= existingMaxEpisode
                                && animeData[slug].totalEpisodes !== animeInfo.totalEpisodes) {
                                animeData[slug].totalEpisodes = animeInfo.totalEpisodes;
                                animeChanged = true;
                            }
                        }
                    }
                    // Don't create new animeData entries here — they will be created
                    // when the user actually watches enough to trigger episode tracking.

                    try {
                        const baseSlug = getBaseSlug(slug);
                        if (animeInfo.coverImage && !groupCoverImages[baseSlug]) {
                            groupCoverImages[baseSlug] = animeInfo.coverImage;
                            groupChanged = true;
                        }
                    } catch {
                        // Ignore baseSlug errors; group cover won't be set
                    }

                    if (!animeChanged && !groupChanged) return;
                    const patch = {};
                    if (animeChanged) patch.animeData = animeData;
                    if (groupChanged) patch.groupCoverImages = groupCoverImages;
                    chrome.storage.local.set(patch);
                });
            } catch (e) {
                Logger.warn('Cover image update failed:', e);
            }
        }

        Logger.info(`Detected: ${animeInfo.animeTitle} Ep${animeInfo.episodeNumber}`);

        // ── Auto-Skip Filler check ──
        // If enabled, ask background for filler data and redirect to next canon episode.
        // The filler episode is NOT marked as watched — only navigated past.
        try {
            const skipResult = await chrome.storage.local.get(['autoSkipFillers']);
            if (skipResult.autoSkipFillers === true) {
                const fillerResponse = await chrome.runtime.sendMessage({
                    type: 'GET_FILLER_EPISODES',
                    animeSlug: animeInfo.animeSlug
                });
                const fillerEpisodes = fillerResponse?.fillers;
                if (Array.isArray(fillerEpisodes) && fillerEpisodes.includes(animeInfo.episodeNumber)) {
                    // Find next non-filler episode
                    let nextCanon = animeInfo.episodeNumber + 1;
                    const maxSearch = (animeInfo.totalEpisodes || 9999);
                    while (fillerEpisodes.includes(nextCanon) && nextCanon <= maxSearch) {
                        nextCanon++;
                    }
                    if (nextCanon <= maxSearch) {
                        Logger.info(`⏭ Filler detected (Ep ${animeInfo.episodeNumber}), skipping to Ep ${nextCanon}`);
                        // Show a brief toast before redirecting
                        try {
                            const toast = document.createElement('div');
                            toast.textContent = `⏭ Filler Ep ${animeInfo.episodeNumber} — skipping to Ep ${nextCanon}`;
                            Object.assign(toast.style, {
                                position: 'fixed', bottom: '30px', right: '30px', zIndex: '2147483647',
                                padding: '12px 20px', borderRadius: '10px', fontSize: '14px', fontWeight: '600',
                                color: '#fff', background: 'rgba(30,30,40,0.92)', backdropFilter: 'blur(12px)',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.4)', fontFamily: 'system-ui, sans-serif'
                            });
                            document.body.appendChild(toast);
                        } catch { /* non-critical UI */ }
                        // Small delay so the user sees the notification
                        setTimeout(() => {
                            window.location.href = `https://an1me.to/watch/${animeInfo.animeSlug}-episode-${nextCanon}`;
                        }, 1500);
                        return; // Don't set up video monitoring for a filler we're skipping
                    }
                    Logger.info(`⏭ Filler detected (Ep ${animeInfo.episodeNumber}) but no more canon episodes found`);
                }
            }
        } catch (e) {
            Logger.warn('Auto-skip filler check failed:', e);
        }

        // ── Highlight watched episodes in the episode list ──
        highlightWatchedEpisodes(animeInfo.animeSlug);

        // ── Color filler episodes in the sidebar (read-only, zero writes) ──
        highlightFillerEpisodes(animeInfo.animeSlug, animeInfo.animeTitle);

        // ── Decorate current episode with a "NOW" badge ──
        // Always run here (not just inside style injection) so SPA navigations
        // after the initial 15 s observer window still get re-decorated.
        injectEpisodeBadgeStyles();
        decorateCurrentEpisode();

        const alreadyTracked = await ProgressTracker.isEpisodeTracked(animeInfo.uniqueId);
        if (alreadyTracked) {
            trackingState = TrackingState.COMPLETED;
            Logger.debug('Already tracked (monitoring metadata for duration refresh)');
        }

        VideoMonitor.startWatching(animeInfo, eventHandlers);

        const periodicCheck = setInterval(() => {
            if (trackingState === TrackingState.COMPLETED || !animeInfo) {
                clearInterval(periodicCheck);
                return;
            }

            const videoElement = VideoMonitor.getVideoElement();
            if (videoElement && videoElement.duration > 0) {
                const currentTime = videoElement.currentTime;
                const duration = videoElement.duration;

                if (ProgressTracker.shouldMarkComplete(currentTime, duration)) {
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
