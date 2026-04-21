const WatchlistSync = {
    _AJAX_URL: 'https://an1me.to/wp-admin/admin-ajax.php',
    _STANDALONE_COMPLETE_RE: /(?:^|[-_])(movie|film|ova|ona|special|fan-letter)(?:[-_]|$)/i,
    _REPAIR_VERSION: 2,

    _logger() {
        return window.AnimeTrackerContent?.Logger || {
            debug: () => {},
            info: () => {},
            warn: () => {}
        };
    },

    _looksStandaloneOneShot(entry, animeSlug = '') {
        const slug = String(animeSlug || '').toLowerCase();
        const title = String(entry?.title || '').toLowerCase();
        const totalEpisodes = Number(entry?.totalEpisodes) || 0;
        const watchedCount = Array.isArray(entry?.episodes) ? entry.episodes.length : 0;

        if (totalEpisodes === 1) return true;
        if (watchedCount === 1 && this._STANDALONE_COMPLETE_RE.test(slug)) return true;
        if (watchedCount === 1 && /\b(movie|film|ova|ona|special|fan letter)\b/i.test(title)) return true;
        return false;
    },

    resolveStatus(entry, animeSlug = null, options = {}) {
        const fallbackType = options.fallbackType || null;
        const keepFirstEpisodeAsPlanToWatch = options.keepFirstEpisodeAsPlanToWatch === true;
        const watchedCount = Array.isArray(entry?.episodes) ? entry.episodes.length : 0;
        const totalEpisodes = Number(entry?.totalEpisodes) || 0;
        const listState = String(entry?.listState || '').toLowerCase();
        const isStandaloneOneShot = this._looksStandaloneOneShot(entry, animeSlug);

        if (entry?.droppedAt || listState === 'dropped') return 'dropped';
        if (entry?.onHoldAt || listState === 'on_hold') return 'on_hold';

        if (
            entry?.completedAt ||
            listState === 'completed' ||
            (totalEpisodes > 0 && watchedCount >= totalEpisodes) ||
            isStandaloneOneShot
        ) {
            return 'completed';
        }

        if (
            keepFirstEpisodeAsPlanToWatch &&
            watchedCount === 1 &&
            !isStandaloneOneShot &&
            !(totalEpisodes > 0 && totalEpisodes <= 1)
        ) {
            return 'plan_to_watch';
        }

        if (watchedCount > 0) return 'watching';
        return fallbackType;
    },

    getProgressFallbackType(entry, animeSlug = null) {
        const watchedCount = Array.isArray(entry?.episodes) ? entry.episodes.length : 0;
        if (watchedCount > 0) return 'watching';
        return this._STANDALONE_COMPLETE_RE.test(String(animeSlug || '').toLowerCase())
            ? 'watching'
            : 'plan_to_watch';
    },

    resolveRepairStatus(entry, animeSlug = null) {
        const watchedCount = Array.isArray(entry?.episodes) ? entry.episodes.length : 0;
        const totalEpisodes = Number(entry?.totalEpisodes) || 0;
        const listState = String(entry?.listState || '').toLowerCase();

        if (entry?.droppedAt || listState === 'dropped') return 'dropped';
        if (entry?.onHoldAt || listState === 'on_hold') return 'on_hold';

        if (
            entry?.completedAt ||
            listState === 'completed' ||
            (totalEpisodes > 0 && watchedCount >= totalEpisodes) ||
            this._looksStandaloneOneShot(entry, animeSlug)
        ) {
            return 'completed';
        }

        return null;
    },

    async syncFromStorage(animeId, animeSlug, options = {}) {
        const Logger = this._logger();
        if (!animeId || !animeSlug) return false;

        try {
            const { animeData = {} } = await chrome.storage.local.get(['animeData']);
            const entry = animeData[animeSlug] || null;
            const type = this.resolveStatus(entry, animeSlug, options);
            if (!type) {
                Logger.debug(`WatchlistSync: no resolved status for ${animeSlug}`);
                return false;
            }
            return await this.updateStatus(animeId, type, animeSlug, options);
        } catch (e) {
            Logger.warn(`WatchlistSync: syncFromStorage failed for ${animeSlug}: ${e.message}`);
            return false;
        }
    },

    async _loadAnimeEntry(animeSlug) {
        if (!animeSlug) return null;
        try {
            const { animeData = {} } = await chrome.storage.local.get(['animeData']);
            return animeData[animeSlug] || null;
        } catch {
            return null;
        }
    },

    async _persistSyncedType(animeSlug, type) {
        if (!animeSlug) return;
        try {
            const { animeData = {} } = await chrome.storage.local.get(['animeData']);
            if (!animeData[animeSlug]) return;
            if (type === 'remove') {
                delete animeData[animeSlug].watchlistSyncedType;
            } else {
                animeData[animeSlug].watchlistSyncedType = type;
            }
            await chrome.storage.local.set({ animeData });
        } catch { }
    },

    async _sendWatchlistRequest(animeId, type, Logger) {
        const action = type === 'remove' ? 'remove_from_watchlist' : 'add_to_watchlist';

        Logger.info(`WatchlistSync: ${action} type="${type}" anime #${animeId}`);

        try {
            const formData = new FormData();
            formData.append('action', action);
            formData.append('anime_id', animeId.toString());
            formData.append('type', type);

            const res = await fetch(this._AJAX_URL, {
                method: 'POST',
                credentials: 'include',
                body: formData
            });

            Logger.debug(`WatchlistSync: HTTP ${res.status}`);

            if (!res.ok) {
                Logger.warn(`WatchlistSync: HTTP ${res.status}`);
                return false;
            }

            const text = await res.text();
            Logger.info(`WatchlistSync: response for ${type}: ${text.substring(0, 300)}`);

            try {
                const data = JSON.parse(text);
                if (data?.data?.message) {
                    Logger.info(`WatchlistSync: ${data.data.message}`);
                }
                return data?.success !== false;
            } catch {
                if (text === '0' || text === '-1') {
                    Logger.warn('WatchlistSync: WP returned failure');
                    return false;
                }
                return true;
            }
        } catch (e) {
            Logger.warn(`WatchlistSync: request error for ${type}: ${e.message}`);
            return false;
        }
    },

    async updateStatus(animeId, type, animeSlug = null, options = {}) {
        const Logger = this._logger();
        const force = options.force === true;

        if (!animeId || !type) {
            Logger.debug('WatchlistSync: missing animeId or type');
            return;
        }

        if (!this._isLoggedIn()) {
            Logger.debug('WatchlistSync: user not logged in on site, skipping');
            return;
        }

        const entry = animeSlug ? await this._loadAnimeEntry(animeSlug) : null;
        const previousType = entry?.watchlistSyncedType || null;

        if (!force && animeSlug && type !== 'remove' && previousType === type) {
            Logger.debug(`WatchlistSync: ${type} already synced for ${animeSlug}, skip`);
            return true;
        }

        const shouldResetBeforeAdd =
            type !== 'remove' &&
            previousType &&
            previousType !== type;

        if (shouldResetBeforeAdd) {
            const removed = await this._sendWatchlistRequest(animeId, 'remove', Logger);
            if (removed) {
                await this._persistSyncedType(animeSlug, 'remove');
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }

        const success = await this._sendWatchlistRequest(animeId, type, Logger);
        if (success && animeSlug) {
            await this._persistSyncedType(animeSlug, type);
        }
        return success;
    },

    async repairPendingStatusesOnce() {
        const Logger = this._logger();

        if (!this._isLoggedIn()) {
            Logger.debug('WatchlistSync: repair skipped, site user not logged in');
            return false;
        }

        try {
            const { animeData = {}, watchlistRepairVersion = 0 } = await chrome.storage.local.get([
                'animeData',
                'watchlistRepairVersion'
            ]);

            if ((Number(watchlistRepairVersion) || 0) >= this._REPAIR_VERSION) {
                Logger.debug('WatchlistSync: repair already completed for current version');
                return true;
            }

            const entries = Object.entries(animeData).filter(([slug, entry]) =>
                !!entry?.siteAnimeId && !!this.resolveRepairStatus(entry, slug)
            );

            if (entries.length === 0) {
                await chrome.storage.local.set({ watchlistRepairVersion: this._REPAIR_VERSION });
                return true;
            }

            let hadFailure = false;

            for (const [slug, entry] of entries) {
                const type = this.resolveRepairStatus(entry, slug);
                if (!type) continue;

                const ok = await this.updateStatus(entry.siteAnimeId, type, slug, { force: true });
                if (!ok) hadFailure = true;

                await new Promise(resolve => setTimeout(resolve, 250));
            }

            if (!hadFailure) {
                await chrome.storage.local.set({ watchlistRepairVersion: this._REPAIR_VERSION });
                Logger.info(`WatchlistSync: repaired ${entries.length} existing watchlist entries`);
            } else {
                Logger.warn('WatchlistSync: repair had failures, will retry on a later page load');
            }

            return !hadFailure;
        } catch (e) {
            Logger.warn(`WatchlistSync: repair failed: ${e.message}`);
            return false;
        }
    },

    _isLoggedIn() {
        try {
            const scripts = document.querySelectorAll('script:not([src])');
            for (const script of scripts) {
                const text = script.textContent;

                const configMatch = text.match(/var\s+kiraConfig\s*=\s*(\{[^;]+\})\s*;/);
                if (configMatch) {
                    try {
                        const config = JSON.parse(configMatch[1]);
                        if ('logged_in' in config) return !!config.logged_in;
                    } catch { }
                }

                const loggedMatch = text.match(/(?:logged_in|isloggedIn)\s*[=:]\s*(true|false|1|0)/i);
                if (loggedMatch) {
                    return loggedMatch[1] === 'true' || loggedMatch[1] === '1';
                }
            }
        } catch { }
        return false;
    },

    getWatchlistType(anime, isFirstEpisode) {
        if (!anime) return null;
        if (anime.droppedAt) return 'dropped';
        if (anime.onHoldAt) return 'on_hold';
        if (anime.completedAt) return 'completed';
        if (isFirstEpisode) return 'watching';
        return null;
    }
};

window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.WatchlistSync = WatchlistSync;

setTimeout(() => {
    WatchlistSync.repairPendingStatusesOnce().catch(() => {});
}, 2500);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'WATCHLIST_SYNC_EXECUTE') {
        const { animeId, watchlistType } = message;
        if (animeId && watchlistType) {
            const action = watchlistType === 'remove' ? 'remove_from_watchlist' : 'add_to_watchlist';
            const formData = new FormData();
            formData.append('action', action);
            formData.append('anime_id', animeId.toString());
            formData.append('type', watchlistType);

            fetch('https://an1me.to/wp-admin/admin-ajax.php', {
                method: 'POST',
                credentials: 'include',
                body: formData
            })
                .then(res => res.text())
                .then(text => {
                    console.log(`[WatchlistSync] via tab: ${action} type="${watchlistType}" #${animeId} -> ${text.substring(0, 200)}`);
                    sendResponse({ success: true });
                })
                .catch(e => {
                    console.warn('[WatchlistSync] via tab error:', e.message);
                    sendResponse({ success: false });
                });
            return true;
        }
    }
});
