/**
 * Anime Tracker — AniList integration (popup)
 *
 * Owns OAuth (connect / disconnect), the Settings card UI, and the one-shot
 * "Import from AniList" action. The actual progress PUSH runs in the
 * background service worker (src/background/anilist-sync.js) so it works
 * even when the popup is closed — this file just triggers it and mirrors
 * its status (written to `anilist_sync_status`) into the card.
 *
 * Shared GraphQL + push logic lives in src/common/anilist-core.js.
 */
(function () {
    'use strict';

    // ════════════════════════════════════════════════════════════════════
    //  CONFIG — AniList API client ID (https://anilist.co/settings/developer)
    //  The redirect URL to register is shown in Settings → AniList.
    //  Import-by-username works without this — only push sync needs it.
    const ANILIST_CLIENT_ID = '42051';
    // ════════════════════════════════════════════════════════════════════

    const Core = (typeof window !== 'undefined' && window.AniListCore) || null;
    if (!Core) {
        console.error('[AniList] AniListCore not loaded — AniList integration disabled');
    }

    const AUTH_URL = 'https://anilist.co/api/v2/oauth/authorize';
    const AUTH_KEY = 'anilist_auth';
    const USERNAME_KEY = 'anilist_username';
    const STATUS_KEY = 'anilist_sync_status';

    const warn = (...a) => { try { (window.PopupLogger || console).warn?.('AniList', ...a); } catch {} };

    function escapeHtml(v) {
        return String(v ?? '').replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    function sget(keys) {
        return new Promise((res) => {
            try { chrome.storage.local.get(keys, (r) => res(chrome.runtime.lastError ? {} : (r || {}))); }
            catch { res({}); }
        });
    }
    function sset(obj) {
        return new Promise((res) => {
            try { chrome.storage.local.set(obj, () => { void chrome.runtime.lastError; res(); }); }
            catch { res(); }
        });
    }
    function sremove(keys) {
        return new Promise((res) => {
            try { chrome.storage.local.remove(keys, () => { void chrome.runtime.lastError; res(); }); }
            catch { res(); }
        });
    }

    // ── Auth ─────────────────────────────────────────────────────────────
    let _auth = null;

    async function loadAuth() {
        const s = await sget([AUTH_KEY]);
        _auth = s[AUTH_KEY] || null;
        return _auth;
    }
    function isConnected() {
        return !!(_auth && _auth.accessToken && (!_auth.expiresAt || _auth.expiresAt > Date.now()));
    }
    function getRedirectUri() {
        try { return chrome.identity.getRedirectURL(); } catch { return ''; }
    }

    // Fetch the viewer's name/avatar once and fold it into stored auth.
    async function ensureViewer() {
        if (!Core || !isConnected() || (_auth && _auth.viewer)) return;
        try {
            const data = await Core.gql('query{Viewer{id name avatar{medium}}}', {}, _auth.accessToken);
            const v = data && data.Viewer;
            if (v) {
                _auth = { ..._auth, viewer: { id: v.id, name: v.name, avatar: v.avatar?.medium || '' } };
                await sset({ [AUTH_KEY]: _auth });
            }
        } catch (e) {
            warn('Viewer fetch failed:', e.message);
        }
    }

    async function connect() {
        if (!ANILIST_CLIENT_ID) throw new Error('no_client_id');
        // Canonical AniList implicit-grant URL — no `redirect_uri` param; the
        // implicit flow uses the client's registered redirect URL. Run
        // launchWebAuthFlow directly here (the standard pattern). The side
        // panel stays open through the flow; the toolbar popup does not, so
        // connecting must be done from the side panel.
        const authUrl = `${AUTH_URL}?client_id=${encodeURIComponent(ANILIST_CLIENT_ID)}&response_type=token`;

        const responseUrl = await new Promise((resolve, reject) => {
            try {
                chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (url) => {
                    if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
                    if (!url) { reject(new Error('cancelled')); return; }
                    resolve(url);
                });
            } catch (e) { reject(e); }
        });

        const fragment = responseUrl.split('#')[1] || '';
        const params = new URLSearchParams(fragment);
        const accessToken = params.get('access_token');
        if (!accessToken) throw new Error('no_token');
        const expiresIn = parseInt(params.get('expires_in') || '', 10);
        _auth = {
            accessToken,
            expiresAt: Number.isFinite(expiresIn) ? Date.now() + expiresIn * 1000 : 0
        };
        await sset({ [AUTH_KEY]: _auth });
        await ensureViewer();
        return _auth;
    }

    async function disconnect() {
        _auth = null;
        await sremove([AUTH_KEY]);
    }

    // ── Import (public AniList list → local library) ─────────────────────
    async function importFromUsername(username) {
        if (!Core) throw new Error('core_missing');
        const name = String(username || '').trim();
        if (!name) throw new Error('no_username');

        const data = await Core.gql(
            'query($n:String){MediaListCollection(userName:$n,type:ANIME){lists{entries{'
            + 'progress status media{id episodes title{romaji english} coverImage{large}}'
            + '}}}}',
            { n: name }, null
        );

        const lists = data?.MediaListCollection?.lists || [];
        const entries = [];
        for (const list of lists) {
            for (const e of (list.entries || [])) entries.push(e);
        }
        if (entries.length === 0) return { added: 0, skipped: 0, total: 0 };

        const store = await sget(['animeData', Core.MEDIA_MAP_KEY, Core.PUSHED_KEY]);
        const animeData = store.animeData || {};
        const mediaMap = store[Core.MEDIA_MAP_KEY] || {};
        const pushed = store[Core.PUSHED_KEY] || {};
        const importedAt = new Date().toISOString().split('.')[0] + 'Z';
        const now = Date.now();

        let added = 0, skipped = 0;

        for (const e of entries) {
            const status = e.status;
            const progress = Number(e.progress) || 0;
            // Skip pure "planning" entries — nothing watched, nothing to track.
            if (progress <= 0 && status !== 'COMPLETED') { skipped++; continue; }

            const media = e.media || {};
            const mTitle = media.title || {};
            const title = mTitle.english || mTitle.romaji || 'Unknown';
            const slug = Core.slugify(mTitle.romaji || title);
            if (!slug) { skipped++; continue; }

            // Additive only — never overwrite an entry the user already tracks.
            if (animeData[slug]) { skipped++; continue; }

            const total = Number(media.episodes) || 0;
            const count = (status === 'COMPLETED' && total > 0) ? total : progress;
            const episodes = [];
            for (let n = 1; n <= count; n++) {
                // No per-episode `watchedAt` for AniList imports — we don't
                // know the real watch date, and stamping every episode with
                // `now` would dump the whole import onto a single day in
                // "minutes today" / streak / weekday stats. The entry-level
                // `lastWatched` (set below) gives the card a sensible date.
                episodes.push({ number: n, duration: 1440, durationSource: 'anilist' });
            }

            const entryObj = {
                title,
                slug,
                episodes,
                totalWatchTime: episodes.length * 1440,
                lastWatched: importedAt,
                totalEpisodes: total > 0 ? total : null,
                coverImage: (media.coverImage && media.coverImage.large) || null
            };
            if (status === 'COMPLETED') {
                entryObj.listState = 'completed';
                entryObj.completedAt = importedAt;
                entryObj.listStateUpdatedAt = importedAt;
            } else if (status === 'DROPPED') {
                entryObj.listState = 'dropped';
                entryObj.droppedAt = importedAt;
                entryObj.listStateUpdatedAt = importedAt;
            } else if (status === 'PAUSED') {
                entryObj.listState = 'on_hold';
                entryObj.onHoldAt = importedAt;
                entryObj.listStateUpdatedAt = importedAt;
            }

            animeData[slug] = entryObj;

            // Pre-seed the caches so the background push skips this entry
            // (AniList already has it) instead of re-searching + re-writing it.
            if (media.id) {
                mediaMap[slug] = { mediaId: media.id, episodes: total || null, cachedAt: now };
                pushed[slug] = {
                    progress: Core.localProgress(entryObj),
                    status: Core.pushStatus(entryObj, count),
                    // Lock dates for pure imports: AniList already has the
                    // correct history. We must not overwrite it with a
                    // "today" date just because the user watches ep1 later.
                    // The lock is cleared when progress advances beyond the
                    // imported count (i.e. the user watches new episodes).
                    datesLocked: true
                };
            }

            added++;
        }

        if (added > 0) {
            // Also write SCHEMA_KEY so the background push doesn't wipe the
            // pre-seeded pushed cache on first run after import.
            await sset({ animeData, [Core.MEDIA_MAP_KEY]: mediaMap, [Core.PUSHED_KEY]: pushed, [Core.SCHEMA_KEY]: Core.PUSH_SCHEMA });
        }
        return { added, skipped, total: entries.length };
    }

    // ── UI ───────────────────────────────────────────────────────────────
    const CARD_ID = 'anilistCard';
    const STYLE_ID = 'anilist-card-styles';
    let _busy = false;
    let _lastUsername = '';
    let _syncStatus = null;

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${CARD_ID} {
                --anilist-accent:#2fb7ff;
                --anilist-accent-strong:#10a8f7;
                --anilist-surface:rgba(255,255,255,0.045);
                --anilist-surface-strong:rgba(255,255,255,0.075);
                --anilist-border:rgba(255,255,255,0.1);
                --anilist-success:#4caf82;
                font-family:'Inter','Segoe UI',system-ui,sans-serif;
            }

            /* ─── LOGGED-OUT — logo left, text right ────────────────── */
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

            /* ─── Collapsibles — How does this work / Advanced import ── */
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

            /* Redirect URL row inside the collapsible */
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

            /* ─── Disconnected: divider + import-without-connecting ──── */
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

            /* ─── LOGGED-IN — compact head ──────────────────────────── */
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

            /* ─── Status strip + progress bar ──────────────────────── */
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

            /* ─── Action row (Sync now + Disconnect) ──────────────── */
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
        (document.head || document.documentElement).appendChild(style);
    }

    function renderCardBody() {
        const connected = isConnected();
        const importName = escapeHtml(_lastUsername || (connected && _auth?.viewer?.name) || '');

        // Status strip + progress bar are reused by both states. The status
        // div is hidden when empty (CSS rule `:empty { display:none }`).
        const statusArea = `
            <div class="anilist-progress" id="anilistProgress" hidden>
                <div class="anilist-progress-fill" id="anilistProgressFill"></div>
            </div>
            <div class="anilist-status" id="anilistStatus"></div>
        `;

        // Reusable import row (used in both Advanced import + standalone).
        // Re-renders preserve any value the user already typed via `importName`.
        const importInputRow = `
            <div class="anilist-import-row">
                <input class="anilist-input" id="anilistUsername" type="text"
                       placeholder="AniList username" value="${importName}"
                       autocomplete="off" spellcheck="false">
                <button class="anilist-btn anilist-btn--ghost" id="anilistImportBtn" type="button">Import</button>
            </div>
        `;

        if (connected) {
            // ─── LOGGED-IN STATE — compact, calm ────────────────────────
            const name = escapeHtml(_auth?.viewer?.name || 'AniList user');
            const initial = escapeHtml((name[0] || 'A').toUpperCase());
            const avatar = _auth?.viewer?.avatar || '';
            const avatarImg = avatar ? `<img id="anilistAvatar" src="${escapeHtml(avatar)}" alt="">` : '';

            return `
                <div class="anilist-head">
                    <div class="anilist-avatar"><span>${initial}</span>${avatarImg}</div>
                    <div class="anilist-head-text">
                        <span class="anilist-head-name">${name}</span>
                        <span class="anilist-head-sub">Auto-sync enabled</span>
                    </div>
                    <span class="anilist-pill" title="Connected">Connected</span>
                </div>
                ${statusArea}
                <div class="anilist-actions-row">
                    <button class="anilist-btn anilist-btn--sync" id="anilistSyncBtn" type="button">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                        <span>Sync now</span>
                    </button>
                    <button class="anilist-btn anilist-btn--ghost" id="anilistDisconnectBtn" type="button">Disconnect</button>
                </div>
                <details class="anilist-collapsible">
                    <summary><span class="anilist-collapsible-arrow"></span>Advanced import</summary>
                    <div class="anilist-collapsible-body">
                        ${importInputRow}
                        <div class="anilist-hint">Pulls public AniList entries into your library. Existing entries stay untouched.</div>
                    </div>
                </details>
            `;
        }

        // ─── LOGGED-OUT STATE — welcoming, centered hierarchy ───────────
        const redirectUri = escapeHtml(getRedirectUri());
        return `
            <div class="anilist-empty">
                <div class="anilist-empty-hero">
                    <div class="anilist-logo" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                            <path d="M2 17l10 5 10-5"/>
                            <path d="M2 12l10 5 10-5"/>
                        </svg>
                    </div>
                    <div class="anilist-empty-text">
                        <h3 class="anilist-empty-title">Sync with AniList</h3>
                        <p class="anilist-empty-desc">Keep your watch progress in sync automatically.</p>
                    </div>
                </div>
                <button class="anilist-btn anilist-btn--connect" id="anilistConnectBtn" type="button">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="13 2 4 14 12 14 11 22 20 10 12 10 13 2"/></svg>
                    <span>Connect AniList</span>
                </button>
                ${statusArea}
                <details class="anilist-collapsible anilist-collapsible--inline">
                    <summary><span class="anilist-collapsible-arrow"></span>How does this work?</summary>
                    <div class="anilist-collapsible-body">
                        <p class="anilist-collapsible-text">Connect opens AniList sign-in in a new tab. Use the side panel — the toolbar popup closes during sign-in.</p>
                        <p class="anilist-collapsible-text">Register this redirect URL for your AniList client:</p>
                        <div class="anilist-url-row">
                            <code class="anilist-url-code" id="anilistRedirectCode">${redirectUri}</code>
                            <button class="anilist-btn anilist-btn--ghost anilist-url-copy" id="anilistRedirectCopy" type="button">Copy</button>
                        </div>
                    </div>
                </details>
            </div>
            <div class="anilist-divider"></div>
            <div class="anilist-sub">Import without connecting</div>
            <p class="anilist-sub-helper">Just want to import a public list?</p>
            ${importInputRow}
        `;
    }

    function setStatus(msg, kind) {
        const el = document.getElementById('anilistStatus');
        if (el) {
            el.textContent = msg || '';
            if (kind) el.setAttribute('data-kind', kind);
            else el.removeAttribute('data-kind');
        }
        // A plain status message ends a progress run — hide the bar.
        const bar = document.getElementById('anilistProgress');
        if (bar) bar.hidden = true;
    }

    function setProgress(done, total, label) {
        const bar = document.getElementById('anilistProgress');
        const fill = document.getElementById('anilistProgressFill');
        const el = document.getElementById('anilistStatus');
        const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
        if (bar) bar.hidden = false;
        if (fill) fill.style.width = `${pct}%`;
        if (el) {
            el.textContent = `${label} · ${done}/${total}`;
            el.removeAttribute('data-kind');
        }
    }

    function setSyncing(on) {
        document.getElementById(CARD_ID)?.classList.toggle('anilist-syncing', !!on);
    }

    function setBusy(busy) {
        _busy = busy;
        for (const id of ['anilistSyncBtn', 'anilistConnectBtn', 'anilistDisconnectBtn', 'anilistImportBtn']) {
            const b = document.getElementById(id);
            if (b) b.disabled = busy;
        }
    }

    function relativeTime(ts) {
        const diff = Date.now() - Number(ts || 0);
        if (!Number.isFinite(diff) || diff < 0) return '';
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
    }

    // Mirror the background sync status (written by anilist-sync.js) into the
    // card. Keeps the card meaningful at all times — no blank gap.
    function applySyncStatus(st) {
        if (!isConnected()) return;

        if (st && st.state === 'running') {
            setSyncing(true);
            setProgress(st.done || 0, st.total || 1, 'Syncing to AniList');
            return;
        }

        setSyncing(false);

        if (st && st.state === 'error') {
            if (st.error === 'reconnect') setStatus('AniList session expired — reconnect needed', 'err');
            else setStatus(`Sync error: ${st.error || 'unknown'}`, 'err');
            return;
        }

        if (st && st.state === 'retrying') {
            const retryIn = st.retryAt ? Math.max(0, Math.round((st.retryAt - Date.now()) / 60000)) : 5;
            setStatus(`Sync paused — retrying in ${retryIn}m (${st.retryableFailed || 0} transient failures)`, 'err');
            return;
        }

        if (st && st.state === 'idle') {
            const bits = [];
            // Compact strip: "23m ago · 0 updated · 68 unchanged · 28 unmatched"
            // Time first (most useful at-a-glance), then counts.
            if (st.finishedAt) bits.push(relativeTime(st.finishedAt));
            if (typeof st.ok === 'number') bits.push(`${st.ok} updated`);
            if (typeof st.skipped === 'number') bits.push(`${st.skipped} unchanged`);
            if (st.failed) bits.push(`${st.failed} unmatched`);
            if (bits.length) {
                setStatus(`Last sync · ${bits.join(' · ')}`, 'ok');
                return;
            }
        }

        // No sync ran yet — clear status so the strip collapses (CSS :empty).
        setStatus('');
    }

    async function doConnect() {
        if (_busy) return;
        setBusy(true);
        setStatus('Opening AniList sign-in…');
        let ok = false;
        try {
            await connect();
            ok = true;
        } catch (e) {
            const msg = String(e?.message || '');
            renderCard();
            if (msg === 'no_client_id') setStatus('Set ANILIST_CLIENT_ID first', 'err');
            else if (/cancel|closed|user_cancelled/i.test(msg)) setStatus('Sign-in cancelled', 'err');
            else setStatus(`Connect failed: ${msg}`, 'err');
        } finally {
            setBusy(false);
        }
        if (ok) {
            renderCard();
            // Kick off the first background sync right away.
            doSyncNow();
        }
    }

    async function doDisconnect() {
        if (_busy) return;
        await disconnect();
        renderCard();
        setStatus('Disconnected from AniList');
    }

    // Triggers the SERVICE WORKER to push — runs in the background, so it
    // keeps going even if the popup closes. The card mirrors progress via
    // the `anilist_sync_status` storage key.
    function doSyncNow() {
        if (!isConnected()) { setStatus('Connect AniList first', 'err'); return; }
        setSyncing(true);
        setProgress(0, 1, 'Starting AniList sync');
        try {
            chrome.runtime.sendMessage({ type: 'ANILIST_SYNC_NOW' }, () => { void chrome.runtime.lastError; });
        } catch { /* extension context invalidated — ignore */ }
    }

    async function doImport() {
        if (_busy) return;
        const input = document.getElementById('anilistUsername');
        const username = (input && input.value || '').trim();
        if (!username) { setStatus('Enter an AniList username', 'err'); return; }

        setBusy(true);
        setStatus(`Importing ${username}'s AniList list…`);
        try {
            const res = await importFromUsername(username);
            _lastUsername = username;
            await sset({ [USERNAME_KEY]: username });
            if (res.added > 0) {
                setStatus(`Imported ${res.added} anime · ${res.skipped} already in your library`, 'ok');
            } else {
                setStatus(`Nothing new to import · ${res.skipped} already in your library`, 'ok');
            }
        } catch (e) {
            const msg = String(e?.message || '');
            if (/not found|private/i.test(msg)) setStatus('User not found, or their list is private', 'err');
            else setStatus(`Import failed: ${msg}`, 'err');
        } finally {
            setBusy(false);
        }
    }

    function bindCard() {
        document.getElementById('anilistConnectBtn')?.addEventListener('click', doConnect);
        document.getElementById('anilistDisconnectBtn')?.addEventListener('click', doDisconnect);
        document.getElementById('anilistSyncBtn')?.addEventListener('click', doSyncNow);
        document.getElementById('anilistImportBtn')?.addEventListener('click', doImport);
        document.getElementById('anilistUsername')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); doImport(); }
        });
        // Copy-redirect button (logged-out state, inside "How does this work?")
        document.getElementById('anilistRedirectCopy')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const code = document.getElementById('anilistRedirectCode');
            const text = code?.textContent || '';
            try { await navigator.clipboard.writeText(text); }
            catch {
                // Clipboard blocked — fall back to text selection
                const range = document.createRange();
                if (code) range.selectNodeContents(code);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                if (code) sel?.addRange(range);
            }
            const orig = btn.textContent;
            btn.textContent = 'Copied';
            btn.classList.add('anilist-url-copy--done');
            setTimeout(() => {
                btn.textContent = orig;
                btn.classList.remove('anilist-url-copy--done');
            }, 1400);
        });
        // Drop a broken avatar image so the gradient + initial show instead.
        document.getElementById('anilistAvatar')?.addEventListener('error', (e) => {
            e.target.remove();
        }, { once: true });
    }

    function renderCard() {
        const body = document.getElementById('anilistBody');
        if (!body) return;
        body.innerHTML = renderCardBody();
        bindCard();
        // Connected card always shows a meaningful status (never a blank gap).
        if (isConnected()) applySyncStatus(_syncStatus);
    }

    function injectCard() {
        if (document.getElementById(CARD_ID)) { renderCard(); return; }
        const inner = document.querySelector('#settingsView .settings-view-inner');
        if (!inner) return;

        injectStyles();
        const card = document.createElement('section');
        card.className = 'settings-card';
        card.id = CARD_ID;
        card.innerHTML = '<div id="anilistBody"></div>';

        // Slot under the "CONNECTIONS" section label if present (new layout).
        // Find the label whose text matches and insert immediately after it.
        // Falls back to slotting above the Danger zone (legacy slot), then to
        // appending — keeps this resilient to settings-view reshuffles.
        const labels = inner.querySelectorAll('.settings-section-label');
        let connectionsLabel = null;
        for (const lbl of labels) {
            if ((lbl.textContent || '').trim().toUpperCase() === 'CONNECTIONS') {
                connectionsLabel = lbl;
                break;
            }
        }
        if (connectionsLabel) {
            connectionsLabel.insertAdjacentElement('afterend', card);
        } else {
            const danger = inner.querySelector('.settings-card--danger');
            if (danger) inner.insertBefore(card, danger);
            else inner.appendChild(card);
        }

        renderCard();
    }

    // ── Boot ─────────────────────────────────────────────────────────────
    (async () => {
        try {
            const stored = await sget([USERNAME_KEY, STATUS_KEY]);
            _lastUsername = stored[USERNAME_KEY] || '';
            _syncStatus = stored[STATUS_KEY] || null;
            await loadAuth();
            if (isConnected() && _auth && !_auth.viewer) await ensureViewer();
        } catch (e) {
            warn('Init failed:', e?.message);
        }

        injectCard();

        try {
            chrome.storage.onChanged.addListener((changes, namespace) => {
                if (namespace !== 'local') return;
                if (changes[AUTH_KEY]) {
                    loadAuth().then(() => renderCard());
                }
                if (changes[STATUS_KEY]) {
                    _syncStatus = changes[STATUS_KEY].newValue || null;
                    applySyncStatus(_syncStatus);
                }
            });
        } catch { /* ignore */ }
    })();

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.AniListIntegration = {
        isConnected, connect, disconnect, importFromUsername, getRedirectUri
    };
})();
