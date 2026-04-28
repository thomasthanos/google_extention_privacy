// Re-exposes the shared merge utils (loaded by src/common/merge-utils.js into
// globalThis.AnimeTrackerMergeUtils) on the content-script namespace so callers
// can do `window.AnimeTrackerContent.MergeUtils.foo(...)`. Tiny shim by design.
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

