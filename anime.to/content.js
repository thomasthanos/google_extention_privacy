// --- Is the script inside an iframe? ---
const isInIframe = window.self !== window.top;

let currentSpeed = null; // Boost speed from popup
let isF7Active = false;
let isF8Active = false;
let f8PreviousSpeed = 1; // Speed before F8 was turned ON
let savedDefaultSpeed = 1; // User's preferred default speed (not boost)

// Get boost speed and default speed from storage
function updateSpeedFromStorage() {
    chrome.storage.local.get(['selectedSpeed', 'defaultSpeed'], function(result) {
        currentSpeed = result.selectedSpeed ? Number(result.selectedSpeed) : 4;
        if (result.defaultSpeed) {
            savedDefaultSpeed = Number(result.defaultSpeed);
            f8PreviousSpeed = savedDefaultSpeed;
        }
    });
}
updateSpeedFromStorage();

// Save default speed to storage
function saveDefaultSpeed(speed, showNotification = false) {
    // Only save normal speeds (not boost speeds)
    if (speed > 0 && speed <= 2) {
        savedDefaultSpeed = speed;
        f8PreviousSpeed = speed;
        chrome.storage.local.set({ 'defaultSpeed': speed }, function() {
            // Verify it was saved
            chrome.storage.local.get(['defaultSpeed'], function(result) {
                if (showNotification && result.defaultSpeed) {
                    showBadge(`Saved ${result.defaultSpeed}x`);
                }
            });
        });
    }
}

// Listen for storage changes (works across iframes)
chrome.storage.onChanged.addListener(function(changes, area) {
    if (area === "local" && changes.selectedSpeed) {
        currentSpeed = Number(changes.selectedSpeed.newValue);
        // Show hint only in iframe with video
        if (isInIframe && document.querySelector('video')) {
            showHint("Press F7 (hold) or F8 (toggle) to boost speed");
        }
    }
    if (area === "local" && changes.defaultSpeed) {
        const newSpeed = Number(changes.defaultSpeed.newValue);
        savedDefaultSpeed = newSpeed;
        f8PreviousSpeed = newSpeed;
        // Apply to video immediately when storage changes
        if (!isF7Active && !isF8Active) {
            const video = document.querySelector('video');
            if (video && newSpeed !== 1) {
                video.playbackRate = newSpeed;
            }
        }
    }
});

// Setup videos
function setupVideo(video) {
    if (video._setup) return;
    video._setup = true;
    video.setAttribute('tabindex', 0);

    // Apply saved default speed when video is ready
    function applyDefaultSpeed() {
        if (isF7Active || isF8Active) return;
        // Read fresh from storage to ensure we have latest value
        chrome.storage.local.get(['defaultSpeed'], function(result) {
            if (result.defaultSpeed) {
                const speed = Number(result.defaultSpeed);
                if (speed !== 1 && !isF7Active && !isF8Active) {
                    video.playbackRate = speed;
                    savedDefaultSpeed = speed;
                    f8PreviousSpeed = speed;
                }
            }
        });
    }

    // Apply multiple times to ensure it sticks
    function applySpeedMultipleTimes() {
        applyDefaultSpeed();
        setTimeout(applyDefaultSpeed, 500);
        setTimeout(applyDefaultSpeed, 1000);
        setTimeout(applyDefaultSpeed, 2000);
    }

    // Apply when video can play
    if (video.readyState >= 1) {
        applySpeedMultipleTimes();
    }
    video.addEventListener('loadedmetadata', applySpeedMultipleTimes, { once: true });
    video.addEventListener('canplay', applySpeedMultipleTimes, { once: true });
    video.addEventListener('playing', applyDefaultSpeed, { once: true });

}

// Watch for ArtPlayer speed setting clicks
function setupArtPlayerWatcher() {
    // Use capturing phase to catch click before ArtPlayer handles it
    document.addEventListener('click', function(e) {
        // Check if clicked on ArtPlayer playback rate setting
        const settingItem = e.target.closest('.art-setting-item[data-name^="playback-rate"]');
        if (settingItem && !isF7Active && !isF8Active) {
            const value = settingItem.dataset.value;
            if (value) {
                const speed = Number(value);
                // Small delay to let ArtPlayer apply the speed first
                setTimeout(() => {
                    saveDefaultSpeed(speed, true); // true = show notification
                }, 100);
            }
        }
    }, true);
}
setupArtPlayerWatcher();

const observer = new MutationObserver(() => {
    document.querySelectorAll('video').forEach(setupVideo);
});
observer.observe(document.body, { childList: true, subtree: true });
document.querySelectorAll('video').forEach(setupVideo);

// Get overlay container
function getContainer() {
    return document.querySelector('.plyr__video-wrapper') ||
           document.querySelector('video')?.parentElement ||
           document.body;
}

// F7 - Hold to boost
document.addEventListener('keydown', function(e) {
    if (e.key === "F7" && !isF7Active) {
        isF7Active = true;
        const video = document.querySelector('video');
        if (video) {
            // Store current speed before changing (use savedDefaultSpeed if available)
            if (!isF8Active) {
                f8PreviousSpeed = savedDefaultSpeed !== 1 ? savedDefaultSpeed : video.playbackRate;
            }
            video.playbackRate = currentSpeed || 4;
            showBadge(`${currentSpeed || 4}x`);
        }
    }

    if (e.key === "F8") {
        e.preventDefault();
        const video = document.querySelector('video');
        if (!video) return;

        if (isF8Active) {
            // Turn OFF - go back to saved default speed
            isF8Active = false;
            video.playbackRate = f8PreviousSpeed;
            showBadge(`${f8PreviousSpeed}x`);
        } else {
            // Turn ON - use saved default speed as previous, then boost
            f8PreviousSpeed = savedDefaultSpeed !== 1 ? savedDefaultSpeed : video.playbackRate;
            isF8Active = true;
            video.playbackRate = currentSpeed || 4;
            showBadge(`BOOST ${currentSpeed || 4}x`);
        }
    }
});

document.addEventListener('keyup', function(e) {
    if (e.key === "F7" && isF7Active) {
        isF7Active = false;
        const video = document.querySelector('video');
        if (video) {
            // Return to saved default speed
            video.playbackRate = f8PreviousSpeed;
            showBadge(`${f8PreviousSpeed}x`);
        }
    }
});

// Badge
function showBadge(msg) {
    const container = getContainer();
    let badge = document.getElementById("speed-badge-msg");
    if (!badge) {
        badge = document.createElement("div");
        badge.id = "speed-badge-msg";
        container.appendChild(badge);
    }
    badge.textContent = msg;
    badge.style.cssText = `
        position: absolute; top: 16px; left: 16px;
        padding: 6px 14px; background: #1e2033; color: #e0e7ff;
        font: 700 14px -apple-system, sans-serif;
        border-radius: 8px; border: 2px solid #3b82f6;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        z-index: 2147483647; pointer-events: none;
        opacity: 1; transition: opacity 0.3s;
    `;
    if (container.style.position !== "relative" && container !== document.body) {
        container.style.position = "relative";
    }
    clearTimeout(badge._t);
    badge._t = setTimeout(() => {
        badge.style.opacity = 0;
        setTimeout(() => badge?.remove(), 300);
    }, 1500);
}

// Hint
function showHint(msg) {
    const container = getContainer();
    document.getElementById("speed-hint-msg")?.remove();
    const div = document.createElement("div");
    div.id = "speed-hint-msg";
    div.textContent = msg;
    div.style.cssText = `
        position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
        padding: 12px 24px; background: #1e2033; color: #e0e7ff;
        font: 600 15px -apple-system, sans-serif;
        border-radius: 10px; border: 2px solid #3b82f6;
        box-shadow: 0 4px 16px rgba(0,0,0,0.5);
        z-index: 2147483647; pointer-events: none;
        opacity: 1; transition: opacity 0.3s;
    `;
    if (container.style.position !== "relative" && container !== document.body) {
        container.style.position = "relative";
    }
    container.appendChild(div);
    setTimeout(() => {
        div.style.opacity = 0;
        setTimeout(() => div.remove(), 300);
    }, 2500);
}

