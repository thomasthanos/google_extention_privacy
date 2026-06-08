


(function () {
    'use strict';

    const MIN_RELIABLE_DURATION_SECONDS = 30 * 60;
    const MAX_RELIABLE_DURATION_SECONDS = 4 * 60 * 60;
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


    function scrubAnilistImportDates(data) {
        let changed = false;
        let scrubbedEpisodes = 0;
        const affectedAnime = [];

        for (const [slug, anime] of Object.entries(data || {})) {
            if (!anime || !Array.isArray(anime.episodes)) continue;
            let entryChanged = false;
            anime.episodes = anime.episodes.map((ep) => {
                if (ep && ep.durationSource === 'anilist' && ep.watchedAt != null) {
                    entryChanged = true;
                    scrubbedEpisodes++;
                    const { watchedAt: _drop, ...rest } = ep;
                    return rest;
                }
                return ep;
            });
            if (entryChanged) {
                changed = true;
                affectedAnime.push(slug);
            }
        }

        return { changed, scrubbedEpisodes, affectedAnime };
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


    function verifyHours(data) {
        data = data || (typeof window !== 'undefined' && window.AnimeTracker?.Storage?._cachedAnimeData) || null;


        if (!data) {
            return new Promise((resolve) => {
                try {
                    chrome.storage.local.get(['animeData'], (r) => resolve(verifyHours(r?.animeData || {})));
                } catch {
                    resolve(verifyHours({}));
                }
            });
        }

        let realEpisodes = 0, realSeconds = 0;
        let importEpisodes = 0, importSeconds = 0;
        let importEpisodesWithDates = 0;
        const byDay = new Map();
        const importDates = new Set();

        for (const slug in data) {
            const anime = data[slug];
            if (!anime || !Array.isArray(anime.episodes)) continue;
            for (const ep of anime.episodes) {
                const dur = Number(ep?.duration) || 0;
                const isImport = ep?.durationSource === 'anilist';
                if (isImport) {
                    importEpisodes++;
                    importSeconds += dur;
                    if (ep?.watchedAt) importEpisodesWithDates++;
                } else {
                    realEpisodes++;
                    realSeconds += dur;
                }
                if (!ep?.watchedAt) continue;
                const d = new Date(ep.watchedAt);
                if (!Number.isFinite(d.getTime())) continue;
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                if (isImport) importDates.add(key);
                let bucket = byDay.get(key);
                if (!bucket) { bucket = { episodes: 0, seconds: 0, importEpisodes: 0, importSeconds: 0 }; byDay.set(key, bucket); }
                bucket.episodes++;
                bucket.seconds += dur;
                if (isImport) { bucket.importEpisodes++; bucket.importSeconds += dur; }
            }
        }

        const topDays = Array.from(byDay.entries())
            .sort((a, b) => b[1].seconds - a[1].seconds)
            .slice(0, 10)
            .map(([day, b]) => ({
                day,
                minutes: Math.round(b.seconds / 60),
                episodes: b.episodes,
                fromImport: b.importEpisodes > 0
                    ? `${b.importEpisodes} ep / ${Math.round(b.importSeconds / 60)} min`
                    : '—'
            }));

        return {
            anime: Object.keys(data).length,
            realEpisodes,
            realHours: Math.round((realSeconds / 3600) * 10) / 10,
            importedEpisodes: importEpisodes,
            importedHours: Math.round((importSeconds / 3600) * 10) / 10,
            importedEpisodesStillCarryingBogusDates: importEpisodesWithDates,
            distinctImportDays: importDates.size,
            top10HeaviestDays: topDays
        };
    }

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.Maintenance = {
        normalizeMovieDurations,
        cleanupPhantomMovies,
        scrubAnilistImportDates,
        verifyHours
    };
})();
