const CONFIG = {
    EPISODE_TYPES_CACHE_TTL: 24 * 60 * 60 * 1000,
    FILLER_NOT_FOUND_CACHE_TTL: 3 * 24 * 60 * 60 * 1000,

    SEARCH_DEBOUNCE_MS: 150,
    STORAGE_UPDATE_DEBOUNCE_MS: 600,

    AUTO_FETCH_BATCH_SIZE: 3,
    AUTO_FETCH_BASE_DELAY_MS: 1000,
    AUTO_FETCH_MAX_TOTAL: 30,

    VISIBLE_EPISODES_LIMIT: 10,
    VISIBLE_FILLERS_LIMIT: 6,
    COMPLETED_LIST_MIN_DAYS: 4,

    COMPLETED_PERCENTAGE: 85,

    CLOUD_SAVE_DEBOUNCE_MS: 2000,
    MAX_CLOUD_SAVE_RETRIES: 3,
    MAX_RETRY_DELAY_MS: 30000
};

const DONATE_LINKS = {
    paypal: 'https://www.paypal.me/ThomasThanos',
    revolut: 'https://revolut.me/thomas2873'
};

const ANIME_PARTS_CONFIG = {
    'fate-zero': [
        { name: 'Fate/Zero S1', start: 1, end: 13, displayStart: 1, displayEnd: 13 },
        { name: 'Fate/Zero S2', start: 14, end: 25, displayStart: 1, displayEnd: 12 }
    ],
    'bleach-sennen-kessen-hen': [
        { name: 'Part 1', start: 1, end: 13 },
        { name: 'Part 2: Ketsubetsu-tan', start: 14, end: 26 },
        { name: 'Part 3: Soukoku-tan', start: 27, end: 40 }
    ],
};

// Single source of truth lives in src/common/multipart-mappings.js.
const CANONICAL_EPISODE_OFFSET_MAPPING =
    (typeof window !== 'undefined' && window.AnimeTrackerMultipartMappings?.EPISODE_OFFSET_MAPPING) || {};

const SERIES_MOVIE_MERGE_SLUGS = new Set([
    'trinity-seven',
    'fate',
]);

const SeasonGrouping = {
    isChronologyGroup(baseSlug) {
        return baseSlug === 'fate';
    },

    isMovie(slug, anime = null) {
        const lowerSlug = String(slug || '').toLowerCase();
        if (!lowerSlug) return false;
        const lowerTitle = String(anime?.title || '').toLowerCase();

        if (lowerSlug.includes('initial-d') && (lowerSlug.includes('third-stage') || lowerSlug.includes('3rd-stage'))) {
            return false;
        }

        if (lowerSlug === 'trinity-seven-nanatsu-no-taizai-to-nana-madoushi') return true;

        const anilistTotal = window.AnimeTracker?.AnilistService?.getTotalEpisodes(lowerSlug);
        const anilistStatus = window.AnimeTracker?.AnilistService?.getStatus(lowerSlug);
        if (anilistTotal === 1 && anilistStatus !== 'RELEASING') return true;

        const moviePatterns = [
            /-movie(-|$)/i,
            /-film(-|$)/i,
            /-gekijouban/i,
            /-the-movie/i,
            /^.*-movie-\d+/i,
            /-3d-/i,
            /-two-heroes$/i,
            /-heroes-rising$/i,
            /-world-heroes-mission$/i,
            /-super-hero$/i,
            /-broly$/i,
            /-the-last$/i,
            /-mugen-train$/i
        ];
        if (moviePatterns.some(pattern => pattern.test(lowerSlug))) {
            return true;
        }

        const titleMoviePatterns = [
            /\bmovie\b/i,
            /\bfilm\b/i,
            /\bthe movie\b/i,
            /\bgekijouban\b/i,
        ];

        const nonMoviePatterns = [
            /-ova(-|$)/i,
            /-ona(-|$)/i,
            /-special(-|$)/i,
            /-recap(-|$)/i
        ];
        const titleNonMoviePatterns = [
            /\bova\b/i,
            /\bona\b/i,
            /\bspecial\b/i,
            /\brecap\b/i
        ];

        const hasNonMovieHint = nonMoviePatterns.some(pattern => pattern.test(lowerSlug)) ||
            titleNonMoviePatterns.some(pattern => pattern.test(lowerTitle));
        const hasTitleMovieHint = titleMoviePatterns.some(pattern => pattern.test(lowerTitle));
        if (hasTitleMovieHint && !hasNonMovieHint) {
            return true;
        }

        if (!anime || typeof anime !== 'object') {
            return false;
        }

        const totalEpisodes = Number.isFinite(anime.totalEpisodes) ? anime.totalEpisodes : null;
        const trackedEpisodes = Array.isArray(anime.episodes) ? anime.episodes.length : 0;
        const totalWatchTimeSeconds = Number(anime.totalWatchTime) || 0;
        const avgMinutes = trackedEpisodes > 0 ? (totalWatchTimeSeconds / 60) / trackedEpisodes : 0;

        const hasSeriesSlugHint = /-season-?\d+|-s\d+|-(part|cour)-?\d+|-\d+(st|nd|rd|th)-season|-(ii|iii|iv|v|vi)$/i.test(lowerSlug);
        const hasSeriesTitleHint = /\bseason\b|\bpart\b|\bcour\b/i.test(lowerTitle);

        if (hasSeriesSlugHint || hasSeriesTitleHint || hasNonMovieHint) {
            return false;
        }

        if (totalEpisodes === 1) return true;
        if (trackedEpisodes === 1 && avgMinutes >= 70) return true;

        return false;
    },

    getMovieNumber(slug) {
        if (slug.includes('one-piece-3d-mugiwara-chase')) return 11;

        let match = slug.match(/-movie-0?(\d+)/i);
        if (match) return parseInt(match[1], 10);

        const romanMatch = slug.match(/-(i{1,3}|iv|v)(?:-|$)/i);
        if (romanMatch) {
            const romanMap = { 'i': 1, 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5 };
            return romanMap[romanMatch[1].toLowerCase()] || 1;
        }

        if (slug.includes('higashi-no-eden')) {
            if (slug.includes('king') || slug.includes('-1')) return 1;
            if (slug.includes('paradise') || slug.includes('-2')) return 2;
        }

        const filmOrder = {
            'film-gold': 13,
            'film-red': 15,
            'film-z': 12,
            'film-strong-world': 10
        };
        for (const [filmSlug, num] of Object.entries(filmOrder)) {
            if (slug.includes(filmSlug)) return num;
        }

        return 1;
    },

    getMovieBaseSlug(slug) {
        if (slug.startsWith('fate-zero') || slug.startsWith('fate-stay-night')) return 'fate';
        if (slug.startsWith('trinity-seven-nanatsu')) return 'trinity-seven';
        if (slug.startsWith('kimetsu-no-yaiba')) return 'kimetsu-no-yaiba';
        if (slug.startsWith('higashi-no-eden')) return 'higashi-no-eden';
        if (slug.startsWith('one-piece')) return 'one-piece';
        if (slug.startsWith('dragon-ball')) return 'dragon-ball';
        if (slug.startsWith('naruto')) return 'naruto';

        return slug
            .replace(/-movie.*$/i, '')
            .replace(/-film.*$/i, '')
            .replace(/-3d.*$/i, '')
            .replace(/-gekijouban.*$/i, '')
            .replace(/-the-movie.*$/i, '');
    },

    getBaseSlug(slug, anime = null) {
        if (this.isMovie(slug, anime)) {
            return this.getMovieBaseSlug(slug);
        }

        if (slug.startsWith('fate-zero') || slug.startsWith('fate-stay-night')) return 'fate';
        if (slug.startsWith('naruto')) return 'naruto';
        if (slug.startsWith('one-punch-man')) return 'one-punch-man';
        if (slug.startsWith('one-piece')) return 'one-piece';
        if (slug.startsWith('kimetsu-no-yaiba')) return 'kimetsu-no-yaiba';
        if (slug.startsWith('shingeki-no-kyojin')) return 'shingeki-no-kyojin';
        if (slug.startsWith('initial-d')) return 'initial-d';
        if (slug.startsWith('bleach')) return 'bleach';

        return slug
            .replace(/-season-?\d+(-[a-z-]+)?$/i, '')
            .replace(/-s\d+$/i, '')
            .replace(/-\d+(st|nd|rd|th)-season$/i, '')
            .replace(/-(part|cour)-?\d+(-[a-z-]+)?$/i, '')
            .replace(/-20\d{2}$/i, '')
            .replace(/-(ii|iii|iv|v|vi)$/i, '')
            .replace(/-[a-z]+-hen$/i, '');
    },

    getChronologyInfo(baseSlug, slug, title = '') {
        if (baseSlug !== 'fate') return null;

        const lowerSlug = String(slug || '').toLowerCase();
        const rawTitle = String(title || '').trim();

        if (lowerSlug.startsWith('fate-zero')) {
            return {
                order: 10,
                separatorLabel: '1994',
                itemLabel: 'Fate/Zero'
            };
        }

        if (lowerSlug === 'fate-stay-night') {
            return {
                order: 20,
                separatorLabel: '2004',
                itemLabel: 'Fate/stay night'
            };
        }

        if (lowerSlug.includes('unlimited-blade-works-prologue')) {
            return {
                order: 30,
                separatorLabel: '2004',
                itemLabel: 'Unlimited Blade Works - Prologue'
            };
        }

        if (lowerSlug.includes('unlimited-blade-works-season-2')) {
            return {
                order: 40,
                separatorLabel: '2004',
                itemLabel: 'Unlimited Blade Works Season 2'
            };
        }

        if (lowerSlug.includes('unlimited-blade-works')) {
            return {
                order: 35,
                separatorLabel: '2004',
                itemLabel: 'Unlimited Blade Works'
            };
        }

        if (lowerSlug.includes('heavens-feel-1')) {
            return {
                order: 50,
                separatorLabel: '2004',
                itemLabel: 'Heaven\'s Feel I: Presage Flower'
            };
        }

        if (lowerSlug.includes('heavens-feel-2')) {
            return {
                order: 51,
                separatorLabel: '2004',
                itemLabel: 'Heaven\'s Feel II: Lost Butterfly'
            };
        }

        if (lowerSlug.includes('heavens-feel-3')) {
            return {
                order: 52,
                separatorLabel: '2004',
                itemLabel: 'Heaven\'s Feel III: Spring Song'
            };
        }

        if (lowerSlug.includes('heavens-feel')) {
            return {
                order: 50,
                separatorLabel: '2004',
                itemLabel: rawTitle || 'Heaven\'s Feel'
            };
        }

        return {
            order: 900,
            separatorLabel: 'Other',
            itemLabel: rawTitle || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        };
    },

    getGroupDisplayTitle(baseSlug, fallbackTitle = '') {
        if (baseSlug === 'fate') return 'Fate';
        return fallbackTitle;
    },

    getSeasonNumber(slug) {
        if (slug.startsWith('one-piece')) {
            if (slug.includes('new-world')) return 2;
            return 1;
        }

        if (slug.startsWith('one-punch-man')) {
            if (slug.includes('season-3') || slug.endsWith('-3')) return 3;
            if (slug.includes('season-2') || slug.includes('2nd-season')) return 2;
            return 1;
        }

        if (slug.startsWith('jujutsu-kaisen')) {
            if (slug.includes('culling-game') || slug.includes('season-3') || slug.includes('dead-culling-game') || slug.includes('shimetsu-kaiyuu')) return 3;
            if (slug.includes('season-2') || slug.includes('2nd-season') || slug.includes('shibuya-incident') || slug.includes('kaigyoku-gyokusetsu')) return 2;
            if (slug.includes('0') || slug.includes('movie')) return 0;
            return 1;
        }

        if (slug.startsWith('naruto') || slug.startsWith('boruto')) {
            const slugLower = slug.toLowerCase();
            if (slugLower.includes('boruto') || slugLower.includes('-3') || slugLower.includes('season-3')) return 3;
            if (slugLower.includes('shippuden') || slugLower.includes('shippuuden') || slugLower.includes('-2') || slugLower.includes('season-2')) return 2;
            return 1;
        }

        if (slug.startsWith('kimetsu-no-yaiba')) {
            if (slug.includes('hashira-geiko-hen')) return 5;
            if (slug.includes('katanakaji-no-sato-hen')) return 4;
            if (slug.includes('yuukaku-hen')) return 3;
            if (slug.includes('mugen-ressha-hen')) return 2;
            return 1;
        }

        if (slug.startsWith('shingeki-no-kyojin')) {
            if (slug.includes('final-season-kanketsu-hen')) return 7;
            if (slug.includes('final-season-part-2')) return 6;
            if (slug.includes('final-season')) return 5;
            if (slug.includes('season-3-part-2')) return 4;
            if (slug.includes('season-3')) return 3;
            if (slug.includes('season-2')) return 2;
            return 1;
        }

        if (slug.startsWith('initial-d')) {
            if (slug.includes('final-stage') || slug.includes('sixth-stage') || slug.includes('6th-stage')) return 6;
            if (slug.includes('fifth-stage') || slug.includes('5th-stage')) return 5;
            if (slug.includes('fourth-stage') || slug.includes('4th-stage')) return 4;
            if (slug.includes('third-stage') || slug.includes('3rd-stage')) return 3;
            if (slug.includes('second-stage') || slug.includes('2nd-stage')) return 2;
            return 1;
        }

        let match = slug.match(/-season-?(\d+)/i);
        if (match) return parseInt(match[1], 10);

        match = slug.match(/-s(\d+)$/i);
        if (match) return parseInt(match[1], 10);

        match = slug.match(/-(\d+)(st|nd|rd|th)-season$/i);
        if (match) return parseInt(match[1], 10);

        const romanMatch = slug.match(/-(ii|iii|iv|v|vi)$/i);
        if (romanMatch) {
            const romanMap = { 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5, 'vi': 6 };
            return romanMatch[1].toLowerCase() in romanMap ? romanMap[romanMatch[1].toLowerCase()] : 1;
        }

        if (slug.startsWith('bleach')) {
            if (slug.includes('sennen-kessen-hen')) return 2;
            return 1;
        }

        if (slug === 'trinity-seven-nanatsu-no-taizai-to-nana-madoushi') return 2;

        return 1;
    },

    getSeasonLabel(slug, title) {
        if (slug.startsWith('one-piece')) {
            if (slug.includes('new-world')) return 'New World';
            return 'East Blue & Grandline';
        }

        if (slug.startsWith('one-punch-man')) {
            if (slug.includes('season-3') || slug.endsWith('-3')) return 'Season 3';
            if (slug.includes('season-2') || slug.includes('2nd-season')) return 'Season 2';
            return 'Season 1';
        }

        if (slug.startsWith('naruto') || slug.startsWith('boruto')) {
            const slugLower = slug.toLowerCase();
            const titleLower = title ? title.toLowerCase() : '';

            if (slugLower.includes('boruto') || slugLower.endsWith('-3') || slugLower.includes('season-3')) return 'Naruto Boruto';
            if (titleLower.includes('boruto')) return 'Naruto Boruto';
            if (slugLower.includes('shippuden') || slugLower.includes('shippuuden')) return 'Naruto Shippuden';
            if (slugLower.endsWith('-2') || slugLower.includes('season-2')) return 'Naruto Shippuden';
            if (titleLower.includes('shippuden') || titleLower.includes('shippuuden')) return 'Naruto Shippuden';
            return 'Naruto';
        }

        if (slug.startsWith('jujutsu-kaisen')) {
            if (slug.includes('culling-game') || slug.includes('season-3') || slug.includes('dead-culling-game') || slug.includes('shimetsu-kaiyuu')) return 'Season 3';
            if (slug.includes('season-2') || slug.includes('2nd-season') || slug.includes('shibuya-incident') || slug.includes('kaigyoku-gyokusetsu')) return 'Season 2';
            if (slug.includes('0') || slug.includes('movie')) return 'Movie 0';
            return 'Season 1';
        }

        if (slug.startsWith('kimetsu-no-yaiba')) {
            if (slug.includes('hashira-geiko-hen')) return 'Hashira Training Arc';
            if (slug.includes('katanakaji-no-sato-hen')) return 'Swordsmith Village Arc';
            if (slug.includes('yuukaku-hen')) return 'Entertainment District Arc';
            if (slug.includes('mugen-ressha-hen')) return 'Mugen Train Arc';
            return 'Season 1';
        }

        if (slug.startsWith('shingeki-no-kyojin')) {
            if (slug.includes('final-season-kanketsu-hen')) return 'Final Season Part 3';
            if (slug.includes('final-season-part-2')) return 'Final Season Part 2';
            if (slug.includes('final-season')) return 'Final Season Part 1';
            if (slug.includes('season-3-part-2')) return 'Season 3 Part 2';
            if (slug.includes('season-3')) return 'Season 3 Part 1';
            if (slug.includes('season-2')) return 'Season 2';
            return 'Season 1';
        }

        if (slug.startsWith('initial-d')) {
            if (slug.includes('final-stage') || slug.includes('sixth-stage') || slug.includes('6th-stage')) return 'Final Stage';
            if (slug.includes('fifth-stage') || slug.includes('5th-stage')) return 'Fifth Stage';
            if (slug.includes('fourth-stage') || slug.includes('4th-stage')) return 'Fourth Stage';
            if (slug.includes('third-stage') || slug.includes('3rd-stage')) return 'Third Stage (Movie)';
            if (slug.includes('second-stage') || slug.includes('2nd-stage')) return 'Second Stage';
            return 'First Stage';
        }

        if (slug.includes('bleach-sennen-kessen-hen')) {
            if (slug.includes('soukoku-tan')) return 'TYBW Part 3';
            if (slug.includes('ketsubetsu-tan')) return 'TYBW Part 2';
            return 'Thousand-Year Blood War';
        }

        if (slug === 'trinity-seven-nanatsu-no-taizai-to-nana-madoushi') return 'Movie: Nanatsu no Taizai to Nana Madoushi';

        const seasonNum = this.getSeasonNumber(slug);
        return `Season ${seasonNum}`;
    },

    getMovieLabel(slug, title) {
        if (slug.includes('higashi-no-eden')) {
            if (slug.includes('-i-') || slug.includes('-1-') || slug.endsWith('-i')) return 'Movie I: King of Eden';
            if (slug.includes('-ii-') || slug.includes('-2-') || slug.endsWith('-ii')) return 'Movie II: Paradise Lost';
            if (title) {
                if (title.toLowerCase().includes('king')) return 'Movie I: King of Eden';
                if (title.toLowerCase().includes('paradise')) return 'Movie II: Paradise Lost';
            }
        }

        const filmMatch = slug.match(/-film-([a-z-]+)/i);
        if (filmMatch) {
            const filmName = filmMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            return `Film: ${filmName}`;
        }

        const movieMatch = slug.match(/-movie-0?(\d+)/i);
        if (movieMatch) return `Movie ${movieMatch[1]}`;

        const romanMatch = slug.match(/-movie-?(i{1,3}|iv|v)(?:-|$)/i);
        if (romanMatch) {
            const romanMap = { 'i': 'I', 'ii': 'II', 'iii': 'III', 'iv': 'IV', 'v': 'V' };
            return `Movie ${romanMap[romanMatch[1].toLowerCase()] || romanMatch[1].toUpperCase()}`;
        }

        if (title) {
            const romanTitleMatch = title.match(/Movie\s*(I{1,3}|IV|V)\b/i);
            if (romanTitleMatch) return `Movie ${romanTitleMatch[1].toUpperCase()}`;

            const numTitleMatch = title.match(/Movie\s*(\d+)/i);
            if (numTitleMatch) return `Movie ${numTitleMatch[1]}`;

            const leadingNumMovieMatch = title.match(/\b(\d+)\s*Movie\b/i);
            if (leadingNumMovieMatch) return `Movie ${leadingNumMovieMatch[1]}`;

            const filmTitleMatch = title.match(/Film[:\s]+([A-Za-z]+)/i);
            if (filmTitleMatch) return `Film: ${filmTitleMatch[1]}`;
        }

        if (title) {
            const baseSlug = this.getMovieBaseSlug(slug);
            const baseTitle = baseSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const cleaned = title.replace(new RegExp(`^${baseTitle}\\s*[:\\-]?\\s*`, 'i'), '').trim();
            if (cleaned) return cleaned;
            return title.trim();
        }

        return 'Movie';
    },

    groupByBase(animeEntries) {
        const groups = new Map();
        const movieGroups = new Map();

        for (const [slug, anime] of animeEntries) {
            const isMovie = this.isMovie(slug, anime);
            const baseSlug = this.getBaseSlug(slug, anime);
            const chronologyInfo = this.getChronologyInfo(baseSlug, slug, anime?.title || '');

            if (isMovie) {
                const movieGroupKey = baseSlug + '__movies';
                if (!movieGroups.has(movieGroupKey)) movieGroups.set(movieGroupKey, []);
                movieGroups.get(movieGroupKey).push({
                    slug, anime,
                    movieNum: this.getMovieNumber(slug),
                    seasonNum: chronologyInfo?.order ?? this.getMovieNumber(slug),
                    chronologyLabel: chronologyInfo?.separatorLabel || null,
                    chronologyItemLabel: chronologyInfo?.itemLabel || null,
                    isMovie: true
                });
            } else {
                if (!groups.has(baseSlug)) groups.set(baseSlug, []);
                groups.get(baseSlug).push({
                    slug,
                    anime,
                    seasonNum: chronologyInfo?.order ?? this.getSeasonNumber(slug),
                    chronologyLabel: chronologyInfo?.separatorLabel || null,
                    chronologyItemLabel: chronologyInfo?.itemLabel || null
                });
            }
        }

        this.mergeRelatedGroups(groups);

        for (const [, entries] of groups) {
            entries.sort((a, b) => a.seasonNum - b.seasonNum);
        }

        for (const [, entries] of movieGroups) {
            if (entries.length > 0 && this.isChronologyGroup(this.getBaseSlug(entries[0].slug, entries[0].anime))) {
                entries.sort((a, b) => (a.seasonNum || 0) - (b.seasonNum || 0));
                continue;
            }

            entries.sort((a, b) => {
                if (a.movieNum !== b.movieNum) return a.movieNum - b.movieNum;
                const aExplicit = /-movie-0?\d+/i.test(a.slug) ? 0 : 1;
                const bExplicit = /-movie-0?\d+/i.test(b.slug) ? 0 : 1;
                if (aExplicit !== bExplicit) return aExplicit - bExplicit;
                const aLabel = this.getMovieLabel(a.slug, a.anime?.title || '');
                const bLabel = this.getMovieLabel(b.slug, b.anime?.title || '');
                return aLabel.localeCompare(bLabel, 'en', { numeric: true, sensitivity: 'base' });
            });
        }

        for (const [groupKey, entries] of movieGroups) {
            const baseSlug = groupKey.replace(/__movies$/, '');
            if (groups.has(baseSlug) && SERIES_MOVIE_MERGE_SLUGS.has(baseSlug)) {
                const seriesGroup = groups.get(baseSlug);
                const maxSeasonNum = seriesGroup.reduce((m, e) => Math.max(m, e.seasonNum || 0), 0);
                entries.forEach((entry, i) => {
                    seriesGroup.push({
                        slug: entry.slug,
                        anime: entry.anime,
                        seasonNum: this.isChronologyGroup(baseSlug)
                            ? (entry.seasonNum || (maxSeasonNum + 1 + i))
                            : (maxSeasonNum + 1 + i),
                        chronologyLabel: entry.chronologyLabel || null,
                        chronologyItemLabel: entry.chronologyItemLabel || null,
                        isMovie: true
                    });
                });
                seriesGroup.sort((a, b) => (a.seasonNum || 0) - (b.seasonNum || 0));
            } else if (this.isChronologyGroup(baseSlug)) {
                groups.set(baseSlug, entries.map(entry => ({
                    slug: entry.slug,
                    anime: entry.anime,
                    seasonNum: entry.seasonNum || 0,
                    chronologyLabel: entry.chronologyLabel || null,
                    chronologyItemLabel: entry.chronologyItemLabel || null,
                    isMovie: false
                })));
            } else {
                groups.set(groupKey, entries);
            }
        }

        return groups;
    },

    mergeRelatedGroups(groups) {
        const baseSlugs = Array.from(groups.keys()).sort((a, b) => a.length - b.length);
        const merged = new Set();

        for (let i = 0; i < baseSlugs.length; i++) {
            const shorter = baseSlugs[i];
            if (merged.has(shorter)) continue;

            for (let j = i + 1; j < baseSlugs.length; j++) {
                const longer = baseSlugs[j];
                if (merged.has(longer)) continue;

                if (longer.startsWith(shorter + '-')) {
                    const shorterEntries = groups.get(shorter);
                    const longerEntries = groups.get(longer);

                    longerEntries.forEach(entry => {
                        if (entry.seasonNum === 1 && longerEntries.length === 1) {
                            const maxSeason = Math.max(...shorterEntries.map(e => e.seasonNum));
                            entry.seasonNum = maxSeason + 1;
                        }
                        shorterEntries.push(entry);
                    });

                    groups.delete(longer);
                    merged.add(longer);
                }
            }
        }
    },

    hasMultipleSeasons(group) {
        return group.length > 1;
    },

    isMovieGroup(group) {
        return group.length > 0 && group[0].isMovie === true;
    }
};

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.CONFIG = CONFIG;
window.AnimeTracker.DONATE_LINKS = DONATE_LINKS;
window.AnimeTracker.ANIME_PARTS_CONFIG = ANIME_PARTS_CONFIG;
window.AnimeTracker.CANONICAL_EPISODE_OFFSET_MAPPING = CANONICAL_EPISODE_OFFSET_MAPPING;
window.AnimeTracker.SERIES_MOVIE_MERGE_SLUGS = SERIES_MOVIE_MERGE_SLUGS;
window.AnimeTracker.SeasonGrouping = SeasonGrouping;