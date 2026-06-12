(function () {
    'use strict';

    window.AnimeTrackerContent = window.AnimeTrackerContent || {};

    // Continue-watching stylesheet (pure: depends only on the container id).
    window.AnimeTrackerContent.CWStyles = function (CONTAINER_ID) {
        return `

            #${CONTAINER_ID} {
                box-sizing: border-box; display: block;
                width: 100%; max-width: 100%;
                margin: 0;
                padding: 12px 14px;
                background:
                    radial-gradient(ellipse at top right, rgba(79,195,247,0.08) 0%, transparent 55%),
                    radial-gradient(ellipse at bottom left, rgba(155,106,255,0.05) 0%, transparent 55%),
                    linear-gradient(180deg, #11151f 0%, #0b0d14 100%);
                border: 1px solid rgba(255,255,255,0.05);
                border-radius: 14px;
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.05),
                    inset 0 0 0 1px rgba(79,195,247,0.04),
                    0 1px 0 rgba(0,0,0,0.4),
                    0 14px 30px -16px rgba(0,0,0,0.55),
                    0 4px 10px -6px rgba(0,0,0,0.4);
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                color: #e8edf8;
                contain: layout paint;
            }
            #${CONTAINER_ID} *, #${CONTAINER_ID} *::before, #${CONTAINER_ID} *::after { box-sizing: border-box; }

            .at-cw-head {
                display: flex; align-items: center; gap: 10px;
                margin-bottom: 12px;
            }
            .at-cw-head-title {
                display: inline-flex; align-items: center; gap: 8px;
                font-size: 13px; font-weight: 700; letter-spacing: .3px;
                color: #f3f6ff; text-transform: uppercase;
            }
            .at-cw-head-icon {
                width: 13px; height: 13px; flex-shrink: 0; fill: #4fc3f7;
                filter: drop-shadow(0 0 5px rgba(79,195,247,0.45));
            }
            .at-cw-count {
                font-size: 10px; font-weight: 700; color: #4fc3f7;
                background: rgba(79,195,247,0.12); border: 1px solid rgba(79,195,247,0.25);
                border-radius: 999px; padding: 1px 7px; line-height: 1.6;
                letter-spacing: .3px;
            }
            .at-cw-head-spacer { flex: 1 1 auto; }
            .at-cw-nav {
                display: inline-flex; gap: 6px; align-items: center;
            }
            .at-cw-nav-btn {
                width: 28px; height: 28px;
                display: inline-flex; align-items: center; justify-content: center;
                background: rgba(255,255,255,0.04) !important;
                border: 1px solid rgba(255,255,255,0.10) !important;
                border-radius: 8px !important;
                color: #cdd6e6 !important;
                cursor: pointer; padding: 0 !important;
                transition: background .15s ease, color .15s ease, border-color .15s ease, transform .15s ease;
            }
            .at-cw-nav-btn:hover:not(:disabled) {
                background: rgba(79,195,247,0.15) !important;
                border-color: rgba(79,195,247,0.45) !important;
                color: #fff !important;
            }
            .at-cw-nav-btn:disabled { opacity: .35; cursor: default; }
            .at-cw-nav-btn svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
            .at-cw-close {
                width: 28px; height: 28px;
                display: inline-flex; align-items: center; justify-content: center;
                background: rgba(255,255,255,0.04) !important;
                border: 1px solid rgba(255,255,255,0.08) !important;
                border-radius: 8px !important; color: #8899b0 !important;
                font-size: 16px; line-height: 1; cursor: pointer; padding: 0 !important;
                transition: background .15s ease, color .15s ease, transform .15s ease;
            }
            .at-cw-close:hover {
                background: rgba(255,255,255,0.10) !important;
                color: #fff !important; transform: scale(1.05);
            }


            .at-cw-viewport {
                position: relative;
            }
            .at-cw-viewport.has-overflow::before,
            .at-cw-viewport.has-overflow::after {
                content: ''; position: absolute; top: 0; bottom: 8px; width: 28px;
                pointer-events: none; z-index: 2;
                transition: opacity .2s ease;
            }
            .at-cw-viewport.has-overflow::before {
                left: 0;
                background: linear-gradient(90deg, rgba(16,20,32,0.96), rgba(16,20,32,0));
                opacity: var(--at-cw-fade-left, 0);
            }
            .at-cw-viewport.has-overflow::after {
                right: 0;
                background: linear-gradient(270deg, rgba(16,20,32,0.96), rgba(16,20,32,0));
                opacity: var(--at-cw-fade-right, 1);
            }

            .at-cw-track {
                display: flex; gap: 10px;
                overflow-x: auto; overflow-y: hidden;
                padding: 4px 2px 8px;
                scroll-snap-type: x mandatory;
                scroll-padding-left: 2px;
                scroll-behavior: smooth;
                scrollbar-width: thin; scrollbar-color: rgba(79,195,247,0.4) transparent;
            }
            .at-cw-track::-webkit-scrollbar { height: 6px; }
            .at-cw-track::-webkit-scrollbar-track { background: transparent; }
            .at-cw-track::-webkit-scrollbar-thumb { background: rgba(79,195,247,0.30); border-radius: 999px; }
            .at-cw-track::-webkit-scrollbar-thumb:hover { background: rgba(79,195,247,0.55); }

            .at-cw-card {
                position: relative;
                flex: 0 0 auto; width: 126px;
                display: flex; flex-direction: column;
                background: linear-gradient(180deg, #1a2031 0%, #141828 100%);
                border: 1px solid rgba(255,255,255,0.05);
                border-radius: 10px;
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.04),
                    0 2px 5px rgba(0,0,0,0.32),
                    0 6px 14px -8px rgba(0,0,0,0.4);
                scroll-snap-align: start;
                transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
                isolation: isolate;
                overflow: hidden;
            }
            .at-cw-card:hover {
                transform: translateY(-2px);
                border-color: rgba(79,195,247,0.4);
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.06),
                    0 3px 8px rgba(0,0,0,0.38),
                    0 12px 22px -12px rgba(79,195,247,0.25);
            }
            .at-cw-card:hover .at-cw-play { opacity: 1; transform: translate(-50%,-50%) scale(1); }
            .at-cw-card:hover .at-cw-thumb { border-color: rgba(79,195,247,0.4); }


            .at-cw-resume {
                text-decoration: none !important; color: inherit !important;
                display: block;
            }
            .at-cw-resume:focus-visible {
                outline: 2px solid #4fc3f7; outline-offset: 2px;
            }

            .at-cw-thumb {
                position: relative; width: 100%; aspect-ratio: 2 / 3;
                overflow: hidden;
                background: linear-gradient(150deg, #2a2f45 0%, #161a28 100%);
                border-bottom: 1px solid rgba(255,255,255,0.04);
                transition: border-color .18s ease;
            }
            .at-cw-img {
                position: absolute; inset: 0;
                width: 100% !important; height: 100% !important; max-width: none !important;
                object-fit: cover; display: block;
            }
            .at-cw-initial {
                position: absolute; inset: 0; display: flex;
                align-items: center; justify-content: center;
                font-size: 32px; font-weight: 800; color: rgba(255,255,255,0.16);
            }
            .at-cw-play {
                position: absolute; top: 50%; left: 50%;
                width: 32px; height: 32px;
                transform: translate(-50%,-50%) scale(0.75);
                display: flex; align-items: center; justify-content: center;
                background: rgba(79,195,247,0.95); border-radius: 50%;
                opacity: 0; transition: opacity .18s ease, transform .18s ease;
                box-shadow:
                    0 0 0 3px rgba(79,195,247,0.18),
                    0 3px 9px rgba(0,0,0,0.4);
            }
            .at-cw-play svg { width: 12px; height: 12px; fill: #0c1018; margin-left: 1px; }
            .at-cw-bar {
                position: absolute; left: 0; right: 0; bottom: 0; height: 3px;
                background: rgba(0,0,0,0.55);
            }
            .at-cw-bar-fill {
                height: 100%;
                background: linear-gradient(90deg, #4fc3f7 0%, #81d4fa 100%);
                box-shadow: 0 0 6px rgba(79,195,247,0.55);
            }
            .at-cw-new-badge {
                position: absolute; top: 5px; right: 5px; z-index: 2;
                padding: 1px 5px; border-radius: 4px;
                font-size: 8px; font-weight: 800; letter-spacing: 0.6px;
                text-transform: uppercase; color: #06121c;
                background: linear-gradient(135deg, #4fc3f7 0%, #29b6f6 100%);
                box-shadow: 0 1px 4px rgba(0,0,0,0.45), 0 0 8px rgba(79,195,247,0.6);
                animation: at-cw-new-pulse 2s ease-in-out infinite;
            }
            @keyframes at-cw-new-pulse {
                0%,100% { box-shadow: 0 1px 4px rgba(0,0,0,0.45), 0 0 7px rgba(79,195,247,0.5); }
                50%     { box-shadow: 0 1px 4px rgba(0,0,0,0.45), 0 0 12px rgba(79,195,247,0.9); }
            }
            .at-cw-card-new .at-cw-sub { color: #7fd4ff; font-weight: 700; }

            .at-cw-meta { padding: 6px 8px 4px; }
            .at-cw-title {
                font-size: 11.5px; font-weight: 700; line-height: 1.25; color: #e8edf8;
                display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
            }
            .at-cw-sub {
                margin-top: 2px; font-size: 10px; font-weight: 500; color: #8899b0;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }

            .at-cw-actions {
                display: flex; flex-direction: column; gap: 4px;
                padding: 0 8px 8px;
            }
            .at-cw-btn {
                display: flex; align-items: center; justify-content: center; gap: 4px;
                padding: 4px 6px;
                border-radius: 6px;
                font-size: 10px; font-weight: 700; letter-spacing: .3px;
                text-decoration: none !important;
                transition: background .15s ease, color .15s ease, border-color .15s ease, transform .15s ease;
            }
            .at-cw-btn-resume {
                background: linear-gradient(180deg, #4fc3f7 0%, #29b6f6 100%);
                border: 1px solid rgba(79,195,247,0.6);
                color: #0c1018 !important;
                box-shadow: 0 2px 6px rgba(79,195,247,0.22);
            }
            .at-cw-btn-resume:hover {
                background: linear-gradient(180deg, #81d4fa 0%, #4fc3f7 100%);
                transform: translateY(-1px);
            }
            .at-cw-btn-next {
                background: rgba(79,195,247,0.06);
                border: 1px solid rgba(79,195,247,0.18);
                color: #b8d4e8 !important;
            }
            .at-cw-btn-next:hover {
                background: rgba(79,195,247,0.18);
                border-color: rgba(79,195,247,0.45);
                color: #fff !important;
                transform: translateY(-1px);
            }
            .at-cw-btn:focus-visible {
                outline: 2px solid #4fc3f7; outline-offset: 2px;
            }
            .at-cw-btn-arrow {
                width: 9px; height: 9px; fill: currentColor;
                transition: transform .15s ease;
            }
            .at-cw-btn-next:hover .at-cw-btn-arrow { transform: translateX(2px); }

            @media (prefers-reduced-motion: reduce) {
                .at-cw-card, .at-cw-play, .at-cw-thumb, .at-cw-btn, .at-cw-btn-arrow, .at-cw-track {
                    transition: none !important;
                    scroll-behavior: auto !important;
                }
                .at-cw-card:hover, .at-cw-btn:hover { transform: none !important; }
            }
            @media (max-width: 1199px) {
                .at-cw-card { width: 112px; }
            }
            @media (max-width: 767px) {
                #${CONTAINER_ID} {

                    width: calc(100% - 24px);
                    margin-inline: 12px;
                    padding: 9px;
                    border-radius: 12px;
                }

                .at-cw-head-title {
                    font-size: 10px;
                    letter-spacing: .15px;
                    gap: 6px;
                    min-width: 0;
                }
                .at-cw-head-title > span:not(.at-cw-count) {
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    min-width: 0;
                }

                .at-cw-card { width: 120px; }
                .at-cw-thumb { aspect-ratio: 16 / 9; }

                .at-cw-img { object-position: center 22%; }
                .at-cw-initial { font-size: 22px; }
                .at-cw-nav { display: none; }
                .at-cw-title {
                    font-size: 11px;
                    -webkit-line-clamp: 1;
                }
                .at-cw-sub { font-size: 9.5px; }
                .at-cw-meta { padding: 5px 7px 2px; }
                .at-cw-actions { padding: 0 7px 6px; }
                .at-cw-btn { padding: 3px 6px; font-size: 9.5px; }
            }
        `;
    };
})();
