const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

global.window = globalThis;
global.document = {};
global.NXTK = {
  escapeHtml: (value) => String(value ?? ''),
  t: (_key, _substitutions, fallback) => fallback,
  setActivity: () => {},
  validateDownloadTarget: () => ({ ok: true })
};
global.NexusExt = {
  Errors: {
    DEFAULT_TIMEOUT_MS: 30000
  },
  Auth: {
    getDocumentLoginError: () => null
  },
  Storage: {},
  UI: {}
};

vm.runInThisContext(fs.readFileSync('src/content/ndc.js', 'utf8'), {
  filename: 'src/content/ndc.js'
});

const uiSource = fs.readFileSync('src/content/ui.js', 'utf8');
const boundModalList = uiSource.match(/const NDC_BOUND_MODAL_IDS = \[[\s\S]*?\];/)?.[0] || '';
assert.match(
  boundModalList,
  /'nxtk-vortex-check-modal'/,
  'collection teardown must settle and remove an open Vortex preflight'
);

function createHarness(choice) {
  const calls = {
    browserQueue: 0,
    history: 0,
    patch: 0,
    progress: 0,
    ended: 0,
    selectedMethod: null
  };

  NexusExt.UI.showVortexHandoffModal = async () => choice;
  NexusExt.Storage.getHistory = async () => {
    calls.history += 1;
    return {};
  };
  NexusExt.Storage.patchSetting = async (key, value) => {
    calls.patch += 1;
    calls.patched = { key, value };
  };

  const ndc = new NexusExt.NDC('game', 'collection');
  ndc.ui = {
    progress: 0,
    modsCount: 0,
    log: () => {},
    logText: () => {},
    setDownloadMethod: (method) => {
      calls.selectedMethod = method;
    },
    startDownload: () => {
      calls.progress += 1;
    },
    endDownload: () => {
      calls.ended += 1;
    }
  };
  ndc.downloadBrowserQueue = async () => {
    calls.browserQueue += 1;
  };

  return { ndc, calls };
}

(async () => {
  const canceled = createHarness('cancel');
  await canceled.ndc.runCollection([], 'all');
  assert.equal(canceled.calls.history, 0, 'cancel must not read or mutate history');
  assert.equal(canceled.calls.progress, 0, 'cancel must not start progress');
  assert.equal(canceled.calls.patch, 0, 'cancel must not change the saved method');

  const browser = createHarness('browser');
  await browser.ndc.runCollection([], 'all');
  assert.equal(browser.ndc.downloadMethod, 1);
  assert.equal(browser.calls.selectedMethod, 1);
  assert.equal(browser.calls.patch, 1);
  assert.deepEqual(browser.calls.patched, { key: 'NDC_downloadMethod', value: 1 });
  assert.equal(browser.calls.browserQueue, 1, 'browser fallback must start the browser queue');
  assert.equal(browser.calls.progress, 0, 'Vortex progress must not start before browser fallback');

  const vortex = createHarness('vortex');
  await vortex.ndc.runCollection([], null);
  assert.equal(vortex.ndc.downloadMethod, 0);
  assert.equal(vortex.calls.selectedMethod, null);
  assert.equal(vortex.calls.patch, 0);
  assert.equal(vortex.calls.browserQueue, 0);
  assert.equal(vortex.calls.progress, 1, 'confirmed Vortex flow must start exactly once');
  assert.equal(vortex.calls.ended, 1, 'confirmed Vortex flow must finish exactly once');

  console.log('Vortex preflight behavior OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
