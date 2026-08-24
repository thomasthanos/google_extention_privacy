window.NexusExt = window.NexusExt || {};

(function () {
  'use strict';

  const REPORT_ISSUE_URL = NXTK.REPORT_ISSUE_URL;
  const DEFAULT_TIMEOUT_MS = 30000;

  const DEFINITIONS = {
    missing_file: {
      userMessage: 'This download link does not include a file identifier.',
      recovery: 'Open the file page and try again.',
      retryable: false
    },
    timeout: {
      userMessage: 'Nexus Mods took too long to respond.',
      recovery: 'Check your connection, then retry.',
      retryable: true
    },
    offline: {
      userMessage: 'You appear to be offline.',
      recovery: 'Reconnect to the internet, then retry.',
      retryable: true
    },
    network_error: {
      userMessage: 'The request to Nexus Mods could not be completed.',
      recovery: 'Check your connection and retry.',
      retryable: true
    },
    requires_login: {
      userMessage: 'You are not signed in to Nexus Mods.',
      recovery: 'Sign in, return to this page, then retry the download.',
      retryable: true,
      blocking: true
    },
    cloudflare: {
      userMessage: 'Nexus Mods needs a browser verification before continuing.',
      recovery: 'Complete the verification on the file page, then retry.',
      retryable: true,
      blocking: true
    },
    rate_limited: {
      userMessage: 'Nexus Mods is temporarily rate limiting requests.',
      recovery: 'Wait a few minutes before trying again.',
      retryable: true,
      blocking: true
    },
    account_suspended: {
      userMessage: 'Nexus Mods temporarily suspended further download requests.',
      recovery: 'Wait before trying again to avoid extending the suspension.',
      retryable: false,
      blocking: true
    },
    access_denied: {
      userMessage: 'Nexus Mods denied access to this download.',
      recovery: 'Check your account permissions and the file page, then retry.',
      retryable: true
    },
    file_not_found: {
      userMessage: 'The requested file was not found on Nexus Mods.',
      recovery: 'The file may have been removed or the link is outdated.',
      retryable: false
    },
    moderation_hold: {
      userMessage: 'This file is under moderation review.',
      recovery: 'Wait for Nexus Mods to approve the file before downloading.',
      retryable: false
    },
    server_error: {
      userMessage: 'Nexus Mods is having a server-side problem.',
      recovery: 'Wait a moment and retry.',
      retryable: true
    },
    invalid_response: {
      userMessage: 'Nexus Mods returned an unexpected response.',
      recovery: 'Refresh the file page and retry.',
      retryable: true
    },
    no_download_url: {
      userMessage: 'Nexus Mods did not return a usable download link.',
      recovery: 'Open the file page, check that you are signed in, then retry.',
      retryable: true
    },
    no_nmm_link: {
      userMessage: 'Nexus Mods did not return a valid Vortex link.',
      recovery: 'Check the file page and retry, or switch to Browser Download.',
      retryable: true
    },
    aborted: {
      userMessage: 'The request was canceled.',
      recovery: '',
      retryable: false
    },
    unsafe_download_url: {
      userMessage: 'The download link Nexus Mods returned was not a recognised download target.',
      recovery: 'Open the file page and download manually. If this keeps happening, report the issue.',
      retryable: false
    },
    context_invalid: {
      userMessage: 'The extension was updated or reloaded while this page was open.',
      recovery: 'Refresh this Nexus Mods page, then retry.',
      retryable: false
    },
    request_failed: {
      userMessage: 'The download request failed.',
      recovery: 'Retry the download. If it keeps happening, report the issue.',
      retryable: true
    }
  };

  function buildError(code, overrides = {}) {
    const safeCode = DEFINITIONS[code] ? code : 'request_failed';
    const definition = DEFINITIONS[safeCode];
    return {
      code: safeCode,
      status: Number.isInteger(overrides.status) ? overrides.status : null,
      context: String(overrides.context || ''),
      userMessage: String(overrides.userMessage || definition.userMessage),
      recovery: String(overrides.recovery || definition.recovery),
      retryable: overrides.retryable ?? !!definition.retryable,
      blocking: overrides.blocking ?? !!definition.blocking,
      technicalMessage: String(overrides.technicalMessage || ''),
      stack: String(overrides.stack || '').slice(0, 1500)
    };
  }

  function create(code, overrides = {}) {
    const error = buildError(code, overrides);
    NXTK.recordError(error);
    return error;
  }

  function normalize(input, fallbackCode = 'request_failed') {
    if (input && typeof input === 'object' && input.code) {
      return buildError(input.code, input);
    }
    if (typeof input === 'string' && input.trim()) {
      return buildError(fallbackCode, { technicalMessage: input.trim() });
    }
    return buildError(fallbackCode);
  }

  function safeUrl(url) {
    return NXTK.sanitizeUrlForReport(url);
  }

  function describeResponse(finalUrl, status, text) {
    const length = text ? text.length : 0;
    const hasNxm = /nxm:\/\//i.test(text || '');
    return `resp HTTP ${status || 0}, ${length}B, ${hasNxm ? 'nxm-link present' : 'no nxm-link'}, final=${safeUrl(finalUrl)}`;
  }

  function isLiveDocumentSignedIn() {
    try {
      if (typeof document === 'undefined') return false;
      if (window.NexusExt?.Auth?.isSignedIn) return window.NexusExt.Auth.isSignedIn(document);
      return !!document.querySelector(
        '#profile-menu, [data-testid="profile-image"], a[href*="/auth/sign_out"]'
      );
    } catch (_) {
      return false;
    }
  }

  const MAX_CLASSIFY_CHARS = 200000;

  function classifyContent(text, { status = null, context = '', extra = '' } = {}) {
    const content = String(text || '').slice(0, MAX_CLASSIFY_CHARS).toLowerCase();
    if (!content) return null;
    const detail = (reason) => ({ status, context, technicalMessage: [reason, extra].filter(Boolean).join(' | ') });
    const signedIn = content.includes('/auth/sign_out')
      || content.includes('data-testid="profile-image"')
      || content.includes("data-testid='profile-image'")
      || content.includes('id="profile-menu"')
      || /"(?:is)?_?logged_?in"\s*:\s*true/.test(content);
    const loginButton = /<button\b[^>]*>\s*(?:<[^>]+>\s*)*(?:log|sign)\s*in\b/i.test(content);
    const loginLink = /<a\b[^>]*>\s*(?:<[^>]+>\s*)*(?:log|sign)\s*in\b/i.test(content);
    const loginForm = /<form\b[^>]*action=["'][^"']*\/auth\/sign_in/i.test(content)
      || (/<form\b[^>]*id=["']new_user["']/i.test(content)
        && /name=["']user\[login\]["']/i.test(content)
        && /name=["']user\[password\]["']/i.test(content));
    const loginHeading = /<h1\b[^>]*>[\s\S]{0,200}?(?:log|sign)\s*in(?:\s+to)?[\s\S]{0,100}?nexus\s*mods/i.test(content);
    const loginSubmit = /<input\b[^>]*\btype=["']submit["'][^>]*\bvalue=["'](?:log|sign)\s*in["']/i.test(content)
      || /<input\b[^>]*\bvalue=["'](?:log|sign)\s*in["'][^>]*\btype=["']submit["']/i.test(content);
    const apiUnauthenticated = /"code"\s*:\s*"unauthenticated"/i.test(content);
    if (!signedIn) {
      if (apiUnauthenticated) return create('requires_login', detail('login signal: API "code":"unauthenticated"'));
      const weakReasons = [];
      if (loginButton) weakReasons.push('"Log in" button');
      if (loginLink) weakReasons.push('"Log in" link');
      if (loginForm) weakReasons.push('sign-in form');
      if (loginHeading) weakReasons.push('"Sign in to Nexus Mods" heading');
      if (loginSubmit) weakReasons.push('sign-in submit input');
      if (/(?:authentication required|not logged in)/i.test(content)) weakReasons.push('"authentication required"/"not logged in" text');
      if (content.includes('sign in to nexus mods')) weakReasons.push('"sign in to nexus mods" text');
      if (weakReasons.length && !isLiveDocumentSignedIn()) {
        return create('requires_login', detail(`login signal: ${weakReasons.join(', ')}`));
      }
    }
    const cloudflareChallenge = content.includes('just a moment')
      || content.includes('cf-chl-interstitial')
      || /id=["']challenge-form["']/i.test(content)
      || content.includes('cf-mitigated')
      || /attention required[^<]{0,80}cloudflare/i.test(content);
    if (cloudflareChallenge) {
      return create('cloudflare', detail('cloudflare challenge markup'));
    }
    if (content.includes('temporarily suspended')) {
      return create('account_suspended', detail('"temporarily suspended" text'));
    }
    if (content.includes('too many requests')) {
      return create('rate_limited', detail('"too many requests" text'));
    }
    return null;
  }

  function fromResponse({ status = 0, text = '', context = '', extra = '' } = {}) {
    const contentError = classifyContent(text, { status, context, extra });
    if (contentError) return contentError;
    const detail = (reason) => ({ status, context, technicalMessage: [reason, extra].filter(Boolean).join(' | ') });
    if (status === 401) return create('requires_login', detail('HTTP 401'));
    if (status === 404) return create('file_not_found', detail('HTTP 404'));
    if (status === 403) {
      return String(text || '').toLowerCase().includes('moderation')
        ? create('moderation_hold', detail('HTTP 403 + "moderation" in body'))
        : create('access_denied', detail('HTTP 403'));
    }
    if (status === 429) return create('rate_limited', detail('HTTP 429'));
    if (status >= 500) return create('server_error', detail(`HTTP ${status}`));
    if (!status) return create('network_error', detail('no HTTP status (network failure)'));
    return create('invalid_response', detail(`HTTP ${status}`));
  }

  function fromException(cause, { context = '' } = {}) {
    const technicalMessage = String(cause?.message || cause || '');
    const stack = String(cause?.stack || '');
    const name = String(cause?.name || '');
    if (name === 'AbortError' || /timed?\s*out/i.test(technicalMessage)) {
      return create('timeout', { context, technicalMessage, stack });
    }
    if (/extension context invalidated|message port closed/i.test(technicalMessage)) {
      return create('context_invalid', { context, technicalMessage, stack });
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return create('offline', { context, technicalMessage, stack });
    }
    return create('network_error', { context, technicalMessage, stack });
  }

  function normalizeTimeout(value) {
    const timeout = Number(value);
    if (!Number.isFinite(timeout) || timeout <= 0) return DEFAULT_TIMEOUT_MS;
    return Math.min(Math.max(Math.round(timeout), 1000), 120000);
  }

  function readRateLimitHeaders(response) {
    try {
      const raw = response?.headers?.get?.('Retry-After');
      if (!raw) return { retryAfterSeconds: null };
      const seconds = Number(raw);
      if (Number.isFinite(seconds) && seconds >= 0) return { retryAfterSeconds: Math.round(seconds) };
      const asDate = Date.parse(raw);
      if (!Number.isNaN(asDate)) return { retryAfterSeconds: Math.max(0, Math.round((asDate - Date.now()) / 1000)) };
      return { retryAfterSeconds: null };
    } catch (_) {
      return { retryAfterSeconds: null };
    }
  }

  async function request(url, options = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, context = 'Nexus request', signal = null } = {}) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timedOut = false;
    const timer = controller
      ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, normalizeTimeout(timeoutMs))
      : null;
    let onExternalAbort = null;
    if (controller && signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        onExternalAbort = () => controller.abort();
        signal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    try {
      const response = await fetch(url, { ...options, signal: controller?.signal || options.signal });
      let text = '';
      try {
        text = await response.text();
      } catch (cause) {
        return {
          ok: false,
          status: response.status || 0,
          text: '',
          finalUrl: response.url || String(url),
          error: fromException(cause, { context })
        };
      }

      const finalUrl = response.url || String(url);
      const rateLimit = readRateLimitHeaders(response);
      let redirectedToLogin = false;
      try {
        const parsedFinalUrl = new URL(finalUrl);
        redirectedToLogin = parsedFinalUrl.hostname === 'users.nexusmods.com'
          && /^\/auth\/sign_in(?:\/|$)/.test(parsedFinalUrl.pathname);
      } catch (_) {
        redirectedToLogin = false;
      }
      const respInfo = describeResponse(finalUrl, response.status, text);
      const semanticError = redirectedToLogin
        ? create('requires_login', { status: response.status || null, context, technicalMessage: `login signal: redirected to ${safeUrl(finalUrl)} | ${respInfo}` })
        : classifyContent(text, { status: response.status || null, context, extra: respInfo });
      if (semanticError) {
        return {
          ok: false,
          status: response.status || 0,
          text,
          finalUrl,
          rateLimit,
          error: semanticError
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          status: response.status || 0,
          text,
          finalUrl,
          rateLimit,
          error: fromResponse({ status: response.status, text, context, extra: respInfo })
        };
      }

      return {
        ok: true,
        status: response.status || 200,
        text,
        finalUrl,
        rateLimit,
        error: null
      };
    } catch (cause) {
      if (!timedOut && signal?.aborted) {
        return {
          ok: false,
          status: 0,
          text: '',
          finalUrl: String(url),
          error: normalize({ code: 'aborted', context })
        };
      }
      return {
        ok: false,
        status: 0,
        text: '',
        finalUrl: String(url),
        error: timedOut
          ? create('timeout', { context, technicalMessage: String(cause?.message || '') })
          : fromException(cause, { context })
      };
    } finally {
      if (timer) clearTimeout(timer);
      if (onExternalAbort) signal.removeEventListener('abort', onExternalAbort);
    }
  }

  function isBlocking(error) {
    return !!normalize(error).blocking;
  }

  function messageKeyFor(code, suffix) {
    const camel = String(code || 'request_failed')
      .split('_')
      .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
      .join('');
    return `err${camel.charAt(0).toUpperCase()}${camel.slice(1)}${suffix}`;
  }

  function displayText(error) {
    const normalized = normalize(error);
    const translate = globalThis.NXTK?.t;
    if (typeof translate !== 'function') {
      return { message: normalized.userMessage, recovery: normalized.recovery };
    }
    return {
      message: translate(messageKeyFor(normalized.code, 'Msg'), null, normalized.userMessage),
      recovery: normalized.recovery
        ? translate(messageKeyFor(normalized.code, 'Fix'), null, normalized.recovery)
        : ''
    };
  }

  function toLogMessage(error) {
    const { message, recovery } = displayText(error);
    return `${message} ${recovery}`.trim();
  }

  function openReportIssue(url = REPORT_ISSUE_URL) {
    const fallback = () => window.open(url, '_blank', 'noopener,noreferrer');
    try {
      const result = chrome.runtime?.sendMessage({ type: 'OPEN_REPORT_ISSUE', url });
      if (result && typeof result.catch === 'function') result.catch(fallback);
      else if (!result) fallback();
    } catch (_) {
      fallback();
    }
  }

  window.NexusExt.Errors = {
    DEFAULT_TIMEOUT_MS,
    create,
    normalize,
    classifyContent,
    fromException,
    request,
    isBlocking,
    toLogMessage,
    displayText,
    openReportIssue
  };
})();
