/**
 * Anime Tracker - Watchlist Sync
 * Syncs anime status changes to an1me.to's watchlist system.
 *
 * Uses admin-ajax.php with FormData (same as the site's own JS):
 *   action: "add_to_watchlist" | "remove_from_watchlist"
 *   anime_id: numeric ID
 *   type: "watching" | "completed" | "dropped" | "on_hold" | "plan_to_watch"
 *
 * Content scripts on same-origin send cookies automatically with credentials:'include'.
 */

const WatchlistSync = {
    _AJAX_URL: 'https://an1me.to/wp-admin/admin-ajax.php',

    /**
     * Update the anime's watchlist status on an1me.to.
     * @param {number} animeId - The site's numeric anime ID (current_anime_id)
     * @param {'plan_to_watch'|'watching'|'completed'|'on_hold'|'dropped'|'remove'} type
     * @param {string|null} animeSlug - Optional slug; enables cross-reload dedup
     *        (skip POST if animeData[slug].watchlistSyncedType already === type).
     */
    async updateStatus(animeId, type, animeSlug = null) {
        const { Logger } = window.AnimeTrackerContent;

        if (!animeId || !type) {
            Logger.debug('WatchlistSync: missing animeId or type');
            return;
        }

        // Check if user is logged in on the site
        if (!this._isLoggedIn()) {
            Logger.debug('WatchlistSync: user not logged in on site, skipping');
            return;
        }

        // Dedup: avoid re-posting the same type over and over across page
        // reloads / episode switches. Server accepts it but returns
        // "Already added!" — wasteful noise.
        if (animeSlug && type !== 'remove') {
            try {
                const { animeData = {} } = await chrome.storage.local.get(['animeData']);
                const entry = animeData[animeSlug];
                if (entry && entry.watchlistSyncedType === type) {
                    Logger.debug(`WatchlistSync: ${type} already synced for ${animeSlug}, skip`);
                    return true;
                }
            } catch { /* fall through and post anyway */ }
        }

        const action = type === 'remove' ? 'remove_from_watchlist' : 'add_to_watchlist';

        Logger.info(`WatchlistSync: ${action} type="${type}" anime #${animeId}`);

        try {
            // Use FormData exactly like the site's own updateWatchlistType function
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

                // Persist the synced type so we skip future identical posts
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
                    } catch { /* non-critical */ }
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

    /**
     * Check if the user is logged in on an1me.to.
     * Reads kiraConfig.logged_in or isloggedIn from page scripts.
     */
    _isLoggedIn() {
        try {
            const scripts = document.querySelectorAll('script:not([src])');
            for (const script of scripts) {
                const text = script.textContent;

                // Check kiraConfig JSON
                const configMatch = text.match(/var\s+kiraConfig\s*=\s*(\{[^;]+\})\s*;/);
                if (configMatch) {
                    try {
                        const config = JSON.parse(configMatch[1]);
                        if ('logged_in' in config) return !!config.logged_in;
                    } catch { /* continue */ }
                }

                // Check isloggedIn variable
                const loggedMatch = text.match(/(?:logged_in|isloggedIn)\s*[=:]\s*(true|false|1|0)/i);
                if (loggedMatch) {
                    return loggedMatch[1] === 'true' || loggedMatch[1] === '1';
                }
            }
        } catch { /* ignore */ }
        return false;
    },

    /**
     * Determine the appropriate watchlist type based on anime state.
     */
    getWatchlistType(anime, isFirstEpisode) {
        if (!anime) return null;
        if (anime.droppedAt) return 'dropped';
        if (anime.completedAt) return 'completed';
        if (isFirstEpisode) return 'watching';
        return null;
    }
};

// Export
window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.WatchlistSync = WatchlistSync;

// ── Listen for messages from background (popup → background → content script) ──
// This allows popup actions (drop, complete, on_hold) to sync to the site
// through an open an1me.to tab that has the user's session cookies.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'WATCHLIST_SYNC_EXECUTE') {
        const { animeId, watchlistType } = message;
        if (animeId && watchlistType) {
            // Direct fetch from content script — has site cookies
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
            return true; // async sendResponse
        }
    }
});
