const AN1ME_GATEWAY_URL = "https://an1me.to/";
const AN1ME_TAB_MATCH = ["https://an1me.to/*", "https://*.an1me.to/*"];
const AN1ME_READY_TIMEOUT_MS = 25000;
const AN1ME_READY_POLL_MS = 250;
const AN1ME_IDLE_CLOSE_MS = 8000;
const AN1ME_CHALLENGE_RETRY_MS = 3000;

let _an1meTabId = null;
let _an1meTabOwned = false;
let _an1meLeases = 0;
let _an1meCloseTimer = null;
let _an1meAcquiring = null;

function sendToAn1meTab(tabId, payload) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, payload, (reply) => {
        void chrome.runtime.lastError;
        resolve(reply || null);
      });
    } catch {
      resolve(null);
    }
  });
}

async function an1meTabReady(tabId) {
  const deadline = Date.now() + AN1ME_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const reply = await sendToAn1meTab(tabId, { type: "AN1ME_PING" });
    if (reply?.ready === true) return true;
    await new Promise((r) => setTimeout(r, AN1ME_READY_POLL_MS));
  }
  return false;
}

async function findLiveAn1meTab() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({ url: AN1ME_TAB_MATCH });
  } catch {
    return null;
  }
  const tab = (tabs || []).find((t) => t && t.id != null && t.discarded !== true && t.status !== "unloaded");
  return tab || null;
}

async function acquireAn1meTab() {
  if (_an1meCloseTimer) {
    clearTimeout(_an1meCloseTimer);
    _an1meCloseTimer = null;
  }

  if (_an1meTabId != null) {
    try {
      await chrome.tabs.get(_an1meTabId);
      _an1meLeases++;
      return _an1meTabId;
    } catch {
      _an1meTabId = null;
      _an1meTabOwned = false;
    }
  }

  if (_an1meAcquiring) {
    const shared = await _an1meAcquiring;
    if (shared != null) _an1meLeases++;
    return shared;
  }

  _an1meAcquiring = (async () => {
    const existing = await findLiveAn1meTab();
    if (existing && (await an1meTabReady(existing.id))) {
      _an1meTabId = existing.id;
      _an1meTabOwned = false;
      return _an1meTabId;
    }

    let created;
    try {
      created = await chrome.tabs.create({ url: AN1ME_GATEWAY_URL, active: false });
    } catch {
      return null;
    }
    if (!created || created.id == null) return null;

    if (!(await an1meTabReady(created.id))) {
      try {
        await chrome.tabs.remove(created.id);
      } catch {}
      return null;
    }

    _an1meTabId = created.id;
    _an1meTabOwned = true;
    return _an1meTabId;
  })();

  try {
    const tabId = await _an1meAcquiring;
    if (tabId != null) _an1meLeases++;
    return tabId;
  } finally {
    _an1meAcquiring = null;
  }
}

function releaseAn1meTab() {
  _an1meLeases = Math.max(0, _an1meLeases - 1);
  if (_an1meLeases > 0 || !_an1meTabOwned || _an1meTabId == null) return;

  if (_an1meCloseTimer) clearTimeout(_an1meCloseTimer);
  _an1meCloseTimer = setTimeout(async () => {
    _an1meCloseTimer = null;
    if (_an1meLeases > 0 || !_an1meTabOwned || _an1meTabId == null) return;
    const tabId = _an1meTabId;
    _an1meTabId = null;
    _an1meTabOwned = false;
    try {
      await chrome.tabs.remove(tabId);
    } catch {}
  }, AN1ME_IDLE_CLOSE_MS);
}

function isAn1meChallenge(reply) {
  return !!reply && reply.ok !== true && (reply.status === 403 || reply.status === 503);
}

async function an1meFetch(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 15000;
  const as = options.as === "dataUrl" ? "dataUrl" : "text";

  const tabId = await acquireAn1meTab();
  if (tabId == null) return { ok: false, status: 0, unreachable: true };

  try {
    let reply = await sendToAn1meTab(tabId, { type: "AN1ME_FETCH", url, as, timeoutMs });

    if (isAn1meChallenge(reply)) {
      await new Promise((r) => setTimeout(r, AN1ME_CHALLENGE_RETRY_MS));
      reply = await sendToAn1meTab(tabId, { type: "AN1ME_FETCH", url, as, timeoutMs });
    }

    if (!reply) return { ok: false, status: 0, unreachable: true };
    return {
      ok: reply.ok === true,
      status: Number(reply.status) || 0,
      text: typeof reply.text === "string" ? reply.text : "",
      dataUrl: typeof reply.dataUrl === "string" ? reply.dataUrl : null,
      finalUrl: reply.finalUrl || url,
    };
  } finally {
    releaseAn1meTab();
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== _an1meTabId) return;
  _an1meTabId = null;
  _an1meTabOwned = false;
  _an1meLeases = 0;
});
