/* storage.js — chrome.storage.local wrapper for content scripts
   Hardened against "Extension context invalidated": when the extension is
   reloaded/updated while a Nexus tab is still open, the orphaned content
   script loses access to chrome.* APIs and any call throws synchronously.
   Every access here is guarded so callers get safe fallbacks instead of an
   unhandled promise rejection. */
window.NexusExt = window.NexusExt || {};

(function () {
  'use strict';

  const SETTINGS_KEY = NXTK.SETTINGS_KEY;
  const NDC_HISTORY_KEY = 'nxtk_ndc_history';
  const NDC_RATE_LIMIT_KEY = 'nxtk_ndc_rate_limit';
  const DEFAULTS = NXTK.DEFAULTS;

  // Last known-good values so reads keep working after the context dies
  // (e.g. a download loop in progress keeps the user's real settings).
  const cache = Object.create(null);

  /* Returns false once the extension has been reloaded/updated/disabled.
     Accessing chrome.runtime.id is the cheapest reliable probe. */
  function isContextValid() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  /* Promise-based chrome.storage.local.get that never throws. */
  function storageGet(key, fallback) {
    return new Promise((resolve) => {
      if (!isContextValid()) {
        resolve(key in cache ? cache[key] : fallback);
        return;
      }
      try {
        chrome.storage.local.get(key, (result) => {
          // Reading lastError clears Chrome's "unchecked error" warning.
          if (chrome.runtime.lastError) {
            resolve(key in cache ? cache[key] : fallback);
            return;
          }
          const value = result ? result[key] : undefined;
          if (value !== undefined) cache[key] = value;
          resolve(value !== undefined ? value : fallback);
        });
      } catch (_) {
        resolve(key in cache ? cache[key] : fallback);
      }
    });
  }

  /* Promise-based chrome.storage.local.set that never throws.
     Resolves true on success, false if the value could not be persisted. */
  function storageSet(key, value) {
    cache[key] = value;
    return new Promise((resolve) => {
      if (!isContextValid()) {
        resolve(false);
        return;
      }
      try {
        chrome.storage.local.set({ [key]: value }, () => {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          resolve(true);
        });
      } catch (_) {
        resolve(false);
      }
    });
  }

  async function getSettings() {
    const stored = await storageGet(SETTINGS_KEY, null);
    return { ...DEFAULTS, ...(stored || {}) };
  }

  async function saveSettings(settings) {
    return storageSet(SETTINGS_KEY, settings);
  }

  async function resetSettings() {
    return saveSettings({ ...DEFAULTS });
  }

  async function patchSetting(key, value) {
    const reply = await sendMutation('SETTINGS_PATCH', { patch: { [key]: value } });
    if (reply.ok && reply.value) {
      cache[SETTINGS_KEY] = reply.value;
      return true;
    }
    const current = await getSettings();
    return saveSettings({ ...current, [key]: value });
  }

  async function getHistory() {
    return storageGet(NDC_HISTORY_KEY, {});
  }

  async function saveHistory(history) {
    return storageSet(NDC_HISTORY_KEY, history);
  }

  /* ===== Atomic history mutations =====
     Routed through the service worker, which serialises them per storage key so two
     tabs cannot clobber each other's entries. Every mutation here is idempotent
     (set union / absolute assignment), which is what makes the retry safe: an MV3
     worker can be killed after the write lands but before the reply arrives, and
     re-applying the same union changes nothing. */
  const MUTATION_RETRY_DELAYS = [150, 400, 1000];

  function sendMutation(type, payload) {
    return new Promise((resolve) => {
      if (!isContextValid()) return resolve({ ok: false, error: 'context-invalid' });
      try {
        chrome.runtime.sendMessage({ type, payload }, (reply) => {
          if (chrome.runtime.lastError) {
            return resolve({ ok: false, error: chrome.runtime.lastError.message });
          }
          resolve(reply || { ok: false, error: 'empty-reply' });
        });
      } catch (cause) {
        resolve({ ok: false, error: String(cause?.message || cause) });
      }
    });
  }

  async function mutateWithRetry(type, payload) {
    for (let attempt = 0; attempt <= MUTATION_RETRY_DELAYS.length; attempt += 1) {
      const reply = await sendMutation(type, payload);
      if (reply.ok) return reply;
      // A rejected payload will be rejected identically next time — do not retry.
      if (reply.error && !/could not establish|receiving end|context-invalid|empty-reply/i.test(reply.error)) {
        return reply;
      }
      const delay = MUTATION_RETRY_DELAYS[attempt];
      if (delay === undefined) return reply;
      await new Promise((r) => setTimeout(r, delay));
    }
    return { ok: false, error: 'retries-exhausted' };
  }

  /* Browser-mode downloads are driven by the service worker (chrome.downloads is not
     reachable from a content script). Single-shot, no retry: a retried DOWNLOAD_START
     could start the same file twice, and the caller already has a fallback. */
  async function sendDownloadCommand(type, payload) {
    return sendMutation(type, payload);
  }

  /* Local read-modify-write, used only when the worker could not be reached. Racy
     across tabs, but a rare race beats losing the entry outright. */
  async function localHistoryMutate(gameId, collectionId, mutate) {
    const history = await getHistory();
    history[gameId] = history[gameId] || {};
    history[gameId][collectionId] = history[gameId][collectionId] || {};
    mutate(history[gameId][collectionId]);
    await saveHistory(history);
    return history;
  }

  function applyHistoryBranch(value) {
    const { gameId, collectionId, collection } = value || {};
    const cached = cache[NDC_HISTORY_KEY];
    const root = cached && typeof cached === 'object' ? cached : {};
    if (gameId && collectionId) {
      if (!root[gameId] || typeof root[gameId] !== 'object') root[gameId] = {};
      root[gameId][collectionId] = collection || {};
    }
    cache[NDC_HISTORY_KEY] = root;
    return root;
  }

  async function addHistoryEntry({ gameId, collectionId, type, fileId }) {
    const reply = await mutateWithRetry('NDC_HISTORY_ADD', { gameId, collectionId, type, fileId });
    if (reply.ok) return applyHistoryBranch(reply.value);
    return localHistoryMutate(gameId, collectionId, (collection) => {
      const list = Array.isArray(collection[type]) ? collection[type] : [];
      collection[type] = [...new Set([...list, fileId])];
    });
  }

  async function clearHistoryType({ gameId, collectionId, type }) {
    const reply = await mutateWithRetry('NDC_HISTORY_CLEAR_TYPE', { gameId, collectionId, type });
    if (reply.ok) return applyHistoryBranch(reply.value);
    return localHistoryMutate(gameId, collectionId, (collection) => {
      collection[type] = [];
    });
  }

  async function setCollectionHistory({ gameId, collectionId, lists }) {
    const reply = await mutateWithRetry('NDC_HISTORY_SET_COLLECTION', { gameId, collectionId, lists });
    if (reply.ok) return applyHistoryBranch(reply.value);
    return localHistoryMutate(gameId, collectionId, (collection) => {
      for (const key of ['all', 'mandatory', 'optional']) {
        collection[key] = Array.isArray(lists?.[key]) ? [...new Set(lists[key])] : [];
      }
    });
  }

  /* Shared rate-limit cooldown. Written when Nexus actually answers 429, so a
     second tab on the same collection backs off instead of continuing to hammer an
     endpoint that is already refusing. Replaces the old launched-download counter,
     which guessed at a limit from successful downloads. */
  async function getRateLimit() {
    return storageGet(NDC_RATE_LIMIT_KEY, { until: 0 });
  }

  async function saveRateLimit(state) {
    return storageSet(NDC_RATE_LIMIT_KEY, { until: Number(state?.until) || 0 });
  }

  window.NexusExt.Storage = {
    DEFAULTS,
    isContextValid,
    getSettings,
    patchSetting,
    resetSettings,
    getHistory,
    addHistoryEntry,
    clearHistoryType,
    setCollectionHistory,
    sendDownloadCommand,
    getRateLimit,
    saveRateLimit
  };

  /* Another tab (or the worker) may change storage under us. Without this the
     in-memory cache would serve stale history for the rest of the page's life. */
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const key of Object.keys(changes)) {
        if (!(key in cache)) continue;
        if (changes[key].newValue === undefined) delete cache[key];
        else cache[key] = changes[key].newValue;
      }
    });
  } catch (_) {
    // Orphaned content script — the cache simply stays as-is.
  }
})();
