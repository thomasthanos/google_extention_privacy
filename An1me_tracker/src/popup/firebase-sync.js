/**
 * Anime Tracker - Firebase Sync
 * Handles Firebase authentication and cloud synchronization
 */

const {
    areProgressMapsEqual,
    shallowEqualDeletedAnime,
    shallowEqualObjectMap
} = window.AnimeTracker.MergeUtils;

const FirebaseSync = {
    // State
    currentUser: null,
    saveToCloudTimeout: null,
    isSavingToCloud: false,
    pendingSave: null,
    currentSavePromise: null,
    cloudSaveRetryCount: 0,
    userDocumentCache: null,
    USER_DOCUMENT_CACHE_TTL_MS: 5 * 60 * 1000,

    cloneAny(data) {
        if (data === null || typeof data === 'undefined') return null;
        try {
            if (typeof structuredClone === 'function') {
                return structuredClone(data);
            }
        } catch {
            // Fall through to JSON clone.
        }

        try {
            return JSON.parse(JSON.stringify(data));
        } catch {
            if (Array.isArray(data)) return data.slice();
            if (data && typeof data === 'object') return { ...data };
            return data;
        }
    },

    cloneSyncData(data) {
        const cloned = this.cloneAny(data);
        if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) {
            const source = (data && typeof data === 'object') ? data : {};
            return {
                animeData: source.animeData || {},
                videoProgress: source.videoProgress || {},
                deletedAnime: source.deletedAnime || {},
                groupCoverImages: source.groupCoverImages || {}
            };
        }

        return cloned;
    },

    clearCachedUserDocument(uid = null) {
        if (!uid) {
            this.userDocumentCache = null;
            return;
        }
        if (this.userDocumentCache?.uid === uid) {
            this.userDocumentCache = null;
        }
    },

    getCachedUserDocument(uid) {
        const cache = this.userDocumentCache;
        if (!uid || !cache || cache.uid !== uid) {
            return { hit: false, data: null };
        }

        if ((Date.now() - cache.cachedAt) > this.USER_DOCUMENT_CACHE_TTL_MS) {
            this.userDocumentCache = null;
            return { hit: false, data: null };
        }

        return {
            hit: true,
            data: this.cloneAny(cache.data)
        };
    },

    setCachedUserDocument(uid, data) {
        if (!uid) return;
        this.userDocumentCache = {
            uid,
            cachedAt: Date.now(),
            data: this.cloneAny(data)
        };
    },

    async hydrateSyncData(data) {
        const payload = this.cloneSyncData(data);
        const missingKeys = ['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages']
            .filter((key) => typeof payload[key] === 'undefined');

        if (missingKeys.length > 0) {
            try {
                const stored = await window.AnimeTracker.Storage.get(missingKeys);
                for (const key of missingKeys) {
                    payload[key] = stored[key] || this.pendingSave?.[key] || {};
                }
            } catch (error) {
                PopupLogger.warn('Firebase', 'Failed to hydrate sync payload from storage:', error);
                for (const key of missingKeys) {
                    payload[key] = this.pendingSave?.[key] || {};
                }
            }
        }

        payload.animeData = payload.animeData || {};
        payload.videoProgress = payload.videoProgress || {};
        payload.deletedAnime = payload.deletedAnime || {};
        payload.groupCoverImages = payload.groupCoverImages || {};
        return payload;
    },

    /**
     * Get current user
     */
    getUser() {
        return this.currentUser;
    },

    /**
     * Initialize Firebase and check auth state
     */
    async init(callbacks) {
        const { onUserSignedIn, onUserSignedOut, onError } = callbacks;
        
        try {
            await FirebaseLib.init();

            FirebaseLib.onAuthStateChanged((user) => {
                const prevUid = this.currentUser?.uid || null;
                this.currentUser = user;
                if (!user || prevUid !== user.uid) {
                    this.clearCachedUserDocument();
                }
                if (user) {
                    PopupLogger.log('Firebase', 'User signed in:', user.email);
                    if (onUserSignedIn) onUserSignedIn(user);
                } else {
                    PopupLogger.log('Firebase', 'No user');
                    if (onUserSignedOut) onUserSignedOut();
                }
            });

            PopupLogger.log('Firebase', 'Initialized');
        } catch (error) {
            PopupLogger.error('Firebase', 'Init error:', error);
            if (onError) onError(error);
        }
    },

    /**
     * Sign in with Google
     */
    async signInWithGoogle() {
        return await FirebaseLib.signInWithGoogle();
    },

    /**
     * Sign out
     */
    async signOut() {
        await FirebaseLib.signOut();
        this.currentUser = null;
        this.clearCachedUserDocument();
    },

    /**
     * Save data to cloud with debouncing
     */
    async saveToCloud(data, immediate = false) {
        const { CONFIG } = window.AnimeTracker;
        
        if (!this.currentUser) return Promise.resolve();

        this.pendingSave = await this.hydrateSyncData(data);

        if (this.saveToCloudTimeout) {
            clearTimeout(this.saveToCloudTimeout);
            this.saveToCloudTimeout = null;
        }

        if (immediate) {
            return this.performCloudSave();
        }

        return new Promise((resolve, reject) => {
            this.saveToCloudTimeout = setTimeout(async () => {
                try {
                    await this.performCloudSave();
                    resolve();
                } catch (error) {
                    PopupLogger.error('Firebase', 'Debounced save failed:', error);
                    reject(error);
                }
            }, CONFIG.CLOUD_SAVE_DEBOUNCE_MS);
        });
    },

    /**
     * Perform the actual cloud save
     */
    async performCloudSave(elements = null) {
        const { CONFIG } = window.AnimeTracker;

        if (this.currentSavePromise) {
            await this.currentSavePromise;
        }

        if (this.isSavingToCloud) {
            // Don't recurse — just mark that we have pending data; it will be
            // picked up in the finally block of the current save.
            return;
        }

        if (!this.pendingSave || !this.currentUser) {
            this.cloudSaveRetryCount = 0;
            return;
        }

        const dataToSave = this.pendingSave;
        this.pendingSave = null;
        this.isSavingToCloud = true;

        this.currentSavePromise = (async () => {
            try {
                if (!dataToSave.animeData || typeof dataToSave.animeData !== 'object') {
                    throw new Error('Invalid animeData for cloud save');
                }

                if (!dataToSave.videoProgress || typeof dataToSave.videoProgress !== 'object') {
                    throw new Error('Invalid videoProgress for cloud save');
                }

                const savedDoc = {
                    animeData: dataToSave.animeData || {},
                    videoProgress: dataToSave.videoProgress || {},
                    deletedAnime: dataToSave.deletedAnime || {},
                    groupCoverImages: dataToSave.groupCoverImages || {},
                    lastUpdated: new Date().toISOString(),
                    email: this.currentUser.email
                };

                await FirebaseLib.setDocument('users', this.currentUser.uid, savedDoc, {
                    fields: ['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages', 'lastUpdated', 'email']
                });
                this.setCachedUserDocument(this.currentUser.uid, savedDoc);
                PopupLogger.log('Firebase', 'Data saved to cloud');

                this.cloudSaveRetryCount = 0;

                if (elements?.syncStatus) {
                    elements.syncStatus.classList.add('synced');
                    elements.syncText.textContent = 'Cloud Synced';
                }
            } catch (error) {
                PopupLogger.error('Firebase', 'Save error:', error);

                if (elements?.syncStatus) {
                    elements.syncStatus.classList.remove('synced');
                    elements.syncText.textContent = 'Sync Error';
                }

                this.cloudSaveRetryCount++;
                if (this.cloudSaveRetryCount >= CONFIG.MAX_CLOUD_SAVE_RETRIES) {
                    PopupLogger.error('Firebase', 'Max retries reached, giving up');
                    this.cloudSaveRetryCount = 0;
                    return;
                }

                const retryDelay = Math.min(2000 * Math.pow(2, this.cloudSaveRetryCount - 1), CONFIG.MAX_RETRY_DELAY_MS);
                PopupLogger.log('Firebase', 'Will retry in', retryDelay, 'ms');

                // Schedule retry without recursion — reuse the same data
                this.pendingSave = dataToSave;
                setTimeout(() => {
                    if (this.currentUser && this.pendingSave) {
                        this.performCloudSave(elements);
                    }
                }, retryDelay);
            } finally {
                this.isSavingToCloud = false;

                // If new data arrived while we were saving, process it (with delay)
                if (this.pendingSave && this.cloudSaveRetryCount === 0) {
                    setTimeout(() => this.performCloudSave(elements), 1000);
                }
            }
        })();

        try {
            await this.currentSavePromise;
        } finally {
            this.currentSavePromise = null;
        }
    },

    /**
     * Load and sync data with cloud
     */
    async loadAndSyncData(elements) {
        const { Storage } = window.AnimeTracker;
        const { ProgressManager } = window.AnimeTracker;
        const { FillerService } = window.AnimeTracker;
        const { UIHelpers } = window.AnimeTracker;
        
        if (!this.currentUser) return null;

        if (elements?.syncStatus) {
            elements.syncStatus.classList.remove('synced');
            elements.syncStatus.classList.add('syncing');
            elements.syncText.textContent = 'Syncing...';
        }

        try {
            // Fetch cloud document once — reuse for both the pre-upload VP merge and
            // the authoritative data merge, eliminating the second GET.
            let cloudData = null;
            const { hit: cacheHit, data: cachedCloudData } = this.getCachedUserDocument(this.currentUser.uid);

            if (cacheHit) {
                cloudData = cachedCloudData;
                PopupLogger.debug('Sync', 'Using cached cloud user document');
            } else {
                let retryCount = 0;
                const maxRetries = 3;

                while (retryCount < maxRetries) {
                    try {
                        cloudData = await FirebaseLib.getDocument('users', this.currentUser.uid);
                        this.setCachedUserDocument(this.currentUser.uid, cloudData);
                        break;
                    } catch (e) {
                        retryCount++;
                        if (retryCount < maxRetries) {
                            PopupLogger.warn('Sync', `Cloud fetch failed, retrying (${retryCount}/${maxRetries})...`);
                            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                        } else {
                            throw e;
                        }
                    }
                }
            }

            const readLocalSyncData = () => Storage.get([
                'animeData',
                'videoProgress',
                'userId',
                'deletedAnime',
                'groupCoverImages'
            ]);

            // Read local once and reuse for both the pre-upload VP merge and
            // the authoritative merge below — saves a redundant chrome.storage read.
            const localData = await readLocalSyncData();

            // Note: videoProgress merge happens once in the main merge block
            // below (line ~389). No pre-merge needed — the main merge already
            // handles the local/cloud combination correctly.
            let finalData;

            if (cloudData) {
                const shouldMerge = localData.userId === this.currentUser.uid;

                let mergedDeletedAnime = AnimeTracker.MergeUtils.mergeDeletedAnime(
                    localData.deletedAnime || {},
                    cloudData.deletedAnime || {}
                );

                if (shouldMerge && localData.animeData && Object.keys(localData.animeData).length > 0) {
                    finalData = {
                        animeData:     AnimeTracker.MergeUtils.mergeAnimeData(localData.animeData || {}, cloudData.animeData || {}),
                        videoProgress: AnimeTracker.MergeUtils.mergeVideoProgress(localData.videoProgress || {}, cloudData.videoProgress || {})
                    };
                    PopupLogger.log('Sync', 'Merged episodes:', UIHelpers.countEpisodes(finalData.animeData));
                } else {
                    finalData = {
                        animeData: cloudData.animeData || {},
                        videoProgress: cloudData.videoProgress || {}
                    };
                    finalData.animeData = ProgressManager.removeDuplicateEpisodes(finalData.animeData);
                }

                const localGroupCovers = localData.groupCoverImages || {};
                const cloudGroupCovers = cloudData.groupCoverImages || {};
                const mergedGroupCovers = AnimeTracker.MergeUtils.mergeGroupCoverImages(localGroupCovers, cloudGroupCovers);

                const normalized = ProgressManager.normalizeCanonicalSlugs(
                    finalData.animeData || {},
                    finalData.videoProgress || {},
                    mergedDeletedAnime || {}
                );
                const withoutAutoRepaired = ProgressManager.removeAutoRepairedEpisodes(normalized.animeData || {});
                finalData.animeData = ProgressManager.removeDuplicateEpisodes(withoutAutoRepaired.cleanedData);
                finalData.videoProgress = normalized.videoProgress || {};
                mergedDeletedAnime = normalized.deletedAnime || {};

                AnimeTracker.MergeUtils.applyDeletedAnime(finalData.animeData, mergedDeletedAnime);

                // Prune deletedAnime entries older than 30 days
                const DELETED_MAX_AGE = 10 * 24 * 60 * 60 * 1000;
                const pruneCutoff = Date.now() - DELETED_MAX_AGE;
                for (const slug of Object.keys(mergedDeletedAnime)) {
                    const info = mergedDeletedAnime[slug];
                    const delAt = +(new Date(info?.deletedAt || info || 0));
                    if (delAt > 0 && delAt < pruneCutoff) {
                        delete mergedDeletedAnime[slug];
                    }
                }

                finalData.deletedAnime = mergedDeletedAnime;

                const { cleaned: cleanedProgress } =
                    ProgressManager.cleanTrackedProgress(finalData.animeData, finalData.videoProgress);
                finalData.videoProgress = cleanedProgress;

                finalData.groupCoverImages = mergedGroupCovers;

                // Only write to local storage when the merged result actually
                // differs from what's already on disk. An unconditional Storage.set
                // fires chrome.storage.onChanged, which wakes the SW and triggers
                // a redundant cloud sync — turning every popup open into 2 reads
                // + 1 write even when nothing changed.
                const needsLocalWrite =
                    !AnimeTracker.MergeUtils.areAnimeDataMapsEqual(finalData.animeData || {}, localData.animeData || {}) ||
                    !areProgressMapsEqual(finalData.videoProgress || {}, localData.videoProgress || {}) ||
                    !shallowEqualDeletedAnime(finalData.deletedAnime || {}, localData.deletedAnime || {}) ||
                    !shallowEqualObjectMap(finalData.groupCoverImages || {}, localData.groupCoverImages || {}) ||
                    localData.userId !== this.currentUser.uid;

                if (needsLocalWrite) {
                    await Storage.set({
                        animeData: finalData.animeData,
                        videoProgress: finalData.videoProgress,
                        deletedAnime: mergedDeletedAnime,
                        groupCoverImages: mergedGroupCovers,
                        userId: this.currentUser.uid
                    });
                }

                if (shouldMerge) {
                    // Only push back to cloud if the merged result actually differs
                    // from what we just fetched — avoids a redundant full write.
                    const needsCloudWrite =
                        !AnimeTracker.MergeUtils.areAnimeDataMapsEqual(finalData.animeData || {}, cloudData.animeData || {}) ||
                        !areProgressMapsEqual(finalData.videoProgress || {}, cloudData.videoProgress || {}) ||
                        !shallowEqualDeletedAnime(finalData.deletedAnime || {}, cloudData.deletedAnime || {}) ||
                        !shallowEqualObjectMap(finalData.groupCoverImages || {}, cloudData.groupCoverImages || {});

                    if (needsCloudWrite) {
                        if (this.saveToCloudTimeout) {
                            clearTimeout(this.saveToCloudTimeout);
                            this.saveToCloudTimeout = null;
                        }
                        this.pendingSave = this.cloneSyncData(finalData);
                        await this.performCloudSave(elements);
                    } else {
                        this.setCachedUserDocument(this.currentUser.uid, {
                            animeData: finalData.animeData || {},
                            videoProgress: finalData.videoProgress || {},
                            deletedAnime: finalData.deletedAnime || {},
                            groupCoverImages: finalData.groupCoverImages || {},
                            lastUpdated: cloudData?.lastUpdated || null,
                            email: this.currentUser?.email || cloudData?.email || null
                        });
                        if (elements?.syncStatus) {
                            elements.syncStatus.classList.add('synced');
                            elements.syncText.textContent = 'Cloud Synced';
                        }
                    }
                }
            } else {
                if (localData.userId === this.currentUser.uid && localData.animeData && Object.keys(localData.animeData).length > 0) {
                    const normalized = ProgressManager.normalizeCanonicalSlugs(
                        localData.animeData || {},
                        localData.videoProgress || {},
                        localData.deletedAnime || {}
                    );
                    const withoutAutoRepaired = ProgressManager.removeAutoRepairedEpisodes(normalized.animeData || {});

                    finalData = {
                        animeData: ProgressManager.removeDuplicateEpisodes(withoutAutoRepaired.cleanedData),
                        videoProgress: normalized.videoProgress || {},
                        deletedAnime: normalized.deletedAnime || {},
                        groupCoverImages: localData.groupCoverImages || {}
                    };

                    await Storage.set({
                        animeData: finalData.animeData,
                        videoProgress: finalData.videoProgress,
                        deletedAnime: finalData.deletedAnime,
                        groupCoverImages: finalData.groupCoverImages,
                        userId: this.currentUser.uid
                    });

                    if (this.saveToCloudTimeout) {
                        clearTimeout(this.saveToCloudTimeout);
                        this.saveToCloudTimeout = null;
                    }
                    this.pendingSave = this.cloneSyncData(finalData);
                    await this.performCloudSave(elements);
                } else {
                    finalData = { animeData: {}, videoProgress: {}, deletedAnime: {}, groupCoverImages: {} };
                    await Storage.set({
                        animeData: {},
                        videoProgress: {},
                        deletedAnime: {},
                        groupCoverImages: {},
                        userId: this.currentUser.uid
                    });
                }
            }

            await FillerService.loadCachedEpisodeTypes(finalData.animeData);

            if (elements?.syncStatus) {
                elements.syncStatus.classList.remove('syncing');
                elements.syncStatus.classList.add('synced');
                elements.syncText.textContent = 'Cloud Synced';
            }

            return finalData;
        } catch (error) {
            PopupLogger.error('Firebase', 'Sync error:', error);
            if (elements?.syncStatus) {
                elements.syncStatus.classList.remove('syncing');
                elements.syncText.textContent = 'Sync Error';
            }
            throw error;
        }
    },

    /**
     * Cleanup on popup close — fire-and-forget with keepalive fetch
     * so the request survives popup unload.
     */
    cleanup() {
        if (this.saveToCloudTimeout) {
            clearTimeout(this.saveToCloudTimeout);
            this.saveToCloudTimeout = null;
        }

        if (this.pendingSave && this.currentUser) {
            const dataToSave = this.pendingSave;
            this.pendingSave = null;

            // Use keepalive so the request outlives the popup
            FirebaseLib.setDocument('users', this.currentUser.uid, {
                animeData:        dataToSave.animeData || {},
                videoProgress:    dataToSave.videoProgress || {},
                deletedAnime:     dataToSave.deletedAnime || {},
                groupCoverImages: dataToSave.groupCoverImages || {},
                lastUpdated:      new Date().toISOString(),
                email:            this.currentUser.email
            }, {
                keepalive: true,
                fields: ['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages', 'lastUpdated', 'email']
            }).catch(err => {
                PopupLogger.error('Sync', 'Save on unload failed:', err);
            });
        }
    }
};

// Export
window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.FirebaseSync = FirebaseSync;
