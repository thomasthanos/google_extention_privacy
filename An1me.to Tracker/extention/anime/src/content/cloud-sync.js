/**
 * Anime Tracker - Content Script Cloud Sync
 *
 * Chrome + SW: keeps the SW alive, wakes it on progress changes, falls back
 * to direct Firestore PATCH if the SW is unavailable.
 *
 * Orion / Safari (no SW): opens a Firestore SSE stream for real-time pull,
 * pushes changes directly, reconnects with exponential back-off.
 */
(function () {
    'use strict';

    const FIREBASE_API_KEY    = 'AIzaSyCDF9US2OwARlyZ0AH_zDpjzmOXRtrGKMg';
    const FIREBASE_PROJECT_ID = 'anime-tracker-64d86';
    const FIRESTORE_BASE      = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)`;
    const LISTEN_URL          = `${FIRESTORE_BASE}/documents:listen`;

    const Logger = window.AnimeTrackerContent?.Logger;

    let initialized      = false;
    let listenAbortCtrl  = null;
    let reconnectTimeout = null;
    let currentToken     = null;
    let currentUser      = null;
    let reconnectDelay   = 5000;
    const MAX_RECONNECT  = 60000;
    let teardownSyncTriggered = false;

    // ─── Sync pause guard ─────────────────────────────────────────────────────
    let csSyncPausedUntil = 0;
    function csPauseSync(ms = 4000) {
        csSyncPausedUntil = Math.max(csSyncPausedUntil, Date.now() + ms);
    }
    function csIsSyncPaused() {
        return Date.now() < csSyncPausedUntil;
    }

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

    async function signOutDueToTokenFailure() {
        Logger?.warn('Token refresh failed — signing out to force re-auth');
        try {
            await chrome.storage.local.remove(['firebase_tokens', 'firebase_user']);
        } catch (e) {
            Logger?.warn(`Failed to clear auth storage during sign-out: ${e.message}`);
        }
        if (listenAbortCtrl) listenAbortCtrl.abort();
        if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
        currentToken = null;
        currentUser  = null;
    }

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
        } catch { return null; }
    }

    async function getValidToken() {
        try {
            const s = await chrome.storage.local.get(['firebase_tokens']);
            const t = s.firebase_tokens;
            if (!t?.idToken) return null;
            if (t.expiresAt < Date.now() + 120000) {
                const newIdToken = await refreshToken(t.refreshToken);
                if (!newIdToken) {
                    await signOutDueToTokenFailure();
                    return null;
                }
                return newIdToken;
            }
            return t.idToken;
        } catch { return null; }
    }

    async function getUser() {
        try {
            const s = await chrome.storage.local.get(['firebase_user']);
            return s.firebase_user || null;
        } catch { return null; }
    }

    // ─── Merge helpers ────────────────────────────────────────────────────────

    const {
        mergeAnimeData,
        mergeVideoProgress,
        mergeDeletedAnime,
        applyDeletedAnime,
        mergeGroupCoverImages,
        areAnimeDataMapsEqual,
        areProgressMapsEqual,
        shallowEqualDeletedAnime,
        shallowEqualObjectMap
    } = window.AnimeTrackerContent.MergeUtils;

    // ─── Direct push to Firestore (fallback when SW unavailable) ─────────────

    let lastPushedProgress      = null;
    let isPushingProgressDirect = false;
    let progressPushPending     = false;

    async function pushProgressDirect(options = {}) {
        const { keepalive = false } = options;
        if (isPushingProgressDirect && !keepalive) {
            progressPushPending = true;
            return;
        }
        const token = await getValidToken();
        const user  = currentUser || await getUser();
        if (!token || !user) return;
        isPushingProgressDirect = true;

        try {
            const localSnapshot = await chrome.storage.local.get(['videoProgress']);
            const snapshot = JSON.stringify(localSnapshot.videoProgress || {});
            if (snapshot === lastPushedProgress) return;

            let cloudVP = {};
            if (!keepalive) {
                const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
                try {
                    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                    if (r.ok) cloudVP = fromFSDoc(await r.json())?.videoProgress || {};
                    else if (r.status >= 500) { Logger?.warn('Cloud fetch 5xx, aborting push'); return; }
                } catch (e) {
                    Logger?.warn(`Cloud fetch failed, aborting push: ${e.message}`);
                    return;
                }
            }

            const latestLocal = keepalive
                ? (localSnapshot.videoProgress || {})
                : ((await chrome.storage.local.get(['videoProgress'])).videoProgress || {});
            if (!keepalive && JSON.stringify(latestLocal) !== snapshot) {
                progressPushPending = true;
            }

            const mergedVP = mergeVideoProgress(latestLocal, cloudVP);

            if (!keepalive) {
                const localCount  = Object.keys(latestLocal).length;
                const mergedCount = Object.keys(mergedVP).length;
                if (mergedCount > localCount) {
                    csPauseSync();
                    await chrome.storage.local.set({ videoProgress: mergedVP });
                    Logger?.info(`Pulled ${mergedCount - localCount} new progress entries from cloud`);
                }
            }

            const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
            const updateMask = 'updateMask.fieldPaths=videoProgress&updateMask.fieldPaths=lastUpdated';
            const body = JSON.stringify({
                fields: toFSFields({
                    videoProgress: mergedVP,
                    lastUpdated:   new Date().toISOString()
                })
            });
            const res = await fetch(`${url}?${updateMask}`, {
                method:  'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body,
                keepalive
            });

            if (res.ok) {
                lastPushedProgress = JSON.stringify(mergedVP);
                lastPushAt = Date.now();
                Logger?.info('videoProgress pushed (merged)');
            } else {
                Logger?.warn(`Direct progress push failed: ${res.status}`);
            }
        } catch (e) {
            Logger?.warn(`Direct progress push error: ${e.message}`);
        } finally {
            isPushingProgressDirect = false;
            if (progressPushPending && !keepalive) {
                progressPushPending = false;
                setTimeout(() => {
                    pushProgressDirect().catch((error) => {
                        Logger?.warn(`Queued progress push failed: ${error.message}`);
                    });
                }, 1000);
            }
        }
    }

    let fullPushInProgress = false;
    let fullPushPending    = false;
    let lastPushedFullSnap = null;

    async function pushFullDirect(options = {}) {
        const { keepalive = false } = options;
        if (fullPushInProgress && !keepalive) { fullPushPending = true; return; }
        const token = await getValidToken();
        const user  = currentUser || await getUser();
        if (!token || !user) return;

        fullPushInProgress = true;
        try {
            const localSnapshot = await chrome.storage.local.get(['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages']);

            const url     = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
            let cloudData = null;
            if (!keepalive) {
                try {
                    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                    if (r.ok) cloudData = fromFSDoc(await r.json());
                } catch {}
            }

            const local = keepalive
                ? localSnapshot
                : await chrome.storage.local.get(['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages']);
            if (!keepalive && JSON.stringify(local) !== JSON.stringify(localSnapshot)) {
                fullPushPending = true;
            }

            const mergedDeleted = cloudData?.deletedAnime
                ? mergeDeletedAnime(local.deletedAnime || {}, cloudData.deletedAnime)
                : (local.deletedAnime || {});

            let mergedAnime = cloudData?.animeData
                ? mergeAnimeData(local.animeData || {}, cloudData.animeData)
                : { ...(local.animeData || {}) };

            applyDeletedAnime(mergedAnime, mergedDeleted);

            const mergedProgress = cloudData?.videoProgress
                ? mergeVideoProgress(local.videoProgress || {}, cloudData.videoProgress)
                : (local.videoProgress || {});

            const localGroupCovers  = local.groupCoverImages      || {};
            const cloudGroupCovers  = cloudData?.groupCoverImages  || {};
            const mergedGroupCovers = mergeGroupCoverImages(localGroupCovers, cloudGroupCovers);

            if (!keepalive) {
                const animeDiff = !areAnimeDataMapsEqual(local.animeData || {}, mergedAnime);
                const progressDiff = !areProgressMapsEqual(local.videoProgress || {}, mergedProgress);
                const deletedDiff  = !shallowEqualDeletedAnime(local.deletedAnime || {}, mergedDeleted);
                const groupDiff    = !shallowEqualObjectMap(local.groupCoverImages || {}, mergedGroupCovers);
                if (animeDiff || progressDiff || deletedDiff || groupDiff) {
                    csPauseSync();
                    await chrome.storage.local.set({
                        animeData:        mergedAnime,
                        videoProgress:    mergedProgress,
                        deletedAnime:     mergedDeleted,
                        groupCoverImages: mergedGroupCovers
                    });
                }
            }

            const uploadSnap = JSON.stringify({ mergedAnime, mergedProgress, mergedDeleted, mergedGroupCovers });
            if (uploadSnap === lastPushedFullSnap) {
                Logger?.debug('Full push skipped (no changes since last push)');
                return;
            }

            const body = JSON.stringify({
                fields: toFSFields({
                    animeData:        mergedAnime,
                    videoProgress:    mergedProgress,
                    deletedAnime:     mergedDeleted,
                    groupCoverImages: mergedGroupCovers,
                    lastUpdated:      new Date().toISOString(),
                    email:            user.email
                })
            });

            // keepalive fetch has a 64KB body limit — fall back to regular fetch
            // if the payload is too large.
            const useKeepalive = keepalive && body.length < 63000;

            const res = await fetch(url, {
                method:  'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body,
                keepalive: useKeepalive
            });

            if (res.ok) {
                lastPushedFullSnap = uploadSnap;
                lastPushAt = Date.now();
                Logger?.info('Full push to Firestore complete');
            } else {
                Logger?.warn(`Full push failed: ${res.status}`);
            }
        } catch (e) {
            Logger?.warn(`Full push error: ${e.message}`);
        } finally {
            fullPushInProgress = false;
            if (fullPushPending) { fullPushPending = false; setTimeout(pushFullDirect, 1000); }
        }
    }

    // ─── Send message to background SW ───────────────────────────────────────

    async function wakeBackgroundSW(messageType = 'SYNC_PROGRESS_ONLY') {
        return new Promise((resolve) => {
            try {
                const Storage = (window.AnimeTrackerContent && window.AnimeTrackerContent.Storage) || null;
                if (!Storage || !Storage.isContextValid()) {
                    resolve(false);
                    return;
                }
            } catch {
                resolve(false);
                return;
            }

            const timeout = setTimeout(() => resolve(false), 1500);
            try {
                chrome.runtime.sendMessage({ type: messageType }, (response) => {
                    clearTimeout(timeout);
                    if (chrome.runtime.lastError || !response) {
                        resolve(false);
                    } else {
                        resolve(true);
                    }
                });
            } catch {
                clearTimeout(timeout);
                resolve(false);
            }
        });
    }

    // ─── Debounced progress push (Chrome path) ────────────────────────────────

    let progressDebounce = null;

    function scheduleProgressPush(delay = 3000) {
        if (progressDebounce) clearTimeout(progressDebounce);
        progressDebounce = setTimeout(async () => {
            progressDebounce = null;
            const swAlive = await wakeBackgroundSW('SYNC_PROGRESS_ONLY');
            if (!swAlive) {
                Logger?.debug('SW unreachable, pushing progress directly');
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

    // ─── Periodic forced push ─────────────────────────────────────────────────
    // The debounce pattern means pushes never fire during active watching
    // (saves every 2s keep resetting the 3s timer). This interval guarantees
    // data reaches the cloud regularly even while the video is playing.
    const PERIODIC_PUSH_INTERVAL = 30000; // 30 s
    let periodicPushTimer = null;
    let lastPushAt = 0;

    function startPeriodicPush(isOrionMode) {
        if (periodicPushTimer) return;
        periodicPushTimer = setInterval(async () => {
            if (csIsSyncPaused()) return;
            if (Date.now() - lastPushAt < PERIODIC_PUSH_INTERVAL * 0.8) return;
            if (isOrionMode) {
                pushFullDirect().then(() => { lastPushAt = Date.now(); });
            } else {
                const swAlive = await wakeBackgroundSW('SYNC_PROGRESS_ONLY');
                if (!swAlive) pushProgressDirect().then(() => { lastPushAt = Date.now(); });
                else lastPushAt = Date.now();
            }
        }, PERIODIC_PUSH_INTERVAL);
    }

    function stopPeriodicPush() {
        if (periodicPushTimer) { clearInterval(periodicPushTimer); periodicPushTimer = null; }
    }

    function pushOnTeardown(isOrionMode) {
        if (teardownSyncTriggered) return;
        teardownSyncTriggered = true;
        stopPeriodicPush();

        if (isOrionMode) {
            if (fullPushDebounce) clearTimeout(fullPushDebounce);
            // Use keepalive so the request survives page unload on mobile
            pushFullDirect({ keepalive: true });
            return;
        }

        if (progressDebounce) clearTimeout(progressDebounce);
        wakeBackgroundSW('SYNC_PROGRESS_ONLY').then(alive => {
            if (!alive) pushProgressDirect({ keepalive: true });
        });
    }

    function resetTeardownSyncGuard() {
        teardownSyncTriggered = false;
    }

    // ─── Apply incoming cloud update locally ──────────────────────────────────

    async function applyCloudUpdate(cloudDoc) {
        if (!cloudDoc) return;
        try {
            const local = await chrome.storage.local.get(['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages']);

            const mergedDeleted = cloudDoc.deletedAnime
                ? mergeDeletedAnime(local.deletedAnime || {}, cloudDoc.deletedAnime)
                : (local.deletedAnime || {});

            const mergedAnime = mergeAnimeData(local.animeData || {}, cloudDoc.animeData || {});

            applyDeletedAnime(mergedAnime, mergedDeleted);

            const mergedProgress = mergeVideoProgress(local.videoProgress || {}, cloudDoc.videoProgress || {});

            const localGroupCovers  = local.groupCoverImages      || {};
            const cloudGroupCovers  = cloudDoc.groupCoverImages   || {};
            const mergedGroupCovers = mergeGroupCoverImages(localGroupCovers, cloudGroupCovers);

            const localEps = Object.values(local.animeData || {}).reduce((s, a) => s + (a.episodes?.length || 0), 0);
            const mergedEps = Object.values(mergedAnime).reduce((s, a) => s + (a.episodes?.length || 0), 0);
            const animeChanged = !areAnimeDataMapsEqual(local.animeData || {}, mergedAnime);

            const progressChanged = !areProgressMapsEqual(local.videoProgress || {}, mergedProgress);
            const deletedChanged  = !shallowEqualDeletedAnime(local.deletedAnime || {}, mergedDeleted);
            const groupChanged    = !shallowEqualObjectMap(local.groupCoverImages || {}, mergedGroupCovers);

            if (animeChanged || progressChanged || deletedChanged || groupChanged) {
                csPauseSync();
                await chrome.storage.local.set({
                    animeData:        mergedAnime,
                    videoProgress:    mergedProgress,
                    deletedAnime:     mergedDeleted,
                    groupCoverImages: mergedGroupCovers
                });
                Logger?.info(`Cloud update applied (eps: ${localEps}→${mergedEps})`);
            }
        } catch (e) {
            Logger?.warn(`Apply cloud update failed: ${e.message}`);
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
        let tokenRefreshInterval = null;

        try {
            const res = await fetch(`${LISTEN_URL}?key=${FIREBASE_API_KEY}`, {
                method:  'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body:    JSON.stringify({ addTarget: { documents: { documents: [docPath] }, targetId: 1 } }),
                signal:  listenAbortCtrl.signal
            });

            if (!res.ok) { scheduleReconnect(); return; }

            reconnectDelay = 5000;
            Logger?.info('Firestore stream connected');

            tokenRefreshInterval = setInterval(async () => {
                const fresh = await getValidToken();
                if (!fresh) {
                    clearInterval(tokenRefreshInterval);
                    tokenRefreshInterval = null;
                    listenAbortCtrl?.abort();
                    return;
                }
                if (fresh !== currentToken) {
                    clearInterval(tokenRefreshInterval);
                    tokenRefreshInterval = null;
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
                if (buffer.length > 256 * 1024) {
                    Logger?.warn('SSE buffer overflow, reconnecting');
                    listenAbortCtrl?.abort();
                    scheduleReconnect(1000);
                    return;
                }
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
                        if (msg.targetChange?.targetChangeType === 'REMOVE' &&
                            msg.targetChange?.cause?.code === 16) {
                            listenAbortCtrl.abort();
                            currentToken = await getValidToken();
                            if (currentToken) startListening();
                            return;
                        }
                    } catch {}
                }
            }
        } catch (e) {
            if (e.name === 'AbortError') return;
            Logger?.warn(`Stream error: ${e.message}`);
        } finally {
            if (tokenRefreshInterval) {
                clearInterval(tokenRefreshInterval);
                tokenRefreshInterval = null;
            }
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

    function watchStorage(isOrionMode) {
        startPeriodicPush(isOrionMode);

        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local') return;

            let shouldSyncProgress = false;
            let shouldSyncFull = false;

            if (changes.videoProgress && !csIsSyncPaused()) {
                shouldSyncProgress = true;
            }

            if (changes.animeData && !csIsSyncPaused()) {
                const oldAnime = changes.animeData.oldValue || {};
                const newAnime = changes.animeData.newValue || {};
                const oldCount = Object.values(oldAnime).reduce((s, a) => s + (a.episodes?.length || 0), 0);
                const newCount = Object.values(newAnime).reduce((s, a) => s + (a.episodes?.length || 0), 0);

                let coverChanged = false;
                if (newCount === oldCount) {
                    for (const slug of Object.keys(newAnime)) {
                        const oldCover = oldAnime[slug]?.coverImage || null;
                        const newCover = newAnime[slug]?.coverImage || null;
                        if (oldCover !== newCover) { coverChanged = true; break; }
                    }
                }

                if (newCount > oldCount || coverChanged) {
                    shouldSyncFull = true;
                }
            }

            if (changes.deletedAnime && !csIsSyncPaused()) {
                if (!shallowEqualDeletedAnime(
                    changes.deletedAnime.oldValue || {},
                    changes.deletedAnime.newValue || {}
                )) {
                    shouldSyncFull = true;
                }
            }

            if (changes.groupCoverImages && !csIsSyncPaused()) {
                if (!shallowEqualObjectMap(
                    changes.groupCoverImages.oldValue || {},
                    changes.groupCoverImages.newValue || {}
                )) {
                    shouldSyncFull = true;
                }
            }

            if (shouldSyncFull) {
                if (progressDebounce) clearTimeout(progressDebounce);
                if (isOrionMode) {
                    scheduleFullPush(1500);
                } else {
                    setTimeout(async () => {
                        const swAlive = await wakeBackgroundSW('SYNC_TO_FIREBASE');
                        if (!swAlive) pushFullDirect();
                    }, 500);
                }
                return;
            }

            if (shouldSyncProgress) {
                if (isOrionMode) {
                    scheduleFullPush(3000);
                } else {
                    scheduleProgressPush(3000);
                }
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                stopPeriodicPush();
                pushOnTeardown(isOrionMode);
            } else {
                resetTeardownSyncGuard();
                startPeriodicPush(isOrionMode);
            }
        });

        window.addEventListener('pagehide', (event) => {
            if (event && event.persisted) return;
            pushOnTeardown(isOrionMode);
        }, { passive: true });

        window.addEventListener('pageshow', (event) => {
            if (!event || !event.persisted) return;
            resetTeardownSyncGuard();
            startPeriodicPush(isOrionMode);
        }, { passive: true });
    }

    // ─── Init ─────────────────────────────────────────────────────────────────

    async function init() {
        if (initialized) return;

        currentUser = await getUser();
        if (!currentUser) {
            Logger?.debug('No user, skipping sync');
            return;
        }

        const swAvailable = await wakeBackgroundSW('GET_VERSION');

        if (swAvailable) {
            Logger?.info('SW available — acting as wake-up agent');
            initialized = true;
            watchStorage(false);
            scheduleProgressPush(5000);
            return;
        }

        Logger?.info('No SW — starting full sync mode (Orion)');
        initialized = true;
        watchStorage(true);
        startListening();
        scheduleFullPush(4000);

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) startListening();
        });

        setInterval(async () => {
            const newToken = await getValidToken();
            if (!newToken) return;
            if (newToken !== currentToken) {
                currentToken = newToken;
                startListening();
            }
        }, 50 * 60 * 1000);

        window.addEventListener('beforeunload', () => {
            listenAbortCtrl?.abort();
            pushOnTeardown(true);
        });
    }

    setTimeout(init, 2000);

    // ─── Keep-alive port ──────────────────────────────────────────────────────

    let keepAliveRetryDelay = 100;
    let keepAliveRetryTimer = null;
    let keepAlivePulseTimer = null;
    let keepAlivePort = null;
    let suppressKeepAliveReconnect = false;
    let keepAliveFailCount = 0;
    const KEEPALIVE_MAX_FAILS = 8; // stop retrying after ~16s of backoff (no background SW)

    function scheduleKeepaliveReconnect(delayMs) {
        if (keepAliveRetryTimer) clearTimeout(keepAliveRetryTimer);
        keepAliveRetryTimer = setTimeout(() => {
            keepAliveRetryTimer = null;
            connectKeepalivePort();
        }, delayMs);
    }

    function disconnectKeepalivePort() {
        if (keepAlivePort) {
            suppressKeepAliveReconnect = true;
            try { keepAlivePort.disconnect(); } catch {}
            keepAlivePort = null;
        }
        if (keepAlivePulseTimer) {
            clearTimeout(keepAlivePulseTimer);
            keepAlivePulseTimer = null;
        }
    }

    function connectKeepalivePort() {
        if (document.hidden) {
            scheduleKeepaliveReconnect(3000);
            return;
        }

        disconnectKeepalivePort();

        try {
            const port = chrome.runtime.connect({ name: 'keepAlive' });
            keepAlivePort = port;
            keepAliveRetryDelay = 100;
            keepAliveFailCount = 0;

            keepAlivePulseTimer = setTimeout(() => {
                keepAlivePulseTimer = null;
                connectKeepalivePort();
            }, 25000);

            port.onDisconnect.addListener(() => {
                if (suppressKeepAliveReconnect) {
                    suppressKeepAliveReconnect = false;
                    return;
                }

                const err = chrome.runtime.lastError;
                if (err) {
                    const msg = err.message || '';
                    const isExpectedClose = msg.includes('back/forward cache') || msg.includes('message channel is closed');
                    if (!isExpectedClose) {
                        Logger?.debug(`keepAlive port disconnected: ${msg}`);
                    }
                }

                if (keepAlivePort === port) keepAlivePort = null;
                if (keepAlivePulseTimer) {
                    clearTimeout(keepAlivePulseTimer);
                    keepAlivePulseTimer = null;
                }

                keepAliveRetryDelay = Math.min(keepAliveRetryDelay * 2, 5000);
                scheduleKeepaliveReconnect(document.hidden ? 3000 : keepAliveRetryDelay);
            });
        } catch {
            keepAliveFailCount++;
            if (keepAliveFailCount >= KEEPALIVE_MAX_FAILS) {
                // No background service worker available (e.g. Orion/Safari) — stop retrying
                Logger?.debug('keepAlive: no background SW detected, stopping retries');
                return;
            }
            keepAliveRetryDelay = Math.min(keepAliveRetryDelay * 2, 5000);
            scheduleKeepaliveReconnect(document.hidden ? 3000 : keepAliveRetryDelay);
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            disconnectKeepalivePort();
            if (keepAliveRetryTimer) {
                clearTimeout(keepAliveRetryTimer);
                keepAliveRetryTimer = null;
            }
            return;
        }

        keepAliveRetryDelay = 100;
        scheduleKeepaliveReconnect(50);
    });

    window.addEventListener('pageshow', (event) => {
        if (!event || !event.persisted) return;
        keepAliveRetryDelay = 100;
        scheduleKeepaliveReconnect(50);
    }, { passive: true });

    window.addEventListener('pagehide', (event) => {
        if (!event || !event.persisted) return;
        disconnectKeepalivePort();
        if (keepAliveRetryTimer) {
            clearTimeout(keepAliveRetryTimer);
            keepAliveRetryTimer = null;
        }
    }, { passive: true });

    connectKeepalivePort();

})();
