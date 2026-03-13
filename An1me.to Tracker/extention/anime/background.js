/**
 * Anime Tracker - Background Service Worker
 * Handles extension lifecycle, message passing, and auto-sync to Firebase
 */

// ─── Config ───────────────────────────────────────────────────────────────────
const FIREBASE_API_KEY    = "AIzaSyCDF9US2OwARlyZ0AH_zDpjzmOXRtrGKMg";
const FIREBASE_PROJECT_ID = "anime-tracker-64d86";
const FIRESTORE_BASE      = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)`;
const LISTEN_URL          = `${FIRESTORE_BASE}/documents:listen`;

// ─── State ────────────────────────────────────────────────────────────────────
let syncInProgress      = false;
let pendingSync         = false;
let syncDebounceTimeout = null;
// syncPausedUntil: timestamp (ms) until which animeData storage-change events
// are ignored after we write cloud data locally, to avoid re-uploading it.
// Using a timestamp instead of a boolean prevents premature reset when multiple
// overlapping cloud updates occur within the pause window.
let syncPausedUntil     = 0;

/** Pause the animeData re-upload guard for `ms` milliseconds (default 3 s). */
function pauseSync(ms = 3000) {
    syncPausedUntil = Math.max(syncPausedUntil, Date.now() + ms);
}
/** Returns true if the re-upload guard is currently active. */
function isSyncPaused() {
    return Date.now() < syncPausedUntil;
}

let rtListenAbort     = null;
let rtReconnectTimer  = null;
let rtReconnectDelay  = 5000;
const RT_MAX_DELAY    = 60000;

// ─── Token helpers ────────────────────────────────────────────────────────────

async function getFirebaseToken() {
    try {
        const stored = await chrome.storage.local.get(['firebase_tokens']);
        const tokens = stored.firebase_tokens;
        if (!tokens?.idToken) return null;
        // Refresh if token expires within 2 minutes
        if (tokens.expiresAt < Date.now() + 120000) {
            const refreshed = await refreshFirebaseToken(tokens.refreshToken);
            return refreshed ? refreshed.idToken : null;
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
        await chrome.storage.local.set({ firebase_tokens: tokens });
        console.log('[BG] Token refreshed');
        return tokens;
    } catch (e) {
        console.error('[BG] Token refresh failed:', e);
        return null;
    }
}

async function getFirebaseUser() {
    try {
        const stored = await chrome.storage.local.get(['firebase_user']);
        return stored.firebase_user || null;
    } catch (e) { return null; }
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

function mergeVideoProgress(local, cloud) {
    const merged = { ...(cloud || {}) };
    for (const [id, lp] of Object.entries(local || {})) {
        const cp = merged[id];
        if (!cp) { merged[id] = lp; continue; }
        const lDel = !!lp.deleted, cDel = !!cp.deleted;
        if (lDel && !cDel) {
            if ((lp.deletedAt ? +new Date(lp.deletedAt) : 0) > (cp.savedAt ? +new Date(cp.savedAt) : 0))
                merged[id] = lp;
        } else if (!lDel && cDel) {
            if ((lp.savedAt ? +new Date(lp.savedAt) : 0) > (cp.deletedAt ? +new Date(cp.deletedAt) : 0))
                merged[id] = lp;
        } else if (!lDel && !cDel) {
            if ((lp.currentTime || 0) > (cp.currentTime || 0)) merged[id] = lp;
        }
    }
    return merged;
}

function mergeDeletedAnime(local, cloud) {
    const merged = { ...(cloud || {}) };
    for (const [slug, info] of Object.entries(local || {})) {
        if (!merged[slug] || new Date(info.deletedAt) > new Date(merged[slug].deletedAt)) {
            merged[slug] = info;
        }
    }
    // Purge entries older than 60 days
    const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
    for (const [slug, info] of Object.entries(merged)) {
        if (new Date(info.deletedAt).getTime() < cutoff) delete merged[slug];
    }
    return merged;
}

function applyDeletedAnime(animeData, deletedAnime) {
    for (const [slug, info] of Object.entries(deletedAnime || {})) {
        if (!animeData[slug]) continue;
        const deletedAt   = new Date(info.deletedAt).getTime();
        const lastWatched = animeData[slug].lastWatched
            ? new Date(animeData[slug].lastWatched).getTime() : 0;
        if (deletedAt >= lastWatched) {
            console.log(`[BG] Honouring deletion of ${slug}`);
            delete animeData[slug];
        }
    }
}

function mergeAnimeData(localData, cloudData) {
    const merged = { ...(cloudData || {}), ...(localData || {}) };
    for (const slug of Object.keys(merged)) {
        const c = cloudData?.[slug];
        const l = localData?.[slug];
        if (!c || !l) continue;
        const map = new Map();
        for (const ep of [
            ...(Array.isArray(c.episodes) ? c.episodes : []),
            ...(Array.isArray(l.episodes) ? l.episodes : [])
        ]) {
            if (!ep || typeof ep.number !== 'number' || isNaN(ep.number)) continue;
            const existing = map.get(ep.number);
            if (!existing) {
                map.set(ep.number, ep);
            } else {
                // Keep the episode with the more recent watchedAt timestamp
                const existingTs = existing.watchedAt ? +new Date(existing.watchedAt) : 0;
                const epTs       = ep.watchedAt      ? +new Date(ep.watchedAt)      : 0;
                if (epTs > existingTs) map.set(ep.number, ep);
            }
        }
        // Start with local metadata (local wins by default)
        const mergedMeta = { ...l };
        // If local is missing a coverImage but cloud has one, copy it over
        if (!mergedMeta.coverImage && c.coverImage) {
            mergedMeta.coverImage = c.coverImage;
        }
        mergedMeta.episodes       = Array.from(map.values()).sort((a, b) => a.number - b.number);
        mergedMeta.totalWatchTime = mergedMeta.episodes.reduce((s, ep) => s + (ep.duration || 0), 0);
        merged[slug] = mergedMeta;
    }
    return merged;
}

// Lightweight equality check for deletedAnime maps.
// Two maps are equal when they have the same set of slugs with the same
// deletedAt timestamps. Avoids serialising the entire object on every sync.
function shallowEqualDeletedAnime(a, b) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const slug of aKeys) {
        if (!b[slug]) return false;
        if (a[slug].deletedAt !== b[slug].deletedAt) return false;
    }
    return true;
}

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

// ─── Push: videoProgress only (merged PATCH) ────────────────────────────────
// Fetches current cloud videoProgress, merges with local (higher currentTime
// wins), then writes the merged map back.  This prevents overwriting progress
// that another device has written for a different episode.

// background.js - Αντικαταστήστε ολόκληρη τη συνάρτηση syncProgressOnly

async function syncProgressOnly() {
    // Αν υπάρχει ήδη sync σε εξέλιξη, το κάνουμε pending
    if (syncInProgress) { pendingSync = true; return; }

    const user = await getFirebaseUser();
    const token = await getFirebaseToken();
    if (!user || !token) return;

    syncInProgress = true;
    try {
        // Φέρνουμε ΟΛΑ τα δεδομένα, συμπεριλαμβανομένων των cover images
        const result = await chrome.storage.local.get([
            'animeData', 
            'videoProgress', 
            'deletedAnime', 
            'groupCoverImages'
        ]);
        
        const localAnime    = result.animeData    || {};
        const localProgress = result.videoProgress || {};
        const localDeleted  = result.deletedAnime  || {};
        const localGroup    = result.groupCoverImages || {};

        // Φέρνουμε τα cloud data για συγχώνευση
        const cloudDoc = await fetchCloudData(user, token);

        // Συγχώνευση deletedAnime
        const mergedDeleted = cloudDoc?.deletedAnime
            ? mergeDeletedAnime(localDeleted, cloudDoc.deletedAnime)
            : localDeleted;

        // Συγχώνευση animeData (με τη νέα λογική που έχετε ήδη)
        let mergedAnime = cloudDoc?.animeData
            ? mergeAnimeData(localAnime, cloudDoc.animeData)
            : { ...localAnime };

        // Εφαρμογή διαγραφών
        applyDeletedAnime(mergedAnime, mergedDeleted);

        // Συγχώνευση videoProgress
        const mergedProgress = cloudDoc?.videoProgress
            ? mergeVideoProgress(localProgress, cloudDoc.videoProgress)
            : localProgress;

        // Συγχώνευση group cover images
        const cloudGroup = cloudDoc?.groupCoverImages || {};
        const mergedGroup = { ...cloudGroup, ...localGroup };

        // Τοπική αποθήκευση αν χρειάζεται
        const localEps   = Object.values(localAnime).reduce((s, a) => s + (a.episodes?.length || 0), 0);
        const mergedEps  = Object.values(mergedAnime).reduce((s, a) => s + (a.episodes?.length || 0), 0);
        const localPCnt  = Object.keys(localProgress).length;
        const mergedPCnt = Object.keys(mergedProgress).length;
        const deletedChanged = !shallowEqualDeletedAnime(localDeleted, mergedDeleted);
        const groupChanged   = Object.keys(mergedGroup).length !== Object.keys(localGroup).length;

        if (mergedEps > localEps || mergedPCnt > localPCnt || deletedChanged || groupChanged) {
            pauseSync();
            await chrome.storage.local.set({
                animeData:        mergedAnime,
                videoProgress:    mergedProgress,
                deletedAnime:     mergedDeleted,
                groupCoverImages: mergedGroup
            });
        }

        // Τώρα ανεβάζουμε ΟΛΑ τα δεδομένα στο cloud
        const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
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
            console.log('[BG] ✓ Full sync completed (from progress-only path)');
        } else {
            console.warn('[BG] Sync failed:', response.status);
        }
    } catch (error) {
        console.error('[BG] Sync error:', error);
    } finally {
        syncInProgress = false;
        if (pendingSync) { pendingSync = false; setTimeout(syncToFirebase, 1000); }
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
        // Also load groupCoverImages so we can sync poster data across devices
        const result = await chrome.storage.local.get(['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages']);
        const localAnime    = result.animeData    || {};
        const localProgress = result.videoProgress || {};
        const localDeleted  = result.deletedAnime  || {};
        const localGroup    = result.groupCoverImages || {};

        // Fetch cloud to merge animeData, videoProgress, deletedAnime and group cover images.
        const cloudDoc = await fetchCloudData(user, token);

        // Merge deletedAnime first so we can apply it to animeData below.
        const mergedDeleted = cloudDoc?.deletedAnime
            ? mergeDeletedAnime(localDeleted, cloudDoc.deletedAnime)
            : localDeleted;

        let mergedAnime = cloudDoc?.animeData
            ? mergeAnimeData(localAnime, cloudDoc.animeData)
            : { ...localAnime };

        // Apply cross-device deletions before uploading.
        applyDeletedAnime(mergedAnime, mergedDeleted);

        // For videoProgress: only pull FROM cloud entries that are NOT in local
        // (i.e. from another device). Never overwrite local with older cloud data.
        const mergedProgress = cloudDoc?.videoProgress
            ? mergeVideoProgress(localProgress, cloudDoc.videoProgress)
            : localProgress;

        // Merge group cover images: prefer local posters over cloud posters.
        const cloudGroup = cloudDoc?.groupCoverImages || {};
        const mergedGroup = { ...cloudGroup, ...localGroup };

        const localEps   = Object.values(localAnime).reduce((s, a) => s + (a.episodes?.length || 0), 0);
        const mergedEps  = Object.values(mergedAnime).reduce((s, a) => s + (a.episodes?.length || 0), 0);
        const localPCnt  = Object.keys(localProgress).length;
        const mergedPCnt = Object.keys(mergedProgress).length;
        const deletedChanged = !shallowEqualDeletedAnime(localDeleted, mergedDeleted);
        const groupChanged   = Object.keys(mergedGroup).length !== Object.keys(localGroup).length;

        // Write back locally if cloud had more/different data (e.g. from another device)
        if (mergedEps > localEps || mergedPCnt > localPCnt || deletedChanged || groupChanged) {
            pauseSync(); // prevent this write from immediately re-triggering a full sync
            await chrome.storage.local.set({
                animeData:       mergedAnime,
                videoProgress:   mergedProgress,
                deletedAnime:    mergedDeleted,
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
                    animeData:       mergedAnime,
                    videoProgress:   mergedProgress,
                    deletedAnime:    mergedDeleted,
                    groupCoverImages: mergedGroup,
                    lastUpdated:     new Date().toISOString(),
                    email:           user.email
                })
            })
        });

        if (response.ok) {
            console.log(
                `%cBackground %c⚙️ Synced (${mergedEps} eps)`,
                'color:rgb(96,165,250);font-weight:bold;font-size:12px',
                'color:rgb(148,163,184);font-size:11px'
            );
        } else {
            console.error('[BG] Sync failed:', response.status);
        }
    } catch (error) {
        console.error('[BG] Sync error:', error);
    } finally {
        syncInProgress = false;
        if (pendingSync) { pendingSync = false; setTimeout(syncToFirebase, 1000); }
    }
}

// ─── Real-time listener (SSE) ─────────────────────────────────────────────────

async function applyCloudUpdate(cloudDoc) {
    if (!cloudDoc) return;
    try {
        // Also load groupCoverImages so posters can be synced across devices
        const local = await chrome.storage.local.get(['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages']);

        // Merge deletedAnime from cloud so cross-device deletions propagate here too.
        const mergedDeleted = cloudDoc.deletedAnime
            ? mergeDeletedAnime(local.deletedAnime || {}, cloudDoc.deletedAnime)
            : (local.deletedAnime || {});

        const mergedAnime = mergeAnimeData(local.animeData || {}, cloudDoc.animeData || {});

        // Apply deletions: remove anime that were deleted on another device.
        applyDeletedAnime(mergedAnime, mergedDeleted);

        // For videoProgress: keep local if it's higher — cloud update might be from another tab
        const mergedProgress = mergeVideoProgress(local.videoProgress || {}, cloudDoc.videoProgress || {});

        // Merge group cover images: prefer local posters over cloud posters. If a key
        // exists locally, keep it; otherwise fall back to cloud.
        const localGroup = local.groupCoverImages || {};
        const cloudGroup = cloudDoc.groupCoverImages || {};
        const mergedGroup = { ...cloudGroup, ...localGroup };

        const localEps  = Object.values(local.animeData || {}).reduce((s, a) => s + (a.episodes?.length || 0), 0);
        const mergedEps = Object.values(mergedAnime).reduce((s, a) => s + (a.episodes?.length || 0), 0);

        let progressChanged = false;
        for (const [id, mp] of Object.entries(mergedProgress)) {
            const lp = (local.videoProgress || {})[id];
            if (!lp || lp.currentTime !== mp.currentTime) { progressChanged = true; break; }
        }

        const deletedChanged = !shallowEqualDeletedAnime(local.deletedAnime || {}, mergedDeleted);
        const groupChanged   = Object.keys(mergedGroup).length !== Object.keys(local.groupCoverImages || {}).length;

        if (mergedEps !== localEps || progressChanged || deletedChanged || groupChanged) {
            pauseSync(); // prevent this write from immediately re-triggering a full sync
            await chrome.storage.local.set({
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
    if (rtListenAbort) rtListenAbort.abort();
    if (rtReconnectTimer) { clearTimeout(rtReconnectTimer); rtReconnectTimer = null; }

    const user  = await getFirebaseUser();
    const token = await getFirebaseToken();
    if (!user || !token) {
        rtReconnectTimer = setTimeout(startRealtimeListener, 15000);
        return;
    }

    // ── Catch-up fetch ────────────────────────────────────────────────────────
    // If the stream was silent for more than 45 seconds (SW was asleep or the
    // stream died), do a one-shot REST read BEFORE opening the new stream.
    // This ensures we never miss changes that arrived while we were offline.
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
    try {
        const res = await fetch(`${LISTEN_URL}?key=${FIREBASE_API_KEY}`, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ addTarget: { documents: { documents: [docPath] }, targetId: 1 } }),
            signal:  rtListenAbort.signal
        });

        if (!res.ok) { scheduleRtReconnect(); return; }

        rtReconnectDelay = 5000;
        // Reset stream-alive timer so the new connection isn't immediately flagged as stale
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
                } catch (_) {}
            }
        }
    } catch (e) {
        if (e.name === 'AbortError') return;
        console.warn('[BG-RT] Stream error:', e.message);
    }
    scheduleRtReconnect();
}

function scheduleRtReconnect() {
    // Use a short initial delay (2s) on the first retry so changes from another
    // device are picked up quickly after a natural stream EOF (e.g. server-side
    // keep-alive reset). Subsequent retries use exponential back-off.
    const delay = rtReconnectDelay === 5000 ? 2000 : rtReconnectDelay;
    rtReconnectTimer = setTimeout(startRealtimeListener, delay);
    rtReconnectDelay = Math.min(rtReconnectDelay * 1.5, RT_MAX_DELAY);
}

// ─── Storage change listener ──────────────────────────────────────────────────
//
// Key rules:
//  • videoProgress changes: ALWAYS sync, use fast path (field-mask PATCH, no GET).
//    This is written by the content script in real time and must never be blocked.
//  • animeData changes (new episode): full sync, but respect the sync pause guard
//    to avoid re-uploading data we just wrote from the cloud.

let progressSyncDebounce = null;  // debounce for fast videoProgress path
// NOTE: Full-sync debounce reuses syncDebounceTimeout (defined in State above)
// so only ONE full-sync timer is ever pending, regardless of trigger source.

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;

    // ── videoProgress: fast path, always runs ──────────────────────────────
    if (changes.videoProgress) {
        if (progressSyncDebounce) clearTimeout(progressSyncDebounce);
        progressSyncDebounce = setTimeout(() => {
            progressSyncDebounce = null;
            syncProgressOnly();
        }, 3000); // 3s debounce — wait for burst of saves to settle
    }

    // ── animeData: full sync, respect syncPaused ───────────────────────────
    if (changes.animeData && !isSyncPaused()) {
        const oldAnime = changes.animeData.oldValue || {};
        const newAnime = changes.animeData.newValue || {};

        // Calculate episode counts to detect new episodes
        const oldCount = Object.values(oldAnime)
            .reduce((s, a) => s + (a.episodes?.length || 0), 0);
        const newCount = Object.values(newAnime)
            .reduce((s, a) => s + (a.episodes?.length || 0), 0);

        // Detect cover changes: if any slug has a different coverImage value
        let coverChanged = false;
        if (!coverChanged && (newCount === oldCount)) {
            for (const slug of Object.keys(newAnime)) {
                const oldCover = oldAnime[slug]?.coverImage || null;
                const newCover = newAnime[slug]?.coverImage || null;
                // Treat undefined vs null as equal; only trigger when value changes from falsy to non-null or vice versa or differs
                if (oldCover !== newCover) {
                    coverChanged = true;
                    break;
                }
            }
        }

        if (newCount > oldCount || coverChanged) {
            if (newCount > oldCount) {
                console.log(
                    `%cAnime Tracker %c➕ New episode! (${oldCount}→${newCount})`,
                    'color:rgb(255,107,107);font-weight:bold;font-size:12px',
                    'color:rgb(148,163,184);font-size:11px'
                );
            } else {
                console.log('[BG] Anime metadata changed (cover updated), scheduling sync');
            }
            // Reuse syncDebounceTimeout so storage listener and message handler share the same timer
            if (syncDebounceTimeout) clearTimeout(syncDebounceTimeout);
            syncDebounceTimeout = setTimeout(() => { syncDebounceTimeout = null; syncToFirebase(); }, 2000);
        }
    }

    // ── groupCoverImages: full sync when new posters are added ──────────────
    // When group posters are updated locally (e.g. a content script saved a
    // new group poster), schedule a full sync so the change propagates to
    // Firestore and other devices. Ignore changes during sync pauses to
    // prevent re-triggering syncs for remote updates.
    if (changes.groupCoverImages && !isSyncPaused()) {
        const oldLen = Object.keys(changes.groupCoverImages.oldValue || {}).length;
        const newLen = Object.keys(changes.groupCoverImages.newValue || {}).length;
        if (newLen !== oldLen) {
            console.log('[BG] Group cover images changed, scheduling sync');
            if (syncDebounceTimeout) clearTimeout(syncDebounceTimeout);
            syncDebounceTimeout = setTimeout(() => { syncDebounceTimeout = null; syncToFirebase(); }, 2000);
        }
    }
});

// ─── Episode type fetcher ─────────────────────────────────────────────────────

async function fetchEpisodeTypesFromAnimeFillerList(animeSlug) {
    try {
        const url      = `https://www.animefillerlist.com/shows/${animeSlug}`;
        console.log(`[Anime Tracker] Fetching episode types from ${url}`);
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404) return null;
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const html         = await response.text();
        const episodeTypes = { canon: [], filler: [], mixed: [], anime_canon: [], totalEpisodes: null };

        function parseEpisodeText(text) {
            const episodes  = [];
            text            = text.trim();
            const rangeMatch = text.match(/^(\d+)-(\d+)$/);
            if (rangeMatch) {
                for (let ep = parseInt(rangeMatch[1]); ep <= parseInt(rangeMatch[2]); ep++)
                    episodes.push(ep);
            } else {
                const epNum = parseInt(text);
                if (!isNaN(epNum)) episodes.push(epNum);
            }
            return episodes;
        }

        function parseSection(html, className) {
            const match = html.match(new RegExp(
                `<div[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>[\\s\\S]*?` +
                `<span[^>]*class=["']Episodes["'][^>]*>(.*?)<\\/span>[\\s\\S]*?<\\/div>`, 'i'
            ));
            if (!match) return [];
            const result = [];
            for (const m of match[1].matchAll(/<a[^>]*>([^<]+)<\/a>/gi)) {
                if (/^[\d-]+$/.test(m[1].trim())) result.push(...parseEpisodeText(m[1]));
            }
            return result;
        }

        episodeTypes.canon  = parseSection(html, 'manga_canon');
        episodeTypes.mixed  = parseSection(html, 'mixed_canon\\/filler');
        episodeTypes.filler = parseSection(html, 'filler["\'\\s]');

        const all = [...episodeTypes.canon, ...episodeTypes.mixed, ...episodeTypes.filler, ...episodeTypes.anime_canon];
        if (all.length > 0) episodeTypes.totalEpisodes = Math.max(...all);

        console.log(`[Anime Tracker] ✓ Fetched episode types for ${animeSlug}:`, episodeTypes);
        return episodeTypes;
    } catch (error) {
        console.error(`[Anime Tracker] ✗ Failed for ${animeSlug}:`, error);
        throw error;
    }
}

// ─── Migration ────────────────────────────────────────────────────────────────

async function migrateFromSyncToLocal() {
    try {
        const syncData        = await chrome.storage.sync.get(['animeData', 'videoProgress']);
        const validAnimeData  = syncData.animeData
            && typeof syncData.animeData === 'object'
            && !Array.isArray(syncData.animeData);
        const validVideoProgress = syncData.videoProgress
            && typeof syncData.videoProgress === 'object'
            && !Array.isArray(syncData.videoProgress);
        const hasSyncData = (validAnimeData    && Object.keys(syncData.animeData).length > 0) ||
                            (validVideoProgress && Object.keys(syncData.videoProgress).length > 0);
        if (hasSyncData) {
            const localData = await chrome.storage.local.get(['animeData', 'videoProgress']);
            const merged    = {
                animeData:     { ...(validAnimeData     ? syncData.animeData    : {}), ...(localData.animeData    || {}) },
                videoProgress: { ...(validVideoProgress ? syncData.videoProgress : {}), ...(localData.videoProgress || {}) }
            };
            await chrome.storage.local.set(merged);
            await chrome.storage.sync.remove(['animeData', 'trackedEpisodes', 'videoProgress']);
            console.log('[Anime Tracker] Migration complete');
        }
    } catch (error) {
        console.error('[Anime Tracker] Migration error:', error);
    }
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_STATS') {
        chrome.storage.local.get(['animeData'], (result) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
                return;
            }
            const data = result.animeData || {};
            sendResponse({
                totalAnime:     Object.keys(data).length,
                totalEpisodes:  Object.values(data).reduce((s, a) => s + (a.episodes?.length || 0), 0),
                totalWatchTime: Object.values(data).reduce((s, a) => s + (a.totalWatchTime    || 0), 0)
            });
        });
        return true;
    }

    if (message.type === 'CLEAR_DATA') {
        chrome.storage.local.set({ animeData: {}, videoProgress: {} }, () => {
            sendResponse(chrome.runtime.lastError
                ? { success: false, error: chrome.runtime.lastError.message }
                : { success: true });
        });
        return true;
    }

    if (message.type === 'SYNC_TO_FIREBASE') {
        // Wake-up call from content script — run full sync immediately
        sendResponse({ received: true });
        if (syncDebounceTimeout) clearTimeout(syncDebounceTimeout);
        syncDebounceTimeout = setTimeout(() => { syncDebounceTimeout = null; syncToFirebase(); }, 500);
        return true;
    }

    if (message.type === 'SYNC_PROGRESS_ONLY') {
        // Fast path: content script is asking us to push videoProgress only
        sendResponse({ received: true });
        if (progressSyncDebounce) clearTimeout(progressSyncDebounce);
        progressSyncDebounce = setTimeout(() => { progressSyncDebounce = null; syncProgressOnly(); }, 500);
        return true;
    }

    if (message.type === 'GET_VERSION') {
        sendResponse({ version: chrome.runtime.getManifest().version });
        return true;
    }

    if (message.type === 'FETCH_EPISODE_TYPES') {
        if (!message.animeSlug) { sendResponse({ error: 'Missing animeSlug' }); return true; }
        fetchEpisodeTypesFromAnimeFillerList(message.animeSlug)
            .then(episodeTypes => sendResponse({ success: true,  episodeTypes }))
            .catch(error       => sendResponse({ success: false, error: error.message }));
        return true;
    }

    sendResponse({ error: 'Unknown message type' });
    return true;
});

// ─── Lifecycle ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        chrome.storage.local.set({
            animeData:    {},
            videoProgress: {},
            settings:     { watchThreshold: 0.85, notifications: true }
        });
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

// ─── Keep-alive port (content scripts connect every 25s to keep SW awake) ────
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'keepAlive') return;
    // Simply accepting the connection keeps the SW alive; no tracking needed.
    port.onDisconnect.addListener(() => {});
});

// ─── Alarm: keep SW alive + health checks ────────────────────────────────────
chrome.alarms.create('keepAlive', { periodInMinutes: 0.33 }); // every ~20s

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== 'keepAlive') return;

    // Restart SSE stream if dead
    const streamDead = !rtListenAbort || rtListenAbort.signal.aborted;
    if (streamDead) {
    console.debug('[BG] keepAlive: stream dead, restarting...');
    startRealtimeListener();
    }

    checkStreamHealth();
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
        if (rtListenAbort) rtListenAbort.abort();
        startRealtimeListener();
    }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
startRealtimeListener();
