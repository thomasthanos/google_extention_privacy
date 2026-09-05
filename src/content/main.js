(function () {
  'use strict';

  const { NNW, UI, NDC } = window.NexusExt;

  let previousRoute = null;
  let activeNdc = null;
  let deckMountRun = 0;
  let bootstrapDone = false;
  let initAttempts = 0;
  let initRetryAt = 0;
  let initRetryTimer = null;

  const INIT_RETRY_BASE_MS = 15000;
  const INIT_RETRY_MAX_MS = 5 * 60 * 1000;
  const ACTIVE_POLL_MS = 1000;
  const IDLE_POLL_MS = 5000;

  function toExtensionError(cause, context) {
    return window.NexusExt.Errors?.fromException
      ? window.NexusExt.Errors.fromException(cause, { context })
      : cause;
  }

  function logUnhandled(cause, context) {
    const error = toExtensionError(cause, context);
    NNW.Logger.error(`[${error?.code || 'request_failed'}] ${error?.userMessage || 'Unexpected extension error'}`, error?.technicalMessage || cause);
    return error;
  }

  window.addEventListener('error', (event) => {
    if (!String(event.filename || '').includes('chrome-extension://')) return;
    globalThis.NXTK?.recordError?.({
      code: 'uncaught_exception',
      context: `Uncaught at ${event.filename}:${event.lineno}:${event.colno}`,
      userMessage: 'An unexpected extension error occurred.',
      technicalMessage: String(event.message || ''),
      stack: String(event.error?.stack || '')
    });
  });

  function waitForNextPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  function waitForPageLoad() {
    if (document.readyState === 'complete') return Promise.resolve();
    return new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
  }

  async function waitForSafeStartup() {
    await waitForPageLoad();
    await NNW.waitForDomSettled({
      root: document.getElementById('mainContent') || document.body,
      quietMs: 700,
      timeoutMs: 6000
    });
    await waitForNextPaint();
  }

  function extractRouteDetails(pathname) {
    const parts = pathname.split('/').filter(Boolean);
    const collectionIndex = parts.indexOf('collections');
    if (collectionIndex < 1 || !parts[collectionIndex + 1]) return null;

    const revisionIndex = parts.indexOf('revisions', collectionIndex + 2);
    return {
      gameDomain: parts[collectionIndex - 1],
      collectionSlug: parts[collectionIndex + 1],
      revisionNumber: revisionIndex !== -1 ? parts[revisionIndex + 1] || null : null
    };
  }

  function findCollectionHost() {
    const legacy = document.querySelector('.bg-surface-low.w-full.space-y-3.rounded-lg.p-4.mt-4');
    if (legacy?.parentElement) {
      return { container: legacy.parentElement, legacy };
    }

    const container = document.querySelector('#mainContent > div > div.relative > div.next-container')
      || document.querySelector('#mainContent .next-container');
    if (!container) return null;

    return {
      container,
      legacy: container.querySelector('.bg-surface-low.w-full.space-y-3.rounded-lg.p-4.mt-4')
    };
  }

  function teardownActiveCollection() {
    clearTimeout(initRetryTimer);
    initRetryTimer = null;
    activeNdc?.dispose?.();
    UI.closeExtensionOverlays?.();

    const deck = document.getElementById('nxtk-control-deck');
    if (!deck) return;

    UI.disposeControlDeck?.(deck);
    deck.remove();
  }

  function resumeBackgroundRunFor(ndc) {
    ndc.resumeBackgroundRun?.()
      .catch((cause) => logUnhandled(cause, 'Reconnecting to a background collection download'));
  }

  async function ensureControlDeckMounted(ndc) {
    if (!ndc?.initialized) return;
    const mountRun = ++deckMountRun;
    await NNW.waitForDomSettled({ root: document.getElementById('mainContent') || document.body });
    if (mountRun !== deckMountRun || activeNdc !== ndc) return;

    const host = findCollectionHost();
    if (!host?.container) return;

    const existingDeck = document.getElementById('nxtk-control-deck');
    if (existingDeck) return;

    const deck = UI.createControlDeck(ndc);
    if (host.legacy) {
      host.legacy.classList.add('nxtk-hidden');
      host.legacy.insertAdjacentElement('afterend', deck);
    } else {
      host.container.appendChild(deck);
    }

    resumeBackgroundRunFor(ndc);
  }

  let routeChangeTimer = null;
  let routeChangeChain = Promise.resolve();
  function handleRouteChange() {
    clearTimeout(routeChangeTimer);
    routeChangeTimer = setTimeout(() => {
      const run = () => handleRouteChangeInner()
        .catch((cause) => logUnhandled(cause, 'Updating Nexus route'));
      routeChangeChain = routeChangeChain.then(run, run);
    }, 150);
  }

  async function handleRouteChangeInner() {
    if (!bootstrapDone) return;

    UI.cleanupOrphanedPortals?.();

    const route = extractRouteDetails(location.pathname);
    if (!route) {
      if (previousRoute === null && !activeNdc) return;
      previousRoute = null;
      deckMountRun++;
      teardownActiveCollection();
      activeNdc = null;
      return;
    }

    const { gameDomain, collectionSlug, revisionNumber } = route;
    const routeKey = `${gameDomain}/${collectionSlug}/`;
    const parsedRevision = revisionNumber ? parseInt(revisionNumber, 10) : NaN;
    const rev = Number.isFinite(parsedRevision) ? parsedRevision : null;

    if (previousRoute !== routeKey || activeNdc?.revision !== rev) {
      previousRoute = routeKey;
      deckMountRun++;

      teardownActiveCollection();

      activeNdc = new NDC(gameDomain, collectionSlug, rev);
      initAttempts = 0;
      initRetryAt = 0;
      await startCollection(activeNdc);
      return;
    }

    if (activeNdc && !activeNdc.initialized) {
      if (Date.now() < initRetryAt) return;
      await startCollection(activeNdc);
      return;
    }

    if (activeNdc && !document.getElementById('nxtk-control-deck')) {
      await ensureControlDeckMounted(activeNdc);
    }
  }

  async function startCollection(ndc) {
    const success = await ndc.init();
    if (activeNdc !== ndc) return;
    if (!success) {
      initAttempts += 1;
      const retryDelay = Math.min(INIT_RETRY_BASE_MS * Math.pow(2, initAttempts - 1), INIT_RETRY_MAX_MS);
      initRetryAt = Date.now() + retryDelay;
      clearTimeout(initRetryTimer);
      initRetryTimer = setTimeout(() => {
        initRetryTimer = null;
        if (activeNdc === ndc && !ndc.initialized) handleRouteChange();
      }, retryDelay);
      if (initAttempts === 1 && ndc.showAlertsOnError) {
        UI.showError(ndc.lastError, { title: NXTK.t('dlgCantLoadCollection', null, 'Could not load collection') });
      }
      return;
    }
    initAttempts = 0;
    initRetryAt = 0;
    clearTimeout(initRetryTimer);
    initRetryTimer = null;
    await ensureControlDeckMounted(ndc);
  }

  function navKey() {
    return location.origin + location.pathname + location.search;
  }

  let lastNavKey = navKey();

  function syncNavigation() {
    const key = navKey();
    if (key === lastNavKey) return;
    lastNavKey = key;
    if (!bootstrapDone) return;
    NNW.onNavigate().catch((cause) => logUnhandled(cause, 'Applying page navigation'));
    handleRouteChange();
  }

  window.addEventListener('popstate', syncNavigation);

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg?.type !== 'TOGGLE_POPOUT') return false;
      UI.showSettingsModal().catch((cause) => {
        const error = logUnhandled(cause, 'Opening page settings');
        UI.showError?.(error, { title: NXTK.t('dlgCantOpenSettings', null, 'Could not open settings') });
      });
      sendResponse({ ok: true });
      return false;
    });
  } catch (_) {
  }

  function isExtensionOwnedMutation(mutation) {
    const target = mutation.target;
    if (!target || target.nodeType !== 1) return false;
    return !!target.closest?.('[id^="nxtk-"], .nxtk-deck, .nxtk-modal-backdrop, #nxtk-dropdown-portal');
  }

  async function bootstrap() {
    await waitForSafeStartup();
    await NNW.init();
    UI.createSettingsFAB();
    bootstrapDone = true;

    syncNavigation();

    const observer = new MutationObserver((mutations) => {
      if (mutations.every(isExtensionOwnedMutation)) return;
      syncNavigation();
      handleRouteChange();
      syncPollRate();
    });

    let observedRoot = null;
    function syncObserverRoot() {
      const root = document.getElementById('mainContent') || document.body;
      if (!root || root === observedRoot) return;
      observer.disconnect();
      observer.observe(root, { childList: true, subtree: true });
      observedRoot = root;
      handleRouteChange();
    }

    syncObserverRoot();
    handleRouteChange();

    let pollTimer = null;
    let pollInterval = 0;

    function syncPollRate() {
      const actionable = NNW.isActionablePage?.() || !!extractRouteDetails(location.pathname);
      const next = actionable ? ACTIVE_POLL_MS : IDLE_POLL_MS;
      if (next === pollInterval) return;
      pollInterval = next;
      clearInterval(pollTimer);
      pollTimer = setInterval(tick, next);
    }

    function tick() {
      syncObserverRoot();
      syncNavigation();
      syncPollRate();
    }

    syncPollRate();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      syncObserverRoot();
      syncNavigation();
      syncPollRate();
    });
  }

  bootstrap().catch((cause) => {
    const error = logUnhandled(cause, 'Starting NexusMods Bypass');
    UI.showError?.(error, { title: NXTK.t('dlgStartupIssue', null, 'Extension startup issue') });
  });
})();
