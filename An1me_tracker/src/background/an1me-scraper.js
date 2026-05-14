/**
 * Anime Tracker — an1me.to page scraper (background module)
 *
 * Fetches and parses an1me.to anime pages for: total episodes, status,
 * latest available episode, next-episode countdown, cover image, internal
 * site anime ID, and runtime. Also exposes a batch helper that fans out
 * scrapes in chunks of 3 with backoff so we don't hammer the site.
 *
 * Extracted from background.js. Functions remain at SW global scope so
 * existing call sites in the message handler continue to work.
 */

function isSeasonLikeSlug(slug) {
    return /-(?:season-?\d+|(?:\d+)(?:st|nd|rd|th)-season|s\d+|(?:part|cour)-?\d+|(?:ii|iii|iv|v|vi))(?=$|-)/i.test(String(slug || ''));
}

function toOrdinal(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return null;
    if (num % 100 >= 11 && num % 100 <= 13) return `${num}th`;
    if (num % 10 === 1) return `${num}st`;
    if (num % 10 === 2) return `${num}nd`;
    if (num % 10 === 3) return `${num}rd`;
    return `${num}th`;
}

function buildAnimeInfoSlugCandidates(slug) {
    const input = String(slug || '').toLowerCase();
    if (!input) return [];

    const out = [input];
    const add = (value) => {
        if (!value || out.includes(value)) return;
        out.push(value);
    };

    add(input.replace(/-season-?(\d+)(?=$|-)/i, (_m, num) => {
        const ord = toOrdinal(num);
        return ord ? `-${ord}-season` : _m;
    }));

    add(input.replace(/-(\d+)(st|nd|rd|th)-season(?=$|-)/i, '-season-$1'));

    add(input.replace(/-s(\d+)(?=$|-)/i, '-season-$1'));

    if (!isSeasonLikeSlug(input)) {
        const base = input.replace(
            /-(?:season-?\d+|(?:\d+)(?:st|nd|rd|th)-season|s\d+|part-?\d+|cour-?\d+|(?:ii|iii|iv|v|vi))$/i,
            ''
        );
        add(base);
    }

    return out;
}

async function fetchAnimePageInfo(slug) {
    const candidates = buildAnimeInfoSlugCandidates(slug);
    if (candidates.length === 0) {
        throw new Error('Missing slug');
    }

    let resolvedSlug = candidates[0];
    let url = `https://an1me.to/anime/${resolvedSlug}/`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let response;
    try {
        response = await fetch(url, { signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok && response.status === 404 && candidates.length > 1) {
        for (const candidateSlug of candidates.slice(1)) {
            const ctrl2 = new AbortController();
            const timer2 = setTimeout(() => ctrl2.abort(), 15000);
            try {
                const candidateResponse = await fetch(`https://an1me.to/anime/${candidateSlug}/`, { signal: ctrl2.signal });
                if (candidateResponse.ok) {
                    response = candidateResponse;
                    resolvedSlug = candidateSlug;
                    break;
                }
            } finally {
                clearTimeout(timer2);
            }
        }
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();

    let totalEpisodes = null;
    const epDdMatch = html.match(
        /(?:Επεισόδια|Episodes?)<\/dt>\s*(<dd[^>]*>[\s\S]{0,300}?<\/dd>)/
    );
    if (epDdMatch) {
        const text = epDdMatch[1].replace(/<[^>]+>/g, ' ');
        const numMatch = text.match(/\b(\d{1,4})\b/);
        if (numMatch) totalEpisodes = parseInt(numMatch[1], 10);
    }

    let latestEpisode = null;
    {
        let maxEp = 0;
        for (const watchSlug of new Set([slug, resolvedSlug])) {
            const epPattern = new RegExp(`/watch/${watchSlug}-episode-(\\d+)`, 'gi');
            let m;
            while ((m = epPattern.exec(html)) !== null) {
                const n = parseInt(m[1], 10);
                if (n > maxEp) maxEp = n;
            }
        }
        if (maxEp > 0) latestEpisode = maxEp;
    }

    let status = null;
    const dateMatch = html.match(
        /(?:Προβλήθηκε|Aired?)<\/dt>[\s\S]{0,300}?<time[^>]*>([\s\S]*?)<\/time>/
    );
    if (dateMatch) {
        const dateText = dateMatch[1].replace(/\s+/g, ' ').trim();
        status = dateText.includes('?') ? 'RELEASING' : 'FINISHED';
    }

    if (!status) {
        if (/Finished\s+Airing|Ολοκληρώθηκε/i.test(html)) status = 'FINISHED';
        else if (/Currently\s+Airing|Προβάλλεται\s+τώρα/i.test(html)) status = 'RELEASING';
    }

    if (status === 'FINISHED' || !status) {
        if (/>Airing<\//i.test(html)) status = 'RELEASING';
    }

    if (status === 'FINISHED' && totalEpisodes && latestEpisode && latestEpisode < totalEpisodes) {
        status = 'RELEASING';
    }

    // For finished entries, the highest uploaded episode is a reasonable
    // fallback total. For airing shows it is only the current availability.
    if (!totalEpisodes && latestEpisode && status === 'FINISHED') {
        totalEpisodes = latestEpisode;
    }

    let nextEpisodeAt = null;
    let nextEpisodeTimezone = null;
    const countdownMatch = html.match(
        /<div[^>]+class=["'][^"']*next-scheduled-episode[^"']*["'][\s\S]*?<span[^>]+data-timezone=["']([^"']+)["'][^>]+data-countdown=["']([^"']+)["']/i
    ) || html.match(
        /<span[^>]+data-timezone=["']([^"']+)["'][^>]+data-countdown=["']([^"']+)["'][^>]*>/i
    );
    if (countdownMatch) {
        nextEpisodeTimezone = countdownMatch[1] || null;
        const rawCountdown = countdownMatch[2] || '';
        const normalizedCountdown = rawCountdown.trim().replace(' ', 'T');
        const parsedCountdown = new Date(normalizedCountdown);
        if (Number.isFinite(parsedCountdown.getTime())) {
            nextEpisodeAt = parsedCountdown.toISOString();
        }
    }

    let coverImage = null;
    const imgMatch = html.match(/<img[^>]+class=["'][^"']*anime-main-image[^"']*["'][^>]*src=["']([^"']+)["']/i)
        || html.match(/<img[^>]+src=["']([^"']+)["'][^>]*class=["'][^"']*anime-main-image[^"']*["']/i);
    if (imgMatch) {
        coverImage = imgMatch[1];
    }
    if (!coverImage) {
        const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
            || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        if (ogMatch) coverImage = ogMatch[1];
    }

    let siteAnimeId = null;
    const idMatch = html.match(/\bcurrent_post_data_id\s*=\s*(\d+)/)
        || html.match(/\bcurrent_anime_id\s*=\s*(\d+)/)
        || html.match(/showWatchlistModal\(['"]#watchlist-(\d+)['"]\)/);
    if (idMatch) siteAnimeId = parseInt(idMatch[1], 10);

    let durationSeconds = null;
    const durDdMatch = html.match(
        /(?:Διάρκεια|Duration)<\/dt>\s*(<dd[^>]*>[\s\S]{0,200}?<\/dd>)/i
    );
    if (durDdMatch) {
        const text = durDdMatch[1].replace(/<[^>]+>/g, ' ').toLowerCase();
        let totalMinutes = 0;
        const hourMatches = text.matchAll(/(\d+)\s*(?:h\b|hr\b|hour|ώρ)/g);
        for (const m of hourMatches) totalMinutes += parseInt(m[1], 10) * 60;
        const minMatches = text.matchAll(/(\d+)\s*(?:m\b|min|λεπτ)/g);
        for (const m of minMatches) totalMinutes += parseInt(m[1], 10);
        if (totalMinutes === 0) {
            const bareNum = text.match(/\b(\d{1,4})\b/);
            if (bareNum) totalMinutes = parseInt(bareNum[1], 10);
        }
        if (totalMinutes > 0 && totalMinutes <= 24 * 60) {
            durationSeconds = totalMinutes * 60;
        }
    }

    return {
        totalEpisodes,
        status,
        latestEpisode,
        nextEpisodeAt,
        nextEpisodeTimezone,
        coverImage,
        siteAnimeId,
        resolvedSlug,
        durationSeconds
    };
}

async function batchFetchAnimeInfo(slugs) {
    const BATCH_SIZE = 3;
    const DELAY_MS = 1200;
    let successCount = 0;

    const backfills = new Map();

    for (let i = 0; i < slugs.length; i += BATCH_SIZE) {
        const batch = slugs.slice(i, i + BATCH_SIZE);

        await Promise.all(batch.map(async (slug) => {
            try {
                const info = await fetchAnimePageInfo(slug);
                if (info) {
                    const entry = { ...info, cachedAt: Date.now() };
                    await bgStorageSet({ [`animeinfo_${slug}`]: entry });
                    successCount++;

                    if (info.coverImage || info.siteAnimeId || info.durationSeconds) {
                        backfills.set(slug, {
                            coverImage: info.coverImage,
                            siteAnimeId: info.siteAnimeId,
                            durationSeconds: info.durationSeconds || null
                        });
                    }
                } else {
                    await bgStorageSet({ [`animeinfo_${slug}`]: { notFound: true, cachedAt: Date.now() } });
                }
            } catch (e) {
                console.warn(`[BG] Fetch failed for ${slug}:`, e.message);
            }
        }));

        if (i + BATCH_SIZE < slugs.length) {
            await new Promise(r => setTimeout(r, DELAY_MS));
        }
    }

    if (backfills.size > 0) {
        const fresh = await bgStorageGet(['animeData']);
        const animeData = fresh.animeData || {};
        let changed = false;
        for (const [slug, fill] of backfills) {
            if (!animeData[slug]) continue;
            if (fill.coverImage && !animeData[slug].coverImage) {
                animeData[slug].coverImage = fill.coverImage;
                changed = true;
            }
            if (fill.siteAnimeId && !animeData[slug].siteAnimeId) {
                animeData[slug].siteAnimeId = fill.siteAnimeId;
                changed = true;
            }
            if (fill.durationSeconds && Array.isArray(animeData[slug].episodes)) {
                const dur = fill.durationSeconds;
                let epsChanged = false;
                animeData[slug].episodes = animeData[slug].episodes.map((ep) => {
                    const current = Number(ep?.duration) || 0;
                    if (isPlaceholderDuration(current)) {
                        epsChanged = true;
                        return { ...ep, duration: dur, durationSource: 'site-metadata' };
                    }
                    return ep;
                });
                if (epsChanged) {
                    animeData[slug].totalWatchTime = animeData[slug].episodes.reduce(
                        (sum, ep) => sum + (Number(ep?.duration) || 0), 0
                    );
                    changed = true;
                }
            }
        }
        if (changed) await bgStorageSet({ animeData });
    }
    (typeof dlog === 'function' ? dlog : () => {})(
        `[BG] Batch fetch done — ${successCount}/${slugs.length}`
    );
}
