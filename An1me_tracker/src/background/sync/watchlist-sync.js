


async function syncWatchlistToSite(animeId, type, animeSlug = null) {
    dlog(`%c WatchlistSync %c ${type} %c anime #${animeId}`, 'background:#6366f1;color:#fff;border-radius:3px 0 0 3px;padding:2px 6px;font-weight:700', 'background:#818cf8;color:#fff;padding:2px 6px', 'color:#a5b4fc');

    try {
        const tabs = await chrome.tabs.query({ url: 'https://an1me.to/*' });


        const liveTab = (tabs || []).find(t =>
            t && t.id != null && t.discarded !== true && t.status !== 'unloaded'
        );
        if (liveTab) {
            chrome.tabs.sendMessage(liveTab.id, {
                type: 'WATCHLIST_SYNC_EXECUTE',
                animeId,
                watchlistType: type,
                // Lets the content script do a proper reset-before-add and persist
                // the synced status, instead of a blind single request.
                animeSlug
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn(`%c WatchlistSync %c tab forward failed`, 'background:#ef4444;color:#fff;border-radius:3px 0 0 3px;padding:2px 6px;font-weight:700', 'color:#fca5a5', chrome.runtime.lastError.message);
                    directWatchlistFetch(animeId, type).catch(e => console.warn('[BG] WatchlistSync direct fallback failed:', e.message));
                } else {
                    dlog(`%c WatchlistSync %c ✓ forwarded to tab`, 'background:#22c55e;color:#fff;border-radius:3px 0 0 3px;padding:2px 6px;font-weight:700', 'color:#86efac');
                }
            });
        } else {
            dlog(`%c WatchlistSync %c no live tab open, direct fetch`, 'background:#f59e0b;color:#000;border-radius:3px 0 0 3px;padding:2px 6px;font-weight:700', 'color:#fcd34d');
            await directWatchlistFetch(animeId, type);
        }
    } catch (e) {
        console.warn(`%c WatchlistSync %c ✗ ${e.message}`, 'background:#ef4444;color:#fff;border-radius:3px 0 0 3px;padding:2px 6px;font-weight:700', 'color:#fca5a5');
    }
}

async function directWatchlistFetch(animeId, type) {
    const AJAX_URL = 'https://an1me.to/wp-admin/admin-ajax.php';
    const action = type === 'remove' ? 'remove_from_watchlist' : 'add_to_watchlist';
    try {
        const formData = new URLSearchParams();
        formData.append('action', action);
        formData.append('anime_id', animeId.toString());
        formData.append('type', type);

        const res = await fetchWithTimeout(AJAX_URL, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString()
        });

        const text = await res.text();
        try {
            const data = JSON.parse(text);
            if (data?.success) {
                dlog(`%c WatchlistSync %c ✓ ${data.data?.message || 'OK'}`, 'background:#22c55e;color:#fff;border-radius:3px 0 0 3px;padding:2px 6px;font-weight:700', 'color:#86efac');
            } else {
                console.warn(`%c WatchlistSync %c ✗ ${data.data?.message || text.substring(0, 100)}`, 'background:#ef4444;color:#fff;border-radius:3px 0 0 3px;padding:2px 6px;font-weight:700', 'color:#fca5a5');
            }
        } catch {
            dlog(`%c WatchlistSync %c HTTP ${res.status} ${text.substring(0, 100)}`, 'background:#6366f1;color:#fff;border-radius:3px 0 0 3px;padding:2px 6px;font-weight:700', 'color:#a5b4fc');
        }
    } catch (e) {
        console.warn(`%c WatchlistSync %c ✗ ${e.message}`, 'background:#ef4444;color:#fff;border-radius:3px 0 0 3px;padding:2px 6px;font-weight:700', 'color:#fca5a5');
    }
}
