/**
 * Firebase Configuration — single source of truth
 * Anime Tracker - Cloud Sync
 *
 * Loaded by:
 *   - popup.html via <script src="firebase-config.js">
 *   - background.js via importScripts('firebase-config.js')
 *   - content scripts via the manifest content_scripts js[] list
 *
 * Previously the API key + projectId were hardcoded in three places
 * (background.js, src/content/cloud-sync.js, here) — any rotation meant
 * editing all three. Now both fields are read from this file everywhere.
 */

const firebaseConfig = {
    apiKey: "AIzaSyCDF9US2OwARlyZ0AH_zDpjzmOXRtrGKMg",
    authDomain: "anime-tracker-64d86.firebaseapp.com",
    projectId: "anime-tracker-64d86",
    storageBucket: "anime-tracker-64d86.firebasestorage.app",
    messagingSenderId: "851894443732",
    appId: "1:851894443732:web:91f5dc69608fbf474f6541"
};

// Expose on globalThis so service-worker (no `window`) and content-script
// (has `window`) callers can both read from the same global.
(function () {
    const root = typeof globalThis !== 'undefined' ? globalThis
        : (typeof self !== 'undefined' ? self
        : (typeof window !== 'undefined' ? window : null));
    if (root) root.firebaseConfig = firebaseConfig;
})();

