(function () {
    'use strict';

    let _hourCache = null;

    function dayKey(date) {
        return window.AnimeTracker.StatsEngine.dayKey(date);
    }

    function monthKey(date) {
        return window.AnimeTracker.StatsEngine.monthKey(date);
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
                if (ep?.durationSource === 'anilist') continue;
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

    function countWatchedInHours(hourIndex, hours) {
        let count = 0;
        for (const hour of hours || []) {
            count += hourIndex?.hours?.get(hour) || 0;
        }
        return count;
    }

    const _hcCountMovies = { animeData: null, value: 0 };
    function countMovies(animeData) {
        if (_hcCountMovies.animeData === animeData) return _hcCountMovies.value;
        const Utils = window.AnimeTrackerMergeUtils;
        let count = 0;
        for (const slug in animeData || {}) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            const a = animeData[slug];
            if (!a || !Array.isArray(a.episodes) || a.episodes.length === 0) continue;
            if (Utils?.isLikelyMovieSlug?.(slug)) count++;
        }
        _hcCountMovies.animeData = animeData;
        _hcCountMovies.value = count;
        return count;
    }

    const _hcCountDropped = { animeData: null, value: 0 };
    function countDropped(animeData) {
        if (_hcCountDropped.animeData === animeData) return _hcCountDropped.value;
        let count = 0;
        for (const slug in animeData || {}) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            if (animeData[slug]?.droppedAt || animeData[slug]?.listState === 'dropped') count++;
        }
        _hcCountDropped.animeData = animeData;
        _hcCountDropped.value = count;
        return count;
    }

    const _hcCountOnHold = { animeData: null, value: 0 };
    function countOnHold(animeData) {
        if (_hcCountOnHold.animeData === animeData) return _hcCountOnHold.value;
        let count = 0;
        for (const slug in animeData || {}) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            if (animeData[slug]?.onHoldAt || animeData[slug]?.listState === 'on_hold') count++;
        }
        _hcCountOnHold.animeData = animeData;
        _hcCountOnHold.value = count;
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

    const _hcLongestEps = new Map();
    let _hcLongestEpsRef = null;
    function longestEpisodesInOneSeries(animeData, options) {
        const onlyCompleted = options?.onlyCompleted === true;
        if (_hcLongestEpsRef !== animeData) {
            _hcLongestEpsRef = animeData;
            _hcLongestEps.clear();
        }
        const key = onlyCompleted ? 'completed' : 'any';
        if (_hcLongestEps.has(key)) return _hcLongestEps.get(key);
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
        _hcLongestEps.set(key, best);
        return best;
    }

    const _hcWeekendEps = { animeData: null, value: 0 };
    function weekendEpisodes(animeData) {
        if (_hcWeekendEps.animeData === animeData) return _hcWeekendEps.value;
        let count = 0;
        for (const slug in animeData || {}) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            const a = animeData[slug];
            if (!a || !Array.isArray(a.episodes)) continue;
            for (const ep of a.episodes) {
                if (ep?.durationSource === 'anilist') continue;
                if (!ep?.watchedAt) continue;
                const d = new Date(ep.watchedAt);
                if (!Number.isFinite(d.getTime())) continue;
                const day = d.getDay();
                if (day === 0 || day === 6) count++;
            }
        }
        _hcWeekendEps.animeData = animeData;
        _hcWeekendEps.value = count;
        return count;
    }

    const _hcComebackGap = new Map();
    let _hcComebackGapRef = null;
    function hasComebackGap(animeData, gapDays) {
        if (_hcComebackGapRef !== animeData) {
            _hcComebackGapRef = animeData;
            _hcComebackGap.clear();
        }
        if (_hcComebackGap.has(gapDays)) return _hcComebackGap.get(gapDays);
        const gapMs = gapDays * 86400000;
        let found = false;
        outer:
        for (const slug in animeData || {}) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            const a = animeData[slug];
            if (!a || !Array.isArray(a.episodes) || a.episodes.length < 2) continue;
            const times = [];
            for (const ep of a.episodes) {
                if (ep?.durationSource === 'anilist') continue;
                if (!ep?.watchedAt) continue;
                const t = Date.parse(ep.watchedAt);
                if (Number.isFinite(t)) times.push(t);
            }
            if (times.length < 2) continue;
            times.sort((x, y) => x - y);
            for (let i = 1; i < times.length; i++) {
                if (times[i] - times[i - 1] >= gapMs) { found = true; break outer; }
            }
        }
        _hcComebackGap.set(gapDays, found);
        return found;
    }

    const _hcMaxComebackGap = { animeData: null, value: 0 };
    function maxComebackGapDays(animeData) {
        if (_hcMaxComebackGap.animeData === animeData) return _hcMaxComebackGap.value;
        let best = 0;
        for (const slug in animeData || {}) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            const a = animeData[slug];
            if (!a || !Array.isArray(a.episodes) || a.episodes.length < 2) continue;
            const times = [];
            for (const ep of a.episodes) {
                if (ep?.durationSource === 'anilist') continue;
                if (!ep?.watchedAt) continue;
                const t = Date.parse(ep.watchedAt);
                if (Number.isFinite(t)) times.push(t);
            }
            times.sort((x, y) => x - y);
            for (let i = 1; i < times.length; i++) {
                const days = Math.floor((times[i] - times[i - 1]) / 86400000);
                if (days > best) best = days;
            }
        }
        _hcMaxComebackGap.animeData = animeData;
        _hcMaxComebackGap.value = best;
        return best;
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

        { id: 'first_steps', group: 'volume', title: 'First Steps', desc: 'Watch your first episode',
          svg: 'sprout', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.episodes, 1), target: 1 }) },
        { id: 'starter_stack', group: 'volume', title: 'Starter Stack', desc: 'Watch 50 episodes',
          svg: 'book', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.episodes, 50), target: 50 }) },
        { id: 'century_club', group: 'volume', title: 'Century Club', desc: 'Watch 200 episodes',
          svg: 'hundred', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.episodes, 200), target: 200 }) },
        { id: 'double_century', group: 'volume', title: 'Double Century', desc: 'Watch 250 episodes',
          svg: 'bolt', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.episodes, 250), target: 250 }) },
        { id: 'marathoner_500', group: 'volume', title: 'Endurance Runner', desc: 'Watch 750 episodes',
          svg: 'rocket', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.episodes, 750), target: 750 }) },
        { id: 'marathoner_1k', group: 'volume', title: 'Marathoner', desc: 'Watch 1,500 episodes',
          svg: 'trophy', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.episodes, 1500), target: 1500 }) },


        { id: 'day_one_24h', group: 'time', title: '50-Hour Club', desc: 'Watch 50 hours total',
          svg: 'clock', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.seconds, 180000), target: 180000, unit: 'seconds' }) },
        { id: 'time_traveler', group: 'time', title: 'Time Traveler', desc: 'Watch 150 hours total',
          svg: 'hourglass', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.seconds, 540000), target: 540000, unit: 'seconds' }) },
        { id: 'time_keeper_250', group: 'time', title: 'Time Keeper', desc: 'Watch 400 hours total',
          svg: 'gem', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.seconds, 1440000), target: 1440000, unit: 'seconds' }) },
        { id: 'time_legend', group: 'time', title: 'Time Legend', desc: 'Watch 1,000 hours total',
          svg: 'clock', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.seconds, 3600000), target: 3600000, unit: 'seconds' }) },


        { id: 'completionist', group: 'series', title: 'Completionist', desc: 'Finish 5 series',
          svg: 'check', tier: 'bronze',
          progress: (ctx) => {
              const rows = ctx.categorize();
              return { current: Math.min(rows.completed.length, 5), target: 5 };
          } },
        { id: 'library_builder_10', group: 'series', title: 'Collection Started', desc: 'Track 10 anime',
          svg: 'books', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.animes, 10), target: 10 }) },
        { id: 'completionist_10', group: 'series', title: 'Series Collector', desc: 'Finish 25 series',
          svg: 'books', tier: 'silver',
          progress: (ctx) => {
              const rows = ctx.categorize();
              return { current: Math.min(rows.completed.length, 25), target: 25 };
          } },
        { id: 'completionist_25', group: 'series', title: 'Series Veteran', desc: 'Finish 60 series',
          svg: 'crown', tier: 'gold',
          progress: (ctx) => {
              const rows = ctx.categorize();
              return { current: Math.min(rows.completed.length, 60), target: 60 };
          } },
        { id: 'completionist_50', group: 'series', title: 'Series Master', desc: 'Finish 120 series',
          svg: 'crown', tier: 'platinum',
          progress: (ctx) => {
              const rows = ctx.categorize();
              return { current: Math.min(rows.completed.length, 120), target: 120 };
          } },
        { id: 'library_builder', group: 'series', title: 'Library Builder', desc: 'Track 75 anime',
          svg: 'book', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.animes, 75), target: 75 }) },
        { id: 'library_builder_75', group: 'series', title: 'Archive Curator', desc: 'Track 150 anime',
          svg: 'books', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.animes, 150), target: 150 }) },
        { id: 'library_builder_100', group: 'series', title: 'Archive Architect', desc: 'Track 300 anime',
          svg: 'books', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(ctx.index.totals.animes, 300), target: 300 }) },
        { id: 'short_runner', group: 'series', title: 'Short Runner', desc: 'Finish a 100+ episode series',
          svg: 'runner', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(longestEpisodesInOneSeries(ctx.animeData, { onlyCompleted: true }), 100), target: 100 }) },
        { id: 'season_runner', group: 'series', title: 'Season Runner', desc: 'Finish a 250+ episode series',
          svg: 'runner', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(longestEpisodesInOneSeries(ctx.animeData, { onlyCompleted: true }), 250), target: 250 }) },
        { id: 'long_runner', group: 'series', title: 'Long Runner', desc: 'Finish a 500+ episode series',
          svg: 'runner', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(longestEpisodesInOneSeries(ctx.animeData, { onlyCompleted: true }), 500), target: 500 }) },
        { id: 'epic_finisher', group: 'series', title: 'Epic Finisher', desc: 'Finish a 1,000+ episode series',
          svg: 'sword', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(longestEpisodesInOneSeries(ctx.animeData, { onlyCompleted: true }), 1000), target: 1000 }) },


        { id: 'movie_night', group: 'cinema', title: 'Movie Night', desc: 'Watch 5 anime movies',
          svg: 'clapper', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(countMovies(ctx.animeData), 5), target: 5 }) },
        { id: 'movie_buff', group: 'cinema', title: 'Movie Buff', desc: 'Watch 15 anime movies',
          svg: 'clapper', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(countMovies(ctx.animeData), 15), target: 15 }) },
        { id: 'double_feature', group: 'cinema', title: 'Film Curator', desc: 'Watch 40 anime movies',
          svg: 'film', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(countMovies(ctx.animeData), 40), target: 40 }) },
        { id: 'cinephile', group: 'cinema', title: 'Cinephile', desc: 'Watch 100 anime movies',
          svg: 'film', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(countMovies(ctx.animeData), 100), target: 100 }) },


        { id: 'streak_starter', group: 'streaks', title: 'Streak Starter', desc: '7-day watch streak',
          svg: 'calendar7', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(ctx.streak.longestStreak, 7), target: 7 }) },
        { id: 'power_hour', group: 'streaks', title: 'Power Hour', desc: 'Watch 8 episodes in a single day',
          svg: 'bolt', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(bestDailyEpisodeCount(ctx.index), 8), target: 8 }) },
        { id: 'marathon_day', group: 'streaks', title: 'Marathon Day', desc: 'Watch 15 episodes in a single day',
          svg: 'flame', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(bestDailyEpisodeCount(ctx.index), 15), target: 15 }) },
        { id: 'ultra_marathon', group: 'streaks', title: 'Ultra Marathon', desc: 'Watch 25 episodes in a single day',
          svg: 'rocket', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(bestDailyEpisodeCount(ctx.index), 25), target: 25 }) },
        { id: 'legendary_day', group: 'streaks', title: 'Legendary Day', desc: 'Watch 35 episodes in a single day',
          svg: 'trophy', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(bestDailyEpisodeCount(ctx.index), 35), target: 35 }) },
        { id: 'binge_week', group: 'streaks', title: 'Binge Week', desc: '14-day watch streak',
          svg: 'calendar7', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(ctx.streak.longestStreak, 14), target: 14 }) },
        { id: 'fortnight_fan', group: 'streaks', title: 'Fortnight Fan', desc: '14-day watch streak',
          svg: 'gem', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(ctx.streak.longestStreak, 14), target: 14 }) },
        { id: 'dedication', group: 'streaks', title: 'Dedication', desc: '45-day watch streak',
          svg: 'gem', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(ctx.streak.longestStreak, 45), target: 45 }) },
        { id: 'unstoppable', group: 'streaks', title: 'Unstoppable', desc: '100-day watch streak',
          svg: 'volcano', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(ctx.streak.longestStreak, 100), target: 100 }) },


        { id: 'night_owl', group: 'lifestyle', title: 'Night Owl', desc: 'Watch 5 episodes between 2am and 5am',
          svg: 'moon', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(countWatchedInHours(ctx.hourIndex, [2, 3, 4]), 5), target: 5 }) },
        { id: 'early_bird', group: 'lifestyle', title: 'Early Bird', desc: 'Watch 5 episodes between 4am and 7am',
          svg: 'sun', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(countWatchedInHours(ctx.hourIndex, [4, 5, 6]), 5), target: 5 }) },
        { id: 'night_owl_5', group: 'lifestyle', title: 'Moonlit Watcher', desc: 'Watch 25 episodes between 2am and 5am',
          svg: 'moon', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(countWatchedInHours(ctx.hourIndex, [2, 3, 4]), 25), target: 25 }) },
        { id: 'night_owl_20', group: 'lifestyle', title: 'Midnight Regular', desc: 'Watch 75 episodes between 2am and 5am',
          svg: 'moon', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(countWatchedInHours(ctx.hourIndex, [2, 3, 4]), 75), target: 75 }) },
        { id: 'night_owl_50', group: 'lifestyle', title: 'Nocturnal Legend', desc: 'Watch 150 episodes between 2am and 5am',
          svg: 'moon', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(countWatchedInHours(ctx.hourIndex, [2, 3, 4]), 150), target: 150 }) },
        { id: 'early_bird_5', group: 'lifestyle', title: 'Morning Watcher', desc: 'Watch 25 episodes between 4am and 7am',
          svg: 'sun', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(countWatchedInHours(ctx.hourIndex, [4, 5, 6]), 25), target: 25 }) },
        { id: 'early_bird_20', group: 'lifestyle', title: 'Sunrise Regular', desc: 'Watch 75 episodes between 4am and 7am',
          svg: 'sun', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(countWatchedInHours(ctx.hourIndex, [4, 5, 6]), 75), target: 75 }) },
        { id: 'early_bird_50', group: 'lifestyle', title: 'Dawn Legend', desc: 'Watch 150 episodes between 4am and 7am',
          svg: 'sun', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(countWatchedInHours(ctx.hourIndex, [4, 5, 6]), 150), target: 150 }) },
        { id: 'weekend_mood', group: 'lifestyle', title: 'Weekend Mood', desc: 'Watch 20 episodes on weekends',
          svg: 'couch', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(weekendEpisodes(ctx.animeData), 20), target: 20 }) },
        { id: 'weekend_warrior', group: 'lifestyle', title: 'Weekend Warrior', desc: 'Watch 75 episodes on weekends',
          svg: 'couch', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(weekendEpisodes(ctx.animeData), 75), target: 75 }) },
        { id: 'weekend_champion', group: 'lifestyle', title: 'Weekend Champion', desc: 'Watch 150 episodes on weekends',
          svg: 'couch', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(weekendEpisodes(ctx.animeData), 150), target: 150 }) },
        { id: 'weekend_legend', group: 'lifestyle', title: 'Weekend Legend', desc: 'Watch 300 episodes on weekends',
          svg: 'couch', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(weekendEpisodes(ctx.animeData), 300), target: 300 }) },
        { id: 'steady_companion', group: 'lifestyle', title: 'Steady Companion', desc: 'Watch one anime across 7+ days',
          svg: 'sakura', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(longestSpanDays(ctx.index), 7), target: 7 }) },
        { id: 'seasoned_companion', group: 'lifestyle', title: 'Seasoned Companion', desc: 'Watch one anime across 30+ days',
          svg: 'sakura', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(longestSpanDays(ctx.index), 30), target: 30 }) },
        { id: 'patient_viewer', group: 'lifestyle', title: 'Patient Viewer', desc: 'Watch one anime across 90+ days',
          svg: 'sakura', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(longestSpanDays(ctx.index), 90), target: 90 }) },
        { id: 'yearlong_companion', group: 'lifestyle', title: 'Long-haul Companion', desc: 'Watch one anime across 180+ days',
          svg: 'sakura', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(longestSpanDays(ctx.index), 180), target: 180 }) },
        { id: 'comeback_kid', group: 'lifestyle', title: 'Comeback Kid', desc: 'Return to a series after 30+ days',
          svg: 'loop', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(maxComebackGapDays(ctx.animeData), 30), target: 30 }) },
        { id: 'long_return', group: 'lifestyle', title: 'Long Return', desc: 'Return to a series after 90+ days',
          svg: 'loop', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(maxComebackGapDays(ctx.animeData), 90), target: 90 }) },
        { id: 'long_comeback', group: 'lifestyle', title: 'Long Comeback', desc: 'Return to a series after 180+ days',
          svg: 'loop', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(maxComebackGapDays(ctx.animeData), 180), target: 180 }) },
        { id: 'legendary_return', group: 'lifestyle', title: 'Legendary Return', desc: 'Return to a series after 365+ days',
          svg: 'loop', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(maxComebackGapDays(ctx.animeData), 365), target: 365 }) },
        { id: 'shelf_keeper', group: 'lifestyle', title: 'Shelf Keeper', desc: 'Put 2 anime on hold',
          svg: 'books', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(countOnHold(ctx.animeData), 2), target: 2 }) },
        { id: 'shelf_manager', group: 'lifestyle', title: 'Shelf Manager', desc: 'Put 5 anime on hold',
          svg: 'books', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(countOnHold(ctx.animeData), 5), target: 5 }) },
        { id: 'shelf_archivist', group: 'lifestyle', title: 'Shelf Archivist', desc: 'Put 12 anime on hold',
          svg: 'books', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(countOnHold(ctx.animeData), 12), target: 12 }) },
        { id: 'shelf_master', group: 'lifestyle', title: 'Shelf Master', desc: 'Put 25 anime on hold',
          svg: 'books', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(countOnHold(ctx.animeData), 25), target: 25 }) },
        { id: 'picky_viewer', group: 'lifestyle', title: 'Picky Viewer', desc: 'Drop 3 anime',
          svg: 'noEntry', tier: 'bronze',
          progress: (ctx) => ({ current: Math.min(countDropped(ctx.animeData), 3), target: 3 }) },
        { id: 'selective_viewer', group: 'lifestyle', title: 'Selective Viewer', desc: 'Drop 8 anime',
          svg: 'noEntry', tier: 'silver',
          progress: (ctx) => ({ current: Math.min(countDropped(ctx.animeData), 8), target: 8 }) },
        { id: 'strict_curator', group: 'lifestyle', title: 'Strict Curator', desc: 'Drop 18 anime',
          svg: 'noEntry', tier: 'gold',
          progress: (ctx) => ({ current: Math.min(countDropped(ctx.animeData), 18), target: 18 }) },
        { id: 'ruthless_curator', group: 'lifestyle', title: 'Ruthless Curator', desc: 'Drop 35 anime',
          svg: 'noEntry', tier: 'platinum',
          progress: (ctx) => ({ current: Math.min(countDropped(ctx.animeData), 35), target: 35 }) }
    ];

    const GROUP_DEFS = [
        { id: 'volume',    title: 'Volume' },
        { id: 'time',      title: 'Time' },
        { id: 'series',    title: 'Series' },
        { id: 'cinema',    title: 'Cinema' },
        { id: 'streaks',   title: 'Streaks' },
        { id: 'lifestyle', title: 'Lifestyle' }
    ];


    let _badgeCache = null;
    function evaluateBadges(animeData, index, hourIndex, options) {
        const existingUnlocks = options?.badgeState || {};


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

    // ── Airing-supply analysis ───────────────────────────────────────────
    // Looks at the AniList/an1me info cache (slug → { latestEpisode,
    // nextEpisodeAt, status, totalEpisodes }) to estimate how many episodes are
    // realistically *available to watch* in the near future for the shows the
    // user is actively following. This is what makes the smart goals
    // schedule-aware: goals should track real supply, not just past pace.
    //
    //   backlog        → episodes already out but not yet watched (catch-up).
    //   dropsNext7/30  → expected NEW episodes within 7 / 30 days, projected
    //                    from each show's weekly release cadence + the known
    //                    nextEpisodeAt countdown.
    //   airingCount    → how many followed shows are currently releasing.
    function analyzeUpcomingReleases(animeData, now = Date.now()) {
        const result = {
            airingCount: 0,
            backlog: 0,
            dropsNext7: 0,
            dropsNext30: 0,
            hasSchedule: false
        };

        const anilist = (typeof window !== 'undefined')
            ? window.AnimeTracker?.AnilistService
            : null;
        const cache = anilist?.cache;
        if (!cache || !animeData) return result;

        const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

        for (const slug in animeData) {
            if (!Object.prototype.hasOwnProperty.call(animeData, slug)) continue;
            const anime = animeData[slug];
            if (!anime) continue;
            // Only shows the user is actively following count toward supply.
            if (anime.droppedAt || anime.completedAt || anime.onHoldAt) continue;

            const info = cache[slug];
            if (!info || info.status !== 'RELEASING') continue;

            result.airingCount++;

            const latestAvail = Math.max(0, Number(info.latestEpisode) || 0);
            const highestWatched = Math.max(
                0,
                ...((Array.isArray(anime.episodes) ? anime.episodes : [])
                    .map(ep => Number(ep.number) || 0))
            );

            // Catch-up backlog: already-aired episodes the user hasn't watched.
            if (latestAvail > highestWatched) {
                result.backlog += (latestAvail - highestWatched);
            }

            // Projected future drops from the countdown to the next episode.
            // Weekly cadence is the norm for seasonal anime, so a show yields at
            // most ~1 new episode per 7 days. Overdue/aired episodes are already
            // counted in `backlog`, so here we only project genuinely future drops.
            const nextAtMs = info.nextEpisodeAt ? new Date(info.nextEpisodeAt).getTime() : NaN;
            if (Number.isFinite(nextAtMs)) {
                result.hasSchedule = true;
                const startMs = Math.max(nextAtMs, now);
                const end7 = now + 7 * 24 * 60 * 60 * 1000;
                const end30 = now + 30 * 24 * 60 * 60 * 1000;
                if (startMs <= end7) result.dropsNext7 += 1;
                if (startMs <= end30) {
                    // First drop at startMs, then one per week until the horizon.
                    const extraWeeks = Math.floor((end30 - startMs) / WEEK_MS);
                    result.dropsNext30 += Math.min(1 + extraWeeks, 5);
                }
            } else {
                // No countdown known but the show is releasing — assume the
                // typical one-episode-per-week cadence as a conservative guess.
                result.dropsNext7 += 1;
                result.dropsNext30 += 4;
            }
        }

        return result;
    }

    function buildSmartGoalNote(key, context, profile, windows, releases) {
        const watchingCount = Math.max(0, Number(context?.watching) || 0);
        const holdingCount = Math.max(0, Number(context?.onHold) || 0);
        const droppedCount = Math.max(0, Number(context?.dropped) || 0);
        const remainingEpisodes = Math.max(0, Number(context?.remainingEpisodes) || 0);
        const consistency = Number(profile?.consistency) || 0;

        const backlog = Math.max(0, Number(releases?.backlog) || 0);
        const drops7 = Math.max(0, Number(releases?.dropsNext7) || 0);
        const drops30 = Math.max(0, Number(releases?.dropsNext30) || 0);

        // Prefer an airing-supply explanation when there's a meaningful signal —
        // it's the most concrete reason for the target.
        const supplyPhrase = (drops) => {
            const bits = [];
            if (backlog > 0) bits.push(`${backlog} waiting`);
            if (drops > 0) bits.push(`${drops} airing soon`);
            return bits.join(' + ');
        };

        if (key === 'daily') {
            if ((windows?.recent14?.activeDays || 0) <= 3) return 'Auto: kept lighter around your current rhythm';
            if (backlog + drops7 >= 5 && consistency >= 0.5) return `Auto: episodes lined up this week (${supplyPhrase(drops7)})`;
            if (watchingCount >= 4) return `Auto: recent watch time + ${watchingCount} active shows`;
            if (consistency >= 0.7) return 'Auto: recent watch time with your steady pace';
            return 'Auto: based on your recent watch time';
        }

        if (key === 'weekly') {
            if (backlog + drops7 > 0 && (backlog + drops7) >= Math.max(2, watchingCount)) {
                return `Auto: tuned to what's watchable this week (${supplyPhrase(drops7)})`;
            }
            if (watchingCount >= 4) return `Auto: recent pace + ${watchingCount} active shows`;
            if (holdingCount >= Math.max(2, watchingCount)) return 'Auto: adjusted to stay realistic right now';
            if ((Number(profile?.recent7Rate) || 0) > (Number(profile?.recent30Rate) || 0) * 1.18) {
                return 'Auto: boosted from your latest weekly pace';
            }
            return 'Auto: based on your recent weekly pace';
        }

        if (backlog + drops30 > 0 && (backlog + drops30) >= 4) {
            return `Auto: scaled to your airing schedule (${supplyPhrase(drops30)})`;
        }
        if (remainingEpisodes >= 60) return 'Auto: scaled from weekly pace + current backlog';
        if (droppedCount >= 3) return 'Auto: slightly lighter to match your library flow';
        return 'Auto: scaled from weekly pace and library size';
    }

    function buildSmartGoalsSummary(context, profile, autoAdjusted, releases) {
        const parts = ['recent pace'];
        const watchingCount = Math.max(0, Number(context?.watching) || 0);
        const consistency = Number(profile?.consistency) || 0;

        const airingCount = Math.max(0, Number(releases?.airingCount) || 0);
        const backlog = Math.max(0, Number(releases?.backlog) || 0);
        const drops7 = Math.max(0, Number(releases?.dropsNext7) || 0);

        if (airingCount > 0 && (backlog + drops7) > 0) {
            parts.push(`${airingCount} airing show${airingCount === 1 ? '' : 's'}`);
        } else if (watchingCount > 0) {
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
        const releases = analyzeUpcomingReleases(animeData);
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

            // Airing-supply nudge: episodes you can realistically watch in the
            // next 7 days = catch-up backlog + expected new drops. We pull the
            // pace-based target a fraction of the way toward this supply, but
            // only UPWARD (more episodes are available than your pace assumes)
            // and weighted by consistency so flaky watchers aren't over-promised.
            const weeklySupply = releases.backlog + releases.dropsNext7;
            if (weeklySupply > 0) {
                const pullStrength = 0.18 + clampNumber(consistency, 0, 1) * 0.32; // 0.18..0.50
                if (weeklySupply > weeklyEpisodes) {
                    const gap = weeklySupply - weeklyEpisodes;
                    // Cap how much supply alone can add, so a huge backlog can't
                    // spike the goal to something demotivating.
                    const maxAdd = 2 + Math.round(clampNumber(consistency, 0, 1) * 4); // 2..6
                    weeklyEpisodes += Math.min(gap * pullStrength, maxAdd);
                }
            }

            weeklyEpisodes = clampNumber(roundToStep(weeklyEpisodes, 1), 1, 60);
        }

        let monthlyEpisodes = defaults.monthly.targetEpisodes;
        if ((recent30.episodes || weeklyEpisodes) > 0) {
            monthlyEpisodes = ((recent30Rate * 30) * 0.65) + ((weeklyEpisodes * 4.2) * 0.35);
            monthlyEpisodes += Math.min(context.remainingEpisodes / 60, 3);
            monthlyEpisodes -= context.dropped >= 3 ? 1 : 0;

            // Airing-supply nudge for the month: backlog + projected 30-day drops.
            const monthlySupply = releases.backlog + releases.dropsNext30;
            if (monthlySupply > 0) {
                const pullStrength = 0.18 + clampNumber(consistency, 0, 1) * 0.30; // 0.18..0.48
                if (monthlySupply > monthlyEpisodes) {
                    const gap = monthlySupply - monthlyEpisodes;
                    const maxAdd = 6 + Math.round(clampNumber(consistency, 0, 1) * 12); // 6..18
                    monthlyEpisodes += Math.min(gap * pullStrength, maxAdd);
                }
            }

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
                note: hasWatchHistory ? buildSmartGoalNote('daily', context, profile, windows, releases) : 'Auto: starter default until you build watch history'
            },
            weekly: {
                field: 'targetEpisodes',
                target: weeklyEpisodes,
                display: `${weeklyEpisodes} ep`,
                note: hasWatchHistory ? buildSmartGoalNote('weekly', context, profile, windows, releases) : 'Auto: starter default until your pace is clearer'
            },
            monthly: {
                field: 'targetEpisodes',
                target: monthlyEpisodes,
                display: `${monthlyEpisodes} ep`,
                note: hasWatchHistory ? buildSmartGoalNote('monthly', context, profile, windows, releases) : 'Auto: starter default until your library flow is clearer'
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
            releases,
            summary: {
                text: hasWatchHistory
                    ? buildSmartGoalsSummary(context, profile, autoAdjusted, releases)
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
