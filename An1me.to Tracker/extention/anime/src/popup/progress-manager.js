/**
 * Anime Tracker - Progress Manager
 * Handles progress tracking, cleaning, and data management
 */

const ProgressManager = {
    getCanonicalSlug(slug, title = '') {
        const safeSlug = String(slug || '').toLowerCase();
        const safeTitle = String(title || '').toLowerCase();
        const context = `${safeSlug} ${safeTitle}`;

        if (safeSlug.startsWith('jujutsu-kaisen') || safeTitle.includes('jujutsu kaisen')) {
            if (/\b0\b|movie/.test(context)) return 'jujutsu-kaisen-0';
            if (/season\s*3|part\s*3|culling\s*game|dead[-\s]*culling|shimetsu|kaiyuu/.test(context)) {
                return 'jujutsu-kaisen-season-3';
            }
            if (/season\s*2|2nd\s*season|shibuya|kaigyoku|gyokusetsu/.test(context)) {
                return 'jujutsu-kaisen-season-2';
            }
            return 'jujutsu-kaisen';
        }

        return slug;
    },

    /**
     * Merge known slug aliases into canonical slugs (anime + progress + deleted markers).
     */
    normalizeCanonicalSlugs(animeData, videoProgress = {}, deletedAnime = {}) {
        const normalizedAnime = { ...(animeData || {}) };
        const normalizedProgress = { ...(videoProgress || {}) };
        const normalizedDeleted = { ...(deletedAnime || {}) };
        let changed = false;

        const pickNewerEpisode = (current, candidate) => {
            if (!current) return candidate;
            if (!candidate) return current;
            const currentTs = new Date(current.watchedAt || 0).getTime();
            const candidateTs = new Date(candidate.watchedAt || 0).getTime();
            if (candidateTs > currentTs) return candidate;
            if (candidateTs < currentTs) return current;
            const currentDuration = Number(current.duration) || 0;
            const candidateDuration = Number(candidate.duration) || 0;
            return candidateDuration >= currentDuration ? candidate : current;
        };

        const pickNewerProgress = (current, candidate) => {
            if (!current) return candidate;
            if (!candidate) return current;
            const currentTime = Number(current.currentTime) || 0;
            const candidateTime = Number(candidate.currentTime) || 0;
            if (candidateTime > currentTime) return candidate;
            if (candidateTime < currentTime) return current;
            const currentSaved = new Date(current.savedAt || current.deletedAt || 0).getTime();
            const candidateSaved = new Date(candidate.savedAt || candidate.deletedAt || 0).getTime();
            return candidateSaved >= currentSaved ? candidate : current;
        };

        const pickNewerDeleted = (current, candidate) => {
            if (!current) return candidate;
            if (!candidate) return current;
            const currentDeleted = new Date(current.deletedAt || 0).getTime();
            const candidateDeleted = new Date(candidate.deletedAt || 0).getTime();
            return candidateDeleted >= currentDeleted ? candidate : current;
        };

        const ensureTarget = (targetSlug, sourceAnime) => {
            if (!normalizedAnime[targetSlug]) {
                normalizedAnime[targetSlug] = {
                    title: sourceAnime?.title || targetSlug,
                    slug: targetSlug,
                    episodes: [],
                    totalWatchTime: 0,
                    lastWatched: sourceAnime?.lastWatched || null,
                    totalEpisodes: Number.isFinite(sourceAnime?.totalEpisodes) ? sourceAnime.totalEpisodes : null,
                    coverImage: sourceAnime?.coverImage || null
                };
            }
            const target = normalizedAnime[targetSlug];
            if (!Array.isArray(target.episodes)) target.episodes = [];
            if (!target.slug) target.slug = targetSlug;
            return target;
        };

        for (const oldSlug of Object.keys(normalizedAnime)) {
            const oldAnime = normalizedAnime[oldSlug];
            const canonicalSlug = this.getCanonicalSlug(oldSlug, oldAnime?.title || '');
            if (!canonicalSlug || canonicalSlug === oldSlug) continue;

            changed = true;
            const target = ensureTarget(canonicalSlug, oldAnime);

            const episodeMap = new Map();
            for (const ep of target.episodes || []) {
                const num = Number(ep?.number) || 0;
                if (num > 0) episodeMap.set(num, ep);
            }
            for (const ep of oldAnime?.episodes || []) {
                const num = Number(ep?.number) || 0;
                if (num <= 0) continue;
                episodeMap.set(num, pickNewerEpisode(episodeMap.get(num), ep));
            }
            target.episodes = Array.from(episodeMap.values()).sort((a, b) => a.number - b.number);
            target.totalWatchTime = target.episodes.reduce((sum, ep) => sum + (Number(ep.duration) || 0), 0);

            if (!target.coverImage && oldAnime?.coverImage) target.coverImage = oldAnime.coverImage;
            if ((!target.title || target.title.trim() === '') && oldAnime?.title) target.title = oldAnime.title;

            const oldLast = new Date(oldAnime?.lastWatched || 0).getTime();
            const targetLast = new Date(target?.lastWatched || 0).getTime();
            if (oldLast > targetLast) target.lastWatched = oldAnime.lastWatched;

            const oldTotal = Number.isFinite(oldAnime?.totalEpisodes) ? oldAnime.totalEpisodes : null;
            const targetTotal = Number.isFinite(target?.totalEpisodes) ? target.totalEpisodes : null;
            const maxTracked = target.episodes.reduce((m, ep) => Math.max(m, Number(ep?.number) || 0), 0);
            target.totalEpisodes = [oldTotal, targetTotal, maxTracked].filter(n => Number.isFinite(n) && n > 0).reduce((m, n) => Math.max(m, n), null);

            const oldPrefix = `${oldSlug}__episode-`;
            for (const key of Object.keys(normalizedProgress)) {
                if (!key.startsWith(oldPrefix)) continue;
                const match = key.match(/__episode-(\d+)$/i);
                if (!match) {
                    delete normalizedProgress[key];
                    continue;
                }
                const epNum = parseInt(match[1], 10);
                const newKey = `${canonicalSlug}__episode-${epNum}`;
                normalizedProgress[newKey] = pickNewerProgress(normalizedProgress[newKey], normalizedProgress[key]);
                if (newKey !== key) delete normalizedProgress[key];
            }

            if (normalizedDeleted[oldSlug]) {
                normalizedDeleted[canonicalSlug] = pickNewerDeleted(normalizedDeleted[canonicalSlug], normalizedDeleted[oldSlug]);
                delete normalizedDeleted[oldSlug];
            }

            delete normalizedAnime[oldSlug];
        }

        return {
            animeData: normalizedAnime,
            videoProgress: normalizedProgress,
            deletedAnime: normalizedDeleted,
            changed
        };
    },

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
     * Repair likely missed tracking for small internal gaps.
     * Only fills gaps of up to 2 episodes between already watched episodes.
     */
    repairLikelyMissedEpisodes(animeData) {
        const { FillerService } = window.AnimeTracker;
        const repairedData = { ...animeData };
        let repairedCount = 0;
        const nowIso = new Date().toISOString();

        for (const [slug, anime] of Object.entries(repairedData)) {
            if (!anime || !Array.isArray(anime.episodes) || anime.episodes.length < 3) continue;

            const episodeMap = new Map();
            for (const ep of anime.episodes) {
                const num = Number(ep?.number) || 0;
                if (num > 0 && !episodeMap.has(num)) {
                    episodeMap.set(num, ep);
                }
            }

            const sortedNumbers = Array.from(episodeMap.keys()).sort((a, b) => a - b);
            if (sortedNumbers.length < 3) continue;

            const durations = Array.from(episodeMap.values())
                .map(ep => Number(ep.duration) || 0)
                .filter(d => d > 0);
            const fallbackDuration = durations.length > 0
                ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
                : 1440;

            let changed = false;
            for (let i = 0; i < sortedNumbers.length - 1; i++) {
                const left = sortedNumbers[i];
                const right = sortedNumbers[i + 1];
                const gap = right - left - 1;
                if (gap <= 0 || gap > 2) continue;

                for (let missing = left + 1; missing < right; missing++) {
                    if (episodeMap.has(missing)) continue;

                    // Avoid auto-filling known filler episodes.
                    if (FillerService?.hasFillerData?.(slug) && FillerService.isFillerEpisode(slug, missing)) {
                        continue;
                    }

                    const rightEp = episodeMap.get(right);
                    episodeMap.set(missing, {
                        number: missing,
                        watchedAt: rightEp?.watchedAt || anime.lastWatched || nowIso,
                        duration: fallbackDuration,
                        autoRepaired: true
                    });
                    repairedCount++;
                    changed = true;
                }
            }

            if (changed) {
                anime.episodes = Array.from(episodeMap.values()).sort((a, b) => a.number - b.number);
                anime.totalWatchTime = anime.episodes.reduce((sum, ep) => sum + (ep.duration || 0), 0);
            }
        }

        return { repairedData, repairedCount };
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
     * Merge local and cloud data.
     * - animeData: episodes are union-merged (same episode number kept once).
     * - videoProgress: per-entry conflict resolution:
     *     both active    → higher currentTime wins; savedAt as tiebreaker
     *     local deleted  → kept if deletedAt > cloud savedAt
     *     cloud deleted  → kept unless local savedAt > cloud deletedAt
     *     both deleted   → cloud version kept (equivalent)
     */
    mergeData(localData, cloudData) {
        const { mergeAnimeData, mergeVideoProgress, mergeDeletedAnime, applyDeletedAnime } = AnimeTracker.MergeUtils;

        // Merge deletedAnime first — we need it to filter the anime union below.
        const mergedDeleted = mergeDeletedAnime(
            localData.deletedAnime  || {},
            cloudData.deletedAnime  || {}
        );

        const mergedAnime = mergeAnimeData(localData.animeData || {}, cloudData.animeData || {});

        // Remove any anime that were deleted on another device (deletedAt >= lastWatched).
        applyDeletedAnime(mergedAnime, mergedDeleted);

        const mergedProgress = mergeVideoProgress(localData.videoProgress || {}, cloudData.videoProgress || {});
        const normalized = this.normalizeCanonicalSlugs(mergedAnime, mergedProgress, mergedDeleted);

        return {
            animeData: this.removeDuplicateEpisodes(normalized.animeData),
            videoProgress: normalized.videoProgress,
            deletedAnime: normalized.deletedAnime
        };
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
