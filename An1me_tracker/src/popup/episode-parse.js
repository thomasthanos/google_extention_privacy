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
     */
    function renderEpisodesPreview(input) {
        const preview = document.getElementById('episodesPreview');
        const fillerLabel = document.getElementById('includeFillerLabel');
        const includeFillerText = document.getElementById('includeFillerText');
        if (!preview) return;

        if (!input || !input.trim()) {
            preview.innerHTML = '';
            preview.className = 'episodes-preview';
            if (fillerLabel) fillerLabel.style.display = 'none';
            return;
        }

        const allEpisodes = parseRanges(input);
        if (allEpisodes.length === 0) {
            preview.innerHTML = '<span class="preview-error">⚠ No valid episodes found</span>';
            preview.className = 'episodes-preview preview-visible preview-error-state';
            if (fillerLabel) fillerLabel.style.display = 'none';
            return;
        }

        const slugInput = document.getElementById('animeSlug');
        const slug = extractSlugFromInput(slugInput ? slugInput.value : '');
        const { canon, fillers } = splitCanonAndFillers(slug, allEpisodes);

        const includeFillers = document.getElementById('includeFillers')?.checked || false;

        let html;
        if (includeFillers || fillers.length === 0) {
            html = `<span class="preview-ok">✓ ${allEpisodes.length} episodes: <strong>${buildRangeString(allEpisodes)}</strong></span>`;
        } else {
            html = `<span class="preview-ok">✓ ${canon.length} canon episodes: <strong>${buildRangeString(canon)}</strong></span>`;
            html += `<br><span class="preview-fillers">⏭ ${fillers.length} fillers will be excluded: ${buildRangeString(fillers)}</span>`;
        }
        preview.innerHTML = html;
        preview.className = 'episodes-preview preview-visible';

        if (fillerLabel) {
            if (fillers.length > 0) {
                fillerLabel.style.display = 'flex';
                if (includeFillerText) {
                    includeFillerText.textContent = includeFillers
                        ? `Fillers included (${fillers.length} eps: ${buildRangeString(fillers)})`
                        : `Include ${fillers.length} filler episodes too (${buildRangeString(fillers)})`;
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
