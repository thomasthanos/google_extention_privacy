/* Exercises the .wabbajack reader against real ZIP bytes. The reader replaces a CDN-loaded zip.js
   that Manifest V3 cannot use, so the ZIP parsing is ours and has to be covered: a bad offset here
   means the modlist silently fails to open. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const zlib = require('node:zlib');

const context = vm.createContext({
  window: {}, console, Blob, Response, DecompressionStream, TextDecoder, TextEncoder,
  DataView, Uint8Array, ArrayBuffer, Number, Math, JSON, Object, Array, String, Error, RegExp, Promise, URL
});
vm.runInContext(fs.readFileSync('src/content/wabbajack.js', 'utf8'), context, {
  filename: 'src/content/wabbajack.js'
});
const WJ = context.window.NexusExt.Wabbajack;

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let v = i;
    for (let b = 0; b < 8; b += 1) v = v & 1 ? 0xEDB88320 ^ (v >>> 1) : v >>> 1;
    table[i] = v >>> 0;
  }
  return (buf) => {
    let crc = 0xFFFFFFFF;
    for (const byte of buf) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };
})();

/* Builds a real archive rather than a hand-rolled fixture, so the reader is walking the same
   structures a Wabbajack file has: local headers, a central directory and an EOCD. */
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data, store = false } of entries) {
    const raw = Buffer.from(data);
    const body = store ? raw : zlib.deflateRawSync(raw);
    const method = store ? 0 : 8;
    const nameBytes = Buffer.from(name, 'utf8');
    /* Real writers put an extra field in the LOCAL header that the central directory does not repeat
       — .NET's zip writer emits an NTFS timestamp block, for one. The data offset therefore has to
       come from the local header's own lengths, and a fixture with empty extras would never catch a
       reader that ignored them. */
    const extra = Buffer.alloc(9);
    extra.writeUInt16LE(0x5455, 0);
    extra.writeUInt16LE(5, 2);
    extra.writeUInt8(0x03, 4);
    extra.writeUInt32LE(0x5F000000, 5);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(CRC(raw), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(extra.length, 28);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014B50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt32LE(CRC(raw), 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt32LE(offset, 42);

    chunks.push(local, nameBytes, extra, body);
    central.push(dir, nameBytes);
    offset += local.length + nameBytes.length + extra.length + body.length;
  }

  const centralBuffer = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054B50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return new Blob([Buffer.concat([...chunks, centralBuffer, eocd])]);
}

const MODLIST = {
  Name: 'Test List',
  Author: 'Someone',
  Version: '1.2.3',
  GameType: 'SkyrimSpecialEdition',
  Archives: [
    {
      Name: 'CoolMod.7z',
      Size: 5 * 1024 * 1024,
      State: {
        $type: 'NexusDownloader+State, Wabbajack.Lib',
        GameName: 'SkyrimSpecialEdition',
        ModID: 266,
        FileID: 1000,
        Name: 'Cool Mod'
      }
    },
    {
      // A game newer than the bundled registry: the id must come back null, not wrong.
      Name: 'RemasterMod.zip',
      Size: 2048,
      State: { $type: 'NexusDownloader+State', GameName: 'OblivionRemastered', ModID: 5, FileID: 6 }
    },
    {
      // Not hosted on Nexus — must be reported as skipped, never queued.
      Name: 'FromGoogleDrive.7z',
      Size: 999,
      State: { $type: 'GoogleDriveDownloader+State, Wabbajack.Lib', Id: 'abc' }
    },
    {
      // Nexus-shaped but unusable: no queue item, and it must not throw.
      Name: 'Broken.7z',
      Size: 10,
      State: { $type: 'NexusDownloader+State', GameName: 'Skyrim', ModID: 0, FileID: 7 }
    }
  ]
};

(async () => {
  for (const store of [false, true]) {
    const zip = buildZip([
      { name: 'meta', data: 'ignored' },
      { name: 'modlist', data: JSON.stringify(MODLIST), store },
      { name: 'image.png', data: 'x'.repeat(500) }
    ]);
    const label = store ? 'stored' : 'deflated';

    const list = await WJ.readModlist(zip);
    assert.equal(list.name, 'Test List', `${label}: manifest name`);
    assert.equal(list.author, 'Someone', `${label}: manifest author`);
    assert.equal(list.gameName, 'SkyrimSpecialEdition', `${label}: manifest game`);
    assert.equal(list.total, 4, `${label}: every archive is counted`);
    assert.equal(list.items.length, 2, `${label}: only usable Nexus archives are queued`);

    const [first, second] = list.items;
    assert.equal(first.modId, 266);
    assert.equal(first.fileId, 1000);
    assert.equal(first.gameId, 1704, `${label}: known game resolves from the registry`);
    assert.equal(first.sizeKb, 5120, `${label}: size is converted to KB`);
    assert.equal(first.modName, 'Cool Mod');

    assert.equal(second.gameName, 'OblivionRemastered');
    assert.equal(second.gameId, 7587, `${label}: registry covers Oblivion Remastered`);
    assert.equal(second.gameDomain, 'oblivionremastered');

    /* Spread into a host array first: values built inside the vm realm carry that realm's
       Array.prototype, which deepStrictEqual compares and would reject. */
    const skipped = [...list.skipped].map((entry) => `${entry.name}:${entry.reason}`).sort();
    assert.deepEqual(
      skipped,
      ['Broken.7z:incomplete-entry', 'FromGoogleDrive.7z:not-on-nexus'],
      `${label}: unusable archives are named with a reason, not silently dropped`
    );

    /* The queue is fed straight from this, so the shape has to match what the collection GraphQL
       query returns field for field — a mismatch here fails at download time, not at import. */
    const mods = WJ.toCollectionMods(list);
    assert.equal(mods.length, 2, `${label}: one queue entry per usable archive`);
    const [queued] = mods;
    assert.equal(queued.fileId, 1000);
    assert.equal(queued.file.size, 5120, `${label}: the queue reads file.size as KB`);
    assert.equal(queued.file.mod.game.id, 1704);
    assert.equal(queued.file.mod.game.domainName, 'skyrimspecialedition');
    assert.equal(queued.file.mod.modId, 266);
    assert.equal(queued.optional, false);

    /* background.js sanitizeNdcJobItem rejects any pageUrl whose pathname is not /<game>/mods/<id>,
       so the URL this builds has to satisfy that exactly. */
    const parsed = new URL(queued.file.url);
    assert.equal(parsed.protocol, 'https:');
    assert.equal(parsed.hostname, 'www.nexusmods.com');
    assert.match(parsed.pathname, /^\/[^/]+\/mods\/\d+$/, `${label}: pageUrl passes the worker's check`);
    assert.equal(parsed.searchParams.get('file_id'), '1000');
  }

  /* A game the registry has never heard of must be reported, not guessed at: the mod page URL needs
     the Nexus domain, and that cannot be derived from the Wabbajack name. */
  const unknown = WJ.collectNexusArchives({
    Archives: [{
      Name: 'X.7z', Size: 1024,
      State: { $type: 'NexusDownloader+State', GameName: 'SomeGameShippedNextYear', ModID: 1, FileID: 2 }
    }]
  });
  assert.equal(unknown.items.length, 0, 'an unknown game is never queued with a guessed domain');
  assert.equal(unknown.skipped[0].reason, 'unknown-game:SomeGameShippedNextYear');

  // The domain genuinely cannot be inferred: New Vegas is /newvegas, not /falloutnewvegas.
  assert.equal(WJ.GAMES.FalloutNewVegas.domain, 'newvegas');
  assert.equal(WJ.GAMES.SkyrimSpecialEdition.domain, 'skyrimspecialedition');

  // Games Nexus does not host are recorded as null in the registry rather than omitted.
  assert.equal(WJ.GAMES.Terraria, null);
  assert.equal(WJ.GAME_IDS.Terraria, null);
  assert.equal(WJ.GAME_IDS.SkyrimSpecialEdition, 1704);

  await assert.rejects(
    () => WJ.readModlist(buildZip([{ name: 'meta', data: 'no modlist here' }])),
    (error) => error.code === 'no-modlist',
    'an archive without a modlist entry is reported clearly'
  );

  await assert.rejects(
    () => WJ.readModlist(new Blob(['definitely not a zip'])),
    (error) => error.code === 'not-a-zip',
    'a non-ZIP file is reported clearly'
  );

  await assert.rejects(
    () => WJ.readModlist(buildZip([{ name: 'modlist', data: '{ not json' }])),
    (error) => error.code === 'bad-modlist',
    'a corrupt manifest is reported clearly'
  );

  await assert.rejects(() => WJ.readModlist(null), (error) => error.code === 'no-file');

  console.log('wabbajack modlist reader OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
