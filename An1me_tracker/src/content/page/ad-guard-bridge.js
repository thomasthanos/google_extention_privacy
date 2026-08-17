// ad-guard-bridge.js — carries the Ad Guard on/off preference into the MAIN world.
//
// ad-guard.js cannot read chrome.storage from where it runs, so this isolated-world script mirrors
// the setting onto a root data attribute. It only ever writes "off": the guard defaults to blocking,
// which keeps ads blocked during the gap between document_start and this async storage read.
(function () {
  "use strict";

  const STORAGE_KEY = "adGuardEnabled";
  const OFF_ATTR = "data-at-ad-guard";

  function apply(enabled) {
    try {
      const root = document.documentElement;
      if (!root) return;
      if (enabled) root.removeAttribute(OFF_ATTR);
      else root.setAttribute(OFF_ATTR, "off");
    } catch {}
  }

  try {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) return;
      apply(result[STORAGE_KEY] !== false);
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== "local" || !changes[STORAGE_KEY]) return;
      apply(changes[STORAGE_KEY].newValue !== false);
    });
  } catch {}
})();
