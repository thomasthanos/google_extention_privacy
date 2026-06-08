/* Combined cloud / auth plumbing — merged from common/cloud/*.
   firebase config + auth-error classifier + auth-token store + Firestore codec.
   Each block is an independent IIFE (kept verbatim). */















const firebaseConfig = {
    apiKey: "AIzaSyCDF9US2OwARlyZ0AH_zDpjzmOXRtrGKMg",
    authDomain: "anime-tracker-64d86.firebaseapp.com",
    projectId: "anime-tracker-64d86",
    storageBucket: "anime-tracker-64d86.firebasestorage.app",
    messagingSenderId: "851894443732",
    appId: "1:851894443732:web:91f5dc69608fbf474f6541"
};



(function () {
    const root = typeof globalThis !== 'undefined' ? globalThis
        : (typeof self !== 'undefined' ? self
        : (typeof window !== 'undefined' ? window : null));
    if (root) root.firebaseConfig = firebaseConfig;
})();





(function () {
    'use strict';


    const PERMANENT_REFRESH_ERRORS = Object.freeze([
        'INVALID_REFRESH_TOKEN',
        'TOKEN_EXPIRED',
        'USER_DISABLED',
        'USER_NOT_FOUND',
        'INVALID_GRANT',
        'invalid_grant',
        'CREDENTIAL_TOO_OLD_LOGIN_AGAIN',
        'MISSING_REFRESH_TOKEN',
    ]);


    function classify(httpStatus, errorBody) {
        const body = typeof errorBody === 'string'
            ? errorBody
            : (errorBody && typeof errorBody === 'object' ? JSON.stringify(errorBody) : '');


        if (httpStatus === 400 && body) {
            for (const code of PERMANENT_REFRESH_ERRORS) {
                if (body.includes(code)) {
                    return { permanent: true, transient: false, matchedCode: code };
                }
            }
        }
        return { permanent: false, transient: true, matchedCode: null };
    }


    function isTransientNetworkError(err) {
        if (!err) return false;
        if (err.isTimeout) return true;
        const name = String(err.name || '').toLowerCase();
        if (name === 'aborterror' || name === 'timeouterror' || name === 'typeerror') return true;
        const msg = String(err.message || err).toLowerCase();
        return (
            msg.includes('failed to fetch') ||
            msg.includes('network') ||
            msg.includes('offline') ||
            msg.includes('aborted') ||
            msg.includes('timeout') ||
            msg.includes('timed out') ||
            msg.includes('load failed')
        );
    }

    const api = Object.freeze({
        classify,
        isTransientNetworkError,
        PERMANENT_REFRESH_ERRORS
    });


    const root = (typeof globalThis !== 'undefined') ? globalThis
        : (typeof self !== 'undefined') ? self
        : (typeof window !== 'undefined') ? window : null;
    if (root) root.AnimeTrackerAuthClassifier = api;
})();





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





(function () {
    'use strict';

    function encodeValue(value) {
        if (value === null || value === undefined) return { nullValue: null };
        if (value instanceof Date) return { timestampValue: value.toISOString() };
        if (typeof value === 'string') return { stringValue: value };
        if (typeof value === 'boolean') return { booleanValue: value };
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) return { nullValue: null };
            return Number.isInteger(value)
                ? { integerValue: String(value) }
                : { doubleValue: value };
        }
        if (Array.isArray(value)) {
            return { arrayValue: { values: value.map(encodeValue) } };
        }
        if (typeof value === 'object') {
            return { mapValue: { fields: encodeFields(value) } };
        }
        return { nullValue: null };
    }

    function encodeFields(obj) {
        const fields = {};
        for (const [key, value] of Object.entries(obj || {})) {
            fields[key] = encodeValue(value);
        }
        return fields;
    }

    function decodeValue(v) {
        if (!v) return null;


        if ('nullValue' in v) return null;
        if ('booleanValue' in v) return v.booleanValue;
        if ('stringValue' in v) return v.stringValue;
        if ('integerValue' in v) return parseInt(v.integerValue, 10);
        if ('doubleValue' in v) return v.doubleValue;
        if ('timestampValue' in v) return v.timestampValue;
        if ('arrayValue' in v) {
            return (v.arrayValue.values || []).map(decodeValue);
        }
        if ('mapValue' in v) {
            const obj = {};
            for (const [k, val] of Object.entries(v.mapValue.fields || {})) {
                obj[k] = decodeValue(val);
            }
            return obj;
        }
        return null;
    }

    function decodeFields(fields) {
        if (!fields) return {};
        const out = {};
        for (const [k, v] of Object.entries(fields)) {
            out[k] = decodeValue(v);
        }
        return out;
    }

    function decodeDoc(doc) {
        if (!doc?.fields) return null;
        return decodeFields(doc.fields);
    }

    const api = { encodeFields, decodeFields, decodeDoc };

    const root = typeof globalThis !== 'undefined' ? globalThis : self;
    root.AnimeTrackerFirestoreCodec = api;
})();
