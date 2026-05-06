const ContentLogger = {
    levels: { DEBUG: 0, INFO: 1, SUCCESS: 1, WARN: 2, ERROR: 3 },
    prefix: '🎬 Anime Tracker',
    onceKeys: new Set(),
    throttleState: new Map(),

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
        DEBUG: { color: '#6366f1', bg: '#eef2ff', icon: '🔍' },
        INFO: { color: '#0ea5e9', bg: '#f0f9ff', icon: 'ℹ️' },
        SUCCESS: { color: '#10b981', bg: '#ecfdf5', icon: '✅' },
        WARN: { color: '#f59e0b', bg: '#fffbeb', icon: '⚠️' },
        ERROR: { color: '#f87171', bg: '#fef2f2', icon: '❌' }
    },

    getTimestamp() {
        const now = new Date();
        return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    },

    shouldLog(level) {
        return this.levels[level] >= this.levels[this.currentLevel];
    },

    formatPlainMessage(level, message) {
        const L = this.config[level];
        // WARN/ERROR keep timestamp (useful when something breaks).
        // INFO/SUCCESS skip it for compactness.
        const needsTs = level === 'WARN' || level === 'ERROR' || level === 'DEBUG';
        const ts = needsTs ? ` ${this.getTimestamp()}` : '';
        return `[${this.prefix}] ${L.icon} ${level}${ts} ${message}`;
    },

    // Render object/non-string extras inline as a compact one-liner so the
    // console doesn't show expandable "Object" placeholders next to every
    // INFO/SUCCESS line. At DEBUG we keep the full objects so devs can
    // still inspect them (just switch LOG_LEVEL to DEBUG).
    _inlineExtras(extras) {
        if (!extras.length) return '';
        const parts = [];
        for (const e of extras) {
            if (e == null) { parts.push(String(e)); continue; }
            if (typeof e !== 'object') { parts.push(String(e)); continue; }
            try {
                const s = JSON.stringify(e);
                if (!s) { parts.push('[Object]'); continue; }
                if (s.length <= 120) { parts.push(s); continue; }
                // Too long — emit just the top-level keys so the line stays
                // readable but still tells you what kind of object it was.
                const keys = Object.keys(e).slice(0, 4).join(', ');
                parts.push(`{${keys}${Object.keys(e).length > 4 ? ', …' : ''}}`);
            } catch {
                parts.push('[Object]');
            }
        }
        return parts.length ? ' ' + parts.join(' ') : '';
    },

    log(level, message, ...args) {
        if (!this.shouldLog(level)) return;

        const L = this.config[level];
        const method = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
        const extras = args.filter((arg) => arg !== undefined);

        if (level === 'WARN' || level === 'ERROR') {
            // WARN/ERROR keep the full objects — they're rare and the detail
            // is usually what we want when something went wrong.
            method(this.formatPlainMessage(level, message), ...extras);
            return;
        }

        if (level === 'DEBUG') {
            // DEBUG keeps full objects (still expandable in console) so devs
            // can poke at them, plus a timestamp.
            const ts = this.getTimestamp();
            method(
                `%c${this.prefix}%c %c${L.icon} ${level}%c %c${ts}%c %c${message}`,
                this.styles.prefix, '',
                this.styles.badge(L.color, L.bg), '',
                this.styles.timestamp, '',
                this.styles.message(L.color),
                ...extras
            );
            return;
        }

        // INFO / SUCCESS → minimal: prefix + icon + message. No timestamp,
        // no extras (they were producing noisy {"id":"…"} tails). Switch
        // LOG_LEVEL to DEBUG when you actually need the payload.
        method(
            `%c${this.prefix}%c %c${L.icon} ${level}%c %c${message}`,
            this.styles.prefix, '',
            this.styles.badge(L.color, L.bg), '',
            this.styles.message(L.color)
        );
    },

    once(key, level, message, ...args) {
        if (!key) return this.log(level, message, ...args);
        if (this.onceKeys.has(key)) return;
        this.onceKeys.add(key);
        this.log(level, message, ...args);
    },

    throttled(key, level, intervalMs, message, ...args) {
        if (!key) return this.log(level, message, ...args);
        const now = Date.now();
        const last = this.throttleState.get(key) || 0;
        if ((now - last) < Math.max(0, Number(intervalMs) || 0)) return;
        this.throttleState.set(key, now);
        this.log(level, message, ...args);
    },

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

    debug(msg, ...args) { this.log('DEBUG', msg, ...args); },
    info(msg, ...args) { this.log('INFO', msg, ...args); },
    success(msg, ...args) { this.log('SUCCESS', msg, ...args); },
    warn(msg, ...args) { this.log('WARN', msg, ...args); },
    error(msg, ...args) { this.log('ERROR', msg, ...args); }
};

window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.Logger = ContentLogger;
