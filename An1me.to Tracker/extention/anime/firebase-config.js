/**
 * Firebase Configuration
 * Anime Tracker - Cloud Sync
 */

const firebaseConfig = {
    apiKey: "AIzaSyCDF9US2OwARlyZ0AH_zDpjzmOXRtrGKMg",
    authDomain: "anime-tracker-64d86.firebaseapp.com",
    projectId: "anime-tracker-64d86",
    storageBucket: "anime-tracker-64d86.firebasestorage.app",
    messagingSenderId: "851894443732",
    appId: "1:851894443732:web:91f5dc69608fbf474f6541"
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = firebaseConfig;
}
