/**
 * Anime Tracker - Main Entry Point
 * Orchestrates all modules and handles UI interactions
 */

(function() {
    'use strict';

    // Wait for all modules to load
    const AT = window.AnimeTracker;

    // State
    let animeData = {};
    let videoProgress = {};
    let currentSort = 'date';
    let currentCategory = 'all'; // 'all', 'series', 'movies'

    // DOM Elements
    const elements = {
        // Auth
        authSection: document.getElementById('authSection'),
        mainApp: document.getElementById('mainApp'),
        googleSignIn: document.getElementById('googleSignIn'),
        // Settings Menu
        settingsBtn: document.getElementById('settingsBtn'),
        settingsDropdown: document.getElementById('settingsDropdown'),
        settingsAvatar: document.getElementById('settingsAvatar'),
        settingsUserName: document.getElementById('settingsUserName'),
        settingsUserEmail: document.getElementById('settingsUserEmail'),
        settingsDonate: document.getElementById('settingsDonate'),
        settingsRefresh: document.getElementById('settingsRefresh'),
        settingsClear: document.getElementById('settingsClear'),
        settingsSignOut: document.getElementById('settingsSignOut'),
        // Main
        animeList: document.getElementById('animeList'),
        emptyState: document.getElementById('emptyState'),
        searchInput: document.getElementById('searchInput'),
        totalAnime: document.getElementById('totalAnime'),
        totalEpisodes: document.getElementById('totalEpisodes'),
        totalTime: document.getElementById('totalTime'),
        confirmDialog: document.getElementById('confirmDialog'),
        confirmClear: document.getElementById('confirmClear'),
        cancelClear: document.getElementById('cancelClear'),
        syncStatus: document.getElementById('syncStatus'),
        syncText: document.getElementById('syncText'),
        versionText: document.getElementById('versionText'),
        donateDropdown: document.getElementById('donateDropdown'),
        donatePaypal: document.getElementById('donatePaypal'),
        donateRevolut: document.getElementById('donateRevolut'),
        sortBtn: document.getElementById('sortBtn'),
        sortDropdown: document.getElementById('sortDropdown'),
        settingsFetchFillers: document.getElementById('settingsFetchFillers'),
        // Add Anime Dialog
        addAnimeBtn: document.getElementById('addAnimeBtn'),
        addAnimeDialog: document.getElementById('addAnimeDialog'),
        closeAddAnime: document.getElementById('closeAddAnime'),
        cancelAddAnime: document.getElementById('cancelAddAnime'),
        confirmAddAnime: document.getElementById('confirmAddAnime'),
        animeSlugInput: document.getElementById('animeSlug'),
        animeTitleInput: document.getElementById('animeTitle'),
        episodesWatchedInput: document.getElementById('episodesWatched'),
        markAllWatchedCheckbox: document.getElementById('markAllWatched'),
        // Edit Title Dialog
        editTitleDialog: document.getElementById('editTitleDialog'),
        editTitleInput: document.getElementById('editTitleInput'),
        closeEditTitle: document.getElementById('closeEditTitle'),
        cancelEditTitle: document.getElementById('cancelEditTitle'),
        confirmEditTitle: document.getElementById('confirmEditTitle'),
        // Category Tabs
        categoryTabs: document.getElementById('categoryTabs')
    };

    // State for edit title
    let editingSlug = null;

    /**
     * Show auth screen
     */
    function showAuthScreen() {
        elements.authSection.style.display = 'flex';
        elements.mainApp.style.display = 'none';
    }

    /**
     * Show main app
     */
    function showMainApp(user) {
        elements.authSection.style.display = 'none';
        elements.mainApp.style.display = 'flex';

        if (user) {
            if (user.photoURL) {
                elements.settingsAvatar.src = user.photoURL;
                elements.settingsAvatar.onerror = () => {
                    elements.settingsAvatar.src = 'src/icons/icon48.png';
                };
            } else {
                elements.settingsAvatar.src = 'src/icons/icon48.png';
            }
            elements.settingsUserName.textContent = user.displayName || user.email?.split('@')[0] || 'User';
            elements.settingsUserEmail.textContent = user.email || '';
            elements.syncStatus.classList.add('synced');
            elements.syncText.textContent = 'Cloud Synced';
        } else {
            elements.settingsAvatar.src = 'src/icons/icon48.png';
            elements.settingsUserName.textContent = 'User';
            elements.settingsUserEmail.textContent = '';
            elements.syncStatus.classList.remove('synced');
            elements.syncText.textContent = 'Local Only';
        }
    }

    /**
     * Render anime list
     */
    function renderAnimeList(filter = '') {
        const { AnimeCardRenderer, ProgressManager } = AT;

        // Save expanded state
        const expandedCards = new Set();
        elements.animeList.querySelectorAll('.anime-card.expanded').forEach(card => {
            const slug = card.querySelector('.anime-delete')?.dataset?.slug;
            if (slug) expandedCards.add(slug);
        });

        const { SeasonGrouping } = AT;

        // Filter by category
        const categoryFilter = (slug) => {
            if (currentCategory === 'all') return true;
            const isMovie = SeasonGrouping.isMovie(slug);
            if (currentCategory === 'movies') return isMovie;
            if (currentCategory === 'series') return !isMovie;
            return true;
        };

        const entries = Object.entries(animeData)
            .filter(([slug, anime]) => {
                const matchesSearch = !filter || anime.title.toLowerCase().includes(filter.toLowerCase());
                const matchesCategory = categoryFilter(slug);
                return matchesSearch && matchesCategory;
            });

        // Filter out deleted items for display
        const visibleProgress = Object.fromEntries(
            Object.entries(videoProgress).filter(([_, p]) => !p.deleted)
        );

        const inProgressOnly = ProgressManager.getInProgressOnlyAnime(animeData, visibleProgress)
            .filter(anime => {
                const matchesSearch = !filter || anime.title.toLowerCase().includes(filter.toLowerCase());
                const matchesCategory = categoryFilter(anime.slug || '');
                return matchesSearch && matchesCategory;
            })
            .sort((a, b) => new Date(b.lastProgress || 0) - new Date(a.lastProgress || 0));

        if (entries.length === 0 && inProgressOnly.length === 0) {
            elements.animeList.innerHTML = '';
            elements.emptyState.classList.add('visible');
            return;
        }

        elements.emptyState.classList.remove('visible');

        // Sort entries
        const sortedEntries = entries.sort((a, b) => {
            const [slugA, animeA] = a;
            const [slugB, animeB] = b;

            const getLatest = (slug, anime) => {
                let latest = new Date(anime.lastWatched || 0).getTime();
                Object.entries(videoProgress).forEach(([id, progress]) => {
                    if (id.startsWith(slug + '__') && !progress.deleted) {
                        const progressTime = progress.savedAt ? new Date(progress.savedAt).getTime() : 0;
                        if (progressTime > latest) latest = progressTime;
                    }
                });
                return latest;
            };

            switch (currentSort) {
                case 'date': return getLatest(slugB, animeB) - getLatest(slugA, animeA);
                case 'name': return animeA.title.localeCompare(animeB.title, 'en');
                case 'episodes': return (animeB.episodes?.length || 0) - (animeA.episodes?.length || 0);
                default: return 0;
            }
        });

        // Group anime by seasons
        const groups = SeasonGrouping.groupByBase(sortedEntries);

        // Build HTML: season groups for multi-season, regular cards for single
        let trackedHtml = '';
        const processedSlugs = new Set();

        // First pass: handle groups in order based on first entry's sort position
        const groupsArray = Array.from(groups.entries());

        // Sort groups by their first season's position in sortedEntries
        groupsArray.sort((a, b) => {
            const aFirstSlug = a[1][0].slug;
            const bFirstSlug = b[1][0].slug;
            const aIndex = sortedEntries.findIndex(([s]) => s === aFirstSlug);
            const bIndex = sortedEntries.findIndex(([s]) => s === bFirstSlug);
            return aIndex - bIndex;
        });

        for (const [baseSlug, entries] of groupsArray) {
            if (SeasonGrouping.isMovieGroup(entries)) {
                // Render as movie group
                if (entries.length > 1) {
                    trackedHtml += AnimeCardRenderer.createMovieGroup(baseSlug, entries, visibleProgress);
                    entries.forEach(m => processedSlugs.add(m.slug));
                } else {
                    // Single movie - render as single movie card
                    const { slug, anime } = entries[0];
                    trackedHtml += AnimeCardRenderer.createSingleMovieCard(slug, anime, visibleProgress);
                    processedSlugs.add(slug);
                }
            } else if (SeasonGrouping.hasMultipleSeasons(entries)) {
                // Render as season group
                trackedHtml += AnimeCardRenderer.createSeasonGroup(baseSlug, entries, visibleProgress);
                entries.forEach(s => processedSlugs.add(s.slug));
            } else {
                // Render as regular card
                const { slug, anime } = entries[0];
                trackedHtml += AnimeCardRenderer.createAnimeCard(slug, anime, visibleProgress);
                processedSlugs.add(slug);
            }
        }

        const inProgressHtml = inProgressOnly.map(anime => AnimeCardRenderer.createInProgressOnlyCard(anime)).join('');

        elements.animeList.innerHTML = inProgressHtml + trackedHtml;

        // Restore expanded state
        elements.animeList.querySelectorAll('.anime-card').forEach(card => {
            const slug = card.querySelector('.anime-delete')?.dataset?.slug;
            if (slug && expandedCards.has(slug)) {
                card.classList.add('expanded');
            }
        });

        // Add event listeners
        setupCardEventListeners();
    }

    /**
     * Setup card event listeners
     */
    function setupCardEventListeners() {
        const { FillerService } = AT;

        // In-progress headers - Click on HEADER toggles collapse
        elements.animeList.querySelectorAll('.in-progress-header').forEach(header => {
            const toggleCollapse = (e) => {
                e.stopPropagation();
                const card = header.closest('.anime-card');
                if (card && !card.classList.contains('expanded')) {
                    card.classList.add('expanded');
                }
                header.parentElement.classList.toggle('collapsed');
            };

            // Bind to header (captures title, icon, etc via bubbling)
            header.addEventListener('click', toggleCollapse);
            
            // Explicitly bind to title just in case of bubbling issues
            const title = header.querySelector('.in-progress-title');
            if (title) title.addEventListener('click', toggleCollapse);
        });

        // Episodes headers
        elements.animeList.querySelectorAll('.episodes-header').forEach(header => {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                const card = header.closest('.anime-card');
                if (card && !card.classList.contains('expanded')) {
                    card.classList.add('expanded');
                }
                header.parentElement.classList.toggle('collapsed');
            });
        });

        // Parts headers (expand/collapse the parts section)
        elements.animeList.querySelectorAll('.parts-header').forEach(header => {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                const card = header.closest('.anime-card');
                if (card && !card.classList.contains('expanded')) {
                    card.classList.add('expanded');
                }
                header.parentElement.classList.toggle('collapsed');
            });
        });

        // Part item headers (expand/collapse individual parts to show episodes)
        elements.animeList.querySelectorAll('.part-item-header').forEach(header => {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                const partItem = header.closest('.part-item');
                if (partItem) {
                    partItem.classList.toggle('expanded');
                }
            });
        });

        // Card headers
        elements.animeList.querySelectorAll('.anime-card').forEach(card => {
            const header = card.querySelector('.anime-card-header');
            if (header) {
                const toggleCard = (e) => {
                    // Don't toggle if clicking on action buttons
                    if (e.target.closest('.anime-delete') || e.target.closest('.anime-edit-title') || e.target.closest('.anime-fetch-filler')) {
                        return;
                    }
                    card.classList.toggle('expanded');
                };
                
                header.addEventListener('click', toggleCard);
                // Explicitly bind to title
                const title = header.querySelector('.anime-title');
                if (title) title.addEventListener('click', toggleCard);
            }
        });

        // Season group headers
        elements.animeList.querySelectorAll('.anime-season-group').forEach(group => {
            const header = group.querySelector('.season-group-header');
            if (header) {
                const toggleGroup = () => {
                    group.classList.toggle('expanded');
                };
                header.addEventListener('click', toggleGroup);
                // Explicitly bind to title
                const title = header.querySelector('.season-group-name');
                if (title) title.addEventListener('click', (e) => { e.stopPropagation(); toggleGroup(); });
                const titleContainer = header.querySelector('.season-group-title');
                if (titleContainer) titleContainer.addEventListener('click', (e) => { e.stopPropagation(); toggleGroup(); });
            }
        });

        // Show more fillers
        elements.animeList.querySelectorAll('.show-more-fillers').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const hiddenFillers = btn.previousElementSibling;
                if (hiddenFillers && hiddenFillers.classList.contains('hidden-fillers')) {
                    const isExpanded = hiddenFillers.classList.toggle('expanded');
                    btn.textContent = isExpanded ? btn.dataset.lessText : btn.dataset.moreText;
                }
            });
        });

        // Show more episodes
        elements.animeList.querySelectorAll('.show-more-episodes').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const hiddenEpisodes = btn.previousElementSibling;
                if (hiddenEpisodes && hiddenEpisodes.classList.contains('hidden-episodes')) {
                    const isExpanded = hiddenEpisodes.classList.toggle('expanded');
                    btn.textContent = isExpanded ? btn.dataset.lessText : btn.dataset.moreText;
                }
            });
        });

        // Delete buttons
        elements.animeList.querySelectorAll('.anime-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteAnime(btn.dataset.slug);
            });
        });

        // Edit title buttons
        elements.animeList.querySelectorAll('.anime-edit-title').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const slug = btn.dataset.slug;
                editAnimeTitle(slug);
            });
        });

        // Season item edit buttons
        elements.animeList.querySelectorAll('.season-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const slug = btn.dataset.slug;
                editAnimeTitle(slug);
            });
        });

        // Season item delete buttons
        elements.animeList.querySelectorAll('.season-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteAnime(btn.dataset.slug);
            });
        });

        // Season item headers (expand/collapse)
        elements.animeList.querySelectorAll('.season-item-header').forEach(header => {
            const toggleSeason = (e) => {
                 // Don't toggle if clicking on buttons
                if (e.target.closest('.season-edit-btn') || e.target.closest('.season-delete-btn')) {
                    return;
                }
                e.stopPropagation();
                const seasonItem = header.closest('.season-item');
                if (seasonItem) {
                    seasonItem.classList.toggle('expanded');
                }
            };

            header.addEventListener('click', toggleSeason);
            
            // Explicitly bind to label/title
            const label = header.querySelector('.season-label');
            if (label) label.addEventListener('click', toggleSeason);
            
            const movieLabel = header.querySelector('.movie-label');
            if (movieLabel) movieLabel.addEventListener('click', toggleSeason);
        });

        // Movie group headers
        elements.animeList.querySelectorAll('.anime-movie-group').forEach(group => {
            const header = group.querySelector('.movie-group-header');
            if (header) {
                header.addEventListener('click', () => {
                    group.classList.toggle('expanded');
                });
            }
        });

        // Movie item edit buttons
        elements.animeList.querySelectorAll('.movie-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const slug = btn.dataset.slug;
                editAnimeTitle(slug);
            });
        });

        // Movie item delete buttons
        elements.animeList.querySelectorAll('.movie-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteAnime(btn.dataset.slug);
            });
        });
    }

    /**
     * Update stats
     */
    function updateStats() {
        const { FillerService, UIHelpers, SeasonGrouping } = AT;

        const animeEntries = Object.entries(animeData);

        // Count unique anime (season groups count as 1)
        const groups = SeasonGrouping.groupByBase(animeEntries);
        elements.totalAnime.textContent = groups.size;

        let totalCanonEpisodes = 0;
        let totalCanonTime = 0;

        for (const [slug, anime] of animeEntries) {
            const canonEps = FillerService.getCanonEpisodeCount(slug, anime.episodes);
            totalCanonEpisodes += canonEps;
            totalCanonTime += FillerService.getCanonWatchTime(slug, anime);
        }

        elements.totalEpisodes.textContent = totalCanonEpisodes;
        elements.totalTime.textContent = UIHelpers.formatDurationShort(totalCanonTime);
    }

    /**
     * Load local data
     */
    async function loadData() {
        const { Storage, ProgressManager, FillerService, UIHelpers } = AT;

        try {
            // Run multi-part anime migration first
            await Storage.migrateMultiPartAnime();

            const result = await Storage.get(['animeData', 'videoProgress']);
            animeData = result.animeData || {};
            videoProgress = result.videoProgress || {};
            
            const cleanedData = ProgressManager.removeDuplicateEpisodes(animeData);
            const { cleaned: cleanedProgress, removedCount: progressRemoved } = 
                ProgressManager.cleanTrackedProgress(cleanedData, videoProgress);

            const originalCount = UIHelpers.countEpisodes(animeData);
            const cleanedCount = UIHelpers.countEpisodes(cleanedData);
            const needsSave = (originalCount !== cleanedCount) || (progressRemoved > 0);

            if (needsSave) {
                animeData = cleanedData;
                videoProgress = cleanedProgress;
                await Storage.set({
                    animeData: cleanedData,
                    videoProgress: cleanedProgress
                });
            } else {
                animeData = cleanedData;
            }

            await FillerService.loadCachedEpisodeTypes(animeData);

            renderAnimeList();
            updateStats();

            setTimeout(() => {
                FillerService.autoFetchMissing(animeData, () => {
                    renderAnimeList(elements.searchInput?.value || '');
                    updateStats();
                });
            }, 1000);
        } catch (e) {
            console.error('[Storage] Load error:', e);
            animeData = {};
            videoProgress = {};
            renderAnimeList();
            updateStats();
        }
    }

    /**
     * Load and sync with cloud
     */
    async function loadAndSyncData() {
        const { Storage, FirebaseSync, FillerService } = AT;

        try {
            // Load user preferences first
            const prefs = await chrome.storage.local.get(['userPreferences']);
            if (prefs.userPreferences) {
                currentSort = prefs.userPreferences.sort || 'date';
                currentCategory = prefs.userPreferences.category || 'all';

                // Update UI to reflect saved preferences
                document.querySelectorAll('.sort-option').forEach(o => {
                    o.classList.toggle('active', o.dataset.sort === currentSort);
                });
                if (elements.categoryTabs) {
                    elements.categoryTabs.querySelectorAll('.category-tab').forEach(t => {
                        t.classList.toggle('active', t.dataset.category === currentCategory);
                    });
                }
            }

            // Run multi-part anime migration first
            await Storage.migrateMultiPartAnime();

            const data = await FirebaseSync.loadAndSyncData(elements);
            if (data) {
                animeData = data.animeData;
                videoProgress = data.videoProgress;

                renderAnimeList(elements.searchInput?.value || '');
                updateStats();

                setTimeout(() => {
                    FillerService.autoFetchMissing(animeData, () => {
                        renderAnimeList(elements.searchInput?.value || '');
                        updateStats();
                    });
                }, 1000);
            }
        } catch (error) {
            console.error('[Sync] Error:', error);
            loadData();
        }
    }

    /**
     * Delete episode progress
     */
    async function deleteProgress(slug, episodeNumber) {
        const { Storage, FirebaseSync } = AT;
        
        const uniqueId = `${slug}__episode-${episodeNumber}`;
        
        try {
            const result = await Storage.get(['videoProgress']);
            const currentVideoProgress = result.videoProgress || {};
            
            if (currentVideoProgress[uniqueId]) {
                // Soft delete: mark as deleted instead of removing
                currentVideoProgress[uniqueId] = {
                    ...currentVideoProgress[uniqueId],
                    deleted: true,
                    deletedAt: new Date().toISOString()
                };
                
                videoProgress = currentVideoProgress;
                
                const dataToSave = { videoProgress: currentVideoProgress };
                const user = FirebaseSync.getUser();
                if (user) {
                    dataToSave.userId = user.uid;
                }
                
                // Save locally first
                await Storage.set(dataToSave);
                
                // Then force cloud sync
                if (user) {
                    // Force immediate save, passing proper data
                    console.log('[DeleteProgress] Syncing deletion to cloud...');
                    try {
                        await FirebaseSync.saveToCloud({ 
                            animeData: animeData, 
                            videoProgress: currentVideoProgress 
                        }, true); // true = immediate
                    } catch (syncErr) {
                        console.error('[DeleteProgress] Cloud sync failed:', syncErr);
                    }
                }
                
                renderAnimeList(elements.searchInput?.value || '');
                console.log(`[DeleteProgress] Soft deleted progress for ${slug} Ep${episodeNumber}`);
            }
        } catch (e) {
            console.error('[DeleteProgress] Error:', e);
            alert('Failed to delete progress. Please try again.');
        }
    }

    /**
     * Delete anime
     */
    async function deleteAnime(slug) {
        const { Storage, FirebaseSync, UIHelpers } = AT;
        
        // Remove from animeData if it exists
        if (animeData[slug]) {
            delete animeData[slug];
        } else {
             console.log('[Delete] Anime not in local list, checking progress only:', slug);
        }

        try {
            const result = await Storage.get(['videoProgress']);
            const currentVideoProgress = result.videoProgress || {};

            let progressDeleted = 0;
            const progressPrefix = slug + '__episode-';
            for (const id of Object.keys(currentVideoProgress)) {
                if (id.startsWith(progressPrefix)) {
                    delete currentVideoProgress[id];
                    progressDeleted++;
                }
            }

            if (progressDeleted === 0 && !animeData[slug]) {
                 console.warn('[Delete] No data found to delete for:', slug);
                 return;
            }

            videoProgress = currentVideoProgress;

            const dataToSave = { animeData, videoProgress: currentVideoProgress };
            const user = FirebaseSync.getUser();
            if (user) {
                dataToSave.userId = user.uid;
            }

            await Storage.set(dataToSave);

            if (user) {
                // Fix: Use immediate save to ensure deletion is committed before popup closes
                await FirebaseSync.saveToCloud({ animeData, videoProgress: currentVideoProgress }, true);
            }

            renderAnimeList(elements.searchInput?.value || '');
            updateStats();
        } catch (e) {
            console.error('[Delete] Error:', e);
            alert('Failed to delete anime. Please try again.');
        }
    }

    /**
     * Clear all data
     */
    async function clearAllData() {
        const { Storage, FirebaseSync } = AT;
        
        const dataToSave = {
            animeData: {},
            videoProgress: {}
        };
        
        const user = FirebaseSync.getUser();
        if (user) {
            dataToSave.userId = user.uid;
        }
        
        await Storage.set(dataToSave);
        
        if (user) {
            // Fix: Use immediate save
            await FirebaseSync.saveToCloud({ animeData: {}, videoProgress: {} }, true);
        }
        
        animeData = {};
        videoProgress = {};
        renderAnimeList();
        updateStats();
        hideDialog();
    }

    function showDialog() { elements.confirmDialog.classList.add('visible'); }
    function hideDialog() { elements.confirmDialog.classList.remove('visible'); }

    /**
     * Show add anime dialog
     */
    function showAddAnimeDialog() {
        // Reset form
        elements.animeSlugInput.value = '';
        elements.animeTitleInput.value = '';
        elements.episodesWatchedInput.value = '1';
        elements.markAllWatchedCheckbox.checked = true;
        elements.animeSlugInput.classList.remove('error');
        elements.episodesWatchedInput.classList.remove('error');

        elements.addAnimeDialog.classList.add('visible');
        elements.animeSlugInput.focus();
    }

    /**
     * Hide add anime dialog
     */
    function hideAddAnimeDialog() {
        elements.addAnimeDialog.classList.remove('visible');
    }

    /**
     * Extract slug from URL or return as-is
     */
    function extractSlugFromInput(input) {
        if (!input) return null;

        input = input.trim();

        // Check if it's a watch URL with episode (e.g., /watch/black-clover-episode-170/)
        const watchEpisodePattern = /\/watch\/([a-zA-Z0-9-]+)-episode-\d+/i;
        const watchMatch = input.match(watchEpisodePattern);
        if (watchMatch) {
            return watchMatch[1].toLowerCase();
        }

        // Check if it's an anime URL (e.g., /anime/black-clover)
        const animePattern = /\/anime\/([a-zA-Z0-9-]+)/i;
        const animeMatch = input.match(animePattern);
        if (animeMatch) {
            return animeMatch[1].toLowerCase();
        }

        // Check if it's a watch URL without episode
        const watchPattern = /\/watch\/([a-zA-Z0-9-]+)/i;
        const watchOnlyMatch = input.match(watchPattern);
        if (watchOnlyMatch) {
            // Remove -episode-N suffix if present
            return watchOnlyMatch[1].toLowerCase().replace(/-episode-\d+$/, '');
        }

        // Otherwise treat as slug directly - convert to lowercase and replace spaces with dashes
        return input.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    }

    /**
     * Generate title from slug
     */
    function generateTitleFromSlug(slug) {
        return slug
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    /**
     * Add anime with watched episodes
     */
    async function addAnimeWithEpisodes() {
        const { Storage, FirebaseSync, SeasonGrouping } = AT;

        // Get and validate inputs
        const slugInput = elements.animeSlugInput.value;
        const slug = extractSlugFromInput(slugInput);
        const title = elements.animeTitleInput.value.trim() || generateTitleFromSlug(slug);
        const episodeCount = parseInt(elements.episodesWatchedInput.value, 10);
        const markAll = elements.markAllWatchedCheckbox.checked;

        // Validate slug
        if (!slug) {
            elements.animeSlugInput.classList.add('error');
            elements.animeSlugInput.focus();
            return;
        }
        elements.animeSlugInput.classList.remove('error');

        // Validate episode count
        if (isNaN(episodeCount) || episodeCount < 1) {
            elements.episodesWatchedInput.classList.add('error');
            elements.episodesWatchedInput.focus();
            return;
        }
        elements.episodesWatchedInput.classList.remove('error');

        // Disable button during save
        elements.confirmAddAnime.disabled = true;
        elements.confirmAddAnime.textContent = 'Adding...';

        try {
            const now = new Date().toISOString();

            // Determine duration based on content type
            // Movies: ~100 minutes (6000 seconds), Episodes: ~24 minutes (1440 seconds)
            const isMovie = SeasonGrouping.isMovie(slug);
            const defaultDuration = isMovie ? 6000 : 1440;

            // Create episodes array
            const episodes = [];
            if (markAll) {
                // Mark episodes 1 to N
                for (let i = 1; i <= episodeCount; i++) {
                    episodes.push({
                        number: i,
                        duration: defaultDuration,
                        watchedAt: now
                    });
                }
            } else {
                // Just mark the specified episode
                episodes.push({
                    number: episodeCount,
                    duration: defaultDuration,
                    watchedAt: now
                });
            }

            // Check if anime already exists and merge episodes
            if (animeData[slug]) {
                const existingEpisodes = animeData[slug].episodes || [];
                const existingNumbers = new Set(existingEpisodes.map(ep => ep.number));

                // Add only new episodes
                for (const ep of episodes) {
                    if (!existingNumbers.has(ep.number)) {
                        existingEpisodes.push(ep);
                    }
                }

                existingEpisodes.sort((a, b) => a.number - b.number);

                animeData[slug].episodes = existingEpisodes;
                animeData[slug].totalWatchTime = existingEpisodes.reduce((sum, ep) => sum + (ep.duration || 0), 0);
                animeData[slug].lastWatched = now;
            } else {
                // Create new anime entry
                animeData[slug] = {
                    title: title,
                    slug: slug,
                    episodes: episodes,
                    totalWatchTime: episodes.reduce((sum, ep) => sum + (ep.duration || 0), 0),
                    lastWatched: now,
                    totalEpisodes: null
                };
            }

            // Save to local storage
            const dataToSave = { animeData, videoProgress };
            const user = FirebaseSync.getUser();
            if (user) {
                dataToSave.userId = user.uid;
            }

            await Storage.set(dataToSave);

            // Update UI immediately
            renderAnimeList(elements.searchInput?.value || '');
            updateStats();

            // Close dialog
            hideAddAnimeDialog();

            console.log(`[AddAnime] Added ${slug} with ${episodes.length} episodes`);

            // Save to cloud in background (don't wait)
            if (user) {
                FirebaseSync.saveToCloud({ animeData, videoProgress }).catch(err => {
                    console.error('[AddAnime] Cloud save error:', err);
                });
            }
        } catch (error) {
            console.error('[AddAnime] Error:', error);
            alert('Failed to add anime. Please try again.');
        } finally {
            elements.confirmAddAnime.disabled = false;
            elements.confirmAddAnime.textContent = 'Add Anime';
        }
    }

    /**
     * Show edit title dialog
     */
    function showEditTitleDialog(slug) {
        if (!animeData[slug]) {
            console.warn('[EditTitle] Anime not found:', slug);
            return;
        }

        editingSlug = slug;
        const currentTitle = animeData[slug].title || '';
        elements.editTitleInput.value = currentTitle;
        elements.editTitleDialog.classList.add('visible');
        elements.editTitleInput.focus();
        elements.editTitleInput.select();
    }

    /**
     * Hide edit title dialog
     */
    function hideEditTitleDialog() {
        elements.editTitleDialog.classList.remove('visible');
        editingSlug = null;
    }

    /**
     * Save edited title
     */
    async function saveEditedTitle() {
        const { Storage, FirebaseSync } = AT;

        if (!editingSlug || !animeData[editingSlug]) {
            hideEditTitleDialog();
            return;
        }

        const newTitle = elements.editTitleInput.value.trim();
        const currentTitle = animeData[editingSlug].title || '';

        if (newTitle === '' || newTitle === currentTitle) {
            hideEditTitleDialog();
            return;
        }

        try {
            animeData[editingSlug].title = newTitle;

            // Save to local storage
            const dataToSave = { animeData, videoProgress };
            const user = FirebaseSync.getUser();
            if (user) {
                dataToSave.userId = user.uid;
            }

            await Storage.set(dataToSave);

            // Update UI
            renderAnimeList(elements.searchInput?.value || '');

            console.log(`[EditTitle] Updated title for ${editingSlug}: "${newTitle}"`);

            // Save to cloud in background
            if (user) {
                FirebaseSync.saveToCloud({ animeData, videoProgress }).catch(err => {
                    console.error('[EditTitle] Cloud save error:', err);
                });
            }

            hideEditTitleDialog();
        } catch (error) {
            console.error('[EditTitle] Error:', error);
            alert('Failed to update title. Please try again.');
        }
    }

    /**
     * Edit anime title (show dialog)
     */
    function editAnimeTitle(slug) {
        showEditTitleDialog(slug);
    }

    /**
     * Fetch filler data for all anime
     */
    async function fetchAllFillers() {
        const { FillerService } = AT;

        const slugs = Object.keys(animeData);
        if (slugs.length === 0) {
            alert('No anime to fetch filler data for.');
            return;
        }

        console.log('[FetchFillers] Fetching filler data for', slugs.length, 'anime...');

        let successCount = 0;
        let failCount = 0;

        for (const slug of slugs) {
            try {
                const episodeTypes = await FillerService.fetchEpisodeTypes(slug);
                if (episodeTypes) {
                    FillerService.updateFromEpisodeTypes(slug, episodeTypes);
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (e) {
                console.error(`[FetchFillers] Failed for ${slug}:`, e);
                failCount++;
            }
        }

        console.log(`[FetchFillers] Done: ${successCount} success, ${failCount} failed`);

        // Update UI
        renderAnimeList(elements.searchInput?.value || '');
        updateStats();
    }

    /**
     * Sign in with Google
     */
    async function signInWithGoogle() {
        const { FirebaseSync } = AT;
        
        try {
            elements.googleSignIn.disabled = true;
            elements.googleSignIn.textContent = 'Signing in...';
            
            await FirebaseSync.signInWithGoogle();
        } catch (error) {
            console.error('[Firebase] Sign in error:', error);
            alert('Sign in failed: ' + error.message);
        } finally {
            elements.googleSignIn.disabled = false;
            elements.googleSignIn.innerHTML = `
                <svg class="google-icon" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Sign in with Google
            `;
        }
    }

    /**
     * Sign out
     */
    async function signOut() {
        const { Storage, FirebaseSync } = AT;
        
        animeData = {};
        videoProgress = {};
        
        await Storage.set({
            animeData: {},
            videoProgress: {}
        });
        
        await FirebaseSync.signOut();
        
        renderAnimeList();
        updateStats();
    }

    /**
     * Initialize event listeners
     */
    function initEventListeners() {
        const { CONFIG, DONATE_LINKS, UIHelpers, FirebaseSync, Storage } = AT;
        
        // Auth
        if (elements.googleSignIn) {
            elements.googleSignIn.addEventListener('click', signInWithGoogle);
        }

        // Settings Menu
        if (elements.settingsBtn) {
            elements.settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (elements.donateDropdown) {
                    elements.donateDropdown.classList.remove('visible');
                }
                elements.settingsDropdown.classList.toggle('visible');
            });
        }
        
        document.addEventListener('click', (e) => {
            if (elements.settingsDropdown && elements.settingsBtn && 
                !elements.settingsDropdown.contains(e.target) && 
                !elements.settingsBtn.contains(e.target)) {
                elements.settingsDropdown.classList.remove('visible');
            }
            
            if (elements.donateDropdown && 
                !elements.donateDropdown.contains(e.target) &&
                (!elements.settingsDonate || !elements.settingsDonate.contains(e.target))) {
                elements.donateDropdown.classList.remove('visible');
            }
        });

        // Settings Items
        if (elements.settingsDonate) {
            elements.settingsDonate.addEventListener('click', (e) => {
                e.stopPropagation();
                elements.settingsDropdown.classList.remove('visible');
                setTimeout(() => {
                    elements.donateDropdown.classList.add('visible');
                }, 150);
            });
        }

        if (elements.settingsRefresh) {
            elements.settingsRefresh.addEventListener('click', async () => {
                elements.settingsRefresh.classList.add('loading');
                elements.settingsDropdown.classList.remove('visible');
                
                if (FirebaseSync.getUser()) {
                    await loadAndSyncData();
                } else {
                    loadData();
                }
                
                setTimeout(() => elements.settingsRefresh.classList.remove('loading'), 500);
            });
        }

        if (elements.settingsClear) {
            elements.settingsClear.addEventListener('click', () => {
                elements.settingsDropdown.classList.remove('visible');
                showDialog();
            });
        }

        if (elements.settingsSignOut) {
            elements.settingsSignOut.addEventListener('click', () => {
                elements.settingsDropdown.classList.remove('visible');
                signOut();
            });
        }

        if (elements.settingsFetchFillers) {
            elements.settingsFetchFillers.addEventListener('click', () => {
                elements.settingsDropdown.classList.remove('visible');
                fetchAllFillers();
            });
        }

        // Search
        if (elements.searchInput) {
            let searchTimeout = null;
            elements.searchInput.addEventListener('input', (e) => {
                if (searchTimeout) clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    renderAnimeList(e.target.value);
                }, CONFIG.SEARCH_DEBOUNCE_MS);
            });
        }

        // Clear Confirmation
        if (elements.confirmClear) {
            elements.confirmClear.addEventListener('click', clearAllData);
        }
        if (elements.cancelClear) {
            elements.cancelClear.addEventListener('click', hideDialog);
        }
        if (elements.confirmDialog) {
            elements.confirmDialog.addEventListener('click', (e) => {
                if (e.target === elements.confirmDialog) hideDialog();
            });
        }

        // Add Anime Dialog
        if (elements.addAnimeBtn) {
            elements.addAnimeBtn.addEventListener('click', showAddAnimeDialog);
        }
        if (elements.closeAddAnime) {
            elements.closeAddAnime.addEventListener('click', hideAddAnimeDialog);
        }
        if (elements.cancelAddAnime) {
            elements.cancelAddAnime.addEventListener('click', hideAddAnimeDialog);
        }
        if (elements.confirmAddAnime) {
            elements.confirmAddAnime.addEventListener('click', addAnimeWithEpisodes);
        }
        if (elements.addAnimeDialog) {
            elements.addAnimeDialog.addEventListener('click', (e) => {
                if (e.target === elements.addAnimeDialog) hideAddAnimeDialog();
            });
        }
        // Handle Enter key in add anime form
        if (elements.animeSlugInput) {
            elements.animeSlugInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') elements.episodesWatchedInput.focus();
            });
        }
        if (elements.episodesWatchedInput) {
            elements.episodesWatchedInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') addAnimeWithEpisodes();
            });
        }

        // Edit Title Dialog
        if (elements.closeEditTitle) {
            elements.closeEditTitle.addEventListener('click', hideEditTitleDialog);
        }
        if (elements.cancelEditTitle) {
            elements.cancelEditTitle.addEventListener('click', hideEditTitleDialog);
        }
        if (elements.confirmEditTitle) {
            elements.confirmEditTitle.addEventListener('click', saveEditedTitle);
        }
        if (elements.editTitleDialog) {
            elements.editTitleDialog.addEventListener('click', (e) => {
                if (e.target === elements.editTitleDialog) hideEditTitleDialog();
            });
        }
        if (elements.editTitleInput) {
            elements.editTitleInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') saveEditedTitle();
            });
        }

        // Donate buttons
        if (elements.donatePaypal) {
            elements.donatePaypal.addEventListener('click', () => {
                window.open(DONATE_LINKS.paypal, '_blank');
                elements.donateDropdown.classList.remove('visible');
            });
        }
        if (elements.donateRevolut) {
            elements.donateRevolut.addEventListener('click', () => {
                window.open(DONATE_LINKS.revolut, '_blank');
                elements.donateDropdown.classList.remove('visible');
            });
        }

        // Sort
        if (elements.sortBtn) {
            elements.sortBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                elements.sortDropdown.classList.toggle('visible');
                elements.sortBtn.classList.toggle('active');
            });
        }

        document.querySelectorAll('.sort-option').forEach(option => {
            option.addEventListener('click', async () => {
                currentSort = option.dataset.sort;
                document.querySelectorAll('.sort-option').forEach(o => o.classList.remove('active'));
                option.classList.add('active');
                if (elements.searchInput) {
                    renderAnimeList(elements.searchInput.value);
                }
                if (elements.sortDropdown) elements.sortDropdown.classList.remove('visible');
                if (elements.sortBtn) elements.sortBtn.classList.remove('active');
                // Save sort preference
                await chrome.storage.local.set({ userPreferences: { sort: currentSort, category: currentCategory } });
            });
        });

        document.addEventListener('click', (e) => {
            if (elements.sortDropdown && elements.sortBtn &&
                !elements.sortDropdown.contains(e.target) && !elements.sortBtn.contains(e.target)) {
                elements.sortDropdown.classList.remove('visible');
                elements.sortBtn.classList.remove('active');
            }
        });

        // Category tabs
        if (elements.categoryTabs) {
            elements.categoryTabs.querySelectorAll('.category-tab').forEach(tab => {
                tab.addEventListener('click', async () => {
                    currentCategory = tab.dataset.category;
                    elements.categoryTabs.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    if (elements.searchInput) {
                        renderAnimeList(elements.searchInput.value);
                    }
                    // Save category preference
                    await chrome.storage.local.set({ userPreferences: { sort: currentSort, category: currentCategory } });
                });
            });
        }

        // Storage changes
        let storageUpdateTimeout = null;
        let isInternalUpdate = false;
        let updateResetTimeout = null;

        chrome.storage.local.onChanged.addListener((changes, namespace) => {
            if (isInternalUpdate) return;

            let needsUpdate = false;
            let needsCloudSync = false;

            if (changes.animeData) {
                animeData = changes.animeData.newValue || {};
                needsUpdate = true;

                const oldCount = UIHelpers.countEpisodes(changes.animeData.oldValue || {});
                const newCount = UIHelpers.countEpisodes(changes.animeData.newValue || {});
                if (newCount > oldCount) {
                    needsCloudSync = true;
                }
            }
            if (changes.videoProgress) {
                videoProgress = changes.videoProgress.newValue || {};
                needsUpdate = true;
            }

            if (needsUpdate) {
                if (storageUpdateTimeout) {
                    clearTimeout(storageUpdateTimeout);
                }

                storageUpdateTimeout = setTimeout(async () => {
                    renderAnimeList(elements.searchInput?.value || '');
                    updateStats();

                    if (FirebaseSync.getUser() && needsCloudSync) {
                        isInternalUpdate = true;

                        if (updateResetTimeout) {
                            clearTimeout(updateResetTimeout);
                            updateResetTimeout = null;
                        }

                        try {
                            const result = await Storage.get(['animeData', 'videoProgress']);
                            await FirebaseSync.saveToCloud({
                                animeData: result.animeData || {},
                                videoProgress: result.videoProgress || {}
                            });
                        } catch (error) {
                            console.error('[Storage] Cloud save error:', error);
                        } finally {
                            updateResetTimeout = setTimeout(() => {
                                isInternalUpdate = false;
                            }, 1000);
                        }
                    }
                }, CONFIG.STORAGE_UPDATE_DEBOUNCE_MS);
            }
        });

        // Event delegation for anime list (dynamic elements)
        if (elements.animeList) {
            elements.animeList.addEventListener('click', async (e) => {
                const target = e.target;
                
                // Delete progress button
                if (target.classList.contains('progress-delete-btn') || target.closest('.progress-delete-btn')) {
                    const btn = target.classList.contains('progress-delete-btn') ? target : target.closest('.progress-delete-btn');
                    const slug = btn.dataset.slug;
                    const episodeNum = parseInt(btn.dataset.episode, 10);
                    
                    if (slug && episodeNum) {
                        await deleteProgress(slug, episodeNum);
                    }
                    return;
                }
                
                // Delete anime button
                if (target.classList.contains('anime-delete') || target.closest('.anime-delete')) {
                    const btn = target.classList.contains('anime-delete') ? target : target.closest('.anime-delete');
                    const slug = btn.dataset.slug;
                    if (slug) {
                        deleteAnime(slug);
                    }
                    return;
                }
                
                // Edit title button
                if (target.classList.contains('anime-edit-title') || target.closest('.anime-edit-title')) {
                    const btn = target.classList.contains('anime-edit-title') ? target : target.closest('.anime-edit-title');
                    const slug = btn.dataset.slug;
                    if (slug) {
                        editAnimeTitle(slug);
                    }
                    return;
                }
                
                // Fetch filler button
                if (target.classList.contains('anime-fetch-filler') || target.closest('.anime-fetch-filler')) {
                    const btn = target.classList.contains('anime-fetch-filler') ? target : target.closest('.anime-fetch-filler');
                    const slug = btn.dataset.slug;
                    if (slug && !btn.disabled) {
                        await fetchFillerForAnime(slug, btn);
                    }
                    return;
                }
                
                // Expand/collapse card
                const card = target.closest('.anime-card');
                if (card && !target.closest('button') && !target.closest('.anime-card-actions')) {
                    card.classList.toggle('expanded');
                    return;
                }
                
                // Collapse in-progress section
                const inProgressHeader = target.closest('.in-progress-header');
                if (inProgressHeader) {
                    const section = inProgressHeader.closest('.anime-in-progress');
                    if (section) {
                        section.classList.toggle('collapsed');
                    }
                    return;
                }
                
                // Collapse episodes section
                const episodesHeader = target.closest('.episodes-header');
                if (episodesHeader) {
                    const section = episodesHeader.closest('.anime-episodes');
                    if (section) {
                        section.classList.toggle('collapsed');
                    }
                    return;
                }
            });
        }
    }

    /**
     * Initialize
     */
    function init() {
        const { FirebaseSync } = AT;
        
        // Display version dynamically from manifest
        try {
            const manifest = chrome.runtime.getManifest();
            if (elements.versionText && manifest?.version) {
                elements.versionText.textContent = `Anime Tracker v${manifest.version}`;
            }
        } catch (e) {
            console.warn('[Version] Could not load manifest version:', e);
        }
        
        initEventListeners();
        
        // Initialize Firebase
        FirebaseSync.init({
            onUserSignedIn: (user) => {
                showMainApp(user);
                loadAndSyncData();
            },
            onUserSignedOut: () => {
                showAuthScreen();
            },
            onError: (error) => {
                showMainApp(null);
                loadData();
            }
        });
    }

    // Cleanup handlers
    window.addEventListener('beforeunload', () => {
        AT.FirebaseSync.cleanup();
    });

    document.addEventListener('visibilitychange', async () => {
        if (document.hidden) {
            AT.FirebaseSync.cleanup();
        }
    });

    // Debug functions
    window.debugFillers = function(slug) {
        const { FillerService } = AT;
        const normalized = FillerService.getNormalizedFillerSlug(slug);
        const fillers = FillerService.KNOWN_FILLERS[normalized];
        console.log('[Debug] Slug:', slug);
        console.log('[Debug] Normalized:', normalized);
        console.log('[Debug] Has filler data:', !!fillers);
        if (fillers) {
            console.log('[Debug] Filler ranges:', fillers);
            const total = fillers.reduce((sum, [s, e]) => sum + (e - s + 1), 0);
            console.log('[Debug] Total fillers:', total);
        }
        return { slug, normalized, hasData: !!fillers };
    };
    
    window.showAllSlugs = function() {
        const { FillerService } = AT;
        console.log('[Debug] All anime slugs:');
        Object.keys(animeData).forEach(slug => {
            const normalized = FillerService.getNormalizedFillerSlug(slug);
            const hasFillers = !!FillerService.KNOWN_FILLERS[normalized];
            console.log(`  ${slug} -> ${normalized} (filler data: ${hasFillers})`);
        });
    };

    window.testFetchFillers = async function(animeSlug) {
        const { FillerService } = AT;
        console.log(`[Test] Fetching filler data for: ${animeSlug}`);
        try {
            const episodeTypes = await FillerService.fetchEpisodeTypes(animeSlug);
            if (episodeTypes) {
                FillerService.updateFromEpisodeTypes(animeSlug, episodeTypes);
                console.log('[Test] ✓ Success!', episodeTypes);
            }
            return episodeTypes;
        } catch (error) {
            console.error('[Test] ✗ Failed:', error);
            return null;
        }
    };

    window.cleanupDuplicates = async function() {
        const { Storage, ProgressManager, UIHelpers, FirebaseSync } = AT;
        
        console.log('[Cleanup] Starting manual cleanup...');
        
        const result = await Storage.get(['animeData', 'videoProgress', 'userId']);
        const originalCount = UIHelpers.countEpisodes(result.animeData || {});
        
        const cleanedData = ProgressManager.removeDuplicateEpisodes(result.animeData || {});
        const { cleaned: cleanedProgress, removedCount: progressRemoved } = 
            ProgressManager.cleanTrackedProgress(cleanedData, result.videoProgress || {});
        
        const cleanedCount = UIHelpers.countEpisodes(cleanedData);
        console.log('[Cleanup] Removed:', originalCount - cleanedCount, 'duplicates,', progressRemoved, 'progress entries');

        await Storage.set({
            animeData: cleanedData,
            videoProgress: cleanedProgress
        });
        
        if (FirebaseSync.getUser()) {
            FirebaseSync.pendingSave = { animeData: cleanedData, videoProgress: cleanedProgress };
            await FirebaseSync.performCloudSave();
        }
        
        animeData = cleanedData;
        videoProgress = cleanedProgress;
        renderAnimeList(elements.searchInput?.value || '');
        updateStats();
        
        return { removed: originalCount - cleanedCount, progressRemoved };
    };

    // Start
    init();
    // Cleanup on unload to ensure pending saves are pushed
    window.addEventListener('unload', () => {
        if (window.AnimeTracker && window.AnimeTracker.FirebaseSync) {
            window.AnimeTracker.FirebaseSync.cleanup();
        }
    });

})();
