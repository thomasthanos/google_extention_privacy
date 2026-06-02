const FirebaseLib = (function () {
  "use strict";

  const API_KEY = firebaseConfig.apiKey;
  const PROJECT_ID = firebaseConfig.projectId;

  const OAUTH_CLIENT_ID_LOCAL = '851894443732-st4bqk291b03jf6bscup0eqck2n60gmq.apps.googleusercontent.com';
//   const OAUTH_CLIENT_ID_LOCAL =
//     "851894443732-uncr0msnm21fbrfbagtdd76pmkatui1t.apps.googleusercontent.com";
  const OAUTH_CLIENT_ID_RELEASE =
    "851894443732-uncr0msnm21fbrfbagtdd76pmkatui1t.apps.googleusercontent.com";

  const isLocalDev = !("update_url" in chrome.runtime.getManifest());
  const OAUTH_CLIENT_ID = isLocalDev
    ? OAUTH_CLIENT_ID_LOCAL
    : OAUTH_CLIENT_ID_RELEASE;
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
        const shortUrl = ru.replace(
          /https:\/\/([a-z0-9]+)\.chromiumapp\.org.*/,
          "chrome-extension://$1",
        );
        PopupLogger.log("Firebase", `Extension redirect: ${shortUrl}`);
      }
    } catch {}

    try {
      await window.AnimeTrackerAuthTokens?.migrateTokensIfNeeded?.();
    } catch (e) {
      PopupLogger.warn("Firebase", `Token migration skipped: ${e?.message}`);
    }

    try {
      const stored = await chrome.storage.local.get([
        STORAGE_KEYS.USER,
        STORAGE_KEYS.TOKENS,
      ]);
      if (stored[STORAGE_KEYS.USER] && stored[STORAGE_KEYS.TOKENS]) {
        const tokens = stored[STORAGE_KEYS.TOKENS];

        if (!tokens.refreshToken) {
          PopupLogger.warn(
            "Firebase",
            "Corrupt session (no refreshToken), clearing...",
          );
          await signOut();
          return null;
        }

        if (!tokens.expiresAt || tokens.expiresAt < Date.now() + 300000) {
          if (tokens.needsReauth) {
            PopupLogger.warn(
              "Firebase",
              "needsReauth is set — skipping auto-refresh, surfacing reconnect prompt",
            );
            currentUser = stored[STORAGE_KEYS.USER];
            notifyAuthStateListeners(currentUser);
            return currentUser;
          }
          try {
            await refreshToken(tokens.refreshToken);
            PopupLogger.log("Firebase", "Token refreshed successfully");
          } catch (e) {
            if (e?.permanent) {
              PopupLogger.warn(
                "Firebase",
                `Refresh token rejected (permanent: ${e.message}) — signing out`,
              );
              await signOut();
              return null;
            }

            const stillValid =
              tokens.expiresAt && tokens.expiresAt > Date.now() + 30000;
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
        reject(
          new Error(
            "Google sign-in is not supported on this browser. Please use Email/Password login instead.",
          ),
        );
        return;
      }

      authUrl.searchParams.set("client_id", OAUTH_CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", REDIRECT_URL);
      authUrl.searchParams.set("response_type", "token");
      authUrl.searchParams.set("scope", SCOPES);
      authUrl.searchParams.set("prompt", "select_account");

      PopupLogger.log("Firebase", "Starting OAuth flow...");

      chrome.identity.launchWebAuthFlow(
        { url: authUrl.toString(), interactive: true },
        async (redirectUrl) => {
          if (chrome.runtime.lastError) {
            const errMsg = chrome.runtime.lastError.message || "";
            const isCancelled =
              errMsg.includes("did not approve") ||
              errMsg.includes("cancelled") ||
              errMsg.includes("closed") ||
              errMsg.includes("user_cancelled");
            if (!isCancelled) {
              PopupLogger.error(
                "Firebase",
                "Auth error:",
                chrome.runtime.lastError,
              );
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

            const response = await fetchWithTimeout(
              `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${API_KEY}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  postBody: `access_token=${accessToken}&providerId=google.com`,
                  requestUri: getRedirectUrl(),
                  returnIdpCredential: true,
                  returnSecureToken: true,
                }),
              },
            );

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
              expiresAt: Date.now() + parseInt(data.expiresIn) * 1000,
            };

            await chrome.storage.local.set({
              [STORAGE_KEYS.USER]: currentUser,
              [STORAGE_KEYS.TOKENS]: tokens,
            });

            notifyAuthStateListeners(currentUser);
            resolve(currentUser);
          } catch (error) {
            PopupLogger.error("Firebase", "Token exchange error:", error);
            reject(error);
          }
        },
      );
    });
  }

  let _popupRefreshInflight = null;

  const AUTH_REFRESH_RETRY_ALARM = "auth-refresh-retry";
  const AUTH_REFRESH_BACKOFF_MIN = [1, 5, 15, 60, 360];
  const MAX_AUTH_REFRESH_ATTEMPTS = AUTH_REFRESH_BACKOFF_MIN.length;
  const AUTH_OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

  async function _popupOnRefreshTransient(reason) {
    const helper =
      typeof window !== "undefined" ? window.AnimeTrackerAuthTokens : null;
    if (!helper) return;
    const updated = await helper.markAuthRefreshTransientFailure();
    if (!updated) return;
    const attempts = Number(updated.authRefreshAttempts) || 0;
    const lastOk = Number(updated.lastAuthCheck) || 0;
    const offlineFor = lastOk ? Date.now() - lastOk : 0;
    const exceededAttempts = attempts >= MAX_AUTH_REFRESH_ATTEMPTS;
    const exceededGrace = lastOk > 0 && offlineFor > AUTH_OFFLINE_GRACE_MS;

    if (exceededAttempts || exceededGrace) {
      await helper.setNeedsReauth(true);
      PopupLogger.warn(
        "Firebase",
        `needsReauth=true · attempts=${attempts}, offlineFor=${Math.round(offlineFor / 86400000)}d, reason=${reason}`,
      );
      try {
        chrome.alarms?.clear?.(AUTH_REFRESH_RETRY_ALARM);
      } catch {}

      try {
        notifyAuthStateListeners(currentUser);
      } catch {}
      return;
    }
    const idx = Math.min(attempts - 1, AUTH_REFRESH_BACKOFF_MIN.length - 1);
    const delayMin = AUTH_REFRESH_BACKOFF_MIN[idx];
    try {
      chrome.alarms?.create?.(AUTH_REFRESH_RETRY_ALARM, {
        delayInMinutes: delayMin,
      });
      PopupLogger.warn(
        "Firebase",
        `Auth refresh retry scheduled in ${delayMin} min (attempt ${attempts}/${MAX_AUTH_REFRESH_ATTEMPTS}, reason: ${reason})`,
      );
    } catch (e) {
      PopupLogger.warn(
        "Firebase",
        `Could not arm auth-refresh-retry alarm: ${e?.message}`,
      );
    }
  }

  async function isReauthNeeded() {
    const helper =
      typeof window !== "undefined" ? window.AnimeTrackerAuthTokens : null;
    if (!helper) return false;
    const t = await helper.readTokens();
    return !!(t && t.needsReauth);
  }

  function _classifyRefreshError(httpStatus, errorBody) {
    const cl =
      typeof window !== "undefined" && window.AnimeTrackerAuthClassifier;
    if (!cl) {
      return false;
    }
    return cl.classify(httpStatus, errorBody).permanent;
  }

  async function refreshToken(refreshTokenValue) {
    if (_popupRefreshInflight) return _popupRefreshInflight;

    const inflight = (async () => {
      try {
        if (!refreshTokenValue || typeof refreshTokenValue !== "string") {
          const err = new Error("Invalid refresh token");
          err.permanent = true;
          throw err;
        }

        let response;
        try {
          response = await fetchWithTimeout(
            `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                grant_type: "refresh_token",
                refresh_token: refreshTokenValue,
              }),
            },
          );
        } catch (networkErr) {
          const err = new Error(
            `Network error during token refresh: ${networkErr?.message || networkErr}`,
          );
          err.permanent = false;
          err.transient = true;
          throw err;
        }

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          PopupLogger.error(
            "Firebase",
            `Token refresh HTTP ${response.status}: ${body.slice(0, 200)}`,
          );
          const err = new Error(`HTTP ${response.status}`);
          err.status = response.status;
          err.body = body;
          err.permanent = _classifyRefreshError(response.status, body);
          err.transient = !err.permanent;
          throw err;
        }

        const data = await response.json().catch(() => null);

        if (!data) {
          const err = new Error("Empty/invalid token refresh response");
          err.transient = true;
          err.permanent = false;
          throw err;
        }

        if (data.error) {
          const msg = data.error?.message || "Token refresh failed";
          const err = new Error(msg);
          err.permanent = _classifyRefreshError(400, msg);
          err.transient = !err.permanent;
          throw err;
        }

        if (!data.id_token || !data.refresh_token || !data.expires_in) {
          const missing = ["id_token", "refresh_token", "expires_in"].filter(
            (k) => !data[k],
          );
          PopupLogger.error(
            "Firebase",
            "Invalid token refresh response, missing fields:",
            missing,
          );
          const err = new Error("Invalid token refresh response");

          err.transient = true;
          err.permanent = false;
          throw err;
        }

        const tokens = {
          idToken: data.id_token,
          refreshToken: data.refresh_token,
          expiresAt: Date.now() + parseInt(data.expires_in) * 1000,
        };

        const tokensHelper = window.AnimeTrackerAuthTokens;
        if (tokensHelper) {
          await chrome.storage.local.set({
            [STORAGE_KEYS.TOKENS]: { ...tokens, version: 2 },
          });
          await tokensHelper.markAuthCheckOk();
        } else {
          await chrome.storage.local.set({ [STORAGE_KEYS.TOKENS]: tokens });
        }

        try {
          chrome.alarms?.clear?.(AUTH_REFRESH_RETRY_ALARM);
        } catch {}
        PopupLogger.log(
          "Firebase",
          `Token refreshed, expires at ${new Date(tokens.expiresAt).toLocaleTimeString()}`,
        );
        return tokens;
      } catch (error) {
        if (!error.permanent && !error.transient) {
          error.transient = true;
          error.permanent = false;
        }

        if (error.transient) {
          try {
            await _popupOnRefreshTransient(error?.message || "unknown");
          } catch (e2) {
            PopupLogger.warn(
              "Firebase",
              `Backoff bookkeeping failed: ${e2?.message}`,
            );
          }
        }
        PopupLogger.error(
          "Firebase",
          `Token refresh ${error.permanent ? "PERMANENT" : "transient"} error:`,
          error.message,
        );
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
      PopupLogger.log("Firebase", "No tokens found in storage");
      return null;
    }

    if (!tokens.idToken || !tokens.refreshToken || !tokens.expiresAt) {
      const missing = ["idToken", "refreshToken", "expiresAt"].filter(
        (k) => !tokens[k],
      );
      PopupLogger.error(
        "Firebase",
        "Invalid tokens structure, missing fields:",
        missing,
      );
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
        PopupLogger.error(
          "Firebase",
          `Refresh failed (${error?.permanent ? "permanent" : "transient"}):`,
          error.message,
        );

        if (error?.permanent) {
          await signOut();
          return null;
        }

        if (!isExpired) {
          PopupLogger.warn(
            "Firebase",
            "Using existing token despite transient refresh failure",
          );
          return tokens.idToken;
        }
        PopupLogger.warn(
          "Firebase",
          "Token expired and refresh transiently failed — keeping session, returning null for this call",
        );
        return null;
      }
    }

    return tokens.idToken;
  }

  async function signOut() {
    await chrome.storage.local.remove([STORAGE_KEYS.USER, STORAGE_KEYS.TOKENS]);
    currentUser = null;

    try {
      chrome.alarms?.clear?.(AUTH_REFRESH_RETRY_ALARM);
    } catch {}
    try {
      chrome.runtime.sendMessage({ type: "SIGNED_OUT" }, () => {
        void chrome.runtime.lastError;
      });
    } catch {}
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
    authStateListeners.forEach((callback) => callback(user));
  }

  async function getDocument(collection, docId, optionsOrRetry = 0) {
    const opts =
      typeof optionsOrRetry === "object" && optionsOrRetry !== null
        ? optionsOrRetry
        : { retryCount: optionsOrRetry || 0 };
    const retryCount = Number(opts.retryCount) || 0;
    const mask = Array.isArray(opts.mask) ? opts.mask.filter(Boolean) : null;

    const idToken = await getIdToken();
    if (!idToken) {
      (window.PopupLogger || console).warn?.(
        "Firebase",
        `getDocument(${collection}/${docId}) — no idToken available`,
      );
      return null;
    }

    let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
    if (mask && mask.length > 0) {
      url +=
        "?" +
        mask.map((f) => `mask.fieldPaths=${encodeURIComponent(f)}`).join("&");
    }

    try {
      const response = await fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (!response.ok) {
        if (response.status === 404) {
          (window.PopupLogger || console).log?.(
            "Firebase",
            `Document ${collection}/${docId.slice(0, 8)}… not found (404)`,
          );
          return null;
        }

        if (response.status >= 500 && retryCount < 3) {
          const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
          (window.PopupLogger || console).warn?.(
            "Firebase",
            `Server error ${response.status}, retrying in ${delay}ms...`,
          );
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
        (window.PopupLogger || console).warn?.(
          "Firebase",
          "Network error, retrying in",
          delay,
          "ms...",
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return getDocument(collection, docId, {
          ...opts,
          retryCount: retryCount + 1,
        });
      }

      if (error.status) throw error;

      (window.PopupLogger || console).error?.(
        "Firebase",
        `getDocument(${collection}/${docId.slice(0, 8)}…) network error:`,
        error.message,
      );
      return null;
    }
  }

  async function setDocument(collection, docId, data, options = {}) {
    const idToken = await getIdToken();
    if (!idToken) {
      const err = new Error("No auth token");
      err.code = "NO_AUTH";
      throw err;
    }

    let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
    if (Array.isArray(options.fields) && options.fields.length > 0) {
      const mask = options.fields
        .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
        .join("&");
      url += `?${mask}`;
    }

    const body = JSON.stringify({ fields: jsonToFirestoreFields(data) });
    const useKeepalive = !!options.keepalive && body.length < 63000;

    const response = await fetchWithTimeout(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body,
      keepalive: useKeepalive,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const err = new Error(`Firestore set error: ${response.status}`);
      err.status = response.status;
      err.body = errorText;
      throw err;
    }

    return true;
  }

  const _fsCodec =
    (typeof window !== "undefined" && window.AnimeTrackerFirestoreCodec) ||
    null;
  if (!_fsCodec) {
    console.error("[FirebaseLib] Firestore codec not loaded — sync disabled");
  }
  const firestoreDocToJson = (doc) => {
    if (!_fsCodec || !doc?.fields) return {};
    return _fsCodec.decodeFields(doc.fields);
  };
  const jsonToFirestoreFields = (obj) =>
    _fsCodec ? _fsCodec.encodeFields(obj) : {};

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
        providerIds = (userInfo.providerUserInfo || []).map(
          (p) => p.providerId,
        );

        const google = (userInfo.providerUserInfo || []).find(
          (p) => p.providerId === "google.com",
        );
        photoURL = google?.photoUrl || userInfo.photoUrl || null;
        if (google?.displayName) displayName = google.displayName;
        else if (userInfo.displayName) displayName = userInfo.displayName;
      }
    } catch (lookupErr) {
      PopupLogger.warn(
        "Firebase",
        `accounts:lookup failed (non-fatal): ${lookupErr?.message}`,
      );
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
      expiresAt: Date.now() + parseInt(data.expiresIn) * 1000,
    };
    await chrome.storage.local.set({
      [STORAGE_KEYS.USER]: user,
      [STORAGE_KEYS.TOKENS]: tokens,
    });
    currentUser = user;

    if (providerIds.length > 0) {
      PopupLogger.log(
        "Firebase",
        `Signed in as ${data.email} (uid=${data.localId.slice(0, 8)}…) · providers: ${providerIds.join(", ")}`,
      );
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
    if (
      !data.idToken ||
      !data.refreshToken ||
      !data.expiresIn ||
      !data.localId
    ) {
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
    if (
      !data.idToken ||
      !data.refreshToken ||
      !data.expiresIn ||
      !data.localId
    ) {
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
        expiresAt: Date.now() + parseInt(data.expiresIn) * 1000,
      };
      await chrome.storage.local.set({ [STORAGE_KEYS.TOKENS]: tokens });
    }
    PopupLogger.log(
      "Firebase",
      `Password linked. Providers: ${providers.join(", ")}`,
    );
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
          friendly:
            "If an account exists for that email, a reset link has been sent.",
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
          friendly:
            "Email/password sign-in is not enabled for this app. Please contact support.",
          suppressError: false,
        };
      default:
        return {
          friendly: "Couldn't send the reset email. Please try again.",
          suppressError: false,
        };
    }
  }

  async function sendPasswordReset(email) {
    if (!email) throw new Error("MISSING_EMAIL");
    try {
      await _identityToolkitPost("accounts:sendOobCode", {
        requestType: "PASSWORD_RESET",
        email,
      });
      PopupLogger.log(
        "Firebase",
        `Password reset request accepted for ${email}`,
      );
      return {
        ok: true,
        message:
          "If an account exists for that email, a reset link has been sent.",
      };
    } catch (err) {
      const map = mapIdentityToolkitError(err?.message);

      if (map.suppressError) {
        PopupLogger.log(
          "Firebase",
          `Password reset (treating as success): ${err?.message}`,
        );
        return { ok: true, message: map.friendly };
      }
      const friendlyErr = new Error(map.friendly);
      friendlyErr.code = String(err?.message || "")
        .split(":")[0]
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "_");
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
      const code = (err?.message || "")
        .split(":")[0]
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "_");
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
        await refreshToken(t.refreshToken).catch(() => {});
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
    setDocument,

    getIdToken,
    isReauthNeeded,

    mapIdentityToolkitError,
  };
})();

if (typeof window !== "undefined") {
  window.FirebaseLib = FirebaseLib;
}
