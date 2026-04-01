/**
 * Anime Tracker - Anime Info Service
 * Fetches totalEpisodes + status directly from an1me.to/anime/{slug}/
 * No external API, no title matching — uses the exact same slug from the URL.
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

    // ── Fetch ───────────────────────────────────────────────────────────────────

    /** Fetch anime info via the background service worker. */
    async fetchAnimeData(slug) {
        try {
            const response = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Message timeout after 15s')), 15000);
                chrome.runtime.sendMessage(
                    { type: 'FETCH_ANIME_INFO', slug },
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

            if (response?.success && response.info) {
                return response.info;
            }
            return null;
        } catch (error) {
            console.warn(`[AnimeInfo] Fetch failed for "${slug}": ${error.message}`);
            return null;
        }
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

            for (const [key, value] of Object.entries(result)) {
                if (!key.startsWith('animeinfo_') || !value) continue;
                const slug = key.replace('animeinfo_', '');
                const age = value.cachedAt ? Date.now() - value.cachedAt : Infinity;
                const ttl = value.notFound
                    ? this.CACHE_TTL_NOT_FOUND
                    : (value.status === 'RELEASING' ? this.CACHE_TTL_AIRING : this.CACHE_TTL);
                if (age < ttl) {
                    this.cache[slug] = value;
                    loaded++;
                }
            }

        } catch (error) {
            console.error('[AnimeInfo] Failed to load cache:', error);
        }
    },

    /**
     * Fetch info for any tracked anime not yet cached.
     * Batches requests with a delay to avoid hammering the server.
     */
    async autoFetchMissing(animeData, onComplete) {
        const { Storage } = window.AnimeTracker;

        try {
            // Always reload cache first — avoids race with Firebase sync in loadData()
            await this.loadCachedData(animeData);

            // Re-fetch if not cached at all, OR if cached but episode count is missing
            const slugsToFetch = Object.keys(animeData).filter(slug => {
                const cached = this.cache[slug];
                return !cached || (cached.totalEpisodes == null && !cached.notFound);
            });

            if (slugsToFetch.length === 0) {
                if (onComplete) onComplete();
                return;
            }

            console.log(`[AnimeInfo] Fetching ${slugsToFetch.length} anime from an1me.to...`);

            const BATCH_SIZE = 3;
            const DELAY_MS   = 1200;
            let successCount = 0;

            for (let i = 0; i < slugsToFetch.length; i += BATCH_SIZE) {
                const batch = slugsToFetch.slice(i, i + BATCH_SIZE);

                await Promise.all(batch.map(async (slug) => {
                    const info = await this.fetchAnimeData(slug);
                    if (info) {
                        const entry = { ...info, cachedAt: Date.now() };
                        this.cache[slug] = entry;
                        await Storage.set({ [`animeinfo_${slug}`]: entry });
                        successCount++;
                    }
                }));

                // Re-render after each batch so badges appear progressively
                if (onComplete) onComplete();

                if (i + BATCH_SIZE < slugsToFetch.length) {
                    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
                }
            }

            console.log(`[AnimeInfo] Done — ${successCount}/${slugsToFetch.length} fetched`);
        } catch (error) {
            console.error('[AnimeInfo] Auto-fetch error:', error);
        }
    }
};

// Export
window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.AnilistService = AnilistService;
