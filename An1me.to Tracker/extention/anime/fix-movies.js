/**
 * Fix Movie Data Script
 * Updates movie entries with correct duration (100m instead of 24m)
 * and ensures proper labeling
 *
 * Run this in the browser console while on the extension popup,
 * or use it as a one-time migration script
 */

const KNOWN_MOVIE_SLUGS = [
    'your-name', 'kimi-no-na-wa',
    'weathering-with-you', 'tenki-no-ko',
    'suzume', 'suzume-no-tojimari',
    '5-centimeters-per-second', 'byousoku-5-centimeter',
    'garden-of-words', 'kotonoha-no-niwa',
    'the-first-slam-dunk',
    'a-silent-voice', 'koe-no-katachi',
    'i-want-to-eat-your-pancreas', 'kimi-no-suizou-wo-tabetai',
    'grave-of-the-fireflies', 'hotaru-no-haka',
    'akira',
    'spirited-away', 'sen-to-chihiro',
    'howls-moving-castle', 'howl-no-ugoku-shiro',
    'princess-mononoke', 'mononoke-hime',
    'my-neighbor-totoro', 'tonari-no-totoro',
    'jujutsu-kaisen-0',
    'demon-slayer-mugen-train', 'kimetsu-no-yaiba-mugen-train',
    'dragon-ball-super-broly',
    'dragon-ball-super-super-hero',
    'my-hero-academia-two-heroes',
    'my-hero-academia-heroes-rising',
    'my-hero-academia-world-heroes-mission',
    'naruto-the-last',
    'the-last-naruto',
    'higashi-no-eden'
];

function isMovie(slug) {
    const lowerSlug = slug.toLowerCase();

    // Check known movie slugs
    if (KNOWN_MOVIE_SLUGS.some(movie => lowerSlug === movie || lowerSlug.startsWith(movie + '-'))) {
        return true;
    }

    // Pattern-based detection
    const moviePatterns = [
        /-movie(-|$)/i,
        /-film(-|$)/i,
        /-gekijouban/i,
        /-the-movie/i,
        /^.*-movie-\d+/i,
        /-3d-/i,
        /-two-heroes$/i,
        /-heroes-rising$/i,
        /-world-heroes-mission$/i,
        /-super-hero$/i,
        /-broly$/i,
        /-the-last$/i,
        /-mugen-train$/i
    ];
    return moviePatterns.some(pattern => pattern.test(slug));
}

// Movie duration: 100 minutes = 6000 seconds
// Episode duration: 24 minutes = 1440 seconds
const MOVIE_DURATION = 6000;
const EPISODE_DURATION = 1440;

async function fixMovieData() {
    console.log('🎬 Starting movie data fix...\n');

    // Get current data from Chrome storage
    const result = await chrome.storage.local.get(['animeData']);
    const animeData = result.animeData || {};

    let fixedCount = 0;
    let moviesFound = [];

    for (const [slug, anime] of Object.entries(animeData)) {
        if (!isMovie(slug)) continue;

        moviesFound.push(slug);
        let needsUpdate = false;

        // Check episodes for incorrect duration
        if (anime.episodes && anime.episodes.length > 0) {
            for (const episode of anime.episodes) {
                if (episode.duration && episode.duration < MOVIE_DURATION) {
                    console.log(`  📍 ${slug}: episode ${episode.number} duration ${episode.duration}s -> ${MOVIE_DURATION}s`);
                    episode.duration = MOVIE_DURATION;
                    needsUpdate = true;
                }
            }

            // Recalculate totalWatchTime
            if (needsUpdate) {
                const newTotal = anime.episodes.reduce((sum, ep) => sum + (ep.duration || MOVIE_DURATION), 0);
                if (anime.totalWatchTime !== newTotal) {
                    console.log(`  ⏱️  ${slug}: totalWatchTime ${anime.totalWatchTime}s -> ${newTotal}s`);
                    anime.totalWatchTime = newTotal;
                }
                fixedCount++;
            }
        }
    }

    console.log(`\n📊 Found ${moviesFound.length} movies in data:`);
    moviesFound.forEach(m => console.log(`   - ${m}`));

    if (fixedCount > 0) {
        // Save updated data
        await chrome.storage.local.set({ animeData });
        console.log(`\n✅ Fixed ${fixedCount} movie entries!`);
        console.log('🔄 Refresh the popup to see changes.');
    } else {
        console.log('\n✨ All movies already have correct duration!');
    }

    return { moviesFound, fixedCount };
}

// Run the fix
fixMovieData().then(result => {
    console.log('\n🎬 Movie fix complete!', result);
}).catch(err => {
    console.error('❌ Error fixing movies:', err);
});
