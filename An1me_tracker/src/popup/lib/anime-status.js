


(function () {
    'use strict';

    const AnimeStatus = Object.freeze({
        WATCHING: 'watching',
        COMPLETED: 'completed',
        AIRING: 'airing',
        DROPPED: 'dropped',
        ON_HOLD: 'on_hold'
    });

    function getCalendarDayDiff(isoString) {
        if (!isoString) return 0;
        const target = new Date(isoString);
        if (isNaN(target.getTime())) return 0;
        const now = new Date();


        const nowUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        const targetUtc = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
        return Math.round((nowUtc - targetUtc) / 86400000);
    }


    function getStatus(slug, anime) {
        const AT = window.AnimeTracker;
        const { FillerService, SeasonGrouping, AnilistService, CONFIG } = AT;
        if (!anime) return AnimeStatus.WATCHING;
        const listState = String(anime.listState || '').toLowerCase();


        if (anime.onHoldAt || listState === AnimeStatus.ON_HOLD) return AnimeStatus.ON_HOLD;


        if (anime.droppedAt || listState === AnimeStatus.DROPPED) return AnimeStatus.DROPPED;

        const watchedCount = anime.episodes?.length || 0;
        const lowerSlug = slug.toLowerCase();
        const anilistStatus = AnilistService?.getStatus(lowerSlug);
        const latestAvailable = AnilistService?.getLatestEpisode(lowerSlug);
        const metaTotal = AnilistService?.getTotalEpisodes(lowerSlug);
        const isPartiallyUploaded = metaTotal && latestAvailable && latestAvailable < metaTotal;
        const looksLikeStandaloneSpecial = /(?:^|-)special(?:-|$)|(?:^|-)ova(?:-|$)|(?:^|-)ona(?:-|$)|(?:^|-)fan-letter(?:-|$)/i.test(lowerSlug);


        let isComplete = false;

        if (watchedCount === 0) {
            isComplete = false;
        } else if (anime.completedAt || listState === AnimeStatus.COMPLETED) {
            isComplete = true;
        } else if (SeasonGrouping.isMovie(slug, anime)) {
            isComplete = true;
        } else {
            const progressData = FillerService.calculateProgress(watchedCount, slug, anime);

            if (progressData.progress >= 100 && !isPartiallyUploaded) {
                isComplete = true;
            } else if (
                watchedCount === 1 &&
                !isPartiallyUploaded &&
                (
                    metaTotal === 1 ||
                    latestAvailable === 1 ||
                    (anilistStatus === 'FINISHED' && looksLikeStandaloneSpecial)
                )
            ) {
                isComplete = true;
            } else if (anilistStatus === 'FINISHED' && progressData.total == null && !isPartiallyUploaded) {

                isComplete = false;
            } else if (anilistStatus === 'FINISHED' && progressData.total != null) {
                const highestEp = Math.max(0, ...(anime.episodes || []).map(ep => Number(ep.number) || 0));
                if (highestEp >= progressData.total && !isPartiallyUploaded) isComplete = true;
            }
        }

        if (isComplete) {

            const isAged =
                anime.completedAt ||
                listState === AnimeStatus.COMPLETED ||
                SeasonGrouping.isMovie(slug, anime) ||
                anilistStatus === 'FINISHED' ||
                getCalendarDayDiff(anime?.lastWatched) >= CONFIG.COMPLETED_LIST_MIN_DAYS;

            return isAged ? AnimeStatus.COMPLETED : AnimeStatus.WATCHING;
        }


        if (watchedCount > 0 && !anime.completedAt && listState !== AnimeStatus.COMPLETED && latestAvailable > 0) {
            const highestWatched = Math.max(0, ...(anime.episodes || []).map(ep => Number(ep.number) || 0));

            if (anilistStatus === 'RELEASING' && highestWatched >= latestAvailable) {
                return AnimeStatus.AIRING;
            }
            if (anilistStatus === 'FINISHED' && isPartiallyUploaded && highestWatched >= latestAvailable) {
                return AnimeStatus.AIRING;
            }
        }

        // Fallback: releasing show with a scheduled next episode but no parsed
        // latest-episode count (An1me scrape didn't yield one). A viewer who has
        // watched episodes is treated as caught-up/airing rather than plain watching.
        if (watchedCount > 0 && !anime.completedAt && listState !== AnimeStatus.COMPLETED
            && anilistStatus === 'RELEASING' && !(latestAvailable > 0)
            && AnilistService?.getNextEpisodeAt(lowerSlug)) {
            return AnimeStatus.AIRING;
        }

        return AnimeStatus.WATCHING;
    }

    function isCompleted(slug, anime) {
        const AT = window.AnimeTracker;
        const status = getStatus(slug, anime);
        return status === AnimeStatus.COMPLETED || !!(
            anime?.completedAt ||
            (anime?.episodes?.length > 0 && AT.SeasonGrouping.isMovie(slug, anime))
        );
    }

    // For a still-releasing (or partially-uploaded) anime the user has essentially
    // caught up on, returns how many fresh episodes are now available beyond their
    // highest watched (plus the latest episode number); otherwise null. Drives the
    // "New Episode" badge. Gated to a small gap (default 3) so it fires for a recent
    // drop, not for a show the user is actively far behind on.
    function getNewEpisodeInfo(slug, anime, maxGap = 3) {
        const AT = window.AnimeTracker;
        const { AnilistService } = AT;
        if (!anime || !slug) return null;

        const listState = String(anime.listState || '').toLowerCase();
        if (anime.droppedAt || anime.onHoldAt ||
            listState === AnimeStatus.DROPPED || listState === AnimeStatus.ON_HOLD) return null;

        const lowerSlug = String(slug).toLowerCase();
        const status = AnilistService?.getStatus(lowerSlug);
        const latest = Number(AnilistService?.getLatestEpisode(lowerSlug)) || 0;
        const metaTotal = Number(AnilistService?.getTotalEpisodes(lowerSlug)) || 0;
        const partiallyUploaded = metaTotal > 0 && latest > 0 && latest < metaTotal;
        if (latest <= 0 || (status !== 'RELEASING' && !partiallyUploaded)) return null;

        const eps = Array.isArray(anime.episodes) ? anime.episodes : [];
        if (eps.length === 0) return null;
        const highestWatched = Math.max(0, ...eps.map(ep => Number(ep.number) || 0));

        const count = latest - highestWatched;
        if (count <= 0 || count > maxGap) return null;
        return { count, latest, highestWatched };
    }

    function setManualListState(entry, state, at = new Date().toISOString(), isManual = false) {
        if (!entry) return;
        entry.listState = state;
        entry.listStateUpdatedAt = at;

        if (state === 'completed') {
            entry.completedAt = entry.completedAt || at;
            if (isManual) {
                entry.manualComplete = true;
            } else {
                delete entry.manualComplete;
            }
            delete entry.droppedAt;
            delete entry.onHoldAt;
            return;
        }

        delete entry.manualComplete;

        if (state === 'dropped') {
            entry.droppedAt = entry.droppedAt || at;
            delete entry.completedAt;
            delete entry.onHoldAt;
            return;
        }

        if (state === 'on_hold') {
            entry.onHoldAt = entry.onHoldAt || at;
            delete entry.completedAt;
            delete entry.droppedAt;
            return;
        }


        delete entry.completedAt;
        delete entry.droppedAt;
        delete entry.onHoldAt;
    }

    function markTitleEdited(entry, title, at = new Date().toISOString()) {
        if (!entry) return;
        entry.title = title;
        entry.titleUpdatedAt = at;
    }

    function clearDeletedAnimeSlug(deletedAnime, slug) {
        const next = { ...(deletedAnime || {}) };
        if (slug && Object.prototype.hasOwnProperty.call(next, slug)) {
            delete next[slug];
        }
        return next;
    }

    function getKnownTotalEpisodesForRepair(slug, anime) {
        const AT = window.AnimeTracker;
        const cachedTotal = Number(
            AT.AnilistService?.getTotalEpisodes(String(slug || '').toLowerCase())
        ) || 0;
        if (cachedTotal > 0) return cachedTotal;
        const localTotal = Number(anime?.totalEpisodes) || 0;
        return Math.max(localTotal, 0);
    }


    function repairAiringCompleted(data, options = {}) {
        const AT = window.AnimeTracker;
        const targetData = data || {};
        const requestedSlugs = Array.isArray(options.slugs) ? options.slugs : null;
        const slugs = requestedSlugs && requestedSlugs.length
            ? requestedSlugs
            : Object.keys(targetData);
        let changed = false;

        for (const slug of slugs) {
            const anime = targetData?.[slug];
            if (!anime || anime.droppedAt || anime.onHoldAt) continue;

            const listState = String(anime.listState || '').toLowerCase();
            if (!anime.completedAt && listState !== 'completed') continue;
            if (AT.SeasonGrouping.isMovie(slug, anime)) continue;
            if (anime.manualComplete === true) continue;

            const watchedCount = Array.isArray(anime.episodes) ? anime.episodes.length : 0;
            if (watchedCount <= 0) continue;

            const lowerSlug = String(slug || '').toLowerCase();
            const anilistStatus = AT.AnilistService?.getStatus(lowerSlug);

            let shouldRevert = false;
            if (anilistStatus === 'RELEASING') {
                // An airing show must never stay stuck as "completed", regardless of
                // episode-count math — AniList may not know the full total yet, so the
                // knownTotal<=watchedCount guard below would wrongly keep it completed.
                shouldRevert = true;
            } else {
                // The canon-based completion verdict is unreliable until this anime's
                // filler list is loaded (KNOWN_FILLERS is populated async by the
                // background filler fetch). Deciding before it arrives, then re-deciding
                // after, flips completed↔active — and costs a full cloud write each
                // time. Defer until the filler data is loaded.
                if (!AT.FillerService?.episodeTypesCache?.[slug]) continue;
                const knownTotal = getKnownTotalEpisodesForRepair(lowerSlug, anime);
                if (knownTotal <= watchedCount) continue;
                // Decide via getStatus() (same source of truth persist uses), on a probe
                // with stored completion flags stripped so it doesn't short-circuit.
                const probe = { ...anime };
                delete probe.completedAt;
                delete probe.listState;
                delete probe.listStateUpdatedAt;
                if (getStatus(slug, probe) !== AnimeStatus.COMPLETED) {
                    shouldRevert = true;
                }
            }

            if (shouldRevert) {
                setManualListState(anime, 'active', new Date().toISOString());
                changed = true;
            }
        }

        return changed;
    }


    function persistDetectedCompletions(data, options = {}) {
        const AT = window.AnimeTracker;
        const targetData = data || {};
        const requestedSlugs = Array.isArray(options.slugs) ? options.slugs : null;
        const slugs = requestedSlugs && requestedSlugs.length
            ? requestedSlugs
            : Object.keys(targetData);
        let changed = false;

        for (const slug of slugs) {
            const anime = targetData[slug];
            if (!anime) continue;
            if (anime.droppedAt || anime.onHoldAt) continue;

            const listState = String(anime.listState || '').toLowerCase();
            if (anime.completedAt || listState === 'completed') continue;
            if (listState === 'dropped' || listState === 'on_hold') continue;


            const releaseStatus = AT.AnilistService?.getStatus(String(slug).toLowerCase());
            if (releaseStatus === 'RELEASING') continue;
            // Don't lock in a completion while the release status is still unknown
            // (An1me/AniList not fetched yet) — the show could be airing with more
            // episodes to come. Defer until we have data, so we never persist a
            // wrong completedAt that a later repair has to undo (which caused the
            // completed→airing flip on a second render). Movies/one-shots are
            // inherently finished, so they stay exempt.
            if (!releaseStatus && !AT.SeasonGrouping?.isMovie(slug, anime)) continue;

            // Same reason as repairAiringCompleted: don't lock a completion until the
            // filler list is loaded, otherwise the canon math flips it once the
            // background filler fetch lands → completed↔active churn + full writes.
            if (!AT.SeasonGrouping?.isMovie(slug, anime) && !AT.FillerService?.episodeTypesCache?.[slug]) continue;

            if (getStatus(slug, anime) !== AnimeStatus.COMPLETED) continue;

            setManualListState(anime, 'completed');
            changed = true;
        }

        return changed;
    }

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.StatusService = {
        AnimeStatus,
        getStatus,
        isCompleted,
        getNewEpisodeInfo,
        getCalendarDayDiff,
        getKnownTotalEpisodesForRepair,
        repairAiringCompleted,
        persistDetectedCompletions,
        setManualListState,
        markTitleEdited,
        clearDeletedAnimeSlug
    };
})();
