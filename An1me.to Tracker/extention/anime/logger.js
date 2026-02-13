/**
 * Global Logger - Auto-beautify ΟΛΑ τα console logs
 * Κάνει override console.log/warn/error για όμορφα styled outputs
 */

(function() {
    'use strict';

    // Backup original console methods
    const _log = console.log.bind(console);
    const _warn = console.warn.bind(console);
    const _error = console.error.bind(console);

    // Colors
    const COLORS = {
        firebase: '255, 152, 0',    // Orange
        sync: '167, 139, 250',      // Purple
        storage: '16, 185, 129',    // Green
        tracker: '255, 107, 107',   // Red
        background: '96, 165, 250', // Blue
        anime: '255, 107, 107',     // Red
        success: '74, 222, 128',    // Light green
        error: '239, 68, 68',       // Red
        warning: '251, 191, 36',    // Yellow
        info: '148, 163, 184',      // Gray
    };

    // Icons
    const ICONS = {
        firebase: '🔥',
        sync: '☁️',
        storage: '💾',
        tracker: '🎬',
        background: '⚙️',
        anime: '🎬',
        success: '✓',
        error: '✗',
        warning: '⚠',
        info: 'ℹ',
        save: '💿',
        merge: '🔀',
        refresh: '⟳',
        link: '🔗',
        user: '👤',
    };

    /**
     * Beautify log message
     */
    function beautify(...args) {
        if (!args.length) return args;

        const first = String(args[0] || '');
        
        // Match: [Prefix] Message
        const match = first.match(/^\[([^\]]+)\]\s*(.*)$/);
        if (!match) return args;

        const [, prefix, message] = match;
        const lower = prefix.toLowerCase();

        // Determine color and icon
        let color = COLORS.info;
        let icon = ICONS.info;

        if (lower.includes('firebase')) {
            color = COLORS.firebase;
            icon = ICONS.firebase;
        } else if (lower.includes('sync')) {
            color = COLORS.sync;
            icon = ICONS.sync;
        } else if (lower.includes('storage')) {
            color = COLORS.storage;
            icon = ICONS.storage;
        } else if (lower.includes('background')) {
            color = COLORS.background;
            icon = ICONS.background;
        } else if (lower.includes('anime') || lower.includes('tracker')) {
            color = COLORS.tracker;
            icon = ICONS.tracker;
        }

        // Message-specific icons and colors
        const msgLower = message.toLowerCase();
        if (msgLower.includes('✓') || msgLower.includes('success') || msgLower.includes('saved')) {
            icon = ICONS.success;
            color = COLORS.success;
        } else if (msgLower.includes('merged')) {
            icon = ICONS.merge;
            color = COLORS.success;
        } else if (msgLower.includes('redirect') || msgLower.includes('url')) {
            icon = ICONS.link;
        } else if (msgLower.includes('refresh')) {
            icon = ICONS.refresh;
        } else if (msgLower.includes('new episode')) {
            icon = '➕';
            color = COLORS.success;
        } else if (msgLower.includes('signed in')) {
            icon = ICONS.user;
            color = COLORS.success;
            
            // Special handling for "signed in" messages with emails
            const emailMatch = message.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (emailMatch) {
                const email = emailMatch[1];
                const beforeEmail = message.substring(0, message.indexOf(email));
                
                // Create a beautiful email box with proper console styles
                const prefixStyle = `color: rgb(${color}); font-weight: bold; font-size: 12px; padding: 2px 6px; background: rgba(${color}, 0.1); border-radius: 3px;`;
                const msgStyle = `color: rgb(${COLORS.info}); font-size: 11px;`;
                const emailStyle = `
                    color: #a78bfa;
                    background: linear-gradient(135deg, rgba(167, 139, 250, 0.2), rgba(139, 92, 246, 0.25));
                    font-weight: 700;
                    font-size: 11px;
                    padding: 4px 12px;
                    border: 2px solid rgba(167, 139, 250, 0.6);
                    border-radius: 6px;
                    margin: 0 4px;
                `.replace(/\s+/g, ' ').trim();

                return [
                    `%c${prefix} %c${icon} ${beforeEmail}%c ${email} `,
                    prefixStyle,
                    msgStyle,
                    emailStyle,
                    ...args.slice(1)
                ];
            }
        } else if (msgLower.includes('initialized')) {
            icon = '✓';
            color = COLORS.success;
        }

        // Styled output
        const prefixStyle = `color: rgb(${color}); font-weight: bold; font-size: 12px; padding: 2px 6px; background: rgba(${color}, 0.1); border-radius: 3px;`;
        const msgStyle = `color: rgb(${COLORS.info}); font-size: 11px;`;

        return [
            `%c${prefix} %c${icon} ${message}`,
            prefixStyle,
            msgStyle,
            ...args.slice(1)
        ];
    }

    // Override console.log
    console.log = function(...args) {
        const styled = beautify(...args);
        _log(...styled);
    };

    // Override console.warn
    console.warn = function(...args) {
        const styled = beautify(...args);
        if (styled[0] && styled[0].startsWith('%c')) {
            _warn(...styled);
        } else {
            _warn(...args);
        }
    };

    // Override console.error  
    console.error = function(...args) {
        const styled = beautify(...args);
        if (styled[0] && styled[0].startsWith('%c')) {
            _error(...styled);
        } else {
            _error(...args);
        }
    };

    // Beautiful startup
    _log(
        '%c🎬 Anime Tracker - Beautiful Logging Active',
        'color: rgb(255, 107, 107); font-weight: bold; font-size: 13px; padding: 4px 8px; background: linear-gradient(135deg, rgba(255, 107, 107, 0.2), rgba(255, 142, 83, 0.2)); border-radius: 4px;'
    );

})();
