/**
 * Anime Tracker - UI Helpers
 * Formatting, escaping, and icon utilities
 */

const UIHelpers = {
    /**
     * Simple logger - set DEBUG to true for verbose logging
     */
    DEBUG: false,
    Logger: {
        info: (msg, data) => { if (UIHelpers.DEBUG) console.log('[Anime Tracker]', msg, data !== undefined ? data : ''); },
        success: (msg, data) => { if (UIHelpers.DEBUG) console.log('[Anime Tracker] ✓', msg, data !== undefined ? data : ''); },
        error: (msg, data) => console.error('[Anime Tracker] ✗', msg, data !== undefined ? data : ''),
        warn: (msg, data) => { if (UIHelpers.DEBUG) console.warn('[Anime Tracker] ⚠', msg, data !== undefined ? data : ''); }
    },

    /**
     * Compute uniqueId from anime slug and episode number
     */
    getUniqueId(animeSlug, episodeNumber) {
        return `${animeSlug}__episode-${episodeNumber}`;
    },

    /**
     * Format duration from seconds to readable string
     */
    formatDuration(seconds) {
        if (!seconds || seconds === 0) return '0m';
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    },

    /**
     * Format duration for stats (shorter format)
     */
    formatDurationShort(seconds) {
        if (!seconds || seconds === 0) return '0h';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        // Convert to days if more than 72 hours
        if (hours >= 72) {
            const days = Math.floor(hours / 24);
            const remainingHours = hours % 24;
            if (remainingHours > 0) {
                return `${days}d ${remainingHours}h`;
            }
            return `${days}d`;
        }

        if (hours > 0) {
            return `${hours}h`;
        }
        return `${minutes}m`;
    },

    /**
     * Format date to relative or absolute string
     */
    formatDate(isoString) {
        if (!isoString) return '';
        
        const date = new Date(isoString);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        
        if (diffMinutes < 1) return 'Just now';
        if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
        if (diffHours < 24) return `${diffHours} hours ago`;
        if (diffDays < 7) return `${diffDays} days ago`;
        
        return date.toLocaleDateString('en-US', {
            day: 'numeric',
            month: 'short',
            year: diffDays > 365 ? 'numeric' : undefined
        });
    },

    /**
     * Get progress bar size class based on episode count
     */
    getProgressSizeClass(episodeCount, totalEpisodes) {
        const total = totalEpisodes || episodeCount;
        if (total >= 200) return 'size-huge';
        if (total >= 100) return 'size-large';
        if (total >= 50) return 'size-medium';
        return 'size-small';
    },

    /**
     * Escape HTML - handles XSS edge cases
     */
    escapeHtml(str) {
        if (typeof str !== 'string') {
            if (str === null || str === undefined) return '';
            str = String(str);
        }

        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/`/g, '&#x60;')
            .replace(/\//g, '&#x2F;');
    },

    /**
     * Create SVG icon
     */
    createIcon(name) {
        const icons = {
            episodes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>',
            time: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
            calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
            delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
            chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>'
        };
        return icons[name] || '';
    },

    /**
     * Count total episodes in anime data
     */
    countEpisodes(animeData) {
        if (!animeData) return 0;
        return Object.values(animeData).reduce((sum, anime) => sum + (anime.episodes?.length || 0), 0);
    }
};

// Export
window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.UIHelpers = UIHelpers;
window.AnimeTracker.Logger = UIHelpers.Logger;
