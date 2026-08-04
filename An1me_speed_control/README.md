<div align="center">

<img src="../.github/assets/banner-speed.svg" alt="An1me.to Speed Control">

[![Version 3.5](../.github/assets/badge-v-speed.svg)](manifest.json)
[![Manifest V3](../.github/assets/badge-manifest.svg)](manifest.json)
[![Data stays local](../.github/assets/badge-local.svg)](../PRIVACY.md#-an1meto-speed-control)
<br>
[![Install](../.github/assets/btn-install.svg)](#-install)
[![How to use](../.github/assets/btn-howtouse.svg)](#-how-to-use)
[![Permissions](../.github/assets/btn-permissions.svg)](#-permissions-explained)
[![Privacy](../.github/assets/btn-privacy.svg)](../PRIVACY.md#-an1meto-speed-control)
[![Troubleshooting](../.github/assets/btn-troubleshooting.svg)](#-troubleshooting)

<img src="../.github/assets/spec-speed.svg" alt="At a glance">

</div>

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-speed.svg" width="22" align="middle"> What it does

The an1me.to player has no speed control, and the video lives inside an iframe, so the usual
extensions do not reach it. This one does.

Two keys, no on-screen clutter:

| Key | Behaviour |
|---|---|
| <img src="../.github/assets/kbd-f7.svg" alt="F7" align="middle"> | **Hold** to boost. Let go and you are instantly back to normal speed. |
| <img src="../.github/assets/kbd-f8.svg" alt="F8" align="middle"> | **Toggle** the boost on and off. |

Everything else it does happens quietly: it remembers the speed, volume and mute state you prefer,
and restores them on the next episode.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-sparkle.svg" width="22" align="middle"> Features

- **Hold-to-boost (<img src="../.github/assets/kbd-f7.svg" alt="F7" align="middle">)** — perfect for a recap or an intro, no toggling back afterwards.
- **Toggle boost (<img src="../.github/assets/kbd-f8.svg" alt="F8" align="middle">)** — for when you want to stay fast for a while.
- **Choose your boost speed** in the popup: **1.5× · 2× · 3× · 4× · 8×**.
- **Remembers your normal speed** — set the player to 1.25×, and 1.25× is what <img src="../.github/assets/kbd-f7.svg" alt="F7" align="middle"> releases back to.
- **Remembers volume and mute**, applied automatically when the next video loads.
- **Works inside the iframe player**, which is the entire reason this exists.
- **On-screen badge** confirming what just changed, then it gets out of the way.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-install.svg" width="22" align="middle"> Install

1. Download the repository (`Code` → `Download ZIP`) and unzip it.
2. Open <img src="../.github/assets/cmd-chrome-extensions.svg" alt="chrome://extensions" align="middle"> (or <img src="../.github/assets/cmd-edge-extensions.svg" alt="edge://extensions" align="middle">).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this **`An1me_speed_control` folder**.
5. Open an episode on an1me.to and hold <img src="../.github/assets/kbd-f7.svg" alt="F7" align="middle">.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-target.svg" width="22" align="middle"> How to use

1. Click the toolbar icon and pick your **boost speed** (defaults to 4×).
2. Play an episode.
3. **Hold <img src="../.github/assets/kbd-f7.svg" alt="F7" align="middle">** through anything you want to skim — release to return to normal.
4. **Press <img src="../.github/assets/kbd-f8.svg" alt="F8" align="middle">** if you would rather leave it running; press it again to stop.

Speeds up to 2× are treated as a "normal" speed and saved as your default. Higher values are treated
as a boost and are never saved as your baseline — so an 8× skim does not become your new normal.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-key.svg" width="22" align="middle"> Permissions explained

| Permission | Why it is needed |
|---|---|
| `storage` | Your boost speed, default speed, volume and mute state. Local only. |
| `https://an1me.to/*` | The only site it runs on — including the player iframe (`all_frames`). |

No tabs, no history, no network access.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-shield.svg" width="22" align="middle"> Privacy, briefly

**Everything stays on your machine.** Four values in local extension storage. No network requests,
no analytics, no account, nothing collected.

[![Full privacy detail](../.github/assets/btn-privacy-detail.svg)](../PRIVACY.md#-an1meto-speed-control)

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-code.svg" width="22" align="middle"> How the code is organised

![An1me.to Speed Control source layout](../.github/assets/tree-speed.svg)

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-help.svg" width="22" align="middle"> Troubleshooting

<details>
<summary><b>F7 or F8 does nothing</b></summary>

<br>

Click **on the video once** so the page has keyboard focus, then try again. If the focus is in the
browser chrome (address bar, search box), the page never sees the key.
</details>

<details>
<summary><b>F7 is taken by something else</b></summary>

<br>

Some laptops map <img src="../.github/assets/kbd-f7.svg" alt="F7" align="middle"> to a media or brightness key at the firmware level. Try <img src="../.github/assets/kbd-fn.svg" alt="Fn" align="middle"> + <img src="../.github/assets/kbd-f7.svg" alt="F7" align="middle">, or use
<img src="../.github/assets/kbd-f8.svg" alt="F8" align="middle"> instead — it does the same job as a toggle.
</details>

<details>
<summary><b>My volume keeps resetting</b></summary>

<br>

Volume is saved shortly after you change it, so a change made in the last fraction of a second
before closing the tab may not persist. Adjust it and give it a moment.
</details>

<details>
<summary><b>It stopped working after an an1me.to redesign</b></summary>

<br>

The player container may have moved.

[![Open an issue](../.github/assets/btn-openissue.svg)](https://github.com/thomasthanos/google_extention_privacy/issues)
</details>

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-license.svg" width="22" align="middle"> Licence

Source-available, all rights reserved.

[![Read the licence](../.github/assets/btn-licence-read.svg)](../LICENSE)

**Not affiliated with, endorsed by, or connected to an1me.to.**
