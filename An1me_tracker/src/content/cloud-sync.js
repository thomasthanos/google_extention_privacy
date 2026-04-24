(function () {
    'use strict';

    const FIREBASE_API_KEY = 'AIzaSyCDF9US2OwARlyZ0AH_zDpjzmOXRtrGKMg';
    const FIREBASE_PROJECT_ID = 'anime-tracker-64d86';
    const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)`;
    const LISTEN_URL = `${FIRESTORE_BASE}/documents:listen`;
    const FIRESTORE_LISTEN_SUPPORTED = false;
    const CLOUD_POLL_INTERVAL_MS = 60000;

    const Logger = window.AnimeTrackerContent?.Logger;

    let initialized = false;
    let listenAbortCtrl = null;
    let startListeningInFlight = false;
    let reconnectTimeout = null;
    let currentToken = null;
    let currentUser = null;
    let reconnectDelay = 5000;
    const MAX_RECONNECT = 60000;
    let lastCloudPollAt = 0;
    let pollInFlight = null;
    let teardownSyncTriggered = false;

    let csSyncPausedUntil = 0;
    function csPauseSync(ms = 4000) {
        csSyncPausedUntil = Math.max(csSyncPausedUntil, Date.now() + ms);
    }
    function csIsSyncPaused() {
        return Date.now() < csSyncPausedUntil;
    }

    function toFSValue(v) {
        if (v === null || v === undefined) return { nullValue: null };
        if (typeof v === 'boolean') return { booleanValue: v };
        if (typeof v === 'string') return { stringValue: v };
        if (typeof v === 'number') return Number.isInteger(v)
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
        if ('nullValue' in v) return null;
        if ('booleanValue' in v) return v.booleanValue;
        if ('stringValue' in v) return v.stringValue;
        if ('integerValue' in v) return parseInt(v.integerValue, 10);
        if ('doubleValue' in v) return v.doubleValue;
        if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFSValue);
        if ('mapValue' in v) {
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
        currentUser = null;
    }

    let _refreshInflight = null;
    async function refreshToken(rt) {
        if (_refreshInflight) return _refreshInflight;
        _refreshInflight = (async () => {
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
                    idToken: data.id_token,
                    refreshToken: data.refresh_token,
                    expiresAt: Date.now() + parseInt(data.expires_in) * 1000
                };
                try { await chrome.storage.local.set({ firebase_tokens: tokens }); } catch (e) {
                    Logger?.warn(`Failed to persist refreshed token: ${e.message}`);
                }
                return tokens.idToken;
            } catch { return null; }
        })();
        const p = _refreshInflight;
        p.finally(() => { if (_refreshInflight === p) _refreshInflight = null; });
        return p;
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

    const {
        mergeAnimeData,
        mergeVideoProgress,
        mergeDeletedAnime,
        pruneStaleDeletedAnime,
        applyDeletedAnime,
        removeDeletedProgress,
        mergeGroupCoverImages,
        areAnimeDataMapsEqual,
        areProgressMapsEqual,
        shallowEqualDeletedAnime,
        shallowEqualObjectMap
    } = window.AnimeTrackerContent.MergeUtils;

    let lastPushedProgress = null;
    let isPushingProgressDirect = false;
    let progressPushPending = false;

    let _cloudDocCache = null;
    let _cloudDocCacheTime = 0;
    let _lastAppliedCloudUpdatedAt = null;
    const _CLOUD_DOC_TTL = 120000;

    const _recentOwnWrites = [];
    const _MAX_RECENT_OWN_WRITES = 20;
    function rememberOwnWrite(ts) {
        if (!ts) return;
        _recentOwnWrites.push(ts);
        if (_recentOwnWrites.length > _MAX_RECENT_OWN_WRITES) _recentOwnWrites.shift();
    }
    function isOwnEcho(ts) {
        return !!ts && _recentOwnWrites.includes(ts);
    }

    function invalidateCloudDocCache() {
        _cloudDocCache = null;
        _cloudDocCacheTime = 0;
    }

    async function getCloudDocCached(token, user) {
        const now = Date.now();
        if (_cloudDocCache && (now - _cloudDocCacheTime) < _CLOUD_DOC_TTL) {
            return _cloudDocCache;
        }
        const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
        try {
            const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            if (!r.ok) return null;
            const doc = fromFSDoc(await r.json());
            _cloudDocCache = doc;
            _cloudDocCacheTime = Date.now();
            return doc;
        } catch (e) {
            Logger?.warn(`Cloud fetch failed: ${e.message}`);
            return null;
        }
    }

    async function pollCloudDoc(token, user, reason = 'poll') {
        if (pollInFlight) return pollInFlight;
        if ((Date.now() - lastCloudPollAt) < CLOUD_POLL_INTERVAL_MS) return null;

        pollInFlight = (async () => {
            try {
                lastCloudPollAt = Date.now();
                const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
                const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                if (!response.ok) {
                    Logger?.warn(`Cloud poll failed (${reason}): ${response.status}`);
                    return null;
                }

                const cloudDoc = fromFSDoc(await response.json());
                _cloudDocCache = cloudDoc;
                _cloudDocCacheTime = Date.now();
                if (cloudDoc) {
                    await applyCloudUpdate(cloudDoc);
                }
                return cloudDoc;
            } catch (e) {
                Logger?.warn(`Cloud poll error (${reason}): ${e.message}`);
                return null;
            } finally {
                pollInFlight = null;
            }
        })();

        return pollInFlight;
    }

    function filterTrackedFromProgress(videoProgress, animeData, deletedAnime = {}) {
        if (!videoProgress || !animeData) return videoProgress || {};
        const baseProgress = removeDeletedProgress(videoProgress, deletedAnime);
        const trackedIds = new Set();
        for (const [slug, anime] of Object.entries(animeData)) {
            if (anime?.episodes) {
                for (const ep of anime.episodes) trackedIds.add(`${slug}__episode-${ep.number}`);
            }
        }
        const out = {};
        for (const [id, p] of Object.entries(baseProgress)) {
            if (id === '__slugIndex') continue;
            if (trackedIds.has(id)) continue;
            if (p?.deleted) continue;
            out[id] = p;
        }
        return out;
    }

    function cleanMergedProgress(videoProgress, animeData, deletedAnime = {}) {
        if (!videoProgress || typeof videoProgress !== 'object') return {};
        const baseProgress = removeDeletedProgress(videoProgress, deletedAnime);

        const trackedIds = new Set();
        for (const [slug, anime] of Object.entries(animeData || {})) {
            if (!Array.isArray(anime?.episodes)) continue;
            for (const ep of anime.episodes) {
                const num = Number(ep?.number) || 0;
                if (num > 0) trackedIds.add(`${slug}__episode-${num}`);
            }
        }

        const completedPct = window.AnimeTrackerContent?.CONFIG?.COMPLETED_PERCENTAGE || 85;
        const cleaned = {};

        for (const [id, progress] of Object.entries(baseProgress)) {
            if (!progress || progress.deleted) continue;
            if (trackedIds.has(id)) continue;
            if ((Number(progress.percentage) || 0) >= completedPct) continue;
            cleaned[id] = progress;
        }

        return cleaned;
    }

    async function pushProgressDirect(options = {}) {
        const { keepalive = false } = options;
        if (isPushingProgressDirect && !keepalive) {
            progressPushPending = true;
            return;
        }
        const token = await getValidToken();
        const user = currentUser || await getUser();
        if (!token || !user) return;
        isPushingProgressDirect = true;

        try {
            const localSnapshot = await chrome.storage.local.get(['videoProgress', 'animeData', 'deletedAnime']);
            const localAnimeData = localSnapshot.animeData || {};
            const filteredLocalVP = filterTrackedFromProgress(
                localSnapshot.videoProgress || {},
                localAnimeData,
                localSnapshot.deletedAnime || {}
            );
            const snapshot = JSON.stringify(filteredLocalVP);
            if (snapshot === lastPushedProgress) return;

            let cloudVP = {};
            if (!keepalive) {
                const cached = await getCloudDocCached(token, user);
                cloudVP = cached?.videoProgress || {};
            }

            const latestLocalFull = keepalive
                ? (localSnapshot.videoProgress || {})
                : ((await chrome.storage.local.get(['videoProgress'])).videoProgress || {});
            const latestLocal = filterTrackedFromProgress(latestLocalFull, localAnimeData);
            if (!keepalive && JSON.stringify(latestLocal) !== snapshot) {
                progressPushPending = true;
            }

            const mergedVP = mergeVideoProgress(latestLocal, cloudVP);

            if (!keepalive) {
                const localCount = Object.keys(latestLocal).length;
                const mergedCount = Object.keys(mergedVP).length;
                if (mergedCount > localCount) {
                    csPauseSync();
                    try {
                        await chrome.storage.local.set({ videoProgress: mergedVP });
                        Logger?.info(`Pulled ${mergedCount - localCount} new progress entries from cloud`);
                    } catch (e) {
                        Logger?.warn(`Failed to merge pulled progress locally: ${e.message}`);
                    }
                }
            }

            const mergedSnap = JSON.stringify(mergedVP);
            if (mergedSnap === lastPushedProgress) {
                Logger?.debug('Progress push skipped (merged matches last pushed)');
                return;
            }

            const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
            const updateMask = 'updateMask.fieldPaths=videoProgress&updateMask.fieldPaths=lastUpdated';
            const pushedAt = new Date().toISOString();
            const body = JSON.stringify({
                fields: toFSFields({
                    videoProgress: mergedVP,
                    lastUpdated: pushedAt
                })
            });
            const res = await fetch(`${url}?${updateMask}`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body,
                keepalive
            });

            if (res.ok) {
                lastPushedProgress = mergedSnap;
                lastPushAt = Date.now();
                invalidateCloudDocCache();
                _lastAppliedCloudUpdatedAt = pushedAt;
                rememberOwnWrite(pushedAt);
                Logger?.info('videoProgress pushed (merged)');
            } else {
                Logger?.warn(`Direct progress push failed: ${res.status}`);
                if (res.status >= 500) invalidateCloudDocCache();
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
    let fullPushPending = false;
    let lastPushedFullSnap = null;

    async function pushFullDirect(options = {}) {
        const { keepalive = false } = options;
        if (fullPushInProgress && !keepalive) { fullPushPending = true; return; }
        const token = await getValidToken();
        const user = currentUser || await getUser();
        if (!token || !user) return;

        fullPushInProgress = true;
        try {
            const localSnapshot = await chrome.storage.local.get(['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages']);

            const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
            let cloudData = null;
            if (!keepalive) {
                cloudData = await getCloudDocCached(token, user);
            }

            const local = keepalive
                ? localSnapshot
                : await chrome.storage.local.get(['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages']);
            if (!keepalive && JSON.stringify(local) !== JSON.stringify(localSnapshot)) {
                fullPushPending = true;
            }

            let mergedDeleted = cloudData?.deletedAnime
                ? mergeDeletedAnime(local.deletedAnime || {}, cloudData.deletedAnime)
                : (local.deletedAnime || {});

            let mergedAnime = cloudData?.animeData
                ? mergeAnimeData(local.animeData || {}, cloudData.animeData)
                : { ...(local.animeData || {}) };

            mergedDeleted = pruneStaleDeletedAnime(mergedAnime, mergedDeleted);
            applyDeletedAnime(mergedAnime, mergedDeleted);

            const mergedProgress = cloudData?.videoProgress
                ? mergeVideoProgress(local.videoProgress || {}, cloudData.videoProgress)
                : (local.videoProgress || {});

            const localGroupCovers = local.groupCoverImages || {};
            const cloudGroupCovers = cloudData?.groupCoverImages || {};
            const mergedGroupCovers = mergeGroupCoverImages(localGroupCovers, cloudGroupCovers);

            if (!keepalive) {
                const animeDiff = !areAnimeDataMapsEqual(local.animeData || {}, mergedAnime);
                const progressDiff = !areProgressMapsEqual(local.videoProgress || {}, mergedProgress);
                const deletedDiff = !shallowEqualDeletedAnime(local.deletedAnime || {}, mergedDeleted);
                const groupDiff = !shallowEqualObjectMap(local.groupCoverImages || {}, mergedGroupCovers);
                if (animeDiff || progressDiff || deletedDiff || groupDiff) {
                    csPauseSync();
                    await chrome.storage.local.set({
                        animeData: mergedAnime,
                        videoProgress: mergedProgress,
                        deletedAnime: mergedDeleted,
                        groupCoverImages: mergedGroupCovers
                    });
                }
            }

            const uploadSnap = JSON.stringify({ mergedAnime, mergedProgress, mergedDeleted, mergedGroupCovers });
            if (uploadSnap === lastPushedFullSnap) {
                Logger?.debug('Full push skipped (no changes since last push)');
                return;
            }

            const pushedAt = new Date().toISOString();
            const body = JSON.stringify({
                fields: toFSFields({
                    animeData: mergedAnime,
                    videoProgress: mergedProgress,
                    deletedAnime: mergedDeleted,
                    groupCoverImages: mergedGroupCovers,
                    lastUpdated: pushedAt,
                    email: user.email
                })
            });

            const useKeepalive = keepalive && body.length < 63000;

            const res = await fetch(url, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body,
                keepalive: useKeepalive
            });

            if (res.ok) {
                lastPushedFullSnap = uploadSnap;
                lastPushAt = Date.now();
                invalidateCloudDocCache();
                _lastAppliedCloudUpdatedAt = pushedAt;
                rememberOwnWrite(pushedAt);
                Logger?.info('Full push to Firestore complete');
            } else {
                Logger?.warn(`Full push failed: ${res.status}`);
                if (res.status >= 500) invalidateCloudDocCache();
            }
        } catch (e) {
            Logger?.warn(`Full push error: ${e.message}`);
        } finally {
            fullPushInProgress = false;
            if (fullPushPending) { fullPushPending = false; setTimeout(pushFullDirect, 1000); }
        }
    }

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

    let progressDebounce = null;
    let progressMaxWaitTimer = null;
    const PROGRESS_MAX_WAIT_MS = 90000;

    async function flushProgressPush() {
        if (progressDebounce) { clearTimeout(progressDebounce); progressDebounce = null; }
        if (progressMaxWaitTimer) { clearTimeout(progressMaxWaitTimer); progressMaxWaitTimer = null; }
        const swAlive = await wakeBackgroundSW('SYNC_PROGRESS_ONLY');
        if (!swAlive) {
            Logger?.debug('SW unreachable, pushing progress directly');
            await pushProgressDirect();
        }
    }

    function scheduleProgressPush(delay = 60000) {
        if (progressDebounce) clearTimeout(progressDebounce);
        progressDebounce = setTimeout(() => {
            progressDebounce = null;
            flushProgressPush();
        }, delay);
        if (!progressMaxWaitTimer) {
            progressMaxWaitTimer = setTimeout(() => {
                progressMaxWaitTimer = null;
                flushProgressPush();
            }, PROGRESS_MAX_WAIT_MS);
        }
    }

    let fullPushDebounce = null;
    let fullPushMaxWaitTimer = null;
    const FULL_PUSH_MAX_WAIT_MS = 25000;

    function scheduleFullPush(delay = 2500) {
        if (fullPushDebounce) clearTimeout(fullPushDebounce);
        fullPushDebounce = setTimeout(() => {
            fullPushDebounce = null;
            if (fullPushMaxWaitTimer) { clearTimeout(fullPushMaxWaitTimer); fullPushMaxWaitTimer = null; }
            pushFullDirect();
        }, delay);
        if (!fullPushMaxWaitTimer) {
            fullPushMaxWaitTimer = setTimeout(() => {
                fullPushMaxWaitTimer = null;
                if (fullPushDebounce) { clearTimeout(fullPushDebounce); fullPushDebounce = null; }
                pushFullDirect();
            }, FULL_PUSH_MAX_WAIT_MS);
        }
    }

    // Periodic push fires every 5 min during active watching. Gives ~4-5 cloud
    // syncs per 24-min episode — good balance between freshness and write volume.
    // Keepalive on teardown covers the close path as a final safety net.
    const PERIODIC_PUSH_INTERVAL = 300000;
    let periodicPushTimer = null;
    let lastPushAt = 0;
    let _lastIdleSnapshot = null;

    async function _currentLocalProgressSnapshot(isOrionMode) {
        try {
            const keys = isOrionMode
                ? ['videoProgress', 'animeData', 'deletedAnime', 'groupCoverImages']
                : ['videoProgress'];
            const r = await chrome.storage.local.get(keys);
            return JSON.stringify(r);
        } catch { return null; }
    }

    function startPeriodicPush(isOrionMode) {
        if (periodicPushTimer) return;
        periodicPushTimer = setInterval(async () => {
            if (csIsSyncPaused()) return;
            if (Date.now() - lastPushAt < PERIODIC_PUSH_INTERVAL * 0.8) return;

            const snap = await _currentLocalProgressSnapshot(isOrionMode);
            if (snap && snap === _lastIdleSnapshot) {
                Logger?.debug('Periodic push skipped (idle — no local changes)');
                return;
            }
            _lastIdleSnapshot = snap;

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
            pushFullDirect({ keepalive: true });
            return;
        }

        if (progressDebounce) { clearTimeout(progressDebounce); progressDebounce = null; }
        if (progressMaxWaitTimer) { clearTimeout(progressMaxWaitTimer); progressMaxWaitTimer = null; }

        // Direct keepalive fetch from the content script — survives page unload.
        // Intentionally no wakeBackgroundSW here: that would trigger a duplicate write
        // via SW's SYNC_PROGRESS_ONLY handler. The direct keepalive fetch is enough.
        pushProgressDirect({ keepalive: true });
    }

    function resetTeardownSyncGuard() {
        teardownSyncTriggered = false;
    }

    async function applyCloudUpdate(cloudDoc) {
        if (!cloudDoc) return;
        const cloudUpdatedAt = cloudDoc.lastUpdated || null;
        if (cloudUpdatedAt && isOwnEcho(cloudUpdatedAt)) {
            Logger?.debug(`Ignoring own-echo cloud update (${cloudUpdatedAt})`);
            return;
        }
        _cloudDocCache = cloudDoc;
        _cloudDocCacheTime = Date.now();
        try {
            const local = await chrome.storage.local.get(['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages']);

            let mergedDeleted = cloudDoc.deletedAnime
                ? mergeDeletedAnime(local.deletedAnime || {}, cloudDoc.deletedAnime)
                : (local.deletedAnime || {});

            const mergedAnime = mergeAnimeData(local.animeData || {}, cloudDoc.animeData || {});

            mergedDeleted = pruneStaleDeletedAnime(mergedAnime, mergedDeleted);
            applyDeletedAnime(mergedAnime, mergedDeleted);

            const mergedProgress = cleanMergedProgress(
                mergeVideoProgress(local.videoProgress || {}, cloudDoc.videoProgress || {}),
                mergedAnime,
                mergedDeleted
            );

            const localGroupCovers = local.groupCoverImages || {};
            const cloudGroupCovers = cloudDoc.groupCoverImages || {};
            const mergedGroupCovers = mergeGroupCoverImages(localGroupCovers, cloudGroupCovers);

            const localEps = Object.values(local.animeData || {}).reduce((s, a) => s + (a.episodes?.length || 0), 0);
            const mergedEps = Object.values(mergedAnime).reduce((s, a) => s + (a.episodes?.length || 0), 0);
            const animeChanged = !areAnimeDataMapsEqual(local.animeData || {}, mergedAnime);

            const progressChanged = !areProgressMapsEqual(local.videoProgress || {}, mergedProgress);
            const deletedChanged = !shallowEqualDeletedAnime(local.deletedAnime || {}, mergedDeleted);
            const groupChanged = !shallowEqualObjectMap(local.groupCoverImages || {}, mergedGroupCovers);

            if (animeChanged || progressChanged || deletedChanged || groupChanged) {
                csPauseSync();
                await chrome.storage.local.set({
                    animeData: mergedAnime,
                    videoProgress: mergedProgress,
                    deletedAnime: mergedDeleted,
                    groupCoverImages: mergedGroupCovers
                });
                Logger?.info(`Cloud update applied (eps: ${localEps}→${mergedEps})`);
            }
            if (cloudUpdatedAt) _lastAppliedCloudUpdatedAt = cloudUpdatedAt;
        } catch (e) {
            Logger?.warn(`Apply cloud update failed: ${e.message}`);
        }
    }

    async function startListening() {
        if (startListeningInFlight) {
            Logger?.debug('startListening: already in flight, skip');
            return;
        }
        startListeningInFlight = true;

        if (listenAbortCtrl) listenAbortCtrl.abort();
        listenAbortCtrl = new AbortController();

        const token = await getValidToken();
        const user = currentUser || await getUser();
        if (!token || !user) { startListeningInFlight = false; scheduleReconnect(10000); return; }

        currentToken = token;
        currentUser = user;

        if (!FIRESTORE_LISTEN_SUPPORTED) {
            try {
                await pollCloudDoc(token, user, 'listen-fallback');
            } finally {
                startListeningInFlight = false;
            }
            scheduleReconnect(CLOUD_POLL_INTERVAL_MS);
            return;
        }

        const docPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${user.uid}`;
        let tokenRefreshInterval = null;
        const streamOpenedAt = Date.now();

        try {
            const res = await fetch(`${LISTEN_URL}?key=${FIREBASE_API_KEY}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ addTarget: { documents: { documents: [docPath] }, targetId: 1 } }),
                signal: listenAbortCtrl.signal
            });

            if (!res.ok) { scheduleReconnect(); return; }

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

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

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
                    } catch { }
                }
            }
        } catch (e) {
            if (e.name === 'AbortError') { startListeningInFlight = false; return; }
            Logger?.warn(`Stream error: ${e.message}`);
        } finally {
            if (tokenRefreshInterval) {
                clearInterval(tokenRefreshInterval);
                tokenRefreshInterval = null;
            }
            if (Date.now() - streamOpenedAt >= 15000) {
                reconnectDelay = 5000;
            }
            startListeningInFlight = false;
        }
        scheduleReconnect();
    }

    function scheduleReconnect(delay) {
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        const d = Math.max(5000, delay ?? reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT);
        reconnectTimeout = setTimeout(startListening, d);
    }

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
                }
                // SW-mode: BG's storage.onChanged debounce (5min) is the single source of truth
                // for progress writes. No CS-side push needed — avoids duplicate writes.
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
            // No initial scheduleProgressPush — BG's storage.onChanged debounce handles it.
            // Warm token cache so teardown keepalive fetch can fire without async lookup.
            (async () => {
                try { currentToken = await getValidToken(); } catch { }
            })();
            setInterval(async () => {
                try {
                    const t = await getValidToken();
                    if (t) currentToken = t;
                } catch { }
            }, 45 * 60 * 1000);
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

        const orionTokenRefreshTimer = setInterval(async () => {
            const newToken = await getValidToken();
            if (!newToken) return;
            if (newToken !== currentToken) {
                currentToken = newToken;
                startListening();
            }
        }, 50 * 60 * 1000);

        window.addEventListener('beforeunload', () => {
            clearInterval(orionTokenRefreshTimer);
            listenAbortCtrl?.abort();
            pushOnTeardown(true);
        });
    }

    setTimeout(init, 2000);

    window.AnimeTrackerContent = window.AnimeTrackerContent || {};
    window.AnimeTrackerContent.CloudSync = {
        pushFullKeepalive: () => pushFullDirect({ keepalive: true }),
        pushKeepaliveWithPayload(payload) {
            try {
                const user = currentUser;
                const token = currentToken;
                if (!user || !token) return false;
                const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
                const pushedAt = new Date().toISOString();
                const body = JSON.stringify({
                    fields: toFSFields({
                        animeData: payload.animeData || {},
                        videoProgress: payload.videoProgress || {},
                        deletedAnime: payload.deletedAnime || {},
                        groupCoverImages: payload.groupCoverImages || {},
                        lastUpdated: pushedAt,
                        email: user.email
                    })
                });
                if (body.length >= 63000) return false;
                const mask = ['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages', 'lastUpdated', 'email']
                    .map(f => `updateMask.fieldPaths=${f}`).join('&');
                fetch(`${url}?${mask}`, {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body,
                    keepalive: true
                }).catch(() => { });
                return true;
            } catch {
                return false;
            }
        }
    };

    let keepAliveRetryDelay = 100;
    let keepAliveRetryTimer = null;
    let keepAlivePulseTimer = null;
    let keepAlivePort = null;
    let suppressKeepAliveReconnect = false;
    let keepAliveFailCount = 0;
    const KEEPALIVE_MAX_FAILS = 8;

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
            try { keepAlivePort.disconnect(); } catch { }
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
            const connectedAt = Date.now();
            keepAlivePort = port;
            keepAliveRetryDelay = 100;

            keepAlivePulseTimer = setTimeout(() => {
                keepAlivePulseTimer = null;
                keepAliveFailCount = 0;
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

                const aliveMs = Date.now() - connectedAt;
                if (aliveMs < 2000) {
                    keepAliveFailCount++;
                    if (keepAliveFailCount >= KEEPALIVE_MAX_FAILS) {
                        Logger?.debug(`keepAlive: ${keepAliveFailCount} quick disconnects, stopping retries`);
                        return;
                    }
                }

                keepAliveRetryDelay = Math.min(keepAliveRetryDelay * 2, 5000);
                scheduleKeepaliveReconnect(document.hidden ? 3000 : keepAliveRetryDelay);
            });
        } catch {
            keepAliveFailCount++;
            if (keepAliveFailCount >= KEEPALIVE_MAX_FAILS) {
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
