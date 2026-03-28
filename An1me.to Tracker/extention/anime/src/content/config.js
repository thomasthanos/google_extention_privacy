const ContentConfig = {
    REMAINING_TIME_THRESHOLD: 120,
    DEBOUNCE_DELAY: 300,
    VIDEO_CHECK_INTERVAL: 1500,
    MAX_RETRIES: 60,
    PROGRESS_SAVE_INTERVAL: 2000,
    MIN_PROGRESS_TO_SAVE: 5,
    COMPLETED_PERCENTAGE: 85,
    LOG_LEVEL: 'WARN',
    MAX_PROGRESS_ENTRIES: 20,
    MAX_PROGRESS_AGE_DAYS: 7,
    MAX_SAVE_QUEUE_SIZE: 10,
    MAX_SAVED_PROGRESS_ENTRIES: 10
};

const EPISODE_OFFSET_MAPPING = {
    'bleach-sennen-kessen-hen-ketsubetsu-tan': 13,
    'bleach-sennen-kessen-hen-soukoku-tan': 26,
};

const SLUG_NORMALIZATION = {
    'bleach-sennen-kessen-hen-ketsubetsu-tan': 'bleach-sennen-kessen-hen',
    'bleach-sennen-kessen-hen-soukoku-tan': 'bleach-sennen-kessen-hen',
};

window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.CONFIG = ContentConfig;
window.AnimeTrackerContent.EPISODE_OFFSET_MAPPING = EPISODE_OFFSET_MAPPING;
window.AnimeTrackerContent.SLUG_NORMALIZATION = SLUG_NORMALIZATION;
