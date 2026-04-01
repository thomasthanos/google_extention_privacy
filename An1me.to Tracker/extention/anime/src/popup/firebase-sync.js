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

    cloneSyncData(data) {
        if (!data || typeof data !== 'object') return {};
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
            return {
                animeData: data.animeData || {},
                videoProgress: data.videoProgress || {},
                deletedAnime: data.deletedAnime || {},
                groupCoverImages: data.groupCoverImages || {}
            };
        }
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
                this.currentUser = user;
                if (user) {
                    console.log('[Firebase] User signed in:', user.email);
                    if (onUserSignedIn) onUserSignedIn(user);
                } else {
                    console.log('[Firebase] No user');
                    if (onUserSignedOut) onUserSignedOut();
                }
            });

            console.log('[Firebase] Initialized');
        } catch (error) {
            console.error('[Firebase] Init error:', error);
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
    },

    /**
     * Save data to cloud with debouncing
     */
    async saveToCloud(data, immediate = false) {
        const { CONFIG } = window.AnimeTracker;
        
        if (!this.currentUser) return Promise.resolve();

        this.pendingSave = this.cloneSyncData(data);

        if (this.saveToCloudTimeout) {
            clearTimeout(this.saveToCloudTimeout);
            this.saveToCloudTimeout = null;
        }

        if (immediate) {
            return this.performCloudSave();
        }

        return new Promise((resolve) => {
            this.saveToCloudTimeout = setTimeout(async () => {
                await this.performCloudSave();
                resolve();
            }, CONFIG.CLOUD_SAVE_DEBOUNCE_MS);
        });
    },

    /**
     * Perform the actual cloud save
     */
    async performCloudSave(elements = null) {
        const { CONFIG } = window.AnimeTracker;

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

                await FirebaseLib.setDocument('users', this.currentUser.uid, {
                    animeData: dataToSave.animeData || {},
                    videoProgress: dataToSave.videoProgress || {},
                    deletedAnime: dataToSave.deletedAnime || {},
                    groupCoverImages: dataToSave.groupCoverImages || {},
                    lastUpdated: new Date().toISOString(),
                    email: this.currentUser.email
                });
                console.log('[Firebase] ✓ Data saved to cloud');

                this.cloudSaveRetryCount = 0;

                if (elements?.syncStatus) {
                    elements.syncStatus.classList.add('synced');
                    elements.syncText.textContent = 'Cloud Synced';
                }
            } catch (error) {
                console.error('[Firebase] Save error:', error);

                if (elements?.syncStatus) {
                    elements.syncStatus.classList.remove('synced');
                    elements.syncText.textContent = 'Sync Error';
                }

                this.cloudSaveRetryCount++;
                if (this.cloudSaveRetryCount >= CONFIG.MAX_CLOUD_SAVE_RETRIES) {
                    console.error('[Firebase] Max retries reached, giving up');
                    this.cloudSaveRetryCount = 0;
                    return;
                }

                const retryDelay = Math.min(2000 * Math.pow(2, this.cloudSaveRetryCount - 1), CONFIG.MAX_RETRY_DELAY_MS);
                console.log('[Firebase] Will retry in', retryDelay, 'ms');

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
            let retryCount = 0;
            const maxRetries = 3;

            while (retryCount < maxRetries) {
                try {
                    cloudData = await FirebaseLib.getDocument('users', this.currentUser.uid);
                    break;
                } catch (e) {
                    retryCount++;
                    if (retryCount < maxRetries) {
                        console.log(`[Sync] Cloud fetch failed, retrying (${retryCount}/${maxRetries})...`);
                        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                    } else {
                        throw e;
                    }
                }
            }

            // On Orion/mobile (no SW), merge local videoProgress into the cloud doc
            // before proceeding, to avoid losing progress saved by content scripts.
            const localSnapshot = await Storage.get(['videoProgress', 'userId']);
            if (cloudData && localSnapshot.userId === this.currentUser.uid &&
                    localSnapshot.videoProgress && Object.keys(localSnapshot.videoProgress).length > 0) {
                try {
                    const cloudVP = cloudData.videoProgress || {};
                    const localVP = localSnapshot.videoProgress;
                    const merged = AnimeTracker.MergeUtils.mergeVideoProgress(localVP, cloudVP);
                    const hasChanges = Object.entries(merged).some(([id, val]) =>
                        !cloudVP[id] || val.currentTime !== cloudVP[id].currentTime
                    );
                    if (hasChanges) {
                        // Patch the in-memory cloudData so the merge below sees the latest VP.
                        cloudData = { ...cloudData, videoProgress: merged };
                        await FirebaseLib.setDocument('users', this.currentUser.uid, {
                            ...cloudData,
                            lastUpdated: new Date().toISOString()
                        });
                    }
                } catch (e) {
                    console.warn('[Sync] Pre-upload failed (non-critical):', e.message);
                }
            }
            
            const localData = await Storage.get(['animeData', 'videoProgress', 'userId', 'deletedAnime', 'groupCoverImages']);
            let finalData;

            if (cloudData) {
                const shouldMerge = localData.userId === this.currentUser.uid;

                const mergedDeletedAnime = AnimeTracker.MergeUtils.mergeDeletedAnime(
                    localData.deletedAnime || {},
                    cloudData.deletedAnime || {}
                );

                if (shouldMerge && localData.animeData && Object.keys(localData.animeData).length > 0) {
                    finalData = {
                        animeData:     AnimeTracker.MergeUtils.mergeAnimeData(localData.animeData || {}, cloudData.animeData || {}),
                        videoProgress: AnimeTracker.MergeUtils.mergeVideoProgress(localData.videoProgress || {}, cloudData.videoProgress || {})
                    };
                    console.log('[Sync] Merged episodes:', UIHelpers.countEpisodes(finalData.animeData));
                } else {
                    finalData = {
                        animeData: cloudData.animeData || {},
                        videoProgress: cloudData.videoProgress || {}
                    };
                    finalData.animeData = ProgressManager.removeDuplicateEpisodes(finalData.animeData);
                }

                // Prefer local covers to preserve user-set posters
                const localGroupCovers = localData.groupCoverImages || {};
                const cloudGroupCovers = cloudData.groupCoverImages || {};
                const mergedGroupCovers = { ...cloudGroupCovers, ...localGroupCovers };

                AnimeTracker.MergeUtils.applyDeletedAnime(finalData.animeData, mergedDeletedAnime);
                finalData.deletedAnime = mergedDeletedAnime;

                const { cleaned: cleanedProgress } =
                    ProgressManager.cleanTrackedProgress(finalData.animeData, finalData.videoProgress);
                finalData.videoProgress = cleanedProgress;

                finalData.groupCoverImages = mergedGroupCovers;
                await Storage.set({
                    animeData: finalData.animeData,
                    videoProgress: finalData.videoProgress,
                    deletedAnime: mergedDeletedAnime,
                    groupCoverImages: mergedGroupCovers,
                    userId: this.currentUser.uid
                });

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
                        if (elements?.syncStatus) {
                            elements.syncStatus.classList.add('synced');
                            elements.syncText.textContent = 'Cloud Synced';
                        }
                    }
                }
            } else {
                if (localData.userId === this.currentUser.uid && localData.animeData && Object.keys(localData.animeData).length > 0) {
                    finalData = {
                        animeData: ProgressManager.removeDuplicateEpisodes(localData.animeData || {}),
                        videoProgress: localData.videoProgress || {},
                        groupCoverImages: localData.groupCoverImages || {}
                    };

                    await Storage.set({
                        animeData: finalData.animeData,
                        videoProgress: finalData.videoProgress,
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
                    finalData = { animeData: {}, videoProgress: {}, groupCoverImages: {} };
                    await Storage.set({
                        animeData: {},
                        videoProgress: {},
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
            console.error('[Firebase] Sync error:', error);
            if (elements?.syncStatus) {
                elements.syncStatus.classList.remove('syncing');
                elements.syncText.textContent = 'Sync Error';
            }
            throw error;
        }
    },

    /**
     * Cleanup on popup close
     */
    cleanup() {
        if (this.saveToCloudTimeout) {
            clearTimeout(this.saveToCloudTimeout);
            this.saveToCloudTimeout = null;
        }

        if (this.pendingSave && this.currentUser && !this.isSavingToCloud) {
            console.warn('[Popup] Closing with pending save');
            this.performCloudSave().catch(err => {
                console.error('[Popup] Save on unload failed:', err);
            });
        }
    }
};

// Export
window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.FirebaseSync = FirebaseSync;
