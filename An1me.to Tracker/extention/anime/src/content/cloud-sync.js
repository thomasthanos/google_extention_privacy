/**
 * Anime Tracker - Content Script Cloud Sync
 *
 * Responsibilities (Chrome with background SW):
 *   1. Keep the background SW alive via a persistent keepAlive port.
 *   2. Whenever videoProgress is saved locally, wake up the SW so it can
 *      push it to Firestore immediately (instead of waiting for an alarm).
 *   3. If the SW does NOT respond (e.g. crashed/disabled), fall back to
 *      pushing directly from the content script using a field-mask PATCH.
 *
 * Responsibilities (Orion / Safari — no SW):
 *   1. Open a Firestore SSE "Listen" stream for real-time pull.
 *   2. Push all local changes directly to Firestore.
 *   3. Reconnect automatically with exponential back-off.
 */
(function () {
    'use strict';

    const FIREBASE_API_KEY    = 'AIzaSyCDF9US2OwARlyZ0AH_zDpjzmOXRtrGKMg';
    const FIREBASE_PROJECT_ID = 'anime-tracker-64d86';
    const FIRESTORE_BASE      = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)`;
    const LISTEN_URL          = `${FIRESTORE_BASE}/documents:listen`;

    let initialized      = false;
    let listenAbortCtrl  = null;
    let reconnectTimeout = null;
    let currentToken     = null;
    let currentUser      = null;
    let reconnectDelay   = 5000;
    const MAX_RECONNECT  = 60000;

    // ─── Firestore codec ──────────────────────────────────────────────────────

    function toFSValue(v) {
        if (v === null || v === undefined) return { nullValue: null };
        if (typeof v === 'boolean') return { booleanValue: v };
        if (typeof v === 'string')  return { stringValue: v };
        if (typeof v === 'number')  return Number.isInteger(v)
            ? { integerValue: String(v) }
            : { doubleValue: v };
        if (Array.isArray(v)) return { arrayValue: { values: v.map(toFSValue) } };
        if (typeof v === 'object') {
            const fields = {};
            for (const [k, val] of Object.entries(v)) fields[k] = toFSValue(val);
            return { mapValue: { fields } };
        }
        return { nullValue: null };
    }

    function toFSFields(obj) {
        const f = {};
        for (const [k, v] of Object.entries(obj)) f[k] = toFSValue(v);
        return f;
    }

    function fromFSValue(v) {
        if (!v) return null;
        if ('nullValue'    in v) return null;
        if ('booleanValue' in v) return v.booleanValue;
        if ('stringValue'  in v) return v.stringValue;
        if ('integerValue' in v) return parseInt(v.integerValue, 10);
        if ('doubleValue'  in v) return v.doubleValue;
        if ('arrayValue'   in v) return (v.arrayValue.values || []).map(fromFSValue);
        if ('mapValue'     in v) {
            const obj = {};
            for (const [k, val] of Object.entries(v.mapValue.fields || {})) obj[k] = fromFSValue(val);
            return obj;
        }
        return null;
    }

    function fromFSDoc(doc) {
        if (!doc?.fields) return null;
        const out = {};
        for (const [k, v] of Object.entries(doc.fields)) out[k] = fromFSValue(v);
        return out;
    }

    // ─── Token ────────────────────────────────────────────────────────────────

    async function refreshToken(rt) {
        try {
            const res = await fetch(
                `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: rt })
                }
            );
            if (!res.ok) return null;
            const data = await res.json();
            if (data.error) return null;
            const tokens = {
                idToken:      data.id_token,
                refreshToken: data.refresh_token,
                expiresAt:    Date.now() + parseInt(data.expires_in) * 1000
            };
            await chrome.storage.local.set({ firebase_tokens: tokens });
            return tokens.idToken;
        } catch (_) { return null; }
    }

    async function getValidToken() {
        try {
            const s = await chrome.storage.local.get(['firebase_tokens']);
            const t = s.firebase_tokens;
            if (!t?.idToken) return null;
            if (t.expiresAt < Date.now() + 120000) return await refreshToken(t.refreshToken);
            return t.idToken;
        } catch (_) { return null; }
    }

    async function getUser() {
        try {
            const s = await chrome.storage.local.get(['firebase_user']);
            return s.firebase_user || null;
        } catch (_) { return null; }
    }

    // ─── Merge helpers (delegated to src/content/merge-utils.js) ─────────────
    // merge-utils.js loads before this file (see manifest.json) and registers
    // all four helpers on window.AnimeTrackerContent.MergeUtils.

    const {
        mergeAnimeData,
        mergeVideoProgress,
        mergeDeletedAnime,
        applyDeletedAnime
    } = window.AnimeTrackerContent.MergeUtils;

    // ─── Direct push to Firestore (fallback when SW unavailable) ─────────────

    // Merged push: fetch cloud videoProgress, merge (higher currentTime + soft-delete
    // awareness), then write the result back. Prevents wiping progress written by
    // another device.
    let lastPushedProgress    = null;
    let isPushingProgressDirect = false; // guard against concurrent calls (#5)

    async function pushProgressDirect() {
        if (isPushingProgressDirect) return; // already in-flight
        const token = await getValidToken();
        const user  = currentUser || await getUser();
        if (!token || !user) return;
        isPushingProgressDirect = true;

        try {
            const local   = await chrome.storage.local.get(['videoProgress']);
            const localVP = local.videoProgress || {};
            const snapshot = JSON.stringify(localVP);
            if (snapshot === lastPushedProgress) return; // nothing changed

            // Fetch cloud so we can merge — prevents overwriting another device's progress
            const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
            let cloudVP = {};
            try {
                const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                if (r.ok) cloudVP = fromFSDoc(await r.json())?.videoProgress || {};
            } catch (_) {}

            const mergedVP = mergeVideoProgress(localVP, cloudVP);

            // Write back locally if cloud had additional entries from another device
            const localCount  = Object.keys(localVP).length;
            const mergedCount = Object.keys(mergedVP).length;
            if (mergedCount > localCount) {
                await chrome.storage.local.set({ videoProgress: mergedVP });
                console.log(`[CS-Sync] ✓ Pulled ${mergedCount - localCount} new progress entries from cloud`);
            }

            const updateMask = 'updateMask.fieldPaths=videoProgress&updateMask.fieldPaths=lastUpdated';
            const res = await fetch(`${url}?${updateMask}`, {
                method:  'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    fields: toFSFields({
                        videoProgress: mergedVP,
                        lastUpdated:   new Date().toISOString()
                    })
                })
            });

            if (res.ok) {
                lastPushedProgress = JSON.stringify(mergedVP);
                console.log('[CS-Sync] ✓ videoProgress pushed (merged)');
            } else {
                console.warn('[CS-Sync] Direct progress push failed:', res.status);
            }
        } catch (e) {
            console.warn('[CS-Sync] Direct progress push error:', e.message);
        } finally {
            isPushingProgressDirect = false;
        }
    }

    // Full push: animeData + videoProgress (Orion / no-SW mode only)
    let fullPushInProgress = false;
    let fullPushPending    = false;

    async function pushFullDirect() {
        if (fullPushInProgress) { fullPushPending = true; return; }
        const token = await getValidToken();
        const user  = currentUser || await getUser();
        if (!token || !user) return;

        fullPushInProgress = true;
        try {
            const local = await chrome.storage.local.get(['animeData', 'videoProgress', 'deletedAnime']);

            // Fetch cloud to safely merge animeData (keep episodes from both sides)
            const url       = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
            let cloudData   = null;
            try {
                const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                if (r.ok) cloudData = fromFSDoc(await r.json());
            } catch (_) {}

            // Merge deletedAnime first so we can apply it before uploading.
            const mergedDeleted = cloudData?.deletedAnime
                ? mergeDeletedAnime(local.deletedAnime || {}, cloudData.deletedAnime)
                : (local.deletedAnime || {});

            let mergedAnime = cloudData?.animeData
                ? mergeAnimeData(local.animeData || {}, cloudData.animeData)
                : { ...(local.animeData || {}) };

            // Apply cross-device deletions before uploading.
            applyDeletedAnime(mergedAnime, mergedDeleted);

            const mergedProgress = cloudData?.videoProgress
                ? mergeVideoProgress(local.videoProgress || {}, cloudData.videoProgress)
                : (local.videoProgress || {});

            // Write back locally if cloud had more / different data
            const localEps  = Object.values(local.animeData || {}).reduce((s, a) => s + (a.episodes?.length || 0), 0);
            const mergedEps = Object.values(mergedAnime).reduce((s, a) => s + (a.episodes?.length || 0), 0);
            const deletedDiff = Object.keys(mergedDeleted).length !== Object.keys(local.deletedAnime || {}).length;
            if (mergedEps > localEps || deletedDiff) {
                await chrome.storage.local.set({
                    animeData:    mergedAnime,
                    videoProgress: mergedProgress,
                    deletedAnime:  mergedDeleted
                });
            }

            const res = await fetch(url, {
                method:  'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    fields: toFSFields({
                        animeData:     mergedAnime,
                        videoProgress: mergedProgress,
                        deletedAnime:  mergedDeleted,
                        lastUpdated:   new Date().toISOString(),
                        email:         user.email
                    })
                })
            });

            if (res.ok) console.log('[CS-Sync] ✓ Full push to Firestore');
            else        console.warn('[CS-Sync] Full push failed:', res.status);
        } catch (e) {
            console.warn('[CS-Sync] Full push error:', e.message);
        } finally {
            fullPushInProgress = false;
            if (fullPushPending) { fullPushPending = false; setTimeout(pushFullDirect, 1000); }
        }
    }

    // ─── Send message to background SW ───────────────────────────────────────

    async function wakeBackgroundSW(messageType = 'SYNC_PROGRESS_ONLY') {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(false), 1500);
            chrome.runtime.sendMessage({ type: messageType }, (response) => {
                clearTimeout(timeout);
                if (chrome.runtime.lastError || !response) {
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
    }

    // ─── Debounced progress push (Chrome path) ────────────────────────────────
    // 1. Try to wake the background SW (it will do the actual push).
    // 2. If SW is unreachable, push directly from the content script.

    let progressDebounce = null;

    function scheduleProgressPush(delay = 3000) {
        if (progressDebounce) clearTimeout(progressDebounce);
        progressDebounce = setTimeout(async () => {
            progressDebounce = null;
            const swAlive = await wakeBackgroundSW('SYNC_PROGRESS_ONLY');
            if (!swAlive) {
                // SW is dead/sleeping and didn't wake — push directly
                console.log('[CS-Sync] SW unreachable, pushing progress directly');
                await pushProgressDirect();
            }
        }, delay);
    }

    // ─── Debounced full push (Orion path) ─────────────────────────────────────

    let fullPushDebounce = null;

    function scheduleFullPush(delay = 2500) {
        if (fullPushDebounce) clearTimeout(fullPushDebounce);
        fullPushDebounce = setTimeout(() => { fullPushDebounce = null; pushFullDirect(); }, delay);
    }

    // ─── Apply incoming cloud update locally ──────────────────────────────────

    async function applyCloudUpdate(cloudDoc) {
        if (!cloudDoc) return;
        try {
            const local = await chrome.storage.local.get(['animeData', 'videoProgress', 'deletedAnime']);

            // Merge deletedAnime so cross-device deletions propagate in Orion too.
            const mergedDeleted = cloudDoc.deletedAnime
                ? mergeDeletedAnime(local.deletedAnime || {}, cloudDoc.deletedAnime)
                : (local.deletedAnime || {});

            const mergedAnime = mergeAnimeData(local.animeData || {}, cloudDoc.animeData || {});

            // Apply cross-device deletions.
            applyDeletedAnime(mergedAnime, mergedDeleted);

            const mergedProgress = mergeVideoProgress(local.videoProgress || {}, cloudDoc.videoProgress || {});

            const localEps  = Object.values(local.animeData || {}).reduce((s, a) => s + (a.episodes?.length || 0), 0);
            const mergedEps = Object.values(mergedAnime).reduce((s, a) => s + (a.episodes?.length || 0), 0);

            let progressChanged = false;
            for (const [id, mp] of Object.entries(mergedProgress)) {
                const lp = (local.videoProgress || {})[id];
                if (!lp || lp.currentTime !== mp.currentTime) { progressChanged = true; break; }
            }

            const deletedChanged = Object.keys(mergedDeleted).length !== Object.keys(local.deletedAnime || {}).length;

            if (mergedEps !== localEps || progressChanged || deletedChanged) {
                await chrome.storage.local.set({
                    animeData:    mergedAnime,
                    videoProgress: mergedProgress,
                    deletedAnime:  mergedDeleted
                });
                console.log(`[CS-Sync] ← Cloud update applied (eps: ${localEps}→${mergedEps})`);
            }
        } catch (e) {
            console.warn('[CS-Sync] Apply cloud update failed:', e.message);
        }
    }

    // ─── Firestore SSE stream (Orion / no-SW mode) ────────────────────────────

    async function startListening() {
        if (listenAbortCtrl) listenAbortCtrl.abort();
        listenAbortCtrl = new AbortController();

        const token = await getValidToken();
        const user  = currentUser || await getUser();
        if (!token || !user) { scheduleReconnect(10000); return; }

        currentToken = token;
        currentUser  = user;

        const docPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${user.uid}`;

        try {
            const res = await fetch(`${LISTEN_URL}?key=${FIREBASE_API_KEY}`, {
                method:  'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body:    JSON.stringify({ addTarget: { documents: { documents: [docPath] }, targetId: 1 } }),
                signal:  listenAbortCtrl.signal
            });

            if (!res.ok) { scheduleReconnect(); return; }

            reconnectDelay = 5000;
            console.log('[CS-Sync] ✓ Firestore stream connected');

            // Proactively refresh the token every 45 minutes while the stream is
            // open. This prevents a mid-stream expiry causing a hard reconnect
            // (the REMOVE/code-16 path handles it reactively, but this avoids it).
            const tokenRefreshInterval = setInterval(async () => {
                const fresh = await getValidToken();
                if (fresh && fresh !== currentToken) {
                    console.log('[CS-Sync] Token refreshed proactively, restarting stream');
                    clearInterval(tokenRefreshInterval);
                    listenAbortCtrl?.abort();
                    currentToken = fresh;
                    startListening();
                }
            }, 45 * 60 * 1000);

            const reader  = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer    = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    const t = line.trim();
                    if (!t || t === '[' || t === ']' || t === ',') continue;
                    const jsonStr = t.startsWith(',') ? t.slice(1) : t;
                    if (!jsonStr) continue;
                    try {
                        const msg = JSON.parse(jsonStr);
                        if (msg.documentChange?.document?.fields) {
                            await applyCloudUpdate(fromFSDoc(msg.documentChange.document));
                        }
                        if (msg.targetChange?.targetChangeType === 'CURRENT') {
                            // Stream is up-to-date, nothing to do
                        }
                        if (msg.targetChange?.targetChangeType === 'REMOVE' &&
                            msg.targetChange?.cause?.code === 16) {
                            listenAbortCtrl.abort();
                            currentToken = await getValidToken();
                            if (currentToken) startListening();
                            return;
                        }
                    } catch (_) {}
                }
            }
        } catch (e) {
            if (e.name === 'AbortError') return;
            console.warn('[CS-Sync] Stream error:', e.message);
        } finally {
            // Always clear the token-refresh timer when the stream exits
            if (typeof tokenRefreshInterval !== 'undefined') clearInterval(tokenRefreshInterval);
        }
        scheduleReconnect();
    }

    function scheduleReconnect(delay) {
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        const d = delay ?? reconnectDelay;
        reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT);
        reconnectTimeout = setTimeout(startListening, d);
    }

    // ─── Storage watcher ──────────────────────────────────────────────────────
    // Called in both Chrome and Orion modes.
    // Chrome: wakes the SW (fast) or falls back to direct push.
    // Orion:  schedules a direct push.

    function watchStorage(isOrionMode) {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local') return;

            if (changes.videoProgress) {
                if (isOrionMode) {
                    scheduleFullPush(3000);
                } else {
                    scheduleProgressPush(3000);
                }
            }

            if (changes.animeData) {
                const oldCount = Object.values(changes.animeData.oldValue || {})
                    .reduce((s, a) => s + (a.episodes?.length || 0), 0);
                const newCount = Object.values(changes.animeData.newValue || {})
                    .reduce((s, a) => s + (a.episodes?.length || 0), 0);
                if (newCount > oldCount) {
                    if (isOrionMode) {
                        scheduleFullPush(1500);
                    } else {
                        // Wake SW for a full sync when a new episode is tracked
                        setTimeout(async () => {
                            const swAlive = await wakeBackgroundSW('SYNC_TO_FIREBASE');
                            if (!swAlive) pushFullDirect();
                        }, 500);
                    }
                }
            }
        });

        // Push on tab hide or close
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) return;
            if (isOrionMode) {
                if (fullPushDebounce) clearTimeout(fullPushDebounce);
                pushFullDirect();
            } else {
                if (progressDebounce) clearTimeout(progressDebounce);
                // Try SW first, then direct
                wakeBackgroundSW('SYNC_PROGRESS_ONLY').then(alive => {
                    if (!alive) pushProgressDirect();
                });
            }
        });

        window.addEventListener('pagehide', () => {
            if (isOrionMode) pushFullDirect();
            else             pushProgressDirect();
        }, { passive: true });
    }

    // ─── Init ─────────────────────────────────────────────────────────────────

    async function init() {
        if (initialized) return;

        currentUser = await getUser();
        if (!currentUser) {
            console.log('[CS-Sync] No user, skipping sync');
            return;
        }

        // Detect whether the background SW is available (Chrome) or not (Orion)
        const swAvailable = await wakeBackgroundSW('GET_VERSION');

        if (swAvailable) {
            // ── Chrome mode: background SW handles everything ──────────────
            // Content script role: keep SW alive + wake it on storage changes.
            console.log('[CS-Sync] SW available — acting as wake-up agent');
            initialized = true;
            watchStorage(false);
            // Initial push in case SW missed something while sleeping
            scheduleProgressPush(5000);
            return;
        }

        // ── Orion / Safari mode: full content-script sync ──────────────────
        console.log('[CS-Sync] No SW — starting full sync mode (Orion)');
        initialized = true;
        watchStorage(true);
        startListening();
        scheduleFullPush(4000); // push any locally unsynced data on startup

        // Reconnect stream when tab becomes visible
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) startListening();
        });

        // Refresh token every 50 min (tokens expire after 1h)
        setInterval(async () => {
            const newToken = await getValidToken();
            if (newToken && newToken !== currentToken) {
                currentToken = newToken;
                startListening();
            }
        }, 50 * 60 * 1000);

        window.addEventListener('beforeunload', () => {
            listenAbortCtrl?.abort();
            pushFullDirect();
        });
    }

    // Delay init slightly to let the page settle
    setTimeout(init, 2000);

    // ─── Keep-alive port: resets the SW's 30s idle timer ──────────────────────
    function connectKeepalivePort() {
        try {
            const port  = chrome.runtime.connect({ name: 'keepAlive' });
            const timer = setTimeout(connectKeepalivePort, 25000);
            port.onDisconnect.addListener(() => {
                clearTimeout(timer);
                setTimeout(connectKeepalivePort, 100);
            });
        } catch (_) {
            setTimeout(connectKeepalivePort, 1000);
        }
    }

    connectKeepalivePort();

})();
