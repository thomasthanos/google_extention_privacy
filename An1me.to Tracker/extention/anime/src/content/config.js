/**
 * Anime Tracker - Content Script Configuration
 */

const ContentConfig = {
    REMAINING_TIME_THRESHOLD: 120,   // 120 seconds (2 min) - typical anime outro (90s ending + 30s preview)
    DEBOUNCE_DELAY: 300,             // Faster debounce for quicker detection
    VIDEO_CHECK_INTERVAL: 1500,      // Check more frequently
    MAX_RETRIES: 60,
    PROGRESS_SAVE_INTERVAL: 2000,
    MIN_PROGRESS_TO_SAVE: 5,
    COMPLETED_PERCENTAGE: 85,
    LOG_LEVEL: 'INFO', // DEBUG, INFO, WARN, ERROR
    MAX_PROGRESS_ENTRIES: 20,
    MAX_PROGRESS_AGE_DAYS: 7,
    MAX_SAVE_QUEUE_SIZE: 10,
    MAX_SAVED_PROGRESS_ENTRIES: 10
};

// Episode offset mapping for multi-part anime
const EPISODE_OFFSET_MAPPING = {
    // Bleach TYBW - Part 2 starts at episode 14 (after 13 episodes of Part 1)
    'bleach-sennen-kessen-hen-ketsubetsu-tan': 13,

    // Bleach TYBW - Part 3 starts at episode 27 (after 13 + 13 episodes)
    'bleach-sennen-kessen-hen-soukoku-tan': 26,

    // Add more multi-part anime here as needed
};

// Slug normalization - merge different parts into one anime entry
const SLUG_NORMALIZATION = {
    // Bleach TYBW - all parts save to the same base slug
    'bleach-sennen-kessen-hen-ketsubetsu-tan': 'bleach-sennen-kessen-hen',
    'bleach-sennen-kessen-hen-soukoku-tan': 'bleach-sennen-kessen-hen',

    // Add more multi-part anime here as needed
};

// Export for use in other modules
window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.CONFIG = ContentConfig;
window.AnimeTrackerContent.EPISODE_OFFSET_MAPPING = EPISODE_OFFSET_MAPPING;
window.AnimeTrackerContent.SLUG_NORMALIZATION = SLUG_NORMALIZATION;
