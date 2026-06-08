(function () {
    'use strict';

    // Anime action handlers (delete progress/anime, toggle completed/dropped/favorite/on-hold,
    // clear all). Extracted from popup/main.js. State via AT.PopupState; a few callbacks via _init.
    const AT = window.AnimeTracker;

    const { inlineConfirm: showInlineConfirm } = AT.Dialogs;
    const { setManualListState, clearDeletedAnimeSlug } = AT.StatusService;
    const { syncWatchlistFromPopup } = AT.AddAnimeDialog;

    let elements, hideDialog, markInternalSave, renderAnimeList, updateStats;
    const _deletingSlugs = new Set();

    async function deleteProgress(slug, episodeNumber) {
        const { Storage, FirebaseSync } = AT;
        const uniqueId = `${slug}__episode-${episodeNumber}`;

        try {
            const result = await Storage.get(['videoProgress']);
            const currentVideoProgress = result.videoProgress || {};

            if (currentVideoProgress[uniqueId]) {
                const GRACE_MS = 5000;
                const savedAt = currentVideoProgress[uniqueId].savedAt
                    ? new Date(currentVideoProgress[uniqueId].savedAt).getTime()
                    : Date.now();
                const deletedAt = new Date(Math.max(Date.now(), savedAt + GRACE_MS + 1)).toISOString();

                currentVideoProgress[uniqueId] = {
                    ...currentVideoProgress[uniqueId],
                    deleted: true,
                    deletedAt
                };
                AT.PopupState.videoProgress = currentVideoProgress;
                const dataToSave = { videoProgress: currentVideoProgress };
                const user = FirebaseSync.getUser();
                if (user) dataToSave.userId = user.uid;
                markInternalSave(dataToSave);
                await Storage.set(dataToSave);

                if (user) {
                    try {
                        const gcResult = await Storage.get(['groupCoverImages']);
                        await FirebaseSync.saveToCloud({
                            animeData: AT.PopupState.animeData, videoProgress: currentVideoProgress,
                            groupCoverImages: gcResult.groupCoverImages || {}
                        }, true);
                    } catch (syncErr) {
                        PopupLogger.error('Delete', 'Cloud sync failed:', syncErr);
                    }
                }

                renderAnimeList(elements.searchInput?.value || '');
            }
        } catch (e) {
            PopupLogger.error('Delete', 'Error:', e);
            showToast('Failed to delete progress. Please try again.', 'error');
        }
    }

    async function deleteAnime(slug) {
        const { Storage, FirebaseSync } = AT;
        if (_deletingSlugs.has(slug)) return;

        const animeTitle = AT.PopupState.animeData[slug]?.title || slug;
        const ok = await showInlineConfirm({
            title: 'Delete this anime?',
            body: `“${animeTitle}” will be removed from your library across all devices.`,
            confirmLabel: 'Delete',
            cancelLabel: 'Keep'
        });
        if (!ok) return;
        _deletingSlugs.add(slug);
        const wasInAnimeData = !!AT.PopupState.animeData[slug];
        const siteAnimeId = AT.PopupState.animeData[slug]?.siteAnimeId;
        if (wasInAnimeData) delete AT.PopupState.animeData[slug];

        try {
            const result = await Storage.get(['videoProgress', 'deletedAnime', 'groupCoverImages']);
            const currentVideoProgress = result.videoProgress || {};
            let progressDeleted = 0;
            const progressPrefix = slug + '__episode-';
            for (const id of Object.keys(currentVideoProgress)) {
                if (id.startsWith(progressPrefix)) { delete currentVideoProgress[id]; progressDeleted++; }
            }

            if (progressDeleted === 0 && !wasInAnimeData) {
                PopupLogger.warn('Delete', 'No data found to delete for:', slug);
                return;
            }

            AT.PopupState.videoProgress = currentVideoProgress;
            const deletedAnime = clearDeletedAnimeSlug(result.deletedAnime || {}, slug);
            deletedAnime[slug] = { deletedAt: new Date().toISOString() };

            const dataToSave = { animeData: AT.PopupState.animeData, videoProgress: currentVideoProgress, deletedAnime };
            const user = FirebaseSync.getUser();
            if (user) dataToSave.userId = user.uid;
            markInternalSave(dataToSave);
            await Storage.set(dataToSave);

            if (user) {
                try {
                    const gcResult = await Storage.get(['groupCoverImages']);
                    await FirebaseSync.saveToCloud({
                        animeData: AT.PopupState.animeData, videoProgress: currentVideoProgress, deletedAnime,
                        groupCoverImages: gcResult.groupCoverImages || {}
                    }, true);
                } catch (syncErr) {
                    PopupLogger.error('Delete', 'Cloud sync failed:', syncErr);
                }
            }

            if (siteAnimeId) {
                chrome.runtime.sendMessage(
                    { type: 'WATCHLIST_SYNC', animeId: siteAnimeId, watchlistType: 'remove' },
                    () => { if (chrome.runtime.lastError) {              } }
                );
            }

            renderAnimeList(elements.searchInput?.value || '');
            updateStats();
            try { AT.UIHelpers?.showToast?.('Anime deleted', { type: 'success' }); } catch {}
        } catch (e) {
            PopupLogger.error('Delete', 'Error:', e);
            try { AT.UIHelpers?.showToast?.('Failed to delete anime', { type: 'error', duration: 3500 }); }
            catch { showToast('Failed to delete anime. Please try again.', 'error'); }
        } finally {
            _deletingSlugs.delete(slug);
        }
    }

    async function toggleAnimeCompleted(slug) {
        const { Storage, FirebaseSync } = AT;
        if (!AT.PopupState.animeData[slug]) return;

        try {
            const now = new Date().toISOString();
            const wasCompleted = !!AT.PopupState.animeData[slug].completedAt;
            if (wasCompleted) {
                setManualListState(AT.PopupState.animeData[slug], 'active', now);
            } else {
                setManualListState(AT.PopupState.animeData[slug], 'completed', now, true);
            }

            const result = await Storage.get(['videoProgress', 'deletedAnime', 'groupCoverImages']);
            const currentVideoProgress = result.videoProgress || {};
            const deletedAnime = clearDeletedAnimeSlug(result.deletedAnime || {}, slug);

            const dataToSave = { animeData: AT.PopupState.animeData, videoProgress: currentVideoProgress, deletedAnime };
            const user = FirebaseSync.getUser();
            if (user) dataToSave.userId = user.uid;
            markInternalSave(dataToSave);
            await Storage.set(dataToSave);

            if (user) {
                try {
                    await FirebaseSync.saveToCloud({
                        animeData: AT.PopupState.animeData, videoProgress: currentVideoProgress, deletedAnime,
                        groupCoverImages: result.groupCoverImages || {}
                    }, true);
                } catch (syncErr) {
                    PopupLogger.error('Complete', 'Cloud sync failed:', syncErr);
                }
            }

            syncWatchlistFromPopup(slug, wasCompleted ? 'watching' : 'completed');

            renderAnimeList(elements.searchInput?.value || '');
            updateStats();
        } catch (e) {
            PopupLogger.error('Complete', 'Error:', e);
        }
    }

    async function toggleAnimeDropped(slug) {
        const { Storage, FirebaseSync } = AT;
        if (!AT.PopupState.animeData[slug]) return;

        try {
            const now = new Date().toISOString();
            const wasDropped = !!AT.PopupState.animeData[slug].droppedAt;
            if (wasDropped) {
                setManualListState(AT.PopupState.animeData[slug], 'active', now);
            } else {
                setManualListState(AT.PopupState.animeData[slug], 'dropped', now);
            }

            const result = await Storage.get(['videoProgress', 'deletedAnime', 'groupCoverImages']);
            const currentVideoProgress = result.videoProgress || {};
            const deletedAnime = clearDeletedAnimeSlug(result.deletedAnime || {}, slug);

            const dataToSave = { animeData: AT.PopupState.animeData, videoProgress: currentVideoProgress, deletedAnime };
            const user = FirebaseSync.getUser();
            if (user) dataToSave.userId = user.uid;
            markInternalSave(dataToSave);
            await Storage.set(dataToSave);

            if (user) {
                try {
                    await FirebaseSync.saveToCloud({
                        animeData: AT.PopupState.animeData, videoProgress: currentVideoProgress, deletedAnime,
                        groupCoverImages: result.groupCoverImages || {}
                    }, true);
                } catch (syncErr) {
                    PopupLogger.error('Drop', 'Cloud sync failed:', syncErr);
                }
            }

            syncWatchlistFromPopup(slug, wasDropped ? 'watching' : 'dropped');

            renderAnimeList(elements.searchInput?.value || '');
            updateStats();
        } catch (e) {
            PopupLogger.error('Drop', 'Error:', e);
        }
    }

    async function toggleAnimeFavorite(slug) {
        const { Storage, FirebaseSync } = AT;
        if (!AT.PopupState.animeData[slug]) return;

        try {
            const now = new Date().toISOString();
            const wasFavorite = !!AT.PopupState.animeData[slug].favorite;
            if (wasFavorite) {
                AT.PopupState.animeData[slug].favorite = false;
                AT.PopupState.animeData[slug].favoritedAt = null;
            } else {
                AT.PopupState.animeData[slug].favorite = true;
                AT.PopupState.animeData[slug].favoritedAt = now;
            }
            AT.PopupState.animeData[slug].favoriteUpdatedAt = now;

            const dataToSave = { animeData: AT.PopupState.animeData };
            const user = FirebaseSync.getUser();
            if (user) dataToSave.userId = user.uid;
            markInternalSave(dataToSave);
            await Storage.set(dataToSave);

            if (user) {
                try {
                    await FirebaseSync.saveToCloud({ animeData: AT.PopupState.animeData }, true);
                } catch (syncErr) {
                    PopupLogger.error('Favorite', 'Cloud sync failed:', syncErr);
                }
            }

            renderAnimeList(elements.searchInput?.value || '');
            try { AT.UIHelpers?.showToast?.(wasFavorite ? 'Removed from favorites' : 'Added to favorites', { type: 'success', duration: 1400 }); } catch {}
        } catch (e) {
            PopupLogger.error('Favorite', 'Error:', e);
        }
    }

    async function toggleAnimeOnHold(slug) {
        const { Storage, FirebaseSync } = AT;
        if (!AT.PopupState.animeData[slug]) return;

        try {
            const now = new Date().toISOString();
            const wasOnHold = !!AT.PopupState.animeData[slug].onHoldAt;
            if (wasOnHold) {
                setManualListState(AT.PopupState.animeData[slug], 'active', now);
            } else {
                setManualListState(AT.PopupState.animeData[slug], 'on_hold', now);
            }

            const result = await Storage.get(['videoProgress', 'deletedAnime', 'groupCoverImages']);
            const currentVideoProgress = result.videoProgress || {};
            const deletedAnime = clearDeletedAnimeSlug(result.deletedAnime || {}, slug);

            const dataToSave = { animeData: AT.PopupState.animeData, videoProgress: currentVideoProgress, deletedAnime };
            const user = FirebaseSync.getUser();
            if (user) dataToSave.userId = user.uid;
            markInternalSave(dataToSave);
            await Storage.set(dataToSave);

            if (user) {
                try {
                    await FirebaseSync.saveToCloud({
                        animeData: AT.PopupState.animeData, videoProgress: currentVideoProgress, deletedAnime,
                        groupCoverImages: result.groupCoverImages || {}
                    }, true);
                } catch (syncErr) {
                    PopupLogger.error('OnHold', 'Cloud sync failed:', syncErr);
                }
            }

            syncWatchlistFromPopup(slug, wasOnHold ? 'watching' : 'on_hold');

            renderAnimeList(elements.searchInput?.value || '');
            updateStats();
        } catch (e) {
            PopupLogger.error('OnHold', 'Error:', e);
        }
    }

    async function clearAllData() {
        const { Storage, FirebaseSync } = AT;
        const dataToSave = { animeData: {}, videoProgress: {}, groupCoverImages: {}, deletedAnime: {} };
        const user = FirebaseSync.getUser();
        if (user) dataToSave.userId = user.uid;
        markInternalSave(dataToSave);
        await Storage.set(dataToSave);
        if (user) {
            try {
                await FirebaseSync.saveToCloud({
                    animeData: {},
                    videoProgress: {},
                    groupCoverImages: {},
                    deletedAnime: {}
                }, true);
            } catch (syncErr) {
                PopupLogger.error('ClearAll', 'Cloud sync failed:', syncErr);
            }
        }
        AT.PopupState.animeData = {};
        AT.PopupState.videoProgress = {};
        renderAnimeList();
        updateStats();
        hideDialog();
    }

    AT.AnimeActions = {
        _init(d) {
            elements = d.elements;
            hideDialog = d.hideDialog;
            markInternalSave = d.markInternalSave;
            renderAnimeList = d.renderAnimeList;
            updateStats = d.updateStats;
        },
        deleteProgress, deleteAnime, toggleAnimeCompleted, toggleAnimeDropped,
        toggleAnimeFavorite, toggleAnimeOnHold, clearAllData
    };
})();
