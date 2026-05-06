/**
 * Anime Tracker - Popup Logger
 *
 * Styled console output — each tag gets its own colored badge.
 * Usage: PopupLogger.log('Sync', 'Merged episodes:', 2970);
 */

(function () {
    'use strict';

    const rawLog = console.log.bind(console);
    const rawWarn = console.warn.bind(console);
    const rawError = console.error.bind(console);
    const rawDebug = (console.debug || console.log).bind(console);
    const onceKeys = new Set();
    const throttleState = new Map();

    const TAG_COLORS = {
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

    const DEFAULT_COLOR = { bg: 'rgba(148,163,184,0.15)', text: '#94a3b8' };

    function styled(logFn, tag, args, opts) {
        const c = TAG_COLORS[tag] || DEFAULT_COLOR;
        const tagStyle = `color:${c.text};font-weight:700;background:${c.bg};padding:1px 6px;border-radius:3px;`;
        // For info-level (compact) calls, drop ALL extras — keep the line to
        // just `Tag message`. If you need the payload, inline it into the
        // message string at the call site, or use warn/error.
        if (opts && opts.compact) {
            const msg = args && args.length ? args[0] : '';
            logFn(`%c${tag}`, tagStyle, msg);
            return;
        }
        logFn(`%c${tag}`, tagStyle, ...args);
    }

    function once(tag, key, logFn, args, opts) {
        if (!key) {
            styled(logFn, tag, args, opts);
            return;
        }
        const scopedKey = `${tag}:${key}`;
        if (onceKeys.has(scopedKey)) return;
        onceKeys.add(scopedKey);
        styled(logFn, tag, args, opts);
    }

    function throttled(tag, key, intervalMs, logFn, args, opts) {
        if (!key) {
            styled(logFn, tag, args, opts);
            return;
        }
        const scopedKey = `${tag}:${key}`;
        const now = Date.now();
        const last = throttleState.get(scopedKey) || 0;
        if ((now - last) < Math.max(0, Number(intervalMs) || 0)) return;
        throttleState.set(scopedKey, now);
        styled(logFn, tag, args, opts);
    }

    const COMPACT = { compact: true };

    window.PopupLogger = {
        // log → compact (drops extras; inline data into the message string).
        log(tag, ...args)   { styled(rawLog, tag, args, COMPACT); },
        once(tag, key, ...args) { once(tag, key, rawLog, args, COMPACT); },
        throttled(tag, key, intervalMs, ...args) { throttled(tag, key, intervalMs, rawLog, args, COMPACT); },
        // debug/warn/error → full objects (devs poke at debug; warn/error need detail).
        debug(tag, ...args) { styled(rawDebug, tag, args); },
        warn(tag, ...args)  { styled(rawWarn, tag, args); },
        error(tag, ...args) { styled(rawError, tag, args); },
    };
})();
