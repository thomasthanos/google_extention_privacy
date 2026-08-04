// sync-status-controller.js — the only writer for the popup footer sync status.
(function () {
  "use strict";

  const AT = (window.AnimeTracker = window.AnimeTracker || {});
  const CLOUD_SYNC_PENDING_KEY = "syncState.pendingFlush";
  const CLOUD_PROGRESS_PENDING_KEY = "syncState.pendingProgressFlush";
  const CLOUD_SIDECAR_PENDING_KEY = "syncState.pendingSidecars";
  const CLOUD_SYNC_STATUS_KEY = "syncState.cloudStatus";
  const FIREBASE_TOKENS_KEY = "firebase_tokens";
  const CLOUD_REFRESH_DEBOUNCE_MS = 120;

  const ACTIVITY_PRIORITIES = Object.freeze({
    metadata: 60,
    manual: 70,
  });

  let statusElement = null;
  let textElement = null;
  let getUser = () => null;
  let cloudDescriptor = Object.freeze({ label: "Checking cloud…", tone: "busy", source: "cloud" });
  let refreshTimer = null;
  let refreshInFlight = null;
  let refreshQueued = false;
  let claimExpiryTimer = null;
  let sequence = 0;
  let renderedSignature = "";
  const claims = new Map();

  function normalizeDescriptor(descriptor, source) {
    const label = String(descriptor?.label || "").trim();
    if (!label) return null;
    const tone = ["neutral", "busy", "success", "error"].includes(descriptor?.tone) ? descriptor.tone : "neutral";
    return {
      label,
      tone,
      title: descriptor?.title ? String(descriptor.title) : "",
      source: String(source || descriptor?.source || "cloud"),
    };
  }

  function getVisibleDescriptor() {
    const now = Date.now();
    let selected = null;
    for (const [source, claim] of claims) {
      if (claim.expiresAt && claim.expiresAt <= now) {
        claims.delete(source);
        continue;
      }
      if (!selected || claim.priority > selected.priority || (claim.priority === selected.priority && claim.sequence > selected.sequence)) {
        selected = claim;
      }
    }
    return selected?.descriptor || cloudDescriptor;
  }

  function render() {
    if (!statusElement || !textElement) return;
    const descriptor = getVisibleDescriptor();
    const signature = `${descriptor.source}|${descriptor.tone}|${descriptor.label}|${descriptor.title}`;
    if (signature === renderedSignature) return;

    statusElement.classList.remove("synced", "syncing", "sync-error");
    if (descriptor.tone === "success") statusElement.classList.add("synced");
    else if (descriptor.tone === "busy") statusElement.classList.add("syncing");
    else if (descriptor.tone === "error") statusElement.classList.add("sync-error");

    if (descriptor.title) statusElement.title = descriptor.title;
    else statusElement.removeAttribute("title");
    statusElement.dataset.syncSource = descriptor.source;
    statusElement.dataset.syncTone = descriptor.tone;
    textElement.textContent = descriptor.label;
    renderedSignature = signature;
  }

  function scheduleClaimExpiry() {
    if (claimExpiryTimer) {
      clearTimeout(claimExpiryTimer);
      claimExpiryTimer = null;
    }
    const now = Date.now();
    let nextExpiry = Infinity;
    for (const claim of claims.values()) {
      if (claim.expiresAt && claim.expiresAt > now) nextExpiry = Math.min(nextExpiry, claim.expiresAt);
    }
    if (!Number.isFinite(nextExpiry)) return;
    claimExpiryTimer = setTimeout(() => {
      claimExpiryTimer = null;
      render();
      scheduleClaimExpiry();
    }, Math.max(0, nextExpiry - now) + 5);
  }

  function setActivity(source, descriptor) {
    const normalizedSource = String(source || "activity");
    const normalized = normalizeDescriptor(descriptor, normalizedSource);
    if (!normalized) {
      clearActivity(normalizedSource);
      return;
    }
    claims.set(normalizedSource, {
      descriptor: normalized,
      priority: ACTIVITY_PRIORITIES[normalizedSource] ?? 50,
      expiresAt: 0,
      sequence: ++sequence,
    });
    scheduleClaimExpiry();
    render();
  }

  function clearActivity(source, options = {}) {
    const normalizedSource = String(source || "activity");
    const delayMs = Math.max(0, Number(options.delayMs) || 0);
    const claim = claims.get(normalizedSource);
    if (delayMs > 0 && claim) {
      claim.expiresAt = Date.now() + delayMs;
      scheduleClaimExpiry();
      return;
    }
    if (!claims.delete(normalizedSource)) return;
    scheduleClaimExpiry();
    render();
  }

  function commitCloudDescriptor(descriptor) {
    const normalized = normalizeDescriptor(descriptor, "cloud");
    if (!normalized) return;
    cloudDescriptor = Object.freeze(normalized);
    render();
  }

  function buildCloudDescriptor(stored, user) {
    if (!user?.uid) return { label: "Local Only", tone: "neutral" };

    const tokens = stored?.[FIREBASE_TOKENS_KEY];
    const cloudStatus = stored?.[CLOUD_SYNC_STATUS_KEY];
    const statusMatchesUser = cloudStatus?.uid === user.uid;
    const hasPending =
      !!stored?.[CLOUD_SYNC_PENDING_KEY] ||
      !!stored?.[CLOUD_PROGRESS_PENDING_KEY] ||
      !!stored?.[CLOUD_SIDECAR_PENDING_KEY];

    if (!tokens?.idToken || !tokens?.refreshToken || tokens.needsReauth === true) {
      return { label: "Reconnect Required", tone: "busy" };
    }
    if (!Number(tokens.expiresAt) || Number(tokens.expiresAt) <= Date.now()) {
      return { label: "Cloud Connecting…", tone: "busy" };
    }
    if (statusMatchesUser && cloudStatus.state === "error") {
      return { label: "Sync Error", tone: "error", title: cloudStatus.error || "Cloud sync failed" };
    }
    if (hasPending) return { label: "Sync Pending", tone: "busy" };
    if (statusMatchesUser && cloudStatus.state === "syncing") return { label: "Syncing…", tone: "busy" };
    if (statusMatchesUser && cloudStatus.state === "synced") return { label: "Cloud Synced", tone: "success" };
    return { label: "Cloud Connected", tone: "neutral" };
  }

  async function runCloudRefresh() {
    if (refreshInFlight) {
      refreshQueued = true;
      return refreshInFlight;
    }

    refreshInFlight = (async () => {
      const requestedUser = getUser?.() || null;
      if (!requestedUser?.uid) {
        commitCloudDescriptor({ label: "Local Only", tone: "neutral" });
        return cloudDescriptor;
      }

      try {
        const stored = await chrome.storage.local.get([
          CLOUD_SYNC_PENDING_KEY,
          CLOUD_PROGRESS_PENDING_KEY,
          CLOUD_SIDECAR_PENDING_KEY,
          CLOUD_SYNC_STATUS_KEY,
          FIREBASE_TOKENS_KEY,
        ]);
        if (getUser?.()?.uid !== requestedUser.uid) return cloudDescriptor;
        commitCloudDescriptor(buildCloudDescriptor(stored, requestedUser));
      } catch (error) {
        if (getUser?.()?.uid === requestedUser.uid) {
          commitCloudDescriptor({
            label: "Cloud Status Unknown",
            tone: "busy",
            title: error?.message || "Cloud status could not be read",
          });
        }
      }
      return cloudDescriptor;
    })();

    try {
      return await refreshInFlight;
    } finally {
      refreshInFlight = null;
      if (refreshQueued) {
        refreshQueued = false;
        void runCloudRefresh();
      }
    }
  }

  function refreshCloudStatus(options = {}) {
    const immediate = options.immediate === true;
    if (immediate) {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      return runCloudRefresh();
    }

    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void runCloudRefresh();
    }, Math.max(0, Number(options.debounceMs) || CLOUD_REFRESH_DEBOUNCE_MS));
    return Promise.resolve(cloudDescriptor);
  }

  function init(options = {}) {
    statusElement = options.statusElement || statusElement;
    textElement = options.textElement || textElement;
    if (typeof options.getUser === "function") getUser = options.getUser;
    renderedSignature = "";
    render();
  }

  AT.SyncStatusController = Object.freeze({
    init,
    setActivity,
    clearActivity,
    refreshCloudStatus,
  });
})();
