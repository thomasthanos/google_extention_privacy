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
    USER_DOCUMENT_CACHE_TTL_MS: 5 * 60 * 1000,

    // Playback-settings save state (separate from main library save so a
    // toggle flip doesn't piggyback a full animeData write).
    playbackSaveTimeout: null,
    pendingPlaybackSave: null,
    isSavingPlayback: false,

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
            return;
        }
        if (this.userDocumentCache?.uid === uid) {
            this.userDocumentCache = null;
        }
    },

    getCachedUserDocument(uid) {
        const cache = this.userDocumentCache;
        if (!uid || !cache || cache.uid !== uid) {
            return { hit: false, data: null };
        }

        if ((Date.now() - cache.cachedAt) > this.USER_DOCUMENT_CACHE_TTL_MS) {
            this.userDocumentCache = null;
            return { hit: false, data: null };
        }

        return {
            hit: true,
            data: this.cloneAny(cache.data)
        };
    },

    setCachedUserDocument(uid, data) {
        if (!uid) return;
        this.userDocumentCache = {
            uid,
            cachedAt: Date.now(),
            data: this.cloneAny(data)
        };
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
        const { settings, updatedAt: localStamp } = await this.readPlaybackSettingsFromStorage();

        if (!this.currentUser) {
            // Signed out: stamp once so a later sign-in can resolve offline edits.
            if (!localStamp) {
                try {
                    await window.AnimeTracker.Storage.set({
                        [PLAYBACK_SETTINGS_UPDATED_AT_KEY]: new Date().toISOString()
                    });
                } catch (e) {
                    PopupLogger.warn('Firebase', `Failed to stamp local playbackSettingsUpdatedAt: ${e?.message}`);
                }
            }
            return;
        }

        const { data: cached } = this.getCachedUserDocument(this.currentUser.uid);
        const cachedPlayback = cached?.playbackSettings || null;
        const needsPush = !cachedPlayback || !playbackSettingsEqual(cachedPlayback, settings);

        if (!needsPush) {
            if (!localStamp && cachedPlayback?.updatedAt) {
                try {
                    await window.AnimeTracker.Storage.set({
                        [PLAYBACK_SETTINGS_UPDATED_AT_KEY]: cachedPlayback.updatedAt
                    });
                } catch (e) {
                    PopupLogger.warn('Firebase', `Failed to align local playback stamp: ${e?.message}`);
                }
            }
            return;
        }

        const updatedAt = new Date().toISOString();
        try {
            await window.AnimeTracker.Storage.set({ [PLAYBACK_SETTINGS_UPDATED_AT_KEY]: updatedAt });
        } catch (e) {
            PopupLogger.warn('Firebase', `Failed to stamp local playbackSettingsUpdatedAt: ${e?.message}`);
        }

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

    userHasMobilePassword(user) {
        return FirebaseLib.userHasMobilePassword(user || this.currentUser);
    },

    async refreshAuthProvidersFromServer() {
        const user = await FirebaseLib.refreshAuthProvidersFromServer();
        this.currentUser = user;
        return user;
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
                }
                if (user) {
                    PopupLogger.log('Firebase', `User signed in: ${user.email}`);
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
    async signInWithGoogle(options = {}) {
        return await FirebaseLib.signInWithGoogle(options);
    },

    /**
     * Sign in with an existing email/password account
     */
    async signInWithEmailPassword(email, password) {
        return await FirebaseLib.signInWithEmailPassword(email, password);
    },

    /**
     * Create a new email/password account
     */
    async signUpWithEmailPassword(email, password) {
        return await FirebaseLib.signUpWithEmailPassword(email, password);
    },

    /**
     * Add a password to the current account (for mobile sign-in)
     */
    async setPasswordForCurrentUser(password) {
        return await FirebaseLib.setPasswordForCurrentUser(password);
    },

    /**
     * Send a password-reset email
     */
    async sendPasswordReset(email) {
        return await FirebaseLib.sendPasswordReset(email);
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

                const { data: cachedDoc } = this.getCachedUserDocument(this.currentUser.uid);
                const shouldWriteEmail = !cachedDoc
                    || cachedDoc.email !== this.currentUser.email;

                const savedDoc = {
                    animeData: dataToSave.animeData || {},
                    videoProgress: dataToSave.videoProgress || {},
                    deletedAnime: dataToSave.deletedAnime || {},
                    groupCoverImages: dataToSave.groupCoverImages || {},
                    goalSettings: dataToSave.goalSettings || {},
                    badgeUnlocks: dataToSave.badgeUnlocks || {},
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
                    chrome.runtime.sendMessage({ type: 'UPDATE_BG_CLOUD_DOC_CACHE', doc: savedDoc }, () => {
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
            // Fetch cloud document once — reuse for both the pre-upload VP merge and
            // the authoritative data merge, eliminating the second GET.
            let cloudData = null;
            const { hit: cacheHit, data: cachedCloudData } = this.getCachedUserDocument(this.currentUser.uid);

            if (cacheHit) {
                cloudData = cachedCloudData;
                PopupLogger.debug('Sync', 'Using cached cloud user document');
            } else {
                // Ask the background SW first — it keeps a 5-min cloud-doc cache
                // that the SSE stream warms in real time. Serves identical data
                // to a direct GET on cache hit, but costs zero Firestore reads.
                // Falls through to FirebaseLib.getDocument on cache miss or when
                // the SW isn't reachable (e.g. signed-out state, rare race).
                let swAuthoritative = false;
                try {
                    const swResp = await new Promise((resolve) => {
                        try {
                            chrome.runtime.sendMessage({ type: 'GET_CLOUD_DOC' }, (resp) => {
                                if (chrome.runtime.lastError) { resolve(null); return; }
                                resolve(resp || null);
                            });
                        } catch { resolve(null); }
                    });
                    if (swResp?.success) {
                        cloudData = swResp.doc || null;
                        this.setCachedUserDocument(this.currentUser.uid, cloudData);
                        swAuthoritative = true;
                        PopupLogger.debug('Sync', 'Using SW-cached cloud document');
                    }
                } catch (e) {
                    PopupLogger.debug('Sync', 'SW cloud-doc fetch skipped:', e?.message || e);
                }

                if (!swAuthoritative && !cloudData) {
                    let retryCount = 0;
                    const maxRetries = 3;

                    while (retryCount < maxRetries) {
                        try {
                            cloudData = await FirebaseLib.getDocument('users', this.currentUser.uid);
                            this.setCachedUserDocument(this.currentUser.uid, cloudData);
                            break;
                        } catch (e) {
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
                    const cloudMatches = cloudPlayback
                        && playbackSettingsEqual(cloudPlayback, localPlayback);
                    if (!cloudMatches) {
                        await this.queuePlaybackSettingsSave({ immediate: false });
                    } else if (!localPlaybackStamp && cloudPlayback?.updatedAt) {
                        await Storage.set({
                            [PLAYBACK_SETTINGS_UPDATED_AT_KEY]: cloudPlayback.updatedAt
                        });
                    }
                }
            } catch (e) {
                PopupLogger.warn('Sync', 'Playback settings reconcile skipped:', e?.message || e);
            }

            if (elements?.syncStatus) {
                elements.syncStatus.classList.remove('syncing');
                elements.syncStatus.classList.add('synced');
                elements.syncText.textContent = 'Cloud Synced';
            }

            PopupLogger.log('Sync', `Cloud sync complete (${syncSource}) · ${this.summarizeSyncDataString(finalData)}`);

            return finalData;
        } catch (error) {
            PopupLogger.error('Firebase', 'Sync error:', error);
            if (elements?.syncStatus) {
                elements.syncStatus.classList.remove('syncing');
                elements.syncText.textContent = 'Sync Error';
            }
            throw error;
        }
    },

    /**
     * Cleanup on popup close — fire-and-forget with keepalive fetch
     * so the request survives popup unload.
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
        if (this.pendingPlaybackSave && this.currentUser) {
            const playbackToSave = this.pendingPlaybackSave;
            this.pendingPlaybackSave = null;
            FirebaseLib.setDocument('users', this.currentUser.uid, {
                playbackSettings: playbackToSave
            }, {
                keepalive: true,
                fields: ['playbackSettings']
            }).catch((err) => {
                PopupLogger.error('Sync', 'Playback save on unload failed:', err);
            });
        }

        if (this.pendingSave && this.currentUser) {
            const dataToSave = this.pendingSave;
            this.pendingSave = null;

            // Use keepalive so the request outlives the popup
            FirebaseLib.setDocument('users', this.currentUser.uid, {
                animeData:        dataToSave.animeData || {},
                videoProgress:    dataToSave.videoProgress || {},
                deletedAnime:     dataToSave.deletedAnime || {},
                groupCoverImages: dataToSave.groupCoverImages || {},
                goalSettings:     dataToSave.goalSettings || {},
                badgeUnlocks:     dataToSave.badgeUnlocks || {},
                lastUpdated:      new Date().toISOString(),
                email:            this.currentUser.email
            }, {
                keepalive: true,
                fields: ['animeData', 'videoProgress', 'deletedAnime', 'groupCoverImages', 'goalSettings', 'badgeUnlocks', 'lastUpdated', 'email']
            }).catch(err => {
                PopupLogger.error('Sync', 'Save on unload failed:', err);
            });
        }
    }
};

// Export
window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.FirebaseSync = FirebaseSync;
