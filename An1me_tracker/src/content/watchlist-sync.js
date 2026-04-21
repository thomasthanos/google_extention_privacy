const WatchlistSync = {
    _AJAX_URL: 'https://an1me.to/wp-admin/admin-ajax.php',

    async updateStatus(animeId, type, animeSlug = null) {
        const { Logger } = window.AnimeTrackerContent;

        if (!animeId || !type) {
            Logger.debug('WatchlistSync: missing animeId or type');
            return;
        }

        if (!this._isLoggedIn()) {
            Logger.debug('WatchlistSync: user not logged in on site, skipping');
            return;
        }

        if (animeSlug && type !== 'remove') {
            try {
                const { animeData = {} } = await chrome.storage.local.get(['animeData']);
                const entry = animeData[animeSlug];
                if (entry && entry.watchlistSyncedType === type) {
                    Logger.debug(`WatchlistSync: ${type} already synced for ${animeSlug}, skip`);
                    return true;
                }
            } catch { }
        }

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

            if (res.ok) {
                const text = await res.text();
                Logger.info(`WatchlistSync: ✓ response: ${text.substring(0, 300)}`);

                let success = true;
                try {
                    const data = JSON.parse(text);
                    if (data && data.data && data.data.message) {
                        Logger.info(`WatchlistSync: ✓ ${data.data.message}`);
                    }
                } catch {
                    if (text === '0' || text === '-1') {
                        Logger.warn('WatchlistSync: ✗ WP returned failure');
                        success = false;
                    }
                }

                if (success && animeSlug) {
                    try {
                        const { animeData = {} } = await chrome.storage.local.get(['animeData']);
                        if (animeData[animeSlug]) {
                            if (type === 'remove') {
                                delete animeData[animeSlug].watchlistSyncedType;
                            } else {
                                animeData[animeSlug].watchlistSyncedType = type;
                            }
                            await chrome.storage.local.set({ animeData });
                        }
                    } catch { }
                }

                return success;
            } else {
                Logger.warn(`WatchlistSync: ✗ HTTP ${res.status}`);
                return false;
            }
        } catch (e) {
            Logger.warn(`WatchlistSync: ✗ error: ${e.message}`);
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
        if (anime.completedAt) return 'completed';
        if (isFirstEpisode) return 'watching';
        return null;
    }
};

window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.WatchlistSync = WatchlistSync;

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
                    console.log(`[WatchlistSync] via tab: ${action} type="${watchlistType}" #${animeId} → ${text.substring(0, 200)}`);
                    sendResponse({ success: true });
                })
                .catch(e => {
                    console.warn(`[WatchlistSync] via tab error:`, e.message);
                    sendResponse({ success: false });
                });
            return true;
        }
    }
});