window.NexusExt = window.NexusExt || {};

(function () {
  'use strict';

  const { NDC_CONSTANTS } = NexusExt;
  const { DOWNLOAD_METHOD_VORTEX, DOWNLOAD_METHOD_BROWSER, STATUS_DOWNLOADING, STATUS_PAUSED, STATUS_FINISHED, STATUS_STOPPED, STATUS_TEXT, convertSize } = NDC_CONSTANTS;

  const ICONS = {
    chevronDown: '<svg viewBox="0 0 24 24"><path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/></svg>',
    chevronRight: '<svg viewBox="0 0 24 24"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8,5.14V19.14L19,12.14L8,5.14Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M14,19H18V5H14M6,19H10V5H6V19Z"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><path d="M18,18H6V6H18V18Z"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.04 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.04 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z"/></svg>',
    vortex: '<svg viewBox="0 0 24 24"><path d="M6.83,19C6.92,19.13 7.13,19.39 7.49,19.57C7.81,19.73 8.1,19.75 8.26,19.75L6.32,19.96ZM7.11,17.65L7.12,17.67C7.24,17.84 8.17,19.02 10.29,18.83C10.29,18.83 9.23,19.71 8.01,19.04C6.94,18.45 7.11,17.65 7.11,17.65ZM6.52,15.91C6.52,15.91 8.08,17.28 10.79,17.28C12.57,17.28 12.88,17 12.9,16.98C12.9,16.98 12.56,18.13 10.19,18.13C7.83,18.13 6.52,16.47 6.52,15.91ZM16.01,13.8C16.01,13.8 17.15,16.3 11.03,16.3C6.23,16.3 5.16,13.96 5.16,13.96L5.18,13.98C5.36,14.11 7.04,15.3 10.73,15.3C14.65,15.3 16.01,13.8 16.01,13.8ZM20.39,9.56C20.55,9.78 20.64,10.03 20.64,10.31C20.62,12.12 15.75,14.33 10.01,14.28C4.27,14.23 3.23,12.19 3.23,12.19C3.23,12.19 5.35,13.09 8.41,13.12C11.61,13.15 17.72,12.07 18.58,10.35C19.27,10.09 19.87,9.82 20.39,9.56ZM13.36,7.63C14.69,7.64 16.06,7.76 17.25,8C16.82,8.17 16.31,8.34 15.72,8.51C13.24,8.09 9.67,8.05 6.96,8.66L6.96,8.76L7.68,9.65C7.06,9.4 6.15,9.26 5.45,9.23C6,8.81 6.65,8.18 7,7.63L6.96,8.63C8.26,8.25 10.88,7.61 13.36,7.63ZM12.7,9.66C4.21,11.39 2.68,9.66 2.57,9.1C2.46,8.54 3.92,6.46 11.36,5.04C18.79,3.62 20.97,4.89 21.08,5.45C21.19,6 21.19,7.93 12.7,9.66ZM22.91,5.25C22.72,4.3 19.98,1.92 11.18,3.57C2.38,5.23 0.83,8.62 1.02,9.57C1.21,10.53 3.23,13.63 13.26,11.55C23.29,9.53 23.09,6.54 22.91,5.25Z"/></svg>',
    browser: '<svg viewBox="0 0 24 24"><path d="M16 10L12 14L8 10H10.5V6H13.5V10H16M12 2C17.5 2 22 6.5 22 12C22 17.5 17.5 22 12 22C6.5 22 2 17.5 2 12C2 6.5 6.5 2 12 2M12 4C7.58 4 4 7.58 4 12C4 16.42 7.58 20 12 20C16.42 20 20 16.42 20 12C20 7.58 16.42 4 12 4Z"/></svg>',
    info: '<svg viewBox="0 0 24 24"><path d="M13,9H11V7H13M13,17H11V11H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"/></svg>',
    dots: '<svg viewBox="0 0 24 24"><path d="M12,16A2,2 0 0,1 14,18A2,2 0 0,1 12,20A2,2 0 0,1 10,18A2,2 0 0,1 12,16M12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12A2,2 0 0,1 12,10M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8A2,2 0 0,1 10,6A2,2 0 0,1 12,4Z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M9,16.17L4.83,12L3.41,13.41L9,19L21,7L19.59,5.59L9,16.17Z"/></svg>',
    checkAll: '<svg viewBox="0 0 24 24"><path d="M0.41,13.41L6,19L7.41,17.58L1.83,12M22.24,5.58L11.66,16.17L7.5,12L6.07,13.41L11.66,19L23.66,7M18,7L16.59,5.58L10.24,11.93L11.66,13.34L18,7Z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg>',
    invert: '<svg viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12S6.5 22 12 22 22 17.5 22 12 17.5 2 12 2M6.5 9L10 5.5L13.5 9H11V13H9V9H6.5M17.5 15L14 18.5L10.5 15H13V11H15V15H17.5Z"/></svg>',
    exportIcon: '<svg viewBox="0 0 24 24"><path d="M9,16V10H5L12,3L19,10H15V16H9M5,20V18H19V20H5Z"/></svg>',
    importIcon: '<svg viewBox="0 0 24 24"><path d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z"/></svg>',
    spinner: '<svg viewBox="0 0 24 24"><path d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z"/></svg>',
    github: '<svg viewBox="0 0 24 24"><path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2.24c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.69-1.29-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.04 1.77 2.72 1.26 3.38.96.1-.75.41-1.26.74-1.55-2.57-.29-5.27-1.29-5.27-5.69 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.16 1.18A10.9 10.9 0 0 1 12 6.14c.98 0 1.96.13 2.88.39 2.19-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.75.11 3.04.74.8 1.19 1.82 1.19 3.08 0 4.41-2.71 5.39-5.29 5.68.42.36.78 1.07.78 2.16v3.24c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .7Z"/></svg>'
  };

  function svgIcon(name, extraClass) {
    const html = ICONS[name] || '';
    if (!extraClass) return html;
    return html.replace('<svg ', `<svg class="${extraClass}" `);
  }

  const escapeHtml = NXTK.escapeHtml;

  const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  const L = (key, fallback) => escapeHtml(NXTK.t(key, null, fallback));

  function normalizeImportName(value) {
    return String(value || '')
      .replace(/\.[a-z0-9]{1,8}$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function normalizeModKeys(mod) {
    return {
      uri: normalizeImportName(mod?.file?.uri),
      name: normalizeImportName(mod?.file?.name)
    };
  }

  function normalizedNameMatches(candidate, keys) {
    if (!candidate) return false;
    if (keys.uri.length >= 4 && keys.uri === candidate) return true;
    if (keys.name.length < 4 || !candidate.startsWith(keys.name)) return false;
    const suffix = candidate.slice(keys.name.length).trim();
    return suffix === '' || /^[0-9 ]+$/.test(suffix);
  }

  function fileNameMatchesMod(fileName, mod) {
    return normalizedNameMatches(normalizeImportName(fileName), normalizeModKeys(mod));
  }

  function matchModsToFileNames(mods, fileNames) {
    const candidates = fileNames.map(normalizeImportName);
    const modKeys = mods.map(normalizeModKeys);
    const matchedIndexes = new Set();
    const matched = mods.filter((mod, modIndex) => {
      const keys = modKeys[modIndex];
      let hit = false;
      for (let i = 0; i < candidates.length; i += 1) {
        if (!normalizedNameMatches(candidates[i], keys)) continue;
        matchedIndexes.add(i);
        hit = true;
      }
      return hit;
    });
    return { matched, unmatchedCount: candidates.length - matchedIndexes.size };
  }

  function openReportIssue(url = NXTK.REPORT_ISSUE_URL) {
    if (NexusExt.Errors?.openReportIssue) {
      NexusExt.Errors.openReportIssue(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function copyReportAndOpenIssue(button, currentError = null) {
    let copied = false;
    let complete = false;
    let issueUrl = NXTK.REPORT_ISSUE_URL;
    try {
      const report = await NXTK.buildBugReport(currentError);
      const result = await NXTK.buildReportIssueUrl(currentError, { fullReport: report });
      issueUrl = result.url;
      complete = result.complete;
      if (!complete) copied = await NXTK.copyText(report);
    } catch (_) {
      copied = false;
    }
    if (button) {
      const label = button.querySelector('[data-report-label]') || button;
      const originalText = label.textContent;
      button.disabled = true;
      /* The third case is truncated *and* not on the clipboard, so the maintainer will only ever
         see the short report. popupReportNoCopy is the popup's wording for the same outcome and
         is already translated in all 13 locales; dlgReportOpeningPrefilled would claim the report
         went through. */
      label.textContent = complete
        ? NXTK.t('dlgReportOpeningFull', null, 'GitHub opens with the full report…')
        : copied
          ? NXTK.t('dlgReportOpeningCopied', null, 'Report copied — GitHub opens prefilled…')
          : NXTK.t('popupReportNoCopy', null, 'GitHub opens prefilled — the full report could not be copied.');
      setTimeout(() => {
        button.disabled = false;
        label.textContent = originalText;
      }, 2500);
    }
    openReportIssue(issueUrl);
  }

  function runUiTask(task, { context = 'Running extension action', title = 'Extension action failed' } = {}) {
    Promise.resolve()
      .then(task)
      .catch((cause) => {
        const error = NexusExt.Errors?.fromException
          ? NexusExt.Errors.fromException(cause, { context })
          : cause;
        showError(error, { title });
      });
  }

  function applyGlassLayers(el) {
    if (!el || el.dataset.nxtkGlass === '1') return;
    el.dataset.nxtkGlass = '1';

    const specular = document.createElement('span');
    specular.className = 'nxtk-glass-specular';
    specular.setAttribute('aria-hidden', 'true');

    const sheen = document.createElement('span');
    sheen.className = 'nxtk-glass-sheen';
    sheen.setAttribute('aria-hidden', 'true');

    el.insertBefore(sheen, el.firstChild);
    el.insertBefore(specular, el.firstChild);
  }

  function decorateGlass(root) {
    if (!root) return root;
    const selectors = [
      '.nxtk-deck',
      '.nxtk-settings-fab'
    ];
    selectors.forEach((sel) => {
      const matches = root.matches?.(sel) ? [root] : [];
      root.querySelectorAll?.(sel).forEach((el) => matches.push(el));
      matches.forEach(applyGlassLayers);
    });
    return root;
  }

  function prepareToolkitSurface(root) {
    if (!root) return root;

    root.querySelectorAll('button').forEach((button) => {
      if (!button.getAttribute('type')) button.type = 'button';
      button.draggable = false;
    });

    root.querySelectorAll('.nxtk-btn, .nxtk-selector-item, .nxtk-dropdown-item, .nxtk-history-option, .nxtk-modal-close, .nxtk-radio-label, .nxtk-mod-item').forEach((el) => {
      el.draggable = false;
    });

    decorateGlass(root);

    return root;
  }

  let dropdownInteractionBlockerBound = false;
  let overlayScrollLockAttached = false;

  const openDropdownMenuSet = new Set();
  const dropdownTriggers = new WeakMap();

  function getOpenDropdownMenus() {
    const menus = [];
    openDropdownMenuSet.forEach((menu) => {
      if (menu.isConnected && menu.classList.contains('nxtk-open')) menus.push(menu);
      else openDropdownMenuSet.delete(menu);
    });
    return menus;
  }

  function findDropdownTrigger(menu) {
    const cached = dropdownTriggers.get(menu);
    if (cached?.isConnected) return cached;
    if (!menu.id) return null;
    return Array.from(document.querySelectorAll('[aria-controls]'))
      .find((trigger) => trigger.getAttribute('aria-controls') === menu.id) || null;
  }

  const dropdownPortals = new Map();
  const dropdownControllers = new WeakMap();

  function getDropdownSurface(menu) {
    return dropdownPortals.get(menu)?.surface
      || menu.closest('.nxtk-deck, .nxtk-modal');
  }

  function getDropdownPortalRoot() {
    let root = document.getElementById('nxtk-dropdown-portal');
    if (!root) {
      root = document.createElement('div');
      root.id = 'nxtk-dropdown-portal';
      root.dataset.nxtkOwned = '1';
      document.body.appendChild(root);
    }
    return root;
  }

  function positionDropdownPortal(menu) {
    const state = dropdownPortals.get(menu);
    if (!state || !state.trigger.isConnected) return;

    const triggerRect = state.trigger.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const maxLeft = Math.max(margin, viewportWidth - menuWidth - margin);
    const left = Math.min(Math.max(margin, triggerRect.right - menuWidth), maxLeft);
    const below = triggerRect.bottom + gap;
    const above = triggerRect.top - menuHeight - gap;
    const maxTop = Math.max(margin, viewportHeight - menuHeight - margin);
    const top = below + menuHeight <= viewportHeight - margin || above < margin
      ? Math.min(below, maxTop)
      : above;

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  function mountDropdownPortal(menu, trigger, surface) {
    const existing = dropdownPortals.get(menu);
    if (existing) {
      existing.updatePosition();
      return true;
    }

    const owner = menu.parentElement;
    if (!owner || !document.body) return false;

    const placeholder = document.createComment('nxtk-dropdown-anchor');
    const state = {
      owner,
      placeholder,
      surface,
      trigger,
      root: getDropdownPortalRoot(),
      left: menu.style.left,
      top: menu.style.top,
      frame: 0,
      updatePosition: null,
      resizeObserver: null
    };

    state.updatePosition = () => {
      if (state.frame) return;
      state.frame = requestAnimationFrame(() => {
        state.frame = 0;
        positionDropdownPortal(menu);
      });
    };

    owner.replaceChild(placeholder, menu);
    dropdownPortals.set(menu, state);
    menu.classList.add('nxtk-dropdown-portaled');
    state.root.appendChild(menu);

    window.addEventListener('resize', state.updatePosition);
    window.addEventListener('scroll', state.updatePosition, true);
    document.addEventListener('scroll', state.updatePosition, true);
    window.visualViewport?.addEventListener('resize', state.updatePosition);
    window.visualViewport?.addEventListener('scroll', state.updatePosition);

    if (window.ResizeObserver) {
      state.resizeObserver = new window.ResizeObserver(state.updatePosition);
      state.resizeObserver.observe(trigger);
      state.resizeObserver.observe(menu);
    }

    positionDropdownPortal(menu);
    return true;
  }

  function restoreDropdownPortal(menu) {
    const state = dropdownPortals.get(menu);
    if (!state) return;

    window.removeEventListener('resize', state.updatePosition);
    window.removeEventListener('scroll', state.updatePosition, true);
    document.removeEventListener('scroll', state.updatePosition, true);
    window.visualViewport?.removeEventListener('resize', state.updatePosition);
    window.visualViewport?.removeEventListener('scroll', state.updatePosition);
    state.resizeObserver?.disconnect();
    if (state.frame) cancelAnimationFrame(state.frame);

    if (state.placeholder.parentNode) {
      state.placeholder.replaceWith(menu);
    } else if (state.owner.isConnected) {
      state.owner.appendChild(menu);
    } else {
      menu.remove();
    }

    menu.classList.remove('nxtk-dropdown-portaled');
    menu.style.left = state.left;
    menu.style.top = state.top;
    dropdownPortals.delete(menu);
    if (!state.root.childElementCount) state.root.remove();
  }

  function closeDropdownMenu(menu) {
    const controller = dropdownControllers.get(menu);
    if (controller) {
      controller.close();
      return;
    }

    menu.classList.remove('nxtk-open');
    openDropdownMenuSet.delete(menu);
    menu.parentElement?.classList.remove('nxtk-dropdown-active');
    findDropdownTrigger(menu)?.setAttribute('aria-expanded', 'false');
    restoreDropdownPortal(menu);
  }

  function disposeDropdownMenu(menu) {
    const controller = dropdownControllers.get(menu);
    if (controller) controller.dispose();
    else closeDropdownMenu(menu);
  }

  function isDropdownUiTarget(target, openMenus = getOpenDropdownMenus()) {
    if (!target) return false;
    if (target.closest?.('.nxtk-dropdown, .nxtk-custom-select')) return true;
    return openMenus.some((menu) => menu.contains(target) || findDropdownTrigger(menu)?.contains(target));
  }

  const liftedAncestors = new Map();

  function releaseAllLifts() {
    for (const [node, original] of liftedAncestors) {
      node.style.zIndex = original.zIndex;
      node.style.position = original.position;
    }
    liftedAncestors.clear();
  }

  function setDeckLift(deck, lift) {
    if (!lift) {
      releaseAllLifts();
      return;
    }
    let node = deck?.parentElement || null;
    while (node && node !== document.body && node !== document.documentElement) {
      if (!liftedAncestors.has(node)) {
        liftedAncestors.set(node, {
          zIndex: node.style.zIndex,
          position: node.style.position
        });
        if (getComputedStyle(node).position === 'static') {
          node.style.position = 'relative';
        }
        node.style.zIndex = '9999';
      }
      node = node.parentElement;
    }
  }

  function syncDropdownSurfaces() {
    syncOverlayScrollLock();
    document.querySelectorAll('.nxtk-deck, .nxtk-modal').forEach((surface) => {
      const active = getOpenDropdownMenus().some((menu) => (
        !dropdownPortals.has(menu) && getDropdownSurface(menu) === surface
      ));
      surface.classList.toggle('nxtk-dropdown-active', active);
      if (surface.classList.contains('nxtk-deck')) setDeckLift(surface, active);
    });
  }

  function disposeControlDeck(deck) {
    if (!deck) return;

    const menus = new Set([
      ...deck.querySelectorAll('.nxtk-dropdown-menu'),
      ...getOpenDropdownMenus().filter((menu) => getDropdownSurface(menu) === deck)
    ]);
    menus.forEach(disposeDropdownMenu);
    deck.classList.remove('nxtk-dropdown-active');
    setDeckLift(deck, false);
  }

  function closeAllDropdownMenus() {
    getOpenDropdownMenus().forEach(closeDropdownMenu);
    syncDropdownSurfaces();
  }

  function cleanupOrphanedPortals() {
    Array.from(dropdownPortals.keys()).forEach((menu) => {
      const state = dropdownPortals.get(menu);
      if (!state?.trigger?.isConnected) disposeDropdownMenu(menu);
    });
  }

  const NDC_BOUND_MODAL_IDS = [
    'nxtk-error-modal',
    'nxtk-vortex-check-modal',
    'nxtk-history-modal',
    'nxtk-import-info-modal',
    'nxtk-select-modal',
    'nxtk-update-modal'
  ];

  function closeExtensionOverlays() {
    NDC_BOUND_MODAL_IDS.forEach(closeModal);
    closeAllDropdownMenus();
    cleanupOrphanedPortals();
  }

  function ensureDropdownInteractionBlocker() {
    if (dropdownInteractionBlockerBound) return;
    dropdownInteractionBlockerBound = true;

    /* pointerdown does not gate scrolling, so it stays bound for the life of the page. Only the
       scroll-cancelling listeners are attached on demand — see syncOverlayScrollLock. */
    document.addEventListener('pointerdown', (event) => {
      const openMenus = getOpenDropdownMenus();
      if (!openMenus.length || isDropdownUiTarget(event.target, openMenus)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeAllDropdownMenus();
    }, true);
  }

  function syncDropdownPageLock() {
    ensureDropdownInteractionBlocker();
    syncDropdownSurfaces();
  }

  let modalInteractionGuardBound = false;

  function getTopModalBackdrop() {
    const backdrops = Array.from(document.querySelectorAll('.nxtk-modal-backdrop'));
    return backdrops[backdrops.length - 1] || null;
  }

  function canScrollModalTarget(target, modal, deltaY) {
    let node = target;
    while (node && node !== modal.parentElement) {
      if (node.nodeType === 1 && modal.contains(node)) {
        const style = getComputedStyle(node);
        const canScroll = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
        if (canScroll) {
          const atTop = node.scrollTop <= 0;
          const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
          return deltaY < 0 ? !atTop : !atBottom;
        }
      }
      node = node.parentElement;
    }
    return false;
  }

  function ensureModalInteractionGuard() {
    if (modalInteractionGuardBound) return;
    modalInteractionGuardBound = true;

    document.addEventListener('pointerdown', (event) => {
      const backdrop = getTopModalBackdrop();
      if (!backdrop) return;

      const modal = backdrop.querySelector('.nxtk-modal');
      if (!modal) return;

      if (!modal.contains(event.target) && event.target !== backdrop) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }
  ensureModalInteractionGuard();

  /* Cancelling a scroll needs `passive: false`, which forces the browser to block on JS before every
     wheel and touchmove frame. These listeners used to be bound for the whole life of every page the
     content script matches — the entire site, not just pages with extension UI — so every scroll frame
     paid for a handler that almost always early-returned after a document-wide querySelectorAll.
     They are now attached only while an extension overlay is actually open, and removed again after.
     The handler below merges what used to be two separate capture listeners on `document`; since
     stopPropagation does not stop other listeners on the same node, both bodies always ran, so running
     them in sequence here is equivalent. */
  function applyDropdownScrollBlock(event) {
    const openMenus = getOpenDropdownMenus();
    if (!openMenus.length || isDropdownUiTarget(event.target, openMenus)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onOverlayWheel(event) {
    applyDropdownScrollBlock(event);

    const backdrop = getTopModalBackdrop();
    if (!backdrop) return;
    const modal = backdrop.querySelector('.nxtk-modal');
    if (!modal) return;
    if (!modal.contains(event.target) || !canScrollModalTarget(event.target, modal, event.deltaY)) {
      event.preventDefault();
    }
    event.stopPropagation();
  }

  function onOverlayTouchMove(event) {
    applyDropdownScrollBlock(event);
  }

  function syncOverlayScrollLock() {
    /* getOpenDropdownMenus() rather than the raw Set: the Set can still hold menus that have been
       disconnected, and reading through the getter prunes them, so the lock is not held open by a
       menu that is already gone. */
    const needed = getOpenDropdownMenus().length > 0 || !!document.querySelector('.nxtk-modal-backdrop');
    if (needed === overlayScrollLockAttached) return;
    overlayScrollLockAttached = needed;
    if (needed) {
      document.addEventListener('wheel', onOverlayWheel, { capture: true, passive: false });
      document.addEventListener('touchmove', onOverlayTouchMove, { capture: true, passive: false });
      return;
    }
    document.removeEventListener('wheel', onOverlayWheel, true);
    document.removeEventListener('touchmove', onOverlayTouchMove, true);
  }

  /* Every modal appends its backdrop directly to document.body and removes it there, across nine
     separate builders. Watching body's direct children — childList only, no subtree — catches all of
     them without threading a hook through each one, and body's own child list changes rarely. */
  function watchOverlayPresence() {
    if (!document.body) return;
    new MutationObserver(syncOverlayScrollLock)
      .observe(document.body, { childList: true });
  }
  watchOverlayPresence();

  function bindDropdownToggle(button, menu, { portal = false } = {}) {
    if (!button || !menu) return null;

    let pointerHandled = false;
    const surface = menu.closest('.nxtk-deck, .nxtk-modal');
    const menuHost = menu.parentElement;
    const syncSurfaceState = () => {
      const hasOpenMenu = getOpenDropdownMenus().some((otherMenu) => (
        !dropdownPortals.has(otherMenu) && getDropdownSurface(otherMenu) === surface
      ));
      surface?.classList.toggle('nxtk-dropdown-active', hasOpenMenu);
      syncDropdownPageLock();
    };
    const closeOtherMenus = () => {
      getOpenDropdownMenus().forEach((otherMenu) => {
        if (otherMenu === menu) return;
        if (getDropdownSurface(otherMenu) === surface) closeDropdownMenu(otherMenu);
      });
    };
    const setMenuOpen = (open) => {
      const shouldOpen = !!open && document.contains(menu);
      if (shouldOpen) {
        closeOtherMenus();
        if (portal) mountDropdownPortal(menu, button, surface);
        menu.classList.add('nxtk-open');
        openDropdownMenuSet.add(menu);
        menuHost?.classList.add('nxtk-dropdown-active');
        dropdownPortals.get(menu)?.updatePosition();
      } else {
        menu.classList.remove('nxtk-open');
        openDropdownMenuSet.delete(menu);
        menuHost?.classList.remove('nxtk-dropdown-active');
        restoreDropdownPortal(menu);
      }
      syncExpandedState();
      syncSurfaceState();
    };
    const closeMenu = () => {
      setMenuOpen(false);
    };
    const syncExpandedState = () => {
      button.setAttribute('aria-expanded', menu.classList.contains('nxtk-open') ? 'true' : 'false');
    };

    const toggleMenu = (e) => {
      if (e.type === 'pointerdown' && e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      setMenuOpen(!menu.classList.contains('nxtk-open'));
    };

    button.setAttribute('type', 'button');
    button.setAttribute('aria-haspopup', 'menu');
    if (menu.id) button.setAttribute('aria-controls', menu.id);
    dropdownTriggers.set(menu, button);
    syncExpandedState();

    button.addEventListener('pointerdown', (e) => {
      pointerHandled = true;
      toggleMenu(e);
    });

    button.addEventListener('click', (e) => {
      if (pointerHandled) {
        pointerHandled = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      toggleMenu(e);
    });

    button.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        pointerHandled = true;
        toggleMenu(e);
      } else if (e.key === 'Escape') {
        closeMenu();
      }
    });

    menu.addEventListener('pointerdown', (e) => e.stopPropagation());
    menu.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('button, [role="menuitem"], .nxtk-dropdown-item, .nxtk-selector-item')) {
        closeMenu();
      }
    });
    const onDocPointerDown = (e) => {
      if (!document.contains(menu)) {
        document.removeEventListener('pointerdown', onDocPointerDown, true);
        document.removeEventListener('keydown', onDocKeyDown);
        return;
      }
      if (!button.contains(e.target) && !menu.contains(e.target)) {
        closeMenu();
      }
    };
    const onDocKeyDown = (e) => {
      if (!document.contains(menu)) {
        document.removeEventListener('pointerdown', onDocPointerDown, true);
        document.removeEventListener('keydown', onDocKeyDown);
        return;
      }
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);
    document.addEventListener('keydown', onDocKeyDown);

    const controller = {
      close() {
        closeMenu();
      },
      isOpen() {
        return menu.classList.contains('nxtk-open');
      },
      dispose() {
        closeMenu();
        document.removeEventListener('pointerdown', onDocPointerDown, true);
        document.removeEventListener('keydown', onDocKeyDown);
        dropdownControllers.delete(menu);
      }
    };
    dropdownControllers.set(menu, controller);
    return controller;
  }

  function bindCustomSelect({ select, trigger, menu, placeholder = 'Select an option' }) {
    if (!select || !trigger || !menu) return null;

    const label = trigger.querySelector('[data-select-label]');
    const controller = bindDropdownToggle(trigger, menu);

    const syncLabel = () => {
      const selectedOption = select.options[select.selectedIndex];
      if (label) label.textContent = selectedOption?.textContent || placeholder;
      menu.querySelectorAll('[data-select-value]').forEach((item) => {
        item.classList.toggle('nxtk-selected', item.dataset.selectValue === select.value);
      });
    };

    const renderOptions = () => {
      menu.innerHTML = Array.from(select.options).map((option) => `
        <button type="button" class="nxtk-dropdown-item nxtk-custom-select-item" data-select-value="${escapeHtml(option.value)}">
          <span>${escapeHtml(option.textContent)}</span>
          <span class="nxtk-custom-select-check">${svgIcon('check')}</span>
        </button>
      `).join('');

      menu.querySelectorAll('[data-select-value]').forEach((item) => {
        item.addEventListener('click', () => {
          select.value = item.dataset.selectValue;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          controller?.close();
          syncLabel();
        });
      });
      syncLabel();
    };

    select.addEventListener('change', syncLabel);
    renderOptions();

    return {
      close: () => controller?.close(),
      refresh: renderOptions
    };
  }

  function createSettingsFAB() {
    let host = document.getElementById('nxtk-extension-root');
    if (!host) {
      host = document.createElement('div');
      host.id = 'nxtk-extension-root';
      host.dataset.nxtkOwned = '1';
      document.body.appendChild(host);
    }

    if (host.querySelector('#nxtk-settings-fab')) return;
    const fab = document.createElement('button');
    fab.id = 'nxtk-settings-fab';
    fab.className = 'nxtk-settings-fab';
    fab.innerHTML = `${svgIcon('settings')} NexusMods Bypass`;
    fab.addEventListener('click', () => runUiTask(
      () => showSettingsModal(),
      { context: 'Opening page settings', title: NXTK.t('dlgCantOpenSettings', null, 'Could not open settings') }
    ));
    host.appendChild(fab);
    applyGlassLayers(fab);
  }

  const SETTINGS_UI = [
    { key: 'AutoStartDownload', label: () => NXTK.t('setAutoStartDownloadLabel', null, 'Start downloads automatically'), type: 'bool', desc: () => NXTK.t('setAutoStartDownloadDesc', null, 'When you open a Nexus file download page, start the Vortex handoff or browser download without another click.') },
    { key: 'AutoCloseTab', label: () => NXTK.t('setAutoCloseTabLabel', null, 'Close Vortex tabs'), type: 'bool', desc: () => NXTK.t('setAutoCloseTabDesc', null, 'After a Vortex link is sent, close the temporary Nexus tab after the delay below.') },
    { key: 'SkipRequirements', label: () => NXTK.t('setSkipRequirementsLabel', null, 'Skip requirement screens'), type: 'bool', desc: () => NXTK.t('setSkipRequirementsDesc', null, 'Continue past Nexus requirements popups and go straight to the download step.') },
    { key: 'ShowAlertsOnError', label: () => NXTK.t('setShowAlertsOnErrorLabel', null, 'Show error popups'), type: 'bool', desc: () => NXTK.t('setShowAlertsOnErrorDesc', null, 'Show a clear message when Nexus does not return a usable download link.') },
    { key: 'HidePremiumUpsells', label: () => NXTK.t('setHidePremiumUpsellsLabel', null, 'Hide ads and Premium panels'), type: 'bool', desc: () => NXTK.t('setHidePremiumUpsellsDesc', null, 'Hide Nexus advertising slots, empty ad containers, Premium banners and upgrade panels while browsing.') },
    { key: 'HandleArchivedFiles', label: () => NXTK.t('setHandleArchivedFilesLabel', null, 'Archived file buttons'), type: 'bool', desc: () => NXTK.t('setHandleArchivedFilesDesc', null, 'Add Vortex and browser download buttons to archived file entries when Nexus hides them.') },
    { key: 'CloudflareFallback', label: () => NXTK.t('setCloudflareFallbackLabel', null, 'Cloudflare fallback'), type: 'bool', desc: () => NXTK.t('setCloudflareFallbackDesc', null, 'When Nexus answers a background download request with a browser verification page, open the file page so you can complete the check, instead of failing. This is why the tab sometimes navigates on its own.') },
    {
      key: 'ForceEnglish',
      group: 'language',
      label: () => NXTK.t('setForceEnglishLabel', null, 'Always use English'),
      type: 'bool',
      desc: () => NXTK.t('setForceEnglishDesc', null, 'Show this extension in English even when your browser is set to another language. Useful when following guides written in English. The extension name in your browser list still follows the browser language.')
    },
    { key: 'DebugLogs', label: () => NXTK.t('setDebugLogsLabel', null, 'Verbose extension logs'), type: 'bool', advanced: true, desc: () => NXTK.t('setDebugLogsDesc', null, 'Print detailed NexusMods Bypass activity in the console. Errors are always shown, and bug reports are unaffected by this setting.') },
    { key: 'DownloadFolder', label: () => NXTK.t('setDownloadFolderLabel', null, 'Browser download folder'), type: 'text', desc: () => NXTK.t('setDownloadFolderDesc', null, 'Subfolder inside your browser Downloads directory, used by Browser Download mode. Leave it empty to save straight into Downloads — some mod managers only watch that folder and never look inside subfolders. Vortex downloads are handled by Vortex and are unaffected.') },
    { key: 'RequestTimeout', label: () => NXTK.t('setRequestTimeoutLabel', null, 'Download request timeout'), type: 'number', unit: () => NXTK.t('unitSeconds', null, 'Seconds'), scale: 1000, advanced: true, desc: () => NXTK.t('setRequestTimeoutDesc', null, 'How long the extension waits for Nexus to return a download link before it gives up.') },
    { key: 'CloseTabDelay', label: () => NXTK.t('setCloseTabDelayLabel', null, 'Close-tab delay'), type: 'number', unit: () => NXTK.t('unitSeconds', null, 'Seconds'), scale: 1000, advanced: true, desc: () => NXTK.t('setCloseTabDelayDesc', null, 'Only applies to auto-started Vortex downloads that close their tab. Increase it if Vortex misses links.') },
    {
      key: 'NDC_downloadSpeed',
      label: () => NXTK.t('setDownloadSpeedLabel', null, 'Your Nexus download speed'),
      type: 'decimal',
      unit: 'MB/s',
      min: 0.1,
      step: 0.1,
      desc: () => NXTK.t('setDownloadSpeedDesc', null, 'Vortex mode only. The browser cannot watch a transfer happening inside Vortex, so this estimates how long each file takes and spaces the hand-offs out. Set it to the speed you actually see — too low and the queue waits far longer than it needs to.')
    },
    {
      key: 'NDC_pauseBetweenDownload',
      label: () => NXTK.t('setPauseBetweenModsLabel', null, 'Pause between mods'),
      type: 'number',
      unit: () => NXTK.t('unitSecondsShort', null, 's'),
      desc: () => NXTK.t('setPauseBetweenModsDesc', null, 'Vortex mode only. Added to the estimate above. Set it to 0 to switch the wait off entirely — including the size estimate — and hand every file to Vortex back to back, letting Vortex queue them itself.')
    }
  ];

  async function showSettingsModal() {
    closeModal('nxtk-settings-modal');

    if (NexusExt.Storage.isContextValid && !NexusExt.Storage.isContextValid()) {
      await nxtkAlert(NXTK.t('alertContextInvalid', null,
        'NexusMods Bypass was updated or reloaded.\nPlease refresh this page to open settings.'));
      return;
    }

    const cfg = await NexusExt.Storage.getSettings();

    const backdrop = document.createElement('div');
    backdrop.className = 'nxtk-modal-backdrop';
    backdrop.id = 'nxtk-settings-modal';

    const modal = document.createElement('div');
    modal.className = 'nxtk-modal nxtk-modal-sm';
    /* Every other dialog in here announces itself; this one did not, so a screen reader read it as
       plain page content and keyboard focus stayed behind it on the page underneath. */
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', NXTK.t('setTitle', null, 'Download Helper Settings'));

    const previouslyFocused = document.activeElement;

    const text = (v) => (typeof v === 'function' ? v() : (v ?? ''));
    const buildRow = (s) => {
      const copy = `<span class="nxtk-setting-copy"><span class="nxtk-setting-title">${escapeHtml(text(s.label))}</span><span class="nxtk-setting-desc">${escapeHtml(text(s.desc))}</span></span>`;
      const timingTitle = `<span class="nxtk-setting-copy"><span class="nxtk-setting-title-row"><span class="nxtk-setting-title">${escapeHtml(text(s.label))}</span><span class="nxtk-setting-info-icon" data-tooltip="${escapeHtml(text(s.desc))}" aria-label="${escapeHtml(text(s.desc))}" tabindex="0">${svgIcon('info')}</span></span></span>`;
      if (s.type === 'bool') {
        return `<div class="nxtk-setting-row" data-key="${s.key}"><label class="nxtk-setting-label"><span class="nxtk-toggle"><input type="checkbox" data-setting="${s.key}" ${cfg[s.key] ? 'checked' : ''}><span class="nxtk-toggle-track"></span></span>${copy}</label></div>`;
      }
      if (s.type === 'number' || s.type === 'decimal') {
        const decimal = s.type === 'decimal' ? ' data-decimal="1"' : '';
        const scale = Number(s.scale) || 1;
        const scaleAttr = scale === 1 ? '' : ` data-scale="${scale}"`;
        const step = s.step ? ` step="${escapeHtml(s.step)}"` : '';
        const min = s.min === undefined ? 0 : s.min;
        const displayValue = Number(cfg[s.key]) / scale;
        return `<div class="nxtk-setting-row nxtk-setting-row-field" data-key="${s.key}"><div class="nxtk-setting-label">${timingTitle}<span class="nxtk-setting-field"><input type="number" data-setting="${s.key}"${decimal}${scaleAttr}${step} value="${escapeHtml(displayValue)}" min="${escapeHtml(min)}"><span class="nxtk-setting-unit">${escapeHtml(text(s.unit))}</span></span></div></div>`;
      }
      if (s.type === 'text') {
        return `<div class="nxtk-setting-row nxtk-setting-row-field" data-key="${s.key}"><div class="nxtk-setting-label">${timingTitle}<span class="nxtk-setting-field"><input type="text" data-setting="${s.key}" value="${escapeHtml(cfg[s.key] ?? '')}" spellcheck="false"></span></div></div>`;
      }
      return '';
    };

    const isField = (s) => s.type === 'number' || s.type === 'decimal' || s.type === 'text';
    const features = SETTINGS_UI.filter(s => s.type === 'bool' && !s.advanced && !s.group).map(buildRow).join('');
    const language = SETTINGS_UI.filter(s => s.group === 'language').map(buildRow).join('');
    const timing = SETTINGS_UI.filter(s => isField(s) && !s.advanced).map(buildRow).join('');
    const advanced = SETTINGS_UI.filter(s => s.advanced).map(buildRow).join('');

    modal.innerHTML = `
      <div class="nxtk-modal-header">
        <div>
          <div class="nxtk-modal-title">${L('setTitle', 'Download Helper Settings')}</div>
          <div class="nxtk-modal-subtitle">${L('setSubtitle', 'Changes save instantly. Restore defaults will reload this page.')}</div>
        </div>
        <button class="nxtk-modal-close" data-close aria-label="${L('ariaClose', 'Close')}">&times;</button>
      </div>
      <div class="nxtk-modal-scroll">
        <div class="nxtk-settings-col nxtk-settings-col-main">
          <div class="nxtk-settings-section nxtk-settings-flow"><div class="nxtk-settings-section-title">${L('setSectionFlow', 'Download Flow')}</div><div class="nxtk-settings-rows">${features}</div></div>
        </div>
        <div class="nxtk-settings-col nxtk-settings-col-side">
          <div class="nxtk-settings-section nxtk-settings-language"><div class="nxtk-settings-section-title">${L('setSectionLanguage', 'Language')}</div><div class="nxtk-settings-rows">${language}</div></div>
          <div class="nxtk-settings-section nxtk-settings-pacing"><div class="nxtk-settings-section-title">${L('setSectionPacing', 'Files & Pacing')}</div><div class="nxtk-settings-rows">${timing}</div></div>
          <div class="nxtk-settings-version">
            <span class="nxtk-settings-version-name">${L('appName', 'NexusMods Bypass')}</span>
            <span class="nxtk-settings-version-tag">v${escapeHtml(chrome.runtime.getManifest().version)}</span>
          </div>
        </div>
        <div class="nxtk-settings-advanced">
          <div class="nxtk-settings-advanced-bar">
            <button type="button" class="nxtk-settings-advanced-toggle" id="nxtk-advanced-toggle"
                    aria-expanded="false" aria-controls="nxtk-advanced-body">${svgIcon('chevronRight')} ${L('setSectionAdvanced', 'Advanced')}</button>
            <div class="nxtk-settings-support">
              <span>${L('setNeedHelp', 'Need help with a download?')}</span>
              <button type="button" class="nxtk-settings-report" data-report-issue>${svgIcon('github')}<span data-report-label>${L('setReportOnGithub', 'Report a bug on GitHub')}</span></button>
            </div>
          </div>
          <div class="nxtk-settings-advanced-body" id="nxtk-advanced-body" hidden>
            <div class="nxtk-settings-advanced-panel">${advanced}</div>
          </div>
        </div>
      </div>
      <div class="nxtk-modal-footer">
        <button class="nxtk-btn nxtk-btn-secondary" data-reset>${L('setRestoreDefaults', 'Restore Defaults & Refresh')}</button>
        <button class="nxtk-btn nxtk-btn-primary" data-close>${L('btnDone', 'Done')}</button>
      </div>
    `;
    prepareToolkitSurface(modal);

    const update = (el) => {
      const key = el.dataset.setting;
      if (!key) return;
      let value;
      if (el.type === 'checkbox') {
        value = el.checked;
      } else if (el.type === 'text') {
        value = el.value.trim();
      } else if (el.dataset.decimal) {
        value = parseFloat(el.value);
        if (!Number.isFinite(value) || value <= 0) return;
      } else {
        value = parseInt(el.value, 10);
        if (isNaN(value)) return;
      }
      if (el.dataset.scale) value *= Number(el.dataset.scale) || 1;
      cfg[key] = value;
      NexusExt.Storage.patchSetting(key, value);
      if (NexusExt.NNW) NexusExt.NNW.updateConfig(cfg);

      if (key === 'ForceEnglish') {
        /* Nothing injected into the page carries data-i18n — every string is baked in at build time
           by L()/T() — so flipping the flag alone changed nothing the user could see and the switch
           looked broken. Rebuild this dialog so the change is visible where it was made; the deck
           picks the new language up the next time it is built. */
        NXTK.setForceEnglish(value);
        close();
        showSettingsModal().catch(() => undefined);
      }
    };

    const onKeyDown = (e) => {
      if (!document.contains(backdrop)) {
        document.removeEventListener('keydown', onKeyDown);
        return;
      }
      if (e.key === 'Escape') close();
    };
    /* Typed fields settle before they are written. `input` fires per keystroke, and update() writes to
       storage, reloads the whole config and re-broadcasts it to every content script — so typing
       "45000" into a timeout persisted 4, then 45, then 450, then 4500, then 45000, each a full round
       trip. Anything still pending is flushed on close, so closing mid-edit does not drop the value. */
    const SETTING_INPUT_DEBOUNCE_MS = 400;
    const pendingInputWrites = new Map();

    const flushPendingInputWrites = () => {
      for (const [target, timer] of pendingInputWrites) {
        clearTimeout(timer);
        if (target.isConnected) update(target);
      }
      pendingInputWrites.clear();
    };

    const close = () => {
      flushPendingInputWrites();
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
      if (previouslyFocused?.isConnected) previouslyFocused.focus?.({ preventScroll: true });
    };

    modal.addEventListener('change', e => {
      if (!e.target.dataset.setting) return;
      clearTimeout(pendingInputWrites.get(e.target));
      pendingInputWrites.delete(e.target);
      update(e.target);
    });
    modal.addEventListener('input', e => {
      const target = e.target;
      if ((target.type !== 'number' && target.type !== 'text') || !target.dataset.setting) return;
      clearTimeout(pendingInputWrites.get(target));
      pendingInputWrites.set(target, setTimeout(() => {
        pendingInputWrites.delete(target);
        if (target.isConnected) update(target);
      }, SETTING_INPUT_DEBOUNCE_MS));
    });
    modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    modal.querySelectorAll('[data-report-issue]').forEach(b => b.addEventListener('click', () => copyReportAndOpenIssue(b)));

    const advancedToggle = modal.querySelector('#nxtk-advanced-toggle');
    const advancedBody = modal.querySelector('#nxtk-advanced-body');
    let advancedCloseTimer = 0;
    const setAdvanced = (open) => {
      clearTimeout(advancedCloseTimer);
      advancedToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      advancedToggle.classList.toggle('nxtk-expanded', open);
      if (open) {
        advancedBody.hidden = false;
        void advancedBody.offsetHeight; // flush the collapsed state so the transition has a start value
        advancedBody.classList.add('nxtk-open');
        // the panel clips itself while it grows; let tooltips escape once it has settled
        advancedCloseTimer = setTimeout(() => advancedBody.classList.add('nxtk-settled'), 280);
        return;
      }
      advancedBody.classList.remove('nxtk-open', 'nxtk-settled');
      // hide it only once it has finished collapsing, so it stays out of the tab order
      advancedCloseTimer = setTimeout(() => { advancedBody.hidden = true; }, 280);
    };
    advancedToggle.addEventListener('click', () => setAdvanced(!advancedBody.classList.contains('nxtk-open')));
    modal.querySelector('[data-reset]').addEventListener('click', async () => {
      const confirmed = await nxtkConfirm({
        title: NXTK.t('setRestoreTitle', null, 'Restore Defaults'),
        message: NXTK.t('setRestoreConfirm', null, 'Restore the default settings and refresh this Nexus page?'),
        confirmText: NXTK.t('btnRestore', null, 'Restore'),
        cancelText: NXTK.t('btnCancel', null, 'Cancel')
      });
      if (!confirmed) return;
      await NexusExt.Storage.resetSettings();
      close();
      location.reload();
    });

    backdrop.appendChild(modal);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKeyDown);
    document.body.appendChild(backdrop);
    modal.querySelector('[data-close]')?.focus?.({ preventScroll: true });
  }

  function showVortexHandoffModal() {
    closeModal('nxtk-vortex-check-modal');

    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'nxtk-modal-backdrop';
      backdrop.id = 'nxtk-vortex-check-modal';

      const modal = document.createElement('div');
      modal.className = 'nxtk-modal nxtk-modal-sm nxtk-vortex-check-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.innerHTML = `
        <div class="nxtk-modal-header">
          <div>
            <div class="nxtk-modal-title">${L('deckMethodVortex', 'Send to Vortex')}</div>
            <div class="nxtk-modal-subtitle">${L('deckMethodVortexHint', 'Best for one-click handoff into your Vortex queue.')}</div>
          </div>
          <button class="nxtk-modal-close" data-cancel aria-label="${L('ariaClose', 'Close')}">&times;</button>
        </div>
        <div class="nxtk-history-summary">
          <div class="nxtk-history-copy">
            <div class="nxtk-history-lead">${L('logVortexNotice', 'Vortex must be running. Files are recorded once sent to it — the browser cannot see whether Vortex actually received them.')}</div>
            <div class="nxtk-history-text">${L('deckMethodBrowserHint', 'Use native browser downloads when Vortex is not handling links.')}</div>
          </div>
          <div class="nxtk-history-grid">
            <button type="button" class="nxtk-history-option nxtk-history-option-accent" data-choice="vortex">
              <span class="nxtk-history-option-title">${L('deckMethodVortex', 'Send to Vortex')}</span>
              <span class="nxtk-history-option-text">${L('deckMethodVortexHint', 'Best for one-click handoff into your Vortex queue.')}</span>
            </button>
            <button type="button" class="nxtk-history-option" data-choice="browser">
              <span class="nxtk-history-option-title">${L('deckMethodBrowser', 'Browser Download')}</span>
              <span class="nxtk-history-option-text">${L('deckMethodBrowserHint', 'Use native browser downloads when Vortex is not handling links.')}</span>
            </button>
          </div>
        </div>
        <div class="nxtk-modal-footer">
          <button type="button" class="nxtk-btn nxtk-btn-secondary" data-cancel>${L('btnCancel', 'Cancel')}</button>
        </div>
      `;
      prepareToolkitSurface(modal);

      let finished = false;
      const finish = (choice) => {
        if (finished) return;
        finished = true;
        document.removeEventListener('keydown', onKeyDown);
        backdrop.remove();
        resolve(choice);
      };
      const onKeyDown = (event) => {
        if (!document.contains(backdrop) || event.key === 'Escape') finish('cancel');
      };
      registerModalSettle(backdrop, () => finish('cancel'));

      modal.querySelectorAll('[data-choice]').forEach((button) => {
        button.addEventListener('click', () => finish(button.dataset.choice));
      });
      modal.querySelectorAll('[data-cancel]').forEach((button) => {
        button.addEventListener('click', () => finish('cancel'));
      });
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) finish('cancel');
      });
      document.addEventListener('keydown', onKeyDown);

      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      modal.querySelector('[data-choice="vortex"]')?.focus();
    });
  }

  function showHistoryDecisionModal({ downloadedCount, totalCount }) {
    closeModal('nxtk-history-modal');

    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'nxtk-modal-backdrop';
      backdrop.id = 'nxtk-history-modal';

      const modal = document.createElement('div');
      modal.className = 'nxtk-modal nxtk-modal-sm';
      modal.innerHTML = `
        <div class="nxtk-modal-header">
          <div class="nxtk-modal-title">${L('dlgHistoryTitle', 'Downloaded Mods Found')}</div>
          <button class="nxtk-modal-close" data-cancel aria-label="${L('ariaClose', 'Close')}">&times;</button>
        </div>
        <div class="nxtk-history-summary">
          <div class="nxtk-history-copy">
            <!-- "marked as downloaded", not "you downloaded": in Vortex mode the entry
                 records that a file was SENT to Vortex, which the browser cannot verify
                 was received. Asserting it outright misled anyone whose Vortex was not
                 running, since Skip then silently passed over files they never got. -->
            <div class="nxtk-history-lead">${escapeHtml(NXTK.t('dlgHistoryMarked', [String(downloadedCount), String(totalCount)], `${downloadedCount} of ${totalCount} mods are marked as downloaded.`))}</div>
            <div class="nxtk-history-text">${L('dlgHistoryHelp', 'Choose how you want this collection run to behave before anything starts. If files are missing, pick Re-download All.')}</div>
          </div>
          <div class="nxtk-history-grid">
            <button type="button" class="nxtk-history-option nxtk-history-option-accent" data-choice="skip">
              <span class="nxtk-history-option-title">${L('dlgHistorySkip', 'Skip Downloaded')}</span>
              <span class="nxtk-history-option-text">${L('dlgHistorySkipHint', 'Continue with the remaining mods only.')}</span>
            </button>
            <button type="button" class="nxtk-history-option" data-choice="redownload">
              <span class="nxtk-history-option-title">${L('dlgHistoryRedownload', 'Re-download All')}</span>
              <span class="nxtk-history-option-text">${L('dlgHistoryRedownloadHint', 'Clear saved history and start the full list again.')}</span>
            </button>
          </div>
        </div>
        <div class="nxtk-modal-footer">
          <button type="button" class="nxtk-btn nxtk-btn-secondary" data-cancel>${L('btnCancel', 'Cancel')}</button>
        </div>
      `;
      prepareToolkitSurface(modal);

      let finished = false;
      const onKeyDown = (e) => {
        if (!document.contains(backdrop)) {
          finish('cancel');
          return;
        }
        if (e.key === 'Escape') finish('cancel');
      };
      const finish = (choice) => {
        if (finished) return;
        finished = true;
        document.removeEventListener('keydown', onKeyDown);
        backdrop.remove();
        resolve(choice);
      };
      registerModalSettle(backdrop, () => finish('cancel'));

      modal.querySelectorAll('[data-choice]').forEach((button) => {
        button.addEventListener('click', () => finish(button.dataset.choice));
      });

      modal.querySelectorAll('[data-cancel]').forEach((button) => {
        button.addEventListener('click', () => finish('cancel'));
      });

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) finish('cancel');
      });

      document.addEventListener('keydown', onKeyDown);

      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      modal.querySelector('[data-choice="skip"]')?.focus();
    });
  }

  function showImportInfoModal(gameId) {
    closeModal('nxtk-import-info-modal');

    const backdrop = document.createElement('div');
    backdrop.className = 'nxtk-modal-backdrop';
    backdrop.id = 'nxtk-import-info-modal';

    const modal = document.createElement('div');
    modal.className = 'nxtk-modal nxtk-modal-sm nxtk-import-modal';
    modal.innerHTML = `
      <div class="nxtk-modal-header">
        <div class="nxtk-modal-title">${L('dlgImportTitle', 'Import Downloaded Mods')}</div>
        <button class="nxtk-modal-close" data-close aria-label="${L('ariaClose', 'Close')}">&times;</button>
      </div>
      <div class="nxtk-import-guide">
        <div class="nxtk-import-hero">
          <span class="nxtk-import-hero-icon">${svgIcon('importIcon')}</span>
          <div class="nxtk-import-hero-copy">
            <div class="nxtk-history-lead">${L('dlgImportLead', 'Skip re-downloading files you already have.')}</div>
            <div class="nxtk-history-text">${L('dlgImportHelp', 'Select all files from your mods folder and the toolkit will match them against this collection history.')}</div>
          </div>
        </div>
        <div class="nxtk-import-path-card">
          <div class="nxtk-import-path-label">${L('dlgImportPathLabel', 'Default Vortex path')}</div>
          <code class="nxtk-import-path-value">C:\\Users\\YourName\\AppData\\Roaming\\Vortex\\downloads\\${escapeHtml(gameId)}</code>
        </div>
      </div>
      <div class="nxtk-modal-footer">
        <button type="button" class="nxtk-btn nxtk-btn-primary" data-close>${L('btnGotIt', 'Got it')}</button>
      </div>
    `;
    prepareToolkitSurface(modal);

    const onKeyDown = (e) => {
      if (!document.contains(backdrop)) {
        document.removeEventListener('keydown', onKeyDown);
        return;
      }
      if (e.key === 'Escape') close();
    };
    const close = () => {
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
    };
    modal.querySelectorAll('[data-close]').forEach((button) => {
      button.addEventListener('click', close);
    });

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    document.addEventListener('keydown', onKeyDown);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  }

  function showError(error, { onRetry = null, title = 'Download issue' } = {}) {
    closeModal('nxtk-error-modal');

    const normalized = NexusExt.Errors?.normalize
      ? NexusExt.Errors.normalize(error)
      : {
        code: 'request_failed',
        userMessage: String(error || 'The download request failed.'),
        recovery: 'Retry the download. If it keeps happening, report the issue.',
        retryable: false
      };
    const canRetry = normalized.retryable && typeof onRetry === 'function';
    const requiresLogin = normalized.code === 'requires_login';
    const shown = NexusExt.Errors?.displayText
      ? NexusExt.Errors.displayText(normalized)
      : { message: normalized.userMessage, recovery: normalized.recovery };
    const defaultTitle = requiresLogin && title === 'Download issue'
      ? NXTK.t('dlgSignInRequired', null, 'Sign in required')
      : title;
    const dialogTitle = title === 'Download issue' && !requiresLogin
      ? NXTK.t('dlgDownloadIssue', null, 'Download issue')
      : defaultTitle;

    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'nxtk-modal-backdrop nxtk-alert-backdrop';
      backdrop.id = 'nxtk-error-modal';

      const modal = document.createElement('div');
      modal.className = 'nxtk-modal nxtk-modal-sm nxtk-alert-modal nxtk-error-modal';
      modal.setAttribute('role', 'alertdialog');
      modal.setAttribute('aria-modal', 'true');
      modal.innerHTML = `
        <div class="nxtk-modal-header">
          <div class="nxtk-alert-header-inner">
            <span class="nxtk-alert-icon nxtk-error-icon">${svgIcon('info')}</span>
            <span class="nxtk-modal-title">${escapeHtml(dialogTitle)}</span>
          </div>
          <button class="nxtk-modal-close" type="button" data-close aria-label="${escapeHtml(NXTK.t('ariaCloseErrorDialog', null, 'Close error dialog'))}">&times;</button>
        </div>
        <div class="nxtk-alert-body">
          <div class="nxtk-error-message">${escapeHtml(shown.message)}</div>
          <div class="nxtk-error-recovery">${escapeHtml(shown.recovery)}</div>
          <!-- The code is a stable identifier and never translated; only its label is. -->
          <div class="nxtk-error-code">${escapeHtml(NXTK.t('dlgErrorId', null, 'Error ID'))}: ${escapeHtml(normalized.code)}</div>
        </div>
        <div class="nxtk-modal-footer nxtk-alert-footer nxtk-error-footer">
          <!-- Distinct from btnReportBug: that key is the popup's longer wording. -->
          <button class="nxtk-btn nxtk-btn-secondary" type="button" data-report>${escapeHtml(NXTK.t('dlgReportBug', null, 'Report a bug'))}</button>
          ${requiresLogin
            ? `<button class="nxtk-btn nxtk-btn-primary" type="button" data-login>${escapeHtml(NXTK.t('btnSignIn', null, 'Sign in to Nexus Mods'))}</button>`
            : canRetry
              ? `<button class="nxtk-btn nxtk-btn-primary" type="button" data-retry>${escapeHtml(NXTK.t('btnRetry', null, 'Retry'))}</button>`
              : `<button class="nxtk-btn nxtk-btn-primary" type="button" data-close>${escapeHtml(NXTK.t('btnDone', null, 'Done'))}</button>`}
        </div>`;
      prepareToolkitSurface(modal);

      let closed = false;
      const onKeyDown = (event) => {
        if (!document.contains(backdrop)) {
          finish();
          return;
        }
        if (event.key === 'Escape') finish();
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        backdrop.remove();
        document.removeEventListener('keydown', onKeyDown);
        resolve();
      };
      registerModalSettle(backdrop, finish);

      modal.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', finish));
      const reportButton = modal.querySelector('[data-report]');
      reportButton.addEventListener('click', () => copyReportAndOpenIssue(reportButton, normalized));
      modal.querySelector('[data-login]')?.addEventListener('click', () => {
        finish();
        NexusExt.Auth?.openLogin?.();
      });
      modal.querySelector('[data-retry]')?.addEventListener('click', () => {
        finish();
        Promise.resolve().then(onRetry).catch((cause) => {
          const retryError = NexusExt.Errors?.fromException
            ? NexusExt.Errors.fromException(cause, { context: 'Retrying download' })
            : cause;
          showError(retryError, { onRetry, title });
        });
      });
      backdrop.addEventListener('click', (event) => { if (event.target === backdrop) finish(); });
      document.addEventListener('keydown', onKeyDown);

      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      (modal.querySelector('[data-login]') || modal.querySelector('[data-retry]') || modal.querySelector('[data-close]'))?.focus();
    });
  }

  function nxtkAlert(message) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'nxtk-modal-backdrop nxtk-alert-backdrop';

      const lines = String(message).split('\n');
      const bodyHtml = lines.map(l => `<div class="nxtk-alert-line">${escapeHtml(l)}</div>`).join('');

      const modal = document.createElement('div');
      modal.className = 'nxtk-modal nxtk-modal-sm nxtk-alert-modal';
      modal.innerHTML = `
        <div class="nxtk-modal-header">
          <div class="nxtk-alert-header-inner">
            <span class="nxtk-alert-icon">${svgIcon('info')}</span>
            <span class="nxtk-modal-title">NexusMods Bypass</span>
          </div>
        </div>
        <div class="nxtk-alert-body">${bodyHtml}</div>
        <div class="nxtk-modal-footer nxtk-alert-footer">
          <button class="nxtk-btn nxtk-btn-primary nxtk-alert-ok" type="button">${L('btnOk', 'OK')}</button>
        </div>`;
      prepareToolkitSurface(modal);

      let closed = false;
      const onKeyDown = (e) => {
        if (!document.contains(backdrop)) {
          close();
          return;
        }
        if (e.key === 'Escape') close();
      };
      const close = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeyDown);
        backdrop.remove();
        resolve();
      };
      registerModalSettle(backdrop, close);

      modal.querySelector('.nxtk-alert-ok').addEventListener('click', close);
      document.addEventListener('keydown', onKeyDown);
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      modal.querySelector('.nxtk-alert-ok').focus();
    });
  }

  function nxtkConfirm({ title, message, confirmText, cancelText } = {}) {
    title = title || NXTK.t('dlgConfirmTitle', null, 'Confirm Action');
    confirmText = confirmText || NXTK.t('btnOk', null, 'OK');
    cancelText = cancelText || NXTK.t('btnCancel', null, 'Cancel');
    return new Promise((resolve) => {
      closeModal('nxtk-confirm-modal');

      const backdrop = document.createElement('div');
      backdrop.className = 'nxtk-modal-backdrop nxtk-alert-backdrop';
      backdrop.id = 'nxtk-confirm-modal';

      const modal = document.createElement('div');
      modal.className = 'nxtk-modal nxtk-modal-sm nxtk-alert-modal';
      modal.innerHTML = `
        <div class="nxtk-modal-header">
          <div class="nxtk-alert-header-inner">
            <span class="nxtk-alert-icon">${svgIcon('info')}</span>
            <span class="nxtk-modal-title">${escapeHtml(title)}</span>
          </div>
          <button class="nxtk-modal-close" data-cancel>&times;</button>
        </div>
        <div class="nxtk-alert-body">
          <div class="nxtk-alert-line">${escapeHtml(message)}</div>
        </div>
        <div class="nxtk-modal-footer nxtk-alert-footer">
          <button class="nxtk-btn nxtk-btn-secondary" type="button" data-cancel>${escapeHtml(cancelText)}</button>
          <button class="nxtk-btn nxtk-btn-primary" type="button" data-confirm>${escapeHtml(confirmText)}</button>
        </div>`;
      prepareToolkitSurface(modal);

      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        backdrop.remove();
        document.removeEventListener('keydown', onKeyDown);
        resolve(value);
      };
      const onKeyDown = (e) => {
        if (!document.contains(backdrop)) {
          finish(false);
          return;
        }
        if (e.key === 'Escape') finish(false);
        if (e.key === 'Enter') finish(true);
      };
      registerModalSettle(backdrop, () => finish(false));

      modal.querySelectorAll('[data-cancel]').forEach(button => button.addEventListener('click', () => finish(false)));
      modal.querySelector('[data-confirm]').addEventListener('click', () => finish(true));
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) finish(false); });
      document.addEventListener('keydown', onKeyDown);

      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      modal.querySelector('[data-confirm]').focus();
    });
  }

  const MODAL_SETTLE = Symbol('nxtkModalSettle');

  function registerModalSettle(backdrop, settle) {
    backdrop[MODAL_SETTLE] = settle;
  }

  function settleModalBackdrop(backdrop) {
    const settle = backdrop && backdrop[MODAL_SETTLE];
    if (typeof settle !== 'function') return;
    backdrop[MODAL_SETTLE] = null;
    try {
      settle();
    } catch (_) {
    }
  }

  function closeModal(id) {
    const existing = document.getElementById(id);
    if (existing) {
      existing.querySelectorAll('.nxtk-dropdown-menu').forEach(disposeDropdownMenu);
      settleModalBackdrop(existing);
      existing.remove();
      syncDropdownPageLock();
    }
  }

  function createControlDeck(ndc) {
    const deck = document.createElement('div');
    deck.className = 'nxtk-deck';
    deck.id = 'nxtk-control-deck';

    const state = {
      modsCount: 0,
      progress: 0,
      logHidden: true
    };

    const ui = {
      get progress() { return state.progress; },
      get modsCount() { return state.modsCount; },
      log: null,
      logText: null,
      incrementProgress: null,
      setProgress: null,
      setDownloadMethod: null,
      setDownloadStatus: null,
      startDownload: null,
      endDownload: null
    };

    deck.innerHTML = `
      <div class="nxtk-deck-header">
        <div class="nxtk-deck-heading">
          <div class="nxtk-deck-kicker">NexusMods Bypass</div>
          <div class="nxtk-deck-title">
            <span class="nxtk-deck-title-main">${svgIcon('download')} ${L('deckTitle', 'Collection Downloader')} <span class="nxtk-badge nxtk-badge-accent" id="nxtk-total-mods"></span></span>
            <span class="nxtk-badge nxtk-badge-outline">${L('deckReadyQueue', 'Ready Queue')}</span>
          </div>
          <div class="nxtk-deck-subtitle">${L('deckSubtitle', 'Queue full collections, import finished downloads, and tune download pacing from one control surface.')}</div>
        </div>
      </div>

      <div class="nxtk-deck-panels">
        <div class="nxtk-panel nxtk-panel-compact" id="nxtk-download-method-panel">
          <div class="nxtk-panel-label">${L('deckDownloadMethod', 'Download Method')}</div>
          <div class="nxtk-radio-group">
            <label class="nxtk-radio-label">
              <input type="radio" name="nxtk-dl-method" value="${DOWNLOAD_METHOD_VORTEX}">
              <span class="nxtk-radio-copy">
                <span class="nxtk-radio-title">${L('deckMethodVortex', 'Send to Vortex')}</span>
                <span class="nxtk-radio-hint">${L('deckMethodVortexHint', 'Best for one-click handoff into your Vortex queue.')}</span>
              </span>
              ${svgIcon('vortex')}
            </label>
            <label class="nxtk-radio-label">
              <input type="radio" name="nxtk-dl-method" value="${DOWNLOAD_METHOD_BROWSER}">
              <span class="nxtk-radio-copy">
                <span class="nxtk-radio-title">${L('deckMethodBrowser', 'Browser Download')}</span>
                <span class="nxtk-radio-hint">${L('deckMethodBrowserHint', 'Use native browser downloads when Vortex is not handling links.')}</span>
              </span>
              ${svgIcon('browser')}
            </label>
          </div>
        </div>

        <!-- Main Buttons -->
        <div class="nxtk-panel" id="nxtk-buttons-area">
          <div class="nxtk-panel-label">${L('deckActions', 'Actions')}</div>
          <div class="nxtk-btn-row nxtk-btn-row-utility">
            <button class="nxtk-btn nxtk-btn-secondary" id="nxtk-import-mods">${L('deckImportMods', 'Import downloaded mods')}</button>
            <button class="nxtk-btn nxtk-btn-ghost nxtk-btn-icon" id="nxtk-import-info" title="${L('tipImportInfo', 'Info about importing')}">${svgIcon('info')}</button>
          </div>
          <div class="nxtk-btn-row">
            <div class="nxtk-btn-split nxtk-grow">
              <button class="nxtk-btn nxtk-btn-primary nxtk-btn-wide nxtk-btn-collection" id="nxtk-dl-all">${L('deckDownloadAll', 'Download all mods')} <span class="nxtk-badge nxtk-badge-outline" id="nxtk-all-count"></span></button>
              <div class="nxtk-dropdown">
                <button type="button" class="nxtk-btn nxtk-btn-primary nxtk-btn-icon nxtk-btn-collection nxtk-btn-collection-toggle" id="nxtk-menu-toggle">${svgIcon('chevronDown')}</button>
                <div class="nxtk-dropdown-menu nxtk-selector-dropdown" id="nxtk-dl-menu">
                  <button class="nxtk-selector-item" id="nxtk-dl-mandatory">
                    <span class="nxtk-selector-copy">
                      <span class="nxtk-selector-title">${L('deckDownloadMandatory', 'Download mandatory')}</span>
                      <span class="nxtk-selector-hint">${L('deckDownloadMandatoryHint', 'Core files only')}</span>
                    </span>
                    <span class="nxtk-badge nxtk-badge-accent" id="nxtk-mand-count"></span>
                  </button>
                  <button class="nxtk-selector-item" id="nxtk-dl-optional">
                    <span class="nxtk-selector-copy">
                      <span class="nxtk-selector-title">${L('deckDownloadOptional', 'Download optional')}</span>
                      <span class="nxtk-selector-hint">${L('deckDownloadOptionalHint', 'Optional extras')}</span>
                    </span>
                    <span class="nxtk-badge nxtk-badge-accent" id="nxtk-opt-count"></span>
                  </button>
                  <button class="nxtk-selector-item" id="nxtk-select-mods">
                    <span class="nxtk-selector-copy">
                      <span class="nxtk-selector-title">${L('deckSelectMods', 'Select mods to download')}</span>
                      <span class="nxtk-selector-hint">${L('deckSelectModsHint', 'Manual pick list')}</span>
                    </span>
                  </button>
                  <button class="nxtk-selector-item" id="nxtk-update-collection">
                    <span class="nxtk-selector-copy">
                      <span class="nxtk-selector-title">${L('deckUpdateCollection', 'Update collection')}</span>
                      <span class="nxtk-selector-hint">${L('deckUpdateCollectionHint', 'Compare revisions')}</span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Progress Area (hidden until download starts) -->
      <div class="nxtk-progress-area" id="nxtk-progress-area">
        <div class="nxtk-progress-head">
          <div class="nxtk-panel-label">${L('deckProgress', 'Download Progress')}</div>
          <span class="nxtk-badge nxtk-badge-outline">${L('deckAdaptivePacing', 'Adaptive Pacing')}</span>
        </div>
        <div class="nxtk-progress-row">
          <div class="nxtk-progress-bar-wrap" id="nxtk-progress-bar" role="progressbar"
               aria-label="${L('ariaProgress', 'Collection download progress')}"
               aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="">
            <div class="nxtk-progress-fill" id="nxtk-progress-fill"></div>
            <!-- Decorative: the accessible value lives on the progressbar above, and
                 the state changes are announced through the live region below. -->
            <div class="nxtk-progress-labels" aria-hidden="true">
              <span class="nxtk-progress-pct" id="nxtk-pct">0%</span>
              <span class="nxtk-progress-status" id="nxtk-status-text">${L('statusDownloading', 'Downloading...')}</span>
              <span class="nxtk-progress-count" id="nxtk-count">0/0</span>
            </div>
          </div>
          <div class="nxtk-progress-controls">
            <button class="nxtk-btn nxtk-btn-icon" id="nxtk-play-pause" title="${L('tipPauseResume', 'Pause/Resume')}" aria-label="${L('ariaPause', 'Pause download')}">${svgIcon('pause')}</button>
            <button class="nxtk-btn nxtk-btn-icon" id="nxtk-stop" title="${L('tipStop', 'Stop')}" aria-label="${L('ariaStop', 'Stop download')}">${svgIcon('stop')}</button>
          </div>
        </div>
        <!-- Transitions only (started/paused/finished), never per-percent: a live
             region on the percentage itself would talk over everything else. -->
        <div class="nxtk-sr-only" id="nxtk-progress-announce" role="status" aria-live="polite"></div>
      </div>

      <!-- Log Console (collapsible) -->
      <div class="nxtk-log-wrap">
        <div class="nxtk-log-header">
          <button class="nxtk-log-toggle" id="nxtk-log-toggle">${svgIcon('chevronRight')} ${L('deckLogs', 'Logs')}</button>
          <div class="nxtk-log-caption">${L('deckLogsCaption', 'Live activity feed')}</div>
        </div>
        <div class="nxtk-log-container" id="nxtk-log-container" style="display:none"></div>
      </div>
    `;

    prepareToolkitSurface(deck);
    const $ = (sel) => deck.querySelector(sel);

    $('#nxtk-total-mods').textContent =
      NXTK.tPlural('deckModCount', ndc.mods.all.length, `${ndc.mods.all.length} mods`);
    $('#nxtk-all-count').textContent = `${ndc.mods.all.length}`;
    $('#nxtk-mand-count').textContent = `${ndc.mods.mandatory.length}`;
    $('#nxtk-opt-count').textContent = `${ndc.mods.optional.length}`;

    const syncDownloadMethodUI = () => {
      deck.querySelectorAll('.nxtk-radio-label').forEach(label => {
        const input = label.querySelector('input[name="nxtk-dl-method"]');
        label.classList.toggle('nxtk-selected', !!input?.checked);
      });
    };

    ui.setDownloadMethod = (method) => {
      const normalized = Number(method);
      if (normalized !== DOWNLOAD_METHOD_VORTEX && normalized !== DOWNLOAD_METHOD_BROWSER) return;
      ndc.downloadMethod = normalized;
      deck.querySelectorAll('input[name="nxtk-dl-method"]').forEach((radio) => {
        radio.checked = Number(radio.value) === normalized;
      });
      syncDownloadMethodUI();
    };

    deck.querySelectorAll('input[name="nxtk-dl-method"]').forEach(r => {
      if (parseInt(r.value) === ndc.downloadMethod) r.checked = true;
      r.addEventListener('change', () => {
        ui.setDownloadMethod(parseInt(r.value));
        NexusExt.Storage.patchSetting('NDC_downloadMethod', ndc.downloadMethod);
      });
    });
    syncDownloadMethodUI();

    $('#nxtk-import-mods').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.addEventListener('change', async () => {
        const fileNames = Array.from(input.files, (file) => file.name);
        const { matched: downloaded, unmatchedCount } = matchModsToFileNames(ndc.mods.all, fileNames);
        /* Merge, do not replace. setCollectionHistory overwrites the three lists wholesale, so
           importing a second folder — or importing at all after a partial run — used to wipe every
           mod already recorded as downloaded, and the next run re-fetched all of them. */
        const history = await NexusExt.Storage.getHistory();
        const existing = history?.[ndc.gameId]?.[ndc.collectionId] || {};
        const merge = (type, ids) => [...new Set([
          ...(Array.isArray(existing[type]) ? existing[type] : []),
          ...ids
        ])];
        await NexusExt.Storage.setCollectionHistory({
          gameId: ndc.gameId,
          collectionId: ndc.collectionId,
          lists: {
            all: merge('all', downloaded.map(m => m.fileId)),
            mandatory: merge('mandatory', downloaded.filter(m => !m.optional).map(m => m.fileId)),
            optional: merge('optional', downloaded.filter(m => m.optional).map(m => m.fileId))
          }
        });
        const summary = [
          NXTK.t('alertImportedMods', [String(downloaded.length), String(ndc.mods.all.length)],
            `Imported ${downloaded.length} of ${ndc.mods.all.length} collection mods into history.`),
          NXTK.tPlural('alertUnmatchedFiles', unmatchedCount,
            `${unmatchedCount} selected file${unmatchedCount === 1 ? '' : 's'} did not match this collection.`)
        ].join('\n');
        await nxtkAlert(summary);
      });
      input.click();
    });

    $('#nxtk-import-info').addEventListener('click', () => {
      showImportInfoModal(ndc.gameId);
    });

    const menu = $('#nxtk-dl-menu');
    const menuController = bindDropdownToggle($('#nxtk-menu-toggle'), menu, { portal: true });

    const startCollectionDownload = (mods, type) => {
      menuController?.close();
      runUiTask(
        () => ndc.downloadMods(mods, type),
        { context: 'Starting collection download', title: NXTK.t('dlgCollectionIssue', null, 'Collection download issue') }
      );
    };
    $('#nxtk-dl-all').addEventListener('click', () => startCollectionDownload(ndc.mods.all, 'all'));
    $('#nxtk-dl-mandatory').addEventListener('click', () => startCollectionDownload(ndc.mods.mandatory, 'mandatory'));
    $('#nxtk-dl-optional').addEventListener('click', () => startCollectionDownload(ndc.mods.optional, 'optional'));
    $('#nxtk-select-mods').addEventListener('click', () => { menuController?.close(); showSelectModsModal(ndc); });
    $('#nxtk-update-collection').addEventListener('click', () => { menuController?.close(); showUpdateModal(ndc); });

    $('#nxtk-play-pause').addEventListener('click', () => {
      const pausing = ndc.runStatus !== STATUS_PAUSED;
      ndc.setPaused?.(pausing);
      ui.setDownloadStatus(pausing ? 'paused' : 'running');
    });
    $('#nxtk-stop').addEventListener('click', () => {
      ndc.stopDownload?.();
      ndc.runStatus = STATUS_STOPPED;
      $('#nxtk-status-text').textContent = statusLabel(STATUS_STOPPED);
      $('#nxtk-progress-area').dataset.runState = 'stopped';
    });

    const logContainer = $('#nxtk-log-container');
    const logToggle = $('#nxtk-log-toggle');
    const setLogsOpen = (open) => {
      state.logHidden = !open;
      logContainer.style.display = open ? '' : 'none';
      logToggle.classList.toggle('nxtk-expanded', open);
    };
    logToggle.addEventListener('click', () => {
      setLogsOpen(state.logHidden);
    });

    const MAX_LOG_ROWS = 300;
    let logScrollFrame = 0;
    const appendLogRow = (type, applyMessage) => {
      const row = document.createElement('div');
      row.className = 'nxtk-log-row';
      if (type === 'error') row.classList.add('nxtk-log-error');
      if (type === 'info') row.classList.add('nxtk-log-info');

      const time = document.createElement('span');
      time.className = 'nxtk-log-time';
      time.textContent = `[${new Date().toLocaleTimeString()}]`;
      const message = document.createElement('span');
      message.className = 'nxtk-log-msg';
      applyMessage(message);
      row.append(time, message);

      logContainer.appendChild(row);
      while (logContainer.childElementCount > MAX_LOG_ROWS) {
        logContainer.firstElementChild.remove();
      }
      if (type === 'error') setLogsOpen(true);
      if (!logScrollFrame) {
        logScrollFrame = requestAnimationFrame(() => {
          logScrollFrame = 0;
          logContainer.scrollTop = logContainer.scrollHeight;
        });
      }
      return row;
    };

    ui.logText = (text, type) => appendLogRow(type, (node) => {
      node.textContent = String(text ?? '');
    });

    ui.log = (message, type) => appendLogRow(type, (node) => {
      node.innerHTML = message;
    });

    ui.incrementProgress = () => {
      state.progress++;
      renderProgress();
    };

    ui.setProgress = (progress, count = state.modsCount) => {
      const nextCount = Math.max(0, Number(count) || 0);
      const nextProgress = Math.max(0, Number(progress) || 0);
      state.modsCount = nextCount;
      state.progress = nextCount ? Math.min(nextProgress, nextCount) : nextProgress;
      renderProgress();
    };

    const setRunState = (runState) => {
      $('#nxtk-progress-area').dataset.runState = runState;
    };

    const announce = (text) => {
      $('#nxtk-progress-announce').textContent = text;
    };

    ui.setDownloadStatus = (status) => {
      const normalized = status === 'paused' || status === STATUS_PAUSED
        ? STATUS_PAUSED
        : STATUS_DOWNLOADING;
      if (ndc.runStatus === normalized) return;
      if (ndc.runStatus === STATUS_STOPPED || ndc.runStatus === STATUS_FINISHED) return;
      ndc.runStatus = normalized;
      const paused = normalized === STATUS_PAUSED;
      const button = $('#nxtk-play-pause');
      button.innerHTML = paused ? svgIcon('play') : svgIcon('pause');
      button.setAttribute('aria-label', paused
        ? NXTK.t('ariaResume', null, 'Resume download')
        : NXTK.t('ariaPause', null, 'Pause download'));
      $('#nxtk-status-text').textContent = statusLabel(normalized);
      setRunState(paused ? 'paused' : 'running');
      announce(paused
        ? NXTK.t('annPaused', null, 'Download paused.')
        : NXTK.t('annResumed', null, 'Download resumed.'));
    };

    ui.startDownload = (count, { resumed = false } = {}) => {
      menuController?.close();
      state.modsCount = count;
      state.progress = 0;
      ndc.runStatus = STATUS_DOWNLOADING;
      renderProgress();
      $('#nxtk-buttons-area').style.display = 'none';
      $('#nxtk-download-method-panel').style.display = 'none';
      $('#nxtk-progress-area').classList.add('nxtk-active');
      setRunState('running');
      const button = $('#nxtk-play-pause');
      button.innerHTML = svgIcon('pause');
      button.setAttribute('aria-label', NXTK.t('ariaPause', null, 'Pause download'));
      $('#nxtk-status-text').textContent = statusLabel(STATUS_DOWNLOADING);
      if (resumed) {
        announce(NXTK.tPlural('annReconnected', count,
          `Reconnected to a download in progress: ${count} mods.`));
        return;
      }
      if (ndc.downloadMethod === DOWNLOAD_METHOD_VORTEX) {
        const notice = NXTK.t('logVortexNotice', null,
          'Vortex must be running. Files are recorded once sent to it — the browser cannot see whether Vortex actually received them.');
        announce(notice);
        ui.logText(notice, 'info');
        return;
      }
      announce(NXTK.tPlural('annStarted', count, `Download started: ${count} mods.`));
      ui.logText(NXTK.t('logDownloadStarted', null, 'Download started.'), 'info');
    };

    ui.endDownload = (outcome = 'finished') => {
      const vortexHandoff = ndc.downloadMethod === DOWNLOAD_METHOD_VORTEX;
      const outcomes = {
        finished: {
          status: STATUS_FINISHED,
          label: vortexHandoff
            ? NXTK.t('toastSentToVortex', null, 'Sent to Vortex')
            : statusLabel(STATUS_FINISHED),
          message: vortexHandoff
            ? NXTK.t('toastSentToVortex', null, 'Sent to Vortex')
            : NXTK.t('logDownloadFinished', null, 'Download finished.')
        },
        partial: {
          status: STATUS_FINISHED,
          label: NXTK.t('outcomePartial', null, 'Completed with errors'),
          message: NXTK.t('logDownloadPartial', null, 'Download completed with errors. Retrying will skip successful files.')
        },
        stopped: {
          status: STATUS_STOPPED,
          label: statusLabel(STATUS_STOPPED),
          message: NXTK.t('logDownloadStopped', null, 'Download stopped.')
        },
        requires_login: {
          status: STATUS_STOPPED,
          label: NXTK.t('dlgSignInRequired', null, 'Sign in required'),
          message: NXTK.t('logDownloadNeedsLogin', null, 'Download paused until you sign in.')
        },
        blocked: {
          status: STATUS_STOPPED,
          label: NXTK.t('outcomeBlocked', null, 'Action required'),
          message: NXTK.t('logDownloadBlocked', null, 'Download paused. Follow the error instructions before retrying.')
        },
        error: {
          status: STATUS_STOPPED,
          label: NXTK.t('outcomeFailed', null, 'Failed'),
          message: NXTK.t('logDownloadError', null, 'Download ended with an error.')
        }
      };
      const result = outcomes[outcome] || outcomes.error;
      ndc.runStatus = result.status;
      $('#nxtk-status-text').textContent = result.label;
      setRunState('done');
      $('#nxtk-buttons-area').style.display = '';
      $('#nxtk-download-method-panel').style.display = '';
      announce(NXTK.t('annOutcome', [result.label, progressText()],
        `${result.label}. ${state.progress} of ${state.modsCount} mods.`));
      ui.logText(result.message, outcome === 'error' ? 'error' : 'info');
    };

    function renderProgress() {
      const pct = state.modsCount ? ((state.progress / state.modsCount) * 100).toFixed(1) : '0';
      $('#nxtk-progress-fill').style.width = pct + '%';
      $('#nxtk-pct').textContent = pct + '%';
      $('#nxtk-count').textContent = `${state.progress}/${state.modsCount}`;
      const bar = $('#nxtk-progress-bar');
      bar.setAttribute('aria-valuenow', pct);
      bar.setAttribute('aria-valuetext', progressText());
    }

    function progressText() {
      return NXTK.tPlural('progressOfTotal', state.modsCount,
        `${state.progress} of ${state.modsCount} mods`,
        [String(state.progress), String(state.modsCount)]);
    }

    function statusLabel(status) {
      if (ndc.downloadMethod === DOWNLOAD_METHOD_VORTEX) {
        if (status === STATUS_DOWNLOADING) {
          return NXTK.t('deckMethodVortex', null, 'Send to Vortex');
        }
        if (status === STATUS_FINISHED) {
          return NXTK.t('toastSentToVortex', null, 'Sent to Vortex');
        }
      }
      const keys = {
        [STATUS_DOWNLOADING]: 'statusDownloading',
        [STATUS_PAUSED]: 'statusPaused',
        [STATUS_FINISHED]: 'statusFinished',
        [STATUS_STOPPED]: 'statusStopped'
      };
      return NXTK.t(keys[status], null, STATUS_TEXT[status]);
    }

    ndc.ui = ui;
    return deck;
  }

  function showSelectModsModal(ndc) {
    closeModal('nxtk-select-modal');
    const backdrop = document.createElement('div');
    backdrop.className = 'nxtk-modal-backdrop';
    backdrop.id = 'nxtk-select-modal';

    const modal = document.createElement('div');
    modal.className = 'nxtk-modal';

    modal.innerHTML = `
      <div class="nxtk-modal-header">
        <div class="nxtk-modal-title">${L('dlgSelectTitle', 'Select Mods')}</div>
        <div class="nxtk-modal-header-actions">
          <span class="nxtk-badge nxtk-badge-accent" id="nxtk-sel-count"></span>
          <div class="nxtk-dropdown">
            <button type="button" class="nxtk-btn nxtk-btn-secondary nxtk-btn-icon" id="nxtk-sel-opts-toggle">${svgIcon('dots')}</button>
            <div class="nxtk-dropdown-menu" id="nxtk-sel-opts-menu">
              <button class="nxtk-dropdown-item" id="nxtk-sel-all">${L('selSelectAll', 'Select all')} ${svgIcon('checkAll')}</button>
              <button class="nxtk-dropdown-item" id="nxtk-desel-all">${L('selDeselectAll', 'Deselect all')} ${svgIcon('close')}</button>
              <button class="nxtk-dropdown-item" id="nxtk-invert-sel">${L('selInvert', 'Invert selection')} ${svgIcon('invert')}</button>
              <div class="nxtk-dropdown-sep"></div>
              <button class="nxtk-dropdown-item" id="nxtk-export-sel">${L('selExport', 'Export selection')} ${svgIcon('exportIcon')}</button>
              <button class="nxtk-dropdown-item" id="nxtk-import-sel">${L('selImport', 'Import selection')} ${svgIcon('importIcon')}</button>
              <div class="nxtk-dropdown-sep"></div>
              <button class="nxtk-dropdown-item" id="nxtk-import-dl-mods">${L('deckImportMods', 'Import downloaded mods')} ${svgIcon('importIcon')}</button>
            </div>
          </div>
          <button class="nxtk-modal-close" data-close>&times;</button>
        </div>
      </div>
      <div class="nxtk-mods-toolbar">
        <input type="search" class="nxtk-search-input" placeholder="${L('selSearchPlaceholder', 'Search mods...')}" id="nxtk-mod-search">
        <select class="nxtk-native-select-hidden nxtk-sort-select" id="nxtk-mod-sort">
          <option value="mod_name_asc">${L('sortModAsc', 'Mod name A-Z')}</option>
          <option value="mod_name_desc">${L('sortModDesc', 'Mod name Z-A')}</option>
          <option value="file_name_asc">${L('sortFileAsc', 'File name A-Z')}</option>
          <option value="file_name_desc">${L('sortFileDesc', 'File name Z-A')}</option>
          <option value="size_asc">${L('sortSizeAsc', 'Size ascending')}</option>
          <option value="size_desc">${L('sortSizeDesc', 'Size descending')}</option>
        </select>
        <div class="nxtk-custom-select nxtk-sort-custom-select">
          <button type="button" class="nxtk-custom-select-trigger" id="nxtk-mod-sort-trigger">
            <span data-select-label>${L('sortModAsc', 'Mod name A-Z')}</span>
            ${svgIcon('chevronDown')}
          </button>
          <div class="nxtk-dropdown-menu nxtk-custom-select-menu" id="nxtk-mod-sort-menu"></div>
        </div>
      </div>
      <div class="nxtk-mod-list-header">
        <span class="nxtk-ml-idx">#</span>
        <span class="nxtk-ml-name">${L('colModName', 'Mod name')}</span>
        <span class="nxtk-ml-file">${L('colFileName', 'File name')}</span>
        <span class="nxtk-ml-size">${L('colSize', 'Size')}</span>
        <span class="nxtk-ml-req">${L('colType', 'Type')}</span>
      </div>
      <div class="nxtk-mod-list" id="nxtk-mod-list"></div>
      <div class="nxtk-modal-footer">
        <button class="nxtk-btn nxtk-btn-secondary" data-close>${L('btnCancel', 'Cancel')}</button>
        <button class="nxtk-btn nxtk-btn-primary" id="nxtk-dl-selected">${L('selDownloadSelected', 'Download selected')}</button>
      </div>
    `;
    prepareToolkitSurface(modal);

    const $ = (sel) => modal.querySelector(sel);
    const listEl = $('#nxtk-mod-list');
    const countBadge = $('#nxtk-sel-count');
    let lastChecked = null;
    /* Indexed once. Export and Download-selected each did a full linear scan of every mod for every
       selected row, so selecting most of a large collection cost O(selected x total). */
    const modsByFileId = new Map(ndc.mods.all.map((mod) => [String(mod.file.fileId), mod]));

    function updateCount() {
      const c = listEl.querySelectorAll('.nxtk-mod-item.nxtk-selected').length;
      countBadge.textContent = NXTK.tPlural('selSelectedCount', c, `${c} mods selected`);
    }

    /* Built as one string and parsed once. Each row used to get its own innerHTML assignment, its own
       textContent read back out of the DOM to build the search key, and its own click closure — on a
       500-mod collection that is 500 parses, 500 forced text reads and 500 closures, repeated every
       time the list is sorted or filtered. The click handler is delegated to the container instead. */
    function renderList(mods) {
      const rows = mods.map((mod, i) => {
        const modName = mod.file.mod.name;
        const fileName = mod.file.name;
        const size = convertSize(mod.file.size);
        const tag = mod.optional
          ? NXTK.t('tagOptional', null, 'Optional')
          : NXTK.t('tagMandatory', null, 'Mandatory');
        const search = `#${i + 1} ${modName} ${fileName} ${size} ${tag}`
          .replace(/\s+/g, ' ').trim().toLowerCase();
        return `<div class="nxtk-mod-item" data-file-id="${escapeHtml(mod.file.fileId)}" data-search="${escapeHtml(search)}">`
          + `<span class="nxtk-ml-idx">#${i + 1}</span>`
          + `<span class="nxtk-ml-name">${escapeHtml(modName)}</span>`
          + `<span class="nxtk-ml-file">${escapeHtml(fileName)}</span>`
          + `<span class="nxtk-ml-size">${escapeHtml(size)}</span>`
          + `<span class="nxtk-ml-req"><span class="nxtk-tag ${mod.optional ? 'nxtk-tag-optional' : 'nxtk-tag-mandatory'}">${escapeHtml(tag)}</span></span>`
          + '</div>';
      });
      listEl.innerHTML = rows.join('');
      lastChecked = null;
    }

    listEl.addEventListener('click', (event) => {
      const item = event.target.closest('.nxtk-mod-item');
      if (!item || !listEl.contains(item)) return;
      item.classList.toggle('nxtk-selected');
      if (event.shiftKey && lastChecked?.isConnected) {
        const items = [...listEl.children];
        const a = items.indexOf(item);
        const b = items.indexOf(lastChecked);
        if (a !== -1 && b !== -1) {
          const selected = item.classList.contains('nxtk-selected');
          for (let j = Math.min(a, b); j <= Math.max(a, b); j++) {
            items[j].classList.toggle('nxtk-selected', selected);
          }
        }
      }
      lastChecked = item;
      updateCount();
    });

    renderList(ndc.mods.all);

    const optsMenu = $('#nxtk-sel-opts-menu');
    bindDropdownToggle($('#nxtk-sel-opts-toggle'), optsMenu);

    bindCustomSelect({
      select: $('#nxtk-mod-sort'),
      trigger: $('#nxtk-mod-sort-trigger'),
      menu: $('#nxtk-mod-sort-menu'),
      placeholder: 'Mod name A-Z'
    });

    $('#nxtk-sel-all').addEventListener('click', () => { listEl.querySelectorAll('.nxtk-mod-item').forEach(el => el.classList.add('nxtk-selected')); updateCount(); });
    $('#nxtk-desel-all').addEventListener('click', () => { listEl.querySelectorAll('.nxtk-mod-item').forEach(el => el.classList.remove('nxtk-selected')); updateCount(); });
    $('#nxtk-invert-sel').addEventListener('click', () => { listEl.querySelectorAll('.nxtk-mod-item').forEach(el => el.classList.toggle('nxtk-selected')); updateCount(); });

    $('#nxtk-export-sel').addEventListener('click', () => {
      const selected = [];
      listEl.querySelectorAll('.nxtk-mod-item.nxtk-selected').forEach(el => {
        const mod = modsByFileId.get(el.dataset.fileId);
        if (mod) selected.push(mod);
      });
      if (!selected.length) { nxtkAlert(NXTK.t('alertPickOneToExport', null, 'Select at least one mod to export.')); return; }
      const payload = {
        schema: SELECTION_SCHEMA_VERSION,
        gameId: ndc.gameId,
        collectionId: ndc.collectionId,
        fileIds: selected.map((mod) => mod.file.fileId),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nxtk_selection_${ndc.gameId}_${ndc.collectionId}_${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });

    $('#nxtk-import-sel').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > MAX_SELECTION_FILE_BYTES) {
          nxtkAlert(NXTK.t('alertSelectionTooLarge', [String(Math.round(MAX_SELECTION_FILE_BYTES / 1024))],
            `Selection file is too large (limit ${Math.round(MAX_SELECTION_FILE_BYTES / 1024)} KB).`));
          return;
        }
        const reader = new FileReader();
        reader.onerror = () => nxtkAlert(NXTK.t('alertSelectionUnreadable', null, 'Selection file could not be read.'));
        reader.onload = () => {
          const selection = parseSelectionFile(reader.result);
          if (!selection) {
            nxtkAlert(NXTK.t('alertSelectionInvalid', null, 'Selection file is not a valid NexusMods Bypass selection.'));
            return;
          }
          const { fileIds } = selection;
          const foreign = (selection.gameId && selection.gameId !== ndc.gameId)
            || (selection.collectionId && selection.collectionId !== ndc.collectionId);

          const wanted = new Set(fileIds.map((id) => String(id)));
          let matched = 0;
          Array.from(listEl.children).forEach((child) => {
            if (!wanted.has(child.dataset.fileId)) return;
            child.classList.add('nxtk-selected');
            matched += 1;
          });
          updateCount();
          const notes = [];
          if (foreign) {
            const from = selection.gameId || '?';
            const slug = selection.collectionId || '?';
            notes.push(NXTK.t('alertSelectionForeign', [from, slug],
              `This file was exported from a different collection (${from}/${slug}).`));
          }
          if (matched < fileIds.length) {
            notes.push(NXTK.t('alertSelectionRest', null, 'The rest are not in this collection revision.'));
          }
          nxtkAlert(`${NXTK.t('alertImportedIds', [String(matched), String(fileIds.length)], `Imported ${matched} of ${fileIds.length} file IDs.`)}${notes.length ? `\n${notes.join('\n')}` : ''}`);
        };
        reader.readAsText(file);
      });
      input.click();
    });

    $('#nxtk-import-dl-mods').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.addEventListener('change', () => {
        const fileNames = Array.from(input.files, (file) => file.name);
        const { matched } = matchModsToFileNames(ndc.mods.all, fileNames);
        const downloadedIds = new Set(matched.map((mod) => String(mod.file.fileId)));
        listEl.querySelectorAll('.nxtk-mod-item').forEach(el => {
          if (!downloadedIds.has(el.dataset.fileId)) el.classList.add('nxtk-selected');
        });
        updateCount();
        const notDl = listEl.querySelectorAll('.nxtk-mod-item.nxtk-selected').length;
        nxtkAlert(notDl
          ? NXTK.tPlural('alertSelectedNotDownloaded', notDl, `Selected ${notDl} mods not yet downloaded.`)
          : NXTK.t('alertAllDownloaded', null, 'All mods already downloaded.'));
      });
      input.click();
    });

    let searchTimer = null;
    const applySearch = (query) => {
      const q = query.replace(/\s+/g, ' ').trim().toLowerCase();
      listEl.querySelectorAll('.nxtk-mod-item').forEach(el => {
        const text = el.dataset.search || el.textContent.toLowerCase();
        el.style.display = !q || text.includes(q) ? '' : 'none';
      });
    };
    $('#nxtk-mod-search').addEventListener('input', (e) => {
      const value = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => applySearch(value), 120);
    });

    $('#nxtk-mod-sort').addEventListener('change', (e) => {
      const mods = [...ndc.mods.all];
      const sortMap = {
        mod_name_asc: (a, b) => nameCollator.compare(a.file.mod.name, b.file.mod.name),
        mod_name_desc: (a, b) => nameCollator.compare(b.file.mod.name, a.file.mod.name),
        file_name_asc: (a, b) => nameCollator.compare(a.file.name, b.file.name),
        file_name_desc: (a, b) => nameCollator.compare(b.file.name, a.file.name),
        size_asc: (a, b) => a.file.size - b.file.size,
        size_desc: (a, b) => b.file.size - a.file.size
      };
      mods.sort(sortMap[e.target.value]);
      const selectedIds = new Set();
      listEl.querySelectorAll('.nxtk-mod-item.nxtk-selected').forEach(el => selectedIds.add(el.dataset.fileId));
      renderList(mods);
      listEl.querySelectorAll('.nxtk-mod-item').forEach(el => {
        if (selectedIds.has(el.dataset.fileId)) el.classList.add('nxtk-selected');
      });
      applySearch($('#nxtk-mod-search').value);
      updateCount();
    });

    $('#nxtk-dl-selected').addEventListener('click', () => {
      const selected = [];
      listEl.querySelectorAll('.nxtk-mod-item.nxtk-selected').forEach(el => {
        const mod = modsByFileId.get(el.dataset.fileId);
        if (mod) selected.push(mod);
      });
      if (!selected.length) { nxtkAlert(NXTK.t('alertPickOneMod', null, 'Select at least one mod.')); return; }
      closeModal('nxtk-select-modal');
      runUiTask(
        () => ndc.downloadMods(selected),
        { context: 'Downloading selected mods', title: NXTK.t('dlgCollectionIssue', null, 'Collection download issue') }
      );
    });

    modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal('nxtk-select-modal')));
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal('nxtk-select-modal'); });
    /* Every other dialog closes on Escape; these two were the exceptions. */
    const onSelectKeyDown = (event) => {
      if (!document.contains(backdrop)) {
        document.removeEventListener('keydown', onSelectKeyDown);
        return;
      }
      if (event.key === 'Escape') {
        document.removeEventListener('keydown', onSelectKeyDown);
        closeModal('nxtk-select-modal');
      }
    };
    document.addEventListener('keydown', onSelectKeyDown);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  }

  const SELECTION_SCHEMA_VERSION = 1;
  const MAX_SELECTION_FILE_BYTES = 512 * 1024;
  const MAX_SELECTION_IDS = 10000;

  function toFileId(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 1e12) return value;
    if (typeof value === 'string' && /^\d{1,12}$/.test(value.trim())) return value.trim();
    return null;
  }

  function readSelectionLabel(value) {
    const text = String(value ?? '').trim();
    return /^[\w.-]{1,64}$/.test(text) ? text : '';
  }

  function parseSelectionFile(raw) {
    let parsed;
    try {
      parsed = JSON.parse(String(raw ?? ''));
    } catch (_) {
      return null;
    }

    let candidates;
    let gameId = '';
    let collectionId = '';
    if (Array.isArray(parsed)) {
      candidates = parsed.map((entry) => (entry && typeof entry === 'object' ? entry?.file?.fileId : entry));
    } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.fileIds)) {
      candidates = parsed.fileIds;
      gameId = readSelectionLabel(parsed.gameId);
      collectionId = readSelectionLabel(parsed.collectionId);
    } else {
      return null;
    }

    if (candidates.length > MAX_SELECTION_IDS) return null;
    const seen = new Set();
    const fileIds = [];
    for (const candidate of candidates) {
      const id = toFileId(candidate);
      if (id === null) continue;
      const key = String(id);
      if (seen.has(key)) continue;
      seen.add(key);
      fileIds.push(id);
    }
    return fileIds.length ? { fileIds, gameId, collectionId } : null;
  }

  function fileFingerprint(entry) {
    const file = entry?.file || {};
    return [
      file.fileId ?? '',
      file.uri ?? '',
      file.name ?? '',
      file.version ?? '',
      file.date ?? '',
      file.size ?? '',
      entry?.optional ? '1' : '0',
    ].join('');
  }

  function normalizeFileName(value) {
    return String(value ?? '').trim().toLowerCase();
  }

  function findCounterpart(entry, candidates, taken) {
    const byId = candidates.find((c) => !taken.has(c) && c.file?.fileId != null && c.file.fileId === entry.file?.fileId);
    if (byId) return byId;

    const uri = normalizeFileName(entry.file?.uri);
    if (uri) {
      const byUri = candidates.find((c) => !taken.has(c) && normalizeFileName(c.file?.uri) === uri);
      if (byUri) return byUri;
    }

    const name = normalizeFileName(entry.file?.name);
    if (!name) return null;
    return candidates.find((c) => !taken.has(c) && normalizeFileName(c.file?.name) === name) || null;
  }

  function diffRevisions(curMods, newMods) {
    const added = [];
    const updated = [];
    const removed = [];
    const modIds = new Set([...Object.keys(curMods), ...Object.keys(newMods)]);

    for (const modId of modIds) {
      const curFiles = curMods[modId] || [];
      const newFiles = newMods[modId] || [];
      const taken = new Set();

      for (const newFile of newFiles) {
        const counterpart = findCounterpart(newFile, curFiles, taken);
        if (!counterpart) {
          added.push(newFile);
          continue;
        }
        taken.add(counterpart);
        if (fileFingerprint(counterpart) !== fileFingerprint(newFile)) updated.push(newFile);
      }

      for (const curFile of curFiles) {
        if (!taken.has(curFile)) removed.push(curFile);
      }
    }

    const dedupe = (list) => {
      const seen = new Set();
      return list.filter((entry) => {
        const key = `${entry.file?.mod?.modId ?? ''}${entry.file?.fileId ?? fileFingerprint(entry)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    return { added: dedupe(added), updated: dedupe(updated), removed: dedupe(removed) };
  }

  function showUpdateModal(ndc) {
    closeModal('nxtk-update-modal');
    const backdrop = document.createElement('div');
    backdrop.className = 'nxtk-modal-backdrop';
    backdrop.id = 'nxtk-update-modal';

    const modal = document.createElement('div');
    modal.className = 'nxtk-modal';
    modal.innerHTML = `
      <div class="nxtk-spinner" id="nxtk-update-spinner">${svgIcon('spinner')}</div>
      <div id="nxtk-update-body" class="nxtk-hidden">
        <div class="nxtk-modal-header">
          <div class="nxtk-modal-title">${L('dlgUpdateTitle', 'Update Collection')}</div>
          <button class="nxtk-modal-close" data-close aria-label="${L('ariaClose', 'Close')}">&times;</button>
        </div>
        <div class="nxtk-form-group">
          <label class="nxtk-form-label" for="nxtk-rev-current-trigger">${L('dlgUpdateCurrentRev', 'Your current revision')}</label>
          <select class="nxtk-native-select-hidden" id="nxtk-rev-current"><option value="">${L('dlgUpdateSelectRev', 'Select a revision')}</option></select>
          <div class="nxtk-custom-select">
            <button type="button" class="nxtk-custom-select-trigger" id="nxtk-rev-current-trigger">
              <span data-select-label>${L('dlgUpdateSelectRev', 'Select a revision')}</span>
              ${svgIcon('chevronDown')}
            </button>
            <div class="nxtk-dropdown-menu nxtk-custom-select-menu" id="nxtk-rev-current-menu"></div>
          </div>
        </div>
        <div class="nxtk-form-group">
          <label class="nxtk-form-label" for="nxtk-rev-new-trigger">${L('dlgUpdateToRev', 'Update to revision')}</label>
          <select class="nxtk-native-select-hidden" id="nxtk-rev-new"><option value="">${L('dlgUpdateSelectRev', 'Select a revision')}</option></select>
          <div class="nxtk-custom-select">
            <button type="button" class="nxtk-custom-select-trigger" id="nxtk-rev-new-trigger">
              <span data-select-label>${L('dlgUpdateSelectRev', 'Select a revision')}</span>
              ${svgIcon('chevronDown')}
            </button>
            <div class="nxtk-dropdown-menu nxtk-custom-select-menu" id="nxtk-rev-new-menu"></div>
          </div>
        </div>
        <div id="nxtk-update-list" class="nxtk-hidden"></div>
        <div class="nxtk-modal-footer">
          <button class="nxtk-btn nxtk-btn-secondary" data-close>${L('btnCancel', 'Cancel')}</button>
          <button class="nxtk-btn nxtk-btn-primary nxtk-hidden" id="nxtk-do-update">${L('dlgUpdateDownload', 'Download updates')}</button>
        </div>
      </div>
    `;
    prepareToolkitSurface(modal);

    const $ = (sel) => modal.querySelector(sel);
    let modsToDownload = [];

    async function loadRevisions() {
      const revisions = await ndc.fetchRevisions();
      if (!revisions) {
        modal.innerHTML = `
          <div class="nxtk-modal-header">
            <div class="nxtk-modal-title">${L('dlgUpdateTitle', 'Update Collection')}</div>
            <button class="nxtk-modal-close" data-close aria-label="${L('ariaClose', 'Close')}">&times;</button>
          </div>
          <p class="nxtk-modal-note">${L('dlgUpdateFetchFailed', 'Failed to fetch revisions. Try again later.')}</p>
          <div class="nxtk-modal-footer">
            <button class="nxtk-btn nxtk-btn-secondary" data-close>${L('btnClose', 'Close')}</button>
          </div>
        `;
        prepareToolkitSurface(modal);
        modal.querySelector('[data-close]')?.addEventListener('click', () => closeModal('nxtk-update-modal'));
        const onUpdateKeyDown = (event) => {
          if (!document.contains(backdrop)) {
            document.removeEventListener('keydown', onUpdateKeyDown);
            return;
          }
          if (event.key === 'Escape') {
            document.removeEventListener('keydown', onUpdateKeyDown);
            closeModal('nxtk-update-modal');
          }
        };
        document.addEventListener('keydown', onUpdateKeyDown);
        return;
      }

      const currentSel = $('#nxtk-rev-current');
      const newSel = $('#nxtk-rev-new');
      revisions.forEach(rev => {
        const size = (rev.totalSize / (1024 * 1024)).toFixed(2);
        const date = new Date(rev.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
        const text = NXTK.t('dlgUpdateRevisionLabel', [String(rev.revisionNumber), size, date],
          `Revision ${rev.revisionNumber} — ${size} MB — ${date}`);
        currentSel.appendChild(new Option(text, rev.revisionNumber));
        newSel.appendChild(new Option(text, rev.revisionNumber));
      });

      bindCustomSelect({
        select: currentSel,
        trigger: $('#nxtk-rev-current-trigger'),
        menu: $('#nxtk-rev-current-menu'),
        placeholder: 'Select a revision'
      });
      bindCustomSelect({
        select: newSel,
        trigger: $('#nxtk-rev-new-trigger'),
        menu: $('#nxtk-rev-new-menu'),
        placeholder: 'Select a revision'
      });

      $('#nxtk-update-spinner').classList.add('nxtk-hidden');
      $('#nxtk-update-body').classList.remove('nxtk-hidden');

      const compareRevisions = async () => {
        if (!currentSel.value || !newSel.value) {
          $('#nxtk-do-update').classList.add('nxtk-hidden');
          $('#nxtk-update-list').classList.add('nxtk-hidden');
          return;
        }
        $('#nxtk-update-list').classList.remove('nxtk-hidden');
        $('#nxtk-update-list').innerHTML = `<div class="nxtk-spinner">${svgIcon('spinner')}</div>`;
        $('#nxtk-do-update').classList.add('nxtk-hidden');

        const [curData, newData] = await Promise.all([
          ndc.fetchMods(ndc.collectionId, parseInt(currentSel.value)),
          ndc.fetchMods(ndc.collectionId, parseInt(newSel.value))
        ]);

        if (!curData?.modFiles || !newData?.modFiles) {
          $('#nxtk-update-list').innerHTML = `<div class="nxtk-update-item" style="opacity:0.7">${L('dlgUpdateCompareFailed', 'Failed to compare revisions. Try again later.')}</div>`;
          return;
        }

        const group = (list) => list.modFiles.reduce((acc, m) => { (acc[m.file.mod.modId] = acc[m.file.mod.modId] || []).push(m); return acc; }, {});
        const curMods = group(curData);
        const newMods = group(newData);
        const { added, updated, removed } = diffRevisions(curMods, newMods);

        modsToDownload = [...added, ...updated];

        const renderCol = (title, colorClass, items) => `
          <div class="nxtk-update-col">
            <h3 class="${colorClass}">${title} <span class="nxtk-count">(${items.length})</span></h3>
            ${items.map(m => `<div class="nxtk-update-item">${escapeHtml(m.file.mod.name)}</div>`).join('') || `<div class="nxtk-update-item" style="opacity:0.5">${L('dlgUpdateNone', 'None')}</div>`}
          </div>`;

        $('#nxtk-update-list').innerHTML = `<div class="nxtk-update-scroll"><div class="nxtk-update-cols">
          ${renderCol(L('dlgUpdateColUpdated', 'Updated'), 'nxtk-color-green', updated)}
          ${renderCol(L('dlgUpdateColAdded', 'Added'), 'nxtk-color-blue', added)}
          ${renderCol(L('dlgUpdateColRemoved', 'Removed'), 'nxtk-color-red', removed)}
        </div></div>`;

        if (modsToDownload.length) $('#nxtk-do-update').classList.remove('nxtk-hidden');
      };

      currentSel.addEventListener('change', () => runUiTask(
        compareRevisions,
        { context: 'Comparing collection revisions', title: NXTK.t('dlgCantCompareRevisions', null, 'Could not compare revisions') }
      ));
      newSel.addEventListener('change', () => runUiTask(
        compareRevisions,
        { context: 'Comparing collection revisions', title: NXTK.t('dlgCantCompareRevisions', null, 'Could not compare revisions') }
      ));
    }

    runUiTask(loadRevisions, { context: 'Loading collection revisions', title: NXTK.t('dlgCantLoadRevisions', null, 'Could not load revisions') });

    $('#nxtk-do-update').addEventListener('click', () => {
      closeModal('nxtk-update-modal');
      runUiTask(
        () => ndc.downloadMods(modsToDownload),
        { context: 'Downloading collection updates', title: NXTK.t('dlgCollectionIssue', null, 'Collection download issue') }
      );
    });

    modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal('nxtk-update-modal')));
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal('nxtk-update-modal'); });
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  }

  /* Announces the tab close that follows a Vortex handoff, and lets the user stop it. The page
     cannot tell whether Vortex actually received the nxm: link, so the close is the one moment
     where a failed handoff is still recoverable — it must not happen silently. Returns a disposer;
     calling it dismisses the toast WITHOUT running onCancel, so an internal cancellation is not
     mistaken for the user pressing the button. */
  function showCloseCountdown({ ms = 3000, onDone = null, onCancel = null } = {}) {
    const total = Math.max(1000, Number(ms) || 3000);
    let remaining = Math.ceil(total / 1000);
    let finished = false;
    let ticker = null;

    const toast = document.createElement('div');
    toast.className = 'nxtk-close-toast';
    toast.setAttribute('role', 'group');
    toast.setAttribute('aria-label', NXTK.t('toastSentToVortex', null, 'Sent to Vortex'));

    const copy = document.createElement('div');
    copy.className = 'nxtk-close-toast-copy';

    /* The live region is the title, which is written once. The countdown beside it is rewritten
       every second, so it is hidden from assistive tech — announcing the whole toast on each tick
       is noise, and the Keep open button already carries the action. */
    const title = document.createElement('strong');
    title.setAttribute('role', 'status');
    title.setAttribute('aria-live', 'polite');
    title.textContent = NXTK.t('toastSentToVortex', null, 'Sent to Vortex');

    const detail = document.createElement('span');
    detail.setAttribute('aria-hidden', 'true');
    const renderDetail = () => {
      detail.textContent = NXTK.tPlural(
        'toastClosingIn',
        remaining,
        `Closing this tab in ${remaining}s`,
        [String(remaining)]
      );
    };
    renderDetail();

    copy.append(title, detail);

    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'nxtk-btn nxtk-btn-secondary nxtk-close-toast-keep';
    keep.textContent = NXTK.t('toastKeepOpen', null, 'Keep open');

    const bar = document.createElement('span');
    bar.className = 'nxtk-close-toast-bar';
    bar.style.setProperty('--nxtk-close-duration', `${total}ms`);

    toast.append(copy, keep, bar);

    const teardown = () => {
      if (finished) return false;
      finished = true;
      clearInterval(ticker);
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 200);
      return true;
    };

    keep.addEventListener('click', () => {
      if (!teardown()) return;
      try { onCancel?.(); } catch (_) { }
    });

    ticker = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        renderDetail();
        return;
      }
      if (!teardown()) return;
      try { onDone?.(); } catch (_) { }
    }, 1000);

    prepareToolkitSurface(toast);
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));

    return () => { teardown(); };
  }

  window.NexusExt.UI = {
    createSettingsFAB,
    createControlDeck,
    disposeControlDeck,
    closeExtensionOverlays,
    cleanupOrphanedPortals,
    showSettingsModal,
    showVortexHandoffModal,
    showHistoryDecisionModal,
    showError,
    showCloseCountdown,
    nxtkAlert
  };
})();
