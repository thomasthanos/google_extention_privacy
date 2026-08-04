/* shared.js — single source of truth for constants, defaults, error logging
   and the bug-report builder. Loaded in the two contexts that can use it:
   - popup/popup.html via <script src="../shared.js">
   - content scripts as the first entry of the isolated-world group

   NOT the service worker. Edge failed before worker startup when this file was
   loaded as a second worker resource, so background.js carries its own copy of the
   small subset it needs — see the note at the top of that file. */
(function () {
  'use strict';

  const SETTINGS_KEY = 'nxtk_settings';
  const ERROR_LOG_KEY = 'nxtk_error_log';
  const MAX_LOGGED_ERRORS = 50;
  const TOTAL_DOWNLOADS_KEY = 'nxtk_total_downloads';
  const RATING_PROMPT_KEY = 'nxtk_rating_prompted';
  const GITHUB_REPO_URL = 'https://github.com/thomasthanos/google_extention_privacy';
  const ISSUE_NEW_URL = `${GITHUB_REPO_URL}/issues/new`;
  const REPORT_ISSUE_URL = `${GITHUB_REPO_URL}/issues/new/choose`;
  // GitHub answers 414 for URLs around ~8k chars; leave generous headroom
  // for the encoding overhead of the report text.
  const MAX_ISSUE_URL_CHARS = 7000;

  const DEFAULTS = {
    AutoStartDownload: true,
    AutoCloseTab: true,
    SkipRequirements: true,
    ShowAlertsOnError: true,
    HandleArchivedFiles: true,
    HidePremiumUpsells: true,
    DebugLogs: false,
    /* Suppresses the browser's own download UI. chrome.downloads.setUiOptions is
       PROFILE-WIDE, so this removes the download button and progress popup for every
       site, not just Nexus. Defaulted OFF after a report where the browser's download
       button silently disappeared for all downloads: nobody opts into a browser-wide
       change they did not ask for, and the symptom is impossible to trace back here.
       background.js clears the stored `true` that existing profiles carry. Keep in
       sync with the copy of DEFAULTS inside background.js. */
    HideDownloadBar: false,
    // Subfolder under the browser's Downloads directory, used only in Browser mode.
    DownloadFolder: 'NexusMods',
    CloseTabDelay: 3000,
    RequestTimeout: 30000,
    NDC_pauseBetweenDownload: 5,
    /* Vortex pacing baseline, in MB/s. Raised from 1.5 in 2.3.2: measured Nexus
       throughput is around 3 MB/s, so the old figure doubled every estimated wait
       (a 58 MB file asked for 44s instead of ~23s). Existing profiles carry an
       explicit stored copy, so background.js migrates the old default on update —
       keep all four definitions of this number in step (see LEGACY_SPEED_DEFAULT). */
    NDC_downloadSpeed: 3.2,
    // English regardless of browser language. Keep in sync with the DEFAULTS in background.js.
    ForceEnglish: false,
    NDC_downloadMethod: 0 // 0 = Vortex, 1 = Browser
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ===== Diagnostic sanitization =====
     Bug reports travel two public routes: the clipboard and a prefilled GitHub
     issue URL. Anything that reaches them must be free of session material. A
     signed Nexus download link carries key/expires/user_id, and an nxm:// hand-off
     carries the same, so URLs are the highest-risk field in the whole report. */
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
  // Longest-first so `access_token` is matched before `token` would eat its tail.
  const SENSITIVE_NAME_GROUP = SENSITIVE_PARAM_NAMES
    .slice()
    .sort((a, b) => b.length - a.length)
    .join('|');

  /* Value shapes covered, in order: query/`&`-delimited `k=v` (also matches the
     URL-encoded `%3D`/`%26` variants once decoded), JSON `"k":"v"`, and bare
     `k: v` as it appears in log lines and stack frames.
     The third value class must NOT exclude spaces: header shapes put a scheme word
     in front of the secret, so `Authorization: Bearer <jwt>` redacted only the word
     "Bearer" and published the token. It runs to the end of the line or the first
     structural delimiter instead; over-redacting a diagnostic is the safe direction
     when the destination is a public issue. Newlines stay excluded so one match
     cannot swallow the rest of a stack trace. */
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

  /* Keeps only protocol + host + path, plus `file_id` which is public and is the
     one query value that actually helps diagnose a report. Everything else in the
     query string is dropped rather than redacted, so an unanticipated token name
     cannot leak. nxm:// is handled explicitly: its host is the game domain and its
     whole query is credentials. */
  // `new URL()` accepts far more than real URLs: "Error: boom …" parses as scheme
  // `error:` and would be rewritten to a misleading "error://boom". Require an
  // explicit authority so free-form text falls through to the redact-only path.
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
      // Not parseable as a URL — drop everything from the first delimiter on.
      return redactSensitiveValues(raw.split(/[?#]/)[0]).slice(0, 160);
    }
  }

  /* For free-form diagnostic strings (technicalMessage, stack, context). Rewrites
     any embedded URL through sanitizeUrlForReport, then redacts leftover
     `name=value` pairs that were not inside a URL. */
  function sanitizeDiagnosticText(value, maxLength = 1500) {
    let text = String(value ?? '');
    if (!text) return text;
    text = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (match) => sanitizeUrlForReport(match));
    text = redactSensitiveValues(text);
    return text.slice(0, maxLength);
  }

  /* One policy object for every navigation that can start a download, so the allowlist
     cannot drift between ndc.js and nnw.js. Browser downloads land on the Nexus CDN, not
     nexusmods.com, so both hosts are allowed. Suffixes match with a leading dot so
     `evilnexusmods.com` cannot pass. */
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

  /* `detail` uses a fixed vocabulary and never embeds path, query or userinfo — it
     reaches a public GitHub issue URL. The ORIGINAL string is returned, never
     `parsed.href`: re-serialising can re-encode characters inside a signature. */
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

    // Browser download: an https downgrade on a signed CDN link is a real risk.
    if (parsed.protocol !== 'https:') return { ok: false, detail: 'bad-protocol:' + parsed.protocol.replace(':', '') };
    if (!hostMatches(parsed.hostname, NEXUS_FILE_HOSTS)) {
      return { ok: false, detail: 'host-not-allowed:' + normalizeHostname(parsed.hostname) };
    }
    return { ok: true, url: raw, hostname: normalizeHostname(parsed.hostname) };
  }

  /* Lighter check for navigating to a Nexus *page* (file page, requirements tab).
     Deliberately excludes the CDN: a page navigation should never target it. */
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

  /* Appends an error entry to a capped log in chrome.storage.local so every
     "Report a bug" button can copy a complete report. Never throws; near-
     duplicate entries within 2s (retries, normalize() round-trips) are
     skipped. */
  function recordError(error) {
    /* Sanitized at WRITE time, not at report time: once a raw URL or token is in
       chrome.storage.local it would survive into every future report, and the log
       is also readable by anyone who inspects extension storage. */
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
        // Reading lastError clears Chrome's "unchecked error" warning.
        void chrome.runtime.lastError;
      });
    } catch (_) {
      // chrome APIs unavailable (orphaned content script) — skip logging.
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

  /* Entries were already sanitized by recordError, but they are re-sanitized on the
     way out: an entry may predate this change, and defence in depth is cheap here. */
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

  /* A Chromium UA string names Mozilla, AppleWebKit, Chrome, Safari and Edg all at
     once, so pasting it raw tells a reader almost nothing. These build a plain
     "Microsoft Edge 141.0.3537.57 (Chromium 141)" line instead. Report text, so English. */
  const GREASE_BRAND = /not.*a.*brand/i;

  const UA_BROWSERS = [
    [/\bEdg(?:e|A|iOS)?\/([\d.]+)/, 'Microsoft Edge'],
    [/\bOPR\/([\d.]+)/, 'Opera'],
    [/\bVivaldi\/([\d.]+)/, 'Vivaldi'],
    [/\bFirefox\/([\d.]+)/, 'Firefox'],
    [/\bChrome\/([\d.]+)/, 'Chrome'],           // after the Chromium forks above
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
      // The UA string cannot tell 10 from 11; only the platformVersion hint can.
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
    // Windows 11 reports platformVersion 13 or above; 1-12 is Windows 10.
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
      /* This header used to be synchronous, so it could never stall the report.
         Cap the wait: a frozen tab (Edge Sleeping Tabs) must not leave "Report a bug"
         pending forever. On timeout the low-entropy brands below still name the browser.
         Permission policy can also refuse outright, hence the catch. */
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

  /* includeUserAgent is dropped by the compact report, which has a URL length budget. */
  async function describeReportHeader(manifest, { includeUserAgent = true } = {}) {
    const { browser, os, cpu, ua } = await describeBrowser();
    const lines = [
      `Date:      ${new Date().toISOString()} (local: ${new Date().toLocaleString('en-GB')})`,
      `Extension: ${manifest.name} v${manifest.version}`,
      `Browser:   ${browser || '(unrecognized)'}`
    ];
    if (os) lines.push(`OS:        ${os}${cpu ? `, ${cpu}` : ''}`);

    // The UI language is what chrome.i18n keys off, and it often differs from
    // navigator.language — worth stating outright on a report about wrong text.
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
      // Annotate the download method so reports are readable at a glance.
      if (key === 'NDC_downloadMethod') {
        line += value === 0 ? ' (Vortex)' : value === 1 ? ' (Browser)' : '';
      }
      lines.push(line);
    }
    return lines;
  }

  /* Best-effort page/auth context, meaningful only when the report is built from
     a Nexus content-script page (returns null in the popup/background where there
     is no Nexus DOM). Records ONLY booleans and the detected UI — never a
     username, avatar, cookie, or token — so it is safe for a public issue. */
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

  /* Builds the full diagnostic text report. Pass the error currently shown to
     the user (if any) so it appears in its own "Current error" section. */
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
    // Final pass over the assembled clipboard report: catches anything a future
    // section adds without going through the per-field sanitizers above.
    const report = lines.join('\n');
    return sanitizeDiagnosticText(report, report.length);
  }

  /* Reduced variant, used ONLY when the complete report will not fit in a URL.
     Detail is a parameter so buildReportIssueUrl can give up as little as possible:
     it steps down through progressively smaller variants instead of jumping straight
     to the smallest one. */
  async function buildCompactBugReport(currentError = null, { maxEntries = 3, stackChars = 300 } = {}) {
    const cfg = await getStoredSettings();
    const errors = await getErrorLog();
    const manifest = chrome.runtime.getManifest();
    // Newest entries: those describe the failure actually being reported.
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
    /* Only stated when something was genuinely left out. It used to be appended
       unconditionally, so even a report that was already complete told the reader to
       go and ask for a fuller one that did not exist. */
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
    // Matches the `id: report` textarea in .github/ISSUE_TEMPLATE/nexus_bug_report.yml.
    url.searchParams.set('report', report);
    return url.href;
  }

  /* Returns { url, complete } — `complete` says whether the ENTIRE report fitted, which
     decides whether the caller still needs the clipboard. Detail is given up a step at a
     time, oldest entries first: slicing the tail would drop the newest errors, i.e. the
     ones describing the failure being reported. */
  async function buildReportIssueUrl(currentError = null, { fullReport = null } = {}) {
    try {
      // userMessage is our own catalogue text, but the title lands in a public
      // issue URL, so it goes through the same redaction as the body.
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

      // Nothing fits — send the form empty rather than a mangled fragment.
      return { url: buildIssueUrl(title, ''), complete: false };
    } catch (_) {
      return { url: REPORT_ISSUE_URL, complete: false };
    }
  }

  /* Routed through the worker so racing tabs cannot lose increments. Not retried: a
     re-send after a dropped reply would double-count a cosmetic counter. */
  function bumpTotalDownloads() {
    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage({ type: 'TOTAL_DOWNLOADS_INCREMENT', payload: {} }, () => {
        // Reading lastError clears Chrome's "unchecked error" warning.
        void chrome.runtime.lastError;
      });
    } catch (_) { }
  }

  /* Copies text to the clipboard without the clipboardWrite permission:
     navigator.clipboard needs only a user gesture, and the hidden-textarea
     fallback covers contexts where the async API is unavailable. */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // Fall through to execCommand.
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

  /* Every call carries a baked English fallback, so a missing key or a dead chrome.i18n
     still renders real text. Message values are plain text — never put markup in
     messages.json; structural HTML and links stay in code. */
  /* chrome.i18n cannot be overridden, but every t() call already carries the English
     string as its fallback — so forcing English is just returning that argument early.
     A module-level boolean because t() is synchronous and runs during render. */
  let forceEnglish = false;

  function setForceEnglish(value) {
    forceEnglish = !!value;
  }

  /* Best-effort seeding plus a live listener; the explicit setForceEnglish() call from
     each entry point is what guarantees the value is set before the first render. */
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
    // Orphaned context — keep whatever the last known value was.
  }

  function t(key, substitutions = null, fallback = '') {
    if (forceEnglish) return fallback;
    try {
      const message = chrome.i18n.getMessage(key, substitutions || undefined);
      if (message) return message;
    } catch (_) {
      // Orphaned content script or no i18n — fall through.
    }
    return fallback;
  }

  /* chrome.i18n has no ICU plurals and one/other is not enough — Russian and Polish need
     few/many. Intl.PluralRules picks the suffix; falls back to _other, then English. */
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

  /* Applies localized text to a container. Extends the original [data-i18n] textContent
     sweep with attribute variants, so tooltips and accessibility text are translatable
     without hand-written getMessage calls at each site. */
  // [selector, dataset key, attribute to write]
  const I18N_ATTRIBUTES = [
    ['[data-i18n-title]', 'i18nTitle', 'title'],
    ['[data-i18n-aria-label]', 'i18nAriaLabel', 'aria-label'],
    ['[data-i18n-placeholder]', 'i18nPlaceholder', 'placeholder']
  ];

  /* The markup's English is snapshotted on first sweep. Without it a live ForceEnglish
     toggle cannot go back: t() returns '' per-node, the don't-blank guard skips the
     write, and an already translated node keeps its translation. */
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
      // Keep whatever the markup shipped with.
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
