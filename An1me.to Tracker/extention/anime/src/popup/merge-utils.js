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

