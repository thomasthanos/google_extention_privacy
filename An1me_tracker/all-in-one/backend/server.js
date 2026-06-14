const fs = require("fs/promises");
const path = require("path");

const admin = require("firebase-admin");
const cors = require("cors");
const dotenv = require("dotenv");
const express = require("express");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const appName = process.env.APP_NAME || "An1me Tracker";
const templatePath = path.join(__dirname, "templates", "password-reset.html");
const genericSuccessMessage =
  "If this email exists, a password reset email has been sent.";

const requiredEnvVars = [
  "SMTP_FROM_EMAIL",
  "ACTION_URL"
];

const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);
const hasSmtpConfig = Boolean(
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
);
const hasResendApiConfig = Boolean(process.env.RESEND_API_KEY);

if (missingEnvVars.length > 0) {
  console.warn(
    `Missing environment values: ${missingEnvVars.join(", ")}. The server can start, but email sending will fail until they are set.`
  );
}

if (!hasSmtpConfig && !hasResendApiConfig) {
  console.warn(
    "Missing email sender config. Set RESEND_API_KEY for production hosting, or SMTP_HOST, SMTP_USER, and SMTP_PASS for SMTP/Nodemailer."
  );
}

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    return JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8")
    );
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  // Download the real Firebase service account JSON from:
  // Firebase Console -> Project Settings -> Service accounts -> Generate new private key
  // Save it as backend/serviceAccountKey.json for local development. Never commit it publicly.
  return require("./serviceAccountKey.json");
}

let serviceAccount;
try {
  serviceAccount = loadServiceAccount();
} catch (error) {
  console.warn(
    "Missing Firebase service account. Set FIREBASE_SERVICE_ACCOUNT_BASE64 in production, or save backend/serviceAccountKey.json locally."
  );
}

if (serviceAccount && admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const allowedOrigins = (process.env.ALLOWED_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      if (origin.startsWith("chrome-extension://")) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    }
  })
);

app.use(express.json({ limit: "20kb" }));

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "An1me Tracker password reset backend is running."
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Password reset backend is running."
  });
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many password reset requests. Please try again later."
  }
});

const mailTransport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || "true").toLowerCase() === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendEmail({ to, subject, html, text }) {
  const from = `"${process.env.SMTP_FROM_NAME || appName}" <${process.env.SMTP_FROM_EMAIL}>`;

  if (process.env.RESEND_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        html,
        text
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Resend API failed with ${response.status}: ${errorBody}`);
    }

    return;
  }

  await mailTransport.sendMail({
    from,
    to,
    subject,
    html,
    text
  });
}

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAll(template, placeholder, value) {
  return template.replace(new RegExp(escapeRegExp(placeholder), "g"), value);
}

app.post("/send-password-reset", passwordResetLimiter, async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({
      success: false,
      message: "A valid email is required."
    });
  }

  if (!serviceAccount || admin.apps.length === 0) {
    console.error("Firebase Admin SDK is not initialized.");
    return res.status(500).json({
      success: false,
      message: "Password reset email service is not configured."
    });
  }

  try {
    const actionCodeSettings = {
      url: process.env.ACTION_URL,
      handleCodeInApp: false
    };

    const resetLink = await admin
      .auth()
      .generatePasswordResetLink(email, actionCodeSettings);

    const template = await fs.readFile(templatePath, "utf8");
    const html = replaceAll(
      replaceAll(replaceAll(template, "%LINK%", resetLink), "%EMAIL%", email),
      "%APP_NAME%",
      appName
    );

    await sendEmail({
      to: email,
      subject: `Reset your ${appName} password`,
      html,
      text:
        `A password reset was requested for ${email}.\n\n` +
        `Reset your ${appName} password here:\n${resetLink}\n\n` +
        "If you did not request this email, you can safely ignore it."
    });
  } catch (error) {
    console.error("Password reset email failed:", error);
  }

  return res.json({
    success: true,
    message: genericSuccessMessage
  });
});

app.use((error, req, res, next) => {
  if (error.message === "Not allowed by CORS") {
    return res.status(403).json({
      success: false,
      message: "Origin is not allowed."
    });
  }

  console.error("Unhandled server error:", error);
  return res.status(500).json({
    success: false,
    message: "Internal server error."
  });
});

app.listen(port, () => {
  console.log(`${appName} password reset backend running on port ${port}`);
});
