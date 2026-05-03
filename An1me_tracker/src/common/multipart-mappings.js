// Shared multi-part anime mappings — single source of truth across content
// scripts, popup, and background. Previously duplicated in three places.
//
// SLUG_NORMALIZATION: maps episode-list slugs (the URL form on an1me.to) to
// the canonical "merged" slug we store under, so a multi-part series like
// Bleach: Sennen Kessen-hen becomes one entry in the user's library instead
// of three separate ones.
//
// EPISODE_OFFSET_MAPPING: when a sub-slug's episode 1 is actually episode N+1
// of the merged series, this is N. Add 'foo-season-2': 13 here when season 2
// continues numbering from after season 1's episode 13.
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
