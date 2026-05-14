/**
 * Anime Tracker — Status resolver + small data mutations (pure helpers)
 *
 * Extracted from main.js to make these pure functions independently
 * testable. They DO depend on `window.AnimeTracker.{FillerService,
 * SeasonGrouping, AnilistService, CONFIG}` for status classification, but
 * they don't reach into popup-local closure state (animeData/videoProgress)
 * — callers pass in the entries they want classified.
 *
 * Exposes `window.AnimeTracker.StatusService`:
 *   - `AnimeStatus`               — string constants (WATCHING, COMPLETED, ...)
 *   - `getStatus(slug, anime)`    — classify one anime entry
 *   - `isCompleted(slug, anime)`  — boolean shortcut
 *   - `getCalendarDayDiff(iso)`   — calendar-day delta (UTC-safe)
 *   - `repairAiringCompleted(data, options)` — rescue mis-flagged airing anime
 *   - `setManualListState(entry, state, at)` — write list-state + timestamps
 *   - `markTitleEdited(entry, title, at)`    — explicit title change
 *   - `clearDeletedAnimeSlug(deletedAnime, slug)` — drop a tombstone (immutable)
 */
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
        // Use UTC midnight to avoid DST drift: the day-clock shifts by 1h
        // twice a year and a plain `(midnightA - midnightB) / 86400000`
        // would round to ±1 day on those days. UTC has fixed-length days.
        const nowUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        const targetUtc = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
        return Math.round((nowUtc - targetUtc) / 86400000);
    }

    /**
     * Unified anime status resolver. Replaces the old
     * isAnimeCompleted / isAgedCompleted / isCaughtUpAiring trio.
     * Returns one of AnimeStatus.{WATCHING|COMPLETED|AIRING|DROPPED|ON_HOLD}.
     */
    function getStatus(slug, anime) {
        const AT = window.AnimeTracker;
        const { FillerService, SeasonGrouping, AnilistService, CONFIG } = AT;
        if (!anime) return AnimeStatus.WATCHING;
        const listState = String(anime.listState || '').toLowerCase();

        // ── On Hold ─────────────────────────────────────────────────────────
        if (anime.onHoldAt || listState === AnimeStatus.ON_HOLD) return AnimeStatus.ON_HOLD;

        // ── Dropped ─────────────────────────────────────────────────────────
        if (anime.droppedAt || listState === AnimeStatus.DROPPED) return AnimeStatus.DROPPED;

        const watchedCount = anime.episodes?.length || 0;
        const lowerSlug = slug.toLowerCase();
        const anilistStatus = AnilistService?.getStatus(lowerSlug);
        const latestAvailable = AnilistService?.getLatestEpisode(lowerSlug);
        const metaTotal = AnilistService?.getTotalEpisodes(lowerSlug);
        const isPartiallyUploaded = metaTotal && latestAvailable && latestAvailable < metaTotal;
        const looksLikeStandaloneSpecial = /(?:^|-)special(?:-|$)|(?:^|-)ova(?:-|$)|(?:^|-)ona(?:-|$)|(?:^|-)fan-letter(?:-|$)/i.test(lowerSlug);

        // ── Completion checks ───────────────────────────────────────────────
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
                // Total unknown: don't auto-complete, let user decide
                isComplete = false;
            } else if (anilistStatus === 'FINISHED' && progressData.total != null) {
                const highestEp = Math.max(0, ...(anime.episodes || []).map(ep => Number(ep.number) || 0));
                if (highestEp >= progressData.total && !isPartiallyUploaded) isComplete = true;
            }
        }

        if (isComplete) {
            // Decide whether to show in completed section (aged) or still in main list
            const isAged =
                anime.completedAt ||
                listState === AnimeStatus.COMPLETED ||
                SeasonGrouping.isMovie(slug, anime) ||
                anilistStatus === 'FINISHED' ||
                getCalendarDayDiff(anime?.lastWatched) >= CONFIG.COMPLETED_LIST_MIN_DAYS;

            return isAged ? AnimeStatus.COMPLETED : AnimeStatus.WATCHING;
        }

        // ── Caught up with airing ───────────────────────────────────────────
        if (watchedCount > 0 && !anime.completedAt && listState !== AnimeStatus.COMPLETED && latestAvailable > 0) {
            const highestWatched = Math.max(0, ...(anime.episodes || []).map(ep => Number(ep.number) || 0));

            if (anilistStatus === 'RELEASING' && highestWatched >= latestAvailable) {
                return AnimeStatus.AIRING;
            }
            if (anilistStatus === 'FINISHED' && isPartiallyUploaded && highestWatched >= latestAvailable) {
                return AnimeStatus.AIRING;
            }
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

    function setManualListState(entry, state, at = new Date().toISOString()) {
        if (!entry) return;
        entry.listState = state;
        entry.listStateUpdatedAt = at;

        if (state === 'completed') {
            entry.completedAt = entry.completedAt || at;
            delete entry.droppedAt;
            delete entry.onHoldAt;
            return;
        }

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

        // active — clear all
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
        const localTotal = Number(anime?.totalEpisodes) || 0;
        const cachedTotal = Number(
            AT.AnilistService?.getTotalEpisodes(String(slug || '').toLowerCase())
        ) || 0;
        return Math.max(localTotal, cachedTotal, 0);
    }

    /**
     * Rescue anime that look "completed" locally but the source is still
     * releasing AND we know there are more episodes available than the user
     * has watched. Flips them back to active so they don't get filed under
     * "Completed list" prematurely.
     */
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

            const watchedCount = Array.isArray(anime.episodes) ? anime.episodes.length : 0;
            if (watchedCount <= 0) continue;

            const lowerSlug = String(slug || '').toLowerCase();
            const anilistStatus = AT.AnilistService?.getStatus(lowerSlug);
            if (anilistStatus !== 'RELEASING') continue;

            const knownTotal = getKnownTotalEpisodesForRepair(lowerSlug, anime);
            if (knownTotal <= watchedCount) continue;

            setManualListState(anime, 'active', new Date().toISOString());
            changed = true;
        }

        return changed;
    }

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.StatusService = {
        AnimeStatus,
        getStatus,
        isCompleted,
        getCalendarDayDiff,
        getKnownTotalEpisodesForRepair,
        repairAiringCompleted,
        setManualListState,
        markTitleEdited,
        clearDeletedAnimeSlug
    };
})();
