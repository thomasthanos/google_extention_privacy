/**
 * Filler Fetch UI
 * Handles the "Fetch Filler Data" modal — correctly distinguishes
 * fresh fetches, valid cache hits, notFound entries, movies, and errors.
 */

const FillerFetchUI = {
    IDS: {
        overlay:      'filler-fetch-ui-overlay',
        container:    'filler-fetch-ui-container',
        progressFill: 'filler-fetch-ui-progress-fill',
        progressText: 'filler-fetch-ui-progress-text',
        logFeed:      'filler-fetch-ui-log',
        closeBtn:     'filler-fetch-ui-close-btn',
        startBtn:     'filler-fetch-ui-start-btn',
        cancelBtn:    'filler-fetch-ui-cancel-btn',
    },

    state: {
        isOpen:      false,
        isRunning:   false,
        isCancelled: false,
        total:   0,
        fetched: 0,
        cached:  0,
        skipped: 0,
        failed:  0,
    },

    onComplete: null,

    // ─── Init ───────────────────────────────────────────────────────────────

    init() {
        this.injectStyles();
        this.createModal();
        this.attachEventListeners();
    },

    // ─── Modal HTML ─────────────────────────────────────────────────────────

    createModal() {
        const { overlay, container, progressFill, progressText,
                logFeed, closeBtn, startBtn, cancelBtn } = this.IDS;

        const html = `
        <div id="${overlay}" class="ffui-overlay" style="display:none">
          <div id="${container}" class="ffui-box">

            <div class="ffui-header">
              <span class="ffui-title"><span class="ffui-title-dot"></span>Filler Data Fetch</span>
              <button id="${closeBtn}" class="ffui-close" aria-label="Close">×</button>
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

            <div class="ffui-footer">
              <button id="${cancelBtn}" class="ffui-btn ffui-btn-sec" style="display:none">Cancel</button>
              <button id="${startBtn}"  class="ffui-btn ffui-btn-pri">Start Fetch</button>
            </div>

          </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', html);
    },

    // ─── CSS ────────────────────────────────────────────────────────────────

    injectStyles() {
        if (document.getElementById('ffui-styles')) return;
        const css = `
        <style id="ffui-styles">
        /* ── Overlay ─────────────────────────────────── */
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

        /* ── Box ─────────────────────────────────────── */
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

        /* ── Header ──────────────────────────────────── */
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
        .ffui-close {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 7px;
            width:28px; height:28px; cursor:pointer;
            color:#6b7694; font-size:20px; line-height:1;
            display:flex; align-items:center; justify-content:center;
            transition: all .15s;
        }
        .ffui-close:hover { background:rgba(255,255,255,.1); color:#e8edf8; border-color:rgba(255,255,255,.12); }

        /* ── Body ────────────────────────────────────── */
        .ffui-body { padding:16px 18px; display:flex; flex-direction:column; gap:14px; }

        /* ── Progress ────────────────────────────────── */
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

        /* ── Stats grid ──────────────────────────────── */
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

        /* ── Live log ────────────────────────────────── */
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
        /* detail badge colours by row type */
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

        /* ── Footer ──────────────────────────────────── */
        .ffui-footer {
            padding: 13px 18px;
            background: rgba(0,0,0,0.2);
            border-top: 1px solid rgba(255,255,255,0.05);
            display:flex; gap:9px; justify-content:flex-end;
        }

        /* Cancel — ghost */
        .ffui-btn-sec {
            padding: 0 18px; height:36px;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 999px;
            font-size:12px; font-weight:600; cursor:pointer;
            color:#6b7694;
            transition: all .15s;
            font-family: inherit;
        }
        .ffui-btn-sec:hover:not(:disabled) { background:rgba(255,255,255,.09); color:#e8edf8; }

        /* Start / Close — 3-D cyan (mirrors .btn-google-primary style) */
        .ffui-btn-pri {
            padding: 0 22px; height:36px;
            background: linear-gradient(160deg, #3db8e8 0%, #1a96c8 45%, #0e79a8 100%);
            border: none;
            border-radius: 999px;
            font-size:12px; font-weight:700; cursor:pointer;
            color:#fff;
            position:relative;
            transition: all .15s;
            font-family: inherit;
            box-shadow:
                0 1px 0 rgba(255,255,255,0.25) inset,
                0 -2px 0 rgba(0,0,0,0.35) inset,
                0 3px 10px rgba(14,121,168,0.55),
                0 1px 3px rgba(0,0,0,0.5);
        }
        .ffui-btn-pri::before {
            content:'';
            position:absolute; inset:0;
            border-radius:inherit;
            background: linear-gradient(180deg, rgba(255,255,255,0.12) 0%, transparent 55%);
            pointer-events:none;
        }
        .ffui-btn-pri:hover:not(:disabled) {
            transform:translateY(-1px);
            box-shadow:
                0 1px 0 rgba(255,255,255,0.25) inset,
                0 -2px 0 rgba(0,0,0,0.35) inset,
                0 5px 16px rgba(14,121,168,0.65),
                0 2px 5px rgba(0,0,0,0.5);
        }
        .ffui-btn-pri:active:not(:disabled) {
            transform:translateY(1px);
            box-shadow:
                0 1px 0 rgba(255,255,255,0.15) inset,
                0 -1px 0 rgba(0,0,0,0.3) inset,
                0 2px 6px rgba(14,121,168,0.4);
        }
        .ffui-btn-pri:disabled, .ffui-btn-sec:disabled {
            opacity:.4; cursor:not-allowed; transform:none!important;
        }
        </style>`;
        document.head.insertAdjacentHTML('beforeend', css);
    },

    // ─── Events ─────────────────────────────────────────────────────────────

    attachEventListeners() {
        document.getElementById(this.IDS.closeBtn)
            .addEventListener('click', () => { if (!this.state.isRunning) this.close(); });

        document.getElementById(this.IDS.overlay)
            .addEventListener('click', (e) => {
                if (e.target.id === this.IDS.overlay && !this.state.isRunning) this.close();
            });

        document.getElementById(this.IDS.startBtn)
            .addEventListener('click', () => {
                if (this.state.fetchDone) { this.close(); return; }
                this.startFetch();
            });

        document.getElementById(this.IDS.cancelBtn)
            .addEventListener('click', () => this.cancel());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.state.isOpen && !this.state.isRunning) this.close();
        });
    },

    // ─── Open / Close ────────────────────────────────────────────────────────

    async open() {
        this.state.isOpen = true;
        this.resetUI();

        const data = await window.AnimeTracker.Storage.get(['animeData']);
        this.state.total = Object.keys(data.animeData || {}).length;

        document.getElementById(this.IDS.overlay).style.display = 'flex';
    },

    close() {
        this.state.isOpen = false;
        document.getElementById(this.IDS.overlay).style.display = 'none';
    },

    // ─── UI helpers ─────────────────────────────────────────────────────────

    resetUI() {
        Object.assign(this.state, {
            isRunning: false, isCancelled: false, fetchDone: false,
            fetched: 0, cached: 0, skipped: 0, failed: 0,
        });

        this._setProgress(0, 'Ready to fetch filler data…');
        ['fetched','cached','skipped','failed'].forEach(k => this._setStat(k, 0));

        const log = document.getElementById(this.IDS.logFeed);
        log.innerHTML = '';
        log.style.display = 'none';

        const startBtn = document.getElementById(this.IDS.startBtn);
        startBtn.textContent = 'Start Fetch';
        startBtn.style.display = '';
        startBtn.disabled = false;
        document.getElementById(this.IDS.cancelBtn).style.display = 'none';
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

    /**
     * Append a row to the live log.
     * @param {'fetch'|'cached'|'skip'|'error'|'movie'} type
     * @param {string} name  - anime title
     * @param {string} [detail] - short right-aligned note
     */
    _log(type, name, detail = '') {
        const log = document.getElementById(this.IDS.logFeed);
        if (log.style.display === 'none') log.style.display = 'flex';

        const icons   = { fetch: '●', cached: '◌', skip: '□', nofill: '□', error: '×', movie: '▷' };
        const classes = { fetch: 'is-fetch', cached: 'is-cached', skip: 'is-nofill', nofill: 'is-nofill', error: 'is-error', movie: 'is-movie' };

        const { UIHelpers } = window.AnimeTracker;
        const safeName   = UIHelpers.escapeHtml(name);
        const safeDetail = UIHelpers.escapeHtml(detail);
        const row = document.createElement('div');
        row.className = `ffui-log-row ${classes[type] || ''}`;
        row.innerHTML = `
            <span class="ffui-log-icon">${icons[type] || '□'}</span>
            <span class="ffui-log-name" title="${safeName}">${safeName}</span>
            ${safeDetail ? `<span class="ffui-log-detail">${safeDetail}</span>` : ''}`;
        log.appendChild(row);
        log.scrollTop = log.scrollHeight;
    },

    // ─── Core fetch logic ────────────────────────────────────────────────────

    async startFetch() {
        this.state.isRunning  = true;
        this.state.isCancelled = false;

        document.getElementById(this.IDS.startBtn).style.display  = 'none';
        document.getElementById(this.IDS.cancelBtn).style.display = '';

        const { FillerService, Storage, CONFIG } = window.AnimeTracker;

        const data     = await Storage.get(['animeData']);
        const animeData = data.animeData || {};
        const entries  = Object.entries(animeData);
        this.state.total = entries.length;

        for (let i = 0; i < entries.length; i++) {
            if (this.state.isCancelled) break;

            const [slug, anime] = entries[i];
            const title = anime.title || slug;
            const pct   = ((i + 1) / entries.length) * 100;

            this._setProgress(pct, `${i + 1} / ${entries.length} — ${title}`);

            // ── Skip movies / OVAs / specials ────────────────────────────────
            if (FillerService.isLikelyMovie(slug)) {
                this._log('movie', title, 'movie/OVA');
                this.state.skipped++;
                this._setStat('skipped', this.state.skipped);
                continue;
            }

            // ── Check in-memory cache ────────────────────────────────────────
            const cached = FillerService.episodeTypesCache[slug];
            if (cached) {
                const age = cached.cachedAt ? Date.now() - cached.cachedAt : Infinity;

                // notFound entry within TTL → skip (do NOT count as cached)
                if (cached.notFound) {
                    const ttl = CONFIG.FILLER_NOT_FOUND_CACHE_TTL;
                    if (age < ttl) {
                        this._log('nofill', title, 'not listed');
                        this.state.skipped++;
                        this._setStat('skipped', this.state.skipped);
                        continue;
                    }
                    // Expired notFound — clear it so fetchEpisodeTypes retries
                    delete FillerService.episodeTypesCache[slug];
                } else if (age < (CONFIG.EPISODE_TYPES_CACHE_TTL ?? Infinity)) {
                    // Fresh valid cache
                    const fillers = cached.filler?.length ?? 0;
                    const detail  = fillers > 0 ? `${fillers} fillers` : 'no fillers';
                    this._log('cached', title, detail);
                    this.state.cached++;
                    this._setStat('cached', this.state.cached);
                    continue;
                }
                // else: expired valid cache → fall through to fetch
            }

            // ── Fetch from AnimeFillerList via background ────────────────────
            try {
                const episodeTypes = await FillerService.fetchEpisodeTypes(slug, anime.title || null);

                if (episodeTypes && !episodeTypes.notFound) {
                    FillerService.updateFromEpisodeTypes(slug, episodeTypes);

                    const fillers = episodeTypes.filler?.length ?? 0;
                    const total   = episodeTypes.totalEpisodes ?? '?';
                    const pctFill = total > 0 ? ` (${Math.round(fillers / total * 100)}%)` : '';
                    this._log('fetch', title, `${fillers} fillers / ${total} eps${pctFill}`);

                    this.state.fetched++;
                    this._setStat('fetched', this.state.fetched);
                } else {
                    // null → notFound cached by fetchEpisodeTypes
                    this._log('nofill', title, 'not listed');
                    this.state.skipped++;
                    this._setStat('skipped', this.state.skipped);
                }
            } catch (err) {
                this._log('error', title, err.message?.slice(0, 30) || 'error');
                this.state.failed++;
                this._setStat('failed', this.state.failed);
            }

            // Small delay so we don't hammer animefillerlist.com
            await new Promise(r => setTimeout(r, 150));
        }

        // ── Done ─────────────────────────────────────────────────────────────
        this.state.isRunning = false;

        // Summary row in log
        const log = document.getElementById(this.IDS.logFeed);
        if (log) {
            log.style.display = 'flex';
            const summary = document.createElement('div');
            summary.className = 'ffui-log-row is-summary';
            summary.innerHTML = this.state.isCancelled
                ? `<span class="ffui-log-icon">□</span><span class="ffui-log-name">Cancelled — ${this.state.fetched} fetched, ${this.state.cached} cached, ${this.state.skipped} no-filler</span>`
                : `<span class="ffui-log-icon">●</span><span class="ffui-log-name">Done — ${this.state.fetched} fetched, ${this.state.cached} cached, ${this.state.skipped} no-filler${this.state.failed > 0 ? `, ${this.state.failed} failed` : ''}</span>`;
            log.appendChild(summary);
            log.scrollTop = log.scrollHeight;
        }

        this._setProgress(this.state.isCancelled ? this.state.total > 0 ? (((this.state.fetched + this.state.cached + this.state.skipped) / this.state.total) * 100) : 0 : 100,
            this.state.isCancelled ? 'Cancelled — see log above' : '✓ Complete — see log above');

        document.getElementById(this.IDS.cancelBtn).style.display = 'none';
        const startBtn = document.getElementById(this.IDS.startBtn);
        startBtn.textContent = this.state.isCancelled ? 'Closed' : '✓ Done';
        startBtn.style.display = '';
        startBtn.disabled = true;

        if (!this.state.isCancelled && this.onComplete) {
            this.onComplete();
            this.onComplete = null;
        }

        // Signal fetch is done so the button's delegated handler calls close()
        startBtn.disabled = false;
        startBtn.textContent = 'Close';
        this.state.fetchDone = true;
    },

    cancel() {
        this.state.isCancelled = true;
    },
};

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.FillerFetchUI = FillerFetchUI;
