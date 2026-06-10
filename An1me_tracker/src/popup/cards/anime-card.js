const AnimeCardRenderer = {
    createAnimeCard(slug, anime, videoProgress = {}) {
        const { UIHelpers } = window.AnimeTracker;
        const { FillerService } = window.AnimeTracker;
        const { CONFIG } = window.AnimeTracker;

        const episodeCount = anime.episodes?.length || 0;
        const progressData = FillerService.calculateProgress(episodeCount, slug, anime);
        const sizeClass = UIHelpers.getProgressSizeClass(episodeCount, progressData.total || episodeCount);

        const canonWatched = FillerService.getCanonEpisodeCount(slug, anime.episodes);
        const totalCanon = FillerService.getTotalCanonEpisodes(slug, progressData.total || episodeCount);
        const hasFillerData = FillerService.hasFillerData(slug);

        let highestCompletedEp = 0;
        if (anime.episodes?.length > 0) {
            const validNumbers = anime.episodes.map(ep => ep.number).filter(n => !isNaN(n) && n > 0);
            if (validNumbers.length > 0) {
                highestCompletedEp = Math.max(...validNumbers);
            }
        }



        const trackedEpisodeNumbers = new Set(
            (anime.onHoldAt || anime.listState === 'on_hold' ? [] : (anime.episodes || []))
                .filter(ep => ep?.durationSource !== 'anilist')
                .map(ep => ep.number)
        );

        const episodesWithProgress = [];
        const slugEntries = videoProgress.__slugIndex?.[slug] || null;
        const progressEntries = slugEntries
            ? slugEntries
            : Object.entries(videoProgress).filter(([id]) => id.startsWith(slug + '__episode-'));

        for (const [uniqueId, progress] of progressEntries) {
            if (uniqueId === '__slugIndex') continue;
            const parts = uniqueId.split('__episode-');
            if (parts.length !== 2 || !parts[1]) continue;

            const epNum = parseInt(parts[1], 10);
            if (isNaN(epNum)) continue;
            if (trackedEpisodeNumbers.has(epNum)) continue;
            if (progress.percentage >= CONFIG.COMPLETED_PERCENTAGE) continue;

            if (typeof progress.currentTime !== 'number' ||
                typeof progress.percentage !== 'number' ||
                typeof progress.duration !== 'number' ||
                isNaN(progress.currentTime) ||
                isNaN(progress.percentage) ||
                isNaN(progress.duration)) {
                continue;
            }

            const minutes = Math.floor(progress.currentTime / 60);
            const seconds = Math.floor(progress.currentTime % 60);
            episodesWithProgress.push({
                number: epNum,
                timeStr: `${minutes}:${seconds.toString().padStart(2, '0')}`,
                percentage: progress.percentage
            });
        }
        episodesWithProgress.sort((a, b) => a.number - b.number);

        const highestInProgressEp = episodesWithProgress.length > 0
            ? Math.max(...episodesWithProgress.map(ep => ep.number))
            : 0;
        const currentEpisode = Math.max(highestCompletedEp, highestInProgressEp);

        const skippedFillers = FillerService.getSkippedFillers(slug, anime.episodes, currentEpisode);
        const skippedFillersText = FillerService.formatSkippedFillersCompact(skippedFillers);
        const skippedFillersIndicator = skippedFillers.length > 0
            ? `<span class="skipped-fillers-badge" title="Skipped filler episodes: ${skippedFillersText}"><span class="icon-inline">${UIHelpers.createIcon('skip')}</span> ${skippedFillers.length} filler skipped</span>`
            : '';

        const sortedEpisodes = [...(anime.episodes || [])].sort((a, b) =>
            b.number - a.number
        );
        const visibleEpisodes = sortedEpisodes.slice(0, CONFIG.VISIBLE_EPISODES_LIMIT);
        const hiddenEpisodes = sortedEpisodes.slice(CONFIG.VISIBLE_EPISODES_LIMIT);

        const episodeTags = visibleEpisodes.map(ep => {
            const isFiller = FillerService.isFillerEpisode(slug, ep.number);
            return `<span class="episode-tag${isFiller ? ' filler watched-filler' : ''}" title="${isFiller ? 'Filler Episode (Watched)' : ''}">Ep ${ep.number}</span>`;
        }).join('') || '';

        const hiddenEpisodeTags = hiddenEpisodes.map(ep => {
            const isFiller = FillerService.isFillerEpisode(slug, ep.number);
            return `<span class="episode-tag${isFiller ? ' filler watched-filler' : ''}" title="${isFiller ? 'Filler Episode (Watched)' : ''}">Ep ${ep.number}</span>`;
        }).join('');

        const moreEpisodes = hiddenEpisodes.length > 0
            ? `<div class="hidden-episodes">${hiddenEpisodeTags}</div><span class="episode-tag show-more-episodes" data-more-text="+${hiddenEpisodes.length} more" data-less-text="Show less">+${hiddenEpisodes.length} more</span>`
            : '';

        const unwatchedFillers = FillerService.getUnwatchedFillers(slug, anime.episodes, currentEpisode).slice().reverse();
        const visibleFillers = unwatchedFillers.slice(0, CONFIG.VISIBLE_FILLERS_LIMIT);
        const hiddenFillers = unwatchedFillers.slice(CONFIG.VISIBLE_FILLERS_LIMIT);

        const unwatchedFillerTags = visibleFillers.map(epNum =>
            `<span class="episode-tag filler unwatched-filler" title="Filler Episode (Not watched)">Ep ${epNum}</span>`
        ).join('');

        const hiddenFillerTags = hiddenFillers.map(epNum =>
            `<span class="episode-tag filler unwatched-filler" title="Filler Episode (Not watched)">Ep ${epNum}</span>`
        ).join('');

        const showMoreFillers = hiddenFillers.length > 0
            ? `<div class="hidden-fillers">${hiddenFillerTags}</div><span class="episode-tag filler show-more-fillers" data-more-text="+${hiddenFillers.length} more" data-less-text="Show less">+${hiddenFillers.length} more</span>`
            : '';

        const fillerInfo = FillerService.getFillerInfo(slug, anime.episodes);

        const currentEpText = currentEpisode > 0 ? `Ep ${currentEpisode}` : '';
        const unknownTotal = progressData.total == null;

        const AnilistService = window.AnimeTracker?.AnilistService;
        const anilistStatusForProgress = AnilistService?.getStatus(slug);
        const _mainLatest = AnilistService?.getLatestEpisode(slug);
        const _mainMetaTotal = AnilistService?.getTotalEpisodes(slug);
        const _mainPartial = _mainMetaTotal && _mainLatest && _mainLatest < _mainMetaTotal;
        const availableInfo = _mainPartial && _mainLatest > 0 ? ` / ${_mainLatest} available` : '';







        const isAiringPartial = _mainPartial && _mainLatest > 0 && anilistStatusForProgress === 'RELEASING';
        const airingDenominator = isAiringPartial ? _mainLatest : null;

        const canonProgressValue = unknownTotal ? null
            : airingDenominator
                ? Math.min(100, (Math.min(episodeCount, airingDenominator) / airingDenominator) * 100)
                : hasFillerData ? (totalCanon > 0 ? (canonWatched / totalCanon) * 100 : 0)
                    : progressData.progress;
        const canonProgressLabel = canonProgressValue == null
            ? ''
            : UIHelpers.formatProgressPercent(canonProgressValue);
        const canonProgressWidth = unknownTotal ? 0
            : airingDenominator
                ? Math.min(100, (Math.min(episodeCount, airingDenominator) / airingDenominator) * 100)
                : hasFillerData ? (totalCanon > 0 ? (canonWatched / totalCanon) * 100 : 0)
                    : progressData.progress;

        const totalDisplay = unknownTotal ? null : progressData.total;
        const totalCanonDisplay = unknownTotal ? null : totalCanon;

        const progressInfoText = unknownTotal
            ? (anilistStatusForProgress === 'FINISHED'
                ? `<span><span class="icon-inline">${UIHelpers.createIcon('canon')}</span> ${currentEpText} · Watched ${episodeCount} eps</span>`
                : `<span><span class="icon-inline">${UIHelpers.createIcon('canon')}</span> ${currentEpText}${availableInfo} · Airing</span>`)
            : hasFillerData
                ? `<span title="Canon: ${canonWatched}/${totalCanonDisplay}"><span class="icon-inline">${UIHelpers.createIcon('canon')}</span> ${currentEpText}${availableInfo} · Canon ${canonWatched}/${totalCanonDisplay}</span>`
                : `<span><span class="icon-inline">${UIHelpers.createIcon('canon')}</span> ${currentEpText}${availableInfo} · Total ${episodeCount}/${totalDisplay}</span>`;

        const watchedFillers = fillerInfo?.watched || 0;
        const totalFillers = fillerInfo?.total || 0;
        const fillerProgressPercent = totalFillers > 0 ? Math.round((watchedFillers / totalFillers) * 100) : 0;

        const fillerProgressSection = (hasFillerData && watchedFillers > 0) ? `
            <div class="progress-container filler-progress">
                <div class="progress-info">
                    <span class="filler-label" title="Watched fillers: ${watchedFillers} · Skipped fillers: ${skippedFillers.length}"><span class="icon-inline">${UIHelpers.createIcon('filler')}</span> Filler ${watchedFillers}/${totalFillers}</span>
                    <span>${fillerProgressPercent}%</span>
                </div>
                <div class="progress-bar filler-bar ${sizeClass}">
                    <div class="progress-fill filler-fill" style="width: ${fillerProgressPercent}%; min-width: ${fillerProgressPercent > 0 ? 2 : 0}px; opacity: 1;"></div>
                </div>
            </div>` : '';

        const partsSection = this.createPartsSection(slug, anime.episodes);

        const coverHtml = UIHelpers.renderCoverFigure(anime.title, anime.coverImage);

        const totalWatchedEpisodes = anime.episodes?.length || 0;
        const totalEpisodesPossible = progressData.total || 0;
        const isManuallyCompleted = !!anime.completedAt && totalWatchedEpisodes > 0;
        const isMovieEntry = window.AnimeTracker.SeasonGrouping.isMovie(slug, anime);

        const _latestAvail = AnilistService?.getLatestEpisode(slug);
        const _metaTotal = AnilistService?.getTotalEpisodes(slug);
        const _isPartiallyUploaded = _metaTotal && _latestAvail && _latestAvail < _metaTotal;
        const _hasAnilistData = AnilistService?.cache?.[slug] != null;

        const isFinishedByAnilist = anilistStatusForProgress === 'FINISHED' && totalWatchedEpisodes > 0
            && !_isPartiallyUploaded
            && (progressData.total == null || progressData.progress >= 100
                || (progressData.total > 0 && highestCompletedEp >= progressData.total));
        const isCardComplete = isManuallyCompleted
            || (progressData.progress === 100 && totalWatchedEpisodes > 0 && !_isPartiallyUploaded)
            || isFinishedByAnilist
            || (isMovieEntry && totalWatchedEpisodes > 0);
        const displayTotalRaw = _isPartiallyUploaded && _latestAvail > 0 ? _latestAvail : totalEpisodesPossible;
        const displayTotal = Math.max(
            Number(displayTotalRaw) || 0,
            Number(currentEpisode) || 0,
            Number(_latestAvail) || 0
        );
        const totalProgressText = displayTotal > 0 ? `${currentEpisode}/${displayTotal}` : `${currentEpisode}`;
        const episodeProgressText = currentEpisode > 0 ? `Ep ${totalProgressText}` : '';
        const isDropped = !!anime.droppedAt;
        const isOnHold = !!anime.onHoldAt;
        const _isCaughtUpAiring = !isDropped && !isOnHold && !isCardComplete && totalWatchedEpisodes > 0
            && _hasAnilistData && _latestAvail > 0
            && highestCompletedEp >= _latestAvail
            && (anilistStatusForProgress === 'RELEASING' || _isPartiallyUploaded);

        let statusTextCard = '';
        if (isDropped) {
            statusTextCard = 'Dropped';
        } else if (isOnHold) {
            statusTextCard = 'On hold';
        } else if (totalWatchedEpisodes === 0) {
            statusTextCard = 'Not started';
        } else if (_isCaughtUpAiring) {
            statusTextCard = 'Airing';
        } else if (!isCardComplete) {
            statusTextCard = 'Watching';
        } else {
            statusTextCard = 'Completed';
        }
        let timeAgoText;
        if (isCardComplete && totalWatchedEpisodes > 0) {
            const startedDate = UIHelpers.getStartedDate(anime);
            const endedDate = anime.completedAt || anime.lastWatched;
            if (startedDate && endedDate) {
                timeAgoText = `${UIHelpers.formatShortDate(startedDate)} / ${UIHelpers.formatShortDate(endedDate)}`;
            } else {
                timeAgoText = anime.lastWatched ? UIHelpers.formatDate(anime.lastWatched) : 'Never';
            }
        } else {
            timeAgoText = anime.lastWatched ? UIHelpers.formatDate(anime.lastWatched) : 'Never';
        }
        const progressBadge = !isCardComplete && !isDropped && !isOnHold && episodeProgressText
            ? `<span class="meta-badge meta-badge-progress">${episodeProgressText}</span>`
            : '';
        const completedTypeBadge = '';
        const statusBadgeClass = isDropped
            ? 'meta-badge-dropped'
            : (isOnHold
                ? 'meta-badge-onhold'
                : (isCardComplete
                    ? 'meta-badge-complete'
                    : (_isCaughtUpAiring ? 'meta-badge-airing' : (totalWatchedEpisodes > 0 ? 'meta-badge-watching' : 'meta-badge-notstarted'))));
        const statusBadgeIcon = isDropped ? '⏸' : (isOnHold ? '⏸' : (isCardComplete ? '✓' : (_isCaughtUpAiring ? '' : '⊙')));
        const statusBadge = `<span class="meta-badge ${statusBadgeClass}">${statusBadgeIcon ? `${statusBadgeIcon} ` : ''}${statusTextCard}</span>`;

        const anilistStatus = AnilistService?.getStatus(slug);
        const airingBadge = anilistStatus === 'RELEASING' && !isDropped && !isOnHold && !_isCaughtUpAiring
            ? `<span class="meta-badge meta-badge-airing" title="Currently airing">Airing</span>`
            : '';

        let inlineEtaHtml = '';
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
                const countdownLabel = days > 0
                    ? `${days}d ${hours}h`
                    : `${hours}h ${minutes}m`;
                const tip = `Estimated time until the next episode on an1me.to: ${nextEpisodeAt.toLocaleString()}`;
                inlineEtaHtml = `<span class="meta-time-eta meta-time-eta-site" title="${UIHelpers.escapeHtml(tip)}">🚀 ${UIHelpers.escapeHtml(countdownLabel)}</span>`;
            } else if (StatsEngine && !isCardComplete && !isDropped && !isOnHold && knownTotalEpisodes > 0) {
                const allAnime = (window.AnimeTracker && window.AnimeTracker._animeDataRef) || null;
                const idx = allAnime ? StatsEngine.buildWatchIndex(allAnime) : null;
                const isAiringLike = anilistStatus === 'RELEASING' || _isPartiallyUploaded;
                const watchedEpisodes = Math.max(totalWatchedEpisodes, highestCompletedEp, currentEpisode);
                const targetEpisodes = isAiringLike
                    ? Math.max(_latestAvail || 0, watchedEpisodes, 0)
                    : knownTotalEpisodes;
                const pred = idx ? StatsEngine.predictCompletion({
                    ...anime,
                    slug,
                    totalEpisodes: knownTotalEpisodes,
                    targetEpisodes: targetEpisodes > 0 ? targetEpisodes : knownTotalEpisodes,
                    allowSingleEpisodeForecast: !!(_isCaughtUpAiring && isAiringLike)
                }, idx) : null;
                if (pred) {
                    const eta = pred.etaDate;
                    let label = eta.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                    const tipRate = pred.epsPerDay >= 1
                        ? `${pred.epsPerDay.toFixed(1)} ep/day`
                        : `1 ep every ${Math.max(1, Math.round(1 / pred.epsPerDay))} days`;
                    let modelPrefix = 'Based on your recent watching pace';
                    if (pred.model === 'release-aware') {
                        modelPrefix = 'Based on your recent pace, your overall watch rhythm, and weekly airing cadence';
                    } else if (pred.model === 'catch-up-aware') {
                        modelPrefix = 'Based on how fast you usually catch up on this anime and your overall watch rhythm';
                    } else if (pred.model === 'next-drop-pace') {
                        modelPrefix = 'Based on how fast you usually clear a new episode of this anime';
                    } else {
                        modelPrefix = 'Based on your recent pace, this anime watch pattern, and your overall watch rhythm';
                    }
                    const remainingText = pred.remaining > 0
                        ? `${pred.daysLeft} days left · ${pred.remaining} left`
                        : `${pred.daysLeft} day${pred.daysLeft === 1 ? '' : 's'} after a new drop`;
                    const rangeText = pred.latestDays > pred.earliestDays
                        ? ` · likely window ${pred.earliestDays}-${pred.latestDays} days`
                        : '';
                    const tip = `${modelPrefix}: about ${tipRate}, ${pred.model === 'next-drop-pace' ? 'you usually catch up' : 'you should be caught up'} around ${eta.toLocaleDateString()} (${remainingText}${rangeText} · ${pred.confidence} confidence)`;
                    if (pred.model !== 'next-drop-pace') {
                        inlineEtaHtml = `<span class="meta-time-eta meta-time-eta-ai meta-time-eta-${pred.confidence}" title="${UIHelpers.escapeHtml(tip)}">~${UIHelpers.escapeHtml(label)}</span>`;
                    }
                }
            }
        } catch (e) {
            try { window.PopupLogger?.debug?.('AnimeCard', 'ETA inference failed:', e?.message || e); } catch {}
        }

        const headerActionsHtml = `
            <div class="anime-header-actions">
                <button class="anime-edit-title" data-slug="${UIHelpers.escapeHtml(slug)}" title="Edit title">${UIHelpers.createIcon('edit')}</button>
                <button class="anime-delete" data-slug="${UIHelpers.escapeHtml(slug)}" title="Delete">${UIHelpers.createIcon('delete')}</button>
            </div>`;
        const metaRowHtml = `
            <div class="anime-meta-row-wrap">
                <div class="anime-meta-row">${progressBadge}${completedTypeBadge}${statusBadge}${airingBadge}</div>
                <div class="anime-header-controls">
                    ${headerActionsHtml}
                    <div class="anime-expand-icon">${UIHelpers.createIcon('chevron')}</div>
                </div>
            </div>
            <div class="meta-time-row">
                <span class="meta-time">${timeAgoText}</span>
                ${inlineEtaHtml}
                <span class="meta-time-progress" title="${Math.round(canonProgressWidth)}% watched">
                    <span class="meta-time-progress-bar" aria-hidden="true"><span class="meta-time-progress-fill" style="width:${canonProgressWidth}%"></span></span>
                    <span class="meta-time-progress-pct">${Math.round(canonProgressWidth)}%</span>
                </span>
            </div>`;

        return `
            <div class="anime-card" data-slug="${UIHelpers.escapeHtml(slug)}" tabindex="0" role="button" aria-expanded="false" aria-label="${UIHelpers.escapeHtml(anime.title || slug)}, press Enter to expand">
                <div class="anime-card-header">
                    <div class="anime-cover-container" style="flex-shrink:0;">${coverHtml}</div>
                    <div class="anime-header-main" style="flex:1; display:flex; flex-direction:column; min-width:0; margin-left:8px;">
                        <div class="anime-title-row" style="display:flex; align-items:center; overflow:hidden;">
                            ${anime.favorite ? `<span class="anime-favorite-indicator" title="Favorite" aria-label="Favorite">${UIHelpers.createIcon('star-filled')}</span>` : ''}
                            <span class="anime-title-text" style="font-size:14px;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;flex:1;min-width:0;">${UIHelpers.escapeHtml(anime.title)}</span>
                        </div>
                        ${metaRowHtml}
                    </div>
                </div>
                <div class="anime-card-content">
                    <div class="progress-container header-progress">
                        <div class="progress-info">
                            ${progressInfoText}
                            <span>${canonProgressLabel}</span>
                        </div>
                        <div class="progress-bar ${sizeClass}">
                            <div class="progress-fill" style="width: ${canonProgressWidth}%"></div>
                        </div>
                    </div>
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
                            ${unwatchedFillers.length > 0 ? `<div class="unwatched-fillers-section"><span class="unwatched-fillers-label">Unwatched Fillers <span class="filler-count">${unwatchedFillers.length}</span></span><div class="episode-list">${unwatchedFillerTags}${showMoreFillers}</div></div>` : ''}
                        </div>
                    </div>
                    <div class="anime-card-actions">
                        <button class="anime-favorite-toggle${anime.favorite ? ' is-favorite' : ''}" data-slug="${UIHelpers.escapeHtml(slug)}" data-favorite="${!!anime.favorite}" title="${anime.favorite ? 'Remove from favorites' : 'Mark as favorite'}" aria-pressed="${!!anime.favorite}">${UIHelpers.createIcon(anime.favorite ? 'star-filled' : 'star')}<span>${anime.favorite ? 'Favorited' : 'Favorite'}</span></button>
                        <button class="anime-onhold-toggle" data-slug="${UIHelpers.escapeHtml(slug)}" data-onhold="${!!anime.onHoldAt}" title="${anime.onHoldAt ? 'Resume watching' : 'Put on hold'}">${UIHelpers.createIcon('pause')}<span>${anime.onHoldAt ? 'Resume' : 'Hold'}</span></button>
                        <button class="anime-complete-toggle" data-slug="${UIHelpers.escapeHtml(slug)}" data-completed="${isManuallyCompleted}" title="${isManuallyCompleted ? 'Unmark as completed' : 'Mark as completed'}">${UIHelpers.createIcon('check')}<span>${isManuallyCompleted ? 'Undo' : 'Complete'}</span></button>
                        <button class="anime-drop-toggle" data-slug="${UIHelpers.escapeHtml(slug)}" data-dropped="${!!anime.droppedAt}" title="${anime.droppedAt ? 'Unmark as dropped' : 'Drop'}">${UIHelpers.createIcon('drop')}<span>${anime.droppedAt ? 'Undrop' : 'Drop'}</span></button>
                    </div>
                </div>
            </div>
        `;
    },

    createPartsSection(slug, episodes = [], startExpanded = false) {
        const { ANIME_PARTS_CONFIG, CONFIG, FillerService, UIHelpers } = window.AnimeTracker;

        const partsConfig = ANIME_PARTS_CONFIG?.[slug];
        if (!partsConfig || partsConfig.length === 0) {
            return '';
        }

        const watchedEpisodes = new Set(episodes.map(ep => ep.number));

        const partsHTML = partsConfig.map(part => {
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

            const statusClass = isComplete ? 'complete' : (hasProgress ? 'in-progress' : 'not-started');
            const statusIcon = isComplete ? '✓' : (hasProgress ? '▶' : '○');

            const sortedEps = watchedEpisodesInPart.sort((a, b) => b - a);
            const visibleEps = sortedEps.slice(0, CONFIG.VISIBLE_EPISODES_LIMIT);
            const hiddenEps = sortedEps.slice(CONFIG.VISIBLE_EPISODES_LIMIT);

            const episodeTags = visibleEps.map(epNum => {
                const isFiller = FillerService.isFillerEpisode(slug, epNum);
                return `<span class="episode-tag${isFiller ? ' filler watched-filler' : ''}">Ep ${epNum}</span>`;
            }).join('');

            const hiddenEpisodeTags = hiddenEps.map(epNum => {
                const isFiller = FillerService.isFillerEpisode(slug, epNum);
                return `<span class="episode-tag${isFiller ? ' filler watched-filler' : ''}">Ep ${epNum}</span>`;
            }).join('');

            const moreEpisodes = hiddenEps.length > 0
                ? `<div class="hidden-episodes">${hiddenEpisodeTags}</div><span class="episode-tag show-more-episodes" data-more-text="+${hiddenEps.length} more" data-less-text="Show less">+${hiddenEps.length} more</span>`
                : '';

            return `
                <div class="part-item ${statusClass}" data-part-start="${part.start}" data-part-end="${part.end}">
                    <div class="part-item-header">
                        <span class="part-status-icon">${statusIcon}</span>
                        <span class="part-name">${UIHelpers.escapeHtml(part.name)}</span>
                        <span class="part-episodes">Ep ${part.start}-${part.end}</span>
                        <span class="part-progress">${watchedInPart}/${totalInPart}</span>
                        <div class="part-expand-icon">${UIHelpers.createIcon('chevron')}</div>
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
        }).join('');

        const collapsedClass = startExpanded ? '' : ' collapsed';
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

    createInProgressItem(anime) { return ''; },

    createInProgressGroup() { return ''; },
    createSeasonGroup() { return ''; },
    createMovieGroup() { return ''; },
    createSingleMovieCard() { return ''; },
    extractBaseTitle(title) { return title; },
    extractMovieBaseTitle(title) { return title; },

};

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.AnimeCardRenderer = AnimeCardRenderer;
