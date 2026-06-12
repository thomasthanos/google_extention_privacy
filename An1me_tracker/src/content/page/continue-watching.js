

(function () {
    'use strict';

    if (window.self !== window.top) return;
    if (window.__atContinueWatchingMounted) return;
    window.__atContinueWatchingMounted = true;

    const CONTAINER_ID = 'at-continue-watching';
    const STYLE_ID = 'at-continue-watching-styles';
    const RENDER_DEBOUNCE_MS = 300;

    const SHARE_SELECTORS = ['#mainShare', '.mainShare', '[data-share="main"]'];

    let dismissed = false;
    let renderDebounce = null;

    let mountedViaShare = false;
    let shareWatcher = null;
    let shareWatcherScheduled = false;

    // Pure helpers live in continue-watching-utils.js
    const { isContextValid, parseProgressKey, buildItems } = window.AnimeTrackerContent.CWUtils;

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = window.AnimeTrackerContent.CWStyles(CONTAINER_ID);
        (document.head || document.documentElement).appendChild(style);
    }

    function buildCard(item) {
        const card = document.createElement('div');
        card.className = 'at-cw-card';

        const resume = document.createElement('a');
        resume.className = 'at-cw-resume';
        resume.href = item.url;
        resume.title = item.isStart 
            ? `Start — ${item.title} · Ep ${item.episode}`
            : `Resume — ${item.title} · ${item.subline}`;

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

        if (item.isNewEpisode) {
            card.classList.add('at-cw-card-new');
            const newBadge = document.createElement('span');
            newBadge.className = 'at-cw-new-badge';
            newBadge.textContent = 'NEW';
            thumb.appendChild(newBadge);
        }

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

        const actions = document.createElement('div');
        actions.className = 'at-cw-actions';

        const resumeBtn = document.createElement('a');
        resumeBtn.className = 'at-cw-btn at-cw-btn-resume';
        resumeBtn.href = item.url;
        resumeBtn.title = item.isStart ? `Start episode ${item.episode}` : `Resume episode ${item.episode}`;
        resumeBtn.innerHTML =
            '<svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true" fill="currentColor"><polygon points="8 5 19 12 8 19"/></svg>'
            + `<span>${item.isStart ? 'Start' : 'Resume'}</span>`;
        actions.appendChild(resumeBtn);

        if (item.nextUrl && !item.isStart) {
            const next = document.createElement('a');
            next.className = 'at-cw-btn at-cw-btn-next';
            next.href = item.nextUrl;
            next.title = `Skip to episode ${item.nextNumber}`;

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
        close.innerHTML =
            '<span class="at-cw-close-glyph" aria-hidden="true">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">' +
                    '<line x1="7" y1="7" x2="17" y2="17"/>' +
                    '<line x1="17" y1="7" x2="7" y2="17"/>' +
                '</svg>' +
            '</span>';
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

        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(updateNavState);
            ro.observe(track);
        }

        setTimeout(updateNavState, 0);

        viewport.appendChild(track);
        section.append(head, viewport);
        return section;
    }

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

        const shareNode = findShareAnchor();
        if (shareNode) {
            const parent = shareNode.parentNode;
            const next = shareNode.nextSibling;
            shareNode.remove();
            parent.insertBefore(section, next);
            mountedViaShare = true;
            return true;
        }

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
            } catch {                                                    }

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

        const shareNode = findShareAnchor();
        if (shareNode) shareNode.remove();
    }

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

                    shareNode.remove();
                    return;
                }

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

            suppressShareIfPresent();
        } else {
            mountSection(section);
        }

        startShareWatcher();
    }

    function collectAnimeInfoKeys(videoProgress, animeData) {
        const slugs = new Set(Object.keys(animeData || {}));
        for (const key of Object.keys(videoProgress || {})) {
            const parsed = parseProgressKey(key);
            if (parsed && parsed.slug) slugs.add(parsed.slug);
        }
        return [...slugs].map((slug) => `animeinfo_${slug}`);
    }

    function pickAnimeInfoBySlug(storageResult) {
        const out = {};
        for (const [key, value] of Object.entries(storageResult || {})) {
            if (!key.startsWith('animeinfo_') || !value) continue;
            out[key.slice('animeinfo_'.length)] = value;
        }
        return out;
    }

    function loadAndRender() {
        if (dismissed || !isContextValid()) return;
        chrome.storage.local.get(['videoProgress', 'animeData'], (result) => {
            if (chrome.runtime.lastError) return;
            const videoProgress = result.videoProgress || {};
            const animeData = result.animeData || {};
            const infoKeys = collectAnimeInfoKeys(videoProgress, animeData);
            const finish = (infoResult) => {
                try {
                    render(buildItems(videoProgress, animeData, pickAnimeInfoBySlug(infoResult)));
                } catch {                                 }
            };

            if (!infoKeys.length) {
                finish({});
                return;
            }

            chrome.storage.local.get(infoKeys, (infoResult) => {
                if (chrome.runtime.lastError) {
                    finish({});
                    return;
                }
                finish(infoResult || {});
            });
        });
    }

    function scheduleRender() {
        if (renderDebounce) clearTimeout(renderDebounce);
        renderDebounce = setTimeout(() => {
            renderDebounce = null;
            loadAndRender();
        }, RENDER_DEBOUNCE_MS);
    }

    try {
        chrome.runtime.sendMessage({ type: 'WAKE_AND_POLL_CLOUD' }, () => {
            void chrome.runtime.lastError;
        });
    } catch {                                              }

    try {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local') return;
            const changedKeys = Object.keys(changes || {});
            if (
                changes.videoProgress
                || changes.animeData
                || changedKeys.some((key) => key.startsWith('animeinfo_'))
            ) {
                scheduleRender();
            }
        });
    } catch {              }

    loadAndRender();
})();
