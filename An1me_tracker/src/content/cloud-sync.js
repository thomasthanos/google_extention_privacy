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
    let startListeningInFlight = false;
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

    // Singleflight: coalesce concurrent refresh calls so we don't burn refresh
    // tokens or race each other when several code paths need a fresh id token.
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
                    idToken:      data.id_token,
                    refreshToken: data.refresh_token,
                    expiresAt:    Date.now() + parseInt(data.expires_in) * 1000
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

    // ─── Cloud document cache ────────────────────────────────────────────────
    // The SSE stream already pushes cloud updates to us, so the cloud state
    // we last saw is a reliable "current" snapshot. Caching it lets us skip a
    // per-push GET on every progress flush.
    let _cloudDocCache     = null;
    let _cloudDocCacheTime = 0;
    let _lastAppliedCloudUpdatedAt = null;
    const _CLOUD_DOC_TTL   = 120000; // 2 min — SSE stream keeps us fresh, GET is just a fallback

    // Track our own recent writes so we can drop the SSE self-echo without
    // discarding legitimate updates from other devices with clock skew.
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

    // Filter out progress entries for episodes already tracked in animeData —
    // the background worker (cleanTrackedProgressBg) also does this, but doing
    // it here cuts payload size and also avoids pushing at all if the filtered
    // set equals what we already pushed.
    function filterTrackedFromProgress(videoProgress, animeData) {
        if (!videoProgress || !animeData) return videoProgress || {};
        const trackedIds = new Set();
        for (const [slug, anime] of Object.entries(animeData)) {
            if (anime?.episodes) {
                for (const ep of anime.episodes) trackedIds.add(`${slug}__episode-${ep.number}`);
            }
        }
        const out = {};
        for (const [id, p] of Object.entries(videoProgress)) {
            if (id === '__slugIndex') continue;
            if (trackedIds.has(id)) continue;
            if (p?.deleted) continue;
            out[id] = p;
        }
        return out;
    }

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
            const localSnapshot = await chrome.storage.local.get(['videoProgress', 'animeData']);
            const localAnimeData = localSnapshot.animeData || {};
            const filteredLocalVP = filterTrackedFromProgress(localSnapshot.videoProgress || {}, localAnimeData);
            const snapshot = JSON.stringify(filteredLocalVP);
            if (snapshot === lastPushedProgress) return;

            let cloudVP = {};
            if (!keepalive) {
                // Use cached cloud doc when fresh (avoids redundant GET on every push)
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
                const localCount  = Object.keys(latestLocal).length;
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

            // Second chance skip: if filtered merged equals last pushed, no work to do.
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
                    lastUpdated:   pushedAt
                })
            });
            const res = await fetch(`${url}?${updateMask}`, {
                method:  'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body,
                keepalive
            });

            if (res.ok) {
                lastPushedProgress = mergedSnap;
                lastPushAt = Date.now();
                // Update cloud cache optimistically so the next push doesn't re-GET
                if (_cloudDocCache) {
                    _cloudDocCache = { ..._cloudDocCache, videoProgress: mergedVP, lastUpdated: pushedAt };
                    _cloudDocCacheTime = Date.now();
                }
                _lastAppliedCloudUpdatedAt = pushedAt;
                rememberOwnWrite(pushedAt);
                Logger?.info('videoProgress pushed (merged)');
            } else {
                Logger?.warn(`Direct progress push failed: ${res.status}`);
                // Invalidate cache on server error — may be stale
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
                cloudData = await getCloudDocCached(token, user);
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

            const pushedAt = new Date().toISOString();
            const body = JSON.stringify({
                fields: toFSFields({
                    animeData:        mergedAnime,
                    videoProgress:    mergedProgress,
                    deletedAnime:     mergedDeleted,
                    groupCoverImages: mergedGroupCovers,
                    lastUpdated:      pushedAt,
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
                // Update cloud cache optimistically
                _cloudDocCache = {
                    ...(_cloudDocCache || {}),
                    animeData:        mergedAnime,
                    videoProgress:    mergedProgress,
                    deletedAnime:     mergedDeleted,
                    groupCoverImages: mergedGroupCovers,
                    lastUpdated:      pushedAt
                };
                _cloudDocCacheTime = Date.now();
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
    //
    // Progress writes fire every 15–30s while a video plays. A plain debounce
    // of 20s would reset on every write and never flush until the user paused,
    // so the popup on another device wouldn't see live updates. We keep the
    // trailing debounce but also enforce a max-wait ceiling: once the first
    // write is observed, we guarantee a push within `PROGRESS_MAX_WAIT_MS`
    // regardless of subsequent resets.

    let progressDebounce    = null;
    let progressMaxWaitTimer = null;
    const PROGRESS_MAX_WAIT_MS = 90000; // 90s cap — balances live cross-device sync vs Firestore write quota

    async function flushProgressPush() {
        if (progressDebounce)    { clearTimeout(progressDebounce);    progressDebounce = null; }
        if (progressMaxWaitTimer){ clearTimeout(progressMaxWaitTimer); progressMaxWaitTimer = null; }
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
        // Start the ceiling on the first observed write; don't reset it on
        // subsequent calls so that continuous playback still flushes regularly.
        if (!progressMaxWaitTimer) {
            progressMaxWaitTimer = setTimeout(() => {
                progressMaxWaitTimer = null;
                flushProgressPush();
            }, PROGRESS_MAX_WAIT_MS);
        }
    }

    // ─── Debounced full push (Orion path) ─────────────────────────────────────

    let fullPushDebounce     = null;
    let fullPushMaxWaitTimer = null;
    const FULL_PUSH_MAX_WAIT_MS = 25000;

    function scheduleFullPush(delay = 2500) {
        if (fullPushDebounce) clearTimeout(fullPushDebounce);
        fullPushDebounce = setTimeout(() => {
            fullPushDebounce = null;
            if (fullPushMaxWaitTimer) { clearTimeout(fullPushMaxWaitTimer); fullPushMaxWaitTimer = null; }
            pushFullDirect();
        }, delay);
        // Ceiling so continuous progress activity in Orion mode still flushes
        if (!fullPushMaxWaitTimer) {
            fullPushMaxWaitTimer = setTimeout(() => {
                fullPushMaxWaitTimer = null;
                if (fullPushDebounce) { clearTimeout(fullPushDebounce); fullPushDebounce = null; }
                pushFullDirect();
            }, FULL_PUSH_MAX_WAIT_MS);
        }
    }

    // ─── Periodic forced push ─────────────────────────────────────────────────
    // The debounce pattern avoids excessive cloud writes while playback is active.
    // A periodic push still guarantees progress reaches the cloud reliably.
    const PERIODIC_PUSH_INTERVAL = 120000; // 2 min — storage.onChanged already schedules pushes; this is a fallback
    let periodicPushTimer = null;
    let lastPushAt = 0;
    // Tracks what was on disk at the last periodic tick, so we can skip the
    // push entirely when the user is idle (paused tab, nothing changed).
    let _lastIdleSnapshot = null;

    async function _currentLocalProgressSnapshot(isOrionMode) {
        // Cheap hashable snapshot. Full-mode also includes animeData/deleted.
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

            // Idle guard: if nothing changed on disk since the previous tick,
            // skip the push entirely — no SW wake-up, no fetch, no PATCH.
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
            // Use keepalive so the request survives page unload on mobile
            pushFullDirect({ keepalive: true });
            return;
        }

        if (progressDebounce)    { clearTimeout(progressDebounce);    progressDebounce = null; }
        if (progressMaxWaitTimer){ clearTimeout(progressMaxWaitTimer); progressMaxWaitTimer = null; }
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
        const cloudUpdatedAt = cloudDoc.lastUpdated || null;
        if (cloudUpdatedAt && isOwnEcho(cloudUpdatedAt)) {
            Logger?.debug(`Ignoring own-echo cloud update (${cloudUpdatedAt})`);
            return;
        }
        // Refresh cloud cache from the stream — always current by definition
        _cloudDocCache = cloudDoc;
        _cloudDocCacheTime = Date.now();
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
            if (cloudUpdatedAt) _lastAppliedCloudUpdatedAt = cloudUpdatedAt;
        } catch (e) {
            Logger?.warn(`Apply cloud update failed: ${e.message}`);
        }
    }

    // ─── Firestore SSE stream (Orion / no-SW mode) ────────────────────────────

    async function startListening() {
        // Concurrent-call guard: if another startListening() is already in the
        // middle of opening/streaming, don't spawn a parallel stream.
        if (startListeningInFlight) {
            Logger?.debug('startListening: already in flight, skip');
            return;
        }
        startListeningInFlight = true;

        if (listenAbortCtrl) listenAbortCtrl.abort();
        listenAbortCtrl = new AbortController();

        const token = await getValidToken();
        const user  = currentUser || await getUser();
        if (!token || !user) { startListeningInFlight = false; scheduleReconnect(10000); return; }

        currentToken = token;
        currentUser  = user;

        const docPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${user.uid}`;
        let tokenRefreshInterval = null;
        const streamOpenedAt = Date.now();

        try {
            const res = await fetch(`${LISTEN_URL}?key=${FIREBASE_API_KEY}`, {
                method:  'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body:    JSON.stringify({ addTarget: { documents: { documents: [docPath] }, targetId: 1 } }),
                signal:  listenAbortCtrl.signal
            });

            if (!res.ok) { scheduleReconnect(); return; }

            // Don't reset reconnectDelay yet — a 200 response doesn't mean the
            // stream will stay open. Reset in the `finally` block only if the
            // stream survived long enough to be a real success.
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
            if (e.name === 'AbortError') { startListeningInFlight = false; return; }
            Logger?.warn(`Stream error: ${e.message}`);
        } finally {
            if (tokenRefreshInterval) {
                clearInterval(tokenRefreshInterval);
                tokenRefreshInterval = null;
            }
            // Only reset backoff if the stream actually stayed alive ≥15s —
            // otherwise an immediate-close stream would keep looking like
            // a success and cause tight reconnect loops.
            if (Date.now() - streamOpenedAt >= 15000) {
                reconnectDelay = 5000;
            }
            startListeningInFlight = false;
        }
        scheduleReconnect();
    }

    function scheduleReconnect(delay) {
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        // Floor at 5s so we never hammer the network (mobile battery saver).
        const d = Math.max(5000, delay ?? reconnectDelay);
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
                    scheduleProgressPush(60000);
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
            scheduleProgressPush(10000);
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
            const connectedAt = Date.now();
            keepAlivePort = port;
            keepAliveRetryDelay = 100;
            // NOTE: do NOT reset keepAliveFailCount here — a successful connect()
            // call doesn't guarantee the port stayed alive. Reset only after the
            // port survives for a meaningful interval (see pulse timer below).

            keepAlivePulseTimer = setTimeout(() => {
                keepAlivePulseTimer = null;
                // Port survived long enough → real success, clear fail counter.
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

                // Immediate disconnects (< 2s after connect) count as failures,
                // otherwise we'd burn CPU/battery retrying forever on envs where
                // the SW is unreachable (e.g. mobile after aggressive suspend).
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
