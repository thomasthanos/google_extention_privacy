// Local viewer for the share card — reads the PNG the popup stashed in storage
// and shows it full size. Stable chrome-extension:// URL; no server, no blob link.
(async () => {
    const KEY = '_shareCardView';
    let data = null;
    const store = chrome.storage.session || chrome.storage.local;
    try {
        const s = await store.get([KEY]);
        data = s[KEY];
        store.remove([KEY]).catch(() => {});   // one-shot
    } catch { /* ignore */ }

    const img = document.getElementById('card');
    const actions = document.getElementById('actions');
    const empty = document.getElementById('empty');

    if (!data || !data.dataUrl) {
        empty.hidden = false;
        return;
    }

    img.src = data.dataUrl;
    img.hidden = false;
    actions.hidden = false;
    document.title = 'Anime Tracker — ' + (data.fileName || 'Share Card');

    const save = document.getElementById('save');
    save.href = data.dataUrl;
    save.download = data.fileName || 'anime-tracker.png';

    document.getElementById('copy').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const orig = btn.textContent;
        try {
            const blob = await (await fetch(data.dataUrl)).blob();
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            btn.textContent = '✓ Copied';
        } catch {
            btn.textContent = 'Copy failed';
        }
        setTimeout(() => { btn.textContent = orig; }, 1500);
    });
})();
