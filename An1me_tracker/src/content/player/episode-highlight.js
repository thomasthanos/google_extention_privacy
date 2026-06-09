(function () {
    'use strict';

    if (window.self !== window.top) return;

    // Watch-page episode-list decoration: highlight watched/filler episodes, inject badge
    // styles, decorate the current episode. Extracted from content/main.js. Self-contained
    // (own observers/state + AT services); exposed via AnimeTrackerContent.EpisodeHighlight.
    const AT = window.AnimeTrackerContent;

    function getBaseSlug(slug) {
        if (!slug || typeof slug !== 'string') return slug || '';
        const lower = slug.toLowerCase();
        if (lower.startsWith('naruto')) return 'naruto';
        if (lower.startsWith('one-punch-man')) return 'one-punch-man';
        if (lower.startsWith('kimetsu-no-yaiba')) return 'kimetsu-no-yaiba';
        if (lower.startsWith('shingeki-no-kyojin')) return 'shingeki-no-kyojin';
        if (lower.startsWith('initial-d')) return 'initial-d';
        if (lower.startsWith('bleach')) return 'bleach';
        return lower
            .replace(/-season-?\d+(-[a-z-]+)?$/i, '')
            .replace(/-s\d+$/i, '')
            .replace(/-\d+(st|nd|rd|th)-season$/i, '')
            .replace(/-(part|cour)-?\d+(-[a-z-]+)?$/i, '')
            .replace(/-20\d{2}$/i, '')
            .replace(/-(ii|iii|iv|v|vi)$/i, '')
            .replace(/-[a-z]+-hen$/i, '');
    }

    let _highlightStorageListener = null;
    function clearHighlightStorageListener() {
        if (_highlightStorageListener) {
            try { chrome.storage.onChanged.removeListener(_highlightStorageListener); } catch { }
            _highlightStorageListener = null;
        }
    }

    function highlightWatchedEpisodes(slug) {
        const { Logger } = AT;
        clearHighlightStorageListener();
        injectEpisodeBadgeStyles();

        function applyHighlights(watchedSet) {
            const items = document.querySelectorAll('.episode-list-item[data-episode-search-query]');
            let highlighted = 0;
            for (const item of items) {
                const epNum = parseInt(item.getAttribute('data-episode-search-query'), 10);
                if (isNaN(epNum)) continue;
                if (watchedSet.has(epNum)) {
                    item.style.opacity = '';
                    item.style.color = '';
                    if (!item.classList.contains('at-watched-episode')) {
                        item.classList.add('at-watched-episode');
                        if (!item.querySelector('.at-watched-badge')) {
                            const badge = document.createElement('span');
                            badge.className = 'at-watched-badge';
                            badge.textContent = 'WATCHED';
                            item.appendChild(badge);
                        }
                    }
                    highlighted++;
                } else if (item.classList.contains('at-watched-episode')) {
                    item.classList.remove('at-watched-episode');
                    item.querySelector('.at-watched-badge')?.remove();
                }
            }
            return highlighted;
        }

        chrome.storage.local.get(['animeData'], (result) => {
            if (chrome.runtime.lastError || !result.animeData) return;
            const anime = result.animeData[slug];
            if (!anime?.episodes?.length) return;

            const watchedSet = new Set(anime.episodes.map(ep => Number(ep.number)));
            if (watchedSet.size === 0) return;

            const count = applyHighlights(watchedSet);
            if (count > 0) {
                Logger.debug(`Highlighted ${count} watched episodes in episode list`);
            } else {
                const container = document.querySelector('.episode-list-display-box');
                const target = container || document.body;
                let retryDebounce = null;
                const obs = new MutationObserver(() => {
                    if (retryDebounce) return;
                    retryDebounce = setTimeout(() => {
                        retryDebounce = null;
                        const retry = applyHighlights(watchedSet);
                        if (retry > 0) obs.disconnect();
                    }, 150);
                });
                obs.observe(target, { childList: true, subtree: true });
                setTimeout(() => { obs.disconnect(); if (retryDebounce) clearTimeout(retryDebounce); }, 10000);
            }
        });

        _highlightStorageListener = (changes) => {
            if (!changes.animeData) return;
            const newData = changes.animeData.newValue || {};
            const anime = newData[slug];
            if (!anime?.episodes?.length) return;
            const watchedSet = new Set(anime.episodes.map(ep => Number(ep.number)));
            applyHighlights(watchedSet);
        };
        chrome.storage.onChanged.addListener(_highlightStorageListener);
    }

    function injectEpisodeBadgeStyles() {
        if (document.querySelector('#anime-tracker-episode-styles')) return;

        let proxonUrl = '', comicSansUrl = '';
        try {
            proxonUrl = chrome.runtime.getURL('src/fonts/PROXON.ttf');
            comicSansUrl = chrome.runtime.getURL('src/fonts/comic_sans.ttf');
        } catch { }

        const style = document.createElement('style');
        style.id = 'anime-tracker-episode-styles';
        style.textContent = `
            @font-face { font-family: 'AT-PROXON'; src: url('${proxonUrl}') format('truetype'); font-weight: 400 900; font-display: swap; }
            @font-face { font-family: 'AT-ComicSans'; src: url('${comicSansUrl}') format('truetype'); font-weight: 400 900; font-display: swap; }
            .episode-list-item.at-watched-episode { border: 1px solid rgba(233, 171, 56, 0.22) !important; border-left: 3px solid #e9ab38 !important; border-radius: 4px !important; }
            .episode-list-item.at-watched-episode:not(.current-episode) { opacity: 0.78 !important; background: linear-gradient(90deg, rgba(233, 171, 56, 0.12), transparent 70%) !important; }
            .episode-list-item.at-watched-episode .episode-list-item-title, .episode-list-item.at-watched-episode .episode-list-item-number { color: #e9ab38 !important; }
            .episode-list-item.at-watched-episode .episode-list-item-title { font-family: 'AT-PROXON', inherit !important; letter-spacing: 0.3px !important; }
            .episode-list-item.at-watched-episode .episode-list-item-number { font-family: 'AT-ComicSans', inherit !important; }
            .episode-list-item.at-watched-episode .at-watched-badge { display: inline-block; margin-left: 6px; padding: 1px 6px; font-size: 10px; font-weight: 700; line-height: 1.2; color: #1a1a1a; background: linear-gradient(135deg, #f5c66e, #e9ab38); border-radius: 4px; letter-spacing: 0.3px; vertical-align: middle; box-shadow: 0 1px 2px rgba(0,0,0,0.25); }
            .episode-list-item.at-filler-episode { border: 1px solid rgba(168, 85, 247, 0.22) !important; border-left: 3px solid #a855f7 !important; border-radius: 4px !important; }
            .episode-list-item.at-filler-episode:not(.current-episode) { background: linear-gradient(90deg, rgba(168, 85, 247, 0.12), transparent 70%) !important; }
            .episode-list-item.at-filler-episode .at-filler-badge { display: inline-block; margin-left: 6px; padding: 1px 6px; font-size: 10px; font-weight: 700; line-height: 1.2; color: #fff; background: linear-gradient(135deg, #c084fc, #a855f7); border-radius: 4px; letter-spacing: 0.3px; vertical-align: middle; box-shadow: 0 1px 2px rgba(0,0,0,0.25); }
            .episode-list-item.at-watched-episode.at-filler-episode { border-left-color: #a855f7 !important; }
            .episode-head .episode-list-display-box .episode-list-item.current-episode, .episode-list-item.current-episode { color: inherit !important; }
            .episode-head .episode-list-display-box .episode-list-item.current-episode::after, .episode-list-item.current-episode::after,
            .episode-head .episode-list-display-box .episode-list-item.current-episode::before, .episode-list-item.current-episode::before { content: none !important; display: none !important; background-color: transparent !important; border: 0 !important; width: 0 !important; height: 0 !important; }
            .episode-list-item.current-episode { border: 1px solid rgba(79, 195, 247, 0.38) !important; border-left: 3px solid #4fc3f7 !important; border-radius: 4px !important; background: linear-gradient(90deg, rgba(79, 195, 247, 0.22), rgba(79, 195, 247, 0.05) 70%) !important; box-shadow: 0 0 0 1px rgba(79, 195, 247, 0.18), 0 2px 12px rgba(79, 195, 247, 0.15) !important; position: relative !important; }
            .episode-list-item.current-episode .episode-list-item-title { color: #e8f6ff !important; font-family: 'AT-PROXON', inherit !important; letter-spacing: 0.3px !important; font-weight: 600 !important; }
            .episode-list-item.current-episode .episode-list-item-number { color: #4fc3f7 !important; font-family: 'AT-ComicSans', inherit !important; font-weight: 700 !important; }
            .episode-list-item.current-episode .at-current-badge { display: inline-block; margin-left: 6px; padding: 1px 7px; font-size: 10px; font-weight: 700; line-height: 1.2; color: #0e1117; background: linear-gradient(135deg, #7dd3fc, #4fc3f7); border-radius: 4px; letter-spacing: 0.5px; vertical-align: middle; box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 0 8px rgba(79, 195, 247, 0.45); text-transform: uppercase; animation: at-current-pulse 2.2s ease-in-out infinite; }
            @keyframes at-current-pulse { 0%, 100% { box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 0 8px rgba(79, 195, 247, 0.45); } 50% { box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 0 14px rgba(79, 195, 247, 0.75); } }
            .episode-list-item.current-episode.at-watched-episode, .episode-list-item.current-episode.at-filler-episode { border-left-color: #4fc3f7 !important; opacity: 1 !important; }
            @media (prefers-reduced-motion: reduce) {
                .episode-list-item.current-episode .at-current-badge { animation: none !important; }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
        decorateCurrentEpisode();
    }

    let _currentEpisodeObserver = null;
    let _currentEpisodeObserverTimeout = null;
    function decorateCurrentEpisode() {
        const apply = () => {
            document.querySelectorAll('.at-current-badge').forEach(badge => {
                const item = badge.closest('.episode-list-item');
                if (!item || !item.classList.contains('current-episode')) badge.remove();
            });
            const items = document.querySelectorAll('.episode-list-item.current-episode');
            items.forEach(item => {
                if (item.querySelector('.at-current-badge')) return;
                const badge = document.createElement('span');
                badge.className = 'at-current-badge';
                badge.textContent = 'NOW';
                item.appendChild(badge);
            });
        };
        apply();



        if (_currentEpisodeObserver) { try { _currentEpisodeObserver.disconnect(); } catch { } _currentEpisodeObserver = null; }
        if (_currentEpisodeObserverTimeout) { clearTimeout(_currentEpisodeObserverTimeout); _currentEpisodeObserverTimeout = null; }



        const target = document.querySelector('.episode-list-display-box')
            || document.querySelector('.episode-head')
            || document.body;
        let _applyDebounce = null;
        _currentEpisodeObserver = new MutationObserver(() => {
            if (_applyDebounce) return;
            _applyDebounce = setTimeout(() => { _applyDebounce = null; apply(); }, 150);
        });
        _currentEpisodeObserver.observe(target, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['class']
        });


        _currentEpisodeObserverTimeout = setTimeout(() => {
            try { _currentEpisodeObserver?.disconnect(); } catch { }
            _currentEpisodeObserver = null;
            _currentEpisodeObserverTimeout = null;
        }, 60000);
    }

    function highlightFillerEpisodes(slug, title) {
        const { Logger } = AT;
        if (!slug) return;

        try {
            chrome.runtime.sendMessage({ type: 'GET_FILLER_EPISODES', animeSlug: slug, animeTitle: title || null }, (response) => {
                if (chrome.runtime.lastError || !response?.fillers) return;
                const fillerSet = new Set(response.fillers.map(Number).filter(n => Number.isFinite(n)));
                if (fillerSet.size === 0) return;

                injectEpisodeBadgeStyles();

                const applyFiller = () => {
                    const items = document.querySelectorAll('.episode-list-item[data-episode-search-query]');
                    let tagged = 0;
                    for (const item of items) {
                        const epNum = parseInt(item.getAttribute('data-episode-search-query'), 10);
                        if (!Number.isFinite(epNum)) continue;
                        const isFiller = fillerSet.has(epNum);
                        if (isFiller && !item.classList.contains('at-filler-episode')) {
                            item.classList.add('at-filler-episode');
                            if (!item.querySelector('.at-filler-badge')) {
                                const badge = document.createElement('span');
                                badge.className = 'at-filler-badge';
                                badge.textContent = 'FILLER';
                                item.appendChild(badge);
                            }
                            tagged++;
                        } else if (!isFiller && item.classList.contains('at-filler-episode')) {
                            item.classList.remove('at-filler-episode');
                            item.querySelector('.at-filler-badge')?.remove();
                        }
                    }
                    return tagged;
                };

                if (applyFiller() === 0) {
                    const target = document.querySelector('.episode-list-display-box') || document.body;
                    let fillerRetryDebounce = null;
                    const obs = new MutationObserver(() => {
                        if (fillerRetryDebounce) return;
                        fillerRetryDebounce = setTimeout(() => {
                            fillerRetryDebounce = null;
                            if (applyFiller() > 0) obs.disconnect();
                        }, 150);
                    });
                    obs.observe(target, { childList: true, subtree: true });
                    setTimeout(() => {
                        obs.disconnect();
                        if (fillerRetryDebounce) clearTimeout(fillerRetryDebounce);
                    }, 10000);
                } else {
                    Logger.debug(`Tagged filler episodes for ${slug}`);
                }
            });
        } catch (e) { Logger.debug('Filler coloring failed:', e.message); }
    }

    function detectPageMaxEpisode(animeSlug, currentEpisodeNumber) {
        let pageMax = 0;
        try {
            const escaped = String(animeSlug || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (!escaped) return Number(currentEpisodeNumber) || 0;
            const hrefPattern = new RegExp(`/watch/${escaped}-episode-(\\d+)`, 'i');

            const grid = document.querySelector('#episodeGrid');
            if (grid) {
                const items = grid.querySelectorAll('a[data-search], a[href*="-episode-"]');
                for (const a of items) {
                    const ds = parseInt(a.getAttribute('data-search') || '', 10);
                    if (Number.isFinite(ds) && ds > pageMax) pageMax = ds;
                    const m = (a.getAttribute('href') || '').match(hrefPattern);
                    if (m) {
                        const n = parseInt(m[1], 10);
                        if (Number.isFinite(n) && n > pageMax) pageMax = n;
                    }
                }
            }

            const cssSlug = animeSlug.replace(/["\\]/g, '\\$&');
            const allLinks = document.querySelectorAll(`a[href*="${cssSlug}-episode-"]`);
            for (const a of allLinks) {
                const m = (a.getAttribute('href') || '').match(hrefPattern);
                if (!m) continue;
                const n = parseInt(m[1], 10);
                if (!Number.isFinite(n) || n <= 0 || n > 9999) continue;
                if (n > pageMax) pageMax = n;
            }
        } catch {}

        const cur = Number(currentEpisodeNumber) || 0;
        if (cur > pageMax) pageMax = cur;
        return pageMax;
    }

    async function bumpLatestEpisodeFromPage(info) {
        if (!info?.animeSlug) return;
        try {
            const pageMax = detectPageMaxEpisode(info.animeSlug, info.episodeNumber);
            if (!(pageMax > 0)) return;

            const key = `animeinfo_${info.animeSlug}`;
            const result = await new Promise((resolve) => {
                try { chrome.storage.local.get([key], (r) => resolve(r || {})); }
                catch { resolve({}); }
            });
            const cached = (result && result[key]) || null;
            const cachedLatest = Number(cached?.latestEpisode) || 0;
            if (pageMax <= cachedLatest) return;

            const updated = { ...(cached || {}), latestEpisode: pageMax };
            await new Promise((resolve) => {
                try { chrome.storage.local.set({ [key]: updated }, () => resolve()); }
                catch { resolve(); }
            });
            AT.Logger?.debug?.(`Bumped ${key}.latestEpisode → ${pageMax}`);
        } catch (e) {
            AT.Logger?.warn?.('bumpLatestEpisodeFromPage failed:', e?.message || e);
        }
    }

    window.AnimeTrackerContent = window.AnimeTrackerContent || {};
    window.AnimeTrackerContent.EpisodeHighlight = {
        getBaseSlug, clearHighlightStorageListener, highlightWatchedEpisodes, injectEpisodeBadgeStyles, decorateCurrentEpisode, highlightFillerEpisodes, detectPageMaxEpisode, bumpLatestEpisodeFromPage
    };
})();
