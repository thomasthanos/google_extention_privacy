let intervalId = null;
let likeCount = 0;
let failCount = 0;
const maxFails = 4;
let container = null;

// UI Elements
let ring, button, counter, status;

function clickLikeButton() {
    const isOnBoo = location.hostname.includes('boo.world');
    let likeBtn = null;

    if (isOnBoo) {
        const candidates = [...document.querySelectorAll('div.cursor-pointer')];
        likeBtn = candidates.find(div =>
            div.querySelector('canvas[width="48"][height="48"]')
        );
    } else {
        // Targeted detection for Tinder like button
        const allButtons = [...document.querySelectorAll('button')];
        console.log('All buttons found:', allButtons.length); // Debug: Log total buttons
        const potentialLikeButtons = allButtons.filter(btn =>
            btn.className.includes('gamepad-button') &&
            btn.className.includes('Bgc($c-ds-background-gamepad-sparks-like-default')
        );

        if (potentialLikeButtons.length > 0) {
            likeBtn = potentialLikeButtons[0]; // Take the first matching like button
        }
    }

    if (likeBtn) {
        likeBtn.click();
        likeCount++;
        failCount = 0;
        updateUI();
        console.log(`💥 Like #${likeCount}`);
        
        chrome.runtime.sendMessage({
            action: "updateCount",
            count: likeCount,
            isActive: intervalId !== null
        });
    } else {
        failCount++;
        console.log(`⚠️ Δεν βρέθηκε κουμπί (${failCount}/${maxFails})`);
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
    });
}

function autoPause() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        updateButtonState();
        console.log('⏸️ Auto Like έκανε pause λόγω overlay ή αποτυχιών');
        
        chrome.runtime.sendMessage({
            action: "updateCount",
            count: likeCount,
            isActive: false
        });
    }
}

function updateUI() {
    counter.textContent = `${likeCount}`;
    updateRing();
    updateButtonState();
}

function updateRing() {
    const percent = (likeCount % 100) / 100;
    ring.style.strokeDashoffset = 314 - (314 * percent);
    
    if (intervalId) {
        ring.style.stroke = 'url(#neonGradient)';
    } else {
        ring.style.stroke = 'url(#dimGradient)';
    }
}

function updateButtonState() {
    if (intervalId) {
        button.classList.add('active');
        button.classList.remove('paused');
        status.textContent = 'ON';
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
    if (container) return;

    // Main container with seductive curves
    container = document.createElement('div');
    Object.assign(container.style, {
        position: 'fixed',
        bottom: '40px',
        right: '40px',
        zIndex: '9999',
        width: '150px',
        height: '180px',
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
    document.body.appendChild(container);

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

// Check for overlay and pause if visible
function checkOverlay() {
    const buttons = document.querySelectorAll('[class*="stretchedBox"] button');
    const overlayButton = Array.from(buttons).find(btn => btn.textContent.includes('Συνέχεια'));
    const overlayDiv = Array.from(document.querySelectorAll('div')).find(div => div.textContent.includes('Απεριόριστα Like'));
    const overlay = overlayButton || overlayDiv || document.querySelector('div[role="dialog"]');
    if (overlay && getComputedStyle(overlay).display !== 'none') {
        autoPause();
    }
}

// Initialize when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createSexyUI);
} else {
    createSexyUI();
}

// Start overlay check interval
setInterval(checkOverlay, 1000); // Check every 1 second

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
    }
});