

// ── Donate dropdown UI (merged from app/donate-dropdown.js) ──
(function () {
    'use strict';

    // Donate dropdown UI — extracted from popup/main.js.
    // Self-contained: only touches its own DOM nodes (no popup state).
    const AT = (window.AnimeTracker = window.AnimeTracker || {});

    function getSettingsDonateButton() {
        return document.getElementById('settingsDonate');
    }

    function closeDonateDropdown() {
        const donateDropdown = document.getElementById('donateDropdown');
        if (!donateDropdown) return;
        donateDropdown.classList.remove('visible');
        delete donateDropdown.dataset.placement;
    }

    function positionDonateDropdown() {
        const dropdown = document.getElementById('donateDropdown');
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
        const donateDropdown = document.getElementById('donateDropdown');
        if (!donateDropdown || !getSettingsDonateButton()) return;
        positionDonateDropdown();
        donateDropdown.classList.add('visible');
        requestAnimationFrame(positionDonateDropdown);
    }

    AT.DonateDropdown = {
        open: openDonateDropdown,
        close: closeDonateDropdown,
        position: positionDonateDropdown,
        getButton: getSettingsDonateButton
    };
})();

// ── Library backup/export (merged from lib/library-backup.js) ──
(function () {
    'use strict';

    const BACKUP_FORMAT_VERSION = 1;

    function buildPayload(snapshot) {
        const version = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || null;
        return {
            version: BACKUP_FORMAT_VERSION,
            exportedAt: new Date().toISOString(),
            extensionVersion: version,
            animeData: snapshot?.animeData || {},
            videoProgress: snapshot?.videoProgress || {},
            deletedAnime: snapshot?.deletedAnime || {},
            groupCoverImages: snapshot?.groupCoverImages || {},
            goalSettings: snapshot?.goalSettings || null,
            badgeUnlocks: snapshot?.badgeUnlocks || {}
        };
    }

    function triggerDownload(payload, filenameOverride = null) {
        const json = JSON.stringify(payload, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/T.*/, '');
        const filename = filenameOverride || `an1me-tracker-backup-${stamp}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();

        setTimeout(() => { try { URL.revokeObjectURL(url); } catch {              } }, 1500);
    }

    function parseAndValidate(text) {
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new Error('Invalid JSON file');
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Backup file is malformed');
        }

        if (!parsed.animeData || typeof parsed.animeData !== 'object') {
            throw new Error('Backup is missing animeData');
        }
        return parsed;
    }


    function mergeImported(local, parsed) {
        const Merge = globalThis.AnimeTrackerMergeUtils;
        if (!Merge?.mergeAnimeData) throw new Error('Merge utils unavailable');
        const AT = (typeof window !== 'undefined' && window.AnimeTracker) || {};
        const ProgressManager = AT.ProgressManager;

        let mergedAnime = Merge.mergeAnimeData(local?.animeData || {}, parsed?.animeData || {});
        let mergedDeleted = Merge.mergeDeletedAnime(local?.deletedAnime || {}, parsed?.deletedAnime || {});
        mergedDeleted = Merge.pruneStaleDeletedAnime(mergedAnime, mergedDeleted);
        Merge.applyDeletedAnime(mergedAnime, mergedDeleted);

        const mergedProgress = Merge.mergeVideoProgress(local?.videoProgress || {}, parsed?.videoProgress || {});
        const mergedGroup = Merge.mergeGroupCoverImages(local?.groupCoverImages || {}, parsed?.groupCoverImages || {});
        const mergedGoals = Merge.mergeGoalSettings
            ? Merge.mergeGoalSettings(local?.goalSettings || null, parsed?.goalSettings || null)
            : (parsed?.goalSettings || local?.goalSettings || null);
        const mergedBadges = Merge.mergeBadgeUnlocks
            ? Merge.mergeBadgeUnlocks(local?.badgeUnlocks || {}, parsed?.badgeUnlocks || {})
            : { ...(local?.badgeUnlocks || {}), ...(parsed?.badgeUnlocks || {}) };


        if (ProgressManager?.removeDuplicateEpisodes) {
            mergedAnime = ProgressManager.removeDuplicateEpisodes(mergedAnime);
        }

        return {
            animeData: mergedAnime,
            videoProgress: mergedProgress,
            deletedAnime: mergedDeleted,
            groupCoverImages: mergedGroup,
            goalSettings: mergedGoals,
            badgeUnlocks: mergedBadges
        };
    }

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.LibraryBackup = {
        buildPayload,
        triggerDownload,
        parseAndValidate,
        mergeImported
    };
})();

(function () {
    'use strict';

    const AT = window.AnimeTracker;

    // Donate dropdown UI is defined at the top of this file (merged in from app/donate-dropdown.js)
    const {
        open: openDonateDropdown,
        close: closeDonateDropdown,
        position: positionDonateDropdown,
        getButton: getSettingsDonateButton
    } = AT.DonateDropdown;

    // Toasts live in src/popup/app/toasts.js
    const { showToast, showAuthToast } = AT;

    // Auth UI lives in src/popup/app/auth-ui.js
    const { signInWithGoogle, handleEmailAuth, handleForgotPassword } = AT.AuthUI;

    // Add/edit-anime dialogs live in src/popup/app/add-anime-dialog.js
    const {
        showAddAnimeDialog, onSlugInputChange, hideAddAnimeDialog,
        addAnimeWithEpisodes, hideEditTitleDialog, saveEditedTitle,
        editAnimeTitle, fetchFillerForAnime
    } = AT.AddAnimeDialog;

    // Anime actions live in src/popup/app/anime-actions.js
    const {
        deleteProgress, deleteAnime, toggleAnimeCompleted, toggleAnimeDropped,
        toggleAnimeFavorite, toggleAnimeOnHold, clearAllData
    } = AT.AnimeActions;

    // Render pipeline lives in src/popup/app/render-list.js
    const { renderAnimeList } = AT.RenderList;

    // Metadata-repair lives in src/popup/app/metadata-repair.js
    const {
        setMetadataRepairStatus, scheduleDefaultSyncStatusRestore, applyAnimeInfoCacheChange, applyEpisodeTypesCacheChange, applyMetadataRepairState, syncMetadataRepairStateFromStorage, maybePromptPostUpdateFetch, fetchAllFillers
    } = AT.MetadataRepair;

    // Stats / goals / views live in src/popup/app/stats-views.js
    const {
        updateStats, loadGoalAndBadgeState, setViewMode, renderSettingsView, renderGoalsView
    } = AT.StatsViews;

    let animeData = {};
    let videoProgress = {};
    let currentSort = 'date';
    let currentCategory = 'all';
    let currentCompactStatus = 'airing';
    let currentCompactStatusOpen = false;
    let goalSettings = null;
    let badgeState = {};
    let currentViewMode = null;

    // ─── Shared popup state ───────────────────────────────────────────────
    // Accessors bound to this IIFE's closure variables so extracted modules
    // (popup/lib/*) read & write the SAME state — single source of truth here.
    // (Dialog-state getters reference vars declared lower down; only invoked at
    //  runtime, so no TDZ issue.)
    AT.PopupState = {
        get animeData() { return animeData; },
        set animeData(v) { animeData = v; },
        get videoProgress() { return videoProgress; },
        set videoProgress(v) { videoProgress = v; },
        get addDialogDetectedTitle() { return _addDialogDetectedTitle; },
        set addDialogDetectedTitle(v) { _addDialogDetectedTitle = v; },
        get addDialogKnownTotal() { return _addDialogKnownTotal; },
        set addDialogKnownTotal(v) { _addDialogKnownTotal = v; },
        get addDialogTotalCanon() { return _addDialogTotalCanon; },
        set addDialogTotalCanon(v) { _addDialogTotalCanon = v; },
        get addDialogCurrentSlug() { return _addDialogCurrentSlug; },
        set addDialogCurrentSlug(v) { _addDialogCurrentSlug = v; },
        get currentCategory() { return currentCategory; },
        set currentCategory(v) { currentCategory = v; },
        get currentSort() { return currentSort; },
        set currentSort(v) { currentSort = v; },
        get currentCompactStatus() { return currentCompactStatus; },
        set currentCompactStatus(v) { currentCompactStatus = v; },
        get currentCompactStatusOpen() { return currentCompactStatusOpen; },
        set currentCompactStatusOpen(v) { currentCompactStatusOpen = v; },
        get badgeState() { return badgeState; },
        set badgeState(v) { badgeState = v; },
        get goalSettings() { return goalSettings; },
        set goalSettings(v) { goalSettings = v; },
        get lastRenderedListMarkup() { return _lastRenderedListMarkup; },
        set lastRenderedListMarkup(v) { _lastRenderedListMarkup = v; },
        get lastMetadataRepairState() { return lastMetadataRepairState; },
        set lastMetadataRepairState(v) { lastMetadataRepairState = v; },
        get currentViewMode() { return currentViewMode; },
        set currentViewMode(v) { currentViewMode = v; }
    };

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

    AT.AddAnimeDialog._init({ elements, markInternalSave, renderAnimeList, updateStats });
    AT.AnimeActions._init({ elements, hideDialog, markInternalSave, renderAnimeList, updateStats });
    AT.RenderList._init({ elements, _ipPatch, getActiveFilter, markInternalSave, normalizeCompactStatus, suppressHoverUntilMouseMove, updateStats });
    AT.MetadataRepair._init({ elements, detectHasGoogleAuth, markInternalSave, scheduleDeferredListRefresh, sendRuntimeMessage, updateStats });
    AT.StatsViews._init({ elements, detectHasGoogleAuth, setTopStatValue });
    let loadAndSyncInProgress = false;
    let lastMetadataRepairState = null;

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

    const POPUP_CLOUD_REFRESH_MS = 30 * 1000;
    let popupCloudRefreshTimer = null;

    // ─── Donate dropdown → defined at top of this file (was app/donate-dropdown.js) ───
    // (aliased near the top as AT.DonateDropdown)

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
        // Covers are reused across the re-render (see render-list.js), so the
        // switch no longer flickers — render synchronously for an instant,
        // jank-free category change instead of the old blur/fade masking pass.
        renderAnimeList(filter);
    }

    function normalizeCompactStatus(value) {
        const allowed = new Set(['airing', 'on_hold', 'completed', 'dropped']);
        return allowed.has(value) ? value : 'airing';
    }

    const {
        repairAiringCompleted: repairAiringCompletedEntries,
        persistDetectedCompletions
    } = AT.StatusService;

    const { normalizeMovieDurations, cleanupPhantomMovies, scrubAnilistImportDates } = AT.Maintenance;

    function showAuthScreen() {
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
        // Always offer email/password: it's the only method that works on mobile
        // browsers where Google sign-in can't complete, and a universal fallback if
        // the Google capability check misfires. The Google button stays gated on
        // hasGoogleAuth; the OR divider only shows when both methods are present.
        if (emailForm) emailForm.style.display = '';
        if (orDivider) orDivider.style.display = hasGoogleAuth ? '' : 'none';
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

    // Render pipeline → src/popup/app/render-list.js

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

    // Stats / goals / views → src/popup/app/stats-views.js

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
        // Only surface the sync indicator once we're actually fetching something — a
        // no-op refresh (nothing due per the cache TTLs) stays silent, so opening the
        // popup no longer looks like it's "updating" when nothing has changed.
        let started = false;
        service.autoFetchMissing(animeData, () => {
            if (extraCallback) extraCallback();
        }, (done, total, title) => {
            if (!started) { started = true; startAutoSync(); }
            setMetadataRepairStatus(`${done}/${total} — ${_truncTitle(title, 18)}`);
        }).then(() => {
            if (started) endAutoSync();
        }).catch(() => {
            if (started) endAutoSync();
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

    // Count of anime that still need a filler-type or AniList-info fetch (union).
    // Lets a manual "Fetch Fillers" skip the full-screen modal when there's
    // little or nothing to do.
    function countPendingFetch(slugs) {
        const { FillerService, AnilistService } = AT;
        let count = 0;
        for (const slug of slugs) {
            const fillerMissing = !FillerService.isLikelyMovie(slug) && !FillerService.episodeTypesCache[slug];
            const c = AnilistService.cache?.[slug];
            // Only count genuinely-uncached anime (these get fetched immediately).
            // `retryable` entries are skipped — they're retried on their own TTL, so
            // they shouldn't make the button claim there's work to do.
            const anilistMissing = !c;
            if (fillerMissing || anilistMissing) count++;
        }
        return count;
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
        try {
            chrome.runtime.sendMessage({ type: 'WAKE_AND_POLL_CLOUD' });
        } catch (e) {
            PopupLogger.debug('Sync', 'Failed to dispatch bg cloud poll request:', e);
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

    // Anime actions (delete/toggle/clear) → src/popup/app/anime-actions.js

    const {
        open: openDialogA11y,
        close: closeDialogA11y,
        inlineConfirm: showInlineConfirm
    } = AT.Dialogs;

    function showDialog() { openDialogA11y(elements.confirmDialog); }
    function hideDialog() { closeDialogA11y(elements.confirmDialog); }

    // Add/edit-anime dialogs → src/popup/app/add-anime-dialog.js

    let _addDialogDetectedTitle = null;
    let _addDialogKnownTotal = null;
    let _addDialogTotalCanon = null;
    let _addDialogSlugDebounce = null;
    let _addDialogCurrentSlug = null;

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.__addDialogState = { knownTotal: null };

    const {
        parseRanges: parseEpisodeRanges,
        splitCanonAndFillers,
        renderEpisodesPreview: updateEpisodesPreview
    } = AT.EpisodeParse;

    // Metadata-repair → src/popup/app/metadata-repair.js

    // Auth UI (Google/email sign-in, forgot-password) → src/popup/app/auth-ui.js

    // Set-password modal lives in src/popup/app/set-password-modal.js (AT.openSetPasswordModal)
    AT.refreshSettingsViewIfOpen = () => { if (currentViewMode === 'settings') renderSettingsView(); };

    // Toasts (showToast / showAuthToast) live in src/popup/app/toasts.js

    async function signOut(preserveLocalData = true) {
        const { Storage, FirebaseSync } = AT;
        if (!preserveLocalData) {
            animeData = {};
            videoProgress = {};
            await Storage.set({ animeData: {}, videoProgress: {} });
        }
        lastMetadataRepairState = null;
        await chrome.storage.local.set({ pendingBackgroundMetadataRepair: false, metadataRepairState: null });
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

            if (e.target.closest('#settingsReauthBtn')) {
                setSettingsDataToolsExpanded(false);
                setSettingsPreferencesExpanded(false);
                signOut(true);
                return;
            }

            if (e.target.closest('#settingsSetPassword')) {
                setSettingsDataToolsExpanded(false);
                setSettingsPreferencesExpanded(false);
                AT.openSetPasswordModal();
                return;
            }

            if (e.target.closest('#settingsFetchFillers')) {
                setSettingsDataToolsExpanded(false);
                setSettingsPreferencesExpanded(false);

                // Route by how many anime actually need a fetch: nothing → a quiet
                // "No new updates"; a few → inline status in #syncStatus; many →
                // the full import modal.
                const SMALL_FETCH_MAX = 6;
                const pendingSlugs = Object.keys(animeData);
                const pendingCount = countPendingFetch(pendingSlugs);

                if (pendingCount === 0) {
                    setMetadataRepairStatus('No new updates', true);
                    scheduleDefaultSyncStatusRestore();
                } else if (pendingCount <= SMALL_FETCH_MAX) {
                    setMetadataRepairStatus(`Checking updates for ${pendingCount} anime…`);
                    const { allFillersCached, allAnilistCached } = checkAllCached(pendingSlugs);
                    if (!allFillersCached) runAutoFetch(AT.FillerService, animeData, () => scheduleDeferredListRefresh());
                    if (!allAnilistCached) runAutoFetch(AT.AnilistService, animeData, () => scheduleDeferredListRefresh());
                } else {
                    await fetchAllFillers({
                        autoStart: true,
                        forceInfoRefresh: false,
                        forceFillerRefresh: false
                    });
                }
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
                const isLoggedIn = !!AT?.FirebaseSync?.getUser?.();
                void applyMetadataRepairState(changes.metadataRepairState.newValue || null, { autoOpenRunning: isLoggedIn });
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
                            body: 'We could not reach Firebase recently. Click here to reconnect to sync.',
                            type: 'warn',
                            duration: 9000,
                            onClick: () => signOut(true)
                        });
                    }
                } catch {                                         }

                try {
                    chrome.runtime.sendMessage({ type: 'GET_VERSION' }, () => { void chrome.runtime.lastError; });
                } catch {}
                await refreshPopupCloudData(true);
                startPopupCloudRefresh();
                try {
                    chrome.runtime.sendMessage({ type: 'WAKE_AND_POLL_CLOUD_FORCE' });
                } catch (e) {
                    PopupLogger.error('Login', 'Failed to trigger cloud poll:', e);
                }

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
                        forceFillerRefresh: false,
                        isMobile: !detectHasGoogleAuth()
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
