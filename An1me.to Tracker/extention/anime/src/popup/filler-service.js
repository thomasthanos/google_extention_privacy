/**
 * Anime Tracker - Filler Service
 * Handles filler detection and fetching from AnimeFillerList.com
 */

const FillerService = {
    // Known filler episodes - populated dynamically from animefillerlist.com
    KNOWN_FILLERS: {},

    // Cached sorted keys for getNormalizedFillerSlug (invalidated on KNOWN_FILLERS mutation)
    _sortedFillerKeys: null,

    // Episode types cache
    episodeTypesCache: {},

    /**
     * Get normalized slug for filler lookup.
     * Keys are checked longest-first so that more specific slugs (e.g.
     * "naruto-shippuden") always win over shorter prefixes (e.g. "naruto").
     */
    getNormalizedFillerSlug(slug) {
        const lowerSlug = slug.toLowerCase();

        // Fast path: exact match
        if (this.KNOWN_FILLERS[lowerSlug]) return lowerSlug;

        const cleanSlug = lowerSlug
            .replace(/-?(episode|ep|tv|dub|sub|subbed|dubbed|season|s\d+)s?(-.*)?$/i, '')
            .replace(/-+$/, '');

        if (this.KNOWN_FILLERS[cleanSlug]) return cleanSlug;

        // Sort keys longest-first (cached; invalidated when KNOWN_FILLERS is mutated).
        if (!this._sortedFillerKeys) {
            this._sortedFillerKeys = Object.keys(this.KNOWN_FILLERS).sort((a, b) => b.length - a.length);
        }
        const sortedKeys = this._sortedFillerKeys;

        for (const key of sortedKeys) {
            if (lowerSlug === key || cleanSlug === key) {
                return key;
            }
            if (lowerSlug.startsWith(key + '-') || cleanSlug.startsWith(key + '-')) {
                return key;
            }
        }

        return lowerSlug;
    },

    /**
     * Check if slug looks like a movie/special that won't have filler data
     */
    isLikelyMovie(slug) {
        return !!globalThis.AnimeTrackerMergeUtils?.isLikelyMovieSlug?.(slug);
    },

    /**
     * Fetch episode types from animefillerlist.com via background script.
     * Pass animeTitle so background can use it for slug discovery.
     * Returns the cached/fetched episode types, or null if not available.
     */
    async fetchEpisodeTypes(animeSlug, animeTitle = null) {
        const { CONFIG } = window.AnimeTracker;
        const { Storage } = window.AnimeTracker;
        const { Logger } = window.AnimeTracker;

        if (this.isLikelyMovie(animeSlug)) {
            Logger.info(`Skipping filler fetch for ${animeSlug} (detected as movie/OVA/special)`);
            return null;
        }

        if (this.episodeTypesCache[animeSlug]) {
            const cached = this.episodeTypesCache[animeSlug];

            if (cached.notFound) {
                const age = cached.cachedAt ? Date.now() - cached.cachedAt : Infinity;
                if (age < CONFIG.FILLER_NOT_FOUND_CACHE_TTL) return null;
                delete this.episodeTypesCache[animeSlug];
            }

            const cacheAge = cached.cachedAt ? Date.now() - cached.cachedAt : Infinity;
            if (cacheAge < CONFIG.EPISODE_TYPES_CACHE_TTL) {
                return cached;
            } else {
                delete this.episodeTypesCache[animeSlug];
            }
        }

        try {
            Logger.info(`Fetching episode types for ${animeSlug}...`);

            const response = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Message timeout after 15s')), 15000);
                chrome.runtime.sendMessage(
                    { type: 'FETCH_EPISODE_TYPES', animeSlug, animeTitle },
                    (response) => {
                        clearTimeout(timer);
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            resolve(response);
                        }
                    }
                );
            });

            if (response.success) {
                const cachedData = {
                    ...response.episodeTypes,
                    cachedAt: Date.now(),
                    _fillerSlug: response.fillerSlug || null  // persist so loadCachedEpisodeTypes can use it
                };

                this.episodeTypesCache[animeSlug] = cachedData;
                await Storage.set({ [`episodeTypes_${animeSlug}`]: cachedData });

                Logger.success(`Fetched episode types for ${animeSlug} (filler slug: ${response.fillerSlug})`);
                return cachedData;
            } else if (response.notFound) {
                const notFoundEntry = { notFound: true, cachedAt: Date.now() };
                this.episodeTypesCache[animeSlug] = notFoundEntry;
                await Storage.set({ [`episodeTypes_${animeSlug}`]: notFoundEntry });
                return null;
            } else {
                throw new Error(response.error || 'Unknown error');
            }
        } catch (error) {
            Logger.warn(`Failed to fetch episode types for ${animeSlug}: ${error.message}`);
            return null;
        }
    },

    /**
     * Update KNOWN_FILLERS from fetched episode types.
     */
    updateFromEpisodeTypes(animeSlug, episodeTypes) {
        const { Logger } = window.AnimeTracker;

        if (!episodeTypes) {
            Logger.error('updateFromEpisodeTypes: episodeTypes is null/undefined');
            return;
        }

        const slugVariations = new Set([
            animeSlug.toLowerCase(),
            animeSlug.toLowerCase().replace(/-\d{4}$/i, ''),
        ]);
        if (episodeTypes._fillerSlug) slugVariations.add(episodeTypes._fillerSlug.toLowerCase());

        let fillerRanges = [];

        if (!episodeTypes.filler || episodeTypes.filler.length === 0) {
            Logger.info(`No fillers found for ${animeSlug}`);
        } else {
            const sortedFillers = [...episodeTypes.filler].sort((a, b) => a - b);
            let start = sortedFillers[0];
            let end = sortedFillers[0];

            for (let i = 1; i <= sortedFillers.length; i++) {
                if (i < sortedFillers.length && sortedFillers[i] === end + 1) {
                    end = sortedFillers[i];
                } else {
                    fillerRanges.push([start, end]);
                    if (i < sortedFillers.length) {
                        start = sortedFillers[i];
                        end = sortedFillers[i];
                    }
                }
            }
            Logger.success(`Updated KNOWN_FILLERS for ${animeSlug}`, fillerRanges);
        }

        slugVariations.forEach(slug => {
            this.KNOWN_FILLERS[slug] = fillerRanges;
        });
        this._sortedFillerKeys = null; // invalidate sorted-keys cache
    },

    /**
     * Load cached episode types from storage
     */
    async loadCachedEpisodeTypes(animeData) {
        const { Storage } = window.AnimeTracker;
        const { Logger } = window.AnimeTracker;

        try {
            const keys = Object.keys(animeData);
            const storageKeys = keys.map(slug => `episodeTypes_${slug}`);

            if (storageKeys.length === 0) return;

            const result = await Storage.get(storageKeys);

            for (const [key, value] of Object.entries(result)) {
                if (key.startsWith('episodeTypes_') && value) {
                    const slug = key.replace('episodeTypes_', '');
                    this.episodeTypesCache[slug] = value;
                    this.updateFromEpisodeTypes(slug, value);
                }
            }

        } catch (error) {
            Logger.error('Failed to load cached episode types:', error);
        }
    },

    /**
     * Auto-fetch missing episode types with rate limiting.
     * Returns true if any new data was fetched, false if everything was cached.
     */
    async autoFetchMissing(animeData, onComplete) {
        const { CONFIG } = window.AnimeTracker;
        const { Logger } = window.AnimeTracker;

        try {
            const animeSlugs = Object.keys(animeData);
            const slugsToFetch = [];

            for (const slug of animeSlugs) {
                if (this.episodeTypesCache[slug]) continue;
                if (this.isLikelyMovie(slug)) continue;
                slugsToFetch.push(slug);
            }

            if (slugsToFetch.length === 0) {
                return false;
            }

            const MAX_TOTAL = CONFIG.AUTO_FETCH_MAX_TOTAL;
            const limited   = slugsToFetch.slice(0, MAX_TOTAL);
            if (slugsToFetch.length > MAX_TOTAL) {
                Logger.warn(`Auto-fetch: capping at ${MAX_TOTAL} of ${slugsToFetch.length} pending anime`);
            }

            Logger.info(`Auto-fetching episode types for ${limited.length} anime...`);

            const BATCH_SIZE = CONFIG.AUTO_FETCH_BATCH_SIZE;
            const BASE_DELAY = CONFIG.AUTO_FETCH_BASE_DELAY_MS;
            let successCount = 0;
            let failCount = 0;

            for (let i = 0; i < limited.length; i += BATCH_SIZE) {
                const batch = limited.slice(i, i + BATCH_SIZE);

                const results = await Promise.allSettled(
                    batch.map(async (slug) => {
                        try {
                            const animeTitle = animeData[slug]?.title || null;
                            const episodeTypes = await this.fetchEpisodeTypes(slug, animeTitle);
                            if (episodeTypes) {
                                this.updateFromEpisodeTypes(slug, episodeTypes);
                                return { slug, success: true };
                            }
                            return { slug, success: false };
                        } catch (error) {
                            return { slug, success: false, error };
                        }
                    })
                );

                results.forEach(result => {
                    if (result.status === 'fulfilled' && result.value.success) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                });

                let delay = BASE_DELAY;
                if (failCount > successCount && failCount > 2) {
                    delay = Math.min(BASE_DELAY * Math.pow(2, Math.floor(failCount / 3)), 10000);
                    Logger.warn(`Rate limit suspected, backing off to ${delay}ms`);
                }

                if (i + BATCH_SIZE < limited.length) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }

            Logger.info(`Auto-fetch complete: ${successCount} success, ${failCount} failed`);

            if (onComplete && successCount > 0) onComplete();

            return successCount > 0;
        } catch (error) {
            Logger.error('Auto-fetch error:', error);
            return false;
        }
    },

    /**
     * Check if an episode is filler
     */
    isFillerEpisode(slug, episodeNum) {
        const normalizedSlug = this.getNormalizedFillerSlug(slug);
        const fillers = this.KNOWN_FILLERS[normalizedSlug];
        if (!fillers) return false;
        return fillers.some(([start, end]) => episodeNum >= start && episodeNum <= end);
    },

    /**
     * Count filler episodes watched
     */
    countFillerEpisodes(slug, episodes) {
        const normalizedSlug = this.getNormalizedFillerSlug(slug);
        if (!episodes || !this.KNOWN_FILLERS[normalizedSlug]) return 0;
        return episodes.filter(ep => this.isFillerEpisode(slug, ep.number)).length;
    },

    /**
     * Get filler info for anime
     */
    getFillerInfo(slug, episodes) {
        const normalizedSlug = this.getNormalizedFillerSlug(slug);
        const fillers = this.KNOWN_FILLERS[normalizedSlug];
        if (!fillers || fillers.length === 0) return null;

        const totalFillers = fillers.reduce((sum, [start, end]) => sum + (end - start + 1), 0);
        const watchedFillers = this.countFillerEpisodes(slug, episodes);

        return { total: totalFillers, watched: watchedFillers };
    },

    /**
     * Get skipped filler episodes (watched past them but didn't watch them)
     */
    getSkippedFillers(slug, episodes, currentEpisode) {
        const normalizedSlug = this.getNormalizedFillerSlug(slug);
        const fillers = this.KNOWN_FILLERS[normalizedSlug];
        if (!fillers || fillers.length === 0) return [];

        const watchedEpisodeNumbers = new Set((episodes || []).map(ep => ep.number));
        const skippedFillers = [];

        for (const [start, end] of fillers) {
            for (let ep = start; ep <= end; ep++) {
                if (ep < currentEpisode && !watchedEpisodeNumbers.has(ep)) {
                    skippedFillers.push(ep);
                }
            }
        }

        return skippedFillers.sort((a, b) => a - b);
    },

    /**
     * Format skipped fillers into compact ranges
     */
    formatSkippedFillersCompact(fillerNumbers) {
        if (!fillerNumbers || fillerNumbers.length === 0) return '';

        const ranges = [];
        let start = fillerNumbers[0];
        let end = fillerNumbers[0];

        for (let i = 1; i <= fillerNumbers.length; i++) {
            if (i < fillerNumbers.length && fillerNumbers[i] === end + 1) {
                end = fillerNumbers[i];
            } else {
                if (start === end) {
                    ranges.push(String(start));
                } else if (end === start + 1) {
                    ranges.push(`${start}, ${end}`);
                } else {
                    ranges.push(`${start}-${end}`);
                }
                if (i < fillerNumbers.length) {
                    start = fillerNumbers[i];
                    end = fillerNumbers[i];
                }
            }
        }

        return ranges.join(', ');
    },

    /**
     * Get unwatched filler episodes up to a given total
     */
    getUnwatchedFillers(slug, episodes, totalEpisodes) {
        const normalizedSlug = this.getNormalizedFillerSlug(slug);
        const fillers = this.KNOWN_FILLERS[normalizedSlug];
        if (!fillers || fillers.length === 0) return [];

        const watchedEpisodeNumbers = new Set((episodes || []).map(ep => ep.number));
        const unwatchedFillers = [];

        for (const [start, end] of fillers) {
            for (let ep = start; ep <= end && ep <= totalEpisodes; ep++) {
                if (!watchedEpisodeNumbers.has(ep)) {
                    unwatchedFillers.push(ep);
                }
            }
        }

        return unwatchedFillers.sort((a, b) => a - b);
    },

    /**
     * Get watched canon episode count (total minus fillers)
     */
    getCanonEpisodeCount(slug, episodes) {
        if (!episodes) return 0;
        const fillerCount = this.countFillerEpisodes(slug, episodes);
        return episodes.length - fillerCount;
    },

    /**
     * Get total canon episodes for anime
     */
    getTotalCanonEpisodes(slug, totalEpisodes) {
        const normalizedSlug = this.getNormalizedFillerSlug(slug);
        const fillers = this.KNOWN_FILLERS[normalizedSlug];
        if (!fillers || fillers.length === 0) return totalEpisodes;

        const totalFillers = fillers.reduce((sum, [start, end]) => sum + (end - start + 1), 0);
        return totalEpisodes - totalFillers;
    },

    /**
     * Get total episodes for anime.
     * Priority: AnilistService → stored anime.totalEpisodes → null.
     */
    getTotalEpisodes(slug, watchedCount, anime = null) {
        const normalizedSlug = slug.toLowerCase();

        const anilistTotal = window.AnimeTracker?.AnilistService?.getTotalEpisodes(normalizedSlug);
        if (anilistTotal && anilistTotal > 0) return anilistTotal;

        if (anime && Number.isFinite(anime.totalEpisodes) && anime.totalEpisodes > 0) {
            return anime.totalEpisodes;
        }

        return null;
    },

    /**
     * Calculate progress percentage.
     * Returns { progress, total, isGuessed }.
     * total=null means the episode count is unknown (airing / N/A on site).
     */
    calculateProgress(episodeCount, slug, anime = null) {
        const totalEpisodes = this.getTotalEpisodes(slug, episodeCount, anime);

        if (!totalEpisodes) {
            return { progress: null, total: null, isGuessed: false };
        }

        if (anime && anime.episodes) {
            const canonWatched = this.getCanonEpisodeCount(slug, anime.episodes);
            const totalCanon = this.getTotalCanonEpisodes(slug, totalEpisodes);
            if (canonWatched >= totalCanon && totalCanon > 0) {
                return { progress: 100, total: totalEpisodes, isGuessed: false };
            }
        }

        if (episodeCount >= totalEpisodes) {
            return { progress: 100, total: totalEpisodes, isGuessed: false };
        }

        const progress = (episodeCount / totalEpisodes) * 100;
        const hasKnownTotal = window.AnimeTracker?.AnilistService?.getTotalEpisodes(slug.toLowerCase()) != null
            || (anime && Number.isFinite(anime.totalEpisodes) && anime.totalEpisodes > 0);

        return {
            progress: Math.min(progress, 100),
            total: totalEpisodes,
            isGuessed: !hasKnownTotal
        };
    },

    /**
     * Clear cached filler data for a specific slug (in-memory + storage).
     * Useful when a show gets a filler list added to animefillerlist.com and
     * the notFound entry would otherwise block re-fetching for 7 days.
     *
     * @param {string} animeSlug  - the an1me.to slug
     * @param {boolean} [persist=true] - also remove from chrome.storage.local
     * @returns {Promise<void>}
     */
    async clearCache(animeSlug, persist = true) {
        const { Storage } = window.AnimeTracker;
        const { Logger } = window.AnimeTracker;

        delete this.episodeTypesCache[animeSlug];

        if (persist) {
            try {
                await Storage.remove([`episodeTypes_${animeSlug}`]);
                await new Promise((resolve) => {
                    const timer = setTimeout(resolve, 5000);
                    chrome.runtime.sendMessage(
                        { type: 'CLEAR_FILLER_CACHE', animeSlug },
                        () => { clearTimeout(timer); chrome.runtime.lastError; resolve(); }
                    );
                });
                Logger.success(`Cleared filler cache for ${animeSlug}`);
            } catch (e) {
                Logger.warn(`Failed to clear filler storage for ${animeSlug}:`, e);
            }
        }
    },

    /**
     * Check if anime has filler data
     */
    hasFillerData(slug) {
        const normalizedSlug = this.getNormalizedFillerSlug(slug);
        return this.KNOWN_FILLERS[normalizedSlug] && this.KNOWN_FILLERS[normalizedSlug].length > 0;
    }
};

// Export
window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.FillerService = FillerService;
