(function () {
    'use strict';

    // Metadata-repair status UI, anime-info/episode-types cache-change handlers, and the
    // "fetch all fillers" flow. Extracted from popup/main.js. State via AT.PopupState;
    // a few callbacks injected through _init(). AT services used directly.
    const AT = window.AnimeTracker;

    let elements, detectHasGoogleAuth, markInternalSave, scheduleDeferredListRefresh, sendRuntimeMessage, updateStats;
    // module-local state (only this module uses it)
    let metadataRepairPromise = null;
    let metadataRepairStatusResetTimer = null;

    function setMetadataRepairStatus(label, synced = false) {
        if (!elements.syncStatus || !elements.syncText) return;

        if (metadataRepairStatusResetTimer) {
            clearTimeout(metadataRepairStatusResetTimer);
            metadataRepairStatusResetTimer = null;
        }

        elements.syncStatus.classList.remove('synced', 'syncing');
        if (synced) {
            elements.syncStatus.classList.add('synced');
        } else {
            elements.syncStatus.classList.add('syncing');
        }
        elements.syncText.textContent = label;
    }

    function restoreDefaultSyncStatus() {
        if (!elements.syncStatus || !elements.syncText) return;

        if (metadataRepairStatusResetTimer) {
            clearTimeout(metadataRepairStatusResetTimer);
            metadataRepairStatusResetTimer = null;
        }

        const user = AT.FirebaseSync?.getUser?.();
        elements.syncStatus.classList.remove('syncing', 'synced');
        if (user) elements.syncStatus.classList.add('synced');
        elements.syncText.textContent = user ? 'Cloud Synced' : 'Local Only';
    }

    function scheduleDefaultSyncStatusRestore(delayMs = 2500) {
        if (metadataRepairStatusResetTimer) clearTimeout(metadataRepairStatusResetTimer);
        metadataRepairStatusResetTimer = setTimeout(() => {
            metadataRepairStatusResetTimer = null;
            restoreDefaultSyncStatus();
        }, delayMs);
    }

    function applyAnimeInfoCacheChange(storageKey, value) {
        const slug = storageKey.replace('animeinfo_', '');
        if (!slug) return;

        if (value) {
            AT.AnilistService.cache[slug] = value;
        } else {
            delete AT.AnilistService.cache[slug];
        }

        if (AT.PopupState.animeData?.[slug] && AT.StatusService.repairAiringCompleted(AT.PopupState.animeData, { slugs: [slug] })) {
            const payload = { animeData: AT.PopupState.animeData };
            markInternalSave(payload);
            AT.Storage.set(payload).catch((error) => {
                PopupLogger.warn('AnimeInfo', 'Failed to persist repaired completion state:', error);
            });
        }
    }

    function applyEpisodeTypesCacheChange(storageKey, value) {
        const slug = storageKey.replace('episodeTypes_', '');
        if (!slug) return;

        const { FillerService } = AT;
        if (value) {
            FillerService.episodeTypesCache[slug] = value;
            FillerService.updateFromEpisodeTypes(slug, value);
        } else {
            delete FillerService.episodeTypesCache[slug];
        }
    }

    async function applyMetadataRepairState(state, options = {}) {
        const {
            ensureOpen = false,
            autoOpenRunning = false
        } = options;

        const previousStatus = AT.PopupState.lastMetadataRepairState?.status || null;
        AT.PopupState.lastMetadataRepairState = state || null;
        const { FillerFetchUI } = AT;

        if (!state) {
            if (FillerFetchUI.state.isOpen) FillerFetchUI.applyBackgroundState(null);
            restoreDefaultSyncStatus();
            return null;
        }

        const shouldOpen = ensureOpen || (autoOpenRunning && state.status === 'running');
        if (shouldOpen && !FillerFetchUI.state.isOpen) {
            await FillerFetchUI.open();
        }
        if (FillerFetchUI.state.isOpen || shouldOpen) {
            FillerFetchUI.applyBackgroundState(state);
        }

        if (state.status === 'running') {
            const total = Number(state.total) || 0;
            const processed = Number(state.processed) || 0;
            const nextStep = total > 0 ? Math.min(total, processed + 1) : 0;
            setMetadataRepairStatus(
                total > 0
                    ? `Importing ${nextStep}/${total}...`
                    : 'Importing data...'
            );
            return state;
        }

        if (state.status === 'completed') {
            const label = state.failed > 0
                ? `Import Complete (${state.failed} failed)`
                : 'Import Complete';
            setMetadataRepairStatus(label, true);
            if (previousStatus !== 'completed') {
                scheduleDeferredListRefresh({ delayMs: 0 });
                await updateStats();
            }
            scheduleDefaultSyncStatusRestore();
            return state;
        }

        if (state.status === 'error') {
            if (elements.syncStatus && elements.syncText) {
                elements.syncStatus.classList.remove('syncing', 'synced');
                elements.syncText.textContent = 'Import Error';
            }
            return state;
        }

        return state;
    }

    async function syncMetadataRepairStateFromStorage(options = {}) {
        const { Storage } = AT;
        const result = await Storage.get(['metadataRepairState']);
        return applyMetadataRepairState(result.metadataRepairState || null, options);
    }

    async function maybePromptPostUpdateFetch() {
        const { Storage } = AT;
        try {
            const stored = await Storage.get([
                'postUpdateFetchTriggeredAt',
                'postUpdateFetchToVersion',
                'metadataRepairState'
            ]);

            if (stored.postUpdateFetchTriggeredAt) {

                await Storage.remove([
                    'postUpdateFetchTriggeredAt',
                    'postUpdateFetchFromVersion',
                    'postUpdateFetchToVersion'
                ]);
            }

            if (stored.metadataRepairState?.status === 'running') {
                await applyMetadataRepairState(stored.metadataRepairState, { autoOpenRunning: false });
            }
        } catch (e) {
            PopupLogger.warn('Init', 'Post-update silent sync failed:', e);
        }
    }

    async function fetchAllFillers(options = {}) {
        const {
            autoStart = true,
            forceInfoRefresh = false,
            forceFillerRefresh = false,
            autoMode = false
        } = options;

        const { FillerFetchUI } = AT;

        await FillerFetchUI.open({ autoMode });

        if (!autoStart) {
            return syncMetadataRepairStateFromStorage({ ensureOpen: true });
        }

        if (metadataRepairPromise) {
            return metadataRepairPromise;
        }

        metadataRepairPromise = (async () => {
            setMetadataRepairStatus('Importing data...');
            FillerFetchUI.showPendingStart('Starting import…');

            const response = await sendRuntimeMessage({
                type: 'START_LIBRARY_REPAIR',
                forceInfoRefresh,
                forceFillerRefresh,
                isMobile: !detectHasGoogleAuth()
            }, 30000);

            if (!response?.success) {
                throw new Error(response?.error || 'Failed to start import');
            }

            return applyMetadataRepairState(response.state || null, { ensureOpen: true });
        })().catch((error) => {
            PopupLogger.error('RepairAll', 'Error:', error);
            if (elements.syncStatus && elements.syncText) {
                elements.syncStatus.classList.remove('syncing');
                elements.syncText.textContent = 'Import Error';
            }
            throw error;
        }).finally(() => {
            metadataRepairPromise = null;
        });

        return metadataRepairPromise;
    }

    AT.MetadataRepair = {
        _init(d) {
            elements = d.elements;
            detectHasGoogleAuth = d.detectHasGoogleAuth;
            markInternalSave = d.markInternalSave;
            scheduleDeferredListRefresh = d.scheduleDeferredListRefresh;
            sendRuntimeMessage = d.sendRuntimeMessage;
            updateStats = d.updateStats;
        },
        setMetadataRepairStatus, restoreDefaultSyncStatus, scheduleDefaultSyncStatusRestore, applyAnimeInfoCacheChange, applyEpisodeTypesCacheChange, applyMetadataRepairState, syncMetadataRepairStateFromStorage, maybePromptPostUpdateFetch, fetchAllFillers
    };
})();
