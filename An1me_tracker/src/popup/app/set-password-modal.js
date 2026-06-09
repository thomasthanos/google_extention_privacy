(function () {
    'use strict';

    // Set-password modal — extracted from popup/main.js.
    // Deps (resolved at call time): AT.{FirebaseSync,Dialogs,showToast,friendlyAuthError},
    // AT.refreshSettingsViewIfOpen, and the global PopupLogger (common/logger.js).
    // Touches no popup state (animeData/videoProgress/elements).
    const AT = (window.AnimeTracker = window.AnimeTracker || {});
    const PASSWORD_SET_MARKER_KEY = 'passwordSetMarker';

    async function openSetPasswordModal() {
        document.getElementById('setPasswordOverlay')?.remove();

        const { FirebaseSync, Dialogs, showToast, friendlyAuthError } = AT;
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



                AT.refreshSettingsViewIfOpen();
            } catch (err) {
                PopupLogger.error('Firebase', 'Set password error:', err);
                showErr(friendlyAuthError(err));
                restoreIdleLabel();
            }
        });

        document.body.appendChild(overlay);


        Dialogs.open(overlay, { initialFocus: pwInput });
    }

    AT.openSetPasswordModal = openSetPasswordModal;
})();
