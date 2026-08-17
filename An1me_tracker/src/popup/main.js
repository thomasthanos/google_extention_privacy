// main.js — popup/side-panel orchestrator: boots the UI and coordinates views;
// also hosts the donate dropdown and library backup/export.
(function () {
  "use strict";

  const AT = (window.AnimeTracker = window.AnimeTracker || {});

  function getSettingsDonateButton() {
    return document.getElementById("settingsDonate");
  }

  function closeDonateDropdown() {
    const donateDropdown = document.getElementById("donateDropdown");
    if (!donateDropdown) return;
    donateDropdown.classList.remove("visible");
    delete donateDropdown.dataset.placement;
  }

  function positionDonateDropdown() {
    const dropdown = document.getElementById("donateDropdown");
    const trigger = getSettingsDonateButton();
    const content = dropdown?.querySelector(".donate-dropdown-content");
    if (!dropdown || !trigger || !content) return;

    const triggerRect = trigger.getBoundingClientRect();
    const dropdownWidth = Math.ceil(content.offsetWidth || 220);
    const dropdownHeight = Math.ceil(content.offsetHeight || 132);
    const gap = 8;
    const viewportPadding = 10;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = triggerRect.right - dropdownWidth;
    left = Math.max(viewportPadding, Math.min(left, viewportWidth - dropdownWidth - viewportPadding));

    let top = triggerRect.top - dropdownHeight - gap;
    let placement = "above";

    if (top < viewportPadding) {
      top = Math.min(triggerRect.bottom + gap, viewportHeight - dropdownHeight - viewportPadding);
      placement = "below";
    }

    const arrowOffset = triggerRect.left + triggerRect.width / 2 - left;
    const clampedArrow = Math.max(22, Math.min(arrowOffset, dropdownWidth - 22));

    dropdown.style.left = `${Math.round(left)}px`;
    dropdown.style.top = `${Math.round(top)}px`;
    dropdown.style.setProperty("--donate-arrow-offset", `${Math.round(clampedArrow)}px`);
    dropdown.dataset.placement = placement;
  }

  function openDonateDropdown() {
    const donateDropdown = document.getElementById("donateDropdown");
    if (!donateDropdown || !getSettingsDonateButton()) return;
    positionDonateDropdown();
    donateDropdown.classList.add("visible");
    requestAnimationFrame(positionDonateDropdown);
  }

  AT.DonateDropdown = {
    open: openDonateDropdown,
    close: closeDonateDropdown,
    position: positionDonateDropdown,
    getButton: getSettingsDonateButton,
  };
})();

(function () {
  "use strict";

  const BACKUP_FORMAT_VERSION = 1;

  function buildPayload(snapshot) {
    const version = (typeof chrome !== "undefined" && chrome.runtime?.getManifest?.()?.version) || null;
    return {
      version: BACKUP_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      extensionVersion: version,
      animeData: snapshot?.animeData || {},
      videoProgress: snapshot?.videoProgress || {},
      deletedAnime: snapshot?.deletedAnime || {},
      groupCoverImages: snapshot?.groupCoverImages || {},
      goalSettings: snapshot?.goalSettings || null,
      badgeUnlocks: snapshot?.badgeUnlocks || {},
    };
  }

  function triggerDownload(payload, filenameOverride = null) {
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace(/T.*/, "");
    const filename = filenameOverride || `an1me-tracker-backup-${stamp}.json`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    }, 1500);
  }

  function parseAndValidate(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON file");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Backup file is malformed");
    }

    if (!parsed.animeData || typeof parsed.animeData !== "object") {
      throw new Error("Backup is missing animeData");
    }
    return parsed;
  }

  function mergeImported(local, parsed) {
    const Merge = globalThis.AnimeTrackerMergeUtils;
    if (!Merge?.mergeAnimeData) throw new Error("Merge utils unavailable");
    const AT = (typeof window !== "undefined" && window.AnimeTracker) || {};
    const ProgressManager = AT.ProgressManager;

    let mergedAnime = Merge.mergeAnimeData(local?.animeData || {}, parsed?.animeData || {});
    let mergedDeleted = Merge.mergeDeletedAnime(local?.deletedAnime || {}, parsed?.deletedAnime || {});
    mergedDeleted = Merge.pruneStaleDeletedAnime(mergedAnime, mergedDeleted);
    Merge.applyDeletedAnime(mergedAnime, mergedDeleted);

    const mergedProgress = Merge.mergeVideoProgress(local?.videoProgress || {}, parsed?.videoProgress || {});
    const mergedGroup = Merge.mergeGroupCoverImages(local?.groupCoverImages || {}, parsed?.groupCoverImages || {});
    const mergedGoals = Merge.mergeGoalSettings
      ? Merge.mergeGoalSettings(local?.goalSettings || null, parsed?.goalSettings || null)
      : parsed?.goalSettings || local?.goalSettings || null;
    const mergedBadges = Merge.mergeBadgeUnlocks
      ? Merge.mergeBadgeUnlocks(local?.badgeUnlocks || {}, parsed?.badgeUnlocks || {})
      : { ...(local?.badgeUnlocks || {}), ...(parsed?.badgeUnlocks || {}) };

    if (ProgressManager?.removeDuplicateEpisodes) {
      mergedAnime = ProgressManager.removeDuplicateEpisodes(mergedAnime);
    }

    return {
      animeData: mergedAnime,
      videoProgress: mergedProgress,
      deletedAnime: mergedDeleted,
      groupCoverImages: mergedGroup,
      goalSettings: mergedGoals,
      badgeUnlocks: mergedBadges,
    };
  }

  window.AnimeTracker = window.AnimeTracker || {};
  window.AnimeTracker.LibraryBackup = {
    buildPayload,
    triggerDownload,
    parseAndValidate,
    mergeImported,
  };
})();

(function () {
  "use strict";

  const AT = window.AnimeTracker;

  const {
    open: openDonateDropdown,
    close: closeDonateDropdown,
    position: positionDonateDropdown,
    getButton: getSettingsDonateButton,
  } = AT.DonateDropdown;

  const { showToast, showAuthToast } = AT;

  const { signInWithGoogle, handleEmailAuth, handleForgotPassword } = AT.AuthUI;

  const {
    showAddAnimeDialog,
    prepareSlugInput,
    onSlugInputChange,
    hideAddAnimeDialog,
    addAnimeWithEpisodes,
    hideEditTitleDialog,
    saveEditedTitle,
    editAnimeTitle,
    fetchFillerForAnime,
  } = AT.AddAnimeDialog;

  const { deleteProgress, deleteAnime, toggleAnimeCompleted, toggleAnimeDropped, toggleAnimeFavorite, toggleAnimeOnHold, clearAllData } =
    AT.AnimeActions;

  const { renderAnimeList } = AT.RenderList;

  const {
    setMetadataRepairStatus,
    restoreDefaultSyncStatus,
    scheduleDefaultSyncStatusRestore,
    applyAnimeInfoCacheChange,
    applyEpisodeTypesCacheChange,
    applyMetadataRepairState,
    syncMetadataRepairStateFromStorage,
    maybePromptPostUpdateFetch,
    fetchAllFillers,
  } = AT.MetadataRepair;

  const { updateStats, loadGoalAndBadgeState, setViewMode, renderSettingsView, renderGoalsView } = AT.StatsViews;

  let animeData = {};
  let videoProgress = {};
  let currentSort = "date";
  let currentCategory = "all";
  let currentCompactStatus = "airing";
  let currentCompactStatusOpen = false;
  let goalSettings = null;
  let badgeState = {};
  let currentViewMode = null;
  let _libraryLoaded = false;
  let _libraryRevision = 0;
  let _libraryLoadState = Object.freeze({
    phase: "idle",
    busy: false,
    error: null,
    generation: 0,
    reason: null,
  });

  AT.PopupState = {
    get animeData() {
      return animeData;
    },
    set animeData(v) {
      animeData = v;
      AT.ProgressInsights?.invalidate?.();
      if (goalSettings !== null) AT.ProgressInsights?.schedule?.("anime-state-assignment");
    },
    get videoProgress() {
      return videoProgress;
    },
    set videoProgress(v) {
      videoProgress = v;
    },
    get addDialogDetectedTitle() {
      return _addDialogDetectedTitle;
    },
    set addDialogDetectedTitle(v) {
      _addDialogDetectedTitle = v;
    },
    get addDialogKnownTotal() {
      return _addDialogKnownTotal;
    },
    set addDialogKnownTotal(v) {
      _addDialogKnownTotal = v;
    },
    get addDialogFinalTotal() {
      return _addDialogFinalTotal;
    },
    set addDialogFinalTotal(v) {
      _addDialogFinalTotal = v;
    },
    get addDialogMediaType() {
      return _addDialogMediaType;
    },
    set addDialogMediaType(v) {
      _addDialogMediaType = v;
    },
    get addDialogTotalCanon() {
      return _addDialogTotalCanon;
    },
    set addDialogTotalCanon(v) {
      _addDialogTotalCanon = v;
    },
    get addDialogCurrentSlug() {
      return _addDialogCurrentSlug;
    },
    set addDialogCurrentSlug(v) {
      _addDialogCurrentSlug = v;
    },
    get currentCategory() {
      return currentCategory;
    },
    set currentCategory(v) {
      currentCategory = v;
    },
    get currentSort() {
      return currentSort;
    },
    set currentSort(v) {
      currentSort = v;
    },
    get currentCompactStatus() {
      return currentCompactStatus;
    },
    set currentCompactStatus(v) {
      currentCompactStatus = v;
    },
    get currentCompactStatusOpen() {
      return currentCompactStatusOpen;
    },
    set currentCompactStatusOpen(v) {
      currentCompactStatusOpen = v;
    },
    get badgeState() {
      return badgeState;
    },
    set badgeState(v) {
      badgeState = v;
    },
    get goalSettings() {
      return goalSettings;
    },
    set goalSettings(v) {
      goalSettings = v;
    },
    get lastRenderedListMarkup() {
      return _lastRenderedListMarkup;
    },
    set lastRenderedListMarkup(v) {
      _lastRenderedListMarkup = v;
    },
    get lastMetadataRepairState() {
      return lastMetadataRepairState;
    },
    set lastMetadataRepairState(v) {
      lastMetadataRepairState = v;
    },
    get currentViewMode() {
      return currentViewMode;
    },
    set currentViewMode(v) {
      currentViewMode = v;
    },
    get libraryLoaded() {
      return _libraryLoaded;
    },
    set libraryLoaded(v) {
      _libraryLoaded = v;
    },
    get libraryRevision() {
      return _libraryRevision;
    },
    get libraryLoadState() {
      return _libraryLoadState;
    },
  };

  const COPY_GUARD_STORAGE_KEY = "copyGuardEnabled";
  const GOAL_SETTINGS_KEY = "goalSettings";
  const BADGE_STATE_KEY = "badgeUnlocks";

  const elements = {
    authSection: document.getElementById("authSection"),
    mainApp: document.getElementById("mainApp"),
    googleSignIn: document.getElementById("googleSignIn"),

    settingsBtn: document.getElementById("settingsBtn"),
    settingsAvatar: document.getElementById("settingsAvatar"),
    settingsUserName: document.getElementById("settingsUserName"),
    settingsUserEmail: document.getElementById("settingsUserEmail"),
    settingsDonate: document.getElementById("settingsDonate"),
    settingsRefresh: document.getElementById("settingsRefresh"),
    settingsCopyGuard: document.getElementById("settingsCopyGuard"),
    settingsCopyGuardSubtitle: document.getElementById("settingsCopyGuardSubtitle"),
    settingsDataTools: document.getElementById("settingsDataTools"),
    settingsDataToolsToggle: document.getElementById("settingsDataToolsToggle"),
    settingsDataToolsContent: document.getElementById("settingsDataToolsContent"),
    settingsClear: document.getElementById("settingsClear"),
    settingsExportData: document.getElementById("settingsExportData"),
    settingsImportData: document.getElementById("settingsImportData"),
    settingsImportFile: document.getElementById("settingsImportFile"),
    settingsSignOut: document.getElementById("settingsSignOut"),

    animeList: document.getElementById("animeList"),
    emptyState: document.getElementById("emptyState"),
    searchEmptyState: document.getElementById("searchEmptyState"),
    searchEmptyQuery: document.getElementById("searchEmptyQuery"),
    listLoading: document.getElementById("listLoading"),
    searchInput: document.getElementById("searchInput"),
    totalAnime: document.getElementById("totalAnime"),
    totalMovies: document.getElementById("totalMovies"),
    totalEpisodes: document.getElementById("totalEpisodes"),
    totalTime: document.getElementById("totalTime"),
    confirmDialog: document.getElementById("confirmDialog"),
    confirmClear: document.getElementById("confirmClear"),
    cancelClear: document.getElementById("cancelClear"),
    syncStatus: document.getElementById("syncStatus"),
    syncText: document.getElementById("syncText"),
    versionText: document.getElementById("versionText"),
    donateDropdown: document.getElementById("donateDropdown"),
    donatePaypal: document.getElementById("donatePaypal"),
    donateRevolut: document.getElementById("donateRevolut"),
    sortBtn: document.getElementById("sortBtn"),
    sortDropdown: document.getElementById("sortDropdown"),
    settingsFetchFillers: document.getElementById("settingsFetchFillers"),
    settingsSmartNotif: document.getElementById("settingsSmartNotif"),
    settingsSmartNotifSubtitle: document.getElementById("settingsSmartNotifSubtitle"),
    settingsAutoSkipFiller: document.getElementById("settingsAutoSkipFiller"),
    settingsAutoSkipFillerSubtitle: document.getElementById("settingsAutoSkipFillerSubtitle"),
    settingsPreferences: document.getElementById("settingsPreferences"),
    settingsPreferencesToggle: document.getElementById("settingsPreferencesToggle"),
    settingsPreferencesContent: document.getElementById("settingsPreferencesContent"),

    addAnimeBtn: document.getElementById("addAnimeBtn"),
    addAnimeDialog: document.getElementById("addAnimeDialog"),
    closeAddAnime: document.getElementById("closeAddAnime"),
    cancelAddAnime: document.getElementById("cancelAddAnime"),
    confirmAddAnime: document.getElementById("confirmAddAnime"),
    animeSlugInput: document.getElementById("animeSlug"),
    episodesWatchedInput: document.getElementById("episodesWatched"),

    editTitleDialog: document.getElementById("editTitleDialog"),
    editTitleInput: document.getElementById("editTitleInput"),
    closeEditTitle: document.getElementById("closeEditTitle"),
    cancelEditTitle: document.getElementById("cancelEditTitle"),
    confirmEditTitle: document.getElementById("confirmEditTitle"),

    categoryTabs: document.getElementById("categoryTabs"),
  };

  AT.AddAnimeDialog._init({ elements, markInternalSave, renderAnimeList, updateStats });
  AT.AnimeActions._init({ elements, hideDialog, markInternalSave, renderAnimeList, updateStats });
  AT.RenderList._init({
    elements,
    _ipPatch,
    getActiveFilter,
    markInternalSave,
    normalizeCompactStatus,
    suppressHoverUntilMouseMove,
    updateStats,
  });
  AT.MetadataRepair._init({
    elements,
    detectHasGoogleAuth,
    markInternalSave,
    scheduleDeferredListRefresh,
    sendRuntimeMessage,
    updateStats,
  });
  AT.StatsViews._init({ elements, detectHasGoogleAuth, setTopStatValue, markInternalSave });
  let lastMetadataRepairState = null;
  let lastHydratedLibraryRevision = null;

  const OWN_WRITE_TTL_MS = 15000;
  const ownWriteTokens = new Set();
  const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

  function shouldRunMaintenance(name) {
    try {
      const key = `lastMaintenanceRunAt_${name}`;
      const last = Number(localStorage.getItem(key)) || 0;
      if (Date.now() - last < MAINTENANCE_INTERVAL_MS) return false;
      localStorage.setItem(key, String(Date.now()));
      return true;
    } catch {
      return true;
    }
  }
  let deferredListRefresh = null;
  let realignCategoryTabs = () => {};

  let popupCloudRefreshTimer = null;

  let _lastRenderedListMarkup = null;

  function generateWriteToken() {
    try {
      return crypto.randomUUID();
    } catch {
      return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }

  function markInternalSave(data = null) {
    if (!data || typeof data !== "object") return;
    const token = generateWriteToken();
    data.__writeToken = token;
    ownWriteTokens.add(token);
    setTimeout(() => ownWriteTokens.delete(token), OWN_WRITE_TTL_MS);
  }

  function isOwnStorageChange(changes) {
    const tokenChange = changes.__writeToken;
    if (!tokenChange) return false;
    const token = tokenChange.newValue;
    if (!token || !ownWriteTokens.has(token)) return false;
    ownWriteTokens.delete(token);
    return true;
  }

  function sendRuntimeMessage(message, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("Runtime message timeout"));
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
          resolve(response);
        });
      } catch (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  function setTopStatValue(element, value) {
    if (!element) return;
    const text = value == null ? "0" : String(value);
    const compactLength = text.replace(/\s+/g, "").length;
    element.textContent = text;
    element.classList.toggle("stat-value-long", compactLength >= 5);
    element.classList.toggle("stat-value-xlong", compactLength >= 7);
  }

  function getActiveFilter() {
    return elements.searchInput?.value || "";
  }

  const SMART_NOTIF_STORAGE_KEY = "smartNotificationsEnabled";
  const AUTO_SKIP_FILLER_STORAGE_KEY = "autoSkipFillers";

  const SKIPTIME_HELPER_KEY = "skiptimeHelperEnabled";
  const AUTO_4K_SERVER_KEY = "auto4kServerEnabled";
  const AD_GUARD_KEY = "adGuardEnabled";

  const PASSWORD_SET_MARKER_KEY = "passwordSetMarker";

  const TOGGLE_SETTINGS = {
    copyGuard: {
      btnId: "settingsCopyGuard",
      subtitleId: "settingsCopyGuardSubtitle",
      storageKey: COPY_GUARD_STORAGE_KEY,
      defaultsTo: true,
      interpret: (raw) => raw !== false,
      copy: {
        on: "Block copy outside allowed text",
        off: "Copy protection is turned off",
      },
    },
    smartNotif: {
      btnId: "settingsSmartNotif",
      subtitleId: "settingsSmartNotifSubtitle",
      storageKey: SMART_NOTIF_STORAGE_KEY,
      defaultsTo: false,
      interpret: (raw) => raw === true,
      copy: {
        on: "You will be notified of new episodes",
        off: "Notify when new episodes drop",
      },
    },
    autoSkipFiller: {
      btnId: "settingsAutoSkipFiller",
      subtitleId: "settingsAutoSkipFillerSubtitle",
      storageKey: AUTO_SKIP_FILLER_STORAGE_KEY,
      defaultsTo: false,
      interpret: (raw) => raw === true,
      copy: {
        on: "Filler episodes will be auto-skipped",
        off: "Skip filler, jump to next canon ep",
      },
    },
    skiptime: {
      btnId: "settingsSkiptime",
      subtitleId: "settingsSkiptimeSubtitle",
      storageKey: SKIPTIME_HELPER_KEY,
      defaultsTo: false,
      interpret: (raw) => raw === true,
      copy: {
        on: "Capture intro/outro on an1me.to/watch",
        off: "Floating panel for intro/outro contributions",
      },
    },
    auto4kServer: {
      btnId: "settingsAuto4kServer",
      subtitleId: "settingsAuto4kServerSubtitle",
      storageKey: AUTO_4K_SERVER_KEY,
      defaultsTo: true,
      interpret: (raw) => raw !== false,
      copy: {
        on: "Auto-switch to 4k server when available",
        off: "4k auto-pick is off",
      },
    },
    adGuard: {
      btnId: "settingsAdGuard",
      subtitleId: "settingsAdGuardSubtitle",
      storageKey: AD_GUARD_KEY,
      defaultsTo: true,
      interpret: (raw) => raw !== false,
      copy: {
        on: "Block pop-up ads on an1me.to",
        off: "Pop-up ads are allowed",
      },
    },
  };

  function renderToggle(toggleId, enabled) {
    const config = TOGGLE_SETTINGS[toggleId];
    if (!config) return;
    const btn = document.getElementById(config.btnId);
    if (!btn) return;
    btn.dataset.enabled = enabled ? "true" : "false";
    btn.setAttribute("aria-pressed", enabled ? "true" : "false");
    const subtitle = document.getElementById(config.subtitleId);
    if (subtitle) subtitle.textContent = enabled ? config.copy.on : config.copy.off;
  }

  async function loadToggleSetting(toggleId) {
    const config = TOGGLE_SETTINGS[toggleId];
    if (!config) return false;
    try {
      const result = await chrome.storage.local.get([config.storageKey]);
      const enabled = config.interpret(result[config.storageKey]);
      renderToggle(toggleId, enabled);
      return enabled;
    } catch (error) {
      PopupLogger.warn("Settings", `Failed to load ${toggleId} setting:`, error);
      renderToggle(toggleId, config.defaultsTo);
      return config.defaultsTo;
    }
  }

  const renderCopyGuardSetting = (enabled) => renderToggle("copyGuard", enabled);
  function renderSmartNotifSetting(enabled, status = null) {
    renderToggle("smartNotif", enabled);
    const btn = document.getElementById(TOGGLE_SETTINGS.smartNotif.btnId);
    const subtitle = document.getElementById(TOGGLE_SETTINGS.smartNotif.subtitleId);
    if (btn) {
      if (status && typeof status.operational === "boolean") btn.dataset.operational = status.operational ? "true" : "false";
      else delete btn.dataset.operational;
      btn.setAttribute("aria-busy", status?.pending === true ? "true" : "false");
    }
    if (!subtitle || !enabled) return;
    if (status?.pending === true) {
      subtitle.textContent = "Updating alert schedule...";
      return;
    }
    if (status?.statusUnavailable === true) {
      subtitle.textContent = "Alerts enabled - status unavailable";
      return;
    }
    if (status?.operational === false) {
      subtitle.textContent = "Alerts enabled, but scheduling needs attention";
      return;
    }
    const pendingDeliveries = Math.max(0, Number(status?.pendingDeliveries) || 0);
    if (pendingDeliveries > 0) {
      subtitle.textContent = `Alerts active - ${pendingDeliveries} delivery ${pendingDeliveries === 1 ? "retry" : "retries"} queued`;
      return;
    }
    const nextCheckAt = Number(status?.nextCheckAt) || 0;
    if (nextCheckAt > Date.now()) {
      const time = new Date(nextCheckAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      subtitle.textContent = `Alerts active - next check ${time}`;
      return;
    }
    subtitle.textContent = "Alerts active";
  }
  const renderAutoSkipFillerSetting = (enabled) => renderToggle("autoSkipFiller", enabled);
  const renderSkiptimeHelperSetting = (enabled) => renderToggle("skiptime", enabled);
  const renderAuto4kServerSetting = (enabled) => renderToggle("auto4kServer", enabled);
  const renderAdGuardSetting = (enabled) => renderToggle("adGuard", enabled);
  const loadCopyGuardSetting = () => loadToggleSetting("copyGuard");
  async function loadSmartNotifSetting() {
    try {
      const status = await sendRuntimeMessage({ type: "GET_SMART_NOTIFICATION_STATUS", reconcile: true }, 12000);
      if (!status?.success) throw new Error(status?.error || "Smart notification status is unavailable");
      renderSmartNotifSetting(status.enabled === true, status);
      return status.enabled === true;
    } catch (error) {
      PopupLogger.warn("Settings", "Failed to load operational smart notification status:", error);
      try {
        const stored = await chrome.storage.local.get([SMART_NOTIF_STORAGE_KEY]);
        const enabled = stored[SMART_NOTIF_STORAGE_KEY] === true;
        renderSmartNotifSetting(enabled, { operational: !enabled, statusUnavailable: true });
        return enabled;
      } catch (storageError) {
        PopupLogger.warn("Settings", "Failed to load smart notification preference:", storageError);
        renderSmartNotifSetting(false, { operational: false, statusUnavailable: true });
        return false;
      }
    }
  }
  const loadAutoSkipFillerSetting = () => loadToggleSetting("autoSkipFiller");
  const loadSkiptimeHelperSetting = () => loadToggleSetting("skiptime");
  const loadAuto4kServerSetting = () => loadToggleSetting("auto4kServer");
  const loadAdGuardSetting = () => loadToggleSetting("adGuard");
  AT.refreshSmartNotificationStatus = loadSmartNotifSetting;

  function setSettingsDataToolsExpanded(expanded) {
    const dataTools = document.getElementById("settingsDataTools");
    const toggle = document.getElementById("settingsDataToolsToggle");
    if (!dataTools || !toggle) return;
    const isExpanded = !!expanded;
    dataTools.classList.toggle("expanded", isExpanded);
    toggle.setAttribute("aria-expanded", isExpanded ? "true" : "false");
  }

  function setSettingsPreferencesExpanded(expanded) {
    const prefs = document.getElementById("settingsPreferences");
    const toggle = document.getElementById("settingsPreferencesToggle");
    if (!prefs || !toggle) return;
    const isExpanded = !!expanded;
    prefs.classList.toggle("expanded", isExpanded);
    toggle.setAttribute("aria-expanded", isExpanded ? "true" : "false");
  }

  function doesProgressChangeAffectLists(oldProgress = {}, newProgress = {}) {
    const completedPct = AT.CONFIG?.COMPLETED_PERCENTAGE || 85;
    const keys = new Set([...Object.keys(oldProgress || {}), ...Object.keys(newProgress || {})]);

    for (const key of keys) {
      const oldEntry = oldProgress?.[key];
      const newEntry = newProgress?.[key];
      const oldVisible = !!oldEntry && !oldEntry.deleted && (Number(oldEntry.percentage) || 0) < completedPct;
      const newVisible = !!newEntry && !newEntry.deleted && (Number(newEntry.percentage) || 0) < completedPct;

      if (oldVisible !== newVisible) {
        return true;
      }
    }

    return false;
  }

  function flushDeferredListRefresh() {
    if (!deferredListRefresh) return;
    if (elements.animeList?.matches(":hover")) return;

    const pending = deferredListRefresh;
    deferredListRefresh = null;

    if (pending.timerId) clearTimeout(pending.timerId);

    renderAnimeList(pending.filter);
    if (pending.updateStats) updateStats();
  }

  function scheduleDeferredListRefresh(options = {}) {
    const { filter = getActiveFilter(), updateStats: shouldUpdateStats = true, delayMs = 0 } = options;

    if (!elements.animeList) {
      renderAnimeList(filter);
      if (shouldUpdateStats) updateStats();
      return;
    }

    if (deferredListRefresh?.timerId) {
      clearTimeout(deferredListRefresh.timerId);
    }

    deferredListRefresh = {
      filter,
      updateStats: deferredListRefresh?.updateStats || false || shouldUpdateStats,
      timerId: setTimeout(function attempt() {
        if (elements.animeList?.matches(":hover")) {
          if (deferredListRefresh) deferredListRefresh.timerId = setTimeout(attempt, 800);
          return;
        }
        flushDeferredListRefresh();
      }, delayMs),
    };

    if (!elements.animeList.matches(":hover") && delayMs === 0) {
      flushDeferredListRefresh();
    }
  }

  function normalizeCategory(value) {
    const allowed = new Set(["all", "series", "movies"]);
    return allowed.has(value) ? value : "all";
  }

  function renderCategorySwitch(filter = "") {
    renderAnimeList(filter);
  }

  function normalizeCompactStatus(value) {
    const allowed = new Set(["airing", "on_hold", "completed", "dropped"]);
    return allowed.has(value) ? value : "airing";
  }

  const { repairAiringCompleted: repairAiringCompletedEntries, persistDetectedCompletions } = AT.StatusService;

  const { normalizeMovieDurations, cleanupPhantomMovies, scrubAnilistImportDates } = AT.Maintenance;

  function showAuthScreen() {
    elements.authSection.style.display = "flex";
    elements.mainApp.style.display = "none";

    const hasGoogleAuth = detectHasGoogleAuth();

    PopupLogger.log(
      "Auth",
      `hasGoogleAuth=${hasGoogleAuth} · redirect=${(() => {
        try {
          return chrome?.identity?.getRedirectURL?.() || "∅";
        } catch {
          return "∅";
        }
      })()} · ua="${(navigator.userAgent || "").slice(0, 140)}"`,
    );
    const authContent = document.querySelector(".auth-content");
    if (authContent) {
      authContent.classList.toggle("auth-mobile", !hasGoogleAuth);
    }

    const emailForm = document.getElementById("authEmailForm");
    const orDivider = document.querySelector(".auth-or-divider");
    if (emailForm) emailForm.style.display = "";
    if (orDivider) orDivider.style.display = hasGoogleAuth ? "" : "none";
  }

  function detectHasGoogleAuth() {
    const ua = navigator.userAgent || "";
    if (/Orion|Firefox|FxiOS/i.test(ua)) return false;
    if (/Android|iPhone|iPad|iPod|Mobile|CriOS|EdgiOS/i.test(ua)) return false;
    if (/AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg/i.test(ua)) return false;
    if (!chrome?.identity?.launchWebAuthFlow) return false;
    let redirectUrl = "";
    try {
      redirectUrl = chrome.identity.getRedirectURL?.() || "";
    } catch {
      return false;
    }
    if (!/^https:\/\/[a-z0-9]+\.chromiumapp\.org/.test(redirectUrl)) return false;
    return true;
  }

  function showMainApp(user) {
    elements.authSection.style.display = "none";
    elements.mainApp.style.display = "flex";
    realignCategoryTabs();

    const avatar = document.getElementById("settingsAvatar");
    const userName = document.getElementById("settingsUserName");
    const userEmail = document.getElementById("settingsUserEmail");

    if (user) {
      if (avatar) {
        if (user.photoURL) {
          avatar.src = user.photoURL;
          avatar.onerror = () => {
            avatar.src = "src/icons/icon48.png";
          };
        } else {
          avatar.src = "src/icons/icon48.png";
        }
      }
      if (userName) userName.textContent = user.displayName || user.email?.split("@")[0] || "User";
      if (userEmail) userEmail.textContent = user.email || "";
    } else {
      if (avatar) avatar.src = "src/icons/icon48.png";
      if (userName) userName.textContent = "User";
      if (userEmail) userEmail.textContent = "";
    }
    const activeRepairState = AT.PopupState.lastMetadataRepairState;
    if (activeRepairState?.status === "running") {
      void applyMetadataRepairState(activeRepairState, { autoOpenRunning: !!user });
    } else {
      void restoreDefaultSyncStatus({ immediate: true });
    }

    if (!AT.PopupState.libraryLoaded) {
      try {
        renderAnimeList(getActiveFilter());
      } catch {}
    }
  }

  async function exportLibraryToJson() {
    const { Storage, LibraryBackup } = AT;
    const snapshot = await Storage.get(["animeData", "videoProgress", "deletedAnime", "groupCoverImages", "goalSettings", "badgeUnlocks"]);
    const payload = LibraryBackup.buildPayload(snapshot);
    LibraryBackup.triggerDownload(payload);
    const animeCount = Object.keys(payload.animeData).length;
    AT.UIHelpers?.showToast?.(`Exported ${animeCount} anime`, { type: "success" });
  }

  async function importLibraryFromFile(file) {
    const { Storage, LibraryBackup, LibraryMutations } = AT;

    const text = await file.text();
    const parsed = LibraryBackup.parseAndValidate(text);
    const incomingCount = Object.keys(parsed.animeData).length;

    const ok = await showInlineConfirm({
      title: "Import library backup?",
      body: `This will MERGE ${incomingCount} anime into your library. Local changes are preserved on conflicts (most-recent wins).`,
      confirmLabel: "Import",
      cancelLabel: "Cancel",
      danger: false,
    });
    if (!ok) return;

    const merged = await LibraryMutations.enqueue("import-backup", async ({ commit, snapshot }) => {
      const sidecars = await Storage.get(["goalSettings", "badgeUnlocks"]);
      const local = { ...snapshot, ...sidecars };
      const next = LibraryBackup.mergeImported(local, parsed);
      await commit(next, { markInternalSave, immediate: true });
      return next;
    });

    animeData = merged.animeData;
    videoProgress = merged.videoProgress;
    if (merged.goalSettings) goalSettings = merged.goalSettings;
    badgeState = merged.badgeUnlocks;
    try {
      window.AnimeTracker.groupCoverImages = merged.groupCoverImages;
    } catch {}

    renderAnimeList(elements.searchInput?.value || "");
    await updateStats();

    AT.UIHelpers?.showToast?.(`Imported ${incomingCount} anime`, {
      type: "success",
      duration: 2600,
    });
  }

  let _hoverSuppressionActive = false;
  function suppressHoverUntilMouseMove() {
    if (_hoverSuppressionActive) return;
    _hoverSuppressionActive = true;
    document.body.classList.add("is-suppressing-hover");
    const startedAt = performance.now();

    const MIN_DURATION_MS = 180;
    const release = () => {
      const elapsed = performance.now() - startedAt;
      if (elapsed < MIN_DURATION_MS) {
        setTimeout(() => {
          if (_hoverSuppressionActive) cleanup();
        }, MIN_DURATION_MS - elapsed);
        return;
      }
      cleanup();
    };
    const cleanup = () => {
      _hoverSuppressionActive = false;
      document.body.classList.remove("is-suppressing-hover");
      document.removeEventListener("mousemove", release, true);
      document.removeEventListener("pointermove", release, true);
      clearTimeout(safetyTimer);
    };

    const safetyTimer = setTimeout(cleanup, 800);
    document.addEventListener("mousemove", release, true);
    document.addEventListener("pointermove", release, true);
  }

  function isQuotaExceededError(error) {
    const msg = String(error?.message || error || "").toLowerCase();
    return msg.includes("quota") || msg.includes("bytes") || msg.includes("exceeded");
  }

  function pruneDeletedAnimeForQuota(deletedAnime) {
    const source = deletedAnime && typeof deletedAnime === "object" ? deletedAnime : {};
    const cutoff = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const entries = Object.entries(source).sort((a, b) => {
      const aTs = new Date(a[1]?.deletedAt || a[1] || 0).getTime() || 0;
      const bTs = new Date(b[1]?.deletedAt || b[1] || 0).getTime() || 0;
      return bTs - aTs;
    });

    const kept = {};
    let keptCount = 0;
    for (const [slug, info] of entries) {
      const ts = new Date(info?.deletedAt || info || 0).getTime() || 0;
      if (ts > 0 && ts < cutoff) continue;
      kept[slug] = info;
      keptCount += 1;
      if (keptCount >= 1500) break;
    }
    return kept;
  }

  async function recoverFromQuotaPressure(context = "sync") {
    const { Storage, ProgressManager, LibraryMutations } = AT;

    const QUOTA_BYTES = 10 * 1024 * 1024;
    const TARGET_BYTES = Math.round(QUOTA_BYTES * 0.7);

    const measureBytes = () =>
      new Promise((res) => {
        try {
          chrome.storage.local.getBytesInUse(null, (b) => {
            void chrome.runtime.lastError;
            res(Number(b) || 0);
          });
        } catch {
          res(0);
        }
      });

    try {
      let bytesBefore = await measureBytes();
      PopupLogger.warn("Storage", `[${context}] quota recovery start (bytes=${bytesBefore})`);

      const all = await new Promise((resolve, reject) => {
        chrome.storage.local.get(null, (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(result || {});
        });
      });

      // Prune expired metadata caches only; wiping fresh ones forces a full library re-fetch.
      const { staleKeys, freshKeysOldestFirst } = AT.CachePolicy.partitionMetadataCacheKeys(all);
      if (staleKeys.length > 0) {
        await Storage.remove(staleKeys);
      }

      let capCurrent = await LibraryMutations.enqueue("quota-recovery", async ({ commit, snapshot }) => {
        const localAnimeData = snapshot.animeData || {};
        const localVideoProgress = snapshot.videoProgress || {};
        const localDeletedAnime = snapshot.deletedAnime || {};
        const { cleaned } = ProgressManager.cleanTrackedProgress(localAnimeData, localVideoProgress, localDeletedAnime);
        const sortedProgress = Object.entries(cleaned).sort((a, b) => {
          const aTs = new Date(a[1]?.savedAt || a[1]?.watchedAt || 0).getTime() || 0;
          const bTs = new Date(b[1]?.savedAt || b[1]?.watchedAt || 0).getTime() || 0;
          return bTs - aTs;
        });
        const cap = Math.min(2000, sortedProgress.length);
        await commit(
          {
            videoProgress: Object.fromEntries(sortedProgress.slice(0, cap)),
            deletedAnime: pruneDeletedAnimeForQuota(localDeletedAnime),
          },
          { markInternalSave, immediate: false },
        );
        return cap;
      });

      let bytesNow = await measureBytes();
      let pass = 1;
      const maxPasses = 3;

      while (bytesNow > TARGET_BYTES && pass < maxPasses && capCurrent > 250) {
        pass += 1;
        capCurrent = Math.max(250, Math.floor(capCurrent / 2));
        await LibraryMutations.enqueue(`quota-recovery-pass-${pass}`, async ({ commit, snapshot }) => {
          const { cleaned } = ProgressManager.cleanTrackedProgress(
            snapshot.animeData || {},
            snapshot.videoProgress || {},
            snapshot.deletedAnime || {},
          );
          const sortedProgress = Object.entries(cleaned).sort((a, b) => {
            const aTs = new Date(a[1]?.savedAt || a[1]?.watchedAt || 0).getTime() || 0;
            const bTs = new Date(b[1]?.savedAt || b[1]?.watchedAt || 0).getTime() || 0;
            return bTs - aTs;
          });
          await commit(
            { videoProgress: Object.fromEntries(sortedProgress.slice(0, capCurrent)) },
            { markInternalSave, immediate: false },
          );
        });
        bytesNow = await measureBytes();
        PopupLogger.warn("Storage", `[${context}] pass ${pass}: cap=${capCurrent} bytes=${bytesNow}`);
      }

      // Last resort: still over target — evict fresh metadata caches too, oldest half first.
      let freshEvicted = 0;
      if (bytesNow > TARGET_BYTES && freshKeysOldestFirst.length > 0) {
        let evictCount = Math.ceil(freshKeysOldestFirst.length / 2);
        while (bytesNow > TARGET_BYTES && freshEvicted < freshKeysOldestFirst.length) {
          const batch = freshKeysOldestFirst.slice(freshEvicted, freshEvicted + evictCount);
          await Storage.remove(batch);
          freshEvicted += batch.length;
          bytesNow = await measureBytes();
          evictCount = Math.max(1, Math.ceil((freshKeysOldestFirst.length - freshEvicted) / 2));
        }
      }

      const ok = bytesNow <= TARGET_BYTES;
      PopupLogger.warn(
        "Storage",
        `[${context}] quota recovery ${ok ? "succeeded" : "partial"}: ` +
          `removed ${staleKeys.length} stale + ${freshEvicted} fresh cache keys, progress capped at ${capCurrent}, ` +
          `bytes ${bytesBefore} → ${bytesNow}`,
      );
      return ok;
    } catch (recoveryError) {
      PopupLogger.error("Storage", `[${context}] quota recovery failed:`, recoveryError);
      return false;
    }
  }

  function runMaintenancePipeline(rawData, options = {}) {
    const { ProgressManager, UIHelpers } = AT;
    const { maintenanceSuffix = "", baselineForCleanCount = null, maintenanceDecisions = null } = options;

    const sourceAnime = rawData?.animeData || {};
    const sourceProgress = rawData?.videoProgress || {};
    const sourceDeleted = rawData?.deletedAnime || {};

    const normalized = ProgressManager.normalizeCanonicalSlugs(sourceAnime, sourceProgress, sourceDeleted);

    const withoutAutoRepaired = ProgressManager.removeAutoRepairedEpisodes(normalized.animeData || {});
    const dedupedData = ProgressManager.removeDuplicateEpisodes(withoutAutoRepaired.cleanedData);
    // Drop per-episode defaults (vestigial patchedManually + durationSource:'video')
    // so the stored/synced doc stays compact. Returns the same ref if nothing changed.
    const repairedData = AT.MergeUtils.stripEpisodeDefaultsFromMap(dedupedData);
    const episodeDefaultsStripped = repairedData !== dedupedData;

    const anilistDateScrub = scrubAnilistImportDates(repairedData);
    if (anilistDateScrub.changed) {
      try {
        (window.PopupLogger || console).info?.(
          "Maintenance",
          `Scrubbed bogus watchedAt from ${anilistDateScrub.scrubbedEpisodes} ` +
            `AniList-imported episodes across ${anilistDateScrub.affectedAnime.length} anime`,
        );
      } catch {}
    }
    const rawProgressForDurations = normalized.videoProgress || {};
    const { cleaned: cleanedProgress, removedCount: progressRemoved } = ProgressManager.cleanTrackedProgress(
      repairedData,
      rawProgressForDurations,
      normalized.deletedAnime || sourceDeleted,
    );

    const durationKey = `normalizeMovieDurations${maintenanceSuffix}`;
    const phantomKey = `cleanupPhantomMovies${maintenanceSuffix}`;
    const shouldNormalizeDurations = maintenanceDecisions?.normalizeDurations ?? shouldRunMaintenance(durationKey);
    const shouldCleanupPhantoms = maintenanceDecisions?.cleanupPhantoms ?? shouldRunMaintenance(phantomKey);
    const durationFix = shouldNormalizeDurations
      ? normalizeMovieDurations(repairedData, rawProgressForDurations)
      : { changed: false };
    const phantomCleanup = shouldCleanupPhantoms
      ? cleanupPhantomMovies(repairedData, normalized.deletedAnime || sourceDeleted)
      : { changed: false, deletedAnime: normalized.deletedAnime || sourceDeleted };

    const baseline = baselineForCleanCount ?? sourceAnime;
    const episodeCountChanged = UIHelpers.countEpisodes(baseline) !== UIHelpers.countEpisodes(repairedData);

    const changed =
      episodeCountChanged ||
      episodeDefaultsStripped ||
      withoutAutoRepaired.removedCount > 0 ||
      progressRemoved > 0 ||
      durationFix.changed ||
      anilistDateScrub.changed ||
      normalized.changed ||
      phantomCleanup.changed;

    const deletedChanged = normalized.changed || phantomCleanup.changed;

    return {
      animeData: repairedData,
      videoProgress: cleanedProgress,
      deletedAnime: phantomCleanup.deletedAnime,
      groupCoverImages: rawData?.groupCoverImages || {},
      changed,
      deletedChanged,
      maintenanceDecisions: {
        normalizeDurations: shouldNormalizeDurations,
        cleanupPhantoms: shouldCleanupPhantoms,
      },
    };
  }

  async function persistPipelineResult(result, options = {}) {
    const { LibraryMutations } = AT;
    return LibraryMutations.enqueue("maintenance-pipeline", async ({ commit, snapshot }) => {
      const latestResult = runMaintenancePipeline(snapshot, {
        maintenanceSuffix: options.maintenanceSuffix || "",
        baselineForCleanCount: snapshot.animeData || {},
        maintenanceDecisions: result.maintenanceDecisions,
      });
      if (!latestResult.changed) return latestResult;

      const includeDeleted = options.includeDeleted ?? latestResult.deletedChanged;
      const payload = {
        animeData: latestResult.animeData,
        videoProgress: latestResult.videoProgress,
      };
      if (includeDeleted) payload.deletedAnime = latestResult.deletedAnime;
      await commit(payload, { markInternalSave, immediate: false });
      return latestResult;
    });
  }

  // Merges duplicate entries for the same anime living under two slugs (AniList
  // romaji slug vs real site slug). Detection is cheap and runs each load; the
  // extra reads/writes happen only when a duplicate group is actually found.
  async function dedupeDuplicateAnimeEntries(pipelineDeleted) {
    const { Storage, LibraryMutations, SeasonGrouping, MergeUtils } = AT;
    const Dedupe = window.AnimeTrackerDedupeUtils;
    const Core = window.AniListCore;
    if (!Dedupe || !SeasonGrouping || !MergeUtils?.mergeAnimeData) return;

    try {
      await LibraryMutations.enqueue("dedupe-pass", async ({ commit, snapshot }) => {
        const baseRead = await Storage.get(["anilist_media_map"]);
        const mediaMap = baseRead.anilist_media_map || {};
        const currentAnimeData = snapshot.animeData || animeData || {};
        const helpers = {
          getBaseSlug: (slug, anime) => SeasonGrouping.getBaseSlug(slug, anime),
          getSeasonNumber: (slug) => SeasonGrouping.getSeasonNumber(slug),
          getMovieNumber: (slug) => SeasonGrouping.getMovieNumber(slug),
          isMovie: (slug, anime) => SeasonGrouping.isMovie(slug, anime),
          getMediaType: (slug, anime) => SeasonGrouping.getDisplayMediaType(slug, anime),
          isChronologyGroup: (base) => SeasonGrouping.isChronologyGroup(base),
          resolverVersion: Number(Core?.RESOLVER_V) || 0,
          slugify: (t) =>
            Core?.slugify
              ? Core.slugify(t)
              : String(t || "")
                  .toLowerCase()
                  .trim()
                  .replace(/[^\w\s-]/g, " ")
                  .replace(/[\s_]+/g, "-")
                  .replace(/-+/g, "-")
                  .replace(/^-+|-+$/g, ""),
        };

        const groups = Dedupe.findDuplicateGroups(currentAnimeData, mediaMap, helpers);
        if (!groups.length) return;

        const candidateSlugs = groups.flat();
        const extra = await Storage.get(["anilist_pushed", ...candidateSlugs.map((s) => `animeinfo_${s}`)]);
        const animeinfoBySlug = {};
        for (const slug of candidateSlugs) animeinfoBySlug[slug] = extra[`animeinfo_${slug}`] || null;

        const stores = {
          animeData: { ...currentAnimeData },
          videoProgress: { ...(snapshot.videoProgress || videoProgress || {}) },
          deletedAnime: { ...(snapshot.deletedAnime || pipelineDeleted || {}) },
          groupCoverImages: { ...(snapshot.groupCoverImages || window.AnimeTracker.groupCoverImages || {}) },
          mediaMap: { ...mediaMap },
          pushed: { ...(extra.anilist_pushed || {}) },
          animeinfoBySlug,
        };
        const plan = Dedupe.buildDedupePlan(stores, groups, helpers, {
          mergeAnimeData: MergeUtils.mergeAnimeData,
          mergeVideoProgress: MergeUtils.mergeVideoProgress,
          mergeGroupCoverImages: MergeUtils.mergeGroupCoverImages,
        });
        if (!plan.changed) return;

        PopupLogger.log(
          "Dedupe",
          `Merged ${plan.mergedPairs.length} duplicate entr${plan.mergedPairs.length === 1 ? "y" : "ies"}: ` +
            plan.mergedPairs.map((p) => `${p.loser} → ${p.winner}`).join(", "),
        );

        const payload = {
          animeData: stores.animeData,
          videoProgress: stores.videoProgress,
          deletedAnime: stores.deletedAnime,
          groupCoverImages: stores.groupCoverImages,
          anilist_media_map: stores.mediaMap,
          anilist_pushed: stores.pushed,
        };
        await commit(payload, { markInternalSave, immediate: true, label: "dedupe" });
        if (plan.cacheKeysToRemove.length) await Storage.remove(plan.cacheKeysToRemove);

        // Publish the deduped state only after the atomic local write succeeds.
        animeData = stores.animeData;
        videoProgress = stores.videoProgress;
        window.AnimeTracker.groupCoverImages = stores.groupCoverImages;
      });
    } catch (e) {
      PopupLogger.warn("Dedupe", "Duplicate merge failed:", e?.message || e);
    }
  }

  // Airing badges, episode totals and filler marks all read these caches. Rendering before they
  // are in memory produces a card that looks like nothing was ever fetched for it. Both filler
  // loaders are pure reads; the AniList one has a read-only variant for this early call.
  async function warmMetadataCachesForFirstPaint() {
    const { FillerService } = AT;
    await FillerService.loadCachedEpisodeTypes(animeData);
    await FillerService.loadStayedFillers();
    await AT.AnilistService.primeCachedData(animeData);
  }

  async function finalizeAfterMaintenance() {
    const { FillerService, LibraryMutations } = AT;
    await FillerService.loadCachedEpisodeTypes(animeData);
    await FillerService.loadStayedFillers();
    await AT.AnilistService.loadCachedData(animeData);

    animeData = await LibraryMutations.enqueue("finalize-maintenance", async ({ commit, snapshot }) => {
      const latestAnimeData = snapshot.animeData || {};
      let changed = false;
      for (const anime of Object.values(latestAnimeData)) {
        if (globalThis.AnimeTrackerEntryState?.normalizeListStateMarkers?.(anime)) changed = true;
      }
      if (repairAiringCompletedEntries(latestAnimeData)) changed = true;
      if (persistDetectedCompletions(latestAnimeData)) changed = true;

      if (changed) {
        await commit({ animeData: latestAnimeData }, { markInternalSave, immediate: false });
      }
      return latestAnimeData;
    });
  }

  let _ensureFreshAt = 0;
  async function runAutoFetchIfNeeded() {
    const now = Date.now();
    if (now - _ensureFreshAt < 30000) return;
    _ensureFreshAt = now;
    try {
      const prioritySlugs = Object.entries(animeData || {})
        .filter(([, anime]) => {
          const total = Number(anime?.totalEpisodes) || 0;
          const highest = Math.max(
            0,
            ...(Array.isArray(anime?.episodes) ? anime.episodes : []).map((episode) => Number(episode?.number) || 0),
          );
          return total > 0 && highest >= total;
        })
        .sort(([, left], [, right]) => new Date(right?.lastWatched || 0).getTime() - new Date(left?.lastWatched || 0).getTime())
        .slice(0, 25)
        .map(([slug]) => slug);
      chrome.runtime.sendMessage({ type: "ENSURE_LIBRARY_FRESH", prioritySlugs }, () => void chrome.runtime.lastError);
    } catch {}
  }

  async function startSignInMetadataRepair() {
    const response = await sendRuntimeMessage(
      {
        type: "START_LIBRARY_REPAIR",
        forceInfoRefresh: false,
        forceFillerRefresh: false,
        isMobile: !detectHasGoogleAuth(),
        auto: true,
        origin: "sign-in",
      },
      30000,
    );
    if (!response?.success) {
      throw new Error(response?.error || "Failed to start sign-in fetch");
    }

    const responseState = response.state || null;
    try {
      const persistedState = await syncMetadataRepairStateFromStorage({ autoOpenRunning: true });
      if (persistedState) return persistedState;
      await applyMetadataRepairState(responseState, { autoOpenRunning: true });
      return responseState;
    } catch (error) {
      PopupLogger.warn("Login", `Could not read the latest sign-in fetch state: ${error?.message || error}`);
      await applyMetadataRepairState(responseState, { autoOpenRunning: true });
      return responseState;
    }
  }

  async function warmCoverCache() {
    try {
      const CoverCache = AT.CoverCache;
      const sanitize = AT.UIHelpers?.sanitizeImageUrl?.bind(AT.UIHelpers);
      if (!CoverCache || !sanitize) return;
      const urls = [];
      for (const slug in animeData) {
        const safe = sanitize(animeData[slug]?.coverImage);
        if (safe) urls.push(safe);
      }
      const groupImgs = window.AnimeTracker.groupCoverImages || {};
      for (const key in groupImgs) {
        const safe = sanitize(groupImgs[key]);
        if (safe) urls.push(safe);
      }
      await CoverCache.warm(urls);
    } catch (e) {
      PopupLogger.debug("CoverCache", "warm failed:", e?.message || e);
    }
  }

  const LIBRARY_SNAPSHOT_KEYS = Object.freeze([
    "animeData",
    "videoProgress",
    "groupCoverImages",
    "deletedAnime",
    "libraryMutationRevision",
  ]);

  function normalizeLibraryRevision(value) {
    return Math.max(0, Number(value) || 0);
  }

  function publishLibrarySnapshot(snapshot) {
    animeData = snapshot?.animeData || {};
    videoProgress = snapshot?.videoProgress || {};
    window.AnimeTracker.groupCoverImages = snapshot?.groupCoverImages || {};
    if (snapshot && Object.prototype.hasOwnProperty.call(snapshot, "libraryMutationRevision")) {
      _libraryRevision = normalizeLibraryRevision(snapshot.libraryMutationRevision);
    }
  }

  function applyLibraryLoadState(nextState) {
    const wasBusy = _libraryLoadState.busy;
    _libraryLoadState = nextState;

    const loadingText = elements.listLoading?.querySelector(".list-loading-text");
    if (loadingText) {
      const messages = {
        queued: "Loading your library\u2026",
        cloud: "Syncing your library\u2026",
        local: "Loading your library\u2026",
        maintenance: "Preparing your library\u2026",
        finalizing: "Finishing your library\u2026",
      };
      loadingText.textContent = messages[nextState.phase] || "Loading your library\u2026";
      elements.listLoading.dataset.phase = nextState.phase;
    }

    if (wasBusy !== nextState.busy && Object.keys(animeData).length === 0) {
      try {
        renderAnimeList(getActiveFilter());
      } catch {}
    }
  }

  // Tracked apart from currentCompactStatus, which renderAnimeList temporarily reassigns when the
  // chosen status has no entries in the active category. Only an actual chip click updates this.
  let preferredCompactStatus = "airing";

  // Single writer for userPreferences: every call sends the whole object, so a partial write
  // here would silently drop whichever preference it left out.
  function persistLibraryPreferences({ rememberCompactStatus = false } = {}) {
    if (rememberCompactStatus) preferredCompactStatus = normalizeCompactStatus(currentCompactStatus);
    try {
      const saved = chrome.storage.local.set({
        userPreferences: {
          sort: currentSort,
          category: currentCategory,
          compactStatus: preferredCompactStatus,
          // Only the section toggle writes this one, so the live value is always the user's choice.
          compactStatusOpen: currentCompactStatusOpen === true,
        },
      });
      if (saved && typeof saved.catch === "function") saved.catch((e) => window.__atSwallow("savePref", e));
    } catch {}
  }
  AT.saveLibraryPreferences = (options) => persistLibraryPreferences(options);

  async function loadLibraryPreferences() {
    const prefs = await chrome.storage.local.get(["userPreferences"]);
    if (!prefs.userPreferences) return;

    currentSort = prefs.userPreferences.sort || "date";
    currentCategory = normalizeCategory(prefs.userPreferences.category || "all");
    preferredCompactStatus = normalizeCompactStatus(prefs.userPreferences.compactStatus);
    currentCompactStatus = preferredCompactStatus;
    currentCompactStatusOpen = prefs.userPreferences.compactStatusOpen === true;
    document.querySelectorAll(".sort-option").forEach((option) => {
      option.classList.toggle("active", option.dataset.sort === currentSort);
    });
    if (elements.categoryTabs) {
      elements.categoryTabs.querySelectorAll(".category-tab").forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.category === currentCategory);
      });
      realignCategoryTabs();
    }
  }

  async function hydrateLibraryFromLocal(request, context) {
    const { Storage } = AT;
    context.setPhase(AT.LibraryLoadController.PHASES.LOCAL);

    if (shouldRunMaintenance("migrateMultiPartAnime")) {
      await Storage.migrateMultiPartAnime();
    }

    const stored = await Storage.get(LIBRARY_SNAPSHOT_KEYS);
    const sourceRevision = normalizeLibraryRevision(stored.libraryMutationRevision);
    const canSkip =
      request.allowRevisionSkip &&
      !request.forceHydrate &&
      AT.PopupState.libraryLoaded &&
      lastHydratedLibraryRevision !== null &&
      sourceRevision === lastHydratedLibraryRevision;

    if (canSkip) {
      if (!request.skipAutoFetch) await runAutoFetchIfNeeded();
      return {
        skipped: true,
        revision: sourceRevision,
        animeCount: Object.keys(animeData).length,
      };
    }

    context.setPhase(AT.LibraryLoadController.PHASES.MAINTENANCE);
    const maintenanceSuffix = request.maintenanceSuffix || "";
    let pipeline = runMaintenancePipeline(stored, {
      maintenanceSuffix,
      baselineForCleanCount: stored.animeData || {},
    });

    publishLibrarySnapshot(pipeline);
    if (!AT.PopupState.libraryLoaded) {
      // Warm the info/filler caches first: this is the popup's first paint, and it used to land
      // before finalizeAfterMaintenance loaded them, so every card showed as un-fetched until the
      // second render seconds later. Read-only — the pipeline below is not persisted yet.
      await warmMetadataCachesForFirstPaint();
      AT.PopupState.libraryLoaded = true;
      renderAnimeList(getActiveFilter());
      await updateStats();
    }

    if (pipeline.changed) {
      pipeline = await persistPipelineResult(pipeline, { maintenanceSuffix });
      publishLibrarySnapshot(pipeline);
    }

    context.setPhase(AT.LibraryLoadController.PHASES.FINALIZING);
    await dedupeDuplicateAnimeEntries(pipeline.deletedAnime);
    await finalizeAfterMaintenance();

    const finalSnapshot = await Storage.get(LIBRARY_SNAPSHOT_KEYS);
    publishLibrarySnapshot(finalSnapshot);
    lastHydratedLibraryRevision = normalizeLibraryRevision(finalSnapshot.libraryMutationRevision);

    await warmCoverCache();
    renderAnimeList(getActiveFilter());
    await Promise.all([updateStats(), loadGoalAndBadgeState()]);

    if (!request.skipAutoFetch) await runAutoFetchIfNeeded();

    return {
      skipped: false,
      revision: lastHydratedLibraryRevision,
      animeCount: Object.keys(animeData).length,
    };
  }

  async function hydrateLibraryWithRecovery(request, context) {
    try {
      return await hydrateLibraryFromLocal(request, context);
    } catch (error) {
      if (!isQuotaExceededError(error)) throw error;
      const recovered = await recoverFromQuotaPressure("library-load");
      if (!recovered) throw error;
      return hydrateLibraryFromLocal({ ...request, forceHydrate: true }, context);
    }
  }

  async function executeLibraryLoadRequest(request, context) {
    let cloudResponse = null;
    try {
      if (request.loadPreferences) await loadLibraryPreferences();

      let hydration = null;
      if (request.cloudMode !== "none" && !AT.PopupState.libraryLoaded) {
        hydration = await hydrateLibraryWithRecovery({ ...request, skipAutoFetch: true }, context);
      }

      if (request.cloudMode !== "none") {
        context.setPhase(AT.LibraryLoadController.PHASES.CLOUD);
        const forceFresh = request.cloudMode === "force";
        const cloudReason = request.reasons?.join(", ") || (forceFresh ? "popup:manual-refresh" : "popup:refresh");
        cloudResponse = await sendRuntimeMessage(
          {
            type: forceFresh ? "WAKE_AND_POLL_CLOUD_FORCE" : "WAKE_AND_POLL_CLOUD",
            waitForCompletion: true,
            reason: cloudReason,
          },
          90000,
        );
        if (!cloudResponse?.success) {
          const cloudError = new Error(cloudResponse?.error || "Cloud refresh failed");
          if (cloudResponse?.code) cloudError.code = cloudResponse.code;
          throw cloudError;
        }
      }

      if (request.cloudMode === "none" || cloudResponse) {
        hydration = await hydrateLibraryWithRecovery(
          request.cloudMode === "none" ? request : { ...request, maintenanceSuffix: "_postSync" },
          context,
        );
      }
      AT.FirebaseSync.lastSyncResult = {
        source:
          request.cloudMode === "none"
            ? "local-storage"
            : hydration.skipped
              ? "cloud-checked-local-current"
              : "cloud-merged-local-storage",
        cloudDocFound: cloudResponse?.cloudDocFound ?? null,
        animeCount: hydration.animeCount,
        revision: hydration.revision,
      };
      return { ...hydration, cloudResponse };
    } catch (error) {
      PopupLogger.error(request.cloudMode === "none" ? "Storage" : "Sync", "Library load failed:", error);

      if (error?.code === "AUTH_REJECTED") {
        showToast({
          title: "Session expired",
          body: error.message || "Please sign in again to sync your library.",
          type: "error",
          duration: 7000,
        });
        try {
          await AT.FirebaseSync.signOut();
        } catch {}
      }

      if (!AT.PopupState.libraryLoaded) {
        animeData = {};
        videoProgress = {};
        AT.PopupState.libraryLoaded = true;
        renderAnimeList(getActiveFilter());
        // The empty animeData above is a failure placeholder, not the library — caching its zeros
        // would make every later popup open start by painting 0s from cachedStats.
        await updateStats({ persist: false });
      }
      throw error;
    }
  }

  const libraryLoadController = AT.LibraryLoadController.create({
    execute: executeLibraryLoadRequest,
    onStateChange: applyLibraryLoadState,
  });

  function loadAndSyncData(options = {}) {
    return libraryLoadController.request({
      cloudMode: options.cloudMode || "none",
      skipAutoFetch: options.skipAutoFetch === true,
      forceHydrate: options.forceHydrate === true,
      allowRevisionSkip: options.allowRevisionSkip !== false,
      loadPreferences: options.loadPreferences ?? !AT.PopupState.libraryLoaded,
      reason: options.reason || "popup:library-load",
    });
  }

  function loadData(options = {}) {
    return loadAndSyncData({
      ...options,
      cloudMode: "none",
      reason: options.reason || "popup:local-load",
    });
  }

  function refreshPopupCloudData(forceFresh = false, options = {}) {
    if (!AT?.FirebaseSync?.getUser?.()) {
      return Promise.resolve({ success: true, skipped: true, reason: "not-authenticated" });
    }
    return loadAndSyncData({
      ...options,
      cloudMode: forceFresh ? "force" : "regular",
      reason: forceFresh ? "popup:manual-refresh" : options.reason || "popup:refresh",
    });
  }

  function stopPopupCloudRefresh() {
    if (popupCloudRefreshTimer) {
      clearInterval(popupCloudRefreshTimer);
      popupCloudRefreshTimer = null;
    }
  }

  function startPopupCloudRefresh() {
    stopPopupCloudRefresh();
    popupCloudRefreshTimer = setInterval(() => {
      refreshPopupCloudData(false, { skipAutoFetch: true })
        .catch((e) => PopupLogger.debug("Sync", "Periodic cloud refresh skipped:", e?.message || e));
    }, 3 * 60 * 1000);
  }

  const { open: openDialogA11y, close: closeDialogA11y, inlineConfirm: showInlineConfirm } = AT.Dialogs;

  function showDialog() {
    openDialogA11y(elements.confirmDialog);
  }
  function hideDialog() {
    closeDialogA11y(elements.confirmDialog);
  }

  let _addDialogDetectedTitle = null;
  let _addDialogKnownTotal = null;
  let _addDialogFinalTotal = null;
  let _addDialogMediaType = null;
  let _addDialogTotalCanon = null;
  let _addDialogSlugDebounce = null;
  let _addDialogCurrentSlug = null;

  window.AnimeTracker = window.AnimeTracker || {};
  window.AnimeTracker.__addDialogState = { knownTotal: null };

  const { parseRanges: parseEpisodeRanges, splitCanonAndFillers, renderEpisodesPreview: updateEpisodesPreview } = AT.EpisodeParse;

  AT.refreshSettingsViewIfOpen = () => {
    if (currentViewMode === "settings") renderSettingsView();
  };

  async function signOut(preserveLocalData = true) {
    const { LibraryMutations, FirebaseSync } = AT;
    if (!preserveLocalData) {
      animeData = {};
      videoProgress = {};
      await LibraryMutations.commit(
        { animeData: {}, videoProgress: {} },
        { label: "sign-out-clear-local", markInternalSave, sync: false },
      );
    }
    lastMetadataRepairState = null;
    await chrome.storage.local.set({ pendingBackgroundMetadataRepair: false, metadataRepairState: null });
    await FirebaseSync.signOut();
    renderAnimeList();
    updateStats();
  }

  function initEventListeners() {
    const { CONFIG, DONATE_LINKS, FirebaseSync } = AT;

    if (elements.googleSignIn) elements.googleSignIn.addEventListener("click", signInWithGoogle);

    const emailForm = document.getElementById("authEmailForm");
    const emailSignInBtn = document.getElementById("emailSignInBtn");
    const forgotPasswordBtn = document.getElementById("authForgotPasswordBtn");
    if (emailForm && emailSignInBtn) {
      emailForm.addEventListener("submit", (e) => {
        e.preventDefault();
        handleEmailAuth({ mode: "signin" });
      });
    }
    if (forgotPasswordBtn) {
      forgotPasswordBtn.addEventListener("click", () => handleForgotPassword());
    }

    if (elements.settingsBtn) {
      elements.settingsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (elements.donateDropdown) elements.donateDropdown.classList.remove("visible");
        if (elements.sortDropdown) elements.sortDropdown.classList.remove("visible");
        if (elements.sortBtn) elements.sortBtn.classList.remove("active");
        const next = currentViewMode === "settings" ? null : "settings";
        setViewMode(next);
      });
    }

    document.addEventListener("click", (e) => {
      if (
        elements.donateDropdown &&
        !elements.donateDropdown.contains(e.target) &&
        (!getSettingsDonateButton() || !getSettingsDonateButton().contains(e.target))
      ) {
        closeDonateDropdown();
      }
    });

    document.addEventListener("click", (e) => {
      const donateTrigger = e.target.closest("#settingsDonate");
      if (!donateTrigger) return;
      e.stopPropagation();

      if (elements.donateDropdown?.classList.contains("visible")) {
        closeDonateDropdown();
        return;
      }
      setSettingsDataToolsExpanded(false);
      setSettingsPreferencesExpanded(false);
      setTimeout(openDonateDropdown, 80);
    });

    const settingsViewEl = document.getElementById("settingsView");
    settingsViewEl?.addEventListener(
      "scroll",
      () => {
        if (elements.donateDropdown?.classList.contains("visible")) {
          positionDonateDropdown();
        }
      },
      { passive: true },
    );

    window.addEventListener("resize", () => {
      if (elements.donateDropdown?.classList.contains("visible")) {
        positionDonateDropdown();
      }
    });

    const handleToggle = async (key, renderFn, getNext, onAfterSave) => {
      const btn = document.getElementById(key.btnId);
      if (!btn) return;
      const currentlyEnabled = getNext.read(btn);
      const nextEnabled = !currentlyEnabled;
      renderFn(nextEnabled);
      try {
        const playbackSettingsUpdatedAt = new Date().toISOString();
        await AT.Storage.set({
          [key.storageKey]: nextEnabled,
          playbackSettingsUpdatedAt,
        });
        if (onAfterSave) {
          try {
            await onAfterSave(nextEnabled);
          } catch (sideEffectError) {
            PopupLogger.warn("Settings", `Post-save action failed for ${key.btnId}: ${sideEffectError?.message}`);
          }
        }

        try {
          await FirebaseSync.queuePlaybackSettingsSave();
        } catch (syncError) {
          PopupLogger.warn("Settings", `Cloud sync queue failed for ${key.btnId}: ${syncError?.message}`);
        }
      } catch (error) {
        PopupLogger.error("Settings", `Failed to update ${key.btnId}:`, error);
        renderFn(currentlyEnabled);
      }
    };

    let smartNotifToggleInFlight = false;

    document.addEventListener("click", async (e) => {
      if (e.target.closest("#settingsCopyGuard")) {
        e.stopPropagation();
        await handleToggle({ btnId: "settingsCopyGuard", storageKey: COPY_GUARD_STORAGE_KEY }, renderCopyGuardSetting, {
          read: (btn) => btn.dataset.enabled !== "false",
        });
        return;
      }
      if (e.target.closest("#settingsSmartNotif")) {
        e.stopPropagation();
        if (smartNotifToggleInFlight) return;
        const btn = document.getElementById("settingsSmartNotif");
        if (!btn) return;
        const currentlyEnabled = btn.dataset.enabled === "true";
        const nextEnabled = !currentlyEnabled;
        smartNotifToggleInFlight = true;
        btn.disabled = true;
        renderSmartNotifSetting(nextEnabled, { pending: true });
        try {
          const response = await sendRuntimeMessage({ type: "SET_SMART_NOTIFICATIONS", enabled: nextEnabled }, 20000);
          if (!response?.success || response.enabled !== nextEnabled || response.operational !== true) {
            throw new Error(response?.error || "Smart notification schedule was not applied");
          }
          renderSmartNotifSetting(nextEnabled, response);
          AT.UIHelpers?.showToast?.(nextEnabled ? "New episode alerts enabled" : "New episode alerts disabled", {
            type: "success",
            duration: 1800,
          });
        } catch (error) {
          PopupLogger.warn("Settings", "Smart notification update did not return a confirmed result:", error);
          const recoveredEnabled = await loadSmartNotifSetting();
          AT.UIHelpers?.showToast?.(
            recoveredEnabled === nextEnabled ? "New episode alert setting updated" : "Could not update new episode alerts",
            { type: recoveredEnabled === nextEnabled ? "success" : "error", duration: 2200 },
          );
        } finally {
          smartNotifToggleInFlight = false;
          const activeButton = document.getElementById("settingsSmartNotif");
          if (activeButton) {
            activeButton.disabled = false;
            activeButton.setAttribute("aria-busy", "false");
          }
        }
        return;
      }
      if (e.target.closest("#settingsAutoSkipFiller")) {
        e.stopPropagation();
        await handleToggle({ btnId: "settingsAutoSkipFiller", storageKey: AUTO_SKIP_FILLER_STORAGE_KEY }, renderAutoSkipFillerSetting, {
          read: (btn) => btn.dataset.enabled === "true",
        });
        return;
      }
      if (e.target.closest("#settingsSkiptime")) {
        e.stopPropagation();
        await handleToggle(
          { btnId: "settingsSkiptime", storageKey: SKIPTIME_HELPER_KEY },
          renderSkiptimeHelperSetting,
          { read: (btn) => btn.dataset.enabled === "true" },
          (enabled) =>
            AT.UIHelpers?.showToast?.(enabled ? "Skiptime helper enabled" : "Skiptime helper disabled", {
              type: "success",
              duration: 1600,
            }),
        );
        return;
      }
      if (e.target.closest("#settingsAuto4kServer")) {
        e.stopPropagation();
        await handleToggle({ btnId: "settingsAuto4kServer", storageKey: AUTO_4K_SERVER_KEY }, renderAuto4kServerSetting, {
          read: (btn) => btn.dataset.enabled !== "false",
        });
        return;
      }
      if (e.target.closest("#settingsAdGuard")) {
        e.stopPropagation();
        await handleToggle({ btnId: "settingsAdGuard", storageKey: AD_GUARD_KEY }, renderAdGuardSetting, {
          read: (btn) => btn.dataset.enabled !== "false",
        });
        return;
      }

      const dataToolsToggle = e.target.closest("#settingsDataToolsToggle");
      if (dataToolsToggle) {
        e.stopPropagation();
        const dataTools = document.getElementById("settingsDataTools");
        const isExpanded = dataTools?.classList.contains("expanded");
        setSettingsDataToolsExpanded(!isExpanded);
        setSettingsPreferencesExpanded(false);
        return;
      }

      const prefsToggle = e.target.closest("#settingsPreferencesToggle");
      if (prefsToggle) {
        e.stopPropagation();
        const prefs = document.getElementById("settingsPreferences");
        const isExpanded = prefs?.classList.contains("expanded");
        setSettingsPreferencesExpanded(!isExpanded);
        setSettingsDataToolsExpanded(false);
        return;
      }

      const refreshBtn = e.target.closest("#settingsRefresh");
      if (refreshBtn) {
        refreshBtn.classList.add("loading");
        setSettingsDataToolsExpanded(false);
        setSettingsPreferencesExpanded(false);
        setMetadataRepairStatus("Refreshing…", false, { source: "manual" });
        const startedAt = Date.now();
        try {
          if (FirebaseSync.getUser()) {
            await refreshPopupCloudData(true, { skipAutoFetch: true });
          } else {
            await loadData({ skipAutoFetch: true });
          }
          const elapsed = Date.now() - startedAt;
          if (elapsed < 500) await new Promise((r) => setTimeout(r, 500 - elapsed));
          setMetadataRepairStatus("Refreshed", true, { source: "manual" });
          scheduleDefaultSyncStatusRestore(2500, "manual");
        } catch (error) {
          PopupLogger.error("RefreshData", "Error:", error);
          setMetadataRepairStatus("Refresh failed", false, { source: "manual", error: true, title: error?.message || "Refresh failed" });
          scheduleDefaultSyncStatusRestore(2500, "manual");
        } finally {
          refreshBtn.classList.remove("loading");
        }
        return;
      }

      if (e.target.closest("#settingsClear")) {
        setSettingsDataToolsExpanded(false);
        setSettingsPreferencesExpanded(false);
        showDialog();
        return;
      }

      if (e.target.closest("#settingsExportData")) {
        setSettingsDataToolsExpanded(false);
        exportLibraryToJson().catch((err) => {
          PopupLogger.error("Export", err);
          AT.UIHelpers?.showToast?.("Export failed", { type: "error", duration: 3500 });
        });
        return;
      }

      if (e.target.closest("#settingsImportData")) {
        const fileInput = document.getElementById("settingsImportFile");
        if (fileInput) {
          fileInput.value = "";
          fileInput.click();
        }
        return;
      }

      if (e.target.closest("#settingsSignOut")) {
        setSettingsDataToolsExpanded(false);
        setSettingsPreferencesExpanded(false);
        signOut();
        return;
      }

      if (e.target.closest("#settingsReauthBtn")) {
        setSettingsDataToolsExpanded(false);
        setSettingsPreferencesExpanded(false);
        signOut(true);
        return;
      }

      if (e.target.closest("#settingsSetPassword")) {
        setSettingsDataToolsExpanded(false);
        setSettingsPreferencesExpanded(false);
        AT.openSetPasswordModal();
        return;
      }

      if (e.target.closest("#settingsFetchFillers")) {
        setSettingsDataToolsExpanded(false);
        setSettingsPreferencesExpanded(false);

        try {
          await fetchAllFillers({
            autoStart: true,
            forceInfoRefresh: false,
            forceFillerRefresh: false,
          });
        } catch (error) {
          PopupLogger.error("RepairAll", "Fetch button failed:", error);
          AT.UIHelpers?.showToast?.(error?.message || "Fetch failed", { type: "error", duration: 3500 });
        }
        return;
      }
    });

    document.addEventListener("change", async (e) => {
      if (e.target?.id === "settingsImportFile") {
        const file = e.target.files?.[0];
        if (!file) return;
        setSettingsDataToolsExpanded(false);
        try {
          await importLibraryFromFile(file);
        } catch (err) {
          PopupLogger.error("Import", err);
          AT.UIHelpers?.showToast?.(err?.message || "Import failed", {
            type: "error",
            duration: 4000,
          });
        } finally {
          e.target.value = "";
        }
      }
    });

    if (elements.searchInput) {
      let searchTimeout = null;
      elements.searchInput.addEventListener("input", (e) => {
        if (searchTimeout) clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => renderAnimeList(e.target.value), CONFIG.SEARCH_DEBOUNCE_MS);
      });
    }

    const _mainContentScroll = document.querySelector(".main-content");
    const _mainAppRoot = document.querySelector(".main-app");
    if (_mainContentScroll && _mainAppRoot) {
      const COMPACT_RANGE = 64;
      const SHADOW_ON = 12;
      const SHADOW_OFF = 4;
      const _isTouch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
      let _scrollDebounce = null;
      let _lastProgress = -1;
      const updateScrolledClass = () => {
        const top = _mainContentScroll.scrollTop;

        if (!_isTouch) {
          const progress = Math.max(0, Math.min(1, top / COMPACT_RANGE));
          if (progress !== _lastProgress) {
            _lastProgress = progress;
            _mainAppRoot.style.setProperty("--sc", progress.toFixed(3));
          }
        }

        const isScrolled = _mainAppRoot.classList.contains("is-scrolled");
        if (!isScrolled && top > SHADOW_ON) {
          _mainAppRoot.classList.add("is-scrolled");
        } else if (isScrolled && top <= SHADOW_OFF) {
          _mainAppRoot.classList.remove("is-scrolled");
        }
      };
      _mainContentScroll.addEventListener(
        "scroll",
        () => {
          if (_scrollDebounce) return;
          _scrollDebounce = requestAnimationFrame(() => {
            _scrollDebounce = null;
            updateScrolledClass();
          });
        },
        { passive: true },
      );
      updateScrolledClass();
    }

    if (elements.confirmClear) elements.confirmClear.addEventListener("click", clearAllData);
    if (elements.cancelClear) elements.cancelClear.addEventListener("click", hideDialog);
    if (elements.confirmDialog) {
      elements.confirmDialog.addEventListener("click", (e) => {
        if (e.target === elements.confirmDialog) hideDialog();
      });
    }

    if (elements.addAnimeBtn) elements.addAnimeBtn.addEventListener("click", showAddAnimeDialog);

    const emptyStateAddBtn = document.getElementById("emptyStateAddBtn");
    if (emptyStateAddBtn) emptyStateAddBtn.addEventListener("click", showAddAnimeDialog);
    if (elements.closeAddAnime) elements.closeAddAnime.addEventListener("click", hideAddAnimeDialog);
    if (elements.cancelAddAnime) elements.cancelAddAnime.addEventListener("click", hideAddAnimeDialog);
    if (elements.confirmAddAnime) elements.confirmAddAnime.addEventListener("click", addAnimeWithEpisodes);
    if (elements.addAnimeDialog) {
      elements.addAnimeDialog.addEventListener("click", (e) => {
        if (e.target === elements.addAnimeDialog) hideAddAnimeDialog();
      });
    }

    if (elements.animeSlugInput) {
      elements.animeSlugInput.addEventListener("input", () => {
        prepareSlugInput(elements.animeSlugInput.value);
        if (elements.episodesWatchedInput && elements.episodesWatchedInput.value) {
          updateEpisodesPreview(elements.episodesWatchedInput.value);
        }

        if (_addDialogSlugDebounce) clearTimeout(_addDialogSlugDebounce);
        _addDialogSlugDebounce = setTimeout(() => {
          _addDialogSlugDebounce = null;
          const raw = elements.animeSlugInput.value.trim();
          if (raw) onSlugInputChange(raw).catch((e) => window.__atSwallow("onSlugInputChange", e));
        }, 500);
      });
      elements.animeSlugInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") elements.episodesWatchedInput.focus();
      });
    }

    if (elements.addAnimeDialog) {
      elements.addAnimeDialog.addEventListener("click", (e) => {
        const chip = e.target.closest(".ep-chip");
        if (chip && elements.addAnimeDialog.contains(chip)) {
          e.preventDefault();
          const action = chip.dataset.action;
          if (action === "all" && _addDialogKnownTotal) {
            elements.episodesWatchedInput.value = `1-${_addDialogKnownTotal}`;
            const cb = document.getElementById("includeFillers");
            if (cb) cb.checked = true;
            updateEpisodesPreview(elements.episodesWatchedInput.value);
            elements.episodesWatchedInput.focus();
          } else if (action === "canon" && _addDialogKnownTotal) {
            const slug = _addDialogCurrentSlug;
            const all = [];
            for (let i = 1; i <= _addDialogKnownTotal; i++) all.push(i);
            const { canon } = AT.EpisodeParse.splitCanonAndFillers(slug, all);
            elements.episodesWatchedInput.value = AT.EpisodeParse.buildRangeString(canon);
            const cb = document.getElementById("includeFillers");
            if (cb) cb.checked = false;
            updateEpisodesPreview(elements.episodesWatchedInput.value);
            elements.episodesWatchedInput.focus();
          } else if (action === "skip-fillers") {
            const raw = elements.episodesWatchedInput.value.trim();
            if (!raw) return;
            const slug = _addDialogCurrentSlug;
            const all = parseEpisodeRanges(raw);
            const { canon } = AT.EpisodeParse.splitCanonAndFillers(slug, all);
            if (canon.length === all.length) return;
            elements.episodesWatchedInput.value = AT.EpisodeParse.buildRangeString(canon);
            const cb = document.getElementById("includeFillers");
            if (cb) cb.checked = false;
            updateEpisodesPreview(elements.episodesWatchedInput.value);
          }
          return;
        }

        const toggle = e.target.closest(".fab-filler-toggle");
        if (toggle && elements.addAnimeDialog.contains(toggle)) {
          e.preventDefault();
          const expanded = toggle.getAttribute("aria-expanded") === "true";
          toggle.setAttribute("aria-expanded", expanded ? "false" : "true");

          let details = toggle._detailsEl;
          if (!details) {
            const id = toggle.getAttribute("aria-controls");
            if (id) details = document.getElementById(id);
          }
          if (details) details.hidden = expanded;
          const chevron = toggle.querySelector(".fab-chevron");
          if (chevron) chevron.style.transform = expanded ? "" : "rotate(180deg)";
          return;
        }
      });
    }
    if (elements.episodesWatchedInput) {
      elements.episodesWatchedInput.addEventListener("input", (e) => updateEpisodesPreview(e.target.value));
      elements.episodesWatchedInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") addAnimeWithEpisodes();
      });
    }

    const includeFillersCb = document.getElementById("includeFillers");
    if (includeFillersCb) {
      includeFillersCb.addEventListener("change", () => {
        if (elements.episodesWatchedInput) {
          updateEpisodesPreview(elements.episodesWatchedInput.value);
        }
      });
    }

    if (elements.closeEditTitle) elements.closeEditTitle.addEventListener("click", hideEditTitleDialog);
    if (elements.cancelEditTitle) elements.cancelEditTitle.addEventListener("click", hideEditTitleDialog);
    if (elements.confirmEditTitle) elements.confirmEditTitle.addEventListener("click", saveEditedTitle);
    if (elements.editTitleDialog) {
      elements.editTitleDialog.addEventListener("click", (e) => {
        if (e.target === elements.editTitleDialog) hideEditTitleDialog();
      });
    }
    if (elements.editTitleInput) {
      elements.editTitleInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") saveEditedTitle();
      });
    }

    if (elements.donatePaypal) {
      elements.donatePaypal.addEventListener("click", () => {
        window.open(DONATE_LINKS.paypal, "_blank");
        elements.donateDropdown.classList.remove("visible");
      });
    }
    if (elements.donateRevolut) {
      elements.donateRevolut.addEventListener("click", () => {
        window.open(DONATE_LINKS.revolut, "_blank");
        elements.donateDropdown.classList.remove("visible");
      });
    }

    if (elements.sortBtn) {
      elements.sortBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        elements.sortDropdown.classList.toggle("visible");
        elements.sortBtn.classList.toggle("active");
      });
    }

    document.querySelectorAll(".sort-option").forEach((option) => {
      option.addEventListener("click", async () => {
        currentSort = option.dataset.sort;
        document.querySelectorAll(".sort-option").forEach((o) => o.classList.remove("active"));
        option.classList.add("active");
        if (elements.searchInput) renderAnimeList(elements.searchInput.value);
        if (elements.sortDropdown) elements.sortDropdown.classList.remove("visible");
        if (elements.sortBtn) elements.sortBtn.classList.remove("active");
        persistLibraryPreferences();
      });
    });

    document.addEventListener("click", (e) => {
      if (elements.sortDropdown && elements.sortBtn && !elements.sortDropdown.contains(e.target) && !elements.sortBtn.contains(e.target)) {
        elements.sortDropdown.classList.remove("visible");
        elements.sortBtn.classList.remove("active");
      }
    });

    if (elements.categoryTabs) {
      const slider = document.createElement("div");
      slider.className = "category-tabs-slider";
      elements.categoryTabs.appendChild(slider);

      function moveSlider(activeTab, instant) {
        if (!activeTab) return;
        const containerRect = elements.categoryTabs.getBoundingClientRect();
        const tabRect = activeTab.getBoundingClientRect();
        if (!containerRect.width || !tabRect.width) return;

        const offsetX = tabRect.left - containerRect.left;
        if (instant) slider.style.transition = "none";
        slider.style.width = tabRect.width + "px";
        slider.style.transform = `translateX(${offsetX}px)`;
        slider.classList.add("is-ready");
        elements.categoryTabs.classList.add("slider-ready");
        if (instant) {
          slider.offsetHeight;
          slider.style.transition = "";
        }
      }

      realignCategoryTabs = () => {
        const activeTab = elements.categoryTabs?.querySelector(".category-tab.active");
        if (!activeTab) return;

        const attempt = (retriesLeft = 3) => {
          requestAnimationFrame(() => {
            const tabRect = activeTab.getBoundingClientRect();
            const containerRect = elements.categoryTabs.getBoundingClientRect();
            if ((!tabRect.width || !containerRect.width) && retriesLeft > 0) {
              attempt(retriesLeft - 1);
              return;
            }
            moveSlider(activeTab, true);
          });
        };

        attempt();
      };

      const initialActive = elements.categoryTabs.querySelector(".category-tab.active");
      requestAnimationFrame(() => moveSlider(initialActive, true));

      elements.categoryTabs.querySelectorAll(".category-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
          const rawCat = tab.dataset.category;
          const nextCategory = normalizeCategory(rawCat);
          const categoryChanged = nextCategory !== currentCategory;

          elements.categoryTabs.querySelectorAll(".category-tab").forEach((t) => t.classList.remove("active"));
          tab.classList.add("active");

          setViewMode(null);

          moveSlider(tab, false);

          if (categoryChanged) {
            currentCategory = nextCategory;
            _lastRenderedListMarkup = null;
            renderCategorySwitch(elements.searchInput?.value || "");
          }

          persistLibraryPreferences();
        });
      });
    }

    const viewStatsBtn = document.getElementById("viewStatsBtn");
    const viewGoalsBtn = document.getElementById("viewGoalsBtn");

    if (viewStatsBtn) {
      viewStatsBtn.addEventListener("click", () => {
        const next = currentViewMode === "stats" ? null : "stats";
        setViewMode(next);
      });
    }
    if (viewGoalsBtn) {
      viewGoalsBtn.addEventListener("click", async () => {
        if (currentViewMode === "goals") {
          setViewMode(null);
          return;
        }
        if (goalSettings === null) {
          await loadGoalAndBadgeState();
        }
        setViewMode("goals");
      });
    }

    let storageUpdateTimeout = null;
    let cloudCacheInvalidateTimer = null;
    let pendingStatsRender = false;
    let pendingGoalsRender = false;
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== "local") return;
      if (
        (changes["syncState.pendingFlush"] ||
          changes["syncState.pendingProgressFlush"] ||
          changes["syncState.pendingSidecars"] ||
          changes["syncState.cloudStatus"] ||
          changes.firebase_tokens ||
          changes.firebase_user) &&
        AT.PopupState.lastMetadataRepairState?.status !== "running"
      ) {
        void restoreDefaultSyncStatus();
      }
      const isOwn = isOwnStorageChange(changes);
      let isExternalUpdate = false;
      let needsFullRender = false;

      if (changes.libraryMutationRevision) {
        _libraryRevision = normalizeLibraryRevision(changes.libraryMutationRevision.newValue);
      }
      if (changes.animeData) {
        animeData = changes.animeData.newValue || {};
        needsFullRender = true;
        if (!isOwn) isExternalUpdate = true;
        try {
          window.AnimeTracker?.ProgressInsights?.invalidate();
        } catch {}
        if (goalSettings !== null) window.AnimeTracker?.ProgressInsights?.schedule("anime-data-change");
        pendingStatsRender = true;
        pendingGoalsRender = true;
      }
      if (changes[GOAL_SETTINGS_KEY]) {
        goalSettings = changes[GOAL_SETTINGS_KEY].newValue || null;
        if (!isOwn) {
          pendingGoalsRender = true;
          if (goalSettings !== null) window.AnimeTracker?.ProgressInsights?.schedule("external-goal-change");
        }
      }
      if (changes[BADGE_STATE_KEY]) {
        badgeState = changes[BADGE_STATE_KEY].newValue || {};
        pendingGoalsRender = true;
      }
      if (changes.groupCoverImages) {
        window.AnimeTracker.groupCoverImages = changes.groupCoverImages.newValue || {};
        needsFullRender = true;
        if (!isOwn) isExternalUpdate = true;
      }
      if (changes.fillerStaySelections) {
        try {
          AT.FillerService.setStayedFillersCache(changes.fillerStaySelections.newValue || {});
        } catch {}
        needsFullRender = true;
        if (!isOwn) isExternalUpdate = true;
      }
      if (changes.deletedAnime) {
        needsFullRender = true;
        if (!isOwn) isExternalUpdate = true;
      }
      if (changes[COPY_GUARD_STORAGE_KEY]) {
        renderCopyGuardSetting(changes[COPY_GUARD_STORAGE_KEY].newValue !== false);
      }
      if (changes[SMART_NOTIF_STORAGE_KEY]) {
        void loadSmartNotifSetting();
      }
      if (changes[AUTO_SKIP_FILLER_STORAGE_KEY]) {
        renderAutoSkipFillerSetting(changes[AUTO_SKIP_FILLER_STORAGE_KEY].newValue === true);
      }
      if (changes[SKIPTIME_HELPER_KEY]) {
        renderSkiptimeHelperSetting(changes[SKIPTIME_HELPER_KEY].newValue === true);
      }
      if (changes[AUTO_4K_SERVER_KEY]) {
        renderAuto4kServerSetting(changes[AUTO_4K_SERVER_KEY].newValue !== false);
      }
      if (changes[AD_GUARD_KEY]) {
        renderAdGuardSetting(changes[AD_GUARD_KEY].newValue !== false);
      }
      if (changes.videoProgress) {
        videoProgress = changes.videoProgress.newValue || {};
        if (!isOwn) isExternalUpdate = true;

        if (typeof _ipPatch === "function") _ipPatch(videoProgress);

        if (doesProgressChangeAffectLists(changes.videoProgress.oldValue || {}, changes.videoProgress.newValue || {})) {
          needsFullRender = true;
        }
      }

      Object.entries(changes).forEach(([key, change]) => {
        if (key.startsWith("animeinfo_")) {
          applyAnimeInfoCacheChange(key, change.newValue || null);
          needsFullRender = true;
          if (!isOwn) isExternalUpdate = true;
        } else if (key.startsWith("episodeTypes_")) {
          applyEpisodeTypesCacheChange(key, change.newValue || null);
          needsFullRender = true;
          if (!isOwn) isExternalUpdate = true;
        }
      });

      if (changes.metadataRepairState) {
        const isLoggedIn = !!AT?.FirebaseSync?.getUser?.();
        void applyMetadataRepairState(changes.metadataRepairState.newValue || null, { autoOpenRunning: isLoggedIn });
      }

      if (isExternalUpdate && (changes.animeData || changes.videoProgress || changes.deletedAnime || changes.groupCoverImages)) {
        // Debounced: a burst of external writes (e.g. sign-in library repair) collapses to one
        // cloud-cache invalidation instead of N — avoids a Firestore read-amplification storm.
        if (cloudCacheInvalidateTimer) clearTimeout(cloudCacheInvalidateTimer);
        cloudCacheInvalidateTimer = setTimeout(() => {
          cloudCacheInvalidateTimer = null;
          try {
            FirebaseSync.clearCachedUserDocument();
          } catch {}
        }, 1500);
      }

      const hasDeferredRender = needsFullRender || pendingStatsRender || pendingGoalsRender;
      if (hasDeferredRender) {
        if (storageUpdateTimeout) clearTimeout(storageUpdateTimeout);
        storageUpdateTimeout = setTimeout(async () => {
          storageUpdateTimeout = null;
          if (needsFullRender) {
            scheduleDeferredListRefresh({ delayMs: 0 });
          }
          const appRoot = document.querySelector(".app");
          if (pendingStatsRender) {
            pendingStatsRender = false;
            const statsView = document.getElementById("statsView");
            if (statsView && appRoot && appRoot.classList.contains("stats-mode")) {
              try {
                window.AnimeTracker.StatsView.render(statsView, animeData);
              } catch {}
            }
          }
          if (pendingGoalsRender) {
            pendingGoalsRender = false;
            if (appRoot && appRoot.classList.contains("goals-mode")) {
              try {
                renderGoalsView();
              } catch {}
            }
          }
        }, CONFIG.STORAGE_UPDATE_DEBOUNCE_MS);
      }
    });

    if (elements.animeList) {
      elements.animeList.addEventListener("mouseleave", flushDeferredListRefresh);
      elements.animeList.addEventListener("click", async (e) => {
        const target = e.target;

        if (target.classList.contains("progress-delete-btn") || target.closest(".progress-delete-btn")) {
          const btn = target.classList.contains("progress-delete-btn") ? target : target.closest(".progress-delete-btn");
          const slug = btn.dataset.slug;
          const episodeNum = parseInt(btn.dataset.episode, 10);
          if (slug && episodeNum) await deleteProgress(slug, episodeNum);
          return;
        }

        if (target.classList.contains("ip-delete-btn") || target.closest(".ip-delete-btn")) {
          const btn = target.classList.contains("ip-delete-btn") ? target : target.closest(".ip-delete-btn");
          const slug = btn.dataset.slug;
          const episodeNum = parseInt(btn.dataset.episode, 10);
          if (slug && episodeNum) await deleteProgress(slug, episodeNum);
          return;
        }

        const ipGroupHeader = target.closest(".ip-group-header");
        if (ipGroupHeader) {
          const group = ipGroupHeader.closest(".ip-group");
          const content = group?.querySelector(".ip-group-content");
          const chevron = ipGroupHeader.querySelector(".ip-group-chevron");
          if (content) {
            const isOpen = content.classList.toggle("open");
            if (chevron) chevron.style.transform = isOpen ? "rotate(0deg)" : "rotate(-90deg)";
          }
          return;
        }

        if (target.classList.contains("anime-complete-toggle") || target.closest(".anime-complete-toggle")) {
          const btn = target.classList.contains("anime-complete-toggle") ? target : target.closest(".anime-complete-toggle");
          if (btn.dataset.slug) await toggleAnimeCompleted(btn.dataset.slug);
          return;
        }

        if (target.classList.contains("anime-drop-toggle") || target.closest(".anime-drop-toggle")) {
          const btn = target.classList.contains("anime-drop-toggle") ? target : target.closest(".anime-drop-toggle");
          if (btn.dataset.slug) await toggleAnimeDropped(btn.dataset.slug);
          return;
        }

        if (target.classList.contains("anime-onhold-toggle") || target.closest(".anime-onhold-toggle")) {
          const btn = target.classList.contains("anime-onhold-toggle") ? target : target.closest(".anime-onhold-toggle");
          if (btn.dataset.slug) await toggleAnimeOnHold(btn.dataset.slug);
          return;
        }

        if (target.classList.contains("anime-favorite-toggle") || target.closest(".anime-favorite-toggle")) {
          const btn = target.classList.contains("anime-favorite-toggle") ? target : target.closest(".anime-favorite-toggle");
          if (btn.dataset.slug) await toggleAnimeFavorite(btn.dataset.slug);
          return;
        }

        if (target.classList.contains("anime-delete") || target.closest(".anime-delete")) {
          const btn = target.classList.contains("anime-delete") ? target : target.closest(".anime-delete");
          if (btn.dataset.slug) deleteAnime(btn.dataset.slug);
          return;
        }

        if (target.classList.contains("anime-edit-title") || target.closest(".anime-edit-title")) {
          const btn = target.classList.contains("anime-edit-title") ? target : target.closest(".anime-edit-title");
          if (btn.dataset.slug) editAnimeTitle(btn.dataset.slug);
          return;
        }

        if (target.classList.contains("season-edit-btn") || target.closest(".season-edit-btn")) {
          const btn = target.classList.contains("season-edit-btn") ? target : target.closest(".season-edit-btn");
          if (btn.dataset.slug) editAnimeTitle(btn.dataset.slug);
          return;
        }

        if (target.classList.contains("season-delete-btn") || target.closest(".season-delete-btn")) {
          const btn = target.classList.contains("season-delete-btn") ? target : target.closest(".season-delete-btn");
          if (btn.dataset.slug) deleteAnime(btn.dataset.slug);
          return;
        }

        if (target.classList.contains("anime-fetch-filler") || target.closest(".anime-fetch-filler")) {
          const btn = target.classList.contains("anime-fetch-filler") ? target : target.closest(".anime-fetch-filler");
          if (btn.dataset.slug && !btn.disabled) await fetchFillerForAnime(btn.dataset.slug, btn);
          return;
        }
      });
    }
  }

  async function init() {
    const { FirebaseSync, Storage, FillerFetchUI } = AT;

    try {
      const _popupAlivePort = chrome.runtime.connect({ name: "popupAlive" });

      window.__popupAlivePort = _popupAlivePort;
    } catch (e) {
      PopupLogger.debug("Init", "popupAlive port connect failed:", e?.message || e);
    }

    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.type !== "AUTH_REJECTED") return;
        const status = Number(msg.status) || 0;
        if (status === 403) {
          showToast({
            title: "Permission denied",
            body: "Cloud sync was refused by Firebase. If you recently changed accounts, sign out and back in. Otherwise this may be a Firestore rules issue.",
            type: "error",
            duration: 9000,
          });
        } else if (status === 401) {
          showToast({
            title: "Session expired",
            body: "Please sign in again to resume cloud sync. Your local data is safe.",
            type: "warn",
            duration: 9000,
          });
        }
      });
    } catch {}

    FillerFetchUI.init();

    // Popup instances are ephemeral, but the background repair state is durable.
    // Restore any modal-eligible active import before auth/cloud initialization so a
    // popup reopen or extension update continues from the persisted counters.
    try {
      await syncMetadataRepairStateFromStorage({ autoOpenRunning: true });
    } catch (error) {
      PopupLogger.warn("RepairAll", "Could not restore persisted import progress:", error);
    }

    try {
      const manifest = chrome.runtime.getManifest();
      await Storage.invalidateCachedStats(manifest?.version || "");
    } catch (e) {
      PopupLogger.warn("Init", "Could not check cachedStats version:", e);
    }

    try {
      const { cachedStats } = await Storage.get(["cachedStats"]);
      if (cachedStats) {
        if (cachedStats.totalAnime != null) setTopStatValue(elements.totalAnime, cachedStats.totalAnime);
        if (cachedStats.totalMovies != null) setTopStatValue(elements.totalMovies, cachedStats.totalMovies);
        if (cachedStats.totalEpisodes != null) setTopStatValue(elements.totalEpisodes, cachedStats.totalEpisodes);
        if (cachedStats.totalTime != null) setTopStatValue(elements.totalTime, cachedStats.totalTime);
      }
    } catch (e) {
      PopupLogger.debug("Init", "Could not prime cached stats:", e);
    }

    try {
      const manifest = chrome.runtime.getManifest();
      if (manifest?.version) {
        if (elements.versionText) elements.versionText.textContent = `Anime Tracker v${manifest.version}`;
      }
    } catch (e) {
      PopupLogger.warn("Init", "Could not load manifest version:", e);
    }

    initEventListeners();
    await Promise.all([
      loadCopyGuardSetting(),
      loadSmartNotifSetting(),
      loadAutoSkipFillerSetting(),
      loadSkiptimeHelperSetting(),
      loadAuto4kServerSetting(),
      loadAdGuardSetting(),
    ]);

    try {
      const { ProgressManager } = AT;

      const { lastCleanupDate } = await Storage.get(["lastCleanupDate"]);
      const today = new Date().toISOString().slice(0, 10);
      if (lastCleanupDate === today) {
        PopupLogger.debug("Cleanup", "Already ran today, skipping");
      } else {
        const cleanupResult = await AT.LibraryMutations.enqueue("daily-cleanup", async ({ commit, snapshot }) => {
          const latestAnimeData = snapshot.animeData || {};
          const latestProgress = snapshot.videoProgress || {};
          const latestDeleted = { ...(snapshot.deletedAnime || {}) };
          const { cleaned, removedCount } = ProgressManager.cleanTrackedProgress(
            latestAnimeData,
            latestProgress,
            latestDeleted,
          );
          let deletedRemoved = 0;
          const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
          for (const slug of Object.keys(latestDeleted)) {
            const info = latestDeleted[slug];
            const deletedAt = +new Date(info?.deletedAt || info || 0);
            if (deletedAt > 0 && deletedAt < cutoff) {
              delete latestDeleted[slug];
              deletedRemoved += 1;
            }
          }

          if (removedCount === 0 && deletedRemoved === 0) {
            return { dirty: false, removedCount: 0 };
          }
          await commit(
            {
              videoProgress: cleaned,
              deletedAnime: latestDeleted,
              lastCleanupDate: today,
            },
            { markInternalSave, immediate: false },
          );
          return { dirty: true, removedCount };
        });

        if (!cleanupResult.dirty) {
          const saveObj = { lastCleanupDate: today };
          markInternalSave(saveObj);
          await Storage.set(saveObj);
        } else if (cleanupResult.removedCount > 0) {
          PopupLogger.log("Cleanup", `Removed ${cleanupResult.removedCount} stale videoProgress entries`);
        }
      }
    } catch (e) {
      PopupLogger.warn("Cleanup", "Auto-cleanup failed:", e);
    }

    try {
      const SlugMigration = window.AnimeTrackerSlugMigration;
      if (SlugMigration && typeof SlugMigration.migrate === "function") {
        SlugMigration.migrate()
          .then((result) => {
            if (result && result.renamed > 0) {
              PopupLogger.log("SlugMigration", `Auto-recovered ${result.renamed} bad slug(s)`);
            } else if (result && result.tried > 0) {
              PopupLogger.debug("SlugMigration", `Probed ${result.tried} suspect slug(s), none recoverable`);
            }
          })
          .catch((e) => {
            PopupLogger.debug("SlugMigration", "failed:", e?.message || e);
          });
      }
    } catch (e) {
      PopupLogger.debug("SlugMigration", "Unable to start:", e?.message || e);
    }

    FirebaseSync.init({
      onUserSignedIn: async (user) => {
        const signInCloudLoad = refreshPopupCloudData(false, { skipAutoFetch: true, reason: "popup:sign-in" }).then(
          (result) => ({ result, error: null }),
          (error) => ({ result: null, error }),
        );
        showMainApp(user);

        try {
          const needs = await window.FirebaseLib?.isReauthNeeded?.();
          if (needs) {
            showToast({
              title: "Reconnect to sync",
              body: "We could not reach Firebase recently. Click here to reconnect to sync.",
              type: "warn",
              duration: 9000,
              onClick: () => signOut(true),
            });
          }
        } catch {}

        try {
          chrome.runtime.sendMessage({ type: "GET_VERSION" }, () => {
            void chrome.runtime.lastError;
          });
        } catch {}
        const cloudLoadResult = await signInCloudLoad;
        if (cloudLoadResult.error) {
          const syncError = cloudLoadResult.error;
          PopupLogger.warn("Login", `Cloud refresh failed before sign-in fetch: ${syncError?.message || syncError}`);
          try {
            await loadData({ skipAutoFetch: true, reason: "popup:sign-in-fallback" });
          } catch (localLoadError) {
            PopupLogger.warn("Login", `Local fallback failed before sign-in fetch: ${localLoadError?.message || localLoadError}`);
          }
        }

        try {
          const repairState = await startSignInMetadataRepair();
          const fetchTotal = Number(repairState?.fetchTotal) || 0;
          PopupLogger.log(
            "Login",
            `Sign-in fetch planned: ${fetchTotal} pending item(s), UI=${repairState?.uiMode || "status"}`,
          );
        } catch (repairError) {
          PopupLogger.error("Login", "Failed to start sign-in fetch:", repairError);
          setMetadataRepairStatus("Fetch Error", false, { error: true, title: repairError?.message || "Metadata fetch failed" });
        }

        try {
          await FirebaseSync.queuePlaybackSettingsSave();
        } catch (syncError) {
          PopupLogger.warn("Settings", `Playback settings reconciliation failed: ${syncError?.message}`);
        }
        try {
          await AT.AniListIntegration?.syncAuthToCloud?.();
        } catch (syncError) {
          PopupLogger.warn("AniList", `Auth reconciliation failed: ${syncError?.message}`);
        }
        startPopupCloudRefresh();

        const syncResult = AT.FirebaseSync.lastSyncResult || null;
        const providers = user.providers || [];
        PopupLogger.log(
          "Sync",
          `Sign-in diagnostic: source=${syncResult?.source || "unknown"} ` +
            `cloudDocFound=${syncResult?.cloudDocFound} ` +
            `animeCount=${syncResult?.animeCount} ` +
            `uid=${user.uid?.slice(0, 8)}… ` +
            `providers=[${providers.join(", ")}] ` +
            `signedInVia=${user.signedInVia || "google"}`,
        );

        try {
          const SlugMigration = window.AnimeTrackerSlugMigration;
          if (SlugMigration && typeof SlugMigration.migrate === "function") {
            SlugMigration.migrate({ force: true })
              .then((result) => {
                if (result && result.renamed > 0) {
                  PopupLogger.log("SlugMigration", `Post-login recovered ${result.renamed} bad slug(s)`);
                }
              })
              .catch((e) => window.__atSwallow("slugMigration", e));
          }
        } catch {}
        await maybePromptPostUpdateFetch();
      },
      onUserSignedOut: () => {
        stopPopupCloudRefresh();
        showAuthScreen();
      },
      onError: () => {
        showMainApp(null);
        void loadData({ reason: "popup:auth-error-fallback" }).catch((error) => {
          PopupLogger.warn("Storage", `Auth fallback load failed: ${error?.message || error}`);
        });

        maybePromptPostUpdateFetch().catch((e) => window.__atSwallow("postUpdateFetch", e));
      },
    });
  }

  function _ipPatch(vp) {
    const completedPct = AT.CONFIG?.COMPLETED_PERCENTAGE || 85;
    const cards = document.querySelectorAll(".ip-card[data-slug]");

    cards.forEach((card) => {
      const slug = card.dataset.slug;
      if (!slug) return;

      let best = null;
      let bestNum = 0;
      const prefix = slug + "__episode-";
      for (const key in vp) {
        if (!key.startsWith(prefix)) continue;
        const p = vp[key];
        if (!p || p.deleted) continue;
        if (p.percentage >= completedPct) continue;
        const num = parseInt(key.slice(prefix.length), 10);
        if (num > bestNum) {
          bestNum = num;
          best = p;
        }
      }
      if (!best) return;

      const pct = Math.floor(best.percentage);
      const ct = best.currentTime || 0;
      const dur = best.duration || 0;
      const mins = Math.floor(ct / 60);
      const secs = Math.floor(ct % 60);
      const timeStr = `${mins}:${String(secs).padStart(2, "0")}`;
      const durStr = dur > 0 ? `${Math.floor(dur / 60)}m` : "?";
      const remMin = Math.ceil(Math.max(0, dur - ct) / 60);
      const remStr = remMin > 0 ? `${remMin}m left` : "Done";

      const fill = card.querySelector(".ip-fill");
      if (fill && fill.style.width !== pct + "%") {
        fill.style.width = pct + "%";
        PopupLogger.debug("IP-Refresh", `${slug}: ${pct}% (${timeStr}/${durStr})`);
      }

      const badge = card.querySelector(".ip-pct-badge");
      if (badge) badge.textContent = pct + "%";

      const items = card.querySelectorAll(".ip-meta-item");
      if (items[0]) items[0].textContent = `Ep ${bestNum}`;
      if (items[1]) items[1].textContent = `${timeStr} / ${durStr}`;

      const rem = card.querySelector(".ip-remaining");
      if (rem) rem.textContent = remStr;
    });
  }

  document.addEventListener("keydown", (e) => {
    const target = e.target;
    const isTypingTarget = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

    if (e.key === "/" && !isTypingTarget && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (elements.searchInput) {
        e.preventDefault();
        elements.searchInput.focus();
        elements.searchInput.select?.();
      }
      return;
    }

    if (e.key === "Escape") {
      const openDialog =
        document.querySelector(".confirm-dialog.visible") ||
        document.querySelector(".dialog.visible") ||
        document.querySelector('[role="dialog"][aria-modal="true"]:not([hidden])');
      if (openDialog) {
        const cancel = openDialog.querySelector("[data-dialog-cancel], .btn-cancel, .dialog-cancel");
        if (cancel) {
          cancel.click();
          return;
        }
      }
      if (elements.sortDropdown?.classList.contains("visible")) {
        elements.sortDropdown.classList.remove("visible");
        elements.sortBtn?.classList.remove("active");
        return;
      }
      if (currentViewMode) {
        setViewMode(null);
        return;
      }

      if (elements.searchInput && elements.searchInput.value && document.activeElement === elements.searchInput) {
        elements.searchInput.value = "";
        elements.searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  });

  window.addEventListener("beforeunload", () => {
    stopPopupCloudRefresh();
    AT.FirebaseSync.cleanup();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      // Only pause the refresh timer. Removing the auth listener here (FirebaseSync.cleanup)
      // is one-way: nothing re-registers it on show, so a hidden→shown side panel would stop
      // reacting to sign-in/sign-out. The listener itself is idle-cheap.
      stopPopupCloudRefresh();
      return;
    }

    startPopupCloudRefresh();
    refreshPopupCloudData(false).catch((error) => {
      PopupLogger.debug("Sync", "Visibility refresh skipped:", error?.message || error);
    });
  });

  init();
})();
