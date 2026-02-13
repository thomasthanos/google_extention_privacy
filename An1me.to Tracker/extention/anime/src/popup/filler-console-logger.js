/**
 * Filler Console Logger - Beautiful & Informative
 * Δείχνει ακριβώς τι γίνεται με όμορφη μορφή
 */

const FillerConsoleLogger = {
    COLORS: {
        primary: '#ff6b6b',
        success: '#4ade80',
        error: '#ef4444',
        warning: '#fbbf24',
        info: '#60a5fa',
        muted: '#94a3b8',
        accent: '#a78bfa',
    },

    ICONS: {
        start: '🚀',
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️',
        fetch: '📡',
        cache: '💾',
        skip: '⏭️',
        anime: '🎬',
        complete: '🎉',
    },

    /**
     * Styled log
     */
    styled(icon, title, message, color, data = null) {
        const titleStyle = `color: ${color}; font-weight: bold; font-size: 13px;`;
        const msgStyle = `color: ${this.COLORS.muted}; font-size: 12px;`;
        
        if (data) {
            console.log(`%c${icon} ${title} %c${message}`, titleStyle, msgStyle, data);
        } else {
            console.log(`%c${icon} ${title} %c${message}`, titleStyle, msgStyle);
        }
    },

    /**
     * Group start
     */
    groupStart(title, color = this.COLORS.primary) {
        const style = `color: ${color}; font-weight: bold; font-size: 14px; background: rgba(255,107,107,0.1); padding: 4px 8px; border-radius: 4px;`;
        console.groupCollapsed(`%c${title}`, style);
    },

    /**
     * Group end
     */
    groupEnd() {
        console.groupEnd();
    },

    /**
     * Fetch start
     */
    fetchStart(animeName, slug) {
        this.styled(this.ICONS.fetch, 'Fetching', `${animeName} (${slug})`, this.COLORS.info);
    },

    /**
     * Success
     */
    success(message, stats = null) {
        if (stats) {
            this.styled(this.ICONS.success, 'Success', message, this.COLORS.success);
            console.log(`  📊 Episodes: ${stats.total} | Filler: ${stats.filler} (${stats.fillerPercent}%)`);
        } else {
            this.styled(this.ICONS.success, 'Success', message, this.COLORS.success);
        }
    },

    /**
     * Cache hit
     */
    cached(animeName, age) {
        this.styled(this.ICONS.cache, 'Cached', `${animeName} (${age})`, this.COLORS.accent);
    },

    /**
     * Skip with reason
     */
    skip(animeName, reason) {
        this.styled(this.ICONS.skip, 'Skipped', `${animeName} - ${reason}`, this.COLORS.warning);
    },

    /**
     * Error
     */
    error(message, error = null) {
        this.styled(this.ICONS.error, 'Error', message, this.COLORS.error, error);
    },

    /**
     * Summary table
     */
    summary(data) {
        const style = `color: ${this.COLORS.success}; font-weight: bold; font-size: 14px; background: rgba(74,222,128,0.1); padding: 4px 8px; border-radius: 4px;`;
        console.log(`%c${this.ICONS.complete} Fetch Complete`, style);
        
        const table = {
            '✅ Fetched': data.fetched,
            '💾 Cached': data.cached,
            '⏭️ Skipped': data.skipped,
            '❌ Failed': data.failed || 0,
            '📊 Total': data.total,
        };
        
        console.table(table);
    },

    /**
     * Progress
     */
    progress(current, total, name) {
        const percent = Math.round((current / total) * 100);
        const bar = '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5));
        const style = `color: ${this.COLORS.info}; font-weight: bold;`;
        console.log(`%c[${current}/${total}] ${bar} ${percent}% - ${name}`, style);
    }
};

// Export
window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.FillerConsoleLogger = FillerConsoleLogger;
