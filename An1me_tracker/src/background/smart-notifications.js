/**
 * Anime Tracker — Smart Notifications + badge notifications (background module)
 *
 * Periodically polls the an1me.to page scraper for each tracked airing anime
 * to detect new episodes; surfaces a system notification when one drops.
 * Also owns the badge / batch-badge unlock notifications and the global
 * onClicked listener that routes notification clicks to the right URL.
 *
 * The alarm registration happens in background.js (onInstalled + onStartup +
 * SET_SMART_NOTIFICATIONS message handler) so the alarm lifecycle stays
 * co-located with the rest of the SW bootstrap.
 */

const SMART_NOTIF_ALARM = 'smartNotifCheck';
const SMART_NOTIF_INTERVAL_MINUTES = 60;
// Cap how many anime we hit per tick to keep an1me.to load polite. The
// previous cap of 5 meant a user with ~50 airing anime would take up to
// 10 hours for a full pass. 10/tick × hourly = roughly a full sweep per
// 5 hours for most users while still rate-limiting via inter-fetch delay.
const SMART_NOTIF_MAX_PER_TICK = 10;

async function checkNewEpisodes() {
    try {
        const settings = await bgStorageGet(['smartNotificationsEnabled', 'animeData', 'smartNotifLastCheck']);
        if (settings.smartNotificationsEnabled !== true) return;

        const animeData = settings.animeData || {};
        const lastCheck = settings.smartNotifLastCheck || {};
        const now = Date.now();
        const updatedLastCheck = { ...lastCheck };
        let checked = 0;

        // Sort eligible anime by oldest lastCheck timestamp first so we
        // rotate through the list across ticks instead of always hitting
        // the same first N entries.
        const eligible = Object.entries(animeData)
            .filter(([slug, anime]) => !anime.droppedAt && !anime.completedAt && !anime.onHoldAt)
            .map(([slug, anime]) => [slug, anime, lastCheck[slug] || 0])
            .sort((a, b) => a[2] - b[2])
            .map(([slug, anime]) => [slug, anime]);

        for (const [slug, anime] of eligible) {
            if (checked >= SMART_NOTIF_MAX_PER_TICK) break;

            const cachedKey = `animeinfo_${slug}`;
            const cached = (await bgStorageGet([cachedKey]))[cachedKey];

            if (!cached || (cached.status !== 'RELEASING')) continue;

            const lastCheckedTime = lastCheck[slug] || 0;
            if (now - lastCheckedTime < 3600000) continue;

            checked++;
            try {
                const info = await fetchAnimePageInfo(slug);
                if (!info?.latestEpisode) continue;

                const prevLatest = cached.latestEpisode || 0;
                if (info.latestEpisode > prevLatest && prevLatest > 0) {
                    const highestWatched = Math.max(0, ...(anime.episodes || []).map(ep => Number(ep.number) || 0));
                    if (info.latestEpisode > highestWatched) {
                        chrome.notifications.create(`new-ep-${slug}`, {
                            type: 'basic',
                            iconUrl: 'src/icons/icon128.png',
                            title: `New Episode Available!`,
                            message: `${anime.title} — Episode ${info.latestEpisode} is now available`,
                            priority: 1
                        });
                    }
                }

                // Update cache whenever we have fresh info — even when prevLatest is 0
                // (e.g. anime cached before first episode aired). Without this, the
                // notification gate stays stuck because prevLatest never advances.
                if (info.latestEpisode !== prevLatest || cached.status !== info.status) {
                    await bgStorageSet({ [cachedKey]: { ...cached, ...info, cachedAt: now } });
                }

                // Persist per-slug progress after every tick so an SW kill
                // mid-loop doesn't reset the rotation. Trade: extra writes
                // (small, single-field) for resilience.
                updatedLastCheck[slug] = now;
                try { await bgStorageSet({ smartNotifLastCheck: updatedLastCheck }); } catch { /* best-effort */ }
            } catch {
            }

            await new Promise(r => setTimeout(r, 1500));
        }

        await bgStorageSet({ smartNotifLastCheck: updatedLastCheck });
    } catch (e) {
        console.warn('[BG] Smart notification check failed:', e);
    }
}

chrome.notifications.onClicked.addListener((notifId) => {
    if (notifId.startsWith('new-ep-')) {
        const slug = notifId.replace('new-ep-', '');
        // Encode slug to avoid breaking the URL if it ever contains odd characters
        // (slugs are normally URL-safe, but this is defense-in-depth).
        const encoded = encodeURIComponent(slug);
        chrome.tabs.create({ url: `https://an1me.to/anime/${encoded}/` });
        chrome.notifications.clear(notifId);
        return;
    }
    if (notifId.startsWith('badge-') || notifId === 'badges-batch') {
        // openPopup() requires a user gesture in some browsers and a
        // specific window context; if it's unavailable we fall back to
        // opening the popup HTML in a regular tab so the user always
        // lands somewhere when they click the notification.
        const openPopupFallback = () => {
            try {
                chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
            } catch { /* swallow — last-resort no-op */ }
        };
        try {
            const result = chrome.action?.openPopup?.();
            if (result && typeof result.then === 'function') {
                result.catch(openPopupFallback);
            } else if (result === undefined) {
                // Older Chrome returns undefined synchronously when the
                // popup can't be opened from a service worker.
                openPopupFallback();
            }
        } catch {
            openPopupFallback();
        }
        chrome.notifications.clear(notifId);
    }
});

function showBadgeNotification(badge) {
    try {
        chrome.notifications.create(`badge-${badge.id}`, {
            type: 'basic',
            iconUrl: 'src/icons/icon128.png',
            title: 'Badge unlocked!',
            message: `${badge.icon || '🏅'} ${badge.title} — ${badge.desc || ''}`.trim(),
            priority: 1
        });
    } catch (e) {
        console.warn('[BG] Badge notification failed:', e);
    }
}

function showBatchBadgeNotification(count) {
    try {
        chrome.notifications.create('badges-batch', {
            type: 'basic',
            iconUrl: 'src/icons/icon128.png',
            title: 'Achievements unlocked!',
            message: `You unlocked ${count} new badges. Tap to view.`,
            priority: 1
        });
    } catch (e) {
        console.warn('[BG] Batch badge notification failed:', e);
    }
}
