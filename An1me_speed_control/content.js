// --- Is the script inside an iframe? ---
const isInIframe = window.self !== window.top;

let currentSpeed = null; // Boost speed from popup
let isF7Active = false;
let isF8Active = false;
let f8PreviousSpeed = 1; // Speed before F8 was turned ON
let savedDefaultSpeed = 1; // User's preferred default speed (not boost)
let savedDefaultVolume = 1; // Saved volume level (0..1)
let savedMutedState = false; // Saved mute state

function normalizeVolume(value) {
    const n = Number(value);
    if (Number.isNaN(n)) return 1;
    return Math.min(1, Math.max(0, n));
}

// Get boost speed and default speed from storage
function updateSpeedFromStorage() {
    chrome.storage.local.get(['selectedSpeed', 'defaultSpeed', 'defaultVolume', 'defaultVolumePercent', 'defaultMuted'], function(result) {
        currentSpeed = result.selectedSpeed ? Number(result.selectedSpeed) : 4;
        if (result.defaultSpeed) {
            savedDefaultSpeed = Number(result.defaultSpeed);
            f8PreviousSpeed = savedDefaultSpeed;
        }
        if (result.defaultVolume !== undefined) {
            savedDefaultVolume = normalizeVolume(result.defaultVolume);
        } else if (result.defaultVolumePercent !== undefined) {
            savedDefaultVolume = normalizeVolume(Number(result.defaultVolumePercent) / 100);
        }
        if (result.defaultMuted !== undefined) {
            savedMutedState = Boolean(result.defaultMuted);
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
    if (area === "local" && (changes.defaultVolume || changes.defaultVolumePercent || changes.defaultMuted)) {
        const video = document.querySelector('video');
        if (!video) return;

        if (changes.defaultVolume || changes.defaultVolumePercent) {
            const newVolume = changes.defaultVolume
                ? normalizeVolume(changes.defaultVolume.newValue)
                : normalizeVolume(Number(changes.defaultVolumePercent.newValue) / 100);
            savedDefaultVolume = newVolume;
            if (Math.abs(video.volume - newVolume) > 0.01) {
                video.volume = newVolume;
            }
        }
        if (changes.defaultMuted) {
            const newMuted = Boolean(changes.defaultMuted.newValue);
            savedMutedState = newMuted;
            if (video.muted !== newMuted) {
                video.muted = newMuted;
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

    // Apply saved volume + mute state when video is ready
    function applyDefaultVolumeState() {
        chrome.storage.local.get(['defaultVolume', 'defaultVolumePercent', 'defaultMuted'], function(result) {
            let volume = savedDefaultVolume;
            if (result.defaultVolume !== undefined) {
                volume = normalizeVolume(result.defaultVolume);
            } else if (result.defaultVolumePercent !== undefined) {
                volume = normalizeVolume(Number(result.defaultVolumePercent) / 100);
            }
            savedDefaultVolume = volume;
            if (Math.abs(video.volume - volume) > 0.01) {
                video.volume = volume;
            }
            if (result.defaultMuted !== undefined) {
                const muted = Boolean(result.defaultMuted);
                savedMutedState = muted;
                if (video.muted !== muted) {
                    video.muted = muted;
                }
            }
        });
    }

    function saveDefaultVolumeState() {
        const currentVolume = normalizeVolume(video.volume);
        const muted = Boolean(video.muted);
        if (!muted && currentVolume > 0) {
            savedDefaultVolume = currentVolume;
        }
        const volumeToStore = muted ? savedDefaultVolume : currentVolume;
        savedMutedState = muted;
        const volumePercent = Math.round(volumeToStore * 100);
        chrome.storage.local.set({
            'defaultVolume': volumeToStore,
            'defaultVolumePercent': volumePercent,
            'defaultMuted': muted
        });
    }

    // Apply multiple times to ensure player UI doesn't overwrite saved values
    function applyDefaultStateMultipleTimes() {
        applyDefaultSpeed();
        applyDefaultVolumeState();
        setTimeout(() => {
            applyDefaultSpeed();
            applyDefaultVolumeState();
        }, 500);
        setTimeout(() => {
            applyDefaultSpeed();
            applyDefaultVolumeState();
        }, 1000);
        setTimeout(() => {
            applyDefaultSpeed();
            applyDefaultVolumeState();
        }, 2000);
    }

    // Apply when video can play
    if (video.readyState >= 1) {
        applyDefaultStateMultipleTimes();
    }
    video.addEventListener('loadedmetadata', applyDefaultStateMultipleTimes, { once: true });
    video.addEventListener('canplay', applyDefaultStateMultipleTimes, { once: true });
    video.addEventListener('playing', applyDefaultStateMultipleTimes, { once: true });

    video.addEventListener('volumechange', function() {
        clearTimeout(video._volumeSaveTimer);
        video._volumeSaveTimer = setTimeout(saveDefaultVolumeState, 100);
    });

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
function showHint(_msg) {
    const container = getContainer();
    document.getElementById("speed-hint-msg")?.remove();

    const div = document.createElement("div");
    div.id = "speed-hint-msg";
    div.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:center; gap:8px; color:#f0f4ff; font:700 clamp(13px, 1.35vw, 16px)/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; text-align:center;">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 50 50" style="flex:0 0 auto; filter:drop-shadow(0 2px 5px rgba(74,129,255,0.45));">
                <path fill="#cfe1ff" d="M 14.78125 5 C 14.75 5.007813 14.71875 5.019531 14.6875 5.03125 C 14.644531 5.050781 14.601563 5.070313 14.5625 5.09375 C 14.550781 5.09375 14.542969 5.09375 14.53125 5.09375 C 14.511719 5.101563 14.488281 5.113281 14.46875 5.125 C 14.457031 5.136719 14.449219 5.144531 14.4375 5.15625 C 14.425781 5.167969 14.417969 5.175781 14.40625 5.1875 C 14.375 5.207031 14.34375 5.226563 14.3125 5.25 C 14.289063 5.269531 14.269531 5.289063 14.25 5.3125 C 14.238281 5.332031 14.226563 5.355469 14.21875 5.375 C 14.183594 5.414063 14.152344 5.457031 14.125 5.5 C 14.113281 5.511719 14.105469 5.519531 14.09375 5.53125 C 14.09375 5.542969 14.09375 5.550781 14.09375 5.5625 C 14.082031 5.582031 14.070313 5.605469 14.0625 5.625 C 14.050781 5.636719 14.042969 5.644531 14.03125 5.65625 C 14.03125 5.675781 14.03125 5.699219 14.03125 5.71875 C 14.019531 5.757813 14.007813 5.800781 14 5.84375 C 14 5.875 14 5.90625 14 5.9375 C 14 5.949219 14 5.957031 14 5.96875 C 14 5.980469 14 5.988281 14 6 C 13.996094 6.050781 13.996094 6.105469 14 6.15625 L 14 39 C 14.003906 39.398438 14.242188 39.757813 14.609375 39.914063 C 14.972656 40.070313 15.398438 39.992188 15.6875 39.71875 L 22.9375 32.90625 L 28.78125 46.40625 C 28.890625 46.652344 29.09375 46.847656 29.347656 46.941406 C 29.601563 47.035156 29.882813 47.023438 30.125 46.90625 L 34.5 44.90625 C 34.996094 44.679688 35.21875 44.09375 35 43.59375 L 28.90625 30.28125 L 39.09375 29.40625 C 39.496094 29.378906 39.84375 29.113281 39.976563 28.730469 C 40.105469 28.347656 39.992188 27.921875 39.6875 27.65625 L 15.84375 5.4375 C 15.796875 5.378906 15.746094 5.328125 15.6875 5.28125 C 15.648438 5.234375 15.609375 5.195313 15.5625 5.15625 C 15.550781 5.15625 15.542969 5.15625 15.53125 5.15625 C 15.511719 5.132813 15.492188 5.113281 15.46875 5.09375 C 15.457031 5.09375 15.449219 5.09375 15.4375 5.09375 C 15.386719 5.070313 15.335938 5.046875 15.28125 5.03125 C 15.269531 5.03125 15.261719 5.03125 15.25 5.03125 C 15.230469 5.019531 15.207031 5.007813 15.1875 5 C 15.175781 5 15.167969 5 15.15625 5 C 15.136719 5 15.113281 5 15.09375 5 C 15.082031 5 15.074219 5 15.0625 5 C 15.042969 5 15.019531 5 15 5 C 14.988281 5 14.980469 5 14.96875 5 C 14.9375 5 14.90625 5 14.875 5 C 14.84375 5 14.8125 5 14.78125 5 Z M 16 8.28125 L 36.6875 27.59375 L 27.3125 28.40625 C 26.992188 28.4375 26.707031 28.621094 26.546875 28.902344 C 26.382813 29.179688 26.367188 29.519531 26.5 29.8125 L 32.78125 43.5 L 30.21875 44.65625 L 24.21875 30.8125 C 24.089844 30.515625 23.828125 30.296875 23.511719 30.230469 C 23.195313 30.160156 22.863281 30.25 22.625 30.46875 L 16 36.6875 Z"></path>
            </svg>
            <span style="letter-spacing:0.2px;">Click the video to activate speed controls.</span>
        </div>
        <div style="height:1px; margin:8px 0 8px; background:linear-gradient(90deg, rgba(142,166,255,0.14) 0%, rgba(166,188,255,0.5) 50%, rgba(142,166,255,0.14) 100%);"></div>
        <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:8px; color:#f3f6ff;">
            <div style="display:flex; align-items:center; border-radius:12px; overflow:hidden; border:1px solid rgba(87,162,255,0.65); background:linear-gradient(180deg, rgba(38,64,146,0.82) 0%, rgba(24,39,103,0.82) 100%); box-shadow:0 6px 14px rgba(18,34,95,0.45), inset 0 1px 0 rgba(255,255,255,0.22);">
                <span style="display:flex; align-items:center; min-height:38px; padding:0 8px; font:800 clamp(16px, 2vw, 20px)/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; letter-spacing:0.5px; color:#f6f9ff; background:linear-gradient(180deg, #356ae7 0%, #2148bf 100%); text-shadow:0 1px 3px rgba(0,0,0,0.4);">F7</span>
                <span style="display:flex; align-items:center; min-height:38px; padding:0 8px 0 7px; color:#e8efff; font:600 clamp(14px, 1.8vw, 18px)/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; letter-spacing:0.1px;">Hold</span>
            </div>
            <span style="font:500 clamp(14px, 1.8vw, 18px)/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; opacity:0.95;">or</span>
            <div style="display:flex; align-items:center; border-radius:12px; overflow:hidden; border:1px solid rgba(156,126,255,0.68); background:linear-gradient(180deg, rgba(82,58,165,0.84) 0%, rgba(50,37,114,0.84) 100%); box-shadow:0 6px 14px rgba(38,25,86,0.45), inset 0 1px 0 rgba(255,255,255,0.2);">
                <span style="display:flex; align-items:center; min-height:38px; padding:0 8px; font:800 clamp(16px, 2vw, 20px)/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; letter-spacing:0.5px; color:#f6f9ff; background:linear-gradient(180deg, #7857e1 0%, #5739b3 100%); text-shadow:0 1px 3px rgba(0,0,0,0.4);">F8</span>
                <span style="display:flex; align-items:center; min-height:38px; padding:0 8px 0 7px; color:#ece8ff; font:600 clamp(14px, 1.8vw, 18px)/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; letter-spacing:0.1px;">Toggle</span>
            </div>
        </div>
    `;

    div.style.cssText = `
        position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
        width: min(500px, calc(100% - 110px));
        padding: 10px 7px 9px;
        background:
            radial-gradient(120% 160% at 50% -35%, rgba(124, 149, 255, 0.24) 0%, rgba(124, 149, 255, 0) 60%),
            linear-gradient(180deg, #1d2550 0%, #141b3e 100%);
        color: #e0e7ff;
        border-radius: 18px;
        border: 1px solid rgba(123, 155, 255, 0.52);
        box-shadow:
            0 10px 20px rgba(8, 13, 34, 0.48),
            0 0 10px rgba(76, 120, 255, 0.28),
            inset 0 1px 0 rgba(255,255,255,0.2),
            inset 0 -1px 0 rgba(82, 127, 255, 0.35);
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
    }, 3400);
}

