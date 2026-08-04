/* welcome.js — applies localized strings to the onboarding page. English is
   baked into the markup, so a missing translation simply keeps the default. */
(function () {
  'use strict';

  const NXTK = globalThis.NXTK;
  if (!NXTK?.applyI18nTo) return;

  // Read ForceEnglish before sweeping, or the browser language paints for a frame.
  try {
    chrome.storage.local.get(NXTK.SETTINGS_KEY, (result) => {
      if (!chrome.runtime.lastError) {
        const stored = result?.[NXTK.SETTINGS_KEY];
        NXTK.setForceEnglish(stored ? stored.ForceEnglish : NXTK.DEFAULTS.ForceEnglish);
      }
      NXTK.applyI18nTo(document);
    });
  } catch (_) {
    // Storage unavailable — the baked English markup is already correct.
  }
})();
