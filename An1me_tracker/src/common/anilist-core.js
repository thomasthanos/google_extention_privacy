/**
 * Anime Tracker — AniList shared core
 *
 * GraphQL client + push engine, loaded by both the BG service worker
 * (importScripts) and the popup (<script>). Exposed on globalThis.AniListCore.
 */
(function () {
    'use strict';

    const GQL_ENDPOINT = 'https://graphql.anilist.co';
    const REQUEST_GAP_MS = 1800;                        // pace API calls — AniList rate-limits hard
    const MEDIA_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
    const MEDIA_NOTFOUND_TTL = 7 * 24 * 60 * 60 * 1000;
    const RESOLVER_V = 6;                               // bump to invalidate notFound caches

    const AUTH_KEY = 'anilist_auth';
    const MEDIA_MAP_KEY = 'anilist_media_map';
    const PUSHED_KEY = 'anilist_pushed';
    const SCHEMA_KEY = 'anilist_push_schema';
    const PUSH_SCHEMA = 2;       // bump to force re-push (mutation shape change)

    function sget(keys) {
        return new Promise((res) => {
            try { chrome.storage.local.get(keys, (r) => res(chrome.runtime.lastError ? {} : (r || {}))); }
            catch { res({}); }
        });
    }
    function sset(obj) {
        return new Promise((res) => {
            try { chrome.storage.local.set(obj, () => { void chrome.runtime.lastError; res(); }); }
            catch { res(); }
        });
    }
    function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

    function slugify(title) {
        return String(title || '').toLowerCase().trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    let _lastReqAt = 0;
    async function paced() {
        const wait = REQUEST_GAP_MS - (Date.now() - _lastReqAt);
        if (wait > 0) await sleep(wait);
        _lastReqAt = Date.now();
    }

    async function gql(query, variables, token) {
        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;

        for (let attempt = 0; attempt < 2; attempt++) {
            await paced();
            let res;
            try {
                // 20 s timeout — without it, a hung fetch would freeze the whole sync.
                const controller = new AbortController();
                const tid = setTimeout(() => controller.abort(), 20000);
                try {
                    res = await fetch(GQL_ENDPOINT, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ query, variables: variables || {} }),
                        signal: controller.signal
                    });
                } finally {
                    clearTimeout(tid);
                }
            } catch (e) {
                if (e && e.name === 'AbortError') throw new Error('network: timeout');
                throw new Error(`network: ${e?.message || e}`);
            }

            if (res.status === 429) {
                const ra = parseInt(res.headers.get('Retry-After') || '', 10);
                const waitMs = (Number.isFinite(ra) && ra > 0 ? ra : 60) * 1000;
                if (attempt === 0) { await sleep(Math.min(waitMs, 65000)); continue; }
                throw new Error('rate_limited');
            }

            const json = await res.json().catch(() => null);
            if (json && Array.isArray(json.errors) && json.errors.length) {
                throw new Error(json.errors[0]?.message || 'graphql_error');
            }
            if (!res.ok || !json) throw new Error(`http_${res.status}`);
            return json.data;
        }
        throw new Error('rate_limited');
    }

    function localProgress(entry) {
        const eps = Array.isArray(entry?.episodes) ? entry.episodes : [];
        let max = 0;
        for (const ep of eps) {
            const n = Number(ep && ep.number) || 0;
            if (n > max) max = n;
        }
        return max;
    }

    function pushStatus(entry, progress) {
        if (entry.listState === 'completed' || entry.completedAt) return 'COMPLETED';
        if (entry.listState === 'dropped' || entry.droppedAt) return 'DROPPED';
        if (entry.listState === 'on_hold' || entry.onHoldAt) return 'PAUSED';
        const total = Number(entry.totalEpisodes) || 0;
        if (total > 0 && progress >= total) return 'COMPLETED';
        return 'CURRENT';
    }

    function isoToFuzzyDate(iso) {
        if (!iso) return null;
        const d = new Date(iso);
        if (!Number.isFinite(d.getTime())) return null;
        return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
    }

    // Imported episodes (durationSource 'anilist') carry import time, not real
    // watch time — exclude them so we don't clobber AniList's existing dates.
    function watchDates(entry, status) {
        const eps = Array.isArray(entry && entry.episodes) ? entry.episodes : [];
        let minIso = null, maxIso = null, minTs = Infinity, maxTs = -Infinity;
        for (const ep of eps) {
            if (!ep || ep.durationSource === 'anilist') continue;
            const ts = ep.watchedAt ? new Date(ep.watchedAt).getTime() : NaN;
            if (!Number.isFinite(ts)) continue;
            if (ts < minTs) { minTs = ts; minIso = ep.watchedAt; }
            if (ts > maxTs) { maxTs = ts; maxIso = ep.watchedAt; }
        }
        const hasRealEpisode = eps.some(ep => ep && ep.durationSource !== 'anilist');
        const completedIso = status === 'COMPLETED'
            ? (maxIso || (hasRealEpisode && entry && entry.completedAt) || null)
            : null;
        return {
            startedAt: isoToFuzzyDate(minIso),
            completedAt: isoToFuzzyDate(completedIso)
        };
    }

    // Strip trailing " Movie"/"Film" if "Movie"/"Film" already appears earlier.
    function _cleanTitleForSearch(title) {
        let t = String(title || '').trim();
        const m = t.match(/^(.+?)[\s:]+(?:movie|film)\s*$/i);
        if (m && /\b(?:movie|film)\b/i.test(m[1])) t = m[1].trim();
        return t || String(title || '').trim();
    }

    function _stripMovieNumber(title) {
        return String(title || '')
            .replace(/\b(?:movie|film)\s+0?\d{1,2}\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // AniList's tokenizer is strict — special chars and lone tokens like "S1"
    // cause 0-result searches even when the entry exists. Sanitize aggressively.
    function _sanitizeQuery(title) {
        let t = String(title || '');
        t = t.replace(/[\/:\-–—‐'’"".,!?(){}[\]]+/g, ' ');
        t = t.replace(/\b[Ss]\d+\b/g, ' ');
        t = t.replace(/\bSeason\s+\d+\b/gi, ' ');
        t = t.replace(/\bPrologue\b/gi, ' ');
        t = t.replace(/\b(?:movie|film)\s+0?\d{1,2}\b/gi, ' ');
        return t.replace(/\s+/g, ' ').trim();
    }

    // Roman numerals (i/ii/iii) and Japanese suffixes (hen/go) are KEPT
    // — they disambiguate sequels (Heaven's Feel I/II/III, Russia-go).
    const STOP_WORDS = new Set([
        'no', 'ni', 'de', 'wa', 'ga', 'to', 'mo', 'na', 'da', 'ka', 'e', 'wo',
        'sa', 'n', 'ya', 'yo',
        'san', 'kun', 'chan', 'sama', 'sensei', 'senpai',
        'the', 'of', 'in', 'on', 'at', 'and', 'a', 'an', 'is', 'was', 'were',
        'be', 'to', 'for', 'with', 'from', 'by',
        'movie', 'film', 'season', 'prologue', 'epilogue', 'special',
        'episode', 'ova', 'ona'
    ]);

    // Head + tail keyword extraction: keep franchise prefix AND distinguishing
    // suffix. "Fate Stay Night Movie Heavens Feel II Lost Butterfly" with n=4
    // → "Fate Stay Lost Butterfly".
    function _distinctiveKeywords(title, n) {
        const words = _sanitizeQuery(title)
            .split(/\s+/)
            .filter(w => w.length >= 2 && !STOP_WORDS.has(w.toLowerCase()));
        if (words.length <= n) return words.join(' ');
        if (n >= 4) {
            const headSize = Math.max(2, n - 2);
            const head = words.slice(0, headSize);
            const tail = words.slice(-Math.min(2, n - headSize));
            const merged = [];
            const seen = new Set();
            for (const w of [...head, ...tail]) {
                const lo = w.toLowerCase();
                if (seen.has(lo)) continue;
                seen.add(lo);
                merged.push(w);
            }
            return merged.join(' ');
        }
        return words.slice(0, n).join(' ');
    }

    function _formatFromSlug(slug) {
        const s = String(slug || '').toLowerCase();
        if (/(?:^|-)(?:movie|film)(?:-|$)/.test(s)) return 'MOVIE';
        if (/(?:^|-)ova(?:-|$)/.test(s)) return 'OVA';
        if (/(?:^|-)ona(?:-|$)/.test(s)) return 'ONA';
        if (/(?:^|-)special(?:s)?(?:-|$)/.test(s)) return 'SPECIAL';
        return null;
    }

    async function resolveMedia(slug, title, hints = null) {
        const store = await sget([MEDIA_MAP_KEY]);
        const map = store[MEDIA_MAP_KEY] || {};
        const now = Date.now();
        const cached = map[slug];

        if (cached) {
            if (cached.notFound) {
                const sameVersion = (cached.resolverV || 0) >= RESOLVER_V;
                if (sameVersion && (now - (cached.cachedAt || 0)) < MEDIA_NOTFOUND_TTL) return null;
            } else if (cached.mediaId && (now - (cached.cachedAt || 0)) < MEDIA_CACHE_TTL) {
                return cached;
            }
        }

        // MAL id from aniskip's bundle is the strongest signal — 1:1 lookup,
        // no fuzzy guessing.
        let malIdHint = hints?.malId;
        if (!malIdHint) {
            try {
                const malStore = await sget(['malIdForSlugBundle']);
                const entry = malStore?.malIdForSlugBundle?.[slug];
                if (entry && Number.isFinite(Number(entry.malId)) && Number(entry.malId) > 0) {
                    malIdHint = Number(entry.malId);
                }
            } catch { /* best-effort */ }
        }

        const formatHint = _formatFromSlug(slug);
        const cleanedTitle = _cleanTitleForSearch(title);
        const enrichedHints = { ...(hints || {}), formatHint };

        let result = null;
        try {
            // Path 1: MAL ID — authoritative, no scoring.
            if (Number.isFinite(malIdHint) && malIdHint > 0) {
                try {
                    const data = await gql(
                        'query($id:Int){Media(idMal:$id,type:ANIME){id episodes}}',
                        { id: Math.floor(malIdHint) }, null
                    );
                    const m = data && data.Media;
                    if (m && m.id) {
                        result = { mediaId: m.id, episodes: m.episodes || null, cachedAt: now, resolverV: RESOLVER_V, source: 'idMal' };
                    }
                } catch (e) {
                    const msg = String(e?.message || '');
                    // Network/rate errors must bubble — don't poison cache as notFound.
                    if (!/not found/i.test(msg) && msg !== 'http_404') throw e;
                }
            }

            // Path 2: Title search, max 3 query variants to limit rate-limit risk.
            if (!result) {
                const seen = new Set();
                const queries = [];
                const addQuery = (q) => {
                    const t = (q || '').trim();
                    if (!t || t.length < 2) return;
                    const lo = t.toLowerCase();
                    if (seen.has(lo)) return;
                    seen.add(lo);
                    queries.push(t);
                };
                addQuery(title);
                addQuery(_distinctiveKeywords(cleanedTitle || title, 4));
                addQuery(_distinctiveKeywords(cleanedTitle || title, 2));

                let bestPick = null;
                for (const q of queries) {
                    let data;
                    try {
                        if (formatHint) {
                            data = await gql(
                                'query($s:String,$f:[MediaFormat]){Page(perPage:10){media(search:$s,type:ANIME,format_in:$f){id episodes format title{romaji english native} startDate{year}}}}',
                                { s: q, f: [formatHint] }, null
                            );
                        } else {
                            data = await gql(
                                'query($s:String){Page(perPage:10){media(search:$s,type:ANIME){id episodes format title{romaji english native} startDate{year}}}}',
                                { s: q }, null
                            );
                        }
                    } catch (e) {
                        const msg = String(e?.message || '');
                        if (/not found/i.test(msg) || msg === 'http_404') continue;
                        throw e;
                    }
                    const list = (data && data.Page && Array.isArray(data.Page.media)) ? data.Page.media : [];
                    if (list.length === 0) continue;
                    const picked = _pickBestCandidate(list, q, enrichedHints);
                    if (picked) { bestPick = picked; break; }
                }

                // Fallback: drop format filter — AniList may store the entry as
                // a different format (TV_SHORT/SPECIAL) than the slug suggests.
                if (!bestPick && formatHint) {
                    const q = _distinctiveKeywords(cleanedTitle || title, 3);
                    if (q && !seen.has(q.toLowerCase())) {
                        try {
                            const data = await gql(
                                'query($s:String){Page(perPage:10){media(search:$s,type:ANIME){id episodes format title{romaji english native} startDate{year}}}}',
                                { s: q }, null
                            );
                            const list = (data && data.Page && Array.isArray(data.Page.media)) ? data.Page.media : [];
                            if (list.length > 0) {
                                const picked = _pickBestCandidate(list, q, { ...enrichedHints, formatHint: null });
                                if (picked) bestPick = picked;
                            }
                        } catch (e) {
                            const msg = String(e?.message || '');
                            if (!/not found/i.test(msg) && msg !== 'http_404') throw e;
                        }
                    }
                }

                if (bestPick) {
                    result = {
                        mediaId: bestPick.id, episodes: bestPick.episodes || null,
                        cachedAt: now, resolverV: RESOLVER_V, source: 'titleScore'
                    };
                }
            }
        } catch (e) {
            const msg = String(e?.message || '');
            // Real "no match" → cache as notFound. Network/rate errors must NOT
            // be cached so a transient failure doesn't stick for 7 days.
            if (/not found/i.test(msg) || msg === 'http_404') result = null;
            else throw e;
        }

        map[slug] = result || { notFound: true, cachedAt: now, resolverV: RESOLVER_V };
        await sset({ [MEDIA_MAP_KEY]: map });
        return result;
    }

    function _normalizeTitle(s) {
        return String(s || '').toLowerCase().trim()
            .replace(/[^a-z0-9]+/gi, ' ')
            .replace(/\s+/g, ' ');
    }

    // Score AniList candidates and return the best — only if score clears the
    // confidence threshold AND beats the runner-up by a clear margin.
    // Returning null caches as notFound, preventing wrong AniList writes.
    function _pickBestCandidate(list, queryTitle, hints) {
        const queryNorm = _normalizeTitle(queryTitle);
        const queryWords = new Set(queryNorm.split(' ').filter(w => w.length > 1));
        let best = null;
        let bestScore = -Infinity;
        let secondScore = -Infinity;

        const overlapRatio = (m) => {
            const titles = [m.title?.romaji, m.title?.english, m.title?.native].filter(Boolean);
            let bestOverlap = 0;
            for (const t of titles) {
                const tWords = new Set(_normalizeTitle(t).split(' ').filter(w => w.length > 1));
                let shared = 0;
                for (const w of queryWords) if (tWords.has(w)) shared++;
                const ratio = queryWords.size > 0 ? shared / queryWords.size : 0;
                if (ratio > bestOverlap) bestOverlap = ratio;
            }
            return bestOverlap;
        };

        // Trust AniList's own ranking when format matches and overlap is decent.
        // Score-and-margin gate is too strict for franchise movies where
        // multiple candidates share most words.
        if (hints?.formatHint && list.length > 0) {
            const top = list[0];
            if (top.format === hints.formatHint && overlapRatio(top) >= 0.6) return top;
        }

        for (const m of list) {
            if (!m || !m.id) continue;
            let score = 0;

            const titles = [m.title?.romaji, m.title?.english, m.title?.native].filter(Boolean);
            const exact = titles.some(t => _normalizeTitle(t) === queryNorm);
            if (exact) {
                score += 10;
            } else {
                const partial = titles.some(t => {
                    const tNorm = _normalizeTitle(t);
                    return tNorm.length > 2 && (tNorm.includes(queryNorm) || queryNorm.includes(tNorm));
                });
                if (partial) score += 4;

                const bestOverlap = overlapRatio(m);
                if (bestOverlap >= 0.8) score += 5;
                else if (bestOverlap >= 0.6) score += 3;
                else if (bestOverlap >= 0.4) score += 1;
            }

            const expected = Number(hints?.totalEpisodes);
            if (Number.isFinite(expected) && expected > 0 && Number.isFinite(m.episodes) && m.episodes > 0) {
                const diff = Math.abs(m.episodes - expected);
                if (diff === 0) score += 6;
                else if (diff <= 2) score += 2;
                else if ((expected / m.episodes) < 0.5 || (m.episodes / expected) < 0.5) score -= 3;
            }

            const formatHint = hints?.formatHint;
            if (formatHint && m.format) {
                if (m.format === formatHint) score += 5;
                else if (formatHint === 'MOVIE' && m.format !== 'MOVIE') score -= 3;
            }

            if (score > bestScore) {
                secondScore = bestScore;
                bestScore = score;
                best = m;
            } else if (score > secondScore) {
                secondScore = score;
            }
        }

        return (best && bestScore >= 5 && (bestScore - secondScore) >= 3) ? best : null;
    }

    // Push local library progress to AniList. Batched + resumable: stops after
    // `maxWork` real network pushes and reports `truncated` so the SW can
    // re-schedule. Dedup via `anilist_pushed` makes everything after the first
    // sync cheap.
    async function runPush({ token, maxWork = 1e9, onProgress } = {}) {
        if (!token) throw new Error('not_connected');

        const store = await sget(['animeData', PUSHED_KEY, SCHEMA_KEY, MEDIA_MAP_KEY]);
        const animeData = store.animeData || {};
        let pushed = store[PUSHED_KEY] || {};
        const mediaMap = store[MEDIA_MAP_KEY] || {};
        if (Number(store[SCHEMA_KEY]) !== PUSH_SCHEMA) {
            pushed = {};
            await sset({ [SCHEMA_KEY]: PUSH_SCHEMA });
        }
        const slugs = Object.keys(animeData);
        const total = slugs.length;
        const now = Date.now();

        // Pre-filter: slugs already cached as notFound (current resolverV, in
        // TTL) cost zero API calls but used to burn the work budget — fast-fail
        // them so a run with only these doesn't truncate-loop forever.
        const isFreshNotFound = (slug) => {
            const c = mediaMap[slug];
            if (!c || !c.notFound) return false;
            if ((c.resolverV || 0) < RESOLVER_V) return false;
            if ((now - (c.cachedAt || 0)) >= MEDIA_NOTFOUND_TTL) return false;
            return true;
        };

        let done = 0, ok = 0, skipped = 0, failed = 0, retryableFailed = 0, work = 0, truncated = false;

        // One-shot migration: backfill datesLocked for legacy pure-AniList
        // imports. Coalesced to a single storage write.
        let migrationDirty = false;
        for (const slug of slugs) {
            const entry = animeData[slug];
            const prev = pushed[slug];
            if (!prev || prev.datesLocked != null) continue;
            const eps = Array.isArray(entry?.episodes) ? entry.episodes : [];
            if (eps.length > 0 && eps.every(ep => ep && ep.durationSource === 'anilist')) {
                prev.datesLocked = true;
                pushed[slug] = prev;
                migrationDirty = true;
            }
        }
        if (migrationDirty) await sset({ [PUSHED_KEY]: pushed });

        for (const slug of slugs) {
            const entry = animeData[slug];
            const progress = localProgress(entry);

            if (progress <= 0) {
                done++; skipped++;
                if (onProgress) onProgress({ done, total, ok, skipped, failed });
                continue;
            }

            const status = pushStatus(entry, progress);
            const prev = pushed[slug];

            // datesLocked: set on import preseed so we don't overwrite AniList's
            // existing dates with a "today" date from a newly-promoted episode.
            // Cleared once the user watches beyond the imported count.
            const datesLocked = !!(prev && prev.datesLocked && progress <= (prev.progress || 0));
            const { startedAt, completedAt } = datesLocked ? { startedAt: null, completedAt: null } : watchDates(entry, status);
            const startedAtKey = startedAt ? `${startedAt.year}-${startedAt.month}-${startedAt.day}` : '';
            const completedAtKey = completedAt ? `${completedAt.year}-${completedAt.month}-${completedAt.day}` : '';

            if (prev &&
                prev.progress === progress &&
                prev.status === status &&
                (prev.startedAtKey || '') === startedAtKey &&
                (prev.completedAtKey || '') === completedAtKey) {
                done++; skipped++;
                if (onProgress) onProgress({ done, total, ok, skipped, failed });
                continue;
            }

            if (isFreshNotFound(slug)) {
                done++; failed++;
                if (onProgress) onProgress({ done, total, ok, skipped, failed });
                continue;
            }

            if (work >= maxWork) { truncated = true; break; }
            work++;

            if (onProgress) onProgress({ done, total, ok, skipped, failed, currentSlug: slug, currentTitle: entry?.title || slug, phase: 'resolving' });

            try {
                // No `year` hint: only signal we have is `watchedAt` (when the
                // user watched), which is NOT the anime's release year. Passing
                // it would push the matcher toward newer entries.
                const totalEpHint = Number(entry?.totalEpisodes);
                const hints = {
                    totalEpisodes: Number.isFinite(totalEpHint) && totalEpHint > 0 ? totalEpHint : null
                };
                const media = await resolveMedia(slug, entry.title || slug, hints);
                if (!media || !media.mediaId) {
                    failed++;
                } else {
                    const varDefs = ['$m:Int', '$p:Int', '$s:MediaListStatus'];
                    const args = ['mediaId:$m', 'progress:$p', 'status:$s'];
                    const vars = { m: media.mediaId, p: progress, s: status };
                    if (startedAt) {
                        varDefs.push('$sa:FuzzyDateInput'); args.push('startedAt:$sa'); vars.sa = startedAt;
                    }
                    if (completedAt) {
                        varDefs.push('$ca:FuzzyDateInput'); args.push('completedAt:$ca'); vars.ca = completedAt;
                    }
                    await gql(
                        `mutation(${varDefs.join(',')}){SaveMediaListEntry(${args.join(',')}){id}}`,
                        vars,
                        token
                    );
                    pushed[slug] = { progress, status, startedAtKey, completedAtKey };
                    if (prev && prev.datesLocked && progress > (prev.progress || 0)) {
                        pushed[slug].datesLocked = false;
                    }
                    await sset({ [PUSHED_KEY]: pushed });
                    ok++;
                }
            } catch (e) {
                const msg = String(e?.message || '');
                if (/invalid token|unauthor/i.test(msg)) throw new Error('reconnect');
                const isRetryable = msg === 'rate_limited' || msg.startsWith('network:') || msg.startsWith('http_5');
                if (isRetryable) retryableFailed++; else failed++;
            }

            done++;
            if (onProgress) onProgress({ done, total, ok, skipped, failed });
        }

        return { total, done, ok, skipped, failed, retryableFailed, work, truncated };
    }

    const root = typeof globalThis !== 'undefined' ? globalThis : self;
    root.AniListCore = {
        gql, slugify, localProgress, pushStatus, resolveMedia, runPush,
        AUTH_KEY, MEDIA_MAP_KEY, PUSHED_KEY, SCHEMA_KEY, PUSH_SCHEMA
    };
})();
