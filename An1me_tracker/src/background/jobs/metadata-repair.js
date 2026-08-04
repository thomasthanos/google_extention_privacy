// metadata-repair.js — alarm-driven job that refreshes anime metadata (info,
// episode types/fillers) a few per tick; throttled full sweeps + targeted repairs.
const METADATA_REPAIR_STATE_KEY = "metadataRepairState";
const PENDING_METADATA_REPAIR_KEY = "pendingBackgroundMetadataRepair";
const PENDING_REPAIR_SLUGS_KEY = "pendingRepairSlugs";
const META_LAST_RUN_KEY = "metadataRepairLastRunAt";
const META_REPAIR_GATE_MS = 6 * 60 * 60 * 1000;
const METADATA_REPAIR_ALARM = "metadataRepairTick";
const METADATA_REPAIR_STALE_MS = 3 * 60 * 1000;
const METADATA_REPAIR_INTER_ITEM_DELAY_MS = 250;
const METADATA_REPAIR_PLAYBACK_DELAY_MS = 3000;
const METADATA_REPAIR_MAX_LOGS = 60;
const METADATA_REPAIR_MODAL_FETCH_THRESHOLD = 8;
const METADATA_REPAIR_ORIGINS = new Set(["manual", "sign-in", "targeted", "background"]);
const isMobileUA = typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad|iPod|Orion/i.test(navigator.userAgent || "");
const METADATA_REPAIR_MAX_ATTEMPTS = isMobileUA ? 1 : 2;
const METADATA_REPAIR_RETRY_BASE_DELAY_MS = 1500;

function normalizeMetadataRepairOrigin(value, isTargeted = false, isAuto = null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (METADATA_REPAIR_ORIGINS.has(normalized)) return normalized;
  if (isTargeted) return "targeted";
  return isAuto === false ? "manual" : "background";
}

function hasExplicitMetadataRepairFetchTotal(state) {
  if (state?.fetchTotal === null || state?.fetchTotal === undefined) return false;
  const explicit = Number(state.fetchTotal);
  return Number.isFinite(explicit) && explicit >= 0;
}

function getMetadataRepairFetchTotal(state) {
  if (hasExplicitMetadataRepairFetchTotal(state)) return Math.floor(Number(state.fetchTotal));
  return Array.isArray(state?.items) ? state.items.length : 0;
}

function getMetadataRepairRemainingFetches(state) {
  const total = getMetadataRepairFetchTotal(state);
  const completed = Math.max(0, Math.min(total, Number(state?.queueIndex) || 0));
  return Math.max(0, total - completed);
}

function resolveMetadataRepairUiMode(origin, fetchCount) {
  if (origin === "manual") return "modal";
  if (origin === "sign-in" && Number(fetchCount) >= METADATA_REPAIR_MODAL_FETCH_THRESHOLD) return "modal";
  return "status";
}

function createMetadataRepairRunId() {
  return `repair:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function isRetryableMetadataRepairError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (!message) return true;

  if (message.includes("http 404")) return false;
  if (message.includes("http 400")) return false;
  if (message.includes("http 401")) return false;
  if (message.includes("http 403")) return false;

  return true;
}

async function runMetadataRepairWithRetry(task, options = {}) {
  const {
    attempts = METADATA_REPAIR_MAX_ATTEMPTS,
    baseDelayMs = METADATA_REPAIR_RETRY_BASE_DELAY_MS,
    shouldRetry = isRetryableMetadataRepairError,
  } = options;

  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error)) {
        throw error;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      await delay(delayMs);
    }
  }

  throw lastError || new Error("Metadata repair retry failed");
}

function scheduleMetadataRepairFallback(delayInMinutes = 1) { chrome.alarms.create(METADATA_REPAIR_ALARM, { delayInMinutes }); }

async function getMetadataRepairState() {
  const result = await bgStorageGet([METADATA_REPAIR_STATE_KEY]);
  return result[METADATA_REPAIR_STATE_KEY] || null;
}

async function setMetadataRepairState(state) {
  await bgStorageSet({ [METADATA_REPAIR_STATE_KEY]: state });
}

function appendMetadataRepairLog(logs, entry) {
  const next = Array.isArray(logs) ? logs.slice(-(METADATA_REPAIR_MAX_LOGS - 1)) : [];
  next.push(entry);
  return next;
}

function isAnimeInfoCacheFresh(entry) {
  return self.AnimeTrackerCachePolicy.isInfoFresh(entry);
}

function isEpisodeTypesCacheFresh(entry, infoEntry) {
  return self.AnimeTrackerCachePolicy.isFillerFresh(entry, infoEntry);
}

function formatMetadataRepairDetail(infoResult, fillerResult) {
  const parts = [];

  if (infoResult?.status === "fetched") parts.push("info refreshed");
  else if (infoResult?.status === "cached") parts.push("info cached");
  else if (infoResult?.status === "unavailable") parts.push("info unavailable");
  else if (infoResult?.status === "failed") parts.push(`info failed: ${infoResult.error || "error"}`);

  if (fillerResult?.status === "fetched") {
    const fillers = fillerResult.fillerCount || 0;
    const total = fillerResult.totalEpisodes || "?";
    parts.push(`${fillers} fillers / ${total} eps`);
  } else if (fillerResult?.status === "cached") {
    parts.push("filler cached");
  } else if (fillerResult?.status === "nofill") {
    parts.push("not listed");
  } else if (fillerResult?.status === "movie") {
    parts.push("movie/OVA");
  } else if (fillerResult?.status === "failed") {
    parts.push(`filler failed: ${fillerResult.error || "error"}`);
  }

  return parts.join(" • ");
}

function buildMetadataRepairLog(slug, title, infoResult, fillerResult) {
  const displayTitle = title || slug;
  const detail = formatMetadataRepairDetail(infoResult, fillerResult);

  if (infoResult?.status === "failed" || fillerResult?.status === "failed") {
    return { type: "error", slug, name: displayTitle, detail, at: Date.now() };
  }

  if (fillerResult?.status === "movie") {
    return { type: "movie", slug, name: displayTitle, detail, at: Date.now() };
  }

  if (fillerResult?.status === "nofill") {
    return { type: "nofill", slug, name: displayTitle, detail, at: Date.now() };
  }

  if (infoResult?.status === "fetched" || fillerResult?.status === "fetched") {
    return { type: "fetch", slug, name: displayTitle, detail, at: Date.now() };
  }

  return { type: "cached", slug, name: displayTitle, detail, at: Date.now() };
}

function countMetadataRepairOutcome(logEntry) {
  const base = { fetched: 0, cached: 0, skipped: 0, failed: 0 };
  if (!logEntry) return base;

  if (logEntry.type === "fetch") base.fetched = 1;
  else if (logEntry.type === "cached") base.cached = 1;
  else if (logEntry.type === "movie" || logEntry.type === "nofill") base.skipped = 1;
  else if (logEntry.type === "error") base.failed = 1;

  return base;
}

async function buildLibraryRepairPlan(animeData, options = {}) {
  const forceInfoRefresh = options.forceInfoRefresh === true;
  const forceFillerRefresh = options.forceFillerRefresh === true;
  const isMobile = options.isMobile === true || isMobileUA;
  const onlySlugs = Array.isArray(options.onlySlugs) && options.onlySlugs.length ? new Set(options.onlySlugs) : null;
  const prioritySlugs = new Set(Array.isArray(options.prioritySlugs) ? options.prioritySlugs : []);
  const entries = Object.entries(animeData || {})
    .filter(([slug]) => !onlySlugs || onlySlugs.has(slug))
    .sort(([left], [right]) => Number(prioritySlugs.has(right)) - Number(prioritySlugs.has(left)));
  const storageKeys = [];

  entries.forEach(([slug]) => {
    storageKeys.push(`animeinfo_${slug}`);
    storageKeys.push(`episodeTypes_${slug}`);
  });

  const cachedEntries = storageKeys.length > 0 ? await bgStorageGet(storageKeys) : {};
  const items = [];
  let logs = [];
  let processed = 0;
  let cached = 0;
  let skipped = 0;

  for (const [slug, anime] of entries) {
    if (isMobile) {
      const listState = anime?.listState || "active";
      if (listState === "dropped") {
        continue;
      }
    }
    const infoEntry = cachedEntries[`animeinfo_${slug}`];
    const fillerEntry = cachedEntries[`episodeTypes_${slug}`];
    const resolvedMediaType = globalThis.AnimeTrackerMediaType?.resolve(slug, anime, infoEntry) || null;
    const movieLike = isLikelyMovieSlug(slug, resolvedMediaType);

    const entryListState = String(anime?.listState || "").toLowerCase();
    const isSettledEntry =
      !onlySlugs && !!(anime?.completedAt || anime?.droppedAt || entryListState === "completed" || entryListState === "dropped");
    const settledFillerUsable =
      isSettledEntry &&
      globalThis.AnimeTrackerCachePolicy?.isInfoAuthoritative?.(infoEntry) &&
      infoEntry.status === "FINISHED" &&
      globalThis.AnimeTrackerCachePolicy?.isFillerUsableSnapshot?.(fillerEntry) &&
      fillerEntry._source === "an1me" &&
      Number(fillerEntry.sourceCachedAt) >= Number(infoEntry.cachedAt);
    const hasFreshInfo = !forceInfoRefresh && isAnimeInfoCacheFresh(infoEntry);
    const hasFreshFiller = movieLike
      ? true
      : !forceFillerRefresh && (isEpisodeTypesCacheFresh(fillerEntry, infoEntry) || settledFillerUsable);

    const needsInfo = !hasFreshInfo;
    const needsFiller = !movieLike && !hasFreshFiller;

    if (!needsInfo && !needsFiller) {
      const infoResult = infoEntry?.notFound ? { status: "unavailable", entry: infoEntry } : { status: "cached", entry: infoEntry };
      const fillerResult = movieLike
        ? { status: "movie" }
        : fillerEntry?.notFound
          ? { status: "nofill", entry: fillerEntry }
          : {
              status: "cached",
              entry: fillerEntry,
              fillerCount: fillerEntry?.filler?.length || 0,
              totalEpisodes: fillerEntry?.totalEpisodes || null,
            };

      processed++;
      if (movieLike || fillerEntry?.notFound) {
        skipped++;
      } else {
        cached++;
      }
      logs = appendMetadataRepairLog(logs, buildMetadataRepairLog(slug, anime?.title || slug, infoResult, fillerResult));
      continue;
    }

    items.push({
      slug,
      title: anime?.title || slug,
      mediaType: anime?.mediaType || null,
      mediaTypeUpdatedAt: anime?.mediaTypeUpdatedAt || null,
    });
  }

  return {
    // Excludes fully-skipped entries (e.g. completed/dropped on mobile) so the progress bar fills smoothly to 100%.
    total: processed + items.length,
    processed,
    cached,
    skipped,
    logs,
    items,
    queueIndex: 0,
    forceInfoRefresh,
    forceFillerRefresh,
  };
}

let metadataRepairInProgress = false;
const animeInfoRepairInflight = new Map();

async function repairAnimeInfoCacheUncoalesced(slug, forceRefresh = true) {
  const key = `animeinfo_${slug}`;
  const stored = await bgStorageGet([key]);
  const cached = stored[key];

  if (!forceRefresh && isAnimeInfoCacheFresh(cached)) {
    return cached?.notFound ? { status: "unavailable", entry: cached } : { status: "cached", entry: cached };
  }

  try {
    const info = await fetchAnimePageInfo(slug);
    const entry = { ...info, cachedAt: Date.now() };
    await bgStorageSet({ [key]: entry });
    return { status: "fetched", entry };
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("http 404")) {
      const notFoundEntry = {
        notFound: true,
        schemaVersion: self.AnimeTrackerCachePolicy.INFO_SCHEMA_VERSION,
        cachedAt: Date.now(),
      };
      await bgStorageSet({ [key]: notFoundEntry });
      return { status: "unavailable", entry: notFoundEntry };
    }
    // Transient failure (timeout/5xx): cache a short retryable backoff so a giant page (e.g. One Piece) isn't re-scraped every sweep. Keep prior data if any.
    const backoffEntry =
      cached && typeof cached === "object"
        ? { ...cached, retryable: true, retryAt: Date.now() }
        : { error: message, retryable: true, retryAt: Date.now(), cachedAt: Date.now() };
    await bgStorageSet({ [key]: backoffEntry });
    throw error;
  }
}

function repairAnimeInfoCache(slug, forceRefresh = true) {
  const normalizedSlug = String(slug || "").toLowerCase();
  const requestKey = `${normalizedSlug}|${forceRefresh ? "force" : "cached"}`;
  const forceRequest = animeInfoRepairInflight.get(`${normalizedSlug}|force`);
  if (!forceRefresh && forceRequest) return forceRequest;
  const existing = animeInfoRepairInflight.get(requestKey);
  if (existing) return existing;

  const request = repairAnimeInfoCacheUncoalesced(slug, forceRefresh);
  animeInfoRepairInflight.set(requestKey, request);
  const clearInflight = () => {
    if (animeInfoRepairInflight.get(requestKey) === request) animeInfoRepairInflight.delete(requestKey);
  };
  request.then(clearInflight, clearInflight);
  return request;
}

const episodeTypesRepairInflight = new Map();

async function repairEpisodeTypesCacheUncoalesced(slug, title, forceRefresh = true, mediaType = null, mediaTypeUpdatedAt = null) {
  const key = `episodeTypes_${slug}`;
  const infoKey = `animeinfo_${slug}`;
  const stored = await bgStorageGet([key, infoKey]);
  const cached = stored[key];
  const info = stored[infoKey];

  const resolvedMediaType = globalThis.AnimeTrackerMediaType?.resolve(slug, { title, mediaType, mediaTypeUpdatedAt }, info) || null;
  if (isLikelyMovieSlug(slug, resolvedMediaType)) {
    return { status: "movie" };
  }

  const hasSiteEpisodeTypes =
    self.AnimeTrackerCachePolicy.isInfoAuthoritative(info) &&
    info.episodeTypesSource === "an1me" &&
    (Array.isArray(info.fillerEpisodes) || Array.isArray(info.canonEpisodes));
  if (hasSiteEpisodeTypes) {
    const sourceCachedAt = Number(info.cachedAt) || 0;
    if (
      !forceRefresh &&
      cached?._source === "an1me" &&
      Number(cached.sourceCachedAt) >= sourceCachedAt &&
      isEpisodeTypesCacheFresh(cached, info)
    ) {
      return {
        status: "cached",
        entry: cached,
        fillerCount: cached.filler?.length || 0,
        totalEpisodes: cached.totalEpisodes || null,
      };
    }
    const siteEntry = {
      canon: Array.isArray(info.canonEpisodes) ? info.canonEpisodes : [],
      filler: Array.isArray(info.fillerEpisodes) ? info.fillerEpisodes : [],
      mixed: [],
      anime_canon: [],
      totalEpisodes: Number(info.totalEpisodes) || null,
      schemaVersion: self.AnimeTrackerCachePolicy.EPISODE_TYPES_SCHEMA_VERSION,
      cachedAt: Date.now(),
      sourceCachedAt,
      _source: "an1me",
      _fillerSlug: slug,
    };
    await bgStorageSet({ [key]: siteEntry });
    return {
      status: "fetched",
      entry: siteEntry,
      fillerCount: siteEntry.filler.length,
      totalEpisodes: siteEntry.totalEpisodes,
    };
  }

  if (!forceRefresh && isEpisodeTypesCacheFresh(cached, info)) {
    return cached?.notFound
      ? { status: "nofill", entry: cached }
      : {
          status: "cached",
          entry: cached,
          fillerCount: cached?.filler?.length || 0,
          totalEpisodes: cached?.totalEpisodes || null,
        };
  }

  let fillerSlug;
  let episodeTypes;
  let episodeTypesSource = "animefillerlist";
  const infoTotal = Number(info?.totalEpisodes) || 0;
  const matchesInfoTotal = (types) => {
    const externalTotal = Number(types?.totalEpisodes) || 0;
    return !infoTotal || !externalTotal || externalTotal === infoTotal;
  };
  try {
    fillerSlug = await discoverFillerSlug(slug, title || null, { forceRefresh });
    if (fillerSlug) episodeTypes = await fetchEpisodeTypesFromAnimeFillerList(fillerSlug);
    if (episodeTypes && !matchesInfoTotal(episodeTypes)) episodeTypes = null;
    if (!episodeTypes && title) {
      const jikanTypes = await fetchJikanEpisodes(title);
      // An empty filler array is a valid all-canon result; the object and episode-total match are the validity checks.
      if (jikanTypes && matchesInfoTotal(jikanTypes)) {
        episodeTypes = jikanTypes;
        fillerSlug = slug;
        episodeTypesSource = "jikan";
      }
    }
  } catch (error) {
    // Transient failure: cache a short retryable backoff so it isn't re-fetched every sweep. Keep prior data if any.
    // retryAt (not cachedAt) carries the backoff timestamp so prior valid data keeps its original cachedAt
    // and stays usable/displayable during the backoff window.
    const backoffEntry =
      cached && typeof cached === "object"
        ? { ...cached, retryable: true, retryAt: Date.now() }
        : {
            error: String(error?.message || ""),
            retryable: true,
            retryAt: Date.now(),
            cachedAt: Date.now(),
            // Without the schema stamp isFillerFresh rejects the entry outright and the
            // 15-minute backoff never engages (unlike isInfoFresh, which checks retryable first).
            schemaVersion: self.AnimeTrackerCachePolicy.EPISODE_TYPES_SCHEMA_VERSION,
          };
    await bgStorageSet({ [key]: backoffEntry });
    throw error;
  }

  if (!episodeTypes) {
    const notFoundEntry = {
      notFound: true,
      schemaVersion: self.AnimeTrackerCachePolicy.EPISODE_TYPES_SCHEMA_VERSION,
      cachedAt: Date.now(),
    };
    await bgStorageSet({ [key]: notFoundEntry });
    return { status: "nofill", entry: notFoundEntry };
  }

  const entry = {
    ...episodeTypes,
    schemaVersion: self.AnimeTrackerCachePolicy.EPISODE_TYPES_SCHEMA_VERSION,
    cachedAt: Date.now(),
    _source: episodeTypesSource,
    _fillerSlug: fillerSlug || null,
  };
  await bgStorageSet({ [key]: entry });
  return {
    status: "fetched",
    entry,
    fillerCount: entry.filler?.length || 0,
    totalEpisodes: entry.totalEpisodes || null,
  };
}

function repairEpisodeTypesCache(slug, title, forceRefresh = true, mediaType = null, mediaTypeUpdatedAt = null) {
  const requestKey = `${String(slug || "").toLowerCase()}|${forceRefresh ? "force" : "cached"}`;
  const existing = episodeTypesRepairInflight.get(requestKey);
  if (existing) return existing;

  const request = repairEpisodeTypesCacheUncoalesced(slug, title, forceRefresh, mediaType, mediaTypeUpdatedAt);
  episodeTypesRepairInflight.set(requestKey, request);
  const clearInflight = () => {
    if (episodeTypesRepairInflight.get(requestKey) === request) {
      episodeTypesRepairInflight.delete(requestKey);
    }
  };
  request.then(clearInflight, clearInflight);
  return request;
}

async function finalizeMetadataRepair(state, patch = {}) {
  const finalState = {
    ...state,
    ...patch,
    currentSlug: null,
    currentTitle: null,
    updatedAt: new Date().toISOString(),
  };
  await setMetadataRepairState(finalState);
  await chrome.alarms.clear(METADATA_REPAIR_ALARM);

  return finalState;
}

async function _isWatchTabOpen() {
  try {
    const tabs = await chrome.tabs.query({ url: ["https://an1me.to/watch/*", "https://*.an1me.to/watch/*"] });
    return Array.isArray(tabs) && tabs.some((t) => !t.discarded && t.status !== "unloaded");
  } catch {
    return false;
  }
}

async function runMetadataRepairBatch(options = {}) {
  if (metadataRepairInProgress) return false;
  metadataRepairInProgress = true;

  try {
    let state = await getMetadataRepairState();
    if (!state || state.status !== "running") {
      await chrome.alarms.clear(METADATA_REPAIR_ALARM);
      return false;
    }

    scheduleMetadataRepairFallback(2);

    const gentle = state.options?.auto !== false && (await _isWatchTabOpen());

    while (true) {
      state = await getMetadataRepairState();
      if (!state || state.status !== "running") {
        await chrome.alarms.clear(METADATA_REPAIR_ALARM);
        return false;
      }

      const items = Array.isArray(state.items) ? state.items : [];
      const index = Number.isFinite(Number(state.queueIndex))
        ? Number(state.queueIndex)
        : Math.min(Number(state.processed) || 0, items.length);

      if (index >= items.length) {
        await finalizeMetadataRepair(state, {
          status: "completed",
          completedAt: new Date().toISOString(),
        });
        return true;
      }

      const item = items[index];
      const startedAt = new Date().toISOString();
      if (state.currentSlug !== item.slug || state.currentTitle !== item.title) {
        state = {
          ...state,
          currentSlug: item.slug,
          currentTitle: item.title || item.slug,
          updatedAt: startedAt,
        };
        await setMetadataRepairState(state);
      }

      if (index % 5 === 0) {
        scheduleMetadataRepairFallback(2);
      }

      let infoResult;
      let fillerResult;
      let logEntry;

      try {
        const resolved = await self.AnimeTrackerAnimeResolver.resolve(item.slug, {
          title: item.title || item.slug,
          mediaType: item.mediaType || null,
          mediaTypeUpdatedAt: item.mediaTypeUpdatedAt || null,
          includeEpisodeTypes: true,
          forceInfoRefresh: state.options?.forceInfoRefresh !== false,
          forceFillerRefresh: state.options?.forceFillerRefresh !== false,
        });
        infoResult = resolved.infoResult || { status: "unavailable", entry: null };
        fillerResult = resolved.fillerResult || { status: "nofill", entry: null };
      } catch (error) {
        const message = error?.message || String(error);
        infoResult = { status: "failed", error: message };
        fillerResult = { status: "failed", error: message };
      }

      logEntry = buildMetadataRepairLog(item.slug, item.title || item.slug, infoResult, fillerResult);
      const counts = countMetadataRepairOutcome(logEntry);
      const processed = (Number(state.processed) || 0) + 1;
      const nextQueueIndex = index + 1;
      const nextItem = items[nextQueueIndex] || null;
      const updatedAt = new Date().toISOString();

      state = {
        ...state,
        processed,
        queueIndex: nextQueueIndex,
        fetched: (state.fetched || 0) + counts.fetched,
        cached: (state.cached || 0) + counts.cached,
        skipped: (state.skipped || 0) + counts.skipped,
        failed: (state.failed || 0) + counts.failed,
        logs: appendMetadataRepairLog(state.logs, logEntry),
        lastLog: logEntry,
        currentSlug: nextItem?.slug || null,
        currentTitle: nextItem?.title || null,
        updatedAt,
      };

      if (nextQueueIndex >= items.length) {
        await finalizeMetadataRepair(state, {
          status: "completed",
          completedAt: updatedAt,
        });
        return true;
      }

      await setMetadataRepairState(state);
      await delay(gentle ? METADATA_REPAIR_PLAYBACK_DELAY_MS : isMobileUA ? 1500 : METADATA_REPAIR_INTER_ITEM_DELAY_MS);
    }
  } catch (error) {
    console.error("[BG] Library repair failed:", error);
    const state = await getMetadataRepairState();
    if (state?.status === "running") {
      await finalizeMetadataRepair(state, {
        status: "error",
        errorMessage: error.message || "Unknown repair error",
        completedAt: new Date().toISOString(),
      });
    } else {
      await chrome.alarms.clear(METADATA_REPAIR_ALARM).catch(() => {});
    }
    return false;
  } finally {
    metadataRepairInProgress = false;
    // Runs after the in-progress guard is released so a queued repair can actually start;
    // cheap no-op when the pending flag isn't set.
    maybeStartPendingMetadataRepair().catch((error) => {
      console.error("[BG] Failed to trigger pending repair after batch:", error);
    });
  }
}

async function startLibraryRepair(options = {}) {
  const isTargeted = Array.isArray(options.onlySlugs) && options.onlySlugs.length > 0;
  const requestedAutoMode = options.auto === true ? true : options.auto === false ? false : null;
  const requestedOrigin = normalizeMetadataRepairOrigin(options.origin, isTargeted, requestedAutoMode);

  let existing = await getMetadataRepairState();
  if (existing?.status === "running") {
    const existingAutoMode = existing.options?.auto === true ? true : existing.options?.auto === false ? false : null;
    const existingOrigin = normalizeMetadataRepairOrigin(existing.origin, false, existingAutoMode);
    const hasExplicitUiMode = existing.uiMode === "modal" || existing.uiMode === "status";
    const shouldPromoteToManual = requestedOrigin === "manual" && existingOrigin !== "manual";
    const shouldPromoteToSignIn =
      requestedOrigin === "sign-in" && existingOrigin !== "manual" && (existingOrigin !== "sign-in" || !hasExplicitUiMode);
    const shouldQueueSignInSweep = requestedOrigin === "sign-in" && existing.pendingSignInSweep !== true;

    if (
      shouldPromoteToManual ||
      shouldPromoteToSignIn ||
      shouldQueueSignInSweep ||
      !existing.runId ||
      !hasExplicitMetadataRepairFetchTotal(existing)
    ) {
      const origin = shouldPromoteToManual ? "manual" : shouldPromoteToSignIn ? "sign-in" : existingOrigin;
      const uiMode =
        shouldPromoteToManual || shouldPromoteToSignIn
          ? resolveMetadataRepairUiMode(origin, getMetadataRepairRemainingFetches(existing))
          : hasExplicitUiMode
            ? existing.uiMode
            : resolveMetadataRepairUiMode(origin, getMetadataRepairRemainingFetches(existing));
      existing = {
        ...existing,
        runId: existing.runId || createMetadataRepairRunId(),
        origin,
        uiMode,
        fetchTotal: getMetadataRepairFetchTotal(existing),
        pendingSignInSweep: existing.pendingSignInSweep === true || shouldQueueSignInSweep,
      };
      await setMetadataRepairState(existing);
    }

    await bgStorageSet({ [PENDING_METADATA_REPAIR_KEY]: true });
    scheduleMetadataRepairFallback(1);
    runMetadataRepairBatch().catch((error) => {
      console.error("[BG] Failed to resume running repair:", error);
    });
    return existing;
  }

  if (options.auto === true && !isTargeted && requestedOrigin !== "sign-in") {
    try {
      const gateRead = await bgStorageGet([META_LAST_RUN_KEY]);
      const lastRun = Number(gateRead[META_LAST_RUN_KEY]) || 0;
      if (lastRun > 0 && Date.now() - lastRun < META_REPAIR_GATE_MS) {
        return { status: "throttled", throttled: true, total: 0 };
      }
    } catch {}
  }

  await bgStorageSet({ [PENDING_METADATA_REPAIR_KEY]: false });

  if (!isTargeted) {
    try {
      await bgStorageSet({ [META_LAST_RUN_KEY]: Date.now() });
    } catch {}
  }

  const stored = await bgStorageGet(["animeData"]);
  const animeData = stored.animeData || {};
  const plan = await buildLibraryRepairPlan(animeData, options);
  const now = new Date().toISOString();
  const fetchTotal = plan.items.length;

  let state = {
    runId: createMetadataRepairRunId(),
    origin: requestedOrigin,
    uiMode: resolveMetadataRepairUiMode(requestedOrigin, fetchTotal),
    fetchTotal,
    status: "running",
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    errorMessage: null,
    total: plan.total,
    processed: plan.processed,
    queueIndex: plan.queueIndex,
    fetched: 0,
    cached: plan.cached,
    skipped: plan.skipped,
    failed: 0,
    currentSlug: plan.items[0]?.slug || null,
    currentTitle: plan.items[0]?.title || null,
    items: plan.items,
    logs: plan.logs || [],
    options: {
      forceInfoRefresh: plan.forceInfoRefresh,
      forceFillerRefresh: plan.forceFillerRefresh,
      auto: options.auto === true,
    },
  };

  if (plan.total === 0 || plan.items.length === 0) {
    state = {
      ...state,
      status: "completed",
      completedAt: now,
      currentSlug: null,
      currentTitle: null,
    };
    await setMetadataRepairState(state);
    await chrome.alarms.clear(METADATA_REPAIR_ALARM);
    return state;
  }

  await setMetadataRepairState(state);
  scheduleMetadataRepairFallback(1);
  runMetadataRepairBatch().catch((error) => {
    console.error("[BG] Failed to start library repair batch:", error);
  });
  return state;
}

async function queueTargetedMetadataRepair(slugs) {
  const list = (Array.isArray(slugs) ? slugs : []).filter(Boolean);
  if (list.length === 0) return;

  const stored = await bgStorageGet([PENDING_REPAIR_SLUGS_KEY]);
  const existing = Array.isArray(stored[PENDING_REPAIR_SLUGS_KEY]) ? stored[PENDING_REPAIR_SLUGS_KEY] : [];
  const merged = Array.from(new Set([...existing, ...list]));

  await bgStorageSet({
    [PENDING_REPAIR_SLUGS_KEY]: merged,
    [PENDING_METADATA_REPAIR_KEY]: true,
  });
}

async function maybeStartPendingMetadataRepair() {
  const stored = await bgStorageGet([PENDING_METADATA_REPAIR_KEY, PENDING_REPAIR_SLUGS_KEY]);
  if (!stored[PENDING_METADATA_REPAIR_KEY]) return false;

  const targetedSlugs = Array.isArray(stored[PENDING_REPAIR_SLUGS_KEY]) ? stored[PENDING_REPAIR_SLUGS_KEY].filter(Boolean) : [];

  const existingState = await getMetadataRepairState();
  const isRunning = existingState && existingState.status === "running";
  const pendingSignInSweep = existingState?.pendingSignInSweep === true;
  const isTargeted = targetedSlugs.length > 0 && !pendingSignInSweep;

  // Routine full sweeps stay gated; targeted repairs and an explicit queued sign-in sweep bypass that gate.
  if (!isRunning && !isTargeted && !pendingSignInSweep) {
    try {
      const gateRead = await bgStorageGet([META_LAST_RUN_KEY]);
      const lastRun = Number(gateRead[META_LAST_RUN_KEY]) || 0;
      if (lastRun > 0 && Date.now() - lastRun < META_REPAIR_GATE_MS) {
        await bgStorageSet({ [PENDING_METADATA_REPAIR_KEY]: false });
        return false;
      }
    } catch {}
  }

  await startLibraryRepair({
    forceInfoRefresh: false,
    forceFillerRefresh: false,
    onlySlugs: isTargeted ? targetedSlugs : null,
    auto: pendingSignInSweep,
    origin: pendingSignInSweep ? "sign-in" : isTargeted ? "targeted" : "background",
  });

  if (!isRunning && targetedSlugs.length > 0 && (isTargeted || pendingSignInSweep)) {
    try {
      // Clear only the slugs this run consumed — a blind [] wipe would drop slugs queued
      // concurrently by queueTargetedMetadataRepair while the repair was starting.
      const consumed = new Set(targetedSlugs);
      const latest = await bgStorageGet([PENDING_REPAIR_SLUGS_KEY]);
      const remaining = (Array.isArray(latest[PENDING_REPAIR_SLUGS_KEY]) ? latest[PENDING_REPAIR_SLUGS_KEY] : []).filter(
        (slug) => !consumed.has(slug),
      );
      const payload = { [PENDING_REPAIR_SLUGS_KEY]: remaining };
      // Re-arm the pending flag so the running batch's finally-hook picks the leftovers up.
      if (remaining.length > 0) payload[PENDING_METADATA_REPAIR_KEY] = true;
      await bgStorageSet(payload);
    } catch {}
  }
  return true;
}

async function ensureLibraryFresh(prioritySlugs = []) {
  let existingState = await getMetadataRepairState();
  if (existingState?.status === "running") {
      const priorities = new Set(Array.isArray(prioritySlugs) ? prioritySlugs : []);
    if (priorities.size > 0 && Array.isArray(existingState.items)) {
      const index = Math.max(0, Number(existingState.queueIndex) || 0);
      const lockedUntil = existingState.currentSlug ? Math.min(existingState.items.length, index + 1) : index;
      const completedItems = existingState.items.slice(0, lockedUntil);
      const pendingItems = existingState.items
        .slice(lockedUntil)
        .sort((left, right) => Number(priorities.has(right.slug)) - Number(priorities.has(left.slug)));
      existingState = { ...existingState, items: [...completedItems, ...pendingItems] };
      await setMetadataRepairState(existingState);
    }
    const updatedAt = existingState.updatedAt ? Date.parse(existingState.updatedAt) : 0;
    if (updatedAt && Date.now() - updatedAt < METADATA_REPAIR_STALE_MS) return false;
    scheduleMetadataRepairFallback(1);
    runMetadataRepairBatch().catch((error) => {
      console.error("[BG] ensureLibraryFresh resume failed:", error);
    });
    return true;
  }

  const stored = await bgStorageGet(["animeData"]);
  const animeData = stored.animeData || {};
  const plan = await buildLibraryRepairPlan(animeData, {
    forceInfoRefresh: false,
    forceFillerRefresh: false,
    prioritySlugs,
  });
  if (!plan.items.length) return false;

  const now = new Date().toISOString();
  const fetchTotal = plan.items.length;
  const state = {
    runId: createMetadataRepairRunId(),
    origin: "background",
    uiMode: "status",
    fetchTotal,
    status: "running",
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    errorMessage: null,
    total: plan.total,
    processed: plan.processed,
    queueIndex: plan.queueIndex,
    fetched: 0,
    cached: plan.cached,
    skipped: plan.skipped,
    failed: 0,
    currentSlug: plan.items[0]?.slug || null,
    currentTitle: plan.items[0]?.title || null,
    items: plan.items,
    logs: plan.logs || [],
    options: { forceInfoRefresh: false, forceFillerRefresh: false, auto: true },
  };

  await setMetadataRepairState(state);
  scheduleMetadataRepairFallback(1);
  runMetadataRepairBatch().catch((error) => {
    console.error("[BG] ensureLibraryFresh batch failed:", error);
  });
  return true;
}

async function resumeMetadataRepairIfNeeded() {
  const state = await getMetadataRepairState();
  if (state?.status !== "running") return;
  scheduleMetadataRepairFallback(1);
  runMetadataRepairBatch().catch((error) => {
    console.error("[BG] Failed to resume metadata repair on boot:", error);
  });
}

try {
  globalThis.mrStats = async () => {
    const s = await getMetadataRepairState();
    const pending = await bgStorageGet([PENDING_METADATA_REPAIR_KEY, PENDING_REPAIR_SLUGS_KEY]);
    const ageMs = s?.updatedAt ? Date.now() - Date.parse(s.updatedAt) : null;
    const info = {
      status: s?.status || "none",
      processed: s?.processed ?? 0,
      total: s?.total ?? 0,
      fetchProcessed: s ? Math.min(getMetadataRepairFetchTotal(s), Number(s.queueIndex) || 0) : 0,
      fetchTotal: getMetadataRepairFetchTotal(s),
      origin: s?.origin || null,
      uiMode: s?.uiMode || null,
      pendingSignInSweep: s?.pendingSignInSweep === true,
      currentSlug: s?.currentSlug || null,
      updatedAgoSec: ageMs != null ? Math.round(ageMs / 1000) : null,
      stale: s?.status === "running" && ageMs != null && ageMs > METADATA_REPAIR_STALE_MS,
      inProgress: metadataRepairInProgress,
      pendingFlag: !!pending[PENDING_METADATA_REPAIR_KEY],
      pendingSlugs: (pending[PENDING_REPAIR_SLUGS_KEY] || []).length,
    };
    console.table([info]);
    return info;
  };
} catch {}
