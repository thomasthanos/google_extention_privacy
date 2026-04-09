/**
 * Anime Tracker - Anime Info Service
 * Reads cached anime info from chrome.storage.
 * All fetching is delegated to the background service worker.
 */

const AnilistService = {
    // In-memory cache: slug → { totalEpisodes, status, cachedAt }
    cache: {},

    CACHE_TTL:        24 * 60 * 60 * 1000, // 24h for finished anime
    CACHE_TTL_AIRING:      60 * 60 * 1000, // 1h for airing anime (episode count changes)
    CACHE_TTL_NOT_FOUND: 3 * 24 * 60 * 60 * 1000,

    // ── Public API ──────────────────────────────────────────────────────────────

    /** Returns total episode count from an1me.to, or null. */
    getTotalEpisodes(slug) {
        const data = this.cache[slug];
        if (!data || data.totalEpisodes == null) return null;
        return data.totalEpisodes;
    },

    /** Returns status string or null. Values: 'FINISHED' | 'RELEASING' */
    getStatus(slug) {
        return this.cache[slug]?.status || null;
    },

    /** Returns the highest episode number actually available on an1me.to, or null. */
    getLatestEpisode(slug) {
        const data = this.cache[slug];
        if (!data || data.latestEpisode == null) return null;
        return data.latestEpisode;
    },

    // ── Cache management ────────────────────────────────────────────────────────

    /** Load previously cached entries from chrome.storage. */
    async loadCachedData(animeData) {
        const { Storage } = window.AnimeTracker;

        try {
            const keys = Object.keys(animeData).map(slug => `animeinfo_${slug}`);
            if (keys.length === 0) return;

            const result = await Storage.get(keys);
            let loaded = 0;

            let needsSave = false;
            for (const [key, value] of Object.entries(result)) {
                if (!key.startsWith('animeinfo_') || !value) continue;
                const slug = key.replace('animeinfo_', '');
                this.cache[slug] = value;
                loaded++;

                // Backfill coverImage into animeData if missing
                if (value.coverImage && animeData[slug] && !animeData[slug].coverImage) {
                    animeData[slug].coverImage = value.coverImage;
                    needsSave = true;
                }
            }
            if (needsSave) {
                await Storage.set({ animeData });
            }

        } catch (error) {
            PopupLogger.error('AnimeInfo', 'Failed to load cache:', error);
        }
    },

    /**
     * Identify missing anime info and delegate fetching to background.
     * Fire-and-forget — the popup re-renders via storage.onChanged.
     */
    async autoFetchMissing(animeData, onComplete) {
        const { Storage } = window.AnimeTracker;

        try {
            await this.loadCachedData(animeData);

            // Gradual migration: find cached entries missing coverImage
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

            // Collect slugs that need fetching
            const slugsToFetch = Object.keys(animeData).filter(slug => {
                const cached = this.cache[slug];
                return !cached || !cached.cachedAt;
            });

            if (slugsToFetch.length === 0) {
                if (onComplete) onComplete();
                return;
            }

            PopupLogger.log('AnimeInfo', `Delegating ${slugsToFetch.length} anime to background...`);

            // Fire-and-forget: send to background service worker
            chrome.runtime.sendMessage(
                { type: 'BATCH_FETCH_ANIME_INFO', slugs: slugsToFetch },
                () => { if (chrome.runtime.lastError) { /* ignore */ } }
            );

            if (onComplete) onComplete();
        } catch (error) {
            PopupLogger.error('AnimeInfo', 'Auto-fetch error:', error);
        }
    }
};

// Export
window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.AnilistService = AnilistService;
