<div align="center">

<img src="../.github/assets/banner-nexus.svg" alt="NexusMods Bypass">

[![Manifest V3](../.github/assets/badge-manifest.svg)](manifest.json)
[![13 languages](../.github/assets/badge-lang-13.svg)](_locales)
[![Data stays local](../.github/assets/badge-local.svg)](../PRIVACY.md#-nexusmods-bypass)
<br>
[![Install](../.github/assets/btn-install.svg)](#-install)
[![Features](../.github/assets/btn-features.svg)](#-features)
[![Settings](../.github/assets/btn-settings.svg)](#-settings)
[![Permissions](../.github/assets/btn-permissions.svg)](#-permissions-explained)
[![Privacy](../.github/assets/btn-privacy.svg)](../PRIVACY.md#-nexusmods-bypass)
[![Troubleshooting](../.github/assets/btn-troubleshooting.svg)](#-troubleshooting)

<img src="../.github/assets/spec-nexus.svg" alt="At a glance">

</div>

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-cloud.svg" width="22" align="middle"> What it does

Installing a large mod collection by hand means clicking through requirement screens, ad panels and
download pages, one file at a time, for an hour. This extension turns that into: open the collection
page, press start, walk away.

It handles two download modes — **send to Vortex** or **download in the browser** — queues the whole
list, paces itself so Nexus does not rate-limit you, and keeps a local history so an interrupted run
can pick up where it stopped instead of starting over.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-sparkle.svg" width="22" align="middle"> Features

### The download flow

- **Auto-start downloads** when you land on a file page — no extra click.
- **Skip requirement screens** and go straight to the download step.
- **Archived file buttons** — adds Vortex and browser download buttons back to archived entries that
  Nexus hides.
- **Auto-close Vortex tabs** after the handoff, with a delay you control.
- **Clear error messages** when Nexus fails to return a usable link, instead of a silent dead end.

### Collection downloader

- Detects collection pages and builds a **Ready Queue** of everything in the revision.
- Choose your method per run: **Send to Vortex** or **Browser download**.
- **Paced queue** — a configurable pause between mods, plus a speed estimate for Vortex mode,
  because the browser cannot see a transfer happening inside Vortex.
- **Rate-limit aware** — if Nexus throttles you, the queue pauses and resumes on its own.
- **Local download history** — already-downloaded mods are recognised, so you can pick
  *Skip Downloaded* or *Re-download All* when you retry a collection.
- **Update collection** — compare revisions to see what actually changed.
- Runs in the background service worker, so it survives tab navigation.

### Quality of life

- **Hide ads and Premium panels** — advertising slots, empty ad containers and upgrade banners are
  collapsed while you browse.
- **Guided onboarding page** the first time you install.
- **Built-in bug reporter** that attaches recent extension errors to a pre-filled GitHub issue.
- **Support panel** — entirely optional, never gates a feature.

### <img src="../.github/assets/icon-globe.svg" width="20" align="middle"> Languages

English, Greek, German, Spanish, French, Italian, Japanese, Korean, Polish, Portuguese (BR),
Russian, Turkish, Simplified Chinese — 322 strings each. There is also an **Always use English**
switch for when your browser language and your Nexus language disagree.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-install.svg" width="22" align="middle"> Install

1. Download the repository (`Code` → `Download ZIP`) and unzip it.
2. Open <img src="../.github/assets/cmd-chrome-extensions.svg" alt="chrome://extensions" align="middle"> (or <img src="../.github/assets/cmd-edge-extensions.svg" alt="edge://extensions" align="middle">).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this **`nexus.mods.bypass` folder**.
5. Open a Nexus Mods page — the welcome screen appears on first run.

![Note](../.github/assets/callout-note.svg)
> **Vortex mode requires Vortex to be running.** The browser hands the link over and cannot verify
> what happens after that, which is why files are recorded as sent rather than as completed.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-settings.svg" width="22" align="middle"> Settings

Reachable from the popup → **Page settings**. Changes save instantly.

| Group | Settings |
|---|---|
| **Download Flow** | Start downloads automatically · Close Vortex tabs (+ delay) · Skip requirement screens · Show error popups |
| **Files & Pacing** | Archived file buttons · Browser download folder · Download request timeout · Your Nexus download speed · Pause between mods |
| **Advanced** | Hide ads and Premium panels · Verbose extension logs |
| **Language** | Always use English |

**Restore Defaults** resets everything and refreshes the Nexus page.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-key.svg" width="22" align="middle"> Permissions explained

| Permission | Why it is needed |
|---|---|
| `storage` | Your settings and the local download history. |
| `downloads` | Browser download mode — starting files and putting them in your chosen subfolder. |
| `downloads.ui` | Being removed. The "hide the download button" setting is gone as of 2.4.3; the permission is held for one release only, to put the button back for profiles that still have it hidden. Dropped in 2.5.0. |
| `alarms` | Pacing the background queue between mods. |
| `https://www.nexusmods.com/*` | The only site this extension touches. |

That is the complete list. No tabs permission, no all-URLs, no remote code.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-shield.svg" width="22" align="middle"> Privacy, briefly

**Everything stays on your computer.** Settings, history and error logs live in local extension
storage. Nothing is sent anywhere except the requests to Nexus Mods that a download requires — the
same ones your browser would make if you clicked the buttons yourself. No analytics, no ads, no
account.

[![Full privacy detail](../.github/assets/btn-privacy-detail.svg)](../PRIVACY.md#-nexusmods-bypass)

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-code.svg" width="22" align="middle"> How the code is organised

![NexusMods Bypass source layout](../.github/assets/tree-nexus.svg)

Contributors: run `node tools/check-locales.mjs` before opening a PR that touches strings.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-help.svg" width="22" align="middle"> Troubleshooting

<details>
<summary><b>Downloads do not start automatically</b></summary>

<br>

Check **Start downloads automatically** in settings, and confirm you are signed in to Nexus Mods —
the extension detects login state and will not fight an anonymous session.
</details>

<details>
<summary><b>Vortex never receives the file</b></summary>

<br>

Vortex must already be running when the handoff happens. If it is slow to start, raise the
**Close-tab delay** so the tab is not closed before Vortex picks up the link.
</details>

<details>
<summary><b>The collection queue paused itself</b></summary>

<br>

That is the rate-limit guard. Nexus throttled the account; the queue resumes automatically.
Completed files stay in history, so nothing is re-downloaded when it does.
</details>

<details>
<summary><b>A collection run keeps re-downloading files I already have</b></summary>

<br>

When the history dialog appears, choose **Skip Downloaded**. If history was cleared, the extension
has no way to know which files exist on disk.
</details>

<details>
<summary><b>Reporting a bug</b></summary>

<br>

Use the popup's **Report a bug** button — it pre-fills the GitHub form with the recent error log.
Turning on **Verbose extension logs** first gives a much more useful report.
</details>

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-license.svg" width="22" align="middle"> Licence

Source-available, all rights reserved. The name *NexusMods Bypass*, the icons in `icons/`, and
everything in `store-assets/` are explicitly excluded from all permissions — a review fork may not
carry the branding.

[![Read the licence](../.github/assets/btn-licence-read.svg)](../LICENSE)

**Not affiliated with, endorsed by, or connected to Nexus Mods.**
