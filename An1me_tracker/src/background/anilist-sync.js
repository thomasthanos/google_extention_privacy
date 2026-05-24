/**
 * Anime Tracker — AniList background sync (service worker)
 *
 * Pushes watch progress to AniList WITHOUT the popup being open. Batched via
 * AniListCore.runPush so a large first sync finishes across several short
 * runs instead of hitting the MV3 service-worker lifetime cap.
 *
 * Triggers:
 *   • episodes tracked / imported (storage `animeData` change) — debounced
 *     via chrome.alarms so it survives SW termination
 *   • manual "Sync now" from the popup (ANILIST_SYNC_NOW) — runs immediately
 *
 * Loaded by background.js via importScripts (after anilist-core.js).
 */
(function () {
    'use strict';

    const Core = self.AniListCore;
    if (!Core) {
        console.error('[BG-AniList] AniListCore not loaded — background sync disabled');
        return;
    }

    const PUSH_ALARM = 'anilistPush';
    const STATUS_KEY = 'anilist_sync_status';
    const MAX_WORK_PER_RUN = 35;            // ~35 × 1.8s ≈ 65s — safely under the SW lifetime
    const PROGRESS_WRITE_GAP_MS = 1500;     // throttle status writes during a run

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

    // Chrome clamps alarm delays under 1 minute to 1 minute in released
    // (non-unpacked) extensions — so alarms are only used for the debounced
    // background path, never for the user-facing "Sync now" (which runs
    // runBackgroundPush directly for an immediate response).
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
        // A push is already in flight — remember that another was requested so
        // we run one more pass afterwards (catches changes made mid-run).
        if (_running) { _pendingRerun = true; return; }

        const token = await getToken();
        if (!token) return;

        _running = true;
        let lastWrite = 0;
        try {
            await writeStatus({ state: 'running', done: 0, total: 0, reason });

            const result = await Core.runPush({
                token,
                maxWork: MAX_WORK_PER_RUN,
                onProgress: (p) => {
                    const now = Date.now();
                    if (now - lastWrite < PROGRESS_WRITE_GAP_MS) return;
                    lastWrite = now;
                    writeStatus({
                        state: 'running',
                        done: p.done, total: p.total,
                        ok: p.ok, skipped: p.skipped, failed: p.failed
                    });
                }
            });

            if (result.truncated) {
                // More entries still need pushing — continue next alarm window.
                await writeStatus({
                    state: 'running',
                    done: result.done, total: result.total,
                    ok: result.ok, skipped: result.skipped, failed: result.failed
                });
                armPushAlarm(1);
            } else if (result.retryableFailed > 0) {
                // All entries processed but some failed with transient errors
                // (network / rate-limit). Use 'retrying' state so the UI
                // doesn't show "Syncing 100/100" forever, and back off 5 min.
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
                armPushAlarm(5); // transient — retry in a few minutes
            }
        } finally {
            _running = false;
            if (_pendingRerun) {
                _pendingRerun = false;
                armPushAlarm(1);
            }
        }
    }

    // Alarm fire → run a (batched) background push.
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name !== PUSH_ALARM) return;
        runBackgroundPush('alarm').catch((e) =>
            console.warn('[BG-AniList] Background push failed:', e?.message || e)
        );
    });

    // Episodes were tracked (or imported) → schedule a push. The alarm
    // debounces rapid changes and survives SW kills.
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;
        if (!changes.animeData) return;
        getToken().then((token) => { if (token) armPushAlarm(1); });
    });

    // Manual "Sync now" from the popup — run immediately (no alarm delay).
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message && message.type === 'ANILIST_SYNC_NOW') {
            runBackgroundPush('manual').catch((e) =>
                console.warn('[BG-AniList] Manual push failed:', e?.message || e)
            );
            sendResponse({ received: true });
            return true;
        }
        return false;
    });

    // Resume an interrupted sync after an SW restart: if the last status says
    // a run was still going, kick it off again (runPush dedup makes it cheap).
    sget([STATUS_KEY]).then((s) => {
        const st = s[STATUS_KEY];
        if (st && st.state === 'running') armPushAlarm(1);
    });
})();
