# Popup Modules

This folder contains the modular JavaScript code for the Anime Tracker popup interface.

## Module Structure

| File | Description | Dependencies |
|------|-------------|--------------|
| `config.js` | Configuration constants, donate links, slug mappings | None |
| `storage.js` | Chrome storage wrapper with sync→local migration | None |
| `ui-helpers.js` | Formatting utilities, icons, HTML escaping, logger | None |
| `filler-service.js` | Filler episode detection and AnimeFillerList.com API | config, storage, ui-helpers |
| `progress-manager.js` | Progress tracking, cleanup, data merging | config, ui-helpers |
| `firebase-sync.js` | Firebase authentication and cloud sync | config, storage, progress-manager, filler-service |
| `anime-card.js` | Anime card HTML rendering | config, ui-helpers, filler-service |
| `main.js` | Main entry point, event handlers, orchestration | All modules |

## Load Order

Scripts must be loaded in this order (as specified in popup.html):

1. `config.js`
2. `storage.js`
3. `ui-helpers.js`
4. `filler-service.js`
5. `progress-manager.js`
6. `firebase-sync.js`
7. `anime-card.js`
8. `main.js`

## Global Namespace

All modules export to `window.AnimeTracker`:

```javascript
window.AnimeTracker = {
    CONFIG,
    DONATE_LINKS,
    ANIME_FILLER_LIST_SLUG_MAPPING,
    Storage,
    UIHelpers,
    Logger,
    FillerService,
    ProgressManager,
    FirebaseSync,
    AnimeCardRenderer
};
```

## Module Responsibilities

### config.js
- Timing constants (debounce, cache TTL, retry delays)
- UI limits (visible episodes, fillers)
- Progress thresholds (completed %, watch time)
- External links (donate URLs)
- Slug mappings for AnimeFillerList

### storage.js
- Abstracts chrome.storage.local
- Handles sync→local migration
- Promise-based API

### ui-helpers.js
- `formatDuration()` - Convert seconds to "Xh Ym"
- `formatDate()` - Relative date formatting
- `escapeHtml()` - XSS protection
- `createIcon()` - SVG icon generation
- `getUniqueId()` - Episode unique ID generation
- `Logger` - Console logging with prefixes

### filler-service.js
- Fetch filler data from AnimeFillerList.com
- Cache management with TTL
- Filler episode detection
- Canon/filler progress calculations
- Auto-fetch missing data with rate limiting

### progress-manager.js
- Clean orphaned progress entries
- Remove duplicate episodes
- Merge local and cloud data
- Track in-progress-only anime

### firebase-sync.js
- Google sign-in flow
- Cloud sync with debouncing
- Retry logic with exponential backoff
- Merge conflict resolution

### anime-card.js
- Generate anime card HTML
- Progress bars (canon + filler)
- Episode tags with filler highlighting
- In-progress episode display
- Expandable sections

### main.js
- DOM element references
- Event listener setup
- UI state management
- Storage change monitoring
- Debug functions
