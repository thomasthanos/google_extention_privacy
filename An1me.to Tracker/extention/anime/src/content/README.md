# Content Script Modules

This folder contains the modular JavaScript code for the Anime Tracker content script that runs on an1me.to watch pages.

## Module Structure

| File | Description | Dependencies |
|------|-------------|--------------|
| `config.js` | Configuration constants | None |
| `logger.js` | Styled console logging | config |
| `storage.js` | Chrome storage wrapper | logger |
| `anime-parser.js` | URL/DOM parsing for anime info | logger |
| `notifications.js` | Resume prompt & completion UI | None |
| `progress-tracker.js` | Video progress saving/loading | config, storage, logger, notifications |
| `video-monitor.js` | Video element detection & monitoring | config, logger, progress-tracker, notifications |
| `main.js` | Entry point, event handlers, initialization | All modules |

## Load Order

Scripts are loaded in this order (defined in manifest.json):

1. `config.js` - Configuration constants
2. `logger.js` - Styled console logging
3. `storage.js` - Chrome storage wrapper
4. `anime-parser.js` - Anime info extraction
5. `notifications.js` - UI notifications
6. `progress-tracker.js` - Progress management
7. `video-monitor.js` - Video element handling
8. `main.js` - Entry point

## Global Namespace

All modules export to `window.AnimeTrackerContent`:

```javascript
window.AnimeTrackerContent = {
    CONFIG,
    Logger,
    Storage,
    AnimeParser,
    Notifications,
    ProgressTracker,
    VideoMonitor
};
```

## Module Responsibilities

### config.js
- Watch threshold (85%)
- Remaining time threshold (4 min)
- Debounce delays
- Progress save intervals
- Storage limits

### logger.js
- Styled console output with icons
- Log levels (DEBUG, INFO, SUCCESS, WARN, ERROR)
- Progress logging format
- Timestamp formatting

### storage.js
- Chrome local storage wrapper
- Sync to local migration
- Context validation
- Quota checking

### anime-parser.js
- URL pattern matching
- Episode number extraction
- Anime title extraction from DOM
- HTML escaping for XSS prevention

### notifications.js
- Resume prompt dialog
- Episode completion notification
- Google Fonts loading
- CSS injection for styling

### progress-tracker.js
- Video progress saving with debounce
- Progress cleanup (old/completed entries)
- Episode tracking (save to animeData)
- Duplicate episode detection
- Save queue management

### video-monitor.js
- Video element detection (main page + iframes)
- Video activity checking
- Event listener management
- Cleanup on navigation

### main.js
- Event handler definitions (timeupdate, pause, seeked, ended)
- Visibility change handling
- Before unload tracking
- SPA navigation detection
- Initialization orchestration
