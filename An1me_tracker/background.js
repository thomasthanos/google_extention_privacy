


importScripts(
    'src/common/firebase-config.js',
    'src/common/auth-classifier.js',
    'src/common/auth-tokens.js',
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
const stripAutoRepairedEpisodesFromMap = sharedMergeUtils.stripAutoRepairedEpisodesFromMap
    || ((m) => m);

const BG_DEBUG = false;
const dlog = (...a) => { if (BG_DEBUG) console.log(...a); };
const ddebug = (...a) => { if (BG_DEBUG) console.debug(...a); };

const COMPLETED_PERCENTAGE = 85;
const DELETED_ANIME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PROGRESS_ENTRIES = 200;




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
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
    }, timeoutMs);
    try {
        return await fetch(url, { ...options, signal: ctrl.signal });
    } catch (error) {
        if (timedOut) {
            const timeoutError = new Error(`Request timed out after ${Math.ceil(timeoutMs / 1000)}s`);
            timeoutError.name = 'TimeoutError';
            timeoutError.isTimeout = true;
            throw timeoutError;
        }
        throw error;
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

                if (anime.onHoldAt || anime.listState === 'on_hold') continue;


                if (ep?.durationSource === 'anilist') continue;
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


const DAILY_CLEANUP_ALARM = 'dailyCleanup';
const DAILY_CLEANUP_USAGE_THRESHOLD = 0.70;
const DAILY_CLEANUP_TARGET = 0.70;
const QUOTA_BYTES_BG = 10 * 1024 * 1024;

function bgMeasureBytes() {
    return new Promise((res) => {
        try { chrome.storage.local.getBytesInUse(null, (b) => { void chrome.runtime.lastError; res(Number(b) || 0); }); }
        catch { res(0); }
    });
}






async function bgIterativeQuotaRecovery(reason = 'daily-alarm') {
    try {
        const bytesBefore = await bgMeasureBytes();
        const target = Math.round(QUOTA_BYTES_BG * DAILY_CLEANUP_TARGET);
        if (bytesBefore <= target) {
            dlog(`[Cleanup] skip (${bytesBefore} ≤ ${target} bytes; reason=${reason})`);
            return { ok: true, bytesBefore, bytesAfter: bytesBefore, passes: 0 };
        }
        const all = await new Promise((resolve, reject) => {
            chrome.storage.local.get(null, (result) => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(result || {});
            });
        });

        const cacheKeys = Object.keys(all).filter((k) =>
            k.startsWith('animeinfo_') || k.startsWith('episodeTypes_')
        );
        if (cacheKeys.length > 0) await bgStorageRemove(cacheKeys);

        const localAnime = all.animeData || {};
        const localProgress = all.videoProgress || {};
        const localDeleted = all.deletedAnime || {};
        const cleaned = cleanTrackedProgressBg(localAnime, localProgress, localDeleted);
        const sorted = Object.entries(cleaned).sort((a, b) => {
            const aTs = new Date(a[1]?.savedAt || a[1]?.watchedAt || 0).getTime() || 0;
            const bTs = new Date(b[1]?.savedAt || b[1]?.watchedAt || 0).getTime() || 0;
            return bTs - aTs;
        });
        let cap = Math.min(2000, sorted.length);
        let trimmed = Object.fromEntries(sorted.slice(0, cap));

        const dCleaned = {};
        const dCutoff = Date.now() - 10 * 24 * 60 * 60 * 1000;
        const dEntries = Object.entries(localDeleted).sort((a, b) => {
            const aTs = new Date(a[1]?.deletedAt || 0).getTime() || 0;
            const bTs = new Date(b[1]?.deletedAt || 0).getTime() || 0;
            return bTs - aTs;
        });
        let dKept = 0;
        for (const [slug, info] of dEntries) {
            const ts = new Date(info?.deletedAt || 0).getTime() || 0;
            if (ts > 0 && ts < dCutoff) continue;
            dCleaned[slug] = info;
            dKept += 1;
            if (dKept >= 1500) break;
        }
        await bgStorageSet({ videoProgress: trimmed, deletedAnime: dCleaned });

        let bytesNow = await bgMeasureBytes();
        let pass = 1;
        const maxPasses = 3;
        while (bytesNow > target && pass < maxPasses && cap > 250) {
            pass += 1;
            cap = Math.max(250, Math.floor(cap / 2));
            trimmed = Object.fromEntries(sorted.slice(0, cap));
            await bgStorageSet({ videoProgress: trimmed });
            bytesNow = await bgMeasureBytes();
        }

        const ok = bytesNow <= target;
        console.log(
            `[Cleanup] daily prune: removed ${cacheKeys.length} cache entries, ` +
            `progress capped at ${cap} (was ${(bytesBefore / 1024 / 1024).toFixed(1)} MB → ` +
            `${(bytesNow / 1024 / 1024).toFixed(1)} MB) · reason=${reason} · passes=${pass}`
        );
        return { ok, bytesBefore, bytesAfter: bytesNow, passes: pass };
    } catch (e) {
        console.warn('[Cleanup] daily prune failed:', e?.message || e);
        return { ok: false, error: e?.message };
    }
}







async function ensureDailyCleanupAlarmScheduled() {
    try {
        const KEY = '_dailyCleanupNextAt';
        const stored = await bgStorageGet([KEY]);
        let nextAt = Number(stored[KEY]) || 0;
        const now = Date.now();
        if (!nextAt || nextAt < now) {

            const next = new Date();
            next.setDate(next.getDate() + 1);
            next.setHours(3 + Math.floor(Math.random() * 2));
            next.setMinutes(Math.floor(Math.random() * 60));
            next.setSeconds(Math.floor(Math.random() * 60));
            next.setMilliseconds(0);
            nextAt = next.getTime();
            await bgStorageSet({ [KEY]: nextAt });
        }
        try {
            chrome.alarms.create(DAILY_CLEANUP_ALARM, {
                when: nextAt,
                periodInMinutes: 1440
            });
            dlog(`[Cleanup] daily alarm scheduled for ${new Date(nextAt).toLocaleString()}`);
        } catch (e) {
            console.warn('[Cleanup] could not schedule alarm:', e?.message || e);
        }
    } catch (e) {
        console.warn('[Cleanup] scheduling check failed:', e?.message || e);
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




const PROGRESS_SYNC_ALARM = 'progressSyncDebounce';







const FULL_SYNC_RETRY_ALARM = 'fullSyncRetry';
const PROGRESS_SYNC_RETRY_ALARM = 'progressSyncRetry';


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



    invalidateBgCloudDocCache();


    clearAuthAndSyncAlarms().catch((e) => console.warn('[BG] alarm cleanup on sign-out failed:', e?.message || e));
}



















async function clearAuthAndSyncAlarms() {
    const names = [
        'auth-refresh-retry',
        AUTH_REFRESH_RETRY_BG_ALARM,
        PROGRESS_SYNC_ALARM,
        FULL_SYNC_RETRY_ALARM,
        PROGRESS_SYNC_RETRY_ALARM,
        'dailyCleanup'
    ];
    for (const n of names) {
        try { await chrome.alarms.clear(n); } catch {              }
    }
    dlog('[BG] Cleared auth + sync alarms (sign-out)');
}






function _broadcastAuthRejected(status, body) {
    try {
        chrome.runtime.sendMessage({
            type: 'AUTH_REJECTED',
            status,
            body: typeof body === 'string' ? body.slice(0, 240) : ''
        }, () => { void chrome.runtime.lastError; });
    } catch {                                                           }
}

async function getFirebaseToken() {
    try {
        const stored = await bgStorageGet(['firebase_tokens']);
        const tokens = stored.firebase_tokens;
        if (!tokens?.idToken) return null;







        if (tokens.needsReauth) {
            const stillValid = tokens.expiresAt && tokens.expiresAt > Date.now() + 30000;
            if (stillValid) return tokens.idToken;
            return null;
        }

        if (tokens.expiresAt < Date.now() + 120000) {
            const result = await refreshFirebaseToken(tokens.refreshToken);
            if (!result || !result.tokens) {





                if (result?.permanent) {
                    console.warn(`[BG] Refresh token rejected (permanent: ${result.error || '?'}) — signing out`);
                    await signOutDueToTokenFailure();
                    return null;
                }



                const stillValid = tokens.expiresAt && tokens.expiresAt > Date.now() + 30000;
                if (stillValid) {
                    console.warn(`[BG] Token refresh transiently failed (${result?.error || 'unknown'}); using existing token (${Math.round((tokens.expiresAt - Date.now()) / 1000)}s left)`);
                    return tokens.idToken;
                }


                console.warn(`[BG] Token refresh transiently failed and existing token expired; will retry on next call/alarm`);
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







function _bgClassifyRefreshError(httpStatus, errorBody) {
    const cl = self.AnimeTrackerAuthClassifier;
    if (!cl) {


        return false;
    }
    return cl.classify(httpStatus, errorBody).permanent;
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

            console.warn('[BG] Token refresh network error:', networkErr?.message || networkErr);
            await _bgOnRefreshTransient(`network: ${networkErr?.message || networkErr}`);
            return { tokens: null, permanent: false, error: `network: ${networkErr?.message || networkErr}` };
        }
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            const permanent = _bgClassifyRefreshError(response.status, body);
            console.warn(`[BG] Token refresh HTTP ${response.status} (${permanent ? 'permanent' : 'transient'}): ${body.slice(0, 200)}`);
            if (!permanent) await _bgOnRefreshTransient(`HTTP ${response.status}`);
            return { tokens: null, permanent, error: `HTTP ${response.status}` };
        }
        let data;
        try { data = await response.json(); } catch { data = null; }
        if (!data) {
            console.warn('[BG] Token refresh returned empty/invalid body — treating as transient');
            await _bgOnRefreshTransient('empty_body');
            return { tokens: null, permanent: false, error: 'empty_body' };
        }
        if (data.error) {
            const msg = data.error?.message || 'unknown';
            const permanent = _bgClassifyRefreshError(400, msg);
            console.warn(`[BG] Token refresh error (${permanent ? 'permanent' : 'transient'}): ${msg}`);
            if (!permanent) await _bgOnRefreshTransient(msg);
            return { tokens: null, permanent, error: msg };
        }
        if (!data.id_token || !data.refresh_token || !data.expires_in) {
            console.warn('[BG] Token refresh missing fields — treating as transient');
            await _bgOnRefreshTransient('missing_fields');
            return { tokens: null, permanent: false, error: 'missing_fields' };
        }
        const tokens = {
            idToken: data.id_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + parseInt(data.expires_in) * 1000
        };




        const tokensHelper = self.AnimeTrackerAuthTokens;
        if (tokensHelper) {



            await bgStorageSet({ firebase_tokens: { ...tokens, version: 2 } });
            await tokensHelper.markAuthCheckOk();
        } else {
            await bgStorageSet({ firebase_tokens: tokens });
        }

        try { chrome.alarms.clear(AUTH_REFRESH_RETRY_BG_ALARM).catch(() => {}); } catch {}
        dlog('[BG] Token refreshed');
        return { tokens, permanent: false, error: null };
    })();
    _bgRefreshInflight = p;
    p.finally(() => { if (_bgRefreshInflight === p) _bgRefreshInflight = null; });
    return p;
}









const AUTH_REFRESH_RETRY_BG_ALARM = 'auth-refresh-retry-bg';
const AUTH_REFRESH_BACKOFF_MIN = [1, 5, 15, 60, 360];
const MAX_AUTH_REFRESH_ATTEMPTS = AUTH_REFRESH_BACKOFF_MIN.length;
const AUTH_OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;






async function _bgOnRefreshTransient(reason) {
    const helper = self.AnimeTrackerAuthTokens;
    if (!helper) return;
    try {
        const updated = await helper.markAuthRefreshTransientFailure();
        if (!updated) return;
        const attempts = Number(updated.authRefreshAttempts) || 0;
        const lastOk = Number(updated.lastAuthCheck) || 0;
        const offlineFor = lastOk ? (Date.now() - lastOk) : 0;
        const exceededAttempts = attempts >= MAX_AUTH_REFRESH_ATTEMPTS;
        const exceededGrace = lastOk > 0 && offlineFor > AUTH_OFFLINE_GRACE_MS;

        if (exceededAttempts || exceededGrace) {
            await helper.setNeedsReauth(true);
            console.warn(`[BG] Auth: needsReauth=true (attempts=${attempts}, offlineFor=${Math.round(offlineFor / 86400000)}d, reason=${reason})`);

            try { chrome.alarms.clear(AUTH_REFRESH_RETRY_BG_ALARM).catch(() => {}); } catch {}
            return;
        }


        const idx = Math.min(attempts - 1, AUTH_REFRESH_BACKOFF_MIN.length - 1);
        const delayMin = AUTH_REFRESH_BACKOFF_MIN[idx];
        try {
            chrome.alarms.create(AUTH_REFRESH_RETRY_BG_ALARM, { delayInMinutes: delayMin });
            console.warn(`[BG] Auth refresh retry scheduled in ${delayMin} min (attempt ${attempts}/${MAX_AUTH_REFRESH_ATTEMPTS}, reason: ${reason})`);
        } catch (e) {
            console.warn('[BG] Could not arm auth-refresh-retry-bg alarm:', e?.message || e);
        }
    } catch (e) {
        console.warn('[BG] _bgOnRefreshTransient bookkeeping failed:', e?.message || e);
    }
}








async function _bgAuthRefreshRetryTick() {
    try {
        const helper = self.AnimeTrackerAuthTokens;
        const tokens = helper ? await helper.readTokens() : null;
        if (!tokens || !tokens.refreshToken) {

            try { chrome.alarms.clear(AUTH_REFRESH_RETRY_BG_ALARM).catch(() => {}); } catch {}
            return;
        }
        if (tokens.needsReauth) {


            try { chrome.alarms.clear(AUTH_REFRESH_RETRY_BG_ALARM).catch(() => {}); } catch {}
            return;
        }
        await refreshFirebaseToken(tokens.refreshToken);
    } catch (e) {
        console.warn('[BG] Auth retry tick failed:', e?.message || e);
    }
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







let _fetchInFlightUid = null;
let _fetchInFlightPromise = null;

async function fetchCloudData(user, token) {




    if (_fetchInFlightUid === user.uid && _fetchInFlightPromise) {
        return _fetchInFlightPromise;
    }

    const fetchPromise = (async () => {
        try {
            const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
            const response = await fetchWithTimeout(url, { headers: { 'Authorization': `Bearer ${token}` } });
            if (response.status === 404) {

                return null;
            }
            if (!response.ok) {




                const body = await response.text().catch(() => '');
                console.warn(`[BG] fetchCloudData HTTP ${response.status} for users/${user.uid.slice(0, 8)}…: ${body.slice(0, 160)}`);


                const err = new Error(`HTTP ${response.status}`);
                err.status = response.status;
                err.body = body;
                throw err;
            }
            return fromFSDoc(await response.json());
        } catch (e) {


            throw e;
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

async function pollCloudData(reason = 'consumer-connected', { force = false } = {}) {
    if (_cloudPollInFlight) return _cloudPollInFlight;

    _cloudPollInFlight = (async () => {
        try {
            await hydrateBgPollState();
            if (!force && (Date.now() - _lastCloudPollAt) < CLOUD_CONSUMER_POLL_MIN_GAP_MS) return null;








            await hydrateBgCloudDocCache();
            const user = await getFirebaseUser();
            const token = await getFirebaseToken();
            if (!user || !token) return null;

            const cacheFresh =
                !force &&
                _bgCloudDocCache &&
                _bgCloudDocCacheUid === user.uid &&
                (Date.now() - _bgCloudDocCacheTime) < _BG_CLOUD_TTL;
            if (cacheFresh) {




                _lastCloudPollAt = Date.now();
                persistBgPollState({ cloudPollAt: _lastCloudPollAt });
                dlog(`[BG-RT] Poll skipped (${reason}) — cache still fresh (${Math.round((Date.now() - _bgCloudDocCacheTime) / 1000)}s old)`);

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













let _bgCloudDocCache = null;
let _bgCloudDocCacheTime = 0;
let _bgCloudDocCacheUid = null;
const _BG_CLOUD_TTL = 10 * 60 * 1000;
const _BG_CLOUD_CACHE_KEY = '_bgCloudDocCachePersisted';




let _bgCloudCacheHydratePromise = null;
async function hydrateBgCloudDocCache() {
    if (_bgCloudDocCache) return;
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


                bgStorageSet({ [_BG_CLOUD_CACHE_KEY]: null }).catch(() => {});
            }
        } catch {                   }
    })();
    return _bgCloudCacheHydratePromise;
}

function invalidateBgCloudDocCache() {
    _bgCloudDocCache = null;
    _bgCloudDocCacheTime = 0;
    _bgCloudDocCacheUid = null;


    bgStorageSet({ [_BG_CLOUD_CACHE_KEY]: null }).catch(() => {});
}







async function _isCacheShortCircuitEnabledBg() {
    try {
        const stored = await bgStorageGet(['_featureFlags']);
        const flags = stored._featureFlags;
        if (!flags || typeof flags !== 'object') return true;
        return flags.CACHE_SHORT_CIRCUIT_ENABLED !== false;
    } catch { return true; }
}

const _bgCacheStats = { fresh: 0, revalidated: 0, fullFetch: 0 };








async function _revalidateCloudDocViaLastUpdated(user, token, cachedLastUpdated) {
    if (!user || !token || !cachedLastUpdated) return undefined;
    const url = `${FIRESTORE_BASE}/documents/users/${user.uid}?mask.fieldPaths=lastUpdated`;
    let response;
    try {
        response = await fetchWithTimeout(url, { headers: { 'Authorization': `Bearer ${token}` } });
    } catch (e) {

        return undefined;
    }
    if (response.status === 404) return null;
    if (response.status === 401 || response.status === 403) {
        const body = await response.text().catch(() => '');
        const err = new Error(`HTTP ${response.status}`);
        err.status = response.status;
        err.body = body;
        throw err;
    }
    if (!response.ok) return undefined;
    let json;
    try { json = await response.json(); } catch { return undefined; }
    const decoded = fromFSDoc(json);
    return decoded?.lastUpdated || null;
}

async function fetchCloudDataCached(user, token) {
    await hydrateBgCloudDocCache();
    const now = Date.now();




    if (_bgCloudDocCache && _bgCloudDocCacheUid === user.uid && (now - _bgCloudDocCacheTime) < _BG_CLOUD_TTL) {
        _bgCacheStats.fresh++;
        return _bgCloudDocCache;
    }
    if (_bgCloudDocCache && _bgCloudDocCacheUid !== user.uid) {
        invalidateBgCloudDocCache();
    }





    if (
        _bgCloudDocCache &&
        _bgCloudDocCacheUid === user.uid &&
        _bgCloudDocCache.lastUpdated &&
        await _isCacheShortCircuitEnabledBg()
    ) {
        try {
            const cloudLastUpdated = await _revalidateCloudDocViaLastUpdated(user, token, _bgCloudDocCache.lastUpdated);
            if (cloudLastUpdated && cloudLastUpdated === _bgCloudDocCache.lastUpdated) {
                _bgCloudDocCacheTime = Date.now();
                bgStorageSet({
                    [_BG_CLOUD_CACHE_KEY]: { uid: user.uid, doc: _bgCloudDocCache, cachedAt: _bgCloudDocCacheTime }
                }).catch(() => {});
                _bgCacheStats.revalidated++;
                dlog(`[BG] Poll skipped — lastUpdated unchanged (revalidated ${_bgCacheStats.revalidated} times)`);
                return _bgCloudDocCache;
            }

            if (cloudLastUpdated !== undefined) {
                invalidateBgCloudDocCache();
            }
        } catch (e) {
            if (e?.status === 401 || e?.status === 403) throw e;

        }
    }

    let doc = null;
    try {
        doc = await fetchCloudData(user, token);
    } catch (e) {


        const err = new Error(e?.message || 'Fetch failed');
        err.status = e?.status || null;
        err.isTimeout = !!e?.isTimeout;
        err.name = e?.name || err.name;
        throw err;
    }
    if (doc) {
        _bgCloudDocCache = doc;
        _bgCloudDocCacheTime = Date.now();
        _bgCloudDocCacheUid = user.uid;
        _bgCacheStats.fullFetch++;

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







        let mergedVP = localVP;
        try {
            const cloudDoc = await fetchCloudDataCached(user, token);
            if (cloudDoc?.videoProgress) {
                mergedVP = mergeVideoProgress(localVP, cloudDoc.videoProgress);


                mergedVP = cleanTrackedProgressBg(result.animeData || {}, mergedVP, result.deletedAnime || {});
            }
        } catch (e) {


            throw e;
        }




        if (!areProgressMapsEqual(localVP, mergedVP)) {
            pauseSync();
            await bgStorageSet({ videoProgress: mergedVP });
        }



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


                invalidateBgCloudDocCache();
            }
            bgRememberOwnWrite(pushedAt);
            _lastProgressSyncAt = Date.now();
            persistBgPollState({ progressSyncAt: _lastProgressSyncAt });
            clearSyncRetry('progress');
        } else {
            const status = response.status;
            const errorBody = await response.text().catch(() => '');
            console.warn('[BG] Progress sync failed:', status, errorBody.slice(0, 160));
            if (status === 401) {





                if (_progressSyncRetryAuthAttempted) {
                    const cl = self.AnimeTrackerAuthClassifier;
                    const cls = cl ? cl.classify(401, errorBody) : { permanent: false };
                    if (cls.permanent) {
                        console.error('[BG] Progress sync 401 with permanent code — signing out');
                        await signOutDueToTokenFailure();
                        clearSyncRetry('progress');
                    } else {
                        console.warn('[BG] Progress sync still 401 after refresh — keeping session, alarm backoff');
                        armSyncRetry('progress', '401-still-after-refresh');
                    }
                } else {
                    _progressSyncRetryAuthAttempted = true;
                    await _invalidateCachedTokenExpiry();
                    armSyncRetry('progress', '401-needs-refresh');
                }
            } else if (status === 403) {



                _broadcastAuthRejected(403, errorBody);
                if (_progressSyncRetryAttempts >= SYNC_RETRY_BACKOFF_MIN.length) {
                    console.error('[BG] Progress sync 403 — giving up after max retries (check Firestore rules)');
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
        const reason = error?.isTimeout ? 'timeout' : 'network';
        console.error(`[BG] Progress sync ${reason}:`, error?.message || error);
        armSyncRetry('progress', `${reason}: ${error?.message || error}`);
    } finally {
        progressSyncInProgress = false;
        if (progressSyncPending) {
            progressSyncPending = false;



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
            : stripAutoRepairedEpisodesFromMap({ ...localAnime });

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
            const errorBody = await response.text().catch(() => '');
            console.error('[BG] Sync failed:', status, errorBody.slice(0, 160));


            markSyncPending();

            if (status === 401) {




                if (_fullSyncRetryAuthAttempted) {
                    const cl = self.AnimeTrackerAuthClassifier;
                    const cls = cl ? cl.classify(401, errorBody) : { permanent: false };
                    if (cls.permanent) {
                        console.error('[BG] Sync 401 with permanent code — signing out');
                        await signOutDueToTokenFailure();
                        clearSyncRetry('full');
                    } else {
                        console.warn('[BG] Sync still 401 after refresh — keeping session, alarm backoff');
                        armSyncRetry('full', '401-still-after-refresh');
                    }
                } else {
                    _fullSyncRetryAuthAttempted = true;
                    await _invalidateCachedTokenExpiry();
                    armSyncRetry('full', '401-needs-refresh');
                }
            } else if (status === 403) {



                _broadcastAuthRejected(403, errorBody);
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

                console.error(`[BG] Sync got non-retryable ${status}; dropping pending flag`);
                clearSyncPending();
                clearSyncRetry('full');
            }
        }
        });
    } catch (error) {
        const reason = error?.isTimeout ? 'timeout' : 'network';
        console.error(`[BG] Sync ${reason}:`, error?.message || error);

        markSyncPending();
        armSyncRetry('full', `${reason}: ${error?.message || error}`);
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






    _applyCloudUpdateDoc = cloudDoc;
    if (_applyCloudDebounce) clearTimeout(_applyCloudDebounce);

    if (_applyCloudUpdateWaiters.length >= _MAX_CLOUD_UPDATE_WAITERS) {







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




        if (localUpdatedAt && Date.parse(localUpdatedAt) >= Date.parse(cloudUpdatedAt)) {
            return false;
        }

        const writes = {};
        let touched = false;




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



        chrome.alarms.create(PROGRESS_SYNC_ALARM, { delayInMinutes: 5 });
    }

    if (changes.animeData) {
        const oldAnime = changes.animeData.oldValue || {};
        const newAnime = changes.animeData.newValue || {};
        const oldSlugs = Object.keys(oldAnime);
        const newSlugs = Object.keys(newAnime);
        const hasNewSlug = newSlugs.some(s => !oldSlugs.includes(s));

        if (hasNewSlug) {
            bgStorageSet({ pendingBackgroundMetadataRepair: true }).catch((error) => {
                console.error('[BG] Failed to trigger repair for new anime:', error);
            });
        } else {
            maybeStartPendingMetadataRepair().catch((error) => {
                console.error('[BG] Failed to honor pending repair request:', error);
            });
        }
    }






    if (changes.pendingBackgroundMetadataRepair?.newValue === true) {
        maybeStartPendingMetadataRepair(true).catch((error) => {
            console.error('[BG] Failed to start pending repair on flag flip:', error);
        });
    }
});
























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




chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'SYNC_TO_FIREBASE_IMMEDIATE') {
        sendResponse({ received: true });
        if (syncDebounceTimeout) clearTimeout(syncDebounceTimeout);
        markSyncPending();
        syncToFirebase();
        syncProgressOnly();
        return true;
    }

    if (message.type === 'GET_AUTH_STATE') {
        (async () => {
            try {
                const user = await getFirebaseUser();
                const tokens = await bgStorageGet(['firebase_tokens']);
                sendResponse({ success: true, user, tokens: tokens?.firebase_tokens || null });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (message.type === 'PUSH_PLAYBACK_SETTINGS') {
        (async () => {
            try {
                const user = await getFirebaseUser();
                const token = await getFirebaseToken();
                if (!user || !token) {
                    sendResponse({ success: false, error: 'not_authenticated' });
                    return;
                }
                const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
                const mask = 'updateMask.fieldPaths=playbackSettings';
                const res = await fetchWithTimeout(`${url}?${mask}`, {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fields: jsonToFirestoreFields({
                            playbackSettings: message.playbackSettings
                        })
                    })
                });
                if (res.ok) {
                    if (_bgCloudDocCache && _bgCloudDocCacheUid === user.uid) {
                        _bgCloudDocCache.playbackSettings = message.playbackSettings;
                        _bgCloudDocCacheTime = Date.now();
                        bgStorageSet({
                            [_BG_CLOUD_CACHE_KEY]: { uid: user.uid, doc: _bgCloudDocCache, cachedAt: _bgCloudDocCacheTime }
                        }).catch(() => {});
                    }
                    sendResponse({ success: true });
                } else {
                    const errText = await res.text().catch(() => '');
                    sendResponse({ success: false, error: `HTTP ${res.status}: ${errText}` });
                }
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (message.type === 'PUSH_ANILIST_AUTH') {
        (async () => {
            try {
                const user = await getFirebaseUser();
                const token = await getFirebaseToken();
                if (!user || !token) {
                    sendResponse({ success: false, error: 'not_authenticated' });
                    return;
                }
                const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
                const mask = 'updateMask.fieldPaths=anilistAuth';
                const res = await fetchWithTimeout(`${url}?${mask}`, {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fields: jsonToFirestoreFields({
                            anilistAuth: message.anilistAuth
                        })
                    })
                });
                if (res.ok) {
                    if (_bgCloudDocCache && _bgCloudDocCacheUid === user.uid) {
                        _bgCloudDocCache.anilistAuth = message.anilistAuth;
                        _bgCloudDocCacheTime = Date.now();
                        bgStorageSet({
                            [_BG_CLOUD_CACHE_KEY]: { uid: user.uid, doc: _bgCloudDocCache, cachedAt: _bgCloudDocCacheTime }
                        }).catch(() => {});
                    }
                    sendResponse({ success: true });
                } else {
                    const errText = await res.text().catch(() => '');
                    sendResponse({ success: false, error: `HTTP ${res.status}: ${errText}` });
                }
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

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





        sendResponse({ received: true });
        pollCloudData('content-page-open').catch(() => {});
        return true;
    }

    if (message.type === 'WAKE_AND_POLL_CLOUD_FORCE') {






        sendResponse({ received: true });
        pollCloudData('force-refresh', { force: true }).catch(() => {});
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

    if (message.type === 'SIGNED_OUT') {



        invalidateBgCloudDocCache();
        clearAuthAndSyncAlarms()
            .then(() => sendResponse({ ok: true }))
            .catch((e) => sendResponse({ ok: false, error: e?.message }));
        return true;
    }

    if (message.type === 'UPDATE_BG_CLOUD_DOC_CACHE') {









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
            forceFillerRefresh: message.forceFillerRefresh === true,
            isMobile: message.isMobile === true
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













        (async () => {
            try {
                const helper = self.AnimeTrackerAuthTokens;
                if (!helper) return;
                await helper.migrateTokensIfNeeded();
                const t = await helper.readTokens();
                if (!t || !t.refreshToken) {
                    dlog('[BG] Post-update refresh: no session to validate');
                    return;
                }
                if (t.needsReauth) {
                    dlog('[BG] Post-update refresh: session already in needsReauth state — skipping');
                    return;
                }
                const result = await refreshFirebaseToken(t.refreshToken);
                if (result?.tokens) {
                    console.log('[BG] Post-update silent refresh: ok');
                } else if (result?.permanent) {

                    await helper.setNeedsReauth(true);
                    console.warn(`[BG] Post-update silent refresh: permanent (${result?.error || '?'}) — needsReauth set, tokens preserved`);
                } else {


                    console.warn(`[BG] Post-update silent refresh: transient (${result?.error || '?'}) — retry alarm armed`);
                }
            } catch (e) {
                console.warn('[BG] Post-update silent refresh failed:', e?.message || e);
            }
        })();






        const fromVersion = details.previousVersion || null;
        const toVersion = chrome.runtime.getManifest().version || null;





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
        }).catch((e) => console.warn('[BG] Post-update flag write failed:', e));
    }
});









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


            return;
        }


        markSyncPending();
        syncToFirebase();
        return;
    }

    if (alarm.name === PROGRESS_SYNC_RETRY_ALARM) {
        if (progressSyncInProgress) return;
        syncProgressOnly();
        return;
    }

    if (alarm.name === AUTH_REFRESH_RETRY_BG_ALARM) {




        _bgAuthRefreshRetryTick();
        return;
    }

    if (alarm.name === DAILY_CLEANUP_ALARM) {


        bgIterativeQuotaRecovery('daily-alarm').catch((e) => {
            console.warn('[Cleanup] alarm tick failed:', e?.message || e);
        });
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


migratePerKeyCachesOnce();



ensureDailyCleanupAlarmScheduled();


(async () => {
    try {
        await self.AnimeTrackerAuthTokens?.migrateTokensIfNeeded?.();
    } catch (e) {
        console.warn('[BG] Token migration skipped:', e?.message || e);
    }
})();










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
