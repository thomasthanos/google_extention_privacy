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

                        const response = await fetch(
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

                        const data = await response.json();

                        if (data.error) {
                            reject(new Error(data.error.message));
                            return;
                        }

                        currentUser = {
                            uid: data.localId,
                            email: data.email,
                            displayName: data.displayName || data.email.split('@')[0],
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

    async function refreshToken(refreshTokenValue) {
        try {
            if (!refreshTokenValue || typeof refreshTokenValue !== 'string') {
                throw new Error('Invalid refresh token');
            }

            const response = await fetch(
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

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error.message || 'Token refresh failed');
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
        if (!idToken) return null;

        const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;

        try {
            const response = await fetch(url, {
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

        const response = await fetch(url, {
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

    function firestoreDocToJson(doc) {
        if (!doc.fields) return {};
        const result = {};
        for (const [key, value] of Object.entries(doc.fields)) {
            result[key] = firestoreValueToJson(value);
        }
        return result;
    }

    function firestoreValueToJson(value) {
        if (value.stringValue !== undefined) return value.stringValue;
        if (value.integerValue !== undefined) return parseInt(value.integerValue);
        if (value.doubleValue !== undefined) return value.doubleValue;
        if (value.booleanValue !== undefined) return value.booleanValue;
        if (value.nullValue !== undefined) return null;
        if (value.timestampValue !== undefined) return value.timestampValue;
        if (value.arrayValue !== undefined) {
            return (value.arrayValue.values || []).map(firestoreValueToJson);
        }
        if (value.mapValue !== undefined) {
            return firestoreDocToJson(value.mapValue);
        }
        return null;
    }

    function jsonToFirestoreFields(obj) {
        const fields = {};
        for (const [key, value] of Object.entries(obj)) {
            fields[key] = jsonToFirestoreValue(value);
        }
        return fields;
    }

    function jsonToFirestoreValue(value) {
        if (value === null || value === undefined) return { nullValue: null };
        if (typeof value === 'string') return { stringValue: value };
        if (typeof value === 'number') {
            if (Number.isInteger(value)) return { integerValue: value.toString() };
            return { doubleValue: value };
        }
        if (typeof value === 'boolean') return { booleanValue: value };
        if (Array.isArray(value)) {
            return { arrayValue: { values: value.map(jsonToFirestoreValue) } };
        }
        if (typeof value === 'object') {
            return { mapValue: { fields: jsonToFirestoreFields(value) } };
        }
        return { nullValue: null };
    }

    async function signInWithExportedToken(tokenData) {
        if (!tokenData || !tokenData.user || !tokenData.tokens) throw new Error('Invalid token data');
        if (!tokenData.tokens.refreshToken || typeof tokenData.tokens.refreshToken !== 'string') {
            throw new Error('Invalid or missing refresh token in exported data.');
        }
        if (tokenData.expiresAt && Date.now() > tokenData.expiresAt) {
            throw new Error('Token has expired (valid for 20 minutes). Please export a new token from Chrome.');
        }

        let response, data;
        try {
            response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grant_type: 'refresh_token',
                    refresh_token: tokenData.tokens.refreshToken
                })
            });
            data = await response.json();
        } catch (networkError) {
            throw new Error('Network error during token validation. Please check your connection.');
        }

        if (data.error) throw new Error('Token expired or invalid. Please export a fresh token from Chrome.');
        if (!data.id_token || !data.refresh_token || !data.expires_in) {
            throw new Error('Unexpected response from token endpoint.');
        }

        currentUser = tokenData.user;
        const tokens = {
            idToken: data.id_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + (parseInt(data.expires_in) * 1000)
        };

        await chrome.storage.local.set({
            [STORAGE_KEYS.USER]: currentUser,
            [STORAGE_KEYS.TOKENS]: tokens
        });

        notifyAuthStateListeners(currentUser);
        return currentUser;
    }

    async function exportSessionToken() {
        const stored = await chrome.storage.local.get([STORAGE_KEYS.USER, STORAGE_KEYS.TOKENS]);
        if (!stored[STORAGE_KEYS.USER] || !stored[STORAGE_KEYS.TOKENS]) {
            throw new Error('Not signed in');
        }
        return {
            user: stored[STORAGE_KEYS.USER],
            tokens: { refreshToken: stored[STORAGE_KEYS.TOKENS].refreshToken },
            expiresAt: Date.now() + 20 * 60 * 1000
        };
    }

    return {
        init,
        signInWithGoogle,
        signInWithExportedToken,
        exportSessionToken,
        signOut,
        onAuthStateChanged,
        getDocument,
        setDocument
    };
})();

if (typeof window !== 'undefined') {
    window.FirebaseLib = FirebaseLib;
}