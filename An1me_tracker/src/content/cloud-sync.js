(function () {
    'use strict';

    // Shared config — populated by firebase-config.js (loaded earlier in the
    // content_scripts list). If absent we log loudly and disable sync rather
    // than silently 401-ing every request.
    const _firebaseConfig = (typeof globalThis !== 'undefined' && globalThis.firebaseConfig)
        || (typeof window !== 'undefined' && window.firebaseConfig)
        || null;
    if (!_firebaseConfig) {
        console.error('[CS-CloudSync] Firebase config not loaded — sync disabled');
    }
    const FIREBASE_API_KEY = _firebaseConfig?.apiKey || '';
    const FIREBASE_PROJECT_ID = _firebaseConfig?.projectId || '';
    const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)`;
    // Orion / Safari fallback polling — kept in sync with the BG service
    // worker constant (background.js: CLOUD_POLL_INTERVAL_MS). 3 min keeps
    // cross-device sync responsive without burning Firestore reads.
    const CLOUD_POLL_INTERVAL_MS = 180000;
    // Keep videoProgress tombstones (`deleted:true`) for this long so cross-device
    // deletions propagate. Mirrors PROGRESS_TOMBSTONE_KEEP_MS in background.js.
    const PROGRESS_TOMBSTONE_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

    const Logger = window.AnimeTrackerContent?.Logger;

    let initialized = false;
    let currentToken = null;
    let currentUser = null;
    let lastCloudPollAt = 0;
    let pollInFlight = null;
    let teardownSyncTriggered = false;
    let cloudPollingTimer = null;

    // Returns a multiplier for periodic-sync intervals. Stretches them when
    // the user is on a slow / metered connection so we don't hammer mobile
    // data plans with a 3-min poll on EDGE. The factor is applied as a
    // tick-time gate inside the interval handler — the timer itself keeps
    // running so we re-evaluate the network state every base period (the
    // user's connection may change while the page is open).
    //
    // Browsers without the Network Information API (Safari, Firefox until
    // recently) fall back to factor 1 — same as before.
    function _networkExtensionFactor() {
        try {
            const conn = navigator.connection
                || navigator.mozConnection
                || navigator.webkitConnection;
            if (!conn) return 1;
            if (conn.saveData) return 3;
            const eff = conn.effectiveType;
            if (eff === 'slow-2g' || eff === '2g') return 4;
            if (eff === '3g') return 2;
            return 1;
        } catch { return 1; }
    }

    let csSyncPausedUntil = 0;
    function csPauseSync(ms = 4000) {
        csSyncPausedUntil = Math.max(csSyncPausedUntil, Date.now() + ms);
    }
    function csIsSyncPaused() {
        return Date.now() < csSyncPausedUntil;
    }

    function stripFirebaseSilentAnimeMetadata(anime) {
        if (!anime || typeof anime !== 'object') return anime;
        const copy = { ...anime };
        delete copy.coverImage;
        delete copy.siteAnimeId;
        delete copy.totalEpisodes;
        delete copy.latestEpisode;
        delete copy.nextEpisodeAt;
        delete copy.nextEpisodeTimezone;
        delete copy.durationSeconds;
        delete copy.totalWatchTime;

        if (Array.isArray(copy.episodes)) {
            copy.episodes = copy.episodes.map((episode) => {
                if (!episode || typeof episode !== 'object') return episode;
                const epCopy = { ...episode };
                delete epCopy.duration;
                delete epCopy.durationSource;
                return epCopy;
            });
        }

        return copy;
    }

    function areAnimeDataEqualIgnoringFetchMetadata(oldAnime = {}, newAnime = {}) {
        const oldKeys = Object.keys(oldAnime || {}).sort();
        const newKeys = Object.keys(newAnime || {}).sort();
        if (oldKeys.length !== newKeys.length) return false;
        for (let i = 0; i < oldKeys.length; i++) {
            if (oldKeys[i] !== newKeys[i]) return false;
            const key = oldKeys[i];
            if (JSON.stringify(stripFirebaseSilentAnimeMetadata(oldAnime[key])) !==
                JSON.stringify(stripFirebaseSilentAnimeMetadata(newAnime[key]))) {
                return false;
            }
        }
        return true;
    }

    async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
        if (options?.keepalive) return fetch(url, options);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            return await fetch(url, { ...options, signal: ctrl.signal });
        } finally {
            clearTimeout(timer);
        }
    }

    // Firestore JSON codec lives in src/common/firestore-codec.js (loaded
    // before this file via the watch-page content_scripts list). Thin local
    // aliases keep the existing call sites unchanged. If the shared module
    // ever fails to load we surface it loudly instead of silently producing
    // null payloads.
    const _fsCodec = globalThis.AnimeTrackerFirestoreCodec;
    if (!_fsCodec) {
        console.error('[CS-CloudSync] Firestore codec not loaded — sync disabled');
    }
    const toFSFields = _fsCodec ? _fsCodec.encodeFields : (() => ({}));
    const fromFSDoc = _fsCodec ? _fsCodec.decodeDoc : (() => null);

    async function signOutDueToTokenFailure() {
        Logger?.warn('Token refresh failed — signing out to force re-auth');
        try {
            await chrome.storage.local.remove(['firebase_tokens', 'firebase_user']);
        } catch (e) {
            Logger?.warn(`Failed to clear auth storage during sign-out: ${e.message}`);
        }
        stopCloudPolling();
        currentToken = null;
        currentUser = null;
        // Drop any cached cloud doc — must not survive across an account
        // change that follows a token failure (would otherwise leak data
        // from the previous account into the next one's first read).
        invalidateCloudDocCache();
    }

    let _refreshInflight = null;

    // Permanent refresh-error codes — only these trigger sign-out.
    // Mirrors PERMANENT_REFRESH_ERRORS in popup firebase-lib.js + BG.
    const _CS_PERMANENT_REFRESH_ERRORS = [
        'INVALID_REFRESH_TOKEN',
        'TOKEN_EXPIRED',
        'USER_DISABLED',
        'USER_NOT_FOUND',
        'INVALID_GRANT',
        'invalid_grant',
        'CREDENTIAL_TOO_OLD_LOGIN_AGAIN',
        'MISSING_REFRESH_TOKEN',
    ];

    function _csClassifyRefreshError(httpStatus, errorBody) {
        if (httpStatus === 401 || httpStatus === 403) return true;
        if (httpStatus === 400 && errorBody) {
            for (const code of _CS_PERMANENT_REFRESH_ERRORS) {
                if (errorBody.includes(code)) return true;
            }
        }
        return false;
    }

    async function refreshToken(rt) {
        if (_refreshInflight) return _refreshInflight;
        _refreshInflight = (async () => {
            let res;
            try {
                res = await fetchWithTimeout(
                    `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: rt })
                    }
                );
            } catch (networkErr) {
                // Network error = transient.
                return { idToken: null, permanent: false, error: `network: ${networkErr?.message || networkErr}` };
            }
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                const permanent = _csClassifyRefreshError(res.status, body);
                return { idToken: null, permanent, error: `HTTP ${res.status}` };
            }
            let data;
            try { data = await res.json(); } catch { data = null; }
            if (!data) return { idToken: null, permanent: false, error: 'empty_body' };
            if (data.error) {
                const msg = data.error?.message || 'unknown';
                const permanent = _csClassifyRefreshError(400, msg);
                return { idToken: null, permanent, error: msg };
            }
            if (!data.id_token || !data.refresh_token || !data.expires_in) {
                return { idToken: null, permanent: false, error: 'missing_fields' };
            }
            const tokens = {
                idToken: data.id_token,
                refreshToken: data.refresh_token,
                expiresAt: Date.now() + parseInt(data.expires_in) * 1000
            };
            try { await chrome.storage.local.set({ firebase_tokens: tokens }); } catch (e) {
                Logger?.warn(`Failed to persist refreshed token: ${e.message}`);
            }
            return { idToken: tokens.idToken, permanent: false, error: null };
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
                const result = await refreshToken(t.refreshToken);
                if (result?.idToken) return result.idToken;
                // Refresh failed. Permanent → sign out. Transient → fall back
                // to existing token if still valid; otherwise return null but
                // keep session for next attempt.
                if (result?.permanent) {
                    await signOutDueToTokenFailure();
                    return null;
                }
                if (t.expiresAt > Date.now() + 30000) {
                    Logger?.warn?.(`Token refresh transient failure (${result?.error}); using existing token`);
                    return t.idToken;
                }
                Logger?.warn?.(`Token refresh transient failure (${result?.error}) and existing token expired; keeping session`);
                return null;
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
    } = (window.AnimeTrackerContent.MergeUtils || globalThis.AnimeTrackerMergeUtils);

    let lastPushedProgress = null;
    let isPushingProgressDirect = false;
    let progressPushPending = false;

    let _cloudDocCache = null;
    let _cloudDocCacheTime = 0;
    let _cloudDocCacheUid = null;
    const _CLOUD_DOC_TTL = 120000;

    const _CS_RECENT_OWN_WRITES_KEY = '_csRecentOwnWrites';
    const _CS_OWN_WRITE_PERSIST_TTL_MS = 60 * 1000;

    const _recentOwnWrites = [];
    const _MAX_RECENT_OWN_WRITES = 20;
    function rememberOwnWrite(ts) {
        if (!ts) return;
        _recentOwnWrites.push(ts);
        if (_recentOwnWrites.length > _MAX_RECENT_OWN_WRITES) _recentOwnWrites.shift();
        persistOwnWrites();
    }
    function isOwnEcho(ts) {
        return !!ts && _recentOwnWrites.includes(ts);
    }

    function persistOwnWrites() {
        try {
            const now = Date.now();
            const payload = _recentOwnWrites.map((ts) => ({ ts, at: now }));
            chrome.storage.local.set({ [_CS_RECENT_OWN_WRITES_KEY]: payload }, () => {
                void chrome.runtime.lastError;
            });
        } catch { /* best-effort */ }
    }

    let _csHydrationPromise = null;
    function hydrateCsEchoState() {
        if (_csHydrationPromise) return _csHydrationPromise;
        _csHydrationPromise = new Promise((resolve) => {
            try {
                chrome.storage.local.get(
                    [_CS_RECENT_OWN_WRITES_KEY],
                    (stored) => {
                        try {
                            if (chrome.runtime.lastError) { resolve(); return; }
                            const persisted = stored?.[_CS_RECENT_OWN_WRITES_KEY];
                            if (Array.isArray(persisted)) {
                                const now = Date.now();
                                let stalePruned = false;
                                _recentOwnWrites.length = 0;
                                for (const entry of persisted) {
                                    const ts = typeof entry === 'string' ? entry : entry?.ts;
                                    const at = typeof entry === 'object' ? Number(entry?.at) || 0 : 0;
                                    if (!ts) continue;
                                    if (at && (now - at) > _CS_OWN_WRITE_PERSIST_TTL_MS) {
                                        stalePruned = true;
                                        continue;
                                    }
                                    _recentOwnWrites.push(ts);
                                }
                                if (stalePruned) persistOwnWrites();
                            }
                        } finally {
                            resolve();
                        }
                    }
                );
            } catch { resolve(); }
        });
        return _csHydrationPromise;
    }

    function invalidateCloudDocCache() {
        _cloudDocCache = null;
        _cloudDocCacheTime = 0;
        _cloudDocCacheUid = null;
    }

    function notifyBgInvalidateCloudDoc() {
        try {
            chrome.runtime.sendMessage({ type: 'INVALIDATE_BG_CLOUD_DOC_CACHE' }, () => {
                void chrome.runtime.lastError;
            });
        } catch { /* best-effort */ }
    }

    // Seed (rather than invalidate) the BG cloud-doc cache with the partial
    // we just PATCHed to Firestore. Net effect: −1 Firestore read per CS
    // write cycle (the next consumer-connected poll / GET_CLOUD_DOC sees a
    // cache hit instead of paying for a full re-fetch).
    //
    // `partial` is the exact subset of fields we just sent (e.g.
    // { videoProgress, lastUpdated } for progress push, or the full bundle
    // for full push). uid is required so the BG handler can verify the
    // active user before overlaying onto its cache.
    function notifyBgSeedCloudDoc(uid, partial) {
        if (!uid || !partial) {
            // Defensive — fall back to invalidate so cache state stays correct.
            return notifyBgInvalidateCloudDoc();
        }
        try {
            chrome.runtime.sendMessage(
                { type: 'UPDATE_BG_CLOUD_DOC_PARTIAL', uid, partial },
                () => { void chrome.runtime.lastError; }
            );
        } catch { /* best-effort */ }
    }

    async function getCloudDocCached(token, user) {
        const now = Date.now();
        // uid guard — never serve another user's cached doc, even if the
        // in-memory copy is still inside the TTL window. Without this, a
        // signed-out → signed-in-as-other flow inside the TTL window could
        // leak account A's library into account B's merge path.
        if (
            _cloudDocCache &&
            _cloudDocCacheUid === user.uid &&
            (now - _cloudDocCacheTime) < _CLOUD_DOC_TTL
        ) {
            return _cloudDocCache;
        }
        if (_cloudDocCache && _cloudDocCacheUid !== user.uid) {
            invalidateCloudDocCache();
        }
        const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
        try {
            const r = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
            if (!r.ok) return null;
            const doc = fromFSDoc(await r.json());
            _cloudDocCache = doc;
            _cloudDocCacheTime = Date.now();
            _cloudDocCacheUid = user.uid;
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
                const response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
                if (!response.ok) {
                    Logger?.warn(`Cloud poll failed (${reason}): ${response.status}`);
                    return null;
                }

                const cloudDoc = fromFSDoc(await response.json());
                // Bind the cache to the uid the response was fetched for —
                // and re-confirm against the currently-stored firebase_user
                // so an account swap mid-poll doesn't tag the cache wrong.
                const activeNow = await getUser();
                if (!activeNow?.uid || activeNow.uid !== user.uid) {
                    invalidateCloudDocCache();
                    return null;
                }
                _cloudDocCache = cloudDoc;
                _cloudDocCacheTime = Date.now();
                _cloudDocCacheUid = user.uid;
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
                for (const ep of anime.episodes) {
                    // AniList-imported episodes without a real watchedAt are
                    // not "truly" tracked — keep videoProgress for resume.
                    if (ep?.durationSource === 'anilist' && !ep?.watchedAt) continue;
                    trackedIds.add(`${slug}__episode-${ep.number}`);
                }
            }
        }
        const out = {};
        const now = Date.now();
        for (const [id, p] of Object.entries(baseProgress)) {
            if (id === '__slugIndex') continue;
            if (trackedIds.has(id)) continue;
            if (p?.deleted) {
                // Keep recent tombstones so they propagate cross-device.
                const deletedAt = p.deletedAt ? new Date(p.deletedAt).getTime() : 0;
                if (deletedAt && (now - deletedAt) < PROGRESS_TOMBSTONE_KEEP_MS) {
                    out[id] = p;
                }
                continue;
            }
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
                if (num <= 0) continue;
                // AniList-imported episodes without a real watchedAt are not
                // "truly" tracked — keep their videoProgress for resume.
                if (ep?.durationSource === 'anilist' && !ep?.watchedAt) continue;
                trackedIds.add(`${slug}__episode-${num}`);
            }
        }

        const completedPct = window.AnimeTrackerContent?.CONFIG?.COMPLETED_PERCENTAGE || 85;
        const cleaned = {};
        const now = Date.now();

        for (const [id, progress] of Object.entries(baseProgress)) {
            if (!progress) continue;
            if (progress.deleted) {
                // Keep recent tombstones so they propagate cross-device.
                const deletedAt = progress.deletedAt ? new Date(progress.deletedAt).getTime() : 0;
                if (deletedAt && (now - deletedAt) < PROGRESS_TOMBSTONE_KEEP_MS) {
                    cleaned[id] = progress;
                }
                continue;
            }
            if (trackedIds.has(id)) continue;
            if ((Number(progress.percentage) || 0) >= completedPct) continue;
            cleaned[id] = progress;
        }

        return cleaned;
    }

    // Cross-function lock: pushProgressDirect and pushFullDirect would
    // otherwise race because each only checks its own in-progress flag, so
    // both can fire PATCH requests with overlapping field masks (videoProgress
    // appears in both) and clobber each other. Keepalive writes (page-unload)
    // bypass the wait — we accept the small overlap risk to ensure they flush.
    let _csCloudWriteBusy = false;
    async function _csWaitForCloudWrite() {
        while (_csCloudWriteBusy) {
            await new Promise(r => setTimeout(r, 50));
        }
    }

    // Holds a deep-cloned snapshot of the last successfully pushed videoProgress
    // map so we can compare via `areProgressMapsEqual` instead of stringifying
    // every push. For a heavy library (5000+ progress entries) the old
    // `JSON.stringify(...) === lastPushedProgress` pattern cost ~10–30ms of
    // serialization per call; the structural equality check costs ~5ms.
    // `lastPushedProgress` is declared at module scope above (let).
    function snapshotForCompare(value) {
        try {
            if (typeof structuredClone === 'function') return structuredClone(value);
        } catch { /* fall through to JSON clone */ }
        try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
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
        if (!keepalive) await _csWaitForCloudWrite();
        if (!keepalive) _csCloudWriteBusy = true;

        try {
            const localSnapshot = await chrome.storage.local.get(['videoProgress', 'animeData', 'deletedAnime']);
            const localAnimeData = localSnapshot.animeData || {};
            const filteredLocalVP = filterTrackedFromProgress(
                localSnapshot.videoProgress || {},
                localAnimeData,
                localSnapshot.deletedAnime || {}
            );
            if (lastPushedProgress && areProgressMapsEqual(filteredLocalVP, lastPushedProgress)) {
                return;
            }

            let cloudVP = {};
            if (!keepalive) {
                const cached = await getCloudDocCached(token, user);
                cloudVP = cached?.videoProgress || {};
            }

            const latestLocalFull = keepalive
                ? (localSnapshot.videoProgress || {})
                : ((await chrome.storage.local.get(['videoProgress'])).videoProgress || {});
            const latestLocal = filterTrackedFromProgress(latestLocalFull, localAnimeData);
            // The user kept writing while we were preparing the payload —
            // schedule a follow-up push so we don't drop the late writes.
            if (!keepalive && !areProgressMapsEqual(latestLocal, filteredLocalVP)) {
                progressPushPending = true;
            }

            const mergedVP = mergeVideoProgress(latestLocal, cloudVP);

            if (!keepalive) {
                const localCount = Object.keys(latestLocal).length;
                const mergedCount = Object.keys(mergedVP).length;
                if (mergedCount > localCount) {
                    csPauseSync();
                    try {
                        const fullLocal = (await chrome.storage.local.get(['videoProgress'])).videoProgress || {};
                        await chrome.storage.local.set({ videoProgress: { ...fullLocal, ...mergedVP } });
                        Logger?.info(`Pulled ${mergedCount - localCount} new progress entries from cloud`);
                    } catch (e) {
                        Logger?.warn(`Failed to merge pulled progress locally: ${e.message}`);
                    }
                }
            }

            if (lastPushedProgress && areProgressMapsEqual(mergedVP, lastPushedProgress)) {
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
            const res = await fetchWithTimeout(`${url}?${updateMask}`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body,
                keepalive
            });

            if (res.ok) {
                // Keep the snapshot we just pushed for the next equality check.
                // structuredClone instead of holding the live ref so subsequent
                // mutations don't corrupt our "what did we last send?" record.
                lastPushedProgress = snapshotForCompare(mergedVP);
                lastPushAt = Date.now();
                invalidateCloudDocCache();
                // Seed BG cache (saves 1 Firestore read on next consumer wake).
                notifyBgSeedCloudDoc(user.uid, { videoProgress: mergedVP, lastUpdated: pushedAt });
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
            if (!keepalive) _csCloudWriteBusy = false;
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
    // Structural snapshot of what we last successfully pushed. Was a single
    // stringified JSON blob (lazy equality); now four refs against which the
    // next push compares with the merge-utils equality fns. Cheaper and
    // doesn't hold a large string in memory for the whole session.
    let lastPushedFull = null; // { animeData, videoProgress, deletedAnime, groupCoverImages } | null

    function _localPayloadsEqual(a, b) {
        return areAnimeDataMapsEqual(a.animeData || {}, b.animeData || {})
            && areProgressMapsEqual(a.videoProgress || {}, b.videoProgress || {})
            && shallowEqualDeletedAnime(a.deletedAnime || {}, b.deletedAnime || {})
            && shallowEqualObjectMap(a.groupCoverImages || {}, b.groupCoverImages || {});
    }

    async function pushFullDirect(options = {}) {
        const { keepalive = false } = options;
        if (fullPushInProgress && !keepalive) { fullPushPending = true; return; }
        const token = await getValidToken();
        const user = currentUser || await getUser();
        if (!token || !user) return;

        fullPushInProgress = true;
        if (!keepalive) await _csWaitForCloudWrite();
        if (!keepalive) _csCloudWriteBusy = true;
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
            // Drift detection between the two reads above — if storage changed
            // mid-flight, schedule a follow-up push. Was `JSON.stringify(local)
            // !== JSON.stringify(localSnapshot)` which paid 2× serialization
            // for the entire local library every push. Per-field structural
            // equality is dramatically cheaper for big libraries.
            if (!keepalive && !_localPayloadsEqual(local, localSnapshot)) {
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

            const mergedBundle = {
                animeData: mergedAnime,
                videoProgress: mergedProgress,
                deletedAnime: mergedDeleted,
                groupCoverImages: mergedGroupCovers
            };
            if (lastPushedFull && _localPayloadsEqual(mergedBundle, lastPushedFull)) {
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

            // updateMask scopes the PATCH to the fields we manage from the
            // content script. Without it, Firestore replaces the document and
            // wipes popup-only fields (goalSettings, badgeUnlocks).
            const fullMask = ['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages', 'lastUpdated', 'email']
                .map(f => `updateMask.fieldPaths=${f}`).join('&');

            const res = await fetchWithTimeout(`${url}?${fullMask}`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body,
                keepalive: useKeepalive
            });

            if (res.ok) {
                // Clone the merged bundle so subsequent mutations don't poison
                // our "what did we last push?" record.
                lastPushedFull = snapshotForCompare(mergedBundle);
                lastPushAt = Date.now();
                invalidateCloudDocCache();
                notifyBgSeedCloudDoc(user.uid, {
                    animeData: mergedAnime,
                    videoProgress: mergedProgress,
                    deletedAnime: mergedDeleted,
                    groupCoverImages: mergedGroupCovers,
                    lastUpdated: pushedAt,
                    email: user.email
                });
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
            if (!keepalive) _csCloudWriteBusy = false;
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
    // Last snapshot used by the idle-skip check. Was a JSON.stringify string
    // (held in memory for the whole session — hundreds of KB for big libs);
    // now a structured snapshot compared via the merge-utils equality fns,
    // which is both faster per tick and avoids the long-lived string buffer.
    let _lastIdleSnapshot = null;

    async function _currentLocalProgressSnapshot(isOrionMode) {
        try {
            const keys = isOrionMode
                ? ['videoProgress', 'animeData', 'deletedAnime', 'groupCoverImages']
                : ['videoProgress'];
            const r = await chrome.storage.local.get(keys);
            return r || null;
        } catch { return null; }
    }

    function _idleSnapshotsEqual(a, b) {
        if (!a || !b) return false;
        // Orion mode reads all 4 keys; SW mode reads only videoProgress.
        if (!areProgressMapsEqual(a.videoProgress || {}, b.videoProgress || {})) return false;
        if (!areAnimeDataMapsEqual(a.animeData || {}, b.animeData || {})) return false;
        if (!shallowEqualDeletedAnime(a.deletedAnime || {}, b.deletedAnime || {})) return false;
        if (!shallowEqualObjectMap(a.groupCoverImages || {}, b.groupCoverImages || {})) return false;
        return true;
    }

    function startPeriodicPush(isOrionMode) {
        if (periodicPushTimer) return;
        periodicPushTimer = setInterval(async () => {
            if (csIsSyncPaused()) return;
            // Slow / metered connection — stretch the tick gate so 2g and
            // saveData users don't pay for a push every 5 min when nothing
            // important is happening.
            const factor = _networkExtensionFactor();
            const minGap = PERIODIC_PUSH_INTERVAL * 0.8 * factor;
            if (Date.now() - lastPushAt < minGap) return;

            const snap = await _currentLocalProgressSnapshot(isOrionMode);
            if (snap && _idleSnapshotsEqual(snap, _lastIdleSnapshot)) {
                Logger?.debug('Periodic push skipped (idle — no local changes)');
                return;
            }
            _lastIdleSnapshot = snap ? snapshotForCompare(snap) : null;

            if (isOrionMode) {
                pushFullDirect()
                    .then(() => { lastPushAt = Date.now(); })
                    .catch((e) => { Logger?.warn('Periodic pushFullDirect failed', e); });
            } else {
                const swAlive = await wakeBackgroundSW('SYNC_PROGRESS_ONLY');
                if (!swAlive) {
                    pushProgressDirect()
                        .then(() => { lastPushAt = Date.now(); })
                        .catch((e) => { Logger?.warn('Periodic pushProgressDirect failed', e); });
                } else {
                    lastPushAt = Date.now();
                }
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
        // Re-confirm the active user before applying — guards against an
        // account swap that happened between fetch and apply.
        const activeUser = await getUser();
        if (!activeUser?.uid) {
            invalidateCloudDocCache();
            return;
        }
        if (_cloudDocCacheUid && _cloudDocCacheUid !== activeUser.uid) {
            invalidateCloudDocCache();
        }
        _cloudDocCache = cloudDoc;
        _cloudDocCacheTime = Date.now();
        _cloudDocCacheUid = activeUser.uid;
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
        } catch (e) {
            Logger?.warn(`Apply cloud update failed: ${e.message}`);
        }
    }

    // Orion-mode cloud polling. Replaces the old Firestore documents:listen
    // SSE stream — that path required gRPC and never opened over plain fetch
    // (UNIMPLEMENTED on first byte). Plain polling on CLOUD_POLL_INTERVAL_MS
    // is the supported fallback and what the SW already uses.
    async function startCloudPolling() {
        if (cloudPollingTimer) return;

        const tick = async () => {
            try {
                // Skip this tick if the network is metered/slow and we already
                // polled within an extended window. The base interval still
                // fires at CLOUD_POLL_INTERVAL_MS so the user sees fresh data
                // promptly when their connection improves.
                const factor = _networkExtensionFactor();
                if (factor > 1 && (Date.now() - lastCloudPollAt) < CLOUD_POLL_INTERVAL_MS * factor) {
                    return;
                }
                const token = await getValidToken();
                const user = currentUser || await getUser();
                if (!token || !user) return;
                currentToken = token;
                currentUser = user;
                await pollCloudDoc(token, user, 'periodic');
            } catch (e) {
                Logger?.debug(`Cloud poll tick failed: ${e?.message || e}`);
            }
        };

        // Fire one immediate poll so the page lands on fresh data without
        // waiting CLOUD_POLL_INTERVAL_MS.
        tick();
        cloudPollingTimer = setInterval(tick, CLOUD_POLL_INTERVAL_MS);
    }

    function stopCloudPolling() {
        if (cloudPollingTimer) {
            clearInterval(cloudPollingTimer);
            cloudPollingTimer = null;
        }
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
                const libraryChanged = !areAnimeDataEqualIgnoringFetchMetadata(oldAnime, newAnime);

                if (newCount > oldCount || libraryChanged) {
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
                if (isOrionMode) {
                    scheduleFullPush(1500);
                } else {
                    // SW-mode: the BG service worker has its own storage.onChanged
                    // listener that debounces and writes to Firestore. Just wake it
                    // up — don't issue a CS-side push, that produced duplicate writes
                    // (BG debounce 5s vs CS direct 500ms could race within the
                    // pauseSync window). The fallback `pushFullDirect()` only fires
                    // if the SW failed to respond, so we don't lose the change in
                    // the rare SW-dead case.
                    wakeBackgroundSW('SYNC_TO_FIREBASE').then((alive) => {
                        if (!alive) pushFullDirect();
                    });
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

        // Restore echo-tracking state from storage before any sync work —
        // otherwise a freshly-mounted content script (page reload) loses
        // `_recentOwnWrites` and treats our just-pushed timestamp as foreign.
        await hydrateCsEchoState();

        currentUser = await getUser();
        if (!currentUser) {
            // Late sign-in is handled by the storage.onChanged listener
            // wired up below — that re-runs init() the moment a
            // firebase_user appears, without requiring a page reload.
            Logger?.debug('No user, deferring init until firebase_user appears');
            return;
        }

        const swAvailable = await wakeBackgroundSW('GET_VERSION');

        if (swAvailable) {
            Logger?.debug('SW available — acting as wake-up agent');
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
        startCloudPolling();
        scheduleFullPush(4000);

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                stopCloudPolling();
            } else {
                startCloudPolling();
            }
        });

        const orionTokenRefreshTimer = setInterval(async () => {
            const newToken = await getValidToken();
            if (newToken && newToken !== currentToken) {
                currentToken = newToken;
            }
        }, 50 * 60 * 1000);

        let orionTeardownRan = false;
        const orionTeardown = () => {
            if (orionTeardownRan) return;
            orionTeardownRan = true;
            clearInterval(orionTokenRefreshTimer);
            stopCloudPolling();
            pushOnTeardown(true);
        };
        window.addEventListener('beforeunload', orionTeardown);
        window.addEventListener('pagehide', orionTeardown, { passive: true });
    }

    // Always-on auth-change watcher. Runs regardless of init state so that:
    //   1. A late sign-in (no firebase_user at script-load) triggers a
    //      deferred init() — otherwise the content script stays sync-disabled
    //      until the user reloads the page.
    //   2. A uid swap (sign-out → sign-in as different account) invalidates
    //      the cache eagerly so we don't merge account A's cloud doc into
    //      account B's local store within the cache TTL window.
    try {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local') return;
            if (!Object.prototype.hasOwnProperty.call(changes, 'firebase_user')) return;
            const newUser = changes.firebase_user?.newValue || null;
            const oldUid = changes.firebase_user?.oldValue?.uid || null;
            const newUid = newUser?.uid || null;
            if (newUid !== oldUid) {
                invalidateCloudDocCache();
                // Reset cached auth state so we don't issue requests under
                // the previous account's token after a swap or sign-out.
                currentToken = null;
                currentUser = newUser;
                if (!newUser) {
                    // Sign-out: stop polling immediately. The next tick of
                    // the auth-change handler (re-sign-in) will re-init.
                    stopCloudPolling();
                }
            }
            if (!initialized && newUser) {
                Logger?.info('Late sign-in detected — running deferred init()');
                init().catch((e) => Logger?.warn(`Deferred init failed: ${e?.message || e}`));
            }
        });
    } catch { /* chrome.storage.onChanged unavailable — non-fatal */ }

    setTimeout(init, 2000);

    window.AnimeTrackerContent = window.AnimeTrackerContent || {};
    window.AnimeTrackerContent.CloudSync = {
        pushKeepaliveWithPayload(payload) {
            try {
                const user = currentUser;
                const token = currentToken;
                if (!user || !token) return false;
                const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
                const pushedAt = new Date().toISOString();

                // Try the full payload first. Chrome enforces a per-request
                // ~64KB ceiling on `keepalive: true` fetches, so big libraries
                // hit the cap and the previous code silently returned false —
                // losing the unload save entirely.
                const fullBody = JSON.stringify({
                    fields: toFSFields({
                        animeData: payload.animeData || {},
                        videoProgress: payload.videoProgress || {},
                        deletedAnime: payload.deletedAnime || {},
                        groupCoverImages: payload.groupCoverImages || {},
                        lastUpdated: pushedAt,
                        email: user.email
                    })
                });
                if (fullBody.length < 63000) {
                    const fullMask = ['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages', 'lastUpdated', 'email']
                        .map(f => `updateMask.fieldPaths=${f}`).join('&');
                    fetch(`${url}?${fullMask}`, {
                        method: 'PATCH',
                        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: fullBody,
                        keepalive: true
                    }).then((res) => {
                        if (res.ok) {
                            notifyBgSeedCloudDoc(user.uid, {
                                animeData: payload.animeData || {},
                                videoProgress: payload.videoProgress || {},
                                deletedAnime: payload.deletedAnime || {},
                                groupCoverImages: payload.groupCoverImages || {},
                                lastUpdated: pushedAt,
                                email: user.email
                            });
                        }
                    }).catch(() => { });
                    return true;
                }

                // Body too big for keepalive — push videoProgress alone.
                // Progress is the field that actually changes per-watch and
                // is what we most want to preserve at unload. animeData /
                // deletedAnime / groupCoverImages will catch up via the
                // next BG poll once the user navigates back.
                const progressBody = JSON.stringify({
                    fields: toFSFields({
                        videoProgress: payload.videoProgress || {},
                        lastUpdated: pushedAt
                    })
                });
                if (progressBody.length >= 63000) {
                    // Still too big — videoProgress alone exceeds 63KB. Rare
                    // (would need ~500+ active episodes). Give up: better to
                    // surface than to fire a non-keepalive request that the
                    // browser will abort on unload.
                    Logger?.warn('Keepalive body too large — even videoProgress-only exceeds 63KB');
                    return false;
                }
                const progressMask = ['videoProgress', 'lastUpdated']
                    .map(f => `updateMask.fieldPaths=${f}`).join('&');
                fetch(`${url}?${progressMask}`, {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: progressBody,
                    keepalive: true
                }).then((res) => {
                    if (res.ok) {
                        notifyBgSeedCloudDoc(user.uid, {
                            videoProgress: payload.videoProgress || {},
                            lastUpdated: pushedAt
                        });
                    }
                }).catch(() => { });
                Logger?.info('Keepalive split: progress-only PATCH (full body > 63KB)');
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
