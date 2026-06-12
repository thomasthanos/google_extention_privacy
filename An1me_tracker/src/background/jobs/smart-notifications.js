


const SMART_NOTIF_ALARM = 'smartNotifCheck';
const SMART_NOTIF_INTERVAL_MINUTES = 60;


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


        const eligible = Object.entries(animeData)
            .filter(([, anime]) => !anime.droppedAt && !anime.completedAt && !anime.onHoldAt)
            .sort(([a], [b]) => (lastCheck[a] || 0) - (lastCheck[b] || 0));

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
                if (info?.latestEpisode) {
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


                    if (info.latestEpisode !== prevLatest || cached.status !== info.status) {
                        await bgStorageSet({ [cachedKey]: { ...cached, ...info, cachedAt: now } });
                    }
                }
            } catch {


            }


            updatedLastCheck[slug] = now;

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


        const encoded = encodeURIComponent(slug);
        chrome.tabs.create({ url: `https://an1me.to/anime/${encoded}/` });
        chrome.notifications.clear(notifId);
        return;
    }
    if (notifId.startsWith('badge-') || notifId === 'badges-batch') {


        const openPopupFallback = () => {
            try {
                chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
            } catch {                                   }
        };
        try {
            const result = chrome.action?.openPopup?.();
            if (result && typeof result.then === 'function') {
                result.catch(openPopupFallback);
            } else if (result === undefined) {


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
            message: `${badge.title}${badge.desc ? ` — ${badge.desc}` : ''}`.trim(),
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
