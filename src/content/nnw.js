window.NexusExt = window.NexusExt || {};

(function () {
  'use strict';

  let cfg = {};
  let listenersAttached = false;
  let domEnhancementRun = 0;
  let premiumObserver = null;
  let premiumObserverTimer = null;
  let closeTabTimer = null;
  let closeTabToast = null;
  let fallbackWatchdogTimer = null;
  let fallbackWatchdogDeadline = 0;
  let downloadAttemptSequence = 0;
  let nativeFallbackKey = '';
  let nativeFallbackIsNMM = null;
  let nativeFallbackAutoStartPending = false;
  let nativeFallbackAutoStarted = false;
  const Errors = NexusExt.Errors;
  const Auth = NexusExt.Auth;

  const CLOUDFLARE_FALLBACK_KEY = 'nxtk_cloudflare_native_fallback';
  const CLOUDFLARE_FALLBACK_TTL_MS = 5 * 60 * 1000;
  const FALLBACK_WATCHDOG_MS = 12000;
  const FALLBACK_WATCHDOG_MAX_MS = 3 * 60 * 1000;

  const LOG_BADGE = 'background:#d98f40;color:#191106;font-weight:700;padding:1px 6px;border-radius:3px';
  const LOG_STYLES = {
    debug: 'color:#8a8f98',
    info: 'color:#4da3ff',
    warn: 'color:#e8b339;font-weight:600',
    error: 'color:#ff6b6b;font-weight:600'
  };

  function emitLog(level, args) {
    const fn = level === 'error' ? console.error
      : level === 'warn' ? console.warn
        : level === 'info' ? console.info
          : console.debug;
    fn('%cNexusMods Bypass%c ', LOG_BADGE, LOG_STYLES[level], ...args);
  }

  const Logger = {
    debug: (...args) => { if (cfg.DebugLogs) emitLog('debug', args); },
    info: (...args) => { if (cfg.DebugLogs) emitLog('info', args); },
    warn: (...args) => { if (cfg.DebugLogs) emitLog('warn', args); },
    error: (...args) => emitLog('error', args)
  };

  function safeSendMessage(message) {
    try {
      if (!chrome.runtime?.id) return;
      const result = chrome.runtime.sendMessage(message);
      if (result && typeof result.catch === 'function') result.catch(() => undefined);
    } catch (_) {
    }
  }

  const gameIdCache = new Map();

  function getGameDomainFromUrl(url = location.href) {
    try {
      const pathname = new URL(url, location.href).pathname;
      return pathname.split('/').filter(Boolean)[0] || '';
    } catch (_) {
      return '';
    }
  }

  function extractGameIdFromText(text) {
    if (!text) return '';
    const inputText = String(text);
    const patterns = [
      /data-game-id=["'](\d+)["']/i,
      /["']game[_-]?id["']\s*:\s*["']?(\d+)["']?/i,
      /gameId["']?\s*[:=]\s*["']?(\d+)["']?/i
    ];
    for (const pattern of patterns) {
      const match = inputText.match(pattern);
      if (match) return match[1];
    }
    return '';
  }

  function getGameId(url = location.href) {
    const domain = getGameDomainFromUrl(url);
    const nodes = [
      document.getElementById('section'),
      ...Array.from(document.querySelectorAll('[data-game-id]'))
    ].filter(Boolean);

    for (const node of nodes) {
      const value = node.dataset?.gameId;
      if (value) {
        if (domain) gameIdCache.set(domain, value);
        return value;
      }
    }

    if (domain && gameIdCache.has(domain)) return gameIdCache.get(domain);
    return '';
  }

  function rememberGameId(gameId, url = location.href) {
    const domain = getGameDomainFromUrl(url);
    if (domain && gameId) gameIdCache.set(domain, String(gameId));
  }

  const MOD_PAGE_PATTERN = /\/mods\/\d+$/;
  function isModPage() {
    return MOD_PAGE_PATTERN.test(location.pathname);
  }

  function getModPagePath(value = location.href) {
    try {
      const parsed = new URL(value, location.href);
      const pathname = parsed.pathname.replace(/\/$/, '');
      if (!MOD_PAGE_PATTERN.test(pathname)) return '';
      return `${parsed.origin}${pathname}`;
    } catch (_) {
      return '';
    }
  }

  function getCurrentFileId() {
    try {
      const fileId = new URLSearchParams(location.search).get('file_id') || '';
      return /^\d{1,12}$/.test(fileId) ? fileId : '';
    } catch (_) {
      return '';
    }
  }

  function getCurrentFileKey() {
    const modPage = getModPagePath();
    const fileId = getCurrentFileId();
    return modPage && fileId ? `${modPage}?file_id=${fileId}` : '';
  }

  function isCloudflareChallengeDocument() {
    try {
      if (/just a moment|attention required|checking your browser|security verification/i.test(document.title || '')) {
        return true;
      }
      if (document.documentElement?.classList?.contains('cf-chl-interstitial')) return true;
      return !!document.querySelector('#challenge-form');
    } catch (_) {
      return false;
    }
  }

  function clearStoredCloudflareFallback() {
    try {
      sessionStorage.removeItem(CLOUDFLARE_FALLBACK_KEY);
    } catch (_) {
    }
  }

  function readStoredCloudflareFallback() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(CLOUDFLARE_FALLBACK_KEY) || 'null');
      if (!parsed || parsed.expiresAt < Date.now() || !parsed.modPage) {
        clearStoredCloudflareFallback();
        return null;
      }
      return parsed;
    } catch (_) {
      clearStoredCloudflareFallback();
      return null;
    }
  }

  function rememberCloudflareFallback(targetUrl, fileId, isNMM, autoStartPending = cfg.AutoStartDownload) {
    try {
      const target = new URL(targetUrl, location.href);
      const modPage = getModPagePath(target.href) || getModPagePath(location.href);
      if (!modPage) return;
      const targetFileId = target.searchParams.get('file_id');
      const expectedFileId = /^\d{1,12}$/.test(targetFileId || '')
        ? targetFileId
        : getModPagePath(target.href) && /^\d{1,12}$/.test(String(fileId || ''))
          ? String(fileId)
          : '';
      sessionStorage.setItem(CLOUDFLARE_FALLBACK_KEY, JSON.stringify({
        modPage,
        fileId: expectedFileId,
        isNMM: !!isNMM,
        autoStartPending: !!autoStartPending,
        expiresAt: Date.now() + CLOUDFLARE_FALLBACK_TTL_MS
      }));
    } catch (_) {
    }
  }

  function setStoredCloudflareAutoStartPending(pending) {
    nativeFallbackAutoStartPending = !!pending;
    try {
      const marker = readStoredCloudflareFallback();
      if (!marker) return;
      marker.autoStartPending = !!pending;
      sessionStorage.setItem(CLOUDFLARE_FALLBACK_KEY, JSON.stringify(marker));
    } catch (_) {
    }
  }

  function syncNativeFallbackState() {
    const currentKey = getCurrentFileKey();
    if (nativeFallbackKey && nativeFallbackKey === currentKey) return true;

    cancelFallbackWatchdog();
    nativeFallbackKey = '';
    nativeFallbackIsNMM = null;
    nativeFallbackAutoStartPending = false;
    nativeFallbackAutoStarted = false;
    const marker = readStoredCloudflareFallback();
    if (!marker || !currentKey) return false;

    const modPage = getModPagePath();
    const fileId = getCurrentFileId();
    if (marker.modPage !== modPage || (marker.fileId && marker.fileId !== fileId)) {
      clearStoredCloudflareFallback();
      return false;
    }

    nativeFallbackKey = currentKey;
    nativeFallbackIsNMM = typeof marker.isNMM === 'boolean' ? marker.isNMM : null;
    nativeFallbackAutoStartPending = marker.autoStartPending !== false;
    armFallbackWatchdog();
    return true;
  }

  function isNativeFallbackActive() {
    const currentKey = getCurrentFileKey();
    return !!currentKey && nativeFallbackKey === currentKey;
  }

  function cancelScheduledTabClose() {
    if (closeTabToast) {
      try { closeTabToast(); } catch (_) { }
      closeTabToast = null;
    }
    if (closeTabTimer === null) return;
    clearTimeout(closeTabTimer);
    closeTabTimer = null;
  }

  /* The fallback hands control back to Nexus's own download button. If that button never appears
     — a still-challenged page, a layout the selectors do not know, a disabled control — every
     entry point short-circuits on isNativeFallbackActive() and the extension goes quiet with
     nothing on screen. This gives that state a deadline and a visible ending. */
  function cancelFallbackWatchdog() {
    fallbackWatchdogDeadline = 0;
    if (fallbackWatchdogTimer === null) return;
    clearTimeout(fallbackWatchdogTimer);
    fallbackWatchdogTimer = null;
  }

  function clearNativeFallbackState() {
    cancelFallbackWatchdog();
    clearStoredCloudflareFallback();
    nativeFallbackKey = '';
    nativeFallbackIsNMM = null;
    nativeFallbackAutoStartPending = false;
    nativeFallbackAutoStarted = false;
  }

  function abandonNativeFallback(reason) {
    if (!isNativeFallbackActive()) {
      cancelFallbackWatchdog();
      return;
    }
    const wasNMM = nativeFallbackIsNMM;
    clearNativeFallbackState();
    Logger.warn('Cloudflare fallback gave up:', reason);

    try {
      setupSlowDownloadIntercept();
    } catch (cause) {
      Logger.warn('Could not restore the download interceptors:', cause);
    }

    NXTK.setActivity?.({ trigger: 'fallback', method: 'native', fallbackActive: true });
    handleError(null, Errors.create('cloudflare', {
      context: 'Cloudflare fallback',
      technicalMessage: `native download control unavailable after ${FALLBACK_WATCHDOG_MS}ms | ${reason} | method=${wasNMM ? 'vortex' : 'browser'}`
    }));
  }

  function armFallbackWatchdog({ extend = false } = {}) {
    const deadline = extend && fallbackWatchdogDeadline
      ? fallbackWatchdogDeadline
      : Date.now() + FALLBACK_WATCHDOG_MAX_MS;
    cancelFallbackWatchdog();
    if (!nativeFallbackAutoStartPending) return;
    fallbackWatchdogDeadline = deadline;

    fallbackWatchdogTimer = setTimeout(() => {
      fallbackWatchdogTimer = null;
      if (!isNativeFallbackActive() || nativeFallbackAutoStarted) return;
      if (!nativeFallbackAutoStartPending) return;

      if (isCloudflareChallengeDocument() && Date.now() < fallbackWatchdogDeadline) {
        Logger.info('Cloudflare verification still on screen; waiting for you to complete it.');
        armFallbackWatchdog({ extend: true });
        return;
      }
      abandonNativeFallback(isCloudflareChallengeDocument()
        ? 'Cloudflare verification was never completed'
        : 'native download control was never found');
    }, FALLBACK_WATCHDOG_MS);
  }

  function beginDownloadAttempt() {
    cancelScheduledTabClose();
    downloadAttemptSequence += 1;
    return downloadAttemptSequence;
  }

  function invalidateDownloadAttempts() {
    cancelScheduledTabClose();
    downloadAttemptSequence += 1;
  }

  function waitForDomSettled({ root = document.getElementById('mainContent') || document.body, quietMs = 500, timeoutMs = 4000 } = {}) {
    return new Promise((resolve) => {
      if (!root) {
        resolve();
        return;
      }

      let done = false;
      let quietTimer = null;
      let timeoutTimer = null;

      const finish = () => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearTimeout(quietTimer);
        clearTimeout(timeoutTimer);
        resolve();
      };

      const armQuietTimer = () => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietMs);
      };

      const observer = new MutationObserver(() => {
        armQuietTimer();
      });

      observer.observe(root, { childList: true, subtree: true, characterData: true });
      armQuietTimer();
      timeoutTimer = setTimeout(finish, timeoutMs);
    });
  }

  function scheduleDomEnhancements() {
    const runId = ++domEnhancementRun;
    waitForDomSettled().then(() => {
      if (runId !== domEnhancementRun) return;
      upsellBlocker();
      archivedFileHandler();
    }).catch((cause) => Logger.warn('Could not apply page enhancements:', cause));
  }

  let decodeTextarea = null;

  function decodeDownloadUrlValue(value) {
    if (!value) return '';
    if (!decodeTextarea) decodeTextarea = document.createElement('textarea');
    decodeTextarea.innerHTML = String(value).trim();
    return decodeTextarea.value
      .replace(/\\\//g, '/')
      .replace(/&amp;/g, '&')
      .replace(/\\u0026/g, '&')
      .trim();
  }

  function findJsonDownloadUrl(value, source = 'json') {
    if (!value || typeof value !== 'object') return null;

    const directKeys = ['url', 'downloadUrl', 'vortexDownloadUrl', 'nmmDownloadUrl'];
    for (const key of directKeys) {
      if (typeof value[key] === 'string' && value[key].trim()) {
        return { url: decodeDownloadUrlValue(value[key]), source: `${source}-${key}` };
      }
    }

    for (const key of ['data', 'html', 'links', 'downloadLinks']) {
      const nested = value[key];
      if (!nested) continue;
      if (typeof nested === 'string') {
        const extracted = parseDownloadURLFromResponse(nested);
        if (extracted) return { ...extracted, source: `${source}-${key}-${extracted.source}` };
      } else {
        const extracted = findJsonDownloadUrl(nested, `${source}-${key}`);
        if (extracted) return extracted;
      }
    }

    return null;
  }

  const NXM_RAW_PATTERN = /nxm:(?:\\?\/){2}[^\s"'<>]+/i;

  function parseNxmDownloadLink(text) {
    if (!text) return null;
    const match = String(text).match(NXM_RAW_PATTERN);
    if (!match) return null;

    const url = decodeDownloadUrlValue(match[0]);
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) return null;

    const params = new URLSearchParams(url.slice(queryIndex + 1));
    if (!params.get('key') || !params.get('expires') || !params.get('user_id')) return null;
    return url;
  }

  function isValidNxmUrl(url) {
    return parseNxmDownloadLink(url) === decodeDownloadUrlValue(url);
  }

  function extractDownloadUrlFrom(inputText) {
    try {
      const json = JSON.parse(inputText);
      const jsonResult = findJsonDownloadUrl(json);
      if (jsonResult) return jsonResult;
    } catch (_) {}

    const nxmUrl = parseNxmDownloadLink(inputText);
    if (nxmUrl) return { url: nxmUrl, source: 'nxm-url' };

    const match = inputText.match(/id=["']dl_link["'][^>]*value=["']([^"']+)["']/i);
    if (match) return { url: decodeDownloadUrlValue(match[1]), source: 'dl_link-value' };
    const dataDownloadUrlMatch = inputText.match(/data-download-url=["']([^"']+)["']/i);
    if (dataDownloadUrlMatch) return { url: decodeDownloadUrlValue(dataDownloadUrlMatch[1]), source: 'data-download-url' };
    const constDownloadUrlMatch = inputText.match(/const\s+downloadUrl\s*=\s*["']([^"']+)["']/i);
    if (constDownloadUrlMatch) return { url: decodeDownloadUrlValue(constDownloadUrlMatch[1]), source: 'const-downloadUrl' };
    return null;
  }

  function parseDownloadURLFromResponse(text) {
    if (!text) return null;
    const raw = String(text);
    const fromRaw = extractDownloadUrlFrom(raw);
    if (fromRaw) return fromRaw;
    const decoded = decodeDownloadUrlValue(raw);
    return decoded && decoded !== raw ? extractDownloadUrlFrom(decoded) : null;
  }

  async function getDownloadUrl({
    fileId,
    gameId,
    isNMM,
    href,
    prefetchedText = null,
    prefetchedFinalUrl = null,
    prefetchedStatus = 0,
    prefetchedError = null,
    signal = null
  } = {}) {
    if (!fileId && !href) return { url: null, error: Errors.create('missing_file') };

    const filePageUrl = href || `${location.origin}${location.pathname}?tab=files&file_id=${encodeURIComponent(fileId)}`;
    let resolvedGameId = gameId || getGameId(filePageUrl);
    const endpoint = new URL('/Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl', filePageUrl).href;
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest'
    };
    const requestOptions = (context) => ({
      timeoutMs: cfg.RequestTimeout || Errors.DEFAULT_TIMEOUT_MS,
      context,
      signal
    });

    let pendingPrefetch = (prefetchedText === null && !prefetchedError) ? null : {
      ok: !prefetchedError && prefetchedStatus >= 200 && prefetchedStatus < 400,
      status: prefetchedStatus || 0,
      text: prefetchedText || '',
      finalUrl: prefetchedFinalUrl || href || '',
      error: prefetchedError || null
    };
    let prefetchHref = '';
    try {
      prefetchHref = href ? new URL(href, location.href).href : '';
    } catch (_) {
      pendingPrefetch = null;
    }

    const takePrefetch = (absoluteUrl) => {
      if (!pendingPrefetch || absoluteUrl !== prefetchHref) return null;
      const response = pendingPrefetch;
      pendingPrefetch = null;
      return response;
    };

    const fetchText = async (url, { ajax = true, context = 'Loading Nexus download page' } = {}) => {
      const absoluteUrl = new URL(url, location.href).href;
      const reused = takePrefetch(absoluteUrl);
      if (reused) {
        Logger.debug('Reusing prefetched response for', context);
        return reused;
      }
      return Errors.request(absoluteUrl, {
        credentials: 'include',
        headers: ajax ? { 'X-Requested-With': 'XMLHttpRequest' } : {}
      }, requestOptions(context));
    };

    const fetchGeneratedDownloadUrl = async (nmm = false) => {
      if (!fileId) return { url: null, text: '', error: Errors.create('missing_file') };

      const body = `fid=${encodeURIComponent(fileId)}&game_id=${encodeURIComponent(resolvedGameId || '')}${nmm ? '&nmm=1' : ''}`;
      const response = await Errors.request(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers,
        body
      }, requestOptions(nmm ? 'Generating Vortex download link' : 'Generating download link'));

      if (!response.ok) {
        Logger.warn('GenerateDownloadUrl failed:', response.error);
        return { url: null, text: response.text, error: response.error };
      }

      const responseGameId = extractGameIdFromText(response.text);
      if (responseGameId) {
        resolvedGameId = responseGameId;
        rememberGameId(responseGameId, filePageUrl);
      }

      const nxmUrl = parseNxmDownloadLink(response.text);
      if (nxmUrl) return { url: nxmUrl, text: response.text, error: null };

      const extracted = parseDownloadURLFromResponse(response.text);
      if (extracted?.url) return { url: extracted.url, text: response.text, error: null };
      return { url: null, text: response.text, error: null };
    };

    const resolveApiFileUrl = async (url) => {
      let apiUrl = new URL(url, location.href).href;
      if (isNMM && !apiUrl.includes('nmm=1')) {
        apiUrl += apiUrl.includes('?') ? '&nmm=1' : '?nmm=1';
      }

      const response = await fetchText(apiUrl, { context: 'Resolving Nexus API download link' });
      if (!response.ok) return { url: null, error: response.error };

      const fromFinalUrl = parseNxmDownloadLink(response.finalUrl);
      if (fromFinalUrl) return { url: fromFinalUrl };
      if (!isNMM && response.finalUrl && response.finalUrl !== apiUrl && !response.finalUrl.includes('/api/files/')) {
        return { url: response.finalUrl };
      }

      const fromBodyNxm = parseNxmDownloadLink(response.text);
      if (fromBodyNxm) return { url: fromBodyNxm };

      const extracted = parseDownloadURLFromResponse(response.text);
      if (extracted?.url) {
        const nxmUrl = parseNxmDownloadLink(extracted.url);
        if (isNMM && nxmUrl) return { url: nxmUrl };
        if (!isNMM) return { url: extracted.url };
      }

      return { url: null, error: Errors.create(isNMM ? 'no_nmm_link' : 'no_download_url') };
    };

    let isApiFileHref = false;
    try {
      isApiFileHref = !!href && new URL(href, location.href).pathname.includes('/api/files/');
    } catch (_) {
      return { url: null, error: Errors.create('invalid_response', { context: 'Reading download link' }) };
    }

    if (isApiFileHref) {
      const result = await resolveApiFileUrl(href);
      if (result.url || result.error) return result;
    }

    if (isNMM && href) {
      const firstResponse = await fetchText(href, { context: 'Loading Vortex download page' });
      let latestError = firstResponse.error;
      Logger.info('Fetching NMM download URL');

      if (firstResponse.ok) {
        const firstResponseGameId = extractGameIdFromText(firstResponse.text);
        if (firstResponseGameId) {
          resolvedGameId = firstResponseGameId;
          rememberGameId(firstResponseGameId, filePageUrl);
        }
        const link = parseNxmDownloadLink(firstResponse.finalUrl) || parseNxmDownloadLink(firstResponse.text);
        if (link) return { url: link };

        const extracted = parseDownloadURLFromResponse(firstResponse.text);
        if (extracted?.url) {
          const nxmUrl = parseNxmDownloadLink(extracted.url);
          if (nxmUrl) return { url: nxmUrl };
          if (extracted.url.includes('/api/files/')) {
            const result = await resolveApiFileUrl(extracted.url);
            if (result.url) return result;
            latestError = result.error || latestError;
          }
        }

        if (/ModRequirementsPopUp/.test(href)) {
          const downloadHrefMatch = firstResponse.text.match(/href=["']([^"']*?(?:file_id|\/api\/files\/)[^"']*?)["']/i);
          if (downloadHrefMatch) {
            const downloadPageUrl = new URL(decodeDownloadUrlValue(downloadHrefMatch[1]), location.href).href;
            if (downloadPageUrl.includes('/api/files/')) {
              const result = await resolveApiFileUrl(downloadPageUrl);
              if (result.url) return result;
              latestError = result.error || latestError;
            }
            const downloadPageResponse = await fetchText(downloadPageUrl, { context: 'Loading requirement download page' });
            if (downloadPageResponse.ok) {
              const link2 = parseNxmDownloadLink(downloadPageResponse.finalUrl) || parseNxmDownloadLink(downloadPageResponse.text);
              if (link2) return { url: link2 };
            } else {
              latestError = downloadPageResponse.error || latestError;
            }
          }
        }
      }

      if (latestError && Errors.isBlocking(latestError)) return { url: null, error: latestError };

      const generated = await fetchGeneratedDownloadUrl(true);
      const generatedNxm = parseNxmDownloadLink(generated?.url);
      if (generatedNxm) return { url: generatedNxm };
      return { url: null, error: generated?.error || latestError || Errors.create('no_nmm_link') };
    }

    const fetchFilePageFallback = async () => {
      const pageResponse = await fetchText(filePageUrl, {
        ajax: false,
        context: 'Loading manual download page'
      });
      if (!pageResponse.ok) return { url: null, error: pageResponse.error };

      const pageGameId = extractGameIdFromText(pageResponse.text);
      if (pageGameId) {
        resolvedGameId = pageGameId;
        rememberGameId(pageGameId, filePageUrl);
      }
      const extracted = parseDownloadURLFromResponse(pageResponse.text);
      if (extracted) {
        Logger.info('Manual download URL found from file page:', extracted.source);
        return { url: extracted.url };
      }
      return { url: null, error: Errors.create('no_download_url', { context: 'Reading manual download page' }) };
    };

    const attemptFetch = async (attempt, didPageFallback = false, lastError = null) => {
      const generated = await fetchGeneratedDownloadUrl(false);
      if (generated?.url) {
        Logger.info('Manual download URL found from GenerateDownloadUrl');
        return { url: generated.url };
      }

      let latestError = generated?.error || lastError;
      if (latestError && Errors.isBlocking(latestError)) return { url: null, error: latestError };

      if (!didPageFallback) {
        const fallbackResult = await fetchFilePageFallback();
        if (fallbackResult.url) return fallbackResult;
        latestError = fallbackResult.error || latestError;
        if (latestError && Errors.isBlocking(latestError)) return { url: null, error: latestError };
      }

      if (attempt < 2 && (!latestError || latestError.retryable)) {
        await new Promise(resolve => setTimeout(resolve, 500));
        return attemptFetch(attempt + 1, true, latestError);
      }

      return { url: null, error: latestError || Errors.create('no_download_url') };
    };
    return attemptFetch(1);
  }

  async function normalizeDownloadUrl(url, isNMM, depth = 0) {
    if (!url) return null;
    const decodedUrl = decodeDownloadUrlValue(url);

    try {
      const parsed = new URL(decodedUrl, location.href);
      const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
      const isNexusHost = host === 'nexusmods.com' || host.endsWith('.nexusmods.com');
      if (depth < 3 && isNexusHost && (parsed.searchParams.has('file_id') || parsed.pathname.includes('/api/files/'))) {
        const fileId = parsed.searchParams.get('file_id') || parsed.searchParams.get('id') || parsed.pathname.match(/\/api\/files\/(\d+)/)?.[1];
        const resolved = await getDownloadUrl({
          fileId,
          gameId: getGameId(parsed.href),
          isNMM,
          href: parsed.href
        });
        if (resolved?.url && resolved.url !== decodedUrl) {
          return normalizeDownloadUrl(resolved.url, isNMM, depth + 1);
        }
      }
    } catch (_) {}

    if (isNMM && !isValidNxmUrl(decodedUrl)) return null;
    return decodedUrl;
  }

  function setButtonState(button, state, message) {
    const textElement = button.querySelector('span.flex-label, span') || button;
    if (!button._nxtkOriginalButtonState) {
      button._nxtkOriginalButtonState = {
        textElement,
        text: textElement.innerText,
        color: button.style.color
      };
    }
    const stateConfig = {
      waiting: { text: message || NXTK.t('btnStatePleaseWait', null, 'Please Wait...'), color: 'orange' },
      downloading: { text: NXTK.t('btnStateDownloading', null, 'Downloading!'), color: '#3dbb5e' },
      sent: { text: NXTK.t('toastSentToVortex', null, 'Sent to Vortex'), color: '#3dbb5e' },
      error: { text: message || NXTK.t('btnStateError', null, 'Error'), color: '#e04040' }
    };
    const config = stateConfig[state] || stateConfig.error;
    textElement.innerText = config.text;
    button.style.color = config.color;
  }

  function restoreButtonState(button) {
    const original = button?._nxtkOriginalButtonState;
    if (!original) return;
    if (original.textElement?.isConnected) original.textElement.innerText = original.text;
    button.style.color = original.color;
    delete button._nxtkOriginalButtonState;
  }

  function inferBrowserDownloadName(url, fileId) {
    let urlName = '';
    try {
      urlName = decodeURIComponent(new URL(url).pathname.split('/').pop() || '').trim();
    } catch (_) {}

    if (/\.(?:zip|7z|rar|tar|gz|tgz|bz2|tbz2|xz|txz|lzma|exe|msi|jar|fomod|omod|txt|pdf|json|xml|ini|cfg|esp|esm|esl|dll)$/i.test(urlName)) {
      return urlName;
    }
    const pageTitle = String(
      document.querySelector('h1')?.textContent
      || document.title.split(/\s+(?:at|on)\s+Nexus Mods/i)[0]
      || 'nexus-mod'
    ).replace(/\s+/g, ' ').trim();
    const idSuffix = fileId ? `-${fileId}` : '';
    return `${pageTitle || 'nexus-mod'}${idSuffix}`;
  }

  async function startManagedFileDownload(url, fileId) {
    try {
      const settings = await NexusExt.Storage.getSettings();
      const reply = await NexusExt.Storage.sendDownloadCommand('DOWNLOAD_START', {
        url,
        folder: settings.DownloadFolder ?? '',
        filename: inferBrowserDownloadName(url, fileId),
        fallbackExtension: '.zip'
      });
      if (reply?.ok) return true;
      if (reply?.error) Logger.warn('Managed download failed:', reply.error);
      return false;
    } catch (cause) {
      Logger.warn('Managed download failed:', cause);
      return false;
    }
  }

  /* Files the extension has proven it cannot resolve on its own — manual-download-only, off-site,
     archived or otherwise not available through GenerateDownloadUrl. The click interceptor is
     capture-phase and calls stopImmediatePropagation, so before this existed a failed resolution left
     the user with a dead button: Nexus's own handler never ran, and every further click was swallowed
     the same way. The error's own recovery text says "open the file page and download manually",
     which was impossible. Once a file is in here, its controls are handed back to Nexus untouched. */
  const nativePassthroughFiles = new Set();

  function allowNativeDownload(fileId) {
    const key = String(fileId || '');
    if (key) nativePassthroughFiles.add(key);
  }

  function shouldPassThroughToNative(fileId) {
    return nativePassthroughFiles.has(String(fileId || ''));
  }

  /* Codes that mean "Nexus will not give this to the extension", as opposed to a transient failure
     worth retrying. Only these hand control back — a timeout or a rate limit still belongs to us. */
  const NATIVE_HANDOFF_CODES = new Set(['no_download_url', 'no_nmm_link', 'unsafe_download_url']);

  function releaseToNativeControl(button, fileId, error) {
    if (!NATIVE_HANDOFF_CODES.has(error?.code)) return false;
    allowNativeDownload(fileId);
    restoreButtonState(button);
    Logger.info('Handing this file back to the native Nexus controls; the extension cannot resolve it.');
    return true;
  }

  function isDifferentPage(href) {
    try {
      return new URL(href, location.href).href !== location.href;
    } catch (_) {
      return false;
    }
  }

  function getCurrentNativeDownloadHost(fileId = getCurrentFileId(), isNMM = null) {
    const expectedFileId = String(fileId || '');
    const hosts = getSearchRoots(document)
      .flatMap((root) => Array.from(root.querySelectorAll('mod-file-download[file-id]')))
      .filter((element) => element.getAttribute('file-id') === expectedFileId);
    if (typeof isNMM !== 'boolean') return hosts[0] || null;
    return hosts.find((element) => element.getAttribute('is-nmm-download') === String(isNMM))
      || hosts[0]
      || null;
  }

  function currentNativeMethodMatches(isNMM, fileId) {
    const host = getCurrentNativeDownloadHost(fileId, !!isNMM);
    const method = host?.getAttribute('is-nmm-download');
    if (method === 'true' || method === 'false') return (method === 'true') === !!isNMM;
    try {
      return new URLSearchParams(location.search).has('nmm') === !!isNMM;
    } catch (_) {
      return false;
    }
  }

  function enableNativeFallbackForCurrentFile(fileId, isNMM, button = null) {
    const currentFileId = getCurrentFileId();
    const currentKey = getCurrentFileKey();
    if (!currentKey || (fileId && String(fileId) !== currentFileId)
      || !currentNativeMethodMatches(isNMM, currentFileId)) return false;

    cancelScheduledTabClose();
    const shouldAutoStart = !!button || !!cfg.AutoStartDownload;
    rememberCloudflareFallback(location.href, currentFileId, isNMM, shouldAutoStart);
    nativeFallbackKey = currentKey;
    nativeFallbackIsNMM = !!isNMM;
    nativeFallbackAutoStartPending = shouldAutoStart;
    nativeFallbackAutoStarted = false;
    restoreButtonState(button);
    Logger.warn('Cloudflare blocked the extension request; using the native Nexus download control.');
    armFallbackWatchdog();
    syncSlowDownloadIntercept();
    return true;
  }

  function activateCloudflareFallback({ button = null, fileId, isNMM, href } = {}) {
    /* Returning false hands the caller back to the normal error path, which reports the Cloudflare
       block instead of navigating the tab. That navigation is the surprising part of this feature,
       so it is the part that has to be switchable. */
    if (cfg.CloudflareFallback === false) {
      Logger.info('Cloudflare fallback is turned off; reporting the block instead of opening the page.');
      return false;
    }

    let target;
    try {
      target = new URL(href || location.href, location.href);
      if (isNMM) target.searchParams.set('nmm', '1');
    } catch (_) {
      return false;
    }

    if (!NXTK.isSafeNexusPageUrl(target.href) || target.hostname !== location.hostname) return false;

    const currentModPage = getModPagePath(location.href);
    const targetModPage = getModPagePath(target.href);
    const targetFileId = target.searchParams.get('file_id') || '';
    const currentFileId = getCurrentFileId();
    if (currentModPage && targetModPage === currentModPage && currentFileId
      && (!targetFileId || targetFileId === currentFileId)
      && enableNativeFallbackForCurrentFile(fileId || currentFileId, isNMM, button)) {
      return true;
    }

    rememberCloudflareFallback(target.href, fileId, isNMM, !!button || !!cfg.AutoStartDownload);
    invalidateDownloadAttempts();
    if (button) {
      setButtonState(button, 'waiting', NXTK.t('btnStateOpeningPage', null, 'Opening file page...'));
    }
    Logger.warn('Cloudflare blocked the extension request; opening the Nexus page for verification.');
    location.assign(target.href);
    return true;
  }

  function handleError(btn, error, { onRetry = null } = {}) {
    const normalized = Errors.normalize(error);
    const shown = Errors.displayText ? Errors.displayText(normalized) : {
      message: normalized.userMessage,
      recovery: normalized.recovery
    };
    if (btn) setButtonState(btn, 'error', shown.message);
    Logger.error(`[${normalized.code}] ${normalized.userMessage}`, normalized.technicalMessage || normalized.context);
    if (!cfg.ShowAlertsOnError) return normalized;

    if (NexusExt.UI?.showError) {
      NexusExt.UI.showError(normalized, { onRetry });
    } else {
      NexusExt.UI?.nxtkAlert?.(`${shown.message}\n${shown.recovery}`.trim());
    }
    return normalized;
  }

  async function runDownload(options) {
    const {
      button = null,
      fileId,
      isNMM,
      href,
      openFilePageOnNoUrl = false,
      closeTabAfterStart = false
    } = options;
    const attemptId = beginDownloadAttempt();

    NXTK.setActivity?.({
      trigger: button ? 'manual' : 'automatic',
      method: isNMM ? 'vortex' : 'browser',
      fileId: String(fileId || ''),
      autoClose: !!(closeTabAfterStart && cfg.AutoCloseTab && isNMM),
      fallbackActive: isNativeFallbackActive()
    });

    const loginError = Auth?.getDocumentLoginError?.(document, 'Starting download');
    if (loginError) {
      handleError(button, loginError, { onRetry: () => runDownload(options) });
      return false;
    }

    if (button) setButtonState(button, 'waiting');
    Logger.debug('fileId', fileId, 'isNMM', isNMM);

    let result;
    try {
      result = await getDownloadUrl({ fileId, gameId: getGameId(), isNMM, href });
    } catch (cause) {
      result = { url: null, error: Errors.fromException(cause, { context: 'Resolving download link' }) };
    }
    let error = result?.error || (!result?.url ? Errors.create(isNMM ? 'no_nmm_link' : 'no_download_url') : null);
    if (error) {
      error = Errors.normalize(error);
      if (error.code === 'cloudflare') {
        if (attemptId !== downloadAttemptSequence) {
          /* Superseded by a newer attempt. Returning silently used to leave the button frozen on
             "Please Wait..." with the native control still suppressed. */
          restoreButtonState(button);
          return false;
        }
        if (activateCloudflareFallback({ button, fileId, isNMM, href })) return false;
      }
      const shouldOpenFilePage = openFilePageOnNoUrl && !isNMM && href
        && error.code === 'no_download_url' && isDifferentPage(href);
      if (shouldOpenFilePage) {
        if (!NXTK.isSafeNexusPageUrl(new URL(href, location.href).href)) {
          handleError(button, Errors.create('unsafe_download_url', {
            context: 'Opening file page',
            technicalMessage: 'rejected: not a Nexus Mods page URL'
          }));
          return false;
        }
        if (button) setButtonState(button, 'waiting', NXTK.t('btnStateOpeningPage', null, 'Opening file page...'));
        location.assign(href);
        return false;
      }
      handleError(button, error, { onRetry: () => runDownload(options) });
      releaseToNativeControl(button, fileId, error);
      return false;
    }

    if (button) setButtonState(button, isNMM ? 'waiting' : 'downloading');
    let finalUrl = null;
    try {
      finalUrl = await normalizeDownloadUrl(result.url, isNMM);
    } catch (cause) {
      handleError(button, Errors.fromException(cause, { context: 'Validating download link' }), {
        onRetry: () => runDownload(options)
      });
      return false;
    }
    if (!finalUrl) {
      const missing = Errors.create(isNMM ? 'no_nmm_link' : 'no_download_url');
      handleError(button, missing, { onRetry: () => runDownload(options) });
      releaseToNativeControl(button, fileId, missing);
      return false;
    }

    const verdict = NXTK.validateDownloadTarget(finalUrl, { method: isNMM ? 0 : 1 });
    if (!verdict.ok) {
      const unsafe = Errors.create('unsafe_download_url', {
        context: 'Validating download target',
        technicalMessage: `rejected: ${verdict.detail} | method=${isNMM ? 'vortex' : 'browser'}`
      });
      handleError(button, unsafe);
      releaseToNativeControl(button, fileId, unsafe);
      return false;
    }
    if (isNMM) {
      try {
        location.assign(finalUrl);
      } catch (cause) {
        handleError(button, Errors.fromException(cause, { context: 'Sending link to Vortex' }), {
          onRetry: () => runDownload(options)
        });
        return false;
      }
      if (button) {
        setButtonState(button, 'sent');
        setTimeout(() => {
          if (attemptId === downloadAttemptSequence && button.isConnected) restoreButtonState(button);
        }, 2500);
      }
    } else if (!await startManagedFileDownload(finalUrl, fileId)) {
      handleError(button, Errors.create('request_failed', {
        context: 'Starting browser download',
        technicalMessage: 'chrome.downloads did not start the resolved file'
      }), { onRetry: () => runDownload(options) });
      return false;
    }
    globalThis.NXTK?.bumpTotalDownloads?.();
    if (closeTabAfterStart && cfg.AutoCloseTab && isNMM && attemptId === downloadAttemptSequence) {
      const configuredDelay = Number(cfg.CloseTabDelay);
      const closeDelay = Math.min(Math.max(Number.isFinite(configuredDelay) ? configuredDelay : 2000, 0), 60000);
      const closeNow = () => {
        closeTabTimer = null;
        closeTabToast = null;
        if (attemptId !== downloadAttemptSequence) return;
        safeSendMessage({ type: 'CLOSE_TAB' });
      };

      if (NexusExt.UI?.showCloseCountdown && closeDelay >= 1000) {
        closeTabToast = NexusExt.UI.showCloseCountdown({
          ms: closeDelay,
          onDone: closeNow,
          onCancel: () => {
            closeTabToast = null;
            invalidateDownloadAttempts();
            Logger.info('Tab close cancelled — leaving this page open.');
          }
        });
      } else {
        closeTabTimer = setTimeout(closeNow, closeDelay);
      }
    }
    return true;
  }

  function attachClickInterceptor() {
    async function handleDownload(btn, fileId, isNMM, href) {
      return runDownload({
        button: btn,
        fileId,
        isNMM,
        href,
        openFilePageOnNoUrl: true
      });
    }

    const extractFileId = (href) => {
      try {
        const url = new URL(href, location.href);
        const apiMatch = url.pathname.match(/\/api\/files\/(\d+)/);
        if (apiMatch) return apiMatch[1];
        return url.searchParams.get('file_id') || url.searchParams.get('id');
      } catch {}
      return null;
    };

    const IGNORE_ANCESTORS = 'nav, .nav, .pagination, .comment-container, .comment-content, .forum-post, .header-nav, .search-results, #nnwpp-btn, .nxtk-deck';
    const DOWNLOAD_HREF_PATTERNS = ['/Core/Libs/Common/', 'tab=files&file_id=', 'file_id=', 'ModRequirementsPopUp', '/api/files/'];
    const isDownloadHref = (href) => DOWNLOAD_HREF_PATTERNS.some(p => href.includes(p));

    document.body.addEventListener('click', async function (event) {
      if (!isModPage()) return;
      if (isNativeFallbackActive()) return;

      if (cfg.SkipRequirements && event.composedPath) {
        const path = event.composedPath();
        const modal = path.find(node => node?.tagName === 'DOWNLOAD-MODAL');
        if (modal) {
          const modalButton = path.find(node => node && (node.tagName === 'BUTTON' || node.tagName === 'A'));
          if (modalButton) {
            const buttonText = normalizeText(modalButton.textContent);
            const isNMMModal = buttonText.includes('manager') || buttonText.includes('vortex') || modalButton.href?.includes('nmm=1');
            let modalHref = modalButton.href || modalButton.getAttribute?.('href') || '';
            const linksJson = modal.getAttribute('download-links');

            if (linksJson) {
              try {
                const links = JSON.parse(decodeDownloadUrlValue(linksJson));
                modalHref = isNMMModal
                  ? links.vortexDownloadUrl || links.nmmDownloadUrl || links.downloadUrl || modalHref
                  : links.downloadUrl || modalHref;
              } catch (err) {
                Logger.warn('Failed to parse download modal links:', err);
              }
            }

            if (modalHref && !shouldPassThroughToNative(extractFileId(modalHref))) {
              event.preventDefault();
              event.stopImmediatePropagation();
              handleDownload(modalButton, extractFileId(modalHref), isNMMModal, modalHref)
                .catch((cause) => handleError(
                  modalButton,
                  Errors.fromException(cause, { context: 'Starting modal download' })
                ));
              return;
            }
          }
        }
      }

      /* A modified or non-primary click is the user asking the browser for something specific —
         open in a new tab, save as, paste-and-go. Swallowing those was never intended, and it also
         leaves no way to reach the native control at all. */
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

      const element = event.target.closest('a,button');
      if (!element) return;
      if (element.closest(IGNORE_ANCESTORS)) return;
      const linkHref = element.href || element.getAttribute('href') || '';
      if (!linkHref) return;
      if (!isDownloadHref(linkHref)) return;
      const fileId = extractFileId(linkHref);
      if (!fileId) return;
      if (shouldPassThroughToNative(fileId)) return;
      const hasRequirements = linkHref.includes('ModRequirementsPopUp') || linkHref.includes('tab=requirements');
      const isNMM = linkHref.includes('nmm=1') || linkHref.includes('&nmm') || element.closest('#action-nmm') !== null;
      if (hasRequirements && !cfg.SkipRequirements) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      handleDownload(element, fileId, isNMM, linkHref)
        .catch((cause) => handleError(
          element,
          Errors.fromException(cause, { context: 'Starting download' })
        ));
    }, true);

  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  const SHADOW_HOST_SELECTOR = 'mod-file-download, mod-download-modal, download-modal';

  function getSearchRoots(root = document) {
    const roots = [root];
    if (typeof root.querySelectorAll !== 'function') return roots;
    const seen = new Set(roots);
    const queue = [root];

    while (queue.length) {
      const currentRoot = queue.shift();
      if (typeof currentRoot.querySelectorAll !== 'function') continue;
      for (const host of currentRoot.querySelectorAll(SHADOW_HOST_SELECTOR)) {
        const shadowRoot = host.shadowRoot;
        if (!shadowRoot || seen.has(shadowRoot)) continue;
        seen.add(shadowRoot);
        roots.push(shadowRoot);
        queue.push(shadowRoot);
      }
    }

    return roots;
  }

  function findSlowDownloadButtons(root, { includeBound = false } = {}) {
    const selector = includeBound ? 'button' : 'button:not([data-nxtk-slow-bound])';
    const buttons = Array.from(root.querySelectorAll(selector));
    return buttons.filter((button) => {
      const buttonText = normalizeText(button.textContent);
      if (!buttonText.includes('slow download')) return false;

      const cardText = normalizeText(button.closest('div,section,article')?.textContent);
      return (
        button.id === 'slowDownloadButton'
        || cardText.includes('wait more')
        || cardText.includes('delay before each download')
        || cardText.includes('throttled downloads')
      );
    });
  }

  function startNativeFallbackIfReady() {
    if (!isNativeFallbackActive() || !nativeFallbackAutoStartPending
      || nativeFallbackAutoStarted) return;
    if (isCloudflareChallengeDocument()) return;

    const fileId = getCurrentFileId();
    if (typeof nativeFallbackIsNMM === 'boolean'
      && !currentNativeMethodMatches(nativeFallbackIsNMM, fileId)) return;

    const host = getCurrentNativeDownloadHost(fileId, nativeFallbackIsNMM);
    const roots = host?.shadowRoot ? getSearchRoots(host.shadowRoot) : getSearchRoots(document);
    const button = host?.shadowRoot?.querySelector('#slowDownloadButton')
      || roots.flatMap((root) => Array.from(root.querySelectorAll(
        '#slowDownloadButton, button[data-nxtk-slow-bound]'
      )))[0]
      || roots
        .flatMap((root) => findSlowDownloadButtons(root, { includeBound: true }))[0];
    if (!button || button.disabled) return;

    nativeFallbackAutoStarted = true;
    cancelFallbackWatchdog();
    setStoredCloudflareAutoStartPending(false);
    restoreButtonState(button);
    NXTK.setActivity?.({
      trigger: 'fallback',
      method: 'native',
      fileId: String(fileId || ''),
      fallbackActive: true
    });
    Logger.info('Starting the native Nexus download after the Cloudflare fallback.');
    Promise.resolve().then(() => {
      if (!isNativeFallbackActive() || !button.isConnected) return;
      button.click();
    }).catch((cause) => {
      nativeFallbackAutoStarted = false;
      setStoredCloudflareAutoStartPending(true);
      armFallbackWatchdog();
      Logger.warn('Could not start the native Nexus download:', cause);
    });
  }

  async function handleSlowDownloadClick(button, event) {
    const params = new URLSearchParams(location.search);
    const fileId = params.get('file_id');
    /* Guard before cancelling the event. This used to preventDefault and stopImmediatePropagation as
       its first two statements and only then check for a file id, so on any page where the check
       failed the native Slow download button became a dead control: no download, no error, nothing. */
    if (!fileId || shouldPassThroughToNative(fileId)) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    return runDownload({ button, fileId, isNMM: wantsVortexHandoff(params), href: location.href });
  }

  /* `params.has('nmm')` was used for this, which is also true for `?nmm=0` — a URL explicitly asking
     for a browser download was routed down the Vortex path, where a manual-only file dead-ends. */
  function wantsVortexHandoff(params) {
    return params.get('nmm') === '1';
  }

  function isFilePage() {
    return isModPage() && location.search.includes('file_id');
  }

  function setupSlowDownloadIntercept() {
    if (isNativeFallbackActive()) {
      startNativeFallbackIfReady();
      return;
    }

    const roots = getSearchRoots(document);
    for (const root of roots) {
      const slowDownloadButtons = findSlowDownloadButtons(root);
      for (const slowDownloadBtn of slowDownloadButtons) {
        slowDownloadBtn.dataset.nxtkSlowBound = '1';
        slowDownloadBtn.addEventListener('click', (event) => {
          if (isNativeFallbackActive()) return;
          handleSlowDownloadClick(slowDownloadBtn, event)
            .catch((cause) => handleError(
              slowDownloadBtn,
              Errors.fromException(cause, { context: 'Starting slow download' })
            ));
        });
      }
    }
  }

  const SLOW_DOWNLOAD_POLL_MS = 1000;
  let slowDownloadTimer = null;

  function syncSlowDownloadIntercept() {
    if (isFilePage()) {
      setupSlowDownloadIntercept();
      if (slowDownloadTimer === null) {
        slowDownloadTimer = setInterval(() => {
          if (isFilePage()) setupSlowDownloadIntercept();
          else stopSlowDownloadPolling();
        }, SLOW_DOWNLOAD_POLL_MS);
      }
      return;
    }
    stopSlowDownloadPolling();
  }

  function stopSlowDownloadPolling() {
    if (slowDownloadTimer === null) return;
    clearInterval(slowDownloadTimer);
    slowDownloadTimer = null;
  }

  function interceptRequirementsTab() {
    document.body.addEventListener('click', function (event) {
      const linkElement = event.target.closest("a[href*='tab=requirements']");
      if (!linkElement) return;
      if (!cfg.SkipRequirements) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const linkHref = linkElement.href || linkElement.getAttribute('href') || '';
      let target;
      try {
        target = new URL(linkHref.replace('tab=requirements', 'tab=files'), location.href).href;
      } catch (_) {
        return;
      }
      if (!NXTK.isSafeNexusPageUrl(target)) {
        Logger.warn('Ignored requirements link with unexpected target.');
        return;
      }
      location.replace(target);
    }, true);
  }

  let lastAutoStartHref = '';

  async function autoStartDownload() {
    if (!cfg.AutoStartDownload) return;
    if (isCloudflareChallengeDocument()) return;
    if (!isModPage()) return;
    const params = new URLSearchParams(location.search);
    const fileId = params.get('file_id');
    if (!fileId) return;
    if (isNativeFallbackActive()) {
      startNativeFallbackIfReady();
      return;
    }
    const autoStartKey = location.origin + location.pathname + location.search;
    if (lastAutoStartHref === autoStartKey) return;
    lastAutoStartHref = autoStartKey;
    const isNMM = wantsVortexHandoff(params);
    Logger.debug('Auto-start: fileId', fileId, 'isNMM', isNMM);
    await new Promise(r => setTimeout(r, 200));
    Logger.info(`Auto ${isNMM ? 'NMM' : 'manual'}: starting download`);
    return runDownload({
      fileId,
      isNMM,
      href: location.href,
      closeTabAfterStart: true
    });
  }

  const UPSELL_SELECTORS = [
      '#nonPremiumBanner', '#freeTrialBanner', '#ig-banner-container', '#rj-vortex',
      '[class*="ads-bottom"]', '[class*="ads-top"]', '[class*="to-premium"]',
      '[class*="from-premium"]',
      '#mainContent > div.ads-holder.clearfix.ads-top',
      '#mainContent > div.ads-holder.clearfix.ads-bottom',
      '#mainContent > div > div.relative.next-container > div > section.flex.items-center.justify-center > div',
      '#mainContent > div > div.relative.next-container > div > a',
      '#mainContent > div.flex.items-center.justify-center.gap-x-4.border-y.border-stroke-subdued.bg-surface-low.py-2',
      '#mainContent > div.hidden.items-center.justify-center.gap-x-4.border-b.border-stroke-subdued.bg-surface-low.py-2.md\\:flex',
      '#mainContent > div.relative > div.relative.next-container.pb-20 > div.space-y-16 > div.relative.overflow-hidden.rounded-lg.border-2.border-\\[\\#FCD23F\\]',
      '#mainContent > div.relative > div.relative.next-container.pb-20 > div.mb-6.w-full.space-y-6.border-b.border-stroke-weak.pt-4.pb-6.sm\\:mb-0.sm\\:border-none.sm\\:pb-8 > section > div.flex.flex-col.gap-2.rounded-sm.bg-surface-translucent-low.p-2\\.5.backdrop-blur-xs.xs\\:w-fit.xs\\:max-w-sm.order-4.h-fit.w-full',
      '#filters-panel > div.mt-4.hidden.rounded-lg.border.border-creator-subdued.bg-creator-weak.bg-cover.p-4',
      '#head > div.rj-right-tray.rj-profile-tray.rj-open > ul > li.user-profile-menu-section-top > a'
  ];

  const UPSELL_SELECTOR = (() => {
    const joined = UPSELL_SELECTORS.join(', ');
    try {
      document.createDocumentFragment().querySelector(joined);
      return joined;
    } catch (_) {
      return '';
    }
  })();

  const UPSELL_FUZZY_SELECTORS = [
    '[class*="premium"]', '[id*="premium"]', '[class*="upsell"]', '[id*="upsell"]'
  ];
  const UPSELL_FUZZY_SELECTOR = UPSELL_FUZZY_SELECTORS.join(', ');
  const UPSELL_PAGE_CONTENT_SELECTOR = 'h1, #mainContent';

  function looksLikePageContent(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.id === 'mainContent') return true;
    try {
      return !!el.querySelector(UPSELL_PAGE_CONTENT_SELECTOR);
    } catch (_) {
      return false;
    }
  }

  const AD_SLOT_SELECTORS = [
    "[data-testid^=\"ad-\"]",
    "[id^=\"standard_iab_\"]",
    "[id^=\"google_ads_iframe_\"]",
    "[class*=\"pw-standardIAB-tag\"]",
    "[class*=\"pw-tag\"]",
    "#ig-banner-container",
    ".ads-holder",
  ];
  const AD_SLOT_SELECTOR = AD_SLOT_SELECTORS.join(", ");

  const AD_CONTENT_SELECTOR = [
    "a[href]",
    "button",
    "input",
    "select",
    "textarea",
    "form",
    "h1, h2, h3, h4, h5, h6",
    "img",
    "video",
    "[role=\"button\"]",
    "[data-testid]:not([data-testid^=\"ad-\"])",
  ].join(", ");

  const AD_WRAPPER_STOP_TAGS = new Set(["BODY", "HTML", "MAIN", "HEADER", "FOOTER", "NAV"]);
  const AD_WRAPPER_MAX_DEPTH = 4;

  function isAdOnlyContainer(el) {
    if (!el || el.nodeType !== 1) return false;
    if (AD_WRAPPER_STOP_TAGS.has(el.tagName)) return false;
    if (el.id === "mainContent" || el.id === "nxtk-extension-root") return false;
    if (el.closest("[id^=\"nxtk-\"], .nxtk-deck")) return false;
    if (el.textContent && el.textContent.trim()) return false;
    if (el.querySelector(AD_CONTENT_SELECTOR)) return false;
    return !!el.querySelector(AD_SLOT_SELECTOR);
  }

  function findAdSlotWrapper(slot) {
    let wrapper = slot;
    let node = slot.parentElement;
    for (let depth = 0; node && depth < AD_WRAPPER_MAX_DEPTH; depth += 1) {
      if (!isAdOnlyContainer(node)) break;
      wrapper = node;
      node = node.parentElement;
    }
    return wrapper;
  }

  function collectMatches(root, selector) {
    const matches = [];
    try {
      if (root.nodeType === 1 && root.matches(selector)) matches.push(root);
      root.querySelectorAll(selector).forEach((el) => matches.push(el));
    } catch (_) {
    }
    return matches;
  }

  function hideAdSlots(root = document) {
    for (const slot of collectMatches(root, AD_SLOT_SELECTOR)) {
      hideUpsellElement(findAdSlotWrapper(slot), "nxtk-ad-hidden");
    }
  }

  function applyUpsellHiding(root) {
    if (UPSELL_SELECTOR) {
      collectMatches(root, UPSELL_SELECTOR).forEach((el) => hideUpsellElement(el));
    } else {
      for (const selector of UPSELL_SELECTORS) {
        collectMatches(root, selector).forEach((el) => hideUpsellElement(el));
      }
    }
    for (const el of collectMatches(root, UPSELL_FUZZY_SELECTOR)) {
      if (!looksLikePageContent(el)) hideUpsellElement(el);
    }
    hideAdSlots(root);
  }

  const SHADOW_UPSELL_CSS = `
        [class*="from-premium"],
        [class*="to-premium"],
        [class*="premium"],
        #upsell-cards,
        #upsell-cards > * {
          display: none !important;
          visibility: hidden !important;
        }
      `;

  function upsellBlocker() {
    if (!cfg.HidePremiumUpsells) return;
    applyUpsellHiding(document);

    document.querySelectorAll('mod-file-download').forEach((modFileDownload) => {
      const shadowRoot = modFileDownload.shadowRoot;
      if (!shadowRoot || shadowRoot.querySelector('.nxtk-shadow-style')) return;
      const shadowStyle = document.createElement('style');
      shadowStyle.className = 'nxtk-shadow-style';
      shadowStyle.textContent = SHADOW_UPSELL_CSS;
      shadowRoot.appendChild(shadowStyle);
    });

    const premiumBanner = document.querySelector('.bg-nexus-premium-gradient');
    if (premiumBanner) {
      hideUpsellElement(premiumBanner);
      Logger.info('Hidden premium upsell banner');
    }

    startPremiumObserver();
  }

  let pendingUpsellRoots = [];

  function flushPendingUpsellRoots() {
    const connected = pendingUpsellRoots.filter((node) => node.isConnected);
    pendingUpsellRoots = [];
    if (!cfg.HidePremiumUpsells) return;
    const unique = [...new Set(connected)];
    if (unique.length > 24) {
      applyUpsellHiding(document);
      return;
    }
    const roots = unique.filter(
      (node) => !unique.some((other) => other !== node && other.contains(node))
    );
    for (const root of roots) {
      applyUpsellHiding(root);
    }
  }

  function startPremiumObserver() {
    if (premiumObserver || !document.body) return;

    premiumObserver = new MutationObserver((mutations) => {
      let queued = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.closest && node.closest("[id^=\"nxtk-\"], .nxtk-deck")) continue;
          pendingUpsellRoots.push(node);
          queued = true;
        }
      }
      if (!queued) return;
      clearTimeout(premiumObserverTimer);
      premiumObserverTimer = setTimeout(flushPendingUpsellRoots, 100);
    });
    premiumObserver.observe(document.body, { childList: true, subtree: true });
  }

  function hideUpsellElement(el, className = "nxtk-upsell-hidden") {
    if (!el || !el.dataset || el.dataset.nxtkUpsellHidden === "1") return;
    el.dataset.nxtkUpsellHidden = "1";
    el.classList.add(className);
    el.setAttribute("aria-hidden", "true");
  }

  function resetUpsellBlocker() {
    if (premiumObserver) {
      premiumObserver.disconnect();
      premiumObserver = null;
    }
    clearTimeout(premiumObserverTimer);
    premiumObserverTimer = null;
    pendingUpsellRoots = [];

    document.querySelectorAll('.nxtk-upsell-hidden, .nxtk-ad-hidden, [data-nxtk-upsell-hidden]').forEach((el) => {
      el.classList.remove('nxtk-upsell-hidden');
      el.classList.remove('nxtk-ad-hidden');
      el.removeAttribute('aria-hidden');
      delete el.dataset.nxtkUpsellHidden;
    });

    document.querySelectorAll('mod-file-download').forEach((host) => {
      host.shadowRoot?.querySelectorAll('.nxtk-shadow-style').forEach((style) => {
        style.remove();
      });
    });
  }
  function waitForElement(selector, cb, timeoutMs = 10000) {
    const el = document.querySelector(selector);
    if (el) {
      cb(el);
      return () => undefined;
    }
    const mo = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) { mo.disconnect(); clearTimeout(timer); cb(found); }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => mo.disconnect(), timeoutMs);
    return () => {
      mo.disconnect();
      clearTimeout(timer);
    };
  }

  let cancelArchivedFooterWait = null;

  const ARCHIVED_FILE_ID_PATTERN = /^\d{1,12}$/;

  const ARCHIVED_DOWNLOADS_CLASS = 'accordion-downloads';

  /* Nexus renders each archived file as a header followed by its own downloads box. This used to
     match the two collections by array index, which assumed they stay the same length and in the
     same order; one stray box and every file after it silently received another file's buttons.

     There is deliberately no index fallback. A fixture with one header missing its box showed the
     fallback handing that header the *next* file's box — the exact defect, reintroduced by the
     escape hatch meant to be safe. When neither relationship finds a box, the file gets no buttons,
     which is recoverable; wrong buttons hand you a different mod version and look correct. */
  function findArchivedDownloadBox(header) {
    if (!header) return null;

    const sibling = header.nextElementSibling;
    if (sibling?.classList?.contains(ARCHIVED_DOWNLOADS_CLASS)) return sibling;

    return header.parentElement?.querySelector(`.${ARCHIVED_DOWNLOADS_CLASS}`) || null;
  }

  function buildArchivedDownloadLink(href, label) {
    const anchor = document.createElement('a');
    anchor.className = 'btn inline-flex';
    anchor.href = href;
    const span = document.createElement('span');
    span.className = 'flex-label';
    span.textContent = label;
    anchor.appendChild(span);
    return anchor;
  }

  function archivedFileHandler() {
    if (!cfg.HandleArchivedFiles) return;
    if (!isModPage()) return;
    const url = location.href;
    if (url.includes('tab=files') && !url.includes('category=archived')) {
      cancelArchivedFooterWait?.();
      cancelArchivedFooterWait = waitForElement('#files-tab-footer', (footer) => {
        if (!cfg.HandleArchivedFiles) return;
        const p = footer.querySelector('p');
        if (p) {
          p.dataset.nxtkArchiveHidden = '1';
          p.style.display = 'none';
        }
        const hasArchiveBtn = footer.querySelector('[data-nxtk-archive]');
        if (!hasArchiveBtn) {
          /* Built by the same helper as the archived download links, so it carries Nexus's own
             button classes. On its own an nxtk- class styles nothing — this extension ships no
             rule for it — and the link rendered as bare underlined text among real buttons. */
          const btn = buildArchivedDownloadLink(
            url + '&category=archived',
            NXTK.t('btnFileArchive', null, 'File archive')
          );
          btn.classList.add('nxtk-archive-btn');
          btn.dataset.nxtkArchive = '1';
          footer.appendChild(btn);
        }
      });
    }
    if (!url.includes('category=archived')) return;
    const headers = Array.from(document.getElementsByClassName('file-expander-header'));
    const base = location.origin + location.pathname;
    const claimed = new Set();
    for (const header of headers) {
      const fileId = String(header?.dataset?.id ?? '');
      const box = findArchivedDownloadBox(header);
      if (!ARCHIVED_FILE_ID_PATTERN.test(fileId) || !box || box.dataset.nxtkDone) continue;
      /* Pairing a header with a box that another header already took would put file A's buttons on
         file B — you press download on one version and receive a different one. Dropping the
         buttons is the safe failure. */
      if (claimed.has(box)) {
        Logger.warn('Archived files: two headers resolved to the same download box; skipping', fileId);
        continue;
      }
      claimed.add(box);
      box.dataset.nxtkDone = '1';
      box._nxtkOriginalHtml = box.innerHTML;
      box.replaceChildren(
        buildArchivedDownloadLink(
          `${base}?tab=files&file_id=${fileId}&nmm=1`,
          NXTK.t('btnModManagerDownload', null, 'Mod manager download')
        ),
        buildArchivedDownloadLink(
          `${base}?tab=files&file_id=${fileId}`,
          NXTK.t('btnManualDownload', null, 'Manual download')
        )
      );
    }
  }

  function resetArchivedFileHandler() {
    document.querySelectorAll('[data-nxtk-archive]').forEach((el) => {
      el.remove();
    });

    document.querySelectorAll('[data-nxtk-archive-hidden]').forEach((el) => {
      delete el.dataset.nxtkArchiveHidden;
      el.style.display = '';
    });

    document.querySelectorAll('.accordion-downloads[data-nxtk-done]').forEach((box) => {
      if (typeof box._nxtkOriginalHtml === 'string') {
        box.innerHTML = box._nxtkOriginalHtml;
      }
      delete box._nxtkOriginalHtml;
      delete box.dataset.nxtkDone;
    });
  }

  function startAutoDownload() {
    autoStartDownload().catch((cause) => handleError(
      null,
      Errors.fromException(cause, { context: 'Starting automatic download' })
    ));
  }

  async function init() {
    cfg = await NexusExt.Storage.getSettings();
    NXTK.setForceEnglish(cfg.ForceEnglish);
    syncNativeFallbackState();
    if (!listenersAttached) {
      attachClickInterceptor();
      interceptRequirementsTab();
      watchStoredSettings();
      listenersAttached = true;
    }
    if (isCloudflareChallengeDocument()) {
      Logger.info('Cloudflare verification page detected; automatic actions are paused.');
      syncSlowDownloadIntercept();
      return;
    }
    syncSlowDownloadIntercept();
    scheduleDomEnhancements();
    startAutoDownload();
    Logger.debug('NNW module initialized');
  }

  async function onNavigate() {
    invalidateDownloadAttempts();
    cfg = await NexusExt.Storage.getSettings();
    syncNativeFallbackState();
    cancelArchivedFooterWait?.();
    cancelArchivedFooterWait = null;
    if (isCloudflareChallengeDocument()) {
      syncSlowDownloadIntercept();
      return;
    }
    syncSlowDownloadIntercept();
    scheduleDomEnhancements();
    startAutoDownload();
  }

  function watchStoredSettings() {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes?.[NXTK.SETTINGS_KEY]) return;
        updateConfig(changes[NXTK.SETTINGS_KEY].newValue);
      });
    } catch (_) {
    }
  }

  function updateConfig(newCfg) {
    const previousCfg = { ...cfg };
    cfg = { ...(NexusExt.Storage?.DEFAULTS || {}), ...(newCfg || {}) };
    NXTK.setForceEnglish(cfg.ForceEnglish);

    if (!cfg.AutoCloseTab) cancelScheduledTabClose();
    if (isNativeFallbackActive()) startNativeFallbackIfReady();

    if (!cfg.HidePremiumUpsells && previousCfg.HidePremiumUpsells) {
      resetUpsellBlocker();
    }

    if (!cfg.HandleArchivedFiles && previousCfg.HandleArchivedFiles) {
      resetArchivedFileHandler();
    }

    scheduleDomEnhancements();
  }

  /* True while this page is one the extension can act on. main.js uses it to decide how often to
     poll for navigations — most of nexusmods.com (forums, profiles, search, news) is neither. */
  function isActionablePage() {
    return isModPage() || isNativeFallbackActive();
  }

  window.NexusExt.NNW = {
    init,
    onNavigate,
    updateConfig,
    getDownloadUrl,
    isActionablePage,
    Logger,
    waitForDomSettled,
    parseDownloadURLFromResponse,
    parseNxmDownloadLink
  };
})();
