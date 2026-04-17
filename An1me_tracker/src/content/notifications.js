/**
 * Anime Tracker - UI Notifications (Enhanced)
 * Resume prompt and completion notifications
 * 
 * Premium glass morphism with 3D depth, gradient SVG icons, and cinematic animations
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
                href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
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
                    /* Backgrounds - deeper, richer glass */
                    --at-bg-primary: rgba(10, 12, 20, 0.88);
                    --at-bg-secondary: rgba(12, 16, 28, 0.92);
                    --at-bg-accent-resume: rgba(79, 195, 247, 0.12);
                    --at-bg-accent-complete: rgba(76, 175, 130, 0.12);
                    --at-bg-no: rgba(255, 255, 255, 0.06);
                    --at-bg-no-hover: rgba(255, 255, 255, 0.1);
                    
                    /* Accent Colors */
                    --at-accent-resume: #4fc3f7;
                    --at-accent-resume-light: #81d4fa;
                    --at-accent-resume-dark: #0288d1;
                    --at-accent-resume-gradient: linear-gradient(135deg, #4fc3f7 0%, #0288d1 100%);
                    --at-accent-resume-gradient-hover: linear-gradient(135deg, #81d4fa 0%, #4fc3f7 100%);
                    --at-accent-resume-gradient-text: linear-gradient(135deg, #4fc3f7, #81d4fa);
                    --at-accent-complete: #4caf82;
                    --at-accent-complete-light: #66bb9a;
                    --at-accent-complete-dark: #2e7d57;
                    --at-accent-complete-gradient: linear-gradient(135deg, #4caf82 0%, #2e7d57 100%);
                    
                    /* Text Colors */
                    --at-text-primary: #e8edf8;
                    --at-text-secondary: #8899b0;
                    --at-text-dark: #5a6888;
                    --at-text-white: #ffffff;
                    
                    /* Borders - subtle double-layer */
                    --at-border-light: rgba(255, 255, 255, 0.05);
                    --at-border-medium: rgba(255, 255, 255, 0.1);
                    --at-border-accent: rgba(76, 175, 130, 0.25);
                    --at-border-resume: rgba(79, 195, 247, 0.2);
                    
                    /* 3D Shadows - multi-layer for depth */
                    --at-shadow-3d: 
                        0 2px 4px rgba(0,0,0,0.2),
                        0 8px 16px rgba(0,0,0,0.25),
                        0 24px 48px rgba(0,0,0,0.3),
                        0 48px 80px rgba(0,0,0,0.15);
                    --at-shadow-3d-hover:
                        0 4px 8px rgba(0,0,0,0.2),
                        0 12px 24px rgba(0,0,0,0.3),
                        0 32px 64px rgba(0,0,0,0.35),
                        0 56px 96px rgba(0,0,0,0.2);
                    --at-shadow-accent-resume: 
                        0 4px 12px rgba(79, 195, 247, 0.2),
                        0 16px 32px rgba(79, 195, 247, 0.15);
                    --at-shadow-accent-resume-hover: 
                        0 4px 16px rgba(79, 195, 247, 0.3),
                        0 20px 40px rgba(79, 195, 247, 0.2);
                    --at-shadow-accent-complete: 
                        0 4px 12px rgba(76, 175, 130, 0.2),
                        0 16px 32px rgba(76, 175, 130, 0.15);
                    
                    /* Glow Filters */
                    --at-glow-resume: drop-shadow(0 0 6px rgba(79, 195, 247, 0.5)) drop-shadow(0 0 12px rgba(79, 195, 247, 0.2));
                    --at-glow-complete: drop-shadow(0 0 6px rgba(76, 175, 130, 0.5)) drop-shadow(0 0 12px rgba(76, 175, 130, 0.2));
                    --at-glow-icon: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.4));
                    
                    /* Insets for 3D depth */
                    --at-inset-top: rgba(255, 255, 255, 0.08);
                    --at-inset-bottom: rgba(0, 0, 0, 0.2);
                }
            `
        });
        document.head.appendChild(style);
    },

    removeElement(el, cls = 'at-hiding', delay = 350) {
        if (!el?.parentNode) return;
        el.classList.add(cls);
        setTimeout(() => el.remove(), delay);
    },

    _resolveTarget() {
        for (const iframe of document.querySelectorAll('iframe')) {
            try {
                const iDoc = iframe.contentDocument;
                if (!iDoc) continue;
                const player =
                    iDoc.querySelector('.art-video-player') ||
                    iDoc.querySelector('.artplayer-app') ||
                    iDoc.querySelector('.plyr__video-wrapper');
                if (player) {
                    if (getComputedStyle(player).position === 'static') {
                        player.style.position = 'relative';
                    }
                    return { doc: iDoc, container: player };
                }
                const video = iDoc.querySelector('video');
                if (video?.parentElement) {
                    const parent = video.parentElement;
                    if (getComputedStyle(parent).position === 'static') {
                        parent.style.position = 'relative';
                    }
                    return { doc: iDoc, container: parent };
                }
            } catch { /* cross-origin, skip */ }
        }
        return { doc: document, container: document.body };
    },

    _ensureRootStyles(doc) {
        if (doc === document) {
            this.injectRootStyles();
            return;
        }
        if (doc.querySelector('#anime-tracker-root-styles')) return;
        const style = Object.assign(doc.createElement('style'), {
            id: 'anime-tracker-root-styles',
            textContent: document.querySelector('#anime-tracker-root-styles')?.textContent || ''
        });
        (doc.head || doc.documentElement).appendChild(style);
    },

    // ── SVG Icons with gradients ─────────────────────────────────────────────
    _icons: {
        clock(gradId = 'atGradClock') {
            return `<svg class="at-icon" viewBox="0 0 24 24" fill="none">
                <defs>
                    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#81d4fa"/><stop offset="100%" stop-color="#0288d1"/>
                    </linearGradient>
                    <filter id="atClockGlow">
                        <feGaussianBlur stdDeviation="1.5" result="blur"/>
                        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                </defs>
                <circle cx="12" cy="12" r="10" stroke="url(#${gradId})" stroke-width="2" opacity="0.3"/>
                <circle cx="12" cy="12" r="10" stroke="url(#${gradId})" stroke-width="2" stroke-dasharray="4 2" filter="url(#atClockGlow)"/>
                <path d="M12 6v6l4 2" stroke="url(#${gradId})" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" filter="url(#atClockGlow)"/>
                <circle cx="12" cy="12" r="2" fill="url(#${gradId})" opacity="0.6"/>
            </svg>`;
        },
        play(gradId = 'atGradPlay') {
            return `<svg viewBox="0 0 24 24" fill="none">
                <defs>
                    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#e0f7fa"/>
                    </linearGradient>
                    <filter id="atPlayGlow">
                        <feGaussianBlur stdDeviation="1" result="blur"/>
                        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                </defs>
                <polygon points="6 3 20 12 6 21" fill="url(#${gradId})" filter="url(#atPlayGlow)"/>
            </svg>`;
        },
        refresh(gradId = 'atGradRefresh') {
            return `<svg width="30" height="30" viewBox="0 0 2.28 2.28" xmlns="http://www.w3.org/2000/svg" baseProfile="full" xml:space="preserve">
                <defs>
                    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#b0c0d0"/><stop offset="100%" stop-color="#8899b0"/>
                    </linearGradient>
                </defs>
                <path fill="url(#${gradId})" d="M1.14.617a.52.52 0 0 1 .38.164V.522l.142.142v.38h-.38L1.14.902h.266A.36.36 0 0 0 1.14.784a.355.355 0 0 0-.353.309H.62a.523.523 0 0 1 .52-.475m0 .879c.181 0 .33-.134.353-.309h.167a.523.523 0 0 1-.9.311v.259l-.142-.142v-.381h.379l.142.142H.873a.36.36 0 0 0 .267.119"/>
            </svg>`;
        },
        checkCircle(gradId = 'atGradCheck') {
            return `<svg class="at-notif-icon" viewBox="0 0 24 24" fill="none">
                <defs>
                    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#66bb9a"/><stop offset="100%" stop-color="#2e7d57"/>
                    </linearGradient>
                    <linearGradient id="${gradId}Ring" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#66bb9a" stop-opacity="0.3"/><stop offset="100%" stop-color="#2e7d57" stop-opacity="0.1"/>
                    </linearGradient>
                    <filter id="atCheckGlow">
                        <feGaussianBlur stdDeviation="1.5" result="blur"/>
                        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                </defs>
                <circle cx="12" cy="12" r="10" stroke="url(#${gradId}Ring)" stroke-width="2"/>
                <circle cx="12" cy="12" r="10" stroke="url(#${gradId})" stroke-width="2" stroke-dasharray="63" stroke-dashoffset="63" filter="url(#atCheckGlow)">
                    <animate attributeName="stroke-dashoffset" from="63" to="0" dur="0.6s" fill="freeze" begin="0.2s"/>
                </circle>
                <polyline points="8 12 11 15 16 9" stroke="url(#${gradId})" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" filter="url(#atCheckGlow)" stroke-dasharray="20" stroke-dashoffset="20">
                    <animate attributeName="stroke-dashoffset" from="20" to="0" dur="0.4s" fill="freeze" begin="0.5s"/>
                </polyline>
            </svg>`;
        }
    },

    showResumePrompt(savedProgress, onResume, onStartOver) {
        const timeStr = `${Math.floor(savedProgress.currentTime / 60)}:${(savedProgress.currentTime % 60).toString().padStart(2, '0')}`;
        
        document.querySelectorAll('#anime-tracker-resume-prompt').forEach(el => el.remove());
        document.querySelectorAll('iframe').forEach(f => {
            try { f.contentDocument?.querySelectorAll('#anime-tracker-resume-prompt').forEach(el => el.remove()); } catch {}
        });

        this.ensureFont();
        this.injectRootStyles();

        const { doc, container } = this._resolveTarget();
        this._ensureRootStyles(doc);

        const prompt = doc.createElement('div');
        prompt.id = 'anime-tracker-resume-prompt';
        prompt.innerHTML = `
            <div class="at-shine"></div>
            <div class="at-header">
                ${this._icons.clock()}
                <span class="at-text">Resume from <strong>${timeStr}</strong>?</span>
            </div>
            <div class="at-buttons">
                <button class="at-btn at-yes" id="at-resume-yes">
                    ${this._icons.play()}Resume
                </button>
                <button class="at-btn at-no" id="at-resume-no">
                    ${this._icons.refresh()}Start Over
                </button>
            </div>
        `;

        this.injectResumeStyles(doc);
        container.appendChild(prompt);

        const yes = prompt.querySelector('#at-resume-yes');
        const no  = prompt.querySelector('#at-resume-no');
        
        const remove = () => this.removeElement(prompt);
        const onYes = () => { yes.removeEventListener('click', onYes); no.removeEventListener('click', onNo); remove(); onResume(); };
        const onNo  = () => { yes.removeEventListener('click', onYes); no.removeEventListener('click', onNo); remove(); onStartOver(); };

        yes.addEventListener('click', onYes);
        no.addEventListener('click', onNo);
        
        this.addCleanup(() => { yes?.removeEventListener('click', onYes); no?.removeEventListener('click', onNo); remove(); });
        setTimeout(remove, 10000);
    },

    injectResumeStyles(doc = document) {
        if (doc.querySelector('#anime-tracker-resume-styles')) return;
        const style = Object.assign(doc.createElement('style'), {
            id: 'anime-tracker-resume-styles',
            textContent: `
                #anime-tracker-resume-prompt {
                    position: fixed;
                    top: 20px;
                    left: 50%;
                    transform: translateX(-50%) perspective(800px) rotateX(0deg);
                    background: var(--at-bg-primary);
                    backdrop-filter: blur(24px) saturate(200%);
                    -webkit-backdrop-filter: blur(24px) saturate(200%);
                    border: 1px solid var(--at-border-resume);
                    border-radius: 22px;
                    padding: 18px 28px;
                    z-index: 2147483647;
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                    min-width: 280px;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    box-shadow:
                        var(--at-shadow-3d),
                        0 0 0 1px var(--at-inset-top) inset,
                        0 -1px 2px var(--at-inset-bottom) inset,
                        0 1px 0 var(--at-inset-top) inset;
                    opacity: 0;
                    animation: atFadeIn .6s cubic-bezier(.16,1.11,.3,1) forwards;
                    user-select: none;
                    overflow: hidden;
                }
                #anime-tracker-resume-prompt * { user-select: none; font-family: inherit }
                #anime-tracker-resume-prompt.at-hiding { animation: atFadeOut .35s cubic-bezier(.4,0,1,1) forwards }
                
                /* Shine sweep effect */
                .at-shine {
                    position: absolute;
                    top: 0; left: -100%; width: 60%; height: 100%;
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent);
                    animation: atShineSweep 3s ease-in-out infinite;
                    pointer-events: none;
                }
                
                .at-header { display: flex; align-items: center; justify-content: center; gap: 14px; position: relative; z-index: 1 }
                .at-icon {
                    width: 28px; height: 28px; flex-shrink: 0;
                    filter: var(--at-glow-resume);
                    animation: atIconPulse 2s ease-in-out infinite;
                }
                .at-text { color: var(--at-text-primary); font-size: 15px; font-weight: 500; letter-spacing: -.3px }
                .at-text strong {
                    color: var(--at-accent-resume);
                    font-weight: 800;
                    background: var(--at-accent-resume-gradient-text);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    text-shadow: none;
                }
                
                .at-buttons { display: flex; gap: 12px; justify-content: center; position: relative; z-index: 1 }
                
                .at-btn {
                    flex: 1;
                    padding: 11px 22px;
                    border-radius: 14px;
                    font-size: 13.5px;
                    font-weight: 700;
                    cursor: pointer;
                    border: none;
                    transition: all .25s cubic-bezier(.2,0,0,1);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    white-space: nowrap;
                    position: relative;
                    letter-spacing: -.2px;
                }
                .at-btn svg { width: 15px; height: 15px; filter: var(--at-glow-icon) }
                .at-no svg { width: 24px; height: 24px; }
                .at-btn:active { 
                    transform: translateY(1px) scale(0.97);
                    transition-duration: .1s;
                }
                
                .at-yes {
                    background: var(--at-accent-resume-gradient);
                    color: var(--at-text-white);
                    box-shadow:
                        var(--at-shadow-accent-resume),
                        0 1px 0 rgba(255,255,255,0.15) inset;
                }
                .at-yes:hover {
                    background: var(--at-accent-resume-gradient-hover);
                    transform: translateY(-2px) scale(1.02);
                    box-shadow: var(--at-shadow-accent-resume-hover), 0 1px 0 rgba(255,255,255,0.2) inset;
                }
                
                .at-no {
                    background: var(--at-bg-no);
                    color: var(--at-text-secondary);
                    border: 1px solid var(--at-border-medium);
                    backdrop-filter: blur(8px);
                    box-shadow: 0 1px 0 var(--at-inset-top) inset;
                }
                .at-no:hover {
                    background: var(--at-bg-no-hover);
                    color: var(--at-text-primary);
                    transform: translateY(-2px) scale(1.02);
                    border-color: rgba(255,255,255,0.15);
                }
                
                @keyframes atFadeIn {
                    0% { opacity: 0; transform: translateX(-50%) perspective(800px) rotateX(-8deg) translateY(-30px) scale(.92) }
                    100% { opacity: 1; transform: translateX(-50%) perspective(800px) rotateX(0deg) translateY(0) scale(1) }
                }
                @keyframes atFadeOut {
                    0% { opacity: 1; transform: translateX(-50%) perspective(800px) rotateX(0deg) translateY(0) scale(1) }
                    100% { opacity: 0; transform: translateX(-50%) perspective(800px) rotateX(8deg) translateY(-20px) scale(.92) }
                }
                @keyframes atIconPulse {
                    0%, 100% { transform: scale(1); opacity: 1 }
                    50% { transform: scale(1.08); opacity: 0.85 }
                }
                @keyframes atShineSweep {
                    0%, 100% { left: -100% }
                    50% { left: 200% }
                }
            `
        });
        (doc.head || doc.documentElement).appendChild(style);
    },

    showCompletion(info) {
        document.querySelectorAll('#anime-tracker-notification').forEach(el => el.remove());
        document.querySelectorAll('iframe').forEach(f => {
            try { f.contentDocument?.querySelectorAll('#anime-tracker-notification').forEach(el => el.remove()); } catch {}
        });

        this.ensureFont();
        this.injectRootStyles();

        const { doc, container } = this._resolveTarget();
        this._ensureRootStyles(doc);
        const rawTitle = info?.animeTitle || '';
        const safeTitle = typeof rawTitle === 'string'
            ? rawTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
            : '';

        const notification = doc.createElement('div');
        notification.id = 'anime-tracker-notification';
        notification.innerHTML = `
            <div class="at-notif-shine"></div>
            <div class="at-notif-icon-wrap">
                <div class="at-notif-icon-ring"></div>
                ${this._icons.checkCircle()}
            </div>
            <div class="at-notif-text">
                <strong>Episode Complete!</strong>
                <span>${safeTitle}</span>
                <span class="at-notif-ep">Episode ${info.episodeNumber}</span>
            </div>
            <div class="at-notif-progress"></div>
        `;

        this.injectNotificationStyles(doc);
        container.appendChild(notification);

        this.addCleanup(() => notification.remove());
        setTimeout(() => notification.remove(), 4500);
    },

    injectNotificationStyles(doc = document) {
        if (doc.querySelector('#anime-tracker-styles')) return;
        const style = Object.assign(doc.createElement('style'), {
            id: 'anime-tracker-styles',
            textContent: `
                #anime-tracker-notification {
                    position: fixed;
                    bottom: 30px;
                    right: 30px;
                    background: var(--at-bg-secondary);
                    backdrop-filter: blur(24px) saturate(200%);
                    -webkit-backdrop-filter: blur(24px) saturate(200%);
                    border: 1px solid var(--at-border-accent);
                    border-radius: 22px;
                    padding: 20px 26px;
                    z-index: 2147483647;
                    display: flex;
                    align-items: center;
                    gap: 18px;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    box-shadow:
                        var(--at-shadow-3d),
                        0 0 0 1px var(--at-inset-top) inset,
                        0 -1px 2px var(--at-inset-bottom) inset,
                        0 1px 0 var(--at-inset-top) inset;
                    opacity: 0;
                    animation: atNotifIn .6s cubic-bezier(.16,1.11,.3,1) forwards, atNotifOut .4s cubic-bezier(.4,0,1,1) 4s forwards;
                    user-select: none;
                    max-width: 340px;
                    overflow: hidden;
                    transform-style: preserve-3d;
                }
                #anime-tracker-notification * { user-select: none; font-family: inherit }
                
                /* Shine sweep */
                .at-notif-shine {
                    position: absolute;
                    top: 0; left: -100%; width: 50%; height: 100%;
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent);
                    animation: atShineSweep2 4s ease-in-out 0.5s infinite;
                    pointer-events: none;
                }
                
                /* Auto-dismiss progress bar */
                .at-notif-progress {
                    position: absolute;
                    bottom: 0; left: 0;
                    height: 2px;
                    background: var(--at-accent-complete-gradient);
                    border-radius: 0 0 22px 22px;
                    animation: atProgress 4s linear forwards;
                    opacity: 0.6;
                }
                
                .at-notif-icon-wrap {
                    width: 52px; height: 52px;
                    background: var(--at-bg-accent-complete);
                    border-radius: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow:
                        var(--at-shadow-accent-complete),
                        0 1px 0 rgba(255,255,255,0.08) inset;
                    position: relative;
                    flex-shrink: 0;
                }
                .at-notif-icon-ring {
                    position: absolute;
                    inset: -4px;
                    border-radius: 20px;
                    border: 2px solid rgba(76, 175, 130, 0.15);
                    animation: atRingPulse 2s ease-in-out infinite;
                }
                .at-notif-icon { width: 28px; height: 28px; filter: var(--at-glow-complete) }
                
                .at-notif-text { display: flex; flex-direction: column; gap: 3px; position: relative; z-index: 1 }
                .at-notif-text strong {
                    font-size: 15px; font-weight: 800; letter-spacing: -.3px;
                    background: linear-gradient(135deg, #66bb9a, #4caf82);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                .at-notif-text span {
                    color: var(--at-text-primary); font-size: 14px; font-weight: 500;
                    max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                }
                .at-notif-text .at-notif-ep { color: var(--at-text-dark); font-size: 12.5px; font-weight: 400 }
                
                @keyframes atNotifIn {
                    0% { opacity: 0; transform: perspective(800px) rotateY(-5deg) translateX(40px) scale(.9) }
                    100% { opacity: 1; transform: perspective(800px) rotateY(0deg) translateX(0) scale(1) }
                }
                @keyframes atNotifOut {
                    0% { opacity: 1; transform: perspective(800px) rotateY(0deg) scale(1) }
                    100% { opacity: 0; transform: perspective(800px) rotateY(5deg) translateX(30px) scale(.9) }
                }
                @keyframes atRingPulse {
                    0%, 100% { transform: scale(1); opacity: 1 }
                    50% { transform: scale(1.06); opacity: 0.5 }
                }
                @keyframes atShineSweep2 {
                    0%, 100% { left: -100% }
                    50% { left: 200% }
                }
                @keyframes atProgress {
                    0% { width: 100% }
                    100% { width: 0% }
                }
            `
        });
        (doc.head || doc.documentElement).appendChild(style);
    }
};

// Export
window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.Notifications = Notifications;

// ── DEV TEST BRIDGE ──────────────────────────────────────────────────────────
document.addEventListener('__at_test_complete', (e) => {
    Notifications.showCompletion(e.detail);
});
document.addEventListener('__at_test_resume', (e) => {
    Notifications.showResumePrompt(
        e.detail,
        () => {},
        () => {}
    );
});
