/**
 * Anime Tracker — Settings View
 *
 * Compact full-popup settings panel.
 *
 * Layout:
 *   • Header bar — page title + compact account pill (avatar + name + sign-out icon).
 *   • PREFERENCES label + single card with 4 toggle rows (internal dividers).
 *   • CONNECTIONS label — anilist-api.js auto-injects its card under here.
 *   • DATA label — top row (Fetch & Import + Refresh / Sync) + Backup card.
 *   • Danger zone card (Clear, Set password on desktop only).
 *   • About card (donate).
 *
 * All existing handler IDs are preserved so main.js wiring works unchanged:
 *   #settingsAvatar, #settingsUserName, #settingsUserEmail, #settingsSignOut,
 *   #settingsCopyGuard (+ subtitle), #settingsSmartNotif (+ subtitle),
 *   #settingsAutoSkipFiller (+ subtitle), #settingsSkiptime (+ subtitle),
 *   #settingsRefresh, #settingsExportData, #settingsImportData,
 *   #settingsImportFile, #settingsFetchFillers, #settingsClear,
 *   #settingsSetPassword, #settingsDonate.
 *
 * Render is idempotent — safe to call repeatedly when storage settings change.
 */
(function () {
    'use strict';

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }

    // ─── SVG icon registry ───────────────────────────────────────────
    const ICONS = {
        signOut:  '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
        heart:    '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
        refresh:  '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
        download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
        upload:   '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
        trash:    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
        key:      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
        copy:     '<rect x="9" y="11" width="10" height="10" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
        bell:     '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
        skipFwd:  '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
        skipMark: '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/>',
        sparkles: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/><circle cx="12" cy="12" r="4"/>',
        check:    '<polyline points="20 6 9 17 4 12"/>'
    };

    function svg(iconKey, extraClass = '') {
        const paths = ICONS[iconKey];
        if (!paths) return '';
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round"
                     class="settings-icon ${extraClass}" aria-hidden="true" focusable="false">${paths}</svg>`;
    }

    // ─── Header pill ─────────────────────────────────────────────────

    function renderHeader(user) {
        const photo = user?.photoURL ? escapeHtml(user.photoURL) : 'src/icons/icon48.png';
        const name = escapeHtml(user?.displayName || user?.email?.split('@')[0] || 'User');
        const email = escapeHtml(user?.email || '');
        const signedIn = !!user;

        // Sign-out icon button is part of the pill on the right; sized as a
        // tap target but visually subtle. Local-only badge replaces the pill
        // when the user isn't signed in.
        return `
            <header class="settings-header" data-signed-in="${signedIn}">
                <div class="settings-account-pill" ${signedIn ? '' : 'hidden'}
                     title="${email}" data-tooltip="${email}">
                    <img class="settings-pill-avatar" id="settingsAvatar" src="${photo}" alt="">
                    <span class="settings-pill-name" id="settingsUserName">${name}</span>
                    <span class="settings-pill-email" id="settingsUserEmail" hidden>${email}</span>
                    <button class="settings-pill-signout" id="settingsSignOut" type="button"
                            aria-label="Sign out" title="Sign out">
                        ${svg('signOut')}
                    </button>
                </div>
                <span class="settings-account-status" data-when="signed-out"
                      ${signedIn ? 'hidden' : ''}>Local only</span>
            </header>
        `;
    }

    // ─── Section label helper ────────────────────────────────────────

    function sectionLabel(text) {
        return `<div class="settings-section-label">${escapeHtml(text)}</div>`;
    }

    // ─── Preferences (4 toggles in ONE card with internal dividers) ──

    function renderToggleItem({ id, subtitleId, iconKey, title, subtitle, enabled }) {
        const en = !!enabled;
        return `
            <button class="settings-toggle-row" id="${id}" type="button"
                    data-enabled="${en}" aria-pressed="${en}">
                <span class="settings-toggle-icon-wrap">${svg(iconKey, 'settings-toggle-icon-svg')}</span>
                <span class="settings-toggle-text">
                    <span class="settings-toggle-title">${escapeHtml(title)}</span>
                    <span class="settings-toggle-subtitle" id="${subtitleId}">${escapeHtml(subtitle)}</span>
                </span>
                <span class="settings-toggle-control" aria-hidden="true"></span>
            </button>
        `;
    }

    function renderPreferencesSection(state) {
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
            ${sectionLabel('PREFERENCES')}
            <section class="settings-card">
                <div class="settings-toggle-list">${items}</div>
            </section>
        `;
    }

    // ─── Connections (label only — anilist-api.js injects its card) ──

    function renderConnectionsSection() {
        return `${sectionLabel('CONNECTIONS')}`;
    }

    // ─── Data section: top row + Backup card ─────────────────────────

    function renderDataSection() {
        return `
            ${sectionLabel('DATA')}
            <div class="settings-data-top">
                <button class="settings-data-action settings-data-action--primary" id="settingsFetchFillers" type="button">
                    ${svg('sparkles')}
                    <span class="settings-data-action-text">
                        <span class="settings-data-action-title">Fetch &amp; Import</span>
                        <span class="settings-data-action-subtitle">Fillers, counts &amp; info</span>
                    </span>
                </button>
                <button class="settings-data-action" id="settingsRefresh" type="button">
                    ${svg('refresh')}
                    <span class="settings-data-action-text">
                        <span class="settings-data-action-title">Refresh / Sync</span>
                        <span class="settings-data-action-subtitle">Sync with cloud</span>
                    </span>
                </button>
            </div>
            <section class="settings-card settings-backup-card">
                <div class="settings-backup-head">
                    <span class="settings-backup-title">Backup</span>
                    <span class="settings-backup-sub">Keep a local copy of your library</span>
                </div>
                <div class="settings-backup-actions">
                    <button class="settings-btn-outline" id="settingsExportData" type="button">
                        ${svg('download')}<span>Export JSON</span>
                    </button>
                    <button class="settings-btn-outline" id="settingsImportData" type="button">
                        ${svg('upload')}<span>Import JSON</span>
                    </button>
                </div>
                <input type="file" id="settingsImportFile" accept="application/json,.json"
                       style="display:none" aria-hidden="true">
            </section>
        `;
    }

    // ─── Danger zone ─────────────────────────────────────────────────

    function renderDangerCard(user, passwordIsSet, isMobile) {
        const setPasswordBtn = (!user || isMobile) ? '' : (passwordIsSet ? `
                    <button class="settings-action settings-action--set" id="settingsSetPassword" type="button">
                        ${svg('check')}
                        <span class="settings-action-text">
                            <span class="settings-action-title">Password set</span>
                            <span class="settings-action-subtitle">Tap to update — same email, new password</span>
                        </span>
                    </button>` : `
                    <button class="settings-action" id="settingsSetPassword" type="button">
                        ${svg('key')}
                        <span class="settings-action-text">
                            <span class="settings-action-title">Set password for mobile</span>
                            <span class="settings-action-subtitle">Sign in on Orion / Safari with email + password</span>
                        </span>
                    </button>`);
        return `
            <section class="settings-card settings-card--danger">
                <div class="settings-action-grid">
                    <button class="settings-action settings-action--danger" id="settingsClear" type="button">
                        ${svg('trash')}
                        <span class="settings-action-text">
                            <span class="settings-action-title">Clear all data</span>
                            <span class="settings-action-subtitle">Delete all tracking data on this device</span>
                        </span>
                    </button>${setPasswordBtn}
                </div>
            </section>
        `;
    }

    // ─── About ───────────────────────────────────────────────────────

    function renderAboutCard() {
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

    // ─── Public API ──────────────────────────────────────────────────

    function render(container, params = {}) {
        if (!container) return;
        container.removeAttribute('hidden');

        const {
            user = null,
            settings = {},
            passwordIsSet = false,
            isMobile = false
        } = params;

        const state = {
            copyGuard: settings.copyGuard !== false,
            smartNotif: settings.smartNotif === true,
            autoSkipFiller: settings.autoSkipFiller === true,
            skiptimeHelper: settings.skiptimeHelper === true
        };

        // Full HTML render only on first call. Subsequent calls just patch the
        // mutable account pill + toggle states so click handlers attached in
        // main.js stay bound to the same DOM nodes.
        const alreadyRendered = container.querySelector('.settings-view-inner');
        if (!alreadyRendered) {
            container.innerHTML = `
                <div class="settings-view-inner">
                    ${renderHeader(user)}
                    ${renderPreferencesSection(state)}
                    ${renderConnectionsSection()}
                    ${renderDataSection()}
                    ${renderDangerCard(user, passwordIsSet, isMobile)}
                    ${renderAboutCard()}
                </div>
            `;
            return;
        }

        // ── Account pill partial update ──────────────────────────────
        const avatar = container.querySelector('#settingsAvatar');
        const nameEl = container.querySelector('#settingsUserName');
        const emailEl = container.querySelector('#settingsUserEmail');
        const pill = container.querySelector('.settings-account-pill');
        const localOnlyBadge = container.querySelector('[data-when="signed-out"]');
        const headerEl = container.querySelector('.settings-header');

        if (avatar)  avatar.src = user?.photoURL || 'src/icons/icon48.png';
        if (nameEl)  nameEl.textContent = user?.displayName || user?.email?.split('@')[0] || 'User';
        if (emailEl) emailEl.textContent = user?.email || '';
        if (pill) {
            if (user) {
                pill.removeAttribute('hidden');
                pill.setAttribute('title', user.email || '');
                pill.dataset.tooltip = user.email || '';
            } else {
                pill.setAttribute('hidden', '');
            }
        }
        if (localOnlyBadge) {
            if (user) localOnlyBadge.setAttribute('hidden', '');
            else localOnlyBadge.removeAttribute('hidden');
        }
        if (headerEl) headerEl.dataset.signedIn = user ? 'true' : 'false';

        // ── Set-password button (Danger zone) partial update ─────────
        // The button visibility depends on (user + passwordIsSet + isMobile).
        // Recompute desired state and mutate only when it differs from current.
        const dangerCard = container.querySelector('.settings-card--danger .settings-action-grid');
        const existingSetPwBtn = dangerCard?.querySelector('#settingsSetPassword');
        const expectedState = (!user || isMobile) ? 'absent' : (passwordIsSet ? 'set' : 'unset');
        const currentState = !existingSetPwBtn ? 'absent' :
            (existingSetPwBtn.classList.contains('settings-action--set') ? 'set' : 'unset');
        if (dangerCard && expectedState !== currentState) {
            existingSetPwBtn?.remove();
            if (expectedState === 'set') {
                dangerCard.insertAdjacentHTML('beforeend', `
                    <button class="settings-action settings-action--set" id="settingsSetPassword" type="button">
                        ${svg('check')}
                        <span class="settings-action-text">
                            <span class="settings-action-title">Password set</span>
                            <span class="settings-action-subtitle">Tap to update — same email, new password</span>
                        </span>
                    </button>
                `);
            } else if (expectedState === 'unset') {
                dangerCard.insertAdjacentHTML('beforeend', `
                    <button class="settings-action" id="settingsSetPassword" type="button">
                        ${svg('key')}
                        <span class="settings-action-text">
                            <span class="settings-action-title">Set password for mobile</span>
                            <span class="settings-action-subtitle">Sign in on Orion / Safari with email + password</span>
                        </span>
                    </button>
                `);
            }
        }

        // ── Toggle subtitle live updates ─────────────────────────────
        updateToggle('settingsCopyGuard', state.copyGuard,
            state.copyGuard ? 'Block copy outside allowed text' : 'Copy protection is turned off');
        updateToggle('settingsSmartNotif', state.smartNotif,
            state.smartNotif ? 'You will be notified of new episodes' : 'Notify when new episodes drop');
        updateToggle('settingsAutoSkipFiller', state.autoSkipFiller,
            state.autoSkipFiller ? 'Filler episodes will be auto-skipped' : 'Skip filler, jump to next canon ep');
        updateToggle('settingsSkiptime', state.skiptimeHelper,
            state.skiptimeHelper ? 'Capture intro/outro on an1me.to/watch' : 'Floating panel for intro/outro contributions');
    }

    // ─── Aria-live region for toggle announcements ───────────────────
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
        if (prev !== en) {
            const titleEl = btn.querySelector('.settings-toggle-title');
            const titleText = titleEl?.textContent?.trim() || 'Setting';
            const live = _ensureSettingsLiveRegion();
            live.textContent = '';
            requestAnimationFrame(() => {
                live.textContent = `${titleText} ${en ? 'enabled' : 'disabled'}`;
            });
        }
    }

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.SettingsView = { render, updateToggle };

    // ─── Initial render at script-parse time ─────────────────────────
    // Rendered NOW (not on view-mode click) so all IDs exist in the DOM by
    // the time main.js's IIFE caches them. main.js re-calls render() later
    // with the actual user/settings to refresh the visible content.
    const initialContainer = document.getElementById('settingsView');
    if (initialContainer) {
        render(initialContainer, { user: null, settings: {} });
        initialContainer.setAttribute('hidden', '');
    }
})();
