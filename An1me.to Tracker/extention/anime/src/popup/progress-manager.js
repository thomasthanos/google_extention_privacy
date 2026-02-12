/**
 * Anime Tracker - Progress Manager
 * Handles progress tracking, cleaning, and data management
 */

const ProgressManager = {
    /**
     * Clean orphaned video progress entries
     */
    cleanOrphanedProgress(animeData, videoProgress) {
        const { CONFIG } = window.AnimeTracker;
        const { UIHelpers } = window.AnimeTracker;
        
        if (!videoProgress || Object.keys(videoProgress).length === 0) {
            return videoProgress;
        }

        const validSlugs = new Set(Object.keys(animeData));
        const completedEpisodeIds = new Set();
        
        for (const [animeSlug, anime] of Object.entries(animeData)) {
            if (anime.episodes) {
                anime.episodes.forEach(ep => {
                    completedEpisodeIds.add(UIHelpers.getUniqueId(animeSlug, ep.number));
                });
            }
        }

        const cleaned = {};
        let removedCount = 0;
        const MAX_ORPHAN_AGE_MS = CONFIG.ORPHAN_PROGRESS_MAX_AGE;

        for (const [id, progress] of Object.entries(videoProgress)) {
            const slugMatch = id.match(/^(.+)__episode-\d+$/);
            if (!slugMatch) {
                removedCount++;
                continue;
            }

            const animeSlug = slugMatch[1];
            const isAnimeTracked = validSlugs.has(animeSlug);
            const isEpisodeCompleted = completedEpisodeIds.has(id);
            const isRecent = progress.savedAt &&
                (Date.now() - new Date(progress.savedAt).getTime()) < MAX_ORPHAN_AGE_MS;
            const isSignificant = progress.percentage && progress.percentage > CONFIG.SIGNIFICANT_PROGRESS_PERCENTAGE;
            const hasWatchTime = progress.currentTime && progress.currentTime > CONFIG.SIGNIFICANT_WATCH_TIME_SECONDS;
            
            // Allow soft-deleted items to persist for some time (e.g. 30 days) to ensure sync
            // Then clean them up
            if (progress.deleted) {
                const deletedAt = progress.deletedAt ? new Date(progress.deletedAt).getTime() : 0;
                const DELETE_RETENTION = 30 * 24 * 60 * 60 * 1000; // 30 days
                if (Date.now() - deletedAt < DELETE_RETENTION) {
                    cleaned[id] = progress;
                } else {
                     removedCount++;
                     console.log('[Cleanup] Removing old soft-deleted progress:', id);
                }
                continue;
            }

            if (isAnimeTracked || isEpisodeCompleted || (isRecent && (isSignificant || hasWatchTime))) {
                cleaned[id] = progress;
            } else {
                removedCount++;
                console.log('[Cleanup] Removing orphaned progress:', id);
            }
        }

        if (removedCount > 0) {
            console.log('[Cleanup] Removed', removedCount, 'progress entries');
        }

        return cleaned;
    },

    /**
     * Remove duplicate episodes from anime data
     */
    removeDuplicateEpisodes(animeData) {
        if (!animeData || typeof animeData !== 'object') {
            console.warn('[Cleanup] Invalid animeData provided');
            return {};
        }

        const cleaned = { ...animeData };

        for (const [slug, anime] of Object.entries(cleaned)) {
            if (!anime || typeof anime !== 'object') {
                console.warn('[Cleanup] Invalid anime entry:', slug);
                delete cleaned[slug];
                continue;
            }

            if (!anime.episodes) {
                cleaned[slug].episodes = [];
                cleaned[slug].totalWatchTime = 0;
                continue;
            }

            if (!Array.isArray(anime.episodes)) {
                console.warn('[Cleanup] Episodes is not an array for:', slug);
                cleaned[slug].episodes = [];
                cleaned[slug].totalWatchTime = 0;
                continue;
            }

            const episodeMap = new Map();
            anime.episodes.forEach(ep => {
                if (ep && typeof ep === 'object' && typeof ep.number === 'number' && !isNaN(ep.number)) {
                    if (!episodeMap.has(ep.number)) {
                        episodeMap.set(ep.number, ep);
                    }
                }
            });

            cleaned[slug].episodes = Array.from(episodeMap.values())
                .sort((a, b) => a.number - b.number);

            cleaned[slug].totalWatchTime = cleaned[slug].episodes
                .reduce((sum, ep) => sum + (ep.duration || 0), 0);
        }

        return cleaned;
    },

    /**
     * Clean progress for tracked/completed episodes
     */
    cleanTrackedProgress(animeData, videoProgress) {
        const { UIHelpers } = window.AnimeTracker;
        const { CONFIG } = window.AnimeTracker;
        
        if (!videoProgress || Object.keys(videoProgress).length === 0) {
            return { cleaned: videoProgress, removedCount: 0 };
        }

        const trackedIds = new Set();
        for (const [animeSlug, anime] of Object.entries(animeData)) {
            if (anime.episodes) {
                anime.episodes.forEach(ep => {
                    trackedIds.add(UIHelpers.getUniqueId(animeSlug, ep.number));
                });
            }
        }

        const cleaned = {};
        let removedCount = 0;
        
        for (const [id, progress] of Object.entries(videoProgress)) {
            const isTracked = trackedIds.has(id);
            const isCompleted = progress.percentage >= CONFIG.COMPLETED_PERCENTAGE;
            
            if (isTracked || isCompleted) {
                removedCount++;
            } else {
                cleaned[id] = progress;
            }
        }

        return { cleaned, removedCount };
    },

    /**
     * Merge local and cloud data
     */
    mergeData(localData, cloudData) {
        const merged = {
            animeData: { ...(cloudData.animeData || {}), ...(localData.animeData || {}) },
            videoProgress: { ...(cloudData.videoProgress || {}), ...(localData.videoProgress || {}) }
        };

        for (const slug of Object.keys(merged.animeData)) {
            const cloudAnime = cloudData.animeData?.[slug];
            const localAnime = localData.animeData?.[slug];

            if (cloudAnime || localAnime) {
                const episodeMap = new Map();

                const cloudEpisodes = Array.isArray(cloudAnime?.episodes) ? cloudAnime.episodes : [];
                const localEpisodes = Array.isArray(localAnime?.episodes) ? localAnime.episodes : [];

                [...cloudEpisodes, ...localEpisodes].forEach(ep => {
                    if (ep && typeof ep === 'object' && typeof ep.number === 'number') {
                        if (!episodeMap.has(ep.number)) {
                            episodeMap.set(ep.number, ep);
                        }
                    }
                });

                if (episodeMap.size > 0) {
                    merged.animeData[slug].episodes = Array.from(episodeMap.values()).sort((a, b) => a.number - b.number);
                    merged.animeData[slug].totalWatchTime = merged.animeData[slug].episodes.reduce((sum, ep) => sum + (ep.duration || 0), 0);
                }
            }
        }

        merged.animeData = this.removeDuplicateEpisodes(merged.animeData);
        
        // Merge videoProgress with soft delete support
        const mergedProgress = { ...(cloudData.videoProgress || {}) };
        const localProgress = localData.videoProgress || {};

        for (const [id, localP] of Object.entries(localProgress)) {
            const cloudP = mergedProgress[id];
            
            if (!cloudP) {
                // Only in local
                mergedProgress[id] = localP;
            } else {
                // Conflict resolution
                const localDeleted = !!localP.deleted;
                const cloudDeleted = !!cloudP.deleted;
                
                if (localDeleted && !cloudDeleted) {
                    // Local deleted, cloud active.
                    // If local delete is newer than cloud save, keep deleted.
                    const deleteTime = localP.deletedAt ? new Date(localP.deletedAt).getTime() : 0;
                    const saveTime = cloudP.savedAt ? new Date(cloudP.savedAt).getTime() : 0;
                    
                    if (deleteTime > saveTime) {
                        mergedProgress[id] = localP;
                    }
                    // Else cloud is newer (resurrected), keep cloud (default)
                } else if (!localDeleted && cloudDeleted) {
                    // Cloud deleted, local active.
                    // If cloud delete is newer, keep deleted (default has cloud).
                    const deleteTime = cloudP.deletedAt ? new Date(cloudP.deletedAt).getTime() : 0;
                    const saveTime = localP.savedAt ? new Date(localP.savedAt).getTime() : 0;
                    
                    if (saveTime > deleteTime) {
                        mergedProgress[id] = localP; // Local is newer
                    }
                } else if (!localDeleted && !cloudDeleted) {
                     // Both active, take newest
                    const localTime = localP.savedAt ? new Date(localP.savedAt).getTime() : 0;
                    const cloudTime = cloudP.savedAt ? new Date(cloudP.savedAt).getTime() : 0;
                    if (localTime > cloudTime) {
                         mergedProgress[id] = localP;
                    }
                }
                // If both deleted, cloud version (default) is fine
            }
        }
        merged.videoProgress = mergedProgress;

        return merged;
    },

    /**
     * Get anime that have progress but no completed episodes
     */
    getInProgressOnlyAnime(animeData, videoProgress) {
        const inProgressOnly = [];
        const trackedSlugs = new Set(Object.keys(animeData));
        
        for (const [id, progress] of Object.entries(videoProgress)) {
            const slugMatch = id.match(/^(.+)__episode-(\d+)$/);
            if (!slugMatch) continue;

            const animeSlug = slugMatch[1];
            const episodeNum = parseInt(slugMatch[2], 10);

            if (isNaN(episodeNum) || episodeNum <= 0) continue;
            if (trackedSlugs.has(animeSlug)) continue;

            let existing = inProgressOnly.find(a => a.slug === animeSlug);
            if (!existing) {
                existing = {
                    slug: animeSlug,
                    title: animeSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                    episodes: [],
                    lastProgress: progress.savedAt || new Date(0).toISOString()
                };
                inProgressOnly.push(existing);
            }

            existing.episodes.push({
                number: episodeNum,
                currentTime: progress.currentTime,
                duration: progress.duration,
                percentage: progress.percentage,
                savedAt: progress.savedAt
            });

            if (progress.savedAt && progress.savedAt > existing.lastProgress) {
                existing.lastProgress = progress.savedAt;
            }
        }
        
        return inProgressOnly;
    }
};

// Export
window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.ProgressManager = ProgressManager;
