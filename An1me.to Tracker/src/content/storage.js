/**
 * Anime Tracker - Content Script Storage
 * Chrome storage wrapper with sync fallback
 */

const ContentStorage = {
    LEGACY_SYNC_KEYS: new Set(['animeData', 'trackedEpisodes', 'videoProgress']),

    /**
     * Check if extension context is still valid
     */
    isContextValid() {
        try {
            return chrome.runtime && chrome.runtime.id;
        } catch {
            return false;
        }
    },

    /**
     * Get data from storage
     */
    async get(keys) {
        const { Logger } = window.AnimeTrackerContent;
        
        return new Promise((resolve) => {
            const requestedKeys = Array.isArray(keys) ? keys : [keys];
            const legacySyncKeys = requestedKeys.filter((key) => this.LEGACY_SYNC_KEYS.has(key));

            if (!this.isContextValid()) {
                resolve({});
                return;
            }

            const timeoutId = setTimeout(() => {
                Logger.warn('Storage.get() timeout after 15s');
                resolve({});
            }, 15000);

            chrome.storage.local.get(keys, (localResult) => {
                if (chrome.runtime.lastError) {
                    clearTimeout(timeoutId);
                    const errorMsg = chrome.runtime.lastError.message;

                    if (errorMsg.includes('Extension context invalidated') ||
                        errorMsg.includes('Cannot access') ||
                        !this.isContextValid()) {
                        resolve({});
                        return;
                    }

                    Logger.error('Local storage get error:', errorMsg);
                    resolve({});
                    return;
                }

                const hasLocalData = requestedKeys.some(key => localResult[key] !== undefined);

                if (hasLocalData || legacySyncKeys.length === 0) {
                    clearTimeout(timeoutId);
                    resolve(localResult);
                } else {
                    chrome.storage.sync.get(legacySyncKeys, (syncResult) => {
                        clearTimeout(timeoutId);
                        if (chrome.runtime.lastError) {
                            resolve(localResult);
                            return;
                        }

                        const hasSyncData = legacySyncKeys.some(key => syncResult[key] !== undefined);
                        if (hasSyncData) {
                            Logger.info('Migrating data from sync to local storage');
                            chrome.storage.local.set(syncResult, () => {
                                chrome.storage.sync.remove(legacySyncKeys);
                            });
                        }

                        resolve({ ...localResult, ...syncResult });
                    });
                }
            });
        });
    },

    /**
     * Set data to storage
     */
    async set(data) {
        return new Promise((resolve, reject) => {
            if (!this.isContextValid()) {
                resolve();
                return;
            }

            const timeoutId = setTimeout(() => {
                reject(new Error('Storage.set() timeout after 15s'));
            }, 15000);

            chrome.storage.local.set(data, () => {
                clearTimeout(timeoutId);
                if (chrome.runtime.lastError) {
                    const errorMsg = chrome.runtime.lastError.message;

                    if (errorMsg.includes('Extension context invalidated') ||
                        errorMsg.includes('Cannot access') ||
                        !this.isContextValid()) {
                        resolve();
                        return;
                    }

                    reject(new Error(errorMsg));
                } else {
                    resolve();
                }
            });
        });
    },

};

// Export
window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.Storage = ContentStorage;
