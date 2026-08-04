// firebase-lib.js — Firebase/Firestore auth (Google/email) and cloud sync (FirebaseLib + FirebaseSync).

// Shared by both the FirebaseLib and FirebaseSync closures below — must stay at file scope.
function sendAuthBackgroundRequest(message, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Firebase auth request timed out"));
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(response || null);
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
  });
}

const FirebaseLib = (function () {
  "use strict";

  const API_KEY = firebaseConfig.apiKey;
  const PROJECT_ID = firebaseConfig.projectId;

  const OAUTH_CLIENT_ID_LOCAL = "851894443732-st4bqk291b03jf6bscup0eqck2n60gmq.apps.googleusercontent.com";
  const OAUTH_CLIENT_ID_RELEASE = "851894443732-uncr0msnm21fbrfbagtdd76pmkatui1t.apps.googleusercontent.com";

  const isLocalDev = !("update_url" in chrome.runtime.getManifest());
  const OAUTH_CLIENT_ID = isLocalDev ? OAUTH_CLIENT_ID_LOCAL : OAUTH_CLIENT_ID_RELEASE;
  const SCOPES = ["email", "profile"].join(" ");

  function getRedirectUrl() {
    try {
      return chrome.identity?.getRedirectURL?.() || "";
    } catch {
      return "";
    }
  }

  const STORAGE_KEYS = {
    USER: "firebase_user",
    TOKENS: "firebase_tokens",
  };

  let currentUser = null;
  let authStateListeners = [];
  let authStorageListenerInstalled = false;
  let lastAuthNotificationKey = null;

  function getAuthNotificationKey(user) {
    if (!user) return "signed-out";
    return JSON.stringify([
      user.uid || null,
      user.email || null,
      user.displayName || null,
      user.photoURL || null,
    ]);
  }

  function installAuthStorageListener() {
    if (authStorageListenerInstalled) return;
    authStorageListenerInstalled = true;
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== "local" || !changes[STORAGE_KEYS.USER]) return;
      currentUser = changes[STORAGE_KEYS.USER].newValue || null;
      notifyAuthStateListeners(currentUser);
    });
  }

  async function loadStoredSessionUser() {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.USER, STORAGE_KEYS.TOKENS]);
    return stored[STORAGE_KEYS.USER] && stored[STORAGE_KEYS.TOKENS] ? stored[STORAGE_KEYS.USER] : null;
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    if (options?.keepalive) return fetch(url, options);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url, { ...options, signal: ctrl.signal });
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
    // Headers arrived — clear the main timer so callers that never read the body
    // don't leave a stray abort timer; each body read arms its own timer instead.
    clearTimeout(timer);
    for (const method of ["json", "text"]) {
      const original = response[method].bind(response);
      response[method] = () => {
        const bodyTimer = setTimeout(() => ctrl.abort(), timeoutMs);
        return original().then(
          (value) => {
            clearTimeout(bodyTimer);
            return value;
          },
          (error) => {
            clearTimeout(bodyTimer);
            throw error;
          },
        );
      };
    }
    return response;
  }

  async function init() {
    installAuthStorageListener();
    try {
      const ru = getRedirectUrl();
      if (ru) {
        const shortUrl = ru.replace(/https:\/\/([a-z0-9]+)\.chromiumapp\.org.*/, "chrome-extension://$1");
        PopupLogger.log("Firebase", `Extension redirect: ${shortUrl}`);
      }
    } catch {}

    try {
      await window.AnimeTrackerAuthTokens?.migrateTokensIfNeeded?.();
    } catch (e) {
      PopupLogger.warn("Firebase", `Token migration skipped: ${e?.message}`);
    }

    try {
      const stored = await chrome.storage.local.get([STORAGE_KEYS.USER, STORAGE_KEYS.TOKENS]);
      if (stored[STORAGE_KEYS.USER] && stored[STORAGE_KEYS.TOKENS]) {
        const tokens = stored[STORAGE_KEYS.TOKENS];

        if (!tokens.refreshToken) {
          PopupLogger.warn("Firebase", "Corrupt session (no refreshToken), clearing...");
          await signOut();
          return null;
        }

        if (!tokens.expiresAt || tokens.expiresAt < Date.now() + 300000) {
          if (tokens.needsReauth) {
            PopupLogger.warn("Firebase", "needsReauth is set — skipping auto-refresh, surfacing reconnect prompt");
            currentUser = await loadStoredSessionUser();
            notifyAuthStateListeners(currentUser);
            return currentUser;
          }
          try {
            await refreshToken(tokens.refreshToken);
            PopupLogger.log("Firebase", "Token refreshed successfully");
          } catch (e) {
            if (e?.permanent) {
              PopupLogger.warn("Firebase", `Refresh token rejected (permanent: ${e.message}) — signing out`);
              await signOut();
              return null;
            }

            const stillValid = tokens.expiresAt && tokens.expiresAt > Date.now() + 30000;
            if (stillValid) {
              PopupLogger.warn(
                "Firebase",
                `Token refresh transiently failed (${e.message}). Using existing token (expires ${new Date(tokens.expiresAt).toLocaleTimeString()}); will retry on next call.`,
              );
            } else {
              PopupLogger.warn(
                "Firebase",
                `Token refresh transiently failed (${e.message}) and existing token is expired. Keeping session for retry.`,
              );
              currentUser = await loadStoredSessionUser();
              notifyAuthStateListeners(currentUser);
              return currentUser;
            }
          }
        }

        currentUser = await loadStoredSessionUser();
        notifyAuthStateListeners(currentUser);
        return currentUser;
      }
    } catch (error) {
      PopupLogger.error("Firebase", "Init error:", error);
    }

    notifyAuthStateListeners(null);
    return null;
  }

  async function signInWithGoogle() {
    return new Promise((resolve, reject) => {
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      const REDIRECT_URL = getRedirectUrl();

      if (!REDIRECT_URL || !chrome.identity?.launchWebAuthFlow) {
        reject(new Error("Google sign-in is not supported on this browser. Please use Email/Password login instead."));
        return;
      }

      authUrl.searchParams.set("client_id", OAUTH_CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", REDIRECT_URL);
      authUrl.searchParams.set("response_type", "token");
      authUrl.searchParams.set("scope", SCOPES);
      authUrl.searchParams.set("prompt", "select_account");

      PopupLogger.log("Firebase", "Starting OAuth flow...");

      chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true }, async (redirectUrl) => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message || "";
          const isCancelled =
            errMsg.includes("did not approve") ||
            errMsg.includes("cancelled") ||
            errMsg.includes("closed") ||
            errMsg.includes("user_cancelled");
          if (!isCancelled) {
            PopupLogger.error("Firebase", "Auth error:", chrome.runtime.lastError);
          }
          reject(new Error(errMsg));
          return;
        }

        if (!redirectUrl) {
          reject(new Error("No redirect URL received"));
          return;
        }

        PopupLogger.log("Firebase", "OAuth redirect received");

        try {
          const url = new URL(redirectUrl);
          const hashParams = new URLSearchParams(url.hash.substring(1));
          const accessToken = hashParams.get("access_token");

          if (!accessToken) {
            reject(new Error("No access token in response"));
            return;
          }

          const response = await fetchWithTimeout(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              postBody: `access_token=${accessToken}&providerId=google.com`,
              requestUri: getRedirectUrl(),
              returnIdpCredential: true,
              returnSecureToken: true,
            }),
          });

          const data = await response.json().catch(() => null);

          if (!data) {
            reject(new Error("Empty/invalid OAuth response"));
            return;
          }

          if (data.error) {
            reject(new Error(data.error?.message || "OAuth error"));
            return;
          }

          currentUser = {
            uid: data.localId,
            email: data.email,
            displayName: data.displayName || (data.email || "").split("@")[0],
            photoURL: data.photoUrl || null,
          };

          const tokens = {
            idToken: data.idToken,
            refreshToken: data.refreshToken,
            expiresAt: Date.now() + parseInt(data.expiresIn, 10) * 1000,
          };

          const authStore = window.AnimeTrackerAuthTokens;
          if (!authStore?.replaceSession) throw new Error("Auth storage coordinator unavailable");
          const storedSession = await authStore.replaceSession(currentUser, tokens);
          if (!storedSession?.applied) throw new Error(storedSession?.error || "Could not persist Firebase session");

          notifyAuthStateListeners(currentUser);
          resolve(currentUser);
        } catch (error) {
          PopupLogger.error("Firebase", "Token exchange error:", error);
          reject(error);
        }
      });
    });
  }

  let _popupRefreshInflight = null;

  const AUTH_REFRESH_RETRY_ALARM = "auth-refresh-retry";

  async function isReauthNeeded() {
    const helper = typeof window !== "undefined" ? window.AnimeTrackerAuthTokens : null;
    if (!helper) return false;
    const t = await helper.readTokens();
    return !!(t && t.needsReauth);
  }

  async function refreshToken(refreshTokenValue) {
    if (_popupRefreshInflight) return _popupRefreshInflight;
    if (!refreshTokenValue || typeof refreshTokenValue !== "string") {
      const error = new Error("Invalid refresh token");
      error.permanent = true;
      error.transient = false;
      throw error;
    }

    const inflight = (async () => {
      const response = await sendAuthBackgroundRequest({
        type: "REFRESH_FIREBASE_TOKEN",
        expectedRefreshToken: refreshTokenValue,
      });
      if (response?.tokens?.idToken) return response.tokens;

      const error = new Error(response?.error || "Token refresh failed");
      error.permanent = response?.permanent === true;
      error.transient = !error.permanent;
      throw error;
    })();

    _popupRefreshInflight = inflight;
    const clearInflight = () => {
      if (_popupRefreshInflight === inflight) _popupRefreshInflight = null;
    };
    inflight.then(clearInflight, clearInflight);
    return inflight;
  }

  async function getIdToken() {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.TOKENS]);
    const tokens = stored[STORAGE_KEYS.TOKENS];

    if (!tokens) {
      PopupLogger.log("Firebase", "No tokens found in storage");
      return null;
    }

    if (!tokens.idToken || !tokens.refreshToken || !tokens.expiresAt) {
      const missing = ["idToken", "refreshToken", "expiresAt"].filter((k) => !tokens[k]);
      PopupLogger.error("Firebase", "Invalid tokens structure, missing fields:", missing);
      await signOut();
      return null;
    }

    if (tokens.needsReauth) {
      const stillValid = tokens.expiresAt > Date.now() + 30000;
      return stillValid ? tokens.idToken : null;
    }

    const now = Date.now();
    const isExpired = tokens.expiresAt < now;
    const isExpiringSoon = tokens.expiresAt < now + 300000;

    if (isExpired) {
      PopupLogger.log("Firebase", "Token has expired, attempting refresh...");
    } else if (isExpiringSoon) {
      PopupLogger.log("Firebase", "Token expiring soon, refreshing...");
    }

    if (isExpiringSoon) {
      try {
        const newTokens = await refreshToken(tokens.refreshToken);
        return newTokens.idToken;
      } catch (error) {
        PopupLogger.error("Firebase", `Refresh failed (${error?.permanent ? "permanent" : "transient"}):`, error.message);

        if (error?.permanent) {
          await signOut();
          return null;
        }

        const latest = (await chrome.storage.local.get([STORAGE_KEYS.TOKENS]))[STORAGE_KEYS.TOKENS] || null;
        if (!latest || latest.refreshToken !== tokens.refreshToken) {
          return latest?.expiresAt > Date.now() + 30000 ? latest.idToken : null;
        }
        if (latest.expiresAt > Date.now() + 30000) {
          PopupLogger.warn("Firebase", "Using existing token despite transient refresh failure");
          return latest.idToken;
        }
        PopupLogger.warn("Firebase", "Token expired and refresh transiently failed — keeping session, returning null for this call");
        return null;
      }
    }

    return tokens.idToken;
  }

  async function signOut() {
    const authStore = window.AnimeTrackerAuthTokens;
    if (authStore?.clearSession) {
      await authStore.clearSession();
    } else {
      const response = await sendAuthBackgroundRequest({ type: "AUTH_STATE_MUTATE", operation: "clear_session" });
      if (!response?.success) throw new Error(response?.error || "Could not clear Firebase session");
    }
    currentUser = null;
    currentUser = null;
    notifyAuthStateListeners(null);
  }

  function onAuthStateChanged(callback) {
    authStateListeners.push(callback);
    callback(currentUser);
    return () => {
      authStateListeners = authStateListeners.filter((l) => l !== callback);
    };
  }

  function notifyAuthStateListeners(user) {
    const notificationKey = getAuthNotificationKey(user);
    if (notificationKey === lastAuthNotificationKey) return;
    lastAuthNotificationKey = notificationKey;
    authStateListeners.forEach((callback) => {
      try {
        callback(user);
      } catch (error) {
        PopupLogger.warn("Firebase", `Auth state listener failed: ${error?.message || error}`);
      }
    });
  }

  async function getDocument(collection, docId, optionsOrRetry = 0) {
    const opts = typeof optionsOrRetry === "object" && optionsOrRetry !== null ? optionsOrRetry : { retryCount: optionsOrRetry || 0 };
    const retryCount = Number(opts.retryCount) || 0;
    const mask = Array.isArray(opts.mask) ? opts.mask.filter(Boolean) : null;

    const idToken = await getIdToken();
    if (!idToken) {
      (window.PopupLogger || console).warn?.("Firebase", `getDocument(${collection}/${docId}) — no idToken available`);
      return null;
    }

    let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
    if (mask && mask.length > 0) {
      url += "?" + mask.map((f) => `mask.fieldPaths=${encodeURIComponent(f)}`).join("&");
    }

    try {
      const response = await fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (!response.ok) {
        if (response.status === 404) {
          (window.PopupLogger || console).log?.("Firebase", `Document ${collection}/${docId.slice(0, 8)}… not found (404)`);
          return null;
        }

        if (response.status >= 500 && retryCount < 3) {
          const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
          (window.PopupLogger || console).warn?.("Firebase", `Server error ${response.status}, retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          return getDocument(collection, docId, {
            ...opts,
            retryCount: retryCount + 1,
          });
        }

        const errorBody = await response.text().catch(() => "");
        (window.PopupLogger || console).error?.(
          "Firebase",
          `getDocument(${collection}/${docId.slice(0, 8)}…) HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
        );
        const err = new Error(`Firestore error: ${response.status}`);
        err.status = response.status;
        err.body = errorBody;
        throw err;
      }

      const data = await response.json();
      return firestoreDocToJson(data);
    } catch (error) {
      if (error.name === "TypeError" && retryCount < 3) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
        (window.PopupLogger || console).warn?.("Firebase", "Network error, retrying in", delay, "ms...");
        await new Promise((resolve) => setTimeout(resolve, delay));
        return getDocument(collection, docId, {
          ...opts,
          retryCount: retryCount + 1,
        });
      }

      if (error.status) throw error;

      (window.PopupLogger || console).error?.("Firebase", `getDocument(${collection}/${docId.slice(0, 8)}…) network error:`, error.message);
      return null;
    }
  }

  const _fsCodec = (typeof window !== "undefined" && window.AnimeTrackerFirestoreCodec) || null;
  if (!_fsCodec) {
    console.error("[FirebaseLib] Firestore codec not loaded — sync disabled");
  }
  const firestoreDocToJson = (doc) => {
    if (!_fsCodec || !doc?.fields) return {};
    return _fsCodec.decodeFields(doc.fields);
  };
  async function _identityToolkitPost(path, body) {
    const url = `https://identitytoolkit.googleapis.com/v1/${path}?key=${API_KEY}`;
    let response, data;
    try {
      response = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      data = await response.json().catch(() => null);
    } catch (networkError) {
      throw new Error("Network error. Please check your connection.");
    }
    if (!data) {
      throw new Error("Empty/invalid response from auth endpoint");
    }
    if (data.error) {
      const msg = data.error?.message || "Authentication failed";
      throw new Error(msg);
    }
    return data;
  }

  async function _persistEmailPasswordSession(data) {
    let displayName = data.displayName || (data.email || "").split("@")[0];
    let photoURL = null;
    let providerIds = [];

    try {
      const lookup = await _identityToolkitPost("accounts:lookup", {
        idToken: data.idToken,
      });
      const userInfo = lookup?.users?.[0];
      if (userInfo) {
        providerIds = (userInfo.providerUserInfo || []).map((p) => p.providerId);

        const google = (userInfo.providerUserInfo || []).find((p) => p.providerId === "google.com");
        photoURL = google?.photoUrl || userInfo.photoUrl || null;
        if (google?.displayName) displayName = google.displayName;
        else if (userInfo.displayName) displayName = userInfo.displayName;
      }
    } catch (lookupErr) {
      PopupLogger.warn("Firebase", `accounts:lookup failed (non-fatal): ${lookupErr?.message}`);
    }

    const user = {
      uid: data.localId,
      email: data.email,
      displayName,
      photoURL,
      providers: providerIds,
      signedInVia: "password",
    };
    const tokens = {
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + parseInt(data.expiresIn, 10) * 1000,
    };
    const authStore = window.AnimeTrackerAuthTokens;
    if (!authStore?.replaceSession) throw new Error("Auth storage coordinator unavailable");
    const storedSession = await authStore.replaceSession(user, tokens);
    if (!storedSession?.applied) throw new Error(storedSession?.error || "Could not persist Firebase session");
    currentUser = user;

    if (providerIds.length > 0) {
      PopupLogger.log("Firebase", `Signed in as ${data.email} (uid=${data.localId.slice(0, 8)}…) · providers: ${providerIds.join(", ")}`);
      if (!providerIds.includes("google.com")) {
        PopupLogger.warn(
          "Firebase",
          "This account is password-only (not linked to Google). " +
            "If you expected your Google library here, you may have signed up with a separate password account. " +
            'Sign out, then on desktop go to Settings → "Set password for mobile" with the same email.',
        );
      }
    }

    notifyAuthStateListeners(currentUser);
    return user;
  }

  async function signInWithEmailPassword(email, password) {
    if (!email || !password) throw new Error("MISSING_EMAIL");
    const data = await _identityToolkitPost("accounts:signInWithPassword", {
      email,
      password,
      returnSecureToken: true,
    });
    if (!data.idToken || !data.refreshToken || !data.expiresIn || !data.localId) {
      throw new Error("Unexpected response from sign-in endpoint");
    }
    PopupLogger.log("Firebase", `Email sign-in successful for ${data.email}`);
    return _persistEmailPasswordSession(data);
  }

  async function signUpWithEmailPassword(email, password) {
    if (!email || !password) throw new Error("MISSING_EMAIL");
    const data = await _identityToolkitPost("accounts:signUp", {
      email,
      password,
      returnSecureToken: true,
    });
    if (!data.idToken || !data.refreshToken || !data.expiresIn || !data.localId) {
      throw new Error("Unexpected response from sign-up endpoint");
    }
    PopupLogger.log("Firebase", `Account created for ${data.email}`);
    return _persistEmailPasswordSession(data);
  }

  async function setPasswordForCurrentUser(password) {
    if (!password || password.length < 6) throw new Error("WEAK_PASSWORD");
    const idToken = await getIdToken();
    if (!idToken) {
      const err = new Error("Not signed in");
      err.code = "NO_AUTH";
      throw err;
    }
    const authStore = window.AnimeTrackerAuthTokens;
    const sessionBeforeUpdate = await authStore?.readTokens?.();

    const data = await _identityToolkitPost("accounts:update", {
      idToken,
      password,
      returnSecureToken: true,
    });

    const providers = (data.providerUserInfo || []).map((p) => p.providerId);
    if (!providers.includes("password")) {
      throw new Error(
        "OPERATION_NOT_ALLOWED: Email/password sign-in is not enabled for this project. " +
          "Enable it in Firebase Console → Authentication → Sign-in methods.",
      );
    }

    if (data.idToken && data.refreshToken && data.expiresIn) {
      const tokens = {
        idToken: data.idToken,
        refreshToken: data.refreshToken,
        expiresAt: Date.now() + parseInt(data.expiresIn, 10) * 1000,
      };
      if (!authStore?.replaceTokens) throw new Error("Auth storage coordinator unavailable");
      const replacement = await authStore.replaceTokens(tokens, {
        expectedRefreshToken: sessionBeforeUpdate?.refreshToken || null,
      });
      if (!replacement?.applied) throw new Error("Firebase session changed while setting the password");
    }
    PopupLogger.log("Firebase", `Password linked. Providers: ${providers.join(", ")}`);
    return true;
  }

  function mapIdentityToolkitError(code) {
    const upper = String(code || "")
      .split(":")[0]
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "_");
    switch (upper) {
      case "EMAIL_NOT_FOUND":
        return {
          friendly: "If an account exists for that email, a reset link has been sent.",
          suppressError: true,
        };
      case "INVALID_EMAIL":
        return {
          friendly: "That email address doesn't look right.",
          suppressError: false,
        };
      case "TOO_MANY_ATTEMPTS_TRY_LATER":
        return {
          friendly: "Too many attempts — please try again in a few minutes.",
          suppressError: false,
        };
      case "USER_DISABLED":
        return {
          friendly: "This account has been disabled. Contact support.",
          suppressError: false,
        };
      case "OPERATION_NOT_ALLOWED":
        return {
          friendly: "Email/password sign-in is not enabled for this app. Please contact support.",
          suppressError: false,
        };
      default:
        return {
          friendly: "Couldn't send the reset email. Please try again.",
          suppressError: false,
        };
    }
  }

  // Firebase sends and hosts the whole reset flow — no custom backend, no redirect page.
  async function sendPasswordReset(email) {
    if (!email) throw new Error("MISSING_EMAIL");
    const genericMessage = "If an account exists for that email, a reset link has been sent.";
    try {
      await _identityToolkitPost("accounts:sendOobCode", {
        requestType: "PASSWORD_RESET",
        email,
      });
      PopupLogger.log("Firebase", `Password reset email sent to ${email}`);
      return { ok: true, message: genericMessage };
    } catch (err) {
      const mapped = mapIdentityToolkitError(err?.message);
      if (mapped.suppressError) {
        // Unknown email — stay generic so the form can't be used to enumerate accounts.
        PopupLogger.log("Firebase", "Password reset requested for an unknown email");
        return { ok: true, message: genericMessage };
      }
      PopupLogger.error("Firebase", "Password reset failed:", err);
      const friendlyErr = new Error(mapped.friendly);
      friendlyErr.code = "RESET_FAILED";
      friendlyErr.original = err;
      throw friendlyErr;
    }
  }

  async function verifyPasswordSilently(email, password) {
    if (!email || !password) return false;
    try {
      await _identityToolkitPost("accounts:signInWithPassword", {
        email,
        password,
        returnSecureToken: false,
      });
      return true;
    } catch (err) {
      const code = (err?.message || "").split(":")[0].trim().toUpperCase().replace(/\s+/g, "_");
      if (code === "INVALID_PASSWORD" || code === "INVALID_LOGIN_CREDENTIALS") {
        return false;
      }

      if (code === "EMAIL_NOT_FOUND") return false;
      throw err;
    }
  }

  try {
    chrome.alarms?.onAlarm?.addListener(async (alarm) => {
      if (alarm?.name !== AUTH_REFRESH_RETRY_ALARM) return;
      try {
        const helper = window.AnimeTrackerAuthTokens;
        const t = helper ? await helper.readTokens() : null;
        if (!t || !t.refreshToken || t.needsReauth) return;
        await refreshToken(t.refreshToken).catch((e) => window.__atSwallow("refreshToken", e));
      } catch {}
    });
  } catch {}

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

    getIdToken,
    isReauthNeeded,

    mapIdentityToolkitError,
  };
})();

if (typeof window !== "undefined") {
  window.FirebaseLib = FirebaseLib;
}

/* ───────── merged from firebase-sync.js ───────── */

const FirebaseSync = (function () {
  "use strict";

  let authStateListener = null;

  async function init(callbacks) {
    await FirebaseLib.init();
    authStateListener = FirebaseLib.onAuthStateChanged((user) => {
      FirebaseSync.currentUser = user;
      if (user) {
        if (callbacks.onUserSignedIn) callbacks.onUserSignedIn(user);
      } else {
        if (callbacks.onUserSignedOut) callbacks.onUserSignedOut();
      }
    });
  }

  function cleanup() {
    if (authStateListener) {
      authStateListener();
      authStateListener = null;
    }
  }

  function getUser() {
    return FirebaseSync.currentUser || null;
  }

  async function signInWithGoogle() {
    return await FirebaseLib.signInWithGoogle();
  }

  async function signInWithEmailPassword(email, password) {
    return await FirebaseLib.signInWithEmailPassword(email, password);
  }

  async function signUpWithEmailPassword(email, password) {
    return await FirebaseLib.signUpWithEmailPassword(email, password);
  }

  async function signOut() {
    return await FirebaseLib.signOut();
  }

  async function sendPasswordReset(email) {
    return await FirebaseLib.sendPasswordReset(email);
  }

  async function setPasswordForCurrentUser(password) {
    return await FirebaseLib.setPasswordForCurrentUser(password);
  }

  async function verifyPasswordSilently(email, password) {
    return await FirebaseLib.verifyPasswordSilently(email, password);
  }

  function sendBackgroundRequest(message, timeoutMs = 90000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Cloud sync timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          resolve(response || null);
        });
      } catch (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  async function saveToCloud(data, immediate = false, reason = null) {
    // Local storage is the canonical sync input. The data parameter remains for
    // API compatibility, but the background reads one coherent storage snapshot.
    void data;
    const response = await sendBackgroundRequest({
      type: immediate ? "SYNC_TO_FIREBASE_IMMEDIATE" : "SYNC_TO_FIREBASE",
      waitForCompletion: true,
      reason: reason || (immediate ? "popup:immediate" : "popup:debounced"),
    });

    if (!response?.success) {
      const error = new Error(response?.error || "Cloud sync failed");
      error.code = response?.error || "SYNC_FAILED";
      error.status = response?.status || null;
      throw error;
    }
    return response;
  }

  async function queuePlaybackSettingsSave() {
    const response = await sendBackgroundRequest({ type: "PUSH_STORED_PLAYBACK_SETTINGS" });
    if (!response?.success && !response?.pending) {
      throw new Error(response?.error || "Playback settings cloud sync was not queued");
    }
    return response;
  }

  async function pushAnilistAuthToCloud(auth, username = null, updatedAt = null) {
    const payload = {
      accessToken: auth?.accessToken || null,
      expiresAt: auth?.expiresAt || 0,
      viewer: auth?.viewer || null,
      username: username || null,
      updatedAt: updatedAt || new Date().toISOString(),
    };
    const response = await sendBackgroundRequest({ type: "PUSH_ANILIST_AUTH", anilistAuth: payload });
    if (!response?.success && !response?.pending) {
      throw new Error(response?.error || "AniList auth cloud sync was not queued");
    }
    return response;
  }

  function clearCachedUserDocument() {
    chrome.runtime.sendMessage({ type: "INVALIDATE_BG_CLOUD_DOC_CACHE" });
  }

  return {
    currentUser: null,
    init,
    cleanup,
    getUser,
    signInWithGoogle,
    signInWithEmailPassword,
    signUpWithEmailPassword,
    signOut,
    sendPasswordReset,
    setPasswordForCurrentUser,
    verifyPasswordSilently,
    saveToCloud,
    queuePlaybackSettingsSave,
    pushAnilistAuthToCloud,
    clearCachedUserDocument,
  };
})();

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.FirebaseSync = FirebaseSync;

const AT = (window.AnimeTrackerContent = window.AnimeTrackerContent || {});
AT.FirebaseSync = FirebaseSync;
