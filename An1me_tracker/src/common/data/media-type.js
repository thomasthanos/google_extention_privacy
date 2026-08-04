(function (root) {
  "use strict";

  const TYPES = Object.freeze({
    TV: "TV",
    TV_SHORT: "TV_SHORT",
    MOVIE: "MOVIE",
    OVA: "OVA",
    ONA: "ONA",
    SPECIAL: "SPECIAL",
    MUSIC: "MUSIC",
  });

  const LABELS = Object.freeze({
    TV: "TV",
    TV_SHORT: "TV Short",
    MOVIE: "Movie",
    OVA: "OVA",
    ONA: "ONA",
    SPECIAL: "Special",
    MUSIC: "Music",
  });

  function normalize(value) {
    const input = String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[./-]+/g, "_")
      .replace(/\s+/g, "_");
    if (!input || input === "N_A" || input === "NA" || input === "UNKNOWN") return null;
    if (["MOVIE", "FILM", "THEATRICAL"].includes(input)) return TYPES.MOVIE;
    if (["TV", "TELEVISION", "TV_SERIES", "SERIES"].includes(input)) return TYPES.TV;
    if (["TV_SHORT", "SHORT_TV", "TV_SHORTS"].includes(input)) return TYPES.TV_SHORT;
    if (["OVA", "OAV"].includes(input)) return TYPES.OVA;
    if (["ONA", "WEB", "WEB_ANIME"].includes(input)) return TYPES.ONA;
    if (["SPECIAL", "SPECIALS", "RECAP", "SP", "TV_SPECIAL", "SPECIAL_TV", "TV_SP"].includes(input)) return TYPES.SPECIAL;
    if (["MUSIC", "MUSIC_VIDEO", "MV", "PV"].includes(input)) return TYPES.MUSIC;
    return null;
  }

  function infer(slug, title = "") {
    const text = `${String(slug || "").toLowerCase()} ${String(title || "").toLowerCase()}`.replace(/[^a-z0-9]+/g, " ");
    if (/\b(?:ova|oav)\b/i.test(text)) return TYPES.OVA;
    if (/\bona\b/i.test(text)) return TYPES.ONA;
    if (/\b(?:specials?|recap)\b|\bfan\s+letter\b/i.test(text)) {
      return TYPES.SPECIAL;
    }
    if (/\b(?:music\s+video|mv|pv)\b/i.test(text)) return TYPES.MUSIC;
    if (/\b(?:movie|film|gekijouban)\b|\bthe\s+movie\b/i.test(text)) return TYPES.MOVIE;
    return null;
  }

  function resolve(slug, anime = null, cachedInfo = null) {
    const storedType = normalize(anime?.mediaType);
    const cachePolicy = globalThis.AnimeTrackerCachePolicy;
    const cacheUsable = cachedInfo && (cachePolicy?.isInfoAuthoritative ? cachePolicy.isInfoAuthoritative(cachedInfo) : !cachedInfo.retryable && !cachedInfo.error && !cachedInfo.notFound);
    const cachedType = cacheUsable ? normalize(cachedInfo?.mediaType) : null;
    const storedAt = anime?.mediaTypeUpdatedAt ? new Date(anime.mediaTypeUpdatedAt).getTime() : 0;
    const cachedAt = Number(cachedInfo?.cachedAt) || 0;
    if (storedType && anime?.mediaTypeSource === "an1me" && storedAt > cachedAt) return storedType;
    if (cachedType) return cachedType;
    return storedType || cachedType || infer(slug, anime?.title || (cacheUsable ? cachedInfo?.title : "") || "");
  }

  function isMovie(value) {
    return normalize(value) === TYPES.MOVIE;
  }

  function isEpisodic(value) {
    const type = normalize(value);
    return type !== null && type !== TYPES.MOVIE && type !== TYPES.MUSIC;
  }

  function isSupplement(value) {
    const type = normalize(value);
    return type === TYPES.OVA || type === TYPES.ONA || type === TYPES.SPECIAL || type === TYPES.MUSIC;
  }

  function getLabel(value) {
    const type = normalize(value);
    return type ? LABELS[type] : null;
  }

  root.AnimeTrackerMediaType = { TYPES, normalize, infer, resolve, isMovie, isEpisodic, isSupplement, getLabel };
})(typeof globalThis !== "undefined" ? globalThis : self);
