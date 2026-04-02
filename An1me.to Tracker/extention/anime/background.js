/**
 * Anime Tracker - Background Service Worker
 * Handles extension lifecycle, message passing, and auto-sync to Firebase
 */

// ─── Config ───────────────────────────────────────────────────────────────────
const FIREBASE_API_KEY    = "AIzaSyCDF9US2OwARlyZ0AH_zDpjzmOXRtrGKMg";
const FIREBASE_PROJECT_ID = "anime-tracker-64d86";
const FIRESTORE_BASE      = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)`;
const LISTEN_URL          = `${FIRESTORE_BASE}/documents:listen`;

importScripts('src/common/merge-utils.js');

const sharedMergeUtils = self.AnimeTrackerMergeUtils || {};
const missingMergeUtil = (name) => () => {
    throw new Error(`[BG] Missing shared merge util: ${name}`);
};

const mergeVideoProgress     = sharedMergeUtils.mergeVideoProgress     || missingMergeUtil('mergeVideoProgress');
const mergeAnimeData         = sharedMergeUtils.mergeAnimeData         || missingMergeUtil('mergeAnimeData');
const mergeDeletedAnime      = sharedMergeUtils.mergeDeletedAnime      || missingMergeUtil('mergeDeletedAnime');
const applyDeletedAnime      = sharedMergeUtils.applyDeletedAnime      || missingMergeUtil('applyDeletedAnime');
const mergeGroupCoverImages  = sharedMergeUtils.mergeGroupCoverImages  || missingMergeUtil('mergeGroupCoverImages');
const areAnimeDataMapsEqual  = sharedMergeUtils.areAnimeDataMapsEqual  || missingMergeUtil('areAnimeDataMapsEqual');
const areProgressMapsEqual   = sharedMergeUtils.areProgressMapsEqual   || missingMergeUtil('areProgressMapsEqual');
const shallowEqualDeletedAnime = sharedMergeUtils.shallowEqualDeletedAnime || missingMergeUtil('shallowEqualDeletedAnime');
const shallowEqualObjectMap  = sharedMergeUtils.shallowEqualObjectMap  || missingMergeUtil('shallowEqualObjectMap');
const isLikelyMovieSlug      = sharedMergeUtils.isLikelyMovieSlug      || missingMergeUtil('isLikelyMovieSlug');

// ─── Storage helpers ─────────────────────────────────────────────────────────

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

const METADATA_REPAIR_STATE_KEY = 'metadataRepairState';
const PENDING_METADATA_REPAIR_KEY = 'pendingBackgroundMetadataRepair';
const METADATA_REPAIR_ALARM = 'metadataRepairTick';
const METADATA_REPAIR_INFO_TTL_MS = 24 * 60 * 60 * 1000;
const METADATA_REPAIR_INFO_TTL_AIRING_MS = 60 * 60 * 1000;
const METADATA_REPAIR_EPISODE_TYPES_TTL_MS = 24 * 60 * 60 * 1000;
const METADATA_REPAIR_NOT_FOUND_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const METADATA_REPAIR_ITEMS_PER_TICK = 3;
const METADATA_REPAIR_INTER_ITEM_DELAY_MS = 250;
const METADATA_REPAIR_MAX_LOGS = 60;
const METADATA_REPAIR_MAX_ATTEMPTS = 3;
const METADATA_REPAIR_RETRY_BASE_DELAY_MS = 1500;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableMetadataRepairError(error) {
    const message = String(error?.message || '').toLowerCase();
    if (!message) return true;

    if (message.includes('http 404')) return false;
    if (message.includes('http 400')) return false;
    if (message.includes('http 401')) return false;
    if (message.includes('http 403')) return false;

    return true;
}

async function runMetadataRepairWithRetry(task, options = {}) {
    const {
        attempts = METADATA_REPAIR_MAX_ATTEMPTS,
        baseDelayMs = METADATA_REPAIR_RETRY_BASE_DELAY_MS,
        shouldRetry = isRetryableMetadataRepairError
    } = options;

    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await task(attempt);
        } catch (error) {
            lastError = error;
            if (attempt >= attempts || !shouldRetry(error)) {
                throw error;
            }

            const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
            await delay(delayMs);
        }
    }

    throw lastError || new Error('Metadata repair retry failed');
}

function scheduleMetadataRepairTick(delayMs = 0) {
    const when = Date.now() + Math.max(50, delayMs);
    chrome.alarms.create(METADATA_REPAIR_ALARM, { when });
}

async function getMetadataRepairState() {
    const result = await bgStorageGet([METADATA_REPAIR_STATE_KEY]);
    return result[METADATA_REPAIR_STATE_KEY] || null;
}

async function setMetadataRepairState(state) {
    await bgStorageSet({ [METADATA_REPAIR_STATE_KEY]: state });
}

function appendMetadataRepairLog(logs, entry) {
    const next = Array.isArray(logs) ? logs.slice(-(METADATA_REPAIR_MAX_LOGS - 1)) : [];
    next.push(entry);
    return next;
}

function isAnimeInfoCacheFresh(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const age = entry.cachedAt ? Date.now() - entry.cachedAt : Infinity;
    if (entry.notFound) return age < METADATA_REPAIR_NOT_FOUND_TTL_MS;
    const ttl = entry.status === 'RELEASING'
        ? METADATA_REPAIR_INFO_TTL_AIRING_MS
        : METADATA_REPAIR_INFO_TTL_MS;
    return age < ttl;
}

function isEpisodeTypesCacheFresh(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const age = entry.cachedAt ? Date.now() - entry.cachedAt : Infinity;
    if (entry.notFound) return age < METADATA_REPAIR_NOT_FOUND_TTL_MS;
    return age < METADATA_REPAIR_EPISODE_TYPES_TTL_MS;
}

function formatMetadataRepairDetail(infoResult, fillerResult) {
    const parts = [];

    if (infoResult?.status === 'fetched') parts.push('info refreshed');
    else if (infoResult?.status === 'cached') parts.push('info cached');
    else if (infoResult?.status === 'unavailable') parts.push('info unavailable');
    else if (infoResult?.status === 'failed') parts.push(`info failed: ${infoResult.error || 'error'}`);

    if (fillerResult?.status === 'fetched') {
        const fillers = fillerResult.fillerCount || 0;
        const total = fillerResult.totalEpisodes || '?';
        parts.push(`${fillers} fillers / ${total} eps`);
    } else if (fillerResult?.status === 'cached') {
        parts.push('filler cached');
    } else if (fillerResult?.status === 'nofill') {
        parts.push('not listed');
    } else if (fillerResult?.status === 'movie') {
        parts.push('movie/OVA');
    } else if (fillerResult?.status === 'failed') {
        parts.push(`filler failed: ${fillerResult.error || 'error'}`);
    }

    return parts.join(' • ');
}

function buildMetadataRepairLog(slug, title, infoResult, fillerResult) {
    const displayTitle = title || slug;
    const detail = formatMetadataRepairDetail(infoResult, fillerResult);

    if (infoResult?.status === 'failed' || fillerResult?.status === 'failed') {
        return { type: 'error', slug, name: displayTitle, detail, at: Date.now() };
    }

    if (fillerResult?.status === 'movie') {
        return { type: 'movie', slug, name: displayTitle, detail, at: Date.now() };
    }

    if (fillerResult?.status === 'nofill') {
        return { type: 'nofill', slug, name: displayTitle, detail, at: Date.now() };
    }

    if (infoResult?.status === 'fetched' || fillerResult?.status === 'fetched') {
        return { type: 'fetch', slug, name: displayTitle, detail, at: Date.now() };
    }

    return { type: 'cached', slug, name: displayTitle, detail, at: Date.now() };
}

function countMetadataRepairOutcome(logEntry) {
    const base = { fetched: 0, cached: 0, skipped: 0, failed: 0 };
    if (!logEntry) return base;

    if (logEntry.type === 'fetch') base.fetched = 1;
    else if (logEntry.type === 'cached') base.cached = 1;
    else if (logEntry.type === 'movie' || logEntry.type === 'nofill') base.skipped = 1;
    else if (logEntry.type === 'error') base.failed = 1;

    return base;
}

async function buildLibraryRepairPlan(animeData, options = {}) {
    const forceInfoRefresh = options.forceInfoRefresh === true;
    const forceFillerRefresh = options.forceFillerRefresh === true;
    const entries = Object.entries(animeData || {});
    const storageKeys = [];

    entries.forEach(([slug]) => {
        storageKeys.push(`animeinfo_${slug}`);
        storageKeys.push(`episodeTypes_${slug}`);
    });

    const cachedEntries = storageKeys.length > 0 ? await bgStorageGet(storageKeys) : {};
    const items = [];
    let processed = 0;
    let cached = 0;
    let skipped = 0;

    for (const [slug, anime] of entries) {
        const infoEntry = cachedEntries[`animeinfo_${slug}`];
        const fillerEntry = cachedEntries[`episodeTypes_${slug}`];
        const movieLike = isLikelyMovieSlug(slug);

        const hasFreshInfo = !forceInfoRefresh && isAnimeInfoCacheFresh(infoEntry);
        const hasFreshFiller = movieLike
            ? true
            : (!forceFillerRefresh && isEpisodeTypesCacheFresh(fillerEntry));

        const needsInfo = !hasFreshInfo;
        const needsFiller = !movieLike && !hasFreshFiller;

        if (!needsInfo && !needsFiller) {
            processed++;
            if (movieLike || fillerEntry?.notFound) {
                skipped++;
            } else {
                cached++;
            }
            continue;
        }

        items.push({
            slug,
            title: anime?.title || slug
        });
    }

    return {
        total: entries.length,
        processed,
        cached,
        skipped,
        items,
        queueIndex: 0,
        forceInfoRefresh,
        forceFillerRefresh
    };
}

// ─── State ────────────────────────────────────────────────────────────────────
let syncInProgress      = false;
let pendingSync         = false;
let syncDebounceTimeout = null;
let syncPausedUntil     = 0;

function pauseSync(ms = 5000) {
    syncPausedUntil = Math.max(syncPausedUntil, Date.now() + ms);
}
function isSyncPaused() {
    return Date.now() < syncPausedUntil;
}

let rtListenAbort    = null;
let rtReconnectTimer = null;
let rtReconnectDelay = 5000;
const RT_MAX_DELAY   = 60000;

// Max consecutive failures before the SSE listener pauses itself.
// The alarm-based health check restarts it, preventing a tight reconnect loop.
const RT_MAX_FAILURES = 10;
let rtConsecutiveFailures = 0;

// ─── Token helpers ────────────────────────────────────────────────────────────

async function signOutDueToTokenFailure() {
    console.warn('[BG] Token refresh failed — signing user out to force re-auth');
    try {
        await bgStorageRemove(['firebase_tokens', 'firebase_user']);
    } catch (e) {
        console.error('[BG] Failed to clear auth storage during sign-out:', e);
    }
    // Stop the SSE listener so it does not keep retrying with a null token
    if (rtListenAbort) rtListenAbort.abort();
    if (rtReconnectTimer) { clearTimeout(rtReconnectTimer); rtReconnectTimer = null; }
}

async function getFirebaseToken() {
    try {
        const stored = await bgStorageGet(['firebase_tokens']);
        const tokens = stored.firebase_tokens;
        if (!tokens?.idToken) return null;
        // Refresh if token expires within 2 minutes
        if (tokens.expiresAt < Date.now() + 120000) {
            const refreshed = await refreshFirebaseToken(tokens.refreshToken);
            if (!refreshed) {
                await signOutDueToTokenFailure();
                return null;
            }
            return refreshed.idToken;
        }
        return tokens.idToken;
    } catch (e) {
        console.error('[BG] Failed to get token:', e);
        return null;
    }
}

async function refreshFirebaseToken(refreshToken) {
    if (!refreshToken) return null;
    try {
        const response = await fetch(
            `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken })
            }
        );
        if (!response.ok) return null;
        const data = await response.json();
        if (data.error) return null;
        const tokens = {
            idToken:      data.id_token,
            refreshToken: data.refresh_token,
            expiresAt:    Date.now() + parseInt(data.expires_in) * 1000
        };
        await bgStorageSet({ firebase_tokens: tokens });
        console.log('[BG] Token refreshed');
        return tokens;
    } catch (e) {
        console.error('[BG] Token refresh failed:', e);
        return null;
    }
}

async function getFirebaseUser() {
    try {
        const stored = await bgStorageGet(['firebase_user']);
        return stored.firebase_user || null;
    } catch { return null; }
}

// ─── Firestore codec ──────────────────────────────────────────────────────────

function jsonToFirestoreFields(obj) {
    const fields = {};
    for (const [key, value] of Object.entries(obj)) fields[key] = jsonToFirestoreValue(value);
    return fields;
}

function jsonToFirestoreValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'string')  return { stringValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number')  return Number.isInteger(value)
        ? { integerValue: value.toString() }
        : { doubleValue: value };
    if (Array.isArray(value))  return { arrayValue: { values: value.map(jsonToFirestoreValue) } };
    if (typeof value === 'object') return { mapValue: { fields: jsonToFirestoreFields(value) } };
    return { nullValue: null };
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

// ─── Merge helpers ────────────────────────────────────────────────────────────


// ─── Cloud fetch ──────────────────────────────────────────────────────────────

async function fetchCloudData(user, token) {
    try {
        const url      = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!response.ok) return null;
        return fromFSDoc(await response.json());
    } catch (e) {
        console.warn('[BG] Could not fetch cloud data:', e);
        return null;
    }
}

// ─── Push: videoProgress only (merged PATCH) ─────────────────────────────────

let progressSyncInProgress = false;
let progressSyncPending    = false;
let lastPushedProgressBG   = null;

async function syncProgressOnly() {
    if (progressSyncInProgress) { progressSyncPending = true; return; }

    const user  = await getFirebaseUser();
    const token = await getFirebaseToken();
    if (!user || !token) return;

    progressSyncInProgress = true;
    try {
        const result = await bgStorageGet(['videoProgress']);
        const localVP = result.videoProgress || {};

        // Quick check: skip if nothing changed since last push
        if (lastPushedProgressBG && areProgressMapsEqual(localVP, lastPushedProgressBG)) return;

        let cloudVP = {};
        try {
            // Fetch only the videoProgress field to avoid downloading the full document.
            const url = `${FIRESTORE_BASE}/documents/users/${user.uid}?fields=videoProgress`;
            const r   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            if (r.ok) cloudVP = fromFSDoc(await r.json())?.videoProgress || {};
        } catch {}

        const latestResult = await bgStorageGet(['videoProgress']);
        const latestLocalVP = latestResult.videoProgress || {};
        const mergedVP = mergeVideoProgress(latestLocalVP, cloudVP);

        if (!areProgressMapsEqual(latestLocalVP, mergedVP)) {
            pauseSync();
            await bgStorageSet({ videoProgress: mergedVP });
        }

        const url       = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
        const fieldMask = 'updateMask.fieldPaths=videoProgress&updateMask.fieldPaths=lastUpdated';
        const response  = await fetch(`${url}?${fieldMask}`, {
            method:  'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                fields: jsonToFirestoreFields({
                    videoProgress: mergedVP,
                    lastUpdated:   new Date().toISOString()
                })
            })
        });

        if (response.ok) {
            lastPushedProgressBG = JSON.parse(JSON.stringify(mergedVP));
        } else {
            console.warn('[BG] Progress sync failed:', response.status);
        }
    } catch (error) {
        console.error('[BG] Progress sync error:', error);
    } finally {
        progressSyncInProgress = false;
        if (progressSyncPending) {
            progressSyncPending = false;
            setTimeout(syncProgressOnly, 5000);
        }
    }
}

// ─── Push: full sync (animeData + videoProgress) ─────────────────────────────

async function syncToFirebase() {
    if (syncInProgress) { pendingSync = true; return; }

    const user = await getFirebaseUser();
    if (!user) return;
    const token = await getFirebaseToken();
    if (!token) return;

    syncInProgress = true;
    try {
        const initialLocal = await bgStorageGet(['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages']);
        const cloudDoc = await fetchCloudData(user, token);

        const result = await bgStorageGet(['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages']);
        const localAnime    = result.animeData        || initialLocal.animeData        || {};
        const localProgress = result.videoProgress    || initialLocal.videoProgress    || {};
        const localDeleted  = result.deletedAnime     || initialLocal.deletedAnime     || {};
        const localGroup    = result.groupCoverImages || initialLocal.groupCoverImages || {};

        const mergedDeleted = cloudDoc?.deletedAnime
            ? mergeDeletedAnime(localDeleted, cloudDoc.deletedAnime)
            : localDeleted;

        let mergedAnime = cloudDoc?.animeData
            ? mergeAnimeData(localAnime, cloudDoc.animeData)
            : { ...localAnime };

        applyDeletedAnime(mergedAnime, mergedDeleted);

        const mergedProgress = cloudDoc?.videoProgress
            ? mergeVideoProgress(localProgress, cloudDoc.videoProgress)
            : localProgress;

        const cloudGroup  = cloudDoc?.groupCoverImages || {};
        const mergedGroup = mergeGroupCoverImages(localGroup, cloudGroup);

        const animeChanged    = !areAnimeDataMapsEqual(localAnime, mergedAnime);
        const progressChanged = !areProgressMapsEqual(localProgress, mergedProgress);
        const deletedChanged  = !shallowEqualDeletedAnime(localDeleted, mergedDeleted);
        const groupChanged    = !shallowEqualObjectMap(localGroup, mergedGroup);

        if (animeChanged || progressChanged || deletedChanged || groupChanged) {
            pauseSync();
            await bgStorageSet({
                animeData:        mergedAnime,
                videoProgress:    mergedProgress,
                deletedAnime:     mergedDeleted,
                groupCoverImages: mergedGroup
            });
        }

        const url       = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
        const fieldMask = [
            'animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages', 'lastUpdated', 'email'
        ].map(f => `updateMask.fieldPaths=${f}`).join('&');

        const response = await fetch(`${url}?${fieldMask}`, {
            method:  'PATCH',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                fields: jsonToFirestoreFields({
                    animeData:        mergedAnime,
                    videoProgress:    mergedProgress,
                    deletedAnime:     mergedDeleted,
                    groupCoverImages: mergedGroup,
                    lastUpdated:      new Date().toISOString(),
                    email:            user.email
                })
            })
        });

        if (response.ok) {
            // sync successful
        } else {
            console.error('[BG] Sync failed:', response.status);
        }
    } catch (error) {
        console.error('[BG] Sync error:', error);
    } finally {
        syncInProgress = false;
        if (pendingSync) { pendingSync = false; setTimeout(syncToFirebase, 5000); }
    }
}

// ─── Real-time listener (SSE) ─────────────────────────────────────────────────

let _applyCloudUpdateDoc     = null;
let _applyCloudDebounce      = null;
let _applyCloudUpdateQueue   = Promise.resolve();
let _applyCloudUpdateWaiters = [];

async function applyCloudUpdate(cloudDoc) {
    if (!cloudDoc) return;

    // Debounce rapid SSE updates (e.g. multiple field changes in quick succession)
    _applyCloudUpdateDoc = cloudDoc;
    if (_applyCloudDebounce) clearTimeout(_applyCloudDebounce);
    return new Promise((resolve, reject) => {
        _applyCloudUpdateWaiters.push({ resolve, reject });
        _applyCloudDebounce = setTimeout(() => {
            _applyCloudDebounce = null;
            const pendingWaiters = _applyCloudUpdateWaiters.splice(0);
            _applyCloudUpdateQueue = _applyCloudUpdateQueue
                .catch(() => {})
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

async function _doApplyCloudUpdate(cloudDoc) {
    if (!cloudDoc) return;

    try {
        // Single read: get the latest local state
        const local = await bgStorageGet(['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages']);

        const mergedDeleted = cloudDoc.deletedAnime
            ? mergeDeletedAnime(local.deletedAnime || {}, cloudDoc.deletedAnime)
            : (local.deletedAnime || {});

        let mergedAnime = mergeAnimeData(local.animeData || {}, cloudDoc.animeData || {});
        applyDeletedAnime(mergedAnime, mergedDeleted);

        const mergedProgress = mergeVideoProgress(local.videoProgress || {}, cloudDoc.videoProgress || {});

        const localGroup  = local.groupCoverImages   || {};
        const cloudGroup  = cloudDoc.groupCoverImages || {};
        const mergedGroup = mergeGroupCoverImages(localGroup, cloudGroup);

        const localEps = Object.values(local.animeData || {}).reduce((s, a) => s + (a.episodes?.length || 0), 0);
        const mergedEps = Object.values(mergedAnime).reduce((s, a) => s + (a.episodes?.length || 0), 0);
        const animeChanged = !areAnimeDataMapsEqual(local.animeData || {}, mergedAnime);

        const progressChanged = !areProgressMapsEqual(local.videoProgress || {}, mergedProgress);
        const deletedChanged  = !shallowEqualDeletedAnime(local.deletedAnime || {}, mergedDeleted);
        const groupChanged    = !shallowEqualObjectMap(localGroup, mergedGroup);

        if (animeChanged || progressChanged || deletedChanged || groupChanged) {
            pauseSync(5000);
            await bgStorageSet({
                animeData:        mergedAnime,
                videoProgress:    mergedProgress,
                deletedAnime:     mergedDeleted,
                groupCoverImages: mergedGroup
            });
            console.log(`[BG-RT] ← Cloud update applied (eps: ${localEps}→${mergedEps})`);
        }
    } catch (e) {
        console.warn('[BG-RT] Apply update failed:', e.message);
    }
}

async function startRealtimeListener() {
    if (rtConsecutiveFailures >= RT_MAX_FAILURES) {
        console.warn(`[BG-RT] ${RT_MAX_FAILURES} consecutive failures — pausing listener. Will retry on next alarm.`);
        return;
    }

    if (rtListenAbort) rtListenAbort.abort();
    if (rtReconnectTimer) { clearTimeout(rtReconnectTimer); rtReconnectTimer = null; }

    const user  = await getFirebaseUser();
    const token = await getFirebaseToken();
    if (!user || !token) {
        rtReconnectTimer = setTimeout(startRealtimeListener, 15000);
        return;
    }

    // ── Catch-up fetch ────────────────────────────────────────────────────────
    const gapSinceLastMessage = Date.now() - lastStreamMessageAt;
    if (gapSinceLastMessage > 45000) {
        console.debug(`[BG-RT] Catching up after ${Math.round(gapSinceLastMessage / 1000)}s gap...`);
        try {
            const cloudDoc = await fetchCloudData(user, token);
            if (cloudDoc) await applyCloudUpdate(cloudDoc);
        } catch (e) {
            console.warn('[BG-RT] Catch-up fetch failed:', e.message);
        }
    }

    rtListenAbort = new AbortController();
    const docPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${user.uid}`;

    console.debug('[BG-RT] Opening real-time stream...');
    let streamSucceeded = false;
    try {
        const res = await fetch(`${LISTEN_URL}?key=${FIREBASE_API_KEY}`, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ addTarget: { documents: { documents: [docPath] }, targetId: 1 } }),
            signal:  rtListenAbort.signal
        });

        if (!res.ok) {
            scheduleRtReconnect();
            return;
        }

        rtConsecutiveFailures = 0;
        streamSucceeded = true;
        rtReconnectDelay = 5000;
        markStreamAlive();
        console.debug('[BG-RT] ✓ Real-time stream connected');

        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer    = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            markStreamAlive();

            buffer += decoder.decode(value, { stream: true });
            // Guard against unbounded buffer growth
            if (buffer.length > 256 * 1024) {
                console.warn('[BG-RT] SSE buffer overflow, reconnecting');
                rtListenAbort.abort();
                scheduleRtReconnect();
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
                        // Token expired mid-stream — refresh and reconnect
                        rtListenAbort.abort();
                        setTimeout(startRealtimeListener, 1000);
                        return;
                    }
                } catch {
                    // Ignore non-JSON stream fragments
                }
            }
        }
    } catch (e) {
        if (e.name === 'AbortError') return;
        console.warn('[BG-RT] Stream error:', e.message);
    }

    if (!streamSucceeded) {
        rtConsecutiveFailures++;
    }
    scheduleRtReconnect();
}

function scheduleRtReconnect() {
    const delay = rtReconnectDelay === 5000 ? 2000 : rtReconnectDelay;
    rtReconnectTimer = setTimeout(startRealtimeListener, delay);
    rtReconnectDelay = Math.min(rtReconnectDelay * 1.5, RT_MAX_DELAY);
}

// ─── Storage change listener ──────────────────────────────────────────────────

let progressSyncDebounce = null;

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;

    // ── Coalesced sync: collect all changes within window, then fire ONE sync ──
    // Instead of separate debounces for videoProgress vs animeData vs groupCover,
    // use a single unified debounce that picks the right sync type.

    let _pendingProgressSync = false;
    let _pendingFullSync     = false;

    if (changes.videoProgress && !isSyncPaused()) {
        _pendingProgressSync = true;
    }

    if (changes.animeData && !isSyncPaused()) {
        const oldAnime = changes.animeData.oldValue || {};
        const newAnime = changes.animeData.newValue || {};

        const oldCount = Object.values(oldAnime).reduce((s, a) => s + (a.episodes?.length || 0), 0);
        const newCount = Object.values(newAnime).reduce((s, a) => s + (a.episodes?.length || 0), 0);

        let metadataChanged = false;
        if (newCount === oldCount) {
            for (const slug of Object.keys(newAnime)) {
                const oldEntry = oldAnime[slug];
                const newEntry = newAnime[slug];
                if ((oldEntry?.coverImage || null) !== (newEntry?.coverImage || null) ||
                    (oldEntry?.droppedAt || null) !== (newEntry?.droppedAt || null) ||
                    (oldEntry?.completedAt || null) !== (newEntry?.completedAt || null) ||
                    (oldEntry?.totalEpisodes || null) !== (newEntry?.totalEpisodes || null) ||
                    (oldEntry?.title || '') !== (newEntry?.title || '')) {
                    metadataChanged = true;
                    break;
                }
            }
            if (!metadataChanged && Object.keys(oldAnime).length !== Object.keys(newAnime).length) {
                metadataChanged = true;
            }
        }

        if (newCount > oldCount || metadataChanged) {
            if (newCount > oldCount) {
                console.log(
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

    // Coalesce: full sync supersedes progress-only sync
    if (_pendingFullSync) {
        if (progressSyncDebounce) { clearTimeout(progressSyncDebounce); progressSyncDebounce = null; }
        if (syncDebounceTimeout) clearTimeout(syncDebounceTimeout);
        syncDebounceTimeout = setTimeout(() => { syncDebounceTimeout = null; syncToFirebase(); }, 5000);
    } else if (_pendingProgressSync) {
        if (progressSyncDebounce) clearTimeout(progressSyncDebounce);
        progressSyncDebounce = setTimeout(() => {
            progressSyncDebounce = null;
            // Skip if a full sync is already scheduled
            if (syncDebounceTimeout) return;
            syncProgressOnly();
        }, 8000);
    }

    if (changes.animeData) {
        maybeStartPendingMetadataRepair().catch((error) => {
            console.error('[BG] Failed to honor pending repair request:', error);
        });
    }
});

// ─── AnimeFillerList slug discovery ──────────────────────────────────────────

// Direct an1me.to slug → animefillerlist.com slug mappings for well-known series.
// Avoids HEAD request discovery entirely for these entries.
// Add new entries here instead of relying on the generic heuristic.
const KNOWN_FILLER_SLUGS = {
    'naruto':                                'naruto',
    'naruto-shippuuden':                     'naruto-shippuden',
    'one-piece':                             'one-piece',
    'bleach':                                'bleach',
    'bleach-sennen-kessen-hen':              'bleach',
    'dragon-ball-z':                         'dragon-ball-z',
    'dragon-ball-super':                     'dragon-ball-super',
    'fairy-tail':                            'fairy-tail',
    'shingeki-no-kyojin':                    'attack-on-titan',
    'kimetsu-no-yaiba':                      'demon-slayer-kimetsu-no-yaiba',
    'boku-no-hero-academia':                 'my-hero-academia',
    'hunter-x-hunter-2011':                 'hunter-x-hunter-2011',
    'fullmetal-alchemist-brotherhood':       'fullmetal-alchemist-brotherhood',
    'sword-art-online':                      'sword-art-online',
    'black-clover':                          'black-clover',
    'boruto-naruto-next-generations':        'boruto-naruto-next-generations',
    'one-punch-man':                         'one-punch-man',
    'jujutsu-kaisen':                        'jujutsu-kaisen',
    'shingeki-no-kyojin-season-2':           'attack-on-titan',
    'shingeki-no-kyojin-season-3':           'attack-on-titan',
    'shingeki-no-kyojin-the-final-season':   'attack-on-titan',
};

const fillerSlugCache = {};

function generateFillerSlugCandidates(an1meSlug, animeTitle) {
    const seen = new Set();
    const candidates = [];

    function add(s) {
        if (!s || s.length < 2) return;
        const clean = s.replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
        if (clean && !seen.has(clean)) { seen.add(clean); candidates.push(clean); }
    }

    function addWithStripping(s) {
        add(s);
        const stripped = s
            .replace(/-the-final-season-kanketsu-hen$/i, '')
            .replace(/-the-final-season-part-\d+$/i, '')
            .replace(/-the-final-season$/i, '')
            .replace(/-season-\d+-part-\d+$/i, '')
            .replace(/-season-?\d+$/i, '')
            .replace(/-s\d+$/i, '')
            .replace(/-(2nd|3rd|4th|5th|6th|7th)-season$/i, '')
            .replace(/-(part|cour)-?\d+$/i, '')
            .replace(/-(final|last)-season$/i, '')
            .replace(/-new-world$/i, '')
            .replace(/-[a-z]+-hen$/i, '')
            .replace(/-(ii|iii|iv|v|vi)$/i, '')
            .replace(/-[2-9]$/i, '')
            .replace(/-\d{4}$/i, '');
        if (stripped && stripped !== s) add(stripped);
    }

    const slug = an1meSlug
        .replace(/-episode.*$/i, '')
        .replace(/-ep-?\d+$/i, '')
        .toLowerCase();

    addWithStripping(slug);

    if (slug.includes('shippuuden')) {
        addWithStripping(slug.replace(/shippuuden/g, 'shippuden'));
    }

    if (slug.includes('sennen-kessen-hen')) {
        addWithStripping(slug.replace(/sennen-kessen-hen.*/i, 'thousand-year-blood-war'));
    }

    const JP_TO_EN = {
        'shingeki-no-kyojin':             'attack-titan',
        'kimetsu-no-yaiba':               'demon-slayer-kimetsu-no-yaiba',
        'boku-no-hero-academia':          'my-hero-academia',
        'hagane-no-renkinjutsushi':       'fullmetal-alchemist',
        'ansatsu-kyoushitsu':             'assassination-classroom',
        'nanatsu-no-taizai':             'seven-deadly-sins',
        'yakusoku-no-neverland':          'promised-neverland',
        'tensei-shitara-slime-datta-ken': 'that-time-i-got-reincarnated-slime',
        'kenpuu-denki':                   'berserk',
        'naruto-shippuuden':              'naruto-shippuden',  // AnimeFillerList uses 'shippuden'
    };
    for (const [jpBase, enBase] of Object.entries(JP_TO_EN)) {
        if (slug.startsWith(jpBase)) {
            add(enBase);
            const suffix = slug.slice(jpBase.length);
            if (suffix) addWithStripping(enBase + suffix);
        }
    }

    if (animeTitle) {
        const titleSlug = String(animeTitle)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        addWithStripping(titleSlug);
    }

    return candidates;
}

async function discoverFillerSlug(an1meSlug, animeTitle, options = {}) {
    const { forceRefresh = false } = options;
    const cacheKey = an1meSlug.toLowerCase();

    if (!forceRefresh && cacheKey in fillerSlugCache) return fillerSlugCache[cacheKey];

    // Check pre-defined known mappings first — no HEAD request needed
    if (cacheKey in KNOWN_FILLER_SLUGS) {
        const known = KNOWN_FILLER_SLUGS[cacheKey];
        fillerSlugCache[cacheKey] = known;
        return known;
    }

    const storageKey = `fillerslug_${cacheKey}`;
    if (forceRefresh) {
        delete fillerSlugCache[cacheKey];
        try {
            await bgStorageRemove([storageKey]);
        } catch (e) {
            console.warn('[BG] Failed to clear filler slug cache before refresh:', e.message);
        }
    }

    try {
        const stored = await bgStorageGet([storageKey]);
        const cached = stored[storageKey];
        if (cached !== undefined) {
            if (typeof cached === 'string') {
                fillerSlugCache[cacheKey] = cached;
                return cached;
            }
            if (cached?.notFound) {
                // 3-day TTL — must match FILLER_NOT_FOUND_CACHE_TTL in src/popup/config.js
                const age = cached.cachedAt ? Date.now() - cached.cachedAt : Infinity;
                if (age < 3 * 24 * 60 * 60 * 1000) {
                    fillerSlugCache[cacheKey] = null;
                    return null;
                }
                await bgStorageRemove([storageKey]);
            }
        }
    } catch (e) {
        console.warn('[BG] discoverFillerSlug storage read failed:', e.message);
    }

    // Try candidates in parallel (cap at 5 to avoid hammering the server)
    const candidates = generateFillerSlugCandidates(an1meSlug, animeTitle).slice(0, 5);
    const tryCandidate = async (candidate) => {
        const headCtrl = new AbortController();
        const timer = setTimeout(() => headCtrl.abort(), 10000);
        try {
            const resp = await fetch(`https://www.animefillerlist.com/shows/${candidate}`, { method: 'HEAD', signal: headCtrl.signal });
            if (resp.ok) return candidate;
        } catch {}
        finally { clearTimeout(timer); }
        return null;
    };

    const results = await Promise.all(candidates.map(tryCandidate));
    const found = results.find(r => r !== null) ?? null;

    if (found) {
        fillerSlugCache[cacheKey] = found;
        await bgStorageSet({ [storageKey]: found });
        console.log(`[AnimeTracker] Filler slug discovered: ${an1meSlug} → ${found}`);
        return found;
    }

    const notFoundEntry = { notFound: true, cachedAt: Date.now() };
    fillerSlugCache[cacheKey] = null;
    try {
        await bgStorageSet({ [storageKey]: notFoundEntry });
    } catch (e) {
        console.warn('[BG] Failed to cache notFound filler slug:', e.message);
    }
    console.log(`[AnimeTracker] No filler data for ${an1meSlug} (tried ${candidates.length} candidates)`);
    return null;
}

// ─── an1me.to anime info fetcher ─────────────────────────────────────────────

async function fetchAnimePageInfo(slug) {
    const url = `https://an1me.to/anime/${slug}/`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let response;
    try {
        response = await fetch(url, { signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();

    // ── Episode count ────────────────────────────────────────────────────────
    // Try multiple patterns: Greek label, English label, generic <dt> with number.
    // After capturing the <dd> block, strip all HTML tags and grab the first
    // 1-4 digit number so formats like "220 επεισόδια" or "220 Episodes" work.
    let totalEpisodes = null;
    const epDdMatch = html.match(
        /(?:Επεισόδια|Episodes?)<\/dt>\s*(<dd[^>]*>[\s\S]{0,300}?<\/dd>)/
    );
    if (epDdMatch) {
        const text = epDdMatch[1].replace(/<[^>]+>/g, ' ');
        const numMatch = text.match(/\b(\d{1,4})\b/);
        if (numMatch) totalEpisodes = parseInt(numMatch[1], 10);
    }

    // Always scan episode links on the page for the highest actually available episode.
    let latestEpisode = null;
    {
        const epPattern = new RegExp(`/watch/${slug}-episode-(\\d+)`, 'gi');
        let m;
        let maxEp = 0;
        while ((m = epPattern.exec(html)) !== null) {
            const n = parseInt(m[1], 10);
            if (n > maxEp) maxEp = n;
        }
        if (maxEp > 0) latestEpisode = maxEp;
    }

    // Fallback: if metadata didn't give totalEpisodes, use episode links
    if (!totalEpisodes && latestEpisode) {
        totalEpisodes = latestEpisode;
    }

    // ── Status ───────────────────────────────────────────────────────────────
    // Try Greek "Προβλήθηκε" and English "Aired" <dt> labels.
    // A "?" in the date text means the end date is unknown → still airing.
    // Also recognise explicit "Finished Airing" / "Currently Airing" text.
    let status = null;
    const dateMatch = html.match(
        /(?:Προβλήθηκε|Aired?)<\/dt>[\s\S]{0,300}?<time[^>]*>([\s\S]*?)<\/time>/
    );
    if (dateMatch) {
        const dateText = dateMatch[1].replace(/\s+/g, ' ').trim();
        status = dateText.includes('?') ? 'RELEASING' : 'FINISHED';
    }

    if (!status) {
        if (/Finished\s+Airing|Ολοκληρώθηκε/i.test(html)) status = 'FINISHED';
        else if (/Currently\s+Airing|Προβάλλεται\s+τώρα/i.test(html)) status = 'RELEASING';
    }

    // Check for an explicit "Airing" badge on the page (the site marks anime
    // as Airing when episodes are still being uploaded, e.g. ongoing translations,
    // even if the original air dates are complete).
    if (status === 'FINISHED' || !status) {
        if (/>Airing<\//i.test(html)) status = 'RELEASING';
    }

    // If the date metadata says FINISHED but not all episodes are on the site yet,
    // the anime is effectively still releasing (e.g. ongoing fan translations).
    if (status === 'FINISHED' && totalEpisodes && latestEpisode && latestEpisode < totalEpisodes) {
        status = 'RELEASING';
    }

    return { totalEpisodes, status, latestEpisode };
}

// ─── Episode type fetcher ─────────────────────────────────────────────────────

async function fetchEpisodeTypesFromAnimeFillerList(animeSlug) {
    try {
        const url      = `https://www.animefillerlist.com/shows/${animeSlug}`;
        const ctrl     = new AbortController();
        const timer    = setTimeout(() => ctrl.abort(), 15000);
        let response;
        try {
            response = await fetch(url, { signal: ctrl.signal });
        } finally {
            clearTimeout(timer);
        }
        if (!response.ok) {
            if (response.status === 404) return null;
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const html         = await response.text();
        const episodeTypes = { canon: [], filler: [], mixed: [], anime_canon: [], totalEpisodes: null };

        const trPattern = /<tr[^>]*\bclass=["']([^"']+)["'][^>]*>([\s\S]*?)<\/tr>/gi;
        let trMatch;
        while ((trMatch = trPattern.exec(html)) !== null) {
            const classes    = trMatch[1].toLowerCase();
            const rowContent = trMatch[2];

            let type = null;
            if (/\bmanga_canon\b/.test(classes))     type = 'canon';
            else if (/\bmixed_canon/.test(classes))  type = 'mixed';
            else if (/\banime_canon\b/.test(classes)) type = 'anime_canon';
            else if (/\bfiller\b/.test(classes))     type = 'filler';

            if (!type) continue;

            const numMatch = rowContent.match(/>(\d+)</);
            if (!numMatch) continue;

            const epNum = parseInt(numMatch[1], 10);
            if (!Number.isFinite(epNum) || epNum <= 0) continue;

            episodeTypes[type].push(epNum);
        }

        for (const key of ['canon', 'filler', 'mixed', 'anime_canon']) {
            episodeTypes[key] = [...new Set(episodeTypes[key])].sort((a, b) => a - b);
        }

        const all = [
            ...episodeTypes.canon,
            ...episodeTypes.mixed,
            ...episodeTypes.filler,
            ...episodeTypes.anime_canon
        ];
        if (all.length > 0) episodeTypes.totalEpisodes = Math.max(...all);

        // If nothing was parsed at all, treat as not-found rather than caching empty data
        if (all.length === 0) {
            console.warn(`[Anime Tracker] ⚠ No episodes parsed for ${animeSlug} — site structure may have changed`);
            return null;
        }

        console.log(`[Anime Tracker] ✓ Fetched episode types for ${animeSlug}:`, episodeTypes);
        return episodeTypes;
    } catch (error) {
        console.error(`[Anime Tracker] ✗ Failed for ${animeSlug}:`, error);
        throw error;
    }
}

let metadataRepairInProgress = false;

async function repairAnimeInfoCache(slug, forceRefresh = true) {
    const key = `animeinfo_${slug}`;
    const stored = await bgStorageGet([key]);
    const cached = stored[key];

    if (!forceRefresh && isAnimeInfoCacheFresh(cached)) {
        return cached?.notFound
            ? { status: 'unavailable', entry: cached }
            : { status: 'cached', entry: cached };
    }

    try {
        const info = await fetchAnimePageInfo(slug);
        const entry = { ...info, cachedAt: Date.now() };
        await bgStorageSet({ [key]: entry });
        return { status: 'fetched', entry };
    } catch (error) {
        const message = String(error?.message || '').toLowerCase();
        if (message.includes('http 404')) {
            const notFoundEntry = { notFound: true, cachedAt: Date.now() };
            await bgStorageSet({ [key]: notFoundEntry });
            return { status: 'unavailable', entry: notFoundEntry };
        }
        throw error;
    }
}

async function repairEpisodeTypesCache(slug, title, forceRefresh = true) {
    if (isLikelyMovieSlug(slug)) {
        return { status: 'movie' };
    }

    const key = `episodeTypes_${slug}`;
    const stored = await bgStorageGet([key]);
    const cached = stored[key];

    if (!forceRefresh && isEpisodeTypesCacheFresh(cached)) {
        return cached?.notFound
            ? { status: 'nofill', entry: cached }
            : {
                status: 'cached',
                entry: cached,
                fillerCount: cached?.filler?.length || 0,
                totalEpisodes: cached?.totalEpisodes || null
            };
    }

    const fillerSlug = await discoverFillerSlug(slug, title || null, { forceRefresh });
    if (!fillerSlug) {
        const notFoundEntry = { notFound: true, cachedAt: Date.now() };
        await bgStorageSet({ [key]: notFoundEntry });
        return { status: 'nofill', entry: notFoundEntry };
    }

    const episodeTypes = await fetchEpisodeTypesFromAnimeFillerList(fillerSlug);
    if (!episodeTypes) {
        const notFoundEntry = { notFound: true, cachedAt: Date.now() };
        await bgStorageSet({ [key]: notFoundEntry });
        return { status: 'nofill', entry: notFoundEntry };
    }

    const entry = {
        ...episodeTypes,
        cachedAt: Date.now(),
        _fillerSlug: fillerSlug || null
    };
    await bgStorageSet({ [key]: entry });
    return {
        status: 'fetched',
        entry,
        fillerCount: entry.filler?.length || 0,
        totalEpisodes: entry.totalEpisodes || null
    };
}

async function finalizeMetadataRepair(state, patch = {}) {
    const finalState = {
        ...state,
        ...patch,
        currentSlug: null,
        currentTitle: null,
        updatedAt: new Date().toISOString()
    };
    await setMetadataRepairState(finalState);
    await chrome.alarms.clear(METADATA_REPAIR_ALARM);
    return finalState;
}

async function runMetadataRepairBatch(options = {}) {
    const { maxItems = METADATA_REPAIR_ITEMS_PER_TICK } = options;

    if (metadataRepairInProgress) return false;
    metadataRepairInProgress = true;

    try {
        let state = await getMetadataRepairState();
        if (!state || state.status !== 'running') {
            await chrome.alarms.clear(METADATA_REPAIR_ALARM);
            return false;
        }

        for (let step = 0; step < maxItems; step++) {
            state = await getMetadataRepairState();
            if (!state || state.status !== 'running') {
                await chrome.alarms.clear(METADATA_REPAIR_ALARM);
                return false;
            }

            const items = Array.isArray(state.items) ? state.items : [];
            const index = Number.isFinite(Number(state.queueIndex))
                ? Number(state.queueIndex)
                : Math.min(Number(state.processed) || 0, items.length);

            if (index >= items.length) {
                await finalizeMetadataRepair(state, {
                    status: 'completed',
                    completedAt: new Date().toISOString()
                });
                return true;
            }

            const item = items[index];
            const startedAt = new Date().toISOString();
            if (state.currentSlug !== item.slug || state.currentTitle !== item.title) {
                state = {
                    ...state,
                    currentSlug: item.slug,
                    currentTitle: item.title || item.slug,
                    updatedAt: startedAt
                };
                await setMetadataRepairState(state);
            }

            let infoResult = { status: 'cached' };
            let fillerResult = { status: 'cached' };
            let logEntry;

            try {
                infoResult = await runMetadataRepairWithRetry(
                    () => repairAnimeInfoCache(item.slug, state.options?.forceInfoRefresh !== false)
                );
            } catch (error) {
                infoResult = { status: 'failed', error: error.message };
            }

            try {
                fillerResult = await runMetadataRepairWithRetry(
                    () => repairEpisodeTypesCache(
                        item.slug,
                        item.title || item.slug,
                        state.options?.forceFillerRefresh !== false
                    )
                );
            } catch (error) {
                fillerResult = { status: 'failed', error: error.message };
            }

            logEntry = buildMetadataRepairLog(item.slug, item.title || item.slug, infoResult, fillerResult);
            const counts = countMetadataRepairOutcome(logEntry);
            const processed = (Number(state.processed) || 0) + 1;
            const nextQueueIndex = index + 1;
            const nextItem = items[nextQueueIndex] || null;
            const updatedAt = new Date().toISOString();

            state = {
                ...state,
                processed,
                queueIndex: nextQueueIndex,
                fetched: (state.fetched || 0) + counts.fetched,
                cached: (state.cached || 0) + counts.cached,
                skipped: (state.skipped || 0) + counts.skipped,
                failed: (state.failed || 0) + counts.failed,
                logs: appendMetadataRepairLog(state.logs, logEntry),
                lastLog: logEntry,
                currentSlug: nextItem?.slug || null,
                currentTitle: nextItem?.title || null,
                updatedAt
            };

            if (nextQueueIndex >= items.length) {
                await finalizeMetadataRepair(state, {
                    status: 'completed',
                    completedAt: updatedAt
                });
                return true;
            }

            await setMetadataRepairState(state);
            await delay(METADATA_REPAIR_INTER_ITEM_DELAY_MS);
        }

        scheduleMetadataRepairTick(500);
        return true;
    } catch (error) {
        console.error('[BG] Library repair failed:', error);
        const state = await getMetadataRepairState();
        if (state?.status === 'running') {
            await finalizeMetadataRepair(state, {
                status: 'error',
                errorMessage: error.message || 'Unknown repair error',
                completedAt: new Date().toISOString()
            });
        }
        return false;
    } finally {
        metadataRepairInProgress = false;
    }
}

async function startLibraryRepair(options = {}) {
    await bgStorageSet({ [PENDING_METADATA_REPAIR_KEY]: false });

    const existing = await getMetadataRepairState();
    if (existing?.status === 'running') {
        scheduleMetadataRepairTick(0);
        runMetadataRepairBatch({ maxItems: 1 }).catch((error) => {
            console.error('[BG] Failed to resume running repair:', error);
        });
        return existing;
    }

    const stored = await bgStorageGet(['animeData']);
    const animeData = stored.animeData || {};
    const plan = await buildLibraryRepairPlan(animeData, options);
    const now = new Date().toISOString();

    let state = {
        status: 'running',
        startedAt: now,
        updatedAt: now,
        completedAt: null,
        errorMessage: null,
        total: plan.total,
        processed: plan.processed,
        queueIndex: plan.queueIndex,
        fetched: 0,
        cached: plan.cached,
        skipped: plan.skipped,
        failed: 0,
        currentSlug: plan.items[0]?.slug || null,
        currentTitle: plan.items[0]?.title || null,
        items: plan.items,
        logs: [],
        options: {
            forceInfoRefresh: plan.forceInfoRefresh,
            forceFillerRefresh: plan.forceFillerRefresh
        }
    };

    if (plan.total === 0 || plan.items.length === 0) {
        state = {
            ...state,
            status: 'completed',
            completedAt: now,
            currentSlug: null,
            currentTitle: null
        };
        await setMetadataRepairState(state);
        await chrome.alarms.clear(METADATA_REPAIR_ALARM);
        return state;
    }

    await setMetadataRepairState(state);
    scheduleMetadataRepairTick(0);
    runMetadataRepairBatch({ maxItems: 1 }).catch((error) => {
        console.error('[BG] Failed to start library repair batch:', error);
    });
    return state;
}

async function maybeStartPendingMetadataRepair() {
    const stored = await bgStorageGet([PENDING_METADATA_REPAIR_KEY]);
    if (!stored[PENDING_METADATA_REPAIR_KEY]) return false;
    await startLibraryRepair({
        forceInfoRefresh: false,
        forceFillerRefresh: false
    });
    return true;
}

async function resumeMetadataRepairIfNeeded() {
    const state = await getMetadataRepairState();
    if (state?.status !== 'running') return;
    scheduleMetadataRepairTick(0);
    runMetadataRepairBatch({ maxItems: 1 }).catch((error) => {
        console.error('[BG] Failed to resume metadata repair on boot:', error);
    });
}

// ─── Migration ────────────────────────────────────────────────────────────────

async function migrateFromSyncToLocal() {
    try {
        const syncData        = await new Promise((resolve, reject) => {
            chrome.storage.sync.get(['animeData', 'videoProgress'], (result) => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(result);
            });
        });
        const validAnimeData  = syncData.animeData
            && typeof syncData.animeData === 'object'
            && !Array.isArray(syncData.animeData);
        const validVideoProgress = syncData.videoProgress
            && typeof syncData.videoProgress === 'object'
            && !Array.isArray(syncData.videoProgress);
        const hasSyncData = (validAnimeData    && Object.keys(syncData.animeData).length > 0) ||
                            (validVideoProgress && Object.keys(syncData.videoProgress).length > 0);
        if (hasSyncData) {
            const localData = await bgStorageGet(['animeData', 'videoProgress']);
            const merged    = {
                animeData:     { ...(validAnimeData     ? syncData.animeData    : {}), ...(localData.animeData    || {}) },
                videoProgress: { ...(validVideoProgress ? syncData.videoProgress : {}), ...(localData.videoProgress || {}) }
            };
            await bgStorageSet(merged);
            await new Promise((resolve) => {
                chrome.storage.sync.remove(['animeData', 'trackedEpisodes', 'videoProgress'], () => resolve());
            });
            console.log('[Anime Tracker] Migration complete');
        }
    } catch (error) {
        console.error('[Anime Tracker] Migration error:', error);
    }
}

// ─── Message handler ──────────────────────────────────────────────────────────

function normalizeTrackedDuration(duration) {
    const MAX_REASONABLE_DURATION_SECONDS = 6 * 60 * 60;
    let value = Math.round(Number(duration) || 0);
    if (!Number.isFinite(value) || value <= 0) value = 0;
    if (value > MAX_REASONABLE_DURATION_SECONDS) value = MAX_REASONABLE_DURATION_SECONDS;
    return value;
}

function isPlaceholderDuration(duration) {
    const d = Number(duration) || 0;
    return d <= 0 || d === 1440 || d === 6000 || d === 7200;
}

async function persistBeforeUnloadTrack(animeInfo, duration) {
    if (!animeInfo?.animeSlug || !animeInfo?.episodeNumber) {
        throw new Error('Invalid animeInfo for TRACK_BEFORE_UNLOAD');
    }

    const result = await bgStorageGet(['animeData', 'videoProgress']);
    const animeData     = result.animeData     || {};
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

    // Auto-undrop: if user watches a new episode of a dropped anime, undrop it
    if (animeData[slug].droppedAt) {
        delete animeData[slug].droppedAt;
        console.log('[BG] Auto-undropped anime (new episode tracked):', slug);
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'GET_STATS') {
        bgStorageGet(['animeData'])
            .then((result) => {
                const data = result.animeData || {};
                sendResponse({
                    totalAnime:     Object.keys(data).length,
                    totalEpisodes:  Object.values(data).reduce((s, a) => s + (a.episodes?.length || 0), 0),
                    totalWatchTime: Object.values(data).reduce((s, a) => s + (a.totalWatchTime    || 0), 0)
                });
            })
            .catch((e) => sendResponse({ error: e.message }));
        return true;
    }

    if (message.type === 'CLEAR_DATA') {
        chrome.alarms.clear(METADATA_REPAIR_ALARM).catch?.(() => {});
        bgStorageSet({
            animeData: {},
            videoProgress: {},
            deletedAnime: {},
            groupCoverImages: {},
            [METADATA_REPAIR_STATE_KEY]: null,
            [PENDING_METADATA_REPAIR_KEY]: false
        })
            .then(() => sendResponse({ success: true }))
            .catch((e) => sendResponse({ success: false, error: e.message }));
        return true;
    }

    if (message.type === 'SYNC_TO_FIREBASE') {
        sendResponse({ received: true });
        if (syncDebounceTimeout) clearTimeout(syncDebounceTimeout);
        syncDebounceTimeout = setTimeout(() => { syncDebounceTimeout = null; syncToFirebase(); }, 500);
        return true;
    }

    if (message.type === 'SYNC_PROGRESS_ONLY') {
        sendResponse({ received: true });
        if (progressSyncDebounce) clearTimeout(progressSyncDebounce);
        progressSyncDebounce = setTimeout(() => { progressSyncDebounce = null; syncProgressOnly(); }, 500);
        return true;
    }

    if (message.type === 'GET_VERSION') {
        sendResponse({ version: chrome.runtime.getManifest().version });
        return true;
    }

    if (message.type === 'FETCH_ANIME_INFO') {
        if (!message.slug) { sendResponse({ error: 'Missing slug' }); return true; }
        fetchAnimePageInfo(message.slug)
            .then(info => sendResponse({ success: true, info }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (message.type === 'CLEAR_FILLER_CACHE') {
        // Allows the popup's FillerService.clearCache() to also purge the
        // background-side in-memory slug cache and the persisted storageKey.
        const slug = (message.animeSlug || '').toLowerCase();
        if (slug) {
            delete fillerSlugCache[slug];
            const storageKey = `fillerslug_${slug}`;
            bgStorageRemove([storageKey])
                .then(() => sendResponse({ success: true }))
                .catch((e) => sendResponse({ success: false, error: e.message }));
        } else {
            sendResponse({ success: false, error: 'Missing animeSlug' });
        }
        return true;
    }

    if (message.type === 'FETCH_EPISODE_TYPES') {
        if (!message.animeSlug) { sendResponse({ error: 'Missing animeSlug' }); return true; }
        (async () => {
            try {
                const fillerSlug = await discoverFillerSlug(message.animeSlug, message.animeTitle || null);
                if (!fillerSlug) {
                    sendResponse({ success: false, notFound: true, error: 'Not found on animefillerlist.com' });
                    return;
                }
                const episodeTypes = await fetchEpisodeTypesFromAnimeFillerList(fillerSlug);
                if (episodeTypes) {
                    sendResponse({ success: true, episodeTypes, fillerSlug });
                } else {
                    sendResponse({ success: false, error: 'Failed to parse episode types' });
                }
            } catch (error) {
                sendResponse({ success: false, error: error.message });
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

    sendResponse({ error: 'Unknown message type' });
    return true;
});

// ─── Lifecycle ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        bgStorageSet({
            animeData:    {},
            videoProgress: {},
            settings:     { watchThreshold: 0.85, notifications: true }
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
        console.log(`%c🎬 Anime Tracker v${chrome.runtime.getManifest().version}`, style);
        migrateFromSyncToLocal();
    }
    setTimeout(startRealtimeListener, 2000);
});

chrome.runtime.onStartup.addListener(() => {
    console.log('[Anime Tracker] Extension started');
    migrateFromSyncToLocal();
    setTimeout(startRealtimeListener, 2000);
});

// ─── Keep-alive port ──────────────────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'keepAlive') return;
    port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError;
        if (err) {
            const msg = err.message || '';
            const isExpectedClose = msg.includes('back/forward cache') || msg.includes('message channel is closed');
            if (!isExpectedClose) {
                console.debug('[BG] keepAlive port disconnected:', msg);
            }
        }
    });
});

// ─── Alarm: keep SW alive + health checks ────────────────────────────────────
chrome.alarms.create('keepAlive', { periodInMinutes: 0.33 });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === METADATA_REPAIR_ALARM) {
        runMetadataRepairBatch().catch((error) => {
            console.error('[BG] Metadata repair alarm failed:', error);
        });
        return;
    }

    if (alarm.name !== 'keepAlive') return;

    const streamDead = !rtListenAbort || rtListenAbort.signal.aborted;
    if (streamDead) {
        console.debug('[BG] keepAlive: stream dead, restarting...');
        rtConsecutiveFailures = 0;
        startRealtimeListener();
    }

    checkStreamHealth();

    resumeMetadataRepairIfNeeded().catch((error) => {
        console.error('[BG] Failed to resume metadata repair from keepAlive:', error);
    });
});

// ─── Stream health watchdog ───────────────────────────────────────────────────
let lastStreamMessageAt = Date.now();

function markStreamAlive() {
    lastStreamMessageAt = Date.now();
}

function checkStreamHealth() {
    const elapsed = Date.now() - lastStreamMessageAt;
    if (elapsed > 90000) {
        console.debug(`[BG] Stream silent for ${Math.round(elapsed / 1000)}s, reconnecting`);
        lastStreamMessageAt = Date.now();
        rtConsecutiveFailures = 0;
        if (rtListenAbort) rtListenAbort.abort();
        startRealtimeListener();
    }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
startRealtimeListener();
maybeStartPendingMetadataRepair().catch((error) => {
    console.error('[BG] Failed to start pending metadata repair on boot:', error);
});
resumeMetadataRepairIfNeeded().catch((error) => {
    console.error('[BG] Failed to resume metadata repair on boot:', error);
});
