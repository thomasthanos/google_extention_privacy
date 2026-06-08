

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

    const Logger = window.AnimeTrackerContent?.Logger || {
        info: () => {}, debug: () => {}, error: () => {}, warn: () => {}, success: () => {},
        once: () => {}, throttled: () => {}
    };

    // Pure helpers + static config (TARGETS) live in skiptime-utils.js.
    const U = window.AnimeTrackerContent && window.AnimeTrackerContent.SkiptimeUtils;
    if (!U) {
        (Logger.error || console.error)('Skiptime: SkiptimeUtils not loaded — aborting');
        return;
    }
    const {
        TARGETS,
        defaultCache,
        getEpisodeIdentity,
        isComplete,
        isSubmittable,
        formatTime,
        parseTimeToSeconds,
        queryVideoInDocument,
        isUsableControlsHost,
        dispatchFieldEvents,
        waitForSelector,
        buildPanelHtml
    } = U;

    let mounted = false;
    let mountInProgress = false;
    let panelEl = null;
    let panelDoc = null;
    let video = null;
    let helperEnabled = false;
    let toggleListener = null;
    let videoObserver = null;
    let controlsObserver = null;
    let controlsObserverThrottle = null;
    let urlObserver = null;
    let urlObserverThrottle = null;
    let episodeWatchTimer = null;
    let lastEpisodeIdentity = null;
    let submitCountdownTimer = null;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function cacheKey() {

        return STORAGE_CACHE_PREFIX + getEpisodeIdentity();
    }

    function cancelSubmitCountdown() {
        if (!submitCountdownTimer) return;
        clearInterval(submitCountdownTimer);
        submitCountdownTimer = null;
    }

    async function handleEpisodeIdentityChange(nextEpisodeIdentity) {
        if (!nextEpisodeIdentity || nextEpisodeIdentity === lastEpisodeIdentity) return;
        const previousEpisodeIdentity = lastEpisodeIdentity;
        lastEpisodeIdentity = nextEpisodeIdentity;
        Logger.debug('Skiptime: episode changed, refreshing panel state', {
            from: previousEpisodeIdentity,
            to: nextEpisodeIdentity
        });

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

        if (!isVideoConnected(video)) video = getVideoElement();
        if (video && Number.isFinite(video.duration) && video.duration > 0) {
            return Math.floor(video.duration);
        }
        const text = findTimeControlText();
        if (!text.includes('/')) return 0;
        return parseTimeToSeconds(text.split('/')[1]?.trim());
    }

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

        if (!isVideoConnected(video)) {
            video = getVideoElement();
            if (video) {
                Logger.debug('Skiptime: video resolved lazily, attaching metadata hooks');
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

        const dur = getDurationSeconds();
        if (dur > 0) {
            await saveCache({ ...defaultCache(), outroEnd: formatTime(dur) });
        }

        await refreshPanelState();
        showToast('Reset. Outro End auto-filled.', 'info');
    }

    function startAutoSubmitFlow(cache) {
        if (submitCountdownTimer) return;

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

    async function ensureSkipPanelOpen() {
        if (findField('#an1-skip-panel')) return true;
        const openBtn = findSkiptimeOpenButton();
        if (!openBtn) {
            Logger.throttled(
                `skiptime-open-btn-missing:${getEpisodeIdentity()}`,
                'WARN',
                10000,
                'Skiptime: Add Skiptime button not found',
                { episodeId: getEpisodeIdentity() }
            );
            showToast('Add Skiptime button not found', 'error');
            return false;
        }
        openBtn.click();
        const panel = await waitForSelector('#an1-skip-panel', 3500);
        if (!panel) {
            Logger.throttled(
                `skiptime-panel-open-timeout:${getEpisodeIdentity()}`,
                'WARN',
                10000,
                'Skiptime: panel did not open after trigger',
                { episodeId: getEpisodeIdentity() }
            );
            showToast('Skiptime panel did not open', 'error');
            return false;
        }
        return true;
    }

    async function applyAndSubmit(cache) {
        const ok = await ensureSkipPanelOpen();
        if (!ok) return false;

        const introToggle = findField('#intro-toggle');
        const outroToggle = findField('#outro-toggle');
        if (introToggle) introToggle.dataset.linked = 'false';
        if (outroToggle) outroToggle.dataset.linked = 'false';

        for (const t of TARGETS) {
            const value = cache[t.key];
            if (!value) continue;
            const field = await waitForSelector('#' + t.fieldId, 3000);
            if (!field) {
                showToast(`Field #${t.fieldId} not found`, 'error');
                return false;
            }
            field.textContent = value;
            dispatchFieldEvents(field);
        }

        await sleep(250);

        const submitBtn = findField('#an1-save-btn');
        if (!submitBtn) {
            Logger.warn('Skiptime: submit button not found', { episodeId: getEpisodeIdentity() });
            showToast('Submit button not found', 'error');
            return false;
        }
        if (submitBtn.disabled || submitBtn.hasAttribute('disabled')) {
            Logger.throttled(
                `skiptime-submit-blocked:${getEpisodeIdentity()}`,
                'WARN',
                10000,
                'Skiptime: submit blocked, captcha likely required',
                { episodeId: getEpisodeIdentity() }
            );
            showToast('Solve captcha then click Contribute', 'info', 3500);
            return false;
        }
        submitBtn.click();
        Logger.info(`Skiptime: contribution submitted (${getEpisodeIdentity()})`);
        return true;
    }

    let _metadataHookedVideo = null;
    let _metadataHookedHandler = null;
    function attachVideoMetadataHooks() {
        if (!video) return;
        if (_metadataHookedVideo === video) return;
        if (_metadataHookedVideo && _metadataHookedHandler) {
            try {
                _metadataHookedVideo.removeEventListener('durationchange', _metadataHookedHandler);
                _metadataHookedVideo.removeEventListener('loadedmetadata', _metadataHookedHandler);
            } catch {}
        }
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
        _metadataHookedVideo = video;
        _metadataHookedHandler = primeOutroEnd;
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

        const runCheck = () => {
            controlsObserverThrottle = null;
            if (!helperEnabled) return;
            const host = getControlsHost();
            if (host) ensureControlsHostVisible(host);

            if (mountInProgress) return;
            if (mounted && panelEl?.isConnected) return;
            if (!host) return;

            Logger.debug('Skiptime: controls host available, mounting dropdown');
            mountPanel();
        };
        controlsObserver = new MutationObserver(() => {
            if (controlsObserverThrottle) return;
            controlsObserverThrottle = setTimeout(runCheck, 250);
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
            if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') return;
            const nextEpisodeIdentity = getEpisodeIdentity();
            if (!nextEpisodeIdentity || nextEpisodeIdentity === lastEpisodeIdentity) return;
            handleEpisodeIdentityChange(nextEpisodeIdentity).catch((e) => {
                Logger.debug('Skiptime: episode watcher refresh failed', e);
            });
        }, 2500);
    }

    function injectStyles(targetDoc = document) {
        if (!targetDoc) return;
        if (targetDoc.getElementById(STYLE_ID)) return;
        const style = targetDoc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = window.AnimeTrackerContent.SkiptimeStyles?.(PANEL_ID, TOAST_ID) || '';
        (targetDoc.head || targetDoc.documentElement).appendChild(style);
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

        const submitBtn = panelEl.querySelector('.at-skip-submit');
        if (submitBtn) submitBtn.disabled = !isSubmittable(cache);

        return cache;
    }

    async function mountPanel() {
        Logger.debug(`Skiptime: mountPanel() entered (mounted=${mounted}, video=${!!video})`);

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
                Logger.debug('Skiptime: controls host not ready yet');
                ensureControlsObserver();
                return;
            }

            const existingPanel = host.querySelector(`#${PANEL_ID}`);
            if (existingPanel) {
                panelEl = existingPanel;
                panelDoc = host.ownerDocument || document;
                mounted = true;
                Logger.debug('Skiptime: existing dropdown found, skipping duplicate mount');
                return;
            }

            mountInProgress = true;

            panelDoc = host.ownerDocument || document;
            injectStyles(panelDoc);
            Logger.debug('Skiptime: styles injected');
            ensureControlsHostVisible(host);

            panelEl = panelDoc.createElement('div');
            panelEl.id = PANEL_ID;
            panelEl.classList.toggle('at-skip-overlay-center', mountTarget.mode === 'overlay-center');
            panelEl.innerHTML = buildPanelHtml();
            host.appendChild(panelEl);
            Logger.debug(`Skiptime: dropdown appended to ${mountTarget.mode}`);

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

            panelEl.querySelector('.at-skip-submit')?.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                const cache = await loadCache();
                if (!isSubmittable(cache)) {
                    showToast('Capture intro pair or outro pair first', 'info');
                    return;
                }
                cancelSubmitCountdown();
                try {
                    const ok = await applyAndSubmit(cache);
                    if (ok) {
                        await clearCache();
                        await refreshPanelState();
                        showToast('Submitted ✓', 'success', 2400);
                    }
                } catch (err) {
                    Logger.warn('Skiptime: manual submit failed', err);
                    showToast('Submit failed — try again', 'error', 2800);
                }
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

                const runIdentityCheck = () => {
                    urlObserverThrottle = null;
                    const nextEpisodeIdentity = getEpisodeIdentity();
                    if (!nextEpisodeIdentity || nextEpisodeIdentity === lastEpisodeIdentity) return;
                    handleEpisodeIdentityChange(nextEpisodeIdentity).catch((e) => {
                        Logger.debug('Skiptime: mutation-driven refresh failed', e);
                    });
                };
                urlObserver = new MutationObserver(() => {
                    if (urlObserverThrottle) return;
                    urlObserverThrottle = setTimeout(runIdentityCheck, 500);
                });
                if (document.body) {
                    urlObserver.observe(document.body, { childList: true, subtree: true });
                }
            }

            await refreshPanelState();
            setDropdownOpen(false);
            mounted = true;
            Logger.once(
                `skiptime-mounted:${lastEpisodeIdentity || 'unknown'}`,
                'INFO',
                'Skiptime helper mounted inside controls',
                {
                    episodeId: lastEpisodeIdentity || 'unknown',
                    mode: mountTarget.mode
                }
            );

            ensureControlsObserver();
            ensureEpisodeWatcher();
            setTimeout(() => {
                if (!helperEnabled || mountInProgress) return;
                if (panelEl?.isConnected) return;
                Logger.debug('Skiptime: dropdown was removed after mount, retrying');
                mounted = false;
                panelEl = null;
                panelDoc = null;
                scheduleMount();
            }, 250);
        } catch (err) {
            Logger.error('Skiptime: mountPanel crashed', err);
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
        if (controlsObserverThrottle) {
            clearTimeout(controlsObserverThrottle);
            controlsObserverThrottle = null;
        }
        if (urlObserver) {
            urlObserver.disconnect();
            urlObserver = null;
        }
        if (urlObserverThrottle) {
            clearTimeout(urlObserverThrottle);
            urlObserverThrottle = null;
        }
        if (episodeWatchTimer) {
            clearInterval(episodeWatchTimer);
            episodeWatchTimer = null;
        }
        if (_metadataHookedVideo && _metadataHookedHandler) {
            try {
                _metadataHookedVideo.removeEventListener('durationchange', _metadataHookedHandler);
                _metadataHookedVideo.removeEventListener('loadedmetadata', _metadataHookedHandler);
            } catch {}
            _metadataHookedVideo = null;
            _metadataHookedHandler = null;
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

        Logger.debug('Skiptime: scheduleMount -> controls dropdown');
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
                    Logger.debug('Skiptime: video element appeared, attaching metadata hook');
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
        Logger.debug('Skiptime: init() running on', location.pathname);
        lastEpisodeIdentity = getEpisodeIdentity();
        listenForToggleChanges();
        try {
            const result = await chrome.storage.local.get([STORAGE_TOGGLE_KEY]);
            const enabled = result[STORAGE_TOGGLE_KEY] === true;
            Logger.debug('Skiptime: toggle state =', enabled);
            helperEnabled = enabled;
            if (enabled) {
                Logger.debug('Skiptime: scheduling mount for controls dropdown');
                await applyEnabledState(true);
            } else {
                Logger.debug('Skiptime: helper is OFF - toggle from popup Settings -> Playback & Tracking');
            }
        } catch (e) {
            Logger.warn('Skiptime: init failed', e);
        }
    }

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
