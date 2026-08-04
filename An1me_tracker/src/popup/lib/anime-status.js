// anime-status.js — anime status logic: watching / completed / airing / dropped / on-hold.
(function () {
  "use strict";

  const AnimeStatus = Object.freeze({
    WATCHING: "watching",
    COMPLETED: "completed",
    AIRING: "airing",
    DROPPED: "dropped",
    ON_HOLD: "on_hold",
  });

  function getCalendarDayDiff(isoString) {
    if (!isoString) return 0;
    const target = new Date(isoString);
    if (isNaN(target.getTime())) return 0;
    const now = new Date();

    const nowUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const targetUtc = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
    return Math.round((nowUtc - targetUtc) / 86400000);
  }

  function toMillis(value) {
    const timestamp = value ? new Date(value).getTime() : 0;
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function getAuthoritativeSiteInfo(slug, anime = null) {
    const AT = window.AnimeTracker;
    const normalizedSlug = String(slug || "").toLowerCase();
    const cached = AT?.AnilistService?.getAuthoritativeInfo?.(normalizedSlug) || null;
    const compatible = !cached || !anime || AT?.AnilistService?.isInfoCompatibleWithEntry?.(anime, cached) !== false;
    let info = compatible && cached ? { ...cached } : null;
    const cacheTimestamp = Number(info?.cachedAt) || 0;
    let storedStatusIsNewer = false;

    const ensureInfo = () => {
      if (!info) info = { resolvedSlug: normalizedSlug };
      return info;
    };

    const totalTimestamp = toMillis(anime?.totalEpisodesUpdatedAt);
    if (
      anime?.totalEpisodesSource === "an1me" &&
      Number(anime?.totalEpisodes) > 0 &&
      (!info || totalTimestamp > cacheTimestamp)
    ) {
      ensureInfo().totalEpisodes = Number(anime.totalEpisodes);
    }

    const mediaTimestamp = toMillis(anime?.mediaTypeUpdatedAt);
    if (anime?.mediaTypeSource === "an1me" && anime?.mediaType && (!info || mediaTimestamp > cacheTimestamp)) {
      ensureInfo().mediaType = anime.mediaType;
    }

    const statusTimestamp = toMillis(anime?.releaseStatusUpdatedAt);
    if (anime?.releaseStatusSource === "an1me" && anime?.releaseStatus && (!info || statusTimestamp > cacheTimestamp)) {
      ensureInfo().status = anime.releaseStatus;
      storedStatusIsNewer = true;
    }

    if (!info && cached && !compatible) info = { resolvedSlug: normalizedSlug, _identityMatched: false };
    if (!info) return null;
    info._statusFresh =
      storedStatusIsNewer || (!!cached && compatible && AT?.CachePolicy?.isInfoFresh?.(cached) === true);
    info._identityMatched = compatible;
    if (storedStatusIsNewer && info.status === "FINISHED" && Number(info.totalEpisodes) > 0) {
      info.latestEpisode = Math.max(Number(info.latestEpisode) || 0, Number(info.totalEpisodes));
    }
    return info;
  }

  function getSiteCompletionSource(slug, anime, siteInfo = null) {
    const AT = window.AnimeTracker;
    const info = siteInfo || getAuthoritativeSiteInfo(slug, anime);
    const mediaType = info?.mediaType || AT.SeasonGrouping?.getDisplayMediaType?.(slug, anime) || null;
    return (
      globalThis.AnimeTrackerEntryState?.getAutoCompletionSource?.(anime, {
        animeSlug: slug,
        totalEpisodes: Number(info?.totalEpisodes) || 0,
        releaseStatus: info?.status || null,
        mediaType,
      }) || null
    );
  }

  function getStatus(slug, anime) {
    const AT = window.AnimeTracker;
    const { FillerService, SeasonGrouping, AnilistService, CONFIG } = AT;
    if (!anime) return AnimeStatus.WATCHING;
    const listState = globalThis.AnimeTrackerEntryState?.getResolvedListState?.(anime) || String(anime.listState || "").toLowerCase();

    if (listState === AnimeStatus.ON_HOLD) return AnimeStatus.ON_HOLD;

    if (listState === AnimeStatus.DROPPED) return AnimeStatus.DROPPED;

    const watchedCount = anime.episodes?.length || 0;
    const lowerSlug = slug.toLowerCase();
    const lowerTitle = String(anime.title || "").toLowerCase();
    const siteInfo = getAuthoritativeSiteInfo(lowerSlug, anime);
    const releaseStatus = siteInfo
      ? siteInfo.status || anime.releaseStatus || null
      : anime.releaseStatus || AnilistService?.getStatus(lowerSlug);
    const latestAvailable = siteInfo
      ? Number(siteInfo.latestEpisode) || 0
      : Number(AnilistService?.getLatestEpisode(lowerSlug)) || 0;
    const metaTotal = siteInfo ? Number(siteInfo.totalEpisodes) || 0 : Number(AnilistService?.getTotalEpisodes(lowerSlug)) || 0;
    const isPartiallyUploaded = releaseStatus === "RELEASING" && metaTotal > 0 && latestAvailable > 0 && latestAvailable < metaTotal;
    const displayMediaType = SeasonGrouping.getDisplayMediaType?.(slug, anime) || null;
    const siteCompletionSource = getSiteCompletionSource(slug, anime, siteInfo);
    const looksLikeStandaloneSpecial =
      globalThis.AnimeTrackerMediaType?.isSupplement(displayMediaType) ||
      /(?:^|[-\s])special(?:[-\s]|$)|(?:^|[-\s])ova(?:[-\s]|$)|(?:^|[-\s])ona(?:[-\s]|$)|(?:^|[-\s])fan[-\s]letter(?:[-\s]|$)/i.test(
        `${lowerSlug} ${lowerTitle}`,
      );

    let isComplete = false;

    if (listState === AnimeStatus.COMPLETED) {
      // Explicit completion wins even with 0 tracked episodes — AniList imports create
      // completed entries with an empty episodes array, which must not land in "Watching".
      isComplete = true;
    } else if (watchedCount === 0) {
      isComplete = false;
    } else if (siteCompletionSource && !isPartiallyUploaded) {
      isComplete = true;
    } else {
      const progressData = FillerService.calculateProgress(watchedCount, slug, anime);

      if (progressData.progress >= 100 && !isPartiallyUploaded && siteInfo?.status === "FINISHED") {
        isComplete = true;
      } else if (siteInfo?.status === "FINISHED" && progressData.total == null && !isPartiallyUploaded) {
        isComplete = false;
      }
    }

    if (isComplete) {
      const isAged =
        listState === AnimeStatus.COMPLETED ||
        SeasonGrouping.isMovie(slug, anime) ||
        looksLikeStandaloneSpecial ||
        !!siteCompletionSource ||
        releaseStatus === "FINISHED" ||
        getCalendarDayDiff(anime?.lastWatched) >= CONFIG.COMPLETED_LIST_MIN_DAYS;

      return isAged ? AnimeStatus.COMPLETED : AnimeStatus.WATCHING;
    }

    if (watchedCount > 0 && listState !== AnimeStatus.COMPLETED && latestAvailable > 0) {
      const highestWatched = Math.max(0, ...(anime.episodes || []).map((ep) => Number(ep.number) || 0));

      if (releaseStatus === "RELEASING" && highestWatched >= latestAvailable) {
        return AnimeStatus.AIRING;
      }
    }

    if (
      watchedCount > 0 &&
      listState !== AnimeStatus.COMPLETED &&
      releaseStatus === "RELEASING" &&
      !(latestAvailable > 0) &&
      AnilistService?.getNextEpisodeAt(lowerSlug)
    ) {
      return AnimeStatus.AIRING;
    }

    return AnimeStatus.WATCHING;
  }

  function isCompleted(slug, anime) {
    return getStatus(slug, anime) === AnimeStatus.COMPLETED;
  }

  // For a still-releasing (or partially-uploaded) anime the user has essentially
  // caught up on, returns how many fresh episodes are now available beyond their
  // highest watched (plus the latest episode number); otherwise null. Drives the
  // "New Episode" badge. Gated to a small gap (default 3) so it fires for a recent
  // drop, not for a show the user is actively far behind on.
  function getNewEpisodeInfo(slug, anime, maxGap = 3) {
    const AT = window.AnimeTracker;
    const { AnilistService } = AT;
    if (!anime || !slug) return null;

    const listState = globalThis.AnimeTrackerEntryState?.getResolvedListState?.(anime) || String(anime.listState || "").toLowerCase();
    if (listState === AnimeStatus.DROPPED || listState === AnimeStatus.ON_HOLD) return null;

    const lowerSlug = String(slug).toLowerCase();
    const siteInfo = getAuthoritativeSiteInfo(lowerSlug, anime);
    const status = siteInfo ? siteInfo.status || anime.releaseStatus || null : anime.releaseStatus || AnilistService?.getStatus(lowerSlug);
    const latest = siteInfo ? Number(siteInfo.latestEpisode) || 0 : Number(AnilistService?.getLatestEpisode(lowerSlug)) || 0;
    const metaTotal = siteInfo ? Number(siteInfo.totalEpisodes) || 0 : Number(AnilistService?.getTotalEpisodes(lowerSlug)) || 0;
    const partiallyUploaded = status === "RELEASING" && metaTotal > 0 && latest > 0 && latest < metaTotal;
    if (latest <= 0 || (status !== "RELEASING" && !partiallyUploaded)) return null;

    const eps = Array.isArray(anime.episodes) ? anime.episodes : [];
    if (eps.length === 0) return null;
    const highestWatched = Math.max(0, ...eps.map((ep) => Number(ep.number) || 0));

    const count = latest - highestWatched;
    if (count <= 0 || count > maxGap) return null;
    return { count, latest, highestWatched };
  }

  function setManualListState(entry, state, at = new Date().toISOString(), isManual = false, completionSource = null) {
    if (!entry) return;
    entry.listState = state;
    entry.listStateUpdatedAt = at;

    if (state === "completed") {
      entry.completedAt = entry.completedAt || at;
      if (isManual) {
        entry.manualComplete = true;
        entry.completionSource = "manual";
      } else {
        delete entry.manualComplete;
        if (completionSource) entry.completionSource = completionSource;
      }
      delete entry.droppedAt;
      delete entry.onHoldAt;
      return;
    }

    delete entry.manualComplete;
    delete entry.completionSource;

    if (state === "dropped") {
      entry.droppedAt = entry.droppedAt || at;
      delete entry.completedAt;
      delete entry.onHoldAt;
      return;
    }

    if (state === "on_hold") {
      entry.onHoldAt = entry.onHoldAt || at;
      delete entry.completedAt;
      delete entry.droppedAt;
      return;
    }

    delete entry.completedAt;
    delete entry.droppedAt;
    delete entry.onHoldAt;
  }

  function markTitleEdited(entry, title, at = new Date().toISOString()) {
    if (!entry) return;
    entry.title = title;
    entry.titleUpdatedAt = at;
  }

  function clearDeletedAnimeSlug(deletedAnime, slug) {
    const next = { ...(deletedAnime || {}) };
    if (slug && Object.prototype.hasOwnProperty.call(next, slug)) {
      delete next[slug];
    }
    return next;
  }

  function getKnownTotalEpisodesForRepair(slug, anime) {
    const siteInfo = getAuthoritativeSiteInfo(slug, anime);
    const siteTotal = Number(siteInfo?.totalEpisodes) || 0;
    if (siteTotal > 0) return siteTotal;
    const localTotal = Number(anime?.totalEpisodes) || 0;
    return Math.max(localTotal, 0);
  }

  function repairAiringCompleted(data, options = {}) {
    const AT = window.AnimeTracker;
    const targetData = data || {};
    const requestedSlugs = Array.isArray(options.slugs) ? options.slugs : null;
    const slugs = requestedSlugs && requestedSlugs.length ? requestedSlugs : Object.keys(targetData);
    let changed = false;

    for (const slug of slugs) {
      const anime = targetData?.[slug];
      if (!anime) continue;

      const listState = globalThis.AnimeTrackerEntryState?.getResolvedListState?.(anime) || String(anime.listState || "").toLowerCase();
      if (listState === "dropped" || listState === "on_hold") continue;
      if (listState !== "completed") continue;
      if (AT.SeasonGrouping.isMovie(slug, anime)) continue;
      if (anime.manualComplete === true) continue;

      const watchedCount = Array.isArray(anime.episodes) ? anime.episodes.length : 0;
      if (watchedCount <= 0) continue;

      const siteInfo = getAuthoritativeSiteInfo(slug, anime);
      if (!siteInfo) continue;
      if (siteInfo._statusFresh !== true) continue;
      if (!["site-final", "canon-auto", "one-shot", "auto"].includes(anime.completionSource)) continue;
      if (
        anime.completionSource === "canon-auto" &&
        !AT.CachePolicy?.isFillerFresh?.(AT.FillerService?.episodeTypesCache?.[slug], siteInfo)
      )
        continue;

      let shouldRevert = siteInfo.status === "RELEASING";
      if (!shouldRevert && siteInfo.status === "FINISHED") {
        const probe = { ...anime };
        delete probe.completedAt;
        delete probe.listState;
        delete probe.listStateUpdatedAt;
        delete probe.completionSource;
        shouldRevert = getStatus(slug, probe) !== AnimeStatus.COMPLETED;
      }

      if (shouldRevert) {
        setManualListState(anime, "active", new Date().toISOString());
        changed = true;
      }
    }

    return changed;
  }

  function persistDetectedCompletions(data, options = {}) {
    const AT = window.AnimeTracker;
    const targetData = data || {};
    const requestedSlugs = Array.isArray(options.slugs) ? options.slugs : null;
    const slugs = requestedSlugs && requestedSlugs.length ? requestedSlugs : Object.keys(targetData);
    let changed = false;

    for (const slug of slugs) {
      const anime = targetData[slug];
      if (!anime) continue;

      const listState = globalThis.AnimeTrackerEntryState?.getResolvedListState?.(anime) || String(anime.listState || "").toLowerCase();
      if (listState === "completed") continue;
      if (listState === "dropped" || listState === "on_hold") continue;

      const siteInfo = getAuthoritativeSiteInfo(slug, anime);
      const releaseStatus = siteInfo
        ? siteInfo.status || anime.releaseStatus || null
        : anime.releaseStatus || AT.AnilistService?.getStatus(String(slug).toLowerCase());
      const siteCompletionSource = siteInfo?._statusFresh === true ? getSiteCompletionSource(slug, anime, siteInfo) : null;
      const displayMediaType = AT.SeasonGrouping?.getDisplayMediaType?.(slug, anime) || null;
      const isSupplement = !!globalThis.AnimeTrackerMediaType?.isSupplement(displayMediaType);
      const knownTotal = getKnownTotalEpisodesForRepair(slug, anime);
      const isOneShotSupplement = isSupplement && knownTotal === 1;
      if (releaseStatus === "RELEASING" && !siteCompletionSource) continue;
      // Don't lock in a completion while the release status is still unknown
      // (An1me/AniList not fetched yet) — the show could be airing with more
      // episodes to come. Defer until we have data, so we never persist a
      // wrong completedAt that a later repair has to undo (which caused the
      // completed→airing flip on a second render). Movies/one-shots are
      // inherently finished, so they stay exempt.
      if (!releaseStatus && !AT.SeasonGrouping?.isMovie(slug, anime) && !isOneShotSupplement && !siteCompletionSource) continue;

      // Same reason as repairAiringCompleted: don't lock a completion until the
      // filler list is loaded, otherwise the canon math flips it once the
      // background filler fetch lands → completed↔active churn + full writes.
      if (
        !AT.SeasonGrouping?.isMovie(slug, anime) &&
        !isOneShotSupplement &&
        !AT.CachePolicy?.isFillerFresh?.(AT.FillerService?.episodeTypesCache?.[slug], siteInfo) &&
        !siteCompletionSource
      )
        continue;

      if (getStatus(slug, anime) !== AnimeStatus.COMPLETED) continue;

      setManualListState(anime, "completed", new Date().toISOString(), false, siteCompletionSource || "canon-auto");
      changed = true;
    }

    return changed;
  }

  window.AnimeTracker = window.AnimeTracker || {};
  window.AnimeTracker.StatusService = {
    AnimeStatus,
    getStatus,
    isCompleted,
    getNewEpisodeInfo,
    getCalendarDayDiff,
    getAuthoritativeSiteInfo,
    getSiteCompletionSource,
    getKnownTotalEpisodesForRepair,
    repairAiringCompleted,
    persistDetectedCompletions,
    setManualListState,
    markTitleEdited,
    clearDeletedAnimeSlug,
  };
})();
