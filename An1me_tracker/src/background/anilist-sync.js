/**
 * Anime Tracker — AniList background sync (service worker)
 *
 * Pushes watch progress to AniList without the popup being open. Batched via
 * AniListCore.runPush so a large first sync finishes across several short
 * runs rather than hitting the MV3 service-worker lifetime cap.
 *
 * Triggers:
 *   • animeData storage change (debounced via chrome.alarms — survives SW kills)
 *   • manual "Sync now" from the popup (ANILIST_SYNC_NOW — runs immediately)
 *   • periodic safety-net alarm (every 30 min — catches missed storage events)
 *
 * Loaded by background.js via importScripts after anilist-core.js.
 */
(function () {
    'use strict';

    const Core = self.AniListCore;
    if (!Core) {
        console.error('[BG-AniList] AniListCore not loaded — background sync disabled');
        return;
    }

    const PUSH_ALARM = 'anilistPush';
    const PUSH_ALARM_PERIODIC = 'anilistPushPeriodic';
    const STATUS_KEY = 'anilist_sync_status';
    const MAX_WORK_PER_RUN = 25;
    const PROGRESS_WRITE_GAP_MS = 800;

    function sget(keys) {
        return new Promise((res) => {
            try { chrome.storage.local.get(keys, (r) => res(chrome.runtime.lastError ? {} : (r || {}))); }
            catch { res({}); }
        });
    }
    function sset(obj) {
        return new Promise((res) => {
            try { chrome.storage.local.set(obj, () => { void chrome.runtime.lastError; res(); }); }
            catch { res(); }
        });
    }

    function writeStatus(obj) {
        return sset({ [STATUS_KEY]: { ...obj, updatedAt: Date.now() } });
    }

    // Chrome clamps alarm delays under 1 min in production extensions, so
    // alarms are only used for the debounced background path — never for
    // user-facing "Sync now" (which runs runBackgroundPush directly).
    function armPushAlarm(delayMinutes) {
        try {
            chrome.alarms.create(PUSH_ALARM, { delayInMinutes: Math.max(1, delayMinutes || 1) });
        } catch (e) {
            console.warn('[BG-AniList] Could not arm push alarm:', e?.message || e);
        }
    }

    async function getToken() {
        const stored = await sget([Core.AUTH_KEY]);
        const auth = stored[Core.AUTH_KEY];
        if (!auth || !auth.accessToken) return null;
        if (auth.expiresAt && auth.expiresAt <= Date.now()) return null;
        return auth.accessToken;
    }

    let _running = false;
    let _pendingRerun = false;

    async function runBackgroundPush(reason) {
        if (_running) {
            _pendingRerun = true;
            return;
        }

        const token = await getToken();
        if (!token) return;

        _running = true;
        let lastWrite = 0;
        let lastProgress = null;
        let lastAdvancedAt = Date.now();
        let lastDone = -1;
        let lastSlug = '';
        let heartbeatTimer = null;
        try {
            // Don't blank-out the status with done=0 at run start — that
            // shows "0/N" on every alarm wake even when most are cached.
            // The first onProgress overwrites this; just refresh updatedAt
            // so the popup's stale-detector knows we're alive.
            const existing = await sget([STATUS_KEY]);
            const last = existing[STATUS_KEY];
            if (last && last.state === 'running') {
                await writeStatus({ ...last, reason });
            } else {
                await writeStatus({ state: 'running', done: last?.done || 0, total: last?.total || 0, reason });
            }

            // Heartbeat: refresh updatedAt every 10 s so the popup's stale
            // detector (3 min) doesn't trip during a long resolveMedia call.
            heartbeatTimer = setInterval(() => {
                if (!lastProgress) return;
                writeStatus({ state: 'running', ...lastProgress });
            }, 10000);

            const result = await Core.runPush({
                token,
                maxWork: MAX_WORK_PER_RUN,
                onProgress: (p) => {
                    const now = Date.now();
                    const currentSlug = p.currentSlug || '';
                    const advanced = (typeof p.done === 'number' && p.done !== lastDone)
                        || (currentSlug && currentSlug !== lastSlug);
                    if (advanced) {
                        lastAdvancedAt = now;
                        lastDone = typeof p.done === 'number' ? p.done : lastDone;
                        lastSlug = currentSlug || lastSlug;
                    }

                    lastProgress = {
                        done: p.done, total: p.total,
                        ok: p.ok, skipped: p.skipped, failed: p.failed,
                        currentTitle: p.currentTitle || null,
                        currentSlug: currentSlug || null,
                        phase: p.phase || null,
                        advancedAt: lastAdvancedAt
                    };
                    // Bypass throttle when a new slug starts so the user sees
                    // forward motion even through long fetches.
                    const isNewSlug = !!p.currentSlug;
                    if (!isNewSlug && now - lastWrite < PROGRESS_WRITE_GAP_MS) return;
                    lastWrite = now;
                    writeStatus({ state: 'running', ...lastProgress });
                }
            });

            if (result.truncated) {
                await writeStatus({
                    state: 'running',
                    done: result.done, total: result.total,
                    ok: result.ok, skipped: result.skipped, failed: result.failed,
                    advancedAt: Date.now()
                });
                armPushAlarm(1);
            } else if (result.retryableFailed > 0) {
                await writeStatus({
                    state: 'retrying',
                    done: result.done, total: result.total,
                    ok: result.ok, skipped: result.skipped,
                    failed: result.failed, retryableFailed: result.retryableFailed,
                    retryAt: Date.now() + 5 * 60 * 1000
                });
                armPushAlarm(5);
            } else {
                await writeStatus({
                    state: 'idle',
                    done: result.done, total: result.total,
                    ok: result.ok, skipped: result.skipped, failed: result.failed,
                    finishedAt: Date.now()
                });
            }
        } catch (e) {
            const msg = String(e?.message || '');
            if (msg === 'reconnect') {
                // Token rejected — clear auth so the popup prompts to reconnect.
                try { await chrome.storage.local.remove([Core.AUTH_KEY]); } catch { /* ignore */ }
                await writeStatus({ state: 'error', error: 'reconnect', finishedAt: Date.now() });
            } else {
                await writeStatus({ state: 'error', error: msg, finishedAt: Date.now() });
                armPushAlarm(5);
            }
        } finally {
            if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
            _running = false;
            if (_pendingRerun) {
                _pendingRerun = false;
                armPushAlarm(1);
            }
        }
    }

    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name !== PUSH_ALARM && alarm.name !== PUSH_ALARM_PERIODIC) return;
        runBackgroundPush(alarm.name === PUSH_ALARM_PERIODIC ? 'periodic' : 'alarm').catch(() => { /* errors written to status */ });
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;

        // Auth toggled — keep the periodic alarm in sync with connected state.
        if (changes[Core.AUTH_KEY]) {
            const newAuth = changes[Core.AUTH_KEY].newValue;
            const connected = !!(newAuth && newAuth.accessToken && (!newAuth.expiresAt || newAuth.expiresAt > Date.now()));
            if (connected) {
                try { chrome.alarms.create(PUSH_ALARM_PERIODIC, { delayInMinutes: 5, periodInMinutes: 30 }); }
                catch { /* ignore */ }
            } else {
                try { chrome.alarms.clear(PUSH_ALARM_PERIODIC); } catch { /* ignore */ }
            }
        }

        if (!changes.animeData) return;
        getToken().then((token) => { if (token) armPushAlarm(1); });
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message && message.type === 'ANILIST_SYNC_NOW') {
            runBackgroundPush('manual').catch(() => { /* errors written to status */ });
            sendResponse({ received: true });
            return true;
        }
        return false;
    });

    // SW startup: resume interrupted sync, (re)arm the periodic safety-net.
    sget([STATUS_KEY, Core.AUTH_KEY]).then((s) => {
        const st = s[STATUS_KEY];
        const auth = s[Core.AUTH_KEY];
        const connected = !!(auth && auth.accessToken && (!auth.expiresAt || auth.expiresAt > Date.now()));

        if (connected) {
            try { chrome.alarms.create(PUSH_ALARM_PERIODIC, { delayInMinutes: 5, periodInMinutes: 30 }); }
            catch { /* ignore */ }
        } else {
            try { chrome.alarms.clear(PUSH_ALARM_PERIODIC); } catch { /* ignore */ }
        }

        if (st && st.state === 'running') {
            armPushAlarm(1);
        } else if (connected && st && st.state === 'retrying' && st.retryAt && st.retryAt > Date.now()) {
            const mins = Math.max(1, Math.round((st.retryAt - Date.now()) / 60000));
            armPushAlarm(mins);
        }
    });
})();
