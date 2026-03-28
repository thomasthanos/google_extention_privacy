// Injection guard: if the content script is loaded a second time in the same
// page context (e.g. extension reload without full navigation), reuse the
// existing singleton and skip re-creating it. This prevents duplicate observers
// and dangling event listeners from the previous injection.
if (window.AnimeTrackerContent?.VideoMonitor?._initialized) {
    // Already running — clean up the stale instance so the new init() call
    // in main.js gets a fresh slate.
    window.AnimeTrackerContent.VideoMonitor.cleanup();
}

const VideoMonitor = {
    _initialized: true,
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
            return artVideo;
        }

        const videos = document.querySelectorAll('video');
        for (const video of videos) {
            if (this.isVideoActive(video)) return video;
        }
        // Cross-origin iframes throw SecurityError — caught silently.
        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (!iframeDoc) continue;

                const plyrWrapper = iframeDoc.querySelector('.plyr__video-wrapper');
                if (plyrWrapper) {
                    const video = plyrWrapper.querySelector('video');
                    if (this.isVideoActive(video)) {
                        return video;
                    }
                }

                const iframeArtVideo = iframeDoc.querySelector('video.art-video');
                if (this.isVideoActive(iframeArtVideo)) {
                    return iframeArtVideo;
                }

                const iframeVideos = iframeDoc.querySelectorAll('video');
                for (const video of iframeVideos) {
                    if (this.isVideoActive(video)) {
                        return video;
                    }
                }
            } catch {            }
        }

        return null;
    },

    async setupVideoMonitoring(video, animeInfo, eventHandlers) {
        const { CONFIG, Logger, ProgressTracker, Notifications } = window.AnimeTrackerContent;

        if (this.videoElement === video && this.isVideoActive(video)) return;

        this.cleanup();

        if (!this.isVideoActive(video)) return;

        this.videoElement = video;

        video.addEventListener('timeupdate', eventHandlers.handleTimeUpdate, { passive: true });

        if (eventHandlers.handleTimeUpdateRaw) {
            video.addEventListener('timeupdate', eventHandlers.handleTimeUpdateRaw, { passive: true });
        }
        if (eventHandlers.handleVideoMetadata) {
            video.addEventListener('loadedmetadata', eventHandlers.handleVideoMetadata, { passive: true });
            video.addEventListener('durationchange', eventHandlers.handleVideoMetadata, { passive: true });
            video.addEventListener('loadeddata', eventHandlers.handleVideoMetadata, { passive: true });
            // Fire once immediately (microtask) to catch already-loaded metadata.
            // Attach a catch so any rejection from the async handler is handled
            // here rather than becoming an unhandled promise rejection.
            Promise.resolve()
                .then(() => eventHandlers.handleVideoMetadata())
                .catch(e => Logger.error('Initial metadata handler failed:', e));
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
                                video.play().catch(() => {});
                            },
                            () => {
                                video.currentTime = 0;
                                video.play().catch(() => {});
                            }
                        );
                    } else {
                        retryCount++;
                        if (retryCount < MAX_RETRIES) {
                            setTimeout(checkReady, 500);
                        }
                    }
                };
                setTimeout(checkReady, 1000);
            }
        }

        this.progressSaveInterval = setInterval(() => {
            if (this.videoElement && animeInfo && !video.paused) {
                const currentTime = this.videoElement.currentTime;
                const duration = this.videoElement.duration;
                if (currentTime > 0 && duration > 0) {
                    // saveVideoProgress is sync-entry but dispatches an async
                    // performSaveProgress internally (handled with .catch there).
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

        const videoFound = this.findAndMonitorVideo(animeInfo, eventHandlers);

        if (!videoFound) {
            this.checkInterval = setInterval(() => {
                if (this.retryCount >= CONFIG.MAX_RETRIES) {
                    clearInterval(this.checkInterval);
                    Logger.warn('Video not found after max retries');
                    return;
                }

                if (this.findAndMonitorVideo(animeInfo, eventHandlers)) {
                    clearInterval(this.checkInterval);
                }

                this.retryCount++;
            }, CONFIG.VIDEO_CHECK_INTERVAL);

            this.addCleanup(() => {
                if (this.checkInterval) {
                    clearInterval(this.checkInterval);
                    this.checkInterval = null;
                }
            });            let observerTimeout;
            const observer = new MutationObserver(() => {
                clearTimeout(observerTimeout);
                observerTimeout = setTimeout(() => {
                    if (this.findAndMonitorVideo(animeInfo, eventHandlers)) {
                        observer.disconnect();
                        if (this.checkInterval) clearInterval(this.checkInterval);
                    }
                }, 100);
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            this.addCleanup(() => {
                observer.disconnect();
                if (observerTimeout) { clearTimeout(observerTimeout); observerTimeout = null; }
            });
        }
    },

    getVideoElement() {
        return this.videoElement;
    }
};

window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.VideoMonitor = VideoMonitor;
