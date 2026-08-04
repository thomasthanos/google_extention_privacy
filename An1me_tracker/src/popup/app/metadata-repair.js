// metadata-repair.js — popup status UI for metadata repair and the "fetch all fillers" flow.
(function () {
  "use strict";

  const AT = window.AnimeTracker;

  // A running repair can pause while an MV3 worker sleeps. Keep its persisted
  // counters visible and use this threshold only to trigger a bounded resume nudge.
  const METADATA_REPAIR_STALE_MS = 3 * 60 * 1000;
  const METADATA_REPAIR_RESUME_NUDGE_COOLDOWN_MS = 30 * 1000;
  const METADATA_REPAIR_MODAL_FETCH_THRESHOLD = 8;

  let elements, detectHasGoogleAuth, markInternalSave, scheduleDeferredListRefresh, sendRuntimeMessage, updateStats;
  let metadataRepairPromise = null;
  let lastMetadataRepairResumeNudgeAt = 0;
  let metadataRepairApplyVersion = 0;

  function getMetadataRepairProgress(state) {
    const progress = AT.FillerFetchUI?.getBackgroundProgress?.(state);
    if (progress) return progress;

    const total = Math.max(0, Number(state?.total) || 0);
    const processed = Math.max(0, Math.min(total, Number(state?.processed) || 0));
    return { total, processed, remaining: Math.max(0, total - processed) };
  }

  function getMetadataRepairUiMode(state) {
    if (state?.uiMode === "modal" || state?.uiMode === "status") return state.uiMode;

    const origin = state?.origin || (state?.options?.auto === true ? "background" : "manual");
    if (origin === "manual") return "modal";
    if (origin === "sign-in" && getMetadataRepairProgress(state).total >= METADATA_REPAIR_MODAL_FETCH_THRESHOLD) return "modal";
    return "status";
  }

  function setMetadataRepairStatus(label, synced = false, options = {}) {
    const source = options.source || "metadata";
    AT.SyncStatusController.setActivity(
      source,
      {
        label,
        tone: options.error === true ? "error" : synced ? "success" : "busy",
        title: options.title || "",
      },
    );
  }

  function restoreDefaultSyncStatus(options = {}) {
    return AT.SyncStatusController.refreshCloudStatus({
      immediate: options.immediate === true,
      debounceMs: options.debounceMs,
    });
  }

  function scheduleDefaultSyncStatusRestore(delayMs = 2500, source = "metadata") {
    AT.SyncStatusController.clearActivity(source, { delayMs });
    void restoreDefaultSyncStatus();
  }

  function applyAnimeInfoCacheChange(storageKey, value) {
    const slug = storageKey.replace("animeinfo_", "");
    if (!slug) return;

    if (value) {
      AT.AnilistService.cache[slug] = value;
    } else {
      delete AT.AnilistService.cache[slug];
    }

    scheduleCompletionRepair(slug);
  }

  const _pendingRepairSlugs = new Set();
  let _repairFlushTimer = null;

  function scheduleCompletionRepair(slug) {
    if (!AT.PopupState.animeData?.[slug]) return;
    _pendingRepairSlugs.add(slug);
    if (_repairFlushTimer) clearTimeout(_repairFlushTimer);
    _repairFlushTimer = setTimeout(flushPendingCompletionRepair, 1500);
  }

  function flushPendingCompletionRepair() {
    _repairFlushTimer = null;
    const slugs = [..._pendingRepairSlugs];
    _pendingRepairSlugs.clear();
    if (slugs.length === 0) return;

    void AT.LibraryMutations.enqueue("completion-repair", async ({ commit, snapshot }) => {
      const data = snapshot.animeData || {};
      const present = slugs.filter((slug) => data[slug]);
      if (present.length === 0) return null;

      let changed = false;
      for (const slug of present) {
        if (AT.AnilistService.backfillAnimeEntry(data[slug], AT.AnilistService.cache[slug])) changed = true;
      }
      if (AT.StatusService.repairAiringCompleted(data, { slugs: present })) changed = true;
      if (AT.StatusService.persistDetectedCompletions(data, { slugs: present })) changed = true;
      if (!changed) return null;

      await commit({ animeData: data }, { markInternalSave, immediate: false });
      return data;
    })
      .then((data) => {
        if (data) AT.PopupState.animeData = data;
      })
      .catch((error) => {
        PopupLogger.warn("AnimeInfo", "Failed to persist repaired completion state:", error);
      });
  }

  function applyEpisodeTypesCacheChange(storageKey, value) {
    const slug = storageKey.replace("episodeTypes_", "");
    if (!slug) return;

    const { FillerService } = AT;
    if (AT.CachePolicy.isFillerUsableSnapshot(value)) {
      FillerService.episodeTypesCache[slug] = value;
      FillerService.updateFromEpisodeTypes(slug, value);
    } else {
      delete FillerService.episodeTypesCache[slug];
      delete FillerService.KNOWN_FILLERS[slug];
    }
    scheduleCompletionRepair(slug);
  }

  async function applyMetadataRepairState(state, options = {}) {
    const applyVersion = ++metadataRepairApplyVersion;
    const { ensureOpen = false, autoOpenRunning = false } = options;

    const previousState = AT.PopupState.lastMetadataRepairState || null;
    const previousStatus = previousState?.status || null;
    AT.PopupState.lastMetadataRepairState = state || null;
    const { FillerFetchUI } = AT;

    if (!state) {
      lastMetadataRepairResumeNudgeAt = 0;
      if (FillerFetchUI.state.isOpen) FillerFetchUI.applyBackgroundState(null);
      AT.SyncStatusController.clearActivity("metadata");
      void restoreDefaultSyncStatus({ immediate: true });
      return null;
    }

    const uiMode = getMetadataRepairUiMode(state);
    const shouldOpen = ensureOpen || (autoOpenRunning && state.status === "running" && uiMode === "modal");
    if (!ensureOpen && uiMode === "status" && FillerFetchUI.state.isOpen) {
      FillerFetchUI.close();
    }
    if (shouldOpen && !FillerFetchUI.state.isOpen) {
      await FillerFetchUI.open();
      if (applyVersion !== metadataRepairApplyVersion) return state;
    }
    if (FillerFetchUI.state.isOpen || shouldOpen) {
      FillerFetchUI.applyBackgroundState(state);
    }

    if (state.status === "running") {
      const updatedAt = state.updatedAt ? Date.parse(state.updatedAt) : 0;
      const progress = getMetadataRepairProgress(state);
      if (!updatedAt || Date.now() - updatedAt > METADATA_REPAIR_STALE_MS) {
        setMetadataRepairStatus(
          progress.total > 0 ? `Resuming ${progress.processed}/${progress.total}...` : "Resuming import...",
        );

        // The persisted counters remain authoritative while an MV3 worker is waking up.
        // Keep them visible and only nudge the background at a bounded rate.
        const now = Date.now();
        if (now - lastMetadataRepairResumeNudgeAt >= METADATA_REPAIR_RESUME_NUDGE_COOLDOWN_MS) {
          lastMetadataRepairResumeNudgeAt = now;
          sendRuntimeMessage?.(
            {
              type: "START_LIBRARY_REPAIR",
              forceInfoRefresh: false,
              forceFillerRefresh: false,
              auto: state.options?.auto === true,
              origin: state.origin || (state.options?.auto === true ? "background" : "manual"),
            },
            30000,
          )?.catch?.(() => {});
        }
        return state;
      }
      lastMetadataRepairResumeNudgeAt = 0;
      const nextStep = progress.total > 0 ? Math.min(progress.total, progress.processed + 1) : 0;
      setMetadataRepairStatus(progress.total > 0 ? `Fetching ${nextStep}/${progress.total}...` : "Fetching data...");
      return state;
    }

    if (state.status === "completed") {
      const label = state.failed > 0 ? `Import Complete (${state.failed} failed)` : "Import Complete";
      setMetadataRepairStatus(label, true);
      if (previousStatus !== "completed" || previousState?.runId !== state.runId) {
        scheduleDeferredListRefresh({ delayMs: 0 });
        await updateStats();
      }
      if (applyVersion !== metadataRepairApplyVersion) return state;
      scheduleDefaultSyncStatusRestore();
      return state;
    }

    if (state.status === "error") {
      setMetadataRepairStatus("Import Error", false, {
        error: true,
        title: state.errorMessage || "Metadata import failed",
      });
      return state;
    }

    return state;
  }

  async function syncMetadataRepairStateFromStorage(options = {}) {
    const { Storage } = AT;
    const result = await Storage.get(["metadataRepairState"]);
    const initialState = result.metadataRepairState || null;
    const appliedState = await applyMetadataRepairState(initialState, options);

    // Opening the overlay awaits storage/DOM work. Re-read once so a progress or
    // completion write that landed during that window is not missed before the
    // popup's storage listener has been attached.
    if (initialState?.status === "running") {
      const latest = await Storage.get(["metadataRepairState"]);
      const latestState = latest.metadataRepairState || null;
      if (latestState?.updatedAt !== initialState.updatedAt || latestState?.status !== initialState.status) {
        return applyMetadataRepairState(latestState, options);
      }
    }

    return appliedState;
  }

  async function maybePromptPostUpdateFetch() {
    const { Storage } = AT;
    try {
      const stored = await Storage.get(["postUpdateFetchTriggeredAt", "postUpdateFetchToVersion", "metadataRepairState"]);

      if (stored.postUpdateFetchTriggeredAt) {
        await Storage.remove(["postUpdateFetchTriggeredAt", "postUpdateFetchFromVersion", "postUpdateFetchToVersion"]);
      }

      if (stored.metadataRepairState?.status === "running") {
        await applyMetadataRepairState(stored.metadataRepairState, { autoOpenRunning: false });
      }
    } catch (e) {
      PopupLogger.warn("Init", "Post-update silent sync failed:", e);
    }
  }

  async function fetchAllFillers(options = {}) {
    const { autoStart = true, forceInfoRefresh = false, forceFillerRefresh = false, autoMode = false } = options;

    const { FillerFetchUI } = AT;

    if (metadataRepairPromise) {
      if (!FillerFetchUI.state.isOpen) await FillerFetchUI.open({ autoMode });
      await syncMetadataRepairStateFromStorage({ ensureOpen: true });
      return metadataRepairPromise;
    }

    if (!FillerFetchUI.state.isOpen) await FillerFetchUI.open({ autoMode });

    if (!autoStart) {
      return syncMetadataRepairStateFromStorage({ ensureOpen: true });
    }

    metadataRepairPromise = (async () => {
      const persistedState = await syncMetadataRepairStateFromStorage({ ensureOpen: true });
      if (persistedState?.status === "running") {
        const response = await sendRuntimeMessage(
          {
            type: "START_LIBRARY_REPAIR",
            forceInfoRefresh: false,
            forceFillerRefresh: false,
            auto: false,
            origin: "manual",
          },
          30000,
        );
        if (!response?.success) {
          throw new Error(response?.error || "Failed to resume import");
        }
        return applyMetadataRepairState(response.state || persistedState, { ensureOpen: true });
      }

      setMetadataRepairStatus("Importing data...");
      FillerFetchUI.showPendingStart("Starting import…");

      const response = await sendRuntimeMessage(
        {
          type: "START_LIBRARY_REPAIR",
          forceInfoRefresh,
          forceFillerRefresh,
          isMobile: !detectHasGoogleAuth(),
          origin: "manual",
        },
        30000,
      );

      if (!response?.success) {
        throw new Error(response?.error || "Failed to start import");
      }

      return applyMetadataRepairState(response.state || null, { ensureOpen: true });
    })()
      .catch((error) => {
        PopupLogger.error("RepairAll", "Error:", error);
        setMetadataRepairStatus("Import Error", false, { error: true, title: error?.message || "Metadata import failed" });
        throw error;
      })
      .finally(() => {
        metadataRepairPromise = null;
      });

    return metadataRepairPromise;
  }

  AT.MetadataRepair = {
    _init(d) {
      elements = d.elements;
      detectHasGoogleAuth = d.detectHasGoogleAuth;
      markInternalSave = d.markInternalSave;
      scheduleDeferredListRefresh = d.scheduleDeferredListRefresh;
      sendRuntimeMessage = d.sendRuntimeMessage;
      updateStats = d.updateStats;
      AT.SyncStatusController.init({
        statusElement: elements.syncStatus,
        textElement: elements.syncText,
        getUser: () => AT.FirebaseSync?.getUser?.() || null,
      });
    },
    setMetadataRepairStatus,
    restoreDefaultSyncStatus,
    scheduleDefaultSyncStatusRestore,
    applyAnimeInfoCacheChange,
    applyEpisodeTypesCacheChange,
    applyMetadataRepairState,
    syncMetadataRepairStateFromStorage,
    maybePromptPostUpdateFetch,
    fetchAllFillers,
  };
})();
