/**
 * Anime Tracker - Progress Manager
 * Handles progress tracking, cleaning, and data management
 */

const ProgressManager = {
    getCanonicalSlug(slug, title = '') {
        return window.AnimeTracker.SlugUtils.getCanonicalSlug(slug, title);
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
     * Fill small tracking gaps (up to 2 consecutive missing episodes).
     * Skips filler episodes so intentionally-skipped fillers are not auto-added.
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

                    // Without filler data we can't tell intentional skips from accidents — skip repair
                    if (!FillerService?.hasFillerData?.(slug)) continue;
                    if (FillerService.isFillerEpisode(slug, missing)) continue;

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
        const { SeasonGrouping } = window.AnimeTracker;

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
            const slugMatch = id.match(/^(.+)__episode-\d+$/);
            const animeSlug = slugMatch ? slugMatch[1] : '';
            const animeEntry = animeSlug ? animeData[animeSlug] : null;
            const isMovieProgress = !!animeEntry && SeasonGrouping?.isMovie?.(animeSlug, animeEntry);

            // Keep movie progress entries for duration recovery
            if (isTracked && isMovieProgress && !progress.deleted) {
                cleaned[id] = progress;
                continue;
            }

            if (isTracked || isCompleted) {
                // Episode is already tracked in animeData → resume progress is no longer needed.
                // Completed entries (>= 85%) are also removed.
                removedCount++;
            } else {
                // Untracked + not completed → keep (user may resume later).
                // Users can manually dismiss via the × button in the In Progress section.
                cleaned[id] = progress;
            }
        }

        return { cleaned, removedCount };
    },

    /**
     * Get anime that currently have active resume progress.
     * Includes tracked titles too, so the top "In Progress" group can act as a
     * true continue-watching list.
     */
    getInProgressAnime(animeData, videoProgress) {
        const inProgressMap = new Map();
        const completedPercentage = window.AnimeTracker?.CONFIG?.COMPLETED_PERCENTAGE || 85;

        for (const [id, progress] of Object.entries(videoProgress)) {
            const slugMatch = id.match(/^(.+)__episode-(\d+)$/);
            if (!slugMatch) continue;

            const animeSlug = slugMatch[1];
            const episodeNum = parseInt(slugMatch[2], 10);

            if (isNaN(episodeNum) || episodeNum <= 0) continue;
            if (!progress || progress.deleted) continue;
            if ((Number(progress.percentage) || 0) >= completedPercentage) continue;

            const trackedAnime = animeData?.[animeSlug];
            if (trackedAnime?.completedAt || trackedAnime?.droppedAt) continue;
            const trackedEpisodeNumbers = new Set(
                Array.isArray(trackedAnime?.episodes)
                    ? trackedAnime.episodes.map(ep => Number(ep?.number)).filter(n => Number.isFinite(n) && n > 0)
                    : []
            );
            // If the episode is already in the tracked/watch list, this resume entry
            // is stale and should not appear in the top continue-watching section.
            if (trackedEpisodeNumbers.has(episodeNum)) continue;
            let existing = inProgressMap.get(animeSlug);
            if (!existing) {
                const hasTrackedEpisodes = Array.isArray(trackedAnime?.episodes) && trackedAnime.episodes.length > 0;
                existing = {
                    slug: animeSlug,
                    title: trackedAnime?.title || animeSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                    episodes: [],
                    lastProgress: progress.savedAt || new Date(0).toISOString(),
                    coverImage: progress.coverImage || trackedAnime?.coverImage || null,
                    isTracked: !!trackedAnime,
                    hasTrackedEpisodes,
                    isResumeOnly: !hasTrackedEpisodes
                };
                inProgressMap.set(animeSlug, existing);
            }

            existing.episodes.push({
                number: episodeNum,
                currentTime: progress.currentTime,
                duration: progress.duration,
                percentage: progress.percentage,
                savedAt: progress.savedAt,
                watchedAt: progress.watchedAt || progress.savedAt // watchedAt is when first started
            });

            if (progress.savedAt && progress.savedAt > existing.lastProgress) {
                existing.lastProgress = progress.savedAt;
            }

            // Update coverImage if new progress has it and existing doesn't
            if (progress.coverImage && !existing.coverImage) {
                existing.coverImage = progress.coverImage;
            }
        }

        return Array.from(inProgressMap.values());
    }
};

// Export
window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.ProgressManager = ProgressManager;
