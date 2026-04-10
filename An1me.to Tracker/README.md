# 🎌 An1me.to Tracker

> A Chrome extension that automatically tracks your anime watching progress on [an1me.to](https://an1me.to), with real-time cloud sync across all your devices.

**Version:** 3.0.8 · **Author:** ThomasThanos · **Manifest:** V3

---

## ✨ Features

- **Auto-tracking** — Detects what you're watching and saves your episode progress automatically
- **Cloud sync** — Real-time sync across devices via Firebase Firestore (SSE stream)
- **Filler detection** — Fetches canon/filler data from AnimeFillerList.com and highlights filler episodes
- **Season grouping** — Smart grouping of multi-season anime (Naruto, AoT, Demon Slayer, etc.) into collapsible cards
- **Movie grouping** — Standalone movies grouped by franchise with poster art
- **Resume prompts** — Asks if you want to resume from where you left off
- **Multi-part anime** — Handles split cours (e.g. Bleach TYBW) with correct episode offsets
- **Google sign-in** — One-click auth with your Google account
- **Manual token auth** — Alternative login via Firebase token for advanced users
- **Donate button** — PayPal & Revolut links built in

---

## 📁 Project Structure

```
anime/
├── manifest.json              # Chrome Extension Manifest V3
├── background.js              # Service Worker (sync engine + real-time listener)
├── popup.html                 # Extension popup HTML shell
├── popup.css                  # All popup styles (glassmorphic dark UI)
├── firebase-config.js         # Firebase project config
├── firebase-lib.js            # Firebase SDK (bundled)
├── logger.js                  # Shared logger (background context)
└── src/
    ├── content/               # Scripts injected into an1me.to watch pages
    │   ├── config.js          # Content-side config (thresholds, slug maps)
    │   ├── logger.js          # Styled console logger
    │   ├── storage.js         # chrome.storage wrapper
    │   ├── anime-parser.js    # URL/DOM parsing for anime info
    │   ├── notifications.js   # Resume prompt & completion UI
    │   ├── progress-tracker.js# Episode save logic & queue
    │   ├── video-monitor.js   # Video element detection & events
    │   ├── main.js            # Content script entry point
    │   ├── merge-utils.js     # Data merge helpers (content-side)
    │   └── cloud-sync.js      # Cloud sync trigger (content-side)
    └── popup/                 # Scripts loaded by popup.html
        ├── config.js          # Popup config, slug maps, season grouping logic
        ├── storage.js         # chrome.storage wrapper (popup-side)
        ├── ui-helpers.js      # Icons, formatters, HTML escape, logger
        ├── filler-service.js  # AnimeFillerList.com API + cache
        ├── progress-manager.js# Progress cleanup, deduplication, merging
        ├── firebase-sync.js   # Firebase auth + cloud sync
        ├── anime-card.js      # Anime card HTML renderer
        ├── filler-fetch-ui.js # Filler fetch button UI logic
        ├── filler-console-logger.js # Debug filler data to console
        ├── merge-utils.js     # Data merge helpers (popup-side)
        └── main.js            # Popup entry point & event handlers
```

---

## 🏗️ Architecture

### Content Scripts (`src/content/`)

Run on every `https://an1me.to/watch/*` page. Their job is to detect the video player, monitor playback, and save progress to `chrome.storage.local`.

```
Page loads
    └─► main.js initializes
            └─► video-monitor.js finds the <video> element (including iframes)
                    └─► progress-tracker.js listens for timeupdate/ended events
                            ├─► Saves in-progress state every 2s to videoProgress{}
                            └─► On completion (≥85%) → saves episode to animeData{}
                                    └─► cloud-sync.js notifies background.js to push
```

**Key config values (content):**
| Constant | Value | Purpose |
|---|---|---|
| `COMPLETED_PERCENTAGE` | 85% | When an episode counts as "watched" |
| `REMAINING_TIME_THRESHOLD` | 120s | Mark complete if ≤2 min remain |
| `PROGRESS_SAVE_INTERVAL` | 2000ms | How often to save in-progress state |
| `VIDEO_CHECK_INTERVAL` | 1500ms | How often to scan for video element |

---

### Background Service Worker (`background.js`)

Runs persistently. Handles all Firebase communication and bidirectional sync.

```
chrome.storage.onChanged
    ├─► videoProgress changed → syncProgressOnly() [debounced 3s]
    └─► animeData changed     → syncToFirebase()   [debounced 2s]

Real-time SSE stream (Firestore Listen API)
    └─► applyCloudUpdate() merges remote changes locally

chrome.alarms ("keepAlive" every 20s)
    └─► Checks stream health, reconnects if dead (90s timeout)
```

**Sync strategy:**
- **Local wins** for episode data (higher episode count takes precedence)
- **Higher currentTime wins** for video progress (most-watched device wins)
- **Timestamp wins** for deletions (most recent delete is respected)
- Deletions are stored for 60 days before being purged
- A `syncPausedUntil` guard prevents re-uploading data that just came from the cloud

---

### Popup (`src/popup/`)

The extension popup (400×590px). Rendered from `popup.html`, styled by `popup.css`.

**UI Components:**
- **Auth screen** — Google sign-in or manual token input, glassmorphic card with neon city background
- **Stats bar** — Total anime, episodes, watch time
- **Category tabs** — All / Watching / Completed / Movies
- **Search + sort** — Instant search with debounce, multiple sort modes
- **Anime cards** — Expandable cards with:
  - Cover poster with 3D border effect
  - Status badge (Watching / Completed)
  - Canon progress bar + filler progress bar
  - Episode tags (watched, unwatched fillers, in-progress)
  - Edit title / Delete actions
- **Season groups** — Multi-season anime collapsed under one card
- **Movie groups** — Franchise movies grouped together

---

## 🔌 Permissions

| Permission | Why |
|---|---|
| `storage` | Save anime data and video progress locally |
| `scripting` | Inject content scripts into watch pages |
| `identity` | Google OAuth sign-in |
| `alarms` | Keep the service worker alive every 20s |
| `https://an1me.to/*` | Access watch pages |
| `https://firestore.googleapis.com/*` | Cloud sync |
| `https://www.animefillerlist.com/*` | Fetch filler episode data |

---

## ☁️ Firebase / Cloud

- **Project:** `anime-tracker-64d86`
- **Auth:** Firebase Identity Toolkit (Google sign-in)
- **Database:** Firestore (REST API + Listen SSE stream)
- **Data structure per user document:**

```json
{
  "animeData": { "<slug>": { "title": "", "episodes": [], "coverImage": "", "lastWatched": "" } },
  "videoProgress": { "<slug>__episode-<n>": { "currentTime": 0, "percentage": 0, "duration": 0 } },
  "deletedAnime": { "<slug>": { "deletedAt": "<ISO date>" } },
  "groupCoverImages": { "<baseSlug>": "<dataUrl>" },
  "lastUpdated": "<ISO date>",
  "email": ""
}
```

---

## 🧠 Smart Slug System

The extension handles anime that appear under multiple slugs on an1me.to:

- **Slug normalization** — Multi-part anime (e.g. Bleach TYBW parts 1/2/3) are merged into a single base slug for unified tracking
- **Episode offsets** — Part 2 of a split cour gets its episode numbers offset to continue from Part 1
- **Filler slug mapping** — Maps an1me.to slugs to AnimeFillerList.com slugs (e.g. `naruto-shippuuden` → `naruto-shippuden`)
- **Season grouping** — Extracts base slug and season number from any slug variation, groups automatically

**Hardcoded franchise support:** Naruto, Bleach, Attack on Titan, Demon Slayer, Jujutsu Kaisen, One Piece, One Punch Man, Initial D, Dragon Ball, and more.

---

## 🎨 UI / Design

- **Theme:** Deep midnight dark (`#070b13` base)
- **Accent:** Electric blue → cyan gradient (`hsl(215,100%,55%)` → `hsl(190,100%,55%)`)
- **Typography:** Inter (body) + Bebas Neue (headings)
- **Cards:** Glassmorphic with 3D border system (light top edge, dark bottom edge, inset highlight)
- **Buttons:** Filled pill with gradient + depth shadow
- **Popup size:** 420 × 590px

---

## 🛠️ Development

No build step required. Pure vanilla JavaScript + Chrome Extension APIs.

**To load in Chrome:**
1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `anime/` folder

**To reload after changes:**
- Click the 🔄 refresh icon on `chrome://extensions`
- Or press **R** in the extensions page

**Debugging:**
- Content script logs: DevTools console on any `an1me.to/watch/` page
- Background logs: Click **"Service Worker"** link on the extensions page → DevTools
- Popup logs: Right-click the extension icon → **Inspect popup**

---

## 📦 Data Storage

All data lives in `chrome.storage.local` (no quota limits unlike `sync`):

| Key | Type | Description |
|---|---|---|
| `animeData` | Object | All tracked anime with episode history |
| `videoProgress` | Object | In-progress video positions |
| `deletedAnime` | Object | Tombstone records for cross-device deletion |
| `groupCoverImages` | Object | Season group poster images (base64) |
| `firebase_user` | Object | Logged-in user info |
| `firebase_tokens` | Object | Auth tokens (auto-refreshed) |
| `episodeTypesCache` | Object | Cached filler data from AnimeFillerList (24h TTL) |

---

## 📝 Notes

- The extension uses **Manifest V3** with a service worker (not a persistent background page)
- The SSE keep-alive alarm fires every ~20s to prevent the service worker from going to sleep
- Token auto-refresh happens when less than 2 minutes remain before expiry
- Filler data is fetched lazily (on demand) and cached for 24 hours
- The `syncPausedUntil` mechanism prevents sync loops when applying remote changes locally
