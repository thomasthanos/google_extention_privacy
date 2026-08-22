// cover-cache.js — in-memory/storage cache for anime cover images.
(function () {
  "use strict";

  const AT = (window.AnimeTracker = window.AnimeTracker || {});

  const CACHE_NAME = "at-covers-v1";
  const mem = new Map();
  const fetching = new Set();

  function cachesAvailable() {
    return typeof self !== "undefined" && self.caches && typeof self.caches.open === "function";
  }

  async function openCache() {
    try {
      return await self.caches.open(CACHE_NAME);
    } catch {
      return null;
    }
  }

  // an1me covers hit the same Cloudflare challenge as the page scrapes (403 + CORP: same-origin,
  // which is what surfaces as ERR_BLOCKED_BY_RESPONSE.NotSameOrigin). Fetching them inside an open
  // an1me tab is same-origin and works; everything else (AniList, MAL, TMDB) is fetched directly.
  function isAn1meUrl(url) {
    try {
      const host = new URL(url, location.href).hostname.toLowerCase();
      return host === "an1me.to" || host.endsWith(".an1me.to");
    } catch {
      return false;
    }
  }

  async function fetchViaAn1meTab(url) {
    let tabs;
    try {
      tabs = await chrome.tabs.query({ url: ["https://an1me.to/*", "https://*.an1me.to/*"] });
    } catch {
      return null;
    }
    const tab = (tabs || []).find((t) => t && t.id != null && t.discarded !== true && t.status !== "unloaded");
    if (!tab) return null;

    const reply = await new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tab.id, { type: "AN1ME_FETCH", url, as: "dataUrl", timeoutMs: 15000 }, (r) => {
          void chrome.runtime.lastError;
          resolve(r || null);
        });
      } catch {
        resolve(null);
      }
    });
    if (!reply || !reply.ok || typeof reply.dataUrl !== "string" || !reply.dataUrl.startsWith("data:image/")) return null;

    try {
      return await (await fetch(reply.dataUrl)).blob();
    } catch {
      return null;
    }
  }
  function backgroundStore(cache, url) {
    if (fetching.has(url)) return;
    fetching.add(url);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const request = isAn1meUrl(url)
      ? fetchViaAn1meTab(url).then((blob) => (blob ? new Response(blob) : fetch(url, { credentials: "omit", cache: "force-cache", signal: controller.signal })))
      : fetch(url, { credentials: "omit", cache: "force-cache", signal: controller.signal });
    request
      .then(async (resp) => {
        if (!resp || !resp.ok) return;
        await cache.put(url, resp.clone()).catch(() => {});
        // Publish it for this session too, otherwise resolve() keeps handing out the raw an1me
        // URL and the <img> stays broken until the next popup open warms from the cache.
        try {
          const blob = await resp.blob();
          if (blob && blob.size > 0 && !mem.has(url)) mem.set(url, URL.createObjectURL(blob));
        } catch {}
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeoutId);
        fetching.delete(url);
      });
  }

  const CoverCache = {
    resolve(url) {
      if (!url) return url;
      return mem.get(url) || url;
    },

    async warm(urls) {
      if (!cachesAvailable() || !urls || !urls.length) return;
      const cache = await openCache();
      if (!cache) return;

      const unique = [];
      const seen = new Set();
      for (const url of urls) {
        if (!url || typeof url !== "string" || !url.startsWith("https://")) continue;
        if (mem.has(url) || seen.has(url)) continue;
        seen.add(url);
        unique.push(url);
      }

      await Promise.all(
        unique.map(async (url) => {
          try {
            const hit = await cache.match(url);
            if (hit) {
              const blob = await hit.blob();
              if (blob && blob.size > 0) {
                mem.set(url, URL.createObjectURL(blob));
                return;
              }
            }
          } catch {
            /* noop */
          }
          backgroundStore(cache, url);
        }),
      );
    },
  };

  AT.CoverCache = CoverCache;

  // Free the object URLs when the popup/side panel goes away (long side-panel
  // sessions would otherwise hold one blob URL per distinct cover).
  window.addEventListener("pagehide", () => {
    for (const objectUrl of mem.values()) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {}
    }
    mem.clear();
  });
})();
