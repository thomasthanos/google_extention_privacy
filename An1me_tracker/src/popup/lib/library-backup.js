


(function () {
    'use strict';

    const BACKUP_FORMAT_VERSION = 1;

    function buildPayload(snapshot) {
        const version = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || null;
        return {
            version: BACKUP_FORMAT_VERSION,
            exportedAt: new Date().toISOString(),
            extensionVersion: version,
            animeData: snapshot?.animeData || {},
            videoProgress: snapshot?.videoProgress || {},
            deletedAnime: snapshot?.deletedAnime || {},
            groupCoverImages: snapshot?.groupCoverImages || {},
            goalSettings: snapshot?.goalSettings || null,
            badgeUnlocks: snapshot?.badgeUnlocks || {}
        };
    }

    function triggerDownload(payload, filenameOverride = null) {
        const json = JSON.stringify(payload, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/T.*/, '');
        const filename = filenameOverride || `an1me-tracker-backup-${stamp}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();

        setTimeout(() => { try { URL.revokeObjectURL(url); } catch {              } }, 1500);
    }

    function parseAndValidate(text) {
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new Error('Invalid JSON file');
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Backup file is malformed');
        }

        if (!parsed.animeData || typeof parsed.animeData !== 'object') {
            throw new Error('Backup is missing animeData');
        }
        return parsed;
    }


    function mergeImported(local, parsed) {
        const Merge = globalThis.AnimeTrackerMergeUtils;
        if (!Merge?.mergeAnimeData) throw new Error('Merge utils unavailable');
        const AT = (typeof window !== 'undefined' && window.AnimeTracker) || {};
        const ProgressManager = AT.ProgressManager;

        let mergedAnime = Merge.mergeAnimeData(local?.animeData || {}, parsed?.animeData || {});
        let mergedDeleted = Merge.mergeDeletedAnime(local?.deletedAnime || {}, parsed?.deletedAnime || {});
        mergedDeleted = Merge.pruneStaleDeletedAnime(mergedAnime, mergedDeleted);
        Merge.applyDeletedAnime(mergedAnime, mergedDeleted);

        const mergedProgress = Merge.mergeVideoProgress(local?.videoProgress || {}, parsed?.videoProgress || {});
        const mergedGroup = Merge.mergeGroupCoverImages(local?.groupCoverImages || {}, parsed?.groupCoverImages || {});
        const mergedGoals = Merge.mergeGoalSettings
            ? Merge.mergeGoalSettings(local?.goalSettings || null, parsed?.goalSettings || null)
            : (parsed?.goalSettings || local?.goalSettings || null);
        const mergedBadges = Merge.mergeBadgeUnlocks
            ? Merge.mergeBadgeUnlocks(local?.badgeUnlocks || {}, parsed?.badgeUnlocks || {})
            : { ...(local?.badgeUnlocks || {}), ...(parsed?.badgeUnlocks || {}) };


        if (ProgressManager?.removeDuplicateEpisodes) {
            mergedAnime = ProgressManager.removeDuplicateEpisodes(mergedAnime);
        }

        return {
            animeData: mergedAnime,
            videoProgress: mergedProgress,
            deletedAnime: mergedDeleted,
            groupCoverImages: mergedGroup,
            goalSettings: mergedGoals,
            badgeUnlocks: mergedBadges
        };
    }

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.LibraryBackup = {
        buildPayload,
        triggerDownload,
        parseAndValidate,
        mergeImported
    };
})();
