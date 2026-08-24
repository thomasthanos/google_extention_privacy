# Changelog

Notable changes to NexusMods Bypass. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow the `manifest.json` version, which is the single source of truth.

This file starts at 2.4.3. Earlier releases predate it and the repository history was
squashed, so reconstructing them accurately is not possible — rather than invent entries,
they are simply not listed.

## [2.4.4] — 2026-08-24

### Added

- **Firefox support.** `tools/build-zip.mjs` now writes a second archive,
  `dist/nexus.mods.bypass-<version>-firefox.zip`, for addons.mozilla.org. It carries the
  same files as the Chrome package and a manifest derived from `manifest.json` at build
  time, so a permission or content script added for Chrome cannot go missing from the
  Firefox build. The three keys that differ: an add-on id (`browser_specific_settings.gecko`,
  required by Manifest V3 on AMO), `background.scripts` in place of `background.service_worker`
  (Gecko runs the very same `background.js` as an event page), and no `downloads.ui`
  permission, which does not exist in Firefox. Minimum Firefox is 140 — the version that
  honours the `data_collection_permissions` declaration AMO now requires of new listings.
  The Chrome and Edge manifest is untouched — it is still the file in the repository
  root, packaged verbatim.

### Fixed

- **Closing a Vortex tab, and opening page settings from the popup, on Firefox.** Both
  called a `chrome.*` method and chained `.then()`/`.catch()` onto the return value.
  Firefox's `chrome` namespace is callback-based, so on Gecko that threw instead of
  running: AutoCloseTab left the tab open and **Page settings** did nothing. Both now use
  the callback form, which behaves identically in every browser.
- **Page settings no longer reports a failure it did not have.** The content script left
  the message port to close unanswered, which sets `runtime.lastError` in the popup and
  made "the modal opened" indistinguishable from "there is no content script in this
  tab". It answers immediately now.
- **Firefox scrollbars and number fields in the settings panel.** The styled scrollbars
  came from `::-webkit-scrollbar` and the compact number inputs from Chrome-only
  `field-sizing`, so Gecko drew OS scrollbars in the dark glass panels and inputs three
  times wider than any value in them. Both are restated with the standard properties
  behind `@supports` gates — Chrome 121+ understands those properties too and would
  otherwise apply them in place of the styling it already has.

### Internal

- **Comments stripped from every file in the repository.** All 876 of them: 650 from the
  packaged source (`background.js`, `shared.js`, `content/`, `popup/`, `onboarding/` —
  roughly a fifth of its bytes), 40 from `tools/`, and 186 from the After Effects promo
  build under `internal/`. Removed with a scanner that tracks string, template and regex
  state, so no `https://` inside a string and no slash inside a regex literal was
  touched; every file was then minified before and after with an independent parser
  (terser for the scripts, clean-css for the stylesheets) and the two outputs compared
  byte for byte: 31 of the 33 files proved identical that way, and the two HTML files
  carried one comment each. The rationale that used to live in the packaged
  source is what the entries above and in 2.4.3 record.
- **The repository root is now four folders.** `src/` is the extension and nothing else —
  `manifest.json`, `background.js`, `shared.js`, `content/`, `popup/`, `onboarding/`,
  `icons/`, `_locales/` — and is what **Load unpacked** should be pointed at. `internal/`
  takes everything a browser never loads (`docs/`, `store-assets/`, `promo/` and the
  hand-built pre-`build-zip` archive), leaving `tools/` and `dist/` beside them. Archive
  layout is unchanged: entry names are still relative to `src/`, so `manifest.json` sits at
  the root of both packages. The packager's forbidden-path list collapses to one rule.

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
