let intervalId = null;
let likeCount = 0;
let failCount = 0;
const maxFails = 4;
let container = null;

// UI Elements
let ring, button, counter, status;

function clickLikeButton() {
    // Check if we're on Tinder or Boo
    const isOnBoo = location.hostname.includes('boo.world');
    const isOnTinder = location.hostname.includes('tinder.com');
    
    if (!isOnBoo && !isOnTinder) {
        console.log('🌐 Δεν είσαι σε Tinder ή Boo');
        autoPause();
        return;
    }

    let likeBtn = null;

    if (isOnBoo) {
        const candidates = [...document.querySelectorAll('div.cursor-pointer')];
        likeBtn = candidates.find(div =>
            div.querySelector('canvas[width="48"][height="48"]')
        );
    } else {
        // Enhanced Tinder like button detection
        const allButtons = [...document.querySelectorAll('button')];
        const potentialLikeButtons = allButtons.filter(btn => {
            const className = btn.className || '';
            return className.includes('gamepad-button') && 
                   className.includes('Bgc($c-ds-background-gamepad-sparks-like-default)') &&
                   !btn.disabled;  // Skip disabled buttons (loading state)
        });

        if (potentialLikeButtons.length > 0) {
            likeBtn = potentialLikeButtons[0];
        }
    }

    if (likeBtn) {
        likeBtn.click();
        likeCount++;
        failCount = 0;
        updateUI();
        
        chrome.runtime.sendMessage({
                    action: "updateCount",
                    count: likeCount,
                    isActive: intervalId !== null
                }).catch(() => {});
    } else {
        // No like button found yet.
        // Only NOW check aria-busy, scoped to the case where the button is missing:
        // if the profile/card is still loading, wait without counting it as a failure.
        const busyEl = document.querySelector('[aria-busy="true"]');
        if (busyEl) {
            console.log('⏳ Περιμένει να φορτώσει το προφίλ...');
            return;
        }

        // Check for "It's a Match" screen (no role="dialog", just a styled div)
        const matchScreen = document.querySelector('div[class*="its-a-match-gradient"]');
        if (matchScreen) {
            const backBtn = document.querySelector('button[title="Back to Tinder"]');
            if (backBtn) {
                backBtn.click();
                console.log('💚 Match screen dismissed - συνεχίζει...');
                failCount = 0;
                return;
            }
        }

        failCount++;
        console.log(`⏳ Περιμένει να φορτώσει... (${failCount}/${maxFails})`);
        if (failCount >= maxFails) autoPause();
    }
}

function toggleAutoLike() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        updateButtonState();
        console.log('⏹️ Auto Like σταμάτησε');
    } else {
        intervalId = setInterval(clickLikeButton, 3000);
        updateButtonState();
        console.log('▶️ Auto Like ξεκίνησε');
    }
    
    chrome.runtime.sendMessage({
                action: "updateCount",
                count: likeCount,
                isActive: intervalId !== null
            }).catch(() => {});
}

function autoPause() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        failCount = 0; // Reset fail count when pausing
        updateButtonState();
        console.log('⏸️ Auto Like έκανε pause λόγω overlay ή αποτυχιών');
        
        chrome.runtime.sendMessage({
                    action: "updateCount",
                    count: likeCount,
                    isActive: false
                }).catch(() => {});
    }
}

function updateUI() {
    if (counter) counter.textContent = `${likeCount}`;
    updateRing();
    updateButtonState();
}

function updateRing() {
    if (!ring) return;
    const percent = (likeCount % 100) / 100;
    ring.style.strokeDashoffset = 314 - (314 * percent);
    ring.style.stroke = 'url(#desireGradient)';
    ring.style.opacity = intervalId ? '1' : '0.5';
}

function updateButtonState() {
    if (!button || !status) return;
    if (intervalId) {
        button.classList.add('active');
        button.classList.remove('paused');
        status.textContent = failCount > 0 ? 'WAIT' : 'ON';
    } else if (failCount >= maxFails) {
        button.classList.add('paused');
        button.classList.remove('active');
        status.textContent = 'PAUSED';
    } else {
        button.classList.remove('active', 'paused');
        status.textContent = 'OFF';
    }
}

function createSexyUI() {
    if (container && document.body.contains(container)) return;
    if (container) container.remove();
    if (!document.body) {
        setTimeout(createSexyUI, 200);
        return;
    }
    console.log('🎨 Creating UI on', location.href);

    // Main container with seductive curves
    container = document.createElement('div');
    Object.assign(container.style, {
        position: 'fixed',
        bottom: '40px',
        right: '40px',
        zIndex: '9999',
        width: '150px',
        height: '180px',
        display: 'block',
        filter: 'drop-shadow(0 0 20px rgba(255, 105, 180, 0.6))'
    });

    // SVG with sensual curves and luxurious gradients
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '150');
    svg.setAttribute('height', '180');
    svg.innerHTML = `
        <defs>
            <linearGradient id="passionGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#ff1493" />
                <stop offset="50%" stop-color="#ff69b4" />
                <stop offset="100%" stop-color="#ffb6c1" />
            </linearGradient>
            <linearGradient id="desireGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#8b008b" />
                <stop offset="100%" stop-color="#ff00ff" />
            </linearGradient>
            <filter id="sensualGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <path id="curvePath" d="M0,90 Q75,180 150,90" fill="none" />
        </defs>
        
        <!-- Sensual curved background -->
        <path d="M0,180 C50,100 100,120 150,180 L150,0 C100,60 50,40 0,0 Z" 
              fill="rgba(139, 0, 139, 0.2)" />
        
        <!-- Progress ring with seductive curve -->
        <circle cx="75" cy="100" r="60" fill="none" stroke="rgba(139, 0, 139, 0.3)" stroke-width="12" />
        <circle id="ring" cx="75" cy="100" r="60" stroke="url(#desireGradient)" stroke-width="12" fill="none"
                stroke-linecap="round" stroke-dasharray="377" stroke-dashoffset="377" 
                transform="rotate(-90 75 100)" filter="url(#sensualGlow)" />
    `;
    container.appendChild(svg);
    ring = svg.querySelector('#ring');

    // Heart button with pulsating desire effect
    button = document.createElement('div');
    button.title = 'Auto Love';
    button.innerHTML = `
        <svg width="80" height="80" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 21.35L10.55 20.03C5.4 15.36 2 12.28 2 8.5C2 5.42 4.42 3 7.5 3C9.24 3 10.91 3.81 12 5.09C13.09 3.81 14.76 3 16.5 3C19.58 3 22 5.42 22 8.5C22 12.28 18.6 15.36 13.45 20.03L12 21.35Z" 
                  fill="url(#passionGradient)" filter="url(#sensualGlow)" />
        </svg>
    `;
    Object.assign(button.style, {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '100px',
        height: '100px',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        background: 'radial-gradient(circle, rgba(255,20,147,0.3) 0%, rgba(139,0,139,0.5) 100%)',
        boxShadow: '0 0 30px #ff1493, 0 0 60px #ff69b4, inset 0 0 25px #ffb6c1',
        transition: 'all 0.5s cubic-bezier(0.39, 0.58, 0.57, 1)',
        userSelect: 'none',
        animation: 'heartbeat 1.5s infinite alternate'
    });
    container.appendChild(button);

    // Lover's counter with elegant script font
    counter = document.createElement('div');
    counter.textContent = '0';
    counter.className = 'lovers-counter';
    Object.assign(counter.style, {
        position: 'absolute',
        top: '0px',
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: '26px',
        fontWeight: 'bold',
        color: '#ff69b4',
        textShadow: '0 0 15px #ff69b4, 0 0 30px #ff1493',
        background: 'rgba(139, 0, 139, 0.7)',
        padding: '8px 20px',
        borderRadius: '30px',
        boxShadow: '0 0 25px #ff69b4, inset 0 0 15px #ff1493',
        border: '2px solid #ff69b4',
        fontFamily: '"Great Vibes", cursive, "Arial", sans-serif',
        letterSpacing: '1px'
    });
    container.appendChild(counter);

    // Seductive status indicator
    status = document.createElement('div');
    status.textContent = 'READY';
    status.className = 'mood-indicator';
    Object.assign(status.style, {
        position: 'absolute',
        bottom: '15px',
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: '14px',
        fontWeight: 'bold',
        color: '#ffb6c1',
        textTransform: 'uppercase',
        letterSpacing: '3px',
        textShadow: '0 0 10px #ff69b4',
        padding: '6px 18px',
        background: 'rgba(139, 0, 139, 0.6)',
        borderRadius: '20px',
        border: '1px solid #ff69b4',
        boxShadow: '0 0 20px #ff1493',
        fontFamily: '"Playfair Display", serif'
    });
    container.appendChild(status);

    button.addEventListener('click', toggleAutoLike);
    
    // Add container to body
    document.body.appendChild(container);
    console.log('✅ UI added');

    // Ultra-sexy styles with romantic animations
    const style = document.createElement('style');
    style.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=Great+Vibes&family=Playfair+Display:wght@500&display=swap');
        
        div[title='Auto Love'] {
            transition: all 0.5s cubic-bezier(0.39, 0.58, 0.57, 1);
        }
        
        div[title='Auto Love']:hover {
            transform: translate(-50%, -50%) scale(1.2) rotate(10deg);
            box-shadow: 0 0 50px #ff1493, 0 0 100px #ff69b4, inset 0 0 35px #ffb6c1;
            animation: none;
        }
        
        .active {
            animation: heartbeatActive 1s infinite alternate, float 4s ease-in-out infinite;
            box-shadow: 0 0 40px #ff1493, 0 0 80px #ff69b4, inset 0 0 30px #ffb6c1;
        }
        
        .paused {
            animation: desirePulse 2s infinite alternate;
            box-shadow: 0 0 30px #8b008b, 0 0 60px #9932cc, inset 0 0 25px #da70d6;
        }
        
        .lovers-counter {
            animation: loversGlow 2s infinite alternate;
        }
        
        .mood-indicator {
            animation: moodSwing 3s infinite;
        }
        
        @keyframes heartbeat {
            0% { transform: translate(-50%, -50%) scale(1); }
            50% { transform: translate(-50%, -50%) scale(1.1); }
            100% { transform: translate(-50%, -50%) scale(1); }
        }
        
        @keyframes heartbeatActive {
            0% { box-shadow: 0 0 40px #ff1493, 0 0 80px #ff69b4, inset 0 0 30px #ffb6c1; }
            50% { box-shadow: 0 0 60px #ff1493, 0 0 120px #ff69b4, inset 0 0 40px #ffb6c1; }
            100% { box-shadow: 0 0 40px #ff1493, 0 0 80px #ff69b4, inset 0 0 30px #ffb6c1; }
        }
        
        @keyframes desirePulse {
            0% { box-shadow: 0 0 30px #8b008b, 0 0 60px #9932cc, inset 0 0 25px #da70d6; }
            100% { box-shadow: 0 0 45px #8b008b, 0 0 90px #9932cc, inset 0 0 35px #da70d6; }
        }
        
        @keyframes float {
            0%, 100% { transform: translate(-50%, -50%) translateY(0px); }
            50% { transform: translate(-50%, -50%) translateY(-15px); }
        }
        
        @keyframes loversGlow {
            0% { text-shadow: 0 0 15px #ff69b4, 0 0 30px #ff1493; }
            100% { text-shadow: 0 0 25px #ff69b4, 0 0 50px #ff1493, 0 0 60px #ff1493; }
        }
        
        @keyframes moodSwing {
            0%, 100% { color: #ffb6c1; transform: translateX(-50%) scale(1); }
            50% { color: #ff69b4; transform: translateX(-50%) scale(1.1); }
        }
        
        /* Curvy decorative elements */
        .container::before {
            content: '';
            position: absolute;
            bottom: -20px;
            left: 50%;
            transform: translateX(-50%);
            width: 120px;
            height: 40px;
            background: rgba(255, 105, 180, 0.2);
            border-radius: 50%;
            filter: blur(15px);
        }
    `;
    document.head.appendChild(style);
}

// Auto-dismiss any dialog modal - language independent
function dismissModals() {
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) return false;

    // 1. Try close button (X) first
    const closeBtn = dialog.querySelector('button.close, button[class*="close"]');
    if (closeBtn) {
        closeBtn.click();
        console.log('✅ Closed modal via close button');
        return true;
    }

    // 2. Try last button (always the dismiss/secondary action in Tinder dialogs)
    const buttons = dialog.querySelectorAll('button');
    if (buttons.length >= 2) {
        const lastBtn = buttons[buttons.length - 1];
        lastBtn.click();
        console.log(`✅ Dismissed modal via last button: "${lastBtn.textContent.trim()}"`);
        return true;
    }

    // 3. Only 1 button (hard paywall) - pause
    return false;
}

// Helper: is an element actually visible on screen?
function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

// Detect and handle "Go Global" modal (out of matches)
function handleGoGlobalModal() {
    // Look for the specific text pattern in any div
    const divs = document.querySelectorAll('div');
    for (const div of divs) {
        if (div.textContent.includes("We've run out of potential matches") || 
            div.textContent.includes("run out of potential matches")) {
            // Guard against hidden/cached copies: only act if it's really on screen
            if (!isVisible(div)) continue;
            console.log('🌍 Detected "out of matches" modal - pausing auto-like');
            autoPause();
            return true;
        }
    }
    return false;
}

// Check for overlay and pause ONLY if dialog cannot be dismissed
function checkOverlay() {
    if (!intervalId) return;

    // Check for Go Global modal first
    if (handleGoGlobalModal()) return;

    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog || getComputedStyle(dialog).display === 'none') return;

    // Try to dismiss first
    if (dismissModals()) return;

    // Only pause for hard paywalls with no dismiss option
    const text = dialog.textContent;
    if (text.includes('Απεριόριστα Like')) {
        autoPause();
    }
}

// Initialize UI with simpler logic
function initUI() {
    if (!container || !document.body.contains(container)) createSexyUI();
}

// Run immediately and on DOM ready
if (document.readyState !== 'loading') initUI();
else document.addEventListener('DOMContentLoaded', initUI);
setTimeout(initUI, 500);

// Observer for SPA navigation
let lastUrl = location.href;
new MutationObserver(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        container = null;
        setTimeout(initUI, 800);
    }
    if (container && !document.body.contains(container)) {
        container = null;
        initUI();
    }
}).observe(document, { subtree: true, childList: true });

// Start overlay check interval
setInterval(() => {
    checkOverlay();
}, 1000);

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggle') {
        toggleAutoLike();
        sendResponse({
            status: intervalId ? 'on' : 'off', 
            count: likeCount
        });
    } else if (request.action === 'getStatus') {
        sendResponse({
            status: intervalId ? 'on' : 'off', 
            count: likeCount
        });
    } else if (request.action === 'forceUI') {
        if (container) container.remove();
        container = null;
        createSexyUI();
    }
});