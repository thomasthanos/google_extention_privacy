(function () {
    'use strict';

    // Render pipeline — partition/sort entries, build list HTML, mount cards, expansion state.
    // Extracted from popup/main.js. State via AT.PopupState; callbacks via _init; AT aliases below.
    const AT = window.AnimeTracker;

    const { AnimeStatus, getStatus: getAnimeStatus, isCompleted: isAnimeCompleted } = AT.StatusService;
    const { deleteAnime } = AT.AnimeActions;
    const { editAnimeTitle } = AT.AddAnimeDialog;

    let elements, _ipPatch, getActiveFilter, markInternalSave,
        normalizeCompactStatus, suppressHoverUntilMouseMove, updateStats;

    const COMPACT_TOGGLE_CHEVRONS = [
        ['airingListToggle', 'airing-chevron'],
        ['onHoldListToggle', 'onhold-chevron'],
        ['completedListToggle', 'completed-chevron'],
        ['droppedListToggle', 'dropped-chevron']
    ];

    function captureExpansionState(listEl) {
        const expandedCards = new Set();
        listEl.querySelectorAll('.anime-card.expanded').forEach(card => {
            const slug = card.querySelector('.anime-delete')?.dataset?.slug;
            if (slug) expandedCards.add(slug);
        });
        const expandedSeasonGroups = new Set();
        listEl.querySelectorAll('.anime-season-group.expanded').forEach(g => {
            if (g.dataset.baseSlug) expandedSeasonGroups.add(g.dataset.baseSlug);
        });
        const expandedSeasonItems = new Set();
        listEl.querySelectorAll('.season-item.expanded').forEach(item => {
            if (item.dataset.slug) expandedSeasonItems.add(item.dataset.slug);
        });
        const expandedMovieGroups = new Set();
        listEl.querySelectorAll('.anime-movie-group.expanded').forEach(g => {
            if (g.dataset.baseSlug) expandedMovieGroups.add(g.dataset.baseSlug);
        });
        const ipGroupWasOpen = listEl.querySelector('.ip-group-content')?.classList.contains('open') ?? false;
        return { expandedCards, expandedSeasonGroups, expandedSeasonItems, expandedMovieGroups, ipGroupWasOpen };
    }

    function restoreExpansionState(listEl, state) {
        listEl.querySelectorAll('.anime-card').forEach(card => {
            const slug = card.querySelector('.anime-delete')?.dataset?.slug;
            if (slug && state.expandedCards.has(slug)) card.classList.add('expanded');
        });
        listEl.querySelectorAll('.anime-season-group').forEach(g => {
            if (g.dataset.baseSlug && state.expandedSeasonGroups.has(g.dataset.baseSlug))
                g.classList.add('expanded');
        });
        listEl.querySelectorAll('.season-item').forEach(item => {
            if (item.dataset.slug && state.expandedSeasonItems.has(item.dataset.slug))
                item.classList.add('expanded');
        });
        listEl.querySelectorAll('.anime-movie-group').forEach(g => {
            if (g.dataset.baseSlug && state.expandedMovieGroups.has(g.dataset.baseSlug))
                g.classList.add('expanded');
        });
        if (state.ipGroupWasOpen) {
            const ipContent = listEl.querySelector('.ip-group-content');
            const ipChevron = listEl.querySelector('.ip-group-chevron');
            if (ipContent) ipContent.classList.add('open');
            if (ipChevron) ipChevron.style.transform = 'rotate(0deg)';
        }
    }

    function renderEntryGroupsHtml(entriesToRender, orderMap, visibleProgress) {
        if (!entriesToRender.length) return '';
        const { AnimeCardRenderer, SeasonGrouping } = AT;

        const groups = SeasonGrouping.groupByBase(entriesToRender);
        const groupsArray = Array.from(groups.entries());
        groupsArray.sort((a, b) => {
            const aIndex = Math.min(...a[1].map(e => orderMap.get(e.slug) ?? Number.MAX_SAFE_INTEGER));
            const bIndex = Math.min(...b[1].map(e => orderMap.get(e.slug) ?? Number.MAX_SAFE_INTEGER));
            return aIndex - bIndex;
        });

        let html = '';
        for (const [baseSlug, groupedEntries] of groupsArray) {
            if (SeasonGrouping.isMovieGroup(groupedEntries)) {
                if (groupedEntries.length > 1) {
                    html += AnimeCardRenderer.createMovieGroup(baseSlug, groupedEntries);
                } else {
                    const { slug, anime } = groupedEntries[0];
                    html += AnimeCardRenderer.createSingleMovieCard(slug, anime);
                }
            } else if (SeasonGrouping.hasMultipleSeasons(groupedEntries)) {
                html += AnimeCardRenderer.createSeasonGroup(baseSlug, groupedEntries, visibleProgress);
            } else {
                const { slug, anime } = groupedEntries[0];
                html += AnimeCardRenderer.createAnimeCard(slug, anime, visibleProgress);
            }
        }
        return html;
    }

    function renderCompactSectionHtml({ classPrefix, toggleId, label, subLabel, cardsHtml, isOpen }) {
        return `
            <div class="${classPrefix}-list-section">
                <div class="${classPrefix}-list-label" id="${toggleId}">
                    <div class="${classPrefix}-list-label-left">
                        <span class="${classPrefix}-list-label-title">${label}</span>
                        <span class="${classPrefix}-list-label-sub">${subLabel}</span>
                    </div>
                    <svg class="${classPrefix}-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform: ${isOpen ? 'rotate(0deg)' : 'rotate(-90deg)'}">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
                <div class="${classPrefix}-list-cards${isOpen ? ' open' : ''}">
                    <div class="list-inner">
                        ${cardsHtml}
                    </div>
                </div>
            </div>
        `;
    }

    function partitionEntriesByStatus(sortedEntries) {
        const normal = [];
        const completed = [];
        const dropped = [];
        const airing = [];
        const onHold = [];
        for (const entry of sortedEntries) {
            switch (getAnimeStatus(entry[0], entry[1])) {
                case AnimeStatus.DROPPED:   dropped.push(entry); break;
                case AnimeStatus.COMPLETED: completed.push(entry); break;
                case AnimeStatus.AIRING:    airing.push(entry); break;
                case AnimeStatus.ON_HOLD:   onHold.push(entry); break;
                default:                    normal.push(entry); break;
            }
        }
        completed.sort(([, a], [, b]) =>
            new Date(b.lastWatched || 0).getTime() - new Date(a.lastWatched || 0).getTime()
        );
        return { normal, completed, dropped, airing, onHold };
    }

    function buildLatestActivityMap(entries, videoProgress) {
        const progressLatestBySlug = new Map();
        for (const [id, progress] of Object.entries(videoProgress || {})) {
            if (!id || id === '__slugIndex' || progress?.deleted) continue;
            const sepIdx = id.indexOf('__episode-');
            if (sepIdx === -1) continue;
            const slug = id.slice(0, sepIdx);
            const t = progress?.savedAt ? new Date(progress.savedAt).getTime() : 0;
            if (!t) continue;
            const cur = progressLatestBySlug.get(slug) || 0;
            if (t > cur) progressLatestBySlug.set(slug, t);
        }
        const latestMap = new Map();
        for (const [slug, anime] of entries) {
            const lastWatchedTs = anime.lastWatched ? new Date(anime.lastWatched).getTime() : 0;
            const progressTs = progressLatestBySlug.get(slug) || 0;
            latestMap.set(slug, Math.max(lastWatchedTs || 0, progressTs));
        }
        return latestMap;
    }

    function attachSlugIndex(visibleProgress) {
        const slugIndex = {};
        for (const [id, progress] of Object.entries(visibleProgress)) {
            const sepIdx = id.indexOf('__episode-');
            if (sepIdx === -1) continue;
            const slug = id.substring(0, sepIdx);
            if (!slugIndex[slug]) slugIndex[slug] = [];
            slugIndex[slug].push([id, progress]);
        }
        Object.defineProperty(visibleProgress, '__slugIndex', {
            value: slugIndex,
            enumerable: false,
            configurable: true,
            writable: true
        });
    }

    // Cover images are remote `<img src>`; rebuilding the list with
    // replaceChildren() destroys them and forces a re-decode, which flickers
    // (most visible when switching category tabs). To avoid that, harvest the
    // live, already-decoded image nodes before the swap and re-insert them into
    // the freshly-built fragment, matched by src — so covers that survive the
    // re-render are reused instead of recreated.
    function harvestImages(listEl) {
        const pool = new Map();
        listEl.querySelectorAll('img[src]').forEach(img => {
            const src = img.getAttribute('src');
            if (!src) return;
            let bucket = pool.get(src);
            if (!bucket) { bucket = []; pool.set(src, bucket); }
            bucket.push(img);
        });
        return pool;
    }

    function reuseImages(fragment, pool) {
        if (!pool.size) return;
        fragment.querySelectorAll('img[src]').forEach(freshImg => {
            const src = freshImg.getAttribute('src');
            const bucket = pool.get(src);
            if (!bucket || !bucket.length) return;
            const liveImg = bucket.shift();
            // Keep the fresh node's structural attributes (class/alt may differ
            // between card contexts), but reuse the decoded pixels.
            liveImg.className = freshImg.className;
            liveImg.alt = freshImg.alt;
            freshImg.replaceWith(liveImg);
        });
    }

    function renderAnimeList(filter = '') {
        const { AnimeCardRenderer, ProgressManager, SeasonGrouping } = AT;

        const expansionState = captureExpansionState(elements.animeList);

        const categoryFilter = (slug, anime) => {
            if (AT.PopupState.currentCategory === 'all') return true;
            const isMovie = SeasonGrouping.isMovie(slug, anime);
            if (AT.PopupState.currentCategory === 'movies') return isMovie;
            if (AT.PopupState.currentCategory === 'series') return !isMovie;
            return true;
        };

        window.AnimeTracker._animeDataRef = AT.PopupState.animeData;

        const entries = Object.entries(AT.PopupState.animeData)
            .filter(([slug, anime]) => {
                const matchesSearch = !filter || anime.title.toLowerCase().includes(filter.toLowerCase());
                const matchesCategory = categoryFilter(slug, anime);
                return matchesSearch && matchesCategory;
            });

        const visibleProgress = Object.fromEntries(
            Object.entries(AT.PopupState.videoProgress).filter(([, p]) => !p.deleted)
        );
        attachSlugIndex(visibleProgress);

        const inProgressAnime = ProgressManager.getInProgressAnime(AT.PopupState.animeData, visibleProgress)
            .filter(anime => {
                const matchesSearch = !filter || anime.title.toLowerCase().includes(filter.toLowerCase());
                const trackedAnime = AT.PopupState.animeData[anime.slug];
                if (trackedAnime?.droppedAt) return false;
                if (trackedAnime && isAnimeCompleted(anime.slug, trackedAnime)) return false;
                const categoryAnime = trackedAnime || anime;
                const matchesCategory = categoryFilter(anime.slug || '', categoryAnime);
                return matchesSearch && matchesCategory;
            })
            .sort((a, b) => new Date(b.lastProgress || 0) - new Date(a.lastProgress || 0));

        if (entries.length === 0 && inProgressAnime.length === 0) {
            if (AT.PopupState.lastRenderedListMarkup !== '') {
                elements.animeList.replaceChildren();
                AT.PopupState.lastRenderedListMarkup = '';
            }
            if (filter) {
                if (elements.searchEmptyQuery) elements.searchEmptyQuery.textContent = `“${filter}”`;
                elements.searchEmptyState?.classList.add('visible');
                elements.emptyState.classList.remove('visible');
                elements.listLoading?.classList.remove('visible');
            } else if (AT.PopupState.syncing || !AT.PopupState.libraryLoaded || AT.PopupState.cloudPending) {
                elements.listLoading?.classList.add('visible');
                elements.emptyState.classList.remove('visible');
                elements.searchEmptyState?.classList.remove('visible');
            } else {
                elements.emptyState.classList.add('visible');
                elements.searchEmptyState?.classList.remove('visible');
                elements.listLoading?.classList.remove('visible');
            }
            return;
        }

        elements.emptyState.classList.remove('visible');
        elements.searchEmptyState?.classList.remove('visible');
        elements.listLoading?.classList.remove('visible');
        AT.PopupState.cloudPending = false;

        const latestMap = buildLatestActivityMap(entries, AT.PopupState.videoProgress);

        const sortedEntries = entries.sort((a, b) => {
            const [, animeA] = a;
            const [, animeB] = b;
            switch (AT.PopupState.currentSort) {
                case 'date':     return latestMap.get(b[0]) - latestMap.get(a[0]);
                case 'name':     return animeA.title.localeCompare(animeB.title, 'en');
                case 'episodes': return (animeB.episodes?.length || 0) - (animeA.episodes?.length || 0);
                default:         return 0;
            }
        });

        const orderMap = new Map(sortedEntries.map(([slug], index) => [slug, index]));
        const { normal: normalEntries, completed: completedEntries, dropped: droppedEntries,
                airing: airingEntries, onHold: onHoldEntries } = partitionEntriesByStatus(sortedEntries);

        const completedOrderMap = new Map(completedEntries.map(([slug], index) => [slug, index]));

        const trackedHtml        = renderEntryGroupsHtml(normalEntries, orderMap, visibleProgress);
        const completedCardsHtml = renderEntryGroupsHtml(completedEntries, completedOrderMap, visibleProgress);
        const droppedCardsHtml   = renderEntryGroupsHtml(droppedEntries, completedOrderMap, visibleProgress);
        const airingCardsHtml    = renderEntryGroupsHtml(airingEntries, completedOrderMap, visibleProgress);
        const onHoldCardsHtml    = renderEntryGroupsHtml(onHoldEntries, completedOrderMap, visibleProgress);
        const inProgressHtml     = AnimeCardRenderer.createInProgressGroup(inProgressAnime);

        const moviesOnlyCompleted =
            AT.PopupState.currentCategory === 'movies' &&
            completedEntries.length > 0 &&
            normalEntries.length === 0 &&
            inProgressAnime.length === 0 &&
            airingEntries.length === 0 &&
            onHoldEntries.length === 0;

        const completedGroupHtml = completedEntries.length > 0
            ? renderCompactSectionHtml({
                classPrefix: 'completed',
                toggleId: 'completedListToggle',
                label: 'COMPLETED LIST',
                subLabel: `${AT.CONFIG.COMPLETED_LIST_MIN_DAYS}+ days since last watch`,
                cardsHtml: completedCardsHtml,
                isOpen: AT.PopupState.currentCompactStatusOpen || moviesOnlyCompleted
            })
            : '';
        const droppedGroupHtml = droppedEntries.length > 0
            ? renderCompactSectionHtml({
                classPrefix: 'dropped',
                toggleId: 'droppedListToggle',
                label: 'DROPPED LIST',
                subLabel: `${droppedEntries.length} anime`,
                cardsHtml: droppedCardsHtml,
                isOpen: AT.PopupState.currentCompactStatusOpen
            })
            : '';
        const airingGroupHtml = airingEntries.length > 0
            ? renderCompactSectionHtml({
                classPrefix: 'airing',
                toggleId: 'airingListToggle',
                label: '⬤ AIRING LIST',
                subLabel: `${airingEntries.length} anime · Caught up`,
                cardsHtml: airingCardsHtml,
                isOpen: AT.PopupState.currentCompactStatusOpen
            })
            : '';
        const onHoldGroupHtml = onHoldEntries.length > 0
            ? renderCompactSectionHtml({
                classPrefix: 'onhold',
                toggleId: 'onHoldListToggle',
                label: 'ON HOLD',
                subLabel: `${onHoldEntries.length} anime`,
                cardsHtml: onHoldCardsHtml,
                isOpen: AT.PopupState.currentCompactStatusOpen
            })
            : '';

        const compactStatusItems = [
            { key: 'airing', label: 'Airing', count: airingEntries.length, sectionHtml: airingGroupHtml },
            { key: 'on_hold', label: 'Hold', count: onHoldEntries.length, sectionHtml: onHoldGroupHtml },
            { key: 'completed', label: 'Completed', count: completedEntries.length, sectionHtml: completedGroupHtml },
            { key: 'dropped', label: 'Dropped', count: droppedEntries.length, sectionHtml: droppedGroupHtml }
        ].filter(item => item.count > 0);

        if (compactStatusItems.length > 0) {
            AT.PopupState.currentCompactStatus = normalizeCompactStatus(AT.PopupState.currentCompactStatus);
            if (!compactStatusItems.some(item => item.key === AT.PopupState.currentCompactStatus)) {
                AT.PopupState.currentCompactStatus = compactStatusItems[0].key;
            }
        }

        const hideChipRow =
            AT.PopupState.currentCategory === 'movies' &&
            compactStatusItems.length === 1 &&
            compactStatusItems[0].key === 'completed';

        const chipsHtml = (compactStatusItems.length > 0 && !hideChipRow)
            ? `
                <div class="status-chip-row" role="tablist" aria-label="Quick status lists">
                    ${compactStatusItems.map((item, index) => `
                        <button
                            type="button"
                            class="status-chip${item.key === AT.PopupState.currentCompactStatus ? ' active' : ''} ${item.key.replace('_', '-')}"
                            data-compact-status="${item.key}"
                            aria-pressed="${item.key === AT.PopupState.currentCompactStatus ? 'true' : 'false'}">
                            <span class="status-chip-label">${item.label}</span>
                            <span class="status-chip-count">${item.count}</span>
                        </button>${index < compactStatusItems.length - 1 ? '<span class="status-chip-sep">•</span>' : ''}
                    `).join('')}
                </div>
            `
            : '';
        const compactSectionsHtml = compactStatusItems
            .map(item => `
                <div data-compact-section="${item.key}"${item.key === AT.PopupState.currentCompactStatus ? '' : ' hidden'}>
                    ${item.sectionHtml}
                </div>
            `)
            .join('');

        const combinedHtml = inProgressHtml + trackedHtml + chipsHtml + compactSectionsHtml;

        if (combinedHtml === AT.PopupState.lastRenderedListMarkup && elements.animeList.firstChild) {

            if (elements.animeList.querySelector('.ip-card')) {
                _ipPatch(AT.PopupState.videoProgress || {});
            }
            return;
        }

        const scrollHost = elements.animeList.closest('.main-content') || document.querySelector('.main-content');
        const savedScroll = scrollHost ? scrollHost.scrollTop : 0;

        elements.animeList.classList.add('no-transition');

        const range = document.createRange();
        range.selectNodeContents(elements.animeList);
        const fragment = range.createContextualFragment(combinedHtml);
        reuseImages(fragment, harvestImages(elements.animeList));
        elements.animeList.replaceChildren(fragment);
        AT.PopupState.lastRenderedListMarkup = combinedHtml;

        restoreExpansionState(elements.animeList, expansionState);

        if (scrollHost && savedScroll > 0 && scrollHost.scrollTop !== savedScroll) {
            scrollHost.scrollTop = savedScroll;
        }

        setupCardEventListeners();

        if (elements.animeList.querySelector('.ip-card')) {
            _ipPatch(AT.PopupState.videoProgress || {});
        }

        requestAnimationFrame(() => {
            elements.animeList.classList.remove('no-transition');
        });
    }

    function refreshCompactChevrons() {
        if (!elements.animeList) return;
        for (const [toggleId, chevronClass] of COMPACT_TOGGLE_CHEVRONS) {
            const toggle = elements.animeList.querySelector(`#${toggleId}`);
            if (!toggle) continue;
            const cards = toggle.nextElementSibling;
            const chevron = toggle.querySelector(`.${chevronClass}`);
            if (!chevron || !cards) continue;
            chevron.style.transform = cards.classList.contains('open') ? 'rotate(0deg)' : 'rotate(-90deg)';
        }
    }

    function installCardEventListeners() {
        const list = elements.animeList;
        if (!list || list.__cardListenersInstalled) return;

        list.addEventListener('click', (e) => {
            const target = e.target;

            for (const [toggleId] of COMPACT_TOGGLE_CHEVRONS) {
                const toggle = target.closest(`#${toggleId}`);
                if (!toggle || !list.contains(toggle)) continue;
                e.stopPropagation();
                const cards = toggle.nextElementSibling;
                if (cards) {
                    cards.classList.toggle('open');
                    AT.PopupState.currentCompactStatusOpen = cards.classList.contains('open');
                }
                refreshCompactChevrons();
                return;
            }

            const chip = target.closest('[data-compact-status]');
            if (chip && list.contains(chip)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const nextStatus = normalizeCompactStatus(chip.dataset.compactStatus || '');
                if (nextStatus !== AT.PopupState.currentCompactStatus) {
                    AT.PopupState.currentCompactStatus = nextStatus;
                    list.querySelectorAll('[data-compact-status]').forEach(btn => {
                        const isActive = normalizeCompactStatus(btn.dataset.compactStatus || '') === nextStatus;
                        btn.classList.toggle('active', isActive);
                        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
                    });
                    list.querySelectorAll('[data-compact-section]').forEach(section => {
                        const isActive = normalizeCompactStatus(section.dataset.compactSection || '') === nextStatus;
                        section.toggleAttribute('hidden', !isActive);
                        if (isActive) {
                            const cards = section.querySelector('.airing-list-cards, .onhold-list-cards, .completed-list-cards, .dropped-list-cards');
                            if (cards) cards.classList.toggle('open', AT.PopupState.currentCompactStatusOpen);
                        }
                    });
                    refreshCompactChevrons();
                }
                return;
            }

            const moreFillers = target.closest('.show-more-fillers');
            if (moreFillers && list.contains(moreFillers)) {
                e.stopPropagation();
                const hidden = moreFillers.previousElementSibling;
                if (hidden?.classList.contains('hidden-fillers')) {
                    const isExpanded = hidden.classList.toggle('expanded');
                    moreFillers.textContent = isExpanded ? moreFillers.dataset.lessText : moreFillers.dataset.moreText;
                }
                return;
            }
            const moreEps = target.closest('.show-more-episodes');
            if (moreEps && list.contains(moreEps)) {
                e.stopPropagation();
                const hidden = moreEps.previousElementSibling;
                if (hidden?.classList.contains('hidden-episodes')) {
                    const isExpanded = hidden.classList.toggle('expanded');
                    moreEps.textContent = isExpanded ? moreEps.dataset.lessText : moreEps.dataset.moreText;
                }
                return;
            }

            const editBtn = target.closest('.movie-edit-btn, .anime-edit-title, .season-edit-btn');
            if (editBtn && list.contains(editBtn) && editBtn.dataset.slug) {
                e.stopPropagation();
                editAnimeTitle(editBtn.dataset.slug);
                return;
            }
            const delBtn = target.closest('.movie-delete-btn, .season-delete-btn');
            if (delBtn && list.contains(delBtn) && delBtn.dataset.slug) {
                e.stopPropagation();
                deleteAnime(delBtn.dataset.slug);
                return;
            }

            const seasonHeader = target.closest('.season-item-header');
            if (seasonHeader && list.contains(seasonHeader)) {

                const seasonItem = seasonHeader.closest('.season-item');
                if (seasonItem && !seasonItem.classList.contains('season-item-movie')) {
                    e.stopPropagation();
                    seasonItem.classList.toggle('expanded');
                }
                return;
            }

            const movieGroupHeader = target.closest('.movie-group-header');
            if (movieGroupHeader && list.contains(movieGroupHeader)) {
                const group = movieGroupHeader.closest('.anime-movie-group');
                if (group) group.classList.toggle('expanded');
                return;
            }
            const seasonGroupHeader = target.closest('.season-group-header');
            if (seasonGroupHeader && list.contains(seasonGroupHeader)) {
                const group = seasonGroupHeader.closest('.anime-season-group');
                if (group) group.classList.toggle('expanded');
                return;
            }
            const partItemHeader = target.closest('.part-item-header');
            if (partItemHeader && list.contains(partItemHeader)) {
                e.stopPropagation();
                const partItem = partItemHeader.closest('.part-item');
                if (partItem) partItem.classList.toggle('expanded');
                return;
            }

            const collapsibleHeader = target.closest(
                '.in-progress-header, .episodes-header, .parts-header'
            );
            if (collapsibleHeader && list.contains(collapsibleHeader)) {
                e.stopPropagation();
                const card = collapsibleHeader.closest('.anime-card');
                if (card && !card.classList.contains('expanded')) card.classList.add('expanded');
                const parent = collapsibleHeader.parentElement;
                if (parent) parent.classList.toggle('collapsed');
                return;
            }

            const cardHeader = target.closest('.anime-card-header');
            if (cardHeader && list.contains(cardHeader)) {

                if (target.closest('.anime-card-actions') ||
                    target.closest('.anime-header-actions') ||
                    target.closest('.anime-fetch-filler')) {
                    return;
                }
                e.stopPropagation();
                const card = cardHeader.closest('.anime-card');
                if (card) {
                    const wasExpanded = card.classList.toggle('expanded');
                    card.setAttribute('aria-expanded', wasExpanded ? 'true' : 'false');
                }
            }
        });

        list.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const card = e.target.classList?.contains('anime-card') ? e.target : null;
            if (!card) return;
            e.preventDefault();
            const wasExpanded = card.classList.toggle('expanded');
            card.setAttribute('aria-expanded', wasExpanded ? 'true' : 'false');
        });

        list.__cardListenersInstalled = true;
    }

    function setupCardEventListeners() {
        installCardEventListeners();
        refreshCompactChevrons();
    }

    AT.RenderList = {
        _init(d) {
            elements = d.elements;
            _ipPatch = d._ipPatch;
            getActiveFilter = d.getActiveFilter;
            markInternalSave = d.markInternalSave;
            normalizeCompactStatus = d.normalizeCompactStatus;
            suppressHoverUntilMouseMove = d.suppressHoverUntilMouseMove;
            updateStats = d.updateStats;
        },
        captureExpansionState, restoreExpansionState, renderEntryGroupsHtml, renderCompactSectionHtml, partitionEntriesByStatus, buildLatestActivityMap, attachSlugIndex, renderAnimeList, refreshCompactChevrons, installCardEventListeners, setupCardEventListeners
    };
})();
