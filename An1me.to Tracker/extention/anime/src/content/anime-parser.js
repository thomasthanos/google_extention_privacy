const AnimeParser = {
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
    extractAnimeInfo() {
        const { Logger } = window.AnimeTrackerContent;

        try {
            const pathname = window.location.pathname;

            const pathMatch = pathname.match(/\/watch\/([^/]+)(?:\/([^/]+))?/);

            if (!pathMatch) {
                return null;
            }

            let animeSlug = pathMatch[1];            // in the slug segment of some an1me.to URLs.
            animeSlug = animeSlug
                .replace(/[-_](?:episodes?|ep)$/i, '')
                .replace(/[-_]+$/g, '');
            let episodeSlug = pathMatch[2] || null;
            let episodeNumber = 1;

            let episodeFound = false;
            let isDoubleEpisode = false;
            let secondEpisodeNumber = null;            // "119-120" suffix is matched as a unit and not split by Pattern 4.            // the first to reject false positives like "sword-art-online-2".
            const doubleEpMatch = animeSlug.match(/^(.+?)[-_]ep(?:isode)?[-_]?(\d+)[-_](\d+)$/i);
            if (doubleEpMatch) {
                const ep1 = parseInt(doubleEpMatch[2], 10);
                const ep2 = parseInt(doubleEpMatch[3], 10);                const looksLikeDoubleEp = ep2 > ep1 && ep2 - ep1 <= 2;
                if (looksLikeDoubleEp) {
                    animeSlug = doubleEpMatch[1];
                    episodeNumber = ep1;
                    secondEpisodeNumber = ep2;
                    episodeSlug = `episode-${episodeNumber}`;
                    isDoubleEpisode = true;
                    episodeFound = true;
                }            }            const episodePatterns = [
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

            if (episodeNumber < 1 || episodeNumber > 9999) {
                Logger.warn(`Invalid ep ${episodeNumber}, using 1`);
                episodeNumber = 1;
            }            // The offset table is keyed on the ORIGINAL (pre-normalisation) slug so
            // the lookup always matches the URL slug the site serves. We capture it
            // BEFORE any normalisation below. Do NOT move steps 3/4 above this.
            const originalSlug = animeSlug;
            let totalEpisodes = this.detectTotalEpisodes(originalSlug);

            const offsetMapping = window.AnimeTrackerContent?.EPISODE_OFFSET_MAPPING || {};
            const offset = offsetMapping[originalSlug] || 0;
            if (offset > 0) {
                episodeNumber += offset;                if (secondEpisodeNumber !== null) {
                    secondEpisodeNumber += offset;
                }
                if (Number.isFinite(totalEpisodes) && totalEpisodes > 0) {
                    totalEpisodes += offset;
                }
            }            // Merge multi-part slugs into a single storage key AFTER the offset
            // has been applied. Swapping this with step 2 would break the offset
            // lookup because the normalised slug is not in EPISODE_OFFSET_MAPPING.
            const slugNormalization = window.AnimeTrackerContent?.SLUG_NORMALIZATION || {};
            if (slugNormalization[originalSlug]) {
                animeSlug = slugNormalization[originalSlug];
            }            let animeTitle = this.extractTitle(animeSlug);

            const canonicalSlug = this.normalizeSlugByTitle(animeSlug, animeTitle);
            if (canonicalSlug !== animeSlug) {
                animeSlug = canonicalSlug;
            }

            const uniqueId = `${animeSlug}__episode-${episodeNumber}`;

            const coverImageElement = document.querySelector('.anime-featured img');
            const coverImage = coverImageElement ? coverImageElement.src || null : null;

            return {
                animeSlug,
                animeTitle: this.escapeHtml(animeTitle),
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

    findEpisodeFromDOM() {
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
            } catch { // ignore selector errors
            }
        }

        return null;
    },

    detectTotalEpisodes(animeSlug) {
        try {
            const episodeNumbers = new Set();
            const escapedSlug = (animeSlug || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const hasSlug = Boolean(escapedSlug);
            const hrefPattern = hasSlug
                ? new RegExp(`/watch/${escapedSlug}-episode-(\\d+)`, 'i')
                : /\/watch\/[^/]+-episode-(\d+)/i;

            const selectors = [
                `a[href*="/watch/${animeSlug}-episode-"]`,
                `a[href*="${animeSlug}-episode-"]`,
                '.episode-list a[href*="-episode-"]',
                '.episodes a[href*="-episode-"]',
                '[data-open-nav-episode]',
                'a[href*="-episode-"]'
            ];

            const parseEpisodeNumber = (value) => {
                if (!value) return null;
                const text = String(value);
                const match = text.match(/(?:episode|ep)\s*[-_#:]?\s*(\d{1,4})/i) || text.match(/\b(\d{1,4})\b/);
                if (!match) return null;
                const num = parseInt(match[1], 10);
                return Number.isFinite(num) && num > 0 ? num : null;
            };

            for (const selector of selectors) {
                const nodes = document.querySelectorAll(selector);
                for (const node of nodes) {
                    const href = node.getAttribute('href') || '';
                    const hrefMatch = href.match(hrefPattern);
                    if (hrefMatch) {
                        const hrefNum = parseInt(hrefMatch[1], 10);
                        if (Number.isFinite(hrefNum) && hrefNum > 0) {
                            episodeNumbers.add(hrefNum);
                        }
                    }

                    // Only read data-open-nav-episode when href matches slug — otherwise cross-series links inflate the total.
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

        const SEP = /\s*[-–—~|]\s*/;

        for (const selector of titleSelectors) {
            try {
                const titleElement = document.querySelector(selector);
                if (!titleElement) continue;

                let extractedTitle = titleElement.textContent.trim();

                extractedTitle = extractedTitle
                    .replace(new RegExp(`${SEP.source}Episode\\s*\\d+.*$`, 'i'), '')
                    .replace(new RegExp(`${SEP.source}Ep\\s*\\d+.*$`, 'i'), '')
                    .replace(new RegExp(`${SEP.source}Part\\s*\\d+.*$`, 'i'), '')
                    .replace(new RegExp(`${SEP.source}Chapter\\s*\\d+.*$`, 'i'), '')
                    .replace(/\s+\d+\s*$/, '')
                    .replace(/\s+Episode\s*$/i, '')
                    .replace(/\s*\(\d{4}\)\s*$/, '')
                    .trim();

                if (extractedTitle && extractedTitle.length > 2 && extractedTitle.length < 150) {
                    animeTitle = extractedTitle;
                    break;
                }
            } catch { // ignore selector errors
            }
        }

        return animeTitle;
    }
};

window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.AnimeParser = AnimeParser;
