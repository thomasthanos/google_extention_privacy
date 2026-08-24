window.NexusExt = window.NexusExt || {};

(function () {
  'use strict';

  const Errors = NexusExt.Errors;
  const LOGIN_URL = 'https://users.nexusmods.com/auth/sign_in';
  const DEFAULT_RETURN_URL = 'https://www.nexusmods.com/';
  const LOGIN_LABEL = /^(?:log|sign)\s*in(?:\s+to\s+nexus\s*mods)?$/i;

  function normalizeLabel(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isNexusUrl(value) {
    try {
      const url = new URL(value, DEFAULT_RETURN_URL);
      return url.protocol === 'https:'
        && (url.hostname === 'nexusmods.com' || url.hostname.endsWith('.nexusmods.com'));
    } catch (_) {
      return false;
    }
  }

  function isLoginUrl(value) {
    try {
      const url = new URL(value, DEFAULT_RETURN_URL);
      return url.hostname === 'users.nexusmods.com' && /^\/auth\/sign_in(?:\/|$)/.test(url.pathname);
    } catch (_) {
      return false;
    }
  }

  function createLoginError(context = 'Checking Nexus Mods login') {
    return Errors.create('requires_login', { context });
  }

  function isVisibleControl(element) {
    if (!element || element.hidden || element.getAttribute?.('aria-hidden') === 'true') return false;
    if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) return false;
    try {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    } catch (_) {
      return true;
    }
  }

  function isSignedIn(root = document) {
    try {
      const marker = root.querySelector?.(
        '#profile-menu, [data-testid="profile-image"], a[href*="/auth/sign_out"]'
      );
      return !!marker && isVisibleControl(marker);
    } catch (_) {
      return false;
    }
  }

  function getDocumentLoginError(root = document, context = 'Checking Nexus Mods login') {
    try {
      if (typeof location !== 'undefined' && isLoginUrl(location.href)) return createLoginError(context);

      if (isSignedIn(root)) return null;

      const loginForm = root.querySelector?.('form[action*="/auth/sign_in"], form#new_user');
      if (loginForm && isVisibleControl(loginForm)) return createLoginError(context);

      const headings = Array.from(root.querySelectorAll?.('h1, h2') || []);
      if (headings.some((heading) => isVisibleControl(heading)
        && /(?:log|sign)\s*in\s+to\s+nexus\s*mods/i.test(normalizeLabel(heading.textContent)))) {
        return createLoginError(context);
      }

      const controls = Array.from(root.querySelectorAll?.('button, a, input[type="submit"], input[type="button"]') || []);
      const hasLoginControl = controls.some((control) => {
        if (!isVisibleControl(control)) return false;
        const label = normalizeLabel(
          control.value
          || control.textContent
          || control.getAttribute?.('aria-label')
          || control.getAttribute?.('title')
        );
        if (LOGIN_LABEL.test(label)) return true;
        const href = control.getAttribute?.('href') || '';
        return isLoginUrl(href) && /(?:log|sign)\s*in/i.test(label);
      });
      return hasLoginControl ? createLoginError(context) : null;
    } catch (_) {
      return null;
    }
  }

  function getResponseLoginError(response, context = 'Checking Nexus Mods response') {
    if (!response) return null;
    if (isLoginUrl(response.finalUrl)) return createLoginError(context);
    const contentError = Errors.classifyContent(response.text, {
      status: response.status || null,
      context
    });
    return contentError?.code === 'requires_login' ? contentError : null;
  }

  function buildLoginUrl(returnUrl = typeof location !== 'undefined' ? location.href : DEFAULT_RETURN_URL) {
    const safeReturnUrl = isNexusUrl(returnUrl) && !isLoginUrl(returnUrl) ? returnUrl : DEFAULT_RETURN_URL;
    const url = new URL(LOGIN_URL);
    url.searchParams.set('redirect_url', safeReturnUrl);
    return url.href;
  }

  function openLogin(returnUrl = typeof location !== 'undefined' ? location.href : DEFAULT_RETURN_URL) {
    const loginUrl = buildLoginUrl(returnUrl);
    try {
      location.assign(loginUrl);
    } catch (_) {
      window.open(loginUrl, '_blank', 'noopener,noreferrer');
    }
  }

  window.NexusExt.Auth = {
    isSignedIn,
    getDocumentLoginError,
    getResponseLoginError,
    buildLoginUrl,
    openLogin
  };
})();
