


(function () {
    'use strict';


    const ANILIST_CLIENT_ID_PROD = '42051';
    const ANILIST_CLIENT_ID_DEV  = '42224';
    const PROD_EXTENSION_ID = 'gilapmpjgicjledlmpgiakofhodfifbl';

    function _resolveClientId() {
        try {
            return chrome.runtime.id === PROD_EXTENSION_ID
                ? ANILIST_CLIENT_ID_PROD
                : ANILIST_CLIENT_ID_DEV;
        } catch {
            return ANILIST_CLIENT_ID_PROD;
        }
    }
    const ANILIST_CLIENT_ID = _resolveClientId();

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


    function isMobileLikeEnv() {
        const ua = navigator.userAgent || '';
        if (/Orion|Firefox|FxiOS/i.test(ua)) return true;
        if (/Android|iPhone|iPad|iPod|Mobile|CriOS|EdgiOS/i.test(ua)) return true;
        if (/AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg/i.test(ua)) return true;
        if (!chrome?.identity?.launchWebAuthFlow) return true;
        let redirectUrl = '';
        try { redirectUrl = chrome.identity.getRedirectURL?.() || ''; }
        catch { return true; }
        if (!/^https:\/\/[a-z0-9]+\.chromiumapp\.org/.test(redirectUrl)) return true;
        return false;
    }

    async function connect() {
        if (!ANILIST_CLIENT_ID) throw new Error('no_client_id');
        if (isMobileLikeEnv()) throw new Error('mobile_unsupported');


        const redirectUri = getRedirectUri();
        if (!redirectUri) throw new Error('no_redirect_uri');

        const authUrl = `${AUTH_URL}`
            + `?client_id=${encodeURIComponent(ANILIST_CLIENT_ID)}`
            + `&response_type=token`;

        const responseUrl = await new Promise((resolve, reject) => {
            try {
                chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (url) => {
                    if (chrome.runtime.lastError) {
                        const msg = chrome.runtime.lastError.message || '';


                        if (/page could not be loaded/i.test(msg)) {
                            reject(new Error(`auth_page_failed:${redirectUri}`));
                        } else {
                            reject(new Error(msg));
                        }
                        return;
                    }
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


    async function pushAuthToCloud(reason) {
        try {
            const FS = (typeof window !== 'undefined' && window.FirebaseSync) || null;
            if (!FS || typeof FS.pushAnilistAuthToCloud !== 'function') return;
            const user = (typeof FS.getUser === 'function') ? FS.getUser() : null;
            if (!user) return;
            const username = _lastUsername || (_auth?.viewer?.name || null);
            await FS.pushAnilistAuthToCloud(_auth || null, username);
        } catch (e) {
            warn(`pushAuthToCloud(${reason}) failed:`, e?.message);
        }
    }


    async function importFromUsername(username, options = {}) {
        if (!Core) throw new Error('core_missing');
        if (options?.source !== 'manual') throw new Error('manual_import_required');
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

            if (progress <= 0 && status !== 'COMPLETED') { skipped++; continue; }

            const media = e.media || {};
            const mTitle = media.title || {};
            const title = mTitle.english || mTitle.romaji || 'Unknown';
            const slug = Core.slugify(mTitle.romaji || title);
            if (!slug) { skipped++; continue; }


            if (animeData[slug]) {
                let touched = false;
                if (mTitle.english && !animeData[slug].englishTitle) {
                    animeData[slug].englishTitle = mTitle.english;
                    touched = true;
                }
                if (mTitle.romaji && !animeData[slug].romajiTitle) {
                    animeData[slug].romajiTitle = mTitle.romaji;
                    touched = true;
                }
                if (mTitle.native && !animeData[slug].nativeTitle) {
                    animeData[slug].nativeTitle = mTitle.native;
                    touched = true;
                }
                if (touched) {


                    animeData[slug].alternateTitlesUpdatedAt = importedAt;
                }
                skipped++;
                continue;
            }

            const total = Number(media.episodes) || 0;
            const count = (status === 'COMPLETED' && total > 0) ? total : progress;
            const episodes = [];

            const entryObj = {
                title,
                slug,
                episodes,
                totalWatchTime: 0,
                lastWatched: null,
                totalEpisodes: total > 0 ? total : null,
                coverImage: (media.coverImage && media.coverImage.large) || null,


                englishTitle: mTitle.english || null,
                romajiTitle: mTitle.romaji || null,
                nativeTitle: mTitle.native || null
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


            if (media.id) {
                mediaMap[slug] = { mediaId: media.id, episodes: total || null, cachedAt: now };
                pushed[slug] = {
                    progress: Core.localProgress(entryObj),
                    status: Core.pushStatus(entryObj, count),


                    datesLocked: true
                };
            }

            added++;
        }

        if (added > 0) {


            await sset({ animeData, [Core.MEDIA_MAP_KEY]: mediaMap, [Core.PUSHED_KEY]: pushed, [Core.SCHEMA_KEY]: Core.PUSH_SCHEMA });
        }
        return { added, skipped, total: entries.length };
    }


    const CARD_ID = 'anilistCard';
    const STYLE_ID = 'anilist-card-styles';
    let _busy = false;
    let _lastUsername = '';
    let _syncStatus = null;


    let _firebaseSignedIn = false;

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = window.AnimeTracker.AniListStyles(CARD_ID);
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


        const importInputRow = `
            <div class="anilist-import-row">
                <input class="anilist-input" id="anilistUsername" type="text"
                       placeholder="AniList username" value="${importName}"
                       autocomplete="off" spellcheck="false">
                <button class="anilist-btn anilist-btn--ghost" id="anilistImportBtn" type="button">Import</button>
            </div>
        `;

        if (connected) {

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


        const redirectUri = escapeHtml(getRedirectUri());
        const onMobile = isMobileLikeEnv();


        const trackerSignedIn = !!_firebaseSignedIn;
        const connectBlock = onMobile
            ? (trackerSignedIn
                ? `<div class="anilist-status" data-kind="warn" style="display:block;">
                       <strong>Sign in on desktop first.</strong><br>
                       AniList login can't run on this browser, but it will sync here automatically once you connect on a desktop signed into the same tracker account.
                   </div>`
                : `<div class="anilist-status" data-kind="err" style="display:block;">
                       <strong>Sign in to your tracker account first</strong> (button at the top of the popup), then connect AniList on a desktop browser. The login will sync here automatically.
                   </div>`)
            : `<button class="anilist-btn anilist-btn--connect" id="anilistConnectBtn" type="button">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="13 2 4 14 12 14 11 22 20 10 12 10 13 2"/></svg>
                    <span>Connect AniList</span>
               </button>`;
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
                ${connectBlock}
                ${statusArea}
                ${onMobile ? '' : `<details class="anilist-collapsible anilist-collapsible--inline">
                    <summary><span class="anilist-collapsible-arrow"></span>How does this work?</summary>
                    <div class="anilist-collapsible-body">
                        <p class="anilist-collapsible-text">Connect opens AniList sign-in in a new tab. Use the side panel — the toolbar popup closes during sign-in.</p>
                        <p class="anilist-collapsible-text">Register this redirect URL for your AniList client:</p>
                        <div class="anilist-url-row">
                            <code class="anilist-url-code" id="anilistRedirectCode">${redirectUri}</code>
                            <button class="anilist-btn anilist-btn--ghost anilist-url-copy" id="anilistRedirectCopy" type="button">Copy</button>
                        </div>
                    </div>
                </details>`}
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


    function applySyncStatus(st) {
        if (!isConnected()) return;

        if (st && st.state === 'running') {


            const staleMs = 3 * 60 * 1000;
            const lastAdvanced = st.advancedAt || st.updatedAt;
            if (lastAdvanced && (Date.now() - lastAdvanced) > staleMs) {
                setSyncing(false);
                setStatus('Sync stalled - click Sync now to retry', 'err');
                return;
            }
            setSyncing(true);
            const label = st.currentTitle ? `Syncing · ${st.currentTitle}` : 'Syncing to AniList';
            setProgress(st.done || 0, st.total || 1, label);
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


            if (st.finishedAt) bits.push(relativeTime(st.finishedAt));
            if (typeof st.ok === 'number') bits.push(`${st.ok} updated`);
            if (typeof st.skipped === 'number') bits.push(`${st.skipped} unchanged`);
            if (st.failed) bits.push(`${st.failed} unmatched`);
            if (bits.length) {
                setStatus(`Last sync · ${bits.join(' · ')}`, 'ok');
                return;
            }
        }


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
            else if (msg === 'no_redirect_uri') setStatus('Browser does not provide a redirect URI — try desktop Chrome', 'err');
            else if (msg === 'mobile_unsupported') setStatus('Connect from desktop — login will sync to mobile via Firebase', 'err');
            else if (/cancel|closed|user_cancelled/i.test(msg)) setStatus('Sign-in cancelled', 'err');
            else if (msg.startsWith('auth_page_failed:')) {


                const redirectUri = msg.slice('auth_page_failed:'.length);
                setStatus(
                    `AniList rejected the redirect. Register this URL on `
                    + `anilist.co/settings/developer: ${redirectUri}`,
                    'err'
                );
            }
            else setStatus(`Connect failed: ${msg}`, 'err');
        } finally {
            setBusy(false);
        }
        if (ok) {
            renderCard();


            pushAuthToCloud('connect').catch(() => {                     });

            doSyncNow();
        }
    }

    async function doDisconnect() {
        if (_busy) return;
        await disconnect();


        pushAuthToCloud('disconnect').catch(() => {                     });
        renderCard();
        setStatus('Disconnected from AniList');
    }


    function doSyncNow() {
        if (!isConnected()) { setStatus('Connect AniList first', 'err'); return; }
        setSyncing(true);
        setProgress(0, 1, 'Starting AniList sync');
        let responded = false;
        const swTimeout = setTimeout(() => {
            if (!responded) {
                setSyncing(false);
                setStatus('Sync failed — extension reloading, try again', 'err');
            }
        }, 5000);
        try {
            chrome.runtime.sendMessage({ type: 'ANILIST_SYNC_NOW' }, (resp) => {
                responded = true;
                clearTimeout(swTimeout);
                if (chrome.runtime.lastError || !resp) {
                    setSyncing(false);
                    setStatus('Sync failed — extension reloading, try again', 'err');
                }
            });
        } catch {
            clearTimeout(swTimeout);
            setSyncing(false);
            setStatus('Sync failed — extension context invalidated', 'err');
        }
    }

    async function doImport() {
        if (_busy) return;
        const input = document.getElementById('anilistUsername');
        const username = (input && input.value || '').trim();
        if (!username) { setStatus('Enter an AniList username', 'err'); return; }

        setBusy(true);
        setStatus(`Importing ${username}'s AniList list…`);
        try {
            const res = await importFromUsername(username, { source: 'manual' });
            _lastUsername = username;
            await sset({ [USERNAME_KEY]: username });


            pushAuthToCloud('import-username').catch(() => {                     });
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

        document.getElementById('anilistRedirectCopy')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const code = document.getElementById('anilistRedirectCode');
            const text = code?.textContent || '';
            try { await navigator.clipboard.writeText(text); }
            catch {

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

        document.getElementById('anilistAvatar')?.addEventListener('error', (e) => {
            e.target.remove();
        }, { once: true });
    }

    function renderCard() {
        const body = document.getElementById('anilistBody');
        if (!body) return;
        body.innerHTML = renderCardBody();
        bindCard();

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


    (async () => {
        try {
            const stored = await sget([USERNAME_KEY, STATUS_KEY, 'firebase_user']);
            _lastUsername = stored[USERNAME_KEY] || '';
            _syncStatus = stored[STATUS_KEY] || null;
            _firebaseSignedIn = !!(stored.firebase_user && stored.firebase_user.uid);
            await loadAuth();
            if (isConnected() && _auth && !_auth.viewer) await ensureViewer();
        } catch (e) {
            warn('Init failed:', e?.message);
        }

        injectCard();


        try {
            if (isMobileLikeEnv() && _firebaseSignedIn && !isConnected()) {
                chrome.runtime.sendMessage(
                    { type: 'WAKE_AND_POLL_CLOUD_FORCE' },
                    () => { void chrome.runtime.lastError; }
                );


            }
        } catch {                   }

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
                if (changes.firebase_user) {
                    const newUid = changes.firebase_user?.newValue?.uid || null;
                    const wasSignedIn = _firebaseSignedIn;
                    _firebaseSignedIn = !!newUid;


                    if (wasSignedIn !== _firebaseSignedIn && !isConnected()) {
                        renderCard();
                    }
                }
            });
        } catch {              }


        setInterval(() => {
            if (_syncStatus && _syncStatus.state === 'running') {
                applySyncStatus(_syncStatus);
            }
        }, 30000);
    })();

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.AniListIntegration = {
        isConnected, connect, disconnect, importFromUsername, getRedirectUri
    };
})();


/* ───────── merged from anilist-service.js ───────── */

const AnilistService = {
    cache: {},

    CACHE_TTL: 24 * 60 * 60 * 1000,
    CACHE_TTL_AIRING: 60 * 60 * 1000,
    CACHE_TTL_NOT_FOUND: 3 * 24 * 60 * 60 * 1000,
    CACHE_TTL_RETRYABLE: 15 * 60 * 1000,

    getTotalEpisodes(slug) {
        const data = this.cache[slug];
        if (!data || data.totalEpisodes == null) return null;
        return data.totalEpisodes;
    },

    getStatus(slug) {
        return this.cache[slug]?.status || null;
    },

    getLatestEpisode(slug) {
        const data = this.cache[slug];
        if (!data || data.latestEpisode == null) return null;
        return data.latestEpisode;
    },

    getNextEpisodeAt(slug) {
        const data = this.cache[slug];
        if (!data || !data.nextEpisodeAt) return null;
        return data.nextEpisodeAt;
    },

    async loadCachedData(animeData) {
        const { Storage } = window.AnimeTracker;

        try {
            const keys = Object.keys(animeData).map(slug => `animeinfo_${slug}`);
            if (keys.length === 0) return;

            const result = await Storage.get(keys);
            let loaded = 0;
            const keysToPurge = [];

            const isSeasonLikeSlug = (slug) =>
                /-(?:season-?\d+|(?:\d+)(?:st|nd|rd|th)-season|s\d+|(?:part|cour)-?\d+|(?:ii|iii|iv|v|vi))(?=$|-)/i
                    .test(String(slug || ''));

            let needsSave = false;
            for (const [key, value] of Object.entries(result)) {
                if (!key.startsWith('animeinfo_') || !value) continue;
                const slug = key.replace('animeinfo_', '');

                if (!value.notFound && isSeasonLikeSlug(slug) && !value.resolvedSlug) {
                    keysToPurge.push(key);
                    continue;
                }

                this.cache[slug] = value;
                loaded++;

                if (value.coverImage && animeData[slug] && !animeData[slug].coverImage) {
                    animeData[slug].coverImage = value.coverImage;
                    needsSave = true;
                }
            }

            if (keysToPurge.length > 0) {
                await Storage.remove(keysToPurge);
            }
            if (needsSave) {
                await Storage.set({ animeData });
            }

        } catch (error) {
            PopupLogger.error('AnimeInfo', 'Failed to load cache:', error);
        }
    },










    async autoFetchMissing(animeData, onComplete, onProgress) {
        const { Storage } = window.AnimeTracker;

        return new Promise(async (resolveOuter) => {
        try {
            await this.loadCachedData(animeData);

            const migrationKey = 'animeinfo_coverimage_migration_done';
            const migResult = await Storage.get([migrationKey]);
            if (!migResult[migrationKey]) {
                const MIGRATION_BATCH = 6;
                let cleared = 0;
                for (const slug of Object.keys(animeData)) {
                    if (cleared >= MIGRATION_BATCH) break;
                    const cached = this.cache[slug];
                    if (cached && cached.cachedAt && !cached.coverImage && !cached.notFound) {
                        delete this.cache[slug];
                        cleared++;
                    }
                }
                if (cleared === 0) {
                    await Storage.set({ [migrationKey]: true });
                }
            }

            const now = Date.now();
            const slugsToFetch = Object.keys(animeData).filter(slug => {
                const cached = this.cache[slug];
                if (!cached || !cached.cachedAt) return true;
                const age = now - cached.cachedAt;
                if (cached.notFound) return age >= this.CACHE_TTL_NOT_FOUND;
                if (cached.retryable) return age >= this.CACHE_TTL_RETRYABLE;
                const ttl = cached.status === 'RELEASING' ? this.CACHE_TTL_AIRING : this.CACHE_TTL;
                return age >= ttl;
            });

            if (slugsToFetch.length === 0) {
                if (onComplete) onComplete();
                resolveOuter();
                return;
            }

            PopupLogger.log('AnimeInfo', `Delegating ${slugsToFetch.length} anime to background...`);

            const total = slugsToFetch.length;
            const expectedKeys = new Set(slugsToFetch.map(s => `animeinfo_${s}`));
            let processed = 0;
            let storageListener = null;
            let timeoutId = null;
            let finished = false;

            const finish = () => {
                if (finished) return;
                finished = true;
                if (storageListener) {
                    try { chrome.storage.onChanged.removeListener(storageListener); } catch { }
                    storageListener = null;
                }
                if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
                if (onComplete) onComplete();
                resolveOuter();
            };

            storageListener = (changes, namespace) => {
                if (namespace !== 'local') return;
                for (const key of Object.keys(changes)) {
                    if (!expectedKeys.has(key)) continue;
                    expectedKeys.delete(key);
                    processed++;
                    const slug = key.replace(/^animeinfo_/, '');
                    const title = animeData[slug]?.title || slug;
                    try {
                        if (onProgress) onProgress(processed, total, title);
                    } catch (e) {
                        PopupLogger.warn('AnimeInfo', 'onProgress threw:', e);
                    }
                    if (expectedKeys.size === 0) {
                        finish();
                        return;
                    }
                }
            };
            chrome.storage.onChanged.addListener(storageListener);

            const MAX_WAIT_MS = Math.min(5 * 60 * 1000, Math.max(30000, total * 5000));
            timeoutId = setTimeout(finish, MAX_WAIT_MS);

            chrome.runtime.sendMessage(
                { type: 'BATCH_FETCH_ANIME_INFO', slugs: slugsToFetch },
                () => { if (chrome.runtime.lastError) finish(); }
            );
        } catch (error) {
            PopupLogger.error('AnimeInfo', 'Auto-fetch error:', error);
            if (onComplete) onComplete();
            resolveOuter();
        }
        });
    }
};

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.AnilistService = AnilistService;
