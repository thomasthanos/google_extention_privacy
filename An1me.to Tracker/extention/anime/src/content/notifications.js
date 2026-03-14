/**
 * Anime Tracker - UI Notifications
 * Resume prompt and completion notifications
 * 
 * Modern iOS 26 glass design with 3D effects
 */

const Notifications = {
    cleanupFunctions: [],

    addCleanup(fn) {
        this.cleanupFunctions.push(fn);
    },

    cleanup() {
        this.cleanupFunctions.forEach(fn => { try { fn() } catch {} });
        this.cleanupFunctions = [];
    },

    ensureFont: (() => {
        let loaded = false;
        return () => {
            if (loaded) return;
            const link = Object.assign(document.createElement('link'), {
                id: 'anime-tracker-font',
                rel: 'stylesheet',
                href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
            });
            document.head.appendChild(link);
            loaded = true;
        };
    })(),

    injectRootStyles() {
        if (document.querySelector('#anime-tracker-root-styles')) return;
        const style = Object.assign(document.createElement('style'), {
            id: 'anime-tracker-root-styles',
            textContent: `
                :root {
/* Backgrounds */
                    --at-bg-primary: rgba(14, 17, 23, 0.85);
                    --at-bg-secondary: rgba(17, 21, 32, 0.9);
                    --at-bg-accent-resume: rgba(79, 195, 247, 0.15);
                    --at-bg-accent-complete: rgba(76, 175, 130, 0.15);
                    --at-bg-no: rgba(255, 255, 255, 0.08);
                    --at-bg-no-hover: rgba(255, 255, 255, 0.12);
                    
                    /* Accent Colors */
                    --at-accent-resume: #4fc3f7;
                    --at-accent-resume-light: #6fd9ff;
                    --at-accent-resume-dark: #29b6f6;
                    --at-accent-resume-gradient: linear-gradient(135deg, #4fc3f7, #29b6f6);
                    --at-accent-resume-gradient-hover: linear-gradient(135deg, #6fd9ff, #4fc3f7);
                    --at-accent-resume-gradient-text: linear-gradient(135deg, #4fc3f7, #6fd9ff);
                    --at-accent-complete: #4caf82;
                    
                    /* Text Colors */
                    --at-text-primary: #e8edf8;
                    --at-text-secondary: #b0c0d0;
                    --at-text-dark: #6b7694;
                    --at-text-white: #ffffff;
                    
                    /* Borders */
                    --at-border-light: rgba(255, 255, 255, 0.06);
                    --at-border-medium: rgba(255, 255, 255, 0.12);
                    --at-border-accent: rgba(76, 175, 130, 0.3);
                    
                    /* Shadows */
                    --at-shadow-dark: rgba(0, 0, 0, 0.5);
                    --at-shadow-darker: rgba(0, 0, 0, 0.7);
                    --at-shadow-dark-soft: rgba(0, 0, 0, 0.4);
                    --at-shadow-accent-resume: rgba(79, 195, 247, 0.3);
                    --at-shadow-accent-resume-hover: rgba(79, 195, 247, 0.4);
                    --at-shadow-accent-complete: rgba(76, 175, 130, 0.3);
                    
                    /* Glow Filters */
                    --at-glow-resume: drop-shadow(0 2px 4px rgba(79, 195, 247, 0.3));
                    --at-glow-complete: drop-shadow(0 2px 4px rgba(76, 175, 130, 0.4));
                    --at-glow-icon: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
                    
                    /* Insets */
                    --at-inset-light: rgba(255, 255, 255, 0.04);
                    --at-inset-medium: rgba(255, 255, 255, 0.08);
                    --at-inset-hover: rgba(255, 255, 255, 0.05);
                }
            `
        });
        document.head.appendChild(style);
    },

    removeElement(el, cls = 'at-hiding', delay = 250) {
        if (!el?.parentNode) return;
        el.classList.add(cls);
        setTimeout(() => el.remove(), delay);
    },

    showResumePrompt(savedProgress, onResume, onStartOver) {
        const timeStr = `${Math.floor(savedProgress.currentTime / 60)}:${(savedProgress.currentTime % 60).toString().padStart(2, '0')}`;
        
        document.querySelector('#anime-tracker-resume-prompt')?.remove();
        this.ensureFont();
        this.injectRootStyles();

        const prompt = document.createElement('div');
        prompt.id = 'anime-tracker-resume-prompt';
        prompt.innerHTML = `
            <div class="at-header">
                <svg class="at-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <span class="at-text">Resume from <strong>${timeStr}</strong>?</span>
            </div>
            <div class="at-buttons">
                <button class="at-btn at-yes" id="at-resume-yes">
                    <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>Resume
                </button>
                <button class="at-btn at-no" id="at-resume-no">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 4v6h6M23 20v-6h-6 M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                    </svg>Start Over
                </button>
            </div>
        `;

        this.injectResumeStyles();
        document.body.appendChild(prompt);

        const yes = document.getElementById('at-resume-yes');
        const no = document.getElementById('at-resume-no');
        
        const remove = () => this.removeElement(prompt);
        const onYes = () => { yes.removeEventListener('click', onYes); no.removeEventListener('click', onNo); remove(); onResume(); };
        const onNo = () => { yes.removeEventListener('click', onYes); no.removeEventListener('click', onNo); remove(); onStartOver(); };

        yes.addEventListener('click', onYes);
        no.addEventListener('click', onNo);
        
        this.addCleanup(() => { yes?.removeEventListener('click', onYes); no?.removeEventListener('click', onNo); remove(); });
        setTimeout(remove, 10000);
    },

    injectResumeStyles() {
        if (document.querySelector('#anime-tracker-resume-styles')) return;
        const style = Object.assign(document.createElement('style'), {
            id: 'anime-tracker-resume-styles',
            textContent: `
                #anime-tracker-resume-prompt{position:fixed;top:20px;left:50%;transform:translateX(-50%) scale(1);background:var(--at-bg-primary);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border:1px solid var(--at-border-light);border-radius:24px;padding:16px 24px;z-index:2147483647;display:flex;flex-direction:column;gap:16px;min-width:260px;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 20px 40px var(--at-shadow-dark),0 0 0 1px var(--at-inset-light) inset,0 1px 2px var(--at-inset-medium) inset;opacity:0;animation:atFadeIn .5s cubic-bezier(.2,.9,.3,1.2) forwards;user-select:none}
                #anime-tracker-resume-prompt *{user-select:none;font-family:inherit}
                #anime-tracker-resume-prompt.at-hiding{animation:atFadeOut .25s ease-out forwards}
                .at-header{display:flex;align-items:center;justify-content:center;gap:12px}
                .at-icon{width:24px;height:24px;color:var(--at-accent-resume);flex-shrink:0;filter:var(--at-glow-resume)}
                .at-text{color:var(--at-text-primary);font-size:15px;font-weight:500;letter-spacing:-.2px}
                .at-text strong{color:var(--at-accent-resume);font-weight:700;background:var(--at-accent-resume-gradient-text);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
                .at-buttons{display:flex;gap:12px;justify-content:center}
                .at-btn{flex:1;padding:10px 20px;border-radius:40px;font-size:14px;font-weight:600;cursor:pointer;border:none;transition:all .2s cubic-bezier(.2,0,0,1);display:flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap;box-shadow:0 4px 8px var(--at-shadow-dark-soft),0 1px 2px var(--at-inset-medium) inset}
                .at-btn svg{width:16px;height:16px;filter:var(--at-glow-icon)}
                .at-btn:active{transform:translateY(2px);box-shadow:0 2px 4px var(--at-shadow-dark-soft),0 1px 2px var(--at-inset-hover) inset}
                .at-yes{background:var(--at-accent-resume-gradient);color:var(--at-text-white);box-shadow:0 8px 16px var(--at-shadow-accent-resume)}
                .at-yes:hover{background:var(--at-accent-resume-gradient-hover);transform:translateY(-2px);box-shadow:0 12px 24px var(--at-shadow-accent-resume-hover)}
                .at-no{background:var(--at-bg-no);color:var(--at-text-secondary);border:1px solid var(--at-border-medium);backdrop-filter:blur(5px)}
                .at-no:hover{background:var(--at-bg-no-hover);color:var(--at-text-white);transform:translateY(-2px)}
                @keyframes atFadeIn{0%{opacity:0;transform:translateX(-50%) translateY(-20px) scale(.95)}100%{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
                @keyframes atFadeOut{0%{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}100%{opacity:0;transform:translateX(-50%) translateY(-10px) scale(.95)}}
            `
        });
        document.head.appendChild(style);
    },

    showCompletion(info) {
        document.querySelector('#anime-tracker-notification')?.remove();
        this.ensureFont();
        this.injectRootStyles();

        const notification = Object.assign(document.createElement('div'), {
            id: 'anime-tracker-notification',
            innerHTML: `
                <div class="at-notif-icon-wrap">
                    <svg class="at-notif-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                </div>
                <div class="at-notif-text">
                    <strong>Episode Complete!</strong>
                    <span>${info.animeTitle}</span>
                    <span class="at-notif-ep">Episode ${info.episodeNumber}</span>
                </div>
            `
        });

        this.injectNotificationStyles();
        document.body.appendChild(notification);

        this.addCleanup(() => notification.remove());
        setTimeout(() => notification.remove(), 4000);
    },

    injectNotificationStyles() {
        if (document.querySelector('#anime-tracker-styles')) return;
        const style = Object.assign(document.createElement('style'), {
            id: 'anime-tracker-styles',
            textContent: `
                #anime-tracker-notification{position:fixed;bottom:30px;right:30px;background:var(--at-bg-secondary);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border:1px solid var(--at-border-accent);border-radius:28px;padding:18px 24px;z-index:2147483647;display:flex;align-items:center;gap:18px;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 20px 40px var(--at-shadow-darker),0 0 0 1px var(--at-inset-light) inset,0 1px 2px var(--at-inset-medium) inset;opacity:0;animation:atNotifIn .5s cubic-bezier(.2,.9,.3,1.2) forwards,atNotifOut .4s ease-in 3.6s forwards;user-select:none;max-width:320px}
                #anime-tracker-notification *{user-select:none;font-family:inherit}
                .at-notif-icon-wrap{width:48px;height:48px;background:var(--at-bg-accent-complete);border-radius:30px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px var(--at-shadow-accent-complete),0 1px 2px var(--at-inset-medium) inset}
                .at-notif-icon{width:28px;height:28px;color:var(--at-accent-complete);filter:var(--at-glow-complete)}
                .at-notif-text{display:flex;flex-direction:column;gap:4px}
                .at-notif-text strong{color:var(--at-accent-complete);font-size:16px;font-weight:700;letter-spacing:-.3px}
                .at-notif-text span{color:var(--at-text-primary);font-size:14px;font-weight:500;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
                .at-notif-text .at-notif-ep{color:var(--at-text-dark);font-size:13px;font-weight:400}
                @keyframes atNotifIn{0%{opacity:0;transform:scale(.9) translateX(30px)}100%{opacity:1;transform:scale(1) translateX(0)}}
                @keyframes atNotifOut{0%{opacity:1;transform:scale(1) translateY(0)}100%{opacity:0;transform:scale(.9) translateY(20px)}}
            `
        });
        document.head.appendChild(style);
    }
};

// Export
window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.Notifications = Notifications;