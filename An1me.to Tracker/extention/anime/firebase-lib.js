/**
 * Firebase REST API Library for Chrome Extensions
 * Uses launchWebAuthFlow for cross-browser compatibility (Chrome, Edge, Firefox, etc.)
 */

const FirebaseLib = (function() {
    'use strict';

    const API_KEY = firebaseConfig.apiKey;
    const PROJECT_ID = firebaseConfig.projectId;

    // OAuth config - using Web client for launchWebAuthFlow
    const OAUTH_CLIENT_ID_LOCAL = '851894443732-st4bqk291b03jf6bscup0eqck2n60gmq.apps.googleusercontent.com';
    const OAUTH_CLIENT_ID_RELEASE = '851894443732-uncr0msnm21fbrfbagtdd76pmkatui1t.apps.googleusercontent.com';

    // Detect if running as unpacked extension (local dev) or installed from store
    const isLocalDev = !('update_url' in chrome.runtime.getManifest());
    const OAUTH_CLIENT_ID = isLocalDev ? OAUTH_CLIENT_ID_LOCAL : OAUTH_CLIENT_ID_RELEASE;

    const REDIRECT_URL = chrome.identity.getRedirectURL();
    const SCOPES = ['email', 'profile'].join(' ');

    // Storage keys
    const STORAGE_KEYS = {
        USER: 'firebase_user',
        TOKENS: 'firebase_tokens'
    };

    // Current user state
    let currentUser = null;
    let authStateListeners = [];

    /**
     * Initialize and check for existing session
     */
    async function init() {
        console.log('[Firebase] Redirect URL:', REDIRECT_URL);
        
        try {
            // Check for stored user
            const stored = await chrome.storage.local.get([STORAGE_KEYS.USER, STORAGE_KEYS.TOKENS]);
            if (stored[STORAGE_KEYS.USER] && stored[STORAGE_KEYS.TOKENS]) {
                // Check if token needs refresh (with 5 min buffer)
                const tokens = stored[STORAGE_KEYS.TOKENS];
                if (tokens.expiresAt < Date.now() + 300000) {
                    try {
                        await refreshToken(tokens.refreshToken);
                        console.log('[Firebase] Token refreshed successfully');
                    } catch (e) {
                        console.warn('[Firebase] Token refresh failed:', e.message);
                        // Try to continue with existing token if not completely expired
                        if (tokens.expiresAt < Date.now()) {
                            console.log('[Firebase] Token expired, signing out');
                            // FIX BUG #46: Don't set currentUser if we're signing out
                            await signOut();
                            return null;
                        }
                    }
                }

                // FIX BUG #46: Only set currentUser AFTER successful token validation
                currentUser = stored[STORAGE_KEYS.USER];
                notifyAuthStateListeners(currentUser);
                return currentUser;
            }
        } catch (error) {
            console.error('[Firebase] Init error:', error);
        }
        
        notifyAuthStateListeners(null);
        return null;
    }

    /**
     * Sign in with Google using launchWebAuthFlow (works on all browsers)
     */
    async function signInWithGoogle() {
        return new Promise((resolve, reject) => {
            // Build OAuth URL
            const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
            authUrl.searchParams.set('client_id', OAUTH_CLIENT_ID);
            authUrl.searchParams.set('redirect_uri', REDIRECT_URL);
            authUrl.searchParams.set('response_type', 'token');
            authUrl.searchParams.set('scope', SCOPES);
            authUrl.searchParams.set('prompt', 'select_account');

            console.log('[Firebase] Auth URL:', authUrl.toString());
            console.log('[Firebase] Redirect URL:', REDIRECT_URL);

            chrome.identity.launchWebAuthFlow(
                {
                    url: authUrl.toString(),
                    interactive: true
                },
                async (redirectUrl) => {
                    if (chrome.runtime.lastError) {
                        console.error('[Firebase] Auth error:', chrome.runtime.lastError);
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }

                    if (!redirectUrl) {
                        reject(new Error('No redirect URL received'));
                        return;
                    }

                    console.log('[Firebase] Redirect received:', redirectUrl);

                    try {
                        // Extract access token from URL fragment
                        const url = new URL(redirectUrl);
                        const hashParams = new URLSearchParams(url.hash.substring(1));
                        const accessToken = hashParams.get('access_token');

                        if (!accessToken) {
                            reject(new Error('No access token in response'));
                            return;
                        }

                        // Exchange Google token for Firebase token
                        const response = await fetch(
                            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${API_KEY}`,
                            {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    postBody: `access_token=${accessToken}&providerId=google.com`,
                                    requestUri: REDIRECT_URL,
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

                        // Create user object
                        currentUser = {
                            uid: data.localId,
                            email: data.email,
                            displayName: data.displayName || data.email.split('@')[0],
                            photoURL: data.photoUrl || null
                        };

                        // Store tokens
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
                        console.error('[Firebase] Token exchange error:', error);
                        reject(error);
                    }
                }
            );
        });
    }

    /**
     * Refresh the Firebase token
     * @throws {Error} If refresh fails
     */
    async function refreshToken(refreshTokenValue) {
        try {
            // FIX: Validate refresh token exists
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
                const errorText = await response.text();
                console.error('[Firebase] Token refresh HTTP error:', response.status, errorText);
                throw new Error(`HTTP error: ${response.status}`);
            }

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error.message || 'Token refresh failed');
            }

            // FIX: Validate response data
            if (!data.id_token || !data.refresh_token || !data.expires_in) {
                console.error('[Firebase] Invalid token refresh response:', data);
                throw new Error('Invalid token refresh response');
            }

            const tokens = {
                idToken: data.id_token,
                refreshToken: data.refresh_token,
                expiresAt: Date.now() + (parseInt(data.expires_in) * 1000)
            };

            await chrome.storage.local.set({ [STORAGE_KEYS.TOKENS]: tokens });
            console.log('[Firebase] Token refreshed, expires at:', new Date(tokens.expiresAt));
            return tokens;
        } catch (error) {
            console.error('[Firebase] Token refresh error:', error);
            throw error;
        }
    }

    /**
     * Get current ID token (refreshing if needed)
     * FIX D12: Proper token expiration checking
     */
    async function getIdToken() {
        const stored = await chrome.storage.local.get([STORAGE_KEYS.TOKENS]);
        const tokens = stored[STORAGE_KEYS.TOKENS];

        if (!tokens) {
            console.log('[Firebase] No tokens found in storage');
            return null;
        }

        // FIX: Validate tokens object structure
        if (!tokens.idToken || !tokens.refreshToken || !tokens.expiresAt) {
            console.error('[Firebase] Invalid tokens structure:', tokens);
            // FIX D12: Clear invalid tokens
            await signOut();
            return null;
        }

        // FIX D12: Check if token is already expired (not just about to expire)
        const now = Date.now();
        const isExpired = tokens.expiresAt < now;
        const isExpiringSoon = tokens.expiresAt < now + 300000; // 5 min buffer

        if (isExpired) {
            console.log('[Firebase] Token has expired, attempting refresh...');
        } else if (isExpiringSoon) {
            console.log('[Firebase] Token expiring soon, refreshing...');
        }

        // Refresh if expired or about to expire
        if (isExpiringSoon) {
            try {
                const newTokens = await refreshToken(tokens.refreshToken);
                return newTokens.idToken;
            } catch (error) {
                console.error('[Firebase] Failed to refresh token:', error);

                // FIX D12: If token was already expired, sign out
                // If only expiring soon, try to use existing token
                if (isExpired) {
                    await signOut();
                    return null;
                }

                // Token not expired yet - try using existing token
                console.warn('[Firebase] Using existing token despite refresh failure');
                return tokens.idToken;
            }
        }

        return tokens.idToken;
    }

    /**
     * Sign out
     */
    async function signOut() {
        await chrome.storage.local.remove([STORAGE_KEYS.USER, STORAGE_KEYS.TOKENS]);
        currentUser = null;
        notifyAuthStateListeners(null);
    }

    /**
     * Get current user
     */
    function getCurrentUser() {
        return currentUser;
    }

    /**
     * Add auth state listener
     */
    function onAuthStateChanged(callback) {
        authStateListeners.push(callback);
        callback(currentUser);
        return () => {
            authStateListeners = authStateListeners.filter(l => l !== callback);
        };
    }

    /**
     * Notify all auth state listeners
     */
    function notifyAuthStateListeners(user) {
        authStateListeners.forEach(callback => callback(user));
    }

    // ==================== FIRESTORE OPERATIONS ====================

    /**
     * Get Firestore document
     * FIX BUG #39: Add retry logic for transient errors
     */
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

                // FIX BUG #39: Retry on 5xx errors or network issues
                if (response.status >= 500 && retryCount < 3) {
                    const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
                    console.warn(`[Firestore] Server error ${response.status}, retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return getDocument(collection, docId, retryCount + 1);
                }

                throw new Error(`Firestore error: ${response.status}`);
            }

            const data = await response.json();
            return firestoreDocToJson(data);
        } catch (error) {
            // Retry on network errors
            if (error.name === 'TypeError' && retryCount < 3) {
                const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
                console.warn('[Firestore] Network error, retrying in', delay, 'ms...');
                await new Promise(resolve => setTimeout(resolve, delay));
                return getDocument(collection, docId, retryCount + 1);
            }

            console.error('[Firestore] Get error:', error);
            return null;
        }
    }

    /**
     * Set Firestore document
     */
    async function setDocument(collection, docId, data) {
        const idToken = await getIdToken();
        if (!idToken) return false;

        const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
        
        try {
            const response = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    fields: jsonToFirestoreFields(data)
                })
            });

            if (!response.ok) {
                console.error('[Firestore] Set error:', response.status);
                return false;
            }

            return true;
        } catch (error) {
            console.error('[Firestore] Set error:', error);
            return false;
        }
    }

    /**
     * Convert Firestore document to plain JSON
     */
    function firestoreDocToJson(doc) {
        if (!doc.fields) return {};
        
        const result = {};
        for (const [key, value] of Object.entries(doc.fields)) {
            result[key] = firestoreValueToJson(value);
        }
        return result;
    }

    /**
     * Convert Firestore value to JSON
     */
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

    /**
     * Convert JSON to Firestore fields
     */
    function jsonToFirestoreFields(obj) {
        const fields = {};
        for (const [key, value] of Object.entries(obj)) {
            fields[key] = jsonToFirestoreValue(value);
        }
        return fields;
    }

    /**
     * Convert JSON value to Firestore value
     */
    function jsonToFirestoreValue(value) {
        if (value === null || value === undefined) {
            return { nullValue: null };
        }
        if (typeof value === 'string') {
            return { stringValue: value };
        }
        if (typeof value === 'number') {
            if (Number.isInteger(value)) {
                return { integerValue: value.toString() };
            }
            return { doubleValue: value };
        }
        if (typeof value === 'boolean') {
            return { booleanValue: value };
        }
        if (Array.isArray(value)) {
            return {
                arrayValue: {
                    values: value.map(jsonToFirestoreValue)
                }
            };
        }
        if (typeof value === 'object') {
            return {
                mapValue: {
                    fields: jsonToFirestoreFields(value)
                }
            };
        }
        return { nullValue: null };
    }

    // Public API
    return {
        init,
        signInWithGoogle,
        signOut,
        getCurrentUser,
        onAuthStateChanged,
        getDocument,
        setDocument
    };
})();
