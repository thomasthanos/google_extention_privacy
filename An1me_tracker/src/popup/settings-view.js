/**
 * Anime Tracker β€” Settings View
 *
 * Full-popup settings panel that replaces the legacy dropdown.
 * Renders 5 cards: Account, Playback & Tracking, Library, Danger zone, About.
 *
 * Existing handler IDs are preserved on every button/input so the wiring in
 * `main.js` keeps working without changes:
 *   #settingsAvatar, #settingsUserName, #settingsUserEmail, #settingsSignOut,
 *   #settingsCopyGuard (+ subtitle), #settingsSmartNotif (+ subtitle),
 *   #settingsAutoSkipFiller (+ subtitle), #settingsSkiptime (+ subtitle), [NEW]
 *   #settingsRefresh, #settingsRefreshInfo, #settingsExportData,
 *   #settingsImportData, #settingsImportFile, #settingsFetchFillers,
 *   #settingsClear, #settingsExportToken, #settingsDonate.
 *
 * Render is idempotent β€” safe to call repeatedly when storage settings change.
 */
(function () {
    'use strict';

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }

    // β”€β”€β”€ SVG icon registry (24Γ—24, currentColor stroke) β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€
    // Mirrored from the legacy dropdown's inline SVGs so visual identity stays
    // identical. Kept inline (not referenced from a sprite) because the popup
    // CSP doesn't allow external icon hosts.
    const ICONS = {
        signOut:  '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
        heart:    '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
        refresh:  '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
        info:     '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/><path d="M8.5 3.5A9 9 0 0 1 21 12"/>',
        download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
        upload:   '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
        trash:    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
        key:      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
        copy:     '<rect x="9" y="11" width="10" height="10" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
        bell:     '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
        skipFwd:  '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
        skipMark: '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/>',
        sparkles: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/><circle cx="12" cy="12" r="4"/>'
    };

    function svg(iconKey, extraClass = '') {
        const paths = ICONS[iconKey];
        if (!paths) return '';
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round"
                     class="settings-icon ${extraClass}" aria-hidden="true" focusable="false">${paths}</svg>`;
    }

    // β”€β”€β”€ Card builders β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€

    function renderAccountCard(user) {
        const photo = user?.photoURL ? escapeHtml(user.photoURL) : 'src/icons/icon48.png';
        const name = escapeHtml(user?.displayName || user?.email?.split('@')[0] || 'User');
        const email = escapeHtml(user?.email || '');
        const signedIn = !!user;

        // Both the Sign-Out button and the "Local only" badge are always in
        // the DOM (just one is hidden) so partial updates can flip their
        // visibility without re-creating handlers.
        return `
            <section class="settings-card" data-signed-in="${signedIn}">
                <h2 class="settings-card-title">Account</h2>
                <div class="settings-account-row">
                    <img class="settings-account-avatar" id="settingsAvatar" src="${photo}" alt="${name}">
                    <div class="settings-account-info">
                        <span class="settings-account-name" id="settingsUserName">${name}</span>
                        <span class="settings-account-email" id="settingsUserEmail">${email}</span>
                    </div>
                    <button class="settings-btn settings-btn-secondary" id="settingsSignOut" type="button"
                            ${signedIn ? '' : 'hidden'}>
                        ${svg('signOut')}<span>Sign out</span>
                    </button>
                    <span class="settings-account-status" data-when="signed-out"
                          ${signedIn ? 'hidden' : ''}>Local only</span>
                </div>
            </section>
        `;
    }

    function renderToggleItem({ id, subtitleId, iconKey, title, subtitle, enabled }) {
        const en = !!enabled;
        return `
            <button class="settings-toggle-row" id="${id}" type="button"
                    data-enabled="${en}" aria-pressed="${en}">
                <span class="settings-toggle-icon">${svg(iconKey)}</span>
                <span class="settings-toggle-text">
                    <span class="settings-toggle-title">${escapeHtml(title)}</span>
                    <span class="settings-toggle-subtitle" id="${subtitleId}">${escapeHtml(subtitle)}</span>
                </span>
                <span class="settings-toggle-control" aria-hidden="true"></span>
            </button>
        `;
    }

    function renderPlaybackCard(state) {
        const items = [
            renderToggleItem({
                id: 'settingsCopyGuard', subtitleId: 'settingsCopyGuardSubtitle',
                iconKey: 'copy', title: 'Copy Guard',
                subtitle: state.copyGuard ? 'Block copy outside allowed text' : 'Copy protection is turned off',
                enabled: state.copyGuard
            }),
            renderToggleItem({
                id: 'settingsSmartNotif', subtitleId: 'settingsSmartNotifSubtitle',
                iconKey: 'bell', title: 'New Episode Alerts',
                subtitle: state.smartNotif ? 'You will be notified of new episodes' : 'Notify when new episodes drop',
                enabled: state.smartNotif
            }),
            renderToggleItem({
                id: 'settingsAutoSkipFiller', subtitleId: 'settingsAutoSkipFillerSubtitle',
                iconKey: 'skipFwd', title: 'Auto-Skip Fillers',
                subtitle: state.autoSkipFiller ? 'Filler episodes will be auto-skipped' : 'Skip filler, jump to next canon ep',
                enabled: state.autoSkipFiller
            }),
            renderToggleItem({
                id: 'settingsSkiptime', subtitleId: 'settingsSkiptimeSubtitle',
                iconKey: 'skipMark', title: 'Skiptime Contributor',
                subtitle: state.skiptimeHelper ? 'Capture intro/outro on an1me.to/watch' : 'Floating panel for intro/outro contributions',
                enabled: state.skiptimeHelper
            })
        ].join('');

        return `
            <section class="settings-card">
                <h2 class="settings-card-title">Playback &amp; Tracking</h2>
                <div class="settings-toggle-list">${items}</div>
            </section>
        `;
    }

    function renderLibraryCard() {
        return `
            <section class="settings-card">
                <h2 class="settings-card-title">Library</h2>
                <div class="settings-action-grid">
                    <button class="settings-action" id="settingsRefresh" type="button">
                        ${svg('refresh')}
                        <span class="settings-action-text">
                            <span class="settings-action-title">Refresh Data</span>
                            <span class="settings-action-subtitle">Sync with cloud</span>
                        </span>
                    </button>
                    <button class="settings-action" id="settingsRefreshInfo" type="button">
                        ${svg('info')}
                        <span class="settings-action-text">
                            <span class="settings-action-title">Refresh Anime Info</span>
                            <span class="settings-action-subtitle">Re-fetch episode counts &amp; status</span>
                        </span>
                    </button>
                    <button class="settings-action" id="settingsFetchFillers" type="button">
                        ${svg('sparkles')}
                        <span class="settings-action-text">
                            <span class="settings-action-title">Fetch &amp; Import All</span>
                            <span class="settings-action-subtitle">Fillers, counts, status &amp; missing info</span>
                        </span>
                    </button>
                    <button class="settings-action" id="settingsExportData" type="button">
                        ${svg('download')}
                        <span class="settings-action-text">
                            <span class="settings-action-title">Export Backup</span>
                            <span class="settings-action-subtitle">Download a JSON of your library</span>
                        </span>
                    </button>
                    <button class="settings-action" id="settingsImportData" type="button">
                        ${svg('upload')}
                        <span class="settings-action-text">
                            <span class="settings-action-title">Import Backup</span>
                            <span class="settings-action-subtitle">Restore from a previous JSON export</span>
                        </span>
                    </button>
                    <input type="file" id="settingsImportFile" accept="application/json,.json"
                           style="display:none" aria-hidden="true">
                </div>
            </section>
        `;
    }

    function renderDangerCard() {
        return `
            <section class="settings-card settings-card--danger">
                <h2 class="settings-card-title">Danger zone</h2>
                <div class="settings-action-grid">
                    <button class="settings-action settings-action--danger" id="settingsClear" type="button">
                        ${svg('trash')}
                        <span class="settings-action-text">
                            <span class="settings-action-title">Clear all data</span>
                            <span class="settings-action-subtitle">Delete all tracking data on this device</span>
                        </span>
                    </button>
                    <button class="settings-action" id="settingsExportToken" type="button">
                        ${svg('key')}
                        <span class="settings-action-text">
                            <span class="settings-action-title">Export Auth Token</span>
                            <span class="settings-action-subtitle">Transfer to Orion / Safari</span>
                        </span>
                    </button>
                </div>
            </section>
        `;
    }

    function renderAboutCard(version) {
        return `
            <section class="settings-card settings-card--compact settings-card--support">
                <div class="settings-about-row">
                    <div class="settings-about-copy">
                        <span class="settings-about-badge">${svg('heart')}<span>Support</span></span>
                        <span class="settings-about-title">Keep Anime Tracker evolving</span>
                        <span class="settings-about-note">If the extension helps your daily watching flow, you can support future updates here.</span>
                    </div>
                    <button class="settings-about-donate" id="settingsDonate" type="button">
                        ${svg('heart')}<span>Donate</span>
                    </button>
                </div>
            </section>
        `;
    }

    // β”€β”€β”€ Public API β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€

    function render(container, params = {}) {
        if (!container) return;
        container.removeAttribute('hidden');

        const {
            user = null,
            version = null,
            settings = {}
        } = params;

        const state = {
            copyGuard: settings.copyGuard !== false,           // default ON
            smartNotif: settings.smartNotif === true,          // default OFF
            autoSkipFiller: settings.autoSkipFiller === true,  // default OFF
            skiptimeHelper: settings.skiptimeHelper === true   // default OFF
        };

        // Full HTML render only on first call (or after a structural change).
        // Subsequent calls just update toggle state + Account card so already-
        // bound click handlers in main.js stay attached to the same DOM nodes.
        const alreadyRendered = container.querySelector('.settings-view-inner');
        if (!alreadyRendered) {
            container.innerHTML = `
                <div class="settings-view-inner">
                    ${renderAccountCard(user)}
                    ${renderPlaybackCard(state)}
                    ${renderLibraryCard()}
                    ${renderDangerCard()}
                    ${renderAboutCard(version)}
                </div>
            `;
            return;
        }

        // Partial update: refresh ONLY mutable Account fields without
        // replacing nodes. The Sign-Out button keeps its identity so any
        // pre-bound click handler in main.js continues to fire. If the
        // signed-in/signed-out STATE itself changes (e.g. button needs to
        // appear/disappear) the caller should pass `forceRerender: true`
        // (handled below) to trigger a full re-render.
        const avatar = container.querySelector('#settingsAvatar');
        const nameEl = container.querySelector('#settingsUserName');
        const emailEl = container.querySelector('#settingsUserEmail');
        const signOutBtn = container.querySelector('#settingsSignOut');
        const localOnlyBadge = container.querySelector('[data-when="signed-out"]');
        const accountCard = container.querySelector('.settings-card[data-signed-in]');
        if (avatar)  avatar.src = user?.photoURL || 'src/icons/icon48.png';
        if (nameEl)  nameEl.textContent = user?.displayName || user?.email?.split('@')[0] || 'User';
        if (emailEl) emailEl.textContent = user?.email || '';
        if (signOutBtn) {
            if (user) signOutBtn.removeAttribute('hidden');
            else signOutBtn.setAttribute('hidden', '');
        }
        if (localOnlyBadge) {
            if (user) localOnlyBadge.setAttribute('hidden', '');
            else localOnlyBadge.removeAttribute('hidden');
        }
        if (accountCard) accountCard.dataset.signedIn = user ? 'true' : 'false';
        updateToggle('settingsCopyGuard', state.copyGuard,
            state.copyGuard ? 'Block copy outside allowed text' : 'Copy protection is turned off');
        updateToggle('settingsSmartNotif', state.smartNotif,
            state.smartNotif ? 'You will be notified of new episodes' : 'Notify when new episodes drop');
        updateToggle('settingsAutoSkipFiller', state.autoSkipFiller,
            state.autoSkipFiller ? 'Filler episodes will be auto-skipped' : 'Skip filler, jump to next canon ep');
        updateToggle('settingsSkiptime', state.skiptimeHelper,
            state.skiptimeHelper ? 'Capture intro/outro on an1me.to/watch' : 'Floating panel for intro/outro contributions');

        // Update version label without touching donate button (still bound).
        const versionLabel = container.querySelector('.settings-about-version');
        if (versionLabel) versionLabel.textContent = `Anime Tracker v${escapeHtml(version || '-')}`;
    }

    // Lazy-create a hidden aria-live region so screen readers announce toggle
    // state changes. Without this, sighted users get the visual cue but
    // keyboard / SR users get silent toggling — confusing if the change
    // actually went through.
    function _ensureSettingsLiveRegion() {
        let live = document.getElementById('settingsLiveRegion');
        if (live) return live;
        live = document.createElement('div');
        live.id = 'settingsLiveRegion';
        live.setAttribute('role', 'status');
        live.setAttribute('aria-live', 'polite');
        live.setAttribute('aria-atomic', 'true');
        live.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';
        document.body.appendChild(live);
        return live;
    }

    /**
     * Live-update a single toggle row without re-rendering the whole view.
     * Called from main.js when chrome.storage changes.
     */
    function updateToggle(id, enabled, subtitle) {
        const btn = document.getElementById(id);
        if (!btn) return;
        const prev = btn.getAttribute('aria-pressed') === 'true';
        const en = !!enabled;
        btn.dataset.enabled = en ? 'true' : 'false';
        btn.setAttribute('aria-pressed', en ? 'true' : 'false');
        if (subtitle) {
            const subtitleId = btn.querySelector('.settings-toggle-subtitle')?.id;
            if (subtitleId) {
                const subEl = document.getElementById(subtitleId);
                if (subEl) subEl.textContent = subtitle;
            }
        }
        // Announce only when state actually flipped (skip silent no-op updates
        // and the initial render).
        if (prev !== en) {
            const titleEl = btn.querySelector('.settings-toggle-title');
            const titleText = titleEl?.textContent?.trim() || 'Setting';
            const live = _ensureSettingsLiveRegion();
            // Force re-announce by clearing first — some SRs ignore identical
            // sequential text in the same live region.
            live.textContent = '';
            requestAnimationFrame(() => {
                live.textContent = `${titleText} ${en ? 'enabled' : 'disabled'}`;
            });
        }
    }

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.SettingsView = { render, updateToggle };

    // β”€β”€β”€ Initial render at script-parse time β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€β”€
    // Rendered NOW (not on view-mode click) so all IDs (#settingsCopyGuard,
    // #settingsRefresh, etc.) exist in the DOM by the time main.js's IIFE
    // caches them in its `elements` object. main.js then re-calls render()
    // later with the actual user/settings to refresh the visible content.
    const initialContainer = document.getElementById('settingsView');
    if (initialContainer) {
        render(initialContainer, { user: null, version: null, settings: {} });
        // Keep it hidden until view-mode='settings' switches to it. The CSS
        // rule `.app.settings-mode #settingsView` handles the show.
        initialContainer.setAttribute('hidden', '');
    }
})();
