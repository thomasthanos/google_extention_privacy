// stats-views.js — the stats bar and switching between the stats/goals/settings views.
(function () {
  "use strict";

  const AT = window.AnimeTracker;

  let elements, detectHasGoogleAuth, setTopStatValue, markInternalSave;

  const GOAL_SETTINGS_KEY = "goalSettings";
  const BADGE_STATE_KEY = "badgeUnlocks";
  const COPY_GUARD_STORAGE_KEY = "copyGuardEnabled";
  const SMART_NOTIF_STORAGE_KEY = "smartNotificationsEnabled";
  const AUTO_SKIP_FILLER_STORAGE_KEY = "autoSkipFillers";
  const SKIPTIME_HELPER_KEY = "skiptimeHelperEnabled";
  const AUTO_4K_SERVER_KEY = "auto4kServerEnabled";
  const PASSWORD_SET_MARKER_KEY = "passwordSetMarker";

  // persist:false paints the numbers without writing cachedStats — for callers whose animeData
  // is a placeholder rather than the real library (e.g. a failed load), since that cache is what
  // primes the stats bar on the next popup open.
  async function updateStats({ persist = true } = {}) {
    const { UIHelpers, SeasonGrouping, Storage } = AT;
    const animeEntries = Object.entries(AT.PopupState.animeData);
    const groups = SeasonGrouping.groupByBase(animeEntries);
    const totalAnimeCount = groups.size;
    setTopStatValue(elements.totalAnime, totalAnimeCount);
    const totalMoviesCount = animeEntries.filter(([slug, anime]) => SeasonGrouping.isMovieDisplay(slug, anime)).length;
    if (elements.totalMovies) setTopStatValue(elements.totalMovies, totalMoviesCount);

    let totalWatchedEpisodes = 0;
    let totalWatchTime = 0;
    for (const [, anime] of animeEntries) {
      const uniqueEpisodeNumbers = new Set(
        (anime.episodes || [])
          .filter((ep) => ep?.durationSource !== "anilist")
          .map((ep) => Number(ep?.number))
          .filter((n) => Number.isFinite(n) && n > 0),
      );
      totalWatchedEpisodes += uniqueEpisodeNumbers.size;

      for (const ep of anime.episodes || []) {
        if (ep?.durationSource === "anilist") continue;
        totalWatchTime += Number(ep?.duration) || 0;
      }
    }

    const totalTimeStr = UIHelpers.formatDurationShort(totalWatchTime);
    setTopStatValue(elements.totalEpisodes, totalWatchedEpisodes);
    setTopStatValue(elements.totalTime, totalTimeStr);

    if (!persist) return;

    try {
      const manifest = chrome.runtime.getManifest();
      await Storage.set({
        cachedStats: {
          totalAnime: totalAnimeCount,
          totalMovies: totalMoviesCount,
          totalEpisodes: totalWatchedEpisodes,
          totalTime: totalTimeStr,
          _version: manifest?.version || null,
          _savedAt: Date.now(),
        },
      });
    } catch (e) {
      PopupLogger.error("Stats", "Failed to cache stats:", e);
    }
  }

  async function loadGoalAndBadgeState() {
    try {
      const result = await chrome.storage.local.get([GOAL_SETTINGS_KEY, BADGE_STATE_KEY]);
      const GoalEngine = window.AnimeTracker?.GoalEngine;
      const defaults = GoalEngine?.getDefaultGoalSettings?.() || {
        daily: { targetMinutes: 60, updatedAt: null },
        weekly: { targetEpisodes: 5, updatedAt: null },
        monthly: { targetEpisodes: 20, updatedAt: null },
      };
      const stored = result[GOAL_SETTINGS_KEY] || {};
      AT.PopupState.goalSettings = {
        daily: { ...defaults.daily, ...(stored.daily || {}) },
        weekly: { ...defaults.weekly, ...(stored.weekly || {}) },
        monthly: { ...defaults.monthly, ...(stored.monthly || {}) },
      };
      AT.PopupState.badgeState = result[BADGE_STATE_KEY] || {};
    } catch (e) {
      PopupLogger.warn("Goals", "Failed to load goal/badge state:", e);
      AT.PopupState.goalSettings = null;
      AT.PopupState.badgeState = {};
      return;
    }

    try {
      await AT.ProgressInsights.refresh("goal-badge-state-load");
    } catch (e) {
      PopupLogger.warn("Goals", "Failed to refresh goal/badge state:", e);
    }
  }

  function setViewMode(mode) {
    const appRoot = document.querySelector(".app");
    const mainContent = document.querySelector(".main-content");
    const statsView = document.getElementById("statsView");
    const goalsView = document.getElementById("goalsView");
    const settingsView = document.getElementById("settingsView");
    const viewStatsBtn = document.getElementById("viewStatsBtn");
    const viewGoalsBtn = document.getElementById("viewGoalsBtn");
    const settingsBtn = document.getElementById("settingsBtn");

    AT.PopupState.currentViewMode = mode || null;

    if (appRoot) {
      appRoot.classList.toggle("stats-mode", mode === "stats");
      appRoot.classList.toggle("goals-mode", mode === "goals");
      appRoot.classList.toggle("settings-mode", mode === "settings");
    }

    const isViewMode = !!mode;
    if (elements.categoryTabs) elements.categoryTabs.style.display = isViewMode ? "none" : "";

    if (viewStatsBtn) {
      viewStatsBtn.classList.toggle("is-active", mode === "stats");
      viewStatsBtn.setAttribute("aria-pressed", mode === "stats" ? "true" : "false");
    }
    if (viewGoalsBtn) {
      viewGoalsBtn.classList.toggle("is-active", mode === "goals");
      viewGoalsBtn.setAttribute("aria-pressed", mode === "goals" ? "true" : "false");
    }
    if (settingsBtn) {
      settingsBtn.classList.toggle("is-active", mode === "settings");
      settingsBtn.setAttribute("aria-pressed", mode === "settings" ? "true" : "false");
    }

    if (mode === "stats" && statsView) {
      statsView.removeAttribute("hidden");
      try {
        window.AnimeTracker?.StatsView?.render(statsView, AT.PopupState.animeData);
      } catch (e) {
        PopupLogger.error("StatsView", "render failed:", e);
        statsView.textContent = "Stats unavailable.";
      }
    } else if (mode === "goals") {
      if (goalsView) goalsView.removeAttribute("hidden");
      renderGoalsView();
    } else if (mode === "settings") {
      if (mainContent) mainContent.scrollTop = 0;
      if (settingsView) settingsView.scrollTop = 0;
      if (settingsView) settingsView.removeAttribute("hidden");
      renderSettingsView();
    }
  }

  async function renderSettingsView() {
    const container = document.getElementById("settingsView");
    const mainContent = document.querySelector(".main-content");
    if (!container) return;
    container.removeAttribute("hidden");
    container.scrollTop = 0;
    if (mainContent) mainContent.scrollTop = 0;

    const SettingsView = window.AnimeTracker?.SettingsView;
    if (!SettingsView) {
      container.textContent = "Settings unavailable.";
      return;
    }

    const user = AT?.FirebaseSync?.getUser?.() || null;

    let storedSettings = {};
    let passwordIsSet = false;
    let needsReauth = false;
    try {
      const stored = await chrome.storage.local.get([
        COPY_GUARD_STORAGE_KEY,
        SMART_NOTIF_STORAGE_KEY,
        AUTO_SKIP_FILLER_STORAGE_KEY,
        SKIPTIME_HELPER_KEY,
        AUTO_4K_SERVER_KEY,
        PASSWORD_SET_MARKER_KEY,
      ]);
      storedSettings = {
        copyGuard: stored[COPY_GUARD_STORAGE_KEY] !== false,
        smartNotif: stored[SMART_NOTIF_STORAGE_KEY] === true,
        autoSkipFiller: stored[AUTO_SKIP_FILLER_STORAGE_KEY] === true,
        skiptimeHelper: stored[SKIPTIME_HELPER_KEY] === true,
        auto4kServer: stored[AUTO_4K_SERVER_KEY] !== false,
      };
      const marker = stored[PASSWORD_SET_MARKER_KEY];

      passwordIsSet = !!(marker?.uid && user?.uid && marker.uid === user.uid && marker.setAt);
      needsReauth = (await window.FirebaseLib?.isReauthNeeded?.()) || false;
    } catch (e) {
      PopupLogger.warn("Settings", "Failed to load toggle state for view:", e);
    }

    SettingsView.render(container, {
      user,
      settings: storedSettings,
      passwordIsSet,
      isMobile: !detectHasGoogleAuth(),
      needsReauth,
    });
    await AT.refreshSmartNotificationStatus?.();

    container.scrollTop = 0;
    if (mainContent) mainContent.scrollTop = 0;
    requestAnimationFrame(() => {
      container.scrollTop = 0;
      if (mainContent) mainContent.scrollTop = 0;
    });
  }

  function renderGoalsView() {
    const container = document.getElementById("goalsView");
    if (!container) return;
    container.removeAttribute("hidden");

    const ProgressInsights = window.AnimeTracker?.ProgressInsights;
    const GoalsView = window.AnimeTracker?.GoalsView;
    if (!ProgressInsights || !GoalsView) {
      container.textContent = "Goals engine not loaded.";
      return;
    }

    try {
      const evaluation = ProgressInsights.evaluate();
      GoalsView.render(container, {
        index: evaluation.index,
        badges: evaluation.badges,
        goals: evaluation.goals,
        smartPlan: evaluation.smartPlan,
        effectiveGoalSettings: evaluation.effectiveGoalSettings,
        onGoalTargetChange: (change) => ProgressInsights.updateGoalTarget(change),
      });
    } catch (e) {
      PopupLogger.error("Goals", "render failed:", e);
      container.textContent = "Goals unavailable.";
    }
  }

  AT.StatsViews = {
    _init(d) {
      elements = d.elements;
      detectHasGoogleAuth = d.detectHasGoogleAuth;
      setTopStatValue = d.setTopStatValue;
      markInternalSave = d.markInternalSave;
      AT.ProgressInsights.configure({
        getAnimeData: () => AT.PopupState.animeData,
        getGoalSettings: () => AT.PopupState.goalSettings,
        getBadgeState: () => AT.PopupState.badgeState,
        getRevision: () => AT.PopupState.libraryRevision,
        setGoalSettings: (next) => {
          AT.PopupState.goalSettings = next;
        },
        setBadgeState: (next) => {
          AT.PopupState.badgeState = next;
        },
        markInternalSave,
      });
    },
    updateStats,
    loadGoalAndBadgeState,
    setViewMode,
    renderSettingsView,
    renderGoalsView,
  };
})();
