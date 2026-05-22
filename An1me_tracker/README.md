# An1me.to Tracker

Chrome extension (MV3) for `an1me.to` that tracks anime watch progress automatically, syncs across devices via Firestore (REST), and provides a rich library / stats / goals popup.

Current version: `6.4.5`.

## Core Features

- Automatic episode tracking on `https://an1me.to/watch/*`
- Resume prompt for in-progress episodes (works cross-device via cloud-pulled progress)
- Misclick protection — minimum real playback time required before completion
- Cloud sync via Firestore REST (poll-based; no realtime listener — gRPC isn't available in MV3 SWs)
- Multi-device CRDT-style merge for `animeData`, `videoProgress`, `deletedAnime`, `groupCoverImages`, `goalSettings`, `badgeUnlocks`
- Filler detection (AnimeFillerList + Jikan fallback), optional auto-skip, "Stay Here" override
- AniSkip outro-end probe used to short-circuit the completion threshold for series with credit sequences
- Smart new-episode notifications (hourly alarm)
- Skiptime contribution helper on watch pages (manual capture + submit)
- Copy-guard content script that lifts an1me.to's selection block (toggleable)
- Watchlist mirroring back to an1me.to (`watching` / `completed` / `dropped` / `on_hold`)
- Library backup: export / import JSON, CRDT-merged on import
- Stats dashboard, goals view, achievements engine, weekly share-card image
- Email/password sign-in for mobile and browsers without Google OAuth
- Opens both as toolbar popup and side panel

## Project Structure

```text
.
├── manifest.json
├── background.js
├── popup.html
├── popup.css
└── src/
    ├── background/
    │   ├── an1me-scraper.js
    │   ├── aniskip.js
    │   ├── filler-discovery.js
    │   ├── metadata-repair.js
    │   ├── smart-notifications.js
    │   └── watchlist-sync.js
    ├── common/
    │   ├── firebase-config.js
    │   ├── firestore-codec.js
    │   ├── logger.js
    │   ├── merge-utils.js
    │   └── multipart-mappings.js
    ├── content/
    │   ├── anime-parser.js
    │   ├── cloud-sync.js
    │   ├── config.js
    │   ├── copy-guard.js
    │   ├── episode-writer.js
    │   ├── main.js
    │   ├── merge-utils.js     (shim → src/common/merge-utils.js)
    │   ├── notifications.js
    │   ├── progress-tracker.js
    │   ├── skiptime-helper.js
    │   ├── storage.js
    │   ├── video-monitor.js
    │   └── watchlist-sync.js
    ├── popup/
    │   ├── achievements-engine.js
    │   ├── anilist-service.js
    │   ├── anime-card.js
    │   ├── anime-card-inprogress.js   (augments AnimeCardRenderer)
    │   ├── anime-card-movies.js       (augments AnimeCardRenderer)
    │   ├── anime-card-seasons.js      (augments AnimeCardRenderer)
    │   ├── anime-status.js
    │   ├── config.js
    │   ├── dialogs-a11y.js
    │   ├── episode-parse.js
    │   ├── filler-fetch-ui.js
    │   ├── filler-service.js
    │   ├── firebase-lib.js
    │   ├── firebase-sync.js
    │   ├── goals-view.js
    │   ├── library-backup.js
    │   ├── main.js
    │   ├── maintenance.js
    │   ├── merge-utils.js     (shim → src/common/merge-utils.js)
    │   ├── progress-manager.js
    │   ├── settings-view.js
    │   ├── share-card.js
    │   ├── slug-utils.js
    │   ├── stats-engine.js
    │   ├── stats-view.js
    │   ├── storage.js
    │   └── ui-helpers.js
    ├── icons/
    └── fonts/
```

## Architecture

### Content scripts

Three injection groups (see `manifest.json`):

| Match | Scripts |
|---|---|
| any an1me.to (except `/watch/*`) | `src/content/watchlist-sync.js` |
| any an1me.to (incl. `/watch/*`) | `src/content/copy-guard.js` (`document_start`) |
| `/watch/*` only | full content stack: config → logger → storage → anime-parser → notifications → episode-writer → progress-tracker → watchlist-sync → video-monitor → skiptime-helper → main → merge-utils (shared+shim) → firebase-config → firestore-codec → cloud-sync |

Watch-page responsibilities:
- Parse anime/episode context (URL + DOM + page scripts)
- Monitor `<video>` element across SPA navigations
- Throttled progress writes (regular vs. pause vs. urgent throttles)
- Misclick guard before episode completion (hard floor + near-end bypass)
- Outro-end probe via AniSkip; completion threshold at 85% or before outro
- Serialised `animeData` mutations via `ContentStorage.mutate()` queue (no clobbering between writers)
- Cloud sync entry-points: SW-mode (wake BG via runtime message) or Orion-mode (direct Firestore PATCH via keepalive fetch)

### Background service worker (`background.js` + `src/background/*`)

`importScripts()` pulls in: aniskip, filler-discovery, an1me-scraper, smart-notifications, watchlist-sync, metadata-repair + shared codec/merge-utils.

Handles:
- Firebase Identity Toolkit auth refresh (single-flight)
- Cloud poll (3-min minimum gap between consumer-connected pollings; no periodic poll alarm — wake-on-demand)
- Storage-change-driven full / progress-only Firestore PATCH with field-mask
- Echo-tracking for own writes (timestamp ring, persisted across SW kills)
- Smart-notification alarm (hourly) — rotates eligible anime by oldest lastCheck
- Metadata repair batches (chrome.alarms-driven, survive SW kills)
- AniSkip + slug→MAL ID resolution with bundled caches + http-miss short-TTL
- AnimeFillerList slug discovery (Promise.any racing 5 candidates; differentiates real 404 vs transient)
- Watchlist sync forwarder (live tab → direct fetch fallback)

### Popup app (`popup.html` + `src/popup/*`)

Loaded both as toolbar popup (`action.default_popup`) and as side panel (`side_panel.default_path`).

- Firebase auth: Google OAuth via `chrome.identity` + email/password login (single-flight refresh)
- Render pipeline: `partitionEntriesByStatus` → `renderAnimeList` with cards split between `anime-card.js` (regular) + `anime-card-seasons.js` (multi-season groups) + `anime-card-movies.js` (movie groups) + `anime-card-inprogress.js` ("Continue watching" group)
- Coalesced storage-event re-renders (list + stats + goals fold into one debounce)
- Stats engine with identity+signature cache for `buildWatchIndex`, share-card image generator
- Achievements engine with identity-keyed per-helper caches (countMovies / hasComebackGap / longestEpisodesInOneSeries / etc.)
- Goals view with smart-goal auto-adjustment
- Settings view as a full-popup mode (not a dropdown); covers preferences + data tools + library refresh

## Storage Schema (`chrome.storage.local`)

Primary keys:

| Key | Shape |
|---|---|
| `animeData` | `{ [slug]: AnimeEntry }` |
| `videoProgress` | `{ [slug__episode-N]: ProgressEntry }` |
| `deletedAnime` | `{ [slug]: { deletedAt } }` tombstones (30-day TTL, aligned with `PROGRESS_TOMBSTONE_KEEP_MS`) |
| `groupCoverImages` | `{ [baseSlug]: imageUrl }` |
| `goalSettings`, `badgeUnlocks` | goals + achievement state |
| `firebase_user`, `firebase_tokens` | auth |
| `smartNotificationsEnabled`, `copyGuardEnabled`, `autoSkipFillers`, `skiptimeHelperEnabled`, `hideThumbnails` | toggles |
| `animeinfo_<slug>` | scraped per-anime metadata cache |
| `episodeTypes_<slug>` | per-anime filler/canon/special cache |
| `fillerslug_<slug>` | resolved AnimeFillerList slug |
| `metadataRepairState` | persisted batch progress for the repair runner |
| internal: `_bgLastCloudPollAt`, `_bgLastProgressSyncAt`, `_bgRecentOwnWrites`, `_csRecentOwnWrites`, `pendingSyncFlush`, `pendingBackgroundMetadataRepair`, `_perKeyCachesMigratedV1` |

`AnimeEntry` shape (selected):

```jsonc
{
  "title": "…",
  "slug": "…",
  "episodes": [{ "number": 1, "watchedAt": "…", "duration": 1420, "durationSource": "video" }],
  "totalWatchTime": 1420,
  "lastWatched": "…",
  "totalEpisodes": 24,
  "coverImage": "https://…",
  "siteAnimeId": 12345,
  "completedAt": null,
  "droppedAt": null,
  "onHoldAt": null,
  "listState": "active",
  "listStateUpdatedAt": "…",
  "favorite": false,
  "watchlistSyncedType": "watching"
}
```

## Permissions

From `manifest.json`:

- Extension: `storage`, `scripting`, `identity`, `alarms`, `notifications`, `sidePanel`
- Hosts:
  - `https://an1me.to/*`, `https://*.an1me.to/*`
  - `https://identitytoolkit.googleapis.com/*`, `https://securetoken.googleapis.com/*`, `https://firestore.googleapis.com/*`
  - `https://www.animefillerlist.com/*`
  - `https://api.jikan.moe/*`
  - `https://api.aniskip.com/*`

## Local Development

No build step. Plain JS + MV3.

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Edit → click **Reload** on the extension card
4. Run `node --check <file>` to syntax-check any modified JS

## Debugging

- Content logs: DevTools on an `an1me.to/watch/*` tab
- Background logs: extension card → **Service Worker → Inspect**
- Popup logs: right-click the extension icon → **Inspect popup**
- Side-panel logs: open side panel → right-click → **Inspect**
- Verbose popup logs: set `window.POPUP_LOG_LEVEL = 'DEBUG'` in the popup devtools console
- Verbose content logs: set `window.AnimeTrackerContent.CONFIG.LOG_LEVEL = 'DEBUG'`

## Notes

- Completion threshold: `85%` (or before AniSkip outro start, whichever first)
- Hard minimum: 30s of real playback before completion is allowed (anti scrub-to-end on mobile)
- Progress write throttles: 20s tick, 45s regular, 5s on pause, urgent bypasses entirely
- Tombstone windows aligned to 30 days for `deletedAnime` + `videoProgress` (`deleted:true`)
- Background sync wakes on `chrome.storage.onChanged`; no periodic poll alarm
- Service worker survives kills via `chrome.alarms` for both progress-sync and metadata-repair
- Firestore writes use field-mask PATCH; `email` is skipped when cached value matches (write-once optimisation)

## Code Hygiene

The codebase has been audited end-to-end and is free of statically-detectable dead code:

| Category | Status |
|---|---|
| JS files referenced | 52 / 52 (no orphans) |
| Functions / methods with zero callers | 0 |
| Module-level vars / consts unused | 0 |
| Destructured imports unused after assignment | 0 |
| Return-object fields no consumer reads | 0 |
| Unused function parameters | 0 |

Notable architectural fixes / optimisations applied during the audit:

- **Firestore codec** safely encodes `Date`, `NaN`, `Infinity` (prevents 400-rejected PATCHes)
- **Token refresh** single-flighted in both BG SW and popup (prevents `invalid_grant` flapping)
- **`videoProgress` cloud-pull** merges into the full local map instead of overwriting with the filtered map (prevents silent deletion of in-progress tracked-id entries)
- **`ContentStorage.mutate(['animeData'], fn)`** queue serialises read-modify-write across episode-writer, watchlist-sync, progress-tracker, and `trackImmediately` — no more clobbering between parallel writers
- **`buildWatchIndex`** identity-cache: O(1) cache hit on the same `animeData` reference instead of an O(N) signature walk per card render
- **Achievements** helpers (`countMovies`, `weekendEpisodes`, `longestEpisodesInOneSeries`, `hasComebackGap`, …) each have an identity-keyed cache → 12 library walks per evaluation → 6
- **`pollCloudData`** collapsed to a single gate (`CLOUD_CONSUMER_POLL_MIN_GAP_MS = 3 min`); the dead periodic-poll branch was removed
- **Coalesced popup `storage.onChanged` renders**: list, stats and goals views fold into one debounce
- **Whole-map writes trimmed**: `toggleAnimeFavorite` no longer pre-reads three unrelated maps; `FirebaseSync.hydrateSyncData` fills missing keys
- **`email` field-mask skipped** when cached cloud doc already has it (write-once optimisation in both popup and BG)
- **AniSkip / Jikan / AnimeFillerList** caches differentiate transient network errors (short TTL) from real 404s (long TTL) to avoid retry storms
- **PopupLogger / ContentLogger** both gated by `LOG_LEVEL`; hot-path logs demoted to `.debug`
- **CSS**: legacy settings-dropdown block (~260 lines), dead `renderLibrary` block (~90 lines), redundant `.badge-next-up-icon`/`.badge*` rules removed
- **`stats-engine.predictCompletion`** return shape trimmed to fields its single consumer (`anime-card.js`) actually reads
- **`pagehide`** companion event registered alongside `beforeunload` (mobile + bfcache reliability)

To re-verify cleanliness:

```bash
# Syntax check all JS files
for f in background.js src/**/*.js; do node --check "$f"; done
```

## Maintainer

`ThomasThanos`
