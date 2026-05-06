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
    let currentCompactStatus = 'airing'; // 'airing', 'on_hold', 'completed', 'dropped'
    let currentCompactStatusOpen = false;
    let goalSettings = null;
    let badgeState = {};
    let lastBadgeSnapshot = [];
    let currentViewMode = null;
    const COPY_GUARD_STORAGE_KEY = 'copyGuardEnabled';
    const GOAL_SETTINGS_KEY = 'goalSettings';
    const BADGE_STATE_KEY = 'badgeUnlocks';

    // DOM Elements
    const elements = {
        // Auth
        authSection: document.getElementById('authSection'),
        mainApp: document.getElementById('mainApp'),
        googleSignIn: document.getElementById('googleSignIn'),
        // Settings Menu
        settingsBtn: document.getElementById('settingsBtn'),
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
        settingsExportData: document.getElementById('settingsExportData'),
        settingsImportData: document.getElementById('settingsImportData'),
        settingsImportFile: document.getElementById('settingsImportFile'),
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
    const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

    /**
     * Check whether a named maintenance pass should run (≥24h since last run).
     * Uses localStorage (sync) so it doesn't add async overhead to popup open.
     */
    function shouldRunMaintenance(name) {
        try {
            const key = `lastMaintenanceRunAt_${name}`;
            const last = Number(localStorage.getItem(key)) || 0;
            if (Date.now() - last < MAINTENANCE_INTERVAL_MS) return false;
            localStorage.setItem(key, String(Date.now()));
            return true;
        } catch {
            return true; // if storage fails, default to running
        }
    }
    let deferredListRefresh = null;
    let realignCategoryTabs = () => {};
    // 5min interval — reuses the FirebaseSync user-document cache (TTL also
    // 5min) and the SW's `_BG_CLOUD_TTL`, so each tick costs at most 1 read
    // and only when the cache window has rolled over. Was 60s+forceFresh,
    // which produced ~60 Firestore reads/hour just for an idle open popup.
    const POPUP_CLOUD_REFRESH_MS = 5 * 60 * 1000;
    let popupCloudRefreshTimer = null;

    function getSettingsDonateButton() {
        return document.getElementById('settingsDonate');
    }

    function closeDonateDropdown() {
        if (!elements.donateDropdown) return;
        elements.donateDropdown.classList.remove('visible');
        delete elements.donateDropdown.dataset.placement;
    }

    function positionDonateDropdown() {
        const dropdown = elements.donateDropdown;
        const trigger = getSettingsDonateButton();
        const content = dropdown?.querySelector('.donate-dropdown-content');
        if (!dropdown || !trigger || !content) return;

        const triggerRect = trigger.getBoundingClientRect();
        const dropdownWidth = Math.ceil(content.offsetWidth || 220);
        const dropdownHeight = Math.ceil(content.offsetHeight || 132);
        const gap = 8;
        const viewportPadding = 10;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left = triggerRect.right - dropdownWidth;
        left = Math.max(viewportPadding, Math.min(left, viewportWidth - dropdownWidth - viewportPadding));

        let top = triggerRect.top - dropdownHeight - gap;
        let placement = 'above';

        if (top < viewportPadding) {
            top = Math.min(triggerRect.bottom + gap, viewportHeight - dropdownHeight - viewportPadding);
            placement = 'below';
        }

        const arrowOffset = triggerRect.left + (triggerRect.width / 2) - left;
        const clampedArrow = Math.max(22, Math.min(arrowOffset, dropdownWidth - 22));

        dropdown.style.left = `${Math.round(left)}px`;
        dropdown.style.top = `${Math.round(top)}px`;
        dropdown.style.setProperty('--donate-arrow-offset', `${Math.round(clampedArrow)}px`);
        dropdown.dataset.placement = placement;
    }

    function openDonateDropdown() {
        if (!elements.donateDropdown || !getSettingsDonateButton()) return;
        positionDonateDropdown();
        elements.donateDropdown.classList.add('visible');
        requestAnimationFrame(positionDonateDropdown);
    }

    // Cached markup from the last full anime-list render. When the next render
    // would produce the same markup (common: storage.onChanged fires for keys
    // the list doesn't reflect, or for no-op progress updates), we skip the
    // DOM swap entirely — this preserves scroll position, focus, and in-flight
    // hover/transition state that an `innerHTML =` wipe would otherwise
    // destroy. Reset to `null` on category/sort changes that imply a forced
    // re-render is appropriate.
    let _lastRenderedListMarkup = null;

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

    function setTopStatValue(element, value) {
        if (!element) return;
        const text = value == null ? '0' : String(value);
        const compactLength = text.replace(/\s+/g, '').length;
        element.textContent = text;
        element.classList.toggle('stat-value-long', compactLength >= 5);
        element.classList.toggle('stat-value-xlong', compactLength >= 7);
    }

    function getActiveFilter() {
        return elements.searchInput?.value || '';
    }

    function renderCopyGuardSetting(enabled) {
        // Settings DOM is rendered lazily by SettingsView, so look up live.
        const btn = document.getElementById('settingsCopyGuard');
        if (!btn) return;
        btn.dataset.enabled = enabled ? 'true' : 'false';
        btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        const subtitle = document.getElementById('settingsCopyGuardSubtitle');
        if (subtitle) {
            subtitle.textContent = enabled
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
        const btn = document.getElementById('settingsSmartNotif');
        if (!btn) return;
        btn.dataset.enabled = enabled ? 'true' : 'false';
        btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        const subtitle = document.getElementById('settingsSmartNotifSubtitle');
        if (subtitle) {
            subtitle.textContent = enabled
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
        const btn = document.getElementById('settingsAutoSkipFiller');
        if (!btn) return;
        btn.dataset.enabled = enabled ? 'true' : 'false';
        btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        const subtitle = document.getElementById('settingsAutoSkipFillerSubtitle');
        if (subtitle) {
            subtitle.textContent = enabled
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

    // ── Skiptime Helper setting ──
    // Toggle exposed in Settings view → Playback & Tracking card. The actual
    // floating panel lives in src/content/skiptime-helper.js and listens for
    // chrome.storage changes on this key to mount/unmount itself live.
    const SKIPTIME_HELPER_KEY = 'skiptimeHelperEnabled';

    function renderSkiptimeHelperSetting(enabled) {
        const btn = document.getElementById('settingsSkiptime');
        if (!btn) return;
        btn.dataset.enabled = enabled ? 'true' : 'false';
        btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        const subtitle = document.getElementById('settingsSkiptimeSubtitle');
        if (subtitle) {
            subtitle.textContent = enabled
                ? 'Capture intro/outro on an1me.to/watch'
                : 'Floating panel for intro/outro contributions';
        }
    }

    async function loadSkiptimeHelperSetting() {
        try {
            const result = await chrome.storage.local.get([SKIPTIME_HELPER_KEY]);
            const enabled = result[SKIPTIME_HELPER_KEY] === true;
            renderSkiptimeHelperSetting(enabled);
            return enabled;
        } catch (error) {
            PopupLogger.warn('Settings', 'Failed to load skiptime helper setting:', error);
            renderSkiptimeHelperSetting(false);
            return false;
        }
    }

    function setSettingsDataToolsExpanded(expanded) {
        const dataTools = document.getElementById('settingsDataTools');
        const toggle = document.getElementById('settingsDataToolsToggle');
        if (!dataTools || !toggle) return;
        const isExpanded = !!expanded;
        dataTools.classList.toggle('expanded', isExpanded);
        toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    }

    function setSettingsPreferencesExpanded(expanded) {
        const prefs = document.getElementById('settingsPreferences');
        const toggle = document.getElementById('settingsPreferencesToggle');
        if (!prefs || !toggle) return;
        const isExpanded = !!expanded;
        prefs.classList.toggle('expanded', isExpanded);
        toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
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

    function normalizeCompactStatus(value) {
        const allowed = new Set(['airing', 'on_hold', 'completed', 'dropped']);
        return allowed.has(value) ? value : 'airing';
    }

    function getKnownTotalEpisodesForRepair(slug, anime) {
        const localTotal = Number(anime?.totalEpisodes) || 0;
        const cachedTotal = Number(AT.AnilistService?.getTotalEpisodes(String(slug || '').toLowerCase())) || 0;
        return Math.max(localTotal, cachedTotal, 0);
    }

    function repairAiringCompletedEntries(data, options = {}) {
        const targetData = data || {};
        const requestedSlugs = Array.isArray(options.slugs) ? options.slugs : null;
        const slugs = requestedSlugs && requestedSlugs.length
            ? requestedSlugs
            : Object.keys(targetData);
        let changed = false;

        for (const slug of slugs) {
            const anime = targetData?.[slug];
            if (!anime || anime.droppedAt || anime.onHoldAt) continue;

            const listState = String(anime.listState || '').toLowerCase();
            if (!anime.completedAt && listState !== 'completed') continue;
            if (AT.SeasonGrouping.isMovie(slug, anime)) continue;

            const watchedCount = Array.isArray(anime.episodes) ? anime.episodes.length : 0;
            if (watchedCount <= 0) continue;

            const lowerSlug = String(slug || '').toLowerCase();
            const anilistStatus = AT.AnilistService?.getStatus(lowerSlug);
            if (anilistStatus !== 'RELEASING') continue;

            const knownTotal = getKnownTotalEpisodesForRepair(lowerSlug, anime);
            if (knownTotal <= watchedCount) continue;

            setManualListState(anime, 'active', new Date().toISOString());
            changed = true;
        }

        return changed;
    }

    function getCalendarDayDiff(isoString) {
        if (!isoString) return 0;
        const target = new Date(isoString);
        if (isNaN(target.getTime())) return 0;
        const now = new Date();
        // Use UTC midnight to avoid DST drift: the day-clock shifts by 1h
        // twice a year and a plain `(midnightA - midnightB) / 86400000`
        // would round to ±1 day on those days. UTC has fixed-length days.
        const nowUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        const targetUtc = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
        return Math.round((nowUtc - targetUtc) / 86400000);
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
        const listState = String(anime.listState || '').toLowerCase();

        // ── On Hold ─────────────────────────────────────────────────────────
        if (anime.onHoldAt || listState === AnimeStatus.ON_HOLD) return AnimeStatus.ON_HOLD;

        // ── Dropped ─────────────────────────────────────────────────────────
        if (anime.droppedAt || listState === AnimeStatus.DROPPED) return AnimeStatus.DROPPED;

        const watchedCount = anime.episodes?.length || 0;
        const lowerSlug = slug.toLowerCase();
        const anilistStatus = AnilistService?.getStatus(lowerSlug);
        const latestAvailable = AnilistService?.getLatestEpisode(lowerSlug);
        const metaTotal = AnilistService?.getTotalEpisodes(lowerSlug);
        const isPartiallyUploaded = metaTotal && latestAvailable && latestAvailable < metaTotal;
        const looksLikeStandaloneSpecial = /(?:^|-)special(?:-|$)|(?:^|-)ova(?:-|$)|(?:^|-)ona(?:-|$)|(?:^|-)fan-letter(?:-|$)/i.test(lowerSlug);

        // ── Completion checks ───────────────────────────────────────────────
        let isComplete = false;

        if (watchedCount === 0) {
            isComplete = false;
        } else if (anime.completedAt || listState === AnimeStatus.COMPLETED) {
            isComplete = true;
        } else if (SeasonGrouping.isMovie(slug, anime)) {
            isComplete = true;
        } else {
            const progressData = FillerService.calculateProgress(watchedCount, slug, anime);

            if (progressData.progress >= 100 && !isPartiallyUploaded) {
                isComplete = true;
            } else if (
                watchedCount === 1 &&
                !isPartiallyUploaded &&
                (
                    metaTotal === 1 ||
                    latestAvailable === 1 ||
                    (anilistStatus === 'FINISHED' && looksLikeStandaloneSpecial)
                )
            ) {
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
                listState === AnimeStatus.COMPLETED ||
                SeasonGrouping.isMovie(slug, anime) ||
                anilistStatus === 'FINISHED' ||
                getCalendarDayDiff(anime?.lastWatched) >= CONFIG.COMPLETED_LIST_MIN_DAYS;

            return isAged ? AnimeStatus.COMPLETED : AnimeStatus.WATCHING;
        }

        // ── Caught up with airing ───────────────────────────────────────────
        if (watchedCount > 0 && !anime.completedAt && listState !== AnimeStatus.COMPLETED && latestAvailable > 0) {
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
                const isLegacyDuration = window.AnimeTrackerMergeUtils?.PLACEHOLDER_DURATION_VALUES?.includes(currentDuration)
                    ?? (currentDuration === 1440 || currentDuration === 6000 || currentDuration === 7200);
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
        realignCategoryTabs();

        // Settings avatar/name/email live inside #settingsView, which is built
        // lazily by settings-view.js when the user opens it. Look these up
        // live: they're null until that first render, and SettingsView itself
        // re-applies user data from FirebaseSync.getUser() on every render.
        const avatar = document.getElementById('settingsAvatar');
        const userName = document.getElementById('settingsUserName');
        const userEmail = document.getElementById('settingsUserEmail');

        if (user) {
            if (avatar) {
                if (user.photoURL) {
                    avatar.src = user.photoURL;
                    avatar.onerror = () => { avatar.src = 'src/icons/icon48.png'; };
                } else {
                    avatar.src = 'src/icons/icon48.png';
                }
            }
            if (userName) userName.textContent = user.displayName || user.email?.split('@')[0] || 'User';
            if (userEmail) userEmail.textContent = user.email || '';
            elements.syncStatus?.classList.add('synced');
            if (elements.syncText) elements.syncText.textContent = 'Cloud Synced';
        } else {
            if (avatar) avatar.src = 'src/icons/icon48.png';
            if (userName) userName.textContent = 'User';
            if (userEmail) userEmail.textContent = '';
            elements.syncStatus?.classList.remove('synced');
            if (elements.syncText) elements.syncText.textContent = 'Local Only';
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
        const ipGroupWasOpen = elements.animeList.querySelector('.ip-group-content')?.classList.contains('open') ?? false;

        // Filter by category
        const categoryFilter = (slug, anime) => {
            if (currentCategory === 'all') return true;
            const isMovie = SeasonGrouping.isMovie(slug, anime);
            if (currentCategory === 'movies') return isMovie;
            if (currentCategory === 'series') return !isMovie;
            return true;
        };

        // Expose current animeData ref so other modules (e.g. anime-card ETA badge) can read it
        window.AnimeTracker._animeDataRef = animeData;

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
        Object.defineProperty(visibleProgress, '__slugIndex', {
            value: slugIndex,
            enumerable: false,
            configurable: true,
            writable: true
        });

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
            if (_lastRenderedListMarkup !== '') {
                elements.animeList.replaceChildren();
                _lastRenderedListMarkup = '';
            }
            elements.emptyState.classList.add('visible');
            return;
        }

        elements.emptyState.classList.remove('visible');

        // Precompute latest-activity timestamps once. Previous version was
        // O(N × M) — re-iterated the full videoProgress map per anime.
        // Now: walk videoProgress once, bucket by slug, then merge with
        // anime.lastWatched in O(N + M).
        const progressLatestBySlug = new Map();
        for (const [id, progress] of Object.entries(videoProgress)) {
            if (!id || id === '__slugIndex' || progress?.deleted) continue;
            const sepIdx = id.indexOf('__episode-');
            if (sepIdx === -1) continue;
            const slug = id.slice(0, sepIdx);
            const t = progress?.savedAt ? new Date(progress.savedAt).getTime() : 0;
            if (!t) continue;
            const cur = progressLatestBySlug.get(slug) || 0;
            if (t > cur) progressLatestBySlug.set(slug, t);
        }
        const latestMap = new Map();
        for (const [slug, anime] of entries) {
            const lastWatchedTs = anime.lastWatched ? new Date(anime.lastWatched).getTime() : 0;
            const progressTs = progressLatestBySlug.get(slug) || 0;
            latestMap.set(slug, Math.max(lastWatchedTs || 0, progressTs));
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
                        <svg class="completed-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform: ${currentCompactStatusOpen ? 'rotate(0deg)' : 'rotate(-90deg)'}">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </div>
                    <div class="completed-list-cards${currentCompactStatusOpen ? ' open' : ''}">
                        <div class="list-inner">
                            ${completedCardsHtml}
                        </div>
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
                        <svg class="dropped-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform: ${currentCompactStatusOpen ? 'rotate(0deg)' : 'rotate(-90deg)'}">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </div>
                    <div class="dropped-list-cards${currentCompactStatusOpen ? ' open' : ''}">
                        <div class="list-inner">
                            ${droppedCardsHtml}
                        </div>
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
                        <svg class="airing-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform: ${currentCompactStatusOpen ? 'rotate(0deg)' : 'rotate(-90deg)'}">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </div>
                    <div class="airing-list-cards${currentCompactStatusOpen ? ' open' : ''}">
                        <div class="list-inner">
                            ${airingCardsHtml}
                        </div>
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
                        <svg class="onhold-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform: ${currentCompactStatusOpen ? 'rotate(0deg)' : 'rotate(-90deg)'}">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </div>
                    <div class="onhold-list-cards${currentCompactStatusOpen ? ' open' : ''}">
                        <div class="list-inner">
                            ${onHoldCardsHtml}
                        </div>
                    </div>
                </div>
            `
            : '';

        const compactStatusItems = [
            { key: 'airing', label: 'Airing', count: airingEntries.length, sectionHtml: airingGroupHtml },
            { key: 'on_hold', label: 'Hold', count: onHoldEntries.length, sectionHtml: onHoldGroupHtml },
            { key: 'completed', label: 'Completed', count: completedEntries.length, sectionHtml: completedGroupHtml },
            { key: 'dropped', label: 'Dropped', count: droppedEntries.length, sectionHtml: droppedGroupHtml }
        ].filter(item => item.count > 0);

        if (compactStatusItems.length > 0) {
            currentCompactStatus = normalizeCompactStatus(currentCompactStatus);
            if (!compactStatusItems.some(item => item.key === currentCompactStatus)) {
                currentCompactStatus = compactStatusItems[0].key;
            }
        }

        const activeCompactItem = compactStatusItems.find(item => item.key === currentCompactStatus) || null;
        const chipsHtml = compactStatusItems.length > 0
            ? `
                <div class="status-chip-row" role="tablist" aria-label="Quick status lists">
                    ${compactStatusItems.map((item, index) => `
                        <button
                            type="button"
                            class="status-chip${item.key === currentCompactStatus ? ' active' : ''} ${item.key.replace('_', '-')}"
                            data-compact-status="${item.key}"
                            aria-pressed="${item.key === currentCompactStatus ? 'true' : 'false'}">
                            <span class="status-chip-label">${item.label}</span>
                            <span class="status-chip-count">${item.count}</span>
                        </button>${index < compactStatusItems.length - 1 ? '<span class="status-chip-sep">•</span>' : ''}
                    `).join('')}
                </div>
            `
            : '';
        const activeCompactSectionHtml = activeCompactItem ? activeCompactItem.sectionHtml : '';

        const combinedHtml = inProgressHtml + trackedHtml + chipsHtml + activeCompactSectionHtml;

        // Skip the DOM swap entirely when the output hasn't changed since the
        // last render. storage.onChanged fires for plenty of keys the list
        // doesn't reflect (metadata caches, episode-type caches, repair state,
        // own echoes) and for progress writes that save the same currentTime
        // we already rendered — rebuilding the whole subtree in those cases
        // flushes scroll position and any hover/transition state for no gain.
        if (combinedHtml === _lastRenderedListMarkup && elements.animeList.firstChild) {
            // DOM already matches — only refresh the live progress bars on
            // in-progress cards, since videoProgress can change without
            // altering the rendered markup (same seconds, different ms).
            if (elements.animeList.querySelector('.ip-card')) {
                _ipPatch(videoProgress || {});
            }
            return;
        }

        // Disable transitions during render to prevent flicker.
        elements.animeList.classList.add('no-transition');

        // Build the new subtree off-DOM and swap it in atomically with
        // replaceChildren. The old `innerHTML = str` pattern triggered two
        // mutations (clear + parse-into-live-tree); this is one.
        const range = document.createRange();
        range.selectNodeContents(elements.animeList);
        const fragment = range.createContextualFragment(combinedHtml);
        elements.animeList.replaceChildren(fragment);
        _lastRenderedListMarkup = combinedHtml;

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

        setupCardEventListeners();

        if (elements.animeList.querySelector('.ip-card')) {
            _ipPatch(videoProgress || {});
        }

        // Re-enable transitions after layout settles
        requestAnimationFrame(() => {
            elements.animeList.classList.remove('no-transition');
        });
    }

    // ─── Export / Import library backup ────────────────────────────────
    // Format v1: { version, exportedAt, animeData, videoProgress, deletedAnime,
    //              groupCoverImages, goalSettings, badgeUnlocks }. Stable so
    // future versions can be migrated forward instead of rejected.
    const BACKUP_FORMAT_VERSION = 1;

    async function exportLibraryToJson() {
        const { Storage } = AT;
        const snapshot = await Storage.get([
            'animeData', 'videoProgress', 'deletedAnime',
            'groupCoverImages', 'goalSettings', 'badgeUnlocks'
        ]);

        const payload = {
            version: BACKUP_FORMAT_VERSION,
            exportedAt: new Date().toISOString(),
            extensionVersion: chrome.runtime?.getManifest?.()?.version || null,
            animeData: snapshot.animeData || {},
            videoProgress: snapshot.videoProgress || {},
            deletedAnime: snapshot.deletedAnime || {},
            groupCoverImages: snapshot.groupCoverImages || {},
            goalSettings: snapshot.goalSettings || null,
            badgeUnlocks: snapshot.badgeUnlocks || {}
        };

        const json = JSON.stringify(payload, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/T.*/, '');
        const a = document.createElement('a');
        a.href = url;
        a.download = `an1me-tracker-backup-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoke after a tick so the download has time to start.
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 1500);

        const animeCount = Object.keys(payload.animeData).length;
        AT.UIHelpers?.showToast?.(`Exported ${animeCount} anime`, { type: 'success' });
    }

    async function importLibraryFromFile(file) {
        const { Storage, FirebaseSync, ProgressManager } = AT;
        const Merge = window.AnimeTrackerMergeUtils;
        if (!Merge?.mergeAnimeData) throw new Error('Merge utils unavailable');

        const text = await file.text();
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new Error('Invalid JSON file');
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Backup file is malformed');
        }
        // Tolerant: animeData is the only field we strictly require to merge anything.
        if (!parsed.animeData || typeof parsed.animeData !== 'object') {
            throw new Error('Backup is missing animeData');
        }

        const incomingCount = Object.keys(parsed.animeData).length;
        const ok = await showInlineConfirm({
            title: 'Import library backup?',
            body: `This will MERGE ${incomingCount} anime into your library. Local changes are preserved on conflicts (most-recent wins).`,
            confirmLabel: 'Import',
            cancelLabel: 'Cancel',
            danger: false
        });
        if (!ok) return;

        const local = await Storage.get([
            'animeData', 'videoProgress', 'deletedAnime',
            'groupCoverImages', 'goalSettings', 'badgeUnlocks'
        ]);

        // Merge with the same primitives we use for cloud sync — safe handling
        // of timestamps, deleted tombstones, episode dedupe, etc.
        let mergedAnime = Merge.mergeAnimeData(local.animeData || {}, parsed.animeData || {});
        let mergedDeleted = Merge.mergeDeletedAnime(local.deletedAnime || {}, parsed.deletedAnime || {});
        mergedDeleted = Merge.pruneStaleDeletedAnime(mergedAnime, mergedDeleted);
        Merge.applyDeletedAnime(mergedAnime, mergedDeleted);

        let mergedProgress = Merge.mergeVideoProgress(local.videoProgress || {}, parsed.videoProgress || {});
        const mergedGroup = Merge.mergeGroupCoverImages(local.groupCoverImages || {}, parsed.groupCoverImages || {});
        const mergedGoals = Merge.mergeGoalSettings
            ? Merge.mergeGoalSettings(local.goalSettings || null, parsed.goalSettings || null)
            : (parsed.goalSettings || local.goalSettings || null);
        const mergedBadges = Merge.mergeBadgeUnlocks
            ? Merge.mergeBadgeUnlocks(local.badgeUnlocks || {}, parsed.badgeUnlocks || {})
            : { ...(local.badgeUnlocks || {}), ...(parsed.badgeUnlocks || {}) };

        // Run the same post-merge cleanup pass we use on load.
        if (ProgressManager?.removeDuplicateEpisodes) {
            mergedAnime = ProgressManager.removeDuplicateEpisodes(mergedAnime);
        }

        const payload = {
            animeData: mergedAnime,
            videoProgress: mergedProgress,
            deletedAnime: mergedDeleted,
            groupCoverImages: mergedGroup,
            goalSettings: mergedGoals,
            badgeUnlocks: mergedBadges
        };
        markInternalSave(payload);
        await Storage.set(payload);

        // Update in-memory copies so the next render is correct without a reload.
        animeData = mergedAnime;
        videoProgress = mergedProgress;
        if (mergedGoals) goalSettings = mergedGoals;
        badgeState = mergedBadges;
        try { window.AnimeTracker.groupCoverImages = mergedGroup; } catch {}

        renderAnimeList(elements.searchInput?.value || '');
        await updateStats();

        // Push merged data to cloud if logged in so the import is reflected
        // across devices, not just this one.
        const user = FirebaseSync?.getUser?.();
        if (user) {
            try {
                await FirebaseSync.saveToCloud({
                    animeData: mergedAnime,
                    videoProgress: mergedProgress,
                    deletedAnime: mergedDeleted,
                    groupCoverImages: mergedGroup,
                    goalSettings: mergedGoals,
                    badgeUnlocks: mergedBadges
                }, true);
            } catch (err) {
                PopupLogger.warn('Import', 'Cloud push failed (local merge already saved):', err);
            }
        }

        AT.UIHelpers?.showToast?.(`Imported ${incomingCount} anime`, {
            type: 'success', duration: 2600
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
                if (header.parentElement) header.parentElement.classList.toggle('collapsed');
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
                if (header.parentElement) header.parentElement.classList.toggle('collapsed');
            });
        });

        elements.animeList.querySelectorAll('.parts-header').forEach(header => {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                const card = header.closest('.anime-card');
                if (card && !card.classList.contains('expanded')) card.classList.add('expanded');
                if (header.parentElement) header.parentElement.classList.toggle('collapsed');
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
                    const wasExpanded = card.classList.toggle('expanded');
                    card.setAttribute('aria-expanded', wasExpanded ? 'true' : 'false');
                };
                header.addEventListener('click', toggleCard);
            }
            // Keyboard activation: Enter / Space toggle expansion when the
            // card itself (not a child button) is focused. Skip when focus is
            // inside an interactive child so we don't double-trigger.
            card.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                if (e.target !== card) return;
                e.preventDefault();
                const wasExpanded = card.classList.toggle('expanded');
                card.setAttribute('aria-expanded', wasExpanded ? 'true' : 'false');
            });
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
            const seasonItem = header.closest('.season-item');
            // Movie rows have no collapsible content — skip wiring the toggle so
            // clicking doesn't add a no-op `.expanded` class.
            if (seasonItem?.classList.contains('season-item-movie')) return;
            const toggleSeason = (e) => {
                if (e.target.closest('.season-edit-btn') || e.target.closest('.season-delete-btn')) return;
                e.stopPropagation();
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

        elements.animeList.querySelectorAll('[data-compact-status]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const nextStatus = normalizeCompactStatus(btn.dataset.compactStatus || '');
                if (nextStatus === currentCompactStatus) return;
                currentCompactStatus = nextStatus;
                renderAnimeList(getActiveFilter());
            });
        });

        function setupCompactSectionToggle(toggleId, chevronClass) {
            const toggle = elements.animeList.querySelector(`#${toggleId}`);
            if (!toggle) return;

            const updateChevron = () => {
                const cards = toggle.nextElementSibling;
                const chevron = toggle.querySelector(`.${chevronClass}`);
                if (chevron && cards) {
                    chevron.style.transform = cards.classList.contains('open') ? 'rotate(0deg)' : 'rotate(-90deg)';
                }
            };

            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const cards = toggle.nextElementSibling;
                if (!cards) return;
                cards.classList.toggle('open');
                currentCompactStatusOpen = cards.classList.contains('open');
                updateChevron();
            });

            updateChevron();
        }

        setupCompactSectionToggle('airingListToggle', 'airing-chevron');
        setupCompactSectionToggle('onHoldListToggle', 'onhold-chevron');
        setupCompactSectionToggle('completedListToggle', 'completed-chevron');
        setupCompactSectionToggle('droppedListToggle', 'dropped-chevron');

        // Event delegation: one listener on the list container handles all
        // per-card edit/delete clicks — avoids attaching handlers per render.
        if (elements.animeList && !elements.animeList.__delegatedClickInstalled) {
            elements.animeList.addEventListener('click', (e) => {
                const editBtn = e.target.closest('.movie-edit-btn');
                if (editBtn && elements.animeList.contains(editBtn)) {
                    e.stopPropagation();
                    editAnimeTitle(editBtn.dataset.slug);
                    return;
                }
                const delBtn = e.target.closest('.movie-delete-btn');
                if (delBtn && elements.animeList.contains(delBtn)) {
                    e.stopPropagation();
                    deleteAnime(delBtn.dataset.slug);
                }
            });
            elements.animeList.__delegatedClickInstalled = true;
        }
    }

    /**
     * Update stats
     */
    async function updateStats() {
        const { UIHelpers, SeasonGrouping, Storage } = AT;
        const animeEntries = Object.entries(animeData);
        const groups = SeasonGrouping.groupByBase(animeEntries);
        const totalAnimeCount = groups.size;
        setTopStatValue(elements.totalAnime, totalAnimeCount);
        const totalMoviesCount = animeEntries.filter(([slug, anime]) => SeasonGrouping.isMovie(slug, anime)).length;
        if (elements.totalMovies) setTopStatValue(elements.totalMovies, totalMoviesCount);

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
        setTopStatValue(elements.totalEpisodes, totalWatchedEpisodes);
        setTopStatValue(elements.totalTime, totalTimeStr);

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

    async function loadGoalAndBadgeState() {
        try {
            const result = await chrome.storage.local.get([GOAL_SETTINGS_KEY, BADGE_STATE_KEY]);
            const AchievementsEngine = window.AnimeTracker?.AchievementsEngine;
            const defaults = AchievementsEngine?.getDefaultGoalSettings?.() || {
                daily:   { targetMinutes: 60, updatedAt: null },
                weekly:  { targetEpisodes: 5, updatedAt: null },
                monthly: { targetEpisodes: 20, updatedAt: null }
            };
            const stored = result[GOAL_SETTINGS_KEY] || {};
            goalSettings = {
                daily:   { ...defaults.daily,   ...(stored.daily   || {}) },
                weekly:  { ...defaults.weekly,  ...(stored.weekly  || {}) },
                monthly: { ...defaults.monthly, ...(stored.monthly || {}) }
            };
            badgeState = result[BADGE_STATE_KEY] || {};
        } catch (e) {
            PopupLogger.warn('Goals', 'Failed to load goal/badge state:', e);
            goalSettings = null;
            badgeState = {};
        }
    }

    async function persistBadgeUnlocks(newlyUnlocked) {
        if (!Array.isArray(newlyUnlocked) || newlyUnlocked.length === 0) return;
        const nowIso = new Date().toISOString();
        const previousState = badgeState || {};
        const next = { ...previousState };

        // Only badges that aren't yet in `badgeState` are *truly* new for this
        // user. Without this filter, the first goals-view render of every
        // popup session — where `lastBadgeSnapshot` starts as [] — diffs every
        // currently-unlocked badge as "newly unlocked" and re-fires a system
        // notification for each one (the bug surfaced as the post-logout
        // achievements toast spam).
        const trulyNew = [];
        for (const badge of newlyUnlocked) {
            if (!previousState[badge.id]) {
                next[badge.id] = { unlockedAt: nowIso, notified: false };
                trulyNew.push(badge);
            }
        }

        if (trulyNew.length === 0) {
            // Snapshot caught up with persisted state; nothing fresh to notify.
            return;
        }

        badgeState = next;
        try {
            await chrome.storage.local.set({ [BADGE_STATE_KEY]: next });
        } catch (e) {
            PopupLogger.warn('Goals', 'Failed to persist badge unlocks:', e);
        }

        if (trulyNew.length > 3) {
            try {
                chrome.runtime.sendMessage({
                    type: 'BADGES_UNLOCKED_BATCH',
                    count: trulyNew.length
                }, () => { if (chrome.runtime.lastError) { } });
            } catch { }
        } else {
            for (const badge of trulyNew) {
                try {
                    chrome.runtime.sendMessage({
                        type: 'BADGE_UNLOCKED',
                        id: badge.id,
                        title: badge.title,
                        desc: badge.desc,
                        icon: badge.icon
                    }, () => { if (chrome.runtime.lastError) { } });
                } catch { }
            }
        }
    }

    function setViewMode(mode) {
        const appRoot = document.querySelector('.app');
        const mainContent = document.querySelector('.main-content');
        const statsView = document.getElementById('statsView');
        const goalsView = document.getElementById('goalsView');
        const settingsView = document.getElementById('settingsView');
        const viewStatsBtn = document.getElementById('viewStatsBtn');
        const viewGoalsBtn = document.getElementById('viewGoalsBtn');
        const settingsBtn = document.getElementById('settingsBtn');

        currentViewMode = mode || null;

        if (appRoot) {
            appRoot.classList.toggle('stats-mode', mode === 'stats');
            appRoot.classList.toggle('goals-mode', mode === 'goals');
            appRoot.classList.toggle('settings-mode', mode === 'settings');
        }
        if (viewStatsBtn) {
            viewStatsBtn.classList.toggle('is-active', mode === 'stats');
            viewStatsBtn.setAttribute('aria-pressed', mode === 'stats' ? 'true' : 'false');
        }
        if (viewGoalsBtn) {
            viewGoalsBtn.classList.toggle('is-active', mode === 'goals');
            viewGoalsBtn.setAttribute('aria-pressed', mode === 'goals' ? 'true' : 'false');
        }
        if (settingsBtn) {
            settingsBtn.classList.toggle('is-active', mode === 'settings');
            settingsBtn.setAttribute('aria-pressed', mode === 'settings' ? 'true' : 'false');
        }

        if (mode === 'stats' && statsView) {
            statsView.removeAttribute('hidden');
            try {
                window.AnimeTracker?.StatsView?.render(statsView, animeData);
            } catch (e) {
                console.error('[StatsView] render failed:', e);
                statsView.textContent = 'Stats unavailable.';
            }
        } else if (mode === 'goals') {
            if (goalsView) goalsView.removeAttribute('hidden');
            renderGoalsView();
        } else if (mode === 'settings') {
            if (mainContent) mainContent.scrollTop = 0;
            if (settingsView) settingsView.scrollTop = 0;
            if (settingsView) settingsView.removeAttribute('hidden');
            renderSettingsView();
        }
    }

    /**
     * Render the Settings view with the current user, version and toggle states.
     * Safe to call repeatedly — re-renders idempotently. Settings IDs are
     * stable so any pre-bound handlers continue to work after re-render
     * (handlers attach via event delegation in `initEventListeners`).
     */
    async function renderSettingsView() {
        const container = document.getElementById('settingsView');
        const mainContent = document.querySelector('.main-content');
        if (!container) return;
        container.removeAttribute('hidden');
        container.scrollTop = 0;
        if (mainContent) mainContent.scrollTop = 0;

        const SettingsView = window.AnimeTracker?.SettingsView;
        if (!SettingsView) {
            container.textContent = 'Settings unavailable.';
            return;
        }

        const user = AT?.FirebaseSync?.getUser?.() || null;
        const version = chrome.runtime?.getManifest?.()?.version || null;

        // Read all toggle states from storage so the UI matches reality. We
        // can avoid this if main.js already has them in memory — but reading
        // here keeps the view self-sufficient and tolerant of out-of-band
        // changes (e.g. another popup tab toggled something).
        let storedSettings = {};
        try {
            const stored = await chrome.storage.local.get([
                COPY_GUARD_STORAGE_KEY,
                SMART_NOTIF_STORAGE_KEY,
                AUTO_SKIP_FILLER_STORAGE_KEY,
                SKIPTIME_HELPER_KEY
            ]);
            storedSettings = {
                copyGuard: stored[COPY_GUARD_STORAGE_KEY] !== false,
                smartNotif: stored[SMART_NOTIF_STORAGE_KEY] === true,
                autoSkipFiller: stored[AUTO_SKIP_FILLER_STORAGE_KEY] === true,
                skiptimeHelper: stored[SKIPTIME_HELPER_KEY] === true
            };
        } catch (e) {
            PopupLogger.warn('Settings', 'Failed to load toggle state for view:', e);
        }

        SettingsView.render(container, {
            user,
            version,
            settings: storedSettings
        });

        container.scrollTop = 0;
        if (mainContent) mainContent.scrollTop = 0;
        requestAnimationFrame(() => {
            container.scrollTop = 0;
            if (mainContent) mainContent.scrollTop = 0;
        });
    }

    function renderGoalsView() {
        const container = document.getElementById('goalsView');
        if (!container) return;
        container.removeAttribute('hidden');

        const StatsEngine = window.AnimeTracker?.StatsEngine;
        const AchievementsEngine = window.AnimeTracker?.AchievementsEngine;
        const GoalsView = window.AnimeTracker?.GoalsView;
        if (!StatsEngine || !AchievementsEngine || !GoalsView) {
            container.textContent = 'Goals engine not loaded.';
            return;
        }

        try {
            const index = StatsEngine.buildWatchIndex(animeData);
            const hourIndex = AchievementsEngine.buildHourIndex(animeData);
            GoalsView.render(container, {
                animeData,
                index,
                hourIndex,
                goalSettings,
                badgeState,
                onGoalsChanged: (next) => { goalSettings = next; }
            });

            const nextSnapshot = GoalsView.getLastBadgeEvaluation();
            const newlyUnlocked = AchievementsEngine.diffUnlocks(lastBadgeSnapshot, nextSnapshot);
            lastBadgeSnapshot = nextSnapshot;
            if (newlyUnlocked.length > 0) {
                persistBadgeUnlocks(newlyUnlocked);
            }
        } catch (e) {
            PopupLogger.error('Goals', 'render failed:', e);
            container.textContent = 'Goals unavailable.';
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

    function isQuotaExceededError(error) {
        const msg = String(error?.message || error || '').toLowerCase();
        return msg.includes('quota') || msg.includes('bytes') || msg.includes('exceeded');
    }

    function pruneDeletedAnimeForQuota(deletedAnime) {
        const source = deletedAnime && typeof deletedAnime === 'object' ? deletedAnime : {};
        const cutoff = Date.now() - 10 * 24 * 60 * 60 * 1000;
        const entries = Object.entries(source).sort((a, b) => {
            const aTs = new Date(a[1]?.deletedAt || a[1] || 0).getTime() || 0;
            const bTs = new Date(b[1]?.deletedAt || b[1] || 0).getTime() || 0;
            return bTs - aTs;
        });

        const kept = {};
        let keptCount = 0;
        for (const [slug, info] of entries) {
            const ts = new Date(info?.deletedAt || info || 0).getTime() || 0;
            if (ts > 0 && ts < cutoff) continue;
            kept[slug] = info;
            keptCount += 1;
            if (keptCount >= 1500) break;
        }
        return kept;
    }

    async function recoverFromQuotaPressure(context = 'sync') {
        const { Storage, ProgressManager } = AT;

        try {
            const all = await new Promise((resolve, reject) => {
                chrome.storage.local.get(null, (result) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    resolve(result || {});
                });
            });

            const cacheKeys = Object.keys(all).filter((key) =>
                key.startsWith('animeinfo_') || key.startsWith('episodeTypes_')
            );
            if (cacheKeys.length > 0) {
                await Storage.remove(cacheKeys);
            }

            const localAnimeData = all.animeData || {};
            const localVideoProgress = all.videoProgress || {};
            const localDeletedAnime = all.deletedAnime || {};

            const { cleaned } = ProgressManager.cleanTrackedProgress(localAnimeData, localVideoProgress, localDeletedAnime);
            const sortedProgress = Object.entries(cleaned).sort((a, b) => {
                const aTs = new Date(a[1]?.savedAt || a[1]?.watchedAt || 0).getTime() || 0;
                const bTs = new Date(b[1]?.savedAt || b[1]?.watchedAt || 0).getTime() || 0;
                return bTs - aTs;
            });
            const trimmedProgress = Object.fromEntries(sortedProgress.slice(0, 2000));
            const trimmedDeletedAnime = pruneDeletedAnimeForQuota(localDeletedAnime);

            await Storage.set({
                videoProgress: trimmedProgress,
                deletedAnime: trimmedDeletedAnime
            });

            PopupLogger.warn('Storage', `[${context}] quota recovery succeeded: removed ${cacheKeys.length} cache keys`);
            return true;
        } catch (recoveryError) {
            PopupLogger.error('Storage', `[${context}] quota recovery failed:`, recoveryError);
            return false;
        }
    }

    /**
     * Load local data
     */
    async function loadData() {
        const { Storage, ProgressManager, FillerService, UIHelpers } = AT;

        try {
            if (shouldRunMaintenance('migrateMultiPartAnime')) {
                await Storage.migrateMultiPartAnime();
            }

            const result = await Storage.get(['animeData', 'videoProgress', 'groupCoverImages', 'deletedAnime']);
            const normalized = ProgressManager.normalizeCanonicalSlugs(
                result.animeData || {}, result.videoProgress || {}, result.deletedAnime || {}
            );
            animeData = normalized.animeData || {};
            videoProgress = normalized.videoProgress || {};
            window.AnimeTracker.groupCoverImages = result.groupCoverImages || {};

            const withoutAutoRepaired = ProgressManager.removeAutoRepairedEpisodes(animeData);
            const repairedData = ProgressManager.removeDuplicateEpisodes(withoutAutoRepaired.cleanedData);
            const rawProgressForDurations = videoProgress || {};
            const { cleaned: cleanedProgress, removedCount: progressRemoved } =
                ProgressManager.cleanTrackedProgress(repairedData, videoProgress, normalized.deletedAnime || result.deletedAnime || {});

            const originalCount = UIHelpers.countEpisodes(result.animeData || {});
            const cleanedCount = UIHelpers.countEpisodes(repairedData);
            const durationFix = shouldRunMaintenance('normalizeMovieDurations')
                ? normalizeMovieDurations(repairedData, rawProgressForDurations)
                : { changed: false };
            const phantomCleanup = shouldRunMaintenance('cleanupPhantomMovies')
                ? cleanupPhantomMovies(
                    repairedData,
                    normalized.deletedAnime || result.deletedAnime || {}
                )
                : { changed: false, deletedAnime: normalized.deletedAnime || result.deletedAnime || {} };
            const needsSave =
                (originalCount !== cleanedCount) || (withoutAutoRepaired.removedCount > 0) || (progressRemoved > 0) ||
                durationFix.changed || normalized.changed || phantomCleanup.changed;

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
            await FillerService.loadStayedFillers();
            await AT.AnilistService.loadCachedData(animeData);

            if (repairAiringCompletedEntries(animeData)) {
                const payload = { animeData };
                markInternalSave(payload);
                await Storage.set(payload);
            }

            const slugsList = Object.keys(animeData);
            const { allFillersCached, allAnilistCached } = checkAllCached(slugsList);

            renderAnimeList();
            await updateStats();
            await loadGoalAndBadgeState();

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
                    realignCategoryTabs();
                }
            }

            // Fast path: render from local storage immediately so the popup
            // doesn't show a blank list while waiting for Firebase round-trips.
            // Especially important on slow mobile networks.
            await loadData();

            const data = await FirebaseSync.loadAndSyncData(elements);
            if (data) {
                const normalized = ProgressManager.normalizeCanonicalSlugs(
                    data.animeData || {}, data.videoProgress || {}, data.deletedAnime || {}
                );
                const withoutAutoRepaired = ProgressManager.removeAutoRepairedEpisodes(normalized.animeData || {});
                const repairedData = ProgressManager.removeDuplicateEpisodes(withoutAutoRepaired.cleanedData);
                const rawProgressForDurations = normalized.videoProgress || {};
                const { cleaned: cleanedProgress, removedCount: progressRemoved } =
                    ProgressManager.cleanTrackedProgress(repairedData, rawProgressForDurations, normalized.deletedAnime || data.deletedAnime || {});
                const durationFix = shouldRunMaintenance('normalizeMovieDurations_postSync')
                    ? normalizeMovieDurations(repairedData, rawProgressForDurations)
                    : { changed: false };
                const phantomCleanup = shouldRunMaintenance('cleanupPhantomMovies_postSync')
                    ? cleanupPhantomMovies(
                        repairedData,
                        normalized.deletedAnime || data.deletedAnime || {}
                    )
                    : { changed: false, deletedAnime: normalized.deletedAnime || data.deletedAnime || {} };

                animeData = repairedData;
                videoProgress = cleanedProgress;
                window.AnimeTracker.groupCoverImages = data.groupCoverImages || {};

                if (withoutAutoRepaired.removedCount > 0 || progressRemoved > 0 || durationFix.changed || normalized.changed || phantomCleanup.changed) {
                    const payload = { animeData: repairedData, videoProgress: cleanedProgress };
                    if (normalized.changed || phantomCleanup.changed) payload.deletedAnime = phantomCleanup.deletedAnime;
                    markInternalSave(payload);
                    await Storage.set(payload);
                }

                await FillerService.loadCachedEpisodeTypes(animeData);
                await FillerService.loadStayedFillers();
                await AT.AnilistService.loadCachedData(animeData);

                if (repairAiringCompletedEntries(animeData)) {
                    const payload = { animeData };
                    markInternalSave(payload);
                    await Storage.set(payload);
                }

                const slugsList = Object.keys(animeData);
                const { allFillersCached, allAnilistCached } = checkAllCached(slugsList);

                renderAnimeList(elements.searchInput?.value || '');
                await updateStats();
                await loadGoalAndBadgeState();

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
            if (isQuotaExceededError(error)) {
                const recovered = await recoverFromQuotaPressure('loadAndSyncData');
                if (recovered) {
                    await loadData();
                    return;
                }
            }
            await loadData();
        } finally {
            loadAndSyncInProgress = false;
        }
    }

    async function refreshPopupCloudData(forceFresh = false) {
        if (!AT?.FirebaseSync?.getUser?.()) return;
        if (forceFresh) {
            try { AT.FirebaseSync.clearCachedUserDocument(); } catch {}
        }
        await loadAndSyncData();
    }

    function stopPopupCloudRefresh() {
        if (popupCloudRefreshTimer) {
            clearInterval(popupCloudRefreshTimer);
            popupCloudRefreshTimer = null;
        }
    }

    function startPopupCloudRefresh() {
        stopPopupCloudRefresh();
        if (document.hidden || !AT?.FirebaseSync?.getUser?.()) return;

        // forceFresh=false — reuse the local user-document cache. The cache
        // is invalidated automatically when storage.onChanged fires for any
        // synced key (see initEventListeners), so external updates still land.
        // Forcing a fresh GET each tick was ~60 reads/hour for nothing.
        popupCloudRefreshTimer = setInterval(() => {
            refreshPopupCloudData(false).catch((error) => {
                PopupLogger.debug('Sync', 'Background popup refresh skipped:', error?.message || error);
            });
        }, POPUP_CLOUD_REFRESH_MS);
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
            showToast('Failed to delete progress. Please try again.', 'error');
        }
    }

    /**
     * Delete anime
     */
    // Tracks slugs whose delete is currently in flight to block double-click races.
    const _deletingSlugs = new Set();

    // Lightweight inline confirm toast — no native confirm() blocking, no full-page modal.
    // Returns a Promise<boolean>: resolves true on Confirm, false on Cancel / dismiss / 8s timeout.
    function showInlineConfirm({ title, body, confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true } = {}) {
        return new Promise((resolve) => {
            // Replace any prior toast so spamming actions doesn't stack them.
            document.querySelectorAll('.at-confirm-toast').forEach(n => n.remove());

            const el = document.createElement('div');
            el.className = 'at-confirm-toast' + (danger ? ' at-confirm-toast--danger' : '');
            el.setAttribute('role', 'alertdialog');
            el.setAttribute('aria-live', 'polite');
            el.innerHTML = `
                <div class="at-confirm-text">
                    ${title ? `<div class="at-confirm-title"></div>` : ''}
                    ${body  ? `<div class="at-confirm-body"></div>`  : ''}
                </div>
                <div class="at-confirm-actions">
                    <button type="button" class="at-confirm-cancel"></button>
                    <button type="button" class="at-confirm-ok"></button>
                </div>
            `;
            // Set text content separately to avoid HTML-injection through title/body params.
            if (title) el.querySelector('.at-confirm-title').textContent = title;
            if (body)  el.querySelector('.at-confirm-body').textContent = body;
            el.querySelector('.at-confirm-cancel').textContent = cancelLabel;
            el.querySelector('.at-confirm-ok').textContent = confirmLabel;

            const finish = (value) => {
                el.classList.add('at-confirm-toast--leaving');
                setTimeout(() => { try { el.remove(); } catch {} }, 180);
                clearTimeout(timeoutId);
                resolve(value);
            };
            const timeoutId = setTimeout(() => finish(false), 8000);

            el.querySelector('.at-confirm-ok').addEventListener('click', () => finish(true));
            el.querySelector('.at-confirm-cancel').addEventListener('click', () => finish(false));

            document.body.appendChild(el);
            requestAnimationFrame(() => el.classList.add('at-confirm-toast--visible'));
            // Focus the confirm button so Enter triggers, Esc cancels.
            setTimeout(() => el.querySelector('.at-confirm-ok')?.focus(), 50);
            const onKey = (e) => {
                if (e.key === 'Escape') { finish(false); document.removeEventListener('keydown', onKey, true); }
                if (e.key === 'Enter')  { finish(true);  document.removeEventListener('keydown', onKey, true); }
            };
            document.addEventListener('keydown', onKey, true);
        });
    }

    async function deleteAnime(slug) {
        const { Storage, FirebaseSync } = AT;
        if (_deletingSlugs.has(slug)) return;

        // Confirm step — protects against accidental double-clicks on the
        // delete icon. Skipped only when called programmatically via a flag.
        const animeTitle = animeData[slug]?.title || slug;
        const ok = await showInlineConfirm({
            title: 'Delete this anime?',
            body: `“${animeTitle}” will be removed from your library across all devices.`,
            confirmLabel: 'Delete',
            cancelLabel: 'Keep'
        });
        if (!ok) return;
        _deletingSlugs.add(slug);
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
                try {
                    const gcResult = await Storage.get(['groupCoverImages']);
                    await FirebaseSync.saveToCloud({
                        animeData, videoProgress: currentVideoProgress, deletedAnime,
                        groupCoverImages: gcResult.groupCoverImages || {}
                    }, true);
                } catch (syncErr) {
                    PopupLogger.error('Delete', 'Cloud sync failed:', syncErr);
                }
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
            try { AT.UIHelpers?.showToast?.('Anime deleted', { type: 'success' }); } catch {}
        } catch (e) {
            PopupLogger.error('Delete', 'Error:', e);
            try { AT.UIHelpers?.showToast?.('Failed to delete anime', { type: 'error', duration: 3500 }); }
            catch { showToast('Failed to delete anime. Please try again.', 'error'); }
        } finally {
            _deletingSlugs.delete(slug);
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
                try {
                    await FirebaseSync.saveToCloud({
                        animeData, videoProgress: currentVideoProgress, deletedAnime,
                        groupCoverImages: result.groupCoverImages || {}
                    }, true);
                } catch (syncErr) {
                    PopupLogger.error('Complete', 'Cloud sync failed:', syncErr);
                }
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
                try {
                    await FirebaseSync.saveToCloud({
                        animeData, videoProgress: currentVideoProgress, deletedAnime,
                        groupCoverImages: result.groupCoverImages || {}
                    }, true);
                } catch (syncErr) {
                    PopupLogger.error('Drop', 'Cloud sync failed:', syncErr);
                }
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
     * Toggle favorite status. Uses internal `favorite` boolean + `favoritedAt`
     * timestamp so cloud-merge picks the most recent setting on conflict.
     */
    async function toggleAnimeFavorite(slug) {
        const { Storage, FirebaseSync } = AT;
        if (!animeData[slug]) return;

        try {
            const now = new Date().toISOString();
            const wasFavorite = !!animeData[slug].favorite;
            if (wasFavorite) {
                animeData[slug].favorite = false;
                animeData[slug].favoritedAt = null;
            } else {
                animeData[slug].favorite = true;
                animeData[slug].favoritedAt = now;
            }
            animeData[slug].favoriteUpdatedAt = now;

            const dataToSave = { animeData };
            const user = FirebaseSync.getUser();
            if (user) dataToSave.userId = user.uid;
            markInternalSave(dataToSave);
            await Storage.set(dataToSave);

            if (user) {
                try {
                    const fresh = await Storage.get(['videoProgress', 'deletedAnime', 'groupCoverImages']);
                    await FirebaseSync.saveToCloud({
                        animeData,
                        videoProgress: fresh.videoProgress || {},
                        deletedAnime: fresh.deletedAnime || {},
                        groupCoverImages: fresh.groupCoverImages || {}
                    }, true);
                } catch (syncErr) {
                    PopupLogger.error('Favorite', 'Cloud sync failed:', syncErr);
                }
            }

            renderAnimeList(elements.searchInput?.value || '');
            try { AT.UIHelpers?.showToast?.(wasFavorite ? 'Removed from favorites' : 'Added to favorites', { type: 'success', duration: 1400 }); } catch {}
        } catch (e) {
            PopupLogger.error('Favorite', 'Error:', e);
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
                try {
                    await FirebaseSync.saveToCloud({
                        animeData, videoProgress: currentVideoProgress, deletedAnime,
                        groupCoverImages: result.groupCoverImages || {}
                    }, true);
                } catch (syncErr) {
                    PopupLogger.error('OnHold', 'Cloud sync failed:', syncErr);
                }
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
            try {
                await FirebaseSync.saveToCloud({
                    animeData: {},
                    videoProgress: {},
                    groupCoverImages: {},
                    deletedAnime: {}
                }, true);
            } catch (syncErr) {
                PopupLogger.error('ClearAll', 'Cloud sync failed:', syncErr);
            }
        }
        animeData = {};
        videoProgress = {};
        renderAnimeList();
        updateStats();
        hideDialog();
    }

    // Tracks the element that had focus before a modal opened so we can
    // restore focus on close (a11y best practice — without this, keyboard
    // users land back at the top of the popup instead of where they were).
    const _dialogState = new WeakMap();
    function _focusableIn(root) {
        return Array.from(root.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(el => !el.hasAttribute('hidden') && el.offsetParent !== null);
    }
    function openDialogA11y(overlay, opts = {}) {
        if (!overlay) return;
        const restoreTo = document.activeElement;
        overlay.classList.add('visible');
        overlay.setAttribute('aria-hidden', 'false');
        const trapHandler = (e) => {
            if (e.key === 'Escape' && opts.dismissOnEscape !== false) {
                e.preventDefault();
                closeDialogA11y(overlay);
                opts.onCancel?.();
                return;
            }
            if (e.key !== 'Tab') return;
            const focusables = _focusableIn(overlay);
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        overlay.addEventListener('keydown', trapHandler);
        _dialogState.set(overlay, { restoreTo, trapHandler });
        // Focus first focusable element on next tick so the dialog renders first.
        requestAnimationFrame(() => {
            const focusables = _focusableIn(overlay);
            (opts.initialFocus || focusables[0])?.focus();
        });
    }
    function closeDialogA11y(overlay) {
        if (!overlay) return;
        const state = _dialogState.get(overlay);
        if (state) {
            overlay.removeEventListener('keydown', state.trapHandler);
            _dialogState.delete(overlay);
            try { state.restoreTo?.focus?.(); } catch {}
        }
        overlay.classList.remove('visible');
        overlay.setAttribute('aria-hidden', 'true');
    }

    function showDialog() { openDialogA11y(elements.confirmDialog); }
    function hideDialog() { closeDialogA11y(elements.confirmDialog); }

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
        openDialogA11y(elements.addAnimeDialog, {
            initialFocus: elements.animeSlugInput,
            onCancel: hideAddAnimeDialog
        });
    }

    function hideAddAnimeDialog() {
        closeDialogA11y(elements.addAnimeDialog);
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
            PopupLogger.warn('WatchlistSync', 'popup error:', e.message);
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

            // Fetch cover image + site metadata (incl. runtime) for the newly added
            // anime in background. Also triggers when any episode has a placeholder
            // duration — mostly movies, which seed with duration=0 in the add flow.
            const isPlaceholderDur = window.AnimeTrackerMergeUtils?.isPlaceholderDuration
                || ((d) => { const v = Number(d) || 0; return v <= 0 || v === 1440 || v === 6000 || v === 7200; });
            const hasPlaceholderDuration = Array.isArray(animeData[slug].episodes)
                && animeData[slug].episodes.some(ep => isPlaceholderDur(ep?.duration));
            if (!animeData[slug].coverImage || hasPlaceholderDuration) {
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
            showToast('Failed to add anime. Please try again.', 'error');
        } finally {
            elements.confirmAddAnime.disabled = false;
            elements.confirmAddAnime.textContent = 'Add Anime';
        }
    }

    function showEditTitleDialog(slug) {
        if (!animeData[slug]) { PopupLogger.warn('EditTitle', 'Anime not found:', slug); return; }
        editingSlug = slug;
        elements.editTitleInput.value = animeData[slug].title || '';
        openDialogA11y(elements.editTitleDialog, {
            initialFocus: elements.editTitleInput,
            onCancel: hideEditTitleDialog
        });
        // Pre-select text so user can replace immediately.
        try { elements.editTitleInput.select(); } catch {}
    }

    function hideEditTitleDialog() {
        closeDialogA11y(elements.editTitleDialog);
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
            try { AT.UIHelpers?.showToast?.('Title updated', { type: 'success' }); } catch {}
        } catch (error) {
            PopupLogger.error('EditTitle', 'Error:', error);
            try { AT.UIHelpers?.showToast?.('Failed to update title', { type: 'error', duration: 3500 }); }
            catch { showToast('Failed to update title. Please try again.', 'error'); }
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
            // Chunk the remove() so we don't hit MAX_WRITE_OPERATIONS_PER_MINUTE
            // on libraries with hundreds of anime. 100 keys/call is well under
            // any chrome.storage limit and avoids one giant transaction.
            const REMOVE_CHUNK = 100;
            for (let i = 0; i < infoKeys.length; i += REMOVE_CHUNK) {
                const chunk = infoKeys.slice(i, i + REMOVE_CHUNK);
                try {
                    await Storage.remove(chunk);
                } catch (error) {
                    PopupLogger.warn('RefreshAll', `chunk remove failed at ${i}:`, error?.message || error);
                    // Don't break — continue with remaining chunks so we
                    // still clear most of the cache and proceed to refetch.
                }
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

        if (animeData?.[slug] && repairAiringCompletedEntries(animeData, { slugs: [slug] })) {
            const payload = { animeData };
            markInternalSave(payload);
            AT.Storage.set(payload).catch((error) => {
                PopupLogger.warn('AnimeInfo', 'Failed to persist repaired completion state:', error);
            });
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

    // Non-blocking toast that replaces native alert() in error paths. alert()
    // freezes the popup and feels broken; this matches the rest of the toast UX.
    function showToast(message, type = 'error') {
        const existing = document.getElementById('atGenericToast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'atGenericToast';
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
        toast.textContent = String(message || '');
        toast.style.cssText = `
            position:fixed; bottom:18px; left:50%; transform:translateX(-50%);
            background:${type === 'error' ? 'rgba(240,69,69,0.95)' : 'rgba(54,212,116,0.95)'};
            color:#fff; padding:10px 18px; border-radius:14px; font-size:13px;
            font-weight:600; z-index:10001; max-width:calc(100vw - 32px);
            box-shadow:0 6px 22px rgba(0,0,0,0.45); animation:fadeIn 0.18s ease;
            word-wrap:break-word; text-align:center;`;
        document.body.appendChild(toast);
        setTimeout(() => { try { toast.remove(); } catch {} }, 4000);
    }
    // Expose so other popup modules (share-card, etc.) can use the same
    // toast UX instead of falling back to native alert().
    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.showToast = showToast;

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
            exportTokenBtn.addEventListener('click', async () => {                try {
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
                                <textarea class="export-token-text" readonly></textarea>
                                <div class="export-token-actions">
                                    <button class="btn-copy-token">Copy Token</button>
                                    <button class="btn-close-token">Close</button>
                                </div>
                            </div>
                        </div>
                    `;
                    overlay.querySelector('.export-token-text').value = tokenStr;
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
                    showToast('Export failed: ' + (err?.message || err), 'error');
                }
            });
        }

        if (elements.settingsBtn) {
            // Settings is now a view-mode (full popup) like Stats/Goals.
            // Click toggles between settings view and library; click any other
            // view button to switch directly.
            elements.settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (elements.donateDropdown) elements.donateDropdown.classList.remove('visible');
                if (elements.sortDropdown) elements.sortDropdown.classList.remove('visible');
                if (elements.sortBtn) elements.sortBtn.classList.remove('active');
                const next = currentViewMode === 'settings' ? null : 'settings';
                setViewMode(next);
            });
        }

        document.addEventListener('click', (e) => {
            // Donate sub-popover still works the same way (it's not part of
            // the settings view; it's a small floating panel).
            if (elements.donateDropdown &&
                !elements.donateDropdown.contains(e.target) &&
                (!getSettingsDonateButton() || !getSettingsDonateButton().contains(e.target))) {
                closeDonateDropdown();
            }
        });

        document.addEventListener('click', (e) => {
            const donateTrigger = e.target.closest('#settingsDonate');
            if (donateTrigger) {
                e.stopPropagation();                setSettingsDataToolsExpanded(false);
                setSettingsPreferencesExpanded(false);
                setTimeout(openDonateDropdown, 80);
            }
        });

        const settingsViewEl = document.getElementById('settingsView');
        settingsViewEl?.addEventListener('scroll', () => {
            if (elements.donateDropdown?.classList.contains('visible')) {
                positionDonateDropdown();
            }
        }, { passive: true });

        window.addEventListener('resize', () => {
            if (elements.donateDropdown?.classList.contains('visible')) {
                positionDonateDropdown();
            }
        });

        // ── Settings view delegated handlers ─────────────────────────────
        // The settings view DOM is built lazily by settings-view.js when the
        // user opens it, so the buttons don't exist when initEventListeners
        // runs. Caching them at IIFE-init time gave us null references and
        // every toggle silently did nothing. Single delegator below survives
        // every (re-)render and keeps wiring in one place.
        const handleToggle = async (key, renderFn, getNext, onAfterSave) => {
            const btn = document.getElementById(key.btnId);
            if (!btn) return;
            const currentlyEnabled = getNext.read(btn);
            const nextEnabled = !currentlyEnabled;
            renderFn(nextEnabled);
            try {
                await chrome.storage.local.set({ [key.storageKey]: nextEnabled });
                if (onAfterSave) onAfterSave(nextEnabled);
            } catch (error) {
                PopupLogger.error('Settings', `Failed to update ${key.btnId}:`, error);
                renderFn(currentlyEnabled);
            }
        };

        document.addEventListener('click', async (e) => {
            // Walk through known settings buttons. closest() handles clicks on
            // child nodes (icons, labels) inside each button.
            if (e.target.closest('#settingsCopyGuard')) {
                e.stopPropagation();
                await handleToggle(
                    { btnId: 'settingsCopyGuard', storageKey: COPY_GUARD_STORAGE_KEY },
                    renderCopyGuardSetting,
                    { read: (btn) => btn.dataset.enabled !== 'false' }
                );
                return;
            }
            if (e.target.closest('#settingsSmartNotif')) {
                e.stopPropagation();
                await handleToggle(
                    { btnId: 'settingsSmartNotif', storageKey: SMART_NOTIF_STORAGE_KEY },
                    renderSmartNotifSetting,
                    { read: (btn) => btn.dataset.enabled === 'true' },
                    (enabled) => chrome.runtime.sendMessage({ type: 'SET_SMART_NOTIFICATIONS', enabled })
                );
                return;
            }
            if (e.target.closest('#settingsAutoSkipFiller')) {
                e.stopPropagation();
                await handleToggle(
                    { btnId: 'settingsAutoSkipFiller', storageKey: AUTO_SKIP_FILLER_STORAGE_KEY },
                    renderAutoSkipFillerSetting,
                    { read: (btn) => btn.dataset.enabled === 'true' }
                );
                return;
            }
            if (e.target.closest('#settingsSkiptime')) {
                e.stopPropagation();
                await handleToggle(
                    { btnId: 'settingsSkiptime', storageKey: SKIPTIME_HELPER_KEY },
                    renderSkiptimeHelperSetting,
                    { read: (btn) => btn.dataset.enabled === 'true' },
                    (enabled) => AT.UIHelpers?.showToast?.(
                        enabled ? 'Skiptime helper enabled' : 'Skiptime helper disabled',
                        { type: 'success', duration: 1600 }
                    )
                );
                return;
            }

            const dataToolsToggle = e.target.closest('#settingsDataToolsToggle');
            if (dataToolsToggle) {
                e.stopPropagation();
                const dataTools = document.getElementById('settingsDataTools');
                const isExpanded = dataTools?.classList.contains('expanded');
                setSettingsDataToolsExpanded(!isExpanded);
                setSettingsPreferencesExpanded(false);
                return;
            }

            const prefsToggle = e.target.closest('#settingsPreferencesToggle');
            if (prefsToggle) {
                e.stopPropagation();
                const prefs = document.getElementById('settingsPreferences');
                const isExpanded = prefs?.classList.contains('expanded');
                setSettingsPreferencesExpanded(!isExpanded);
                setSettingsDataToolsExpanded(false);
                return;
            }

            const refreshBtn = e.target.closest('#settingsRefresh');
            if (refreshBtn) {
                refreshBtn.classList.add('loading');
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
                    refreshBtn.classList.remove('loading');
                }
                return;
            }

            const refreshInfoBtn = e.target.closest('#settingsRefreshInfo');
            if (refreshInfoBtn) {
                const { Storage, AnilistService } = AT;
                refreshInfoBtn.classList.add('loading');
                setSettingsDataToolsExpanded(false);
                setSettingsPreferencesExpanded(false);
                try {
                    const allKeys = await new Promise((resolve) => chrome.storage.local.get(null, (r) => {
                        // Surface storage failures instead of silently treating them as empty.
                        if (chrome.runtime.lastError) {
                            PopupLogger.warn('Storage', 'get(null) error:', chrome.runtime.lastError.message);
                            resolve({});
                            return;
                        }
                        resolve(r || {});
                    }));
                    const infoKeys = Object.keys(allKeys).filter(k => k.startsWith('animeinfo_'));
                    if (infoKeys.length > 0) await Storage.remove(infoKeys);
                    AnilistService.cache = {};
                    startAutoSync();
                    await AnilistService.autoFetchMissing(animeData, () => {
                        scheduleDeferredListRefresh();
                    }, (done, total, title) => {
                        setMetadataRepairStatus(`${done}/${total} — ${_truncTitle(title, 18)}`);
                    });
                    endAutoSync();
                } catch (err) {
                    PopupLogger.error('RefreshInfo', 'Error:', err);
                    endAutoSync();
                } finally {
                    refreshInfoBtn.classList.remove('loading');
                }
                return;
            }

            if (e.target.closest('#settingsClear')) {
                setSettingsDataToolsExpanded(false);
                setSettingsPreferencesExpanded(false);
                showDialog();
                return;
            }

            if (e.target.closest('#settingsExportData')) {
                setSettingsDataToolsExpanded(false);
                exportLibraryToJson().catch((err) => {
                    PopupLogger.error('Export', err);
                    AT.UIHelpers?.showToast?.('Export failed', { type: 'error', duration: 3500 });
                });
                return;
            }

            if (e.target.closest('#settingsImportData')) {
                const fileInput = document.getElementById('settingsImportFile');
                if (fileInput) {
                    fileInput.value = '';
                    fileInput.click();
                }
                return;
            }

            if (e.target.closest('#settingsSignOut')) {
                setSettingsDataToolsExpanded(false);
                setSettingsPreferencesExpanded(false);
                signOut();
                return;
            }

            if (e.target.closest('#settingsFetchFillers')) {
                setSettingsDataToolsExpanded(false);
                setSettingsPreferencesExpanded(false);
                await fetchAllFillers({ autoStart: true });
                return;
            }
        });

        document.addEventListener('change', async (e) => {
            if (e.target?.id === 'settingsImportFile') {
                const file = e.target.files?.[0];
                if (!file) return;
                setSettingsDataToolsExpanded(false);
                try {
                    await importLibraryFromFile(file);
                } catch (err) {
                    PopupLogger.error('Import', err);
                    AT.UIHelpers?.showToast?.(err?.message || 'Import failed', {
                        type: 'error', duration: 4000
                    });
                } finally {
                    e.target.value = '';
                }
            }
        });

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
                if (!containerRect.width || !tabRect.width) return;
                const offsetX = tabRect.left - containerRect.left - 4; // 4px padding
                slider.style.width = tabRect.width + 'px';
                slider.style.transform = `translateX(${offsetX}px)`;
                slider.classList.add('is-ready');
                elements.categoryTabs.classList.add('slider-ready');
                if (instant) {
                    slider.style.transition = 'none';
                    slider.offsetHeight; // force reflow
                    slider.style.transition = '';
                }
            }

            realignCategoryTabs = () => {
                const activeTab = elements.categoryTabs?.querySelector('.category-tab.active');
                if (!activeTab) return;

                const attempt = (retriesLeft = 3) => {
                    requestAnimationFrame(() => {
                        const tabRect = activeTab.getBoundingClientRect();
                        const containerRect = elements.categoryTabs.getBoundingClientRect();
                        if ((!tabRect.width || !containerRect.width) && retriesLeft > 0) {
                            attempt(retriesLeft - 1);
                            return;
                        }
                        moveSlider(activeTab, true);
                    });
                };

                attempt();
            };

            // Initial position (no animation)
            const initialActive = elements.categoryTabs.querySelector('.category-tab.active');
            requestAnimationFrame(() => moveSlider(initialActive, true));

            elements.categoryTabs.querySelectorAll('.category-tab').forEach(tab => {
                tab.addEventListener('click', async () => {
                    const rawCat = tab.dataset.category;
                    elements.categoryTabs.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');

                    const appRoot = document.querySelector('.app');

                    // Switching a category exits any view mode (stats/goals)
                    setViewMode(null);

                    requestAnimationFrame(() => moveSlider(tab, false));

                    currentCategory = normalizeCategory(rawCat);
                    if (elements.searchInput) renderAnimeList(elements.searchInput.value);
                    await chrome.storage.local.set({ userPreferences: { sort: currentSort, category: currentCategory } });
                });
            });
        }

        // ─── Header view-mode toggles (Stats / Goals icon buttons) ──────────
        const viewStatsBtn = document.getElementById('viewStatsBtn');
        const viewGoalsBtn = document.getElementById('viewGoalsBtn');

        if (viewStatsBtn) {
            viewStatsBtn.addEventListener('click', () => {
                const next = currentViewMode === 'stats' ? null : 'stats';
                setViewMode(next);
            });
        }
        if (viewGoalsBtn) {
            viewGoalsBtn.addEventListener('click', async () => {
                if (currentViewMode === 'goals') {
                    setViewMode(null);
                    return;
                }
                if (goalSettings === null) {
                    await loadGoalAndBadgeState();
                }
                setViewMode('goals');
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
                // Invalidate stats + achievements caches so views reflect new data
                try { window.AnimeTracker?.StatsEngine?.invalidate(); } catch {}
                try { window.AnimeTracker?.AchievementsEngine?.invalidate(); } catch {}
                const statsView = document.getElementById('statsView');
                const appRoot = document.querySelector('.app');
                if (statsView && appRoot && appRoot.classList.contains('stats-mode')) {
                    try { window.AnimeTracker.StatsView.render(statsView, animeData); } catch {}
                }
                if (appRoot && appRoot.classList.contains('goals-mode')) {
                    try { renderGoalsView(); } catch {}
                }
            }
            if (changes[GOAL_SETTINGS_KEY]) {
                goalSettings = changes[GOAL_SETTINGS_KEY].newValue || null;
                const appRoot = document.querySelector('.app');
                if (appRoot && appRoot.classList.contains('goals-mode')) {
                    try { renderGoalsView(); } catch {}
                }
            }
            if (changes[BADGE_STATE_KEY]) {
                badgeState = changes[BADGE_STATE_KEY].newValue || {};
                const appRoot = document.querySelector('.app');
                if (appRoot && appRoot.classList.contains('goals-mode')) {
                    try { renderGoalsView(); } catch {}
                }
            }
            if (changes.groupCoverImages) {
                window.AnimeTracker.groupCoverImages = changes.groupCoverImages.newValue || {};
                needsFullRender = true;
                if (!isOwn) isExternalUpdate = true;
            }
            if (changes.fillerStaySelections) {
                try {
                    AT.FillerService.setStayedFillersCache(changes.fillerStaySelections.newValue || {});
                } catch {}
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

            // Cache invalidation: when an external writer (SSE → SW → storage,
            // or another tab) touches one of the Firebase-synced keys, drop
            // the popup's cached cloud user document so the next sync reads
            // fresh state instead of serving stale cloud data for up to the
            // full cache TTL.
            if (isExternalUpdate && (
                changes.animeData ||
                changes.videoProgress ||
                changes.deletedAnime ||
                changes.groupCoverImages
            )) {
                try { FirebaseSync.clearCachedUserDocument(); } catch {}
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

                if (target.classList.contains('anime-favorite-toggle') || target.closest('.anime-favorite-toggle')) {
                    const btn = target.classList.contains('anime-favorite-toggle') ? target : target.closest('.anime-favorite-toggle');
                    if (btn.dataset.slug) await toggleAnimeFavorite(btn.dataset.slug);
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

        // Tell the SW that the popup is alive so it wakes the SSE stream. The
        // port auto-disconnects when the popup closes, letting the SW drop
        // back into idle (0 Firestore reads/writes) if no an1me.to tab is open.
        try {
            const _popupAlivePort = chrome.runtime.connect({ name: 'popupAlive' });
            // Hold a reference in case of GC heuristics; no-op otherwise.
            window.__popupAlivePort = _popupAlivePort;
        } catch (e) {
            PopupLogger.debug('Init', 'popupAlive port connect failed:', e?.message || e);
        }

        FillerFetchUI.init();

        try {
            const manifest = chrome.runtime.getManifest();
            await Storage.invalidateCachedStats(manifest?.version || '');
        } catch (e) {
            PopupLogger.warn('Init', 'Could not check cachedStats version:', e);
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
            loadAutoSkipFillerSetting(),
            loadSkiptimeHelperSetting()
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
                    const { cleaned, removedCount } = ProgressManager.cleanTrackedProgress(raw.animeData, raw.videoProgress, raw.deletedAnime || {});
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
                await refreshPopupCloudData(true);
                startPopupCloudRefresh();
                if (pendingAutoRepairAfterSignIn) {
                    pendingAutoRepairAfterSignIn = false;
                    await fetchAllFillers({ autoStart: true });
                }
            },
            onUserSignedOut: () => {
                stopPopupCloudRefresh();
                showAuthScreen();
            },
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

    // ─── Global keyboard shortcuts ───────────────────────────────────────
    // `/`        → focus the search input (skipped while typing in another field)
    // `Esc`      → close any open dialog / dropdown / view-mode in priority order
    document.addEventListener('keydown', (e) => {
        const target = e.target;
        const isTypingTarget = target && (
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable
        );

        if (e.key === '/' && !isTypingTarget && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (elements.searchInput) {
                e.preventDefault();
                elements.searchInput.focus();
                elements.searchInput.select?.();
            }
            return;
        }

        if (e.key === 'Escape') {
            // Priority: open dialogs > dropdowns > active view mode.
            const openDialog =
                document.querySelector('.confirm-dialog.visible') ||
                document.querySelector('.dialog.visible') ||
                document.querySelector('[role="dialog"][aria-modal="true"]:not([hidden])');
            if (openDialog) {
                const cancel = openDialog.querySelector('[data-dialog-cancel], .btn-cancel, .dialog-cancel');
                if (cancel) { cancel.click(); return; }
            }
            if (elements.sortDropdown?.classList.contains('visible')) {
                elements.sortDropdown.classList.remove('visible');
                elements.sortBtn?.classList.remove('active');
                return;
            }
            if (currentViewMode) {
                setViewMode(null);
                return;
            }
            // If search is non-empty, clear it instead of doing nothing.
            if (elements.searchInput && elements.searchInput.value && document.activeElement === elements.searchInput) {
                elements.searchInput.value = '';
                elements.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    });

    window.addEventListener('beforeunload', () => {
        stopPopupCloudRefresh();
        AT.FirebaseSync.cleanup();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopPopupCloudRefresh();
            AT.FirebaseSync.cleanup();
            return;
        }

        startPopupCloudRefresh();
        refreshPopupCloudData(true).catch((error) => {
            PopupLogger.debug('Sync', 'Visibility refresh skipped:', error?.message || error);
        });
    });

    init();

})();
