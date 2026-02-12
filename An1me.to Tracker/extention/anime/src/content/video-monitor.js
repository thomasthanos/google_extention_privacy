/**
 * Anime Tracker - Video Monitor
 * Handles video element detection and monitoring
 */

const VideoMonitor = {
    // State
    videoElement: null,
    checkInterval: null,
    progressSaveInterval: null,
    cleanupFunctions: [],
    retryCount: 0,

    /**
     * Add cleanup function
     */
    addCleanup(fn) {
        this.cleanupFunctions.push(fn);
    },

    /**
     * Execute all cleanup functions
     */
    cleanup() {
        const { Logger } = window.AnimeTrackerContent;
        
        this.cleanupFunctions.forEach(fn => {
            try {
                fn();
            } catch (e) {
                Logger.error('Cleanup error:', e);
            }
        });
        this.cleanupFunctions = [];
        
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        
        if (this.progressSaveInterval) {
            clearInterval(this.progressSaveInterval);
            this.progressSaveInterval = null;
        }
        
        if (this.videoElement) {
            try {
                // Event listeners will be removed by cleanup functions
            } catch (e) {
                // Video element might be gone
            }
            this.videoElement = null;
        }
        
        this.retryCount = 0;
    },

    /**
     * Check if video element is active and visible
     */
    isVideoActive(video) {
        const { Logger } = window.AnimeTrackerContent;
        
        if (!video) return false;
        
        try {
            return (
                video.readyState > 0 &&
                video.duration > 0 &&
                video.duration < 100000 &&
                (video.offsetParent !== null || 
                 video.getBoundingClientRect().width > 50 ||
                 video.style.display !== 'none')
            );
        } catch (e) {
            Logger.error('Error checking video activity:', e);
            return false;
        }
    },

    /**
     * Find video element - check main page first, then iframes
     */
    findVideo() {
        const { Logger } = window.AnimeTrackerContent;
        
        // 1. Check main page
        const videos = document.querySelectorAll('video');
        for (const video of videos) {
            if (this.isVideoActive(video)) {
                return video;
            }
        }

        // 2. Check iframes (same-origin only)
        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (!iframeDoc) continue;

                // Plyr video wrapper
                const plyrWrapper = iframeDoc.querySelector('.plyr__video-wrapper');
                if (plyrWrapper) {
                    const video = plyrWrapper.querySelector('video');
                    if (this.isVideoActive(video)) {
                        Logger.debug('Found: Plyr iframe');
                        return video;
                    }
                }

                const artVideo = iframeDoc.querySelector('video.art-video');
                if (this.isVideoActive(artVideo)) {
                    Logger.debug('Found: art-video iframe');
                    return artVideo;
                }

                const iframeVideos = iframeDoc.querySelectorAll('video');
                for (const video of iframeVideos) {
                    if (this.isVideoActive(video)) {
                        Logger.debug('Found: iframe video');
                        return video;
                    }
                }
            } catch (e) {
                Logger.debug('Cross-origin iframe, skipping');
            }
        }

        return null;
    },

    /**
     * Setup video monitoring
     */
    async setupVideoMonitoring(video, animeInfo, eventHandlers) {
        const { CONFIG, Logger, ProgressTracker, Notifications } = window.AnimeTrackerContent;
        
        if (this.videoElement === video && this.isVideoActive(video)) return;

        this.cleanup();

        if (!this.isVideoActive(video)) {
            Logger.debug('Video not ready');
            return;
        }

        this.videoElement = video;
        
        // Add event listeners
        video.addEventListener('timeupdate', eventHandlers.handleTimeUpdate, { passive: true });
        
        // Add raw timeupdate handler for immediate tracking (no debounce)
        if (eventHandlers.handleTimeUpdateRaw) {
            video.addEventListener('timeupdate', eventHandlers.handleTimeUpdateRaw, { passive: true });
        }
        
        video.addEventListener('pause', eventHandlers.handlePause, { passive: true });
        video.addEventListener('seeked', eventHandlers.handleSeeked, { passive: true });
        video.addEventListener('ended', eventHandlers.handleEnded, { passive: true });
        
        document.addEventListener('visibilitychange', eventHandlers.handleVisibilityChange, { passive: true });
        window.addEventListener('beforeunload', eventHandlers.handleBeforeUnload);
        window.addEventListener('pagehide', eventHandlers.handleBeforeUnload, { passive: true });

        // Add cleanup functions
        this.addCleanup(() => {
            video.removeEventListener('timeupdate', eventHandlers.handleTimeUpdate);
            if (eventHandlers.handleTimeUpdateRaw) {
                video.removeEventListener('timeupdate', eventHandlers.handleTimeUpdateRaw);
            }
            video.removeEventListener('pause', eventHandlers.handlePause);
            video.removeEventListener('seeked', eventHandlers.handleSeeked);
            video.removeEventListener('ended', eventHandlers.handleEnded);
        });
        
        this.addCleanup(() => {
            document.removeEventListener('visibilitychange', eventHandlers.handleVisibilityChange);
            window.removeEventListener('beforeunload', eventHandlers.handleBeforeUnload);
            window.removeEventListener('pagehide', eventHandlers.handleBeforeUnload);
        });

        // Check for saved progress
        if (animeInfo) {
            const savedProgress = await ProgressTracker.getSavedProgress(animeInfo.uniqueId);
            if (savedProgress && savedProgress.currentTime > CONFIG.MIN_PROGRESS_TO_SAVE) {
                let retryCount = 0;
                const MAX_RETRIES = 20;

                const checkReady = () => {
                    if (video.readyState >= 2 && video.duration > 0) {
                        Notifications.showResumePrompt(
                            savedProgress,
                            () => {
                                video.currentTime = savedProgress.currentTime;
                                video.play().catch(() => {});
                                Logger.success(`Resumed @ ${savedProgress.currentTime}s`);
                            },
                            async () => {
                                await ProgressTracker.clearSavedProgress(animeInfo.uniqueId);
                                video.currentTime = 0;
                                video.play().catch(() => {});
                            }
                        );
                    } else {
                        retryCount++;
                        if (retryCount < MAX_RETRIES) {
                            setTimeout(checkReady, 500);
                        } else {
                            Logger.warn('Video not ready after', MAX_RETRIES, 'retries');
                        }
                    }
                };
                setTimeout(checkReady, 1000);
            }
        }

        // Start progress saving interval
        this.progressSaveInterval = setInterval(() => {
            if (this.videoElement && animeInfo && !video.paused) {
                const currentTime = this.videoElement.currentTime;
                const duration = this.videoElement.duration;
                if (currentTime > 0 && duration > 0) {
                    ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration);
                }
            }
        }, CONFIG.PROGRESS_SAVE_INTERVAL);

        this.addCleanup(() => {
            if (this.progressSaveInterval) {
                clearInterval(this.progressSaveInterval);
                this.progressSaveInterval = null;
            }
        });

        Logger.success('Video monitoring active');
    },

    /**
     * Find and monitor video element
     */
    findAndMonitorVideo(animeInfo, eventHandlers) {
        const video = this.findVideo();
        if (video) {
            this.setupVideoMonitoring(video, animeInfo, eventHandlers);
            return true;
        }
        return false;
    },

    /**
     * Start watching for video with retries
     */
    startWatching(animeInfo, eventHandlers) {
        const { CONFIG, Logger } = window.AnimeTrackerContent;
        
        Logger.debug('Looking for video...');
        const videoFound = this.findAndMonitorVideo(animeInfo, eventHandlers);
        
        if (!videoFound) {
            Logger.debug('Video not found, waiting...');
            
            this.checkInterval = setInterval(() => {
                if (this.retryCount >= CONFIG.MAX_RETRIES) {
                    clearInterval(this.checkInterval);
                    Logger.warn('Video not found after max retries');
                    return;
                }
                
                if (this.findAndMonitorVideo(animeInfo, eventHandlers)) {
                    clearInterval(this.checkInterval);
                    Logger.debug(`Video found after ${this.retryCount} retries`);
                }
                
                this.retryCount++;
            }, CONFIG.VIDEO_CHECK_INTERVAL);

            this.addCleanup(() => {
                if (this.checkInterval) {
                    clearInterval(this.checkInterval);
                    this.checkInterval = null;
                }
            });

            // MutationObserver for dynamic content
            let observerTimeout;
            const observer = new MutationObserver(() => {
                clearTimeout(observerTimeout);
                observerTimeout = setTimeout(() => {
                    if (this.findAndMonitorVideo(animeInfo, eventHandlers)) {
                        observer.disconnect();
                        if (this.checkInterval) clearInterval(this.checkInterval);
                        Logger.debug('Video found via observer');
                    }
                }, 100);
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            this.addCleanup(() => observer.disconnect());
        }
    },

    /**
     * Get current video element
     */
    getVideoElement() {
        return this.videoElement;
    }
};

// Export
window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.VideoMonitor = VideoMonitor;
