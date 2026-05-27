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
    LOG_LEVEL: 'INFO',
    MAX_PROGRESS_ENTRIES: 20,
    MAX_PROGRESS_AGE_DAYS: 7,
    MAX_SAVE_QUEUE_SIZE: 10,
    MAX_SAVED_PROGRESS_ENTRIES: 10
};




const _multipart = (typeof window !== 'undefined' && window.AnimeTrackerMultipartMappings) || {};
const EPISODE_OFFSET_MAPPING = _multipart.EPISODE_OFFSET_MAPPING || {};
const SLUG_NORMALIZATION = _multipart.SLUG_NORMALIZATION || {};

window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.CONFIG = ContentConfig;
window.AnimeTrackerContent.EPISODE_OFFSET_MAPPING = EPISODE_OFFSET_MAPPING;
window.AnimeTrackerContent.SLUG_NORMALIZATION = SLUG_NORMALIZATION;
