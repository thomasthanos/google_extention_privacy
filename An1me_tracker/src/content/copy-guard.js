(function () {
    'use strict';

    const ROOT = document.documentElement;
    const STYLE_ID = 'anime-tracker-copy-guard-style';
    const STORAGE_KEY = 'copyGuardEnabled';
    // Allowed-selector list intentionally combines:
    //   1. Current Tailwind utility combos used on an1me.to synopsis blocks
    //      (most precise — but brittle if the site re-themes).
    //   2. A semantic fallback (`[data-at-allow-copy]`) so we can mark
    //      elements explicitly without relying on Tailwind.
    //   3. A loose `.line-clamp-2` fallback that still scopes to truncated
    //      text blocks — wide enough to keep working through minor markup
    //      tweaks, narrow enough not to allow whole-page copying.
    // A self-test on install warns if zero matches are found, so we notice
    // when the site's structure has drifted before users do.
    const ALLOWED_SELECTORS = [
        '[data-at-allow-copy]',
        '.group-data-\\[language\\=jp\\]\\/body\\:hidden.line-clamp-2.leading-relaxed',
        '.line-clamp-2.leading-relaxed',
        '.group-data-\\[language\\=jp\\]\\/body\\:hidden',
        '.line-clamp-2'
    ];
    const ALLOWED_SELECTOR = ALLOWED_SELECTORS.join(', ');
    const EDITABLE_SELECTOR = 'input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';
    let enabled = true;
    let styleObserver = null;
    let _selectorAuditDone = false;

    function getElement(target) {
        if (!target) return null;
        if (target.nodeType === Node.ELEMENT_NODE) return target;
        if (target.nodeType === Node.TEXT_NODE) return target.parentElement;
        return null;
    }

    function isEditableElement(element) {
        return !!(element && element.closest(EDITABLE_SELECTOR));
    }

    function isAllowedElement(element) {
        return !!(element && element.closest(ALLOWED_SELECTOR));
    }

    function isAllowedSelection() {
        const selection = window.getSelection ? window.getSelection() : null;
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
            return false;
        }

        const range = selection.getRangeAt(0);
        const commonAncestor = getElement(range.commonAncestorContainer);
        if (!commonAncestor || !isAllowedElement(commonAncestor)) {
            return false;
        }

        const anchorElement = getElement(selection.anchorNode);
        const focusElement = getElement(selection.focusNode);
        return isAllowedElement(anchorElement) && isAllowedElement(focusElement);
    }

    function shouldAllow(target) {
        const element = getElement(target);
        return isEditableElement(element) || isAllowedElement(element) || isAllowedSelection();
    }

    function ensureStyle() {
        if (!enabled) return;
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            html body, html body * {
                user-select: none !important;
                -webkit-user-select: none !important;
                -moz-user-select: none !important;
                -ms-user-select: none !important;
                -webkit-touch-callout: none !important;
            }

            html body ${ALLOWED_SELECTOR},
            html body ${ALLOWED_SELECTOR} *,
            html body ${EDITABLE_SELECTOR},
            html body ${EDITABLE_SELECTOR} * {
                user-select: text !important;
                -webkit-user-select: text !important;
                -moz-user-select: text !important;
                -ms-user-select: text !important;
                -webkit-touch-callout: default !important;
            }

            html body img,
            html body video,
            html body a {
                -webkit-user-drag: none !important;
                user-drag: none !important;
            }
        `;

        (document.head || ROOT || document.documentElement).appendChild(style);
    }

    function removeStyle() {
        const style = document.getElementById(STYLE_ID);
        if (style) style.remove();
    }

    function blockEvent(event) {
        if (!enabled) return;
        if (shouldAllow(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    let _ensureStylePending = false;
    let _lastEnsureStyleAt = 0;
    function scheduleEnsureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const now = Date.now();
        if (now - _lastEnsureStyleAt < 2000) {
            if (_ensureStylePending) return;
            _ensureStylePending = true;
            setTimeout(() => {
                _ensureStylePending = false;
                _lastEnsureStyleAt = Date.now();
                ensureStyle();
            }, 2000 - (now - _lastEnsureStyleAt));
            return;
        }
        _lastEnsureStyleAt = now;
        ensureStyle();
    }

    function setEnabled(nextEnabled) {
        enabled = nextEnabled !== false;
        if (enabled) {
            ensureStyle();
            _lastEnsureStyleAt = Date.now();
            if (!styleObserver) {
                styleObserver = new MutationObserver(scheduleEnsureStyle);
                styleObserver.observe(document.head || ROOT, { childList: true, subtree: false });
            }
            return;
        }

        removeStyle();
        if (styleObserver) {
            styleObserver.disconnect();
            styleObserver = null;
        }
    }

    function auditSelectorsOnce() {
        if (_selectorAuditDone) return;
        // Defer one tick so DOM has rendered most of the synopsis blocks
        // before we count matches. document_start scripts otherwise audit
        // an empty page and false-alarm.
        const run = () => {
            _selectorAuditDone = true;
            try {
                const matches = document.querySelectorAll(ALLOWED_SELECTOR).length;
                if (matches === 0 && document.body) {
                    // Surface the regression in the console so developers
                    // notice copy-guard is now blocking everything (or letting
                    // everything through, depending on user perspective)
                    // because the site's markup drifted away from our
                    // hardcoded selectors.
                    console.warn(
                        '[CopyGuard] No allowed-copy elements matched on this page — ' +
                        'an1me.to markup may have changed. Consider updating ALLOWED_SELECTORS in ' +
                        'src/content/copy-guard.js or marking allowed elements with data-at-allow-copy.'
                    );
                }
            } catch {}
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => setTimeout(run, 1500), { once: true });
        } else {
            setTimeout(run, 1500);
        }
    }

    function install() {
        document.addEventListener('copy', blockEvent, true);
        document.addEventListener('cut', blockEvent, true);
        document.addEventListener('selectstart', blockEvent, true);
        document.addEventListener('dragstart', blockEvent, true);
        document.addEventListener('contextmenu', blockEvent, true);
        setEnabled(true);
        auditSelectorsOnce();

        chrome.storage.local.get([STORAGE_KEY], (result) => {
            if (chrome.runtime.lastError) return;
            setEnabled(result[STORAGE_KEY] !== false);
        });

        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local' || !changes[STORAGE_KEY]) return;
            setEnabled(changes[STORAGE_KEY].newValue !== false);
        });
    }

    install();
})();