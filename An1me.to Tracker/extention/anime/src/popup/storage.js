/**
 * Anime Tracker - Storage Helper
 * Uses local storage with sync migration support
 */

// Slug normalization for merging multi-part anime (migration)
const STORAGE_SLUG_NORMALIZATION = {
    'bleach-sennen-kessen-hen-ketsubetsu-tan': 'bleach-sennen-kessen-hen',
    'bleach-sennen-kessen-hen-soukoku-tan': 'bleach-sennen-kessen-hen',
};

// Episode offsets for multi-part anime (migration)
const STORAGE_EPISODE_OFFSET_MAPPING = {
    'bleach-sennen-kessen-hen-ketsubetsu-tan': 13,
    'bleach-sennen-kessen-hen-soukoku-tan': 26,
};

const Storage = {
    /**
     * Get data from storage with sync migration
     */
    async get(keys) {
        return new Promise((resolve) => {
            chrome.storage.local.get(keys, (localResult) => {
                if (chrome.runtime.lastError) {
                    console.error('[Storage] Local get error:', chrome.runtime.lastError.message);
                    resolve({});
                    return;
                }
                
                const hasLocalData = keys.some(key => localResult[key] !== undefined && 
                    (typeof localResult[key] !== 'object' || Object.keys(localResult[key]).length > 0));
                
                if (hasLocalData) {
                    resolve(localResult);
                } else {
                    // Check sync for migration
                    chrome.storage.sync.get(keys, (syncResult) => {
                        if (chrome.runtime.lastError) {
                            resolve(localResult);
                            return;
                        }
                        
                        const hasSyncData = keys.some(key => syncResult[key] !== undefined &&
                            (typeof syncResult[key] !== 'object' || Object.keys(syncResult[key]).length > 0));
                        
                        if (hasSyncData) {
                            console.log('[Storage] Migrating from sync to local');
                            chrome.storage.local.set(syncResult, () => {
                                // Clear large data from sync
                                chrome.storage.sync.remove(['animeData', 'trackedEpisodes', 'videoProgress']);
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
            chrome.storage.local.set(data, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve();
                }
            });
        });
    },

    /**
     * Migrate multi-part anime entries to merged format
     * Merges episodes from part-specific slugs into the base slug
     */
    async migrateMultiPartAnime() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['animeData'], (result) => {
                if (chrome.runtime.lastError || !result.animeData) {
                    resolve(false);
                    return;
                }

                const animeData = result.animeData;
                let migrated = false;

                for (const [oldSlug, newSlug] of Object.entries(STORAGE_SLUG_NORMALIZATION)) {
                    if (animeData[oldSlug]) {
                        console.log(`[Storage] Migrating ${oldSlug} → ${newSlug}`);
                        migrated = true;

                        // Get offset for this part
                        const offset = STORAGE_EPISODE_OFFSET_MAPPING[oldSlug] || 0;

                        // Create base entry if it doesn't exist
                        if (!animeData[newSlug]) {
                            animeData[newSlug] = {
                                title: animeData[oldSlug].title.replace(/ Ketsubetsu[ -]tan| Soukoku[ -]tan/gi, '').trim(),
                                slug: newSlug,
                                episodes: [],
                                totalWatchTime: 0,
                                lastWatched: null,
                                totalEpisodes: null
                            };
                        }

                        // Ensure episodes array exists
                        if (!Array.isArray(animeData[newSlug].episodes)) {
                            animeData[newSlug].episodes = [];
                        }

                        // Merge episodes with offset
                        const oldEpisodes = animeData[oldSlug].episodes || [];
                        for (const ep of oldEpisodes) {
                            const newEpNumber = ep.number + offset;
                            const exists = animeData[newSlug].episodes.some(e => e.number === newEpNumber);
                            if (!exists) {
                                animeData[newSlug].episodes.push({
                                    ...ep,
                                    number: newEpNumber
                                });
                            }
                        }

                        // Sort episodes
                        animeData[newSlug].episodes.sort((a, b) => a.number - b.number);

                        // Update total watch time
                        animeData[newSlug].totalWatchTime =
                            (animeData[newSlug].totalWatchTime || 0) + (animeData[oldSlug].totalWatchTime || 0);

                        // Update last watched
                        const oldLastWatched = animeData[oldSlug].lastWatched;
                        const newLastWatched = animeData[newSlug].lastWatched;
                        if (oldLastWatched && (!newLastWatched || new Date(oldLastWatched) > new Date(newLastWatched))) {
                            animeData[newSlug].lastWatched = oldLastWatched;
                        }

                        // Delete old entry
                        delete animeData[oldSlug];
                    }
                }

                if (migrated) {
                    chrome.storage.local.set({ animeData }, () => {
                        console.log('[Storage] Multi-part anime migration complete');
                        resolve(true);
                    });
                } else {
                    resolve(false);
                }
            });
        });
    }
};

// Export
window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.Storage = Storage;
