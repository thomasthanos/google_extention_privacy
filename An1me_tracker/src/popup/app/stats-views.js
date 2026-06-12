(function () {
    'use strict';

    // Stats bar, goals/badges state, and view switching (stats/goals/settings views).
    // Extracted from popup/main.js. State via AT.PopupState; callbacks via _init.
    const AT = window.AnimeTracker;

    let elements, detectHasGoogleAuth, setTopStatValue;
    let lastBadgeSnapshot = [];

    // storage keys (shared string constants — kept in sync with main.js)
    const GOAL_SETTINGS_KEY = 'goalSettings';
    const BADGE_STATE_KEY = 'badgeUnlocks';
    const COPY_GUARD_STORAGE_KEY = 'copyGuardEnabled';
    const SMART_NOTIF_STORAGE_KEY = 'smartNotificationsEnabled';
    const AUTO_SKIP_FILLER_STORAGE_KEY = 'autoSkipFillers';
    const SKIPTIME_HELPER_KEY = 'skiptimeHelperEnabled';
    const PASSWORD_SET_MARKER_KEY = 'passwordSetMarker';

    async function updateStats() {
        const { UIHelpers, SeasonGrouping, Storage } = AT;
        const animeEntries = Object.entries(AT.PopupState.animeData);
        const groups = SeasonGrouping.groupByBase(animeEntries);
        const totalAnimeCount = groups.size;
        setTopStatValue(elements.totalAnime, totalAnimeCount);
        const totalMoviesCount = animeEntries.filter(([slug, anime]) => SeasonGrouping.isMovie(slug, anime)).length;
        if (elements.totalMovies) setTopStatValue(elements.totalMovies, totalMoviesCount);

        let totalWatchedEpisodes = 0;
        let totalWatchTime = 0;
        for (const [, anime] of animeEntries) {
            const uniqueEpisodeNumbers = new Set(
                (anime.episodes || [])
                    .filter(ep => ep?.durationSource !== 'anilist')
                    .map(ep => Number(ep?.number))
                    .filter(n => Number.isFinite(n) && n > 0)
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
            AT.PopupState.goalSettings = {
                daily:   { ...defaults.daily,   ...(stored.daily   || {}) },
                weekly:  { ...defaults.weekly,  ...(stored.weekly  || {}) },
                monthly: { ...defaults.monthly, ...(stored.monthly || {}) }
            };
            AT.PopupState.badgeState = result[BADGE_STATE_KEY] || {};
        } catch (e) {
            PopupLogger.warn('Goals', 'Failed to load goal/badge state:', e);
            AT.PopupState.goalSettings = null;
            AT.PopupState.badgeState = {};
        }
    }

    async function persistBadgeUnlocks(newlyUnlocked) {
        if (!Array.isArray(newlyUnlocked) || newlyUnlocked.length === 0) return;
        const nowIso = new Date().toISOString();
        const previousState = AT.PopupState.badgeState || {};
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

        AT.PopupState.badgeState = next;
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
                        desc: badge.desc
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

        AT.PopupState.currentViewMode = mode || null;

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
                window.AnimeTracker?.StatsView?.render(statsView, AT.PopupState.animeData);
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
        let needsReauth = false;
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
            needsReauth = await window.FirebaseLib?.isReauthNeeded?.() || false;
        } catch (e) {
            PopupLogger.warn('Settings', 'Failed to load toggle state for view:', e);
        }

        SettingsView.render(container, {
            user,
            settings: storedSettings,
            passwordIsSet,
            isMobile: !detectHasGoogleAuth(),
            needsReauth
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
            const index = StatsEngine.buildWatchIndex(AT.PopupState.animeData);
            const hourIndex = AchievementsEngine.buildHourIndex(AT.PopupState.animeData);
            GoalsView.render(container, {
                animeData: AT.PopupState.animeData,
                index,
                hourIndex,
                goalSettings: AT.PopupState.goalSettings,
                badgeState: AT.PopupState.badgeState,
                onGoalsChanged: (next) => { AT.PopupState.goalSettings = next; }
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

    AT.StatsViews = {
        _init(d) {
            elements = d.elements;
            detectHasGoogleAuth = d.detectHasGoogleAuth;
            setTopStatValue = d.setTopStatValue;
        },
        updateStats, loadGoalAndBadgeState, persistBadgeUnlocks, setViewMode, renderSettingsView, renderGoalsView
    };
})();
