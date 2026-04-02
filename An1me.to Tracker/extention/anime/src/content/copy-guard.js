/**
 * Anime Tracker - Copy Guard
 *
 * Blocks text selection/copy across an1me.to except for explicitly allowed
 * content blocks and native editable controls.
 */

(function () {
    'use strict';

    const ROOT = document.documentElement;
    const STYLE_ID = 'anime-tracker-copy-guard-style';
    const STORAGE_KEY = 'copyGuardEnabled';
    const ALLOWED_SELECTORS = [
        '.group-data-\\[language\\=jp\\]\\/body\\:hidden.line-clamp-2.leading-relaxed',
        '.line-clamp-2.leading-relaxed',
        '.group-data-\\[language\\=jp\\]\\/body\\:hidden'
    ];
    const ALLOWED_SELECTOR = ALLOWED_SELECTORS.join(', ');
    const EDITABLE_SELECTOR = 'input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';
    let enabled = true;
    let styleObserver = null;

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

    function setEnabled(nextEnabled) {
        enabled = nextEnabled !== false;
        if (enabled) {
            ensureStyle();
            if (!styleObserver) {
                styleObserver = new MutationObserver(() => {
                    ensureStyle();
                });
                styleObserver.observe(ROOT, { childList: true, subtree: true });
            }
            return;
        }

        removeStyle();
        if (styleObserver) {
            styleObserver.disconnect();
            styleObserver = null;
        }
    }

    function install() {
        document.addEventListener('copy', blockEvent, true);
        document.addEventListener('cut', blockEvent, true);
        document.addEventListener('selectstart', blockEvent, true);
        document.addEventListener('dragstart', blockEvent, true);
        document.addEventListener('contextmenu', blockEvent, true);
        setEnabled(true);

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
