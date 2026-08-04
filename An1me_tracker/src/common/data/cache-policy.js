// cache-policy.js — single source of truth for cache freshness (anime info + filler/episode-type
// caches). Pure logic, no storage access; shared by the popup (display) and the background
// orchestrator (library sync) so freshness is decided in exactly one place.
(function () {
  "use strict";

  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  const INFO_TTL = 24 * HOUR;
  const INFO_AIRING_RECHECK = 6 * HOUR;
  const EPISODE_TYPES_TTL = 24 * HOUR;
  const FILLER_FINISHED_TTL = 7 * DAY;
  const NOT_FOUND_TTL = 3 * DAY;
  const RETRYABLE_TTL = 15 * MINUTE;
  const INFO_SCHEMA_VERSION = 4;
  const EPISODE_TYPES_SCHEMA_VERSION = 3;

  function toMs(value) {
    if (!value) return NaN;
    const t = typeof value === "number" ? value : new Date(value).getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  function infoRefreshAt(info) {
    const at = toMs(info?.retryable ? info?.retryAt || info?.cachedAt : info?.cachedAt);
    if (!Number.isFinite(at)) return 0;
    if (info.notFound) return at + NOT_FOUND_TTL;
    if (info.retryable) return at + RETRYABLE_TTL;
    if (info.status === "RELEASING") {
      const nextMs = toMs(info.nextEpisodeAt);
      if (Number.isFinite(nextMs) && nextMs > at) return Math.min(nextMs, at + INFO_TTL);
      return at + INFO_AIRING_RECHECK;
    }
    return at + INFO_TTL;
  }

  function isInfoFresh(info) {
    if (!info || !(info.cachedAt || info.retryAt)) return false;
    if (info.retryable) return Date.now() < infoRefreshAt(info);
    if (Number(info.schemaVersion || 0) < INFO_SCHEMA_VERSION) return false;
    return Date.now() < infoRefreshAt(info);
  }

  function isInfoAuthoritative(info) {
    return !!(
      info &&
      Number.isFinite(toMs(info.cachedAt)) &&
      !info.notFound &&
      !info.retryable &&
      !info.error &&
      Number(info.schemaVersion || 0) >= INFO_SCHEMA_VERSION
    );
  }

  function isInfoUsableSnapshot(info) {
    return !!(
      info &&
      Number.isFinite(toMs(info.cachedAt)) &&
      !info.notFound &&
      Number(info.schemaVersion || 0) >= INFO_SCHEMA_VERSION
    );
  }

  function fillerRefreshAt(filler, info) {
    // Retryable backoff entries keep their original cachedAt (prior data stays valid);
    // the backoff window is measured from retryAt, mirroring infoRefreshAt.
    const at = toMs(filler?.retryable ? filler?.retryAt || filler?.cachedAt : filler?.cachedAt) || 0;
    if (!at) return 0;
    if (filler.notFound) return at + NOT_FOUND_TTL;
    if (filler.retryable) return at + RETRYABLE_TTL;
    if (info && info.status === "RELEASING") return at + EPISODE_TYPES_TTL;
    return at + FILLER_FINISHED_TTL;
  }

  function isFillerFresh(filler, info) {
    if (!filler || !filler.cachedAt) return false;
    if (Number(filler.schemaVersion || 0) < EPISODE_TYPES_SCHEMA_VERSION) return false;
    return Date.now() < fillerRefreshAt(filler, info);
  }

  function isFillerUsableSnapshot(filler) {
    // A retryable backoff entry that still carries episode arrays is prior valid data —
    // keep it usable; pure-error backoff entries have no arrays and are rejected below.
    return !!(
      filler &&
      Number.isFinite(toMs(filler.cachedAt)) &&
      Number(filler.schemaVersion || 0) >= EPISODE_TYPES_SCHEMA_VERSION &&
      !filler.notFound &&
      !filler.error &&
      (Array.isArray(filler.filler) || Array.isArray(filler.canon))
    );
  }

  // Splits the animeinfo_/episodeTypes_ keys of a full storage snapshot into expired keys
  // (safe to delete anytime) and fresh keys ordered oldest-first (delete only under real
  // quota pressure — wiping fresh entries forces a full library re-fetch).
  function partitionMetadataCacheKeys(all) {
    const staleKeys = [];
    const fresh = [];
    for (const [key, value] of Object.entries(all || {})) {
      let freshNow;
      if (key.startsWith("animeinfo_")) {
        freshNow = isInfoFresh(value);
      } else if (key.startsWith("episodeTypes_")) {
        const slug = key.slice("episodeTypes_".length);
        freshNow = isFillerFresh(value, all[`animeinfo_${slug}`]);
      } else {
        continue;
      }
      if (freshNow) fresh.push({ key, cachedAt: Number(value?.cachedAt) || 0 });
      else staleKeys.push(key);
    }
    fresh.sort((a, b) => a.cachedAt - b.cachedAt);
    return { staleKeys, freshKeysOldestFirst: fresh.map((f) => f.key) };
  }

  const root = typeof globalThis !== "undefined" ? globalThis : self;
  const exports = {
    INFO_TTL,
    INFO_AIRING_RECHECK,
    EPISODE_TYPES_TTL,
    FILLER_FINISHED_TTL,
    NOT_FOUND_TTL,
    RETRYABLE_TTL,
    INFO_SCHEMA_VERSION,
    EPISODE_TYPES_SCHEMA_VERSION,
    infoRefreshAt,
    isInfoFresh,
    isInfoAuthoritative,
    isInfoUsableSnapshot,
    fillerRefreshAt,
    isFillerFresh,
    isFillerUsableSnapshot,
    partitionMetadataCacheKeys,
  };
  root.AnimeTrackerCachePolicy = exports;

  if (typeof window !== "undefined") {
    const AT = (window.AnimeTracker = window.AnimeTracker || {});
    AT.CachePolicy = exports;
  }
})();
