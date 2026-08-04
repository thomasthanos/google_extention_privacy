// anime-resolver.js — shared background resolver for metadata and episode types.
(function () {
"use strict";

const animeResolverInflight = new Map();

function normalizeAnimeResolverSlug(value) {
  const input = String(value || "").trim().toLowerCase();
  const pathMatch = input.match(/^https?:\/\/[^/]+\/(?:anime|watch)\/([^/?#]+)/i);
  const candidate = pathMatch?.[1] || input;
  return candidate
    .replace(/-episode-\d+(?:-.*)?$/i, "")
    .replace(/[/?#].*$/, "")
    .replace(/^\/+|\/+$/g, "");
}

function buildAnimeResolverRequestKey(slug, options) {
  return [
    slug,
    options.includeEpisodeTypes === false ? "info" : "full",
    options.forceInfoRefresh === true ? "force-info" : "cached-info",
    options.forceFillerRefresh === true ? "force-filler" : "cached-filler",
    String(options.title || "").trim().toLowerCase(),
    String(options.mediaType || "").trim().toUpperCase(),
  ].join("|");
}

async function readRetainedAnimeResolverEntry(key, predicate) {
  try {
    const stored = await bgStorageGet([key]);
    const entry = stored[key] || null;
    return predicate(entry) ? entry : null;
  } catch {
    return null;
  }
}

async function resolveAnimeMetadataUncoalesced(slug, options = {}) {
  const title = String(options.title || slug).trim() || slug;
  let infoResult;
  let fillerResult = null;
  const errors = [];

  try {
    infoResult = await runMetadataRepairWithRetry(
      () => repairAnimeInfoCache(slug, options.forceInfoRefresh === true),
      { attempts: options.attempts },
    );
  } catch (error) {
    const retained = await readRetainedAnimeResolverEntry(
      `animeinfo_${slug}`,
      (entry) => self.AnimeTrackerCachePolicy.isInfoUsableSnapshot(entry),
    );
    infoResult = { status: "failed", entry: retained, error: error?.message || String(error) };
    errors.push({ phase: "info", message: infoResult.error });
  }

  const infoEntry = infoResult?.entry || null;
  const resolvedMediaType =
    globalThis.AnimeTrackerMediaType?.resolve(
      slug,
      { title, mediaType: options.mediaType || null, mediaTypeUpdatedAt: options.mediaTypeUpdatedAt || null },
      infoEntry,
    ) || options.mediaType || infoEntry?.mediaType || null;

  if (options.includeEpisodeTypes !== false) {
    try {
      fillerResult = await runMetadataRepairWithRetry(
        () =>
          repairEpisodeTypesCache(
            slug,
            title,
            options.forceFillerRefresh === true,
            resolvedMediaType,
            options.mediaTypeUpdatedAt || null,
          ),
        { attempts: options.attempts },
      );
    } catch (error) {
      const retained = await readRetainedAnimeResolverEntry(
        `episodeTypes_${slug}`,
        (entry) => self.AnimeTrackerCachePolicy.isFillerUsableSnapshot(entry),
      );
      fillerResult = { status: "failed", entry: retained, error: error?.message || String(error) };
      errors.push({ phase: "episodeTypes", message: fillerResult.error });
    }
  }

  const usableInfo = self.AnimeTrackerCachePolicy.isInfoUsableSnapshot(infoResult?.entry) ? infoResult.entry : null;
  const episodeTypesEntry = fillerResult?.entry || null;
  const usableEpisodeTypes =
    episodeTypesEntry?.notFound || self.AnimeTrackerCachePolicy.isFillerUsableSnapshot(episodeTypesEntry)
      ? episodeTypesEntry
      : null;

  return {
    info: usableInfo,
    episodeTypes: usableEpisodeTypes,
    infoResult,
    fillerResult,
    errors,
  };
}

function resolveAnimeMetadata(rawSlug, options = {}) {
  const slug = normalizeAnimeResolverSlug(rawSlug);
  if (!slug) return Promise.reject(new Error("Missing slug"));

  const normalizedOptions = {
    ...options,
    includeEpisodeTypes: options.includeEpisodeTypes !== false,
    forceInfoRefresh: options.forceInfoRefresh === true,
    forceFillerRefresh: options.forceFillerRefresh === true,
  };
  const requestKey = buildAnimeResolverRequestKey(slug, normalizedOptions);
  const existing = animeResolverInflight.get(requestKey);
  if (existing) return existing;

  const request = resolveAnimeMetadataUncoalesced(slug, normalizedOptions);
  animeResolverInflight.set(requestKey, request);
  const clear = () => {
    if (animeResolverInflight.get(requestKey) === request) animeResolverInflight.delete(requestKey);
  };
  request.then(clear, clear);
  return request;
}

self.AnimeTrackerAnimeResolver = Object.freeze({
  resolve: resolveAnimeMetadata,
});
})();
