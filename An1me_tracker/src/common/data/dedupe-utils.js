// dedupe-utils.js — detects and merges duplicate library entries pointing to the
// same anime under two slugs (e.g. the AniList-import romaji slug vs the real
// an1me.to URL slug). Pure decision logic; the popup orchestrator does the IO.
//
// Multi-device note: the merged-away slug gets a deletedAnime tombstone so cloud
// sync doesn't resurrect it. If another device keeps watching under the loser
// slug, its newer activity legitimately outlives the tombstone — the entry comes
// back and is re-merged (losslessly) on the next popup load here.
(function () {
  "use strict";

  const TOMBSTONE_GRACE_MS = 5000;

  function toMillis(value) {
    if (!value) return 0;
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) ? ts : 0;
  }

  function getActivityTimestamp(anime) {
    if (!anime || typeof anime !== "object") return 0;
    let latest = Math.max(
      toMillis(anime.lastWatched),
      toMillis(anime.listStateUpdatedAt),
      toMillis(anime.titleUpdatedAt),
      toMillis(anime.completedAt),
      toMillis(anime.droppedAt),
      toMillis(anime.onHoldAt),
    );
    for (const episode of Array.isArray(anime.episodes) ? anime.episodes : []) {
      latest = Math.max(latest, toMillis(episode?.watchedAt));
    }
    return latest;
  }

  function watchedEpisodeNumbers(entry) {
    const nums = new Set();
    for (const ep of Array.isArray(entry?.episodes) ? entry.episodes : []) {
      const n = Number(ep?.number);
      if (Number.isFinite(n)) nums.add(n);
    }
    return [...nums].sort((a, b) => a - b);
  }

  function sameEpisodeSets(a, b) {
    if (a.length === 0 || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function titleSlugSet(entry, slugify) {
    const out = new Set();
    for (const t of [entry?.title, entry?.romajiTitle, entry?.englishTitle, entry?.nativeTitle]) {
      const s = slugify(t || "");
      if (s) out.add(s);
    }
    return out;
  }

  function realEpisodeCount(entry) {
    let count = 0;
    for (const ep of Array.isArray(entry?.episodes) ? entry.episodes : []) {
      if (ep && ep.durationSource !== "anilist") count++;
    }
    return count;
  }

  function isTrustedMediaMapEntry(entry, helpers = {}) {
    if (!entry || !Number(entry.mediaId)) return false;
    if (entry.source === "anilistImport") return true;
    const requiredVersion = Number(helpers.resolverVersion) || 0;
    return requiredVersion > 0 && Number(entry.resolverV || 0) >= requiredVersion;
  }

  // Conservative same-anime test for two slugs already sharing a base-group +
  // season/movie-number bucket. Requires one strong signal and no veto.
  function isSameAnime(slugA, entryA, slugB, entryB, ctx) {
    const { mediaMap, helpers, baseSlug } = ctx;

    const aMovie = helpers.isMovie(slugA, entryA);
    const bMovie = helpers.isMovie(slugB, entryB);
    if (aMovie !== bMovie) return false;

    // (A) AniList media identity is authoritative in both directions and beats
    // the siteAnimeId comparison — backfilled site ids can be contaminated when
    // a romaji slug happens to be a real an1me.to page of a DIFFERENT anime
    // (e.g. "devil-may-cry" = the 2007 series page, holding 2025 import data).
    const aMapEntry = mediaMap?.[slugA];
    const bMapEntry = mediaMap?.[slugB];
    const aMedia = isTrustedMediaMapEntry(aMapEntry, helpers) ? Number(aMapEntry.mediaId) || 0 : 0;
    const bMedia = isTrustedMediaMapEntry(bMapEntry, helpers) ? Number(bMapEntry.mediaId) || 0 : 0;
    if (aMedia && bMedia) return aMedia === bMedia;

    const normalizeType = globalThis.AnimeTrackerMediaType?.normalize || ((value) => String(value || "").toUpperCase() || null);
    const aType = normalizeType(helpers.getMediaType?.(slugA, entryA) || entryA?.mediaType);
    const bType = normalizeType(helpers.getMediaType?.(slugB, entryB) || entryB?.mediaType);
    if (aType && bType && aType !== bType) return false;
    const aSupplement = globalThis.AnimeTrackerMediaType?.isSupplement?.(aType) || false;
    const bSupplement = globalThis.AnimeTrackerMediaType?.isSupplement?.(bType) || false;

    // (B) shared title identity, or one's title slugifies to the other's slug
    const slugify = helpers.slugify;
    const aTitles = titleSlugSet(entryA, slugify);
    const bTitles = titleSlugSet(entryB, slugify);
    let titleMatch = aTitles.has(String(slugB).toLowerCase()) || bTitles.has(String(slugA).toLowerCase());
    if (!titleMatch) for (const t of aTitles) if (bTitles.has(t)) titleMatch = true;

    const aTotal = Number(entryA?.totalEpisodes) || 0;
    const bTotal = Number(entryB?.totalEpisodes) || 0;
    const totalsConflict = !!(aTotal && bTotal && aTotal !== bTotal);

    // (B') same as (B) but ignoring a trailing year ("devil-may-cry" vs
    // "devil-may-cry-2025"). Guarded by the totals veto so a remake with a
    // different episode count never merges into the original.
    if (!titleMatch && !totalsConflict) {
      const stripYear = (s) => String(s || "").replace(/-(?:19|20)\d{2}$/, "");
      const aStripped = new Set([...aTitles].map(stripYear));
      const bStripped = new Set([...bTitles].map(stripYear));
      if (aStripped.has(stripYear(String(slugB).toLowerCase())) || bStripped.has(stripYear(String(slugA).toLowerCase()))) {
        titleMatch = true;
      }
      if (!titleMatch) for (const t of aStripped) if (bStripped.has(t)) titleMatch = true;
    }

    // (C) identical watched-episode sets — meaningless where different shows can
    // legitimately share the bucket (chronology groups, movies) or when known
    // totals disagree.
    const setsEligible =
      !(helpers.isChronologyGroup && helpers.isChronologyGroup(baseSlug)) &&
      !aMovie &&
      !aSupplement &&
      !bSupplement &&
      !totalsConflict;
    const setsMatch = setsEligible && sameEpisodeSets(watchedEpisodeNumbers(entryA), watchedEpisodeNumbers(entryB));

    const aSite = Number(entryA?.siteAnimeId) || 0;
    const bSite = Number(entryB?.siteAnimeId) || 0;
    if (aSite && bSite && aSite !== bSite) {
      // Differing site ids normally veto — unless BOTH the title and the watched
      // episodes line up, which is the romaji-slug-collision contamination case.
      return titleMatch && setsMatch;
    }

    return titleMatch || setsMatch;
  }

  function findDuplicateGroups(animeData, mediaMap, helpers) {
    const buckets = new Map();
    for (const [slug, anime] of Object.entries(animeData || {})) {
      if (!anime || typeof anime !== "object") continue;
      const baseSlug = helpers.getBaseSlug(slug, anime);
      // an1me.to slugs often carry a site suffix ("jojo-...-tv") that the
      // AniList romaji slug lacks — bucket them together.
      const bucketBase = baseSlug.replace(/-(?:tv|ntr|sub|dub)$/i, "");
      const movie = helpers.isMovie(slug, anime);
      const key = `${bucketBase}|${movie ? "M" + helpers.getMovieNumber(slug) : "S" + helpers.getSeasonNumber(slug)}`;
      if (!buckets.has(key)) buckets.set(key, { baseSlug, slugs: [] });
      buckets.get(key).slugs.push(slug);
    }

    const groups = [];
    for (const { baseSlug, slugs } of buckets.values()) {
      if (slugs.length < 2) continue;

      const ctx = { mediaMap, helpers, baseSlug };
      const conservativeGroups = [];
      for (const slug of [...slugs].sort()) {
        const compatible = conservativeGroups.find((members) =>
          members.every((member) => isSameAnime(member, animeData[member], slug, animeData[slug], ctx)),
        );
        if (compatible) compatible.push(slug);
        else conservativeGroups.push([slug]);
      }

      // Duplicate deletion is destructive, so transitive similarity is not
      // enough: every member must match every other member in the group.
      for (const members of conservativeGroups) {
        if (members.length >= 2) groups.push(members.sort());
      }
    }
    return groups;
  }

  // Ordered preference; returns the winning slug of the pair.
  function chooseDuplicateWinner(slugA, entryA, slugB, entryB, { animeinfoBySlug = {} } = {}) {
    const liveInfo = (slug) => {
      const info = animeinfoBySlug[slug];
      return !!globalThis.AnimeTrackerCachePolicy?.isInfoAuthoritative?.(info);
    };
    const aLive = liveInfo(slugA);
    const bLive = liveInfo(slugB);
    if (aLive !== bLive) return aLive ? slugA : slugB;

    const aSite = Number(entryA?.siteAnimeId) || 0;
    const bSite = Number(entryB?.siteAnimeId) || 0;
    if (!!aSite !== !!bSite) return aSite ? slugA : slugB;

    const aReal = realEpisodeCount(entryA);
    const bReal = realEpisodeCount(entryB);
    if (aReal !== bReal) return aReal > bReal ? slugA : slugB;

    const aEps = Array.isArray(entryA?.episodes) ? entryA.episodes.length : 0;
    const bEps = Array.isArray(entryB?.episodes) ? entryB.episodes.length : 0;
    if (aEps !== bEps) return aEps > bEps ? slugA : slugB;

    const aTs = getActivityTimestamp(entryA);
    const bTs = getActivityTimestamp(entryB);
    if (aTs !== bTs) return aTs > bTs ? slugA : slugB;

    return slugA <= slugB ? slugA : slugB;
  }

  function mergeDuplicateEntries(winnerSlug, winnerEntry, loserEntry, mergeAnimeData) {
    const movedLoser = { ...loserEntry, slug: winnerSlug };
    const merged = mergeAnimeData({ [winnerSlug]: winnerEntry }, { [winnerSlug]: movedLoser })[winnerSlug];

    // mergeAnimeData spreads {...loser, ...winner} for metadata, so a winner's
    // explicit null clobbers a loser's value — backfill the useful nullish gaps.
    for (const key of ["englishTitle", "romajiTitle", "nativeTitle", "coverImage", "siteAnimeId", "nextEpisodeAt", "nextEpisodeTimezone"]) {
      if ((merged[key] === null || merged[key] === undefined) && loserEntry[key] != null) {
        merged[key] = loserEntry[key];
      }
    }
    return merged;
  }

  function buildDedupeTombstone(loserEntry, nowMs) {
    const sharedBuilder = globalThis.AnimeTrackerMergeUtils?.buildDeletedAnimeTombstone;
    if (typeof sharedBuilder === "function") return sharedBuilder(loserEntry, nowMs);
    const deletedAtMs = Math.max(Number(nowMs) || Date.now(), getActivityTimestamp(loserEntry) + TOMBSTONE_GRACE_MS + 1000);
    return { deletedAt: new Date(deletedAtMs).toISOString() };
  }

  // Applies every merge to the passed stores IN PLACE and reports what changed.
  // stores: { animeData, videoProgress, deletedAnime, groupCoverImages, mediaMap, pushed, animeinfoBySlug }
  function buildDedupePlan(stores, groups, helpers, { mergeAnimeData, mergeVideoProgress, mergeGroupCoverImages, nowMs } = {}) {
    const merge =
      mergeAnimeData ||
      (typeof globalThis !== "undefined" && globalThis.AnimeTrackerMergeUtils && globalThis.AnimeTrackerMergeUtils.mergeAnimeData);
    const mergeProgress = mergeVideoProgress || globalThis.AnimeTrackerMergeUtils?.mergeVideoProgress;
    const mergeCovers = mergeGroupCoverImages || globalThis.AnimeTrackerMergeUtils?.mergeGroupCoverImages;
    const result = { changed: false, mergedPairs: [], cacheKeysToRemove: [] };
    if (!merge) return result;

    const { animeData, videoProgress, deletedAnime, groupCoverImages, mediaMap, pushed, animeinfoBySlug } = stores;

    for (const group of groups) {
      const present = group.filter((s) => animeData[s]);
      if (present.length < 2) continue;

      let winner = present[0];
      for (let i = 1; i < present.length; i++) {
        winner = chooseDuplicateWinner(winner, animeData[winner], present[i], animeData[present[i]], { animeinfoBySlug });
      }

      for (const loser of present) {
        if (loser === winner) continue;
        const loserEntry = animeData[loser];

        animeData[winner] = mergeDuplicateEntries(winner, animeData[winner], loserEntry, merge);
        delete animeData[loser];

        const fromPrefix = `${loser}__episode-`;
        for (const key of Object.keys(videoProgress || {})) {
          if (!key.startsWith(fromPrefix)) continue;
          const newKey = `${winner}__episode-${key.slice(fromPrefix.length)}`;
          const incoming = videoProgress[key];
          const existing = videoProgress[newKey];
          if (!existing) {
            videoProgress[newKey] = incoming;
          } else if (typeof mergeProgress === "function") {
            videoProgress[newKey] = mergeProgress({ [newKey]: existing }, { [newKey]: incoming })[newKey];
          } else {
            const aTs = toMillis(existing.savedAt);
            const bTs = toMillis(incoming.savedAt);
            videoProgress[newKey] = bTs > aTs ? incoming : existing;
          }
          delete videoProgress[key];
        }

        if (mediaMap && mediaMap[loser]) {
          const incoming = mediaMap[loser];
          const existing = mediaMap[winner];
          const incomingTrusted = isTrustedMediaMapEntry(incoming, helpers);
          const existingTrusted = isTrustedMediaMapEntry(existing, helpers);
          if (
            !existing ||
            (incomingTrusted && !existingTrusted) ||
            (incomingTrusted === existingTrusted && (Number(incoming?.cachedAt) || 0) > (Number(existing?.cachedAt) || 0))
          ) {
            mediaMap[winner] = incoming;
          }
          delete mediaMap[loser];
        }

        if (pushed && pushed[loser]) {
          if (!pushed[winner]) pushed[winner] = pushed[loser];
          delete pushed[loser];
        }

        if (groupCoverImages && groupCoverImages[loser]) {
          if (!groupCoverImages[winner]) {
            groupCoverImages[winner] = groupCoverImages[loser];
          } else if (typeof mergeCovers === "function") {
            groupCoverImages[winner] = mergeCovers(
              { [winner]: groupCoverImages[winner] },
              { [winner]: groupCoverImages[loser] },
            )[winner];
          }
          delete groupCoverImages[loser];
        }

        if (deletedAnime) {
          delete deletedAnime[winner];
          deletedAnime[loser] = buildDedupeTombstone(loserEntry, nowMs);
        }

        result.cacheKeysToRemove.push(`animeinfo_${loser}`, `episodeTypes_${loser}`, `fillerslug_${loser}`);
        result.mergedPairs.push({ winner, loser });
        result.changed = true;
      }
    }

    return result;
  }

  const root = typeof globalThis !== "undefined" ? globalThis : self;
  const exports = {
    findDuplicateGroups,
    isSameAnime,
    chooseDuplicateWinner,
    mergeDuplicateEntries,
    buildDedupeTombstone,
    buildDedupePlan,
    isTrustedMediaMapEntry,
  };
  root.AnimeTrackerDedupeUtils = exports;

  if (typeof window !== "undefined") {
    const AT = (window.AnimeTracker = window.AnimeTracker || {});
    AT.DedupeUtils = exports;
  }
})();
