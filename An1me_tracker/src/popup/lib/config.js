// config.js — popup constants (cache durations, delays, display limits).
const CONFIG = {
  SEARCH_DEBOUNCE_MS: 150,
  STORAGE_UPDATE_DEBOUNCE_MS: 600,

  VISIBLE_EPISODES_LIMIT: 10,
  VISIBLE_FILLERS_LIMIT: 6,
  COMPLETED_LIST_MIN_DAYS: 4,

  COMPLETED_PERCENTAGE: 85,

  CLOUD_SAVE_DEBOUNCE_MS: 2000,
  MAX_CLOUD_SAVE_RETRIES: 3,
  MAX_RETRY_DELAY_MS: 30000,
};

const DONATE_LINKS = {
  paypal: "https://www.paypal.me/ThomasThanos",
  revolut: "https://revolut.me/thomas2873",
};

const ANIME_PARTS_CONFIG = {
  "fate-zero": [
    { name: "Fate/Zero S1", start: 1, end: 13, displayStart: 1, displayEnd: 13 },
    { name: "Fate/Zero S2", start: 14, end: 25, displayStart: 1, displayEnd: 12 },
  ],
  "bleach-sennen-kessen-hen": [
    { name: "Part 1", start: 1, end: 13 },
    { name: "Part 2: Ketsubetsu-tan", start: 14, end: 26 },
    { name: "Part 3: Soukoku-tan", start: 27, end: 40 },
  ],
};

const ONE_PIECE_MOVIES = Object.freeze([
  null,
  { number: 1, slug: "one-piece-movie-01", label: "The Movie", releasedAt: "2000-03-04" },
  { number: 2, slug: "one-piece-movie-02-nejimaki-jima-no-daibouken", label: "Clockwork Island Adventure", releasedAt: "2001-03-03" },
  { number: 3, slug: "one-piece-movie-03-chinjuu-jima-no-chopper-oukoku", label: "Chopper's Kingdom on the Island of Strange Animals", releasedAt: "2002-03-02" },
  { number: 4, slug: "one-piece-movie-04-dead-end-no-bouken", label: "Dead End Adventure", releasedAt: "2003-03-01" },
  { number: 5, slug: "one-piece-movie-05-norowareta-seiken", label: "The Curse of the Sacred Sword", releasedAt: "2004-03-06" },
  { number: 6, slug: "one-piece-movie-06-omatsuri-danshaku-to-himitsu-no-shima", label: "Baron Omatsuri and the Secret Island", releasedAt: "2005-03-05" },
  { number: 7, slug: "one-piece-movie-07-karakuri-jou-no-mecha-kyohei", label: "The Giant Mechanical Soldier of Karakuri Castle", releasedAt: "2006-03-04" },
  { number: 8, slug: "one-piece-movie-08-episode-of-alabasta-sabaku-no-oujo-to-kaizoku-tachi", label: "Episode of Alabasta - The Desert Princess and the Pirates", releasedAt: "2007-03-03" },
  { number: 9, slug: "one-piece-movie-09-episode-of-chopper-plus-fuyu-ni-saku-kiseki-no-sakura", label: "Episode of Chopper Plus - Bloom in the Winter, Miracle Sakura", releasedAt: "2008-03-01" },
  { number: 10, slug: "one-piece-film-strong-world", label: "Film: Strong World", releasedAt: "2009-12-12" },
  { number: 11, slug: "one-piece-3d-mugiwara-chase", label: "3D: Straw Hat Chase", releasedAt: "2011-03-19" },
  { number: 12, slug: "one-piece-film-z", label: "Film: Z", releasedAt: "2012-12-15" },
  { number: 13, slug: "one-piece-film-gold", label: "Film: Gold", releasedAt: "2016-07-23" },
  { number: 14, slug: "one-piece-movie-14-stampede", label: "Stampede", releasedAt: "2019-08-09" },
  { number: 15, slug: "one-piece-film-red", label: "Film: Red", releasedAt: "2022-08-06" },
]);

function CANONICAL_EPISODE_OFFSET_MAPPING() {
  return (typeof window !== "undefined" && window.AnimeTrackerMultipartMappings?.EPISODE_OFFSET_MAPPING) || {};
}

const SeasonGrouping = {
  isChronologyGroup(baseSlug) {
    return baseSlug === "fate";
  },

  isMovie(slug, anime = null) {
    const lowerSlug = String(slug || "").toLowerCase();
    if (!lowerSlug) return false;
    const lowerTitle = String(anime?.title || "").toLowerCase();
    const mediaType = this.getMediaType(lowerSlug, anime);

    if (mediaType) return mediaType === "MOVIE";

    const nonMoviePatterns = [/-ova(-|$)/i, /-ona(-|$)/i, /-special(-|$)/i, /-recap(-|$)/i];
    const titleNonMoviePatterns = [/\bova\b/i, /\bona\b/i, /\bspecial\b/i, /\brecap\b/i];
    const hasNonMovieHint =
      nonMoviePatterns.some((pattern) => pattern.test(lowerSlug)) || titleNonMoviePatterns.some((pattern) => pattern.test(lowerTitle));

    if (lowerSlug === "trinity-seven-nanatsu-no-taizai-to-nana-madoushi") return true;

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
      /-mugen-train$/i,
    ];
    if (moviePatterns.some((pattern) => pattern.test(lowerSlug))) {
      return true;
    }

    const titleMoviePatterns = [/\bmovie\b/i, /\bfilm\b/i, /\bthe movie\b/i, /\bgekijouban\b/i];

    const hasTitleMovieHint = titleMoviePatterns.some((pattern) => pattern.test(lowerTitle));
    if (hasTitleMovieHint && !hasNonMovieHint) {
      return true;
    }

    if (!anime || typeof anime !== "object") {
      return false;
    }

    const trackedEpisodes = Array.isArray(anime.episodes) ? anime.episodes.length : 0;
    const totalWatchTimeSeconds = Number(anime.totalWatchTime) || 0;
    const avgMinutes = trackedEpisodes > 0 ? totalWatchTimeSeconds / 60 / trackedEpisodes : 0;

    const hasSeriesSlugHint = /-season-?\d+|-s\d+|-(part|cour)-?\d+|-\d+(st|nd|rd|th)-season|-(ii|iii|iv|v|vi)$/i.test(lowerSlug);
    const hasSeriesTitleHint = /\bseason\b|\bpart\b|\bcour\b/i.test(lowerTitle);

    if (hasSeriesSlugHint || hasSeriesTitleHint || hasNonMovieHint) {
      return false;
    }

    if (trackedEpisodes === 1 && avgMinutes >= 70) return true;

    return false;
  },

  isMovieDisplay(slug, anime = null) {
    if (this.isMovie(slug, anime)) return true;
    if (this.getDisplayMediaType(slug, anime) !== "SPECIAL") return false;
    const siteInfo = window.AnimeTracker?.StatusService?.getAuthoritativeSiteInfo?.(String(slug || "").toLowerCase(), anime);
    const storedSiteTotal = anime?.totalEpisodesSource === "an1me" ? Number(anime.totalEpisodes) || 0 : 0;
    const totalEpisodes = Number(siteInfo?.totalEpisodes) || storedSiteTotal || Number(anime?.totalEpisodes) || 0;
    return totalEpisodes === 1;
  },

  getMediaType(slug, anime = null) {
    const service = window.AnimeTracker?.AnilistService;
    const info = service?.getAuthoritativeInfo?.(String(slug || "").toLowerCase()) || null;
    const compatibleInfo = !info || !anime || service?.isInfoCompatibleWithEntry?.(anime, info) !== false ? info : null;
    return globalThis.AnimeTrackerMediaType?.resolve(slug, anime, compatibleInfo) || null;
  },

  getDisplayMediaType(slug, anime = null) {
    const inferred = globalThis.AnimeTrackerMediaType?.infer(slug, anime?.title || "") || null;
    const resolved = this.getMediaType(slug, anime);
    const siteInfo = window.AnimeTracker?.StatusService?.getAuthoritativeSiteInfo?.(String(slug || "").toLowerCase(), anime);
    const total = Number(siteInfo?.totalEpisodes) || Number(anime?.totalEpisodes) || 0;
    if (globalThis.AnimeTrackerMediaType?.isSupplement(inferred) && (!resolved || (resolved === "TV" && total === 1))) return inferred;
    return resolved || inferred;
  },

  getEntryOrder(slug, anime = null) {
    const type = this.getDisplayMediaType(slug, anime);
    if (type === "SPECIAL") return 700;
    if (type === "OVA") return 710;
    if (type === "ONA") return 720;
    if (type === "MUSIC") return 730;
    return this.getSeasonNumber(slug);
  },

  getOnePieceMovieInfo(slug, title = "") {
    const normalizedSlug = String(slug || "").toLowerCase();
    const normalizedTitle = String(title || "").toLowerCase();
    if (!normalizedSlug.startsWith("one-piece") && !normalizedTitle.startsWith("one piece")) return null;

    const exact = ONE_PIECE_MOVIES.find((movie) => movie?.slug === normalizedSlug);
    if (exact) return exact;

    const context = `${normalizedSlug} ${normalizedTitle}`;
    const numbered = context.match(/\bmovie[-\s_:]*0?(\d{1,2})\b/i);
    if (numbered) return ONE_PIECE_MOVIES[Number(numbered[1])] || null;

    if (/film[-\s:]*red\b/i.test(context)) return ONE_PIECE_MOVIES[15];
    if (/\bstampede\b/i.test(context)) return ONE_PIECE_MOVIES[14];
    if (/film[-\s:]*gold\b/i.test(context)) return ONE_PIECE_MOVIES[13];
    if (/film[-\s:]*z\b/i.test(context)) return ONE_PIECE_MOVIES[12];
    if (/(?:mugiwara|straw[-\s]*hat)[-\s]*(?:no[-\s]*)?chase\b/i.test(context)) return ONE_PIECE_MOVIES[11];
    if (/strong[-\s]*world\b/i.test(context)) return ONE_PIECE_MOVIES[10];
    return null;
  },

  getMovieReleaseTimestamp(slug, title = "") {
    const releasedAt = this.getOnePieceMovieInfo(slug, title)?.releasedAt;
    return releasedAt ? Date.parse(`${releasedAt}T00:00:00Z`) : 0;
  },

  getMovieNumber(slug, title = "") {
    const onePieceMovie = this.getOnePieceMovieInfo(slug, title);
    if (onePieceMovie) return onePieceMovie.number;

    if (slug.includes("one-piece-3d-mugiwara-chase")) return 11;

    let match = slug.match(/-movie-0?(\d+)/i);
    if (match) return parseInt(match[1], 10);

    const romanMatch = slug.match(/-(i{1,3}|iv|v)(?:-|$)/i);
    if (romanMatch) {
      const romanMap = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
      return romanMap[romanMatch[1].toLowerCase()] || 1;
    }

    if (slug.includes("higashi-no-eden")) {
      if (slug.includes("king") || slug.includes("-1")) return 1;
      if (slug.includes("paradise") || slug.includes("-2")) return 2;
    }

    const filmOrder = {
      "film-gold": 13,
      "film-red": 15,
      "film-z": 12,
      "film-strong-world": 10,
    };
    for (const [filmSlug, num] of Object.entries(filmOrder)) {
      if (slug.includes(filmSlug)) return num;
    }

    return 1;
  },

  getMovieBaseSlug(slug) {
    if (slug.startsWith("fate-zero") || slug.startsWith("fate-stay-night")) return "fate";
    if (slug.startsWith("trinity-seven-nanatsu")) return "trinity-seven";
    if (slug.startsWith("kimetsu-no-yaiba")) return "kimetsu-no-yaiba";
    if (slug.startsWith("higashi-no-eden")) return "higashi-no-eden";
    if (slug.startsWith("one-piece")) return "one-piece";
    if (slug.startsWith("dragon-ball")) return "dragon-ball";
    if (slug.startsWith("naruto")) return "naruto";
    if (slug.startsWith("hunter-x-hunter") || slug.startsWith("hunterhunter")) return "hunter-x-hunter";
    if (slug.startsWith("initial-d")) return "initial-d";

    return slug
      .replace(/-movie.*$/i, "")
      .replace(/-film.*$/i, "")
      .replace(/-3d.*$/i, "")
      .replace(/-gekijouban.*$/i, "")
      .replace(/-the-movie.*$/i, "");
  },

  getBaseSlug(slug, anime = null) {
    if (this.isMovie(slug, anime)) {
      return this.getMovieBaseSlug(slug);
    }

    if (slug.startsWith("jujutsu-kaisen")) return "jujutsu-kaisen";
    if (slug.startsWith("fate-zero") || slug.startsWith("fate-stay-night")) return "fate";
    if (slug.startsWith("naruto")) return "naruto";
    if (slug.startsWith("one-punch-man")) return "one-punch-man";
    if (slug.startsWith("one-piece")) return "one-piece";
    if (slug.startsWith("kimetsu-no-yaiba")) return "kimetsu-no-yaiba";
    if (slug.startsWith("shingeki-no-kyojin")) return "shingeki-no-kyojin";
    if (slug.startsWith("initial-d")) return "initial-d";
    if (slug.startsWith("blue-lock")) return "blue-lock";
    if (slug.startsWith("bleach")) return "bleach";
    if (slug.startsWith("mashle")) return "mashle";
    if (slug.startsWith("hunter-x-hunter") || slug.startsWith("hunterhunter")) return "hunter-x-hunter";

    return slug
      .replace(/-\d+(st|nd|rd|th)-season(-.+)?$/i, "")
      .replace(/-season-?\d+(-[a-z-]+)?$/i, "")
      .replace(/-s\d+$/i, "")
      .replace(/-(part|cour)-?\d+(-[a-z-]+)?$/i, "")
      .replace(/-20\d{2}$/i, "")
      .replace(/-(ii|iii|iv|v|vi)$/i, "")
      .replace(/-[a-z]+-hen$/i, "");
  },

  getChronologyInfo(baseSlug, slug, title = "") {
    if (baseSlug !== "fate") return null;

    const lowerSlug = String(slug || "").toLowerCase();
    const rawTitle = String(title || "").trim();

    if (lowerSlug.startsWith("fate-zero")) {
      return {
        order: 10,
        separatorLabel: "1994",
        itemLabel: "Fate/Zero",
      };
    }

    if (lowerSlug === "fate-stay-night") {
      return {
        order: 20,
        separatorLabel: "2004",
        itemLabel: "Fate/stay night",
      };
    }

    if (lowerSlug.includes("unlimited-blade-works-prologue")) {
      return {
        order: 30,
        separatorLabel: "2004",
        itemLabel: "Unlimited Blade Works - Prologue",
      };
    }

    if (lowerSlug.includes("unlimited-blade-works-season-2") || lowerSlug.includes("unlimited-blade-works-2nd-season")) {
      return {
        order: 40,
        separatorLabel: "2004",
        itemLabel: "Unlimited Blade Works Season 2",
      };
    }

    if (lowerSlug.includes("unlimited-blade-works")) {
      return {
        order: 35,
        separatorLabel: "2004",
        itemLabel: "Unlimited Blade Works",
      };
    }

    // Real an1me.to slugs use roman numerals + subtitles, e.g.
    // fate-stay-night-movie-heavens-feel-iii-spring-song.
    if (lowerSlug.includes("heavens-feel-3") || lowerSlug.includes("spring-song") || /heavens-feel-iii(-|$)/.test(lowerSlug)) {
      return {
        order: 52,
        separatorLabel: "2004",
        itemLabel: "Heaven's Feel III: Spring Song",
      };
    }

    if (lowerSlug.includes("heavens-feel-2") || lowerSlug.includes("lost-butterfly") || /heavens-feel-ii(-|$)/.test(lowerSlug)) {
      return {
        order: 51,
        separatorLabel: "2004",
        itemLabel: "Heaven's Feel II: Lost Butterfly",
      };
    }

    if (lowerSlug.includes("heavens-feel-1") || lowerSlug.includes("presage-flower") || /heavens-feel-i(-|$)/.test(lowerSlug)) {
      return {
        order: 50,
        separatorLabel: "2004",
        itemLabel: "Heaven's Feel I: Presage Flower",
      };
    }

    if (lowerSlug.includes("heavens-feel")) {
      return {
        order: 50,
        separatorLabel: "2004",
        itemLabel: rawTitle || "Heaven's Feel",
      };
    }

    return {
      order: 900,
      separatorLabel: "Other",
      itemLabel: rawTitle || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    };
  },

  getGroupDisplayTitle(baseSlug, fallbackTitle = "") {
    if (baseSlug === "fate") return "Fate";
    return fallbackTitle;
  },

  getSeasonNumber(slug) {
    if (slug.startsWith("one-piece")) {
      if (slug.includes("new-world")) return 2;
      return 1;
    }

    if (slug.startsWith("one-punch-man")) {
      if (slug.includes("season-3") || slug.endsWith("-3")) return 3;
      if (slug.includes("season-2") || slug.includes("2nd-season")) return 2;
      return 1;
    }

    if (slug.startsWith("jujutsu-kaisen")) {
      if (
        slug.includes("culling-game") ||
        slug.includes("season-3") ||
        slug.includes("dead-culling-game") ||
        slug.includes("shimetsu-kaiyuu")
      ) {
        if (slug.includes("koupen") || slug.includes("part-2") || slug.includes("part2")) return 3.2;
        if (slug.includes("zenpen") || slug.includes("part-1") || slug.includes("part1")) return 3.1;
        return 3;
      }
      if (
        slug.includes("season-2") ||
        slug.includes("2nd-season") ||
        slug.includes("shibuya-incident") ||
        slug.includes("kaigyoku-gyokusetsu")
      )
        return 2;
      if (slug.includes("0") || slug.includes("movie")) return 0;
      return 1;
    }

    if (slug.startsWith("naruto") || slug.startsWith("boruto")) {
      const slugLower = slug.toLowerCase();
      if (slugLower.includes("boruto") || slugLower.includes("-3") || slugLower.includes("season-3")) return 3;
      if (slugLower.includes("shippuden") || slugLower.includes("shippuuden") || slugLower.includes("-2") || slugLower.includes("season-2"))
        return 2;
      return 1;
    }

    if (slug.startsWith("kimetsu-no-yaiba")) {
      if (slug.includes("hashira-geiko-hen")) return 5;
      if (slug.includes("katanakaji-no-sato-hen")) return 4;
      if (slug.includes("yuukaku-hen")) return 3;
      if (slug.includes("mugen-ressha-hen")) return 2;
      return 1;
    }

    if (slug.startsWith("shingeki-no-kyojin")) {
      if (slug.includes("final-season-kanketsu-hen")) return 7;
      if (slug.includes("final-season-part-2")) return 6;
      if (slug.includes("final-season")) return 5;
      if (slug.includes("season-3-part-2")) return 4;
      if (slug.includes("season-3")) return 3;
      if (slug.includes("season-2")) return 2;
      return 1;
    }

    if (slug.startsWith("initial-d")) {
      if (slug.includes("final-stage") || slug.includes("sixth-stage") || slug.includes("6th-stage")) return 6;
      if (slug.includes("fifth-stage") || slug.includes("5th-stage")) return 5;
      if (slug.includes("fourth-stage") || slug.includes("4th-stage")) return 4;
      if (slug.includes("third-stage") || slug.includes("3rd-stage")) return 3;
      if (slug.includes("second-stage") || slug.includes("2nd-stage")) return 2;
      return 1;
    }

    if (slug.startsWith("blue-lock")) {
      if (slug.includes("season-3") || slug.includes("3rd-season") || slug.includes("-3")) return 3;
      if (
        slug.includes("vs-u-20") ||
        slug.includes("vs-u20") ||
        slug.includes("u-20-japan") ||
        slug.includes("season-2") ||
        slug.includes("2nd-season") ||
        slug.includes("-2")
      )
        return 2;
      return 1;
    }

    // "part"/"cour" suffixes become a fraction so e.g. season-2-part-2 sorts after season 2
    const partMatch = slug.match(/-(?:part|cour)-?(\d+)/i);
    const partOffset = partMatch ? parseInt(partMatch[1], 10) / 10 : 0;

    // Ordinal form first (unanchored): "-4th-season-2-nensei-hen-1-gakki" must read
    // season 4, not let "-season-2-" below misparse the subtitle's number.
    let match = slug.match(/-(\d+)(?:st|nd|rd|th)-season/i);
    if (match) return parseInt(match[1], 10) + partOffset;

    match = slug.match(/-season-?(\d+)/i);
    if (match) return parseInt(match[1], 10) + partOffset;

    match = slug.match(/-s(\d+)$/i);
    if (match) return parseInt(match[1], 10);

    const romanMatch = slug.match(/-(ii|iii|iv|v|vi)$/i);
    if (romanMatch) {
      const romanMap = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };
      return romanMatch[1].toLowerCase() in romanMap ? romanMap[romanMatch[1].toLowerCase()] : 1;
    }

    if (slug.startsWith("bleach")) {
      if (slug.includes("sennen-kessen-hen")) return 2;
      return 1;
    }

    if (slug.startsWith("mashle")) {
      // S2 on an1me.to is the arc-named slug mashle-shinkakusha-kouho-senbatsu-shiken-hen
      if (slug.includes("shinkakusha")) return 2;
      return 1;
    }

    if (slug === "trinity-seven-nanatsu-no-taizai-to-nana-madoushi") return 2;

    if (slug.startsWith("hunter-x-hunter") || slug.startsWith("hunterhunter")) {
      if (slug.includes("2011")) return 2;
      return 1;
    }

    return 1;
  },

  getSeasonLabel(slug, title, anime = null) {
    const displayType = this.getDisplayMediaType(slug, anime || { title });
    const typeLabel = globalThis.AnimeTrackerMediaType?.getLabel(displayType);
    if (typeLabel && !["TV", "TV Short"].includes(typeLabel)) return typeLabel;

    if (slug.startsWith("one-piece")) {
      if (slug.includes("new-world")) return "New World";
      return "East Blue & Grandline";
    }

    if (slug.startsWith("one-punch-man")) {
      if (slug.includes("season-3") || slug.endsWith("-3")) return "Season 3";
      if (slug.includes("season-2") || slug.includes("2nd-season")) return "Season 2";
      return "Season 1";
    }

    if (slug.startsWith("naruto") || slug.startsWith("boruto")) {
      const slugLower = slug.toLowerCase();
      const titleLower = title ? title.toLowerCase() : "";

      if (slugLower.includes("boruto") || slugLower.endsWith("-3") || slugLower.includes("season-3")) return "Naruto Boruto";
      if (titleLower.includes("boruto")) return "Naruto Boruto";
      if (slugLower.includes("shippuden") || slugLower.includes("shippuuden")) return "Naruto Shippuden";
      if (slugLower.endsWith("-2") || slugLower.includes("season-2")) return "Naruto Shippuden";
      if (titleLower.includes("shippuden") || titleLower.includes("shippuuden")) return "Naruto Shippuden";
      return "Naruto";
    }

    if (slug.startsWith("jujutsu-kaisen")) {
      if (
        slug.includes("culling-game") ||
        slug.includes("season-3") ||
        slug.includes("dead-culling-game") ||
        slug.includes("shimetsu-kaiyuu")
      ) {
        if (slug.includes("koupen") || slug.includes("part-2") || slug.includes("part2")) return "Season 3 Part 2";
        if (slug.includes("zenpen") || slug.includes("part-1") || slug.includes("part1")) return "Season 3 Part 1";
        return "Season 3";
      }
      if (
        slug.includes("season-2") ||
        slug.includes("2nd-season") ||
        slug.includes("shibuya-incident") ||
        slug.includes("kaigyoku-gyokusetsu")
      )
        return "Season 2";
      if (slug.includes("0") || slug.includes("movie")) return "Movie 0";
      return "Season 1";
    }

    if (slug.startsWith("kimetsu-no-yaiba")) {
      if (slug.includes("hashira-geiko-hen")) return "Hashira Training Arc";
      if (slug.includes("katanakaji-no-sato-hen")) return "Swordsmith Village Arc";
      if (slug.includes("yuukaku-hen")) return "Entertainment District Arc";
      if (slug.includes("mugen-ressha-hen")) return "Mugen Train Arc";
      return "Season 1";
    }

    if (slug.startsWith("shingeki-no-kyojin")) {
      if (slug.includes("final-season-kanketsu-hen")) return "Final Season Part 3";
      if (slug.includes("final-season-part-2")) return "Final Season Part 2";
      if (slug.includes("final-season")) return "Final Season Part 1";
      if (slug.includes("season-3-part-2")) return "Season 3 Part 2";
      if (slug.includes("season-3")) return "Season 3 Part 1";
      if (slug.includes("season-2")) return "Season 2";
      return "Season 1";
    }

    if (slug.startsWith("initial-d")) {
      if (slug.includes("final-stage") || slug.includes("sixth-stage") || slug.includes("6th-stage")) return "Final Stage";
      if (slug.includes("fifth-stage") || slug.includes("5th-stage")) return "Fifth Stage";
      if (slug.includes("fourth-stage") || slug.includes("4th-stage")) return "Fourth Stage";
      if (slug.includes("third-stage") || slug.includes("3rd-stage")) return "Third Stage (Movie)";
      if (slug.includes("second-stage") || slug.includes("2nd-stage")) return "Second Stage";
      return "First Stage";
    }

    if (slug.startsWith("blue-lock")) {
      if (slug.includes("season-3") || slug.includes("3rd-season") || slug.includes("-3")) return "Season 3";
      if (
        slug.includes("vs-u-20") ||
        slug.includes("vs-u20") ||
        slug.includes("u-20-japan") ||
        slug.includes("season-2") ||
        slug.includes("2nd-season") ||
        slug.includes("-2")
      )
        return "Season 2: vs. U-20 Japan";
      return "Season 1";
    }

    if (slug.includes("bleach-sennen-kessen-hen")) {
      if (slug.includes("soukoku-tan")) return "TYBW Part 3";
      if (slug.includes("ketsubetsu-tan")) return "TYBW Part 2";
      return "Thousand-Year Blood War";
    }

    if (slug === "trinity-seven-nanatsu-no-taizai-to-nana-madoushi") return "Movie: Nanatsu no Taizai to Nana Madoushi";

    if (slug.startsWith("hunter-x-hunter") || slug.startsWith("hunterhunter")) {
      if (slug.includes("2011")) return "2011 Version";
      return "1999 Version";
    }

    const seasonNum = this.getSeasonNumber(slug);
    if (Number.isInteger(seasonNum)) return `Season ${seasonNum}`;
    const whole = Math.floor(seasonNum);
    const part = Math.round((seasonNum - whole) * 10);
    return `Season ${whole} Part ${part}`;
  },

  getMovieLabel(slug, title) {
    const onePieceMovie = this.getOnePieceMovieInfo(slug, title);
    if (onePieceMovie) return onePieceMovie.label;

    if (slug.includes("higashi-no-eden")) {
      if (slug.includes("-i-") || slug.includes("-1-") || slug.endsWith("-i")) return "Movie I: King of Eden";
      if (slug.includes("-ii-") || slug.includes("-2-") || slug.endsWith("-ii")) return "Movie II: Paradise Lost";
      if (title) {
        if (title.toLowerCase().includes("king")) return "Movie I: King of Eden";
        if (title.toLowerCase().includes("paradise")) return "Movie II: Paradise Lost";
      }
    }

    const filmMatch = slug.match(/-film-([a-z-]+)/i);
    if (filmMatch) {
      const filmName = filmMatch[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      return `Film: ${filmName}`;
    }

    const movieMatch = slug.match(/-movie-0?(\d+)/i);
    if (movieMatch) return `Movie ${movieMatch[1]}`;

    const romanMatch = slug.match(/-movie-?(i{1,3}|iv|v)(?:-|$)/i);
    if (romanMatch) {
      const romanMap = { i: "I", ii: "II", iii: "III", iv: "IV", v: "V" };
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
      const baseTitle = baseSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const cleaned = title.replace(new RegExp(`^${baseTitle}\\s*[:\\-]?\\s*`, "i"), "").trim();
      if (cleaned) return cleaned;
      return title.trim();
    }

    return "Movie";
  },

  groupByBase(animeEntries) {
    const groups = new Map();
    const movieGroups = new Map();

    for (const [slug, anime] of animeEntries) {
      const isMovie = this.isMovieDisplay(slug, anime);
      const isSpecialMovie = isMovie && !this.isMovie(slug, anime);
      const baseSlug = isMovie ? this.getMovieBaseSlug(slug) : this.getBaseSlug(slug, anime);
      const chronologyInfo = this.getChronologyInfo(baseSlug, slug, anime?.title || "");
      const movieNumber = isSpecialMovie ? 0 : this.getMovieNumber(slug, anime?.title || "");
      const movieReleasedAt = isSpecialMovie ? 0 : this.getMovieReleaseTimestamp(slug, anime?.title || "");

      if (isMovie) {
        const movieGroupKey = baseSlug + "__movies";
        if (!movieGroups.has(movieGroupKey)) movieGroups.set(movieGroupKey, []);
        movieGroups.get(movieGroupKey).push({
          slug,
          anime,
          movieNum: movieNumber,
          movieReleasedAt,
          seasonNum: chronologyInfo?.order ?? movieNumber,
          chronologyLabel: chronologyInfo?.separatorLabel || null,
          chronologyItemLabel: chronologyInfo?.itemLabel || null,
          isMovie: true,
        });
      } else {
        if (!groups.has(baseSlug)) groups.set(baseSlug, []);
        groups.get(baseSlug).push({
          slug,
          anime,
          seasonNum: chronologyInfo?.order ?? this.getEntryOrder(slug, anime),
          chronologyLabel: chronologyInfo?.separatorLabel || null,
          chronologyItemLabel: chronologyInfo?.itemLabel || null,
        });
      }
    }

    this.mergeRelatedGroups(groups);

    for (const [, entries] of groups) {
      entries.sort((a, b) => a.seasonNum - b.seasonNum || String(a.anime?.title || a.slug).localeCompare(String(b.anime?.title || b.slug)));
    }

    for (const [, entries] of movieGroups) {
      if (entries.length > 0 && this.isChronologyGroup(this.getBaseSlug(entries[0].slug, entries[0].anime))) {
        entries.sort((a, b) => (a.seasonNum || 0) - (b.seasonNum || 0));
        continue;
      }

      entries.sort((a, b) => {
        if (a.movieReleasedAt && b.movieReleasedAt && a.movieReleasedAt !== b.movieReleasedAt) {
          return a.movieReleasedAt - b.movieReleasedAt;
        }
        if (a.movieNum !== b.movieNum) return a.movieNum - b.movieNum;
        const aExplicit = /-movie-0?\d+/i.test(a.slug) ? 0 : 1;
        const bExplicit = /-movie-0?\d+/i.test(b.slug) ? 0 : 1;
        if (aExplicit !== bExplicit) return aExplicit - bExplicit;
        const aLabel = this.getMovieLabel(a.slug, a.anime?.title || "");
        const bLabel = this.getMovieLabel(b.slug, b.anime?.title || "");
        const labelOrder = aLabel.localeCompare(bLabel, "en", { numeric: true, sensitivity: "base" });
        return labelOrder || a.slug.localeCompare(b.slug, "en", { numeric: true, sensitivity: "base" });
      });
    }

    for (const [groupKey, entries] of movieGroups) {
      const movieBaseSlug = groupKey.replace(/__movies$/, "");
      const relatedBase = Array.from(groups.keys())
        .filter((candidate) => {
          if (!entries.some((entry) => entry.slug.startsWith(`${candidate}-`))) return false;
          if (candidate.split("-").length >= 2) return true;
          const candidateEntries = groups.get(candidate) || [];
          const seriesTitle = String(
            candidateEntries.find((entry) => entry.slug === candidate)?.anime?.title ||
              candidate.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
          ).trim();
          if (!seriesTitle) return false;
          const escapedTitle = seriesTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const installmentTitle = new RegExp(
            `^${escapedTitle}(?:\\s*[:\\-–—]|\\s+(?:movie|film|theatrical|gekijouban|special|recap|fan[-\\s]*letter)\\b)`,
            "i",
          );
          return entries.some((entry) => installmentTitle.test(String(entry.anime?.title || "").trim()));
        })
        .sort((a, b) => b.length - a.length)[0];
      const baseSlug = groups.has(movieBaseSlug) ? movieBaseSlug : relatedBase || movieBaseSlug;
      if (groups.has(baseSlug)) {
        const seriesGroup = groups.get(baseSlug);
        const maxSeasonNum = seriesGroup.reduce((m, e) => Math.max(m, e.seasonNum || 0), 0);
        entries.forEach((entry, i) => {
          const intrinsicOrder = this.getSeasonNumber(entry.slug);
          const useIntrinsicOrder = /initial-d.*(?:third|3rd)-stage/i.test(entry.slug);
          seriesGroup.push({
            slug: entry.slug,
            anime: entry.anime,
            seasonNum: this.isChronologyGroup(baseSlug)
              ? entry.seasonNum || maxSeasonNum + 1 + i
              : useIntrinsicOrder
                ? intrinsicOrder
                : maxSeasonNum + 1 + i,
            chronologyLabel: entry.chronologyLabel || null,
            chronologyItemLabel: entry.chronologyItemLabel || null,
            isMovie: true,
          });
        });
        seriesGroup.sort((a, b) => (a.seasonNum || 0) - (b.seasonNum || 0));
      } else if (this.isChronologyGroup(baseSlug)) {
        groups.set(
          baseSlug,
          entries.map((entry) => ({
            slug: entry.slug,
            anime: entry.anime,
            seasonNum: entry.seasonNum || 0,
            chronologyLabel: entry.chronologyLabel || null,
            chronologyItemLabel: entry.chronologyItemLabel || null,
            isMovie: false,
          })),
        );
      } else {
        groups.set(groupKey, entries);
      }
    }

    return groups;
  },

  mergeRelatedGroups(groups) {
    const baseSlugs = Array.from(groups.keys()).sort((a, b) => a.length - b.length);
    const merged = new Set();
    const normalizeFamilyTitle = (value) =>
      String(value || "")
        .trim()
        .replace(/[\u2013\u2014]/g, "-")
        .replace(/\s*[\[(]?(?:19|20)\d{2}[\])]?\s*$/i, "")
        .trim();
    const isNumberedSeriesEntry = (entry) => {
      if (!entry || entry.isMovie || this.isMovieDisplay(entry.slug, entry.anime)) return false;
      const type = this.getDisplayMediaType(entry.slug, entry.anime);
      return !["MOVIE", "SPECIAL", "MUSIC"].includes(type);
    };

    for (let i = 0; i < baseSlugs.length; i++) {
      const shorter = baseSlugs[i];
      if (merged.has(shorter)) continue;

      for (let j = i + 1; j < baseSlugs.length; j++) {
        const longer = baseSlugs[j];
        if (merged.has(longer)) continue;

        const relationSuffix = longer.startsWith(shorter + "-") ? longer.slice(shorter.length + 1) : "";
        const numericRelationMatch = relationSuffix.match(/^([1-9]\d?)(?:-|$)/);
        const numericRelation = numericRelationMatch ? Number(numericRelationMatch[1]) : 0;
        const hasRelationMarker =
          /^(?:season-?\d+|s\d+|part-?\d+|cour-?\d+|\d+(?:st|nd|rd|th)-season|ii(?:i|v)?|iv|v|vi|ova|oav|ona|special|recap|music|pv)(?:-|$)/i.test(
            relationSuffix,
          );
        const longerIsSupplement = (groups.get(longer) || []).every((entry) =>
          globalThis.AnimeTrackerMediaType?.isSupplement(this.getDisplayMediaType(entry.slug, entry.anime)),
        );
        const shorterEntries = groups.get(shorter) || [];
        const shorterTitle = String(
          shorterEntries.find((entry) => entry.slug === shorter)?.anime?.title ||
            shorter.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
        ).trim();
        const escapedShorterTitle = shorterTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const hasTitleBoundary = (groups.get(longer) || []).some((entry) =>
          new RegExp(`^${escapedShorterTitle}(?:\\s*[:\\-–—]|\\s+(?:ova|oav|ona|special|recap|music|pv)\\b)`, "i").test(
            String(entry.anime?.title || "").trim(),
          ),
        );
        const normalizedShorterTitle = normalizeFamilyTitle(shorterTitle);
        const escapedNormalizedTitle = normalizedShorterTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const numberedTitlePattern =
          numericRelation >= 2
            ? new RegExp(
                `^${escapedNormalizedTitle}\\s*(?:[:\\-]\\s*)?(?:season\\s*)?${numericRelation}(?:st|nd|rd|th)?(?:\\s+season)?(?=\\b|\\s*[:\\-])`,
                "i",
              )
            : null;
        const longerEntries = groups.get(longer) || [];
        const isNumberedSeriesRelation =
          !!numberedTitlePattern &&
          normalizedShorterTitle.length > 0 &&
          shorterEntries.length > 0 &&
          shorterEntries.every(isNumberedSeriesEntry) &&
          longerEntries.length > 0 &&
          longerEntries.every(isNumberedSeriesEntry) &&
          longerEntries.some((entry) => numberedTitlePattern.test(normalizeFamilyTitle(entry.anime?.title)));

        if (relationSuffix && (hasRelationMarker || (longerIsSupplement && hasTitleBoundary) || isNumberedSeriesRelation)) {
          if (isNumberedSeriesRelation) {
            shorterEntries.forEach((entry) => {
              const seasonNum = this.getSeasonNumber(entry.slug);
              entry.seasonNum = Number.isFinite(seasonNum) && seasonNum > 0 ? seasonNum : 1;
              entry.groupLabel = `Season ${entry.seasonNum}`;
            });
            longerEntries.forEach((entry) => {
              entry.seasonNum = numericRelation;
              entry.groupLabel = `Season ${numericRelation}`;
            });
          }

          longerEntries.forEach((entry) => {
            if (entry.seasonNum === 1 && longerEntries.length === 1) {
              const seasonNums = shorterEntries.map((e) => e.seasonNum).filter(Number.isFinite);
              const maxSeason = seasonNums.length > 0 ? Math.max(...seasonNums) : 0;
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
  },
};

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.CONFIG = CONFIG;
window.AnimeTracker.DONATE_LINKS = DONATE_LINKS;
window.AnimeTracker.ANIME_PARTS_CONFIG = ANIME_PARTS_CONFIG;
Object.defineProperty(window.AnimeTracker, "CANONICAL_EPISODE_OFFSET_MAPPING", {
  get: CANONICAL_EPISODE_OFFSET_MAPPING,
  enumerable: true,
  configurable: true,
});
window.AnimeTracker.SeasonGrouping = SeasonGrouping;
