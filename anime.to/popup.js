// Show selected speed as selected button
chrome.storage.local.get(['selectedSpeed'], function(result) {
    let selected = result.selectedSpeed || 4;
    document.querySelectorAll('.speed-btn').forEach(btn => {
        if(Number(btn.dataset.value) === Number(selected)) btn.classList.add('selected');
    });
});

// Speed buttons
document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.onclick = function() {
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        let speed = btn.dataset.value;
        chrome.storage.local.set({'selectedSpeed': speed});

        // Show hint
        const hint = document.getElementById('hint');
        hint.classList.add('show');
        setTimeout(() => hint.classList.remove('show'), 3000);
    };
});

// Donate buttons
document.getElementById('donate-paypal').onclick = function() {
    window.open('https://www.paypal.me/ThomasThanos', '_blank');
};
document.getElementById('donate-revolut').onclick = function() {
    window.open('https://revolut.me/thomas2873', '_blank');
};
