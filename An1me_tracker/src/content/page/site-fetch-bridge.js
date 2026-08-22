// site-fetch-bridge.js — performs an1me.to fetches from inside a real page.
//
// Cloudflare answers requests made from the extension's own origin with a managed challenge
// (`cf-mitigated: challenge`, HTTP 403) because they carry `Origin: chrome-extension://…` and
// `Sec-Fetch-Site: cross-site` — headers a background fetch is not allowed to change. A request
// issued here is same-origin, carries a real Referer, and rides the clearance this tab already has,
// so it comes back 200. The background asks this bridge first and only falls back to a direct fetch.
(function () {
  "use strict";

  const MAX_TIMEOUT_MS = 30000;
  const AN1ME_URL = /^https:\/\/(?:[a-z0-9-]+\.)?an1me\.to\//i;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "AN1ME_FETCH") return false;

    const url = String(message.url || "");
    // Never proxy anywhere else: this bridge lends the page's cookies and clearance to whoever asks.
    if (!AN1ME_URL.test(url)) {
      sendResponse({ ok: false, error: "url_not_allowed" });
      return false;
    }

    const ctrl = new AbortController();
    const timeoutMs = Math.min(Number(message.timeoutMs) || 15000, MAX_TIMEOUT_MS);
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    fetch(url, { method: "GET", credentials: "include", redirect: "follow", cache: "no-store", signal: ctrl.signal })
      .then(async (res) => {
        // Covers are binary: hand them back as a data URL so the caller can cache them without
        // ever issuing its own cross-origin request for the image.
        if (message.as === "dataUrl") {
          const blob = await res.blob();
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(reader.error || new Error("read_failed"));
            reader.readAsDataURL(blob);
          });
          sendResponse({ ok: res.ok, status: res.status, finalUrl: res.url, dataUrl });
          return;
        }
        const text = await res.text();
        sendResponse({ ok: res.ok, status: res.status, finalUrl: res.url, text });
      })
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }))
      .finally(() => clearTimeout(timer));

    return true;
  });
})();
