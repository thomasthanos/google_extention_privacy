// anime-actions.js — per-anime actions: delete, mark completed/dropped/favorite/on-hold, clear all.
(function () {
  "use strict";

  const AT = window.AnimeTracker;
  const { showToast } = AT;

  const { inlineConfirm: showInlineConfirm } = AT.Dialogs;
  const { setManualListState, clearDeletedAnimeSlug } = AT.StatusService;
  const { syncWatchlistFromPopup } = AT.AddAnimeDialog;

  let elements, hideDialog, markInternalSave, renderAnimeList, updateStats;
  const _deletingSlugs = new Set();

  async function deleteProgress(slug, episodeNumber) {
    const uniqueId = `${slug}__episode-${episodeNumber}`;

    try {
      await AT.LibraryMutations.enqueue(`delete-progress:${uniqueId}`, async ({ commit, snapshot }) => {
        const result = snapshot;
        const storedProgress = result.videoProgress || {};
        const existing = storedProgress[uniqueId];
        if (!existing) return;

        const currentVideoProgress = { ...storedProgress };
        const GRACE_MS = 5000;
        const savedAt = existing.savedAt ? new Date(existing.savedAt).getTime() : Date.now();
        const deletedAt = new Date(Math.max(Date.now(), savedAt + GRACE_MS + 1)).toISOString();

        currentVideoProgress[uniqueId] = {
          ...existing,
          deleted: true,
          deletedAt,
        };
        const dataToSave = { videoProgress: currentVideoProgress };
        await commit(dataToSave, { markInternalSave, immediate: true });

        AT.PopupState.videoProgress = currentVideoProgress;
        renderAnimeList(elements.searchInput?.value || "");
      });
    } catch (e) {
      PopupLogger.error("Delete", "Error:", e);
      showToast("Failed to delete progress. Please try again.", "error");
    }
  }

  async function deleteAnime(slug) {
    if (_deletingSlugs.has(slug)) return;
    _deletingSlugs.add(slug);

    try {
      const animeTitle = AT.PopupState.animeData[slug]?.title || slug;
      const ok = await showInlineConfirm({
        title: "Delete this anime?",
        body: `“${animeTitle}” will be removed from your library across all devices.`,
        confirmLabel: "Delete",
        cancelLabel: "Keep",
      });
      if (!ok) return;

      const mutation = await AT.LibraryMutations.enqueue(`delete-anime:${slug}`, async ({ commit, snapshot }) => {
        const result = snapshot;
        const storedAnimeData = result.animeData && typeof result.animeData === "object" ? result.animeData : AT.PopupState.animeData || {};
        const deletedEntry = storedAnimeData[slug] || null;
        const nextAnimeData = { ...storedAnimeData };
        if (deletedEntry) delete nextAnimeData[slug];

        const currentVideoProgress = { ...(result.videoProgress || {}) };
        let progressDeleted = 0;
        const progressPrefix = slug + "__episode-";
        for (const id of Object.keys(currentVideoProgress)) {
          if (id.startsWith(progressPrefix)) {
            delete currentVideoProgress[id];
            progressDeleted++;
          }
        }

        if (progressDeleted === 0 && !deletedEntry) {
          PopupLogger.warn("Delete", "No data found to delete for:", slug);
          return { changed: false };
        }

        const deletedAnime = clearDeletedAnimeSlug(result.deletedAnime || {}, slug);
        deletedAnime[slug] = AT.MergeUtils?.buildDeletedAnimeTombstone?.(deletedEntry) || { deletedAt: new Date().toISOString() };
        const dataToSave = { animeData: nextAnimeData, videoProgress: currentVideoProgress, deletedAnime };
        await commit(dataToSave, { markInternalSave, immediate: true });

        AT.PopupState.animeData = nextAnimeData;
        AT.PopupState.videoProgress = currentVideoProgress;
        return { changed: true, siteAnimeId: deletedEntry?.siteAnimeId || null };
      });

      if (!mutation?.changed) return;
      if (mutation.siteAnimeId) {
        chrome.runtime.sendMessage({ type: "WATCHLIST_SYNC", animeId: mutation.siteAnimeId, watchlistType: "remove" }, () => {
          if (chrome.runtime.lastError) {
          }
        });
      }

      renderAnimeList(elements.searchInput?.value || "");
      updateStats();
      try {
        AT.UIHelpers?.showToast?.("Anime deleted", { type: "success" });
      } catch {}
    } catch (e) {
      PopupLogger.error("Delete", "Error:", e);
      try {
        AT.UIHelpers?.showToast?.("Failed to delete anime", { type: "error", duration: 3500 });
      } catch {
        showToast("Failed to delete anime. Please try again.", "error");
      }
    } finally {
      _deletingSlugs.delete(slug);
    }
  }

  async function toggleListState(slug, targetState, logLabel) {
    if (!AT.PopupState.animeData[slug]) return;

    try {
      const mutation = await AT.LibraryMutations.enqueue(`${targetState}:${slug}`, async ({ commit, snapshot }) => {
        const result = snapshot;
        const storedAnimeData = result.animeData && typeof result.animeData === "object" ? result.animeData : AT.PopupState.animeData || {};
        const currentEntry = storedAnimeData[slug];
        if (!currentEntry) return { changed: false };

        const resolvedState = globalThis.AnimeTrackerEntryState?.getResolvedListState?.(currentEntry) || currentEntry.listState || "active";
        const wasTarget = resolvedState === targetState;
        const nextEntry = { ...currentEntry };
        setManualListState(nextEntry, wasTarget ? "active" : targetState, new Date().toISOString(), targetState === "completed" && !wasTarget);

        const nextAnimeData = { ...storedAnimeData, [slug]: nextEntry };
        const currentVideoProgress = result.videoProgress || {};
        const deletedAnime = clearDeletedAnimeSlug(result.deletedAnime || {}, slug);
        await commit(
          { animeData: nextAnimeData, videoProgress: currentVideoProgress, deletedAnime },
          { markInternalSave, immediate: true },
        );

        AT.PopupState.animeData = nextAnimeData;
        AT.PopupState.videoProgress = currentVideoProgress;
        return { changed: true, wasTarget };
      });

      if (!mutation?.changed) return;
      syncWatchlistFromPopup(slug, mutation.wasTarget ? "watching" : targetState);
      renderAnimeList(elements.searchInput?.value || "");
      updateStats();
    } catch (e) {
      PopupLogger.error(logLabel, "Error:", e);
    }
  }

  async function toggleAnimeCompleted(slug) {
    return toggleListState(slug, "completed", "Complete");
  }

  async function toggleAnimeDropped(slug) {
    return toggleListState(slug, "dropped", "Drop");
  }

  async function toggleAnimeFavorite(slug) {
    if (!AT.PopupState.animeData[slug]) return;

    try {
      const mutation = await AT.LibraryMutations.enqueue(`favorite:${slug}`, async ({ commit, snapshot }) => {
        const result = snapshot;
        const storedAnimeData = result.animeData && typeof result.animeData === "object" ? result.animeData : AT.PopupState.animeData || {};
        const currentEntry = storedAnimeData[slug];
        if (!currentEntry) return { changed: false };

        const now = new Date().toISOString();
        const wasFavorite = currentEntry.favorite === true;
        const nextEntry = {
          ...currentEntry,
          favorite: !wasFavorite,
          favoritedAt: wasFavorite ? null : now,
          favoriteUpdatedAt: now,
        };
        const nextAnimeData = { ...storedAnimeData, [slug]: nextEntry };
        await commit({ animeData: nextAnimeData }, { markInternalSave, immediate: true });

        AT.PopupState.animeData = nextAnimeData;
        return { changed: true, wasFavorite };
      });

      if (!mutation?.changed) return;

      renderAnimeList(elements.searchInput?.value || "");
      try {
        AT.UIHelpers?.showToast?.(mutation.wasFavorite ? "Removed from favorites" : "Added to favorites", {
          type: "success",
          duration: 1400,
        });
      } catch {}
    } catch (e) {
      PopupLogger.error("Favorite", "Error:", e);
    }
  }

  async function toggleAnimeOnHold(slug) {
    return toggleListState(slug, "on_hold", "OnHold");
  }

  async function clearAllData() {
    try {
      await AT.LibraryMutations.enqueue("clear-library-progress", async ({ commit, snapshot }) => {
        const result = snapshot;
        const storedAnimeData = result.animeData && typeof result.animeData === "object" ? result.animeData : AT.PopupState.animeData || {};
        const deletedAnime = { ...(result.deletedAnime || {}) };

        // Empty maps alone would be merged with the existing cloud library and
        // resurrect every entry. Per-entry tombstones make this a real delete.
        for (const [slug, entry] of Object.entries(storedAnimeData)) {
          deletedAnime[slug] = AT.MergeUtils?.buildDeletedAnimeTombstone?.(entry) || { deletedAt: new Date().toISOString() };
        }

        await commit(
          { animeData: {}, videoProgress: {}, groupCoverImages: {}, deletedAnime },
          { markInternalSave, immediate: true },
        );
        AT.PopupState.animeData = {};
        AT.PopupState.videoProgress = {};
      });

      renderAnimeList();
      updateStats();
      hideDialog();
    } catch (error) {
      PopupLogger.error("ClearAll", "Error:", error);
      showToast("Failed to clear library. Please try again.", "error");
    }
  }

  AT.AnimeActions = {
    _init(d) {
      elements = d.elements;
      hideDialog = d.hideDialog;
      markInternalSave = d.markInternalSave;
      renderAnimeList = d.renderAnimeList;
      updateStats = d.updateStats;
    },
    deleteProgress,
    deleteAnime,
    toggleAnimeCompleted,
    toggleAnimeDropped,
    toggleAnimeFavorite,
    toggleAnimeOnHold,
    clearAllData,
  };
})();
