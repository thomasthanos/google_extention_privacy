


(function () {
    'use strict';

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }


    const ICONS = {
        signOut:  '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
        heart:    '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
        refresh:  '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
        download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
        upload:   '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
        trash:    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
        key:      '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M11 12l8-8"/><path d="M15 4h4v4"/>',
        copy:     '<path d="M7 3h8l4 4v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M15 3v5h4"/><rect x="8.5" y="12" width="7" height="5.5" rx="1.2"/><path d="M10 12v-1.2a2 2 0 0 1 4 0V12"/>',
        bell:     '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
        skipFwd:  '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
        skipMark: '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/>',
        sparkles: '<path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/><path d="M5.3 5.3l2.8 2.8M15.9 15.9l2.8 2.8M5.3 18.7l2.8-2.8M15.9 8.1l2.8-2.8"/><circle cx="12" cy="12" r="3.6"/>',
        fourK:    '<text x="12" y="17" text-anchor="middle" font-size="15" font-weight="900" fill="currentColor" stroke="none" font-family="Inter, Segoe UI, sans-serif">4K</text>',
        check:    '<polyline points="20 6 9 17 4 12"/>',
        gear:     '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
        link:     '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
        database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
        chevron:  '<polyline points="9 18 15 12 9 6"/>'
    };

    // Card header: left icon + uppercase title + optional right pill.
    function sectionHead(iconKey, title, pill = '') {
        return `
            <div class="settings-head">
                <span class="settings-head-icon">${svg(iconKey)}</span>
                <span class="settings-head-title">${escapeHtml(title)}</span>
                ${pill ? `<span class="settings-head-pill">${escapeHtml(pill)}</span>` : ''}
            </div>`;
    }

    function svg(iconKey, extraClass = '') {
        const paths = ICONS[iconKey];
        if (!paths) return '';
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round"
                     class="settings-icon ${extraClass}" aria-hidden="true" focusable="false">${paths}</svg>`;
    }


    function renderHeader(user, needsReauth = false) {
        const photo = user?.photoURL ? escapeHtml(user.photoURL) : 'src/icons/icon48.png';
        const name = escapeHtml(user?.displayName || user?.email?.split('@')[0] || 'User');
        const email = escapeHtml(user?.email || '');
        const signedIn = !!user;

        const bannerHtml = (signedIn && needsReauth) ? `
            <div class="settings-reauth-banner" id="settingsReauthBanner">
                <span class="settings-reauth-warning">Cloud sync paused. Reconnect required.</span>
                <button class="settings-reauth-btn" id="settingsReauthBtn" type="button">Reconnect</button>
            </div>
        ` : '';

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
                ${bannerHtml}
            </header>
        `;
    }


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
                subtitle: state.copyGuard ? 'Prevent copying protected text' : 'Copy protection is turned off',
                enabled: state.copyGuard
            }),
            renderToggleItem({
                id: 'settingsSmartNotif', subtitleId: 'settingsSmartNotifSubtitle',
                iconKey: 'bell', title: 'New Episode Alerts',
                subtitle: state.smartNotif ? 'Notify when new episodes appear' : 'Notify when new episodes drop',
                enabled: state.smartNotif
            }),
            renderToggleItem({
                id: 'settingsAutoSkipFiller', subtitleId: 'settingsAutoSkipFillerSubtitle',
                iconKey: 'skipFwd', title: 'Auto-Skip Fillers',
                subtitle: state.autoSkipFiller ? 'Skip known filler episodes' : 'Skip filler, jump to next canon ep',
                enabled: state.autoSkipFiller
            }),
            renderToggleItem({
                id: 'settingsSkiptime', subtitleId: 'settingsSkiptimeSubtitle',
                iconKey: 'skipMark', title: 'Skiptime Contributor',
                subtitle: state.skiptimeHelper ? 'Show the floating skip panel' : 'Floating panel for intro/outro contributions',
                enabled: state.skiptimeHelper
            }),
            renderToggleItem({
                id: 'settingsAuto4kServer', subtitleId: 'settingsAuto4kServerSubtitle',
                iconKey: 'fourK', title: 'Auto-Pick 4k Server',
                subtitle: state.auto4kServer ? 'Prefer 4k server when available' : '4k auto-pick is off',
                enabled: state.auto4kServer
            })
        ].join('');

        return `
            <section class="settings-card settings-card--preferences">
                ${sectionHead('gear', 'PREFERENCES', '5 settings')}
                <div class="settings-toggle-list">${items}</div>
            </section>
        `;
    }


    function renderConnectionsSection() {
        return `
            <section class="settings-card settings-connections-card" id="settingsConnectionsSection">
                <div class="settings-head">
                    <span class="settings-head-icon">${svg('link')}</span>
                    <span class="settings-head-title">CONNECTIONS</span>
                    <span class="anilist-pill settings-connections-status-pill" title="Connected" hidden>Connected</span>
                </div>
                <div class="settings-connections-mount" id="settingsConnectionsMount"></div>
            </section>
        `;
    }


    function renderDataSection() {
        return `
            <section class="settings-card settings-data-card">
                ${sectionHead('database', 'DATA TOOLS')}
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
                <div class="settings-backup-card">
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
                </div>
            </section>
        `;
    }


    function _setPasswordInner(passwordIsSet) {
        return passwordIsSet ? `
            <button class="settings-action settings-action--set settings-action--full" id="settingsSetPassword" type="button">
                ${svg('check')}
                <span class="settings-action-text">
                    <span class="settings-action-title">Password set</span>
                    <span class="settings-action-subtitle">Tap to update it</span>
                </span>
                <span class="settings-action-arrow">${svg('chevron')}</span>
            </button>` : `
            <button class="settings-action settings-action--full" id="settingsSetPassword" type="button">
                ${svg('key')}
                <span class="settings-action-text">
                    <span class="settings-action-title">Set password</span>
                    <span class="settings-action-subtitle">Mobile email login</span>
                </span>
                <span class="settings-action-arrow">${svg('chevron')}</span>
            </button>`;
    }

    function renderDangerCard(user, passwordIsSet, isMobile) {
        const showSetPw = !(!user || isMobile);
        return `
            <div class="settings-danger-row" data-has-password="${showSetPw}">
                <section class="settings-card settings-card--danger">
                    <button class="settings-action settings-action--danger settings-action--full" id="settingsClear" type="button">
                        ${svg('trash')}
                        <span class="settings-action-text">
                            <span class="settings-action-title">Clear all data</span>
                            <span class="settings-action-subtitle">Local reset</span>
                        </span>
                        <span class="settings-action-arrow">${svg('chevron')}</span>
                    </button>
                </section>
                <section class="settings-card settings-card--password" id="settingsSetPwCard"${showSetPw ? '' : ' hidden'}>
                        ${showSetPw ? _setPasswordInner(passwordIsSet) : ''}
                </section>
            </div>
        `;
    }


    function renderAboutCard() {
        return `
            <section class="settings-card settings-card--compact settings-card--support">
                <div class="settings-about-row">
                    <div class="settings-about-copy">
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


    function render(container, params = {}) {
        if (!container) return;
        container.removeAttribute('hidden');

        const {
            user = null,
            settings = {},
            passwordIsSet = false,
            isMobile = false,
            needsReauth = false
        } = params;

        const state = {
            copyGuard: settings.copyGuard !== false,
            smartNotif: settings.smartNotif === true,
            autoSkipFiller: settings.autoSkipFiller === true,
            skiptimeHelper: settings.skiptimeHelper === true,
            auto4kServer: settings.auto4kServer !== false
        };


        const alreadyRendered = container.querySelector('.settings-view-inner');
        if (!alreadyRendered) {
            container.innerHTML = `
                <div class="settings-view-inner">
                    ${renderHeader(user, needsReauth)}
                    ${renderPreferencesSection(state)}
                    ${renderConnectionsSection()}
                    ${renderDataSection()}
                    ${renderDangerCard(user, passwordIsSet, isMobile)}
                    ${renderAboutCard()}
                </div>
            `;
            return;
        }


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
        if (headerEl) {
            headerEl.dataset.signedIn = user ? 'true' : 'false';
            
            const bannerEl = headerEl.querySelector('#settingsReauthBanner');
            if (user && needsReauth) {
                if (!bannerEl) {
                    headerEl.insertAdjacentHTML('beforeend', `
                        <div class="settings-reauth-banner" id="settingsReauthBanner">
                            <span class="settings-reauth-warning">Cloud sync paused. Reconnect required.</span>
                            <button class="settings-reauth-btn" id="settingsReauthBtn" type="button">Reconnect</button>
                        </div>
                    `);
                }
            } else {
                bannerEl?.remove();
            }
        }


        const setPwCard = container.querySelector('#settingsSetPwCard');
        if (setPwCard) {
            const showSetPw = !(!user || isMobile);
            setPwCard.closest('.settings-danger-row')?.setAttribute('data-has-password', showSetPw ? 'true' : 'false');
            const existingBtn = setPwCard.querySelector('#settingsSetPassword');
            const expectedState = !showSetPw ? 'absent' : (passwordIsSet ? 'set' : 'unset');
            const currentState = !existingBtn ? 'absent' :
                (existingBtn.classList.contains('settings-action--set') ? 'set' : 'unset');
            if (expectedState !== currentState) {
                setPwCard.innerHTML = showSetPw ? _setPasswordInner(passwordIsSet) : '';
                if (showSetPw) setPwCard.removeAttribute('hidden');
                else setPwCard.setAttribute('hidden', '');
            }
        }


        updateToggle('settingsCopyGuard', state.copyGuard,
            state.copyGuard ? 'Prevent copying protected text' : 'Copy protection is turned off');
        updateToggle('settingsSmartNotif', state.smartNotif,
            state.smartNotif ? 'Notify when new episodes appear' : 'Notify when new episodes drop');
        updateToggle('settingsAutoSkipFiller', state.autoSkipFiller,
            state.autoSkipFiller ? 'Skip known filler episodes' : 'Skip filler, jump to next canon ep');
        updateToggle('settingsSkiptime', state.skiptimeHelper,
            state.skiptimeHelper ? 'Show the floating skip panel' : 'Floating panel for intro/outro contributions');
        updateToggle('settingsAuto4kServer', state.auto4kServer,
            state.auto4kServer ? 'Prefer 4k server when available' : '4k auto-pick is off');
    }


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


    const initialContainer = document.getElementById('settingsView');
    if (initialContainer) {
        render(initialContainer, { user: null, settings: {} });
        initialContainer.setAttribute('hidden', '');
    }
})();
