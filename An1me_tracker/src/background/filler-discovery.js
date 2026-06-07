


const KNOWN_FILLER_SLUGS = {
    'naruto': 'naruto',
    'naruto-shippuuden': 'naruto-shippuden',
    'one-piece': 'one-piece',
    'bleach': 'bleach',
    'bleach-sennen-kessen-hen': 'bleach',
    'dragon-ball-z': 'dragon-ball-z',
    'dragon-ball-super': 'dragon-ball-super',
    'fairy-tail': 'fairy-tail',
    'shingeki-no-kyojin': 'attack-on-titan',
    'kimetsu-no-yaiba': 'demon-slayer-kimetsu-no-yaiba',
    'boku-no-hero-academia': 'my-hero-academia',
    'hunter-x-hunter-2011': 'hunter-x-hunter-2011',
    'fullmetal-alchemist-brotherhood': 'fullmetal-alchemist-brotherhood',
    'sword-art-online': 'sword-art-online',
    'black-clover': 'black-clover',
    'boruto-naruto-next-generations': 'boruto-naruto-next-generations',
    'one-punch-man': 'one-punch-man',
    'jujutsu-kaisen': 'jujutsu-kaisen',
    'shingeki-no-kyojin-season-2': 'attack-on-titan',
    'shingeki-no-kyojin-season-3': 'attack-on-titan',
    'shingeki-no-kyojin-the-final-season': 'attack-on-titan',
};


const FILLER_SLUG_CACHE_MAX = 500;
const _fillerSlugLru = new Map();
const fillerSlugCache = {
    has(key) { return _fillerSlugLru.has(key); },
    get(key) { return _fillerSlugLru.get(key); },
    set(key, value) {
        if (_fillerSlugLru.has(key)) _fillerSlugLru.delete(key);
        else if (_fillerSlugLru.size >= FILLER_SLUG_CACHE_MAX) {
            const oldest = _fillerSlugLru.keys().next().value;
            if (oldest !== undefined) _fillerSlugLru.delete(oldest);
        }
        _fillerSlugLru.set(key, value);
    },
    delete(key) { _fillerSlugLru.delete(key); }
};

function generateFillerSlugCandidates(an1meSlug, animeTitle) {
    const seen = new Set();
    const candidates = [];

    function add(s) {
        if (!s || s.length < 2) return;
        const clean = s.replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
        if (clean && !seen.has(clean)) { seen.add(clean); candidates.push(clean); }
    }

    function addWithStripping(s) {
        add(s);
        const stripped = s
            .replace(/-the-final-season-kanketsu-hen$/i, '')
            .replace(/-the-final-season-part-\d+$/i, '')
            .replace(/-the-final-season$/i, '')
            .replace(/-season-\d+-part-\d+$/i, '')
            .replace(/-season-?\d+$/i, '')
            .replace(/-s\d+$/i, '')
            .replace(/-(2nd|3rd|4th|5th|6th|7th)-season$/i, '')
            .replace(/-(part|cour)-?\d+$/i, '')
            .replace(/-(final|last)-season$/i, '')
            .replace(/-new-world$/i, '')
            .replace(/-[a-z]+-hen$/i, '')
            .replace(/-(ii|iii|iv|v|vi)$/i, '')
            .replace(/-[2-9]$/i, '')
            .replace(/-\d{4}$/i, '');
        if (stripped && stripped !== s) add(stripped);
    }

    const slug = an1meSlug
        .replace(/-episode.*$/i, '')
        .replace(/-ep-?\d+$/i, '')
        .toLowerCase();

    addWithStripping(slug);

    if (slug.includes('shippuuden')) {
        addWithStripping(slug.replace(/shippuuden/g, 'shippuden'));
    }

    if (slug.includes('sennen-kessen-hen')) {
        addWithStripping(slug.replace(/sennen-kessen-hen.*/i, 'thousand-year-blood-war'));
    }

    const JP_TO_EN = {
        'shingeki-no-kyojin': 'attack-titan',
        'kimetsu-no-yaiba': 'demon-slayer-kimetsu-no-yaiba',
        'boku-no-hero-academia': 'my-hero-academia',
        'hagane-no-renkinjutsushi': 'fullmetal-alchemist',
        'ansatsu-kyoushitsu': 'assassination-classroom',
        'nanatsu-no-taizai': 'seven-deadly-sins',
        'yakusoku-no-neverland': 'promised-neverland',
        'tensei-shitara-slime-datta-ken': 'that-time-i-got-reincarnated-slime',
        'kenpuu-denki': 'berserk',
    };
    for (const [jpBase, enBase] of Object.entries(JP_TO_EN)) {
        if (slug.startsWith(jpBase)) {
            add(enBase);
            const suffix = slug.slice(jpBase.length);
            if (suffix) addWithStripping(enBase + suffix);
        }
    }

    if (animeTitle) {
        const titleSlug = String(animeTitle)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        addWithStripping(titleSlug);
    }

    return candidates;
}

async function discoverFillerSlug(an1meSlug, animeTitle, options = {}) {
    const { forceRefresh = false } = options;
    const cacheKey = an1meSlug.toLowerCase();

    if (!forceRefresh && fillerSlugCache.has(cacheKey)) return fillerSlugCache.get(cacheKey);

    if (cacheKey in KNOWN_FILLER_SLUGS) {
        const known = KNOWN_FILLER_SLUGS[cacheKey];
        fillerSlugCache.set(cacheKey, known);
        return known;
    }

    const storageKey = `fillerslug_${cacheKey}`;
    if (forceRefresh) {
        fillerSlugCache.delete(cacheKey);
        try {
            await bgStorageRemove([storageKey]);
        } catch (e) {
            console.warn('[BG] Failed to clear filler slug cache before refresh:', e.message);
        }
    }

    try {
        const stored = await bgStorageGet([storageKey]);
        const cached = stored[storageKey];
        if (cached !== undefined) {
            if (typeof cached === 'string') {
                fillerSlugCache.set(cacheKey, cached);
                return cached;
            }
            if (cached?.notFound) {
                const age = cached.cachedAt ? Date.now() - cached.cachedAt : Infinity;
                if (age < 3 * 24 * 60 * 60 * 1000) {
                    fillerSlugCache.set(cacheKey, null);
                    return null;
                }
                await bgStorageRemove([storageKey]);
            }
        }
    } catch (e) {
        console.warn('[BG] discoverFillerSlug storage read failed:', e.message);
    }

    const candidates = generateFillerSlugCandidates(an1meSlug, animeTitle).slice(0, 5);


    const groupCtrl = new AbortController();
    const tryCandidate = async (candidate) => {
        const perCtrl = new AbortController();
        const onAbort = () => perCtrl.abort();
        groupCtrl.signal.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => perCtrl.abort(), 10000);
        try {
            const resp = await fetch(
                `https://www.animefillerlist.com/shows/${candidate}`,
                { method: 'HEAD', signal: perCtrl.signal }
            );
            if (resp.ok) return candidate;
            const err = new Error(`HTTP ${resp.status}`);
            err.httpStatus = resp.status;
            throw err;
        } finally {
            clearTimeout(timer);
            groupCtrl.signal.removeEventListener('abort', onAbort);
        }
    };

    let found = null;
    let allWere404 = false;
    try {


        found = await Promise.any(candidates.map(tryCandidate));
        groupCtrl.abort();
    } catch (aggErr) {
        found = null;
        const errors = Array.isArray(aggErr?.errors) ? aggErr.errors : [];
        allWere404 = errors.length > 0 && errors.every(e => e?.httpStatus === 404);
    }

    if (found) {
        fillerSlugCache.set(cacheKey, found);
        await bgStorageSet({ [storageKey]: found });
        (typeof dlog === 'function' ? dlog : () => {})(
            `[AnimeTracker] Filler slug discovered: ${an1meSlug} → ${found}`
        );
        return found;
    }

    if (!allWere404) {
        return null;
    }

    const notFoundEntry = { notFound: true, cachedAt: Date.now() };
    fillerSlugCache.set(cacheKey, null);
    try {
        await bgStorageSet({ [storageKey]: notFoundEntry });
    } catch (e) {
        console.warn('[BG] Failed to cache notFound filler slug:', e.message);
    }
    (typeof dlog === 'function' ? dlog : () => {})(
        `[AnimeTracker] No filler data for ${an1meSlug} (tried ${candidates.length} candidates)`
    );
    return null;
}

async function fetchEpisodeTypesFromAnimeFillerList(animeSlug) {
    try {
        const url = `https://www.animefillerlist.com/shows/${animeSlug}`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        let response;
        try {
            response = await fetch(url, { signal: ctrl.signal });
        } finally {
            clearTimeout(timer);
        }
        if (!response.ok) {
            if (response.status === 404) return null;
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const html = await response.text();
        const episodeTypes = { canon: [], filler: [], mixed: [], anime_canon: [], totalEpisodes: null };

        const trPattern = /<tr[^>]*\bclass=["']([^"']+)["'][^>]*>([\s\S]*?)<\/tr>/gi;
        let trMatch;
        while ((trMatch = trPattern.exec(html)) !== null) {
            const classes = trMatch[1].toLowerCase();
            const rowContent = trMatch[2];

            let type = null;
            if (/\bmanga_canon\b/.test(classes)) type = 'canon';
            else if (/\bmixed_canon/.test(classes)) type = 'mixed';
            else if (/\banime_canon\b/.test(classes)) type = 'anime_canon';
            else if (/\bfiller\b/.test(classes)) type = 'filler';

            if (!type) continue;

            const numMatch = rowContent.match(/>(\d+)</);
            if (!numMatch) continue;

            const epNum = parseInt(numMatch[1], 10);
            if (!Number.isFinite(epNum) || epNum <= 0) continue;

            episodeTypes[type].push(epNum);
        }

        for (const key of ['canon', 'filler', 'mixed', 'anime_canon']) {
            episodeTypes[key] = [...new Set(episodeTypes[key])].sort((a, b) => a - b);
        }

        const all = [
            ...episodeTypes.canon,
            ...episodeTypes.mixed,
            ...episodeTypes.filler,
            ...episodeTypes.anime_canon
        ];
        if (all.length > 0) episodeTypes.totalEpisodes = Math.max(...all);

        if (all.length === 0) {
            console.warn(`[Anime Tracker] ⚠ No episodes parsed for ${animeSlug} — site structure may have changed`);
            return null;
        }

        (typeof dlog === 'function' ? dlog : () => {})(
            `[Anime Tracker] ✓ Fetched episode types for ${animeSlug}:`, episodeTypes
        );
        return episodeTypes;
    } catch (error) {
        console.error(`[Anime Tracker] ✗ Failed for ${animeSlug}: ${error?.message}`, error);
        throw error;
    }
}

async function fetchJikanEpisodes(title) {
    try {
        const searchCtrl = new AbortController();
        const searchTimer = setTimeout(() => searchCtrl.abort(), 10000);
        const searchRes = await fetch(
            `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=1`,
            { signal: searchCtrl.signal }
        );
        clearTimeout(searchTimer);
        if (!searchRes.ok) return null;
        const searchData = await searchRes.json();
        const anime = searchData?.data?.[0];
        if (!anime?.mal_id) return null;

        const malId = anime.mal_id;
        const allEpisodes = [];
        let page = 1;
        let hasNext = true;

        while (hasNext && page <= 10) {
            const epCtrl = new AbortController();
            const epTimer = setTimeout(() => epCtrl.abort(), 10000);
            const epRes = await fetch(
                `https://api.jikan.moe/v4/anime/${malId}/episodes?page=${page}`,
                { signal: epCtrl.signal }
            );
            clearTimeout(epTimer);
            if (!epRes.ok) break;
            const epData = await epRes.json();
            if (epData?.data) allEpisodes.push(...epData.data);
            hasNext = epData?.pagination?.has_next_page === true;
            page++;
            if (hasNext) await new Promise(r => setTimeout(r, 400));
        }

        if (allEpisodes.length === 0) return null;

        const episodeTypes = { canon: [], filler: [], mixed: [], anime_canon: [], totalEpisodes: allEpisodes.length };
        for (const ep of allEpisodes) {
            const num = ep.mal_id;
            if (!num || num <= 0) continue;
            if (ep.filler) {
                episodeTypes.filler.push(num);
            } else if (ep.recap) {
                episodeTypes.mixed.push(num);
            } else {
                episodeTypes.canon.push(num);
            }
        }

        return episodeTypes;
    } catch {
        return null;
    }
}
