// background.js — MV3 service worker: Firebase auth/token refresh, Firestore
// read/write sync (full + progress), debounced cloud polling, daily quota
// cleanup, and alarm-driven retries. Shared fetchers/jobs loaded via importScripts.
importScripts(
  "src/common/cloud.js",
  "src/common/data/cache-policy.js",
  "src/common/data/media-type.js",
  "src/common/data/entry-state.js",
  "src/background/fetchers/aniskip.js",
  "src/background/fetchers/filler-discovery.js",
  "src/background/fetchers/an1me-gateway.js",
  "src/background/fetchers/an1me-scraper.js",
  "src/background/notification-coordinator.js",
  "src/background/sync/watchlist-sync.js",
  "src/background/jobs/metadata-repair.js",
  "src/background/anime-resolver.js",
  "src/background/jobs/smart-notifications.js",
);

const FIREBASE_API_KEY = (self.firebaseConfig && self.firebaseConfig.apiKey) || "";
const FIREBASE_PROJECT_ID = (self.firebaseConfig && self.firebaseConfig.projectId) || "";
if (!FIREBASE_API_KEY || !FIREBASE_PROJECT_ID) {
  console.error("[BG] Firebase config missing — Firestore I/O will fail");
}
const FIRESTORE_DATABASE = `projects/${FIREBASE_PROJECT_ID}/databases/(default)`;
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/${FIRESTORE_DATABASE}`;
const CLOUD_CONSUMER_POLL_MIN_GAP_MS = 3 * 60 * 1000;

importScripts("src/common/data/merge-utils.js");

importScripts("src/common/data/anilist-core.js", "src/background/sync/anilist-sync.js");
importScripts("src/common/boot-check.js");

const sharedMergeUtils = self.AnimeTrackerMergeUtils || {};
const missingMergeUtil = (name) => () => { throw new Error(`[BG] Missing shared merge util: ${name}`); };

const mergeVideoProgress = sharedMergeUtils.mergeVideoProgress || missingMergeUtil("mergeVideoProgress");
const mergeAnimeData = sharedMergeUtils.mergeAnimeData || missingMergeUtil("mergeAnimeData");
const mergeDeletedAnime = sharedMergeUtils.mergeDeletedAnime || missingMergeUtil("mergeDeletedAnime");
const pruneStaleDeletedAnime = sharedMergeUtils.pruneStaleDeletedAnime || missingMergeUtil("pruneStaleDeletedAnime");
const applyDeletedAnime = sharedMergeUtils.applyDeletedAnime || missingMergeUtil("applyDeletedAnime");
const removeDeletedProgress = sharedMergeUtils.removeDeletedProgress || missingMergeUtil("removeDeletedProgress");
const mergeGroupCoverImages = sharedMergeUtils.mergeGroupCoverImages || missingMergeUtil("mergeGroupCoverImages");
const mergeGoalSettings = sharedMergeUtils.mergeGoalSettings || missingMergeUtil("mergeGoalSettings");
const mergeBadgeUnlocks = sharedMergeUtils.mergeBadgeUnlocks || missingMergeUtil("mergeBadgeUnlocks");
const areAnimeDataMapsEqual = sharedMergeUtils.areAnimeDataMapsEqual || missingMergeUtil("areAnimeDataMapsEqual");
const areAnimeEntriesEqual = sharedMergeUtils.areAnimeEntriesEqual || missingMergeUtil("areAnimeEntriesEqual");
const areProgressMapsEqual = sharedMergeUtils.areProgressMapsEqual || missingMergeUtil("areProgressMapsEqual");
const shallowEqualDeletedAnime = sharedMergeUtils.shallowEqualDeletedAnime || missingMergeUtil("shallowEqualDeletedAnime");
const shallowEqualObjectMap = sharedMergeUtils.shallowEqualObjectMap || missingMergeUtil("shallowEqualObjectMap");
const isLikelyMovieSlug = sharedMergeUtils.isLikelyMovieSlug || missingMergeUtil("isLikelyMovieSlug");
const isPlaceholderDuration = sharedMergeUtils.isPlaceholderDuration || missingMergeUtil("isPlaceholderDuration");
const stripAutoRepairedEpisodesFromMap = sharedMergeUtils.stripAutoRepairedEpisodesFromMap || ((m) => m);
const stripEpisodeDefaultsFromMap = sharedMergeUtils.stripEpisodeDefaultsFromMap || ((m) => m);
const encodeEpisodesForCloud = sharedMergeUtils.encodeEpisodesForCloud || ((m) => m);
const decodeEpisodesFromCloud = sharedMergeUtils.decodeEpisodesFromCloud || ((m) => m);

const BG_DEBUG = false;
const dlog = (...a) => { if (BG_DEBUG) console.log(...a); };
// Silent in production (BG_DEBUG off), but makes swallowed errors observable when debugging.
const swallow = (ctx, err) => dlog(`[BG] swallowed (${ctx}):`, err?.message || err);
const ddebug = (...a) => { if (BG_DEBUG) console.debug(...a); };

const FSDebug = (() => {
  let enabled = false;
  let startedAt = Date.now();
  let lastReadAt = 0;
  let lastWriteAt = 0;
  const counts = {
    reads: 0,
    writes: 0,
    skips: 0,
    bytes: 0,
    readKind: { full: 0, revalidate: 0 },
    writeType: { full: 0, progress: 0, playback: 0, anilist: 0 },
    skipType: { full: 0, progress: 0, playback: 0, anilist: 0 },
  };
  const recent = [];
  const netAgg = {
    read: { n: 0, total: 0, max: 0 },
    write: { n: 0, total: 0, max: 0 },
    fails: 0,
    timeouts: 0,
    lastFail: null,
  };

  try {
    chrome.storage.local
      .get(["__fsDebug"])
      .then((r) => {
        if (typeof r.__fsDebug === "boolean") enabled = r.__fsDebug;
      })
      .catch(() => {});
    chrome.storage.onChanged.addListener((ch, ns) => {
      if (ns === "local" && ch.__fsDebug && typeof ch.__fsDebug.newValue === "boolean") {
        enabled = ch.__fsDebug.newValue;
        console.log(
          `%cFirestore debug ${enabled ? "ON" : "OFF"}`,
          `background:${enabled ? "#10b981" : "#64748b"};color:#fff;border-radius:3px;padding:1px 7px;font-weight:600`,
        );
      }
    });
  } catch {}

  const mins = () => Math.max(1 / 60, (Date.now() - startedAt) / 60000);
  const rate = (n) => +(n / mins()).toFixed(1);
  const ago = (t) => (t ? `${Math.round((Date.now() - t) / 1000)}s ago` : "—");
  const kb = (b) => `${(b / 1024).toFixed(1)} KB`;

  const css = {
    read: "background:#f97316;color:#fff;border-radius:3px;padding:1px 7px;font-weight:600",
    write: "background:#ef4444;color:#fff;border-radius:3px;padding:1px 7px;font-weight:600",
    skip: "background:#475569;color:#cbd5e1;border-radius:3px;padding:1px 7px",
    reason: "color:#e2e8f0",
    meta: "color:#94a3b8",
  };

  const tag = () => `${counts.reads}R ${counts.writes}W · ${kb(counts.bytes)}`;
  const push = (e) => { recent.push(e); if (recent.length > 80) recent.shift(); };

  function read(reason, kind = "full") {
    counts.reads++;
    if (counts.readKind[kind] != null) counts.readKind[kind]++;
    lastReadAt = Date.now();
    push({ t: lastReadAt, op: "READ", kind, reason });
    if (!enabled) return;
    const why = reason || "cloud data";
    console.log(`%cREAD%c ${why} · ${kind}  %c${tag()}`, css.read, css.reason, css.meta);
  }

  function write(type, reason, info = {}) {
    counts.writes++;
    if (counts.writeType[type] != null) counts.writeType[type]++;
    const bytes = info.bytes || 0;
    counts.bytes += bytes;
    lastWriteAt = Date.now();
    push({ t: lastWriteAt, op: "WRITE", type, reason, fields: info.fields, bytes });
    if (!enabled) return;
    const what = info.fields && info.fields.length ? info.fields.join(", ") : type;
    const size = bytes ? `${kb(bytes)}` : "—";
    console.log(`%cWRITE%c ${what} · ${size}  %c${tag()}`, css.write, css.reason, css.meta);
  }

  function skip(type, reason) {
    counts.skips++;
    if (counts.skipType[type] != null) counts.skipType[type]++;
    push({ t: Date.now(), op: "SKIP", type, reason });
    if (!enabled) return;
    console.debug(`%cskip%c ${type} — already in sync`, css.skip, css.meta);
  }

  function net(method, ms, ok, status) {
    const kind = method && String(method).toUpperCase() !== "GET" ? "write" : "read";
    const b = netAgg[kind];
    b.n++;
    b.total += ms;
    if (ms > b.max) b.max = ms;
    if (!ok) {
      netAgg.fails++;
      if (status === "timeout") netAgg.timeouts++;
      netAgg.lastFail = { t: Date.now(), kind, status, ms };
    }
    push({ t: Date.now(), op: ok ? "NET" : "NETFAIL", kind, ms, status });
    if (!enabled) return;
    if (!ok) console.warn(`%cNET ✗%c ${kind} · ${status} · ${ms}ms`, css.write, css.meta);
    else console.debug(`%cnet%c ${kind} · ${ms}ms · ${status}`, css.skip, css.meta);
  }

  function stats() {
    const attempts = counts.writes + counts.skips;
    const savedPct = attempts ? Math.round((counts.skips / attempts) * 100) : 0;
    const summary = {
      uptimeMin: +mins().toFixed(1),
      reads: counts.reads,
      writes: counts.writes,
      skips: counts.skips,
      savedRatio: attempts ? +(counts.skips / attempts).toFixed(2) : 0,
      KBwritten: +(counts.bytes / 1024).toFixed(1),
      readsPerMin: rate(counts.reads),
      writesPerMin: rate(counts.writes),
      readByKind: { ...counts.readKind },
      writeByType: { ...counts.writeType },
      skipByType: { ...counts.skipType },
      lastRead: ago(lastReadAt),
      lastWrite: ago(lastWriteAt),
      netReadAvgMs: netAgg.read.n ? Math.round(netAgg.read.total / netAgg.read.n) : 0,
      netReadMaxMs: netAgg.read.max,
      netWriteAvgMs: netAgg.write.n ? Math.round(netAgg.write.total / netAgg.write.n) : 0,
      netWriteMaxMs: netAgg.write.max,
      netFails: netAgg.fails,
      netTimeouts: netAgg.timeouts,
    };

    const group = console.groupCollapsed || console.group || console.log;
    group.call(
      console,
      `%c FIRESTORE %c ${counts.reads} reads · ${counts.writes} writes · ${kb(counts.bytes)} · up ${summary.uptimeMin}m `,
      "background:#0ea5e9;color:#fff;border-radius:3px 0 0 3px;padding:2px 8px;font-weight:700",
      "background:#1e293b;color:#cbd5e1;border-radius:0 3px 3px 0;padding:2px 8px",
    );

    console.log(
      `%cREAD %c ${counts.reads}  %c${rate(counts.reads)}/min · last ${ago(lastReadAt)}`,
      css.read,
      "color:#fdba74;font-weight:700",
      css.meta,
    );
    console.log(
      `%cWRITE%c ${counts.writes}  %c${rate(counts.writes)}/min · ${kb(counts.bytes)} · last ${ago(lastWriteAt)}`,
      css.write,
      "color:#fca5a5;font-weight:700",
      css.meta,
    );
    console.log(`%cskip %c ${counts.skips}  %c${savedPct}% of writes avoided`, css.skip, "color:#cbd5e1;font-weight:700", css.meta);
    const _avg = (b) => (b.n ? Math.round(b.total / b.n) : 0);
    console.log(
      `%cnet  %c read ${_avg(netAgg.read)}ms·max ${netAgg.read.max}ms (${netAgg.read.n}) · write ${_avg(netAgg.write)}ms·max ${netAgg.write.max}ms (${netAgg.write.n}) · ✗${netAgg.fails} (timeout ${netAgg.timeouts})`,
      css.read,
      css.meta,
    );

    try {
      console.table([
        { type: "full sync", writes: counts.writeType.full, skipped: counts.skipType.full },
        { type: "progress", writes: counts.writeType.progress, skipped: counts.skipType.progress },
        { type: "playback", writes: counts.writeType.playback, skipped: counts.skipType.playback },
        { type: "anilist", writes: counts.writeType.anilist, skipped: counts.skipType.anilist },
      ]);
      console.table([
        { read: "fresh", count: counts.readKind.full },
        { read: "revalidate", count: counts.readKind.revalidate },
      ]);
    } catch {}

    if (recent.length) {
      const sub = console.groupCollapsed || console.log;
      sub.call(console, `%crecent activity (last ${Math.min(recent.length, 30)})`, "color:#94a3b8;font-weight:700");
      try {
        console.table(
          recent.slice(-30).map((e) => ({
            time: new Date(e.t).toLocaleTimeString(),
            op: e.op.toLowerCase(),
            what: (e.fields || []).join(", ") || e.type || e.kind || "",
            why: e.reason || "",
            KB: e.bytes ? +(e.bytes / 1024).toFixed(1) : "",
          })),
        );
      } catch {}
      console.groupEnd?.();
    }

    console.groupEnd?.();
    return summary;
  }

  function reset() {
    counts.reads = counts.writes = counts.skips = counts.bytes = 0;
    for (const k in counts.readKind) counts.readKind[k] = 0;
    for (const k in counts.writeType) counts.writeType[k] = 0;
    for (const k in counts.skipType) counts.skipType[k] = 0;
    recent.length = 0;
    netAgg.read.n = netAgg.read.total = netAgg.read.max = 0;
    netAgg.write.n = netAgg.write.total = netAgg.write.max = 0;
    netAgg.fails = netAgg.timeouts = 0;
    netAgg.lastFail = null;
    startedAt = Date.now();
    lastReadAt = lastWriteAt = 0;
    console.log("%cFirestore counters reset", "background:#10b981;color:#fff;border-radius:3px;padding:1px 7px;font-weight:600");
  }

  function enable(v) {
    enabled = !!v;
    try {
      chrome.storage.local.set({ __fsDebug: enabled });
    } catch {}
    console.log(
      `%cFirestore debug ${enabled ? "ON" : "OFF"}`,
      `background:${enabled ? "#10b981" : "#64748b"};color:#fff;border-radius:3px;padding:1px 7px;font-weight:600`,
    );
    return enabled;
  }

  return { read, write, skip, net, stats, reset, enable, isEnabled: () => enabled };
})();
try {
  globalThis.fsStats = () => FSDebug.stats();
  globalThis.fsReset = () => FSDebug.reset();
  globalThis.fsOn = () => FSDebug.enable(true);
  globalThis.fsOff = () => FSDebug.enable(false);
  globalThis.fsState = () => ({ enabled: FSDebug.isEnabled() });
} catch {}

const COMPLETED_PERCENTAGE = 85;
const DELETED_ANIME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PROGRESS_ENTRIES = 200;

const PROGRESS_TOMBSTONE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

function stripFirebaseSilentAnimeMetadata(anime) {
  if (!anime || typeof anime !== "object") return anime;
  const copy = { ...anime };
  delete copy.coverImage;
  delete copy.siteAnimeId;
  delete copy.totalEpisodes;
  delete copy.latestEpisode;
  delete copy.nextEpisodeAt;
  delete copy.nextEpisodeTimezone;
  delete copy.durationSeconds;
  delete copy.totalWatchTime;
  // Stripped so watchlist bookkeeping alone never triggers a full sync (it piggybacks on the next real change).
  delete copy.watchlistSyncedType;

  if (Array.isArray(copy.episodes)) {
    copy.episodes = copy.episodes.map((episode) => {
      if (!episode || typeof episode !== "object") return episode;
      const epCopy = { ...episode };
      delete epCopy.duration;
      delete epCopy.durationSource;
      delete epCopy.patchedManually;
      return epCopy;
    });
  }

  return copy;
}

function areAnimeDataEqualIgnoringFetchMetadata(oldAnime = {}, newAnime = {}) {
  const oldKeys = Object.keys(oldAnime || {}).sort();
  const newKeys = Object.keys(newAnime || {}).sort();
  if (oldKeys.length !== newKeys.length) return false;
  for (let i = 0; i < oldKeys.length; i++) {
    if (oldKeys[i] !== newKeys[i]) return false;
    const key = oldKeys[i];
    const oldComparable = stripFirebaseSilentAnimeMetadata(oldAnime[key]);
    const newComparable = stripFirebaseSilentAnimeMetadata(newAnime[key]);
    if (JSON.stringify(oldComparable) !== JSON.stringify(newComparable)) {
      return false;
    }
  }
  return true;
}

const PENDING_SYNC_KEY = "syncState.pendingFlush";
const PENDING_PROGRESS_SYNC_KEY = "syncState.pendingProgressFlush";
const CLOUD_SYNC_STATUS_KEY = "syncState.cloudStatus";
const BG_SYNC_WRITE_TOKEN_KEY = "syncState.internalWriteToken";
const LIBRARY_MUTATION_REVISION_KEY = "libraryMutationRevision";
const LIBRARY_MUTATION_KEYS = Object.freeze([
  "animeData",
  "videoProgress",
  "deletedAnime",
  "groupCoverImages",
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
const LIBRARY_MUTATION_KEY_SET = new Set(LIBRARY_MUTATION_KEYS);
const PENDING_SIDECAR_SYNC_KEY = "syncState.pendingSidecars";
const SIDECAR_SYNC_RETRY_ALARM = "sidecarSyncRetry";

let fullSyncGeneration = 0;
let progressSyncGeneration = 0;
let bgSyncWriteTokenCounter = 0;
const recentBgSyncWriteTokens = new Set();
let bgLibraryMutationTail = Promise.resolve();
let bgAuthMutationTail = Promise.resolve();
let sidecarSyncTail = Promise.resolve();

function stampBgSyncStorageWrite(data) {
  const token = `${Date.now()}:${++bgSyncWriteTokenCounter}`;
  recentBgSyncWriteTokens.add(token);
  while (recentBgSyncWriteTokens.size > 50) {
    recentBgSyncWriteTokens.delete(recentBgSyncWriteTokens.values().next().value);
  }
  return { ...data, [BG_SYNC_WRITE_TOKEN_KEY]: token };
}

function consumeBgSyncStorageWrite(changes) {
  const token = changes[BG_SYNC_WRITE_TOKEN_KEY]?.newValue;
  if (!token || !recentBgSyncWriteTokens.has(token)) return false;
  recentBgSyncWriteTokens.delete(token);
  return true;
}

function buildCloudSyncStatus(state, details = {}) {
  const updatedAt = Date.now();
  const status = {
    state,
    kind: details.kind || "full",
    uid: details.uid || null,
    reason: details.reason || null,
    updatedAt,
  };
  if (state === "synced") status.lastSuccessfulAt = updatedAt;
  if (details.wrote === true || details.wrote === false) status.wrote = details.wrote;
  if (details.error) status.error = String(details.error).slice(0, 240);
  return status;
}

function persistCloudSyncStatus(state, details = {}) {
  const status = buildCloudSyncStatus(state, details);
  return bgStorageSet({ [CLOUD_SYNC_STATUS_KEY]: status })
    .then(() => status)
    .catch((error) => {
      dlog("[BG] Failed to persist cloud sync status:", error?.message || error);
      return status;
    });
}

function markSyncPending(reason = "local-change") {
  fullSyncGeneration += 1;
  const updatedAt = Date.now();
  bgStorageSet({
    [PENDING_SYNC_KEY]: updatedAt,
    [CLOUD_SYNC_STATUS_KEY]: buildCloudSyncStatus("pending", { kind: "full", reason }),
  }).catch((error) => dlog("[BG] Failed to mark full sync pending:", error?.message || error));
  return fullSyncGeneration;
}

function markProgressSyncPending(reason = "progress-change") {
  progressSyncGeneration += 1;
  const updatedAt = Date.now();
  bgStorageSet({
    [PENDING_PROGRESS_SYNC_KEY]: updatedAt,
    [CLOUD_SYNC_STATUS_KEY]: buildCloudSyncStatus("pending", { kind: "progress", reason }),
  }).catch((error) => dlog("[BG] Failed to mark progress sync pending:", error?.message || error));
  return progressSyncGeneration;
}

function clearSyncPending() {
  return bgStorageRemove([PENDING_SYNC_KEY]).catch((error) => {
    dlog("[BG] Failed to clear full sync pending:", error?.message || error);
  });
}

function clearProgressSyncPending() {
  return bgStorageRemove([PENDING_PROGRESS_SYNC_KEY]).catch((error) => {
    dlog("[BG] Failed to clear progress sync pending:", error?.message || error);
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  if (options?.keepalive) return fetch(url, options);
  const _fsTimed = typeof url === "string" && url.includes("firestore.googleapis.com");
  const _fsT0 = _fsTimed ? Date.now() : 0;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const makeTimeoutError = () => {
    const timeoutError = new Error(`Request timed out after ${Math.ceil(timeoutMs / 1000)}s`);
    timeoutError.name = "TimeoutError";
    timeoutError.isTimeout = true;
    return timeoutError;
  };
  let response;
  try {
    response = await fetch(url, { ...options, signal: ctrl.signal });
  } catch (error) {
    clearTimeout(timer);
    if (_fsTimed) FSDebug.net(options.method, Date.now() - _fsT0, false, timedOut ? "timeout" : "network");
    if (timedOut) throw makeTimeoutError();
    throw error;
  }
  if (_fsTimed) FSDebug.net(options.method, Date.now() - _fsT0, response.ok, response.status);
  // Headers arrived — clear the main timer now so callers that never read the body
  // (e.g. successful PATCHes) don't leave a stray abort timer running for 30s.
  clearTimeout(timer);
  for (const method of ["json", "text"]) {
    const original = response[method].bind(response);
    response[method] = () => {
      // Arm a fresh timer per body read so consumers that do read keep hang protection.
      const bodyTimer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, timeoutMs);
      return original().then(
        (value) => {
          clearTimeout(bodyTimer);
          return value;
        },
        (error) => {
          clearTimeout(bodyTimer);
          throw timedOut ? makeTimeoutError() : error;
        },
      );
    };
  }
  return response;
}

function cleanTrackedProgressBg(animeData, videoProgress, deletedAnime = {}) {
  if (!videoProgress || !animeData) return videoProgress;

  const baseProgress = removeDeletedProgress(videoProgress, deletedAnime);

  const trackedIds = new Set();
  for (const [slug, anime] of Object.entries(animeData)) {
    if (anime.episodes) {
      for (const ep of anime.episodes) {
        const listState = String(anime.listState || "").toLowerCase();
        if (anime.onHoldAt || anime.droppedAt || listState === "on_hold" || listState === "dropped") continue;

        if (ep?.durationSource === "anilist") continue;
        trackedIds.add(`${slug}__episode-${ep.number}`);
      }
    }
  }

  const trackedSlugs = new Set(Object.keys(animeData));
  const now = Date.now();
  const cleaned = {};
  for (const [id, progress] of Object.entries(baseProgress)) {
    if (id === "__slugIndex") continue;
    const isTracked = trackedIds.has(id);
    const isCompleted = (progress.percentage || 0) >= COMPLETED_PERCENTAGE;

    if (isTracked) continue;
    if (isCompleted) continue;
    if (progress.deleted) {
      const deletedAt = progress.deletedAt ? new Date(progress.deletedAt).getTime() : 0;
      if (deletedAt && now - deletedAt < PROGRESS_TOMBSTONE_KEEP_MS) {
        cleaned[id] = progress;
      }
      continue;
    }

    if (progress.coverImage) {
      const slugMatch = id.match(/^(.+)__episode-\d+$/);
      if (slugMatch && trackedSlugs.has(slugMatch[1])) {
        const { coverImage, ...rest } = progress;
        cleaned[id] = rest;
        continue;
      }
    }

    cleaned[id] = progress;
  }

  const entries = Object.entries(cleaned);
  if (entries.length > MAX_PROGRESS_ENTRIES) {
    const getTs = (p) => {
      const t = p?.savedAt || p?.lastPlayedAt || 0;
      return t ? new Date(t).getTime() : 0;
    };
    entries.sort((a, b) => getTs(b[1]) - getTs(a[1]));
    const capped = {};
    for (let i = 0; i < MAX_PROGRESS_ENTRIES; i++) {
      capped[entries[i][0]] = entries[i][1];
    }
    return capped;
  }
  return cleaned;
}

function pruneDeletedAnime(deletedAnime) {
  if (!deletedAnime) return;
  const cutoff = Date.now() - DELETED_ANIME_MAX_AGE_MS;
  for (const slug of Object.keys(deletedAnime)) {
    const info = deletedAnime[slug];
    const deletedAt = +new Date(info?.deletedAt || info || 0);
    if (deletedAt > 0 && deletedAt < cutoff) {
      delete deletedAnime[slug];
    }
  }
}

const DAILY_CLEANUP_ALARM = "dailyCleanup";
const DAILY_CLEANUP_TARGET = 0.7;
const QUOTA_BYTES_BG = 10 * 1024 * 1024;

function bgMeasureBytes() {
  return new Promise((res) => {
    try {
      chrome.storage.local.getBytesInUse(null, (b) => {
        void chrome.runtime.lastError;
        res(Number(b) || 0);
      });
    } catch {
      res(0);
    }
  });
}

async function bgIterativeQuotaRecovery(reason = "daily-alarm") {
  try {
    const bytesBefore = await bgMeasureBytes();
    const target = Math.round(QUOTA_BYTES_BG * DAILY_CLEANUP_TARGET);
    if (bytesBefore <= target) {
      dlog(`[Cleanup] skip (${bytesBefore} ≤ ${target} bytes; reason=${reason})`);
      return { ok: true, bytesBefore, bytesAfter: bytesBefore, passes: 0 };
    }
    const all = await new Promise((resolve, reject) => {
      chrome.storage.local.get(null, (result) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
        } else resolve(result || {});
      });
    });

    // Prune expired metadata caches only; wiping fresh ones forces a full library re-fetch.
    const { staleKeys, freshKeysOldestFirst } = self.AnimeTrackerCachePolicy.partitionMetadataCacheKeys(all);
    if (staleKeys.length > 0) await bgStorageRemove(staleKeys);

    let cap = await runBgLibraryTransaction(
      ["animeData", "videoProgress", "deletedAnime"],
      (latest) => {
        const localAnime = latest.animeData || {};
        const localProgress = latest.videoProgress || {};
        const localDeleted = latest.deletedAnime || {};
        const cleaned = cleanTrackedProgressBg(localAnime, localProgress, localDeleted);
        const sorted = Object.entries(cleaned).sort((a, b) => {
          const aTs = new Date(a[1]?.savedAt || a[1]?.watchedAt || 0).getTime() || 0;
          const bTs = new Date(b[1]?.savedAt || b[1]?.watchedAt || 0).getTime() || 0;
          return bTs - aTs;
        });
        const nextCap = Math.min(2000, sorted.length);

        const dCleaned = {};
        const dCutoff = Date.now() - 10 * 24 * 60 * 60 * 1000;
        const dEntries = Object.entries(localDeleted).sort((a, b) => {
          const aTs = new Date(a[1]?.deletedAt || 0).getTime() || 0;
          const bTs = new Date(b[1]?.deletedAt || 0).getTime() || 0;
          return bTs - aTs;
        });
        let dKept = 0;
        for (const [slug, info] of dEntries) {
          const timestamp = new Date(info?.deletedAt || 0).getTime() || 0;
          if (timestamp > 0 && timestamp < dCutoff) continue;
          dCleaned[slug] = info;
          dKept += 1;
          if (dKept >= 1500) break;
        }
        return {
          data: {
            videoProgress: Object.fromEntries(sorted.slice(0, nextCap)),
            deletedAnime: dCleaned,
          },
          result: nextCap,
        };
      },
    );

    let bytesNow = await bgMeasureBytes();
    let pass = 1;
    const maxPasses = 3;
    while (bytesNow > target && pass < maxPasses && cap > 250) {
      pass += 1;
      cap = Math.max(250, Math.floor(cap / 2));
      await runBgLibraryTransaction(["animeData", "videoProgress", "deletedAnime"], (latest) => {
        const cleaned = cleanTrackedProgressBg(
          latest.animeData || {},
          latest.videoProgress || {},
          latest.deletedAnime || {},
        );
        const sorted = Object.entries(cleaned).sort((a, b) => {
          const aTs = new Date(a[1]?.savedAt || a[1]?.watchedAt || 0).getTime() || 0;
          const bTs = new Date(b[1]?.savedAt || b[1]?.watchedAt || 0).getTime() || 0;
          return bTs - aTs;
        });
        return { data: { videoProgress: Object.fromEntries(sorted.slice(0, cap)) } };
      });
      bytesNow = await bgMeasureBytes();
    }

    // Last resort: still over target — evict fresh metadata caches too, oldest half first.
    let freshEvicted = 0;
    if (bytesNow > target && freshKeysOldestFirst.length > 0) {
      let evictCount = Math.ceil(freshKeysOldestFirst.length / 2);
      while (bytesNow > target && freshEvicted < freshKeysOldestFirst.length) {
        const batch = freshKeysOldestFirst.slice(freshEvicted, freshEvicted + evictCount);
        await bgStorageRemove(batch);
        freshEvicted += batch.length;
        bytesNow = await bgMeasureBytes();
        evictCount = Math.max(1, Math.ceil((freshKeysOldestFirst.length - freshEvicted) / 2));
      }
    }

    const ok = bytesNow <= target;
    console.log(
      `[Cleanup] daily prune: removed ${staleKeys.length} stale + ${freshEvicted} fresh cache entries, ` +
        `progress capped at ${cap} (was ${(bytesBefore / 1024 / 1024).toFixed(1)} MB → ` +
        `${(bytesNow / 1024 / 1024).toFixed(1)} MB) · reason=${reason} · passes=${pass}`,
    );
    return { ok, bytesBefore, bytesAfter: bytesNow, passes: pass };
  } catch (e) {
    console.warn("[Cleanup] daily prune failed:", e?.message || e);
    return { ok: false, error: e?.message };
  }
}

async function ensureDailyCleanupAlarmScheduled() {
  try {
    const KEY = "_dailyCleanupNextAt";
    const stored = await bgStorageGet([KEY]);
    let nextAt = Number(stored[KEY]) || 0;
    const now = Date.now();
    if (!nextAt || nextAt < now) {
      const next = new Date();
      next.setDate(next.getDate() + 1);
      next.setHours(3 + Math.floor(Math.random() * 2));
      next.setMinutes(Math.floor(Math.random() * 60));
      next.setSeconds(Math.floor(Math.random() * 60));
      next.setMilliseconds(0);
      nextAt = next.getTime();
      await bgStorageSet({ [KEY]: nextAt });
    }
    try {
      chrome.alarms.create(DAILY_CLEANUP_ALARM, {
        when: nextAt,
        periodInMinutes: 1440,
      });
      dlog(`[Cleanup] daily alarm scheduled for ${new Date(nextAt).toLocaleString()}`);
    } catch (e) {
      console.warn("[Cleanup] could not schedule alarm:", e?.message || e);
    }
  } catch (e) {
    console.warn("[Cleanup] scheduling check failed:", e?.message || e);
  }
}

// MV3 teardown errors are expected, but callers must abort instead of continuing with an empty snapshot.
function isBenignSwLifecycleError(message) {
  if (!message) return false;
  const m = String(message);
  return /No SW|Service worker|context invalidated|message port closed|message channel closed|before a response was received/i.test(m);
}

const BG_LEGACY_SYNC_KEYS = new Set(["animeData", "trackedEpisodes", "videoProgress"]);
const BG_LEGACY_SYNC_MIGRATION_KEY = "legacySyncMigrationV1Complete";
let bgLegacySyncMigrationPromise = null;
let bgLegacySyncMigrationComplete = false;

function bgStorageGet(keys) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get(keys, (result) => {
        const err = chrome.runtime.lastError;
        if (err) {
          if (isBenignSwLifecycleError(err.message)) {
            dlog("[BG] storage.get ignored during SW teardown:", err.message);
          }
          reject(new Error(err.message));
        } else {
          resolve(result || {});
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

function bgStorageSetRaw(data) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set(data, () => {
        const err = chrome.runtime.lastError;
        if (err) {
          if (isBenignSwLifecycleError(err.message)) {
            dlog("[BG] storage.set ignored during SW teardown:", err.message);
          }
          reject(new Error(err.message));
        } else {
          resolve();
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

function enqueueBgLibraryMutation(task) {
  const next = bgLibraryMutationTail.then(task, task);
  bgLibraryMutationTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function containsLibraryMutationData(data) {
  return Object.keys(data || {}).some((key) => LIBRARY_MUTATION_KEY_SET.has(key));
}

function normalizeLibraryMutationKeys(keys) {
  const requested = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : [];
  return [...new Set(requested.filter((key) => LIBRARY_MUTATION_KEY_SET.has(key)))];
}

async function bgStorageSet(data) {
  if (!containsLibraryMutationData(data)) return bgStorageSetRaw(data);

  await ensureBgLegacySyncMigration();

  return enqueueBgLibraryMutation(async () => {
    const stored = await bgStorageGet([LIBRARY_MUTATION_REVISION_KEY]);
    const revision = Math.max(0, Number(stored[LIBRARY_MUTATION_REVISION_KEY]) || 0) + 1;
    await bgStorageSetRaw({ ...data, [LIBRARY_MUTATION_REVISION_KEY]: revision });
  });
}

async function getLibraryMutationSnapshot(keys) {
  await ensureBgLegacySyncMigration();
  const requested = normalizeLibraryMutationKeys(keys);
  const snapshotKeys = requested.length > 0 ? requested : LIBRARY_MUTATION_KEYS;

  return enqueueBgLibraryMutation(async () => {
    const stored = await bgStorageGet([...snapshotKeys, LIBRARY_MUTATION_REVISION_KEY]);
    const data = {};
    for (const key of snapshotKeys) {
      if (Object.prototype.hasOwnProperty.call(stored, key)) data[key] = stored[key];
    }
    return {
      success: true,
      revision: Math.max(0, Number(stored[LIBRARY_MUTATION_REVISION_KEY]) || 0),
      data,
    };
  });
}

async function commitLibraryMutation(expectedRevision, data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { success: false, error: "invalid_mutation_data" };
  }
  if (!containsLibraryMutationData(data)) {
    return { success: false, error: "library_key_required" };
  }

  await ensureBgLegacySyncMigration();

  return enqueueBgLibraryMutation(async () => {
    const stored = await bgStorageGet([LIBRARY_MUTATION_REVISION_KEY]);
    const currentRevision = Math.max(0, Number(stored[LIBRARY_MUTATION_REVISION_KEY]) || 0);
    if (Number(expectedRevision) !== currentRevision) {
      return { success: false, conflict: true, revision: currentRevision };
    }

    const payload = { ...data };
    delete payload[LIBRARY_MUTATION_REVISION_KEY];
    const revision = currentRevision + 1;
    await bgStorageSetRaw({ ...payload, [LIBRARY_MUTATION_REVISION_KEY]: revision });
    return { success: true, revision };
  });
}

async function runBgLibraryTransaction(keys, operation) {
  if (typeof operation !== "function") throw new TypeError("Library transaction operation must be a function");

  const requested = normalizeLibraryMutationKeys(keys);
  if (requested.length === 0) throw new Error("Library transaction requires at least one coordinated key");

  await ensureBgLegacySyncMigration();
  return enqueueBgLibraryMutation(async () => {
    const stored = await bgStorageGet([...requested, LIBRARY_MUTATION_REVISION_KEY]);
    const snapshot = {};
    for (const key of requested) {
      if (Object.prototype.hasOwnProperty.call(stored, key)) snapshot[key] = stored[key];
    }

    const outcome = await operation(snapshot);
    if (!outcome || !outcome.data) return outcome?.result;
    if (!outcome.data || typeof outcome.data !== "object" || Array.isArray(outcome.data)) {
      throw new TypeError("Library transaction data must be an object");
    }
    if (!containsLibraryMutationData(outcome.data)) {
      throw new Error("Library transaction must write at least one coordinated key");
    }

    const payload = { ...outcome.data };
    delete payload[LIBRARY_MUTATION_REVISION_KEY];
    const revision = Math.max(0, Number(stored[LIBRARY_MUTATION_REVISION_KEY]) || 0) + 1;
    await bgStorageSetRaw({ ...payload, [LIBRARY_MUTATION_REVISION_KEY]: revision });
    return outcome.result;
  });
}

function bgStorageRemove(keys) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.remove(keys, () => {
        const err = chrome.runtime.lastError;
        if (err) {
          if (isBenignSwLifecycleError(err.message)) {
            dlog("[BG] storage.remove ignored during SW teardown:", err.message);
          }
          reject(new Error(err.message));
        } else {
          resolve();
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

function enqueueBgAuthMutation(task) {
  const next = bgAuthMutationTail.then(task, task);
  bgAuthMutationTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function normalizeStoredAuthTokens(tokens, previous = null) {
  const now = Date.now();
  return {
    ...(previous && typeof previous === "object" ? previous : {}),
    ...(tokens && typeof tokens === "object" ? tokens : {}),
    version: 2,
    lastAuthCheck: Number(tokens?.lastAuthCheck) || now,
    needsReauth: tokens?.needsReauth === true,
    authRefreshAttempts: Number(tokens?.authRefreshAttempts) || 0,
    authRefreshLastAttemptAt: Number(tokens?.authRefreshLastAttemptAt) || 0,
  };
}

async function bgMutateFirebaseAuth(request = {}) {
  return enqueueBgAuthMutation(async () => {
    const operation = String(request.operation || "");
    const stored = await bgStorageGet(["firebase_tokens", "firebase_user"]);
    const currentTokens = stored.firebase_tokens && typeof stored.firebase_tokens === "object" ? stored.firebase_tokens : null;
    const expectedRefreshToken = request.expectedRefreshToken || null;
    const expectedIdToken = request.expectedIdToken || null;
    const isStale =
      (expectedRefreshToken && currentTokens?.refreshToken !== expectedRefreshToken) ||
      (expectedIdToken && currentTokens?.idToken !== expectedIdToken);

    if (isStale) {
      return {
        success: true,
        applied: false,
        stale: true,
        reason: "session_changed",
        tokens: currentTokens,
      };
    }

    if (operation === "clear_session") {
      await bgStorageRemove(["firebase_tokens", "firebase_user"]);
      authState.signedOut = true;
      return { success: true, applied: true, tokens: null, user: null };
    }

    if (operation === "replace_session") {
      if (!request.user || typeof request.user !== "object" || !request.user.uid) {
        return { success: false, applied: false, error: "invalid_firebase_user" };
      }
      if (!request.tokens?.idToken || !request.tokens?.refreshToken || !request.tokens?.expiresAt) {
        return { success: false, applied: false, error: "invalid_firebase_tokens" };
      }
      const nextTokens = normalizeStoredAuthTokens(request.tokens);
      await bgStorageSetRaw({ firebase_user: request.user, firebase_tokens: nextTokens });
      authState.signedOut = false;
      return { success: true, applied: true, tokens: nextTokens, user: request.user };
    }

    if (operation === "replace_tokens") {
      if (!request.tokens?.idToken || !request.tokens?.refreshToken || !request.tokens?.expiresAt) {
        return { success: false, applied: false, error: "invalid_firebase_tokens" };
      }
      const nextTokens = normalizeStoredAuthTokens(request.tokens);
      await bgStorageSetRaw({ firebase_tokens: nextTokens });
      return { success: true, applied: true, tokens: nextTokens };
    }

    if (!currentTokens) {
      return { success: true, applied: false, reason: "no_session", tokens: null };
    }

    if (operation === "patch_tokens") {
      if (!request.patch || typeof request.patch !== "object" || Array.isArray(request.patch)) {
        return { success: false, applied: false, error: "invalid_token_patch" };
      }
      const nextTokens = { ...currentTokens, ...request.patch };
      await bgStorageSetRaw({ firebase_tokens: nextTokens });
      return { success: true, applied: true, tokens: nextTokens };
    }

    if (operation === "mark_transient_failure") {
      const nextTokens = {
        ...currentTokens,
        authRefreshAttempts: (Number(currentTokens.authRefreshAttempts) || 0) + 1,
        authRefreshLastAttemptAt: Date.now(),
      };
      await bgStorageSetRaw({ firebase_tokens: nextTokens });
      return { success: true, applied: true, tokens: nextTokens };
    }

    if (operation === "migrate_tokens") {
      if (currentTokens.version === 2) {
        return { success: true, applied: false, tokens: currentTokens };
      }
      const nextTokens = normalizeStoredAuthTokens(currentTokens, currentTokens);
      await bgStorageSetRaw({ firebase_tokens: nextTokens });
      return { success: true, applied: true, tokens: nextTokens };
    }

    return { success: false, applied: false, error: "unsupported_auth_operation" };
  });
}

const PROGRESS_SYNC_ALARM = "progressSyncDebounce";

const FULL_SYNC_RETRY_ALARM = "fullSyncRetry";
const PROGRESS_SYNC_RETRY_ALARM = "progressSyncRetry";

// Periodic safety-net full sync. The event-driven sync uses a 5s setTimeout that the MV3 SW can be
// torn down before it fires (common on mobile), so a real library change may never upload. This alarm
// survives SW teardown and flushes pending changes; it skips the cloud write when nothing changed.
const FULL_SYNC_PERIODIC_ALARM = "fullSyncPeriodic";
const FULL_SYNC_PERIODIC_MINUTES = 4;
function ensureFullSyncPeriodicAlarm() {
  try { chrome.alarms.create(FULL_SYNC_PERIODIC_ALARM, { periodInMinutes: FULL_SYNC_PERIODIC_MINUTES }); } catch {}
}

const SYNC_RETRY_BACKOFF_MIN = [1, 5, 15];
let _fullSyncRetryAttempts = 0;
let _progressSyncRetryAttempts = 0;
let _fullSyncRetryAuthAttempted = false;
let _progressSyncRetryAuthAttempted = false;

function _retryStateFor(kind) {
  if (kind === "full") {
    return {
      getAttempts: () => _fullSyncRetryAttempts,
      incAttempts: () => {
        _fullSyncRetryAttempts++;
      },
      resetAttempts: () => {
        _fullSyncRetryAttempts = 0;
        _fullSyncRetryAuthAttempted = false;
      },
      getAuthAttempted: () => _fullSyncRetryAuthAttempted,
      setAuthAttempted: (v) => {
        _fullSyncRetryAuthAttempted = !!v;
      },
      alarmName: FULL_SYNC_RETRY_ALARM,
    };
  }
  return {
    getAttempts: () => _progressSyncRetryAttempts,
    incAttempts: () => {
      _progressSyncRetryAttempts++;
    },
    resetAttempts: () => {
      _progressSyncRetryAttempts = 0;
      _progressSyncRetryAuthAttempted = false;
    },
    getAuthAttempted: () => _progressSyncRetryAuthAttempted,
    setAuthAttempted: (v) => {
      _progressSyncRetryAuthAttempted = !!v;
    },
    alarmName: PROGRESS_SYNC_RETRY_ALARM,
  };
}

function armSyncRetry(kind, reason) {
  const s = _retryStateFor(kind);
  const idx = Math.min(s.getAttempts(), SYNC_RETRY_BACKOFF_MIN.length - 1);
  const delayMin = SYNC_RETRY_BACKOFF_MIN[idx];
  s.incAttempts();
  try {
    chrome.alarms.create(s.alarmName, { delayInMinutes: delayMin });
    console.log(`[BG] ${kind} sync retry scheduled in ${delayMin} min (attempt ${s.getAttempts()}, reason: ${reason})`);
  } catch (e) {
    console.log(`[BG] Could not arm ${kind} retry alarm:`, e?.message || e);
  }
}

function clearSyncRetry(kind) {
  const s = _retryStateFor(kind);
  s.resetAttempts();
  try {
    chrome.alarms.clear(s.alarmName).catch(() => {});
  } catch {}
}

// Shared HTTP-error handling for full + progress syncs (was duplicated verbatim).
// kind: "full" | "progress". Caller logs the failure and (for full) marks pending first.
async function handleSyncHttpError({ kind, status, errorBody, expectedIdToken = null }) {
  const s = _retryStateFor(kind);
  const label = kind === "full" ? "Sync" : "Progress sync";
  if (status === 401) {
    if (s.getAuthAttempted()) {
      const cl = self.AnimeTrackerAuthClassifier;
      const cls = cl ? cl.classify(401, errorBody) : { permanent: false };
      if (cls.permanent) {
        console.error(`[BG] ${label} 401 with permanent code — signing out`);
        await signOutDueToTokenFailure();
        clearSyncRetry(kind);
      } else {
        console.warn(`[BG] ${label} still 401 after refresh — keeping session, alarm backoff`);
        armSyncRetry(kind, "401-still-after-refresh");
      }
    } else {
      s.setAuthAttempted(true);
      await _invalidateCachedTokenExpiry(expectedIdToken);
      armSyncRetry(kind, "401-needs-refresh");
    }
  } else if (status === 403) {
    _broadcastAuthRejected(403, errorBody);
    if (s.getAttempts() >= SYNC_RETRY_BACKOFF_MIN.length) {
      console.error(`[BG] ${label} 403 — giving up after max retries (check Firestore rules)`);
      clearSyncRetry(kind);
    } else {
      armSyncRetry(kind, "403");
    }
  } else if (status >= 500) {
    invalidateBgCloudDocCache();
    armSyncRetry(kind, `5xx (${status})`);
  } else if (kind === "full") {
    console.error(`[BG] ${label} got non-retryable ${status}; dropping pending flag`);
    clearSyncPending();
    clearSyncRetry(kind);
  } else {
    console.error(`[BG] ${label} got non-retryable ${status}`);
    clearSyncRetry(kind);
  }
}

async function _invalidateCachedTokenExpiry(expectedIdToken = null) {
  try {
    await self.AnimeTrackerAuthTokens?.writeTokens?.({ expiresAt: 0 }, { expectedIdToken });
  } catch (e) {
    console.warn("[BG] Could not invalidate cached token expiry:", e?.message || e);
  }
}

const syncState = {
  inProgress: false,
  pending: false,
  debounceTimeout: null,
  progressInProgress: false,
  progressPending: false,
  lastPushedProgress: null,
};

async function finishSuccessfulSync({ kind, user, reason, wrote, fullGeneration = null, progressGeneration = null }) {
  const newerFullChange = kind === "full" && fullGeneration !== fullSyncGeneration;
  const newerProgressChange = progressGeneration !== progressSyncGeneration;
  if (kind === "full") {
    if (!newerFullChange) await clearSyncPending();
    if (!newerProgressChange) await clearProgressSyncPending();
  } else if (!newerProgressChange) {
    await clearProgressSyncPending();
  }

  const stored = await bgStorageGet([PENDING_SYNC_KEY, PENDING_PROGRESS_SYNC_KEY]);
  const hasPending =
    !!stored[PENDING_SYNC_KEY] ||
    !!stored[PENDING_PROGRESS_SYNC_KEY] ||
    newerFullChange ||
    newerProgressChange ||
    syncState.pending ||
    syncState.progressPending;

  if (hasPending) {
    await persistCloudSyncStatus("pending", {
      kind: stored[PENDING_SYNC_KEY] ? "full" : "progress",
      uid: user?.uid || null,
      reason: "newer-local-change",
    });
    return false;
  }

  await persistCloudSyncStatus("synced", {
    kind,
    uid: user?.uid || null,
    reason,
    wrote,
  });
  return true;
}

async function finishFailedSync({ kind, user, reason, error }) {
  await persistCloudSyncStatus("error", {
    kind,
    uid: user?.uid || null,
    reason,
    error,
  });
}

let _lastCloudPollAt = 0;
let _cloudPollInFlight = null;

const _LAST_POLL_KEY = "_bgLastCloudPollAt";
const _LAST_PROGRESS_SYNC_KEY = "_bgLastProgressSyncAt";
const _RECENT_OWN_WRITES_KEY = "_bgRecentOwnWrites";
const _OWN_WRITE_PERSIST_TTL_MS = 60 * 1000;

let _bgHydrationPromise = null;
function hydrateBgPollState() {
  if (_bgHydrationPromise) return _bgHydrationPromise;
  _bgHydrationPromise = (async () => {
    try {
      const stored = await bgStorageGet([_LAST_POLL_KEY, _LAST_PROGRESS_SYNC_KEY, _RECENT_OWN_WRITES_KEY]);
      const cloud = Number(stored[_LAST_POLL_KEY]) || 0;
      const progress = Number(stored[_LAST_PROGRESS_SYNC_KEY]) || 0;

      const now = Date.now();
      if (cloud > 0 && cloud <= now) _lastCloudPollAt = cloud;
      if (progress > 0 && progress <= now) _lastProgressSyncAt = progress;

      const persistedWrites = stored[_RECENT_OWN_WRITES_KEY];
      if (Array.isArray(persistedWrites)) {
        _bgRecentOwnWrites.length = 0;
        let stalePruned = false;
        for (const entry of persistedWrites) {
          const ts = typeof entry === "string" ? entry : entry?.ts;
          const at = typeof entry === "object" ? Number(entry?.at) || 0 : 0;
          if (!ts) continue;
          if (at && now - at > _OWN_WRITE_PERSIST_TTL_MS) {
            stalePruned = true;
            continue;
          }
          _bgRecentOwnWrites.push(ts);
        }
        if (stalePruned) persistOwnWrites();
      }
    } catch {}
  })();
  return _bgHydrationPromise;
}

function persistBgPollState(updates) {
  try {
    const payload = {};
    if (typeof updates.cloudPollAt === "number") payload[_LAST_POLL_KEY] = updates.cloudPollAt;
    if (typeof updates.progressSyncAt === "number") payload[_LAST_PROGRESS_SYNC_KEY] = updates.progressSyncAt;
    if (Object.keys(payload).length === 0) return;
    bgStorageSet(payload).catch((e) => swallow("persistPollState", e));
  } catch {}
}

function persistOwnWrites() {
  try {
    const now = Date.now();
    const payload = _bgRecentOwnWrites.map((ts) => ({ ts, at: now }));
    bgStorageSet({ [_RECENT_OWN_WRITES_KEY]: payload }).catch((e) => swallow("persistOwnWrites", e));
  } catch {}
}

const activeStreamConsumers = new Set();
const IDLE_TEARDOWN_GRACE_MS = 10000;
let _idleTeardownTimer = null;

function addStreamConsumer(id) {
  const wasEmpty = activeStreamConsumers.size === 0;
  activeStreamConsumers.add(id);

  if (_idleTeardownTimer) {
    clearTimeout(_idleTeardownTimer);
    _idleTeardownTimer = null;
    ddebug(`[BG-RT] Consumer ${id} reclaimed idle window`);
  }

  if (wasEmpty) {
    pollCloudData("consumer-connected").catch(() => {});
  }
}

function removeStreamConsumer(id) {
  if (!activeStreamConsumers.has(id)) return;
  activeStreamConsumers.delete(id);
  if (activeStreamConsumers.size > 0) return;

  if (_idleTeardownTimer) clearTimeout(_idleTeardownTimer);
  _idleTeardownTimer = setTimeout(() => {
    _idleTeardownTimer = null;
    if (activeStreamConsumers.size > 0) return;

    flushPendingProgressSync().catch(() => {});
  }, IDLE_TEARDOWN_GRACE_MS);
}

async function signOutDueToTokenFailure() {
  console.warn("[BG] Token refresh failed — signing user out to force re-auth");
  try {
    await bgMutateFirebaseAuth({ operation: "clear_session" });
  } catch (e) {
    console.error("[BG] Failed to clear auth storage during sign-out:", e);
  }

  invalidateBgCloudDocCache();

  Promise.all([clearAuthAndSyncAlarms(), clearPendingSidecarSyncs()]).catch((e) =>
    console.warn("[BG] alarm cleanup on sign-out failed:", e?.message || e),
  );
}

async function clearAuthAndSyncAlarms() {
  const names = [
    "auth-refresh-retry",
    AUTH_REFRESH_RETRY_BG_ALARM,
    PROGRESS_SYNC_ALARM,
    FULL_SYNC_RETRY_ALARM,
    PROGRESS_SYNC_RETRY_ALARM,
    FULL_SYNC_PERIODIC_ALARM,
    SIDECAR_SYNC_RETRY_ALARM,
  ];
  for (const n of names) {
    try {
      await chrome.alarms.clear(n);
    } catch {}
  }
  dlog("[BG] Cleared auth + sync alarms (sign-out)");
}

function _broadcastAuthRejected(status, body) {
  try {
    chrome.runtime.sendMessage(
      {
        type: "AUTH_REJECTED",
        status,
        body: typeof body === "string" ? body.slice(0, 240) : "",
      },
      () => {
        void chrome.runtime.lastError;
      },
    );
  } catch {}
}

async function getFirebaseToken() {
  try {
    const stored = await bgStorageGet(["firebase_tokens"]);
    const tokens = stored.firebase_tokens;
    if (!tokens?.idToken) return null;

    if (tokens.needsReauth) {
      const stillValid = tokens.expiresAt && tokens.expiresAt > Date.now() + 30000;
      if (stillValid) return tokens.idToken;
      return null;
    }

    if (tokens.expiresAt < Date.now() + 120000) {
      const result = await refreshFirebaseToken(tokens.refreshToken);
      if (!result || !result.tokens) {
        if (result?.permanent) {
          console.warn(`[BG] Refresh token rejected (permanent: ${result.error || "?"}) — signing out`);
          await signOutDueToTokenFailure();
          return null;
        }

        const latest = (await bgStorageGet(["firebase_tokens"])).firebase_tokens || null;
        if (!latest || latest.refreshToken !== tokens.refreshToken) {
          return latest?.expiresAt > Date.now() + 30000 ? latest.idToken : null;
        }
        const stillValid = latest.expiresAt && latest.expiresAt > Date.now() + 30000;
        if (stillValid) {
          console.warn(
            `[BG] Token refresh transiently failed (${result?.error || "unknown"}); using existing token (${Math.round((latest.expiresAt - Date.now()) / 1000)}s left)`,
          );
          return latest.idToken;
        }

        console.warn(`[BG] Token refresh transiently failed and existing token expired; will retry on next call/alarm`);
        return null;
      }
      return result.tokens.idToken;
    }
    return tokens.idToken;
  } catch (e) {
    console.error("[BG] Failed to get token:", e);
    return null;
  }
}

const authState = { refreshInflight: null, refreshToken: null, signedOut: false };

function _bgClassifyRefreshError(httpStatus, errorBody) {
  const cl = self.AnimeTrackerAuthClassifier;
  if (!cl) {
    return false;
  }
  return cl.classify(httpStatus, errorBody).permanent;
}

async function refreshFirebaseToken(refreshToken) {
  if (!refreshToken) return { tokens: null, permanent: true, error: "no_refresh_token" };
  const activeTokens = (await bgStorageGet(["firebase_tokens"])).firebase_tokens || null;
  if (!activeTokens?.refreshToken) return { tokens: null, permanent: false, error: "signed_out" };
  if (activeTokens.refreshToken !== refreshToken) {
    return { tokens: activeTokens, permanent: false, stale: true, error: "session_changed" };
  }
  if (authState.refreshInflight) {
    if (authState.refreshToken === refreshToken) return authState.refreshInflight;
    await authState.refreshInflight.catch(() => {});
    const latestTokens = (await bgStorageGet(["firebase_tokens"])).firebase_tokens || null;
    return { tokens: latestTokens, permanent: false, stale: true, error: "session_changed" };
  }
  const p = (async () => {
    let response;
    try {
      response = await fetchWithTimeout(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
      });
    } catch (networkErr) {
      console.log("[BG] Token refresh network error:", networkErr?.message || networkErr);
      await _bgOnRefreshTransient(`network: ${networkErr?.message || networkErr}`, refreshToken);
      return { tokens: null, permanent: false, error: `network: ${networkErr?.message || networkErr}` };
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const permanent = _bgClassifyRefreshError(response.status, body);
      console.log(`[BG] Token refresh HTTP ${response.status} (${permanent ? "permanent" : "transient"}): ${body.slice(0, 200)}`);
      if (!permanent) await _bgOnRefreshTransient(`HTTP ${response.status}`, refreshToken);
      return { tokens: null, permanent, error: `HTTP ${response.status}` };
    }
    let data;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!data) {
      console.warn("[BG] Token refresh returned empty/invalid body — treating as transient");
      await _bgOnRefreshTransient("empty_body", refreshToken);
      return { tokens: null, permanent: false, error: "empty_body" };
    }
    if (data.error) {
      const msg = data.error?.message || "unknown";
      const permanent = _bgClassifyRefreshError(400, msg);
      console.warn(`[BG] Token refresh error (${permanent ? "permanent" : "transient"}): ${msg}`);
      if (!permanent) await _bgOnRefreshTransient(msg, refreshToken);
      return { tokens: null, permanent, error: msg };
    }
    if (!data.id_token || !data.refresh_token || !data.expires_in) {
      console.warn("[BG] Token refresh missing fields — treating as transient");
      await _bgOnRefreshTransient("missing_fields", refreshToken);
      return { tokens: null, permanent: false, error: "missing_fields" };
    }
    const tokens = {
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + parseInt(data.expires_in, 10) * 1000,
    };

    // Discard refreshed tokens if the user signed out mid-refresh — writing them back would restore the session.
    if (authState.signedOut) {
      dlog("[BG] Token refresh finished after sign-out — discarding refreshed tokens");
      return { tokens: null, permanent: false, error: "signed_out" };
    }

    const tokensHelper = self.AnimeTrackerAuthTokens;
    if (!tokensHelper?.replaceTokens) {
      return { tokens: null, permanent: false, error: "auth_store_unavailable" };
    }
    const replacement = await tokensHelper.replaceTokens(tokens, { expectedRefreshToken: refreshToken });
    if (!replacement.applied) {
      return {
        tokens: replacement.tokens || null,
        permanent: false,
        stale: true,
        error: replacement.reason || "session_changed",
      };
    }

    try {
      chrome.alarms.clear(AUTH_REFRESH_RETRY_BG_ALARM).catch(() => {});
    } catch {}
    dlog("[BG] Token refreshed");
    return { tokens: replacement.tokens, permanent: false, error: null };
  })();
  const guarded = p.then(async (result) => {
    if (result?.tokens) return result;
    const latestTokens = (await bgStorageGet(["firebase_tokens"])).firebase_tokens || null;
    if (latestTokens?.refreshToken && latestTokens.refreshToken !== refreshToken) {
      return { tokens: latestTokens, permanent: false, stale: true, error: "session_changed" };
    }
    return result;
  });
  authState.refreshInflight = guarded;
  authState.refreshToken = refreshToken;
  const clearRefreshInflight = () => {
    if (authState.refreshInflight === guarded) {
      authState.refreshInflight = null;
      authState.refreshToken = null;
    }
  };
  guarded.then(clearRefreshInflight, clearRefreshInflight);
  return guarded;
}

const AUTH_REFRESH_RETRY_BG_ALARM = "auth-refresh-retry-bg";
const AUTH_REFRESH_BACKOFF_MIN = [1, 5, 15, 60, 360];
const MAX_AUTH_REFRESH_ATTEMPTS = AUTH_REFRESH_BACKOFF_MIN.length;
const AUTH_OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

async function _bgOnRefreshTransient(reason, expectedRefreshToken = null) {
  const helper = self.AnimeTrackerAuthTokens;
  if (!helper) return;
  try {
    const updated = await helper.markAuthRefreshTransientFailure(expectedRefreshToken);
    if (!updated) return;
    const attempts = Number(updated.authRefreshAttempts) || 0;
    const lastOk = Number(updated.lastAuthCheck) || 0;
    const offlineFor = lastOk ? Date.now() - lastOk : 0;
    const exceededAttempts = attempts >= MAX_AUTH_REFRESH_ATTEMPTS;
    const exceededGrace = lastOk > 0 && offlineFor > AUTH_OFFLINE_GRACE_MS;

    if (exceededAttempts || exceededGrace) {
      await helper.setNeedsReauth(true, { expectedRefreshToken });
      console.warn(
        `[BG] Auth: needsReauth=true (attempts=${attempts}, offlineFor=${Math.round(offlineFor / 86400000)}d, reason=${reason})`,
      );

      try {
        chrome.alarms.clear(AUTH_REFRESH_RETRY_BG_ALARM).catch(() => {});
      } catch {}
      return;
    }

    const idx = Math.min(attempts - 1, AUTH_REFRESH_BACKOFF_MIN.length - 1);
    const delayMin = AUTH_REFRESH_BACKOFF_MIN[idx];
    try {
      chrome.alarms.create(AUTH_REFRESH_RETRY_BG_ALARM, { delayInMinutes: delayMin });
      console.warn(
        `[BG] Auth refresh retry scheduled in ${delayMin} min (attempt ${attempts}/${MAX_AUTH_REFRESH_ATTEMPTS}, reason: ${reason})`,
      );
    } catch (e) {
      console.warn("[BG] Could not arm auth-refresh-retry-bg alarm:", e?.message || e);
    }
  } catch (e) {
    console.warn("[BG] _bgOnRefreshTransient bookkeeping failed:", e?.message || e);
  }
}

async function _bgAuthRefreshRetryTick() {
  try {
    const helper = self.AnimeTrackerAuthTokens;
    const tokens = helper ? await helper.readTokens() : null;
    if (!tokens || !tokens.refreshToken) {
      try {
        chrome.alarms.clear(AUTH_REFRESH_RETRY_BG_ALARM).catch(() => {});
      } catch {}
      return;
    }
    if (tokens.needsReauth) {
      try {
        chrome.alarms.clear(AUTH_REFRESH_RETRY_BG_ALARM).catch(() => {});
      } catch {}
      return;
    }
    const result = await refreshFirebaseToken(tokens.refreshToken);
    if (result?.permanent) {
      await signOutDueToTokenFailure();
    }
  } catch (e) {
    console.warn("[BG] Auth retry tick failed:", e?.message || e);
  }
}

async function getFirebaseUser() {
  try {
    const stored = await bgStorageGet(["firebase_user"]);
    return stored.firebase_user || null;
  } catch {
    return null;
  }
}

async function markFirebaseAuthRequestOk(expectedIdToken) {
  const helper = self.AnimeTrackerAuthTokens;
  if (!helper?.markAuthCheckOk || !expectedIdToken) return;
  await helper.markAuthCheckOk({ expectedIdToken }).catch((error) => {
    dlog("[BG] Failed to record successful Firebase auth check:", error?.message || error);
  });
}

const _fsCodec = self.AnimeTrackerFirestoreCodec || {};
const jsonToFirestoreFields =
  _fsCodec.encodeFields ||
  (() => {
    throw new Error("[BG] Firestore codec not loaded");
  });
const fromFSDoc = _fsCodec.decodeDoc || (() => null);

const fetchDedup = { uid: null, promise: null };

async function fetchCloudData(user, token, reason = "read") {
  if (fetchDedup.uid === user.uid && fetchDedup.promise) {
    return fetchDedup.promise;
  }

  const fetchPromise = (async () => {
    try {
      FSDebug.read(reason, "full");
      const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
      const response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
      if (response.status === 404) {
        await markFirebaseAuthRequestOk(token);
        return null;
      }
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.warn(`[BG] fetchCloudData HTTP ${response.status} for users/${user.uid.slice(0, 8)}…: ${body.slice(0, 160)}`);

        const err = new Error(`HTTP ${response.status}`);
        err.status = response.status;
        err.body = body;
        throw err;
      }
      await markFirebaseAuthRequestOk(token);
      const doc = fromFSDoc(await response.json());
      if (doc && doc.animeData) doc.animeData = decodeEpisodesFromCloud(doc.animeData);
      return doc;
    } catch (e) {
      throw e;
    }
  })();

  fetchDedup.uid = user.uid;
  fetchDedup.promise = fetchPromise;
  try {
    return await fetchPromise;
  } finally {
    if (fetchDedup.promise === fetchPromise) {
      fetchDedup.uid = null;
      fetchDedup.promise = null;
    }
  }
}

const CLOUD_POLL_SKIPPED = "cloud_poll_skipped";

async function pollCloudData(reason = "consumer-connected", { force = false, requireAuth = false } = {}) {
  if (_cloudPollInFlight) {
    if (!force) return _cloudPollInFlight;
    try {
      await _cloudPollInFlight;
    } catch {}
    if (_cloudPollInFlight) return _cloudPollInFlight;
  }

  _cloudPollInFlight = (async () => {
    try {
      await hydrateBgPollState();
      if (!force && Date.now() - _lastCloudPollAt < CLOUD_CONSUMER_POLL_MIN_GAP_MS) return CLOUD_POLL_SKIPPED;

      await hydrateBgCloudDocCache();
      const user = await getFirebaseUser();
      const token = await getFirebaseToken();
      if (!user || !token) {
        if (requireAuth) throw new Error(!user ? "not_authenticated" : "token_unavailable");
        return CLOUD_POLL_SKIPPED;
      }

      const cacheFresh =
        !force && cloudCache.doc && cloudCache.uid === user.uid && Date.now() - cloudCache.time < _BG_CLOUD_TTL;
      if (cacheFresh) {
        _lastCloudPollAt = Date.now();
        persistBgPollState({ cloudPollAt: _lastCloudPollAt });
        dlog(`[BG-RT] Poll skipped (${reason}) — cache still fresh (${Math.round((Date.now() - cloudCache.time) / 1000)}s old)`);

        if (cloudCache.doc) await applyCloudUpdate(cloudCache.doc);
        return cloudCache.doc;
      }

      const pollAt = Date.now();
      _lastCloudPollAt = pollAt;
      persistBgPollState({ cloudPollAt: pollAt });
      const cloudDoc = await fetchCloudData(user, token, `poll:${reason}`);
      if (cloudDoc) {
        cloudCache.doc = cloudDoc;
        cloudCache.time = Date.now();
        cloudCache.uid = user.uid;
        bgStorageSet({
          [_BG_CLOUD_CACHE_KEY]: { uid: user.uid, doc: cloudDoc, cachedAt: cloudCache.time },
        }).catch(() => {});
        await applyCloudUpdate(cloudDoc);
      }
      return cloudDoc;
    } catch (e) {
      console.warn(`[BG-RT] Poll sync failed (${reason}): ${e.message}`);
      throw e;
    } finally {
      _cloudPollInFlight = null;
    }
  })();

  return _cloudPollInFlight;
}

const cloudCache = { doc: null, time: 0, uid: null };
const _BG_CLOUD_TTL = 10 * 60 * 1000;
const _BG_CLOUD_CACHE_KEY = "_bgCloudDocCachePersisted";

let _bgCloudCacheHydratePromise = null;
async function hydrateBgCloudDocCache() {
  if (cloudCache.doc) return;
  if (_bgCloudCacheHydratePromise) return _bgCloudCacheHydratePromise;
  _bgCloudCacheHydratePromise = (async () => {
    try {
      const stored = await bgStorageGet([_BG_CLOUD_CACHE_KEY, "firebase_user"]);
      const entry = stored[_BG_CLOUD_CACHE_KEY];
      const currentUid = stored.firebase_user?.uid || null;
      if (entry && entry.cachedAt && entry.uid && currentUid && entry.uid === currentUid) {
        cloudCache.doc = entry.doc;
        cloudCache.time = entry.cachedAt;
        cloudCache.uid = entry.uid;
      }
    } catch {}
  })();
  return _bgCloudCacheHydratePromise;
}

function invalidateBgCloudDocCache() {
  cloudCache.doc = null;
  cloudCache.time = 0;
  cloudCache.uid = null;

  bgStorageSet({ [_BG_CLOUD_CACHE_KEY]: null }).catch(() => {});
}

// Cheap gate for the periodic full sync: only do the heavy read+merge when there is an unsynced local
// change, or when the cloud cache is stale enough to re-check for remote updates. Keeps idle ticks near-free.
async function periodicSyncNeeded() {
  try {
    const stored = await bgStorageGet([PENDING_SYNC_KEY]);
    return !!stored[PENDING_SYNC_KEY];
  } catch {
    return false;
  }
}

async function _isCacheShortCircuitEnabledBg() {
  try {
    const stored = await bgStorageGet(["_featureFlags"]);
    const flags = stored._featureFlags;
    if (!flags || typeof flags !== "object") return true;
    return flags.CACHE_SHORT_CIRCUIT_ENABLED !== false;
  } catch {
    return true;
  }
}

const _bgCacheStats = { fresh: 0, revalidated: 0, fullFetch: 0 };

async function _revalidateCloudDocViaLastUpdated(user, token, cachedLastUpdated, reason = "revalidate") {
  if (!user || !token || !cachedLastUpdated) return undefined;
  FSDebug.read(reason, "revalidate");
  const url = `${FIRESTORE_BASE}/documents/users/${user.uid}?mask.fieldPaths=lastUpdated`;
  let response;
  try {
    response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    return undefined;
  }
  if (response.status === 404) {
    await markFirebaseAuthRequestOk(token);
    return null;
  }
  if (response.status === 401 || response.status === 403) {
    const body = await response.text().catch(() => "");
    const err = new Error(`HTTP ${response.status}`);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  if (!response.ok) return undefined;
  await markFirebaseAuthRequestOk(token);
  let json;
  try {
    json = await response.json();
  } catch {
    return undefined;
  }
  const decoded = fromFSDoc(json);
  return decoded?.lastUpdated || null;
}

async function fetchCloudDataCached(user, token, reason = "cache", options = {}) {
  await hydrateBgCloudDocCache();
  const now = Date.now();

  if (!options.requireRevalidation && cloudCache.doc && cloudCache.uid === user.uid && now - cloudCache.time < _BG_CLOUD_TTL) {
    _bgCacheStats.fresh++;
    return cloudCache.doc;
  }
  if (cloudCache.doc && cloudCache.uid !== user.uid) {
    invalidateBgCloudDocCache();
  }

  if (cloudCache.doc && cloudCache.uid === user.uid && cloudCache.doc.lastUpdated && (await _isCacheShortCircuitEnabledBg())) {
    try {
      const cloudLastUpdated = await _revalidateCloudDocViaLastUpdated(user, token, cloudCache.doc.lastUpdated, reason);
      if (cloudLastUpdated && cloudLastUpdated === cloudCache.doc.lastUpdated) {
        cloudCache.time = Date.now();
        bgStorageSet({
          [_BG_CLOUD_CACHE_KEY]: { uid: user.uid, doc: cloudCache.doc, cachedAt: cloudCache.time },
        }).catch(() => {});
        _bgCacheStats.revalidated++;
        dlog(`[BG] Poll skipped — lastUpdated unchanged (revalidated ${_bgCacheStats.revalidated} times)`);
        return cloudCache.doc;
      }

      if (cloudLastUpdated !== undefined) {
        invalidateBgCloudDocCache();
      }
    } catch (e) {
      if (e?.status === 401 || e?.status === 403) throw e;
    }
  }

  let doc = null;
  try {
    doc = await fetchCloudData(user, token, reason);
  } catch (e) {
    const err = new Error(e?.message || "Fetch failed");
    err.status = e?.status || null;
    err.isTimeout = !!e?.isTimeout;
    err.name = e?.name || err.name;
    throw err;
  }
  if (doc) {
    cloudCache.doc = doc;
    cloudCache.time = Date.now();
    cloudCache.uid = user.uid;
    _bgCacheStats.fullFetch++;

    bgStorageSet({
      [_BG_CLOUD_CACHE_KEY]: { uid: user.uid, doc, cachedAt: cloudCache.time },
    }).catch(() => {});
  }
  return doc;
}

let _lastProgressSyncAt = 0;

let _firestoreWriteQueue = Promise.resolve();
function enqueueFirestoreWrite(fn) {
  const next = _firestoreWriteQueue.then(fn, fn);
  _firestoreWriteQueue = next.catch(() => {});
  return next;
}

async function syncProgressOnly(reason = "progress", options = {}) {
  if (options.markPending !== false) markProgressSyncPending(reason);
  if (syncState.progressInProgress) {
    syncState.progressPending = true;
    return { success: false, queued: true, state: "pending", kind: "progress" };
  }

  const runGeneration = progressSyncGeneration;
  let user = null;
  syncState.progressInProgress = true;
  try {
    user = await getFirebaseUser();
    if (!user) {
      const result = { success: false, error: "not_authenticated", kind: "progress" };
      await finishFailedSync({ kind: "progress", user: null, reason, error: result.error });
      return result;
    }
    const token = await getFirebaseToken();
    if (!token) {
      const result = { success: false, error: "token_unavailable", kind: "progress" };
      await finishFailedSync({ kind: "progress", user, reason, error: result.error });
      return result;
    }

    await persistCloudSyncStatus("syncing", { kind: "progress", uid: user.uid, reason });
    const outcome = await enqueueFirestoreWrite(async () => {
      const initial = await bgStorageGet(["videoProgress"]);
      const initialVP = initial.videoProgress || {};

      if (syncState.lastPushedProgress && areProgressMapsEqual(initialVP, syncState.lastPushedProgress)) {
        FSDebug.skip("progress", `${reason}/local==pushed`);
        return { success: true, wrote: false, kind: "progress", reason };
      }

      const cloudDoc = await fetchCloudDataCached(user, token, `prog:${reason}`, { requireRevalidation: true });
      const cloudVP = cloudDoc?.videoProgress || null;
      const mergedState = await runBgLibraryTransaction(
        ["videoProgress", "animeData", "deletedAnime"],
        (latest) => {
          const rawLocalVP = latest.videoProgress || {};
          const localVP = cleanTrackedProgressBg(latest.animeData || {}, rawLocalVP, latest.deletedAnime || {});
          const mergedVP = cloudVP
            ? cleanTrackedProgressBg(
                latest.animeData || {},
                mergeVideoProgress(localVP, cloudVP),
                latest.deletedAnime || {},
              )
            : localVP;
          const localChanged = !areProgressMapsEqual(rawLocalVP, mergedVP);
          return {
            data: localChanged ? stampBgSyncStorageWrite({ videoProgress: mergedVP }) : null,
            result: { mergedVP },
          };
        },
      );
      const { mergedVP } = mergedState;

      // syncState.lastPushedProgress is in-memory only (resets on SW restart); skip the PATCH when cloud already matches.
      if (cloudVP !== null && areProgressMapsEqual(mergedVP, cloudVP)) {
        syncState.lastPushedProgress = structuredClone(mergedVP);
        FSDebug.skip("progress", `${reason}/cloud==merged`);
        return { success: true, wrote: false, kind: "progress", reason };
      }

      if (syncState.lastPushedProgress && areProgressMapsEqual(mergedVP, syncState.lastPushedProgress)) {
        FSDebug.skip("progress", `${reason}/merged==pushed`);
        return { success: true, wrote: false, kind: "progress", reason };
      }

      const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
      const fieldMask = "updateMask.fieldPaths=videoProgress&updateMask.fieldPaths=lastUpdated";
      const pushedAt = new Date().toISOString();
      const body = JSON.stringify({
        fields: jsonToFirestoreFields({
          videoProgress: mergedVP,
          lastUpdated: pushedAt,
        }),
      });
      const response = await fetchWithTimeout(`${url}?${fieldMask}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body,
      });

      if (!response.ok) {
        const status = response.status;
        const errorBody = await response.text().catch(() => "");
        console.warn("[BG] Progress sync failed:", status, errorBody.slice(0, 160));
        await handleSyncHttpError({ kind: "progress", status, errorBody, expectedIdToken: token });
        return { success: false, error: `HTTP ${status}`, status, kind: "progress", reason };
      }

      await markFirebaseAuthRequestOk(token);
      FSDebug.write("progress", reason, { fields: ["progress"], bytes: body.length });
      syncState.lastPushedProgress = structuredClone(mergedVP);

      if (cloudCache.doc && cloudCache.uid === user.uid) {
        cloudCache.doc = {
          ...cloudCache.doc,
          videoProgress: mergedVP,
          lastUpdated: pushedAt,
        };
        cloudCache.time = Date.now();
        bgStorageSet({
          [_BG_CLOUD_CACHE_KEY]: { uid: user.uid, doc: cloudCache.doc, cachedAt: cloudCache.time },
        }).catch(() => {});
      } else {
        invalidateBgCloudDocCache();
      }
      bgRememberOwnWrite(pushedAt);
      clearSyncRetry("progress");
      return { success: true, wrote: true, kind: "progress", reason };
    });

    if (outcome.success) {
      _lastProgressSyncAt = Date.now();
      persistBgPollState({ progressSyncAt: _lastProgressSyncAt });
      await finishSuccessfulSync({
        kind: "progress",
        user,
        reason,
        wrote: outcome.wrote,
        progressGeneration: runGeneration,
      });
    } else {
      await finishFailedSync({ kind: "progress", user, reason, error: outcome.error });
    }
    return outcome;
  } catch (error) {
    const failureKind = error?.isTimeout ? "timeout" : "network";
    console.log(`[BG] Progress sync ${failureKind}:`, error?.message || error);
    armSyncRetry("progress", `${failureKind}: ${error?.message || error}`);
    const outcome = { success: false, error: error?.message || failureKind, kind: "progress", reason };
    await finishFailedSync({ kind: "progress", user, reason, error: outcome.error });
    return outcome;
  } finally {
    syncState.progressInProgress = false;
    if (syncState.progressPending) {
      syncState.progressPending = false;

      // Chrome clamps alarms to a 30s minimum anyway — ask for it explicitly instead of
      // requesting 5s and getting silently clamped (with a console warning on unpacked builds).
      chrome.alarms.create(PROGRESS_SYNC_ALARM, { delayInMinutes: 0.5 });
    }
  }
}

function fsFieldPathSegment(name) {
  return "`" + String(name).replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "`";
}

async function performFullSync(reason, runFullGeneration, runProgressGeneration) {
  const user = await getFirebaseUser();
  if (!user) {
    const outcome = { success: false, error: "not_authenticated", kind: "full", reason };
    await finishFailedSync({ kind: "full", user: null, reason, error: outcome.error });
    return outcome;
  }
  const token = await getFirebaseToken();
  if (!token) {
    const outcome = { success: false, error: "token_unavailable", kind: "full", reason };
    await finishFailedSync({ kind: "full", user, reason, error: outcome.error });
    return outcome;
  }

  await persistCloudSyncStatus("syncing", { kind: "full", uid: user.uid, reason });
  try {
    const outcome = await enqueueFirestoreWrite(async () => {
      const cloudDoc = await fetchCloudDataCached(user, token, reason, { requireRevalidation: true });
      const cloudAnimeRef = cloudDoc?.animeData || {};
      const cloudProgressRef = cloudDoc?.videoProgress || {};
      const cloudDeletedRef = cloudDoc?.deletedAnime || {};
      const cloudGroupRef = cloudDoc?.groupCoverImages || {};
      const cloudGoalsRef = cloudDoc?.goalSettings || {};
      const cloudBadgesRef = cloudDoc?.badgeUnlocks || {};
      const mergedState = await runBgLibraryTransaction(
        ["animeData", "videoProgress", "deletedAnime", "groupCoverImages", "goalSettings", "badgeUnlocks"],
        (local) => {
          const localAnime = local.animeData || {};
          const localProgress = local.videoProgress || {};
          const localDeleted = local.deletedAnime || {};
          const localGroup = local.groupCoverImages || {};
          const localGoals = local.goalSettings || {};
          const localBadges = local.badgeUnlocks || {};

          let mergedDeleted = cloudDoc?.deletedAnime
            ? mergeDeletedAnime(localDeleted, cloudDoc.deletedAnime)
            : { ...localDeleted };
          let mergedAnime = cloudDoc?.animeData
            ? mergeAnimeData(localAnime, cloudDoc.animeData)
            : stripAutoRepairedEpisodesFromMap({ ...localAnime });
          mergedAnime = stripEpisodeDefaultsFromMap(mergedAnime);
          mergedDeleted = pruneStaleDeletedAnime(mergedAnime, mergedDeleted);
          applyDeletedAnime(mergedAnime, mergedDeleted);

          let mergedProgress = cloudDoc?.videoProgress
            ? mergeVideoProgress(localProgress, cloudDoc.videoProgress)
            : { ...localProgress };
          mergedProgress = cleanTrackedProgressBg(mergedAnime, mergedProgress, mergedDeleted);
          pruneDeletedAnime(mergedDeleted);

          const mergedGroup =
            Object.keys(mergedAnime).length === 0 && Object.keys(mergedDeleted).length > 0
              ? {}
              : mergeGroupCoverImages(localGroup, cloudGroupRef);
          const mergedGoals = mergeGoalSettings(localGoals, cloudGoalsRef);
          const mergedBadges = mergeBadgeUnlocks(localBadges, cloudBadgesRef);
          const localChanged =
            !areAnimeDataMapsEqual(localAnime, mergedAnime) ||
            !areProgressMapsEqual(localProgress, mergedProgress) ||
            !shallowEqualDeletedAnime(localDeleted, mergedDeleted) ||
            !shallowEqualObjectMap(localGroup, mergedGroup) ||
            !shallowEqualObjectMap(localGoals, mergedGoals) ||
            !shallowEqualObjectMap(localBadges, mergedBadges);

          const animeChangedSlugs = [];
          for (const slug of Object.keys(mergedAnime)) {
            if (!areAnimeEntriesEqual(mergedAnime[slug], cloudAnimeRef[slug])) animeChangedSlugs.push(slug);
          }
          const animeRemovedSlugs = Object.keys(cloudAnimeRef).filter((slug) => !(slug in mergedAnime));
          const animeFieldChanged = animeChangedSlugs.length > 0 || animeRemovedSlugs.length > 0;
          const progressChangedC = !areProgressMapsEqual(mergedProgress, cloudProgressRef);
          const deletedChangedC = !shallowEqualDeletedAnime(mergedDeleted, cloudDeletedRef);
          const groupChangedC = !shallowEqualObjectMap(mergedGroup, cloudGroupRef);
          const goalsChangedC = !shallowEqualObjectMap(mergedGoals, cloudGoalsRef);
          const badgesChangedC = !shallowEqualObjectMap(mergedBadges, cloudBadgesRef);

          return {
            data: localChanged
              ? stampBgSyncStorageWrite({
                  animeData: mergedAnime,
                  videoProgress: mergedProgress,
                  deletedAnime: mergedDeleted,
                  groupCoverImages: mergedGroup,
                  goalSettings: mergedGoals,
                  badgeUnlocks: mergedBadges,
                })
              : null,
            result: {
              mergedAnime,
              mergedProgress,
              mergedDeleted,
              mergedGroup,
              mergedGoals,
              mergedBadges,
              animeChangedSlugs,
              animeRemovedSlugs,
              animeFieldChanged,
              progressChangedC,
              deletedChangedC,
              groupChangedC,
              goalsChangedC,
              badgesChangedC,
            },
          };
        },
      );
      const {
        mergedAnime,
        mergedProgress,
        mergedDeleted,
        mergedGroup,
        mergedGoals,
        mergedBadges,
        animeChangedSlugs,
        animeRemovedSlugs,
        animeFieldChanged,
        progressChangedC,
        deletedChangedC,
        groupChangedC,
        goalsChangedC,
        badgesChangedC,
      } = mergedState;
      const shouldWriteEmail = !cloudDoc || cloudDoc.email !== user.email;
      const needsCloudWrite =
        animeFieldChanged ||
        progressChangedC ||
        deletedChangedC ||
        groupChangedC ||
        goalsChangedC ||
        badgesChangedC ||
        shouldWriteEmail;

      if (!needsCloudWrite) {
        cloudCache.time = Date.now();
        cloudCache.uid = user.uid;
        clearSyncRetry("full");
        FSDebug.skip("full", reason);
        return { success: true, wrote: false, kind: "full", reason };
      }

      const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
      const pushedAt = new Date().toISOString();

      const payloadFields = {
        animeData: mergedAnime,
        videoProgress: mergedProgress,
        deletedAnime: mergedDeleted,
        groupCoverImages: mergedGroup,
        goalSettings: mergedGoals,
        badgeUnlocks: mergedBadges,
        lastUpdated: pushedAt,
      };
      if (shouldWriteEmail) payloadFields.email = user.email;

      const fieldPaths = [];
      const wireFields = { lastUpdated: pushedAt };
      const _changedFields = [];

      if (!cloudDoc) {
        wireFields.animeData = encodeEpisodesForCloud(mergedAnime);
        fieldPaths.push("animeData");
        _changedFields.push("anime");
      } else if (animeFieldChanged) {
        const partial = {};
        for (const s of animeChangedSlugs) partial[s] = mergedAnime[s];
        wireFields.animeData = encodeEpisodesForCloud(partial);
        for (const s of animeChangedSlugs) fieldPaths.push("animeData." + fsFieldPathSegment(s));
        for (const s of animeRemovedSlugs) fieldPaths.push("animeData." + fsFieldPathSegment(s));
        _changedFields.push("anime");
      }
      if (progressChangedC) {
        wireFields.videoProgress = mergedProgress;
        fieldPaths.push("videoProgress");
        _changedFields.push("progress");
      }
      if (deletedChangedC) {
        wireFields.deletedAnime = mergedDeleted;
        fieldPaths.push("deletedAnime");
        _changedFields.push("deleted");
      }
      if (groupChangedC) {
        wireFields.groupCoverImages = mergedGroup;
        fieldPaths.push("groupCoverImages");
        _changedFields.push("covers");
      }
      if (goalsChangedC) {
        wireFields.goalSettings = mergedGoals;
        fieldPaths.push("goalSettings");
        _changedFields.push("goals");
      }
      if (badgesChangedC) {
        wireFields.badgeUnlocks = mergedBadges;
        fieldPaths.push("badgeUnlocks");
        _changedFields.push("badges");
      }
      fieldPaths.push("lastUpdated");
      if (shouldWriteEmail) {
        wireFields.email = user.email;
        fieldPaths.push("email");
      }

      const fieldMask = fieldPaths.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&");
      const _body = JSON.stringify({
        fields: jsonToFirestoreFields(wireFields),
      });
      const response = await fetchWithTimeout(`${url}?${fieldMask}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: _body,
      });

      if (response.ok) {
        await markFirebaseAuthRequestOk(token);
        FSDebug.write("full", reason, { fields: _changedFields, bytes: _body.length });

        if (cloudCache.doc && cloudCache.uid === user.uid) {
          cloudCache.doc = {
            ...cloudCache.doc,
            ...payloadFields,
          };
          cloudCache.time = Date.now();
          bgStorageSet({
            [_BG_CLOUD_CACHE_KEY]: { uid: user.uid, doc: cloudCache.doc, cachedAt: cloudCache.time },
          }).catch(() => {});
        } else {
          invalidateBgCloudDocCache();
        }
        bgRememberOwnWrite(pushedAt);
        clearSyncRetry("full");
        return { success: true, wrote: true, kind: "full", reason };
      } else {
        const status = response.status;
        const errorBody = await response.text().catch(() => "");
        console.error("[BG] Sync failed:", status, errorBody.slice(0, 160));
        await handleSyncHttpError({ kind: "full", status, errorBody, expectedIdToken: token });
        return { success: false, error: `HTTP ${status}`, status, kind: "full", reason };
      }
    });

    if (outcome.success) {
      await finishSuccessfulSync({
        kind: "full",
        user,
        reason,
        wrote: outcome.wrote,
        fullGeneration: runFullGeneration,
        progressGeneration: runProgressGeneration,
      });
    } else {
      await finishFailedSync({ kind: "full", user, reason, error: outcome.error });
    }
    return outcome;
  } catch (error) {
    const failureKind = error?.isTimeout ? "timeout" : "network";
    console.log(`[BG] Sync ${failureKind}:`, error?.message || error);
    armSyncRetry("full", `${failureKind}: ${error?.message || error}`);
    const outcome = { success: false, error: error?.message || failureKind, kind: "full", reason };
    await finishFailedSync({ kind: "full", user, reason, error: outcome.error });
    return outcome;
  }
}

let fullSyncRunPromise = null;
let fullSyncRequested = false;
let fullSyncRequestedReason = "sync";

function syncToFirebase(reason = "sync", options = {}) {
  if (options.markPending !== false) markSyncPending(reason);
  fullSyncRequested = true;
  fullSyncRequestedReason = reason;

  if (fullSyncRunPromise) {
    syncState.pending = true;
    return fullSyncRunPromise;
  }

  const run = (async () => {
    syncState.inProgress = true;
    let outcome = { success: false, error: "sync_not_started", kind: "full", reason };
    try {
      while (fullSyncRequested) {
        fullSyncRequested = false;
        syncState.pending = false;

        const runReason = fullSyncRequestedReason;
        const runFullGeneration = fullSyncGeneration;
        const runProgressGeneration = progressSyncGeneration;
        outcome = await performFullSync(runReason, runFullGeneration, runProgressGeneration);

        if (!outcome.success) {
          fullSyncRequested = false;
          break;
        }

        if (runFullGeneration !== fullSyncGeneration || runProgressGeneration !== progressSyncGeneration) {
          fullSyncRequested = true;
          syncState.pending = true;
        }
      }
      return outcome;
    } finally {
      syncState.inProgress = false;
      syncState.pending = false;
    }
  })();

  fullSyncRunPromise = run;
  const clearRun = () => {
    if (fullSyncRunPromise === run) fullSyncRunPromise = null;
  };
  run.then(clearRun, clearRun);
  return run;
}

let scheduledFullSync = null;

function scheduleFullSync(reason = "scheduled", delayMs = 500) {
  markSyncPending(reason);
  if (fullSyncRunPromise) {
    return syncToFirebase(reason, { markPending: false });
  }
  if (!scheduledFullSync) {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    scheduledFullSync = { promise, resolve, reason };
  } else {
    scheduledFullSync.reason = reason;
  }

  if (syncState.debounceTimeout) clearTimeout(syncState.debounceTimeout);
  syncState.debounceTimeout = setTimeout(() => {
    syncState.debounceTimeout = null;
    const scheduled = scheduledFullSync;
    scheduledFullSync = null;
    syncToFirebase(scheduled.reason, { markPending: false }).then(scheduled.resolve);
  }, delayMs);
  return scheduledFullSync.promise;
}

function flushFullSync(reason = "immediate") {
  markSyncPending(reason);
  if (syncState.debounceTimeout) {
    clearTimeout(syncState.debounceTimeout);
    syncState.debounceTimeout = null;
  }

  const scheduled = scheduledFullSync;
  scheduledFullSync = null;
  const run = syncToFirebase(reason, { markPending: false });
  if (scheduled) run.then(scheduled.resolve);
  return run;
}

let _applyCloudUpdateDoc = null;
let _applyCloudDebounce = null;
let _applyCloudUpdateQueue = Promise.resolve();
let _applyCloudUpdateWaiters = [];

const _MAX_CLOUD_UPDATE_WAITERS = 100;

async function applyCloudUpdate(cloudDoc) {
  if (!cloudDoc) return;

  _applyCloudUpdateDoc = cloudDoc;
  if (_applyCloudDebounce) clearTimeout(_applyCloudDebounce);

  if (_applyCloudUpdateWaiters.length >= _MAX_CLOUD_UPDATE_WAITERS) {
    const overflow = _applyCloudUpdateWaiters.length - _MAX_CLOUD_UPDATE_WAITERS + 1;
    const stale = _applyCloudUpdateWaiters.splice(0, overflow);
    console.warn(`[BG] applyCloudUpdate waiter overflow — dropped ${overflow} pending promises (queue cap ${_MAX_CLOUD_UPDATE_WAITERS})`);
    for (const w of stale) w.resolve();
  }

  return new Promise((resolve, reject) => {
    _applyCloudUpdateWaiters.push({ resolve, reject });
    _applyCloudDebounce = setTimeout(() => {
      _applyCloudDebounce = null;
      const pendingWaiters = _applyCloudUpdateWaiters.splice(0);
      _applyCloudUpdateQueue = _applyCloudUpdateQueue
        .catch(() => {})
        .then(() => _drainCloudUpdates())
        .then(() => {
          for (const waiter of pendingWaiters) waiter.resolve();
        })
        .catch((error) => {
          for (const waiter of pendingWaiters) waiter.reject(error);
        });
    }, 500);
  });
}

async function _drainCloudUpdates() {
  while (_applyCloudUpdateDoc) {
    const nextCloudDoc = _applyCloudUpdateDoc;
    _applyCloudUpdateDoc = null;
    await _doApplyCloudUpdate(nextCloudDoc);
  }
}

const _bgRecentOwnWrites = [];
const _BG_MAX_RECENT_OWN_WRITES = 20;
function bgRememberOwnWrite(ts) {
  if (!ts) return;
  _bgRecentOwnWrites.push(ts);
  if (_bgRecentOwnWrites.length > _BG_MAX_RECENT_OWN_WRITES) _bgRecentOwnWrites.shift();
  persistOwnWrites();
}
function bgIsOwnEcho(ts) {
  return !!ts && _bgRecentOwnWrites.includes(ts);
}

async function _doApplyCloudUpdate(cloudDoc) {
  if (!cloudDoc) return;

  if (syncState.inProgress || syncState.progressInProgress) {
    // The fetched document is already in cloudCache. Queue and await a full pass
    // so this cloud update is merged after the active write instead of discarded.
    await syncToFirebase("cloud-update-during-sync");
    return;
  }

  const cloudUpdatedAt = cloudDoc.lastUpdated || null;
  if (cloudUpdatedAt && bgIsOwnEcho(cloudUpdatedAt)) {
    return;
  }

  const activeUser = await getFirebaseUser();
  if (!activeUser?.uid) {
    invalidateBgCloudDocCache();
    return;
  }
  if (cloudCache.uid && cloudCache.uid !== activeUser.uid) {
    invalidateBgCloudDocCache();
  }
  cloudCache.doc = cloudDoc;
  cloudCache.time = Date.now();
  cloudCache.uid = activeUser.uid;

  try {
    const local = await bgStorageGet([
      "animeData",
      "videoProgress",
      "deletedAnime",
      "groupCoverImages",
      "goalSettings",
      "badgeUnlocks",
      LIBRARY_MUTATION_REVISION_KEY,
    ]);

    let mergedDeleted = cloudDoc.deletedAnime
      ? mergeDeletedAnime(local.deletedAnime || {}, cloudDoc.deletedAnime)
      : local.deletedAnime || {};

    let mergedAnime = mergeAnimeData(local.animeData || {}, cloudDoc.animeData || {});
    mergedAnime = stripEpisodeDefaultsFromMap(mergedAnime);
    mergedDeleted = pruneStaleDeletedAnime(mergedAnime, mergedDeleted);
    applyDeletedAnime(mergedAnime, mergedDeleted);

    let mergedProgress = mergeVideoProgress(local.videoProgress || {}, cloudDoc.videoProgress || {});

    mergedProgress = cleanTrackedProgressBg(mergedAnime, mergedProgress, mergedDeleted);

    pruneDeletedAnime(mergedDeleted);

    const localGroup = local.groupCoverImages || {};
    const cloudGroup = cloudDoc.groupCoverImages || {};
    const mergedGroup =
      Object.keys(mergedAnime).length === 0 && Object.keys(mergedDeleted).length > 0
        ? {}
        : mergeGroupCoverImages(localGroup, cloudGroup);
    const localGoals = local.goalSettings || {};
    const cloudGoals = cloudDoc.goalSettings || {};
    const mergedGoals = mergeGoalSettings(localGoals, cloudGoals);
    const localBadges = local.badgeUnlocks || {};
    const cloudBadges = cloudDoc.badgeUnlocks || {};
    const mergedBadges = mergeBadgeUnlocks(localBadges, cloudBadges);

    const animeChanged = !areAnimeDataMapsEqual(local.animeData || {}, mergedAnime);

    const progressChanged = !areProgressMapsEqual(local.videoProgress || {}, mergedProgress);
    const deletedChanged = !shallowEqualDeletedAnime(local.deletedAnime || {}, mergedDeleted);
    const groupChanged = !shallowEqualObjectMap(localGroup, mergedGroup);
    const goalsChanged = !shallowEqualObjectMap(localGoals, mergedGoals);
    const badgesChanged = !shallowEqualObjectMap(localBadges, mergedBadges);
    const cloudAnimeComparable = cloudDoc.animeData || {};
    const mergedAnimeSlugs = Object.keys(mergedAnime);
    const cloudAnimeSlugs = Object.keys(cloudAnimeComparable);
    const animeMatchesCloud =
      mergedAnimeSlugs.length === cloudAnimeSlugs.length &&
      mergedAnimeSlugs.every(
        (slug) =>
          Object.prototype.hasOwnProperty.call(cloudAnimeComparable, slug) &&
          areAnimeEntriesEqual(mergedAnime[slug], cloudAnimeComparable[slug]),
      );
    const cloudMatchesMerged =
      animeMatchesCloud &&
      areProgressMapsEqual(mergedProgress, cloudDoc.videoProgress || {}) &&
      shallowEqualDeletedAnime(mergedDeleted, cloudDoc.deletedAnime || {}) &&
      shallowEqualObjectMap(mergedGroup, cloudGroup) &&
      shallowEqualObjectMap(mergedGoals, cloudGoals) &&
      shallowEqualObjectMap(mergedBadges, cloudBadges);

    if (animeChanged || progressChanged || deletedChanged || groupChanged || goalsChanged || badgesChanged) {
      const commitResult = await commitLibraryMutation(
        local[LIBRARY_MUTATION_REVISION_KEY] || 0,
        stampBgSyncStorageWrite({
          animeData: mergedAnime,
          videoProgress: mergedProgress,
          deletedAnime: mergedDeleted,
          groupCoverImages: mergedGroup,
          goalSettings: mergedGoals,
          badgeUnlocks: mergedBadges,
        }),
      );
      if (commitResult?.conflict) {
        await syncToFirebase("cloud-pull:local-conflict");
      } else {
        if (!commitResult?.success) throw new Error(commitResult?.error || "Cloud merge commit failed");
        dlog("[BG-RT] ← Cloud update applied");
      }
    }

    if (cloudDoc.playbackSettings) {
      await applyCloudPlaybackSettings(cloudDoc.playbackSettings);
    }

    if (cloudDoc.anilistAuth) {
      await applyCloudAnilistAuth(cloudDoc.anilistAuth);
    }

    const pending = await bgStorageGet([PENDING_SYNC_KEY, PENDING_PROGRESS_SYNC_KEY]);
    if (!cloudMatchesMerged || pending[PENDING_SYNC_KEY] || pending[PENDING_PROGRESS_SYNC_KEY]) {
      await syncToFirebase("cloud-pull:verify-merge");
    } else {
      await persistCloudSyncStatus("synced", {
        kind: "poll",
        uid: activeUser.uid,
        reason: "cloud-pull:verified",
        wrote: false,
      });
    }
  } catch (e) {
    console.warn("[BG-RT] Apply update failed:", e.message);
    throw e;
  }
}

const BG_PLAYBACK_FIELD_MAP = {
  copyGuard: "copyGuardEnabled",
  smartNotif: "smartNotificationsEnabled",
  autoSkipFiller: "autoSkipFillers",
  skiptimeHelper: "skiptimeHelperEnabled",
  auto4kServer: "auto4kServerEnabled",
  adGuard: "adGuardEnabled",
  autoResume: "autoResumeEnabled",
};
const BG_PLAYBACK_DEFAULT_ON = new Set(["copyGuardEnabled", "auto4kServerEnabled", "adGuardEnabled"]);
const BG_USER_PREFS_KEY = "userPreferences";
const BG_PLAYBACK_UPDATED_AT_KEY = "playbackSettingsUpdatedAt";

async function applyCloudPlaybackSettings(cloudPlayback) {
  if (!cloudPlayback || typeof cloudPlayback !== "object") return false;
  const cloudUpdatedAt = cloudPlayback.updatedAt || null;
  if (!cloudUpdatedAt) return false;

  try {
    const localKeys = Object.values(BG_PLAYBACK_FIELD_MAP).concat([BG_PLAYBACK_UPDATED_AT_KEY, BG_USER_PREFS_KEY]);
    const outcome = await runBgLibraryTransaction(localKeys, async (stored) => {
      const localUpdatedAt = stored[BG_PLAYBACK_UPDATED_AT_KEY] || null;
      if (localUpdatedAt && Date.parse(localUpdatedAt) >= Date.parse(cloudUpdatedAt)) {
        return { result: { applied: false, changed: false, writes: null } };
      }

      const writes = { [BG_PLAYBACK_UPDATED_AT_KEY]: cloudUpdatedAt };
      let changed = false;
      for (const [field, storageKey] of Object.entries(BG_PLAYBACK_FIELD_MAP)) {
        const next = !!cloudPlayback[field];
        const current = stored[storageKey];
        const currentBool = BG_PLAYBACK_DEFAULT_ON.has(storageKey) ? current !== false : current === true;
        if (currentBool !== next) {
          writes[storageKey] = next;
          changed = true;
        }
      }

      const cloudPrefs = cloudPlayback[BG_USER_PREFS_KEY];
      if (cloudPrefs && typeof cloudPrefs === "object") {
        const localPrefs = stored[BG_USER_PREFS_KEY];
        if (JSON.stringify(localPrefs || null) !== JSON.stringify(cloudPrefs)) {
          writes[BG_USER_PREFS_KEY] = cloudPrefs;
          changed = true;
        }
      }

      return {
        data: writes,
        result: { applied: true, changed, writes },
      };
    });
    if (!outcome?.applied) return false;
    const writes = outcome.writes || {};

    dlog("[BG-RT] ← Cloud playback settings applied");
    return outcome.changed;
  } catch (e) {
    console.warn("[BG-RT] Apply playback settings failed:", e.message);
    return false;
  }
}

const BG_ANILIST_AUTH_KEY = "anilist_auth";
const BG_ANILIST_USERNAME_KEY = "anilist_username";

async function applyCloudAnilistAuth(cloudAnilist) {
  if (!cloudAnilist || typeof cloudAnilist !== "object") return false;
  const cloudUpdatedAt = cloudAnilist.updatedAt || null;
  if (!cloudUpdatedAt) return false;

  try {
    const applied = await runBgLibraryTransaction([BG_ANILIST_AUTH_KEY, BG_ANILIST_USERNAME_KEY], async (stored) => {
      const localAuth = stored[BG_ANILIST_AUTH_KEY] || null;
      const localUpdatedAt = localAuth?.updatedAt || null;
      if (localUpdatedAt && Date.parse(localUpdatedAt) >= Date.parse(cloudUpdatedAt)) {
        return { result: false };
      }

      const cloudAccess = typeof cloudAnilist.accessToken === "string" && cloudAnilist.accessToken ? cloudAnilist.accessToken : null;
      const cloudExpiresAt = Number.isFinite(cloudAnilist.expiresAt) ? cloudAnilist.expiresAt : 0;
      const cloudHasValidToken = cloudAccess && (!cloudExpiresAt || cloudExpiresAt > Date.now());
      const writes = {
        [BG_ANILIST_AUTH_KEY]: cloudHasValidToken
          ? {
              accessToken: cloudAccess,
              expiresAt: cloudExpiresAt,
              viewer: cloudAnilist.viewer && typeof cloudAnilist.viewer === "object" ? cloudAnilist.viewer : null,
              updatedAt: cloudUpdatedAt,
            }
          : {
              accessToken: null,
              expiresAt: 0,
              viewer: null,
              updatedAt: cloudUpdatedAt,
            },
      };

      if (typeof cloudAnilist.username === "string" && cloudAnilist.username) {
        writes[BG_ANILIST_USERNAME_KEY] = cloudAnilist.username;
      }
      return { data: writes, result: true };
    });
    if (!applied) return false;

    dlog("[BG-RT] ← Cloud AniList auth applied");
    return true;
  } catch (e) {
    console.warn("[BG-RT] Apply AniList auth failed:", e.message);
    return false;
  }
}

const SIDECAR_SYNC_CONFIG = Object.freeze({
  playbackSettings: { field: "playbackSettings", debugType: "playback" },
  anilistAuth: { field: "anilistAuth", debugType: "anilist" },
});
const SIDECAR_RETRY_BACKOFF_MIN = Object.freeze([1, 5, 15, 60]);

async function queueStoredPlaybackSettings() {
  const stored = await bgStorageGet([
    "copyGuardEnabled",
    "smartNotificationsEnabled",
    "autoSkipFillers",
    "skiptimeHelperEnabled",
    "auto4kServerEnabled",
    "adGuardEnabled",
    "autoResumeEnabled",
    "userPreferences",
    BG_PLAYBACK_UPDATED_AT_KEY,
  ]);
  const updatedAt = stored[BG_PLAYBACK_UPDATED_AT_KEY] || new Date().toISOString();
  if (!stored[BG_PLAYBACK_UPDATED_AT_KEY]) {
    await bgStorageSet({ [BG_PLAYBACK_UPDATED_AT_KEY]: updatedAt });
  }
  return queueSidecarSync("playbackSettings", {
    copyGuard: stored.copyGuardEnabled !== false,
    smartNotif: stored.smartNotificationsEnabled === true,
    autoSkipFiller: stored.autoSkipFillers === true,
    skiptimeHelper: stored.skiptimeHelperEnabled === true,
    auto4kServer: stored.auto4kServerEnabled !== false,
    adGuard: stored.adGuardEnabled !== false,
    autoResume: stored.autoResumeEnabled === true,
    userPreferences: stored.userPreferences || null,
    updatedAt,
  });
}

function enqueueSidecarSync(task) {
  const next = sidecarSyncTail.then(task, task);
  sidecarSyncTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function persistPendingSidecars(state) {
  if (Object.keys(state || {}).length === 0) {
    await bgStorageRemove([PENDING_SIDECAR_SYNC_KEY]);
    try {
      await chrome.alarms.clear(SIDECAR_SYNC_RETRY_ALARM);
    } catch {}
    return;
  }
  await bgStorageSet({ [PENDING_SIDECAR_SYNC_KEY]: state });
}

function scheduleSidecarRetry(state) {
  const pending = Object.values(state || {}).filter(Boolean);
  if (pending.length === 0) {
    try {
      chrome.alarms.clear(SIDECAR_SYNC_RETRY_ALARM).catch(() => {});
    } catch {}
    return;
  }

  const retryAt = Math.min(...pending.map((record) => Number(record.retryAt) || Date.now() + 60000));
  try {
    chrome.alarms.create(SIDECAR_SYNC_RETRY_ALARM, { when: Math.max(Date.now() + 30000, retryAt) });
  } catch (error) {
    dlog("[BG] Failed to schedule sidecar retry:", error?.message || error);
  }
}

async function markSidecarAttemptFailed(kind, state, record, error) {
  const attempts = Math.max(0, Number(record.attempts) || 0) + 1;
  const delayMinutes = SIDECAR_RETRY_BACKOFF_MIN[Math.min(attempts - 1, SIDECAR_RETRY_BACKOFF_MIN.length - 1)];
  state[kind] = {
    ...record,
    attempts,
    lastError: String(error || "sidecar_sync_failed").slice(0, 240),
    retryAt: Date.now() + delayMinutes * 60 * 1000,
  };
  await persistPendingSidecars(state);
  scheduleSidecarRetry(state);
  return {
    success: false,
    acknowledged: false,
    pending: true,
    kind,
    error: state[kind].lastError,
    retryAt: state[kind].retryAt,
  };
}

async function flushSidecarRecord(kind, state) {
  const config = SIDECAR_SYNC_CONFIG[kind];
  const record = state?.[kind];
  if (!config || !record) return { success: true, acknowledged: true, skipped: true, kind };

  const user = await getFirebaseUser();
  if (!user) {
    return { success: false, acknowledged: false, pending: true, kind, error: "not_authenticated" };
  }
  if (record.uid !== user.uid) {
    delete state[kind];
    await persistPendingSidecars(state);
    scheduleSidecarRetry(state);
    return { success: false, acknowledged: false, pending: false, kind, error: "account_changed" };
  }

  const token = await getFirebaseToken();
  if (!token) return markSidecarAttemptFailed(kind, state, record, "token_unavailable");

  const url = `${FIRESTORE_BASE}/documents/users/${user.uid}`;
  const pushedAt = new Date().toISOString();
  const mask = `updateMask.fieldPaths=${config.field}&updateMask.fieldPaths=lastUpdated`;
  const body = JSON.stringify({
    fields: jsonToFirestoreFields({ [config.field]: record.payload, lastUpdated: pushedAt }),
  });

  try {
    const response = await enqueueFirestoreWrite(() =>
      fetchWithTimeout(`${url}?${mask}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body,
      }),
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      if (response.status === 401) await _invalidateCachedTokenExpiry(token).catch(() => {});
      return markSidecarAttemptFailed(kind, state, record, `HTTP ${response.status}: ${errorBody}`);
    }

    await markFirebaseAuthRequestOk(token);
    FSDebug.write(config.debugType, `sidecar:${kind}`, { fields: [config.field], bytes: body.length });
    if (cloudCache.doc && cloudCache.uid === user.uid) {
      cloudCache.doc = { ...cloudCache.doc, [config.field]: record.payload, lastUpdated: pushedAt };
      cloudCache.time = Date.now();
      await bgStorageSet({
        [_BG_CLOUD_CACHE_KEY]: { uid: user.uid, doc: cloudCache.doc, cachedAt: cloudCache.time },
      });
    }
    bgRememberOwnWrite(pushedAt);

    delete state[kind];
    await persistPendingSidecars(state);
    scheduleSidecarRetry(state);
    return { success: true, acknowledged: true, pending: false, kind };
  } catch (error) {
    return markSidecarAttemptFailed(kind, state, record, error?.message || error);
  }
}

function queueSidecarSync(kind, payload) {
  return enqueueSidecarSync(async () => {
    if (!SIDECAR_SYNC_CONFIG[kind] || !payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { success: false, acknowledged: false, pending: false, kind, error: "invalid_sidecar_payload" };
    }

    const user = await getFirebaseUser();
    if (!user) return { success: false, acknowledged: false, pending: false, kind, error: "not_authenticated" };

    const stored = await bgStorageGet([PENDING_SIDECAR_SYNC_KEY]);
    const state = { ...(stored[PENDING_SIDECAR_SYNC_KEY] || {}) };
    state[kind] = {
      uid: user.uid,
      payload,
      queuedAt: Date.now(),
      attempts: 0,
      retryAt: Date.now(),
    };
    await persistPendingSidecars(state);
    return flushSidecarRecord(kind, state);
  });
}

function flushPendingSidecarSyncs() {
  return enqueueSidecarSync(async () => {
    const stored = await bgStorageGet([PENDING_SIDECAR_SYNC_KEY]);
    const state = { ...(stored[PENDING_SIDECAR_SYNC_KEY] || {}) };
    const results = [];
    for (const kind of Object.keys(SIDECAR_SYNC_CONFIG)) {
      if (state[kind]) results.push(await flushSidecarRecord(kind, state));
    }
    return results;
  });
}

async function clearPendingSidecarSyncs() {
  await bgStorageRemove([PENDING_SIDECAR_SYNC_KEY]).catch(() => {});
  try {
    await chrome.alarms.clear(SIDECAR_SYNC_RETRY_ALARM);
  } catch {}
}

async function flushPendingProgressSync() {
  let cleared = false;
  try {
    cleared = await chrome.alarms.clear(PROGRESS_SYNC_ALARM);
  } catch {}
  if (cleared && !syncState.debounceTimeout && !syncState.inProgress) {
    syncProgressOnly("flush").catch(() => {});
  }
  return cleared;
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== "local") return;

  if (Object.prototype.hasOwnProperty.call(changes, "firebase_user")) {
    const newUid = changes.firebase_user?.newValue?.uid || null;
    const oldUid = changes.firebase_user?.oldValue?.uid || null;
    if (newUid) {
      authState.signedOut = false;
      ensureFullSyncPeriodicAlarm();
      flushPendingSidecarSyncs().catch((error) => {
        dlog("[BG] Pending sidecar resume after sign-in failed:", error?.message || error);
      });
    }
    if (newUid !== oldUid) {
      invalidateBgCloudDocCache();
      if (newUid) {
        bgStorageGet([PENDING_SYNC_KEY, PENDING_PROGRESS_SYNC_KEY])
          .then((stored) => {
            if (stored[PENDING_SYNC_KEY] || stored[PENDING_PROGRESS_SYNC_KEY]) {
              return syncToFirebase("auth:resume-pending");
            }
            return null;
          })
          .catch(() => {});
      }
    }
  }

  const isOwnSyncWrite = consumeBgSyncStorageWrite(changes);
  let _pendingProgressSync = false;
  let _pendingFullSync = false;

  if (changes.videoProgress && !isOwnSyncWrite) {
    _pendingProgressSync = true;
  }

  if (changes.animeData && !isOwnSyncWrite) {
    const oldAnime = changes.animeData.oldValue || {};
    const newAnime = changes.animeData.newValue || {};

    const oldCount = Object.values(oldAnime).reduce((s, a) => s + (a.episodes?.length || 0), 0);
    const newCount = Object.values(newAnime).reduce((s, a) => s + (a.episodes?.length || 0), 0);

    const libraryChanged = !areAnimeDataEqualIgnoringFetchMetadata(oldAnime, newAnime);

    if (newCount > oldCount || libraryChanged) {
      if (newCount > oldCount) {
        dlog(
          `%cAnime Tracker %c➕ New episode! (${oldCount}→${newCount})`,
          "color:rgb(255,107,107);font-weight:bold;font-size:12px",
          "color:rgb(148,163,184);font-size:11px",
        );
      }
      _pendingFullSync = true;
    }
  }

  if (changes.deletedAnime && !isOwnSyncWrite) {
    if (!shallowEqualDeletedAnime(changes.deletedAnime.oldValue || {}, changes.deletedAnime.newValue || {})) {
      _pendingFullSync = true;
    }
  }

  if (changes.groupCoverImages && !isOwnSyncWrite) {
    if (!shallowEqualObjectMap(changes.groupCoverImages.oldValue || {}, changes.groupCoverImages.newValue || {})) {
      _pendingFullSync = true;
    }
  }

  if (changes.goalSettings && !isOwnSyncWrite) {
    if (!shallowEqualObjectMap(changes.goalSettings.oldValue || {}, changes.goalSettings.newValue || {})) {
      _pendingFullSync = true;
    }
  }

  if (changes.badgeUnlocks && !isOwnSyncWrite) {
    if (!shallowEqualObjectMap(changes.badgeUnlocks.oldValue || {}, changes.badgeUnlocks.newValue || {})) {
      _pendingFullSync = true;
    }
  }

  if (_pendingFullSync) {
    chrome.alarms.clear(PROGRESS_SYNC_ALARM).catch(() => {});
    if (syncState.inProgress) {
      syncState.pending = true;
      syncToFirebase("onChanged:library-during-sync").catch(() => {});
    } else {
      scheduleFullSync("onChanged:library", 5000).catch(() => {});
    }
  } else if (_pendingProgressSync) {
    markProgressSyncPending("onChanged:progress");
    if (syncState.inProgress) {
      // A full sync already includes videoProgress. Queue another full pass so a
      // progress write that landed after its storage snapshot cannot be missed.
      syncState.pending = true;
      syncToFirebase("onChanged:progress-during-full").catch(() => {});
    } else if (syncState.progressInProgress) {
      syncState.progressPending = true;
      chrome.alarms.create(PROGRESS_SYNC_ALARM, { delayInMinutes: 0.5 });
    } else {
      chrome.alarms.create(PROGRESS_SYNC_ALARM, { delayInMinutes: 5 });
    }
  }

  if (changes.animeData) {
    const oldAnime = changes.animeData.oldValue || {};
    const newAnime = changes.animeData.newValue || {};
    const oldSlugs = new Set(Object.keys(oldAnime));
    const newlyAdded = Object.keys(newAnime).filter((s) => !oldSlugs.has(s));

    if (newlyAdded.length > 0) {
      queueTargetedMetadataRepair(newlyAdded).catch((error) => {
        console.error("[BG] Failed to queue repair for new anime:", error);
      });
    }
  }

  if (changes.pendingBackgroundMetadataRepair?.newValue === true) {
    maybeStartPendingMetadataRepair().catch((error) => {
      console.error("[BG] Failed to start pending repair on flag flip:", error);
    });
  }
});

async function migrateFromSyncToLocal() {
  if (bgLegacySyncMigrationComplete) return false;
  if (bgLegacySyncMigrationPromise) return bgLegacySyncMigrationPromise;

  bgLegacySyncMigrationPromise = (async () => {
    const legacyKeys = [...BG_LEGACY_SYNC_KEYS];
    const initialLocal = await bgStorageGet([BG_LEGACY_SYNC_MIGRATION_KEY, ...legacyKeys]);
    if (initialLocal[BG_LEGACY_SYNC_MIGRATION_KEY] === true) {
      bgLegacySyncMigrationComplete = true;
      return false;
    }

    const missingLocalKeys = legacyKeys.filter((key) => !Object.prototype.hasOwnProperty.call(initialLocal, key));
    const syncData =
      missingLocalKeys.length > 0
        ? await new Promise((resolve, reject) => {
            chrome.storage.sync.get(missingLocalKeys, (result) => {
              const errorMessage = chrome.runtime.lastError?.message;
              if (errorMessage) reject(new Error(`Legacy sync storage read failed: ${errorMessage}`));
              else resolve(result || {});
            });
          })
        : {};

    const migrationResult = await enqueueBgLibraryMutation(async () => {
      const latestLocal = await bgStorageGet([
        BG_LEGACY_SYNC_MIGRATION_KEY,
        LIBRARY_MUTATION_REVISION_KEY,
        ...legacyKeys,
      ]);
      if (latestLocal[BG_LEGACY_SYNC_MIGRATION_KEY] === true) {
        bgLegacySyncMigrationComplete = true;
        return { migrated: false, count: 0 };
      }

      const migratedData = {};
      for (const key of missingLocalKeys) {
        if (
          !Object.prototype.hasOwnProperty.call(latestLocal, key) &&
          Object.prototype.hasOwnProperty.call(syncData, key)
        ) {
          migratedData[key] = syncData[key];
        }
      }

      const payload = { ...migratedData, [BG_LEGACY_SYNC_MIGRATION_KEY]: true };
      if (containsLibraryMutationData(migratedData)) {
        payload[LIBRARY_MUTATION_REVISION_KEY] =
          Math.max(0, Number(latestLocal[LIBRARY_MUTATION_REVISION_KEY]) || 0) + 1;
      }
      await bgStorageSetRaw(payload);
      bgLegacySyncMigrationComplete = true;
      return { migrated: true, count: Object.keys(migratedData).length };
    });

    await new Promise((resolve) => {
      try {
        chrome.storage.sync.remove(legacyKeys, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      } catch {
        resolve();
      }
    });

    if (migrationResult.count > 0) dlog("[Anime Tracker] Legacy sync migration complete");
    return migrationResult.migrated;
  })()
    .catch((error) => {
      if (isBenignSwLifecycleError(error?.message)) dlog("[Anime Tracker] Migration interrupted during SW teardown");
      else console.error("[Anime Tracker] Migration error:", error);
      return false;
    })
    .finally(() => {
      bgLegacySyncMigrationPromise = null;
    });

  return bgLegacySyncMigrationPromise;
}

async function ensureBgLegacySyncMigration() {
  if (bgLegacySyncMigrationComplete) return;
  await migrateFromSyncToLocal();
  if (bgLegacySyncMigrationComplete) return;

  const stored = await bgStorageGet([BG_LEGACY_SYNC_MIGRATION_KEY]);
  if (stored[BG_LEGACY_SYNC_MIGRATION_KEY] === true) {
    bgLegacySyncMigrationComplete = true;
    return;
  }
  throw new Error("Legacy storage migration did not complete");
}

function normalizeTrackedDuration(duration) {
  const MAX_REASONABLE_DURATION_SECONDS = 6 * 60 * 60;
  let value = Math.round(Number(duration) || 0);
  if (!Number.isFinite(value) || value <= 0) value = 0;
  if (value > MAX_REASONABLE_DURATION_SECONDS) value = MAX_REASONABLE_DURATION_SECONDS;
  return value;
}

async function persistBeforeUnloadTrack(animeInfo, duration) {
  if (!animeInfo?.animeSlug || !animeInfo?.episodeNumber) {
    throw new Error("Invalid animeInfo for TRACK_BEFORE_UNLOAD");
  }

  return runBgLibraryTransaction(["animeData", "videoProgress"], async (result) => {
  const animeData = result.animeData || {};
  const videoProgress = result.videoProgress || {};

  const slug = animeInfo.animeSlug;
  const mediaType = globalThis.AnimeTrackerMediaType?.normalize(animeInfo.mediaType) || null;
  let changed = false;
  if (!animeData[slug]) {
    const createdAt = new Date().toISOString();
    animeData[slug] = {
      title: animeInfo.animeTitle || slug,
      slug,
      episodes: [],
      totalWatchTime: 0,
      lastWatched: null,
      totalEpisodes: Number.isFinite(animeInfo.totalEpisodes) ? animeInfo.totalEpisodes : null,
      totalEpisodesUpdatedAt: Number.isFinite(animeInfo.totalEpisodes) ? createdAt : null,
      totalEpisodesSource: Number.isFinite(animeInfo.totalEpisodes) ? "an1me" : null,
      coverImage: animeInfo.coverImage || null,
      siteAnimeId: animeInfo.siteAnimeId || null,
      mediaType,
      mediaTypeUpdatedAt: mediaType ? createdAt : null,
      mediaTypeSource: mediaType ? "an1me" : null,
      releaseStatus: animeInfo.releaseStatus || null,
      releaseStatusUpdatedAt: animeInfo.releaseStatus ? createdAt : null,
      releaseStatusSource: animeInfo.releaseStatus ? "an1me" : null,
    };
    changed = true;
  } else if (!animeData[slug].coverImage && animeInfo.coverImage) {
    animeData[slug].coverImage = animeInfo.coverImage;
    changed = true;
  }

  if (animeInfo.siteAnimeId && !animeData[slug].siteAnimeId) {
    animeData[slug].siteAnimeId = animeInfo.siteAnimeId;
    changed = true;
  }

  if (mediaType && (animeData[slug].mediaType !== mediaType || animeData[slug].mediaTypeSource !== "an1me")) {
    animeData[slug].mediaType = mediaType;
    animeData[slug].mediaTypeUpdatedAt = new Date().toISOString();
    animeData[slug].mediaTypeSource = "an1me";
    changed = true;
  }

  if (
    animeInfo.releaseStatus &&
    (animeData[slug].releaseStatus !== animeInfo.releaseStatus || animeData[slug].releaseStatusSource !== "an1me")
  ) {
    animeData[slug].releaseStatus = animeInfo.releaseStatus;
    animeData[slug].releaseStatusUpdatedAt = new Date().toISOString();
    animeData[slug].releaseStatusSource = "an1me";
    changed = true;
  }

  if (Number.isFinite(animeInfo.totalEpisodes) && animeInfo.totalEpisodes > 0) {
    const maxTracked = Math.max(0, ...(animeData[slug].episodes || []).map((ep) => Number(ep?.number) || 0));
    if (
      animeInfo.totalEpisodes >= maxTracked &&
      (animeData[slug].totalEpisodes !== animeInfo.totalEpisodes || animeData[slug].totalEpisodesSource !== "an1me")
    ) {
      animeData[slug].totalEpisodes = animeInfo.totalEpisodes;
      animeData[slug].totalEpisodesUpdatedAt = new Date().toISOString();
      animeData[slug].totalEpisodesSource = "an1me";
      changed = true;
    }
  }

  if (!Array.isArray(animeData[slug].episodes)) {
    animeData[slug].episodes = [];
  }

  const stateUpdatedAt = new Date().toISOString();
  if (globalThis.AnimeTrackerEntryState?.resumeInactiveState(animeData[slug], stateUpdatedAt)) {
    changed = true;
    dlog("[BG] Resumed inactive anime (new episode tracked):", slug);
  }

  const validDuration = normalizeTrackedDuration(duration);
  const watchedAt = new Date().toISOString().split(".")[0] + "Z";

  const upsertEpisode = (episodeNumber) => {
    const epNumber = Number(episodeNumber) || 0;
    if (epNumber <= 0) return;

    const episodes = animeData[slug].episodes;
    const existingIndex = episodes.findIndex((ep) => Number(ep?.number) === epNumber);
    if (existingIndex === -1) {
      episodes.push({
        number: epNumber,
        watchedAt,
        duration: validDuration,
        durationSource: "video",
      });
      changed = true;
      return;
    }

    const existing = episodes[existingIndex] || {};
    const existingDuration = Number(existing.duration) || 0;
    if (isPlaceholderDuration(existingDuration) && validDuration > 0 && existingDuration !== validDuration) {
      episodes[existingIndex] = {
        ...existing,
        duration: validDuration,
        durationSource: "video",
      };
      changed = true;
    }
  };

  upsertEpisode(animeInfo.episodeNumber);
  if (animeInfo.isDoubleEpisode && animeInfo.secondEpisodeNumber) {
    upsertEpisode(animeInfo.secondEpisodeNumber);
  }

  if (globalThis.AnimeTrackerEntryState?.reconcileCompletionState(animeData[slug], animeInfo, watchedAt)) {
    changed = true;
  }

  if (changed) {
    animeData[slug].episodes.sort((a, b) => a.number - b.number);
    animeData[slug].totalWatchTime = animeData[slug].episodes.reduce((sum, ep) => sum + (Number(ep?.duration) || 0), 0);
    animeData[slug].lastWatched = new Date().toISOString();
  }

  let progressChanged = false;
  if (animeInfo.uniqueId && videoProgress[animeInfo.uniqueId]) {
    delete videoProgress[animeInfo.uniqueId];
    progressChanged = true;
  }

  if (!changed && !progressChanged) return null;
  const payload = { animeData };
  if (progressChanged) payload.videoProgress = videoProgress;
  return { data: payload };
  });
}

const messageHandlers = {
  LIBRARY_ENSURE_LEGACY_MIGRATION(_message, _sender, sendResponse) {
    ensureBgLegacySyncMigration()
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
    return true;
  },

  LIBRARY_MUTATION_SNAPSHOT(message, _sender, sendResponse) {
    getLibraryMutationSnapshot(message.keys)
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
    return true;
  },

  LIBRARY_MUTATION_COMMIT(message, _sender, sendResponse) {
    commitLibraryMutation(message.expectedRevision, message.data)
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
    return true;
  },

  LIBRARY_MUTATION_WRITE(message, _sender, sendResponse) {
    if (!message.data || typeof message.data !== "object" || Array.isArray(message.data)) {
      sendResponse({ success: false, error: "invalid_mutation_data" });
      return true;
    }
    if (!containsLibraryMutationData(message.data)) {
      sendResponse({ success: false, error: "library_key_required" });
      return true;
    }
    bgStorageSet(message.data)
      .then(async () => {
        const stored = await bgStorageGet([LIBRARY_MUTATION_REVISION_KEY]);
        sendResponse({
          success: true,
          revision: Math.max(0, Number(stored[LIBRARY_MUTATION_REVISION_KEY]) || 0),
        });
      })
      .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
    return true;
  },

  SYNC_TO_FIREBASE_IMMEDIATE(message, _sender, sendResponse) {
    const task = flushFullSync(message.reason || "msg:immediate");
    if (message.waitForCompletion === true) {
      task
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: error?.message || String(error), kind: "full" }));
    } else {
      sendResponse({ received: true, queued: true });
      task.catch(() => {});
    }
    return true;
  },

  AUTH_STATE_MUTATE(message, _sender, sendResponse) {
    bgMutateFirebaseAuth(message)
      .then(async (result) => {
        if (message.operation === "clear_session" && result?.success) {
          invalidateBgCloudDocCache();
          await Promise.all([clearAuthAndSyncAlarms(), clearPendingSidecarSyncs()]);
        }
        sendResponse(result);
      })
      .catch((error) => sendResponse({ success: false, applied: false, error: error?.message || String(error) }));
    return true;
  },

  REFRESH_FIREBASE_TOKEN(message, _sender, sendResponse) {
    (async () => {
      const current = (await bgStorageGet(["firebase_tokens"])).firebase_tokens || null;
      if (!current?.refreshToken) {
        return { success: false, tokens: null, permanent: false, error: "signed_out" };
      }
      if (message.expectedRefreshToken && current.refreshToken !== message.expectedRefreshToken) {
        return { success: true, tokens: current, permanent: false, stale: true, error: "session_changed" };
      }
      const result = await refreshFirebaseToken(current.refreshToken);
      return { success: !!result?.tokens, ...result };
    })()
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, tokens: null, permanent: false, error: error?.message || String(error) }));
    return true;
  },

  GET_AUTH_STATE(message, _sender, sendResponse) {
    (async () => {
      try {
        const user = await getFirebaseUser();
        const tokens = await bgStorageGet(["firebase_tokens"]);
        sendResponse({ success: true, user, tokens: tokens?.firebase_tokens || null });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  },

  PUSH_PLAYBACK_SETTINGS(message, _sender, sendResponse) {
    queueSidecarSync("playbackSettings", message.playbackSettings)
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, pending: false, error: error?.message || String(error) }));
    return true;
  },

  PUSH_STORED_PLAYBACK_SETTINGS(_message, _sender, sendResponse) {
    queueStoredPlaybackSettings()
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, pending: false, error: error?.message || String(error) }));
    return true;
  },

  PUSH_ANILIST_AUTH(message, _sender, sendResponse) {
    queueSidecarSync("anilistAuth", message.anilistAuth)
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, pending: false, error: error?.message || String(error) }));
    return true;
  },

  SYNC_TO_FIREBASE(message, _sender, sendResponse) {
    const task = scheduleFullSync(message.reason || "msg:sync", 500);
    if (message.waitForCompletion === true) {
      task
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: error?.message || String(error), kind: "full" }));
    } else {
      sendResponse({ received: true, queued: true });
      task.catch(() => {});
    }
    return true;
  },

  QUEUE_BADGE_NOTIFICATIONS(message, _sender, sendResponse) {
    self.AnimeTrackerNotificationCoordinator
      .notifyBadges(message.badges || [])
      .then(sendResponse)
      .catch((error) => sendResponse({ accepted: false, error: error?.message || String(error) }));
    return true;
  },

  SYNC_PROGRESS_ONLY(message, _sender, sendResponse) {
    (async () => {
      await hydrateBgPollState();
      const sinceLast = Date.now() - _lastProgressSyncAt;
      if (!message.force && _lastProgressSyncAt && sinceLast < 4 * 60 * 1000) {
        markProgressSyncPending("msg:progress-throttled");
        chrome.alarms.create(PROGRESS_SYNC_ALARM, { delayInMinutes: 5 });
        return { success: false, queued: true, state: "pending", kind: "progress" };
      }
      try {
        await chrome.alarms.clear(PROGRESS_SYNC_ALARM);
      } catch {}
      return syncProgressOnly("msg:progress-only");
    })()
      .then((result) => {
        if (message.waitForCompletion === true) sendResponse(result);
      })
      .catch((error) => {
        if (message.waitForCompletion === true) sendResponse({ success: false, error: error?.message || String(error), kind: "progress" });
      });
    if (message.waitForCompletion !== true) sendResponse({ received: true, queued: true });
    return true;
  },

  GET_VERSION(message, _sender, sendResponse) {
    sendResponse({ version: chrome.runtime.getManifest().version });
    return true;
  },

  WAKE_AND_POLL_CLOUD(message, _sender, sendResponse) {
    const task = pollCloudData(message.reason || "content-page-open", { requireAuth: message.waitForCompletion === true });
    if (message.waitForCompletion === true) {
      task
        .then(async (doc) => {
          if (doc === CLOUD_POLL_SKIPPED) {
            sendResponse({ success: true, skipped: true, cloudDocFound: null });
            return;
          }
          if (!doc) {
            const syncResult = await syncToFirebase("cloud-poll:verify-empty");
            if (!syncResult.success) {
              sendResponse(syncResult);
              return;
            }
          }
          sendResponse({ success: true, cloudDocFound: !!doc });
        })
        .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
    } else {
      sendResponse({ received: true, queued: true });
      task.catch(() => {});
    }
    return true;
  },

  WAKE_AND_POLL_CLOUD_FORCE(message, _sender, sendResponse) {
    const task = pollCloudData(message.reason || "force-refresh", {
      force: true,
      requireAuth: message.waitForCompletion === true,
    });
    if (message.waitForCompletion === true) {
      task
        .then(async (doc) => {
          if (doc === CLOUD_POLL_SKIPPED) {
            sendResponse({ success: true, skipped: true, cloudDocFound: null });
            return;
          }
          if (!doc) {
            const syncResult = await syncToFirebase("cloud-poll:verify-empty");
            if (!syncResult.success) {
              sendResponse(syncResult);
              return;
            }
          }
          sendResponse({ success: true, cloudDocFound: !!doc });
        })
        .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
    } else {
      sendResponse({ received: true, queued: true });
      task.catch(() => {});
    }
    return true;
  },

  GET_CLOUD_DOC(message, _sender, sendResponse) {
    (async () => {
      try {
        const user = await getFirebaseUser();
        const token = await getFirebaseToken();
        if (!user || !token) {
          sendResponse({ success: false, error: "not_authenticated" });
          return;
        }
        const doc = await fetchCloudDataCached(user, token);
        sendResponse({ success: true, doc: doc || null });
      } catch (e) {
        sendResponse({
          success: false,
          error: e?.message || String(e),
          status: e?.status || null,
        });
      }
    })();
    return true;
  },

  INVALIDATE_BG_CLOUD_DOC_CACHE(message, _sender, sendResponse) {
    invalidateBgCloudDocCache();
    sendResponse({ ok: true });
    return true;
  },

  SIGNED_OUT(message, _sender, sendResponse) {
    authState.signedOut = true;
    invalidateBgCloudDocCache();
    Promise.all([
      bgMutateFirebaseAuth({ operation: "clear_session" }),
      clearAuthAndSyncAlarms(),
      clearPendingSidecarSyncs(),
    ])
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e?.message }));
    return true;
  },

  UPDATE_BG_CLOUD_DOC_CACHE(message, _sender, sendResponse) {
    (async () => {
      try {
        const senderUid = typeof message.uid === "string" ? message.uid : null;
        const activeUser = await getFirebaseUser();
        const activeUid = activeUser?.uid || null;
        if (!senderUid || !activeUid || senderUid !== activeUid || !message.doc || typeof message.doc !== "object") {
          invalidateBgCloudDocCache();
          sendResponse({ ok: false, reason: "uid_mismatch_or_no_doc" });
          return;
        }
        cloudCache.doc = message.doc;
        cloudCache.time = Date.now();
        cloudCache.uid = activeUid;
        bgStorageSet({
          [_BG_CLOUD_CACHE_KEY]: { uid: activeUid, doc: message.doc, cachedAt: cloudCache.time },
        }).catch(() => {});
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  },

  UPDATE_BG_PLAYBACK_SETTINGS(message, _sender, sendResponse) {
    if (message.playbackSettings && typeof message.playbackSettings === "object") {
      if (cloudCache.doc && typeof cloudCache.doc === "object") {
        cloudCache.doc = { ...cloudCache.doc, playbackSettings: message.playbackSettings };
        cloudCache.time = Date.now();
      }
    }
    sendResponse({ ok: true });
    return true;
  },

  UPDATE_BG_ANILIST_AUTH(message, _sender, sendResponse) {
    if (message.anilistAuth && typeof message.anilistAuth === "object") {
      if (cloudCache.doc && typeof cloudCache.doc === "object") {
        cloudCache.doc = { ...cloudCache.doc, anilistAuth: message.anilistAuth };
        cloudCache.time = Date.now();
      }
    }
    sendResponse({ ok: true });
    return true;
  },

  UPDATE_BG_CLOUD_DOC_PARTIAL(message, _sender, sendResponse) {
    (async () => {
      try {
        const senderUid = typeof message.uid === "string" ? message.uid : null;
        const partial = message.partial && typeof message.partial === "object" ? message.partial : null;
        const activeUser = await getFirebaseUser();
        const activeUid = activeUser?.uid || null;
        if (!senderUid || !activeUid || senderUid !== activeUid || !partial) {
          invalidateBgCloudDocCache();
          sendResponse({ ok: false, reason: "uid_mismatch_or_no_partial" });
          return;
        }
        if (cloudCache.doc && cloudCache.uid === activeUid) {
          cloudCache.doc = { ...cloudCache.doc, ...partial };
          cloudCache.time = Date.now();
          bgStorageSet({
            [_BG_CLOUD_CACHE_KEY]: { uid: activeUid, doc: cloudCache.doc, cachedAt: cloudCache.time },
          }).catch(() => {});
          sendResponse({ ok: true, mode: "overlay" });
        } else {
          sendResponse({ ok: true, mode: "no-baseline-skip" });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  },

  RESOLVE_ANIME(message, _sender, sendResponse) {
    if (!message.slug) {
      sendResponse({ success: false, error: "Missing slug" });
      return true;
    }
    self.AnimeTrackerAnimeResolver.resolve(message.slug, {
      title: message.title || null,
      mediaType: message.mediaType || null,
      mediaTypeUpdatedAt: message.mediaTypeUpdatedAt || null,
      includeEpisodeTypes: message.includeEpisodeTypes !== false,
      forceInfoRefresh: message.forceInfoRefresh === true,
      forceFillerRefresh: message.forceFillerRefresh === true,
    })
      .then((result) => sendResponse({ success: true, result }))
      .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
    return true;
  },

  WATCHLIST_SYNC(message, _sender, sendResponse) {
    sendResponse({ received: true });
    const { animeId, watchlistType, animeSlug } = message;
    if (animeId && watchlistType) {
      syncWatchlistToSite(animeId, watchlistType, animeSlug || null).catch((e) => console.log("[BG] Watchlist sync error:", e));
    }
    return true;
  },

  SET_SMART_NOTIFICATIONS(message, _sender, sendResponse) {
    setSmartNotificationsEnabled(message.enabled === true)
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
    return true;
  },

  GET_SMART_NOTIFICATION_STATUS(message, _sender, sendResponse) {
    getSmartNotificationStatus({ reconcile: message.reconcile !== false })
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
    return true;
  },

  GET_FILLER_EPISODES(message, _sender, sendResponse) {
    if (!message.animeSlug) {
      sendResponse({ fillers: null });
      return true;
    }
    const slug = message.animeSlug;
    if (isLikelyMovieSlug(slug, message.mediaType)) {
      sendResponse({ fillers: null });
      return true;
    }
    const title = message.animeTitle || null;
    (async () => {
      try {
        const resolved = await self.AnimeTrackerAnimeResolver.resolve(slug, {
          title,
          mediaType: message.mediaType || null,
          includeEpisodeTypes: true,
          forceInfoRefresh: false,
          forceFillerRefresh: false,
        });
        const fillers = resolved.episodeTypes?.notFound ? null : resolved.episodeTypes?.filler || null;
        sendResponse({ fillers });
      } catch {
        sendResponse({ fillers: null });
      }
    })();
    return true;
  },

  GET_OUTRO_START(message, _sender, sendResponse) {
    const slug = message.animeSlug;
    const title = message.animeTitle || null;
    const ep = Number(message.episodeNumber) || 0;
    const len = Number(message.episodeLength) || 0;
    if (!slug || !ep) {
      sendResponse({ outroStart: null });
      return true;
    }
    (async () => {
      try {
        const outroStart = await fetchAniSkipOutroStart(slug, title, ep, len);
        sendResponse({ outroStart });
      } catch {
        sendResponse({ outroStart: null });
      }
    })();
    return true;
  },

  START_LIBRARY_REPAIR(message, _sender, sendResponse) {
    startLibraryRepair({
      forceInfoRefresh: message.forceInfoRefresh === true,
      forceFillerRefresh: message.forceFillerRefresh === true,
      isMobile: message.isMobile === true,
      auto: message.auto === true,
      origin: message.origin,
    })
      .then((state) => sendResponse({ success: true, state }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  },

  AN1ME_GATEWAY_FETCH(message, _sender, sendResponse) {
    an1meFetch(String(message.url || ""), { as: message.as, timeoutMs: message.timeoutMs })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, status: 0, unreachable: true, error: error?.message || String(error) }));
    return true;
  },

  ENSURE_LIBRARY_FRESH(message, _sender, sendResponse) {
    sendResponse({ received: true });
    ensureLibraryFresh(message.prioritySlugs || []).catch((e) => console.log("[BG] ensureLibraryFresh error:", e));
    return true;
  },

  TRACK_BEFORE_UNLOAD(message, _sender, sendResponse) {
    persistBeforeUnloadTrack(message.animeInfo, message.duration)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = messageHandlers[message?.type];
  return handler ? handler(message, sender, sendResponse) === true : false;
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    bgStorageSet({
      animeData: {},
      videoProgress: {},
      settings: { watchThreshold: 0.85, notifications: true },
    }).catch((e) => console.error("[BG] Failed to init storage on install:", e));
  } else if (details.reason === "update") {
    const style = [
      "color:rgb(255,107,107)",
      "font-weight:bold",
      "font-size:13px",
      "padding:4px 8px",
      "background:linear-gradient(135deg,rgba(255,107,107,0.2),rgba(255,142,83,0.2))",
      "border-radius:4px",
    ].join(";");
    dlog(`%c🎬 Anime Tracker v${chrome.runtime.getManifest().version}`, style);
    migrateFromSyncToLocal();

    if (details.previousVersion === chrome.runtime.getManifest().version) return;

    (async () => {
      try {
        const helper = self.AnimeTrackerAuthTokens;
        if (!helper) return;
        await helper.migrateTokensIfNeeded();
        const t = await helper.readTokens();
        if (!t || !t.refreshToken) {
          dlog("[BG] Post-update refresh: no session to validate");
          return;
        }
        if (t.needsReauth) {
          dlog("[BG] Post-update refresh: session already in needsReauth state — skipping");
          return;
        }
        const result = await refreshFirebaseToken(t.refreshToken);
        if (result?.tokens) {
          console.log("[BG] Post-update silent refresh: ok");
        } else if (result?.permanent) {
          await helper.setNeedsReauth(true);
          console.log(`[BG] Post-update silent refresh: permanent (${result?.error || "?"}) — needsReauth set, tokens preserved`);
        } else {
          console.log(`[BG] Post-update silent refresh: transient (${result?.error || "?"}) — retry alarm armed`);
        }
      } catch (e) {
        console.log("[BG] Post-update silent refresh failed:", e?.message || e);
      }
    })();

    const fromVersion = details.previousVersion || null;
    const toVersion = chrome.runtime.getManifest().version || null;

    bgStorageGet(["postUpdateFetchTriggeredAt"])
      .then((existing) => {
        const payload = {
          pendingBackgroundMetadataRepair: true,
          pendingRepairSlugs: [],
        };
        if (!existing.postUpdateFetchTriggeredAt) {
          payload.postUpdateFetchTriggeredAt = Date.now();
          payload.postUpdateFetchFromVersion = fromVersion;
          payload.postUpdateFetchToVersion = toVersion;
        }
        return bgStorageSet(payload);
      })
      .catch((e) => console.warn("[BG] Post-update flag write failed:", e));
  }
});

chrome.runtime.onStartup.addListener(() => {
  dlog("[Anime Tracker] Extension started");
  migrateFromSyncToLocal();
  reconcileSmartNotificationAlarm().catch((error) => {
    console.warn("[BG] Smart notification startup reconciliation failed:", error?.message || error);
  });

  // Ensure cloud sync survives browser restart
  (async () => {
    try {
      if (await getFirebaseUser()) {
        ensureFullSyncPeriodicAlarm();
        pollCloudData("startup").catch(() => {});
      }
    } catch {}
  })();
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "keepAlive" && port.name !== "popupAlive") return;
  const consumerId = `${port.name}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  addStreamConsumer(consumerId);
  port.onDisconnect.addListener(() => {
    removeStreamConsumer(consumerId);
    const err = chrome.runtime.lastError;
    if (err) {
      const msg = err.message || "";
      const isExpectedClose = msg.includes("back/forward cache") || msg.includes("message channel is closed");
      if (!isExpectedClose) {
        ddebug(`[BG] ${port.name} port disconnected:`, msg);
      }
    }
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === METADATA_REPAIR_ALARM) {
    runMetadataRepairBatch().catch((error) => {
      console.log("[BG] Metadata repair alarm failed:", error);
    });
    return;
  }

  if (alarm.name === SMART_NOTIF_ALARM) {
    checkNewEpisodes().catch((e) => console.log("[BG] Smart notif check error:", e));
    return;
  }

  if (alarm.name === PROGRESS_SYNC_ALARM) {
    if (syncState.inProgress) {
      syncState.pending = true;
      syncToFirebase("alarm:progress-during-full").catch(() => {});
      return;
    }
    if (syncState.debounceTimeout) return;
    if (syncState.progressInProgress) {
      syncState.progressPending = true;
      markProgressSyncPending("alarm:progress-during-progress");
      return;
    }
    syncProgressOnly("alarm:progress").catch(() => {});
    return;
  }

  if (alarm.name === FULL_SYNC_PERIODIC_ALARM) {
    if (syncState.inProgress || syncState.debounceTimeout) return;
    periodicSyncNeeded()
      .then((needed) => {
        if (needed) syncToFirebase("alarm:periodic").catch(() => {});
      })
      .catch(() => {});
    return;
  }

  if (alarm.name === FULL_SYNC_RETRY_ALARM) {
    if (syncState.inProgress) {
      syncState.pending = true;
      syncToFirebase("alarm:full-retry-during-sync").catch(() => {});
      return;
    }

    syncToFirebase("alarm:full-retry").catch(() => {});
    return;
  }

  if (alarm.name === PROGRESS_SYNC_RETRY_ALARM) {
    if (syncState.progressInProgress) {
      syncState.progressPending = true;
      markProgressSyncPending("alarm:progress-retry-during-sync");
      return;
    }
    syncProgressOnly("alarm:progress-retry").catch(() => {});
    return;
  }

  if (alarm.name === AUTH_REFRESH_RETRY_BG_ALARM) {
    _bgAuthRefreshRetryTick();
    return;
  }

  if (alarm.name === SIDECAR_SYNC_RETRY_ALARM) {
    flushPendingSidecarSyncs().catch((error) => {
      console.warn("[BG] Sidecar sync retry failed:", error?.message || error);
    });
    return;
  }

  if (alarm.name === DAILY_CLEANUP_ALARM) {
    bgIterativeQuotaRecovery("daily-alarm").catch((e) => {
      console.warn("[Cleanup] alarm tick failed:", e?.message || e);
    });
    return;
  }
});

migrateFromSyncToLocal().catch((error) => {
  console.warn("[Anime Tracker] Legacy migration bootstrap failed:", error?.message || error);
});

maybeStartPendingMetadataRepair().catch((error) => {
  console.error("[BG] Failed to start pending metadata repair on boot:", error);
});
resumeMetadataRepairIfNeeded().catch((error) => {
  console.error("[BG] Failed to resume metadata repair on boot:", error);
});
hydrateBgPollState();

migratePerKeyCachesOnce();

ensureDailyCleanupAlarmScheduled();

(async () => {
  try {
    if (await getFirebaseUser()) ensureFullSyncPeriodicAlarm();
  } catch {}
})();

(async () => {
  try {
    await self.AnimeTrackerAuthTokens?.migrateTokensIfNeeded?.();
  } catch (e) {
    console.warn("[BG] Token migration skipped:", e?.message || e);
  }
})();

(async () => {
  try {
    const stored = await bgStorageGet([PENDING_SYNC_KEY, PENDING_PROGRESS_SYNC_KEY, PENDING_SIDECAR_SYNC_KEY]);
    const fullPending = Number(stored?.[PENDING_SYNC_KEY]) || 0;
    const progressPending = Number(stored?.[PENDING_PROGRESS_SYNC_KEY]) || 0;
    const sidecarsPending = Object.keys(stored?.[PENDING_SIDECAR_SYNC_KEY] || {}).length > 0;
    if (fullPending) {
      dlog("[BG] Recovering stranded full sync from previous SW incarnation");
      await syncToFirebase("recovery:stranded-full");
    } else if (progressPending) {
      dlog("[BG] Recovering stranded progress sync from previous SW incarnation");
      await syncProgressOnly("recovery:stranded-progress");
    }
    if (sidecarsPending) {
      dlog("[BG] Recovering stranded sidecar sync from previous SW incarnation");
      await flushPendingSidecarSyncs();
    }
  } catch (e) {
    console.warn("[BG] Pending-sync recovery check failed:", e);
  }
})();
