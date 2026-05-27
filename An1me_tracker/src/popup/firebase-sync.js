/**
 * Anime Tracker - Firebase Sync
 * Handles Firebase authentication and cloud synchronization
 */

const {
    areProgressMapsEqual,
    shallowEqualDeletedAnime,
    shallowEqualObjectMap
} = window.AnimeTracker.MergeUtils;

// Playback & Tracking toggles synced to Firestore under a single
// `playbackSettings` field. Each entry maps the cloud field name to the
// chrome.storage.local key + how to interpret raw stored values as a bool.
// `updatedAt` is a sibling ISO string used for last-write-wins between
// devices — keeps writes to a single field-masked PATCH and reads piggyback
// on the existing user-doc fetch (no extra Firestore round trips).
const PLAYBACK_SETTINGS_KEY = 'playbackSettings';
const PLAYBACK_SETTINGS_UPDATED_AT_KEY = 'playbackSettingsUpdatedAt';
const PLAYBACK_SETTINGS_DEBOUNCE_MS = 1500;
const PLAYBACK_SETTINGS_MAP = {
    copyGuard: { storage: 'copyGuardEnabled', interpret: (v) => v !== false, defaultsTo: true },
    smartNotif: { storage: 'smartNotificationsEnabled', interpret: (v) => v === true, defaultsTo: false },
    autoSkipFiller: { storage: 'autoSkipFillers', interpret: (v) => v === true, defaultsTo: false },
    skiptimeHelper: { storage: 'skiptimeHelperEnabled', interpret: (v) => v === true, defaultsTo: false }
};

function readPlaybackSettings(stored) {
    const settings = {};
    for (const [field, cfg] of Object.entries(PLAYBACK_SETTINGS_MAP)) {
        const raw = stored?.[cfg.storage];
        settings[field] = (typeof raw === 'undefined') ? cfg.defaultsTo : cfg.interpret(raw);
    }
    return settings;
}

function playbackSettingsEqual(a, b) {
    if (!a || !b) return false;
    return Object.keys(PLAYBACK_SETTINGS_MAP).every((k) => !!a[k] === !!b[k]);
}

const FirebaseSync = {
    // State
    currentUser: null,
    saveToCloudTimeout: null,
    isSavingToCloud: false,
    pendingSave: null,
    currentSavePromise: null,
    cloudSaveRetryCount: 0,
    userDocumentCache: null,
    // Task 6: bumped from 5 → 10 min to align with the SW's _BG_CLOUD_TTL.
    // The lastUpdated short-circuit (below) keeps stale data visible only
    // when the cloud doc genuinely hasn't changed — a normal cross-device
    // write triggers a full re-fetch immediately because lastUpdated diverged.
    USER_DOCUMENT_CACHE_TTL_MS: 10 * 60 * 1000,
    // Task 6 telemetry: counts cache outcomes so the demo criterion
    // ("9 cache-hits out of 10 popup opens") is verifiable from console.
    cacheStats: { fresh: 0, revalidated: 0, fullFetch: 0 },
    // Task 8: chrome.storage.session key used to persist the popup's user-doc
    // cache across popup-close/reopen within the same browser session.
    // session storage is auto-wiped on browser restart and on extension
    // reload, so this is correct: reuse within session, fresh fetch after
    // restart. Permission "storage" already covers session (no manifest
    // change required).
    SESSION_CACHE_KEY: '_userDocumentCacheV1',
    _sessionHydratePromise: null,
    // Last result of loadAndSyncData — captured for diagnostics so the popup
    // can show the user a clear "what just happened" message instead of a
    // generic "Cloud Synced" badge that hides empty-init / 404 / auth errors.
    lastSyncResult: null,

    // Playback-settings save state (separate from main library save so a
    // toggle flip doesn't piggyback a full animeData write).
    playbackSaveTimeout: null,
    pendingPlaybackSave: null,
    isSavingPlayback: false,

    // Warm idToken cache. cleanup() runs from beforeunload / pagehide where
    // any awaited storage round-trip is unreliable — Chrome may close the
    // popup before the await resumes. By keeping the latest idToken (and its
    // expiresAt) in memory, cleanup() can build the PATCH body and fire the
    // keepalive fetch synchronously, with no awaits between event arrival and
    // the fetch() call. A timer refreshes the cache before expiry so the
    // window of "warm token unusable" is tiny.
    _warmIdToken: null,
    _warmIdTokenExpiresAt: 0,
    _warmTokenRefreshTimer: null,
    WARM_TOKEN_REFRESH_INTERVAL_MS: 45 * 60 * 1000,
    WARM_TOKEN_MIN_LIFETIME_MS: 5 * 60 * 1000, // refresh if <5 min remaining

    cloneAny(data) {
        if (data === null || typeof data === 'undefined') return null;
        try {
            if (typeof structuredClone === 'function') {
                return structuredClone(data);
            }
        } catch {
            // Fall through to JSON clone.
        }

        try {
            return JSON.parse(JSON.stringify(data));
        } catch {
            if (Array.isArray(data)) return data.slice();
            if (data && typeof data === 'object') return { ...data };
            return data;
        }
    },

    cloneSyncData(data) {
        const cloned = this.cloneAny(data);
        if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) {
            const source = (data && typeof data === 'object') ? data : {};
            return {
                animeData: source.animeData || {},
                videoProgress: source.videoProgress || {},
                deletedAnime: source.deletedAnime || {},
                groupCoverImages: source.groupCoverImages || {},
                goalSettings: source.goalSettings || {},
                badgeUnlocks: source.badgeUnlocks || {}
            };
        }

        return cloned;
    },

    clearCachedUserDocument(uid = null) {
        if (!uid) {
            this.userDocumentCache = null;
            this._dropSessionCache();
            return;
        }
        if (this.userDocumentCache?.uid === uid) {
            this.userDocumentCache = null;
            this._dropSessionCache();
        }
    },

    getCachedUserDocument(uid) {
        const cache = this.userDocumentCache;
        if (!uid || !cache || cache.uid !== uid) {
            return { hit: false, data: null };
        }

        if ((Date.now() - cache.cachedAt) > this.USER_DOCUMENT_CACHE_TTL_MS) {
            // Task 6: don't drop the entry yet — it may be revalidatable
            // via a tiny lastUpdated mask GET. Caller checks staleness via
            // getStaleCachedUserDocument(); a true cache miss only happens
            // when the entry is missing or belongs to a different uid.
            return { hit: false, data: null, stale: true };
        }

        return {
            hit: true,
            data: this.cloneAny(cache.data)
        };
    },

    /**
     * Task 6: read-only accessor for an entry that has fallen outside the
     * 10-minute TTL window but still belongs to the active uid. Used by
     * the lastUpdated short-circuit to decide whether to issue a tiny
     * mask GET (instead of a full doc fetch).
     */
    getStaleCachedUserDocument(uid) {
        const cache = this.userDocumentCache;
        if (!uid || !cache || cache.uid !== uid) return null;
        return {
            data: this.cloneAny(cache.data),
            cachedAt: cache.cachedAt,
            lastUpdated: cache.data?.lastUpdated || null
        };
    },

    /**
     * Refresh cachedAt without copying the doc — used when the lastUpdated
     * revalidation confirms the cached doc is still current. Cheap.
     */
    bumpCachedAt(uid) {
        if (!this.userDocumentCache || this.userDocumentCache.uid !== uid) return;
        this.userDocumentCache.cachedAt = Date.now();
        this._persistSessionCache().catch(() => {});
    },

    /**
     * Task 6 feature flag check. Defaults true. Flip via
     * chrome.storage.local._featureFlags.CACHE_SHORT_CIRCUIT_ENABLED = false
     * for emergency rollback.
     */
    async isCacheShortCircuitEnabled() {
        try {
            const stored = await new Promise((res) =>
                chrome.storage.local.get(['_featureFlags'], (r) => { void chrome.runtime.lastError; res(r || {}); }));
            const flags = stored._featureFlags;
            if (!flags || typeof flags !== 'object') return true;
            return flags.CACHE_SHORT_CIRCUIT_ENABLED !== false;
        } catch { return true; }
    },

    /**
     * Validate the popup's cached cloud doc with a tiny mask GET on
     * `lastUpdated`. Returns:
     *   { match: true,  cloudLastUpdated }  — cache is current; reuse it
     *   { match: false, cloudLastUpdated }  — cache is stale; full GET needed
     *   { match: null,  reason }            — couldn't validate (auth error,
     *                                          missing field, etc.) → caller
     *                                          must do a full GET
     *
     * Costs ~140 bytes vs the full library doc (often 100s of KB).
     */
    async _validateCacheViaLastUpdated(uid, cachedLastUpdated) {
        if (!uid || !cachedLastUpdated) return { match: null, reason: 'no-baseline' };
        try {
            const probe = await FirebaseLib.getDocument('users', uid, { mask: ['lastUpdated'] });
            // 404 → no cloud doc → cache definitely stale.
            if (!probe) return { match: false, cloudLastUpdated: null };
            const cloudLastUpdated = probe.lastUpdated || null;
            // Treat absent `lastUpdated` field as "cannot validate" — fall
            // back to full GET (legacy docs from before lastUpdated existed).
            if (!cloudLastUpdated) return { match: null, reason: 'cloud-missing-lastUpdated' };
            return { match: cloudLastUpdated === cachedLastUpdated, cloudLastUpdated };
        } catch (e) {
            // Auth errors propagate up — let the existing 401/403 path handle
            // them (Task 10). Other errors fall back to full GET.
            if (e?.status === 401 || e?.status === 403) throw e;
            return { match: null, reason: e?.message || 'probe-failed' };
        }
    },

    setCachedUserDocument(uid, data) {
        if (!uid) return;
        this.userDocumentCache = {
            uid,
            cachedAt: Date.now(),
            data: this.cloneAny(data)
        };
        // Task 8: persist to session storage so popup-close/reopen reuses
        // the cache without forcing a re-fetch. Best-effort.
        this._persistSessionCache().catch(() => {});
    },

    /**
     * Task 8: hydrate userDocumentCache from chrome.storage.session if a
     * fresh-enough entry exists for the active uid. Idempotent — safe to
     * call multiple times. Wired into init() so the very first
     * loadAndSyncData of a session benefits from a previous popup's cache.
     */
    async hydrateSessionCache(uid) {
        if (!uid) return;
        if (this.userDocumentCache?.uid === uid) return;        // already hot
        if (this._sessionHydratePromise) return this._sessionHydratePromise;
        const sessionApi = chrome?.storage?.session;
        if (!sessionApi) return;        // older Chromium / not supported
        this._sessionHydratePromise = (async () => {
            try {
                const stored = await new Promise((res) =>
                    sessionApi.get([this.SESSION_CACHE_KEY], (r) => { void chrome.runtime.lastError; res(r || {}); }));
                const entry = stored[this.SESSION_CACHE_KEY];
                if (
                    entry &&
                    entry.uid === uid &&
                    entry.cachedAt &&
                    (Date.now() - entry.cachedAt) < this.USER_DOCUMENT_CACHE_TTL_MS &&
                    entry.data
                ) {
                    this.userDocumentCache = {
                        uid,
                        cachedAt: entry.cachedAt,
                        data: entry.data
                    };
                    PopupLogger.debug('Sync', `session-cache hydrated (${Math.round((Date.now() - entry.cachedAt) / 1000)}s old)`);
                } else if (entry && entry.uid !== uid) {
                    // Account swap inside the same browser session — drop.
                    this._dropSessionCache();
                }
            } catch { /* best-effort */ }
            finally { this._sessionHydratePromise = null; }
        })();
        return this._sessionHydratePromise;
    },

    async _persistSessionCache() {
        const sessionApi = chrome?.storage?.session;
        if (!sessionApi) return;
        const c = this.userDocumentCache;
        if (!c) return;
        const payload = { [this.SESSION_CACHE_KEY]: { uid: c.uid, cachedAt: c.cachedAt, data: c.data } };
        return new Promise((res) => {
            try { sessionApi.set(payload, () => { void chrome.runtime.lastError; res(); }); }
            catch { res(); }
        });
    },

    _dropSessionCache() {
        const sessionApi = chrome?.storage?.session;
        if (!sessionApi) return;
        try {
            sessionApi.remove([this.SESSION_CACHE_KEY], () => { void chrome.runtime.lastError; });
        } catch { /* ignore */ }
    },

    /**
     * Refresh the warm idToken cache. Reads firebase_tokens from storage and
     * — if the token is expiring within WARM_TOKEN_MIN_LIFETIME_MS — calls
     * FirebaseLib.getIdToken() so the lib can run its own refresh single-flight.
     * Failures are non-fatal: cleanup() falls back to the slower
     * FirebaseLib.setDocument path if no warm token is cached.
     */
    async _refreshWarmToken() {
        try {
            const stored = await chrome.storage.local.get(['firebase_tokens']);
            const tokens = stored?.firebase_tokens;
            if (!tokens?.idToken || !tokens.expiresAt) {
                this._warmIdToken = null;
                this._warmIdTokenExpiresAt = 0;
                return;
            }
            const expiresIn = tokens.expiresAt - Date.now();
            if (expiresIn < this.WARM_TOKEN_MIN_LIFETIME_MS) {
                // Trigger the lib's refresh flow + re-read the new tokens.
                try { await FirebaseLib.getIdToken(); } catch { /* ignore */ }
                const after = await chrome.storage.local.get(['firebase_tokens']);
                const t2 = after?.firebase_tokens;
                if (t2?.idToken && t2.expiresAt) {
                    this._warmIdToken = t2.idToken;
                    this._warmIdTokenExpiresAt = t2.expiresAt;
                }
                return;
            }
            this._warmIdToken = tokens.idToken;
            this._warmIdTokenExpiresAt = tokens.expiresAt;
        } catch { /* best-effort */ }
    },

    /**
     * Start the warm-token refresh timer. Idempotent.
     */
    _startWarmTokenTimer() {
        if (this._warmTokenRefreshTimer) return;
        this._warmTokenRefreshTimer = setInterval(
            () => { this._refreshWarmToken(); },
            this.WARM_TOKEN_REFRESH_INTERVAL_MS
        );
    },

    /**
     * Read current playback toggle state from chrome.storage.local and
     * return the cloud-shaped object. Used when queueing a save.
     */
    async readPlaybackSettingsFromStorage() {
        const keys = Object.values(PLAYBACK_SETTINGS_MAP).map((c) => c.storage);
        keys.push(PLAYBACK_SETTINGS_UPDATED_AT_KEY);
        const stored = await window.AnimeTracker.Storage.get(keys);
        return {
            settings: readPlaybackSettings(stored),
            updatedAt: stored[PLAYBACK_SETTINGS_UPDATED_AT_KEY] || null
        };
    },

    /**
     * Queue a debounced playback-settings cloud write. Reads current toggle
     * state from storage, stamps `updatedAt`, persists it locally, then
     * PATCHes ONLY the `playbackSettings` field. Coalesces rapid toggling
     * into a single write.
     *
     * Idempotent against the cached cloud doc — skips the network call when
     * the desired payload already matches what's in the cache.
     */
    async queuePlaybackSettingsSave({ immediate = false } = {}) {
        const { settings } = await this.readPlaybackSettingsFromStorage();
        const updatedAt = new Date().toISOString();
        // Stamp the local copy unconditionally. When the user is signed out
        // this still records "the user changed something at time X", so a
        // later sign-in's loadAndSyncData picks the right side in the
        // last-write-wins compare instead of clobbering offline edits.
        try {
            await window.AnimeTracker.Storage.set({ [PLAYBACK_SETTINGS_UPDATED_AT_KEY]: updatedAt });
        } catch (e) {
            PopupLogger.warn('Firebase', `Failed to stamp local playbackSettingsUpdatedAt: ${e?.message}`);
        }

        if (!this.currentUser) return;

        this.pendingPlaybackSave = { ...settings, updatedAt };

        if (this.playbackSaveTimeout) {
            clearTimeout(this.playbackSaveTimeout);
            this.playbackSaveTimeout = null;
        }

        if (immediate) {
            return this.flushPlaybackSettingsSave();
        }

        return new Promise((resolve) => {
            this.playbackSaveTimeout = setTimeout(async () => {
                this.playbackSaveTimeout = null;
                try {
                    await this.flushPlaybackSettingsSave();
                } catch (e) {
                    PopupLogger.warn('Firebase', `Playback settings save failed: ${e?.message}`);
                }
                resolve();
            }, PLAYBACK_SETTINGS_DEBOUNCE_MS);
        });
    },

    async flushPlaybackSettingsSave() {
        if (!this.currentUser || !this.pendingPlaybackSave) return;
        if (this.isSavingPlayback) return;

        const payload = this.pendingPlaybackSave;
        this.pendingPlaybackSave = null;
        this.isSavingPlayback = true;

        try {
            const { data: cached } = this.getCachedUserDocument(this.currentUser.uid);
            const cachedPlayback = cached?.playbackSettings || null;
            if (cachedPlayback
                && cachedPlayback.updatedAt === payload.updatedAt
                && playbackSettingsEqual(cachedPlayback, payload)) {
                // Cache already reflects this exact payload — skip the PATCH.
                return;
            }

            await FirebaseLib.setDocument('users', this.currentUser.uid, {
                playbackSettings: payload
            }, { fields: ['playbackSettings'] });

            // Seed the local cache and the SW's so a follow-up sync doesn't
            // pay a Firestore read just to learn what we just wrote.
            if (cached) {
                const updated = { ...cached, playbackSettings: payload };
                this.setCachedUserDocument(this.currentUser.uid, updated);
            }
            try {
                chrome.runtime.sendMessage(
                    { type: 'UPDATE_BG_PLAYBACK_SETTINGS', playbackSettings: payload },
                    () => { void chrome.runtime.lastError; }
                );
            } catch { /* best effort */ }

            PopupLogger.log('Firebase', `Playback settings synced · cg=${payload.copyGuard?'1':'0'} sn=${payload.smartNotif?'1':'0'} af=${payload.autoSkipFiller?'1':'0'} sh=${payload.skiptimeHelper?'1':'0'}`);
        } catch (error) {
            // Re-queue so the next flush retries — but don't infinite-loop:
            // only restore if nothing newer landed in the meantime.
            if (!this.pendingPlaybackSave) this.pendingPlaybackSave = payload;
            throw error;
        } finally {
            this.isSavingPlayback = false;
        }
    },

    /**
     * Apply cloud playback settings to local storage if the cloud copy is
     * newer than what we have locally. Returns true if local was updated.
     */
    async applyCloudPlaybackSettings(cloudPlayback) {
        if (!cloudPlayback || typeof cloudPlayback !== 'object') return false;
        const cloudUpdatedAt = cloudPlayback.updatedAt || null;
        if (!cloudUpdatedAt) return false;

        const keys = Object.values(PLAYBACK_SETTINGS_MAP).map((c) => c.storage);
        keys.push(PLAYBACK_SETTINGS_UPDATED_AT_KEY);
        const stored = await window.AnimeTracker.Storage.get(keys);
        const localUpdatedAt = stored[PLAYBACK_SETTINGS_UPDATED_AT_KEY] || null;

        // Cloud wins only when strictly newer — ties favor local so we don't
        // clobber an in-flight user toggle with the value we just pushed.
        if (localUpdatedAt && Date.parse(localUpdatedAt) >= Date.parse(cloudUpdatedAt)) {
            return false;
        }

        const writes = { [PLAYBACK_SETTINGS_UPDATED_AT_KEY]: cloudUpdatedAt };
        let changed = false;
        for (const [field, cfg] of Object.entries(PLAYBACK_SETTINGS_MAP)) {
            const next = !!cloudPlayback[field];
            const current = (typeof stored[cfg.storage] === 'undefined') ? cfg.defaultsTo : cfg.interpret(stored[cfg.storage]);
            if (current !== next) {
                writes[cfg.storage] = next;
                changed = true;
            }
        }

        if (!changed) {
            // Just bump the updatedAt so we don't keep re-comparing.
            await window.AnimeTracker.Storage.set(writes);
            return false;
        }

        await window.AnimeTracker.Storage.set(writes);
        return true;
    },

    /**
     * Apply cloud AniList auth to local storage if the cloud copy is newer
     * than what we have locally. Returns true if local was updated.
     *
     * Cloud shape (sibling to playbackSettings on the user doc):
     *   anilistAuth: {
     *     accessToken: '...' | null,    // null when desktop disconnected
     *     expiresAt:  <ms epoch> | 0,
     *     viewer:     { id, name, avatar } | null,
     *     username:   'anilist-handle' | null,  // optional mirror of anilist_username
     *     updatedAt:  '<ISO>'            // last-write-wins
     *   }
     *
     * Mirrored in BG (background.js applyCloudAnilistAuth) so a wake-on-poll
     * also propagates without going through the popup. Both implementations
     * keep the SAME last-write-wins semantics: cloud must be strictly newer
     * to win; ties stay with local (protects an in-flight local connect()).
     */
    async applyCloudAnilistAuth(cloudAnilist) {
        if (!cloudAnilist || typeof cloudAnilist !== 'object') return false;
        const cloudUpdatedAt = cloudAnilist.updatedAt || null;
        if (!cloudUpdatedAt) return false;

        const stored = await window.AnimeTracker.Storage.get(['anilist_auth', 'anilist_username']);
        const localAuth = stored.anilist_auth || null;
        const localUpdatedAt = localAuth?.updatedAt || null;

        if (localUpdatedAt && Date.parse(localUpdatedAt) >= Date.parse(cloudUpdatedAt)) {
            return false;
        }

        const cloudAccess = typeof cloudAnilist.accessToken === 'string' && cloudAnilist.accessToken
            ? cloudAnilist.accessToken
            : null;
        const cloudExpiresAt = Number.isFinite(cloudAnilist.expiresAt) ? cloudAnilist.expiresAt : 0;
        // Skip applying tokens that are already expired (or about to expire
        // in the next 60 s) — they'd just trigger an immediate `reconnect`
        // 401 in anilist-sync.js. Treat that case the same as cloud-cleared.
        const cloudHasValidToken = cloudAccess && (!cloudExpiresAt || cloudExpiresAt > Date.now() + 60000);

        let touched = false;
        const setKeys = {};
        const removeKeys = [];

        if (cloudHasValidToken) {
            const newAuth = {
                accessToken: cloudAccess,
                expiresAt: cloudExpiresAt,
                viewer: cloudAnilist.viewer && typeof cloudAnilist.viewer === 'object'
                    ? cloudAnilist.viewer
                    : null,
                updatedAt: cloudUpdatedAt
            };
            // Skip the local write when the existing local token is byte-for-byte
            // identical and just has an older stamp (idempotency — avoids waking
            // anilist-sync.js's storage.onChanged listener for a no-op).
            const isIdentical = localAuth
                && localAuth.accessToken === newAuth.accessToken
                && localAuth.expiresAt === newAuth.expiresAt
                && JSON.stringify(localAuth.viewer || null) === JSON.stringify(newAuth.viewer || null);
            if (!isIdentical) {
                setKeys.anilist_auth = newAuth;
                touched = true;
            } else if (localUpdatedAt !== cloudUpdatedAt) {
                // Same payload, just bump the stamp so we don't keep re-comparing.
                setKeys.anilist_auth = newAuth;
                touched = true;
            }
        } else if (localAuth) {
            // Cloud says "disconnected" and is newer than local → mirror locally.
            removeKeys.push('anilist_auth');
            touched = true;
        }

        if (typeof cloudAnilist.username === 'string' && cloudAnilist.username) {
            if (stored.anilist_username !== cloudAnilist.username) {
                setKeys.anilist_username = cloudAnilist.username;
                touched = true;
            }
        }

        if (!touched) return false;

        if (Object.keys(setKeys).length > 0) {
            await window.AnimeTracker.Storage.set(setKeys);
        }
        if (removeKeys.length > 0) {
            await window.AnimeTracker.Storage.remove(removeKeys);
        }
        PopupLogger.log('Sync', `AniList auth applied from cloud (cloud.updatedAt=${cloudUpdatedAt}, valid=${cloudHasValidToken ? '1' : '0'})`);
        return true;
    },

    /**
     * Push the local AniList auth state up to Firestore. Called from the
     * popup's connect()/disconnect() paths in anilist-api.js — single
     * writer model (BG never pushes anilistAuth, only reads).
     *
     * `auth` shape:
     *   { accessToken, expiresAt, viewer } | null   (null = clear)
     *
     * Optional `username` (string) is also pushed so a public-list import
     * on the desktop seeds the username for the mobile UI placeholder.
     *
     * Idempotent: skips the PATCH when the cached cloud doc already has
     * the same payload + updatedAt.
     */
    async pushAnilistAuthToCloud(auth, username = null) {
        if (!this.currentUser) return;
        const updatedAt = new Date().toISOString();

        // Build the canonical cloud shape. Always include `updatedAt` so
        // the read side has a timestamp to compare against. Token-cleared
        // (disconnect) is represented as accessToken: null + expiresAt: 0
        // so we never lose the timestamp marker that proves a disconnect
        // happened (otherwise a stale device might re-push an old token
        // after disconnect and silently re-enable sync).
        const payload = {
            accessToken: (auth && typeof auth.accessToken === 'string') ? auth.accessToken : null,
            expiresAt: (auth && Number.isFinite(auth.expiresAt)) ? auth.expiresAt : 0,
            viewer: (auth && auth.viewer && typeof auth.viewer === 'object') ? auth.viewer : null,
            username: typeof username === 'string' && username ? username : null,
            updatedAt
        };

        try {
            // Stamp the local auth too so the next reconcile sees the same
            // updatedAt and won't trigger a redundant cloud→local apply.
            // Done BEFORE the network PATCH so an unload mid-flight still
            // leaves a coherent local state.
            if (payload.accessToken) {
                const existing = (await window.AnimeTracker.Storage.get(['anilist_auth'])).anilist_auth || {};
                await window.AnimeTracker.Storage.set({
                    anilist_auth: {
                        ...existing,
                        accessToken: payload.accessToken,
                        expiresAt: payload.expiresAt,
                        viewer: payload.viewer,
                        updatedAt
                    }
                });
            }

            const { data: cached } = this.getCachedUserDocument(this.currentUser.uid);
            const cachedAnilist = cached?.anilistAuth || null;
            const sameToken = cachedAnilist
                && cachedAnilist.accessToken === payload.accessToken
                && cachedAnilist.expiresAt === payload.expiresAt
                && cachedAnilist.username === payload.username
                && JSON.stringify(cachedAnilist.viewer || null) === JSON.stringify(payload.viewer || null);
            if (sameToken) {
                // Cache says cloud already has this exact value — skip the PATCH.
                // Still bump the local stamp above so we don't re-enter this
                // path on the next reconcile.
                return false;
            }

            await FirebaseLib.setDocument('users', this.currentUser.uid, {
                anilistAuth: payload
            }, { fields: ['anilistAuth'] });

            // Seed the local + SW caches so the SW's next storage.onChanged
            // sync doesn't burn a Firestore read fetching what we just wrote.
            if (cached) {
                this.setCachedUserDocument(this.currentUser.uid, { ...cached, anilistAuth: payload });
            }
            try {
                chrome.runtime.sendMessage(
                    { type: 'UPDATE_BG_ANILIST_AUTH', anilistAuth: payload },
                    () => { void chrome.runtime.lastError; }
                );
            } catch { /* best-effort */ }
            PopupLogger.log('Firebase',
                `AniList auth pushed to cloud (token=${payload.accessToken ? 'set' : 'cleared'}, viewer=${payload.viewer?.name || 'none'})`);
            return true;
        } catch (e) {
            PopupLogger.warn('Firebase', `Push AniList auth failed: ${e?.message || e}`);
            throw e;
        }
    },

    async hydrateSyncData(data) {
        const payload = this.cloneSyncData(data);
        const missingKeys = ['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages', 'goalSettings', 'badgeUnlocks']
            .filter((key) => typeof payload[key] === 'undefined');

        if (missingKeys.length > 0) {
            try {
                const stored = await window.AnimeTracker.Storage.get(missingKeys);
                for (const key of missingKeys) {
                    payload[key] = stored[key] || this.pendingSave?.[key] || {};
                }
            } catch (error) {
                PopupLogger.warn('Firebase', `Failed to hydrate sync payload: ${error?.message}`);
                for (const key of missingKeys) {
                    payload[key] = this.pendingSave?.[key] || {};
                }
            }
        }

        payload.animeData = payload.animeData || {};
        payload.videoProgress = payload.videoProgress || {};
        payload.deletedAnime = payload.deletedAnime || {};
        payload.groupCoverImages = payload.groupCoverImages || {};
        payload.goalSettings = payload.goalSettings || {};
        payload.badgeUnlocks = payload.badgeUnlocks || {};
        return payload;
    },

    summarizeSyncData(data) {
        const animeData = data?.animeData || {};
        const videoProgress = data?.videoProgress || {};
        const deletedAnime = data?.deletedAnime || {};
        const groupCoverImages = data?.groupCoverImages || {};
        const goalSettings = data?.goalSettings || {};
        const badgeUnlocks = data?.badgeUnlocks || {};

        const animeCount = Object.keys(animeData).length;
        const episodeCount = Object.values(animeData).reduce((sum, anime) => {
            return sum + (Array.isArray(anime?.episodes) ? anime.episodes.length : 0);
        }, 0);

        return {
            animeCount,
            episodeCount,
            progressCount: Object.keys(videoProgress).length,
            deletedCount: Object.keys(deletedAnime).length,
            coverCount: Object.keys(groupCoverImages).length,
            goalCount: Object.keys(goalSettings).length,
            badgeCount: Object.keys(badgeUnlocks).length
        };
    },

    /**
     * Compact one-liner of sync counts for log messages.
     * Returns e.g. "89a/3049e/3p/0d/98c/3g/32b" — readable without click-to-expand.
     */
    summarizeSyncDataString(data) {
        const s = this.summarizeSyncData(data);
        return `${s.animeCount}a/${s.episodeCount}e/${s.progressCount}p/${s.deletedCount}d/${s.coverCount}c/${s.goalCount}g/${s.badgeCount}b`;
    },

    /**
     * Get current user
     */
    getUser() {
        return this.currentUser;
    },

    /**
     * Initialize Firebase and check auth state
     */
    async init(callbacks) {
        const { onUserSignedIn, onUserSignedOut, onError } = callbacks;
        
        try {
            await FirebaseLib.init();

            FirebaseLib.onAuthStateChanged((user) => {
                const prevUid = this.currentUser?.uid || null;
                this.currentUser = user;
                if (!user || prevUid !== user.uid) {
                    this.clearCachedUserDocument();
                    this._warmIdToken = null;
                    this._warmIdTokenExpiresAt = 0;
                }
                if (user) {
                    PopupLogger.log('Firebase', `User signed in: ${user.email}`);
                    // Task 8: hydrate user-doc cache from session storage so
                    // a popup re-open within the same browser session reuses
                    // the previous popup's fetch — zero Firestore reads.
                    this.hydrateSessionCache(user.uid).catch(() => {});
                    // Pre-warm the idToken so cleanup() at popup close can fire
                    // its PATCH synchronously (no await between unload event
                    // and fetch). Periodic refresh keeps the cache valid.
                    this._refreshWarmToken();
                    this._startWarmTokenTimer();
                    if (onUserSignedIn) onUserSignedIn(user);
                } else {
                    PopupLogger.log('Firebase', 'No user');
                    if (onUserSignedOut) onUserSignedOut();
                }
            });

            PopupLogger.log('Firebase', 'Initialized');
        } catch (error) {
            PopupLogger.error('Firebase', 'Init error:', error);
            if (onError) onError(error);
        }
    },

    /**
     * Sign in with Google
     */
    async signInWithGoogle() {
        return await FirebaseLib.signInWithGoogle();
    },

    /**
     * Sign in with email + password (Identity Toolkit accounts:signInWithPassword)
     */
    async signInWithEmailPassword(email, password) {
        return await FirebaseLib.signInWithEmailPassword(email, password);
    },

    /**
     * Create a new account with email + password
     */
    async signUpWithEmailPassword(email, password) {
        return await FirebaseLib.signUpWithEmailPassword(email, password);
    },

    /**
     * Link/update a password on the currently signed-in account.
     * Used by the "Set password for mobile" flow so Google-only users can
     * also sign in via email + password on Orion/Safari with the same uid.
     */
    async setPasswordForCurrentUser(password) {
        return await FirebaseLib.setPasswordForCurrentUser(password);
    },

    /**
     * Send a password-reset email via Firebase's transactional template.
     */
    async sendPasswordReset(email) {
        return await FirebaseLib.sendPasswordReset(email);
    },

    /**
     * Probe an email/password combo without persisting the session.
     * Returns true if the credentials are valid (i.e. matches the current
     * password); false if Firebase rejects them. Used by the "Update
     * password" flow to block no-op saves.
     */
    async verifyPasswordSilently(email, password) {
        return await FirebaseLib.verifyPasswordSilently(email, password);
    },

    /**
     * Sign out
     */
    async signOut() {
        await FirebaseLib.signOut();
        this.currentUser = null;
        this.clearCachedUserDocument();
    },

    /**
     * Save data to cloud with debouncing
     */
    async saveToCloud(data, immediate = false) {
        const { CONFIG } = window.AnimeTracker;
        
        if (!this.currentUser) return Promise.resolve();

        this.pendingSave = await this.hydrateSyncData(data);
        PopupLogger.throttled(
            'Firebase',
            `queue-save:${this.currentUser.uid}`,
            5000,
            `Queued cloud save${immediate ? ' (immediate)' : ''} · ${this.summarizeSyncDataString(this.pendingSave)}`
        );

        if (this.saveToCloudTimeout) {
            clearTimeout(this.saveToCloudTimeout);
            this.saveToCloudTimeout = null;
        }

        this._pendingDebouncedResolvers = this._pendingDebouncedResolvers || [];
        this._pendingDebouncedRejecters = this._pendingDebouncedRejecters || [];

        const resolveAll = (value) => {
            const resolvers = this._pendingDebouncedResolvers.splice(0);
            this._pendingDebouncedRejecters.length = 0;
            for (const fn of resolvers) { try { fn(value); } catch {} }
        };
        const rejectAll = (error) => {
            const rejecters = this._pendingDebouncedRejecters.splice(0);
            this._pendingDebouncedResolvers.length = 0;
            for (const fn of rejecters) { try { fn(error); } catch {} }
        };

        if (immediate) {
            const result = this.performCloudSave();
            Promise.resolve(result).then(resolveAll, rejectAll);
            return result;
        }

        return new Promise((resolve, reject) => {
            this._pendingDebouncedResolvers.push(resolve);
            this._pendingDebouncedRejecters.push(reject);
            this.saveToCloudTimeout = setTimeout(async () => {
                try {
                    await this.performCloudSave();
                    resolveAll();
                } catch (error) {
                    PopupLogger.error('Firebase', 'Debounced save failed:', error);
                    rejectAll(error);
                }
            }, CONFIG.CLOUD_SAVE_DEBOUNCE_MS);
        });
    },

    /**
     * Perform the actual cloud save
     */
    async performCloudSave(elements = null) {
        const { CONFIG } = window.AnimeTracker;

        if (this.currentSavePromise) {
            await this.currentSavePromise;
        }

        if (this.isSavingToCloud) {
            // Don't recurse — just mark that we have pending data; it will be
            // picked up in the finally block of the current save.
            return;
        }

        if (!this.pendingSave || !this.currentUser) {
            this.cloudSaveRetryCount = 0;
            return;
        }

        const dataToSave = this.pendingSave;
        this.pendingSave = null;
        this.isSavingToCloud = true;

        this.currentSavePromise = (async () => {
            try {
                if (!dataToSave.animeData || typeof dataToSave.animeData !== 'object') {
                    throw new Error('Invalid animeData for cloud save');
                }

                if (!dataToSave.videoProgress || typeof dataToSave.videoProgress !== 'object') {
                    throw new Error('Invalid videoProgress for cloud save');
                }

                // Cloud-first per-key merge. Without this, a Firestore PATCH
                // with `updateMask=animeData` (etc.) replaces the whole map
                // field as-is, silently dropping any per-key changes another
                // device pushed since this popup last synced. We pull the
                // current cloud doc from the SW's cache (zero Firestore reads
                // on hit) and merge each map field with the pending snapshot
                // before the PATCH. On SW miss / unreachable the merge is a
                // no-op and we fall back to the previous behaviour (write
                // local-only) — the next BG poll will reconcile.
                let cloudDoc = null;
                try {
                    const swResp = await new Promise((resolve) => {
                        try {
                            chrome.runtime.sendMessage({ type: 'GET_CLOUD_DOC' }, (resp) => {
                                if (chrome.runtime.lastError) { resolve(null); return; }
                                resolve(resp || null);
                            });
                        } catch { resolve(null); }
                    });
                    if (swResp?.success && swResp.doc) cloudDoc = swResp.doc;
                } catch { /* SW unreachable — proceed without merge */ }

                const Util = (window.AnimeTracker && window.AnimeTracker.MergeUtils) || {};

                const localAnime = dataToSave.animeData || {};
                const localProgress = dataToSave.videoProgress || {};
                const localDeleted = dataToSave.deletedAnime || {};
                const localGroup = dataToSave.groupCoverImages || {};
                const localGoals = dataToSave.goalSettings || {};
                const localBadges = dataToSave.badgeUnlocks || {};

                const mergedAnime = (cloudDoc?.animeData && Util.mergeAnimeData)
                    ? Util.mergeAnimeData(localAnime, cloudDoc.animeData)
                    : (Util.stripAutoRepairedEpisodesFromMap
                        ? Util.stripAutoRepairedEpisodesFromMap(localAnime)
                        : localAnime);
                let mergedDeleted = (cloudDoc?.deletedAnime && Util.mergeDeletedAnime)
                    ? Util.mergeDeletedAnime(localDeleted, cloudDoc.deletedAnime)
                    : localDeleted;
                if (Util.pruneStaleDeletedAnime) {
                    mergedDeleted = Util.pruneStaleDeletedAnime(mergedAnime, mergedDeleted);
                }
                if (Util.applyDeletedAnime) {
                    Util.applyDeletedAnime(mergedAnime, mergedDeleted);
                }
                const mergedProgress = (cloudDoc?.videoProgress && Util.mergeVideoProgress)
                    ? Util.mergeVideoProgress(localProgress, cloudDoc.videoProgress)
                    : localProgress;
                const mergedGroup = (cloudDoc?.groupCoverImages && Util.mergeGroupCoverImages)
                    ? Util.mergeGroupCoverImages(localGroup, cloudDoc.groupCoverImages)
                    : localGroup;
                const mergedGoals = (cloudDoc?.goalSettings && Util.mergeGoalSettings)
                    ? Util.mergeGoalSettings(localGoals, cloudDoc.goalSettings)
                    : localGoals;
                const mergedBadges = (cloudDoc?.badgeUnlocks && Util.mergeBadgeUnlocks)
                    ? Util.mergeBadgeUnlocks(localBadges, cloudDoc.badgeUnlocks)
                    : localBadges;

                const { data: cachedDoc } = this.getCachedUserDocument(this.currentUser.uid);
                const shouldWriteEmail = !cachedDoc
                    || cachedDoc.email !== this.currentUser.email;

                // Idempotency gate — skip the PATCH entirely when every
                // payload field already matches the cached cloud doc. Without
                // this, calling saveToCloud after a no-op merge (e.g. a popup
                // open where nothing actually changed across devices) burns a
                // full-doc write per popup open. The compare uses the same
                // equality helpers as the loadAndSyncData needsCloudWrite gate,
                // so the two paths agree on what counts as "changed".
                if (cachedDoc && !shouldWriteEmail) {
                    const Util = (window.AnimeTracker && window.AnimeTracker.MergeUtils) || {};
                    const animeEq  = Util.areAnimeDataMapsEqual    ? Util.areAnimeDataMapsEqual(mergedAnime,  cachedDoc.animeData  || {}) : false;
                    const progEq   = areProgressMapsEqual          ? areProgressMapsEqual(mergedProgress,    cachedDoc.videoProgress || {}) : false;
                    const delEq    = shallowEqualDeletedAnime      ? shallowEqualDeletedAnime(mergedDeleted, cachedDoc.deletedAnime || {}) : false;
                    const groupEq  = shallowEqualObjectMap         ? shallowEqualObjectMap(mergedGroup,      cachedDoc.groupCoverImages || {}) : false;
                    const goalsEq  = shallowEqualObjectMap         ? shallowEqualObjectMap(mergedGoals,      cachedDoc.goalSettings || {}) : false;
                    const badgeEq  = shallowEqualObjectMap         ? shallowEqualObjectMap(mergedBadges,     cachedDoc.badgeUnlocks || {}) : false;
                    if (animeEq && progEq && delEq && groupEq && goalsEq && badgeEq) {
                        PopupLogger.throttled('Firebase',
                            `idempotent-skip:${this.currentUser.uid}`, 5000,
                            `Cloud save skipped — already in sync · ${this.summarizeSyncDataString({ animeData: mergedAnime, videoProgress: mergedProgress, deletedAnime: mergedDeleted, groupCoverImages: mergedGroup, goalSettings: mergedGoals, badgeUnlocks: mergedBadges })}`);
                        this.cloudSaveRetryCount = 0;
                        if (elements?.syncStatus) {
                            elements.syncStatus.classList.add('synced');
                            elements.syncText.textContent = 'Cloud Synced';
                        }
                        return;
                    }
                }

                const savedDoc = {
                    animeData: mergedAnime,
                    videoProgress: mergedProgress,
                    deletedAnime: mergedDeleted,
                    groupCoverImages: mergedGroup,
                    goalSettings: mergedGoals,
                    badgeUnlocks: mergedBadges,
                    lastUpdated: new Date().toISOString(),
                    email: this.currentUser.email
                };

                const fieldList = ['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages', 'goalSettings', 'badgeUnlocks', 'lastUpdated'];
                if (shouldWriteEmail) fieldList.push('email');

                await FirebaseLib.setDocument('users', this.currentUser.uid, savedDoc, {
                    fields: fieldList
                });
                this.setCachedUserDocument(this.currentUser.uid, savedDoc);
                try {
                    // Seed the SW cache with the doc we just wrote so the SW's
                    // follow-up storage-listener sync doesn't burn a Firestore
                    // read fetching what we already have. Falls back to plain
                    // invalidate if the SW doesn't recognise the new message.
                    chrome.runtime.sendMessage({ type: 'UPDATE_BG_CLOUD_DOC_CACHE', uid: this.currentUser.uid, doc: savedDoc }, () => {
                        void chrome.runtime.lastError;
                    });
                } catch { /* best-effort */ }
                PopupLogger.log('Firebase', `Cloud save complete · ${this.summarizeSyncDataString(savedDoc)}`);

                this.cloudSaveRetryCount = 0;

                if (elements?.syncStatus) {
                    elements.syncStatus.classList.add('synced');
                    elements.syncText.textContent = 'Cloud Synced';
                }
            } catch (error) {
                PopupLogger.error('Firebase', 'Save error:', error);

                if (elements?.syncStatus) {
                    elements.syncStatus.classList.remove('synced');
                    elements.syncText.textContent = 'Sync Error';
                }

                this.cloudSaveRetryCount++;
                if (this.cloudSaveRetryCount >= CONFIG.MAX_CLOUD_SAVE_RETRIES) {
                    PopupLogger.error('Firebase', 'Max retries reached, giving up');
                    this.cloudSaveRetryCount = 0;
                    return;
                }

                const retryDelay = Math.min(2000 * Math.pow(2, this.cloudSaveRetryCount - 1), CONFIG.MAX_RETRY_DELAY_MS);
                PopupLogger.log('Firebase', `Will retry in ${retryDelay}ms`);

                if (!this.pendingSave) this.pendingSave = dataToSave;
                setTimeout(() => {
                    if (this.currentUser && this.pendingSave) {
                        this.performCloudSave(elements);
                    }
                }, retryDelay);
            } finally {
                this.isSavingToCloud = false;

                // If new data arrived while we were saving, process it (with delay)
                if (this.pendingSave && this.cloudSaveRetryCount === 0) {
                    setTimeout(() => this.performCloudSave(elements), 1000);
                }
            }
        })();

        try {
            await this.currentSavePromise;
        } finally {
            this.currentSavePromise = null;
        }
    },

    /**
     * Load and sync data with cloud
     */
    async loadAndSyncData(elements) {
        const { Storage } = window.AnimeTracker;
        const { ProgressManager } = window.AnimeTracker;
        const { FillerService } = window.AnimeTracker;
        const { UIHelpers } = window.AnimeTracker;
        
        if (!this.currentUser) return null;

        if (elements?.syncStatus) {
            elements.syncStatus.classList.remove('synced');
            elements.syncStatus.classList.add('syncing');
            elements.syncText.textContent = 'Syncing...';
        }

        try {
            // Task 8: ensure session-cache hydration completed before the
            // very first cache check. onAuthStateChanged kicks off
            // hydrateSessionCache async; awaiting here serializes the first
            // loadAndSyncData call against it without slowing later calls
            // (the promise resolves nearly instantly thereafter).
            try { await this.hydrateSessionCache(this.currentUser.uid); } catch {}

            // Fetch cloud document once — reuse for both the pre-upload VP merge and
            // the authoritative data merge, eliminating the second GET.
            let cloudData = null;
            const { hit: cacheHit, data: cachedCloudData } = this.getCachedUserDocument(this.currentUser.uid);

            if (cacheHit) {
                cloudData = cachedCloudData;
                this.cacheStats.fresh++;
                PopupLogger.debug('Sync', `cache-hit-fresh (${this.cacheStats.fresh}/${this.cacheStats.fresh + this.cacheStats.revalidated + this.cacheStats.fullFetch})`);
            } else {
                // Task 6: lastUpdated short-circuit. When we have a stale
                // cache entry for this uid (TTL expired but doc still in
                // memory), issue a tiny mask GET on `lastUpdated`. If it
                // matches the cached value, the cloud doc hasn't changed —
                // bump cachedAt and reuse the cached library. If it differs
                // OR the field is missing, fall through to the existing
                // SW/direct GET path. Behind CACHE_SHORT_CIRCUIT_ENABLED
                // feature flag (defaults true).
                const stale = this.getStaleCachedUserDocument(this.currentUser.uid);
                let shortCircuited = false;
                if (stale && stale.lastUpdated && await this.isCacheShortCircuitEnabled()) {
                    try {
                        const probe = await this._validateCacheViaLastUpdated(this.currentUser.uid, stale.lastUpdated);
                        if (probe.match === true) {
                            cloudData = stale.data;
                            this.bumpCachedAt(this.currentUser.uid);
                            this.cacheStats.revalidated++;
                            shortCircuited = true;
                            PopupLogger.log('Sync', `cache-hit-revalidated (lastUpdated match · ~140-byte read · ${this.cacheStats.revalidated} so far)`);
                        } else if (probe.match === false) {
                            // Drop stale entry so the full-GET path doesn't
                            // accidentally re-use it later.
                            this.clearCachedUserDocument(this.currentUser.uid);
                            PopupLogger.debug('Sync', 'cache invalidated by lastUpdated mismatch');
                        }
                    } catch (e) {
                        // Auth error from probe → propagate; the existing
                        // 401/403 path below will surface AUTH_REJECTED.
                        if (e?.status === 401 || e?.status === 403) throw e;
                        PopupLogger.debug('Sync', `lastUpdated probe failed: ${e?.message || e}`);
                    }
                }

                if (!shortCircuited) {
                // Ask the background SW first — it keeps a 5-min cloud-doc cache
                // that the SSE stream warms in real time. Serves identical data
                // to a direct GET on cache hit, but costs zero Firestore reads.
                // Falls through to FirebaseLib.getDocument on cache miss or when
                // the SW isn't reachable (e.g. signed-out state, rare race).
                let swReturnedDoc = false;
                try {
                    const swResp = await new Promise((resolve) => {
                        try {
                            chrome.runtime.sendMessage({ type: 'GET_CLOUD_DOC' }, (resp) => {
                                if (chrome.runtime.lastError) { resolve(null); return; }
                                resolve(resp || null);
                            });
                        } catch { resolve(null); }
                    });
                    // Only TRUST the SW response when it actually returned a
                    // non-null doc. If success=true but doc=null, the SW's
                    // fetchCloudData swallowed an error (401/403/404/500) and
                    // returned null silently — we MUST fall through to a direct
                    // popup GET because the popup may have a fresher token, or
                    // the doc may genuinely exist but the SW couldn't see it.
                    // The previous logic trusted any success=true reply and
                    // skipped the fallback, which on mobile (SW with stale
                    // token after login) caused empty libraries even when the
                    // cloud doc was populated.
                    if (swResp?.success && swResp.doc) {
                        cloudData = swResp.doc;
                        this.setCachedUserDocument(this.currentUser.uid, cloudData);
                        swReturnedDoc = true;
                        PopupLogger.debug('Sync', 'Using SW-cached cloud document');
                    } else if (swResp?.success && !swResp.doc) {
                        PopupLogger.log('Sync', 'SW returned null doc — falling through to direct popup GET');
                    } else if (swResp && !swResp.success) {
                        PopupLogger.warn('Sync',
                            `SW cloud fetch failed: ${swResp.error || 'unknown'}` +
                            (swResp.status ? ` (HTTP ${swResp.status})` : '') +
                            ' — falling through to direct popup GET');
                    }
                } catch (e) {
                    PopupLogger.debug('Sync', 'SW cloud-doc fetch skipped:', e?.message || e);
                }

                if (!swReturnedDoc) {
                    let retryCount = 0;
                    const maxRetries = 3;

                    while (retryCount < maxRetries) {
                        try {
                            cloudData = await FirebaseLib.getDocument('users', this.currentUser.uid);
                            this.setCachedUserDocument(this.currentUser.uid, cloudData);
                            this.cacheStats.fullFetch++;
                            PopupLogger.debug('Sync', `cache-miss-fetch (${this.cacheStats.fullFetch} full fetches so far)`);
                            break;
                        } catch (e) {
                            // Auth errors (401/403) — token rejected by
                            // Firestore. Don't retry, surface immediately so
                            // the caller can prompt re-auth. Network errors
                            // and 5xx are retryable; 401/403 mean the session
                            // is permanently invalid for this resource.
                            if (e?.status === 401 || e?.status === 403) {
                                const authErr = new Error(
                                    e.status === 401
                                        ? 'Session expired. Please sign in again.'
                                        : 'Permission denied. Check Firestore rules or sign in again.'
                                );
                                authErr.code = 'AUTH_REJECTED';
                                authErr.status = e.status;
                                throw authErr;
                            }
                            retryCount++;
                            if (retryCount < maxRetries) {
                                PopupLogger.warn('Sync', `Cloud fetch failed, retrying (${retryCount}/${maxRetries})...`);
                                await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                            } else {
                                throw e;
                            }
                        }
                    }
                }
                }       // end if (!shortCircuited) — Task 6
            }

            const readLocalSyncData = () => Storage.get([
                'animeData',
                'videoProgress',
                'userId',
                'deletedAnime',
                'groupCoverImages',
                'goalSettings',
                'badgeUnlocks'
            ]);

            // Read local once and reuse for both the pre-upload VP merge and
            // the authoritative merge below — saves a redundant chrome.storage read.
            const localData = await readLocalSyncData();

            // Note: videoProgress merge happens once in the main merge block
            // below (line ~389). No pre-merge needed — the main merge already
            // handles the local/cloud combination correctly.
            let finalData;
            let syncSource = 'empty-init';

            if (cloudData) {
                // shouldMerge=true when local was already tagged with this user,
                // OR when local has no userId at all (anonymous local — first
                // sign-in or 2nd device). Without the second clause, the cloud-
                // only path silently overwrites a fresh anonymous library on
                // first login. We refuse to merge only when local was tagged
                // for a *different* account (security: don't leak data between
                // users on a shared browser).
                const shouldMerge =
                    !localData.userId || localData.userId === this.currentUser.uid;

                let mergedDeletedAnime = AnimeTracker.MergeUtils.mergeDeletedAnime(
                    localData.deletedAnime || {},
                    cloudData.deletedAnime || {}
                );

                if (shouldMerge && localData.animeData && Object.keys(localData.animeData).length > 0) {
                    syncSource = 'merged-cloud-local';
                    finalData = {
                        animeData:     AnimeTracker.MergeUtils.mergeAnimeData(localData.animeData || {}, cloudData.animeData || {}),
                        videoProgress: AnimeTracker.MergeUtils.mergeVideoProgress(localData.videoProgress || {}, cloudData.videoProgress || {})
                    };
                    PopupLogger.log('Sync', `Merged episodes: ${UIHelpers.countEpisodes(finalData.animeData)}`);
                } else {
                    syncSource = 'cloud-only';
                    finalData = {
                        animeData: cloudData.animeData || {},
                        videoProgress: cloudData.videoProgress || {}
                    };
                    finalData.animeData = ProgressManager.removeDuplicateEpisodes(finalData.animeData);
                }

                const localGroupCovers = localData.groupCoverImages || {};
                const cloudGroupCovers = cloudData.groupCoverImages || {};
                const mergedGroupCovers = AnimeTracker.MergeUtils.mergeGroupCoverImages(localGroupCovers, cloudGroupCovers);

                const mergedGoalSettings = AnimeTracker.MergeUtils.mergeGoalSettings(
                    localData.goalSettings || {},
                    cloudData.goalSettings || {}
                );
                const mergedBadgeUnlocks = AnimeTracker.MergeUtils.mergeBadgeUnlocks(
                    localData.badgeUnlocks || {},
                    cloudData.badgeUnlocks || {}
                );

                const normalized = ProgressManager.normalizeCanonicalSlugs(
                    finalData.animeData || {},
                    finalData.videoProgress || {},
                    mergedDeletedAnime || {}
                );
                const withoutAutoRepaired = ProgressManager.removeAutoRepairedEpisodes(normalized.animeData || {});
                finalData.animeData = ProgressManager.removeDuplicateEpisodes(withoutAutoRepaired.cleanedData);
                finalData.videoProgress = normalized.videoProgress || {};
                mergedDeletedAnime = normalized.deletedAnime || {};

                mergedDeletedAnime = AnimeTracker.MergeUtils.pruneStaleDeletedAnime(finalData.animeData, mergedDeletedAnime);
                AnimeTracker.MergeUtils.applyDeletedAnime(finalData.animeData, mergedDeletedAnime);

                const DELETED_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
                const pruneCutoff = Date.now() - DELETED_MAX_AGE;
                for (const slug of Object.keys(mergedDeletedAnime)) {
                    const info = mergedDeletedAnime[slug];
                    const delAt = +(new Date(info?.deletedAt || info || 0));
                    if (delAt > 0 && delAt < pruneCutoff) {
                        delete mergedDeletedAnime[slug];
                    }
                }

                finalData.deletedAnime = mergedDeletedAnime;

                const { cleaned: cleanedProgress } =
                    ProgressManager.cleanTrackedProgress(finalData.animeData, finalData.videoProgress, mergedDeletedAnime);
                finalData.videoProgress = cleanedProgress;

                finalData.groupCoverImages = mergedGroupCovers;
                finalData.goalSettings = mergedGoalSettings;
                finalData.badgeUnlocks = mergedBadgeUnlocks;

                // Only write to local storage when the merged result actually
                // differs from what's already on disk. An unconditional Storage.set
                // fires chrome.storage.onChanged, which wakes the SW and triggers
                // a redundant cloud sync — turning every popup open into 2 reads
                // + 1 write even when nothing changed.
                const needsLocalWrite =
                    !AnimeTracker.MergeUtils.areAnimeDataMapsEqual(finalData.animeData || {}, localData.animeData || {}) ||
                    !areProgressMapsEqual(finalData.videoProgress || {}, localData.videoProgress || {}) ||
                    !shallowEqualDeletedAnime(finalData.deletedAnime || {}, localData.deletedAnime || {}) ||
                    !shallowEqualObjectMap(finalData.groupCoverImages || {}, localData.groupCoverImages || {}) ||
                    !shallowEqualObjectMap(finalData.goalSettings || {}, localData.goalSettings || {}) ||
                    !shallowEqualObjectMap(finalData.badgeUnlocks || {}, localData.badgeUnlocks || {}) ||
                    localData.userId !== this.currentUser.uid;

                if (needsLocalWrite) {
                    await Storage.set({
                        animeData: finalData.animeData,
                        videoProgress: finalData.videoProgress,
                        deletedAnime: mergedDeletedAnime,
                        groupCoverImages: mergedGroupCovers,
                        goalSettings: mergedGoalSettings,
                        badgeUnlocks: mergedBadgeUnlocks,
                        userId: this.currentUser.uid
                    });
                }

                if (shouldMerge) {
                    // Only push back to cloud if the merged result actually differs
                    // from what we just fetched — avoids a redundant full write.
                    const needsCloudWrite =
                        !AnimeTracker.MergeUtils.areAnimeDataMapsEqual(finalData.animeData || {}, cloudData.animeData || {}) ||
                        !areProgressMapsEqual(finalData.videoProgress || {}, cloudData.videoProgress || {}) ||
                        !shallowEqualDeletedAnime(finalData.deletedAnime || {}, cloudData.deletedAnime || {}) ||
                        !shallowEqualObjectMap(finalData.groupCoverImages || {}, cloudData.groupCoverImages || {}) ||
                        !shallowEqualObjectMap(finalData.goalSettings || {}, cloudData.goalSettings || {}) ||
                        !shallowEqualObjectMap(finalData.badgeUnlocks || {}, cloudData.badgeUnlocks || {});

                    if (needsCloudWrite) {
                        if (this.saveToCloudTimeout) {
                            clearTimeout(this.saveToCloudTimeout);
                            this.saveToCloudTimeout = null;
                        }
                        this.pendingSave = this.cloneSyncData(finalData);
                        await this.performCloudSave(elements);
                    } else {
                        this.setCachedUserDocument(this.currentUser.uid, {
                            animeData: finalData.animeData || {},
                            videoProgress: finalData.videoProgress || {},
                            deletedAnime: finalData.deletedAnime || {},
                            groupCoverImages: finalData.groupCoverImages || {},
                            goalSettings: finalData.goalSettings || {},
                            badgeUnlocks: finalData.badgeUnlocks || {},
                            lastUpdated: cloudData?.lastUpdated || null,
                            email: this.currentUser?.email || cloudData?.email || null
                        });
                        if (elements?.syncStatus) {
                            elements.syncStatus.classList.add('synced');
                            elements.syncText.textContent = 'Cloud Synced';
                        }
                    }
                }
            } else {
                // Same userId rule as the merge path above: bootstrap if local
                // is tagged for this user OR untagged (anonymous data on a
                // device that just signed in). Refuse only when tagged for a
                // different account.
                const localBelongsToUser =
                    !localData.userId || localData.userId === this.currentUser.uid;
                if (localBelongsToUser && localData.animeData && Object.keys(localData.animeData).length > 0) {
                    syncSource = 'local-bootstrap';
                    const normalized = ProgressManager.normalizeCanonicalSlugs(
                        localData.animeData || {},
                        localData.videoProgress || {},
                        localData.deletedAnime || {}
                    );
                    const withoutAutoRepaired = ProgressManager.removeAutoRepairedEpisodes(normalized.animeData || {});

                    finalData = {
                        animeData: ProgressManager.removeDuplicateEpisodes(withoutAutoRepaired.cleanedData),
                        videoProgress: normalized.videoProgress || {},
                        deletedAnime: normalized.deletedAnime || {},
                        groupCoverImages: localData.groupCoverImages || {},
                        goalSettings: localData.goalSettings || {},
                        badgeUnlocks: localData.badgeUnlocks || {}
                    };

                    await Storage.set({
                        animeData: finalData.animeData,
                        videoProgress: finalData.videoProgress,
                        deletedAnime: finalData.deletedAnime,
                        groupCoverImages: finalData.groupCoverImages,
                        goalSettings: finalData.goalSettings,
                        badgeUnlocks: finalData.badgeUnlocks,
                        userId: this.currentUser.uid
                    });

                    if (this.saveToCloudTimeout) {
                        clearTimeout(this.saveToCloudTimeout);
                        this.saveToCloudTimeout = null;
                    }
                    this.pendingSave = this.cloneSyncData(finalData);
                    await this.performCloudSave(elements);
                } else {
                    syncSource = 'empty-init';
                    finalData = { animeData: {}, videoProgress: {}, deletedAnime: {}, groupCoverImages: {}, goalSettings: {}, badgeUnlocks: {} };
                    await Storage.set({
                        animeData: {},
                        videoProgress: {},
                        deletedAnime: {},
                        groupCoverImages: {},
                        goalSettings: {},
                        badgeUnlocks: {},
                        userId: this.currentUser.uid
                    });
                }
            }

            await FillerService.loadCachedEpisodeTypes(finalData.animeData);

            // ── Playback settings reconciliation ─────────────────────────
            // Cloud wins when its `updatedAt` is strictly newer than the
            // local stamp. Otherwise local is newer (or cloud has none yet)
            // and we push our local view up so cross-device sync converges.
            // Single-field PATCH, debounced — cheap.
            try {
                const cloudPlayback = cloudData?.playbackSettings || null;
                const applied = await this.applyCloudPlaybackSettings(cloudPlayback);
                if (!applied) {
                    const { settings: localPlayback, updatedAt: localPlaybackStamp } =
                        await this.readPlaybackSettingsFromStorage();
                    const cloudNewerOrEqual = cloudPlayback?.updatedAt
                        && localPlaybackStamp
                        && Date.parse(cloudPlayback.updatedAt) >= Date.parse(localPlaybackStamp);
                    const cloudMatches = cloudPlayback
                        && playbackSettingsEqual(cloudPlayback, localPlayback);
                    if (!cloudNewerOrEqual || !cloudMatches) {
                        // Ensure local has a stamp before pushing — first-ever push
                        // for a user who never toggled anything still seeds the cloud
                        // doc so future devices have a baseline.
                        if (!localPlaybackStamp) {
                            const seedStamp = new Date().toISOString();
                            await Storage.set({ [PLAYBACK_SETTINGS_UPDATED_AT_KEY]: seedStamp });
                        }
                        await this.queuePlaybackSettingsSave({ immediate: false });
                    }
                }
            } catch (e) {
                PopupLogger.warn('Sync', 'Playback settings reconcile skipped:', e?.message || e);
            }

            // ── AniList auth reconciliation ──────────────────────────────
            // If the cloud has a desktop-pushed token and ours is older /
            // missing, adopt it. If our local has a newer token (or cloud
            // has nothing yet — e.g. legacy desktop where the token was set
            // before v6.6.3 added cross-device sync), push it up. Mobile
            // devices where chrome.identity.launchWebAuthFlow doesn't work
            // get the token for free this way.
            try {
                const cloudAnilist = cloudData?.anilistAuth || null;
                const applied = await this.applyCloudAnilistAuth(cloudAnilist);
                if (!applied) {
                    const stored = await window.AnimeTracker.Storage.get(['anilist_auth', 'anilist_username']);
                    const localAuth = stored.anilist_auth || null;
                    const localStamp = localAuth?.updatedAt || null;
                    const cloudStamp = cloudAnilist?.updatedAt || null;
                    const hasLocalToken = !!(localAuth && localAuth.accessToken
                        && (!localAuth.expiresAt || localAuth.expiresAt > Date.now()));
                    const cloudHasToken = !!(cloudAnilist && cloudAnilist.accessToken);

                    // Push local up when:
                    //   (a) local has a valid token AND cloud has none — covers
                    //       the legacy case where the desktop's anilist_auth
                    //       was set before this sync feature shipped (no
                    //       updatedAt stamp at all), OR
                    //   (b) both have a stamp and local's is strictly newer.
                    // Don't push when cloud has a token and local has no
                    // stamp — cloud was set explicitly by a newer client and
                    // wins by default.
                    const shouldPush = hasLocalToken && (
                        !cloudHasToken
                        || (localStamp && cloudStamp && Date.parse(localStamp) > Date.parse(cloudStamp))
                    );

                    if (shouldPush) {
                        PopupLogger.log('Sync',
                            `AniList auth: pushing local→cloud (reason=${cloudHasToken ? 'local-newer' : 'cloud-empty'}, viewer=${localAuth?.viewer?.name || 'unknown'})`);
                        await this.pushAnilistAuthToCloud(localAuth, stored.anilist_username || null);
                    } else if (hasLocalToken && cloudHasToken && !localStamp) {
                        // Diagnostic: helps the user see in devtools why we're
                        // not pushing (e.g. "I clicked Connect on desktop but
                        // it never synced!" — answer: cloud already has it).
                        PopupLogger.debug('Sync',
                            'AniList auth: cloud already has a token, keeping cloud (local has no stamp).');
                    }
                }
            } catch (e) {
                PopupLogger.warn('Sync', 'AniList auth reconcile skipped:', e?.message || e);
            }

            if (elements?.syncStatus) {
                elements.syncStatus.classList.remove('syncing');
                elements.syncStatus.classList.add('synced');
                elements.syncText.textContent = 'Cloud Synced';
            }

            PopupLogger.log('Sync', `Cloud sync complete (${syncSource}) · ${this.summarizeSyncDataString(finalData)}`);

            // Expose last-sync diagnostics so the popup can show the user a
            // clear explanation of what happened (cloud doc found / not found,
            // counts, source). Critical for mobile users who see "Cloud Synced"
            // but an empty library — they need to know if it's because the
            // cloud doc was missing (wrong account) or genuinely empty.
            this.lastSyncResult = {
                source: syncSource,
                cloudDocFound: !!cloudData,
                animeCount: Object.keys(finalData.animeData || {}).length,
                progressCount: Object.keys(finalData.videoProgress || {}).length,
                uid: this.currentUser.uid,
                email: this.currentUser.email,
                completedAt: Date.now(),
                error: null
            };

            return finalData;
        } catch (error) {
            PopupLogger.error('Firebase', 'Sync error:', error);
            if (elements?.syncStatus) {
                elements.syncStatus.classList.remove('syncing');
                elements.syncText.textContent = 'Sync Error';
            }
            this.lastSyncResult = {
                source: 'error',
                cloudDocFound: false,
                animeCount: 0,
                progressCount: 0,
                uid: this.currentUser?.uid || null,
                email: this.currentUser?.email || null,
                completedAt: Date.now(),
                error: {
                    message: error?.message || String(error),
                    code: error?.code || null,
                    status: error?.status || null
                }
            };
            throw error;
        }
    },

    /**
     * Cleanup on popup close — fire-and-forget with keepalive fetch
     * so the request survives popup unload.
     *
     * The fast path uses the warm idToken cache (refreshed every 45 min via
     * _startWarmTokenTimer + on every onAuthStateChanged) so we can build the
     * PATCH body and call fetch() synchronously inside the unload handler.
     * Without that, FirebaseLib.setDocument awaits getIdToken() → a storage
     * round-trip that Chrome regularly cuts short on popup close, leaving
     * the user's last save unsaved.
     */
    cleanup() {
        if (this.saveToCloudTimeout) {
            clearTimeout(this.saveToCloudTimeout);
            this.saveToCloudTimeout = null;
        }

        // Flush a queued playback-settings PATCH with keepalive so a toggle
        // flip seconds before popup close still lands on the server.
        if (this.playbackSaveTimeout) {
            clearTimeout(this.playbackSaveTimeout);
            this.playbackSaveTimeout = null;
        }

        const projectId = (window.firebaseConfig && window.firebaseConfig.projectId) || '';
        const codec = (window.AnimeTrackerFirestoreCodec) || null;
        const haveWarmToken = this._warmIdToken
            && this._warmIdTokenExpiresAt > Date.now() + 5000
            && projectId
            && codec;

        // Helper: build URL + fire keepalive PATCH synchronously.
        const fireKeepalive = (uid, data, fields) => {
            try {
                const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`;
                const mask = fields.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
                const body = JSON.stringify({ fields: codec.encodeFields(data) });
                if (body.length >= 63000) return false;
                fetch(`${url}?${mask}`, {
                    method: 'PATCH',
                    headers: {
                        Authorization: `Bearer ${this._warmIdToken}`,
                        'Content-Type': 'application/json'
                    },
                    body,
                    keepalive: true
                }).catch(() => { /* unload — can't surface anyway */ });
                return true;
            } catch (e) {
                PopupLogger.error('Sync', 'Keepalive PATCH compose failed:', e);
                return false;
            }
        };

        if (this.pendingPlaybackSave && this.currentUser) {
            const playbackToSave = this.pendingPlaybackSave;
            this.pendingPlaybackSave = null;

            let sent = false;
            if (haveWarmToken) {
                sent = fireKeepalive(
                    this.currentUser.uid,
                    { playbackSettings: playbackToSave },
                    ['playbackSettings']
                );
            }
            if (!sent) {
                // Fallback (slower; may not survive on some browsers).
                FirebaseLib.setDocument('users', this.currentUser.uid, {
                    playbackSettings: playbackToSave
                }, {
                    keepalive: true,
                    fields: ['playbackSettings']
                }).catch((err) => {
                    PopupLogger.error('Sync', 'Playback save on unload failed:', err);
                });
            }
        }

        if (this.pendingSave && this.currentUser) {
            const dataToSave = this.pendingSave;
            this.pendingSave = null;

            // Note: we intentionally skip the cloud-first per-key merge here
            // (the path used by performCloudSave) — at unload, awaiting a
            // GET_CLOUD_DOC round-trip would defeat the whole point. A best-
            // effort local-only PATCH is the right tradeoff: it's the path
            // already taken by the previous keepalive save, plus a real
            // synchronous fire that Chrome won't cut short.
            const payload = {
                animeData:        dataToSave.animeData || {},
                videoProgress:    dataToSave.videoProgress || {},
                deletedAnime:     dataToSave.deletedAnime || {},
                groupCoverImages: dataToSave.groupCoverImages || {},
                goalSettings:     dataToSave.goalSettings || {},
                badgeUnlocks:     dataToSave.badgeUnlocks || {},
                lastUpdated:      new Date().toISOString(),
                email:            this.currentUser.email
            };
            const fields = ['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages', 'goalSettings', 'badgeUnlocks', 'lastUpdated', 'email'];

            let sent = false;
            if (haveWarmToken) {
                sent = fireKeepalive(this.currentUser.uid, payload, fields);
            }
            if (!sent) {
                FirebaseLib.setDocument('users', this.currentUser.uid, payload, {
                    keepalive: true,
                    fields
                }).catch(err => {
                    PopupLogger.error('Sync', 'Save on unload failed:', err);
                });
            }
        }
    }
};

// Export
window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.FirebaseSync = FirebaseSync;
