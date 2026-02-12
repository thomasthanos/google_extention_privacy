/**
 * Anime Tracker - Firebase Sync
 * Handles Firebase authentication and cloud synchronization
 */

const FirebaseSync = {
    // State
    currentUser: null,
    saveToCloudTimeout: null,
    isSavingToCloud: false,
    pendingSave: null,
    currentSavePromise: null,
    cloudSaveRetryCount: 0,

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

        // Fix: Use the new data directly instead of merging.
        // This ensures that if items were deleted in 'data', they are removed from 'pendingSave' too.
        // Merging would keep the old keys (deleted items) in pendingSave, causing them to be resurrected.
        this.pendingSave = data;

        if (this.saveToCloudTimeout) {
            clearTimeout(this.saveToCloudTimeout);
            this.saveToCloudTimeout = null;
        }

        if (immediate) {
            console.log('[Firebase] Immediate save requested');
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
            console.log('[Firebase] Save in progress, waiting...');
            if (this.currentSavePromise) {
                try {
                    await this.currentSavePromise;
                } catch (e) {
                    // Ignore errors from previous save
                }
            }
            if (this.pendingSave) {
                await new Promise(resolve => setTimeout(resolve, 100));
                return this.performCloudSave(elements);
            }
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

                setTimeout(() => {
                    if (this.currentUser) {
                        this.pendingSave = dataToSave;
                        this.performCloudSave(elements);
                    }
                }, retryDelay);
            } finally {
                this.isSavingToCloud = false;

                if (this.pendingSave) {
                    setTimeout(() => this.performCloudSave(elements), 500);
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
    async loadAndSyncData(elements, callbacks) {
        const { Storage } = window.AnimeTracker;
        const { ProgressManager } = window.AnimeTracker;
        const { FillerService } = window.AnimeTracker;
        const { UIHelpers } = window.AnimeTracker;
        
        if (!this.currentUser) return null;

        // Show syncing status
        if (elements?.syncStatus) {
            elements.syncStatus.classList.remove('synced');
            elements.syncStatus.classList.add('syncing');
            elements.syncText.textContent = 'Syncing...';
        }

        try {
            // Get cloud data with retry
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
            
            const localData = await Storage.get(['animeData', 'videoProgress', 'userId']);
            let finalData;

            if (cloudData) {
                const shouldMerge = localData.userId === this.currentUser.uid;
                
                if (shouldMerge && localData.animeData && Object.keys(localData.animeData).length > 0) {
                    finalData = ProgressManager.mergeData(localData, cloudData);
                    console.log('[Sync] Merged episodes:', UIHelpers.countEpisodes(finalData.animeData));
                } else {
                    finalData = {
                        animeData: cloudData.animeData || {},
                        videoProgress: {
                            ...(cloudData.videoProgress || {}),
                            ...(localData.videoProgress || {})
                        }
                    };
                    finalData.animeData = ProgressManager.removeDuplicateEpisodes(finalData.animeData);
                }

                const { cleaned: cleanedProgress, removedCount: progressRemoved } = 
                    ProgressManager.cleanTrackedProgress(finalData.animeData, finalData.videoProgress);
                finalData.videoProgress = cleanedProgress;
                
                finalData.videoProgress = ProgressManager.cleanOrphanedProgress(finalData.animeData, finalData.videoProgress);

                await Storage.set({
                    animeData: finalData.animeData,
                    videoProgress: finalData.videoProgress,
                    userId: this.currentUser.uid
                });

                if (shouldMerge) {
                    if (this.saveToCloudTimeout) {
                        clearTimeout(this.saveToCloudTimeout);
                        this.saveToCloudTimeout = null;
                    }
                    this.pendingSave = finalData;
                    await this.performCloudSave(elements);
                }
            } else {
                if (localData.userId === this.currentUser.uid && localData.animeData && Object.keys(localData.animeData).length > 0) {
                    finalData = {
                        animeData: ProgressManager.removeDuplicateEpisodes(localData.animeData || {}),
                        videoProgress: localData.videoProgress || {}
                    };

                    await Storage.set({
                        animeData: finalData.animeData,
                        videoProgress: finalData.videoProgress,
                        userId: this.currentUser.uid
                    });

                    if (this.saveToCloudTimeout) {
                        clearTimeout(this.saveToCloudTimeout);
                        this.saveToCloudTimeout = null;
                    }
                    this.pendingSave = finalData;
                    await this.performCloudSave(elements);
                } else {
                    finalData = { animeData: {}, videoProgress: {} };
                    await Storage.set({
                        animeData: {},
                        videoProgress: {},
                        userId: this.currentUser.uid
                    });
                }
            }

            // Load cached episode types
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
