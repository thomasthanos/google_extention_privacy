/**
 * Anime Tracker - Custom Console Logger
 * Beautiful, styled console logs for browser debugging
 */

const Logger = (function() {
    'use strict';

    const CONFIG = {
        enabled: true,
        minLevel: 'DEBUG',
        showTimestamp: true,
        showBadge: true,
        prefix: '🎬 Anime Tracker'
    };

    const LEVELS = {
        DEBUG: { priority: 0, color: '#6366f1', bg: '#eef2ff', icon: '🔍', method: 'log' },
        INFO: { priority: 1, color: '#0ea5e9', bg: '#f0f9ff', icon: 'ℹ️', method: 'info' },
        SUCCESS: { priority: 1, color: '#10b981', bg: '#ecfdf5', icon: '✅', method: 'log' },
        WARN: { priority: 2, color: '#f59e0b', bg: '#fffbeb', icon: '⚠️', method: 'warn' },
        ERROR: { priority: 3, color: '#ef4444', bg: '#fef2f2', icon: '❌', method: 'error' }
    };

    const STYLES = {
        badge: (color, bg) => `
            background: ${bg};
            color: ${color};
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: 600;
            font-size: 11px;
            border: 1px solid ${color}33;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        `.replace(/\s+/g, ' ').trim(),
        
        prefix: `
            background: linear-gradient(135deg, #ff6b6b, #ff8e53);
            color: white;
            padding: 3px 8px;
            border-radius: 4px;
            font-weight: 700;
            font-size: 11px;
            margin-right: 4px;
            box-shadow: 0 2px 4px rgba(255,107,107,0.3);
            text-shadow: 0 1px 1px rgba(0,0,0,0.2);
        `.replace(/\s+/g, ' ').trim(),
        
        timestamp: `
            color: #6b7280;
            font-size: 10px;
            font-family: monospace;
        `.replace(/\s+/g, ' ').trim(),
        
        message: (color) => `
            color: ${color};
            font-weight: 500;
        `.replace(/\s+/g, ' ').trim()
    };

    function shouldLog(level) {
        if (!CONFIG.enabled) return false;
        return (LEVELS[level]?.priority || 0) >= (LEVELS[CONFIG.minLevel]?.priority || 0);
    }

    function getTimestamp() {
        const now = new Date();
        return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    }

    function log(level, message, data = null) {
        if (!shouldLog(level)) return;

        const L = LEVELS[level];
        const method = console[L.method] || console.log;
        const parts = [];
        const styles = [];

        if (CONFIG.showBadge) {
            parts.push(`%c${CONFIG.prefix}`);
            styles.push(STYLES.prefix);
        }

        parts.push(`%c${L.icon} ${level}`);
        styles.push(STYLES.badge(L.color, L.bg));

        if (CONFIG.showTimestamp) {
            parts.push(`%c${getTimestamp()}`);
            styles.push(STYLES.timestamp);
        }

        parts.push(`%c${message}`);
        styles.push(STYLES.message(L.color));

        if (data !== null) {
            method(parts.join(' '), ...styles, data);
        } else {
            method(parts.join(' '), ...styles);
        }
    }

    // Compact progress log - smaller, for frequent saves
    function progress(uniqueId, pct, time) {
        if (!shouldLog('DEBUG')) return;
        const ts = getTimestamp();
        console.log(
            `%c${ts}%c 💾 %c${pct}%%c @ ${time}s %c${uniqueId}`,
            'color: #6b7280; font-size: 10px; font-family: monospace;',
            '',
            'color: #10b981; font-weight: 600;',
            'color: #6b7280;',
            'color: #9ca3af; font-size: 10px;'
        );
    }

    function table(data, title = 'Data') {
        if (!CONFIG.enabled) return;
        console.groupCollapsed(
            `%c${CONFIG.prefix}%c 📊 ${title}`,
            STYLES.prefix,
            'color: #6366f1; font-weight: 600;'
        );
        console.table(data);
        console.groupEnd();
    }

    function group(title, callback, collapsed = true) {
        if (!CONFIG.enabled) return;
        const method = collapsed ? console.groupCollapsed : console.group;
        method(
            `%c${CONFIG.prefix}%c 📁 ${title}`,
            STYLES.prefix,
            'color: #8b5cf6; font-weight: 600;'
        );
        try { callback(); } finally { console.groupEnd(); }
    }

    const timers = new Map();
    function time(label) {
        if (!CONFIG.enabled) return;
        timers.set(label, performance.now());
    }
    function timeEnd(label) {
        if (!CONFIG.enabled) return;
        const start = timers.get(label);
        if (start) {
            timers.delete(label);
            log('DEBUG', `⏱ ${label}: ${(performance.now() - start).toFixed(1)}ms`);
        }
    }

    function episode(action, anime, epNum) {
        if (!CONFIG.enabled) return;
        const icons = { tracked: '📺', progress: '⏸️', resumed: '▶️', completed: '🎉' };
        const colors = { tracked: '#10b981', progress: '#f59e0b', resumed: '#0ea5e9', completed: '#8b5cf6' };
        console.log(
            `%c${CONFIG.prefix}%c ${icons[action] || '📺'} ${action.toUpperCase()}%c ${anime} Ep${epNum}`,
            STYLES.prefix,
            `color: ${colors[action] || '#6366f1'}; font-weight: 600;`,
            'color: #374151;'
        );
    }

    function sync(status, details = '') {
        if (!CONFIG.enabled) return;
        const configs = {
            started: { icon: '🔄', color: '#0ea5e9' },
            success: { icon: '✅', color: '#10b981' },
            error: { icon: '❌', color: '#ef4444' }
        };
        const cfg = configs[status] || configs.started;
        console.log(
            `%c${CONFIG.prefix}%c ${cfg.icon} Sync: ${status}%c ${details}`,
            STYLES.prefix,
            `color: ${cfg.color}; font-weight: 600;`,
            'color: #6b7280;'
        );
    }

    function storage(op, key, data) {
        if (!CONFIG.enabled || !shouldLog('DEBUG')) return;
        const icon = op === 'GET' ? '📖' : op === 'SET' ? '💾' : '🗑️';
        const color = op === 'GET' ? '#0ea5e9' : op === 'SET' ? '#10b981' : '#ef4444';
        console.groupCollapsed(
            `%c${CONFIG.prefix}%c ${icon} ${op}%c ${key}`,
            STYLES.prefix,
            `color: ${color}; font-weight: 600;`,
            'color: #6b7280;'
        );
        if (data !== undefined) console.log('Data:', data);
        console.groupEnd();
    }

    function firebase(op, path, success = true) {
        if (!CONFIG.enabled) return;
        const icon = success ? '🔥' : '💥';
        const color = success ? '#f59e0b' : '#ef4444';
        console.log(
            `%c${CONFIG.prefix}%c ${icon} FB ${op}%c ${path} %c${success ? '✓' : '✗'}`,
            STYLES.prefix,
            `color: ${color}; font-weight: 600;`,
            'color: #6b7280;',
            `color: ${success ? '#10b981' : '#ef4444'}; font-weight: 700;`
        );
    }

    function configure(opts) { Object.assign(CONFIG, opts); }
    function enable() { CONFIG.enabled = true; }
    function disable() { CONFIG.enabled = false; }
    function setLevel(level) { if (LEVELS[level]) CONFIG.minLevel = level; }

    return {
        debug: (msg, data) => log('DEBUG', msg, data),
        info: (msg, data) => log('INFO', msg, data),
        success: (msg, data) => log('SUCCESS', msg, data),
        warn: (msg, data) => log('WARN', msg, data),
        error: (msg, data) => log('ERROR', msg, data),
        log: (msg, data) => log('INFO', msg, data),
        progress,
        table,
        group,
        time,
        timeEnd,
        episode,
        sync,
        storage,
        firebase,
        configure,
        enable,
        disable,
        setLevel,
        raw: console
    };
})();

if (typeof window !== 'undefined') window.Logger = Logger;
if (typeof module !== 'undefined' && module.exports) module.exports = Logger;
