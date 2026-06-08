(function () {
    'use strict';

    window.AnimeTrackerContent = window.AnimeTrackerContent || {};

    // Skiptime helper stylesheet. Pure: depends only on the element id constants.
    window.AnimeTrackerContent.SkiptimeStyles = function (PANEL_ID, TOAST_ID) {
        return `
            #${PANEL_ID} {
                position: relative;
                z-index: 30;
                display: flex;
                align-items: center;
                flex: 0 0 auto;
                margin: 0 8px;
                font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
                color: #fff;
                line-height: 1.35;
                pointer-events: auto;
            }
            #${PANEL_ID}.at-skip-overlay-center {
                position: absolute;
                left: 50%;
                bottom: 8px;
                margin: 0;
                transform: translateX(-50%);
            }
            #${PANEL_ID} * {
                box-sizing: border-box;
            }
            #${PANEL_ID} .at-skip-toggle {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                height: 32px;
                padding: 0 12px;
                border: 1px solid rgba(255, 255, 255, 0.16);
                border-radius: 999px;
                background: linear-gradient(180deg, rgba(20, 24, 34, 0.92), rgba(10, 12, 18, 0.92));
                color: #f8faff;
                cursor: pointer;
                box-shadow: 0 10px 20px rgba(0, 0, 0, 0.25);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                transition: border-color 160ms ease, background 160ms ease, transform 160ms ease, box-shadow 160ms ease;
            }
            #${PANEL_ID} .at-skip-toggle:hover,
            #${PANEL_ID}.is-open .at-skip-toggle {
                transform: translateY(-1px);
                border-color: rgba(255, 186, 222, 0.42);
                background: linear-gradient(180deg, rgba(34, 39, 54, 0.96), rgba(15, 17, 25, 0.96));
                box-shadow: 0 12px 26px rgba(0, 0, 0, 0.32);
            }
            #${PANEL_ID}.is-active .at-skip-toggle {
                border-color: rgba(255, 186, 222, 0.34);
            }
            #${PANEL_ID}.is-complete .at-skip-toggle {
                border-color: rgba(80, 220, 140, 0.55);
                box-shadow: 0 12px 30px rgba(80, 220, 140, 0.18);
            }
            #${PANEL_ID} .at-skip-toggle-dot {
                width: 8px;
                height: 8px;
                border-radius: 999px;
                background: rgba(255, 255, 255, 0.28);
                box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.06);
                transition: background 160ms ease, box-shadow 160ms ease;
                flex: 0 0 auto;
            }
            #${PANEL_ID}.is-active .at-skip-toggle-dot {
                background: #ffbade;
                box-shadow: 0 0 0 4px rgba(255, 186, 222, 0.18);
            }
            #${PANEL_ID}.is-complete .at-skip-toggle-dot {
                background: #78ef9b;
                box-shadow: 0 0 0 4px rgba(120, 239, 155, 0.18);
            }
            #${PANEL_ID} .at-skip-toggle-label {
                font-size: 12px;
                font-weight: 700;
                letter-spacing: 0.02em;
            }
            #${PANEL_ID} .at-skip-toggle-count {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 34px;
                height: 20px;
                padding: 0 7px;
                border-radius: 999px;
                background: rgba(255, 255, 255, 0.09);
                color: rgba(255, 255, 255, 0.92);
                font-size: 10px;
                font-weight: 800;
                font-variant-numeric: tabular-nums;
            }
            #${PANEL_ID} .at-skip-dropdown {
                position: absolute;
                left: 50%;
                bottom: calc(100% + 12px);
                transform: translateX(-50%) translateY(8px);
                width: min(290px, calc(100vw - 24px));
                padding: 12px;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 14px;
                background: rgba(14, 17, 24, 0.96);
                box-shadow: 0 20px 48px rgba(0, 0, 0, 0.42);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                opacity: 0;
                visibility: hidden;
                pointer-events: none;
                transition: opacity 180ms ease, transform 180ms ease, visibility 180ms ease;
            }
            #${PANEL_ID}.at-skip-overlay-center .at-skip-dropdown {
                bottom: calc(100% + 10px);
            }
            #${PANEL_ID}.is-open .at-skip-dropdown {
                opacity: 1;
                visibility: visible;
                pointer-events: auto;
                transform: translateX(-50%) translateY(0);
            }
            #${PANEL_ID} .at-skip-dropdown::after {
                content: '';
                position: absolute;
                left: 50%;
                bottom: -7px;
                width: 14px;
                height: 14px;
                background: rgba(14, 17, 24, 0.96);
                border-right: 1px solid rgba(255, 255, 255, 0.12);
                border-bottom: 1px solid rgba(255, 255, 255, 0.12);
                transform: translateX(-50%) rotate(45deg);
            }
            #${PANEL_ID} .at-skip-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                margin-bottom: 10px;
            }
            #${PANEL_ID} .at-skip-heading {
                min-width: 0;
            }
            #${PANEL_ID} .at-skip-title {
                display: block;
                font-weight: 700;
                font-size: 12px;
                letter-spacing: 0.02em;
                color: #ffbade;
            }
            #${PANEL_ID} .at-skip-subtitle {
                display: block;
                margin-top: 2px;
                color: rgba(255, 255, 255, 0.54);
                font-size: 10px;
                font-weight: 600;
                letter-spacing: 0.02em;
            }
            #${PANEL_ID} .at-skip-close {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 34px;
                height: 24px;
                padding: 0 8px;
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 8px;
                color: rgba(255, 255, 255, 0.76);
                cursor: pointer;
                font-size: 11px;
                font-weight: 800;
                line-height: 1;
                transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
            }
            #${PANEL_ID} .at-skip-close:hover {
                color: #fff;
                background: rgba(255, 120, 120, 0.14);
                border-color: rgba(255, 120, 120, 0.36);
            }
            #${PANEL_ID} .at-skip-row {
                display: grid;
                grid-template-columns: 24px minmax(0, 1fr) auto;
                align-items: center;
                gap: 8px;
                width: 100%;
                padding: 8px 9px;
                margin: 4px 0;
                background: rgba(255, 255, 255, 0.04);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 9px;
                cursor: pointer;
                font: inherit;
                color: inherit;
                text-align: left;
                transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
            }
            #${PANEL_ID} .at-skip-row:hover {
                background: rgba(255, 186, 222, 0.13);
                border-color: rgba(255, 186, 222, 0.35);
                transform: translateY(-1px);
            }
            #${PANEL_ID} .at-skip-row[data-captured="true"] {
                background: rgba(80, 220, 140, 0.13);
                border-color: rgba(80, 220, 140, 0.45);
                color: #9dffbf;
            }
            #${PANEL_ID} .at-skip-key {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                border-radius: 5px;
                background: rgba(255, 255, 255, 0.1);
                font-size: 10px;
                font-weight: 800;
            }
            #${PANEL_ID} .at-skip-row[data-captured="true"] .at-skip-key {
                background: rgba(80, 220, 140, 0.25);
            }
            #${PANEL_ID} .at-skip-label {
                font-weight: 700;
                font-size: 11px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            #${PANEL_ID} .at-skip-time {
                font-size: 11px;
                font-variant-numeric: tabular-nums;
                color: rgba(255, 255, 255, 0.55);
            }
            #${PANEL_ID} .at-skip-row[data-captured="true"] .at-skip-time {
                color: #9dffbf;
            }
            #${PANEL_ID} .at-skip-footer {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-top: 8px;
                gap: 8px;
            }
            #${PANEL_ID} .at-skip-reset {
                padding: 5px 10px;
                font: inherit;
                font-size: 11px;
                font-weight: 700;
                color: #ff9b9b;
                background: rgba(255, 120, 120, 0.12);
                border: 1px solid rgba(255, 120, 120, 0.4);
                border-radius: 6px;
                cursor: pointer;
            }
            #${PANEL_ID} .at-skip-reset:hover {
                background: rgba(255, 120, 120, 0.22);
            }
            #${PANEL_ID} .at-skip-submit {
                padding: 5px 12px;
                font: inherit;
                font-size: 11px;
                font-weight: 700;
                color: #9dffbf;
                background: rgba(80, 220, 140, 0.14);
                border: 1px solid rgba(80, 220, 140, 0.45);
                border-radius: 6px;
                cursor: pointer;
                transition: background 120ms ease, opacity 120ms ease;
            }
            #${PANEL_ID} .at-skip-submit:hover:not(:disabled) {
                background: rgba(80, 220, 140, 0.26);
            }
            #${PANEL_ID} .at-skip-submit:disabled {
                opacity: 0.4;
                cursor: not-allowed;
            }
            #${PANEL_ID} .at-skip-progress {
                font-size: 10px;
                font-weight: 700;
                color: rgba(255, 255, 255, 0.5);
                margin-left: auto;
            }
            #${PANEL_ID}.is-complete .at-skip-progress { color: #9dffbf; }

            #${TOAST_ID} {
                position: fixed;
                left: 50%;
                bottom: 110px;
                transform: translateX(-50%);
                z-index: 2147483647;
                padding: 8px 14px;
                font-family: system-ui, sans-serif;
                font-size: 12px;
                font-weight: 700;
                background: rgba(18, 18, 26, 0.96);
                border: 1px solid rgba(255, 186, 222, 0.55);
                border-radius: 999px;
                color: #ffbade;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
                pointer-events: auto;
                display: inline-flex;
                align-items: center;
                gap: 10px;
                white-space: nowrap;
            }
            .at-skip-toast--success { color: #9dffbf; border-color: rgba(80, 220, 140, 0.6); }
            .at-skip-toast--error   { color: #ff9b9b; border-color: rgba(255, 120, 120, 0.55); }
            .at-skip-toast-cancel {
                padding: 4px 10px;
                font: inherit;
                font-size: 11px;
                font-weight: 700;
                background: rgba(255, 255, 255, 0.08);
                color: #fff;
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 6px;
                cursor: pointer;
            }
            .at-skip-toast-cancel:hover { background: rgba(255, 255, 255, 0.16); }

            @media (max-width: 720px) {
                #${PANEL_ID} {
                    margin: 0 4px;
                }
                #${PANEL_ID} .at-skip-toggle {
                    gap: 6px;
                    padding: 0 10px;
                }
                #${PANEL_ID} .at-skip-toggle-label {
                    font-size: 11px;
                }
                #${PANEL_ID} .at-skip-dropdown {
                    left: 0;
                    bottom: calc(100% + 10px);
                    transform: translateY(8px);
                }
                #${PANEL_ID}.is-open .at-skip-dropdown {
                    transform: translateY(0);
                }
                #${PANEL_ID} .at-skip-dropdown::after {
                    left: 22px;
                    transform: rotate(45deg);
                }
            }
            @media (prefers-reduced-motion: reduce) {
                #${PANEL_ID} .at-skip-toggle,
                #${PANEL_ID} .at-skip-dropdown,
                #${PANEL_ID} .at-skip-row { transition: none !important; }
            }
        `;
    };
})();
