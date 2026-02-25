/**
 * Anime Tracker - Configuration Constants
 */

const CONFIG = {
    // Cache settings
    EPISODE_TYPES_CACHE_TTL: 24 * 60 * 60 * 1000, // 24 hours
    ORPHAN_PROGRESS_MAX_AGE: 14 * 24 * 60 * 60 * 1000, // 14 days

    // UI settings
    SEARCH_DEBOUNCE_MS: 150,
    CLOUD_SAVE_DEBOUNCE_MS: 500,
    STORAGE_UPDATE_DEBOUNCE_MS: 300,

    // Retry settings
    MAX_CLOUD_SAVE_RETRIES: 5,
    MAX_RETRY_DELAY_MS: 30000,

    // Rate limiting for auto-fetch
    AUTO_FETCH_BATCH_SIZE: 3,
    AUTO_FETCH_BASE_DELAY_MS: 1000,

    // Episode display limits
    VISIBLE_EPISODES_LIMIT: 10,
    VISIBLE_FILLERS_LIMIT: 6,

    // Progress thresholds
    COMPLETED_PERCENTAGE: 85,
    SIGNIFICANT_PROGRESS_PERCENTAGE: 5,
    SIGNIFICANT_WATCH_TIME_SECONDS: 120
};

// Donate links
const DONATE_LINKS = {
    paypal: 'https://www.paypal.me/ThomasThanos',
    revolut: 'https://revolut.me/thomas2873'
};

// Anime that don't have filler data on animefillerlist.com
// Skip fetching for these to avoid 404 errors
// Note: Movies/OVAs/Specials are auto-detected by FillerService.isLikelyMovie()
const ANIME_NO_FILLER_DATA = [
    'ore-dake-level-up-na-ken',           // Solo Leveling
    'ore-dake-level-up-na-ken-season-2',  // Solo Leveling Season 2
    // Add more anime without filler data here as needed
    'tokidoki-bosotto-russia-go-de-dereru-tonari-no-alya-san', // Alya Sometimes Hides Her Feelings
    'kuzu-no-honkai', // Scum's Wish
    'yosuga-no-sora',
    'jujutsu-kaisen-shimetsu-kaiyuu-zenpen', // Culling Game Prequel/Special
    'initial-d-fourth-stage', // Likely no specific filler list or handled by main
];

// Slug mapping for anime that have different names on animefillerlist.com
// Note: Most season variations are handled automatically by the intelligent slug transformer
// Only add mappings here for special cases that can't be auto-detected
const ANIME_FILLER_LIST_SLUG_MAPPING = {
    // Special cases with complex naming
    'hunter-x-hunter-2011': 'hunter-x-hunter',

    // Bleach TYBW variations
    'bleach-sennen-kessen-hen': 'bleach-thousand-year-blood-war',
    'bleach-sennen-kessen-hen-ketsubetsu-tan': 'bleach-thousand-year-blood-war',
    'bleach-sennen-kessen-hen-soukoku-tan': 'bleach-thousand-year-blood-war',

    // Demon Slayer seasons - all map to main series
    'kimetsu-no-yaiba-mugen-train': 'demon-slayer-kimetsu-no-yaiba',
    'kimetsu-no-yaiba-mugen-ressha-hen': 'demon-slayer-kimetsu-no-yaiba',
    'kimetsu-no-yaiba-yuukaku-hen': 'demon-slayer-kimetsu-no-yaiba',
    'kimetsu-no-yaiba-katanakaji-no-sato-hen': 'demon-slayer-kimetsu-no-yaiba',
    'kimetsu-no-yaiba-hashira-geiko-hen': 'demon-slayer-kimetsu-no-yaiba',
    'demon-slayer-kimetsu-no-yaiba-katanakaji-no-sato-hen': 'demon-slayer-kimetsu-no-yaiba',
    'demon-slayer-kimetsu-no-yaiba-yuukaku-hen': 'demon-slayer-kimetsu-no-yaiba',

    // JJK movie
    'jujutsu-kaisen-0': 'jujutsu-kaisen-0-movie',

    // Naruto Shippuden - double 'u' spelling used on an1me.to
    'naruto-shippuuden': 'naruto-shippuden',
    'naruto-shippuuden-complete': 'naruto-shippuden',

    // Special suffixes
    'tokyo-ghoul-re': 'tokyo-ghoul-re-0',
    'blue-lock-episode-nagi': 'blue-lock-0',
    'black-clover-tv': 'black-clover',

    // Specific variations
    'sword-art-online-alicization-war-of-underworld': 'sword-art-online-alicization',

    // Attack on Titan needs special handling (uses 'attack-titan' not 'attack-on-titan')
    'attack-on-titan': 'attack-titan',
    // AoT Final Season variations
    'shingeki-no-kyojin-the-final-season': 'attack-titan',
    'shingeki-no-kyojin-the-final-season-kanketsu-hen': 'attack-titan',
    'shingeki-no-kyojin-the-final-season-part-2': 'attack-titan',
    'attack-titan-the-final-season-kanketsu-hen': 'attack-titan',

    // One Punch Man seasons (all map to main series)
    'one-punch-man-season-2': 'one-punch-man',
    'one-punch-man-season-3': 'one-punch-man',

    // Initial D mappings
    'initial-d-first-stage': 'initial-d',
    'initial-d-second-stage': 'initial-d',
    'initial-d-third-stage': 'initial-d',
    // Fourth stage onward often doesn't have separate filler lists or is 404
};

// Episode offset mapping for multi-part anime
// When an anime has multiple parts/seasons that continue episode numbering
const EPISODE_OFFSET_MAPPING = {
    // Bleach TYBW - Part 2 starts at episode 14 (after 13 episodes of Part 1)
    'bleach-sennen-kessen-hen-ketsubetsu-tan': 13,

    // Bleach TYBW - Part 3 starts at episode 27 (after 13 + 13 episodes)
    'bleach-sennen-kessen-hen-soukoku-tan': 26,

    // Add more multi-part anime here as needed
    // Example: 'my-hero-academia-season-2': 13,  // if season 2 continues from 13
};

// Parts display configuration for multi-part anime
// Maps base slug to an array of parts with their episode ranges
const ANIME_PARTS_CONFIG = {
    'bleach-sennen-kessen-hen': [
        { name: 'Part 1', start: 1, end: 13 },
        { name: 'Part 2: Ketsubetsu-tan', start: 14, end: 26 },
        { name: 'Part 3: Soukoku-tan', start: 27, end: 39 }
    ],
    'one-punch-man-season-2': [
        { name: 'Season 2', start: 1, end: 12 }
    ],
    'one-punch-man-season-3': [
        { name: 'Season 3', start: 1, end: 30 }
    ],
    // Add more multi-part anime as needed
    // Example:
    // 'attack-on-titan-final': [
    //     { name: 'Part 1', start: 1, end: 16 },
    //     { name: 'Part 2', start: 17, end: 28 }
    // ]
};

// Known standalone movies (without -movie/-film in slug)
// These are detected by exact match or prefix
const KNOWN_MOVIE_SLUGS = [
    // Makoto Shinkai films
    'your-name', 'kimi-no-na-wa',
    'weathering-with-you', 'tenki-no-ko',
    'suzume', 'suzume-no-tojimari',
    '5-centimeters-per-second', 'byousoku-5-centimeter',
    'garden-of-words', 'kotonoha-no-niwa',

    // Popular standalone movies
    'the-first-slam-dunk',
    'a-silent-voice', 'koe-no-katachi',
    'i-want-to-eat-your-pancreas', 'kimi-no-suizou-wo-tabetai',
    'grave-of-the-fireflies', 'hotaru-no-haka',
    'akira',
    'spirited-away', 'sen-to-chihiro',
    'howls-moving-castle', 'howl-no-ugoku-shiro',
    'princess-mononoke', 'mononoke-hime',
    'my-neighbor-totoro', 'tonari-no-totoro',

    // Franchise movies without -movie suffix
    'jujutsu-kaisen-0',
    'demon-slayer-mugen-train', 'kimetsu-no-yaiba-mugen-train',
    'dragon-ball-super-broly',
    'dragon-ball-super-super-hero',
    'my-hero-academia-two-heroes',
    'my-hero-academia-heroes-rising',
    'my-hero-academia-world-heroes-mission',
    'naruto-the-last',
    'the-last-naruto'
];

/**
 * Season Grouping Utility
 * Groups anime by their base name (without season/part indicators)
 */
const SeasonGrouping = {
    // Check if slug is a movie
    isMovie(slug) {
        const lowerSlug = slug.toLowerCase();

        // Exception: Initial D Third Stage should be treated as a season, not a movie
        if (lowerSlug.includes('initial-d') && (lowerSlug.includes('third-stage') || lowerSlug.includes('3rd-stage'))) {
            return false;
        }

        // Check known movie slugs first
        if (KNOWN_MOVIE_SLUGS.some(movie => lowerSlug === movie || lowerSlug.startsWith(movie + '-'))) {
            return true;
        }

        // Pattern-based detection
        const moviePatterns = [
            /-movie(-|$)/i,
            /-film(-|$)/i,
            /-gekijouban/i,
            /-the-movie/i,
            /^.*-movie-\d+/i,
            /-3d-/i,  // 3D movies like "one-piece-3d-mugiwara-chase"
            /-two-heroes$/i,
            /-heroes-rising$/i,
            /-world-heroes-mission$/i,
            /-super-hero$/i,
            /-broly$/i,
            /-the-last$/i,
            /-mugen-train$/i
        ];
        return moviePatterns.some(pattern => pattern.test(slug));
    },

    // Extract movie number from slug
    getMovieNumber(slug) {
        // Check for explicit movie number: movie-01, movie-14, etc.
        let match = slug.match(/-movie-0?(\d+)/i);
        if (match) return parseInt(match[1], 10);

        // Check for roman numerals: -i-, -ii-, -iii-, movie-i, movie-ii
        const romanMatch = slug.match(/-(i{1,3}|iv|v)(?:-|$)/i);
        if (romanMatch) {
            const romanMap = { 'i': 1, 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5 };
            return romanMap[romanMatch[1].toLowerCase()] || 1;
        }

        // Higashi no Eden specific
        if (slug.includes('higashi-no-eden')) {
            if (slug.includes('king') || slug.includes('-1')) return 1;
            if (slug.includes('paradise') || slug.includes('-2')) return 2;
        }

        // Check for "film" patterns: film-gold, film-red, etc.
        // These don't have numbers, so return based on common film names
        const filmOrder = {
            'film-gold': 13,
            'film-red': 15,
            'film-z': 12,
            'film-strong-world': 10
        };
        for (const [filmSlug, num] of Object.entries(filmOrder)) {
            if (slug.includes(filmSlug)) return num;
        }

        // Default to 1 if can't determine
        return 1;
    },

    // Extract base slug for movies (without movie indicators)
    getMovieBaseSlug(slug) {
        // Special handling for known franchises
        if (slug.startsWith('kimetsu-no-yaiba')) {
            return 'kimetsu-no-yaiba';
        }
        if (slug.startsWith('higashi-no-eden')) {
            return 'higashi-no-eden';
        }
        if (slug.startsWith('one-piece')) {
            return 'one-piece';
        }
        if (slug.startsWith('dragon-ball')) {
            return 'dragon-ball';
        }
        if (slug.startsWith('naruto')) {
            return 'naruto';
        }

        // Generic: remove everything after -movie, -film, -3d, or -gekijouban
        return slug
            .replace(/-movie.*$/i, '')
            .replace(/-film.*$/i, '')
            .replace(/-3d.*$/i, '')
            .replace(/-gekijouban.*$/i, '')
            .replace(/-the-movie.*$/i, '');
    },

    // Extract base slug by removing season/part indicators
    getBaseSlug(slug) {
        // If it's a movie, use movie base slug extraction
        if (this.isMovie(slug)) {
            return this.getMovieBaseSlug(slug);
        }

        // Special handling for Naruto (all versions group together as 'naruto')
        if (slug.startsWith('naruto')) {
            return 'naruto';
        }

        // Special handling for One Punch Man (all seasons group together)
        if (slug.startsWith('one-punch-man')) {
            return 'one-punch-man';
        }

        // Special handling for Demon Slayer arcs (all "-hen" suffixes should group together)
        if (slug.startsWith('kimetsu-no-yaiba')) {
            return 'kimetsu-no-yaiba';
        }

        // Special handling for Attack on Titan (all seasons/parts group together)
        if (slug.startsWith('shingeki-no-kyojin')) {
            return 'shingeki-no-kyojin';
        }

        // Special handling for Initial D (all stages group together)
        if (slug.startsWith('initial-d')) {
            return 'initial-d';
        }

        return slug
            // Remove season patterns with subtitle: -season-2-something-something
            .replace(/-season-?\d+(-[a-z-]+)?$/i, '')
            // Remove simple season patterns: -s2
            .replace(/-s\d+$/i, '')
            .replace(/-\d+(st|nd|rd|th)-season$/i, '')
            // Remove part patterns: -part-2, -cour-2, etc.
            .replace(/-(part|cour)-?\d+(-[a-z-]+)?$/i, '')
            // Remove year patterns at end: -2024, -2025
            .replace(/-20\d{2}$/i, '')
            // Remove roman numerals at end: -ii, -iii, -iv
            .replace(/-(ii|iii|iv|v|vi)$/i, '')
            // Remove Japanese arc suffixes like -hen
            .replace(/-[a-z]+-hen$/i, '');
    },

    // Extract season number from slug
    getSeasonNumber(slug) {
        // Special handling for One Punch Man
        if (slug.startsWith('one-punch-man')) {
            if (slug.includes('season-3') || slug.endsWith('-3')) return 3;
            if (slug.includes('season-2') || slug.includes('2nd-season')) return 2;
            return 1; // Season 1
        }

        // Special handling for Jujutsu Kaisen
        if (slug.startsWith('jujutsu-kaisen')) {
            if (slug.includes('culling-game') || slug.includes('season-3') || slug.includes('dead-culling-game') || slug.includes('shimetsu-kaiyuu')) return 3;
            if (slug.includes('season-2') || slug.includes('2nd-season') || slug.includes('shibuya-incident') || slug.includes('kaigyoku-gyokusetsu')) return 2;
            if (slug.includes('0') || slug.includes('movie')) return 0;
            return 1; // Season 1
        }

        // Special handling for Naruto (original / Shippuden / Boruto grouping)
        if (slug.startsWith('naruto') || slug.startsWith('boruto')) {
            const slugLower = slug.toLowerCase();
            // Boruto = Season 3
            if (slugLower.includes('boruto') || slugLower.includes('-3') || slugLower.includes('season-3')) {
                return 3;
            }
            // Shippuden/Shippuuden = Season 2
            if (slugLower.includes('shippuden') || slugLower.includes('shippuuden') || slugLower.includes('-2') || slugLower.includes('season-2')) {
                return 2;
            }
            // Default to Season 1
            return 1;
        }

        // Special handling for Demon Slayer arcs
        if (slug.startsWith('kimetsu-no-yaiba')) {
            if (slug.includes('hashira-geiko-hen')) return 5;
            if (slug.includes('katanakaji-no-sato-hen')) return 4;
            if (slug.includes('yuukaku-hen')) return 3;
            if (slug.includes('mugen-ressha-hen')) return 2;
            return 1; // Base season
        }

        // Special handling for Attack on Titan
        if (slug.startsWith('shingeki-no-kyojin')) {
            if (slug.includes('final-season-kanketsu-hen')) return 7;
            if (slug.includes('final-season-part-2')) return 6;
            if (slug.includes('final-season')) return 5;
            if (slug.includes('season-3-part-2')) return 4;
            if (slug.includes('season-3')) return 3;
            if (slug.includes('season-2')) return 2;
            return 1; // Season 1
        }

        // Special handling for Initial D
        if (slug.startsWith('initial-d')) {
            if (slug.includes('final-stage') || slug.includes('sixth-stage') || slug.includes('6th-stage')) return 6;
            if (slug.includes('fifth-stage') || slug.includes('5th-stage')) return 5;
            if (slug.includes('fourth-stage') || slug.includes('4th-stage')) return 4;
            if (slug.includes('third-stage') || slug.includes('3rd-stage')) return 3;
            if (slug.includes('second-stage') || slug.includes('2nd-stage')) return 2;
            return 1; // First Stage
        }

        // Check for explicit season number (with possible subtitle after)
        let match = slug.match(/-season-?(\d+)/i);
        if (match) return parseInt(match[1], 10);

        match = slug.match(/-s(\d+)$/i);
        if (match) return parseInt(match[1], 10);

        match = slug.match(/-(\d+)(st|nd|rd|th)-season$/i);
        if (match) return parseInt(match[1], 10);

        // Check for roman numerals
        const romanMatch = slug.match(/-(ii|iii|iv|v|vi)$/i);
        if (romanMatch) {
            const romanMap = { 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5, 'vi': 6 };
            return romanMatch[1].toLowerCase() in romanMap ? romanMap[romanMatch[1].toLowerCase()] : 1;
        }

        // Special handling for Bleach TYBW parts (use part number as season)
        if (slug.includes('bleach-sennen-kessen-hen')) {
            if (slug.includes('soukoku-tan')) return 3;
            if (slug.includes('ketsubetsu-tan')) return 2;
            return 1; // Base is Part 1
        }

        // No season indicator means season 1
        return 1;
    },

    // Get display name for a season
    getSeasonLabel(slug, title) {
        // Special handling for One Punch Man
        if (slug.startsWith('one-punch-man')) {
            if (slug.includes('season-3') || slug.endsWith('-3')) return 'Season 3';
            if (slug.includes('season-2') || slug.includes('2nd-season')) return 'Season 2';
            return 'Season 1';
        }

        // Special handling for Naruto display labels
        if (slug.startsWith('naruto') || slug.startsWith('boruto')) {
            const slugLower = slug.toLowerCase();
            const titleLower = title ? title.toLowerCase() : '';

            // Check slug first - Boruto
            if (slugLower.includes('boruto') || slugLower.endsWith('-3') || slugLower.includes('season-3')) {
                return 'Naruto Boruto';
            }
            if (titleLower.includes('boruto')) {
                return 'Naruto Boruto';
            }

            // Check slug - Shippuden
            if (slugLower.includes('shippuden') || slugLower.includes('shippuuden')) {
                return 'Naruto Shippuden';
            }
            if (slugLower.endsWith('-2') || slugLower.includes('season-2')) {
                return 'Naruto Shippuden';
            }
            if (titleLower.includes('shippuden') || titleLower.includes('shippuuden')) {
                return 'Naruto Shippuden';
            }

            // Default to Season 1 for base naruto
            return 'Naruto';
        }

        // Special handling for Jujutsu Kaisen
        if (slug.startsWith('jujutsu-kaisen')) {
            if (slug.includes('culling-game') || slug.includes('season-3') || slug.includes('dead-culling-game') || slug.includes('shimetsu-kaiyuu')) return 'Season 3';
            if (slug.includes('season-2') || slug.includes('2nd-season') || slug.includes('shibuya-incident') || slug.includes('kaigyoku-gyokusetsu')) return 'Season 2';
            if (slug.includes('0') || slug.includes('movie')) return 'Movie 0';
            return 'Season 1';
        }

        // Special handling for Demon Slayer - show arc names
        if (slug.startsWith('kimetsu-no-yaiba')) {
            if (slug.includes('hashira-geiko-hen')) return 'Hashira Training Arc';
            if (slug.includes('katanakaji-no-sato-hen')) return 'Swordsmith Village Arc';
            if (slug.includes('yuukaku-hen')) return 'Entertainment District Arc';
            if (slug.includes('mugen-ressha-hen')) return 'Mugen Train Arc';
            return 'Season 1';
        }

        // Special handling for Attack on Titan
        if (slug.startsWith('shingeki-no-kyojin')) {
            if (slug.includes('final-season-kanketsu-hen')) return 'Final Season Part 3';
            if (slug.includes('final-season-part-2')) return 'Final Season Part 2';
            if (slug.includes('final-season')) return 'Final Season Part 1';
            if (slug.includes('season-3-part-2')) return 'Season 3 Part 2';
            if (slug.includes('season-3')) return 'Season 3 Part 1';
            if (slug.includes('season-2')) return 'Season 2';
            return 'Season 1';
        }

        // Special handling for Initial D
        if (slug.startsWith('initial-d')) {
            if (slug.includes('final-stage') || slug.includes('sixth-stage') || slug.includes('6th-stage')) return 'Final Stage';
            if (slug.includes('fifth-stage') || slug.includes('5th-stage')) return 'Fifth Stage';
            if (slug.includes('fourth-stage') || slug.includes('4th-stage')) return 'Fourth Stage';
            if (slug.includes('third-stage') || slug.includes('3rd-stage')) return 'Third Stage (Movie)';
            if (slug.includes('second-stage') || slug.includes('2nd-stage')) return 'Second Stage';
            return 'First Stage';
        }

        // Special handling for Bleach TYBW - show as "Part X"
        if (slug.includes('bleach-sennen-kessen-hen')) {
            if (slug.includes('soukoku-tan')) return 'Part 3';
            if (slug.includes('ketsubetsu-tan')) return 'Part 2';
            return 'Part 1';
        }

        const seasonNum = this.getSeasonNumber(slug);
        return `Season ${seasonNum}`;
    },

    // Get movie label from slug
    getMovieLabel(slug, title) {
        // Special handling for specific movie series
        if (slug.includes('higashi-no-eden')) {
            if (slug.includes('-i-') || slug.includes('-1-') || slug.endsWith('-i')) {
                return 'Movie I: King of Eden';
            }
            if (slug.includes('-ii-') || slug.includes('-2-') || slug.endsWith('-ii')) {
                return 'Movie II: Paradise Lost';
            }
            // Try to extract from title
            if (title) {
                if (title.toLowerCase().includes('king')) return 'Movie I: King of Eden';
                if (title.toLowerCase().includes('paradise')) return 'Movie II: Paradise Lost';
            }
        }

        // Try to extract movie name from title or slug
        // e.g., "One Piece Film: Red" -> "Film: Red"
        // e.g., "one-piece-film-gold" -> "Film Gold"
        const filmMatch = slug.match(/-film-([a-z-]+)/i);
        if (filmMatch) {
            const filmName = filmMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            return `Film: ${filmName}`;
        }

        // Check for movie number in slug (movie-1, movie-01, movie-14, etc.)
        const movieMatch = slug.match(/-movie-0?(\d+)/i);
        if (movieMatch) {
            return `Movie ${movieMatch[1]}`;
        }

        // Check for roman numerals in slug (-i-, -ii-, -iii-)
        const romanMatch = slug.match(/-movie-?(i{1,3}|iv|v)(?:-|$)/i);
        if (romanMatch) {
            const romanMap = { 'i': 'I', 'ii': 'II', 'iii': 'III', 'iv': 'IV', 'v': 'V' };
            return `Movie ${romanMap[romanMatch[1].toLowerCase()] || romanMatch[1].toUpperCase()}`;
        }

        // Fallback - try to extract from title
        if (title) {
            // Check for "Movie I", "Movie II", etc.
            const romanTitleMatch = title.match(/Movie\s*(I{1,3}|IV|V)\b/i);
            if (romanTitleMatch) {
                return `Movie ${romanTitleMatch[1].toUpperCase()}`;
            }
            // Check for "Movie 1", "Movie 2", etc.
            const numTitleMatch = title.match(/Movie\s*(\d+)/i);
            if (numTitleMatch) {
                return `Movie ${numTitleMatch[1]}`;
            }
            // Check for "Film: XXX"
            const filmTitleMatch = title.match(/Film[:\s]+([A-Za-z]+)/i);
            if (filmTitleMatch) {
                return `Film: ${filmTitleMatch[1]}`;
            }
        }

        // Last resort - get movie number
        const movieNum = this.getMovieNumber(slug);
        return `Movie ${movieNum}`;
    },

    // Group anime entries by base slug
    groupByBase(animeEntries) {
        const groups = new Map();
        const movieGroups = new Map();

        for (const [slug, anime] of animeEntries) {
            const isMovie = this.isMovie(slug);
            const baseSlug = this.getBaseSlug(slug);

            if (isMovie) {
                // Group movies separately with a special key
                const movieGroupKey = baseSlug + '__movies';
                if (!movieGroups.has(movieGroupKey)) {
                    movieGroups.set(movieGroupKey, []);
                }
                movieGroups.get(movieGroupKey).push({
                    slug,
                    anime,
                    movieNum: this.getMovieNumber(slug),
                    isMovie: true
                });
            } else {
                if (!groups.has(baseSlug)) {
                    groups.set(baseSlug, []);
                }
                groups.get(baseSlug).push({ slug, anime, seasonNum: this.getSeasonNumber(slug) });
            }
        }

        // Second pass: merge groups that share a common prefix (for dynamic grouping)
        // This handles cases like "mashle-magic-and-muscles" and "mashle-magic-and-muscles-season-2"
        this.mergeRelatedGroups(groups);

        // Sort season groups by season number
        for (const [baseSlug, entries] of groups) {
            entries.sort((a, b) => a.seasonNum - b.seasonNum);
        }

        // Sort movie groups by movie number
        for (const [groupKey, entries] of movieGroups) {
            entries.sort((a, b) => a.movieNum - b.movieNum);
        }

        // Merge movie groups into main groups
        for (const [groupKey, entries] of movieGroups) {
            groups.set(groupKey, entries);
        }

        return groups;
    },

    // Merge groups that are related (one is a prefix of another)
    mergeRelatedGroups(groups) {
        const baseSlugs = Array.from(groups.keys()).sort((a, b) => a.length - b.length);
        const merged = new Set();

        for (let i = 0; i < baseSlugs.length; i++) {
            const shorter = baseSlugs[i];
            if (merged.has(shorter)) continue;

            for (let j = i + 1; j < baseSlugs.length; j++) {
                const longer = baseSlugs[j];
                if (merged.has(longer)) continue;

                // Check if longer slug starts with shorter slug (with separator)
                if (longer.startsWith(shorter + '-')) {
                    // Merge longer into shorter
                    const shorterEntries = groups.get(shorter);
                    const longerEntries = groups.get(longer);

                    // Update season numbers for merged entries if needed
                    longerEntries.forEach(entry => {
                        // If the entry doesn't have a detected season number > 1,
                        // try to infer it from position
                        if (entry.seasonNum === 1 && longerEntries.length === 1) {
                            // This is likely a sequel - assign next season number
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

    // Check if a group has multiple entries (seasons or movies)
    hasMultipleSeasons(group) {
        return group.length > 1;
    },

    // Check if group is a movie group
    isMovieGroup(group) {
        return group.length > 0 && group[0].isMovie === true;
    }
};

// Export for use in other modules
window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.CONFIG = CONFIG;
window.AnimeTracker.DONATE_LINKS = DONATE_LINKS;
window.AnimeTracker.ANIME_NO_FILLER_DATA = ANIME_NO_FILLER_DATA;
window.AnimeTracker.ANIME_FILLER_LIST_SLUG_MAPPING = ANIME_FILLER_LIST_SLUG_MAPPING;
window.AnimeTracker.EPISODE_OFFSET_MAPPING = EPISODE_OFFSET_MAPPING;
window.AnimeTracker.ANIME_PARTS_CONFIG = ANIME_PARTS_CONFIG;
window.AnimeTracker.KNOWN_MOVIE_SLUGS = KNOWN_MOVIE_SLUGS;
window.AnimeTracker.SeasonGrouping = SeasonGrouping;
