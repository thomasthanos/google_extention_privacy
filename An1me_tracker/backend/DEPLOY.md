# Deploy — An1me Tracker password reset backend

Στόχος: ο backend να τρέχει 24/7 σε Node host και να είναι προσβάσιμος στο
`https://api.thomast.uk`, ώστε η επέκταση να καλεί το `POST /send-password-reset`.

Η επέκταση καλεί ήδη αυτό το URL (δες `RESET_BACKEND_URL` στο
`src/popup/services/firebase-lib.js` και το `host_permissions` στο `manifest.json`).
Αν αλλάξεις domain, άλλαξε και τα δύο.

---

## 1. Βάλε τον backend σε δικό του git repo

Ο φάκελος `backend/` είναι gitignored από το repo της επέκτασης (σωστά — κρατάει
τα secrets έξω). Φτιάξε ξεχωριστό repo **μόνο** με τα περιεχόμενα του `backend/`:

```bash
cd backend
git init
git add server.js package.json package-lock.json templates/ .env.example DEPLOY.md
git commit -m "password reset backend"
# push σε GitHub (private repo)
```

ΜΗΝ ανεβάσεις: `.env`, `serviceAccountKey.json`, `serviceAccountKey.base64.txt`,
`node_modules/`. Το `.gitignore` ήδη τα εξαιρεί.

---

## 2. Deploy σε Render (free)

1. https://render.com → New → **Web Service** → σύνδεσε το repo του backend.
2. Ρυθμίσεις:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
3. **Environment variables** (Settings → Environment): βάλε ένα-ένα τα παρακάτω.
   Τις τιμές πάρ' τες από το τοπικό σου `backend/.env`.

   | Key | Τιμή |
   |-----|------|
   | `APP_NAME` | An1me Tracker |
   | `SMTP_HOST` | smtp.resend.com |
   | `SMTP_PORT` | 465 |
   | `SMTP_SECURE` | true |
   | `SMTP_USER` | resend |
   | `SMTP_PASS` | (το Resend SMTP password σου) |
   | `SMTP_FROM_NAME` | An1me Tracker |
   | `SMTP_FROM_EMAIL` | noreply@thomast.uk |
   | `ACTION_URL` | https://thomast.uk/reset |
   | `ALLOWED_ORIGIN` | https://thomast.uk |
   | `FIREBASE_SERVICE_ACCOUNT_BASE64` | (το περιεχόμενο του `serviceAccountKey.base64.txt`) |

   > Το `FIREBASE_SERVICE_ACCOUNT_BASE64` αντικαθιστά το `serviceAccountKey.json`,
   > οπότε δεν χρειάζεται να ανεβάσεις το αρχείο πουθενά.
   >
   > Εναλλακτικά για το email: αντί SMTP, βάλε μόνο `RESEND_API_KEY` (Resend HTTP
   > API — πιο σταθερό σε hosts που μπλοκάρουν SMTP ports). Ο κώδικας προτιμά
   > το `RESEND_API_KEY` αν υπάρχει.

4. Deploy. Το Render σου δίνει ένα URL τύπου `https://xxx.onrender.com`.
   Δοκίμασε: `https://xxx.onrender.com/health` → πρέπει να δώσει
   `{"success":true,...}`.

---

## 3. Σύνδεσε το `api.thomast.uk` (Cloudflare DNS)

1. Cloudflare → domain `thomast.uk` → **DNS** → Add record:
   - **Type:** CNAME
   - **Name:** `api`
   - **Target:** `xxx.onrender.com` (το hostname του Render, χωρίς https://)
   - **Proxy:** DNS only (γκρι σύννεφο) στην αρχή — πιο εύκολο για το SSL του Render.
2. Στο Render → Settings → **Custom Domains** → πρόσθεσε `api.thomast.uk`
   και περίμενε να γίνει verify (auto SSL).
3. Δοκίμασε: `https://api.thomast.uk/health`.

---

## 4. Cold start (free tier)

Το Render free κοιμάται μετά από ~15 λεπτά αδράνειας → η πρώτη αίτηση μπορεί να
αργήσει ~50s (ο client timeout στην επέκταση είναι 60s, οπότε δουλεύει, απλά αργεί).
Για να μένει ζεστό, βάλε ένα δωρεάν ping κάθε 10 λεπτά στο `/health`:
https://cron-job.org ή https://uptimerobot.com.

---

## 5. Τεστ end-to-end

```bash
curl -X POST https://api.thomast.uk/send-password-reset \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
```

Πρέπει να γυρίσει `{"success":true,...}` και να φτάσει email από `noreply@thomast.uk`
με link προς `https://thomast.uk/reset`. Μετά δοκίμασε από την επέκταση:
Sign in → "Forgot password?".
