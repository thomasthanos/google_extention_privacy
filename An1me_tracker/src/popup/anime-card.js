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

        const trackedEpisodeNumbers = new Set((anime.episodes || []).map(ep => ep.number));

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
            const seconds = progress.currentTime % 60;
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

        const progressTags = episodesWithProgress.map(ep =>
            `<span class="episode-tag in-progress" data-episode="${ep.number}" title="Saved: ${ep.percentage}%">
                Ep ${ep.number} (${ep.timeStr})
                <button class="progress-delete-btn" data-slug="${slug}" data-episode="${ep.number}" title="Delete progress">×</button>
            </span>`
        ).join('');

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

        const progressSection = progressTags ? `
            <div class="anime-in-progress collapsible collapsed">
                <div class="in-progress-header">
                    <span class="in-progress-title">In Progress (${episodesWithProgress.length})</span>
                    <svg class="collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </div>
                <div class="in-progress-content">
                    <div class="episode-list">${progressTags}</div>
                </div>
            </div>` : '';

        const currentEpText = currentEpisode > 0 ? `Ep ${currentEpisode}` : '';
        const unknownTotal = progressData.total == null;
        const canonProgressPercent = unknownTotal ? null
            : hasFillerData ? (totalCanon > 0 ? Math.round((canonWatched / totalCanon) * 100) : 0)
                : Math.round(progressData.progress);
        const canonProgressWidth = unknownTotal ? 0
            : hasFillerData ? (totalCanon > 0 ? (canonWatched / totalCanon) * 100 : 0)
                : progressData.progress;

        const totalDisplay = unknownTotal ? null : progressData.total;
        const totalCanonDisplay = unknownTotal ? null : totalCanon;

        const AnilistService = window.AnimeTracker?.AnilistService;
        const anilistStatusForProgress = AnilistService?.getStatus(slug);
        const _mainLatest = AnilistService?.getLatestEpisode(slug);
        const _mainMetaTotal = AnilistService?.getTotalEpisodes(slug);
        const _mainPartial = _mainMetaTotal && _mainLatest && _mainLatest < _mainMetaTotal;
        const availableInfo = _mainPartial && _mainLatest > 0 ? ` / ${_mainLatest} available` : '';

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

        const firstLetter = (anime.title || '').trim().charAt(0) || '';
        const safeCoverImage = UIHelpers.sanitizeImageUrl(anime.coverImage);
        const coverHtml = safeCoverImage
            ? `<img src="${UIHelpers.escapeHtml(safeCoverImage)}" alt="${UIHelpers.escapeHtml(anime.title)}" style="border-radius:8px;width:44px;height:58px;object-fit:cover;">
              `
            : `<div style="width:44px;height:58px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:600;color:#fff;">
                    ${UIHelpers.escapeHtml(firstLetter.toUpperCase())}
               </div>`;

        const totalWatchedEpisodes = anime.episodes?.length || 0;
        const totalEpisodesPossible = progressData.total || 0;
        const isManuallyCompleted = !!anime.completedAt && totalWatchedEpisodes > 0;

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
            || (window.AnimeTracker.SeasonGrouping.isMovie(slug, anime) && totalWatchedEpisodes > 0);
        const displayTotal = _isPartiallyUploaded && _latestAvail > 0 ? _latestAvail : totalEpisodesPossible;
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
        const statusBadgeClass = isDropped
            ? 'meta-badge-dropped'
            : (isOnHold
                ? 'meta-badge-onhold'
                : (isCardComplete
                    ? 'meta-badge-complete'
                    : (_isCaughtUpAiring ? 'meta-badge-airing' : (totalWatchedEpisodes > 0 ? 'meta-badge-watching' : 'meta-badge-notstarted'))));
        const statusBadgeIcon = isDropped ? '⏸' : (isOnHold ? '⏸' : (isCardComplete ? '✓' : (_isCaughtUpAiring ? '⊙' : '⊙')));
        const statusBadge = `<span class="meta-badge ${statusBadgeClass}">${statusBadgeIcon} ${statusTextCard}</span>`;

        const anilistStatus = AnilistService?.getStatus(slug);
        const airingBadge = anilistStatus === 'RELEASING' && !isDropped && !isOnHold && !_isCaughtUpAiring
            ? `<span class="meta-badge meta-badge-airing" title="Currently airing">⬤ Airing</span>`
            : '';

        let inlineEtaHtml = '';
        try {
            const StatsEngine = window.AnimeTracker?.StatsEngine;
            const knownTotalEpisodes = Number(anime.totalEpisodes) || Number(AnilistService?.getTotalEpisodes(slug)) || 0;
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
                        modelPrefix = 'Based on your recent pace and weekly airing cadence';
                    } else if (pred.model === 'catch-up-aware') {
                        modelPrefix = 'Based on how fast you usually catch up on this anime';
                    } else if (pred.model === 'next-drop-pace') {
                        modelPrefix = 'Based on how fast you usually clear a new episode of this anime';
                    }
                    const remainingText = pred.remaining > 0
                        ? `${pred.daysLeft} days left · ${pred.remaining} left`
                        : `${pred.daysLeft} day${pred.daysLeft === 1 ? '' : 's'} after a new drop`;
                    const tip = `${modelPrefix}: about ${tipRate}, ${pred.model === 'next-drop-pace' ? 'you usually catch up' : 'you should be caught up'} around ${eta.toLocaleDateString()} (${remainingText} · ${pred.confidence} confidence)`;
                    if (pred.model !== 'next-drop-pace') {
                        inlineEtaHtml = `<span class="meta-time-eta meta-time-eta-ai meta-time-eta-${pred.confidence}" title="${UIHelpers.escapeHtml(tip)}">~${UIHelpers.escapeHtml(label)}</span>`;
                    }
                }
            }
        } catch (e) {
        }

        const headerActionsHtml = `
            <div class="anime-header-actions">
                <button class="anime-edit-title" data-slug="${slug}" title="Edit title">${UIHelpers.createIcon('edit')}</button>
                <button class="anime-delete" data-slug="${slug}" title="Delete">${UIHelpers.createIcon('delete')}</button>
            </div>`;
        const metaRowHtml = `
            <div class="anime-meta-row-wrap">
                <div class="anime-meta-row">${progressBadge}${statusBadge}${airingBadge}</div>
                <div class="anime-header-controls">
                    ${headerActionsHtml}
                    <div class="anime-expand-icon">${UIHelpers.createIcon('chevron')}</div>
                </div>
            </div>
            <div class="meta-time-row">
                <span class="meta-time">${timeAgoText}</span>
                ${inlineEtaHtml}
            </div>`;

        return `
            <div class="anime-card" data-slug="${slug}">
                <div class="anime-card-header">
                    <div class="anime-cover-container" style="flex-shrink:0;">${coverHtml}</div>
                    <div class="anime-header-main" style="flex:1; display:flex; flex-direction:column; min-width:0; margin-left:8px;">
                        <div class="anime-title-row" style="display:flex; align-items:center; overflow:hidden;">
                            <span class="anime-title-text" style="font-size:14px;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;flex:1;min-width:0;">${UIHelpers.escapeHtml(anime.title)}</span>
                        </div>
                        ${metaRowHtml}
                    </div>
                </div>
                <div class="anime-card-content">
                    <div class="progress-container header-progress">
                        <div class="progress-info">
                            ${progressInfoText}
                            <span>${canonProgressPercent != null ? canonProgressPercent + "%" : ""}</span>
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
                            <span class="episodes-title">Watched ${episodeCount}${progressData.total ? `/${progressData.total}` : ''}</span>
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
                        <button class="anime-onhold-toggle" data-slug="${slug}" data-onhold="${!!anime.onHoldAt}" title="${anime.onHoldAt ? 'Resume watching' : 'Put on hold'}">${UIHelpers.createIcon('pause')}<span>${anime.onHoldAt ? 'Resume' : 'Hold'}</span></button>
                        <button class="anime-complete-toggle" data-slug="${slug}" data-completed="${isManuallyCompleted}" title="${isManuallyCompleted ? 'Unmark as completed' : 'Mark as completed'}">${UIHelpers.createIcon('check')}<span>${isManuallyCompleted ? 'Undo' : 'Complete'}</span></button>
                        <button class="anime-drop-toggle" data-slug="${slug}" data-dropped="${!!anime.droppedAt}" title="${anime.droppedAt ? 'Unmark as dropped' : 'Drop'}">${UIHelpers.createIcon('drop')}<span>${anime.droppedAt ? 'Undrop' : 'Drop'}</span></button>
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
                        <span class="part-name">${part.name}</span>
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

    createInProgressItem(anime) {
        const { UIHelpers, CONFIG } = window.AnimeTracker;

        const activeEpisodes = anime.episodes.filter(ep => ep.percentage < CONFIG.COMPLETED_PERCENTAGE);
        if (activeEpisodes.length === 0) return '';

        const latestEp = [...activeEpisodes].sort((a, b) => {
            const aTime = a.savedAt ? new Date(a.savedAt).getTime() : 0;
            const bTime = b.savedAt ? new Date(b.savedAt).getTime() : 0;
            return bTime - aTime || b.number - a.number;
        })[0];
        const currentMin = Math.floor(latestEp.currentTime / 60);
        const currentSec = Math.floor(latestEp.currentTime % 60);
        const currentTimeStr = `${currentMin}:${currentSec.toString().padStart(2, '0')}`;

        const durationMin = Math.floor((latestEp.duration || 0) / 60);
        const durationStr = durationMin > 0 ? `${durationMin}m` : '?';

        const remainingTime = Math.max(0, (latestEp.duration || 0) - latestEp.currentTime);
        const remainingMin = Math.ceil(remainingTime / 60);
        const remainingStr = remainingMin > 0 ? `${remainingMin}m left` : 'Done';

        const pct = Math.round(latestEp.percentage);
        const safeSlug = UIHelpers.escapeHtml(anime.slug);
        const cardClass = anime.isResumeOnly ? 'ip-card ip-card-untracked' : 'ip-card';

        const safeCoverImage = UIHelpers.sanitizeImageUrl(anime.coverImage);
        const coverHtml = safeCoverImage
            ? `<img class="ip-cover" src="${UIHelpers.escapeHtml(safeCoverImage)}" alt="">`
            : `<div class="ip-cover-placeholder">▶</div>`;

        const savedDate = latestEp.savedAt ? new Date(latestEp.savedAt) : null;
        const now = new Date();
        let savedTimeStr = 'just now';
        if (savedDate) {
            const diffMs = now - savedDate;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);

            if (diffMins < 1) savedTimeStr = 'just now';
            else if (diffMins < 60) savedTimeStr = `${diffMins}m ago`;
            else if (diffHours < 24) savedTimeStr = `${diffHours}h ago`;
            else if (diffDays < 7) savedTimeStr = `${diffDays}d ago`;
            else savedTimeStr = savedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }

        const watchedDate = latestEp.watchedAt ? new Date(latestEp.watchedAt) : null;
        let watchedDateStr = '';
        if (watchedDate) {
            watchedDateStr = watchedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
                        <a class="ip-continue-btn" href="${continueUrl}" target="_blank" title="Continue watching Ep ${latestEp.number}">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            Continue Ep ${latestEp.number}
                        </a>
                    </div>
                </div>
            </div>`;
    },

    createInProgressGroup(inProgressItems) {
        if (!inProgressItems || inProgressItems.length === 0) return '';

        const trackedItems = inProgressItems.filter(anime => !anime.isResumeOnly);
        const resumeOnlyItems = inProgressItems.filter(anime => anime.isResumeOnly);

        const trackedHtml = trackedItems.map(anime => this.createInProgressItem(anime)).join('');
        const resumeOnlyHtml = resumeOnlyItems.map(anime => this.createInProgressItem(anime)).join('');
        const separatorHtml = trackedHtml && resumeOnlyHtml
            ? `
                <div class="ip-group-separator" role="separator" aria-label="Not tracked yet">
                    <span class="ip-group-separator-line"></span>
                    <span class="ip-group-separator-label">Not Tracked Yet</span>
                    <span class="ip-group-separator-line"></span>
                </div>`
            : '';

        const count = inProgressItems.length;

        return `
            <div class="ip-group">
                <div class="ip-group-header">
                    <span class="ip-group-play">▶</span>
                    <span class="ip-group-label">In Progress</span>
                    <span class="ip-group-count">${count}</span>
                    <svg class="ip-group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform:rotate(-90deg);">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
                <div class="ip-group-content">
                    ${trackedHtml}
                    ${separatorHtml}
                    ${resumeOnlyHtml}
                </div>
            </div>`;
    },

    createSeasonGroup(baseSlug, seasons, videoProgress = {}) {
        const { UIHelpers, SeasonGrouping, FillerService, ANIME_PARTS_CONFIG, SlugUtils } = window.AnimeTracker;
        const isChronologyGroup = SeasonGrouping.isChronologyGroup(baseSlug);
        const canonicalPartParents = new Set(
            seasons
                .filter((season) => (ANIME_PARTS_CONFIG?.[season.slug] || []).length > 0)
                .map((season) => season.slug)
        );
        const filteredSeasons = seasons.filter((season) => {
            if (canonicalPartParents.size === 0) return true;
            const canonicalSlug = SlugUtils?.getCanonicalSlug?.(season.slug, season.anime?.title || '') || season.slug;
            return !canonicalPartParents.has(canonicalSlug) || season.slug === canonicalSlug;
        });

        const firstSeason = filteredSeasons[0] || seasons[0];
        const baseTitle = SeasonGrouping.getGroupDisplayTitle(
            baseSlug,
            this.extractBaseTitle(firstSeason.anime.title)
        );

        const groupImages = (window.AnimeTracker && window.AnimeTracker.groupCoverImages) || {};
        const coverImageGroup = groupImages[baseSlug] ||
            ((firstSeason?.anime && firstSeason.anime.coverImage) ? firstSeason.anime.coverImage : null);
        const safeCoverImageGroup = UIHelpers.sanitizeImageUrl(coverImageGroup);
        const firstLetterGroup = (baseTitle || '').trim().charAt(0) || '';
        const coverHtmlGroup = safeCoverImageGroup
            ? `<img src="${UIHelpers.escapeHtml(safeCoverImageGroup)}" alt="${UIHelpers.escapeHtml(baseTitle)}" style="border-radius:8px;width:44px;height:58px;object-fit:cover;">
              `
            : `<div style="width:44px;height:58px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:600;color:#fff;">
                    ${UIHelpers.escapeHtml(firstLetterGroup.toUpperCase())}
               </div>`;

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
                        partIndex
                    });
                });
            } else {
                expandedSeasons.push({ ...season, partConfig: null, partIndex: null });
            }
        }

        const seasonData = expandedSeasons.map(({ slug, anime, partConfig }, index) => {
            const { CONFIG } = window.AnimeTracker;
            const episodeCount = anime.episodes?.length || 0;
            const chronologyInfo = isChronologyGroup
                ? SeasonGrouping.getChronologyInfo(baseSlug, slug, anime.title)
                : null;
            const separatorLabel = chronologyInfo?.separatorLabel || null;

            let seasonLabel;
            if (partConfig) {
                seasonLabel = partConfig.name;
            } else if (isChronologyGroup) {
                seasonLabel = chronologyInfo?.itemLabel || anime.title || slug;
            } else if (baseSlug === 'naruto' && seasons.length > 1) {
                if (index === 0) seasonLabel = 'Naruto';
                else if (index === 1) seasonLabel = 'Shippuden';
                else if (index === 2) seasonLabel = 'Boruto';
                else seasonLabel = `Season ${index + 1}`;
            } else {
                seasonLabel = SeasonGrouping.getSeasonLabel(slug, anime.title);
            }

            const isMovie = !partConfig && (seasonLabel.includes('(Movie)') || slug.includes('third-stage') || SeasonGrouping.isMovie(slug, anime));

            let progressData, progressPercent, isComplete, hasProgress, statusClass, statusIcon;
            let episodeBadgeText, progressInfoHTML, episodesHTML;

            if (isMovie) {
                const watchTime = anime.totalWatchTime || 0;
                const formattedTime = UIHelpers.formatDuration(watchTime);
                const isWatched = episodeCount > 0 || watchTime > 0;

                isComplete = isWatched;
                hasProgress = isWatched;
                statusClass = isComplete ? 'complete' : 'not-started';
                statusIcon = isComplete ? '✓' : '○';

                episodeBadgeText = formattedTime || 'Movie';
                progressInfoHTML = '';
                episodesHTML = '';
            } else {
                const partEpisodes = partConfig
                    ? (anime.episodes || []).filter(ep => ep.number >= partConfig.start && ep.number <= partConfig.end)
                    : (anime.episodes || []);
                const partEpisodeCount = partConfig ? (partConfig.end - partConfig.start + 1) : episodeCount;
                const watchedInPart = partEpisodes.length;

                if (partConfig) {
                    const displayStart = Number.isFinite(partConfig.displayStart) ? partConfig.displayStart : partConfig.start;
                    const displayEnd = Number.isFinite(partConfig.displayEnd) ? partConfig.displayEnd : partConfig.end;
                    const toDisplayEpisodeNumber = (episodeNumber) =>
                        Number.isFinite(partConfig.displayStart)
                            ? (episodeNumber - partConfig.start) + displayStart
                            : episodeNumber;
                    const partProgress = (watchedInPart / partEpisodeCount) * 100;
                    progressPercent = Math.round(partProgress);
                    isComplete = watchedInPart >= partEpisodeCount;
                    hasProgress = watchedInPart > 0;
                    statusClass = isComplete ? 'complete' : (hasProgress ? 'in-progress' : 'not-started');
                    statusIcon = isComplete ? '✓' : (hasProgress ? '▶' : '○');
                    episodeBadgeText = `Ep ${displayStart}-${displayEnd}`;

                    progressInfoHTML = `
                        <div class="progress-info">
                            <span>Ep ${partConfig.start}–${partConfig.end} · ${watchedInPart}/${partEpisodeCount}</span>
                            <span>${progressPercent}%</span>
                        </div>
                        <div class="progress-bar size-small">
                            <div class="progress-fill" style="width: ${partProgress}%"></div>
                        </div>
                    `;

                    const sortedPartEps = [...partEpisodes].sort((a, b) => b.number - a.number);
                    const visiblePartEps = sortedPartEps.slice(0, CONFIG.VISIBLE_EPISODES_LIMIT);
                    const hiddenPartEps = sortedPartEps.slice(CONFIG.VISIBLE_EPISODES_LIMIT);
                    const partEpTags = visiblePartEps.map(ep => {
                        const isFiller = FillerService.isFillerEpisode(slug, ep.number);
                        return `<span class="episode-tag${isFiller ? ' filler watched-filler' : ''}">Ep ${toDisplayEpisodeNumber(ep.number)}</span>`;
                    }).join('');
                    const partHiddenTags = hiddenPartEps.map(ep => {
                        const isFiller = FillerService.isFillerEpisode(slug, ep.number);
                        return `<span class="episode-tag${isFiller ? ' filler watched-filler' : ''}">Ep ${toDisplayEpisodeNumber(ep.number)}</span>`;
                    }).join('');
                    const partMoreEps = hiddenPartEps.length > 0
                        ? `<div class="hidden-episodes">${partHiddenTags}</div><span class="episode-tag show-more-episodes" data-more-text="+${hiddenPartEps.length} more" data-less-text="Show less">+${hiddenPartEps.length} more</span>`
                        : '';

                    episodesHTML = watchedInPart > 0 ? `
                        <div class="season-episodes">
                            <div class="episode-list">${partEpTags}${partMoreEps}</div>
                        </div>` : '';

                } else {
                    progressData = FillerService.calculateProgress(episodeCount, slug, anime);
                    progressPercent = Math.round(progressData.progress);

                    const trackedEpNums = new Set((anime.episodes || []).map(ep => ep.number));
                    const inProgressEps = [];
                    Object.entries(videoProgress).forEach(([uid, prog]) => {
                        if (!uid.startsWith(slug + '__episode-')) return;
                        const epNum = parseInt(uid.split('__episode-')[1], 10);
                        if (isNaN(epNum) || trackedEpNums.has(epNum)) return;
                        if (prog.deleted) return;
                        if (prog.percentage >= CONFIG.COMPLETED_PERCENTAGE) return;
                        if (typeof prog.currentTime !== 'number' || isNaN(prog.currentTime)) return;
                        const mins = Math.floor(prog.currentTime / 60);
                        const secs = Math.floor(prog.currentTime % 60);
                        inProgressEps.push({ number: epNum, timeStr: `${mins}:${secs.toString().padStart(2, '0')}`, percentage: prog.percentage });
                    });
                    inProgressEps.sort((a, b) => a.number - b.number);

                    let currentEp = 0;
                    if (anime.episodes?.length > 0) {
                        const validNumbers = anime.episodes.map(ep => ep.number).filter(n => !isNaN(n) && n > 0);
                        if (validNumbers.length > 0) {
                            currentEp = Math.max(...validNumbers);
                        }
                    }
                    if (inProgressEps.length > 0) {
                        currentEp = Math.max(currentEp, Math.max(...inProgressEps.map(ep => ep.number)));
                    }

                    const anilistSt = AnilistService?.getStatus(slug);
                    const _sLatest = AnilistService?.getLatestEpisode(slug);
                    const _sMetaTotal = AnilistService?.getTotalEpisodes(slug);
                    const _sPartial = _sMetaTotal && _sLatest && _sLatest < _sMetaTotal;
                    if (progressData.progress === null) {
                        isComplete = false;
                        hasProgress = episodeCount > 0;
                        progressPercent = 0;
                    } else {
                        isComplete = progressPercent >= 100 && !_sPartial;
                        if (!isComplete && !_sPartial && anime.episodes?.length > 0) {
                            const totalEps = FillerService.getTotalEpisodes(slug, episodeCount, anime);
                            if (totalEps && currentEp >= totalEps) isComplete = true;
                        }
                        hasProgress = progressPercent > 0 || episodeCount > 0;
                    }
                    statusClass = isComplete ? 'complete' : (hasProgress ? 'in-progress' : 'not-started');
                    statusIcon = isComplete ? '✓' : (hasProgress ? '▶' : '○');

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
                    const fillerInfo = FillerService.getFillerInfo(slug, anime.episodes);
                    const skippedFillers = FillerService.getSkippedFillers(slug, anime.episodes, currentEp);
                    const skippedFillersText = FillerService.formatSkippedFillersCompact(skippedFillers);
                    const skippedFillersIndicator = skippedFillers.length > 0
                        ? `<div class="anime-meta"><span class="skipped-fillers-badge" title="Skipped filler episodes: ${skippedFillersText}"><span class="icon-inline">${UIHelpers.createIcon('skip')}</span> ${skippedFillers.length} filler skipped</span></div>`
                        : '';

                    const sortedEpisodes = [...(anime.episodes || [])].sort((a, b) => b.number - a.number);
                    const visibleEpisodes = sortedEpisodes.slice(0, CONFIG.VISIBLE_EPISODES_LIMIT);
                    const hiddenEpisodes = sortedEpisodes.slice(CONFIG.VISIBLE_EPISODES_LIMIT);

                    const episodeTags = visibleEpisodes.map(ep => {
                        const isFiller = FillerService.isFillerEpisode(slug, ep.number);
                        return `<span class="episode-tag${isFiller ? ' filler watched-filler' : ''}" title="${isFiller ? 'Filler Episode (Watched)' : ''}">Ep ${ep.number}</span>`;
                    }).join('');

                    const hiddenEpisodeTags = hiddenEpisodes.map(ep => {
                        const isFiller = FillerService.isFillerEpisode(slug, ep.number);
                        return `<span class="episode-tag${isFiller ? ' filler watched-filler' : ''}" title="${isFiller ? 'Filler Episode (Watched)' : ''}">Ep ${ep.number}</span>`;
                    }).join('');

                    const moreEpisodes = hiddenEpisodes.length > 0
                        ? `<div class="hidden-episodes">${hiddenEpisodeTags}</div><span class="episode-tag show-more-episodes" data-more-text="+${hiddenEpisodes.length} more" data-less-text="Show less">+${hiddenEpisodes.length} more</span>`
                        : '';

                    const unwatchedFillers = FillerService.getUnwatchedFillers(slug, anime.episodes, currentEp).slice().reverse();
                    const visibleUFillers = unwatchedFillers.slice(0, CONFIG.VISIBLE_FILLERS_LIMIT);
                    const hiddenUFillers = unwatchedFillers.slice(CONFIG.VISIBLE_FILLERS_LIMIT);
                    const unwatchedFillerTags = visibleUFillers.map(epNum =>
                        `<span class="episode-tag filler unwatched-filler" title="Filler Episode (Not watched)">Ep ${epNum}</span>`
                    ).join('');
                    const hiddenFillerTags = hiddenUFillers.map(epNum =>
                        `<span class="episode-tag filler unwatched-filler" title="Filler Episode (Not watched)">Ep ${epNum}</span>`
                    ).join('');
                    const showMoreFillers = hiddenUFillers.length > 0
                        ? `<div class="hidden-fillers">${hiddenFillerTags}</div><span class="episode-tag filler show-more-fillers" data-more-text="+${hiddenUFillers.length} more" data-less-text="Show less">+${hiddenUFillers.length} more</span>`
                        : '';
                    const unwatchedFillersSection = unwatchedFillers.length > 0
                        ? `<div class="unwatched-fillers-section"><span class="unwatched-fillers-label">Unwatched Fillers <span class="filler-count">${unwatchedFillers.length}</span></span><div class="episode-list">${unwatchedFillerTags}${showMoreFillers}</div></div>`
                        : '';

                    const watchedFillerCount = fillerInfo?.watched || 0;
                    const totalFillerCount = fillerInfo?.total || 0;
                    const fillerProgressPercent = totalFillerCount > 0 ? Math.round((watchedFillerCount / totalFillerCount) * 100) : 0;
                    const fillerProgressBar = (hasFillerData && watchedFillerCount > 0) ? `
                    <div class="progress-container filler-progress">
                        <div class="progress-info">
                            <span class="filler-label" title="Watched fillers: ${watchedFillerCount} · Skipped fillers: ${skippedFillers.length}"><span class="icon-inline">${UIHelpers.createIcon('filler')}</span> Filler ${watchedFillerCount}/${totalFillerCount}</span>
                            <span>${fillerProgressPercent}%</span>
                        </div>
                        <div class="progress-bar filler-bar size-small">
                            <div class="progress-fill filler-fill" style="width: ${fillerProgressPercent}%; min-width: ${fillerProgressPercent > 0 ? 2 : 0}px; opacity: 1;"></div>
                        </div>
                    </div>` : '';

                    const unknownTotalSeason = progressData.total == null;
                    const totalDisplay = unknownTotalSeason ? null : progressData.total;
                    const totalCanonDisplay = unknownTotalSeason ? null : totalCanon;
                    const canonProgressPercent = unknownTotalSeason ? (isComplete ? 100 : 0)
                        : hasFillerData ? (totalCanon > 0 ? Math.round((canonWatched / totalCanon) * 100) : 0) : progressPercent;
                    const canonProgressWidth = unknownTotalSeason ? (isComplete ? 100 : 0)
                        : hasFillerData ? (totalCanon > 0 ? (canonWatched / totalCanon) * 100 : 0) : progressData.progress;

                    const latestAvailEp = _sLatest || null;
                    const availableText = latestAvailEp && latestAvailEp > 0 && _sPartial
                        ? ` / ${latestAvailEp} available` : '';

                    const progressInfoText = unknownTotalSeason
                        ? (anilistSt === 'FINISHED'
                            ? `<span><span class="icon-inline">${UIHelpers.createIcon('canon')}</span> Ep ${currentEp > 0 ? currentEp : episodeCount} · Watched ${episodeCount} eps</span>`
                            : `<span><span class="icon-inline">${UIHelpers.createIcon('canon')}</span> Ep ${currentEp > 0 ? currentEp : episodeCount}${availableText} · Airing</span>`)
                        : hasFillerData
                            ? `<span title="Canon: ${canonWatched}/${totalCanonDisplay}"><span class="icon-inline">${UIHelpers.createIcon('canon')}</span> Ep ${currentEp > 0 ? currentEp : episodeCount}${availableText} · Canon ${canonWatched}/${totalCanonDisplay}</span>`
                            : `<span>Ep ${currentEp > 0 ? currentEp : episodeCount}${availableText} · Total ${episodeCount}/${totalDisplay}</span>`;

                    progressInfoHTML = `
                    <div class="progress-info">
                        ${progressInfoText}
                        <span>${canonProgressPercent > 0 ? canonProgressPercent + '%' : ''}</span>
                    </div>
                    <div class="progress-bar size-small">
                        <div class="progress-fill" style="width: ${canonProgressWidth}%"></div>
                    </div>
                    ${fillerProgressBar}
                    ${skippedFillersIndicator}
                `;

                    const inProgressTags = inProgressEps.map(ep =>
                        `<span class="episode-tag in-progress" title="Saved: ${ep.percentage}%">
                        Ep ${ep.number} (${ep.timeStr})
                        <button class="progress-delete-btn" data-slug="${slug}" data-episode="${ep.number}" title="Delete progress">×</button>
                    </span>`
                    ).join('');
                    const inProgressSection = inProgressTags ? `
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
                    </div>` : '';

                    episodesHTML = `
                    <div class="season-episodes">
                        ${inProgressSection}
                        <div class="episode-list">${episodeTags}${moreEpisodes}</div>
                        ${unwatchedFillersSection}
                    </div>
                `;
                }
            }

            const hasExpandableContent = !isMovie;
            const expandIconHtml = hasExpandableContent
                ? `<div class="season-expand-icon">${UIHelpers.createIcon('chevron')}</div>`
                : '';
            const contentHtml = hasExpandableContent
                ? `<div class="season-item-content">
                        <div class="season-progress-container">
                            ${progressInfoHTML}
                        </div>
                        ${episodesHTML}
                    </div>`
                : '';

            const rightSideHtml = isMovie
                ? `<span class="meta-badge season-movie-type-badge">Movie</span>
                   <span class="movie-duration">${episodeBadgeText}</span>
                   <div class="season-item-actions">
                       <button class="season-edit-btn" data-slug="${slug}" title="Edit title">${UIHelpers.createIcon('edit')}</button>
                       <button class="season-delete-btn" data-slug="${slug}" title="Delete">${UIHelpers.createIcon('delete')}</button>
                   </div>`
                : `<span class="season-episode-badge">${episodeBadgeText}</span>
                   <div class="season-item-actions">
                       <button class="season-edit-btn" data-slug="${slug}" title="Edit title">${UIHelpers.createIcon('edit')}</button>
                       <button class="season-delete-btn" data-slug="${slug}" title="Delete">${UIHelpers.createIcon('delete')}</button>
                   </div>
                   ${expandIconHtml}`;

            const html = `
                <div class="season-item ${statusClass}${isMovie ? ' season-item-movie' : ''}" data-slug="${slug}">
                    <div class="season-item-header">
                        <div class="season-item-left">
                            <span class="season-status-icon">${statusIcon}</span>
                            <span class="season-label">${seasonLabel}</span>
                        </div>
                        <div class="season-item-right">
                            ${rightSideHtml}
                        </div>
                    </div>
                    ${contentHtml}
                </div>
            `;

            return { html, isComplete, separatorLabel };
        });

        let lastSeparatorLabel = null;
        const seasonItemsHTML = seasonData.map((item) => {
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
                : '';

            return `${separatorHtml}${item.html}`;
        }).join('');
        const allSeasonsComplete = seasonData.every(d => d.isComplete);

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
                lastWatchedText = latestWatched ? UIHelpers.formatDate(latestWatched.toISOString()) : 'Never';
            }
        } else {
            lastWatchedText = latestWatched ? UIHelpers.formatDate(latestWatched.toISOString()) : 'Never';
        }
        const itemCount = expandedSeasons.length;
        const itemLabel = isChronologyGroup
            ? `${itemCount} titles`
            : (itemCount === filteredSeasons.length ? `${itemCount} seasons` : `${itemCount} parts`);

        const anyStarted = filteredSeasons.some(({ anime }) =>
            (anime.episodes?.length || 0) > 0 || (anime.totalWatchTime || 0) > 0
        );
        let statusGroup;
        if (!anyStarted) {
            statusGroup = 'Not started';
        } else if (allSeasonsComplete) {
            statusGroup = 'Completed';
        } else {
            statusGroup = 'Watching';
        }
        const groupProgressBadge = !allSeasonsComplete
            ? `<span class="meta-badge meta-badge-progress">${itemLabel}</span>`
            : '';
        const groupStatusClass = allSeasonsComplete ? 'meta-badge-complete' : (anyStarted ? 'meta-badge-watching' : 'meta-badge-notstarted');
        const groupStatusIcon = allSeasonsComplete ? '✓' : '⊙';
        const groupStatusBadge = `<span class="meta-badge ${groupStatusClass}">${groupStatusIcon} ${statusGroup}</span>`;
        const metaRowHtmlGroup = `<div class="season-group-meta-row">${groupProgressBadge}${groupStatusBadge}</div><span class="meta-time">${lastWatchedText}</span>`;

        return `
            <div class="anime-season-group" data-base-slug="${baseSlug}">
                <div class="season-group-header">
                    <div class="season-group-logo" style="flex-shrink:0;">
                        ${coverHtmlGroup}
                    </div>
                    <div class="season-header-main" style="flex:1; display:flex; flex-direction:column; min-width:0; margin-left:8px;">
                        <div class="season-title-row" style="display:flex; align-items:center; overflow:hidden;">
                            <span class="season-group-name" style="font-size:14px;font-weight:600;color:var(--t1);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${UIHelpers.escapeHtml(baseTitle)}</span>
                        </div>
                        ${metaRowHtmlGroup}
                    </div>
                    <div class="season-group-actions">
                        <div class="season-group-expand-icon">${UIHelpers.createIcon('chevron')}</div>
                    </div>
                </div>
                <div class="season-group-content">
                    ${seasonItemsHTML}
                </div>
            </div>
        `;
    },

    extractBaseTitle(title) {
        return title
            .replace(/\s*-?\s*Season\s*\d+\s*$/i, '')
            .replace(/\s*-?\s*S\d+\s*$/i, '')
            .replace(/\s*\d+(st|nd|rd|th)\s*Season\s*$/i, '')
            .replace(/\s*-?\s*Part\s*\d+\s*$/i, '')
            .replace(/\s*-?\s*Episode\s*$/i, '')
            .replace(/\s*[-:]\s*$/, '')
            .trim();
    },

    extractMovieBaseTitle(title) {
        return title
            .replace(/\s*-?\s*Movie\s*\d+.*$/i, '')
            .replace(/\s*-?\s*Film[:\s].*$/i, '')
            .replace(/\s*[-:]\s*$/, '')
            .trim();
    },

    createMovieGroup(baseSlug, movies) {
        const { UIHelpers, SeasonGrouping } = window.AnimeTracker;

        const firstMovie = movies[0];
        const baseTitle = this.extractMovieBaseTitle(firstMovie.anime.title);

        let latestWatched = null;

        movies.forEach(({ anime }) => {
            if (anime.lastWatched) {
                const date = new Date(anime.lastWatched);
                if (!latestWatched || date > latestWatched) {
                    latestWatched = date;
                }
            }
        });

        const movieItemsHTML = movies.map(({ slug, anime }) => {
            const movieLabel = SeasonGrouping.getMovieLabel(slug, anime.title);
            const watchTime = anime.totalWatchTime || 0;
            const formattedTime = UIHelpers.formatDuration(watchTime);

            const isWatched = anime.episodes?.length > 0 || watchTime > 0;
            const statusClass = isWatched ? 'complete' : 'not-started';
            const statusIcon = isWatched ? '✓' : '○';

            return `
                <div class="movie-item ${statusClass}" data-slug="${slug}">
                    <div class="movie-item-header">
                        <div class="movie-item-left">
                            <span class="movie-status-icon">${statusIcon}</span>
                            <span class="movie-label">${movieLabel}</span>
                        </div>
                        <div class="movie-item-right">
                            <span class="movie-duration">${formattedTime}</span>
                            <div class="movie-item-actions">
                                <button class="movie-edit-btn" data-slug="${slug}" title="Edit title">${UIHelpers.createIcon('edit')}</button>
                                <button class="movie-delete-btn" data-slug="${slug}" title="Delete">${UIHelpers.createIcon('delete')}</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const watchedCount = movies.filter(m => m.anime.episodes?.length > 0 || (m.anime.totalWatchTime || 0) > 0).length;
        const allMoviesWatchedForDate = watchedCount >= movies.length;
        let lastWatchedText;
        if (allMoviesWatchedForDate && watchedCount > 0) {
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
                lastWatchedText = latestWatched ? UIHelpers.formatDate(latestWatched.toISOString()) : 'Never';
            }
        } else {
            lastWatchedText = latestWatched ? UIHelpers.formatDate(latestWatched.toISOString()) : 'Never';
        }

        const groupImages = (window.AnimeTracker && window.AnimeTracker.groupCoverImages) || {};
        const coverImageGroup = groupImages[baseSlug] || ((firstMovie?.anime && firstMovie.anime.coverImage) ? firstMovie.anime.coverImage : null);
        const safeCoverImageGroup = UIHelpers.sanitizeImageUrl(coverImageGroup);
        const firstLetterGroup = (baseTitle || '').trim().charAt(0) || '';
        const coverHtmlGroup = safeCoverImageGroup
            ? `<img src="${UIHelpers.escapeHtml(safeCoverImageGroup)}" alt="${UIHelpers.escapeHtml(baseTitle)}" style="border-radius:8px;width:44px;height:58px;object-fit:cover;">`
            : `<div style="width:44px;height:58px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:600;color:#fff;">
                    ${UIHelpers.escapeHtml(firstLetterGroup.toUpperCase())}
               </div>`;

        const totalMovies = movies.length;
        const statusGroup = (watchedCount === 0) ? 'Not started' : (watchedCount < totalMovies ? 'Watching' : 'Completed');
        const allMoviesWatched = watchedCount >= totalMovies;
        const movieTypeBadge = `<span class="meta-badge" style="color:#f4a261;background:rgba(244,162,97,0.12);border:1px solid rgba(244,162,97,0.35);">${totalMovies} Movies</span>`;
        const movieStatusClass = allMoviesWatched ? 'meta-badge-complete' : (watchedCount > 0 ? 'meta-badge-watching' : 'meta-badge-notstarted');
        const movieStatusIcon = allMoviesWatched ? '✓' : '⊙';
        const movieStatusBadge = `<span class="meta-badge ${movieStatusClass}">${movieStatusIcon} ${statusGroup}</span>`;
        const metaRowHtml = `<div class="movie-group-meta-row">${movieTypeBadge}${movieStatusBadge}</div><span class="meta-time">${lastWatchedText}</span>`;

        return `
            <div class="anime-movie-group" data-base-slug="${baseSlug}">
                <div class="movie-group-header">
                    <div class="movie-group-logo" style="flex-shrink:0;">
                        ${coverHtmlGroup}
                    </div>
                    <div class="movie-header-main" style="flex:1; display:flex; flex-direction:column; min-width:0; margin-left:8px;">
                        <div class="movie-title-row" style="display:flex; align-items:center; overflow:hidden;">
                            <span class="movie-group-name" style="font-size:14px;font-weight:600;color:var(--t1);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${UIHelpers.escapeHtml(baseTitle)} Movies</span>
                        </div>
                        ${metaRowHtml}
                    </div>
                    <div class="movie-group-actions">
                        <div class="movie-group-expand-icon">${UIHelpers.createIcon('chevron')}</div>
                    </div>
                </div>
                <div class="movie-group-content">
                    ${movieItemsHTML}
                </div>
            </div>
        `;
    },

    createSingleMovieCard(slug, anime) {
        const { UIHelpers } = window.AnimeTracker;

        const title = anime.title || slug;
        const watchTime = anime.totalWatchTime || 0;
        const formattedTime = UIHelpers.formatDuration(watchTime);
        const isWatched = anime.episodes?.length > 0 || watchTime > 0;
        let lastWatched;
        if (isWatched) {
            const startedDate = UIHelpers.getStartedDate(anime);
            if (startedDate && anime.lastWatched) {
                lastWatched = `${UIHelpers.formatShortDate(startedDate)} / ${UIHelpers.formatShortDate(anime.lastWatched)}`;
            } else {
                lastWatched = anime.lastWatched ? UIHelpers.formatDate(anime.lastWatched) : 'Never';
            }
        } else {
            lastWatched = anime.lastWatched ? UIHelpers.formatDate(anime.lastWatched) : 'Never';
        }

        const coverImg = anime.coverImage || null;
        const safeCoverImg = UIHelpers.sanitizeImageUrl(coverImg);
        const firstLetter = (title || '').trim().charAt(0) || '';
        const coverHtml = safeCoverImg
            ? `<img src="${UIHelpers.escapeHtml(safeCoverImg)}" alt="${UIHelpers.escapeHtml(title)}" style="border-radius:8px;width:44px;height:58px;object-fit:cover;">`
            : `<div style="width:44px;height:58px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:600;color:#fff;">
                    ${UIHelpers.escapeHtml(firstLetter.toUpperCase())}
               </div>`;

        const singleStatusClass = isWatched ? 'meta-badge-complete' : 'meta-badge-notstarted';
        const singleStatusIcon = isWatched ? '✓' : '⊙';
        const singleStatusText = isWatched ? 'Watched' : 'Not watched';
        const metaRowHtml = `<div class="single-movie-meta-row"><span class="meta-badge" style="color:#f4a261;background:rgba(244,162,97,0.12);border:1px solid rgba(244,162,97,0.35);">Movie</span><span class="meta-badge ${singleStatusClass}">${singleStatusIcon} ${singleStatusText}</span></div><span class="meta-time">${lastWatched}</span>`;

        return `
            <div class="anime-movie-group single-movie" data-base-slug="${slug}">
                <div class="movie-group-header">
                    <div class="movie-group-logo" style="flex-shrink:0;">
                        ${coverHtml}
                    </div>
                    <div class="movie-header-main" style="flex:1; display:flex; flex-direction:column; min-width:0; margin-left:8px;">
                        <div class="movie-title-row" style="display:flex; align-items:center; overflow:hidden;">
                            <span class="movie-group-name" style="font-size:14px;font-weight:600;color:var(--t1);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${UIHelpers.escapeHtml(title)}</span>
                        </div>
                        ${metaRowHtml}
                    </div>
                    <div class="movie-group-actions">
                        <div class="movie-group-expand-icon">${UIHelpers.createIcon('chevron')}</div>
                    </div>
                </div>
                <div class="movie-group-content">
                    <div class="movie-item ${isWatched ? 'complete' : 'not-started'}" data-slug="${slug}">
                        <div class="movie-item-header">
                            <div class="movie-item-left">
                                <span class="movie-status-icon">${isWatched ? '✓' : '○'}</span>
                                <span class="movie-label">${UIHelpers.escapeHtml(title)}</span>
                            </div>
                            <div class="movie-item-right">
                                <span class="movie-duration">${formattedTime}</span>
                                <div class="movie-item-actions">
                                    <button class="movie-edit-btn" data-slug="${slug}" title="Edit title">${UIHelpers.createIcon('edit')}</button>
                                    <button class="movie-delete-btn" data-slug="${slug}" title="Delete">${UIHelpers.createIcon('delete')}</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
};

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.AnimeCardRenderer = AnimeCardRenderer;