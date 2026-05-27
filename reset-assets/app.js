(() => {
    'use strict';

    // Firebase web API keys identify a project; authorization remains enforced by the one-time action code.
    const FIREBASE_API_KEY = 'AIzaSyCDF9US2OwARlyZ0AH_zDpjzmOXRtrGKMg';
    const RESET_ENDPOINT = `https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${FIREBASE_API_KEY}`;
    const parameters = new URLSearchParams(window.location.search);
    const mode = parameters.get('mode');
    const actionCode = parameters.get('oobCode');

    const views = {
        loading: document.getElementById('loading-view'),
        form: document.getElementById('form-view'),
        success: document.getElementById('success-view'),
        error: document.getElementById('error-view')
    };
    const accountEmail = document.getElementById('account-email');
    const form = document.getElementById('reset-form');
    const passwordInput = document.getElementById('new-password');
    const confirmInput = document.getElementById('confirm-password');
    const formError = document.getElementById('form-error');
    const submitButton = document.getElementById('submit-button');
    const strength = document.querySelector('.strength');
    const strengthText = document.getElementById('strength-text');
    const errorTitle = document.getElementById('error-title');
    const errorMessage = document.getElementById('error-message');

    function showView(name) {
        Object.entries(views).forEach(([key, node]) => {
            node.hidden = key !== name;
        });
    }

    function maskEmail(email) {
        const parts = String(email).split('@');
        if (parts.length !== 2) return email;
        const name = parts[0];
        const visible = name.length <= 2 ? name[0] : name.slice(0, 2);
        return `${visible}${'*'.repeat(Math.max(2, Math.min(6, name.length - visible.length)))}@${parts[1]}`;
    }

    async function firebaseResetPassword(payload) {
        let response;
        try {
            response = await fetch(RESET_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            throw new Error('NETWORK_ERROR');
        }

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(body?.error?.message || 'UNKNOWN_ERROR');
        }
        return body;
    }

    function resetLinkError(code) {
        if (code.includes('EXPIRED_OOB_CODE')) {
            return {
                title: 'Ο σύνδεσμος έληξε',
                message: 'Για την ασφάλειά σου, ο σύνδεσμος επαναφοράς δεν ισχύει πλέον. Ζήτησε νέο email από το extension.'
            };
        }
        if (code.includes('INVALID_OOB_CODE')) {
            return {
                title: 'Μη έγκυρος σύνδεσμος',
                message: 'Ο σύνδεσμος έχει ήδη χρησιμοποιηθεί ή δεν είναι έγκυρος. Ζήτησε νέο email επαναφοράς.'
            };
        }
        if (code === 'NETWORK_ERROR') {
            return {
                title: 'Δεν υπάρχει σύνδεση',
                message: 'Δεν μπορέσαμε να επικοινωνήσουμε με το Firebase. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.'
            };
        }
        return {
            title: 'Δεν ολοκληρώθηκε η επαναφορά',
            message: 'Ο σύνδεσμος δεν μπορεί να επαληθευτεί. Ζήτησε νέο email επαναφοράς από το extension.'
        };
    }

    function showLinkError(code) {
        const content = resetLinkError(code);
        errorTitle.textContent = content.title;
        errorMessage.textContent = content.message;
        showView('error');
    }

    function setFormError(message) {
        formError.textContent = message || '';
        formError.hidden = !message;
    }

    function setSubmitting(isSubmitting) {
        submitButton.disabled = isSubmitting;
        submitButton.classList.toggle('is-loading', isSubmitting);
        passwordInput.disabled = isSubmitting;
        confirmInput.disabled = isSubmitting;
    }

    function updateStrength() {
        const value = passwordInput.value;
        if (!value) {
            strength.removeAttribute('data-level');
            strengthText.textContent = 'Χρησιμοποίησε γράμματα, αριθμούς και σύμβολα';
            return;
        }

        let score = 0;
        if (value.length >= 8) score += 1;
        if (value.length >= 12) score += 1;
        if (/[a-zα-ω]/i.test(value) && /\d/.test(value)) score += 1;
        if (/[^a-zα-ω0-9]/i.test(value)) score += 1;

        if (value.length < 6 || score <= 1) {
            strength.dataset.level = 'weak';
            strengthText.textContent = 'Αδύναμος κωδικός';
        } else if (score <= 2) {
            strength.dataset.level = 'medium';
            strengthText.textContent = 'Καλός κωδικός - μπορεί να γίνει ισχυρότερος';
        } else {
            strength.dataset.level = 'strong';
            strengthText.textContent = 'Ισχυρός κωδικός';
        }
    }

    function confirmationError(code) {
        if (code.includes('WEAK_PASSWORD')) {
            return 'Ο κωδικός είναι πολύ αδύναμος. Χρησιμοποίησε περισσότερους χαρακτήρες και συνδυασμούς.';
        }
        if (code.includes('PASSWORD_DOES_NOT_MEET_REQUIREMENTS')) {
            return 'Ο κωδικός δεν καλύπτει τις απαιτήσεις ασφαλείας. Δοκίμασε μεγαλύτερο κωδικό με αριθμό και σύμβολο.';
        }
        if (code === 'NETWORK_ERROR') {
            return 'Αδυναμία σύνδεσης. Έλεγξε το internet και προσπάθησε ξανά.';
        }
        return '';
    }

    async function verifyLink() {
        if (mode !== 'resetPassword' || !actionCode) {
            showLinkError('INVALID_OOB_CODE');
            return;
        }

        try {
            const result = await firebaseResetPassword({ oobCode: actionCode });
            window.history.replaceState({}, document.title, window.location.pathname);
            accountEmail.textContent = maskEmail(result.email || '');
            showView('form');
            passwordInput.focus();
        } catch (error) {
            showLinkError(error.message);
        }
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const password = passwordInput.value;
        const confirmation = confirmInput.value;

        setFormError('');
        if (password.length < 6) {
            setFormError('Ο νέος κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.');
            passwordInput.focus();
            return;
        }
        if (password !== confirmation) {
            setFormError('Οι δύο κωδικοί δεν ταιριάζουν.');
            confirmInput.focus();
            return;
        }

        setSubmitting(true);
        try {
            await firebaseResetPassword({ oobCode: actionCode, newPassword: password });
            form.reset();
            showView('success');
        } catch (error) {
            const fieldMessage = confirmationError(error.message);
            if (fieldMessage) {
                setFormError(fieldMessage);
                setSubmitting(false);
                return;
            }
            showLinkError(error.message);
        }
    });

    passwordInput.addEventListener('input', () => {
        setFormError('');
        updateStrength();
    });
    confirmInput.addEventListener('input', () => setFormError(''));

    document.querySelectorAll('.reveal').forEach((button) => {
        button.addEventListener('click', () => {
            const input = document.getElementById(button.dataset.target);
            const showing = input.type === 'text';
            input.type = showing ? 'password' : 'text';
            button.querySelector('.show-label').textContent = showing ? 'Δείξε' : 'Κρύψε';
            button.setAttribute('aria-label', showing ? 'Εμφάνιση κωδικού' : 'Απόκρυψη κωδικού');
        });
    });

    verifyLink();
})();
