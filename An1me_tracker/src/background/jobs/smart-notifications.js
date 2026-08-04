// smart-notifications.js — adaptive new-episode discovery and alarm lifecycle.
// Durable delivery and click routing are owned by AnimeTrackerNotificationCoordinator.
const SMART_NOTIF_ALARM = "smartNotifCheck";
const SMART_NOTIF_INTERVAL_MINUTES = 60;
const SMART_NOTIF_MAX_PER_TICK = 10;
const SMART_NOTIF_SETTING_KEY = "smartNotificationsEnabled";
const SMART_NOTIF_STATE_KEY = "smartNotifState";
const SMART_NOTIF_LEGACY_STATE_KEY = "smartNotifLastCheck";

const SN_MINUTE = 60 * 1000;
const SN_HOUR = 60 * SN_MINUTE;
const SN_DAY = 24 * SN_HOUR;

const SMART_NOTIF_TUNING = {
  dueRecheck: 20 * SN_MINUTE,
  preDropLead: 15 * SN_MINUTE,
  unknownSchedule: 6 * SN_HOUR,
  activeUnknown: 3 * SN_HOUR,
  minGap: 15 * SN_MINUTE,
  dueGiveUp: 3 * SN_DAY,
};

let smartNotifCheckInFlight = null;
let smartNotifAlarmTail = Promise.resolve();
let smartNotifDisableGeneration = 0;

function smartNotifNow() {
  return Date.now();
}

function snToMs(value) {
  if (!value) return 0;
  const timestamp = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function highestWatchedEpisode(anime) {
  return Math.max(
    0,
    ...(anime?.episodes || [])
      .filter((episode) => episode?.durationSource !== "anilist")
      .map((episode) => Number(episode?.number) || 0),
  );
}

function computeNextCheckAt(cached, state, now) {
  const nextDropAt = snToMs(cached?.nextEpisodeAt);
  const lastActivityAt = Math.max(snToMs(state?.lastCheckedAt), snToMs(state?.lastAttemptAt));
  const minNext = lastActivityAt + SMART_NOTIF_TUNING.minGap;

  if (nextDropAt > 0) {
    if (nextDropAt > now) {
      return Math.max(nextDropAt - SMART_NOTIF_TUNING.preDropLead, minNext);
    }
    const overdueFor = now - nextDropAt;
    if (overdueFor <= SMART_NOTIF_TUNING.dueGiveUp) {
      return Math.max(lastActivityAt + SMART_NOTIF_TUNING.dueRecheck, now);
    }
  }

  const cachedAt = snToMs(cached?.cachedAt);
  const looksActive = cachedAt > 0 && now - cachedAt < 14 * SN_DAY;
  const cadence = looksActive ? SMART_NOTIF_TUNING.activeUnknown : SMART_NOTIF_TUNING.unknownSchedule;
  return Math.max(lastActivityAt + cadence, now);
}

function urgencyKey(cached, state, now) {
  const nextDropAt = snToMs(cached?.nextEpisodeAt);
  if (nextDropAt > 0 && nextDropAt <= now) {
    return -(now - nextDropAt) - 1e12;
  }
  if (nextDropAt > now) return nextDropAt;
  return Number.MAX_SAFE_INTEGER - (now - Math.max(snToMs(state?.lastCheckedAt), snToMs(state?.lastAttemptAt)));
}

function migrateLegacySmartNotificationState(state, legacyState) {
  let migrated = false;
  if (!legacyState || typeof legacyState !== "object" || Array.isArray(legacyState)) return migrated;
  for (const [slug, timestamp] of Object.entries(legacyState)) {
    if (!state[slug] && Number.isFinite(Number(timestamp))) {
      state[slug] = { lastCheckedAt: Number(timestamp), notifiedEpisode: 0 };
      migrated = true;
    }
  }
  return migrated;
}

function getTrackedNotificationEntries(animeData) {
  return Object.entries(animeData || {}).filter(([, anime]) => {
    const listState = globalThis.AnimeTrackerEntryState?.getResolvedListState?.(anime) || String(anime?.listState || "").toLowerCase();
    return !["dropped", "completed", "on_hold"].includes(listState);
  });
}

function buildPendingEpisodeItems(eligible, state) {
  const items = [];
  for (const { slug, anime } of eligible) {
    const pending = state[slug]?.pendingEpisode;
    const episode = Math.max(0, Number(pending?.episode) || 0);
    if (!episode) continue;
    items.push({
      slug,
      episode,
      title: pending.title || anime?.title || "Your anime",
      behind: Math.max(1, Number(pending.behind) || 1),
    });
  }
  return items;
}

async function clearPendingEpisodeAlerts() {
  const stored = await bgStorageGet([SMART_NOTIF_STATE_KEY]);
  const state = { ...(stored[SMART_NOTIF_STATE_KEY] || {}) };
  let changed = false;
  for (const [slug, rawEntry] of Object.entries(state)) {
    if (!rawEntry?.pendingEpisode) continue;
    const entry = { ...rawEntry };
    delete entry.pendingEpisode;
    state[slug] = entry;
    changed = true;
  }
  if (changed) await bgStorageSet({ [SMART_NOTIF_STATE_KEY]: state });
  return changed;
}

async function deliverPendingEpisodeAlerts(eligible, state) {
  const pendingItems = buildPendingEpisodeItems(eligible, state);
  if (pendingItems.length === 0) return { accepted: 0, changed: false };
  const stored = await bgStorageGet([SMART_NOTIF_SETTING_KEY]);
  if (stored[SMART_NOTIF_SETTING_KEY] !== true) return { accepted: 0, changed: false, disabled: true };

  const coordinator = self.AnimeTrackerNotificationCoordinator;
  if (!coordinator?.notifyEpisodes) throw new Error("Notification coordinator unavailable");
  const result = await coordinator.notifyEpisodes(pendingItems);
  if (!result?.accepted) throw new Error(result?.error || "Notification delivery was not accepted");

  const accepted = new Set((result.acceptedIds || []).map((item) => `${item.slug}:${Number(item.episode) || 0}`));
  let changed = false;
  for (const item of pendingItems) {
    if (!accepted.has(`${item.slug}:${item.episode}`)) continue;
    const entry = state[item.slug];
    if (!entry || Number(entry.pendingEpisode?.episode) !== item.episode) continue;
    entry.notifiedEpisode = Math.max(Number(entry.notifiedEpisode) || 0, item.episode);
    entry.notificationQueuedAt = smartNotifNow();
    delete entry.pendingEpisode;
    state[item.slug] = entry;
    changed = true;
  }
  return { accepted: accepted.size, changed, delivery: result };
}

async function checkNewEpisodesOnce(disableGeneration) {
  const settings = await bgStorageGet([
    SMART_NOTIF_SETTING_KEY,
    "animeData",
    SMART_NOTIF_STATE_KEY,
    SMART_NOTIF_LEGACY_STATE_KEY,
  ]);
  if (settings[SMART_NOTIF_SETTING_KEY] !== true) return { enabled: false, checked: 0, discovered: 0 };

  const animeData = settings.animeData || {};
  const state = { ...(settings[SMART_NOTIF_STATE_KEY] || {}) };
  const now = smartNotifNow();
  const migrated = migrateLegacySmartNotificationState(state, settings[SMART_NOTIF_LEGACY_STATE_KEY]);
  const trackedEntries = getTrackedNotificationEntries(animeData);
  const tracked = trackedEntries.map(([slug, anime]) => ({ slug, anime }));
  const infoKeys = trackedEntries.map(([slug]) => `animeinfo_${slug}`);
  const cachedInfos = infoKeys.length > 0 ? await bgStorageGet(infoKeys) : {};
  const eligible = [];

  for (const [slug, anime] of trackedEntries) {
    const cachedKey = `animeinfo_${slug}`;
    const cached = cachedInfos[cachedKey] || null;
    if (cached?.status === "FINISHED") continue;
    eligible.push({ slug, anime, cached });
  }

  try {
    const pendingDelivery = await deliverPendingEpisodeAlerts(tracked, state);
    if (pendingDelivery.changed) await bgStorageSet({ [SMART_NOTIF_STATE_KEY]: state });
  } catch (error) {
    console.warn("[BG] Pending episode alert handoff failed:", error?.message || error);
  }

  const due = eligible.filter(({ slug, cached }) => {
    const entry = state[slug] || {};
    return now >= computeNextCheckAt(cached, entry, now);
  });
  due.sort((a, b) => urgencyKey(a.cached, state[a.slug] || {}, now) - urgencyKey(b.cached, state[b.slug] || {}, now));

  let checked = 0;
  let discovered = 0;
  for (const { slug, anime, cached } of due) {
    if (checked >= SMART_NOTIF_MAX_PER_TICK) break;
    checked++;

    const entry = { ...(state[slug] || {}) };
    entry.lastAttemptAt = now;
    let scheduleInfo = cached;
    try {
      const resolved = await self.AnimeTrackerAnimeResolver.resolve(slug, {
        title: anime?.title || slug,
        mediaType: anime?.mediaType || null,
        mediaTypeUpdatedAt: anime?.mediaTypeUpdatedAt || null,
        includeEpisodeTypes: false,
        forceInfoRefresh: true,
      });
      const info = resolved.info;
      if (!info || resolved.infoResult?.status === "failed") {
        throw new Error(resolved.errors?.[0]?.message || "Anime metadata unavailable");
      }
      scheduleInfo = info;
      if (info?.latestEpisode) {
        const previousLatest = Number(cached?.latestEpisode) || 0;
        const latest = Number(info.latestEpisode) || 0;
        const highestWatched = highestWatchedEpisode(anime);
        const alreadyNotified = Number(entry.notifiedEpisode) || 0;
        const pendingEpisode = Number(entry.pendingEpisode?.episode) || 0;
        const isNew = latest > previousLatest && previousLatest > 0 && latest > highestWatched && latest > alreadyNotified;

        const stillEnabled =
          !isNew || (await bgStorageGet([SMART_NOTIF_SETTING_KEY]))[SMART_NOTIF_SETTING_KEY] === true;
        if (isNew && stillEnabled && disableGeneration === smartNotifDisableGeneration && latest > pendingEpisode) {
          entry.pendingEpisode = {
            episode: latest,
            title: anime?.title || "Your anime",
            behind: Math.max(1, latest - highestWatched),
            detectedAt: now,
          };
          state[slug] = entry;
          await bgStorageSet({ [SMART_NOTIF_STATE_KEY]: state });
          discovered++;
        }

      }

      entry.lastCheckedAt = now;
      entry.consecutiveFailures = 0;
      delete entry.lastErrorAt;
    } catch (error) {
      entry.consecutiveFailures = Math.max(0, Number(entry.consecutiveFailures) || 0) + 1;
      entry.lastErrorAt = now;
    }

    entry.nextCheckAt = computeNextCheckAt(scheduleInfo, entry, now);
    state[slug] = entry;
    await bgStorageSet({ [SMART_NOTIF_STATE_KEY]: state });

    if (checked < Math.min(due.length, SMART_NOTIF_MAX_PER_TICK)) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  const trackedSlugs = new Set(tracked.map((entry) => entry.slug));
  for (const slug of Object.keys(state)) {
    if (!trackedSlugs.has(slug)) delete state[slug];
  }

  try {
    await deliverPendingEpisodeAlerts(tracked, state);
  } catch (error) {
    console.warn("[BG] Episode alert handoff failed:", error?.message || error);
  }

  await bgStorageSet({ [SMART_NOTIF_STATE_KEY]: state });
  if (migrated) {
    try {
      await bgStorageSet({ [SMART_NOTIF_LEGACY_STATE_KEY]: null });
    } catch {}
  }
  return { enabled: true, checked, discovered, eligible: eligible.length };
}

function checkNewEpisodes() {
  if (smartNotifCheckInFlight) return smartNotifCheckInFlight;
  const disableGeneration = smartNotifDisableGeneration;
  smartNotifCheckInFlight = checkNewEpisodesOnce(disableGeneration)
    .catch((error) => {
      console.warn("[BG] Smart notification check failed:", error?.message || error);
      throw error;
    })
    .finally(() => {
      smartNotifCheckInFlight = null;
    });
  return smartNotifCheckInFlight;
}

async function reconcileSmartNotificationAlarmOnce(explicitEnabled) {
  const enabled =
    typeof explicitEnabled === "boolean"
      ? explicitEnabled
      : (await bgStorageGet([SMART_NOTIF_SETTING_KEY]))[SMART_NOTIF_SETTING_KEY] === true;

  const existingAlarm = await chrome.alarms.get(SMART_NOTIF_ALARM);
  const coordinator = self.AnimeTrackerNotificationCoordinator;
  if (!coordinator?.setCategoryEnabled) throw new Error("Notification coordinator unavailable");
  if (enabled) {
    const hasExpectedSchedule =
      !!existingAlarm && Number(existingAlarm.periodInMinutes) === SMART_NOTIF_INTERVAL_MINUTES;
    if (!hasExpectedSchedule) {
      await chrome.alarms.create(SMART_NOTIF_ALARM, {
        delayInMinutes: 1,
        periodInMinutes: SMART_NOTIF_INTERVAL_MINUTES,
      });
    }
    await coordinator.setCategoryEnabled("episode", true);
  } else {
    if (existingAlarm) await chrome.alarms.clear(SMART_NOTIF_ALARM);
    await coordinator.setCategoryEnabled("episode", false, { clearVisible: true });
    if (!smartNotifCheckInFlight) await clearPendingEpisodeAlerts();
  }

  const alarm = await chrome.alarms.get(SMART_NOTIF_ALARM);
  const operational = enabled ? !!alarm : !alarm;
  if (!operational) throw new Error(enabled ? "Smart notification alarm was not created" : "Smart notification alarm was not cleared");
  return {
    success: true,
    enabled,
    operational,
    alarmActive: !!alarm,
    nextCheckAt: alarm?.scheduledTime || null,
  };
}

function reconcileSmartNotificationAlarm(explicitEnabled) {
  const run = () => reconcileSmartNotificationAlarmOnce(explicitEnabled);
  const result = smartNotifAlarmTail.then(run, run);
  smartNotifAlarmTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function getSmartNotificationStatus(options = {}) {
  const stored = await bgStorageGet([SMART_NOTIF_SETTING_KEY]);
  const enabled = stored[SMART_NOTIF_SETTING_KEY] === true;
  let error = null;
  if (options.reconcile !== false) {
    try {
      await reconcileSmartNotificationAlarm(enabled);
    } catch (reconcileError) {
      error = reconcileError?.message || String(reconcileError);
    }
  }

  const alarm = await chrome.alarms.get(SMART_NOTIF_ALARM);
  const delivery = await self.AnimeTrackerNotificationCoordinator?.getStatus?.().catch(() => null);
  const operational = enabled ? !!alarm && !error : !alarm && !error;
  return {
    success: true,
    enabled,
    operational,
    alarmActive: !!alarm,
    nextCheckAt: alarm?.scheduledTime || null,
    pendingDeliveries: Number(delivery?.pendingByCategory?.episode) || 0,
    deliveryRetryAt: delivery?.retryAt || null,
    error,
  };
}

async function setSmartNotificationsEnabled(enabled) {
  const nextEnabled = enabled === true;
  if (!nextEnabled) smartNotifDisableGeneration++;
  const updatedAt = new Date().toISOString();
  const change = await runBgLibraryTransaction([SMART_NOTIF_SETTING_KEY, "playbackSettingsUpdatedAt"], async (stored) => {
    const previousEnabled = stored[SMART_NOTIF_SETTING_KEY] === true;
    return {
      data: {
        [SMART_NOTIF_SETTING_KEY]: nextEnabled,
        playbackSettingsUpdatedAt: updatedAt,
      },
      result: { previousEnabled },
    };
  });

  let status;
  try {
    status = await reconcileSmartNotificationAlarm(nextEnabled);
  } catch (error) {
    const rollbackAt = new Date().toISOString();
    await runBgLibraryTransaction([SMART_NOTIF_SETTING_KEY, "playbackSettingsUpdatedAt"], async () => ({
      data: {
        [SMART_NOTIF_SETTING_KEY]: change.previousEnabled,
        playbackSettingsUpdatedAt: rollbackAt,
      },
      result: true,
    }));
    await reconcileSmartNotificationAlarm(change.previousEnabled).catch(() => {});
    return {
      success: false,
      enabled: change.previousEnabled,
      operational: false,
      error: error?.message || String(error),
    };
  }

  let cloudQueued = false;
  try {
    const syncResult = await queueStoredPlaybackSettings();
    cloudQueued = !!(syncResult?.success || syncResult?.pending);
  } catch {}

  if (nextEnabled) {
    checkNewEpisodes().catch(() => {});
  }
  return { ...status, cloudQueued };
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== "local" || !changes[SMART_NOTIF_SETTING_KEY]) return;
  const enabled = changes[SMART_NOTIF_SETTING_KEY].newValue === true;
  if (!enabled) smartNotifDisableGeneration++;
  const activeCheck = smartNotifCheckInFlight;
  reconcileSmartNotificationAlarm(enabled).catch((error) => {
    console.warn("[BG] Smart notification alarm reconciliation failed:", error?.message || error);
  });
  if (!enabled) {
    Promise.resolve(activeCheck)
      .catch(() => {})
      .then(() => clearPendingEpisodeAlerts())
      .catch((error) => console.warn("[BG] Smart notification pending-state cleanup failed:", error?.message || error));
  }
});

chrome.runtime.onInstalled.addListener(() => {
  reconcileSmartNotificationAlarm().catch((error) => {
    console.warn("[BG] Smart notification install reconciliation failed:", error?.message || error);
  });
});
