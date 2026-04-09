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
        const diffSeconds = Math.floor(diffMs / 1000);
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

        // Compare at midnight level to avoid flickering between N and N+1 days on refresh
        const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const diffDays = Math.round((todayMidnight - dateMidnight) / (1000 * 60 * 60 * 24));
        
        if (diffSeconds < 60) return `${Math.max(1, diffSeconds)}S ago`;
        if (diffMinutes < 60) return `${diffMinutes}M ago`;
        if (diffHours < 24) return `${diffHours}H ago`;
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        
        return date.toLocaleDateString('en-US', {
            day: 'numeric',
            month: 'short',
            year: diffDays > 365 ? 'numeric' : undefined
        });
    },

    /**
     * Format date as short absolute: "10 Mar 25" or "10 Mar 2025" if different year
     */
    formatShortDate(isoString) {
        if (!isoString) return '';
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return '';
        const now = new Date();
        const sameYear = date.getFullYear() === now.getFullYear();
        const day = date.getDate();
        const month = date.toLocaleDateString('en-US', { month: 'short' });
        const year = sameYear ? '' : ` ${String(date.getFullYear()).slice(2)}`;
        return `${day} ${month}${year}`;
    },

    /**
     * Get the earliest watchedAt date from anime episodes
     */
    getStartedDate(anime) {
        if (!anime?.episodes || anime.episodes.length === 0) return null;
        let earliest = null;
        for (const ep of anime.episodes) {
            if (!ep.watchedAt) continue;
            const t = new Date(ep.watchedAt).getTime();
            if (!isNaN(t) && (earliest === null || t < earliest)) {
                earliest = t;
            }
        }
        return earliest ? new Date(earliest).toISOString() : null;
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
    _ESCAPE_MAP: { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '`': '&#x60;', '/': '&#x2F;' },
    _ESCAPE_RE: /[&<>"'`/]/g,

    escapeHtml(str) {
        if (typeof str !== 'string') {
            if (str === null || str === undefined) return '';
            str = String(str);
        }

        return str.replace(this._ESCAPE_RE, c => this._ESCAPE_MAP[c]);
    },

    /**
     * Sanitize image URLs used in popup templates.
     * Allows only absolute HTTPS URLs.
     */
    _ALLOWED_IMAGE_HOSTS: [
        's4.anilist.co',
        'myanimelist.net',
        'media.kitsu.app',
        'img1.ak.crunchyroll.com',
        'an1me.to',
    ],

    sanitizeImageUrl(url) {
        if (typeof url !== 'string') return null;
        const trimmed = url.trim();
        if (!trimmed) return null;

        try {
            const parsed = new URL(trimmed, window.location.origin);
            if (parsed.protocol !== 'https:') return null;
            const host = parsed.hostname.toLowerCase();
            const allowed = this._ALLOWED_IMAGE_HOSTS.some(
                h => host === h || host.endsWith('.' + h)
            );
            if (!allowed) return null;
            return parsed.href;
        } catch {
            return null;
        }
    },

    /**
     * Create SVG icon
     */
    createIcon(name) {
        const icons = {
            // Grid-style episodes icon — rounded rect with soft inner lines
            episodes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="19" height="19" rx="5"/><line x1="8" y1="2.5" x2="8" y2="21.5"/><line x1="16" y1="2.5" x2="16" y2="21.5"/><line x1="2.5" y1="12" x2="21.5" y2="12"/></svg>',
            // Clock — thin circle, rounded hands
            time: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
            // Calendar — pill header, clean grid hint
            calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="4"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/></svg>',
            // Delete — thin elegant X, slightly smaller
            delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><line x1="17" y1="7" x2="7" y2="17"/><line x1="7" y1="7" x2="17" y2="17"/></svg>',
            // Chevron — slim, balanced
            chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
            // Edit — minimal pencil tip, iOS-style
            edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 4.5l4 4L8 20H4v-4L15.5 4.5z"/><path d="M13 7l4 4"/></svg>',
            // Check in circle — mark as completed
            check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/></svg>',
            // Drop — pause in circle, mark as dropped/abandoned
            drop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="10" y1="9" x2="10" y2="15"/><line x1="14" y1="9" x2="14" y2="15"/></svg>'
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
