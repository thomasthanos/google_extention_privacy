#!/usr/bin/env node
/* Locale gate: node tools/check-locales.mjs
   Fails on anything that silently degrades the UI — a missing key falls back to English
   invisibly, a placeholder mismatch renders a literal "$1". Unreferenced keys are only
   warnings: a phased rollout legitimately lands translations before the code. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = join(root, '_locales');
const MASTER = 'en';

const errors = [];
const warnings = [];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    errors.push(`${path}: invalid JSON — ${cause.message}`);
    return null;
  }
}

/* chrome.i18n substitutes $NAME$ from a `placeholders` block, and $1..$9 positionally.
   Both must line up with what the code passes, or the user sees the raw token. */
function placeholderNames(entry) {
  const named = [...String(entry.message || '').matchAll(/\$([A-Za-z0-9_]+)\$/g)]
    .map((m) => m[1].toLowerCase());
  return new Set(named);
}
function positionalCount(entry) {
  const hits = [...String(entry.message || '').matchAll(/\$([1-9])(?!\$)/g)].map((m) => +m[1]);
  return hits.length ? Math.max(...hits) : 0;
}

const locales = readdirSync(localesDir).filter((d) => existsSync(join(localesDir, d, 'messages.json')));
if (!locales.includes(MASTER)) {
  console.error(`FAIL: no ${MASTER} master catalogue in _locales/`);
  process.exit(1);
}

const master = readJson(join(localesDir, MASTER, 'messages.json'));
if (!master) process.exit(1);
const masterKeys = new Set(Object.keys(master));

for (const locale of locales) {
  const path = join(localesDir, locale, 'messages.json');
  const data = readJson(path);
  if (!data) continue;
  const keys = new Set(Object.keys(data));

  /* Plural families are exempt from strict parity, and must be: Chinese has only
     "other", Russian needs one/few/many/other. Forcing every category on every locale
     would mean inventing forms that do not exist in the language. The contract is that
     _other exists everywhere; the rest are per-locale. */
  const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
  const pluralBases = new Set();
  for (const k of masterKeys) if (PLURAL_SUFFIX.test(k)) pluralBases.add(k.replace(PLURAL_SUFFIX, ''));

  for (const k of masterKeys) {
    if (keys.has(k)) continue;
    if (PLURAL_SUFFIX.test(k) && keys.has(`${k.replace(PLURAL_SUFFIX, '')}_other`)) continue;
    errors.push(`${locale}: missing key "${k}"`);
  }
  for (const k of keys) {
    if (masterKeys.has(k)) continue;
    if (PLURAL_SUFFIX.test(k) && pluralBases.has(k.replace(PLURAL_SUFFIX, ''))) continue;
    errors.push(`${locale}: extra key "${k}" not in ${MASTER}`);
  }
  for (const base of pluralBases) {
    if (!keys.has(`${base}_other`)) errors.push(`${locale}: plural "${base}" has no _other form`);
  }

  for (const [key, entry] of Object.entries(data)) {
    if (!entry || typeof entry.message !== 'string' || !entry.message.trim()) {
      errors.push(`${locale}: "${key}" has an empty message`);
      continue;
    }
    if (!masterKeys.has(key)) continue;

    // Every $NAME$ used must be declared, or chrome.i18n drops the whole message.
    const declared = new Set(Object.keys(entry.placeholders || {}).map((p) => p.toLowerCase()));
    for (const name of placeholderNames(entry)) {
      if (!declared.has(name)) errors.push(`${locale}: "${key}" uses $${name}$ with no placeholders entry`);
    }
    // Substitution count must match the master, whichever style the message uses.
    const mine = Math.max(positionalCount(entry), placeholderNames(entry).size);
    const theirs = Math.max(positionalCount(master[key]), placeholderNames(master[key]).size);
    if (mine !== theirs) {
      errors.push(`${locale}: "${key}" takes ${mine} substitution(s), ${MASTER} takes ${theirs}`);
    }
    // Locale values are plain text — markup belongs in code, never in a catalogue.
    if (/<[a-z][\s\S]*>/i.test(entry.message)) {
      errors.push(`${locale}: "${key}" contains HTML markup`);
    }
  }
}

/* Referenced-key sweep: data-i18n* markers, NXTK.t()/tPlural() calls, and __MSG_*__. */
const referenced = new Set();
const SCAN = ['popup', 'onboarding', 'content', 'shared.js', 'manifest.json'];
function walk(p) {
  const full = join(root, p);
  if (!existsSync(full)) return;
  let stat;
  try { stat = readdirSync(full); } catch { stat = null; }
  if (stat) return stat.forEach((f) => walk(join(p, f)));
  if (!/\.(js|html|json)$/.test(p)) return;
  const src = readFileSync(full, 'utf8');
  for (const m of src.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) referenced.add(m[1]);
  /* Local aliases matter as much as NXTK.t: ui.js uses `L`, ndc.js uses `T`/`TS`. Missing
     one makes the "key en does not define" check below silently pass — that is how 28
     untranslated log lines once passed as a clean run. Add new aliases here. */
  for (const m of src.matchAll(/\b(?:NXTK\.)?(?:t|tPlural|T|TS|L)\(\s*['"`]([A-Za-z0-9_]+)['"`]/g)) {
    referenced.add(m[1]);
  }
  for (const m of src.matchAll(/__MSG_(\w+)__/g)) referenced.add(m[1]);
  /* Some keys are selected through a lookup table rather than a literal call — the
     status map in the deck, for instance. Any bare quoted string that exactly matches a
     catalogue key counts as a reference; key names are distinctive enough that a
     coincidental match is not a realistic concern. */
  for (const m of src.matchAll(/['"`]([A-Za-z][A-Za-z0-9_]{4,})['"`]/g)) {
    if (masterKeys.has(m[1])) referenced.add(m[1]);
  }
}
SCAN.forEach(walk);

/* err*Msg / err*Fix are built from the error code at render time, never written
   literally. Deriving the expected set from DEFINITIONS turns an unverifiable warning
   into a real cross-check for a renamed code, a typo, or an orphaned key. */
const errorKeys = new Set();
try {
  const src = readFileSync(join(root, 'content', 'errors.js'), 'utf8');
  const block = src.slice(src.indexOf('const DEFINITIONS'), src.indexOf('\n  };', src.indexOf('const DEFINITIONS')));
  for (const m of block.matchAll(/^\s{4}(\w+):\s*\{/gm)) {
    const camel = m[1].split('_')
      .map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1))).join('');
    const base = `err${camel[0].toUpperCase()}${camel.slice(1)}`;
    errorKeys.add(`${base}Msg`);
    // `aborted` ships an empty recovery, so a Fix key for it must NOT exist.
    if (!/recovery:\s*''/.test(block.slice(m.index, block.indexOf('\n    }', m.index)))) {
      errorKeys.add(`${base}Fix`);
    }
  }
  for (const k of errorKeys) {
    if (!masterKeys.has(k)) errors.push(`errors.js expects "${k}" but ${MASTER} does not define it`);
  }
} catch (cause) {
  warnings.push(`could not cross-check errors.js: ${cause.message}`);
}

for (const key of masterKeys) {
  const base = key.replace(/_(one|two|few|many|other|zero)$/, '');
  if (referenced.has(key) || referenced.has(base) || errorKeys.has(key)) continue;
  if (/^err[A-Z].*(Msg|Fix)$/.test(key)) {
    errors.push(`"${key}" looks like an error key but matches no code in errors.js`);
    continue;
  }
  warnings.push(`unreferenced key "${key}"`);
}
for (const key of referenced) {
  if (masterKeys.has(key)) continue;
  const plural = [...masterKeys].some((k) => k.startsWith(`${key}_`));
  if (!plural) errors.push(`code references "${key}" which ${MASTER} does not define`);
}

console.log(`Checked ${locales.length} locales (${masterKeys.size} keys): ${locales.join(', ')}`);
warnings.forEach((w) => console.log(`  warn: ${w}`));
if (errors.length) {
  errors.forEach((e) => console.error(`  FAIL: ${e}`));
  console.error(`\n${errors.length} error(s).`);
  process.exit(1);
}
console.log(`OK — ${warnings.length} warning(s), 0 errors.`);
