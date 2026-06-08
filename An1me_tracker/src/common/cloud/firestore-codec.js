


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
