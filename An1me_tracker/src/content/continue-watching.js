/**
 * Anime Tracker — Continue Watching rail
 *
 * Replaces the homepage `#mainShare` ("Share the Anime Love!") block with a
 * full-width horizontal carousel of in-progress anime. Each card resumes
 * the user's current episode; active series (non-dropped / non-on-hold /
 * non-completed / not "waiting for next ep to air") also surface a small
 * "Next" link when episode N+1 is already available.
 *
 * Self-contained: reads chrome.storage.local directly and does NOT depend
 * on the window.AnimeTrackerContent.* module stack (that stack only loads
 * on /watch/ pages), so this file ships as its own content_scripts entry.
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

    // Selectors for the homepage share block we replace.
    const SHARE_SELECTORS = ['#mainShare', '.mainShare', '[data-share="main"]'];

    let dismissed = false;
    let renderDebounce = null;
    // Did we successfully take over the `#mainShare` slot? Drives the
    // late-share watcher: when false, we'll relocate the rail into share's
    // slot the first time it appears; when true, we just kill duplicates.
    let mountedViaShare = false;
    let shareWatcher = null;
    let shareWatcherScheduled = false;

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

    /**
     * Decide whether episode N+1 should be linked from this card.
     *
     * Excluded states (per the user's spec — "οχι on hold / complete / airing"):
     *   • on hold / dropped / completed: covered via listState + the explicit
     *     onHoldAt / droppedAt / completedAt timestamps written by other parts
     *     of the extension.
     *   • airing-and-next-not-yet-released: caught by `latestEpisode` (set by
     *     the scraper to the highest available episode on the site). If
     *     `latestEpisode` is missing we fall back to `totalEpisodes`, but
     *     ONLY when there's no `nextEpisodeAt` — that field's presence is a
     *     strong "still airing, next ep is in the future" signal.
     *
     * Returns the next-episode URL or null.
     */
    function computeNextEpisodeUrl(anime, slug, episode) {
        if (!anime) return null;

        const inactive = anime.completedAt
            || anime.droppedAt
            || anime.onHoldAt
            || anime.listState === 'completed'
            || anime.listState === 'dropped'
            || anime.listState === 'on_hold';
        if (inactive) return null;

        const next = episode + 1;
        const latestEp = Number(anime.latestEpisode) || 0;
        const totalEp = Number(anime.totalEpisodes) || 0;
        const hasFutureRelease = !!anime.nextEpisodeAt;

        let available = false;
        if (latestEp >= next) {
            available = true;
        } else if (latestEp === 0 && !hasFutureRelease && totalEp >= next) {
            // No live "latest episode" signal but the series has a known
            // total and no pending future release → episode N+1 is part of a
            // finished run that's already on the site.
            available = true;
        }
        if (!available) return null;

        return `${WATCH_BASE}${slug}-episode-${next}`;
    }

    function formatSubline(episode, currentTime, duration, percentage) {
        const parts = [`Ep ${episode}`];
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
            // AniList history has not been watched on an1me.to; older imports
            // may still carry a bogus watchedAt stamp. Keep their resume cards.
            if (Array.isArray(anime && anime.episodes)
                && anime.episodes.some((ep) => {
                    if (Number(ep && ep.number) !== episode) return false;
                    if (ep && ep.durationSource === 'anilist') return false;
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
                url: resumeUrl(slug, episode, entry),
                nextUrl: computeNextEpisodeUrl(anime, slug, episode),
                nextNumber: episode + 1
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
            /* Container takes the full slot vacated by #mainShare. */
            #${CONTAINER_ID} {
                box-sizing: border-box; display: block;
                width: 100%; max-width: 100%;
                margin: 0;
                padding: 12px 14px;
                background:
                    radial-gradient(ellipse at top right, rgba(79,195,247,0.08) 0%, transparent 55%),
                    radial-gradient(ellipse at bottom left, rgba(155,106,255,0.05) 0%, transparent 55%),
                    linear-gradient(180deg, #11151f 0%, #0b0d14 100%);
                border: 1px solid rgba(255,255,255,0.05);
                border-radius: 14px;
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.05),
                    inset 0 0 0 1px rgba(79,195,247,0.04),
                    0 1px 0 rgba(0,0,0,0.4),
                    0 14px 30px -16px rgba(0,0,0,0.55),
                    0 4px 10px -6px rgba(0,0,0,0.4);
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                color: #e8edf8;
                contain: layout paint;
            }
            #${CONTAINER_ID} *, #${CONTAINER_ID} *::before, #${CONTAINER_ID} *::after { box-sizing: border-box; }

            .at-cw-head {
                display: flex; align-items: center; gap: 10px;
                margin-bottom: 12px;
            }
            .at-cw-head-title {
                display: inline-flex; align-items: center; gap: 8px;
                font-size: 13px; font-weight: 700; letter-spacing: .3px;
                color: #f3f6ff; text-transform: uppercase;
            }
            .at-cw-head-icon {
                width: 13px; height: 13px; flex-shrink: 0; fill: #4fc3f7;
                filter: drop-shadow(0 0 5px rgba(79,195,247,0.45));
            }
            .at-cw-count {
                font-size: 10px; font-weight: 700; color: #4fc3f7;
                background: rgba(79,195,247,0.12); border: 1px solid rgba(79,195,247,0.25);
                border-radius: 999px; padding: 1px 7px; line-height: 1.6;
                letter-spacing: .3px;
            }
            .at-cw-head-spacer { flex: 1 1 auto; }
            .at-cw-nav {
                display: inline-flex; gap: 6px; align-items: center;
            }
            .at-cw-nav-btn {
                width: 28px; height: 28px;
                display: inline-flex; align-items: center; justify-content: center;
                background: rgba(255,255,255,0.04) !important;
                border: 1px solid rgba(255,255,255,0.10) !important;
                border-radius: 8px !important;
                color: #cdd6e6 !important;
                cursor: pointer; padding: 0 !important;
                transition: background .15s ease, color .15s ease, border-color .15s ease, transform .15s ease;
            }
            .at-cw-nav-btn:hover:not(:disabled) {
                background: rgba(79,195,247,0.15) !important;
                border-color: rgba(79,195,247,0.45) !important;
                color: #fff !important;
            }
            .at-cw-nav-btn:disabled { opacity: .35; cursor: default; }
            .at-cw-nav-btn svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
            .at-cw-close {
                width: 28px; height: 28px;
                display: inline-flex; align-items: center; justify-content: center;
                background: rgba(255,255,255,0.04) !important;
                border: 1px solid rgba(255,255,255,0.08) !important;
                border-radius: 8px !important; color: #8899b0 !important;
                font-size: 16px; line-height: 1; cursor: pointer; padding: 0 !important;
                transition: background .15s ease, color .15s ease, transform .15s ease;
            }
            .at-cw-close:hover {
                background: rgba(255,255,255,0.10) !important;
                color: #fff !important; transform: scale(1.05);
            }

            /* Carousel wrapper provides positioning context for edge fades. */
            .at-cw-viewport {
                position: relative;
            }
            .at-cw-viewport.has-overflow::before,
            .at-cw-viewport.has-overflow::after {
                content: ''; position: absolute; top: 0; bottom: 8px; width: 28px;
                pointer-events: none; z-index: 2;
                transition: opacity .2s ease;
            }
            .at-cw-viewport.has-overflow::before {
                left: 0;
                background: linear-gradient(90deg, rgba(16,20,32,0.96), rgba(16,20,32,0));
                opacity: var(--at-cw-fade-left, 0);
            }
            .at-cw-viewport.has-overflow::after {
                right: 0;
                background: linear-gradient(270deg, rgba(16,20,32,0.96), rgba(16,20,32,0));
                opacity: var(--at-cw-fade-right, 1);
            }

            .at-cw-track {
                display: flex; gap: 10px;
                overflow-x: auto; overflow-y: hidden;
                padding: 4px 2px 8px;
                scroll-snap-type: x mandatory;
                scroll-padding-left: 2px;
                scroll-behavior: smooth;
                scrollbar-width: thin; scrollbar-color: rgba(79,195,247,0.4) transparent;
            }
            .at-cw-track::-webkit-scrollbar { height: 6px; }
            .at-cw-track::-webkit-scrollbar-track { background: transparent; }
            .at-cw-track::-webkit-scrollbar-thumb { background: rgba(79,195,247,0.30); border-radius: 999px; }
            .at-cw-track::-webkit-scrollbar-thumb:hover { background: rgba(79,195,247,0.55); }

            .at-cw-card {
                position: relative;
                flex: 0 0 auto; width: 126px;
                display: flex; flex-direction: column;
                background: linear-gradient(180deg, #1a2031 0%, #141828 100%);
                border: 1px solid rgba(255,255,255,0.05);
                border-radius: 10px;
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.04),
                    0 2px 5px rgba(0,0,0,0.32),
                    0 6px 14px -8px rgba(0,0,0,0.4);
                scroll-snap-align: start;
                transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
                isolation: isolate;
                overflow: hidden;
            }
            .at-cw-card:hover {
                transform: translateY(-2px);
                border-color: rgba(79,195,247,0.4);
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.06),
                    0 3px 8px rgba(0,0,0,0.38),
                    0 12px 22px -12px rgba(79,195,247,0.25);
            }
            .at-cw-card:hover .at-cw-play { opacity: 1; transform: translate(-50%,-50%) scale(1); }
            .at-cw-card:hover .at-cw-thumb { border-color: rgba(79,195,247,0.4); }

            /* Resume area = cover + meta. Wrapped in <a> so any non-button
               click on the card resumes; the next-ep button below has its
               own anchor + e.stopPropagation defense in case of nesting. */
            .at-cw-resume {
                text-decoration: none !important; color: inherit !important;
                display: block;
            }
            .at-cw-resume:focus-visible {
                outline: 2px solid #4fc3f7; outline-offset: 2px;
            }

            .at-cw-thumb {
                position: relative; width: 100%; aspect-ratio: 2 / 3;
                overflow: hidden;
                background: linear-gradient(150deg, #2a2f45 0%, #161a28 100%);
                border-bottom: 1px solid rgba(255,255,255,0.04);
                transition: border-color .18s ease;
            }
            .at-cw-img {
                position: absolute; inset: 0;
                width: 100% !important; height: 100% !important; max-width: none !important;
                object-fit: cover; display: block;
            }
            .at-cw-initial {
                position: absolute; inset: 0; display: flex;
                align-items: center; justify-content: center;
                font-size: 32px; font-weight: 800; color: rgba(255,255,255,0.16);
            }
            .at-cw-play {
                position: absolute; top: 50%; left: 50%;
                width: 32px; height: 32px;
                transform: translate(-50%,-50%) scale(0.75);
                display: flex; align-items: center; justify-content: center;
                background: rgba(79,195,247,0.95); border-radius: 50%;
                opacity: 0; transition: opacity .18s ease, transform .18s ease;
                box-shadow:
                    0 0 0 3px rgba(79,195,247,0.18),
                    0 3px 9px rgba(0,0,0,0.4);
            }
            .at-cw-play svg { width: 12px; height: 12px; fill: #0c1018; margin-left: 1px; }
            .at-cw-bar {
                position: absolute; left: 0; right: 0; bottom: 0; height: 3px;
                background: rgba(0,0,0,0.55);
            }
            .at-cw-bar-fill {
                height: 100%;
                background: linear-gradient(90deg, #4fc3f7 0%, #81d4fa 100%);
                box-shadow: 0 0 6px rgba(79,195,247,0.55);
            }

            .at-cw-meta { padding: 6px 8px 4px; }
            .at-cw-title {
                font-size: 11.5px; font-weight: 700; line-height: 1.25; color: #e8edf8;
                display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
            }
            .at-cw-sub {
                margin-top: 2px; font-size: 10px; font-weight: 500; color: #8899b0;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }

            .at-cw-actions {
                display: flex; flex-direction: column; gap: 4px;
                padding: 0 8px 8px;
            }
            .at-cw-btn {
                display: flex; align-items: center; justify-content: center; gap: 4px;
                padding: 4px 6px;
                border-radius: 6px;
                font-size: 10px; font-weight: 700; letter-spacing: .3px;
                text-decoration: none !important;
                transition: background .15s ease, color .15s ease, border-color .15s ease, transform .15s ease;
            }
            .at-cw-btn-resume {
                background: linear-gradient(180deg, #4fc3f7 0%, #29b6f6 100%);
                border: 1px solid rgba(79,195,247,0.6);
                color: #0c1018 !important;
                box-shadow: 0 2px 6px rgba(79,195,247,0.22);
            }
            .at-cw-btn-resume:hover {
                background: linear-gradient(180deg, #81d4fa 0%, #4fc3f7 100%);
                transform: translateY(-1px);
            }
            .at-cw-btn-next {
                background: rgba(79,195,247,0.06);
                border: 1px solid rgba(79,195,247,0.18);
                color: #b8d4e8 !important;
            }
            .at-cw-btn-next:hover {
                background: rgba(79,195,247,0.18);
                border-color: rgba(79,195,247,0.45);
                color: #fff !important;
                transform: translateY(-1px);
            }
            .at-cw-btn:focus-visible {
                outline: 2px solid #4fc3f7; outline-offset: 2px;
            }
            .at-cw-btn-arrow {
                width: 9px; height: 9px; fill: currentColor;
                transition: transform .15s ease;
            }
            .at-cw-btn-next:hover .at-cw-btn-arrow { transform: translateX(2px); }

            @media (prefers-reduced-motion: reduce) {
                .at-cw-card, .at-cw-play, .at-cw-thumb, .at-cw-btn, .at-cw-btn-arrow, .at-cw-track {
                    transition: none !important;
                    scroll-behavior: auto !important;
                }
                .at-cw-card:hover, .at-cw-btn:hover { transform: none !important; }
            }
            @media (max-width: 1199px) {
                .at-cw-card { width: 112px; }
            }
            @media (max-width: 767px) {
                #${CONTAINER_ID} {
                    /* Breathing space from the screen edges so the rail
                       doesn't visually slam into the viewport sides on
                       phones (where the host page often has zero gutter). */
                    width: calc(100% - 24px);
                    margin-inline: 12px;
                    padding: 9px;
                    border-radius: 12px;
                }
                /* Header title: shrink so the full
                   "Continue Watching from an1me-extention" string fits on
                   one line next to the count badge + close button on a
                   typical 360px phone viewport. min-width:0 lets the flex
                   item shrink; nowrap + ellipsis is the safety net for
                   ultra-narrow screens (≤320px). */
                .at-cw-head-title {
                    font-size: 10px;
                    letter-spacing: .15px;
                    gap: 6px;
                    min-width: 0;
                }
                .at-cw-head-title > span:not(.at-cw-count) {
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    min-width: 0;
                }
                /* Mobile cards: landscape thumb so each card reads as a
                   wide rectangle instead of a tall poster pillar. */
                .at-cw-card { width: 120px; }
                .at-cw-thumb { aspect-ratio: 16 / 9; }
                /* Anchor the cropped poster near the top — faces sit there
                   in most cover art, so the landscape crop still looks
                   intentional. */
                .at-cw-img { object-position: center 22%; }
                .at-cw-initial { font-size: 22px; }
                .at-cw-nav { display: none; }
                .at-cw-title {
                    font-size: 11px;
                    -webkit-line-clamp: 1;
                }
                .at-cw-sub { font-size: 9.5px; }
                .at-cw-meta { padding: 5px 7px 2px; }
                .at-cw-actions { padding: 0 7px 6px; }
                .at-cw-btn { padding: 3px 6px; font-size: 9.5px; }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function buildCard(item) {
        const card = document.createElement('div');
        card.className = 'at-cw-card';

        // Resume anchor wraps thumb + meta — clicking anywhere there resumes.
        const resume = document.createElement('a');
        resume.className = 'at-cw-resume';
        resume.href = item.url;
        resume.title = `Resume — ${item.title} · ${item.subline}`;

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

        resume.append(thumb, meta);
        card.appendChild(resume);

        // Actions: explicit Resume button + optional Next button. Both live
        // OUTSIDE the resume anchor so the Next click never bubbles to it.
        const actions = document.createElement('div');
        actions.className = 'at-cw-actions';

        const resumeBtn = document.createElement('a');
        resumeBtn.className = 'at-cw-btn at-cw-btn-resume';
        resumeBtn.href = item.url;
        resumeBtn.title = `Resume episode ${item.episode}`;
        resumeBtn.innerHTML =
            '<svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true" fill="currentColor"><polygon points="8 5 19 12 8 19"/></svg>'
            + '<span>Resume</span>';
        actions.appendChild(resumeBtn);

        // Optional "Next: Ep N+1" — only when computeNextEpisodeUrl returned
        // a URL (active series + next episode is actually on the site).
        if (item.nextUrl) {
            const next = document.createElement('a');
            next.className = 'at-cw-btn at-cw-btn-next';
            next.href = item.nextUrl;
            next.title = `Skip to episode ${item.nextNumber}`;
            // Defensive — if the browser ever renders this nested inside the
            // resume anchor (shouldn't, but iframes / Shadow DOM hosts can be
            // weird), intercept the bubble so the next-ep nav wins.
            next.addEventListener('click', (e) => { e.stopPropagation(); }, { passive: true });
            next.innerHTML =
                `<span>Next · Ep ${item.nextNumber}</span>` +
                '<svg class="at-cw-btn-arrow" viewBox="0 0 24 24" aria-hidden="true">' +
                '<path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
                '</svg>';
            actions.appendChild(next);
        }

        card.appendChild(actions);

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
            + '<span>Continue Watching from an1me-extention</span>';
        const count = document.createElement('span');
        count.className = 'at-cw-count';
        count.textContent = String(items.length);
        heading.appendChild(count);

        const spacer = document.createElement('div');
        spacer.className = 'at-cw-head-spacer';

        // Chevron nav — shown only when the track actually overflows.
        const nav = document.createElement('div');
        nav.className = 'at-cw-nav';
        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'at-cw-nav-btn';
        prevBtn.setAttribute('aria-label', 'Scroll left');
        prevBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 6 9 12 15 18"/></svg>';
        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'at-cw-nav-btn';
        nextBtn.setAttribute('aria-label', 'Scroll right');
        nextBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';
        nav.append(prevBtn, nextBtn);

        const close = document.createElement('button');
        close.className = 'at-cw-close';
        close.type = 'button';
        close.setAttribute('aria-label', 'Hide Continue Watching');
        close.textContent = '×';
        close.addEventListener('click', () => {
            dismissed = true;
            section.remove();
            stopShareWatcher();
        });

        head.append(heading, spacer, nav, close);

        const viewport = document.createElement('div');
        viewport.className = 'at-cw-viewport';

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

        const updateNavState = () => {
            const overflowing = track.scrollWidth > track.clientWidth + 1;
            viewport.classList.toggle('has-overflow', overflowing);
            if (!overflowing) {
                prevBtn.disabled = true;
                nextBtn.disabled = true;
                nav.style.display = 'none';
                viewport.style.setProperty('--at-cw-fade-left', '0');
                viewport.style.setProperty('--at-cw-fade-right', '0');
                return;
            }
            nav.style.display = '';
            const atStart = track.scrollLeft <= 1;
            const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
            prevBtn.disabled = atStart;
            nextBtn.disabled = atEnd;
            viewport.style.setProperty('--at-cw-fade-left', atStart ? '0' : '1');
            viewport.style.setProperty('--at-cw-fade-right', atEnd ? '0' : '1');
        };

        const scrollByCards = (dir) => {
            const firstCard = track.querySelector('.at-cw-card');
            const cardWidth = firstCard ? firstCard.getBoundingClientRect().width + 10 : 140;
            const step = Math.max(cardWidth * 2, track.clientWidth * 0.8);
            track.scrollBy({ left: dir * step, behavior: 'smooth' });
        };
        prevBtn.addEventListener('click', () => scrollByCards(-1));
        nextBtn.addEventListener('click', () => scrollByCards(1));
        track.addEventListener('scroll', updateNavState, { passive: true });

        // Recompute on resize. ResizeObserver covers container reflows
        // without leaking globally-listened resize events.
        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(updateNavState);
            ro.observe(track);
        }
        // First pass after mount.
        setTimeout(updateNavState, 0);

        viewport.appendChild(track);
        section.append(head, viewport);
        return section;
    }

    // ── Mount ────────────────────────────────────────────────────────────
    function findShareAnchor() {
        for (const sel of SHARE_SELECTORS) {
            const node = document.querySelector(sel);
            if (node && node.parentNode) return node;
        }
        return null;
    }

    function findContentContainer() {
        const selectors = ['main', '#main', '[role="main"]', '#content', '.site-main', '.main-content'];
        for (const sel of selectors) {
            const node = document.querySelector(sel);
            if (node) return node;
        }
        return null;
    }

    /**
     * Fallback hero anchor — used only when #mainShare is not present.
     * Drops the rail directly after the homepage hero/slider.
     */
    function findHeroAnchor(container) {
        const heroSelectors = [
            '.hero', '#hero',
            '.banner', '#banner',
            '.swiper', '.swiper-container',
            '.slider', '.slick-slider',
            '.featured', '.featured-anime',
            '.home-slider', '.main-slider',
            '.spotlight', '.spotlight-slider'
        ];
        for (const sel of heroSelectors) {
            const node = container.querySelector(sel);
            if (node && container.contains(node)) return node;
        }
        return null;
    }

    function mountSection(section) {
        // Preferred: take the place of the #mainShare block.
        const shareNode = findShareAnchor();
        if (shareNode) {
            const parent = shareNode.parentNode;
            const next = shareNode.nextSibling;
            shareNode.remove();
            parent.insertBefore(section, next);
            mountedViaShare = true;
            return true;
        }

        // Fallback path (no share block on this page) — keep the old
        // behaviour so the widget still mounts somewhere sensible.
        mountedViaShare = false;
        const container = findContentContainer();
        if (container) {
            const hero = findHeroAnchor(container);
            if (hero && hero.parentNode) {
                hero.parentNode.insertBefore(section, hero.nextSibling);
                return true;
            }

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

    function suppressShareIfPresent() {
        // If the site SPA re-rendered #mainShare after our initial mount,
        // remove it again so the widget keeps its slot.
        const shareNode = findShareAnchor();
        if (shareNode) shareNode.remove();
    }

    /**
     * Watch for `#mainShare` to appear or re-appear in the DOM after we've
     * mounted. On mobile (and on slow SPAs in general) the share block can
     * hydrate AFTER document_idle, which means our initial `mountSection`
     * fell back to the hero/content container and the page's native share
     * block then renders alongside our rail. This observer fixes both cases:
     *
     *   • Fallback-mounted rail + late share → relocate the rail into the
     *     share slot and remove the share node (single rail, correct spot).
     *   • Share-mounted rail + duplicate share re-render → just remove the
     *     duplicate so the rail keeps its slot.
     *
     * Stays alive for the lifetime of the page (SPA navigations can
     * re-render share at any time), but stops on dismiss.
     */
    function startShareWatcher() {
        if (shareWatcher) return;
        if (typeof MutationObserver === 'undefined') return;
        const root = document.body || document.documentElement;
        if (!root) return;

        shareWatcher = new MutationObserver(() => {
            if (shareWatcherScheduled) return;
            shareWatcherScheduled = true;
            queueMicrotask(() => {
                shareWatcherScheduled = false;
                if (dismissed) return;
                const ourSection = document.getElementById(CONTAINER_ID);
                if (!ourSection) return;
                const shareNode = findShareAnchor();
                if (!shareNode) return;

                if (mountedViaShare) {
                    // Duplicate share re-render — kill it.
                    shareNode.remove();
                    return;
                }

                // Promote the rail into share's slot.
                const parent = shareNode.parentNode;
                const next = shareNode.nextSibling;
                shareNode.remove();
                if (parent) parent.insertBefore(ourSection, next);
                mountedViaShare = true;
            });
        });
        shareWatcher.observe(root, { childList: true, subtree: true });
    }

    function stopShareWatcher() {
        if (shareWatcher) {
            shareWatcher.disconnect();
            shareWatcher = null;
        }
        shareWatcherScheduled = false;
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
            // Even when replacing, make sure share didn't reappear elsewhere.
            suppressShareIfPresent();
        } else {
            mountSection(section);
        }

        // Keep watching for late-rendered share blocks (mobile / SPA).
        startShareWatcher();
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
