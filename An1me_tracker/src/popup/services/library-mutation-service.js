// library-mutation-service.js - revisioned popup library transactions.
(function () {
  "use strict";

  const AT = (window.AnimeTracker = window.AnimeTracker || {});
  const CORE_KEYS = Object.freeze(["animeData", "videoProgress", "deletedAnime", "groupCoverImages"]);
  const COORDINATED_KEYS = Object.freeze([
    ...CORE_KEYS,
    "anilist_media_map",
    "anilist_pushed",
    "anilist_push_schema",
    "fillerStaySelections",
    "goalSettings",
    "badgeUnlocks",
    "badgeEvaluationBaselineV1",
    "badgeNotificationBaselineV1",
    "anilist_auth",
    "anilist_username",
    "copyGuardEnabled",
    "smartNotificationsEnabled",
    "autoSkipFillers",
    "skiptimeHelperEnabled",
    "auto4kServerEnabled",
    "playbackSettingsUpdatedAt",
  ]);
  const COORDINATED_KEY_SET = new Set(COORDINATED_KEYS);
  const MAX_CONFLICT_RETRIES = 6;
  const REQUEST_TIMEOUT_MS = 20000;
  let mutationTail = Promise.resolve();

  class LibraryMutationConflict extends Error {
    constructor(revision) {
      super("Library changed while the mutation was running");
      this.name = "LibraryMutationConflict";
      this.revision = revision;
    }
  }

  function normalizeLabel(label) {
    return String(label || "library")
      .trim()
      .replace(/[^a-z0-9:_-]+/gi, "-")
      .slice(0, 80);
  }

  function sendCoordinatorRequest(message) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("Library mutation coordinator timed out"));
      }, REQUEST_TIMEOUT_MS);

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

  function normalizeKeys(keys) {
    const requested = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : [];
    const normalized = [...new Set(requested.filter((key) => COORDINATED_KEY_SET.has(key)))];
    if (normalized.length === 0) throw new Error("At least one coordinated storage key is required");
    return normalized;
  }

  async function requestSnapshot(keys) {
    const response = await sendCoordinatorRequest({
      type: "LIBRARY_MUTATION_SNAPSHOT",
      keys,
    });
    if (!response?.success) throw new Error(response?.error || "Unable to read library transaction snapshot");
    return response;
  }

  async function queueCloudSync(options, normalizedLabel) {
    const user = AT.FirebaseSync?.getUser?.() || null;
    if (options.sync === false || !user || typeof AT.FirebaseSync?.saveToCloud !== "function") {
      return {
        saved: true,
        cloud: { success: true, skipped: true, reason: user ? "sync_disabled" : "not_authenticated" },
        cloudPromise: null,
      };
    }

    const immediate = options.immediate === true;
    const reason = `popup:mutation:${normalizeLabel(options.label || normalizedLabel)}`;
    const cloudPromise = Promise.resolve()
      .then(() => AT.FirebaseSync.saveToCloud(null, immediate, reason))
      .then((response) => ({ success: true, response }))
      .catch((error) => {
        (window.PopupLogger || console).error?.("LibraryMutation", `${reason} cloud sync failed:`, error);
        return { success: false, error };
      });

    if (options.awaitCloud === true) {
      return { saved: true, cloud: await cloudPromise, cloudPromise };
    }

    void cloudPromise;
    return { saved: true, cloud: { success: true, queued: true }, cloudPromise };
  }

  async function executeWithRetry(normalizedLabel, keys, operation) {
    let lastConflict = null;

    for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt += 1) {
      const snapshotResponse = await requestSnapshot(keys);
      let committed = false;

      try {
        return await operation({
          snapshot: snapshotResponse.data || {},
          revision: snapshotResponse.revision,
          async commit(data, options = {}) {
            if (committed) throw new Error("A library transaction can only commit once");
            if (!data || typeof data !== "object" || Array.isArray(data)) {
              throw new TypeError("Library mutation data must be an object");
            }

            const payload = { ...data };
            if (typeof options.markInternalSave === "function") options.markInternalSave(payload);

            const response = await sendCoordinatorRequest({
              type: "LIBRARY_MUTATION_COMMIT",
              expectedRevision: snapshotResponse.revision,
              data: payload,
              label: options.label || normalizedLabel,
            });
            if (response?.conflict) throw new LibraryMutationConflict(response.revision);
            if (!response?.success) throw new Error(response?.error || "Library mutation commit failed");

            committed = true;
            return queueCloudSync(options, normalizedLabel);
          },
        });
      } catch (error) {
        if (!(error instanceof LibraryMutationConflict)) throw error;
        lastConflict = error;
      }
    }

    throw lastConflict || new Error("Library mutation could not acquire a current revision");
  }

  function enqueueWithKeys(label, keys, operation) {
    if (typeof operation !== "function") {
      return Promise.reject(new TypeError("Library mutation operation must be a function"));
    }

    const normalizedLabel = normalizeLabel(label);
    const normalizedKeys = normalizeKeys(keys);
    const execute = () => executeWithRetry(normalizedLabel, normalizedKeys, operation);
    const result = mutationTail.then(execute, execute);
    mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function enqueue(label, operation) {
    return enqueueWithKeys(label, CORE_KEYS, operation);
  }

  function commit(data, options = {}) {
    return enqueue(options.label || "commit", ({ commit: commitQueued }) => commitQueued(data, options));
  }

  AT.LibraryMutations = Object.freeze({
    enqueue,
    enqueueWithKeys,
    commit,
  });
})();
