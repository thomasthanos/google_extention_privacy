(function () {
  const API_KEY = 'AIzaSyCDF9US2OwARlyZ0AH_zDpjzmOXRtrGKMg';
  const ENDPOINT = `https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${API_KEY}`;
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const oobCode = params.get('oobCode');

  const form = document.getElementById('resetForm');
  const passwordInput = document.getElementById('passwordInput');
  const confirmInput = document.getElementById('confirmInput');
  const submitButton = document.getElementById('submitButton');
  const statusBox = document.getElementById('statusBox');
  const stateBadge = document.getElementById('stateBadge');
  const resetLead = document.getElementById('resetLead');

  function setStatus(message, kind) {
    statusBox.hidden = false;
    statusBox.textContent = message;
    statusBox.className = `status-box ${kind ? `is-${kind}` : ''}`.trim();
  }

  function setDisabled(disabled) {
    passwordInput.disabled = disabled;
    confirmInput.disabled = disabled;
    submitButton.disabled = disabled;
  }

  async function callResetPassword(payload) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      const code = data.error?.message || `HTTP_${response.status}`;
      throw new Error(code);
    }
    return data;
  }

  function friendlyError(code) {
    if (code.includes('EXPIRED_OOB_CODE')) return 'This reset link has expired. Please request a new password reset email.';
    if (code.includes('INVALID_OOB_CODE')) return 'This reset link is invalid or has already been used. Please request a new one.';
    if (code.includes('WEAK_PASSWORD')) return 'Use at least 6 characters for the new password.';
    if (code.includes('USER_DISABLED')) return 'This account is disabled.';
    return 'Something went wrong while resetting the password. Please try again.';
  }

  async function verifyLink() {
    if (mode && mode !== 'resetPassword') {
      setDisabled(true);
      stateBadge.textContent = 'Unsupported link';
      setStatus('This link is not a password reset link.', 'error');
      return;
    }

    if (!oobCode) {
      setDisabled(true);
      stateBadge.textContent = 'Missing code';
      setStatus('The reset link is missing its verification code. Open the full link from your email.', 'error');
      return;
    }

    try {
      setDisabled(true);
      setStatus('Checking your reset link...', 'warn');
      const data = await callResetPassword({ oobCode });
      const email = data.email ? ` for ${data.email}` : '';
      stateBadge.textContent = 'Ready';
      resetLead.textContent = `Create a fresh password${email}.`;
      statusBox.hidden = true;
      setDisabled(false);
      passwordInput.focus();
    } catch (error) {
      setDisabled(true);
      stateBadge.textContent = 'Link problem';
      setStatus(friendlyError(error.message), 'error');
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = passwordInput.value;
    const confirm = confirmInput.value;

    if (password.length < 6) {
      setStatus('Password must be at least 6 characters.', 'error');
      passwordInput.focus();
      return;
    }

    if (password !== confirm) {
      setStatus('Passwords do not match.', 'error');
      confirmInput.focus();
      return;
    }

    try {
      setDisabled(true);
      submitButton.textContent = 'Resetting...';
      setStatus('Saving your new password...', 'warn');
      await callResetPassword({ oobCode, newPassword: password });
      stateBadge.textContent = 'Done';
      setStatus('Your password was reset successfully. You can now sign in with the new password.', 'ok');
      form.hidden = true;
    } catch (error) {
      setDisabled(false);
      submitButton.textContent = 'Reset password';
      setStatus(friendlyError(error.message), 'error');
    }
  });

  verifyLink();
})();
