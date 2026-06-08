(function () {
    'use strict';

    // Donate dropdown UI — extracted from popup/main.js.
    // Self-contained: only touches its own DOM nodes (no popup state).
    const AT = (window.AnimeTracker = window.AnimeTracker || {});

    function getSettingsDonateButton() {
        return document.getElementById('settingsDonate');
    }

    function closeDonateDropdown() {
        const donateDropdown = document.getElementById('donateDropdown');
        if (!donateDropdown) return;
        donateDropdown.classList.remove('visible');
        delete donateDropdown.dataset.placement;
    }

    function positionDonateDropdown() {
        const dropdown = document.getElementById('donateDropdown');
        const trigger = getSettingsDonateButton();
        const content = dropdown?.querySelector('.donate-dropdown-content');
        if (!dropdown || !trigger || !content) return;

        const triggerRect = trigger.getBoundingClientRect();
        const dropdownWidth = Math.ceil(content.offsetWidth || 220);
        const dropdownHeight = Math.ceil(content.offsetHeight || 132);
        const gap = 8;
        const viewportPadding = 10;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left = triggerRect.right - dropdownWidth;
        left = Math.max(viewportPadding, Math.min(left, viewportWidth - dropdownWidth - viewportPadding));

        let top = triggerRect.top - dropdownHeight - gap;
        let placement = 'above';

        if (top < viewportPadding) {
            top = Math.min(triggerRect.bottom + gap, viewportHeight - dropdownHeight - viewportPadding);
            placement = 'below';
        }

        const arrowOffset = triggerRect.left + (triggerRect.width / 2) - left;
        const clampedArrow = Math.max(22, Math.min(arrowOffset, dropdownWidth - 22));

        dropdown.style.left = `${Math.round(left)}px`;
        dropdown.style.top = `${Math.round(top)}px`;
        dropdown.style.setProperty('--donate-arrow-offset', `${Math.round(clampedArrow)}px`);
        dropdown.dataset.placement = placement;
    }

    function openDonateDropdown() {
        const donateDropdown = document.getElementById('donateDropdown');
        if (!donateDropdown || !getSettingsDonateButton()) return;
        positionDonateDropdown();
        donateDropdown.classList.add('visible');
        requestAnimationFrame(positionDonateDropdown);
    }

    AT.DonateDropdown = {
        open: openDonateDropdown,
        close: closeDonateDropdown,
        position: positionDonateDropdown,
        getButton: getSettingsDonateButton
    };
})();
