/**
 * Anime Tracker — Auth Tokens Helper
 *
 * Single source of truth for the shape of `chrome.storage.local.firebase_tokens`.
 * Adds non-destructive schema versioning so future fields can be introduced
 * without wiping existing sessions.
 *
 * Schema v1 (legacy, pre-Tasks-2/4):
 *   { idToken, refreshToken, expiresAt }
 *
 * Schema v2 (this task):
 *   {
 *     idToken, refreshToken, expiresAt,
 *     version: 2,                       // schema marker
 *     lastAuthCheck: <ms>,              // ms since epoch of last successful refresh
 *     needsReauth: false,               // set true after Task 4 backoff exhausts
 *     authRefreshAttempts: 0,           // Task 4 backoff counter
 *     authRefreshLastAttemptAt: 0       // Task 4 last alarm-driven attempt
 *   }
 *
 * `migrateTokensIfNeeded()` reads any v1 token and rewrites it as v2 by
 * adding the new fields with safe defaults. The credential fields
 * (idToken/refreshToken/expiresAt) are byte-identical after migration; the
 * user is NEVER signed out by this helper.
 *
 * Loaded by:
 *   - popup.html before firebase-lib.js
 *   - background.js via importScripts
 *   - content scripts via the manifest content_scripts list (after firebase-config.js)
 *
 * Behind the AUTH_HARDENING_ENABLED feature flag — if disabled, we still
 * read v2 fields when present (forward-compat) but we skip the migration
 * write so a rollback to the previous build doesn't see unexpected fields.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'firebase_tokens';
    const FEATURE_FLAGS_KEY = '_featureFlags';
    const CURRENT_SCHEMA_VERSION = 2;

    function _storageGet(keys) {
        return new Promise((resolve) => {
            try {
                chrome.storage.local.get(keys, (r) => {
                    void chrome.runtime.lastError;     // surfaced by callers via error fields if needed
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

    /**
     * Read the AUTH_HARDENING_ENABLED feature flag. Defaults to true (the
     * Task-2/4 hardening is on in stable). Setting
     * `chrome.storage.local._featureFlags = { AUTH_HARDENING_ENABLED: false }`
     * disables the schema upgrade for emergency rollback.
     */
    async function isAuthHardeningEnabled() {
        const stored = await _storageGet([FEATURE_FLAGS_KEY]);
        const flags = stored[FEATURE_FLAGS_KEY];
        if (!flags || typeof flags !== 'object') return true;
        return flags.AUTH_HARDENING_ENABLED !== false;
    }

    /**
     * Read the tokens object as-is. Returns null when nothing is stored
     * or the structure is malformed. Does NOT migrate.
     */
    async function readTokens() {
        const stored = await _storageGet([STORAGE_KEY]);
        const t = stored[STORAGE_KEY];
        if (!t || typeof t !== 'object') return null;
        if (!t.idToken || !t.refreshToken || !t.expiresAt) return null;
        return t;
    }

    /**
     * Patch the stored tokens object. Pass partial fields; missing keys
     * are preserved. Adding new fields (e.g. needsReauth) goes through here.
     *
     * @param {object} patch  Partial token object.
     * @returns {Promise<object|null>} The post-write tokens object, or null
     *                                 if no tokens were stored to patch.
     */
    async function writeTokens(patch) {
        if (!patch || typeof patch !== 'object') return null;
        const cur = await readTokens();
        if (!cur) return null;
        const next = { ...cur, ...patch };
        await _storageSet({ [STORAGE_KEY]: next });
        return next;
    }

    /**
     * Idempotent v1→v2 migration. Called from popup init, BG boot, content
     * script boot. Safe to call repeatedly. Returns the post-migration
     * tokens (or null if no tokens were stored).
     */
    async function migrateTokensIfNeeded() {
        const cur = await readTokens();
        if (!cur) return null;
        if (cur.version === CURRENT_SCHEMA_VERSION) return cur;
        if (!(await isAuthHardeningEnabled())) {
            // Flag is off — don't write the new shape, but still let callers
            // see the legacy fields.
            return cur;
        }
        const now = Date.now();
        const next = {
            // Preserve existing credential fields byte-for-byte.
            idToken: cur.idToken,
            refreshToken: cur.refreshToken,
            expiresAt: cur.expiresAt,
            // Preserve any newer (forward-compat) fields a future build
            // might have stamped before this code path ran.
            ...cur,
            // Stamp the v2 fields. Defaults are non-destructive: lastAuthCheck
            // = now means "we just considered the user signed in", so the
            // 7-day offline grace window restarts cleanly from upgrade time
            // (otherwise a long-idle session that was upgraded would
            // immediately count as expired against the new clock).
            version: CURRENT_SCHEMA_VERSION,
            lastAuthCheck: cur.lastAuthCheck || now,
            needsReauth: cur.needsReauth === true,
            authRefreshAttempts: Number(cur.authRefreshAttempts) || 0,
            authRefreshLastAttemptAt: Number(cur.authRefreshLastAttemptAt) || 0
        };
        await _storageSet({ [STORAGE_KEY]: next });
        return next;
    }

    /**
     * Mark a successful refresh — bumps lastAuthCheck and clears the
     * needs-reauth / backoff counters. Called from refreshToken success
     * paths (Task 4 wires this up).
     */
    async function markAuthCheckOk() {
        return writeTokens({
            lastAuthCheck: Date.now(),
            needsReauth: false,
            authRefreshAttempts: 0,
            authRefreshLastAttemptAt: 0
        });
    }

    /**
     * Mark a transient refresh failure — increments the attempt counter
     * without touching lastAuthCheck. Caller (Task 4) decides when to
     * arm the next retry alarm based on the returned attempt count.
     */
    async function markAuthRefreshTransientFailure() {
        const cur = await readTokens();
        if (!cur) return null;
        const attempts = (Number(cur.authRefreshAttempts) || 0) + 1;
        return writeTokens({
            authRefreshAttempts: attempts,
            authRefreshLastAttemptAt: Date.now()
        });
    }

    /**
     * Set the non-destructive `needsReauth` flag. The popup uses this to
     * surface a "Sign in again" banner without wiping tokens (which would
     * also wipe the user's email so they'd have to retype it).
     */
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
