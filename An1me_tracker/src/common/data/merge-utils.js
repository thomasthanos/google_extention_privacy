// merge-utils.js — lossless merge of local vs cloud data (anime, progress,
// deleted tombstones, cover images), dedupe, and placeholder-duration repair.
(function () {
  "use strict";

  const PLACEHOLDER_DURATION_VALUES = Object.freeze([1440, 6000, 7200]);
  const PLACEHOLDER_DURATION_SET = new Set(PLACEHOLDER_DURATION_VALUES);

  function isPlaceholderDuration(duration) {
    const d = Number(duration) || 0;
    if (d <= 0) return true;
    return PLACEHOLDER_DURATION_SET.has(d);
  }

  function toMillis(value) {
    if (!value) return 0;
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) ? ts : 0;
  }

  function pickLatestIso(a, b) {
    const aTs = toMillis(a);
    const bTs = toMillis(b);
    if (!aTs && !bTs) return null;
    return bTs > aTs ? b : a;
  }

  function getSafeString(value) {
    return typeof value === "string" ? value : "";
  }

  function getSafeNumber(value) {
    return Number.isFinite(value) ? value : 0;
  }

  function compareStableValues(a, b) {
    const left = String(stableStringify(a ?? null));
    const right = String(stableStringify(b ?? null));
    if (left === right) return 0;
    return left < right ? -1 : 1;
  }

  function pickDeterministicValue(a, b, project = (value) => value) {
    if (a == null) return b;
    if (b == null) return a;
    return compareStableValues(project(a), project(b)) <= 0 ? a : b;
  }

  function metadataSourceRank(source) {
    const value = getSafeString(source).trim().toLowerCase();
    if (value === "an1me" || value === "site" || value === "live") return 3;
    if (value === "manual") return 2;
    if (value === "anilist") return 1;
    return 0;
  }

  function getExplicitListState(anime) {
    const state = anime?.listState;
    return state === "completed" || state === "dropped" || state === "active" || state === "on_hold" ? state : null;
  }

  function getResolvedListState(anime) {
    const sharedResolver = globalThis.AnimeTrackerEntryState?.getResolvedListState;
    if (typeof sharedResolver === "function") return sharedResolver(anime);
    const explicitState = getExplicitListState(anime);
    if (explicitState) return explicitState;
    const completedAt = toMillis(anime?.completedAt);
    const droppedAt = toMillis(anime?.droppedAt);
    const onHoldAt = toMillis(anime?.onHoldAt);
    const latestStateTs = Math.max(completedAt, droppedAt, onHoldAt);

    if (!latestStateTs) return "active";
    if (onHoldAt === latestStateTs) return "on_hold";
    return droppedAt === latestStateTs ? "dropped" : "completed";
  }

  function getAnimeActivityTimestamp(anime) {
    if (!anime || typeof anime !== "object") return 0;

    let latest = Math.max(
      toMillis(anime.lastWatched),
      toMillis(anime.listStateUpdatedAt),
      toMillis(anime.titleUpdatedAt),
      toMillis(anime.completedAt),
      toMillis(anime.droppedAt),
      toMillis(anime.onHoldAt),
    );

    for (const episode of Array.isArray(anime.episodes) ? anime.episodes : []) {
      latest = Math.max(latest, toMillis(episode?.watchedAt));
    }

    return latest;
  }

  function getTitleSelection(localAnime, cloudAnime, slug) {
    const localTitle = getSafeString(localAnime?.title).trim();
    const cloudTitle = getSafeString(cloudAnime?.title).trim();
    const localTitleTs = toMillis(localAnime?.titleUpdatedAt);
    const cloudTitleTs = toMillis(cloudAnime?.titleUpdatedAt);

    let title = localTitle || cloudTitle || slug;
    let titleUpdatedAt = null;

    if (localTitleTs || cloudTitleTs) {
      if (cloudTitleTs > localTitleTs) {
        title = cloudTitle || localTitle || slug;
        titleUpdatedAt = cloudAnime?.titleUpdatedAt || null;
      } else if (localTitleTs > cloudTitleTs) {
        title = localTitle || cloudTitle || slug;
        titleUpdatedAt = localAnime?.titleUpdatedAt || null;
      } else {
        const selected = pickDeterministicValue(localAnime, cloudAnime, (anime) => ({
          title: getSafeString(anime?.title).trim(),
          titleUpdatedAt: anime?.titleUpdatedAt || null,
        }));
        title = getSafeString(selected?.title).trim() || localTitle || cloudTitle || slug;
        titleUpdatedAt = selected?.titleUpdatedAt || null;
      }
    } else if (localTitle && cloudTitle && localTitle !== cloudTitle) {
      title = pickDeterministicValue(localTitle, cloudTitle);
    } else if (!localTitle && cloudTitle) {
      title = cloudTitle;
    }

    return { title, titleUpdatedAt };
  }

  function applyMergedListState(target, localAnime, cloudAnime) {
    const stateTimestamp = globalThis.AnimeTrackerEntryState?.getResolvedListStateTimestamp;
    const localListTs =
      typeof stateTimestamp === "function"
        ? stateTimestamp(localAnime)
        : Math.max(
            toMillis(localAnime?.listStateUpdatedAt),
            toMillis(localAnime?.completedAt),
            toMillis(localAnime?.droppedAt),
            toMillis(localAnime?.onHoldAt),
          );
    const cloudListTs =
      typeof stateTimestamp === "function"
        ? stateTimestamp(cloudAnime)
        : Math.max(
            toMillis(cloudAnime?.listStateUpdatedAt),
            toMillis(cloudAnime?.completedAt),
            toMillis(cloudAnime?.droppedAt),
            toMillis(cloudAnime?.onHoldAt),
          );

    delete target.completedAt;
    delete target.droppedAt;
    delete target.onHoldAt;
    delete target.listState;
    delete target.listStateUpdatedAt;
    delete target.completionSource;
    delete target.manualComplete;

    if (localListTs || cloudListTs) {
      const sourceAnime =
        cloudListTs > localListTs
          ? cloudAnime
          : localListTs > cloudListTs
            ? localAnime
            : pickDeterministicValue(localAnime, cloudAnime, (anime) => ({
                state: getResolvedListState(anime),
                updatedAt: anime?.listStateUpdatedAt || null,
                completedAt: anime?.completedAt || null,
                droppedAt: anime?.droppedAt || null,
                onHoldAt: anime?.onHoldAt || null,
                completionSource: anime?.completionSource || null,
                manualComplete: anime?.manualComplete === true,
              }));
      const state = getResolvedListState(sourceAnime);
      const stateMarker =
        state === "completed"
          ? sourceAnime?.completedAt
          : state === "dropped"
            ? sourceAnime?.droppedAt
            : state === "on_hold"
              ? sourceAnime?.onHoldAt
              : null;
      const updatedAt =
        pickLatestIso(sourceAnime?.listStateUpdatedAt, stateMarker) ||
        pickLatestIso(localAnime?.listStateUpdatedAt, cloudAnime?.listStateUpdatedAt);

      if (state === "completed") {
        target.completedAt = sourceAnime?.completedAt || pickLatestIso(localAnime?.completedAt, cloudAnime?.completedAt);
        if (sourceAnime?.completionSource) target.completionSource = sourceAnime.completionSource;
        if (sourceAnime?.manualComplete === true) target.manualComplete = true;
      } else if (state === "dropped") {
        target.droppedAt = sourceAnime?.droppedAt || pickLatestIso(localAnime?.droppedAt, cloudAnime?.droppedAt);
      } else if (state === "on_hold") {
        target.onHoldAt = sourceAnime?.onHoldAt || pickLatestIso(localAnime?.onHoldAt, cloudAnime?.onHoldAt) || updatedAt || null;
      }

      target.listState = state;
      if (updatedAt) target.listStateUpdatedAt = updatedAt;
      return;
    }

    const completedAt = pickLatestIso(localAnime?.completedAt, cloudAnime?.completedAt);
    const droppedAt = pickLatestIso(localAnime?.droppedAt, cloudAnime?.droppedAt);
    const onHoldAt = pickLatestIso(localAnime?.onHoldAt, cloudAnime?.onHoldAt);
    const completedTs = toMillis(completedAt);
    const droppedTs = toMillis(droppedAt);
    const onHoldTs = toMillis(onHoldAt);

    if (!completedTs && !droppedTs && !onHoldTs) return;
    if (onHoldTs >= droppedTs && onHoldTs >= completedTs) {
      target.onHoldAt = onHoldAt;
      target.listState = "on_hold";
      if (onHoldAt) target.listStateUpdatedAt = onHoldAt;
      return;
    }
    if (droppedTs > completedTs) {
      target.droppedAt = droppedAt;
      target.listState = "dropped";
      if (droppedAt) target.listStateUpdatedAt = droppedAt;
      return;
    }
    target.completedAt = completedAt;
    target.listState = "completed";
    if (completedAt) target.listStateUpdatedAt = completedAt;
    const completionAnime = toMillis(cloudAnime?.completedAt) > toMillis(localAnime?.completedAt) ? cloudAnime : localAnime;
    if (completionAnime?.completionSource) target.completionSource = completionAnime.completionSource;
    if (completionAnime?.manualComplete === true) target.manualComplete = true;
  }

  function applyMergedFavorite(target, localAnime, cloudAnime) {
    const hasSignal = [localAnime, cloudAnime].some(
      (anime) =>
        anime &&
        (Object.prototype.hasOwnProperty.call(anime, "favorite") || anime.favoriteUpdatedAt || anime.favoritedAt),
    );
    if (!hasSignal) return;

    const localTs = Math.max(toMillis(localAnime?.favoriteUpdatedAt), toMillis(localAnime?.favoritedAt));
    const cloudTs = Math.max(toMillis(cloudAnime?.favoriteUpdatedAt), toMillis(cloudAnime?.favoritedAt));
    const sourceAnime =
      cloudTs > localTs
        ? cloudAnime
        : localTs > cloudTs
          ? localAnime
          : pickDeterministicValue(localAnime, cloudAnime, (anime) => ({
              favorite: anime?.favorite === true,
              favoritedAt: anime?.favoritedAt || null,
              favoriteUpdatedAt: anime?.favoriteUpdatedAt || null,
            }));

    target.favorite = sourceAnime?.favorite === true;
    target.favoritedAt = target.favorite ? sourceAnime?.favoritedAt || null : null;
    if (sourceAnime?.favoriteUpdatedAt) target.favoriteUpdatedAt = sourceAnime.favoriteUpdatedAt;
    else delete target.favoriteUpdatedAt;
  }

  function areEpisodesEqual(aEpisodes, bEpisodes) {
    const left = Array.isArray(aEpisodes) ? aEpisodes : [];
    const right = Array.isArray(bEpisodes) ? bEpisodes : [];
    if (left.length !== right.length) return false;

    for (let i = 0; i < left.length; i++) {
      const a = left[i] || {};
      const b = right[i] || {};
      if (getSafeNumber(Number(a.number)) !== getSafeNumber(Number(b.number))) return false;
      if (getSafeString(a.watchedAt) !== getSafeString(b.watchedAt)) return false;
      if (getSafeNumber(Number(a.duration)) !== getSafeNumber(Number(b.duration))) return false;
      // Missing durationSource == "video" (the unstored default); normalise both sides so it doesn't read as a change.
      if ((a.durationSource || "video") !== (b.durationSource || "video")) return false;
    }

    return true;
  }

  const COMPARED_ANIME_KEYS = new Set([
    "title",
    "titleUpdatedAt",
    "coverImage",
    "lastWatched",
    "completedAt",
    "droppedAt",
    "onHoldAt",
    "listState",
    "listStateUpdatedAt",
    "totalEpisodes",
    "totalEpisodesUpdatedAt",
    "totalEpisodesSource",
    "mediaType",
    "mediaTypeUpdatedAt",
    "mediaTypeSource",
    "releaseStatus",
    "releaseStatusUpdatedAt",
    "releaseStatusSource",
    "completionSource",
    "manualComplete",
    "totalWatchTime",
    "episodes",
    "favorite",
    "favoritedAt",
    "favoriteUpdatedAt",
    "siteAnimeId",
    "slug",
    "nextEpisodeAt",
    "nextEpisodeTimezone",
  ]);

  function areAnimeEntriesEqual(aAnime, bAnime) {
    const a = aAnime || {};
    const b = bAnime || {};

    if (getSafeString(a.title) !== getSafeString(b.title)) return false;
    if (getSafeString(a.titleUpdatedAt) !== getSafeString(b.titleUpdatedAt)) return false;
    if (getSafeString(a.coverImage) !== getSafeString(b.coverImage)) return false;
    if (getSafeString(a.lastWatched) !== getSafeString(b.lastWatched)) return false;
    if (getSafeString(a.completedAt) !== getSafeString(b.completedAt)) return false;
    if (getSafeString(a.droppedAt) !== getSafeString(b.droppedAt)) return false;
    if (getSafeString(a.onHoldAt) !== getSafeString(b.onHoldAt)) return false;
    if (getSafeString(a.listState) !== getSafeString(b.listState)) return false;
    if (getSafeString(a.listStateUpdatedAt) !== getSafeString(b.listStateUpdatedAt)) return false;
    if (getSafeNumber(Number(a.totalEpisodes)) !== getSafeNumber(Number(b.totalEpisodes))) return false;
    if (getSafeString(a.totalEpisodesUpdatedAt) !== getSafeString(b.totalEpisodesUpdatedAt)) return false;
    if (getSafeString(a.totalEpisodesSource) !== getSafeString(b.totalEpisodesSource)) return false;
    if (getSafeString(a.mediaType) !== getSafeString(b.mediaType)) return false;
    if (getSafeString(a.mediaTypeUpdatedAt) !== getSafeString(b.mediaTypeUpdatedAt)) return false;
    if (getSafeString(a.mediaTypeSource) !== getSafeString(b.mediaTypeSource)) return false;
    if (getSafeString(a.releaseStatus) !== getSafeString(b.releaseStatus)) return false;
    if (getSafeString(a.releaseStatusUpdatedAt) !== getSafeString(b.releaseStatusUpdatedAt)) return false;
    if (getSafeString(a.releaseStatusSource) !== getSafeString(b.releaseStatusSource)) return false;
    if (getSafeString(a.completionSource) !== getSafeString(b.completionSource)) return false;
    if (!!a.manualComplete !== !!b.manualComplete) return false;
    if (getSafeNumber(Number(a.totalWatchTime)) !== getSafeNumber(Number(b.totalWatchTime))) return false;
    if (!!a.favorite !== !!b.favorite) return false;
    if (getSafeString(a.favoritedAt) !== getSafeString(b.favoritedAt)) return false;
    if (getSafeString(a.favoriteUpdatedAt) !== getSafeString(b.favoriteUpdatedAt)) return false;
    if (getSafeNumber(Number(a.siteAnimeId)) !== getSafeNumber(Number(b.siteAnimeId))) return false;
    if (getSafeString(a.slug) !== getSafeString(b.slug)) return false;
    if (getSafeString(a.nextEpisodeAt) !== getSafeString(b.nextEpisodeAt)) return false;
    if (getSafeString(a.nextEpisodeTimezone) !== getSafeString(b.nextEpisodeTimezone)) return false;
    if (!areEpisodesEqual(a.episodes, b.episodes)) return false;

    for (const key of Object.keys(a)) {
      if (COMPARED_ANIME_KEYS.has(key)) continue;
      if (stableStringify(a[key] ?? null) !== stableStringify(b[key] ?? null)) return false;
    }
    for (const key of Object.keys(b)) {
      if (COMPARED_ANIME_KEYS.has(key)) continue;
      if (!Object.prototype.hasOwnProperty.call(a, key)) return false;
    }

    return true;
  }

  function areAnimeDataMapsEqual(aData, bData) {
    if (aData === bData) return true;
    const a = aData || {};
    const b = bData || {};
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);

    if (aKeys.length !== bKeys.length) return false;

    for (const slug of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, slug)) return false;
      if (!areAnimeEntriesEqual(a[slug], b[slug])) return false;
    }

    return true;
  }

  function areProgressMapsEqual(aProgress, bProgress) {
    if (aProgress === bProgress) return true;
    const a = aProgress || {};
    const b = bProgress || {};
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);

    if (aKeys.length !== bKeys.length) return false;

    for (const id of aKeys) {
      const ap = a[id];
      const bp = b[id];
      if (!bp) return false;

      if (getSafeNumber(Number(ap?.currentTime)) !== getSafeNumber(Number(bp?.currentTime))) return false;
      if (getSafeNumber(Number(ap?.duration)) !== getSafeNumber(Number(bp?.duration))) return false;
      if (getSafeNumber(Number(ap?.percentage)) !== getSafeNumber(Number(bp?.percentage))) return false;
      if (!!ap?.deleted !== !!bp?.deleted) return false;
      if (getSafeString(ap?.savedAt) !== getSafeString(bp?.savedAt)) return false;
      if (getSafeString(ap?.deletedAt) !== getSafeString(bp?.deletedAt)) return false;
    }

    return true;
  }

  function shallowEqualDeletedAnime(aDeleted, bDeleted) {
    if (aDeleted === bDeleted) return true;
    const a = aDeleted || {};
    const b = bDeleted || {};
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);

    if (aKeys.length !== bKeys.length) return false;

    for (const slug of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, slug)) return false;
      if (getSafeString(a[slug]?.deletedAt) !== getSafeString(b[slug]?.deletedAt)) return false;
    }

    return true;
  }

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
  }

  function shallowEqualObjectMap(aMap, bMap) {
    const a = aMap || {};
    const b = bMap || {};
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);

    if (aKeys.length !== bKeys.length) return false;

    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (stableStringify(a[key] ?? null) !== stableStringify(b[key] ?? null)) return false;
    }

    return true;
  }

  const MOVIE_PATTERNS = [
    /-movie(-|$)/i,
    /-film(-|$)/i,
    /-gekijouban/i,
    /-the-movie/i,
    /^.*-movie-\d+/i,
    /-3d-/i,
  ];

  function isLikelyMovieSlug(slug, mediaType = null) {
    const normalizedType = globalThis.AnimeTrackerMediaType?.normalize(mediaType) || getSafeString(mediaType).trim().toUpperCase() || null;
    if (normalizedType) return normalizedType === "MOVIE";
    const value = getSafeString(slug);
    if (!value) return false;
    return MOVIE_PATTERNS.some((pattern) => pattern.test(value));
  }

  // The site-scraped canonical title replaces parser/slug-derived names,
  // but a manual rename (titleUpdatedAt) always wins.
  function pickRepairedTitle(entry, siteTitle) {
    if (!entry || typeof entry !== "object") return null;
    if (entry.titleUpdatedAt) return null;
    const next = getSafeString(siteTitle).replace(/\s+/g, " ").trim();
    if (!next || next.length < 2 || next.length > 300) return null;
    const current = getSafeString(entry.title).trim();
    if (next === current) return null;
    return next;
  }

  const TOMBSTONE_GRACE_MS = 5000;

  function getProgressActivityTimestamp(progress) {
    if (!progress || typeof progress !== "object") return 0;
    return Math.max(
      toMillis(progress.savedAt),
      toMillis(progress.watchedAt),
      toMillis(progress.lastPlayedAt),
      toMillis(progress.deletedAt),
    );
  }

  function getActiveProgressTimestamp(progress) {
    if (!progress || typeof progress !== "object") return 0;
    return Math.max(toMillis(progress.savedAt), toMillis(progress.watchedAt), toMillis(progress.lastPlayedAt));
  }

  function selectProgressEntry(a, b) {
    if (!a) return b;
    if (!b) return a;

    const aDeleted = a.deleted === true;
    const bDeleted = b.deleted === true;

    if (aDeleted !== bDeleted) {
      const deletedEntry = aDeleted ? a : b;
      const activeEntry = aDeleted ? b : a;
      const deletedAt = toMillis(deletedEntry.deletedAt);
      const activeAt = getActiveProgressTimestamp(activeEntry);

      // A tombstone remains authoritative during the grace window. A later
      // playback event is an explicit revival and may safely replace it.
      return activeAt > deletedAt + TOMBSTONE_GRACE_MS ? activeEntry : deletedEntry;
    }

    if (aDeleted && bDeleted) {
      const aDeletedAt = toMillis(a.deletedAt);
      const bDeletedAt = toMillis(b.deletedAt);
      if (aDeletedAt !== bDeletedAt) return aDeletedAt > bDeletedAt ? a : b;
      return pickDeterministicValue(a, b);
    }

    const aCurrentTime = getSafeNumber(Number(a.currentTime));
    const bCurrentTime = getSafeNumber(Number(b.currentTime));
    if (aCurrentTime !== bCurrentTime) return aCurrentTime > bCurrentTime ? a : b;

    const aSavedAt = getActiveProgressTimestamp(a);
    const bSavedAt = getActiveProgressTimestamp(b);
    if (aSavedAt !== bSavedAt) return aSavedAt > bSavedAt ? a : b;

    return pickDeterministicValue(a, b);
  }

  function removeDeletedProgress(videoProgress, deletedAnime) {
    if (!videoProgress || typeof videoProgress !== "object") return {};

    const cleaned = {};
    for (const [id, progress] of Object.entries(videoProgress || {})) {
      if (id === "__slugIndex") continue;

      const slugMatch = id.match(/^(.+)__episode-\d+$/);
      const animeSlug = slugMatch ? slugMatch[1] : "";
      const deletedInfo = animeSlug ? deletedAnime?.[animeSlug] : null;
      const deletedAt = toMillis(deletedInfo?.deletedAt || deletedInfo);

      if (!deletedAt) {
        cleaned[id] = progress;
        continue;
      }

      const progressTs = getProgressActivityTimestamp(progress);
      if (progressTs > deletedAt + TOMBSTONE_GRACE_MS) {
        cleaned[id] = progress;
      }
    }

    return cleaned;
  }

  function mergeVideoProgress(local, cloud) {
    const merged = {};
    const ids = new Set([...Object.keys(cloud || {}), ...Object.keys(local || {})]);

    for (const id of ids) {
      // This is a derived, in-memory acceleration index and must never
      // participate in persisted conflict resolution.
      if (id === "__slugIndex") continue;
      merged[id] = selectProgressEntry(local?.[id], cloud?.[id]);
    }

    return merged;
  }

  function mergeAnimeData(localData, cloudData) {
    const merged = { ...(cloudData || {}), ...(localData || {}) };

    const stripAutoRepaired = (entry) => {
      if (!entry || !Array.isArray(entry.episodes)) return entry;
      const filtered = entry.episodes.filter((ep) => !(ep && ep.autoRepaired === true));
      if (filtered.length === entry.episodes.length) return entry;
      const totalWatchTime = filtered.reduce((sum, ep) => sum + (Number(ep?.duration) || 0), 0);
      return { ...entry, episodes: filtered, totalWatchTime };
    };

    for (const slug of Object.keys(merged)) {
      const cloudAnime = cloudData?.[slug];
      const localAnime = localData?.[slug];
      if (!cloudAnime || !localAnime) {
        merged[slug] = stripAutoRepaired(merged[slug]);
        continue;
      }

      const episodesByNumber = new Map();
      for (let episode of [
        ...(Array.isArray(cloudAnime.episodes) ? cloudAnime.episodes : []),
        ...(Array.isArray(localAnime.episodes) ? localAnime.episodes : []),
      ]) {
        if (!episode || typeof episode.number !== "number" || isNaN(episode.number)) continue;

        if (episode.autoRepaired === true) continue;

        if (episode.durationSource === "anilist" && episode.watchedAt != null) {
          const { watchedAt: _drop, ...rest } = episode;
          episode = rest;
        }

        const existing = episodesByNumber.get(episode.number);
        if (!existing) {
          episodesByNumber.set(episode.number, episode);
          continue;
        }

        const existingWatchedAt = existing.watchedAt ? +new Date(existing.watchedAt) : 0;
        const episodeWatchedAt = episode.watchedAt ? +new Date(episode.watchedAt) : 0;

        if (episodeWatchedAt > existingWatchedAt) {
          episodesByNumber.set(episode.number, episode);
        } else if (episodeWatchedAt === existingWatchedAt) {
          const existingIsVideo = (existing.durationSource || "video") === "video";
          const episodeIsVideo = (episode.durationSource || "video") === "video";
          const existingDuration = Number(existing.duration) || 0;
          const episodeDuration = Number(episode.duration) || 0;

          if (
            (episodeIsVideo && !existingIsVideo) ||
            (episodeIsVideo === existingIsVideo && episodeDuration > existingDuration) ||
            (episodeIsVideo === existingIsVideo &&
              episodeDuration === existingDuration &&
              compareStableValues(episode, existing) < 0)
          ) {
            episodesByNumber.set(episode.number, episode);
          }
        }
      }

      const mergedMetadata = { ...(cloudAnime || {}), ...(localAnime || {}) };
      const { title, titleUpdatedAt } = getTitleSelection(localAnime, cloudAnime, slug);
      mergedMetadata.title = title;
      if (titleUpdatedAt) {
        mergedMetadata.titleUpdatedAt = titleUpdatedAt;
      } else {
        delete mergedMetadata.titleUpdatedAt;
      }

      if (!mergedMetadata.coverImage && cloudAnime.coverImage) {
        mergedMetadata.coverImage = cloudAnime.coverImage;
      }

      const normalizeMediaType = globalThis.AnimeTrackerMediaType?.normalize || ((value) => getSafeString(value).trim().toUpperCase() || null);
      const localMediaType = normalizeMediaType(localAnime.mediaType) || null;
      const cloudMediaType = normalizeMediaType(cloudAnime.mediaType) || null;
      const localMediaTypeTs = toMillis(localAnime.mediaTypeUpdatedAt);
      const cloudMediaTypeTs = toMillis(cloudAnime.mediaTypeUpdatedAt);
      const localMediaTypeRank = metadataSourceRank(localAnime.mediaTypeSource);
      const cloudMediaTypeRank = metadataSourceRank(cloudAnime.mediaTypeSource);
      const useCloudMediaType =
        cloudMediaType &&
        (!localMediaType ||
          cloudMediaTypeRank > localMediaTypeRank ||
          (cloudMediaTypeRank === localMediaTypeRank && cloudMediaTypeTs > localMediaTypeTs) ||
          (cloudMediaTypeRank === localMediaTypeRank &&
            cloudMediaTypeTs === localMediaTypeTs &&
            cloudMediaType.localeCompare(localMediaType) < 0));
      const mergedMediaType = useCloudMediaType ? cloudMediaType : localMediaType || cloudMediaType;
      const mediaTypeAnime = useCloudMediaType ? cloudAnime : localMediaType ? localAnime : cloudAnime;
      if (mergedMediaType) {
        mergedMetadata.mediaType = mergedMediaType;
        mergedMetadata.mediaTypeUpdatedAt = mediaTypeAnime?.mediaTypeUpdatedAt || null;
        if (mediaTypeAnime?.mediaTypeSource) mergedMetadata.mediaTypeSource = mediaTypeAnime.mediaTypeSource;
        else delete mergedMetadata.mediaTypeSource;
      } else {
        delete mergedMetadata.mediaType;
        delete mergedMetadata.mediaTypeUpdatedAt;
        delete mergedMetadata.mediaTypeSource;
      }

      const localTotalValue = Number(localAnime.totalEpisodes);
      const cloudTotalValue = Number(cloudAnime.totalEpisodes);
      const localTotal = Number.isFinite(localTotalValue) && localTotalValue > 0 ? localTotalValue : 0;
      const cloudTotal = Number.isFinite(cloudTotalValue) && cloudTotalValue > 0 ? cloudTotalValue : 0;
      const localTotalTs = toMillis(localAnime.totalEpisodesUpdatedAt);
      const cloudTotalTs = toMillis(cloudAnime.totalEpisodesUpdatedAt);
      const localTotalRank = metadataSourceRank(localAnime.totalEpisodesSource);
      const cloudTotalRank = metadataSourceRank(cloudAnime.totalEpisodesSource);
      let newestTotal = 0;
      let newestTotalUpdatedAt = null;
      let newestTotalSource = null;
      if (localTotal && cloudTotal) {
        if (
          cloudTotalRank > localTotalRank ||
          (cloudTotalRank === localTotalRank && cloudTotalTs > localTotalTs) ||
          (cloudTotalRank === localTotalRank && cloudTotalTs === localTotalTs && cloudTotal > localTotal)
        ) {
          newestTotal = cloudTotal;
          newestTotalUpdatedAt = cloudAnime.totalEpisodesUpdatedAt || null;
          newestTotalSource = cloudAnime.totalEpisodesSource || null;
        } else {
          newestTotal = localTotal;
          newestTotalUpdatedAt = localAnime.totalEpisodesUpdatedAt || null;
          newestTotalSource = localAnime.totalEpisodesSource || null;
        }
      } else if (localTotal) {
        newestTotal = localTotal;
        newestTotalUpdatedAt = localAnime.totalEpisodesUpdatedAt || null;
        newestTotalSource = localAnime.totalEpisodesSource || null;
      } else if (cloudTotal) {
        newestTotal = cloudTotal;
        newestTotalUpdatedAt = cloudAnime.totalEpisodesUpdatedAt || null;
        newestTotalSource = cloudAnime.totalEpisodesSource || null;
      }
      const maxTrackedEpisode = Math.max(0, ...episodesByNumber.keys());
      const bestTotal = metadataSourceRank(newestTotalSource) >= 2 ? newestTotal : Math.max(newestTotal, maxTrackedEpisode);
      mergedMetadata.totalEpisodes = bestTotal > 0 ? bestTotal : null;
      if (bestTotal > 0 && newestTotalUpdatedAt) {
        mergedMetadata.totalEpisodesUpdatedAt = newestTotalUpdatedAt;
      } else {
        delete mergedMetadata.totalEpisodesUpdatedAt;
      }
      if (bestTotal > 0 && bestTotal === newestTotal && newestTotalSource) {
        mergedMetadata.totalEpisodesSource = newestTotalSource;
      } else {
        delete mergedMetadata.totalEpisodesSource;
      }

      const localReleaseStatus = getSafeString(localAnime.releaseStatus).trim().toUpperCase() || null;
      const cloudReleaseStatus = getSafeString(cloudAnime.releaseStatus).trim().toUpperCase() || null;
      const localReleaseTs = toMillis(localAnime.releaseStatusUpdatedAt);
      const cloudReleaseTs = toMillis(cloudAnime.releaseStatusUpdatedAt);
      const localReleaseRank = metadataSourceRank(localAnime.releaseStatusSource);
      const cloudReleaseRank = metadataSourceRank(cloudAnime.releaseStatusSource);
      const useCloudReleaseStatus =
        cloudReleaseStatus &&
        (!localReleaseStatus ||
          cloudReleaseRank > localReleaseRank ||
          (cloudReleaseRank === localReleaseRank && cloudReleaseTs > localReleaseTs) ||
          (cloudReleaseRank === localReleaseRank &&
            cloudReleaseTs === localReleaseTs &&
            cloudReleaseStatus < localReleaseStatus));
      const mergedReleaseStatus = useCloudReleaseStatus ? cloudReleaseStatus : localReleaseStatus || cloudReleaseStatus;
      const releaseAnime = useCloudReleaseStatus ? cloudAnime : localReleaseStatus ? localAnime : cloudAnime;
      if (mergedReleaseStatus) {
        mergedMetadata.releaseStatus = mergedReleaseStatus;
        mergedMetadata.releaseStatusUpdatedAt = releaseAnime?.releaseStatusUpdatedAt || null;
        if (releaseAnime?.releaseStatusSource) mergedMetadata.releaseStatusSource = releaseAnime.releaseStatusSource;
        else delete mergedMetadata.releaseStatusSource;
      } else {
        delete mergedMetadata.releaseStatus;
        delete mergedMetadata.releaseStatusUpdatedAt;
        delete mergedMetadata.releaseStatusSource;
      }
      mergedMetadata.lastWatched = pickLatestIso(localAnime.lastWatched, cloudAnime.lastWatched);

      applyMergedListState(mergedMetadata, localAnime, cloudAnime);
      applyMergedFavorite(mergedMetadata, localAnime, cloudAnime);

      mergedMetadata.episodes = Array.from(episodesByNumber.values()).sort((a, b) => a.number - b.number);
      mergedMetadata.totalWatchTime = mergedMetadata.episodes.reduce((sum, ep) => sum + (ep.duration || 0), 0);

      merged[slug] = mergedMetadata;
    }

    return merged;
  }

  function mergeMigratedEntry(targetSlug, targetEntry, sourceEntry, options = {}) {
    const offset = Number(options.episodeOffset) || 0;
    const moved = { ...(sourceEntry || {}), slug: targetSlug };
    if (options.title) moved.title = options.title;
    moved.episodes = (Array.isArray(sourceEntry?.episodes) ? sourceEntry.episodes : [])
      .map((episode) => ({ ...episode, number: Number(episode?.number) + offset }))
      .filter((episode) => Number.isFinite(episode.number) && episode.number > 0);
    moved.totalWatchTime = moved.episodes.reduce((sum, episode) => sum + (Number(episode?.duration) || 0), 0);
    const sourceTotal = Number(sourceEntry?.totalEpisodes);
    moved.totalEpisodes = Number.isFinite(sourceTotal) && sourceTotal > 0 ? sourceTotal + offset : null;
    if (offset !== 0) delete moved.totalEpisodesSource;
    if (!(moved.totalEpisodes > 0)) delete moved.totalEpisodesUpdatedAt;

    const local = targetEntry ? { [targetSlug]: targetEntry } : {};
    const merged = mergeAnimeData(local, { [targetSlug]: moved })[targetSlug];
    const targetTotal = Number(targetEntry?.totalEpisodes) || 0;
    const movedTotal = Number(moved.totalEpisodes) || 0;
    const targetTotalTs = toMillis(targetEntry?.totalEpisodesUpdatedAt);
    const movedTotalTs = toMillis(moved.totalEpisodesUpdatedAt);
    if (targetTotal > 0 && movedTotal > 0 && targetTotal !== movedTotal && targetTotalTs >= movedTotalTs) {
      const maxTracked = Math.max(0, ...(merged.episodes || []).map((episode) => Number(episode?.number) || 0));
      merged.totalEpisodes = Math.max(targetTotal, maxTracked);
      if (targetEntry.totalEpisodesUpdatedAt) merged.totalEpisodesUpdatedAt = targetEntry.totalEpisodesUpdatedAt;
      else delete merged.totalEpisodesUpdatedAt;
      if (targetEntry.totalEpisodesSource) merged.totalEpisodesSource = targetEntry.totalEpisodesSource;
      else delete merged.totalEpisodesSource;
    }
    return merged;
  }

  function mergeDeletedAnime(local, cloud) {
    const merged = { ...(cloud || {}) };

    for (const [slug, info] of Object.entries(local || {})) {
      const localDeletedAt = toMillis(info?.deletedAt || info);
      const cloudDeletedAt = toMillis(merged[slug]?.deletedAt || merged[slug]);
      if (
        !merged[slug] ||
        localDeletedAt > cloudDeletedAt ||
        (localDeletedAt === cloudDeletedAt && compareStableValues(info, merged[slug]) < 0)
      ) {
        merged[slug] = info;
      }
    }

    return merged;
  }

  function buildDeletedAnimeTombstone(entry, nowMs = Date.now()) {
    const deletedAtMs = Math.max(Number(nowMs) || Date.now(), getAnimeActivityTimestamp(entry) + TOMBSTONE_GRACE_MS + 1000);
    return { deletedAt: new Date(deletedAtMs).toISOString() };
  }

  function pruneStaleDeletedAnime(animeData, deletedAnime) {
    const pruned = { ...(deletedAnime || {}) };

    for (const [slug, info] of Object.entries(pruned)) {
      const deletedAt = toMillis(info?.deletedAt || info);
      if (!deletedAt) continue;

      const activityTs = getAnimeActivityTimestamp(animeData?.[slug]);
      if (activityTs > deletedAt + TOMBSTONE_GRACE_MS) {
        delete pruned[slug];
      }
    }

    return pruned;
  }

  function applyDeletedAnime(animeData, deletedAnime) {
    for (const [slug, info] of Object.entries(deletedAnime || {})) {
      if (!animeData[slug]) continue;

      const deletedAt = toMillis(info?.deletedAt || info);
      if (!deletedAt) continue;

      if (deletedAt > getAnimeActivityTimestamp(animeData[slug])) {
        delete animeData[slug];
      }
    }
    return animeData;
  }

  function getCoverSetAt(entry) {
    if (!entry) return 0;
    if (typeof entry === "string") return 0;
    return Number(entry.coverSetAt) || 0;
  }

  function mergeGoalSettings(local, cloud) {
    const localObj = local || {};
    const cloudObj = cloud || {};
    const keys = new Set([...Object.keys(localObj), ...Object.keys(cloudObj)]);
    const result = {};

    for (const key of keys) {
      const localEntry = localObj[key] || {};
      const cloudEntry = cloudObj[key] || {};
      const localTs = toMillis(localEntry.updatedAt);
      const cloudTs = toMillis(cloudEntry.updatedAt);
      const selected =
        cloudTs > localTs
          ? cloudEntry
          : localTs > cloudTs
            ? localEntry
            : pickDeterministicValue(localEntry, cloudEntry);
      result[key] = { ...selected };
    }

    return result;
  }

  function mergeBadgeUnlocks(local, cloud) {
    const localObj = local || {};
    const cloudObj = cloud || {};
    const keys = new Set([...Object.keys(localObj), ...Object.keys(cloudObj)]);
    const result = {};

    for (const key of keys) {
      const localEntry = localObj[key];
      const cloudEntry = cloudObj[key];
      if (!localEntry) {
        result[key] = { ...cloudEntry };
        continue;
      }
      if (!cloudEntry) {
        result[key] = { ...localEntry };
        continue;
      }
      const localTs = toMillis(localEntry.unlockedAt);
      const cloudTs = toMillis(cloudEntry.unlockedAt);
      const earliest = localTs && cloudTs ? (localTs <= cloudTs ? localEntry : cloudEntry) : localEntry || cloudEntry;
      result[key] = {
        ...cloudEntry,
        ...localEntry,
        unlockedAt: earliest?.unlockedAt || localEntry.unlockedAt || cloudEntry.unlockedAt,
        notified: !!(localEntry.notified || cloudEntry.notified),
      };
    }

    return result;
  }

  function mergeGroupCoverImages(local, cloud) {
    const localObj = local || {};
    const cloudObj = cloud || {};
    const result = { ...cloudObj };

    for (const [slug, localEntry] of Object.entries(localObj)) {
      const cloudEntry = cloudObj[slug];
      const localSetAt = getCoverSetAt(localEntry);
      const cloudSetAt = getCoverSetAt(cloudEntry);

      if (
        !cloudEntry ||
        localSetAt > cloudSetAt ||
        (localSetAt === cloudSetAt && compareStableValues(localEntry, cloudEntry) < 0)
      ) {
        result[slug] = localEntry;
      }
    }

    return result;
  }

  function stripAutoRepairedEpisodesFromMap(animeData) {
    if (!animeData || typeof animeData !== "object") return animeData;
    const out = {};
    let changed = false;
    for (const [slug, entry] of Object.entries(animeData)) {
      if (!entry || !Array.isArray(entry.episodes)) {
        out[slug] = entry;
        continue;
      }
      const filtered = entry.episodes.filter((ep) => !(ep && ep.autoRepaired === true));
      if (filtered.length === entry.episodes.length) {
        out[slug] = entry;
        continue;
      }
      const totalWatchTime = filtered.reduce((sum, ep) => sum + (Number(ep?.duration) || 0), 0);
      out[slug] = { ...entry, episodes: filtered, totalWatchTime };
      changed = true;
    }
    return changed ? out : animeData;
  }

  // Drops unstored per-episode defaults (vestigial patchedManually, durationSource==="video") to shrink the synced doc; new map only if changed.
  function stripEpisodeDefaultsFromMap(animeData) {
    if (!animeData || typeof animeData !== "object") return animeData;
    const out = {};
    let changedAny = false;
    for (const [slug, entry] of Object.entries(animeData)) {
      if (!entry || !Array.isArray(entry.episodes)) {
        out[slug] = entry;
        continue;
      }
      let entryChanged = false;
      const episodes = entry.episodes.map((ep) => {
        if (!ep || typeof ep !== "object") return ep;
        const hasPatched = Object.prototype.hasOwnProperty.call(ep, "patchedManually");
        const hasDefaultSource = ep.durationSource === "video";
        if (!hasPatched && !hasDefaultSource) return ep;
        const next = { ...ep };
        delete next.patchedManually;
        if (next.durationSource === "video") delete next.durationSource;
        entryChanged = true;
        return next;
      });
      if (entryChanged) {
        out[slug] = { ...entry, episodes };
        changedAny = true;
      } else {
        out[slug] = entry;
      }
    }
    return changedAny ? out : animeData;
  }

  // Wire codec: episodes use SHORT keys on the Firestore wire (number→n, watchedAt→w, duration→d, durationSource→s); full keys kept
  // everywhere in memory/storage. Encode before PATCH, decode after read; values unchanged so a round-trip never reads as a change.
  function encodeEpisodeForCloud(ep) {
    if (!ep || typeof ep !== "object") return ep;
    const { number, watchedAt, duration, durationSource, ...rest } = ep;
    const out = { ...rest };
    if (number !== undefined) out.n = number;
    if (watchedAt !== undefined) {
      if (typeof watchedAt === "string") {
        const t = Date.parse(watchedAt);
        out.w = Number.isFinite(t) && new Date(t).toISOString() === watchedAt ? t : watchedAt;
      } else {
        out.w = watchedAt;
      }
    }
    if (duration !== undefined) out.d = duration;
    if (durationSource !== undefined && durationSource !== "video") out.s = durationSource;
    return out;
  }
  function decodeEpisodeFromCloud(ep) {
    if (!ep || typeof ep !== "object") return ep;
    if (!("n" in ep) && !("w" in ep) && !("d" in ep) && !("s" in ep)) return ep;
    const { n, w, d, s, ...rest } = ep;
    const out = { ...rest };
    if (n !== undefined) out.number = n;
    if (w !== undefined) out.watchedAt = typeof w === "number" ? new Date(w).toISOString() : w;
    if (d !== undefined) out.duration = d;
    if (s !== undefined) out.durationSource = s;
    return out;
  }
  function mapEpisodes(animeData, fn) {
    if (!animeData || typeof animeData !== "object") return animeData;
    const out = {};
    for (const [slug, entry] of Object.entries(animeData)) {
      if (!entry || !Array.isArray(entry.episodes)) {
        out[slug] = entry;
        continue;
      }
      out[slug] = { ...entry, episodes: entry.episodes.map(fn) };
    }
    return out;
  }
  function encodeEpisodesForCloud(animeData) {
    return mapEpisodes(animeData, encodeEpisodeForCloud);
  }
  function decodeEpisodesFromCloud(animeData) {
    return mapEpisodes(animeData, decodeEpisodeFromCloud);
  }

  const root = typeof globalThis !== "undefined" ? globalThis : self;
  const exports = {
    mergeVideoProgress,
    mergeAnimeData,
    mergeMigratedEntry,
    mergeDeletedAnime,
    buildDeletedAnimeTombstone,
    pruneStaleDeletedAnime,
    applyDeletedAnime,
    removeDeletedProgress,
    mergeGroupCoverImages,
    mergeGoalSettings,
    mergeBadgeUnlocks,
    areAnimeDataMapsEqual,
    areAnimeEntriesEqual,
    areProgressMapsEqual,
    shallowEqualDeletedAnime,
    shallowEqualObjectMap,
    isLikelyMovieSlug,
    isPlaceholderDuration,
    pickRepairedTitle,
    stripAutoRepairedEpisodesFromMap,
    stripEpisodeDefaultsFromMap,
    encodeEpisodesForCloud,
    decodeEpisodesFromCloud,
    PLACEHOLDER_DURATION_VALUES,
    TOMBSTONE_GRACE_MS,
  };
  root.AnimeTrackerMergeUtils = exports;

  if (typeof window !== "undefined") {
    const ATC = (window.AnimeTrackerContent = window.AnimeTrackerContent || {});
    ATC.MergeUtils = exports;

    const AT = (window.AnimeTracker = window.AnimeTracker || {});
    AT.MergeUtils = exports;
  }
})();
