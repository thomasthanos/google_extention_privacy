// watchlist-sync.js — syncs your status (Watching/Completed/…) with the site's own watchlist.
function watchlistLibraryRequest(message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Library mutation coordinator timed out"));
    }, 20000);

    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) reject(new Error(runtimeError.message));
        else resolve(response || {});
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
  });
}

const WatchlistSync = {
  _AJAX_URL: "https://an1me.to/wp-admin/admin-ajax.php",
  _STANDALONE_COMPLETE_RE: /(?:^|[-_])(movie|film|ova|ona|special|fan-letter)(?:[-_]|$)/i,

  _logger() {
    return (
      window.AnimeTrackerContent?.Logger || {
        debug: () => {},
        info: () => {},
        warn: () => {},
      }
    );
  },

  _STATUS_LABEL: {
    watching: "Watching",
    completed: "Completed",
    on_hold: "On Hold",
    plan_to_watch: "Plan to Watch",
    dropped: "Dropped",
    remove: "Removed",
  },

  _statusLabel(type) {
    return this._STATUS_LABEL[type] || String(type || "");
  },

  _shortName(animeSlug, fallbackTitle) {
    if (fallbackTitle) return String(fallbackTitle);
    if (!animeSlug) return "this anime";
    return String(animeSlug)
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  },

  _looksStandaloneOneShot(entry, animeSlug = "") {
    const slug = String(animeSlug || "").toLowerCase();
    const title = String(entry?.title || "").toLowerCase();
    const totalEpisodes = Number(entry?.totalEpisodes) || 0;
    const watchedCount = Array.isArray(entry?.episodes) ? entry.episodes.length : 0;
    const mediaType = globalThis.AnimeTrackerMediaType?.resolve(animeSlug, entry) || null;

    if (watchedCount <= 0) return false;
    if (["MOVIE", "MUSIC"].includes(mediaType)) return true;
    if (totalEpisodes === 1 && ["OVA", "ONA", "SPECIAL"].includes(mediaType)) return true;
    if (watchedCount === 1 && totalEpisodes === 1 && this._STANDALONE_COMPLETE_RE.test(slug)) return true;
    if (watchedCount === 1 && totalEpisodes === 1 && /\b(movie|film|ova|ona|special|fan letter)\b/i.test(title)) return true;
    return false;
  },

  resolveStatus(entry, animeSlug = null, options = {}) {
    const fallbackType = options.fallbackType || null;
    const keepFirstEpisodeAsPlanToWatch = options.keepFirstEpisodeAsPlanToWatch === true;
    const watchedCount = Array.isArray(entry?.episodes) ? entry.episodes.length : 0;
    const totalEpisodes = Number(entry?.totalEpisodes) || 0;
    const listState = globalThis.AnimeTrackerEntryState?.getResolvedListState?.(entry) || String(entry?.listState || "").toLowerCase();
    const isStandaloneOneShot = this._looksStandaloneOneShot(entry, animeSlug);

    if (listState === "dropped") return "dropped";
    if (listState === "on_hold") return "on_hold";

    if (listState === "completed" || isStandaloneOneShot) {
      return "completed";
    }

    if (keepFirstEpisodeAsPlanToWatch && watchedCount === 1 && !isStandaloneOneShot && !(totalEpisodes > 0 && totalEpisodes <= 1)) {
      return "plan_to_watch";
    }

    if (watchedCount > 0) return "watching";
    return fallbackType;
  },

  getProgressFallbackType(entry, animeSlug = null) {
    const watchedCount = Array.isArray(entry?.episodes) ? entry.episodes.length : 0;
    if (watchedCount > 0) return "watching";
    const mediaType = globalThis.AnimeTrackerMediaType?.resolve(animeSlug, entry) || null;
    return ["MOVIE", "OVA", "ONA", "SPECIAL", "MUSIC"].includes(mediaType) ||
      this._STANDALONE_COMPLETE_RE.test(String(animeSlug || "").toLowerCase())
      ? "watching"
      : "plan_to_watch";
  },

  resolveRepairStatus(entry, animeSlug = null) {
    const watchedCount = Array.isArray(entry?.episodes) ? entry.episodes.length : 0;
    const prevSynced = String(entry?.watchlistSyncedType || "").toLowerCase();

    // Already synced before → keep fully in sync, including moving back out of dropped/completed/on_hold (un-drop must propagate).
    if (prevSynced && prevSynced !== "remove") {
      return this.resolveStatus(entry, animeSlug, {
        fallbackType: watchedCount > 0 ? "watching" : "plan_to_watch",
      });
    }

    // Not yet on the site list → only auto-push terminal states; leave active/plan to the watch-page sync so reconcile never bulk-adds.
    const listState = globalThis.AnimeTrackerEntryState?.getResolvedListState?.(entry) || String(entry?.listState || "").toLowerCase();

    if (listState === "dropped") return "dropped";
    if (listState === "on_hold") return "on_hold";

    if (
      listState === "completed" ||
      this._looksStandaloneOneShot(entry, animeSlug)
    ) {
      return "completed";
    }

    return null;
  },

  async syncFromStorage(animeId, animeSlug, options = {}) {
    const Logger = this._logger();
    if (!animeId || !animeSlug) return false;

    const Storage = window.AnimeTrackerContent?.Storage;
    if (Storage?.isContextValid && !Storage.isContextValid()) return false;

    try {
      const animeData = await this._loadAnimeData();
      const entry = animeData[animeSlug] || null;
      const type = this.resolveStatus(entry, animeSlug, options);
      if (!type) {
        Logger.debug(`WatchlistSync: no resolved status for ${animeSlug}`);
        return false;
      }
      return await this.updateStatus(animeId, type, animeSlug, options);
    } catch (e) {
      const msg = String(e?.message || "").toLowerCase();
      if (msg.includes("extension context") || msg.includes("cannot access")) return false;
      Logger.warn(`WatchlistSync: syncFromStorage failed for ${animeSlug}: ${e.message}`);
      return false;
    }
  },

  async _loadAnimeEntry(animeSlug) {
    if (!animeSlug) return null;
    try {
      const animeData = await this._loadAnimeData();
      return animeData[animeSlug] || null;
    } catch {
      return null;
    }
  },

  async _loadAnimeData() {
    const Storage = window.AnimeTrackerContent?.Storage;
    if (Storage?.get) {
      const result = await Storage.get(["animeData"]);
      if (Storage.isAbortResult?.(result)) return {};
      return result?.animeData || {};
    }

    const snapshot = await watchlistLibraryRequest({ type: "LIBRARY_MUTATION_SNAPSHOT", keys: ["animeData"] });
    if (!snapshot?.success) throw new Error(snapshot?.error || "Library mutation snapshot failed");
    return snapshot.data?.animeData || {};
  },

  async _persistSyncedType(animeSlug, type) {
    if (!animeSlug) return;
    try {
      const { Storage } = window.AnimeTrackerContent || {};
      if (Storage && typeof Storage.mutate === "function") {
        await Storage.mutate(["animeData"], (data) => {
          const animeData = (data.animeData = data.animeData || {});
          if (!animeData[animeSlug]) return false;
          if (type === "remove") {
            if (!("watchlistSyncedType" in animeData[animeSlug])) return false;
            delete animeData[animeSlug].watchlistSyncedType;
          } else {
            if (animeData[animeSlug].watchlistSyncedType === type) return false;
            animeData[animeSlug].watchlistSyncedType = type;
          }
        });
        return;
      }
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const snapshot = await watchlistLibraryRequest({ type: "LIBRARY_MUTATION_SNAPSHOT", keys: ["animeData"] });
        if (!snapshot?.success) throw new Error(snapshot?.error || "Library mutation snapshot failed");
        const animeData = snapshot.data?.animeData || {};
        if (!animeData[animeSlug]) return;
        if (type === "remove") {
          if (!("watchlistSyncedType" in animeData[animeSlug])) return;
          delete animeData[animeSlug].watchlistSyncedType;
        } else {
          if (animeData[animeSlug].watchlistSyncedType === type) return;
          animeData[animeSlug].watchlistSyncedType = type;
        }

        const response = await watchlistLibraryRequest({
          type: "LIBRARY_MUTATION_COMMIT",
          expectedRevision: snapshot.revision,
          data: { animeData },
        });
        if (response?.success) return;
        if (!response?.conflict) throw new Error(response?.error || "Library mutation commit failed");
      }
      throw new Error("Library mutation conflicted too many times");
    } catch {}
  },

  async _sendWatchlistRequest(animeId, type, Logger) {
    const action = type === "remove" ? "remove_from_watchlist" : "add_to_watchlist";

    Logger.debug(`WatchlistSync: POST ${action} type="${type}" anime #${animeId}`);

    try {
      const formData = new FormData();
      formData.append("action", action);
      formData.append("anime_id", animeId.toString());
      formData.append("type", type);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      let res;
      try {
        res = await fetch(this._AJAX_URL, {
          method: "POST",
          credentials: "include",
          body: formData,
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        Logger.warn(`Watchlist: server returned HTTP ${res.status}`);
        return false;
      }

      const text = await res.text();
      Logger.debug(`WatchlistSync: response for ${type}: ${text.substring(0, 300)}`);

      try {
        const data = JSON.parse(text);
        return data?.success !== false;
      } catch {
        if (text === "0" || text === "-1") {
          Logger.warn("Watchlist: site rejected the change (you may need to re-login on an1me.to)");
          return false;
        }
        return true;
      }
    } catch (e) {
      Logger.warn(`Watchlist: network error — ${e.message}`);
      return false;
    }
  },

  async updateStatus(animeId, type, animeSlug = null, options = {}) {
    const Logger = this._logger();
    const force = options.force === true;

    if (!animeId || !type) {
      Logger.debug("Watchlist: missing animeId or type, skipping");
      return;
    }

    if (!this._isLoggedIn()) {
      Logger.debug("Watchlist: not logged in on an1me.to, skipping sync");
      return;
    }

    const entry = animeSlug ? await this._loadAnimeEntry(animeSlug) : null;
    const previousType = entry?.watchlistSyncedType || null;
    const name = this._shortName(animeSlug, entry?.title);
    const newLabel = this._statusLabel(type);

    if (!force && animeSlug && type !== "remove" && previousType === type) {
      Logger.debug(`Watchlist: "${name}" already marked as "${newLabel}", nothing to do`);
      return true;
    }

    const shouldResetBeforeAdd = type !== "remove" && previousType && previousType !== type;

    let intent;
    if (type === "remove") {
      intent = `Watchlist: removing "${name}" from your an1me.to list…`;
    } else if (shouldResetBeforeAdd) {
      const prevLabel = this._statusLabel(previousType);
      intent = `Watchlist: updating "${name}" — ${prevLabel} → ${newLabel}…`;
    } else if (previousType === type) {
      intent = `Watchlist: re-syncing "${name}" as ${newLabel}…`;
    } else {
      intent = `Watchlist: marking "${name}" as ${newLabel}…`;
    }
    Logger.info(intent);

    if (shouldResetBeforeAdd) {
      const removed = await this._sendWatchlistRequest(animeId, "remove", Logger);
      if (removed) {
        await this._persistSyncedType(animeSlug, "remove");
        await new Promise((resolve) => setTimeout(resolve, 200));
      } else {
        Logger.warn(`Watchlist: couldn't clear previous "${this._statusLabel(previousType)}" status for "${name}"`);
      }
    }

    const success = await this._sendWatchlistRequest(animeId, type, Logger);
    if (success) {
      if (animeSlug) await this._persistSyncedType(animeSlug, type);

      // Logger.success returns undefined, so `?.() || info()` double-logged every line.
      const logOk = (Logger.success || Logger.info).bind(Logger);
      if (type === "remove") {
        logOk(`Watchlist: ✓ removed "${name}"`);
      } else if (shouldResetBeforeAdd) {
        logOk(`Watchlist: ✓ updated "${name}" to ${newLabel}`);
      } else {
        logOk(`Watchlist: ✓ added "${name}" as ${newLabel}`);
      }
    } else {
      Logger.warn(`Watchlist: ✗ failed to ${type === "remove" ? "remove" : "mark as " + newLabel} "${name}"`);
    }
    return success;
  },

  async reconcileWatchlistStatuses() {
    const Logger = this._logger();
    const LOCK_KEY = "watchlistRepairLock";
    const LOCK_TTL_MS = 5 * 60 * 1000;

    if (!this._isLoggedIn()) {
      Logger.debug("WatchlistSync: reconcile skipped, site user not logged in");
      return false;
    }

    let lockHeld = false;
    try {
      const { [LOCK_KEY]: lockTs = 0 } = await chrome.storage.local.get([LOCK_KEY]);
      const animeData = await this._loadAnimeData();

      const stale = [];
      for (const [slug, entry] of Object.entries(animeData)) {
        if (!entry?.siteAnimeId) continue;
        const want = this.resolveRepairStatus(entry, slug);
        if (!want) continue;
        if (entry.watchlistSyncedType === want) continue;
        stale.push([slug, entry, want]);
      }
      if (stale.length === 0) return true;

      const lockValue = Number(typeof lockTs === "object" ? lockTs?.time : lockTs) || 0;
      if (lockValue && Date.now() - lockValue < LOCK_TTL_MS) {
        Logger.debug("WatchlistSync: reconcile lock held by another tab, skipping");
        return false;
      }
      // Token + verify closes the check-then-set race between two tabs opening together.
      const lockToken = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await chrome.storage.local.set({ [LOCK_KEY]: { time: Date.now(), token: lockToken } });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const verify = await chrome.storage.local.get([LOCK_KEY]);
      if (verify[LOCK_KEY]?.token !== lockToken) {
        Logger.debug("WatchlistSync: reconcile lock contended, deferring");
        return false;
      }
      lockHeld = true;

      let synced = 0;
      for (const [slug, entry, want] of stale) {
        const ok = await this.updateStatus(entry.siteAnimeId, want, slug);
        if (ok) synced++;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      if (synced > 0) {
        Logger.info(`Watchlist: ✓ reconciled ${synced} status change(s) with an1me.to`);
      }
      return true;
    } catch (e) {
      Logger.warn(`WatchlistSync: reconcile failed: ${e.message}`);
      return false;
    } finally {
      if (lockHeld) {
        try {
          await chrome.storage.local.remove([LOCK_KEY]);
        } catch {}
      }
    }
  },

  _isLoggedIn() {
    try {
      const scripts = document.querySelectorAll("script:not([src])");
      for (const script of scripts) {
        const text = script.textContent;

        const configMatch = text.match(/var\s+kiraConfig\s*=\s*(\{[^;]+\})\s*;/);
        if (configMatch) {
          try {
            const config = JSON.parse(configMatch[1]);
            if ("logged_in" in config) return !!config.logged_in;
          } catch {}
        }

        const loggedMatch = text.match(/(?:logged_in|isloggedIn)\s*[=:]\s*(true|false|1|0)/i);
        if (loggedMatch) {
          return loggedMatch[1] === "true" || loggedMatch[1] === "1";
        }
      }
    } catch {}
    return false;
  },
};

window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.WatchlistSync = WatchlistSync;

setTimeout(() => {
  WatchlistSync.reconcileWatchlistStatuses().catch((e) => window.__atSwallow?.("reconcileWatchlist", e));
}, 2500);

if (/\/watch\//.test(location.pathname)) {
  try {
    chrome.runtime.sendMessage({ type: "WAKE_AND_POLL_CLOUD" }, () => {
      if (chrome.runtime.lastError) {
      }
    });
  } catch {}
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "WATCHLIST_SYNC_EXECUTE") return false;

  const { animeId, watchlistType, animeSlug } = message;
  if (!animeId || !watchlistType) {
    sendResponse({ success: false, error: "invalid_payload" });
    return false;
  }

  if (animeSlug) {
    WatchlistSync.updateStatus(animeId, watchlistType, animeSlug, { force: true })
      .then((ok) => sendResponse({ success: ok !== false }))
      .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
    return true;
  }

  const action = watchlistType === "remove" ? "remove_from_watchlist" : "add_to_watchlist";
  const formData = new FormData();
  formData.append("action", action);
  formData.append("anime_id", animeId.toString());
  formData.append("type", watchlistType);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  fetch("https://an1me.to/wp-admin/admin-ajax.php", {
    method: "POST",
    credentials: "include",
    body: formData,
    signal: ctrl.signal,
  })
    .then((res) => {
      return res.text().then((text) => {
        clearTimeout(timer);
        const trimmed = (text || "").trim();
        if (trimmed === "0" || trimmed === "-1") {
          const reason = trimmed === "0" ? "auth_failed" : "bad_request";
          (window.AnimeTrackerContent?.Logger || console).warn?.(`[WatchlistSync] via tab returned ${trimmed} (${reason}) for #${animeId}`);
          sendResponse({ success: false, error: reason });
          return;
        }
        (window.AnimeTrackerContent?.Logger || console).debug?.(`[WatchlistSync] via tab: ${action} type="${watchlistType}" #${animeId}`);
        sendResponse({ success: true });
      });
    })
    .catch((e) => {
      clearTimeout(timer);
      (window.AnimeTrackerContent?.Logger || console).warn?.(`[WatchlistSync] via tab error: ${e.message}`);
      sendResponse({ success: false, error: e.message });
    });
  return true;
});
