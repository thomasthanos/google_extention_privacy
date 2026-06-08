


(function () {
    'use strict';

    const SLUG_NORMALIZATION = {
        'bleach-sennen-kessen-hen-ketsubetsu-tan': 'bleach-sennen-kessen-hen',
        'bleach-sennen-kessen-hen-soukoku-tan': 'bleach-sennen-kessen-hen',
        'fate-zero-season-2': 'fate-zero',
        'fate-zero-2nd-season': 'fate-zero',
    };

    const EPISODE_OFFSET_MAPPING = {
        'bleach-sennen-kessen-hen-ketsubetsu-tan': 13,
        'bleach-sennen-kessen-hen-soukoku-tan': 26,
        'fate-zero-season-2': 13,
        'fate-zero-2nd-season': 13,
    };

    const exports = { SLUG_NORMALIZATION, EPISODE_OFFSET_MAPPING };

    if (typeof self !== 'undefined') self.AnimeTrackerMultipartMappings = exports;
    if (typeof window !== 'undefined') window.AnimeTrackerMultipartMappings = exports;
})();
