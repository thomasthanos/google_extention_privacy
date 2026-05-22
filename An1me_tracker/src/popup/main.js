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
    let emailAuthMode = 'signIn';
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
    let categorySwitchTimer = null;
    // 5min interval — reuses the FirebaseSync user-document cache (TTL also
    // 5min) and the SW's `_BG_CLOUD_TTL`, so each tick costs at most 1 read
    // and only when the cache window has rolled over. Was 60s+forceFresh,
    // which produced ~60 Firestore reads/hour just for an idle open popup.
    const POPUP_CLOUD_REFRESH_MS = 5 * 60 * 1000;
    // Avoid back-to-back full merges when sign-in, visibility, and the 5-min
    // timer fire close together — each used to run a full Firestore merge.
    const POPUP_FULL_SYNC_MIN_GAP_MS = 30 * 1000;
    let popupCloudRefreshTimer = null;
    let lastPopupFullSyncAt = 0;

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

    // ── Toggle settings registry ─────────────────────────────────────────
    // Previously each toggle had its own near-identical render/load pair
    // (~50 lines × 4). Now they share one declarative config — adding a new
    // toggle is one entry. `loadToggleSetting` reads + renders; `renderToggle`
    // updates aria-pressed/subtitle. Storage change listeners and click
    // handlers in initEventListeners drive these the same way.
    //
    // `defaultsTo` decides what the toggle reads as when storage is missing.
    // `interpret` decides how raw storage values map to a boolean — copy-guard
    // uses inverse-default semantics (anything other than `false` means ON).
    const SMART_NOTIF_STORAGE_KEY = 'smartNotificationsEnabled';
    const AUTO_SKIP_FILLER_STORAGE_KEY = 'autoSkipFillers';
    // Skiptime helper toggle (Playback & Tracking card). The floating panel
    // lives in src/content/skiptime-helper.js and listens for chrome.storage
    // changes on this key to mount/unmount itself live.
    const SKIPTIME_HELPER_KEY = 'skiptimeHelperEnabled';

    const TOGGLE_SETTINGS = {
        copyGuard: {
            btnId: 'settingsCopyGuard',
            subtitleId: 'settingsCopyGuardSubtitle',
            storageKey: COPY_GUARD_STORAGE_KEY,
            defaultsTo: true,
            interpret: (raw) => raw !== false,
            copy: {
                on: 'Block copy outside allowed text',
                off: 'Copy protection is turned off'
            }
        },
        smartNotif: {
            btnId: 'settingsSmartNotif',
            subtitleId: 'settingsSmartNotifSubtitle',
            storageKey: SMART_NOTIF_STORAGE_KEY,
            defaultsTo: false,
            interpret: (raw) => raw === true,
            copy: {
                on: 'You will be notified of new episodes',
                off: 'Notify when new episodes drop'
            }
        },
        autoSkipFiller: {
            btnId: 'settingsAutoSkipFiller',
            subtitleId: 'settingsAutoSkipFillerSubtitle',
            storageKey: AUTO_SKIP_FILLER_STORAGE_KEY,
            defaultsTo: false,
            interpret: (raw) => raw === true,
            copy: {
                on: 'Filler episodes will be auto-skipped',
                off: 'Skip filler, jump to next canon ep'
            }
        },
        skiptime: {
            btnId: 'settingsSkiptime',
            subtitleId: 'settingsSkiptimeSubtitle',
            storageKey: SKIPTIME_HELPER_KEY,
            defaultsTo: false,
            interpret: (raw) => raw === true,
            copy: {
                on: 'Capture intro/outro on an1me.to/watch',
                off: 'Floating panel for intro/outro contributions'
            }
        }
    };

    function renderToggle(toggleId, enabled) {
        // Settings DOM is rendered lazily by SettingsView, so look up live.
        const config = TOGGLE_SETTINGS[toggleId];
        if (!config) return;
        const btn = document.getElementById(config.btnId);
        if (!btn) return;
        btn.dataset.enabled = enabled ? 'true' : 'false';
        btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        const subtitle = document.getElementById(config.subtitleId);
        if (subtitle) subtitle.textContent = enabled ? config.copy.on : config.copy.off;
    }

    async function loadToggleSetting(toggleId) {
        const config = TOGGLE_SETTINGS[toggleId];
        if (!config) return false;
        try {
            const result = await chrome.storage.local.get([config.storageKey]);
            const enabled = config.interpret(result[config.storageKey]);
            renderToggle(toggleId, enabled);
            return enabled;
        } catch (error) {
            PopupLogger.warn('Settings', `Failed to load ${toggleId} setting:`, error);
            renderToggle(toggleId, config.defaultsTo);
            return config.defaultsTo;
        }
    }

    // Back-compat aliases: a handful of older callers reach for these by name
    // (e.g. storage.onChanged → renderCopyGuardSetting). Keep them as thin
    // wrappers so the diff stays localized to this section.
    const renderCopyGuardSetting = (enabled) => renderToggle('copyGuard', enabled);
    const renderSmartNotifSetting = (enabled) => renderToggle('smartNotif', enabled);
    const renderAutoSkipFillerSetting = (enabled) => renderToggle('autoSkipFiller', enabled);
    const renderSkiptimeHelperSetting = (enabled) => renderToggle('skiptime', enabled);
    const loadCopyGuardSetting = () => loadToggleSetting('copyGuard');
    const loadSmartNotifSetting = () => loadToggleSetting('smartNotif');
    const loadAutoSkipFillerSetting = () => loadToggleSetting('autoSkipFiller');
    const loadSkiptimeHelperSetting = () => loadToggleSetting('skiptime');

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

    function renderCategorySwitch(filter = '') {
        if (!elements.animeList) {
            renderAnimeList(filter);
            return;
        }

        if (categorySwitchTimer) {
            clearTimeout(categorySwitchTimer);
            categorySwitchTimer = null;
        }

        elements.animeList.classList.add('category-switching');
        categorySwitchTimer = setTimeout(() => {
            categorySwitchTimer = null;
            renderAnimeList(filter);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    elements.animeList?.classList.remove('category-switching');
                });
            });
        }, 90);
    }

    function normalizeCompactStatus(value) {
        const allowed = new Set(['airing', 'on_hold', 'completed', 'dropped']);
        return allowed.has(value) ? value : 'airing';
    }

    const {
        AnimeStatus,
        getStatus: getAnimeStatus,
        isCompleted: isAnimeCompleted,
        repairAiringCompleted: repairAiringCompletedEntries,
        persistDetectedCompletions
    } = AT.StatusService;

    // normalizeMovieDurations + cleanupPhantomMovies live in
    // src/popup/maintenance.js — pure helpers, independently testable.
    const { normalizeMovieDurations, cleanupPhantomMovies } = AT.Maintenance;

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
    // ── renderAnimeList helpers ──────────────────────────────────────
    //
    // Read/restore the "what was expanded?" state so a re-render doesn't
    // visually collapse everything the user had opened. Driven by stable
    // dataset slugs on each row.
    function captureExpansionState(listEl) {
        const expandedCards = new Set();
        listEl.querySelectorAll('.anime-card.expanded').forEach(card => {
            const slug = card.querySelector('.anime-delete')?.dataset?.slug;
            if (slug) expandedCards.add(slug);
        });
        const expandedSeasonGroups = new Set();
        listEl.querySelectorAll('.anime-season-group.expanded').forEach(g => {
            if (g.dataset.baseSlug) expandedSeasonGroups.add(g.dataset.baseSlug);
        });
        const expandedSeasonItems = new Set();
        listEl.querySelectorAll('.season-item.expanded').forEach(item => {
            if (item.dataset.slug) expandedSeasonItems.add(item.dataset.slug);
        });
        const expandedMovieGroups = new Set();
        listEl.querySelectorAll('.anime-movie-group.expanded').forEach(g => {
            if (g.dataset.baseSlug) expandedMovieGroups.add(g.dataset.baseSlug);
        });
        const ipGroupWasOpen = listEl.querySelector('.ip-group-content')?.classList.contains('open') ?? false;
        return { expandedCards, expandedSeasonGroups, expandedSeasonItems, expandedMovieGroups, ipGroupWasOpen };
    }

    function restoreExpansionState(listEl, state) {
        listEl.querySelectorAll('.anime-card').forEach(card => {
            const slug = card.querySelector('.anime-delete')?.dataset?.slug;
            if (slug && state.expandedCards.has(slug)) card.classList.add('expanded');
        });
        listEl.querySelectorAll('.anime-season-group').forEach(g => {
            if (g.dataset.baseSlug && state.expandedSeasonGroups.has(g.dataset.baseSlug))
                g.classList.add('expanded');
        });
        listEl.querySelectorAll('.season-item').forEach(item => {
            if (item.dataset.slug && state.expandedSeasonItems.has(item.dataset.slug))
                item.classList.add('expanded');
        });
        listEl.querySelectorAll('.anime-movie-group').forEach(g => {
            if (g.dataset.baseSlug && state.expandedMovieGroups.has(g.dataset.baseSlug))
                g.classList.add('expanded');
        });
        if (state.ipGroupWasOpen) {
            const ipContent = listEl.querySelector('.ip-group-content');
            const ipChevron = listEl.querySelector('.ip-group-chevron');
            if (ipContent) ipContent.classList.add('open');
            if (ipChevron) ipChevron.style.transform = 'rotate(0deg)';
        }
    }

    /**
     * Group entries by base slug (multi-season / multi-movie clusters),
     * sort the groups so they keep the order of the supplied `orderMap`,
     * and render each via AnimeCardRenderer. Single helper avoids the
     * duplicated `renderGroupedEntries` / `renderCompletedGroupedEntries`
     * branches the old code had.
     */
    function renderEntryGroupsHtml(entriesToRender, orderMap, visibleProgress) {
        if (!entriesToRender.length) return '';
        const { AnimeCardRenderer, SeasonGrouping } = AT;

        const groups = SeasonGrouping.groupByBase(entriesToRender);
        const groupsArray = Array.from(groups.entries());
        groupsArray.sort((a, b) => {
            const aIndex = Math.min(...a[1].map(e => orderMap.get(e.slug) ?? Number.MAX_SAFE_INTEGER));
            const bIndex = Math.min(...b[1].map(e => orderMap.get(e.slug) ?? Number.MAX_SAFE_INTEGER));
            return aIndex - bIndex;
        });

        let html = '';
        for (const [baseSlug, groupedEntries] of groupsArray) {
            if (SeasonGrouping.isMovieGroup(groupedEntries)) {
                if (groupedEntries.length > 1) {
                    html += AnimeCardRenderer.createMovieGroup(baseSlug, groupedEntries);
                } else {
                    const { slug, anime } = groupedEntries[0];
                    html += AnimeCardRenderer.createSingleMovieCard(slug, anime);
                }
            } else if (SeasonGrouping.hasMultipleSeasons(groupedEntries)) {
                html += AnimeCardRenderer.createSeasonGroup(baseSlug, groupedEntries, visibleProgress);
            } else {
                const { slug, anime } = groupedEntries[0];
                html += AnimeCardRenderer.createAnimeCard(slug, anime, visibleProgress);
            }
        }
        return html;
    }

    /**
     * Build the HTML for one of the four compact-status sections
     * (Airing / On Hold / Completed / Dropped). All four had identical
     * markup; CSS classes use a lowercase prefix while the toggle ID is
     * historically camelCase, so we accept both as explicit params to
     * avoid the old code's div-per-section duplication.
     */
    function renderCompactSectionHtml({ classPrefix, toggleId, label, subLabel, cardsHtml, isOpen }) {
        return `
            <div class="${classPrefix}-list-section">
                <div class="${classPrefix}-list-label" id="${toggleId}">
                    <div class="${classPrefix}-list-label-left">
                        <span class="${classPrefix}-list-label-title">${label}</span>
                        <span class="${classPrefix}-list-label-sub">${subLabel}</span>
                    </div>
                    <svg class="${classPrefix}-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform: ${isOpen ? 'rotate(0deg)' : 'rotate(-90deg)'}">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
                <div class="${classPrefix}-list-cards${isOpen ? ' open' : ''}">
                    <div class="list-inner">
                        ${cardsHtml}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Partition entries into the five buckets the UI shows. Single pass —
     * each entry is checked once. Completed entries get a stable lastWatched
     * sort so the most recently finished bubble to the top.
     */
    function partitionEntriesByStatus(sortedEntries) {
        const normal = [];
        const completed = [];
        const dropped = [];
        const airing = [];
        const onHold = [];
        for (const entry of sortedEntries) {
            switch (getAnimeStatus(entry[0], entry[1])) {
                case AnimeStatus.DROPPED:   dropped.push(entry); break;
                case AnimeStatus.COMPLETED: completed.push(entry); break;
                case AnimeStatus.AIRING:    airing.push(entry); break;
                case AnimeStatus.ON_HOLD:   onHold.push(entry); break;
                default:                    normal.push(entry); break;
            }
        }
        completed.sort(([, a], [, b]) =>
            new Date(b.lastWatched || 0).getTime() - new Date(a.lastWatched || 0).getTime()
        );
        return { normal, completed, dropped, airing, onHold };
    }

    /**
     * Walk videoProgress once and bucket the latest savedAt per slug.
     * Combined with each anime's lastWatched to give the "date" sort its key.
     * Replaces an old O(N×M) loop that re-iterated videoProgress per anime.
     */
    function buildLatestActivityMap(entries, videoProgress) {
        const progressLatestBySlug = new Map();
        for (const [id, progress] of Object.entries(videoProgress || {})) {
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
        return latestMap;
    }

    /**
     * Build the O(1) slug → entries index that anime-card.js reads via the
     * non-enumerable `__slugIndex` property. Defined non-enumerable so it
     * doesn't show up in JSON.stringify or Object.entries snapshots.
     */
    function attachSlugIndex(visibleProgress) {
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
    }

    function renderAnimeList(filter = '') {
        const { AnimeCardRenderer, ProgressManager, SeasonGrouping } = AT;

        const expansionState = captureExpansionState(elements.animeList);

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
        attachSlugIndex(visibleProgress);

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

        const latestMap = buildLatestActivityMap(entries, videoProgress);

        // Sort all entries according to the active sort mode
        const sortedEntries = entries.sort((a, b) => {
            const [, animeA] = a;
            const [, animeB] = b;
            switch (currentSort) {
                case 'date':     return latestMap.get(b[0]) - latestMap.get(a[0]);
                case 'name':     return animeA.title.localeCompare(animeB.title, 'en');
                case 'episodes': return (animeB.episodes?.length || 0) - (animeA.episodes?.length || 0);
                default:         return 0;
            }
        });

        const orderMap = new Map(sortedEntries.map(([slug], index) => [slug, index]));
        const { normal: normalEntries, completed: completedEntries, dropped: droppedEntries,
                airing: airingEntries, onHold: onHoldEntries } = partitionEntriesByStatus(sortedEntries);

        const completedOrderMap = new Map(completedEntries.map(([slug], index) => [slug, index]));

        const trackedHtml        = renderEntryGroupsHtml(normalEntries, orderMap, visibleProgress);
        const completedCardsHtml = renderEntryGroupsHtml(completedEntries, completedOrderMap, visibleProgress);
        const droppedCardsHtml   = renderEntryGroupsHtml(droppedEntries, completedOrderMap, visibleProgress);
        const airingCardsHtml    = renderEntryGroupsHtml(airingEntries, completedOrderMap, visibleProgress);
        const onHoldCardsHtml    = renderEntryGroupsHtml(onHoldEntries, completedOrderMap, visibleProgress);
        const inProgressHtml     = AnimeCardRenderer.createInProgressGroup(inProgressAnime);

        // Section panels for the four compact-status lists. Toggle IDs match
        // the COMPACT_TOGGLE_CHEVRONS table the delegated click handler
        // dispatches on, so don't rename them without updating that list.
        const completedGroupHtml = completedEntries.length > 0
            ? renderCompactSectionHtml({
                classPrefix: 'completed',
                toggleId: 'completedListToggle',
                label: 'COMPLETED LIST',
                subLabel: `${AT.CONFIG.COMPLETED_LIST_MIN_DAYS}+ days since last watch`,
                cardsHtml: completedCardsHtml,
                isOpen: currentCompactStatusOpen
            })
            : '';
        const droppedGroupHtml = droppedEntries.length > 0
            ? renderCompactSectionHtml({
                classPrefix: 'dropped',
                toggleId: 'droppedListToggle',
                label: 'DROPPED LIST',
                subLabel: `${droppedEntries.length} anime`,
                cardsHtml: droppedCardsHtml,
                isOpen: currentCompactStatusOpen
            })
            : '';
        const airingGroupHtml = airingEntries.length > 0
            ? renderCompactSectionHtml({
                classPrefix: 'airing',
                toggleId: 'airingListToggle',
                label: '⬤ AIRING LIST',
                subLabel: `${airingEntries.length} anime · Caught up`,
                cardsHtml: airingCardsHtml,
                isOpen: currentCompactStatusOpen
            })
            : '';
        const onHoldGroupHtml = onHoldEntries.length > 0
            ? renderCompactSectionHtml({
                classPrefix: 'onhold',
                toggleId: 'onHoldListToggle',
                label: 'ON HOLD',
                subLabel: `${onHoldEntries.length} anime`,
                cardsHtml: onHoldCardsHtml,
                isOpen: currentCompactStatusOpen
            })
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

        restoreExpansionState(elements.animeList, expansionState);

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
    // Pure helpers (buildPayload, parseAndValidate, mergeImported,
    // triggerDownload) live in src/popup/library-backup.js. These thin
    // orchestrators wire them to the popup's closure state (animeData,
    // videoProgress, renderAnimeList, etc.).
    async function exportLibraryToJson() {
        const { Storage, LibraryBackup } = AT;
        const snapshot = await Storage.get([
            'animeData', 'videoProgress', 'deletedAnime',
            'groupCoverImages', 'goalSettings', 'badgeUnlocks'
        ]);
        const payload = LibraryBackup.buildPayload(snapshot);
        LibraryBackup.triggerDownload(payload);
        const animeCount = Object.keys(payload.animeData).length;
        AT.UIHelpers?.showToast?.(`Exported ${animeCount} anime`, { type: 'success' });
    }

    async function importLibraryFromFile(file) {
        const { Storage, FirebaseSync, LibraryBackup } = AT;

        const text = await file.text();
        const parsed = LibraryBackup.parseAndValidate(text); // throws on bad input
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
        const merged = LibraryBackup.mergeImported(local, parsed);

        markInternalSave(merged);
        await Storage.set(merged);

        // Update in-memory copies so the next render is correct without a reload.
        animeData = merged.animeData;
        videoProgress = merged.videoProgress;
        if (merged.goalSettings) goalSettings = merged.goalSettings;
        badgeState = merged.badgeUnlocks;
        try { window.AnimeTracker.groupCoverImages = merged.groupCoverImages; } catch {}

        renderAnimeList(elements.searchInput?.value || '');
        await updateStats();

        // Push merged data to cloud if logged in so the import is reflected
        // across devices, not just this one.
        const user = FirebaseSync?.getUser?.();
        if (user) {
            try {
                await FirebaseSync.saveToCloud(merged, true);
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
    /**
     * Refresh visual state (chevron rotations) that depends on currently
     * rendered DOM nodes. Called after each render — the click handlers
     * themselves are installed exactly once via `installCardEventListeners`.
     */
    const COMPACT_TOGGLE_CHEVRONS = [
        ['airingListToggle', 'airing-chevron'],
        ['onHoldListToggle', 'onhold-chevron'],
        ['completedListToggle', 'completed-chevron'],
        ['droppedListToggle', 'dropped-chevron']
    ];

    function refreshCompactChevrons() {
        if (!elements.animeList) return;
        for (const [toggleId, chevronClass] of COMPACT_TOGGLE_CHEVRONS) {
            const toggle = elements.animeList.querySelector(`#${toggleId}`);
            if (!toggle) continue;
            const cards = toggle.nextElementSibling;
            const chevron = toggle.querySelector(`.${chevronClass}`);
            if (!chevron || !cards) continue;
            chevron.style.transform = cards.classList.contains('open') ? 'rotate(0deg)' : 'rotate(-90deg)';
        }
    }

    /**
     * Install ALL card-related event listeners ONCE on the list container.
     * Previously every render walked the DOM with `querySelectorAll` and
     * attached fresh handlers per matched element — works correctly because
     * `replaceChildren()` clears them, but burns O(N) handler attachments
     * per render. A single delegated listener pays O(1) install cost and
     * O(target chain depth) per click, which is negligible.
     */
    function installCardEventListeners() {
        const list = elements.animeList;
        if (!list || list.__cardListenersInstalled) return;

        list.addEventListener('click', (e) => {
            const target = e.target;

            // ── Compact section toggles (airing/onHold/completed/dropped lists)
            for (const [toggleId] of COMPACT_TOGGLE_CHEVRONS) {
                const toggle = target.closest(`#${toggleId}`);
                if (!toggle || !list.contains(toggle)) continue;
                e.stopPropagation();
                const cards = toggle.nextElementSibling;
                if (cards) {
                    cards.classList.toggle('open');
                    currentCompactStatusOpen = cards.classList.contains('open');
                }
                refreshCompactChevrons();
                return;
            }

            // ── Status chips (Airing / Hold / Completed / Dropped tabs)
            const chip = target.closest('[data-compact-status]');
            if (chip && list.contains(chip)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const nextStatus = normalizeCompactStatus(chip.dataset.compactStatus || '');
                if (nextStatus !== currentCompactStatus) {
                    currentCompactStatus = nextStatus;
                    _lastRenderedListMarkup = null;
                    renderAnimeList(getActiveFilter());
                }
                return;
            }

            // ── "Show more fillers" / "Show more episodes" expanders
            const moreFillers = target.closest('.show-more-fillers');
            if (moreFillers && list.contains(moreFillers)) {
                e.stopPropagation();
                const hidden = moreFillers.previousElementSibling;
                if (hidden?.classList.contains('hidden-fillers')) {
                    const isExpanded = hidden.classList.toggle('expanded');
                    moreFillers.textContent = isExpanded ? moreFillers.dataset.lessText : moreFillers.dataset.moreText;
                }
                return;
            }
            const moreEps = target.closest('.show-more-episodes');
            if (moreEps && list.contains(moreEps)) {
                e.stopPropagation();
                const hidden = moreEps.previousElementSibling;
                if (hidden?.classList.contains('hidden-episodes')) {
                    const isExpanded = hidden.classList.toggle('expanded');
                    moreEps.textContent = isExpanded ? moreEps.dataset.lessText : moreEps.dataset.moreText;
                }
                return;
            }

            // ── Per-card edit / delete actions
            const editBtn = target.closest('.movie-edit-btn, .anime-edit-title, .season-edit-btn');
            if (editBtn && list.contains(editBtn) && editBtn.dataset.slug) {
                e.stopPropagation();
                editAnimeTitle(editBtn.dataset.slug);
                return;
            }
            const delBtn = target.closest('.movie-delete-btn, .season-delete-btn');
            if (delBtn && list.contains(delBtn) && delBtn.dataset.slug) {
                e.stopPropagation();
                deleteAnime(delBtn.dataset.slug);
                return;
            }

            // ── Season-item header (skip movie rows which have no collapse)
            const seasonHeader = target.closest('.season-item-header');
            if (seasonHeader && list.contains(seasonHeader)) {
                // The edit/delete buttons inside the header were already
                // handled by the earlier branch — at this point the click
                // missed them, so toggle the season item.
                const seasonItem = seasonHeader.closest('.season-item');
                if (seasonItem && !seasonItem.classList.contains('season-item-movie')) {
                    e.stopPropagation();
                    seasonItem.classList.toggle('expanded');
                }
                return;
            }

            // ── Movie-group + season-group + part-item headers (simple toggles)
            const movieGroupHeader = target.closest('.movie-group-header');
            if (movieGroupHeader && list.contains(movieGroupHeader)) {
                const group = movieGroupHeader.closest('.anime-movie-group');
                if (group) group.classList.toggle('expanded');
                return;
            }
            const seasonGroupHeader = target.closest('.season-group-header');
            if (seasonGroupHeader && list.contains(seasonGroupHeader)) {
                const group = seasonGroupHeader.closest('.anime-season-group');
                if (group) group.classList.toggle('expanded');
                return;
            }
            const partItemHeader = target.closest('.part-item-header');
            if (partItemHeader && list.contains(partItemHeader)) {
                e.stopPropagation();
                const partItem = partItemHeader.closest('.part-item');
                if (partItem) partItem.classList.toggle('expanded');
                return;
            }

            // ── In-progress / episodes / parts headers — collapse handle
            //    plus auto-expand parent card if it isn't already open.
            const collapsibleHeader = target.closest(
                '.in-progress-header, .episodes-header, .parts-header'
            );
            if (collapsibleHeader && list.contains(collapsibleHeader)) {
                e.stopPropagation();
                const card = collapsibleHeader.closest('.anime-card');
                if (card && !card.classList.contains('expanded')) card.classList.add('expanded');
                const parent = collapsibleHeader.parentElement;
                if (parent) parent.classList.toggle('collapsed');
                return;
            }

            // ── Anime card header — main expand/collapse
            const cardHeader = target.closest('.anime-card-header');
            if (cardHeader && list.contains(cardHeader)) {
                // Skip when click landed on an inner action button — those
                // have their own handlers above and shouldn't toggle the card.
                if (target.closest('.anime-card-actions') ||
                    target.closest('.anime-header-actions') ||
                    target.closest('.anime-fetch-filler')) {
                    return;
                }
                e.stopPropagation();
                const card = cardHeader.closest('.anime-card');
                if (card) {
                    const wasExpanded = card.classList.toggle('expanded');
                    card.setAttribute('aria-expanded', wasExpanded ? 'true' : 'false');
                }
            }
        });

        // Keyboard activation: Enter / Space toggle the anime card itself
        // when it (not a child button) has focus.
        list.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const card = e.target.classList?.contains('anime-card') ? e.target : null;
            if (!card) return;
            e.preventDefault();
            const wasExpanded = card.classList.toggle('expanded');
            card.setAttribute('aria-expanded', wasExpanded ? 'true' : 'false');
        });

        list.__cardListenersInstalled = true;
    }

    // Called from renderAnimeList — installs delegated listeners on first
    // call and only refreshes the chevron visuals on subsequent renders.
    function setupCardEventListeners() {
        installCardEventListeners();
        refreshCompactChevrons();
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
                PopupLogger.error('StatsView', 'render failed:', e);
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

        let user = AT?.FirebaseSync?.getUser?.() || null;
        let hasMobilePassword = AT?.FirebaseSync?.userHasMobilePassword?.(user) || false;
        if (user && !hasMobilePassword) {
            try {
                user = await AT.FirebaseSync.refreshAuthProvidersFromServer() || user;
                hasMobilePassword = AT.FirebaseSync.userHasMobilePassword(user);
            } catch (e) {
                PopupLogger.debug('Settings', 'Auth provider refresh skipped:', e?.message || e);
            }
        }

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
            settings: storedSettings,
            hasMobilePassword
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
    /**
     * Shared post-load pipeline used by both `loadData` (storage source) and
     * `loadAndSyncData` (cloud source). Performs the full normalize→cleanup→
     * repair sequence and returns the cleaned data plus a flag describing
     * whether anything changed (so the caller knows whether to persist).
     *
     * Extracted from two near-identical bodies that drifted slightly over
     * time (different maintenance-key suffixes, different fallback expressions
     * for `deletedAnime`). Single source means future tweaks land in one place.
     */
    function runMaintenancePipeline(rawData, options = {}) {
        const { ProgressManager, UIHelpers } = AT;
        const { maintenanceSuffix = '', baselineForCleanCount = null } = options;

        const sourceAnime = rawData?.animeData || {};
        const sourceProgress = rawData?.videoProgress || {};
        const sourceDeleted = rawData?.deletedAnime || {};

        const normalized = ProgressManager.normalizeCanonicalSlugs(
            sourceAnime, sourceProgress, sourceDeleted
        );

        const withoutAutoRepaired = ProgressManager.removeAutoRepairedEpisodes(
            normalized.animeData || {}
        );
        const repairedData = ProgressManager.removeDuplicateEpisodes(withoutAutoRepaired.cleanedData);
        const rawProgressForDurations = normalized.videoProgress || {};
        const { cleaned: cleanedProgress, removedCount: progressRemoved } =
            ProgressManager.cleanTrackedProgress(
                repairedData, rawProgressForDurations,
                normalized.deletedAnime || sourceDeleted
            );

        const durationKey = `normalizeMovieDurations${maintenanceSuffix}`;
        const phantomKey = `cleanupPhantomMovies${maintenanceSuffix}`;
        const durationFix = shouldRunMaintenance(durationKey)
            ? normalizeMovieDurations(repairedData, rawProgressForDurations)
            : { changed: false };
        const phantomCleanup = shouldRunMaintenance(phantomKey)
            ? cleanupPhantomMovies(repairedData, normalized.deletedAnime || sourceDeleted)
            : { changed: false, deletedAnime: normalized.deletedAnime || sourceDeleted };

        const baseline = baselineForCleanCount ?? sourceAnime;
        const episodeCountChanged =
            UIHelpers.countEpisodes(baseline) !== UIHelpers.countEpisodes(repairedData);

        const changed =
            episodeCountChanged ||
            withoutAutoRepaired.removedCount > 0 ||
            progressRemoved > 0 ||
            durationFix.changed ||
            normalized.changed ||
            phantomCleanup.changed;

        const deletedChanged = normalized.changed || phantomCleanup.changed;

        return {
            animeData: repairedData,
            videoProgress: cleanedProgress,
            deletedAnime: phantomCleanup.deletedAnime,
            groupCoverImages: rawData?.groupCoverImages || {},
            changed,
            deletedChanged
        };
    }

    async function persistPipelineResult(result, options = {}) {
        const { Storage } = AT;
        const { includeDeleted = result.deletedChanged } = options;
        const payload = {
            animeData: result.animeData,
            videoProgress: result.videoProgress
        };
        if (includeDeleted) payload.deletedAnime = result.deletedAnime;
        markInternalSave(payload);
        await Storage.set(payload);
    }

    async function finalizeAfterMaintenance() {
        const { FillerService } = AT;
        await FillerService.loadCachedEpisodeTypes(animeData);
        await FillerService.loadStayedFillers();
        await AT.AnilistService.loadCachedData(animeData);

        let changed = repairAiringCompletedEntries(animeData);
        // Persist `completed` for anime that getStatus() classifies as finished
        // but carry no completedAt/listState — otherwise the an1me.to watchlist
        // sync can't see them and they stay stuck under "Watching".
        if (persistDetectedCompletions(animeData)) changed = true;

        if (changed) {
            const payload = { animeData };
            markInternalSave(payload);
            await AT.Storage.set(payload);
        }
    }

    async function runAutoFetchIfNeeded() {
        const { FillerService } = AT;
        const slugsList = Object.keys(animeData);
        const { allFillersCached, allAnilistCached } = checkAllCached(slugsList);

        // Skip the popup-side auto-fetch entirely when the SW is already
        // running a metadata repair — otherwise both would race to fetch
        // the same items.
        const repairState = await syncMetadataRepairStateFromStorage();
        const repairRunning = repairState?.status === 'running';

        if (!repairRunning && !allFillersCached) {
            runAutoFetch(FillerService, animeData, () => scheduleDeferredListRefresh());
        }
        if (!repairRunning && !allAnilistCached) {
            runAutoFetch(AT.AnilistService, animeData, () => scheduleDeferredListRefresh());
        }
    }

    async function loadData(options = {}) {
        const { Storage } = AT;
        const { skipAutoFetch = false } = options;

        try {
            if (shouldRunMaintenance('migrateMultiPartAnime')) {
                await Storage.migrateMultiPartAnime();
            }

            const result = await Storage.get(['animeData', 'videoProgress', 'groupCoverImages', 'deletedAnime']);
            const pipeline = runMaintenancePipeline(result, {
                maintenanceSuffix: '',
                baselineForCleanCount: result.animeData || {}
            });

            animeData = pipeline.animeData;
            videoProgress = pipeline.videoProgress;
            window.AnimeTracker.groupCoverImages = result.groupCoverImages || {};

            if (pipeline.changed) {
                await persistPipelineResult(pipeline);
            }

            await finalizeAfterMaintenance();

            renderAnimeList();
            await updateStats();
            await loadGoalAndBadgeState();

            if (!skipAutoFetch) {
                await runAutoFetchIfNeeded();
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
    async function loadAndSyncData(options = {}) {
        const { forceFresh = false, skipAutoFetch = false } = options;

        if (loadAndSyncInProgress) return;
        if (!forceFresh && (Date.now() - lastPopupFullSyncAt) < POPUP_FULL_SYNC_MIN_GAP_MS) {
            PopupLogger.debug('Sync', 'Skipping full sync (synced recently)');
            return;
        }

        loadAndSyncInProgress = true;

        const { FirebaseSync } = AT;

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
            await loadData({ skipAutoFetch });

            const data = await FirebaseSync.loadAndSyncData(elements);
            if (data) {
                const pipeline = runMaintenancePipeline(data, {
                    maintenanceSuffix: '_postSync',
                    baselineForCleanCount: data.animeData || {}
                });

                animeData = pipeline.animeData;
                videoProgress = pipeline.videoProgress;
                window.AnimeTracker.groupCoverImages = data.groupCoverImages || {};

                if (pipeline.changed) {
                    await persistPipelineResult(pipeline);
                }

                await finalizeAfterMaintenance();

                renderAnimeList(elements.searchInput?.value || '');
                await updateStats();
                await loadGoalAndBadgeState();

                if (!skipAutoFetch) {
                    await runAutoFetchIfNeeded();
                }
            }
        } catch (error) {
            PopupLogger.error('Sync', 'Error:', error);
            if (isQuotaExceededError(error)) {
                const recovered = await recoverFromQuotaPressure('loadAndSyncData');
                if (recovered) {
                    await loadData({ skipAutoFetch });
                    return;
                }
            }
            await loadData({ skipAutoFetch });
        } finally {
            loadAndSyncInProgress = false;
            lastPopupFullSyncAt = Date.now();
        }
    }

    async function refreshPopupCloudData(forceFresh = false) {
        if (!AT?.FirebaseSync?.getUser?.()) return;
        if (forceFresh) {
            try { AT.FirebaseSync.clearCachedUserDocument(); } catch {}
        }
        await loadAndSyncData({ forceFresh });
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

    // showInlineConfirm is wired above from AT.Dialogs.inlineConfirm.

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
                    await FirebaseSync.saveToCloud({ animeData }, true);
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

    const {
        open: openDialogA11y,
        close: closeDialogA11y,
        inlineConfirm: showInlineConfirm
    } = AT.Dialogs;

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

    const {
        parseRanges: parseEpisodeRanges,
        splitCanonAndFillers,
        extractSlugFromInput,
        generateTitleFromSlug,
        renderEpisodesPreview: updateEpisodesPreview
    } = AT.EpisodeParse;

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
                PopupLogger.debug('WatchlistSync', `sent ${watchlistType} for #${siteId}`);
            } else {
                // No siteAnimeId yet — fetch it from the anime page, then sync
                PopupLogger.debug('WatchlistSync', `fetching siteAnimeId for ${slug}...`);
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
                            PopupLogger.debug('WatchlistSync', `fetched #${fetchedId}, sent ${watchlistType}`);
                            // Persist the siteAnimeId
                            AT.Storage.set({ animeData }).catch(() => {});
                        } else {
                            PopupLogger.debug('WatchlistSync', `could not find siteAnimeId for ${slug}`);
                        }
                    }
                );
            }
        } catch (e) {
            PopupLogger.warn('WatchlistSync', 'popup error:', e.message);
        }
    }

    // List-state mutations moved to src/popup/anime-status.js (StatusService).
    const {
        setManualListState,
        markTitleEdited,
        clearDeletedAnimeSlug
    } = AT.StatusService;

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
        const { canon } = splitCanonAndFillers(slug, allParsedEpisodes);
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

    /**
     * If the background service worker stamped `postUpdateFetchTriggeredAt`
     * after an extension update, surface a toast and open the auto-fetch UI
     * so the freshly-installed version warms its anime metadata caches.
     *
     * Always clears the flag — even when there's nothing to fetch — so we
     * don't re-trigger every popup open. The BG side already kicked off
     * `pendingBackgroundMetadataRepair`; here we just expose it to the user.
     */
    /**
     * The SW kicks off the post-update metadata repair on `onInstalled.update`
     * before the popup ever opens, so we DON'T pop a toast or auto-open the
     * fetch dialog when the user happens to open the popup later — that was
     * the green "πρασινακι" that interrupted the user. Instead we silently
     * consume the post-update flag and let the footer sync-status badge
     * surface any in-flight progress (driven by the storage.onChanged
     * listener that calls applyMetadataRepairState on every state tick).
     *
     * The user can still open the import dialog any time via
     * Settings → Fetch & Import All.
     */
    async function maybePromptPostUpdateFetch() {
        const { Storage } = AT;
        try {
            const stored = await Storage.get([
                'postUpdateFetchTriggeredAt',
                'postUpdateFetchToVersion',
                'metadataRepairState'
            ]);

            if (stored.postUpdateFetchTriggeredAt) {
                // Single-shot — clear so we don't keep checking forever.
                await Storage.remove([
                    'postUpdateFetchTriggeredAt',
                    'postUpdateFetchFromVersion',
                    'postUpdateFetchToVersion'
                ]);
            }

            // If a repair is already running in the background, reflect it
            // in the footer immediately (storage.onChanged would also do
            // this on the next state tick, but this avoids the gap on
            // popup-open before the first tick).
            if (stored.metadataRepairState?.status === 'running') {
                await applyMetadataRepairState(stored.metadataRepairState, { autoOpenRunning: true });
            }
        } catch (e) {
            PopupLogger.warn('Init', 'Post-update silent sync failed:', e);
        }
    }

    async function fetchAllFillers(options = {}) {
        const {
            autoStart = true,
            forceInfoRefresh = false,
            forceFillerRefresh = false,
            autoMode = false
        } = options;

        const { FillerFetchUI } = AT;

        await FillerFetchUI.open({ autoMode });

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
            // Set the flag; SW honors it via storage.onChanged and runs the
            // metadata repair silently. No popup-side modal/toast.
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
            await chrome.storage.local.set({ pendingBackgroundMetadataRepair: false });
        } finally {
            elements.googleSignIn.disabled = false;
            elements.googleSignIn.innerHTML = GOOGLE_BTN_DEFAULT_HTML;
        }
    }

    function showAuthToast(message, type = 'error') {
        try {
            AT.UIHelpers?.showToast?.(String(message || ''), { type, duration: 3000 });
        } catch {}
    }

    function setAuthFormMessage(message = '', type = 'error') {
        const errorEl = document.getElementById('authFormError');
        const noteEl = document.getElementById('authFormNote');
        if (errorEl) {
            errorEl.textContent = type === 'error' ? message : '';
            errorEl.style.display = type === 'error' && message ? 'block' : 'none';
        }
        if (noteEl) {
            noteEl.textContent = type !== 'error' ? message : '';
            noteEl.style.display = type !== 'error' && message ? 'block' : 'none';
        }
    }

    function setEmailAuthLoading(loading, label = null) {
        const submitBtn = document.getElementById('emailSignIn');
        const labelEl = document.getElementById('emailSignInLabel');
        const modeLabel = emailAuthMode === 'signUp' ? 'Create account' : 'Sign in';
        if (submitBtn) submitBtn.disabled = !!loading;
        if (labelEl) labelEl.textContent = loading ? (label || 'Working...') : modeLabel;
        const toggle = document.getElementById('authToggleMode');
        const forgot = document.getElementById('authForgotPassword');
        if (toggle) toggle.disabled = !!loading;
        if (forgot) forgot.disabled = !!loading;
    }

    function setEmailAuthMode(mode) {
        emailAuthMode = mode === 'signUp' ? 'signUp' : 'signIn';
        const password = document.getElementById('authPassword');
        const toggle = document.getElementById('authToggleMode');
        const forgot = document.getElementById('authForgotPassword');
        if (password) {
            password.autocomplete = emailAuthMode === 'signUp' ? 'new-password' : 'current-password';
        }
        if (toggle) {
            toggle.textContent = emailAuthMode === 'signUp' ? 'Already have an account?' : 'Create account';
        }
        if (forgot) forgot.hidden = emailAuthMode === 'signUp';
        setEmailAuthLoading(false);
        setAuthFormMessage('');
    }

    async function submitEmailAuth() {
        const { FirebaseSync } = AT;
        const email = document.getElementById('authEmail')?.value?.trim() || '';
        const password = document.getElementById('authPassword')?.value || '';
        const isSignUp = emailAuthMode === 'signUp';

        setAuthFormMessage('');
        if (!email) {
            setAuthFormMessage('Please enter your email.');
            document.getElementById('authEmail')?.focus();
            return;
        }
        if (!password) {
            setAuthFormMessage('Please enter your password.');
            document.getElementById('authPassword')?.focus();
            return;
        }

        setEmailAuthLoading(true, isSignUp ? 'Creating...' : 'Signing in...');
        try {
            await chrome.storage.local.set({ pendingBackgroundMetadataRepair: true });
            if (isSignUp) {
                await FirebaseSync.signUpWithEmailPassword(email, password);
            } else {
                await FirebaseSync.signInWithEmailPassword(email, password);
            }
        } catch (error) {
            await chrome.storage.local.set({ pendingBackgroundMetadataRepair: false });
            setAuthFormMessage(error?.message || 'Authentication failed.');
        } finally {
            setEmailAuthLoading(false);
        }
    }

    async function sendAuthPasswordReset() {
        const { FirebaseSync } = AT;
        const email = document.getElementById('authEmail')?.value?.trim() || '';
        if (!email) {
            setAuthFormMessage('Enter your email first, then tap forgot password.');
            document.getElementById('authEmail')?.focus();
            return;
        }
        setAuthFormMessage('');
        setEmailAuthLoading(true, 'Sending...');
        try {
            await FirebaseSync.sendPasswordReset(email);
            setAuthFormMessage('Password reset email sent.', 'note');
        } catch (error) {
            setAuthFormMessage(error?.message || 'Could not send reset email.');
        } finally {
            setEmailAuthLoading(false);
        }
    }

    function openSetPasswordDialog() {
        const existing = document.getElementById('setPasswordDialog');
        if (existing) existing.remove();

        const accountUser = AT?.FirebaseSync?.getUser?.() || null;
        const hasMobilePassword = AT?.FirebaseSync?.userHasMobilePassword?.(accountUser) || false;
        const dialogTitle = hasMobilePassword ? 'Change mobile password' : 'Set password for mobile';
        const saveLabel = hasMobilePassword ? 'Update password' : 'Save password';

        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay visible';
        overlay.id = 'setPasswordDialog';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'setPasswordDialogTitle');
        overlay.innerHTML = `
            <div class="dialog add-anime-dialog set-password-dialog">
                <div class="dialog-header">
                    <h3 id="setPasswordDialogTitle">${dialogTitle}</h3>
                    <button class="dialog-close" id="closeSetPassword" type="button" aria-label="Close dialog">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>
                <div class="dialog-body">
                    <div class="form-group">
                        <label for="setPasswordInput">New password</label>
                        <input type="password" id="setPasswordInput" autocomplete="new-password" placeholder="At least 6 characters">
                        <span class="form-hint">Save opens Google to confirm it is you, then links this password to your account email for mobile sign-in.</span>
                    </div>
                    <p class="auth-error" id="setPasswordError" style="display:none"></p>
                    <p class="auth-note" id="setPasswordNote" style="display:none"></p>
                </div>
                <div class="dialog-actions">
                    <button class="btn btn-secondary" id="cancelSetPassword" type="button">Cancel</button>
                    <button class="btn btn-primary" id="confirmSetPassword" type="button">${saveLabel}</button>
                </div>
            </div>
        `;

        const close = () => overlay.remove();
        const errorEl = overlay.querySelector('#setPasswordError');
        const noteEl = overlay.querySelector('#setPasswordNote');
        const passwordInput = overlay.querySelector('#setPasswordInput');
        const confirmBtn = overlay.querySelector('#confirmSetPassword');
        const setDialogMessage = (message, type = 'error') => {
            if (errorEl) {
                errorEl.textContent = type === 'error' ? message : '';
                errorEl.style.display = type === 'error' && message ? 'block' : 'none';
            }
            if (noteEl) {
                noteEl.textContent = type !== 'error' ? message : '';
                noteEl.style.display = type !== 'error' && message ? 'block' : 'none';
            }
        };
        const save = async () => {
            const password = passwordInput?.value || '';
            if (password.length < 6) {
                setDialogMessage('Password must be at least 6 characters.');
                passwordInput?.focus();
                return;
            }
            if (confirmBtn) {
                confirmBtn.disabled = true;
                confirmBtn.textContent = 'Saving...';
            }
            setDialogMessage('');
            try {
                setDialogMessage('Complete Google sign-in when the window opens…', 'note');
                await AT.FirebaseSync.setPasswordForCurrentUser(password);
                const email = AT.FirebaseSync.getUser()?.email || accountUser?.email || '';
                setDialogMessage('Password saved to your Firebase account.', 'note');
                AT.UIHelpers?.showToast?.('Mobile password active — use email + password on mobile.', { type: 'success', duration: 3200 });
                try {
                    window.AnimeTracker?.SettingsView?.updateMobilePasswordRow?.(true, email);
                } catch {}
                setTimeout(close, 900);
            } catch (error) {
                setDialogMessage(error?.message || 'Could not set password.');
            } finally {
                if (confirmBtn) {
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = saveLabel;
                }
            }
        };

        overlay.querySelector('#closeSetPassword')?.addEventListener('click', close);
        overlay.querySelector('#cancelSetPassword')?.addEventListener('click', close);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close();
        });
        confirmBtn?.addEventListener('click', save);
        passwordInput?.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') save();
        });
        document.body.appendChild(overlay);
        setTimeout(() => passwordInput?.focus(), 30);
    }

    // Non-blocking toast — delegates to UIHelpers (dark 3D .at-toast in popup.css).
    function showToast(message, type = 'error') {
        const duration = type === 'error' ? 4000 : 2800;
        try {
            AT.UIHelpers?.showToast?.(String(message || ''), { type, duration });
            return;
        } catch {}
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

        const emailAuthForm = document.getElementById('emailAuthForm');
        if (emailAuthForm) {
            emailAuthForm.addEventListener('submit', (event) => {
                event.preventDefault();
                submitEmailAuth();
            });
        }
        document.getElementById('authToggleMode')?.addEventListener('click', () => {
            setEmailAuthMode(emailAuthMode === 'signUp' ? 'signIn' : 'signUp');
        });
        document.getElementById('authForgotPassword')?.addEventListener('click', sendAuthPasswordReset);
        setEmailAuthMode('signIn');

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
            if (!donateTrigger) return;
            e.stopPropagation();
            // Toggle: a second click on the button closes the open dropdown.
            if (elements.donateDropdown?.classList.contains('visible')) {
                closeDonateDropdown();
                return;
            }
            setSettingsDataToolsExpanded(false);
            setSettingsPreferencesExpanded(false);
            setTimeout(openDonateDropdown, 80);
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
                // Mirror the change up to Firestore so other devices pick it
                // up. Debounced — flipping multiple toggles in a row produces
                // a single field-masked PATCH.
                try {
                    await FirebaseSync.queuePlaybackSettingsSave();
                } catch (syncError) {
                    PopupLogger.warn('Settings', `Cloud sync queue failed for ${key.btnId}: ${syncError?.message}`);
                }
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
                        await loadAndSyncData({ skipAutoFetch: true, forceFresh: true });
                    } else {
                        await loadData({ skipAutoFetch: true });
                    }
                } catch (error) {
                    PopupLogger.error('RefreshData', 'Error:', error);
                } finally {
                    refreshBtn.classList.remove('loading');
                }
                return;
            }

            if (e.target.closest('#settingsClear')) {
                setSettingsDataToolsExpanded(false);
                setSettingsPreferencesExpanded(false);
                showDialog();
                return;
            }

            if (e.target.closest('#settingsSetPassword')) {
                setSettingsDataToolsExpanded(false);
                setSettingsPreferencesExpanded(false);
                openSetPasswordDialog();
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
                // Cache-first import: the SW reads chrome.storage.local first,
                // counts fresh entries as cached/skipped, and fetches only
                // missing or stale metadata/filler data.
                await fetchAllFillers({
                    autoStart: true,
                    forceInfoRefresh: false,
                    forceFillerRefresh: false
                });
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
                tab.addEventListener('click', () => {
                    const rawCat = tab.dataset.category;
                    const nextCategory = normalizeCategory(rawCat);
                    const categoryChanged = nextCategory !== currentCategory;

                    elements.categoryTabs.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');

                    // Switching a category exits any view mode (stats/goals)
                    setViewMode(null);

                    requestAnimationFrame(() => moveSlider(tab, false));

                    if (categoryChanged) {
                        currentCategory = nextCategory;
                        _lastRenderedListMarkup = null;
                        renderCategorySwitch(elements.searchInput?.value || '');
                    }

                    try {
                        const savePref = chrome.storage.local.set({
                            userPreferences: { sort: currentSort, category: currentCategory }
                        });
                        if (savePref && typeof savePref.catch === 'function') savePref.catch(() => {});
                    } catch {}
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
        let pendingStatsRender = false;
        let pendingGoalsRender = false;
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
                try { window.AnimeTracker?.StatsEngine?.invalidate(); } catch {}
                try { window.AnimeTracker?.AchievementsEngine?.invalidate(); } catch {}
                pendingStatsRender = true;
                pendingGoalsRender = true;
            }
            if (changes[GOAL_SETTINGS_KEY]) {
                goalSettings = changes[GOAL_SETTINGS_KEY].newValue || null;
                pendingGoalsRender = true;
            }
            if (changes[BADGE_STATE_KEY]) {
                badgeState = changes[BADGE_STATE_KEY].newValue || {};
                pendingGoalsRender = true;
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
            if (changes[SMART_NOTIF_STORAGE_KEY]) {
                renderSmartNotifSetting(changes[SMART_NOTIF_STORAGE_KEY].newValue === true);
            }
            if (changes[AUTO_SKIP_FILLER_STORAGE_KEY]) {
                renderAutoSkipFillerSetting(changes[AUTO_SKIP_FILLER_STORAGE_KEY].newValue === true);
            }
            if (changes[SKIPTIME_HELPER_KEY]) {
                renderSkiptimeHelperSetting(changes[SKIPTIME_HELPER_KEY].newValue === true);
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
                void applyMetadataRepairState(changes.metadataRepairState.newValue || null, { autoOpenRunning: true });
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

            const hasDeferredRender = needsFullRender || pendingStatsRender || pendingGoalsRender;
            if (hasDeferredRender) {
                if (storageUpdateTimeout) clearTimeout(storageUpdateTimeout);
                storageUpdateTimeout = setTimeout(async () => {
                    storageUpdateTimeout = null;
                    if (needsFullRender) {
                        scheduleDeferredListRefresh({ delayMs: 0 });
                    }
                    const appRoot = document.querySelector('.app');
                    if (pendingStatsRender) {
                        pendingStatsRender = false;
                        const statsView = document.getElementById('statsView');
                        if (statsView && appRoot && appRoot.classList.contains('stats-mode')) {
                            try { window.AnimeTracker.StatsView.render(statsView, animeData); } catch {}
                        }
                    }
                    if (pendingGoalsRender) {
                        pendingGoalsRender = false;
                        if (appRoot && appRoot.classList.contains('goals-mode')) {
                            try { renderGoalsView(); } catch {}
                        }
                    }
                    if (needsFullRender && isExternalUpdate && !handledRepairStateChange && !handledMetadataCacheChange && elements.syncStatus && elements.syncText) {
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

                const statusChip = target.closest('[data-compact-status]');
                if (statusChip && elements.animeList.contains(statusChip)) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    const nextStatus = normalizeCompactStatus(statusChip.dataset.compactStatus || '');
                    if (nextStatus !== currentCompactStatus) {
                        currentCompactStatus = nextStatus;
                        _lastRenderedListMarkup = null;
                        renderAnimeList(getActiveFilter());
                    }
                    return;
                }

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
                PopupLogger.debug('Cleanup', 'Already ran today, skipping');
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

                if (raw.deletedAnime) {
                    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
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
                // Sign-in is always silent — the SW picks up the
                // `pendingBackgroundMetadataRepair` flag we wrote in
                // signInWithGoogle / email sign-in and runs the repair in
                // background. Progress is surfaced via the footer
                // sync-status badge (storage.onChanged → applyMetadataRepairState).
                await maybePromptPostUpdateFetch();
            },
            onUserSignedOut: () => {
                stopPopupCloudRefresh();
                showAuthScreen();
            },
            onError: () => {
                showMainApp(null);
                loadData();
                // Show the post-update prompt even when auth errored — the
                // local library still benefits from a metadata refresh.
                maybePromptPostUpdateFetch().catch(() => {});
            }
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
                PopupLogger.debug('IP-Refresh', `${slug}: ${pct}% (${timeStr}/${durStr})`);
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
        refreshPopupCloudData(false).catch((error) => {
            PopupLogger.debug('Sync', 'Visibility refresh skipped:', error?.message || error);
        });
    });

    init();

})();
