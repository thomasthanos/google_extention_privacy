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
                    try {
                        await refreshToken(tokens.refreshToken);
                        PopupLogger.log('Firebase', 'Token refreshed successfully');
                    } catch (e) {
                        PopupLogger.warn('Firebase', 'Token refresh failed, signing out:', e.message);
                        await signOut();
                        return null;
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

    async function refreshToken(refreshTokenValue) {
        if (_popupRefreshInflight) return _popupRefreshInflight;

        const inflight = (async () => {
            try {
                if (!refreshTokenValue || typeof refreshTokenValue !== 'string') {
                    throw new Error('Invalid refresh token');
                }

                const response = await fetchWithTimeout(
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

                if (!response.ok) {
                    await response.text();
                    PopupLogger.error('Firebase', 'Token refresh HTTP error:', response.status);
                    throw new Error(`HTTP error: ${response.status}`);
                }

                const data = await response.json().catch(() => null);

                if (!data) {
                    throw new Error('Empty/invalid token refresh response');
                }

                if (data.error) {
                    throw new Error(data.error?.message || 'Token refresh failed');
                }

                if (!data.id_token || !data.refresh_token || !data.expires_in) {
                    const missing = ['id_token', 'refresh_token', 'expires_in'].filter(k => !data[k]);
                    PopupLogger.error('Firebase', 'Invalid token refresh response, missing fields:', missing);
                    throw new Error('Invalid token refresh response');
                }

                const tokens = {
                    idToken: data.id_token,
                    refreshToken: data.refresh_token,
                    expiresAt: Date.now() + (parseInt(data.expires_in) * 1000)
                };

                await chrome.storage.local.set({ [STORAGE_KEYS.TOKENS]: tokens });
                PopupLogger.log('Firebase', `Token refreshed, expires at ${new Date(tokens.expiresAt).toLocaleTimeString()}`);
                return tokens;
            } catch (error) {
                PopupLogger.error('Firebase', 'Token refresh error:', error);
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
                PopupLogger.error('Firebase', 'Failed to refresh token:', error);
                if (isExpired) {
                    await signOut();
                    return null;
                }
                PopupLogger.warn('Firebase', 'Using existing token despite refresh failure');
                return tokens.idToken;
            }
        }

        return tokens.idToken;
    }

    async function signOut() {
        await chrome.storage.local.remove([STORAGE_KEYS.USER, STORAGE_KEYS.TOKENS]);
        currentUser = null;
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

    async function getDocument(collection, docId, retryCount = 0) {
        const idToken = await getIdToken();
        if (!idToken) {
            (window.PopupLogger || console).warn?.('Firebase', `getDocument(${collection}/${docId}) — no idToken available`);
            return null;
        }

        const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;

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
                    return getDocument(collection, docId, retryCount + 1);
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
                return getDocument(collection, docId, retryCount + 1);
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

    async function sendPasswordReset(email) {
        if (!email) throw new Error('MISSING_EMAIL');
        await _identityToolkitPost('accounts:sendOobCode', {
            requestType: 'PASSWORD_RESET',
            email
        });
        PopupLogger.log('Firebase', `Password reset email sent to ${email}`);
        return true;
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
        setDocument
    };
})();

if (typeof window !== 'undefined') {
    window.FirebaseLib = FirebaseLib;
}