(function (root) {
  "use strict";

  function toMillis(value) {
    const timestamp = value ? new Date(value).getTime() : 0;
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function getResolvedListState(entry) {
    if (!entry) return "active";
    const rawState = String(entry.listState || "").toLowerCase();
    const explicitState = ["active", "completed", "dropped", "on_hold"].includes(rawState) ? rawState : null;
    const explicitAt = toMillis(entry.listStateUpdatedAt);
    const candidates = [
      { state: "completed", timestamp: toMillis(entry.completedAt), priority: 1 },
      { state: "dropped", timestamp: toMillis(entry.droppedAt), priority: 2 },
      { state: "on_hold", timestamp: toMillis(entry.onHoldAt), priority: 3 },
    ];
    if (explicitState) candidates.push({ state: explicitState, timestamp: explicitAt, priority: 4 });
    const timestamped = candidates.filter((candidate) => candidate.timestamp > 0);
    if (timestamped.length > 0) {
      timestamped.sort((left, right) => right.timestamp - left.timestamp || right.priority - left.priority);
      return timestamped[0].state;
    }
    if (explicitState) return explicitState;
    if (entry.onHoldAt) return "on_hold";
    if (entry.droppedAt) return "dropped";
    if (entry.completedAt) return "completed";
    return "active";
  }

  function getResolvedListStateTimestamp(entry) {
    if (!entry) return 0;
    return Math.max(
      toMillis(entry.listStateUpdatedAt),
      toMillis(entry.completedAt),
      toMillis(entry.droppedAt),
      toMillis(entry.onHoldAt),
    );
  }

  function normalizeListStateMarkers(entry) {
    if (!entry) return false;
    const rawState = String(entry.listState || "").toLowerCase();
    const hasState =
      ["active", "completed", "dropped", "on_hold"].includes(rawState) ||
      !!entry.completedAt ||
      !!entry.droppedAt ||
      !!entry.onHoldAt;
    if (!hasState) return false;
    const state = getResolvedListState(entry);
    const before = JSON.stringify({
      listState: entry.listState,
      listStateUpdatedAt: entry.listStateUpdatedAt,
      completedAt: entry.completedAt,
      droppedAt: entry.droppedAt,
      onHoldAt: entry.onHoldAt,
      completionSource: entry.completionSource,
      manualComplete: entry.manualComplete,
    });
    const timestamps = {
      completed: entry.completedAt,
      dropped: entry.droppedAt,
      on_hold: entry.onHoldAt,
      active: entry.listStateUpdatedAt,
    };
    entry.listState = state;
    entry.listStateUpdatedAt =
      timestamps[state] && toMillis(timestamps[state]) >= toMillis(entry.listStateUpdatedAt)
        ? timestamps[state]
        : entry.listStateUpdatedAt || timestamps[state] || null;
    if (state !== "completed") {
      delete entry.completedAt;
      delete entry.completionSource;
      delete entry.manualComplete;
    }
    if (state !== "dropped") delete entry.droppedAt;
    if (state !== "on_hold") delete entry.onHoldAt;
    const after = JSON.stringify({
      listState: entry.listState,
      listStateUpdatedAt: entry.listStateUpdatedAt,
      completedAt: entry.completedAt,
      droppedAt: entry.droppedAt,
      onHoldAt: entry.onHoldAt,
      completionSource: entry.completionSource,
      manualComplete: entry.manualComplete,
    });
    return before !== after;
  }

  function setListState(entry, state, at, completionSource = null) {
    if (!entry) return;
    entry.listState = state;
    entry.listStateUpdatedAt = at;
    if (state === "completed") {
      entry.completedAt = entry.completedAt || at;
      if (completionSource) entry.completionSource = completionSource;
      delete entry.droppedAt;
      delete entry.onHoldAt;
      return;
    }
    if (state === "active") {
      delete entry.completedAt;
      delete entry.completionSource;
      delete entry.droppedAt;
      delete entry.onHoldAt;
    }
  }

  function resumeInactiveState(entry, at) {
    if (!entry) return false;
    const state = getResolvedListState(entry);
    if (state !== "on_hold" && state !== "dropped") return false;
    setListState(entry, "active", at);
    return true;
  }

  function getEpisodeProgress(entry, total = 0) {
    const numbers = new Set();
    let highest = 0;
    for (const episode of Array.isArray(entry?.episodes) ? entry.episodes : []) {
      const number = Number(episode?.number) || 0;
      if (!Number.isInteger(number) || number <= 0) continue;
      numbers.add(number);
      if (number > highest) highest = number;
    }
    const covered = total > 0 ? Array.from(numbers).filter((number) => number <= total).length : numbers.size;
    return { watched: numbers.size, covered, highest };
  }

  function getAutoCompletionSource(entry, info = {}) {
    if (!entry) return null;
    const total = Number(info.totalEpisodes) || Number(entry.totalEpisodes) || 0;
    const progress = getEpisodeProgress(entry, total);
    if (progress.watched <= 0) return null;
    const infoMediaType = root.AnimeTrackerMediaType?.normalize(info.mediaType) || null;
    const mediaType = infoMediaType || root.AnimeTrackerMediaType?.resolve(info.animeSlug || entry.slug, entry) || null;
    if (["MOVIE", "MUSIC"].includes(mediaType)) return "one-shot";
    const releaseStatus = String(info.releaseStatus || info.status || entry.releaseStatus || "").toUpperCase();
    if (releaseStatus !== "FINISHED" || total <= 0) return null;
    return progress.highest >= total ? "site-final" : null;
  }

  function reconcileCompletionState(entry, info, at) {
    if (!entry || entry.manualComplete === true) return false;
    const releaseStatus = String(info?.releaseStatus || info?.status || entry.releaseStatus || "").toUpperCase();
    const completionSource = getAutoCompletionSource(entry, info);
    const isCompleted = entry.listState === "completed" || !!entry.completedAt;

    if (completionSource && !isCompleted) {
      setListState(entry, "completed", at, completionSource);
      return true;
    }
    const reversibleSources = new Set(["site-final", "canon-auto", "one-shot", "auto"]);
    if (!completionSource && isCompleted && releaseStatus === "RELEASING" && reversibleSources.has(entry.completionSource)) {
      setListState(entry, "active", at);
      return true;
    }
    return false;
  }

  root.AnimeTrackerEntryState = {
    setListState,
    resumeInactiveState,
    getResolvedListState,
    getResolvedListStateTimestamp,
    normalizeListStateMarkers,
    getEpisodeProgress,
    getAutoCompletionSource,
    reconcileCompletionState,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
