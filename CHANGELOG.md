# Changelog

Notable changes to NexusMods Bypass. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow the `manifest.json` version, which is the single source of truth.

This file starts at 2.4.3. Earlier releases predate it and the repository history was
squashed, so reconstructing them accurately is not possible — rather than invent entries,
they are simply not listed.

## [Unreleased]

## [2.5.0] — 2026-08-27

### Added

- **Tabbed navigation in popup:** Controls and Help & Bugs are now organized into separate tabs for a cleaner, user-friendly UI.
- **Direct donation options:** Added support buttons for GitHub Sponsors, PayPal (`@Thomasthanos`), and Revolut (`@thomas2873`).

## [2.4.5] — 2026-08-27

### Added

- **The Vortex handoff announces itself before closing the tab.** `location.assign('nxm:…')`
  cannot report whether Vortex received the link — an unregistered protocol handler is
  indistinguishable from success — so a handoff that went nowhere used to end with the tab
  closing on its own and nothing downloaded. The close is now a toast with the remaining
  seconds and a **Keep open** button, which is the last moment a failed handoff is still
  recoverable. Cancelling also invalidates the attempt, so nothing closes the tab afterwards.
- **A "How does it work?" panel in the popup**, with the three steps and, more importantly, the
  sentence that was missing: you have to be signed in to Nexus Mods. Signed out, Nexus answers a
  download request with a verification page, which the extension could only report as a Cloudflare
  block — accurate, and useless to the person reading it.
- **Bug reports now say what the extension was doing.** Every logged error carries the action that
  produced it — manual (you clicked a button), automatic, a collection run, or the Cloudflare
  fallback — together with the transfer method, the file id and whether the tab auto-close was
  armed. A new **Session** block records the download count, the size of the error log, the last
  action, and whether the page is currently parked in the Cloudflare fallback. "cloudflare 403"
  was the same line whether the user pressed a button or the extension acted alone; those two
  fail for different reasons and now read differently.
- **A Cloudflare fallback setting.** The fallback already ran unconditionally, and the tab
  navigating on its own is the part of it nobody expects. It now has a switch in the page settings
  panel that says what it does, and turning it off reports the Cloudflare block instead of moving
  the tab.

### Fixed

- **Archived file buttons could be attached to the wrong file.** The archived list matched headers
  to their download boxes by array index, which assumed the two collections stay the same length
  and in the same order. One stray box and every file after it received another file's buttons —
  you press download on one version and get a different one, with nothing on screen to suggest it.
  Each header now finds its own box through the DOM. There is deliberately no index fallback: a
  fixture with one header missing its box showed the fallback handing that header the *next* file's
  box, which is the same defect wearing a safety label. A file whose box cannot be identified gets
  no buttons, which is recoverable.
- **The navigation poll no longer runs at full speed on the whole site.** The content script loads
  on every `nexusmods.com` URL and polled once a second for the lifetime of the tab, including on
  forums, profiles, search and news where it has nothing to do. It stays at one second on mod and
  collection pages and while a fallback is in progress, and drops to five seconds elsewhere. The
  poll cannot be replaced outright: Nexus routes with `pushState` from the page's own world, which
  a content script in an isolated world cannot observe.

- **The Cloudflare fallback could stop without saying so.** After handing control back to Nexus's
  own download button, every entry point short-circuits while the fallback is active. If that
  button never appeared — a layout the selectors do not know, a disabled control, a method
  mismatch — the retry poll kept looking for it once a second, silently, for as long as the page
  stayed open: no download, no error, no explanation. The fallback now has a deadline. When it
  expires the state is cleared, the normal interceptors are restored and the Cloudflare error is
  shown with its recovery text. A genuine Cloudflare challenge on screen extends the deadline
  rather than tripping it, up to three minutes, because there the user is being asked to verify
  and Cloudflare's own interface is visible.
- **The bug report redacted its own error code.** The report was assembled from individually
  sanitised fields and then sanitised once more as a whole document — and that final pass cannot
  tell the report's `Code:` label from a `code=` query parameter, so every report generated from a
  live error arrived with `Code: [redacted]`. The per-field contract now stands on its own, with
  `Message:`, `Recovery:` and the settings values sanitised at the point they are built.
- **Three popup design tokens were never defined.** `--nxtk-text-muted` resolved to nothing in the
  popup's stylesheet scope, so the status line and two other elements fell back to an inherited
  colour; `--nxtk-accent-border` and `--nxtk-ease` were missing for the same reason. All three now
  exist in `popup/nxtk-shared.css` with the values `content/content-styles.css` already used, so
  the two surfaces agree.
- The popup header no longer ships a stale hardcoded `v2.4.0` that the script replaced a moment
  later.
- **"Report a bug" opened GitHub twice on Firefox, and nothing at all when the tab could not be
  created.** The content script asked the service worker to open the issue and treated the return
  value of `chrome.runtime.sendMessage` as a promise. Firefox's `chrome.*` namespace is
  callback-based and returns `undefined`, so the guard fell through to `window.open` after the
  background had already opened a tab — two tabs, two half-filled reports. In Chrome the opposite
  happened: the background answers a failed `tabs.create` with `{ok: false}`, which *resolves*,
  so `.catch()` never ran and the button did nothing. Both now go through the callback form, which
  behaves the same in every browser and is the only place the background's own reply is visible.
- **The "File archive" button had no styling.** It was created with `className = 'nxtk-archive-btn'`,
  and this extension ships no rule for that class, so the link Nexus users see in place of the
  hidden footer text rendered as bare underlined text between real buttons. It is now built by the
  same helper as the archived download links and carries Nexus's own button classes; the class name
  is kept alongside them as a hook.
- **The error dialog said a truncated report had gone through.** When a report was too long for the
  issue URL *and* the clipboard copy failed, the button read "GitHub opens prefilled…" — the same
  as a successful shortened report, with nothing to say the full text was lost. It now reuses the
  popup's wording for that outcome, which states it plainly and is already translated everywhere.
- **Three settings read differently with "Always use English" turned on.** That switch returns the
  hardcoded fallback string instead of the locale entry, and three had drifted apart: the archived
  files and auto-close labels, and the download folder description — which in the locale explains
  that leaving the folder empty saves straight into Downloads, because some mod managers never look
  inside subfolders. All 104 call sites that carry an English fallback now match their locale
  entry exactly.
- **The settings table in the README described a panel that does not exist.** Archived file buttons
  and the request timeout were listed in the wrong sections, ad hiding was filed under Advanced when
  it is not, the close-tab delay was folded into another row, and the Cloudflare fallback was absent
  entirely. The table now lists what the panel actually shows, checked row by row against the
  grouping rules the panel builds itself from, and the feature list mentions the close countdown
  and the fallback.

### Changed

- Promoted NexusMods Bypass to the repository root. The three unrelated extensions that
  previously shared this repository now live in their own standalone repositories, each
  with its folder history preserved.
- Renamed the GitHub repository from `google_extention_privacy` to `nexusmods-bypass`.

### Internal

- The two `toastClosingIn` plural entries declare their `$1` substitution in a `placeholders`
  block, which the other 39 substituting entries already did. Positional arguments are replaced
  without it — the block is the context the translated files carry, and it was the only place in
  the 13 locales where that was missing.
- `content/errors.js` carried eight LF lines in an otherwise CRLF file. Normalised; every tracked
  source file is now consistent with itself.

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
  The Chrome and Edge manifest is untouched — it is still `src/manifest.json`, packaged
  verbatim.

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
