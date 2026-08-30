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
    local: (() => {
      const store = {};
      /* chrome.storage serialises, so every get hands back a fresh copy and every set stores one.
         A stub that shares references would hide exactly the stale-snapshot bug under test. */
      const copy = (value) => (value === undefined ? undefined : structuredClone(value));
      return {
        get: (keys, cb) => {
          if (keys === null || keys === undefined) return cb && cb(copy(store));
          const names = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const name of names) if (name in store) out[name] = copy(store[name]);
          cb && cb(out);
        },
        set: (items, cb) => { for (const [k, v] of Object.entries(items)) store[k] = copy(v); cb && cb(); },
        remove: (keys, cb) => {
          for (const name of (Array.isArray(keys) ? keys : [keys])) delete store[name];
          cb && cb();
        }
      };
    })()
  },
  tabs: { create: noop, remove: noop, sendMessage: noop },
  alarms: { create: noop, clear: noop }
};

const context = vm.createContext({ chrome: global.chrome, console, URL, Date, Math, Number, String, Object, Array, Set, Map, Promise, RegExp, JSON, setTimeout, clearTimeout, isNaN, parseInt, AbortController, structuredClone, fetch: noop });
/* `const NXTK` never becomes a property of the context's global, so hand it out explicitly.
   Function declarations (retryAfterMilliseconds, conflictActionFor) do land on the global. */
const source = `${fs.readFileSync('src/background.js', 'utf8')}\n;globalThis.__NXTK = NXTK;globalThis.__NDC_JOBS_KEY = NDC_JOBS_KEY;globalThis.__writeQueues = writeQueues;`;
vm.runInContext(source, context, { filename: 'src/background.js' });

const { retryAfterMilliseconds, conflictActionFor, __NXTK: NXTK } = context;
const { mutateNdcJob, readNdcJob, saveNdcJob, storageSetLocal, enqueueStorageTask,
  __NDC_JOBS_KEY: NDC_JOBS_KEY, __writeQueues: writeQueues } = context;

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

/* A collection job advances from two directions at once: the download-terminal handler and an
   attach/status call from a tab. saveNdcJob wrote back a whole snapshot read several awaits earlier,
   so a late writer could roll `index` back and re-download an item while orphaning the one in
   flight. mutateNdcJob applies only the fields it names, against stored state. */
async function jobStateBehaviour() {
  const jobId = 'testjob-000001';
  await storageSetLocal(NDC_JOBS_KEY, {
    [jobId]: {
      id: jobId, tabId: 7, gameId: '1', collectionId: 'c', type: 'all',
      itemCount: 10, index: 5, completed: 5, failed: [], status: 'running',
      activeDownloadId: 42, createdAt: Date.now(), updatedAt: Date.now()
    }
  });

  // A reader takes a snapshot, then the queue moves on underneath it.
  const stale = await readNdcJob(jobId);
  assert.equal(stale.index, 5);

  await mutateNdcJob(jobId, (current) => {
    current.index = 6;
    current.completed = 6;
    current.activeDownloadId = 99;
  });

  // The stale holder now only wants to record which tab is watching.
  await mutateNdcJob(jobId, (current) => { current.tabId = 13; });

  const after = await readNdcJob(jobId);
  assert.equal(after.index, 6, 'a later targeted write must not roll index back');
  assert.equal(after.completed, 6, 'completed must not roll back either');
  assert.equal(after.activeDownloadId, 99, 'the in-flight download must not be orphaned');
  assert.equal(after.tabId, 13, 'the field that was actually mutated is applied');

  // The old whole-snapshot write is what used to lose those fields — prove the difference.
  stale.tabId = 21;
  await saveNdcJob(stale);
  const clobbered = await readNdcJob(jobId);
  assert.equal(clobbered.index, 5, 'saveNdcJob still writes the whole snapshot, so it is not for read-modify-write');

  assert.equal(await mutateNdcJob('testjob-absent1', () => {}), null, 'mutating a missing job is a no-op');
}

/* Item lists are stored under a per-job key, so a queue map that never released finished keys grew
   one permanent entry per collection run for the life of the worker. */
async function writeQueueRelease() {
  const before = writeQueues.size;
  await enqueueStorageTask('nxtk_ndc_items:job-a', async () => 'a');
  await enqueueStorageTask('nxtk_ndc_items:job-b', async () => 'b');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(writeQueues.size, before, 'settled keys must be released');

  // Ordering must still hold while tasks are actually queued.
  const order = [];
  const slow = enqueueStorageTask('k', async () => { await new Promise((r) => setTimeout(r, 5)); order.push(1); });
  const fast = enqueueStorageTask('k', async () => { order.push(2); });
  await Promise.all([slow, fast]);
  assert.deepEqual(order, [1, 2], 'tasks on one key stay serialised');
}

jobStateBehaviour()
  .then(writeQueueRelease)
  .then(() => console.log('background.js unit behavior OK'))
  .catch((error) => { console.error(error); process.exitCode = 1; });
