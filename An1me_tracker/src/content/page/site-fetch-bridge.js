(function () {
  "use strict";

  const MAX_TIMEOUT_MS = 30000;
  const AN1ME_URL = /^https:\/\/(?:[a-z0-9-]+\.)?an1me\.to\//i;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return false;

    if (message.type === "AN1ME_PING") {
      sendResponse({ ready: true });
      return false;
    }

    if (message.type !== "AN1ME_FETCH") return false;

    const url = String(message.url || "");
    if (!AN1ME_URL.test(url)) {
      sendResponse({ ok: false, error: "url_not_allowed" });
      return false;
    }

    const ctrl = new AbortController();
    const timeoutMs = Math.min(Number(message.timeoutMs) || 15000, MAX_TIMEOUT_MS);
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    fetch(url, { method: "GET", credentials: "include", redirect: "follow", cache: "no-store", signal: ctrl.signal })
      .then(async (res) => {
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
        sendResponse({ ok: res.ok, status: res.status, finalUrl: res.url, text: await res.text() });
      })
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }))
      .finally(() => clearTimeout(timer));

    return true;
  });
})();
