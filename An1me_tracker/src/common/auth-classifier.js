/**
 * Anime Tracker — Shared Auth Classifier
 *
 * Single source of truth for refresh-token error classification. Replaces
 * three drifted copies that previously lived in:
 *   - src/popup/firebase-lib.js          (PERMANENT_REFRESH_ERRORS, _classifyRefreshError)
 *   - background.js                      (_BG_PERMANENT_REFRESH_ERRORS, _bgClassifyRefreshError)
 *   - src/content/cloud-sync.js          (_CS_PERMANENT_REFRESH_ERRORS, _csClassifyRefreshError)
 *
 * Loaded by:
 *   - popup.html via <script src="src/common/auth-classifier.js"> (BEFORE firebase-lib.js)
 *   - background.js via importScripts(...)
 *   - content scripts via the manifest content_scripts js[] list (BEFORE cloud-sync.js)
 *
 * KEY POLICY CHANGE (Task 1, plan 2026-05-27):
 * ────────────────────────────────────────────────────────────────────────
 * HTTP 401 / 403 from securetoken.googleapis.com are NOW classified as
 * TRANSIENT, not permanent. Rationale: on mobile cold-start (Orion / Safari
 * extensions, Chrome on flaky 2G/captive-portal) a fresh refresh attempt
 * frequently returns 401/403 due to clock skew, DNS failures, or rate
 * limiting that resolves on its own. Previously this immediately triggered
 * `signOutDueToTokenFailure()` and wiped the session — the single most
 * disruptive bug on mobile.
 *
 * From the Firebase REST docs (https://firebase.google.com/docs/reference/rest/auth)
 * the *only* reliable signal that a refresh token is permanently dead is
 * an HTTP 400 response whose body contains one of the listed permanent
 * codes. Anything else (5xx, network error, 401, 403, 408, 429, malformed
 * body, missing fields) must be treated as transient — the next call may
 * succeed once the network or server recovers.
 */
(function () {
    'use strict';

    // Identity Toolkit / Secure Token error codes that mean "this refresh
    // token will never work again". Caller MUST sign the user out for these.
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

    /**
     * Classify a refresh-token failure as permanent or transient.
     *
     * @param {number}  httpStatus   HTTP status code from the refresh attempt.
     *                               Use 0 for "fetch threw" (network error).
     * @param {string}  errorBody    Raw response body (text or JSON-stringified
     *                               object). Optional.
     * @returns {{permanent: boolean, transient: boolean, matchedCode: string|null}}
     */
    function classify(httpStatus, errorBody) {
        const body = typeof errorBody === 'string'
            ? errorBody
            : (errorBody && typeof errorBody === 'object' ? JSON.stringify(errorBody) : '');

        // Only HTTP 400 + a recognised permanent code is permanent.
        // 401/403 are now transient (see top-of-file rationale).
        if (httpStatus === 400 && body) {
            for (const code of PERMANENT_REFRESH_ERRORS) {
                if (body.includes(code)) {
                    return { permanent: true, transient: false, matchedCode: code };
                }
            }
        }
        return { permanent: false, transient: true, matchedCode: null };
    }

    /**
     * Best-effort detection of a transient network error (fetch threw,
     * abort, DNS, offline, timeout). Anything that ISN'T an HTTP response
     * with a body should be treated as transient.
     *
     * @param {*} err  Error or thrown value from a fetch call site.
     * @returns {boolean}
     */
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
            msg.includes('load failed')                  // Safari / Orion phrasing
        );
    }

    const api = Object.freeze({
        classify,
        isTransientNetworkError,
        PERMANENT_REFRESH_ERRORS
    });

    // Expose on globalThis so SW (no `window`), content-script (has `window`)
    // and popup callers can read from one global.
    const root = (typeof globalThis !== 'undefined') ? globalThis
        : (typeof self !== 'undefined') ? self
        : (typeof window !== 'undefined') ? window : null;
    if (root) root.AnimeTrackerAuthClassifier = api;
})();
