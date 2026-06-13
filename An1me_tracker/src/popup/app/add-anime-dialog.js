(function () {
    'use strict';

    // Add / edit-anime dialogs (slug detect, episode preview, add, edit title, fillers).
    // Extracted from popup/main.js. State via AT.PopupState; elements + a few main
    // callbacks injected through _init(). AT aliases re-derived below.
    const AT = window.AnimeTracker;
    const { showToast } = AT;   // toast helper (loaded before this module)

    const { open: openDialogA11y, close: closeDialogA11y } = AT.Dialogs;
    const {
        parseRanges: parseEpisodeRanges,
        splitCanonAndFillers,
        extractSlugFromInput,
        generateTitleFromSlug,
        renderEpisodesPreview: updateEpisodesPreview
    } = AT.EpisodeParse;
    const { setManualListState, markTitleEdited, clearDeletedAnimeSlug } = AT.StatusService;

    // injected by main via _init()
    let elements, markInternalSave, renderAnimeList, updateStats;
    // dialog-only state (used solely by this module)
    let editingSlug = null;

    function showAddAnimeDialog() {
        elements.animeSlugInput.value = '';
        elements.episodesWatchedInput.value = '';
        elements.animeSlugInput.classList.remove('error');
        elements.episodesWatchedInput.classList.remove('error', 'invalid-range');
        const includeFillersCb = document.getElementById('includeFillers');
        if (includeFillersCb) includeFillersCb.checked = false;
        const includeFillerLabel = document.getElementById('includeFillerLabel');
        if (includeFillerLabel) includeFillerLabel.style.display = '';
        const includeFillersBlock = document.getElementById('includeFillersBlock');
        if (includeFillersBlock) {
            includeFillersBlock.style.display = 'none';
            includeFillersBlock.dataset.checked = 'false';
        }


        _setSlugStatus('idle');
        const slugDetectedHint = document.getElementById('slugDetectedHint');
        if (slugDetectedHint) { slugDetectedHint.style.display = 'none'; slugDetectedHint.textContent = ''; }
        const slugMeta = document.getElementById('slugMeta');
        if (slugMeta) {
            slugMeta.style.display = 'none';
            const slugCard = slugMeta.closest('.slug-card');
            if (slugCard) slugCard.dataset.hasMeta = 'false';
        }
        const fillerActionBar = document.getElementById('fillerActionBar');
        if (fillerActionBar) fillerActionBar.style.display = 'none';


        const counter = document.getElementById('episodesCounter');
        if (counter) counter.style.display = 'none';


        const confirmBtn = elements.confirmAddAnime;
        if (confirmBtn) {
            confirmBtn.dataset.state = 'idle';
            confirmBtn.disabled = false;
        }

        AT.PopupState.addDialogDetectedTitle = null;
        AT.PopupState.addDialogKnownTotal = null;
        AT.PopupState.addDialogTotalCanon = null;
        AT.PopupState.addDialogCurrentSlug = null;
        _publishDialogState();
        updateEpisodesPreview('');

        const _wdb = document.getElementById('watchDetectBanner');
        if (_wdb) _wdb.style.display = 'none';

        openDialogA11y(elements.addAnimeDialog, {
            initialFocus: elements.animeSlugInput,
            onCancel: hideAddAnimeDialog
        });

        // Auto-detect from an open an1me.to watch tab (async; fills the banner if found).
        _detectFromActiveTab();
    }

    // ─── Auto-detect the anime/episode from an open an1me.to watch tab ───
    async function _detectFromActiveTab() {
        let info = null;
        try {
            const tabs = await chrome.tabs.query({
                url: ['https://an1me.to/watch/*', 'https://*.an1me.to/watch/*']
            });
            if (!tabs || tabs.length === 0) return;
            const tab = tabs.find(t => t.active) || tabs[0];
            if (!tab || tab.id == null) return;
            info = await new Promise((resolve) => {
                chrome.tabs.sendMessage(tab.id, { type: 'GET_CURRENT_WATCH_INFO' }, (resp) => {
                    if (chrome.runtime.lastError) { resolve(null); return; }
                    resolve(resp || null);
                });
            });
        } catch { return; }
        if (!info || !info.slug || !info.episode) return;
        // Bail if the dialog was closed again while we were waiting.
        if (elements.addAnimeDialog?.getAttribute('aria-hidden') === 'true') return;
        _renderDetectBanner(info);
    }

    function _renderDetectBanner(info) {
        const slug = info.slug;
        const epLo = Number(info.episode) || 0;
        if (!slug || epLo <= 0) return;
        const epHi = (Number(info.secondEpisode) > epLo) ? Number(info.secondEpisode) : epLo;
        const isDouble = epHi > epLo;

        const banner = document.getElementById('watchDetectBanner');
        if (!banner) return;

        // Pre-fill the slug and kick off metadata loading (fillers / cover / total),
        // but never clobber something the user already typed.
        if (elements.animeSlugInput.value.trim() === '') {
            elements.animeSlugInput.value = slug;
            onSlugInputChange(slug);
        }

        const titleEl = document.getElementById('watchDetectTitle');
        const epEl = document.getElementById('watchDetectEp');
        const linkEl = document.getElementById('watchDetectLink');
        const existingEl = document.getElementById('watchDetectExisting');
        const onlyBtn = document.getElementById('watchDetectOnly');
        const allBtn = document.getElementById('watchDetectAll');

        const displayTitle = (info.title && String(info.title).trim()) || generateTitleFromSlug(slug);
        const epLabel = isDouble ? `${epLo}–${epHi}` : String(epLo);
        if (titleEl) titleEl.textContent = displayTitle;
        if (epEl) epEl.textContent = `Episode ${epLabel}`;
        if (linkEl) linkEl.href = info.link || `https://an1me.to/watch/${slug}`;

        // Show what's already saved for this anime, if anything.
        const existing = AT.PopupState.animeData?.[slug];
        const watchedNums = (existing && Array.isArray(existing.episodes))
            ? existing.episodes.map(ep => ep && ep.number).filter(n => Number.isFinite(n)).sort((a, b) => a - b)
            : [];
        if (existingEl) {
            if (watchedNums.length > 0) {
                existingEl.textContent = `Already saved: ${AT.EpisodeParse.buildRangeString(watchedNums)}`;
                existingEl.style.display = '';
            } else {
                existingEl.style.display = 'none';
            }
        }

        if (onlyBtn) {
            onlyBtn.textContent = isDouble ? `Only Ep ${epLo}–${epHi}` : `Only Ep ${epLo}`;
            onlyBtn.onclick = () => _applyDetectChoice(isDouble ? `${epLo}-${epHi}` : String(epLo));
        }
        if (allBtn) {
            // Only the episodes (1..epHi) that aren't already saved, so we never
            // re-add the whole anime when the user has already watched part of it.
            const watchedSet = new Set(watchedNums);
            const missing = [];
            for (let n = 1; n <= epHi; n++) {
                if (!watchedSet.has(n)) missing.push(n);
            }
            if (missing.length === 0) {
                // Everything up to the current episode is already tracked.
                allBtn.textContent = 'All caught up';
                allBtn.disabled = true;
                allBtn.onclick = null;
            } else {
                const missingStr = AT.EpisodeParse.buildRangeString(missing);
                allBtn.disabled = false;
                allBtn.textContent = watchedNums.length > 0
                    ? `Add missing ${missingStr}`
                    : `Episodes 1–${epHi}`;
                allBtn.onclick = () => _applyDetectChoice(missingStr);
            }
        }

        banner.style.display = '';
    }

    function _applyDetectChoice(rangeStr) {
        elements.episodesWatchedInput.value = rangeStr;
        elements.episodesWatchedInput.classList.remove('error', 'invalid-range');
        updateEpisodesPreview(rangeStr);
        // Nudge focus to the confirm button so Enter saves straight away.
        try { elements.confirmAddAnime?.focus(); } catch {                 }
    }

    function _setSlugStatus(status) {

        const wrap = document.querySelector('.slug-input-wrap');
        if (wrap) wrap.dataset.status = status;
    }

    function _publishDialogState() {
        window.AnimeTracker.__addDialogState.knownTotal = AT.PopupState.addDialogKnownTotal;
    }

    function _setDetectedHint(rawInput, slug) {
        const el = document.getElementById('slugDetectedHint');
        if (!el) return;
        const isUrl = /^https?:\/\//i.test(rawInput || '') || /\//.test(rawInput || '');
        if (isUrl && slug && slug !== rawInput.trim()) {
            el.innerHTML = `Detected slug: <code>${slug}</code>`;
            el.style.display = 'block';
        } else {
            el.style.display = 'none';
            el.textContent = '';
        }
    }

    async function onSlugInputChange(rawSlug) {
        const { FillerService } = AT;
        const slug = extractSlugFromInput(rawSlug);
        AT.PopupState.addDialogCurrentSlug = slug;
        _setDetectedHint(rawSlug, slug);

        const bar = document.getElementById('fillerActionBar');
        const slugMeta = document.getElementById('slugMeta');

        if (!slug) {
            _setSlugStatus('idle');
            if (bar) bar.style.display = 'none';
            if (slugMeta) {
            slugMeta.style.display = 'none';
            const slugCard = slugMeta.closest('.slug-card');
            if (slugCard) slugCard.dataset.hasMeta = 'false';
        }
            AT.PopupState.addDialogKnownTotal = null;
            AT.PopupState.addDialogTotalCanon = null;
            return;
        }


        _setSlugStatus('loading');
        if (bar) {
            bar.style.display = 'flex';
            bar.className = 'filler-action-bar is-loading';
            bar.textContent = 'Fetching…';
        }

        const [episodeTypes, animeInfoFromCache] = await Promise.all([
            FillerService.fetchEpisodeTypes(slug).catch(() => null),
            (async () => {
                try {
                    const s = await chrome.storage.local.get([`animeinfo_${slug}`]);
                    return s[`animeinfo_${slug}`] || null;
                } catch { return null; }
            })()
        ]);

        if (slug !== AT.PopupState.addDialogCurrentSlug) return;


        let availableTotal = null;
        let finalTotal = null;
        if (animeInfoFromCache && !animeInfoFromCache.notFound) {
            availableTotal = animeInfoFromCache.latestEpisode || null;
            finalTotal = animeInfoFromCache.totalEpisodes || null;
        }
        if (!availableTotal && episodeTypes && !episodeTypes.notFound) {
            availableTotal = episodeTypes.totalEpisodes || null;
        }
        if (!finalTotal) {
            const al = AT.AnilistService.getTotalEpisodes?.(slug);
            if (al && al > 0) finalTotal = al;
        }
        if (!availableTotal) availableTotal = finalTotal;

        AT.PopupState.addDialogKnownTotal = availableTotal;
        _publishDialogState();

        const hasFillerData = episodeTypes && !episodeTypes.notFound;
        const fillerNums = hasFillerData ? (episodeTypes.filler || []) : [];
        const totalEps = hasFillerData ? (episodeTypes.totalEpisodes || 0) : 0;
        const canonCount = totalEps > 0
            ? Math.max(0, totalEps - fillerNums.length)
            : (availableTotal ? Math.max(0, availableTotal - fillerNums.length) : null);
        AT.PopupState.addDialogTotalCanon = canonCount;

        const showAll = !!availableTotal;
        const showCanon = !!canonCount && canonCount !== availableTotal;
        const showSkip = fillerNums.length > 0;
        const hasAnyChip = showAll || showCanon || showSkip;
        const hasAnyInfo = hasFillerData || availableTotal;


        if (bar) {
            if (!hasAnyInfo && !hasAnyChip) {
                bar.style.display = 'none';
            } else {
                bar.className = 'filler-action-bar';
                bar.textContent = '';


                const left = document.createElement('div');
                left.className = 'fab-left';

                if (canonCount !== null) {
                    const b = document.createElement('span');
                    b.className = 'filler-badge filler-badge-canon';
                    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg><span>${canonCount} canon</span>`;
                    left.appendChild(b);
                }
                if (fillerNums.length > 0) {
                    const b = document.createElement('span');
                    b.className = 'filler-badge filler-badge-fillers fab-filler-toggle';
                    b.setAttribute('role', 'button');
                    b.setAttribute('tabindex', '0');
                    b.setAttribute('aria-expanded', 'false');
                    b.setAttribute('aria-controls', 'fabFillerDetails');
                    b.setAttribute('title', 'Show filler episodes');
                    const { buildRangeString: brs } = AT.EpisodeParse;
                    const fillerStr = brs([...fillerNums].sort((a, b) => a - b));
                    b.innerHTML =
                        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>` +
                        `<span>${fillerNums.length} fillers</span>` +
                        `<svg class="fab-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;
                    left.appendChild(b);







                    const details = document.createElement('div');
                    details.className = 'fab-filler-details';
                    details.id = 'fabFillerDetails';
                    details.hidden = true;
                    details.textContent = fillerStr;



                    b._detailsEl = details;
                    bar._detailsEl = details;
                }

                bar.appendChild(left);


                if (hasAnyChip) {
                    const right = document.createElement('div');
                    right.className = 'fab-right';

                    const mkChip = (action, label, sub) => {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'ep-chip';
                        btn.dataset.action = action;
                        btn.textContent = label;
                        if (sub) {
                            const s = document.createElement('span');
                            s.className = 'ep-chip-sub';
                            s.textContent = sub;
                            btn.appendChild(s);
                        }
                        return btn;
                    };

                    if (showAll) right.appendChild(mkChip('all', 'All', `1–${availableTotal}`));
                    if (showCanon) right.appendChild(mkChip('canon', 'Canon', `${canonCount}`));
                    if (showSkip) right.appendChild(mkChip('skip-fillers', '⏭ Skip fillers'));

                    bar.appendChild(right);
                }






                if (bar._detailsEl) {
                    bar.appendChild(bar._detailsEl);
                }

                bar.style.display = 'flex';
            }
        }


        if (slugMeta) {
            const cover = document.getElementById('slugMetaCover');
            const titleEl = document.getElementById('slugMetaTitle');
            const statsEl = document.getElementById('slugMetaStats');
            const cachedAnilist = AT.AnilistService.cache?.[slug];
            const detectedTitle = animeInfoFromCache?.title
                || (cachedAnilist && !cachedAnilist.notFound && cachedAnilist.title)
                || null;
            const coverUrl = animeInfoFromCache?.coverImage
                || (cachedAnilist && cachedAnilist.coverImage)
                || null;
            const status = animeInfoFromCache?.status || cachedAnilist?.status || null;

            if (detectedTitle || coverUrl || availableTotal) {
                const slugCard = slugMeta.closest('.slug-card');
                if (slugCard) slugCard.dataset.hasMeta = 'true';
                slugMeta.style.display = '';
                if (cover) {
                    if (coverUrl) { cover.src = coverUrl; cover.style.display = ''; }
                    else { cover.removeAttribute('src'); cover.style.display = 'none'; }
                }
                if (titleEl) {




                    const slugFallback = generateTitleFromSlug(slug);
                    const finalTitle = detectedTitle || slugFallback;
                    const looksRedundant = !detectedTitle
                        || detectedTitle.toLowerCase().replace(/\s+/g, '-') === slug.toLowerCase();
                    if (looksRedundant) {
                        titleEl.textContent = '';
                        titleEl.style.display = 'none';
                    } else {
                        titleEl.textContent = finalTitle;
                        titleEl.style.display = '';
                    }
                }
                if (statsEl) {
                    const parts = [];
                    if (availableTotal) parts.push(`<span>${availableTotal} eps</span>`);
                    // Anime broadcast status (about the SHOW, not your progress).
                    if (status === 'RELEASING') parts.push(`<span class="stat-airing">⬤ Airing</span>`);
                    else if (status === 'FINISHED') parts.push(`<span class="stat-finished">Finished airing</span>`);
                    // YOUR progress for this anime, if it's already in the library.
                    const tracked = AT.PopupState.animeData?.[slug];
                    const watchedNums = (tracked && Array.isArray(tracked.episodes))
                        ? tracked.episodes.map(ep => ep && ep.number).filter(n => Number.isFinite(n)).sort((a, b) => a - b)
                        : [];
                    if (watchedNums.length > 0) {
                        parts.push(`<span class="stat-watched">✓ Watched ${AT.EpisodeParse.buildRangeString(watchedNums)}</span>`);
                    }
                    statsEl.innerHTML = parts.join(' · ');
                }
            } else {
                const slugCard = slugMeta.closest('.slug-card');
                if (slugCard) slugCard.dataset.hasMeta = 'false';
                slugMeta.style.display = 'none';
            }
        }


        const hasUsefulData = (episodeTypes && !episodeTypes.notFound)
            || (animeInfoFromCache && !animeInfoFromCache.notFound);
        _setSlugStatus(hasUsefulData ? 'ok' : (episodeTypes === null && !animeInfoFromCache ? 'idle' : 'fail'));


        {
            const cachedAnilist = AT.AnilistService.cache?.[slug];
            AT.PopupState.addDialogDetectedTitle = animeInfoFromCache?.title
                || (cachedAnilist && !cachedAnilist.notFound && cachedAnilist.title)
                || null;
        }

        if (elements.episodesWatchedInput.value) {
            updateEpisodesPreview(elements.episodesWatchedInput.value);
        }
    }

    function hideAddAnimeDialog() {
        closeDialogA11y(elements.addAnimeDialog);
    }

    function syncWatchlistFromPopup(slug, watchlistType) {
        try {
            const siteId = AT.PopupState.animeData[slug]?.siteAnimeId;
            if (siteId) {

                chrome.runtime.sendMessage(
                    { type: 'WATCHLIST_SYNC', animeId: siteId, watchlistType, animeSlug: slug },
                    () => { if (chrome.runtime.lastError) {              } }
                );
                PopupLogger.debug('WatchlistSync', `sent ${watchlistType} for #${siteId}`);
            } else {

                PopupLogger.debug('WatchlistSync', `fetching siteAnimeId for ${slug}...`);
                chrome.runtime.sendMessage(
                    { type: 'FETCH_ANIME_INFO', slug },
                    (response) => {
                        if (chrome.runtime.lastError) return;
                        const fetchedId = response?.info?.siteAnimeId;
                        if (fetchedId) {

                            if (AT.PopupState.animeData[slug]) AT.PopupState.animeData[slug].siteAnimeId = fetchedId;

                            chrome.runtime.sendMessage(
                                { type: 'WATCHLIST_SYNC', animeId: fetchedId, watchlistType, animeSlug: slug },
                                () => { if (chrome.runtime.lastError) {              } }
                            );
                            PopupLogger.debug('WatchlistSync', `fetched #${fetchedId}, sent ${watchlistType}`);

                            AT.Storage.set({ animeData: AT.PopupState.animeData }).catch(() => {});
                        } else {
                            PopupLogger.debug('WatchlistSync', `could not find siteAnimeId for ${slug}`);
                        }
                    }
                );
            }
        } catch (e) {
            PopupLogger.warn('WatchlistSync', 'popup error:', e.message);
        }
    }

    async function addAnimeWithEpisodes() {
        const { Storage, FirebaseSync, SeasonGrouping } = AT;
        const slugInput = elements.animeSlugInput.value;
        const slug = extractSlugFromInput(slugInput);



        const detectedTitle = AT.PopupState.addDialogDetectedTitle && AT.PopupState.addDialogDetectedTitle.trim();
        const title = detectedTitle || generateTitleFromSlug(slug);
        const episodesRawInput = elements.episodesWatchedInput.value.trim();

        if (!slug) {
            elements.animeSlugInput.classList.add('error');
            elements.animeSlugInput.focus();
            return;
        }
        elements.animeSlugInput.classList.remove('error');

        if (!episodesRawInput) {
            elements.episodesWatchedInput.classList.add('error');
            elements.episodesWatchedInput.focus();
            return;
        }

        const allParsedEpisodes = parseEpisodeRanges(episodesRawInput);
        const includeFillers = document.getElementById('includeFillers')?.checked || false;
        const { canon } = splitCanonAndFillers(slug, allParsedEpisodes);
        const episodeNumbers = includeFillers ? allParsedEpisodes : canon;

        if (episodeNumbers.length === 0) {
            elements.episodesWatchedInput.classList.add('error');
            elements.episodesWatchedInput.focus();
            return;
        }
        elements.episodesWatchedInput.classList.remove('error');





        elements.confirmAddAnime.disabled = true;
        elements.confirmAddAnime.dataset.state = 'loading';

        try {
            const now = new Date().toISOString();
            const isMovie = SeasonGrouping.isMovie(slug, { title });
            const defaultDuration = isMovie ? 0 : 1440;
            const resumedFromHold = !!(
                AT.PopupState.animeData[slug]
                && (AT.PopupState.animeData[slug].onHoldAt || AT.PopupState.animeData[slug].listState === 'on_hold')
            );



            let inferredDuration = defaultDuration;
            if (AT.PopupState.animeData[slug]) {
                const realDurs = (AT.PopupState.animeData[slug].episodes || [])
                    .filter(ep => ep?.durationSource === 'video' && Number(ep.duration) > 0)
                    .map(ep => Number(ep.duration))
                    .sort((a, b) => a - b);
                if (realDurs.length > 0) {
                    inferredDuration = realDurs[Math.floor(realDurs.length / 2)];
                }
            }
            const episodes = episodeNumbers.map(num => ({ number: num, duration: inferredDuration, watchedAt: now }));

            if (AT.PopupState.animeData[slug]) {
                const existingEpisodes = AT.PopupState.animeData[slug].episodes || [];
                const existingByNumber = new Map(existingEpisodes.map(ep => [ep.number, ep]));
                for (const ep of episodes) {
                    const existing = existingByNumber.get(ep.number);
                    if (!existing) {
                        existingEpisodes.push(ep);
                    } else if (existing.durationSource === 'anilist') {

                        const idx = existingEpisodes.indexOf(existing);
                        existingEpisodes[idx] = { ...existing, watchedAt: now, duration: inferredDuration, durationSource: 'manual' };
                    }
                }
                existingEpisodes.sort((a, b) => a.number - b.number);
                AT.PopupState.animeData[slug].episodes = existingEpisodes;
                AT.PopupState.animeData[slug].totalWatchTime = existingEpisodes.reduce((sum, ep) => sum + (ep.duration || 0), 0);
                AT.PopupState.animeData[slug].lastWatched = now;
                if (resumedFromHold) {
                    setManualListState(AT.PopupState.animeData[slug], 'active', now);
                }
            } else {
                AT.PopupState.animeData[slug] = {
                    title, slug, episodes,
                    totalWatchTime: episodes.reduce((sum, ep) => sum + (ep.duration || 0), 0),
                    lastWatched: now, totalEpisodes: null
                };




            }

            const deletedResult = await Storage.get(['deletedAnime']);
            const deletedAnime = clearDeletedAnimeSlug(deletedResult.deletedAnime || {}, slug);
            const dataToSave = { animeData: AT.PopupState.animeData, videoProgress: AT.PopupState.videoProgress, deletedAnime };
            const user = FirebaseSync.getUser();
            if (user) dataToSave.userId = user.uid;
            markInternalSave(dataToSave);
            await Storage.set(dataToSave);
            if (resumedFromHold) {
                syncWatchlistFromPopup(slug, 'watching');
            }

            renderAnimeList(elements.searchInput?.value || '');
            updateStats();


            elements.confirmAddAnime.dataset.state = 'success';
            setTimeout(() => {
                hideAddAnimeDialog();


                if (elements.confirmAddAnime) {
                    elements.confirmAddAnime.dataset.state = 'idle';
                    elements.confirmAddAnime.disabled = false;
                }
            }, 800);




            const isPlaceholderDur = window.AnimeTrackerMergeUtils?.isPlaceholderDuration
                || ((d) => { const v = Number(d) || 0; return v <= 0 || v === 1440 || v === 6000 || v === 7200; });
            const hasPlaceholderDuration = Array.isArray(AT.PopupState.animeData[slug].episodes)
                && AT.PopupState.animeData[slug].episodes.some(ep => isPlaceholderDur(ep?.duration));
            if (!AT.PopupState.animeData[slug].coverImage || hasPlaceholderDuration) {
                chrome.runtime.sendMessage(
                    { type: 'BATCH_FETCH_ANIME_INFO', slugs: [slug] },
                    () => { if (chrome.runtime.lastError) {              } }
                );
            }

            if (user) {
                (async () => {
                    const gcRes = await Storage.get(['groupCoverImages']);
                    await FirebaseSync.saveToCloud({
                        animeData,
                        videoProgress,
                        deletedAnime,
                        groupCoverImages: gcRes.groupCoverImages || {}
                    });
                })().catch(err => PopupLogger.error('AddAnime', 'Cloud save error:', err));
            }
        } catch (error) {
            PopupLogger.error('AddAnime', 'Error:', error);
            showToast('Failed to add anime. Please try again.', 'error');

            elements.confirmAddAnime.disabled = false;
            elements.confirmAddAnime.dataset.state = 'idle';
        }
    }

    function showEditTitleDialog(slug) {
        if (!AT.PopupState.animeData[slug]) { PopupLogger.warn('EditTitle', 'Anime not found:', slug); return; }
        editingSlug = slug;
        elements.editTitleInput.value = AT.PopupState.animeData[slug].title || '';
        openDialogA11y(elements.editTitleDialog, {
            initialFocus: elements.editTitleInput,
            onCancel: hideEditTitleDialog
        });

        try { elements.editTitleInput.select(); } catch {}
    }

    function hideEditTitleDialog() {
        closeDialogA11y(elements.editTitleDialog);
        editingSlug = null;
    }

    async function saveEditedTitle() {
        const { Storage, FirebaseSync } = AT;
        if (!editingSlug || !AT.PopupState.animeData[editingSlug]) { hideEditTitleDialog(); return; }

        const newTitle = elements.editTitleInput.value.trim();
        const currentTitle = AT.PopupState.animeData[editingSlug].title || '';
        if (newTitle === '' || newTitle === currentTitle) { hideEditTitleDialog(); return; }

        try {
            markTitleEdited(AT.PopupState.animeData[editingSlug], newTitle);
            const deletedResult = await Storage.get(['deletedAnime']);
            const deletedAnime = clearDeletedAnimeSlug(deletedResult.deletedAnime || {}, editingSlug);
            const dataToSave = { animeData: AT.PopupState.animeData, videoProgress: AT.PopupState.videoProgress, deletedAnime };
            const user = FirebaseSync.getUser();
            if (user) dataToSave.userId = user.uid;
            markInternalSave(dataToSave);
            await Storage.set(dataToSave);
            renderAnimeList(elements.searchInput?.value || '');

            if (user) {
                (async () => {
                    const gcRes = await Storage.get(['groupCoverImages']);
                    await FirebaseSync.saveToCloud({
                        animeData,
                        videoProgress,
                        deletedAnime,
                        groupCoverImages: gcRes.groupCoverImages || {}
                    });
                })().catch(err => PopupLogger.error('EditTitle', 'Cloud save error:', err));
            }
            hideEditTitleDialog();
            try { AT.UIHelpers?.showToast?.('Title updated', { type: 'success' }); } catch {}
        } catch (error) {
            PopupLogger.error('EditTitle', 'Error:', error);
            try { AT.UIHelpers?.showToast?.('Failed to update title', { type: 'error', duration: 3500 }); }
            catch { showToast('Failed to update title. Please try again.', 'error'); }
        }
    }

    function editAnimeTitle(slug) { showEditTitleDialog(slug); }

    async function fetchFillerForAnime(slug, btn) {
        const { FillerService } = AT;
        if (btn) { btn.disabled = true; btn.textContent = '...'; }
        try {
            const episodeTypes = await FillerService.fetchEpisodeTypes(slug);
            if (episodeTypes) {
                FillerService.updateFromEpisodeTypes(slug, episodeTypes);
                renderAnimeList(elements.searchInput?.value || '');
                updateStats();
            }
        } catch (error) {
            PopupLogger.error('FetchFiller', 'Error:', error);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '🎭'; }
        }
    }

    AT.AddAnimeDialog = {
        _init(d) {
            elements = d.elements;
            markInternalSave = d.markInternalSave;
            renderAnimeList = d.renderAnimeList;
            updateStats = d.updateStats;
        },
        showAddAnimeDialog, onSlugInputChange, hideAddAnimeDialog, syncWatchlistFromPopup,
        addAnimeWithEpisodes, showEditTitleDialog, hideEditTitleDialog, saveEditedTitle,
        editAnimeTitle, fetchFillerForAnime
    };
})();
