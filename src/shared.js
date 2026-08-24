(function () {
  'use strict';

  const SETTINGS_KEY = 'nxtk_settings';
  const ERROR_LOG_KEY = 'nxtk_error_log';
  const MAX_LOGGED_ERRORS = 50;
  const TOTAL_DOWNLOADS_KEY = 'nxtk_total_downloads';
  const RATING_PROMPT_KEY = 'nxtk_rating_prompted';
  const GITHUB_REPO_URL = 'https://github.com/thomasthanos/nexusmods-bypass';
  const ISSUE_NEW_URL = `${GITHUB_REPO_URL}/issues/new`;
  const REPORT_ISSUE_URL = `${GITHUB_REPO_URL}/issues/new/choose`;
  const MAX_ISSUE_URL_CHARS = 7000;

  const DEFAULTS = {
    AutoStartDownload: true,
    AutoCloseTab: true,
    SkipRequirements: true,
    ShowAlertsOnError: true,
    HandleArchivedFiles: true,
    HidePremiumUpsells: true,
    DebugLogs: false,
    DownloadFolder: 'NexusMods',
    CloseTabDelay: 3000,
    RequestTimeout: 30000,
    NDC_pauseBetweenDownload: 5,
    NDC_downloadSpeed: 3.2,
    ForceEnglish: false,
    NDC_downloadMethod: 0  
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const SENSITIVE_PARAM_NAMES = [
    'key',
    'expires',
    'user_id',
    'token',
    'access_token',
    'refresh_token',
    'auth',
    'authorization',
    'session',
    'session_id',
    'signature',
    'api_key',
    'download_key',
    'code',
    'state',
    'password',
    'cookie',
  ];
  const REDACTED = '[redacted]';
  const SENSITIVE_NAME_GROUP = SENSITIVE_PARAM_NAMES
    .slice()
    .sort((a, b) => b.length - a.length)
    .join('|');

  const SENSITIVE_PATTERNS = [
    new RegExp('\\b(' + SENSITIVE_NAME_GROUP + ')(=|%3D)([^&\\s"\'<>]+)', 'gi'),
    new RegExp('(["\'])(' + SENSITIVE_NAME_GROUP + ')\\1(\\s*:\\s*)(["\'])([^"\']*)\\4', 'gi'),
    new RegExp('\\b(' + SENSITIVE_NAME_GROUP + ')(\\s*:\\s*)([^,;}"\'<>\\r\\n]+)', 'gi'),
  ];

  function redactSensitiveValues(value) {
    let text = String(value ?? '');
    if (!text) return text;
    text = text.replace(SENSITIVE_PATTERNS[0], (_m, name, sep) => name + sep + REDACTED);
    text = text.replace(SENSITIVE_PATTERNS[1], (_m, q1, name, sep, q2) => q1 + name + q1 + sep + q2 + REDACTED + q2);
    text = text.replace(SENSITIVE_PATTERNS[2], (_m, name, sep) => name + sep + REDACTED);
    return text;
  }

  const URL_SHAPE = /^[a-z][a-z0-9+.-]*:\/\//i;

  function sanitizeUrlForReport(url) {
    const raw = String(url ?? '').trim();
    if (!raw) return '';
    if (!URL_SHAPE.test(raw)) return redactSensitiveValues(raw.split(/[?#]/)[0]).slice(0, 160);
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'nxm:') {
        return 'nxm://' + parsed.hostname + parsed.pathname + ' (query removed)';
      }
      const fileId = parsed.searchParams.get('file_id');
      const base = parsed.protocol + '//' + parsed.host + parsed.pathname;
      return base + (fileId && /^\d{1,12}$/.test(fileId) ? '?file_id=' + fileId : '');
    } catch (_) {
      return redactSensitiveValues(raw.split(/[?#]/)[0]).slice(0, 160);
    }
  }

  function sanitizeDiagnosticText(value, maxLength = 1500) {
    let text = String(value ?? '');
    if (!text) return text;
    text = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (match) => sanitizeUrlForReport(match));
    text = redactSensitiveValues(text);
    return text.slice(0, maxLength);
  }

  const DOWNLOAD_METHOD_VORTEX = 0;
  const DOWNLOAD_METHOD_BROWSER = 1;
  const MAX_DOWNLOAD_URL_CHARS = 2048;
  const NEXUS_SITE_HOSTS = ['nexusmods.com'];
  const NEXUS_FILE_HOSTS = ['nexusmods.com', 'nexus-cdn.com'];

  function normalizeHostname(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host.endsWith('.') ? host.slice(0, -1) : host;
  }

  function hostMatches(hostname, apexList) {
    const host = normalizeHostname(hostname);
    return apexList.some((apex) => host === apex || host.endsWith('.' + apex));
  }

  function validateDownloadTarget(url, { method = DOWNLOAD_METHOD_VORTEX } = {}) {
    const raw = String(url ?? '').trim();
    if (!raw) return { ok: false, detail: 'empty' };
    if (raw.length > MAX_DOWNLOAD_URL_CHARS) return { ok: false, detail: 'too-long' };

    let parsed;
    try {
      parsed = new URL(raw);
    } catch (_) {
      return { ok: false, detail: 'not-a-url' };
    }

    if (parsed.username || parsed.password) return { ok: false, detail: 'embedded-credentials' };

    if (method === DOWNLOAD_METHOD_VORTEX) {
      if (parsed.protocol !== 'nxm:') return { ok: false, detail: 'bad-protocol:' + parsed.protocol.replace(':', '') };
      const missing = ['key', 'expires', 'user_id'].filter((name) => !parsed.searchParams.get(name));
      if (missing.length) return { ok: false, detail: 'missing-nxm-params:' + missing.join(',') };
      return { ok: true, url: raw, hostname: normalizeHostname(parsed.hostname) };
    }

    if (parsed.protocol !== 'https:') return { ok: false, detail: 'bad-protocol:' + parsed.protocol.replace(':', '') };
    if (!hostMatches(parsed.hostname, NEXUS_FILE_HOSTS)) {
      return { ok: false, detail: 'host-not-allowed:' + normalizeHostname(parsed.hostname) };
    }
    return { ok: true, url: raw, hostname: normalizeHostname(parsed.hostname) };
  }

  function isSafeNexusPageUrl(url) {
    const raw = String(url ?? '').trim();
    if (!raw || raw.length > MAX_DOWNLOAD_URL_CHARS) return false;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'https:') return false;
      if (parsed.username || parsed.password) return false;
      return hostMatches(parsed.hostname, NEXUS_SITE_HOSTS);
    } catch (_) {
      return false;
    }
  }

  function recordError(error) {
    const entry = {
      at: Date.now(),
      code: String(error?.code || 'request_failed'),
      status: Number.isInteger(error?.status) ? error.status : null,
      context: sanitizeDiagnosticText(error?.context, 300),
      userMessage: String(error?.userMessage || ''),
      technicalMessage: sanitizeDiagnosticText(error?.technicalMessage, 600),
      stack: sanitizeDiagnosticText(error?.stack, 1500),
      url: typeof location !== 'undefined' && location?.href ? sanitizeUrlForReport(location.href) : ''
    };
    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage({ type: 'ERROR_LOG_APPEND', payload: { entry } }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {
    }
  }

  function getErrorLog() {
    return new Promise((resolve) => {
      try {
        if (!chrome?.runtime?.id) {
          resolve([]);
          return;
        }
        chrome.storage.local.get(ERROR_LOG_KEY, (result) => {
          if (chrome.runtime.lastError) {
            resolve([]);
            return;
          }
          resolve(Array.isArray(result?.[ERROR_LOG_KEY]) ? result[ERROR_LOG_KEY] : []);
        });
      } catch (_) {
        resolve([]);
      }
    });
  }

  function getStoredSettings() {
    return new Promise((resolve) => {
      try {
        if (!chrome?.runtime?.id) {
          resolve({ ...DEFAULTS });
          return;
        }
        chrome.storage.local.get(SETTINGS_KEY, (result) => {
          if (chrome.runtime.lastError) {
            resolve({ ...DEFAULTS });
            return;
          }
          resolve({ ...DEFAULTS, ...(result?.[SETTINGS_KEY] || {}) });
        });
      } catch (_) {
        resolve({ ...DEFAULTS });
      }
    });
  }

  function describeLoggedError(entry) {
    const lines = [];
    const status = entry.status ? ` (HTTP ${entry.status})` : '';
    lines.push(`[${new Date(entry.at).toLocaleString('en-GB')}] ${entry.code}${status}`);
    if (entry.context) lines.push(`    context: ${sanitizeDiagnosticText(entry.context, 300)}`);
    if (entry.userMessage) lines.push(`    ${entry.userMessage}`);
    if (entry.technicalMessage) lines.push(`    technical: ${sanitizeDiagnosticText(entry.technicalMessage, 600)}`);
    if (entry.stack) {
      lines.push(`    stack: ${sanitizeDiagnosticText(entry.stack, 1500).split('\n').join('\n           ')}`);
    }
    if (entry.url) lines.push(`    page: ${sanitizeUrlForReport(entry.url)}`);
    return lines;
  }

  const GREASE_BRAND = /not.*a.*brand/i;

  const UA_BROWSERS = [
    [/\bEdg(?:e|A|iOS)?\/([\d.]+)/, 'Microsoft Edge'],
    [/\bOPR\/([\d.]+)/, 'Opera'],
    [/\bVivaldi\/([\d.]+)/, 'Vivaldi'],
    [/\bFirefox\/([\d.]+)/, 'Firefox'],
    [/\bChrome\/([\d.]+)/, 'Chrome'],            
    [/\bVersion\/([\d.]+).*\bSafari\//, 'Safari']
  ];

  function parseUserAgent(ua) {
    let browser = '';
    for (const [pattern, name] of UA_BROWSERS) {
      const hit = ua.match(pattern);
      if (hit) { browser = `${name} ${hit[1]}`; break; }
    }
    let os = '';
    let hit;
    if ((hit = ua.match(/Windows NT ([\d.]+)/))) {
      os = hit[1] === '10.0' ? 'Windows 10 or 11' : `Windows NT ${hit[1]}`;
    } else if ((hit = ua.match(/Mac OS X ([\d_.]+)/))) {
      os = `macOS ${hit[1].replace(/_/g, '.')}`;
    } else if ((hit = ua.match(/Android ([\d.]+)/))) {
      os = `Android ${hit[1]}`;
    } else if (/CrOS/.test(ua)) os = 'ChromeOS';
    else if (/Linux|X11/.test(ua)) os = 'Linux';
    return { browser, os };
  }

  function describePlatform(platform, version) {
    if (!platform) return '';
    if (!version) return platform;
    if (platform !== 'Windows') return `${platform} ${version}`;
    const major = parseInt(String(version).split('.')[0], 10);
    if (!Number.isFinite(major)) return 'Windows';
    if (major >= 13) return `Windows 11 (${version})`;
    if (major >= 1) return `Windows 10 (${version})`;
    return `Windows 8.1 or older (${version})`;
  }

  async function describeBrowser() {
    if (typeof navigator === 'undefined') return { browser: '(unavailable)', ua: '' };
    const ua = String(navigator.userAgent || '');
    const parsed = parseUserAgent(ua);
    const out = { browser: parsed.browser, os: parsed.os, cpu: '', ua };

    const uad = navigator.userAgentData;
    if (!uad) return out;

    let hints = {};
    try {
      hints = await Promise.race([
        uad.getHighEntropyValues(['platformVersion', 'architecture', 'bitness', 'fullVersionList']),
        new Promise((resolve) => setTimeout(resolve, 500, null))
      ]) || {};
    } catch (_) { }

    const brands = (hints.fullVersionList || uad.brands || [])
      .filter((entry) => entry?.brand && !GREASE_BRAND.test(entry.brand));
    const product = brands.find((entry) => entry.brand !== 'Chromium') || brands[0];
    if (product) {
      out.browser = `${product.brand} ${product.version}`;
      const core = brands.find((entry) => entry.brand === 'Chromium');
      if (core && core.version !== product.version) out.browser += ` (Chromium ${core.version})`;
    }

    const platform = describePlatform(uad.platform, hints.platformVersion);
    if (platform) out.os = platform;
    if (hints.architecture) {
      out.cpu = hints.architecture + (hints.bitness ? ` ${hints.bitness}-bit` : '');
    }
    if (uad.mobile) out.cpu = out.cpu ? `${out.cpu}, mobile` : 'mobile';
    return out;
  }

  async function describeReportHeader(manifest, { includeUserAgent = true } = {}) {
    const { browser, os, cpu, ua } = await describeBrowser();
    const lines = [
      `Date:      ${new Date().toISOString()} (local: ${new Date().toLocaleString('en-GB')})`,
      `Extension: ${manifest.name} v${manifest.version}`,
      `Browser:   ${browser || '(unrecognized)'}`
    ];
    if (os) lines.push(`OS:        ${os}${cpu ? `, ${cpu}` : ''}`);

    let language = typeof navigator !== 'undefined' ? navigator.language || '' : '';
    try {
      const ui = chrome.i18n.getUILanguage();
      if (ui) language = language && ui !== language ? `${language} (UI: ${ui})` : ui;
    } catch (_) { }
    lines.push(`Language:  ${language || '(unknown)'}`);

    if (typeof location !== 'undefined' && location?.href) {
      lines.push(`Page:      ${sanitizeUrlForReport(location.href)}`);
    }
    if (includeUserAgent && ua) lines.push(`UA:        ${ua}`);
    return lines;
  }

  function describeCurrentError(currentError, stackLimit = 1500) {
    const lines = ['──────── Current error ────────'];
    lines.push(`Code:      ${currentError.code || 'request_failed'}`);
    if (Number.isInteger(currentError.status)) lines.push(`HTTP:      ${currentError.status}`);
    if (currentError.context) lines.push(`Context:   ${sanitizeDiagnosticText(currentError.context, 300)}`);
    lines.push(`Message:   ${currentError.userMessage || '(none)'}`);
    if (currentError.recovery) lines.push(`Recovery:  ${currentError.recovery}`);
    if (currentError.technicalMessage) {
      lines.push(`Technical: ${sanitizeDiagnosticText(currentError.technicalMessage, 600)}`);
    }
    if (currentError.stack) {
      lines.push('Stack:');
      sanitizeDiagnosticText(currentError.stack, stackLimit).split('\n').forEach((l) => lines.push(`    ${l}`));
    }
    return lines;
  }

  function describeSettings(cfg) {
    const lines = ['──────── Settings ────────'];
    for (const [key, value] of Object.entries(cfg)) {
      let line = `${key}: ${value}`;
      if (key === 'NDC_downloadMethod') {
        line += value === 0 ? ' (Vortex)' : value === 1 ? ' (Browser)' : '';
      }
      lines.push(line);
    }
    return lines;
  }

  function describePageContext() {
    try {
      if (typeof document === 'undefined' || typeof location === 'undefined') return null;
      if (!/(^|\.)nexusmods\.com$/.test(location.hostname)) return null;
      const has = (sel) => { try { return !!document.querySelector(sel); } catch (_) { return false; } };
      const newUi = has('.next-container') || has('[data-testid="user-link-avatar"]');
      const signOut = has('a[href*="/auth/sign_out"]');
      const profileMenu = has('#profile-menu, [data-testid="profile-image"]');
      const loginButton = Array.from(document.querySelectorAll('header button, header a, nav button, nav a'))
        .some((el) => /^\s*(?:log|sign)\s*in\s*$/i.test((el.textContent || '').trim()));
      return [
        '──────── Page context ────────',
        `Nexus UI:   ${newUi ? 'new (React / next-container)' : 'classic'}`,
        `Auth hints: sign_out=${signOut ? 'present' : 'absent'}, profile-menu=${profileMenu ? 'present' : 'absent'}, login-button=${loginButton ? 'present' : 'absent'}`
      ];
    } catch (_) {
      return null;
    }
  }

  async function buildBugReport(currentError = null) {
    const cfg = await getStoredSettings();
    const errors = await getErrorLog();
    const manifest = chrome.runtime.getManifest();

    const lines = [
      '════════ NEXUSMODS BYPASS — BUG REPORT ════════',
      ...await describeReportHeader(manifest)
    ];

    const pageContext = describePageContext();
    if (pageContext) {
      lines.push('');
      lines.push(...pageContext);
    }

    if (currentError) {
      lines.push('');
      lines.push(...describeCurrentError(currentError));
    }

    lines.push('');
    lines.push(...describeSettings(cfg));

    lines.push('');
    lines.push(`──────── Recent errors (${errors.length}) ────────`);
    if (!errors.length) {
      lines.push('(no errors recorded)');
    }
    for (const entry of errors) {
      lines.push('');
      lines.push(...describeLoggedError(entry));
    }

    lines.push('');
    lines.push('════════ END OF REPORT ════════');
    const report = lines.join('\n');
    return sanitizeDiagnosticText(report, report.length);
  }

  async function buildCompactBugReport(currentError = null, { maxEntries = 3, stackChars = 300 } = {}) {
    const cfg = await getStoredSettings();
    const errors = await getErrorLog();
    const manifest = chrome.runtime.getManifest();
    const recent = (maxEntries > 0 ? errors.slice(-maxEntries) : []).map((entry) => ({
      ...entry,
      stack: stackChars > 0 ? String(entry.stack || '').slice(0, stackChars) : ''
    }));

    const lines = await describeReportHeader(manifest, { includeUserAgent: false });

    const pageContext = describePageContext();
    if (pageContext) {
      lines.push('');
      lines.push(...pageContext);
    }

    if (currentError) {
      lines.push('');
      lines.push(...describeCurrentError(currentError, 300));
    }

    lines.push('');
    lines.push(...describeSettings(cfg));

    lines.push('');
    lines.push(`──────── Last ${recent.length} of ${errors.length} logged errors ────────`);
    if (!recent.length) lines.push('(no errors recorded)');
    for (const entry of recent) {
      lines.push('');
      lines.push(...describeLoggedError(entry));
    }
    const dropped = errors.length - recent.length;
    if (dropped > 0) {
      lines.push('');
      lines.push(`(${dropped} older log entr${dropped === 1 ? 'y was' : 'ies were'} left out so this fits the form. The complete report is on the reporter's clipboard.)`);
    }
    return lines.join('\n');
  }

  function buildIssueUrl(title, report) {
    const url = new URL(ISSUE_NEW_URL);
    url.searchParams.set('template', 'nexus_bug_report.yml');
    url.searchParams.set('title', title);
    url.searchParams.set('report', report);
    return url.href;
  }

  async function buildReportIssueUrl(currentError = null, { fullReport = null } = {}) {
    try {
      const title = currentError
        ? `[Bug] ${currentError.code || 'error'} — ${sanitizeDiagnosticText(currentError.userMessage, 60)}`
        : '[Bug] ';
      const fits = (report) => buildIssueUrl(title, report).length <= MAX_ISSUE_URL_CHARS;

      const full = fullReport || await buildBugReport(currentError);
      if (fits(full)) return { url: buildIssueUrl(title, full), complete: true };

      const steps = [
        { maxEntries: 12, stackChars: 900 },
        { maxEntries: 8, stackChars: 600 },
        { maxEntries: 5, stackChars: 300 },
        { maxEntries: 3, stackChars: 300 },
        { maxEntries: 2, stackChars: 0 },
        { maxEntries: 1, stackChars: 0 },
        { maxEntries: 0, stackChars: 0 }
      ];
      for (const step of steps) {
        const reduced = await buildCompactBugReport(currentError, step);
        if (fits(reduced)) return { url: buildIssueUrl(title, reduced), complete: false };
      }

      return { url: buildIssueUrl(title, ''), complete: false };
    } catch (_) {
      return { url: REPORT_ISSUE_URL, complete: false };
    }
  }

  function bumpTotalDownloads() {
    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage({ type: 'TOTAL_DOWNLOADS_INCREMENT', payload: {} }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) { }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
    }
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    } catch (_) {
      return false;
    }
  }

  let forceEnglish = false;

  function setForceEnglish(value) {
    forceEnglish = !!value;
  }

  try {
    if (chrome?.runtime?.id) {
      chrome.storage.local.get(SETTINGS_KEY, (result) => {
        if (chrome.runtime.lastError) return;
        const stored = result?.[SETTINGS_KEY];
        if (stored && 'ForceEnglish' in stored) setForceEnglish(stored.ForceEnglish);
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes?.[SETTINGS_KEY]) return;
        const next = changes[SETTINGS_KEY].newValue;
        setForceEnglish(next ? next.ForceEnglish : DEFAULTS.ForceEnglish);
      });
    }
  } catch (_) {
  }

  function t(key, substitutions = null, fallback = '') {
    if (forceEnglish) return fallback;
    try {
      const message = chrome.i18n.getMessage(key, substitutions || undefined);
      if (message) return message;
    } catch (_) {
    }
    return fallback;
  }

  function tPlural(baseKey, count, fallback = '', substitutions = null) {
    const n = Number(count) || 0;
    const args = substitutions || [String(n)];
    let category = 'other';
    try {
      const locale = chrome.i18n.getUILanguage ? chrome.i18n.getUILanguage() : 'en';
      category = new Intl.PluralRules(locale).select(n);
    } catch (_) {
      category = 'other';
    }
    return t(`${baseKey}_${category}`, args, '')
      || t(`${baseKey}_other`, args, '')
      || fallback;
  }

  const I18N_ATTRIBUTES = [
    ['[data-i18n-title]', 'i18nTitle', 'title'],
    ['[data-i18n-aria-label]', 'i18nAriaLabel', 'aria-label'],
    ['[data-i18n-placeholder]', 'i18nPlaceholder', 'placeholder']
  ];

  const bakedText = new WeakMap();
  const bakedAttrs = new WeakMap();

  function applyI18nTo(root = document) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    try {
      root.querySelectorAll('[data-i18n]').forEach((el) => {
        if (!bakedText.has(el)) bakedText.set(el, el.textContent);
        if (forceEnglish) {
          el.textContent = bakedText.get(el);
          return;
        }
        const message = t(el.dataset.i18n);
        if (message) el.textContent = message;
      });
      for (const [selector, datasetKey, attribute] of I18N_ATTRIBUTES) {
        root.querySelectorAll(selector).forEach((el) => {
          let saved = bakedAttrs.get(el);
          if (!saved) bakedAttrs.set(el, (saved = {}));
          if (!(attribute in saved)) saved[attribute] = el.getAttribute(attribute);
          if (forceEnglish) {
            if (saved[attribute] != null) el.setAttribute(attribute, saved[attribute]);
            return;
          }
          const message = t(el.dataset[datasetKey]);
          if (message) el.setAttribute(attribute, message);
        });
      }
    } catch (_) {
    }
  }

  globalThis.NXTK = {
    SETTINGS_KEY,
    TOTAL_DOWNLOADS_KEY,
    RATING_PROMPT_KEY,
    GITHUB_REPO_URL,
    ISSUE_NEW_URL,
    REPORT_ISSUE_URL,
    DEFAULTS,
    escapeHtml,
    sanitizeUrlForReport,
    sanitizeDiagnosticText,
    validateDownloadTarget,
    isSafeNexusPageUrl,
    recordError,
    buildBugReport,
    buildReportIssueUrl,
    bumpTotalDownloads,
    copyText,
    t,
    tPlural,
    setForceEnglish,
    applyI18nTo
  };
})();
