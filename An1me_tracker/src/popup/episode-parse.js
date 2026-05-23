/**
 * Anime Tracker — Episode-range parsing + slug helpers (pure)
 *
 * Powers the "Add Anime" dialog: parses user-typed ranges like
 * `1-12, 14, 18-20` into sorted unique numbers, splits canon from filler
 * episodes using FillerService data, and extracts slugs from various
 * URL shapes the user might paste.
 *
 * Exposes `window.AnimeTracker.EpisodeParse`:
 *   - `parseRanges(input)`
 *   - `buildRangeString(episodeNumbers)`
 *   - `splitCanonAndFillers(slug, episodeNumbers)`
 *   - `extractSlugFromInput(input)`
 *   - `generateTitleFromSlug(slug)`
 *   - `renderEpisodesPreview(input)`  — DOM side-effect (uses #episodesPreview etc.)
 */
(function () {
    'use strict';

    function parseRanges(input) {
        if (!input || !input.trim()) return [];
        const episodeNumbers = new Set();
        const parts = input.split(/[,;]+/).map(p => p.trim()).filter(Boolean);
        for (const part of parts) {
            const rangeMatch = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
            const singleMatch = part.match(/^(\d+)$/);
            if (rangeMatch) {
                const start = parseInt(rangeMatch[1], 10);
                const end = parseInt(rangeMatch[2], 10);
                if (start > 0 && end >= start && (end - start) <= 2000) {
                    for (let i = start; i <= end; i++) episodeNumbers.add(i);
                }
            } else if (singleMatch) {
                const num = parseInt(singleMatch[1], 10);
                if (num > 0) episodeNumbers.add(num);
            }
        }
        return Array.from(episodeNumbers).sort((a, b) => a - b);
    }

    function buildRangeString(episodeNumbers) {
        if (!episodeNumbers || episodeNumbers.length === 0) return '';
        const ranges = [];
        let start = episodeNumbers[0], end = episodeNumbers[0];
        for (let i = 1; i < episodeNumbers.length; i++) {
            if (episodeNumbers[i] === end + 1) {
                end = episodeNumbers[i];
            } else {
                ranges.push(start === end ? `${start}` : `${start}–${end}`);
                start = end = episodeNumbers[i];
            }
        }
        ranges.push(start === end ? `${start}` : `${start}–${end}`);
        return ranges.join(', ');
    }

    function splitCanonAndFillers(slug, episodeNumbers) {
        const FillerService = window.AnimeTracker?.FillerService;
        if (!slug || !FillerService || !FillerService.hasFillerData(slug)) {
            return { canon: episodeNumbers, fillers: [] };
        }
        const canon = [], fillers = [];
        for (const n of episodeNumbers) {
            if (FillerService.isFillerEpisode(slug, n)) fillers.push(n);
            else canon.push(n);
        }
        return { canon, fillers };
    }

    function extractSlugFromInput(input) {
        if (!input) return null;
        input = input.trim();
        const normalizeSlug = (slug) => slug
            .toLowerCase()
            .replace(/-episode-\d+$/i, '')
            .replace(/-(?:episodes?|ep)$/i, '')
            .replace(/-+$/g, '');

        const watchEpisodePattern = /\/watch\/([a-zA-Z0-9-]+)-episode-\d+/i;
        const watchMatch = input.match(watchEpisodePattern);
        if (watchMatch) return normalizeSlug(watchMatch[1]);

        const animePattern = /\/anime\/([a-zA-Z0-9-]+)/i;
        const animeMatch = input.match(animePattern);
        if (animeMatch) return normalizeSlug(animeMatch[1]);

        const watchPattern = /\/watch\/([a-zA-Z0-9-]+)/i;
        const watchOnlyMatch = input.match(watchPattern);
        if (watchOnlyMatch) return normalizeSlug(watchOnlyMatch[1]);

        // Fallback: turn arbitrary text into a slug. Lower-case FIRST so the
        // strip step doesn't gobble uppercase letters — previous behavior
        // turned "Cowboy Bebop" into "owboy-ebop" because `[^a-z0-9-]` is
        // case-sensitive and ran before normalizeSlug's `.toLowerCase()`.
        return normalizeSlug(
            input.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
        );
    }

    function generateTitleFromSlug(slug) {
        return slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }

    /**
     * Live preview for the Add-Anime dialog. Reads the current slug input
     * directly from `#animeSlug` so the function stays decoupled from any
     * popup-local `elements` closure.
     *
     * Drives:
     *   - #episodesPreview (canon vs filler text)
     *   - #episodesCounter (live count + progress bar against known total)
     *   - #includeFillerLabel (visibility based on filler presence)
     *   - .episodes-input.invalid-range (validation border)
     */
    function renderEpisodesPreview(input) {
        const preview = document.getElementById('episodesPreview');
        const fillerLabel = document.getElementById('includeFillerLabel');
        const includeFillerText = document.getElementById('includeFillerText');
        const counter = document.getElementById('episodesCounter');
        const counterText = document.getElementById('episodesCounterText');
        const counterPct = document.getElementById('episodesCounterPercent');
        const counterFill = document.getElementById('episodesCounterFill');
        const epInput = document.getElementById('episodesWatched');

        const hideAll = () => {
            if (fillerLabel) fillerLabel.style.display = 'none';
            if (counter) counter.style.display = 'none';
            if (epInput) epInput.classList.remove('invalid-range');
        };

        if (!input || !input.trim()) {
            hideAll();
            return;
        }

        const allEpisodes = parseRanges(input);
        if (allEpisodes.length === 0) {
            if (fillerLabel) fillerLabel.style.display = 'none';
            if (counter) counter.style.display = 'none';
            if (epInput) epInput.classList.add('invalid-range');
            return;
        }

        const slugInput = document.getElementById('animeSlug');
        const slug = extractSlugFromInput(slugInput ? slugInput.value : '');
        const { canon, fillers } = splitCanonAndFillers(slug, allEpisodes);
        const includeFillers = document.getElementById('includeFillers')?.checked || false;
        const finalCount = (includeFillers || fillers.length === 0) ? allEpisodes.length : canon.length;

        // ── Out-of-range validation ─────────────────────────────────────
        const knownTotal = window.AnimeTracker?.__addDialogState?.knownTotal || null;
        const maxEntered = allEpisodes[allEpisodes.length - 1];
        const outOfRange = !!(knownTotal && maxEntered > knownTotal);
        if (epInput) epInput.classList.toggle('invalid-range', outOfRange);

        // ── Live counter + progress bar ────────────────────────────────
        if (counter && counterText && counterFill) {
            counter.style.display = 'block';
            const ICON = '<svg class="counter-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
            counterText.innerHTML = `${ICON}${finalCount} episode${finalCount !== 1 ? 's' : ''} selected`;
            if (knownTotal) {
                const pct = Math.min(100, Math.round((finalCount / knownTotal) * 100));
                if (counterPct) counterPct.textContent = `${finalCount} / ${knownTotal} · ${pct}%`;
                counterFill.style.width = `${pct}%`;
            } else {
                if (counterPct) counterPct.textContent = '';
                counterFill.style.width = '0%';
            }
        }

        // ── Filler-include checkbox visibility ─────────────────────────
        if (fillerLabel) {
            if (fillers.length > 0) {
                fillerLabel.style.display = 'flex';
                if (includeFillerText) {
                    includeFillerText.textContent = includeFillers
                        ? `Fillers included (${fillers.length} eps: ${buildRangeString(fillers)})`
                        : `Include ${fillers.length} filler episode${fillers.length !== 1 ? 's' : ''} too (${buildRangeString(fillers)})`;
                }
            } else {
                fillerLabel.style.display = 'none';
            }
        }
    }

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.EpisodeParse = {
        parseRanges,
        buildRangeString,
        splitCanonAndFillers,
        extractSlugFromInput,
        generateTitleFromSlug,
        renderEpisodesPreview
    };
})();
