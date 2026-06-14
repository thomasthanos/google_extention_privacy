(function () {
    'use strict';

    // Auth UI — Google + email/password sign-in & forgot-password.
    // Extracted from popup/main.js; consumed via AT.AuthUI. signOut() stays in
    // main.js (mutates popup library state). PopupLogger is a global (common/logger.js).
    const AT = (window.AnimeTracker = window.AnimeTracker || {});
    const { showAuthToast } = AT;

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

    function enhanceAuthMarkup() {
        const jpText = document.querySelector('.auth-anime-title .jp-text');
        const jpSubtitle = document.querySelector('.jp-subtitle');
        const torii = document.querySelector('.torii-gate');
        if (jpText) jpText.textContent = 'アニメトラッカー';
        if (jpSubtitle) jpSubtitle.textContent = 'ー あなたのアニメ記録 ー';
        if (torii && !torii.dataset.enhanced) {
            torii.dataset.enhanced = 'true';
            torii.innerHTML = `
                <svg viewBox="0 0 96 78" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M18 14c18 7 42 7 60 0v10c-17 8-43 8-60 0V14z" fill="#ff6a2f"/>
                    <path d="M24 30h48v9H24z" fill="#f25a24"/>
                    <path d="M30 39h9v31h-9zM57 39h9v31h-9z" fill="#ff6a2f"/>
                    <path d="M16 21c20 8 44 8 64 0" stroke="#ff9a58" stroke-width="2" stroke-linecap="round" opacity=".7"/>
                </svg>
            `;
        }

        const email = document.getElementById('authEmailInput');
        if (email && !email.closest('.auth-input-shell')) {
            email.insertAdjacentHTML('beforebegin', `
                <div class="auth-input-shell" data-auth-shell="email">
                    <svg class="auth-input-icon" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round"
                         stroke-linejoin="round" aria-hidden="true">
                        <rect x="3" y="5" width="18" height="14" rx="2"/>
                        <path d="m3 7 9 6 9-6"/>
                    </svg>
                </div>
            `);
            email.previousElementSibling?.appendChild(email);
        }

        const password = document.getElementById('authPasswordInput');
        if (password && !password.closest('.auth-input-shell')) {
            password.placeholder = '••••••••';
            password.insertAdjacentHTML('beforebegin', `
                <div class="auth-input-shell" data-auth-shell="password">
                    <svg class="auth-input-icon" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round"
                         stroke-linejoin="round" aria-hidden="true">
                        <rect x="5" y="11" width="14" height="10" rx="2"/>
                        <path d="M8 11V8a4 4 0 0 1 8 0v3"/>
                    </svg>
                    <button class="auth-password-toggle" id="authPasswordToggle"
                            type="button" aria-label="Show password" aria-pressed="false">
                        <svg class="auth-eye auth-eye-on" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2" stroke-linecap="round"
                             stroke-linejoin="round" aria-hidden="true">
                            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                        <svg class="auth-eye auth-eye-off" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2" stroke-linecap="round"
                             stroke-linejoin="round" aria-hidden="true">
                            <path d="M3 3l18 18"/>
                            <path d="M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-4.8"/>
                            <path d="M9.9 4.2A10.7 10.7 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-3.2 4.3"/>
                            <path d="M6.6 6.6A18.7 18.7 0 0 0 2 12s3.5 8 10 8a10.9 10.9 0 0 0 4.1-.8"/>
                        </svg>
                    </button>
                </div>
            `);
            const shell = password.previousElementSibling;
            const toggle = shell?.querySelector('#authPasswordToggle');
            shell?.insertBefore(password, toggle);
            toggle?.addEventListener('click', () => {
                const reveal = password.type === 'password';
                password.type = reveal ? 'text' : 'password';
                toggle.setAttribute('aria-pressed', reveal ? 'true' : 'false');
                toggle.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
                shell.classList.toggle('is-revealed', reveal);
            });
        }

        const signInBtn = document.getElementById('emailSignInBtn');
        if (signInBtn && !signInBtn.querySelector('.btn-auth-arrow')) {
            signInBtn.insertAdjacentHTML('beforeend', `
                <svg class="btn-auth-arrow" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="3" stroke-linecap="round"
                     stroke-linejoin="round" aria-hidden="true">
                    <path d="M9 18l6-6-6-6"/>
                </svg>
            `);
        }

        const forgot = document.getElementById('authForgotPasswordBtn');
        if (forgot && !forgot.querySelector('.auth-link-icon')) {
            forgot.innerHTML = `
                <span class="auth-link-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="5" y="11" width="14" height="10" rx="2"/>
                        <path d="M8 11V8a4 4 0 0 1 8 0v3"/>
                    </svg>
                </span>
                <span>Forgot password?</span>
            `;
        }

        const warmup = () => AT.FirebaseSync?.warmupResetBackend?.();
        const emailInput = document.getElementById('authEmailInput');
        if (emailInput && !emailInput.dataset.warmupBound) {
            emailInput.dataset.warmupBound = '1';
            emailInput.addEventListener('focus', warmup, { passive: true });
        }
        if (forgot && !forgot.dataset.warmupBound) {
            forgot.dataset.warmupBound = '1';
            forgot.addEventListener('pointerenter', warmup, { passive: true });
            forgot.addEventListener('focus', warmup, { passive: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', enhanceAuthMarkup, { once: true });
    } else {
        enhanceAuthMarkup();
    }

    async function signInWithGoogle() {
        const { FirebaseSync } = AT;
        try {
            document.getElementById('googleSignIn').disabled = true;
            document.getElementById('googleSignIn').innerHTML = `
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
            document.getElementById('googleSignIn').disabled = false;
            document.getElementById('googleSignIn').innerHTML = GOOGLE_BTN_DEFAULT_HTML;
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
        if (forgotBtn) {
            forgotBtn.disabled = true;
            forgotBtn.textContent = 'Sending…';
        }

        // Fire-and-forget: the backend sends the email regardless of whether we
        // wait for the response (and always replies with a generic message for
        // privacy). Never block here — the user may remember their password and
        // sign in normally instead of completing the reset.
        FirebaseSync.sendPasswordReset(email)
            .then(() => PopupLogger.log('Firebase', `Password reset request accepted for ${email}`))
            .catch((err) => PopupLogger.warn('Firebase', `Password reset request error (non-blocking): ${err?.message}`));

        setEmailFormError(
            `If an account exists for ${email}, a reset email will arrive shortly. Check your inbox and spam folder. You can still sign in normally if you remember your password.`,
            { success: true }
        );

        if (forgotBtn) {
            setTimeout(() => {
                forgotBtn.disabled = false;
                forgotBtn.textContent = 'Forgot password?';
                enhanceAuthMarkup();
            }, 2000);
        }
    }

    AT.AuthUI = { signInWithGoogle, handleEmailAuth, handleForgotPassword };
    AT.friendlyAuthError = friendlyAuthError;
})();
