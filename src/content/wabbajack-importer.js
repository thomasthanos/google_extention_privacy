(function () {
  'use strict';

  const NXTK = window.NexusExt = window.NexusExt || {};
  const MAX_MODLIST_BYTES = 64 * 1024 * 1024;
  const MAX_ARCHIVE_ENTRIES = 10000;

  class WabbajackImportError extends Error {
    constructor(code, message, cause = null) {
      super(message || code);
      this.name = 'WabbajackImportError';
      this.code = code;
      if (cause) this.cause = cause;
    }
  }

  const game = (domain, id) => Object.freeze({ domain, id });

  // Keep this mapping aligned with Wabbajack's current game registry.
  const GAMES = Object.freeze({
    Morrowind: game('morrowind', 100),
    Oblivion: game('oblivion', 101),
    Fallout3: game('fallout3', 120),
    FalloutNewVegas: game('newvegas', 130),
    Skyrim: game('skyrim', 110),
    Enderal: game('enderal', 2736),
    SkyrimSpecialEdition: game('skyrimspecialedition', 1704),
    Fallout4: game('fallout4', 1151),
    SkyrimVR: game('skyrimspecialedition', 1704),
    Fallout4VR: game('fallout4', 1151),
    DarkestDungeon: game('darkestdungeon', 804),
    Dishonored: game('dishonored', 802),
    Witcher: game('witcher', 150),
    Witcher3: game('witcher3', 952),
    StardewValley: game('stardewvalley', 1303),
    KingdomComeDeliverance: game('kingdomcomedeliverance', 2298),
    MechWarrior5Mercenaries: game('mechwarrior5mercenaries', 3099),
    NoMansSky: game('nomanssky', 1634),
    DragonAgeOrigins: game('dragonage', 140),
    DragonAge2: game('dragonage2', 141),
    DragonAgeInquisition: game('dragonageinquisition', 728),
    KerbalSpaceProgram: game('kerbalspaceprogram', 272),
    EnderalSpecialEdition: game('enderalspecialedition', 3685),
    Terraria: game('terraria', 549),
    Cyberpunk2077: game('cyberpunk2077', 3333),
    Sims4: game('thesims4', 641),
    DragonsDogma: game('dragonsdogma', 1249),
    KarrynsPrison: null,
    MountAndBlade2Bannerlord: game('mountandblade2bannerlord', 3174),
    Valheim: game('valheim', 3667),
    ModdingTools: game('site', 2295),
    FinalFantasy7Remake: game('finalfantasy7remake', 4202),
    BaldursGate3: game('baldursgate3', 3474),
    Starfield: game('starfield', 4187),
    Stalker2: game('stalker2heartofchornobyl', 6944),
    SevenDaysToDie: game('7daystodie', 1059),
    OblivionRemastered: game('oblivionremastered', 7587),
    Fallout76: game('fallout76', 2590),
    Fallout4London: game('fallout4london', 6332),
    Warhammer40kDarktide: game('warhammer40kdarktide', 4943),
    Kotor2: game('kotor2', 198),
    VtMB: game('vampirebloodlines', 437),
    KingdomComeDeliverance2: game('kingdomcomedeliverance2', 7286),
    DragonsDogma2: game('dragonsdogma2', 6234),
    NieRAutomata: game('nierautomata', 1950)
  });

  const GAME_IDS = Object.freeze(Object.fromEntries(
    Object.entries(GAMES).map(([name, metadata]) => [name, metadata?.id ?? null])
  ));

  const NEXUS_STATE_TYPE = /(?:^|\.)NexusDownloader(?:\+State)?$/i;

  function cleanText(value, maxLength = 300) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  function positiveInteger(value) {
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) && value > 0 && value < 1e12 ? value : null;
    }
    if (typeof value !== 'string' || !/^\d{1,12}$/.test(value)) return null;
    const number = Number(value);
    return number > 0 && number < 1e12 ? number : null;
  }

  function isNexusArchive(archive) {
    const state = archive?.State;
    if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
    const type = cleanText(state.$type, 200);
    // Duck typing is reserved for old manifests that have no declared downloader.
    if (type) return NEXUS_STATE_TYPE.test(type.split(',', 1)[0].trim());
    return state.GameName !== undefined && state.ModID !== undefined && state.FileID !== undefined;
  }

  function analyzeManifest(manifest) {
    const archives = Array.isArray(manifest?.Archives) ? manifest.Archives : [];
    const items = [];
    const skipped = [];
    const seen = new Set();
    const skip = (name, reason) => skipped.push({ name: name || '(unnamed archive)', reason });

    for (const archive of archives) {
      const name = cleanText(archive?.Name);
      if (!isNexusArchive(archive)) {
        skip(name, 'not-on-nexus');
        continue;
      }

      const state = archive.State;
      const modId = positiveInteger(state.ModID);
      const fileId = positiveInteger(state.FileID);
      const gameName = cleanText(state.GameName, 100);
      if (!modId || !fileId || !gameName) {
        skip(name, 'incomplete-entry');
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(GAMES, gameName)) {
        skip(name, `unknown-game:${gameName}`);
        continue;
      }

      const metadata = GAMES[gameName];
      if (!metadata) {
        skip(name, `unsupported-game:${gameName}`);
        continue;
      }

      // File IDs can repeat across Nexus games, so both values form the identity.
      const identity = `${metadata.id}:${fileId}`;
      if (seen.has(identity)) {
        skip(name, 'duplicate-entry');
        continue;
      }
      seen.add(identity);

      const sizeBytes = Number(archive.Size);
      items.push({
        gameName,
        gameDomain: metadata.domain,
        gameId: metadata.id,
        modId,
        fileId,
        name: name || `${gameName} ${modId}/${fileId}`,
        modName: cleanText(state.Name),
        sizeKb: Number.isFinite(sizeBytes) && sizeBytes > 0
          ? Math.min(Math.round(sizeBytes / 1024), Number.MAX_SAFE_INTEGER)
          : 0
      });
    }

    return { items, skipped, total: archives.length };
  }

  function parseManifest(bytes) {
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (cause) {
      throw new WabbajackImportError('bad-encoding', 'The modlist is not valid UTF-8.', cause);
    }

    let manifest;
    try {
      manifest = JSON.parse(text);
    } catch (cause) {
      throw new WabbajackImportError('bad-modlist', `The modlist is not valid JSON — ${cause.message}`, cause);
    }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || !Array.isArray(manifest.Archives)) {
      throw new WabbajackImportError('bad-modlist', 'The modlist has no Archives list.');
    }
    if (manifest.Archives.length > MAX_ARCHIVE_ENTRIES) {
      throw new WabbajackImportError('too-many-entries', 'The modlist contains too many archive entries.');
    }
    return manifest;
  }

  async function importFile(file) {
    if (!file || typeof file.slice !== 'function') {
      throw new WabbajackImportError('no-file', 'No .wabbajack file was provided.');
    }
    if (!NXTK.ZipReader?.readEntry) {
      throw new WabbajackImportError('reader-unavailable', 'The ZIP reader is unavailable.');
    }

    let bytes;
    try {
      bytes = await NXTK.ZipReader.readEntry(file, 'modlist', { maxBytes: MAX_MODLIST_BYTES });
    } catch (cause) {
      if (cause instanceof NXTK.ZipReader.ZipReaderError) {
        throw new WabbajackImportError(cause.code, cause.message, cause);
      }
      throw cause;
    }
    if (!bytes) {
      throw new WabbajackImportError('no-modlist', 'This file has no "modlist" entry — is it a .wabbajack?');
    }

    const manifest = parseManifest(bytes);
    const analyzed = analyzeManifest(manifest);
    return {
      name: cleanText(manifest.Name),
      author: cleanText(manifest.Author),
      version: cleanText(manifest.Version, 100),
      gameName: cleanText(manifest.GameType, 100),
      ...analyzed
    };
  }

  function toQueueMods(result) {
    const items = Array.isArray(result?.items) ? result.items : [];
    return items.map((item) => ({
      fileId: item.fileId,
      historyId: `${item.gameId}:${item.fileId}`,
      optional: false,
      file: {
        fileId: item.fileId,
        name: item.name,
        size: item.sizeKb,
        url: `https://www.nexusmods.com/${item.gameDomain}/mods/${item.modId}?tab=files&file_id=${item.fileId}`,
        mod: {
          name: item.modName || item.name,
          modId: item.modId,
          game: { domainName: item.gameDomain, id: item.gameId }
        }
      }
    }));
  }

  NXTK.WabbajackImporter = Object.freeze({
    GAMES,
    GAME_IDS,
    WabbajackImportError,
    analyzeManifest,
    importFile,
    toQueueMods
  });
})();
