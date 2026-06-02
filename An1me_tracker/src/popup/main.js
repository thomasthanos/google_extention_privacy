




(function () {
    'use strict';


    const AT = window.AnimeTracker;


    let animeData = {};
    let videoProgress = {};
    let currentSort = 'date';
    let currentCategory = 'all';
    let currentCompactStatus = 'airing';
    let currentCompactStatusOpen = false;
    let goalSettings = null;
    let badgeState = {};
    let lastBadgeSnapshot = [];
    let currentViewMode = null;
    const COPY_GUARD_STORAGE_KEY = 'copyGuardEnabled';
    const GOAL_SETTINGS_KEY = 'goalSettings';
    const BADGE_STATE_KEY = 'badgeUnlocks';


    const elements = {

        authSection: document.getElementById('authSection'),
        mainApp: document.getElementById('mainApp'),
        googleSignIn: document.getElementById('googleSignIn'),

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

        addAnimeBtn: document.getElementById('addAnimeBtn'),
        addAnimeDialog: document.getElementById('addAnimeDialog'),
        closeAddAnime: document.getElementById('closeAddAnime'),
        cancelAddAnime: document.getElementById('cancelAddAnime'),
        confirmAddAnime: document.getElementById('confirmAddAnime'),
        animeSlugInput: document.getElementById('animeSlug'),
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
    let metadataRepairPromise = null;
    let lastMetadataRepairState = null;
    let metadataRepairStatusResetTimer = null;

    const OWN_WRITE_TTL_MS = 15000;
    const ownWriteTokens = new Set();
    const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;





    function shouldRunMaintenance(name) {
        try {
            const key = `lastMaintenanceRunAt_${name}`;
            const last = Number(localStorage.getItem(key)) || 0;
            if (Date.now() - last < MAINTENANCE_INTERVAL_MS) return false;
            localStorage.setItem(key, String(Date.now()));
            return true;
        } catch {
            return true;
        }
    }
    let deferredListRefresh = null;
    let realignCategoryTabs = () => {};
    let categorySwitchTimer = null;




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











    const SMART_NOTIF_STORAGE_KEY = 'smartNotificationsEnabled';
    const AUTO_SKIP_FILLER_STORAGE_KEY = 'autoSkipFillers';



    const SKIPTIME_HELPER_KEY = 'skiptimeHelperEnabled';
    const AUTO_4K_SERVER_KEY = 'auto4kServerEnabled';







    const PASSWORD_SET_MARKER_KEY = 'passwordSetMarker';

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
        },
        auto4kServer: {
            btnId: 'settingsAuto4kServer',
            subtitleId: 'settingsAuto4kServerSubtitle',
            storageKey: AUTO_4K_SERVER_KEY,
            defaultsTo: true,
            interpret: (raw) => raw !== false,
            copy: {
                on: 'Auto-switch to 4k server when available',
                off: '4k auto-pick is off'
            }
        }
    };

    function renderToggle(toggleId, enabled) {

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




    const renderCopyGuardSetting = (enabled) => renderToggle('copyGuard', enabled);
    const renderSmartNotifSetting = (enabled) => renderToggle('smartNotif', enabled);
    const renderAutoSkipFillerSetting = (enabled) => renderToggle('autoSkipFiller', enabled);
    const renderSkiptimeHelperSetting = (enabled) => renderToggle('skiptime', enabled);
    const renderAuto4kServerSetting = (enabled) => renderToggle('auto4kServer', enabled);
    const loadCopyGuardSetting = () => loadToggleSetting('copyGuard');
    const loadSmartNotifSetting = () => loadToggleSetting('smartNotif');
    const loadAutoSkipFillerSetting = () => loadToggleSetting('autoSkipFiller');
    const loadSkiptimeHelperSetting = () => loadToggleSetting('skiptime');
    const loadAuto4kServerSetting = () => loadToggleSetting('auto4kServer');

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



    const { normalizeMovieDurations, cleanupPhantomMovies, scrubAnilistImportDates } = AT.Maintenance;

    function showAuthScreen() {
        // // Paused auth as requested: immediately bypass login and load local app dashboard
        // showMainApp(null);
        // loadData();
        // return;

        elements.authSection.style.display = 'flex';
        elements.mainApp.style.display = 'none';

        const hasGoogleAuth = detectHasGoogleAuth();



        PopupLogger.log('Auth',
            `hasGoogleAuth=${hasGoogleAuth} · redirect=${(() => {
                try { return chrome?.identity?.getRedirectURL?.() || '∅'; } catch { return '∅'; }
            })()} · ua="${(navigator.userAgent || '').slice(0, 140)}"`);
        const authContent = document.querySelector('.auth-content');
        if (authContent) {
            authContent.classList.toggle('auth-mobile', !hasGoogleAuth);
        }




        const emailForm = document.getElementById('authEmailForm');
        const orDivider = document.querySelector('.auth-or-divider');
        if (emailForm) emailForm.style.display = hasGoogleAuth ? 'none' : '';
        if (orDivider) orDivider.style.display = hasGoogleAuth ? 'none' : '';
    }




















    function detectHasGoogleAuth() {
        const ua = navigator.userAgent || '';
        if (/Orion|Firefox|FxiOS/i.test(ua)) return false;
        if (/Android|iPhone|iPad|iPod|Mobile|CriOS|EdgiOS/i.test(ua)) return false;
        if (/AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg/i.test(ua)) return false;
        if (!chrome?.identity?.launchWebAuthFlow) return false;
        let redirectUrl = '';
        try { redirectUrl = chrome.identity.getRedirectURL?.() || ''; }
        catch { return false; }
        if (!/^https:\/\/[a-z0-9]+\.chromiumapp\.org/.test(redirectUrl)) return false;
        return true;
    }

    function showMainApp(user) {
        elements.authSection.style.display = 'none';
        elements.mainApp.style.display = 'flex';
        realignCategoryTabs();





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


        const categoryFilter = (slug, anime) => {
            if (currentCategory === 'all') return true;
            const isMovie = SeasonGrouping.isMovie(slug, anime);
            if (currentCategory === 'movies') return isMovie;
            if (currentCategory === 'series') return !isMovie;
            return true;
        };


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







        if (combinedHtml === _lastRenderedListMarkup && elements.animeList.firstChild) {



            if (elements.animeList.querySelector('.ip-card')) {
                _ipPatch(videoProgress || {});
            }
            return;
        }


        elements.animeList.classList.add('no-transition');




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


        requestAnimationFrame(() => {
            elements.animeList.classList.remove('no-transition');
        });
    }






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
        const parsed = LibraryBackup.parseAndValidate(text);
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


        animeData = merged.animeData;
        videoProgress = merged.videoProgress;
        if (merged.goalSettings) goalSettings = merged.goalSettings;
        badgeState = merged.badgeUnlocks;
        try { window.AnimeTracker.groupCoverImages = merged.groupCoverImages; } catch {}

        renderAnimeList(elements.searchInput?.value || '');
        await updateStats();



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









    function installCardEventListeners() {
        const list = elements.animeList;
        if (!list || list.__cardListenersInstalled) return;

        list.addEventListener('click', (e) => {
            const target = e.target;


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


            const chip = target.closest('[data-compact-status]');
            if (chip && list.contains(chip)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const nextStatus = normalizeCompactStatus(chip.dataset.compactStatus || '');
                if (nextStatus !== currentCompactStatus) {
                    currentCompactStatus = nextStatus;
                    _lastRenderedListMarkup = null;
                    suppressHoverUntilMouseMove();
                    renderAnimeList(getActiveFilter());
                }
                return;
            }


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


            const seasonHeader = target.closest('.season-item-header');
            if (seasonHeader && list.contains(seasonHeader)) {



                const seasonItem = seasonHeader.closest('.season-item');
                if (seasonItem && !seasonItem.classList.contains('season-item-movie')) {
                    e.stopPropagation();
                    seasonItem.classList.toggle('expanded');
                }
                return;
            }


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


            const cardHeader = target.closest('.anime-card-header');
            if (cardHeader && list.contains(cardHeader)) {


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



    function setupCardEventListeners() {
        installCardEventListeners();
        refreshCompactChevrons();
    }




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





            for (const ep of (anime.episodes || [])) {
                if (ep?.durationSource === 'anilist') continue;
                totalWatchTime += Number(ep?.duration) || 0;
            }
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







        const trulyNew = [];
        for (const badge of newlyUnlocked) {
            if (!previousState[badge.id]) {
                next[badge.id] = { unlockedAt: nowIso, notified: false };
                trulyNew.push(badge);
            }
        }

        if (trulyNew.length === 0) {

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






    let _hoverSuppressionActive = false;
    function suppressHoverUntilMouseMove() {
        if (_hoverSuppressionActive) return;
        _hoverSuppressionActive = true;
        document.body.classList.add('is-suppressing-hover');
        const startedAt = performance.now();




        const MIN_DURATION_MS = 180;
        const release = () => {
            const elapsed = performance.now() - startedAt;
            if (elapsed < MIN_DURATION_MS) {

                setTimeout(() => {
                    if (_hoverSuppressionActive) cleanup();
                }, MIN_DURATION_MS - elapsed);
                return;
            }
            cleanup();
        };
        const cleanup = () => {
            _hoverSuppressionActive = false;
            document.body.classList.remove('is-suppressing-hover');
            document.removeEventListener('mousemove', release, true);
            document.removeEventListener('pointermove', release, true);
            clearTimeout(safetyTimer);
        };



        const safetyTimer = setTimeout(cleanup, 800);
        document.addEventListener('mousemove', release, true);
        document.addEventListener('pointermove', release, true);
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



        const isViewMode = !!mode;
        if (elements.categoryTabs) elements.categoryTabs.style.display = isViewMode ? 'none' : '';

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





        let storedSettings = {};
        let passwordIsSet = false;
        try {
            const stored = await chrome.storage.local.get([
                COPY_GUARD_STORAGE_KEY,
                SMART_NOTIF_STORAGE_KEY,
                AUTO_SKIP_FILLER_STORAGE_KEY,
                SKIPTIME_HELPER_KEY,
                PASSWORD_SET_MARKER_KEY
            ]);
            storedSettings = {
                copyGuard: stored[COPY_GUARD_STORAGE_KEY] !== false,
                smartNotif: stored[SMART_NOTIF_STORAGE_KEY] === true,
                autoSkipFiller: stored[AUTO_SKIP_FILLER_STORAGE_KEY] === true,
                skiptimeHelper: stored[SKIPTIME_HELPER_KEY] === true
            };
            const marker = stored[PASSWORD_SET_MARKER_KEY];



            passwordIsSet = !!(marker?.uid && user?.uid && marker.uid === user.uid && marker.setAt);
        } catch (e) {
            PopupLogger.warn('Settings', 'Failed to load toggle state for view:', e);
        }

        SettingsView.render(container, {
            user,
            settings: storedSettings,
            passwordIsSet,
            isMobile: !detectHasGoogleAuth()
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


        const allAnilistCached = slugs.every(slug => {
            const c = AT.AnilistService.cache?.[slug];
            return !!c && !c.retryable;
        });
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




        const QUOTA_BYTES = 10 * 1024 * 1024;
        const TARGET_BYTES = Math.round(QUOTA_BYTES * 0.70);

        const measureBytes = () => new Promise((res) => {
            try { chrome.storage.local.getBytesInUse(null, (b) => { void chrome.runtime.lastError; res(Number(b) || 0); }); }
            catch { res(0); }
        });

        try {
            let bytesBefore = await measureBytes();
            PopupLogger.warn('Storage', `[${context}] quota recovery start (bytes=${bytesBefore})`);

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


            let capCurrent = Math.min(2000, sortedProgress.length);
            let trimmedProgress = Object.fromEntries(sortedProgress.slice(0, capCurrent));
            const trimmedDeletedAnime = pruneDeletedAnimeForQuota(localDeletedAnime);

            await Storage.set({
                videoProgress: trimmedProgress,
                deletedAnime: trimmedDeletedAnime
            });

            let bytesNow = await measureBytes();
            let pass = 1;
            const maxPasses = 3;





            while (bytesNow > TARGET_BYTES && pass < maxPasses && capCurrent > 250) {
                pass += 1;
                capCurrent = Math.max(250, Math.floor(capCurrent / 2));
                trimmedProgress = Object.fromEntries(sortedProgress.slice(0, capCurrent));
                await Storage.set({ videoProgress: trimmedProgress });
                bytesNow = await measureBytes();
                PopupLogger.warn('Storage',
                    `[${context}] pass ${pass}: cap=${capCurrent} bytes=${bytesNow}`);
            }

            const ok = bytesNow <= TARGET_BYTES;
            PopupLogger.warn('Storage',
                `[${context}] quota recovery ${ok ? 'succeeded' : 'partial'}: ` +
                `removed ${cacheKeys.length} cache keys, progress capped at ${capCurrent}, ` +
                `bytes ${bytesBefore} → ${bytesNow}`);
            return ok;
        } catch (recoveryError) {
            PopupLogger.error('Storage', `[${context}] quota recovery failed:`, recoveryError);
            return false;
        }
    }














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



        const anilistDateScrub = scrubAnilistImportDates(repairedData);
        if (anilistDateScrub.changed) {
            try {
                (window.PopupLogger || console).info?.(
                    'Maintenance',
                    `Scrubbed bogus watchedAt from ${anilistDateScrub.scrubbedEpisodes} ` +
                    `AniList-imported episodes across ${anilistDateScrub.affectedAnime.length} anime`
                );
            } catch {                          }
        }
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
            anilistDateScrub.changed ||
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



        if (persistDetectedCompletions(animeData)) changed = true;

        if (changed) {
            const payload = { animeData };
            markInternalSave(payload);
            await AT.Storage.set(payload);
        }
    }

    async function runAutoFetchIfNeeded() {



        if (!AT.FirebaseSync?.getUser?.()) return;

        const { FillerService } = AT;
        const slugsList = Object.keys(animeData);
        const { allFillersCached, allAnilistCached } = checkAllCached(slugsList);




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




    async function loadAndSyncData(options = {}) {
        if (loadAndSyncInProgress) return;
        loadAndSyncInProgress = true;

        const { FirebaseSync } = AT;
        const { skipAutoFetch = false } = options;

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



            if (error?.code === 'AUTH_REJECTED') {
                showToast({
                    title: 'Session expired',
                    body: error.message || 'Please sign in again to sync your library.',
                    type: 'error',
                    duration: 7000
                });
                try { await AT.FirebaseSync.signOut(); } catch {}
                return;
            }
            await loadData({ skipAutoFetch });
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
                const GRACE_MS = 5000;
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





    const _deletingSlugs = new Set();



    async function deleteAnime(slug) {
        const { Storage, FirebaseSync } = AT;
        if (_deletingSlugs.has(slug)) return;



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


            if (siteAnimeId) {
                chrome.runtime.sendMessage(
                    { type: 'WATCHLIST_SYNC', animeId: siteAnimeId, watchlistType: 'remove' },
                    () => { if (chrome.runtime.lastError) {              } }
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


            syncWatchlistFromPopup(slug, wasCompleted ? 'watching' : 'completed');

            renderAnimeList(elements.searchInput?.value || '');
            updateStats();
        } catch (e) {
            PopupLogger.error('Complete', 'Error:', e);
        }
    }




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


            syncWatchlistFromPopup(slug, wasDropped ? 'watching' : 'dropped');

            renderAnimeList(elements.searchInput?.value || '');
            updateStats();
        } catch (e) {
            PopupLogger.error('Drop', 'Error:', e);
        }
    }





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


            syncWatchlistFromPopup(slug, wasOnHold ? 'watching' : 'on_hold');

            renderAnimeList(elements.searchInput?.value || '');
            updateStats();
        } catch (e) {
            PopupLogger.error('OnHold', 'Error:', e);
        }
    }




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
        elements.episodesWatchedInput.value = '';
        elements.animeSlugInput.classList.remove('error');
        elements.episodesWatchedInput.classList.remove('error', 'invalid-range');
        const includeFillersCb = document.getElementById('includeFillers');
        if (includeFillersCb) includeFillersCb.checked = false;
        const includeFillerLabel = document.getElementById('includeFillerLabel');
        if (includeFillerLabel) includeFillerLabel.style.display = '';
        const includeFillersBlock = document.getElementById('includeFillersBlock');
        if (includeFillersBlock) {
            includeFillersBlock.style.display = 'none';
            includeFillersBlock.dataset.checked = 'false';
        }


        _setSlugStatus('idle');
        const slugDetectedHint = document.getElementById('slugDetectedHint');
        if (slugDetectedHint) { slugDetectedHint.style.display = 'none'; slugDetectedHint.textContent = ''; }
        const slugMeta = document.getElementById('slugMeta');
        if (slugMeta) {
            slugMeta.style.display = 'none';
            const slugCard = slugMeta.closest('.slug-card');
            if (slugCard) slugCard.dataset.hasMeta = 'false';
        }
        const fillerActionBar = document.getElementById('fillerActionBar');
        if (fillerActionBar) fillerActionBar.style.display = 'none';


        const counter = document.getElementById('episodesCounter');
        if (counter) counter.style.display = 'none';


        const confirmBtn = elements.confirmAddAnime;
        if (confirmBtn) {
            confirmBtn.dataset.state = 'idle';
            confirmBtn.disabled = false;
        }

        _addDialogDetectedTitle = null;
        _addDialogKnownTotal = null;
        _addDialogTotalCanon = null;
        _addDialogCurrentSlug = null;
        _publishDialogState();
        updateEpisodesPreview('');
        openDialogA11y(elements.addAnimeDialog, {
            initialFocus: elements.animeSlugInput,
            onCancel: hideAddAnimeDialog
        });
    }






    let _addDialogDetectedTitle = null;
    let _addDialogKnownTotal = null;
    let _addDialogTotalCanon = null;
    let _addDialogSlugDebounce = null;
    let _addDialogCurrentSlug = null;

    function _setSlugStatus(status) {

        const wrap = document.querySelector('.slug-input-wrap');
        if (wrap) wrap.dataset.status = status;
    }



    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.__addDialogState = { knownTotal: null };

    function _publishDialogState() {
        window.AnimeTracker.__addDialogState.knownTotal = _addDialogKnownTotal;
    }

    function _setDetectedHint(rawInput, slug) {
        const el = document.getElementById('slugDetectedHint');
        if (!el) return;
        const isUrl = /^https?:\/\//i.test(rawInput || '') || /\//.test(rawInput || '');
        if (isUrl && slug && slug !== rawInput.trim()) {
            el.innerHTML = `Detected slug: <code>${slug}</code>`;
            el.style.display = 'block';
        } else {
            el.style.display = 'none';
            el.textContent = '';
        }
    }











    async function onSlugInputChange(rawSlug) {
        const { FillerService } = AT;
        const slug = extractSlugFromInput(rawSlug);
        _addDialogCurrentSlug = slug;
        _setDetectedHint(rawSlug, slug);

        const bar = document.getElementById('fillerActionBar');
        const slugMeta = document.getElementById('slugMeta');

        if (!slug) {
            _setSlugStatus('idle');
            if (bar) bar.style.display = 'none';
            if (slugMeta) {
            slugMeta.style.display = 'none';
            const slugCard = slugMeta.closest('.slug-card');
            if (slugCard) slugCard.dataset.hasMeta = 'false';
        }
            _addDialogKnownTotal = null;
            _addDialogTotalCanon = null;
            return;
        }


        _setSlugStatus('loading');
        if (bar) {
            bar.style.display = 'flex';
            bar.className = 'filler-action-bar is-loading';
            bar.textContent = 'Fetching…';
        }

        const [episodeTypes, animeInfoFromCache] = await Promise.all([
            FillerService.fetchEpisodeTypes(slug).catch(() => null),
            (async () => {
                try {
                    const s = await chrome.storage.local.get([`animeinfo_${slug}`]);
                    return s[`animeinfo_${slug}`] || null;
                } catch { return null; }
            })()
        ]);

        if (slug !== _addDialogCurrentSlug) return;


        let availableTotal = null;
        let finalTotal = null;
        if (animeInfoFromCache && !animeInfoFromCache.notFound) {
            availableTotal = animeInfoFromCache.latestEpisode || null;
            finalTotal = animeInfoFromCache.totalEpisodes || null;
        }
        if (!availableTotal && episodeTypes && !episodeTypes.notFound) {
            availableTotal = episodeTypes.totalEpisodes || null;
        }
        if (!finalTotal) {
            const al = AT.AnilistService.getTotalEpisodes?.(slug);
            if (al && al > 0) finalTotal = al;
        }
        if (!availableTotal) availableTotal = finalTotal;

        _addDialogKnownTotal = availableTotal;
        _publishDialogState();

        const hasFillerData = episodeTypes && !episodeTypes.notFound;
        const fillerNums = hasFillerData ? (episodeTypes.filler || []) : [];
        const totalEps = hasFillerData ? (episodeTypes.totalEpisodes || 0) : 0;
        const canonCount = totalEps > 0
            ? Math.max(0, totalEps - fillerNums.length)
            : (availableTotal ? Math.max(0, availableTotal - fillerNums.length) : null);
        _addDialogTotalCanon = canonCount;

        const showAll = !!availableTotal;
        const showCanon = !!canonCount && canonCount !== availableTotal;
        const showSkip = fillerNums.length > 0;
        const hasAnyChip = showAll || showCanon || showSkip;
        const hasAnyInfo = hasFillerData || availableTotal;


        if (bar) {
            if (!hasAnyInfo && !hasAnyChip) {
                bar.style.display = 'none';
            } else {
                bar.className = 'filler-action-bar';
                bar.textContent = '';


                const left = document.createElement('div');
                left.className = 'fab-left';

                if (canonCount !== null) {
                    const b = document.createElement('span');
                    b.className = 'filler-badge filler-badge-canon';
                    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg><span>${canonCount} canon</span>`;
                    left.appendChild(b);
                }
                if (fillerNums.length > 0) {
                    const b = document.createElement('span');
                    b.className = 'filler-badge filler-badge-fillers fab-filler-toggle';
                    b.setAttribute('role', 'button');
                    b.setAttribute('tabindex', '0');
                    b.setAttribute('aria-expanded', 'false');
                    b.setAttribute('aria-controls', 'fabFillerDetails');
                    b.setAttribute('title', 'Show filler episodes');
                    const { buildRangeString: brs } = AT.EpisodeParse;
                    const fillerStr = brs([...fillerNums].sort((a, b) => a - b));
                    b.innerHTML =
                        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>` +
                        `<span>${fillerNums.length} fillers</span>` +
                        `<svg class="fab-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;
                    left.appendChild(b);







                    const details = document.createElement('div');
                    details.className = 'fab-filler-details';
                    details.id = 'fabFillerDetails';
                    details.hidden = true;
                    details.textContent = fillerStr;



                    b._detailsEl = details;
                    bar._detailsEl = details;
                }

                bar.appendChild(left);


                if (hasAnyChip) {
                    const right = document.createElement('div');
                    right.className = 'fab-right';

                    const mkChip = (action, label, sub) => {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'ep-chip';
                        btn.dataset.action = action;
                        btn.textContent = label;
                        if (sub) {
                            const s = document.createElement('span');
                            s.className = 'ep-chip-sub';
                            s.textContent = sub;
                            btn.appendChild(s);
                        }
                        return btn;
                    };

                    if (showAll) right.appendChild(mkChip('all', 'All', `1–${availableTotal}`));
                    if (showCanon) right.appendChild(mkChip('canon', 'Canon', `${canonCount}`));
                    if (showSkip) right.appendChild(mkChip('skip-fillers', '⏭ Skip fillers'));

                    bar.appendChild(right);
                }






                if (bar._detailsEl) {
                    bar.appendChild(bar._detailsEl);
                }

                bar.style.display = 'flex';
            }
        }


        if (slugMeta) {
            const cover = document.getElementById('slugMetaCover');
            const titleEl = document.getElementById('slugMetaTitle');
            const statsEl = document.getElementById('slugMetaStats');
            const cachedAnilist = AT.AnilistService.cache?.[slug];
            const detectedTitle = animeInfoFromCache?.title
                || (cachedAnilist && !cachedAnilist.notFound && cachedAnilist.title)
                || null;
            const coverUrl = animeInfoFromCache?.coverImage
                || (cachedAnilist && cachedAnilist.coverImage)
                || null;
            const status = animeInfoFromCache?.status || cachedAnilist?.status || null;

            if (detectedTitle || coverUrl || availableTotal) {
                const slugCard = slugMeta.closest('.slug-card');
                if (slugCard) slugCard.dataset.hasMeta = 'true';
                slugMeta.style.display = '';
                if (cover) {
                    if (coverUrl) { cover.src = coverUrl; cover.style.display = ''; }
                    else { cover.removeAttribute('src'); cover.style.display = 'none'; }
                }
                if (titleEl) {




                    const slugFallback = generateTitleFromSlug(slug);
                    const finalTitle = detectedTitle || slugFallback;
                    const looksRedundant = !detectedTitle
                        || detectedTitle.toLowerCase().replace(/\s+/g, '-') === slug.toLowerCase();
                    if (looksRedundant) {
                        titleEl.textContent = '';
                        titleEl.style.display = 'none';
                    } else {
                        titleEl.textContent = finalTitle;
                        titleEl.style.display = '';
                    }
                }
                if (statsEl) {
                    const parts = [];
                    if (availableTotal) parts.push(`<span>${availableTotal} eps</span>`);
                    if (status === 'RELEASING') parts.push(`<span class="stat-airing">⬤ Airing</span>`);
                    else if (status === 'FINISHED') parts.push(`<span class="stat-finished">✓ Finished</span>`);
                    statsEl.innerHTML = parts.join(' · ');
                }
            } else {
                const slugCard = slugMeta.closest('.slug-card');
                if (slugCard) slugCard.dataset.hasMeta = 'false';
                slugMeta.style.display = 'none';
            }
        }


        const hasUsefulData = (episodeTypes && !episodeTypes.notFound)
            || (animeInfoFromCache && !animeInfoFromCache.notFound);
        _setSlugStatus(hasUsefulData ? 'ok' : (episodeTypes === null && !animeInfoFromCache ? 'idle' : 'fail'));


        {
            const cachedAnilist = AT.AnilistService.cache?.[slug];
            _addDialogDetectedTitle = animeInfoFromCache?.title
                || (cachedAnilist && !cachedAnilist.notFound && cachedAnilist.title)
                || null;
        }

        if (elements.episodesWatchedInput.value) {
            updateEpisodesPreview(elements.episodesWatchedInput.value);
        }
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






    function syncWatchlistFromPopup(slug, watchlistType) {
        try {
            const siteId = animeData[slug]?.siteAnimeId;
            if (siteId) {

                chrome.runtime.sendMessage(
                    { type: 'WATCHLIST_SYNC', animeId: siteId, watchlistType },
                    () => { if (chrome.runtime.lastError) {              } }
                );
                PopupLogger.debug('WatchlistSync', `sent ${watchlistType} for #${siteId}`);
            } else {

                PopupLogger.debug('WatchlistSync', `fetching siteAnimeId for ${slug}...`);
                chrome.runtime.sendMessage(
                    { type: 'FETCH_ANIME_INFO', slug },
                    (response) => {
                        if (chrome.runtime.lastError) return;
                        const fetchedId = response?.info?.siteAnimeId;
                        if (fetchedId) {

                            if (animeData[slug]) animeData[slug].siteAnimeId = fetchedId;

                            chrome.runtime.sendMessage(
                                { type: 'WATCHLIST_SYNC', animeId: fetchedId, watchlistType },
                                () => { if (chrome.runtime.lastError) {              } }
                            );
                            PopupLogger.debug('WatchlistSync', `fetched #${fetchedId}, sent ${watchlistType}`);

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


    const {
        setManualListState,
        markTitleEdited,
        clearDeletedAnimeSlug
    } = AT.StatusService;

    async function addAnimeWithEpisodes() {
        const { Storage, FirebaseSync, SeasonGrouping } = AT;
        const slugInput = elements.animeSlugInput.value;
        const slug = extractSlugFromInput(slugInput);



        const detectedTitle = _addDialogDetectedTitle && _addDialogDetectedTitle.trim();
        const title = detectedTitle || generateTitleFromSlug(slug);
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
        elements.confirmAddAnime.dataset.state = 'loading';

        try {
            const now = new Date().toISOString();
            const isMovie = SeasonGrouping.isMovie(slug, { title });
            const defaultDuration = isMovie ? 0 : 1440;
            const resumedFromHold = !!(
                animeData[slug]
                && (animeData[slug].onHoldAt || animeData[slug].listState === 'on_hold')
            );



            let inferredDuration = defaultDuration;
            if (animeData[slug]) {
                const realDurs = (animeData[slug].episodes || [])
                    .filter(ep => ep?.durationSource === 'video' && Number(ep.duration) > 0)
                    .map(ep => Number(ep.duration))
                    .sort((a, b) => a - b);
                if (realDurs.length > 0) {
                    inferredDuration = realDurs[Math.floor(realDurs.length / 2)];
                }
            }
            const episodes = episodeNumbers.map(num => ({ number: num, duration: inferredDuration, watchedAt: now }));

            if (animeData[slug]) {
                const existingEpisodes = animeData[slug].episodes || [];
                const existingByNumber = new Map(existingEpisodes.map(ep => [ep.number, ep]));
                for (const ep of episodes) {
                    const existing = existingByNumber.get(ep.number);
                    if (!existing) {
                        existingEpisodes.push(ep);
                    } else if (existing.durationSource === 'anilist') {

                        const idx = existingEpisodes.indexOf(existing);
                        existingEpisodes[idx] = { ...existing, watchedAt: now, duration: inferredDuration, durationSource: 'manual' };
                    }
                }
                existingEpisodes.sort((a, b) => a.number - b.number);
                animeData[slug].episodes = existingEpisodes;
                animeData[slug].totalWatchTime = existingEpisodes.reduce((sum, ep) => sum + (ep.duration || 0), 0);
                animeData[slug].lastWatched = now;
                if (resumedFromHold) {
                    setManualListState(animeData[slug], 'active', now);
                }
            } else {
                animeData[slug] = {
                    title, slug, episodes,
                    totalWatchTime: episodes.reduce((sum, ep) => sum + (ep.duration || 0), 0),
                    lastWatched: now, totalEpisodes: null
                };




            }

            const deletedResult = await Storage.get(['deletedAnime']);
            const deletedAnime = clearDeletedAnimeSlug(deletedResult.deletedAnime || {}, slug);
            const dataToSave = { animeData, videoProgress, deletedAnime };
            const user = FirebaseSync.getUser();
            if (user) dataToSave.userId = user.uid;
            markInternalSave(dataToSave);
            await Storage.set(dataToSave);
            if (resumedFromHold) {
                syncWatchlistFromPopup(slug, 'watching');
            }

            renderAnimeList(elements.searchInput?.value || '');
            updateStats();


            elements.confirmAddAnime.dataset.state = 'success';
            setTimeout(() => {
                hideAddAnimeDialog();


                if (elements.confirmAddAnime) {
                    elements.confirmAddAnime.dataset.state = 'idle';
                    elements.confirmAddAnime.disabled = false;
                }
            }, 800);




            const isPlaceholderDur = window.AnimeTrackerMergeUtils?.isPlaceholderDuration
                || ((d) => { const v = Number(d) || 0; return v <= 0 || v === 1440 || v === 6000 || v === 7200; });
            const hasPlaceholderDuration = Array.isArray(animeData[slug].episodes)
                && animeData[slug].episodes.some(ep => isPlaceholderDur(ep?.duration));
            if (!animeData[slug].coverImage || hasPlaceholderDuration) {
                chrome.runtime.sendMessage(
                    { type: 'BATCH_FETCH_ANIME_INFO', slugs: [slug] },
                    () => { if (chrome.runtime.lastError) {              } }
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

            elements.confirmAddAnime.disabled = false;
            elements.confirmAddAnime.dataset.state = 'idle';
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






















    async function maybePromptPostUpdateFetch() {
        const { Storage } = AT;
        try {
            const stored = await Storage.get([
                'postUpdateFetchTriggeredAt',
                'postUpdateFetchToVersion',
                'metadataRepairState'
            ]);

            if (stored.postUpdateFetchTriggeredAt) {

                await Storage.remove([
                    'postUpdateFetchTriggeredAt',
                    'postUpdateFetchFromVersion',
                    'postUpdateFetchToVersion'
                ]);
            }





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





    const EMAIL_AUTH_ERRORS = {
        EMAIL_NOT_FOUND: 'No account found for this email.',
        INVALID_PASSWORD: 'Wrong password. Try again or reset it.',
        INVALID_LOGIN_CREDENTIALS: 'Wrong email or password.',
        USER_DISABLED: 'This account has been disabled.',
        EMAIL_EXISTS: 'An account already exists for this email.',
        OPERATION_NOT_ALLOWED: 'Email/password sign-in is not enabled for this project. Enable it in Firebase Console → Authentication → Sign-in methods.',
        WEAK_PASSWORD: 'Password is too weak (min 6 characters).',
        INVALID_EMAIL: 'Please enter a valid email address.',
        MISSING_PASSWORD: 'Please enter your password.',
        MISSING_EMAIL: 'Please enter your email.',
        TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Please wait a minute and try again.',
        CREDENTIAL_TOO_OLD_LOGIN_AGAIN: 'For security, please sign in with Google again before setting a password.'
    };

    function friendlyAuthError(err) {
        const raw = (err?.message || '').trim();

        const code = raw.split(':')[0].trim().toUpperCase().replace(/\s+/g, '_');
        return EMAIL_AUTH_ERRORS[code] || raw || 'Sign-in failed.';
    }

    function setEmailFormBusy(busy, label) {
        const btn = document.getElementById('emailSignInBtn');
        const forgotBtn = document.getElementById('authForgotPasswordBtn');
        if (btn) {
            btn.disabled = busy;
            const lbl = btn.querySelector('.btn-auth-label');
            if (lbl) lbl.textContent = label || 'Sign in';
        }
        if (forgotBtn) forgotBtn.disabled = busy;
        const inputs = document.querySelectorAll('#authEmailForm .auth-input');
        inputs.forEach((el) => { el.disabled = busy; });
    }

    function setEmailFormError(message, opts = {}) {
        const errEl = document.getElementById('authEmailError');
        if (!errEl) return;
        const isSuccess = opts.success === true;
        errEl.classList.toggle('auth-error--success', isSuccess);
        if (message) {
            errEl.textContent = message;
            errEl.style.display = 'block';
        } else {
            errEl.textContent = '';
            errEl.style.display = 'none';
            errEl.classList.remove('auth-error--success');
        }
    }

    function readEmailFormCredentials() {
        const email = (document.getElementById('authEmailInput')?.value || '').trim();
        const password = document.getElementById('authPasswordInput')?.value || '';
        return { email, password };
    }

    function isPlausibleEmailAddress(email) {
        if (!email || email.length > 254 || /\s/.test(email)) return false;

        const atIndex = email.indexOf('@');
        if (atIndex <= 0 || atIndex !== email.lastIndexOf('@')) return false;

        const localPart = email.slice(0, atIndex);
        const domain = email.slice(atIndex + 1);
        if (
            localPart.length > 64 ||
            localPart.startsWith('.') ||
            localPart.endsWith('.') ||
            localPart.includes('..')
        ) {
            return false;
        }

        const domainLabels = domain.split('.');
        if (domainLabels.length < 2) return false;
        if (domainLabels.some((label) =>
            !/^[a-z0-9-]+$/i.test(label) ||
            label.startsWith('-') ||
            label.endsWith('-')
        )) {
            return false;
        }

        return /^[a-z]{2,63}$/i.test(domainLabels[domainLabels.length - 1]);
    }

    async function handleEmailAuth({ mode }) {
        const { FirebaseSync } = AT;
        const { email, password } = readEmailFormCredentials();
        setEmailFormError('');

        if (!email) { setEmailFormError(EMAIL_AUTH_ERRORS.MISSING_EMAIL); return; }
        if (!isPlausibleEmailAddress(email)) {
            setEmailFormError(EMAIL_AUTH_ERRORS.INVALID_EMAIL);
            document.getElementById('authEmailInput')?.focus();
            return;
        }
        if (!password) { setEmailFormError(EMAIL_AUTH_ERRORS.MISSING_PASSWORD); return; }
        if (mode === 'signup' && password.length < 6) {
            setEmailFormError(EMAIL_AUTH_ERRORS.WEAK_PASSWORD);
            return;
        }

        const busyLabel = mode === 'signup' ? 'Creating…' : 'Signing in…';
        const idleLabel = 'Sign in';
        setEmailFormBusy(true, busyLabel);

        try {
            if (mode === 'signup') {
                await FirebaseSync.signUpWithEmailPassword(email, password);
            } else {
                await FirebaseSync.signInWithEmailPassword(email, password);
            }



            const pwEl = document.getElementById('authPasswordInput');
            if (pwEl) pwEl.value = '';
        } catch (err) {

            await chrome.storage.local.set({ pendingBackgroundMetadataRepair: false });
            PopupLogger.error('Firebase', `${mode === 'signup' ? 'Sign-up' : 'Sign-in'} error:`, err);
            setEmailFormError(friendlyAuthError(err));
        } finally {
            setEmailFormBusy(false, idleLabel);
        }
    }

    async function handleForgotPassword() {
        const { FirebaseSync } = AT;
        const { email } = readEmailFormCredentials();
        setEmailFormError('');

        const emailInput = document.getElementById('authEmailInput');
        if (!email) {
            setEmailFormError('Enter your email above first, then tap "Forgot password?".');
            emailInput?.focus();
            return;
        }


        if (!isPlausibleEmailAddress(email)) {
            setEmailFormError(EMAIL_AUTH_ERRORS.INVALID_EMAIL);
            emailInput?.focus();
            return;
        }




        const forgotBtn = document.getElementById('authForgotPasswordBtn');
        const originalText = forgotBtn?.textContent || 'Forgot password?';
        if (forgotBtn) {
            forgotBtn.disabled = true;
            forgotBtn.textContent = 'Sending…';
        }

        try {
            await FirebaseSync.sendPasswordReset(email);
            PopupLogger.log('Firebase', `Password reset request accepted for ${email}`);

            setEmailFormError(
                `If an account exists for ${email}, a reset email will arrive shortly. Check your inbox and spam folder.`,
                { success: true }
            );
        } catch (err) {
            PopupLogger.error('Firebase', 'Password reset error:', err);
            setEmailFormError(friendlyAuthError(err));
        } finally {
            if (forgotBtn) {
                forgotBtn.disabled = false;
                forgotBtn.textContent = originalText;
            }
        }
    }











    async function openSetPasswordModal() {
        document.getElementById('setPasswordOverlay')?.remove();

        const { FirebaseSync, Dialogs } = AT;
        const user = FirebaseSync.getUser?.() || null;






        let isUpdate = false;
        try {
            const stored = await chrome.storage.local.get([PASSWORD_SET_MARKER_KEY]);
            const marker = stored[PASSWORD_SET_MARKER_KEY];
            isUpdate = !!(marker?.uid && user?.uid && marker.uid === user.uid && marker.setAt);
        } catch {                                                     }

        const COPY = isUpdate ? {
            title:        'Update password',
            hint:         'Replace your existing password — same email, new password.',
            saveIdle:     'Update password',
            saveBusy:     'Updating…',
            successTitle: 'Password updated.',
            successBody:  'Use the new password on mobile.'
        } : {
            title:        'Set password for mobile',
            hint:         'Sign in on Orion / Safari with this password — same library, same account.',
            saveIdle:     'Save password',
            saveBusy:     'Saving…',
            successTitle: 'Password set.',
            successBody:  'Use it to sign in on mobile.'
        };

        const overlay = document.createElement('div');
        overlay.id = 'setPasswordOverlay';
        overlay.className = 'dialog-overlay set-password-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'setPasswordTitle');
        overlay.setAttribute('aria-describedby', 'setPasswordHint');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = `
            <form class="dialog set-password-dialog" novalidate autocomplete="on">
                <input type="email" name="username" autocomplete="username"
                       value="${(user?.email || '').replace(/"/g, '&quot;')}"
                       hidden tabindex="-1" aria-hidden="true">
                <div class="dialog-header">
                    <span class="set-password-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
                        </svg>
                    </span>
                    <h3 id="setPasswordTitle"></h3>
                    <button class="dialog-close" type="button" aria-label="Close dialog" data-close>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                             aria-hidden="true" focusable="false">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
                <div class="dialog-body">
                    <div class="set-password-hint" id="setPasswordHint">
                        <svg class="set-password-hint-icon" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2" stroke-linecap="round"
                             stroke-linejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="16" x2="12" y2="12"/>
                            <line x1="12" y1="8" x2="12.01" y2="8"/>
                        </svg>
                        <div class="set-password-hint-text">
                            <span class="set-password-hint-copy"></span>
                            <span class="set-password-email-pill" id="setPasswordEmailPill"></span>
                        </div>
                    </div>

                    <div class="set-password-field">
                        <label class="set-password-label" for="setPasswordInput">New password</label>
                        <div class="set-password-input-wrap">
                            <input type="password" id="setPasswordInput" class="set-password-input"
                                   autocomplete="new-password" minlength="6"
                                   placeholder="At least 6 characters"
                                   aria-describedby="setPasswordStrengthLabel">
                            <button type="button" class="set-password-toggle"
                                    data-toggle="setPasswordInput"
                                    aria-label="Show password" aria-pressed="false">
                                <svg class="eye-on" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                                     aria-hidden="true">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                    <circle cx="12" cy="12" r="3"/>
                                </svg>
                                <svg class="eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                                     aria-hidden="true">
                                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                                    <line x1="1" y1="1" x2="23" y2="23"/>
                                </svg>
                            </button>
                        </div>
                        <div class="set-password-strength" data-level="0">
                            <div class="set-password-strength-bars" aria-hidden="true">
                                <span></span><span></span><span></span>
                            </div>
                            <span class="set-password-strength-label" id="setPasswordStrengthLabel">&nbsp;</span>
                        </div>
                    </div>

                    <p class="auth-error set-password-error" id="setPasswordError"
                       role="alert" style="display:none"></p>
                </div>
                <div class="dialog-actions">
                    <button class="btn btn-secondary" type="button" data-close>Cancel</button>
                    <button class="btn btn-primary" type="submit" id="setPasswordSubmit" disabled>
                        <span class="set-password-submit-label"></span>
                    </button>
                </div>
            </form>
        `;



        overlay.querySelector('#setPasswordTitle').textContent = COPY.title;
        overlay.querySelector('.set-password-hint-copy').textContent = COPY.hint;
        overlay.querySelector('.set-password-submit-label').textContent = COPY.saveIdle;


        const pillEl = overlay.querySelector('#setPasswordEmailPill');
        if (pillEl) {
            if (user?.email) {
                pillEl.textContent = user.email;
            } else {

                pillEl.style.display = 'none';
            }
        }

        const pwInput = overlay.querySelector('#setPasswordInput');
        const submitBtn = overlay.querySelector('#setPasswordSubmit');
        const errEl = overlay.querySelector('#setPasswordError');
        const strengthRow = overlay.querySelector('.set-password-strength');
        const strengthLabel = overlay.querySelector('#setPasswordStrengthLabel');
        const formEl = overlay.querySelector('form.set-password-dialog');

        const showErr = (msg) => {
            if (!errEl) return;
            errEl.textContent = msg || '';
            errEl.style.display = msg ? 'block' : 'none';
        };




        overlay.querySelectorAll('.set-password-toggle').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.toggle;
                const target = overlay.querySelector(`#${id}`);
                if (!target) return;
                const isPassword = target.type === 'password';
                target.type = isPassword ? 'text' : 'password';
                btn.setAttribute('aria-pressed', isPassword ? 'true' : 'false');
                btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
                btn.closest('.set-password-input-wrap')?.classList.toggle('is-revealed', isPassword);


                target.focus();
                try {
                    const len = target.value.length;
                    target.setSelectionRange(len, len);
                } catch {                                                     }
            });
        });





        const computeStrength = (pw) => {
            if (!pw) return 0;
            let classes = 0;
            if (/[a-z]/.test(pw)) classes++;
            if (/[A-Z]/.test(pw)) classes++;
            if (/\d/.test(pw))    classes++;
            if (/[^A-Za-z0-9]/.test(pw)) classes++;
            if (pw.length < 6) return 1;
            if (pw.length >= 12 && classes >= 3) return 3;
            if (pw.length >= 8  && classes >= 2) return 2;
            return 1;
        };
        const STRENGTH_LABELS = { 0: '', 1: 'Weak', 2: 'Medium', 3: 'Strong' };
        const updateStrength = () => {
            const lvl = computeStrength(pwInput.value);
            strengthRow.dataset.level = String(lvl);
            strengthLabel.textContent = STRENGTH_LABELS[lvl] || '';
        };


        const refreshSubmitState = () => {
            submitBtn.disabled = pwInput.value.length < 6;
        };
        const onAnyChange = () => {


            if (errEl?.textContent) showErr('');
            updateStrength();
            refreshSubmitState();
        };
        pwInput.addEventListener('input', onAnyChange);


        const close = () => { Dialogs.close(overlay); setTimeout(() => overlay.remove(), 0); };
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
            if (e.target.closest('[data-close]')) {
                e.preventDefault();
                close();
            }
        });


        formEl.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (submitBtn.disabled) return;
            const pw = pwInput.value;
            showErr('');
            if (pw.length < 6) { showErr('Password must be at least 6 characters.'); return; }

            const labelEl = submitBtn.querySelector('.set-password-submit-label');
            const setLoadingLabel = (text) => {
                submitBtn.disabled = true;
                submitBtn.classList.add('is-loading');
                if (labelEl) labelEl.textContent = text;
            };
            const restoreIdleLabel = () => {
                submitBtn.classList.remove('is-loading');
                if (labelEl) labelEl.textContent = COPY.saveIdle;
                refreshSubmitState();
            };






            const trySetPasswordWithReauth = async () => {
                try {
                    await FirebaseSync.setPasswordForCurrentUser(pw);
                    return true;
                } catch (firstErr) {
                    const code = (firstErr?.message || '').split(':')[0]
                        .trim().toUpperCase().replace(/\s+/g, '_');
                    if (code !== 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN') throw firstErr;

                    PopupLogger.log('Firebase', 'Credential too old — reauthenticating via Google before retry');
                    setLoadingLabel('Verifying with Google…');
                    try {
                        await FirebaseSync.signInWithGoogle();
                    } catch (reauthErr) {
                        const m = (reauthErr?.message || '').toLowerCase();
                        const cancelled = m.includes('did not approve') ||
                            m.includes('cancelled') || m.includes('closed') ||
                            m.includes('popup_closed');
                        if (cancelled) {
                            throw new Error('Reauthentication cancelled. Please try again.');
                        }
                        throw reauthErr;
                    }
                    setLoadingLabel(COPY.saveBusy);
                    await FirebaseSync.setPasswordForCurrentUser(pw);
                    return true;
                }
            };

            setLoadingLabel(COPY.saveBusy);
            try {






                if (isUpdate && user?.email) {
                    setLoadingLabel('Checking…');
                    try {
                        const sameAsCurrent = await FirebaseSync.verifyPasswordSilently(user.email, pw);
                        if (sameAsCurrent) {
                            showErr('That\'s already your current password. Pick a new one.');
                            restoreIdleLabel();
                            return;
                        }
                    } catch (probeErr) {




                        PopupLogger.warn('Firebase', 'Same-password probe failed:', probeErr?.message);
                    }
                    setLoadingLabel(COPY.saveBusy);
                }
                await trySetPasswordWithReauth();




                const currentUser = FirebaseSync.getUser?.();
                if (currentUser?.uid) {
                    try {
                        await chrome.storage.local.set({
                            [PASSWORD_SET_MARKER_KEY]: {
                                uid: currentUser.uid,
                                setAt: new Date().toISOString()
                            }
                        });
                    } catch (e) {
                        PopupLogger.warn('Settings', `Failed to persist password-set marker: ${e?.message}`);
                    }
                }
                close();
                showToast({
                    title: COPY.successTitle,
                    body:  COPY.successBody,
                    type:  'success'
                });



                if (currentViewMode === 'settings') {
                    renderSettingsView();
                }
            } catch (err) {
                PopupLogger.error('Firebase', 'Set password error:', err);
                showErr(friendlyAuthError(err));
                restoreIdleLabel();
            }
        });

        document.body.appendChild(overlay);


        Dialogs.open(overlay, { initialFocus: pwInput });
    }

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.openSetPasswordModal = openSetPasswordModal;

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












    function showToast(messageOrOpts, typeArg) {
        const opts = (messageOrOpts && typeof messageOrOpts === 'object' && !Array.isArray(messageOrOpts))
            ? messageOrOpts
            : { message: String(messageOrOpts ?? ''), type: typeArg };
        const type = opts.type === 'success' ? 'success' : 'error';
        const duration = Math.max(1500, Math.min(opts.duration || 4000, 10000));



        let title = (opts.title || '').trim();
        let body  = (opts.body  || '').trim();
        if (!title && !body) {
            const raw = String(opts.message || '').trim();
            const m = raw.match(/^([^.!?]{2,40}[.!?])\s+(.{4,})$/);
            if (m) { title = m[1].trim(); body = m[2].trim(); }
            else   { title = raw; }
        }


        document.getElementById('atGenericToast')?.remove();

        const toast = document.createElement('div');
        toast.id = 'atGenericToast';
        toast.className = `at-toast at-toast--${type}`;
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
        toast.style.setProperty('--at-toast-duration', `${duration}ms`);



        const iconMarkup = type === 'success'
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
               </svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
               </svg>`;

        toast.innerHTML = `
            <span class="at-toast-icon" aria-hidden="true">${iconMarkup}</span>
            <div class="at-toast-text">
                <span class="at-toast-title"></span>
                ${body ? '<span class="at-toast-body"></span>' : ''}
            </div>
            <button type="button" class="at-toast-close" aria-label="Dismiss">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
            <span class="at-toast-progress" aria-hidden="true"></span>
        `;

        toast.querySelector('.at-toast-title').textContent = title;
        if (body) toast.querySelector('.at-toast-body').textContent = body;

        const dismiss = () => {
            if (toast._dismissed) return;
            toast._dismissed = true;
            toast.classList.add('at-toast--leaving');
            setTimeout(() => { try { toast.remove(); } catch {             } }, 180);
        };
        toast.querySelector('.at-toast-close').addEventListener('click', dismiss);

        document.body.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('at-toast--visible'));

        const timerId = setTimeout(dismiss, duration);

        toast.addEventListener('mouseenter', () => {
            clearTimeout(timerId);
            toast.classList.add('at-toast--paused');
        });
        toast.addEventListener('mouseleave', () => {
            toast.classList.remove('at-toast--paused');

            setTimeout(dismiss, 1500);
        });
    }


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

        const emailForm = document.getElementById('authEmailForm');
        const emailSignInBtn = document.getElementById('emailSignInBtn');
        const forgotPasswordBtn = document.getElementById('authForgotPasswordBtn');
        if (emailForm && emailSignInBtn) {
            emailForm.addEventListener('submit', (e) => {
                e.preventDefault();
                handleEmailAuth({ mode: 'signin' });
            });
        }
        if (forgotPasswordBtn) {
            forgotPasswordBtn.addEventListener('click', () => handleForgotPassword());
        }

        if (elements.settingsBtn) {



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







        const handleToggle = async (key, renderFn, getNext, onAfterSave) => {
            const btn = document.getElementById(key.btnId);
            if (!btn) return;
            const currentlyEnabled = getNext.read(btn);
            const nextEnabled = !currentlyEnabled;
            renderFn(nextEnabled);
            try {
                await chrome.storage.local.set({ [key.storageKey]: nextEnabled });
                if (onAfterSave) onAfterSave(nextEnabled);



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
            if (e.target.closest('#settingsAuto4kServer')) {
                e.stopPropagation();
                await handleToggle(
                    { btnId: 'settingsAuto4kServer', storageKey: AUTO_4K_SERVER_KEY },
                    renderAuto4kServerSetting,
                    { read: (btn) => btn.dataset.enabled !== 'false' }
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
                        await loadAndSyncData({ skipAutoFetch: true });
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

            if (e.target.closest('#settingsSetPassword')) {
                setSettingsDataToolsExpanded(false);
                setSettingsPreferencesExpanded(false);
                openSetPasswordModal();
                return;
            }

            if (e.target.closest('#settingsFetchFillers')) {
                setSettingsDataToolsExpanded(false);
                setSettingsPreferencesExpanded(false);



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











        const _mainContentScroll = document.querySelector('.main-content');
        const _mainAppRoot = document.querySelector('.main-app');
        if (_mainContentScroll && _mainAppRoot) {
            const THRESHOLD_ON  = 12;
            const THRESHOLD_OFF = 4;
            let _scrollDebounce = null;
            const updateScrolledClass = () => {
                const top = _mainContentScroll.scrollTop;
                const isScrolled = _mainAppRoot.classList.contains('is-scrolled');
                if (!isScrolled && top > THRESHOLD_ON) {
                    _mainAppRoot.classList.add('is-scrolled');
                } else if (isScrolled && top <= THRESHOLD_OFF) {
                    _mainAppRoot.classList.remove('is-scrolled');
                }
            };
            _mainContentScroll.addEventListener('scroll', () => {
                if (_scrollDebounce) return;
                _scrollDebounce = requestAnimationFrame(() => {
                    _scrollDebounce = null;
                    updateScrolledClass();
                });
            }, { passive: true });
            updateScrolledClass();
        }

        if (elements.confirmClear) elements.confirmClear.addEventListener('click', clearAllData);
        if (elements.cancelClear) elements.cancelClear.addEventListener('click', hideDialog);
        if (elements.confirmDialog) {
            elements.confirmDialog.addEventListener('click', (e) => {
                if (e.target === elements.confirmDialog) hideDialog();
            });
        }

        if (elements.addAnimeBtn) elements.addAnimeBtn.addEventListener('click', showAddAnimeDialog);


        const emptyStateAddBtn = document.getElementById('emptyStateAddBtn');
        if (emptyStateAddBtn) emptyStateAddBtn.addEventListener('click', showAddAnimeDialog);
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

                if (!elements.animeSlugInput.value.trim()) {
                    _addDialogDetectedTitle = null;
                    _addDialogKnownTotal = null;
                    _addDialogTotalCanon = null;
                    _addDialogCurrentSlug = null;
                    _publishDialogState();
                    _setSlugStatus('idle');
                    const fillerActionBar = document.getElementById('fillerActionBar');
                    if (fillerActionBar) fillerActionBar.style.display = 'none';
                    const slugMeta = document.getElementById('slugMeta');
                    if (slugMeta) {
            slugMeta.style.display = 'none';
            const slugCard = slugMeta.closest('.slug-card');
            if (slugCard) slugCard.dataset.hasMeta = 'false';
        }
                    const slugDetectedHint = document.getElementById('slugDetectedHint');
                    if (slugDetectedHint) slugDetectedHint.style.display = 'none';
                }
                if (elements.episodesWatchedInput && elements.episodesWatchedInput.value) {
                    updateEpisodesPreview(elements.episodesWatchedInput.value);
                }

                if (_addDialogSlugDebounce) clearTimeout(_addDialogSlugDebounce);
                _addDialogSlugDebounce = setTimeout(() => {
                    _addDialogSlugDebounce = null;
                    const raw = elements.animeSlugInput.value.trim();
                    if (raw) onSlugInputChange(raw).catch(() => {});
                }, 500);
            });
            elements.animeSlugInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') elements.episodesWatchedInput.focus();
            });
        }






        if (elements.addAnimeDialog) {
            elements.addAnimeDialog.addEventListener('click', (e) => {
                const chip = e.target.closest('.ep-chip');
                if (chip && elements.addAnimeDialog.contains(chip)) {
                    e.preventDefault();
                    const action = chip.dataset.action;
                    if (action === 'all' && _addDialogKnownTotal) {
                        elements.episodesWatchedInput.value = `1-${_addDialogKnownTotal}`;
                        const cb = document.getElementById('includeFillers');
                        if (cb) cb.checked = true;
                        updateEpisodesPreview(elements.episodesWatchedInput.value);
                        elements.episodesWatchedInput.focus();
                    } else if (action === 'canon' && _addDialogKnownTotal) {

                        const slug = _addDialogCurrentSlug;
                        const all = [];
                        for (let i = 1; i <= _addDialogKnownTotal; i++) all.push(i);
                        const { canon } = AT.EpisodeParse.splitCanonAndFillers(slug, all);
                        elements.episodesWatchedInput.value = AT.EpisodeParse.buildRangeString(canon);
                        const cb = document.getElementById('includeFillers');
                        if (cb) cb.checked = false;
                        updateEpisodesPreview(elements.episodesWatchedInput.value);
                        elements.episodesWatchedInput.focus();
                    } else if (action === 'skip-fillers') {
                        const raw = elements.episodesWatchedInput.value.trim();
                        if (!raw) return;
                        const slug = _addDialogCurrentSlug;
                        const all = parseEpisodeRanges(raw);
                        const { canon } = AT.EpisodeParse.splitCanonAndFillers(slug, all);
                        if (canon.length === all.length) return;
                        elements.episodesWatchedInput.value = AT.EpisodeParse.buildRangeString(canon);
                        const cb = document.getElementById('includeFillers');
                        if (cb) cb.checked = false;
                        updateEpisodesPreview(elements.episodesWatchedInput.value);
                    }
                    return;
                }





                const toggle = e.target.closest('.fab-filler-toggle');
                if (toggle && elements.addAnimeDialog.contains(toggle)) {
                    e.preventDefault();
                    const expanded = toggle.getAttribute('aria-expanded') === 'true';
                    toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');


                    let details = toggle._detailsEl;
                    if (!details) {
                        const id = toggle.getAttribute('aria-controls');
                        if (id) details = document.getElementById(id);
                    }
                    if (details) details.hidden = expanded;
                    const chevron = toggle.querySelector('.fab-chevron');
                    if (chevron) chevron.style.transform = expanded ? '' : 'rotate(180deg)';
                    return;
                }
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

            const slider = document.createElement('div');
            slider.className = 'category-tabs-slider';
            elements.categoryTabs.appendChild(slider);

            function moveSlider(activeTab, instant) {
                if (!activeTab) return;
                const containerRect = elements.categoryTabs.getBoundingClientRect();
                const tabRect = activeTab.getBoundingClientRect();
                if (!containerRect.width || !tabRect.width) return;



                const offsetX = tabRect.left - containerRect.left;
                slider.style.width = tabRect.width + 'px';
                slider.style.transform = `translateX(${offsetX}px)`;
                slider.classList.add('is-ready');
                elements.categoryTabs.classList.add('slider-ready');
                if (instant) {
                    slider.style.transition = 'none';
                    slider.offsetHeight;
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


            const initialActive = elements.categoryTabs.querySelector('.category-tab.active');
            requestAnimationFrame(() => moveSlider(initialActive, true));

            elements.categoryTabs.querySelectorAll('.category-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    const rawCat = tab.dataset.category;
                    const nextCategory = normalizeCategory(rawCat);
                    const categoryChanged = nextCategory !== currentCategory;

                    elements.categoryTabs.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');


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
            if (changes[AUTO_4K_SERVER_KEY]) {
                renderAuto4kServerSetting(changes[AUTO_4K_SERVER_KEY].newValue !== false);
            }
            if (changes.videoProgress) {
                videoProgress = changes.videoProgress.newValue || {};
                if (!isOwn) isExternalUpdate = true;

                if (typeof _ipPatch === 'function') _ipPatch(videoProgress);


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
                        suppressHoverUntilMouseMove();
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




            });
        }
    }

    async function init() {
        const { FirebaseSync, Storage, FillerFetchUI } = AT;




        try {
            const _popupAlivePort = chrome.runtime.connect({ name: 'popupAlive' });

            window.__popupAlivePort = _popupAlivePort;
        } catch (e) {
            PopupLogger.debug('Init', 'popupAlive port connect failed:', e?.message || e);
        }




        try {
            chrome.runtime.onMessage.addListener((msg) => {
                if (msg?.type !== 'AUTH_REJECTED') return;
                const status = Number(msg.status) || 0;
                if (status === 403) {
                    showToast({
                        title: 'Permission denied',
                        body: 'Cloud sync was refused by Firebase. If you recently changed accounts, sign out and back in. Otherwise this may be a Firestore rules issue.',
                        type: 'error',
                        duration: 9000
                    });
                } else if (status === 401) {
                    showToast({
                        title: 'Session expired',
                        body: 'Please sign in again to resume cloud sync. Your local data is safe.',
                        type: 'warn',
                        duration: 9000
                    });
                }
            });
        } catch {                                           }

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
            loadSkiptimeHelperSetting(),
            loadAuto4kServerSetting()
        ]);


        try {
            const { ProgressManager } = AT;

            const { lastCleanupDate } = await Storage.get(['lastCleanupDate']);
            const today = new Date().toISOString().slice(0, 10);
            if (lastCleanupDate === today) {
                PopupLogger.debug('Cleanup', 'Already ran today, skipping');
            } else {
                const raw = await Storage.get(['animeData', 'videoProgress', 'deletedAnime']);
                let dirty = false;


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











        try {
            const SlugMigration = window.AnimeTrackerSlugMigration;
            if (SlugMigration && typeof SlugMigration.migrate === 'function') {
                SlugMigration.migrate().then((result) => {
                    if (result && result.renamed > 0) {
                        PopupLogger.log('SlugMigration',
                            `Auto-recovered ${result.renamed} bad slug(s)`);
                    } else if (result && result.tried > 0) {
                        PopupLogger.debug('SlugMigration',
                            `Probed ${result.tried} suspect slug(s), none recoverable`);
                    }
                }).catch((e) => {
                    PopupLogger.debug('SlugMigration', 'failed:', e?.message || e);
                });
            }
        } catch (e) {
            PopupLogger.debug('SlugMigration', 'Unable to start:', e?.message || e);
        }

        FirebaseSync.init({
            onUserSignedIn: async (user) => {
                showMainApp(user);





                try {
                    const needs = await window.FirebaseLib?.isReauthNeeded?.();
                    if (needs) {
                        showToast({
                            title: 'Reconnect to sync',
                            body: 'We could not reach Firebase recently. Sign in again to resume cloud sync — your data is safe locally.',
                            type: 'warn',
                            duration: 9000
                        });
                    }
                } catch {                                         }




                try {
                    chrome.runtime.sendMessage({ type: 'GET_VERSION' }, () => { void chrome.runtime.lastError; });
                } catch {}
                await refreshPopupCloudData(true);
                startPopupCloudRefresh();



                const syncResult = AT.FirebaseSync.lastSyncResult || null;
                const providers = user.providers || [];
                PopupLogger.log('Sync',
                    `Sign-in diagnostic: source=${syncResult?.source || 'unknown'} ` +
                    `cloudDocFound=${syncResult?.cloudDocFound} ` +
                    `animeCount=${syncResult?.animeCount} ` +
                    `uid=${user.uid?.slice(0, 8)}… ` +
                    `providers=[${providers.join(', ')}] ` +
                    `signedInVia=${user.signedInVia || 'google'}`);






                try {
                    chrome.runtime.sendMessage({
                        type: 'START_LIBRARY_REPAIR',
                        forceInfoRefresh: false,
                        forceFillerRefresh: false
                    }, (response) => {
                        const err = chrome.runtime.lastError;
                        if (err) {
                            PopupLogger.warn('Login', 'Failed to start library repair via message:', err.message);
                        } else {
                            PopupLogger.log('Login', 'Library repair successfully triggered on sign-in');
                        }
                    });
                } catch (e) {
                    PopupLogger.error('Login', 'Failed to send START_LIBRARY_REPAIR message:', e);
                }
                try {
                    const SlugMigration = window.AnimeTrackerSlugMigration;
                    if (SlugMigration && typeof SlugMigration.migrate === 'function') {
                        SlugMigration.migrate({ force: true }).then((result) => {
                            if (result && result.renamed > 0) {
                                PopupLogger.log('SlugMigration', `Post-login recovered ${result.renamed} bad slug(s)`);
                            }
                        }).catch(() => {});
                    }
                } catch {}
                await maybePromptPostUpdateFetch();
            },
            onUserSignedOut: () => {
                stopPopupCloudRefresh();
                showAuthScreen();
            },
            onError: () => {
                showMainApp(null);
                loadData();


                maybePromptPostUpdateFetch().catch(() => {});
            }
        });
    }




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
