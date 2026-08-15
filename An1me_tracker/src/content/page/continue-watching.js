// continue-watching.js — home-page "Continue Watching" shelf (merged): pure display
// helpers (CWUtils), the shelf stylesheet, and the shelf builder.
(function () {
  "use strict";

  const WATCH_BASE = "https://an1me.to/watch/";
  const MAX_ITEMS = 20;

  function isContextValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function parseProgressKey(key) {
    const m = /^(.+)__episode-(\d+)$/.exec(key);
    if (!m) return null;
    const episode = parseInt(m[2], 10);
    if (!Number.isFinite(episode) || episode <= 0) return null;
    return { slug: m[1], episode };
  }

  function humanizeSlug(slug) {
    return String(slug || "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function safeCover(url) {
    return typeof url === "string" && /^https:\/\//i.test(url) ? url : null;
  }

  function resumeUrl(slug, episode, entry) {
    const pagePath = entry && typeof entry.pagePath === "string" ? entry.pagePath.trim() : "";
    if (pagePath) return WATCH_BASE + pagePath;
    return `${WATCH_BASE}${slug}-episode-${episode}`;
  }

  function isHardInactive(anime) {
    if (!anime) return false;
    const state = globalThis.AnimeTrackerEntryState?.getResolvedListState?.(anime) || anime.listState || "active";
    return state === "completed" || state === "dropped" || state === "on_hold";
  }

  function computeNextEpisodeUrl(anime, slug, episode, animeInfo) {
    if (!anime) return null;

    if (isHardInactive(anime)) return null;

    const next = episode + 1;
    const latestEp = Number(animeInfo && animeInfo.latestEpisode) || Number(anime.latestEpisode) || 0;
    const totalEp = Number(animeInfo && animeInfo.totalEpisodes) || Number(anime.totalEpisodes) || 0;
    const status = String((animeInfo && animeInfo.status) || anime.status || "").toUpperCase();
    const hasFutureRelease = !!((animeInfo && animeInfo.nextEpisodeAt) || anime.nextEpisodeAt);

    let available = false;
    if (latestEp >= next) {
      available = true;
    } else if (!hasFutureRelease && totalEp >= next && (latestEp === 0 || status === "FINISHED")) {
      available = true;
    }
    if (!available) return null;

    return `${WATCH_BASE}${slug}-episode-${next}`;
  }

  function isNewEpisodeStart(anime, animeInfo, highestWatched, maxGap = 3) {
    const latestEp = Number((animeInfo && animeInfo.latestEpisode) || (anime && anime.latestEpisode)) || 0;
    const totalEp = Number((animeInfo && animeInfo.totalEpisodes) || (anime && anime.totalEpisodes)) || 0;
    const status = String((animeInfo && animeInfo.status) || (anime && anime.status) || "").toUpperCase();
    const partiallyUploaded = status === "RELEASING" && totalEp > 0 && latestEp > 0 && latestEp < totalEp;
    if (latestEp <= 0 || (status !== "RELEASING" && !partiallyUploaded)) return false;
    const freshGap = latestEp - Number(highestWatched || 0);
    return freshGap >= 1 && freshGap <= maxGap;
  }

  function formatSubline(episode, currentTime, duration, percentage) {
    const parts = [`Ep ${episode}`];
    const remaining = duration - currentTime;
    if (duration > 0 && Number.isFinite(remaining) && remaining > 0) {
      const mins = Math.round(remaining / 60);
      parts.push(mins <= 1 ? "almost done" : `${mins} min left`);
    } else if (percentage > 0) {
      parts.push(`${percentage}% watched`);
    }
    return parts.join(" · ");
  }

  function getWatchedEpisodeNumbers(anime) {
    return (anime && Array.isArray(anime.episodes) ? anime.episodes : [])
      .filter((ep) => !ep || ep.durationSource !== "anilist")
      .map((ep) => Number(ep && ep.number))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  function buildItems(videoProgress, animeData, animeInfoBySlug) {
    const bySlug = new Map();

    const addItem = (item) => {
      const existing = bySlug.get(item.slug);
      if (!existing) {
        bySlug.set(item.slug, item);
        return;
      }
      if (!item.isStart && existing.isStart) {
        bySlug.set(item.slug, item);
      } else if (item.isStart && !existing.isStart) {
      } else {
        if (item.savedAt > existing.savedAt) {
          bySlug.set(item.slug, item);
        }
      }
    };

    for (const [key, entry] of Object.entries(videoProgress || {})) {
      if (key === "__slugIndex" || !entry || entry.deleted) continue;
      const parsed = parseProgressKey(key);
      if (!parsed) continue;
      const { slug, episode } = parsed;

      const anime = (animeData && animeData[slug]) || null;
      // Dropped/on-hold must never surface here even with saved in-progress progress — the progress loop needs this guard too.
      if (isHardInactive(anime)) continue;
      const animeInfo = (animeInfoBySlug && animeInfoBySlug[slug]) || null;

      const currentTime = Number(entry.currentTime) || 0;
      if (currentTime <= 0) continue;
      const duration = Number(entry.duration) || 0;

      let percentage = Number(entry.percentage);
      if (!Number.isFinite(percentage) || percentage <= 0) {
        percentage = duration > 0 ? Math.floor((currentTime / duration) * 100) : 0;
      }
      percentage = Math.max(0, Math.min(100, percentage));

      const savedAt = entry.savedAt ? new Date(entry.savedAt).getTime() : 0;
      const title = anime && typeof anime.title === "string" && anime.title.trim() ? anime.title.trim() : humanizeSlug(slug);

      const COMPLETED_PERCENTAGE = 85;
      if (percentage >= COMPLETED_PERCENTAGE) {
        const watchedNumbers = getWatchedEpisodeNumbers(anime);
        const maxKnownWatched = watchedNumbers.length ? Math.max(...watchedNumbers) : 0;
        const baseEpisode = Math.max(episode, maxKnownWatched);
        const nextUrl = computeNextEpisodeUrl(anime, slug, baseEpisode, animeInfo);
        if (nextUrl) {
          const nextEpisode = baseEpisode + 1;
          const newEp = isNewEpisodeStart(anime, animeInfo, baseEpisode);
          addItem({
            slug,
            episode: nextEpisode,
            percentage: 0,
            savedAt,
            title,
            cover: safeCover(entry.coverImage) || safeCover(anime && anime.coverImage),
            subline: `Ep ${nextEpisode} · ${newEp ? "New Episode" : "Start"}`,
            url: nextUrl,
            nextUrl: computeNextEpisodeUrl(anime, slug, nextEpisode, animeInfo),
            nextNumber: nextEpisode + 1,
            isStart: true,
            isNewEpisode: newEp,
          });
        }
      } else {
        addItem({
          slug,
          episode,
          percentage,
          savedAt,
          title,
          cover: safeCover(entry.coverImage) || safeCover(anime && anime.coverImage),
          subline: formatSubline(episode, currentTime, duration, percentage),
          url: resumeUrl(slug, episode, entry),
          nextUrl: computeNextEpisodeUrl(anime, slug, episode, animeInfo),
          nextNumber: episode + 1,
          isStart: false,
        });
      }
    }

    for (const [slug, anime] of Object.entries(animeData || {})) {
      if (!anime || !anime.episodes || anime.episodes.length === 0) continue;

      if (isHardInactive(anime)) continue;

      const watchedEpisodeNumbers = getWatchedEpisodeNumbers(anime);
      if (watchedEpisodeNumbers.length === 0) continue;

      const maxCompleted = Math.max(...watchedEpisodeNumbers);
      const animeInfo = (animeInfoBySlug && animeInfoBySlug[slug]) || null;
      const nextUrl = computeNextEpisodeUrl(anime, slug, maxCompleted, animeInfo);
      if (nextUrl) {
        const nextEpisode = maxCompleted + 1;
        const newEp = isNewEpisodeStart(anime, animeInfo, maxCompleted);
        const savedAt = anime.lastWatched ? new Date(anime.lastWatched).getTime() : 0;
        const title = typeof anime.title === "string" && anime.title.trim() ? anime.title.trim() : humanizeSlug(slug);

        addItem({
          slug,
          episode: nextEpisode,
          percentage: 0,
          savedAt,
          title,
          cover: safeCover(anime.coverImage),
          subline: `Ep ${nextEpisode} · ${newEp ? "New Episode" : "Start"}`,
          url: nextUrl,
          nextUrl: computeNextEpisodeUrl(anime, slug, nextEpisode, animeInfo),
          nextNumber: nextEpisode + 1,
          isStart: true,
          isNewEpisode: newEp,
        });
      }
    }

    return [...bySlug.values()].sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_ITEMS);
  }

  window.AnimeTrackerContent = window.AnimeTrackerContent || {};
  window.AnimeTrackerContent.CWUtils = { isContextValid, parseProgressKey, buildItems };
})();
// continue-watching-styles.js — stylesheet for the Continue Watching shelf (iOS
// "Liquid Glass" look: layered inset borders + backdrop-filter, no outer shadows).
(function () {
  "use strict";

  window.AnimeTrackerContent = window.AnimeTrackerContent || {};

  window.AnimeTrackerContent.CWStyles = function (CONTAINER_ID) {
    return `

            /* ============ Liquid Glass container ============ */
            #${CONTAINER_ID} {
                box-sizing: border-box; display: block;
                position: relative;
                width: 100%; max-width: 100%;
                margin: 0;
                padding: 12px 14px;
                background:
                    radial-gradient(ellipse at top right, rgba(79,195,247,0.10) 0%, transparent 55%),
                    radial-gradient(ellipse at bottom left, rgba(155,106,255,0.07) 0%, transparent 55%),
                    linear-gradient(180deg, rgba(17,21,31,0.72) 0%, rgba(11,13,20,0.78) 100%);
                -webkit-backdrop-filter: blur(28px) saturate(180%);
                backdrop-filter: blur(28px) saturate(180%);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 22px;
                /* Perimeter 3D — pure inset layering, no outer shadows */
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.18),
                    inset 0 -1px 0 rgba(255,255,255,0.05),
                    inset 1px 0 0 rgba(255,255,255,0.06),
                    inset -1px 0 0 rgba(255,255,255,0.06),
                    inset 0 0 0 1px rgba(79,195,247,0.04);
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                color: #e8edf8;
                contain: layout paint;
            }
            #${CONTAINER_ID} *, #${CONTAINER_ID} *::before, #${CONTAINER_ID} *::after { box-sizing: border-box; }

            /* Animated liquid waves — subtle iOS 26 ambient layer */
            #${CONTAINER_ID}::after {
                content: ''; position: absolute; inset: 0;
                border-radius: inherit; pointer-events: none; z-index: 0;
                overflow: hidden;
                background-image:
                    radial-gradient(140% 70% at 0% 110%, rgba(79,195,247,0.10) 0%, transparent 60%),
                    radial-gradient(140% 70% at 100% -10%, rgba(155,106,255,0.09) 0%, transparent 60%),
                    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 240' preserveAspectRatio='none'><defs><linearGradient id='a' x1='0' x2='0' y1='0' y2='1'><stop offset='0' stop-color='%234fc3f7' stop-opacity='0.10'/><stop offset='1' stop-color='%234fc3f7' stop-opacity='0'/></linearGradient><linearGradient id='b' x1='0' x2='0' y1='0' y2='1'><stop offset='0' stop-color='%239b6aff' stop-opacity='0.08'/><stop offset='1' stop-color='%239b6aff' stop-opacity='0'/></linearGradient></defs><path fill='url(%23a)' d='M0,180 C200,140 400,220 600,170 C800,120 1000,200 1200,160 L1200,240 L0,240 Z'/><path fill='url(%23b)' d='M0,200 C220,170 420,230 640,190 C860,150 1040,215 1200,185 L1200,240 L0,240 Z'/></svg>");
                background-size: auto, auto, 220% 60%;
                background-position: 0 0, 0 0, 0% 100%;
                background-repeat: no-repeat;
                animation: at-cw-waves 22s ease-in-out infinite alternate;
                opacity: 0.55;
            }
            @keyframes at-cw-waves {
                0%   { background-position: 0 0, 0 0, 0% 100%; }
                100% { background-position: 0 0, 0 0, 40% 100%; }
            }

            /* Specular highlight ring (top arc of light, like iOS 26 glass) */
            #${CONTAINER_ID} > * { position: relative; z-index: 1; }
            #${CONTAINER_ID}::before {
                content: ''; position: absolute; inset: 0;
                border-radius: inherit; pointer-events: none; z-index: 1;
                background:
                    linear-gradient(180deg,
                        rgba(255,255,255,0.10) 0%,
                        rgba(255,255,255,0.02) 18%,
                        transparent 38%,
                        transparent 62%,
                        rgba(255,255,255,0.03) 100%);
                mix-blend-mode: screen;
            }

            /* ============ Header ============ */
            .at-cw-head {
                display: flex; align-items: center; gap: 10px;
                margin-bottom: 12px;
                position: relative;
            }
            .at-cw-head-title {
                display: inline-flex; align-items: center; gap: 8px;
                font-size: 13px; font-weight: 700; letter-spacing: .3px;
                color: #f3f6ff; text-transform: uppercase;
            }
            .at-cw-head-icon {
                width: 13px; height: 13px; flex-shrink: 0; fill: #4fc3f7;
            }
            .at-cw-count {
                font-size: 10px; font-weight: 700; color: #4fc3f7;
                background: rgba(79,195,247,0.14);
                border: 1px solid rgba(79,195,247,0.28);
                border-radius: 999px; padding: 1px 7px; line-height: 1.6;
                letter-spacing: .3px;
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.18),
                    inset 0 -1px 0 rgba(0,0,0,0.18);
            }
            .at-cw-head-spacer { flex: 1 1 auto; }
            .at-cw-nav {
                display: inline-flex; gap: 6px; align-items: center;
            }

            /* ============ Glass pill buttons (nav + close) ============ */
            .at-cw-nav-btn, .at-cw-close {
                width: 28px; height: 28px;
                display: inline-flex; align-items: center; justify-content: center;
                background:
                    linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 100%) !important;
                border: 1px solid rgba(255,255,255,0.12) !important;
                border-radius: 10px !important;
                color: #cdd6e6 !important;
                cursor: pointer; padding: 0 !important;
                -webkit-backdrop-filter: blur(14px) saturate(160%);
                backdrop-filter: blur(14px) saturate(160%);
                /* iOS 26 perimeter — top specular, bottom refraction */
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.22),
                    inset 0 -1px 0 rgba(0,0,0,0.22),
                    inset 1px 0 0 rgba(255,255,255,0.06),
                    inset -1px 0 0 rgba(255,255,255,0.06);
                transition: background .18s ease, color .18s ease, border-color .18s ease, transform .18s ease;
            }
            .at-cw-nav-btn:hover:not(:disabled) {
                background:
                    linear-gradient(180deg, rgba(79,195,247,0.22) 0%, rgba(79,195,247,0.08) 100%) !important;
                border-color: rgba(79,195,247,0.50) !important;
                color: #fff !important;
            }
            .at-cw-nav-btn:disabled { opacity: .35; cursor: default; }
            .at-cw-nav-btn svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }

            /* ============ Redesigned close button ============ */
            .at-cw-close {
                width: 30px !important; height: 30px !important;
                border-radius: 50% !important;
                color: #c8d2e4 !important;
                position: relative;
                background:
                    radial-gradient(circle at 30% 25%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 55%, rgba(255,255,255,0.02) 100%) !important;
                border: 1px solid rgba(255,255,255,0.14) !important;
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.30),
                    inset 0 -1px 0 rgba(0,0,0,0.28),
                    inset 1px 0 0 rgba(255,255,255,0.08),
                    inset -1px 0 0 rgba(255,255,255,0.08) !important;
            }
            .at-cw-close-glyph {
                display: inline-flex; align-items: center; justify-content: center;
                width: 100%; height: 100%;
                transition: transform .25s cubic-bezier(.4,1.4,.5,1);
            }
            .at-cw-close-glyph svg { width: 12px; height: 12px; display: block; }
            .at-cw-close:hover {
                background:
                    radial-gradient(circle at 30% 25%, rgba(255,120,120,0.32) 0%, rgba(255,80,80,0.10) 55%, rgba(255,60,60,0.04) 100%) !important;
                border-color: rgba(255,120,120,0.50) !important;
                color: #fff !important;
            }
            .at-cw-close:hover .at-cw-close-glyph { transform: rotate(90deg); }
            .at-cw-close:active .at-cw-close-glyph { transform: rotate(90deg) scale(.9); }

            /* ============ Viewport + scroll track ============ */
            .at-cw-viewport { position: relative; }
            .at-cw-viewport.has-overflow::before,
            .at-cw-viewport.has-overflow::after {
                content: ''; position: absolute; top: 0; bottom: 8px; width: 28px;
                pointer-events: none; z-index: 2;
                transition: opacity .2s ease;
            }
            .at-cw-viewport.has-overflow::before {
                left: 0;
                background: linear-gradient(90deg, rgba(16,20,32,0.92), rgba(16,20,32,0));
                opacity: var(--at-cw-fade-left, 0);
            }
            .at-cw-viewport.has-overflow::after {
                right: 0;
                background: linear-gradient(270deg, rgba(16,20,32,0.92), rgba(16,20,32,0));
                opacity: var(--at-cw-fade-right, 1);
            }

            .at-cw-track {
                display: flex; gap: 10px;
                overflow-x: auto; overflow-y: hidden;
                padding: 4px 2px 8px;
                scroll-snap-type: x mandatory;
                scroll-padding-left: 2px;
                scroll-behavior: smooth;
                scrollbar-width: thin; scrollbar-color: rgba(79,195,247,0.4) transparent;
            }
            .at-cw-track::-webkit-scrollbar { height: 6px; }
            .at-cw-track::-webkit-scrollbar-track { background: transparent; }
            .at-cw-track::-webkit-scrollbar-thumb { background: rgba(79,195,247,0.30); border-radius: 999px; }
            .at-cw-track::-webkit-scrollbar-thumb:hover { background: rgba(79,195,247,0.55); }

            /* ============ Liquid Glass cards ============ */
            .at-cw-card {
                position: relative;
                flex: 0 0 auto; width: 126px;
                display: flex; flex-direction: column;
                background:
                    linear-gradient(180deg, rgba(40,46,66,0.72) 0%, rgba(20,24,40,0.78) 100%);
                -webkit-backdrop-filter: blur(18px) saturate(170%);
                backdrop-filter: blur(18px) saturate(170%);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 16px;
                /* Perimeter 3D — full 4-edge inset lighting, no drop shadow */
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.16),
                    inset 0 -1px 0 rgba(0,0,0,0.28),
                    inset 1px 0 0 rgba(255,255,255,0.05),
                    inset -1px 0 0 rgba(255,255,255,0.05);
                scroll-snap-align: start;
                transition: transform .25s ease, border-color .25s ease;
                isolation: isolate;
                overflow: hidden;
            }
            .at-cw-card:hover {
                transform: translateY(-2px);
                border-color: rgba(79,195,247,0.45);
            }
            .at-cw-card:hover .at-cw-thumb { border-color: rgba(79,195,247,0.4); }
            .at-cw-play { display: none !important; }

            .at-cw-resume {
                text-decoration: none !important; color: inherit !important;
                display: block;
            }
            .at-cw-resume:focus-visible {
                outline: 2px solid #4fc3f7; outline-offset: 2px;
            }

            .at-cw-thumb {
                position: relative; width: 100%; aspect-ratio: 2 / 3;
                overflow: hidden;
                background: linear-gradient(150deg, #2a2f45 0%, #161a28 100%);
                border-bottom: 1px solid rgba(255,255,255,0.06);
                transition: border-color .18s ease;
            }
            .at-cw-img {
                position: absolute; inset: 0;
                width: 100% !important; height: 100% !important; max-width: none !important;
                object-fit: cover; display: block;
            }
            .at-cw-initial {
                position: absolute; inset: 0; display: flex;
                align-items: center; justify-content: center;
                font-size: 32px; font-weight: 800; color: rgba(255,255,255,0.16);
            }
            .at-cw-play {
                position: absolute; top: 50%; left: 50%;
                width: 34px; height: 34px;
                transform: translate(-50%,-50%) scale(0.75);
                display: flex; align-items: center; justify-content: center;
                background:
                    linear-gradient(180deg, rgba(79,195,247,0.95) 0%, rgba(41,182,246,0.95) 100%);
                border-radius: 50%;
                opacity: 0;
                transition: opacity .18s ease, transform .18s ease;
                /* Liquid glass perimeter on the play orb — no glow */
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.55),
                    inset 0 -1px 0 rgba(0,0,0,0.25);
            }
            .at-cw-play svg { width: 12px; height: 12px; fill: #0c1018; margin-left: 1px; }

            .at-cw-bar {
                position: absolute; left: 0; right: 0; bottom: 0; height: 3px;
                background: rgba(0,0,0,0.55);
            }
            .at-cw-bar-fill {
                height: 100%;
                background: linear-gradient(90deg, #4fc3f7 0%, #81d4fa 100%);
            }

            .at-cw-new-badge {
                position: absolute; top: 6px; right: 6px; z-index: 2;
                padding: 2px 6px; border-radius: 6px;
                font-size: 8px; font-weight: 800; letter-spacing: 0.6px;
                text-transform: uppercase; color: #06121c;
                background:
                    linear-gradient(135deg, #4fc3f7 0%, #29b6f6 100%);
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.45),
                    inset 0 -1px 0 rgba(0,0,0,0.22);
            }
            .at-cw-card-new .at-cw-sub { color: #7fd4ff; font-weight: 700; }

            /* ============ Meta + actions ============ */
            .at-cw-meta { padding: 6px 8px 4px; }
            .at-cw-title {
                font-size: 11.5px; font-weight: 700; line-height: 1.25; color: #e8edf8;
                display: block;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .at-cw-sub {
                margin-top: 2px; font-size: 10px; font-weight: 500; color: #8899b0;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }

            .at-cw-actions {
                display: grid;
                grid-template-columns: 1fr;
                gap: 4px;
                padding: 0 8px 8px;
            }
            .at-cw-card-start .at-cw-meta {
                padding-bottom: 2px;
            }
            .at-cw-card-start .at-cw-actions {
                padding-top: 0;
            }
            .at-cw-card-start .at-cw-btn-resume {
                min-height: 28px;
            }
            .at-cw-btn {
                display: flex; align-items: center; justify-content: center; gap: 4px;
                padding: 5px 6px;
                min-width: 0;
                border-radius: 9px;
                font-size: 10px; font-weight: 700; letter-spacing: .3px;
                text-decoration: none !important;
                transition: background .18s ease, color .18s ease, border-color .18s ease, transform .18s ease;
            }
            .at-cw-btn span {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .at-cw-btn-resume {
                background:
                    linear-gradient(180deg, #5fcbf8 0%, #29b6f6 100%);
                border: 1px solid rgba(79,195,247,0.55);
                color: #0c1018 !important;
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.45),
                    inset 0 -1px 0 rgba(0,0,0,0.22);
            }
            .at-cw-btn-resume:hover {
                background:
                    linear-gradient(180deg, #81d4fa 0%, #4fc3f7 100%);
                transform: translateY(-1px);
            }
            .at-cw-btn:focus-visible {
                outline: 2px solid #4fc3f7; outline-offset: 2px;
            }
            /* ============ Motion + responsive ============ */
            @media (prefers-reduced-motion: reduce) {
                .at-cw-card, .at-cw-play, .at-cw-thumb, .at-cw-btn, .at-cw-track {
                    transition: none !important;
                    scroll-behavior: auto !important;
                }
                .at-cw-card:hover, .at-cw-btn:hover { transform: none !important; }
            }
            @media (max-width: 1199px) {
                .at-cw-card { width: 112px; }
            }
            @media (max-width: 767px) {
                #${CONTAINER_ID} {
                    width: calc(100% - 24px);
                    margin-inline: 12px;
                    padding: 9px;
                    border-radius: 18px;
                }
                .at-cw-head-title {
                    font-size: 10px;
                    letter-spacing: .15px;
                    gap: 6px;
                    min-width: 0;
                }
                .at-cw-head-title > span:not(.at-cw-count) {
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    min-width: 0;
                }
                .at-cw-card { width: 120px; border-radius: 14px; }
                .at-cw-thumb { aspect-ratio: 16 / 9; }
                .at-cw-img { object-position: center 22%; }
                .at-cw-initial { font-size: 22px; }
                .at-cw-nav { display: none; }
                .at-cw-title {
                    font-size: 11px;
                    -webkit-line-clamp: 1;
                }
                .at-cw-sub { font-size: 9.5px; }
                .at-cw-meta { padding: 5px 7px 2px; }
                .at-cw-actions { padding: 0 7px 6px; }
                .at-cw-btn { padding: 4px 6px; font-size: 9.5px; }
            }
        `;
  };
})();
// continue-watching.js — builds the "Continue Watching" shelf on the homepage.
(function () {
  "use strict";

  if (window.self !== window.top) return;
  if (window.__atContinueWatchingMounted) return;
  window.__atContinueWatchingMounted = true;

  const CONTAINER_ID = "at-continue-watching";
  const STYLE_ID = "at-continue-watching-styles";
  const RENDER_DEBOUNCE_MS = 300;

  const SHARE_SELECTORS = ["#mainShare", ".mainShare", '[data-share="main"]'];

  let dismissed = false;
  let renderDebounce = null;

  let mountedViaShare = false;
  let shareWatcher = null;
  let shareWatcherScheduled = false;

  const { isContextValid, parseProgressKey, buildItems } = window.AnimeTrackerContent.CWUtils;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = window.AnimeTrackerContent.CWStyles(CONTAINER_ID);
    (document.head || document.documentElement).appendChild(style);
  }

  function buildCard(item) {
    const card = document.createElement("div");
    card.className = "at-cw-card";
    card.classList.add(item.isStart ? "at-cw-card-start" : "at-cw-card-resume");

    const resume = document.createElement("a");
    resume.className = "at-cw-resume";
    resume.href = item.url;
    resume.title = item.isStart ? `Start — ${item.title} · Ep ${item.episode}` : `Resume — ${item.title} · ${item.subline}`;

    const thumb = document.createElement("div");
    thumb.className = "at-cw-thumb";

    const initial = document.createElement("span");
    initial.className = "at-cw-initial";
    initial.textContent = (item.title[0] || "?").toUpperCase();
    thumb.appendChild(initial);

    if (item.cover) {
      const img = document.createElement("img");
      img.className = "at-cw-img";
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = "";

      img.addEventListener("error", () => img.remove(), { once: true });
      img.src = item.cover;
      thumb.appendChild(img);
    }

    const play = document.createElement("div");
    play.className = "at-cw-play";
    play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="8 5 19 12 8 19"/></svg>';
    thumb.appendChild(play);

    const bar = document.createElement("div");
    bar.className = "at-cw-bar";
    const fill = document.createElement("div");
    fill.className = "at-cw-bar-fill";
    fill.style.width = `${item.percentage}%`;
    bar.appendChild(fill);
    thumb.appendChild(bar);

    if (item.isNewEpisode) {
      card.classList.add("at-cw-card-new");
      const newBadge = document.createElement("span");
      newBadge.className = "at-cw-new-badge";
      newBadge.textContent = "NEW";
      thumb.appendChild(newBadge);
    }

    const meta = document.createElement("div");
    meta.className = "at-cw-meta";
    const titleEl = document.createElement("div");
    titleEl.className = "at-cw-title";
    titleEl.textContent = item.title;
    const subEl = document.createElement("div");
    subEl.className = "at-cw-sub";
    subEl.textContent = item.subline;
    meta.append(titleEl, subEl);

    resume.append(thumb, meta);
    card.appendChild(resume);

    const actions = document.createElement("div");
    actions.className = "at-cw-actions";

    const resumeBtn = document.createElement("a");
    resumeBtn.className = "at-cw-btn at-cw-btn-resume";
    resumeBtn.href = item.url;
    resumeBtn.title = item.isStart ? `Start episode ${item.episode}` : `Resume episode ${item.episode}`;
    resumeBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true" fill="currentColor"><polygon points="8 5 19 12 8 19"/></svg>' +
      `<span>${item.isStart ? "Start" : "Resume"}</span>`;
    actions.appendChild(resumeBtn);

    card.appendChild(actions);

    return card;
  }

  function buildSection(items) {
    const section = document.createElement("section");
    section.id = CONTAINER_ID;
    section.setAttribute("aria-label", "Continue Watching");

    const head = document.createElement("div");
    head.className = "at-cw-head";

    const heading = document.createElement("div");
    heading.className = "at-cw-head-title";
    heading.innerHTML =
      '<svg class="at-cw-head-icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="8 5 19 12 8 19"/></svg>' +
      "<span>Continue Watching from an1me-extention</span>";
    const count = document.createElement("span");
    count.className = "at-cw-count";
    count.textContent = String(items.length);
    heading.appendChild(count);

    const spacer = document.createElement("div");
    spacer.className = "at-cw-head-spacer";

    const nav = document.createElement("div");
    nav.className = "at-cw-nav";
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "at-cw-nav-btn";
    prevBtn.setAttribute("aria-label", "Scroll left");
    prevBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 6 9 12 15 18"/></svg>';
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "at-cw-nav-btn";
    nextBtn.setAttribute("aria-label", "Scroll right");
    nextBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';
    nav.append(prevBtn, nextBtn);

    const close = document.createElement("button");
    close.className = "at-cw-close";
    close.type = "button";
    close.setAttribute("aria-label", "Hide Continue Watching");
    close.innerHTML =
      '<span class="at-cw-close-glyph" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">' +
      '<line x1="7" y1="7" x2="17" y2="17"/>' +
      '<line x1="17" y1="7" x2="7" y2="17"/>' +
      "</svg>" +
      "</span>";
    close.addEventListener("click", () => {
      dismissed = true;
      section.remove();
      stopShareWatcher();
    });

    head.append(heading, spacer, nav, close);

    const viewport = document.createElement("div");
    viewport.className = "at-cw-viewport";

    const track = document.createElement("div");
    track.className = "at-cw-track";
    for (const item of items) track.appendChild(buildCard(item));

    track.addEventListener(
      "wheel",
      (e) => {
        if (!e.deltaY || track.scrollWidth <= track.clientWidth) return;
        const atStart = track.scrollLeft <= 0;
        const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
        if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) return;
        track.scrollLeft += e.deltaY;
        e.preventDefault();
      },
      { passive: false },
    );

    const updateNavState = () => {
      const overflowing = track.scrollWidth > track.clientWidth + 1;
      viewport.classList.toggle("has-overflow", overflowing);
      if (!overflowing) {
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        nav.style.display = "none";
        viewport.style.setProperty("--at-cw-fade-left", "0");
        viewport.style.setProperty("--at-cw-fade-right", "0");
        return;
      }
      nav.style.display = "";
      const atStart = track.scrollLeft <= 1;
      const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
      prevBtn.disabled = atStart;
      nextBtn.disabled = atEnd;
      viewport.style.setProperty("--at-cw-fade-left", atStart ? "0" : "1");
      viewport.style.setProperty("--at-cw-fade-right", atEnd ? "0" : "1");
    };

    const scrollByCards = (dir) => {
      const firstCard = track.querySelector(".at-cw-card");
      const cardWidth = firstCard ? firstCard.getBoundingClientRect().width + 10 : 140;
      const step = Math.max(cardWidth * 2, track.clientWidth * 0.8);
      track.scrollBy({ left: dir * step, behavior: "smooth" });
    };
    prevBtn.addEventListener("click", () => scrollByCards(-1));
    nextBtn.addEventListener("click", () => scrollByCards(1));
    track.addEventListener("scroll", updateNavState, { passive: true });

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(updateNavState);
      ro.observe(track);
    }

    setTimeout(updateNavState, 0);

    viewport.appendChild(track);
    section.append(head, viewport);
    return section;
  }

  function findShareAnchor() {
    for (const sel of SHARE_SELECTORS) {
      const node = document.querySelector(sel);
      if (node && node.parentNode) return node;
    }
    return null;
  }

  function findContentContainer() {
    const selectors = ["main", "#main", '[role="main"]', "#content", ".site-main", ".main-content"];
    for (const sel of selectors) {
      const node = document.querySelector(sel);
      if (node) return node;
    }
    return null;
  }

  function findHeroAnchor(container) {
    const heroSelectors = [
      ".hero",
      "#hero",
      ".banner",
      "#banner",
      ".swiper",
      ".swiper-container",
      ".slider",
      ".slick-slider",
      ".featured",
      ".featured-anime",
      ".home-slider",
      ".main-slider",
      ".spotlight",
      ".spotlight-slider",
    ];
    for (const sel of heroSelectors) {
      const node = container.querySelector(sel);
      if (node && container.contains(node)) return node;
    }
    return null;
  }

  function mountSection(section) {
    const shareNode = findShareAnchor();
    if (shareNode) {
      const parent = shareNode.parentNode;
      const next = shareNode.nextSibling;
      shareNode.remove();
      parent.insertBefore(section, next);
      mountedViaShare = true;
      return true;
    }

    mountedViaShare = false;
    const container = findContentContainer();
    if (container) {
      const hero = findHeroAnchor(container);
      if (hero && hero.parentNode) {
        hero.parentNode.insertBefore(section, hero.nextSibling);
        return true;
      }

      let isRowish = false;
      try {
        const cs = getComputedStyle(container);
        isRowish =
          cs.display === "flex" || cs.display === "inline-flex"
            ? !/column/.test(cs.flexDirection || "")
            : cs.display === "grid" || cs.display === "inline-grid";
      } catch {}

      if (isRowish && container.parentNode) {
        container.parentNode.insertBefore(section, container);
      } else {
        container.insertBefore(section, container.firstChild);
      }
      return true;
    }
    if (document.body) {
      document.body.insertBefore(section, document.body.firstChild);
      return true;
    }
    return false;
  }

  function suppressShareIfPresent() {
    const shareNode = findShareAnchor();
    if (shareNode) shareNode.remove();
  }

  function startShareWatcher() {
    if (shareWatcher) return;
    if (typeof MutationObserver === "undefined") return;
    const root = document.body || document.documentElement;
    if (!root) return;

    shareWatcher = new MutationObserver(() => {
      if (shareWatcherScheduled) return;
      shareWatcherScheduled = true;
      queueMicrotask(() => {
        shareWatcherScheduled = false;
        if (dismissed) return;
        const ourSection = document.getElementById(CONTAINER_ID);
        if (!ourSection) return;
        const shareNode = findShareAnchor();
        if (!shareNode) return;

        if (mountedViaShare) {
          shareNode.remove();
          return;
        }

        const parent = shareNode.parentNode;
        const next = shareNode.nextSibling;
        shareNode.remove();
        if (parent) parent.insertBefore(ourSection, next);
        mountedViaShare = true;
      });
    });
    shareWatcher.observe(root, { childList: true, subtree: true });
  }

  function stopShareWatcher() {
    if (shareWatcher) {
      shareWatcher.disconnect();
      shareWatcher = null;
    }
    shareWatcherScheduled = false;
  }

  function render(items) {
    const existing = document.getElementById(CONTAINER_ID);

    if (dismissed || !items.length) {
      if (existing) existing.remove();
      return;
    }

    injectStyles();
    const section = buildSection(items);

    if (existing) {
      existing.replaceWith(section);

      suppressShareIfPresent();
    } else {
      mountSection(section);
    }

    startShareWatcher();
  }

  function collectAnimeInfoKeys(videoProgress, animeData) {
    const slugs = new Set(Object.keys(animeData || {}));
    for (const key of Object.keys(videoProgress || {})) {
      const parsed = parseProgressKey(key);
      if (parsed && parsed.slug) slugs.add(parsed.slug);
    }
    return [...slugs].map((slug) => `animeinfo_${slug}`);
  }

  function pickAnimeInfoBySlug(storageResult) {
    const out = {};
    for (const [key, value] of Object.entries(storageResult || {})) {
      // Usable, not authoritative: a scrape that timed out keeps its prior data but is flagged
      // retryable, and dropping those here blanks out the next-episode link until the retry lands.
      if (!key.startsWith("animeinfo_") || !globalThis.AnimeTrackerCachePolicy?.isInfoUsableSnapshot?.(value)) continue;
      out[key.slice("animeinfo_".length)] = value;
    }
    return out;
  }

  function loadAndRender() {
    if (dismissed || !isContextValid()) return;
    chrome.storage.local.get(["videoProgress", "animeData"], (result) => {
      if (chrome.runtime.lastError) return;
      const videoProgress = result.videoProgress || {};
      const animeData = result.animeData || {};
      const infoKeys = collectAnimeInfoKeys(videoProgress, animeData);
      const finish = (infoResult) => {
        try {
          render(buildItems(videoProgress, animeData, pickAnimeInfoBySlug(infoResult)));
        } catch {}
      };

      if (!infoKeys.length) {
        finish({});
        return;
      }

      chrome.storage.local.get(infoKeys, (infoResult) => {
        if (chrome.runtime.lastError) {
          finish({});
          return;
        }
        finish(infoResult || {});
      });
    });
  }

  function scheduleRender() {
    if (renderDebounce) clearTimeout(renderDebounce);
    renderDebounce = setTimeout(() => {
      renderDebounce = null;
      loadAndRender();
    }, RENDER_DEBOUNCE_MS);
  }

  try {
    chrome.runtime.sendMessage({ type: "WAKE_AND_POLL_CLOUD" }, () => {
      void chrome.runtime.lastError;
    });
  } catch {}

  try {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== "local") return;
      const changedKeys = Object.keys(changes || {});
      if (changes.videoProgress || changes.animeData || changedKeys.some((key) => key.startsWith("animeinfo_"))) {
        scheduleRender();
      }
    });
  } catch {}

  loadAndRender();
})();
