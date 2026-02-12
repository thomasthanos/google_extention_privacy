/**
 * Anime Tracker - UI Notifications
 * Resume prompt and completion notifications
 */

const Notifications = {
    cleanupFunctions: [],

    /**
     * Add cleanup function
     */
    addCleanup(fn) {
        this.cleanupFunctions.push(fn);
    },

    /**
     * Execute all cleanup functions
     */
    cleanup() {
        this.cleanupFunctions.forEach(fn => {
            try {
                fn();
            } catch (e) {
                // Ignore cleanup errors
            }
        });
        this.cleanupFunctions = [];
    },

    /**
     * Ensure Google Font is loaded
     */
    ensureFont() {
        if (!document.querySelector('#anime-tracker-font')) {
            const fontLink = document.createElement('link');
            fontLink.id = 'anime-tracker-font';
            fontLink.rel = 'stylesheet';
            fontLink.href = 'https://fonts.googleapis.com/css2?family=Klee+One:wght@400;600&display=swap';
            document.head.appendChild(fontLink);
        }
    },

    /**
     * Show resume prompt
     */
    showResumePrompt(savedProgress, onResume, onStartOver) {
        const minutes = Math.floor(savedProgress.currentTime / 60);
        const seconds = savedProgress.currentTime % 60;
        const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        const oldPrompt = document.querySelector('#anime-tracker-resume-prompt');
        if (oldPrompt) oldPrompt.remove();

        this.ensureFont();

        const prompt = document.createElement('div');
        prompt.id = 'anime-tracker-resume-prompt';
        prompt.innerHTML = `
            <div class="at-header">
                <svg class="at-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                </svg>
                <span class="at-text">Resume from <strong>${timeStr}</strong>?</span>
            </div>
            <div class="at-buttons">
                <button class="at-btn at-yes" id="at-resume-yes">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                    Resume
                </button>
                <button class="at-btn at-no" id="at-resume-no">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 4v6h6M23 20v-6h-6"/>
                        <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                    </svg>
                    Start Over
                </button>
            </div>
        `;

        this.injectResumeStyles();

        document.body.appendChild(prompt);

        const yesBtn = document.getElementById('at-resume-yes');
        const noBtn = document.getElementById('at-resume-no');

        const removePrompt = () => {
            if (prompt.parentNode) {
                prompt.classList.add('at-hiding');
                setTimeout(() => prompt.remove(), 250);
            }
        };

        const onYes = () => {
            yesBtn.removeEventListener('click', onYes);
            noBtn.removeEventListener('click', onNo);
            removePrompt();
            onResume();
        };

        const onNo = () => {
            yesBtn.removeEventListener('click', onYes);
            noBtn.removeEventListener('click', onNo);
            removePrompt();
            onStartOver();
        };

        yesBtn.addEventListener('click', onYes);
        noBtn.addEventListener('click', onNo);

        this.addCleanup(() => {
            yesBtn.removeEventListener('click', onYes);
            noBtn.removeEventListener('click', onNo);
            removePrompt();
        });

        setTimeout(removePrompt, 10000);
    },

    /**
     * Inject resume prompt styles
     */
    injectResumeStyles() {
        if (document.querySelector('#anime-tracker-resume-styles')) return;

        const style = document.createElement('style');
        style.id = 'anime-tracker-resume-styles';
        style.textContent = `
            #anime-tracker-resume-prompt {
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%) scale(1.5);
                transform-origin: top center;
                background: rgba(15, 15, 25, 0.95);
                border: 1px solid rgba(255, 107, 107, 0.3);
                border-radius: 12px;
                padding: 12px 20px;
                z-index: 2147483647;
                display: flex;
                flex-direction: column;
                gap: 10px;
                min-width: 220px;
                font-family: 'Klee One', sans-serif;
                backdrop-filter: blur(12px);
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5), 0 0 30px rgba(255, 107, 107, 0.12);
                opacity: 0;
                animation: atFadeIn 0.35s ease forwards;
                user-select: none;
                -webkit-user-select: none;
            }
            #anime-tracker-resume-prompt * {
                user-select: none;
                -webkit-user-select: none;
            }
            #anime-tracker-resume-prompt.at-hiding {
                animation: atFadeOut 0.25s ease forwards;
            }
            .at-header {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }
            .at-icon {
                width: 18px;
                height: 18px;
                color: #ff6b6b;
                flex-shrink: 0;
            }
            .at-text {
                color: #ddd;
                font-size: 14px;
                white-space: nowrap;
            }
            .at-text strong {
                color: #ff6b6b;
                font-weight: 600;
            }
            .at-buttons {
                display: flex;
                gap: 8px;
            }
            .at-btn {
                flex: 1;
                padding: 6px 14px;
                border-radius: 8px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                border: none;
                transition: all 0.2s ease;
                font-family: 'Klee One', sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 5px;
                white-space: nowrap;
            }
            .at-btn svg {
                width: 12px;
                height: 12px;
                flex-shrink: 0;
            }
            .at-yes {
                background: linear-gradient(135deg, #ff6b6b, #ff5252);
                color: white;
                box-shadow: 0 3px 10px rgba(255, 107, 107, 0.3);
            }
            .at-yes:hover {
                background: linear-gradient(135deg, #ff8a8a, #ff6b6b);
                transform: translateY(-1px);
                box-shadow: 0 5px 14px rgba(255, 107, 107, 0.4);
            }
            .at-no {
                background: rgba(255, 255, 255, 0.08);
                color: #999;
                border: 1px solid rgba(255, 255, 255, 0.1);
            }
            .at-no:hover {
                background: rgba(255, 255, 255, 0.12);
                color: #fff;
            }
            @keyframes atFadeIn {
                from { opacity: 0; transform: translateX(-50%) translateY(-15px) scale(1.4); }
                to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1.5); }
            }
            @keyframes atFadeOut {
                from { opacity: 1; transform: translateX(-50%) translateY(0) scale(1.5); }
                to { opacity: 0; transform: translateX(-50%) translateY(-10px) scale(1.4); }
            }
        `;
        document.head.appendChild(style);
    },

    /**
     * Show completion notification
     */
    showCompletion(info) {
        const oldNotif = document.querySelector('#anime-tracker-notification');
        if (oldNotif) oldNotif.remove();

        this.ensureFont();

        const notification = document.createElement('div');
        notification.id = 'anime-tracker-notification';
        notification.innerHTML = `
            <div class="at-notif-icon-wrap">
                <svg class="at-notif-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
            </div>
            <div class="at-notif-text">
                <strong>Episode Complete!</strong>
                <span>${info.animeTitle}</span>
                <span class="at-notif-ep">Episode ${info.episodeNumber}</span>
            </div>
        `;

        this.injectNotificationStyles();

        document.body.appendChild(notification);

        this.addCleanup(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        });

        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 4000);
    },

    /**
     * Inject notification styles
     */
    injectNotificationStyles() {
        if (document.querySelector('#anime-tracker-styles')) return;

        const style = document.createElement('style');
        style.id = 'anime-tracker-styles';
        style.textContent = `
            #anime-tracker-notification {
                position: fixed;
                bottom: 30px;
                right: 30px;
                background: rgba(15, 15, 25, 0.95);
                border: 1px solid rgba(74, 222, 128, 0.4);
                border-radius: 16px;
                padding: 20px 24px;
                z-index: 2147483647;
                display: flex;
                align-items: center;
                gap: 16px;
                font-family: 'Klee One', sans-serif;
                backdrop-filter: blur(12px);
                box-shadow:
                    0 15px 50px rgba(0, 0, 0, 0.5),
                    0 0 40px rgba(74, 222, 128, 0.15),
                    inset 0 1px 0 rgba(255, 255, 255, 0.05);
                transform: scale(1.3);
                transform-origin: bottom right;
                opacity: 0;
                animation: atNotifIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
                           atNotifOut 0.4s ease-in 3.6s forwards;
                user-select: none;
                -webkit-user-select: none;
            }
            #anime-tracker-notification * {
                user-select: none;
                -webkit-user-select: none;
            }
            .at-notif-icon-wrap {
                width: 48px;
                height: 48px;
                background: linear-gradient(135deg, rgba(74, 222, 128, 0.2), rgba(74, 222, 128, 0.05));
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                box-shadow: 0 0 20px rgba(74, 222, 128, 0.2);
            }
            .at-notif-icon {
                width: 26px;
                height: 26px;
                color: #4ade80;
            }
            .at-notif-text {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .at-notif-text strong {
                color: #4ade80;
                font-size: 16px;
                font-weight: 600;
                letter-spacing: 0.3px;
            }
            .at-notif-text span {
                color: #e0e0e0;
                font-size: 14px;
                max-width: 280px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .at-notif-text .at-notif-ep {
                color: #888;
                font-size: 13px;
            }
            @keyframes atNotifIn {
                from {
                    transform: scale(1.3) translateX(50px);
                    opacity: 0;
                }
                to {
                    transform: scale(1.3) translateX(0);
                    opacity: 1;
                }
            }
            @keyframes atNotifOut {
                from {
                    opacity: 1;
                    transform: scale(1.3) translateY(0);
                }
                to {
                    opacity: 0;
                    transform: scale(1.2) translateY(20px);
                }
            }
        `;
        document.head.appendChild(style);
    }
};

// Export
window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.Notifications = Notifications;
