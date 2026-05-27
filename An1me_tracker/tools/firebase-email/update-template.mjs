/**
 * One-shot updater for the Firebase password-reset email template.
 *
 * Why this exists:
 *   The Firebase Console UI editor wraps every "Message" you save inside the
 *   default Google-branded HTML shell, so pasting custom HTML there has no
 *   visible effect. The Identity Toolkit *admin* REST API exposes a hidden
 *   `bodyFormat: "HTML"` switch on each template that bypasses that wrapper —
 *   but it isn't surfaced in the Console UI. This script flips it for you.
 *
 * Prerequisites:
 *   1. Set up an SMTP provider in Firebase Console
 *      (Authentication → Templates → SMTP settings).
 *      Without SMTP the default sender ignores `bodyFormat` and reverts to
 *      the branded wrapper.
 *   2. Download a service-account JSON from the Firebase / GCP console:
 *      Project settings → Service accounts → Generate new private key.
 *      The account must have "Firebase Authentication Admin" or broader
 *      (Owner / Editor) IAM role on the project.
 *   3. Node.js 18+ (uses ESM + built-in `fetch`-compatible APIs).
 *
 * Usage (PowerShell, from repo root):
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\sa-key.json"
 *   node tools/firebase-email/update-template.mjs
 *
 * Usage (bash):
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa-key.json \
 *     node tools/firebase-email/update-template.mjs
 *
 * Optional env-var overrides:
 *   FIREBASE_EMAIL_SUBJECT       Subject line (default: Greek reset subject)
 *   FIREBASE_EMAIL_SENDER_NAME   Display name (default: An1me Tracker)
 *   FIREBASE_EMAIL_LOCAL_PART    Local-part of From: address (default: noreply)
 *   FIREBASE_EMAIL_REPLY_TO      Reply-To address (default: empty)
 *   FIREBASE_EMAIL_TEMPLATE      Path to HTML file (default: ./password-reset.html)
 *   FIREBASE_EMAIL_ACTION_URL    Hosted action handler URL
 *                                (default: project's Firebase hosted handler)
 */

import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { request } from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Defaults (override via env vars) ─────────────────────────────────────
const SUBJECT             = process.env.FIREBASE_EMAIL_SUBJECT     || 'Επαναφορά κωδικού πρόσβασης για %APP_NAME%';
const SENDER_DISPLAY_NAME = process.env.FIREBASE_EMAIL_SENDER_NAME || 'An1me Tracker';
const SENDER_LOCAL_PART   = process.env.FIREBASE_EMAIL_LOCAL_PART  || 'noreply';
const REPLY_TO            = process.env.FIREBASE_EMAIL_REPLY_TO    || '';
const TEMPLATE_PATH       = resolveTemplatePath(process.env.FIREBASE_EMAIL_TEMPLATE || 'password-reset.html');

function resolveTemplatePath(p) {
    return isAbsolute(p) ? p : resolve(__dirname, p);
}

async function main() {
    const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!saPath) {
        die([
            'Missing GOOGLE_APPLICATION_CREDENTIALS env var.',
            '',
            'Set it to the path of your service-account JSON, e.g.:',
            '  PowerShell:  $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\\path\\to\\sa-key.json"',
            '  bash:        export GOOGLE_APPLICATION_CREDENTIALS=./sa-key.json',
            '',
            'Get the JSON from: Firebase Console → Project Settings → Service Accounts → Generate new private key.'
        ].join('\n'));
    }

    const sa = JSON.parse(await readFile(saPath, 'utf8'));
    if (!sa.project_id || !sa.client_email || !sa.private_key) {
        die('Service account JSON missing required fields (project_id / client_email / private_key).');
    }

    const html = await readFile(TEMPLATE_PATH, 'utf8');
    const actionUrl = process.env.FIREBASE_EMAIL_ACTION_URL
        || `https://${sa.project_id}.firebaseapp.com/__/auth/action`;
    log(`Loaded template (${html.length} bytes) from ${TEMPLATE_PATH}`);
    log(`Project        : ${sa.project_id}`);
    log(`Sender display : ${SENDER_DISPLAY_NAME}`);
    log(`Sender local   : ${SENDER_LOCAL_PART}@<your-verified-domain>`);
    log(`Reply-to       : ${REPLY_TO || '(none)'}`);
    log(`Action handler : ${actionUrl}`);
    log(`Subject        : ${SUBJECT}`);
    log('');

    log('1/2 · Acquiring access token via service-account JWT...');
    const accessToken = await getAccessToken(sa);
    log('     ✓ token acquired');

    log('2/2 · PATCHing notification.sendEmail reset template + callbackUri...');
    await patchTemplate(sa.project_id, accessToken, html, actionUrl);
    log('     ✓ template and action handler updated');

    log('');
    log('Done. Send yourself a password-reset email to verify (extension popup → Forgot password?).');
    log('If the email still looks like the old branded one, double-check that an SMTP provider');
    log('is configured in Firebase Console → Authentication → Templates → SMTP settings.');
}

// ── Google service-account → access token (RS256 JWT exchange) ──────────
function base64url(buf) {
    return Buffer.from(buf)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

async function getAccessToken(sa) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(JSON.stringify({
        iss:   sa.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase',
        aud:   'https://oauth2.googleapis.com/token',
        iat:   now,
        exp:   now + 3600
    }));
    const toSign = `${header}.${claims}`;
    const signer = createSign('RSA-SHA256');
    signer.update(toSign);
    const signature = base64url(signer.sign(sa.private_key));
    const jwt = `${toSign}.${signature}`;

    const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion:  jwt
    }).toString();

    const resp = await httpsRequest({
        method:   'POST',
        hostname: 'oauth2.googleapis.com',
        path:     '/token',
        headers:  {
            'Content-Type':   'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body)
        }
    }, body);

    const data = JSON.parse(resp.body);
    if (!data.access_token) {
        throw new Error(`Token exchange failed (HTTP ${resp.status}): ${resp.body}`);
    }
    return data.access_token;
}

// ── PATCH the resetPasswordTemplate fields + hosted action URL ──────────
async function patchTemplate(projectId, accessToken, html, actionUrl) {
    const updateMask = [
        'notification.sendEmail.callbackUri',
        'notification.sendEmail.resetPasswordTemplate.subject',
        'notification.sendEmail.resetPasswordTemplate.senderDisplayName',
        'notification.sendEmail.resetPasswordTemplate.senderLocalPart',
        'notification.sendEmail.resetPasswordTemplate.replyTo',
        'notification.sendEmail.resetPasswordTemplate.body',
        'notification.sendEmail.resetPasswordTemplate.bodyFormat',
        'notification.sendEmail.resetPasswordTemplate.customized'
    ].join(',');

    const path = `/admin/v2/projects/${encodeURIComponent(projectId)}/config?updateMask=${encodeURIComponent(updateMask)}`;

    const payload = JSON.stringify({
        notification: {
            sendEmail: {
                callbackUri: actionUrl,
                resetPasswordTemplate: {
                    subject:           SUBJECT,
                    senderDisplayName: SENDER_DISPLAY_NAME,
                    senderLocalPart:   SENDER_LOCAL_PART,
                    replyTo:           REPLY_TO,
                    body:              html,
                    bodyFormat:        'HTML',
                    customized:        true
                }
            }
        }
    });

    const resp = await httpsRequest({
        method:   'PATCH',
        hostname: 'identitytoolkit.googleapis.com',
        path,
        headers:  {
            'Authorization':  `Bearer ${accessToken}`,
            'Content-Type':   'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    }, payload);

    let data = null;
    try { data = JSON.parse(resp.body); } catch { /* not JSON */ }

    if (resp.status >= 400 || data?.error) {
        const detail = data?.error
            ? JSON.stringify(data.error, null, 2)
            : resp.body;
        throw new Error(`PATCH failed (HTTP ${resp.status}):\n${detail}`);
    }
}

// ── Tiny https wrapper that returns { status, body } ────────────────────
function httpsRequest(opts, body) {
    return new Promise((resolveFn, rejectFn) => {
        const req = request(opts, (res) => {
            let chunks = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { chunks += c; });
            res.on('end', () => resolveFn({ status: res.statusCode, body: chunks }));
        });
        req.on('error', rejectFn);
        if (body) req.write(body);
        req.end();
    });
}

function log(msg) { console.log(msg); }
function die(msg) { console.error(`\nERROR: ${msg}\n`); process.exit(1); }

main().catch((err) => {
    console.error('\nFAILED:');
    console.error(err.stack || err.message || err);
    process.exit(1);
});
