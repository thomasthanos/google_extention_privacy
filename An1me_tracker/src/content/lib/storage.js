








function hasStoredValue(value) {
    if (value === undefined || value === null) return false;
    if (typeof value !== 'object') return true;
    return Object.keys(value).length > 0;
}

const ContentStorage = {
    LEGACY_SYNC_KEYS: new Set(['animeData', 'trackedEpisodes', 'videoProgress']),




    isContextValid() {
        try {
            return chrome.runtime && chrome.runtime.id;
        } catch {
            return false;
        }
    },




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
                resolve({ __timedOut: true });
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



                const hasLocalData = requestedKeys.every((key) => hasStoredValue(localResult[key]));

                if (hasLocalData || legacySyncKeys.length === 0) {
                    clearTimeout(timeoutId);
                    resolve(localResult);
                } else {
                    const missingLegacyKeys = legacySyncKeys.filter((key) => !hasStoredValue(localResult[key]));
                    if (missingLegacyKeys.length === 0) {
                        clearTimeout(timeoutId);
                        resolve(localResult);
                        return;
                    }

                    chrome.storage.sync.get(missingLegacyKeys, (syncResult) => {
                        clearTimeout(timeoutId);
                        if (chrome.runtime.lastError) {
                            resolve(localResult);
                            return;
                        }

                        const hasSyncData = missingLegacyKeys.some((key) => hasStoredValue(syncResult[key]));
                        if (hasSyncData) {
                            Logger.info('Migrating data from sync to local storage');
                            chrome.storage.local.set(syncResult, () => {
                                chrome.storage.sync.remove(missingLegacyKeys);
                            });
                        }

                        resolve({ ...localResult, ...syncResult });
                    });
                }
            });
        });
    },




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
                    const errorMsg = (chrome.runtime.lastError && chrome.runtime.lastError.message) || '';

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

    _mutateQueue: Promise.resolve(),
    async mutate(keys, mutator) {
        const requested = Array.isArray(keys) ? keys : [keys];
        const run = async () => {
            const data = await this.get(requested);




            if (data && data.__timedOut) return data;
            const result = mutator(data);
            if (result && typeof result.then === 'function') await result;
            const payload = {};
            for (const k of requested) {
                if (Object.prototype.hasOwnProperty.call(data, k)) payload[k] = data[k];
            }
            await this.set(payload);
            return data;
        };
        const next = this._mutateQueue.then(run, run);
        this._mutateQueue = next.catch(() => {});
        return next;
    }

};


window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.Storage = ContentStorage;
