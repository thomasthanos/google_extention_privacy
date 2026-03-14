/**
 * Anime Tracker - Main Entry Point
 * Orchestrates all modules and handles UI interactions
 */

(function () {
    'use strict';

    // Wait for all modules to load
    const AT = window.AnimeTracker;

    // State
    let animeData = {};
    let videoProgress = {};
    let currentSort = 'date';
    let currentCategory = 'all'; // 'all', 'series', 'movies'

    // DOM Elements
    const elements = {
        // Auth
        authSection: document.getElementById('authSection'),
        mainApp: document.getElementById('mainApp'),
        googleSignIn: document.getElementById('googleSignIn'),
        // Settings Menu
        settingsBtn: document.getElementById('settingsBtn'),
        settingsDropdown: document.getElementById('settingsDropdown'),
        settingsAvatar: document.getElementById('settingsAvatar'),
        settingsUserName: document.getElementById('settingsUserName'),
        settingsUserEmail: document.getElementById('settingsUserEmail'),
        settingsDonate: document.getElementById('settingsDonate'),
        settingsRefresh: document.getElementById('settingsRefresh'),
        settingsClear: document.getElementById('settingsClear'),
        settingsSignOut: document.getElementById('settingsSignOut'),
        // Main
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
        // Add Anime Dialog
        addAnimeBtn: document.getElementById('addAnimeBtn'),
        addAnimeDialog: document.getElementById('addAnimeDialog'),
        closeAddAnime: document.getElementById('closeAddAnime'),
        cancelAddAnime: document.getElementById('cancelAddAnime'),
        confirmAddAnime: document.getElementById('confirmAddAnime'),
        animeSlugInput: document.getElementById('animeSlug'),
        animeTitleInput: document.getElementById('animeTitle'),
        episodesWatchedInput: document.getElementById('episodesWatched'),
        // markAllWatched checkbox removed — element not present in HTML
        // Edit Title Dialog
        editTitleDialog: document.getElementById('editTitleDialog'),
        editTitleInput: document.getElementById('editTitleInput'),
        closeEditTitle: document.getElementById('closeEditTitle'),
        cancelEditTitle: document.getElementById('cancelEditTitle'),
        confirmEditTitle: document.getElementById('confirmEditTitle'),
        // Category Tabs
        categoryTabs: document.getElementById('categoryTabs')
    };

    // State for edit title
    let editingSlug = null;
    let loadAndSyncInProgress = false;

    // Track writes initiated by this popup so storage.onChanged can distinguish
    // local writes from external/background updates.
    // Uses a per-write UUID token injected into the saved payload under the key
    // '__writeToken'. This avoids relying on JSON.stringify key ordering
    // (which is V8-stable but not ECMAScript-guaranteed) for change detection.
    const OWN_WRITE_TTL_MS = 15000;
    const ownWriteTokens = new Set();

    function generateWriteToken() {
        try {
            return crypto.randomUUID();
        } catch {
            // Fallback for environments where crypto.randomUUID is unavailable
            return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        }
    }

    /**
     * Inject a unique write token into the payload before saving.
     * The token is stored in chrome.storage.local under '__writeToken' and
     * in memory so the onChanged listener can identify our own writes.
     * @param {object} data - The payload object passed to Storage.set().
     *   The '__writeToken' key is added in-place so it is included in the write.
     */
    function markInternalSave(data = null) {
        if (!data || typeof data !== 'object') return;
        const token = generateWriteToken();
        data.__writeToken = token;
        ownWriteTokens.add(token);
        setTimeout(() => ownWriteTokens.delete(token), OWN_WRITE_TTL_MS);
    }

    /**
     * Returns true if the storage change batch originated from this popup.
     * Checks for '__writeToken' in the change set and validates it against
     * the in-memory set of tokens we generated.
     * @param {object} changes - The full changes object from onChanged.
     */
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
        const { FillerService, SeasonGrouping } = AT;
        if (!anime) return false;

        const watchedCount = anime.episodes?.length || 0;
        if (watchedCount === 0) return false;

        // Movies are complete as soon as they are tracked once.
        if (SeasonGrouping.isMovie(slug, anime)) return true;

        const progressData = FillerService.calculateProgress(watchedCount, slug, anime);
        return progressData.progress >= 100;
    }

    function isAgedCompleted(slug, anime) {
        const { CONFIG } = AT;
        if (!isAnimeCompleted(slug, anime)) return false;
        const daysSinceLastWatch = getCalendarDayDiff(anime?.lastWatched);
        return daysSinceLastWatch >= CONFIG.COMPLETED_LIST_MIN_DAYS;
    }

    function normalizeMovieDurations(data, progress = {}) {
        const { SeasonGrouping } = AT;
        const MIN_RELIABLE_DURATION_SECONDS = 30 * 60; // 30 minutes
        const MAX_RELIABLE_DURATION_SECONDS = 6 * 60 * 60; // 6 hours
        const LEGACY_DEFAULT_MOVIE_DURATION_SECONDS = 100 * 60; // 1h40m fallback
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
                ? Math.max(...slugProgressDurations)
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
                const isLegacyDuration =
                    currentDuration === 1440 || currentDuration === 6000 || currentDuration === 7200;
                const isUnknownDuration = currentDuration <= 0;
                const isVideoMeasured = ep?.durationSource === 'video';

                let nextDuration = currentDuration;
                if (hasBetterProgressDuration && (isLegacyDuration || currentDuration < MIN_RELIABLE_DURATION_SECONDS)) {
                    nextDuration = progressDuration;
                } else if (isUnknownDuration && !isVideoMeasured) {
                    // Recovery path: if legacy cleanup previously zeroed movie durations and
                    // we still don't have real metadata, keep a stable estimate instead of 0.
                    const fallbackFromTotal =
                        anime.episodes?.length > 0
                            ? Math.round((Number(anime.totalWatchTime) || 0) / anime.episodes.length)
                            : 0;
                    const hasValidFallbackFromTotal =
                        fallbackFromTotal >= MIN_RELIABLE_DURATION_SECONDS &&
                        fallbackFromTotal <= MAX_RELIABLE_DURATION_SECONDS;
                    nextDuration = hasValidFallbackFromTotal
                        ? fallbackFromTotal
                        : LEGACY_DEFAULT_MOVIE_DURATION_SECONDS;
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

    /**
     * Show auth screen
     */
    function showAuthScreen() {
        elements.authSection.style.display = 'flex';
        elements.mainApp.style.display = 'none';
    }

    /**
     * Show main app
     */
    function showMainApp(user) {
        elements.authSection.style.display = 'none';
        elements.mainApp.style.display = 'flex';

        if (user) {
            if (user.photoURL) {
                elements.settingsAvatar.src = user.photoURL;
                elements.settingsAvatar.onerror = () => {
                    elements.settingsAvatar.src = 'src/icons/icon48.png';
                };
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

    /**
     * Render anime list
     */
    function renderAnimeList(filter = '') {
        const { AnimeCardRenderer, ProgressManager, SeasonGrouping } = AT;

        // Save expanded state
        const expandedCards = new Set();
        elements.animeList.querySelectorAll('.anime-card.expanded').forEach(card => {
            const slug = card.querySelector('.anime-delete')?.dataset?.slug;
            if (slug) expandedCards.add(slug);
        });

        // Filter by category
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

        // Filter out deleted items for display
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

        // Sort entries
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
                case 'date': return getLatest(slugB, animeB) - getLatest(slugA, animeA);
                case 'name': return animeA.title.localeCompare(animeB.title, 'en');
                case 'episodes': return (animeB.episodes?.length || 0) - (animeA.episodes?.length || 0);
                default: return 0;
            }
        });

        const orderMap = new Map(sortedEntries.map(([slug], index) => [slug, index]));

        const renderGroupedEntries = (entriesToRender) => {
            if (!entriesToRender.length) return '';

            const groups = SeasonGrouping.groupByBase(entriesToRender);
            const groupsArray = Array.from(groups.entries());
            let html = '';

            groupsArray.sort((a, b) => {
                const aFirstSlug = a[1][0].slug;
                const bFirstSlug = b[1][0].slug;
                const aIndex = orderMap.get(aFirstSlug) ?? Number.MAX_SAFE_INTEGER;
                const bIndex = orderMap.get(bFirstSlug) ?? Number.MAX_SAFE_INTEGER;
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
        const completedEntries = sortedEntries.filter(([slug, anime]) => isAgedCompleted(slug, anime));

        const trackedHtml = renderGroupedEntries(normalEntries);
        const completedCardsHtml = renderGroupedEntries(completedEntries);
        const inProgressHtml = inProgressOnly.map(anime => AnimeCardRenderer.createInProgressOnlyCard(anime)).join('');
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

        // Restore expanded state
        elements.animeList.querySelectorAll('.anime-card').forEach(card => {
            const slug = card.querySelector('.anime-delete')?.dataset?.slug;
            if (slug && expandedCards.has(slug)) {
                card.classList.add('expanded');
            }
        });

        // Add event listeners
        setupCardEventListeners();
    }

    /**
     * Setup card event listeners
     */
    function setupCardEventListeners() {
        // In-progress headers - Click on HEADER toggles collapse
        elements.animeList.querySelectorAll('.in-progress-header').forEach(header => {
            const toggleCollapse = (e) => {
                e.stopPropagation();
                const card = header.closest('.anime-card');
                if (card && !card.classList.contains('expanded')) {
                    card.classList.add('expanded');
                }
                header.parentElement.classList.toggle('collapsed');
            };

            // Bind to header (captures title, icon, etc via bubbling)
            header.addEventListener('click', toggleCollapse);

            // Explicitly bind to title just in case of bubbling issues
            const title = header.querySelector('.in-progress-title');
            if (title) title.addEventListener('click', toggleCollapse);
        });

        // Episodes headers
        elements.animeList.querySelectorAll('.episodes-header').forEach(header => {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                const card = header.closest('.anime-card');
                if (card && !card.classList.contains('expanded')) {
                    card.classList.add('expanded');
                }
                header.parentElement.classList.toggle('collapsed');
            });
        });

        // Parts headers (expand/collapse the parts section)
        elements.animeList.querySelectorAll('.parts-header').forEach(header => {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                const card = header.closest('.anime-card');
                if (card && !card.classList.contains('expanded')) {
                    card.classList.add('expanded');
                }
                header.parentElement.classList.toggle('collapsed');
            });
        });

        // Part item headers (expand/collapse individual parts to show episodes)
        elements.animeList.querySelectorAll('.part-item-header').forEach(header => {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                const partItem = header.closest('.part-item');
                if (partItem) {
                    partItem.classList.toggle('expanded');
                }
            });
        });

        // Card headers
        // NOTE: stopPropagation prevents the delegated animeList listener from
        // also toggling the card, which would cause a double-toggle (open then
        // immediately close) when clicking the header or title.
        elements.animeList.querySelectorAll('.anime-card').forEach(card => {
            const header = card.querySelector('.anime-card-header');
            if (header) {
                const toggleCard = (e) => {
                    // Don't toggle if clicking on action buttons
                    if (e.target.closest('.anime-delete') || e.target.closest('.anime-edit-title') || e.target.closest('.anime-fetch-filler')) {
                        return;
                    }
                    e.stopPropagation(); // prevent delegated listener from toggling again
                    card.classList.toggle('expanded');
                };

                // Bind only to the header — the title is a child so it bubbles up here.
                // Binding to both header AND title would fire toggleCard twice per title click.
                header.addEventListener('click', toggleCard);
            }
        });

        // Season group headers
        elements.animeList.querySelectorAll('.anime-season-group').forEach(group => {
            const header = group.querySelector('.season-group-header');
            if (header) {
                const toggleGroup = () => {
                    group.classList.toggle('expanded');
                };
                header.addEventListener('click', toggleGroup);
                // Explicitly bind to title
                const title = header.querySelector('.season-group-name');
                if (title) title.addEventListener('click', (e) => { e.stopPropagation(); toggleGroup(); });
            }
        });

        // Show more fillers
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

        // Show more episodes
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

        // Season item headers (expand/collapse)
        elements.animeList.querySelectorAll('.season-item-header').forEach(header => {
            const toggleSeason = (e) => {
                // Don't toggle if clicking on buttons
                if (e.target.closest('.season-edit-btn') || e.target.closest('.season-delete-btn')) {
                    return;
                }
                e.stopPropagation();
                const seasonItem = header.closest('.season-item');
                if (seasonItem) {
                    seasonItem.classList.toggle('expanded');
                }
            };

            header.addEventListener('click', toggleSeason);

            // Explicitly bind to label/title
            const label = header.querySelector('.season-label');
            if (label) label.addEventListener('click', toggleSeason);
        });

        // Movie group headers
        elements.animeList.querySelectorAll('.anime-movie-group').forEach(group => {
            const header = group.querySelector('.movie-group-header');
            if (header) {
                header.addEventListener('click', () => {
                    group.classList.toggle('expanded');
                });
            }
        });

        // Completed list toggle
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
            // Set initial chevron state (collapsed)
            const chevron = completedToggle.querySelector('.completed-chevron');
            chevron.style.transform = 'rotate(-90deg)';
        }

        // Movie item edit buttons
        elements.animeList.querySelectorAll('.movie-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const slug = btn.dataset.slug;
                editAnimeTitle(slug);
            });
        });

        // Movie item delete buttons
        elements.animeList.querySelectorAll('.movie-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteAnime(btn.dataset.slug);
            });
        });
    }

    /**
     * Update stats
     */
    async function updateStats() {
        const { UIHelpers, SeasonGrouping, Storage } = AT;

        const animeEntries = Object.entries(animeData);

        // Count unique anime (season groups count as 1)
        const groups = SeasonGrouping.groupByBase(animeEntries);
        const totalAnimeCount = groups.size;
        elements.totalAnime.textContent = totalAnimeCount;
        const totalMoviesCount = animeEntries.filter(([slug, anime]) => SeasonGrouping.isMovie(slug, anime)).length;
        if (elements.totalMovies) elements.totalMovies.textContent = totalMoviesCount;

        let totalWatchedEpisodes = 0;
        let totalWatchTime = 0;

        for (const [, anime] of animeEntries) {
            const uniqueEpisodeNumbers = new Set(
                (anime.episodes || [])
                    .map(ep => Number(ep?.number))
                    .filter(n => Number.isFinite(n) && n > 0)
            );
            totalWatchedEpisodes += uniqueEpisodeNumbers.size;
            // Use stored totalWatchTime (pre-calculated, stable) instead of getCanonWatchTime
            // which fluctuates depending on whether filler data has loaded yet
            totalWatchTime += anime.totalWatchTime || 0;
        }

        const totalTimeStr = UIHelpers.formatDurationShort(totalWatchTime);

        elements.totalEpisodes.textContent = totalWatchedEpisodes;
        elements.totalTime.textContent = totalTimeStr;

        // Cache stats to storage to prevent UI jump on next load
        try {
            await Storage.set({
                cachedStats: {
                    totalAnime: totalAnimeCount,
                    totalMovies: totalMoviesCount,
                    totalEpisodes: totalWatchedEpisodes,
                    totalTime: totalTimeStr
                }
            });
        } catch (e) {
            console.error('[Stats] Failed to cache stats:', e);
        }
    }

    /**
     * Load local data
     */
    async function loadData() {
        const { Storage, ProgressManager, FillerService, UIHelpers } = AT;

        try {
            // Load cached stats first for immediate UI update
            const cachedResult = await Storage.get(['cachedStats']);
            if (cachedResult.cachedStats) {
                const stats = cachedResult.cachedStats;
                if (elements.totalAnime) elements.totalAnime.textContent = stats.totalAnime || 0;
                if (elements.totalMovies) elements.totalMovies.textContent = stats.totalMovies || 0;
                if (elements.totalEpisodes) elements.totalEpisodes.textContent = stats.totalEpisodes || 0;
                if (elements.totalTime) elements.totalTime.textContent = stats.totalTime || '0h';
            }

            // Run multi-part anime migration first
            await Storage.migrateMultiPartAnime();

            // Load animeData, videoProgress and groupCoverImages in one call. The
            // extension stores group cover images in chrome.storage.local under
            // the `groupCoverImages` key (see content script). We assign
            // window.AnimeTracker.groupCoverImages here so that the card
            // renderer can use the correct poster for season groups. This call
            // defaults to an empty object when the key is missing, preventing
            // undefined errors.
            const result = await Storage.get(['animeData', 'videoProgress', 'groupCoverImages', 'deletedAnime']);
            const normalized = ProgressManager.normalizeCanonicalSlugs(
                result.animeData || {},
                result.videoProgress || {},
                result.deletedAnime || {}
            );
            animeData = normalized.animeData || {};
            videoProgress = normalized.videoProgress || {};
            // Expose group cover images globally. If the key doesn't exist,
            // default to an empty object. This is read by AnimeCardRenderer
            // when rendering season groups.
            window.AnimeTracker.groupCoverImages = result.groupCoverImages || {};

            const cleanedData = ProgressManager.removeDuplicateEpisodes(animeData);
            const { repairedData, repairedCount } = ProgressManager.repairLikelyMissedEpisodes(cleanedData);
            const rawProgressForDurations = videoProgress || {};
            const { cleaned: cleanedProgress, removedCount: progressRemoved } =
                ProgressManager.cleanTrackedProgress(repairedData, videoProgress);

            const originalCount = UIHelpers.countEpisodes(result.animeData || {});
            const cleanedCount = UIHelpers.countEpisodes(repairedData);
            const durationFix = normalizeMovieDurations(repairedData, rawProgressForDurations);
            const needsSave =
                (originalCount !== cleanedCount) ||
                (progressRemoved > 0) ||
                (repairedCount > 0) ||
                durationFix.changed ||
                normalized.changed;

            if (needsSave) {
                animeData = repairedData;
                videoProgress = cleanedProgress;
                const payload = {
                    animeData: repairedData,
                    videoProgress: cleanedProgress
                };
                if (normalized.changed) {
                    payload.deletedAnime = normalized.deletedAnime || {};
                }
                markInternalSave(payload);
                await Storage.set(payload);
            } else {
                animeData = repairedData;
            }

            await FillerService.loadCachedEpisodeTypes(animeData);
            await AT.AnilistService.loadCachedData(animeData);

            renderAnimeList();
            updateStats();

            // Run auto-fetch immediately (no delay) - re-renders when complete
            FillerService.autoFetchMissing(animeData, () => {
                renderAnimeList(elements.searchInput?.value || '');
                updateStats();
            });

            AT.AnilistService.autoFetchMissing(animeData, () => {
                renderAnimeList(elements.searchInput?.value || '');
                updateStats();
            });
        } catch (e) {
            console.error('[Storage] Load error:', e);
            animeData = {};
            videoProgress = {};
            renderAnimeList();
            updateStats();
        }
    }

    /**
     * Load and sync with cloud
     */
    async function loadAndSyncData() {
        if (loadAndSyncInProgress) return;
        loadAndSyncInProgress = true;

        const { Storage, FirebaseSync, FillerService, ProgressManager } = AT;

        try {
            // Load cached stats first for immediate UI update
            const cachedResult = await Storage.get(['cachedStats']);
            if (cachedResult.cachedStats) {
                const stats = cachedResult.cachedStats;
                if (elements.totalAnime) elements.totalAnime.textContent = stats.totalAnime || 0;
                if (elements.totalMovies) elements.totalMovies.textContent = stats.totalMovies || 0;
                if (elements.totalEpisodes) elements.totalEpisodes.textContent = stats.totalEpisodes || 0;
                if (elements.totalTime) elements.totalTime.textContent = stats.totalTime || '0h';
            }

            // Load user preferences first
            const prefs = await chrome.storage.local.get(['userPreferences']);
            if (prefs.userPreferences) {
                currentSort = prefs.userPreferences.sort || 'date';
                currentCategory = normalizeCategory(prefs.userPreferences.category || 'all');

                // Update UI to reflect saved preferences
                document.querySelectorAll('.sort-option').forEach(o => {
                    o.classList.toggle('active', o.dataset.sort === currentSort);
                });
                if (elements.categoryTabs) {
                    elements.categoryTabs.querySelectorAll('.category-tab').forEach(t => {
                        t.classList.toggle('active', t.dataset.category === currentCategory);
                    });
                }
            }

            // Run multi-part anime migration first
            await Storage.migrateMultiPartAnime();

            const data = await FirebaseSync.loadAndSyncData(elements);
            if (data) {
                const normalized = ProgressManager.normalizeCanonicalSlugs(
                    data.animeData || {},
                    data.videoProgress || {},
                    data.deletedAnime || {}
                );
                const deduped = ProgressManager.removeDuplicateEpisodes(normalized.animeData || {});
                const { repairedData, repairedCount } = ProgressManager.repairLikelyMissedEpisodes(deduped);
                const rawProgressForDurations = normalized.videoProgress || {};
                const { cleaned: cleanedProgress, removedCount: progressRemoved } =
                    ProgressManager.cleanTrackedProgress(repairedData, rawProgressForDurations);
                const durationFix = normalizeMovieDurations(repairedData, rawProgressForDurations);

                animeData = repairedData;
                videoProgress = cleanedProgress;
                // Update global group cover images from synced data
                window.AnimeTracker.groupCoverImages = data.groupCoverImages || {};

                if (repairedCount > 0 || progressRemoved > 0 || durationFix.changed || normalized.changed) {
                    const payload = {
                        animeData: repairedData,
                        videoProgress: cleanedProgress
                    };
                    if (normalized.changed) {
                        payload.deletedAnime = normalized.deletedAnime || {};
                    }
                    markInternalSave(payload);
                    await Storage.set(payload);
                }

                renderAnimeList(elements.searchInput?.value || '');
                updateStats();

                // Run auto-fetch immediately - re-renders when complete
                FillerService.autoFetchMissing(animeData, () => {
                    renderAnimeList(elements.searchInput?.value || '');
                    updateStats();
                });

                AT.AnilistService.autoFetchMissing(animeData, () => {
                    renderAnimeList(elements.searchInput?.value || '');
                    updateStats();
                });
            }
        } catch (error) {
            console.error('[Sync] Error:', error);
            loadData();
        } finally {
            loadAndSyncInProgress = false;
        }
    }

    /**
     * Delete episode progress
     */
    async function deleteProgress(slug, episodeNumber) {
        const { Storage, FirebaseSync } = AT;

        const uniqueId = `${slug}__episode-${episodeNumber}`;

        try {
            const result = await Storage.get(['videoProgress']);
            const currentVideoProgress = result.videoProgress || {};

            if (currentVideoProgress[uniqueId]) {
                // Soft delete: mark as deleted instead of removing
                currentVideoProgress[uniqueId] = {
                    ...currentVideoProgress[uniqueId],
                    deleted: true,
                    deletedAt: new Date().toISOString()
                };

                videoProgress = currentVideoProgress;

                const dataToSave = { videoProgress: currentVideoProgress };
                const user = FirebaseSync.getUser();
                if (user) {
                    dataToSave.userId = user.uid;
                }

                // Save locally first
                markInternalSave(dataToSave);
                await Storage.set(dataToSave);

            // Then force cloud sync (include group covers)
            if (user) {
                // Force immediate save, passing proper data
                console.log('[DeleteProgress] Syncing deletion to cloud...');
                try {
                    // Fetch groupCoverImages so we can sync posters
                    const gcResult = await Storage.get(['groupCoverImages']);
                    await FirebaseSync.saveToCloud({
                        animeData: animeData,
                        videoProgress: currentVideoProgress,
                        groupCoverImages: gcResult.groupCoverImages || {}
                    }, true); // true = immediate
                } catch (syncErr) {
                    console.error('[DeleteProgress] Cloud sync failed:', syncErr);
                }
            }

                renderAnimeList(elements.searchInput?.value || '');
                console.log(`[DeleteProgress] Soft deleted progress for ${slug} Ep${episodeNumber}`);
            }
        } catch (e) {
            console.error('[DeleteProgress] Error:', e);
            alert('Failed to delete progress. Please try again.');
        }
    }

    /**
     * Delete anime
     */
    async function deleteAnime(slug) {
        const { Storage, FirebaseSync } = AT;

        // Track whether anime existed BEFORE deleting from memory
        const wasInAnimeData = !!animeData[slug];

        // Remove from animeData if it exists
        if (wasInAnimeData) {
            delete animeData[slug];
        } else {
            console.log('[Delete] Anime not in local list, checking progress only:', slug);
        }

        try {
            // Retrieve video progress, deleted anime logs and group covers
            const result = await Storage.get(['videoProgress', 'deletedAnime', 'groupCoverImages']);
            const currentVideoProgress = result.videoProgress || {};

            let progressDeleted = 0;
            const progressPrefix = slug + '__episode-';
            for (const id of Object.keys(currentVideoProgress)) {
                if (id.startsWith(progressPrefix)) {
                    delete currentVideoProgress[id];
                    progressDeleted++;
                }
            }

            // Use wasInAnimeData (captured before deletion) so this check is correct
            if (progressDeleted === 0 && !wasInAnimeData) {
                console.warn('[Delete] No data found to delete for:', slug);
                return;
            }

            videoProgress = currentVideoProgress;

            // Record deletion with timestamp so other devices respect it during merge
            const deletedAnime = result.deletedAnime || {};
            deletedAnime[slug] = { deletedAt: new Date().toISOString() };

            const dataToSave = { animeData, videoProgress: currentVideoProgress, deletedAnime };
            const user = FirebaseSync.getUser();
            if (user) {
                dataToSave.userId = user.uid;
            }

            markInternalSave(dataToSave);
            await Storage.set(dataToSave);

            if (user) {
                // Fetch group covers to sync posters
                const gcResult = await Storage.get(['groupCoverImages']);
                await FirebaseSync.saveToCloud({
                    animeData,
                    videoProgress: currentVideoProgress,
                    deletedAnime,
                    groupCoverImages: gcResult.groupCoverImages || {}
                }, true);
            }

            renderAnimeList(elements.searchInput?.value || '');
            updateStats();
        } catch (e) {
            console.error('[Delete] Error:', e);
            alert('Failed to delete anime. Please try again.');
        }
    }

    /**
     * Clear all data
     */
    async function clearAllData() {
        const { Storage, FirebaseSync } = AT;

        const dataToSave = {
            animeData: {},
            videoProgress: {},
            groupCoverImages: {}
        };

        const user = FirebaseSync.getUser();
        if (user) {
            dataToSave.userId = user.uid;
        }

        markInternalSave(dataToSave);
        await Storage.set(dataToSave);

        if (user) {
            // Fix: Use immediate save
            await FirebaseSync.saveToCloud({ animeData: {}, videoProgress: {}, groupCoverImages: {} }, true);
        }

        animeData = {};
        videoProgress = {};
        renderAnimeList();
        updateStats();
        hideDialog();
    }

    function showDialog() { elements.confirmDialog.classList.add('visible'); }
    function hideDialog() { elements.confirmDialog.classList.remove('visible'); }

    /**
     * Show add anime dialog
     */
    function showAddAnimeDialog() {
        // Reset form
        elements.animeSlugInput.value = '';
        elements.animeTitleInput.value = '';
        elements.episodesWatchedInput.value = '';
        elements.animeSlugInput.classList.remove('error');
        elements.episodesWatchedInput.classList.remove('error');
        updateEpisodesPreview('');

        elements.addAnimeDialog.classList.add('visible');
        elements.animeSlugInput.focus();
    }

    /**
     * Hide add anime dialog
     */
    function hideAddAnimeDialog() {
        elements.addAnimeDialog.classList.remove('visible');
    }

    /**
     * Build compact range string from sorted episode numbers
     */
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

    /**
     * Split episodes into canon and filler arrays for a given slug.
     */
    function splitCanonAndFillers(slug, episodeNumbers) {
        const { FillerService } = window.AnimeTracker;
        if (!slug || !FillerService || !FillerService.hasFillerData(slug)) {
            return { canon: episodeNumbers, fillers: [] };
        }
        const canon = [];
        const fillers = [];
        for (const n of episodeNumbers) {
            if (FillerService.isFillerEpisode(slug, n)) {
                fillers.push(n);
            } else {
                canon.push(n);
            }
        }
        return { canon, fillers };
    }

    /**
     * Update the live episodes preview below the input
     */
    function updateEpisodesPreview(input) {
        const preview = document.getElementById('episodesPreview');
        if (!preview) return;

        if (!input || !input.trim()) {
            preview.innerHTML = '';
            preview.className = 'episodes-preview';
            return;
        }

        const allEpisodes = parseEpisodeRanges(input);

        if (allEpisodes.length === 0) {
            preview.innerHTML = '<span class="preview-error">⚠ Δεν βρέθηκαν έγκυρα επεισόδια</span>';
            preview.className = 'episodes-preview preview-visible preview-error-state';
            return;
        }

        // Get slug to filter known fillers
        const slugRaw = elements.animeSlugInput ? elements.animeSlugInput.value : '';
        const slug = extractSlugFromInput(slugRaw);
        const { canon, fillers } = splitCanonAndFillers(slug, allEpisodes);

        const rangeStr = buildRangeString(canon);
        const total = canon.length;

        let html = `<span class="preview-ok">✓ ${total} επεισόδια: <strong>${rangeStr}</strong></span>`;
        if (fillers.length > 0) {
            const fillerStr = buildRangeString(fillers);
            html += `<br><span class="preview-fillers">⏭ ${fillers.length} fillers αφαιρέθηκαν αυτόματα: ${fillerStr}</span>`;
        }

        preview.innerHTML = html;
        preview.className = 'episodes-preview preview-visible';
    }

    /**
     * Parse episode ranges from user input
     * Supports: "1", "30", "1-30", "1-30, 50-60", "1-30, 50-60, 70"
     * Returns a sorted array of unique episode numbers
     */
    function parseEpisodeRanges(input) {
        if (!input || !input.trim()) return [];

        const episodeNumbers = new Set();
        // Split by comma or semicolon
        const parts = input.split(/[,;]+/).map(p => p.trim()).filter(Boolean);

        for (const part of parts) {
            const rangeMatch = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
            const singleMatch = part.match(/^(\d+)$/);

            if (rangeMatch) {
                const start = parseInt(rangeMatch[1], 10);
                const end = parseInt(rangeMatch[2], 10);
                if (start > 0 && end >= start) {
                    for (let i = start; i <= end; i++) {
                        episodeNumbers.add(i);
                    }
                }
            } else if (singleMatch) {
                const num = parseInt(singleMatch[1], 10);
                if (num > 0) episodeNumbers.add(num);
            }
        }

        return Array.from(episodeNumbers).sort((a, b) => a - b);
    }

    /**
     * Extract slug from URL or return as-is
     */
    function extractSlugFromInput(input) {
        if (!input) return null;

        input = input.trim();
        const normalizeSlug = (slug) => slug
            .toLowerCase()
            .replace(/-episode-\d+$/i, '')
            .replace(/-(?:episodes?|ep)$/i, '')
            .replace(/-+$/g, '');

        // Check if it's a watch URL with episode (e.g., /watch/black-clover-episode-170/)
        const watchEpisodePattern = /\/watch\/([a-zA-Z0-9-]+)-episode-\d+/i;
        const watchMatch = input.match(watchEpisodePattern);
        if (watchMatch) {
            return normalizeSlug(watchMatch[1]);
        }

        // Check if it's an anime URL (e.g., /anime/black-clover)
        const animePattern = /\/anime\/([a-zA-Z0-9-]+)/i;
        const animeMatch = input.match(animePattern);
        if (animeMatch) {
            return normalizeSlug(animeMatch[1]);
        }

        // Check if it's a watch URL without episode
        const watchPattern = /\/watch\/([a-zA-Z0-9-]+)/i;
        const watchOnlyMatch = input.match(watchPattern);
        if (watchOnlyMatch) {
            return normalizeSlug(watchOnlyMatch[1]);
        }

        // Otherwise treat as slug directly - convert to lowercase and replace spaces with dashes
        return normalizeSlug(input.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''));
    }

    /**
     * Generate title from slug
     */
    function generateTitleFromSlug(slug) {
        return slug
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    /**
     * Add anime with watched episodes
     */
    async function addAnimeWithEpisodes() {
        const { Storage, FirebaseSync, SeasonGrouping } = AT;

        // Get and validate inputs
        const slugInput = elements.animeSlugInput.value;
        const slug = extractSlugFromInput(slugInput);
        const title = elements.animeTitleInput.value.trim() || generateTitleFromSlug(slug);
        const episodesRawInput = elements.episodesWatchedInput.value.trim();

        // Validate slug
        if (!slug) {
            elements.animeSlugInput.classList.add('error');
            elements.animeSlugInput.focus();
            return;
        }
        elements.animeSlugInput.classList.remove('error');

        // Validate episodes input
        if (!episodesRawInput) {
            elements.episodesWatchedInput.classList.add('error');
            elements.episodesWatchedInput.focus();
            return;
        }

        // Parse episode ranges (e.g. "1-56, 72-90, 113-122" or just "73")
        const allParsedEpisodes = parseEpisodeRanges(episodesRawInput);
        // Auto-exclude known fillers for this slug
        const { canon: episodeNumbers, fillers: excludedFillers } = splitCanonAndFillers(slug, allParsedEpisodes);
        if (excludedFillers.length > 0) {
            console.log(`[AddAnime] Auto-excluded ${excludedFillers.length} filler episodes for ${slug}:`, excludedFillers);
        }

        if (episodeNumbers.length === 0) {
            elements.episodesWatchedInput.classList.add('error');
            elements.episodesWatchedInput.focus();
            return;
        }
        elements.episodesWatchedInput.classList.remove('error');

        // Disable button during save
        elements.confirmAddAnime.disabled = true;
        elements.confirmAddAnime.textContent = 'Adding...';

        try {
            const now = new Date().toISOString();

            // Determine duration based on content type
            // Movies: keep unknown duration (0) until real video metadata is captured by tracker.
            const isMovie = SeasonGrouping.isMovie(slug, { title });
            const defaultDuration = isMovie ? 0 : 1440;

            // Build episodes array from parsed numbers
            const episodes = episodeNumbers.map(num => ({
                number: num,
                duration: defaultDuration,
                watchedAt: now
            }));

            // Check if anime already exists and merge episodes
            if (animeData[slug]) {
                const existingEpisodes = animeData[slug].episodes || [];
                const existingNumbers = new Set(existingEpisodes.map(ep => ep.number));

                // Add only new episodes
                for (const ep of episodes) {
                    if (!existingNumbers.has(ep.number)) {
                        existingEpisodes.push(ep);
                    }
                }

                existingEpisodes.sort((a, b) => a.number - b.number);

                animeData[slug].episodes = existingEpisodes;
                animeData[slug].totalWatchTime = existingEpisodes.reduce((sum, ep) => sum + (ep.duration || 0), 0);
                animeData[slug].lastWatched = now;
            } else {
                // Create new anime entry
                animeData[slug] = {
                    title: title,
                    slug: slug,
                    episodes: episodes,
                    totalWatchTime: episodes.reduce((sum, ep) => sum + (ep.duration || 0), 0),
                    lastWatched: now,
                    totalEpisodes: null
                };
            }

            // Save to local storage
            const dataToSave = { animeData, videoProgress };
            const user = FirebaseSync.getUser();
            if (user) {
                dataToSave.userId = user.uid;
            }

            markInternalSave(dataToSave);
            await Storage.set(dataToSave);

            // Update UI immediately
            renderAnimeList(elements.searchInput?.value || '');
            updateStats();

            // Close dialog
            hideAddAnimeDialog();

            console.log(`[AddAnime] Added ${slug} with ${episodes.length} episodes`);

            // Save to cloud in background (don't wait)
            if (user) {
                (async () => {
                    // Include group covers
                    const gcRes = await Storage.get(['groupCoverImages']);
                    await FirebaseSync.saveToCloud({
                        animeData,
                        videoProgress,
                        groupCoverImages: gcRes.groupCoverImages || {}
                    });
                })().catch(err => {
                    console.error('[AddAnime] Cloud save error:', err);
                });
            }
        } catch (error) {
            console.error('[AddAnime] Error:', error);
            alert('Failed to add anime. Please try again.');
        } finally {
            elements.confirmAddAnime.disabled = false;
            elements.confirmAddAnime.textContent = 'Add Anime';
        }
    }

    /**
     * Show edit title dialog
     */
    function showEditTitleDialog(slug) {
        if (!animeData[slug]) {
            console.warn('[EditTitle] Anime not found:', slug);
            return;
        }

        editingSlug = slug;
        const currentTitle = animeData[slug].title || '';
        elements.editTitleInput.value = currentTitle;
        elements.editTitleDialog.classList.add('visible');
        elements.editTitleInput.focus();
        elements.editTitleInput.select();
    }

    /**
     * Hide edit title dialog
     */
    function hideEditTitleDialog() {
        elements.editTitleDialog.classList.remove('visible');
        editingSlug = null;
    }

    /**
     * Save edited title
     */
    async function saveEditedTitle() {
        const { Storage, FirebaseSync } = AT;

        if (!editingSlug || !animeData[editingSlug]) {
            hideEditTitleDialog();
            return;
        }

        const newTitle = elements.editTitleInput.value.trim();
        const currentTitle = animeData[editingSlug].title || '';

        if (newTitle === '' || newTitle === currentTitle) {
            hideEditTitleDialog();
            return;
        }

        try {
            animeData[editingSlug].title = newTitle;

            // Save to local storage
            const dataToSave = { animeData, videoProgress };
            const user = FirebaseSync.getUser();
            if (user) {
                dataToSave.userId = user.uid;
            }

            markInternalSave(dataToSave);
            await Storage.set(dataToSave);

            // Update UI
            renderAnimeList(elements.searchInput?.value || '');

            console.log(`[EditTitle] Updated title for ${editingSlug}: "${newTitle}"`);

            // Save to cloud in background
            if (user) {
                (async () => {
                    // Include group covers
                    const gcRes = await Storage.get(['groupCoverImages']);
                    await FirebaseSync.saveToCloud({
                        animeData,
                        videoProgress,
                        groupCoverImages: gcRes.groupCoverImages || {}
                    });
                })().catch(err => {
                    console.error('[EditTitle] Cloud save error:', err);
                });
            }

            hideEditTitleDialog();
        } catch (error) {
            console.error('[EditTitle] Error:', error);
            alert('Failed to update title. Please try again.');
        }
    }

    /**
     * Edit anime title (show dialog)
     */
    function editAnimeTitle(slug) {
        showEditTitleDialog(slug);
    }

    /**
     * Fetch filler data for a single anime (called from card button)
     */
    async function fetchFillerForAnime(slug, btn) {
        const { FillerService } = AT;

        if (btn) {
            btn.disabled = true;
            btn.textContent = '...';
        }

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
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🎭';
            }
        }
    }

    /**
     * Fetch filler data for all anime
     */
    async function fetchAllFillers() {
        const { FillerFetchUI } = AT;

        // Set callback to update UI after fetch completes
        FillerFetchUI.onComplete = () => {
            renderAnimeList(elements.searchInput?.value || '');
            updateStats();
        };

        // Open the custom UI modal
        await FillerFetchUI.open();
    }

    /**
     * Sign in with Google
     */
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

    /**
     * Sign out
     */
    async function signOut() {
        const { Storage, FirebaseSync } = AT;

        animeData = {};
        videoProgress = {};

        await Storage.set({
            animeData: {},
            videoProgress: {}
        });

        await FirebaseSync.signOut();

        renderAnimeList();
        updateStats();
    }

    /**
     * Initialize event listeners
     */
    function initEventListeners() {
        const { CONFIG, DONATE_LINKS, FirebaseSync } = AT;

        // Auth
        if (elements.googleSignIn) {
            elements.googleSignIn.addEventListener('click', signInWithGoogle);
        }

        // Collapsible advanced options
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
                try { localStorage.setItem('authAdvancedExpanded', isExpanded); } catch {
                    // Ignore localStorage failures in restricted/private contexts.
                }
            });
            try {
                const wasExpanded = localStorage.getItem('authAdvancedExpanded') === 'true';
                if (wasExpanded) toggleTokenMode(true);
            } catch {
                // Ignore localStorage failures in restricted/private contexts.
            }
        }
        // Token import sign in
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

        // Export Token button (in settings, shown when logged in)
        const exportTokenBtn = document.getElementById('settingsExportToken');
        if (exportTokenBtn) {
            exportTokenBtn.addEventListener('click', async () => {
                elements.settingsDropdown?.classList.remove('visible');
                try {
                    const tokenData = await FirebaseLib.exportSessionToken();
                    const tokenStr = JSON.stringify(tokenData);

                    // Show overlay with token
                    const overlay = document.createElement('div');
                    overlay.className = 'export-token-overlay';
                    overlay.innerHTML = `
                        <div class="export-token-box">
                            <h3>🔑 Export Token</h3>
                            <p>Copy this token and paste it in the <strong>Import</strong> tab on Orion/Safari. Valid for ~1 hour.</p>
                            <textarea class="export-token-text" readonly>${tokenStr}</textarea>
                            <div class="export-token-actions">
                                <button class="btn-copy-token">Copy Token</button>
                                <button class="btn-close-token">Close</button>
                            </div>
                        </div>
                    `;

                    overlay.querySelector('.btn-copy-token').addEventListener('click', async () => {
                        try {
                            await navigator.clipboard.writeText(tokenStr);
                            overlay.querySelector('.btn-copy-token').textContent = '✓ Copied!';
                        } catch {
                            // Fallback: select all
                            overlay.querySelector('.export-token-text').select();
                        }
                    });

                    overlay.querySelector('.btn-close-token').addEventListener('click', () => overlay.remove());
                    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

                    document.body.appendChild(overlay);
                    // Auto-select text
                    setTimeout(() => overlay.querySelector('.export-token-text')?.select(), 50);
                } catch (err) {
                    alert('Export failed: ' + err.message);
                }
            });
        }

        // Settings Menu
        if (elements.settingsBtn) {
            elements.settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (elements.donateDropdown) {
                    elements.donateDropdown.classList.remove('visible');
                }
                if (elements.sortDropdown) {
                    elements.sortDropdown.classList.remove('visible');
                }
                if (elements.sortBtn) {
                    elements.sortBtn.classList.remove('active');
                }
                elements.settingsDropdown.classList.toggle('visible');
            });
        }

        document.addEventListener('click', (e) => {
            if (elements.settingsDropdown && elements.settingsBtn &&
                !elements.settingsDropdown.contains(e.target) &&
                !elements.settingsBtn.contains(e.target)) {
                elements.settingsDropdown.classList.remove('visible');
            }

            if (elements.donateDropdown &&
                !elements.donateDropdown.contains(e.target) &&
                (!elements.settingsDonate || !elements.settingsDonate.contains(e.target))) {
                elements.donateDropdown.classList.remove('visible');
            }
        });

        // Settings Items
        if (elements.settingsDonate) {
            elements.settingsDonate.addEventListener('click', (e) => {
                e.stopPropagation();
                elements.settingsDropdown.classList.remove('visible');
                setTimeout(() => {
                    elements.donateDropdown.classList.add('visible');
                }, 150);
            });
        }

        if (elements.settingsRefresh) {
            elements.settingsRefresh.addEventListener('click', async () => {
                elements.settingsRefresh.classList.add('loading');
                elements.settingsDropdown.classList.remove('visible');

                if (FirebaseSync.getUser()) {
                    await loadAndSyncData();
                } else {
                    loadData();
                }

                setTimeout(() => elements.settingsRefresh.classList.remove('loading'), 500);
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

        // Search
        if (elements.searchInput) {
            let searchTimeout = null;
            elements.searchInput.addEventListener('input', (e) => {
                if (searchTimeout) clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    renderAnimeList(e.target.value);
                }, CONFIG.SEARCH_DEBOUNCE_MS);
            });
        }

        // Clear Confirmation
        if (elements.confirmClear) {
            elements.confirmClear.addEventListener('click', clearAllData);
        }
        if (elements.cancelClear) {
            elements.cancelClear.addEventListener('click', hideDialog);
        }
        if (elements.confirmDialog) {
            elements.confirmDialog.addEventListener('click', (e) => {
                if (e.target === elements.confirmDialog) hideDialog();
            });
        }

        // Add Anime Dialog
        if (elements.addAnimeBtn) {
            elements.addAnimeBtn.addEventListener('click', showAddAnimeDialog);
        }
        if (elements.closeAddAnime) {
            elements.closeAddAnime.addEventListener('click', hideAddAnimeDialog);
        }
        if (elements.cancelAddAnime) {
            elements.cancelAddAnime.addEventListener('click', hideAddAnimeDialog);
        }
        if (elements.confirmAddAnime) {
            elements.confirmAddAnime.addEventListener('click', addAnimeWithEpisodes);
        }
        if (elements.addAnimeDialog) {
            elements.addAnimeDialog.addEventListener('click', (e) => {
                if (e.target === elements.addAnimeDialog) hideAddAnimeDialog();
            });
        }
        // Handle Enter key in add anime form
        if (elements.animeSlugInput) {
            // Re-run preview when slug changes (filler data might now be available)
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
            elements.episodesWatchedInput.addEventListener('input', (e) => {
                updateEpisodesPreview(e.target.value);
            });
            elements.episodesWatchedInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') addAnimeWithEpisodes();
            });
        }

        // Edit Title Dialog
        if (elements.closeEditTitle) {
            elements.closeEditTitle.addEventListener('click', hideEditTitleDialog);
        }
        if (elements.cancelEditTitle) {
            elements.cancelEditTitle.addEventListener('click', hideEditTitleDialog);
        }
        if (elements.confirmEditTitle) {
            elements.confirmEditTitle.addEventListener('click', saveEditedTitle);
        }
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

        // Donate buttons
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

        // Sort
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
                if (elements.searchInput) {
                    renderAnimeList(elements.searchInput.value);
                }
                if (elements.sortDropdown) elements.sortDropdown.classList.remove('visible');
                if (elements.sortBtn) elements.sortBtn.classList.remove('active');
                // Save sort preference
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

        // Category tabs
        if (elements.categoryTabs) {
            elements.categoryTabs.querySelectorAll('.category-tab').forEach(tab => {
                tab.addEventListener('click', async () => {
                    currentCategory = tab.dataset.category;
                    currentCategory = normalizeCategory(currentCategory);
                    elements.categoryTabs.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    if (elements.searchInput) {
                        renderAnimeList(elements.searchInput.value);
                    }
                    // Save category preference
                    await chrome.storage.local.set({ userPreferences: { sort: currentSort, category: currentCategory } });
                });
            });
        }

        // Storage changes
        // Automatically reacts to updates written by the background SW
        // (e.g. real-time cloud sync from another device) — no manual refresh needed.
        let storageUpdateTimeout = null;

        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local') return;
            // Distinguish own writes from external updates via the '__writeToken' key.
            // isOwnStorageChange inspects the full changes batch once so we avoid
            // repeated per-key JSON.stringify comparisons (which depend on V8 key order).
            let needsUpdate = false;
            const isOwn = isOwnStorageChange(changes);
            let isExternalUpdate = false;

            if (changes.animeData) {
                // Always update local animeData and re-render when animeData changes.
                animeData = changes.animeData.newValue || {};
                needsUpdate = true;
                if (!isOwn) isExternalUpdate = true;
            }
            if (changes.videoProgress) {
                videoProgress = changes.videoProgress.newValue || {};
                needsUpdate = true;
                if (!isOwn) isExternalUpdate = true;
            }

            // Detect changes in group cover images. When posters are updated
            // (e.g. another device added a new group cover), update the global
            // cache and re-render.
            if (changes.groupCoverImages) {
                window.AnimeTracker.groupCoverImages = changes.groupCoverImages.newValue || {};
                needsUpdate = true;
                if (!isOwn) isExternalUpdate = true;
            }

            if (needsUpdate) {
                if (storageUpdateTimeout) clearTimeout(storageUpdateTimeout);

                storageUpdateTimeout = setTimeout(async () => {
                    renderAnimeList(elements.searchInput?.value || '');
                    updateStats();

                    // Flash sync indicator when update arrived from another device
                    if (isExternalUpdate && elements.syncStatus && elements.syncText) {
                        elements.syncStatus.classList.add('synced');
                        elements.syncText.textContent = 'Synced ✓';
                        setTimeout(() => {
                            elements.syncText.textContent = 'Cloud Synced';
                        }, 2500);
                    }

                }, CONFIG.STORAGE_UPDATE_DEBOUNCE_MS);
            }
        });

        // Event delegation for anime list (dynamic elements)
        if (elements.animeList) {
            elements.animeList.addEventListener('click', async (e) => {
                const target = e.target;

                // Delete progress button
                if (target.classList.contains('progress-delete-btn') || target.closest('.progress-delete-btn')) {
                    const btn = target.classList.contains('progress-delete-btn') ? target : target.closest('.progress-delete-btn');
                    const slug = btn.dataset.slug;
                    const episodeNum = parseInt(btn.dataset.episode, 10);

                    if (slug && episodeNum) {
                        await deleteProgress(slug, episodeNum);
                    }
                    return;
                }

                // Delete anime button
                if (target.classList.contains('anime-delete') || target.closest('.anime-delete')) {
                    const btn = target.classList.contains('anime-delete') ? target : target.closest('.anime-delete');
                    const slug = btn.dataset.slug;
                    if (slug) {
                        deleteAnime(slug);
                    }
                    return;
                }

                // Edit title button
                if (target.classList.contains('anime-edit-title') || target.closest('.anime-edit-title')) {
                    const btn = target.classList.contains('anime-edit-title') ? target : target.closest('.anime-edit-title');
                    const slug = btn.dataset.slug;
                    if (slug) {
                        editAnimeTitle(slug);
                    }
                    return;
                }

                // Season item edit button
                if (target.classList.contains('season-edit-btn') || target.closest('.season-edit-btn')) {
                    const btn = target.classList.contains('season-edit-btn') ? target : target.closest('.season-edit-btn');
                    const slug = btn.dataset.slug;
                    if (slug) editAnimeTitle(slug);
                    return;
                }

                // Season item delete button
                if (target.classList.contains('season-delete-btn') || target.closest('.season-delete-btn')) {
                    const btn = target.classList.contains('season-delete-btn') ? target : target.closest('.season-delete-btn');
                    const slug = btn.dataset.slug;
                    if (slug) deleteAnime(slug);
                    return;
                }

                // Fetch filler button
                if (target.classList.contains('anime-fetch-filler') || target.closest('.anime-fetch-filler')) {
                    const btn = target.classList.contains('anime-fetch-filler') ? target : target.closest('.anime-fetch-filler');
                    const slug = btn.dataset.slug;
                    if (slug && !btn.disabled) {
                        await fetchFillerForAnime(slug, btn);
                    }
                    return;
                }

                // Expand/collapse card
                const card = target.closest('.anime-card');
                if (card && !target.closest('button') && !target.closest('.anime-card-actions')) {
                    card.classList.toggle('expanded');
                    return;
                }

                // Collapse in-progress section
                const inProgressHeader = target.closest('.in-progress-header');
                if (inProgressHeader) {
                    const section = inProgressHeader.closest('.anime-in-progress');
                    if (section) {
                        section.classList.toggle('collapsed');
                    }
                    return;
                }

                // Collapse episodes section
                const episodesHeader = target.closest('.episodes-header');
                if (episodesHeader) {
                    const section = episodesHeader.closest('.anime-episodes');
                    if (section) {
                        section.classList.toggle('collapsed');
                    }
                    return;
                }
            });
        }
    }

    /**
     * Ask the background SW if it has a live stream. If not (SW was asleep),
     * the caller should trigger a direct cloud pull to avoid showing stale data.
     */
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

    /**
     * Initialize
     */
    async function init() {
        const { FirebaseSync, Storage, FillerFetchUI } = AT;

        // Initialize Filler Fetch UI
        FillerFetchUI.init();

        // Load cached stats immediately (before anything else)
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

        // Display version dynamically from manifest
        try {
            const manifest = chrome.runtime.getManifest();
            if (elements.versionText && manifest?.version) {
                elements.versionText.textContent = `Anime Tracker v${manifest.version}`;
            }
        } catch (e) {
            console.warn('[Version] Could not load manifest version:', e);
        }

        initEventListeners();

        // Initialize Firebase
        FirebaseSync.init({
            onUserSignedIn: async (user) => {
                showMainApp(user);
                // If the background SW was asleep (no live stream), ping it to
                // wake up and reconnect, then load data directly from the cloud.
                // This prevents the popup from showing stale data when it's
                // opened after a period of inactivity.
                const bgAlive = await checkBackgroundAlive();
                if (!bgAlive) {
                    console.log('[Popup] SW was asleep, sending wake-up sync signal');
                    try { chrome.runtime.sendMessage({ type: 'SYNC_TO_FIREBASE' }); } catch {
                        // Fire-and-forget wake-up; ignore if runtime is not reachable.
                    }
                }
                loadAndSyncData();
            },
            onUserSignedOut: () => {
                showAuthScreen();
            },
            onError: () => {
                showMainApp(null);
                loadData();
            }
        });
    }

    // Cleanup handlers
    window.addEventListener('beforeunload', () => {
        AT.FirebaseSync.cleanup();
    });

    document.addEventListener('visibilitychange', async () => {
        if (document.hidden) {
            AT.FirebaseSync.cleanup();
        }
    });

    // Start
    init();

})();




