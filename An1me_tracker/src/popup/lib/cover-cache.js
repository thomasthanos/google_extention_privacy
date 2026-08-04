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

  function backgroundStore(cache, url) {
    if (fetching.has(url)) return;
    fetching.add(url);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    fetch(url, { credentials: "omit", cache: "force-cache", signal: controller.signal })
      .then((resp) => {
        if (resp && resp.ok) {
          return cache.put(url, resp.clone()).catch(() => {});
        }
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
