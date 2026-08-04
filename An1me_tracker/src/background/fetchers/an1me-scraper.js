// an1me-scraper.js — scrapes an1me.to anime pages for metadata (episodes, status,
// countdown, cover, id, duration); maps watch→info slugs and backfills animeData.
function isSeasonLikeSlug(slug) {
  return /-(?:season-?\d+|(?:\d+)(?:st|nd|rd|th)-season|s\d+|(?:part|cour)-?\d+|(?:ii|iii|iv|v|vi))(?=$|-)/i.test(String(slug || ""));
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

const WATCH_TO_INFO_SLUGS = {
  hunterhunter: "hunter-x-hunter-2011",
  "hunter-x-hunter-movie-1-phantom-rouge-movie": "hunter-x-hunter-movie-1-phantom-rouge",
  "hunter-x-hunter-movie-2-the-last-mission-movie": "hunter-x-hunter-movie-2-the-last-mission",
  "initial-d-final-stage-255": "initial-d-final-stage",
};

function buildAnimeInfoSlugCandidates(slug) {
  const input = String(slug || "").toLowerCase();
  if (!input) return [];

  let clean = input;
  if (WATCH_TO_INFO_SLUGS[input]) {
    clean = WATCH_TO_INFO_SLUGS[input];
  }

  const out = [clean];
  const add = (value) => {
    if (!value || out.includes(value)) return;
    out.push(value);
  };

  if (clean.endsWith("-movie")) {
    add(clean.replace(/-movie$/i, ""));
  }
  if (clean.endsWith("-movie-movie")) {
    add(clean.replace(/-movie-movie$/i, ""));
    add(clean.replace(/-movie-movie$/i, "-movie"));
  }

  add(
    clean.replace(/-season-?(\d+)(?=$|-)/i, (_m, num) => {
      const ord = toOrdinal(num);
      return ord ? `-${ord}-season` : _m;
    }),
  );

  add(clean.replace(/-(\d+)(st|nd|rd|th)-season(?=$|-)/i, "-season-$1"));

  add(clean.replace(/-s(\d+)(?=$|-)/i, "-season-$1"));

  if (!isSeasonLikeSlug(clean)) {
    const base = clean.replace(/-(?:season-?\d+|(?:\d+)(?:st|nd|rd|th)-season|s\d+|part-?\d+|cour-?\d+|(?:ii|iii|iv|v|vi))$/i, "");
    add(base);
  }

  return out;
}

const isMobileScraperUA = typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad|iPod|Orion/i.test(navigator.userAgent || "");
const SCRAPER_TIMEOUT_MS = isMobileScraperUA ? 6000 : 8000;

const SCRAPER_HTML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeScrapedHtmlEntities(text) {
  return String(text || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => SCRAPER_HTML_ENTITIES[name.toLowerCase()] ?? m);
}

function cleanScrapedTitle(raw) {
  const text = decodeScrapedHtmlEntities(String(raw || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length < 2 || text.length > 300) return null;
  return text;
}

function extractScrapedDetail(html, labelPattern, maxLength = 500) {
  const pattern = new RegExp(
    `<dt\\b[^>]*>\\s*(?:${labelPattern})\\s*</dt>\\s*<dd\\b[^>]*>([\\s\\S]{0,${maxLength}}?)</dd>`,
    "i",
  );
  const match = String(html || "").match(pattern);
  if (!match) return null;
  const value = decodeScrapedHtmlEntities(match[1].replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return value || null;
}

function parseScrapedEpisodeList(value, totalEpisodes = null) {
  const numbers = new Set();
  const limit = Number(totalEpisodes) > 0 ? Number(totalEpisodes) : Infinity;
  const pattern = /(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?/g;
  let match;
  while ((match = pattern.exec(String(value || ""))) !== null) {
    const start = Number(match[1]) || 0;
    const end = Number(match[2]) || start;
    if (start <= 0 || end < start) continue;
    for (let episode = start; episode <= end && episode <= limit; episode++) numbers.add(episode);
  }
  return Array.from(numbers).sort((left, right) => left - right);
}

// The anime page <h1> holds two language spans: the one hidden in en mode
// (group-data-[language=en]) is the romaji title the tracker uses everywhere;
// the one hidden in jp mode is the English title. og:title is the fallback.
function extractAnimeTitlesFromHtml(html) {
  const out = { title: null, englishTitle: null };
  const source = String(html || "");

  const h1Match = source.match(/<h1[^>]*>([\s\S]{0,1500}?)<\/h1>/i);
  if (h1Match) {
    const spanRe = /<span[^>]*class=["'][^"']*group-data-\[language=(en|jp)\][^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
    let m;
    while ((m = spanRe.exec(h1Match[1])) !== null) {
      const cleaned = cleanScrapedTitle(m[2]);
      if (!cleaned) continue;
      if (m[1].toLowerCase() === "en") {
        if (!out.title) out.title = cleaned;
      } else if (!out.englishTitle) {
        out.englishTitle = cleaned;
      }
    }
  }

  if (!out.title) {
    const ogMatch =
      source.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      source.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (ogMatch) {
      const stripped = String(ogMatch[1])
        .replace(/^Παρακολουθήστε\s+/i, "")
        .replace(/\s*[-–—]\s*online Free on An1me\.to.*$/i, "")
        .replace(/\s*[-–—]\s*An1me(\.to)?\s*$/i, "");
      out.title = cleanScrapedTitle(stripped);
    }
  }

  return out;
}

async function fetchAnimePageInfo(slug) {
  const candidates = buildAnimeInfoSlugCandidates(slug);
  if (candidates.length === 0) {
    throw new Error("Missing slug");
  }

  let resolvedSlug = candidates[0];
  let url = `https://an1me.to/anime/${resolvedSlug}/`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SCRAPER_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok && response.status === 404 && candidates.length > 1) {
    for (const candidateSlug of candidates.slice(1)) {
      const ctrl2 = new AbortController();
      const timer2 = setTimeout(() => ctrl2.abort(), SCRAPER_TIMEOUT_MS);
      try {
        const candidateResponse = await fetch(`https://an1me.to/anime/${candidateSlug}/`, { signal: ctrl2.signal });
        if (candidateResponse.ok) {
          response = candidateResponse;
          resolvedSlug = candidateSlug;
          break;
        }
      } catch {
        continue;
      } finally {
        clearTimeout(timer2);
      }
    }
  }

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();

  let totalEpisodes = null;
  const episodeDetail = extractScrapedDetail(html, "Επεισόδια|Episodes?", 300);
  if (episodeDetail) {
    const numMatch = episodeDetail.match(/\b(\d{1,4})\b/);
    if (numMatch) totalEpisodes = parseInt(numMatch[1], 10);
  }

  const mediaTypeDetail = extractScrapedDetail(html, "Τύπος|Type", 120);
  const mediaType = globalThis.AnimeTrackerMediaType?.normalize(mediaTypeDetail) || null;

  let latestEpisode = null;
  {
    let maxEp = 0;
    for (const watchSlug of new Set([slug, resolvedSlug])) {
      const epPattern = new RegExp(`/watch/${watchSlug}-episode-(\\d+)`, "gi");
      let m;
      while ((m = epPattern.exec(html)) !== null) {
        const n = parseInt(m[1], 10);
        if (n > maxEp) maxEp = n;
      }
    }
    if (maxEp > 0) latestEpisode = maxEp;
  }

  let status = null;
  let statusSource = null;
  const statusDetail = extractScrapedDetail(html, "Κατάσταση|Status", 180);
  if (statusDetail && /Finished\s+Airing|Completed|Finished|Ολοκληρώθηκε|Ολοκληρωμένο/i.test(statusDetail)) {
    status = "FINISHED";
    statusSource = "explicit";
  } else if (statusDetail && /Currently\s+Airing|Releasing|Ongoing|Airing|Προβάλλεται\s+τώρα|Σε\s+εξέλιξη/i.test(statusDetail)) {
    status = "RELEASING";
    statusSource = "explicit";
  }

  const dateText = extractScrapedDetail(html, "Προβλήθηκε|Aired?", 300);

  let nextEpisodeAt = null;
  let nextEpisodeTimezone = null;
  const countdownMatch =
    html.match(
      /<div[^>]+class=["'][^"']*next-scheduled-episode[^"']*["'][\s\S]*?<span[^>]+data-timezone=["']([^"']+)["'][^>]+data-countdown=["']([^"']+)["']/i,
    ) || html.match(/<span[^>]+data-timezone=["']([^"']+)["'][^>]+data-countdown=["']([^"']+)["'][^>]*>/i);
  if (countdownMatch) {
    nextEpisodeTimezone = countdownMatch[1] || null;
    const rawCountdown = countdownMatch[2] || "";
    let normalizedCountdown = rawCountdown.trim().replace(" ", "T");
    // The site's own script interprets data-countdown as UTC (`new Date(str + 'Z')`);
    // without the suffix, Date() would parse the bare datetime as LOCAL time and skew
    // the countdown/notifications by the viewer's UTC offset.
    if (normalizedCountdown && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalizedCountdown)) {
      normalizedCountdown += "Z";
    }
    const parsedCountdown = new Date(normalizedCountdown);
    if (Number.isFinite(parsedCountdown.getTime())) {
      nextEpisodeAt = parsedCountdown.toISOString();
    }
  }

  if (!status && nextEpisodeAt) {
    status = "RELEASING";
    statusSource = "countdown";
  }

  if (!status && dateText) {
    const hasOpenEnd = /\?|\bto\s+(?:\?|present|now|tbd)\b|έως\s+(?:\?|σήμερα)/i.test(dateText);
    const hasClosedRange = /\bto\s+(?!\?|present\b|now\b|tbd\b)\S|έως\s+(?!\?|σήμερα\b)\S/i.test(dateText);
    const singleDateFinished = totalEpisodes && latestEpisode && latestEpisode >= totalEpisodes;
    if (hasOpenEnd) {
      status = "RELEASING";
      statusSource = "aired-open";
    } else if (hasClosedRange || singleDateFinished) {
      status = "FINISHED";
      statusSource = hasClosedRange ? "aired-finished" : "aired-finished-single";
    }
  }

  if (
    statusSource !== "explicit" &&
    statusSource !== "aired-finished" &&
    status === "FINISHED" &&
    totalEpisodes &&
    latestEpisode &&
    latestEpisode < totalEpisodes
  ) {
    status = "RELEASING";
    statusSource = "availability";
  }

  if (!totalEpisodes && latestEpisode && status === "FINISHED") {
    totalEpisodes = latestEpisode;
  }

  const pageText = decodeScrapedHtmlEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
  const fillerText = pageText.match(/Filler\s+(?:Επεισόδια|Episodes?)\s*:\s*([0-9,\s–—-]+)/i)?.[1] || null;
  const canonText = pageText.match(/Canon\s+(?:Επεισόδια|Episodes?)\s*:\s*([0-9,\s–—-]+)/i)?.[1] || null;
  const hasSiteEpisodeTypes = fillerText !== null || canonText !== null;
  const fillerEpisodes = hasSiteEpisodeTypes ? parseScrapedEpisodeList(fillerText, totalEpisodes) : null;
  const canonEpisodes = hasSiteEpisodeTypes ? parseScrapedEpisodeList(canonText, totalEpisodes) : null;

  let coverImage = null;
  const imgMatch =
    html.match(/<img[^>]+class=["'][^"']*anime-main-image[^"']*["'][^>]*src=["']([^"']+)["']/i) ||
    html.match(/<img[^>]+src=["']([^"']+)["'][^>]*class=["'][^"']*anime-main-image[^"']*["']/i);
  if (imgMatch) {
    coverImage = imgMatch[1];
  }
  if (!coverImage) {
    const ogMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogMatch) coverImage = ogMatch[1];
  }

  let siteAnimeId = null;
  const idMatch =
    html.match(/\bcurrent_post_data_id\s*=\s*(\d+)/) ||
    html.match(/\bcurrent_anime_id\s*=\s*(\d+)/) ||
    html.match(/showWatchlistModal\(['"]#watchlist-(\d+)['"]\)/);
  if (idMatch) siteAnimeId = parseInt(idMatch[1], 10);

  let durationSeconds = null;
  const durationDetail = extractScrapedDetail(html, "Διάρκεια|Duration", 200);
  if (durationDetail) {
    const text = durationDetail.toLowerCase();
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

  const titles = extractAnimeTitlesFromHtml(html);

  return {
    schemaVersion: 4,
    totalEpisodes,
    mediaType,
    status,
    statusSource,
    latestEpisode,
    nextEpisodeAt,
    nextEpisodeTimezone,
    coverImage,
    siteAnimeId,
    resolvedSlug,
    durationSeconds,
    title: titles.title,
    englishTitle: titles.englishTitle,
    fillerEpisodes,
    canonEpisodes,
    episodeTypesSource: hasSiteEpisodeTypes ? "an1me" : null,
  };
}
