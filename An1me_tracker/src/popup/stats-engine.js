(function () {
    'use strict';

    function dayKey(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function monthKey(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}`;
    }

    function parseDate(iso) {
        if (!iso) return null;
        const d = new Date(iso);
        return Number.isFinite(d.getTime()) ? d : null;
    }

    function daysBetween(aKey, bKey) {
        const [ay, am, ad] = aKey.split('-').map(Number);
        const [by, bm, bd] = bKey.split('-').map(Number);
        const a = Date.UTC(ay, am - 1, ad);
        const b = Date.UTC(by, bm - 1, bd);
        return Math.round((b - a) / 86400000);
    }

    let _cache = null;

    function signatureOf(animeData) {
        if (!animeData) return '0|0||';
        let slugs = 0;
        let eps = 0;
        let maxLast = '';
        let maxStateTs = '';
        for (const slug in animeData) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            const a = animeData[slug];
            if (!a) continue;
            slugs++;
            if (Array.isArray(a.episodes)) eps += a.episodes.length;
            if (a.lastWatched && a.lastWatched > maxLast) maxLast = a.lastWatched;
            const stateTs = a.listStateUpdatedAt || a.completedAt || a.droppedAt || a.onHoldAt || '';
            if (stateTs && stateTs > maxStateTs) maxStateTs = stateTs;
        }
        return `${slugs}|${eps}|${maxLast}|${maxStateTs}`;
    }

    function buildWatchIndex(animeData) {
        const sig = signatureOf(animeData);
        if (_cache && _cache.sig === sig) return _cache.index;

        const byDay = new Map();
        const byMonth = new Map();
        const perAnime = new Map();
        let totalEpisodes = 0;
        let totalSeconds = 0;

        for (const slug in animeData || {}) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            const anime = animeData[slug];
            if (!anime || !Array.isArray(anime.episodes)) continue;

            let first = null;
            let last = null;
            const days = new Set();

            for (const ep of anime.episodes) {
                const d = parseDate(ep?.watchedAt);
                if (!d) continue;
                const dk = dayKey(d);
                const mk = monthKey(d);
                const dur = Number(ep?.duration) || 0;

                totalEpisodes++;
                totalSeconds += dur;

                if (!first || d < first) first = d;
                if (!last || d > last) last = d;
                days.add(dk);

                let bucket = byDay.get(dk);
                if (!bucket) {
                    bucket = { episodes: 0, seconds: 0, animes: new Set() };
                    byDay.set(dk, bucket);
                }
                bucket.episodes++;
                bucket.seconds += dur;
                bucket.animes.add(slug);

                byMonth.set(mk, (byMonth.get(mk) || 0) + dur);
            }

            if (first && last) {
                const spanDays = Math.max(1, daysBetween(dayKey(first), dayKey(last)) + 1);
                const rate = anime.episodes.length / spanDays;
                perAnime.set(slug, {
                    firstWatchedAt: first.toISOString(),
                    lastWatchedAt: last.toISOString(),
                    watchedCount: anime.episodes.length,
                    distinctDays: days.size,
                    spanDays,
                    rateEpsPerDay: rate
                });
            }
        }

        const sortedDays = Array.from(byDay.keys()).sort();

        const index = {
            byDay,
            byMonth,
            perAnime,
            sortedDays,
            totals: {
                episodes: totalEpisodes,
                seconds: totalSeconds,
                animes: Object.keys(animeData || {}).length,
                activeDays: byDay.size
            },
            sig
        };

        _cache = { sig, index };
        return index;
    }

    function computeStreak(byDayOrIndex) {
        const byDay = byDayOrIndex?.byDay || byDayOrIndex;
        if (!byDay || byDay.size === 0) {
            return { currentStreak: 0, longestStreak: 0, lastWatchDay: null, brokenOn: null };
        }

        const todayKey = dayKey(new Date());
        const yesterdayKey = (() => {
            const d = new Date();
            d.setDate(d.getDate() - 1);
            return dayKey(d);
        })();

        const keys = Array.from(byDay.keys()).sort();
        const lastKey = keys[keys.length - 1];

        let longest = 1;
        let run = 1;
        for (let i = 1; i < keys.length; i++) {
            const gap = daysBetween(keys[i - 1], keys[i]);
            if (gap === 1) {
                run++;
                if (run > longest) longest = run;
            } else {
                run = 1;
            }
        }

        let current = 0;
        let brokenOn = null;
        if (lastKey === todayKey || lastKey === yesterdayKey) {
            current = 1;
            for (let i = keys.length - 2; i >= 0; i--) {
                const gap = daysBetween(keys[i], keys[i + 1]);
                if (gap === 1) current++;
                else break;
            }
        } else {
            const [ly, lm, ld] = lastKey.split('-').map(Number);
            const d = new Date(ly, lm - 1, ld);
            d.setDate(d.getDate() + 1);
            brokenOn = dayKey(d);
        }

        return {
            currentStreak: current,
            longestStreak: Math.max(longest, current),
            lastWatchDay: lastKey,
            brokenOn
        };
    }

    function predictCompletion(anime, index) {
        if (!anime || !Array.isArray(anime.episodes) || anime.episodes.length < 3) return null;

        const watchedSet = new Set(
            anime.episodes
                .map(ep => Number(ep?.number))
                .filter(n => Number.isFinite(n) && n > 0)
        );
        const watchedCount = watchedSet.size;
        if (watchedCount < 3) return null;

        const anilist = window.AnimeTracker?.AnilistService;
        const configuredTarget = Number(anime.targetEpisodes) || 0;
        const total = configuredTarget || Number(anime.totalEpisodes) || Number(anilist?.getTotalEpisodes?.(anime.slug)) || 0;
        const allowSingleEpisodeForecast = !!anime.allowSingleEpisodeForecast;
        if (!total) return null;

        const slug = anime.slug;
        const meta = index?.perAnime?.get(slug) || null;

        const byDay = new Map();
        let firstWatch = null;
        let mostRecentWatch = null;
        for (const ep of anime.episodes) {
            const d = parseDate(ep?.watchedAt);
            if (!d) continue;
            const dk = dayKey(d);
            byDay.set(dk, (byDay.get(dk) || 0) + 1);
            if (!firstWatch || d < firstWatch) firstWatch = d;
            if (!mostRecentWatch || d > mostRecentWatch) mostRecentWatch = d;
        }

        const countEpisodesInWindow = (days) => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            let count = 0;

            for (let i = 0; i < days; i++) {
                const d = new Date(today);
                d.setDate(today.getDate() - i);
                count += byDay.get(dayKey(d)) || 0;
            }

            return count;
        };

        const fallbackSpanDays = (firstWatch && mostRecentWatch)
            ? Math.max(1, daysBetween(dayKey(firstWatch), dayKey(mostRecentWatch)) + 1)
            : Math.max(3, Math.min(21, watchedCount));
        const fallbackDistinctDays = Math.max(1, byDay.size);
        const spanRate = meta?.rateEpsPerDay || (watchedCount / fallbackSpanDays);
        const distinctDays = meta?.distinctDays || fallbackDistinctDays;
        const activeDayRate = watchedCount / Math.max(1, distinctDays);
        const recent7Count = countEpisodesInWindow(7);
        const recent14Count = countEpisodesInWindow(14);
        const recent7Rate = recent7Count / 7;
        const recent14Rate = recent14Count / 14;

        let rate = (spanRate * 0.2) + (recent14Rate * 0.35) + (recent7Rate * 0.45);
        if (recent14Count === 0) {
            rate = (spanRate * 0.65) + (Math.min(activeDayRate, spanRate * 1.5) * 0.35);
        }
        if (!meta || distinctDays < 2) {
            const conservativeFallback = Math.min(2.5, Math.max(0.4, watchedCount / Math.max(7, fallbackSpanDays)));
            rate = Math.max(rate || 0, conservativeFallback);
        }

        if (mostRecentWatch) {
            const daysSinceLastWatch = Math.max(0, daysBetween(dayKey(mostRecentWatch), dayKey(new Date())));
            if (daysSinceLastWatch >= 7) rate *= 0.8;
            if (daysSinceLastWatch >= 14) rate *= 0.7;
        }

        rate = Math.max(rate, 1 / 45);
        if (!rate || !Number.isFinite(rate) || rate <= 0) return null;

        const remaining = Math.max(0, total - watchedCount);
        if (remaining <= 0 && !allowSingleEpisodeForecast) return null;
        let daysLeft = remaining / rate;
        if (remaining <= 0 && allowSingleEpisodeForecast) {
            daysLeft = Math.max(1 / rate, 0.25);
        }

        const anilistStatus = anilist?.getStatus?.(slug);
        const latestAvailable = Number(anilist?.getLatestEpisode?.(slug)) || 0;
        const releaseFloorDays = !configuredTarget && anilistStatus === 'RELEASING' && total > latestAvailable && latestAvailable > 0
            ? (total - latestAvailable) * 7
            : 0;

        daysLeft = Math.max(daysLeft, releaseFloorDays);
        if (!Number.isFinite(daysLeft) || daysLeft <= 0 || daysLeft > 365 * 10) return null;

        const eta = new Date();
        eta.setDate(eta.getDate() + Math.ceil(daysLeft));

        let confidence = 'low';
        if (distinctDays >= 6 && watchedCount >= 5 && recent14Count >= 3) confidence = 'medium';
        if (distinctDays >= 12 && watchedCount >= 10 && recent14Count >= 6) confidence = 'high';
        if (recent14Count === 0) confidence = 'low';
        if (!meta || distinctDays < 2) confidence = 'low';
        if (releaseFloorDays > 0 && confidence === 'high') confidence = 'medium';

        return {
            etaDate: eta,
            epsPerDay: rate,
            remaining,
            daysLeft: Math.ceil(daysLeft),
            confidence,
            model: remaining <= 0 && allowSingleEpisodeForecast
                ? 'next-drop-pace'
                : (releaseFloorDays > 0 ? 'release-aware' : (configuredTarget ? 'catch-up-aware' : 'pace-aware')),
            releaseFloorDays,
            recent7Rate,
            recent14Rate,
            spanRate
        };
    }

    function windowStats(index, days = 7) {
        const out = {
            episodes: 0,
            seconds: 0,
            activeDays: 0,
            perAnime: new Map(),
            days: []
        };
        const now = new Date();
        const start = new Date();
        start.setDate(now.getDate() - (days - 1));
        for (let i = 0; i < days; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            const dk = dayKey(d);
            const bucket = index.byDay.get(dk);
            if (bucket) {
                out.episodes += bucket.episodes;
                out.seconds += bucket.seconds;
                out.activeDays++;
                for (const slug of bucket.animes) {
                    const row = out.perAnime.get(slug) || { episodes: 0, seconds: 0 };
                    out.perAnime.set(slug, row);
                }
            }
            out.days.push({ dayKey: dk, episodes: bucket?.episodes || 0, seconds: bucket?.seconds || 0 });
        }
        return out;
    }

    function topAnimeInWindow(animeData, days = 7, limit = 5) {
        const now = new Date();
        const cutoff = new Date();
        cutoff.setDate(now.getDate() - (days - 1));
        cutoff.setHours(0, 0, 0, 0);

        const rows = [];
        for (const slug in animeData || {}) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            const anime = animeData[slug];
            if (!anime?.episodes?.length) continue;
            let eps = 0;
            let seconds = 0;
            for (const ep of anime.episodes) {
                const d = parseDate(ep?.watchedAt);
                if (!d || d < cutoff) continue;
                eps++;
                seconds += Number(ep?.duration) || 0;
            }
            if (eps > 0) {
                rows.push({ slug, title: anime.title, coverImage: anime.coverImage, episodes: eps, seconds });
            }
        }
        rows.sort((a, b) => b.seconds - a.seconds || b.episodes - a.episodes);
        return rows.slice(0, limit);
    }

    function categorizeAnime(animeData) {
        const rows = { completed: [], watching: [], onHold: [], dropped: [], notStarted: [] };
        for (const slug in animeData || {}) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            const a = animeData[slug];
            if (!a) continue;
            const watched = Array.isArray(a.episodes) ? a.episodes.length : 0;
            const total = Number(a.totalEpisodes) || 0;
            const row = { slug, title: a.title, watched, total, lastWatched: a.lastWatched, coverImage: a.coverImage };
            if (a.droppedAt) rows.dropped.push(row);
            else if (a.onHoldAt) rows.onHold.push(row);
            else if (a.completedAt || (total > 0 && watched >= total)) rows.completed.push(row);
            else if (watched === 0) rows.notStarted.push(row);
            else rows.watching.push(row);
        }
        for (const k in rows) {
            rows[k].sort((x, y) => (y.lastWatched || '').localeCompare(x.lastWatched || ''));
        }
        return rows;
    }

    function invalidate() { _cache = null; }

    const StatsEngine = {
        buildWatchIndex,
        computeStreak,
        predictCompletion,
        windowStats,
        topAnimeInWindow,
        categorizeAnime,
        invalidate,
        dayKey,
        monthKey,
        daysBetween
    };

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.StatsEngine = StatsEngine;
})();