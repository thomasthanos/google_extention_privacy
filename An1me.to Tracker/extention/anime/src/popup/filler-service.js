/**
 * Anime Tracker - Filler Service
 * Handles filler detection and fetching from AnimeFillerList.com
 */

const FillerService = {
    // Known filler episodes - populated dynamically
    KNOWN_FILLERS: {},
    
    // Known anime totals - populated dynamically
    KNOWN_ANIME_TOTALS: {},
    
    // Episode types cache
    episodeTypesCache: {},

    /**
     * Get the correct slug for animefillerlist.com
     */
    getAnimeFillerListSlug(slug) {
        const { ANIME_FILLER_LIST_SLUG_MAPPING } = window.AnimeTracker;

        // Clean up the slug
        let cleanSlug = slug
            .replace(/-episode.*$/i, '')
            .replace(/-ep-?\d+$/i, '')
            .toLowerCase();

        // Check exact mapping first
        if (ANIME_FILLER_LIST_SLUG_MAPPING[cleanSlug]) {
            return ANIME_FILLER_LIST_SLUG_MAPPING[cleanSlug];
        }

        // Try without year
        const withoutYear = cleanSlug.replace(/-\d{4}$/i, '');
        if (ANIME_FILLER_LIST_SLUG_MAPPING[withoutYear]) {
            return ANIME_FILLER_LIST_SLUG_MAPPING[withoutYear];
        }

        // Apply intelligent transformations
        let transformedSlug = cleanSlug;

        // Remove common season indicators (order matters - more specific patterns first)
        transformedSlug = transformedSlug
            .replace(/-the-final-season-kanketsu-hen$/i, '')
            .replace(/-the-final-season-part-\d+$/i, '')
            .replace(/-the-final-season$/i, '')
            .replace(/-season-\d+-part-\d+$/i, '')
            .replace(/-season-?\d+$/i, '')
            .replace(/-s\d+$/i, '')
            .replace(/-(2nd|3rd|4th|5th|6th|7th)-season$/i, '')
            .replace(/-(part|cour)-?\d+$/i, '')
            .replace(/-(final|last)-season$/i, '')
            .replace(/-new-world$/i, '')
            .replace(/-stone-age$/i, '')
            .replace(/-[a-z]+-hen$/i, '')  // Remove Japanese arc names like -yuukaku-hen
            .replace(/-2$/i, '')
            .replace(/-3$/i, '')
            .replace(/-4$/i, '')
            .replace(/-5$/i, '')
            .replace(/-6$/i, '')
            .replace(/-7$/i, '')
            .replace(/-ii$/i, '')
            .replace(/-iii$/i, '')
            .replace(/-iv$/i, '');

        // Common Japanese to English mappings
        const japaneseMappings = {
            'boku-no-hero-academia': 'my-hero-academia',
            'shingeki-no-kyojin': 'attack-titan',
            'kimetsu-no-yaiba': 'demon-slayer-kimetsu-no-yaiba',
            'hagane-no-renkinjutsushi': 'fullmetal-alchemist',
            'kenpuu-denki': 'berserk',
            'ansatsu-kyoushitsu': 'assassination-classroom',
            'nanatsu-no-taizai': 'seven-deadly-sins',
            'yakusoku-no-neverland': 'promised-neverland',
            'tensei-shitara-slime-datta-ken': 'that-time-i-got-reincarnated-slime'
        };

        // Check if any Japanese name matches
        for (const [jpSlug, enSlug] of Object.entries(japaneseMappings)) {
            if (transformedSlug.includes(jpSlug)) {
                transformedSlug = transformedSlug.replace(jpSlug, enSlug);
                break;
            }
        }

        // Try transformed slug in mapping
        if (ANIME_FILLER_LIST_SLUG_MAPPING[transformedSlug]) {
            return ANIME_FILLER_LIST_SLUG_MAPPING[transformedSlug];
        }

        // Return transformed slug if different, otherwise original clean slug
        return transformedSlug !== cleanSlug ? transformedSlug : cleanSlug;
    },

    /**
     * Get normalized slug for filler lookup
     */
    getNormalizedFillerSlug(slug) {
        const lowerSlug = slug.toLowerCase();
        
        if (this.KNOWN_FILLERS[lowerSlug]) return lowerSlug;
        
        const cleanSlug = lowerSlug
            .replace(/-?(episode|ep|tv|dub|sub|subbed|dubbed|season|s\d+)s?(-.*)?$/i, '')
            .replace(/-+$/, '');
        
        if (this.KNOWN_FILLERS[cleanSlug]) return cleanSlug;
        
        for (const key of Object.keys(this.KNOWN_FILLERS)) {
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
        const moviePatterns = [
            /-movie(-|$)/i,
            /-film(-|$)/i,
            /-gekijouban/i,
            /-the-movie/i,
            /^.*-movie-\d+/i,
            /-3d-/i,  // 3D movies
            /-ova(-|$)/i,
            /-special(-|$)/i,
            /-recap(-|$)/i
        ];
        return moviePatterns.some(pattern => pattern.test(slug));
    },

    /**
     * Check if this is an anime unlikely to have filler data on AnimeFillerList
     * (newer/niche anime that the site doesn't cover)
     */
    isUnlikelyToHaveFillerData(slug) {
        const nicherAnime = [
            'cyberpunk-edgerunners',
            'yofukashi-no-uta',
            'mashle',
            'call-of-the-night',
            'darling-in-the-franxx',
            'dandadan',
            'vinland-saga',
            'death-note',
            'higashi-no-eden'  // Not on AnimeFillerList
        ];
        return nicherAnime.some(name => slug.includes(name));
    },

    /**
     * Fetch episode types from animefillerlist.com via background script
     */
    async fetchEpisodeTypes(animeSlug) {
        const { CONFIG, ANIME_NO_FILLER_DATA, SeasonGrouping } = window.AnimeTracker;
        const { Storage } = window.AnimeTracker;
        const { Logger } = window.AnimeTracker;

        // Check if this anime is known to not have filler data
        const baseSlug = SeasonGrouping.getBaseSlug(animeSlug);
        if (ANIME_NO_FILLER_DATA && (ANIME_NO_FILLER_DATA.includes(animeSlug) || ANIME_NO_FILLER_DATA.includes(baseSlug))) {
            Logger.info(`Skipping filler fetch for ${animeSlug} (in no-filler-data list)`);
            return null;
        }

        // Skip movies, OVAs, specials - they don't have filler data
        if (this.isLikelyMovie(animeSlug)) {
            Logger.info(`Skipping filler fetch for ${animeSlug} (detected as movie/OVA/special)`);
            return null;
        }

        // Skip niche anime unlikely to be on AnimeFillerList
        if (this.isUnlikelyToHaveFillerData(animeSlug)) {
            Logger.info(`Skipping filler fetch for ${animeSlug} (unlikely to have filler data)`);
            return null;
        }

        const fillerListSlug = this.getAnimeFillerListSlug(animeSlug);

        // Check cache with TTL validation
        if (this.episodeTypesCache[animeSlug]) {
            const cached = this.episodeTypesCache[animeSlug];
            const cacheAge = cached.cachedAt ? Date.now() - cached.cachedAt : Infinity;

            if (cacheAge < CONFIG.EPISODE_TYPES_CACHE_TTL) {
                Logger.info(`Using cached episode types for ${animeSlug} (age: ${Math.round(cacheAge / 60000)}min)`);
                return cached;
            } else {
                Logger.info(`Cache expired for ${animeSlug}, refetching...`);
                delete this.episodeTypesCache[animeSlug];
            }
        }

        try {
            Logger.info(`Fetching episode types for ${animeSlug} (using slug: ${fillerListSlug})...`);

            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(
                    { type: 'FETCH_EPISODE_TYPES', animeSlug: fillerListSlug },
                    (response) => {
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
                    cachedAt: Date.now()
                };

                this.episodeTypesCache[animeSlug] = cachedData;
                await Storage.set({ [`episodeTypes_${animeSlug}`]: cachedData });

                Logger.success(`Fetched episode types for ${animeSlug}`, response.episodeTypes);
                return cachedData;
            } else {
                throw new Error(response.error || 'Unknown error');
            }
        } catch (error) {
            // Logger.error(`Failed to fetch episode types for ${animeSlug}:`, error);
            Logger.info(`Failed to fetch episode types for ${animeSlug}: ${error.message}`);
            return null;
        }
    },

    /**
     * Update KNOWN_FILLERS and KNOWN_ANIME_TOTALS from fetched episode types
     */
    updateFromEpisodeTypes(animeSlug, episodeTypes) {
        const { Logger } = window.AnimeTracker;
        
        if (!episodeTypes) {
            Logger.error('updateFromEpisodeTypes: episodeTypes is null/undefined');
            return;
        }

        Logger.info(`updateFromEpisodeTypes called for ${animeSlug}`, episodeTypes);

        const slugVariations = [
            animeSlug.toLowerCase(),
            animeSlug.toLowerCase().replace(/-\d{4}$/i, ''),
            this.getAnimeFillerListSlug(animeSlug)
        ];

        // Update total episodes if available
        if (episodeTypes.totalEpisodes && episodeTypes.totalEpisodes > 0) {
            slugVariations.forEach(slug => {
                this.KNOWN_ANIME_TOTALS[slug] = episodeTypes.totalEpisodes;
            });
            Logger.success(`Updated KNOWN_ANIME_TOTALS for ${animeSlug}: ${episodeTypes.totalEpisodes} episodes`);
        }

        // Process filler data
        let fillerRanges = [];

        if (!episodeTypes.filler || episodeTypes.filler.length === 0) {
            fillerRanges = [];
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

            Logger.info(`Loaded ${Object.keys(this.episodeTypesCache).length} cached episode types`);
        } catch (error) {
            Logger.error('Failed to load cached episode types:', error);
        }
    },

    /**
     * Auto-fetch missing episode types with rate limiting
     */
    async autoFetchMissing(animeData, onComplete) {
        const { CONFIG } = window.AnimeTracker;
        const { Logger } = window.AnimeTracker;
        
        try {
            const animeSlugs = Object.keys(animeData);
            const slugsToFetch = [];

            for (const slug of animeSlugs) {
                if (this.episodeTypesCache[slug]) continue;
                const normalizedSlug = slug.toLowerCase();
                if (this.KNOWN_ANIME_TOTALS[normalizedSlug]) continue;
                slugsToFetch.push(slug);
            }

            if (slugsToFetch.length === 0) {
                Logger.info('No anime need episode type fetching');
                return;
            }

            Logger.info(`Auto-fetching episode types for ${slugsToFetch.length} anime...`);

            const BATCH_SIZE = CONFIG.AUTO_FETCH_BATCH_SIZE;
            const BASE_DELAY = CONFIG.AUTO_FETCH_BASE_DELAY_MS;
            let successCount = 0;
            let failCount = 0;

            for (let i = 0; i < slugsToFetch.length; i += BATCH_SIZE) {
                const batch = slugsToFetch.slice(i, i + BATCH_SIZE);

                const results = await Promise.allSettled(
                    batch.map(async (slug) => {
                        try {
                            const episodeTypes = await this.fetchEpisodeTypes(slug);
                            if (episodeTypes) {
                                this.updateFromEpisodeTypes(slug, episodeTypes);
                                return { slug, success: true };
                            }
                            return { slug, success: false };
                        } catch (error) {
                            // Suppress logs for expected errors (like 404s that we might not catch elsewhere)
                            // Logger.error(`Failed to auto-fetch for ${slug}:`, error);
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

                if (i + BATCH_SIZE < slugsToFetch.length) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }

            Logger.info(`Auto-fetch complete: ${successCount} success, ${failCount} failed`);
            
            if (onComplete) onComplete();
        } catch (error) {
            Logger.error('Auto-fetch error:', error);
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
     * Count filler episodes in a range
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
        const skippedFillers = totalFillers - watchedFillers;
        
        return {
            total: totalFillers,
            watched: watchedFillers,
            skipped: skippedFillers
        };
    },

    /**
     * Get skipped filler episodes
     */
    getSkippedFillers(slug, episodes, currentEpisode) {
        const normalizedSlug = this.getNormalizedFillerSlug(slug);
        const fillers = this.KNOWN_FILLERS[normalizedSlug];
        if (!fillers || fillers.length === 0) return [];
        
        const skippedFillers = [];
        const watchedEpisodeNumbers = new Set((episodes || []).map(ep => ep.number));
        
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
     * Get unwatched filler episodes for display
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
     * Calculate canon-only watch time
     */
    getCanonWatchTime(slug, anime) {
        if (!anime.episodes) return 0;
        
        let canonTime = 0;
        for (const ep of anime.episodes) {
            if (!this.isFillerEpisode(slug, ep.number)) {
                canonTime += (ep.duration || 0);
            }
        }
        return canonTime;
    },

    /**
     * Get canon episode count
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
     * Check if slug belongs to a multi-season anime that should use per-season totals
     */
    isMultiSeasonAnime(slug) {
        const multiSeasonPrefixes = [
            'one-punch-man',        // One Punch Man
            'shingeki-no-kyojin',  // Attack on Titan
            'kimetsu-no-yaiba',     // Demon Slayer
            'boku-no-hero-academia', // My Hero Academia
            'jujutsu-kaisen'        // Jujutsu Kaisen
        ];
        return multiSeasonPrefixes.some(prefix => slug.toLowerCase().startsWith(prefix));
    },

    // Manual episode count overrides
    MANUAL_EPISODE_COUNTS: {
        'one-punch-man': 12,
        'one-punch-man-2': 12,
        'one-punch-man-season-2': 12,
        'one-punch-man-season-3': 12, // Season 3 currently has only 1 episode announced
        'wanpanman': 12, // Japanese romanization
        'wanpanman-2': 12,
        'wanpanman-season-2': 12,
        'wanpanman-season-3': 1,
        'death-note': 37,
        'cyberpunk-edgerunners': 10,
        'shingeki-no-kyojin': 25,
        'shingeki-no-kyojin-season-2': 12,
        'shingeki-no-kyojin-season-3': 12,
        'shingeki-no-kyojin-season-3-part-2': 10,
        'shingeki-no-kyojin-the-final-season': 16,
        'shingeki-no-kyojin-the-final-season-part-2': 12,
        'shingeki-no-kyojin-the-final-season-kanketsu-hen': 2, // The two long specials
        'kimetsu-no-yaiba': 26,
        'kimetsu-no-yaiba-yuukaku-hen': 11,
        'kimetsu-no-yaiba-katanakaji-no-sato-hen': 11,
        'kimetsu-no-yaiba-hashira-geiko-hen': 8,
        'higashi-no-eden': 11,
        'jujutsu-kaisen-season-2': 23,
        'jujutsu-kaisen-2nd-season': 23, // Correct slug for S2
        'jujutsu-kaisen-season-3': 12, // Fallback if user considers Hidden Inventory/Premature Death as S3
    },

    /**
     * Get total episodes for anime with improved fallback
     */
    getTotalEpisodes(slug, watchedCount, anime = null) {
        const normalizedSlug = slug.toLowerCase();

        // Check manual overrides first
        if (this.MANUAL_EPISODE_COUNTS[normalizedSlug]) {
            return this.MANUAL_EPISODE_COUNTS[normalizedSlug];
        }

        // For multi-season anime, DON'T use the global KNOWN_ANIME_TOTALS
        // because it contains the total for ALL seasons combined
        // Instead, use standard cour lengths for individual seasons
        if (!this.isMultiSeasonAnime(slug)) {
            const knownTotal = this.KNOWN_ANIME_TOTALS[normalizedSlug];
            if (knownTotal && knownTotal >= watchedCount) {
                return knownTotal;
            }

            if (anime && anime.totalEpisodes &&
                typeof anime.totalEpisodes === 'number' &&
                anime.totalEpisodes >= watchedCount &&
                anime.totalEpisodes < 10000) {
                return anime.totalEpisodes;
            }

            const cachedTypes = this.episodeTypesCache[slug];
            if (cachedTypes && cachedTypes.totalEpisodes && cachedTypes.totalEpisodes >= watchedCount) {
                return cachedTypes.totalEpisodes;
            }
        }

        // Standard cour lengths fallback (used for all multi-season anime and unknown anime)
        if (watchedCount <= 12) return 12;
        if (watchedCount <= 13) return 13;
        if (watchedCount <= 24) return 24;
        if (watchedCount <= 26) return 26;
        if (watchedCount <= 39) return 39;
        if (watchedCount <= 50) return 50;
        if (watchedCount <= 52) return 52;
        if (watchedCount <= 100) return 100;
        if (watchedCount <= 150) return 150;
        if (watchedCount <= 200) return 200;

        return Math.ceil(watchedCount / 25) * 25 + 25;
    },

    /**
     * Calculate progress percentage
     */
    calculateProgress(episodeCount, slug, anime = null) {
        const totalEpisodes = this.getTotalEpisodes(slug, episodeCount, anime);
        
        // Check for complete canon viewing
        if (anime && anime.episodes) {
            const canonWatched = this.getCanonEpisodeCount(slug, anime.episodes);
            const totalCanon = this.getTotalCanonEpisodes(slug, totalEpisodes);
            
            // If user has watched all canon episodes, force 100% progress even if fillers are skipped
            if (canonWatched >= totalCanon && totalCanon > 0) {
                 return {
                    progress: 100,
                    total: totalEpisodes,
                    isGuessed: false
                };
            }
        }

        const progress = (episodeCount / totalEpisodes) * 100;

        // For multi-season anime, we always use guessed totals per season
        const isMultiSeason = this.isMultiSeasonAnime(slug);

        const normalizedSlug = slug.toLowerCase();
        const hasKnownTotal = this.MANUAL_EPISODE_COUNTS[normalizedSlug] ||
            (!isMultiSeason && (
            this.KNOWN_ANIME_TOTALS[normalizedSlug] ||
            (anime && anime.totalEpisodes) ||
            (this.episodeTypesCache[slug] && this.episodeTypesCache[slug].totalEpisodes)
        ));

        return {
            progress: Math.min(progress, 100),
            total: totalEpisodes,
            isGuessed: !hasKnownTotal
        };
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
