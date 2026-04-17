/**
 * Anime Tracker - Storage Helper
 * Uses local storage with sync migration support
 */

// Slug normalization for merging multi-part anime (migration)
const STORAGE_SLUG_NORMALIZATION = {
    'bleach-sennen-kessen-hen-ketsubetsu-tan': 'bleach-sennen-kessen-hen',
    'bleach-sennen-kessen-hen-soukoku-tan': 'bleach-sennen-kessen-hen',
    'fate-zero-season-2': 'fate-zero',
    'fate-zero-2nd-season': 'fate-zero',
};

// Episode offsets for multi-part anime (migration)
const STORAGE_EPISODE_OFFSET_MAPPING = {
    'bleach-sennen-kessen-hen-ketsubetsu-tan': 13,
    'bleach-sennen-kessen-hen-soukoku-tan': 26,
    'fate-zero-season-2': 13,
    'fate-zero-2nd-season': 13,
};

const LEGACY_SYNC_KEYS = new Set(['animeData', 'trackedEpisodes', 'videoProgress']);

function decodeHtmlEntities(value) {
    if (typeof value !== 'string' || !value.includes('&')) return value;

    const textarea = document.createElement('textarea');
    let decoded = value;

    // Decode a few rounds so strings like "&amp;#x2F;" fully normalize to "/".
    for (let i = 0; i < 3; i += 1) {
        textarea.innerHTML = decoded;
        const next = textarea.value;
        if (next === decoded) break;
        decoded = next;
    }

    return decoded;
}

const Storage = {
    /**
     * Get data from storage with sync migration
     */
    async get(keys) {
        return new Promise((resolve) => {
            const requestedKeys = Array.isArray(keys) ? keys : [keys];
            const legacySyncKeys = requestedKeys.filter((key) => LEGACY_SYNC_KEYS.has(key));

            chrome.storage.local.get(keys, (localResult) => {
                if (chrome.runtime.lastError) {
                    console.error('[Storage] Local get error:', chrome.runtime.lastError.message);
                    resolve({});
                    return;
                }

                // Only skip the sync fallback when ALL requested keys are present locally.
                // If even one key is missing, check sync storage so we don't silently drop
                // data that was written there (e.g. during cross-key migration).
                const hasLocalData = requestedKeys.every(key => localResult[key] !== undefined &&
                    (typeof localResult[key] !== 'object' || Object.keys(localResult[key]).length > 0));

                if (hasLocalData || legacySyncKeys.length === 0) {
                    resolve(localResult);
                } else {
                    const missingLegacyKeys = legacySyncKeys.filter((key) =>
                        localResult[key] === undefined ||
                        (typeof localResult[key] === 'object' && localResult[key] && Object.keys(localResult[key]).length === 0)
                    );

                    if (missingLegacyKeys.length === 0) {
                        resolve(localResult);
                        return;
                    }

                    chrome.storage.sync.get(missingLegacyKeys, (syncResult) => {
                        if (chrome.runtime.lastError) {
                            resolve(localResult);
                            return;
                        }

                        const hasSyncData = missingLegacyKeys.some(key => syncResult[key] !== undefined &&
                            (typeof syncResult[key] !== 'object' || Object.keys(syncResult[key]).length > 0));

                        if (hasSyncData) {
                            console.log('[Storage] Migrating from sync to local');
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

    /**
     * Set data to storage
     */
    async set(data) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set(data, () => {
                if (chrome.runtime.lastError) {
                    const msg = chrome.runtime.lastError.message || '';
                    if (msg.includes('QUOTA') || msg.includes('quota') || msg.includes('exceeded')) {
                        console.error('[Storage] ⚠ Quota exceeded! Consider clearing old data.', msg);
                    }
                    reject(new Error(msg));
                } else {
                    resolve();
                }
            });
        });
    },

    /**
     * Remove keys from storage
     */
    async remove(keys) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.remove(keys, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve();
                }
            });
        });
    },

    /**
     * Invalidate cached stats if version changed
     */
    async invalidateCachedStats(currentVersion) {
        return new Promise((resolve) => {
            chrome.storage.local.get(['cachedStatsVersion'], (result) => {
                const storedVersion = result.cachedStatsVersion || '';
                if (storedVersion !== currentVersion) {
                    chrome.storage.local.remove(['cachedStats', 'cachedStatsVersion'], () => {
                        chrome.storage.local.set({ cachedStatsVersion: currentVersion }, () => {
                            resolve(true);
                        });
                    });
                } else {
                    resolve(false);
                }
            });
        });
    },

    /**
     * Migrate multi-part anime entries to merged format.
     * Also fixes accidental slugs that end with -episode/-ep.
     */
    async migrateMultiPartAnime() {
        // Prevent concurrent migrations (e.g. two popup windows open simultaneously)
        const LOCK_KEY = '_migrationLock';
        const LOCK_MAX_AGE = 30000; // 30s — stale lock safety net
        try {
            const lockResult = await new Promise(r => chrome.storage.local.get([LOCK_KEY], r));
            if (lockResult[LOCK_KEY] && Date.now() - lockResult[LOCK_KEY] < LOCK_MAX_AGE) {
                console.log('[Storage] Migration already in progress, skipping');
                return false;
            }
            await new Promise(r => chrome.storage.local.set({ [LOCK_KEY]: Date.now() }, r));
        } catch {
            // If lock check fails, proceed anyway — better than skipping migration
        }

        const releaseLock = () => {
            try { chrome.storage.local.remove([LOCK_KEY]); } catch {}
        };

        return new Promise((resolve) => {
            chrome.storage.local.get(['animeData', 'videoProgress', 'deletedAnime'], (result) => {
                if (chrome.runtime.lastError || !result.animeData) {
                    releaseLock();
                    resolve(false);
                    return;
                }

                const animeData = result.animeData || {};
                const videoProgress = result.videoProgress || {};
                const deletedAnime = result.deletedAnime || {};
                let migrated = false;

                const mergeByNewer = (current, candidate) => {
                    if (!current) return candidate;
                    if (!candidate) return current;

                    const currentTime = new Date(current.savedAt || current.deletedAt || 0).getTime();
                    const candidateTime = new Date(candidate.savedAt || candidate.deletedAt || 0).getTime();
                    const currentProgress = typeof current.currentTime === 'number' ? current.currentTime : 0;
                    const candidateProgress = typeof candidate.currentTime === 'number' ? candidate.currentTime : 0;

                    if (candidateProgress > currentProgress) return candidate;
                    if (candidateProgress < currentProgress) return current;
                    return candidateTime >= currentTime ? candidate : current;
                };

                const getCanonicalSlugFromTitle = (slug, title) =>
                    window.AnimeTracker.SlugUtils.getCanonicalSlug(slug, title);
                const getCanonicalTitle = (slug, title) =>
                    window.AnimeTracker.SlugUtils.getCanonicalTitle(slug, title);

                const normalizeStoredTitle = (title) => {
                    if (typeof title !== 'string') return title;

                    const TITLE_CLEANUP_RE = /(?:\s*[-–—]\s*Episode\s*\d*.*|\s+Episode)\s*$/i;
                    return decodeHtmlEntities(title)
                        .replace(TITLE_CLEANUP_RE, '')
                        .trim();
                };

                const migrateSlug = (oldSlug, newSlug, offset = 0, titleTransform = null) => {
                    if (!animeData[oldSlug] || oldSlug === newSlug) return;

                    console.log(`[Storage] Migrating ${oldSlug} -> ${newSlug}`);
                    migrated = true;

                    const oldEntry = animeData[oldSlug];

                    if (!animeData[newSlug]) {
                        const migratedTitle = normalizeStoredTitle(
                            getCanonicalTitle(
                                newSlug,
                                (titleTransform ? titleTransform(oldEntry.title || '') : oldEntry.title) || ''
                            ) || ''
                        );
                        animeData[newSlug] = {
                            title: migratedTitle || newSlug,
                            slug: newSlug,
                            episodes: [],
                            totalWatchTime: 0,
                            lastWatched: null,
                            totalEpisodes: null,
                            coverImage: oldEntry.coverImage || null
                        };
                    }

                    const newEntry = animeData[newSlug];
                    newEntry.slug = newSlug;
                    if (!Array.isArray(newEntry.episodes)) newEntry.episodes = [];
                    if (!newEntry.coverImage && oldEntry.coverImage) newEntry.coverImage = oldEntry.coverImage;
                    if ((!newEntry.title || newEntry.title.trim() === '') && oldEntry.title) {
                        const migratedTitle = normalizeStoredTitle(
                            getCanonicalTitle(
                                newSlug,
                                titleTransform ? titleTransform(oldEntry.title) : oldEntry.title
                            )
                        );
                        if (migratedTitle) {
                            newEntry.title = migratedTitle;
                        }
                    }

                    const episodeMap = new Map();
                    for (const ep of newEntry.episodes) {
                        const num = Number(ep.number) || 0;
                        if (num > 0) episodeMap.set(num, ep);
                    }

                    const oldEpisodes = Array.isArray(oldEntry.episodes) ? oldEntry.episodes : [];
                    for (const ep of oldEpisodes) {
                        const baseNum = Number(ep.number) || 0;
                        const migratedNum = baseNum + offset;
                        if (migratedNum <= 0) continue;

                        const candidate = { ...ep, number: migratedNum };
                        const existing = episodeMap.get(migratedNum);
                        if (!existing) {
                            episodeMap.set(migratedNum, candidate);
                            continue;
                        }

                        const existingTs = existing.watchedAt ? new Date(existing.watchedAt).getTime() : 0;
                        const candidateTs = candidate.watchedAt ? new Date(candidate.watchedAt).getTime() : 0;
                        if (candidateTs >= existingTs) {
                            episodeMap.set(migratedNum, candidate);
                        }
                    }

                    newEntry.episodes = Array.from(episodeMap.values()).sort((a, b) => a.number - b.number);
                    newEntry.totalWatchTime = newEntry.episodes.reduce((sum, ep) => sum + (ep.duration || 0), 0);

                    const oldLastWatched = oldEntry.lastWatched ? new Date(oldEntry.lastWatched).getTime() : 0;
                    const newLastWatched = newEntry.lastWatched ? new Date(newEntry.lastWatched).getTime() : 0;
                    if (oldLastWatched > newLastWatched) {
                        newEntry.lastWatched = oldEntry.lastWatched;
                    }

                    const oldTotal = Number.isFinite(oldEntry.totalEpisodes) ? oldEntry.totalEpisodes + offset : null;
                    const newTotal = Number.isFinite(newEntry.totalEpisodes) ? newEntry.totalEpisodes : null;
                    const maxTracked = newEntry.episodes.reduce((max, ep) => Math.max(max, Number(ep.number) || 0), 0);
                    const candidateTotals = [oldTotal, newTotal, maxTracked].filter(n => Number.isFinite(n) && n > 0);
                    newEntry.totalEpisodes = candidateTotals.length ? Math.max(...candidateTotals) : null;

                    const oldPrefix = `${oldSlug}__episode-`;
                    const progressKeys = Object.keys(videoProgress).filter(key => key.startsWith(oldPrefix));
                    for (const key of progressKeys) {
                        const match = key.match(/__episode-(\d+)$/i);
                        if (!match) {
                            delete videoProgress[key];
                            continue;
                        }

                        const oldEpisodeNum = parseInt(match[1], 10);
                        const newEpisodeNum = oldEpisodeNum + offset;
                        const newKey = `${newSlug}__episode-${newEpisodeNum}`;
                        const migratedProgress = { ...videoProgress[key] };

                        videoProgress[newKey] = mergeByNewer(videoProgress[newKey], migratedProgress);
                        if (newKey !== key) delete videoProgress[key];
                    }

                    if (deletedAnime[oldSlug]) {
                        const oldDeleted = deletedAnime[oldSlug];
                        const currentDeleted = deletedAnime[newSlug];
                        const oldDeletedTs = oldDeleted?.deletedAt ? new Date(oldDeleted.deletedAt).getTime() : 0;
                        const currentDeletedTs = currentDeleted?.deletedAt ? new Date(currentDeleted.deletedAt).getTime() : 0;
                        if (!currentDeleted || oldDeletedTs > currentDeletedTs) {
                            deletedAnime[newSlug] = oldDeleted;
                        }
                        delete deletedAnime[oldSlug];
                    }

                    delete animeData[oldSlug];
                };

                for (const [oldSlug, newSlug] of Object.entries(STORAGE_SLUG_NORMALIZATION)) {
                    const offset = STORAGE_EPISODE_OFFSET_MAPPING[oldSlug] || 0;
                    migrateSlug(
                        oldSlug,
                        newSlug,
                        offset,
                        (title) => title.replace(/ Ketsubetsu[ -]tan| Soukoku[ -]tan/gi, '').trim()
                    );
                }

                // Generic migration for accidentally saved slugs ending in -episode/-ep.
                for (const oldSlug of Object.keys(animeData)) {
                    const cleanedSlug = oldSlug
                        .replace(/-(?:episodes?|ep)$/i, '')
                        .replace(/-+$/g, '');
                    if (cleanedSlug && cleanedSlug !== oldSlug) {
                        migrateSlug(
                            oldSlug,
                            cleanedSlug,
                            0,
                            (title) => (title || '').replace(/\s+Episode$/i, '').trim()
                        );
                    }
                }

                // Title-based canonical migration for known inconsistent slug families.
                for (const oldSlug of Object.keys(animeData)) {
                    const oldEntry = animeData[oldSlug];
                    const canonicalSlug = getCanonicalSlugFromTitle(
                        oldSlug,
                        normalizeStoredTitle(oldEntry?.title || '')
                    );
                    if (canonicalSlug && canonicalSlug !== oldSlug) {
                        migrateSlug(oldSlug, canonicalSlug, 0, (title) => title);
                    }
                }

                for (const [slug, entry] of Object.entries(animeData)) {
                    if (!entry?.title) continue;
                    const cleaned = normalizeStoredTitle(getCanonicalTitle(slug, entry.title));
                    if (cleaned && cleaned !== entry.title) {
                        entry.title = cleaned;
                        migrated = true;
                    }
                }

                if (migrated) {
                    chrome.storage.local.set({ animeData, videoProgress, deletedAnime }, () => {
                        releaseLock();
                        console.log('[Storage] Anime slug migration complete');
                        resolve(true);
                    });
                } else {
                    releaseLock();
                    resolve(false);
                }
            });
        });
    }
};

// Export
window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.Storage = Storage;
