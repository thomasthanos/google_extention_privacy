const FirebaseSync = (function () {
    'use strict';

    let authStateListener = null;

    async function init(callbacks) {
        await FirebaseLib.init();
        authStateListener = FirebaseLib.onAuthStateChanged((user) => {
            FirebaseSync.currentUser = user;
            if (user) {
                if (callbacks.onUserSignedIn) callbacks.onUserSignedIn(user);
            } else {
                if (callbacks.onUserSignedOut) callbacks.onUserSignedOut();
            }
        });
    }

    function cleanup() {
        if (authStateListener) {
            authStateListener();
            authStateListener = null;
        }
    }

    function getUser() {
        return FirebaseSync.currentUser || null;
    }

    async function signInWithGoogle() {
        return await FirebaseLib.signInWithGoogle();
    }

    async function signInWithEmailPassword(email, password) {
        return await FirebaseLib.signInWithEmailPassword(email, password);
    }

    async function signUpWithEmailPassword(email, password) {
        return await FirebaseLib.signUpWithEmailPassword(email, password);
    }

    async function signOut() {
        return await FirebaseLib.signOut();
    }

    async function sendPasswordReset(email) {
        return await FirebaseLib.sendPasswordReset(email);
    }

    async function setPasswordForCurrentUser(password) {
        return await FirebaseLib.setPasswordForCurrentUser(password);
    }

    async function verifyPasswordSilently(email, password) {
        return await FirebaseLib.verifyPasswordSilently(email, password);
    }

    async function saveToCloud(data, immediate = false) {
        if (immediate) {
            chrome.runtime.sendMessage({ type: 'SYNC_TO_FIREBASE_IMMEDIATE' });
        } else {
            chrome.runtime.sendMessage({ type: 'SYNC_TO_FIREBASE' });
        }
    }

    async function queuePlaybackSettingsSave() {
        const stored = await chrome.storage.local.get([
            'copyGuardEnabled',
            'smartNotificationsEnabled',
            'autoSkipFillers',
            'skiptimeHelperEnabled'
        ]);
        const playbackSettings = {
            copyGuard: stored.copyGuardEnabled !== false,
            smartNotif: stored.smartNotificationsEnabled === true,
            autoSkipFiller: stored.autoSkipFillers === true,
            skiptimeHelper: stored.skiptimeHelperEnabled === true,
            updatedAt: new Date().toISOString()
        };
        chrome.runtime.sendMessage({ type: 'PUSH_PLAYBACK_SETTINGS', playbackSettings });
    }

    async function pushAnilistAuthToCloud(auth, username = null) {
        const payload = {
            accessToken: auth?.accessToken || null,
            expiresAt: auth?.expiresAt || 0,
            viewer: auth?.viewer || null,
            username: username || null,
            updatedAt: new Date().toISOString()
        };
        chrome.runtime.sendMessage({ type: 'PUSH_ANILIST_AUTH', anilistAuth: payload });
    }

    async function loadAndSyncData(elements) {
        const stored = await chrome.storage.local.get([
            'animeData',
            'videoProgress',
            'deletedAnime',
            'groupCoverImages',
            'goalSettings',
            'badgeUnlocks'
        ]);
        return {
            animeData: stored.animeData || {},
            videoProgress: stored.videoProgress || {},
            deletedAnime: stored.deletedAnime || {},
            groupCoverImages: stored.groupCoverImages || {},
            goalSettings: stored.goalSettings || {},
            badgeUnlocks: stored.badgeUnlocks || {}
        };
    }

    function clearCachedUserDocument() {
        chrome.runtime.sendMessage({ type: 'INVALIDATE_BG_CLOUD_DOC_CACHE' });
    }

    return {
        currentUser: null,
        init,
        cleanup,
        getUser,
        signInWithGoogle,
        signInWithEmailPassword,
        signUpWithEmailPassword,
        signOut,
        sendPasswordReset,
        setPasswordForCurrentUser,
        verifyPasswordSilently,
        saveToCloud,
        queuePlaybackSettingsSave,
        pushAnilistAuthToCloud,
        loadAndSyncData,
        clearCachedUserDocument
    };
})();

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.FirebaseSync = FirebaseSync;

const AT = (window.AnimeTrackerContent = window.AnimeTrackerContent || {});
AT.FirebaseSync = FirebaseSync;
