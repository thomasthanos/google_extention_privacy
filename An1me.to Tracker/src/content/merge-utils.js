/**
 * Anime Tracker - Content Merge Utils Adapter
 *
 * Binds shared merge utilities from src/common/merge-utils.js into the
 * content-script namespace expected by cloud-sync.js.
 */

(function () {
    'use strict';

    const shared = globalThis.AnimeTrackerMergeUtils;
    if (!shared) {
        console.error('[CS-MergeUtils] Shared merge utils not loaded');
        return;
    }

    const ATC = (window.AnimeTrackerContent = window.AnimeTrackerContent || {});
    ATC.MergeUtils = shared;
})();

