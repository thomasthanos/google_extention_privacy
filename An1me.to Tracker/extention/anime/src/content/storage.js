/**
 * Anime Tracker - Content Script Storage
 * Chrome storage wrapper with sync fallback
 */

const ContentStorage = {
    /**
     * Check if extension context is still valid
     */
    isContextValid() {
        try {
            return chrome.runtime && chrome.runtime.id;
        } catch (e) {
            return false;
        }
    },

    /**
     * Get data from storage
     */
    async get(keys) {
        const { Logger } = window.AnimeTrackerContent;
        
        return new Promise((resolve) => {
            if (!this.isContextValid()) {
                resolve({});
                return;
            }

            const timeoutId = setTimeout(() => {
                Logger.warn('Storage.get() timeout after 5s');
                resolve({});
            }, 5000);

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

                const hasLocalData = keys.some(key => localResult[key] !== undefined);

                if (hasLocalData) {
                    clearTimeout(timeoutId);
                    resolve(localResult);
                } else {
                    chrome.storage.sync.get(keys, (syncResult) => {
                        clearTimeout(timeoutId);
                        if (chrome.runtime.lastError) {
                            resolve(localResult);
                            return;
                        }

                        const hasSyncData = keys.some(key => syncResult[key] !== undefined);
                        if (hasSyncData) {
                            Logger.info('Migrating data from sync to local storage');
                            chrome.storage.local.set(syncResult, () => {
                                chrome.storage.sync.remove(keys);
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
                reject(new Error('Storage.set() timeout after 5s'));
            }, 5000);

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

    /**
     * Check storage quota
     */
    async checkQuota() {
        return new Promise((resolve) => {
            try {
                chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
                    if (chrome.runtime.lastError) {
                        resolve({ ok: true });
                        return;
                    }
                    const maxBytes = 10485760; // 10MB
                    const usedPercent = Math.round((bytesInUse / maxBytes) * 100);
                    resolve({
                        ok: bytesInUse < maxBytes * 0.9,
                        bytesInUse,
                        maxBytes,
                        usedPercent
                    });
                });
            } catch (e) {
                resolve({ ok: true });
            }
        });
    }
};

// Export
window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.Storage = ContentStorage;
