


(function () {
    'use strict';


    const PERMANENT_REFRESH_ERRORS = Object.freeze([
        'INVALID_REFRESH_TOKEN',
        'TOKEN_EXPIRED',
        'USER_DISABLED',
        'USER_NOT_FOUND',
        'INVALID_GRANT',
        'invalid_grant',
        'CREDENTIAL_TOO_OLD_LOGIN_AGAIN',
        'MISSING_REFRESH_TOKEN',
    ]);


    function classify(httpStatus, errorBody) {
        const body = typeof errorBody === 'string'
            ? errorBody
            : (errorBody && typeof errorBody === 'object' ? JSON.stringify(errorBody) : '');


        if (httpStatus === 400 && body) {
            for (const code of PERMANENT_REFRESH_ERRORS) {
                if (body.includes(code)) {
                    return { permanent: true, transient: false, matchedCode: code };
                }
            }
        }
        return { permanent: false, transient: true, matchedCode: null };
    }


    function isTransientNetworkError(err) {
        if (!err) return false;
        if (err.isTimeout) return true;
        const name = String(err.name || '').toLowerCase();
        if (name === 'aborterror' || name === 'timeouterror' || name === 'typeerror') return true;
        const msg = String(err.message || err).toLowerCase();
        return (
            msg.includes('failed to fetch') ||
            msg.includes('network') ||
            msg.includes('offline') ||
            msg.includes('aborted') ||
            msg.includes('timeout') ||
            msg.includes('timed out') ||
            msg.includes('load failed')
        );
    }

    const api = Object.freeze({
        classify,
        isTransientNetworkError,
        PERMANENT_REFRESH_ERRORS
    });


    const root = (typeof globalThis !== 'undefined') ? globalThis
        : (typeof self !== 'undefined') ? self
        : (typeof window !== 'undefined') ? window : null;
    if (root) root.AnimeTrackerAuthClassifier = api;
})();
