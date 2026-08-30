/* Regression cover for the pure helpers in background.js that decide how a download is written to
   disk and how long the queue backs off after a rate limit. Both had defects that were invisible
   from the outside: a wrong conflictAction silently overwrote files, and a missing Retry-After
   header collapsed the exponential ladder to a flat 30s. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const noop = () => {};
const listener = () => ({ addListener: noop });

global.chrome = {
  runtime: {
    id: 'test-extension-id',
    lastError: null,
    getURL: (path) => `chrome-extension://test-extension-id/${path}`,
    onMessage: listener(),
    onInstalled: listener()
  },
  storage: {
    local: {
      get: (_keys, cb) => cb && cb({}),
      set: (_items, cb) => cb && cb(),
      remove: (_keys, cb) => cb && cb()
    }
  },
  tabs: { create: noop, remove: noop, sendMessage: noop },
  alarms: { create: noop, clear: noop }
};

const context = vm.createContext({ chrome: global.chrome, console, URL, Date, Math, Number, String, Object, Array, Set, Map, Promise, RegExp, JSON, setTimeout, clearTimeout, isNaN, parseInt, AbortController, fetch: noop });
/* `const NXTK` never becomes a property of the context's global, so hand it out explicitly.
   Function declarations (retryAfterMilliseconds, conflictActionFor) do land on the global. */
const source = `${fs.readFileSync('src/background.js', 'utf8')}\n;globalThis.__NXTK = NXTK;`;
vm.runInContext(source, context, { filename: 'src/background.js' });

const { retryAfterMilliseconds, conflictActionFor, __NXTK: NXTK } = context;

/* An absent Retry-After reaches this as ''. Number('') is 0 — finite and >= 0 — so the header branch
   used to swallow every call and return the 30s floor, making the ladder below it dead code. */
assert.equal(retryAfterMilliseconds('', 1), 30000, 'first strike backs off 30s');
assert.equal(retryAfterMilliseconds('', 2), 60000, 'second strike doubles');
assert.equal(retryAfterMilliseconds('', 3), 120000, 'third strike doubles again');
assert.equal(retryAfterMilliseconds(undefined, 4), 240000, 'a missing header escalates like an empty one');
assert.equal(retryAfterMilliseconds('   ', 3), 120000, 'a whitespace header counts as absent');
assert.equal(retryAfterMilliseconds('', 20), 600000, 'the ladder is capped at 10 minutes');
assert.equal(retryAfterMilliseconds('120', 1), 120000, 'an explicit Retry-After still wins');
assert.equal(retryAfterMilliseconds('0', 1), 30000, 'an explicit 0 still respects the alarm floor');

/* DownloadFolder defaults to 'NexusMods', so every default-install download has a '/' in its path.
   Returning 'overwrite' for those meant two mods sharing an archive name clobbered each other. */
assert.equal(conflictActionFor('NexusMods/Some Mod.zip'), 'uniquify', 'foldered downloads must not overwrite');
assert.equal(conflictActionFor('Some Mod.zip'), 'uniquify', 'unfoldered downloads keep uniquifying');

/* The Vortex hand-off target must stay strictly validated. */
assert.equal(NXTK.validateDownloadTarget('nxm://skyrim/mods/1/files/2?key=k&expires=1&user_id=3').ok, true);
assert.equal(NXTK.validateDownloadTarget('nxm://skyrim/mods/1/files/2').ok, false, 'unsigned nxm links are rejected');
assert.equal(NXTK.validateDownloadTarget('https://evil.example/x.zip', { method: 1 }).ok, false, 'off-host downloads are rejected');

console.log('background.js unit behavior OK');
