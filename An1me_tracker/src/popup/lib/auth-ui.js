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

    AT.AuthUI = { signInWithGoogle, handleEmailAuth, handleForgotPassword };
    AT.friendlyAuthError = friendlyAuthError;
})();
