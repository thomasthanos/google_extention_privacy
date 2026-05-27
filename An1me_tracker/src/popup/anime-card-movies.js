


(function () {
    'use strict';

    const AT = (window.AnimeTracker = window.AnimeTracker || {});
    const AnimeCardRenderer = (AT.AnimeCardRenderer = AT.AnimeCardRenderer || {});

    Object.assign(AnimeCardRenderer, {
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
                    <div class="movie-item ${statusClass}" data-slug="${UIHelpers.escapeHtml(slug)}">
                        <div class="movie-item-header">
                            <div class="movie-item-left">
                                <span class="movie-status-icon">${statusIcon}</span>
                                <span class="movie-label">${UIHelpers.escapeHtml(movieLabel)}</span>
                            </div>
                            <div class="movie-item-right">
                                <span class="movie-duration">${formattedTime}</span>
                                <div class="movie-item-actions">
                                    <button class="movie-edit-btn" data-slug="${UIHelpers.escapeHtml(slug)}" title="Edit title">${UIHelpers.createIcon('edit')}</button>
                                    <button class="movie-delete-btn" data-slug="${UIHelpers.escapeHtml(slug)}" title="Delete">${UIHelpers.createIcon('delete')}</button>
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
            const coverHtmlGroup = UIHelpers.renderCoverFigure(baseTitle, coverImageGroup);

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

            const coverHtml = UIHelpers.renderCoverFigure(title, anime.coverImage || null);

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
                        <div class="movie-item ${isWatched ? 'complete' : 'not-started'}" data-slug="${UIHelpers.escapeHtml(slug)}">
                            <div class="movie-item-header">
                                <div class="movie-item-left">
                                    <span class="movie-status-icon">${isWatched ? '✓' : '○'}</span>
                                    <span class="movie-label">${UIHelpers.escapeHtml(title)}</span>
                                </div>
                                <div class="movie-item-right">
                                    <span class="movie-duration">${formattedTime}</span>
                                    <div class="movie-item-actions">
                                        <button class="movie-edit-btn" data-slug="${UIHelpers.escapeHtml(slug)}" title="Edit title">${UIHelpers.createIcon('edit')}</button>
                                        <button class="movie-delete-btn" data-slug="${UIHelpers.escapeHtml(slug)}" title="Delete">${UIHelpers.createIcon('delete')}</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
    });
})();
