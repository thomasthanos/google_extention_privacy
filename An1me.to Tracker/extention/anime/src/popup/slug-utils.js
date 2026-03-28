/**
 * Anime Tracker - Slug Utilities
 * Single source of truth for canonical slug resolution.
 */

const SlugUtils = {
    getCanonicalSlug(slug, title = '') {
        const safeSlug  = String(slug  || '').toLowerCase();
        const safeTitle = String(title || '').toLowerCase();
        const context   = `${safeSlug} ${safeTitle}`;

        // Jujutsu Kaisen
        if (safeSlug.startsWith('jujutsu-kaisen') || safeTitle.includes('jujutsu kaisen')) {
            if (/\b0\b|movie/.test(context))
                return 'jujutsu-kaisen-0';
            if (/season\s*3|part\s*3|culling\s*game|dead[-\s]*culling|shimetsu|kaiyuu/.test(context))
                return 'jujutsu-kaisen-season-3';
            if (/season\s*2|2nd\s*season|shibuya|kaigyoku|gyokusetsu/.test(context))
                return 'jujutsu-kaisen-season-2';
            return 'jujutsu-kaisen';
        }

        return slug;
    }
};

// Export
window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.SlugUtils = SlugUtils;
