/**
 * Anime Tracker — Continue Watching rail
 *
 * Injects a row of in-progress anime at the top of the an1me.to homepage,
 * each card linking straight back to where the user left off.
 *
 * Self-contained: reads chrome.storage.local directly and does NOT depend on
 * the window.AnimeTrackerContent.* module stack (that stack only loads on
 * /watch/ pages), so this file ships as its own content_scripts entry.
 */
(function () {
    'use strict';

    if (window.self !== window.top) return;
    if (window.__atContinueWatchingMounted) return;
    window.__atContinueWatchingMounted = true;

    const CONTAINER_ID = 'at-continue-watching';
    const STYLE_ID = 'at-continue-watching-styles';
    const WATCH_BASE = 'https://an1me.to/watch/';
    const MAX_ITEMS = 20;
    const RENDER_DEBOUNCE_MS = 300;

    let dismissed = false;
    let renderDebounce = null;

    function isContextValid() {
        try { return !!(chrome.runtime && chrome.runtime.id); }
        catch { return false; }
    }

    // ── Data ─────────────────────────────────────────────────────────────
    function parseProgressKey(key) {
        const m = /^(.+)__episode-(\d+)$/.exec(key);
        if (!m) return null;
        const episode = parseInt(m[2], 10);
        if (!Number.isFinite(episode) || episode <= 0) return null;
        return { slug: m[1], episode };
    }

    function humanizeSlug(slug) {
        return String(slug || '')
            .replace(/[-_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    function safeCover(url) {
        return (typeof url === 'string' && /^https:\/\//i.test(url)) ? url : null;
    }

    function resumeUrl(slug, episode, entry) {
        // `pagePath` is stamped by progress-tracker when the real watch-page
        // slug differs from the default `${slug}-episode-${N}` shape.
        const pagePath = (entry && typeof entry.pagePath === 'string') ? entry.pagePath.trim() : '';
        if (pagePath) return WATCH_BASE + pagePath;
        return `${WATCH_BASE}${slug}-episode-${episode}`;
    }

    function formatSubline(episode, currentTime, duration, percentage) {
        const parts = [`Episode ${episode}`];
        const remaining = duration - currentTime;
        if (duration > 0 && Number.isFinite(remaining) && remaining > 0) {
            const mins = Math.round(remaining / 60);
            parts.push(mins <= 1 ? 'almost done' : `${mins} min left`);
        } else if (percentage > 0) {
            parts.push(`${percentage}% watched`);
        }
        return parts.join(' · ');
    }

    function buildItems(videoProgress, animeData) {
        const bySlug = new Map();

        for (const [key, entry] of Object.entries(videoProgress || {})) {
            if (key === '__slugIndex' || !entry || entry.deleted) continue;
            const parsed = parseProgressKey(key);
            if (!parsed) continue;
            const { slug, episode } = parsed;

            const anime = (animeData && animeData[slug]) || null;
            // Episode already in the tracked library → finished, not "in progress".
            // Exception: AniList-imported episodes without a real watchedAt
            // haven't actually been watched on an1me.to — keep their resume cards.
            if (Array.isArray(anime && anime.episodes)
                && anime.episodes.some((ep) => {
                    if (Number(ep && ep.number) !== episode) return false;
                    if (ep && ep.durationSource === 'anilist' && !ep.watchedAt) return false;
                    return true;
                })) {
                continue;
            }

            const currentTime = Number(entry.currentTime) || 0;
            if (currentTime <= 0) continue;
            const duration = Number(entry.duration) || 0;

            let percentage = Number(entry.percentage);
            if (!Number.isFinite(percentage) || percentage <= 0) {
                percentage = duration > 0 ? Math.floor((currentTime / duration) * 100) : 0;
            }
            percentage = Math.max(0, Math.min(100, percentage));

            const savedAt = entry.savedAt ? new Date(entry.savedAt).getTime() : 0;
            const title = (anime && typeof anime.title === 'string' && anime.title.trim())
                ? anime.title.trim()
                : humanizeSlug(slug);

            const item = {
                slug, episode, percentage, savedAt, title,
                cover: safeCover(entry.coverImage) || safeCover(anime && anime.coverImage),
                subline: formatSubline(episode, currentTime, duration, percentage),
                url: resumeUrl(slug, episode, entry)
            };

            // One card per anime — keep the most recently watched episode.
            const existing = bySlug.get(slug);
            if (!existing || savedAt >= existing.savedAt) bySlug.set(slug, item);
        }

        return [...bySlug.values()]
            .sort((a, b) => b.savedAt - a.savedAt)
            .slice(0, MAX_ITEMS);
    }

    // ── Rendering ────────────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${CONTAINER_ID} {
                box-sizing: border-box; display: block;
                width: calc(100% - 32px); max-width: 1180px;
                margin: 18px auto; padding: 16px 18px 14px;
                background: linear-gradient(180deg, rgba(18,20,32,0.96), rgba(12,14,24,0.97));
                border: 1px solid rgba(79,195,247,0.16); border-radius: 18px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.35);
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                color: #e8edf8;
            }
            #${CONTAINER_ID} *, #${CONTAINER_ID} *::before, #${CONTAINER_ID} *::after { box-sizing: border-box; }
            .at-cw-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
            .at-cw-head-title {
                display: flex; align-items: center; gap: 9px;
                font-size: 15px; font-weight: 800; letter-spacing: .2px; color: #f3f6ff;
            }
            .at-cw-head-icon {
                width: 16px; height: 16px; flex-shrink: 0; fill: #4fc3f7;
                filter: drop-shadow(0 0 6px rgba(79,195,247,0.45));
            }
            .at-cw-count {
                font-size: 11px; font-weight: 700; color: #4fc3f7;
                background: rgba(79,195,247,0.14); border: 1px solid rgba(79,195,247,0.28);
                border-radius: 999px; padding: 1px 8px; line-height: 1.5;
            }
            .at-cw-close {
                margin-left: auto; width: 28px; height: 28px;
                display: flex; align-items: center; justify-content: center;
                background: rgba(255,255,255,0.06) !important;
                border: 1px solid rgba(255,255,255,0.1) !important;
                border-radius: 8px !important; color: #8899b0 !important;
                font-size: 18px; line-height: 1; cursor: pointer; padding: 0 !important;
                transition: background .15s ease, color .15s ease;
            }
            .at-cw-close:hover { background: rgba(255,255,255,0.12) !important; color: #fff !important; }
            .at-cw-track {
                display: flex; gap: 14px; overflow-x: auto; overflow-y: hidden;
                padding: 4px 2px 10px; scroll-snap-type: x proximity;
                scrollbar-width: thin; scrollbar-color: rgba(79,195,247,0.4) transparent;
            }
            .at-cw-track::-webkit-scrollbar { height: 7px; }
            .at-cw-track::-webkit-scrollbar-track { background: transparent; }
            .at-cw-track::-webkit-scrollbar-thumb { background: rgba(79,195,247,0.35); border-radius: 999px; }
            .at-cw-track::-webkit-scrollbar-thumb:hover { background: rgba(79,195,247,0.6); }
            .at-cw-card {
                flex: 0 0 auto; width: 150px;
                text-decoration: none !important; color: inherit !important;
                scroll-snap-align: start; transition: transform .18s ease;
            }
            .at-cw-card:hover { transform: translateY(-4px); }
            .at-cw-card:hover .at-cw-thumb { border-color: rgba(79,195,247,0.55); box-shadow: 0 8px 22px rgba(79,195,247,0.22); }
            .at-cw-card:hover .at-cw-play { opacity: 1; transform: translate(-50%,-50%) scale(1); }
            .at-cw-card:focus-visible { outline: 2px solid #4fc3f7; outline-offset: 3px; border-radius: 12px; }
            .at-cw-thumb {
                position: relative; width: 100%; aspect-ratio: 2 / 3;
                border-radius: 12px; overflow: hidden;
                background: linear-gradient(150deg, #2a2f45, #171a28);
                border: 1px solid rgba(255,255,255,0.08);
                transition: border-color .18s ease, box-shadow .18s ease;
            }
            .at-cw-img {
                position: absolute; inset: 0;
                width: 100% !important; height: 100% !important; max-width: none !important;
                object-fit: cover; display: block;
            }
            .at-cw-initial {
                position: absolute; inset: 0; display: flex;
                align-items: center; justify-content: center;
                font-size: 44px; font-weight: 800; color: rgba(255,255,255,0.16);
            }
            .at-cw-play {
                position: absolute; top: 50%; left: 50%;
                width: 44px; height: 44px;
                transform: translate(-50%,-50%) scale(0.8);
                display: flex; align-items: center; justify-content: center;
                background: rgba(79,195,247,0.92); border-radius: 50%;
                opacity: 0; transition: opacity .18s ease, transform .18s ease;
                box-shadow: 0 4px 14px rgba(0,0,0,0.4);
            }
            .at-cw-play svg { width: 18px; height: 18px; fill: #0c1018; margin-left: 2px; }
            .at-cw-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 5px; background: rgba(0,0,0,0.55); }
            .at-cw-bar-fill {
                height: 100%; background: linear-gradient(90deg, #4fc3f7, #81d4fa);
                box-shadow: 0 0 8px rgba(79,195,247,0.6);
            }
            .at-cw-meta { padding: 8px 2px 0; }
            .at-cw-title {
                font-size: 13px; font-weight: 700; line-height: 1.3; color: #e8edf8;
                display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
            }
            .at-cw-sub {
                margin-top: 3px; font-size: 11.5px; font-weight: 500; color: #8899b0;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            @media (prefers-reduced-motion: reduce) {
                .at-cw-card, .at-cw-play, .at-cw-thumb { transition: none !important; }
                .at-cw-card:hover { transform: none; }
            }
            @media (max-width: 560px) {
                #${CONTAINER_ID} { width: calc(100% - 20px); padding: 14px; }
                .at-cw-card { width: 120px; }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function buildCard(item) {
        const card = document.createElement('a');
        card.className = 'at-cw-card';
        card.href = item.url;
        card.title = `${item.title} — ${item.subline}`;

        const thumb = document.createElement('div');
        thumb.className = 'at-cw-thumb';

        const initial = document.createElement('span');
        initial.className = 'at-cw-initial';
        initial.textContent = (item.title[0] || '?').toUpperCase();
        thumb.appendChild(initial);

        if (item.cover) {
            const img = document.createElement('img');
            img.className = 'at-cw-img';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.alt = '';
            // Drop the <img> on load failure so the gradient + initial show through.
            img.addEventListener('error', () => img.remove(), { once: true });
            img.src = item.cover;
            thumb.appendChild(img);
        }

        const play = document.createElement('div');
        play.className = 'at-cw-play';
        play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="8 5 19 12 8 19"/></svg>';
        thumb.appendChild(play);

        const bar = document.createElement('div');
        bar.className = 'at-cw-bar';
        const fill = document.createElement('div');
        fill.className = 'at-cw-bar-fill';
        fill.style.width = `${item.percentage}%`;
        bar.appendChild(fill);
        thumb.appendChild(bar);

        const meta = document.createElement('div');
        meta.className = 'at-cw-meta';
        const titleEl = document.createElement('div');
        titleEl.className = 'at-cw-title';
        titleEl.textContent = item.title;
        const subEl = document.createElement('div');
        subEl.className = 'at-cw-sub';
        subEl.textContent = item.subline;
        meta.append(titleEl, subEl);

        card.append(thumb, meta);
        return card;
    }

    function buildSection(items) {
        const section = document.createElement('section');
        section.id = CONTAINER_ID;
        section.setAttribute('aria-label', 'Continue Watching');

        const head = document.createElement('div');
        head.className = 'at-cw-head';

        const heading = document.createElement('div');
        heading.className = 'at-cw-head-title';
        heading.innerHTML =
            '<svg class="at-cw-head-icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="8 5 19 12 8 19"/></svg>'
            + '<span>Continue Watching</span>';
        const count = document.createElement('span');
        count.className = 'at-cw-count';
        count.textContent = String(items.length);
        heading.appendChild(count);

        const close = document.createElement('button');
        close.className = 'at-cw-close';
        close.type = 'button';
        close.setAttribute('aria-label', 'Hide Continue Watching');
        close.textContent = '×';
        close.addEventListener('click', () => {
            dismissed = true;
            section.remove();
        });

        head.append(heading, close);

        const track = document.createElement('div');
        track.className = 'at-cw-track';
        for (const item of items) track.appendChild(buildCard(item));

        // Vertical wheel → horizontal scroll, but yield to the page when the
        // rail can't scroll or is already at the edge in that direction.
        track.addEventListener('wheel', (e) => {
            if (!e.deltaY || track.scrollWidth <= track.clientWidth) return;
            const atStart = track.scrollLeft <= 0;
            const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
            if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) return;
            track.scrollLeft += e.deltaY;
            e.preventDefault();
        }, { passive: false });

        section.append(head, track);
        return section;
    }

    function findContentContainer() {
        const selectors = ['main', '#main', '[role="main"]', '#content', '.site-main', '.main-content'];
        for (const sel of selectors) {
            const node = document.querySelector(sel);
            if (node) return node;
        }
        return null;
    }

    function mountSection(section) {
        const container = findContentContainer();
        if (container) {
            // A flex-row / grid container would size our section as one of its
            // own layout items. Insert before it (as a sibling) in that case
            // so the rail always spans full width; otherwise drop it inside
            // as the first child, where the site's own header spacing applies.
            let isRowish = false;
            try {
                const cs = getComputedStyle(container);
                isRowish = (cs.display === 'flex' || cs.display === 'inline-flex')
                    ? !/column/.test(cs.flexDirection || '')
                    : (cs.display === 'grid' || cs.display === 'inline-grid');
            } catch { /* getComputedStyle can throw on detached nodes */ }

            if (isRowish && container.parentNode) {
                container.parentNode.insertBefore(section, container);
            } else {
                container.insertBefore(section, container.firstChild);
            }
            return true;
        }
        if (document.body) {
            document.body.insertBefore(section, document.body.firstChild);
            return true;
        }
        return false;
    }

    function render(items) {
        const existing = document.getElementById(CONTAINER_ID);

        if (dismissed || !items.length) {
            if (existing) existing.remove();
            return;
        }

        injectStyles();
        const section = buildSection(items);

        if (existing) {
            existing.replaceWith(section);
        } else {
            mountSection(section);
        }
    }

    function loadAndRender() {
        if (dismissed || !isContextValid()) return;
        chrome.storage.local.get(['videoProgress', 'animeData'], (result) => {
            if (chrome.runtime.lastError) return;
            try {
                render(buildItems(result.videoProgress || {}, result.animeData || {}));
            } catch { /* never break the host page */ }
        });
    }

    function scheduleRender() {
        if (renderDebounce) clearTimeout(renderDebounce);
        renderDebounce = setTimeout(() => {
            renderDebounce = null;
            loadAndRender();
        }, RENDER_DEBOUNCE_MS);
    }

    // ── Boot ─────────────────────────────────────────────────────────────
    // Pull the latest cloud doc once so the rail reflects episodes started on
    // other devices. The SW's `pollCloudData` self-rate-limits (3-min gate +
    // cache), so this stays cheap even across rapid homepage reloads.
    try {
        chrome.runtime.sendMessage({ type: 'WAKE_AND_POLL_CLOUD' }, () => {
            void chrome.runtime.lastError;
        });
    } catch { /* extension context invalidated — ignore */ }

    // Re-render when progress changes locally or arrives via the cloud poll.
    try {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local') return;
            if (changes.videoProgress || changes.animeData) scheduleRender();
        });
    } catch { /* ignore */ }

    loadAndRender();
})();
