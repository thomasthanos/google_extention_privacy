/**
 * Anime Tracker - Background Service Worker
 * Handles extension lifecycle, message passing, and auto-sync to Firebase
 */

// Firebase config (inline for service worker)
const FIREBASE_API_KEY = "AIzaSyCDF9US2OwARlyZ0AH_zDpjzmOXRtrGKMg";
const FIREBASE_PROJECT_ID = "anime-tracker-64d86";

// Sync state
let syncInProgress = false;
let pendingSync = false;

/**
 * Get Firebase ID token from storage
 */
async function getFirebaseToken() {
    try {
        const stored = await chrome.storage.local.get(['firebase_tokens']);
        const tokens = stored.firebase_tokens;

        if (!tokens || !tokens.idToken) {
            return null;
        }

        // Check if token is expired
        if (tokens.expiresAt < Date.now()) {
            // Try to refresh
            const refreshed = await refreshFirebaseToken(tokens.refreshToken);
            return refreshed ? refreshed.idToken : null;
        }

        return tokens.idToken;
    } catch (e) {
        console.error('[Background] Failed to get token:', e);
        return null;
    }
}

/**
 * Refresh Firebase token
 */
async function refreshFirebaseToken(refreshToken) {
    if (!refreshToken) return null;

    try {
        const response = await fetch(
            `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken
                })
            }
        );

        if (!response.ok) return null;

        const data = await response.json();
        if (data.error) return null;

        const tokens = {
            idToken: data.id_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + (parseInt(data.expires_in) * 1000)
        };

        await chrome.storage.local.set({ firebase_tokens: tokens });
        console.log('[Background] Token refreshed');
        return tokens;
    } catch (e) {
        console.error('[Background] Token refresh failed:', e);
        return null;
    }
}

/**
 * Get current user from storage
 */
async function getFirebaseUser() {
    try {
        const stored = await chrome.storage.local.get(['firebase_user']);
        return stored.firebase_user || null;
    } catch (e) {
        return null;
    }
}

/**
 * Convert JSON to Firestore fields format
 */
function jsonToFirestoreFields(obj) {
    const fields = {};
    for (const [key, value] of Object.entries(obj)) {
        fields[key] = jsonToFirestoreValue(value);
    }
    return fields;
}

function jsonToFirestoreValue(value) {
    if (value === null || value === undefined) {
        return { nullValue: null };
    }
    if (typeof value === 'string') {
        return { stringValue: value };
    }
    if (typeof value === 'number') {
        if (Number.isInteger(value)) {
            return { integerValue: value.toString() };
        }
        return { doubleValue: value };
    }
    if (typeof value === 'boolean') {
        return { booleanValue: value };
    }
    if (Array.isArray(value)) {
        return {
            arrayValue: {
                values: value.map(jsonToFirestoreValue)
            }
        };
    }
    if (typeof value === 'object') {
        return {
            mapValue: {
                fields: jsonToFirestoreFields(value)
            }
        };
    }
    return { nullValue: null };
}

/**
 * Fetch current cloud data from Firebase (for merge before write)
 */
async function fetchCloudData(user, token) {
    try {
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${user.uid}`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return null;
        const doc = await response.json();
        if (!doc.fields) return null;

        // Convert Firestore fields back to plain JS
        function firestoreValueToJson(val) {
            if (val.nullValue !== undefined) return null;
            if (val.stringValue !== undefined) return val.stringValue;
            if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
            if (val.doubleValue !== undefined) return val.doubleValue;
            if (val.booleanValue !== undefined) return val.booleanValue;
            if (val.arrayValue) return (val.arrayValue.values || []).map(firestoreValueToJson);
            if (val.mapValue) {
                const obj = {};
                for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
                    obj[k] = firestoreValueToJson(v);
                }
                return obj;
            }
            return null;
        }

        const result = {};
        for (const [k, v] of Object.entries(doc.fields)) {
            result[k] = firestoreValueToJson(v);
        }
        return result;
    } catch (e) {
        console.warn('[Background] Could not fetch cloud data for merge:', e);
        return null;
    }
}

/**
 * Merge local animeData with cloud animeData (union of episodes per anime)
 */
function mergeAnimeData(localData, cloudData) {
    const merged = { ...(cloudData || {}), ...(localData || {}) };

    for (const slug of Object.keys(merged)) {
        const cloudAnime = cloudData?.[slug];
        const localAnime = localData?.[slug];

        if (!cloudAnime || !localAnime) continue; // Only one side — already correct

        const episodeMap = new Map();
        const cloudEps = Array.isArray(cloudAnime.episodes) ? cloudAnime.episodes : [];
        const localEps = Array.isArray(localAnime.episodes) ? localAnime.episodes : [];

        // Cloud first (prefer cloud meta for episodes that exist on both)
        for (const ep of [...cloudEps, ...localEps]) {
            if (ep && typeof ep === 'object' && typeof ep.number === 'number' && !isNaN(ep.number)) {
                if (!episodeMap.has(ep.number)) episodeMap.set(ep.number, ep);
            }
        }

        merged[slug] = { ...localAnime }; // local wins for metadata (title, etc.)
        merged[slug].episodes = Array.from(episodeMap.values()).sort((a, b) => a.number - b.number);
        merged[slug].totalWatchTime = merged[slug].episodes.reduce((s, ep) => s + (ep.duration || 0), 0);
    }

    return merged;
}

/**
 * Sync data to Firebase (called automatically when episodes are tracked)
 * Always merges with existing cloud data first to avoid overwriting other browsers.
 */
async function syncToFirebase() {
    if (syncInProgress) {
        pendingSync = true;
        console.log('[Background] Sync already in progress, queued');
        return;
    }

    const user = await getFirebaseUser();
    if (!user) {
        console.log('[Background] No user logged in, skipping sync');
        return;
    }

    const token = await getFirebaseToken();
    if (!token) {
        console.log('[Background] No valid token, skipping sync');
        return;
    }

    syncInProgress = true;

    try {
        const result = await chrome.storage.local.get(['animeData', 'videoProgress', 'deletedAnime']);
        const localAnimeData = result.animeData || {};
        const localVideoProgress = result.videoProgress || {};
        const localDeletedAnime = result.deletedAnime || {};

        // Fetch current cloud data and merge episodes before overwriting
        const cloudDoc = await fetchCloudData(user, token);
        const cloudAnimeData = cloudDoc?.animeData || null;

        const mergedAnimeData = cloudAnimeData
            ? mergeAnimeData(localAnimeData, cloudAnimeData)
            : localAnimeData;

        // If merge added episodes the local browser didn't have, save them locally too
        const localCount = Object.values(localAnimeData).reduce((s, a) => s + (a.episodes?.length || 0), 0);
        const mergedCount = Object.values(mergedAnimeData).reduce((s, a) => s + (a.episodes?.length || 0), 0);
        if (mergedCount > localCount) {
            console.log(`[Background] Merge added ${mergedCount - localCount} episodes from cloud → saving locally`);
            await chrome.storage.local.set({ animeData: mergedAnimeData });
        }

        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${user.uid}`;

        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fields: jsonToFirestoreFields({
                    animeData: mergedAnimeData,
                    videoProgress: localVideoProgress,
                    deletedAnime: localDeletedAnime,
                    lastUpdated: new Date().toISOString(),
                    email: user.email
                })
            })
        });

        if (response.ok) {
            const bgStyle = 'color: rgb(96, 165, 250); font-weight: bold; font-size: 12px; padding: 2px 6px; background: rgba(96, 165, 250, 0.1); border-radius: 3px;';
            const msgStyle = 'color: rgb(148, 163, 184); font-size: 11px;';
            console.log(`%cBackground %c⚙️ Auto-synced to Firebase (${mergedCount} eps)`, bgStyle, msgStyle);
        } else {
            console.error('[Background] Sync failed:', response.status);
        }
    } catch (error) {
        console.error('[Background] Sync error:', error);
    } finally {
        syncInProgress = false;

        // Process pending sync if any
        if (pendingSync) {
            pendingSync = false;
            setTimeout(syncToFirebase, 1000);
        }
    }
}

/**
 * Fetch episode types from animefillerlist.com
 * Returns object with canon, filler, and mixed episodes
 */
async function fetchEpisodeTypesFromAnimeFillerList(animeSlug) {
    try {
        const url = `https://www.animefillerlist.com/shows/${animeSlug}`;
        console.log(`[Anime Tracker] Fetching episode types from ${url}`);

        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404) {
                console.log(`[Anime Tracker] Episode types not found for ${animeSlug} (404)`);
                return null;
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text();

        const episodeTypes = {
            canon: [],
            filler: [],
            mixed: [],
            anime_canon: [],
            totalEpisodes: null // Will store the highest manga canon episode number
        };

        // Helper function to parse episode text (e.g., "1-28", "34-41", "43")
        function parseEpisodeText(text) {
            const episodes = [];
            text = text.trim();

            // Match range like "1-28"
            const rangeMatch = text.match(/^(\d+)-(\d+)$/);
            if (rangeMatch) {
                const start = parseInt(rangeMatch[1]);
                const end = parseInt(rangeMatch[2]);
                for (let ep = start; ep <= end; ep++) {
                    episodes.push(ep);
                }
            } else {
                // Single episode number
                const epNum = parseInt(text);
                if (!isNaN(epNum)) {
                    episodes.push(epNum);
                }
            }
            return episodes;
        }

        // Parse by finding the specific div sections
        // Structure: <div class="manga_canon"><span class="Label">Manga Canon Episodes:</span><span class="Episodes">...</span></div>

        // 1. Manga Canon Episodes
        const canonDivMatch = html.match(/<div[^>]*class=["'][^"']*manga_canon[^"']*["'][^>]*>[\s\S]*?<span[^>]*class=["']Episodes["'][^>]*>(.*?)<\/span>[\s\S]*?<\/div>/i);
        if (canonDivMatch) {
            const episodesHtml = canonDivMatch[1];
            const linkMatches = episodesHtml.matchAll(/<a[^>]*>([^<]+)<\/a>/gi);
            for (const match of linkMatches) {
                const text = match[1].trim();
                if (/^[\d-]+$/.test(text)) {
                    episodeTypes.canon.push(...parseEpisodeText(text));
                }
            }
        }

        // 2. Mixed Canon/Filler Episodes
        const mixedDivMatch = html.match(/<div[^>]*class=["'][^"']*mixed_canon\/filler[^"']*["'][^>]*>[\s\S]*?<span[^>]*class=["']Episodes["'][^>]*>(.*?)<\/span>[\s\S]*?<\/div>/i);
        if (mixedDivMatch) {
            const episodesHtml = mixedDivMatch[1];
            const linkMatches = episodesHtml.matchAll(/<a[^>]*>([^<]+)<\/a>/gi);
            for (const match of linkMatches) {
                const text = match[1].trim();
                if (/^[\d-]+$/.test(text)) {
                    episodeTypes.mixed.push(...parseEpisodeText(text));
                }
            }
        }

        // 3. Filler Episodes (excluding mixed_canon/filler which was already parsed)
        // Match ONLY <div class="filler"> NOT <div class="mixed_canon/filler">
        const fillerDivMatch = html.match(/<div[^>]*class=["']filler["'][^>]*>[\s\S]*?<span[^>]*class=["']Episodes["'][^>]*>(.*?)<\/span>[\s\S]*?<\/div>/i);
        if (fillerDivMatch) {
            const episodesHtml = fillerDivMatch[1];
            const linkMatches = episodesHtml.matchAll(/<a[^>]*>([^<]+)<\/a>/gi);
            for (const match of linkMatches) {
                const text = match[1].trim();
                if (/^[\d-]+$/.test(text)) {
                    episodeTypes.filler.push(...parseEpisodeText(text));
                }
            }
        }

        // Calculate total episodes (highest episode number across ALL types)
        // Must include fillers too - otherwise anime ending with fillers get wrong total
        const allEpisodes = [...episodeTypes.canon, ...episodeTypes.mixed, ...episodeTypes.filler, ...episodeTypes.anime_canon];
        if (allEpisodes.length > 0) {
            episodeTypes.totalEpisodes = Math.max(...allEpisodes);
        }

        console.log(`[Anime Tracker] ✓ Fetched episode types for ${animeSlug}:`, episodeTypes);
        console.log(`[Anime Tracker] Total episodes (highest canon): ${episodeTypes.totalEpisodes}`);
        return episodeTypes;
    } catch (error) {
        console.error(`[Anime Tracker] ✗ Failed to fetch episode types for ${animeSlug}:`, error);
        throw error;
    }
}

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('[Anime Tracker] Extension installed');
        
        // Initialize storage structure - use LOCAL storage (larger quota)
        chrome.storage.local.set({
            animeData: {},
            videoProgress: {},
            settings: {
                watchThreshold: 0.85,
                notifications: true
            }
        });
    } else if (details.reason === 'update') {
        const version = chrome.runtime.getManifest().version;
        // Beautiful log με gradient
        const style = 'color: rgb(255, 107, 107); font-weight: bold; font-size: 13px; padding: 4px 8px; background: linear-gradient(135deg, rgba(255, 107, 107, 0.2), rgba(255, 142, 83, 0.2)); border-radius: 4px;';
        console.log(`%c🎬 Anime Tracker v${version}`, style);
        
        // Migration: Move data from sync to local if needed
        migrateFromSyncToLocal();
    }
});

/**
 * Migrate data from sync storage to local storage
 * This ensures compatibility with older versions
 * Note: trackedEpisodes is ignored - only animeData is source of truth
 */
async function migrateFromSyncToLocal() {
    try {
        const syncData = await chrome.storage.sync.get(['animeData', 'videoProgress']);

        // FIX: Validate sync data structure
        const validAnimeData = syncData.animeData && typeof syncData.animeData === 'object' && !Array.isArray(syncData.animeData);
        const validVideoProgress = syncData.videoProgress && typeof syncData.videoProgress === 'object' && !Array.isArray(syncData.videoProgress);

        // Check if there's valid data in sync storage
        const hasSyncData = (validAnimeData && Object.keys(syncData.animeData).length > 0) ||
                           (validVideoProgress && Object.keys(syncData.videoProgress).length > 0);

        if (hasSyncData) {
            console.log('[Anime Tracker] Migrating data from sync to local storage...');

            // Get existing local data
            const localData = await chrome.storage.local.get(['animeData', 'videoProgress']);

            // FIX: Validate local data structure
            const localAnimeData = localData.animeData && typeof localData.animeData === 'object' ? localData.animeData : {};
            const localVideoProgress = localData.videoProgress && typeof localData.videoProgress === 'object' ? localData.videoProgress : {};

            // Merge data (local takes priority)
            const merged = {
                animeData: { ...(validAnimeData ? syncData.animeData : {}), ...localAnimeData },
                videoProgress: { ...(validVideoProgress ? syncData.videoProgress : {}), ...localVideoProgress }
            };

            // Save to local
            await chrome.storage.local.set(merged);

            // Clear sync storage (including old trackedEpisodes if exists)
            await chrome.storage.sync.remove(['animeData', 'trackedEpisodes', 'videoProgress']);

            console.log('[Anime Tracker] Migration complete -', Object.keys(merged.animeData).length, 'anime,', Object.keys(merged.videoProgress).length, 'progress entries');
        }
    } catch (error) {
        console.error('[Anime Tracker] Migration error:', error);
        // FIX: Don't throw - migration is not critical
    }
}

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_STATS') {
        // Use LOCAL storage
        chrome.storage.local.get(['animeData'], (result) => {
            if (chrome.runtime.lastError) {
                console.error('[Anime Tracker] Storage error:', chrome.runtime.lastError.message);
                sendResponse({ error: chrome.runtime.lastError.message });
                return;
            }
            
            const data = result.animeData || {};
            const stats = {
                totalAnime: Object.keys(data).length,
                totalEpisodes: 0,
                totalWatchTime: 0
            };
            
            for (const anime of Object.values(data)) {
                stats.totalEpisodes += anime.episodes?.length || 0;
                stats.totalWatchTime += anime.totalWatchTime || 0;
            }
            
            sendResponse(stats);
        });
        return true; // Keep channel open for async response
    }
    
    if (message.type === 'CLEAR_DATA') {
        // Clear LOCAL storage
        chrome.storage.local.set({
            animeData: {},
            videoProgress: {}
        }, () => {
            if (chrome.runtime.lastError) {
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true });
            }
        });
        return true;
    }

    if (message.type === 'SYNC_TO_FIREBASE') {
        // This message is sent when content script updates data
        // The popup will handle syncing to Firebase when it's open
        sendResponse({ received: true });
        return true;
    }

    if (message.type === 'GET_VERSION') {
        sendResponse({ version: chrome.runtime.getManifest().version });
        return true;
    }

    if (message.type === 'FETCH_EPISODE_TYPES') {
        // Fetch episode types from animefillerlist.com
        const animeSlug = message.animeSlug;
        if (!animeSlug) {
            sendResponse({ error: 'Missing animeSlug' });
            return true;
        }

        fetchEpisodeTypesFromAnimeFillerList(animeSlug)
            .then(episodeTypes => {
                sendResponse({ success: true, episodeTypes });
            })
            .catch(error => {
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keep channel open for async response
    }

    // Default response for unknown message types
    sendResponse({ error: 'Unknown message type' });
    return true;
});

// Listen for storage changes and auto-sync to Firebase
let syncDebounceTimeout = null;

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;

    // Check if animeData changed (new episode tracked)
    if (changes.animeData) {
        const oldData = changes.animeData.oldValue || {};
        const newData = changes.animeData.newValue || {};

        // Count total episodes
        const countEpisodes = (data) => {
            let total = 0;
            for (const anime of Object.values(data)) {
                total += anime.episodes?.length || 0;
            }
            return total;
        };

        const oldCount = countEpisodes(oldData);
        const newCount = countEpisodes(newData);

        if (newCount > oldCount) {
            // Beautiful styled log
            const trackerStyle = 'color: rgb(255, 107, 107); font-weight: bold; font-size: 12px; padding: 2px 6px; background: rgba(255, 107, 107, 0.1); border-radius: 3px;';
            const msgStyle = 'color: rgb(148, 163, 184); font-size: 11px;';
            console.log(`%cAnime Tracker %c➕ New episode tracked! (${oldCount} → ${newCount})`, trackerStyle, msgStyle);

            // Debounce sync to avoid multiple rapid syncs
            if (syncDebounceTimeout) {
                clearTimeout(syncDebounceTimeout);
            }

            syncDebounceTimeout = setTimeout(() => {
                syncDebounceTimeout = null;
                syncToFirebase();
            }, 2000); // Wait 2 seconds before syncing
        } else if (oldCount !== newCount && newCount > 0) {
            console.log(`[Anime Tracker] Anime data changed: ${oldCount} → ${newCount} episodes`);
        }
    }
});

// Handle extension startup
chrome.runtime.onStartup.addListener(() => {
    console.log('[Anime Tracker] Extension started');
    // Run migration check on startup too
    migrateFromSyncToLocal();
});
