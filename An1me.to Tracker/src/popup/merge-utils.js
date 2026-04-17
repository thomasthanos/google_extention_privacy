/**
 * Anime Tracker - Popup Merge Utils Adapter
 *
 * Binds shared merge utilities from src/common/merge-utils.js into the
 * popup namespace expected by firebase-sync.js and progress-manager.js.
 */

(function () {
    'use strict';

    const shared = globalThis.AnimeTrackerMergeUtils;
    if (!shared) {
        console.error('[Popup-MergeUtils] Shared merge utils not loaded');
        return;
    }

    const AT = (window.AnimeTracker = window.AnimeTracker || {});
    AT.MergeUtils = shared;
})();

