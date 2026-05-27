


(function () {
    'use strict';


    const rawLog = console.log.bind(console);
    const rawWarn = console.warn.bind(console);
    const rawError = console.error.bind(console);
    const rawDebug = (console.debug || console.log).bind(console);
    const popupOnceKeys = new Set();
    const popupThrottleState = new Map();

    const POPUP_TAG_COLORS = {
        Firebase:    { bg: 'rgba(240,192,64,0.2)',  text: '#f0c040' },
        Sync:        { bg: 'rgba(79,195,247,0.2)',  text: '#4fc3f7' },
        Cleanup:     { bg: 'rgba(76,175,130,0.2)',  text: '#4caf82' },
        Storage:     { bg: 'rgba(155,106,255,0.2)', text: '#9b6aff' },
        Settings:    { bg: 'rgba(107,118,148,0.2)', text: '#6b7694' },
        Stats:       { bg: 'rgba(79,195,247,0.2)',  text: '#4fc3f7' },
        Delete:      { bg: 'rgba(240,112,112,0.2)', text: '#f07070' },
        Complete:    { bg: 'rgba(76,175,130,0.2)',  text: '#4caf82' },
        Drop:        { bg: 'rgba(229,115,115,0.2)', text: '#e57373' },
        AddAnime:    { bg: 'rgba(79,195,247,0.2)',  text: '#4fc3f7' },
        EditTitle:   { bg: 'rgba(79,195,247,0.2)',  text: '#4fc3f7' },
        RepairAll:   { bg: 'rgba(240,192,64,0.2)',  text: '#f0c040' },
        Init:        { bg: 'rgba(148,163,184,0.2)', text: '#94a3b8' },
        RefreshData: { bg: 'rgba(79,195,247,0.2)',  text: '#4fc3f7' },
        RefreshInfo: { bg: 'rgba(155,106,255,0.2)', text: '#9b6aff' },
        AnimeInfo:   { bg: 'rgba(155,106,255,0.2)', text: '#9b6aff' },
        FetchFiller: { bg: 'rgba(240,192,64,0.2)',  text: '#f0c040' },
        'IP-Refresh':{ bg: 'rgba(240,192,64,0.2)',  text: '#f0c040' },
    };
    const POPUP_DEFAULT_COLOR = { bg: 'rgba(148,163,184,0.15)', text: '#94a3b8' };

    function popupStyled(logFn, tag, args, opts) {
        const c = POPUP_TAG_COLORS[tag] || POPUP_DEFAULT_COLOR;
        const tagStyle = `color:${c.text};font-weight:700;background:${c.bg};padding:1px 6px;border-radius:3px;`;


        if (opts && opts.compact) {
            const msg = args && args.length ? args[0] : '';
            logFn(`%c${tag}`, tagStyle, msg);
            return;
        }
        logFn(`%c${tag}`, tagStyle, ...args);
    }

    function popupOnce(tag, key, logFn, args, opts) {
        if (!key) { popupStyled(logFn, tag, args, opts); return; }
        const scopedKey = `${tag}:${key}`;
        if (popupOnceKeys.has(scopedKey)) return;
        popupOnceKeys.add(scopedKey);
        popupStyled(logFn, tag, args, opts);
    }

    function popupThrottled(tag, key, intervalMs, logFn, args, opts) {
        if (!key) { popupStyled(logFn, tag, args, opts); return; }
        const scopedKey = `${tag}:${key}`;
        const now = Date.now();
        const last = popupThrottleState.get(scopedKey) || 0;
        if ((now - last) < Math.max(0, Number(intervalMs) || 0)) return;
        popupThrottleState.set(scopedKey, now);
        popupStyled(logFn, tag, args, opts);
    }

    const POPUP_COMPACT = { compact: true };

    const POPUP_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
    function popupLevel() {
        try {
            return (typeof window !== 'undefined' && window.POPUP_LOG_LEVEL)
                || (typeof window !== 'undefined' && window.AnimeTrackerContent?.CONFIG?.LOG_LEVEL)
                || 'INFO';
        } catch {
            return 'INFO';
        }
    }
    function shouldPopupLog(level) {
        const lvl = POPUP_LEVELS[level];
        const cur = POPUP_LEVELS[popupLevel()] ?? POPUP_LEVELS.INFO;
        return lvl >= cur;
    }

    const PopupLogger = {

        log(tag, ...args)   { if (!shouldPopupLog('INFO')) return; popupStyled(rawLog, tag, args, POPUP_COMPACT); },
        once(tag, key, ...args) { if (!shouldPopupLog('INFO')) return; popupOnce(tag, key, rawLog, args, POPUP_COMPACT); },
        throttled(tag, key, intervalMs, ...args) { if (!shouldPopupLog('INFO')) return; popupThrottled(tag, key, intervalMs, rawLog, args, POPUP_COMPACT); },
        debug(tag, ...args) { if (!shouldPopupLog('DEBUG')) return; popupStyled(rawDebug, tag, args); },
        warn(tag, ...args)  { if (!shouldPopupLog('WARN')) return; popupStyled(rawWarn, tag, args); },
        error(tag, ...args) { popupStyled(rawError, tag, args); }
    };


    const ContentLogger = {
        levels: { DEBUG: 0, INFO: 1, SUCCESS: 1, WARN: 2, ERROR: 3 },
        prefix: '🎬 Anime Tracker',
        onceKeys: new Set(),
        throttleState: new Map(),

        get currentLevel() {
            return (typeof window !== 'undefined' && window.AnimeTrackerContent?.CONFIG?.LOG_LEVEL) || 'INFO';
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

        formatPlainMessage(level, message) {
            const L = this.config[level];


            const needsTs = level === 'WARN' || level === 'ERROR' || level === 'DEBUG';
            const ts = needsTs ? ` ${this.getTimestamp()}` : '';
            return `[${this.prefix}] ${L.icon} ${level}${ts} ${message}`;
        },

        log(level, message, ...args) {
            if (!this.shouldLog(level)) return;

            const L = this.config[level];
            const method = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
            const extras = args.filter((arg) => arg !== undefined);

            if (level === 'WARN' || level === 'ERROR') {


                method(this.formatPlainMessage(level, message), ...extras);
                return;
            }

            if (level === 'DEBUG') {


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
        info(msg, ...args)  { this.log('INFO', msg, ...args); },
        success(msg, ...args) { this.log('SUCCESS', msg, ...args); },
        warn(msg, ...args)  { this.log('WARN', msg, ...args); },
        error(msg, ...args) { this.log('ERROR', msg, ...args); }
    };


    if (typeof window !== 'undefined') {
        window.PopupLogger = PopupLogger;
        window.AnimeTrackerContent = window.AnimeTrackerContent || {};
        window.AnimeTrackerContent.Logger = ContentLogger;
    }
})();
