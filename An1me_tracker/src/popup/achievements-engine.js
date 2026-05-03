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
        { id: 'starter_stack', group: 'volume', title: 'Starter Stack', desc: 'Watch 25 episodes',
          icon: '📖', svg: 'book', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.episodes, 25), target: 25 }) },
        { id: 'century_club', group: 'volume', title: 'Century Club', desc: 'Watch 100 episodes',
          icon: '💯', svg: 'hundred', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.episodes, 100), target: 100 }) },
        { id: 'double_century', group: 'volume', title: 'Double Century', desc: 'Watch 250 episodes',
          icon: '⚡', svg: 'bolt', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.episodes, 250), target: 250 }) },
        { id: 'marathoner_500', group: 'volume', title: 'Half-K Hero', desc: 'Watch 500 episodes',
          icon: '🚀', svg: 'rocket', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.episodes, 500), target: 500 }) },
        { id: 'marathoner_1k', group: 'volume', title: 'Marathoner', desc: 'Watch 1,000 episodes',
          icon: '🏆', svg: 'trophy', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.episodes, 1000), target: 1000 }) },

        // ─── Time ──────────────────────────────────────────────────────────
        { id: 'day_one_24h', group: 'time', title: '24-Hour Club', desc: 'Watch 24 hours total',
          icon: '⏱️', svg: 'clock', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.seconds, 86400), target: 86400, unit: 'seconds' }) },
        { id: 'time_traveler', group: 'time', title: 'Time Traveler', desc: 'Watch 100 hours total',
          icon: '⏳', svg: 'hourglass', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.seconds, 360000), target: 360000, unit: 'seconds' }) },
        { id: 'time_keeper_250', group: 'time', title: 'Time Keeper', desc: 'Watch 250 hours total',
          icon: '💎', svg: 'gem', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.seconds, 900000), target: 900000, unit: 'seconds' }) },
        { id: 'time_legend', group: 'time', title: 'Time Legend', desc: 'Watch 500 hours total',
          icon: '🕰️', svg: 'clock', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.seconds, 1800000), target: 1800000, unit: 'seconds' }) },

        // ─── Series ────────────────────────────────────────────────────────
        { id: 'completionist', group: 'series', title: 'Completionist', desc: 'Finish your first series',
          icon: '✅', svg: 'check', tier: 'bronze',
          progress: (ctx) => {
              const rows = ctx.categorize();
              return { current: Math.min(rows.completed.length, 1), target: 1 };
          } },
        { id: 'library_builder_10', group: 'series', title: 'Collection Started', desc: 'Track 10 anime',
          icon: '📚', svg: 'books', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.animes, 10), target: 10 }) },
        { id: 'completionist_10', group: 'series', title: 'Series Collector', desc: 'Finish 10 series',
          icon: '📚', svg: 'books', tier: 'silver',
          progress: (ctx) => {
              const rows = ctx.categorize();
              return { current: Math.min(rows.completed.length, 10), target: 10 };
          } },
        { id: 'completionist_25', group: 'series', title: 'Series Veteran', desc: 'Finish 25 series',
          icon: '👑', svg: 'crown', tier: 'gold',
          progress: (ctx) => {
              const rows = ctx.categorize();
              return { current: Math.min(rows.completed.length, 25), target: 25 };
          } },
        { id: 'completionist_50', group: 'series', title: 'Series Master', desc: 'Finish 50 series',
          icon: '👑', svg: 'crown', tier: 'platinum',
          progress: (ctx) => {
              const rows = ctx.categorize();
              return { current: Math.min(rows.completed.length, 50), target: 50 };
          } },
        { id: 'library_builder', group: 'series', title: 'Library Builder', desc: 'Track 50 anime',
          icon: '📖', svg: 'book', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.animes, 50), target: 50 }) },
        { id: 'library_builder_100', group: 'series', title: 'Archive Architect', desc: 'Track 100 anime',
          icon: '🏛️', svg: 'books', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.animes, 100), target: 100 }) },
        { id: 'long_runner', group: 'series', title: 'Long Runner', desc: 'Finish a 50+ episode series',
          icon: '🏃', svg: 'runner', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(longestEpisodesInOneSeries(ctx.animeData, { onlyCompleted: true }), 50), target: 50 }) },
        { id: 'epic_finisher', group: 'series', title: 'Epic Finisher', desc: 'Finish a 100+ episode series',
          icon: '⚔️', svg: 'sword', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(longestEpisodesInOneSeries(ctx.animeData, { onlyCompleted: true }), 100), target: 100 }) },

        // ─── Cinema ────────────────────────────────────────────────────────
        { id: 'movie_night', group: 'cinema', title: 'Movie Night', desc: 'Watch your first anime movie',
          icon: '🍿', svg: 'clapper', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(countMovies(ctx.animeData), 1), target: 1 }) },
        { id: 'movie_buff', group: 'cinema', title: 'Movie Buff', desc: 'Watch 5 anime movies',
          icon: '🎬', svg: 'clapper', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(countMovies(ctx.animeData), 5), target: 5 }) },
        { id: 'double_feature', group: 'cinema', title: 'Double Feature', desc: 'Watch 10 anime movies',
          icon: '🎞', svg: 'film', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(countMovies(ctx.animeData), 10), target: 10 }) },
        { id: 'cinephile', group: 'cinema', title: 'Cinephile', desc: 'Watch 25 anime movies',
          icon: '🎞️', svg: 'film', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(countMovies(ctx.animeData), 25), target: 25 }) },

        // ─── Streaks ───────────────────────────────────────────────────────
        { id: 'streak_starter', group: 'streaks', title: 'Streak Starter', desc: '3-day watch streak',
          icon: '📅', svg: 'calendar7', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(ctx.streak.longestStreak, 3), target: 3 }) },
        { id: 'power_hour', group: 'streaks', title: 'Power Hour', desc: 'Watch 5 episodes in a single day',
          icon: '⚡', svg: 'bolt', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(bestDailyEpisodeCount(ctx.index), 5), target: 5 }) },
        { id: 'marathon_day', group: 'streaks', title: 'Marathon Day', desc: 'Watch 10 episodes in a single day',
          icon: '🔥', svg: 'flame', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(bestDailyEpisodeCount(ctx.index), 10), target: 10 }) },
        { id: 'ultra_marathon', group: 'streaks', title: 'Ultra Marathon', desc: 'Watch 15 episodes in a single day',
          icon: '🚀', svg: 'rocket', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(bestDailyEpisodeCount(ctx.index), 15), target: 15 }) },
        { id: 'binge_week', group: 'streaks', title: 'Binge Week', desc: '7-day watch streak',
          icon: '🗓️', svg: 'calendar7', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(ctx.streak.longestStreak, 7), target: 7 }) },
        { id: 'fortnight_fan', group: 'streaks', title: 'Fortnight Fan', desc: '14-day watch streak',
          icon: '💎', svg: 'gem', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(ctx.streak.longestStreak, 14), target: 14 }) },
        { id: 'dedication', group: 'streaks', title: 'Dedication', desc: '30-day watch streak',
          icon: '💎', svg: 'gem', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(ctx.streak.longestStreak, 30), target: 30 }) },
        { id: 'unstoppable', group: 'streaks', title: 'Unstoppable', desc: '100-day watch streak',
          icon: '🌋', svg: 'volcano', tier: 'platinum',
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
        { id: 'weekend_mood', group: 'lifestyle', title: 'Weekend Mood', desc: 'Watch 5 episodes on weekends',
          icon: '🛋️', svg: 'couch', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(weekendEpisodes(ctx.animeData), 5), target: 5 }) },
        { id: 'weekend_warrior', group: 'lifestyle', title: 'Weekend Warrior', desc: 'Watch 20 episodes on weekends',
          icon: '🛋️', svg: 'couch', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(weekendEpisodes(ctx.animeData), 20), target: 20 }) },
        { id: 'patient_viewer', group: 'lifestyle', title: 'Patient Viewer', desc: 'Watch one anime for 180+ days',
          icon: '🌸', svg: 'sakura', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(longestSpanDays(ctx.index), 180), target: 180 }) },
        { id: 'yearlong_companion', group: 'lifestyle', title: 'Yearlong Companion', desc: 'Watch one anime for 365+ days',
          icon: '✨', svg: 'sakura', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(longestSpanDays(ctx.index), 365), target: 365 }) },
        { id: 'comeback_kid', group: 'lifestyle', title: 'Comeback Kid', desc: 'Return to a series after 30+ days',
          icon: '🔁', svg: 'loop', tier: 'bronze',
          progress: (ctx) => ({ current: hasComebackGap(ctx.animeData, 30) ? 1 : 0, target: 1 }) },
        { id: 'long_return', group: 'lifestyle', title: 'Long Return', desc: 'Return to a series after 90+ days',
          icon: '🌊', svg: 'loop', tier: 'silver',
          progress: (ctx) => ({ current: hasComebackGap(ctx.animeData, 90) ? 1 : 0, target: 1 }) },
        { id: 'shelf_keeper', group: 'lifestyle', title: 'Shelf Keeper', desc: 'Put 3 anime on hold',
          icon: '📦', svg: 'books', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(countOnHold(ctx.animeData), 3), target: 3 }) },
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

    // Memoize the heavy badge progress loop. evaluateBadges() runs through
    // every BADGE_DEFS entry on every popup render — for a large library
    // (200+ anime) and ~25 badges this means ~5000 inner iterations per call.
    // We key on the cached index+hourIndex object identity (these come from
    // buildWatchIndex/buildHourIndex which are themselves memoized via sig)
    // plus a JSON snapshot of the relevant existingUnlocks fields, so badge
    // unlock-time state still flows through.
    let _badgeCache = null;
    function evaluateBadges(animeData, index, hourIndex, options) {
        const existingUnlocks = options?.badgeState || {};
        // Cheap cache key: identity check on index/hourIndex (they're cached
        // already so identity ≡ data) + lightweight stringify of unlocks.
        let unlocksKey = '';
        try { unlocksKey = JSON.stringify(existingUnlocks); } catch { unlocksKey = String(Date.now()); }
        if (
            _badgeCache &&
            _badgeCache.index === index &&
            _badgeCache.hourIndex === hourIndex &&
            _badgeCache.unlocksKey === unlocksKey
        ) {
            return _badgeCache.result;
        }

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
        const nowIso = new Date().toISOString();

        const result = BADGE_DEFS.map(def => {
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

        _badgeCache = { index, hourIndex, unlocksKey, result };
        return result;
    }

    // Cooldown between consecutive auto-applies of a smart suggestion. Was
    // 18h — too long: a user opening the popup once a day would only see one
    // adjustment per session, even if their watch pattern shifted noticeably.
    // 2h is short enough that the target tracks reality on the next popup
    // open, but still gates against thrashing within a single sitting.
    const SMART_GOAL_AUTO_INTERVAL_MS = 2 * 60 * 60 * 1000;

    function toMillis(value) {
        if (!value) return 0;
        const millis = new Date(value).getTime();
        return Number.isFinite(millis) ? millis : 0;
    }

    function clampNumber(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function roundToStep(value, step = 1) {
        if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return 0;
        return Math.round(value / step) * step;
    }

    function getWindowTotals(byDay, days, endDate = new Date()) {
        if (!byDay || !days || days <= 0) {
            return { episodes: 0, seconds: 0, activeDays: 0 };
        }

        const end = new Date(endDate);
        end.setHours(0, 0, 0, 0);

        let episodes = 0;
        let seconds = 0;
        let activeDays = 0;

        for (let i = 0; i < days; i++) {
            const cursor = new Date(end);
            cursor.setDate(end.getDate() - i);
            const bucket = byDay.get(dayKey(cursor));
            const bucketEpisodes = Number(bucket?.episodes) || 0;
            const bucketSeconds = Number(bucket?.seconds) || 0;
            episodes += bucketEpisodes;
            seconds += bucketSeconds;
            if (bucketEpisodes > 0 || bucketSeconds > 0) activeDays++;
        }

        return { episodes, seconds, activeDays };
    }

    function analyzeGoalContext(animeData) {
        const summary = {
            watching: 0,
            completed: 0,
            onHold: 0,
            dropped: 0,
            notStarted: 0,
            remainingEpisodes: 0,
            totalTracked: 0
        };

        for (const slug in animeData || {}) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            const anime = animeData[slug];
            if (!anime) continue;

            summary.totalTracked++;

            const watched = Array.isArray(anime.episodes) ? anime.episodes.length : 0;
            const total = Math.max(0, Number(anime.totalEpisodes) || 0);
            summary.remainingEpisodes += Math.max(0, total - watched);

            if (anime.droppedAt || anime.listState === 'dropped') summary.dropped++;
            else if (anime.onHoldAt || anime.listState === 'on_hold') summary.onHold++;
            else if (anime.completed === true || anime.completedAt || (total > 0 && watched >= total)) summary.completed++;
            else if (watched === 0) summary.notStarted++;
            else summary.watching++;
        }

        return summary;
    }

    function buildSmartGoalNote(key, context, profile, windows) {
        const watchingCount = Math.max(0, Number(context?.watching) || 0);
        const holdingCount = Math.max(0, Number(context?.onHold) || 0);
        const droppedCount = Math.max(0, Number(context?.dropped) || 0);
        const remainingEpisodes = Math.max(0, Number(context?.remainingEpisodes) || 0);
        const consistency = Number(profile?.consistency) || 0;

        if (key === 'daily') {
            if ((windows?.recent14?.activeDays || 0) <= 3) return 'Auto: kept lighter around your current rhythm';
            if (watchingCount >= 4) return `Auto: recent watch time + ${watchingCount} active shows`;
            if (consistency >= 0.7) return 'Auto: recent watch time with your steady pace';
            return 'Auto: based on your recent watch time';
        }

        if (key === 'weekly') {
            if (watchingCount >= 4) return `Auto: recent pace + ${watchingCount} active shows`;
            if (holdingCount >= Math.max(2, watchingCount)) return 'Auto: adjusted to stay realistic right now';
            if ((Number(profile?.recent7Rate) || 0) > (Number(profile?.recent30Rate) || 0) * 1.18) {
                return 'Auto: boosted from your latest weekly pace';
            }
            return 'Auto: based on your recent weekly pace';
        }

        if (remainingEpisodes >= 60) return 'Auto: scaled from weekly pace + current backlog';
        if (droppedCount >= 3) return 'Auto: slightly lighter to match your library flow';
        return 'Auto: scaled from weekly pace and library size';
    }

    function buildSmartGoalsSummary(context, profile, autoAdjusted) {
        const parts = ['recent pace'];
        const watchingCount = Math.max(0, Number(context?.watching) || 0);
        const consistency = Number(profile?.consistency) || 0;

        if (watchingCount > 0) {
            parts.push(`${watchingCount} active show${watchingCount === 1 ? '' : 's'}`);
        }
        parts.push(consistency >= 0.68 ? 'steady consistency' : (consistency >= 0.45 ? 'mixed consistency' : 'light consistency'));

        return autoAdjusted > 0
            ? `Smart goals updated automatically from ${parts.join(', ')}.`
            : `Smart goals adapt from ${parts.join(', ')}.`;
    }

    function buildSmartGoalPlan(animeData, index, goalSettings) {
        const defaults = getDefaultGoalSettings();
        const settings = {
            daily: { ...defaults.daily, ...(goalSettings?.daily || {}) },
            weekly: { ...defaults.weekly, ...(goalSettings?.weekly || {}) },
            monthly: { ...defaults.monthly, ...(goalSettings?.monthly || {}) }
        };

        const profile = index?.userProfile || {};
        const byDay = index?.byDay;
        const context = analyzeGoalContext(animeData);
        const hasWatchHistory = (Number(index?.totals?.episodes) || 0) > 0;
        const recent7 = getWindowTotals(byDay, 7);
        const recent14 = getWindowTotals(byDay, 14);
        const recent30 = getWindowTotals(byDay, 30);
        const avgEpisodeMinutes = (Number(index?.totals?.episodes) || 0) > 0
            ? ((Number(index?.totals?.seconds) || 0) / Math.max(1, Number(index?.totals?.episodes) || 0) / 60)
            : 24;

        const recent7Rate = Number(profile.recent7Rate) || (recent7.episodes / 7);
        const recent14Rate = Number(profile.recent14Rate) || (recent14.episodes / 14);
        const recent30Rate = Number(profile.recent30Rate) || (recent30.episodes / 30);
        const consistency = Number(profile.consistency) || 0;

        let dailyMinutes = defaults.daily.targetMinutes;
        if ((recent14.seconds || recent30.seconds) > 0) {
            const avgDaily14 = recent14.seconds / 14 / 60;
            const avgDaily30 = recent30.seconds / 30 / 60;
            const avgActive30 = recent30.activeDays > 0 ? (recent30.seconds / recent30.activeDays / 60) : avgDaily30;
            dailyMinutes = (avgDaily14 * 0.58) + (avgDaily30 * 0.24) + (avgActive30 * 0.18);
            if (context.watching >= 4) dailyMinutes *= 1.06;
            if ((context.onHold + context.dropped) > Math.max(2, context.watching + 1)) dailyMinutes *= 0.92;
            if (consistency >= 0.72) dailyMinutes *= 1.04;
            if (recent14.activeDays <= 3) dailyMinutes *= 0.88;
            dailyMinutes = clampNumber(roundToStep(dailyMinutes, 5), 20, 240);
        }

        let weeklyEpisodes = defaults.weekly.targetEpisodes;
        if ((recent7.episodes || recent14.episodes || recent30.episodes) > 0) {
            weeklyEpisodes = ((recent7Rate * 0.55) + (recent14Rate * 0.3) + (recent30Rate * 0.15)) * 7;
            weeklyEpisodes += Math.min(context.watching, 6) * 0.18;
            weeklyEpisodes += context.notStarted >= 8 ? 0.35 : 0;
            weeklyEpisodes -= context.onHold >= Math.max(2, context.watching) ? 0.6 : 0;
            weeklyEpisodes -= consistency < 0.42 ? 0.45 : 0;
            weeklyEpisodes = clampNumber(roundToStep(weeklyEpisodes, 1), 1, 60);
        }

        let monthlyEpisodes = defaults.monthly.targetEpisodes;
        if ((recent30.episodes || weeklyEpisodes) > 0) {
            monthlyEpisodes = ((recent30Rate * 30) * 0.65) + ((weeklyEpisodes * 4.2) * 0.35);
            monthlyEpisodes += Math.min(context.remainingEpisodes / 60, 3);
            monthlyEpisodes -= context.dropped >= 3 ? 1 : 0;
            monthlyEpisodes = clampNumber(roundToStep(monthlyEpisodes, 1), Math.max(4, weeklyEpisodes * 3), 240);
        }

        if (!Number.isFinite(dailyMinutes) || dailyMinutes <= 0) {
            dailyMinutes = clampNumber(roundToStep(avgEpisodeMinutes, 5), 20, 120);
        }
        if (!Number.isFinite(weeklyEpisodes) || weeklyEpisodes <= 0) weeklyEpisodes = defaults.weekly.targetEpisodes;
        if (!Number.isFinite(monthlyEpisodes) || monthlyEpisodes <= 0) monthlyEpisodes = Math.max(defaults.monthly.targetEpisodes, weeklyEpisodes * 4);

        const windows = { recent7, recent14, recent30 };
        const suggestions = {
            daily: {
                field: 'targetMinutes',
                target: dailyMinutes,
                display: `${dailyMinutes} min`,
                note: hasWatchHistory ? buildSmartGoalNote('daily', context, profile, windows) : 'Auto: starter default until you build watch history'
            },
            weekly: {
                field: 'targetEpisodes',
                target: weeklyEpisodes,
                display: `${weeklyEpisodes} ep`,
                note: hasWatchHistory ? buildSmartGoalNote('weekly', context, profile, windows) : 'Auto: starter default until your pace is clearer'
            },
            monthly: {
                field: 'targetEpisodes',
                target: monthlyEpisodes,
                display: `${monthlyEpisodes} ep`,
                note: hasWatchHistory ? buildSmartGoalNote('monthly', context, profile, windows) : 'Auto: starter default until your library flow is clearer'
            }
        };

        const nowMs = Date.now();
        const nowIso = new Date(nowMs).toISOString();
        const nextSettings = {
            daily: { ...settings.daily },
            weekly: { ...settings.weekly },
            monthly: { ...settings.monthly }
        };

        let shouldPersist = false;
        let autoAdjusted = 0;

        for (const key of Object.keys(suggestions)) {
            const suggestion = suggestions[key];
            const entry = nextSettings[key];
            const field = suggestion.field;
            const currentTarget = Math.max(0, Number(entry[field]) || defaults[key][field]);
            const manualOverrideUntil = toMillis(entry.manualOverrideUntil);
            const smartUpdatedAt = toMillis(entry.smartUpdatedAt);
            const isManualHold = manualOverrideUntil > nowMs;
            const cooldownPassed = !smartUpdatedAt || ((nowMs - smartUpdatedAt) >= SMART_GOAL_AUTO_INTERVAL_MS);
            const targetChanged = currentTarget !== suggestion.target;
            const canAutoApply = (entry.smartManaged !== false) && !isManualHold && targetChanged && cooldownPassed;

            suggestion.current = currentTarget;
            suggestion.manualHold = isManualHold;
            suggestion.autoApplied = canAutoApply;
            suggestion.status = isManualHold ? 'manual-hold' : (targetChanged ? 'suggested' : 'aligned');

            if (canAutoApply) {
                entry[field] = suggestion.target;
                entry.smartManaged = true;
                entry.smartUpdatedAt = nowIso;
                entry.updatedAt = nowIso;
                entry.smartReason = suggestion.note;
                suggestion.current = suggestion.target;
                suggestion.status = 'auto-applied';
                shouldPersist = true;
                autoAdjusted++;
            }
        }

        return {
            goalSettings: nextSettings,
            suggestions,
            shouldPersist,
            autoAdjusted,
            context,
            summary: {
                text: hasWatchHistory
                    ? buildSmartGoalsSummary(context, profile, autoAdjusted)
                    : 'Smart goals will adapt automatically once you build a little watch history.'
            }
        };
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
            daily:   { targetMinutes: 60, updatedAt: null, smartManaged: true, smartUpdatedAt: null, manualOverrideUntil: null, smartReason: null },
            weekly:  { targetEpisodes: 5, updatedAt: null, smartManaged: true, smartUpdatedAt: null, manualOverrideUntil: null, smartReason: null },
            monthly: { targetEpisodes: 20, updatedAt: null, smartManaged: true, smartUpdatedAt: null, manualOverrideUntil: null, smartReason: null }
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
        buildSmartGoalPlan,
        getDefaultGoalSettings,
        diffUnlocks,
        invalidate
    };

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.AchievementsEngine = AchievementsEngine;
})();
