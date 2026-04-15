/**
 * Anime Tracker — Stats Engine
 * Pure, memoized read-only analytics over `animeData`.
 * No writes. No storage. Safe to call from popup render paths.
 *
 * Exposes: window.AnimeTracker.StatsEngine
 *
 * Data shape recap (from episode-writer.js):
 *   animeData[slug] = {
 *     title, slug, episodes: [{number, watchedAt, duration, durationSource}],
 *     totalWatchTime, lastWatched, totalEpisodes, coverImage, siteAnimeId,
 *     completedAt?, droppedAt?, onHoldAt?, listState?
 *   }
 */
(function () {
    'use strict';

    // ── Date helpers (local-time buckets) ──
    function dayKey(date) {
        // YYYY-MM-DD in local time so streaks align with the user's calendar.
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
        // Inclusive-like diff in days between two YYYY-MM-DD keys.
        const [ay, am, ad] = aKey.split('-').map(Number);
        const [by, bm, bd] = bKey.split('-').map(Number);
        const a = Date.UTC(ay, am - 1, ad);
        const b = Date.UTC(by, bm - 1, bd);
        return Math.round((b - a) / 86400000);
    }

    // ── Memoization ──
    // Cache key: number of slugs + sum of episodes + max lastWatched. Cheap to compute,
    // and changes whenever data changes meaningfully.
    let _cache = null;

    function signatureOf(animeData) {
        if (!animeData) return '0|0|';
        let slugs = 0;
        let eps = 0;
        let maxLast = '';
        for (const slug in animeData) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            const a = animeData[slug];
            if (!a) continue;
            slugs++;
            if (Array.isArray(a.episodes)) eps += a.episodes.length;
            if (a.lastWatched && a.lastWatched > maxLast) maxLast = a.lastWatched;
        }
        return `${slugs}|${eps}|${maxLast}`;
    }

    // ── Core index builder ──
    function buildWatchIndex(animeData) {
        const sig = signatureOf(animeData);
        if (_cache && _cache.sig === sig) return _cache.index;

        const byDay = new Map();   // dayKey -> { episodes, seconds, animes: Set<slug> }
        const byMonth = new Map(); // monthKey -> seconds
        const perAnime = new Map(); // slug -> { firstWatchedAt, lastWatchedAt, watchedCount, days: Set, rateEpsPerDay }
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

    // ── Streak ──
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

        // Longest streak (scan all days)
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

        // Current streak: counts only if last watch is today or yesterday
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
            // Streak already broken — report the day after last as the break
            const d = new Date(lastKey);
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

    // ── Completion prediction ──
    // Returns { etaDate, epsPerDay, remaining, confidence } or null if not predictable.
    function predictCompletion(anime, index) {
        if (!anime || !Array.isArray(anime.episodes) || anime.episodes.length < 3) return null;
        const total = Number(anime.totalEpisodes) || 0;
        if (!total || total <= anime.episodes.length) return null;

        const slug = anime.slug;
        const meta = index?.perAnime?.get(slug);
        if (!meta || meta.distinctDays < 3) return null;

        const rate = meta.rateEpsPerDay; // eps/day over the user's watching span
        if (!rate || !Number.isFinite(rate) || rate <= 0) return null;

        const remaining = total - anime.episodes.length;
        const daysLeft = remaining / rate;
        if (!Number.isFinite(daysLeft) || daysLeft <= 0 || daysLeft > 365 * 10) return null;

        const eta = new Date();
        eta.setDate(eta.getDate() + Math.ceil(daysLeft));

        // Confidence: more distinct days + more episodes = higher
        let confidence = 'low';
        if (meta.distinctDays >= 7 && anime.episodes.length >= 6) confidence = 'medium';
        if (meta.distinctDays >= 14 && anime.episodes.length >= 12) confidence = 'high';

        return {
            etaDate: eta,
            epsPerDay: rate,
            remaining,
            daysLeft: Math.ceil(daysLeft),
            confidence
        };
    }

    // ── Weekly window ──
    function windowStats(index, days = 7) {
        const out = {
            episodes: 0,
            seconds: 0,
            activeDays: 0,
            perAnime: new Map(), // slug -> { episodes, seconds }
            days: [] // [{dayKey, episodes, seconds}] chronological
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
                    // Episodes per anime within window requires re-scanning; good enough to count unique slug-days here.
                    out.perAnime.set(slug, row);
                }
            }
            out.days.push({ dayKey: dk, episodes: bucket?.episodes || 0, seconds: bucket?.seconds || 0 });
        }
        return out;
    }

    // Walk animeData once for per-anime episode counts within a window
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

    // ── Completion status categorization (used by dashboard table) ──
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
        // Sort: most recent first inside each bucket
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
        // helpers exposed for views
        dayKey,
        monthKey,
        daysBetween
    };

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.StatsEngine = StatsEngine;
})();
