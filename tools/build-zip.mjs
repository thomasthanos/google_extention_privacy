#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'src');

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

const FORBIDDEN = [
  /^tools\//, /^internal\//, /^dist\//, /^\.claude\//,
  /\.md$/i, /\.zip$/i, /\.aep$/i, /\.mp4$/i, /(^|\/)\.[^/]/
];

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};

const locales = spawnSync(process.execPath, [join(root, 'tools', 'check-locales.mjs')], {
  cwd: root,
  stdio: 'inherit'
});
if (locales.status !== 0) fail('check-locales.mjs did not pass — package not built.');

const vortexPreflight = spawnSync(process.execPath, [join(root, 'tools', 'vortex-preflight-test.cjs')], {
  cwd: root,
  stdio: 'inherit'
});
if (vortexPreflight.status !== 0) fail('vortex-preflight-test.cjs did not pass — package not built.');

const backgroundUnits = spawnSync(process.execPath, [join(root, 'tools', 'background-units-test.cjs')], {
  cwd: root,
  stdio: 'inherit'
});
if (backgroundUnits.status !== 0) fail('background-units-test.cjs did not pass — package not built.');

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
  const absolute = join(pkg, rule.path);
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
  if (!/^[\x20-\x7E]+$/.test(name)) fail(`entry name is not plain ASCII: ${name}`);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(pkg, 'manifest.json'), 'utf8'));
} catch (cause) {
  fail(`manifest.json is not valid JSON — ${cause.message}`);
}

const version = String(manifest.version || '');
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`manifest version is not x.y.z: "${version}"`);

for (const name of entryNames.filter((n) => n.startsWith('_locales/'))) {
  try {
    JSON.parse(readFileSync(join(pkg, name), 'utf8'));
  } catch (cause) {
    fail(`${name} is not valid JSON — ${cause.message}`);
  }
}

function collectReferenced(source) {
  const referenced = new Set();
  for (const script of source.content_scripts || []) {
    for (const file of [...(script.js || []), ...(script.css || [])]) referenced.add(file);
  }
  if (source.background?.service_worker) referenced.add(source.background.service_worker);
  for (const file of source.background?.scripts || []) referenced.add(file);
  if (source.action?.default_popup) referenced.add(source.action.default_popup);
  for (const icons of [source.icons, source.action?.default_icon]) {
    for (const path of Object.values(icons || {})) referenced.add(path);
  }
  return referenced;
}

const packaged = new Set(entryNames);

function assertReferencesArePackaged(source, label) {
  const missing = [...collectReferenced(source)].filter((file) => !packaged.has(file));
  if (missing.length) {
    fail(`the ${label} manifest references files the package does not include:\n  ${missing.join('\n  ')}`);
  }
}

assertReferencesArePackaged(manifest, 'Chrome');

/* The manifest check above only covers files the manifest itself names, so a stray tag inside a
   packaged HTML page shipped unnoticed in 2.5.2 (`<script src="/__l5e/lovable.js">` left behind by a
   web builder). Every local src/href in packaged HTML must resolve to a packaged file. */
const HTML_REFERENCE = /<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
const EXTERNAL_REFERENCE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

function assertHtmlReferencesArePackaged() {
  const problems = [];
  for (const name of entryNames.filter((n) => n.endsWith('.html'))) {
    const source = readFileSync(join(pkg, name), 'utf8');
    const baseDir = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
    for (const [, reference] of source.matchAll(HTML_REFERENCE)) {
      if (EXTERNAL_REFERENCE.test(reference)) continue;
      if (reference.startsWith('/')) {
        problems.push(`${name}: "${reference}" is an absolute path — nothing resolves it inside the package`);
        continue;
      }
      const target = relative(pkg, join(pkg, baseDir, reference.split(/[?#]/)[0])).replace(/\\/g, '/');
      if (!packaged.has(target)) problems.push(`${name}: "${reference}" resolves to ${target}, which is not packaged`);
    }
  }
  if (problems.length) fail(`packaged HTML references files the package does not include:\n  ${problems.join('\n  ')}`);
}

assertHtmlReferencesArePackaged();

const GECKO_ID = 'nexus-mods-bypass@thomasthanos.github.io';

const GECKO_MIN_VERSION = '140.0';

const CHROME_ONLY_PERMISSIONS = ['downloads.ui'];

function toFirefoxManifest(source) {
  const firefox = JSON.parse(JSON.stringify(source));

  firefox.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      strict_min_version: GECKO_MIN_VERSION,
      data_collection_permissions: { required: ['none'] }
    }
  };

  const worker = source.background?.service_worker;
  if (!worker) fail('manifest.json has no background.service_worker to map onto Firefox.');
  firefox.background = { scripts: [worker] };

  firefox.permissions = (source.permissions || [])
    .filter((name) => !CHROME_ONLY_PERMISSIONS.includes(name));

  return firefox;
}

const firefoxManifest = toFirefoxManifest(manifest);
assertReferencesArePackaged(firefoxManifest, 'Firefox');

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

const DOS_TIME = 0;
const DOS_DATE = 0x0021;

function buildArchive(names, replacements = new Map(), { verbose = false } = {}) {
  const chunks = [];
  const directory = [];
  let offset = 0;

  for (const name of names) {
    const raw = replacements.get(name) ?? readFileSync(join(pkg, name));
    const deflated = deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const nameBytes = Buffer.from(name, 'ascii');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);             
    local.writeUInt16LE(0, 6);              
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);             

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);           
    central.writeUInt16LE(20, 6);           
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);           
    central.writeUInt16LE(0, 32);           
    central.writeUInt16LE(0, 34);           
    central.writeUInt16LE(0, 36);           
    central.writeUInt32LE(0, 38);           
    central.writeUInt32LE(offset, 42);

    chunks.push(local, nameBytes, body);
    directory.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;

    if (verbose) {
      console.log(`  ${String(raw.length).padStart(7)} -> ${String(body.length).padStart(7)}  ${name}`);
    }
  }

  const centralBuffer = Buffer.concat(directory);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054B50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuffer, eocd]);
}

const outDir = join(root, 'dist');
mkdirSync(outDir, { recursive: true });

const written = [];
function emit(fileName, archive) {
  const outPath = join(outDir, fileName);
  writeFileSync(outPath, archive);
  const shown = relative(process.cwd(), outPath).replace(/\\/g, '/');
  written.push(`${shown}  (${(archive.length / 1024).toFixed(1)} KB)`);
}

emit(`nexus.mods.bypass-${version}.zip`, buildArchive(entryNames, new Map(), { verbose: true }));

const firefoxOverride = new Map([
  ['manifest.json', Buffer.from(`${JSON.stringify(firefoxManifest, null, 2)}\n`, 'utf8')]
]);
emit(`nexus.mods.bypass-${version}-firefox.zip`, buildArchive(entryNames, firefoxOverride));

console.log(`\nv${version} — ${entryNames.length} files`);
console.log(`Chrome/Edge:  ${written[0]}`);
console.log(`Firefox/AMO:  ${written[1]}`);
console.log(`              id ${GECKO_ID}, Firefox ${GECKO_MIN_VERSION}+`);
