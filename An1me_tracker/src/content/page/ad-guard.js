// ad-guard.js — blocks the site's popunder ads (the ones that open in a new tab on any click).
//
// Runs in the MAIN world at document_start: the popunder loader is an inline page script, so an
// isolated-world content script could never reach the window.open it calls. Nothing is removed from
// the page and no requests are filtered — only the act of opening a foreign window is refused, which
// is the whole of what these ads do.
//
// The on/off state arrives as a data attribute set by ad-guard-bridge.js, because chrome.storage is
// not reachable from this world and an async read would land long after the ad script has run.
(function () {
  "use strict";

  const OFF_ATTR = "data-at-ad-guard";

  // Genuine new-window targets on an1me.to: its own pages plus the share buttons in the footer.
  const ALLOWED_HOSTS = [
    "an1me.to",
    "t.me",
    "telegram.me",
    "reddit.com",
    "facebook.com",
    "whatsapp.com",
    "twitter.com",
    "x.com",
    "tumblr.com",
  ];

  let blocked = 0;

  function isDisabled() {
    try {
      return document.documentElement.getAttribute(OFF_ATTR) === "off";
    } catch {
      return false;
    }
  }

  function isAllowed(rawUrl) {
    // No URL, about:blank or a data/javascript URI is the popunder's usual opener — it navigates the
    // blank window afterwards. A legitimate share button always passes a real https URL.
    if (!rawUrl) return false;
    let host;
    try {
      host = new URL(String(rawUrl), location.href).hostname.toLowerCase();
    } catch {
      return false;
    }
    if (!host) return false;
    return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith("." + allowed));
  }

  function report(what, url) {
    blocked++;
    try {
      console.log(`%c AdGuard %c blocked ${what}`, "background:#22c55e;color:#000;padding:1px 5px;border-radius:3px", "color:#86efac", url || "(no url)");
    } catch {}
  }

  const nativeOpen = window.open;
  window.open = function (url, ...rest) {
    if (isDisabled() || isAllowed(url)) return nativeOpen.call(window, url, ...rest);
    report("window.open", url);
    return null;
  };

  // Second route these scripts use: build an <a target="_blank"> that never enters the document and
  // click it programmatically. A link the user actually clicks is dispatched by the browser and never
  // reaches this override, and a real in-page link is connected — so both stay untouched.
  const nativeClick = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function (...args) {
    if (!isDisabled() && this instanceof HTMLAnchorElement && !this.isConnected && !isAllowed(this.href)) {
      report("detached link click", this.href);
      return;
    }
    return nativeClick.apply(this, args);
  };

  try {
    Object.defineProperty(window, "__atAdGuard", {
      value: { get blocked() { return blocked; }, allowed: ALLOWED_HOSTS },
      configurable: false,
      enumerable: false,
    });
  } catch {}
})();
