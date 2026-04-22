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

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function mean(values) {
        if (!Array.isArray(values) || values.length === 0) return 0;
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }

    function stddev(values, avg = mean(values)) {
        if (!Array.isArray(values) || values.length < 2) return 0;
        const variance = values.reduce((sum, value) => {
            const diff = value - avg;
            return sum + (diff * diff);
        }, 0) / values.length;
        return Math.sqrt(variance);
    }

    function getBucketEpisodes(value) {
        return typeof value === 'number'
            ? value
            : (Number(value?.episodes) || 0);
    }

    function computeWindowRate(byDay, days, endDate = new Date()) {
        if (!byDay || !days || days <= 0) return 0;
        const end = new Date(endDate);
        end.setHours(0, 0, 0, 0);
        let episodes = 0;
        for (let i = 0; i < days; i++) {
            const d = new Date(end);
            d.setDate(end.getDate() - i);
            episodes += getBucketEpisodes(byDay.get(dayKey(d)));
        }
        return episodes / days;
    }

    function averageGapDays(sortedKeys) {
        if (!Array.isArray(sortedKeys) || sortedKeys.length < 2) return 1;
        const gaps = [];
        for (let i = 1; i < sortedKeys.length; i++) {
            gaps.push(Math.max(1, daysBetween(sortedKeys[i - 1], sortedKeys[i])));
        }
        return mean(gaps) || 1;
    }

    function buildWeekdayFactors(byDay, startDate, endDate) {
        if (!startDate || !endDate) return Array(7).fill(1);

        const start = new Date(startDate);
        const end = new Date(endDate);
        start.setHours(0, 0, 0, 0);
        end.setHours(0, 0, 0, 0);
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) {
            return Array(7).fill(1);
        }

        const weekdayTotals = Array(7).fill(0);
        const weekdayCounts = Array(7).fill(0);
        const cursor = new Date(start);
        let guard = 0;

        while (cursor <= end && guard < 4000) {
            const dow = cursor.getDay();
            weekdayCounts[dow]++;
            weekdayTotals[dow] += getBucketEpisodes(byDay?.get(dayKey(cursor)));
            cursor.setDate(cursor.getDate() + 1);
            guard++;
        }

        const averages = weekdayTotals.map((sum, idx) => weekdayCounts[idx] ? (sum / weekdayCounts[idx]) : 0);
        const baseline = mean(averages.filter(value => value > 0)) || mean(averages) || 1;
        return averages.map(value => clamp((value || baseline) / baseline, 0.45, 1.85));
    }

    function blendWeekdayFactors(baseFactors, overrideFactors, overrideWeight = 0.35) {
        const base = Array.isArray(baseFactors) && baseFactors.length === 7 ? baseFactors : Array(7).fill(1);
        const override = Array.isArray(overrideFactors) && overrideFactors.length === 7 ? overrideFactors : Array(7).fill(1);
        const weight = clamp(overrideWeight, 0, 1);
        return base.map((value, idx) => clamp((value * (1 - weight)) + (override[idx] * weight), 0.4, 1.9));
    }

    function simulateDaysToFinish(remainingEpisodes, baseRate, weekdayFactors, startDate = new Date()) {
        const rate = Math.max(baseRate || 0, 1 / 90);
        let remaining = Math.max(remainingEpisodes || 0, 0);
        if (remaining <= 0) return 0;

        const cursor = new Date(startDate);
        cursor.setHours(0, 0, 0, 0);
        const factors = Array.isArray(weekdayFactors) && weekdayFactors.length === 7
            ? weekdayFactors
            : Array(7).fill(1);

        let days = 0;
        let guard = 0;
        while (remaining > 0 && guard < 4000) {
            const dow = cursor.getDay();
            const factor = clamp(factors[dow] || 1, 0.35, 1.9);
            remaining -= Math.max(rate * factor, 1 / 120);
            days++;
            cursor.setDate(cursor.getDate() + 1);
            guard++;
        }

        return Math.max(1, days);
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
        let overallFirst = null;
        let overallLast = null;

        for (const slug in animeData || {}) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            const anime = animeData[slug];
            if (!anime || !Array.isArray(anime.episodes)) continue;

            let first = null;
            let last = null;
            const days = new Set();
            const animeByDay = new Map();

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
                if (!overallFirst || d < overallFirst) overallFirst = d;
                if (!overallLast || d > overallLast) overallLast = d;
                days.add(dk);
                animeByDay.set(dk, (animeByDay.get(dk) || 0) + 1);

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
                const sortedAnimeDays = Array.from(days).sort();
                const spanDays = Math.max(1, daysBetween(dayKey(first), dayKey(last)) + 1);
                const rate = anime.episodes.length / spanDays;
                const activeDayCounts = Array.from(animeByDay.values());
                const avgActiveCount = mean(activeDayCounts);
                const variability = avgActiveCount > 0 ? (stddev(activeDayCounts, avgActiveCount) / avgActiveCount) : 1;
                perAnime.set(slug, {
                    firstWatchedAt: first.toISOString(),
                    lastWatchedAt: last.toISOString(),
                    watchedCount: anime.episodes.length,
                    distinctDays: days.size,
                    spanDays,
                    rateEpsPerDay: rate,
                    meanGapDays: averageGapDays(sortedAnimeDays),
                    consistency: clamp(1 - (variability / 2.5), 0.15, 1),
                    weekdayFactors: buildWeekdayFactors(animeByDay, first, last)
                });
            }
        }

        const sortedDays = Array.from(byDay.keys()).sort();
        const totalSpanDays = overallFirst && overallLast
            ? Math.max(1, daysBetween(dayKey(overallFirst), dayKey(overallLast)) + 1)
            : 1;
        const globalActiveCounts = sortedDays
            .map(key => Number(byDay.get(key)?.episodes) || 0)
            .filter(value => value > 0);
        const globalAvgActive = mean(globalActiveCounts);
        const globalVariability = globalAvgActive > 0 ? (stddev(globalActiveCounts, globalAvgActive) / globalAvgActive) : 1;
        const userProfile = {
            overallRate: totalEpisodes / totalSpanDays,
            activeDayRate: totalEpisodes / Math.max(1, byDay.size),
            recent7Rate: computeWindowRate(byDay, 7),
            recent14Rate: computeWindowRate(byDay, 14),
            recent30Rate: computeWindowRate(byDay, 30),
            meanGapDays: averageGapDays(sortedDays),
            weekdayFactors: buildWeekdayFactors(byDay, overallFirst || new Date(), overallLast || new Date()),
            consistency: clamp(1 - (globalVariability / 2.2), 0.18, 1),
            activeDays: byDay.size,
            spanDays: totalSpanDays,
            totalEpisodes
        };

        const index = {
            byDay,
            byMonth,
            perAnime,
            sortedDays,
            userProfile,
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
        const userProfile = index?.userProfile || null;

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
        const recent30Count = countEpisodesInWindow(30);
        const recent7Rate = recent7Count / 7;
        const recent14Rate = recent14Count / 14;
        const recent30Rate = recent30Count / 30;
        const recentActiveBurst = mean(
            Array.from(byDay.entries())
                .sort((a, b) => a[0].localeCompare(b[0]))
                .slice(-3)
                .map(([, count]) => count)
        ) || activeDayRate;
        const animeWeekdayFactors = meta?.weekdayFactors
            || (firstWatch && mostRecentWatch ? buildWeekdayFactors(byDay, firstWatch, mostRecentWatch) : Array(7).fill(1));
        const animeConsistency = meta?.consistency || 0.35;

        let animeBaseRate =
            (spanRate * 0.20) +
            (recent30Rate * 0.16) +
            (recent14Rate * 0.27) +
            (recent7Rate * 0.24) +
            (activeDayRate * 0.08) +
            (recentActiveBurst * 0.05);
        if (recent14Count === 0) {
            animeBaseRate = (spanRate * 0.58) + (Math.min(activeDayRate, spanRate * 1.5) * 0.24) + (recentActiveBurst * 0.18);
        } else if (recent7Count === 0) {
            animeBaseRate = (spanRate * 0.30) + (recent30Rate * 0.16) + (recent14Rate * 0.34) + (activeDayRate * 0.12) + (recentActiveBurst * 0.08);
        }

        const userBaseRate = userProfile
            ? (
                (userProfile.recent7Rate * 0.24) +
                (userProfile.recent14Rate * 0.30) +
                (userProfile.recent30Rate * 0.20) +
                (userProfile.overallRate * 0.16) +
                (userProfile.activeDayRate * 0.10)
            )
            : spanRate;
        const dataRichness = clamp(((watchedCount / 12) * 0.55) + ((distinctDays / 10) * 0.45), 0.15, 1);
        const animeSignalWeight = clamp(0.25 + (dataRichness * 0.52) + (animeConsistency * 0.15), 0.35, 0.92);
        let rate = (animeBaseRate * animeSignalWeight) + (userBaseRate * (1 - animeSignalWeight));
        if (!meta || distinctDays < 2) {
            const conservativeFallback = Math.min(2.5, Math.max(0.4, watchedCount / Math.max(7, fallbackSpanDays)));
            rate = Math.max(rate || 0, conservativeFallback);
        }

        let daysSinceLastWatch = 0;
        if (mostRecentWatch) {
            daysSinceLastWatch = Math.max(0, daysBetween(dayKey(mostRecentWatch), dayKey(new Date())));
            const expectedGap = clamp(meta?.meanGapDays || userProfile?.meanGapDays || 2, 1, 14);
            if (daysSinceLastWatch > expectedGap * 2) rate *= 0.88;
            if (daysSinceLastWatch > expectedGap * 4) rate *= 0.74;
        }

        const hardCap = userProfile
            ? Math.max(3.5, userProfile.activeDayRate * 1.8, userBaseRate * 1.9)
            : 3.5;
        rate = clamp(rate, 1 / 60, hardCap);
        if (!rate || !Number.isFinite(rate) || rate <= 0) return null;

        const remaining = Math.max(0, total - watchedCount);
        if (remaining <= 0 && !allowSingleEpisodeForecast) return null;
        const forecastEpisodes = remaining <= 0 && allowSingleEpisodeForecast ? 1 : remaining;

        const anilistStatus = anilist?.getStatus?.(slug);
        const latestAvailable = Number(anilist?.getLatestEpisode?.(slug)) || 0;
        const releaseFloorDays = !configuredTarget && anilistStatus === 'RELEASING' && total > latestAvailable && latestAvailable > 0
            ? (total - latestAvailable) * 7
            : 0;

        const weekdayFactors = blendWeekdayFactors(
            userProfile?.weekdayFactors,
            animeWeekdayFactors,
            clamp((distinctDays - 2) / 14, 0, 0.6)
        );

        let daysLeft = simulateDaysToFinish(forecastEpisodes, rate, weekdayFactors);
        daysLeft = Math.max(daysLeft, releaseFloorDays);
        if (!Number.isFinite(daysLeft) || daysLeft <= 0 || daysLeft > 365 * 10) return null;

        const eta = new Date();
        eta.setDate(eta.getDate() + daysLeft);

        const rateFloor = Math.max(rate * (0.60 - ((animeConsistency - 0.5) * 0.10)), 1 / 60);
        const rateCeil = Math.max(rateFloor, rate * (1.22 + ((1 - animeConsistency) * 0.20)));
        const earliestDays = Math.max(releaseFloorDays, simulateDaysToFinish(forecastEpisodes, rateCeil, weekdayFactors));
        const latestDays = Math.max(releaseFloorDays, simulateDaysToFinish(forecastEpisodes, rateFloor, weekdayFactors));

        let confidenceScore =
            (clamp(watchedCount / 12, 0, 1) * 0.25) +
            (clamp(distinctDays / 10, 0, 1) * 0.20) +
            (clamp(recent14Count / 6, 0, 1) * 0.20) +
            (clamp(1 - (daysSinceLastWatch / Math.max(10, (userProfile?.meanGapDays || 2) * 5)), 0.15, 1) * 0.15) +
            (animeConsistency * 0.12) +
            ((userProfile?.consistency || 0.45) * 0.08);
        if (releaseFloorDays > 0) confidenceScore *= 0.9;
        if (!meta || distinctDays < 2) confidenceScore *= 0.82;

        let confidence = 'low';
        if (confidenceScore >= 0.72) confidence = 'high';
        else if (confidenceScore >= 0.48) confidence = 'medium';

        return {
            etaDate: eta,
            epsPerDay: rate,
            remaining,
            daysLeft,
            earliestDays,
            latestDays,
            confidence,
            confidenceScore,
            model: remaining <= 0 && allowSingleEpisodeForecast
                ? 'next-drop-pace'
                : (releaseFloorDays > 0 ? 'release-aware' : (configuredTarget ? 'catch-up-aware' : 'pace-aware')),
            releaseFloorDays,
            recent7Rate,
            recent14Rate,
            recent30Rate,
            spanRate,
            userBaseRate,
            animeSignalWeight
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
