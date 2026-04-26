/**
 * Anime Tracker — Skiptime Contributor Helper
 *
 * Dropdown helper inside the player's center controls on `an1me.to/watch/*`
 * that lets the user capture
 * intro/outro timestamps with one click while watching, and auto-fills
 * the site's existing skiptime contribution panel + submits it.
 *
 * Toggle ON/OFF via the popup Settings view. The panel mounts/unmounts
 * live on `chrome.storage.onChanged` for `skiptimeHelperEnabled`.
 *
 * UX:
 *  - Compact trigger button next to the player's center controls
 *  - Dropdown menu above the controls
 *  - 4 buttons: Intro Start (1) / Intro End (2) / Outro Start (3) / Outro End (4)
 *  - Reset (0) + quick disable action
 *  - Auto-fills outro-end from video duration on first capture
 *  - When all 4 captured → 3-sec countdown toast with Cancel → auto-submit
 *  - Cache survives reload (chrome.storage.local, keyed per episode slug)
 *  - Cache cleared after successful submit OR after 7 days idle
 *  - Keyboard shortcuts active when player has focus (skipped while typing
 *    in another input)
 */
(function () {
    'use strict';

    if (window.self !== window.top) return;

    const PANEL_ID = 'at-skip-panel';
    const STYLE_ID = 'at-skip-helper-styles';
    const TOAST_ID = 'at-skip-helper-toast';
    const CONTROL_HOST_SELECTOR = '.art-controls-center';
    const CONTROL_HOST_FALLBACK_SELECTOR = '.art-controls';

    const STORAGE_TOGGLE_KEY = 'skiptimeHelperEnabled';
    const STORAGE_CACHE_PREFIX = 'skiptimeCache:';
    const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

    const TARGETS = [
        { key: 'introStart', shortcut: '1', label: 'Intro Start',  fieldId: 'intro-begin' },
        { key: 'introEnd',   shortcut: '2', label: 'Intro End',    fieldId: 'intro-end'   },
        { key: 'outroStart', shortcut: '3', label: 'Outro Start',  fieldId: 'outro-begin' },
        { key: 'outroEnd',   shortcut: '4', label: 'Outro End',    fieldId: 'outro-end'   }
    ];

    const Logger = window.AnimeTrackerContent?.Logger || {
        info: () => {}, debug: () => {}, error: () => {}, warn: () => {}, success: () => {}
    };

    let mounted = false;
    let mountInProgress = false;
    let panelEl = null;
    let panelDoc = null;
    let video = null;
    let helperEnabled = false;
    let toggleListener = null;
    let videoObserver = null;
    let controlsObserver = null;
    let urlObserver = null;
    let episodeWatchTimer = null;
    let lastEpisodeIdentity = null;
    let submitCountdownTimer = null;

    // ─── Helpers ────────────────────────────────────────────────────────

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function defaultCache() {
        return {
            introStart: null, introEnd: null, outroStart: null, outroEnd: null,
            updatedAt: null
        };
    }

    function getFallbackEpisodeIdentity() {
        try {
            const path = location.pathname.replace(/^\/+|\/+$/g, '');
            const nestedWatchMatch = path.match(/^watch\/([^/]+)\/([^/]+)$/i);
            if (nestedWatchMatch) {
                const animeSlug = nestedWatchMatch[1];
                const episodeMatch = nestedWatchMatch[2].match(/(?:^|[-_])ep(?:isode)?[-_]?(\d+)/i)
                    || nestedWatchMatch[2].match(/(\d+)/);
                const episodeNumber = parseInt(episodeMatch?.[1], 10);
                if (animeSlug && Number.isFinite(episodeNumber) && episodeNumber > 0) {
                    return `${animeSlug}__episode-${episodeNumber}`;
                }
            }

            const flatWatchMatch = path.match(/^watch\/(.+?)-episode-(\d+)(?:$|[/?#])/i);
            if (flatWatchMatch) {
                return `${flatWatchMatch[1]}__episode-${parseInt(flatWatchMatch[2], 10)}`;
            }

            return path;
        } catch {
            return 'unknown';
        }
    }

    function parseEpisodeNumberFromText(text) {
        if (!text || typeof text !== 'string') return 0;
        const match = text.match(/Episode\s*(\d+)/i)
            || text.match(/\bEp\s*(\d+)/i)
            || text.match(/\b(\d+)\b/);
        const value = parseInt(match?.[1], 10);
        return Number.isFinite(value) && value > 0 ? value : 0;
    }

    function getEpisodeNumberFromDom() {
        const selectors = [
            '.episode-list-item.current-episode',
            '.episode-list-item.active',
            '.episode-list .active',
            '.episodes .current',
            '[data-open-nav-episode].current-episode',
            '[data-open-nav-episode].active'
        ];

        for (const selector of selectors) {
            const node = document.querySelector(selector);
            if (!node) continue;

            const directValue = node.getAttribute?.('data-episode-search-query')
                || node.getAttribute?.('data-open-nav-episode')
                || node.dataset?.episodeSearchQuery
                || node.dataset?.openNavEpisode;
            const directNumber = parseInt(directValue, 10);
            if (Number.isFinite(directNumber) && directNumber > 0) return directNumber;

            const href = node.getAttribute?.('href')
                || node.querySelector?.('a[href]')?.getAttribute?.('href')
                || '';
            const hrefMatch = href.match(/-episode-(\d+)(?:$|[/?#])/i);
            const hrefNumber = parseInt(hrefMatch?.[1], 10);
            if (Number.isFinite(hrefNumber) && hrefNumber > 0) return hrefNumber;

            const textNumber = parseEpisodeNumberFromText(node.textContent || node.getAttribute?.('title') || '');
            if (textNumber > 0) return textNumber;
        }

        return 0;
    }

    function getEpisodeIdentity() {
        const domEpisodeNumber = getEpisodeNumberFromDom();
        try {
            const info = window.AnimeTrackerContent?.AnimeParser?.extractAnimeInfo?.();
            if (info?.animeSlug && domEpisodeNumber > 0) {
                return `${info.animeSlug}__episode-${domEpisodeNumber}`;
            }
            if (info?.animeSlug && Number.isFinite(Number(info.episodeNumber)) && Number(info.episodeNumber) > 0) {
                return `${info.animeSlug}__episode-${Number(info.episodeNumber)}`;
            }
        } catch (e) {
            Logger.debug('Skiptime: AnimeParser identity lookup failed', e);
        }
        return getFallbackEpisodeIdentity();
    }

    function cacheKey() {
        // Key per actual parsed episode, not full href. This keeps the helper
        // stable through in-page URL noise while still resetting on real
        // episode changes.
        return STORAGE_CACHE_PREFIX + getEpisodeIdentity();
    }

    function cancelSubmitCountdown() {
        if (!submitCountdownTimer) return;
        clearInterval(submitCountdownTimer);
        submitCountdownTimer = null;
    }

    async function handleEpisodeIdentityChange(nextEpisodeIdentity) {
        if (!nextEpisodeIdentity || nextEpisodeIdentity === lastEpisodeIdentity) return;
        lastEpisodeIdentity = nextEpisodeIdentity;
        Logger.info('Skiptime: episode changed, refreshing panel state');

        cancelSubmitCountdown();
        video = getVideoElement();
        setDropdownOpen(false);

        if (mounted && panelEl?.isConnected) {
            await refreshPanelState();
            return;
        }

        scheduleMount();
    }

    async function loadCache() {
        try {
            const key = cacheKey();
            const result = await chrome.storage.local.get([key]);
            const stored = result[key];
            if (!stored) return defaultCache();
            // Auto-prune stale caches.
            if (stored.updatedAt) {
                const age = Date.now() - new Date(stored.updatedAt).getTime();
                if (age > CACHE_TTL_MS) {
                    await chrome.storage.local.remove([key]);
                    return defaultCache();
                }
            }
            return { ...defaultCache(), ...stored };
        } catch (e) {
            Logger.warn('Skiptime: loadCache failed', e);
            return defaultCache();
        }
    }

    async function saveCache(cache) {
        try {
            const key = cacheKey();
            const next = { ...cache, updatedAt: new Date().toISOString() };
            await chrome.storage.local.set({ [key]: next });
        } catch (e) {
            Logger.warn('Skiptime: saveCache failed', e);
        }
    }

    async function clearCache() {
        try {
            const key = cacheKey();
            await chrome.storage.local.remove([key]);
        } catch {}
    }

    function isComplete(cache) {
        return !!(cache.introStart && cache.introEnd && cache.outroStart && cache.outroEnd);
    }

    function formatTime(seconds) {
        const total = Math.max(0, Math.floor(Number(seconds) || 0));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
    }

    function parseTimeToSeconds(text) {
        if (!text || typeof text !== 'string') return 0;
        const parts = text.trim().split(':').map(Number);
        if (parts.some(Number.isNaN)) return 0;
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        return 0;
    }

    function getVideoMonitorVideo() {
        try {
            const monitor = window.AnimeTrackerContent?.VideoMonitor;
            if (typeof monitor?.findVideo === 'function') {
                const found = monitor.findVideo();
                if (found) return found;
            }
        } catch (e) {
            Logger.debug('Skiptime: VideoMonitor lookup failed', e);
        }
        return null;
    }

    function queryVideoInDocument(doc) {
        if (!doc?.querySelector) return null;
        return doc.querySelector('video.art-video') || doc.querySelector('video');
    }

    function findIframeVideo() {
        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                const iframeVideo = queryVideoInDocument(iframeDoc);
                if (iframeVideo) return iframeVideo;
            } catch (e) {
                Logger.debug('Skiptime: iframe video lookup skipped', e);
            }
        }
        return null;
    }

    function getSearchDocuments() {
        const docs = [];
        const seen = new Set();

        const pushDoc = (doc) => {
            if (!doc || seen.has(doc)) return;
            seen.add(doc);
            docs.push(doc);
        };

        pushDoc(video?.ownerDocument);
        pushDoc(document);

        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
            try {
                pushDoc(iframe.contentDocument || iframe.contentWindow?.document);
            } catch {}
        }

        return docs;
    }

    function isUsableControlsHost(host) {
        if (!host || !host.isConnected) return false;
        try {
            const rect = host.getBoundingClientRect();
            const style = host.ownerDocument?.defaultView?.getComputedStyle?.(host);
            if (style?.display === 'none' || style?.visibility === 'hidden') return false;
            return rect.width > 0 || rect.height > 0 || host.childElementCount >= 0;
        } catch {
            return true;
        }
    }

    function getControlsMountTarget() {
        for (const doc of getSearchDocuments()) {
            const centerHost = doc?.querySelector?.(CONTROL_HOST_SELECTOR);
            if (isUsableControlsHost(centerHost)) {
                return { host: centerHost, mode: 'center' };
            }

            const controlsHost = doc?.querySelector?.(CONTROL_HOST_FALLBACK_SELECTOR);
            if (isUsableControlsHost(controlsHost)) {
                return { host: controlsHost, mode: 'overlay-center' };
            }
        }
        return null;
    }

    function isVideoConnected(candidate) {
        return !!(candidate && candidate.isConnected);
    }

    function getVideoElement() {
        return getVideoMonitorVideo()
            || queryVideoInDocument(document)
            || findIframeVideo();
    }

    function findTimeControlText() {
        const docsToSearch = [];
        if (video?.ownerDocument) docsToSearch.push(video.ownerDocument);
        docsToSearch.push(document);

        for (const doc of docsToSearch) {
            const text = doc?.querySelector?.('.art-control-time')?.textContent?.trim();
            if (text && text.includes('/')) return text;
        }

        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                const text = iframeDoc?.querySelector?.('.art-control-time')?.textContent?.trim();
                if (text && text.includes('/')) return text;
            } catch {}
        }

        return '';
    }

    function getDurationSeconds() {
        // Lazy-resolve video so duration works even before the cached
        // reference catches up.
        if (!isVideoConnected(video)) video = getVideoElement();
        if (video && Number.isFinite(video.duration) && video.duration > 0) {
            return Math.floor(video.duration);
        }
        const text = findTimeControlText();
        if (!text.includes('/')) return 0;
        return parseTimeToSeconds(text.split('/')[1]?.trim());
    }

    // ─── Toast ──────────────────────────────────────────────────────────

    function showToast(message, type = 'info', ttl = 1800) {
        let toast = document.getElementById(TOAST_ID);
        if (!toast) {
            toast = document.createElement('div');
            toast.id = TOAST_ID;
            document.body.appendChild(toast);
        }
        toast.className = `at-skip-toast at-skip-toast--${type}`;
        toast.textContent = message;
        clearTimeout(toast._timer);
        if (ttl > 0) {
            toast._timer = setTimeout(() => { try { toast.remove(); } catch {} }, ttl);
        }
        return toast;
    }

    function showCountdownToast({ secondsLeft, onCancel }) {
        // Replace any existing toast (including the regular one). We render
        // a small action-button toast so the user can cancel auto-submit.
        const existing = document.getElementById(TOAST_ID);
        if (existing) { try { existing.remove(); } catch {} }

        const toast = document.createElement('div');
        toast.id = TOAST_ID;
        toast.className = 'at-skip-toast at-skip-toast--countdown';
        toast.innerHTML = `
            <span class="at-skip-toast-text"></span>
            <button class="at-skip-toast-cancel" type="button">Cancel</button>
        `;
        const textEl = toast.querySelector('.at-skip-toast-text');
        const cancelBtn = toast.querySelector('.at-skip-toast-cancel');
        textEl.textContent = `Submitting in ${secondsLeft}s…`;
        cancelBtn.addEventListener('click', () => {
            try { toast.remove(); } catch {}
            onCancel?.();
        });
        document.body.appendChild(toast);
        return { toast, textEl };
    }

    async function captureTimestamp(targetKey) {
        // Lazy-resolve the video element on every click so we don't need to
        // race the player initialization. The cached `video` reference may
        // still be null from mount time if the player loaded after us.
        if (!isVideoConnected(video)) {
            video = getVideoElement();
            if (video) {
                Logger.info('Skiptime: video resolved lazily, attaching metadata hooks');
                attachVideoMetadataHooks();
            }
        }
        if (!video) {
            showToast('Δεν βρέθηκε video — ξεκίνα την αναπαραγωγή πρώτα', 'error', 2600);
            return;
        }
        if (!Number.isFinite(video.currentTime)) {
            showToast('Το video δεν έχει φορτώσει ακόμα', 'error');
            return;
        }
        const target = TARGETS.find((t) => t.key === targetKey);
        if (!target) return;
        const time = formatTime(video.currentTime);

        const cache = await loadCache();
        cache[targetKey] = time;

        // Auto-fill Outro End from video duration the first time the user
        // captures any other slot (so submission can complete without
        // explicitly seeking to the very end of the episode).
        if (targetKey !== 'outroEnd' && !cache.outroEnd) {
            const dur = getDurationSeconds();
            if (dur > 0) cache.outroEnd = formatTime(dur);
        }

        await saveCache(cache);
        await refreshPanelState();
        showToast(`${target.label}: ${time}`, 'success');

        const fresh = await loadCache();
        if (isComplete(fresh)) {
            startAutoSubmitFlow(fresh);
        }
    }

    async function resetCache() {
        cancelSubmitCountdown();
        await clearCache();

        // Re-prime outro-end from video duration so subsequent captures still
        // hit the auto-complete path.
        const dur = getDurationSeconds();
        if (dur > 0) {
            await saveCache({ ...defaultCache(), outroEnd: formatTime(dur) });
        }

        await refreshPanelState();
        showToast('Reset. Outro End auto-filled.', 'info');
    }

    // ─── Auto-submit flow ───────────────────────────────────────────────

    function startAutoSubmitFlow(cache) {
        if (submitCountdownTimer) return; // already running

        let secondsLeft = 3;
        let cancelled = false;
        const { textEl } = showCountdownToast({
            secondsLeft,
            onCancel: () => { cancelled = true; }
        });

        submitCountdownTimer = setInterval(async () => {
            if (cancelled) {
                clearInterval(submitCountdownTimer);
                submitCountdownTimer = null;
                showToast('Auto-submit cancelled', 'info');
                return;
            }
            secondsLeft -= 1;
            if (secondsLeft > 0) {
                if (textEl) textEl.textContent = `Submitting in ${secondsLeft}s…`;
                return;
            }
            clearInterval(submitCountdownTimer);
            submitCountdownTimer = null;
            try {
                const ok = await applyAndSubmit(cache);
                if (ok) {
                    await clearCache();
                    await refreshPanelState();
                    showToast('Submitted ✓', 'success', 2400);
                }
            } catch (err) {
                Logger.warn('Skiptime: submit failed', err);
                showToast('Submit failed — try again', 'error', 2800);
            }
        }, 1000);
    }

    function findField(selector) {
        for (const doc of getSearchDocuments()) {
            const node = doc?.querySelector?.(selector);
            if (node) return node;
        }
        return null;
    }

    function findSkiptimeOpenButton() {
        const directMatch = findField('#an1-skiptime-btn');
        if (directMatch) return directMatch;

        const selectors = [
            '[data-target="#an1-skip-panel"]',
            '[aria-controls="an1-skip-panel"]',
            '[data-bs-target="#an1-skip-panel"]'
        ];
        for (const selector of selectors) {
            const node = findField(selector);
            if (node) return node;
        }

        const candidates = Array.from(document.querySelectorAll('button, a'));
        return candidates.find((node) => /add\s*skip\s*time|skip\s*time/i.test((node.textContent || '').trim())) || null;
    }

    function dispatchFieldEvents(field) {
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        field.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    /**
     * Wait for a DOM node matching `selector`. Uses MutationObserver instead
     * of poll-and-sleep — instant resolve when the node appears.
     */
    function waitForSelector(selector, timeoutMs = 3500) {
        return new Promise((resolve) => {
            const existing = document.querySelector(selector);
            if (existing) return resolve(existing);

            let resolved = false;
            const obs = new MutationObserver(() => {
                const node = document.querySelector(selector);
                if (node && !resolved) {
                    resolved = true;
                    obs.disconnect();
                    resolve(node);
                }
            });
            obs.observe(document.documentElement, { childList: true, subtree: true });
            setTimeout(() => {
                if (resolved) return;
                resolved = true;
                obs.disconnect();
                resolve(null);
            }, timeoutMs);
        });
    }

    async function ensureSkipPanelOpen() {
        if (findField('#an1-skip-panel')) return true;
        const openBtn = findSkiptimeOpenButton();
        if (!openBtn) {
            showToast('Add Skiptime button not found', 'error');
            return false;
        }
        openBtn.click();
        const panel = await waitForSelector('#an1-skip-panel', 3500);
        if (!panel) {
            showToast('Skiptime panel did not open', 'error');
            return false;
        }
        return true;
    }

    async function applyAndSubmit(cache) {
        const ok = await ensureSkipPanelOpen();
        if (!ok) return false;

        // Disable the site's auto-link toggles so they don't overwrite our
        // manually captured outro-end with `intro+89s`.
        const introToggle = findField('#intro-toggle');
        const outroToggle = findField('#outro-toggle');
        if (introToggle) introToggle.dataset.linked = 'false';
        if (outroToggle) outroToggle.dataset.linked = 'false';

        for (const t of TARGETS) {
            const field = await waitForSelector('#' + t.fieldId, 3000);
            if (!field) {
                showToast(`Field #${t.fieldId} not found`, 'error');
                return false;
            }
            field.textContent = cache[t.key];
            dispatchFieldEvents(field);
        }

        await sleep(250);

        const submitBtn = findField('#an1-save-btn');
        if (!submitBtn) {
            showToast('Submit button not found', 'error');
            return false;
        }
        if (submitBtn.disabled || submitBtn.hasAttribute('disabled')) {
            showToast('Solve captcha then click Contribute', 'info', 3500);
            return false;
        }
        submitBtn.click();
        return true;
    }

    function attachVideoMetadataHooks() {
        if (!video) return;
        const primeOutroEnd = async () => {
            const cache = await loadCache();
            if (cache.outroEnd) { await refreshPanelState(); return; }
            const dur = getDurationSeconds();
            if (dur > 0) {
                cache.outroEnd = formatTime(dur);
                await saveCache(cache);
            }
            await refreshPanelState();
        };
        if (video.readyState >= 1) primeOutroEnd();
        video.addEventListener('loadedmetadata', primeOutroEnd, { once: true });
        video.addEventListener('durationchange', primeOutroEnd);
    }

    function getControlsHost() {
        return getControlsMountTarget()?.host || null;
    }

    function setDropdownOpen(nextOpen) {
        if (!panelEl) return;
        const isOpen = nextOpen === true;
        panelEl.classList.toggle('is-open', isOpen);
        const toggle = panelEl.querySelector('.at-skip-toggle');
        const dropdown = panelEl.querySelector('.at-skip-dropdown');
        if (toggle) toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        if (dropdown) dropdown.hidden = !isOpen;
    }

    function onDocumentPointerDown(event) {
        if (!panelEl || panelEl.contains(event.target)) return;
        setDropdownOpen(false);
    }

    function ensureControlsHostVisible(host) {
        if (!host) return;
        try { host.style.overflow = 'visible'; } catch {}
        try { if (host.parentElement) host.parentElement.style.overflow = 'visible'; } catch {}
        try { host.closest('.art-controls')?.style.setProperty('overflow', 'visible'); } catch {}
        try { host.closest('.art-bottom')?.style.setProperty('overflow', 'visible'); } catch {}
        try {
            const controls = host.closest('.art-controls');
            if (controls) {
                const view = controls.ownerDocument?.defaultView;
                const pos = view?.getComputedStyle?.(controls)?.position;
                if (!pos || pos === 'static') controls.style.position = 'relative';
            }
        } catch {}
    }

    function ensureControlsObserver() {
        if (controlsObserver || !helperEnabled) return;
        controlsObserver = new MutationObserver(() => {
            if (!helperEnabled) return;
            const host = getControlsHost();
            if (host) ensureControlsHostVisible(host);

            if (mountInProgress) return;
            if (mounted && panelEl?.isConnected) return;
            if (!host) return;

            Logger.info('Skiptime: controls host available, mounting dropdown');
            mountPanel();
        });

        const observeTargets = getSearchDocuments()
            .map((doc) => doc?.documentElement)
            .filter(Boolean);

        if (observeTargets.length === 0) return;
        observeTargets.forEach((target) => {
            try {
                controlsObserver.observe(target, { childList: true, subtree: true });
            } catch {}
        });
    }

    function ensureEpisodeWatcher() {
        if (episodeWatchTimer || !helperEnabled) return;
        episodeWatchTimer = setInterval(() => {
            if (!helperEnabled) return;
            const nextEpisodeIdentity = getEpisodeIdentity();
            if (!nextEpisodeIdentity || nextEpisodeIdentity === lastEpisodeIdentity) return;
            handleEpisodeIdentityChange(nextEpisodeIdentity).catch((e) => {
                Logger.debug('Skiptime: episode watcher refresh failed', e);
            });
        }, 1000);
    }

    function injectStyles(targetDoc = document) {
        if (!targetDoc) return;
        if (targetDoc.getElementById(STYLE_ID)) return;
        const style = targetDoc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
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
            #${PANEL_ID} .at-skip-progress {
                font-size: 10px;
                font-weight: 700;
                color: rgba(255, 255, 255, 0.5);
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
        (targetDoc.head || targetDoc.documentElement).appendChild(style);
    }

    function buildPanelHtml() {
        const rows = TARGETS.map((t) => `
            <button class="at-skip-row" type="button" data-key="${t.key}" data-captured="false">
                <span class="at-skip-key">${t.shortcut}</span>
                <span class="at-skip-label">${t.label}</span>
                <span class="at-skip-time">--:--:--</span>
            </button>
        `).join('');

        return `
            <button class="at-skip-toggle" type="button" aria-haspopup="true" aria-expanded="false">
                <span class="at-skip-toggle-dot" aria-hidden="true"></span>
                <span class="at-skip-toggle-label">Skiptime</span>
                <span class="at-skip-toggle-count">0/4</span>
            </button>
            <div class="at-skip-dropdown" hidden>
                <div class="at-skip-header">
                    <div class="at-skip-heading">
                        <span class="at-skip-title">Skip Time Helper</span>
                        <span class="at-skip-subtitle">1-4 capture, 0 reset</span>
                    </div>
                    <button class="at-skip-close" type="button" aria-label="Disable helper">×</button>
                </div>
                <div class="at-skip-rows">${rows}</div>
                <div class="at-skip-footer">
                    <button class="at-skip-reset" type="button">Reset</button>
                    <span class="at-skip-progress">0/4 captured</span>
                </div>
            </div>
        `;
    }

    async function refreshPanelState() {
        if (!panelEl) return;
        const cache = await loadCache();
        let captured = 0;
        TARGETS.forEach((t) => {
            const row = panelEl.querySelector(`.at-skip-row[data-key="${t.key}"]`);
            if (!row) return;
            const value = cache[t.key];
            if (value) {
                captured++;
                row.dataset.captured = 'true';
                const timeEl = row.querySelector('.at-skip-time');
                if (timeEl) timeEl.textContent = value;
            } else {
                row.dataset.captured = 'false';
                const timeEl = row.querySelector('.at-skip-time');
                if (timeEl) timeEl.textContent = '--:--:--';
            }
        });
        const progressEl = panelEl.querySelector('.at-skip-progress');
        if (progressEl) progressEl.textContent = `${captured}/4 captured`;
        const countEl = panelEl.querySelector('.at-skip-toggle-count');
        if (countEl) countEl.textContent = `${captured}/4`;
        panelEl.classList.toggle('is-active', captured > 0);
        panelEl.classList.toggle('is-complete', captured === 4);
        return cache;
    }

    async function mountPanel() {
        Logger.info('Skiptime: mountPanel() entered, mounted=', mounted, 'video=', !!video);

        if (mountInProgress) return;
        if (mounted && panelEl?.isConnected) return;
        if (mounted && !panelEl?.isConnected) {
            mounted = false;
            panelEl = null;
        }

        try {
            const mountTarget = getControlsMountTarget();
            const host = mountTarget?.host;
            if (!host || !mountTarget) {
                Logger.info('Skiptime: controls host not ready yet');
                ensureControlsObserver();
                return;
            }

            const existingPanel = host.querySelector(`#${PANEL_ID}`);
            if (existingPanel) {
                panelEl = existingPanel;
                panelDoc = host.ownerDocument || document;
                mounted = true;
                Logger.info('Skiptime: existing dropdown found, skipping duplicate mount');
                return;
            }

            mountInProgress = true;

            panelDoc = host.ownerDocument || document;
            injectStyles(panelDoc);
            Logger.info('Skiptime: styles injected');
            ensureControlsHostVisible(host);

            panelEl = panelDoc.createElement('div');
            panelEl.id = PANEL_ID;
            panelEl.classList.toggle('at-skip-overlay-center', mountTarget.mode === 'overlay-center');
            panelEl.innerHTML = buildPanelHtml();
            host.appendChild(panelEl);
            Logger.info(`Skiptime: dropdown appended to ${mountTarget.mode}`);

            panelEl.querySelector('.at-skip-toggle')?.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                setDropdownOpen(!panelEl.classList.contains('is-open'));
            });

            panelEl.querySelectorAll('.at-skip-row').forEach((row) => {
                row.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    captureTimestamp(row.dataset.key);
                });
            });

            panelEl.querySelector('.at-skip-reset')?.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                resetCache();
            });

            const closeBtn = panelEl.querySelector('.at-skip-close');
            if (closeBtn) {
                closeBtn.textContent = 'Off';
                closeBtn.addEventListener('click', async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    try { await chrome.storage.local.set({ [STORAGE_TOGGLE_KEY]: false }); }
                    catch {}
                });
            }

            if (video) attachVideoMetadataHooks();

            panelDoc.addEventListener('keydown', onKeyDown, true);
            panelDoc.addEventListener('pointerdown', onDocumentPointerDown, true);
            if (panelDoc !== document) {
                document.addEventListener('keydown', onKeyDown, true);
                document.addEventListener('pointerdown', onDocumentPointerDown, true);
            }

            if (!urlObserver) {
                urlObserver = new MutationObserver(() => {
                    const nextEpisodeIdentity = getEpisodeIdentity();
                    if (!nextEpisodeIdentity || nextEpisodeIdentity === lastEpisodeIdentity) return;
                    handleEpisodeIdentityChange(nextEpisodeIdentity).catch((e) => {
                        Logger.debug('Skiptime: mutation-driven refresh failed', e);
                    });
                });
                if (document.body) {
                    urlObserver.observe(document.body, { childList: true, subtree: true });
                }
            }

            await refreshPanelState();
            setDropdownOpen(false);
            mounted = true;
            Logger.info('Skiptime helper mounted inside controls');

            // ArtPlayer can re-render the controls immediately after we inject.
            // Re-arm observation and verify the panel actually survived.
            ensureControlsObserver();
            ensureEpisodeWatcher();
            setTimeout(() => {
                if (!helperEnabled || mountInProgress) return;
                if (panelEl?.isConnected) return;
                Logger.info('Skiptime: dropdown was removed after mount, retrying');
                mounted = false;
                panelEl = null;
                panelDoc = null;
                scheduleMount();
            }, 250);
        } catch (err) {
            Logger.info('Skiptime: mountPanel CRASHED with error:', err && err.message ? err.message : String(err));
            console.error('[Skiptime] full error:', err);
        } finally {
            mountInProgress = false;
        }
    }

    function unmountPanel() {
        cancelSubmitCountdown();
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('pointerdown', onDocumentPointerDown, true);
        if (panelDoc && panelDoc !== document) {
            panelDoc.removeEventListener('keydown', onKeyDown, true);
            panelDoc.removeEventListener('pointerdown', onDocumentPointerDown, true);
        }
        if (videoObserver) {
            videoObserver.disconnect();
            videoObserver = null;
        }
        if (controlsObserver) {
            controlsObserver.disconnect();
            controlsObserver = null;
        }
        if (urlObserver) {
            urlObserver.disconnect();
            urlObserver = null;
        }
        if (episodeWatchTimer) {
            clearInterval(episodeWatchTimer);
            episodeWatchTimer = null;
        }
        if (panelEl) { try { panelEl.remove(); } catch {} panelEl = null; }
        panelDoc = null;
        const toast = document.getElementById(TOAST_ID);
        if (toast) { try { toast.remove(); } catch {} }
        mountInProgress = false;
        mounted = false;
    }

    function onKeyDown(e) {
        if (e.key === 'Escape' && panelEl?.classList.contains('is-open')) {
            e.preventDefault();
            setDropdownOpen(false);
            return;
        }

        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

        if (e.key === '0') { e.preventDefault(); resetCache(); return; }
        const target = TARGETS.find((x) => x.shortcut === e.key);
        if (target) { e.preventDefault(); captureTimestamp(target.key); }
    }

    function scheduleMount() {
        if (!helperEnabled) return;

        Logger.info('Skiptime: scheduleMount -> controls dropdown');
        lastEpisodeIdentity = getEpisodeIdentity();
        video = getVideoElement();
        ensureControlsObserver();
        ensureEpisodeWatcher();
        mountPanel();

        if (!video) {
            if (videoObserver) videoObserver.disconnect();
            const startTime = Date.now();
            videoObserver = new MutationObserver(() => {
                const v = getVideoElement();
                if (v && !video) {
                    video = v;
                    videoObserver.disconnect();
                    videoObserver = null;
                    Logger.info('Skiptime: video element appeared, attaching metadata hook');
                    attachVideoMetadataHooks();
                    return;
                }
                if (Date.now() - startTime > 15000) {
                    videoObserver.disconnect();
                    videoObserver = null;
                }
            });
            videoObserver.observe(document.documentElement, { childList: true, subtree: true });
        }
    }

    async function applyEnabledState(enabled) {
        helperEnabled = enabled === true;
        if (helperEnabled) scheduleMount();
        else unmountPanel();
    }

    function listenForToggleChanges() {
        if (toggleListener) return;
        toggleListener = (changes, namespace) => {
            if (namespace !== 'local') return;
            if (!changes[STORAGE_TOGGLE_KEY]) return;
            const next = changes[STORAGE_TOGGLE_KEY].newValue === true;
            applyEnabledState(next);
        };
        chrome.storage.onChanged.addListener(toggleListener);
    }

    async function init() {
        Logger.info('Skiptime: init() running on', location.pathname);
        lastEpisodeIdentity = getEpisodeIdentity();
        listenForToggleChanges();
        try {
            const result = await chrome.storage.local.get([STORAGE_TOGGLE_KEY]);
            const enabled = result[STORAGE_TOGGLE_KEY] === true;
            Logger.info('Skiptime: toggle state =', enabled);
            helperEnabled = enabled;
            if (enabled) {
                Logger.info('Skiptime: scheduling mount for controls dropdown');
                await applyEnabledState(true);
            } else {
                Logger.info('Skiptime: helper is OFF - toggle from popup Settings -> Playback & Tracking');
            }
        } catch (e) {
            Logger.warn('Skiptime: init failed', e);
        }
    }

    // Public API for tests / future popup integrations.
    window.AnimeTrackerContent = window.AnimeTrackerContent || {};
    window.AnimeTrackerContent.SkiptimeHelper = {
        mount: scheduleMount,
        unmount: unmountPanel,
        isMounted: () => mounted
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
