/* nnw.js — Nexus No-Wait ++ logic (ported from Tampermonkey script2) */
window.NexusExt = window.NexusExt || {};

(function () {
  'use strict';

  let cfg = {};
  let listenersAttached = false;
  let domEnhancementRun = 0;
  let premiumObserver = null;
  let premiumObserverTimer = null;
  const Errors = NexusExt.Errors;
  const Auth = NexusExt.Auth;

  /* Friendly console logger. Errors always show with a readable badge;
     debug/info/warn only when the "Verbose extension logs" setting is on. */
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

  /* Fire-and-forget runtime message that survives an invalidated extension
     context (extension reloaded/updated while this tab is still open). */
  function safeSendMessage(message) {
    try {
      if (!chrome.runtime?.id) return;
      const result = chrome.runtime.sendMessage(message);
      if (result && typeof result.catch === 'function') result.catch(() => undefined);
    } catch (_) {
      // Extension context invalidated — nothing we can do from here.
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

  /* `prefetched*` lets a caller that has ALREADY fetched `href` hand the response
     over instead of making this function fetch it again. The collection downloader
     fetched `<file page>&nmm=1`, failed to parse an nxm link, then called this with
     the same href — which fetched the identical URL a second time with identical
     credentials and headers. With the 2-attempt retry that was up to four identical
     authenticated GETs per mod.

     `signal` is threaded too: these fetches previously carried none, so the
     duplicate request was the one thing the Stop button could not cancel. */
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

    /* Consumed at most ONCE, and only for the exact URL it was fetched from.
       One-shot is what keeps retries correct: an inner retry re-fetches instead of
       re-parsing a stale body. The URL guard matters because fetchText is also
       called for other URLs (api-file, requirements sub-page). */
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

    /* NOTE: fetchGeneratedDownloadUrl is a POST to a different endpoint and calls
       Errors.request directly, so it can never consume the prefetch. Keep it that
       way if this is ever refactored. */
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

    // Manual download logic
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
      /* depth cap: a server that keeps answering with another still-resolvable
         URL must not recurse unbounded.
         The host test is dotted-suffix: a bare endsWith('nexusmods.com') would also
         match evilnexusmods.com and keep resolving against an attacker's host. */
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
    const stateConfig = {
      // `message` is already localized by the caller (handleError uses displayText).
      waiting: { text: message || NXTK.t('btnStatePleaseWait', null, 'Please Wait...'), color: 'orange' },
      downloading: { text: NXTK.t('btnStateDownloading', null, 'Downloading!'), color: '#3dbb5e' },
      error: { text: message || NXTK.t('btnStateError', null, 'Error'), color: '#e04040' }
    };
    const config = stateConfig[state] || stateConfig.error;
    textElement.innerText = config.text;
    button.style.color = config.color;
  }

  function inferBrowserDownloadName(url, fileId) {
    let urlName = '';
    try {
      urlName = decodeURIComponent(new URL(url).pathname.split('/').pop() || '').trim();
    } catch (_) {}

    /* Normal Nexus CDN paths already contain the real archive filename. Opaque UUID
       paths do not, so use the page's mod title plus file id instead of saving a
       nameless UUID. The worker performs the final Windows/path sanitization. */
    if (/\.(?:zip|7z|rar|tar|gz|tgz|bz2|tbz2|xz|txz|lzma|exe|msi|jar|fomod|omod|txt|pdf|json|xml|ini|cfg|esp|esm|esl|dll)$/i.test(urlName)) {
      return urlName;
    }
    const pageTitle = String(
      document.querySelector('h1')?.textContent
      || document.title.split(/\s+(?:at|on)\s+Nexus Mods/i)[0]
      || 'nexus-mod'
    ).replace(/\s+/g, ' ').trim();
    const idSuffix = fileId ? `-${fileId}` : '';
    /* Leave the fallback name extensionless. The worker can see the final signed
       CDN URL and appends its real extension; opaque UUID URLs fall back to .zip. */
    return `${pageTitle || 'nexus-mod'}${idSuffix}`;
  }

  async function startManagedFileDownload(url, fileId) {
    try {
      const settings = await NexusExt.Storage.getSettings();
      const reply = await NexusExt.Storage.sendDownloadCommand('DOWNLOAD_START', {
        url,
        // Empty means the Downloads root; the worker decides the final path.
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

  function isDifferentPage(href) {
    try {
      return new URL(href, location.href).href !== location.href;
    } catch (_) {
      return false;
    }
  }

  function handleError(btn, error, { onRetry = null } = {}) {
    const normalized = Errors.normalize(error);
    /* Two audiences, two languages: the button and the alert are read by the user, the
       Logger line is a diagnostic and stays on the English catalogue text. */
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
      const shouldOpenFilePage = openFilePageOnNoUrl && !isNMM && href
        && error.code === 'no_download_url' && isDifferentPage(href);
      if (shouldOpenFilePage) {
        // A Nexus *page*, not a download — validated with the lighter page check
        // (which excludes the CDN). href originates from a page anchor, so an open
        // redirect is worth closing even though Chrome blocks javascript: here.
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
      return false;
    }

    if (button) setButtonState(button, 'downloading');
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
      handleError(button, Errors.create(isNMM ? 'no_nmm_link' : 'no_download_url'), {
        onRetry: () => runDownload(options)
      });
      return false;
    }

    const verdict = NXTK.validateDownloadTarget(finalUrl, { method: isNMM ? 0 : 1 });
    if (!verdict.ok) {
      const unsafe = Errors.create('unsafe_download_url', {
        context: 'Validating download target',
        technicalMessage: `rejected: ${verdict.detail} | method=${isNMM ? 'vortex' : 'browser'}`
      });
      handleError(button, unsafe);
      return false;
    }

    /* Vortex requires an nxm:// navigation to invoke its protocol handler. Browser
       mode always uses the required downloads permission; a worker failure is
       surfaced instead of starting a second, unmanaged fallback path. */
    if (isNMM) {
      location.assign(finalUrl);
    } else if (!await startManagedFileDownload(finalUrl, fileId)) {
      handleError(button, Errors.create('request_failed', {
        context: 'Starting browser download',
        technicalMessage: 'chrome.downloads did not start the resolved file'
      }), { onRetry: () => runDownload(options) });
      return false;
    }

    globalThis.NXTK?.bumpTotalDownloads?.();
    if (closeTabAfterStart && cfg.AutoCloseTab && isNMM) {
      const closeDelay = Math.min(Math.max(Number(cfg.CloseTabDelay) || 2000, 0), 60000);
      setTimeout(() => safeSendMessage({ type: 'CLOSE_TAB' }), closeDelay);
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

            if (modalHref) {
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

      const element = event.target.closest('a,button');
      if (!element) return;
      if (element.closest(IGNORE_ANCESTORS)) return;
      const linkHref = element.href || element.getAttribute('href') || '';
      if (!linkHref) return;
      if (!isDownloadHref(linkHref)) return;
      const fileId = extractFileId(linkHref);
      if (!fileId) return;
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

  /* Nexus's shadow roots all hang off custom elements, so they can be addressed by tag.
     Enumerating every element with `*` to test each one for a shadowRoot walked the
     whole document on every debounced pass. */
  const SHADOW_HOST_SELECTOR = 'mod-file-download, download-modal';

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

  /* `:not([data-nxtk-slow-bound])` lets the engine drop already-bound buttons
     natively, so a rescan no longer re-reads textContent for every button it has
     already handled. (A dataset marker rather than an expando precisely so it can
     be expressed in the selector.) */
  function findSlowDownloadButtons(root) {
    const buttons = Array.from(root.querySelectorAll('button:not([data-nxtk-slow-bound])'));
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

  async function handleSlowDownloadClick(button, event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const params = new URLSearchParams(location.search);
    const fileId = params.get('file_id');
    if (!fileId) return;

    const isNMM = params.has('nmm') || params.get('nmm') === '1';
    return runDownload({ button, fileId, isNMM, href: location.href });
  }

  function isFilePage() {
    return isModPage() && location.search.includes('file_id');
  }

  function setupSlowDownloadIntercept() {
    const roots = getSearchRoots(document);
    for (const root of roots) {
      const slowDownloadButtons = findSlowDownloadButtons(root);
      for (const slowDownloadBtn of slowDownloadButtons) {
        slowDownloadBtn.dataset.nxtkSlowBound = '1';
        slowDownloadBtn.addEventListener('click', (event) => {
          handleSlowDownloadClick(slowDownloadBtn, event)
            .catch((cause) => handleError(
              slowDownloadBtn,
              Errors.fromException(cause, { context: 'Starting slow download' })
            ));
        });
      }
    }
  }

  /* Slow-download intercept lifecycle. The full-document + shadow-DOM scan is
     expensive, so it only ever runs debounced, only on file pages, and the
     observer is disconnected the moment the route leaves a file page.
     (Previously the observer fired the scan on EVERY body mutation, forever,
     and was only installed if the FIRST page load happened to be a file page.) */
  /* Rescanned on a poll rather than from its own body-subtree observer. That observer was
     the third one watching document.body, and its only job was to notice buttons that
     Nexus adds after load — a once-a-second check covers that without adding another
     consumer to every React commit. The interval only exists while a file page is open. */
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
      // linkHref comes from a page anchor on a site with user-authored mod pages,
      // so confirm it still points at Nexus before replacing the location.
      if (!NXTK.isSafeNexusPageUrl(target)) {
        Logger.warn('Ignored requirements link with unexpected target.');
        return;
      }
      location.replace(target);
    }, true);
  }

  // Guard against double-fire: pushState + replaceState on the same file URL
  // both trigger onNavigate, which would launch the same download twice.
  // Keyed WITHOUT the hash, matching navKey() in main.js: a '#comments' anchor on
  // a ?file_id= URL is not a new download target, and treating it as one would
  // start the same file twice now that SPA navigations are actually detected.
  let lastAutoStartHref = '';

  async function autoStartDownload() {
    if (!cfg.AutoStartDownload) return;
    if (!isModPage()) return;
    const params = new URLSearchParams(location.search);
    const fileId = params.get('file_id');
    if (!fileId) return;
    const autoStartKey = location.origin + location.pathname + location.search;
    if (lastAutoStartHref === autoStartKey) return;
    lastAutoStartHref = autoStartKey;
    const isNMM = params.has('nmm') || params.get('nmm') === '1';
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

  /* Hoisted once — rebuilt selector arrays per call were pure overhead. The
     case-insensitive `[class*="…" i]` variants were dropped: Nexus emits these
     class/id fragments lowercase, the exact-case selectors already match, and
     `i`-flag substring scans are among the slowest selectors to evaluate. */
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

  /* One grouped selector instead of 17 separate querySelectorAll calls per scanned
     node — a React burst of 200 insertions used to cost ~3400 queries per flush.
     Validated once here rather than per pass: if any escaped Tailwind chain above is
     ever rejected by a browser the whole group throws, so we fall back to the
     per-selector loop, which skips only the offending entry (see collectMatches). */
  const UPSELL_SELECTOR = (() => {
    const joined = UPSELL_SELECTORS.join(', ');
    try {
      document.createDocumentFragment().querySelector(joined);
      return joined;
    } catch (_) {
      return '';
    }
  })();

  /* Deliberately broad, because Nexus renames these classes freely — but a bare
     substring match also hits any page that merely TALKS about Premium, and hiding it
     applies `display:none !important`. Anything caught here therefore has to survive the
     page-content test below before it is hidden; the curated selectors above do not,
     since a banner legitimately contains its own heading and call-to-action. */
  const UPSELL_FUZZY_SELECTORS = [
    '[class*="premium"]', '[id*="premium"]', '[class*="upsell"]', '[id*="upsell"]'
  ];
  const UPSELL_FUZZY_SELECTOR = UPSELL_FUZZY_SELECTORS.join(', ');
  /* Narrow on purpose. The failure this guards against is a whole PAGE about Premium
     being collapsed, and the page's own <h1> is the signal for that. Widening it to
     forms or tables would start exempting real banners, which is the opposite mistake
     and the one users actually notice. */
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

  /* Ad slots are matched semantically instead of by Tailwind class chains.
     Nexus reshuffles utility classes freely, but the slot identity
     (data-testid, the Playwire pw-tag containers, the GPT iframe id) is stable.
     `data-testid^="ad-"` also covers rail/skyscraper slots without guessing a
     broad selector; note it cannot collide with "add-…" testids, since those
     lack the hyphen after "ad". */
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

  /* Anything here marks a container as real page content, so it is never
     collapsed even if an ad happens to sit inside it. A non-ad data-testid is
     the strongest signal Nexus gives us that a node is product UI. */
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

  /* A container may be collapsed only when it exists purely to host ad slots:
     it must contain at least one slot, no interactive/heading/media content and
     no visible text. That is what keeps the collection title, revision selector
     and "Add collection" button safe. */
  function isAdOnlyContainer(el) {
    if (!el || el.nodeType !== 1) return false;
    if (AD_WRAPPER_STOP_TAGS.has(el.tagName)) return false;
    if (el.id === "mainContent" || el.id === "nxtk-extension-root") return false;
    if (el.closest("[id^=\"nxtk-\"], .nxtk-deck")) return false;
    if (el.textContent && el.textContent.trim()) return false;
    if (el.querySelector(AD_CONTENT_SELECTOR)) return false;
    return !!el.querySelector(AD_SLOT_SELECTOR);
  }

  /* Walks up from a slot to the outermost ad-only ancestor. Hiding only the slot
     leaves the wrapper's min-height/padding/gap behind — that empty ~250px band
     on collection pages was exactly this. */
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

  /* Selector matching that also tests `root` itself, so the observer can pass a
     freshly added node directly. Guarded because UPSELL_SELECTORS carries
     escaped Tailwind chains that a future browser could reject. */
  function collectMatches(root, selector) {
    const matches = [];
    try {
      if (root.nodeType === 1 && root.matches(selector)) matches.push(root);
      root.querySelectorAll(selector).forEach((el) => matches.push(el));
    } catch (_) {
      // Unsupported selector — skip it rather than abort the whole pass.
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

  /* Queued added-subtrees, so a burst of React insertions costs one debounced
     pass over just those nodes instead of a full-document rescan per mutation. */
  let pendingUpsellRoots = [];

  function flushPendingUpsellRoots() {
    const connected = pendingUpsellRoots.filter((node) => node.isConnected);
    pendingUpsellRoots = [];
    if (!cfg.HidePremiumUpsells) return;
    /* React commonly reports a parent and several of its descendants in the same
       batch. Scanning a descendant is redundant once its ancestor is scanned, since
       applyUpsellHiding walks the whole subtree either way. */
    const unique = [...new Set(connected)];
    /* The containment filter is O(n^2), so past a modest batch one whole-document
       pass is simply cheaper than deduplicating and then walking each subtree. */
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

    /* childList only: this module hides by toggling a class, which is an
       attribute mutation, so its own writes can never re-trigger the observer.
       Removals and attribute churn don't warrant a rescan either. */
    premiumObserver = new MutationObserver((mutations) => {
      let queued = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          // Ignore the extension's own UI so the deck can never queue work.
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

  /* Class-only hiding. The collapse rules live in content-styles.css, so turning
     the setting off restores the element exactly by dropping one class. Writing
     inline display/visibility here (as this used to) meant the restore path had
     to replay the original inline value, and a slot such as
     `#standard_iab_head1` that already ships `style="display:none"` from Nexus
     would be un-hidden by that replay. */
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
  /* Returns a cancel function so fast navigation can tear down the pending
     observer instead of stacking body-subtree observers for up to 10s each. */
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
          const btn = document.createElement('a');
          btn.href = url + '&category=archived';
          btn.className = 'nxtk-archive-btn';
          btn.dataset.nxtkArchive = '1';
          // textContent on a child span: the label is data, the markup stays in code.
          const label = document.createElement('span');
          label.textContent = NXTK.t('btnFileArchive', null, 'File archive');
          btn.appendChild(label);
          footer.appendChild(btn);
        }
      });
    }
    if (!url.includes('category=archived')) return;
    const headers = Array.from(document.getElementsByClassName('file-expander-header'));
    const downloads = Array.from(document.getElementsByClassName('accordion-downloads'));
    const base = location.origin + location.pathname;
    for (const [i, header] of headers.entries()) {
      const fileId = String(header?.dataset?.id ?? '');
      const box = downloads[i];
      if (!ARCHIVED_FILE_ID_PATTERN.test(fileId) || !box || box.dataset.nxtkDone) continue;
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

  // Public API
  async function init() {
    cfg = await NexusExt.Storage.getSettings();
    // Before any extension UI exists, so the first render is already in the right language.
    NXTK.setForceEnglish(cfg.ForceEnglish);
    if (!listenersAttached) {
      attachClickInterceptor();
      interceptRequirementsTab();
      watchStoredSettings();
      listenersAttached = true;
    }
    syncSlowDownloadIntercept();
    scheduleDomEnhancements();
    startAutoDownload();
    Logger.debug('NNW module initialized');
  }

  async function onNavigate() {
    cfg = await NexusExt.Storage.getSettings();
    cancelArchivedFooterWait?.();
    cancelArchivedFooterWait = null;
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
      // Orphaned content script — keep whatever init() loaded.
    }
  }

  function updateConfig(newCfg) {
    const previousCfg = { ...cfg };
    cfg = { ...(NexusExt.Storage?.DEFAULTS || {}), ...(newCfg || {}) };
    NXTK.setForceEnglish(cfg.ForceEnglish);

    if (!cfg.HidePremiumUpsells && previousCfg.HidePremiumUpsells) {
      resetUpsellBlocker();
    }

    if (!cfg.HandleArchivedFiles && previousCfg.HandleArchivedFiles) {
      resetArchivedFileHandler();
    }

    scheduleDomEnhancements();
  }

  window.NexusExt.NNW = {
    init,
    onNavigate,
    updateConfig,
    getDownloadUrl,
    Logger,
    waitForDomSettled,
    parseDownloadURLFromResponse,
    parseNxmDownloadLink
  };
})();
