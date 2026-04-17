document.addEventListener('DOMContentLoaded', function() {
    const toggleButton = document.getElementById('toggleButton');
    const buttonText = document.getElementById('buttonText');
    const likeCount = document.getElementById('likeCount');
    const statusDot = document.getElementById('statusDot');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');

    // Get initial status
    chrome.runtime.sendMessage({action: 'getStatus'}, function(response) {
        updateUI(response);
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
            chrome.tabs.sendMessage(tabs[0].id, {action: 'toggle'});
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