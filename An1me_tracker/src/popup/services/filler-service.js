// filler-service.js — filler logic: which episodes are filler, canon counting, filler-aware progress.
const FillerService = {
  STAY_SELECTIONS_KEY: "fillerStaySelections",

  KNOWN_FILLERS: {},

  episodeTypesCache: {},

  stayedFillersCache: {},

  normalizeStayedFillers(rawSelections) {
    if (!rawSelections || typeof rawSelections !== "object") return {};

    const normalized = {};
    for (const [slug, values] of Object.entries(rawSelections)) {
      if (!slug) continue;
      const episodes = Array.isArray(values) ? values : Object.keys(values || {});
      const cleaned = [...new Set(episodes.map((ep) => Number(ep)).filter((ep) => Number.isInteger(ep) && ep > 0))].sort((a, b) => a - b);

      if (cleaned.length > 0) {
        normalized[String(slug).toLowerCase()] = cleaned;
      }
    }

    return normalized;
  },

  setStayedFillersCache(rawSelections) {
    this.stayedFillersCache = this.normalizeStayedFillers(rawSelections);
  },

  async loadStayedFillers() {
    const { Storage } = window.AnimeTracker;

    try {
      const result = await Storage.get([this.STAY_SELECTIONS_KEY]);
      this.setStayedFillersCache(result?.[this.STAY_SELECTIONS_KEY] || {});
    } catch {
      this.stayedFillersCache = {};
    }
  },

  isStayedFillerEpisode(slug, episodeNum) {
    if (!slug || !Number.isInteger(Number(episodeNum))) return false;
    const storedEpisodes = this.stayedFillersCache[String(slug).toLowerCase()] || [];
    return storedEpisodes.includes(Number(episodeNum));
  },

  getNormalizedFillerSlug(slug) {
    const lowerSlug = slug.toLowerCase();

    if (this.KNOWN_FILLERS[lowerSlug]) return lowerSlug;

    const cleanSlug = lowerSlug
      .replace(/-(?:episode|ep)-?\d+(?:-.*)?$/i, "")
      .replace(/-(?:tv|dub|sub|subbed|dubbed)$/i, "")
      .replace(/-+$/, "");

    if (this.KNOWN_FILLERS[cleanSlug]) return cleanSlug;

    return lowerSlug;
  },

  isLikelyMovie(slug, mediaType = null) {
    const cachedType = window.AnimeTracker?.AnilistService?.getMediaType?.(slug) || null;
    return !!globalThis.AnimeTrackerMergeUtils?.isLikelyMovieSlug?.(slug, mediaType || cachedType);
  },

  updateFromEpisodeTypes(animeSlug, episodeTypes) {
    const { Logger } = window.AnimeTracker;

    if (!episodeTypes) {
      Logger.error("updateFromEpisodeTypes: episodeTypes is null/undefined");
      return;
    }

    const slugVariations = new Set([animeSlug.toLowerCase()]);

    let fillerRanges = [];

    if (!episodeTypes.filler || episodeTypes.filler.length === 0) {
      Logger.info(`No fillers found for ${animeSlug}`);
    } else {
      const sortedFillers = [...episodeTypes.filler].sort((a, b) => a - b);
      let start = sortedFillers[0];
      let end = sortedFillers[0];

      for (let i = 1; i <= sortedFillers.length; i++) {
        if (i < sortedFillers.length && sortedFillers[i] === end + 1) {
          end = sortedFillers[i];
        } else {
          fillerRanges.push([start, end]);
          if (i < sortedFillers.length) {
            start = sortedFillers[i];
            end = sortedFillers[i];
          }
        }
      }
      Logger.success(`Updated KNOWN_FILLERS for ${animeSlug} (${fillerRanges.length} ranges)`);
    }

    slugVariations.forEach((slug) => {
      this.KNOWN_FILLERS[slug] = fillerRanges;
    });
  },

  async loadCachedEpisodeTypes(animeData) {
    const { Storage } = window.AnimeTracker;
    const { Logger } = window.AnimeTracker;

    try {
      this.episodeTypesCache = {};
      this.KNOWN_FILLERS = {};
      const keys = Object.keys(animeData);
      const storageKeys = keys.map((slug) => `episodeTypes_${slug}`);

      if (storageKeys.length === 0) return;

      const result = await Storage.get(storageKeys);

      for (const [key, value] of Object.entries(result)) {
        if (key.startsWith("episodeTypes_") && window.AnimeTracker.CachePolicy.isFillerUsableSnapshot(value)) {
          const slug = key.replace("episodeTypes_", "");
          this.episodeTypesCache[slug] = value;
          this.updateFromEpisodeTypes(slug, value);
        }
      }
    } catch (error) {
      Logger.error("Failed to load cached episode types:", error);
    }
  },

  isFillerEpisode(slug, episodeNum) {
    const normalizedSlug = this.getNormalizedFillerSlug(slug);
    const fillers = this.KNOWN_FILLERS[normalizedSlug];
    if (!fillers) return false;
    return fillers.some(([start, end]) => episodeNum >= start && episodeNum <= end);
  },

  countFillerEpisodes(slug, episodes) {
    const normalizedSlug = this.getNormalizedFillerSlug(slug);
    if (!episodes || !this.KNOWN_FILLERS[normalizedSlug]) return 0;
    return new Set(
      episodes
        .map((episode) => Number(episode?.number) || 0)
        .filter((number) => Number.isInteger(number) && number > 0 && this.isFillerEpisode(slug, number)),
    ).size;
  },

  getFillerInfo(slug, episodes, anime = null) {
    const normalizedSlug = this.getNormalizedFillerSlug(slug);
    const fillers = this.KNOWN_FILLERS[normalizedSlug];
    if (!fillers || fillers.length === 0) return null;

    const siteTotal = Number(this.getTotalEpisodes(slug, anime)) || Infinity;
    const fillerNumbers = new Set();
    for (const [start, end] of fillers) {
      const boundedStart = Math.max(1, Number(start) || 0);
      const boundedEnd = Math.min(siteTotal, Number(end) || 0);
      for (let episode = boundedStart; episode <= boundedEnd; episode++) fillerNumbers.add(episode);
    }
    const watchedFillers = new Set(
      (episodes || [])
        .map((episode) => Number(episode?.number) || 0)
        .filter((number) => fillerNumbers.has(number)),
    ).size;

    return { total: fillerNumbers.size, watched: watchedFillers };
  },

  getSkippedFillers(slug, episodes, currentEpisode, includeCurrent = false) {
    const normalizedSlug = this.getNormalizedFillerSlug(slug);
    const fillers = this.KNOWN_FILLERS[normalizedSlug];
    if (!fillers || fillers.length === 0) return [];

    const watchedEpisodeNumbers = new Set((episodes || []).map((ep) => ep.number));
    const skippedFillers = new Set();
    const progressBoundary = Number(currentEpisode) || 0;

    for (const [start, end] of fillers) {
      for (let ep = start; ep <= end; ep++) {
        const isWithinProgress = includeCurrent ? ep <= progressBoundary : ep < progressBoundary;
        if (isWithinProgress && !watchedEpisodeNumbers.has(ep) && !this.isStayedFillerEpisode(slug, ep)) {
          skippedFillers.add(ep);
        }
      }
    }

    return Array.from(skippedFillers).sort((a, b) => a - b);
  },

  formatSkippedFillersCompact(fillerNumbers) {
    if (!fillerNumbers || fillerNumbers.length === 0) return "";

    const ranges = [];
    let start = fillerNumbers[0];
    let end = fillerNumbers[0];

    for (let i = 1; i <= fillerNumbers.length; i++) {
      if (i < fillerNumbers.length && fillerNumbers[i] === end + 1) {
        end = fillerNumbers[i];
      } else {
        if (start === end) {
          ranges.push(String(start));
        } else if (end === start + 1) {
          ranges.push(`${start}, ${end}`);
        } else {
          ranges.push(`${start}-${end}`);
        }
        if (i < fillerNumbers.length) {
          start = fillerNumbers[i];
          end = fillerNumbers[i];
        }
      }
    }

    return ranges.join(", ");
  },

  getUnwatchedFillers(slug, episodes, totalEpisodes) {
    const normalizedSlug = this.getNormalizedFillerSlug(slug);
    const fillers = this.KNOWN_FILLERS[normalizedSlug];
    if (!fillers || fillers.length === 0) return [];

    const watchedEpisodeNumbers = new Set((episodes || []).map((ep) => ep.number));
    const unwatchedFillers = new Set();

    for (const [start, end] of fillers) {
      for (let ep = start; ep <= end && ep <= totalEpisodes; ep++) {
        if (!watchedEpisodeNumbers.has(ep)) {
          unwatchedFillers.add(ep);
        }
      }
    }

    return Array.from(unwatchedFillers).sort((a, b) => a - b);
  },

  getCanonEpisodeCount(slug, episodes) {
    if (!episodes) return 0;
    const uniqueEpisodes = Array.from(
      new Set(episodes.map((episode) => Number(episode?.number) || 0).filter((number) => Number.isInteger(number) && number > 0)),
    ).map((number) => ({ number }));
    const fillerCount = this.countFillerEpisodes(slug, uniqueEpisodes);
    return uniqueEpisodes.length - fillerCount;
  },

  getTotalCanonEpisodes(slug, totalEpisodes) {
    const normalizedSlug = this.getNormalizedFillerSlug(slug);
    const fillers = this.KNOWN_FILLERS[normalizedSlug];
    if (!fillers || fillers.length === 0) return totalEpisodes;

    const boundedFillers = new Set();
    for (const [start, end] of fillers) {
      const boundedStart = Math.max(1, Number(start) || 0);
      const boundedEnd = Math.min(totalEpisodes, Number(end) || 0);
      for (let episode = boundedStart; episode <= boundedEnd; episode++) boundedFillers.add(episode);
    }
    return Math.max(0, totalEpisodes - boundedFillers.size);
  },

  getTotalEpisodes(slug, anime = null) {
    const normalizedSlug = slug.toLowerCase();
    const anilistService = window.AnimeTracker?.AnilistService;
    const siteInfo = anilistService?.getAuthoritativeInfo?.(normalizedSlug) || null;
    const siteInfoCompatible = !siteInfo || !anime || anilistService?.isInfoCompatibleWithEntry?.(anime, siteInfo) !== false;
    const anilistTotal = siteInfoCompatible ? Number(siteInfo?.totalEpisodes) || null : null;
    const storedSiteTotalIsNewer =
      anime?.totalEpisodesSource === "an1me" &&
      Number(anime.totalEpisodes) > 0 &&
      (!siteInfo || (new Date(anime.totalEpisodesUpdatedAt || 0).getTime() || 0) > (Number(siteInfo.cachedAt) || 0));

    if (storedSiteTotalIsNewer) return Number(anime.totalEpisodes);

    if (Number.isFinite(anilistTotal) && anilistTotal > 0) {
      return anilistTotal;
    }

    if (anime?.totalEpisodesSource === "an1me" && Number(anime.totalEpisodes) > 0) {
      return Number(anime.totalEpisodes);
    }

    const candidates = [];

    if (anime && Number.isFinite(anime.totalEpisodes) && anime.totalEpisodes > 0) {
      candidates.push(anime.totalEpisodes);
    }

    const latestAvailable = siteInfoCompatible ? anilistService?.getLatestEpisode(normalizedSlug) : null;
    if (Number.isFinite(latestAvailable) && latestAvailable > 0) candidates.push(latestAvailable);

    if (anime && Array.isArray(anime.episodes)) {
      let maxTracked = 0;
      for (const ep of anime.episodes) {
        const n = Number(ep?.number) || 0;
        if (n > maxTracked) maxTracked = n;
      }
      if (maxTracked > 0) candidates.push(maxTracked);
    }

    if (candidates.length === 0) return null;
    return Math.max(...candidates);
  },

  calculateProgress(episodeCount, slug, anime = null) {
    const totalEpisodes = this.getTotalEpisodes(slug, anime);

    if (!totalEpisodes) {
      return { progress: null, total: null };
    }

    let boundedWatchedCount = Math.max(0, Number(episodeCount) || 0);
    if (anime && anime.episodes) {
      const boundedNumbers = new Set(
        anime.episodes
          .map((episode) => Number(episode?.number) || 0)
          .filter((number) => Number.isInteger(number) && number > 0 && number <= totalEpisodes),
      );
      const boundedEpisodes = Array.from(boundedNumbers, (number) => ({ number }));
      boundedWatchedCount = boundedNumbers.size;
      const canonWatched = this.getCanonEpisodeCount(slug, boundedEpisodes);
      const totalCanon = this.getTotalCanonEpisodes(slug, totalEpisodes);
      if (canonWatched >= totalCanon && totalCanon > 0) {
        return { progress: 100, total: totalEpisodes };
      }
    }

    if (boundedWatchedCount >= totalEpisodes) {
      return { progress: 100, total: totalEpisodes };
    }

    const progress = (boundedWatchedCount / totalEpisodes) * 100;
    return {
      progress: Math.min(progress, 100),
      total: totalEpisodes,
    };
  },

  hasFillerData(slug) {
    const normalizedSlug = this.getNormalizedFillerSlug(slug);
    return this.KNOWN_FILLERS[normalizedSlug] && this.KNOWN_FILLERS[normalizedSlug].length > 0;
  },
};

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.FillerService = FillerService;
