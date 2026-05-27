


(function () {
    'use strict';

    const STORAGE_KEY = 'firebase_tokens';
    const FEATURE_FLAGS_KEY = '_featureFlags';
    const CURRENT_SCHEMA_VERSION = 2;

    function _storageGet(keys) {
        return new Promise((resolve) => {
            try {
                chrome.storage.local.get(keys, (r) => {
                    void chrome.runtime.lastError;
                    resolve(r || {});
                });
            } catch { resolve({}); }
        });
    }

    function _storageSet(obj) {
        return new Promise((resolve) => {
            try {
                chrome.storage.local.set(obj, () => {
                    void chrome.runtime.lastError;
                    resolve();
                });
            } catch { resolve(); }
        });
    }


    async function isAuthHardeningEnabled() {
        const stored = await _storageGet([FEATURE_FLAGS_KEY]);
        const flags = stored[FEATURE_FLAGS_KEY];
        if (!flags || typeof flags !== 'object') return true;
        return flags.AUTH_HARDENING_ENABLED !== false;
    }


    async function readTokens() {
        const stored = await _storageGet([STORAGE_KEY]);
        const t = stored[STORAGE_KEY];
        if (!t || typeof t !== 'object') return null;
        if (!t.idToken || !t.refreshToken || !t.expiresAt) return null;
        return t;
    }


    async function writeTokens(patch) {
        if (!patch || typeof patch !== 'object') return null;
        const cur = await readTokens();
        if (!cur) return null;
        const next = { ...cur, ...patch };
        await _storageSet({ [STORAGE_KEY]: next });
        return next;
    }


    async function migrateTokensIfNeeded() {
        const cur = await readTokens();
        if (!cur) return null;
        if (cur.version === CURRENT_SCHEMA_VERSION) return cur;
        if (!(await isAuthHardeningEnabled())) {


            return cur;
        }
        const now = Date.now();
        const next = {

            idToken: cur.idToken,
            refreshToken: cur.refreshToken,
            expiresAt: cur.expiresAt,


            ...cur,


            version: CURRENT_SCHEMA_VERSION,
            lastAuthCheck: cur.lastAuthCheck || now,
            needsReauth: cur.needsReauth === true,
            authRefreshAttempts: Number(cur.authRefreshAttempts) || 0,
            authRefreshLastAttemptAt: Number(cur.authRefreshLastAttemptAt) || 0
        };
        await _storageSet({ [STORAGE_KEY]: next });
        return next;
    }


    async function markAuthCheckOk() {
        return writeTokens({
            lastAuthCheck: Date.now(),
            needsReauth: false,
            authRefreshAttempts: 0,
            authRefreshLastAttemptAt: 0
        });
    }


    async function markAuthRefreshTransientFailure() {
        const cur = await readTokens();
        if (!cur) return null;
        const attempts = (Number(cur.authRefreshAttempts) || 0) + 1;
        return writeTokens({
            authRefreshAttempts: attempts,
            authRefreshLastAttemptAt: Date.now()
        });
    }


    async function setNeedsReauth(value = true) {
        return writeTokens({ needsReauth: !!value });
    }

    const api = Object.freeze({
        STORAGE_KEY,
        CURRENT_SCHEMA_VERSION,
        isAuthHardeningEnabled,
        readTokens,
        writeTokens,
        migrateTokensIfNeeded,
        markAuthCheckOk,
        markAuthRefreshTransientFailure,
        setNeedsReauth
    });

    const root = (typeof globalThis !== 'undefined') ? globalThis
        : (typeof self !== 'undefined') ? self
        : (typeof window !== 'undefined') ? window : null;
    if (root) root.AnimeTrackerAuthTokens = api;
})();
