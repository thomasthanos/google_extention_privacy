// cloud.js — shared cloud/auth plumbing: Firebase config, auth-error classifier,
// auth-token store, and the Firestore JSON⇄fields codec. Each block is its own IIFE.

const firebaseConfig = {
  apiKey: "AIzaSyCDF9US2OwARlyZ0AH_zDpjzmOXRtrGKMg",
  authDomain: "anime-tracker-64d86.firebaseapp.com",
  projectId: "anime-tracker-64d86",
  storageBucket: "anime-tracker-64d86.firebasestorage.app",
  messagingSenderId: "851894443732",
  appId: "1:851894443732:web:91f5dc69608fbf474f6541",
};

(function () {
  const root =
    typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : null;
  if (root) root.firebaseConfig = firebaseConfig;
})();

(function () {
  "use strict";

  const PERMANENT_REFRESH_ERRORS = Object.freeze([
    "INVALID_REFRESH_TOKEN",
    "TOKEN_EXPIRED",
    "USER_DISABLED",
    "USER_NOT_FOUND",
    "INVALID_GRANT",
    "invalid_grant",
    "CREDENTIAL_TOO_OLD_LOGIN_AGAIN",
    "MISSING_REFRESH_TOKEN",
  ]);

  function classify(httpStatus, errorBody) {
    const body = typeof errorBody === "string" ? errorBody : errorBody && typeof errorBody === "object" ? JSON.stringify(errorBody) : "";

    if (httpStatus === 400 && body) {
      for (const code of PERMANENT_REFRESH_ERRORS) {
        if (body.includes(code)) {
          return { permanent: true, transient: false, matchedCode: code };
        }
      }
    }
    return { permanent: false, transient: true, matchedCode: null };
  }

  const api = Object.freeze({
    classify,
    PERMANENT_REFRESH_ERRORS,
  });

  const root =
    typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : null;
  if (root) root.AnimeTrackerAuthClassifier = api;
})();

(function () {
  "use strict";

  const STORAGE_KEY = "firebase_tokens";
  const FEATURE_FLAGS_KEY = "_featureFlags";
  const CURRENT_SCHEMA_VERSION = 2;
  const AUTH_MUTATION_TIMEOUT_MS = 20000;

  function _storageGet(keys) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(keys, (result) => {
          const errorMessage = chrome.runtime.lastError?.message;
          if (errorMessage) reject(new Error(`Local storage read failed: ${errorMessage}`));
          else resolve(result || {});
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function _sendAuthMutation(message) {
    if (typeof window === "undefined" && typeof bgMutateFirebaseAuth === "function") {
      return bgMutateFirebaseAuth(message);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("Auth storage mutation timed out"));
      }, AUTH_MUTATION_TIMEOUT_MS);

      try {
        chrome.runtime.sendMessage({ type: "AUTH_STATE_MUTATE", ...message }, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          if (!response?.success) {
            reject(new Error(response?.error || "Auth storage mutation failed"));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  async function isAuthHardeningEnabled() {
    const stored = await _storageGet([FEATURE_FLAGS_KEY]);
    const flags = stored[FEATURE_FLAGS_KEY];
    if (!flags || typeof flags !== "object") return true;
    return flags.AUTH_HARDENING_ENABLED !== false;
  }

  async function readTokens() {
    const stored = await _storageGet([STORAGE_KEY]);
    const t = stored[STORAGE_KEY];
    if (!t || typeof t !== "object") return null;
    if (!t.idToken || !t.refreshToken || !t.expiresAt) return null;
    return t;
  }

  async function writeTokens(patch, options = {}) {
    if (!patch || typeof patch !== "object") return null;
    const result = await _sendAuthMutation({
      operation: "patch_tokens",
      patch,
      expectedRefreshToken: options.expectedRefreshToken || null,
      expectedIdToken: options.expectedIdToken || null,
    });
    return result.applied === false ? null : result.tokens || null;
  }

  async function replaceTokens(tokens, options = {}) {
    if (!tokens || typeof tokens !== "object") throw new TypeError("Auth tokens must be an object");
    return _sendAuthMutation({
      operation: "replace_tokens",
      tokens,
      expectedRefreshToken: options.expectedRefreshToken || null,
    });
  }

  async function replaceSession(user, tokens) {
    if (!user || typeof user !== "object") throw new TypeError("Firebase user must be an object");
    if (!tokens || typeof tokens !== "object") throw new TypeError("Auth tokens must be an object");
    return _sendAuthMutation({ operation: "replace_session", user, tokens });
  }

  async function clearSession() {
    return _sendAuthMutation({ operation: "clear_session" });
  }

  async function migrateTokensIfNeeded() {
    if (!(await isAuthHardeningEnabled())) {
      return readTokens();
    }
    const result = await _sendAuthMutation({ operation: "migrate_tokens" });
    return result.tokens || null;
  }

  async function markAuthCheckOk(expected = null) {
    const options =
      expected && typeof expected === "object"
        ? expected
        : { expectedRefreshToken: expected || null };
    return writeTokens({
      lastAuthCheck: Date.now(),
      needsReauth: false,
      authRefreshAttempts: 0,
      authRefreshLastAttemptAt: 0,
    }, options);
  }

  async function markAuthRefreshTransientFailure(expectedRefreshToken = null) {
    const result = await _sendAuthMutation({
      operation: "mark_transient_failure",
      expectedRefreshToken,
    });
    return result.applied === false ? null : result.tokens || null;
  }

  async function setNeedsReauth(value = true, options = {}) {
    return writeTokens({ needsReauth: !!value }, options);
  }

  const api = Object.freeze({
    STORAGE_KEY,
    CURRENT_SCHEMA_VERSION,
    isAuthHardeningEnabled,
    readTokens,
    writeTokens,
    replaceTokens,
    replaceSession,
    clearSession,
    migrateTokensIfNeeded,
    markAuthCheckOk,
    markAuthRefreshTransientFailure,
    setNeedsReauth,
  });

  const root =
    typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : null;
  if (root) root.AnimeTrackerAuthTokens = api;
})();

(function () {
  "use strict";

  function encodeValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (value instanceof Date) return { timestampValue: value.toISOString() };
    if (typeof value === "string") return { stringValue: value };
    if (typeof value === "boolean") return { booleanValue: value };
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return { nullValue: null };
      return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    if (Array.isArray(value)) {
      return { arrayValue: { values: value.map(encodeValue) } };
    }
    if (typeof value === "object") {
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

    if ("nullValue" in v) return null;
    if ("booleanValue" in v) return v.booleanValue;
    if ("stringValue" in v) return v.stringValue;
    if ("integerValue" in v) return parseInt(v.integerValue, 10);
    if ("doubleValue" in v) return v.doubleValue;
    if ("timestampValue" in v) return v.timestampValue;
    if ("arrayValue" in v) {
      return (v.arrayValue.values || []).map(decodeValue);
    }
    if ("mapValue" in v) {
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

  const root = typeof globalThis !== "undefined" ? globalThis : self;
  root.AnimeTrackerFirestoreCodec = api;
})();
