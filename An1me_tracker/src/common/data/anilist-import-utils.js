(function (root) {
  "use strict";

  function isTrustedMapEntry(entry, resolverVersion) {
    if (!entry || !Number(entry.mediaId)) return false;
    return entry.source === "anilistImport" || Number(entry.resolverV || 0) >= Number(resolverVersion || 0);
  }

  function hasTrustedConflict(entry, mediaId, resolverVersion) {
    const targetId = Number(mediaId) || 0;
    return !!(targetId && isTrustedMapEntry(entry, resolverVersion) && Number(entry.mediaId) !== targetId);
  }

  function findSlugByMediaId(animeData, mediaMap, mediaId, resolverVersion) {
    const targetId = Number(mediaId) || 0;
    if (!targetId) return null;
    for (const [slug, mapEntry] of Object.entries(mediaMap || {})) {
      if (!animeData?.[slug] || !isTrustedMapEntry(mapEntry, resolverVersion)) continue;
      if (Number(mapEntry.mediaId) === targetId) return slug;
    }
    return null;
  }

  function allocateImportSlug(baseSlug, seasonYear, mediaId, animeData, mediaMap, resolverVersion) {
    const targetId = Number(mediaId) || 0;
    const suffixes = [];
    if (Number(seasonYear) > 0) suffixes.push(String(Math.floor(Number(seasonYear))));
    suffixes.push(`anilist-${targetId || "entry"}`);

    for (const suffix of suffixes) {
      const slug = `${baseSlug}-${suffix}`;
      if (!animeData?.[slug]) return { slug, existingSlug: null };
      if (
        targetId &&
        Number(mediaMap?.[slug]?.mediaId) === targetId &&
        isTrustedMapEntry(mediaMap[slug], resolverVersion)
      )
        return { slug, existingSlug: slug };
    }

    const prefix = `${baseSlug}-anilist-${targetId || "entry"}`;
    let counter = 2;
    while (animeData?.[`${prefix}-${counter}`]) {
      const occupiedSlug = `${prefix}-${counter}`;
      if (
        targetId &&
        Number(mediaMap?.[occupiedSlug]?.mediaId) === targetId &&
        isTrustedMapEntry(mediaMap[occupiedSlug], resolverVersion)
      ) {
        return { slug: occupiedSlug, existingSlug: occupiedSlug };
      }
      counter++;
    }
    return { slug: `${prefix}-${counter}`, existingSlug: null };
  }

  root.AnimeTrackerAniListImportUtils = {
    isTrustedMapEntry,
    hasTrustedConflict,
    findSlugByMediaId,
    allocateImportSlug,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
