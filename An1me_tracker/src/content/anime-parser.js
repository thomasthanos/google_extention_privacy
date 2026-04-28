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

    extractAnimeInfo(options = {}) {
        const { Logger } = window.AnimeTrackerContent;

        try {
            const pathname = window.location.pathname;

            const pathMatch = pathname.match(/\/watch\/([^/]+)(?:\/([^/]+))?/);

            if (!pathMatch) {
                return null;
            }

            const rawPathSlug = pathMatch[1];
            let animeSlug = rawPathSlug;
            animeSlug = animeSlug
                .replace(/[-_](?:episodes?|ep)$/i, '')
                .replace(/[-_]+$/g, '');
            let episodeSlug = pathMatch[2] || null;
            let episodeNumber = 1;

            let episodeFound = false;
            let isDoubleEpisode = false;
            let secondEpisodeNumber = null;

            const parseDoubleEpisodeMatch = (value) =>
                value ? value.match(/^(.+?)[-_](?:ep(?:isode)?)[-_]?(\d+)[-_](\d+)$/i) : null;

            const doubleEpMatch = parseDoubleEpisodeMatch(rawPathSlug) || parseDoubleEpisodeMatch(animeSlug);
            if (doubleEpMatch) {
                const ep1 = parseInt(doubleEpMatch[2], 10);
                const ep2 = parseInt(doubleEpMatch[3], 10);
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
            }

            const episodePatterns = [
                /^(.+?)[-_]ep(?:isode)?[-_]?(\d+)$/i,
                /^(.+?)[-_]ch(?:apter)?[-_]?(\d+)$/i,
                /^(.+?)[-_]part[-_]?(\d+)$/i,
                /^(.+?)[-_](\d+)$/
            ];
            const fallbackPattern = episodePatterns[episodePatterns.length - 1];

            for (const pattern of episodePatterns) {
                if (episodeFound) break;
                const match = animeSlug.match(pattern);
                if (match) {
                    const candidate = parseInt(match[2], 10);
                    // The bare `-NN` fallback is greedy: slugs ending in a
                    // 4-digit year (e.g. `some-anime-2024`) would otherwise be
                    // parsed as episode 2024. Reject year-shaped numbers when
                    // the slug carried no explicit ep/ch/part keyword.
                    if (pattern === fallbackPattern && candidate >= 1900 && candidate <= 2099) {
                        continue;
                    }
                    animeSlug = match[1];
                    episodeNumber = candidate;
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

            const originalSlug = animeSlug;
            const releaseStatus = this.detectReleaseStatus();
            let totalEpisodes = this.detectTotalEpisodes(originalSlug, releaseStatus);

            const offsetMapping = window.AnimeTrackerContent?.EPISODE_OFFSET_MAPPING || {};
            const offset = offsetMapping[originalSlug] || 0;
            if (offset > 0) {
                episodeNumber += offset;
                if (secondEpisodeNumber !== null) {
                    secondEpisodeNumber += offset;
                }
                if (Number.isFinite(totalEpisodes) && totalEpisodes > 0) {
                    totalEpisodes += offset;
                }
            }

            const slugNormalization = window.AnimeTrackerContent?.SLUG_NORMALIZATION || {};
            if (slugNormalization[originalSlug]) {
                animeSlug = slugNormalization[originalSlug];
            }

            let animeTitle = this.extractTitle(animeSlug);

            const canonicalSlug = this.normalizeSlugByTitle(animeSlug, animeTitle);
            if (canonicalSlug !== animeSlug) {
                animeSlug = canonicalSlug;
            }
            animeTitle = this.normalizeTitleBySlug(animeSlug, animeTitle);

            const uniqueId = `${animeSlug}__episode-${episodeNumber}`;

            if (options.silent !== true) {
                Logger.info(`${animeTitle} Ep${episodeNumber}`, { id: uniqueId });
            }

            const coverImageElement = document.querySelector('.anime-featured img')
                || document.querySelector('.anime-main-image');
            const rawCoverSrc = coverImageElement?.src || '';
            const coverImage = /^https:\/\//i.test(rawCoverSrc) ? rawCoverSrc : null;

            const siteAnimeId = this.extractSiteAnimeId();

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
                totalEpisodes,
                siteAnimeId
            };
        } catch (e) {
            Logger.error('extractAnimeInfo failed:', e);
            return null;
        }
    },

    extractSiteAnimeId() {
        try {
            const scripts = document.querySelectorAll('script:not([src])');
            for (const script of scripts) {
                const text = script.textContent;
                const match = text.match(/\bcurrent_post_data_id\s*=\s*(\d+)/)
                    || text.match(/\bcurrent_anime_id\s*=\s*(\d+)/);
                if (match) return parseInt(match[1], 10);
            }
        } catch { }
        return null;
    },

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
            }
        }

        return null;
    },

    detectReleaseStatus() {
        try {
            const text = document.body?.textContent?.replace(/\s+/g, ' ').trim() || '';
            if (!text) return null;
            if (/Currently\s+Airing|Προβάλλεται\s+τώρα/i.test(text)) return 'RELEASING';
            if (/Finished\s+Airing|Ολοκληρώθηκε/i.test(text)) return 'FINISHED';
        } catch {
        }
        return null;
    },

    detectExplicitTotalEpisodes() {
        try {
            const labelRegex = /^(episodes?|επεισόδια)\b/i;
            const labelNodes = document.querySelectorAll('dt, th');

            for (const labelNode of labelNodes) {
                const labelText = (labelNode.textContent || '').replace(/\s+/g, ' ').trim();
                if (!labelRegex.test(labelText)) continue;

                const valueNode = labelNode.nextElementSibling;
                const valueText = (valueNode?.textContent || '').replace(/\s+/g, ' ').trim();
                const match = valueText.match(/\b(\d{1,4})\b/);
                if (!match) continue;

                const total = parseInt(match[1], 10);
                if (Number.isFinite(total) && total > 0 && total <= 9999) {
                    return total;
                }
            }
        } catch {
        }

        return null;
    },

    detectTotalEpisodes(animeSlug, releaseStatus = null) {
        try {
            const explicitTotal = this.detectExplicitTotalEpisodes();
            if (Number.isFinite(explicitTotal) && explicitTotal > 0) {
                return explicitTotal;
            }

            const episodeNumbers = new Set();
            const navEpisodeNumbers = new Set();
            const escapedSlug = (animeSlug || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const hasSlug = Boolean(escapedSlug);
            const hrefPattern = hasSlug
                ? new RegExp(`/watch/${escapedSlug}-episode-(\\d+)(?:$|[/?#])`, 'i')
                : /\/watch\/[^/]+-episode-(\d+)(?:$|[/?#])/i;

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

            const isLikelyNavigationControl = (node) => {
                const collect = (el) => {
                    if (!el) return '';
                    return [
                        el.getAttribute?.('rel') || '',
                        el.getAttribute?.('class') || '',
                        el.getAttribute?.('id') || '',
                        el.getAttribute?.('aria-label') || '',
                        el.getAttribute?.('title') || '',
                        el.getAttribute?.('data-action') || '',
                        el.textContent || ''
                    ].join(' ').toLowerCase();
                };

                const context = [
                    collect(node),
                    collect(node?.parentElement),
                    collect(node?.closest?.('a,button,[role="button"],[class],[id]'))
                ].join(' ');

                return /\b(next|prev|previous|forward|back)\b/.test(context);
            };

            {
                const nodes = document.querySelectorAll(combinedSelector);
                for (const node of nodes) {
                    if (isLikelyNavigationControl(node)) continue;

                    const href = node.getAttribute('href') || '';
                    const hrefMatch = href.match(hrefPattern);
                    if (hrefMatch) {
                        const hrefNum = parseInt(hrefMatch[1], 10);
                        if (Number.isFinite(hrefNum) && hrefNum > 0) {
                            episodeNumbers.add(hrefNum);
                        }
                    }

                    if (hrefMatch) {
                        const attrNum = parseEpisodeNumber(
                            node.getAttribute('data-open-nav-episode') || node.dataset?.openNavEpisode
                        );
                        if (attrNum) navEpisodeNumbers.add(attrNum);
                    }
                }
            }

            const sourceNumbers = navEpisodeNumbers.size >= 3 ? navEpisodeNumbers : episodeNumbers;
            if (sourceNumbers.size === 0) return null;

            const maxEpisode = Math.max(...sourceNumbers);
            if (!Number.isFinite(maxEpisode) || maxEpisode <= 0 || maxEpisode > 9999) return null;
            // On airing pages the episode nav only tells us what is currently
            // available, not the final episode count, so don't persist it as
            // the library total unless the page is clearly marked finished.
            if (releaseStatus !== 'FINISHED') return null;
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

        if (safeSlug.startsWith('fate-zero') || safeTitle.includes('fate/zero') || safeTitle.includes('fate zero')) {
            return 'fate-zero';
        }

        return slug;
    },

    normalizeTitleBySlug(slug, title) {
        const canonicalSlug = this.normalizeSlugByTitle(slug, title);
        const rawTitle = String(title || '').trim();
        if (!rawTitle) return rawTitle;

        if (canonicalSlug === 'fate-zero') {
            const cleaned = rawTitle
                .replace(/\s+(?:season\s*2|2nd\s*season|second\s*season)\s*$/i, '')
                .trim();
            const lower = cleaned.toLowerCase();
            if (lower === 'fate zero' || lower === 'fate/zero') {
                return 'Fate/Zero';
            }
            return cleaned;
        }

        return rawTitle;
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
            } catch {
            }
        }

        return animeTitle;
    }
};

window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.AnimeParser = AnimeParser;
