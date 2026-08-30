window.NexusExt = window.NexusExt || {};

(function () {
  'use strict';

  /* A .wabbajack file is a ZIP whose "modlist" entry is a JSON manifest of every archive the list
     needs. The userscript this is ported from pulled zip.js off a CDN, which a Manifest V3 extension
     cannot do — remote code is blocked outright. Reading the one small entry we care about out of a
     ZIP is a couple of hundred lines, and the repo already contains the mirror image of this logic in
     tools/build-zip.mjs, so it carries no dependency and nothing to keep patched. */

  const SIG_EOCD = 0x06054b50;
  const SIG_EOCD64_LOCATOR = 0x07064b50;
  const SIG_EOCD64 = 0x06064b50;
  const SIG_CENTRAL = 0x02014b50;
  const SIG_LOCAL = 0x04034b50;

  const MAX_COMMENT_BYTES = 0xffff;
  const EOCD_MIN_BYTES = 22;
  const U32_MAX = 0xffffffff;
  const U16_MAX = 0xffff;

  /* The manifest is JSON and stays well under this even for very large lists; the cap is here so a
     malformed or hostile archive cannot claim a multi-gigabyte entry and exhaust the tab. */
  const MAX_MODLIST_BYTES = 64 * 1024 * 1024;

  class WabbajackError extends Error {
    constructor(code, message) {
      super(message || code);
      this.code = code;
    }
  }

  async function readSlice(file, start, end) {
    const from = Math.max(0, start);
    const to = Math.min(file.size, end);
    if (to <= from) return new DataView(new ArrayBuffer(0));
    return new DataView(await file.slice(from, to).arrayBuffer());
  }

  function findEocdOffset(view) {
    /* The end-of-central-directory record sits at the very end unless the archive carries a comment,
       so scan backwards for its signature rather than assuming a fixed offset. */
    for (let offset = view.byteLength - EOCD_MIN_BYTES; offset >= 0; offset -= 1) {
      if (view.getUint32(offset, true) === SIG_EOCD) return offset;
    }
    return -1;
  }

  async function readCentralDirectoryLocation(file) {
    const tailBytes = Math.min(file.size, MAX_COMMENT_BYTES + EOCD_MIN_BYTES);
    const tail = await readSlice(file, file.size - tailBytes, file.size);
    const eocd = findEocdOffset(tail);
    if (eocd === -1) throw new WabbajackError('not-a-zip', 'No ZIP end-of-central-directory record found.');

    let entries = tail.getUint16(eocd + 10, true);
    let size = tail.getUint32(eocd + 12, true);
    let offset = tail.getUint32(eocd + 16, true);

    /* Real modlists routinely exceed 4 GB, at which point the 32-bit fields above are saturated and
       the true values live in a ZIP64 record found through its own locator. */
    if (offset === U32_MAX || size === U32_MAX || entries === U16_MAX) {
      const tailStart = file.size - tailBytes;
      let locator = -1;
      for (let at = eocd - 20; at >= 0; at -= 1) {
        if (tail.getUint32(at, true) === SIG_EOCD64_LOCATOR) { locator = at; break; }
      }
      if (locator === -1) throw new WabbajackError('zip64-missing', 'ZIP64 archive with no ZIP64 locator.');
      const eocd64Offset = Number(tail.getBigUint64(locator + 8, true));
      const eocd64 = await readSlice(file, eocd64Offset, eocd64Offset + 56);
      if (eocd64.byteLength < 56 || eocd64.getUint32(0, true) !== SIG_EOCD64) {
        throw new WabbajackError('zip64-missing', 'ZIP64 end-of-central-directory record is unreadable.');
      }
      entries = Number(eocd64.getBigUint64(32, true));
      size = Number(eocd64.getBigUint64(40, true));
      offset = Number(eocd64.getBigUint64(48, true));
      void tailStart;
    }

    return { entries, size, offset };
  }

  function readZip64Extra(view, start, length, needs) {
    /* Each saturated 32-bit field is replaced, in order, by a 64-bit value inside the 0x0001 extra
       field — so which values are present depends on which fields were saturated. */
    let at = start;
    const end = start + length;
    while (at + 4 <= end) {
      const headerId = view.getUint16(at, true);
      const dataSize = view.getUint16(at + 2, true);
      if (headerId === 0x0001) {
        let cursor = at + 4;
        const out = {};
        for (const field of needs) {
          if (cursor + 8 > at + 4 + dataSize) break;
          out[field] = Number(view.getBigUint64(cursor, true));
          cursor += 8;
        }
        return out;
      }
      at += 4 + dataSize;
    }
    return {};
  }

  async function findCentralEntry(file, wantedName) {
    const { size, offset } = await readCentralDirectoryLocation(file);
    const central = await readSlice(file, offset, offset + size);
    const decoder = new TextDecoder();

    let at = 0;
    while (at + 46 <= central.byteLength) {
      if (central.getUint32(at, true) !== SIG_CENTRAL) break;

      const method = central.getUint16(at + 10, true);
      let compressedSize = central.getUint32(at + 20, true);
      let uncompressedSize = central.getUint32(at + 24, true);
      const nameLength = central.getUint16(at + 28, true);
      const extraLength = central.getUint16(at + 30, true);
      const commentLength = central.getUint16(at + 32, true);
      let localOffset = central.getUint32(at + 42, true);

      const name = decoder.decode(new Uint8Array(central.buffer, central.byteOffset + at + 46, nameLength));

      if (name === wantedName) {
        const needs = [];
        if (uncompressedSize === U32_MAX) needs.push('uncompressedSize');
        if (compressedSize === U32_MAX) needs.push('compressedSize');
        if (localOffset === U32_MAX) needs.push('localOffset');
        if (needs.length) {
          const wide = readZip64Extra(central, at + 46 + nameLength, extraLength, needs);
          if (wide.uncompressedSize !== undefined) uncompressedSize = wide.uncompressedSize;
          if (wide.compressedSize !== undefined) compressedSize = wide.compressedSize;
          if (wide.localOffset !== undefined) localOffset = wide.localOffset;
        }
        return { method, compressedSize, uncompressedSize, localOffset };
      }

      at += 46 + nameLength + extraLength + commentLength;
    }
    return null;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new WabbajackError('no-inflate', 'This browser cannot decompress the modlist.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readZipEntry(file, wantedName) {
    const entry = await findCentralEntry(file, wantedName);
    if (!entry) return null;
    if (entry.uncompressedSize > MAX_MODLIST_BYTES) {
      throw new WabbajackError('entry-too-large', 'The modlist inside this file is implausibly large.');
    }
    if (entry.method !== 0 && entry.method !== 8) {
      throw new WabbajackError('unsupported-compression', `Unsupported ZIP compression method ${entry.method}.`);
    }

    /* The central directory records the name and extra-field lengths the *local* header uses, and the
       two are allowed to differ, so the data offset has to come from the local header itself. */
    const local = await readSlice(file, entry.localOffset, entry.localOffset + 30);
    if (local.byteLength < 30 || local.getUint32(0, true) !== SIG_LOCAL) {
      throw new WabbajackError('bad-entry', 'The modlist entry has no valid local header.');
    }
    const dataStart = entry.localOffset + 30
      + local.getUint16(26, true)
      + local.getUint16(28, true);

    const raw = await readSlice(file, dataStart, dataStart + entry.compressedSize);
    const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    return entry.method === 0 ? bytes : inflateRaw(bytes);
  }

  /* Wabbajack's own game registry, keyed by the GameName the manifest carries:
     https://github.com/wabbajack-tools/wabbajack/blob/main/Wabbajack.DTOs/Game/GameRegistry.cs
     It is only a fast path — anything missing is resolved from the mod page at download time, so a
     list for a game added after this snapshot still works. Entries Nexus does not host are null. */
  /* Wabbajack's own game registry, keyed by the GameName its manifest carries:
     https://github.com/wabbajack-tools/wabbajack/blob/main/Wabbajack.DTOs/Game/GameRegistry.cs
     Both halves are needed: the numeric id goes to the download endpoint, and the domain builds the
     mod page URL the queue validates. The domain cannot be guessed from the Wabbajack name —
     FalloutNewVegas lives at /newvegas — so a game missing here is reported rather than guessed at.
     Entries Nexus does not host are null. */
  const GAMES = Object.freeze({
    Morrowind: { domain: 'morrowind', id: 100 },
    Oblivion: { domain: 'oblivion', id: 101 },
    OblivionRemastered: { domain: 'oblivionremastered', id: 7587 },
    Fallout3: { domain: 'fallout3', id: 120 },
    FalloutNewVegas: { domain: 'newvegas', id: 130 },
    Skyrim: { domain: 'skyrim', id: 110 },
    SkyrimSpecialEdition: { domain: 'skyrimspecialedition', id: 1704 },
    Fallout4: { domain: 'fallout4', id: 1151 },
    SkyrimVR: { domain: 'skyrimspecialedition', id: 1704 },
    Enderal: { domain: 'enderal', id: 2736 },
    EnderalSpecialEdition: { domain: 'enderalspecialedition', id: 3685 },
    Fallout4VR: { domain: 'fallout4', id: 1151 },
    DarkestDungeon: { domain: 'darkestdungeon', id: 804 },
    Dishonored: { domain: 'dishonored', id: 802 },
    Witcher: { domain: 'witcher', id: 150 },
    Witcher3: { domain: 'witcher3', id: 952 },
    StardewValley: { domain: 'stardewvalley', id: 1303 },
    KingdomComeDeliverance: { domain: 'kingdomcomedeliverance', id: 2298 },
    MechWarrior5Mercenaries: { domain: 'mechwarrior5mercenaries', id: 3099 },
    NoMansSky: { domain: 'nomanssky', id: 1634 },
    DragonAgeOrigins: { domain: 'dragonage', id: 140 },
    DragonAge2: { domain: 'dragonage2', id: 141 },
    DragonAgeInquisition: { domain: 'dragonageinquisition', id: 728 },
    KerbalSpaceProgram: { domain: 'kerbalspaceprogram', id: 272 },
    Terraria: null,
    Cyberpunk2077: { domain: 'cyberpunk2077', id: 3333 },
    Sims4: { domain: 'thesims4', id: 641 },
    DragonsDogma: { domain: 'dragonsdogma', id: 1249 },
    KarrynsPrison: null,
    Valheim: { domain: 'valheim', id: 3667 },
    MountAndBlade2Bannerlord: { domain: 'mountandblade2bannerlord', id: 3174 },
    FinalFantasy7Remake: { domain: 'finalfantasy7remake', id: 4202 },
    BaldursGate3: { domain: 'baldursgate3', id: 3474 },
    Starfield: { domain: 'starfield', id: 4187 },
    SevenDaysToDie: { domain: '7daystodie', id: 1059 },
    ModdingTools: { domain: 'site', id: 2295 }
  });

  const GAME_IDS = Object.freeze(Object.fromEntries(
    Object.entries(GAMES).map(([name, game]) => [name, game ? game.id : null])
  ));

  const NEXUS_STATE_TYPES = /NexusDownloader\+State|NexusDownloader, Wabbajack/i;

  function isNexusArchive(archive) {
    const state = archive?.State;
    if (!state || typeof state !== 'object') return false;
    if (NEXUS_STATE_TYPES.test(String(state.$type || ''))) return true;
    /* Older manifests spell the discriminator differently; the field shape is the reliable signal. */
    return state.GameName !== undefined && state.ModID !== undefined && state.FileID !== undefined;
  }

  function toPositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
  }

  /* Every archive is accounted for: usable ones become items, the rest are named with a reason so the
     user can see what a list needs that the extension cannot fetch, instead of silently getting a
     shorter queue than the modlist. */
  function collectNexusArchives(modlist) {
    const archives = Array.isArray(modlist?.Archives) ? modlist.Archives : [];
    const items = [];
    const skipped = [];
    const skip = (name, reason) => skipped.push({ name: name || '(unnamed archive)', reason });

    for (const archive of archives) {
      const name = String(archive?.Name || '').trim();
      if (!isNexusArchive(archive)) {
        skip(name, 'not-on-nexus');
        continue;
      }
      const state = archive.State;
      const modId = toPositiveInteger(state.ModID);
      const fileId = toPositiveInteger(state.FileID);
      const gameName = String(state.GameName || '').trim();
      if (!modId || !fileId || !gameName) {
        skip(name, 'incomplete-entry');
        continue;
      }

      /* The domain cannot be derived from the Wabbajack name, so an unrecognised game is reported
         rather than guessed — a wrong domain would just 404 for every file of that game. */
      const game = GAMES[gameName];
      if (!game) {
        skip(name, `unknown-game:${gameName}`);
        continue;
      }

      const sizeBytes = Number(archive.Size);
      items.push({
        gameName,
        gameDomain: game.domain,
        gameId: game.id,
        modId,
        fileId,
        name: name || `${gameName} ${modId}/${fileId}`,
        modName: String(state.Name || '').trim(),
        sizeKb: Number.isFinite(sizeBytes) && sizeBytes > 0 ? Math.round(sizeBytes / 1024) : 0
      });
    }

    return { items, skipped };
  }

  /* The exact shape the collection GraphQL query produces, so a modlist can be handed to the existing
     queue untouched — which means its pacing, rate-limit backoff, download history, resume and both
     the Vortex and browser paths all apply with no queue changes at all. */
  function toCollectionMods(list) {
    const items = Array.isArray(list?.items) ? list.items : [];
    return items.map((item) => ({
      fileId: item.fileId,
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

  async function readModlist(file) {
    if (!file || typeof file.slice !== 'function') {
      throw new WabbajackError('no-file', 'No .wabbajack file was provided.');
    }
    const bytes = await readZipEntry(file, 'modlist');
    if (!bytes) throw new WabbajackError('no-modlist', 'This file has no "modlist" entry — is it a .wabbajack?');

    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch (cause) {
      throw new WabbajackError('bad-modlist', `The modlist is not valid JSON — ${cause.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.Archives)) {
      throw new WabbajackError('bad-modlist', 'The modlist has no Archives list.');
    }

    const { items, skipped } = collectNexusArchives(parsed);
    return {
      name: String(parsed.Name || '').trim(),
      author: String(parsed.Author || '').trim(),
      version: String(parsed.Version || '').trim(),
      gameName: String(parsed.GameType || '').trim(),
      items,
      skipped,
      total: parsed.Archives.length
    };
  }

  window.NexusExt.Wabbajack = {
    GAMES,
    GAME_IDS,
    WabbajackError,
    readModlist,
    collectNexusArchives,
    toCollectionMods,
    readZipEntry
  };
})();
