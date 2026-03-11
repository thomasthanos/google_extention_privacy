/**
 * Anime Tracker - Firebase Sync
 * Handles Firebase authentication and cloud synchronization
 */

// mergeDeletedAnime → AnimeTracker.MergeUtils.mergeDeletedAnime (see src/popup/merge-utils.js)

/**
 * Remove from animeData any slug that was deleted AFTER its last watched episode.
 * This stops deleted anime from being resurrected during merge.
 */
function applyDeletedAnime(animeData, deletedAnime) {
    for (const [slug, info] of Object.entries(deletedAnime)) {
        if (!animeData[slug]) continue;
        const deletedAt = new Date(info.deletedAt).getTime();
        const lastWatched = animeData[slug].lastWatched
            ? new Date(animeData[slug].lastWatched).getTime()
            : 0;
        // If deleted more recently than last watched → honour the deletion
        if (deletedAt >= lastWatched) {
            console.log(`[Sync] Honouring deletion of ${slug} (deleted ${info.deletedAt})`);
            delete animeData[slug];
        }
    }
}

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
                    deletedAnime: dataToSave.deletedAnime || {},
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
    async loadAndSyncData(elements) {
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
            // On Orion/mobile (no background service worker), push local videoProgress
            // to cloud BEFORE fetching, so we don't lose progress saved by content scripts
            const localSnapshot = await Storage.get(['videoProgress', 'userId']);
            if (localSnapshot.userId === this.currentUser.uid && localSnapshot.videoProgress && Object.keys(localSnapshot.videoProgress).length > 0) {
                try {
                    // Read current cloud doc and merge, don't overwrite
                    const currentCloud = await FirebaseLib.getDocument('users', this.currentUser.uid);
                    if (currentCloud) {
                        const cloudVP = currentCloud.videoProgress || {};
                        const localVP = localSnapshot.videoProgress;
                        // Full merge delegated to shared MergeUtils (soft-delete + currentTime aware)
                        const merged = AnimeTracker.MergeUtils.mergeVideoProgress(localVP, cloudVP);
                        // Only update if there are actual changes
                        const hasChanges = Object.entries(merged).some(([id, val]) => {
                            return !cloudVP[id] || val.currentTime !== cloudVP[id].currentTime;
                        });
                        if (hasChanges) {
                            await FirebaseLib.setDocument('users', this.currentUser.uid, {
                                ...currentCloud,
                                videoProgress: merged,
                                lastUpdated: new Date().toISOString()
                            });
                            console.log('[Sync] Pre-upload: pushed local videoProgress to cloud');
                        }
                    }
                } catch (e) {
                    console.warn('[Sync] Pre-upload failed (non-critical):', e.message);
                }
            }

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
            
            const localData = await Storage.get(['animeData', 'videoProgress', 'userId', 'deletedAnime']);
            let finalData;

            if (cloudData) {
                const shouldMerge = localData.userId === this.currentUser.uid;

                // Merge deletedAnime logs from both sides (union, keep newest deletedAt)
                const mergedDeletedAnime = AnimeTracker.MergeUtils.mergeDeletedAnime(
                    localData.deletedAnime || {},
                    cloudData.deletedAnime || {}
                );

                if (shouldMerge && localData.animeData && Object.keys(localData.animeData).length > 0) {
                    finalData = ProgressManager.mergeData(localData, cloudData);
                    console.log('[Sync] Merged episodes:', UIHelpers.countEpisodes(finalData.animeData));
                } else {
                    finalData = {
                        animeData: cloudData.animeData || {},
                        videoProgress: cloudData.videoProgress || {}
                    };
                    finalData.animeData = ProgressManager.removeDuplicateEpisodes(finalData.animeData);
                }

                // videoProgress is already correctly merged by ProgressManager.mergeData:
                // it uses currentTime as the primary conflict resolver (higher wins),
                // with savedAt as tiebreaker, and honours soft-delete flags.
                // No additional override needed here.

                // Apply deletedAnime: remove any anime that was deleted after its last watch
                applyDeletedAnime(finalData.animeData, mergedDeletedAnime);
                finalData.deletedAnime = mergedDeletedAnime;

                const { cleaned: cleanedProgress } = 
                    ProgressManager.cleanTrackedProgress(finalData.animeData, finalData.videoProgress);
                finalData.videoProgress = cleanedProgress;
                
                finalData.videoProgress = ProgressManager.cleanOrphanedProgress(finalData.animeData, finalData.videoProgress);

                await Storage.set({
                    animeData: finalData.animeData,
                    videoProgress: finalData.videoProgress,
                    deletedAnime: mergedDeletedAnime,
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
