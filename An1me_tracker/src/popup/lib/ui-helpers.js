const UIHelpers = {
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

    formatProgressPercent(value) {
        const pct = Math.max(0, Math.min(100, Number(value) || 0));
        if (pct <= 0 || pct >= 100) return `${Math.round(pct)}%`;


        const rounded = Math.min(99.9, Math.round(pct * 10) / 10);
        return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
    },

    fmtHours(seconds) {
        const h = (Number(seconds) || 0) / 3600;
        if (h === 0) return '0h';
        if (h >= 100) return Math.round(h) + 'h';
        return h.toFixed(1) + 'h';
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
        'image.tmdb.org',
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
            skip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/></svg>',
            star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
            'star-filled': '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
        };
        return icons[name] || '';
    },

    countEpisodes(animeData) {
        if (!animeData) return 0;
        return Object.values(animeData).reduce((sum, anime) => sum + (anime.episodes?.length || 0), 0);
    },









    renderCoverFigure(title, coverUrl, options = {}) {
        const { extraClass = '', size = 'default' } = options;
        const safeUrl = this.sanitizeImageUrl(coverUrl);
        const safeTitle = this.escapeHtml(title || '');
        const cls = `at-cover at-cover--${size}${extraClass ? ' ' + extraClass : ''}`;

        if (safeUrl) {
            const src = window.AnimeTracker?.CoverCache?.resolve?.(safeUrl) || safeUrl;
            return `<img class="${cls}" src="${this.escapeHtml(src)}" alt="${safeTitle}" loading="lazy" decoding="async">`;
        }

        const letter = (title || '').trim().charAt(0).toUpperCase();
        return `<div class="${cls} at-cover--placeholder">${this.escapeHtml(letter)}</div>`;
    },









    showToast(message, options = {}) {
        const { type = 'info', duration = 2000 } = options;
        try {
            document.querySelectorAll('.at-toast').forEach(n => {
                const t1 = n.__atToastLeaveTimer;
                const t2 = n.__atToastRemoveTimer;
                if (t1) clearTimeout(t1);
                if (t2) clearTimeout(t2);
                n.remove();
            });

            const el = document.createElement('div');
            el.className = `at-toast at-toast--${type}`;
            el.setAttribute('role', type === 'error' ? 'alert' : 'status');
            el.setAttribute('aria-live', 'polite');
            el.textContent = String(message ?? '');

            document.body.appendChild(el);
            requestAnimationFrame(() => el.classList.add('at-toast--visible'));

            el.__atToastLeaveTimer = setTimeout(() => {
                el.classList.add('at-toast--leaving');
                el.__atToastRemoveTimer = setTimeout(() => { try { el.remove(); } catch {} }, 220);
            }, Math.max(500, duration));
        } catch {

        }
    }
};

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.UIHelpers = UIHelpers;

window.AnimeTracker.Logger = {
    info:    () => {},
    success: () => {},
    warn:    (...args) => { try { window.PopupLogger?.warn?.('FillerService', ...args); } catch {} },
    error:   (...args) => { try { window.PopupLogger?.error?.('FillerService', ...args); } catch {} }
};

// ── Dialog a11y (merged from dialogs-a11y.js) ──
(function () {
    'use strict';


    const _dialogState = new WeakMap();

    function focusableIn(root) {
        if (!root) return [];
        return Array.from(root.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(el => !el.hasAttribute('hidden') && el.getClientRects().length > 0);
    }

    function open(overlay, opts = {}) {
        if (!overlay) return;
        const restoreTo = document.activeElement;
        overlay.classList.add('visible');
        overlay.setAttribute('aria-hidden', 'false');
        const trapHandler = (e) => {
            if (e.key === 'Escape' && opts.dismissOnEscape !== false) {
                e.preventDefault();
                close(overlay);
                opts.onCancel?.();
                return;
            }
            if (e.key !== 'Tab') return;
            const focusables = focusableIn(overlay);
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        overlay.addEventListener('keydown', trapHandler);
        _dialogState.set(overlay, { restoreTo, trapHandler });

        requestAnimationFrame(() => {
            const focusables = focusableIn(overlay);
            (opts.initialFocus || focusables[0])?.focus();
        });
    }

    function close(overlay) {
        if (!overlay) return;
        const state = _dialogState.get(overlay);
        if (state) {
            overlay.removeEventListener('keydown', state.trapHandler);
            _dialogState.delete(overlay);
            try { state.restoreTo?.focus?.(); } catch {                                     }
        }
        overlay.classList.remove('visible');
        overlay.setAttribute('aria-hidden', 'true');
    }


    function inlineConfirm({ title, body, confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true } = {}) {
        return new Promise((resolve) => {

            document.querySelectorAll('.at-confirm-toast').forEach(n => n.remove());

            const el = document.createElement('div');
            el.className = 'at-confirm-toast' + (danger ? ' at-confirm-toast--danger' : '');
            el.setAttribute('role', 'alertdialog');
            el.setAttribute('aria-live', 'polite');
            el.innerHTML = `
                <div class="at-confirm-text">
                    ${title ? `<div class="at-confirm-title"></div>` : ''}
                    ${body  ? `<div class="at-confirm-body"></div>`  : ''}
                </div>
                <div class="at-confirm-actions">
                    <button type="button" class="at-confirm-cancel"></button>
                    <button type="button" class="at-confirm-ok"></button>
                </div>
            `;

            if (title) el.querySelector('.at-confirm-title').textContent = title;
            if (body)  el.querySelector('.at-confirm-body').textContent = body;
            el.querySelector('.at-confirm-cancel').textContent = cancelLabel;
            el.querySelector('.at-confirm-ok').textContent = confirmLabel;

            const finish = (value) => {
                el.classList.add('at-confirm-toast--leaving');
                setTimeout(() => { try { el.remove(); } catch {             } }, 180);
                clearTimeout(timeoutId);
                document.removeEventListener('keydown', onKey, true);
                resolve(value);
            };
            const autoDismissMs = danger ? 60000 : 8000;
            const timeoutId = setTimeout(() => finish(false), autoDismissMs);

            el.querySelector('.at-confirm-ok').addEventListener('click', () => finish(true));
            el.querySelector('.at-confirm-cancel').addEventListener('click', () => finish(false));

            document.body.appendChild(el);
            requestAnimationFrame(() => el.classList.add('at-confirm-toast--visible'));

            setTimeout(() => el.querySelector('.at-confirm-ok')?.focus(), 50);
            const onKey = (e) => {
                if (e.key === 'Escape') finish(false);
                else if (e.key === 'Enter') finish(true);
            };
            document.addEventListener('keydown', onKey, true);
        });
    }

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.Dialogs = { open, close, inlineConfirm };
})();
