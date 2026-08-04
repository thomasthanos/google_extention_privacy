/* main.js — Entry point: initializes NNW + NDC on Nexus Mods pages */
(function () {
  'use strict';

  const { NNW, UI, NDC } = window.NexusExt;

  // Collection downloader: detect collection pages
  let previousRoute = null;
  let activeNdc = null;
  let deckMountRun = 0;
  let bootstrapDone = false;
  let initAttempts = 0;
  let initRetryAt = 0;

  const INIT_RETRY_BASE_MS = 15000;
  const INIT_RETRY_MAX_MS = 5 * 60 * 1000;

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

  // Record uncaught extension-script errors (not page noise) so bug reports
  // include them. Page scripts share the same window 'error' event, so filter
  // by the script origin.
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
    // Nexus is a React application. Do not inject extension UI while React is
    // hydrating its server-rendered markup, otherwise React can report a
    // hydration mismatch and discard parts of the page.
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

  /* Stops the old collection instance and clears every UI surface that closes
     over it: the in-flight download loop (abort), the deck, open modals, and
     any dropdown menus portaled to document.body. */
  function teardownActiveCollection() {
    activeNdc?.dispose?.();
    UI.closeExtensionOverlays?.();

    const deck = document.getElementById('nxtk-control-deck');
    if (!deck) return;

    UI.disposeControlDeck?.(deck);
    deck.remove();
  }

  /* A browser-mode run survives its page, so a freshly mounted deck may be looking at one
     already in flight. Reattaching restores the progress bar and the Stop button. */
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

    // After mounting: createControlDeck is what assigns ndc.ui, which the reattach
    // needs. Not awaited — it lives for the whole run.
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

    // Portaled menus can be orphaned when React re-renders the page without a
    // route change; this is a no-op when nothing is orphaned.
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
    /* parseInt returns NaN for a non-numeric segment, and `NaN !== NaN` made the
       identity test below true on EVERY tick — so a URL such as .../revisions/latest
       tore the collection down and rebuilt it (GraphQL request, deck, open dialogs)
       once a second forever. Anything not a real number is treated as "no revision". */
    const parsedRevision = revisionNumber ? parseInt(revisionNumber, 10) : NaN;
    const rev = Number.isFinite(parsedRevision) ? parsedRevision : null;

    if (previousRoute !== routeKey || activeNdc?.revision !== rev) {
      previousRoute = routeKey;
      deckMountRun++;

      // Stop and clean up the previous collection before swapping instances.
      teardownActiveCollection();

      activeNdc = new NDC(gameDomain, collectionSlug, rev);
      initAttempts = 0;
      initRetryAt = 0;
      await startCollection(activeNdc);
      return;
    }

    /* A collection whose init() failed used to be abandoned for the life of the page:
       previousRoute and activeNdc were already set, so every later tick took the
       branch below and ensureControlDeckMounted bailed on !initialized. One transient
       GraphQL failure meant no deck until a reload. Retried with backoff instead. */
    if (activeNdc && !activeNdc.initialized) {
      if (Date.now() < initRetryAt) return;
      await startCollection(activeNdc);
      return;
    }

    if (activeNdc && !document.getElementById('nxtk-control-deck')) {
      await ensureControlDeckMounted(activeNdc);
    }
  }

  /* init() is idempotent on the same instance (watchSettings self-guards, the
     lifecycle signal is untouched), so a retry reuses it rather than rebuilding. */
  async function startCollection(ndc) {
    const success = await ndc.init();
    if (activeNdc !== ndc) return;
    if (!success) {
      initAttempts += 1;
      initRetryAt = Date.now()
        + Math.min(INIT_RETRY_BASE_MS * Math.pow(2, initAttempts - 1), INIT_RETRY_MAX_MS);
      // Only the first failure raises a dialog; the retries are silent, or every
      // backoff tick would reopen a modal the user has just dismissed.
      if (initAttempts === 1 && ndc.showAlertsOnError) {
        UI.showError(ndc.lastError, { title: NXTK.t('dlgCantLoadCollection', null, 'Could not load collection') });
      }
      return;
    }
    initAttempts = 0;
    initRetryAt = 0;
    await ensureControlDeckMounted(ndc);
  }

  /* Nexus routes via history.pushState in the MAIN world; content scripts have their own
     `history` binding, so patching it here can NEVER see a navigation — do not reintroduce
     that. Every signal we can see funnels into syncNavigation(), the single place
     lastNavKey is compared. The hash is stripped deliberately: keying on it would let a
     '#comments' change start the same download twice. */
  function navKey() {
    return location.origin + location.pathname + location.search;
  }

  let lastNavKey = navKey();

  function syncNavigation() {
    const key = navKey();
    // Compare-and-set is the debounce: a mutation burst yields one onNavigate.
    if (key === lastNavKey) return;
    lastNavKey = key;
    // Pre-bootstrap changes only need to resync the key — NNW.init() applies
    // whatever URL is current when it runs.
    if (!bootstrapDone) return;
    NNW.onNavigate().catch((cause) => logUnhandled(cause, 'Applying page navigation'));
    handleRouteChange();
  }

  /* Live and load-bearing: popstate DOES cross into the isolated world, so this is
     the only immediate signal for browser Back/Forward. The observer and the 1s tick
     below are the fallbacks for router pushes we cannot see. */
  window.addEventListener('popstate', syncNavigation);

  // Listen for settings updates from popup
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'TOGGLE_POPOUT') {
        UI.showSettingsModal().catch((cause) => {
          const error = logUnhandled(cause, 'Opening page settings');
          UI.showError?.(error, { title: NXTK.t('dlgCantOpenSettings', null, 'Could not open settings') });
        });
      }
    });
  } catch (_) {
    // Extension context already invalidated at load — listener not needed.
  }

  /* Skip mutation batches that only touch extension-owned nodes (log rows,
     modals, the dropdown portal) — otherwise our own DOM writes during a
     download keep re-triggering the route check for nothing. */
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

    // The URL may have moved during waitForSafeStartup()/NNW.init() via an
    // unobserved MAIN-world pushState. lastNavKey is deliberately NOT reseeded
    // above, so this call replays a navigation init() may have half-applied.
    syncNavigation();

    const observer = new MutationObserver((mutations) => {
      if (mutations.every(isExtensionOwnedMutation)) return;
      // The batch that says the deck may need remounting also says the URL may
      // have moved. This is the primary SPA-navigation detector — it is what
      // already makes collection route changes work. No-op when the URL is same.
      syncNavigation();
      // Unconditional: re-renders that do NOT change the URL still need the
      // deck/portal lifecycle to run.
      handleRouteChange();
    });

    /* React can replace the whole #mainContent element, not just its children.
       The observer stays bound to the detached old node and then receives nothing
       — silently dead, with no error. Re-point it whenever the live element is no
       longer the one being observed. Called from the same 1s tick below, so no
       extra timer is introduced. */
    let observedRoot = null;
    function syncObserverRoot() {
      const root = document.getElementById('mainContent') || document.body;
      if (!root || root === observedRoot) return;
      observer.disconnect();
      observer.observe(root, { childList: true, subtree: true });
      observedRoot = root;
      // The replacement is itself a route-level change worth reacting to.
      handleRouteChange();
    }

    syncObserverRoot();
    handleRouteChange();

    /* Belt and braces for a URL change that mutates nothing under #mainContent,
       and the recovery path when #mainContent is swapped out. One string compare
       plus one element compare per second. */
    setInterval(() => {
      syncObserverRoot();
      syncNavigation();
    }, 1000);
    // Background tabs get their timers throttled, so recover on refocus.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      syncObserverRoot();
      syncNavigation();
    });
  }

  bootstrap().catch((cause) => {
    const error = logUnhandled(cause, 'Starting NexusMods Bypass');
    UI.showError?.(error, { title: NXTK.t('dlgStartupIssue', null, 'Extension startup issue') });
  });
})();
