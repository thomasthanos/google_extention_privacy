// slug-migration.js — renames stale anime slugs to their current form when the
// site changes URLs, so watch progress isn't orphaned.
(function () {
  "use strict";

  const STATE_KEY = "_slugMigrationStateV1";

  const RUN_GAP_MS = 7 * 24 * 3600 * 1000;
  const PER_SLUG_COOLDOWN_MS = 24 * 3600 * 1000;
  // A movie/series mismatch is deterministic: re-probing can only reach the same verdict, so these
  // are parked far longer than an ordinary retry.
  const INCOMPATIBLE_COOLDOWN_MS = 30 * 24 * 3600 * 1000;
  const PROBE_TIMEOUT_MS = 8000;
  const PROBE_GAP_MS = 700;
  const SEARCH_PROBE_GAP_MS = 1500;
  const MAX_RENAMES_PER_RUN = 25;

  function getMigrationMediaType(slug, entry = null) {
    const stored = globalThis.AnimeTrackerMediaType?.normalize(entry?.mediaType) || null;
    const inferred = globalThis.AnimeTrackerMediaType?.infer(slug, entry?.title || "") || null;
    if (globalThis.AnimeTrackerMediaType?.isSupplement(inferred) && (!stored || Number(entry?.totalEpisodes) === 1)) return inferred;
    return stored || inferred;
  }

  function areMigrationTypesCompatible(sourceType, targetType) {
    if (!sourceType) return true;
    if (["TV", "TV_SHORT"].includes(sourceType)) return !targetType || ["TV", "TV_SHORT"].includes(targetType);
    return !!targetType && sourceType === targetType;
  }
  // Kept as a no-op: movie/ova/special slugs are no longer skipped upfront — compatibility is checked when resolving.
  function shouldSkipSlugForMigration(slug) { return false; }

  function fallbackSlugify(title) {
    return String(title || "")
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, " ")
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  function getSlugify() {
    const Core = (typeof globalThis !== "undefined" && globalThis.AniListCore) || (typeof self !== "undefined" && self.AniListCore) || null;
    return Core && typeof Core.slugify === "function" ? Core.slugify : fallbackSlugify;
  }

  function sget(keys) {
    return window.AnimeTracker.Storage.get(keys);
  }
  function sset(obj) {
    return window.AnimeTracker.Storage.set(obj);
  }
  function sremove(keys) {
    return window.AnimeTracker.Storage.remove(keys);
  }
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function logInfo(...args) {
    try {
      console.log("[SlugMigration]", ...args);
    } catch {}
  }
  function logWarn(...args) {
    try {
      console.warn("[SlugMigration]", ...args);
    } catch {}
  }

  // an1me.to answers extension-origin requests with a Cloudflare challenge (HTTP 403). A fetch
  // performed inside an open an1me tab is same-origin and rides that tab's clearance, so probes go
  // through site-fetch-bridge.js when a tab exists and fall back to a direct fetch when none does.
  async function fetchAn1meViaTab(url) {
    if (typeof chrome === "undefined" || !chrome.tabs?.query) return null;
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
        chrome.tabs.sendMessage(tab.id, { type: "AN1ME_FETCH", url, timeoutMs: PROBE_TIMEOUT_MS }, (r) => {
          void chrome.runtime.lastError;
          resolve(r || null);
        });
      } catch {
        resolve(null);
      }
    });
    // No answer at all means the bridge is absent, not that the page is missing — let the caller
    // fall back rather than record a false negative for the slug.
    if (!reply || typeof reply.text !== "string") return null;
    return { ok: reply.ok === true, status: Number(reply.status) || 0, text: reply.text };
  }
  async function probeSlug(slug) {
    if (!slug) return false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
      const url = `https://an1me.to/anime/${encodeURIComponent(slug)}/`;
      const viaTab = await fetchAn1meViaTab(url);
      if (viaTab) return viaTab.ok;

      const res = await fetch(url, {
        method: "GET",
        signal: ctrl.signal,
        redirect: "follow",
        cache: "no-store",
        credentials: "omit",
      });

      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function searchAn1meForTitle(title) {
    const q = String(title || "").trim();
    if (!q) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
      const url = `https://an1me.to/?s=${encodeURIComponent(q)}&post_type=anime`;
      const viaTab = await fetchAn1meViaTab(url);
      const html = viaTab ? (viaTab.ok ? viaTab.text : null) : await (async () => {
        const res = await fetch(url, {
          method: "GET",
          signal: ctrl.signal,
          redirect: "follow",
          cache: "no-store",
          credentials: "omit",
        });
        return res.ok ? await res.text() : null;
      })();
      if (html === null) return null;

      // Collect ALL /anime/ links and pick the one whose slug best matches the searched
      // title — the first link on the page can be a nav element or an unrelated result,
      // and a wrong pick here renames (merges) the library entry under the wrong slug.
      const wantedTokens = new Set(
        getSlugify()(q)
          .split("-")
          .filter((w) => w.length > 2),
      );
      const re = /\/anime\/([a-z0-9][a-z0-9-]*)\/?(?:["'?#])/gi;
      const seen = new Set();
      let best = null;
      let bestRatio = 0;
      let m;
      while ((m = re.exec(html)) !== null) {
        const cand = m[1].toLowerCase();
        if (!cand || cand === "page" || cand.length < 3 || seen.has(cand)) continue;
        seen.add(cand);
        if (wantedTokens.size === 0) continue;
        const candTokens = new Set(cand.split("-").filter((w) => w.length > 2));
        let shared = 0;
        for (const w of wantedTokens) if (candTokens.has(w)) shared++;
        const ratio = shared / wantedTokens.size;
        if (ratio > bestRatio) {
          bestRatio = ratio;
          best = cand;
        }
      }
      return bestRatio >= 0.5 ? best : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function relocateSidecars(stores, from, to) {
    const { videoProgress, deletedAnime, groupCoverImages } = stores;

    const fromPrefix = `${from}__episode-`;
    for (const key of Object.keys(videoProgress)) {
      if (!key.startsWith(fromPrefix)) continue;
      const newKey = `${to}__episode-${key.slice(fromPrefix.length)}`;
      const incoming = videoProgress[key];
      const existing = videoProgress[newKey];
      if (!existing) {
        videoProgress[newKey] = incoming;
      } else {
        const aTs = new Date(existing.savedAt || 0).getTime() || 0;
        const bTs = new Date(incoming.savedAt || 0).getTime() || 0;
        videoProgress[newKey] = bTs > aTs ? incoming : existing;
      }
      delete videoProgress[key];
    }

    if (deletedAnime[from]) {
      const incoming = deletedAnime[from];
      const existing = deletedAnime[to];
      if (!existing) {
        deletedAnime[to] = incoming;
      } else {
        const aTs = new Date(existing.deletedAt || 0).getTime() || 0;
        const bTs = new Date(incoming.deletedAt || 0).getTime() || 0;
        deletedAnime[to] = bTs > aTs ? incoming : existing;
      }
      delete deletedAnime[from];
    }

    if (groupCoverImages[from]) {
      if (!groupCoverImages[to]) groupCoverImages[to] = groupCoverImages[from];
      delete groupCoverImages[from];
    }
  }

  async function applyRenames(renames, stores) {
    const Merge =
      (typeof self !== "undefined" && self.AnimeTrackerMergeUtils) || (typeof window !== "undefined" && window.AnimeTrackerMergeUtils);
    const mergeAnimeData = Merge && Merge.mergeAnimeData;
    if (!mergeAnimeData) {
      logWarn("mergeAnimeData unavailable — skipping rename application.");
      return 0;
    }

    const applyToStores = (targetStores) => {
      const animeData = targetStores.animeData;
      const cacheKeysToRemove = [];
      let applied = 0;

      for (const { from, to } of renames) {
        if (!animeData[from]) continue;

        const movedEntry = { ...animeData[from], slug: to };
        movedEntry.listStateUpdatedAt = movedEntry.listStateUpdatedAt || movedEntry.lastWatched || new Date().toISOString();

        if (animeData[to]) {
          const merged = mergeAnimeData({ [to]: animeData[to] }, { [to]: movedEntry });
          animeData[to] = merged[to];
        } else {
          animeData[to] = movedEntry;
        }
        delete animeData[from];
        relocateSidecars(targetStores, from, to);
        cacheKeysToRemove.push(`animeinfo_${from}`, `episodeTypes_${from}`, `fillerslug_${from}`);
        applied += 1;
      }

      return { applied, cacheKeysToRemove, stores: targetStores };
    };

    const coordinator = typeof window !== "undefined" ? window.AnimeTracker?.LibraryMutations : null;
    let result;
    if (coordinator?.enqueue) {
      result = await coordinator.enqueue("slug-renames", async ({ commit, snapshot }) => {
        const latestStores = {
          animeData: snapshot.animeData || {},
          videoProgress: snapshot.videoProgress || {},
          deletedAnime: snapshot.deletedAnime || {},
          groupCoverImages: snapshot.groupCoverImages || {},
        };
        const appliedResult = applyToStores(latestStores);
        if (appliedResult.applied === 0) return appliedResult;
        await commit(latestStores, { immediate: true, label: "slug-renames" });
        return appliedResult;
      });
    } else {
      result = applyToStores(stores);
      if (result.applied > 0) await sset(result.stores);
    }

    if (result.cacheKeysToRemove.length > 0) await sremove(result.cacheKeysToRemove);
    return result.applied;
  }

  function buildCandidatesForEntry(slug, entry) {
    const out = [];
    const seen = new Set([slug]);
    const slugify = getSlugify();
    const add = (cand) => {
      if (!cand || seen.has(cand)) return;
      seen.add(cand);
      out.push(cand);
    };

    add(slugify(entry.title));

    add(slugify(entry.romajiTitle));
    add(slugify(entry.englishTitle));
    add(slugify(entry.nativeTitle));

    const stripped = slug.replace(/-(?:ntr|tv|ova|sub|dub)$/i, "");
    if (stripped && stripped !== slug) add(stripped);

    return out;
  }

  async function migrate({ force = false } = {}) {
    const summary = { tried: 0, renamed: 0, skipped: 0, ranAt: Date.now() };
    const meta = await sget([STATE_KEY]);
    const state = meta[STATE_KEY] || { lastRunAt: 0, perSlug: {} };

    if (!force && Date.now() - (state.lastRunAt || 0) < RUN_GAP_MS) {
      summary.skipped = 1;
      return summary;
    }

    const base = await sget(["animeData", "videoProgress", "deletedAnime", "groupCoverImages"]);
    const animeData = base.animeData || {};
    const slugs = Object.keys(animeData);
    if (slugs.length === 0) {
      state.lastRunAt = Date.now();
      await sset({ [STATE_KEY]: state });
      return summary;
    }

    const cacheKeys = slugs.map((s) => `animeinfo_${s}`);
    const caches = cacheKeys.length > 0 ? await sget(cacheKeys) : {};

    const suspects = [];
    for (const slug of slugs) {
      const cache = caches[`animeinfo_${slug}`];
      if (!cache || !cache.notFound) continue;
      const prior = state.perSlug[slug];
      const triedAt = (prior && prior.triedAt) || 0;
      // force lifts the run gate only. It used to lift this cooldown too, which meant every
      // sign-in re-probed the same unresolvable slugs and replayed their 404s and warnings.
      if (prior && prior.incompatible && Date.now() - triedAt < INCOMPATIBLE_COOLDOWN_MS) continue;
      if (Date.now() - triedAt < PER_SLUG_COOLDOWN_MS) continue;

      if (shouldSkipSlugForMigration(slug)) continue;
      suspects.push(slug);
    }

    if (suspects.length === 0) {
      state.lastRunAt = Date.now();
      await sset({ [STATE_KEY]: state });
      return summary;
    }

    logInfo(`Probing ${suspects.length} suspect slug(s)…`);

    const stores = {
      animeData,
      videoProgress: base.videoProgress || {},
      deletedAnime: base.deletedAnime || {},
      groupCoverImages: base.groupCoverImages || {},
    };
    const renames = [];

    for (const slug of suspects) {
      if (renames.length >= MAX_RENAMES_PER_RUN) break;

      const entry = animeData[slug];
      if (!entry) continue;
      summary.tried++;

      const candidates = buildCandidatesForEntry(slug, entry);
      let resolved = null;

      for (const cand of candidates) {
        if (await probeSlug(cand)) {
          resolved = cand;
          break;
        }
        await sleep(PROBE_GAP_MS);
      }

      if (!resolved) {
        const searchTitle = entry.englishTitle || entry.title || entry.romajiTitle || slug.replace(/-/g, " ");
        const found = await searchAn1meForTitle(searchTitle);
        if (found && found !== slug && (await probeSlug(found))) {
          resolved = found;
        }
        await sleep(SEARCH_PROBE_GAP_MS);
      }

      state.perSlug[slug] = { triedAt: Date.now(), resolved: resolved || null };

      if (resolved) {
        const sourceType = getMigrationMediaType(slug, entry);
        const targetType = getMigrationMediaType(resolved);
        if (areMigrationTypesCompatible(sourceType, targetType)) {
          renames.push({ from: slug, to: resolved });
          logInfo(`Found target for "${slug}" → "${resolved}"`);
        } else {
          state.perSlug[slug] = { ...state.perSlug[slug], incompatible: true };
          logWarn(`Skipping incompatible rename for "${slug}" → "${resolved}" (movie/series type mismatch)`);
        }
      }
    }

    if (renames.length > 0) {
      const applied = await applyRenames(renames, stores);
      summary.renamed = applied;
      logInfo(`Renamed ${applied} entries.`);
    }

    state.lastRunAt = Date.now();
    await sset({ [STATE_KEY]: state });
    return summary;
  }

  const root = typeof self !== "undefined" ? self : window;
  root.AnimeTrackerSlugMigration = { migrate };
})();
