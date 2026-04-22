const UIHelpers = {
    DEBUG: false,
    Logger: {
        info: (msg, data) => { if (UIHelpers.DEBUG) console.log('[Anime Tracker]', msg, data !== undefined ? data : ''); },
        success: (msg, data) => { if (UIHelpers.DEBUG) console.log('[Anime Tracker] ✓', msg, data !== undefined ? data : ''); },
        error: (msg, data) => console.error('[Anime Tracker] ✗', msg, data !== undefined ? data : ''),
        warn: (msg, data) => { if (UIHelpers.DEBUG) console.warn('[Anime Tracker] ⚠', msg, data !== undefined ? data : ''); }
    },

    getUniqueId(animeSlug, episodeNumber) {
        return `${animeSlug}__episode-${episodeNumber}`;
    },

    formatDuration(seconds) {
        if (!seconds || seconds === 0) return '0m';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    },

    formatDurationShort(seconds) {
        if (!seconds || seconds === 0) return '0h';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        if (hours >= 72) {
            const days = Math.floor(hours / 24);
            return `${days}d`;
        }

        if (hours > 0) {
            return `${hours}h`;
        }
        return `${minutes}m`;
    },

    formatDate(isoString) {
        if (!isoString) return '';

        const date = new Date(isoString);
        const now = new Date();
        const diffMs = now - date;
        const diffSeconds = Math.floor(diffMs / 1000);
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

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

    getProgressSizeClass(episodeCount, totalEpisodes) {
        const total = totalEpisodes || episodeCount;
        if (total >= 200) return 'size-huge';
        if (total >= 100) return 'size-large';
        if (total >= 50) return 'size-medium';
        return 'size-small';
    },

    _ESCAPE_MAP: { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '`': '&#x60;', '/': '&#x2F;' },
    _ESCAPE_RE: /[&<>"'`/]/g,

    escapeHtml(str) {
        if (typeof str !== 'string') {
            if (str === null || str === undefined) return '';
            str = String(str);
        }

        return str.replace(this._ESCAPE_RE, c => this._ESCAPE_MAP[c]);
    },

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

    createIcon(name) {
        const icons = {
            episodes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="19" height="19" rx="5"/><line x1="8" y1="2.5" x2="8" y2="21.5"/><line x1="16" y1="2.5" x2="16" y2="21.5"/><line x1="2.5" y1="12" x2="21.5" y2="12"/></svg>',
            time: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
            calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="4"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/></svg>',
            delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><line x1="17" y1="7" x2="7" y2="17"/><line x1="7" y1="7" x2="17" y2="17"/></svg>',
            chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
            edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 4.5l4 4L8 20H4v-4L15.5 4.5z"/><path d="M13 7l4 4"/></svg>',
            check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/></svg>',
            pause: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="10" y1="9" x2="10" y2="15"/><line x1="14" y1="9" x2="14" y2="15"/></svg>',
            drop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>',
            more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>',
            canon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>',
            filler: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11h.01"/><path d="M14 6h.01"/><path d="M18 6h.01"/><path d="M6.5 13.1h.01"/><path d="M22 5c0 9-4 12-6 12s-6-3-6-12c0-2 2-3 6-3s6 1 6 3"/><path d="M17.4 9.9c-.8.8-2 .8-2.8 0"/><path d="M10.1 7.1C9 7.2 7.7 7.7 6 8.6c-3.5 2-4.7 3.9-3.7 5.6 4.5 7.8 9.5 8.4 11.2 7.4.9-.5 1.9-2.1 1.9-4.7"/><path d="M9.1 16.5c.3-1.1 1.4-1.7 2.4-1.4"/></svg>',
            skip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/></svg>'
        };
        return icons[name] || '';
    },

    countEpisodes(animeData) {
        if (!animeData) return 0;
        return Object.values(animeData).reduce((sum, anime) => sum + (anime.episodes?.length || 0), 0);
    }
};

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.UIHelpers = UIHelpers;
window.AnimeTracker.Logger = UIHelpers.Logger;
