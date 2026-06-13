






const FillerFetchUI = {
    IDS: {
        overlay:      'filler-fetch-ui-overlay',
        container:    'filler-fetch-ui-container',
        progressFill: 'filler-fetch-ui-progress-fill',
        progressText: 'filler-fetch-ui-progress-text',
        logFeed:      'filler-fetch-ui-log',
    },

    state: {
        isOpen:      false,
        isRunning:   false,
        isCancelled: false,
        fetchDone:   false,
        autoMode:    false,
        total:   0,
        fetched: 0,
        cached:  0,
        skipped: 0,
        failed:  0,
    },

    onComplete: null,



    init() {
        this.injectStyles();
        this.createModal();
        this.attachEventListeners();
    },



    createModal() {
        const { overlay, container, progressFill, progressText, logFeed } = this.IDS;

        const html = `
        <div id="${overlay}" class="ffui-overlay" style="display:none" aria-hidden="true">
          <div id="${container}" class="ffui-box" role="dialog" aria-modal="true" aria-labelledby="ffui-title" tabindex="-1">

            <div class="ffui-header">
              <span class="ffui-title" id="ffui-title"><span class="ffui-title-dot"></span>Fetch & Import</span>
            </div>

            <div class="ffui-body">

              <!-- Progress bar -->
              <div class="ffui-progress-wrap">
                <div class="ffui-progress-info">
                  <span id="${progressText}" class="ffui-progress-label">Ready…</span>
                  <span class="ffui-pct">0%</span>
                </div>
                <div class="ffui-bar"><div id="${progressFill}" class="ffui-bar-fill"></div></div>
              </div>

              <!-- Stats -->
              <div class="ffui-stats">
                <div class="ffui-stat">
                  <span class="ffui-stat-val ffui-stat-cyan" data-stat="fetched">0</span>
                  <span class="ffui-stat-lbl">Fetched</span>
                </div>
                <div class="ffui-stat">
                  <span class="ffui-stat-val" data-stat="cached">0</span>
                  <span class="ffui-stat-lbl">Cached</span>
                </div>
                <div class="ffui-stat">
                  <span class="ffui-stat-val" data-stat="skipped">0</span>
                  <span class="ffui-stat-lbl">No Filler</span>
                </div>
                <div class="ffui-stat">
                  <span class="ffui-stat-val ffui-stat-err" data-stat="failed">0</span>
                  <span class="ffui-stat-lbl">Failed</span>
                </div>
              </div>

              <!-- Live log -->
              <div id="${logFeed}" class="ffui-log" style="display:none"></div>

            </div>
          </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', html);
    },



    injectStyles() {
        if (document.getElementById('ffui-styles')) return;
        const css = `
        <style id="ffui-styles">

        .ffui-overlay {
            position:fixed; inset:0;
            background:
                radial-gradient(circle at 50% 12%, rgba(var(--primary-rgb),0.10), transparent 38%),
                rgba(var(--shadow-rgb), 0.66);
            backdrop-filter:blur(18px) saturate(1.25);
            -webkit-backdrop-filter:blur(18px) saturate(1.25);
            z-index:100000;
            display:flex; align-items:center; justify-content:center;
            padding:20px;
            pointer-events:auto;
            animation:ffui-fade .2s ease;
        }
        @keyframes ffui-fade { from{opacity:0} to{opacity:1} }


        .ffui-box {
            position:relative;
            background:
                radial-gradient(115% 74% at 50% -16%, rgba(var(--primary-rgb),0.16) 0%, transparent 58%),
                linear-gradient(180deg, rgba(var(--ink-rgb),0.08) 0%, rgba(var(--ink-rgb),0.018) 36%, transparent 100%),
                rgba(10, 16, 28, 0.78);
            border: 1px solid rgba(var(--ink-rgb),0.09);
            border-top-color: rgba(var(--ink-rgb),0.20);
            border-radius: 20px;
            box-shadow:
                0 28px 70px -18px rgba(var(--shadow-rgb),0.82),
                inset 0 1px 0 rgba(var(--ink-rgb),0.08),
                inset 0 -20px 34px -30px rgba(var(--shadow-rgb),0.62);
            backdrop-filter: blur(24px) saturate(1.35);
            -webkit-backdrop-filter: blur(24px) saturate(1.35);
            width:100%; max-width:400px;
            display:flex; flex-direction:column;
            overflow:hidden;
            animation:ffui-up .28s cubic-bezier(.4,0,.2,1);
            font-family: var(--font-body, 'Inter', 'Segoe UI', system-ui, sans-serif);
        }
        .ffui-box::after {
            content:'';
            position:absolute; inset:0;
            border-radius:inherit;
            padding:1px;
            pointer-events:none;
            z-index:2;
            background:linear-gradient(150deg,
                rgba(var(--ink-rgb),0.36) 0%,
                rgba(var(--ink-rgb),0.10) 22%,
                transparent 46%,
                rgba(var(--primary-rgb),0.08) 72%,
                rgba(var(--primary-rgb),0.26) 100%);
            -webkit-mask:linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                    mask:linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite:xor;
                    mask-composite:exclude;
        }
        .ffui-box.is-attention {
            animation:ffui-attention .18s ease;
        }
        @keyframes ffui-up {
            from{transform:translateY(16px);opacity:0}
            to  {transform:translateY(0);  opacity:1}
        }
        @keyframes ffui-attention {
            0%,100%{transform:translateY(0) scale(1)}
            42%{transform:translateY(-1px) scale(1.006)}
        }


        .ffui-header {
            position:relative;
            z-index:3;
            padding: 16px 18px 14px;
            background:
                linear-gradient(180deg, rgba(var(--ink-rgb),0.07) 0%, transparent 100%),
                rgba(var(--primary-rgb),0.035);
            border-bottom: 1px solid rgba(var(--ink-rgb),0.07);
            display:flex; align-items:center; justify-content:space-between;
        }
        .ffui-title {
            font-size:14px; font-weight:700;
            color:var(--t1);
            display:flex; align-items:center; gap:9px;
            letter-spacing:.2px;
        }
        .ffui-title-dot {
            width:8px; height:8px; border-radius:50%;
            background: rgba(var(--primary-rgb),0.86);
            box-shadow: 0 0 10px rgba(var(--primary-rgb),0.55), 0 0 0 3px rgba(var(--primary-rgb),0.10);
            flex-shrink:0;
            animation: ffui-pulse 2.4s ease-in-out infinite;
        }
        @keyframes ffui-pulse {
            0%,100% { box-shadow: 0 0 10px rgba(var(--primary-rgb),0.50), 0 0 0 3px rgba(var(--primary-rgb),0.09); }
            50%     { box-shadow: 0 0 14px rgba(var(--primary-rgb),0.72), 0 0 0 4px rgba(var(--primary-rgb),0.15); }
        }


        .ffui-body {
            position:relative;
            z-index:3;
            padding:16px 18px 18px;
            display:flex; flex-direction:column; gap:14px;
        }

        .ffui-progress-wrap {
            padding: 11px 12px 12px;
            border-radius: 14px;
            background:
                linear-gradient(180deg, rgba(var(--ink-rgb),0.07) 0%, transparent 62%),
                rgba(8, 14, 24, 0.46);
            border: 1px solid rgba(var(--ink-rgb),0.07);
            box-shadow: inset 0 1px 0 rgba(var(--ink-rgb),0.055), inset 0 -12px 18px -22px rgba(var(--shadow-rgb),0.55);
            backdrop-filter: blur(10px) saturate(1.15);
            -webkit-backdrop-filter: blur(10px) saturate(1.15);
        }


        .ffui-progress-info {
            display:flex; justify-content:space-between; align-items:center;
            margin-bottom:7px;
            min-width:0;
        }
        .ffui-progress-label {
            flex:1 1 auto;
            min-width:0;
            overflow:hidden;
            text-overflow:ellipsis;
            white-space:nowrap;
            font-size:11px; color:var(--t2); font-weight:500;
        }
        .ffui-pct {
            flex:0 0 auto;
            margin-left:10px;
            font-size:11px; font-weight:700;
            color:rgba(122, 215, 247, 0.90);
            text-shadow: 0 0 10px rgba(var(--primary-rgb),0.24);
            font-variant-numeric:tabular-nums;
        }
        .ffui-bar {
            height:7px;
            background:
                linear-gradient(180deg, rgba(var(--ink-rgb),0.12) 0%, transparent 54%),
                rgba(var(--ink-rgb),0.045);
            border:1px solid rgba(var(--ink-rgb),0.055);
            border-radius:999px;
            overflow:hidden;
            box-shadow: inset 0 1px 0 rgba(var(--ink-rgb),0.07), inset 0 -1px 2px rgba(var(--shadow-rgb),0.20);
        }
        .ffui-bar-fill {
            height:100%;
            background:
                linear-gradient(180deg, rgba(var(--ink-rgb),0.22) 0%, transparent 54%),
                linear-gradient(90deg, rgba(32, 151, 184, 0.90) 0%, rgba(68, 190, 232, 0.92) 100%);
            border-radius:999px;
            width:0%;
            transition:width .35s ease;
            box-shadow: inset 0 1px 0 rgba(var(--ink-rgb),0.14), 0 0 10px rgba(var(--primary-rgb),0.18);
        }


        .ffui-stats {
            display:grid; grid-template-columns:repeat(auto-fit,minmax(0,1fr)); gap:8px;
        }
        .ffui-stat {
            position:relative;
            background:
                linear-gradient(180deg, rgba(var(--ink-rgb),0.08) 0%, transparent 58%),
                rgba(8, 14, 24, 0.44);
            border: 1px solid rgba(var(--ink-rgb),0.07);
            border-top-color: rgba(var(--ink-rgb),0.14);
            border-radius: 13px;
            padding: 10px 4px 9px;
            text-align:center;
            box-shadow: 0 2px 10px rgba(var(--shadow-rgb),0.25), inset 0 1px 0 rgba(var(--ink-rgb),0.06), inset 0 -10px 16px -18px rgba(var(--shadow-rgb),0.52);
            backdrop-filter: blur(8px) saturate(1.12);
            -webkit-backdrop-filter: blur(8px) saturate(1.12);
        }
        .ffui-stat.is-hidden {
            display:none;
        }
        .ffui-stat-val {
            display:block; font-size:21px; font-weight:800;
            color:var(--t1); margin-bottom:3px; line-height:1;
            font-variant-numeric:tabular-nums;
        }
        .ffui-stat-val.ffui-stat-cyan {
            color:rgba(112, 211, 245, 0.92);
            text-shadow: 0 0 12px rgba(var(--primary-rgb),0.24);
        }
        .ffui-stat-val.ffui-stat-err { color:rgba(236, 112, 124, 0.92); }
        .ffui-stat-lbl {
            display:block; font-size:9px; color:var(--t3);
            text-transform:uppercase; letter-spacing:.7px; font-weight:600;
        }


        .ffui-log {
            background:
                linear-gradient(180deg, rgba(var(--ink-rgb),0.045), rgba(var(--ink-rgb),0.012)),
                rgba(5, 10, 18, 0.50);
            border: 1px solid rgba(var(--ink-rgb),0.07);
            border-top-color: rgba(var(--ink-rgb),0.12);
            border-radius: 13px;
            padding: 8px 10px;
            max-height: 174px;
            overflow-y: auto;
            display:flex; flex-direction:column; gap:2px;
            scrollbar-width:none;
            -ms-overflow-style:none;
            box-shadow: inset 0 1px 0 rgba(var(--ink-rgb),0.045);
            backdrop-filter: blur(9px) saturate(1.12);
            -webkit-backdrop-filter: blur(9px) saturate(1.12);
        }
        .ffui-log::-webkit-scrollbar {
            width:0;
            height:0;
        }
        .ffui-log-row {
            display:flex; align-items:center; gap:7px;
            font-size:11px; line-height:1.5;
            padding: 2px 4px;
            border-radius: 8px;
            background: rgba(var(--ink-rgb),0.018);
            animation:ffui-row-in .12s ease;
        }
        @keyframes ffui-row-in {
            from{opacity:0;transform:translateX(-3px)}
            to  {opacity:1;transform:translateX(0)}
        }
        .ffui-log-icon { flex-shrink:0; width:14px; text-align:center; font-size:10px; }
        .ffui-log-name {
            color:var(--t2); flex:1; min-width:0;
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
            font-weight:500;
        }
        .ffui-log-detail {
            flex-shrink:0; font-size:10px; font-weight:600;
            padding: 1px 7px; border-radius:999px; white-space:nowrap;
            box-shadow: inset 0 1px 0 rgba(var(--ink-rgb),0.055), 0 0 0 1px rgba(var(--ink-rgb),0.035);
            backdrop-filter: blur(3px) saturate(1.08);
            -webkit-backdrop-filter: blur(3px) saturate(1.08);
        }

        .ffui-log-row.is-fetch   .ffui-log-name  { color:var(--t1); }
        .ffui-log-row.is-fetch   .ffui-log-detail { background:rgba(var(--primary-rgb),0.10); color:rgba(122, 215, 247, 0.90); }
        .ffui-log-row.is-cached  .ffui-log-detail { background:rgba(var(--ink-rgb),0.045); color:var(--t2); }
        .ffui-log-row.is-nofill  .ffui-log-detail { background:rgba(var(--ink-rgb),0.030); color:rgba(145, 157, 184, 0.80); }
        .ffui-log-row.is-movie   .ffui-log-detail { background:rgba(var(--purple-rgb),0.10); color:rgba(178, 142, 255, 0.88); }
        .ffui-log-row.is-error   .ffui-log-detail { background:rgba(var(--danger-rgb),0.10); color:rgba(236, 112, 124, 0.92); }
        .ffui-log-row.is-summary {
            margin-top:5px; padding-top:6px;
            border-top:1px solid rgba(var(--ink-rgb),0.08);
            font-weight:700; color:var(--t1);
        }
        .ffui-log-row.is-summary .ffui-log-name { color:var(--t1); }
        </style>`;
        document.head.insertAdjacentHTML('beforeend', css);
    },


    attachEventListeners() {
        const overlay = document.getElementById(this.IDS.overlay);
        const blockOutsideClick = (e) => {
            if (e.target.id !== this.IDS.overlay) return;
            e.preventDefault();
            e.stopPropagation();
            this._nudgeModal();
        };
        overlay.addEventListener('mousedown', blockOutsideClick);
        overlay.addEventListener('click', blockOutsideClick);

        if (this._escHandler) {
            try { document.removeEventListener('keydown', this._escHandler); } catch {}
        }
        this._escHandler = (e) => {
            if (e.key !== 'Escape' || !this.state.isOpen) return;
            if (this.state.isRunning) {
                e.preventDefault();
                this._nudgeModal();
                return;
            }
            this.close();
        };
        document.addEventListener('keydown', this._escHandler);
    },


    async open(options = {}) {
        const autoMode = options.autoMode === true;
        this.state.isOpen = true;
        this.state.autoMode = autoMode;
        this.resetUI({ autoMode });

        const data = await window.AnimeTracker.Storage.get(['animeData']);
        this.state.total = Object.keys(data.animeData || {}).length;

        const overlay = document.getElementById(this.IDS.overlay);
        const container = document.getElementById(this.IDS.container);
        overlay.style.display = 'flex';
        overlay.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => container?.focus?.());
    },

    close() {
        this.state.isOpen = false;
        this.state.autoMode = false;
        const overlay = document.getElementById(this.IDS.overlay);
        overlay.style.display = 'none';
        overlay.setAttribute('aria-hidden', 'true');
    },

    _nudgeModal() {
        const container = document.getElementById(this.IDS.container);
        if (!container) return;
        container.classList.remove('is-attention');
        void container.offsetWidth;
        container.classList.add('is-attention');
    },

    resetUI(options = {}) {
        const keepAutoMode = options.autoMode === true;
        Object.assign(this.state, {
            isRunning: false, isCancelled: false, fetchDone: false,
            fetched: 0, cached: 0, skipped: 0, failed: 0,
        });
        if (!keepAutoMode) this.state.autoMode = false;

        this._setProgress(0, 'Ready to fetch and import your data…');
        ['fetched','cached','skipped','failed'].forEach(k => this._setStat(k, 0));

        const log = document.getElementById(this.IDS.logFeed);
        log.innerHTML = '';
        log.style.display = 'none';
    },

    _setProgress(pct, label) {
        document.getElementById(this.IDS.progressFill).style.width = `${pct}%`;
        document.querySelector('.ffui-pct').textContent = `${Math.round(pct)}%`;
        if (label !== undefined)
            document.getElementById(this.IDS.progressText).textContent = label;
    },

    _setStat(name, value) {
        const el = document.querySelector(`[data-stat="${name}"]`);
        if (!el) return;
        el.textContent = value;

        const shouldCollapse = (name === 'cached' || name === 'failed') && Number(value) === 0;
        el.closest('.ffui-stat')?.classList.toggle('is-hidden', shouldCollapse);
    },

    _renderLogs(entries) {
        const log = document.getElementById(this.IDS.logFeed);
        log.innerHTML = '';

        if (!entries || entries.length === 0) {
            log.style.display = 'none';
            return;
        }

        log.style.display = 'flex';
        entries.forEach((entry) => {
            this._log(entry.type || 'cached', entry.name || entry.slug || 'Import item', entry.detail || '');
        });
    },

    showPendingStart(label = 'Starting import…') {
        this.state.isRunning = true;
        this.state.fetchDone = false;
        this._setProgress(0, label);
    },

    applyBackgroundState(state) {
        if (!state) {
            this.resetUI();
            return;
        }

        this.state.total = Number(state.total) || 0;
        this.state.fetched = Number(state.fetched) || 0;
        this.state.cached = Number(state.cached) || 0;
        this.state.skipped = Number(state.skipped) || 0;
        this.state.failed = Number(state.failed) || 0;
        this.state.isRunning = state.status === 'running';
        this.state.fetchDone = state.status === 'completed' || state.status === 'error';

        this._setStat('fetched', this.state.fetched);
        this._setStat('cached', this.state.cached);
        this._setStat('skipped', this.state.skipped);
        this._setStat('failed', this.state.failed);
        this._renderLogs(Array.isArray(state.logs) ? state.logs : []);

        const processed = Number(state.processed) || 0;
        const total = Number(state.total) || 0;
        const pct = state.status === 'completed'
            ? 100
            : total > 0
                ? Math.min(100, (processed / total) * 100)
                : 0;

        let label = 'Ready to fetch and import your data…';
        if (state.status === 'running') {
            const currentTitle = state.currentTitle || state.currentSlug || 'Working…';
            label = `${processed} / ${total} — ${currentTitle}`;
        } else if (state.status === 'completed') {
            label = state.failed > 0
                ? `Import complete — ${state.failed} failed, see log above`
                : 'Import complete — see log above';
        } else if (state.status === 'error') {
            label = state.errorMessage
                ? `Import error — ${state.errorMessage}`
                : 'Import error — see log above';
        }

        this._setProgress(pct, label);

        if (state.status === 'completed') {
            this._scheduleAutoClose();
        }
    },

    _scheduleAutoClose() {
        if (this._autoCloseTimer) clearTimeout(this._autoCloseTimer);
        this._autoCloseTimer = setTimeout(() => {
            this._autoCloseTimer = null;
            this.close();
        }, 900);
    },







    _log(type, name, detail = '') {
        const log = document.getElementById(this.IDS.logFeed);
        if (log.style.display === 'none') log.style.display = 'flex';

        const icons   = { fetch: '*', cached: 'o', skip: '-', nofill: '-', error: 'x', movie: '>' };
        const classes = { fetch: 'is-fetch', cached: 'is-cached', skip: 'is-nofill', nofill: 'is-nofill', error: 'is-error', movie: 'is-movie' };

        const row = document.createElement('div');
        row.className = `ffui-log-row ${classes[type] || ''}`;

        const iconSpan = document.createElement('span');
        iconSpan.className = 'ffui-log-icon';
        iconSpan.textContent = icons[type] || '-';
        row.appendChild(iconSpan);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'ffui-log-name';
        nameSpan.setAttribute('title', name || '');
        nameSpan.textContent = name || '';
        row.appendChild(nameSpan);

        if (detail) {
            const detailSpan = document.createElement('span');
            detailSpan.className = 'ffui-log-detail';
            detailSpan.textContent = detail;
            row.appendChild(detailSpan);
        }

        log.appendChild(row);
        log.scrollTop = log.scrollHeight;
    },
};

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.FillerFetchUI = FillerFetchUI;


