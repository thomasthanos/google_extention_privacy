# Chrome Extensions Workspace

This repository contains three separate Chrome extensions in one workspace. Each top-level folder is a standalone extension that can be loaded with Chrome's **Load unpacked** option.

## Folder Renames

The folders were renamed to make the workspace easier to scan:

- `An1me.to Tracker` -> `an1me-tracker-extension`
- `anime.to` -> `an1me-speed-control-extension`
- `auto-liker-extension` -> `tinder-boo-auto-liker-extension`

An extra internal rename was also applied:

- `an1me-speed-control-extension/src` -> `an1me-speed-control-extension/assets`
- `tinder-boo-auto-liker-extension/popup` -> `tinder-boo-auto-liker-extension/popup-ui`

## Repository Layout

### `an1me-tracker-extension`

Advanced anime tracking extension for `an1me.to`.

Main responsibilities:

- tracks watched episodes automatically on `https://an1me.to/watch/*`
- stores local progress and merges it with cloud data
- syncs watch state back to the site
- shows a rich popup UI with stats, filters, share cards, and repair tools

Important files and folders:

- `manifest.json`: extension permissions, content scripts, popup, icons
- `background.js`: service worker for sync, alarms, notifications, and background jobs
- `popup.html`, `popup.css`: popup shell and styling
- `firebase-config.js`, `firebase-lib.js`: Firebase setup and helpers
- `logger.js`: shared logging utilities used outside the modular `src` tree
- `src/common/`: shared merge helpers
- `src/content/`: watch-page logic such as parsing, progress detection, notifications, video monitoring, storage, and sync
- `src/popup/`: popup application modules for rendering, stats, filler lookup, Firebase sync, and editing tools
- `src/icons/`, `src/fonts/`: packaged extension assets
- `screenshots/`: extension screenshots
- `README.md`: detailed per-extension documentation
- `An1me.to Tracker`, `An1me.to Tracker.zip`: likely exported package artifacts kept in the project folder

### `an1me-speed-control-extension`

Lightweight `an1me.to` playback speed controller.

Main responsibilities:

- injects a content script into `an1me.to`
- applies saved playback speed, volume, and mute defaults
- supports temporary boost with `F7` and toggle boost with `F8`
- exposes a small popup for choosing the boost speed

Important files and folders:

- `manifest.json`: extension configuration and icon paths
- `background.js`: basic background logging/service worker bootstrap
- `content.js`: video detection, hotkeys, storage sync, overlay hints, and boost logic
- `popup.html`, `popup.css`, `popup.js`: popup UI for selecting speed and opening donation links
- `assets/`: icons and screenshots used by the extension
- `anime.to.zip`: packaged archive of the extension

### `tinder-boo-auto-liker-extension`

Auto-like extension for Tinder and Boo.

Main responsibilities:

- injects a content script on supported Tinder and Boo match pages
- detects the like button and clicks it on an interval
- shows an on-page floating control with status and counter
- keeps popup state updated through the background worker
- supports localization through `_locales`

Important files and folders:

- `manifest.json`: site permissions, popup entry, icons, and content script registration
- `background.js`: relays status and count updates between content script and popup
- `content.js`: auto-like engine, UI overlay, fail detection, and pause logic
- `popup-ui/popup.html`, `popup-ui/popup.css`, `popup-ui/popup.js`: popup dashboard and toggle controls
- `icons/`: packaged extension icons
- `screenshots/`: extension screenshots
- `_locales/`: translation bundles for `en`, `el`, and `es`

### Root files

- `.gitignore`: ignores generated archives and local workspace-only files
- `README.md`: this overview document

## How To Work With This Repo

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select one of these folders:
   - `an1me-tracker-extension`
   - `an1me-speed-control-extension`
   - `tinder-boo-auto-liker-extension`

Each folder has its own `manifest.json`, so they should be treated as three separate extensions, not as one combined app.
