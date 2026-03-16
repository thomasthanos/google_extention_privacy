/**
 * Anime Tracker - Progress Tracker
 * Handles video progress saving and loading
 */

const ProgressTracker = {
    // State
    lastSavedProgress: new Map(),
    lastSaveTime: 0,
    saveInProgress: false,
    saveQueue: [],
    isProcessingQueue: false,
    pendingSeekSave: null,
    seekSaveTimeout: null,
    MAX_REASONABLE_DURATION_SECONDS: 6 * 60 * 60,

    normalizeDuration(duration) {
        let value = Math.round(Number(duration) || 0);
        if (!Number.isFinite(value) || value <= 0) return 0;
        if (value > this.MAX_REASONABLE_DURATION_SECONDS) {
            value = this.MAX_REASONABLE_DURATION_SECONDS;
        }
        return value;
    },

    isPlaceholderDuration(duration) {
        const d = Number(duration) || 0;
        return d <= 0 || d === 1440 || d === 6000 || d === 7200;
    },

    // Two signals: (A) progress >= threshold, or (B) within 120s of end AND >= 60% watched.
    // The 60% guard on signal B prevents false positives on short clips.
    shouldMarkComplete(currentTime, duration) {
        const { CONFIG } = window.AnimeTrackerContent;

        if (!duration || duration <= 0) return false;

        const progress      = currentTime / duration;
        const remainingTime = duration - currentTime;

        const progressThreshold = (CONFIG.COMPLETED_PERCENTAGE || 85) / 100;
        const outroThreshold    = CONFIG.REMAINING_TIME_THRESHOLD || 120;

        if (progress >= progressThreshold) return true;

        const MIN_OUTRO_PROGRESS = 0.60;
        if (remainingTime <= outroThreshold && progress >= MIN_OUTRO_PROGRESS) return true;

        return false;
    },

    cleanLastSavedProgress() {
        const { CONFIG } = window.AnimeTrackerContent;
        if (this.lastSavedProgress.size > CONFIG.MAX_SAVED_PROGRESS_ENTRIES) {
            Array.from(this.lastSavedProgress.keys())
                .slice(0, this.lastSavedProgress.size - CONFIG.MAX_SAVED_PROGRESS_ENTRIES)
                .forEach(key => this.lastSavedProgress.delete(key));
        }
    },

    cleanVideoProgress(videoProgress, currentUniqueId) {
        const { CONFIG, Logger } = window.AnimeTrackerContent;

        if (!videoProgress || typeof videoProgress !== 'object') return {};
        if (!currentUniqueId || typeof currentUniqueId !== 'string') {
            Logger.warn('cleanVideoProgress called with invalid currentUniqueId:', currentUniqueId);
            return videoProgress;
        }

        const now = Date.now();
        const maxAge = CONFIG.MAX_PROGRESS_AGE_DAYS * 24 * 60 * 60 * 1000;
        const entries = Object.entries(videoProgress);

        const filtered = entries.filter(([id, progress]) => {
            if (id === currentUniqueId) return true;

            if (progress.deleted) {
                const tombstoneAge = now - (progress.deletedAt ? new Date(progress.deletedAt).getTime() : 0);
                const TOMBSTONE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
                if (tombstoneAge > TOMBSTONE_MAX_AGE) {
                    Logger.debug('Removing expired tombstone:', id);
                    return false;
                }
                return true;
            }

            if (progress.percentage >= CONFIG.COMPLETED_PERCENTAGE ||
                (progress.duration && (progress.duration - progress.currentTime) <= CONFIG.REMAINING_TIME_THRESHOLD)) {
                Logger.debug('Removing completed progress:', id);
                return false;
            }

            if (progress.savedAt) {
                const age = now - new Date(progress.savedAt).getTime();
                if (age > maxAge) {
                    Logger.debug('Removing old progress:', id);
                    return false;
                }
            }

            return true;
        });

        filtered.sort((a, b) => {
            const timeA = a[1].savedAt ? new Date(a[1].savedAt).getTime() : 0;
            const timeB = b[1].savedAt ? new Date(b[1].savedAt).getTime() : 0;
            return timeB - timeA;
        });

        const limited = filtered.slice(0, CONFIG.MAX_PROGRESS_ENTRIES);

        const cleaned = {};
        limited.forEach(([id, progress]) => {
            cleaned[id] = progress;
        });

        const removedCount = entries.length - limited.length;
        if (removedCount > 0) {
            Logger.info('Cleaned', removedCount, 'old progress entries');
        }

        return cleaned;
    },

    async processSaveQueue() {
        const { Logger } = window.AnimeTrackerContent;

        if (this.isProcessingQueue || this.saveQueue.length === 0) return;

        this.isProcessingQueue = true;
        let consecutiveFailures = 0;
        const MAX_CONSECUTIVE_FAILURES = 3;

        while (this.saveQueue.length > 0 && consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
            const saveTask = this.saveQueue.shift();
            saveTask.retryCount = (saveTask.retryCount || 0);

            try {
                await this.performSaveProgress(saveTask.uniqueId, saveTask.currentTime, saveTask.duration);
                consecutiveFailures = 0;
            } catch (e) {
                Logger.error('Failed to save progress from queue:', e);
                consecutiveFailures++;

                if (saveTask.retryCount < 2) {
                    saveTask.retryCount++;
                    this.saveQueue.push(saveTask);
                    await new Promise(resolve => setTimeout(resolve, 1000 * saveTask.retryCount));
                } else {
                    Logger.warn('Dropping save task after max retries:', saveTask.uniqueId);
                }
            }
        }

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && this.saveQueue.length > 0) {
            Logger.error('Too many consecutive failures, clearing save queue');
            this.saveQueue = [];
        }

        this.isProcessingQueue = false;
    },

    async performSaveProgress(uniqueId, currentTime, duration) {
        const { CONFIG, Storage, Logger } = window.AnimeTrackerContent;

        if (!Storage.isContextValid()) {
            return;
        }

        if (this.saveInProgress) {
            if (this.saveQueue.length >= CONFIG.MAX_SAVE_QUEUE_SIZE) {
                this.saveQueue.shift();
            }
            this.saveQueue.push({ uniqueId, currentTime, duration, retryCount: 0 });
            return;
        }

        this.saveInProgress = true;

        try {
            if (!uniqueId || typeof uniqueId !== 'string') {
                throw new Error('Invalid uniqueId for progress save');
            }

            if (isNaN(currentTime) || isNaN(duration) || duration <= 0 ||
                !isFinite(currentTime) || !isFinite(duration) ||
                currentTime < 0 || duration > 100000) {
                throw new Error(`Invalid time values: currentTime=${currentTime}, duration=${duration}`);
            }

            const result = await Storage.get(['videoProgress']);
            let videoProgress = result.videoProgress || {};

            if (typeof videoProgress !== 'object' || Array.isArray(videoProgress)) {
                Logger.warn('Invalid videoProgress structure, resetting');
                videoProgress = {};
            }

            videoProgress = this.cleanVideoProgress(videoProgress, uniqueId);

            const existingProgress = videoProgress[uniqueId];
            const newCurrentTime = Math.floor(currentTime);

            if (existingProgress && existingProgress.currentTime > newCurrentTime) {
                Logger.debug('Keeping higher existing progress:', existingProgress.currentTime, 'vs new:', newCurrentTime);
                return;
            }

            videoProgress[uniqueId] = {
                currentTime: newCurrentTime,
                duration: Math.floor(duration),
                savedAt: new Date().toISOString(),
                percentage: Math.floor((currentTime / duration) * 100)
            };

            await Storage.set({ videoProgress });
        } catch (e) {
            if (e.message && e.message.includes('Extension context invalidated')) {
                // silent — extension reloads
            } else {
                Logger.error('Save progress exception:', e);
                throw e;
            }
        } finally {
            this.saveInProgress = false;
            if (this.saveQueue.length > 0 && Storage.isContextValid()) {
                setTimeout(() => this.processSaveQueue(), 100);
            }
        }
    },

    saveVideoProgress(uniqueId, currentTime, duration, force = false) {
        const { CONFIG, Logger } = window.AnimeTrackerContent;

        if (currentTime < CONFIG.MIN_PROGRESS_TO_SAVE) return;
        if (this.shouldMarkComplete(currentTime, duration)) return;

        const now = Date.now();
        const throttleMs = force ? 2000 : 10000;

        if ((now - this.lastSaveTime) < throttleMs && !force) {
            this.pendingSeekSave = { uniqueId, currentTime, duration };

            if (this.seekSaveTimeout) {
                clearTimeout(this.seekSaveTimeout);
            }

            this.seekSaveTimeout = setTimeout(() => {
                this.seekSaveTimeout = null;
                if (this.pendingSeekSave) {
                    const { uniqueId: id, currentTime: time, duration: dur } = this.pendingSeekSave;
                    this.pendingSeekSave = null;
                    this.saveVideoProgress(id, time, dur, true);
                }
            }, throttleMs);
            return;
        }

        if (this.seekSaveTimeout) {
            clearTimeout(this.seekSaveTimeout);
            this.seekSaveTimeout = null;
        }
        this.pendingSeekSave = null;

        this.lastSavedProgress.set(uniqueId, currentTime);
        this.lastSaveTime = now;
        this.cleanLastSavedProgress();

        const pct = Math.floor((currentTime / duration) * 100);
        Logger.debug(`Progress saved: ${pct}% (need ${CONFIG.COMPLETED_PERCENTAGE}%) @ ${Math.floor(currentTime)}s / ${Math.floor(duration)}s`);
        Logger.progress(uniqueId, pct, Math.floor(currentTime));

        this.performSaveProgress(uniqueId, currentTime, duration).catch(e => {
            Logger.error('Save failed', e);
        });
    },

    async getSavedProgress(uniqueId) {
        const { Storage, Logger } = window.AnimeTrackerContent;

        try {
            const result = await Storage.get(['videoProgress']);
            const videoProgress = result.videoProgress || {};
            const entry = videoProgress[uniqueId] || null;
            if (entry && entry.deleted) return null;
            return entry;
        } catch (e) {
            Logger.error('Exception getting progress:', e);
            return null;
        }
    },

    async clearSavedProgress(uniqueId) {
        const { Storage, Logger } = window.AnimeTrackerContent;

        if (this.seekSaveTimeout) {
            clearTimeout(this.seekSaveTimeout);
            this.seekSaveTimeout = null;
        }
        this.pendingSeekSave = null;

        try {
            const result = await Storage.get(['videoProgress']);
            const videoProgress = result.videoProgress || {};
            delete videoProgress[uniqueId];
            await Storage.set({ videoProgress });
            Logger.debug('Cleared progress for:', uniqueId);
        } catch (e) {
            Logger.error('Error clearing progress:', e);
            throw e;
        }
    },

    async isEpisodeTracked(uniqueId) {
        const { Storage, Logger } = window.AnimeTrackerContent;

        try {
            const parts = uniqueId.split('__');
            const animeSlug = parts[0];
            const episodeSlug = parts[1];

            const episodeMatch = episodeSlug.match(/episode-(\d+)/i) || episodeSlug.match(/(\d+)/);
            const episodeNumber = episodeMatch ? parseInt(episodeMatch[1], 10) : NaN;

            if (isNaN(episodeNumber)) {
                Logger.warn('Could not extract episode number from:', episodeSlug);
                return false;
            }

            const result = await Storage.get(['animeData']);
            const animeData = result.animeData || {};
            const anime = animeData[animeSlug];

            if (!anime || !anime.episodes || !Array.isArray(anime.episodes)) {
                return false;
            }

            return anime.episodes.some(ep => ep.number === episodeNumber);
        } catch (e) {
            Logger.error('Exception checking tracked episodes:', e);
            return false;
        }
    },

    async refreshTrackedEpisodeDuration(info, videoDuration) {
        const { Storage, Logger } = window.AnimeTrackerContent;

        try {
            if (!info || !info.animeSlug) return false;

            const validDuration = this.normalizeDuration(videoDuration);
            if (!validDuration) return false;

            const result = await Storage.get(['animeData']);
            const animeData = result.animeData || {};
            const animeKey = info.animeSlug;
            const anime = animeData[animeKey];
            if (!anime || !Array.isArray(anime.episodes)) return false;

            const targetEpisode = Number(info.episodeNumber) || 0;
            const targetSecondEpisode = Number(info.secondEpisodeNumber) || 0;
            let changed = false;

            const updateEpisodeDuration = (episodeNumber) => {
                if (!Number.isFinite(episodeNumber) || episodeNumber <= 0) return false;

                const idx = anime.episodes.findIndex(ep => Number(ep?.number) === episodeNumber);
                if (idx === -1) return;

                const existing = anime.episodes[idx] || {};
                const currentDuration = Number(existing.duration) || 0;
                if (!this.isPlaceholderDuration(currentDuration) || currentDuration === validDuration) return;

                anime.episodes[idx] = {
                    ...existing,
                    duration: validDuration,
                    durationSource: 'video'
                };
                changed = true;
                return true;
            };

            const updatedMain = updateEpisodeDuration(targetEpisode);
            if (info.isDoubleEpisode && targetSecondEpisode > 0) {
                updateEpisodeDuration(targetSecondEpisode);
            }

            if (!updatedMain && anime.episodes.length === 1) {
                const onlyEpisode = anime.episodes[0] || {};
                const onlyDuration = Number(onlyEpisode.duration) || 0;
                if (this.isPlaceholderDuration(onlyDuration) && onlyDuration !== validDuration) {
                    anime.episodes[0] = {
                        ...onlyEpisode,
                        duration: validDuration,
                        durationSource: 'video'
                    };
                    changed = true;
                }
            }

            if (!changed) return false;

            anime.totalWatchTime = anime.episodes.reduce((sum, ep) => sum + (Number(ep?.duration) || 0), 0);
            anime.lastWatched = new Date().toISOString();
            await Storage.set({ animeData });
            Logger.info(`Refreshed tracked duration from player metadata: ${animeKey} (${validDuration}s)`);
            return true;
        } catch (e) {
            Logger.error('Failed to refresh tracked duration:', e);
            return false;
        }
    },

    async saveWatchedEpisode(info, videoDuration) {
        const { Storage, Logger } = window.AnimeTrackerContent;
        const { Notifications } = window.AnimeTrackerContent;

        try {
            if (!info || !info.animeSlug || !info.animeTitle || !info.episodeNumber) {
                Logger.error('Invalid episode info:', info);
                throw new Error('Invalid episode information');
            }

            if (!videoDuration || videoDuration <= 0 || isNaN(videoDuration)) {
                Logger.error('Invalid video duration:', videoDuration);
                throw new Error('Invalid video duration');
            }

            const result = await Storage.get(['animeData']);
            const animeData = result.animeData || {};

            if (!animeData[info.animeSlug]) {
                animeData[info.animeSlug] = {
                    title: info.animeTitle,
                    slug: info.animeSlug,
                    episodes: [],
                    totalWatchTime: 0,
                    lastWatched: null,
                    totalEpisodes: Number.isFinite(info.totalEpisodes) ? info.totalEpisodes : null
                };
            }

            if (!Array.isArray(animeData[info.animeSlug].episodes)) {
                Logger.warn('Episodes not an array, resetting:', info.animeSlug);
                animeData[info.animeSlug].episodes = [];
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

            const validDuration = this.normalizeDuration(videoDuration);
            if (!validDuration) {
                Logger.error('Invalid normalized video duration:', videoDuration);
                throw new Error('Invalid normalized video duration');
            }

            const existingIndex = animeData[info.animeSlug].episodes
                .findIndex(ep => ep.number === info.episodeNumber);

            if (existingIndex !== -1) {
                const existing = animeData[info.animeSlug].episodes[existingIndex] || {};
                const currentDuration = Number(existing.duration) || 0;

                if (this.isPlaceholderDuration(currentDuration) && currentDuration !== validDuration) {
                    animeData[info.animeSlug].episodes[existingIndex] = {
                        ...existing,
                        duration: validDuration,
                        durationSource: 'video'
                    };
                    animeData[info.animeSlug].totalWatchTime = animeData[info.animeSlug].episodes
                        .reduce((sum, ep) => sum + (Number(ep?.duration) || 0), 0);
                    animeData[info.animeSlug].lastWatched = new Date().toISOString();
                    await Storage.set({ animeData });
                    Logger.info(`Updated placeholder duration for tracked episode: ${info.uniqueId}`);
                    return true;
                }

                Logger.info('Episode already tracked:', info.uniqueId);
                return false;
            }

            const now = new Date();

            const episodeData = {
                number: info.episodeNumber,
                watchedAt: now.toISOString().split('.')[0] + 'Z',
                duration: validDuration,
                durationSource: 'video'
            };

            animeData[info.animeSlug].episodes.push(episodeData);
            animeData[info.animeSlug].totalWatchTime = (animeData[info.animeSlug].totalWatchTime || 0) + validDuration;
            animeData[info.animeSlug].lastWatched = new Date().toISOString();

            if (info.isDoubleEpisode && info.secondEpisodeNumber) {
                const alreadyHasSecond = animeData[info.animeSlug].episodes
                    .some(ep => ep.number === info.secondEpisodeNumber);
                if (!alreadyHasSecond) {
                    animeData[info.animeSlug].episodes.push({
                        number: info.secondEpisodeNumber,
                        watchedAt: now.toISOString().split('.')[0] + 'Z',
                        duration: validDuration,
                        durationSource: 'video'
                    });
                    Logger.info(`Double episode: also tracked Ep${info.secondEpisodeNumber}`);
                }
            }

            animeData[info.animeSlug].episodes.sort((a, b) => a.number - b.number);

            await Storage.set({ animeData });

            Logger.success(`✓ Tracked: ${info.animeTitle} Ep${info.episodeNumber}${info.isDoubleEpisode ? '-' + info.secondEpisodeNumber : ''}`);
            Notifications.showCompletion(info);
            return true;
        } catch (e) {
            Logger.error('Save failed', e);
            throw e;
        }
    },

    reset() {
        if (this.seekSaveTimeout) {
            clearTimeout(this.seekSaveTimeout);
            this.seekSaveTimeout = null;
        }
        this.pendingSeekSave = null;
        this.saveQueue = [];
        this.isProcessingQueue = false;
        this.saveInProgress = false;
        this.lastSavedProgress.clear();
        this.lastSaveTime = 0;
    }
};

// Export
window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.ProgressTracker = ProgressTracker;
