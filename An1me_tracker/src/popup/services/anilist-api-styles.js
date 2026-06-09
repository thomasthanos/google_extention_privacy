(function () {
    'use strict';

    window.AnimeTracker = window.AnimeTracker || {};

    // AniList integration card stylesheet (pure: depends only on the card element id).
    window.AnimeTracker.AniListStyles = function (CARD_ID) {
        return `
            #${CARD_ID} {
                --anilist-accent:#2fb7ff;
                --anilist-accent-strong:#10a8f7;
                --anilist-surface:rgba(255,255,255,0.045);
                --anilist-surface-strong:rgba(255,255,255,0.075);
                --anilist-border:rgba(255,255,255,0.1);
                --anilist-success:#4caf82;
                font-family:'Inter','Segoe UI',system-ui,sans-serif;
            }


            #${CARD_ID} .anilist-empty {
                display:flex; flex-direction:column;
                gap:10px;
                padding:8px 4px 4px;
            }
            #${CARD_ID} .anilist-empty-hero {
                display:grid;
                grid-template-columns:auto minmax(0,1fr);
                column-gap:14px;
                align-items:center;
            }
            #${CARD_ID} .anilist-logo {
                width:48px; height:48px; display:grid; place-items:center;
                border-radius:12px;
                background:linear-gradient(135deg, rgba(47,183,255,0.18) 0%, rgba(16,168,247,0.08) 100%);
                border:1px solid rgba(47,183,255,0.28);
                color:var(--anilist-accent);
                box-shadow:0 4px 18px rgba(47,183,255,0.18), inset 0 1px 0 rgba(255,255,255,0.06);
            }
            #${CARD_ID} .anilist-logo svg { width:22px; height:22px; }
            #${CARD_ID} .anilist-empty-text {
                display:flex; flex-direction:column;
                gap:2px;
                min-width:0;
                text-align:left;
            }
            #${CARD_ID} .anilist-empty-title {
                font-size:16px; font-weight:600; color:#f4f7ff;
                margin:0;
                letter-spacing:-0.01em;
            }
            #${CARD_ID} .anilist-empty-desc {
                font-size:12.5px; color:#8ea0ba; line-height:1.4;
                margin:0;
            }
            #${CARD_ID} .anilist-btn--connect {
                width:100%; min-height:38px; padding:9px 16px;
                background:linear-gradient(135deg, var(--anilist-accent) 0%, var(--anilist-accent-strong) 100%);
                border:1px solid rgba(47,183,255,0.55);
                color:#02131f; font-weight:700; font-size:13px;
                border-radius:10px; cursor:pointer;
                box-shadow:0 4px 16px rgba(47,183,255,0.22), inset 0 1px 0 rgba(255,255,255,0.18);
                display:inline-flex; align-items:center; justify-content:center; gap:7px;
                transition:all .18s ease;
            }
            #${CARD_ID} .anilist-btn--connect:hover:not(:disabled) {
                transform:translateY(-1px);
                box-shadow:0 6px 24px rgba(47,183,255,0.4), inset 0 1px 0 rgba(255,255,255,0.22);
            }
            #${CARD_ID} .anilist-btn--connect:active:not(:disabled) {
                transform:translateY(0);
            }
            #${CARD_ID} .anilist-btn--connect svg {
                width:14px; height:14px; fill:currentColor; stroke:none;
            }


            #${CARD_ID} .anilist-collapsible {
                width:100%; margin-top:4px;
            }
            #${CARD_ID} .anilist-collapsible--inline { width:100%; text-align:left; }
            #${CARD_ID} .anilist-collapsible summary {
                list-style:none;
                display:inline-flex; align-items:center; gap:6px;
                font-size:12px; color:#9aa8bf; cursor:pointer;
                padding:4px 6px; border-radius:6px;
                transition:background .12s ease, color .12s ease;
                user-select:none;
            }
            #${CARD_ID} .anilist-collapsible summary::-webkit-details-marker { display:none; }
            #${CARD_ID} .anilist-collapsible summary:hover {
                background:rgba(255,255,255,0.03); color:#cfd6e4;
            }
            #${CARD_ID} .anilist-collapsible-arrow {
                display:inline-block; width:0; height:0;
                border-left:5px solid currentColor;
                border-top:4px solid transparent;
                border-bottom:4px solid transparent;
                transition:transform .15s ease;
                margin-right:1px;
            }
            #${CARD_ID} .anilist-collapsible[open] .anilist-collapsible-arrow {
                transform:rotate(90deg);
            }
            #${CARD_ID} .anilist-collapsible-body {
                padding:8px 4px 2px 18px;
                animation:anilist-fade-in .18s ease;
            }
            #${CARD_ID} .anilist-collapsible-text {
                font-size:11.5px; color:#8ea0ba; line-height:1.5;
                margin:0 0 6px;
            }
            @keyframes anilist-fade-in {
                from { opacity:0; transform:translateY(-2px); }
                to { opacity:1; transform:translateY(0); }
            }


            #${CARD_ID} .anilist-url-row {
                display:flex; align-items:stretch; gap:6px; margin-top:4px;
            }
            #${CARD_ID} .anilist-url-code {
                flex:1; min-width:0;
                padding:6px 10px;
                font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
                font-size:10.5px; color:#8eb5ff;
                background:rgba(0,0,0,0.25);
                border:1px solid var(--anilist-border);
                border-radius:6px;
                overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
                user-select:all;
                line-height:24px;
            }
            #${CARD_ID} .anilist-url-copy {
                min-height:36px; padding:0 12px; font-size:11px;
            }
            #${CARD_ID} .anilist-url-copy--done {
                color:var(--anilist-success) !important;
                border-color:rgba(76,175,130,0.4) !important;
            }


            #${CARD_ID} .anilist-divider {
                height:1px; background:rgba(255,255,255,0.07);
                margin:14px 0 10px;
            }
            #${CARD_ID} .anilist-sub {
                font-size:11px; font-weight:700; color:#9aa8bf;
                text-transform:uppercase; letter-spacing:0.05em;
                margin-bottom:4px;
            }
            #${CARD_ID} .anilist-sub-helper {
                font-size:12px; color:#8ea0ba; line-height:1.45;
                margin:0 0 8px;
            }
            #${CARD_ID} .anilist-import-row {
                display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px;
            }
            #${CARD_ID} .anilist-input {
                width:100%; min-width:0; height:36px; padding:0 12px;
                border-radius:8px;
                border:1px solid var(--anilist-border);
                background:rgba(0,0,0,0.18);
                color:#eef4ff; font:inherit; font-size:12px;
            }
            #${CARD_ID} .anilist-input:focus {
                outline:none; border-color:rgba(47,183,255,0.6);
                box-shadow:0 0 0 3px rgba(47,183,255,0.14);
            }
            #${CARD_ID} .anilist-input::placeholder { color:#66738b; }
            #${CARD_ID} .anilist-hint {
                font-size:11px; color:#7f8da6; line-height:1.45;
                margin-top:6px; word-break:break-word;
            }


            #${CARD_ID} .anilist-head {
                display:grid; grid-template-columns:auto minmax(0,1fr) auto;
                align-items:center; gap:11px;
                margin-bottom:10px;
            }
            #${CARD_ID} .anilist-avatar {
                position:relative; width:32px; height:32px; flex-shrink:0;
                border-radius:10px; overflow:hidden;
                display:flex; align-items:center; justify-content:center;
                background:linear-gradient(135deg,rgba(47,183,255,0.95),rgba(44,103,255,0.85));
                color:#fff; font-size:13px; font-weight:800;
                box-shadow:0 4px 12px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.18);
            }
            #${CARD_ID} .anilist-avatar img {
                position:absolute; inset:0; width:100%; height:100%; object-fit:cover;
            }
            #${CARD_ID} .anilist-head-text {
                display:flex; flex-direction:column; gap:1px; min-width:0;
            }
            #${CARD_ID} .anilist-head-name {
                font-size:15px; font-weight:700; color:#f4f7ff;
                white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
                letter-spacing:-0.005em;
            }
            #${CARD_ID} .anilist-head-sub {
                font-size:12px; color:#8ea0ba; line-height:1.3;
            }
            #${CARD_ID} .anilist-pill {
                display:inline-flex; align-items:center; gap:6px;
                justify-self:end;
                min-height:24px; padding:0 10px;
                border-radius:999px;
                border:1px solid rgba(76,175,130,0.32);
                background:rgba(76,175,130,0.1);
                color:#7be0ac;
                font-size:11px; font-weight:600;
                white-space:nowrap;
            }
            #${CARD_ID} .anilist-pill::before {
                content:''; width:7px; height:7px; border-radius:50%;
                background:var(--anilist-success);
                box-shadow:0 0 0 3px rgba(76,175,130,0.18), 0 0 8px rgba(76,175,130,0.55);
            }


            #${CARD_ID} .anilist-progress {
                height:4px; border-radius:999px;
                background:rgba(255,255,255,0.06);
                overflow:hidden; margin:2px 0 8px;
            }
            #${CARD_ID} .anilist-progress-fill {
                height:100%; width:0%; border-radius:999px;
                background:linear-gradient(90deg,var(--anilist-accent-strong),#71d7ff);
                transition:width .3s ease;
            }
            #${CARD_ID} .anilist-status {
                padding:7px 10px; border-radius:8px;
                border:1px solid var(--anilist-border);
                background:var(--anilist-surface);
                color:#9aa8bf; font-size:11.5px; line-height:1.4;
                margin-bottom:10px;
                white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
            }
            #${CARD_ID} .anilist-status:empty { display:none; }
            #${CARD_ID} .anilist-status[data-kind="ok"] {
                border-color:rgba(76,175,130,0.22);
                background:rgba(76,175,130,0.06);
                color:#a3d9bd;
            }
            #${CARD_ID} .anilist-status[data-kind="err"] {
                border-color:rgba(255,107,107,0.26);
                background:rgba(255,107,107,0.07);
                color:#ff8f8f;
                white-space:normal;
            }
            #${CARD_ID} .anilist-status[data-kind="warn"] {
                border-color:rgba(255,193,87,0.28);
                background:rgba(255,193,87,0.07);
                color:#ffd093;
                white-space:normal;
            }


            #${CARD_ID} .anilist-actions-row {
                display:flex; gap:8px; align-items:center;
                margin-bottom:6px;
            }
            #${CARD_ID} .anilist-btn {
                display:inline-flex; align-items:center; justify-content:center; gap:6px;
                min-height:32px; padding:6px 12px;
                border-radius:8px;
                border:1px solid var(--anilist-border);
                background:transparent; color:#cfd6e4;
                font:inherit; font-size:12px; font-weight:600;
                cursor:pointer;
                transition:all .15s ease;
            }
            #${CARD_ID} .anilist-btn:hover:not(:disabled) {
                background:var(--anilist-surface);
                border-color:rgba(255,255,255,0.18);
                color:#f4f7ff;
            }
            #${CARD_ID} .anilist-btn:active:not(:disabled) { transform:translateY(1px); }
            #${CARD_ID} .anilist-btn:disabled { opacity:.45; cursor:default; }
            #${CARD_ID} .anilist-btn:focus-visible {
                outline:none; box-shadow:0 0 0 3px rgba(47,183,255,0.16);
            }
            #${CARD_ID} .anilist-btn svg {
                width:13px; height:13px; fill:none; stroke:currentColor;
                stroke-width:2.4; stroke-linecap:round; stroke-linejoin:round;
            }
            #${CARD_ID} .anilist-btn--sync {
                background:rgba(47,183,255,0.08);
                border-color:rgba(47,183,255,0.28);
                color:var(--anilist-accent);
            }
            #${CARD_ID} .anilist-btn--sync:hover:not(:disabled) {
                background:rgba(47,183,255,0.14);
                border-color:rgba(47,183,255,0.45);
                color:#71d7ff;
            }
            #${CARD_ID} .anilist-btn--ghost { background:transparent; }
            #${CARD_ID}.anilist-syncing .anilist-btn--sync svg {
                animation:anilist-spin 1s linear infinite;
            }
            @keyframes anilist-spin { to { transform:rotate(360deg); } }

            @media (max-width:380px) {
                #${CARD_ID} .anilist-head { grid-template-columns:auto minmax(0,1fr); }
                #${CARD_ID} .anilist-pill { grid-column:1 / -1; justify-self:start; }
                #${CARD_ID} .anilist-import-row { grid-template-columns:1fr; }
                #${CARD_ID} .anilist-import-row .anilist-btn { width:100%; }
            }
            @media (prefers-reduced-motion:reduce) {
                #${CARD_ID}.anilist-syncing .anilist-btn--sync svg { animation:none; }
                #${CARD_ID} .anilist-progress-fill { transition:none; }
                #${CARD_ID} .anilist-btn,
                #${CARD_ID} .anilist-btn--connect { transition:none; }
                #${CARD_ID} .anilist-collapsible-body { animation:none; }
            }
        `;
    };
})();
