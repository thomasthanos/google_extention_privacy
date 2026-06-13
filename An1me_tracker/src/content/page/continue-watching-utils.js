(function () {
    'use strict';

    // Continue-watching pure helpers: turn stored progress/anime data into display items.
    // No DOM, no module state. Exposed via window.AnimeTrackerContent.CWUtils.
    const WATCH_BASE = 'https://an1me.to/watch/';
    const MAX_ITEMS = 20;

    function isContextValid() {
        try { return !!(chrome.runtime && chrome.runtime.id); }
        catch { return false; }
    }


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


        const pagePath = (entry && typeof entry.pagePath === 'string') ? entry.pagePath.trim() : '';
        if (pagePath) return WATCH_BASE + pagePath;
        return `${WATCH_BASE}${slug}-episode-${episode}`;
    }


    function isHardInactive(anime) {
        if (!anime) return false;
        return anime.droppedAt
            || anime.onHoldAt
            || anime.listState === 'dropped'
            || anime.listState === 'on_hold';
    }

    function computeNextEpisodeUrl(anime, slug, episode, animeInfo) {
        if (!anime) return null;

        if (isHardInactive(anime)) return null;

        const next = episode + 1;
        const latestEp = Number(animeInfo && animeInfo.latestEpisode) || Number(anime.latestEpisode) || 0;
        const totalEp = Number(animeInfo && animeInfo.totalEpisodes) || Number(anime.totalEpisodes) || 0;
        const status = String((animeInfo && animeInfo.status) || anime.status || '').toUpperCase();
        const hasFutureRelease = !!((animeInfo && animeInfo.nextEpisodeAt) || anime.nextEpisodeAt);

        let available = false;
        if (latestEp >= next) {
            available = true;
        } else if (!hasFutureRelease && totalEp >= next && (latestEp === 0 || status === 'FINISHED')) {


            available = true;
        }
        if (!available) return null;

        return `${WATCH_BASE}${slug}-episode-${next}`;
    }

    // A "Start" card is a NEW episode when the anime is still airing and only a few
    // fresh episodes exist beyond the user's highest watched — i.e. they were caught
    // up and a new drop appeared. Drives the "New Episode" tag on the page widget.
    function isNewEpisodeStart(anime, animeInfo, highestWatched, maxGap = 3) {
        const latestEp = Number((animeInfo && animeInfo.latestEpisode) || (anime && anime.latestEpisode)) || 0;
        const totalEp = Number((animeInfo && animeInfo.totalEpisodes) || (anime && anime.totalEpisodes)) || 0;
        const status = String((animeInfo && animeInfo.status) || (anime && anime.status) || '').toUpperCase();
        const partiallyUploaded = totalEp > 0 && latestEp > 0 && latestEp < totalEp;
        if (latestEp <= 0 || (status !== 'RELEASING' && !partiallyUploaded)) return false;
        const freshGap = latestEp - Number(highestWatched || 0);
        return freshGap >= 1 && freshGap <= maxGap;
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

    function getWatchedEpisodeNumbers(anime) {
        return (anime && Array.isArray(anime.episodes) ? anime.episodes : [])
            .filter((ep) => !ep || ep.durationSource !== 'anilist')
            .map((ep) => Number(ep && ep.number))
            .filter((n) => Number.isFinite(n) && n > 0);
    }

    function buildItems(videoProgress, animeData, animeInfoBySlug) {
        const bySlug = new Map();

        const addItem = (item) => {
            const existing = bySlug.get(item.slug);
            if (!existing) {
                bySlug.set(item.slug, item);
                return;
            }
            if (!item.isStart && existing.isStart) {
                bySlug.set(item.slug, item);
            } else if (item.isStart && !existing.isStart) {
                // keep existing in-progress card
            } else {
                if (item.savedAt > existing.savedAt) {
                    bySlug.set(item.slug, item);
                }
            }
        };

        for (const [key, entry] of Object.entries(videoProgress || {})) {
            if (key === '__slugIndex' || !entry || entry.deleted) continue;
            const parsed = parseProgressKey(key);
            if (!parsed) continue;
            const { slug, episode } = parsed;

            const anime = (animeData && animeData[slug]) || null;
            // Dropped / on-hold anime must never appear in Continue Watching, even
            // when an in-progress (<85%) episode still has saved progress. The
            // animeData loop below already guards this; the progress loop must too.
            if (isHardInactive(anime)) continue;
            const animeInfo = (animeInfoBySlug && animeInfoBySlug[slug]) || null;

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

            const COMPLETED_PERCENTAGE = 85;
            if (percentage >= COMPLETED_PERCENTAGE) {
                const watchedNumbers = getWatchedEpisodeNumbers(anime);
                const maxKnownWatched = watchedNumbers.length ? Math.max(...watchedNumbers) : 0;
                const baseEpisode = Math.max(episode, maxKnownWatched);
                const nextUrl = computeNextEpisodeUrl(anime, slug, baseEpisode, animeInfo);
                if (nextUrl) {
                    const nextEpisode = baseEpisode + 1;
                    const newEp = isNewEpisodeStart(anime, animeInfo, baseEpisode);
                    addItem({
                        slug,
                        episode: nextEpisode,
                        percentage: 0,
                        savedAt,
                        title,
                        cover: safeCover(entry.coverImage) || safeCover(anime && anime.coverImage),
                        subline: `Ep ${nextEpisode} · ${newEp ? 'New Episode' : 'Start'}`,
                        url: nextUrl,
                        nextUrl: computeNextEpisodeUrl(anime, slug, nextEpisode, animeInfo),
                        nextNumber: nextEpisode + 1,
                        isStart: true,
                        isNewEpisode: newEp
                    });
                }
            } else {
                addItem({
                    slug, episode, percentage, savedAt, title,
                    cover: safeCover(entry.coverImage) || safeCover(anime && anime.coverImage),
                    subline: formatSubline(episode, currentTime, duration, percentage),
                    url: resumeUrl(slug, episode, entry),
                    nextUrl: computeNextEpisodeUrl(anime, slug, episode, animeInfo),
                    nextNumber: episode + 1,
                    isStart: false
                });
            }
        }

        for (const [slug, anime] of Object.entries(animeData || {})) {
            if (!anime || !anime.episodes || anime.episodes.length === 0) continue;

            if (isHardInactive(anime)) continue;

            const watchedEpisodeNumbers = getWatchedEpisodeNumbers(anime);
            if (watchedEpisodeNumbers.length === 0) continue;

            const maxCompleted = Math.max(...watchedEpisodeNumbers);
            const animeInfo = (animeInfoBySlug && animeInfoBySlug[slug]) || null;
            const nextUrl = computeNextEpisodeUrl(anime, slug, maxCompleted, animeInfo);
            if (nextUrl) {
                const nextEpisode = maxCompleted + 1;
                const newEp = isNewEpisodeStart(anime, animeInfo, maxCompleted);
                const savedAt = anime.lastWatched ? new Date(anime.lastWatched).getTime() : 0;
                const title = (typeof anime.title === 'string' && anime.title.trim())
                    ? anime.title.trim()
                    : humanizeSlug(slug);

                addItem({
                    slug,
                    episode: nextEpisode,
                    percentage: 0,
                    savedAt,
                    title,
                    cover: safeCover(anime.coverImage),
                    subline: `Ep ${nextEpisode} · ${newEp ? 'New Episode' : 'Start'}`,
                    url: nextUrl,
                    nextUrl: computeNextEpisodeUrl(anime, slug, nextEpisode, animeInfo),
                    nextNumber: nextEpisode + 1,
                    isStart: true,
                    isNewEpisode: newEp
                });
            }
        }

        return [...bySlug.values()]
            .sort((a, b) => b.savedAt - a.savedAt)
            .slice(0, MAX_ITEMS);
    }

    window.AnimeTrackerContent = window.AnimeTrackerContent || {};
    window.AnimeTrackerContent.CWUtils = { isContextValid, parseProgressKey, buildItems };
})();
