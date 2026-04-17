# An1me.to Tracker

Chrome extension for `an1me.to` that tracks anime progress automatically, syncs across devices through Firebase, and provides richer library management inside the popup UI.

Current extension version: `6.2.4` (Manifest V3)

## What Changed In The Newer Versions

- Reworked popup into a modular app (`src/popup/*`) with richer list-state controls (`watching`, `on_hold`, `completed`, `dropped`)
- Added stats dashboard (`stats-engine.js`, `stats-view.js`) and weekly share card generator (`share-card.js`)
- Added smart new-episode notifications (hourly background checks)
- Added copy guard content script toggle for `an1me.to`
- Added watchlist sync back to `an1me.to` (status updates from extension to site)
- Added library repair and metadata refresh pipeline in background worker
- Improved filler detection flow (AnimeFillerList + Jikan fallback)
- Added token export/import flow for cross-browser use (for example Orion/Safari)

## Core Features

- Automatic episode tracking on `https://an1me.to/watch/*`
- Resume prompts for in-progress episodes
- Misclick protection before marking episodes complete
- Real-time cloud sync with Firestore listen stream
- Multi-device merge logic for `animeData`, `videoProgress`, and deletions
- Filler support with cached episode-type metadata
- Optional auto-skip fillers behavior
- Smart notifications for new episodes on airing anime
- Rich popup management tools:
  - Add watched anime manually (single episodes and ranges)
  - Edit titles, clear data, refresh metadata, fetch/import missing info
  - Filter/search/sort + grouped series/movies rendering
- Watchlist state sync back to the site (`watching`, `completed`, `dropped`, `on_hold`)

## Project Structure

```text
.
|-- manifest.json
|-- background.js
|-- popup.html
|-- popup.css
|-- firebase-config.js
|-- firebase-lib.js
|-- logger.js
`-- src/
    |-- common/
    |   `-- merge-utils.js
    |-- content/
    |   |-- anime-parser.js
    |   |-- cloud-sync.js
    |   |-- config.js
    |   |-- copy-guard.js
    |   |-- episode-writer.js
    |   |-- logger.js
    |   |-- main.js
    |   |-- merge-utils.js
    |   |-- notifications.js
    |   |-- progress-tracker.js
    |   |-- storage.js
    |   |-- video-monitor.js
    |   `-- watchlist-sync.js
    |-- popup/
    |   |-- anilist-service.js
    |   |-- anime-card.js
    |   |-- config.js
    |   |-- filler-fetch-ui.js
    |   |-- filler-service.js
    |   |-- firebase-sync.js
    |   |-- main.js
    |   |-- merge-utils.js
    |   |-- progress-manager.js
    |   |-- share-card.js
    |   |-- slug-utils.js
    |   |-- stats-engine.js
    |   |-- stats-view.js
    |   |-- storage.js
    |   `-- ui-helpers.js
    |-- icons/
    `-- fonts/
```

## Architecture Overview

### 1) Content Layer (`src/content/*`)

Runs on watch pages and handles:

- parsing anime/episode context from URL and page
- video element monitoring
- progress persistence with throttling and queueing
- completion detection and episode writes
- resume/completion in-page UI
- optional watchlist status updates on `an1me.to`

### 2) Background Service Worker (`background.js`)

Handles:

- Firestore real-time listener (`documents:listen`) and reconnect health checks
- debounced cloud sync for local changes
- merge/apply logic for local + cloud data
- metadata repair queues (episode counts, status, cover info)
- filler-data lookups and cache orchestration
- smart notification alarm checks
- popup/content message routing (watchlist sync, fetch jobs, repair jobs)

### 3) Popup App (`popup.html`, `src/popup/*`)

Handles:

- Firebase auth (Google + token import)
- anime list rendering, grouping, filtering, sorting
- data tools and preference toggles
- stats and dashboard rendering
- weekly share card generation

## Data Model (Primary Storage)

Main keys in `chrome.storage.local`:

- `animeData`: tracked entries by slug
- `videoProgress`: in-progress episode playback data
- `deletedAnime`: tombstones for deletion sync
- `groupCoverImages`: cached grouped cover images
- `smartNotificationsEnabled`, `copyGuardEnabled`, `autoSkipFillers`
- cached metadata keys such as `animeinfo_<slug>` and `episodeTypes_<slug>`

Typical `animeData` entry:

```json
{
  "title": "Anime Title",
  "slug": "anime-slug",
  "episodes": [{ "number": 1, "watchedAt": "...", "duration": 1420 }],
  "totalWatchTime": 1420,
  "lastWatched": "...",
  "totalEpisodes": 24,
  "coverImage": "https://...",
  "siteAnimeId": 12345,
  "completedAt": null,
  "droppedAt": null,
  "onHoldAt": null,
  "listState": "active"
}
```

## Permissions

From `manifest.json`:

- Extension permissions: `storage`, `scripting`, `identity`, `alarms`, `notifications`
- Host permissions:
  - `https://an1me.to/*`
  - `https://*.an1me.to/*`
  - `https://identitytoolkit.googleapis.com/*`
  - `https://securetoken.googleapis.com/*`
  - `https://firestore.googleapis.com/*`
  - `https://www.animefillerlist.com/*`
  - `https://graphql.anilist.co/*`
  - `https://api.jikan.moe/*`

## Local Development

No build step is required. The extension is plain JavaScript + MV3 APIs.

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this project folder
5. After edits, click **Reload** on the extension card

## Debugging

- Content logs: DevTools on an `an1me.to/watch/*` tab
- Background logs: extension card -> Service Worker -> Inspect
- Popup logs: right click extension icon -> Inspect popup

## Notes

- The service worker uses a keep-alive alarm (`1 minute`) plus a long-lived port strategy
- Completion threshold is `85%` (with remaining-time fallback logic)
- Progress writes are throttled to reduce storage churn
- Filler and anime metadata are cached with TTL and repaired gradually in background

## Maintainer

- Author: `ThomasThanos`
