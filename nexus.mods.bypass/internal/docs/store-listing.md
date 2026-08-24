# Store listing — ready-to-paste text

Source of truth for the Chrome Web Store and Edge Add-ons listings. Update this file when
the listing changes, so the dashboard copy can always be rebuilt from the repo.

## Name

`NexusMods Bypass` — comes from `_locales/<lang>/messages.json` → `appName`.

## Short description

Comes from the manifest (`__MSG_appDesc__`), so the store shows it **already translated**
for every locale in `_locales/`. Current English text (114 / 132 chars):

> Simplifies Nexus Mods downloads, manages collection download queues, and keeps a local
> history of completed files.

Edit it in `_locales/en/messages.json` (and the other locales), not in the dashboard.

## Detailed description

The dashboard's detailed description is **not** covered by `_locales` — it has to be pasted
per language in the store UI. Paste this into the "Description" field:

```
Skip the wait on Nexus Mods. NexusMods Bypass removes the friction from mod downloads — no countdown pages, no requirement detours, and one-click downloads for entire collections.

⚡ NO-WAIT DOWNLOADS
Click any download button and get the file immediately. The extension resolves the real download link for you — including Vortex (nxm://) handoffs.

📦 COLLECTION DOWNLOADER
Open any collection and download all of it — or just the mandatory files, or a hand-picked selection. Sequential downloads with smart pacing, live progress bar, pause/skip/stop controls, and a download history so a re-run only fetches what's missing. Import files you already have to skip them.

🚀 AUTO-START
Opening a file page starts the download automatically. Vortex tabs can close themselves when the handoff is done.

🌍 13 LANGUAGES
The whole interface — not just the popup — in English, German, Greek, Spanish, French, Italian, Japanese, Korean, Polish, Portuguese (BR), Russian, Turkish and Simplified Chinese. Anything untranslated falls back to English, and you can force English from the popup.

⏭️ SMALL QUALITY-OF-LIFE FIXES
Skip requirement popups, restore download buttons on archived files, and hide premium upsell panels — every feature is a toggle.

🔒 PRIVATE BY DESIGN
No analytics, no accounts, no external servers. One host permission (www.nexusmods.com), plus the download permissions needed to run the queue. Everything is stored locally, and the full source is public on GitHub so anyone can audit exactly what it does.

🐛 EASY BUG REPORTS
One click copies a full diagnostic report and opens a prefilled GitHub issue.

Note: you must be signed in to your own Nexus Mods account. This extension automates the standard free-user download flow — it does not unlock premium content and is not affiliated with Nexus Mods. If you love modding, consider Nexus Premium to support the platform.
```

## What's new — 2.4.3

Dashboard-only field, not covered by `_locales`. Paste as-is:

```
Removed the "hide the browser download button" setting.

It was a mistake: Chrome applies it to your whole browser profile, so it hid the download button for every site, not just Nexus Mods — and nothing on screen connected the missing button back to this extension.

If you had it switched on, the button comes back on its own as soon as this update installs. No restart, nothing to click. Your downloads were never affected and are always in Ctrl+J.
```

Keep this honest and specific. The setting caused support confusion precisely because the
symptom was untraceable; a vague "bug fixes and improvements" line would repeat that.

## Category

Productivity → Workflow & Planning

## Search keywords woven into the copy

Nexus Mods, Vortex, mod manager, collection downloader, auto download, skip wait, download
helper, Skyrim, Fallout, modding

## Assets — all present in `../store-assets/` (the folder moved under `internal/`)

| Asset | Size | File |
|---|---|---|
| Screenshots | 1280×800 | `1280.png`, `1280_1.png` … `1280_4.png` |
| Small promo tile | 440×280 | `canvas-440x280.png` |
| Marquee | 1400×560 | `marquee-1400x560.png` |

## Privacy tab answers

- **Single purpose:** automates the Nexus Mods download flow the user initiates
- **Data collected:** none — all storage is local. Link
  [PRIVACY.md](https://github.com/thomasthanos/google_extention_privacy/blob/main/PRIVACY.md)
  as the privacy policy URL. It lives at the repo root, not under `nexus.mods.bypass/` —
  the old path 404s, and the store will not approve a dead privacy policy link.
- **Permissions justification:**

| Permission | Justification |
|---|---|
| `storage` | Persist user settings, local download history and the local error log |
| `downloads` | Start the files the user selects, cancel them on Stop, and read download state so a queue survives the service worker being suspended |
| `downloads.ui` | Being removed. The setting that used it was dropped in 2.4.3; the permission is retained for this one release only, to re-enable the browser download button for profiles that still have it hidden. It disappears from the manifest in 2.5.0. |
| `alarms` | Resume the queue after the scheduled pause between downloads, since an MV3 service worker cannot hold a timer while suspended |
| `https://www.nexusmods.com/*` | Read download pages and start the downloads the user requests |

## Before each submission

- [ ] Version bumped in `manifest.json` — it is the only place the version lives
- [ ] `CHANGELOG.md` has an entry for the new version
- [ ] `node tools/build-zip.mjs` passes and writes `dist/nexus.mods.bypass-<version>.zip`
- [ ] That zip is the one uploaded — never a hand-made archive

The build script gates on `check-locales.mjs`, packages from an explicit allowlist, and
fails if the manifest references a file the package does not carry. It replaces the manual
"zip everything except…" step, which is how `docs/`, `README.md` and `PRIVACY.md` ended up
published inside the 2.4.2 package.

## Release history worth remembering

The 2.4.2 upload shipped this very file inside the extension. Anyone who unpacked the CRX
could read the listing notes. Fixed in 2.4.3 by the allowlist in `tools/build-zip.mjs` —
do not go back to packaging by hand.
