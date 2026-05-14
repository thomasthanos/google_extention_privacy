/**
 * Anime Tracker — AniSkip + MAL ID resolution (background module)
 *
 * Pulled out of background.js to keep that file focused on auth/sync
 * orchestration. Functions remain at SW global scope (classic-script
 * importScripts semantics) so existing call sites in background.js continue
 * to work unchanged.
 *
 * Storage layout:
 *   - aniSkipOutroBundle:  { "<malId>:<ep>": { outroStart, cachedAt }, ... }
 *   - malIdForSlugBundle:  { "<slug>":       { malId, cachedAt },      ... }
 *   Previously each entry lived in its own chrome.storage key (`aniSkipOutro:*`,
 *   `malIdForSlug:*`); a one-shot migration below collapses them into the
 *   bundled maps and deletes the old keys.
 */

// AniSkip: open community database of intro/outro timings, keyed by MAL ID.
// Hit serves indefinitely (timestamps don't change once submitted); a "not
// found" hit is cached for 7 days so we retry occasionally as new entries
// land.
const ANISKIP_OUTRO_KEY_PREFIX = 'aniSkipOutro:';
const ANISKIP_FOUND_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const ANISKIP_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SLUG_TO_MAL_KEY_PREFIX = 'malIdForSlug:';
const SLUG_TO_MAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ANISKIP_BUNDLE_KEY = 'aniSkipOutroBundle';
const SLUG_TO_MAL_BUNDLE_KEY = 'malIdForSlugBundle';

let _aniSkipBundle = null;
let _aniSkipBundleLoad = null;
let _slugMalBundle = null;
let _slugMalBundleLoad = null;

async function loadAniSkipBundle() {
    if (_aniSkipBundle) return _aniSkipBundle;
    if (_aniSkipBundleLoad) return _aniSkipBundleLoad;
    _aniSkipBundleLoad = (async () => {
        try {
            const stored = await bgStorageGet([ANISKIP_BUNDLE_KEY]);
            const bundle = stored?.[ANISKIP_BUNDLE_KEY];
            _aniSkipBundle = (bundle && typeof bundle === 'object' && !Array.isArray(bundle)) ? bundle : {};
        } catch {
            _aniSkipBundle = {};
        }
        return _aniSkipBundle;
    })();
    return _aniSkipBundleLoad;
}

async function loadSlugMalBundle() {
    if (_slugMalBundle) return _slugMalBundle;
    if (_slugMalBundleLoad) return _slugMalBundleLoad;
    _slugMalBundleLoad = (async () => {
        try {
            const stored = await bgStorageGet([SLUG_TO_MAL_BUNDLE_KEY]);
            const bundle = stored?.[SLUG_TO_MAL_BUNDLE_KEY];
            _slugMalBundle = (bundle && typeof bundle === 'object' && !Array.isArray(bundle)) ? bundle : {};
        } catch {
            _slugMalBundle = {};
        }
        return _slugMalBundle;
    })();
    return _slugMalBundleLoad;
}

// Debounced persist — multiple cache writes in quick succession (e.g. content
// script fetching skip times for several episodes) collapse to one storage.set.
let _aniSkipBundleDirty = false;
let _aniSkipBundleFlush = null;
function scheduleAniSkipBundleFlush() {
    _aniSkipBundleDirty = true;
    if (_aniSkipBundleFlush) return;
    _aniSkipBundleFlush = setTimeout(() => {
        _aniSkipBundleFlush = null;
        if (!_aniSkipBundleDirty || !_aniSkipBundle) return;
        _aniSkipBundleDirty = false;
        bgStorageSet({ [ANISKIP_BUNDLE_KEY]: _aniSkipBundle }).catch(() => {});
    }, 500);
}

let _slugMalBundleDirty = false;
let _slugMalBundleFlush = null;
function scheduleSlugMalBundleFlush() {
    _slugMalBundleDirty = true;
    if (_slugMalBundleFlush) return;
    _slugMalBundleFlush = setTimeout(() => {
        _slugMalBundleFlush = null;
        if (!_slugMalBundleDirty || !_slugMalBundle) return;
        _slugMalBundleDirty = false;
        bgStorageSet({ [SLUG_TO_MAL_BUNDLE_KEY]: _slugMalBundle }).catch(() => {});
    }, 500);
}

async function getMalIdForSlug(slug, title) {
    if (!slug) return null;
    const bundle = await loadSlugMalBundle();
    const cached = bundle[slug];
    if (cached && (Date.now() - (Number(cached.cachedAt) || 0)) < SLUG_TO_MAL_TTL_MS) {
        return cached.malId || null;
    }
    if (!title) return null;
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10000);
        const res = await fetch(
            `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=1`,
            { signal: ctrl.signal }
        );
        clearTimeout(timer);
        if (!res.ok) return null;
        const data = await res.json();
        const malId = data?.data?.[0]?.mal_id || null;
        bundle[slug] = { malId, cachedAt: Date.now() };
        scheduleSlugMalBundleFlush();
        return malId;
    } catch { return null; }
}

async function fetchAniSkipOutroStart(slug, title, episodeNumber, episodeLength) {
    if (!slug || !episodeNumber) return null;
    const malId = await getMalIdForSlug(slug, title);
    if (!malId) return null;

    const bundle = await loadAniSkipBundle();
    const cacheKey = `${malId}:${episodeNumber}`;
    const cached = bundle[cacheKey];
    if (cached) {
        const age = Date.now() - (Number(cached.cachedAt) || 0);
        const ttl = cached.outroStart ? ANISKIP_FOUND_TTL_MS : ANISKIP_MISS_TTL_MS;
        if (age < ttl) return cached.outroStart || null;
    }

    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const lengthParam = Number.isFinite(episodeLength) && episodeLength > 0
            ? `&episodeLength=${Math.round(episodeLength)}`
            : '';
        const res = await fetch(
            `https://api.aniskip.com/v2/skip-times/${malId}/${episodeNumber}?types[]=ed${lengthParam}`,
            { signal: ctrl.signal }
        );
        clearTimeout(timer);
        if (!res.ok) {
            bundle[cacheKey] = { outroStart: null, cachedAt: Date.now() };
            scheduleAniSkipBundleFlush();
            return null;
        }
        const data = await res.json();
        let outroStart = null;
        if (data?.found && Array.isArray(data.results)) {
            const ed = data.results.find(r => r?.skipType === 'ed' && r?.interval?.startTime > 0);
            if (ed) outroStart = Math.round(Number(ed.interval.startTime));
        }
        bundle[cacheKey] = { outroStart, cachedAt: Date.now() };
        scheduleAniSkipBundleFlush();
        return outroStart;
    } catch {
        return null;
    }
}

// One-shot migration of legacy per-key caches (`aniSkipOutro:<malId>:<ep>`,
// `malIdForSlug:<slug>`) into bundled maps. Idempotent via the flag below.
// On first SW boot post-deploy this collapses thousands of keys into two.
const PER_KEY_CACHES_MIGRATED_FLAG = '_perKeyCachesMigratedV1';
async function migratePerKeyCachesOnce() {
    try {
        const flag = await bgStorageGet([PER_KEY_CACHES_MIGRATED_FLAG]);
        if (flag?.[PER_KEY_CACHES_MIGRATED_FLAG]) return;

        const all = await new Promise((resolve, reject) => {
            chrome.storage.local.get(null, (result) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(result || {});
                }
            });
        });

        const aniSkipMap = {};
        const slugMalMap = {};
        const toDelete = [];

        for (const [key, value] of Object.entries(all)) {
            if (key.startsWith(ANISKIP_OUTRO_KEY_PREFIX)) {
                const composite = key.slice(ANISKIP_OUTRO_KEY_PREFIX.length);
                if (composite && value && typeof value === 'object') {
                    aniSkipMap[composite] = value;
                }
                toDelete.push(key);
            } else if (key.startsWith(SLUG_TO_MAL_KEY_PREFIX)) {
                const slug = key.slice(SLUG_TO_MAL_KEY_PREFIX.length);
                if (slug && value && typeof value === 'object') {
                    slugMalMap[slug] = value;
                }
                toDelete.push(key);
            }
        }

        const existing = await bgStorageGet([ANISKIP_BUNDLE_KEY, SLUG_TO_MAL_BUNDLE_KEY]);
        const mergedAniSkip = { ...(existing?.[ANISKIP_BUNDLE_KEY] || {}), ...aniSkipMap };
        const mergedSlugMal = { ...(existing?.[SLUG_TO_MAL_BUNDLE_KEY] || {}), ...slugMalMap };

        const payload = { [PER_KEY_CACHES_MIGRATED_FLAG]: true };
        if (Object.keys(aniSkipMap).length > 0) payload[ANISKIP_BUNDLE_KEY] = mergedAniSkip;
        if (Object.keys(slugMalMap).length > 0) payload[SLUG_TO_MAL_BUNDLE_KEY] = mergedSlugMal;
        await bgStorageSet(payload);

        // Refresh in-memory mirrors so subsequent calls in this SW invocation
        // see migrated data without an extra storage round-trip.
        _aniSkipBundle = mergedAniSkip;
        _slugMalBundle = mergedSlugMal;

        if (toDelete.length > 0) {
            try { await bgStorageRemove(toDelete); } catch { /* best-effort */ }
            (typeof dlog === 'function' ? dlog : () => {})(
                `[BG] Migrated ${toDelete.length} per-key cache entries → 2 bundles`
            );
        }
    } catch (e) {
        console.warn('[BG] Per-key cache migration failed:', e?.message || e);
    }
}
