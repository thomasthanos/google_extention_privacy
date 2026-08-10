#!/usr/bin/env node
/* Release packager: node tools/build-zip.mjs

   Builds dist/nexus.mods.bypass-<version>.zip from an explicit ALLOWLIST. The old
   hand-rolled zip shipped docs/store-listing.md, README.md and PRIVACY.md inside the
   package — none referenced by the manifest, and the listing notes were internal. An
   allowlist cannot leak a file nobody remembered was there; a "zip everything except"
   rule already proved it can.

   No zip binary exists in this environment and PowerShell's Compress-Archive writes
   backslash separators into nested entry names, so the archive is written here: raw
   deflate via node:zlib plus the ZIP container by hand. ~50 files at ~1 MB, so no
   ZIP64. Output is byte-identical across runs of an unchanged tree (fixed DOS
   timestamp, stable order), which makes "did the package actually change?" answerable
   with a checksum. */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Every root the package may draw from, with the extensions allowed inside it.
   Adding a file type to the extension means adding it here on purpose. */
const ALLOWLIST = [
  { path: 'manifest.json' },
  { path: 'background.js' },
  { path: 'shared.js' },
  { path: 'content', ext: ['.js', '.css'] },
  { path: 'popup', ext: ['.js', '.css', '.html'] },
  { path: 'onboarding', ext: ['.js', '.css', '.html'] },
  { path: 'icons', ext: ['.png'] },
  { path: '_locales', ext: ['.json'] }
];

/* Belt to the allowlist's braces. These are the paths that actually went wrong before,
   so a future edit to ALLOWLIST that re-admits one fails the build instead of shipping. */
const FORBIDDEN = [
  /^tools\//, /^store-assets\//, /^promo\//, /^docs\//, /^dist\//, /^\.claude\//,
  /\.md$/i, /\.zip$/i, /\.aep$/i, /\.mp4$/i, /(^|\/)\.[^/]/
];

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};

/* ---------- gate: strings must be sound before anything is packaged ---------- */

const locales = spawnSync(process.execPath, [join(root, 'tools', 'check-locales.mjs')], {
  cwd: root,
  stdio: 'inherit'
});
if (locales.status !== 0) fail('check-locales.mjs did not pass — package not built.');

/* ---------- collect ---------- */

function walk(absolute, prefix, allowedExt) {
  const found = [];
  for (const name of readdirSync(absolute).sort()) {
    const child = join(absolute, name);
    const entryName = prefix ? `${prefix}/${name}` : name;
    if (statSync(child).isDirectory()) {
      found.push(...walk(child, entryName, allowedExt));
    } else if (!allowedExt || allowedExt.includes(extname(name).toLowerCase())) {
      found.push(entryName);
    }
  }
  return found;
}

const entryNames = [];
for (const rule of ALLOWLIST) {
  const absolute = join(root, rule.path);
  if (!existsSync(absolute)) fail(`allowlisted path is missing: ${rule.path}`);
  if (statSync(absolute).isDirectory()) {
    entryNames.push(...walk(absolute, rule.path, rule.ext));
  } else {
    entryNames.push(rule.path);
  }
}
entryNames.sort();

for (const name of entryNames) {
  const hit = FORBIDDEN.find((pattern) => pattern.test(name));
  if (hit) fail(`${name} matched a forbidden pattern (${hit}) — check ALLOWLIST.`);
  // Non-ASCII names need the UTF-8 flag and a matching reader; keep the package boring.
  if (!/^[\x20-\x7E]+$/.test(name)) fail(`entry name is not plain ASCII: ${name}`);
}

/* ---------- validate against the manifest ---------- */

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
} catch (cause) {
  fail(`manifest.json is not valid JSON — ${cause.message}`);
}

const version = String(manifest.version || '');
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`manifest version is not x.y.z: "${version}"`);

for (const name of entryNames.filter((n) => n.startsWith('_locales/'))) {
  try {
    JSON.parse(readFileSync(join(root, name), 'utf8'));
  } catch (cause) {
    fail(`${name} is not valid JSON — ${cause.message}`);
  }
}

/* Catches the classic broken upload: the manifest points at a file the package does
   not carry, which Chrome only complains about after it is live. */
const referenced = new Set();
for (const script of manifest.content_scripts || []) {
  for (const file of [...(script.js || []), ...(script.css || [])]) referenced.add(file);
}
if (manifest.background?.service_worker) referenced.add(manifest.background.service_worker);
if (manifest.action?.default_popup) referenced.add(manifest.action.default_popup);
for (const icons of [manifest.icons, manifest.action?.default_icon]) {
  for (const path of Object.values(icons || {})) referenced.add(path);
}

const packaged = new Set(entryNames);
const missing = [...referenced].filter((file) => !packaged.has(file));
if (missing.length) fail(`manifest references files the package does not include:\n  ${missing.join('\n  ')}`);

/* ---------- write the archive ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 1980-01-01 00:00:00, the earliest representable DOS timestamp. Fixed so the
// archive depends on file contents alone, never on when the build ran.
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

const chunks = [];
const directory = [];
let offset = 0;

for (const name of entryNames) {
  const raw = readFileSync(join(root, name));
  const deflated = deflateRawSync(raw, { level: 9 });
  // Storing beats deflating on already-compressed payloads such as PNG icons.
  const useDeflate = deflated.length < raw.length;
  const body = useDeflate ? deflated : raw;
  const method = useDeflate ? 8 : 0;
  const nameBytes = Buffer.from(name, 'ascii');

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034B50, 0);
  local.writeUInt16LE(20, 4);            // version needed
  local.writeUInt16LE(0, 6);             // flags
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc32(raw), 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);            // extra field length

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014B50, 0);
  central.writeUInt16LE(20, 4);          // version made by
  central.writeUInt16LE(20, 6);          // version needed
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc32(raw), 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt16LE(0, 30);          // extra
  central.writeUInt16LE(0, 32);          // comment
  central.writeUInt16LE(0, 34);          // disk number start
  central.writeUInt16LE(0, 36);          // internal attributes
  central.writeUInt32LE(0, 38);          // external attributes
  central.writeUInt32LE(offset, 42);

  chunks.push(local, nameBytes, body);
  directory.push(central, nameBytes);
  offset += local.length + nameBytes.length + body.length;

  console.log(`  ${String(raw.length).padStart(7)} → ${String(body.length).padStart(7)}  ${name}`);
}

const centralBuffer = Buffer.concat(directory);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054B50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(entryNames.length, 8);
eocd.writeUInt16LE(entryNames.length, 10);
eocd.writeUInt32LE(centralBuffer.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

const archive = Buffer.concat([...chunks, centralBuffer, eocd]);
const outDir = join(root, 'dist');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `nexus.mods.bypass-${version}.zip`);
writeFileSync(outPath, archive);

console.log(`\nv${version} — ${entryNames.length} files, ${(archive.length / 1024).toFixed(1)} KB`);
console.log(relative(process.cwd(), outPath).replace(/\\/g, '/'));
