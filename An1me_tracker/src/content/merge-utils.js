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

