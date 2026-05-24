/**
 * Anime Tracker — Multi-season group renderer
 *
 * Augments `window.AnimeTracker.AnimeCardRenderer` with `createSeasonGroup`
 * (the largest single method in the original file, ~450 lines) and the
 * helper `extractBaseTitle`. Pulled out so the main anime-card.js focuses
 * on the single-series card path.
 *
 * Loaded AFTER anime-card.js so the AnimeCardRenderer namespace exists.
 */
(function () {
    'use strict';

    const AT = (window.AnimeTracker = window.AnimeTracker || {});
    const AnimeCardRenderer = (AT.AnimeCardRenderer = AT.AnimeCardRenderer || {});

    Object.assign(AnimeCardRenderer, {
        createSeasonGroup(baseSlug, seasons, videoProgress = {}) {
            const { UIHelpers, SeasonGrouping, FillerService, ANIME_PARTS_CONFIG, SlugUtils } = window.AnimeTracker;
            const AnilistService = window.AnimeTracker.AnilistService;
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
                                const totalEps = FillerService.getTotalEpisodes(slug, anime);
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
                            <button class="progress-delete-btn" data-slug="${UIHelpers.escapeHtml(slug)}" data-episode="${ep.number}" title="Delete progress">×</button>
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
                           <button class="season-edit-btn" data-slug="${UIHelpers.escapeHtml(slug)}" title="Edit title">${UIHelpers.createIcon('edit')}</button>
                           <button class="season-delete-btn" data-slug="${UIHelpers.escapeHtml(slug)}" title="Delete">${UIHelpers.createIcon('delete')}</button>
                       </div>`
                    : `<span class="season-episode-badge">${episodeBadgeText}</span>
                       <div class="season-item-actions">
                           <button class="season-edit-btn" data-slug="${UIHelpers.escapeHtml(slug)}" title="Edit title">${UIHelpers.createIcon('edit')}</button>
                           <button class="season-delete-btn" data-slug="${UIHelpers.escapeHtml(slug)}" title="Delete">${UIHelpers.createIcon('delete')}</button>
                       </div>
                       ${expandIconHtml}`;

                const html = `
                    <div class="season-item ${statusClass}${isMovie ? ' season-item-movie' : ''}" data-slug="${UIHelpers.escapeHtml(slug)}">
                        <div class="season-item-header">
                            <div class="season-item-left">
                                <span class="season-status-icon">${statusIcon}</span>
                                <span class="season-label">${UIHelpers.escapeHtml(seasonLabel)}</span>
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
            const groupProgressBadge = `<span class="meta-badge meta-badge-progress">${itemLabel}</span>`;
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
        }
    });
})();
