/**
 * Anime Tracker - Anime Card Renderer
 * Handles rendering of anime cards in the popup
 */

const AnimeCardRenderer = {
    /**
     * Create anime card HTML
     */
    createAnimeCard(slug, anime, videoProgress = {}) {
        const { UIHelpers } = window.AnimeTracker;
        const { FillerService } = window.AnimeTracker;
        const { CONFIG } = window.AnimeTracker;

        const episodeCount = anime.episodes?.length || 0;
        const totalTime = UIHelpers.formatDuration(anime.totalWatchTime || 0);
        const lastWatched = UIHelpers.formatDate(anime.lastWatched);
        const progressData = FillerService.calculateProgress(episodeCount, slug, anime);
        const sizeClass = UIHelpers.getProgressSizeClass(episodeCount, progressData.total);

        // Canon episode counts
        const canonWatched = FillerService.getCanonEpisodeCount(slug, anime.episodes);
        const totalCanon = FillerService.getTotalCanonEpisodes(slug, progressData.total);
        const hasFillerData = FillerService.hasFillerData(slug);
        const canonProgress = hasFillerData ? (canonWatched / totalCanon) * 100 : null;

        // Get highest completed episode
        let highestCompletedEp = 0;
        if (anime.episodes?.length > 0) {
            const validNumbers = anime.episodes.map(ep => ep.number).filter(n => !isNaN(n) && n > 0);
            if (validNumbers.length > 0) {
                highestCompletedEp = Math.max(...validNumbers);
            }
        }

        // Get tracked episode numbers
        const trackedEpisodeNumbers = new Set((anime.episodes || []).map(ep => ep.number));

        // Get episodes with progress
        const episodesWithProgress = [];
        Object.entries(videoProgress).forEach(([uniqueId, progress]) => {
            if (uniqueId.startsWith(slug + '__episode-')) {
                const parts = uniqueId.split('episode-');
                if (parts.length !== 2 || !parts[1]) return;

                const epNum = parseInt(parts[1], 10);
                if (trackedEpisodeNumbers.has(epNum)) return;
                if (progress.percentage >= CONFIG.COMPLETED_PERCENTAGE) return;

                if (typeof progress.currentTime !== 'number' ||
                    typeof progress.percentage !== 'number' ||
                    typeof progress.duration !== 'number' ||
                    isNaN(progress.currentTime) ||
                    isNaN(progress.percentage) ||
                    isNaN(progress.duration)) {
                    return;
                }

                const minutes = Math.floor(progress.currentTime / 60);
                const seconds = progress.currentTime % 60;
                episodesWithProgress.push({
                    number: epNum,
                    timeStr: `${minutes}:${seconds.toString().padStart(2, '0')}`,
                    percentage: progress.percentage
                });
            }
        });
        episodesWithProgress.sort((a, b) => a.number - b.number);

        // Get current episode
        const highestInProgressEp = episodesWithProgress.length > 0
            ? Math.max(...episodesWithProgress.map(ep => ep.number))
            : 0;
        const currentEpisode = Math.max(highestCompletedEp, highestInProgressEp);

        // Skipped fillers
        const skippedFillers = FillerService.getSkippedFillers(slug, anime.episodes, currentEpisode);
        const skippedFillersText = FillerService.formatSkippedFillersCompact(skippedFillers);
        const skippedFillersIndicator = skippedFillers.length > 0
            ? `<span class="skipped-fillers-badge" title="Skipped filler episodes: ${skippedFillersText}">⏭️ ${skippedFillers.length} filler skipped</span>`
            : '';

        // Progress tags με delete buttons
        const progressTags = episodesWithProgress.map(ep =>
            `<span class="episode-tag in-progress" data-episode="${ep.number}" title="Saved: ${ep.percentage}%">
                Ep ${ep.number} (${ep.timeStr})
                <button class="progress-delete-btn" data-slug="${slug}" data-episode="${ep.number}" title="Delete progress">×</button>
            </span>`
        ).join('');

        // Episode tags - sort by episode number descending (highest/latest first)
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

        // Unwatched fillers
        const unwatchedFillers = FillerService.getUnwatchedFillers(slug, anime.episodes, currentEpisode);
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

        // Filler info
        const fillerInfo = FillerService.getFillerInfo(slug, anime.episodes);

        const latestProgress = episodesWithProgress[0];
        const latestProgressPreview = latestProgress ? `Ep ${latestProgress.number} (${latestProgress.timeStr})` : '';

        // Progress section - COMPACT DESIGN
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

        // Progress info
        const currentEpText = currentEpisode > 0 ? `Ep ${currentEpisode}` : '';
        const canonProgressPercent = hasFillerData
            ? Math.round((canonWatched / totalCanon) * 100)
            : Math.round(progressData.progress);
        const canonProgressWidth = hasFillerData
            ? (canonWatched / totalCanon) * 100
            : progressData.progress;

        const totalFillerCount = fillerInfo?.total || 0;
        const watchedFillerCount = fillerInfo?.watched || 0;

        const totalDisplay = progressData.isGuessed ? `~${progressData.total}` : progressData.total;
        const totalCanonDisplay = progressData.isGuessed ? `~${totalCanon}` : totalCanon;

        const progressInfoText = hasFillerData
            ? `<span title="Canon: ${canonWatched}/${totalCanonDisplay} | Total: ${episodeCount}/${totalDisplay}${progressData.isGuessed ? ' (estimated)' : ''}">📍 ${currentEpText} · ${canonWatched}/${totalCanonDisplay} · ${totalFillerCount} filler</span>`
            : `<span title="Current: Ep ${currentEpisode}${progressData.isGuessed ? ' (total estimated)' : ''}">📍 ${currentEpText} · ${episodeCount}/${totalDisplay}</span>`;

        // Filler progress section
        const watchedFillers = fillerInfo?.watched || 0;
        const totalFillers = fillerInfo?.total || 0;
        const fillerProgressPercent = totalFillers > 0 ? Math.round((watchedFillers / totalFillers) * 100) : 0;

        const fillerProgressSection = (hasFillerData && watchedFillers > 0) ? `
            <div class="progress-container filler-progress">
                <div class="progress-info">
                    <span class="filler-label">🎭 Filler ${watchedFillers}/${totalFillers}</span>
                    <span>${fillerProgressPercent}%</span>
                </div>
                <div class="progress-bar filler-bar ${sizeClass}">
                    <div class="progress-fill filler-fill" style="width: ${fillerProgressPercent}%"></div>
                </div>
            </div>` : '';

        // Parts section for multi-part anime
        const partsSection = this.createPartsSection(slug, anime.episodes);

        return `
            <div class="anime-card" data-slug="${slug}">
                <div class="anime-card-header">
                    <h3 class="anime-title"><span class="anime-title-text">${UIHelpers.escapeHtml(anime.title)}</span><span class="current-episode-badge">Ep ${episodeCount}</span></h3>
                    <div class="anime-card-actions">
                        <button class="anime-edit-title" data-slug="${slug}" title="Edit title">✏️</button>
                        <button class="anime-delete" data-slug="${slug}" title="Delete">${UIHelpers.createIcon('delete')}</button>
                        <div class="anime-expand-icon">${UIHelpers.createIcon('chevron')}</div>
                    </div>
                </div>
                <div class="anime-card-content">
                    <div class="progress-container">
                        <div class="progress-info">
                            ${progressInfoText}
                            <span>${canonProgressPercent}%</span>
                        </div>
                        <div class="progress-bar ${sizeClass}">
                            <div class="progress-fill" style="width: ${canonProgressWidth}%"></div>
                        </div>
                    </div>
                    ${fillerProgressSection}
                    ${partsSection}
                    ${progressSection}
                    <div class="anime-meta">
                        <span class="anime-last-watched-inline">${UIHelpers.createIcon('calendar')} ${lastWatched}</span>
                        ${skippedFillersIndicator}
                    </div>
                    <div class="anime-episodes collapsible collapsed">
                        <div class="episodes-header">
                            <span class="episodes-title">Episodes ${episodeCount}</span>
                            <svg class="collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6 9 12 15 18 9"/>
                            </svg>
                        </div>
                        <div class="episodes-content">
                            <div class="episode-list">${episodeTags}${moreEpisodes}</div>
                            ${unwatchedFillers.length > 0 ? `<div class="unwatched-fillers-section"><span class="unwatched-fillers-label">Unwatched Fillers <span class="filler-count">${unwatchedFillers.length}</span></span><div class="episode-list">${unwatchedFillerTags}${showMoreFillers}</div></div>` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Create parts section for multi-part anime
     */
    createPartsSection(slug, episodes = []) {
        const { ANIME_PARTS_CONFIG, CONFIG, FillerService, UIHelpers } = window.AnimeTracker;

        const partsConfig = ANIME_PARTS_CONFIG?.[slug];
        if (!partsConfig || partsConfig.length === 0) {
            return '';
        }

        // Get watched episode numbers
        const watchedEpisodes = new Set(episodes.map(ep => ep.number));

        // Build parts HTML
        const partsHTML = partsConfig.map(part => {
            // Count watched episodes in this part
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

            // Build episode tags for this part (show watched episodes, sorted descending)
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

        return `
            <div class="anime-parts collapsible collapsed">
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

    /**
     * Create "in progress only" anime card
     */
    createInProgressOnlyCard(anime) {
        const { UIHelpers } = window.AnimeTracker;
        const { CONFIG } = window.AnimeTracker;

        const activeEpisodes = anime.episodes.filter(ep => ep.percentage < CONFIG.COMPLETED_PERCENTAGE);

        if (activeEpisodes.length === 0) return '';

        const latestEp = activeEpisodes.sort((a, b) => b.number - a.number)[0];
        const minutes = Math.floor(latestEp.currentTime / 60);
        const seconds = Math.floor(latestEp.currentTime % 60);
        const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        const progressTags = activeEpisodes
            .sort((a, b) => b.number - a.number)
            .map(ep => {
                const epMin = Math.floor(ep.currentTime / 60);
                const epSec = Math.floor(ep.currentTime % 60);
                return `<span class="episode-tag in-progress" title="Saved: ${ep.percentage}%">Ep ${ep.number} (${epMin}:${epSec.toString().padStart(2, '0')})</span>`;
            }).join('');

        const latestProgressPreview = `Ep ${latestEp.number} (${timeStr})`;

        return `
            <div class="anime-card in-progress-only" data-slug="${anime.slug}">
                <div class="anime-card-header">
                    <h3 class="anime-title">${UIHelpers.escapeHtml(anime.title)}</h3>
                        <span class="badge badge-watching">Watching</span>
                        <div class="anime-card-actions">
                            <button class="anime-delete" data-slug="${anime.slug}" title="Delete">${UIHelpers.createIcon('delete')}</button>
                            <div class="anime-expand-icon">${UIHelpers.createIcon('chevron')}</div>
                        </div>
                    </div>
                </div>
                <div class="progress-container">
                    <div class="progress-info">
                        <span>Ep ${latestEp.number} at ${timeStr}</span>
                        <span>${latestEp.percentage}%</span>
                    </div>
                    <div class="progress-bar size-small">
                        <div class="progress-fill" style="width: ${latestEp.percentage}%"></div>
                    </div>
                </div>
                <div class="anime-in-progress collapsible collapsed">
                    <div class="in-progress-header">
                        <svg class="in-progress-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        </svg>
                        <span class="in-progress-title">In Progress (${activeEpisodes.length})</span>
                        <span class="in-progress-preview">${latestProgressPreview}</span>
                        <svg class="collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"/>
                        </svg>
                    </div>
                    <div class="in-progress-content">
                        <div class="episode-list">${progressTags}</div>
                    </div>
                </div>
                <div class="anime-last-watched">
                    ${UIHelpers.createIcon('calendar')} ${UIHelpers.formatDate(anime.lastProgress)}
                </div>
            </div>
        `;
    },

    /**
     * Create a season group box containing multiple seasons of the same anime
     */
    createSeasonGroup(baseSlug, seasons, videoProgress = {}) {
        const { UIHelpers, SeasonGrouping, FillerService } = window.AnimeTracker;

        // Get the base title from the first season (usually Season 1)
        const firstSeason = seasons[0];
        const baseTitle = this.extractBaseTitle(firstSeason.anime.title);

        // Calculate total stats across all seasons
        let totalEpisodes = 0;
        let totalWatchTime = 0;
        let latestWatched = null;

        seasons.forEach(({ slug, anime }) => {
            // Don't count movies as episodes
            const seasonLabel = SeasonGrouping.getSeasonLabel(slug, anime.title);
            const isMovie = seasonLabel.includes('(Movie)') || slug.includes('third-stage');

            if (!isMovie) {
                totalEpisodes += anime.episodes?.length || 0;
            }
            totalWatchTime += anime.totalWatchTime || 0;
            if (anime.lastWatched) {
                const date = new Date(anime.lastWatched);
                if (!latestWatched || date > latestWatched) {
                    latestWatched = date;
                }
            }
        });

        // Build season items HTML
        const seasonData = seasons.map(({ slug, anime, seasonNum }, index) => {
            const { CONFIG } = window.AnimeTracker;
            const episodeCount = anime.episodes?.length || 0;

            // For Naruto group with multiple seasons, use index to determine which season
            let seasonLabel;
            if (baseSlug === 'naruto' && seasons.length > 1) {
                // If we have multiple Naruto entries, use index
                if (index === 0) seasonLabel = 'Naruto';
                else if (index === 1) seasonLabel = 'Shippuden';
                else if (index === 2) seasonLabel = 'Boruto';
                else seasonLabel = `Season ${index + 1}`;
            } else {
                // Otherwise use the normal logic
                seasonLabel = SeasonGrouping.getSeasonLabel(slug, anime.title);
            }

            // Check if this is a movie (e.g., Initial D Third Stage)
            const isMovie = seasonLabel.includes('(Movie)') || slug.includes('third-stage');

            let progressData, progressPercent, isComplete, hasProgress, statusClass, statusIcon;
            let episodeBadgeText, progressInfoHTML, episodesHTML;

            if (isMovie) {
                // Handle as movie - show duration instead of episodes
                const watchTime = anime.totalWatchTime || 0;
                const formattedTime = UIHelpers.formatDuration(watchTime);
                const isWatched = episodeCount > 0 || watchTime > 0;

                isComplete = isWatched;
                hasProgress = isWatched;
                statusClass = isComplete ? 'complete' : 'not-started';
                statusIcon = isComplete ? '✓' : '○';

                episodeBadgeText = formattedTime || 'Movie';
                progressInfoHTML = `
                    <div class="progress-info">
                        <span>${isWatched ? '✅ Watched' : '⭕ Not watched'}</span>
                        <span>${formattedTime}</span>
                    </div>
                `;
                episodesHTML = ''; // No episodes list for movies
            } else {
                // Handle as regular season
                progressData = FillerService.calculateProgress(episodeCount, slug, anime);
                progressPercent = Math.round(progressData.progress);

                // Get current episode for this season
                let currentEp = 0;
                if (anime.episodes?.length > 0) {
                    const validNumbers = anime.episodes.map(ep => ep.number).filter(n => !isNaN(n) && n > 0);
                    if (validNumbers.length > 0) {
                        currentEp = Math.max(...validNumbers);
                    }
                }

                isComplete = progressPercent >= 100;

                // For Naruto/Long running: if we reached the last episode, mark as complete even if we skipped fillers
                if (!isComplete && anime.episodes?.length > 0) {
                    const totalEps = FillerService.getTotalEpisodes(slug, episodeCount, anime);
                    if (currentEp >= totalEps && totalEps > 0) {
                        isComplete = true;
                    }
                }

                hasProgress = progressPercent > 0;
                statusClass = isComplete ? 'complete' : (hasProgress ? 'in-progress' : 'not-started');
                statusIcon = isComplete ? '✓' : (hasProgress ? '▶' : '○');

                // Episode badge text
                episodeBadgeText = currentEp > 0 ? `Ep ${currentEp}` : `${episodeCount} eps`;

                // Build episode tags for this season
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

                // Progress bar info
                const totalDisplay = progressData.isGuessed ? `~${progressData.total}` : progressData.total;

                progressInfoHTML = `
                    <div class="progress-info">
                        <span>${episodeCount}/${totalDisplay}</span>
                        <span>${progressPercent}%</span>
                    </div>
                    <div class="progress-bar size-small">
                        <div class="progress-fill" style="width: ${progressData.progress}%"></div>
                    </div>
                `;

                episodesHTML = `
                    <div class="season-episodes">
                        <div class="episode-list">${episodeTags}${moreEpisodes}</div>
                    </div>
                `;
            }

            const html = `
                <div class="season-item ${statusClass}" data-slug="${slug}">
                    <div class="season-item-header">
                        <div class="season-item-left">
                            <span class="season-status-icon">${statusIcon}</span>
                            <span class="season-label">${seasonLabel}</span>
                        </div>
                        <div class="season-item-right">
                            <span class="season-episode-badge">${episodeBadgeText}</span>
                            <div class="season-item-actions">
                                <button class="season-edit-btn" data-slug="${slug}" title="Edit title">✏️</button>
                                <button class="season-delete-btn" data-slug="${slug}" title="Delete">🗑️</button>
                            </div>
                            <div class="season-expand-icon">${UIHelpers.createIcon('chevron')}</div>
                        </div>
                    </div>
                    <div class="season-item-content">
                        <div class="season-progress-container">
                            ${progressInfoHTML}
                        </div>
                        ${episodesHTML}
                    </div>
                </div>
            `;

            return { html, isComplete };
        });

        const seasonItemsHTML = seasonData.map(d => d.html).join('');

        const lastWatchedText = latestWatched ? UIHelpers.formatDate(latestWatched.toISOString()) : 'Never';



        // Check if all seasons are complete using the data object
        const allSeasonsComplete = seasonData.every(d => d.isComplete);
        const badgeClass = allSeasonsComplete ? 'complete' : '';

        return `
            <div class="anime-season-group" data-base-slug="${baseSlug}">
                <div class="season-group-header">
                    <h3 class="season-group-title">
                        <span class="season-group-icon">📺</span>
                        <span class="season-group-name">${UIHelpers.escapeHtml(baseTitle)}</span>
                        <span class="season-count-badge ${badgeClass}">${seasons.length} seasons</span>
                    </h3>
                    <div class="season-group-actions">
                        <div class="season-group-expand-icon">${UIHelpers.createIcon('chevron')}</div>
                    </div>
                </div>
                <div class="season-group-stats">
                    <span class="season-group-stat">📊 ${totalEpisodes} episodes</span>
                    <span class="season-group-stat">⏱️ ${UIHelpers.formatDuration(totalWatchTime)}</span>
                    <span class="season-group-stat">📅 ${lastWatchedText}</span>
                </div>
                <div class="season-group-content">
                    ${seasonItemsHTML}
                </div>
            </div>
        `;
    },

    /**
     * Extract base title by removing season indicators
     */
    extractBaseTitle(title) {
        return title
            // Remove "Season X" patterns
            .replace(/\s*-?\s*Season\s*\d+\s*$/i, '')
            .replace(/\s*-?\s*S\d+\s*$/i, '')
            .replace(/\s*\d+(st|nd|rd|th)\s*Season\s*$/i, '')
            // Remove "Part X" patterns
            .replace(/\s*-?\s*Part\s*\d+\s*$/i, '')
            // Remove trailing dashes or colons
            .replace(/\s*[-:]\s*$/, '')
            .trim();
    },

    /**
     * Extract base title for movies
     */
    extractMovieBaseTitle(title) {
        return title
            // Remove "Movie X" patterns
            .replace(/\s*-?\s*Movie\s*\d+.*$/i, '')
            // Remove "Film: XXX" patterns
            .replace(/\s*-?\s*Film[:\s].*$/i, '')
            // Remove trailing dashes or colons
            .replace(/\s*[-:]\s*$/, '')
            .trim();
    },

    /**
     * Create a movie group box containing multiple movies of the same series
     */
    createMovieGroup(baseSlug, movies, videoProgress = {}) {
        const { UIHelpers, SeasonGrouping } = window.AnimeTracker;

        // Get the base title from the first movie
        const firstMovie = movies[0];
        const baseTitle = this.extractMovieBaseTitle(firstMovie.anime.title);

        // Calculate total stats across all movies
        let totalWatchTime = 0;
        let latestWatched = null;

        movies.forEach(({ anime }) => {
            totalWatchTime += anime.totalWatchTime || 0;
            if (anime.lastWatched) {
                const date = new Date(anime.lastWatched);
                if (!latestWatched || date > latestWatched) {
                    latestWatched = date;
                }
            }
        });

        // Build movie items HTML
        const movieItemsHTML = movies.map(({ slug, anime, movieNum }) => {
            const movieLabel = SeasonGrouping.getMovieLabel(slug, anime.title);
            const watchTime = anime.totalWatchTime || 0;
            const formattedTime = UIHelpers.formatDuration(watchTime);

            // Check if movie is watched (has episodes/watched state)
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
                                <button class="movie-edit-btn" data-slug="${slug}" title="Edit title">✏️</button>
                                <button class="movie-delete-btn" data-slug="${slug}" title="Delete">🗑️</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const lastWatchedText = latestWatched ? UIHelpers.formatDate(latestWatched.toISOString()) : 'Never';
        const watchedCount = movies.filter(m => m.anime.episodes?.length > 0 || (m.anime.totalWatchTime || 0) > 0).length;

        return `
            <div class="anime-movie-group" data-base-slug="${baseSlug}">
                <div class="movie-group-header">
                    <h3 class="movie-group-title">
                        <span class="movie-group-icon">🎬</span>
                        <span class="movie-group-name">${UIHelpers.escapeHtml(baseTitle)} Movies</span>
                        <span class="movie-count-badge">${movies.length} movies</span>
                    </h3>
                    <div class="movie-group-actions">
                        <div class="movie-group-expand-icon">${UIHelpers.createIcon('chevron')}</div>
                    </div>
                </div>
                <div class="movie-group-stats">
                    <span class="movie-group-stat">✅ ${watchedCount}/${movies.length} watched</span>
                    <span class="movie-group-stat">⏱️ ${UIHelpers.formatDuration(totalWatchTime)}</span>
                    <span class="movie-group-stat">📅 ${lastWatchedText}</span>
                </div>
                <div class="movie-group-content">
                    ${movieItemsHTML}
                </div>
            </div>
        `;
    },

    /**
     * Create "in progress only" anime card
     */
    createInProgressOnlyCard(anime) {
        const { UIHelpers } = window.AnimeTracker;
        const { CONFIG } = window.AnimeTracker;

        const activeEpisodes = anime.episodes.filter(ep => ep.percentage < CONFIG.COMPLETED_PERCENTAGE);

        if (activeEpisodes.length === 0) return '';

        const latestEp = activeEpisodes.sort((a, b) => b.number - a.number)[0];
        const minutes = Math.floor(latestEp.currentTime / 60);
        const seconds = Math.floor(latestEp.currentTime % 60);
        const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        const progressTags = activeEpisodes
            .sort((a, b) => b.number - a.number)
            .map(ep => {
                const epMin = Math.floor(ep.currentTime / 60);
                const epSec = Math.floor(ep.currentTime % 60);
                return `<span class="episode-tag in-progress" title="Saved: ${ep.percentage}%">
                    Ep ${ep.number} (${epMin}:${epSec.toString().padStart(2, '0')})
                    <button class="progress-delete-btn" data-slug="${anime.slug}" data-episode="${ep.number}" title="Delete progress">×</button>
                </span>`;
            }).join('');

        const latestProgressPreview = `Ep ${latestEp.number} (${timeStr})`;

        return `
            <div class="anime-card in-progress-only" data-slug="${anime.slug}">
                <div class="anime-card-header">
                    <h3 class="anime-title">
                        <span class="anime-title-text">${UIHelpers.escapeHtml(anime.title)}</span>
                        <span class="badge badge-watching">Watching</span>
                    </h3>
                    <div class="anime-card-actions">
                        <button class="anime-delete" data-slug="${anime.slug}" title="Delete">${UIHelpers.createIcon('delete')}</button>
                        <div class="anime-expand-icon">${UIHelpers.createIcon('chevron')}</div>
                    </div>
                </div>
                <div class="anime-card-content">
                    <div class="progress-container">
                        <div class="progress-info">
                            <span>Ep ${latestEp.number} at ${timeStr}</span>
                            <span>${latestEp.percentage}%</span>
                        </div>
                        <div class="progress-bar size-small">
                            <div class="progress-fill" style="width: ${latestEp.percentage}%"></div>
                        </div>
                    </div>
                    <div class="anime-in-progress collapsible collapsed">
                        <div class="in-progress-header">
                            <span class="in-progress-title">In Progress (${activeEpisodes.length})</span>
                            <svg class="collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6 9 12 15 18 9"/>
                            </svg>
                        </div>
                        <div class="in-progress-content">
                            <div class="episode-list">${progressTags}</div>
                        </div>
                    </div>
                    <div class="anime-meta">
                        <span class="anime-last-watched-inline">${UIHelpers.createIcon('calendar')} ${UIHelpers.formatDate(anime.lastProgress)}</span>
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Create a single movie card (collapsible like movie groups)
     */
    createSingleMovieCard(slug, anime, videoProgress = {}) {
        const { UIHelpers } = window.AnimeTracker;

        const title = anime.title || slug;
        const watchTime = anime.totalWatchTime || 0;
        const formattedTime = UIHelpers.formatDuration(watchTime);
        const lastWatched = anime.lastWatched ? UIHelpers.formatDate(anime.lastWatched) : 'Never';
        const isWatched = anime.episodes?.length > 0 || watchTime > 0;

        return `
            <div class="anime-movie-group single-movie" data-base-slug="${slug}">
                <div class="movie-group-header">
                    <h3 class="movie-group-title">
                        <span class="movie-group-icon">🎬</span>
                        <span class="movie-group-name">${UIHelpers.escapeHtml(title)}</span>
                        <span class="movie-count-badge single">Movie</span>
                    </h3>
                    <div class="movie-group-actions">
                        <div class="movie-group-expand-icon">${UIHelpers.createIcon('chevron')}</div>
                    </div>
                </div>
                <div class="movie-group-stats">
                    <span class="movie-group-stat">${isWatched ? '✅ Watched' : '⭕ Not watched'}</span>
                    <span class="movie-group-stat">⏱️ ${formattedTime}</span>
                    <span class="movie-group-stat">📅 ${lastWatched}</span>
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
                                    <button class="movie-edit-btn" data-slug="${slug}" title="Edit title">✏️</button>
                                    <button class="movie-delete-btn" data-slug="${slug}" title="Delete">🗑️</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
};

// Export
window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.AnimeCardRenderer = AnimeCardRenderer;
