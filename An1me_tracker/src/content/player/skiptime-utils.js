(function () {
    'use strict';

    // Stateless helpers + static config for the Skiptime helper.
    // No closure state lives here — everything is pure or argument-driven.

    const Logger = window.AnimeTrackerContent?.Logger || {
        info: () => {}, debug: () => {}, error: () => {}, warn: () => {}, success: () => {},
        once: () => {}, throttled: () => {}
    };

    const TARGETS = [
        { key: 'introStart', shortcut: '1', label: 'Intro Start',  fieldId: 'intro-begin' },
        { key: 'introEnd',   shortcut: '2', label: 'Intro End',    fieldId: 'intro-end'   },
        { key: 'outroStart', shortcut: '3', label: 'Outro Start',  fieldId: 'outro-begin' },
        { key: 'outroEnd',   shortcut: '4', label: 'Outro End',    fieldId: 'outro-end'   }
    ];

    function defaultCache() {
        return {
            introStart: null, introEnd: null, outroStart: null, outroEnd: null,
            updatedAt: null
        };
    }

    function getFallbackEpisodeIdentity() {
        try {
            const path = location.pathname.replace(/^\/+|\/+$/g, '');
            const nestedWatchMatch = path.match(/^watch\/([^/]+)\/([^/]+)$/i);
            if (nestedWatchMatch) {
                const animeSlug = nestedWatchMatch[1];
                const episodeMatch = nestedWatchMatch[2].match(/(?:^|[-_])ep(?:isode)?[-_]?(\d+)/i)
                    || nestedWatchMatch[2].match(/(\d+)/);
                const episodeNumber = parseInt(episodeMatch?.[1], 10);
                if (animeSlug && Number.isFinite(episodeNumber) && episodeNumber > 0) {
                    return `${animeSlug}__episode-${episodeNumber}`;
                }
            }

            const flatWatchMatch = path.match(/^watch\/(.+?)-episode-(\d+)(?:$|[/?#])/i);
            if (flatWatchMatch) {
                return `${flatWatchMatch[1]}__episode-${parseInt(flatWatchMatch[2], 10)}`;
            }

            return path;
        } catch {
            return 'unknown';
        }
    }

    function parseEpisodeNumberFromText(text) {
        if (!text || typeof text !== 'string') return 0;
        const match = text.match(/Episode\s*(\d+)/i)
            || text.match(/\bEp\s*(\d+)/i)
            || text.match(/\b(\d+)\b/);
        const value = parseInt(match?.[1], 10);
        return Number.isFinite(value) && value > 0 ? value : 0;
    }

    function getEpisodeNumberFromDom() {
        const selectors = [
            '.episode-list-item.current-episode',
            '.episode-list-item.active',
            '.episode-list .active',
            '.episodes .current',
            '[data-open-nav-episode].current-episode',
            '[data-open-nav-episode].active'
        ];

        for (const selector of selectors) {
            const node = document.querySelector(selector);
            if (!node) continue;

            const directValue = node.getAttribute?.('data-episode-search-query')
                || node.getAttribute?.('data-open-nav-episode')
                || node.dataset?.episodeSearchQuery
                || node.dataset?.openNavEpisode;
            const directNumber = parseInt(directValue, 10);
            if (Number.isFinite(directNumber) && directNumber > 0) return directNumber;

            const href = node.getAttribute?.('href')
                || node.querySelector?.('a[href]')?.getAttribute?.('href')
                || '';
            const hrefMatch = href.match(/-episode-(\d+)(?:$|[/?#])/i);
            const hrefNumber = parseInt(hrefMatch?.[1], 10);
            if (Number.isFinite(hrefNumber) && hrefNumber > 0) return hrefNumber;

            const textNumber = parseEpisodeNumberFromText(node.textContent || node.getAttribute?.('title') || '');
            if (textNumber > 0) return textNumber;
        }

        return 0;
    }

    function getEpisodeIdentity() {
        const domEpisodeNumber = getEpisodeNumberFromDom();
        try {
            const info = window.AnimeTrackerContent?.AnimeParser?.extractAnimeInfo?.({ silent: true });
            if (info?.animeSlug && domEpisodeNumber > 0) {
                return `${info.animeSlug}__episode-${domEpisodeNumber}`;
            }
            if (info?.animeSlug && Number.isFinite(Number(info.episodeNumber)) && Number(info.episodeNumber) > 0) {
                return `${info.animeSlug}__episode-${Number(info.episodeNumber)}`;
            }
        } catch (e) {
            Logger.debug('Skiptime: AnimeParser identity lookup failed', e);
        }
        return getFallbackEpisodeIdentity();
    }

    function isComplete(cache) {
        return !!(cache.introStart && cache.introEnd && cache.outroStart && cache.outroEnd);
    }

    function isSubmittable(cache) {
        const introPair = !!(cache.introStart && cache.introEnd);
        const outroPair = !!(cache.outroStart && cache.outroEnd);
        return introPair || outroPair;
    }

    function formatTime(seconds) {
        const total = Math.max(0, Math.floor(Number(seconds) || 0));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
    }

    function parseTimeToSeconds(text) {
        if (!text || typeof text !== 'string') return 0;
        const parts = text.trim().split(':').map(Number);
        if (parts.some(Number.isNaN)) return 0;
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        return 0;
    }

    function queryVideoInDocument(doc) {
        if (!doc?.querySelector) return null;
        return doc.querySelector('video.art-video') || doc.querySelector('video');
    }

    function isUsableControlsHost(host) {
        if (!host || !host.isConnected) return false;
        try {
            const rect = host.getBoundingClientRect();
            const style = host.ownerDocument?.defaultView?.getComputedStyle?.(host);
            if (style?.display === 'none' || style?.visibility === 'hidden') return false;
            return rect.width > 0 || rect.height > 0 || host.childElementCount >= 0;
        } catch {
            return true;
        }
    }

    function dispatchFieldEvents(field) {
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        field.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    function waitForSelector(selector, timeoutMs = 3500) {
        return new Promise((resolve) => {
            const existing = document.querySelector(selector);
            if (existing) return resolve(existing);

            let resolved = false;
            const obs = new MutationObserver(() => {
                const node = document.querySelector(selector);
                if (node && !resolved) {
                    resolved = true;
                    obs.disconnect();
                    resolve(node);
                }
            });
            obs.observe(document.documentElement, { childList: true, subtree: true });
            setTimeout(() => {
                if (resolved) return;
                resolved = true;
                obs.disconnect();
                resolve(null);
            }, timeoutMs);
        });
    }

    function buildPanelHtml() {
        const rows = TARGETS.map((t) => `
            <button class="at-skip-row" type="button" data-key="${t.key}" data-captured="false">
                <span class="at-skip-key">${t.shortcut}</span>
                <span class="at-skip-label">${t.label}</span>
                <span class="at-skip-time">--:--:--</span>
            </button>
        `).join('');

        return `
            <button class="at-skip-toggle" type="button" aria-haspopup="true" aria-expanded="false">
                <span class="at-skip-toggle-dot" aria-hidden="true"></span>
                <span class="at-skip-toggle-label">Skiptime</span>
                <span class="at-skip-toggle-count">0/4</span>
            </button>
            <div class="at-skip-dropdown" hidden>
                <div class="at-skip-header">
                    <div class="at-skip-heading">
                        <span class="at-skip-title">Skip Time Helper</span>
                        <span class="at-skip-subtitle">1-4 capture, 0 reset</span>
                    </div>
                    <button class="at-skip-close" type="button" aria-label="Disable helper">×</button>
                </div>
                <div class="at-skip-rows">${rows}</div>
                <div class="at-skip-footer">
                    <button class="at-skip-reset" type="button">Reset</button>
                    <button class="at-skip-submit" type="button" disabled>Submit Now</button>
                    <span class="at-skip-progress">0/4 captured</span>
                </div>
            </div>
        `;
    }

    window.AnimeTrackerContent = window.AnimeTrackerContent || {};
    window.AnimeTrackerContent.SkiptimeUtils = {
        TARGETS,
        defaultCache,
        getEpisodeIdentity,
        isComplete,
        isSubmittable,
        formatTime,
        parseTimeToSeconds,
        queryVideoInDocument,
        isUsableControlsHost,
        dispatchFieldEvents,
        waitForSelector,
        buildPanelHtml
    };
})();
