(function () {
    'use strict';

    window.AnimeTrackerContent = window.AnimeTrackerContent || {};

    // Continue-watching stylesheet — iOS 26 "Liquid Glass" aesthetic.
    // Same color palette as before (#4fc3f7 blue + #9b6aff purple on dark navy).
    // Perimeter 3D effect achieved purely with layered inset borders
    // (specular top edge + refraction bottom edge + side highlights) and
    // backdrop-filter — NO outer box-shadows, NO glows.
    window.AnimeTrackerContent.CWStyles = function (CONTAINER_ID) {
        return `

            /* ============ Liquid Glass container ============ */
            #${CONTAINER_ID} {
                box-sizing: border-box; display: block;
                position: relative;
                width: 100%; max-width: 100%;
                margin: 0;
                padding: 12px 14px;
                background:
                    radial-gradient(ellipse at top right, rgba(79,195,247,0.10) 0%, transparent 55%),
                    radial-gradient(ellipse at bottom left, rgba(155,106,255,0.07) 0%, transparent 55%),
                    linear-gradient(180deg, rgba(17,21,31,0.72) 0%, rgba(11,13,20,0.78) 100%);
                -webkit-backdrop-filter: blur(28px) saturate(180%);
                backdrop-filter: blur(28px) saturate(180%);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 22px;
                /* Perimeter 3D — pure inset layering, no outer shadows */
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.18),
                    inset 0 -1px 0 rgba(255,255,255,0.05),
                    inset 1px 0 0 rgba(255,255,255,0.06),
                    inset -1px 0 0 rgba(255,255,255,0.06),
                    inset 0 0 0 1px rgba(79,195,247,0.04);
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                color: #e8edf8;
                contain: layout paint;
            }
            #${CONTAINER_ID} *, #${CONTAINER_ID} *::before, #${CONTAINER_ID} *::after { box-sizing: border-box; }

            /* Animated liquid waves — subtle iOS 26 ambient layer */
            #${CONTAINER_ID}::after {
                content: ''; position: absolute; inset: 0;
                border-radius: inherit; pointer-events: none; z-index: 0;
                overflow: hidden;
                background-image:
                    radial-gradient(140% 70% at 0% 110%, rgba(79,195,247,0.10) 0%, transparent 60%),
                    radial-gradient(140% 70% at 100% -10%, rgba(155,106,255,0.09) 0%, transparent 60%),
                    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 240' preserveAspectRatio='none'><defs><linearGradient id='a' x1='0' x2='0' y1='0' y2='1'><stop offset='0' stop-color='%234fc3f7' stop-opacity='0.10'/><stop offset='1' stop-color='%234fc3f7' stop-opacity='0'/></linearGradient><linearGradient id='b' x1='0' x2='0' y1='0' y2='1'><stop offset='0' stop-color='%239b6aff' stop-opacity='0.08'/><stop offset='1' stop-color='%239b6aff' stop-opacity='0'/></linearGradient></defs><path fill='url(%23a)' d='M0,180 C200,140 400,220 600,170 C800,120 1000,200 1200,160 L1200,240 L0,240 Z'/><path fill='url(%23b)' d='M0,200 C220,170 420,230 640,190 C860,150 1040,215 1200,185 L1200,240 L0,240 Z'/></svg>");
                background-size: auto, auto, 220% 60%;
                background-position: 0 0, 0 0, 0% 100%;
                background-repeat: no-repeat;
                animation: at-cw-waves 22s ease-in-out infinite alternate;
                opacity: 0.55;
            }
            @keyframes at-cw-waves {
                0%   { background-position: 0 0, 0 0, 0% 100%; }
                100% { background-position: 0 0, 0 0, 40% 100%; }
            }

            /* Specular highlight ring (top arc of light, like iOS 26 glass) */
            #${CONTAINER_ID} > * { position: relative; z-index: 1; }
            #${CONTAINER_ID}::before {
                content: ''; position: absolute; inset: 0;
                border-radius: inherit; pointer-events: none; z-index: 1;
                background:
                    linear-gradient(180deg,
                        rgba(255,255,255,0.10) 0%,
                        rgba(255,255,255,0.02) 18%,
                        transparent 38%,
                        transparent 62%,
                        rgba(255,255,255,0.03) 100%);
                mix-blend-mode: screen;
            }

            /* ============ Header ============ */
            .at-cw-head {
                display: flex; align-items: center; gap: 10px;
                margin-bottom: 12px;
                position: relative;
            }
            .at-cw-head-title {
                display: inline-flex; align-items: center; gap: 8px;
                font-size: 13px; font-weight: 700; letter-spacing: .3px;
                color: #f3f6ff; text-transform: uppercase;
            }
            .at-cw-head-icon {
                width: 13px; height: 13px; flex-shrink: 0; fill: #4fc3f7;
            }
            .at-cw-count {
                font-size: 10px; font-weight: 700; color: #4fc3f7;
                background: rgba(79,195,247,0.14);
                border: 1px solid rgba(79,195,247,0.28);
                border-radius: 999px; padding: 1px 7px; line-height: 1.6;
                letter-spacing: .3px;
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.18),
                    inset 0 -1px 0 rgba(0,0,0,0.18);
            }
            .at-cw-head-spacer { flex: 1 1 auto; }
            .at-cw-nav {
                display: inline-flex; gap: 6px; align-items: center;
            }

            /* ============ Glass pill buttons (nav + close) ============ */
            .at-cw-nav-btn, .at-cw-close {
                width: 28px; height: 28px;
                display: inline-flex; align-items: center; justify-content: center;
                background:
                    linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 100%) !important;
                border: 1px solid rgba(255,255,255,0.12) !important;
                border-radius: 10px !important;
                color: #cdd6e6 !important;
                cursor: pointer; padding: 0 !important;
                -webkit-backdrop-filter: blur(14px) saturate(160%);
                backdrop-filter: blur(14px) saturate(160%);
                /* iOS 26 perimeter — top specular, bottom refraction */
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.22),
                    inset 0 -1px 0 rgba(0,0,0,0.22),
                    inset 1px 0 0 rgba(255,255,255,0.06),
                    inset -1px 0 0 rgba(255,255,255,0.06);
                transition: background .18s ease, color .18s ease, border-color .18s ease, transform .18s ease;
            }
            .at-cw-nav-btn:hover:not(:disabled) {
                background:
                    linear-gradient(180deg, rgba(79,195,247,0.22) 0%, rgba(79,195,247,0.08) 100%) !important;
                border-color: rgba(79,195,247,0.50) !important;
                color: #fff !important;
            }
            .at-cw-nav-btn:disabled { opacity: .35; cursor: default; }
            .at-cw-nav-btn svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }

            /* ============ Redesigned close button ============ */
            .at-cw-close {
                width: 30px !important; height: 30px !important;
                border-radius: 50% !important;
                color: #c8d2e4 !important;
                position: relative;
                background:
                    radial-gradient(circle at 30% 25%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 55%, rgba(255,255,255,0.02) 100%) !important;
                border: 1px solid rgba(255,255,255,0.14) !important;
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.30),
                    inset 0 -1px 0 rgba(0,0,0,0.28),
                    inset 1px 0 0 rgba(255,255,255,0.08),
                    inset -1px 0 0 rgba(255,255,255,0.08) !important;
            }
            .at-cw-close-glyph {
                display: inline-flex; align-items: center; justify-content: center;
                width: 100%; height: 100%;
                transition: transform .25s cubic-bezier(.4,1.4,.5,1);
            }
            .at-cw-close-glyph svg { width: 12px; height: 12px; display: block; }
            .at-cw-close:hover {
                background:
                    radial-gradient(circle at 30% 25%, rgba(255,120,120,0.32) 0%, rgba(255,80,80,0.10) 55%, rgba(255,60,60,0.04) 100%) !important;
                border-color: rgba(255,120,120,0.50) !important;
                color: #fff !important;
            }
            .at-cw-close:hover .at-cw-close-glyph { transform: rotate(90deg); }
            .at-cw-close:active .at-cw-close-glyph { transform: rotate(90deg) scale(.9); }

            /* ============ Viewport + scroll track ============ */
            .at-cw-viewport { position: relative; }
            .at-cw-viewport.has-overflow::before,
            .at-cw-viewport.has-overflow::after {
                content: ''; position: absolute; top: 0; bottom: 8px; width: 28px;
                pointer-events: none; z-index: 2;
                transition: opacity .2s ease;
            }
            .at-cw-viewport.has-overflow::before {
                left: 0;
                background: linear-gradient(90deg, rgba(16,20,32,0.92), rgba(16,20,32,0));
                opacity: var(--at-cw-fade-left, 0);
            }
            .at-cw-viewport.has-overflow::after {
                right: 0;
                background: linear-gradient(270deg, rgba(16,20,32,0.92), rgba(16,20,32,0));
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

            /* ============ Liquid Glass cards ============ */
            .at-cw-card {
                position: relative;
                flex: 0 0 auto; width: 126px;
                display: flex; flex-direction: column;
                background:
                    linear-gradient(180deg, rgba(40,46,66,0.72) 0%, rgba(20,24,40,0.78) 100%);
                -webkit-backdrop-filter: blur(18px) saturate(170%);
                backdrop-filter: blur(18px) saturate(170%);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 16px;
                /* Perimeter 3D — full 4-edge inset lighting, no drop shadow */
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.16),
                    inset 0 -1px 0 rgba(0,0,0,0.28),
                    inset 1px 0 0 rgba(255,255,255,0.05),
                    inset -1px 0 0 rgba(255,255,255,0.05);
                scroll-snap-align: start;
                transition: transform .25s ease, border-color .25s ease;
                isolation: isolate;
                overflow: hidden;
            }
            .at-cw-card:hover {
                transform: translateY(-2px);
                border-color: rgba(79,195,247,0.45);
            }
            .at-cw-card:hover .at-cw-thumb { border-color: rgba(79,195,247,0.4); }
            .at-cw-play { display: none !important; }

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
                border-bottom: 1px solid rgba(255,255,255,0.06);
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
                width: 34px; height: 34px;
                transform: translate(-50%,-50%) scale(0.75);
                display: flex; align-items: center; justify-content: center;
                background:
                    linear-gradient(180deg, rgba(79,195,247,0.95) 0%, rgba(41,182,246,0.95) 100%);
                border-radius: 50%;
                opacity: 0;
                transition: opacity .18s ease, transform .18s ease;
                /* Liquid glass perimeter on the play orb — no glow */
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.55),
                    inset 0 -1px 0 rgba(0,0,0,0.25);
            }
            .at-cw-play svg { width: 12px; height: 12px; fill: #0c1018; margin-left: 1px; }

            .at-cw-bar {
                position: absolute; left: 0; right: 0; bottom: 0; height: 3px;
                background: rgba(0,0,0,0.55);
            }
            .at-cw-bar-fill {
                height: 100%;
                background: linear-gradient(90deg, #4fc3f7 0%, #81d4fa 100%);
            }

            .at-cw-new-badge {
                position: absolute; top: 6px; right: 6px; z-index: 2;
                padding: 2px 6px; border-radius: 6px;
                font-size: 8px; font-weight: 800; letter-spacing: 0.6px;
                text-transform: uppercase; color: #06121c;
                background:
                    linear-gradient(135deg, #4fc3f7 0%, #29b6f6 100%);
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.45),
                    inset 0 -1px 0 rgba(0,0,0,0.22);
            }
            .at-cw-card-new .at-cw-sub { color: #7fd4ff; font-weight: 700; }

            /* ============ Meta + actions ============ */
            .at-cw-meta { padding: 6px 8px 4px; }
            .at-cw-title {
                font-size: 11.5px; font-weight: 700; line-height: 1.25; color: #e8edf8;
                display: block;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .at-cw-sub {
                margin-top: 2px; font-size: 10px; font-weight: 500; color: #8899b0;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }

            .at-cw-actions {
                display: grid;
                grid-template-columns: 1fr;
                gap: 4px;
                padding: 0 8px 8px;
            }
            .at-cw-card-start .at-cw-meta {
                padding-bottom: 2px;
            }
            .at-cw-card-start .at-cw-actions {
                padding-top: 0;
            }
            .at-cw-card-start .at-cw-btn-resume {
                min-height: 28px;
            }
            .at-cw-btn {
                display: flex; align-items: center; justify-content: center; gap: 4px;
                padding: 5px 6px;
                min-width: 0;
                border-radius: 9px;
                font-size: 10px; font-weight: 700; letter-spacing: .3px;
                text-decoration: none !important;
                transition: background .18s ease, color .18s ease, border-color .18s ease, transform .18s ease;
            }
            .at-cw-btn span {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .at-cw-btn-resume {
                background:
                    linear-gradient(180deg, #5fcbf8 0%, #29b6f6 100%);
                border: 1px solid rgba(79,195,247,0.55);
                color: #0c1018 !important;
                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,0.45),
                    inset 0 -1px 0 rgba(0,0,0,0.22);
            }
            .at-cw-btn-resume:hover {
                background:
                    linear-gradient(180deg, #81d4fa 0%, #4fc3f7 100%);
                transform: translateY(-1px);
            }
            .at-cw-btn:focus-visible {
                outline: 2px solid #4fc3f7; outline-offset: 2px;
            }
            /* ============ Motion + responsive ============ */
            @media (prefers-reduced-motion: reduce) {
                .at-cw-card, .at-cw-play, .at-cw-thumb, .at-cw-btn, .at-cw-track {
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
                    border-radius: 18px;
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
                .at-cw-card { width: 120px; border-radius: 14px; }
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
                .at-cw-btn { padding: 4px 6px; font-size: 9.5px; }
            }
        `;
    };
})();
