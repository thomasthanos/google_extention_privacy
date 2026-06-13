


const SMART_NOTIF_ALARM = 'smartNotifCheck';
const SMART_NOTIF_INTERVAL_MINUTES = 60;

// How many anime we are willing to actually *fetch* in a single tick. Anime
// whose next episode is still far away are skipped before this budget is even
// touched, so in practice we rarely spend it.
const SMART_NOTIF_MAX_PER_TICK = 10;

const SN_MINUTE = 60 * 1000;
const SN_HOUR = 60 * SN_MINUTE;
const SN_DAY = 24 * SN_HOUR;

// Adaptive scheduling windows (all in ms).
const SMART_NOTIF_TUNING = {
    // Once an episode is "due" (nextEpisodeAt has passed) we re-check this
    // often until the new episode actually appears on the site.
    dueRecheck: 20 * SN_MINUTE,
    // Start polling eagerly a little BEFORE the scheduled drop, to catch early
    // uploads.
    preDropLead: 15 * SN_MINUTE,
    // No known schedule → fall back to a gentle fixed cadence.
    unknownSchedule: 6 * SN_HOUR,
    // Releasing anime we somehow have no schedule for, but that looked active
    // recently, get a slightly tighter cadence.
    activeUnknown: 3 * SN_HOUR,
    // Hard floor so a misbehaving entry can never hammer the site.
    minGap: 15 * SN_MINUTE,
    // If a "due" episode never materialises, stop hammering after this long and
    // fall back to the unknown-schedule cadence.
    dueGiveUp: 3 * SN_DAY
};

function smartNotifNow() { return Date.now(); }

function snToMs(value) {
    if (!value) return 0;
    const t = typeof value === 'number' ? value : new Date(value).getTime();
    return Number.isFinite(t) ? t : 0;
}

function highestWatchedEpisode(anime) {
    return Math.max(0, ...((anime?.episodes || []).map(ep => Number(ep.number) || 0)));
}

// Decide WHEN this anime should next be fetched, given its cached info and the
// per-anime smart state. Returns a timestamp (ms). `now` is passed so a whole
// tick shares one clock.
function computeNextCheckAt(cached, state, now) {
    const nextDropAt = snToMs(cached?.nextEpisodeAt);
    const lastCheckedAt = snToMs(state?.lastCheckedAt);
    const minNext = lastCheckedAt + SMART_NOTIF_TUNING.minGap;

    // We have a concrete schedule from the site.
    if (nextDropAt > 0) {
        if (nextDropAt > now) {
            // Future drop: wake up shortly before it, but no sooner than minGap.
            return Math.max(nextDropAt - SMART_NOTIF_TUNING.preDropLead, minNext);
        }
        // Drop time has passed but we haven't seen the episode yet.
        const overdueFor = now - nextDropAt;
        if (overdueFor <= SMART_NOTIF_TUNING.dueGiveUp) {
            // Poll tightly until it shows up.
            return Math.max(lastCheckedAt + SMART_NOTIF_TUNING.dueRecheck, now);
        }
        // Given up waiting — treat schedule as stale, fall through to cadence.
    }

    // No usable schedule. Use a cadence based on how recently the anime looked
    // active (a freshly-updated cache implies an active show).
    const cachedAt = snToMs(cached?.cachedAt);
    const looksActive = cachedAt > 0 && (now - cachedAt) < 14 * SN_DAY;
    const cadence = looksActive
        ? SMART_NOTIF_TUNING.activeUnknown
        : SMART_NOTIF_TUNING.unknownSchedule;
    return Math.max(lastCheckedAt + cadence, now);
}

// How urgent is checking this anime right now? Lower = sooner. Used to order
// the fetch budget so the most time-sensitive anime are always covered first.
function urgencyKey(cached, state, now) {
    const nextDropAt = snToMs(cached?.nextEpisodeAt);
    if (nextDropAt > 0 && nextDropAt <= now) {
        // Overdue episodes are the most urgent; the longer overdue, the more so.
        return -(now - nextDropAt) - 1e12;
    }
    if (nextDropAt > now) {
        // Upcoming drops ordered by how soon they are.
        return nextDropAt;
    }
    // Unknown schedule → order by how long since we last looked.
    return Number.MAX_SAFE_INTEGER - (now - snToMs(state?.lastCheckedAt));
}

async function checkNewEpisodes() {
    try {
        const settings = await bgStorageGet([
            'smartNotificationsEnabled', 'animeData', 'smartNotifState', 'smartNotifLastCheck'
        ]);
        if (settings.smartNotificationsEnabled !== true) return;

        const animeData = settings.animeData || {};
        // Per-anime state: { lastCheckedAt, notifiedEpisode, nextCheckAt }.
        const state = { ...(settings.smartNotifState || {}) };
        const now = smartNotifNow();

        // One-time migration from the legacy `smartNotifLastCheck` map (a flat
        // slug→timestamp object) into the richer per-anime state.
        const legacyLastCheck = settings.smartNotifLastCheck;
        let migrated = false;
        if (legacyLastCheck && typeof legacyLastCheck === 'object') {
            for (const [slug, ts] of Object.entries(legacyLastCheck)) {
                if (!state[slug] && Number.isFinite(Number(ts))) {
                    state[slug] = { lastCheckedAt: Number(ts), notifiedEpisode: 0 };
                    migrated = true;
                }
            }
        }

        // Eligible = actively-followed, currently-releasing anime.
        const eligible = [];
        for (const [slug, anime] of Object.entries(animeData)) {
            if (anime.droppedAt || anime.completedAt || anime.onHoldAt) continue;
            const cachedKey = `animeinfo_${slug}`;
            const cached = (await bgStorageGet([cachedKey]))[cachedKey];
            if (!cached || cached.status !== 'RELEASING') continue;
            eligible.push({ slug, anime, cached, cachedKey });
        }

        // Drop anything not yet due for a check, then order the rest by urgency.
        const due = eligible.filter(({ slug, cached }) => {
            const st = state[slug] || {};
            const nextCheckAt = computeNextCheckAt(cached, st, now);
            return now >= nextCheckAt;
        });

        due.sort((a, b) =>
            urgencyKey(a.cached, state[a.slug] || {}, now)
            - urgencyKey(b.cached, state[b.slug] || {}, now)
        );

        const newEpisodes = []; // { slug, anime, episode, behind }
        let checked = 0;

        for (const { slug, anime, cached, cachedKey } of due) {
            if (checked >= SMART_NOTIF_MAX_PER_TICK) break;
            checked++;

            const st = state[slug] || {};
            try {
                const info = await fetchAnimePageInfo(slug);
                if (info?.latestEpisode) {
                    const prevLatest = Number(cached.latestEpisode) || 0;
                    const latest = Number(info.latestEpisode) || 0;
                    const highestWatched = highestWatchedEpisode(anime);
                    const alreadyNotified = Number(st.notifiedEpisode) || 0;

                    // Announce only genuinely-new, unwatched, not-yet-notified
                    // episodes. `prevLatest > 0` guards against the very first
                    // cache fill announcing a back-catalogue episode.
                    const isNew = latest > prevLatest && prevLatest > 0
                        && latest > highestWatched
                        && latest > alreadyNotified;

                    if (isNew) {
                        newEpisodes.push({
                            slug, anime, episode: latest,
                            behind: Math.max(1, latest - highestWatched)
                        });
                        st.notifiedEpisode = latest;
                    }

                    if (latest !== prevLatest || cached.status !== info.status) {
                        await bgStorageSet({ [cachedKey]: { ...cached, ...info, cachedAt: now } });
                        cached.nextEpisodeAt = info.nextEpisodeAt;
                        cached.cachedAt = now;
                    }
                }
            } catch {
                // Network/parse failure — leave state alone so we retry on the
                // normal schedule rather than treating it as "checked clean".
            }

            st.lastCheckedAt = now;
            st.nextCheckAt = computeNextCheckAt(cached, st, now);
            state[slug] = st;

            // Polite spacing between fetches within a tick.
            await new Promise(r => setTimeout(r, 1500));
        }

        // Prune state for anime that are no longer eligible so it can't grow
        // unbounded as the library changes.
        const eligibleSlugs = new Set(eligible.map(e => e.slug));
        for (const slug of Object.keys(state)) {
            if (!eligibleSlugs.has(slug)) delete state[slug];
        }

        // Fire notifications: batch when several dropped at once, otherwise a
        // single rich message.
        if (newEpisodes.length === 1) {
            showNewEpisodeNotification(newEpisodes[0]);
        } else if (newEpisodes.length > 1) {
            showBatchNewEpisodeNotification(newEpisodes);
        }

        await bgStorageSet({ smartNotifState: state });
        // One-time cleanup of the legacy key after a successful migration.
        if (migrated) {
            try { await bgStorageSet({ smartNotifLastCheck: null }); } catch {}
        }
    } catch (e) {
        console.warn('[BG] Smart notification check failed:', e);
    }
}

function showNewEpisodeNotification({ slug, anime, episode, behind }) {
    try {
        const title = anime?.title || 'Your anime';
        const behindText = behind > 1 ? ` · you're ${behind} episodes behind` : '';
        chrome.notifications.create(`new-ep-${slug}`, {
            type: 'basic',
            iconUrl: 'src/icons/icon128.png',
            title: 'New Episode Available!',
            message: `${title} — Episode ${episode} is out${behindText}`,
            priority: 2,
            // Stay on screen until the user acts — so a missed sound or being
            // away from the desk doesn't make them lose the alert.
            requireInteraction: true,
            buttons: [{ title: 'Watch now' }]
        });
    } catch (e) {
        console.warn('[BG] New episode notification failed:', e);
    }
}

function showBatchNewEpisodeNotification(items) {
    try {
        const count = items.length;
        const names = items.slice(0, 3).map(i => i.anime?.title || 'Unknown');
        const more = count - names.length;
        const list = names.join(', ') + (more > 0 ? ` +${more} more` : '');
        chrome.notifications.create('new-eps-batch', {
            type: 'basic',
            iconUrl: 'src/icons/icon128.png',
            title: `${count} new episodes available!`,
            message: `${list}. Tap to open your library.`,
            priority: 2,
            requireInteraction: true,
            buttons: [{ title: 'Open library' }]
        });
    } catch (e) {
        console.warn('[BG] Batch new episode notification failed:', e);
    }
}

// Shared helper: open the extension popup (with a tab fallback for contexts
// where openPopup isn't available, e.g. no focused window).
function openLibraryFromNotification() {
    const openPopupFallback = () => {
        try { chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') }); } catch {}
    };
    try {
        const result = chrome.action?.openPopup?.();
        if (result && typeof result.then === 'function') result.catch(openPopupFallback);
        else if (result === undefined) openPopupFallback();
    } catch {
        openPopupFallback();
    }
}

function openAnimeFromNotification(notifId) {
    const slug = notifId.replace('new-ep-', '');
    const encoded = encodeURIComponent(slug);
    chrome.tabs.create({ url: `https://an1me.to/anime/${encoded}/` });
}

chrome.notifications.onClicked.addListener((notifId) => {
    if (notifId === 'new-eps-batch') {
        openLibraryFromNotification();
        chrome.notifications.clear(notifId);
        return;
    }
    if (notifId.startsWith('new-ep-')) {
        openAnimeFromNotification(notifId);
        chrome.notifications.clear(notifId);
        return;
    }
    if (notifId.startsWith('badge-') || notifId === 'badges-batch') {
        openLibraryFromNotification();
        chrome.notifications.clear(notifId);
    }
});

// Button clicks mirror the body-click behaviour for each notification type.
chrome.notifications.onButtonClicked.addListener((notifId) => {
    if (notifId === 'new-eps-batch') {
        openLibraryFromNotification();
    } else if (notifId.startsWith('new-ep-')) {
        openAnimeFromNotification(notifId);
    } else if (notifId.startsWith('badge-') || notifId === 'badges-batch') {
        openLibraryFromNotification();
    }
    chrome.notifications.clear(notifId);
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
