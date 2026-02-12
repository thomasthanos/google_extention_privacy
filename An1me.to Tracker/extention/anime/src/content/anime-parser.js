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
     * Extract anime information from the main page URL and DOM
     */
    extractAnimeInfo() {
        const { Logger } = window.AnimeTrackerContent;
        
        const pathname = window.location.pathname;
        
        Logger.debug(`Parsing: ${pathname}`);
        
        const pathMatch = pathname.match(/\/watch\/([^\/]+)(?:\/([^\/]+))?/);
        
        if (!pathMatch) {
            Logger.info('URL does not match watch pattern');
            return null;
        }

        let animeSlug = pathMatch[1];
        let episodeSlug = pathMatch[2] || null;
        let episodeNumber = 1;
        
        Logger.debug(`Slug: ${animeSlug} | Ep: ${episodeSlug || 'none'}`);

        // Episode detection patterns
        const episodePatterns = [
            /^(.+?)[-_]ep(?:isode)?[-_]?(\d+)$/i,
            /^(.+?)[-_]ch(?:apter)?[-_]?(\d+)$/i,
            /^(.+?)[-_]part[-_]?(\d+)$/i,
            /^(.+?)[-_](\d+)$/
        ];

        let episodeFound = false;
        
        for (const pattern of episodePatterns) {
            const match = animeSlug.match(pattern);
            if (match) {
                animeSlug = match[1];
                episodeNumber = parseInt(match[2]);
                episodeSlug = `episode-${episodeNumber}`;
                episodeFound = true;
                Logger.debug(`Extracted: ${animeSlug} Ep${episodeNumber}`);
                break;
            }
        }
        
        if (!episodeFound && episodeSlug) {
            const epMatch = episodeSlug.match(/ep(?:isode)?[-_]?(\d+)/i) || 
                           episodeSlug.match(/(\d+)/);
            if (epMatch) {
                episodeNumber = parseInt(epMatch[1]);
                Logger.debug(`Ep from path: ${episodeNumber}`);
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
        }

        // Store original slug for offset lookup
        const originalSlug = animeSlug;

        // Apply episode offset for multi-part anime
        const offsetMapping = window.AnimeTrackerContent?.EPISODE_OFFSET_MAPPING || {};
        const offset = offsetMapping[originalSlug] || 0;
        if (offset > 0) {
            Logger.debug(`Applying offset +${offset} to ${originalSlug}`);
            episodeNumber += offset;
        }

        // Normalize slug to merge multi-part anime into one entry
        const slugNormalization = window.AnimeTrackerContent?.SLUG_NORMALIZATION || {};
        if (slugNormalization[originalSlug]) {
            animeSlug = slugNormalization[originalSlug];
            Logger.debug(`Normalized ${originalSlug} → ${animeSlug}`);
        }

        // Extract anime title
        let animeTitle = this.extractTitle(animeSlug);

        const uniqueId = `${animeSlug}__episode-${episodeNumber}`;

        Logger.info(`${animeTitle} Ep${episodeNumber}`, { id: uniqueId });

        return {
            animeSlug,
            animeTitle: this.escapeHtml(animeTitle),
            episodeSlug: `episode-${episodeNumber}`,
            episodeNumber,
            uniqueId,
            url: window.location.href
        };
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
            const activeEpisode = document.querySelector(selector);
            if (activeEpisode) {
                const epText = activeEpisode.textContent || activeEpisode.getAttribute('title') || '';
                const epNumMatch = epText.match(/Episode\s*(\d+)/i) || 
                                  epText.match(/Ep\s*(\d+)/i) || 
                                  epText.match(/^\s*(\d+)\s*$/);
                if (epNumMatch) {
                    const episodeNumber = parseInt(epNumMatch[1]);
                    Logger.debug(`Ep from DOM: ${episodeNumber}`);
                    return episodeNumber;
                }
            }
        }
        
        return null;
    },

    /**
     * Extract anime title from slug or DOM
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

        for (const selector of titleSelectors) {
            const titleElement = document.querySelector(selector);
            if (titleElement) {
                let extractedTitle = titleElement.textContent.trim();
                
                extractedTitle = extractedTitle
                    .replace(/\s*[-~]\s*Episode\s*\d+.*/gi, '')
                    .replace(/\s*[-~]\s*Ep\s*\d+.*/gi, '')
                    .replace(/\s*[-~]\s*Part\s*\d+.*/gi, '')
                    .replace(/\s*[-~]\s*Chapter\s*\d+.*/gi, '')
                    .replace(/\s*\d+\s*$/, '')
                    .replace(/\s*\(\d{4}\)$/, '')
                    .trim();
                
                if (extractedTitle && extractedTitle.length > 2 && extractedTitle.length < 150) {
                    animeTitle = extractedTitle;
                    break;
                }
            }
        }

        return animeTitle;
    }
};

// Export
window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.AnimeParser = AnimeParser;
