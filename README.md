<div align="center">

<img src=".github/assets/banner.svg" alt="Browser Extensions by ThomasThanos">

[![Manifest V3](.github/assets/badge-manifest.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Chrome ready](.github/assets/badge-chrome.svg)](#-installation)
[![Edge ready](.github/assets/badge-edge.svg)](#-installation)
[![4 extensions](.github/assets/badge-ext-count.svg)](#-the-extensions)
[![Source-available licence](.github/assets/badge-licence.svg)](LICENSE)
<br>
[![Showcase](.github/assets/btn-showcase.svg)](https://thomasthanos.github.io/google_extention_privacy/)
[![Report a bug](.github/assets/btn-reportbug.svg)](https://github.com/thomasthanos/google_extention_privacy/issues/new/choose)
[![Privacy](.github/assets/btn-privacy.svg)](PRIVACY.md)
[![Contributing](.github/assets/btn-contributing.svg)](CONTRIBUTING.md)
[![Licence](.github/assets/btn-licence.svg)](LICENSE)

</div>

<img src=".github/assets/divider.svg" width="100%" alt="">

## <img src=".github/assets/icon-info.svg" width="22" align="middle"> What is this repository?

This is the **source of four browser extensions**, published openly so that anyone can read exactly
what they do before installing them. Nothing is minified, nothing is obfuscated.

> **Source-available, not open source.** You may read, audit and use official builds.
> You may not redistribute, republish or sell them.

[![Read the licence](.github/assets/btn-licence-read.svg)](LICENSE)

<img src=".github/assets/divider.svg" width="100%" alt="">

## <img src=".github/assets/icon-package.svg" width="22" align="middle"> The extensions

| Extension | What it does | Version |
|---|---|:--:|
| [![An1me.to Tracker](.github/assets/link-tracker.svg)](An1me_tracker/) | Tracks your anime progress automatically, resumes where you left off, syncs your library to the cloud, marks fillers, connects to AniList, and shows stats, goals and achievements. | [![7.2.4](.github/assets/chip-v-tracker.svg)](An1me_tracker/manifest.json) |
| [![NexusMods Bypass](.github/assets/link-nexus.svg)](nexus.mods.bypass/) | Removes the friction from Nexus Mods downloads, queues whole collections, and keeps a local history of finished files. 13 languages. | [manifest.json](nexus.mods.bypass/manifest.json) |
| [![Auto Liker for Tinder & Boo](.github/assets/link-liker.svg)](auto-liker-extension/) | A neon on-page button that likes for you, with a live counter, progress ring and smart pause. 3 languages. | [![4.8](.github/assets/chip-v-liker.svg)](auto-liker-extension/manifest.json) |
| [![An1me.to Speed Control](.github/assets/link-speed.svg)](An1me_speed_control/) | Hold <img src=".github/assets/kbd-f7.svg" alt="F7" align="middle"> to boost playback speed, press <img src=".github/assets/kbd-f8.svg" alt="F8" align="middle"> to toggle it. Remembers your default speed and volume. | [![3.5](.github/assets/chip-v-speed.svg)](An1me_speed_control/manifest.json) |

Each folder has its own README with the full feature list, permissions and troubleshooting.

<img src=".github/assets/divider.svg" width="100%" alt="">

## <img src=".github/assets/icon-install.svg" width="22" align="middle"> Installation

None of these are on the Chrome Web Store yet, so they are installed as **unpacked extensions**.
It takes about 30 seconds.

<details open>
<summary><b>Chrome / Brave / Opera</b></summary>

<br>

1. **Download this repository** — click the green `Code` button → `Download ZIP`, then unzip it.
2. Open <img src=".github/assets/cmd-chrome-extensions.svg" alt="chrome://extensions" align="middle"> in your browser.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked**.
5. Select the **folder of the extension you want** — for example `An1me_tracker`, not the whole repo.
6. Pin it to the toolbar with the puzzle-piece icon.

</details>

<details>
<summary><b>Microsoft Edge</b></summary>

<br>

1. Download and unzip the repository as above.
2. Open <img src=".github/assets/cmd-edge-extensions.svg" alt="edge://extensions" align="middle">.
3. Turn on **Developer mode** (left sidebar).
4. Click **Load unpacked** and select the extension's folder.

</details>

![Important](.github/assets/callout-important.svg)
> Pick the **sub-folder**, not the repository root. The root is a showcase page, not an extension.
> If Chrome says *"Manifest file is missing or unreadable"*, you selected one level too high.

**Updating:** download the repo again, replace the folder, then press the reload icon on the
extension card in <img src=".github/assets/cmd-chrome-extensions.svg" alt="chrome://extensions" align="middle">.

<img src=".github/assets/divider.svg" width="100%" alt="">

## <img src=".github/assets/icon-shield.svg" width="22" align="middle"> Privacy in one paragraph

Nothing is sold, nothing is profiled, and no analytics SDK exists anywhere in this repository.
Three of the four extensions keep **100% of their data on your own machine**. Only **An1me.to
Tracker** sends data off-device, and only if you sign in — your watch library goes to your own
private Firebase document so it can sync between your browsers. Full details, per extension and per
permission, are written up separately.

[![Read the privacy policy](.github/assets/btn-privacy-policy.svg)](PRIVACY.md)

<img src=".github/assets/divider.svg" width="100%" alt="">

## <img src=".github/assets/icon-folder.svg" width="22" align="middle"> Repository layout

![Repository layout](.github/assets/tree-root.svg)

<img src=".github/assets/divider.svg" width="100%" alt="">

## <img src=".github/assets/icon-bug.svg" width="22" align="middle"> Something broken?

Open an issue — there is a guided bug-report form for NexusMods Bypass, and blank issues are
enabled for everything else.

[![Report a bug](.github/assets/btn-reportbug.svg)](https://github.com/thomasthanos/google_extention_privacy/issues/new/choose)

A good report includes: which extension, its version, your browser and version, what you expected,
and what happened instead. Console output (<img src=".github/assets/kbd-f12.svg" alt="F12" align="middle"> → Console) helps a lot.

<img src=".github/assets/divider.svg" width="100%" alt="">

## <img src=".github/assets/icon-contribute.svg" width="22" align="middle"> Contributing

Pull requests are welcome, with one condition worth knowing up front: contributions are licensed to
the project owner under the terms in the licence, § 4. Read the contributing guide before you
start — it will save you a round trip.

[![Read the contributing guide](.github/assets/btn-contributing-read.svg)](CONTRIBUTING.md)

<img src=".github/assets/divider.svg" width="100%" alt="">

## <img src=".github/assets/icon-license.svg" width="22" align="middle"> Licence

Copyright © 2026 Thomas Thanos. All rights reserved.

| | You may | | You may not |
|:--:|---|:--:|---|
| <img src=".github/assets/pill-yes.svg" width="20" align="middle"> | Install and use official builds, free, forever | <img src=".github/assets/pill-no.svg" width="20" align="middle"> | Redistribute the code or builds |
| <img src=".github/assets/pill-yes.svg" width="20" align="middle"> | Read, study and audit the source | <img src=".github/assets/pill-no.svg" width="20" align="middle"> | Publish it to any extension store or registry |
| <img src=".github/assets/pill-yes.svg" width="20" align="middle"> | Fork on GitHub **for review or to prepare a PR** | <img src=".github/assets/pill-no.svg" width="20" align="middle"> | Sell it, or bundle it with anything that earns money |
| <img src=".github/assets/pill-yes.svg" width="20" align="middle"> | Open issues and pull requests | <img src=".github/assets/pill-no.svg" width="20" align="middle"> | Publish modified or derived versions |
| | | <img src=".github/assets/pill-no.svg" width="20" align="middle"> | Use the names, icons or store artwork |

Need an exception? Ask:

[![Open an issue](.github/assets/btn-openissue.svg)](https://github.com/thomasthanos/google_extention_privacy/issues)

Third-party fonts, APIs and artwork keep their own licences, listed separately.

[![Third-party notices](.github/assets/btn-notices.svg)](THIRD-PARTY-NOTICES.md)

<img src=".github/assets/divider.svg" width="100%" alt="">

## <img src=".github/assets/icon-warning.svg" width="22" align="middle"> Not affiliated

These extensions are not affiliated with, endorsed by, or connected to Nexus Mods, an1me.to, Tinder,
Boo, AniList, MyAnimeList or Google. All product names and trademarks belong to their owners.

<div align="center">
<br>

<img src=".github/assets/icon-star.svg" width="28" align="middle">

Made by <a href="https://github.com/thomasthanos"><img src=".github/assets/tag-thomasthanos.svg" alt="ThomasThanos" align="middle"></a> — star the repo if any of this saved you time.

</div>
