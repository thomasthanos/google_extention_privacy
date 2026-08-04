(function () {
  "use strict";

  const AT = (window.AnimeTracker = window.AnimeTracker || {});
  const ANIME_DATA_KEY = "animeData";
  const BADGE_STATE_KEY = "badgeUnlocks";
  const GOAL_SETTINGS_KEY = "goalSettings";
  const BADGE_BASELINE_KEY = "badgeEvaluationBaselineV1";
  const BADGE_NOTIFICATION_BASELINE_KEY = "badgeNotificationBaselineV1";
  const BADGE_NOTIFICATION_TIMEOUT_MS = 12000;
  const GOAL_META = Object.freeze({
    daily: { field: "targetMinutes", min: 5, max: 480, step: 5 },
    weekly: { field: "targetEpisodes", min: 1, max: 100, step: 1 },
    monthly: { field: "targetEpisodes", min: 1, max: 400, step: 1 },
  });

  let config = {};
  let refreshInFlight = null;
  let pendingReasons = new Set();
  let scheduleTimer = null;

  function configure(nextConfig = {}) {
    config = { ...config, ...nextConfig };
  }

  function getCurrentValue(name, fallback) {
    try {
      return typeof config[name] === "function" ? config[name]() : fallback;
    } catch {
      return fallback;
    }
  }

  function publish(name, value) {
    try {
      if (typeof config[name] === "function") config[name](value);
    } catch (error) {
      (window.PopupLogger?.warn || console.warn)("ProgressInsights", `${name} callback failed:`, error);
    }
  }

  function markInternalSave(payload) {
    if (typeof config.markInternalSave === "function") config.markInternalSave(payload);
  }

  function inputValue(input, key, getter, fallback) {
    return Object.prototype.hasOwnProperty.call(input, key) ? input[key] : getCurrentValue(getter, fallback);
  }

  function evaluate(input = {}) {
    const StatsEngine = AT.StatsEngine;
    const BadgeEngine = AT.BadgeEngine;
    const GoalEngine = AT.GoalEngine;
    if (!StatsEngine || !BadgeEngine || !GoalEngine) throw new Error("Progress insights engines are unavailable");

    const animeData = inputValue(input, "animeData", "getAnimeData", {}) || {};
    const goalSettings = inputValue(input, "goalSettings", "getGoalSettings", null);
    const badgeState = inputValue(input, "badgeState", "getBadgeState", {}) || {};
    const revision = inputValue(input, "revision", "getRevision", null);
    const index = StatsEngine.buildWatchIndex(animeData, revision);
    const hourIndex = BadgeEngine.buildHourIndex(animeData, revision);
    const smartPlan = GoalEngine.buildSmartGoalPlan(animeData, index, goalSettings);
    const effectiveGoalSettings = smartPlan?.goalSettings || goalSettings || GoalEngine.getDefaultGoalSettings();
    const badges = BadgeEngine.evaluateBadges(animeData, index, hourIndex, { badgeState });
    const goals = GoalEngine.evaluateGoals(effectiveGoalSettings, index);

    return {
      animeData,
      revision,
      index,
      hourIndex,
      badgeState,
      badges,
      goalSettings,
      effectiveGoalSettings,
      goals,
      smartPlan,
    };
  }

  function sendBadgeNotificationRequest(badges) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("Badge notification handoff timed out"));
      }, BADGE_NOTIFICATION_TIMEOUT_MS);

      try {
        chrome.runtime.sendMessage({ type: "QUEUE_BADGE_NOTIFICATIONS", badges }, (response) => {
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

  function entriesEqual(left, right) {
    try {
      return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
    } catch {
      return false;
    }
  }

  function normalizeExistingBadgeState(storedBadgeState, notificationBaselineKnown, nowIso) {
    const nextBadgeState = {};
    for (const [id, rawEntry] of Object.entries(storedBadgeState || {})) {
      const entry = rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry) ? { ...rawEntry } : {};
      if (!notificationBaselineKnown) {
        const wasNotified = entry.notified === true;
        entry.notified = true;
        entry.notificationState = wasNotified ? "settled" : "suppressed";
        if (wasNotified) entry.notificationSettledAt = entry.notificationSettledAt || nowIso;
        else entry.notificationSuppressedAt = entry.notificationSuppressedAt || nowIso;
      } else if (entry.notified === true) {
        if (!entry.notificationState || entry.notificationState === "pending") entry.notificationState = "settled";
      } else if (["queued", "settled", "suppressed"].includes(entry.notificationState)) {
        entry.notified = true;
      } else {
        entry.notified = false;
        entry.notificationState = "pending";
      }
      nextBadgeState[id] = entry;
    }
    return nextBadgeState;
  }

  function buildPendingBadgeNotifications(evaluation, badgeState, notificationBaselineKnown) {
    if (!notificationBaselineKnown) return [];
    const evaluatedById = new Map((evaluation?.badges || []).map((badge) => [badge.id, badge]));
    const pending = [];
    for (const [id, entry] of Object.entries(badgeState || {})) {
      if (entry?.notified === true || entry?.notificationState !== "pending") continue;
      const badge = evaluatedById.get(id);
      pending.push({
        id,
        title: entry.notificationTitle || badge?.title || "Achievement",
        desc: entry.notificationDescription || badge?.desc || "",
      });
    }
    return pending;
  }

  async function acknowledgeBadgeNotificationHandoff(acceptedIds) {
    const accepted = new Set((acceptedIds || []).map((id) => String(id || "").trim()).filter(Boolean));
    if (accepted.size === 0) return null;
    const nowIso = new Date().toISOString();
    return AT.LibraryMutations.enqueueWithKeys(
      "badge-notification-handoff",
      [BADGE_STATE_KEY],
      async ({ snapshot, commit }) => {
        const current = snapshot[BADGE_STATE_KEY] || {};
        const next = { ...current };
        let changed = false;
        for (const id of accepted) {
          const entry = current[id];
          if (!entry || entry.notified === true || entry.notificationState !== "pending") continue;
          next[id] = {
            ...entry,
            notified: true,
            notificationState: "queued",
            notificationQueuedAt: nowIso,
          };
          changed = true;
        }
        if (changed) await commit({ [BADGE_STATE_KEY]: next }, { markInternalSave, sync: false });
        return changed ? next : current;
      },
    );
  }

  async function queuePendingBadgeNotifications(badges) {
    if (!Array.isArray(badges) || badges.length === 0) return null;
    try {
      const response = await sendBadgeNotificationRequest(badges);
      if (!response?.accepted) throw new Error(response?.error || "Badge notification handoff was rejected");
      return await acknowledgeBadgeNotificationHandoff(response.acceptedIds);
    } catch (error) {
      (window.PopupLogger?.warn || console.warn)("ProgressInsights", "Badge notification handoff deferred:", error);
      return null;
    }
  }

  async function refreshOnce() {
    const mutation = await AT.LibraryMutations.enqueueWithKeys(
      "progress-insights-refresh",
      [ANIME_DATA_KEY, GOAL_SETTINGS_KEY, BADGE_STATE_KEY, BADGE_BASELINE_KEY, BADGE_NOTIFICATION_BASELINE_KEY],
      async ({ snapshot, revision, commit }) => {
        const storedBadgeState = { ...(snapshot[BADGE_STATE_KEY] || {}) };
        const storedGoalSettings = snapshot[GOAL_SETTINGS_KEY] || null;
        const notificationBaselineKnown = snapshot[BADGE_NOTIFICATION_BASELINE_KEY]?.initialized === true;
        let evaluation = evaluate({
          animeData: snapshot[ANIME_DATA_KEY] || {},
          goalSettings: storedGoalSettings,
          badgeState: storedBadgeState,
          revision,
        });

        const nowIso = new Date().toISOString();
        const normalizedRevision = revision === null || revision === undefined ? null : Number(revision);
        const nextBadgeState = normalizeExistingBadgeState(storedBadgeState, notificationBaselineKnown, nowIso);
        for (const badge of evaluation.badges.filter((item) => item.unlocked)) {
          if (storedBadgeState[badge.id]) continue;
          nextBadgeState[badge.id] = {
            unlockedAt: badge.unlockedAt || nowIso,
            notified: !notificationBaselineKnown,
            notificationState: notificationBaselineKnown ? "pending" : "suppressed",
            notificationTitle: badge.title || "Achievement",
            notificationDescription: badge.desc || "",
            ...(notificationBaselineKnown ? {} : { notificationSuppressedAt: nowIso }),
          };
        }

        const plannedGoalSettings = evaluation.smartPlan?.shouldPersist ? evaluation.smartPlan.goalSettings : storedGoalSettings;
        const badgeChanged = !entriesEqual(storedBadgeState, nextBadgeState);
        const goalsChanged = evaluation.smartPlan?.shouldPersist === true && !entriesEqual(storedGoalSettings, plannedGoalSettings);
        const payload = {};
        if (badgeChanged) payload[BADGE_STATE_KEY] = nextBadgeState;
        if (goalsChanged) payload[GOAL_SETTINGS_KEY] = plannedGoalSettings;
        if (!snapshot[BADGE_BASELINE_KEY]?.initialized) {
          payload[BADGE_BASELINE_KEY] = {
            initialized: true,
            initializedAt: nowIso,
            revision: Number.isFinite(normalizedRevision) ? normalizedRevision : null,
          };
        }
        if (!notificationBaselineKnown) {
          payload[BADGE_NOTIFICATION_BASELINE_KEY] = {
            initialized: true,
            initializedAt: nowIso,
            revision: Number.isFinite(normalizedRevision) ? normalizedRevision : null,
          };
        }
        if (Object.keys(payload).length > 0) {
          await commit(payload, { markInternalSave, sync: false });
          evaluation = evaluate({
            animeData: snapshot[ANIME_DATA_KEY] || {},
            goalSettings: goalsChanged ? plannedGoalSettings : storedGoalSettings,
            badgeState: badgeChanged ? nextBadgeState : storedBadgeState,
            revision,
          });
        }

        return {
          evaluation,
          badgeState: badgeChanged ? nextBadgeState : storedBadgeState,
          goalSettings: goalsChanged ? plannedGoalSettings : storedGoalSettings,
          notifyList: buildPendingBadgeNotifications(
            evaluation,
            badgeChanged ? nextBadgeState : storedBadgeState,
            notificationBaselineKnown,
          ),
        };
      },
    );

    publish("setBadgeState", mutation.badgeState);
    publish("setGoalSettings", mutation.goalSettings || mutation.evaluation.effectiveGoalSettings);
    const acknowledgedBadgeState = await queuePendingBadgeNotifications(mutation.notifyList);
    if (acknowledgedBadgeState) {
      mutation.badgeState = acknowledgedBadgeState;
      publish("setBadgeState", acknowledgedBadgeState);
    }
    return mutation.evaluation;
  }

  function refresh(reason = "progress-change") {
    pendingReasons.add(String(reason || "progress-change"));
    if (scheduleTimer) {
      clearTimeout(scheduleTimer);
      scheduleTimer = null;
    }
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      let result = null;
      while (pendingReasons.size > 0) {
        pendingReasons = new Set();
        result = await refreshOnce();
      }
      return result;
    })().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  function schedule(reason = "progress-change", delayMs = 120) {
    pendingReasons.add(String(reason || "progress-change"));
    if (scheduleTimer) clearTimeout(scheduleTimer);
    scheduleTimer = setTimeout(() => {
      scheduleTimer = null;
      refresh(reason).catch((error) => {
        (window.PopupLogger?.warn || console.warn)("ProgressInsights", "Refresh failed:", error);
      });
    }, Math.max(0, Number(delayMs) || 0));
  }

  function normalizeGoalSettings(storedSettings, GoalEngine) {
    const defaults = GoalEngine.getDefaultGoalSettings();
    return {
      daily: { ...defaults.daily, ...(storedSettings?.daily || {}) },
      weekly: { ...defaults.weekly, ...(storedSettings?.weekly || {}) },
      monthly: { ...defaults.monthly, ...(storedSettings?.monthly || {}) },
    };
  }

  async function updateGoalTarget({ key, field, value }) {
    const meta = GOAL_META[key];
    if (!meta || field !== meta.field) throw new Error("Invalid goal target");
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) throw new Error("Goal target must be numeric");
    const normalizedValue = Math.max(meta.min, Math.min(meta.max, Math.round(numericValue / meta.step) * meta.step));
    const nowIso = new Date().toISOString();
    const GoalEngine = AT.GoalEngine;
    if (!GoalEngine) throw new Error("Goal engine is unavailable");

    const savedSettings = await AT.LibraryMutations.enqueueWithKeys(
      `goal:${key}`,
      [GOAL_SETTINGS_KEY],
      async ({ snapshot, commit }) => {
        const currentSettings = normalizeGoalSettings(snapshot[GOAL_SETTINGS_KEY], GoalEngine);
        const nextSettings = {
          ...currentSettings,
          [key]: {
            ...currentSettings[key],
            [field]: normalizedValue,
            smartManaged: true,
            updatedAt: nowIso,
            manualTarget: normalizedValue,
            manualTargetAt: nowIso,
          },
        };
        await commit({ [GOAL_SETTINGS_KEY]: nextSettings }, { markInternalSave, sync: false });
        return nextSettings;
      },
    );

    publish("setGoalSettings", savedSettings);
    const evaluation = await refresh("manual-goal-change");
    return evaluation?.effectiveGoalSettings || savedSettings;
  }

  function invalidate() {
    AT.StatsEngine?.invalidate?.();
    AT.BadgeEngine?.invalidate?.();
  }

  AT.ProgressInsights = Object.freeze({
    configure,
    evaluate,
    refresh,
    schedule,
    updateGoalTarget,
    invalidate,
  });
})();
