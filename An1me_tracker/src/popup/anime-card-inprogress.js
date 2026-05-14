/**
 * Anime Tracker — In-Progress card renderer
 *
 * Augments `window.AnimeTracker.AnimeCardRenderer` with the "Continue
 * watching" group + its row template. Lives in its own file so the much
 * larger card / season / movie renderers stay focused.
 *
 * Loaded AFTER anime-card.js so the namespace exists; the loader in
 * popup.html enforces that order.
 */
(function () {
    'use strict';

    const AT = (window.AnimeTracker = window.AnimeTracker || {});
    const AnimeCardRenderer = (AT.AnimeCardRenderer = AT.AnimeCardRenderer || {});

    Object.assign(AnimeCardRenderer, {
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
                : `<div class="ip-cover-placeholder">&#9654;</div>`;

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
        }
    });
})();
