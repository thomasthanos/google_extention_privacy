




const ProgressManager = {
    getCanonicalSlug(slug, title = '') {
        return window.AnimeTracker.SlugUtils.getCanonicalSlug(slug, title);
    },

    getCanonicalTitle(slug, title = '') {
        return window.AnimeTracker.SlugUtils.getCanonicalTitle(slug, title);
    },




    normalizeCanonicalSlugs(animeData, videoProgress = {}, deletedAnime = {}) {
        const normalizedAnime = { ...(animeData || {}) };
        const normalizedProgress = { ...(videoProgress || {}) };
        const normalizedDeleted = { ...(deletedAnime || {}) };
        const canonicalEpisodeOffsets = window.AnimeTracker?.CANONICAL_EPISODE_OFFSET_MAPPING || {};
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
            const episodeOffset = Number(canonicalEpisodeOffsets[oldSlug]) || 0;

            changed = true;
            const target = ensureTarget(canonicalSlug, oldAnime);

            const episodeMap = new Map();
            for (const ep of target.episodes || []) {
                const num = Number(ep?.number) || 0;
                if (num > 0) episodeMap.set(num, ep);
            }
            for (const ep of oldAnime?.episodes || []) {
                const num = (Number(ep?.number) || 0) + episodeOffset;
                if (num <= 0) continue;
                episodeMap.set(num, pickNewerEpisode(episodeMap.get(num), { ...ep, number: num }));
            }
            target.episodes = Array.from(episodeMap.values()).sort((a, b) => a.number - b.number);
            target.totalWatchTime = target.episodes.reduce((sum, ep) => sum + (Number(ep.duration) || 0), 0);

            if (!target.coverImage && oldAnime?.coverImage) target.coverImage = oldAnime.coverImage;
            if ((!target.title || target.title.trim() === '') && oldAnime?.title) {
                target.title = this.getCanonicalTitle(canonicalSlug, oldAnime.title);
            } else if (target.title) {
                target.title = this.getCanonicalTitle(canonicalSlug, target.title);
            }

            const oldLast = new Date(oldAnime?.lastWatched || 0).getTime();
            const targetLast = new Date(target?.lastWatched || 0).getTime();
            if (oldLast > targetLast) target.lastWatched = oldAnime.lastWatched;

            const oldTotal = Number.isFinite(oldAnime?.totalEpisodes) ? oldAnime.totalEpisodes + episodeOffset : null;
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
                const epNum = parseInt(match[1], 10) + episodeOffset;
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




    removeDuplicateEpisodes(animeData) {
        const log = (window.PopupLogger && window.PopupLogger.warn) || console.warn;
        if (!animeData || typeof animeData !== 'object') {
            log('Cleanup', 'Invalid animeData provided');
            return {};
        }

        const cleaned = { ...animeData };

        for (const [slug, anime] of Object.entries(cleaned)) {
            if (!anime || typeof anime !== 'object') {
                log('Cleanup', 'Invalid anime entry:', slug);
                delete cleaned[slug];
                continue;
            }

            if (!anime.episodes) {
                cleaned[slug].episodes = [];
                cleaned[slug].totalWatchTime = 0;
                continue;
            }

            if (!Array.isArray(anime.episodes)) {
                log('Cleanup', 'Episodes is not an array for:', slug);
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





    removeAutoRepairedEpisodes(animeData) {
        if (!animeData || typeof animeData !== 'object') {
            return { cleanedData: {}, removedCount: 0 };
        }

        const cleanedData = { ...animeData };
        let removedCount = 0;

        for (const [slug, anime] of Object.entries(cleanedData)) {
            if (!anime || !Array.isArray(anime.episodes)) continue;

            const originalEpisodes = anime.episodes;
            const filteredEpisodes = originalEpisodes.filter(ep => !ep?.autoRepaired);

            if (filteredEpisodes.length === originalEpisodes.length) continue;

            removedCount += originalEpisodes.length - filteredEpisodes.length;
            anime.episodes = filteredEpisodes.sort((a, b) => (Number(a?.number) || 0) - (Number(b?.number) || 0));
            anime.totalWatchTime = anime.episodes.reduce((sum, ep) => sum + (Number(ep?.duration) || 0), 0);

            const latestWatchedAt = anime.episodes.reduce((latest, ep) => {
                const ts = new Date(ep?.watchedAt || 0).getTime();
                return ts > latest ? ts : latest;
            }, 0);
            anime.lastWatched = latestWatchedAt > 0 ? new Date(latestWatchedAt).toISOString() : null;
        }

        return { cleanedData, removedCount };
    },




    cleanTrackedProgress(animeData, videoProgress, deletedAnime = {}) {
        const { UIHelpers } = window.AnimeTracker;
        const { CONFIG } = window.AnimeTracker;
        const { SeasonGrouping } = window.AnimeTracker;
        const { removeDeletedProgress } = window.AnimeTracker.MergeUtils;

        if (!videoProgress || Object.keys(videoProgress).length === 0) {
            return { cleaned: videoProgress, removedCount: 0 };
        }

        const baseProgress = removeDeletedProgress(videoProgress, deletedAnime);

        const trackedIds = new Set();
        for (const [animeSlug, anime] of Object.entries(animeData)) {
            if (anime.episodes) {
                anime.episodes.forEach(ep => {


                    if (anime.onHoldAt || anime.listState === 'on_hold') return;


                    if (ep?.durationSource === 'anilist') return;
                    trackedIds.add(UIHelpers.getUniqueId(animeSlug, ep.number));
                });
            }
        }

        const cleaned = {};
        let removedCount = 0;

        for (const [id, progress] of Object.entries(baseProgress)) {
            const isTracked = trackedIds.has(id);
            const isCompleted = progress.percentage >= CONFIG.COMPLETED_PERCENTAGE;
            const slugMatch = id.match(/^(.+)__episode-\d+$/);
            const animeSlug = slugMatch ? slugMatch[1] : '';
            const animeEntry = animeSlug ? animeData[animeSlug] : null;
            const isMovieProgress = !!animeEntry && SeasonGrouping?.isMovie?.(animeSlug, animeEntry);


            if (isTracked && isMovieProgress && !progress.deleted) {
                cleaned[id] = progress;
                continue;
            }

            if (isTracked || isCompleted) {


                removedCount++;
            } else {


                cleaned[id] = progress;
            }
        }

        return { cleaned, removedCount };
    },






    getInProgressAnime(animeData, videoProgress) {
        const inProgressMap = new Map();
        const completedPercentage = window.AnimeTracker?.CONFIG?.COMPLETED_PERCENTAGE || 85;
        const trackedEpsBySlug = new Map();

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
            let trackedEpisodeNumbers = trackedEpsBySlug.get(animeSlug);
            if (!trackedEpisodeNumbers) {
                trackedEpisodeNumbers = new Set(
                    !(trackedAnime?.onHoldAt || trackedAnime?.listState === 'on_hold')
                        && Array.isArray(trackedAnime?.episodes)
                        ? trackedAnime.episodes


                            .filter(ep => ep?.durationSource !== 'anilist')
                            .map(ep => Number(ep?.number)).filter(n => Number.isFinite(n) && n > 0)
                        : []
                );
                trackedEpsBySlug.set(animeSlug, trackedEpisodeNumbers);
            }


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
                watchedAt: progress.watchedAt || progress.savedAt,
                pagePath: progress.pagePath || null
            });

            if (progress.savedAt && progress.savedAt > existing.lastProgress) {
                existing.lastProgress = progress.savedAt;
            }


            if (progress.coverImage && !existing.coverImage) {
                existing.coverImage = progress.coverImage;
            }
        }

        return Array.from(inProgressMap.values());
    }
};


window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.ProgressManager = ProgressManager;
