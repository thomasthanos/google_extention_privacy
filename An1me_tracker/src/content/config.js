const ContentConfig = {
    REMAINING_TIME_THRESHOLD: 120,
    DEBOUNCE_DELAY: 300,
    VIDEO_CHECK_INTERVAL: 1500,
    MAX_RETRIES: 60,
    PROGRESS_SAVE_INTERVAL: 20000,
    PROGRESS_WRITE_THROTTLE_MS: 20000,
    PAUSE_WRITE_THROTTLE_MS: 5000,
    FORCED_PROGRESS_WRITE_THROTTLE_MS: 3000,
    MIN_PROGRESS_TO_SAVE: 5,
    NEW_ANIME_GRACE_SECONDS: 120,
    MIN_WATCH_SECONDS_BEFORE_COMPLETE: 120,
    COMPLETED_PERCENTAGE: 85,
    LOG_LEVEL: 'INFO',
    MAX_PROGRESS_ENTRIES: 20,
    MAX_PROGRESS_AGE_DAYS: 7,
    MAX_SAVE_QUEUE_SIZE: 10,
    MAX_SAVED_PROGRESS_ENTRIES: 10
};

const EPISODE_OFFSET_MAPPING = {
    'bleach-sennen-kessen-hen-ketsubetsu-tan': 13,
    'bleach-sennen-kessen-hen-soukoku-tan': 26,
    'fate-zero-season-2': 13,
    'fate-zero-2nd-season': 13,
};

const SLUG_NORMALIZATION = {
    'bleach-sennen-kessen-hen-ketsubetsu-tan': 'bleach-sennen-kessen-hen',
    'bleach-sennen-kessen-hen-soukoku-tan': 'bleach-sennen-kessen-hen',
    'fate-zero-season-2': 'fate-zero',
    'fate-zero-2nd-season': 'fate-zero',
};

window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.CONFIG = ContentConfig;
window.AnimeTrackerContent.EPISODE_OFFSET_MAPPING = EPISODE_OFFSET_MAPPING;
window.AnimeTrackerContent.SLUG_NORMALIZATION = SLUG_NORMALIZATION;
