/**
 * Anime Tracker - Content Script Logger
 * Beautiful styled console logging
 */

const ContentLogger = {
    levels: { DEBUG: 0, INFO: 1, SUCCESS: 1, WARN: 2, ERROR: 3 },
    prefix: '🎬 Anime Tracker',
    
    get currentLevel() {
        return window.AnimeTrackerContent?.CONFIG?.LOG_LEVEL || 'INFO';
    },
    
    styles: {
        prefix: 'background: linear-gradient(135deg, #ff6b6b, #ff8e53); color: white; padding: 3px 8px; border-radius: 4px; font-weight: 700; font-size: 11px; box-shadow: 0 2px 4px rgba(255,107,107,0.3);',
        badge: (color, bg) => `background: ${bg}; color: ${color}; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 11px; border: 1px solid ${color}33;`,
        timestamp: 'color: #6b7280; font-size: 10px; font-family: monospace;',
        message: (color) => `color: ${color}; font-weight: 500;`
    },
    
    config: {
        DEBUG:   { color: '#6366f1', bg: '#eef2ff', icon: '🔍' },
        INFO:    { color: '#0ea5e9', bg: '#f0f9ff', icon: 'ℹ️' },
        SUCCESS: { color: '#10b981', bg: '#ecfdf5', icon: '✅' },
        WARN:    { color: '#f59e0b', bg: '#fffbeb', icon: '⚠️' },
        ERROR:   { color: '#f87171', bg: '#fef2f2', icon: '❌' }
    },
    
    getTimestamp() {
        const now = new Date();
        return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    },
    
    shouldLog(level) {
        return this.levels[level] >= this.levels[this.currentLevel];
    },
    
    log(level, message, data = null) {
        if (!this.shouldLog(level)) return;
        
        const L = this.config[level];
        const ts = this.getTimestamp();
        const method = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
        
        if (data !== null) {
            method(
                `%c${this.prefix}%c %c${L.icon} ${level}%c %c${ts}%c %c${message}`,
                this.styles.prefix, '',
                this.styles.badge(L.color, L.bg), '',
                this.styles.timestamp, '',
                this.styles.message(L.color),
                data
            );
        } else {
            method(
                `%c${this.prefix}%c %c${L.icon} ${level}%c %c${ts}%c %c${message}`,
                this.styles.prefix, '',
                this.styles.badge(L.color, L.bg), '',
                this.styles.timestamp, '',
                this.styles.message(L.color)
            );
        }
    },
    
    // Compact progress save log
    progress(uniqueId, pct, time) {
        if (!this.shouldLog('DEBUG')) return;
        const ts = this.getTimestamp();
        console.log(
            `%c${ts}%c 💾 %c${pct}%%c @ ${time}s %c${uniqueId}`,
            'color: #6b7280; font-size: 10px; font-family: monospace;',
            '',
            'color: #10b981; font-weight: 600;',
            'color: #6b7280;',
            'color: #9ca3af; font-size: 10px;'
        );
    },
    
    debug(msg, data) { this.log('DEBUG', msg, data); },
    info(msg, data) { this.log('INFO', msg, data); },
    success(msg, data) { this.log('SUCCESS', msg, data); },
    warn(msg, data) { this.log('WARN', msg, data); },
    error(msg, data) { this.log('ERROR', msg, data); }
};

// Export
window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.Logger = ContentLogger;
