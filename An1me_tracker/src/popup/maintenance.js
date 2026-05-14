/**
 * Anime Tracker — Library maintenance ops (pure helpers)
 *
 * Extracted from main.js. These operate on plain data structures and
 * window.AnimeTracker.SeasonGrouping (for the movie heuristic). No popup
 * closure state — callers pass everything in and read what comes back.
 *
 * Exposes `window.AnimeTracker.Maintenance`:
 *   - `normalizeMovieDurations(data, progress)` — patch placeholder/legacy
 *     movie durations from the best available source (video progress, then
 *     totalWatchTime average, then legacy default).
 *   - `cleanupPhantomMovies(data, existingDeletedAnime)` — drop movies
 *     tracked accidentally (≤5 min watched, ≥1 day old) and tombstone them.
 */
(function () {
    'use strict';

    const MIN_RELIABLE_DURATION_SECONDS = 30 * 60;     // 30 min
    const MAX_RELIABLE_DURATION_SECONDS = 4 * 60 * 60; // 4 h — safe ceiling for any anime film
    const LEGACY_DEFAULT_MOVIE_DURATION_SECONDS = 100 * 60;

    const MAX_PHANTOM_WATCH_SECONDS = 5 * 60;
    const MIN_PHANTOM_AGE_MS = 24 * 60 * 60 * 1000;

    function normalizeMovieDurations(data, progress = {}) {
        const { SeasonGrouping } = window.AnimeTracker;
        let changed = false;
        let updatedEntries = 0;

        for (const [slug, anime] of Object.entries(data || {})) {
            if (!anime || !SeasonGrouping.isMovie(slug, anime)) continue;
            if (!Array.isArray(anime.episodes) || anime.episodes.length === 0) continue;

            const slugProgressDurations = Object.entries(progress || {})
                .filter(([key, entry]) => key.startsWith(`${slug}__episode-`) && !entry?.deleted)
                .map(([, entry]) => Number(entry?.duration) || 0)
                .filter((d) => d >= MIN_RELIABLE_DURATION_SECONDS && d <= MAX_RELIABLE_DURATION_SECONDS);
            const fallbackSlugDuration = slugProgressDurations.length > 0
                ? Math.min(Math.max(...slugProgressDurations), MAX_RELIABLE_DURATION_SECONDS)
                : 0;

            let entryChanged = false;
            anime.episodes = anime.episodes.map((ep) => {
                const episodeNum = Number(ep?.number) || 0;
                const currentDuration = Number(ep?.duration) || 0;
                const progressKey = `${slug}__episode-${episodeNum}`;
                const progressEntry = progress?.[progressKey];
                const exactProgressDuration = progressEntry?.deleted ? 0 : (Number(progressEntry?.duration) || 0);
                const progressDuration = exactProgressDuration || fallbackSlugDuration;
                const hasBetterProgressDuration =
                    progressDuration >= MIN_RELIABLE_DURATION_SECONDS &&
                    progressDuration <= MAX_RELIABLE_DURATION_SECONDS;
                const isLegacyDuration = window.AnimeTrackerMergeUtils?.PLACEHOLDER_DURATION_VALUES?.includes(currentDuration)
                    ?? (currentDuration === 1440 || currentDuration === 6000 || currentDuration === 7200);
                const isUnknownDuration = currentDuration <= 0;
                const isVideoMeasured = ep?.durationSource === 'video';

                let nextDuration = currentDuration;
                if (hasBetterProgressDuration && (isLegacyDuration || currentDuration < MIN_RELIABLE_DURATION_SECONDS)) {
                    nextDuration = progressDuration;
                } else if (isUnknownDuration && !isVideoMeasured) {
                    const fallbackFromTotal =
                        anime.episodes?.length > 0
                            ? Math.round((Number(anime.totalWatchTime) || 0) / anime.episodes.length)
                            : 0;
                    const hasValidFallbackFromTotal =
                        fallbackFromTotal >= MIN_RELIABLE_DURATION_SECONDS &&
                        fallbackFromTotal <= MAX_RELIABLE_DURATION_SECONDS;
                    nextDuration = hasValidFallbackFromTotal ? fallbackFromTotal : LEGACY_DEFAULT_MOVIE_DURATION_SECONDS;
                }

                if (nextDuration !== currentDuration) {
                    entryChanged = true;
                    return {
                        ...ep,
                        duration: nextDuration,
                        durationSource: hasBetterProgressDuration ? 'video' : (ep?.durationSource || 'legacy-estimate')
                    };
                }
                return ep;
            });

            if (!entryChanged) continue;
            anime.totalWatchTime = anime.episodes.reduce((sum, ep) => sum + (Number(ep?.duration) || 0), 0);
            changed = true;
            updatedEntries += 1;
        }

        return { changed, updatedEntries };
    }

    function cleanupPhantomMovies(data, existingDeletedAnime = {}) {
        const { SeasonGrouping } = window.AnimeTracker;
        const now = Date.now();
        const updatedDeletedAnime = { ...existingDeletedAnime };
        let changed = false;

        for (const [slug, anime] of Object.entries(data)) {
            if (!anime || !SeasonGrouping.isMovie(slug, anime)) continue;
            if ((Number(anime.totalWatchTime) || 0) > MAX_PHANTOM_WATCH_SECONDS) continue;
            const lastTouched = anime.lastWatched ? new Date(anime.lastWatched).getTime() : 0;
            if (!lastTouched || (now - lastTouched) < MIN_PHANTOM_AGE_MS) continue;

            delete data[slug];
            updatedDeletedAnime[slug] = { deletedAt: new Date().toISOString() };
            changed = true;
        }

        return { changed, deletedAnime: updatedDeletedAnime };
    }

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.Maintenance = {
        normalizeMovieDurations,
        cleanupPhantomMovies
    };
})();
