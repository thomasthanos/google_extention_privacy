const AnilistService = {
    cache: {},

    CACHE_TTL: 24 * 60 * 60 * 1000,
    CACHE_TTL_AIRING: 60 * 60 * 1000,
    CACHE_TTL_NOT_FOUND: 3 * 24 * 60 * 60 * 1000,

    getTotalEpisodes(slug) {
        const data = this.cache[slug];
        if (!data || data.totalEpisodes == null) return null;
        return data.totalEpisodes;
    },

    getStatus(slug) {
        return this.cache[slug]?.status || null;
    },

    getLatestEpisode(slug) {
        const data = this.cache[slug];
        if (!data || data.latestEpisode == null) return null;
        return data.latestEpisode;
    },

    getNextEpisodeAt(slug) {
        const data = this.cache[slug];
        if (!data || !data.nextEpisodeAt) return null;
        return data.nextEpisodeAt;
    },

    async loadCachedData(animeData) {
        const { Storage } = window.AnimeTracker;

        try {
            const keys = Object.keys(animeData).map(slug => `animeinfo_${slug}`);
            if (keys.length === 0) return;

            const result = await Storage.get(keys);
            let loaded = 0;
            const keysToPurge = [];

            const isSeasonLikeSlug = (slug) =>
                /-(?:season-?\d+|(?:\d+)(?:st|nd|rd|th)-season|s\d+|(?:part|cour)-?\d+|(?:ii|iii|iv|v|vi))(?=$|-)/i
                    .test(String(slug || ''));

            let needsSave = false;
            for (const [key, value] of Object.entries(result)) {
                if (!key.startsWith('animeinfo_') || !value) continue;
                const slug = key.replace('animeinfo_', '');

                if (!value.notFound && isSeasonLikeSlug(slug) && !value.resolvedSlug) {
                    keysToPurge.push(key);
                    continue;
                }

                this.cache[slug] = value;
                loaded++;

                if (value.coverImage && animeData[slug] && !animeData[slug].coverImage) {
                    animeData[slug].coverImage = value.coverImage;
                    needsSave = true;
                }
            }

            if (keysToPurge.length > 0) {
                await Storage.remove(keysToPurge);
            }
            if (needsSave) {
                await Storage.set({ animeData });
            }

        } catch (error) {
            PopupLogger.error('AnimeInfo', 'Failed to load cache:', error);
        }
    },

    async autoFetchMissing(animeData, onComplete) {
        const { Storage } = window.AnimeTracker;

        try {
            await this.loadCachedData(animeData);

            const migrationKey = 'animeinfo_coverimage_migration_done';
            const migResult = await Storage.get([migrationKey]);
            if (!migResult[migrationKey]) {
                const MIGRATION_BATCH = 6;
                let cleared = 0;
                for (const slug of Object.keys(animeData)) {
                    if (cleared >= MIGRATION_BATCH) break;
                    const cached = this.cache[slug];
                    if (cached && cached.cachedAt && !cached.coverImage && !cached.notFound) {
                        delete this.cache[slug];
                        cleared++;
                    }
                }
                if (cleared === 0) {
                    await Storage.set({ [migrationKey]: true });
                }
            }

            const now = Date.now();
            const slugsToFetch = Object.keys(animeData).filter(slug => {
                const cached = this.cache[slug];
                if (!cached || !cached.cachedAt) return true;
                const age = now - cached.cachedAt;
                if (cached.notFound) {
                    return age >= this.CACHE_TTL_NOT_FOUND;
                }
                const ttl = cached.status === 'RELEASING' ? this.CACHE_TTL_AIRING : this.CACHE_TTL;
                return age >= ttl;
            });

            if (slugsToFetch.length === 0) {
                if (onComplete) onComplete();
                return;
            }

            PopupLogger.log('AnimeInfo', `Delegating ${slugsToFetch.length} anime to background...`);

            chrome.runtime.sendMessage(
                { type: 'BATCH_FETCH_ANIME_INFO', slugs: slugsToFetch },
                () => { if (chrome.runtime.lastError) { } }
            );

            if (onComplete) onComplete();
        } catch (error) {
            PopupLogger.error('AnimeInfo', 'Auto-fetch error:', error);
        }
    }
};

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.AnilistService = AnilistService;