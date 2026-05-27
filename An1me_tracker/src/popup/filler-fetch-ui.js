






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
        <div id="${overlay}" class="ffui-overlay" style="display:none">
          <div id="${container}" class="ffui-box">

            <div class="ffui-header">
              <span class="ffui-title"><span class="ffui-title-dot"></span>Fetch & Import</span>
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
            background:rgba(7,9,14,.92);
            backdrop-filter:blur(6px);
            z-index:100000;
            display:flex; align-items:center; justify-content:center;
            padding:20px;
            animation:ffui-fade .2s ease;
        }
        @keyframes ffui-fade { from{opacity:0} to{opacity:1} }


        .ffui-box {
            background: #111520;
            background-image: radial-gradient(ellipse at 50% 0%, rgba(79,195,247,0.06) 0%, transparent 65%);
            border: 1px solid rgba(255,255,255,0.07);
            border-top-color: rgba(79,195,247,0.18);
            border-radius: 18px;
            box-shadow:
                0 0 0 1px rgba(0,0,0,0.6),
                0 8px 40px rgba(0,0,0,0.7),
                0 1px 0 rgba(79,195,247,0.08) inset;
            width:100%; max-width:400px;
            display:flex; flex-direction:column;
            overflow:hidden;
            animation:ffui-up .28s cubic-bezier(.4,0,.2,1);
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
        }
        @keyframes ffui-up {
            from{transform:translateY(16px);opacity:0}
            to  {transform:translateY(0);  opacity:1}
        }


        .ffui-header {
            padding: 16px 18px 15px;
            background: linear-gradient(180deg, rgba(79,195,247,0.07) 0%, transparent 100%);
            border-bottom: 1px solid rgba(255,255,255,0.06);
            display:flex; align-items:center; justify-content:space-between;
        }
        .ffui-title {
            font-size:14px; font-weight:700;
            color:#e8edf8;
            display:flex; align-items:center; gap:8px;
            letter-spacing:.2px;
        }
        .ffui-title-dot {
            width:7px; height:7px; border-radius:50%;
            background: linear-gradient(135deg,#4fc3f7,#29b6f6);
            box-shadow: 0 0 8px rgba(79,195,247,0.7);
            flex-shrink:0;
        }


        .ffui-body { padding:16px 18px; display:flex; flex-direction:column; gap:14px; }


        .ffui-progress-info {
            display:flex; justify-content:space-between; align-items:center;
            margin-bottom:7px;
        }
        .ffui-progress-label { font-size:11px; color:#6b7694; font-weight:500; }
        .ffui-pct {
            font-size:11px; font-weight:700;
            color:#4fc3f7;
            text-shadow: 0 0 10px rgba(79,195,247,0.5);
        }
        .ffui-bar {
            height:5px;
            background:rgba(255,255,255,0.05);
            border-radius:999px;
            overflow:hidden;
        }
        .ffui-bar-fill {
            height:100%;
            background: linear-gradient(90deg,#4fc3f7,#29b6f6);
            border-radius:999px;
            width:0%;
            transition:width .35s ease;
            box-shadow: 0 0 8px rgba(79,195,247,0.4);
        }


        .ffui-stats {
            display:grid; grid-template-columns:repeat(4,1fr); gap:7px;
        }
        .ffui-stat {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.06);
            border-top-color: rgba(255,255,255,0.09);
            border-radius: 10px;
            padding: 9px 4px 8px;
            text-align:center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05);
        }
        .ffui-stat-val {
            display:block; font-size:20px; font-weight:800;
            color:#e8edf8; margin-bottom:3px; line-height:1;
        }
        .ffui-stat-val.ffui-stat-cyan {
            color:#4fc3f7;
            text-shadow: 0 0 12px rgba(79,195,247,0.5);
        }
        .ffui-stat-val.ffui-stat-err { color:#f07070; }
        .ffui-stat-lbl {
            display:block; font-size:9px; color:#353d55;
            text-transform:uppercase; letter-spacing:.6px; font-weight:600;
        }


        .ffui-log {
            background: rgba(0,0,0,0.3);
            border: 1px solid rgba(255,255,255,0.05);
            border-radius: 10px;
            padding: 8px 10px;
            max-height: 148px;
            overflow-y: auto;
            display:flex; flex-direction:column; gap:2px;
            scrollbar-width:thin;
            scrollbar-color:rgba(79,195,247,.15) transparent;
        }
        .ffui-log-row {
            display:flex; align-items:center; gap:7px;
            font-size:11px; line-height:1.5;
            padding: 1px 0;
            animation:ffui-row-in .12s ease;
        }
        @keyframes ffui-row-in {
            from{opacity:0;transform:translateX(-3px)}
            to  {opacity:1;transform:translateX(0)}
        }
        .ffui-log-icon { flex-shrink:0; width:14px; text-align:center; font-size:10px; }
        .ffui-log-name {
            color:#9aa3bb; flex:1; min-width:0;
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
            font-weight:500;
        }
        .ffui-log-detail {
            flex-shrink:0; font-size:10px; font-weight:600;
            padding: 1px 6px; border-radius:999px; white-space:nowrap;
        }

        .ffui-log-row.is-fetch   .ffui-log-name  { color:#e8edf8; }
        .ffui-log-row.is-fetch   .ffui-log-detail { background:rgba(79,195,247,0.12); color:#4fc3f7; }
        .ffui-log-row.is-cached  .ffui-log-detail { background:rgba(107,118,148,0.12); color:#6b7694; }
        .ffui-log-row.is-nofill  .ffui-log-detail { background:rgba(107,118,148,0.08); color:#4a5168; }
        .ffui-log-row.is-movie   .ffui-log-detail { background:rgba(155,106,255,0.1); color:#9b6aff; }
        .ffui-log-row.is-error   .ffui-log-detail { background:rgba(240,112,112,0.12); color:#f07070; }
        .ffui-log-row.is-summary {
            margin-top:5px; padding-top:6px;
            border-top:1px solid rgba(255,255,255,0.06);
            font-weight:700; color:#e8edf8;
        }
        .ffui-log-row.is-summary .ffui-log-name { color:#e8edf8; }
        </style>`;
        document.head.insertAdjacentHTML('beforeend', css);
    },


    attachEventListeners() {
        document.getElementById(this.IDS.overlay)
            .addEventListener('click', (e) => {
                if (e.target.id === this.IDS.overlay && !this.state.isRunning) this.close();
            });

        if (this._escHandler) {
            try { document.removeEventListener('keydown', this._escHandler); } catch {}
        }
        this._escHandler = (e) => {
            if (e.key === 'Escape' && this.state.isOpen && !this.state.isRunning) this.close();
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

        document.getElementById(this.IDS.overlay).style.display = 'flex';
    },

    close() {
        if (this.state.isRunning) return;
        this.state.isOpen = false;
        this.state.autoMode = false;
        document.getElementById(this.IDS.overlay).style.display = 'none';
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
        if (el) el.textContent = value;
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


