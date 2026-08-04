// notification-coordinator.js — durable Chrome notification delivery, deduplication,
// retry scheduling, and click routing for all background notification producers.
(function () {
  "use strict";

  const STATE_KEY = "notificationDeliveryStateV1";
  const RETRY_ALARM = "notificationDeliveryRetry";
  const ICON_URL = "src/icons/icon128.png";
  const DELIVERED_TTL_MS = 90 * 24 * 60 * 60 * 1000;
  const PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const MAX_DELIVERED_KEYS = 1200;
  const MAX_FLUSH_PER_RUN = 12;
  const RETRY_DELAYS_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000, 6 * 60 * 60 * 1000];

  let deliveryTail = Promise.resolve();

  function nowMs() {
    return Date.now();
  }

  function enqueueDeliveryTask(operation) {
    const result = deliveryTail.then(operation, operation);
    deliveryTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function hashText(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function truncate(value, maxLength) {
    const text = String(value || "").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
  }

  function normalizeState(raw) {
    const state = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
      version: 1,
      pending: state.pending && typeof state.pending === "object" && !Array.isArray(state.pending) ? { ...state.pending } : {},
      delivered: state.delivered && typeof state.delivered === "object" && !Array.isArray(state.delivered) ? { ...state.delivered } : {},
      categories:
        state.categories && typeof state.categories === "object" && !Array.isArray(state.categories)
          ? { ...state.categories }
          : {},
      updatedAt: Number(state.updatedAt) || 0,
    };
  }

  async function readState() {
    const stored = await bgStorageGet([STATE_KEY]);
    return normalizeState(stored[STATE_KEY]);
  }

  async function persistState(state) {
    state.updatedAt = nowMs();
    await bgStorageSet({ [STATE_KEY]: state });
  }

  function pruneState(state, now = nowMs()) {
    let changed = false;
    for (const [eventKey, entry] of Object.entries(state.pending)) {
      const createdAt = Number(entry?.createdAt) || 0;
      if (!entry || !Array.isArray(entry.dedupeKeys) || (createdAt > 0 && now - createdAt > PENDING_TTL_MS)) {
        delete state.pending[eventKey];
        changed = true;
      }
    }

    for (const [dedupeKey, entry] of Object.entries(state.delivered)) {
      const deliveredAt = Number(entry?.deliveredAt) || 0;
      if (!deliveredAt || now - deliveredAt > DELIVERED_TTL_MS) {
        delete state.delivered[dedupeKey];
        changed = true;
      }
    }

    const deliveredEntries = Object.entries(state.delivered);
    if (deliveredEntries.length > MAX_DELIVERED_KEYS) {
      deliveredEntries
        .sort((a, b) => (Number(a[1]?.deliveredAt) || 0) - (Number(b[1]?.deliveredAt) || 0))
        .slice(0, deliveredEntries.length - MAX_DELIVERED_KEYS)
        .forEach(([dedupeKey]) => delete state.delivered[dedupeKey]);
      changed = true;
    }
    return changed;
  }

  function coveredDedupeKeys(state) {
    const covered = new Set(Object.keys(state.delivered));
    for (const entry of Object.values(state.pending)) {
      for (const key of entry?.dedupeKeys || []) covered.add(key);
    }
    return covered;
  }

  function notificationCreate(notificationId, options) {
    return new Promise((resolve, reject) => {
      try {
        chrome.notifications.create(notificationId, options, (createdId) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          resolve(createdId || notificationId);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function notificationClear(notificationId) {
    return new Promise((resolve, reject) => {
      try {
        chrome.notifications.clear(notificationId, (wasCleared) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          resolve(wasCleared === true);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function notificationGetAll() {
    return new Promise((resolve, reject) => {
      try {
        chrome.notifications.getAll((notifications) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          resolve(notifications || {});
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function reconcileRetryAlarm(state) {
    const pendingEntries = Object.values(state.pending);
    if (pendingEntries.length === 0) {
      await chrome.alarms.clear(RETRY_ALARM);
      return { active: false, nextRetryAt: null };
    }

    const now = nowMs();
    const nextRetryAt = Math.min(...pendingEntries.map((entry) => Math.max(now + 30 * 1000, Number(entry.nextAttemptAt) || now)));
    await chrome.alarms.create(RETRY_ALARM, { when: nextRetryAt });
    return { active: true, nextRetryAt };
  }

  async function attemptDelivery(state, eventKey, now = nowMs()) {
    const entry = state.pending[eventKey];
    if (!entry) return { delivered: false, missing: true };

    try {
      await notificationCreate(entry.notificationId, entry.options);
      const deliveredAt = nowMs();
      for (const dedupeKey of entry.dedupeKeys) {
        state.delivered[dedupeKey] = {
          category: entry.category,
          notificationId: entry.notificationId,
          deliveredAt,
        };
      }
      delete state.pending[eventKey];
      return { delivered: true, notificationId: entry.notificationId };
    } catch (error) {
      const attempts = Math.max(0, Number(entry.attempts) || 0) + 1;
      const retryIndex = Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1);
      entry.attempts = attempts;
      entry.lastAttemptAt = now;
      entry.nextAttemptAt = now + RETRY_DELAYS_MS[retryIndex];
      entry.lastError = truncate(error?.message || error || "notification_create_failed", 240);
      state.pending[eventKey] = entry;
      return { delivered: false, queued: true, error: entry.lastError };
    }
  }

  function buildEpisodeEvent(items) {
    const keys = items.map((item) => `episode:${item.slug}:${item.episode}`).sort();
    if (items.length === 1) {
      const item = items[0];
      const behindText = item.behind > 1 ? ` · you're ${item.behind} episodes behind` : "";
      return {
        eventKey: keys[0],
        dedupeKeys: keys,
        notificationId: `new-ep-${item.slug}`,
        category: "episode",
        options: {
          type: "basic",
          iconUrl: ICON_URL,
          title: "New Episode Available!",
          message: truncate(`${item.title} — Episode ${item.episode} is out${behindText}`, 320),
          priority: 2,
          requireInteraction: true,
          buttons: [{ title: "Watch now" }],
        },
      };
    }

    const names = items.slice(0, 3).map((item) => item.title);
    const more = items.length - names.length;
    const list = names.join(", ") + (more > 0 ? ` +${more} more` : "");
    const hash = hashText(keys.join("|"));
    return {
      eventKey: `episode-batch:${hash}`,
      dedupeKeys: keys,
      notificationId: `new-eps-batch-${hash}`,
      category: "episode",
      options: {
        type: "basic",
        iconUrl: ICON_URL,
        title: `${items.length} new episodes available!`,
        message: truncate(`${list}. Tap to open your library.`, 320),
        priority: 2,
        requireInteraction: true,
        buttons: [{ title: "Open library" }],
      },
    };
  }

  function buildBadgeEvent(items) {
    const keys = items.map((item) => `badge:${item.id}`).sort();
    if (items.length <= 3) {
      return items.map((item) => ({
        eventKey: `badge:${item.id}`,
        dedupeKeys: [`badge:${item.id}`],
        notificationId: `badge-${item.id}`,
        category: "badge",
        options: {
          type: "basic",
          iconUrl: ICON_URL,
          title: "Badge unlocked!",
          message: truncate(`${item.title}${item.desc ? ` — ${item.desc}` : ""}`.trim(), 320),
          priority: 1,
        },
      }));
    }

    const hash = hashText(keys.join("|"));
    return [
      {
        eventKey: `badge-batch:${hash}`,
        dedupeKeys: keys,
        notificationId: `badges-batch-${hash}`,
        category: "badge",
        options: {
          type: "basic",
          iconUrl: ICON_URL,
          title: "Achievements unlocked!",
          message: `You unlocked ${items.length} new badges. Tap to view.`,
          priority: 1,
        },
      },
    ];
  }

  async function queueItems(items, category) {
    const dedupeKeyFor =
      category === "episode" ? (item) => `episode:${item.slug}:${item.episode}` : (item) => `badge:${item.id}`;
    const requestedDedupeKeys = items.map(dedupeKeyFor);
    return enqueueDeliveryTask(async () => {
      const state = await readState();
      const stateWasPruned = pruneState(state);
      if (state.categories[category]?.enabled === false) {
        if (stateWasPruned) await persistState(state);
        await reconcileRetryAlarm(state);
        return {
          accepted: false,
          disabled: true,
          acceptedKeys: [],
          delivered: 0,
          queued: Object.keys(state.pending).length,
        };
      }
      const covered = coveredDedupeKeys(state);
      const freshItems = [];
      for (const item of items) {
        const dedupeKey = dedupeKeyFor(item);
        if (covered.has(dedupeKey)) continue;
        covered.add(dedupeKey);
        freshItems.push(item);
      }

      if (freshItems.length === 0) {
        if (stateWasPruned) await persistState(state);
        await reconcileRetryAlarm(state);
        return {
          accepted: true,
          duplicate: true,
          acceptedKeys: requestedDedupeKeys,
          delivered: 0,
          queued: Object.keys(state.pending).length,
        };
      }

      const freshEvents = category === "episode" ? [buildEpisodeEvent(freshItems)] : buildBadgeEvent(freshItems);

      const createdAt = nowMs();
      for (const event of freshEvents) {
        state.pending[event.eventKey] = {
          ...event,
          createdAt,
          attempts: 0,
          lastAttemptAt: 0,
          nextAttemptAt: createdAt,
          lastError: null,
        };
      }
      await persistState(state);

      let delivered = 0;
      for (const event of freshEvents) {
        const result = await attemptDelivery(state, event.eventKey, createdAt);
        if (result.delivered) delivered++;
        await persistState(state);
      }
      const alarm = await reconcileRetryAlarm(state);
      return {
        accepted: true,
        duplicate: false,
        acceptedKeys: requestedDedupeKeys,
        delivered,
        queued: Object.keys(state.pending).length,
        retryAt: alarm.nextRetryAt,
      };
    });
  }

  function normalizeEpisodeItems(items) {
    const byKey = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      const slug = String(item?.slug || "").trim();
      const episode = Math.max(0, Number(item?.episode) || 0);
      if (!slug || !episode) continue;
      const key = `${slug}:${episode}`;
      byKey.set(key, {
        slug,
        episode,
        title: truncate(item?.title || "Your anime", 140),
        behind: Math.max(1, Number(item?.behind) || 1),
      });
    }
    return [...byKey.values()];
  }

  function normalizeBadgeItems(items) {
    const byId = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      const id = String(item?.id || "").trim();
      if (!id) continue;
      byId.set(id, {
        id,
        title: truncate(item?.title || "Achievement", 140),
        desc: truncate(item?.desc || "", 180),
      });
    }
    return [...byId.values()];
  }

  async function notifyEpisodes(rawItems) {
    const items = normalizeEpisodeItems(rawItems);
    if (items.length === 0) return { accepted: true, acceptedIds: [], delivered: 0, queued: 0 };
    const result = await queueItems(items, "episode");
    return {
      ...result,
      acceptedIds: items.map((item) => ({ slug: item.slug, episode: item.episode })),
    };
  }

  async function notifyBadges(rawItems) {
    const items = normalizeBadgeItems(rawItems);
    if (items.length === 0) return { accepted: true, acceptedIds: [], delivered: 0, queued: 0 };
    const result = await queueItems(items, "badge");
    return { ...result, acceptedIds: items.map((item) => item.id) };
  }

  function flush(options = {}) {
    return enqueueDeliveryTask(async () => {
      const state = await readState();
      const now = nowMs();
      const changed = pruneState(state, now);
      const dueEntries = Object.entries(state.pending)
        .filter(([, entry]) => options.force === true || (Number(entry?.nextAttemptAt) || 0) <= now)
        .sort((a, b) => (Number(a[1]?.nextAttemptAt) || 0) - (Number(b[1]?.nextAttemptAt) || 0))
        .slice(0, MAX_FLUSH_PER_RUN);

      if (changed && dueEntries.length === 0) await persistState(state);
      let delivered = 0;
      for (const [eventKey] of dueEntries) {
        const result = await attemptDelivery(state, eventKey, now);
        if (result.delivered) delivered++;
        await persistState(state);
      }
      const alarm = await reconcileRetryAlarm(state);
      return { success: true, delivered, queued: Object.keys(state.pending).length, retryAt: alarm.nextRetryAt };
    });
  }

  function notificationPrefixesForCategory(category) {
    if (category === "episode") return ["new-ep-", "new-eps-batch"];
    if (category === "badge") return ["badge-", "badges-batch"];
    return [];
  }

  async function clearVisibleCategory(category) {
    const prefixes = notificationPrefixesForCategory(category);
    if (prefixes.length === 0) return;
    const visible = await notificationGetAll();
    await Promise.all(
      Object.keys(visible)
        .filter((id) => prefixes.some((prefix) => id.startsWith(prefix)))
        .map((id) => notificationClear(id).catch(() => false)),
    );
  }

  function setCategoryEnabled(category, enabled, options = {}) {
    const normalizedCategory = String(category || "").trim();
    if (!normalizedCategory) return Promise.reject(new Error("Notification category is required"));
    const nextEnabled = enabled === true;
    return enqueueDeliveryTask(async () => {
      const state = await readState();
      let changed = pruneState(state);
      if (state.categories[normalizedCategory]?.enabled !== nextEnabled) {
        state.categories[normalizedCategory] = { enabled: nextEnabled, updatedAt: nowMs() };
        changed = true;
      }
      if (!nextEnabled) {
        for (const [eventKey, entry] of Object.entries(state.pending)) {
          if (entry?.category !== normalizedCategory) continue;
          delete state.pending[eventKey];
          changed = true;
        }
      }
      if (changed) await persistState(state);
      await reconcileRetryAlarm(state);
      if (!nextEnabled && options.clearVisible === true) {
        try {
          await clearVisibleCategory(normalizedCategory);
        } catch {}
      }
      return { success: true, category: normalizedCategory, enabled: nextEnabled };
    });
  }

  function getStatus() {
    return enqueueDeliveryTask(async () => {
      const state = await readState();
      const changed = pruneState(state);
      if (changed) await persistState(state);
      const retryAlarm = await chrome.alarms.get(RETRY_ALARM);
      const pendingByCategory = {};
      const deliveredByCategory = {};
      for (const entry of Object.values(state.pending)) {
        const category = String(entry?.category || "unknown");
        pendingByCategory[category] = (pendingByCategory[category] || 0) + 1;
      }
      for (const entry of Object.values(state.delivered)) {
        const category = String(entry?.category || "unknown");
        deliveredByCategory[category] = (deliveredByCategory[category] || 0) + 1;
      }
      return {
        success: true,
        pending: Object.keys(state.pending).length,
        delivered: Object.keys(state.delivered).length,
        pendingByCategory,
        deliveredByCategory,
        categories: { ...state.categories },
        retryAt: retryAlarm?.scheduledTime || null,
      };
    });
  }

  async function openLibrary() {
    if (typeof chrome.action?.openPopup === "function") {
      try {
        await chrome.action.openPopup();
        return;
      } catch {}
    }
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
    } catch {}
  }

  async function handleNotificationAction(notificationId) {
    const id = String(notificationId || "");
    if (id.startsWith("new-ep-") && !id.startsWith("new-eps-batch")) {
      const slug = id.slice("new-ep-".length);
      if (slug) {
        try {
          await chrome.tabs.create({ url: `https://an1me.to/anime/${encodeURIComponent(slug)}/` });
        } catch {}
      }
    } else if (id.startsWith("new-eps-batch") || id.startsWith("badge-") || id.startsWith("badges-batch")) {
      await openLibrary();
    } else {
      return;
    }
    await notificationClear(id).catch(() => false);
  }

  chrome.notifications.onClicked.addListener((notificationId) => {
    handleNotificationAction(notificationId).catch(() => {});
  });

  chrome.notifications.onButtonClicked.addListener((notificationId) => {
    handleNotificationAction(notificationId).catch(() => {});
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== RETRY_ALARM) return;
    flush().catch((error) => console.warn("[BG] Notification outbox retry failed:", error?.message || error));
  });

  chrome.runtime.onStartup.addListener(() => {
    flush({ force: true }).catch(() => {});
  });

  chrome.runtime.onInstalled.addListener(() => {
    flush({ force: true }).catch(() => {});
  });

  self.AnimeTrackerNotificationCoordinator = Object.freeze({
    notifyEpisodes,
    notifyBadges,
    setCategoryEnabled,
    getStatus,
  });
})();
