# Changelog

Notable changes to NexusMods Bypass. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow the `manifest.json` version, which is the single source of truth.

This file starts at 2.4.3. Earlier releases predate it and the repository history was
squashed, so reconstructing them accurately is not possible — rather than invent entries,
they are simply not listed.

## [2.4.3] — 2026-08-10

### Removed

- **The "hide the browser download button" setting.** `chrome.downloads.setUiOptions` is
  profile-wide: it hid the download button and progress flyout for *every* site, not only
  Nexus Mods. It originally shipped defaulted on, so profiles carried it without ever
  opting in, and nothing on screen linked the missing button back to this extension. The
  setting is gone from the popup, from the page settings panel, and from all 13 locales.

### Fixed

- Profiles that had the setting enabled get the browser download button back automatically
  on update — no browser restart, nothing to click. A one-shot re-enable runs when the
  service worker starts.

### Internal

- `HideDownloadBar` joins `LEGACY_SETTINGS_KEYS`, so the stored value is stripped from
  every profile on update; the migration's `nxtk_download_ui_default_reset` guard key
  joins `RETIRED_STORAGE_KEYS` and is deleted.
- New `tools/build-zip.mjs` packages releases from an explicit allowlist, gates on
  `check-locales.mjs`, verifies every manifest-referenced file is actually included, and
  produces a byte-identical archive for an unchanged tree. The 2.4.2 package was built by
  hand and shipped `docs/store-listing.md`, `README.md` and `PRIVACY.md` inside the
  extension; the allowlist makes that class of mistake impossible.

### Deprecated

- The `downloads.ui` permission is retained for this release only, to perform the restore
  above. It is removed from the manifest in 2.5.0.
