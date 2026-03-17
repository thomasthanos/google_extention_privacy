(function () {
    'use strict';

    const AT = window.AnimeTracker;

    let animeData = {};
    let videoProgress = {};
    let currentSort = 'date';
    let currentCategory = 'all';

    const elements = {
        authSection: document.getElementById('authSection'),
        mainApp: document.getElementById('mainApp'),
        googleSignIn: document.getElementById('googleSignIn'),
        settingsBtn: document.getElementById('settingsBtn'),
        settingsDropdown: document.getElementById('settingsDropdown'),
        settingsAvatar: document.getElementById('settingsAvatar'),
        settingsUserName: document.getElementById('settingsUserName'),
        settingsUserEmail: document.getElementById('settingsUserEmail'),
        settingsDonate: document.getElementById('settingsDonate'),
        settingsRefresh: document.getElementById('settingsRefresh'),
        settingsRefreshInfo: document.getElementById('settingsRefreshInfo'),
        settingsClear: document.getElementById('settingsClear'),
        settingsSignOut: document.getElementById('settingsSignOut'),
        animeList: document.getElementById('animeList'),
        emptyState: document.getElementById('emptyState'),
        searchInput: document.getElementById('searchInput'),
        totalAnime: document.getElementById('totalAnime'),
        totalMovies: document.getElementById('totalMovies'),
        totalEpisodes: document.getElementById('totalEpisodes'),
        totalTime: document.getElementById('totalTime'),
        confirmDialog: document.getElementById('confirmDialog'),
        confirmClear: document.getElementById('confirmClear'),
        cancelClear: document.getElementById('cancelClear'),
        syncStatus: document.getElementById('syncStatus'),
        syncText: document.getElementById('syncText'),
        versionText: document.getElementById('versionText'),
        donateDropdown: document.getElementById('donateDropdown'),
        donatePaypal: document.getElementById('donatePaypal'),
        donateRevolut: document.getElementById('donateRevolut'),
        sortBtn: document.getElementById('sortBtn'),
        sortDropdown: document.getElementById('sortDropdown'),
        settingsFetchFillers: document.getElementById('settingsFetchFillers'),
        addAnimeBtn: document.getElementById('addAnimeBtn'),
        addAnimeDialog: document.getElementById('addAnimeDialog'),
        closeAddAnime: document.getElementById('closeAddAnime'),
        cancelAddAnime: document.getElementById('cancelAddAnime'),
        confirmAddAnime: document.getElementById('confirmAddAnime'),
        animeSlugInput: document.getElementById('animeSlug'),
        animeTitleInput: document.getElementById('animeTitle'),
        episodesWatchedInput: document.getElementById('episodesWatched'),
        editTitleDialog: document.getElementById('editTitleDialog'),
        editTitleInput: document.getElementById('editTitleInput'),
        closeEditTitle: document.getElementById('closeEditTitle'),
        cancelEditTitle: document.getElementById('cancelEditTitle'),
        confirmEditTitle: document.getElementById('confirmEditTitle'),
        categoryTabs: document.getElementById('categoryTabs')
    };

    let editingSlug = null;
    let loadAndSyncInProgress = false;

    const OWN_WRITE_TTL_MS = 15000;
    const ownWriteTokens = new Set();

    function generateWriteToken() {
        try {
            return crypto.randomUUID();
        } catch {
            return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        }
    }

    function markInternalSave(data = null) {
        if (!data || typeof data !== 'object') return;
        const token = generateWriteToken();
        data.__writeToken = token;
        ownWriteTokens.add(token);
        setTimeout(() => ownWriteTokens.delete(token), OWN_WRITE_TTL_MS);
    }

    function isOwnStorageChange(changes) {
        const tokenChange = changes.__writeToken;
        if (!tokenChange) return false;
        const token = tokenChange.newValue;
        if (!token || !ownWriteTokens.has(token)) return false;
        ownWriteTokens.delete(token);
        return true;
    }

    function normalizeCategory(value) {
        const allowed = new Set(['all', 'series', 'movies']);
        return allowed.has(value) ? value : 'all';
    }

    function getCalendarDayDiff(isoString) {
        if (!isoString) return 0;
        const target = new Date(isoString);
        if (isNaN(target.getTime())) return 0;
        const now = new Date();
        const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate());
        return Math.round((nowMidnight - targetMidnight) / (1000 * 60 * 60 * 24));
    }

    function isAnimeCompleted(slug, anime) {
        const { FillerService, SeasonGrouping, AnilistService } = AT;
        if (!anime) return false;
        const watchedCount = anime.episodes?.length || 0;
        if (watchedCount === 0) return false;
        if (anime.completedAt) return true;
        if (SeasonGrouping.isMovie(slug, anime)) return true;
        const progressData = FillerService.calculateProgress(watchedCount, slug, anime);
        if (progressData.progress >= 100) return true;
        // AniList says FINISHED and total is unknown → user has watched all available episodes
        const anilistStatus = AnilistService?.getStatus(slug.toLowerCase());
        if (anilistStatus === 'FINISHED' && progressData.total == null) return true;
        // AniList says FINISHED and user has tracked the final episode (handles gaps in the middle)
        if (anilistStatus === 'FINISHED' && progressData.total != null) {
            const highestEp = Math.max(0, ...(anime.episodes || []).map(ep => Number(ep.number) || 0));
            if (highestEp >= progressData.total) return true;
        }
        return false;
    }

    function isAgedCompleted(slug, anime) {
        const { CONFIG, AnilistService } = AT;
        if (!isAnimeCompleted(slug, anime)) return false;
        if (anime.completedAt) return true;
        // For definitively finished series, move to completed section immediately
        const anilistStatus = AnilistService?.getStatus(slug.toLowerCase());
        if (anilistStatus === 'FINISHED') return true;
        // For airing/unknown series, wait a few days to avoid false moves
        const daysSinceLastWatch = getCalendarDayDiff(anime?.lastWatched);
        return daysSinceLastWatch >= CONFIG.COMPLETED_LIST_MIN_DAYS;
    }

    function normalizeMovieDurations(data, progress = {}) {
        const { SeasonGrouping } = AT;
        const MIN_RELIABLE_DURATION_SECONDS = 30 * 60;
        const MAX_RELIABLE_DURATION_SECONDS = 4 * 60 * 60;
        const LEGACY_DEFAULT_MOVIE_DURATION_SECONDS = 100 * 60;
        let changed = false;
        let updatedEntries = 0;

        for (const [slug, anime] of Object.entries(data || {})) {
            if (!anime || !SeasonGrouping.isMovie(slug, anime)) continue;
            if (!Array.isArray(anime.episodes) || anime.episodes.length === 0) continue;

            const slugProgressDurations = Object.entries(progress || {})
                .filter(([key, entry]) => key.startsWith(`${slug}__episode-`) && !entry?.deleted)
                .map(([, entry]) => Number(entry?.duration) || 0)
                .filter((d) => d >= MIN_RELIABLE_DURATION_SECONDS && d <= MAX_RELIABLE_DURATION_SECONDS);
            const fallbackSlugDuration = slugProgressDurations.length > 0
                ? Math.min(Math.max(...slugProgressDurations), MAX_RELIABLE_DURATION_SECONDS)
                : 0;

            let entryChanged = false;
            anime.episodes = anime.episodes.map((ep) => {
                const episodeNum = Number(ep?.number) || 0;
                const currentDuration = Number(ep?.duration) || 0;
                const progressKey = `${slug}__episode-${episodeNum}`;
                const progressEntry = progress?.[progressKey];
                const exactProgressDuration = progressEntry?.deleted ? 0 : (Number(progressEntry?.duration) || 0);
                const progressDuration = exactProgressDuration || fallbackSlugDuration;
                const hasBetterProgressDuration =
                    progressDuration >= MIN_RELIABLE_DURATION_SECONDS &&
                    progressDuration <= MAX_RELIABLE_DURATION_SECONDS;
                const isLegacyDuration = currentDuration === 1440 || currentDuration === 6000 || currentDuration === 7200;
                const isUnknownDuration = currentDuration <= 0;
                const isVideoMeasured = ep?.durationSource === 'video';

                let nextDuration = currentDuration;
                if (hasBetterProgressDuration && (isLegacyDuration || currentDuration < MIN_RELIABLE_DURATION_SECONDS)) {
                    nextDuration = progressDuration;
                } else if (isUnknownDuration && !isVideoMeasured) {
                    const fallbackFromTotal =
                        anime.episodes?.length > 0
                            ? Math.round((Number(anime.totalWatchTime) || 0) / anime.episodes.length)
                            : 0;
                    const hasValidFallbackFromTotal =
                        fallbackFromTotal >= MIN_RELIABLE_DURATION_SECONDS &&
                        fallbackFromTotal <= MAX_RELIABLE_DURATION_SECONDS;
                    nextDuration = hasValidFallbackFromTotal ? fallbackFromTotal : LEGACY_DEFAULT_MOVIE_DURATION_SECONDS;
                }

                if (nextDuration !== currentDuration) {
                    entryChanged = true;
                    return {
                        ...ep,
                        duration: nextDuration,
                        durationSource: hasBetterProgressDuration ? 'video' : (ep?.durationSource || 'legacy-estimate')
                    };
                }
                return ep;
            });

            if (!entryChanged) continue;
            anime.totalWatchTime = anime.episodes.reduce((sum, ep) => sum + (Number(ep?.duration) || 0), 0);
            changed = true;
            updatedEntries += 1;
        }

        return { changed, updatedEntries };
    }

    // Remove phantom movies: movies tracked but watched for ≤5 min and older than 1 day.
    function cleanupPhantomMovies(data, existingDeletedAnime = {}) {
        const { SeasonGrouping } = AT;
        const MAX_PHANTOM_WATCH_SECONDS = 5 * 60;
        const MIN_AGE_MS = 24 * 60 * 60 * 1000;
        const now = Date.now();
        const updatedDeletedAnime = { ...existingDeletedAnime };
        let changed = false;

        for (const [slug, anime] of Object.entries(data)) {
            if (!anime || !SeasonGrouping.isMovie(slug, anime)) continue;
            if ((Number(anime.totalWatchTime) || 0) > MAX_PHANTOM_WATCH_SECONDS) continue;
            const lastTouched = anime.lastWatched ? new Date(anime.lastWatched).getTime() : 0;
            if (!lastTouched || (now - lastTouched) < MIN_AGE_MS) continue;

            delete data[slug];
            updatedDeletedAnime[slug] = { deletedAt: new Date().toISOString() };
            changed = true;
        }

        return { changed, deletedAnime: updatedDeletedAnime };
    }

    function showAuthScreen() {
        elements.authSection.style.display = 'flex';
        elements.mainApp.style.display = 'none';
    }

    function showMainApp(user) {
        elements.authSection.style.display = 'none';
        elements.mainApp.style.display = 'flex';

        if (user) {
            if (user.photoURL) {
                elements.settingsAvatar.src = user.photoURL;
                elements.settingsAvatar.onerror = () => { elements.settingsAvatar.src = 'src/icons/icon48.png'; };
            } else {
                elements.settingsAvatar.src = 'src/icons/icon48.png';
            }
            elements.settingsUserName.textContent = user.displayName || user.email?.split('@')[0] || 'User';
            elements.settingsUserEmail.textContent = user.email || '';
            elements.syncStatus.classList.add('synced');
            elements.syncText.textContent = 'Cloud Synced';
        } else {
            elements.settingsAvatar.src = 'src/icons/icon48.png';
            elements.settingsUserName.textContent = 'User';
            elements.settingsUserEmail.textContent = '';
            elements.syncStatus.classList.remove('synced');
            elements.syncText.textContent = 'Local Only';
        }
    }

    function renderAnimeList(filter = '') {
        const { AnimeCardRenderer, ProgressManager, SeasonGrouping } = AT;

        const expandedCards = new Set();
        elements.animeList.querySelectorAll('.anime-card.expanded').forEach(card => {
            const slug = card.querySelector('.anime-delete')?.dataset?.slug;
            if (slug) expandedCards.add(slug);
        });
        const expandedSeasonGroups = new Set();
        elements.animeList.querySelectorAll('.anime-season-group.expanded').forEach(g => {
            if (g.dataset.baseSlug) expandedSeasonGroups.add(g.dataset.baseSlug);
        });
        const expandedSeasonItems = new Set();
        elements.animeList.querySelectorAll('.season-item.expanded').forEach(item => {
            if (item.dataset.slug) expandedSeasonItems.add(item.dataset.slug);
        });
        const expandedMovieGroups = new Set();
        elements.animeList.querySelectorAll('.anime-movie-group.expanded').forEach(g => {
            if (g.dataset.baseSlug) expandedMovieGroups.add(g.dataset.baseSlug);
        });
        const completedSection = elements.animeList.querySelector('.completed-list-section');
        const completedWasOpen = completedSection
            ? (completedSection.querySelector('.completed-list-cards')?.style.display !== 'none')
            : false;
        const ipGroupContent = elements.animeList.querySelector('.ip-group-content');
        const ipGroupWasOpen = ipGroupContent ? ipGroupContent.classList.contains('open') : false;

        const categoryFilter = (slug, anime) => {
            if (currentCategory === 'all') return true;
            const isMovie = SeasonGrouping.isMovie(slug, anime);
            if (currentCategory === 'movies') return isMovie;
            if (currentCategory === 'series') return !isMovie;
            return true;
        };

        const entries = Object.entries(animeData)
            .filter(([slug, anime]) => {
                const matchesSearch = !filter || anime.title.toLowerCase().includes(filter.toLowerCase());
                const matchesCategory = categoryFilter(slug, anime);
                return matchesSearch && matchesCategory;
            });

        const visibleProgress = Object.fromEntries(
            Object.entries(videoProgress).filter(([, p]) => !p.deleted)
        );

        const inProgressOnly = ProgressManager.getInProgressOnlyAnime(animeData, visibleProgress)
            .filter(anime => {
                const matchesSearch = !filter || anime.title.toLowerCase().includes(filter.toLowerCase());
                const trackedAnime = animeData[anime.slug] || anime;
                const matchesCategory = categoryFilter(anime.slug || '', trackedAnime);
                return matchesSearch && matchesCategory;
            })
            .sort((a, b) => new Date(b.lastProgress || 0) - new Date(a.lastProgress || 0));

        if (entries.length === 0 && inProgressOnly.length === 0) {
            elements.animeList.innerHTML = '';
            elements.emptyState.classList.add('visible');
            return;
        }

        elements.emptyState.classList.remove('visible');

        const sortedEntries = entries.sort((a, b) => {
            const [slugA, animeA] = a;
            const [slugB, animeB] = b;

            const getLatest = (slug, anime) => {
                let latest = new Date(anime.lastWatched || 0).getTime();
                Object.entries(videoProgress).forEach(([id, progress]) => {
                    if (id.startsWith(slug + '__') && !progress.deleted) {
                        const progressTime = progress.savedAt ? new Date(progress.savedAt).getTime() : 0;
                        if (progressTime > latest) latest = progressTime;
                    }
                });
                return latest;
            };

            switch (currentSort) {
                case 'date':     return getLatest(slugB, animeB) - getLatest(slugA, animeA);
                case 'name':     return animeA.title.localeCompare(animeB.title, 'en');
                case 'episodes': return (animeB.episodes?.length || 0) - (animeA.episodes?.length || 0);
                default:         return 0;
            }
        });

        const orderMap = new Map(sortedEntries.map(([slug], index) => [slug, index]));

        const renderGroupedEntries = (entriesToRender) => {
            if (!entriesToRender.length) return '';

            const groups = SeasonGrouping.groupByBase(entriesToRender);
            const groupsArray = Array.from(groups.entries());
            let html = '';

            groupsArray.sort((a, b) => {
                const aIndex = Math.min(...a[1].map(e => orderMap.get(e.slug) ?? Number.MAX_SAFE_INTEGER));
                const bIndex = Math.min(...b[1].map(e => orderMap.get(e.slug) ?? Number.MAX_SAFE_INTEGER));
                return aIndex - bIndex;
            });

            for (const [baseSlug, groupedEntries] of groupsArray) {
                if (SeasonGrouping.isMovieGroup(groupedEntries)) {
                    if (groupedEntries.length > 1) {
                        html += AnimeCardRenderer.createMovieGroup(baseSlug, groupedEntries, visibleProgress);
                    } else {
                        const { slug, anime } = groupedEntries[0];
                        html += AnimeCardRenderer.createSingleMovieCard(slug, anime, visibleProgress);
                    }
                } else if (SeasonGrouping.hasMultipleSeasons(groupedEntries)) {
                    html += AnimeCardRenderer.createSeasonGroup(baseSlug, groupedEntries, visibleProgress);
                } else {
                    const { slug, anime } = groupedEntries[0];
                    html += AnimeCardRenderer.createAnimeCard(slug, anime, visibleProgress);
                }
            }

            return html;
        };

        const normalEntries = sortedEntries.filter(([slug, anime]) => !isAgedCompleted(slug, anime));
        const completedEntries = sortedEntries
            .filter(([slug, anime]) => isAgedCompleted(slug, anime))
            .sort(([, a], [, b]) =>
                new Date(b.lastWatched || 0).getTime() - new Date(a.lastWatched || 0).getTime()
            );

        const completedOrderMap = new Map(completedEntries.map(([slug], index) => [slug, index]));
        const renderCompletedGroupedEntries = (entriesToRender) => {
            if (!entriesToRender.length) return '';
            const groups = SeasonGrouping.groupByBase(entriesToRender);
            const groupsArray = Array.from(groups.entries());
            groupsArray.sort((a, b) => {
                const aIndex = Math.min(...a[1].map(e => completedOrderMap.get(e.slug) ?? Number.MAX_SAFE_INTEGER));
                const bIndex = Math.min(...b[1].map(e => completedOrderMap.get(e.slug) ?? Number.MAX_SAFE_INTEGER));
                return aIndex - bIndex;
            });
            let html = '';
            for (const [baseSlug, groupedEntries] of groupsArray) {
                if (SeasonGrouping.isMovieGroup(groupedEntries)) {
                    if (groupedEntries.length > 1) {
                        html += AnimeCardRenderer.createMovieGroup(baseSlug, groupedEntries, visibleProgress);
                    } else {
                        const { slug, anime } = groupedEntries[0];
                        html += AnimeCardRenderer.createSingleMovieCard(slug, anime, visibleProgress);
                    }
                } else if (SeasonGrouping.hasMultipleSeasons(groupedEntries)) {
                    html += AnimeCardRenderer.createSeasonGroup(baseSlug, groupedEntries, visibleProgress);
                } else {
                    const { slug, anime } = groupedEntries[0];
                    html += AnimeCardRenderer.createAnimeCard(slug, anime, visibleProgress);
                }
            }
            return html;
        };

        const trackedHtml        = renderGroupedEntries(normalEntries);
        const completedCardsHtml = renderCompletedGroupedEntries(completedEntries);
        const ipCards            = inProgressOnly.map(anime => AnimeCardRenderer.createInProgressOnlyCard(anime)).join('');
        const inProgressHtml     = inProgressOnly.length > 0 ? `
            <div class="ip-group">
                <div class="ip-group-header" id="ipGroupToggle">
                    <span class="ip-group-play">▶</span>
                    <span class="ip-group-label">In Progress</span>
                    <span class="ip-group-count">${inProgressOnly.length}</span>
                    <svg class="ip-group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
                <div class="ip-group-content">${ipCards}</div>
            </div>` : '';

        const completedGroupHtml = completedEntries.length > 0
            ? `
                <div class="completed-list-section">
                    <div class="completed-list-label" id="completedListToggle">
                        <div class="completed-list-label-left">
                            <span class="completed-list-label-title">COMPLETED LIST</span>
                            <span class="completed-list-label-sub">${AT.CONFIG.COMPLETED_LIST_MIN_DAYS}+ days since last watch</span>
                        </div>
                        <svg class="completed-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </div>
                    <div class="completed-list-cards" style="display:none;">
                        ${completedCardsHtml}
                    </div>
                </div>
            `
            : '';

        elements.animeList.innerHTML = inProgressHtml + trackedHtml + completedGroupHtml;

        elements.animeList.querySelectorAll('.anime-card').forEach(card => {
            const slug = card.querySelector('.anime-delete')?.dataset?.slug;
            if (slug && expandedCards.has(slug)) card.classList.add('expanded');
        });
        elements.animeList.querySelectorAll('.anime-season-group').forEach(g => {
            if (g.dataset.baseSlug && expandedSeasonGroups.has(g.dataset.baseSlug))
                g.classList.add('expanded');
        });
        elements.animeList.querySelectorAll('.season-item').forEach(item => {
            if (item.dataset.slug && expandedSeasonItems.has(item.dataset.slug))
                item.classList.add('expanded');
        });
        elements.animeList.querySelectorAll('.anime-movie-group').forEach(g => {
            if (g.dataset.baseSlug && expandedMovieGroups.has(g.dataset.baseSlug))
                g.classList.add('expanded');
        });
        const newCompletedToggle = elements.animeList.querySelector('#completedListToggle');
        if (newCompletedToggle && completedWasOpen) {
            const cards = newCompletedToggle.nextElementSibling;
            const chevron = newCompletedToggle.querySelector('.completed-chevron');
            if (cards) cards.style.display = 'flex';
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        }
        const newIpGroupContent = elements.animeList.querySelector('.ip-group-content');
        if (newIpGroupContent && ipGroupWasOpen) newIpGroupContent.classList.add('open');

        setupCardEventListeners();
    }

    function setupCardEventListeners() {
        elements.animeList.querySelectorAll('.in-progress-header').forEach(header => {
            const toggleCollapse = (e) => {
                e.stopPropagation();
                const card = header.closest('.anime-card');
                if (card && !card.classList.contains('expanded')) card.classList.add('expanded');
                header.parentElement.classList.toggle('collapsed');
            };
            header.addEventListener('click', toggleCollapse);
            const title = header.querySelector('.in-progress-title');
            if (title) title.addEventListener('click', toggleCollapse);
        });

        elements.animeList.querySelectorAll('.episodes-header').forEach(header => {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                const card = header.closest('.anime-card');
                if (card && !card.classList.contains('expanded')) card.classList.add('expanded');
                header.parentElement.classList.toggle('collapsed');
            });
        });

        elements.animeList.querySelectorAll('.parts-header').forEach(header => {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                const card = header.closest('.anime-card');
                if (card && !card.classList.contains('expanded')) card.classList.add('expanded');
                header.parentElement.classList.toggle('collapsed');
            });
        });

        elements.animeList.querySelectorAll('.part-item-header').forEach(header => {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                const partItem = header.closest('.part-item');
                if (partItem) partItem.classList.toggle('expanded');
            });
        });

        elements.animeList.querySelectorAll('.anime-card').forEach(card => {
            const header = card.querySelector('.anime-card-header');
            if (header) {
                const toggleCard = (e) => {
                    if (e.target.closest('.anime-delete') || e.target.closest('.anime-edit-title') || e.target.closest('.anime-fetch-filler') || e.target.closest('.anime-complete-toggle')) return;
                    e.stopPropagation();
                    card.classList.toggle('expanded');
                };
                header.addEventListener('click', toggleCard);
            }
        });

        elements.animeList.querySelectorAll('.anime-season-group').forEach(group => {
            const header = group.querySelector('.season-group-header');
            if (header) {
                const toggleGroup = () => group.classList.toggle('expanded');
                header.addEventListener('click', toggleGroup);
                const title = header.querySelector('.season-group-name');
                if (title) title.addEventListener('click', (e) => { e.stopPropagation(); toggleGroup(); });
            }
        });

        elements.animeList.querySelectorAll('.show-more-fillers').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const hiddenFillers = btn.previousElementSibling;
                if (hiddenFillers && hiddenFillers.classList.contains('hidden-fillers')) {
                    const isExpanded = hiddenFillers.classList.toggle('expanded');
                    btn.textContent = isExpanded ? btn.dataset.lessText : btn.dataset.moreText;
                }
            });
        });

        elements.animeList.querySelectorAll('.show-more-episodes').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const hiddenEpisodes = btn.previousElementSibling;
                if (hiddenEpisodes && hiddenEpisodes.classList.contains('hidden-episodes')) {
                    const isExpanded = hiddenEpisodes.classList.toggle('expanded');
                    btn.textContent = isExpanded ? btn.dataset.lessText : btn.dataset.moreText;
                }
            });
        });

        elements.animeList.querySelectorAll('.season-item-header').forEach(header => {
            const toggleSeason = (e) => {
                if (e.target.closest('.season-edit-btn') || e.target.closest('.season-delete-btn')) return;
                e.stopPropagation();
                const seasonItem = header.closest('.season-item');
                if (seasonItem) seasonItem.classList.toggle('expanded');
            };
            header.addEventListener('click', toggleSeason);
            const label = header.querySelector('.season-label');
            if (label) label.addEventListener('click', toggleSeason);
        });

        elements.animeList.querySelectorAll('.anime-movie-group').forEach(group => {
            const header = group.querySelector('.movie-group-header');
            if (header) header.addEventListener('click', () => group.classList.toggle('expanded'));
        });

        const ipGroupToggle = elements.animeList.querySelector('#ipGroupToggle');
        if (ipGroupToggle) {
            ipGroupToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const content = ipGroupToggle.nextElementSibling;
                const chevron = ipGroupToggle.querySelector('.ip-group-chevron');
                const isOpen = content.classList.toggle('open');
                if (chevron) chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
            });
            const chevron = ipGroupToggle.querySelector('.ip-group-chevron');
            const content = ipGroupToggle.nextElementSibling;
            if (chevron) chevron.style.transform = content?.classList.contains('open') ? 'rotate(0deg)' : 'rotate(-90deg)';
        }

        const completedToggle = elements.animeList.querySelector('#completedListToggle');
        if (completedToggle) {
            completedToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const cards = completedToggle.nextElementSibling;
                const chevron = completedToggle.querySelector('.completed-chevron');
                const isHidden = cards.style.display === 'none';
                cards.style.display = isHidden ? 'flex' : 'none';
                chevron.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
            });
            const chevron = completedToggle.querySelector('.completed-chevron');
            chevron.style.transform = 'rotate(-90deg)';
        }

        elements.animeList.querySelectorAll('.movie-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); editAnimeTitle(btn.dataset.slug); });
        });

        elements.animeList.querySelectorAll('.movie-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); deleteAnime(btn.dataset.slug); });
        });
    }

    async function updateStats() {
        const { UIHelpers, SeasonGrouping, Storage } = AT;
        const animeEntries = Object.entries(animeData);
        const groups = SeasonGrouping.groupByBase(animeEntries);
        const totalAnimeCount = groups.size;
        elements.totalAnime.textContent = totalAnimeCount;
        const totalMoviesCount = animeEntries.filter(([slug, anime]) => SeasonGrouping.isMovie(slug, anime)).length;
        if (elements.totalMovies) elements.totalMovies.textContent = totalMoviesCount;

        let totalWatchedEpisodes = 0;
        let totalWatchTime = 0;
        for (const [, anime] of animeEntries) {
            const uniqueEpisodeNumbers = new Set(
                (anime.episodes || []).map(ep => Number(ep?.number)).filter(n => Number.isFinite(n) && n > 0)
            );
            totalWatchedEpisodes += uniqueEpisodeNumbers.size;
            totalWatchTime += anime.totalWatchTime || 0;
        }

        const totalTimeStr = UIHelpers.formatDurationShort(totalWatchTime);
        elements.totalEpisodes.textContent = totalWatchedEpisodes;
        elements.totalTime.textContent = totalTimeStr;

        try {
            const manifest = chrome.runtime.getManifest();
            await Storage.set({
                cachedStats: {
                    totalAnime:    totalAnimeCount,
                    totalMovies:   totalMoviesCount,
                    totalEpisodes: totalWatchedEpisodes,
                    totalTime:     totalTimeStr,
                    _version: manifest?.version || null,
                    _savedAt: Date.now()
                }
            });
        } catch (e) {
            console.error('[Stats] Failed to cache stats:', e);
        }
    }

    function checkAllCached(slugs) {
        const { FillerService } = AT;
        const allFillersCached = slugs.every(slug =>
            FillerService.isLikelyMovie(slug) || !!FillerService.episodeTypesCache[slug]
        );
        const allAnilistCached = slugs.every(slug => !!AT.AnilistService.cache?.[slug]);
        return { allFillersCached, allAnilistCached };
    }

    async function loadData() {
        const { Storage, ProgressManager, FillerService, UIHelpers } = AT;

        try {
            const cachedResult = await Storage.get(['cachedStats']);
            if (cachedResult.cachedStats) {
                const stats = cachedResult.cachedStats;
                if (elements.totalAnime) elements.totalAnime.textContent = stats.totalAnime || 0;
                if (elements.totalMovies) elements.totalMovies.textContent = stats.totalMovies || 0;
                if (elements.totalEpisodes) elements.totalEpisodes.textContent = stats.totalEpisodes || 0;
                if (elements.totalTime) elements.totalTime.textContent = stats.totalTime || '0h';
            }

            await Storage.migrateMultiPartAnime();

            const result = await Storage.get(['animeData', 'videoProgress', 'groupCoverImages', 'deletedAnime']);
            const normalized = ProgressManager.normalizeCanonicalSlugs(
                result.animeData || {}, result.videoProgress || {}, result.deletedAnime || {}
            );
            animeData = normalized.animeData || {};
            videoProgress = normalized.videoProgress || {};
            window.AnimeTracker.groupCoverImages = result.groupCoverImages || {};

            const cleanedData = ProgressManager.removeDuplicateEpisodes(animeData);
            const { repairedData, repairedCount } = ProgressManager.repairLikelyMissedEpisodes(cleanedData);
            const rawProgressForDurations = videoProgress || {};
            const { cleaned: cleanedProgress, removedCount: progressRemoved } =
                ProgressManager.cleanTrackedProgress(repairedData, videoProgress);

            const originalCount = UIHelpers.countEpisodes(result.animeData || {});
            const cleanedCount = UIHelpers.countEpisodes(repairedData);
            const durationFix = normalizeMovieDurations(repairedData, rawProgressForDurations);
            const phantomCleanup = cleanupPhantomMovies(
                repairedData,
                normalized.deletedAnime || result.deletedAnime || {}
            );
            const needsSave =
                (originalCount !== cleanedCount) || (progressRemoved > 0) ||
                (repairedCount > 0) || durationFix.changed || normalized.changed || phantomCleanup.changed;

            if (needsSave) {
                animeData = repairedData;
                videoProgress = cleanedProgress;
                const payload = { animeData: repairedData, videoProgress: cleanedProgress };
                if (normalized.changed || phantomCleanup.changed) payload.deletedAnime = phantomCleanup.deletedAnime;
                markInternalSave(payload);
                await Storage.set(payload);
            } else {
                animeData = repairedData;
            }

            await FillerService.loadCachedEpisodeTypes(animeData);
            await AT.AnilistService.loadCachedData(animeData);

            const slugsList = Object.keys(animeData);
            const { allFillersCached, allAnilistCached } = checkAllCached(slugsList);

            renderAnimeList();
            updateStats();

            if (!allFillersCached) {
                FillerService.autoFetchMissing(animeData, () => {
                    renderAnimeList(elements.searchInput?.value || '');
                    updateStats();
                });
            }

            if (!allAnilistCached) {
                AT.AnilistService.autoFetchMissing(animeData, () => {
                    renderAnimeList(elements.searchInput?.value || '');
                    updateStats();
                });
            }
        } catch (e) {
            console.error('[Storage] Load error:', e);
            animeData = {};
            videoProgress = {};
            renderAnimeList();
            updateStats();
        }
    }

    async function loadAndSyncData() {
        if (loadAndSyncInProgress) return;
        loadAndSyncInProgress = true;

        const { Storage, FirebaseSync, FillerService, ProgressManager } = AT;

        try {
            const cachedResult = await Storage.get(['cachedStats']);
            if (cachedResult.cachedStats) {
                const stats = cachedResult.cachedStats;
                if (elements.totalAnime) elements.totalAnime.textContent = stats.totalAnime || 0;
                if (elements.totalMovies) elements.totalMovies.textContent = stats.totalMovies || 0;
                if (elements.totalEpisodes) elements.totalEpisodes.textContent = stats.totalEpisodes || 0;
                if (elements.totalTime) elements.totalTime.textContent = stats.totalTime || '0h';
            }

            const prefs = await chrome.storage.local.get(['userPreferences']);
            if (prefs.userPreferences) {
                currentSort = prefs.userPreferences.sort || 'date';
                currentCategory = normalizeCategory(prefs.userPreferences.category || 'all');
                document.querySelectorAll('.sort-option').forEach(o => {
                    o.classList.toggle('active', o.dataset.sort === currentSort);
                });
                if (elements.categoryTabs) {
                    elements.categoryTabs.querySelectorAll('.category-tab').forEach(t => {
                        t.classList.toggle('active', t.dataset.category === currentCategory);
                    });
                }
            }

            await Storage.migrateMultiPartAnime();

            const data = await FirebaseSync.loadAndSyncData(elements);
            if (data) {
                const normalized = ProgressManager.normalizeCanonicalSlugs(
                    data.animeData || {}, data.videoProgress || {}, data.deletedAnime || {}
                );
                const deduped = ProgressManager.removeDuplicateEpisodes(normalized.animeData || {});
                const { repairedData, repairedCount } = ProgressManager.repairLikelyMissedEpisodes(deduped);
                const rawProgressForDurations = normalized.videoProgress || {};
                const { cleaned: cleanedProgress, removedCount: progressRemoved } =
                    ProgressManager.cleanTrackedProgress(repairedData, rawProgressForDurations);
                const durationFix = normalizeMovieDurations(repairedData, rawProgressForDurations);
                const phantomCleanup = cleanupPhantomMovies(
                    repairedData,
                    normalized.deletedAnime || data.deletedAnime || {}
                );

                animeData = repairedData;
                videoProgress = cleanedProgress;
                window.AnimeTracker.groupCoverImages = data.groupCoverImages || {};

                if (repairedCount > 0 || progressRemoved > 0 || durationFix.changed || normalized.changed || phantomCleanup.changed) {
                    const payload = { animeData: repairedData, videoProgress: cleanedProgress };
                    if (normalized.changed || phantomCleanup.changed) payload.deletedAnime = phantomCleanup.deletedAnime;
                    markInternalSave(payload);
                    await Storage.set(payload);
                }

                await FillerService.loadCachedEpisodeTypes(animeData);
                await AT.AnilistService.loadCachedData(animeData);

                const slugsList = Object.keys(animeData);
                const { allFillersCached, allAnilistCached } = checkAllCached(slugsList);

                renderAnimeList(elements.searchInput?.value || '');
                updateStats();

                if (!allFillersCached) {
                    FillerService.autoFetchMissing(animeData, () => {
                        renderAnimeList(elements.searchInput?.value || '');
                        updateStats();
                    });
                }

                if (!allAnilistCached) {
                    AT.AnilistService.autoFetchMissing(animeData, () => {
                        renderAnimeList(elements.searchInput?.value || '');
                        updateStats();
                    });
                }
            }
        } catch (error) {
            console.error('[Sync] Error:', error);
            loadData();
        } finally {
            loadAndSyncInProgress = false;
        }
    }

    async function deleteProgress(slug, episodeNumber) {
        const { Storage, FirebaseSync } = AT;
        const uniqueId = `${slug}__episode-${episodeNumber}`;

        try {
            const result = await Storage.get(['videoProgress']);
            const currentVideoProgress = result.videoProgress || {};

            if (currentVideoProgress[uniqueId]) {
                const GRACE_MS = 5000; // ensures deletedAt > savedAt across devices with clock skew
                const savedAt = currentVideoProgress[uniqueId].savedAt
                    ? new Date(currentVideoProgress[uniqueId].savedAt).getTime()
                    : Date.now();
                const deletedAt = new Date(Math.max(Date.now(), savedAt + GRACE_MS + 1)).toISOString();

                currentVideoProgress[uniqueId] = {
                    ...currentVideoProgress[uniqueId],
                    deleted: true,
                    deletedAt
                };
                videoProgress = currentVideoProgress;
                const dataToSave = { videoProgress: currentVideoProgress };
                const user = FirebaseSync.getUser();
                if (user) dataToSave.userId = user.uid;
                markInternalSave(dataToSave);
                await Storage.set(dataToSave);

                if (user) {
                    try {
                        const gcResult = await Storage.get(['groupCoverImages']);
                        await FirebaseSync.saveToCloud({
                            animeData, videoProgress: currentVideoProgress,
                            groupCoverImages: gcResult.groupCoverImages || {}
                        }, true);
                    } catch (syncErr) {
                        console.error('[DeleteProgress] Cloud sync failed:', syncErr);
                    }
                }

                renderAnimeList(elements.searchInput?.value || '');
            }
        } catch (e) {
            console.error('[DeleteProgress] Error:', e);
            alert('Failed to delete progress. Please try again.');
        }
    }

    async function deleteAnime(slug) {
        const { Storage, FirebaseSync } = AT;
        const savedEntry = animeData[slug];
        if (!savedEntry) return;

        // Optimistic in-memory update
        delete animeData[slug];

        try {
            const result = await Storage.get(['videoProgress', 'deletedAnime', 'groupCoverImages']);
            const currentVideoProgress = result.videoProgress || {};
            const progressPrefix = slug + '__episode-';
            for (const id of Object.keys(currentVideoProgress)) {
                if (id.startsWith(progressPrefix)) delete currentVideoProgress[id];
            }

            videoProgress = currentVideoProgress;
            const deletedAnime = result.deletedAnime || {};
            deletedAnime[slug] = { deletedAt: new Date().toISOString() };

            const dataToSave = { animeData, videoProgress: currentVideoProgress, deletedAnime };
            const user = FirebaseSync.getUser();
            if (user) dataToSave.userId = user.uid;
            markInternalSave(dataToSave);
            await Storage.set(dataToSave);

            if (user) {
                const gcResult = await Storage.get(['groupCoverImages']);
                await FirebaseSync.saveToCloud({
                    animeData, videoProgress: currentVideoProgress, deletedAnime,
                    groupCoverImages: gcResult.groupCoverImages || {}
                }, true);
            }

            renderAnimeList(elements.searchInput?.value || '');
            updateStats();
        } catch (e) {
            // Rollback optimistic delete so state stays consistent with storage
            animeData[slug] = savedEntry;
            console.error('[Delete] Error:', e);
            alert('Failed to delete anime. Please try again.');
        }
    }

    // Delete an "in-progress only" anime — one that exists only in videoProgress, not animeData.
    async function deleteInProgressOnly(slug) {
        const { Storage, FirebaseSync } = AT;
        try {
            const result = await Storage.get(['videoProgress']);
            const currentVideoProgress = result.videoProgress || {};
            const prefix = slug + '__episode-';
            const now = Date.now();
            let changed = false;

            for (const id of Object.keys(currentVideoProgress)) {
                if (!id.startsWith(prefix)) continue;
                const entry = currentVideoProgress[id];
                const savedAt = entry.savedAt ? new Date(entry.savedAt).getTime() : now;
                const deletedAt = new Date(Math.max(now, savedAt + 5001)).toISOString();
                currentVideoProgress[id] = { ...entry, deleted: true, deletedAt };
                changed = true;
            }

            if (!changed) return;

            videoProgress = currentVideoProgress;
            const dataToSave = { videoProgress: currentVideoProgress };
            const user = FirebaseSync.getUser();
            if (user) dataToSave.userId = user.uid;
            markInternalSave(dataToSave);
            await Storage.set(dataToSave);

            if (user) {
                try {
                    const gcResult = await Storage.get(['groupCoverImages']);
                    await FirebaseSync.saveToCloud({
                        animeData, videoProgress: currentVideoProgress,
                        groupCoverImages: gcResult.groupCoverImages || {}
                    }, true);
                } catch (syncErr) {
                    console.error('[DeleteInProgressOnly] Cloud sync failed:', syncErr);
                }
            }

            renderAnimeList(elements.searchInput?.value || '');
        } catch (e) {
            console.error('[DeleteInProgressOnly] Error:', e);
            alert('Failed to delete. Please try again.');
        }
    }

    async function toggleAnimeCompleted(slug) {
        const { Storage, FirebaseSync } = AT;
        if (!animeData[slug]) return;

        const prevCompletedAt = animeData[slug].completedAt;

        // Optimistic in-memory update
        if (animeData[slug].completedAt) {
            delete animeData[slug].completedAt;
        } else {
            animeData[slug].completedAt = new Date().toISOString();
        }

        try {
            const result = await Storage.get(['videoProgress', 'deletedAnime', 'groupCoverImages']);
            const currentVideoProgress = result.videoProgress || {};
            const deletedAnime = result.deletedAnime || {};

            const dataToSave = { animeData, videoProgress: currentVideoProgress, deletedAnime };
            const user = FirebaseSync.getUser();
            if (user) dataToSave.userId = user.uid;
            markInternalSave(dataToSave);
            await Storage.set(dataToSave);

            if (user) {
                await FirebaseSync.saveToCloud({
                    animeData, videoProgress: currentVideoProgress, deletedAnime,
                    groupCoverImages: result.groupCoverImages || {}
                }, true);
            }

            renderAnimeList(elements.searchInput?.value || '');
            updateStats();
        } catch (e) {
            // Rollback optimistic toggle
            if (prevCompletedAt === undefined) {
                delete animeData[slug].completedAt;
            } else {
                animeData[slug].completedAt = prevCompletedAt;
            }
            console.error('[Complete] Error:', e);
        }
    }

    async function clearAllData() {
        const { Storage, FirebaseSync } = AT;
        const dataToSave = { animeData: {}, videoProgress: {}, groupCoverImages: {} };
        const user = FirebaseSync.getUser();
        if (user) dataToSave.userId = user.uid;
        markInternalSave(dataToSave);
        await Storage.set(dataToSave);
        if (user) await FirebaseSync.saveToCloud({ animeData: {}, videoProgress: {}, groupCoverImages: {} }, true);
        animeData = {};
        videoProgress = {};
        renderAnimeList();
        updateStats();
        hideDialog();
    }

    function showDialog() { elements.confirmDialog.classList.add('visible'); }
    function hideDialog() { elements.confirmDialog.classList.remove('visible'); }

    function showAddAnimeDialog() {
        elements.animeSlugInput.value = '';
        elements.animeTitleInput.value = '';
        elements.episodesWatchedInput.value = '';
        elements.animeSlugInput.classList.remove('error');
        elements.episodesWatchedInput.classList.remove('error');
        const includeFillersCb = document.getElementById('includeFillers');
        if (includeFillersCb) includeFillersCb.checked = false;
        const includeFillerLabel = document.getElementById('includeFillerLabel');
        if (includeFillerLabel) includeFillerLabel.style.display = 'none';
        updateEpisodesPreview('');
        elements.addAnimeDialog.classList.add('visible');
        elements.animeSlugInput.focus();
    }

    function hideAddAnimeDialog() {
        elements.addAnimeDialog.classList.remove('visible');
    }

    function buildRangeString(episodeNumbers) {
        if (!episodeNumbers || episodeNumbers.length === 0) return '';
        const ranges = [];
        let start = episodeNumbers[0], end = episodeNumbers[0];
        for (let i = 1; i < episodeNumbers.length; i++) {
            if (episodeNumbers[i] === end + 1) {
                end = episodeNumbers[i];
            } else {
                ranges.push(start === end ? `${start}` : `${start}–${end}`);
                start = end = episodeNumbers[i];
            }
        }
        ranges.push(start === end ? `${start}` : `${start}–${end}`);
        return ranges.join(', ');
    }

    function splitCanonAndFillers(slug, episodeNumbers) {
        const { FillerService } = window.AnimeTracker;
        if (!slug || !FillerService || !FillerService.hasFillerData(slug)) {
            return { canon: episodeNumbers, fillers: [] };
        }
        const canon = [], fillers = [];
        for (const n of episodeNumbers) {
            if (FillerService.isFillerEpisode(slug, n)) fillers.push(n);
            else canon.push(n);
        }
        return { canon, fillers };
    }

    function updateEpisodesPreview(input) {
        const preview = document.getElementById('episodesPreview');
        const fillerLabel = document.getElementById('includeFillerLabel');
        const includeFillerText = document.getElementById('includeFillerText');
        if (!preview) return;

        if (!input || !input.trim()) {
            preview.innerHTML = '';
            preview.className = 'episodes-preview';
            if (fillerLabel) fillerLabel.style.display = 'none';
            return;
        }

        const allEpisodes = parseEpisodeRanges(input);
        if (allEpisodes.length === 0) {
            preview.innerHTML = '<span class="preview-error">⚠ No valid episodes found</span>';
            preview.className = 'episodes-preview preview-visible preview-error-state';
            if (fillerLabel) fillerLabel.style.display = 'none';
            return;
        }

        const slugRaw = elements.animeSlugInput ? elements.animeSlugInput.value : '';
        const slug = extractSlugFromInput(slugRaw);
        const { canon, fillers } = splitCanonAndFillers(slug, allEpisodes);

        const includeFillers = document.getElementById('includeFillers')?.checked || false;

        let html;
        if (includeFillers || fillers.length === 0) {
            html = `<span class="preview-ok">✓ ${allEpisodes.length} episodes: <strong>${buildRangeString(allEpisodes)}</strong></span>`;
        } else {
            html = `<span class="preview-ok">✓ ${canon.length} canon episodes: <strong>${buildRangeString(canon)}</strong></span>`;
            html += `<br><span class="preview-fillers">⏭ ${fillers.length} fillers will be excluded: ${buildRangeString(fillers)}</span>`;
        }
        preview.innerHTML = html;
        preview.className = 'episodes-preview preview-visible';

        if (fillerLabel) {
            if (fillers.length > 0) {
                fillerLabel.style.display = 'flex';
                if (includeFillerText) {
                    includeFillerText.textContent = includeFillers
                        ? `Fillers included (${fillers.length} eps: ${buildRangeString(fillers)})`
                        : `Include ${fillers.length} filler episodes too (${buildRangeString(fillers)})`;
                }
            } else {
                fillerLabel.style.display = 'none';
            }
        }
    }

    function parseEpisodeRanges(input) {
        if (!input || !input.trim()) return [];
        const episodeNumbers = new Set();
        const parts = input.split(/[,;]+/).map(p => p.trim()).filter(Boolean);
        for (const part of parts) {
            const rangeMatch = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
            const singleMatch = part.match(/^(\d+)$/);
            if (rangeMatch) {
                const start = parseInt(rangeMatch[1], 10);
                const end = parseInt(rangeMatch[2], 10);
                if (start > 0 && end >= start) {
                    for (let i = start; i <= end; i++) episodeNumbers.add(i);
                }
            } else if (singleMatch) {
                const num = parseInt(singleMatch[1], 10);
                if (num > 0) episodeNumbers.add(num);
            }
        }
        return Array.from(episodeNumbers).sort((a, b) => a - b);
    }

    function extractSlugFromInput(input) {
        if (!input) return null;
        input = input.trim();
        const normalizeSlug = (slug) => slug
            .toLowerCase()
            .replace(/-episode-\d+$/i, '')
            .replace(/-(?:episodes?|ep)$/i, '')
            .replace(/-+$/g, '');

        const watchEpisodePattern = /\/watch\/([a-zA-Z0-9-]+)-episode-\d+/i;
        const watchMatch = input.match(watchEpisodePattern);
        if (watchMatch) return normalizeSlug(watchMatch[1]);

        const animePattern = /\/anime\/([a-zA-Z0-9-]+)/i;
        const animeMatch = input.match(animePattern);
        if (animeMatch) return normalizeSlug(animeMatch[1]);

        const watchPattern = /\/watch\/([a-zA-Z0-9-]+)/i;
        const watchOnlyMatch = input.match(watchPattern);
        if (watchOnlyMatch) return normalizeSlug(watchOnlyMatch[1]);

        return normalizeSlug(input.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''));
    }

    function generateTitleFromSlug(slug) {
        return slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }

    async function addAnimeWithEpisodes() {
        const { Storage, FirebaseSync, SeasonGrouping } = AT;
        const slugInput = elements.animeSlugInput.value;
        const slug = extractSlugFromInput(slugInput);
        const title = elements.animeTitleInput.value.trim() || generateTitleFromSlug(slug);
        const episodesRawInput = elements.episodesWatchedInput.value.trim();

        if (!slug) {
            elements.animeSlugInput.classList.add('error');
            elements.animeSlugInput.focus();
            return;
        }
        elements.animeSlugInput.classList.remove('error');

        if (!episodesRawInput) {
            elements.episodesWatchedInput.classList.add('error');
            elements.episodesWatchedInput.focus();
            return;
        }

        const allParsedEpisodes = parseEpisodeRanges(episodesRawInput);
        const includeFillers = document.getElementById('includeFillers')?.checked || false;
        const { canon, fillers: excludedFillers } = splitCanonAndFillers(slug, allParsedEpisodes);
        const episodeNumbers = includeFillers ? allParsedEpisodes : canon;

        if (episodeNumbers.length === 0) {
            elements.episodesWatchedInput.classList.add('error');
            elements.episodesWatchedInput.focus();
            return;
        }
        elements.episodesWatchedInput.classList.remove('error');

        elements.confirmAddAnime.disabled = true;
        elements.confirmAddAnime.textContent = 'Adding...';

        try {
            const now = new Date().toISOString();
            const isMovie = SeasonGrouping.isMovie(slug, { title });
            const defaultDuration = isMovie ? 0 : 1440;
            const episodes = episodeNumbers.map(num => ({ number: num, duration: defaultDuration, watchedAt: now }));

            if (animeData[slug]) {
                const existingEpisodes = animeData[slug].episodes || [];
                const existingNumbers = new Set(existingEpisodes.map(ep => ep.number));
                for (const ep of episodes) {
                    if (!existingNumbers.has(ep.number)) existingEpisodes.push(ep);
                }
                existingEpisodes.sort((a, b) => a.number - b.number);
                animeData[slug].episodes = existingEpisodes;
                animeData[slug].totalWatchTime = existingEpisodes.reduce((sum, ep) => sum + (ep.duration || 0), 0);
                animeData[slug].lastWatched = now;
            } else {
                animeData[slug] = {
                    title, slug, episodes,
                    totalWatchTime: episodes.reduce((sum, ep) => sum + (ep.duration || 0), 0),
                    lastWatched: now, totalEpisodes: null
                };
            }

            const dataToSave = { animeData, videoProgress };
            const user = FirebaseSync.getUser();
            if (user) dataToSave.userId = user.uid;
            markInternalSave(dataToSave);
            await Storage.set(dataToSave);

            renderAnimeList(elements.searchInput?.value || '');
            updateStats();
            hideAddAnimeDialog();

            if (user) {
                (async () => {
                    const gcRes = await Storage.get(['groupCoverImages']);
                    await FirebaseSync.saveToCloud({ animeData, videoProgress, groupCoverImages: gcRes.groupCoverImages || {} });
                })().catch(err => console.error('[AddAnime] Cloud save error:', err));
            }
        } catch (error) {
            console.error('[AddAnime] Error:', error);
            alert('Failed to add anime. Please try again.');
        } finally {
            elements.confirmAddAnime.disabled = false;
            elements.confirmAddAnime.textContent = 'Add Anime';
        }
    }

    function showEditTitleDialog(slug) {
        if (!animeData[slug]) { console.warn('[EditTitle] Anime not found:', slug); return; }
        editingSlug = slug;
        elements.editTitleInput.value = animeData[slug].title || '';
        elements.editTitleDialog.classList.add('visible');
        elements.editTitleInput.focus();
        elements.editTitleInput.select();
    }

    function hideEditTitleDialog() {
        elements.editTitleDialog.classList.remove('visible');
        editingSlug = null;
    }

    async function saveEditedTitle() {
        const { Storage, FirebaseSync } = AT;
        if (!editingSlug || !animeData[editingSlug]) { hideEditTitleDialog(); return; }

        const newTitle = elements.editTitleInput.value.trim();
        const currentTitle = animeData[editingSlug].title || '';
        if (newTitle === '' || newTitle === currentTitle) { hideEditTitleDialog(); return; }

        try {
            animeData[editingSlug].title = newTitle;
            const dataToSave = { animeData, videoProgress };
            const user = FirebaseSync.getUser();
            if (user) dataToSave.userId = user.uid;
            markInternalSave(dataToSave);
            await Storage.set(dataToSave);
            renderAnimeList(elements.searchInput?.value || '');

            if (user) {
                (async () => {
                    const gcRes = await Storage.get(['groupCoverImages']);
                    await FirebaseSync.saveToCloud({ animeData, videoProgress, groupCoverImages: gcRes.groupCoverImages || {} });
                })().catch(err => console.error('[EditTitle] Cloud save error:', err));
            }
            hideEditTitleDialog();
        } catch (error) {
            console.error('[EditTitle] Error:', error);
            alert('Failed to update title. Please try again.');
        }
    }

    function editAnimeTitle(slug) { showEditTitleDialog(slug); }

    async function fetchFillerForAnime(slug, btn) {
        const { FillerService } = AT;
        if (btn) { btn.disabled = true; btn.textContent = '...'; }
        try {
            const episodeTypes = await FillerService.fetchEpisodeTypes(slug);
            if (episodeTypes) {
                FillerService.updateFromEpisodeTypes(slug, episodeTypes);
                renderAnimeList(elements.searchInput?.value || '');
                updateStats();
            }
        } catch (error) {
            console.error('[FetchFiller] Error:', error);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '🎭'; }
        }
    }

    async function fetchAllFillers() {
        const { FillerFetchUI } = AT;
        FillerFetchUI.onComplete = () => {
            renderAnimeList(elements.searchInput?.value || '');
            updateStats();
        };
        await FillerFetchUI.open();
    }

    const GOOGLE_BTN_DEFAULT_HTML = `
        <span class="btn-content">
            <svg class="google-icon" viewBox="0 0 24 24">
                <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <span>Sign in with Google</span>
        </span>`;

    async function signInWithGoogle() {
        const { FirebaseSync } = AT;
        try {
            elements.googleSignIn.disabled = true;
            elements.googleSignIn.innerHTML = `
                <span class="btn-content">
                    <svg class="google-icon" style="animation:spin 0.9s linear infinite" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5">
                        <circle cx="12" cy="12" r="10" stroke-opacity="0.3"/>
                        <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
                    </svg>
                    <span>Signing in...</span>
                </span>`;
            await FirebaseSync.signInWithGoogle();
        } catch (error) {
            const msg = (error.message || '').toLowerCase();
            const isCancelled = msg.includes('did not approve') || msg.includes('cancelled') ||
                msg.includes('closed') || msg.includes('popup_closed') ||
                error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request';
            if (!isCancelled) {
                console.error('[Firebase] Sign in error:', error);
                showAuthToast('Sign in failed. Please try again.', 'error');
            }
        } finally {
            elements.googleSignIn.disabled = false;
            elements.googleSignIn.innerHTML = GOOGLE_BTN_DEFAULT_HTML;
        }
    }

    function showAuthToast(message, type = 'error') {
        const existing = document.getElementById('authToast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'authToast';
        toast.textContent = message;
        toast.style.cssText = `
            position:absolute; bottom:20px; left:50%; transform:translateX(-50%);
            background:${type === 'error' ? 'rgba(240,69,69,0.9)' : 'rgba(54,212,116,0.9)'};
            color:#fff; padding:8px 18px; border-radius:50px; font-size:12px;
            font-weight:600; z-index:10; white-space:nowrap;
            box-shadow:0 4px 16px rgba(0,0,0,0.4);
            animation:fadeIn 0.2s ease;`;
        document.getElementById('authSection')?.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    async function signOut() {
        const { Storage, FirebaseSync } = AT;
        animeData = {};
        videoProgress = {};
        await Storage.set({ animeData: {}, videoProgress: {} });
        await FirebaseSync.signOut();
        renderAnimeList();
        updateStats();
    }

    function initEventListeners() {
        const { CONFIG, DONATE_LINKS, FirebaseSync } = AT;

        if (elements.googleSignIn) elements.googleSignIn.addEventListener('click', signInWithGoogle);

        const collapsible = document.getElementById('advancedCollapsible');
        const collapsibleHeader = collapsible?.querySelector('.auth-collapsible-header');
        if (collapsibleHeader) {
            const authContent = document.querySelector('.auth-content');
            const toggleTokenMode = (expanded) => {
                collapsible.classList.toggle('expanded', expanded);
                authContent?.classList.toggle('token-mode', expanded);
            };
            collapsibleHeader.addEventListener('click', () => {
                const isExpanded = !collapsible.classList.contains('expanded');
                toggleTokenMode(isExpanded);
                try { localStorage.setItem('authAdvancedExpanded', isExpanded); } catch {}
            });
            try {
                const wasExpanded = localStorage.getItem('authAdvancedExpanded') === 'true';
                if (wasExpanded) toggleTokenMode(true);
            } catch {}
        }

        const pasteTokenBtn = document.getElementById('pasteTokenBtn');
        if (pasteTokenBtn) {
            pasteTokenBtn.addEventListener('click', async () => {
                try {
                    const text = await navigator.clipboard.readText();
                    const input = document.getElementById('authTokenInput');
                    if (input) {
                        input.value = text;
                        input.dispatchEvent(new Event('input'));
                        pasteTokenBtn.textContent = '✓';
                        pasteTokenBtn.style.background = 'linear-gradient(160deg,#1a8a5a 0%,#0e6644 45%,#075230 100%)';
                        setTimeout(() => {
                            pasteTokenBtn.textContent = 'Paste';
                            pasteTokenBtn.style.background = '';
                        }, 1500);
                    }
                } catch {
                    // Clipboard read failed — focus textarea so user can Ctrl+V
                    document.getElementById('authTokenInput')?.focus();
                }
            });
        }

        const tokenSignInBtn = document.getElementById('tokenSignIn');
        if (tokenSignInBtn) {
            tokenSignInBtn.addEventListener('click', async () => {
                const tokenInput = document.getElementById('authTokenInput')?.value?.trim();
                const errorEl = document.getElementById('tokenAuthError');
                if (!tokenInput) {
                    if (errorEl) { errorEl.textContent = 'Please paste your exported token.'; errorEl.style.display = 'block'; }
                    return;
                }
                tokenSignInBtn.disabled = true;
                tokenSignInBtn.textContent = 'Importing...';
                if (errorEl) errorEl.style.display = 'none';
                try {
                    const tokenData = JSON.parse(tokenInput);
                    await FirebaseLib.signInWithExportedToken(tokenData);
                } catch (err) {
                    const msg = err.message.includes('JSON') ? 'Invalid token format. Please copy it again from Chrome.' : err.message;
                    if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
                } finally {
                    tokenSignInBtn.disabled = false;
                    tokenSignInBtn.textContent = 'Import & Sign In';
                }
            });
        }

        const exportTokenBtn = document.getElementById('settingsExportToken');
        if (exportTokenBtn) {
            exportTokenBtn.addEventListener('click', async () => {
                elements.settingsDropdown?.classList.remove('visible');
                try {
                    const tokenData = await FirebaseLib.exportSessionToken();
                    const tokenStr = JSON.stringify(tokenData);
                    const overlay = document.createElement('div');
                    overlay.className = 'export-token-overlay';
                    overlay.innerHTML = `
                        <div class="export-token-box">
                            <div class="export-token-header">
                                <span class="export-token-header-dot"></span>
                                <h3>Export Token</h3>
                            </div>
                            <div class="export-token-body">
                                <p>Copy this token and paste it in the <strong>Import Token</strong> panel on Orion/Safari. Valid for ~1 hour.</p>
                                <textarea class="export-token-text" readonly>${tokenStr}</textarea>
                                <div class="export-token-actions">
                                    <button class="btn-copy-token">Copy Token</button>
                                    <button class="btn-close-token">Close</button>
                                </div>
                            </div>
                        </div>
                    `;
                    overlay.querySelector('.btn-copy-token').addEventListener('click', async () => {
                        try {
                            await navigator.clipboard.writeText(tokenStr);
                            overlay.querySelector('.btn-copy-token').textContent = '✓ Copied!';
                        } catch { overlay.querySelector('.export-token-text').select(); }
                    });
                    overlay.querySelector('.btn-close-token').addEventListener('click', () => overlay.remove());
                    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
                    document.body.appendChild(overlay);
                    setTimeout(() => overlay.querySelector('.export-token-text')?.select(), 50);
                } catch (err) {
                    alert('Export failed: ' + err.message);
                }
            });
        }

        if (elements.settingsBtn) {
            elements.settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (elements.donateDropdown) elements.donateDropdown.classList.remove('visible');
                if (elements.sortDropdown) elements.sortDropdown.classList.remove('visible');
                if (elements.sortBtn) elements.sortBtn.classList.remove('active');
                elements.settingsDropdown.classList.toggle('visible');
            });
        }

        document.addEventListener('click', (e) => {
            if (elements.settingsDropdown && elements.settingsBtn &&
                !elements.settingsDropdown.contains(e.target) && !elements.settingsBtn.contains(e.target)) {
                elements.settingsDropdown.classList.remove('visible');
            }
            if (elements.donateDropdown &&
                !elements.donateDropdown.contains(e.target) &&
                (!elements.settingsDonate || !elements.settingsDonate.contains(e.target))) {
                elements.donateDropdown.classList.remove('visible');
            }
        });

        if (elements.settingsDonate) {
            elements.settingsDonate.addEventListener('click', (e) => {
                e.stopPropagation();
                elements.settingsDropdown.classList.remove('visible');
                setTimeout(() => elements.donateDropdown.classList.add('visible'), 150);
            });
        }

        if (elements.settingsRefresh) {
            elements.settingsRefresh.addEventListener('click', async () => {
                elements.settingsRefresh.classList.add('loading');
                elements.settingsDropdown.classList.remove('visible');
                if (FirebaseSync.getUser()) await loadAndSyncData();
                else loadData();
                setTimeout(() => elements.settingsRefresh.classList.remove('loading'), 500);
            });
        }

        if (elements.settingsRefreshInfo) {
            elements.settingsRefreshInfo.addEventListener('click', async () => {
                const { Storage, AnilistService } = AT;
                elements.settingsRefreshInfo.classList.add('loading');
                elements.settingsDropdown.classList.remove('visible');
                try {
                    // Clear all cached anime info from storage so autoFetchMissing re-fetches everything
                    const allKeys = await new Promise(resolve => chrome.storage.local.get(null, resolve));
                    const infoKeys = Object.keys(allKeys).filter(k => k.startsWith('animeinfo_'));
                    if (infoKeys.length > 0) await Storage.remove(infoKeys);
                    AnilistService.cache = {};
                    await AnilistService.autoFetchMissing(animeData, () => {
                        renderAnimeList(elements.searchInput?.value || '');
                        updateStats();
                    });
                } catch (e) {
                    console.error('[RefreshInfo] Error:', e);
                } finally {
                    setTimeout(() => elements.settingsRefreshInfo.classList.remove('loading'), 500);
                }
            });
        }

        if (elements.settingsClear) {
            elements.settingsClear.addEventListener('click', () => {
                elements.settingsDropdown.classList.remove('visible');
                showDialog();
            });
        }

        if (elements.settingsSignOut) {
            elements.settingsSignOut.addEventListener('click', () => {
                elements.settingsDropdown.classList.remove('visible');
                signOut();
            });
        }

        if (elements.settingsFetchFillers) {
            elements.settingsFetchFillers.addEventListener('click', () => {
                elements.settingsDropdown.classList.remove('visible');
                fetchAllFillers();
            });
        }

        if (elements.searchInput) {
            let searchTimeout = null;
            elements.searchInput.addEventListener('input', (e) => {
                if (searchTimeout) clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => renderAnimeList(e.target.value), CONFIG.SEARCH_DEBOUNCE_MS);
            });
        }

        if (elements.confirmClear) elements.confirmClear.addEventListener('click', clearAllData);
        if (elements.cancelClear) elements.cancelClear.addEventListener('click', hideDialog);
        if (elements.confirmDialog) {
            elements.confirmDialog.addEventListener('click', (e) => {
                if (e.target === elements.confirmDialog) hideDialog();
            });
        }

        if (elements.addAnimeBtn) elements.addAnimeBtn.addEventListener('click', showAddAnimeDialog);
        if (elements.closeAddAnime) elements.closeAddAnime.addEventListener('click', hideAddAnimeDialog);
        if (elements.cancelAddAnime) elements.cancelAddAnime.addEventListener('click', hideAddAnimeDialog);
        if (elements.confirmAddAnime) elements.confirmAddAnime.addEventListener('click', addAnimeWithEpisodes);
        if (elements.addAnimeDialog) {
            elements.addAnimeDialog.addEventListener('click', (e) => {
                if (e.target === elements.addAnimeDialog) hideAddAnimeDialog();
            });
        }

        if (elements.animeSlugInput) {
            elements.animeSlugInput.addEventListener('input', () => {
                if (elements.episodesWatchedInput && elements.episodesWatchedInput.value) {
                    updateEpisodesPreview(elements.episodesWatchedInput.value);
                }
            });
            elements.animeSlugInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') elements.episodesWatchedInput.focus();
            });
        }
        if (elements.episodesWatchedInput) {
            elements.episodesWatchedInput.addEventListener('input', (e) => updateEpisodesPreview(e.target.value));
            elements.episodesWatchedInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') addAnimeWithEpisodes();
            });
        }

        const includeFillersCb = document.getElementById('includeFillers');
        if (includeFillersCb) {
            includeFillersCb.addEventListener('change', () => {
                if (elements.episodesWatchedInput) {
                    updateEpisodesPreview(elements.episodesWatchedInput.value);
                }
            });
        }

        if (elements.closeEditTitle) elements.closeEditTitle.addEventListener('click', hideEditTitleDialog);
        if (elements.cancelEditTitle) elements.cancelEditTitle.addEventListener('click', hideEditTitleDialog);
        if (elements.confirmEditTitle) elements.confirmEditTitle.addEventListener('click', saveEditedTitle);
        if (elements.editTitleDialog) {
            elements.editTitleDialog.addEventListener('click', (e) => {
                if (e.target === elements.editTitleDialog) hideEditTitleDialog();
            });
        }
        if (elements.editTitleInput) {
            elements.editTitleInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') saveEditedTitle();
            });
        }

        if (elements.donatePaypal) {
            elements.donatePaypal.addEventListener('click', () => {
                window.open(DONATE_LINKS.paypal, '_blank');
                elements.donateDropdown.classList.remove('visible');
            });
        }
        if (elements.donateRevolut) {
            elements.donateRevolut.addEventListener('click', () => {
                window.open(DONATE_LINKS.revolut, '_blank');
                elements.donateDropdown.classList.remove('visible');
            });
        }

        if (elements.sortBtn) {
            elements.sortBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                elements.sortDropdown.classList.toggle('visible');
                elements.sortBtn.classList.toggle('active');
            });
        }

        document.querySelectorAll('.sort-option').forEach(option => {
            option.addEventListener('click', async () => {
                currentSort = option.dataset.sort;
                document.querySelectorAll('.sort-option').forEach(o => o.classList.remove('active'));
                option.classList.add('active');
                if (elements.searchInput) renderAnimeList(elements.searchInput.value);
                if (elements.sortDropdown) elements.sortDropdown.classList.remove('visible');
                if (elements.sortBtn) elements.sortBtn.classList.remove('active');
                await chrome.storage.local.set({ userPreferences: { sort: currentSort, category: currentCategory } });
            });
        });

        document.addEventListener('click', (e) => {
            if (elements.sortDropdown && elements.sortBtn &&
                !elements.sortDropdown.contains(e.target) && !elements.sortBtn.contains(e.target)) {
                elements.sortDropdown.classList.remove('visible');
                elements.sortBtn.classList.remove('active');
            }
        });

        if (elements.categoryTabs) {
            elements.categoryTabs.querySelectorAll('.category-tab').forEach(tab => {
                tab.addEventListener('click', async () => {
                    currentCategory = normalizeCategory(tab.dataset.category);
                    elements.categoryTabs.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    if (elements.searchInput) renderAnimeList(elements.searchInput.value);
                    await chrome.storage.local.set({ userPreferences: { sort: currentSort, category: currentCategory } });
                });
            });
        }

        let storageUpdateTimeout = null;
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local') return;
            let needsUpdate = false;
            const isOwn = isOwnStorageChange(changes);
            let isExternalUpdate = false;

            if (changes.animeData) { animeData = changes.animeData.newValue || {}; needsUpdate = true; if (!isOwn) isExternalUpdate = true; }
            if (changes.videoProgress) { videoProgress = changes.videoProgress.newValue || {}; needsUpdate = true; if (!isOwn) isExternalUpdate = true; }
            if (changes.groupCoverImages) { window.AnimeTracker.groupCoverImages = changes.groupCoverImages.newValue || {}; needsUpdate = true; if (!isOwn) isExternalUpdate = true; }

            if (needsUpdate) {
                if (storageUpdateTimeout) clearTimeout(storageUpdateTimeout);
                storageUpdateTimeout = setTimeout(async () => {
                    renderAnimeList(elements.searchInput?.value || '');
                    updateStats();
                    if (isExternalUpdate && elements.syncStatus && elements.syncText) {
                        elements.syncStatus.classList.add('synced');
                        elements.syncText.textContent = 'Synced ✓';
                        setTimeout(() => { elements.syncText.textContent = 'Cloud Synced'; }, 2500);
                    }
                }, CONFIG.STORAGE_UPDATE_DEBOUNCE_MS);
            }
        });

        if (elements.animeList) {
            elements.animeList.addEventListener('click', async (e) => {
                const target = e.target;

                if (target.classList.contains('progress-delete-btn') || target.closest('.progress-delete-btn')) {
                    const btn = target.classList.contains('progress-delete-btn') ? target : target.closest('.progress-delete-btn');
                    const slug = btn.dataset.slug;
                    const episodeNum = parseInt(btn.dataset.episode, 10);
                    if (slug && episodeNum) await deleteProgress(slug, episodeNum);
                    return;
                }

                // ── ip-delete-btn: delete an in-progress-only entry (not in animeData) ──
                if (target.classList.contains('ip-delete-btn') || target.closest('.ip-delete-btn')) {
                    const btn = target.classList.contains('ip-delete-btn') ? target : target.closest('.ip-delete-btn');
                    if (btn.dataset.slug) await deleteInProgressOnly(btn.dataset.slug);
                    return;
                }

                if (target.classList.contains('anime-complete-toggle') || target.closest('.anime-complete-toggle')) {
                    const btn = target.classList.contains('anime-complete-toggle') ? target : target.closest('.anime-complete-toggle');
                    if (btn.dataset.slug) await toggleAnimeCompleted(btn.dataset.slug);
                    return;
                }

                if (target.classList.contains('anime-delete') || target.closest('.anime-delete')) {
                    const btn = target.classList.contains('anime-delete') ? target : target.closest('.anime-delete');
                    if (btn.dataset.slug) deleteAnime(btn.dataset.slug);
                    return;
                }

                if (target.classList.contains('anime-edit-title') || target.closest('.anime-edit-title')) {
                    const btn = target.classList.contains('anime-edit-title') ? target : target.closest('.anime-edit-title');
                    if (btn.dataset.slug) editAnimeTitle(btn.dataset.slug);
                    return;
                }

                if (target.classList.contains('season-edit-btn') || target.closest('.season-edit-btn')) {
                    const btn = target.classList.contains('season-edit-btn') ? target : target.closest('.season-edit-btn');
                    if (btn.dataset.slug) editAnimeTitle(btn.dataset.slug);
                    return;
                }

                if (target.classList.contains('season-delete-btn') || target.closest('.season-delete-btn')) {
                    const btn = target.classList.contains('season-delete-btn') ? target : target.closest('.season-delete-btn');
                    if (btn.dataset.slug) deleteAnime(btn.dataset.slug);
                    return;
                }

                if (target.classList.contains('anime-fetch-filler') || target.closest('.anime-fetch-filler')) {
                    const btn = target.classList.contains('anime-fetch-filler') ? target : target.closest('.anime-fetch-filler');
                    if (btn.dataset.slug && !btn.disabled) await fetchFillerForAnime(btn.dataset.slug, btn);
                    return;
                }

                const card = target.closest('.anime-card');
                if (card && !target.closest('button') && !target.closest('.anime-card-actions')) {
                    card.classList.toggle('expanded');
                    return;
                }

                const inProgressHeader = target.closest('.in-progress-header');
                if (inProgressHeader) {
                    const section = inProgressHeader.closest('.anime-in-progress');
                    if (section) section.classList.toggle('collapsed');
                    return;
                }

                const episodesHeader = target.closest('.episodes-header');
                if (episodesHeader) {
                    const section = episodesHeader.closest('.anime-episodes');
                    if (section) section.classList.toggle('collapsed');
                    return;
                }
            });
        }
    }

    function checkBackgroundAlive(timeoutMs = 400) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => resolve(false), timeoutMs);
            try {
                chrome.runtime.sendMessage({ type: 'GET_VERSION' }, (resp) => {
                    clearTimeout(timer);
                    resolve(!chrome.runtime.lastError && !!resp);
                });
            } catch {
                clearTimeout(timer);
                resolve(false);
            }
        });
    }

    async function init() {
        const { FirebaseSync, Storage, FillerFetchUI } = AT;

        FillerFetchUI.init();

        try {
            const manifest = chrome.runtime.getManifest();
            await Storage.invalidateCachedStats(manifest?.version || '');
        } catch (e) {
            console.warn('[Init] Could not check cachedStats version:', e);
        }

        try {
            const cachedResult = await Storage.get(['cachedStats']);
            if (cachedResult.cachedStats) {
                const stats = cachedResult.cachedStats;
                if (elements.totalAnime) elements.totalAnime.textContent = stats.totalAnime || 0;
                if (elements.totalMovies) elements.totalMovies.textContent = stats.totalMovies || 0;
                if (elements.totalEpisodes) elements.totalEpisodes.textContent = stats.totalEpisodes || 0;
                if (elements.totalTime) elements.totalTime.textContent = stats.totalTime || '0h';
            }
        } catch (e) {
            console.error('[Init] Failed to load cached stats:', e);
        }

        try {
            const manifest = chrome.runtime.getManifest();
            if (elements.versionText && manifest?.version) {
                elements.versionText.textContent = `Anime Tracker v${manifest.version}`;
            }
        } catch (e) {
            console.warn('[Version] Could not load manifest version:', e);
        }

        initEventListeners();

        FirebaseSync.init({
            onUserSignedIn: async (user) => {
                showMainApp(user);
                const bgAlive = await checkBackgroundAlive();
                if (!bgAlive) {
                    try { chrome.runtime.sendMessage({ type: 'SYNC_TO_FIREBASE' }); } catch {}
                }
                loadAndSyncData();
            },
            onUserSignedOut: () => showAuthScreen(),
            onError: () => { showMainApp(null); loadData(); }
        });
    }

    window.addEventListener('beforeunload', () => AT.FirebaseSync.cleanup());
    document.addEventListener('visibilitychange', async () => {
        if (document.hidden) AT.FirebaseSync.cleanup();
    });

    init();

})();
