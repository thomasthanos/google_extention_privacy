(function () {
    'use strict';

    let _hourCache = null;

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

    function isoWeekKey(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    }

    function signatureOf(animeData) {
        let slugs = 0;
        let eps = 0;
        let maxLast = '';
        for (const slug in animeData || {}) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            const a = animeData[slug];
            if (!a) continue;
            slugs++;
            if (Array.isArray(a.episodes)) eps += a.episodes.length;
            if (a.lastWatched && a.lastWatched > maxLast) maxLast = a.lastWatched;
        }
        return `${slugs}|${eps}|${maxLast}`;
    }

    function buildHourIndex(animeData) {
        const sig = signatureOf(animeData);
        if (_hourCache && _hourCache.sig === sig) return _hourCache;

        const hours = new Map();
        for (const slug in animeData || {}) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            const anime = animeData[slug];
            if (!anime || !Array.isArray(anime.episodes)) continue;
            for (const ep of anime.episodes) {
                if (!ep?.watchedAt) continue;
                const d = new Date(ep.watchedAt);
                if (!Number.isFinite(d.getTime())) continue;
                const h = d.getHours();
                hours.set(h, (hours.get(h) || 0) + 1);
            }
        }

        _hourCache = { hours, sig };
        return _hourCache;
    }

    function countMovies(animeData) {
        const Utils = window.AnimeTrackerMergeUtils;
        let count = 0;
        for (const slug in animeData || {}) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            const a = animeData[slug];
            if (!a || !Array.isArray(a.episodes) || a.episodes.length === 0) continue;
            if (Utils?.isLikelyMovieSlug?.(slug)) count++;
        }
        return count;
    }

    function countDropped(animeData) {
        let count = 0;
        for (const slug in animeData || {}) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            if (animeData[slug]?.droppedAt || animeData[slug]?.listState === 'dropped') count++;
        }
        return count;
    }

    function countOnHold(animeData) {
        let count = 0;
        for (const slug in animeData || {}) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            if (animeData[slug]?.onHoldAt || animeData[slug]?.listState === 'on_hold') count++;
        }
        return count;
    }

    function longestSpanDays(index) {
        if (!index?.perAnime) return 0;
        let best = 0;
        for (const row of index.perAnime.values()) {
            if (row.spanDays > best) best = row.spanDays;
        }
        return best;
    }

    function longestEpisodesInOneSeries(animeData, options) {
        const onlyCompleted = options?.onlyCompleted === true;
        let best = 0;
        for (const slug in animeData || {}) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            const a = animeData[slug];
            if (!a || !Array.isArray(a.episodes)) continue;
            if (onlyCompleted) {
                const isCompleted = a.completed === true
                    || a.listState === 'completed'
                    || (a.totalEpisodes && a.episodes.length >= a.totalEpisodes);
                if (!isCompleted) continue;
            }
            if (a.episodes.length > best) best = a.episodes.length;
        }
        return best;
    }

    function weekendEpisodes(animeData) {
        let count = 0;
        for (const slug in animeData || {}) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            const a = animeData[slug];
            if (!a || !Array.isArray(a.episodes)) continue;
            for (const ep of a.episodes) {
                if (!ep?.watchedAt) continue;
                const d = new Date(ep.watchedAt);
                if (!Number.isFinite(d.getTime())) continue;
                const day = d.getDay();
                if (day === 0 || day === 6) count++;
            }
        }
        return count;
    }

    function hasComebackGap(animeData, gapDays) {
        const gapMs = gapDays * 86400000;
        for (const slug in animeData || {}) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            const a = animeData[slug];
            if (!a || !Array.isArray(a.episodes) || a.episodes.length < 2) continue;
            const times = [];
            for (const ep of a.episodes) {
                if (!ep?.watchedAt) continue;
                const t = Date.parse(ep.watchedAt);
                if (Number.isFinite(t)) times.push(t);
            }
            if (times.length < 2) continue;
            times.sort((x, y) => x - y);
            for (let i = 1; i < times.length; i++) {
                if (times[i] - times[i - 1] >= gapMs) return true;
            }
        }
        return false;
    }

    function bestDailyEpisodeCount(index) {
        let best = 0;
        if (!index?.byDay) return 0;
        for (const bucket of index.byDay.values()) {
            if (bucket.episodes > best) best = bucket.episodes;
        }
        return best;
    }

    const BADGE_DEFS = [
        // ─── Volume ────────────────────────────────────────────────────────
        { id: 'first_steps', group: 'volume', title: 'First Steps', desc: 'Watch your first episode',
          icon: '🌱', svg: 'sprout', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.episodes, 1), target: 1 }) },
        { id: 'century_club', group: 'volume', title: 'Century Club', desc: 'Watch 100 episodes',
          icon: '💯', svg: 'hundred', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.episodes, 100), target: 100 }) },
        { id: 'marathoner_500', group: 'volume', title: 'Half-K Hero', desc: 'Watch 500 episodes',
          icon: '🚀', svg: 'rocket', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.episodes, 500), target: 500 }) },
        { id: 'marathoner_1k', group: 'volume', title: 'Marathoner', desc: 'Watch 1,000 episodes',
          icon: '🏆', svg: 'trophy', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.episodes, 1000), target: 1000 }) },

        // ─── Time ──────────────────────────────────────────────────────────
        { id: 'time_traveler', group: 'time', title: 'Time Traveler', desc: 'Watch 100 hours total',
          icon: '⏳', svg: 'hourglass', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.seconds, 360000), target: 360000, unit: 'seconds' }) },
        { id: 'time_legend', group: 'time', title: 'Time Legend', desc: 'Watch 500 hours total',
          icon: '🕰️', svg: 'clock', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.seconds, 1800000), target: 1800000, unit: 'seconds' }) },

        // ─── Series ────────────────────────────────────────────────────────
        { id: 'completionist', group: 'series', title: 'Completionist', desc: 'Finish your first series',
          icon: '✅', svg: 'check', tier: 'bronze',
          progress: (ctx) => {
              const rows = ctx.categorize();
              return { current: Math.min(rows.completed.length, 1), target: 1 };
          } },
        { id: 'completionist_10', group: 'series', title: 'Series Collector', desc: 'Finish 10 series',
          icon: '📚', svg: 'books', tier: 'silver',
          progress: (ctx) => {
              const rows = ctx.categorize();
              return { current: Math.min(rows.completed.length, 10), target: 10 };
          } },
        { id: 'completionist_50', group: 'series', title: 'Series Master', desc: 'Finish 50 series',
          icon: '👑', svg: 'crown', tier: 'gold',
          progress: (ctx) => {
              const rows = ctx.categorize();
              return { current: Math.min(rows.completed.length, 50), target: 50 };
          } },
        { id: 'library_builder', group: 'series', title: 'Library Builder', desc: 'Track 50 anime',
          icon: '📖', svg: 'book', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.animes, 50), target: 50 }) },
        { id: 'long_runner', group: 'series', title: 'Long Runner', desc: 'Finish a 50+ episode series',
          icon: '🏃', svg: 'runner', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(longestEpisodesInOneSeries(ctx.animeData, { onlyCompleted: true }), 50), target: 50 }) },
        { id: 'epic_finisher', group: 'series', title: 'Epic Finisher', desc: 'Finish a 100+ episode series',
          icon: '⚔️', svg: 'sword', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(longestEpisodesInOneSeries(ctx.animeData, { onlyCompleted: true }), 100), target: 100 }) },

        // ─── Cinema ────────────────────────────────────────────────────────
        { id: 'movie_buff', group: 'cinema', title: 'Movie Buff', desc: 'Watch 5 anime movies',
          icon: '🎬', svg: 'clapper', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(countMovies(ctx.animeData), 5), target: 5 }) },
        { id: 'cinephile', group: 'cinema', title: 'Cinephile', desc: 'Watch 25 anime movies',
          icon: '🎞️', svg: 'film', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(countMovies(ctx.animeData), 25), target: 25 }) },

        // ─── Streaks ───────────────────────────────────────────────────────
        { id: 'power_hour', group: 'streaks', title: 'Power Hour', desc: 'Watch 5 episodes in a single day',
          icon: '⚡', svg: 'bolt', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(bestDailyEpisodeCount(ctx.index), 5), target: 5 }) },
        { id: 'marathon_day', group: 'streaks', title: 'Marathon Day', desc: 'Watch 10 episodes in a single day',
          icon: '🔥', svg: 'flame', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(bestDailyEpisodeCount(ctx.index), 10), target: 10 }) },
        { id: 'binge_week', group: 'streaks', title: 'Binge Week', desc: '7-day watch streak',
          icon: '🗓️', svg: 'calendar7', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(ctx.streak.longestStreak, 7), target: 7 }) },
        { id: 'dedication', group: 'streaks', title: 'Dedication', desc: '30-day watch streak',
          icon: '💎', svg: 'gem', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(ctx.streak.longestStreak, 30), target: 30 }) },
        { id: 'unstoppable', group: 'streaks', title: 'Unstoppable', desc: '100-day watch streak',
          icon: '🌋', svg: 'volcano', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(ctx.streak.longestStreak, 100), target: 100 }) },

        // ─── Lifestyle ─────────────────────────────────────────────────────
        { id: 'night_owl', group: 'lifestyle', title: 'Night Owl', desc: 'Watch between 2am and 5am',
          icon: '🌙', svg: 'moon', tier: 'bronze',
          progress: (ctx) => {
              const hasNight = [2, 3, 4].some(h => (ctx.hourIndex.hours.get(h) || 0) > 0);
              return { current: hasNight ? 1 : 0, target: 1 };
          } },
        { id: 'early_bird', group: 'lifestyle', title: 'Early Bird', desc: 'Watch between 4am and 7am',
          icon: '☀️', svg: 'sun', tier: 'bronze',
          progress: (ctx) => {
              const hasEarly = [4, 5, 6].some(h => (ctx.hourIndex.hours.get(h) || 0) > 0);
              return { current: hasEarly ? 1 : 0, target: 1 };
          } },
        { id: 'weekend_warrior', group: 'lifestyle', title: 'Weekend Warrior', desc: 'Watch 20 episodes on weekends',
          icon: '🛋️', svg: 'couch', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(weekendEpisodes(ctx.animeData), 20), target: 20 }) },
        { id: 'patient_viewer', group: 'lifestyle', title: 'Patient Viewer', desc: 'Watch one anime for 180+ days',
          icon: '🌸', svg: 'sakura', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(longestSpanDays(ctx.index), 180), target: 180 }) },
        { id: 'comeback_kid', group: 'lifestyle', title: 'Comeback Kid', desc: 'Return to a series after 30+ days',
          icon: '🔁', svg: 'loop', tier: 'bronze',
          progress: (ctx) => ({ current: hasComebackGap(ctx.animeData, 30) ? 1 : 0, target: 1 }) },
        { id: 'picky_viewer', group: 'lifestyle', title: 'Picky Viewer', desc: 'Drop 5 anime',
          icon: '🙅', svg: 'noEntry', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(countDropped(ctx.animeData), 5), target: 5 }) }
    ];

    const GROUP_DEFS = [
        { id: 'volume',    title: 'Volume',    icon: '🎯' },
        { id: 'time',      title: 'Time',      icon: '⏱️' },
        { id: 'series',    title: 'Series',    icon: '📚' },
        { id: 'cinema',    title: 'Cinema',    icon: '🎬' },
        { id: 'streaks',   title: 'Streaks',   icon: '🔥' },
        { id: 'lifestyle', title: 'Lifestyle', icon: '🌙' }
    ];

    function evaluateBadges(animeData, index, hourIndex, options) {
        const StatsEngine = window.AnimeTracker?.StatsEngine;
        const streak = StatsEngine ? StatsEngine.computeStreak(index) : { longestStreak: 0, currentStreak: 0 };

        let categorized = null;
        const categorize = () => {
            if (!categorized) {
                categorized = StatsEngine
                    ? StatsEngine.categorizeAnime(animeData)
                    : { completed: [], watching: [], onHold: [], dropped: [], notStarted: [] };
            }
            return categorized;
        };

        const ctx = { animeData, index, hourIndex, streak, categorize };
        const existingUnlocks = options?.badgeState || {};
        const nowIso = new Date().toISOString();

        return BADGE_DEFS.map(def => {
            const progress = def.progress(ctx);
            const pct = progress.target > 0 ? Math.min(1, progress.current / progress.target) : 0;
            const unlocked = progress.current >= progress.target;
            const stored = existingUnlocks[def.id];
            return {
                id: def.id,
                group: def.group || 'volume',
                title: def.title,
                desc: def.desc,
                icon: def.icon,
                svg: def.svg || null,
                tier: def.tier,
                unlocked,
                progress: { current: progress.current, target: progress.target, pct, unit: progress.unit || 'count' },
                unlockedAt: unlocked ? (stored?.unlockedAt || nowIso) : null,
                justUnlocked: unlocked && !stored?.unlockedAt
            };
        });
    }

    function evaluateGoals(goalSettings, index) {
        const defaults = getDefaultGoalSettings();
        const settings = {
            daily: { ...defaults.daily, ...(goalSettings?.daily || {}) },
            weekly: { ...defaults.weekly, ...(goalSettings?.weekly || {}) },
            monthly: { ...defaults.monthly, ...(goalSettings?.monthly || {}) }
        };

        const now = new Date();
        const todayKey = dayKey(now);
        const weekKey = isoWeekKey(now);
        const mKey = monthKey(now);

        let dailySeconds = 0;
        let weeklyEpisodes = 0;
        let monthlyEpisodes = 0;

        if (index?.byDay) {
            for (const [key, bucket] of index.byDay.entries()) {
                const [y, m, d] = key.split('-').map(Number);
                const date = new Date(y, m - 1, d);
                if (key === todayKey) dailySeconds += bucket.seconds || 0;
                if (isoWeekKey(date) === weekKey) weeklyEpisodes += bucket.episodes || 0;
                if (monthKey(date) === mKey) monthlyEpisodes += bucket.episodes || 0;
            }
        }

        const dailyTargetSec = Math.max(0, Number(settings.daily.targetMinutes) || 0) * 60;
        const weeklyTarget = Math.max(0, Number(settings.weekly.targetEpisodes) || 0);
        const monthlyTarget = Math.max(0, Number(settings.monthly.targetEpisodes) || 0);

        return {
            daily: {
                current: dailySeconds,
                target: dailyTargetSec,
                pct: dailyTargetSec > 0 ? Math.min(1, dailySeconds / dailyTargetSec) : 0,
                unit: 'seconds'
            },
            weekly: {
                current: weeklyEpisodes,
                target: weeklyTarget,
                pct: weeklyTarget > 0 ? Math.min(1, weeklyEpisodes / weeklyTarget) : 0,
                unit: 'episodes'
            },
            monthly: {
                current: monthlyEpisodes,
                target: monthlyTarget,
                pct: monthlyTarget > 0 ? Math.min(1, monthlyEpisodes / monthlyTarget) : 0,
                unit: 'episodes'
            }
        };
    }

    function getDefaultGoalSettings() {
        return {
            daily:   { targetMinutes: 60, updatedAt: null },
            weekly:  { targetEpisodes: 5, updatedAt: null },
            monthly: { targetEpisodes: 20, updatedAt: null }
        };
    }

    function diffUnlocks(prevBadges, nextBadges) {
        const prevMap = new Map((prevBadges || []).map(b => [b.id, b]));
        const newlyUnlocked = [];
        for (const badge of nextBadges || []) {
            if (!badge.unlocked) continue;
            const prev = prevMap.get(badge.id);
            if (!prev || !prev.unlocked) {
                newlyUnlocked.push(badge);
            }
        }
        return newlyUnlocked;
    }

    function invalidate() { _hourCache = null; }

    const AchievementsEngine = {
        BADGE_DEFS,
        GROUP_DEFS,
        buildHourIndex,
        evaluateBadges,
        evaluateGoals,
        getDefaultGoalSettings,
        diffUnlocks,
        invalidate
    };

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.AchievementsEngine = AchievementsEngine;
})();
