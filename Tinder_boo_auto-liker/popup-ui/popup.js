document.addEventListener('DOMContentLoaded', function() {
    const toggleButton = document.getElementById('toggleButton');
    const buttonText = document.getElementById('buttonText');
    const likeCount = document.getElementById('likeCount');
    const statusDot = document.getElementById('statusDot');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');

    // Get initial status
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const tab = tabs[0];
        if (!tab) return;
        chrome.tabs.sendMessage(tab.id, {action: 'getStatus'}, function(response) {
            if (chrome.runtime.lastError || !response) return; // content script not ready yet
            updateUI(response);
        });
    });

    // Set up live updates
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        if (request.action === 'liveUpdate') {
            updateUI({
                count: request.count,
                isActive: request.isActive
            });
        }
    });

    // Toggle button click
    toggleButton.addEventListener('click', function() {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            const tab = tabs[0];
            if (!tab) return;

            // Try to send message; if content script not injected, inject it first
            chrome.tabs.sendMessage(tab.id, {action: 'toggle'}, function(response) {
                if (chrome.runtime.lastError) {
                    // Content script not present — inject it then toggle
                    chrome.scripting.executeScript({
                        target: {tabId: tab.id},
                        files: ['content.js']
                    }, function() {
                        if (chrome.runtime.lastError) {
                            console.warn('Could not inject content script:', chrome.runtime.lastError.message);
                            return;
                        }
                        setTimeout(function() {
                            chrome.tabs.sendMessage(tab.id, {action: 'toggle'});
                        }, 300);
                    });
                }
            });
        });
    });

    function updateUI(data) {
        // Update like count
        likeCount.textContent = data.count;
        
        // Update progress
        const progress = (data.count % 100);
        progressFill.style.width = `${progress}%`;
        progressText.textContent = `${progress}%`;
        
        // Update status
        if (data.isActive) {
            statusDot.className = 'dot on';
            buttonText.textContent = 'Stop Auto Like';
            toggleButton.classList.add('active');
        } else {
            statusDot.className = 'dot off';
            buttonText.textContent = 'Start Auto Like';
            toggleButton.classList.remove('active');
        }
    }
});