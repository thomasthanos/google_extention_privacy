// Load Firebase config + Firestore codec + merge utils. Single source of
// truth for API key/project lives in src/common/firebase-config.js (also
// loaded by the popup and content scripts via their respective entry points).
importScripts(
    'src/common/firebase-config.js',
    'src/background/aniskip.js',
    'src/background/filler-discovery.js',
    'src/background/an1me-scraper.js',
    'src/background/smart-notifications.js',
    'src/background/watchlist-sync.js',
    'src/background/metadata-repair.js'
);

const FIREBASE_API_KEY = (self.firebaseConfig && self.firebaseConfig.apiKey) || '';
const FIREBASE_PROJECT_ID = (self.firebaseConfig && self.firebaseConfig.projectId) || '';
if (!FIREBASE_API_KEY || !FIREBASE_PROJECT_ID) {
    console.error('[BG] Firebase config missing — Firestore I/O will fail');
}
const FIRESTORE_DATABASE = `projects/${FIREBASE_PROJECT_ID}/databases/(default)`;
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/${FIRESTORE_DATABASE}`;
const CLOUD_CONSUMER_POLL_MIN_GAP_MS = 3 * 60 * 1000;

importScripts('src/common/merge-utils.js', 'src/common/firestore-codec.js');

// AniList background sync — core engine (shared with the popup) + the SW-side
// driver that pushes progress without the popup being open. anilist-sync.js
// depends on AniListCore, so the order here matters.
importScripts('src/common/anilist-core.js', 'src/background/anilist-sync.js');

const sharedMergeUtils = self.AnimeTrackerMergeUtils || {};
const missingMergeUtil = (name) => () => {
    throw new Error(`[BG] Missing shared merge util: ${name}`);
};

const mergeVideoProgress = sharedMergeUtils.mergeVideoProgress || missingMergeUtil('mergeVideoProgress');
const mergeAnimeData = sharedMergeUtils.mergeAnimeData || missingMergeUtil('mergeAnimeData');
const mergeDeletedAnime = sharedMergeUtils.mergeDeletedAnime || missingMergeUtil('mergeDeletedAnime');
const pruneStaleDeletedAnime = sharedMergeUtils.pruneStaleDeletedAnime || missingMergeUtil('pruneStaleDeletedAnime');
const applyDeletedAnime = sharedMergeUtils.applyDeletedAnime || missingMergeUtil('applyDeletedAnime');
const removeDeletedProgress = sharedMergeUtils.removeDeletedProgress || missingMergeUtil('removeDeletedProgress');
const mergeGroupCoverImages = sharedMergeUtils.mergeGroupCoverImages || missingMergeUtil('mergeGroupCoverImages');
const areAnimeDataMapsEqual = sharedMergeUtils.areAnimeDataMapsEqual || missingMergeUtil('areAnimeDataMapsEqual');
const areProgressMapsEqual = sharedMergeUtils.areProgressMapsEqual || missingMergeUtil('areProgressMapsEqual');
const shallowEqualDeletedAnime = sharedMergeUtils.shallowEqualDeletedAnime || missingMergeUtil('shallowEqualDeletedAnime');
const shallowEqualObjectMap = sharedMergeUtils.shallowEqualObjectMap || missingMergeUtil('shallowEqualObjectMap');
const isLikelyMovieSlug = sharedMergeUtils.isLikelyMovieSlug || missingMergeUtil('isLikelyMovieSlug');
const isPlaceholderDuration = sharedMergeUtils.isPlaceholderDuration || missingMergeUtil('isPlaceholderDuration');

const BG_DEBUG = false;
const dlog = (...a) => { if (BG_DEBUG) console.log(...a); };
const ddebug = (...a) => { if (BG_DEBUG) console.debug(...a); };

const COMPLETED_PERCENTAGE = 85;
const DELETED_ANIME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PROGRESS_ENTRIES = 200;
// Keep videoProgress tombstones (`deleted:true`) for this long so cross-device
// deletions propagate even if the receiving device only syncs days later.
// Without the grace period, the SW's syncProgressOnly path stripped tombstones
// ~5 minutes after deletion, leaving the deletion to silently disappear.
const PROGRESS_TOMBSTONE_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

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
        const oldComparable = stripFirebaseSilentAnimeMetadata(oldAnime[key]);
        const newComparable = stripFirebaseSilentAnimeMetadata(newAnime[key]);
        if (JSON.stringify(oldComparable) !== JSON.stringify(newComparable)) {
            return false;
        }
    }
    return true;
}

// Survives SW kills: when a setTimeout(syncToFirebase, ...) is scheduled we
// stamp this key. If the SW is terminated before the timer fires, the next
// SW wake-up sees the stamp and flushes a sync immediately so the user's
// change isn't lost until they happen to reopen the popup.
const PENDING_SYNC_KEY = 'pendingSyncFlush';

function markSyncPending() {
    try { chrome.storage.local.set({ [PENDING_SYNC_KEY]: Date.now() }); } catch {}
}
function clearSyncPending() {
    try { chrome.storage.local.remove([PENDING_SYNC_KEY]); } catch {}
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

function cleanTrackedProgressBg(animeData, videoProgress, deletedAnime = {}) {
    if (!videoProgress || !animeData) return videoProgress;

    const baseProgress = removeDeletedProgress(videoProgress, deletedAnime);

    const trackedIds = new Set();
    for (const [slug, anime] of Object.entries(animeData)) {
        if (anime.episodes) {
            for (const ep of anime.episodes) {
                // AniList-imported episodes without a real watchedAt are not
                // "truly" tracked — keep their videoProgress so resume works.
                if (ep?.durationSource === 'anilist' && !ep?.watchedAt) continue;
                trackedIds.add(`${slug}__episode-${ep.number}`);
            }
        }
    }

    const trackedSlugs = new Set(Object.keys(animeData));
    const now = Date.now();
    const cleaned = {};
    for (const [id, progress] of Object.entries(baseProgress)) {
        if (id === '__slugIndex') continue;
        const isTracked = trackedIds.has(id);
        const isCompleted = (progress.percentage || 0) >= COMPLETED_PERCENTAGE;

        if (isTracked) continue;
        if (isCompleted) continue;
        if (progress.deleted) {
            // Keep recent tombstones so they propagate cross-device. Strip
            // only ones older than the keep window — those have had plenty
            // of time to reach every device.
            const deletedAt = progress.deletedAt ? new Date(progress.deletedAt).getTime() : 0;
            if (deletedAt && (now - deletedAt) < PROGRESS_TOMBSTONE_KEEP_MS) {
                cleaned[id] = progress;
            }
            continue;
        }

        if (progress.coverImage) {
            const slugMatch = id.match(/^(.+)__episode-\d+$/);
            if (slugMatch && trackedSlugs.has(slugMatch[1])) {
                const { coverImage, ...rest } = progress;
                cleaned[id] = rest;
                continue;
            }
        }

        cleaned[id] = progress;
    }

    const entries = Object.entries(cleaned);
    if (entries.length > MAX_PROGRESS_ENTRIES) {
        const getTs = (p) => {
            const t = p?.savedAt || p?.lastPlayedAt || 0;
            return t ? new Date(t).getTime() : 0;
        };
        entries.sort((a, b) => getTs(b[1]) - getTs(a[1]));
        const capped = {};
        for (let i = 0; i < MAX_PROGRESS_ENTRIES; i++) {
            capped[entries[i][0]] = entries[i][1];
        }
        return capped;
    }
    return cleaned;
}

function pruneDeletedAnime(deletedAnime) {
    if (!deletedAnime) return;
    const cutoff = Date.now() - DELETED_ANIME_MAX_AGE_MS;
    for (const slug of Object.keys(deletedAnime)) {
        const info = deletedAnime[slug];
        const deletedAt = +(new Date(info?.deletedAt || info || 0));
        if (deletedAt > 0 && deletedAt < cutoff) {
            delete deletedAnime[slug];
        }
    }
}

function bgStorageGet(keys) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(keys, (result) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(result);
            }
        });
    });
}

function bgStorageSet(data) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set(data, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve();
            }
        });
    });
}

function bgStorageRemove(keys) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.remove(keys, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve();
            }
        });
    });
}

// 5-min progress-sync debounce. Uses chrome.alarms instead of setTimeout so
// it survives MV3 service-worker kills (setTimeout >30s is unreliable in MV3).
// Metadata-repair alarm/constants live in src/background/metadata-repair.js.
const PROGRESS_SYNC_ALARM = 'progressSyncDebounce';

// Retry alarms for failed Firestore writes. Previously a 5xx / network error
// from syncToFirebase or syncProgressOnly logged + bailed, leaving
// `pendingSyncFlush` set but with no scheduled retry — the next change had to
// come along to wake the SW before another attempt would fire. These alarms
// run independently so a quiet user (e.g. closed laptop, then reopened with
// stale state) still gets the change pushed up.
const FULL_SYNC_RETRY_ALARM = 'fullSyncRetry';
const PROGRESS_SYNC_RETRY_ALARM = 'progressSyncRetry';
// Backoff schedule (in minutes) — 1 min → 5 min → 15 min, then capped.
// chrome.alarms clamps any delay < 1 min to 1 min in released extensions.
const SYNC_RETRY_BACKOFF_MIN = [1, 5, 15];
let _fullSyncRetryAttempts = 0;
let _progressSyncRetryAttempts = 0;
let _fullSyncRetryAuthAttempted = false;
let _progressSyncRetryAuthAttempted = false;

function _retryStateFor(kind) {
    if (kind === 'full') {
        return {
            getAttempts: () => _fullSyncRetryAttempts,
            incAttempts: () => { _fullSyncRetryAttempts++; },
            resetAttempts: () => { _fullSyncRetryAttempts = 0; _fullSyncRetryAuthAttempted = false; },
            getAuthAttempted: () => _fullSyncRetryAuthAttempted,
            setAuthAttempted: (v) => { _fullSyncRetryAuthAttempted = !!v; },
            alarmName: FULL_SYNC_RETRY_ALARM
        };
    }
    return {
        getAttempts: () => _progressSyncRetryAttempts,
        incAttempts: () => { _progressSyncRetryAttempts++; },
        resetAttempts: () => { _progressSyncRetryAttempts = 0; _progressSyncRetryAuthAttempted = false; },
        getAuthAttempted: () => _progressSyncRetryAuthAttempted,
        setAuthAttempted: (v) => { _progressSyncRetryAuthAttempted = !!v; },
        alarmName: PROGRESS_SYNC_RETRY_ALARM
    };
}

function armSyncRetry(kind, reason) {
    const s = _retryStateFor(kind);
    const idx = Math.min(s.getAttempts(), SYNC_RETRY_BACKOFF_MIN.length - 1);
    const delayMin = SYNC_RETRY_BACKOFF_MIN[idx];
    s.incAttempts();
    try {
        chrome.alarms.create(s.alarmName, { delayInMinutes: delayMin });
        console.warn(`[BG] ${kind} sync retry scheduled in ${delayMin} min (attempt ${s.getAttempts()}, reason: ${reason})`);
    } catch (e) {
        console.warn(`[BG] Could not arm ${kind} retry alarm:`, e?.message || e);
    }
}

function clearSyncRetry(kind) {
    const s = _retryStateFor(kind);
    s.resetAttempts();
    try { chrome.alarms.clear(s.alarmName).catch(() => {}); } catch {}
}

// Force the next getFirebaseToken() to refresh by zeroing the cached expiry.
// Used after a 401 response from Firestore so the next attempt picks up a
// fresh idToken without us reaching into the refresh single-flight directly.
async function _invalidateCachedTokenExpiry() {
    try {
        const stored = await bgStorageGet(['firebase_tokens']);
        const tokens = stored.firebase_tokens;
        if (!tokens) return;
        tokens.expiresAt = 0;
        await bgStorageSet({ firebase_tokens: tokens });
    } catch (e) {
        console.warn('[BG] Could not invalidate cached token expiry:', e?.message || e);
    }
}

// Library metadata repair (state, plan, batch runner, retry helpers) lives
// in src/background/metadata-repair.js. Loaded via importScripts above.

let syncInProgress = false;
let pendingSync = false;
let syncDebounceTimeout = null;
let syncPausedUntil = 0;

function pauseSync(ms = 5000) {
    syncPausedUntil = Math.max(syncPausedUntil, Date.now() + ms);
}
function isSyncPaused() {
    return Date.now() < syncPausedUntil;
}

let _lastCloudPollAt = 0;
let _cloudPollInFlight = null;

// Persist the last-poll timestamp so cold starts (especially on mobile, where
// the MV3 service worker is killed aggressively) don't trigger a fresh
// Firestore read every time a consumer reconnects. Without this, opening the
// popup on Orion right after the SW is recycled spends a read on every poll
// even though the cloud doc hasn't changed.
const _LAST_POLL_KEY = '_bgLastCloudPollAt';
const _LAST_PROGRESS_SYNC_KEY = '_bgLastProgressSyncAt';
const _RECENT_OWN_WRITES_KEY = '_bgRecentOwnWrites';
const _OWN_WRITE_PERSIST_TTL_MS = 60 * 1000;

let _bgHydrationPromise = null;
function hydrateBgPollState() {
    if (_bgHydrationPromise) return _bgHydrationPromise;
    _bgHydrationPromise = (async () => {
        try {
            const stored = await bgStorageGet([
                _LAST_POLL_KEY, _LAST_PROGRESS_SYNC_KEY,
                _RECENT_OWN_WRITES_KEY
            ]);
            const cloud = Number(stored[_LAST_POLL_KEY]) || 0;
            const progress = Number(stored[_LAST_PROGRESS_SYNC_KEY]) || 0;
            // Only hydrate values from the past — guards against future-dated
            // timestamps after a clock change.
            const now = Date.now();
            if (cloud > 0 && cloud <= now) _lastCloudPollAt = cloud;
            if (progress > 0 && progress <= now) _lastProgressSyncAt = progress;

            const persistedWrites = stored[_RECENT_OWN_WRITES_KEY];
            if (Array.isArray(persistedWrites)) {
                _bgRecentOwnWrites.length = 0;
                let stalePruned = false;
                for (const entry of persistedWrites) {
                    const ts = typeof entry === 'string' ? entry : entry?.ts;
                    const at = typeof entry === 'object' ? Number(entry?.at) || 0 : 0;
                    if (!ts) continue;
                    if (at && (now - at) > _OWN_WRITE_PERSIST_TTL_MS) {
                        stalePruned = true;
                        continue;
                    }
                    _bgRecentOwnWrites.push(ts);
                }
                if (stalePruned) persistOwnWrites();
            }
        } catch {
            // Best-effort — fall back to zero (poll on next consumer connect).
        }
    })();
    return _bgHydrationPromise;
}

function persistBgPollState(updates) {
    try {
        const payload = {};
        if (typeof updates.cloudPollAt === 'number') payload[_LAST_POLL_KEY] = updates.cloudPollAt;
        if (typeof updates.progressSyncAt === 'number') payload[_LAST_PROGRESS_SYNC_KEY] = updates.progressSyncAt;
        if (Object.keys(payload).length === 0) return;
        bgStorageSet(payload).catch(() => {});
    } catch {}
}

function persistOwnWrites() {
    try {
        const now = Date.now();
        const payload = _bgRecentOwnWrites.map((ts) => ({ ts, at: now }));
        bgStorageSet({ [_RECENT_OWN_WRITES_KEY]: payload }).catch(() => {});
    } catch {}
}

const activeStreamConsumers = new Set();
const IDLE_TEARDOWN_GRACE_MS = 10000;
let _idleTeardownTimer = null;

function addStreamConsumer(id) {
    const wasEmpty = activeStreamConsumers.size === 0;
    activeStreamConsumers.add(id);

    if (_idleTeardownTimer) {
        clearTimeout(_idleTeardownTimer);
        _idleTeardownTimer = null;
        ddebug(`[BG-RT] Consumer ${id} reclaimed idle window`);
    }

    if (wasEmpty) {
        // Single consumer woke us up — fetch the cloud doc once so
        // popup/content land on fresh data without waiting for a debounce.
        pollCloudData('consumer-connected').catch(() => { });
    }
}

function removeStreamConsumer(id) {
    if (!activeStreamConsumers.has(id)) return;
    activeStreamConsumers.delete(id);
    if (activeStreamConsumers.size > 0) return;

    if (_idleTeardownTimer) clearTimeout(_idleTeardownTimer);
    _idleTeardownTimer = setTimeout(() => {
        _idleTeardownTimer = null;
        if (activeStreamConsumers.size > 0) return;
        // Last consumer left — flush any pending progress write so we don't
        // leave watch-time unflushed when the user closes the last tab.
        flushPendingProgressSync().catch(() => {});
    }, IDLE_TEARDOWN_GRACE_MS);
}

async function signOutDueToTokenFailure() {
    console.warn('[BG] Token refresh failed — signing user out to force re-auth');
    try {
        await bgStorageRemove(['firebase_tokens', 'firebase_user']);
    } catch (e) {
        console.error('[BG] Failed to clear auth storage during sign-out:', e);
    }
    // Drop the cloud-doc cache eagerly so a subsequent sign-in (even as the
    // same uid) doesn't serve a stale snapshot from before the token failure,
    // and a sign-in as a different account can never receive account A's doc.
    invalidateBgCloudDocCache();
}

async function getFirebaseToken() {
    try {
        const stored = await bgStorageGet(['firebase_tokens']);
        const tokens = stored.firebase_tokens;
        if (!tokens?.idToken) return null;
        if (tokens.expiresAt < Date.now() + 120000) {
            const result = await refreshFirebaseToken(tokens.refreshToken);
            if (!result || !result.tokens) {
                // Refresh failed. Distinguish permanent vs transient — only
                // permanent failures (revoked refresh token, disabled account)
                // should sign the user out. Transient failures (network blip
                // during cold boot, server 5xx, rate limit) on mobile/Orion
                // were the root cause of the "every reload signs me out" bug.
                if (result?.permanent) {
                    console.warn(`[BG] Refresh token rejected (permanent: ${result.error || '?'}) — signing out`);
                    await signOutDueToTokenFailure();
                    return null;
                }
                // Transient. If existing idToken is still valid (>30s left),
                // use it — better than signing the user out for a network blip.
                const stillValid = tokens.expiresAt && tokens.expiresAt > Date.now() + 30000;
                if (stillValid) {
                    console.warn(`[BG] Token refresh transiently failed (${result?.error || 'unknown'}); using existing token (${Math.round((tokens.expiresAt - Date.now()) / 1000)}s left)`);
                    return tokens.idToken;
                }
                // No usable token AND error is transient — return null but
                // keep session intact so the next call can retry.
                console.warn(`[BG] Token refresh transiently failed and existing token expired; will retry on next call`);
                return null;
            }
            return result.tokens.idToken;
        }
        return tokens.idToken;
    } catch (e) {
        console.error('[BG] Failed to get token:', e);
        return null;
    }
}

let _bgRefreshInflight = null;

// Permanent error codes from securetoken.googleapis.com — only these should
// trigger a sign-out. Mirrors PERMANENT_REFRESH_ERRORS in popup firebase-lib.js.
const _BG_PERMANENT_REFRESH_ERRORS = [
    'INVALID_REFRESH_TOKEN',
    'TOKEN_EXPIRED',
    'USER_DISABLED',
    'USER_NOT_FOUND',
    'INVALID_GRANT',
    'invalid_grant',
    'CREDENTIAL_TOO_OLD_LOGIN_AGAIN',
    'MISSING_REFRESH_TOKEN',
];

function _bgClassifyRefreshError(httpStatus, errorBody) {
    if (httpStatus === 401 || httpStatus === 403) return true;
    if (httpStatus === 400 && errorBody) {
        for (const code of _BG_PERMANENT_REFRESH_ERRORS) {
            if (errorBody.includes(code)) return true;
        }
    }
    return false;
}

async function refreshFirebaseToken(refreshToken) {
    if (!refreshToken) return { tokens: null, permanent: true, error: 'no_refresh_token' };
    if (_bgRefreshInflight) return _bgRefreshInflight;
    const p = (async () => {
        let response;
        try {
            response = await fetchWithTimeout(
                `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken })
                }
            );
        } catch (networkErr) {
            // fetch threw → network/abort/DNS — always transient.
            console.warn('[BG] Token refresh network error:', networkErr?.message || networkErr);
            return { tokens: null, permanent: false, error: `network: ${networkErr?.message || networkErr}` };
        }
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            const permanent = _bgClassifyRefreshError(response.status, body);
            console.warn(`[BG] Token refresh HTTP ${response.status} (${permanent ? 'permanent' : 'transient'}): ${body.slice(0, 200)}`);
            return { tokens: null, permanent, error: `HTTP ${response.status}` };
        }
        let data;
        try { data = await response.json(); } catch { data = null; }
        if (!data) {
            console.warn('[BG] Token refresh returned empty/invalid body — treating as transient');
            return { tokens: null, permanent: false, error: 'empty_body' };
        }
        if (data.error) {
            const msg = data.error?.message || 'unknown';
            const permanent = _bgClassifyRefreshError(400, msg);
            console.warn(`[BG] Token refresh error (${permanent ? 'permanent' : 'transient'}): ${msg}`);
            return { tokens: null, permanent, error: msg };
        }
        if (!data.id_token || !data.refresh_token || !data.expires_in) {
            console.warn('[BG] Token refresh missing fields — treating as transient');
            return { tokens: null, permanent: false, error: 'missing_fields' };
        }
        const tokens = {
            idToken: data.id_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + parseInt(data.expires_in) * 1000
        };
        await bgStorageSet({ firebase_tokens: tokens });
        dlog('[BG] Token refreshed');
        return { tokens, permanent: false, error: null };
    })();
    _bgRefreshInflight = p;
    p.finally(() => { if (_bgRefreshInflight === p) _bgRefreshInflight = null; });
    return p;
}

async function getFirebaseUser() {
    try {
        const stored = await bgStorageGet(['firebase_user']);
        return stored.firebase_user || null;
    } catch { return null; }
}

const _fsCodec = self.AnimeTrackerFirestoreCodec || {};
const jsonToFirestoreFields = _fsCodec.encodeFields || (() => { throw new Error('[BG] Firestore codec not loaded'); });
const fromFSDoc = _fsCodec.decodeDoc || (() => null);

// Single-flight in-flight tracker for concurrent fetchCloudData callers.
// Without this, a cold SW boot where addStreamConsumer triggers
// pollCloudData and the popup simultaneously sends GET_CLOUD_DOC results in
// TWO Firestore reads in parallel for the same uid — both sides race,
// neither sees the other's in-flight promise. Keying by uid keeps an
// account-swap from leaking one user's fetch promise into another's path.
let _fetchInFlightUid = null;
let _fetchInFlightPromise = null;

async function fetchCloudData(user, token) {
    // Reuse an existing in-flight read if one is already running for the
    // same user. Both pollCloudData (uncached path) and fetchCloudDataCached
    // (on cache miss) call into here, so the dedup happens at the lowest
    // level — any future caller automatically inherits the dedup too.
    if (_fetchInFlightUid === user.uid && _fetchInFlightPromise) {
        return _fetchInFlightPromise;
    }

    const fetchPromise = (async () => {
        try {
            const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
            const response = await fetchWithTimeout(url, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!response.ok) {
                // Log the actual status so we can diagnose silent fetch failures
                // (a 401 from a stale SW token, 403 from rules denial, 404 for
                // genuinely-missing doc, etc.). Previously every non-OK was
                // collapsed into a silent null and the popup couldn't tell why.
                const body = await response.text().catch(() => '');
                console.warn(`[BG] fetchCloudData HTTP ${response.status} for users/${user.uid.slice(0, 8)}…: ${body.slice(0, 160)}`);
                // Annotate the cache with the failure status so the SW message
                // handler can surface it to the popup.
                const err = new Error(`HTTP ${response.status}`);
                err.status = response.status;
                err.body = body;
                throw err;
            }
            return fromFSDoc(await response.json());
        } catch (e) {
            console.warn('[BG] Could not fetch cloud data:', e?.message || e);
            // Re-throw status errors so callers can distinguish them from
            // network errors. Network/timeout errors still resolve to null
            // (no `e.status`) so the existing fallback paths still work.
            if (e?.status) throw e;
            return null;
        }
    })();

    _fetchInFlightUid = user.uid;
    _fetchInFlightPromise = fetchPromise;
    try {
        return await fetchPromise;
    } finally {
        if (_fetchInFlightPromise === fetchPromise) {
            _fetchInFlightUid = null;
            _fetchInFlightPromise = null;
        }
    }
}

async function pollCloudData(reason = 'consumer-connected') {
    if (_cloudPollInFlight) return _cloudPollInFlight;

    _cloudPollInFlight = (async () => {
        try {
            await hydrateBgPollState();
            if ((Date.now() - _lastCloudPollAt) < CLOUD_CONSUMER_POLL_MIN_GAP_MS) return null;

            // Short-circuit: if our in-memory / persisted SW cache is still
            // fresh (was populated within the last poll interval), skip the
            // network read entirely. Without this, every consumer-connected
            // wake on mobile (where SW gets killed often) burns a Firestore
            // read just to retrieve the same doc the cache already has.
            // The cache TTL is the real freshness window; the 3-min poll
            // gap was just a safety net.
            await hydrateBgCloudDocCache();
            const user = await getFirebaseUser();
            const token = await getFirebaseToken();
            if (!user || !token) return null;

            const cacheFresh =
                _bgCloudDocCache &&
                _bgCloudDocCacheUid === user.uid &&
                (Date.now() - _bgCloudDocCacheTime) < _BG_CLOUD_TTL;
            if (cacheFresh) {
                // Bump _lastCloudPollAt anyway so the 3-min gate honors this
                // attempt — otherwise back-to-back consumer reconnects would
                // re-enter and eventually hit the network when cache expires
                // even if local data is unchanged.
                _lastCloudPollAt = Date.now();
                persistBgPollState({ cloudPollAt: _lastCloudPollAt });
                dlog(`[BG-RT] Poll skipped (${reason}) — cache still fresh (${Math.round((Date.now() - _bgCloudDocCacheTime) / 1000)}s old)`);
                // Re-apply silently so any local state that drifted catches up.
                if (_bgCloudDocCache) await applyCloudUpdate(_bgCloudDocCache);
                return _bgCloudDocCache;
            }

            const pollAt = Date.now();
            _lastCloudPollAt = pollAt;
            persistBgPollState({ cloudPollAt: pollAt });
            const cloudDoc = await fetchCloudData(user, token);
            if (cloudDoc) {
                await applyCloudUpdate(cloudDoc);
            }
            return cloudDoc;
        } catch (e) {
            console.warn(`[BG-RT] Poll sync failed (${reason}): ${e.message}`);
            return null;
        } finally {
            _cloudPollInFlight = null;
        }
    })();

    return _cloudPollInFlight;
}

// SW cloud-doc cache. Kept in memory for hot reads, AND persisted to
// chrome.storage.local under `_bgCloudDocCache` so an SW kill (MV3 idle
// after ~30s) doesn't lose it. Without persistence, every cold popup open
// burns a Firestore read; with it, the same library can be served for a
// full TTL window without touching Firestore.
//
// Cache entries are uid-bound — both in memory (`_bgCloudDocCacheUid`) and
// on disk (persisted entry shape: `{ uid, doc, cachedAt }`). Without this,
// signing out and signing back in as a different user inside the TTL window
// could leak account A's library to account B (wrong-account merge / data
// leak). Every read path verifies uid; auth changes (sign-out, uid swap)
// invalidate the cache eagerly.
let _bgCloudDocCache = null;
let _bgCloudDocCacheTime = 0;
let _bgCloudDocCacheUid = null;
const _BG_CLOUD_TTL = 5 * 60 * 1000;
const _BG_CLOUD_CACHE_KEY = '_bgCloudDocCachePersisted';

// Hydrate on SW boot — restores cache from disk if still fresh AND the
// persisted uid matches the currently-stored firebase_user. Legacy entries
// without `uid` are discarded (safer than guessing whose library it was).
let _bgCloudCacheHydratePromise = null;
async function hydrateBgCloudDocCache() {
    if (_bgCloudDocCache) return;        // already hot
    if (_bgCloudCacheHydratePromise) return _bgCloudCacheHydratePromise;
    _bgCloudCacheHydratePromise = (async () => {
        try {
            const stored = await bgStorageGet([_BG_CLOUD_CACHE_KEY, 'firebase_user']);
            const entry = stored[_BG_CLOUD_CACHE_KEY];
            const currentUid = stored.firebase_user?.uid || null;
            if (
                entry &&
                entry.cachedAt &&
                entry.uid &&
                currentUid &&
                entry.uid === currentUid &&
                (Date.now() - entry.cachedAt) < _BG_CLOUD_TTL
            ) {
                _bgCloudDocCache = entry.doc;
                _bgCloudDocCacheTime = entry.cachedAt;
                _bgCloudDocCacheUid = entry.uid;
            } else if (entry) {
                // Stale, mismatched, or schema-less — drop it eagerly so a
                // later wrong-account read can never resurrect it.
                bgStorageSet({ [_BG_CLOUD_CACHE_KEY]: null }).catch(() => {});
            }
        } catch { /* fresh start */ }
    })();
    return _bgCloudCacheHydratePromise;
}

function invalidateBgCloudDocCache() {
    _bgCloudDocCache = null;
    _bgCloudDocCacheTime = 0;
    _bgCloudDocCacheUid = null;
    // Best-effort: drop the persisted copy too. Failures here are non-fatal —
    // worst case we serve a stale doc until the next successful fetch.
    bgStorageSet({ [_BG_CLOUD_CACHE_KEY]: null }).catch(() => {});
}

async function fetchCloudDataCached(user, token) {
    await hydrateBgCloudDocCache();
    const now = Date.now();
    // uid guard — never serve another user's cached doc, even if the in-memory
    // copy is still inside the TTL window. A signed-out → signed-in-as-other
    // flow inside 5 minutes would otherwise return account A's library to
    // account B's PATCH path.
    if (_bgCloudDocCache && _bgCloudDocCacheUid === user.uid && (now - _bgCloudDocCacheTime) < _BG_CLOUD_TTL) {
        return _bgCloudDocCache;
    }
    if (_bgCloudDocCache && _bgCloudDocCacheUid !== user.uid) {
        invalidateBgCloudDocCache();
    }
    let doc = null;
    try {
        doc = await fetchCloudData(user, token);
    } catch (e) {
        // Status errors (401/403/404) — don't cache, let the next attempt
        // (e.g. with a refreshed token) try again. Surface the error code
        // via a throw to GET_CLOUD_DOC so the popup can do a direct fetch.
        const err = new Error(e?.message || 'Fetch failed');
        err.status = e?.status || null;
        throw err;
    }
    if (doc) {
        _bgCloudDocCache = doc;
        _bgCloudDocCacheTime = Date.now();
        _bgCloudDocCacheUid = user.uid;
        // Persist asynchronously so the next SW boot can serve from disk.
        bgStorageSet({
            [_BG_CLOUD_CACHE_KEY]: { uid: user.uid, doc, cachedAt: _bgCloudDocCacheTime }
        }).catch(() => {});
    }
    return doc;
}

let progressSyncInProgress = false;
let progressSyncPending = false;
let lastPushedProgressBG = null;

let _lastProgressSyncAt = 0;

// Serializes ALL Firestore writes (full sync + progress-only) so two PATCH
// requests with overlapping field masks can't race and clobber each other.
let _firestoreWriteQueue = Promise.resolve();
function enqueueFirestoreWrite(fn) {
    const next = _firestoreWriteQueue.then(fn, fn);
    _firestoreWriteQueue = next.catch(() => {});
    return next;
}

async function syncProgressOnly() {
    if (progressSyncInProgress) { progressSyncPending = true; return; }

    const user = await getFirebaseUser();
    const token = await getFirebaseToken();
    if (!user || !token) return;

    progressSyncInProgress = true;
    try {
        await enqueueFirestoreWrite(async () => {
        const result = await bgStorageGet(['videoProgress', 'animeData', 'deletedAnime']);
        let localVP = result.videoProgress || {};

        if (lastPushedProgressBG && areProgressMapsEqual(localVP, lastPushedProgressBG)) return;

        localVP = cleanTrackedProgressBg(result.animeData || {}, localVP, result.deletedAnime || {});

        // Cloud-first merge: pull the current Firestore videoProgress (cached
        // — usually a no-op read) and merge per-key into the local map before
        // PATCH-ing. Without this, Firestore's updateMask would replace the
        // whole `videoProgress` map field with our local copy, silently
        // dropping any per-episode progress another device pushed inside our
        // 5-min debounce window.
        let mergedVP = localVP;
        try {
            const cloudDoc = await fetchCloudDataCached(user, token);
            if (cloudDoc?.videoProgress) {
                mergedVP = mergeVideoProgress(localVP, cloudDoc.videoProgress);
                // Re-clean post-merge — cloud may carry tombstones / now-tracked
                // episodes whose entries should now be filtered.
                mergedVP = cleanTrackedProgressBg(result.animeData || {}, mergedVP, result.deletedAnime || {});
            }
        } catch (e) {
            // Network/auth errors fetching cloud → fall back to local-only push.
            // Better to surface our progress than to skip the write entirely;
            // the next successful poll will resolve any divergence.
            console.warn('[BG] Cloud-first merge in syncProgressOnly failed; pushing local only:', e?.message || e);
        }

        // If the merge produced something different from local, write the
        // merged map back so the next save observes the unified state and we
        // don't keep re-merging the same cloud delta forever.
        if (!areProgressMapsEqual(localVP, mergedVP)) {
            pauseSync();
            await bgStorageSet({ videoProgress: mergedVP });
        }

        // After merge, if the result already matches what we last pushed,
        // skip the network write entirely.
        if (lastPushedProgressBG && areProgressMapsEqual(mergedVP, lastPushedProgressBG)) return;

        const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
        const fieldMask = 'updateMask.fieldPaths=videoProgress&updateMask.fieldPaths=lastUpdated';
        const pushedAt = new Date().toISOString();
        const response = await fetchWithTimeout(`${url}?${fieldMask}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fields: jsonToFirestoreFields({
                    videoProgress: mergedVP,
                    lastUpdated: pushedAt
                })
            })
        });

        if (response.ok) {
            lastPushedProgressBG = structuredClone(mergedVP);
            // Seed (rather than invalidate) the cloud-doc cache with the
            // values we just pushed. The PATCH is field-masked, so the cloud
            // doc after this write equals: <prior cloud doc> with the masked
            // fields replaced. If we have a prior cache snapshot for this
            // uid, we can compute that exact post-write state locally and
            // skip the next read entirely. Without this seed, the *next*
            // sync (or popup-driven GET_CLOUD_DOC) burns a Firestore read
            // just to learn what we already know.
            if (_bgCloudDocCache && _bgCloudDocCacheUid === user.uid) {
                _bgCloudDocCache = {
                    ..._bgCloudDocCache,
                    videoProgress: mergedVP,
                    lastUpdated: pushedAt
                };
                _bgCloudDocCacheTime = Date.now();
                bgStorageSet({
                    [_BG_CLOUD_CACHE_KEY]: { uid: user.uid, doc: _bgCloudDocCache, cachedAt: _bgCloudDocCacheTime }
                }).catch(() => {});
            } else {
                // No baseline to seed from — fall back to invalidate so the
                // next read is forced to refetch (correct, just less efficient).
                invalidateBgCloudDocCache();
            }
            bgRememberOwnWrite(pushedAt);
            _lastProgressSyncAt = Date.now();
            persistBgPollState({ progressSyncAt: _lastProgressSyncAt });
            clearSyncRetry('progress');
        } else {
            const status = response.status;
            console.warn('[BG] Progress sync failed:', status);
            if (status === 401) {
                if (_progressSyncRetryAuthAttempted) {
                    console.error('[BG] Progress sync still 401 after token refresh — signing out');
                    await signOutDueToTokenFailure();
                    clearSyncRetry('progress');
                } else {
                    _progressSyncRetryAuthAttempted = true;
                    await _invalidateCachedTokenExpiry();
                    armSyncRetry('progress', '401-needs-refresh');
                }
            } else if (status === 403) {
                if (_progressSyncRetryAttempts >= SYNC_RETRY_BACKOFF_MIN.length) {
                    console.error('[BG] Progress sync 403 — giving up after max retries');
                    clearSyncRetry('progress');
                } else {
                    armSyncRetry('progress', '403');
                }
            } else if (status >= 500) {
                invalidateBgCloudDocCache();
                armSyncRetry('progress', `5xx (${status})`);
            } else {
                console.error(`[BG] Progress sync got non-retryable ${status}`);
                clearSyncRetry('progress');
            }
        }
        });
    } catch (error) {
        console.error('[BG] Progress sync error:', error);
        armSyncRetry('progress', `network: ${error?.message || error}`);
    } finally {
        progressSyncInProgress = false;
        if (progressSyncPending) {
            progressSyncPending = false;
            // chrome.alarms survives SW kill; setTimeout(5000) silently
            // disappeared if the SW got recycled between the previous sync
            // finishing and this re-queue firing, losing the pending change.
            chrome.alarms.create(PROGRESS_SYNC_ALARM, { when: Date.now() + 5000 });
        }
    }
}

async function syncToFirebase() {
    if (syncInProgress) { pendingSync = true; return; }

    const user = await getFirebaseUser();
    if (!user) return;
    const token = await getFirebaseToken();
    if (!token) return;

    syncInProgress = true;
    try {
        await enqueueFirestoreWrite(async () => {
        const cloudDoc = await fetchCloudDataCached(user, token);

        const result = await bgStorageGet(['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages']);
        const localAnime = result.animeData || {};
        const localProgress = result.videoProgress || {};
        const localDeleted = result.deletedAnime || {};
        const localGroup = result.groupCoverImages || {};

        let mergedDeleted = cloudDoc?.deletedAnime
            ? mergeDeletedAnime(localDeleted, cloudDoc.deletedAnime)
            : localDeleted;

        let mergedAnime = cloudDoc?.animeData
            ? mergeAnimeData(localAnime, cloudDoc.animeData)
            : { ...localAnime };

        mergedDeleted = pruneStaleDeletedAnime(mergedAnime, mergedDeleted);
        applyDeletedAnime(mergedAnime, mergedDeleted);

        let mergedProgress = cloudDoc?.videoProgress
            ? mergeVideoProgress(localProgress, cloudDoc.videoProgress)
            : { ...localProgress };

        mergedProgress = cleanTrackedProgressBg(mergedAnime, mergedProgress, mergedDeleted);

        pruneDeletedAnime(mergedDeleted);

        const cloudGroup = cloudDoc?.groupCoverImages || {};
        const mergedGroup = mergeGroupCoverImages(localGroup, cloudGroup);

        const animeChanged = !areAnimeDataMapsEqual(localAnime, mergedAnime);
        const progressChanged = !areProgressMapsEqual(localProgress, mergedProgress);
        const deletedChanged = !shallowEqualDeletedAnime(localDeleted, mergedDeleted);
        const groupChanged = !shallowEqualObjectMap(localGroup, mergedGroup);

        if (animeChanged || progressChanged || deletedChanged || groupChanged) {
            pauseSync();
            await bgStorageSet({
                animeData: mergedAnime,
                videoProgress: mergedProgress,
                deletedAnime: mergedDeleted,
                groupCoverImages: mergedGroup
            });
        }

        const cloudAnimeRef = cloudDoc?.animeData || {};
        const cloudProgressRef = cloudDoc?.videoProgress || {};
        const cloudDeletedRef = cloudDoc?.deletedAnime || {};
        const cloudGroupRef = cloudDoc?.groupCoverImages || {};
        const needsCloudWrite =
            !areAnimeDataMapsEqual(mergedAnime, cloudAnimeRef) ||
            !areProgressMapsEqual(mergedProgress, cloudProgressRef) ||
            !shallowEqualDeletedAnime(mergedDeleted, cloudDeletedRef) ||
            !shallowEqualObjectMap(mergedGroup, cloudGroupRef);

        if (!needsCloudWrite) {
            _bgCloudDocCacheTime = Date.now();
            _bgCloudDocCacheUid = user.uid;
            return;
        }

        const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
        const shouldWriteEmail = !cloudDoc || cloudDoc.email !== user.email;

        const fieldList = ['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages', 'lastUpdated'];
        if (shouldWriteEmail) fieldList.push('email');
        const fieldMask = fieldList.map(f => `updateMask.fieldPaths=${f}`).join('&');

        const pushedAt = new Date().toISOString();
        const payloadFields = {
            animeData: mergedAnime,
            videoProgress: mergedProgress,
            deletedAnime: mergedDeleted,
            groupCoverImages: mergedGroup,
            lastUpdated: pushedAt
        };
        if (shouldWriteEmail) payloadFields.email = user.email;

        const response = await fetchWithTimeout(`${url}?${fieldMask}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fields: jsonToFirestoreFields(payloadFields)
            })
        });

        if (response.ok) {
            // Seed the cache with the post-write state. The PATCH masked
            // fieldList, so reconstruct the doc by overlaying payloadFields
            // onto the prior cached doc. Falls back to invalidate when no
            // baseline exists. See comment in syncProgressOnly for the
            // rationale — net effect: −1 Firestore read per sync cycle.
            if (_bgCloudDocCache && _bgCloudDocCacheUid === user.uid) {
                _bgCloudDocCache = {
                    ..._bgCloudDocCache,
                    ...payloadFields
                };
                _bgCloudDocCacheTime = Date.now();
                bgStorageSet({
                    [_BG_CLOUD_CACHE_KEY]: { uid: user.uid, doc: _bgCloudDocCache, cachedAt: _bgCloudDocCacheTime }
                }).catch(() => {});
            } else {
                invalidateBgCloudDocCache();
            }
            bgRememberOwnWrite(pushedAt);
            clearSyncPending();
            clearSyncRetry('full');
        } else {
            const status = response.status;
            console.error('[BG] Sync failed:', status);
            // Keep the change in pendingSyncFlush so the retry attempt has
            // something to write — clearSyncPending only on terminal success.
            markSyncPending();

            if (status === 401) {
                // Token rejected. Force a refresh on next attempt and retry
                // soon. If we already retried once with a fresh token, fall
                // through to sign-out instead of looping.
                if (_fullSyncRetryAuthAttempted) {
                    console.error('[BG] Sync still 401 after token refresh — signing out');
                    await signOutDueToTokenFailure();
                    clearSyncRetry('full');
                } else {
                    _fullSyncRetryAuthAttempted = true;
                    await _invalidateCachedTokenExpiry();
                    armSyncRetry('full', '401-needs-refresh');
                }
            } else if (status === 403) {
                // Permissions/rules issue — long backoff, won't fix itself
                // by retrying fast. Cap attempts so we don't spam.
                if (_fullSyncRetryAttempts >= SYNC_RETRY_BACKOFF_MIN.length) {
                    console.error('[BG] Sync 403 — giving up after max retries (check Firestore rules)');
                    clearSyncRetry('full');
                } else {
                    armSyncRetry('full', '403');
                }
            } else if (status >= 500) {
                invalidateBgCloudDocCache();
                armSyncRetry('full', `5xx (${status})`);
            } else {
                // 4xx other (400, 404, etc) — probably non-retryable.
                console.error(`[BG] Sync got non-retryable ${status}; dropping pending flag`);
                clearSyncPending();
                clearSyncRetry('full');
            }
        }
        });
    } catch (error) {
        console.error('[BG] Sync error:', error);
        // Network / timeout / abort — treat like 5xx so we don't lose the change.
        markSyncPending();
        armSyncRetry('full', `network: ${error?.message || error}`);
    } finally {
        syncInProgress = false;
        if (pendingSync) {
            pendingSync = false;
            markSyncPending();
            setTimeout(syncToFirebase, 5000);
        }
    }
}

let _applyCloudUpdateDoc = null;
let _applyCloudDebounce = null;
let _applyCloudUpdateQueue = Promise.resolve();
let _applyCloudUpdateWaiters = [];

const _MAX_CLOUD_UPDATE_WAITERS = 100;

async function applyCloudUpdate(cloudDoc) {
    if (!cloudDoc) return;

    // Cache seeding moved into _doApplyCloudUpdate where we can stamp the
    // active uid alongside the doc — seeding here without a uid risked
    // letting the cache leak across an account switch that happened between
    // fetch and apply.

    _applyCloudUpdateDoc = cloudDoc;
    if (_applyCloudDebounce) clearTimeout(_applyCloudDebounce);

    if (_applyCloudUpdateWaiters.length >= _MAX_CLOUD_UPDATE_WAITERS) {
        // Cap the queue so we don't hold an unbounded list of pending promises
        // if upstream callers stop awaiting (rare, but a memory-leak guardrail).
        // We resolve dropped waiters rather than reject because callers usually
        // `.catch(() => null)` anyway and rejecting them produces noisy
        // unhandledrejection logs without changing behavior. Log a warning so
        // pile-ups don't go silently undetected — they almost always indicate
        // a bug upstream (e.g. consumer loop without backoff).
        const overflow = _applyCloudUpdateWaiters.length - _MAX_CLOUD_UPDATE_WAITERS + 1;
        const stale = _applyCloudUpdateWaiters.splice(0, overflow);
        console.warn(`[BG] applyCloudUpdate waiter overflow — dropped ${overflow} pending promises (queue cap ${_MAX_CLOUD_UPDATE_WAITERS})`);
        for (const w of stale) w.resolve();
    }

    return new Promise((resolve, reject) => {
        _applyCloudUpdateWaiters.push({ resolve, reject });
        _applyCloudDebounce = setTimeout(() => {
            _applyCloudDebounce = null;
            const pendingWaiters = _applyCloudUpdateWaiters.splice(0);
            _applyCloudUpdateQueue = _applyCloudUpdateQueue
                .catch(() => { })
                .then(() => _drainCloudUpdates())
                .then(() => {
                    for (const waiter of pendingWaiters) waiter.resolve();
                })
                .catch((error) => {
                    for (const waiter of pendingWaiters) waiter.reject(error);
                });
        }, 500);
    });
}

async function _drainCloudUpdates() {
    while (_applyCloudUpdateDoc) {
        const nextCloudDoc = _applyCloudUpdateDoc;
        _applyCloudUpdateDoc = null;
        await _doApplyCloudUpdate(nextCloudDoc);
    }
}

const _bgRecentOwnWrites = [];
const _BG_MAX_RECENT_OWN_WRITES = 20;
function bgRememberOwnWrite(ts) {
    if (!ts) return;
    _bgRecentOwnWrites.push(ts);
    if (_bgRecentOwnWrites.length > _BG_MAX_RECENT_OWN_WRITES) _bgRecentOwnWrites.shift();
    persistOwnWrites();
}
function bgIsOwnEcho(ts) {
    return !!ts && _bgRecentOwnWrites.includes(ts);
}

async function _doApplyCloudUpdate(cloudDoc) {
    if (!cloudDoc) return;

    if (syncInProgress) return;

    const cloudUpdatedAt = cloudDoc.lastUpdated || null;
    if (cloudUpdatedAt && bgIsOwnEcho(cloudUpdatedAt)) {
        return;
    }

    // Re-confirm the active user before merging — ensures we never apply
    // account A's cloud doc to local storage if the user signed out / signed
    // in as B between fetch and apply, and lets us tag the seeded cache with
    // the correct uid.
    const activeUser = await getFirebaseUser();
    if (!activeUser?.uid) {
        invalidateBgCloudDocCache();
        return;
    }
    if (_bgCloudDocCacheUid && _bgCloudDocCacheUid !== activeUser.uid) {
        invalidateBgCloudDocCache();
    }
    _bgCloudDocCache = cloudDoc;
    _bgCloudDocCacheTime = Date.now();
    _bgCloudDocCacheUid = activeUser.uid;

    try {
        const local = await bgStorageGet(['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages']);

        let mergedDeleted = cloudDoc.deletedAnime
            ? mergeDeletedAnime(local.deletedAnime || {}, cloudDoc.deletedAnime)
            : (local.deletedAnime || {});

        let mergedAnime = mergeAnimeData(local.animeData || {}, cloudDoc.animeData || {});
        mergedDeleted = pruneStaleDeletedAnime(mergedAnime, mergedDeleted);
        applyDeletedAnime(mergedAnime, mergedDeleted);

        let mergedProgress = mergeVideoProgress(local.videoProgress || {}, cloudDoc.videoProgress || {});

        mergedProgress = cleanTrackedProgressBg(mergedAnime, mergedProgress, mergedDeleted);

        pruneDeletedAnime(mergedDeleted);

        const localGroup = local.groupCoverImages || {};
        const cloudGroup = cloudDoc.groupCoverImages || {};
        const mergedGroup = mergeGroupCoverImages(localGroup, cloudGroup);

        const animeChanged = !areAnimeDataMapsEqual(local.animeData || {}, mergedAnime);

        const progressChanged = !areProgressMapsEqual(local.videoProgress || {}, mergedProgress);
        const deletedChanged = !shallowEqualDeletedAnime(local.deletedAnime || {}, mergedDeleted);
        const groupChanged = !shallowEqualObjectMap(localGroup, mergedGroup);

        if (animeChanged || progressChanged || deletedChanged || groupChanged) {
            pauseSync();
            await bgStorageSet({
                animeData: mergedAnime,
                videoProgress: mergedProgress,
                deletedAnime: mergedDeleted,
                groupCoverImages: mergedGroup
            });
            dlog('[BG-RT] ← Cloud update applied');
        }

        if (cloudDoc.playbackSettings) {
            await applyCloudPlaybackSettings(cloudDoc.playbackSettings);
        }

        if (cloudDoc.anilistAuth) {
            await applyCloudAnilistAuth(cloudDoc.anilistAuth);
        }
    } catch (e) {
        console.warn('[BG-RT] Apply update failed:', e.message);
    }
}

// Playback toggles synced via cloudDoc.playbackSettings. Mirrored from
// FirebaseSync.applyCloudPlaybackSettings (popup) so the SW can propagate
// changes seen via pollCloudData → chrome.storage.local without going
// through the popup. Last-write-wins via `updatedAt` ISO timestamp.
const BG_PLAYBACK_FIELD_MAP = {
    copyGuard: 'copyGuardEnabled',
    smartNotif: 'smartNotificationsEnabled',
    autoSkipFiller: 'autoSkipFillers',
    skiptimeHelper: 'skiptimeHelperEnabled'
};
const BG_PLAYBACK_UPDATED_AT_KEY = 'playbackSettingsUpdatedAt';

async function applyCloudPlaybackSettings(cloudPlayback) {
    if (!cloudPlayback || typeof cloudPlayback !== 'object') return false;
    const cloudUpdatedAt = cloudPlayback.updatedAt || null;
    if (!cloudUpdatedAt) return false;

    try {
        const localKeys = Object.values(BG_PLAYBACK_FIELD_MAP).concat([BG_PLAYBACK_UPDATED_AT_KEY]);
        const stored = await bgStorageGet(localKeys);
        const localUpdatedAt = stored[BG_PLAYBACK_UPDATED_AT_KEY] || null;
        if (localUpdatedAt && Date.parse(localUpdatedAt) >= Date.parse(cloudUpdatedAt)) {
            return false;
        }

        const writes = { [BG_PLAYBACK_UPDATED_AT_KEY]: cloudUpdatedAt };
        let changed = false;
        for (const [field, storageKey] of Object.entries(BG_PLAYBACK_FIELD_MAP)) {
            const next = !!cloudPlayback[field];
            const current = stored[storageKey];
            // copyGuard treats undefined-or-true as ON; others treat undefined as OFF.
            const currentBool = storageKey === 'copyGuardEnabled'
                ? (current !== false)
                : (current === true);
            if (currentBool !== next) {
                writes[storageKey] = next;
                changed = true;
            }
        }

        if (!changed) {
            await bgStorageSet(writes);
            return false;
        }

        await bgStorageSet(writes);

        // Smart notifs has alarm side-effects — schedule/cancel here so a
        // cloud-driven enable on another device still starts the alarm.
        if (Object.prototype.hasOwnProperty.call(writes, 'smartNotificationsEnabled')) {
            if (writes.smartNotificationsEnabled) {
                chrome.alarms.create(SMART_NOTIF_ALARM, { periodInMinutes: SMART_NOTIF_INTERVAL_MINUTES });
            } else {
                chrome.alarms.clear(SMART_NOTIF_ALARM).catch(() => {});
            }
        }

        dlog('[BG-RT] ← Cloud playback settings applied');
        return true;
    } catch (e) {
        console.warn('[BG-RT] Apply playback settings failed:', e.message);
        return false;
    }
}

// AniList OAuth token synced via cloudDoc.anilistAuth. The desktop pushes
// after a successful connect()/disconnect(); mobile (where chrome.identity
// .launchWebAuthFlow doesn't work) pulls and writes to chrome.storage.local
// so AniList push-sync can run on mobile too. Last-write-wins via `updatedAt`.
//
// Cloud shape:
//   {
//     accessToken: '...',  // null when desktop disconnected
//     expiresAt: <ms epoch> | 0,
//     viewer: { id, name, avatar } | null,
//     username: 'anilist-username' | null,  // optional (anilist_username key)
//     updatedAt: '<ISO>'
//   }
//
// Local shape (chrome.storage.local):
//   anilist_auth: { accessToken, expiresAt, viewer, updatedAt }
//   anilist_username: 'name'
const BG_ANILIST_AUTH_KEY = 'anilist_auth';
const BG_ANILIST_USERNAME_KEY = 'anilist_username';

async function applyCloudAnilistAuth(cloudAnilist) {
    if (!cloudAnilist || typeof cloudAnilist !== 'object') return false;
    const cloudUpdatedAt = cloudAnilist.updatedAt || null;
    if (!cloudUpdatedAt) return false;

    try {
        const stored = await bgStorageGet([BG_ANILIST_AUTH_KEY, BG_ANILIST_USERNAME_KEY]);
        const localAuth = stored[BG_ANILIST_AUTH_KEY] || null;
        const localUpdatedAt = localAuth?.updatedAt || null;

        // Cloud must be strictly newer to win. Ties keep local — protects
        // against an in-flight local connect() being clobbered by an older
        // cloud snapshot delivered seconds later by a stale poll.
        if (localUpdatedAt && Date.parse(localUpdatedAt) >= Date.parse(cloudUpdatedAt)) {
            return false;
        }

        const writes = {};
        let touched = false;

        // Token: write only when cloud has a non-empty access token AND the
        // cloud expiresAt hasn't passed (no point applying an expired token —
        // it'd just trigger an immediate `reconnect` 401 in anilist-sync.js).
        const cloudAccess = typeof cloudAnilist.accessToken === 'string' && cloudAnilist.accessToken
            ? cloudAnilist.accessToken
            : null;
        const cloudExpiresAt = Number.isFinite(cloudAnilist.expiresAt) ? cloudAnilist.expiresAt : 0;
        const cloudHasValidToken = cloudAccess && (!cloudExpiresAt || cloudExpiresAt > Date.now());

        if (cloudHasValidToken) {
            writes[BG_ANILIST_AUTH_KEY] = {
                accessToken: cloudAccess,
                expiresAt: cloudExpiresAt,
                viewer: cloudAnilist.viewer && typeof cloudAnilist.viewer === 'object'
                    ? cloudAnilist.viewer
                    : null,
                updatedAt: cloudUpdatedAt
            };
            touched = true;
        } else if (localAuth) {
            // Cloud says "disconnected" (or expired) and is newer than local —
            // mirror the disconnect locally so push-sync stops trying to use
            // a token that was revoked from the desktop.
            writes[BG_ANILIST_AUTH_KEY] = null;
            touched = true;
        }

        if (typeof cloudAnilist.username === 'string' && cloudAnilist.username) {
            if (stored[BG_ANILIST_USERNAME_KEY] !== cloudAnilist.username) {
                writes[BG_ANILIST_USERNAME_KEY] = cloudAnilist.username;
                touched = true;
            }
        }

        if (!touched) return false;

        // chrome.storage.local.set with `null` value persists the null;
        // remove the key explicitly when we want to clear it so isConnected()
        // checks (which read `s[AUTH_KEY] || null`) behave correctly.
        const setKeys = {};
        const removeKeys = [];
        for (const [k, v] of Object.entries(writes)) {
            if (v === null) removeKeys.push(k);
            else setKeys[k] = v;
        }
        if (Object.keys(setKeys).length > 0) await bgStorageSet(setKeys);
        if (removeKeys.length > 0) await bgStorageRemove(removeKeys);

        dlog('[BG-RT] ← Cloud AniList auth applied');
        return true;
    } catch (e) {
        console.warn('[BG-RT] Apply AniList auth failed:', e.message);
        return false;
    }
}

// Realtime Firestore listener removed — Firestore's documents:listen requires
// gRPC streaming, which the plain `fetch` API in MV3 service workers cannot
// drive (UNIMPLEMENTED on first byte). All sync goes through pollCloudData()
// when consumers connect, plus chrome.storage.onChanged-driven write flushes.

// Flush any pending progress-sync alarm immediately. Used when we want to
// short-circuit the 5-min debounce (e.g. last viewer closing the tab, or
// receiving an explicit FLUSH request).
async function flushPendingProgressSync() {
    let cleared = false;
    try { cleared = await chrome.alarms.clear(PROGRESS_SYNC_ALARM); } catch {}
    if (cleared && !syncDebounceTimeout && !syncInProgress) {
        syncProgressOnly().catch(() => {});
    }
    return cleared;
}

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;

    // Auth-change cache invalidation. Catches popup-driven sign-in / sign-out
    // / account-swap inside the SW's TTL window — without this, opening the
    // popup as user B after user A's session would let the SW serve A's
    // cached doc to B's first GET_CLOUD_DOC. Runs before the sync-debounce
    // logic below so we don't queue a sync against the wrong cache state.
    if (Object.prototype.hasOwnProperty.call(changes, 'firebase_user')) {
        const newUid = changes.firebase_user?.newValue?.uid || null;
        const oldUid = changes.firebase_user?.oldValue?.uid || null;
        if (newUid !== oldUid) {
            invalidateBgCloudDocCache();
        }
    }

    if (syncInProgress) return;

    let _pendingProgressSync = false;
    let _pendingFullSync = false;

    if (changes.videoProgress && !isSyncPaused()) {
        _pendingProgressSync = true;
    }

    if (changes.animeData && !isSyncPaused()) {
        const oldAnime = changes.animeData.oldValue || {};
        const newAnime = changes.animeData.newValue || {};

        const oldCount = Object.values(oldAnime).reduce((s, a) => s + (a.episodes?.length || 0), 0);
        const newCount = Object.values(newAnime).reduce((s, a) => s + (a.episodes?.length || 0), 0);

        const libraryChanged = !areAnimeDataEqualIgnoringFetchMetadata(oldAnime, newAnime);

        if (newCount > oldCount || libraryChanged) {
            if (newCount > oldCount) {
                dlog(
                    `%cAnime Tracker %c➕ New episode! (${oldCount}→${newCount})`,
                    'color:rgb(255,107,107);font-weight:bold;font-size:12px',
                    'color:rgb(148,163,184);font-size:11px'
                );
            }
            _pendingFullSync = true;
        }
    }

    if (changes.deletedAnime && !isSyncPaused()) {
        if (!shallowEqualDeletedAnime(
            changes.deletedAnime.oldValue || {},
            changes.deletedAnime.newValue || {}
        )) {
            _pendingFullSync = true;
        }
    }

    if (changes.groupCoverImages && !isSyncPaused()) {
        if (!shallowEqualObjectMap(
            changes.groupCoverImages.oldValue || {},
            changes.groupCoverImages.newValue || {}
        )) {
            _pendingFullSync = true;
        }
    }

    if (_pendingFullSync) {
        chrome.alarms.clear(PROGRESS_SYNC_ALARM).catch(() => {});
        if (syncDebounceTimeout) clearTimeout(syncDebounceTimeout);
        markSyncPending();
        syncDebounceTimeout = setTimeout(() => { syncDebounceTimeout = null; syncToFirebase(); }, 5000);
    } else if (_pendingProgressSync) {
        // 5-min debounce matches CS periodic push cadence — on natural pauses this
        // fires so the cloud stays close to local state without over-writing.
        // Uses chrome.alarms (not setTimeout) so it survives SW kills.
        chrome.alarms.create(PROGRESS_SYNC_ALARM, { delayInMinutes: 5 });
    }

    if (changes.animeData) {
        maybeStartPendingMetadataRepair().catch((error) => {
            console.error('[BG] Failed to honor pending repair request:', error);
        });
    }

    // The popup sets `pendingBackgroundMetadataRepair: true` on sign-in. If
    // animeData happens to be identical between local and cloud (e.g. signing
    // back in on the same device), the `changes.animeData` path above never
    // fires and the flag would sit unread until the next SW boot. Honor the
    // flag-flip directly so the silent repair starts within seconds of sign-in.
    if (changes.pendingBackgroundMetadataRepair?.newValue === true) {
        maybeStartPendingMetadataRepair().catch((error) => {
            console.error('[BG] Failed to start pending repair on flag flip:', error);
        });
    }
});

// Filler discovery (KNOWN_FILLER_SLUGS, fillerSlugCache,
// generateFillerSlugCandidates, discoverFillerSlug) moved to
// src/background/filler-discovery.js. Loaded via importScripts at the top of this file.

// an1me.to scraper (fetchAnimePageInfo, batchFetchAnimeInfo, slug-candidate
// helpers) and Filler Discovery (fetchEpisodeTypesFromAnimeFillerList,
// fetchJikanEpisodes, discoverFillerSlug) moved to src/background/an1me-scraper.js and
// src/background/filler-discovery.js. Loaded via importScripts at the top of this file.

// AniSkip + MAL-ID resolution + bundle migration now live in src/background/aniskip.js.
// Loaded via importScripts at the top of this file. Functions remain at SW
// global scope so existing call sites here continue to work unchanged.

// Smart notifications (SMART_NOTIF_ALARM, checkNewEpisodes), badge
// notifications (showBadgeNotification, showBatchBadgeNotification) and the
// chrome.notifications.onClicked listener live in src/background/smart-notifications.js.
// Loaded via importScripts above.

// Library metadata repair runners (runMetadataRepairBatch, startLibraryRepair,
// repairAnimeInfoCache, repairEpisodeTypesCache, finalizeMetadataRepair,
// maybeStartPendingMetadataRepair, resumeMetadataRepairIfNeeded) live in
// src/background/metadata-repair.js.

async function migrateFromSyncToLocal() {
    try {
        const syncData = await new Promise((resolve, reject) => {
            chrome.storage.sync.get(['animeData', 'videoProgress'], (result) => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(result);
            });
        });
        const validAnimeData = syncData.animeData
            && typeof syncData.animeData === 'object'
            && !Array.isArray(syncData.animeData);
        const validVideoProgress = syncData.videoProgress
            && typeof syncData.videoProgress === 'object'
            && !Array.isArray(syncData.videoProgress);
        const hasSyncData = (validAnimeData && Object.keys(syncData.animeData).length > 0) ||
            (validVideoProgress && Object.keys(syncData.videoProgress).length > 0);
        if (hasSyncData) {
            const localData = await bgStorageGet(['animeData', 'videoProgress']);
            const merged = {
                animeData: { ...(validAnimeData ? syncData.animeData : {}), ...(localData.animeData || {}) },
                videoProgress: { ...(validVideoProgress ? syncData.videoProgress : {}), ...(localData.videoProgress || {}) }
            };
            await bgStorageSet(merged);
            await new Promise((resolve) => {
                chrome.storage.sync.remove(['animeData', 'trackedEpisodes', 'videoProgress'], () => resolve());
            });
            dlog('[Anime Tracker] Migration complete');
        }
    } catch (error) {
        console.error('[Anime Tracker] Migration error:', error);
    }
}

function normalizeTrackedDuration(duration) {
    const MAX_REASONABLE_DURATION_SECONDS = 6 * 60 * 60;
    let value = Math.round(Number(duration) || 0);
    if (!Number.isFinite(value) || value <= 0) value = 0;
    if (value > MAX_REASONABLE_DURATION_SECONDS) value = MAX_REASONABLE_DURATION_SECONDS;
    return value;
}

async function persistBeforeUnloadTrack(animeInfo, duration) {
    if (!animeInfo?.animeSlug || !animeInfo?.episodeNumber) {
        throw new Error('Invalid animeInfo for TRACK_BEFORE_UNLOAD');
    }

    const result = await bgStorageGet(['animeData', 'videoProgress']);
    const animeData = result.animeData || {};
    const videoProgress = result.videoProgress || {};

    const slug = animeInfo.animeSlug;
    if (!animeData[slug]) {
        animeData[slug] = {
            title: animeInfo.animeTitle || slug,
            slug,
            episodes: [],
            totalWatchTime: 0,
            lastWatched: null,
            totalEpisodes: Number.isFinite(animeInfo.totalEpisodes) ? animeInfo.totalEpisodes : null,
            coverImage: animeInfo.coverImage || null
        };
    } else if (!animeData[slug].coverImage && animeInfo.coverImage) {
        animeData[slug].coverImage = animeInfo.coverImage;
    }

    if (!Array.isArray(animeData[slug].episodes)) {
        animeData[slug].episodes = [];
    }

    if (animeData[slug].droppedAt) {
        delete animeData[slug].droppedAt;
        dlog('[BG] Auto-undropped anime (new episode tracked):', slug);
    }

    const validDuration = normalizeTrackedDuration(duration);
    const watchedAt = new Date().toISOString().split('.')[0] + 'Z';
    let changed = false;

    const upsertEpisode = (episodeNumber) => {
        const epNumber = Number(episodeNumber) || 0;
        if (epNumber <= 0) return;

        const episodes = animeData[slug].episodes;
        const existingIndex = episodes.findIndex(ep => Number(ep?.number) === epNumber);
        if (existingIndex === -1) {
            episodes.push({
                number: epNumber,
                watchedAt,
                duration: validDuration,
                durationSource: 'video'
            });
            changed = true;
            return;
        }

        const existing = episodes[existingIndex] || {};
        const existingDuration = Number(existing.duration) || 0;
        if (isPlaceholderDuration(existingDuration) && validDuration > 0 && existingDuration !== validDuration) {
            episodes[existingIndex] = {
                ...existing,
                duration: validDuration,
                durationSource: 'video'
            };
            changed = true;
        }
    };

    upsertEpisode(animeInfo.episodeNumber);
    if (animeInfo.isDoubleEpisode && animeInfo.secondEpisodeNumber) {
        upsertEpisode(animeInfo.secondEpisodeNumber);
    }

    if (changed) {
        animeData[slug].episodes.sort((a, b) => a.number - b.number);
        animeData[slug].totalWatchTime = animeData[slug].episodes
            .reduce((sum, ep) => sum + (Number(ep?.duration) || 0), 0);
        animeData[slug].lastWatched = new Date().toISOString();
    }

    let progressChanged = false;
    if (animeInfo.uniqueId && videoProgress[animeInfo.uniqueId]) {
        delete videoProgress[animeInfo.uniqueId];
        progressChanged = true;
    }

    if (changed || progressChanged) {
        const payload = { animeData };
        if (progressChanged) payload.videoProgress = videoProgress;
        await bgStorageSet(payload);
    }
}

// Watchlist sync (syncWatchlistToSite, directWatchlistFetch) lives in
// src/background/watchlist-sync.js. Loaded via importScripts above.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'SYNC_TO_FIREBASE') {
        sendResponse({ received: true });
        if (syncDebounceTimeout) clearTimeout(syncDebounceTimeout);
        markSyncPending();
        syncDebounceTimeout = setTimeout(() => { syncDebounceTimeout = null; syncToFirebase(); }, 500);
        return true;
    }

    if (message.type === 'BADGE_UNLOCKED') {
        sendResponse({ received: true });
        showBadgeNotification({
            id: message.id,
            title: message.title,
            desc: message.desc,
            icon: message.icon
        });
        return true;
    }

    if (message.type === 'BADGES_UNLOCKED_BATCH') {
        sendResponse({ received: true });
        showBatchBadgeNotification(Number(message.count) || 0);
        return true;
    }

    if (message.type === 'SYNC_PROGRESS_ONLY') {
        sendResponse({ received: true });
        // Wait for hydration before reading _lastProgressSyncAt — otherwise a
        // freshly-woken SW always sees 0 and skips the min-interval guard,
        // burning a Firestore write seconds after the previous one.
        (async () => {
            await hydrateBgPollState();
            const sinceLast = Date.now() - _lastProgressSyncAt;
            if (_lastProgressSyncAt && sinceLast < 4 * 60 * 1000) return;
            try { await chrome.alarms.clear(PROGRESS_SYNC_ALARM); } catch {}
            syncProgressOnly();
        })();
        return true;
    }

    if (message.type === 'GET_VERSION') {
        sendResponse({ version: chrome.runtime.getManifest().version });
        return true;
    }

    if (message.type === 'WAKE_AND_POLL_CLOUD') {
        // Fired from any an1me.to content script on page load so freshly
        // landing on the site picks up watch progress from other devices
        // without forcing the user to open the popup. `pollCloudData` is
        // self-rate-limited (60s gate + 5-min cache via fetchCloudDataCached)
        // so calling this on every page navigation is cheap.
        sendResponse({ received: true });
        pollCloudData('content-page-open').catch(() => {});
        return true;
    }

    if (message.type === 'GET_CLOUD_DOC') {
        (async () => {
            try {
                const user = await getFirebaseUser();
                const token = await getFirebaseToken();
                if (!user || !token) {
                    sendResponse({ success: false, error: 'not_authenticated' });
                    return;
                }
                const doc = await fetchCloudDataCached(user, token);
                sendResponse({ success: true, doc: doc || null });
            } catch (e) {
                // Surface the HTTP status (if any) so the popup knows whether
                // the doc genuinely doesn't exist (404), the token was rejected
                // (401/403), or it was a transient network error. Without this,
                // the popup couldn't distinguish "no doc" from "fetch failed".
                sendResponse({
                    success: false,
                    error: e?.message || String(e),
                    status: e?.status || null
                });
            }
        })();
        return true;
    }

    if (message.type === 'INVALIDATE_BG_CLOUD_DOC_CACHE') {
        invalidateBgCloudDocCache();
        sendResponse({ ok: true });
        return true;
    }

    if (message.type === 'UPDATE_BG_CLOUD_DOC_CACHE') {
        // Popup just wrote `doc` to Firestore — seed the SW cache with it so
        // the SW's next storage.onChanged-driven sync skips the Firestore read.
        // Saves ~1 read per popup-side save. Also persisted to disk so an SW
        // kill mid-session doesn't lose the seed.
        //
        // The uid from the sender must match the currently-stored
        // firebase_user. Without this guard a stale message from a previous
        // sign-in (e.g. in-flight when the user signs out) could re-seed the
        // cache with the wrong account's doc.
        (async () => {
            try {
                const senderUid = typeof message.uid === 'string' ? message.uid : null;
                const activeUser = await getFirebaseUser();
                const activeUid = activeUser?.uid || null;
                if (
                    !senderUid ||
                    !activeUid ||
                    senderUid !== activeUid ||
                    !message.doc ||
                    typeof message.doc !== 'object'
                ) {
                    invalidateBgCloudDocCache();
                    sendResponse({ ok: false, reason: 'uid_mismatch_or_no_doc' });
                    return;
                }
                _bgCloudDocCache = message.doc;
                _bgCloudDocCacheTime = Date.now();
                _bgCloudDocCacheUid = activeUid;
                bgStorageSet({
                    [_BG_CLOUD_CACHE_KEY]: { uid: activeUid, doc: message.doc, cachedAt: _bgCloudDocCacheTime }
                }).catch(() => {});
                sendResponse({ ok: true });
            } catch (e) {
                sendResponse({ ok: false, error: e?.message || String(e) });
            }
        })();
        return true;
    }

    if (message.type === 'UPDATE_BG_PLAYBACK_SETTINGS') {
        // Popup just pushed playbackSettings to Firestore — patch the SW
        // cache so a follow-up poll doesn't re-fetch the same value we
        // already know about.
        if (message.playbackSettings && typeof message.playbackSettings === 'object') {
            if (_bgCloudDocCache && typeof _bgCloudDocCache === 'object') {
                _bgCloudDocCache = { ..._bgCloudDocCache, playbackSettings: message.playbackSettings };
                _bgCloudDocCacheTime = Date.now();
            }
        }
        sendResponse({ ok: true });
        return true;
    }

    if (message.type === 'UPDATE_BG_ANILIST_AUTH') {
        // Popup just pushed anilistAuth to Firestore — patch the SW cache
        // so the next poll doesn't burn a Firestore read fetching what we
        // already wrote. Mirrors the playbackSettings seed handler above.
        if (message.anilistAuth && typeof message.anilistAuth === 'object') {
            if (_bgCloudDocCache && typeof _bgCloudDocCache === 'object') {
                _bgCloudDocCache = { ..._bgCloudDocCache, anilistAuth: message.anilistAuth };
                _bgCloudDocCacheTime = Date.now();
            }
        }
        sendResponse({ ok: true });
        return true;
    }

    if (message.type === 'UPDATE_BG_CLOUD_DOC_PARTIAL') {
        // Content-script just wrote a subset of fields to Firestore (e.g.
        // videoProgress + lastUpdated only). Overlay those onto the SW
        // cache instead of invalidating, so the next consumer-connected
        // poll / GET_CLOUD_DOC doesn't burn a Firestore read for the
        // exact data we already know about.
        //
        // uid must match the active user (same guard as the popup-side
        // UPDATE_BG_CLOUD_DOC_CACHE handler above). Empty/missing uid or
        // mismatched senders fall through to invalidate so cache integrity
        // is never compromised by stale cross-user messages.
        (async () => {
            try {
                const senderUid = typeof message.uid === 'string' ? message.uid : null;
                const partial = (message.partial && typeof message.partial === 'object') ? message.partial : null;
                const activeUser = await getFirebaseUser();
                const activeUid = activeUser?.uid || null;
                if (!senderUid || !activeUid || senderUid !== activeUid || !partial) {
                    invalidateBgCloudDocCache();
                    sendResponse({ ok: false, reason: 'uid_mismatch_or_no_partial' });
                    return;
                }
                if (_bgCloudDocCache && _bgCloudDocCacheUid === activeUid) {
                    _bgCloudDocCache = { ..._bgCloudDocCache, ...partial };
                    _bgCloudDocCacheTime = Date.now();
                    bgStorageSet({
                        [_BG_CLOUD_CACHE_KEY]: { uid: activeUid, doc: _bgCloudDocCache, cachedAt: _bgCloudDocCacheTime }
                    }).catch(() => {});
                    sendResponse({ ok: true, mode: 'overlay' });
                } else {
                    // No baseline cache — content-script writes alone aren't
                    // enough to construct a complete user doc (missing
                    // goalSettings, badgeUnlocks, etc.). Fall back to
                    // invalidate; the next read will populate the cache.
                    sendResponse({ ok: true, mode: 'no-baseline-skip' });
                }
            } catch (e) {
                sendResponse({ ok: false, error: e?.message || String(e) });
            }
        })();
        return true;
    }

    if (message.type === 'FETCH_ANIME_INFO') {
        if (!message.slug) { sendResponse({ error: 'Missing slug' }); return true; }
        fetchAnimePageInfo(message.slug)
            .then(info => sendResponse({ success: true, info }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (message.type === 'BATCH_FETCH_ANIME_INFO') {
        sendResponse({ received: true });
        if (Array.isArray(message.slugs) && message.slugs.length > 0) {
            batchFetchAnimeInfo(message.slugs).catch(e =>
                console.warn('[BG] Batch fetch error:', e)
            );
        }
        return true;
    }

    if (message.type === 'WATCHLIST_SYNC') {
        sendResponse({ received: true });
        const { animeId, watchlistType } = message;
        if (animeId && watchlistType) {
            syncWatchlistToSite(animeId, watchlistType).catch(e =>
                console.warn('[BG] Watchlist sync error:', e)
            );
        }
        return true;
    }

    if (message.type === 'FETCH_EPISODE_TYPES') {
        if (!message.animeSlug) { sendResponse({ error: 'Missing animeSlug' }); return true; }
        (async () => {
            try {
                const fillerSlug = await discoverFillerSlug(message.animeSlug, message.animeTitle || null);
                if (fillerSlug) {
                    const episodeTypes = await fetchEpisodeTypesFromAnimeFillerList(fillerSlug);
                    if (episodeTypes) {
                        sendResponse({ success: true, episodeTypes, fillerSlug, source: 'animefillerlist' });
                        return;
                    }
                }

                if (message.animeTitle) {
                    dlog(`[BG] AnimeFillerList miss, trying Jikan for "${message.animeTitle}"`);
                    const jikanData = await fetchJikanEpisodes(message.animeTitle);
                    if (jikanData && jikanData.filler.length > 0) {
                        sendResponse({ success: true, episodeTypes: jikanData, fillerSlug: message.animeSlug, source: 'jikan' });
                        return;
                    }
                }

                sendResponse({ success: false, notFound: true, error: 'Not found on animefillerlist.com or Jikan' });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }

    if (message.type === 'SET_SMART_NOTIFICATIONS') {
        bgStorageSet({ smartNotificationsEnabled: message.enabled })
            .then(() => {
                if (message.enabled) {
                    chrome.alarms.create(SMART_NOTIF_ALARM, { periodInMinutes: SMART_NOTIF_INTERVAL_MINUTES });
                } else {
                    chrome.alarms.clear(SMART_NOTIF_ALARM).catch(() => { });
                }
                sendResponse({ success: true });
            })
            .catch(e => sendResponse({ success: false, error: e.message }));
        return true;
    }

    if (message.type === 'GET_FILLER_EPISODES') {
        if (!message.animeSlug) { sendResponse({ fillers: null }); return true; }
        const slug = message.animeSlug;
        if (isLikelyMovieSlug(slug)) { sendResponse({ fillers: null }); return true; }
        const title = message.animeTitle || null;
        const key = `episodeTypes_${slug}`;
        (async () => {
            try {
                const stored = await bgStorageGet([key]);
                const cached = stored[key];
                if (cached && isEpisodeTypesCacheFresh(cached)) {
                    sendResponse({ fillers: cached?.notFound ? null : (cached?.filler || null) });
                    return;
                }
                const result = await repairEpisodeTypesCache(slug, title, false);
                const fillers = result?.entry?.notFound ? null : (result?.entry?.filler || null);
                sendResponse({ fillers });
            } catch {
                sendResponse({ fillers: null });
            }
        })();
        return true;
    }

    if (message.type === 'GET_OUTRO_START') {
        const slug = message.animeSlug;
        const title = message.animeTitle || null;
        const ep = Number(message.episodeNumber) || 0;
        const len = Number(message.episodeLength) || 0;
        if (!slug || !ep) { sendResponse({ outroStart: null }); return true; }
        (async () => {
            try {
                const outroStart = await fetchAniSkipOutroStart(slug, title, ep, len);
                sendResponse({ outroStart });
            } catch {
                sendResponse({ outroStart: null });
            }
        })();
        return true;
    }

    if (message.type === 'START_LIBRARY_REPAIR') {
        startLibraryRepair({
            forceInfoRefresh: message.forceInfoRefresh === true,
            forceFillerRefresh: message.forceFillerRefresh === true
        })
            .then((state) => sendResponse({ success: true, state }))
            .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (message.type === 'TRACK_BEFORE_UNLOAD') {
        persistBeforeUnloadTrack(message.animeInfo, message.duration)
            .then(() => sendResponse({ success: true }))
            .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;
    }

    // Unknown message type — return false so modular listeners (anilist-sync,
    // filler-discovery, etc.) that registered their own onMessage handlers can
    // handle it without getting a race from a double sendResponse here.
    return false;
});

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        bgStorageSet({
            animeData: {},
            videoProgress: {},
            settings: { watchThreshold: 0.85, notifications: true }
        }).catch(e => console.error('[BG] Failed to init storage on install:', e));
    } else if (details.reason === 'update') {
        const style = [
            'color:rgb(255,107,107)',
            'font-weight:bold',
            'font-size:13px',
            'padding:4px 8px',
            'background:linear-gradient(135deg,rgba(255,107,107,0.2),rgba(255,142,83,0.2))',
            'border-radius:4px'
        ].join(';');
        dlog(`%c🎬 Anime Tracker v${chrome.runtime.getManifest().version}`, style);
        migrateFromSyncToLocal();

        // Post-update fetch: stamp a flag so (a) the SW kicks off the
        // metadata-repair pass on boot via maybeStartPendingMetadataRepair(),
        // and (b) the next popup open surfaces the auto-fetch UI + toast.
        // Skip if a previous post-update flag is still unconsumed (user
        // hasn't opened the popup yet) — don't double-stamp.
        const fromVersion = details.previousVersion || null;
        const toVersion = chrome.runtime.getManifest().version || null;

        // Keep metadata caches across extension reload/update. The repair pass
        // is cache-first and fetches only missing/stale entries, so wiping
        // animeinfo_* / episodeTypes_* here would waste network and Firebase
        // churn after every manual extension refresh.
        bgStorageGet(['postUpdateFetchTriggeredAt']).then((existing) => {
            const payload = {
                pendingBackgroundMetadataRepair: true
            };
            if (!existing.postUpdateFetchTriggeredAt) {
                payload.postUpdateFetchTriggeredAt = Date.now();
                payload.postUpdateFetchFromVersion = fromVersion;
                payload.postUpdateFetchToVersion = toVersion;
            }
            return bgStorageSet(payload);
        }).then(() => {
            // Kick off the repair immediately so background warming happens
            // even if the user never opens the popup. Re-entrant-safe.
            maybeStartPendingMetadataRepair().catch((error) => {
                console.warn('[BG] Post-update repair start failed:', error);
            });
        }).catch((e) => console.warn('[BG] Post-update flag write failed:', e));
    }
});

/**
 * Wipe every `animeinfo_*` and `episodeTypes_*` key from chrome.storage.local.
 * Called from the onInstalled.update handler so the metadata-repair pass that
 * follows actually re-scrapes (instead of seeing fresh-cached entries and
 * skipping every item). Uses get(null) to enumerate then a single remove() —
 * avoids paying a per-key remove round-trip on libraries with hundreds of
 * tracked anime.
 */
async function clearMetadataCachesOnce() {
    try {
        const all = await new Promise((resolve, reject) => {
            chrome.storage.local.get(null, (result) => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(result || {});
            });
        });
        const keysToClear = Object.keys(all).filter((k) =>
            k.startsWith('animeinfo_') || k.startsWith('episodeTypes_')
        );
        if (keysToClear.length === 0) return;
        await bgStorageRemove(keysToClear);
        invalidateBgCloudDocCache();
        dlog(`[BG] Wiped ${keysToClear.length} metadata cache entries for post-update refresh`);
    } catch (e) {
        console.warn('[BG] clearMetadataCachesOnce failed:', e);
        throw e;
    }
}

chrome.runtime.onStartup.addListener(() => {
    dlog('[Anime Tracker] Extension started');
    migrateFromSyncToLocal();
    bgStorageGet(['smartNotificationsEnabled']).then(r => {
        if (r.smartNotificationsEnabled === true) {
            chrome.alarms.create(SMART_NOTIF_ALARM, { periodInMinutes: SMART_NOTIF_INTERVAL_MINUTES });
        }
    }).catch(() => { });
});

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'keepAlive' && port.name !== 'popupAlive') return;
    const consumerId = `${port.name}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    addStreamConsumer(consumerId);
    port.onDisconnect.addListener(() => {
        removeStreamConsumer(consumerId);
        const err = chrome.runtime.lastError;
        if (err) {
            const msg = err.message || '';
            const isExpectedClose = msg.includes('back/forward cache') || msg.includes('message channel is closed');
            if (!isExpectedClose) {
                ddebug(`[BG] ${port.name} port disconnected:`, msg);
            }
        }
    });
});

// keepAlive alarm removed — service worker is now woken on demand via the
// `keepAlive` and `popupAlive` runtime ports (see chrome.runtime.onConnect
// handler above). Periodic polling/stream restarts no longer need an alarm:
// the metadata-repair tick reschedules itself via METADATA_REPAIR_ALARM and
// pollCloudData runs whenever a fresh consumer connects.
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === METADATA_REPAIR_ALARM) {
        runMetadataRepairBatch().catch((error) => {
            console.error('[BG] Metadata repair alarm failed:', error);
        });
        return;
    }

    if (alarm.name === SMART_NOTIF_ALARM) {
        checkNewEpisodes().catch(e => console.warn('[BG] Smart notif check error:', e));
        return;
    }

    if (alarm.name === PROGRESS_SYNC_ALARM) {
        if (syncDebounceTimeout || syncInProgress) return;
        syncProgressOnly();
        return;
    }

    if (alarm.name === FULL_SYNC_RETRY_ALARM) {
        if (syncInProgress) {
            // A regular sync is already running — let it finish; if it
            // fails it will arm a fresh retry alarm of its own.
            return;
        }
        // Re-arm the debounce path so we coalesce with any change that
        // arrived while we were waiting for the alarm to fire.
        markSyncPending();
        syncToFirebase();
        return;
    }

    if (alarm.name === PROGRESS_SYNC_RETRY_ALARM) {
        if (progressSyncInProgress) return;
        syncProgressOnly();
        return;
    }
});

maybeStartPendingMetadataRepair().catch((error) => {
    console.error('[BG] Failed to start pending metadata repair on boot:', error);
});
resumeMetadataRepairIfNeeded().catch((error) => {
    console.error('[BG] Failed to resume metadata repair on boot:', error);
});
hydrateBgPollState();
// Best-effort migration of legacy per-key caches into bundled maps. Idempotent
// (guarded by a flag in storage). Runs in background — no awaiting needed.
migratePerKeyCachesOnce();

// Recover from SW kills: if a previous incarnation scheduled a sync via
// setTimeout but was terminated before it fired, the PENDING_SYNC_KEY stamp
// is still in storage. We always recover when the stamp exists — the previous
// SW is dead (we're in a fresh boot), so its setTimeout can never fire.
// syncToFirebase is self-serializing via syncInProgress + pendingSync so a
// double-call is harmless even in the corner case of a near-instant restart.
// Earlier version gated on `Date.now() - ts < PENDING_SYNC_STALE_MS` which
// silently dropped any change whose marker was set within ~8s before the
// SW died — a real and reproducible data-loss path.
(async () => {
    try {
        const stored = await bgStorageGet([PENDING_SYNC_KEY]);
        const ts = Number(stored?.[PENDING_SYNC_KEY]) || 0;
        if (!ts) return;
        dlog('[BG] Recovering stranded sync from previous SW incarnation');
        syncToFirebase();
    } catch (e) {
        console.warn('[BG] Pending-sync recovery check failed:', e);
    }
})();
