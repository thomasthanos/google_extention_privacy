/**
 * Anime Tracker - Popup Logger
 *
 * Provides optional styled logging helpers without overriding native console.
 */

(function () {
    'use strict';

    const rawLog = console.log.bind(console);
    const rawWarn = console.warn.bind(console);
    const rawError = console.error.bind(console);

    function formatPrefix(level) {
        return `%cAnime Tracker%c ${level}`;
    }

    const styles = {
        prefix: 'color:#ff6b6b;font-weight:700;',
        level: 'color:#94a3b8;font-weight:600;'
    };

    const PopupLogger = {
        log(...args) {
            rawLog(formatPrefix('LOG'), styles.prefix, styles.level, ...args);
        },
        warn(...args) {
            rawWarn(formatPrefix('WARN'), styles.prefix, styles.level, ...args);
        },
        error(...args) {
            rawError(formatPrefix('ERROR'), styles.prefix, styles.level, ...args);
        }
    };

    window.PopupLogger = PopupLogger;
    rawLog(formatPrefix('INIT'), styles.prefix, styles.level, 'Popup logger ready');
})();

