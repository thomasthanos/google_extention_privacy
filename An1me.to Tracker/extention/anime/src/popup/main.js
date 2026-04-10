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
    const COPY_GUARD_STORAGE_KEY = 'copyGuardEnabled';

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
        settingsRefreshInfo: document.getElementById('settingsRefreshInfo'),
        settingsCopyGuard: document.getElementById('settingsCopyGuard'),
        settingsCopyGuardSubtitle: document.getElementById('settingsCopyGuardSubtitle'),
        settingsDataTools: document.getElementById('settingsDataTools'),
        settingsDataToolsToggle: document.getElementById('settingsDataToolsToggle'),
        settingsDataToolsContent: document.getElementById('settingsDataToolsContent'),
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
        settingsSmartNotif: document.getElementById('settingsSmartNotif'),
        settingsSmartNotifSubtitle: document.getElementById('settingsSmartNotifSubtitle'),
        settingsAutoSkipFiller: document.getElementById('settingsAutoSkipFiller'),
        settingsAutoSkipFillerSubtitle: document.getElementById('settingsAutoSkipFillerSubtitle'),
        settingsPreferences: document.getElementById('settingsPreferences'),
        settingsPreferencesToggle: document.getElementById('settingsPreferencesToggle'),
        settingsPreferencesContent: document.getElementById('settingsPreferencesContent'),
        // Add Anime Dialog
        addAnimeBtn: document.getElementById('addAnimeBtn'),
        addAnimeDialog: document.getElementById('addAnimeDialog'),
        closeAddAnime: document.getElementById('closeAddAnime'),
        cancelAddAnime: document.getElementById('cancelAddAnime'),
        confirmAddAnime: document.getElementById('confirmAddAnime'),
        animeSlugInput: document.getElementById('animeSlug'),
        animeTitleInput: document.getElementById('animeTitle'),
        episodesWatchedInput: document.getElementById('episodesWatched'),
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
    let pendingAutoRepairAfterSignIn = false;
    let metadataRepairPromise = null;
    let lastMetadataRepairState = null;
    let metadataRepairStatusResetTimer = null;

    const OWN_WRITE_TTL_MS = 15000;
    const ownWriteTokens = new Set();
    let deferredListRefresh = null;

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

    function sendRuntimeMessage(message, timeoutMs = 30000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Runtime message timeout')), timeoutMs);
            chrome.runtime.sendMessage(message, (response) => {
                clearTimeout(timer);
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(response);
            });
        });
    }

    function getActiveFilter() {
        return elements.searchInput?.value || '';
    }

    function renderCopyGuardSetting(enabled) {
        if (!elements.settingsCopyGuard) return;
        elements.settingsCopyGuard.dataset.enabled = enabled ? 'true' : 'false';
        elements.settingsCopyGuard.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        if (elements.settingsCopyGuardSubtitle) {
            elements.settingsCopyGuardSubtitle.textContent = enabled
                ? 'Block copy outside allowed text'
                : 'Copy protection is turned off';
        }
    }

    async function loadCopyGuardSetting() {
        try {
            const result = await chrome.storage.local.get([COPY_GUARD_STORAGE_KEY]);
            const enabled = result[COPY_GUARD_STORAGE_KEY] !== false;
            renderCopyGuardSetting(enabled);
            return enabled;
        } catch (error) {
            PopupLogger.warn('Settings', 'Failed to load copy guard setting:', error);
            renderCopyGuardSetting(true);
            return true;
        }
    }

    // ── Smart Notifications setting ──
    const SMART_NOTIF_STORAGE_KEY = 'smartNotificationsEnabled';

    function renderSmartNotifSetting(enabled) {
        if (!elements.settingsSmartNotif) return;
        elements.settingsSmartNotif.dataset.enabled = enabled ? 'true' : 'false';
        elements.settingsSmartNotif.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        if (elements.settingsSmartNotifSubtitle) {
            elements.settingsSmartNotifSubtitle.textContent = enabled
                ? 'You will be notified of new episodes'
                : 'Notify when new episodes drop';
        }
    }

    async function loadSmartNotifSetting() {
        try {
            const result = await chrome.storage.local.get([SMART_NOTIF_STORAGE_KEY]);
            const enabled = result[SMART_NOTIF_STORAGE_KEY] === true;
            renderSmartNotifSetting(enabled);
            return enabled;
        } catch (error) {
            PopupLogger.warn('Settings', 'Failed to load smart notif setting:', error);
            renderSmartNotifSetting(false);
            return false;
        }
    }

    // ── Auto-Skip Fillers setting ──
    const AUTO_SKIP_FILLER_STORAGE_KEY = 'autoSkipFillers';

    function renderAutoSkipFillerSetting(enabled) {
        if (!elements.settingsAutoSkipFiller) return;
        elements.settingsAutoSkipFiller.dataset.enabled = enabled ? 'true' : 'false';
        elements.settingsAutoSkipFiller.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        if (elements.settingsAutoSkipFillerSubtitle) {
            elements.settingsAutoSkipFillerSubtitle.textContent = enabled
                ? 'Filler episodes will be auto-skipped'
                : 'Skip filler, jump to next canon ep';
        }
    }

    async function loadAutoSkipFillerSetting() {
        try {
            const result = await chrome.storage.local.get([AUTO_SKIP_FILLER_STORAGE_KEY]);
            const enabled = result[AUTO_SKIP_FILLER_STORAGE_KEY] === true;
            renderAutoSkipFillerSetting(enabled);
            return enabled;
        } catch (error) {
            PopupLogger.warn('Settings', 'Failed to load auto-skip filler setting:', error);
            renderAutoSkipFillerSetting(false);
            return false;
        }
    }

    function setSettingsDataToolsExpanded(expanded) {
        if (!elements.settingsDataTools || !elements.settingsDataToolsToggle) return;
        const isExpanded = !!expanded;
        elements.settingsDataTools.classList.toggle('expanded', isExpanded);
        elements.settingsDataToolsToggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    }

    function setSettingsPreferencesExpanded(expanded) {
        if (!elements.settingsPreferences || !elements.settingsPreferencesToggle) return;
        const isExpanded = !!expanded;
        elements.settingsPreferences.classList.toggle('expanded', isExpanded);
        elements.settingsPreferencesToggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    }

    function doesProgressChangeAffectLists(oldProgress = {}, newProgress = {}) {
        const completedPct = AT.CONFIG?.COMPLETED_PERCENTAGE || 85;
        const keys = new Set([
            ...Object.keys(oldProgress || {}),
            ...Object.keys(newProgress || {})
        ]);

        for (const key of keys) {
            const oldEntry = oldProgress?.[key];
            const newEntry = newProgress?.[key];
            const oldVisible = !!oldEntry && !oldEntry.deleted && (Number(oldEntry.percentage) || 0) < completedPct;
            const newVisible = !!newEntry && !newEntry.deleted && (Number(newEntry.percentage) || 0) < completedPct;

            if (oldVisible !== newVisible) {
                return true;
            }
        }

        return false;
    }

    function flushDeferredListRefresh() {
        if (!deferredListRefresh) return;
        if (elements.animeList?.matches(':hover')) return;

        const pending = deferredListRefresh;
        deferredListRefresh = null;

        if (pending.timerId) clearTimeout(pending.timerId);

        renderAnimeList(pending.filter);
        if (pending.updateStats) updateStats();
    }

    function scheduleDeferredListRefresh(options = {}) {
        const {
            filter = getActiveFilter(),
            updateStats: shouldUpdateStats = true,
            delayMs = 0
        } = options;

        if (!elements.animeList) {
            renderAnimeList(filter);
            if (shouldUpdateStats) updateStats();
            return;
        }

        if (deferredListRefresh?.timerId) {
            clearTimeout(deferredListRefresh.timerId);
        }

        deferredListRefresh = {
            filter,
            updateStats: (deferredListRefresh?.updateStats || false) || shouldUpdateStats,
            timerId: setTimeout(() => {
                if (elements.animeList?.matches(':hover')) return;
                flushDeferredListRefresh();
            }, delayMs)
        };

        if (!elements.animeList.matches(':hover') && delayMs === 0) {
            flushDeferredListRefresh();
        }
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

    /**
     * Unified anime status resolver.  One function replaces the old
     * isAnimeCompleted / isAgedCompleted / isCaughtUpAiring trio.
     *
     * Returns: 'dropped' | 'completed' | 'airing' | 'watching' | 'on_hold'
     */
    const AnimeStatus = { WATCHING: 'watching', COMPLETED: 'completed', AIRING: 'airing', DROPPED: 'dropped', ON_HOLD: 'on_hold' };

    function getAnimeStatus(slug, anime) {
        const { FillerService, SeasonGrouping, AnilistService, CONFIG } = AT;
        if (!anime) return AnimeStatus.WATCHING;

        // ── On Hold ─────────────────────────────────────────────────────────
        if (anime.onHoldAt) return AnimeStatus.ON_HOLD;

        // ── Dropped ─────────────────────────────────────────────────────────
        if (anime.droppedAt) return AnimeStatus.DROPPED;

        const watchedCount = anime.episodes?.length || 0;
        const lowerSlug = slug.toLowerCase();
        const anilistStatus = AnilistService?.getStatus(lowerSlug);
        const latestAvailable = AnilistService?.getLatestEpisode(lowerSlug);
        const metaTotal = AnilistService?.getTotalEpisodes(lowerSlug);
        const isPartiallyUploaded = metaTotal && latestAvailable && latestAvailable < metaTotal;

        // ── Completion checks ───────────────────────────────────────────────
        let isComplete = false;

        if (watchedCount === 0) {
            isComplete = false;
        } else if (anime.completedAt) {
            isComplete = true;
        } else if (SeasonGrouping.isMovie(slug, anime)) {
            isComplete = true;
        } else {
            const progressData = FillerService.calculateProgress(watchedCount, slug, anime);

            if (progressData.progress >= 100 && !isPartiallyUploaded) {
                isComplete = true;
            } else if (anilistStatus === 'FINISHED' && progressData.total == null && !isPartiallyUploaded) {
                // Total unknown: don't auto-complete, let user decide
                isComplete = false;
            } else if (anilistStatus === 'FINISHED' && progressData.total != null) {
                const highestEp = Math.max(0, ...(anime.episodes || []).map(ep => Number(ep.number) || 0));
                if (highestEp >= progressData.total && !isPartiallyUploaded) isComplete = true;
            }
        }

        if (isComplete) {
            // Decide whether to show in completed section (aged) or still in main list
            const isAged =
                anime.completedAt ||
                SeasonGrouping.isMovie(slug, anime) ||
                anilistStatus === 'FINISHED' ||
                getCalendarDayDiff(anime?.lastWatched) >= CONFIG.COMPLETED_LIST_MIN_DAYS;

            return isAged ? AnimeStatus.COMPLETED : AnimeStatus.WATCHING;
        }

        // ── Caught up with airing ───────────────────────────────────────────
        if (watchedCount > 0 && !anime.completedAt && latestAvailable > 0) {
            const highestWatched = Math.max(0, ...(anime.episodes || []).map(ep => Number(ep.number) || 0));

            if (anilistStatus === 'RELEASING' && highestWatched >= latestAvailable) {
                return AnimeStatus.AIRING;
            }
            if (anilistStatus === 'FINISHED' && isPartiallyUploaded && highestWatched >= latestAvailable) {
                return AnimeStatus.AIRING;
            }
        }

        return AnimeStatus.WATCHING;
    }

    // Convenience wrappers used by other parts of the popup
    function isAnimeCompleted(slug, anime) {
        const status = getAnimeStatus(slug, anime);
        return status === AnimeStatus.COMPLETED || (
            // Also return true for "watching but complete" (not yet aged)
            anime?.completedAt || (anime?.episodes?.length > 0 && AT.SeasonGrouping.isMovie(slug, anime))
        );
    }

    function normalizeMovieDurations(data, progress = {}) {
        const { SeasonGrouping } = AT;
        const MIN_RELIABLE_DURATION_SECONDS = 30 * 60;     // 30 min
        const MAX_RELIABLE_DURATION_SECONDS = 4 * 60 * 60; // 4 h — safe ceiling for any anime film
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
        const completedWasOpen = elements.animeList.querySelector('.completed-list-cards')?.classList.contains('open') ?? false;
        const droppedWasOpen = elements.animeList.querySelector('.dropped-list-cards')?.classList.contains('open') ?? false;
        const airingWasOpen = elements.animeList.querySelector('.airing-list-cards')?.classList.contains('open') ?? false;
        const onHoldWasOpen = elements.animeList.querySelector('.onhold-list-cards')?.classList.contains('open') ?? false;
        const ipGroupWasOpen = elements.animeList.querySelector('.ip-group-content')?.classList.contains('open') ?? false;

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

        const visibleProgress = Object.fromEntries(
            Object.entries(videoProgress).filter(([, p]) => !p.deleted)
        );

        // Build slug index for O(1) lookups in anime-card instead of O(N) prefix scan
        const slugIndex = {};
        for (const [id, progress] of Object.entries(visibleProgress)) {
            const sepIdx = id.indexOf('__episode-');
            if (sepIdx === -1) continue;
            const slug = id.substring(0, sepIdx);
            if (!slugIndex[slug]) slugIndex[slug] = [];
            slugIndex[slug].push([id, progress]);
        }
        visibleProgress.__slugIndex = slugIndex;

        const inProgressAnime = ProgressManager.getInProgressAnime(animeData, visibleProgress)
            .filter(anime => {
                const matchesSearch = !filter || anime.title.toLowerCase().includes(filter.toLowerCase());
                const trackedAnime = animeData[anime.slug];
                if (trackedAnime?.droppedAt) return false;
                if (trackedAnime && isAnimeCompleted(anime.slug, trackedAnime)) return false;
                const categoryAnime = trackedAnime || anime;
                const matchesCategory = categoryFilter(anime.slug || '', categoryAnime);
                return matchesSearch && matchesCategory;
            })
            .sort((a, b) => new Date(b.lastProgress || 0) - new Date(a.lastProgress || 0));

        if (entries.length === 0 && inProgressAnime.length === 0) {
            elements.animeList.innerHTML = '';
            elements.emptyState.classList.add('visible');
            return;
        }

        elements.emptyState.classList.remove('visible');

        // Precompute latest-activity timestamps once (O(N+M)) before sorting.
        const latestMap = new Map();
        for (const [slug, anime] of entries) {
            let latest = new Date(anime.lastWatched || 0).getTime();
            const prefix = slug + '__';
            for (const [id, progress] of Object.entries(videoProgress)) {
                if (id.startsWith(prefix) && !progress.deleted) {
                    const t = progress.savedAt ? new Date(progress.savedAt).getTime() : 0;
                    if (t > latest) latest = t;
                }
            }
            latestMap.set(slug, latest);
        }

        // Sort all entries according to the active sort mode
        const sortedEntries = entries.sort((a, b) => {
            const [slugA, animeA] = a;
            const [slugB, animeB] = b;
            switch (currentSort) {
                case 'date':     return latestMap.get(slugB) - latestMap.get(slugA);
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

        // Single pass — partition using unified getAnimeStatus().
        const normalEntries = [];
        const completedEntries = [];
        const droppedEntries = [];
        const airingEntries = [];
        const onHoldEntries = [];
        for (const entry of sortedEntries) {
            switch (getAnimeStatus(entry[0], entry[1])) {
                case AnimeStatus.DROPPED:   droppedEntries.push(entry); break;
                case AnimeStatus.COMPLETED: completedEntries.push(entry); break;
                case AnimeStatus.AIRING:    airingEntries.push(entry); break;
                case AnimeStatus.ON_HOLD:   onHoldEntries.push(entry); break;
                default:                    normalEntries.push(entry); break;
            }
        }
        completedEntries.sort(([, a], [, b]) =>
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
        const droppedCardsHtml   = renderCompletedGroupedEntries(droppedEntries);
        const airingCardsHtml    = renderCompletedGroupedEntries(airingEntries);
        const onHoldCardsHtml    = renderCompletedGroupedEntries(onHoldEntries);
        const inProgressHtml     = AnimeCardRenderer.createInProgressGroup(inProgressAnime);

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
                    <div class="completed-list-cards">
                        ${completedCardsHtml}
                    </div>
                </div>
            `
            : '';

        const droppedGroupHtml = droppedEntries.length > 0
            ? `
                <div class="dropped-list-section">
                    <div class="dropped-list-label" id="droppedListToggle">
                        <div class="dropped-list-label-left">
                            <span class="dropped-list-label-title">DROPPED LIST</span>
                            <span class="dropped-list-label-sub">${droppedEntries.length} anime</span>
                        </div>
                        <svg class="dropped-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </div>
                    <div class="dropped-list-cards">
                        ${droppedCardsHtml}
                    </div>
                </div>
            `
            : '';

        const airingGroupHtml = airingEntries.length > 0
            ? `
                <div class="airing-list-section">
                    <div class="airing-list-label" id="airingListToggle">
                        <div class="airing-list-label-left">
                            <span class="airing-list-label-title">⬤ AIRING LIST</span>
                            <span class="airing-list-label-sub">${airingEntries.length} anime · Caught up</span>
                        </div>
                        <svg class="airing-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </div>
                    <div class="airing-list-cards">
                        ${airingCardsHtml}
                    </div>
                </div>
            `
            : '';

        const onHoldGroupHtml = onHoldEntries.length > 0
            ? `
                <div class="onhold-list-section">
                    <div class="onhold-list-label" id="onHoldListToggle">
                        <div class="onhold-list-label-left">
                            <span class="onhold-list-label-title">ON HOLD</span>
                            <span class="onhold-list-label-sub">${onHoldEntries.length} anime</span>
                        </div>
                        <svg class="onhold-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </div>
                    <div class="onhold-list-cards">
                        ${onHoldCardsHtml}
                    </div>
                </div>
            `
            : '';

        // Disable transitions during render to prevent flicker
        elements.animeList.classList.add('no-transition');
        elements.animeList.innerHTML = inProgressHtml + trackedHtml + airingGroupHtml + onHoldGroupHtml + completedGroupHtml + droppedGroupHtml;

        // Restore expanded state
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
        if (ipGroupWasOpen) {
            const ipContent = elements.animeList.querySelector('.ip-group-content');
            const ipChevron = elements.animeList.querySelector('.ip-group-chevron');
            if (ipContent) ipContent.classList.add('open');
            if (ipChevron) ipChevron.style.transform = 'rotate(0deg)';
        }

        // Restore open state for list sections
        function restoreListOpen(toggleId, chevronClass, wasOpen) {
            if (!wasOpen) return;
            const toggle = elements.animeList.querySelector(`#${toggleId}`);
            if (!toggle) return;
            const cards = toggle.nextElementSibling;
            const chevron = toggle.querySelector(`.${chevronClass}`);
            if (cards) cards.classList.add('open');
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        }
        restoreListOpen('completedListToggle', 'completed-chevron', completedWasOpen);
        restoreListOpen('droppedListToggle', 'dropped-chevron', droppedWasOpen);
        restoreListOpen('airingListToggle', 'airing-chevron', airingWasOpen);
        restoreListOpen('onHoldListToggle', 'onhold-chevron', onHoldWasOpen);

        setupCardEventListeners();

        if (elements.animeList.querySelector('.ip-card')) {
            _ipPatch(videoProgress || {});
        }

        // Re-enable transitions after layout settles
        requestAnimationFrame(() => {
            elements.animeList.classList.remove('no-transition');
        });
    }

    /**
     * Setup card event listeners
     */
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
                    if (e.target.closest('.anime-card-actions') || e.target.closest('.anime-header-actions') || e.target.closest('.anime-fetch-filler')) return;
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

        // List section toggle helper
        function setupListToggle(toggleId, chevronClass) {
            const toggle = elements.animeList.querySelector(`#${toggleId}`);
            if (!toggle) return;
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const cards = toggle.nextElementSibling;
                const chevron = toggle.querySelector(`.${chevronClass}`);
                const isOpen = cards.classList.contains('open');
                if (isOpen) {
                    // Close: set real height first so animation starts from visible content
                    cards.style.maxHeight = cards.scrollHeight + 'px';
                    cards.style.overflow = 'hidden';
                    requestAnimationFrame(() => {
                        cards.style.maxHeight = '0';
                        cards.style.padding = '0 10px';
                        cards.classList.remove('open');
                    });
                    cards.addEventListener('transitionend', function handler(ev) {
                        if (ev.propertyName !== 'max-height') return;
                        cards.style.maxHeight = '';
                        cards.style.overflow = '';
                        cards.style.padding = '';
                        cards.removeEventListener('transitionend', handler);
                    });
                } else {
                    cards.classList.add('open');
                }
                if (chevron) chevron.style.transform = isOpen ? 'rotate(-90deg)' : 'rotate(0deg)';
            });
            const chevron = toggle.querySelector(`.${chevronClass}`);
            if (chevron) chevron.style.transform = 'rotate(-90deg)';
        }
        setupListToggle('completedListToggle', 'completed-chevron');
        setupListToggle('droppedListToggle', 'dropped-chevron');
        setupListToggle('airingListToggle', 'airing-chevron');
        setupListToggle('onHoldListToggle', 'onhold-chevron');

        elements.animeList.querySelectorAll('.movie-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); editAnimeTitle(btn.dataset.slug); });
        });

        elements.animeList.querySelectorAll('.movie-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); deleteAnime(btn.dataset.slug); });
        });
    }

    /**
     * Update stats
     */
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
            PopupLogger.error('Stats', 'Failed to cache stats:', e);
        }
    }

    /**
     * Helper: check if all anime slugs have cached filler + anilist data.
     */
    // ─── Auto-sync tracking ─────────────────────────────────────────────────
    let _autoSyncCount = 0;
    function startAutoSync() {
        _autoSyncCount++;
        setMetadataRepairStatus('Updating info…');
    }
    function endAutoSync() {
        _autoSyncCount = Math.max(0, _autoSyncCount - 1);
        if (_autoSyncCount === 0) {
            scheduleDefaultSyncStatusRestore(1500);
        }
    }

    /**
     * Wrapper: runs autoFetchMissing with sync status tracking.
     * Works for any source (FillerService, AnilistService) — no matter who calls it.
     */
    function _truncTitle(t, max) {
        return t && t.length > max ? t.slice(0, max) + '…' : t;
    }

    function runAutoFetch(service, animeData, extraCallback) {
        startAutoSync();
        service.autoFetchMissing(animeData, () => {
            if (extraCallback) extraCallback();
        }, (done, total, title) => {
            setMetadataRepairStatus(`${done}/${total} — ${_truncTitle(title, 18)}`);
        }).then(() => {
            endAutoSync();
        }).catch(() => {
            endAutoSync();
        });
    }

    function checkAllCached(slugs) {
        const { FillerService } = AT;
        const allFillersCached = slugs.every(slug =>
            FillerService.isLikelyMovie(slug) || !!FillerService.episodeTypesCache[slug]
        );
        const allAnilistCached = slugs.every(slug => !!AT.AnilistService.cache?.[slug]);
        return { allFillersCached, allAnilistCached };
    }

    /**
     * Load local data
     */
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
                videoProgress = cleanedProgress;
            }

            await FillerService.loadCachedEpisodeTypes(animeData);
            await AT.AnilistService.loadCachedData(animeData);

            const slugsList = Object.keys(animeData);
            const { allFillersCached, allAnilistCached } = checkAllCached(slugsList);

            renderAnimeList();
            await updateStats();

            const repairState = await syncMetadataRepairStateFromStorage({ autoOpenRunning: true });
            const repairRunning = repairState?.status === 'running';

            if (!pendingAutoRepairAfterSignIn && !repairRunning && !allFillersCached) {
                runAutoFetch(FillerService, animeData, () => scheduleDeferredListRefresh());
            }

            if (!pendingAutoRepairAfterSignIn && !repairRunning && !allAnilistCached) {
                runAutoFetch(AT.AnilistService, animeData, () => scheduleDeferredListRefresh());
            }
        } catch (e) {
            PopupLogger.error('Storage', 'Load error:', e);
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
                    // Update slider position for restored category
                    const restoredActive = elements.categoryTabs.querySelector('.category-tab.active');
                    const tabSlider = elements.categoryTabs.querySelector('.category-tabs-slider');
                    if (restoredActive && tabSlider) {
                        requestAnimationFrame(() => {
                            const cr = elements.categoryTabs.getBoundingClientRect();
                            const tr = restoredActive.getBoundingClientRect();
                            tabSlider.style.transition = 'none';
                            tabSlider.style.width = tr.width + 'px';
                            tabSlider.style.transform = `translateX(${tr.left - cr.left - 4}px)`;
                            tabSlider.offsetHeight;
                            tabSlider.style.transition = '';
                        });
                    }
                }
            }

            await Storage.migrateMultiPartAnime();

            // Fast path: render from local storage immediately so the popup
            // doesn't show a blank list while waiting for Firebase round-trips.
            await loadData();

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
                await updateStats();

                const repairState = await syncMetadataRepairStateFromStorage({ autoOpenRunning: true });
                const repairRunning = repairState?.status === 'running';

                if (!pendingAutoRepairAfterSignIn && !repairRunning && !allFillersCached) {
                    runAutoFetch(FillerService, animeData, () => scheduleDeferredListRefresh());
                }

                if (!pendingAutoRepairAfterSignIn && !repairRunning && !allAnilistCached) {
                    runAutoFetch(AT.AnilistService, animeData, () => scheduleDeferredListRefresh());
                }
            }
        } catch (error) {
            PopupLogger.error('Sync', 'Error:', error);
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
                        PopupLogger.error('Delete', 'Cloud sync failed:', syncErr);
                    }
                }

                renderAnimeList(elements.searchInput?.value || '');
            }
        } catch (e) {
            PopupLogger.error('Delete', 'Error:', e);
            alert('Failed to delete progress. Please try again.');
        }
    }

    /**
     * Delete anime
     */
    async function deleteAnime(slug) {
        const { Storage, FirebaseSync } = AT;
        const wasInAnimeData = !!animeData[slug];
        const siteAnimeId = animeData[slug]?.siteAnimeId;
        if (wasInAnimeData) delete animeData[slug];

        try {
            const result = await Storage.get(['videoProgress', 'deletedAnime', 'groupCoverImages']);
            const currentVideoProgress = result.videoProgress || {};
            let progressDeleted = 0;
            const progressPrefix = slug + '__episode-';
            for (const id of Object.keys(currentVideoProgress)) {
                if (id.startsWith(progressPrefix)) { delete currentVideoProgress[id]; progressDeleted++; }
            }

            if (progressDeleted === 0 && !wasInAnimeData) {
                PopupLogger.warn('Delete', 'No data found to delete for:', slug);
                return;
            }

            videoProgress = currentVideoProgress;
            const deletedAnime = clearDeletedAnimeSlug(result.deletedAnime || {}, slug);
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

            // Remove from an1me.to watchlist
            if (siteAnimeId) {
                chrome.runtime.sendMessage(
                    { type: 'WATCHLIST_SYNC', animeId: siteAnimeId, watchlistType: 'remove' },
                    () => { if (chrome.runtime.lastError) { /* ignore */ } }
                );
            }

            renderAnimeList(elements.searchInput?.value || '');
            updateStats();
        } catch (e) {
            PopupLogger.error('Delete', 'Error:', e);
            alert('Failed to delete anime. Please try again.');
        }
    }

    /**
     * Toggle manual completed status
     */
    async function toggleAnimeCompleted(slug) {
        const { Storage, FirebaseSync } = AT;
        if (!animeData[slug]) return;

        try {
            const now = new Date().toISOString();
            const wasCompleted = !!animeData[slug].completedAt;
            if (wasCompleted) {
                setManualListState(animeData[slug], 'active', now);
            } else {
                setManualListState(animeData[slug], 'completed', now);
            }

            const result = await Storage.get(['videoProgress', 'deletedAnime', 'groupCoverImages']);
            const currentVideoProgress = result.videoProgress || {};
            const deletedAnime = clearDeletedAnimeSlug(result.deletedAnime || {}, slug);

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

            // Sync to an1me.to watchlist
            syncWatchlistFromPopup(slug, wasCompleted ? 'watching' : 'completed');

            renderAnimeList(elements.searchInput?.value || '');
            updateStats();
        } catch (e) {
            PopupLogger.error('Complete', 'Error:', e);
        }
    }

    /**
     * Toggle dropped status
     */
    async function toggleAnimeDropped(slug) {
        const { Storage, FirebaseSync } = AT;
        if (!animeData[slug]) return;

        try {
            const now = new Date().toISOString();
            const wasDropped = !!animeData[slug].droppedAt;
            if (wasDropped) {
                setManualListState(animeData[slug], 'active', now);
            } else {
                setManualListState(animeData[slug], 'dropped', now);
            }

            const result = await Storage.get(['videoProgress', 'deletedAnime', 'groupCoverImages']);
            const currentVideoProgress = result.videoProgress || {};
            const deletedAnime = clearDeletedAnimeSlug(result.deletedAnime || {}, slug);

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

            // Sync to an1me.to watchlist
            syncWatchlistFromPopup(slug, wasDropped ? 'watching' : 'dropped');

            renderAnimeList(elements.searchInput?.value || '');
            updateStats();
        } catch (e) {
            PopupLogger.error('Drop', 'Error:', e);
        }
    }

    /**
     * Toggle on-hold status
     */
    async function toggleAnimeOnHold(slug) {
        const { Storage, FirebaseSync } = AT;
        if (!animeData[slug]) return;

        try {
            const now = new Date().toISOString();
            const wasOnHold = !!animeData[slug].onHoldAt;
            if (wasOnHold) {
                setManualListState(animeData[slug], 'active', now);
            } else {
                setManualListState(animeData[slug], 'on_hold', now);
            }

            const result = await Storage.get(['videoProgress', 'deletedAnime', 'groupCoverImages']);
            const currentVideoProgress = result.videoProgress || {};
            const deletedAnime = clearDeletedAnimeSlug(result.deletedAnime || {}, slug);

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

            // Sync to an1me.to watchlist
            syncWatchlistFromPopup(slug, wasOnHold ? 'watching' : 'on_hold');

            renderAnimeList(elements.searchInput?.value || '');
            updateStats();
        } catch (e) {
            PopupLogger.error('OnHold', 'Error:', e);
        }
    }

    /**
     * Clear all data
     */
    async function clearAllData() {
        const { Storage, FirebaseSync } = AT;
        const dataToSave = { animeData: {}, videoProgress: {}, groupCoverImages: {}, deletedAnime: {} };
        const user = FirebaseSync.getUser();
        if (user) dataToSave.userId = user.uid;
        markInternalSave(dataToSave);
        await Storage.set(dataToSave);
        if (user) {
            await FirebaseSync.saveToCloud({
                animeData: {},
                videoProgress: {},
                groupCoverImages: {},
                deletedAnime: {}
            }, true);
        }
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
                if (start > 0 && end >= start && (end - start) <= 2000) {
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

    /**
     * Send watchlist sync to background service worker → an1me.to
     * Maps extension slug to site anime ID and fires the sync.
     * If siteAnimeId is missing, fetches it first from the anime page.
     */
    function syncWatchlistFromPopup(slug, watchlistType) {
        try {
            const siteId = animeData[slug]?.siteAnimeId;
            if (siteId) {
                // Have ID — send sync directly
                chrome.runtime.sendMessage(
                    { type: 'WATCHLIST_SYNC', animeId: siteId, watchlistType },
                    () => { if (chrome.runtime.lastError) { /* ignore */ } }
                );
                PopupLogger.log('WatchlistSync', `sent ${watchlistType} for #${siteId}`);
            } else {
                // No siteAnimeId yet — fetch it from the anime page, then sync
                PopupLogger.log('WatchlistSync', `fetching siteAnimeId for ${slug}...`);
                chrome.runtime.sendMessage(
                    { type: 'FETCH_ANIME_INFO', slug },
                    (response) => {
                        if (chrome.runtime.lastError) return;
                        const fetchedId = response?.info?.siteAnimeId;
                        if (fetchedId) {
                            // Save it locally for next time
                            if (animeData[slug]) animeData[slug].siteAnimeId = fetchedId;
                            // Now sync
                            chrome.runtime.sendMessage(
                                { type: 'WATCHLIST_SYNC', animeId: fetchedId, watchlistType },
                                () => { if (chrome.runtime.lastError) { /* ignore */ } }
                            );
                            PopupLogger.log('WatchlistSync', `fetched #${fetchedId}, sent ${watchlistType}`);
                            // Persist the siteAnimeId
                            AT.Storage.set({ animeData }).catch(() => {});
                        } else {
                            PopupLogger.log('WatchlistSync', `could not find siteAnimeId for ${slug}`);
                        }
                    }
                );
            }
        } catch (e) {
            PopupLogger.log('WatchlistSync', 'popup error:', e.message);
        }
    }

    function setManualListState(entry, state, at = new Date().toISOString()) {
        if (!entry) return;
        entry.listState = state;
        entry.listStateUpdatedAt = at;

        if (state === 'completed') {
            entry.completedAt = entry.completedAt || at;
            delete entry.droppedAt;
            delete entry.onHoldAt;
            return;
        }

        if (state === 'dropped') {
            entry.droppedAt = entry.droppedAt || at;
            delete entry.completedAt;
            delete entry.onHoldAt;
            return;
        }

        if (state === 'on_hold') {
            entry.onHoldAt = entry.onHoldAt || at;
            delete entry.completedAt;
            delete entry.droppedAt;
            return;
        }

        // active — clear all
        delete entry.completedAt;
        delete entry.droppedAt;
        delete entry.onHoldAt;
    }

    function markTitleEdited(entry, title, at = new Date().toISOString()) {
        if (!entry) return;
        entry.title = title;
        entry.titleUpdatedAt = at;
    }

    function clearDeletedAnimeSlug(deletedAnime, slug) {
        const nextDeletedAnime = { ...(deletedAnime || {}) };
        if (slug && Object.prototype.hasOwnProperty.call(nextDeletedAnime, slug)) {
            delete nextDeletedAnime[slug];
        }
        return nextDeletedAnime;
    }

    async function addAnimeWithEpisodes() {
        const { Storage, FirebaseSync, SeasonGrouping } = AT;
        const slugInput = elements.animeSlugInput.value;
        const slug = extractSlugFromInput(slugInput);
        const manualTitle = elements.animeTitleInput.value.trim();
        const title = manualTitle || generateTitleFromSlug(slug);
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
                if (manualTitle) {
                    animeData[slug].titleUpdatedAt = now;
                }
            }

            const deletedResult = await Storage.get(['deletedAnime']);
            const deletedAnime = clearDeletedAnimeSlug(deletedResult.deletedAnime || {}, slug);
            const dataToSave = { animeData, videoProgress, deletedAnime };
            const user = FirebaseSync.getUser();
            if (user) dataToSave.userId = user.uid;
            markInternalSave(dataToSave);
            await Storage.set(dataToSave);

            renderAnimeList(elements.searchInput?.value || '');
            updateStats();
            hideAddAnimeDialog();

            // Fetch cover image + info for the newly added anime in background
            if (!animeData[slug].coverImage) {
                chrome.runtime.sendMessage(
                    { type: 'BATCH_FETCH_ANIME_INFO', slugs: [slug] },
                    () => { if (chrome.runtime.lastError) { /* ignore */ } }
                );
            }

            if (user) {
                (async () => {
                    const gcRes = await Storage.get(['groupCoverImages']);
                    await FirebaseSync.saveToCloud({
                        animeData,
                        videoProgress,
                        deletedAnime,
                        groupCoverImages: gcRes.groupCoverImages || {}
                    });
                })().catch(err => PopupLogger.error('AddAnime', 'Cloud save error:', err));
            }
        } catch (error) {
            PopupLogger.error('AddAnime', 'Error:', error);
            alert('Failed to add anime. Please try again.');
        } finally {
            elements.confirmAddAnime.disabled = false;
            elements.confirmAddAnime.textContent = 'Add Anime';
        }
    }

    function showEditTitleDialog(slug) {
        if (!animeData[slug]) { PopupLogger.warn('EditTitle', 'Anime not found:', slug); return; }
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
            markTitleEdited(animeData[editingSlug], newTitle);
            const deletedResult = await Storage.get(['deletedAnime']);
            const deletedAnime = clearDeletedAnimeSlug(deletedResult.deletedAnime || {}, editingSlug);
            const dataToSave = { animeData, videoProgress, deletedAnime };
            const user = FirebaseSync.getUser();
            if (user) dataToSave.userId = user.uid;
            markInternalSave(dataToSave);
            await Storage.set(dataToSave);
            renderAnimeList(elements.searchInput?.value || '');

            if (user) {
                (async () => {
                    const gcRes = await Storage.get(['groupCoverImages']);
                    await FirebaseSync.saveToCloud({
                        animeData,
                        videoProgress,
                        deletedAnime,
                        groupCoverImages: gcRes.groupCoverImages || {}
                    });
                })().catch(err => PopupLogger.error('EditTitle', 'Cloud save error:', err));
            }
            hideEditTitleDialog();
        } catch (error) {
            PopupLogger.error('EditTitle', 'Error:', error);
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
            PopupLogger.error('FetchFiller', 'Error:', error);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '🎭'; }
        }
    }

    async function refreshAllAnimeInfo(options = {}) {
        const { force = true } = options;
        const { Storage, AnilistService } = AT;
        const slugs = Object.keys(animeData || {});

        if (slugs.length === 0) return;

        if (force) {
            const infoKeys = slugs.map((slug) => `animeinfo_${slug}`);
            if (infoKeys.length > 0) {
                await Storage.remove(infoKeys);
            }
            for (const slug of slugs) {
                delete AnilistService.cache[slug];
            }
        }

        startAutoSync();
        try {
            await AnilistService.autoFetchMissing(animeData, () => {
                scheduleDeferredListRefresh({ delayMs: 0 });
            }, (done, total, title) => {
                setMetadataRepairStatus(`${done}/${total} — ${_truncTitle(title, 18)}`);
            });
        } finally {
            endAutoSync();
        }
    }

    function setMetadataRepairStatus(label, synced = false) {
        if (!elements.syncStatus || !elements.syncText) return;

        if (metadataRepairStatusResetTimer) {
            clearTimeout(metadataRepairStatusResetTimer);
            metadataRepairStatusResetTimer = null;
        }

        elements.syncStatus.classList.remove('synced', 'syncing');
        if (synced) {
            elements.syncStatus.classList.add('synced');
        } else {
            elements.syncStatus.classList.add('syncing');
        }
        elements.syncText.textContent = label;
    }

    function restoreDefaultSyncStatus() {
        if (!elements.syncStatus || !elements.syncText) return;

        if (metadataRepairStatusResetTimer) {
            clearTimeout(metadataRepairStatusResetTimer);
            metadataRepairStatusResetTimer = null;
        }

        const user = AT.FirebaseSync?.getUser?.();
        elements.syncStatus.classList.remove('syncing', 'synced');
        if (user) elements.syncStatus.classList.add('synced');
        elements.syncText.textContent = user ? 'Cloud Synced' : 'Local Only';
    }

    function scheduleDefaultSyncStatusRestore(delayMs = 2500) {
        if (metadataRepairStatusResetTimer) clearTimeout(metadataRepairStatusResetTimer);
        metadataRepairStatusResetTimer = setTimeout(() => {
            metadataRepairStatusResetTimer = null;
            restoreDefaultSyncStatus();
        }, delayMs);
    }

    function applyAnimeInfoCacheChange(storageKey, value) {
        const slug = storageKey.replace('animeinfo_', '');
        if (!slug) return;

        if (value) {
            AT.AnilistService.cache[slug] = value;
        } else {
            delete AT.AnilistService.cache[slug];
        }
    }

    function applyEpisodeTypesCacheChange(storageKey, value) {
        const slug = storageKey.replace('episodeTypes_', '');
        if (!slug) return;

        const { FillerService } = AT;
        if (value) {
            FillerService.episodeTypesCache[slug] = value;
            FillerService.updateFromEpisodeTypes(slug, value);
        } else {
            delete FillerService.episodeTypesCache[slug];
        }
    }

    async function applyMetadataRepairState(state, options = {}) {
        const {
            ensureOpen = false,
            autoOpenRunning = false
        } = options;

        const previousStatus = lastMetadataRepairState?.status || null;
        lastMetadataRepairState = state || null;
        const { FillerFetchUI } = AT;

        if (!state) {
            if (FillerFetchUI.state.isOpen) FillerFetchUI.applyBackgroundState(null);
            restoreDefaultSyncStatus();
            return null;
        }

        const shouldOpen = ensureOpen || (autoOpenRunning && state.status === 'running');
        if (shouldOpen && !FillerFetchUI.state.isOpen) {
            await FillerFetchUI.open();
        }
        if (FillerFetchUI.state.isOpen || shouldOpen) {
            FillerFetchUI.applyBackgroundState(state);
        }

        if (state.status === 'running') {
            const total = Number(state.total) || 0;
            const processed = Number(state.processed) || 0;
            const nextStep = total > 0 ? Math.min(total, processed + 1) : 0;
            setMetadataRepairStatus(
                total > 0
                    ? `Importing ${nextStep}/${total}...`
                    : 'Importing data...'
            );
            return state;
        }

        if (state.status === 'completed') {
            const label = state.failed > 0
                ? `Import Complete (${state.failed} failed)`
                : 'Import Complete';
            setMetadataRepairStatus(label, true);
            if (previousStatus !== 'completed') {
                scheduleDeferredListRefresh({ delayMs: 0 });
                await updateStats();
            }
            scheduleDefaultSyncStatusRestore();
            return state;
        }

        if (state.status === 'error') {
            if (elements.syncStatus && elements.syncText) {
                elements.syncStatus.classList.remove('syncing', 'synced');
                elements.syncText.textContent = 'Import Error';
            }
            return state;
        }

        return state;
    }

    async function syncMetadataRepairStateFromStorage(options = {}) {
        const { Storage } = AT;
        const result = await Storage.get(['metadataRepairState']);
        return applyMetadataRepairState(result.metadataRepairState || null, options);
    }

    async function fetchAllFillers(options = {}) {
        const {
            autoStart = true,
            forceInfoRefresh = false,
            forceFillerRefresh = false
        } = options;

        const { FillerFetchUI } = AT;

        await FillerFetchUI.open();

        if (!autoStart) {
            return syncMetadataRepairStateFromStorage({ ensureOpen: true });
        }

        if (metadataRepairPromise) {
            return metadataRepairPromise;
        }

        metadataRepairPromise = (async () => {
            setMetadataRepairStatus('Importing data...');
            FillerFetchUI.showPendingStart('Starting import…');

            const response = await sendRuntimeMessage({
                type: 'START_LIBRARY_REPAIR',
                forceInfoRefresh,
                forceFillerRefresh
            }, 30000);

            if (!response?.success) {
                throw new Error(response?.error || 'Failed to start import');
            }

            return applyMetadataRepairState(response.state || null, { ensureOpen: true });
        })().catch((error) => {
            PopupLogger.error('RepairAll', 'Error:', error);
            if (elements.syncStatus && elements.syncText) {
                elements.syncStatus.classList.remove('syncing');
                elements.syncText.textContent = 'Import Error';
            }
            throw error;
        }).finally(() => {
            metadataRepairPromise = null;
        });

        return metadataRepairPromise;
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
            pendingAutoRepairAfterSignIn = true;
            await chrome.storage.local.set({ pendingBackgroundMetadataRepair: true });
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
                PopupLogger.error('Firebase', 'Sign in error:', error);
                showAuthToast('Sign in failed. Please try again.', 'error');
            }
            pendingAutoRepairAfterSignIn = false;
            await chrome.storage.local.set({ pendingBackgroundMetadataRepair: false });
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
        lastMetadataRepairState = null;
        await chrome.storage.local.set({ pendingBackgroundMetadataRepair: false, metadataRepairState: null });
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
                    pendingAutoRepairAfterSignIn = true;
                    await chrome.storage.local.set({ pendingBackgroundMetadataRepair: true });
                    const tokenData = JSON.parse(tokenInput);
                    await FirebaseLib.signInWithExportedToken(tokenData);
                } catch (err) {
                    pendingAutoRepairAfterSignIn = false;
                    await chrome.storage.local.set({ pendingBackgroundMetadataRepair: false });
                    const msg = (err instanceof SyntaxError || (err.message && err.message.includes('JSON')))
                        ? 'Invalid token format. Please copy it again from Chrome.'
                        : (err.message || 'Import failed');
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
                                <p>Copy this token and paste it in the <strong>Import Token</strong> panel on Orion/Safari. Valid for 20 minutes.</p>
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
                const willOpen = !elements.settingsDropdown.classList.contains('visible');
                elements.settingsDropdown.classList.toggle('visible');
                if (!willOpen) { setSettingsDataToolsExpanded(false); setSettingsPreferencesExpanded(false); }
            });
        }

        document.addEventListener('click', (e) => {
            if (elements.settingsDropdown && elements.settingsBtn &&
                !elements.settingsDropdown.contains(e.target) && !elements.settingsBtn.contains(e.target)) {
                elements.settingsDropdown.classList.remove('visible');
                setSettingsDataToolsExpanded(false);
                setSettingsPreferencesExpanded(false);
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
                setSettingsDataToolsExpanded(false);
                setSettingsPreferencesExpanded(false);
                setTimeout(() => elements.donateDropdown.classList.add('visible'), 150);
            });
        }

        if (elements.settingsDataToolsToggle) {
            elements.settingsDataToolsToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const isExpanded = elements.settingsDataTools?.classList.contains('expanded');
                setSettingsDataToolsExpanded(!isExpanded);
                setSettingsPreferencesExpanded(false);
            });
        }

        if (elements.settingsPreferencesToggle) {
            elements.settingsPreferencesToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const isExpanded = elements.settingsPreferences?.classList.contains('expanded');
                setSettingsPreferencesExpanded(!isExpanded);
                setSettingsDataToolsExpanded(false);
            });
        }

        if (elements.settingsRefresh) {
            elements.settingsRefresh.addEventListener('click', async () => {
                elements.settingsRefresh.classList.add('loading');
                elements.settingsDropdown.classList.remove('visible');
                setSettingsDataToolsExpanded(false);
                setSettingsPreferencesExpanded(false);
                try {
                    if (FirebaseSync.getUser()) {
                        await loadAndSyncData();
                    } else {
                        await loadData();
                    }
                } catch (error) {
                    PopupLogger.error('RefreshData', 'Error:', error);
                } finally {
                    elements.settingsRefresh.classList.remove('loading');
                }
            });
        }

        if (elements.settingsRefreshInfo) {
            elements.settingsRefreshInfo.addEventListener('click', async () => {
                const { Storage, AnilistService } = AT;
                elements.settingsRefreshInfo.classList.add('loading');
                elements.settingsDropdown.classList.remove('visible');
                setSettingsDataToolsExpanded(false);
                setSettingsPreferencesExpanded(false);
                try {
                    // Clear all cached anime info from storage so autoFetchMissing re-fetches everything
                    const allKeys = await new Promise(resolve => chrome.storage.local.get(null, resolve));
                    const infoKeys = Object.keys(allKeys).filter(k => k.startsWith('animeinfo_'));
                    if (infoKeys.length > 0) await Storage.remove(infoKeys);
                    // Clear in-memory cache too
                    AnilistService.cache = {};
                    // Re-fetch for all tracked anime with sync status
                    startAutoSync();
                    await AnilistService.autoFetchMissing(animeData, () => {
                        scheduleDeferredListRefresh();
                    }, (done, total, title) => {
                        setMetadataRepairStatus(`${done}/${total} — ${_truncTitle(title, 18)}`);
                    });
                    endAutoSync();
                } catch (e) {
                    PopupLogger.error('RefreshInfo', 'Error:', e);
                    endAutoSync();
                } finally {
                    elements.settingsRefreshInfo.classList.remove('loading');
                }
            });
        }

        if (elements.settingsClear) {
            elements.settingsClear.addEventListener('click', () => {
                elements.settingsDropdown.classList.remove('visible');
                setSettingsDataToolsExpanded(false);
                setSettingsPreferencesExpanded(false);
                showDialog();
            });
        }

        if (elements.settingsSignOut) {
            elements.settingsSignOut.addEventListener('click', () => {
                elements.settingsDropdown.classList.remove('visible');
                setSettingsDataToolsExpanded(false);
                setSettingsPreferencesExpanded(false);
                signOut();
            });
        }

        if (elements.settingsFetchFillers) {
            elements.settingsFetchFillers.addEventListener('click', async () => {
                elements.settingsDropdown.classList.remove('visible');
                setSettingsDataToolsExpanded(false);
                setSettingsPreferencesExpanded(false);
                await fetchAllFillers({ autoStart: true });
            });
        }

        if (elements.settingsCopyGuard) {
            elements.settingsCopyGuard.addEventListener('click', async (event) => {
                event.stopPropagation();
                const currentlyEnabled = elements.settingsCopyGuard.dataset.enabled !== 'false';
                const nextEnabled = !currentlyEnabled;
                renderCopyGuardSetting(nextEnabled);
                try {
                    await chrome.storage.local.set({ [COPY_GUARD_STORAGE_KEY]: nextEnabled });
                } catch (error) {
                    PopupLogger.error('Settings', 'Failed to update copy guard setting:', error);
                    renderCopyGuardSetting(currentlyEnabled);
                }
            });
        }

        if (elements.settingsSmartNotif) {
            elements.settingsSmartNotif.addEventListener('click', async (event) => {
                event.stopPropagation();
                const currentlyEnabled = elements.settingsSmartNotif.dataset.enabled === 'true';
                const nextEnabled = !currentlyEnabled;
                renderSmartNotifSetting(nextEnabled);
                try {
                    await chrome.storage.local.set({ [SMART_NOTIF_STORAGE_KEY]: nextEnabled });
                    chrome.runtime.sendMessage({ type: 'SET_SMART_NOTIFICATIONS', enabled: nextEnabled });
                } catch (error) {
                    PopupLogger.error('Settings', 'Failed to update smart notif setting:', error);
                    renderSmartNotifSetting(currentlyEnabled);
                }
            });
        }

        if (elements.settingsAutoSkipFiller) {
            elements.settingsAutoSkipFiller.addEventListener('click', async (event) => {
                event.stopPropagation();
                const currentlyEnabled = elements.settingsAutoSkipFiller.dataset.enabled === 'true';
                const nextEnabled = !currentlyEnabled;
                renderAutoSkipFillerSetting(nextEnabled);
                try {
                    await chrome.storage.local.set({ [AUTO_SKIP_FILLER_STORAGE_KEY]: nextEnabled });
                } catch (error) {
                    PopupLogger.error('Settings', 'Failed to update auto-skip filler setting:', error);
                    renderAutoSkipFillerSetting(currentlyEnabled);
                }
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
            // Create sliding indicator
            const slider = document.createElement('div');
            slider.className = 'category-tabs-slider';
            elements.categoryTabs.appendChild(slider);

            function moveSlider(activeTab, instant) {
                if (!activeTab) return;
                const containerRect = elements.categoryTabs.getBoundingClientRect();
                const tabRect = activeTab.getBoundingClientRect();
                const offsetX = tabRect.left - containerRect.left - 4; // 4px padding
                slider.style.width = tabRect.width + 'px';
                slider.style.transform = `translateX(${offsetX}px)`;
                if (instant) {
                    slider.style.transition = 'none';
                    slider.offsetHeight; // force reflow
                    slider.style.transition = '';
                }
            }

            // Initial position (no animation)
            const initialActive = elements.categoryTabs.querySelector('.category-tab.active');
            requestAnimationFrame(() => moveSlider(initialActive, true));

            elements.categoryTabs.querySelectorAll('.category-tab').forEach(tab => {
                tab.addEventListener('click', async () => {
                    currentCategory = normalizeCategory(tab.dataset.category);
                    elements.categoryTabs.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    moveSlider(tab, false);
                    if (elements.searchInput) renderAnimeList(elements.searchInput.value);
                    await chrome.storage.local.set({ userPreferences: { sort: currentSort, category: currentCategory } });
                });
            });
        }

        let storageUpdateTimeout = null;
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local') return;
            const isOwn = isOwnStorageChange(changes);
            let isExternalUpdate = false;
            let needsFullRender = false;
            let needsProgressOnly = false;
            let handledRepairStateChange = false;
            let handledMetadataCacheChange = false;

            if (changes.animeData) {
                animeData = changes.animeData.newValue || {};
                needsFullRender = true;
                if (!isOwn) isExternalUpdate = true;
            }
            if (changes.groupCoverImages) {
                window.AnimeTracker.groupCoverImages = changes.groupCoverImages.newValue || {};
                needsFullRender = true;
                if (!isOwn) isExternalUpdate = true;
            }
            if (changes.deletedAnime) {
                needsFullRender = true;
                if (!isOwn) isExternalUpdate = true;
            }
            if (changes[COPY_GUARD_STORAGE_KEY]) {
                renderCopyGuardSetting(changes[COPY_GUARD_STORAGE_KEY].newValue !== false);
            }
            if (changes.videoProgress) {
                videoProgress = changes.videoProgress.newValue || {};
                if (!isOwn) isExternalUpdate = true;
                // Instantly patch ip-card bars (no debounce needed)
                if (typeof _ipPatch === 'function') _ipPatch(videoProgress);
                // Re-render when progress changes move entries between active/completed/deleted
                // states, or when keys change. Otherwise the lightweight ip-card patch is enough.
                if (doesProgressChangeAffectLists(
                    changes.videoProgress.oldValue || {},
                    changes.videoProgress.newValue || {}
                )) {
                    needsFullRender = true;
                } else {
                    needsProgressOnly = true;
                }
            }

            Object.entries(changes).forEach(([key, change]) => {
                if (key.startsWith('animeinfo_')) {
                    handledMetadataCacheChange = true;
                    applyAnimeInfoCacheChange(key, change.newValue || null);
                    needsFullRender = true;
                    if (!isOwn) isExternalUpdate = true;
                } else if (key.startsWith('episodeTypes_')) {
                    handledMetadataCacheChange = true;
                    applyEpisodeTypesCacheChange(key, change.newValue || null);
                    needsFullRender = true;
                    if (!isOwn) isExternalUpdate = true;
                }
            });

            if (changes.metadataRepairState) {
                handledRepairStateChange = true;
                void applyMetadataRepairState(changes.metadataRepairState.newValue || null);
            }

            if (needsFullRender) {
                if (storageUpdateTimeout) clearTimeout(storageUpdateTimeout);
                storageUpdateTimeout = setTimeout(async () => {
                    scheduleDeferredListRefresh({ delayMs: 0 });
                    if (isExternalUpdate && !handledRepairStateChange && !handledMetadataCacheChange && elements.syncStatus && elements.syncText) {
                        elements.syncStatus.classList.add('synced');
                        elements.syncText.textContent = 'Synced ✓';
                        setTimeout(() => { elements.syncText.textContent = 'Cloud Synced'; }, 2500);
                    }
                }, CONFIG.STORAGE_UPDATE_DEBOUNCE_MS);
            } else if (needsProgressOnly && isExternalUpdate && !handledRepairStateChange && !handledMetadataCacheChange) {
                // External progress update (cloud sync) — only show sync badge, no re-render
                if (elements.syncStatus && elements.syncText) {
                    elements.syncStatus.classList.add('synced');
                    elements.syncText.textContent = 'Synced ✓';
                    setTimeout(() => { elements.syncText.textContent = 'Cloud Synced'; }, 2500);
                }
            }
        });

        if (elements.animeList) {
            elements.animeList.addEventListener('mouseleave', flushDeferredListRefresh);
            elements.animeList.addEventListener('click', async (e) => {
                const target = e.target;

                if (target.classList.contains('progress-delete-btn') || target.closest('.progress-delete-btn')) {
                    const btn = target.classList.contains('progress-delete-btn') ? target : target.closest('.progress-delete-btn');
                    const slug = btn.dataset.slug;
                    const episodeNum = parseInt(btn.dataset.episode, 10);
                    if (slug && episodeNum) await deleteProgress(slug, episodeNum);
                    return;
                }

                if (target.classList.contains('ip-delete-btn') || target.closest('.ip-delete-btn')) {
                    const btn = target.classList.contains('ip-delete-btn') ? target : target.closest('.ip-delete-btn');
                    const slug = btn.dataset.slug;
                    const episodeNum = parseInt(btn.dataset.episode, 10);
                    if (slug && episodeNum) await deleteProgress(slug, episodeNum);
                    return;
                }

                const ipGroupHeader = target.closest('.ip-group-header');
                if (ipGroupHeader) {
                    const group = ipGroupHeader.closest('.ip-group');
                    const content = group?.querySelector('.ip-group-content');
                    const chevron = ipGroupHeader.querySelector('.ip-group-chevron');
                    if (content) {
                        const isOpen = content.classList.toggle('open');
                        if (chevron) chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
                    }
                    return;
                }

                if (target.classList.contains('anime-complete-toggle') || target.closest('.anime-complete-toggle')) {
                    const btn = target.classList.contains('anime-complete-toggle') ? target : target.closest('.anime-complete-toggle');
                    if (btn.dataset.slug) await toggleAnimeCompleted(btn.dataset.slug);
                    return;
                }

                if (target.classList.contains('anime-drop-toggle') || target.closest('.anime-drop-toggle')) {
                    const btn = target.classList.contains('anime-drop-toggle') ? target : target.closest('.anime-drop-toggle');
                    if (btn.dataset.slug) await toggleAnimeDropped(btn.dataset.slug);
                    return;
                }

                if (target.classList.contains('anime-onhold-toggle') || target.closest('.anime-onhold-toggle')) {
                    const btn = target.classList.contains('anime-onhold-toggle') ? target : target.closest('.anime-onhold-toggle');
                    if (btn.dataset.slug) await toggleAnimeOnHold(btn.dataset.slug);
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

                // Card expand/collapse and collapsible sections are handled by
                // setupCardEventListeners() via direct addEventListener — do NOT
                // duplicate them here in the delegated handler.
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
            PopupLogger.warn('Init', 'Could not check cachedStats version:', e);
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
            PopupLogger.error('Init', 'Failed to load cached stats:', e);
        }

        try {
            const manifest = chrome.runtime.getManifest();
            if (manifest?.version) {
                if (elements.versionText) elements.versionText.textContent = `Anime Tracker v${manifest.version}`;
            }
        } catch (e) {
            PopupLogger.warn('Init', 'Could not load manifest version:', e);
        }

        initEventListeners();
        await Promise.all([
            loadCopyGuardSetting(),
            loadSmartNotifSetting(),
            loadAutoSkipFillerSetting()
        ]);

        // Auto-cleanup stale data on every popup open
        try {
            const { ProgressManager } = AT;
            // Run cleanup only once per day
            const { lastCleanupDate } = await Storage.get(['lastCleanupDate']);
            const today = new Date().toISOString().slice(0, 10);
            if (lastCleanupDate === today) {
                PopupLogger.log('Cleanup', 'Already ran today, skipping');
            } else {
                const raw = await Storage.get(['animeData', 'videoProgress', 'deletedAnime']);
                let dirty = false;

                // Clean tracked/completed videoProgress entries
                if (raw.videoProgress && raw.animeData) {
                    const { cleaned, removedCount } = ProgressManager.cleanTrackedProgress(raw.animeData, raw.videoProgress);
                    if (removedCount > 0) {
                        raw.videoProgress = cleaned;
                        dirty = true;
                        PopupLogger.log('Cleanup', `Removed ${removedCount} stale videoProgress entries`);
                    }
                }

                // Prune deletedAnime older than 10 days
                if (raw.deletedAnime) {
                    const cutoff = Date.now() - 10 * 24 * 60 * 60 * 1000;
                    for (const slug of Object.keys(raw.deletedAnime)) {
                        const info = raw.deletedAnime[slug];
                        const delAt = +(new Date(info?.deletedAt || info || 0));
                        if (delAt > 0 && delAt < cutoff) {
                            delete raw.deletedAnime[slug];
                            dirty = true;
                        }
                    }
                }

                const saveObj = { lastCleanupDate: today };
                if (dirty) {
                    saveObj.videoProgress = raw.videoProgress;
                    saveObj.deletedAnime = raw.deletedAnime;
                }
                await Storage.set(saveObj);
            }
        } catch (e) {
            PopupLogger.warn('Cleanup', 'Auto-cleanup failed:', e);
        }

        FirebaseSync.init({
            onUserSignedIn: async (user) => {
                showMainApp(user);
                // Wake background SW if asleep (e.g. Orion on mobile) —
                // send a lightweight ping instead of SYNC_TO_FIREBASE to avoid
                // a duplicate full sync (popup handles sync via loadAndSyncData).
                try { chrome.runtime.sendMessage({ type: 'GET_VERSION' }); } catch {}
                await loadAndSyncData();
                if (pendingAutoRepairAfterSignIn) {
                    pendingAutoRepairAfterSignIn = false;
                    await fetchAllFillers({ autoStart: true });
                }
            },
            onUserSignedOut: () => showAuthScreen(),
            onError: () => { showMainApp(null); loadData(); }
        });
    }

    // ── In-Progress live refresh ──────────────────────────────────────────────
    // Event-driven only: patch after render and on storage.onChanged updates.

    function _ipPatch(vp) {
        const completedPct = AT.CONFIG?.COMPLETED_PERCENTAGE || 85;
        const cards = document.querySelectorAll('.ip-card[data-slug]');

        cards.forEach(card => {
            const slug = card.dataset.slug;
            if (!slug) return;

            let best = null;
            let bestNum = 0;
            const prefix = slug + '__episode-';
            for (const key in vp) {
                if (!key.startsWith(prefix)) continue;
                const p = vp[key];
                if (!p || p.deleted) continue;
                if (p.percentage >= completedPct) continue;
                const num = parseInt(key.slice(prefix.length), 10);
                if (num > bestNum) { bestNum = num; best = p; }
            }
            if (!best) return;

            const pct = Math.floor(best.percentage);
            const ct  = best.currentTime || 0;
            const dur = best.duration || 0;
            const mins = Math.floor(ct / 60);
            const secs = Math.floor(ct % 60);
            const timeStr = `${mins}:${String(secs).padStart(2, '0')}`;
            const durStr  = dur > 0 ? `${Math.floor(dur / 60)}m` : '?';
            const remMin  = Math.ceil(Math.max(0, dur - ct) / 60);
            const remStr  = remMin > 0 ? `${remMin}m left` : 'Done';

            const fill = card.querySelector('.ip-fill');
            if (fill && fill.style.width !== pct + '%') {
                fill.style.width = pct + '%';
                PopupLogger.log('IP-Refresh', `${slug}: ${pct}% (${timeStr}/${durStr})`);
            }

            const badge = card.querySelector('.ip-pct-badge');
            if (badge) badge.textContent = pct + '%';

            const items = card.querySelectorAll('.ip-meta-item');
            if (items[0]) items[0].textContent = `Ep ${bestNum}`;
            if (items[1]) items[1].textContent = `${timeStr} / ${durStr}`;

            const rem = card.querySelector('.ip-remaining');
            if (rem) rem.textContent = remStr;
        });
    }

    // _ipPatch is called from the main storage.onChanged listener (initEventListeners)
    // to avoid registering duplicate listeners. Exposed here for access.

    window.addEventListener('beforeunload', () => { AT.FirebaseSync.cleanup(); });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { AT.FirebaseSync.cleanup(); }
    });

    init();

})();
