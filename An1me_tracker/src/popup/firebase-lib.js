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

    async function signInWithGoogle(options = {}) {
        const { prompt = 'select_account' } = options;
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
            authUrl.searchParams.set('prompt', prompt);

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

                        const session = sessionFromAuthResponse(data, ['google.com'], currentUser);
                        currentUser = session.user;

                        await chrome.storage.local.set({
                            [STORAGE_KEYS.USER]: currentUser,
                            [STORAGE_KEYS.TOKENS]: {
                                idToken: session.idToken,
                                refreshToken: session.refreshToken,
                                expiresAt: session.expiresAt
                            }
                        });

                        notifyAuthStateListeners(currentUser);
                        resolve(session);
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

    async function getIdToken(options = {}) {
        const { forceRefresh = false } = options;
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

        if (forceRefresh) {
            PopupLogger.log('Firebase', 'Forcing token refresh...');
        } else if (isExpired) {
            PopupLogger.log('Firebase', 'Token has expired, attempting refresh...');
        } else if (isExpiringSoon) {
            PopupLogger.log('Firebase', 'Token expiring soon, refreshing...');
        }

        if (forceRefresh || isExpiringSoon) {
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

    function authErrorNeedsRecentLogin(code) {
        return code === 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN'
            || code === 'TOKEN_EXPIRED'
            || code === 'INVALID_ID_TOKEN';
    }

    function providerIdsFromAuthResponse(data) {
        if (!Array.isArray(data?.providerUserInfo)) return [];
        return data.providerUserInfo
            .map((entry) => entry?.providerId)
            .filter(Boolean);
    }

    function userNeedsGoogleReauthForPasswordLink(user) {
        const providers = Array.isArray(user?.providers) ? user.providers : [];
        if (providers.length === 0) return true;
        return providers.includes('google.com') && !providers.includes('password');
    }

    function userHasMobilePassword(user) {
        if (!user) return false;
        if (user.passwordLinkedAt) return true;
        const providers = Array.isArray(user.providers) ? user.providers : [];
        return providers.includes('password');
    }

    function sessionFromAuthResponse(data, defaultProviders = [], previousUser = null) {
        const providers = providerIdsFromAuthResponse(data);
        const mergedProviders = providers.length > 0 ? providers : defaultProviders;
        const hasPasswordProvider = mergedProviders.includes('password');
        const user = {
            uid: data.localId,
            email: data.email,
            displayName: data.displayName || (data.email || '').split('@')[0],
            photoURL: data.photoUrl || data.profilePicture || null,
            providers: mergedProviders,
            passwordLinkedAt: hasPasswordProvider
                ? (previousUser?.passwordLinkedAt || new Date().toISOString())
                : (previousUser?.passwordLinkedAt || null)
        };
        const tokens = {
            idToken: data.idToken,
            refreshToken: data.refreshToken,
            expiresAt: Date.now() + (parseInt(data.expiresIn, 10) * 1000)
        };
        return { user, ...tokens };
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
        if (!idToken) return null;

        const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;

        try {
            const response = await fetchWithTimeout(url, {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });

            if (!response.ok) {
                if (response.status === 404) return null;

                if (response.status >= 500 && retryCount < 3) {
                    const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
                    (window.PopupLogger || console).warn?.('Firebase', `Server error ${response.status}, retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return getDocument(collection, docId, retryCount + 1);
                }

                throw new Error(`Firestore error: ${response.status}`);
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

            (window.PopupLogger || console).error?.('Firebase', 'Get error:', error);
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

    // Turn a raw Firebase Identity Toolkit error code into a message safe to
    // show the user. Unknown codes fall through to the raw string.
    function mapAuthError(code) {
        switch (code) {
            case 'EMAIL_EXISTS': return 'An account with this email already exists.';
            case 'EMAIL_NOT_FOUND': return 'No account found with this email.';
            case 'INVALID_PASSWORD': return 'Incorrect password.';
            case 'INVALID_LOGIN_CREDENTIALS': return 'Incorrect email or password.';
            case 'INVALID_EMAIL': return 'Invalid email address.';
            case 'MISSING_PASSWORD': return 'Please enter your password.';
            case 'USER_DISABLED': return 'This account has been disabled.';
            case 'OPERATION_NOT_ALLOWED': return 'Email/password sign-in is not enabled.';
            case 'TOO_MANY_ATTEMPTS_TRY_LATER': return 'Too many attempts — please try again later.';
            case 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN':
                return 'Could not verify your session. Try again and complete the Google sign-in window.';
            case 'FEDERATED_USER_CANNOT_USE_PASSWORD':
                return 'This account signs in with Google. Use Google on mobile, or create a separate email/password account.';
            default:
                if (typeof code === 'string' && code.startsWith('WEAK_PASSWORD')) {
                    return 'Password must be at least 6 characters.';
                }
                return code || 'Authentication failed.';
        }
    }

    // Persist a fresh session from an Identity Toolkit auth response and
    // notify listeners. Shared by sign-in and sign-up.
    async function persistSession(data) {
        const session = sessionFromAuthResponse(data, ['password'], currentUser);
        currentUser = session.user;
        await chrome.storage.local.set({
            [STORAGE_KEYS.USER]: currentUser,
            [STORAGE_KEYS.TOKENS]: {
                idToken: session.idToken,
                refreshToken: session.refreshToken,
                expiresAt: session.expiresAt
            }
        });
        notifyAuthStateListeners(currentUser);
        return session;
    }

    // action: 'signInWithPassword' (existing user) | 'signUp' (new account).
    async function emailPasswordAuth(action, email, password) {
        const em = String(email || '').trim();
        const pw = String(password || '');
        if (!em) throw new Error('Please enter your email.');
        if (!pw) throw new Error('Please enter your password.');

        let response, data;
        try {
            response = await fetchWithTimeout(
                `https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: em, password: pw, returnSecureToken: true })
                }
            );
            data = await response.json().catch(() => null);
        } catch (networkError) {
            throw new Error('Network error. Please check your connection.');
        }

        if (!data) throw new Error('Empty/invalid sign-in response');
        if (data.error) throw new Error(mapAuthError(data.error?.message));
        if (!data.idToken || !data.refreshToken || !data.expiresIn) {
            throw new Error('Unexpected response from auth endpoint.');
        }

        return persistSession(data);
    }

    function signInWithEmailPassword(email, password) {
        return emailPasswordAuth('signInWithPassword', email, password);
    }

    function signUpWithEmailPassword(email, password) {
        return emailPasswordAuth('signUp', email, password);
    }

    // Adds a password to the CURRENT account (uid unchanged) so a Google-only
    // user can also sign in with email/password — e.g. on mobile where the
    // OAuth flow is unavailable. Returns fresh tokens, which we persist.
    async function setPasswordForCurrentUser(password) {
        const pw = String(password || '');
        if (pw.length < 6) throw new Error('Password must be at least 6 characters.');

        const storedUser = await chrome.storage.local.get([STORAGE_KEYS.USER]);
        const accountUser = currentUser || storedUser[STORAGE_KEYS.USER] || null;
        const accountEmail = accountUser?.email || '';
        if (!accountEmail) {
            throw new Error('Account email is missing. Sign out and sign in again.');
        }

        const postPasswordLink = async (idToken) => {
            const response = await fetchWithTimeout(
                `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        idToken,
                        email: accountEmail,
                        password: pw,
                        returnSecureToken: true
                    })
                }
            );
            const payload = await response.json().catch(() => null);
            if (payload?.error?.message) {
                PopupLogger.warn('Firebase', `accounts:update failed: ${payload.error.message}`);
            }
            return payload;
        };

        const applyLinkResponse = async (data) => {
            if (!data) throw new Error('Empty/invalid response');
            if (data.error) throw new Error(mapAuthError(data.error.message));

            if (!data.idToken || !data.refreshToken || !data.expiresIn) {
                throw new Error('Password was not saved. Please try again.');
            }

            const linkSession = sessionFromAuthResponse(data, accountUser?.providers || [], accountUser);
            const providers = new Set(linkSession.user.providers || []);
            providers.add('password');
            linkSession.user.providers = [...providers];
            if (!linkSession.user.passwordLinkedAt) {
                linkSession.user.passwordLinkedAt = new Date().toISOString();
            }

            const hasPasswordOnServer = providers.has('password')
                || !!data.passwordHash
                || providerIdsFromAuthResponse(data).includes('password');
            if (!hasPasswordOnServer) {
                PopupLogger.warn('Firebase', 'accounts:update returned tokens but no password provider');
            } else {
                PopupLogger.log('Firebase', `Mobile password linked for ${linkSession.user.email}`);
            }

            currentUser = linkSession.user;
            await chrome.storage.local.set({
                [STORAGE_KEYS.USER]: linkSession.user,
                [STORAGE_KEYS.TOKENS]: {
                    idToken: linkSession.idToken,
                    refreshToken: linkSession.refreshToken,
                    expiresAt: linkSession.expiresAt
                }
            });
            notifyAuthStateListeners(currentUser);
            return true;
        };

        const canUseGoogleReauth = !!chrome.identity?.launchWebAuthFlow;
        const needsGoogleReauth = userNeedsGoogleReauthForPasswordLink(accountUser);

        // Sensitive link requires a *recent* Google sign-in. A refresh_token
        // exchange does NOT update auth_time, so never use getIdToken(forceRefresh)
        // after Google OAuth for this call — use the idToken returned by
        // signInWithIdp directly.
        let idToken = null;
        if (needsGoogleReauth && canUseGoogleReauth) {
            PopupLogger.log('Firebase', 'Confirming with Google before linking password...');
            try {
                const session = await signInWithGoogle({ prompt: 'consent' });
                idToken = session?.idToken || null;
            } catch (reauthError) {
                const msg = reauthError?.message || '';
                if (msg.includes('did not approve') || msg.includes('cancelled') || msg.includes('closed')) {
                    throw new Error('Google verification was cancelled. Try again when you are ready.');
                }
                throw reauthError;
            }
        } else {
            idToken = await getIdToken({ forceRefresh: true });
        }

        if (!idToken) throw new Error('You must be signed in to set a password.');

        let data;
        try {
            data = await postPasswordLink(idToken);
        } catch {
            throw new Error('Network error. Please check your connection.');
        }

        if (data?.error && authErrorNeedsRecentLogin(data.error.message) && canUseGoogleReauth) {
            PopupLogger.log('Firebase', 'Retrying password link with fresh Google sign-in...');
            try {
                const session = await signInWithGoogle({ prompt: 'consent' });
                idToken = session?.idToken || null;
            } catch (reauthError) {
                const msg = reauthError?.message || '';
                if (msg.includes('did not approve') || msg.includes('cancelled') || msg.includes('closed')) {
                    throw new Error('Google verification was cancelled. Try again when you are ready.');
                }
                throw reauthError;
            }
            if (!idToken) throw new Error('Google verification failed. Please try again.');
            try {
                data = await postPasswordLink(idToken);
            } catch {
                throw new Error('Network error. Please check your connection.');
            }
        }

        return applyLinkResponse(data);
    }

    async function sendPasswordReset(email) {
        const em = String(email || '').trim();
        if (!em) throw new Error('Please enter your email first.');

        let response, data;
        try {
            response = await fetchWithTimeout(
                `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: em })
                }
            );
            data = await response.json().catch(() => null);
        } catch (networkError) {
            throw new Error('Network error. Please check your connection.');
        }

        if (data && data.error) throw new Error(mapAuthError(data.error?.message));
        return true;
    }

    async function refreshAuthProvidersFromServer() {
        const idToken = await getIdToken();
        if (!idToken || !currentUser) return currentUser;

        let data;
        try {
            const response = await fetchWithTimeout(
                `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ idToken: [idToken] })
                }
            );
            data = await response.json().catch(() => null);
        } catch {
            return currentUser;
        }

        const record = data?.users?.[0];
        if (!record) return currentUser;

        const providers = (record.providerUserInfo || [])
            .map((entry) => entry?.providerId)
            .filter(Boolean);
        if (!providers.length) return currentUser;

        const updated = {
            ...currentUser,
            email: record.email || currentUser.email,
            providers,
            passwordLinkedAt: providers.includes('password')
                ? (currentUser.passwordLinkedAt || new Date().toISOString())
                : currentUser.passwordLinkedAt
        };
        currentUser = updated;
        await chrome.storage.local.set({ [STORAGE_KEYS.USER]: updated });
        notifyAuthStateListeners(currentUser);
        return currentUser;
    }

    return {
        init,
        signInWithGoogle,
        signInWithEmailPassword,
        signUpWithEmailPassword,
        setPasswordForCurrentUser,
        sendPasswordReset,
        signOut,
        onAuthStateChanged,
        getDocument,
        setDocument,
        userHasMobilePassword,
        refreshAuthProvidersFromServer
    };
})();

if (typeof window !== 'undefined') {
    window.FirebaseLib = FirebaseLib;
}