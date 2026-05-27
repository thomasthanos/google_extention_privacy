const FirebaseLib = (function () {
    'use strict';

    const API_KEY = firebaseConfig.apiKey;
    const PROJECT_ID = firebaseConfig.projectId;

    const OAUTH_CLIENT_ID_LOCAL = '851894443732-st4bqk291b03jf6bscup0eqck2n60gmq.apps.googleusercontent.com';
    const OAUTH_CLIENT_ID_RELEASE = '851894443732-uncr0msnm21fbrfbagtdd76pmkatui1t.apps.googleusercontent.com';

    const isLocalDev = !('update_url' in chrome.runtime.getManifest());
    const OAUTH_CLIENT_ID = isLocalDev ? OAUTH_CLIENT_ID_LOCAL : OAUTH_CLIENT_ID_RELEASE;
    const SCOPES = ['email', 'profile'].join(' ');

    function getRedirectUrl() {
        try {
            return chrome.identity?.getRedirectURL?.() || '';
        } catch {
            return '';
        }
    }

    const STORAGE_KEYS = {
        USER: 'firebase_user',
        TOKENS: 'firebase_tokens'
    };

    let currentUser = null;
    let authStateListeners = [];

    async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
        if (options?.keepalive) return fetch(url, options);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            return await fetch(url, { ...options, signal: ctrl.signal });
        } finally {
            clearTimeout(timer);
        }
    }

    async function init() {
        try {
            const ru = getRedirectUrl();
            if (ru) {
                const shortUrl = ru.replace(/https:\/\/([a-z0-9]+)\.chromiumapp\.org.*/, 'chrome-extension://$1');
                PopupLogger.log('Firebase', `Extension redirect: ${shortUrl}`);
            }
        } catch { }

        // Task 2: idempotent v1→v2 token-schema migration. Adds version,
        // lastAuthCheck, needsReauth, and the Task-4 backoff counters to any
        // legacy token blob WITHOUT touching idToken/refreshToken/expiresAt.
        // Behind the AUTH_HARDENING_ENABLED feature flag (defaults on).
        try {
            await window.AnimeTrackerAuthTokens?.migrateTokensIfNeeded?.();
        } catch (e) {
            PopupLogger.warn('Firebase', `Token migration skipped: ${e?.message}`);
        }

        try {
            const stored = await chrome.storage.local.get([STORAGE_KEYS.USER, STORAGE_KEYS.TOKENS]);
            if (stored[STORAGE_KEYS.USER] && stored[STORAGE_KEYS.TOKENS]) {
                const tokens = stored[STORAGE_KEYS.TOKENS];

                if (!tokens.refreshToken) {
                    PopupLogger.warn('Firebase', 'Corrupt session (no refreshToken), clearing...');
                    await signOut();
                    return null;
                }

                if (!tokens.expiresAt || tokens.expiresAt < Date.now() + 300000) {
                    // Task 4: when needsReauth is set, the state machine has
                    // exhausted its budget and is waiting for the user to
                    // sign in interactively. Don't kick off another refresh
                    // (we'd just bump the alarm) — surface the user with
                    // the flag still set so the popup can render its
                    // "Reconnect" banner.
                    if (tokens.needsReauth) {
                        PopupLogger.warn('Firebase',
                            'needsReauth is set — skipping auto-refresh, surfacing reconnect prompt');
                        currentUser = stored[STORAGE_KEYS.USER];
                        notifyAuthStateListeners(currentUser);
                        return currentUser;
                    }
                    try {
                        await refreshToken(tokens.refreshToken);
                        PopupLogger.log('Firebase', 'Token refreshed successfully');
                    } catch (e) {
                        // Only sign out when the refresh token itself is dead
                        // (revoked, account disabled, etc.). Transient failures
                        // — network blips on cold boot, server 5xx, rate limits
                        // — must NOT wipe the session: that's the bug where
                        // every extension reload on flaky mobile networks
                        // logged the user out. Fall through to "use existing
                        // token if not yet expired" instead.
                        if (e?.permanent) {
                            PopupLogger.warn('Firebase', `Refresh token rejected (permanent: ${e.message}) — signing out`);
                            await signOut();
                            return null;
                        }

                        const stillValid = tokens.expiresAt && tokens.expiresAt > Date.now() + 30000;
                        if (stillValid) {
                            PopupLogger.warn('Firebase',
                                `Token refresh transiently failed (${e.message}). Using existing token (expires ${new Date(tokens.expiresAt).toLocaleTimeString()}); will retry on next call.`);
                            // Fall through — we keep the user signed in.
                        } else {
                            // Transient failure AND no usable token left.
                            // Don't sign out (refresh token may still be good)
                            // — return null so the caller knows we're not
                            // ready, but preserve the session for the next
                            // attempt (e.g. when network is reachable again).
                            PopupLogger.warn('Firebase',
                                `Token refresh transiently failed (${e.message}) and existing token is expired. Keeping session for retry.`);
                            currentUser = stored[STORAGE_KEYS.USER];
                            notifyAuthStateListeners(currentUser);
                            return currentUser;
                        }
                    }
                }

                currentUser = stored[STORAGE_KEYS.USER];
                notifyAuthStateListeners(currentUser);
                return currentUser;
            }
        } catch (error) {
            PopupLogger.error('Firebase', 'Init error:', error);
        }

        notifyAuthStateListeners(null);
        return null;
    }

    async function signInWithGoogle() {
        return new Promise((resolve, reject) => {
            const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
            const REDIRECT_URL = getRedirectUrl();

            if (!REDIRECT_URL || !chrome.identity?.launchWebAuthFlow) {
                reject(new Error('Google sign-in is not supported on this browser. Please use Email/Password login instead.'));
                return;
            }

            authUrl.searchParams.set('client_id', OAUTH_CLIENT_ID);
            authUrl.searchParams.set('redirect_uri', REDIRECT_URL);
            authUrl.searchParams.set('response_type', 'token');
            authUrl.searchParams.set('scope', SCOPES);
            authUrl.searchParams.set('prompt', 'select_account');

            PopupLogger.log('Firebase', 'Starting OAuth flow...');

            chrome.identity.launchWebAuthFlow(
                { url: authUrl.toString(), interactive: true },
                async (redirectUrl) => {
                    if (chrome.runtime.lastError) {
                        const errMsg = chrome.runtime.lastError.message || '';
                        const isCancelled = errMsg.includes('did not approve') ||
                            errMsg.includes('cancelled') || errMsg.includes('closed') ||
                            errMsg.includes('user_cancelled');
                        if (!isCancelled) {
                            PopupLogger.error('Firebase', 'Auth error:', chrome.runtime.lastError);
                        }
                        reject(new Error(errMsg));
                        return;
                    }

                    if (!redirectUrl) {
                        reject(new Error('No redirect URL received'));
                        return;
                    }

                    PopupLogger.log('Firebase', 'OAuth redirect received');

                    try {
                        const url = new URL(redirectUrl);
                        const hashParams = new URLSearchParams(url.hash.substring(1));
                        const accessToken = hashParams.get('access_token');

                        if (!accessToken) {
                            reject(new Error('No access token in response'));
                            return;
                        }

                        const response = await fetchWithTimeout(
                            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${API_KEY}`,
                            {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    postBody: `access_token=${accessToken}&providerId=google.com`,
                                    requestUri: getRedirectUrl(),
                                    returnIdpCredential: true,
                                    returnSecureToken: true
                                })
                            }
                        );

                        const data = await response.json().catch(() => null);

                        if (!data) {
                            reject(new Error('Empty/invalid OAuth response'));
                            return;
                        }

                        if (data.error) {
                            reject(new Error(data.error?.message || 'OAuth error'));
                            return;
                        }

                        currentUser = {
                            uid: data.localId,
                            email: data.email,
                            displayName: data.displayName || (data.email || '').split('@')[0],
                            photoURL: data.photoUrl || null
                        };

                        const tokens = {
                            idToken: data.idToken,
                            refreshToken: data.refreshToken,
                            expiresAt: Date.now() + (parseInt(data.expiresIn) * 1000)
                        };

                        await chrome.storage.local.set({
                            [STORAGE_KEYS.USER]: currentUser,
                            [STORAGE_KEYS.TOKENS]: tokens
                        });

                        notifyAuthStateListeners(currentUser);
                        resolve(currentUser);
                    } catch (error) {
                        PopupLogger.error('Firebase', 'Token exchange error:', error);
                        reject(error);
                    }
                }
            );
        });
    }

    let _popupRefreshInflight = null;

    // Task 4: state-machine constants (mirror BG side). Backoff in minutes.
    // Popup-side alarm is best-effort: if the popup is closed when it fires,
    // chrome.alarms still wakes the SW which has its own auth-refresh-retry-bg
    // alarm — so retries continue regardless of popup lifecycle.
    const AUTH_REFRESH_RETRY_ALARM = 'auth-refresh-retry';
    const AUTH_REFRESH_BACKOFF_MIN = [1, 5, 15, 60, 360];
    const MAX_AUTH_REFRESH_ATTEMPTS = AUTH_REFRESH_BACKOFF_MIN.length;
    const AUTH_OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

    /**
     * Called from the transient catch in refreshToken. Bumps the attempt
     * counter on the tokens record, sets needsReauth=true once exhausted,
     * and arms the popup-side backoff alarm. Tokens are NEVER cleared here.
     */
    async function _popupOnRefreshTransient(reason) {
        const helper = (typeof window !== 'undefined') ? window.AnimeTrackerAuthTokens : null;
        if (!helper) return;
        const updated = await helper.markAuthRefreshTransientFailure();
        if (!updated) return;
        const attempts = Number(updated.authRefreshAttempts) || 0;
        const lastOk = Number(updated.lastAuthCheck) || 0;
        const offlineFor = lastOk ? (Date.now() - lastOk) : 0;
        const exceededAttempts = attempts >= MAX_AUTH_REFRESH_ATTEMPTS;
        const exceededGrace = lastOk > 0 && offlineFor > AUTH_OFFLINE_GRACE_MS;

        if (exceededAttempts || exceededGrace) {
            await helper.setNeedsReauth(true);
            PopupLogger.warn('Firebase',
                `needsReauth=true · attempts=${attempts}, offlineFor=${Math.round(offlineFor / 86400000)}d, reason=${reason}`);
            try { chrome.alarms?.clear?.(AUTH_REFRESH_RETRY_ALARM); } catch {}
            // Notify any listeners (popup main.js wires a banner via this).
            try { notifyAuthStateListeners(currentUser); } catch {}
            return;
        }
        const idx = Math.min(attempts - 1, AUTH_REFRESH_BACKOFF_MIN.length - 1);
        const delayMin = AUTH_REFRESH_BACKOFF_MIN[idx];
        try {
            chrome.alarms?.create?.(AUTH_REFRESH_RETRY_ALARM, { delayInMinutes: delayMin });
            PopupLogger.warn('Firebase',
                `Auth refresh retry scheduled in ${delayMin} min (attempt ${attempts}/${MAX_AUTH_REFRESH_ATTEMPTS}, reason: ${reason})`);
        } catch (e) {
            PopupLogger.warn('Firebase', `Could not arm auth-refresh-retry alarm: ${e?.message}`);
        }
    }

    /**
     * Returns true when tokens.needsReauth is set. Popup uses this to
     * surface the reconnect banner without reading storage repeatedly.
     */
    async function isReauthNeeded() {
        const helper = (typeof window !== 'undefined') ? window.AnimeTrackerAuthTokens : null;
        if (!helper) return false;
        const t = await helper.readTokens();
        return !!(t && t.needsReauth);
    }

    // Task 3: Classification of refresh-token failures lives in the shared
    // module src/common/auth-classifier.js (loaded BEFORE this file via
    // popup.html). Single source of truth across popup / SW / content.
    //
    // POLICY (from Task 1): HTTP 401 / 403 are TRANSIENT, not permanent.
    // ONLY HTTP 400 + a recognised permanent code (INVALID_REFRESH_TOKEN,
    // TOKEN_EXPIRED, USER_DISABLED, USER_NOT_FOUND, INVALID_GRANT,
    // CREDENTIAL_TOO_OLD_LOGIN_AGAIN, MISSING_REFRESH_TOKEN) signs the user
    // out. Anything else (network, 5xx, 401, 403, malformed body) keeps the
    // session alive and is retried via Task-4 alarm-driven backoff.
    function _classifyRefreshError(httpStatus, errorBody) {
        const cl = (typeof window !== 'undefined' && window.AnimeTrackerAuthClassifier);
        if (!cl) {
            // Hard fail-safe: classifier didn't load. Treat ALL failures as
            // transient — better to keep a stale session and surface a
            // "reconnect" UI than to silently sign someone out.
            return false;
        }
        return cl.classify(httpStatus, errorBody).permanent;
    }

    async function refreshToken(refreshTokenValue) {
        if (_popupRefreshInflight) return _popupRefreshInflight;

        const inflight = (async () => {
            try {
                if (!refreshTokenValue || typeof refreshTokenValue !== 'string') {
                    const err = new Error('Invalid refresh token');
                    err.permanent = true;
                    throw err;
                }

                let response;
                try {
                    response = await fetchWithTimeout(
                        `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                grant_type: 'refresh_token',
                                refresh_token: refreshTokenValue
                            })
                        }
                    );
                } catch (networkErr) {
                    // fetch threw → network failure / abort / DNS / etc.
                    // These are ALWAYS transient. Mark explicitly so the
                    // caller can keep the existing tokens around.
                    const err = new Error(`Network error during token refresh: ${networkErr?.message || networkErr}`);
                    err.permanent = false;
                    err.transient = true;
                    throw err;
                }

                if (!response.ok) {
                    const body = await response.text().catch(() => '');
                    PopupLogger.error('Firebase', `Token refresh HTTP ${response.status}: ${body.slice(0, 200)}`);
                    const err = new Error(`HTTP ${response.status}`);
                    err.status = response.status;
                    err.body = body;
                    err.permanent = _classifyRefreshError(response.status, body);
                    err.transient = !err.permanent;
                    throw err;
                }

                const data = await response.json().catch(() => null);

                if (!data) {
                    const err = new Error('Empty/invalid token refresh response');
                    err.transient = true;
                    err.permanent = false;
                    throw err;
                }

                if (data.error) {
                    const msg = data.error?.message || 'Token refresh failed';
                    const err = new Error(msg);
                    err.permanent = _classifyRefreshError(400, msg);
                    err.transient = !err.permanent;
                    throw err;
                }

                if (!data.id_token || !data.refresh_token || !data.expires_in) {
                    const missing = ['id_token', 'refresh_token', 'expires_in'].filter(k => !data[k]);
                    PopupLogger.error('Firebase', 'Invalid token refresh response, missing fields:', missing);
                    const err = new Error('Invalid token refresh response');
                    // Server returned 200 but body is malformed — treat as transient
                    // so we don't wipe the session for a server bug.
                    err.transient = true;
                    err.permanent = false;
                    throw err;
                }

                const tokens = {
                    idToken: data.id_token,
                    refreshToken: data.refresh_token,
                    expiresAt: Date.now() + (parseInt(data.expires_in) * 1000)
                };

                // Task 4: persist new credentials, then bookkeep success
                // (reset attempts, bump lastAuthCheck, clear needsReauth).
                // markAuthCheckOk reads via auth-tokens helper, so write
                // first then call it.
                const tokensHelper = window.AnimeTrackerAuthTokens;
                if (tokensHelper) {
                    await chrome.storage.local.set({
                        [STORAGE_KEYS.TOKENS]: { ...tokens, version: 2 }
                    });
                    await tokensHelper.markAuthCheckOk();
                } else {
                    await chrome.storage.local.set({ [STORAGE_KEYS.TOKENS]: tokens });
                }
                // Successful refresh — clear popup-side retry alarm.
                try { chrome.alarms?.clear?.(AUTH_REFRESH_RETRY_ALARM); } catch {}
                PopupLogger.log('Firebase', `Token refreshed, expires at ${new Date(tokens.expiresAt).toLocaleTimeString()}`);
                return tokens;
            } catch (error) {
                if (!error.permanent && !error.transient) {
                    // Unclassified error — default to transient (safer than wiping session).
                    error.transient = true;
                    error.permanent = false;
                }
                // Task 4: on transient failure, bookkeep + arm popup retry
                // alarm. Permanent failures fall through to the throw — caller
                // (init / getIdToken) decides whether to sign out.
                if (error.transient) {
                    try { await _popupOnRefreshTransient(error?.message || 'unknown'); }
                    catch (e2) { PopupLogger.warn('Firebase', `Backoff bookkeeping failed: ${e2?.message}`); }
                }
                PopupLogger.error('Firebase',
                    `Token refresh ${error.permanent ? 'PERMANENT' : 'transient'} error:`, error.message);
                throw error;
            }
        })();

        _popupRefreshInflight = inflight;
        inflight.finally(() => {
            if (_popupRefreshInflight === inflight) _popupRefreshInflight = null;
        });
        return inflight;
    }

    async function getIdToken() {
        const stored = await chrome.storage.local.get([STORAGE_KEYS.TOKENS]);
        const tokens = stored[STORAGE_KEYS.TOKENS];

        if (!tokens) {
            PopupLogger.log('Firebase', 'No tokens found in storage');
            return null;
        }

        if (!tokens.idToken || !tokens.refreshToken || !tokens.expiresAt) {
            const missing = ['idToken', 'refreshToken', 'expiresAt'].filter(k => !tokens[k]);
            PopupLogger.error('Firebase', 'Invalid tokens structure, missing fields:', missing);
            await signOut();
            return null;
        }

        // Task 4: while needsReauth is set, don't auto-refresh — the alarm
        // chain has already given up. Use the existing idToken if it's still
        // valid (>30s), otherwise return null so callers either show the
        // reconnect banner or fall back to local-only data.
        if (tokens.needsReauth) {
            const stillValid = tokens.expiresAt > Date.now() + 30000;
            return stillValid ? tokens.idToken : null;
        }

        const now = Date.now();
        const isExpired = tokens.expiresAt < now;
        const isExpiringSoon = tokens.expiresAt < now + 300000;

        if (isExpired) {
            PopupLogger.log('Firebase', 'Token has expired, attempting refresh...');
        } else if (isExpiringSoon) {
            PopupLogger.log('Firebase', 'Token expiring soon, refreshing...');
        }

        if (isExpiringSoon) {
            try {
                const newTokens = await refreshToken(tokens.refreshToken);
                return newTokens.idToken;
            } catch (error) {
                PopupLogger.error('Firebase', `Refresh failed (${error?.permanent ? 'permanent' : 'transient'}):`, error.message);
                // Permanent failure (revoked refresh token) → sign out, can't recover.
                if (error?.permanent) {
                    await signOut();
                    return null;
                }
                // Transient failure (network/server). Use the existing token
                // if it's still valid; otherwise return null so caller falls
                // back gracefully without wiping the session.
                if (!isExpired) {
                    PopupLogger.warn('Firebase', 'Using existing token despite transient refresh failure');
                    return tokens.idToken;
                }
                PopupLogger.warn('Firebase', 'Token expired and refresh transiently failed — keeping session, returning null for this call');
                return null;
            }
        }

        return tokens.idToken;
    }

    async function signOut() {
        await chrome.storage.local.remove([STORAGE_KEYS.USER, STORAGE_KEYS.TOKENS]);
        currentUser = null;
        // Task 9: popup-side cleanup. Cancel local retry alarm and notify
        // the SW so it cancels its own. The SW handler is best-effort —
        // failure here doesn't block the sign-out flow.
        try { chrome.alarms?.clear?.(AUTH_REFRESH_RETRY_ALARM); } catch {}
        try {
            chrome.runtime.sendMessage({ type: 'SIGNED_OUT' }, () => { void chrome.runtime.lastError; });
        } catch { /* SW unreachable — alarms still cleared inside SW on next boot via boot-state hydrate */ }
        notifyAuthStateListeners(null);
    }

    function onAuthStateChanged(callback) {
        authStateListeners.push(callback);
        callback(currentUser);
        return () => {
            authStateListeners = authStateListeners.filter(l => l !== callback);
        };
    }

    function notifyAuthStateListeners(user) {
        authStateListeners.forEach(callback => callback(user));
    }

    async function getDocument(collection, docId, optionsOrRetry = 0) {
        // Backward-compat: legacy callers pass a numeric retryCount as the
        // 3rd arg. New callers pass an options object: { mask: ['field1'], retryCount: 0 }.
        const opts = (typeof optionsOrRetry === 'object' && optionsOrRetry !== null)
            ? optionsOrRetry
            : { retryCount: optionsOrRetry || 0 };
        const retryCount = Number(opts.retryCount) || 0;
        const mask = Array.isArray(opts.mask) ? opts.mask.filter(Boolean) : null;

        const idToken = await getIdToken();
        if (!idToken) {
            (window.PopupLogger || console).warn?.('Firebase', `getDocument(${collection}/${docId}) — no idToken available`);
            return null;
        }

        let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
        if (mask && mask.length > 0) {
            // Task 6: tiny field-mask GET (e.g. ['lastUpdated']). Used to
            // revalidate the popup's cached cloud doc with a ~140-byte read
            // instead of fetching the entire library on every popup open.
            url += '?' + mask.map((f) => `mask.fieldPaths=${encodeURIComponent(f)}`).join('&');
        }

        try {
            const response = await fetchWithTimeout(url, {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });

            if (!response.ok) {
                if (response.status === 404) {
                    (window.PopupLogger || console).log?.('Firebase', `Document ${collection}/${docId.slice(0, 8)}… not found (404)`);
                    return null;
                }

                if (response.status >= 500 && retryCount < 3) {
                    const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
                    (window.PopupLogger || console).warn?.('Firebase', `Server error ${response.status}, retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return getDocument(collection, docId, { ...opts, retryCount: retryCount + 1 });
                }

                // 401/403: surface as a real error so loadAndSyncData can
                // show a clear "permission denied" status to the user
                // instead of silently treating it as "no cloud doc".
                const errorBody = await response.text().catch(() => '');
                (window.PopupLogger || console).error?.('Firebase',
                    `getDocument(${collection}/${docId.slice(0, 8)}…) HTTP ${response.status}: ${errorBody.slice(0, 200)}`);
                const err = new Error(`Firestore error: ${response.status}`);
                err.status = response.status;
                err.body = errorBody;
                throw err;
            }

            const data = await response.json();
            return firestoreDocToJson(data);
        } catch (error) {
            if (error.name === 'TypeError' && retryCount < 3) {
                const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
                (window.PopupLogger || console).warn?.('Firebase', 'Network error, retrying in', delay, 'ms...');
                await new Promise(resolve => setTimeout(resolve, delay));
                return getDocument(collection, docId, { ...opts, retryCount: retryCount + 1 });
            }

            // Network errors (TypeError after retries exhausted) → return null
            // so callers can fall back to local data. Auth errors (already
            // thrown above with a status code) propagate to the caller.
            if (error.status) throw error;

            (window.PopupLogger || console).error?.('Firebase', `getDocument(${collection}/${docId.slice(0, 8)}…) network error:`, error.message);
            return null;
        }
    }

    async function setDocument(collection, docId, data, options = {}) {
        const idToken = await getIdToken();
        if (!idToken) {
            const err = new Error('No auth token');
            err.code = 'NO_AUTH';
            throw err;
        }

        let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
        if (Array.isArray(options.fields) && options.fields.length > 0) {
            const mask = options.fields.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
            url += `?${mask}`;
        }

        const body = JSON.stringify({ fields: jsonToFirestoreFields(data) });
        const useKeepalive = !!options.keepalive && body.length < 63000;

        const response = await fetchWithTimeout(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            },
            body,
            keepalive: useKeepalive
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            const err = new Error(`Firestore set error: ${response.status}`);
            err.status = response.status;
            err.body = errorText;
            throw err;
        }

        return true;
    }

    // Firestore JSON codec lives in src/common/firestore-codec.js — single
    // source of truth shared with background.js and the content script.
    // Loaded before this file via popup.html. Thin local aliases keep the
    // existing call sites in this module unchanged.
    const _fsCodec = (typeof window !== 'undefined' && window.AnimeTrackerFirestoreCodec) || null;
    if (!_fsCodec) {
        console.error('[FirebaseLib] Firestore codec not loaded — sync disabled');
    }
    const firestoreDocToJson = (doc) => {
        if (!_fsCodec || !doc?.fields) return {};
        return _fsCodec.decodeFields(doc.fields);
    };
    const jsonToFirestoreFields = (obj) => _fsCodec ? _fsCodec.encodeFields(obj) : {};

    // ── Email/Password auth ──────────────────────────────────────────────
    // All four endpoints share the same response shape (localId/email/idToken/
    // refreshToken/expiresIn) and the same auth side-effects: persist user +
    // tokens, fire the auth-state listeners. Identity Toolkit error responses
    // come back with HTTP 4xx + `{ error: { message: 'CODE' } }`; we surface
    // `error.message` so the popup layer can map known codes to friendly
    // strings without the network response leaking through.

    async function _identityToolkitPost(path, body) {
        const url = `https://identitytoolkit.googleapis.com/v1/${path}?key=${API_KEY}`;
        let response, data;
        try {
            response = await fetchWithTimeout(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            data = await response.json().catch(() => null);
        } catch (networkError) {
            throw new Error('Network error. Please check your connection.');
        }
        if (!data) {
            throw new Error('Empty/invalid response from auth endpoint');
        }
        if (data.error) {
            const msg = data.error?.message || 'Authentication failed';
            throw new Error(msg);
        }
        return data;
    }

    async function _persistEmailPasswordSession(data) {
        // Identity Toolkit's signInWithPassword response doesn't include
        // photoURL or rich displayName — those live in providerUserInfo,
        // which we need a follow-up `accounts:lookup` call to get. This is
        // critical for accounts that have BOTH password and Google providers
        // linked (the desktop "set password for mobile" flow): without the
        // lookup, the mobile UI shows a default avatar even though the same
        // uid has a Google avatar set.
        let displayName = data.displayName || (data.email || '').split('@')[0];
        let photoURL = null;
        let providerIds = [];

        try {
            const lookup = await _identityToolkitPost('accounts:lookup', {
                idToken: data.idToken
            });
            const userInfo = lookup?.users?.[0];
            if (userInfo) {
                providerIds = (userInfo.providerUserInfo || []).map(p => p.providerId);
                // Prefer Google provider's photo + name when present (richer
                // info than the password provider). Fall back to whatever
                // the lookup gives us at the top level.
                const google = (userInfo.providerUserInfo || []).find(p => p.providerId === 'google.com');
                photoURL = google?.photoUrl || userInfo.photoUrl || null;
                if (google?.displayName) displayName = google.displayName;
                else if (userInfo.displayName) displayName = userInfo.displayName;
            }
        } catch (lookupErr) {
            // Lookup failure isn't fatal — sign-in still succeeded. Just log
            // and use the basic info from signInWithPassword.
            PopupLogger.warn('Firebase', `accounts:lookup failed (non-fatal): ${lookupErr?.message}`);
        }

        const user = {
            uid: data.localId,
            email: data.email,
            displayName,
            photoURL,
            providers: providerIds,
            signedInVia: 'password'
        };
        const tokens = {
            idToken: data.idToken,
            refreshToken: data.refreshToken,
            expiresAt: Date.now() + (parseInt(data.expiresIn) * 1000)
        };
        await chrome.storage.local.set({
            [STORAGE_KEYS.USER]: user,
            [STORAGE_KEYS.TOKENS]: tokens
        });
        currentUser = user;

        // Diagnostic log: lets the user see in DevTools whether they signed
        // into the SAME account as Google (multi-provider) or a standalone
        // password-only account (which would explain an empty library).
        if (providerIds.length > 0) {
            PopupLogger.log('Firebase',
                `Signed in as ${data.email} (uid=${data.localId.slice(0, 8)}…) · providers: ${providerIds.join(', ')}`);
            if (!providerIds.includes('google.com')) {
                PopupLogger.warn('Firebase',
                    'This account is password-only (not linked to Google). ' +
                    'If you expected your Google library here, you may have signed up with a separate password account. ' +
                    'Sign out, then on desktop go to Settings → "Set password for mobile" with the same email.');
            }
        }

        notifyAuthStateListeners(currentUser);
        return user;
    }

    async function signInWithEmailPassword(email, password) {
        if (!email || !password) throw new Error('MISSING_EMAIL');
        const data = await _identityToolkitPost('accounts:signInWithPassword', {
            email,
            password,
            returnSecureToken: true
        });
        if (!data.idToken || !data.refreshToken || !data.expiresIn || !data.localId) {
            throw new Error('Unexpected response from sign-in endpoint');
        }
        PopupLogger.log('Firebase', `Email sign-in successful for ${data.email}`);
        return _persistEmailPasswordSession(data);
    }

    async function signUpWithEmailPassword(email, password) {
        if (!email || !password) throw new Error('MISSING_EMAIL');
        const data = await _identityToolkitPost('accounts:signUp', {
            email,
            password,
            returnSecureToken: true
        });
        if (!data.idToken || !data.refreshToken || !data.expiresIn || !data.localId) {
            throw new Error('Unexpected response from sign-up endpoint');
        }
        PopupLogger.log('Firebase', `Account created for ${data.email}`);
        return _persistEmailPasswordSession(data);
    }

    async function setPasswordForCurrentUser(password) {
        if (!password || password.length < 6) throw new Error('WEAK_PASSWORD');
        const idToken = await getIdToken();
        if (!idToken) {
            const err = new Error('Not signed in');
            err.code = 'NO_AUTH';
            throw err;
        }
        // accounts:update with `password` links the password provider to the
        // existing account (Google) without changing the uid. Returns a fresh
        // idToken/refreshToken that MUST be persisted — the old token may be
        // revoked after a credential change.
        const data = await _identityToolkitPost('accounts:update', {
            idToken,
            password,
            returnSecureToken: true
        });

        // Verify the password provider was actually linked. Identity Toolkit
        // returns providerUserInfo listing all linked providers. If
        // password/email is absent the link silently failed (e.g. Email/Password
        // provider is disabled in the Firebase console).
        const providers = (data.providerUserInfo || []).map(p => p.providerId);
        if (!providers.includes('password')) {
            throw new Error(
                'OPERATION_NOT_ALLOWED: Email/password sign-in is not enabled for this project. ' +
                'Enable it in Firebase Console → Authentication → Sign-in methods.'
            );
        }

        if (data.idToken && data.refreshToken && data.expiresIn) {
            const tokens = {
                idToken: data.idToken,
                refreshToken: data.refreshToken,
                expiresAt: Date.now() + (parseInt(data.expiresIn) * 1000)
            };
            await chrome.storage.local.set({ [STORAGE_KEYS.TOKENS]: tokens });
        }
        PopupLogger.log('Firebase', `Password linked. Providers: ${providers.join(', ')}`);
        return true;
    }

    /**
     * Task 12: map an Identity Toolkit error code to a user-friendly,
     * privacy-preserving message. Used by sendPasswordReset and surfaced
     * to other reset / sign-in flows that want consistent phrasing.
     *
     * EMAIL_NOT_FOUND is enumeration-resistant: we never tell the user
     * "no such email" because that would let an attacker test which
     * addresses are registered. Instead we show the same "if an account
     * exists, we sent a link" message as a successful reset.
     */
    function mapIdentityToolkitError(code) {
        const upper = String(code || '').split(':')[0].trim().toUpperCase().replace(/\s+/g, '_');
        switch (upper) {
            case 'EMAIL_NOT_FOUND':
                return {
                    friendly: 'If an account exists for that email, a reset link has been sent.',
                    suppressError: true                     // surface as success-shaped UX
                };
            case 'INVALID_EMAIL':
                return { friendly: "That email address doesn't look right.", suppressError: false };
            case 'TOO_MANY_ATTEMPTS_TRY_LATER':
                return { friendly: 'Too many attempts — please try again in a few minutes.', suppressError: false };
            case 'USER_DISABLED':
                return { friendly: 'This account has been disabled. Contact support.', suppressError: false };
            case 'OPERATION_NOT_ALLOWED':
                return { friendly: 'Email/password sign-in is not enabled for this app. Please contact support.', suppressError: false };
            default:
                return { friendly: "Couldn't send the reset email. Please try again.", suppressError: false };
        }
    }

    async function sendPasswordReset(email) {
        if (!email) throw new Error('MISSING_EMAIL');
        try {
            await _identityToolkitPost('accounts:sendOobCode', {
                requestType: 'PASSWORD_RESET',
                email
            });
            PopupLogger.log('Firebase', `Password reset request accepted for ${email}`);
            return { ok: true, message: 'If an account exists for that email, a reset link has been sent.' };
        } catch (err) {
            const map = mapIdentityToolkitError(err?.message);
            // Enumeration-resistant: surface the success-shaped message to
            // the UI for EMAIL_NOT_FOUND so attackers can't probe which
            // emails are registered.
            if (map.suppressError) {
                PopupLogger.log('Firebase', `Password reset (treating as success): ${err?.message}`);
                return { ok: true, message: map.friendly };
            }
            const friendlyErr = new Error(map.friendly);
            friendlyErr.code = String(err?.message || '').split(':')[0].trim().toUpperCase().replace(/\s+/g, '_');
            friendlyErr.original = err;
            throw friendlyErr;
        }
    }

    /**
     * Probe an email/password combination against Identity Toolkit *without*
     * touching the stored session. Used by the "Update password" flow to
     * reject silently re-saving the same password — Firebase itself happily
     * accepts an unchanged password and we'd otherwise burn an
     * `accounts:update` round-trip on a no-op.
     *
     * Returns:
     *   true  → credentials valid (i.e. caller's "new" password matches the
     *           current one — the caller should treat this as "no change")
     *   false → credentials rejected (INVALID_PASSWORD / INVALID_LOGIN_CREDENTIALS)
     *           which is the *expected* path for a genuinely new password
     * Throws on every other error (network, rate-limit, disabled account…)
     * so the caller can decide whether to surface it or continue.
     */
    async function verifyPasswordSilently(email, password) {
        if (!email || !password) return false;
        try {
            await _identityToolkitPost('accounts:signInWithPassword', {
                email,
                password,
                returnSecureToken: false
            });
            return true;
        } catch (err) {
            const code = (err?.message || '').split(':')[0]
                .trim().toUpperCase().replace(/\s+/g, '_');
            if (code === 'INVALID_PASSWORD' || code === 'INVALID_LOGIN_CREDENTIALS') {
                return false;
            }
            // EMAIL_NOT_FOUND on a Google-only account is also "not the same"
            // — there's no password provider linked yet, so any input is
            // genuinely new.
            if (code === 'EMAIL_NOT_FOUND') return false;
            throw err;
        }
    }

    // Task 4: popup-side alarm listener for auth-refresh-retry. Best-effort —
    // the SW alarm runs independently, so this is purely an "if popup is
    // open at the right time, take a stab at re-refreshing" optimisation.
    try {
        chrome.alarms?.onAlarm?.addListener(async (alarm) => {
            if (alarm?.name !== AUTH_REFRESH_RETRY_ALARM) return;
            try {
                const helper = window.AnimeTrackerAuthTokens;
                const t = helper ? await helper.readTokens() : null;
                if (!t || !t.refreshToken || t.needsReauth) return;
                await refreshToken(t.refreshToken).catch(() => {});
            } catch { /* swallow — SW path also retries */ }
        });
    } catch { /* alarms unavailable — SW path covers retries */ }

    return {
        init,
        signInWithGoogle,
        signInWithEmailPassword,
        signUpWithEmailPassword,
        setPasswordForCurrentUser,
        sendPasswordReset,
        verifyPasswordSilently,
        signOut,
        onAuthStateChanged,
        getDocument,
        setDocument,
        // Task 4 additions:
        getIdToken,
        isReauthNeeded,
        // Task 12: callers (settings → reset password UI, sign-in form) can
        // use this for consistent friendly phrasing across all flows.
        mapIdentityToolkitError
    };
})();

if (typeof window !== 'undefined') {
    window.FirebaseLib = FirebaseLib;
}
