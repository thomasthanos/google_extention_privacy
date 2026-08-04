// config.js — tracking constants: save cadence, watch threshold, completion %, etc.
const ContentConfig = {
  REMAINING_TIME_THRESHOLD: 120,
  DEBOUNCE_DELAY: 300,
  VIDEO_CHECK_INTERVAL: 1500,
  MAX_RETRIES: 60,
  PROGRESS_SAVE_INTERVAL: 20000,
  PROGRESS_WRITE_THROTTLE_MS: 20000,
  PAUSE_WRITE_THROTTLE_MS: 5000,
  MIN_PROGRESS_TO_SAVE: 5,
  MIN_WATCH_SECONDS_BEFORE_COMPLETE: 120,

  HARD_MIN_WATCH_SECONDS: 30,
  COMPLETED_PERCENTAGE: 85,
  LOG_LEVEL: "INFO",
  MAX_PROGRESS_ENTRIES: 20,
  MAX_PROGRESS_AGE_DAYS: 7,
  MAX_SAVE_QUEUE_SIZE: 10,
  MAX_SAVED_PROGRESS_ENTRIES: 10,

  // Site-coupled DOM selectors (one home so a site markup change is a one-line fix).
  // Episode-list selectors stay per-file on purpose — they differ by detection strategy.
  SELECTORS: {
    VIDEO: "video.art-video",
    VIDEO_FALLBACK: "video",
    PLYR_WRAP: ".plyr__video-wrapper",
    PLAYER_SELECTION: ".player-selection",
    EMBED: "[data-embed-id]",
    ACTIVE_EMBED: "[data-embed-id].active",
  },

  // Named timing values (were scattered magic numbers across the player files).
  DELAYS: {
    INIT: 1000,
    OUTRO_RPC_TIMEOUT: 20000,
    TRACK_TIMEOUT: 10000,
    SERVER_WATCH_POLL: 500,
    SERVER_WATCH_MO_DEBOUNCE: 250,
    SERVER_WATCH_KILL: 30000,
  },
};

const _multipart = (typeof window !== "undefined" && window.AnimeTrackerMultipartMappings) || {};
const EPISODE_OFFSET_MAPPING = _multipart.EPISODE_OFFSET_MAPPING || {};
const SLUG_NORMALIZATION = _multipart.SLUG_NORMALIZATION || {};

window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.CONFIG = ContentConfig;
window.AnimeTrackerContent.EPISODE_OFFSET_MAPPING = EPISODE_OFFSET_MAPPING;
window.AnimeTrackerContent.SLUG_NORMALIZATION = SLUG_NORMALIZATION;
