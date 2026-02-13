/**
 * Filler Fetch UI - Minimal Design
 * Χρησιμοποιεί τα χρώματα της εφαρμογής
 */

const FillerFetchUI = {
    // Unique IDs
    IDS: {
        overlay: 'filler-fetch-ui-overlay',
        container: 'filler-fetch-ui-container',
        header: 'filler-fetch-ui-header',
        body: 'filler-fetch-ui-body',
        footer: 'filler-fetch-ui-footer',
        progressBar: 'filler-fetch-ui-progress-bar',
        progressFill: 'filler-fetch-ui-progress-fill',
        progressText: 'filler-fetch-ui-progress-text',
        closeBtn: 'filler-fetch-ui-close-btn',
        startBtn: 'filler-fetch-ui-start-btn',
        cancelBtn: 'filler-fetch-ui-cancel-btn',
    },

    // State
    state: {
        isOpen: false,
        isRunning: false,
        isCancelled: false,
        currentIndex: 0,
        total: 0,
        fetched: 0,
        cached: 0,
        skipped: 0,
        failed: 0,
    },

    // Callback function (set by main.js)
    onComplete: null,

    /**
     * Initialize
     */
    init() {
        this.createModal();
        this.attachEventListeners();
    },

    /**
     * Create modal HTML
     */
    createModal() {
        const modalHTML = `
            <div id="${this.IDS.overlay}" class="filler-fetch-overlay" style="display: none;">
                <div id="${this.IDS.container}" class="filler-fetch-container">
                    <!-- Header -->
                    <div id="${this.IDS.header}" class="filler-fetch-header">
                        <div class="filler-fetch-title">
                            <span class="filler-fetch-icon">🎭</span>
                            <span>Filler Data Fetch</span>
                        </div>
                        <button id="${this.IDS.closeBtn}" class="filler-fetch-close">×</button>
                    </div>

                    <!-- Body -->
                    <div id="${this.IDS.body}" class="filler-fetch-body">
                        <!-- Progress -->
                        <div class="filler-fetch-progress-section">
                            <div class="filler-fetch-progress-info">
                                <span id="${this.IDS.progressText}" class="filler-fetch-status-text">Ready to fetch filler data...</span>
                                <span class="filler-fetch-percentage">0%</span>
                            </div>
                            <div id="${this.IDS.progressBar}" class="filler-fetch-progress-bar">
                                <div id="${this.IDS.progressFill}" class="filler-fetch-progress-fill"></div>
                            </div>
                        </div>

                        <!-- Stats -->
                        <div class="filler-fetch-stats">
                            <div class="filler-fetch-stat-item">
                                <span class="filler-fetch-stat-value" data-stat="fetched">0</span>
                                <span class="filler-fetch-stat-label">Fetched</span>
                            </div>
                            <div class="filler-fetch-stat-item">
                                <span class="filler-fetch-stat-value" data-stat="cached">0</span>
                                <span class="filler-fetch-stat-label">Cached</span>
                            </div>
                            <div class="filler-fetch-stat-item">
                                <span class="filler-fetch-stat-value" data-stat="skipped">0</span>
                                <span class="filler-fetch-stat-label">Skipped</span>
                            </div>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div id="${this.IDS.footer}" class="filler-fetch-footer">
                        <button id="${this.IDS.cancelBtn}" class="filler-fetch-btn filler-fetch-btn-secondary" style="display: none;">
                            Cancel
                        </button>
                        <button id="${this.IDS.startBtn}" class="filler-fetch-btn filler-fetch-btn-primary">
                            Start Fetch
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.injectStyles();
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    },

    /**
     * Inject CSS
     */
    injectStyles() {
        const styles = `
            <style id="filler-fetch-ui-styles">
                .filler-fetch-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(10, 10, 15, 0.85);
                    backdrop-filter: blur(4px);
                    z-index: 100000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                    animation: filler-fade-in 0.2s ease;
                }

                @keyframes filler-fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                .filler-fetch-container {
                    background: #14141f;
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 14px;
                    box-shadow: 
                        0 1px 0 0 rgba(255, 255, 255, 0.08) inset,
                        0 -1px 0 0 rgba(0, 0, 0, 0.4) inset,
                        0 8px 24px rgba(0, 0, 0, 0.3);
                    max-width: 400px;
                    width: 100%;
                    overflow: hidden;
                    animation: filler-slide-up 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }

                @keyframes filler-slide-up {
                    from {
                        transform: translateY(20px);
                        opacity: 0;
                    }
                    to {
                        transform: translateY(0);
                        opacity: 1;
                    }
                }

                .filler-fetch-header {
                    padding: 20px;
                    background: #1a1a25;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }

                .filler-fetch-title {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    font-size: 16px;
                    font-weight: 600;
                    color: #ffffff;
                }

                .filler-fetch-icon {
                    font-size: 20px;
                }

                .filler-fetch-close {
                    background: rgba(255, 255, 255, 0.05);
                    border: none;
                    border-radius: 8px;
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    color: #a0a0b0;
                    font-size: 24px;
                    line-height: 1;
                    transition: all 0.15s;
                }

                .filler-fetch-close:hover {
                    background: rgba(255, 255, 255, 0.1);
                    color: #ffffff;
                }

                .filler-fetch-body {
                    padding: 24px 20px;
                }

                .filler-fetch-progress-section {
                    margin-bottom: 20px;
                }

                .filler-fetch-progress-info {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                }

                .filler-fetch-status-text {
                    font-size: 13px;
                    color: #a0a0b0;
                }

                .filler-fetch-percentage {
                    font-size: 13px;
                    font-weight: 600;
                    color: #ff6b6b;
                }

                .filler-fetch-progress-bar {
                    height: 8px;
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 4px;
                    overflow: hidden;
                }

                .filler-fetch-progress-fill {
                    height: 100%;
                    background: linear-gradient(90deg, #ff6b6b 0%, #ff8e53 100%);
                    border-radius: 4px;
                    width: 0%;
                    transition: width 0.3s ease;
                }

                .filler-fetch-stats {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 12px;
                }

                .filler-fetch-stat-item {
                    background: rgba(255, 255, 255, 0.03);
                    border: 1px solid rgba(255, 255, 255, 0.05);
                    border-radius: 10px;
                    padding: 12px;
                    text-align: center;
                }

                .filler-fetch-stat-value {
                    display: block;
                    font-size: 24px;
                    font-weight: 700;
                    color: #ffffff;
                    margin-bottom: 4px;
                }

                .filler-fetch-stat-label {
                    display: block;
                    font-size: 11px;
                    color: #5a5a6e;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .filler-fetch-footer {
                    padding: 16px 20px;
                    background: #1a1a25;
                    border-top: 1px solid rgba(255, 255, 255, 0.05);
                    display: flex;
                    gap: 10px;
                    justify-content: flex-end;
                }

                .filler-fetch-btn {
                    padding: 10px 20px;
                    border: none;
                    border-radius: 10px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.15s;
                }

                .filler-fetch-btn-primary {
                    background: linear-gradient(135deg, #ff6b6b 0%, #ff8e53 100%);
                    color: white;
                    box-shadow: 0 4px 12px rgba(255, 107, 107, 0.3);
                }

                .filler-fetch-btn-primary:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 6px 16px rgba(255, 107, 107, 0.4);
                }

                .filler-fetch-btn-secondary {
                    background: rgba(255, 255, 255, 0.05);
                    color: #a0a0b0;
                }

                .filler-fetch-btn-secondary:hover {
                    background: rgba(255, 255, 255, 0.1);
                    color: #ffffff;
                }

                .filler-fetch-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                    transform: none !important;
                }
            </style>
        `;

        document.head.insertAdjacentHTML('beforeend', styles);
    },

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        document.getElementById(this.IDS.closeBtn).addEventListener('click', () => {
            if (!this.state.isRunning) this.close();
        });

        document.getElementById(this.IDS.overlay).addEventListener('click', (e) => {
            if (e.target.id === this.IDS.overlay && !this.state.isRunning) this.close();
        });

        document.getElementById(this.IDS.startBtn).addEventListener('click', () => {
            this.startFetch();
        });

        document.getElementById(this.IDS.cancelBtn).addEventListener('click', () => {
            this.cancel();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.state.isOpen && !this.state.isRunning) {
                this.close();
            }
        });
    },

    /**
     * Open modal
     */
    async open() {
        this.state.isOpen = true;
        this.resetState();

        const { Storage } = window.AnimeTracker;
        const data = await Storage.get(['animeData']);
        const animeData = data.animeData || {};
        this.state.total = Object.keys(animeData).length;

        document.getElementById(this.IDS.overlay).style.display = 'flex';
    },

    /**
     * Close modal
     */
    close() {
        this.state.isOpen = false;
        document.getElementById(this.IDS.overlay).style.display = 'none';
    },

    /**
     * Reset state
     */
    resetState() {
        this.state.isRunning = false;
        this.state.isCancelled = false;
        this.state.currentIndex = 0;
        this.state.fetched = 0;
        this.state.cached = 0;
        this.state.skipped = 0;
        this.state.failed = 0;

        this.updateProgress(0);
        this.updateProgressText('Ready to fetch filler data...');
        this.updateStat('fetched', 0);
        this.updateStat('cached', 0);
        this.updateStat('skipped', 0);

        const startBtn = document.getElementById(this.IDS.startBtn);
        startBtn.innerHTML = 'Start Fetch';
        startBtn.style.display = 'flex';
        startBtn.disabled = false;
        document.getElementById(this.IDS.cancelBtn).style.display = 'none';
    },

    /**
     * Update progress
     */
    updateProgress(percentage) {
        document.getElementById(this.IDS.progressFill).style.width = `${percentage}%`;
        document.querySelector('.filler-fetch-percentage').textContent = `${Math.round(percentage)}%`;
    },

    /**
     * Update progress text
     */
    updateProgressText(text) {
        document.getElementById(this.IDS.progressText).textContent = text;
    },

    /**
     * Update stat
     */
    updateStat(statName, value) {
        const statEl = document.querySelector(`[data-stat="${statName}"]`);
        if (statEl) statEl.textContent = value;
    },

    /**
     * Start fetch
     */
    async startFetch() {
        this.state.isRunning = true;
        this.state.isCancelled = false;

        document.getElementById(this.IDS.startBtn).style.display = 'none';
        document.getElementById(this.IDS.cancelBtn).style.display = 'flex';

        const { FillerService, FillerConsoleLogger: logger, Storage, CONFIG, ANIME_NO_FILLER_DATA, SeasonGrouping } = window.AnimeTracker;

        logger.groupStart('🎭 Filler Data Fetch', logger.COLORS.primary);

        const data = await Storage.get(['animeData']);
        const animeData = data.animeData || {};
        const animeList = Object.entries(animeData);

        for (let i = 0; i < animeList.length; i++) {
            if (this.state.isCancelled) {
                logger.error('Fetch cancelled by user');
                break;
            }

            const [slug, anime] = animeList[i];
            const progress = ((i + 1) / animeList.length) * 100;
            const animeName = anime.title || slug;

            this.updateProgress(progress);
            this.updateProgressText(`${i + 1}/${animeList.length} - ${animeName}`);

            // Show progress every 10 items
            if (i % 10 === 0 || i === animeList.length - 1) {
                logger.progress(i + 1, animeList.length, animeName);
            }

            // Check if in no-filler-data list
            const baseSlug = SeasonGrouping.getBaseSlug(slug);
            if (ANIME_NO_FILLER_DATA && (ANIME_NO_FILLER_DATA.includes(slug) || ANIME_NO_FILLER_DATA.includes(baseSlug))) {
                logger.skip(animeName, 'In no-filler-data list');
                this.state.skipped++;
                this.updateStat('skipped', this.state.skipped);
                continue;
            }

            // Check if movie/OVA/special
            if (FillerService.isLikelyMovie(slug)) {
                logger.skip(animeName, 'Movie/OVA/Special');
                this.state.skipped++;
                this.updateStat('skipped', this.state.skipped);
                continue;
            }

            // Check if unlikely to have data
            if (FillerService.isUnlikelyToHaveFillerData(slug)) {
                logger.skip(animeName, 'Niche anime (not on AnimeFillerList)');
                this.state.skipped++;
                this.updateStat('skipped', this.state.skipped);
                continue;
            }

            // Check cache
            if (FillerService.episodeTypesCache[slug]) {
                const cached = FillerService.episodeTypesCache[slug];
                const cacheAge = cached.cachedAt ? Date.now() - cached.cachedAt : Infinity;

                if (cacheAge < CONFIG.EPISODE_TYPES_CACHE_TTL) {
                    const ageMinutes = Math.round(cacheAge / 60000);
                    const ageText = ageMinutes < 60 ? `${ageMinutes}m ago` : `${Math.round(ageMinutes / 60)}h ago`;
                    logger.cached(animeName, ageText);
                    this.state.cached++;
                    this.updateStat('cached', this.state.cached);
                    continue;
                }
            }

            // Fetch episode types
            try {
                logger.fetchStart(animeName, slug);
                const episodeTypes = await FillerService.fetchEpisodeTypes(slug);

                if (episodeTypes && episodeTypes.totalEpisodes) {
                    FillerService.updateFromEpisodeTypes(slug, episodeTypes);
                    
                    const fillerCount = episodeTypes.filler ? episodeTypes.filler.length : 0;
                    const fillerPercent = episodeTypes.totalEpisodes > 0 
                        ? Math.round((fillerCount / episodeTypes.totalEpisodes) * 100) 
                        : 0;
                    
                    logger.success(animeName, {
                        total: episodeTypes.totalEpisodes,
                        filler: fillerCount,
                        fillerPercent: fillerPercent
                    });
                    
                    this.state.fetched++;
                    this.updateStat('fetched', this.state.fetched);
                } else {
                    logger.skip(animeName, 'No filler data found (404 or empty response)');
                    this.state.skipped++;
                    this.updateStat('skipped', this.state.skipped);
                }
            } catch (error) {
                logger.error(`Failed to fetch ${animeName}`, error.message);
                this.state.failed++;
                this.state.skipped++;
                this.updateStat('skipped', this.state.skipped);
            }

            await new Promise(resolve => setTimeout(resolve, 50));
        }

        this.state.isRunning = false;
        this.updateProgress(100);
        this.updateProgressText('✓ Complete!');

        logger.summary({
            total: this.state.total,
            fetched: this.state.fetched,
            cached: this.state.cached,
            skipped: this.state.skipped,
            failed: this.state.failed
        });

        logger.groupEnd();

        document.getElementById(this.IDS.cancelBtn).style.display = 'none';
        const startBtn = document.getElementById(this.IDS.startBtn);
        startBtn.innerHTML = '✓ Done';
        startBtn.style.display = 'flex';
        startBtn.disabled = true; // Prevent spam clicks

        // Call onComplete callback only once
        if (this.onComplete && typeof this.onComplete === 'function') {
            this.onComplete();
            this.onComplete = null; // Clear to prevent multiple calls
        }

        setTimeout(() => {
            if (this.state.isOpen && !this.state.isRunning) this.close();
        }, 2000);
    },

    /**
     * Cancel fetch
     */
    cancel() {
        this.state.isCancelled = true;
        this.state.isRunning = false;

        this.updateProgressText('Cancelled');
        document.getElementById(this.IDS.cancelBtn).style.display = 'none';
        document.getElementById(this.IDS.startBtn).style.display = 'flex';
    }
};

// Export
window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.FillerFetchUI = FillerFetchUI;
