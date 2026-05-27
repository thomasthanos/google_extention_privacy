




const {
    areProgressMapsEqual,
    shallowEqualDeletedAnime,
    shallowEqualObjectMap
} = window.AnimeTracker.MergeUtils;







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

    currentUser: null,
    saveToCloudTimeout: null,
    isSavingToCloud: false,
    pendingSave: null,
    currentSavePromise: null,
    cloudSaveRetryCount: 0,
    userDocumentCache: null,




    USER_DOCUMENT_CACHE_TTL_MS: 10 * 60 * 1000,


    cacheStats: { fresh: 0, revalidated: 0, fullFetch: 0 },






    SESSION_CACHE_KEY: '_userDocumentCacheV1',
    _sessionHydratePromise: null,



    lastSyncResult: null,



    playbackSaveTimeout: null,
    pendingPlaybackSave: null,
    isSavingPlayback: false,








    _warmIdToken: null,
    _warmIdTokenExpiresAt: 0,
    _warmTokenRefreshTimer: null,
    WARM_TOKEN_REFRESH_INTERVAL_MS: 45 * 60 * 1000,
    WARM_TOKEN_MIN_LIFETIME_MS: 5 * 60 * 1000,

    cloneAny(data) {
        if (data === null || typeof data === 'undefined') return null;
        try {
            if (typeof structuredClone === 'function') {
                return structuredClone(data);
            }
        } catch {

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




            return { hit: false, data: null, stale: true };
        }

        return {
            hit: true,
            data: this.cloneAny(cache.data)
        };
    },







    getStaleCachedUserDocument(uid) {
        const cache = this.userDocumentCache;
        if (!uid || !cache || cache.uid !== uid) return null;
        return {
            data: this.cloneAny(cache.data),
            cachedAt: cache.cachedAt,
            lastUpdated: cache.data?.lastUpdated || null
        };
    },





    bumpCachedAt(uid) {
        if (!this.userDocumentCache || this.userDocumentCache.uid !== uid) return;
        this.userDocumentCache.cachedAt = Date.now();
        this._persistSessionCache().catch(() => {});
    },






    async isCacheShortCircuitEnabled() {
        try {
            const stored = await new Promise((res) =>
                chrome.storage.local.get(['_featureFlags'], (r) => { void chrome.runtime.lastError; res(r || {}); }));
            const flags = stored._featureFlags;
            if (!flags || typeof flags !== 'object') return true;
            return flags.CACHE_SHORT_CIRCUIT_ENABLED !== false;
        } catch { return true; }
    },












    async _validateCacheViaLastUpdated(uid, cachedLastUpdated) {
        if (!uid || !cachedLastUpdated) return { match: null, reason: 'no-baseline' };
        try {
            const probe = await FirebaseLib.getDocument('users', uid, { mask: ['lastUpdated'] });

            if (!probe) return { match: false, cloudLastUpdated: null };
            const cloudLastUpdated = probe.lastUpdated || null;


            if (!cloudLastUpdated) return { match: null, reason: 'cloud-missing-lastUpdated' };
            return { match: cloudLastUpdated === cachedLastUpdated, cloudLastUpdated };
        } catch (e) {


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


        this._persistSessionCache().catch(() => {});
    },







    async hydrateSessionCache(uid) {
        if (!uid) return;
        if (this.userDocumentCache?.uid === uid) return;
        if (this._sessionHydratePromise) return this._sessionHydratePromise;
        const sessionApi = chrome?.storage?.session;
        if (!sessionApi) return;
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

                    this._dropSessionCache();
                }
            } catch {                   }
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
        } catch {              }
    },








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

                try { await FirebaseLib.getIdToken(); } catch {              }
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
        } catch {                   }
    },




    _startWarmTokenTimer() {
        if (this._warmTokenRefreshTimer) return;
        this._warmTokenRefreshTimer = setInterval(
            () => { this._refreshWarmToken(); },
            this.WARM_TOKEN_REFRESH_INTERVAL_MS
        );
    },





    async readPlaybackSettingsFromStorage() {
        const keys = Object.values(PLAYBACK_SETTINGS_MAP).map((c) => c.storage);
        keys.push(PLAYBACK_SETTINGS_UPDATED_AT_KEY);
        const stored = await window.AnimeTracker.Storage.get(keys);
        return {
            settings: readPlaybackSettings(stored),
            updatedAt: stored[PLAYBACK_SETTINGS_UPDATED_AT_KEY] || null
        };
    },










    async queuePlaybackSettingsSave({ immediate = false } = {}) {
        const { settings } = await this.readPlaybackSettingsFromStorage();
        const updatedAt = new Date().toISOString();




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

                return;
            }

            await FirebaseLib.setDocument('users', this.currentUser.uid, {
                playbackSettings: payload
            }, { fields: ['playbackSettings'] });



            if (cached) {
                const updated = { ...cached, playbackSettings: payload };
                this.setCachedUserDocument(this.currentUser.uid, updated);
            }
            try {
                chrome.runtime.sendMessage(
                    { type: 'UPDATE_BG_PLAYBACK_SETTINGS', playbackSettings: payload },
                    () => { void chrome.runtime.lastError; }
                );
            } catch {                   }

            PopupLogger.log('Firebase', `Playback settings synced · cg=${payload.copyGuard?'1':'0'} sn=${payload.smartNotif?'1':'0'} af=${payload.autoSkipFiller?'1':'0'} sh=${payload.skiptimeHelper?'1':'0'}`);
        } catch (error) {


            if (!this.pendingPlaybackSave) this.pendingPlaybackSave = payload;
            throw error;
        } finally {
            this.isSavingPlayback = false;
        }
    },





    async applyCloudPlaybackSettings(cloudPlayback) {
        if (!cloudPlayback || typeof cloudPlayback !== 'object') return false;
        const cloudUpdatedAt = cloudPlayback.updatedAt || null;
        if (!cloudUpdatedAt) return false;

        const keys = Object.values(PLAYBACK_SETTINGS_MAP).map((c) => c.storage);
        keys.push(PLAYBACK_SETTINGS_UPDATED_AT_KEY);
        const stored = await window.AnimeTracker.Storage.get(keys);
        const localUpdatedAt = stored[PLAYBACK_SETTINGS_UPDATED_AT_KEY] || null;



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

            await window.AnimeTracker.Storage.set(writes);
            return false;
        }

        await window.AnimeTracker.Storage.set(writes);
        return true;
    },



















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



            const isIdentical = localAuth
                && localAuth.accessToken === newAuth.accessToken
                && localAuth.expiresAt === newAuth.expiresAt
                && JSON.stringify(localAuth.viewer || null) === JSON.stringify(newAuth.viewer || null);
            if (!isIdentical) {
                setKeys.anilist_auth = newAuth;
                touched = true;
            } else if (localUpdatedAt !== cloudUpdatedAt) {

                setKeys.anilist_auth = newAuth;
                touched = true;
            }
        } else if (localAuth) {

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















    async pushAnilistAuthToCloud(auth, username = null) {
        if (!this.currentUser) return;
        const updatedAt = new Date().toISOString();







        const payload = {
            accessToken: (auth && typeof auth.accessToken === 'string') ? auth.accessToken : null,
            expiresAt: (auth && Number.isFinite(auth.expiresAt)) ? auth.expiresAt : 0,
            viewer: (auth && auth.viewer && typeof auth.viewer === 'object') ? auth.viewer : null,
            username: typeof username === 'string' && username ? username : null,
            updatedAt
        };

        try {




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



                return false;
            }

            await FirebaseLib.setDocument('users', this.currentUser.uid, {
                anilistAuth: payload
            }, { fields: ['anilistAuth'] });



            if (cached) {
                this.setCachedUserDocument(this.currentUser.uid, { ...cached, anilistAuth: payload });
            }
            try {
                chrome.runtime.sendMessage(
                    { type: 'UPDATE_BG_ANILIST_AUTH', anilistAuth: payload },
                    () => { void chrome.runtime.lastError; }
                );
            } catch {                   }
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





    summarizeSyncDataString(data) {
        const s = this.summarizeSyncData(data);
        return `${s.animeCount}a/${s.episodeCount}e/${s.progressCount}p/${s.deletedCount}d/${s.coverCount}c/${s.goalCount}g/${s.badgeCount}b`;
    },




    getUser() {
        return this.currentUser;
    },




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



                    this.hydrateSessionCache(user.uid).catch(() => {});



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




    async signInWithGoogle() {
        return await FirebaseLib.signInWithGoogle();
    },




    async signInWithEmailPassword(email, password) {
        return await FirebaseLib.signInWithEmailPassword(email, password);
    },




    async signUpWithEmailPassword(email, password) {
        return await FirebaseLib.signUpWithEmailPassword(email, password);
    },






    async setPasswordForCurrentUser(password) {
        return await FirebaseLib.setPasswordForCurrentUser(password);
    },




    async sendPasswordReset(email) {
        return await FirebaseLib.sendPasswordReset(email);
    },







    async verifyPasswordSilently(email, password) {
        return await FirebaseLib.verifyPasswordSilently(email, password);
    },




    async signOut() {
        await FirebaseLib.signOut();
        this.currentUser = null;
        this.clearCachedUserDocument();
    },




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




    async performCloudSave(elements = null) {
        const { CONFIG } = window.AnimeTracker;

        if (this.currentSavePromise) {
            await this.currentSavePromise;
        }

        if (this.isSavingToCloud) {


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
                } catch {                                              }

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




                    chrome.runtime.sendMessage({ type: 'UPDATE_BG_CLOUD_DOC_CACHE', uid: this.currentUser.uid, doc: savedDoc }, () => {
                        void chrome.runtime.lastError;
                    });
                } catch {                   }
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





            try { await this.hydrateSessionCache(this.currentUser.uid); } catch {}



            let cloudData = null;
            const { hit: cacheHit, data: cachedCloudData } = this.getCachedUserDocument(this.currentUser.uid);

            if (cacheHit) {
                cloudData = cachedCloudData;
                this.cacheStats.fresh++;
                PopupLogger.debug('Sync', `cache-hit-fresh (${this.cacheStats.fresh}/${this.cacheStats.fresh + this.cacheStats.revalidated + this.cacheStats.fullFetch})`);
            } else {








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


                            this.clearCachedUserDocument(this.currentUser.uid);
                            PopupLogger.debug('Sync', 'cache invalidated by lastUpdated mismatch');
                        }
                    } catch (e) {


                        if (e?.status === 401 || e?.status === 403) throw e;
                        PopupLogger.debug('Sync', `lastUpdated probe failed: ${e?.message || e}`);
                    }
                }

                if (!shortCircuited) {





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
                }
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



            const localData = await readLocalSyncData();




            let finalData;
            let syncSource = 'empty-init';

            if (cloudData) {







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










                    const shouldPush = hasLocalToken && (
                        !cloudHasToken
                        || (localStamp && cloudStamp && Date.parse(localStamp) > Date.parse(cloudStamp))
                    );

                    if (shouldPush) {
                        PopupLogger.log('Sync',
                            `AniList auth: pushing local→cloud (reason=${cloudHasToken ? 'local-newer' : 'cloud-empty'}, viewer=${localAuth?.viewer?.name || 'unknown'})`);
                        await this.pushAnilistAuthToCloud(localAuth, stored.anilist_username || null);
                    } else if (hasLocalToken && cloudHasToken && !localStamp) {



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












    cleanup() {
        if (this.saveToCloudTimeout) {
            clearTimeout(this.saveToCloudTimeout);
            this.saveToCloudTimeout = null;
        }



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
                }).catch(() => {                                     });
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


window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.FirebaseSync = FirebaseSync;
