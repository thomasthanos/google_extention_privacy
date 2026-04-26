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

    /**
     * Delegates the actual fetching to the BG service worker (which already
     * rate-limits via batchFetchAnimeInfo). Progress is observed by listening
     * to chrome.storage.onChanged for `animeinfo_${slug}` writes — the BG
     * persists each result after a successful fetch, so we can count those
     * as completed steps without adding any new BG-protocol surface.
     *
     * Signature now matches FillerService.autoFetchMissing(animeData, onComplete, onProgress).
     */
    async autoFetchMissing(animeData, onComplete, onProgress) {
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

            const total = slugsToFetch.length;
            const expectedKeys = new Set(slugsToFetch.map(s => `animeinfo_${s}`));
            let processed = 0;
            let storageListener = null;
            let timeoutId = null;
            let finished = false;

            const finish = () => {
                if (finished) return;
                finished = true;
                if (storageListener) {
                    try { chrome.storage.onChanged.removeListener(storageListener); } catch { }
                    storageListener = null;
                }
                if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
                if (onComplete) onComplete();
            };

            // Listen for `animeinfo_<slug>` writes that the BG emits as it
            // works through the batch. Each write = one step of progress.
            storageListener = (changes, namespace) => {
                if (namespace !== 'local') return;
                for (const key of Object.keys(changes)) {
                    if (!expectedKeys.has(key)) continue;
                    expectedKeys.delete(key);
                    processed++;
                    const slug = key.replace(/^animeinfo_/, '');
                    const title = animeData[slug]?.title || slug;
                    try {
                        if (onProgress) onProgress(processed, total, title);
                    } catch (e) {
                        PopupLogger.warn('AnimeInfo', 'onProgress threw:', e);
                    }
                    if (expectedKeys.size === 0) {
                        finish();
                        return;
                    }
                }
            };
            chrome.storage.onChanged.addListener(storageListener);

            // Safety net: BG batchFetchAnimeInfo paces ~3 anime per 1.2s, so
            // give it generous headroom (max ≈ 5s/anime, capped at 5min). If
            // anything stalls we still call onComplete so the UI unstucks.
            const MAX_WAIT_MS = Math.min(5 * 60 * 1000, Math.max(30000, total * 5000));
            timeoutId = setTimeout(finish, MAX_WAIT_MS);

            chrome.runtime.sendMessage(
                { type: 'BATCH_FETCH_ANIME_INFO', slugs: slugsToFetch },
                () => { if (chrome.runtime.lastError) finish(); }
            );
        } catch (error) {
            PopupLogger.error('AnimeInfo', 'Auto-fetch error:', error);
            if (onComplete) onComplete();
        }
    }
};

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.AnilistService = AnilistService;