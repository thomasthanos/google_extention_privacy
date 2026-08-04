<div align="center">

<img src="../.github/assets/banner-liker.svg" alt="Auto Liker for Tinder & Boo">

[![Version 4.8](../.github/assets/badge-v-liker.svg)](manifest.json)
[![Manifest V3](../.github/assets/badge-manifest.svg)](manifest.json)
[![3 languages](../.github/assets/badge-lang-3.svg)](_locales)
[![Stores nothing](../.github/assets/badge-nostore.svg)](../PRIVACY.md#-auto-liker-for-tinder--boo)
<br>
[![Install](../.github/assets/btn-install.svg)](#-install)
[![How to use](../.github/assets/btn-howtouse.svg)](#-how-to-use)
[![Permissions](../.github/assets/btn-permissions.svg)](#-permissions-explained)
[![Privacy](../.github/assets/btn-privacy.svg)](../PRIVACY.md#-auto-liker-for-tinder--boo)
[![Fair use](../.github/assets/btn-fairuse.svg)](#-before-you-use-it)

<img src="../.github/assets/spec-liker.svg" alt="At a glance">

</div>

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-heart.svg" width="22" align="middle"> What it does

Adds a floating pink control to **Tinder** and **Boo**. Press it once and the extension clicks the
like button every 3 seconds, counts as it goes, and stops by itself when something needs your
attention.

That is the whole extension. No account, no server, no configuration screen.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-sparkle.svg" width="22" align="middle"> Features

- **One-tap on/off** — a glowing button, bottom-right, on both sites.
- **Live counter** of likes in the current session, mirrored in the toolbar popup.
- **Progress ring** that fills every 100 likes.
- **Smart pause** — stops automatically after 4 consecutive failures, which is what happens when
  you hit the daily like limit, an overlay opens, or you navigate away from the card stack.
- **Loading-aware** — waits patiently while a profile is still loading instead of counting it as a
  failure.
- **Match handling** — dismisses the *"It's a Match"* screen and carries on.
- **Live status**: `ON` · `WAIT` · `PAUSED` · `OFF`, so you always know what it is doing.
- **English, Greek and Spanish** UI.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-install.svg" width="22" align="middle"> Install

1. Download the repository (`Code` → `Download ZIP`) and unzip it.
2. Open <img src="../.github/assets/cmd-chrome-extensions.svg" alt="chrome://extensions" align="middle"> (or <img src="../.github/assets/cmd-edge-extensions.svg" alt="edge://extensions" align="middle">).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this **`auto-liker-extension` folder**.
5. Open <a href="https://tinder.com"><img src="../.github/assets/tag-tinder.svg" alt="tinder.com" align="middle"></a> or <a href="https://boo.world"><img src="../.github/assets/tag-boo.svg" alt="boo.world" align="middle"></a> — the button appears
   bottom-right.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-target.svg" width="22" align="middle"> How to use

| Action | Where |
|---|---|
| Start / stop | Click the neon button on the page, or **Start Auto Like** in the toolbar popup |
| Watch the count | Centre of the ring, or **Total Likes** in the popup |
| Resume after a pause | Click the button again — the counter is not reset |

The counter resets when the page reloads. It is a session counter, not a lifetime score.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-key.svg" width="22" align="middle"> Permissions explained

| Permission | Why it is needed |
|---|---|
| `activeTab` | Access to the tab you are actively using, and nothing more. |
| `https://tinder.com/*`, `https://boo.world/*` | The only two sites the content script runs on. |

No `storage`, no `tabs`, no history, no all-URLs. It cannot see any other site you visit.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-shield.svg" width="22" align="middle"> Privacy, briefly

**Nothing leaves your browser. Nothing is even saved.** The like count lives in memory in the
background worker and disappears when the browser closes. There is no storage permission, no
network request, no analytics and no account.

[![Full privacy detail](../.github/assets/btn-privacy-detail.svg)](../PRIVACY.md#-auto-liker-for-tinder--boo)

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-warning.svg" width="22" align="middle"> Before you use it

Worth being straight about this:

- **Automating likes probably breaks Tinder's and Boo's terms of service.** Accounts have been
  restricted for less. You are choosing that risk, not the extension.
- **Liking everyone lowers your match quality.** These platforms weight indiscriminate swiping
  negatively, and the people on the other side notice.
- **Daily like limits still apply.** Smart pause simply notices you have hit yours.

Use it thoughtfully, or not at all.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-code.svg" width="22" align="middle"> How the code is organised

![Auto Liker source layout](../.github/assets/tree-liker.svg)

Around 560 lines in total. You can read the whole thing over a coffee.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-help.svg" width="22" align="middle"> Troubleshooting

<details>
<summary><b>The button does not appear</b></summary>

<br>

Reload the tab after installing — content scripts do not inject into pages that were already open.
Confirm you are on `tinder.com` or `boo.world` and not a subdomain or a mirror.
</details>

<details>
<summary><b>It says PAUSED immediately</b></summary>

<br>

Four consecutive failures. Usually the daily like limit, an open modal, or the fact that you are
not on the swiping screen. Close whatever is on top and press start again.
</details>

<details>
<summary><b>It stopped finding the like button</b></summary>

<br>

Both sites change their markup regularly, and the button is located by class and shape. It usually
needs a one-line selector update.

[![Open an issue](../.github/assets/btn-openissue.svg)](https://github.com/thomasthanos/google_extention_privacy/issues)
</details>

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-license.svg" width="22" align="middle"> Licence

Source-available, all rights reserved.

[![Read the licence](../.github/assets/btn-licence-read.svg)](../LICENSE)

**Not affiliated with, endorsed by, or connected to Tinder (Match Group) or Boo.**
