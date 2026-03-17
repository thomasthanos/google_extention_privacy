const FirebaseSync = {
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

    getUser() {
        return this.currentUser;
    },

    async init(callbacks) {
        const { onUserSignedIn, onUserSignedOut, onError } = callbacks;
        
        try {
            await FirebaseLib.init();

            FirebaseLib.onAuthStateChanged((user) => {
                this.currentUser = user;
                if (user) {
                    if (onUserSignedIn) onUserSignedIn(user);
                } else {
                    if (onUserSignedOut) onUserSignedOut();
                }
            });
        } catch (error) {
            console.error('[Firebase] Init error:', error);
            if (onError) onError(error);
        }
    },

    async signInWithGoogle() {
        return await FirebaseLib.signInWithGoogle();
    },

    async signOut() {
        await FirebaseLib.signOut();
        this.currentUser = null;
    },

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

    async performCloudSave(elements = null) {
        const { CONFIG } = window.AnimeTracker;
        
        if (this.isSavingToCloud) {
            if (this.currentSavePromise) {
                try { await this.currentSavePromise; } catch {}
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
            let retryScheduled = false;
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
                retryScheduled = true;
                setTimeout(() => {
                    if (this.currentUser) {
                        this.pendingSave = this.cloneSyncData(dataToSave);
                        this.performCloudSave(elements);
                    }
                }, retryDelay);
            } finally {
                this.isSavingToCloud = false;

                // Only schedule the pending-save flush if no retry is already queued
                if (!retryScheduled && this.pendingSave) {
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
            const localSnapshot = await Storage.get(['videoProgress', 'userId']);
            if (localSnapshot.userId === this.currentUser.uid && localSnapshot.videoProgress && Object.keys(localSnapshot.videoProgress).length > 0) {
                try {
                    const currentCloud = await FirebaseLib.getDocument('users', this.currentUser.uid);
                    if (currentCloud) {
                        const cloudVP = currentCloud.videoProgress || {};
                        const localVP = localSnapshot.videoProgress;
                        const merged = AnimeTracker.MergeUtils.mergeVideoProgress(localVP, cloudVP);
                        const hasChanges = Object.entries(merged).some(([id, val]) => {
                            return !cloudVP[id] || val.currentTime !== cloudVP[id].currentTime;
                        });
                        if (hasChanges) {
                            await FirebaseLib.setDocument('users', this.currentUser.uid, {
                                ...currentCloud,
                                videoProgress: merged,
                                lastUpdated: new Date().toISOString()
                            });
                        }
                    }
                } catch (e) {
                    console.warn('[Sync] Pre-upload failed (non-critical):', e.message);
                }
            }

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
                        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                    } else {
                        throw e;
                    }
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
                } else {
                    finalData = {
                        animeData: cloudData.animeData || {},
                        videoProgress: cloudData.videoProgress || {}
                    };
                    finalData.animeData = ProgressManager.removeDuplicateEpisodes(finalData.animeData);
                }
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
                    if (this.saveToCloudTimeout) {
                        clearTimeout(this.saveToCloudTimeout);
                        this.saveToCloudTimeout = null;
                    }
                    this.pendingSave = this.cloneSyncData(finalData);
                    await this.performCloudSave(elements);
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
                // Classify the error so the user gets an actionable hint
                // instead of a generic "Sync Error" with no next step.
                const msg = (error?.message || '').toLowerCase();
                const isOffline = !navigator.onLine ||
                    msg.includes('failed to fetch') ||
                    msg.includes('networkerror') ||
                    msg.includes('network request failed');
                const isAuth = msg.includes('permission') ||
                    msg.includes('unauthenticated') ||
                    msg.includes('unauthorized') ||
                    (error?.code && String(error.code).startsWith('auth/'));

                if (isOffline) {
                    elements.syncText.textContent = 'Offline — retry later';
                } else if (isAuth) {
                    elements.syncText.textContent = 'Auth error — sign out & in';
                } else {
                    elements.syncText.textContent = 'Sync failed — try refresh';
                }

                // Auto-revert the status label after 6 s so it doesn't stay red forever
                setTimeout(() => {
                    if (elements.syncText) elements.syncText.textContent = 'Cloud Synced';
                    if (elements.syncStatus) elements.syncStatus.classList.add('synced');
                }, 6000);
            }
            throw error;
        }
    },
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

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.FirebaseSync = FirebaseSync;
