


const METADATA_REPAIR_STATE_KEY = 'metadataRepairState';
const PENDING_METADATA_REPAIR_KEY = 'pendingBackgroundMetadataRepair';
// Slugs queued for a *targeted* repair (e.g. anime just added to the library).
// When this list is non-empty the next repair only touches these slugs instead
// of sweeping the whole library.
const PENDING_REPAIR_SLUGS_KEY = 'pendingRepairSlugs';
// Timestamp of the last *full* library sweep, used to throttle them.
const META_LAST_RUN_KEY = 'metadataRepairLastRunAt';
// A full library sweep is expensive, so never run two within this window. Only
// the post-update sweep and explicit user "Refresh all" should ever need one.
const META_REPAIR_GATE_MS = 6 * 60 * 60 * 1000;
const METADATA_REPAIR_ALARM = 'metadataRepairTick';
const METADATA_REPAIR_INFO_TTL_MS = 24 * 60 * 60 * 1000;
// Airing shows still get fresher treatment than finished ones, but 1h was far
// too aggressive: every sweep re-fetched every releasing title. The dedicated
// smart-notifications job already polls airing anime on its own tight cadence,
// so the generic repair only needs a loose ceiling here.
const METADATA_REPAIR_INFO_TTL_AIRING_MS = 6 * 60 * 60 * 1000;
const METADATA_REPAIR_EPISODE_TYPES_TTL_MS = 24 * 60 * 60 * 1000;
const METADATA_REPAIR_NOT_FOUND_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const METADATA_REPAIR_RETRYABLE_TTL_MS = 15 * 60 * 1000;
const METADATA_REPAIR_INTER_ITEM_DELAY_MS = 250;
const METADATA_REPAIR_MAX_LOGS = 60;
const isMobileUA = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod|Orion/i.test(navigator.userAgent || '');
const METADATA_REPAIR_MAX_ATTEMPTS = isMobileUA ? 1 : 2;
const METADATA_REPAIR_RETRY_BASE_DELAY_MS = 1500;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableMetadataRepairError(error) {
    const message = String(error?.message || '').toLowerCase();
    if (!message) return true;

    if (message.includes('http 404')) return false;
    if (message.includes('http 400')) return false;
    if (message.includes('http 401')) return false;
    if (message.includes('http 403')) return false;

    return true;
}

async function runMetadataRepairWithRetry(task, options = {}) {
    const {
        attempts = METADATA_REPAIR_MAX_ATTEMPTS,
        baseDelayMs = METADATA_REPAIR_RETRY_BASE_DELAY_MS,
        shouldRetry = isRetryableMetadataRepairError
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

    throw lastError || new Error('Metadata repair retry failed');
}

function scheduleMetadataRepairFallback(delayInMinutes = 1) {
    chrome.alarms.create(METADATA_REPAIR_ALARM, { delayInMinutes });
}

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
    if (!entry || typeof entry !== 'object') return false;
    const age = entry.cachedAt ? Date.now() - entry.cachedAt : Infinity;
    if (entry.notFound) return age < METADATA_REPAIR_NOT_FOUND_TTL_MS;


    if (entry.retryable) return age < METADATA_REPAIR_RETRYABLE_TTL_MS;
    const ttl = entry.status === 'RELEASING'
        ? METADATA_REPAIR_INFO_TTL_AIRING_MS
        : METADATA_REPAIR_INFO_TTL_MS;
    return age < ttl;
}

function isEpisodeTypesCacheFresh(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const age = entry.cachedAt ? Date.now() - entry.cachedAt : Infinity;
    if (entry.notFound) return age < METADATA_REPAIR_NOT_FOUND_TTL_MS;
    return age < METADATA_REPAIR_EPISODE_TYPES_TTL_MS;
}

function formatMetadataRepairDetail(infoResult, fillerResult) {
    const parts = [];

    if (infoResult?.status === 'fetched') parts.push('info refreshed');
    else if (infoResult?.status === 'cached') parts.push('info cached');
    else if (infoResult?.status === 'unavailable') parts.push('info unavailable');
    else if (infoResult?.status === 'failed') parts.push(`info failed: ${infoResult.error || 'error'}`);

    if (fillerResult?.status === 'fetched') {
        const fillers = fillerResult.fillerCount || 0;
        const total = fillerResult.totalEpisodes || '?';
        parts.push(`${fillers} fillers / ${total} eps`);
    } else if (fillerResult?.status === 'cached') {
        parts.push('filler cached');
    } else if (fillerResult?.status === 'nofill') {
        parts.push('not listed');
    } else if (fillerResult?.status === 'movie') {
        parts.push('movie/OVA');
    } else if (fillerResult?.status === 'failed') {
        parts.push(`filler failed: ${fillerResult.error || 'error'}`);
    }

    return parts.join(' • ');
}

function buildMetadataRepairLog(slug, title, infoResult, fillerResult) {
    const displayTitle = title || slug;
    const detail = formatMetadataRepairDetail(infoResult, fillerResult);

    if (infoResult?.status === 'failed' || fillerResult?.status === 'failed') {
        return { type: 'error', slug, name: displayTitle, detail, at: Date.now() };
    }

    if (fillerResult?.status === 'movie') {
        return { type: 'movie', slug, name: displayTitle, detail, at: Date.now() };
    }

    if (fillerResult?.status === 'nofill') {
        return { type: 'nofill', slug, name: displayTitle, detail, at: Date.now() };
    }

    if (infoResult?.status === 'fetched' || fillerResult?.status === 'fetched') {
        return { type: 'fetch', slug, name: displayTitle, detail, at: Date.now() };
    }

    return { type: 'cached', slug, name: displayTitle, detail, at: Date.now() };
}

function countMetadataRepairOutcome(logEntry) {
    const base = { fetched: 0, cached: 0, skipped: 0, failed: 0 };
    if (!logEntry) return base;

    if (logEntry.type === 'fetch') base.fetched = 1;
    else if (logEntry.type === 'cached') base.cached = 1;
    else if (logEntry.type === 'movie' || logEntry.type === 'nofill') base.skipped = 1;
    else if (logEntry.type === 'error') base.failed = 1;

    return base;
}

async function buildLibraryRepairPlan(animeData, options = {}) {
    const forceInfoRefresh = options.forceInfoRefresh === true;
    const forceFillerRefresh = options.forceFillerRefresh === true;
    const isMobile = options.isMobile === true || isMobileUA;
    // When a specific set of slugs is requested (a targeted repair) restrict the
    // plan to just those entries instead of scanning the whole library.
    const onlySlugs = Array.isArray(options.onlySlugs) && options.onlySlugs.length
        ? new Set(options.onlySlugs)
        : null;
    const entries = Object.entries(animeData || {})
        .filter(([slug]) => !onlySlugs || onlySlugs.has(slug));
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
            const listState = anime?.listState || 'active';
            if (listState === 'completed' || listState === 'dropped') {
                continue;
            }
        }
        const infoEntry = cachedEntries[`animeinfo_${slug}`];
        const fillerEntry = cachedEntries[`episodeTypes_${slug}`];
        const movieLike = isLikelyMovieSlug(slug);

        const hasFreshInfo = !forceInfoRefresh && isAnimeInfoCacheFresh(infoEntry);
        const hasFreshFiller = movieLike
            ? true
            : (!forceFillerRefresh && isEpisodeTypesCacheFresh(fillerEntry));

        const needsInfo = !hasFreshInfo;
        const needsFiller = !movieLike && !hasFreshFiller;

        if (!needsInfo && !needsFiller) {
            const infoResult = infoEntry?.notFound
                ? { status: 'unavailable', entry: infoEntry }
                : { status: 'cached', entry: infoEntry };
            const fillerResult = movieLike
                ? { status: 'movie' }
                : fillerEntry?.notFound
                    ? { status: 'nofill', entry: fillerEntry }
                    : {
                        status: 'cached',
                        entry: fillerEntry,
                        fillerCount: fillerEntry?.filler?.length || 0,
                        totalEpisodes: fillerEntry?.totalEpisodes || null
                    };

            processed++;
            if (movieLike || fillerEntry?.notFound) {
                skipped++;
            } else {
                cached++;
            }
            logs = appendMetadataRepairLog(
                logs,
                buildMetadataRepairLog(slug, anime?.title || slug, infoResult, fillerResult)
            );
            continue;
        }

        items.push({
            slug,
            title: anime?.title || slug
        });
    }

    return {
        // Count only the entries we actually account for: those already
        // resolved from cache (processed) plus those queued for fetching
        // (items). Entries skipped entirely (e.g. completed/dropped on mobile)
        // are excluded so the progress bar fills smoothly to 100% instead of
        // jumping when the run completes.
        total: processed + items.length,
        processed,
        cached,
        skipped,
        logs,
        items,
        queueIndex: 0,
        forceInfoRefresh,
        forceFillerRefresh
    };
}

let metadataRepairInProgress = false;

async function repairAnimeInfoCache(slug, forceRefresh = true) {
    const key = `animeinfo_${slug}`;
    const stored = await bgStorageGet([key]);
    const cached = stored[key];

    if (!forceRefresh && isAnimeInfoCacheFresh(cached)) {
        return cached?.notFound
            ? { status: 'unavailable', entry: cached }
            : { status: 'cached', entry: cached };
    }

    try {
        const info = await fetchAnimePageInfo(slug);
        const entry = { ...info, cachedAt: Date.now() };
        await bgStorageSet({ [key]: entry });
        return { status: 'fetched', entry };
    } catch (error) {
        const message = String(error?.message || '').toLowerCase();
        if (message.includes('http 404')) {
            const notFoundEntry = { notFound: true, cachedAt: Date.now() };
            await bgStorageSet({ [key]: notFoundEntry });
            return { status: 'unavailable', entry: notFoundEntry };
        }
        throw error;
    }
}

async function repairEpisodeTypesCache(slug, title, forceRefresh = true) {
    if (isLikelyMovieSlug(slug)) {
        return { status: 'movie' };
    }

    const key = `episodeTypes_${slug}`;
    const stored = await bgStorageGet([key]);
    const cached = stored[key];

    if (!forceRefresh && isEpisodeTypesCacheFresh(cached)) {
        return cached?.notFound
            ? { status: 'nofill', entry: cached }
            : {
                status: 'cached',
                entry: cached,
                fillerCount: cached?.filler?.length || 0,
                totalEpisodes: cached?.totalEpisodes || null
            };
    }

    const fillerSlug = await discoverFillerSlug(slug, title || null, { forceRefresh });
    if (!fillerSlug) {
        const notFoundEntry = { notFound: true, cachedAt: Date.now() };
        await bgStorageSet({ [key]: notFoundEntry });
        return { status: 'nofill', entry: notFoundEntry };
    }

    const episodeTypes = await fetchEpisodeTypesFromAnimeFillerList(fillerSlug);
    if (!episodeTypes) {
        const notFoundEntry = { notFound: true, cachedAt: Date.now() };
        await bgStorageSet({ [key]: notFoundEntry });
        return { status: 'nofill', entry: notFoundEntry };
    }

    const entry = {
        ...episodeTypes,
        cachedAt: Date.now(),
        _fillerSlug: fillerSlug || null
    };
    await bgStorageSet({ [key]: entry });
    return {
        status: 'fetched',
        entry,
        fillerCount: entry.filler?.length || 0,
        totalEpisodes: entry.totalEpisodes || null
    };
}

async function finalizeMetadataRepair(state, patch = {}) {
    const finalState = {
        ...state,
        ...patch,
        currentSlug: null,
        currentTitle: null,
        updatedAt: new Date().toISOString()
    };
    await setMetadataRepairState(finalState);
    await chrome.alarms.clear(METADATA_REPAIR_ALARM);

    // If there is a pending repair (e.g. from an anime added during this run), trigger it once this loop completes.
    setTimeout(() => {
        maybeStartPendingMetadataRepair().catch((error) => {
            console.error('[BG] Failed to trigger pending repair after finalization:', error);
        });
    }, 100);

    return finalState;
}

async function _isWatchTabOpen() {
    try {
        const tabs = await chrome.tabs.query({ url: ['https://an1me.to/watch/*', 'https://*.an1me.to/watch/*'] });
        return Array.isArray(tabs) && tabs.length > 0;
    } catch {
        return false;
    }
}

async function runMetadataRepairBatch(options = {}) {
    if (metadataRepairInProgress) return false;
    metadataRepairInProgress = true;

    try {
        let state = await getMetadataRepairState();
        if (!state || state.status !== 'running') {
            await chrome.alarms.clear(METADATA_REPAIR_ALARM);
            return false;
        }

        // Schedule an initial fallback alarm for 2 minutes to handle unexpected crashes/suspensions
        scheduleMetadataRepairFallback(2);

        while (true) {
            state = await getMetadataRepairState();
            if (!state || state.status !== 'running') {
                await chrome.alarms.clear(METADATA_REPAIR_ALARM);
                return false;
            }

            if (await _isWatchTabOpen()) {
                scheduleMetadataRepairFallback(1);
                return false;
            }

            const items = Array.isArray(state.items) ? state.items : [];
            const index = Number.isFinite(Number(state.queueIndex))
                ? Number(state.queueIndex)
                : Math.min(Number(state.processed) || 0, items.length);

            if (index >= items.length) {
                await finalizeMetadataRepair(state, {
                    status: 'completed',
                    completedAt: new Date().toISOString()
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
                    updatedAt: startedAt
                };
                await setMetadataRepairState(state);
            }

            // Extend/refresh fallback alarm every 5 items to keep background execution slice active
            if (index % 5 === 0) {
                scheduleMetadataRepairFallback(2);
            }

            let infoResult;
            let fillerResult;
            let logEntry;

            try {
                infoResult = await runMetadataRepairWithRetry(
                    () => repairAnimeInfoCache(item.slug, state.options?.forceInfoRefresh !== false)
                );
            } catch (error) {
                infoResult = { status: 'failed', error: error.message };
            }

            try {
                fillerResult = await runMetadataRepairWithRetry(
                    () => repairEpisodeTypesCache(
                        item.slug,
                        item.title || item.slug,
                        state.options?.forceFillerRefresh !== false
                    )
                );
            } catch (error) {
                fillerResult = { status: 'failed', error: error.message };
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
                updatedAt
            };

            if (nextQueueIndex >= items.length) {
                await finalizeMetadataRepair(state, {
                    status: 'completed',
                    completedAt: updatedAt
                });
                return true;
            }

            await setMetadataRepairState(state);
            await delay(isMobileUA ? 1500 : METADATA_REPAIR_INTER_ITEM_DELAY_MS);
        }
    } catch (error) {
        console.error('[BG] Library repair failed:', error);
        const state = await getMetadataRepairState();
        if (state?.status === 'running') {
            await finalizeMetadataRepair(state, {
                status: 'error',
                errorMessage: error.message || 'Unknown repair error',
                completedAt: new Date().toISOString()
            });
        } else {
            await chrome.alarms.clear(METADATA_REPAIR_ALARM).catch(() => {});
        }
        return false;
    } finally {
        metadataRepairInProgress = false;
    }
}

async function startLibraryRepair(options = {}) {
    const isTargeted = Array.isArray(options.onlySlugs) && options.onlySlugs.length > 0;

    const existing = await getMetadataRepairState();
    if (existing?.status === 'running') {
        // If already running, mark the pending flag as true so that it starts a new sweep
        // when the current one finishes, ensuring no newly added anime are missed.
        await bgStorageSet({ [PENDING_METADATA_REPAIR_KEY]: true });
        scheduleMetadataRepairFallback(1);
        runMetadataRepairBatch().catch((error) => {
            console.error('[BG] Failed to resume running repair:', error);
        });
        return existing;
    }

    // Automatic full sweeps (e.g. the catch-up fired on every sign-in / popup
    // open) are throttled so they can't re-scrape the whole library each time.
    // User-initiated sweeps (options.auto !== true) and targeted repairs bypass.
    if (options.auto === true && !isTargeted) {
        try {
            const gateRead = await bgStorageGet([META_LAST_RUN_KEY]);
            const lastRun = Number(gateRead[META_LAST_RUN_KEY]) || 0;
            if (lastRun > 0 && (Date.now() - lastRun) < META_REPAIR_GATE_MS) {
                return { status: 'throttled', throttled: true, total: 0 };
            }
        } catch {                                                       }
    }

    await bgStorageSet({ [PENDING_METADATA_REPAIR_KEY]: false });

    // Stamp the throttle as soon as a full (non-targeted) sweep commits to
    // running, so every later automatic sweep is gated against this one.
    if (!isTargeted) {
        try { await bgStorageSet({ [META_LAST_RUN_KEY]: Date.now() }); } catch {                   }
    }

    const stored = await bgStorageGet(['animeData']);
    const animeData = stored.animeData || {};
    const plan = await buildLibraryRepairPlan(animeData, options);
    const now = new Date().toISOString();

    let state = {
        status: 'running',
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
            forceFillerRefresh: plan.forceFillerRefresh
        }
    };

    if (plan.total === 0 || plan.items.length === 0) {
        state = {
            ...state,
            status: 'completed',
            completedAt: now,
            currentSlug: null,
            currentTitle: null
        };
        await setMetadataRepairState(state);
        await chrome.alarms.clear(METADATA_REPAIR_ALARM);
        return state;
    }

    await setMetadataRepairState(state);
    scheduleMetadataRepairFallback(1);
    runMetadataRepairBatch().catch((error) => {
        console.error('[BG] Failed to start library repair batch:', error);
    });
    return state;
}

// Queue a targeted repair for specific slugs (e.g. anime just added). The slugs
// are accumulated so a burst of additions coalesces into a single run, and the
// pending flag is flipped to drive maybeStartPendingMetadataRepair().
async function queueTargetedMetadataRepair(slugs) {
    const list = (Array.isArray(slugs) ? slugs : []).filter(Boolean);
    if (list.length === 0) return;

    const stored = await bgStorageGet([PENDING_REPAIR_SLUGS_KEY]);
    const existing = Array.isArray(stored[PENDING_REPAIR_SLUGS_KEY])
        ? stored[PENDING_REPAIR_SLUGS_KEY]
        : [];
    const merged = Array.from(new Set([...existing, ...list]));

    await bgStorageSet({
        [PENDING_REPAIR_SLUGS_KEY]: merged,
        [PENDING_METADATA_REPAIR_KEY]: true
    });
}

async function maybeStartPendingMetadataRepair() {
    const stored = await bgStorageGet([PENDING_METADATA_REPAIR_KEY, PENDING_REPAIR_SLUGS_KEY]);
    if (!stored[PENDING_METADATA_REPAIR_KEY]) return false;

    const targetedSlugs = Array.isArray(stored[PENDING_REPAIR_SLUGS_KEY])
        ? stored[PENDING_REPAIR_SLUGS_KEY].filter(Boolean)
        : [];
    const isTargeted = targetedSlugs.length > 0;

    const existingState = await getMetadataRepairState();
    const isRunning = existingState && existingState.status === 'running';

    // A *full* library sweep is throttled hard: never run two within the gate
    // window. (Post-update and explicit "Refresh all" are the only things that
    // should ever need one.) A *targeted* repair of just-added anime is cheap and
    // intentional, so it skips the long gate. Either way, if a run is already in
    // flight we simply let startLibraryRepair coalesce the request.
    if (!isRunning && !isTargeted) {
        try {
            const gateRead = await bgStorageGet([META_LAST_RUN_KEY]);
            const lastRun = Number(gateRead[META_LAST_RUN_KEY]) || 0;
            if (lastRun > 0 && (Date.now() - lastRun) < META_REPAIR_GATE_MS) {
                // Too soon for another full sweep — drop the request; the cache is
                // still fresh enough.
                await bgStorageSet({ [PENDING_METADATA_REPAIR_KEY]: false });
                return false;
            }
        } catch {                                                       }
    }

    await startLibraryRepair({
        forceInfoRefresh: false,
        forceFillerRefresh: false,
        onlySlugs: isTargeted ? targetedSlugs : null
    });
    // (startLibraryRepair stamps the full-sweep throttle itself when a full run
    // actually starts.)

    // Consume the queued slugs once we've actually kicked a targeted run off. If
    // a run was already in flight, startLibraryRepair only marked a follow-up, so
    // we keep the slugs queued for it.
    if (!isRunning && isTargeted) {
        try { await bgStorageSet({ [PENDING_REPAIR_SLUGS_KEY]: [] }); } catch {                   }
    }
    return true;
}

async function resumeMetadataRepairIfNeeded() {
    const state = await getMetadataRepairState();
    if (state?.status !== 'running') return;
    scheduleMetadataRepairFallback(1);
    runMetadataRepairBatch().catch((error) => {
        console.error('[BG] Failed to resume metadata repair on boot:', error);
    });
}
