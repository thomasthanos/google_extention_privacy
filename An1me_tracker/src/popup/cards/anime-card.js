// anime-card.js — anime card renderers (merged): base AnimeCardRenderer plus the
// in-progress and grouped-card extensions.
const AnimeCardRenderer = {
  createAnimeCard(slug, anime, videoProgress = {}) {
    const { UIHelpers } = window.AnimeTracker;
    const { FillerService } = window.AnimeTracker;
    const { CONFIG } = window.AnimeTracker;
    const { StatusService } = window.AnimeTracker;

    const episodeCount = anime.episodes?.length || 0;
    const progressData = FillerService.calculateProgress(episodeCount, slug, anime);
    const sizeClass = UIHelpers.getProgressSizeClass(episodeCount, progressData.total || episodeCount);

    const canonWatched = FillerService.getCanonEpisodeCount(slug, anime.episodes);
    const totalCanon = FillerService.getTotalCanonEpisodes(slug, progressData.total || episodeCount);
    const hasFillerData = FillerService.hasFillerData(slug);

    let highestCompletedEp = 0;
    if (anime.episodes?.length > 0) {
      const validNumbers = anime.episodes.map((ep) => ep.number).filter((n) => !isNaN(n) && n > 0);
      if (validNumbers.length > 0) {
        highestCompletedEp = Math.max(...validNumbers);
      }
    }

    const resolvedListState = globalThis.AnimeTrackerEntryState?.getResolvedListState?.(anime) || anime.listState || "active";
    const trackedEpisodeNumbers = new Set(
      (resolvedListState === "on_hold" ? [] : anime.episodes || [])
        .filter((ep) => ep?.durationSource !== "anilist")
        .map((ep) => ep.number),
    );

    const episodesWithProgress = [];
    const slugEntries = videoProgress.__slugIndex?.[slug] || null;
    const progressEntries = slugEntries ? slugEntries : Object.entries(videoProgress).filter(([id]) => id.startsWith(slug + "__episode-"));

    for (const [uniqueId, progress] of progressEntries) {
      if (uniqueId === "__slugIndex") continue;
      const parts = uniqueId.split("__episode-");
      if (parts.length !== 2 || !parts[1]) continue;

      const epNum = parseInt(parts[1], 10);
      if (isNaN(epNum)) continue;
      if (trackedEpisodeNumbers.has(epNum)) continue;
      if (progress.percentage >= CONFIG.COMPLETED_PERCENTAGE) continue;

      if (
        typeof progress.currentTime !== "number" ||
        typeof progress.percentage !== "number" ||
        typeof progress.duration !== "number" ||
        isNaN(progress.currentTime) ||
        isNaN(progress.percentage) ||
        isNaN(progress.duration)
      ) {
        continue;
      }

      const minutes = Math.floor(progress.currentTime / 60);
      const seconds = Math.floor(progress.currentTime % 60);
      episodesWithProgress.push({
        number: epNum,
        timeStr: `${minutes}:${seconds.toString().padStart(2, "0")}`,
        percentage: progress.percentage,
      });
    }
    episodesWithProgress.sort((a, b) => a.number - b.number);

    const highestInProgressEp = episodesWithProgress.length > 0 ? Math.max(...episodesWithProgress.map((ep) => ep.number)) : 0;
    const currentEpisode = Math.max(highestCompletedEp, highestInProgressEp);

    const fillerSiteInfo = StatusService?.getAuthoritativeSiteInfo?.(slug, anime);
    const fillerReleaseStatus = fillerSiteInfo
      ? fillerSiteInfo.status || anime.releaseStatus || null
      : anime.releaseStatus || window.AnimeTracker?.AnilistService?.getStatus?.(slug);
    const fillerEpisodeBound =
      fillerReleaseStatus === "FINISHED" ? FillerService.getTotalEpisodes(slug, anime) || currentEpisode : currentEpisode;
    const skippedFillers = FillerService.getSkippedFillers(
      slug,
      anime.episodes,
      fillerEpisodeBound,
      fillerReleaseStatus === "FINISHED",
    );
    const skippedFillersText = FillerService.formatSkippedFillersCompact(skippedFillers);
    const skippedFillersIndicator =
      skippedFillers.length > 0
        ? `<span class="skipped-fillers-badge" title="Skipped filler episodes: ${skippedFillersText}"><span class="icon-inline">${UIHelpers.createIcon("skip")}</span> ${skippedFillers.length} filler skipped</span>`
        : "";

    const sortedEpisodes = [...(anime.episodes || [])].sort((a, b) => b.number - a.number);
    const visibleEpisodes = sortedEpisodes.slice(0, CONFIG.VISIBLE_EPISODES_LIMIT);
    const hiddenEpisodes = sortedEpisodes.slice(CONFIG.VISIBLE_EPISODES_LIMIT);

    const episodeTags =
      visibleEpisodes
        .map((ep) => {
          const isFiller = FillerService.isFillerEpisode(slug, ep.number);
          return `<span class="episode-tag${isFiller ? " filler watched-filler" : ""}" title="${isFiller ? "Filler Episode (Watched)" : ""}">Ep ${ep.number}</span>`;
        })
        .join("") || "";

    const hiddenEpisodeTags = hiddenEpisodes
      .map((ep) => {
        const isFiller = FillerService.isFillerEpisode(slug, ep.number);
        return `<span class="episode-tag${isFiller ? " filler watched-filler" : ""}" title="${isFiller ? "Filler Episode (Watched)" : ""}">Ep ${ep.number}</span>`;
      })
      .join("");

    const moreEpisodes =
      hiddenEpisodes.length > 0
        ? `<div class="hidden-episodes">${hiddenEpisodeTags}</div><span class="episode-tag show-more-episodes" data-more-text="+${hiddenEpisodes.length} more" data-less-text="Show less">+${hiddenEpisodes.length} more</span>`
        : "";

    const unwatchedFillers = FillerService.getUnwatchedFillers(slug, anime.episodes, fillerEpisodeBound).slice().reverse();
    const visibleFillers = unwatchedFillers.slice(0, CONFIG.VISIBLE_FILLERS_LIMIT);
    const hiddenFillers = unwatchedFillers.slice(CONFIG.VISIBLE_FILLERS_LIMIT);

    const unwatchedFillerTags = visibleFillers
      .map((epNum) => `<span class="episode-tag filler unwatched-filler" title="Filler Episode (Not watched)">Ep ${epNum}</span>`)
      .join("");

    const hiddenFillerTags = hiddenFillers
      .map((epNum) => `<span class="episode-tag filler unwatched-filler" title="Filler Episode (Not watched)">Ep ${epNum}</span>`)
      .join("");

    const showMoreFillers =
      hiddenFillers.length > 0
        ? `<div class="hidden-fillers">${hiddenFillerTags}</div><span class="episode-tag filler show-more-fillers" data-more-text="+${hiddenFillers.length} more" data-less-text="Show less">+${hiddenFillers.length} more</span>`
        : "";

    const fillerInfo = FillerService.getFillerInfo(slug, anime.episodes, anime);

    const currentEpText = currentEpisode > 0 ? `Ep ${currentEpisode}` : "";
    const unknownTotal = progressData.total == null;

    const AnilistService = window.AnimeTracker?.AnilistService;
    const siteInfoForProgress = StatusService?.getAuthoritativeSiteInfo?.(slug, anime);
    const anilistStatusForProgress = siteInfoForProgress
      ? siteInfoForProgress.status || anime.releaseStatus || null
      : anime.releaseStatus || AnilistService?.getStatus(slug);
    const _mainLatest = siteInfoForProgress ? siteInfoForProgress.latestEpisode : AnilistService?.getLatestEpisode(slug);
    const _mainMetaTotal = siteInfoForProgress ? siteInfoForProgress.totalEpisodes : AnilistService?.getTotalEpisodes(slug);
    const _mainPartial = anilistStatusForProgress === "RELEASING" && _mainMetaTotal && _mainLatest && _mainLatest < _mainMetaTotal;
    const availableInfo = _mainPartial && _mainLatest > 0 ? ` / ${_mainLatest} available` : "";

    const isAiringPartial = _mainPartial && _mainLatest > 0 && anilistStatusForProgress === "RELEASING";
    const airingDenominator = isAiringPartial ? _mainLatest : null;

    const canonProgressValue = unknownTotal
      ? null
      : airingDenominator
        ? Math.min(100, (Math.min(episodeCount, airingDenominator) / airingDenominator) * 100)
        : hasFillerData
          ? totalCanon > 0
            ? (canonWatched / totalCanon) * 100
            : 0
          : progressData.progress;
    const canonProgressLabel = canonProgressValue == null ? "" : UIHelpers.formatProgressPercent(canonProgressValue);
    const canonProgressWidth = unknownTotal
      ? 0
      : airingDenominator
        ? Math.min(100, (Math.min(episodeCount, airingDenominator) / airingDenominator) * 100)
        : hasFillerData
          ? totalCanon > 0
            ? (canonWatched / totalCanon) * 100
            : 0
          : progressData.progress;

    const totalDisplay = unknownTotal ? null : progressData.total;
    const totalCanonDisplay = unknownTotal ? null : totalCanon;

    const progressInfoText = unknownTotal
      ? anilistStatusForProgress === "FINISHED"
        ? `<span><span class="icon-inline">${UIHelpers.createIcon("canon")}</span> ${currentEpText} · Watched ${episodeCount} eps</span>`
        : `<span><span class="icon-inline">${UIHelpers.createIcon("canon")}</span> ${currentEpText}${availableInfo} · Airing</span>`
      : hasFillerData
        ? `<span title="Canon: ${canonWatched}/${totalCanonDisplay}"><span class="icon-inline">${UIHelpers.createIcon("canon")}</span> ${currentEpText}${availableInfo} · Canon ${canonWatched}/${totalCanonDisplay}</span>`
        : `<span><span class="icon-inline">${UIHelpers.createIcon("canon")}</span> ${currentEpText}${availableInfo} · Total ${episodeCount}/${totalDisplay}</span>`;

    const watchedFillers = fillerInfo?.watched || 0;
    const totalFillers = fillerInfo?.total || 0;
    const fillerProgressPercent = totalFillers > 0 ? Math.round((watchedFillers / totalFillers) * 100) : 0;

    const fillerProgressSection =
      hasFillerData && totalFillers > 0
        ? `
            <div class="progress-container filler-progress">
                <div class="progress-info">
                    <span class="filler-label" title="Watched fillers: ${watchedFillers} · Skipped fillers: ${skippedFillers.length}"><span class="icon-inline">${UIHelpers.createIcon("filler")}</span> Filler ${watchedFillers}/${totalFillers}</span>
                    <span>${fillerProgressPercent}%</span>
                </div>
                <div class="progress-bar filler-bar ${sizeClass}">
                    <div class="progress-fill filler-fill" style="width: ${fillerProgressPercent}%; min-width: ${fillerProgressPercent > 0 ? 2 : 0}px; opacity: 1;"></div>
                </div>
            </div>`
        : "";

    const partsSection = this.createPartsSection(slug, anime.episodes);

    const coverHtml = UIHelpers.renderCoverFigure(anime.title, anime.coverImage);

    const totalWatchedEpisodes = anime.episodes?.length || 0;
    const totalEpisodesPossible = progressData.total || 0;
    const isManuallyCompleted =
      (globalThis.AnimeTrackerEntryState?.getResolvedListState?.(anime) || anime.listState || "active") === "completed";
    const resolvedStatus = StatusService?.getStatus(slug, anime) || "watching";

    const _latestAvail = _mainLatest;
    const _metaTotal = _mainMetaTotal;
    const _isPartiallyUploaded =
      anilistStatusForProgress === "RELEASING" && _metaTotal && _latestAvail && _latestAvail < _metaTotal;

    const isCardComplete = resolvedStatus === "completed";
    const displayTotalRaw = _isPartiallyUploaded && _latestAvail > 0 ? _latestAvail : totalEpisodesPossible;
    const displayTotal = Math.max(Number(displayTotalRaw) || 0, Number(currentEpisode) || 0, Number(_latestAvail) || 0);
    const totalProgressText = displayTotal > 0 ? `${currentEpisode}/${displayTotal}` : `${currentEpisode}`;
    const episodeProgressText = currentEpisode > 0 ? `Ep ${totalProgressText}` : "";
    const isDropped = resolvedStatus === "dropped";
    const isOnHold = resolvedStatus === "on_hold";
    const _isCaughtUpAiring = resolvedStatus === "airing";

    const showProgressBar = !isDropped && !isOnHold && !isCardComplete && !_isCaughtUpAiring;

    let statusTextCard = "";
    if (isDropped) {
      statusTextCard = "Dropped";
    } else if (isOnHold) {
      statusTextCard = "On hold";
    } else if (isCardComplete) {
      statusTextCard = "Completed";
    } else if (_isCaughtUpAiring) {
      statusTextCard = "Airing";
    } else if (totalWatchedEpisodes === 0) {
      statusTextCard = "Not started";
    } else if (!isCardComplete) {
      statusTextCard = "Watching";
    }
    let timeAgoText;
    if (isCardComplete && totalWatchedEpisodes > 0) {
      const startedDate = UIHelpers.getStartedDate(anime);
      const endedDate = anime.completedAt || anime.lastWatched;
      if (startedDate && endedDate) {
        timeAgoText = `${UIHelpers.formatShortDate(startedDate)} / ${UIHelpers.formatShortDate(endedDate)}`;
      } else {
        timeAgoText = anime.lastWatched ? UIHelpers.formatDate(anime.lastWatched) : "Never";
      }
    } else {
      timeAgoText = anime.lastWatched ? UIHelpers.formatDate(anime.lastWatched) : "Never";
    }
    const progressBadge =
      !isCardComplete && !isDropped && !isOnHold && episodeProgressText
        ? `<span class="meta-badge meta-badge-progress">${episodeProgressText}</span>`
        : "";
    const completedTypeBadge = "";
    const statusBadgeClass = isDropped
      ? "meta-badge-dropped"
      : isOnHold
        ? "meta-badge-onhold"
        : isCardComplete
          ? "meta-badge-complete"
          : _isCaughtUpAiring
            ? "meta-badge-airing"
            : totalWatchedEpisodes > 0
              ? "meta-badge-watching"
              : "meta-badge-notstarted";
    const statusBadgeIcon = isDropped
      ? UIHelpers.createIcon("drop")
      : isOnHold
        ? UIHelpers.createIcon("pause")
        : isCardComplete
          ? UIHelpers.createIcon("check")
          : _isCaughtUpAiring
            ? ""
            : UIHelpers.createIcon("watching");
    const statusBadge = `<span class="meta-badge ${statusBadgeClass}">${statusBadgeIcon}${statusTextCard}</span>`;

    const anilistStatus = AnilistService?.getStatus(slug);
    const airingBadge =
      anilistStatus === "RELEASING" && !isDropped && !isOnHold && !_isCaughtUpAiring
        ? `<span class="meta-badge meta-badge-airing" title="Currently airing">Airing</span>`
        : "";

    let inlineEtaHtml = "";
    try {
      const StatsEngine = window.AnimeTracker?.StatsEngine;
      const knownTotalEpisodes = Number(AnilistService?.getTotalEpisodes(slug)) || Number(anime.totalEpisodes) || 0;
      const nextEpisodeAtRaw = AnilistService?.getNextEpisodeAt(slug);
      const nextEpisodeAt = nextEpisodeAtRaw ? new Date(nextEpisodeAtRaw) : null;
      const hasUpcomingCountdown = !!nextEpisodeAt && Number.isFinite(nextEpisodeAt.getTime()) && nextEpisodeAt.getTime() > Date.now();

      if (_isCaughtUpAiring && hasUpcomingCountdown) {
        const diffMs = nextEpisodeAt.getTime() - Date.now();
        const totalMinutes = Math.max(1, Math.floor(diffMs / 60000));
        const days = Math.floor(totalMinutes / (60 * 24));
        const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
        const minutes = totalMinutes % 60;
        const countdownLabel = days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
        const tip = `Estimated time until the next episode on an1me.to: ${nextEpisodeAt.toLocaleString()}`;
        inlineEtaHtml = `<span class="meta-time-eta meta-time-eta-site" title="${UIHelpers.escapeHtml(tip)}">🚀 ${UIHelpers.escapeHtml(countdownLabel)}</span>`;
      } else if (StatsEngine && !isCardComplete && !isDropped && !isOnHold && knownTotalEpisodes > 0) {
        const allAnime = (window.AnimeTracker && window.AnimeTracker._animeDataRef) || null;
        const idx = allAnime ? StatsEngine.buildWatchIndex(allAnime, window.AnimeTracker?.PopupState?.libraryRevision) : null;
        const isAiringLike = anilistStatus === "RELEASING" || _isPartiallyUploaded;
        const watchedEpisodes = Math.max(totalWatchedEpisodes, highestCompletedEp, currentEpisode);
        const targetEpisodes = isAiringLike ? Math.max(_latestAvail || 0, watchedEpisodes, 0) : knownTotalEpisodes;
        const pred = idx
          ? StatsEngine.predictCompletion(
              {
                ...anime,
                slug,
                totalEpisodes: knownTotalEpisodes,
                targetEpisodes: targetEpisodes > 0 ? targetEpisodes : knownTotalEpisodes,
                allowSingleEpisodeForecast: !!(_isCaughtUpAiring && isAiringLike),
              },
              idx,
            )
          : null;
        if (pred) {
          const eta = pred.etaDate;
          let label = eta.toLocaleDateString(undefined, { month: "short", day: "numeric" });
          const tipRate =
            pred.epsPerDay >= 1 ? `${pred.epsPerDay.toFixed(1)} ep/day` : `1 ep every ${Math.max(1, Math.round(1 / pred.epsPerDay))} days`;
          let modelPrefix = "Based on your recent watching pace";
          if (pred.model === "release-aware") {
            modelPrefix = "Based on your recent pace, your overall watch rhythm, and weekly airing cadence";
          } else if (pred.model === "catch-up-aware") {
            modelPrefix = "Based on how fast you usually catch up on this anime and your overall watch rhythm";
          } else if (pred.model === "next-drop-pace") {
            modelPrefix = "Based on how fast you usually clear a new episode of this anime";
          } else {
            modelPrefix = "Based on your recent pace, this anime watch pattern, and your overall watch rhythm";
          }
          const remainingText =
            pred.remaining > 0
              ? `${pred.daysLeft} days left · ${pred.remaining} left`
              : `${pred.daysLeft} day${pred.daysLeft === 1 ? "" : "s"} after a new drop`;
          const rangeText = pred.latestDays > pred.earliestDays ? ` · likely window ${pred.earliestDays}-${pred.latestDays} days` : "";
          const tip = `${modelPrefix}: about ${tipRate}, ${pred.model === "next-drop-pace" ? "you usually catch up" : "you should be caught up"} around ${eta.toLocaleDateString()} (${remainingText}${rangeText} · ${pred.confidence} confidence)`;
          if (pred.model !== "next-drop-pace") {
            inlineEtaHtml = `<span class="meta-time-eta meta-time-eta-ai meta-time-eta-${pred.confidence}" title="${UIHelpers.escapeHtml(tip)}">~${UIHelpers.escapeHtml(label)}</span>`;
          }
        }
      }
    } catch (e) {
      try {
        window.PopupLogger?.debug?.("AnimeCard", "ETA inference failed:", e?.message || e);
      } catch {}
    }

    const headerActionsHtml = `
            <div class="anime-header-actions">
                <button class="anime-edit-title" data-slug="${UIHelpers.escapeHtml(slug)}" title="Edit title">${UIHelpers.createIcon("edit")}</button>
                <button class="anime-delete" data-slug="${UIHelpers.escapeHtml(slug)}" title="Delete">${UIHelpers.createIcon("delete")}</button>
            </div>`;
    const metaRowHtml = `
            <div class="anime-meta-row-wrap">
                <div class="anime-meta-row">${progressBadge}${completedTypeBadge}${statusBadge}${airingBadge}</div>
                <div class="anime-header-controls">
                    ${headerActionsHtml}
                    <div class="anime-expand-icon">${UIHelpers.createIcon("chevron")}</div>
                </div>
            </div>
            <div class="meta-time-row">
                <span class="meta-time">${timeAgoText}</span>
                ${inlineEtaHtml}
                ${
                  showProgressBar
                    ? `<span class="meta-time-progress" title="${Math.round(canonProgressWidth)}% watched">
                    <span class="meta-time-progress-bar" aria-hidden="true"><span class="meta-time-progress-fill" style="width:${canonProgressWidth}%"></span></span>
                    <span class="meta-time-progress-pct">${Math.round(canonProgressWidth)}%</span>
                </span>`
                    : ""
                }
            </div>`;

    return `
            <div class="anime-card" data-slug="${UIHelpers.escapeHtml(slug)}" tabindex="0" role="button" aria-expanded="false" aria-label="${UIHelpers.escapeHtml(anime.title || slug)}, press Enter to expand">
                <div class="anime-card-header">
                    <div class="anime-cover-container" style="flex-shrink:0;">${coverHtml}</div>
                    <div class="anime-header-main" style="flex:1; display:flex; flex-direction:column; min-width:0; margin-left:8px;">
                        <div class="anime-title-row" style="display:flex; align-items:center; overflow:hidden;">
                            ${anime.favorite ? `<span class="anime-favorite-indicator" title="Favorite" aria-label="Favorite">${UIHelpers.createIcon("star-filled")}</span>` : ""}
                            <span class="anime-title-text" style="font-size:14px;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;flex:1;min-width:0;">${UIHelpers.escapeHtml(anime.title)}</span>
                        </div>
                        ${metaRowHtml}
                    </div>
                </div>
                <div class="anime-card-content">
                  <div class="anime-card-content-inner">
                    ${
                      showProgressBar
                        ? `<div class="progress-container header-progress">
                        <div class="progress-info">
                            ${progressInfoText}
                            <span>${canonProgressLabel}</span>
                        </div>
                        <div class="progress-bar ${sizeClass}">
                            <div class="progress-fill" style="width: ${canonProgressWidth}%"></div>
                        </div>
                    </div>`
                        : ""
                    }
                    ${fillerProgressSection}
                    ${partsSection}
                    <div class="anime-meta">
                        ${skippedFillersIndicator}
                    </div>
                    <div class="anime-episodes collapsible collapsed">
                        <div class="episodes-header">
                            <span class="episodes-title">Watched episodes</span>
                            <svg class="collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6 9 12 15 18 9"/>
                            </svg>
                        </div>
                        <div class="episodes-content">
                            <div class="episode-list">${episodeTags}${moreEpisodes}</div>
                            ${unwatchedFillers.length > 0 ? `<div class="unwatched-fillers-section"><span class="unwatched-fillers-label">Unwatched Fillers <span class="filler-count">${unwatchedFillers.length}</span></span><div class="episode-list">${unwatchedFillerTags}${showMoreFillers}</div></div>` : ""}
                        </div>
                    </div>
                    <div class="anime-card-actions">
                        <button class="anime-favorite-toggle${anime.favorite ? " is-favorite" : ""}" data-slug="${UIHelpers.escapeHtml(slug)}" data-favorite="${!!anime.favorite}" title="${anime.favorite ? "Remove from favorites" : "Mark as favorite"}" aria-pressed="${!!anime.favorite}">${UIHelpers.createIcon(anime.favorite ? "star-filled" : "star")}<span>${anime.favorite ? "Favorited" : "Favorite"}</span></button>
                        <button class="anime-onhold-toggle" data-slug="${UIHelpers.escapeHtml(slug)}" data-onhold="${isOnHold}" title="${isOnHold ? "Resume watching" : "Put on hold"}">${UIHelpers.createIcon("pause")}<span>${isOnHold ? "Resume" : "Hold"}</span></button>
                        <button class="anime-complete-toggle" data-slug="${UIHelpers.escapeHtml(slug)}" data-completed="${isManuallyCompleted}" title="${isManuallyCompleted ? "Unmark as completed" : "Mark as completed"}">${UIHelpers.createIcon("check")}<span>${isManuallyCompleted ? "Undo" : "Complete"}</span></button>
                        <button class="anime-drop-toggle" data-slug="${UIHelpers.escapeHtml(slug)}" data-dropped="${isDropped}" title="${isDropped ? "Unmark as dropped" : "Drop"}">${UIHelpers.createIcon("drop")}<span>${isDropped ? "Undrop" : "Drop"}</span></button>
                    </div>
                  </div>
                </div>
            </div>
        `;
  },

  createPartsSection(slug, episodes = [], startExpanded = false) {
    const { ANIME_PARTS_CONFIG, CONFIG, FillerService, UIHelpers } = window.AnimeTracker;

    const partsConfig = ANIME_PARTS_CONFIG?.[slug];
    if (!partsConfig || partsConfig.length === 0) {
      return "";
    }

    const watchedEpisodes = new Set(episodes.map((ep) => ep.number));

    const partsHTML = partsConfig
      .map((part) => {
        let watchedInPart = 0;
        const watchedEpisodesInPart = [];
        for (let ep = part.start; ep <= part.end; ep++) {
          if (watchedEpisodes.has(ep)) {
            watchedInPart++;
            watchedEpisodesInPart.push(ep);
          }
        }

        const totalInPart = part.end - part.start + 1;
        const progressPercent = Math.round((watchedInPart / totalInPart) * 100);
        const isComplete = watchedInPart === totalInPart;
        const hasProgress = watchedInPart > 0;

        const statusClass = isComplete ? "complete" : hasProgress ? "in-progress" : "not-started";
        const statusIcon = isComplete ? "✓" : hasProgress ? "▶" : "○";

        const sortedEps = watchedEpisodesInPart.sort((a, b) => b - a);
        const visibleEps = sortedEps.slice(0, CONFIG.VISIBLE_EPISODES_LIMIT);
        const hiddenEps = sortedEps.slice(CONFIG.VISIBLE_EPISODES_LIMIT);

        const episodeTags = visibleEps
          .map((epNum) => {
            const isFiller = FillerService.isFillerEpisode(slug, epNum);
            return `<span class="episode-tag${isFiller ? " filler watched-filler" : ""}">Ep ${epNum}</span>`;
          })
          .join("");

        const hiddenEpisodeTags = hiddenEps
          .map((epNum) => {
            const isFiller = FillerService.isFillerEpisode(slug, epNum);
            return `<span class="episode-tag${isFiller ? " filler watched-filler" : ""}">Ep ${epNum}</span>`;
          })
          .join("");

        const moreEpisodes =
          hiddenEps.length > 0
            ? `<div class="hidden-episodes">${hiddenEpisodeTags}</div><span class="episode-tag show-more-episodes" data-more-text="+${hiddenEps.length} more" data-less-text="Show less">+${hiddenEps.length} more</span>`
            : "";

        return `
                <div class="part-item ${statusClass}" data-part-start="${part.start}" data-part-end="${part.end}">
                    <div class="part-item-header">
                        <span class="part-status-icon">${statusIcon}</span>
                        <span class="part-name">${UIHelpers.escapeHtml(part.name)}</span>
                        <span class="part-episodes">Ep ${part.start}-${part.end}</span>
                        <span class="part-progress">${watchedInPart}/${totalInPart}</span>
                        <div class="part-expand-icon">${UIHelpers.createIcon("chevron")}</div>
                    </div>
                    <div class="part-item-content">
                        <div class="part-progress-bar">
                            <div class="progress-bar size-small">
                                <div class="progress-fill" style="width: ${progressPercent}%"></div>
                            </div>
                        </div>
                        <div class="part-episodes-list">
                            <div class="episode-list">${episodeTags}${moreEpisodes}</div>
                        </div>
                    </div>
                </div>
            `;
      })
      .join("");

    const collapsedClass = startExpanded ? "" : " collapsed";
    return `
            <div class="anime-parts collapsible${collapsedClass}">
                <div class="parts-header">
                    <span class="parts-icon">📦</span>
                    <span class="parts-title">Parts (${partsConfig.length})</span>
                    <svg class="collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </div>
                <div class="parts-content">
                    ${partsHTML}
                </div>
            </div>
        `;
  },

  createInProgressItem(anime) {
    return "";
  },

  createInProgressGroup() {
    return "";
  },
  createSeasonGroup() {
    return "";
  },
  createMovieGroup() {
    return "";
  },
  createSingleMovieCard() {
    return "";
  },
  extractBaseTitle(title) {
    return title;
  },
  extractMovieBaseTitle(title) {
    return title;
  },
};

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.AnimeCardRenderer = AnimeCardRenderer;
// anime-card-inprogress.js — extends AnimeCardRenderer with the "in progress" card variant.
(function () {
  "use strict";

  const AT = (window.AnimeTracker = window.AnimeTracker || {});
  const AnimeCardRenderer = (AT.AnimeCardRenderer = AT.AnimeCardRenderer || {});

  Object.assign(AnimeCardRenderer, {
    createInProgressItem(anime) {
      const { UIHelpers, CONFIG } = window.AnimeTracker;

      const activeEpisodes = anime.episodes.filter((ep) => ep.percentage < CONFIG.COMPLETED_PERCENTAGE);
      if (activeEpisodes.length === 0) return "";

      const latestEp = [...activeEpisodes].sort((a, b) => {
        const aTime = a.savedAt ? new Date(a.savedAt).getTime() : 0;
        const bTime = b.savedAt ? new Date(b.savedAt).getTime() : 0;
        return bTime - aTime || b.number - a.number;
      })[0];
      const currentMin = Math.floor(latestEp.currentTime / 60);
      const currentSec = Math.floor(latestEp.currentTime % 60);
      const currentTimeStr = `${currentMin}:${currentSec.toString().padStart(2, "0")}`;

      const durationMin = Math.floor((latestEp.duration || 0) / 60);
      const durationStr = durationMin > 0 ? `${durationMin}m` : "?";

      const remainingTime = Math.max(0, (latestEp.duration || 0) - latestEp.currentTime);
      const remainingMin = Math.ceil(remainingTime / 60);
      const remainingStr = remainingMin > 0 ? `${remainingMin}m left` : "Done";

      const pct = Math.round(latestEp.percentage);
      const safeSlug = UIHelpers.escapeHtml(anime.slug);
      const cardClass = anime.isResumeOnly ? "ip-card ip-card-untracked" : "ip-card";

      const safeCoverImage = UIHelpers.sanitizeImageUrl(anime.coverImage);
      const coverHtml = safeCoverImage
        ? `<span class="ip-cover-wrap"><img class="ip-cover" src="${UIHelpers.escapeHtml(safeCoverImage)}" alt=""></span>`
        : `<span class="ip-cover-wrap"><span class="ip-cover-placeholder">&#9654;</span></span>`;

      const savedDate = latestEp.savedAt ? new Date(latestEp.savedAt) : null;
      const now = new Date();
      let savedTimeStr = "just now";
      if (savedDate) {
        const diffMs = now - savedDate;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) savedTimeStr = "just now";
        else if (diffMins < 60) savedTimeStr = `${diffMins}m ago`;
        else if (diffHours < 24) savedTimeStr = `${diffHours}h ago`;
        else if (diffDays < 7) savedTimeStr = `${diffDays}d ago`;
        else savedTimeStr = savedDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      }

      const watchedDate = latestEp.watchedAt ? new Date(latestEp.watchedAt) : null;
      let watchedDateStr = "";
      if (watchedDate) {
        watchedDateStr = watchedDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      }

      const continuePathSlug = latestEp.pagePath
        ? UIHelpers.escapeHtml(latestEp.pagePath)
        : `${UIHelpers.escapeHtml(anime.slug)}-episode-${latestEp.number}`;
      const continueUrl = `https://an1me.to/watch/${continuePathSlug}`;

      return `
                <div class="${cardClass}" data-slug="${safeSlug}">
                    <div class="ip-header">
                        ${coverHtml}
                        <div class="ip-body">
                            <div class="ip-title-row">
                                <span class="ip-title">${UIHelpers.escapeHtml(anime.title)}</span>
                                <span class="ip-pct-badge">${pct}%</span>
                                <button class="ip-delete-btn" data-slug="${safeSlug}" data-episode="${latestEp.number}" title="Delete progress">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>
                            <div class="ip-meta">
                                <span class="ip-meta-item">Ep ${latestEp.number}</span>
                                <span class="ip-meta-sep">·</span>
                                <span class="ip-meta-item">${currentTimeStr} / ${durationStr}</span>
                                <span class="ip-meta-sep">·</span>
                                <span class="ip-meta-time">${watchedDateStr ? `Started ${watchedDateStr}` : savedTimeStr}</span>
                            </div>
                            <div class="ip-progress">
                                <div class="ip-bar"><div class="ip-fill" style="width:${pct}%"></div></div>
                                <span class="ip-remaining">${remainingStr}</span>
                            </div>
                            <a class="ip-continue-btn" href="${continueUrl}" target="_blank" rel="noopener noreferrer" title="Continue watching Ep ${latestEp.number}">
                                <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                Resume
                            </a>
                        </div>
                    </div>
                </div>`;
    },

    createInProgressGroup(inProgressItems) {
      if (!inProgressItems || inProgressItems.length === 0) return "";

      const trackedItems = inProgressItems.filter((anime) => !anime.isResumeOnly);
      const resumeOnlyItems = inProgressItems.filter((anime) => anime.isResumeOnly);

      const trackedHtml = trackedItems.map((anime) => this.createInProgressItem(anime)).join("");
      const resumeOnlyHtml = resumeOnlyItems.map((anime) => this.createInProgressItem(anime)).join("");
      const separatorHtml =
        trackedHtml && resumeOnlyHtml
          ? `
                    <div class="ip-group-separator" role="separator" aria-label="Not tracked yet">
                        <span class="ip-group-separator-line"></span>
                        <span class="ip-group-separator-label">Not Tracked Yet</span>
                        <span class="ip-group-separator-line"></span>
                    </div>`
          : "";
      const count = inProgressItems.length;

      return `
                <div class="ip-group">
                    <div class="ip-group-header">
                        <span class="ip-group-label">In Progress</span>
                        <span class="ip-group-count">${count}</span>
                        <svg class="ip-group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform:rotate(-90deg);">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </div>
                    <div class="ip-group-content">
                        <div class="ip-group-content-inner">
                            ${trackedHtml}
                            ${separatorHtml}
                            ${resumeOnlyHtml}
                        </div>
                    </div>
                </div>`;
    },
  });
})();
// anime-card-group.js — extends AnimeCardRenderer to group multiple seasons into one card.
(function () {
  "use strict";

  const AT = (window.AnimeTracker = window.AnimeTracker || {});
  const AnimeCardRenderer = (AT.AnimeCardRenderer = AT.AnimeCardRenderer || {});

  const VARIANT = {
    season: {
      card: "anime-season-group",
      header: "season-group-header",
      item: "season-item",
      itemHeader: "season-item-header",
      itemRight: "season-item-right",
      label: "season-label",
    },
    movie: {
      card: "anime-movie-group",
      header: "movie-group-header",
      item: "movie-item",
      itemHeader: "movie-item-header",
      itemRight: "movie-item-right",
      label: "movie-label",
    },
  };

  Object.assign(AnimeCardRenderer, {
    renderGroupShell({ variant, baseSlug, extraClass = "", coverHtml, title, metaRowHtml, itemsHtml }) {
      const { UIHelpers } = window.AnimeTracker;
      const v = VARIANT[variant];
      return `
                <div class="grp-card ${v.card}${extraClass ? " " + extraClass : ""}" data-base-slug="${baseSlug}">
                    <div class="grp-header ${v.header}">
                        <div class="grp-logo">${coverHtml}</div>
                        <div class="grp-header-main">
                            <div class="grp-title-row"><span class="grp-name">${title}</span></div>
                            ${metaRowHtml}
                        </div>
                        <div class="grp-actions">
                            <div class="grp-expand-icon">${UIHelpers.createIcon("chevron")}</div>
                        </div>
                    </div>
                    <div class="grp-content">
                        ${itemsHtml}
                    </div>
                </div>
            `;
    },

    renderGroupItem({ variant, slug, statusClass, statusIcon, label, rightHtml, contentHtml = "", extraItemClass = "" }) {
      const { UIHelpers } = window.AnimeTracker;
      const v = VARIANT[variant];
      return `
                <div class="grp-item ${v.item} ${statusClass}${extraItemClass ? " " + extraItemClass : ""}" data-slug="${UIHelpers.escapeHtml(slug)}">
                    <div class="grp-item-header ${v.itemHeader}">
                        <div class="grp-item-left">
                            <span class="grp-status-icon${statusIcon ? "" : " is-empty"}"${statusIcon ? "" : ' aria-hidden="true"'}>${statusIcon || ""}</span>
                            <span class="${v.label}" title="${label}">${label}</span>
                        </div>
                        <div class="${v.itemRight}">
                            ${rightHtml}
                        </div>
                    </div>
                    ${contentHtml}
                </div>
            `;
    },

    getEntryStatusView(slug, anime) {
      const status = window.AnimeTracker.StatusService?.getStatus?.(slug, anime) || "watching";
      const hasActivity =
        (Array.isArray(anime?.episodes) && anime.episodes.length > 0) ||
        Number(anime?.totalWatchTime) > 0 ||
        !!anime?.lastWatched;
      if (status === "completed") {
        return { status, text: "Completed", itemClass: "complete", badgeClass: "meta-badge-complete", icon: "check", hasActivity: true };
      }
      if (status === "dropped") {
        return { status, text: "Dropped", itemClass: "in-progress", badgeClass: "meta-badge-dropped", icon: "drop", hasActivity };
      }
      if (status === "on_hold") {
        return { status, text: "On hold", itemClass: "in-progress", badgeClass: "meta-badge-onhold", icon: "pause", hasActivity };
      }
      if (status === "airing") {
        return { status, text: "Airing", itemClass: "in-progress", badgeClass: "meta-badge-airing", icon: null, hasActivity: true };
      }
      if (hasActivity) {
        return { status, text: "Watching", itemClass: "in-progress", badgeClass: "meta-badge-watching", icon: "watching", hasActivity };
      }
      return { status: "not_started", text: "Not started", itemClass: "not-started", badgeClass: "meta-badge-notstarted", icon: null, hasActivity };
    },

    getGroupStatusView(entries) {
      const views = entries.map(({ slug, anime }) => this.getEntryStatusView(slug, anime));
      return (
        views.find((view) => view.status === "watching" && view.hasActivity) ||
        views.find((view) => view.status === "airing") ||
        views.find((view) => view.status === "on_hold") ||
        views.find((view) => view.status === "dropped") ||
        views.find((view) => view.status === "not_started") ||
        views.find((view) => view.status === "completed") ||
        this.getEntryStatusView("", null)
      );
    },

    createSeasonGroup(baseSlug, seasons, videoProgress = {}, groupMeta = null) {
      const { UIHelpers, SeasonGrouping, FillerService, ANIME_PARTS_CONFIG, SlugUtils } = window.AnimeTracker;
      const AnilistService = window.AnimeTracker.AnilistService;
      const isChronologyGroup = SeasonGrouping.isChronologyGroup(baseSlug);
      const canonicalPartParents = new Set(
        seasons.filter((season) => (ANIME_PARTS_CONFIG?.[season.slug] || []).length > 0).map((season) => season.slug),
      );
      const filteredSeasons = seasons.filter((season) => {
        if (canonicalPartParents.size === 0) return true;
        const canonicalSlug = SlugUtils?.getCanonicalSlug?.(season.slug, season.anime?.title || "") || season.slug;
        return !canonicalPartParents.has(canonicalSlug) || season.slug === canonicalSlug;
      });

      const firstSeason = filteredSeasons[0] || seasons[0];
      const baseTitle = SeasonGrouping.getGroupDisplayTitle(
        baseSlug,
        this.extractBaseTitle(groupMeta?.familyTitle || firstSeason.anime.title),
      );

      const groupImages = (window.AnimeTracker && window.AnimeTracker.groupCoverImages) || {};
      const coverImageGroup =
        groupImages[baseSlug] || (firstSeason?.anime && firstSeason.anime.coverImage ? firstSeason.anime.coverImage : null);
      const coverHtmlGroup = UIHelpers.renderCoverFigure(baseTitle, coverImageGroup);

      let latestWatched = null;

      filteredSeasons.forEach(({ anime }) => {
        if (anime.lastWatched) {
          const date = new Date(anime.lastWatched);
          if (!latestWatched || date > latestWatched) {
            latestWatched = date;
          }
        }
      });

      const expandedSeasons = [];
      for (const season of filteredSeasons) {
        const partsConfig = ANIME_PARTS_CONFIG?.[season.slug];
        if (partsConfig && partsConfig.length > 0) {
          partsConfig.forEach((part, partIndex) => {
            expandedSeasons.push({
              ...season,
              slug: season.slug,
              anime: season.anime,
              seasonNum: season.seasonNum,
              partConfig: part,
              partIndex,
            });
          });
        } else {
          expandedSeasons.push({ ...season, partConfig: null, partIndex: null });
        }
      }

      const computeSeasonLabel = ({ slug, anime, partConfig, isMovie: isMergedMovie, groupLabel }, index) => {
        if (partConfig) return partConfig.name;
        if (groupLabel) return groupLabel;
        if (isChronologyGroup) {
          const info = SeasonGrouping.getChronologyInfo(baseSlug, slug, anime.title);
          return info?.itemLabel || anime.title || slug;
        }
        if (isMergedMovie || SeasonGrouping.isMovie(slug, anime)) {
          return SeasonGrouping.getMovieLabel(slug, anime.title);
        }
        if (baseSlug === "naruto" && seasons.length > 1) {
          if (index === 0) return "Naruto";
          if (index === 1) return "Shippuden";
          if (index === 2) return "Boruto";
          return `Season ${index + 1}`;
        }
        return SeasonGrouping.getSeasonLabel(slug, anime.title, anime);
      };

      // Arc-named sequel slugs ("mashle-shinkakusha-...-hen") carry no season
      // marker and collapse onto the same "Season N" label — disambiguate later
      // occurrences with the distinctive part of their own title.
      const resolvedLabels = expandedSeasons.map(computeSeasonLabel);
      const seenLabels = new Map();
      resolvedLabels.forEach((label, i) => {
        const count = (seenLabels.get(label) || 0) + 1;
        seenLabels.set(label, count);
        if (count === 1) return;
        const title = String(expandedSeasons[i].anime?.title || "").trim();
        let distinct = "";
        if (title) {
          const escaped = baseTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          distinct = title
            .replace(new RegExp(`^${escaped}`, "i"), "")
            .replace(/^[\s:\-–—]+/, "")
            .trim();
        }
        resolvedLabels[i] = distinct && distinct.toLowerCase() !== title.toLowerCase() ? distinct : `${label} (${count})`;
      });

      const seasonData = expandedSeasons.map(({ slug, anime, partConfig, isMovie: isMergedMovie }, index) => {
        const { CONFIG } = window.AnimeTracker;
        const episodeCount = anime.episodes?.length || 0;
        const chronologyInfo = isChronologyGroup ? SeasonGrouping.getChronologyInfo(baseSlug, slug, anime.title) : null;
        const separatorLabel = chronologyInfo?.separatorLabel || null;

        let seasonLabel = resolvedLabels[index];

        const isMovie =
          !partConfig &&
          (isMergedMovie === true || seasonLabel.includes("(Movie)") || slug.includes("third-stage") || SeasonGrouping.isMovie(slug, anime));

        let progressData, progressPercent, isComplete, hasProgress, statusClass, statusIcon;
        let episodeBadgeText, progressInfoHTML, episodesHTML;

        if (isMovie) {
          const watchTime = anime.totalWatchTime || 0;
          const formattedTime = UIHelpers.formatDuration(watchTime);
          const isWatched = this.isMovieWatched(anime);

          isComplete = isWatched;
          hasProgress = isWatched;
          statusClass = isComplete ? "complete" : "not-started";
          statusIcon = "";

          episodeBadgeText = formattedTime || "—";
          progressInfoHTML = "";
          episodesHTML = "";
        } else {
          const partEpisodes = partConfig
            ? (anime.episodes || []).filter((ep) => ep.number >= partConfig.start && ep.number <= partConfig.end)
            : anime.episodes || [];
          const partEpisodeCount = partConfig ? partConfig.end - partConfig.start + 1 : episodeCount;
          const watchedInPart = partEpisodes.length;

          if (partConfig) {
            const displayStart = Number.isFinite(partConfig.displayStart) ? partConfig.displayStart : partConfig.start;
            const displayEnd = Number.isFinite(partConfig.displayEnd) ? partConfig.displayEnd : partConfig.end;
            const toDisplayEpisodeNumber = (episodeNumber) =>
              Number.isFinite(partConfig.displayStart) ? episodeNumber - partConfig.start + displayStart : episodeNumber;
            const partProgress = (watchedInPart / partEpisodeCount) * 100;
            progressPercent = Math.round(partProgress);
            const progressLabel = UIHelpers.formatProgressPercent(partProgress);
            isComplete = watchedInPart >= partEpisodeCount;
            hasProgress = watchedInPart > 0;
            statusClass = isComplete ? "complete" : hasProgress ? "in-progress" : "not-started";
            statusIcon = isComplete ? "✓" : hasProgress ? "▶" : "○";
            episodeBadgeText = `Ep ${displayStart}-${displayEnd}`;

            progressInfoHTML = `
                            <div class="progress-info">
                                <span>Ep ${partConfig.start}–${partConfig.end} · ${watchedInPart}/${partEpisodeCount}</span>
                                <span>${progressLabel}</span>
                            </div>
                            <div class="progress-bar size-small">
                                <div class="progress-fill" style="width: ${partProgress}%"></div>
                            </div>
                        `;

            const sortedPartEps = [...partEpisodes].sort((a, b) => b.number - a.number);
            const visiblePartEps = sortedPartEps.slice(0, CONFIG.VISIBLE_EPISODES_LIMIT);
            const hiddenPartEps = sortedPartEps.slice(CONFIG.VISIBLE_EPISODES_LIMIT);
            const partEpTags = visiblePartEps
              .map((ep) => {
                const isFiller = FillerService.isFillerEpisode(slug, ep.number);
                return `<span class="episode-tag${isFiller ? " filler watched-filler" : ""}">Ep ${toDisplayEpisodeNumber(ep.number)}</span>`;
              })
              .join("");
            const partHiddenTags = hiddenPartEps
              .map((ep) => {
                const isFiller = FillerService.isFillerEpisode(slug, ep.number);
                return `<span class="episode-tag${isFiller ? " filler watched-filler" : ""}">Ep ${toDisplayEpisodeNumber(ep.number)}</span>`;
              })
              .join("");
            const partMoreEps =
              hiddenPartEps.length > 0
                ? `<div class="hidden-episodes">${partHiddenTags}</div><span class="episode-tag show-more-episodes" data-more-text="+${hiddenPartEps.length} more" data-less-text="Show less">+${hiddenPartEps.length} more</span>`
                : "";

            episodesHTML =
              watchedInPart > 0
                ? `
                            <div class="season-episodes">
                                <div class="episode-list">${partEpTags}${partMoreEps}</div>
                            </div>`
                : "";
          } else {
            progressData = FillerService.calculateProgress(episodeCount, slug, anime);
            progressPercent = Math.round(progressData.progress);

            const trackedEpNums = new Set((anime.episodes || []).map((ep) => ep.number));
            const inProgressEps = [];
            Object.entries(videoProgress).forEach(([uid, prog]) => {
              if (!uid.startsWith(slug + "__episode-")) return;
              const epNum = parseInt(uid.split("__episode-")[1], 10);
              if (isNaN(epNum) || trackedEpNums.has(epNum)) return;
              if (prog.deleted) return;
              if (prog.percentage >= CONFIG.COMPLETED_PERCENTAGE) return;
              if (typeof prog.currentTime !== "number" || isNaN(prog.currentTime)) return;
              const mins = Math.floor(prog.currentTime / 60);
              const secs = Math.floor(prog.currentTime % 60);
              inProgressEps.push({ number: epNum, timeStr: `${mins}:${secs.toString().padStart(2, "0")}`, percentage: prog.percentage });
            });
            inProgressEps.sort((a, b) => a.number - b.number);

            let currentEp = 0;
            if (anime.episodes?.length > 0) {
              const validNumbers = anime.episodes.map((ep) => ep.number).filter((n) => !isNaN(n) && n > 0);
              if (validNumbers.length > 0) {
                currentEp = Math.max(...validNumbers);
              }
            }
            if (inProgressEps.length > 0) {
              currentEp = Math.max(currentEp, Math.max(...inProgressEps.map((ep) => ep.number)));
            }

            const _sInfo = window.AnimeTracker.StatusService?.getAuthoritativeSiteInfo?.(slug, anime);
            const anilistSt = _sInfo ? _sInfo.status || anime.releaseStatus || null : anime.releaseStatus || AnilistService?.getStatus(slug);
            const _sLatest = _sInfo ? _sInfo.latestEpisode : AnilistService?.getLatestEpisode(slug);
            const _sMetaTotal = _sInfo ? _sInfo.totalEpisodes : AnilistService?.getTotalEpisodes(slug);
            const _sPartial = anilistSt === "RELEASING" && _sMetaTotal && _sLatest && _sLatest < _sMetaTotal;
            if (progressData.progress === null) {
              isComplete = false;
              hasProgress = episodeCount > 0;
              progressPercent = 0;
            } else {
              isComplete = progressData.progress >= 100 && !_sPartial;
              if (!isComplete && !_sPartial && anime.episodes?.length > 0) {
                const totalEps = FillerService.getTotalEpisodes(slug, anime);
                if (totalEps && currentEp >= totalEps) isComplete = true;
              }
              hasProgress = progressPercent > 0 || episodeCount > 0;
            }
            statusClass = isComplete ? "complete" : hasProgress ? "in-progress" : "not-started";
            statusIcon = isComplete ? "✓" : hasProgress ? "▶" : "○";

            if (currentEp > 0 && _sPartial && _sLatest > 0) {
              episodeBadgeText = `Ep ${currentEp}/${_sLatest}`;
            } else if (currentEp > 0) {
              episodeBadgeText = `Ep ${currentEp}`;
            } else {
              episodeBadgeText = `${episodeCount} eps`;
            }

            const hasFillerData = FillerService.hasFillerData(slug);
            const canonWatched = FillerService.getCanonEpisodeCount(slug, anime.episodes);
            const totalCanon = FillerService.getTotalCanonEpisodes(slug, progressData.total || episodeCount);
            const fillerInfo = FillerService.getFillerInfo(slug, anime.episodes, anime);
            const fillerEpisodeBound = anilistSt === "FINISHED" ? Number(_sMetaTotal) || currentEp : currentEp;
            const skippedFillers = FillerService.getSkippedFillers(
              slug,
              anime.episodes,
              fillerEpisodeBound,
              anilistSt === "FINISHED",
            );
            const skippedFillersText = FillerService.formatSkippedFillersCompact(skippedFillers);
            const skippedFillersIndicator =
              skippedFillers.length > 0
                ? `<div class="anime-meta"><span class="skipped-fillers-badge" title="Skipped filler episodes: ${skippedFillersText}"><span class="icon-inline">${UIHelpers.createIcon("skip")}</span> ${skippedFillers.length} filler skipped</span></div>`
                : "";

            const sortedEpisodes = [...(anime.episodes || [])].sort((a, b) => b.number - a.number);
            const visibleEpisodes = sortedEpisodes.slice(0, CONFIG.VISIBLE_EPISODES_LIMIT);
            const hiddenEpisodes = sortedEpisodes.slice(CONFIG.VISIBLE_EPISODES_LIMIT);

            const episodeTags = visibleEpisodes
              .map((ep) => {
                const isFiller = FillerService.isFillerEpisode(slug, ep.number);
                return `<span class="episode-tag${isFiller ? " filler watched-filler" : ""}" title="${isFiller ? "Filler Episode (Watched)" : ""}">Ep ${ep.number}</span>`;
              })
              .join("");

            const hiddenEpisodeTags = hiddenEpisodes
              .map((ep) => {
                const isFiller = FillerService.isFillerEpisode(slug, ep.number);
                return `<span class="episode-tag${isFiller ? " filler watched-filler" : ""}" title="${isFiller ? "Filler Episode (Watched)" : ""}">Ep ${ep.number}</span>`;
              })
              .join("");

            const moreEpisodes =
              hiddenEpisodes.length > 0
                ? `<div class="hidden-episodes">${hiddenEpisodeTags}</div><span class="episode-tag show-more-episodes" data-more-text="+${hiddenEpisodes.length} more" data-less-text="Show less">+${hiddenEpisodes.length} more</span>`
                : "";

            const unwatchedFillers = FillerService.getUnwatchedFillers(slug, anime.episodes, fillerEpisodeBound).slice().reverse();
            const visibleUFillers = unwatchedFillers.slice(0, CONFIG.VISIBLE_FILLERS_LIMIT);
            const hiddenUFillers = unwatchedFillers.slice(CONFIG.VISIBLE_FILLERS_LIMIT);
            const unwatchedFillerTags = visibleUFillers
              .map((epNum) => `<span class="episode-tag filler unwatched-filler" title="Filler Episode (Not watched)">Ep ${epNum}</span>`)
              .join("");
            const hiddenFillerTags = hiddenUFillers
              .map((epNum) => `<span class="episode-tag filler unwatched-filler" title="Filler Episode (Not watched)">Ep ${epNum}</span>`)
              .join("");
            const showMoreFillers =
              hiddenUFillers.length > 0
                ? `<div class="hidden-fillers">${hiddenFillerTags}</div><span class="episode-tag filler show-more-fillers" data-more-text="+${hiddenUFillers.length} more" data-less-text="Show less">+${hiddenUFillers.length} more</span>`
                : "";
            const unwatchedFillersSection =
              unwatchedFillers.length > 0
                ? `<div class="unwatched-fillers-section"><span class="unwatched-fillers-label">Unwatched Fillers <span class="filler-count">${unwatchedFillers.length}</span></span><div class="episode-list">${unwatchedFillerTags}${showMoreFillers}</div></div>`
                : "";

            const watchedFillerCount = fillerInfo?.watched || 0;
            const totalFillerCount = fillerInfo?.total || 0;
            const fillerProgressPercent = totalFillerCount > 0 ? Math.round((watchedFillerCount / totalFillerCount) * 100) : 0;
            const fillerProgressBar =
              hasFillerData && totalFillerCount > 0
                ? `
                        <div class="progress-container filler-progress">
                            <div class="progress-info">
                                <span class="filler-label" title="Watched fillers: ${watchedFillerCount} · Skipped fillers: ${skippedFillers.length}"><span class="icon-inline">${UIHelpers.createIcon("filler")}</span> Filler ${watchedFillerCount}/${totalFillerCount}</span>
                                <span>${fillerProgressPercent}%</span>
                            </div>
                            <div class="progress-bar filler-bar size-small">
                                <div class="progress-fill filler-fill" style="width: ${fillerProgressPercent}%; min-width: ${fillerProgressPercent > 0 ? 2 : 0}px; opacity: 1;"></div>
                            </div>
                        </div>`
                : "";

            const unknownTotalSeason = progressData.total == null;
            const totalDisplay = unknownTotalSeason ? null : progressData.total;
            const totalCanonDisplay = unknownTotalSeason ? null : totalCanon;
            const canonProgressValue = unknownTotalSeason
              ? isComplete
                ? 100
                : 0
              : hasFillerData
                ? totalCanon > 0
                  ? (canonWatched / totalCanon) * 100
                  : 0
                : progressData.progress;
            const canonProgressLabel = UIHelpers.formatProgressPercent(canonProgressValue);
            const canonProgressWidth = unknownTotalSeason
              ? isComplete
                ? 100
                : 0
              : hasFillerData
                ? totalCanon > 0
                  ? (canonWatched / totalCanon) * 100
                  : 0
                : progressData.progress;

            const latestAvailEp = _sLatest || null;
            const availableText = latestAvailEp && latestAvailEp > 0 && _sPartial ? ` / ${latestAvailEp} available` : "";

            const progressInfoText = unknownTotalSeason
              ? anilistSt === "FINISHED"
                ? `<span><span class="icon-inline">${UIHelpers.createIcon("canon")}</span> Ep ${currentEp > 0 ? currentEp : episodeCount} · Watched ${episodeCount} eps</span>`
                : `<span><span class="icon-inline">${UIHelpers.createIcon("canon")}</span> Ep ${currentEp > 0 ? currentEp : episodeCount}${availableText} · Airing</span>`
              : hasFillerData
                ? `<span title="Canon: ${canonWatched}/${totalCanonDisplay}"><span class="icon-inline">${UIHelpers.createIcon("canon")}</span> Ep ${currentEp > 0 ? currentEp : episodeCount}${availableText} · Canon ${canonWatched}/${totalCanonDisplay}</span>`
                : `<span>Ep ${currentEp > 0 ? currentEp : episodeCount}${availableText} · Total ${episodeCount}/${totalDisplay}</span>`;

            progressInfoHTML = `
                        <div class="progress-info">
                            ${progressInfoText}
                            <span>${canonProgressValue > 0 ? canonProgressLabel : ""}</span>
                        </div>
                        <div class="progress-bar size-small">
                            <div class="progress-fill" style="width: ${canonProgressWidth}%"></div>
                        </div>
                        ${fillerProgressBar}
                        ${skippedFillersIndicator}
                    `;

            const inProgressTags = inProgressEps
              .map(
                (ep) =>
                  `<span class="episode-tag in-progress" title="Saved: ${ep.percentage}%">
                            Ep ${ep.number} (${ep.timeStr})
                            <button class="progress-delete-btn" data-slug="${UIHelpers.escapeHtml(slug)}" data-episode="${ep.number}" title="Delete progress">×</button>
                        </span>`,
              )
              .join("");
            const inProgressSection = inProgressTags
              ? `
                        <div class="anime-in-progress collapsible">
                            <div class="in-progress-header">
                                <span class="in-progress-title">▶ In Progress (${inProgressEps.length})</span>
                                <svg class="collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="6 9 12 15 18 9"/>
                                </svg>
                            </div>
                            <div class="in-progress-content">
                                <div class="episode-list">${inProgressTags}</div>
                            </div>
                        </div>`
              : "";

            episodesHTML = `
                        <div class="season-episodes">
                            ${inProgressSection}
                            <div class="episode-list">${episodeTags}${moreEpisodes}</div>
                            ${unwatchedFillersSection}
                        </div>
                    `;
          }
        }

        const memberStatusView = this.getEntryStatusView(slug, anime);
        isComplete = memberStatusView.status === "completed";
        hasProgress = memberStatusView.hasActivity || !["not_started"].includes(memberStatusView.status);
        statusClass = memberStatusView.itemClass;
        statusIcon = memberStatusView.icon ? UIHelpers.createIcon(memberStatusView.icon) : "";
        const memberStatusIcon = memberStatusView.icon ? UIHelpers.createIcon(memberStatusView.icon) : "";
        const memberStatusBadgeHtml = `<span class="meta-badge grp-state-badge ${memberStatusView.badgeClass}">${memberStatusIcon}${memberStatusView.text}</span>`;

        const hasExpandableContent = !isMovie;
        const expandIconHtml = hasExpandableContent
          ? `<div class="season-expand-icon grp-row-chevron">${UIHelpers.createIcon("chevron")}</div>`
          : "";
        const movieOpenIconHtml = isMovie
          ? `<button type="button" class="season-expand-icon grp-row-chevron movie-open-link" data-slug="${UIHelpers.escapeHtml(slug)}" title="Open anime page" aria-label="Open anime page">${UIHelpers.createIcon("chevron")}</button>`
          : "";
        const contentHtml = hasExpandableContent
          ? `<div class="season-item-content">
                            <div class="season-progress-container">
                                ${progressInfoHTML}
                            </div>
                            ${episodesHTML}
                        </div>`
          : "";

        const movieTypeBadgeHtml = '<span class="meta-badge season-movie-type-badge grp-type-badge">Movie</span>';
        const rightSideHtml = isMovie
          ? `${movieTypeBadgeHtml}${memberStatusBadgeHtml}
                       <span class="movie-duration grp-metric" title="${UIHelpers.escapeHtml(episodeBadgeText)}">${episodeBadgeText}</span>
                       <div class="season-item-actions grp-row-actions">
                           <button class="season-edit-btn" data-slug="${UIHelpers.escapeHtml(slug)}" title="Edit title">${UIHelpers.createIcon("edit")}</button>
                           <button class="season-delete-btn" data-slug="${UIHelpers.escapeHtml(slug)}" title="Delete">${UIHelpers.createIcon("delete")}</button>
                       </div>
                       ${movieOpenIconHtml}`
          : `${memberStatusBadgeHtml}<span class="season-episode-badge grp-metric" title="${UIHelpers.escapeHtml(episodeBadgeText)}">${episodeBadgeText}</span>
                       <div class="season-item-actions grp-row-actions">
                           <button class="season-edit-btn" data-slug="${UIHelpers.escapeHtml(slug)}" title="Edit title">${UIHelpers.createIcon("edit")}</button>
                           <button class="season-delete-btn" data-slug="${UIHelpers.escapeHtml(slug)}" title="Delete">${UIHelpers.createIcon("delete")}</button>
                       </div>
                       ${expandIconHtml}`;

        const html = this.renderGroupItem({
          variant: "season",
          slug,
          statusClass,
          statusIcon,
          label: UIHelpers.escapeHtml(seasonLabel),
          rightHtml: rightSideHtml,
          contentHtml,
          extraItemClass: isMovie ? "season-item-movie" : "",
        });

        return { html, isComplete, separatorLabel };
      });

      let lastSeparatorLabel = null;
      const seasonItemsHTML = seasonData
        .map((item) => {
          const shouldRenderSeparator = item.separatorLabel && item.separatorLabel !== lastSeparatorLabel;
          if (item.separatorLabel) {
            lastSeparatorLabel = item.separatorLabel;
          }

          const separatorHtml = shouldRenderSeparator
            ? `
                        <div class="season-chronology-separator" role="separator" aria-label="Chronology ${UIHelpers.escapeHtml(item.separatorLabel)}">
                            <span class="season-chronology-line"></span>
                            <span class="season-chronology-label">${UIHelpers.escapeHtml(item.separatorLabel)}</span>
                            <span class="season-chronology-line"></span>
                        </div>`
            : "";

          return `${separatorHtml}${item.html}`;
        })
        .join("");
      const allSeasonsComplete = seasonData.every((d) => d.isComplete);

      let lastWatchedText;
      if (allSeasonsComplete && filteredSeasons.some(({ anime }) => (anime.episodes?.length || 0) > 0)) {
        let earliestStart = null;
        filteredSeasons.forEach(({ anime }) => {
          const started = UIHelpers.getStartedDate(anime);
          if (started) {
            const t = new Date(started).getTime();
            if (earliestStart === null || t < earliestStart) earliestStart = t;
          }
        });
        const endedDate = latestWatched ? latestWatched.toISOString() : null;
        if (earliestStart && endedDate) {
          lastWatchedText = `${UIHelpers.formatShortDate(new Date(earliestStart).toISOString())} / ${UIHelpers.formatShortDate(endedDate)}`;
        } else {
          lastWatchedText = latestWatched ? UIHelpers.formatDate(latestWatched.toISOString()) : "Never";
        }
      } else {
        lastWatchedText = latestWatched ? UIHelpers.formatDate(latestWatched.toISOString()) : "Never";
      }
      const itemCount = expandedSeasons.length;
      const inMoviesCategory = AT.PopupState?.currentCategory === "movies";
      const movieItemCount = expandedSeasons.filter(
        ({ slug, anime, isMovie }) => isMovie === true || SeasonGrouping.isMovie(slug, anime),
      ).length;
      const supplementItemCount = expandedSeasons.filter(({ slug, anime }) =>
        globalThis.AnimeTrackerMediaType?.isSupplement(SeasonGrouping.getDisplayMediaType(slug, anime)),
      ).length;
      const itemLabel = isChronologyGroup
        ? inMoviesCategory
          ? `${itemCount} ${itemCount === 1 ? "movie" : "movies"}`
          : `${itemCount} ${itemCount === 1 ? "title" : "titles"}`
        : movieItemCount === itemCount
          ? `${itemCount} ${itemCount === 1 ? "movie" : "movies"}`
          : movieItemCount > 0 || supplementItemCount > 0
            ? `${itemCount} ${itemCount === 1 ? "title" : "titles"}`
        : itemCount === filteredSeasons.length
          ? `${itemCount} seasons`
          : `${itemCount} parts`;

      const groupStatusView = this.getGroupStatusView(filteredSeasons);
      const groupProgressBadge =
        isChronologyGroup && inMoviesCategory
          ? `<span class="meta-badge" style="color:#f4a261;background:rgba(244,162,97,0.12);border:1px solid rgba(244,162,97,0.35);">${itemLabel}</span>`
          : `<span class="meta-badge meta-badge-progress">${itemLabel}</span>`;
      const groupStatusIcon = groupStatusView.icon ? UIHelpers.createIcon(groupStatusView.icon) : "";
      const groupStatusBadge = `<span class="meta-badge ${groupStatusView.badgeClass}">${groupStatusIcon}${groupStatusView.text}</span>`;
      const metaRowHtmlGroup = `<div class="grp-meta-row">${groupProgressBadge}${groupStatusBadge}</div><span class="meta-time">${lastWatchedText}</span>`;

      return this.renderGroupShell({
        variant: "season",
        baseSlug,
        extraClass: AT.PopupState?.currentCategory === "movies" ? "no-inner-scroll" : "",
        coverHtml: coverHtmlGroup,
        title: UIHelpers.escapeHtml(baseTitle),
        metaRowHtml: metaRowHtmlGroup,
        itemsHtml: seasonItemsHTML,
      });
    },

    extractBaseTitle(title) {
      return title
        .replace(/\s*[\[(]?(?:19|20)\d{2}[\])]?\s*$/i, "")
        .replace(/\s*-?\s*Season\s*\d+\s*$/i, "")
        .replace(/\s*-?\s*S\d+\s*$/i, "")
        .replace(/\s*\d+(st|nd|rd|th)\s*Season\s*$/i, "")
        .replace(/\s*-?\s*Part\s*\d+\s*$/i, "")
        .replace(/\s*-?\s*Episode\s*$/i, "")
        .replace(/\s*[-:]\s*$/, "")
        .trim();
    },

    getRealMovieEpisodes(anime) {
      return (anime?.episodes || []).filter((ep) => ep?.durationSource !== "anilist");
    },

    getRealMovieWatchTime(anime) {
      return this.getRealMovieEpisodes(anime).reduce((sum, ep) => sum + (Number(ep?.duration) || 0), 0);
    },

    isMovieWatched(anime) {
      if (!anime) return false;
      return (
        anime.listState === "completed" ||
        !!anime.completedAt ||
        this.getRealMovieEpisodes(anime).length > 0 || this.getRealMovieWatchTime(anime) > 0 || (Number(anime.totalWatchTime) || 0) > 0
      );
    },

    extractMovieBaseTitle(title) {
      return title
        .replace(/\s*-?\s*Movie\s*\d+.*$/i, "")
        .replace(/\s*-?\s*Film[:\s].*$/i, "")
        .replace(/\s*[-:]\s*$/, "")
        .trim();
    },

    renderMovieItem(slug, label, formattedTime, statusView) {
      const { UIHelpers } = window.AnimeTracker;
      const statusIcon = statusView.icon ? UIHelpers.createIcon(statusView.icon) : "";
      const metricText = formattedTime || "—";
      const rightHtml = `<span class="meta-badge grp-state-badge ${statusView.badgeClass}">${statusIcon}${statusView.text}</span>
                                <span class="movie-duration grp-metric" title="${UIHelpers.escapeHtml(metricText)}">${metricText}</span>
                                <div class="movie-item-actions grp-row-actions">
                                    <button class="movie-edit-btn" data-slug="${UIHelpers.escapeHtml(slug)}" title="Edit title">${UIHelpers.createIcon("edit")}</button>
                                    <button class="movie-delete-btn" data-slug="${UIHelpers.escapeHtml(slug)}" title="Delete">${UIHelpers.createIcon("delete")}</button>
                                </div>
                                <button type="button" class="season-expand-icon grp-row-chevron movie-open-link" data-slug="${UIHelpers.escapeHtml(slug)}" title="Open anime page" aria-label="Open anime page">${UIHelpers.createIcon("chevron")}</button>`;
      return this.renderGroupItem({
        variant: "movie",
        slug,
        statusClass: statusView.itemClass,
        statusIcon,
        label: UIHelpers.escapeHtml(label),
        rightHtml,
      });
    },

    createMovieGroup(baseSlug, movies) {
      const { UIHelpers, SeasonGrouping } = window.AnimeTracker;

      const firstMovie = movies[0];
      const normalizedBaseSlug = String(baseSlug || "").replace(/__movies$/, "");
      const firstStrictMovie = movies.find(({ slug, anime }) => SeasonGrouping.isMovie(slug, anime)) || null;
      const baseTitle = firstStrictMovie
        ? this.extractMovieBaseTitle(firstStrictMovie.anime.title)
        : normalizedBaseSlug.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

      let latestWatched = null;

      movies.forEach(({ anime }) => {
        if (anime.lastWatched) {
          const date = new Date(anime.lastWatched);
          if (!latestWatched || date > latestWatched) {
            latestWatched = date;
          }
        }
      });

      const movieItemsHTML = movies
        .map(({ slug, anime }) => {
          const movieLabel = SeasonGrouping.getMovieLabel(slug, anime.title);
          const watchTime = this.getRealMovieWatchTime(anime);
          const formattedTime = UIHelpers.formatDuration(watchTime);
          const statusView = this.getEntryStatusView(slug, anime);
          return this.renderMovieItem(slug, movieLabel, formattedTime, statusView);
        })
        .join("");

      const completedCount = movies.filter(({ slug, anime }) => this.getEntryStatusView(slug, anime).status === "completed").length;
      const allMoviesWatchedForDate = completedCount >= movies.length;
      let lastWatchedText;
      if (allMoviesWatchedForDate && completedCount > 0) {
        let earliestStart = null;
        movies.forEach(({ anime }) => {
          const started = UIHelpers.getStartedDate(anime);
          if (started) {
            const t = new Date(started).getTime();
            if (earliestStart === null || t < earliestStart) earliestStart = t;
          }
        });
        const endedDate = latestWatched ? latestWatched.toISOString() : null;
        if (earliestStart && endedDate) {
          lastWatchedText = `${UIHelpers.formatShortDate(new Date(earliestStart).toISOString())} / ${UIHelpers.formatShortDate(endedDate)}`;
        } else {
          lastWatchedText = latestWatched ? UIHelpers.formatDate(latestWatched.toISOString()) : "Never";
        }
      } else {
        lastWatchedText = latestWatched ? UIHelpers.formatDate(latestWatched.toISOString()) : "Never";
      }

      const groupImages = (window.AnimeTracker && window.AnimeTracker.groupCoverImages) || {};
      const coverImageGroup =
        groupImages[normalizedBaseSlug] ||
        groupImages[baseSlug] ||
        (firstMovie?.anime && firstMovie.anime.coverImage ? firstMovie.anime.coverImage : null);
      const coverHtmlGroup = UIHelpers.renderCoverFigure(baseTitle, coverImageGroup);

      const totalMovies = movies.length;
      const groupStatusView = this.getGroupStatusView(movies);
      const movieTypeBadge = `<span class="meta-badge" style="color:#f4a261;background:rgba(244,162,97,0.12);border:1px solid rgba(244,162,97,0.35);">${totalMovies} Movies</span>`;
      const movieStatusIcon = groupStatusView.icon ? UIHelpers.createIcon(groupStatusView.icon) : "";
      const movieStatusBadge = `<span class="meta-badge ${groupStatusView.badgeClass}">${movieStatusIcon}${groupStatusView.text}</span>`;
      const metaRowHtml = `<div class="grp-meta-row">${movieTypeBadge}${movieStatusBadge}</div><span class="meta-time">${lastWatchedText}</span>`;

      return this.renderGroupShell({
        variant: "movie",
        baseSlug,
        coverHtml: coverHtmlGroup,
        title: `${UIHelpers.escapeHtml(baseTitle)} Movies`,
        metaRowHtml,
        itemsHtml: movieItemsHTML,
      });
    },

    createSingleMovieCard(slug, anime) {
      const { UIHelpers } = window.AnimeTracker;

      const title = anime.title || slug;
      const watchTime = this.getRealMovieWatchTime(anime);
      const formattedTime = UIHelpers.formatDuration(watchTime);
      const statusView = this.getEntryStatusView(slug, anime);
      const isWatched = statusView.status === "completed";
      let lastWatched;
      if (isWatched) {
        const startedDate = UIHelpers.getStartedDate(anime);
        if (startedDate && anime.lastWatched) {
          lastWatched = `${UIHelpers.formatShortDate(startedDate)} / ${UIHelpers.formatShortDate(anime.lastWatched)}`;
        } else {
          lastWatched = anime.lastWatched ? UIHelpers.formatDate(anime.lastWatched) : "Never";
        }
      } else {
        lastWatched = anime.lastWatched ? UIHelpers.formatDate(anime.lastWatched) : "Never";
      }

      const coverHtml = UIHelpers.renderCoverFigure(title, anime.coverImage || null);

      const singleStatusIcon = statusView.icon ? UIHelpers.createIcon(statusView.icon) : "";
      const metaRowHtml = `<div class="grp-meta-row"><span class="meta-badge" style="color:#f4a261;background:rgba(244,162,97,0.12);border:1px solid rgba(244,162,97,0.35);">Movie</span><span class="meta-badge ${statusView.badgeClass}">${singleStatusIcon}${statusView.text}</span></div><span class="meta-time">${lastWatched}</span>`;

      return this.renderGroupShell({
        variant: "movie",
        baseSlug: slug,
        extraClass: "single-movie",
        coverHtml,
        title: UIHelpers.escapeHtml(title),
        metaRowHtml,
        itemsHtml: this.renderMovieItem(slug, title, formattedTime, statusView),
      });
    },
  });
})();
