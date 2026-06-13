



(function () {
    'use strict';

    const AT = (window.AnimeTracker = window.AnimeTracker || {});
    const AnimeCardRenderer = (AT.AnimeCardRenderer = AT.AnimeCardRenderer || {});

    // ─── Shared group-card chrome ────────────────────────────────────────────
    // Season groups, movie groups and single-movie cards share the same DOM
    // shape. The structural elements carry a neutral `grp-*` class (styled once
    // in popup.css). Each variant ALSO keeps its semantic class where JS hooks
    // it (capture/restore + click-delegation in render-list.js, edit/delete in
    // main.js) or where the styling genuinely diverges (item rows, buttons).
    const VARIANT = {
        season: {
            card: 'anime-season-group', header: 'season-group-header',
            item: 'season-item', itemHeader: 'season-item-header',
            itemRight: 'season-item-right', label: 'season-label',
        },
        movie: {
            card: 'anime-movie-group', header: 'movie-group-header',
            item: 'movie-item', itemHeader: 'movie-item-header',
            itemRight: 'movie-item-right', label: 'movie-label',
        },
    };

    // Shared status glyphs for every movie render path (single card, movie
    // group header/rows, movie-inside-season-group). Keeps the icon identical
    // everywhere instead of mixing ✓/⊙/○.
    const MOVIE_ICON_COMPLETED = '✓';
    const MOVIE_ICON_INCOMPLETE = '○';

    Object.assign(AnimeCardRenderer, {
        // Outer shell for any grouped card. `title`/`metaRowHtml`/`coverHtml`/
        // `itemsHtml` are pre-escaped HTML fragments built by the caller.
        renderGroupShell({ variant, baseSlug, extraClass = '', coverHtml, title, metaRowHtml, itemsHtml }) {
            const { UIHelpers } = window.AnimeTracker;
            const v = VARIANT[variant];
            return `
                <div class="grp-card ${v.card}${extraClass ? ' ' + extraClass : ''}" data-base-slug="${baseSlug}">
                    <div class="grp-header ${v.header}">
                        <div class="grp-logo">${coverHtml}</div>
                        <div class="grp-header-main">
                            <div class="grp-title-row"><span class="grp-name">${title}</span></div>
                            ${metaRowHtml}
                        </div>
                        <div class="grp-actions">
                            <div class="grp-expand-icon">${UIHelpers.createIcon('chevron')}</div>
                        </div>
                    </div>
                    <div class="grp-content">
                        ${itemsHtml}
                    </div>
                </div>
            `;
        },

        // One row inside a group. `rightHtml`/`contentHtml` are variant-built so
        // each variant keeps its own badges / actions / expandable content.
        renderGroupItem({ variant, slug, statusClass, statusIcon, label, rightHtml, contentHtml = '', extraItemClass = '' }) {
            const { UIHelpers } = window.AnimeTracker;
            const v = VARIANT[variant];
            return `
                <div class="grp-item ${v.item} ${statusClass}${extraItemClass ? ' ' + extraItemClass : ''}" data-slug="${UIHelpers.escapeHtml(slug)}">
                    <div class="grp-item-header ${v.itemHeader}">
                        <div class="grp-item-left">
                            <span class="grp-status-icon">${statusIcon}</span>
                            <span class="${v.label}">${label}</span>
                        </div>
                        <div class="${v.itemRight}">
                            ${rightHtml}
                        </div>
                    </div>
                    ${contentHtml}
                </div>
            `;
        },

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
                    const isWatched = this.isMovieWatched(anime);

                    isComplete = isWatched;
                    hasProgress = isWatched;
                    statusClass = isComplete ? 'complete' : 'not-started';
                    statusIcon = isComplete ? MOVIE_ICON_COMPLETED : MOVIE_ICON_INCOMPLETE;

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
                        const progressLabel = UIHelpers.formatProgressPercent(partProgress);
                        isComplete = watchedInPart >= partEpisodeCount;
                        hasProgress = watchedInPart > 0;
                        statusClass = isComplete ? 'complete' : (hasProgress ? 'in-progress' : 'not-started');
                        statusIcon = isComplete ? '✓' : (hasProgress ? '▶' : '○');
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
                            isComplete = progressData.progress >= 100 && !_sPartial;
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
                        const canonProgressValue = unknownTotalSeason ? (isComplete ? 100 : 0)
                            : hasFillerData ? (totalCanon > 0 ? (canonWatched / totalCanon) * 100 : 0) : progressData.progress;
                        const canonProgressLabel = UIHelpers.formatProgressPercent(canonProgressValue);
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
                            <span>${canonProgressValue > 0 ? canonProgressLabel : ''}</span>
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

                const html = this.renderGroupItem({
                    variant: 'season',
                    slug,
                    statusClass,
                    statusIcon,
                    label: UIHelpers.escapeHtml(seasonLabel),
                    rightHtml: rightSideHtml,
                    contentHtml,
                    extraItemClass: isMovie ? 'season-item-movie' : ''
                });

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
            const metaRowHtmlGroup = `<div class="grp-meta-row">${groupProgressBadge}${groupStatusBadge}</div><span class="meta-time">${lastWatchedText}</span>`;

            return this.renderGroupShell({
                variant: 'season',
                baseSlug,
                coverHtml: coverHtmlGroup,
                title: UIHelpers.escapeHtml(baseTitle),
                metaRowHtml: metaRowHtmlGroup,
                itemsHtml: seasonItemsHTML
            });
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

        // ─── Movies ──────────────────────────────────────────────────────────
        getRealMovieEpisodes(anime) {
            return (anime?.episodes || []).filter(ep => ep?.durationSource !== 'anilist');
        },

        getRealMovieWatchTime(anime) {
            return this.getRealMovieEpisodes(anime)
                .reduce((sum, ep) => sum + (Number(ep?.duration) || 0), 0);
        },

        // Single source of truth for "has this movie been watched/completed?"
        // used by every movie render path so the state is consistent whether the
        // movie is standalone, in a movie group, or inside a season group.
        isMovieWatched(anime) {
            if (!anime) return false;
            return this.getRealMovieEpisodes(anime).length > 0
                || this.getRealMovieWatchTime(anime) > 0
                || (Number(anime.totalWatchTime) || 0) > 0;
        },

        extractMovieBaseTitle(title) {
            return title
                .replace(/\s*-?\s*Movie\s*\d+.*$/i, '')
                .replace(/\s*-?\s*Film[:\s].*$/i, '')
                .replace(/\s*[-:]\s*$/, '')
                .trim();
        },

        renderMovieItem(slug, label, formattedTime, isWatched) {
            const { UIHelpers } = window.AnimeTracker;
            const rightHtml = `<span class="movie-duration">${formattedTime}</span>
                                <div class="movie-item-actions">
                                    <button class="movie-edit-btn" data-slug="${UIHelpers.escapeHtml(slug)}" title="Edit title">${UIHelpers.createIcon('edit')}</button>
                                    <button class="movie-delete-btn" data-slug="${UIHelpers.escapeHtml(slug)}" title="Delete">${UIHelpers.createIcon('delete')}</button>
                                </div>`;
            return this.renderGroupItem({
                variant: 'movie',
                slug,
                statusClass: isWatched ? 'complete' : 'not-started',
                statusIcon: isWatched ? MOVIE_ICON_COMPLETED : MOVIE_ICON_INCOMPLETE,
                label: UIHelpers.escapeHtml(label),
                rightHtml
            });
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
                const watchTime = this.getRealMovieWatchTime(anime);
                const formattedTime = UIHelpers.formatDuration(watchTime);
                const isWatched = this.isMovieWatched(anime);
                return this.renderMovieItem(slug, movieLabel, formattedTime, isWatched);
            }).join('');

            const watchedCount = movies.filter(m => this.isMovieWatched(m.anime)).length;
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
            const coverHtmlGroup = UIHelpers.renderCoverFigure(baseTitle, coverImageGroup);

            const totalMovies = movies.length;
            const statusGroup = (watchedCount === 0) ? 'Not started' : (watchedCount < totalMovies ? 'Watching' : 'Completed');
            const allMoviesWatched = watchedCount >= totalMovies;
            const movieTypeBadge = `<span class="meta-badge" style="color:#f4a261;background:rgba(244,162,97,0.12);border:1px solid rgba(244,162,97,0.35);">${totalMovies} Movies</span>`;
            const movieStatusClass = allMoviesWatched ? 'meta-badge-complete' : (watchedCount > 0 ? 'meta-badge-watching' : 'meta-badge-notstarted');
            const movieStatusIcon = allMoviesWatched ? MOVIE_ICON_COMPLETED : MOVIE_ICON_INCOMPLETE;
            const movieStatusBadge = `<span class="meta-badge ${movieStatusClass}">${movieStatusIcon} ${statusGroup}</span>`;
            const metaRowHtml = `<div class="grp-meta-row">${movieTypeBadge}${movieStatusBadge}</div><span class="meta-time">${lastWatchedText}</span>`;

            return this.renderGroupShell({
                variant: 'movie',
                baseSlug,
                coverHtml: coverHtmlGroup,
                title: `${UIHelpers.escapeHtml(baseTitle)} Movies`,
                metaRowHtml,
                itemsHtml: movieItemsHTML
            });
        },

        createSingleMovieCard(slug, anime) {
            const { UIHelpers } = window.AnimeTracker;

            const title = anime.title || slug;
            const watchTime = this.getRealMovieWatchTime(anime);
            const formattedTime = UIHelpers.formatDuration(watchTime);
            const isWatched = this.isMovieWatched(anime);
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

            const coverHtml = UIHelpers.renderCoverFigure(title, anime.coverImage || null);

            const singleStatusClass = isWatched ? 'meta-badge-complete' : 'meta-badge-notstarted';
            const singleStatusIcon = isWatched ? MOVIE_ICON_COMPLETED : MOVIE_ICON_INCOMPLETE;
            const singleStatusText = isWatched ? 'Completed' : 'Not started';
            const metaRowHtml = `<div class="grp-meta-row"><span class="meta-badge" style="color:#f4a261;background:rgba(244,162,97,0.12);border:1px solid rgba(244,162,97,0.35);">Movie</span><span class="meta-badge ${singleStatusClass}">${singleStatusIcon} ${singleStatusText}</span></div><span class="meta-time">${lastWatched}</span>`;

            return this.renderGroupShell({
                variant: 'movie',
                baseSlug: slug,
                extraClass: 'single-movie',
                coverHtml,
                title: UIHelpers.escapeHtml(title),
                metaRowHtml,
                itemsHtml: this.renderMovieItem(slug, title, formattedTime, isWatched)
            });
        }
    });
})();
