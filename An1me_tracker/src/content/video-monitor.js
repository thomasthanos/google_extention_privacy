const VideoMonitor = {
    videoElement: null,
    checkInterval: null,
    progressSaveInterval: null,
    cleanupFunctions: [],
    retryCount: 0,

    addCleanup(fn) {
        this.cleanupFunctions.push(fn);
    },

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
            this.videoElement = null;
        }

        this.retryCount = 0;
    },

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

    findVideo() {
        const { Logger } = window.AnimeTrackerContent;

        const artVideo = document.querySelector('video.art-video');
        if (this.isVideoActive(artVideo)) {
            Logger.debug('Found: art-video (main page)');
            return artVideo;
        }

        const videos = document.querySelectorAll('video');
        for (const video of videos) {
            if (this.isVideoActive(video)) return video;
        }

        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (!iframeDoc) continue;

                const plyrWrapper = iframeDoc.querySelector('.plyr__video-wrapper');
                if (plyrWrapper) {
                    const video = plyrWrapper.querySelector('video');
                    if (this.isVideoActive(video)) {
                        Logger.debug('Found: Plyr iframe');
                        return video;
                    }
                }

                const iframeArtVideo = iframeDoc.querySelector('video.art-video');
                if (this.isVideoActive(iframeArtVideo)) {
                    Logger.debug('Found: art-video iframe');
                    return iframeArtVideo;
                }

                const iframeVideos = iframeDoc.querySelectorAll('video');
                for (const video of iframeVideos) {
                    if (this.isVideoActive(video)) {
                        Logger.debug('Found: iframe video');
                        return video;
                    }
                }
            } catch {
                Logger.debug('Cross-origin iframe, skipping');
            }
        }

        return null;
    },

    async setupVideoMonitoring(video, animeInfo, eventHandlers) {
        const { CONFIG, Logger, ProgressTracker, Notifications } = window.AnimeTrackerContent;

        if (this.videoElement === video && this.isVideoActive(video)) return;

        this.cleanup();

        if (!this.isVideoActive(video)) {
            Logger.debug('Video not ready');
            return;
        }

        this.videoElement = video;

        video.addEventListener('timeupdate', eventHandlers.handleTimeUpdate, { passive: true });

        if (eventHandlers.handleTimeUpdateRaw) {
            video.addEventListener('timeupdate', eventHandlers.handleTimeUpdateRaw, { passive: true });
        }
        if (eventHandlers.handleVideoMetadata) {
            video.addEventListener('loadedmetadata', eventHandlers.handleVideoMetadata, { passive: true });
            video.addEventListener('durationchange', eventHandlers.handleVideoMetadata, { passive: true });
            video.addEventListener('loadeddata', eventHandlers.handleVideoMetadata, { passive: true });
            Promise.resolve().then(() => eventHandlers.handleVideoMetadata());
        }

        video.addEventListener('pause', eventHandlers.handlePause, { passive: true });
        video.addEventListener('seeked', eventHandlers.handleSeeked, { passive: true });
        video.addEventListener('ended', eventHandlers.handleEnded, { passive: true });

        document.addEventListener('visibilitychange', eventHandlers.handleVisibilityChange, { passive: true });
        window.addEventListener('beforeunload', eventHandlers.handleBeforeUnload);
        window.addEventListener('pagehide', eventHandlers.handleBeforeUnload, { passive: true });

        this.addCleanup(() => {
            video.removeEventListener('timeupdate', eventHandlers.handleTimeUpdate);
            if (eventHandlers.handleTimeUpdateRaw) {
                video.removeEventListener('timeupdate', eventHandlers.handleTimeUpdateRaw);
            }
            if (eventHandlers.handleVideoMetadata) {
                video.removeEventListener('loadedmetadata', eventHandlers.handleVideoMetadata);
                video.removeEventListener('durationchange', eventHandlers.handleVideoMetadata);
                video.removeEventListener('loadeddata', eventHandlers.handleVideoMetadata);
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

        if (animeInfo) {
            const savedProgress = await ProgressTracker.getSavedProgress(animeInfo.uniqueId);
            if (savedProgress && savedProgress.currentTime > CONFIG.MIN_PROGRESS_TO_SAVE) {
                savedProgress.uniqueId = animeInfo.uniqueId;

                let retryCount = 0;
                const MAX_RETRIES = 20;

                const checkReady = () => {
                    if (video.readyState >= 2 && video.duration > 0) {
                        Notifications.showResumePrompt(
                            savedProgress,
                            () => {
                                video.currentTime = savedProgress.currentTime;
                                video.play().catch(() => { });
                                Logger.success(`Resumed @ ${savedProgress.currentTime}s`);
                            },
                            () => {
                                video.currentTime = 0;
                                video.play().catch(() => { });
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

        let _lastSavedTime = -1;
        const tickSave = () => {
            if (this.videoElement && animeInfo && !video.paused) {
                const currentTime = this.videoElement.currentTime;
                const duration = this.videoElement.duration;
                if (currentTime > 0 && duration > 0 && Math.floor(currentTime) !== _lastSavedTime) {
                    _lastSavedTime = Math.floor(currentTime);
                    ProgressTracker.saveVideoProgress(animeInfo.uniqueId, currentTime, duration);
                }
            }
        };

        const startSaveInterval = () => {
            if (this.progressSaveInterval) return;
            this.progressSaveInterval = setInterval(tickSave, CONFIG.PROGRESS_SAVE_INTERVAL);
        };
        const stopSaveInterval = () => {
            if (this.progressSaveInterval) {
                clearInterval(this.progressSaveInterval);
                this.progressSaveInterval = null;
            }
        };

        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
            startSaveInterval();
        }
        const visibilityHandler = () => {
            if (document.visibilityState === 'visible') startSaveInterval();
            else stopSaveInterval();
        };
        document.addEventListener('visibilitychange', visibilityHandler);

        this.addCleanup(() => {
            stopSaveInterval();
            document.removeEventListener('visibilitychange', visibilityHandler);
        });

        Logger.success('Video monitoring active');
    },

    findAndMonitorVideo(animeInfo, eventHandlers) {
        const video = this.findVideo();
        if (video) {
            this.setupVideoMonitoring(video, animeInfo, eventHandlers);
            return true;
        }
        return false;
    },

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

            const observerBudgetMs = CONFIG.VIDEO_CHECK_INTERVAL * CONFIG.MAX_RETRIES;
            const observerWatchdog = setTimeout(() => {
                observer.disconnect();
                clearTimeout(observerTimeout);
                Logger.debug('Video observer watchdog — disconnected after budget elapsed');
            }, observerBudgetMs);

            this.addCleanup(() => {
                observer.disconnect();
                clearTimeout(observerTimeout);
                clearTimeout(observerWatchdog);
            });
        }
    },

    getVideoElement() {
        return this.videoElement;
    }
};

window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.VideoMonitor = VideoMonitor;