# Anime Tracker 🎬

Chrome Extension for tracking anime watching progress on an1me.to

## Features

- **Dynamic Episode Completion**: Marks episode as complete when 85% watched (based on actual video duration) OR less than 120 seconds remaining (handles anime outro skip)
- **Next Episode Detection**: Auto-tracks when you navigate to the next episode
- **Video Progress Saving**: Auto-save playback progress with smart throttling
- **Resume Playback**: Beautiful animated prompt to resume from where you left off
- **Cloud Sync**: Sync data across devices with Google Account
- **Filler Detection**: Shows unwatched filler episodes for Bleach, Naruto, One Piece, etc.
- **Modern Dark UI**: Glassmorphism design with Klee One & Bebas Neue fonts
- **Episode Badge**: Shows current episode number next to anime title
- **3D Progress Bars**: Beautiful gradient progress bars with glow effects
- **Custom Logger**: Styled console logs for debugging

## Installation

### 1. Generate Icons

Open terminal in the project folder and run:

```bash
node generate-icons.js
```

Or open `generate-icons.html` in a browser and download icons manually.

### 2. Load in Chrome

1. Go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `D:\Projects\anime` folder

## Usage

1. Go to [an1me.to](https://an1me.to/)
2. Start watching an episode
3. Your progress is saved automatically
4. If you return to an episode you left midway, a prompt will appear to resume
5. Episode is marked complete when:
   - You watch **85% of the actual video duration** (dynamic threshold), OR
   - Less than 120 seconds (2 min) remaining - handles anime outro/ending skip, OR
   - You navigate to the next episode after reaching 85%
   
   **Examples:**
   - 23:17 episode → Complete @ 19:48 (85%) or 21:17 (skip outro)
   - 30:00 episode → Complete @ 25:30 (85%) or 28:00 (skip outro)
   - 15:00 episode → Complete @ 12:45 (85%) or 13:00 (skip outro)
6. Click the extension icon to see your stats and episode progress

## Custom Logger (Debugging)

The extension includes a custom Logger for beautiful console output:

```javascript
// In browser console:
Logger.info('Message', data);
Logger.success('Completed!');
Logger.warn('Warning message');
Logger.error('Error message', error);
Logger.debug('Debug info', object);

// Domain-specific logging
Logger.episode('tracked', 'Bleach', 15);
Logger.firebase('save', '/users/123', true);
Logger.sync('success', 'Synced 5 anime');
Logger.storage('SET', 'animeData', data);

// Utilities
Logger.table(data);
Logger.time('operation');
Logger.timeEnd('operation');
Logger.setLevel('WARN'); // DEBUG, INFO, WARN, ERROR
```

Output format:
```
[17:12:20.512] [Anime Tracker INFO] Unique ID: bleach__episode-126
```

## File Structure

```
anime/
├── manifest.json           # Extension configuration
├── background.js           # Service worker
├── content.js              # Video tracking logic
├── popup.html              # Popup UI structure
├── popup.css               # Popup styling
├── popup.js                # Popup logic
├── logger.js               # Custom console logger
├── firebase-config.js      # Firebase configuration
├── firebase-lib.js         # Firebase REST API library
├── add-episodes-script.js  # Utility script for manual episode adding
├── greek-utils.js          # Language utilities
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

## Data Storage

Data is stored in `chrome.storage.local` with the following structure:

```javascript
{
  animeData: {
    "anime-slug": {
      title: "Anime Title",
      slug: "anime-slug",
      episodes: [                  // All completed episodes (optimized storage)
        {
          number: 1,             // Episode number (slug/uniqueId computed on-the-fly)
          watchedAt: "2024-01-01T12:00:00Z",  // ISO timestamp without milliseconds
          duration: 1440         // Duration in seconds (~24 min)
        }
      ],
      totalWatchTime: 1440,      // Sum of all episode durations
      lastWatched: "2024-01-01T12:00:00Z"
    }
  },
  videoProgress: {
    "anime-slug__episode-6": {   // Episodes in progress (<80% completion)
      currentTime: 900,          // 15 minutes in seconds
      duration: 1440,            // Total duration
      savedAt: "2024-01-01T12:00:00Z",
      percentage: 62             // Completion percentage
    }
  }
}
```

**Note**: Progress is saved only for incomplete episodes (under 80% and more than 4 min remaining). Only the 20 most recent in-progress episodes are kept for 7 days.

## Troubleshooting

### Video not being tracked
- Make sure you've watched 80% of the video OR have less than 4 minutes remaining
- Refresh the page and try again
- Check if the video is in a cross-origin iframe

### Data not syncing
- Make sure you're signed in with Google account
- Check sync status in the popup footer

## Changelog

### v2.9.0 (Latest) - Dynamic Progress Tracking
- **Dynamic Threshold**: Episode completion now uses 85% of actual video duration (not static 80%)
- **Accurate Tracking**: 23:17 episode → complete @ 19:48 (85%), 30:00 episode → complete @ 25:30 (85%)
- **Outro Skip Handling**: Remaining time threshold set to 120 seconds (2 min) to handle anime outro/ending skip
- **Better UX**: Improved logging shows required percentage and actual duration in MM:SS format
- **Firebase Sync**: Verified working correctly with retry logic and proper data merging
- **Documentation**: Added comprehensive docs (DYNAMIC_PROGRESS_UPDATE.md, QUICK_REFERENCE.md, TESTING_SCENARIOS.md, FINAL_UPDATES.md)
- **Backwards Compatible**: No data migration needed, old episodes remain tracked

### v2.4.0
- **Smart Completion**: Episode marked complete at 80% watched OR <4 min remaining OR next episode navigation
- **UI Overhaul**: Glassmorphism design with blur effects and smooth animations
- **Google Fonts**: Klee One for body text, Bebas Neue for title
- **Episode Badge**: Shows current episode number (Ep X) next to anime title in popup
- **3D Progress Bars**: Gradient backgrounds with inset shadows and glow effects
- **Resume Prompt Redesign**: Compact design with SVG icons, scale 1.5x, fade animations
- **Episode Complete Notification**: Larger notification with icon wrapper and glow effect
- **Filler Improvements**: Show 6 unwatched fillers + expandable "show more" button
- **No Text Selection**: Disabled text selection across popup and notifications
- **Mini Scrollbar**: Custom webkit scrollbar for episode lists
- **Local Dev OAuth**: Separate OAuth client ID for local development
- **Settings Menu**: Changed to vertical dots icon

### v2.3.0
- **Bug Fix**: Fixed storage inconsistency (sync vs local) - all now use local storage
- **Bug Fix**: Fixed memory leak in `lastSavedProgress` (using Map instead of Object)
- **Bug Fix**: Fixed `cleanOrphanedProgress` never being called
- **Bug Fix**: Fixed race condition in `isInternalUpdate` flag
- **Bug Fix**: Fixed filename `greek-utils.js'` typo (extra quote)
- **New Feature**: Custom styled Logger for beautiful console debugging
- **Improvement**: Debounced search input (150ms)
- **Improvement**: Better Firebase token refresh error handling
- **Improvement**: Storage migration from sync to local in background.js
- **Improvement**: Enhanced add-episodes-script with listAnime() and getStats()

### v2.2.1
- **Storage Migration**: Moved from sync to local storage (fixes quota exceeded error)
- **No More Quota Errors**: Local storage has 10MB limit instead of 8KB per item
- **Auto Migration**: Automatic data transfer from sync to local storage
- **Cloud Sync**: Firebase sync remains for cross-browser sync

### v2.1.6
- **Filler Detection**: Recognition of filler episodes for Bleach, Naruto, One Piece, etc.
- **Filler Badge**: Shows how many fillers you've watched (e.g. "🎭 2/164 Filler")
- **Filler Episodes**: Filler episodes shown in purple with strikethrough
- **Collapsible Episodes**: Episode list is now collapsible
- **UI Cleanup**: Better organization of meta info

### v2.1.5
- **UI Improvement**: Collapsible "In Progress" section with click to expand/collapse
- **UI Cleanup**: Removed duplicate badges - shown only in header
- **Bug Fix**: Episodes with >= 85% progress no longer show as "In Progress"
- **Bug Fix**: Automatic cleanup for completed progress entries

### v2.1.4
- **Bug Fix**: Tracked episodes no longer appear as "In Progress"
- **Improvement**: Auto cleanup of progress entries for completed episodes
- **Improvement**: Reduced storage space by removing unnecessary progress data

### v2.1.3
- **Bug Fix**: Preserve local videoProgress during cloud sync
- **Improvement**: Error handling for "Extension context invalidated" errors
- **Improvement**: Graceful handling when extension reloads while video is playing

### v2.1.2
- **New Feature**: Show anime you're watching but haven't completed an episode ("Watching" badge)
- **Bug Fix**: Video progress preserved for anime without completed episodes
- **Bug Fix**: Improved cleanOrphanedProgress logic

### v2.1.1
- **Bug Fix**: Fixed infinite sync loop in storage listener
- **Bug Fix**: Fixed memory leak in content.js
- **Bug Fix**: Proper cleanup of event listeners on video elements
- **Improvement**: Better Firebase token refresh error handling
- **Improvement**: saveToCloud returns Promise for better async handling

### v2.1.0
- Cloud sync with Firebase
- Google Sign-In
- Settings dropdown
- Donate options

## License

MIT
