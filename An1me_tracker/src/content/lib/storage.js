// storage.js — chrome.storage read/write helpers used from within content scripts.
const CONTENT_LEGACY_SYNC_KEYS = new Set(["animeData", "trackedEpisodes", "videoProgress"]);
const CONTENT_LEGACY_SYNC_MIGRATION_KEY = "legacySyncMigrationV1Complete";
const CONTENT_STORAGE_TIMEOUT_MS = 15000;
const CONTENT_LIBRARY_REQUEST_TIMEOUT_MS = 20000;
const CONTENT_LIBRARY_MUTATION_KEYS = new Set([
  "animeData",
  "videoProgress",
  "deletedAnime",
  "groupCoverImages",
  "fillerStaySelections",
  "skiptimeHelperEnabled",
  "playbackSettingsUpdatedAt",
]);
const CONTENT_LIBRARY_MAX_RETRIES = 6;
let contentLegacySyncMigrationPromise = null;

function contentStorageHasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeContentStorageKeys(keys) {
  if (Array.isArray(keys)) return keys;
  if (typeof keys === "string") return [keys];
  if (keys && typeof keys === "object") return Object.keys(keys);
  return [];
}

function pickContentStorageKeys(source, keys) {
  const picked = {};
  for (const key of keys) {
    if (contentStorageHasOwn(source, key)) picked[key] = source[key];
  }
  return picked;
}

function isContentContextValid() {
  try {
    return Boolean(chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function isBenignContentStorageError(message) {
  const errorMessage = String(message || "");
  return errorMessage.includes("Extension context invalidated") || errorMessage.includes("Cannot access") || !isContentContextValid();
}

function getContentRuntimeErrorMessage() {
  try {
    return chrome.runtime.lastError?.message || "";
  } catch (error) {
    return error?.message || "Extension context invalidated";
  }
}

function contentStorageUnavailable() {
  return { __storageUnavailable: true };
}

function isContentStorageAbort(result) {
  return Boolean(result?.__timedOut || result?.__storageUnavailable);
}

function contentStorageAreaGet(areaName, keys, Logger) {
  return new Promise((resolve, reject) => {
    if (!isContentContextValid()) {
      resolve(contentStorageUnavailable());
      return;
    }

    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      callback();
    };
    const timeoutId = setTimeout(() => {
      finish(() => {
        Logger.warn(`Storage.${areaName}.get() timeout after 15s`);
        resolve({ __timedOut: true });
      });
    }, CONTENT_STORAGE_TIMEOUT_MS);

    try {
      chrome.storage[areaName].get(keys, (result) => {
        const errorMessage = getContentRuntimeErrorMessage();
        if (errorMessage) {
          finish(() => {
            if (isBenignContentStorageError(errorMessage)) {
              resolve(contentStorageUnavailable());
              return;
            }
            reject(new Error(`${areaName} storage read failed: ${errorMessage}`));
          });
          return;
        }

        finish(() => resolve(result || {}));
      });
    } catch (error) {
      finish(() => {
        if (isBenignContentStorageError(error?.message)) {
          resolve(contentStorageUnavailable());
          return;
        }
        reject(error);
      });
    }
  });
}

function contentStorageLocalSet(data) {
  return new Promise((resolve, reject) => {
    if (!isContentContextValid()) {
      reject(new Error("Extension context invalidated"));
      return;
    }

    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      callback();
    };
    const timeoutId = setTimeout(() => {
      finish(() => reject(new Error("Storage.set() timeout after 15s")));
    }, CONTENT_STORAGE_TIMEOUT_MS);

    try {
      chrome.storage.local.set(data, () => {
        const errorMessage = getContentRuntimeErrorMessage();
        if (errorMessage) {
          finish(() => {
            if (isBenignContentStorageError(errorMessage)) {
              reject(new Error(errorMessage || "Extension context invalidated"));
              return;
            }
            reject(new Error(`Local storage write failed: ${errorMessage}`));
          });
          return;
        }

        finish(() => resolve());
      });
    } catch (error) {
      finish(() => {
        if (isBenignContentStorageError(error?.message)) {
          reject(error instanceof Error ? error : new Error("Extension context invalidated"));
          return;
        }
        reject(error);
      });
    }
  });
}

function contentLibraryCoordinatorRequest(message, Logger) {
  return new Promise((resolve, reject) => {
    if (!isContentContextValid()) {
      resolve(contentStorageUnavailable());
      return;
    }

    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      callback();
    };
    const timeoutId = setTimeout(() => {
      finish(() => {
        Logger.warn("Library mutation coordinator timeout after 20s");
        resolve({ __timedOut: true });
      });
    }, CONTENT_LIBRARY_REQUEST_TIMEOUT_MS);

    try {
      chrome.runtime.sendMessage(message, (response) => {
        const errorMessage = getContentRuntimeErrorMessage();
        if (errorMessage) {
          finish(() => {
            if (isBenignContentStorageError(errorMessage)) {
              resolve(contentStorageUnavailable());
              return;
            }
            reject(new Error(`Library mutation coordinator failed: ${errorMessage}`));
          });
          return;
        }
        finish(() => resolve(response || {}));
      });
    } catch (error) {
      finish(() => {
        if (isBenignContentStorageError(error?.message)) {
          resolve(contentStorageUnavailable());
          return;
        }
        reject(error);
      });
    }
  });
}

async function ensureContentLegacySyncMigration(initialLocal, Logger) {
  if (initialLocal?.[CONTENT_LEGACY_SYNC_MIGRATION_KEY] === true || isContentStorageAbort(initialLocal)) {
    return initialLocal;
  }
  if (contentLegacySyncMigrationPromise) return contentLegacySyncMigrationPromise;

  contentLegacySyncMigrationPromise = (async () => {
    const response = await contentLibraryCoordinatorRequest({ type: "LIBRARY_ENSURE_LEGACY_MIGRATION" }, Logger);
    if (isContentStorageAbort(response)) return response;
    if (!response?.success) throw new Error(response?.error || "Legacy storage migration failed");
    return { [CONTENT_LEGACY_SYNC_MIGRATION_KEY]: true };
  })().finally(() => {
    contentLegacySyncMigrationPromise = null;
  });

  return contentLegacySyncMigrationPromise;
}

const ContentStorage = {
  LEGACY_SYNC_KEYS: CONTENT_LEGACY_SYNC_KEYS,
  LEGACY_SYNC_MIGRATION_KEY: CONTENT_LEGACY_SYNC_MIGRATION_KEY,

  isContextValid() {
    return isContentContextValid();
  },

  isAbortResult(result) {
    return isContentStorageAbort(result);
  },

  async get(keys) {
    const { Logger } = window.AnimeTrackerContent;
    const requestedKeys = normalizeContentStorageKeys(keys);
    if (requestedKeys.length === 0) return {};

    const needsLegacyMigration = requestedKeys.some((key) => CONTENT_LEGACY_SYNC_KEYS.has(key));
    const readKeys = needsLegacyMigration
      ? [...new Set([...requestedKeys, CONTENT_LEGACY_SYNC_MIGRATION_KEY, ...CONTENT_LEGACY_SYNC_KEYS])]
      : requestedKeys;
    const localResult = await contentStorageAreaGet("local", readKeys, Logger);
    if (isContentStorageAbort(localResult)) return localResult;

    if (!needsLegacyMigration || localResult[CONTENT_LEGACY_SYNC_MIGRATION_KEY] === true) {
      return pickContentStorageKeys(localResult, requestedKeys);
    }

    const migrationResult = await ensureContentLegacySyncMigration(localResult, Logger);
    if (isContentStorageAbort(migrationResult)) return migrationResult;

    const migratedLocal = await contentStorageAreaGet("local", requestedKeys, Logger);
    return isContentStorageAbort(migratedLocal) ? migratedLocal : pickContentStorageKeys(migratedLocal, requestedKeys);
  },

  async set(data) {
    const writesLegacyData = Object.keys(data || {}).some((key) => CONTENT_LEGACY_SYNC_KEYS.has(key));
    const writesLibraryData = Object.keys(data || {}).some((key) => CONTENT_LIBRARY_MUTATION_KEYS.has(key));
    if (writesLibraryData) {
      const { Logger } = window.AnimeTrackerContent;
      const response = await contentLibraryCoordinatorRequest({ type: "LIBRARY_MUTATION_WRITE", data }, Logger);
      if (isContentStorageAbort(response)) return response;
      if (!response?.success) throw new Error(response?.error || "Library mutation write failed");
      return response;
    }
    if (writesLegacyData) {
      const { Logger } = window.AnimeTrackerContent;
      const migrationState = await contentStorageAreaGet("local", [CONTENT_LEGACY_SYNC_MIGRATION_KEY], Logger);
      if (isContentStorageAbort(migrationState)) return migrationState;
      const migrationResult = await ensureContentLegacySyncMigration(migrationState, Logger);
      if (isContentStorageAbort(migrationResult)) return migrationResult;
    }
    return contentStorageLocalSet(data);
  },

  _mutateQueue: Promise.resolve(),
  // A mutator that returns false signals "nothing changed" — the write is skipped, so
  // no-op mutations don't fire storage.onChanged listeners across the extension.
  async mutate(keys, mutator) {
    const requested = Array.isArray(keys) ? keys : [keys];
    const run = async () => {
      const migrationCheck = await this.get(requested);
      if (isContentStorageAbort(migrationCheck)) return migrationCheck;

      const usesCoordinator = requested.length > 0 && requested.every((key) => CONTENT_LIBRARY_MUTATION_KEYS.has(key));
      if (!usesCoordinator) {
        let result = mutator(migrationCheck);
        if (result && typeof result.then === "function") result = await result;
        if (result === false) return migrationCheck;
        const payload = {};
        for (const key of requested) {
          if (Object.prototype.hasOwnProperty.call(migrationCheck, key)) payload[key] = migrationCheck[key];
        }
        const writeResult = await this.set(payload);
        return isContentStorageAbort(writeResult) ? writeResult : migrationCheck;
      }

      const { Logger } = window.AnimeTrackerContent;
      for (let attempt = 0; attempt < CONTENT_LIBRARY_MAX_RETRIES; attempt += 1) {
        const snapshot = await contentLibraryCoordinatorRequest(
          { type: "LIBRARY_MUTATION_SNAPSHOT", keys: requested },
          Logger,
        );
        if (isContentStorageAbort(snapshot)) return snapshot;
        if (!snapshot?.success) throw new Error(snapshot?.error || "Library mutation snapshot failed");

        const data = snapshot.data || {};
        let result = mutator(data);
        if (result && typeof result.then === "function") result = await result;
        if (result === false) return data;

        const payload = {};
        for (const key of requested) {
          if (Object.prototype.hasOwnProperty.call(data, key)) payload[key] = data[key];
        }
        const response = await contentLibraryCoordinatorRequest(
          {
            type: "LIBRARY_MUTATION_COMMIT",
            expectedRevision: snapshot.revision,
            data: payload,
          },
          Logger,
        );
        if (isContentStorageAbort(response)) return response;
        if (response?.success) return data;
        if (!response?.conflict) throw new Error(response?.error || "Library mutation commit failed");
      }

      throw new Error("Library mutation conflicted too many times");
    };
    const next = this._mutateQueue.then(run, run);
    this._mutateQueue = next.catch(() => {});
    return next;
  },
};

window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.Storage = ContentStorage;
