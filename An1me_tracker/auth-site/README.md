# An1me Tracker password reset site

Static custom Firebase Authentication handler for password resets. It is ready
for Cloudflare Pages and is designed for:

```text
https://thomast.uk/reset?mode=resetPassword&oobCode=...
```

The root page also handles reset parameters, so reset emails already linking
to `https://thomast.uk/?mode=resetPassword...` will work after deployment as
long as their one-time codes have not expired.

For local preview from the repository root, open `auth-site/index.html`. The
asset links are relative so the same files work both in that preview and when
Cloudflare serves `/reset`.

## What it does

- Verifies the Firebase reset link before showing the password form.
- Accepts and confirms a new password through Firebase Authentication.
- Shows clear expired, invalid, network-error, and success states.
- Masks the account email on screen.
- Adds restrictive security headers suitable for a reset-password page.
- Works without a build step or external JavaScript dependencies.

## Deploy with Cloudflare Pages

1. Push this repository to GitHub.
2. In Cloudflare, open **Workers & Pages** and choose **Create application**,
   then **Pages** and **Connect to Git**.
3. Select the repository and use these settings:

| Setting | Value |
|---|---|
| Framework preset | `None` |
| Build command | *(leave empty)* |
| Build output directory | `auth-site` |

4. Deploy. Cloudflare provides a temporary address such as:

```text
https://an1me-auth.pages.dev/reset
```

5. In the Pages project, open **Custom domains** -> **Set up a custom
   domain**, enter `thomast.uk`, and confirm it. Because the DNS zone is
   already managed by Cloudflare, it will add the site record automatically.
   Do not remove the existing Firebase/Resend email DNS records.

## Connect Firebase email links

Only after `https://thomast.uk/reset` opens successfully:

1. Open Firebase Console -> **Authentication** -> **Templates** ->
   **Password reset**.
2. Set the custom Action URL to:

```text
https://thomast.uk/reset
```

3. Save and request a new reset email.

If updating the custom HTML template with the repository script, set the same
URL so it is not replaced by the safe Firebase-hosted default:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\an1me-firebase-sa.json"
$env:FIREBASE_EMAIL_ACTION_URL = "https://thomast.uk/reset"
node tools/firebase-email/update-template.mjs
```

## Test before going live

An email's real `oobCode` can be used only once. Deploy the Pages site first,
then set the Firebase Action URL and request a fresh reset email. Opening that
link should show the form, and submitting a valid new password should allow
login from the extension.

## Security

The Firebase API key in `assets/app.js` is a public web-project identifier,
the same client configuration already present in the extension. The
authorization to change a password comes from Firebase's short-lived,
single-use `oobCode` in the email link. Never commit service-account JSON
keys to this folder or to GitHub.
