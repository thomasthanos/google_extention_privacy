/**
 * Anime Tracker — In-popup Debug Console
 *
 * Captures every call to PopupLogger (and console.error / console.warn)
 * into a ring buffer, persists to chrome.storage.local so logs survive
 * popup close/reopen, and renders an overlay panel showing them.
 *
 * Critical for mobile users (Orion / Safari) who can't open popup DevTools
 * to diagnose sync issues.
 *
 * Public API: window.AnimeTracker.DebugConsole.show()
 * Persistence key: 'debugConsoleLogs' (capped at 200 entries)
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'debugConsoleLogs';
    const MAX_ENTRIES = 200;
    const FLUSH_DEBOUNCE_MS = 800;

    // Ring buffer of in-memory entries. Loaded from storage on init so
    // pre-popup-open logs are still visible.
    let entries = [];
    let flushTimer = null;
    let unflushedCount = 0;

    function pushEntry(level, tag, message, args) {
        const ts = Date.now();
        // Stringify args defensively — they may contain Error objects, DOM
        // nodes, circular refs, etc. We never want logging itself to throw.
        let payload = '';
        try {
            payload = (args || [])
                .filter((a) => a !== undefined)
                .map((a) => {
                    if (a instanceof Error) return `${a.name}: ${a.message}`;
                    if (typeof a === 'string') return a;
                    if (typeof a === 'number' || typeof a === 'boolean') return String(a);
                    try { return JSON.stringify(a); }
                    catch { return '[unserializable]'; }
                })
                .join(' ');
        } catch { /* swallow */ }

        const entry = {
            ts,
            level: String(level || 'LOG').toUpperCase(),
            tag: tag ? String(tag).slice(0, 24) : '',
            message: String(message ?? '').slice(0, 500),
            extras: payload.slice(0, 800)
        };

        entries.push(entry);
        if (entries.length > MAX_ENTRIES) {
            entries.splice(0, entries.length - MAX_ENTRIES);
        }
        unflushedCount++;
        scheduleFlush();
    }

    function scheduleFlush() {
        if (flushTimer) return;
        flushTimer = setTimeout(async () => {
            flushTimer = null;
            const toWrite = entries.slice(); // snapshot
            unflushedCount = 0;
            try {
                await chrome.storage.local.set({ [STORAGE_KEY]: toWrite });
            } catch (e) {
                // Don't log here — would re-enter the buffer and recurse.
                try { console.error('[DebugConsole] flush failed:', e.message); } catch {}
            }
        }, FLUSH_DEBOUNCE_MS);
    }

    /**
     * Hook into PopupLogger so every log call is captured.
     * The native console.* calls inside PopupLogger.log still happen — we
     * just additionally push to our buffer.
     */
    function installPopupLoggerHook() {
        const PL = window.PopupLogger;
        if (!PL || PL.__debugConsoleHooked) return;
        const origLog = PL.log.bind(PL);
        PL.log = function (level, message, ...args) {
            // Convention: many existing call sites use `PopupLogger.warn('Tag', 'msg', ...)`
            // — i.e. message arg is the tag, first extra is the actual text.
            // We treat the second arg as the body when first looks tag-like
            // (short, no spaces) AND there's at least one extra.
            let tag = '';
            let body = message;
            let extras = args;
            if (typeof message === 'string'
                && message.length > 0 && message.length < 24
                && !/\s/.test(message)
                && args.length > 0
                && typeof args[0] === 'string') {
                tag = message;
                body = args[0];
                extras = args.slice(1);
            }
            try { pushEntry(level, tag, body, extras); }
            catch { /* never break logging */ }
            return origLog(level, message, ...args);
        };
        PL.__debugConsoleHooked = true;
    }

    /**
     * Hook native console.error / console.warn so unhandled errors and
     * library warnings still land in our buffer. Skipped for console.log
     * because it would double-capture every PopupLogger call.
     */
    function installConsoleHook() {
        if (window.__debugConsoleNativeHooked) return;
        const origError = console.error.bind(console);
        const origWarn = console.warn.bind(console);
        console.error = function (...args) {
            try { pushEntry('ERROR', '', args[0], args.slice(1)); } catch {}
            return origError(...args);
        };
        console.warn = function (...args) {
            try { pushEntry('WARN', '', args[0], args.slice(1)); } catch {}
            return origWarn(...args);
        };

        // Catch uncaught errors and unhandled rejections — these are exactly
        // what mobile users need to see when something breaks silently.
        window.addEventListener('error', (ev) => {
            try {
                pushEntry('ERROR', 'window', ev.message || 'Uncaught error', [
                    `${ev.filename}:${ev.lineno}:${ev.colno}`
                ]);
            } catch {}
        });
        window.addEventListener('unhandledrejection', (ev) => {
            try {
                const reason = ev.reason;
                const msg = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
                pushEntry('ERROR', 'promise', msg, []);
            } catch {}
        });

        window.__debugConsoleNativeHooked = true;
    }

    async function loadPersisted() {
        try {
            const stored = await chrome.storage.local.get([STORAGE_KEY]);
            const arr = stored[STORAGE_KEY];
            if (Array.isArray(arr)) {
                entries = arr.slice(-MAX_ENTRIES);
            }
        } catch { /* fresh start */ }
    }

    // ── UI ──────────────────────────────────────────────────────────────

    function fmtTime(ts) {
        const d = new Date(ts);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        const ms = String(d.getMilliseconds()).padStart(3, '0');
        return `${hh}:${mm}:${ss}.${ms}`;
    }

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }

    function renderEntries(listEl, filter) {
        const f = (filter || '').toLowerCase();
        const filtered = entries.filter((e) => {
            if (!f) return true;
            return e.message.toLowerCase().includes(f)
                || e.tag.toLowerCase().includes(f)
                || e.extras.toLowerCase().includes(f)
                || e.level.toLowerCase().includes(f);
        });

        if (filtered.length === 0) {
            listEl.innerHTML = '<div class="dbg-empty">No log entries match.</div>';
            return;
        }

        listEl.innerHTML = filtered.slice().reverse().map((e) => {
            const lvlClass = `dbg-lvl-${e.level.toLowerCase()}`;
            return `
                <div class="dbg-entry ${lvlClass}">
                    <div class="dbg-row">
                        <span class="dbg-time">${fmtTime(e.ts)}</span>
                        <span class="dbg-level">${escapeHtml(e.level)}</span>
                        ${e.tag ? `<span class="dbg-tag">${escapeHtml(e.tag)}</span>` : ''}
                    </div>
                    <div class="dbg-msg">${escapeHtml(e.message)}</div>
                    ${e.extras ? `<div class="dbg-extras">${escapeHtml(e.extras)}</div>` : ''}
                </div>
            `;
        }).join('');
    }

    let overlayEl = null;

    function show() {
        if (overlayEl) {
            overlayEl.querySelector('.dbg-list')?.scrollTo?.(0, 0);
            return;
        }

        overlayEl = document.createElement('div');
        overlayEl.className = 'debug-console-overlay';
        overlayEl.innerHTML = `
            <div class="debug-console-panel">
                <div class="dbg-header">
                    <span class="dbg-title">Debug Console <span class="dbg-count">(${entries.length})</span></span>
                    <button type="button" class="dbg-btn dbg-btn-close" data-action="close" title="Close" aria-label="Close">✕</button>
                </div>
                <div class="dbg-toolbar">
                    <input type="search" class="dbg-filter" placeholder="Filter logs…" autocomplete="off">
                    <button type="button" class="dbg-btn-action dbg-btn-copy" data-action="copy">
                        <span class="dbg-btn-icon">📋</span>
                        <span class="dbg-btn-label">Copy all</span>
                    </button>
                    <button type="button" class="dbg-btn-action dbg-btn-clear" data-action="clear">
                        <span class="dbg-btn-icon">🗑</span>
                        <span class="dbg-btn-label">Clear</span>
                    </button>
                </div>
                <div class="dbg-list"></div>
                <div class="dbg-footer">
                    Newest first · max ${MAX_ENTRIES} entries · persisted across popup reloads
                </div>
            </div>
        `;
        document.body.appendChild(overlayEl);

        const listEl = overlayEl.querySelector('.dbg-list');
        const filterEl = overlayEl.querySelector('.dbg-filter');

        const refresh = () => {
            renderEntries(listEl, filterEl.value);
            const countEl = overlayEl.querySelector('.dbg-count');
            if (countEl) countEl.textContent = `(${entries.length})`;
        };

        filterEl.addEventListener('input', refresh);

        // Click handler — explicit data-action only. Backdrop click does
        // NOT close (was previously dismissing accidentally on mobile taps).
        overlayEl.addEventListener('click', async (e) => {
            const actionEl = e.target.closest('[data-action]');
            if (!actionEl) return;
            const action = actionEl.dataset.action;

            if (action === 'close') {
                overlayEl.remove();
                overlayEl = null;
            } else if (action === 'clear') {
                entries.length = 0;
                try { await chrome.storage.local.remove([STORAGE_KEY]); } catch {}
                refresh();
                actionEl.querySelector('.dbg-btn-label').textContent = 'Cleared';
                setTimeout(() => {
                    if (overlayEl) {
                        const lbl = overlayEl.querySelector('.dbg-btn-clear .dbg-btn-label');
                        if (lbl) lbl.textContent = 'Clear';
                    }
                }, 1500);
            } else if (action === 'copy') {
                const txt = entries.map((x) =>
                    `[${fmtTime(x.ts)}] ${x.level}${x.tag ? ' ' + x.tag : ''} ${x.message}${x.extras ? ' | ' + x.extras : ''}`
                ).join('\n');
                let copied = false;
                try {
                    await navigator.clipboard.writeText(txt);
                    copied = true;
                } catch { /* clipboard blocked, fallback below */ }

                if (copied) {
                    const lbl = actionEl.querySelector('.dbg-btn-label');
                    const icon = actionEl.querySelector('.dbg-btn-icon');
                    const origLbl = lbl.textContent;
                    const origIcon = icon.textContent;
                    lbl.textContent = 'Copied!';
                    icon.textContent = '✓';
                    actionEl.classList.add('dbg-btn-action-success');
                    setTimeout(() => {
                        if (overlayEl) {
                            const lbl2 = overlayEl.querySelector('.dbg-btn-copy .dbg-btn-label');
                            const icon2 = overlayEl.querySelector('.dbg-btn-copy .dbg-btn-icon');
                            const btn2 = overlayEl.querySelector('.dbg-btn-copy');
                            if (lbl2) lbl2.textContent = origLbl;
                            if (icon2) icon2.textContent = origIcon;
                            btn2?.classList.remove('dbg-btn-action-success');
                        }
                    }, 1800);
                } else {
                    // Clipboard might be blocked on Orion — show a textarea
                    // overlay so the user can manually long-press → copy.
                    showCopyFallback(txt);
                }
            }
        });

        refresh();

        // Live-refresh every 2s while panel is open so new logs appear
        const liveTimer = setInterval(() => {
            if (!overlayEl) { clearInterval(liveTimer); return; }
            refresh();
        }, 2000);
    }

    function showCopyFallback(text) {
        const wrap = document.createElement('div');
        wrap.className = 'dbg-copy-fallback';
        wrap.innerHTML = `
            <div class="dbg-copy-fallback-inner">
                <div class="dbg-copy-fallback-header">
                    <span>Long-press inside the box → Select all → Copy</span>
                    <button type="button" class="dbg-btn-close" data-close>✕</button>
                </div>
                <textarea readonly></textarea>
            </div>
        `;
        wrap.querySelector('textarea').value = text;
        wrap.addEventListener('click', (e) => {
            if (e.target?.dataset?.close !== undefined) wrap.remove();
        });
        document.body.appendChild(wrap);
        const ta = wrap.querySelector('textarea');
        ta.focus();
        try { ta.setSelectionRange(0, text.length); } catch {}
    }

    // ── Initialize on script-parse ─────────────────────────────────────
    installConsoleHook();
    installPopupLoggerHook();
    loadPersisted();

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.DebugConsole = {
        show,
        push: pushEntry,
        getEntries: () => entries.slice()
    };
})();
