<div align="center">

<img src="../.github/assets/banner-tracker.svg" alt="An1me.to Tracker">

[![Version 7.2.4](../.github/assets/badge-v-tracker.svg)](manifest.json)
[![Manifest V3](../.github/assets/badge-manifest.svg)](manifest.json)
[![Cloud sync optional](../.github/assets/badge-cloud-sync.svg)](../PRIVACY.md#-an1meto-tracker)
<br>
[![Install](../.github/assets/btn-install.svg)](#-install)
[![Features](../.github/assets/btn-features.svg)](#-features)
[![Permissions](../.github/assets/btn-permissions.svg)](#-permissions-explained)
[![Privacy](../.github/assets/btn-privacy.svg)](../PRIVACY.md#-an1meto-tracker)
[![Troubleshooting](../.github/assets/btn-troubleshooting.svg)](#-troubleshooting)

<img src="../.github/assets/spec-tracker.svg" alt="At a glance">

</div>

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-play.svg" width="22" align="middle"> What it does

You watch anime on **an1me.to**. The tracker sits quietly in the background and remembers
everything for you: which episode you are on, how far into it you got, what you have finished, and
what just aired. Open the popup and your whole library is there — sorted, searchable, with covers,
stats and a bit of gamification to keep you honest.

If you sign in, it all syncs to the cloud so your phone-side browser and your desktop agree with
each other. If you don't sign in, it still works — everything just stays local.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-sparkle.svg" width="22" align="middle"> Features

### Tracking that happens by itself

- **Automatic progress detection** — starts a video, the episode gets recorded. No buttons.
- **Resume where you left off** — reopens an episode at the second you stopped.
- **Continue Watching row** injected on the an1me.to homepage.
- **Episode highlighting** — watched episodes are visually marked on the series page.
- **Skip outro** button, with timings pulled from <a href="https://aniskip.com/"><img src="../.github/assets/tag-aniskip.svg" alt="AniSkip" align="middle"></a>.
- **Movies and multi-part series** handled separately from ordinary episodes.

### Your library

- Categories, search, and sorting (title, progress, recently watched, and more).
- **Add anything manually**, including series you watched before installing.
- Cover art, episode counts and metadata resolved automatically, with a **metadata repair** job that
  quietly fixes entries that came in incomplete.
- **Filler marking** via <a href="https://www.animefillerlist.com/"><img src="../.github/assets/tag-animefillerlist.svg" alt="AnimeFillerList" align="middle"></a> — skip the padding
  or count it, your call.
- **Export / import** your whole library as a file, any time.

### Sync and connections

- **Cloud sync** through Firebase — sign in with Google, or with email and password.
- **AniList integration** — import your list in, push your progress back out.
- **Side panel mode** — the whole popup, docked, while you watch.

### Stats, goals, achievements

- Totals: series, movies, episodes, hours watched.
- Progress insights and viewing trends.
- **Goals** you set, and **achievements** with bronze / silver / gold tiers for the collectors.
- **Share cards** — a generated image of your stats, ready to post.

### Alerts

- **Smart notifications** when a series you follow gets a new episode. The checker adapts its
  frequency to how often a show actually updates instead of hammering the site hourly.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-install.svg" width="22" align="middle"> Install

1. Download the repository (`Code` → `Download ZIP`) and unzip it.
2. Open <img src="../.github/assets/cmd-chrome-extensions.svg" alt="chrome://extensions" align="middle"> (or <img src="../.github/assets/cmd-edge-extensions.svg" alt="edge://extensions" align="middle">).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this **`An1me_tracker` folder**.
5. Pin it, open an1me.to, and start watching.

Optional, but recommended: click the extension → **Sign in** to turn on cloud sync.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-key.svg" width="22" align="middle"> Permissions explained

| Permission | Why it is needed |
|---|---|
| `storage`, `unlimitedStorage` | Your library, settings and caches. Libraries with hundreds of covers exceed the normal quota. |
| `identity` | The Google sign-in flow for cloud sync. Nothing else uses it. |
| `alarms` | Wakes the background worker to check for new episodes and to refresh sync. |
| `notifications` | New-episode alerts. Turn them off in settings and nothing fires. |
| `sidePanel` | Lets the popup dock to the side of the window. |

<details>
<summary><b>Host permissions — the full list, and what each is for</b></summary>

<br>

| Host | Purpose |
|---|---|
| `an1me.to`, `*.an1me.to` | The site itself — reading episode info and injecting the UI. |
| `identitytoolkit.googleapis.com`, `securetoken.googleapis.com` | Firebase Authentication (sign-in, token refresh). |
| `firestore.googleapis.com` | Cloud sync of your library. |
| `graphql.anilist.co` | AniList import/export. |
| `www.animefillerlist.com` | Filler episode lists. |
| `api.jikan.moe`, `myanimelist.net` | Resolving a series to its MyAnimeList ID and metadata. |
| `api.aniskip.com` | Outro timings for the skip button. |
| `cdn.myanimelist.net`, `s4.anilist.co`, `image.tmdb.org`, `media.kitsu.app`, `img1.ak.crunchyroll.com` | Cover artwork only. |

</details>

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-shield.svg" width="22" align="middle"> Privacy, briefly

Without an account: **everything stays on your machine.**

With an account: your library is written to **your own private Firestore document**, readable only
by you. Metadata lookups (AniList, Jikan, AniSkip, AnimeFillerList) send a series title or ID —
never your identity. There is no analytics, no ad SDK and no data sale, anywhere.

[![Full privacy detail](../.github/assets/btn-privacy-detail.svg)](../PRIVACY.md#-an1meto-tracker)

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-code.svg" width="22" align="middle"> How the code is organised

![An1me.to Tracker source layout](../.github/assets/tree-tracker.svg)

69 JavaScript modules, plain ES — no build step, no bundler, nothing minified. What you read is
what runs.

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-help.svg" width="22" align="middle"> Troubleshooting

<details>
<summary><b>Progress isn't being recorded</b></summary>

<br>

Make sure you are on a `an1me.to/watch/...` page and that the video actually started playing.
The tracker only counts an episode once real playback time accumulates, so scrubbing to the end
without playing will not mark it.
</details>

<details>
<summary><b>"Sign in again" banner in settings</b></summary>

<br>

Your refresh token expired or was revoked (password change, session cleared, long absence).
Click **Sign in again** in Settings. Your local library is untouched by this.
</details>

<details>
<summary><b>Covers or episode counts are missing / wrong</b></summary>

<br>

Open Settings → **Refresh**, which re-runs metadata repair. If one entry is stubbornly wrong, the
series slug may have changed on an1me.to; re-adding it resolves the mapping again.
</details>

<details>
<summary><b>Notifications never appear</b></summary>

<br>

Check that smart notifications are enabled in settings, **and** that Chrome itself is allowed to
show notifications at the OS level (Windows Focus Assist and macOS Do Not Disturb both suppress them
silently).
</details>

<details>
<summary><b>Something else</b></summary>

<br>

Include the extension version, your browser version, and anything in the console (<img src="../.github/assets/kbd-f12.svg" alt="F12" align="middle">).

[![Open an issue](../.github/assets/btn-openissue.svg)](https://github.com/thomasthanos/google_extention_privacy/issues/new/choose)
</details>

<img src="../.github/assets/divider.svg" width="100%" alt="">

## <img src="../.github/assets/icon-license.svg" width="22" align="middle"> Licence

Source-available, all rights reserved. In short: use it, read it, audit it, contribute to it; do
not redistribute, republish or sell it.

[![Read the licence](../.github/assets/btn-licence-read.svg)](../LICENSE)

Not affiliated with an1me.to, AniList, MyAnimeList, Kitsu, Crunchyroll or Google.
