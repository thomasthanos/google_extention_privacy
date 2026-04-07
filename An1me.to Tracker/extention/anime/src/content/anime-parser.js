/**
 * Anime Tracker - Anime Parser
 * Extracts anime information from URL and DOM
 */

const AnimeParser = {
    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(str) {
        if (typeof str !== 'string') {
            if (str === null || str === undefined) return '';
            str = String(str);
        }

        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/`/g, '&#x60;')
            .replace(/\//g, '&#x2F;');
    },

    /**
     * Extract anime information from the main page URL and DOM.
     * Wrapped in try/catch so a DOM or parsing error never crashes the content script.
     *
     * Processing order (3.1):
     *   1. Parse URL → raw animeSlug + episodeNumber
     *   2. Apply EPISODE_OFFSET_MAPPING using the RAW (pre-normalisation) slug
     *      so the offset lookup key always matches what the site puts in the URL.
     *   3. Apply SLUG_NORMALIZATION to merge multi-part slugs into one storage key.
     *   4. Apply title-based canonical slug normalisation (e.g. Jujutsu Kaisen).
     * Never swap steps 2 and 3 — the offset table is keyed on the original slug.
     */
    extractAnimeInfo() {
        const { Logger } = window.AnimeTrackerContent;

        try {
            const pathname = window.location.pathname;

            const pathMatch = pathname.match(/\/watch\/([^/]+)(?:\/([^/]+))?/);

            if (!pathMatch) {
                return null;
            }

            let animeSlug = pathMatch[1];
            // Strip trailing "-episode" / "-ep" tokens that occasionally appear
            // in the slug segment of some an1me.to URLs.
            animeSlug = animeSlug
                .replace(/[-_](?:episodes?|ep)$/i, '')
                .replace(/[-_]+$/g, '');
            let episodeSlug = pathMatch[2] || null;
            let episodeNumber = 1;

            let episodeFound = false;
            let isDoubleEpisode = false;
            let secondEpisodeNumber = null;

            // ── Double-episode detection (3.2) ──────────────────────────────────
            // Must run BEFORE the single-episode patterns so the combined
            // "119-120" suffix is matched as a unit and not split by Pattern 4.
            // We also validate that the second number is strictly greater than
            // the first to reject false positives like "sword-art-online-2".
            const doubleEpMatch = animeSlug.match(/^(.+?)[-_]ep(?:isode)?[-_]?(\d+)[-_](\d+)$/i);
            if (doubleEpMatch) {
                const ep1 = parseInt(doubleEpMatch[2], 10);
                const ep2 = parseInt(doubleEpMatch[3], 10);
                // Only treat as a double episode when ep2 is the immediate successor
                // or at most a few episodes ahead. A large gap (e.g. "sword-art-online-2")
                // is almost certainly a season number, not a double episode.
                const looksLikeDoubleEp = ep2 > ep1 && ep2 - ep1 <= 4;
                if (looksLikeDoubleEp) {
                    animeSlug = doubleEpMatch[1];
                    episodeNumber = ep1;
                    secondEpisodeNumber = ep2;
                    episodeSlug = `episode-${episodeNumber}`;
                    isDoubleEpisode = true;
                    episodeFound = true;
                    Logger.debug(`Double episode: ${animeSlug} Ep${episodeNumber}-${secondEpisodeNumber}`);
                }
                // If it doesn't look like a double episode, fall through to normal patterns.
            }

            // ── Single-episode patterns ──────────────────────────────────────────
            const episodePatterns = [
                /^(.+?)[-_]ep(?:isode)?[-_]?(\d+)$/i,
                /^(.+?)[-_]ch(?:apter)?[-_]?(\d+)$/i,
                /^(.+?)[-_]part[-_]?(\d+)$/i,
                /^(.+?)[-_](\d+)$/
            ];

            for (const pattern of episodePatterns) {
                if (episodeFound) break;
                const match = animeSlug.match(pattern);
                if (match) {
                    animeSlug = match[1];
                    episodeNumber = parseInt(match[2], 10);
                    episodeSlug = `episode-${episodeNumber}`;
                    episodeFound = true;
                    break;
                }
            }

            if (!episodeFound && episodeSlug) {
                const epMatch = episodeSlug.match(/ep(?:isode)?[-_]?(\d+)/i) ||
                               episodeSlug.match(/(\d+)/);
                if (epMatch) {
                    episodeNumber = parseInt(epMatch[1], 10);
                }
            }

            if (!episodeFound && !episodeSlug) {
                episodeNumber = this.findEpisodeFromDOM() || 1;
                if (episodeNumber > 1) {
                    episodeSlug = `episode-${episodeNumber}`;
                    episodeFound = true;
                }
            }

            if (!episodeSlug) {
                episodeSlug = 'episode-1';
                episodeNumber = 1;
            }

            if (episodeNumber < 1) {
                Logger.warn(`Invalid ep ${episodeNumber}, clamping to 1`);
                episodeNumber = 1;
            } else if (episodeNumber > 9999) {
                Logger.warn(`Invalid ep ${episodeNumber}, clamping to 9999`);
                episodeNumber = 9999;
            }

            // ── Step 2: apply episode offset (3.1) ──────────────────────────────
            // The offset table is keyed on the ORIGINAL (pre-normalisation) slug so
            // the lookup always matches the URL slug the site serves. We capture it
            // BEFORE any normalisation below. Do NOT move steps 3/4 above this.
            const originalSlug = animeSlug;
            let totalEpisodes = this.detectTotalEpisodes(originalSlug);

            const offsetMapping = window.AnimeTrackerContent?.EPISODE_OFFSET_MAPPING || {};
            const offset = offsetMapping[originalSlug] || 0;
            if (offset > 0) {
                episodeNumber += offset;
                // Offset the second episode too so double-episode saves remain consistent.
                // e.g. bleach-TYBW-part-2 episode 1-2 → stored as episodes 14 and 15.
                if (secondEpisodeNumber !== null) {
                    secondEpisodeNumber += offset;
                }
                if (Number.isFinite(totalEpisodes) && totalEpisodes > 0) {
                    totalEpisodes += offset;
                }
            }

            // ── Step 3: slug normalisation (3.1) ────────────────────────────────
            // Merge multi-part slugs into a single storage key AFTER the offset
            // has been applied. Swapping this with step 2 would break the offset
            // lookup because the normalised slug is not in EPISODE_OFFSET_MAPPING.
            const slugNormalization = window.AnimeTrackerContent?.SLUG_NORMALIZATION || {};
            if (slugNormalization[originalSlug]) {
                animeSlug = slugNormalization[originalSlug];
            }

            // ── Step 4: title-based canonical slug ──────────────────────────────
            let animeTitle = this.extractTitle(animeSlug);

            const canonicalSlug = this.normalizeSlugByTitle(animeSlug, animeTitle);
            if (canonicalSlug !== animeSlug) {
                animeSlug = canonicalSlug;
            }

            const uniqueId = `${animeSlug}__episode-${episodeNumber}`;

            Logger.info(`${animeTitle} Ep${episodeNumber}`, { id: uniqueId });

            const coverImageElement = document.querySelector('.anime-featured img');
            const coverImage = coverImageElement ? coverImageElement.src || null : null;

            return {
                animeSlug,
                animeTitle,
                episodeSlug: `episode-${episodeNumber}`,
                episodeNumber,
                uniqueId,
                url: window.location.href,
                isDoubleEpisode,
                secondEpisodeNumber,
                coverImage,
                totalEpisodes
            };
        } catch (e) {
            Logger.error('extractAnimeInfo failed:', e);
            return null;
        }
    },

    /**
     * Find episode number from DOM elements
     */
    findEpisodeFromDOM() {
        const { Logger } = window.AnimeTrackerContent;

        const activeEpisodeSelectors = [
            '.episode-list .active',
            '.episodes .current',
            '[class*="episode"].active',
            '[class*="episode"].selected',
            '.ep-item.active',
            '.episode.active',
            '.episode.current',
            'li.active a[href*="episode"]',
            'a.active[href*="episode"]'
        ];

        for (const selector of activeEpisodeSelectors) {
            try {
                const activeEpisode = document.querySelector(selector);
                if (activeEpisode) {
                    const epText = activeEpisode.textContent || activeEpisode.getAttribute('title') || '';
                    const epNumMatch = epText.match(/Episode\s*(\d+)/i) ||
                                      epText.match(/Ep\s*(\d+)/i) ||
                                      epText.match(/^\s*(\d+)\s*$/);
                    if (epNumMatch) {
                        const episodeNumber = parseInt(epNumMatch[1], 10);
                        return episodeNumber;
                    }
                }
            } catch {
                // Ignore selector errors and try the next one
            }
        }

        return null;
    },

    /**
     * Detect total episode count from page links/data attributes.
     * Returns highest episode number found, or null.
     */
    detectTotalEpisodes(animeSlug) {
        try {
            const episodeNumbers = new Set();
            const escapedSlug = (animeSlug || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const hasSlug = Boolean(escapedSlug);
            const hrefPattern = hasSlug
                ? new RegExp(`/watch/${escapedSlug}-episode-(\\d+)`, 'i')
                : /\/watch\/[^/]+-episode-(\d+)/i;

            // Single query covers all selectors — avoids redundant DOM traversals
            const combinedSelector = hasSlug
                ? `a[href*="${animeSlug}-episode-"], [data-open-nav-episode]`
                : 'a[href*="-episode-"], [data-open-nav-episode]';

            const parseEpisodeNumber = (value) => {
                if (!value) return null;
                const text = String(value);
                const match = text.match(/(?:episode|ep)\s*[-_#:]?\s*(\d{1,4})/i) || text.match(/\b(\d{1,4})\b/);
                if (!match) return null;
                const num = parseInt(match[1], 10);
                return Number.isFinite(num) && num > 0 ? num : null;
            };

            {
                const nodes = document.querySelectorAll(combinedSelector);
                for (const node of nodes) {
                    const href = node.getAttribute('href') || '';
                    const hrefMatch = href.match(hrefPattern);
                    if (hrefMatch) {
                        const hrefNum = parseInt(hrefMatch[1], 10);
                        if (Number.isFinite(hrefNum) && hrefNum > 0) {
                            episodeNumbers.add(hrefNum);
                        }
                    }

                    // Only read data-open-nav-episode when the href already matches the slug pattern.
                    // Without this guard, unrelated series links on the same page (e.g. Naruto
                    // Shippuden links shown on the Naruto page) would inflate the total and prevent
                    // the anime from ever reaching 100% progress.
                    if (hrefMatch) {
                        const attrNum = parseEpisodeNumber(
                            node.getAttribute('data-open-nav-episode') || node.dataset?.openNavEpisode
                        );
                        if (attrNum) episodeNumbers.add(attrNum);
                    }
                }
            }

            if (episodeNumbers.size === 0) return null;

            const maxEpisode = Math.max(...episodeNumbers);
            if (!Number.isFinite(maxEpisode) || maxEpisode <= 0 || maxEpisode > 9999) return null;
            return maxEpisode;
        } catch {
            return null;
        }
    },

    /**
     * Normalize slugs for known series when site slugs are inconsistent.
     */
    normalizeSlugByTitle(slug, title) {
        const safeSlug = String(slug || '').toLowerCase();
        const safeTitle = String(title || '').toLowerCase();
        const context = `${safeSlug} ${safeTitle}`;

        if (safeSlug.startsWith('jujutsu-kaisen') || safeTitle.includes('jujutsu kaisen')) {
            if (/\b0\b|movie/.test(context)) return 'jujutsu-kaisen-0';
            if (/season\s*3|part\s*3|culling\s*game|dead[-\s]*culling|shimetsu|kaiyuu/.test(context)) {
                return 'jujutsu-kaisen-season-3';
            }
            if (/season\s*2|2nd\s*season|shibuya|kaigyoku|gyokusetsu/.test(context)) {
                return 'jujutsu-kaisen-season-2';
            }
            return 'jujutsu-kaisen';
        }

        return slug;
    },

    /**
     * Extract anime title from slug or DOM (3.3).
     *
     * The cleaning patterns are anchored so they only strip episode/part
     * markers from the END of the title string, preceded by a separator
     * character (–, ~, space, or similar). This prevents false positives
     * like "Sword Art Online: Alicization – War of Underworld" losing
     * "Underworld", or a title that legitimately contains the word "Episode".
     *
     * Removal order matters:
     *   1. "– Episode N …"   (separator + keyword + number + anything after)
     *   2. "– Ep N …"        (abbreviated form)
     *   3. "– Part N …"      (multi-part indicator)
     *   4. "– Chapter N …"   (manga adaptation indicator)
     *   5. Trailing " N"     (bare number at the very end, no separator)
     *   6. Trailing "(YYYY)" (year disambiguation)
     *
     * Rules 1–4 require a separator so "Sword Art Online II" is not truncated
     * at "II", and "Dr. STONE: New World" is not truncated at "World".
     * Rule 5 only fires when the title ends with whitespace + digits, which
     * is almost always an episode suffix injected by the page template.
     */
    extractTitle(animeSlug) {
        let animeTitle = animeSlug
            .replace(/[-_]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\b\w/g, c => c.toUpperCase());

        const titleSelectors = [
            '.episode-head h1',
            'h1.title',
            '.anime-title',
            '.video-title h1',
            'h1[class*="title"]',
            '.player-title',
            'h1',
            '.anime-info h1',
            '.title-container h1'
        ];

        // Separator character class: dash, en-dash, em-dash, tilde, pipe, colon
        // followed by optional spaces. Used to anchor the removal patterns so
        // that only genuine episode/part suffixes are stripped.
        const SEP = /\s*[-–—~|]\s*/;

        for (const selector of titleSelectors) {
            try {
                const titleElement = document.querySelector(selector);
                if (!titleElement) continue;

                let extractedTitle = titleElement.textContent.trim();

                // Strip episode/part markers anchored to the END of the string.
                // Each pattern requires a leading separator (SEP) so mid-title
                // keywords like "Episode of Merry", "Part of Your World", or
                // "Chapter Black" are left intact.
                extractedTitle = extractedTitle
                    // "– Episode 12" / "– Episode 12 (Special)" / "– Episode 12: Sub-title"
                    .replace(new RegExp(`${SEP.source}Episode\\s*\\d+.*$`, 'i'), '')
                    // "– Ep12" / "– Ep 12"
                    .replace(new RegExp(`${SEP.source}Ep\\s*\\d+.*$`, 'i'), '')
                    // "– Part 2"
                    .replace(new RegExp(`${SEP.source}Part\\s*\\d+.*$`, 'i'), '')
                    // "– Chapter 5"
                    .replace(new RegExp(`${SEP.source}Chapter\\s*\\d+.*$`, 'i'), '')
                    // Bare trailing digit sequence injected by page templates
                    // (only when preceded by whitespace to avoid "SAO II" etc.)
                    .replace(/\s+\d+\s*$/, '')
                    // Standalone "Episode" at end with no number (e.g. "Bleach Episode")
                    .replace(/\s+Episode\s*$/i, '')
                    // Year disambiguation "(2024)"
                    .replace(/\s*\(\d{4}\)\s*$/, '')
                    .trim();

                if (extractedTitle && extractedTitle.length > 2 && extractedTitle.length < 150) {
                    animeTitle = extractedTitle;
                    break;
                }
            } catch {
                // Ignore selector errors and try the next one
            }
        }

        return animeTitle;
    }
};

// Export
window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.AnimeParser = AnimeParser;
