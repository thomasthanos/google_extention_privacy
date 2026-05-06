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

    // Human-readable label for each watchlist status. Used in log messages
    // so users see "Watching" / "On Hold" instead of internal `on_hold`.
    _STATUS_LABEL: {
        watching: 'Watching',
        completed: 'Completed',
        on_hold: 'On Hold',
        plan_to_watch: 'Plan to Watch',
        dropped: 'Dropped',
        remove: 'Removed'
    },

    _statusLabel(type) {
        return this._STATUS_LABEL[type] || String(type || '');
    },

    _shortName(animeSlug, fallbackTitle) {
        // Prefer the human title if available; fall back to the slug with
        // dashes turned into spaces and Title Case so the log is readable.
        if (fallbackTitle) return String(fallbackTitle);
        if (!animeSlug) return 'this anime';
        return String(animeSlug)
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());
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

        // Verbose technical log kept at debug so it stays accessible while
        // dev-mode debugging the AJAX endpoint, but doesn't spam the console
        // for normal users.
        Logger.debug(`WatchlistSync: POST ${action} type="${type}" anime #${animeId}`);

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

            if (!res.ok) {
                Logger.warn(`Watchlist: server returned HTTP ${res.status}`);
                return false;
            }

            const text = await res.text();
            Logger.debug(`WatchlistSync: response for ${type}: ${text.substring(0, 300)}`);

            try {
                const data = JSON.parse(text);
                return data?.success !== false;
            } catch {
                if (text === '0' || text === '-1') {
                    Logger.warn('Watchlist: site rejected the change (you may need to re-login on an1me.to)');
                    return false;
                }
                return true;
            }
        } catch (e) {
            Logger.warn(`Watchlist: network error — ${e.message}`);
            return false;
        }
    },

    async updateStatus(animeId, type, animeSlug = null, options = {}) {
        const Logger = this._logger();
        const force = options.force === true;

        if (!animeId || !type) {
            Logger.debug('Watchlist: missing animeId or type, skipping');
            return;
        }

        if (!this._isLoggedIn()) {
            Logger.debug('Watchlist: not logged in on an1me.to, skipping sync');
            return;
        }

        const entry = animeSlug ? await this._loadAnimeEntry(animeSlug) : null;
        const previousType = entry?.watchlistSyncedType || null;
        const name = this._shortName(animeSlug, entry?.title);
        const newLabel = this._statusLabel(type);

        if (!force && animeSlug && type !== 'remove' && previousType === type) {
            Logger.debug(`Watchlist: "${name}" already marked as "${newLabel}", nothing to do`);
            return true;
        }

        const shouldResetBeforeAdd =
            type !== 'remove' &&
            previousType &&
            previousType !== type;

        // Build a single user-friendly intent line so the user sees ONE
        // message describing what we're doing, instead of two raw HTTP logs
        // for the remove + add pair.
        let intent;
        if (type === 'remove') {
            intent = `Watchlist: removing "${name}" from your an1me.to list…`;
        } else if (shouldResetBeforeAdd) {
            const prevLabel = this._statusLabel(previousType);
            intent = `Watchlist: updating "${name}" — ${prevLabel} → ${newLabel}…`;
        } else if (previousType === type) {
            intent = `Watchlist: re-syncing "${name}" as ${newLabel}…`;
        } else {
            intent = `Watchlist: marking "${name}" as ${newLabel}…`;
        }
        Logger.info(intent);

        if (shouldResetBeforeAdd) {
            const removed = await this._sendWatchlistRequest(animeId, 'remove', Logger);
            if (removed) {
                await this._persistSyncedType(animeSlug, 'remove');
                await new Promise(resolve => setTimeout(resolve, 200));
            } else {
                Logger.warn(`Watchlist: couldn't clear previous "${this._statusLabel(previousType)}" status for "${name}"`);
            }
        }

        const success = await this._sendWatchlistRequest(animeId, type, Logger);
        if (success) {
            if (animeSlug) await this._persistSyncedType(animeSlug, type);
            // Outcome line, distinct verbs depending on context.
            if (type === 'remove') {
                Logger.success?.(`Watchlist: ✓ removed "${name}"`)
                    || Logger.info(`Watchlist: ✓ removed "${name}"`);
            } else if (shouldResetBeforeAdd) {
                Logger.success?.(`Watchlist: ✓ updated "${name}" to ${newLabel}`)
                    || Logger.info(`Watchlist: ✓ updated "${name}" to ${newLabel}`);
            } else {
                Logger.success?.(`Watchlist: ✓ added "${name}" as ${newLabel}`)
                    || Logger.info(`Watchlist: ✓ added "${name}" as ${newLabel}`);
            }
        } else {
            Logger.warn(`Watchlist: ✗ failed to ${type === 'remove' ? 'remove' : 'mark as ' + newLabel} "${name}"`);
        }
        return success;
    },

    async repairPendingStatusesOnce() {
        const Logger = this._logger();
        const LOCK_KEY = 'watchlistRepairLock';
        const LOCK_TTL_MS = 5 * 60 * 1000;

        if (!this._isLoggedIn()) {
            Logger.debug('WatchlistSync: repair skipped, site user not logged in');
            return false;
        }

        let lockHeld = false;
        try {
            const {
                animeData = {},
                watchlistRepairVersion = 0,
                [LOCK_KEY]: lockTs = 0
            } = await chrome.storage.local.get(['animeData', 'watchlistRepairVersion', LOCK_KEY]);

            if ((Number(watchlistRepairVersion) || 0) >= this._REPAIR_VERSION) {
                Logger.debug('WatchlistSync: repair already completed for current version');
                return true;
            }

            if (Number(lockTs) && Date.now() - Number(lockTs) < LOCK_TTL_MS) {
                Logger.debug('WatchlistSync: repair lock held by another tab, skipping');
                return false;
            }

            await chrome.storage.local.set({ [LOCK_KEY]: Date.now() });
            lockHeld = true;

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
                Logger.info(`Watchlist: ✓ resynced ${entries.length} existing entries with an1me.to`);
            } else {
                Logger.warn('Watchlist: some entries failed to resync — will retry on a later page load');
            }

            return !hadFailure;
        } catch (e) {
            Logger.warn(`WatchlistSync: repair failed: ${e.message}`);
            return false;
        } finally {
            if (lockHeld) {
                try { await chrome.storage.local.remove([LOCK_KEY]); } catch {}
            }
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

// Wake the background SW and trigger one cloud poll — but only on /watch/
// pages. Previously this fired on every an1me.to page load (homepage,
// listing, anime details), which paid a Firestore read every time the user
// browsed the site even when they weren't using the tracker. Cross-device
// sync still feels instant because:
//   - the popup itself triggers a poll on open (popupAlive port connect)
//   - the watch page triggers it via cloud-sync.js content script
// The SW's `pollCloudData` self-rate-limits (5-min gate for convenience
// reasons) so this is cheap regardless.
if (/\/watch\//.test(location.pathname)) {
    try {
        chrome.runtime.sendMessage({ type: 'WAKE_AND_POLL_CLOUD' }, () => {
            if (chrome.runtime.lastError) {
                // SW unreachable (e.g. signed-out, freshly installed). Safe to ignore.
            }
        });
    } catch {
        // Extension context invalidated — ignore.
    }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'WATCHLIST_SYNC_EXECUTE') return false;

    const { animeId, watchlistType } = message;
    if (!animeId || !watchlistType) {
        sendResponse({ success: false, error: 'invalid_payload' });
        return false;
    }

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
            sendResponse({ success: false, error: e.message });
        });
    return true;
});
