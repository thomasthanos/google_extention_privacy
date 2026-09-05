(function () {
  'use strict';

  const NXTK = globalThis.NXTK;
  if (!NXTK?.applyI18nTo) return;

  try {
    chrome.storage.local.get(NXTK.SETTINGS_KEY, (result) => {
      if (!chrome.runtime.lastError) {
        const stored = result?.[NXTK.SETTINGS_KEY];
        NXTK.setForceEnglish(stored ? stored.ForceEnglish : NXTK.DEFAULTS.ForceEnglish);
      }
      NXTK.applyI18nTo(document);
      try {
        const stored = result?.[NXTK.SETTINGS_KEY];
        const forceEnglish = stored ? stored.ForceEnglish : NXTK.DEFAULTS.ForceEnglish;
        const ui = forceEnglish ? 'en' : (chrome.i18n.getUILanguage?.() || '');
        if (ui) document.documentElement.lang = ui;
      } catch (_) {
      }
    });
  } catch (_) {
  }
})();
