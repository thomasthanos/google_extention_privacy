(function () {
  'use strict';

  const PROJECT_URL = NXTK.GITHUB_REPO_URL;
  const GITHUB_SPONSOR_URL = 'https://github.com/sponsors/thomasthanos';
  const PAYPAL_URL = 'https://paypal.me/Thomasthanos';
  const REVOLUT_URL = 'https://revolut.me/thomas2873';
  let supportViewOpen = false;

  function getRuntimeError() {
    try {
      return chrome.runtime.lastError?.message || '';
    } catch (_) {
      return 'The extension context is no longer available.';
    }
  }

  function showStatus(message, type = 'error', { record = true, diagnostic = '' } = {}) {
    const status = document.getElementById('popupStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('popup-status-error', type === 'error');
    status.hidden = !message;
    if (message && type === 'error' && record) {
      NXTK.recordError({
        code: 'popup_error',
        context: 'Popup action',
        userMessage: diagnostic || 'Popup action failed'
      });
    }
  }

  function createTab(url) {
    try {
      chrome.tabs.create({ url }, () => {
        const error = getRuntimeError();
        if (error) showStatus(NXTK.t('popupCantOpenPage', [String(error)], `Could not open this page: ${error}`), 'error', { diagnostic: `Could not open tab: ${error}` });
      });
    } catch (error) {
      showStatus(NXTK.t('popupCantOpenPage', [String(error?.message || 'extension error')], `Could not open this page: ${error?.message || 'extension error'}`), 'error', { diagnostic: `Could not open tab: ${error?.message || 'extension error'}` });
    }
  }

  async function getSettings() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get(NXTK.SETTINGS_KEY, result => {
          const error = getRuntimeError();
          if (error) {
            showStatus(NXTK.t('popupCantLoadSettings', [String(error)], `Could not load saved settings: ${error}`), 'error', { diagnostic: `Settings read failed: ${error}` });
            resolve({ ...NXTK.DEFAULTS });
            return;
          }
          resolve({ ...NXTK.DEFAULTS, ...(result[NXTK.SETTINGS_KEY] || {}) });
        });
      } catch (error) {
        showStatus(NXTK.t('popupCantLoadSettings', [String(error?.message || 'extension error')], `Could not load saved settings: ${error?.message || 'extension error'}`), 'error', { diagnostic: `Settings read failed: ${error?.message || 'extension error'}` });
        resolve({ ...NXTK.DEFAULTS });
      }
    });
  }

  async function saveSetting(key, value) {
    return new Promise(resolve => {
      const fail = (detail) => {
        showStatus(NXTK.t('popupCantSaveSettings', [String(detail)], `Settings were not saved: ${detail}`), 'error', { diagnostic: `Settings write failed: ${detail}` });
        resolve(false);
      };
      try {
        chrome.runtime.sendMessage({ type: 'SETTINGS_PATCH', payload: { patch: { [key]: value } } }, (reply) => {
          const writeError = getRuntimeError();
          if (writeError) return fail(writeError);
          if (!reply?.ok) return fail(reply?.error || 'extension error');
          resolve(true);
        });
      } catch (error) {
        fail(error?.message || 'extension error');
      }
    });
  }

  function applyI18n() {
    NXTK.applyI18nTo(document);
  }

  function showSupportStatus(message, type = 'info') {
    const status = document.getElementById('supportStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('support-status-error', type === 'error');
    status.hidden = !message;
  }


  function setSupportView(open) {
    const main = document.getElementById('popupMainView');
    const support = document.getElementById('popupSupportView');
    const trigger = document.getElementById('openSupport');
    const back = document.getElementById('closeSupport');
    if (!main || !support || !trigger || !back) return;

    supportViewOpen = !!open;
    trigger.setAttribute('aria-expanded', String(supportViewOpen));
    main.classList.remove('is-active');
    support.classList.remove('is-active');

    if (supportViewOpen) {
      main.hidden = true;
      main.inert = true;
      main.setAttribute('aria-hidden', 'true');
      support.hidden = false;
      support.inert = false;
      support.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => {
        if (supportViewOpen) support.classList.add('is-active');
      });
      back.focus({ preventScroll: true });
      return;
    }

    support.hidden = true;
    support.inert = true;
    support.setAttribute('aria-hidden', 'true');
    main.hidden = false;
    main.inert = false;
    main.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      if (!supportViewOpen) main.classList.add('is-active');
    });
    trigger.focus({ preventScroll: true });
  }


  function maybeShowRatingPrompt() {
    try {
      chrome.storage.local.get([NXTK.TOTAL_DOWNLOADS_KEY, NXTK.RATING_PROMPT_KEY], (result) => {
        if (getRuntimeError()) return;
        const count = Number(result?.[NXTK.TOTAL_DOWNLOADS_KEY]) || 0;
        if (result?.[NXTK.RATING_PROMPT_KEY] || count < 25) return;

        const box = document.getElementById('popupRating');
        if (!box) return;
        box.hidden = false;
        const markDone = () => {
          box.hidden = true;
          try {
            chrome.storage.local.set({ [NXTK.RATING_PROMPT_KEY]: true });
          } catch (_) { }
        };
        document.getElementById('ratingDismiss')?.addEventListener('click', markDone);
        document.getElementById('ratingLink')?.addEventListener('click', markDone);
      });
    } catch (_) {
    }
  }

  function switchTab(tabId, { focus = false } = {}) {
    const tabs = document.querySelectorAll('.popup-tab');
    const panels = document.querySelectorAll('.popup-tab-panel');

    document.querySelector('.popup-tabs')?.setAttribute('data-tab', tabId);

    tabs.forEach(t => {
      const active = t.id === tabId;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
      t.tabIndex = active ? 0 : -1;
      if (active && focus) t.focus({ preventScroll: true });
    });

    panels.forEach(p => {
      const panelId = 'panel' + tabId.replace('tab', '');
      const active = p.id === panelId;
      p.classList.remove('is-active');
      p.hidden = !active;
      if (active) {
        requestAnimationFrame(() => p.classList.add('is-active'));
      }
    });
  }

  async function init() {
    const versionEl = document.querySelector('.popup-version');
    if (versionEl) versionEl.textContent = `v${chrome.runtime.getManifest().version}`;

    const cfg = await getSettings();
    NXTK.setForceEnglish(cfg.ForceEnglish);
    applyI18n();

    const tabList = document.querySelector('.popup-tabs');
    const tabIds = ['tabControls', 'tabHelp'];
    tabIds.forEach(id => document.getElementById(id)?.addEventListener('click', () => switchTab(id)));

    tabList?.addEventListener('keydown', (event) => {
      const current = tabIds.indexOf(document.activeElement?.id);
      if (current < 0) return;
      let next = current;
      if (event.key === 'ArrowRight') next = (current + 1) % tabIds.length;
      else if (event.key === 'ArrowLeft') next = (current - 1 + tabIds.length) % tabIds.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabIds.length - 1;
      else return;
      event.preventDefault();
      switchTab(tabIds[next], { focus: true });
    });

    document.querySelectorAll('[data-key]').forEach(input => {
      const key = input.dataset.key;
      if (key in cfg) input.checked = !!cfg[key];

      input.addEventListener('change', async () => {
        const previousValue = cfg[key];
        cfg[key] = input.checked;
        const saved = await saveSetting(key, input.checked);
        if (!saved) {
          cfg[key] = previousValue;
          input.checked = !!previousValue;
        }
        if (key === 'ForceEnglish') {
          NXTK.setForceEnglish(cfg[key]);
          applyI18n();
        }
      });
    });

    document.getElementById('openSettings').addEventListener('click', () => {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          const error = getRuntimeError();
          if (error) {
            showStatus(NXTK.t('popupCantOpenPageSettings', [String(error)], `Could not open page settings: ${error}`), 'error', { diagnostic: `Page settings open failed: ${error}` });
            return;
          }
          if (tabs[0] && tabs[0].url?.includes('nexusmods.com')) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_POPOUT' }, () => {
              if (getRuntimeError()) {
                showStatus(NXTK.t('popupReloadFirst', null, 'Reload the Nexus Mods page before opening page settings.'), 'error', { record: false });
                return;
              }
              window.close();
            });
          } else {
            createTab('https://www.nexusmods.com');
          }
        });
      } catch (error) {
        showStatus(NXTK.t('popupCantOpenPageSettings', [String(error?.message || 'extension error')], `Could not open page settings: ${error?.message || 'extension error'}`), 'error', { diagnostic: `Page settings open failed: ${error?.message || 'extension error'}` });
      }
    });

    document.getElementById('goToNexus').addEventListener('click', () => {
      createTab('https://www.nexusmods.com');
    });

    document.getElementById('openSupport').addEventListener('click', () => {
      showSupportStatus('');
      setSupportView(true);
    });

    document.getElementById('closeSupport').addEventListener('click', () => {
      setSupportView(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !supportViewOpen) return;
      event.preventDefault();
      setSupportView(false);
    });

    document.getElementById('supportGithub').addEventListener('click', () => {
      createTab(PROJECT_URL);
    });

    document.getElementById('supportCopy').addEventListener('click', async () => {
      const copied = await NXTK.copyText(PROJECT_URL);
      showSupportStatus(
        copied
          ? NXTK.t('supportCopied', null, 'Project link copied to your clipboard.')
          : NXTK.t('supportCopyFailed', null, 'The project link could not be copied.'),
        copied ? 'info' : 'error'
      );
    });

    document.getElementById('reportBug').addEventListener('click', async () => {
      NXTK.setActivity({ trigger: 'popup' });
      let issueUrl = NXTK.REPORT_ISSUE_URL;
      let copied = false;
      let complete = false;
      try {
        const report = await NXTK.buildBugReport();
        const result = await NXTK.buildReportIssueUrl(null, { fullReport: report });
        issueUrl = result.url;
        complete = result.complete;
        if (!complete) copied = await NXTK.copyText(report);
      } catch (_) {
        copied = false;
      }
      if (complete) {
        showStatus(NXTK.t('popupReportFull', null, 'GitHub opens with the full report — just describe what happened.'), 'info');
      } else if (copied) {
        showStatus(NXTK.t('popupReportShortened', null, 'Report shortened to fit — the full copy is on your clipboard.'), 'info');
      } else {
        showStatus(NXTK.t('popupReportNoCopy', null, 'GitHub opens prefilled — the full report could not be copied.'), 'error', { record: false });
      }
      setTimeout(() => createTab(issueUrl), 600);
    });

    document.getElementById('supportGithubSponsor')?.addEventListener('click', () => createTab(GITHUB_SPONSOR_URL));
    document.getElementById('supportPaypal')?.addEventListener('click', () => createTab(PAYPAL_URL));
    document.getElementById('supportRevolut')?.addEventListener('click', () => createTab(REVOLUT_URL));

    maybeShowRatingPrompt();
  }

  init().catch((error) => {
    NXTK.recordError({
      code: 'popup_error',
      context: 'Popup startup',
      userMessage: 'The popup could not finish loading.',
      technicalMessage: String(error?.message || error || ''),
      stack: String(error?.stack || '')
    });
    showStatus(NXTK.t('popupLoadFailed', null, 'The popup could not finish loading. Reload the extension and try again.'), 'error', { record: false });
  });
})();
