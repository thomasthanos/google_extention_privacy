# Custom HTML password-reset email

The Firebase Console UI editor wraps every "Message" you save inside its own
branded shell, so pasting custom HTML there has no visible effect. The Identity
Toolkit *admin* REST API exposes a hidden `bodyFormat: "HTML"` switch that
bypasses that wrapper — but it isn't surfaced in the Console.

This folder is a one-shot toolkit that flips that switch and pushes our HTML
template up to Firebase. Run it once after each template edit.

## Files

| File | Purpose |
|---|---|
| `password-reset.html` | The HTML template itself. Edit this freely. Uses Firebase placeholders `%LINK%`, `%EMAIL%`, `%APP_NAME%`. |
| `update-template.mjs` | Node script that PATCHes the template and restores a working Firebase-hosted action URL. |
| `README.md` | This file. |

## Required action URL

The reset email's `%LINK%` does not set its own destination. Firebase expands
it from **Authentication -> Templates -> Password reset -> Action URL**.

Unless you have deployed a custom password-reset web handler, set that URL to
Firebase's built-in hosted handler:

```text
https://anime-tracker-64d86.firebaseapp.com/__/auth/action
```

Do not set it to a sender domain such as `https://thomast.uk` unless that
domain actually hosts a reset handler. A custom handler must read `mode` and
`oobCode`, validate the code, collect a new password, and confirm the reset.
The update script below now sets the built-in Firebase handler automatically.
Links in emails already sent keep their old URL, so request a new reset email
after changing this setting.

A branded custom reset handler is available from the repository root in
`../../../reset.html` with assets under `../../../reset-assets/`. After it has been
deployed and `https://thomast.uk/reset` is live,
update the template while keeping its custom URL:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\an1me-firebase-sa.json"
$env:FIREBASE_EMAIL_ACTION_URL = "https://thomast.uk/reset"
node tools/firebase-email/update-template.mjs
```

The GitHub-connected Cloudflare deployment must include these public files:

```text
reset.html
_headers
reset-assets/app.js
reset-assets/styles.css
```

## Prerequisites

### 1. Configure an SMTP provider in Firebase Console

Without a custom SMTP provider, the default Firebase sender ignores
`bodyFormat` and reverts to the branded wrapper. Pick any of these free
tiers:

| Provider | Free quota | Notes |
|---|---|---|
| **Resend** | 3000 / month, 100 / day | Easiest setup, modern UI. Requires verified domain (or `onboarding@resend.dev` for tests to your own inbox only). |
| **Brevo** (Sendinblue) | 300 / day | No DNS verification required for free tier. |
| **SendGrid** | 100 / day forever | Mature, paranoid about new accounts (occasional manual review). |
| **Mailgun** | 5k / month for 3 months | Trial only after that. |

In Firebase Console:

1. **Authentication → Templates → SMTP settings** (top-right link)
2. Fill in the provider's host / port / username / password
3. **From**: `noreply@yourdomain.com` (must match a verified domain on the provider)
4. **Sender name**: `An1me Tracker`
5. Save → send the verification email Firebase requests → click the link

### 2. Generate a service account key

Firebase Console → **Project settings → Service accounts → Generate new private key**.

Save the downloaded JSON somewhere **outside the repo** (e.g.
`%USERPROFILE%\.config\an1me-firebase-sa.json`). Never commit it.

The service account needs the **Firebase Authentication Admin** role
(or any broader role like Editor / Owner — the default service account has
this already).

### 3. Node.js 18+ (already required by the rest of the repo).

## Run it

From the repo root:

```powershell
# PowerShell (Windows)
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\an1me-firebase-sa.json"
node tools/firebase-email/update-template.mjs
```

```bash
# bash / zsh
GOOGLE_APPLICATION_CREDENTIALS=./an1me-firebase-sa.json \
  node tools/firebase-email/update-template.mjs
```

Expected output:

```
Loaded template (5400 bytes) from .../password-reset.html
Project        : an1me-tracker-xxx
Sender display : An1me Tracker
Sender local   : noreply@<your-verified-domain>
Subject        : Επαναφορά κωδικού πρόσβασης για %APP_NAME%

1/2 · Acquiring access token via service-account JWT...
     ✓ token acquired
2/2 · PATCHing notification.sendEmail reset template + callbackUri...
     ✓ template and action handler updated

Done. Send yourself a password-reset email to verify ...
```

## Verify

1. Reload the extension.
2. Sign out, click **Forgot password?**, enter your email, submit.
3. Check your inbox — should arrive within 30 sec, fully styled per
   `password-reset.html`.

If it still looks like the old branded one:

- Confirm the SMTP provider is **active** (Authentication → Templates →
  SMTP should show your host with a green "Verified" tick).
- Inspect the actual email source ("Show original" in Gmail) and look for
  `Content-Type: text/html` in the headers. If it says `text/plain`, the
  `bodyFormat` switch didn't apply — re-run the script and check for an
  error in its output.

## Optional overrides

The script reads these env vars if you want to tweak without editing code:

| Var | Default | Purpose |
|---|---|---|
| `FIREBASE_EMAIL_SUBJECT` | `Επαναφορά κωδικού πρόσβασης για %APP_NAME%` | Subject line |
| `FIREBASE_EMAIL_SENDER_NAME` | `An1me Tracker` | "From" display name |
| `FIREBASE_EMAIL_LOCAL_PART` | `noreply` | Local-part of From: address |
| `FIREBASE_EMAIL_REPLY_TO` | *(empty)* | Reply-To address |
| `FIREBASE_EMAIL_TEMPLATE` | `./password-reset.html` | Path to the HTML file |
| `FIREBASE_EMAIL_ACTION_URL` | `https://<project-id>.firebaseapp.com/__/auth/action` | Override only after deploying a custom email action handler |

## Future templates

To do the same for `verifyEmail` / `verifyAndChangeEmail` / etc., copy this
script and change `resetPasswordTemplate` everywhere to the matching field on
the [`Notification.SendEmail`](https://firebase.google.com/docs/reference/identity-toolkit/rest/v2/projects/getConfig#sendemail)
schema. The same `bodyFormat: "HTML"` + `customized: true` pattern applies.

## Security reminder

Treat the service-account JSON like a root password. If it leaks:

1. Firebase Console → Service accounts → revoke the key
2. Generate a new one
