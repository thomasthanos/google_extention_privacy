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
                episodes.push({ number: n, watchedAt: importedAt, duration: 1440, durationSource: 'anilist' });
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
                    status: Core.pushStatus(entryObj, count)
                };
            }

            added++;
        }

        if (added > 0) {
            await sset({ animeData, [Core.MEDIA_MAP_KEY]: mediaMap, [Core.PUSHED_KEY]: pushed });
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
            #${CARD_ID} .anilist-account { display:flex; align-items:center; gap:11px; margin-bottom:14px; }
            #${CARD_ID} .anilist-avatar {
                position:relative; width:38px; height:38px; flex-shrink:0;
                border-radius:50%; overflow:hidden;
                display:flex; align-items:center; justify-content:center;
                background:linear-gradient(135deg,#02a9ff,#0265a8);
                color:#fff; font-size:16px; font-weight:800;
            }
            #${CARD_ID} .anilist-avatar img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
            #${CARD_ID} .anilist-account-text { display:flex; flex-direction:column; gap:1px; min-width:0; }
            #${CARD_ID} .anilist-account-name {
                font-size:14px; font-weight:800; color:#e8edf8;
                white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
            }
            #${CARD_ID} .anilist-account-sub { font-size:11px; color:#8899b0; }
            #${CARD_ID} .anilist-dot {
                width:8px; height:8px; border-radius:50%; flex-shrink:0; margin-left:auto;
                background:#4caf82; box-shadow:0 0 0 3px rgba(76,175,130,0.18);
            }
            #${CARD_ID} .anilist-intro { margin-bottom:13px; }
            #${CARD_ID} .anilist-intro-title { font-size:14px; font-weight:800; color:#e8edf8; margin-bottom:3px; }
            #${CARD_ID} .anilist-intro-text { font-size:12px; color:#8899b0; line-height:1.5; }
            #${CARD_ID} .anilist-progress {
                height:6px; border-radius:999px; background:rgba(255,255,255,0.08);
                overflow:hidden; margin-bottom:7px;
            }
            #${CARD_ID} .anilist-progress-fill {
                height:100%; width:0%; border-radius:999px;
                background:linear-gradient(90deg,#02a9ff,#4fc3f7); transition:width .3s ease;
            }
            #${CARD_ID} .anilist-status { font-size:12px; color:#8899b0; min-height:16px; margin-bottom:12px; }
            #${CARD_ID} .anilist-status[data-kind="ok"] { color:#4caf82; }
            #${CARD_ID} .anilist-status[data-kind="err"] { color:#ff6b6b; }
            #${CARD_ID} .anilist-row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
            #${CARD_ID} .anilist-btn {
                display:inline-flex; align-items:center; justify-content:center; gap:7px;
                padding:10px 15px; border-radius:11px; border:1px solid rgba(255,255,255,0.12);
                background:rgba(255,255,255,0.06); color:#e8edf8;
                font:inherit; font-size:12.5px; font-weight:700; cursor:pointer;
                transition:background .15s ease, opacity .15s ease, transform .1s ease;
            }
            #${CARD_ID} .anilist-btn:hover:not(:disabled) { background:rgba(255,255,255,0.12); }
            #${CARD_ID} .anilist-btn:active:not(:disabled) { transform:scale(0.97); }
            #${CARD_ID} .anilist-btn:disabled { opacity:.5; cursor:default; }
            #${CARD_ID} .anilist-btn svg {
                width:14px; height:14px; fill:none; stroke:currentColor;
                stroke-width:2.4; stroke-linecap:round; stroke-linejoin:round;
            }
            #${CARD_ID} .anilist-btn--primary { background:#02a9ff; border-color:#02a9ff; color:#04121f; }
            #${CARD_ID} .anilist-btn--primary:hover:not(:disabled) { background:#3cbcff; }
            #${CARD_ID} .anilist-btn--ghost { background:transparent; }
            #${CARD_ID} .anilist-btn--block { flex:1; }
            #${CARD_ID}.anilist-syncing .anilist-btn--primary svg { animation:anilist-spin 1s linear infinite; }
            @keyframes anilist-spin { to { transform:rotate(360deg); } }
            #${CARD_ID} .anilist-divider { height:1px; background:rgba(255,255,255,0.07); margin:16px 0 13px; }
            #${CARD_ID} .anilist-sub {
                font-size:11px; font-weight:800; color:#8899b0;
                text-transform:uppercase; letter-spacing:.07em; margin-bottom:9px;
            }
            #${CARD_ID} .anilist-input {
                flex:1; min-width:150px; padding:10px 12px; border-radius:11px;
                border:1px solid rgba(255,255,255,0.14); background:rgba(0,0,0,0.28);
                color:#e8edf8; font:inherit; font-size:12.5px;
            }
            #${CARD_ID} .anilist-input:focus { outline:none; border-color:#02a9ff; }
            #${CARD_ID} .anilist-input::placeholder { color:#5a6888; }
            #${CARD_ID} .anilist-hint { font-size:11px; color:#5a6888; line-height:1.55; margin-top:9px; word-break:break-word; }
            #${CARD_ID} .anilist-hint code { color:#8eb5ff; word-break:break-all; }
            @media (prefers-reduced-motion:reduce) {
                #${CARD_ID}.anilist-syncing .anilist-btn--primary svg { animation:none; }
                #${CARD_ID} .anilist-progress-fill { transition:none; }
                #${CARD_ID} .anilist-btn { transition:none; }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function renderCardBody() {
        const connected = isConnected();
        const importName = escapeHtml(_lastUsername || (connected && _auth?.viewer?.name) || '');

        const statusArea = `
            <div class="anilist-progress" id="anilistProgress" hidden>
                <div class="anilist-progress-fill" id="anilistProgressFill"></div>
            </div>
            <div class="anilist-status" id="anilistStatus"></div>
        `;

        const importSection = `
            <div class="anilist-divider"></div>
            <div class="anilist-sub">Import from AniList</div>
            <div class="anilist-row">
                <input class="anilist-input" id="anilistUsername" type="text"
                       placeholder="AniList username" value="${importName}"
                       autocomplete="off" spellcheck="false">
                <button class="anilist-btn" id="anilistImportBtn" type="button">Import</button>
            </div>
            <div class="anilist-hint">Pulls anime from any public AniList list into your library. Existing entries are never changed.</div>
        `;

        if (connected) {
            const name = escapeHtml(_auth?.viewer?.name || 'AniList user');
            const initial = escapeHtml((name[0] || 'A').toUpperCase());
            const avatar = _auth?.viewer?.avatar || '';
            const avatarImg = avatar ? `<img id="anilistAvatar" src="${escapeHtml(avatar)}" alt="">` : '';
            return `
                <div class="anilist-account">
                    <div class="anilist-avatar"><span>${initial}</span>${avatarImg}</div>
                    <div class="anilist-account-text">
                        <span class="anilist-account-name">${name}</span>
                        <span class="anilist-account-sub">Progress syncs automatically in the background</span>
                    </div>
                    <span class="anilist-dot" title="Connected"></span>
                </div>
                ${statusArea}
                <div class="anilist-row">
                    <button class="anilist-btn anilist-btn--primary" id="anilistSyncBtn" type="button">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                        <span>Sync now</span>
                    </button>
                    <button class="anilist-btn anilist-btn--ghost" id="anilistDisconnectBtn" type="button">Disconnect</button>
                </div>
                ${importSection}
            `;
        }

        return `
            <div class="anilist-intro">
                <div class="anilist-intro-title">Sync with AniList</div>
                <div class="anilist-intro-text">Connect your account to mirror watch progress and status to your AniList list automatically.</div>
            </div>
            ${statusArea}
            <div class="anilist-row">
                <button class="anilist-btn anilist-btn--primary anilist-btn--block" id="anilistConnectBtn" type="button">
                    <span>Connect AniList</span>
                </button>
            </div>
            <div class="anilist-hint">
                Opens AniList sign-in — use the side panel, the toolbar popup closes mid-sign-in.<br>
                Redirect URL for your AniList client: <code>${escapeHtml(getRedirectUri())}</code>
            </div>
            ${importSection}
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
            if (st.error === 'reconnect') setStatus('AniList session expired — please reconnect', 'err');
            else setStatus(`Sync error: ${st.error || 'unknown'}`, 'err');
            return;
        }

        if (st && st.state === 'idle') {
            const bits = [];
            if (typeof st.ok === 'number') bits.push(`${st.ok} updated`);
            if (typeof st.skipped === 'number') bits.push(`${st.skipped} unchanged`);
            if (st.failed) bits.push(`${st.failed} unmatched`);
            const when = st.finishedAt ? ` · ${relativeTime(st.finishedAt)}` : '';
            if (bits.length) {
                setStatus(`Last sync · ${bits.join(' · ')}${when}`, 'ok');
                return;
            }
        }

        setStatus('Auto-sync is on — your progress mirrors to AniList automatically.');
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
        card.innerHTML = '<h2 class="settings-card-title">AniList</h2><div id="anilistBody"></div>';

        // Slot it just above the Danger-zone card; fall back to appending.
        const danger = inner.querySelector('.settings-card--danger');
        if (danger) inner.insertBefore(card, danger);
        else inner.appendChild(card);

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
