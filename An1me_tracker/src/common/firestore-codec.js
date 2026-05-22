/**
 * Anime Tracker — Firestore REST codec (single source)
 *
 * Encodes/decodes between plain JS objects and Firestore REST JSON value
 * shapes (`{stringValue: ...}`, `{mapValue: {fields: ...}}`, etc.). Replaces
 * the three near-identical copies that previously lived in background.js,
 * src/content/cloud-sync.js, and firebase-lib.js — keeping them in sync by
 * hand was a maintenance burden and a real source of drift (e.g. only one
 * copy handled `timestampValue` on the decode side).
 *
 * Exposed on globalThis.AnimeTrackerFirestoreCodec for use from MV3 service
 * worker (`importScripts`), content scripts (via <script>), and popup.
 */
(function () {
    'use strict';

    function encodeValue(value) {
        if (value === null || value === undefined) return { nullValue: null };
        if (value instanceof Date) return { timestampValue: value.toISOString() };
        if (typeof value === 'string') return { stringValue: value };
        if (typeof value === 'boolean') return { booleanValue: value };
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) return { nullValue: null };
            return Number.isInteger(value)
                ? { integerValue: String(value) }
                : { doubleValue: value };
        }
        if (Array.isArray(value)) {
            return { arrayValue: { values: value.map(encodeValue) } };
        }
        if (typeof value === 'object') {
            return { mapValue: { fields: encodeFields(value) } };
        }
        return { nullValue: null };
    }

    function encodeFields(obj) {
        const fields = {};
        for (const [key, value] of Object.entries(obj || {})) {
            fields[key] = encodeValue(value);
        }
        return fields;
    }

    function decodeValue(v) {
        if (!v) return null;
        // Use `in` so a key explicitly set to null (e.g. nullValue) is still
        // recognized. `!== undefined` works too but `in` is more direct.
        if ('nullValue' in v) return null;
        if ('booleanValue' in v) return v.booleanValue;
        if ('stringValue' in v) return v.stringValue;
        if ('integerValue' in v) return parseInt(v.integerValue, 10);
        if ('doubleValue' in v) return v.doubleValue;
        if ('timestampValue' in v) return v.timestampValue;
        if ('arrayValue' in v) {
            return (v.arrayValue.values || []).map(decodeValue);
        }
        if ('mapValue' in v) {
            const obj = {};
            for (const [k, val] of Object.entries(v.mapValue.fields || {})) {
                obj[k] = decodeValue(val);
            }
            return obj;
        }
        return null;
    }

    function decodeFields(fields) {
        if (!fields) return {};
        const out = {};
        for (const [k, v] of Object.entries(fields)) {
            out[k] = decodeValue(v);
        }
        return out;
    }

    function decodeDoc(doc) {
        if (!doc?.fields) return null;
        return decodeFields(doc.fields);
    }

    const api = { encodeFields, decodeFields, decodeDoc };

    const root = typeof globalThis !== 'undefined' ? globalThis : self;
    root.AnimeTrackerFirestoreCodec = api;
})();
