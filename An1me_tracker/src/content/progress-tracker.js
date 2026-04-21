const ProgressTracker = {
    lastSavedProgress: new Map(),
    lastSaveTime: 0,
    saveInProgress: false,
    saveQueue: [],
    isProcessingQueue: false,
    pendingSeekSave: null,
    seekSaveTimeout: null,
    MAX_REASONABLE_DURATION_SECONDS: 6 * 60 * 60,

    _vpCache: null,
    _vpCacheTime: 0,
    _VP_CACHE_TTL: 5000,

    _adCache: null,
    _adCacheTime: 0,
    _AD_CACHE_TTL: 15000,

    _emergencyPruneProgress(videoProgress, keepId) {
        const entries = Object.entries(videoProgress);
        entries.sort((a, b) => {
            const ta = a[1]?.savedAt ? new Date(a[1].savedAt).getTime() : 0;
            const tb = b[1]?.savedAt ? new Date(b[1].savedAt).getTime() : 0;
            return tb - ta;
        });
        const MAX = 50;
        const pruned = {};
        if (keepId && videoProgress[keepId]) pruned[keepId] = videoProgress[keepId];
        for (const [id, p] of entries) {
            if (Object.keys(pruned).length >= MAX) break;
            pruned[id] = p;
        }
        return pruned;
    },

    _isEpisodeAlreadyTrackedSync(uniqueId, animeData) {
        if (!uniqueId || !animeData) return false;
        const m = uniqueId.match(/^(.+)__episode-(\d+)$/);
        if (!m) return false;
        const slug = m[1];
        const num = parseInt(m[2], 10);
        const anime = animeData[slug];
        if (!anime || !Array.isArray(anime.episodes)) return false;
        return anime.episodes.some(ep => Number(ep?.number) === num);
    },

    _compactNow() {
        return new Date().toISOString().split('.')[0] + 'Z';
    },

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

    getCoverImageUrl() {
        try {
            const coverImageElement = document.querySelector('.anime-main-image')
                || document.querySelector('.anime-featured img');
            return coverImageElement?.src || null;
        } catch (e) {
            return null;
        }
    },

    shouldMarkComplete(currentTime, duration) {
        const { CONFIG } = window.AnimeTrackerContent;

        if (!duration || duration <= 0) return false;

        const progress = currentTime / duration;
        const remainingTime = duration - currentTime;

        const progressThreshold = (CONFIG.COMPLETED_PERCENTAGE || 85) / 100;
        const outroThreshold = CONFIG.REMAINING_TIME_THRESHOLD || 120;

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

            const now = Date.now();
            let videoProgress;
            let animeData;

            const vpCacheHit = this._vpCache && (now - this._vpCacheTime) < this._VP_CACHE_TTL;
            const adCacheHit = this._adCache && (now - this._adCacheTime) < this._AD_CACHE_TTL;

            if (vpCacheHit && adCacheHit) {
                videoProgress = this._vpCache;
                animeData = this._adCache;
            } else {
                const keys = [];
                if (!vpCacheHit) keys.push('videoProgress');
                if (!adCacheHit) keys.push('animeData');
                const result = await Storage.get(keys);
                videoProgress = vpCacheHit ? this._vpCache : (result.videoProgress || {});
                animeData = adCacheHit ? this._adCache : (result.animeData || {});
                if (!adCacheHit) { this._adCache = animeData; this._adCacheTime = now; }
            }

            if (this._isEpisodeAlreadyTrackedSync(uniqueId, animeData)) {
                Logger.debug('Skip progress save: episode already tracked', uniqueId);
                return;
            }

            const graceSeconds = Number(CONFIG.NEW_ANIME_GRACE_SECONDS) || 0;
            if (graceSeconds > 0 && currentTime < graceSeconds) {
                const slugMatch = uniqueId.match(/^(.+)__episode-\d+$/);
                const slug = slugMatch ? slugMatch[1] : null;
                if (slug && !animeData[slug]) {
                    Logger.debug(`Skip new-anime save (<${graceSeconds}s): ${uniqueId} @ ${Math.floor(currentTime)}s`);
                    return;
                }
            }

            if (typeof videoProgress !== 'object' || Array.isArray(videoProgress)) {
                Logger.warn('Invalid videoProgress structure, resetting');
                videoProgress = {};
            }

            videoProgress = this.cleanVideoProgress(videoProgress, uniqueId);

            const existingProgress = videoProgress[uniqueId];
            const newCurrentTime = Math.floor(currentTime);
            const newDuration = Math.floor(duration);
            const newPercentage = Math.floor((currentTime / duration) * 100);

            if (existingProgress && existingProgress.currentTime > newCurrentTime) {
                return;
            }

            const MIN_ADVANCE_SECONDS = 3;
            if (existingProgress &&
                existingProgress.duration === newDuration &&
                (newCurrentTime - existingProgress.currentTime) < MIN_ADVANCE_SECONDS) {
                return;
            }

            const coverImage = !existingProgress?.coverImage ? this.getCoverImageUrl() : existingProgress.coverImage;

            let pagePath = existingProgress?.pagePath;
            try {
                const pathMatch = (window.location?.pathname || '').match(/\/watch\/([^/?#]+)/);
                const currentPathSlug = pathMatch ? pathMatch[1] : '';
                const idMatch = uniqueId.match(/^(.+)__episode-(\d+)$/);
                if (currentPathSlug && idMatch) {
                    const defaultPathSlug = `${idMatch[1]}-episode-${idMatch[2]}`;
                    pagePath = currentPathSlug === defaultPathSlug ? undefined : currentPathSlug;
                }
            } catch { }

            const nowIso = this._compactNow();
            videoProgress[uniqueId] = {
                currentTime: newCurrentTime,
                duration: newDuration,
                savedAt: nowIso,
                percentage: newPercentage,
                watchedAt: existingProgress?.watchedAt || nowIso,
                coverImage: coverImage || undefined,
                pagePath: pagePath || undefined
            };

            try {
                await Storage.set({ videoProgress });
            } catch (err) {
                const msg = (err && err.message) || '';
                if (msg.includes('QUOTA') || msg.includes('quota')) {
                    Logger.warn('Storage quota hit — pruning videoProgress and retrying');
                    const pruned = this._emergencyPruneProgress(videoProgress, uniqueId);
                    try {
                        await Storage.set({ videoProgress: pruned });
                        videoProgress = pruned;
                    } catch (err2) {
                        Logger.error('Retry after prune failed:', err2);
                        throw err2;
                    }
                } else {
                    throw err;
                }
            }
            this._vpCache = videoProgress;
            this._vpCacheTime = Date.now();
            Logger.debug(`Progress saved: ${uniqueId} → ${videoProgress[uniqueId].percentage}% (${newCurrentTime}s/${Math.floor(duration)}s)`);

            if (!this._watchlistSynced && newCurrentTime >= 120) {
                this._watchlistSynced = true;
                try {
                    const { WatchlistSync } = window.AnimeTrackerContent;
                    if (WatchlistSync) {
                        const slugMatch = uniqueId.match(/^(.+)__episode-\d+$/);
                        const slug = slugMatch ? slugMatch[1] : null;
                        if (slug) {
                            const adResult = await Storage.get(['animeData']);
                            const ad = adResult.animeData || {};
                            const entry = ad[slug] || null;
                            const siteId = ad[slug]?.siteAnimeId;
                            const pageId = siteId || (window.AnimeTrackerContent.AnimeParser?.extractSiteAnimeId?.());
                            if (pageId) {
                                WatchlistSync.syncFromStorage(pageId, slug, {
                                    fallbackType: WatchlistSync.getProgressFallbackType(entry, slug)
                                });
                            }
                        }
                    }
                } catch { }
            }
        } catch (e) {
            if (e.message && e.message.includes('Extension context invalidated')) {
            } else {
                Logger.error('Save progress exception:', e);
                throw e;
            }
        } finally {
            this.saveInProgress = false;
            if (this.saveQueue.length > 0 && Storage.isContextValid()) {
                setTimeout(() => {
                    if (Storage.isContextValid()) this.processSaveQueue();
                }, 100);
            }
        }
    },

    saveVideoProgress(uniqueId, currentTime, duration, force = false, urgent = false) {
        const { CONFIG, Logger } = window.AnimeTrackerContent;

        if (currentTime < CONFIG.MIN_PROGRESS_TO_SAVE) return;

        if (!force && typeof document !== 'undefined'
            && document.visibilityState && document.visibilityState !== 'visible') {
            return;
        }

        if (!force && this.shouldMarkComplete(currentTime, duration)) return;

        const now = Date.now();
        const regularThrottleMs = Math.max(5000, Number(CONFIG.PROGRESS_WRITE_THROTTLE_MS) || 45000);
        const pauseThrottleMs = Math.max(1000, Number(CONFIG.PAUSE_WRITE_THROTTLE_MS) || 15000);
        const urgentThrottleMs = Math.max(500, Number(CONFIG.FORCED_PROGRESS_WRITE_THROTTLE_MS) || 3000);
        const throttleMs = !force ? regularThrottleMs : (urgent ? urgentThrottleMs : pauseThrottleMs);

        if (urgent) {
        } else if ((now - this.lastSaveTime) < throttleMs) {
            this.pendingSeekSave = { uniqueId, currentTime, duration, urgent };

            if (this.seekSaveTimeout) {
                clearTimeout(this.seekSaveTimeout);
            }

            this.seekSaveTimeout = setTimeout(() => {
                this.seekSaveTimeout = null;
                if (this.pendingSeekSave) {
                    const { uniqueId: id, currentTime: time, duration: dur, urgent: u } = this.pendingSeekSave;
                    this.pendingSeekSave = null;
                    this.saveVideoProgress(id, time, dur, true, u);
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
            this._vpCache = videoProgress;
            this._vpCacheTime = Date.now();
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

            const result = await Storage.get(['animeData', 'deletedAnime']);
            const animeData = result.animeData || {};
            const deletedAnime = { ...(result.deletedAnime || {}) };
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

            const result = await Storage.get(['animeData', 'deletedAnime']);
            const animeData = result.animeData || {};
            const deletedAnime = { ...(result.deletedAnime || {}) };
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
            anime.lastWatched = this._compactNow();
            await Storage.set({ animeData });
            this._adCache = animeData;
            this._adCacheTime = Date.now();
            Logger.debug(`Refreshed tracked duration: ${animeKey} (${validDuration}s)`);
            return true;
        } catch (e) {
            Logger.error('Failed to refresh tracked duration:', e);
            return false;
        }
    },

    async saveWatchedEpisode(info, videoDuration) {
        const { Storage, Logger, EpisodeWriter } = window.AnimeTrackerContent;
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

            const result = await Storage.get(['animeData', 'deletedAnime', 'videoProgress']);
            const animeData = result.animeData || {};
            const deletedAnime = { ...(result.deletedAnime || {}) };
            const videoProgress = { ...(result.videoProgress || {}) };

            const validDuration = this.normalizeDuration(videoDuration);
            if (!validDuration) {
                Logger.error('Invalid normalized video duration:', videoDuration);
                throw new Error('Invalid normalized video duration');
            }

            const writeResult = EpisodeWriter.writeEpisode(info, validDuration, animeData, {
                logPrefix: 'saveWatchedEpisode'
            });
            if (!writeResult.changed) {
                Logger.debug('Episode already tracked:', info.uniqueId);
                return false;
            }

            delete deletedAnime[info.animeSlug];

            const tossIds = [info.uniqueId];
            if (info.isDoubleEpisode && info.secondEpisodeNumber) {
                const base = info.uniqueId.replace(/__episode-\d+$/, '');
                tossIds.push(`${base}__episode-${info.secondEpisodeNumber}`);
            }
            let progressTouched = false;
            for (const id of tossIds) {
                if (videoProgress[id]) { delete videoProgress[id]; progressTouched = true; }
            }
            const payload = { animeData, deletedAnime };
            if (progressTouched) payload.videoProgress = videoProgress;
            await Storage.set(payload);
            this._adCache = animeData;
            this._adCacheTime = Date.now();
            if (progressTouched) {
                this._vpCache = videoProgress;
                this._vpCacheTime = Date.now();
            }

            if (writeResult.changeType === 'updated-placeholder') {
                Logger.debug(`Updated placeholder duration for tracked episode: ${info.uniqueId}`);
                return true;
            }

            Logger.success(`✓ Tracked: ${info.animeTitle} Ep${info.episodeNumber}${info.isDoubleEpisode ? '-' + info.secondEpisodeNumber : ''}`);
            Notifications.showCompletion(info);

            try {
                const { WatchlistSync } = window.AnimeTrackerContent;
                const siteId = animeData[info.animeSlug].siteAnimeId || info.siteAnimeId;
                if (WatchlistSync && siteId) {
                    WatchlistSync.syncFromStorage(siteId, info.animeSlug, {
                        fallbackType: 'watching',
                        keepFirstEpisodeAsPlanToWatch: true
                    });
                }
            } catch { }

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
        this._vpCache = null;
        this._vpCacheTime = 0;
        this._adCache = null;
        this._adCacheTime = 0;
        this._watchlistSynced = false;
    }
};

window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.ProgressTracker = ProgressTracker;
