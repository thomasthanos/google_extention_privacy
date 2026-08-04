<div align="center">

<img src=".github/assets/banner-notices.svg" alt="Third-Party Notices">

[![Extensions](.github/assets/btn-extensions.svg)](README.md)
[![Privacy](.github/assets/btn-privacy.svg)](PRIVACY.md)
[![Licence](.github/assets/btn-licence.svg)](LICENSE)

</div>

The extensions in this repository include or rely on material that is **not** covered by the
repository's own licence, as referenced in its section 5. Each item below keeps its own licence and
belongs to its own owner. Nothing in this repository claims ownership of any of it.

[![Read the licence](.github/assets/btn-licence-read.svg)](LICENSE)

<img src=".github/assets/divider.svg" width="100%" alt="">

## <img src=".github/assets/icon-star.svg" width="22" align="middle"> Fonts

### Bundled font files

| File | Font | Used by | Notes |
|---|---|---|---|
| `An1me_tracker/src/fonts/PROXON.ttf` | **PROXON** (v1.003, built with Fontself Maker) | An1me.to Tracker — display headings | Bundled display face. Redistributed as part of this extension only; not offered for reuse. |
| `An1me_tracker/src/fonts/comic_sans.ttf` | **LDFComicSans** (v001.000, LDF) | An1me.to Tracker — accent text | A free display face by LDF. Redistributed as part of this extension only; not offered for reuse. |

![Note](.github/assets/callout-note.svg)
> These files are **not** covered by the repository licence and may not be extracted, redistributed
> or reused. If you own either typeface and want the attribution corrected or the file removed,
> get in touch — it will be handled promptly.

[![Open an issue](.github/assets/btn-openissue.svg)](https://github.com/thomasthanos/google_extention_privacy/issues)

### Fonts loaded from Google Fonts

Requested at runtime from `fonts.googleapis.com` / `fonts.gstatic.com`, not bundled:

| Font | Licence |
|---|---|
| **Inter** — Rasmus Andersson | <a href="https://openfontlicense.org/"><img src=".github/assets/tag-ofl.svg" alt="SIL Open Font License 1.1" align="middle"></a> |
| **Poppins** — Indian Type Foundry, Jonny Pinhorn | <a href="https://openfontlicense.org/"><img src=".github/assets/tag-ofl.svg" alt="SIL Open Font License 1.1" align="middle"></a> |
| **Bebas Neue** — Ryoichi Tsunekawa / Dharma Type | <a href="https://openfontlicense.org/"><img src=".github/assets/tag-ofl.svg" alt="SIL Open Font License 1.1" align="middle"></a> |

<img src=".github/assets/divider.svg" width="100%" alt="">

## <img src=".github/assets/icon-globe.svg" width="22" align="middle"> Third-party services and APIs

No code from these services is bundled. The extensions make HTTP requests to their public
endpoints, and each service's own terms and privacy policy govern those requests. Exactly what is
sent, per service, is documented separately.

[![Read the privacy policy](.github/assets/btn-privacy-policy.svg)](PRIVACY.md)

| Service | Used by | Purpose | Terms |
|---|---|---|---|
| **Firebase Authentication & Cloud Firestore** (Google) | An1me.to Tracker | Optional account and cloud sync | <a href="https://firebase.google.com/terms"><img src=".github/assets/tag-firebase-terms.svg" alt="Firebase Terms" align="middle"></a> · <a href="https://policies.google.com/privacy"><img src=".github/assets/tag-google-privacy.svg" alt="Google Privacy" align="middle"></a> |
| **AniList** | An1me.to Tracker | Metadata, list import/export | <a href="https://anilist.co/terms"><img src=".github/assets/tag-anilist-terms.svg" alt="AniList Terms" align="middle"></a> |
| **Jikan** (unofficial MyAnimeList API) | An1me.to Tracker | Series resolution and metadata | <a href="https://jikan.moe/"><img src=".github/assets/tag-jikan-site.svg" alt="jikan.moe" align="middle"></a> |
| **AniSkip** | An1me.to Tracker | Intro/outro skip timings | <a href="https://aniskip.com/"><img src=".github/assets/tag-aniskip-site.svg" alt="aniskip.com" align="middle"></a> |
| **AnimeFillerList** | An1me.to Tracker | Filler episode lists | <a href="https://www.animefillerlist.com/"><img src=".github/assets/tag-afl-site.svg" alt="animefillerlist.com" align="middle"></a> |
| **Nexus Mods** | NexusMods Bypass | Download links and collection data | <a href="https://help.nexusmods.com/category/questions-about-our-terms"><img src=".github/assets/tag-nexus-terms.svg" alt="Nexus Mods Terms" align="middle"></a> |
| **an1me.to** | An1me.to Tracker, Speed Control | Episode pages and playback | — |
| **Tinder**, **Boo** | Auto Liker | The pages the extension runs on | — |

### Image CDNs

Cover artwork displayed by An1me.to Tracker is fetched from, and remains the property of, its
respective rights holders:

`cdn.myanimelist.net` · `s4.anilist.co` · `image.tmdb.org` · `media.kitsu.app` ·
`img1.ak.crunchyroll.com`

Artwork is displayed by reference only. It is never re-hosted, modified or redistributed.

> This product uses the TMDB API but is not endorsed or certified by TMDB.

<img src=".github/assets/divider.svg" width="100%" alt="">

## <img src=".github/assets/icon-code.svg" width="22" align="middle"> Bundled code

**None.** No third-party JavaScript library is vendored into this repository. Firebase, AniList and
every other service are reached through plain HTTP calls written by hand — there is no Firebase SDK,
no framework, no bundler and no remotely-loaded code in any of the four extensions.

<img src=".github/assets/divider.svg" width="100%" alt="">

## <img src=".github/assets/icon-license.svg" width="22" align="middle"> Trademarks

*Nexus Mods*, *Vortex*, *Tinder*, *Boo*, *AniList*, *MyAnimeList*, *Kitsu*, *Crunchyroll*,
*Google*, *Firebase*, *Chrome* and *Microsoft Edge* are trademarks of their respective owners.
They are used here only to describe compatibility and are not claimed by this project.

**None of these extensions are affiliated with, endorsed by, or connected to any of the above.**

<img src=".github/assets/divider.svg" width="100%" alt="">

## <img src=".github/assets/icon-warning.svg" width="22" align="middle"> Something missing or wrong?

If you believe material of yours is included without proper attribution or permission,
let me know and it will be corrected or removed.

[![Open an issue](.github/assets/btn-openissue.svg)](https://github.com/thomasthanos/google_extention_privacy/issues)
