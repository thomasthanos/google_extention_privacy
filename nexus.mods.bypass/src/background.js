const NXTK = (() => {
  const SETTINGS_KEY = 'nxtk_settings';
  const ERROR_LOG_KEY = 'nxtk_error_log';
  const MAX_LOGGED_ERRORS = 50;
  const TOTAL_DOWNLOADS_KEY = 'nxtk_total_downloads';
  const ISSUE_NEW_URL = 'https://github.com/thomasthanos/google_extention_privacy/issues/new';
  const REPORT_ISSUE_URL = `${ISSUE_NEW_URL}/choose`;
  const DEFAULTS = {
    AutoStartDownload: true,
    AutoCloseTab: true,
    SkipRequirements: true,
    ShowAlertsOnError: true,
    HandleArchivedFiles: true,
    HidePremiumUpsells: true,
    DebugLogs: false,
    DownloadFolder: 'NexusMods',
    CloseTabDelay: 3000,
    RequestTimeout: 30000,
    NDC_pauseBetweenDownload: 5,
    NDC_downloadSpeed: 3.2,
    ForceEnglish: false,
    NDC_downloadMethod: 0
  };

  const SENSITIVE_PARAM_NAMES = [
    'key',
    'expires',
    'user_id',
    'token',
    'access_token',
    'refresh_token',
    'auth',
    'authorization',
    'session',
    'session_id',
    'signature',
    'api_key',
    'download_key',
    'code',
    'state',
    'password',
    'cookie',
  ];
  const REDACTED = '[redacted]';
  const SENSITIVE_NAME_GROUP = SENSITIVE_PARAM_NAMES
    .slice()
    .sort((a, b) => b.length - a.length)
    .join('|');

  const SENSITIVE_PATTERNS = [
    new RegExp('\\b(' + SENSITIVE_NAME_GROUP + ')(=|%3D)([^&\\s"\'<>]+)', 'gi'),
    new RegExp('(["\'])(' + SENSITIVE_NAME_GROUP + ')\\1(\\s*:\\s*)(["\'])([^"\']*)\\4', 'gi'),
    new RegExp('\\b(' + SENSITIVE_NAME_GROUP + ')(\\s*:\\s*)([^,;}"\'<>\\r\\n]+)', 'gi'),
  ];

  function redactSensitiveValues(value) {
    let text = String(value ?? '');
    if (!text) return text;
    text = text.replace(SENSITIVE_PATTERNS[0], (_m, name, sep) => name + sep + REDACTED);
    text = text.replace(SENSITIVE_PATTERNS[1], (_m, q1, name, sep, q2) => q1 + name + q1 + sep + q2 + REDACTED + q2);
    text = text.replace(SENSITIVE_PATTERNS[2], (_m, name, sep) => name + sep + REDACTED);
    return text;
  }

  const URL_SHAPE = /^[a-z][a-z0-9+.-]*:\/\//i;

  function sanitizeUrlForReport(url) {
    const raw = String(url ?? '').trim();
    if (!raw) return '';
    if (!URL_SHAPE.test(raw)) return redactSensitiveValues(raw.split(/[?#]/)[0]).slice(0, 160);
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'nxm:') {
        return 'nxm://' + parsed.hostname + parsed.pathname + ' (query removed)';
      }
      const fileId = parsed.searchParams.get('file_id');
      const base = parsed.protocol + '//' + parsed.host + parsed.pathname;
      return base + (fileId && /^\d{1,12}$/.test(fileId) ? '?file_id=' + fileId : '');
    } catch (_) {
      return redactSensitiveValues(raw.split(/[?#]/)[0]).slice(0, 160);
    }
  }

  function sanitizeDiagnosticText(value, maxLength = 1500) {
    let text = String(value ?? '');
    if (!text) return text;
    text = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (match) => sanitizeUrlForReport(match));
    text = redactSensitiveValues(text);
    return text.slice(0, maxLength);
  }

  function buildErrorEntry(error) {
    return {
      at: Date.now(),
      code: String(error?.code || 'background_error'),
      status: Number.isInteger(error?.status) ? error.status : null,
      context: sanitizeDiagnosticText(error?.context, 300),
      userMessage: String(error?.userMessage || ''),
      technicalMessage: sanitizeDiagnosticText(error?.technicalMessage, 600),
      stack: sanitizeDiagnosticText(error?.stack, 1500),
      url: String(error?.url || '')
    };
  }

  function normalizeHostname(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host.endsWith('.') ? host.slice(0, -1) : host;
  }

  function hostMatches(hostname, apex) {
    const host = normalizeHostname(hostname);
    return host === apex || host.endsWith(`.${apex}`);
  }

  function validateDownloadTarget(url, { method = 0 } = {}) {
    const raw = String(url ?? '').trim();
    if (!raw) return { ok: false, detail: 'empty' };
    if (raw.length > 2048) return { ok: false, detail: 'too-long' };

    let parsed;
    try {
      parsed = new URL(raw);
    } catch (_) {
      return { ok: false, detail: 'not-a-url' };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, detail: 'embedded-credentials' };
    }
    if (method === 0) {
      if (parsed.protocol !== 'nxm:') {
        return { ok: false, detail: `bad-protocol:${parsed.protocol.replace(':', '')}` };
      }
      const missing = ['key', 'expires', 'user_id'].filter((name) => !parsed.searchParams.get(name));
      return missing.length
        ? { ok: false, detail: `missing-nxm-params:${missing.join(',')}` }
        : { ok: true, url: raw, hostname: normalizeHostname(parsed.hostname) };
    }
    if (parsed.protocol !== 'https:') {
      return { ok: false, detail: `bad-protocol:${parsed.protocol.replace(':', '')}` };
    }
    if (!hostMatches(parsed.hostname, 'nexusmods.com') && !hostMatches(parsed.hostname, 'nexus-cdn.com')) {
      return { ok: false, detail: `host-not-allowed:${normalizeHostname(parsed.hostname)}` };
    }
    return { ok: true, url: raw, hostname: normalizeHostname(parsed.hostname) };
  }

  return {
    SETTINGS_KEY,
    ERROR_LOG_KEY,
    MAX_LOGGED_ERRORS,
    TOTAL_DOWNLOADS_KEY,
    ISSUE_NEW_URL,
    REPORT_ISSUE_URL,
    DEFAULTS,
    buildErrorEntry,
    sanitizeDiagnosticText,
    validateDownloadTarget
  };
})();

const LEGACY_SETTINGS_KEYS = ['PlayErrorSound', 'ErrorSoundUrl', 'QuietSiteErrors', 'HideDownloadBar'];

const LEGACY_SPEED_DEFAULT = 1.5;

function getRuntimeError() {
  try {
    return chrome.runtime.lastError?.message || '';
  } catch (_) {
    return 'The extension context is no longer available.';
  }
}

function recordBackgroundError(context, cause) {
  appendErrorLogEntry(NXTK.buildErrorEntry({
    code: 'background_error',
    context,
    userMessage: 'A background extension task failed.',
    technicalMessage: String(cause?.message || cause || ''),
    stack: String(cause?.stack || '')
  })).catch(() => undefined);
}

const STORAGE_HISTORY_KEY = 'nxtk_ndc_history';
const HISTORY_TYPES = new Set(['all', 'mandatory', 'optional']);
const ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_HISTORY_IDS = 10000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const writeQueues = new Map();

function enqueueStorageTask(storageKey, task) {
  const previous = writeQueues.get(storageKey) || Promise.resolve();
  const next = previous.then(task, task);
  writeQueues.set(storageKey, next.then(() => undefined, () => undefined));
  return next;
}

function storageGetLocal(key, fallback) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(key, (result) => {
        if (getRuntimeError()) return resolve(fallback);
        const value = result ? result[key] : undefined;
        resolve(value === undefined ? fallback : value);
      });
    } catch (_) {
      resolve(fallback);
    }
  });
}

function storageSetLocal(key, value) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set({ [key]: value }, () => {
        const error = getRuntimeError();
        if (error) return reject(new Error(error));
        resolve(true);
      });
    } catch (cause) {
      reject(cause instanceof Error ? cause : new Error(String(cause)));
    }
  });
}

function appendErrorLogEntry(entry) {
  return enqueueStorageTask(NXTK.ERROR_LOG_KEY, async () => {
    const stored = await storageGetLocal(NXTK.ERROR_LOG_KEY, []);
    const log = Array.isArray(stored) ? stored : [];
    const last = log[log.length - 1];
    if (last && last.code === entry.code && last.technicalMessage === entry.technicalMessage
      && last.context === entry.context && entry.at - last.at < 2000) {
      return log.length;
    }
    log.push(entry);
    while (log.length > NXTK.MAX_LOGGED_ERRORS) log.shift();
    await storageSetLocal(NXTK.ERROR_LOG_KEY, log);
    return log.length;
  });
}

function isSafeId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value) && !FORBIDDEN_KEYS.has(value);
}

function isValidFileId(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 && value < 1e12;
  return typeof value === 'string' && /^\d{1,12}$/.test(value);
}

function historyBranch(history, gameId, collectionId) {
  const root = Object.assign(Object.create(null), history || {});
  const game = Object.assign(Object.create(null), root[gameId] || {});
  const collection = Object.assign(Object.create(null), game[collectionId] || {});
  root[gameId] = game;
  game[collectionId] = collection;
  return { root, collection };
}

function readHistoryList(collection, type) {
  return Array.isArray(collection[type]) ? collection[type] : [];
}

async function mutateHistory(payload, mutate) {
  const { gameId, collectionId } = payload || {};
  if (!isSafeId(gameId) || !isSafeId(collectionId)) throw new Error('invalid-collection-identifier');
  return enqueueStorageTask(STORAGE_HISTORY_KEY, async () => {
    const stored = await storageGetLocal(STORAGE_HISTORY_KEY, {});
    const { root, collection } = historyBranch(stored, gameId, collectionId);
    mutate(collection);
    await storageSetLocal(STORAGE_HISTORY_KEY, root);
    return { gameId, collectionId, collection: { ...collection } };
  });
}

const STORAGE_HANDLERS = {
  async SETTINGS_PATCH(payload) {
    const patch = payload?.patch;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('invalid-settings-patch');
    const keys = Object.keys(patch);
    if (!keys.length) throw new Error('empty-settings-patch');
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(NXTK.DEFAULTS, key)) throw new Error(`unknown-settings-key:${key}`);
      if (typeof patch[key] !== typeof NXTK.DEFAULTS[key]) throw new Error(`invalid-settings-value:${key}`);
    }
    return enqueueStorageTask(NXTK.SETTINGS_KEY, async () => {
      const stored = await storageGetLocal(NXTK.SETTINGS_KEY, null);
      const base = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
      const next = { ...NXTK.DEFAULTS, ...base, ...patch };
      await storageSetLocal(NXTK.SETTINGS_KEY, next);
      return next;
    });
  },

  async ERROR_LOG_APPEND(payload) {
    const entry = payload?.entry;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('invalid-error-entry');
    return appendErrorLogEntry(NXTK.buildErrorEntry(entry));
  },

  async NDC_HISTORY_ADD(payload) {
    const { type, fileId } = payload || {};
    if (!HISTORY_TYPES.has(type)) throw new Error('invalid-history-type');
    if (!isValidFileId(fileId)) throw new Error('invalid-file-id');
    return mutateHistory(payload, (collection) => {
      const list = readHistoryList(collection, type);
      if (list.length >= MAX_HISTORY_IDS) throw new Error('history-too-large');
      collection[type] = [...new Set([...list, fileId])];
    });
  },

  async NDC_HISTORY_CLEAR_TYPE(payload) {
    const { type } = payload || {};
    if (!HISTORY_TYPES.has(type)) throw new Error('invalid-history-type');
    return mutateHistory(payload, (collection) => {
      collection[type] = [];
    });
  },

  async NDC_HISTORY_SET_COLLECTION(payload) {
    const lists = payload?.lists;
    if (!lists || typeof lists !== 'object') throw new Error('invalid-lists');
    const cleaned = Object.create(null);
    for (const type of HISTORY_TYPES) {
      const raw = Array.isArray(lists[type]) ? lists[type] : [];
      if (raw.length > MAX_HISTORY_IDS) throw new Error('history-too-large');
      cleaned[type] = [...new Set(raw.filter(isValidFileId))];
    }
    return mutateHistory(payload, (collection) => {
      for (const type of HISTORY_TYPES) collection[type] = cleaned[type];
    });
  },

  async TOTAL_DOWNLOADS_INCREMENT() {
    return enqueueStorageTask(NXTK.TOTAL_DOWNLOADS_KEY, async () => {
      const count = Number(await storageGetLocal(NXTK.TOTAL_DOWNLOADS_KEY, 0)) || 0;
      const next = count + 1;
      await storageSetLocal(NXTK.TOTAL_DOWNLOADS_KEY, next);
      return next;
    });
  }
};

const MAX_DOWNLOAD_NAME_CHARS = 150;

function hasDownloadsApi() {
  try {
    return !!(chrome.downloads && chrome.downloads.download);
  } catch (_) {
    return false;
  }
}

function restoreBrowserDownloadUi() {
  try {
    if (typeof chrome.downloads?.setUiOptions !== 'function') return;
    const pending = chrome.downloads.setUiOptions({ enabled: true });
    pending?.catch?.((cause) => {
      recordBackgroundError('restore download UI', cause);
    });
  } catch (cause) {
    recordBackgroundError('restore download UI', cause);
  }
}

restoreBrowserDownloadUi();

function sanitizePathSegment(value, { allowDots = true } = {}) {
  let segment = String(value ?? '')
    .replace(/[\\/]+/g, ' ')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/[<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!allowDots) segment = segment.replace(/\./g, '');
  segment = segment
    .split(' ')
    .filter((token) => token && !/^\.+$/.test(token))
    .join(' ');
  segment = segment.replace(/^\.+/, '').trim();
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment)) segment = `_${segment}`;
  return segment;
}

function capFileName(name) {
  if (name.length <= MAX_DOWNLOAD_NAME_CHARS) return name;
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || name.length - dot > 12) return name.slice(0, MAX_DOWNLOAD_NAME_CHARS);
  const ext = name.slice(dot);
  return name.slice(0, MAX_DOWNLOAD_NAME_CHARS - ext.length) + ext;
}

function buildDownloadPath(folder, rawName) {
  const name = capFileName(sanitizePathSegment(rawName)) || 'nexus-download';
  const dir = sanitizePathSegment(folder, { allowDots: false });
  return dir ? `${dir}/${name}` : name;
}

function conflictActionFor(filename) {
  return String(filename).includes('/') ? 'overwrite' : 'uniquify';
}

const DOWNLOAD_EXTENSIONS = new Set([
  'zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz', 'lzma', '001',
  'exe', 'msi', 'jar', 'fomod', 'omod',
  'txt', 'pdf', 'json', 'xml', 'ini', 'cfg',
  'esp', 'esm', 'esl', 'dll'
]);

function extractDownloadExtension(value) {
  let candidate = String(value || '').trim();
  try {
    const parsed = new URL(candidate);
    candidate = decodeURIComponent(parsed.pathname.split('/').pop() || '');
  } catch (_) {
    candidate = candidate.split(/[?#]/, 1)[0];
  }
  const match = candidate.match(/\.([a-z0-9]{1,8})$/i);
  if (!match) return '';
  const extension = match[1].toLowerCase();
  return DOWNLOAD_EXTENSIONS.has(extension) ? `.${extension}` : '';
}

function hasFileExtension(name) {
  return !!extractDownloadExtension(name);
}

function withFallbackExtension(name, fallbackExtension) {
  const cleanName = String(name || '').trim();
  if (!cleanName || hasFileExtension(cleanName)) return cleanName;
  const extension = String(fallbackExtension || '').trim().toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? cleanName + extension : cleanName;
}

const RETIRED_STORAGE_KEYS = ['nxtk_managed_downloads', 'nxtk_download_ui_default_reset'];

const DOWNLOAD_HANDLERS = {
  async DOWNLOAD_START(payload) {
    if (!hasDownloadsApi()) throw new Error('no-permission');
    const url = String(payload?.url || '');
    const verdict = NXTK.validateDownloadTarget(url, { method: 1 });
    if (!verdict.ok) throw new Error(`unsafe-target:${verdict.detail}`);

    const requestedName = withFallbackExtension(
      payload?.filename || 'nexus-download',
      extractDownloadExtension(verdict.url) || payload?.fallbackExtension || '.zip'
    );
    const filename = buildDownloadPath(payload?.folder, requestedName);
    const downloadId = await new Promise((resolve, reject) => {
      const options = {
        url: verdict.url,
        filename,
        conflictAction: conflictActionFor(filename),
        saveAs: false
      };
      chrome.downloads.download(options, (id) => {
        const error = getRuntimeError();
        if (error || id === undefined) return reject(new Error(error || 'download-not-started'));
        resolve(id);
      });
    });
    return { downloadId, filename };
  }
};

const NDC_JOBS_KEY = 'nxtk_background_ndc_jobs';
const NDC_RATE_LIMIT_KEY = 'nxtk_ndc_rate_limit';
const NDC_ALARM_PREFIX = 'nxtk-ndc-job:';
const MAX_NDC_JOB_ITEMS = 5000;
const MAX_NDC_JOB_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_NDC_ACTIVE_JOB_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ndcProcessingJobs = new Set();
const ndcDownloadJobs = new Map();

function makeNdcJobId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function ndcScopeKey(type, items) {
  const ids = items.map((item) => String(item.fileId)).sort();
  const text = `${type ?? 'null'}|${ids.join(',')}`;
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = (((hash << 5) + hash) ^ text.charCodeAt(index)) >>> 0;
  }
  return `${type ?? 'null'}:${ids.length}:${hash.toString(36)}`;
}

function sanitizeNdcJobItem(raw) {
  const fileId = raw?.fileId;
  const gameId = String(raw?.gameId ?? '').trim();
  const name = String(raw?.name || '').trim().slice(0, 300);
  const pageUrl = String(raw?.pageUrl || '').trim();
  const rawSize = Number(raw?.sizeKb);
  const sizeKb = Number.isFinite(rawSize) && rawSize > 0 && rawSize < 1e9 ? Math.round(rawSize) : 0;
  if (!isValidFileId(fileId) || !/^\d{1,12}$/.test(gameId) || !name || !pageUrl) return null;

  try {
    const parsed = new URL(pageUrl);
    const host = String(parsed.hostname || '').toLowerCase().replace(/\.$/, '');
    if (parsed.protocol !== 'https:' || (host !== 'nexusmods.com' && host !== 'www.nexusmods.com')) return null;
    if (!/^\/[^/]+\/mods\/\d+$/i.test(parsed.pathname)) return null;
  } catch (_) {
    return null;
  }

  return { fileId, gameId, name, pageUrl, sizeKb };
}

const SHORT_TRANSFER_RATIO = 0.5;
const MIN_EXPECTED_BYTES_FOR_RATIO = 64 * 1024;

async function verifyTransferSize(downloadId, item) {
  const record = await searchDownload(downloadId);
  if (!record) return { suspicious: false, actualBytes: null, expectedBytes: 0 };

  const actualBytes = Number(record.bytesReceived) || 0;
  const expectedBytes = Number(item?.sizeKb) > 0 ? Math.round(Number(item.sizeKb) * 1024) : 0;

  if (actualBytes === 0) {
    return { suspicious: true, code: 'empty-file', actualBytes, expectedBytes };
  }
  if (expectedBytes >= MIN_EXPECTED_BYTES_FOR_RATIO
    && actualBytes < expectedBytes * SHORT_TRANSFER_RATIO) {
    return { suspicious: true, code: 'short-file', actualBytes, expectedBytes };
  }
  return { suspicious: false, actualBytes, expectedBytes };
}

const NDC_ITEMS_KEY_PREFIX = 'nxtk_ndc_items:';
const ndcItemsCache = new Map();

function ndcItemsKey(jobId) {
  return `${NDC_ITEMS_KEY_PREFIX}${jobId}`;
}

function ndcJobItemCount(job) {
  const count = Number(job?.itemCount);
  if (Number.isInteger(count) && count > 0) return count;
  return Array.isArray(job?.items) ? job.items.length : 0;
}

async function readNdcJobItems(job) {
  if (!job) return [];
  if (Array.isArray(job.items) && job.items.length) return job.items;
  const cached = ndcItemsCache.get(job.id);
  if (cached) return cached;
  const stored = await storageGetLocal(ndcItemsKey(job.id), null);
  const items = Array.isArray(stored) ? stored : [];
  if (items.length) ndcItemsCache.set(job.id, items);
  return items;
}

async function writeNdcJobItems(jobId, items) {
  ndcItemsCache.set(jobId, items);
  await enqueueStorageTask(ndcItemsKey(jobId), () => storageSetLocal(ndcItemsKey(jobId), items));
}

function dropNdcJobItems(jobId) {
  ndcItemsCache.delete(jobId);
  try {
    chrome.storage.local.remove(ndcItemsKey(jobId), () => void getRuntimeError());
  } catch (_) { }
}

function cleanNdcJobs(stored) {
  const jobs = Object.create(null);
  const now = Date.now();
  if (!stored || typeof stored !== 'object') return jobs;
  for (const [jobId, job] of Object.entries(stored)) {
    if (!/^[a-z0-9-]{8,80}$/i.test(jobId) || !job || typeof job !== 'object') continue;
    if (!ndcJobItemCount(job)) continue;
    const touchedAt = Number(job.updatedAt || job.createdAt);
    if (!Number.isFinite(touchedAt)) continue;
    const maxAge = ndcJobIsActive(job) ? MAX_NDC_ACTIVE_JOB_AGE_MS : MAX_NDC_JOB_AGE_MS;
    if (now - touchedAt > maxAge) continue;
    jobs[jobId] = job;
  }
  return jobs;
}

async function readNdcJobs() {
  return cleanNdcJobs(await storageGetLocal(NDC_JOBS_KEY, Object.create(null)));
}

async function readNdcJob(jobId) {
  const jobs = await readNdcJobs();
  return jobs[jobId] || null;
}

function bumpNdcControl(job) {
  job.controlVersion = Number(job.controlVersion || 0) + 1;
  return job;
}

async function saveNdcJob(job) {
  job.updatedAt = Date.now();
  await enqueueStorageTask(NDC_JOBS_KEY, async () => {
    const jobs = await readNdcJobs();
    const stored = jobs[job.id];
    if (stored && Number(stored.controlVersion || 0) > Number(job.controlVersion || 0)) {
      job.status = stored.status;
      job.controlVersion = stored.controlVersion;
    }
    jobs[job.id] = job;
    await storageSetLocal(NDC_JOBS_KEY, jobs);
  });
  return job;
}

function ndcJobIsActive(job) {
  return !!job && (job.status === 'running' || job.status === 'paused');
}

async function findActiveNdcJobForCollection(gameId, collectionId) {
  const jobs = await readNdcJobs();
  return Object.values(jobs).find(
    (job) => ndcJobIsActive(job) && job.gameId === gameId && job.collectionId === collectionId
  ) || null;
}

async function findNdcJobByDownloadId(downloadId) {
  const cachedJobId = ndcDownloadJobs.get(downloadId);
  if (cachedJobId) {
    const cachedJob = await readNdcJob(cachedJobId);
    if (cachedJob?.activeDownloadId === downloadId) return cachedJob;
  }
  const jobs = await readNdcJobs();
  return Object.values(jobs).find((job) => job?.activeDownloadId === downloadId) || null;
}

function notifyNdcJob(job, type, extra = {}, alsoTabIds = []) {
  const targets = new Set();
  if (Number.isInteger(job?.tabId) && job.tabId >= 0) targets.add(job.tabId);
  for (const tabId of alsoTabIds) {
    if (Number.isInteger(tabId) && tabId >= 0) targets.add(tabId);
  }
  if (!targets.size) return;

  const message = {
    type,
    jobId: job.id,
    gameId: job.gameId,
    collectionId: job.collectionId,
    status: job.status,
    index: job.index,
    total: ndcJobItemCount(job),
    completed: job.completed,
    failedCount: Array.isArray(job.failed) ? job.failed.length : 0,
    ...extra
  };
  for (const tabId of targets) {
    try {
      chrome.tabs.sendMessage(tabId, message, () => void getRuntimeError());
    } catch (_) { }
  }
}

function decodeBackgroundDownloadValue(value) {
  return String(value || '')
    .trim()
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;|&#0*38;|&#x0*26;/gi, '&')
    .replace(/&quot;|&#0*34;|&#x0*22;/gi, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .trim();
}

function findBackgroundDownloadUrl(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const text = decodeBackgroundDownloadValue(value);
    try {
      const fromJson = findBackgroundDownloadUrl(JSON.parse(text));
      if (fromJson) return fromJson;
    } catch (_) { }
    const patterns = [
      /id=["']dl_link["'][^>]*value=["']([^"']+)["']/i,
      /data-download-url=["']([^"']+)["']/i,
      /const\s+downloadUrl\s*=\s*["']([^"']+)["']/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return decodeBackgroundDownloadValue(match[1] || match[0]);
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  for (const key of ['url', 'downloadUrl', 'vortexDownloadUrl', 'nmmDownloadUrl']) {
    if (typeof value[key] === 'string' && value[key].trim()) {
      return decodeBackgroundDownloadValue(value[key]);
    }
  }
  for (const key of ['data', 'html', 'links', 'downloadLinks']) {
    const nested = findBackgroundDownloadUrl(value[key]);
    if (nested) return nested;
  }
  return '';
}

function responseLooksLoggedOut(response, text) {
  try {
    const finalUrl = new URL(response?.url || '');
    if (String(finalUrl.hostname || '').toLowerCase().replace(/\.$/, '') === 'users.nexusmods.com'
      && /^\/auth\/sign_in(?:\/|$)/.test(finalUrl.pathname)) return true;
  } catch (_) { }
  return /(?:auth\/sign_in|name=["']login|sign in to nexus mods)/i.test(String(text || '').slice(0, 200000));
}

async function fetchNdcResponse(url, options, timeoutMs) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = Math.min(Math.max(Number(timeoutMs) || 30000, 5000), 120000);
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
  try {
    const response = await fetch(url, { ...options, signal: controller?.signal || options?.signal });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status || 0,
      text,
      url: response.url || url,
      retryAfter: response.headers?.get?.('Retry-After') || ''
    };
  } catch (cause) {
    return { ok: false, status: 0, text: '', url, error: String(cause?.message || cause) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const MIN_NDC_ALARM_DELAY_MS = 30000;

function retryAfterMilliseconds(raw, strike = 1) {
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(MIN_NDC_ALARM_DELAY_MS, seconds * 1000);
  const asDate = Date.parse(String(raw || ''));
  if (!Number.isNaN(asDate)) return Math.max(MIN_NDC_ALARM_DELAY_MS, asDate - Date.now());
  return Math.min(30000 * Math.pow(2, Math.max(0, strike - 1)), 10 * 60 * 1000);
}

async function readSharedRateLimitUntil() {
  const stored = await storageGetLocal(NDC_RATE_LIMIT_KEY, null);
  const until = Number(stored?.until);
  return Number.isFinite(until) ? until : 0;
}

async function publishSharedRateLimit(until) {
  if (!Number.isFinite(until) || until <= Date.now()) return;
  await enqueueStorageTask(NDC_RATE_LIMIT_KEY, async () => {
    const current = await readSharedRateLimitUntil();
    if (until <= current) return;
    await storageSetLocal(NDC_RATE_LIMIT_KEY, { until });
  });
}

const pendingTerminalDownloads = new Map();
const MAX_PENDING_TERMINALS = 200;

function rememberEarlyTerminal(downloadId, state, error) {
  pendingTerminalDownloads.set(downloadId, { state, error });
  while (pendingTerminalDownloads.size > MAX_PENDING_TERMINALS) {
    const oldest = pendingTerminalDownloads.keys().next().value;
    pendingTerminalDownloads.delete(oldest);
  }
}

function scheduleNdcJobAlarm(jobId, when) {
  try {
    chrome.alarms.create(`${NDC_ALARM_PREFIX}${jobId}`, {
      when: Math.max(Number(when) || 0, Date.now() + MIN_NDC_ALARM_DELAY_MS)
    });
  } catch (_) { }
}

function clearNdcJobAlarm(jobId) {
  try {
    chrome.alarms.clear(`${NDC_ALARM_PREFIX}${jobId}`, () => void getRuntimeError());
  } catch (_) { }
}

function ndcResolveFailure(code, response) {
  return {
    ok: false,
    code,
    status: response?.status || 0,
    retryAfter: response?.retryAfter || ''
  };
}

async function resolveNdcBrowserUrl(item, timeoutMs) {
  const page = await fetchNdcResponse(item.pageUrl, {
    method: 'GET',
    credentials: 'include'
  }, timeoutMs);
  if (responseLooksLoggedOut(page, page.text)) return { ok: false, code: 'requires_login' };
  if (!page.ok) return ndcResolveFailure(page.status === 429 ? 'rate_limited' : 'page_request_failed', page);

  const generated = await fetchNdcResponse(
    'https://www.nexusmods.com/Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl',
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: `fid=${encodeURIComponent(item.fileId)}&game_id=${encodeURIComponent(item.gameId)}`
    },
    timeoutMs
  );
  if (responseLooksLoggedOut(generated, generated.text)) return { ok: false, code: 'requires_login' };
  if (!generated.ok) {
    return ndcResolveFailure(generated.status === 429 ? 'rate_limited' : 'generate_failed', generated);
  }

  const url = findBackgroundDownloadUrl(generated.text);
  const verdict = NXTK.validateDownloadTarget(url, { method: 1 });
  if (!verdict.ok) return { ok: false, code: 'no_download_url' };
  return { ok: true, url: verdict.url };
}

async function startNdcDownload(job, item, url) {
  const requestedName = withFallbackExtension(
    item.name || 'nexus-download',
    extractDownloadExtension(url) || '.zip'
  );
  const filename = buildDownloadPath(job.folder, requestedName);
  const downloadId = await new Promise((resolve, reject) => {
    chrome.downloads.download({
      url,
      filename,
      conflictAction: conflictActionFor(filename),
      saveAs: false
    }, (id) => {
      const error = getRuntimeError();
      if (error || id === undefined) return reject(new Error(error || 'download-not-started'));
      ndcDownloadJobs.set(id, job.id);
      resolve(id);
    });
  });
  return { downloadId, filename };
}

async function finishNdcJob(job) {
  job.status = job.failed.length ? 'partial' : 'finished';
  job.activeDownloadId = null;
  job.finishedAt = Date.now();
  clearNdcJobAlarm(job.id);
  await saveNdcJob(job);
  if (job.type && !job.failed.length) {
    await STORAGE_HANDLERS.NDC_HISTORY_CLEAR_TYPE({
      gameId: job.gameId,
      collectionId: job.collectionId,
      type: job.type
    });
  }
  notifyNdcJob(job, 'NXT_NDC_DONE', { outcome: job.status });
  dropNdcJobItems(job.id);
}

const NDC_RESOLVE_RETRY_DELAY_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function advanceNdcJob(jobId) {
  for (;;) {
    let job = await readNdcJob(jobId);
    if (!job || job.status !== 'running' || job.activeDownloadId !== null) return null;
    const items = await readNdcJobItems(job);
    if (job.index >= items.length) {
      await finishNdcJob(job);
      return null;
    }

    const sharedUntil = await readSharedRateLimitUntil();
    if (sharedUntil > Date.now()) {
      job.waitingUntil = sharedUntil;
      await saveNdcJob(job);
      scheduleNdcJobAlarm(job.id, sharedUntil);
      notifyNdcJob(job, 'NXT_NDC_WAITING', {
        itemName: items[job.index]?.name || '',
        until: sharedUntil,
        reason: 'rate_limited'
      });
      return null;
    }

    const startIndex = job.index;
    const item = items[startIndex];
    const resolved = await resolveNdcBrowserUrl(item, job.requestTimeout);

    job = await readNdcJob(jobId);
    if (!job || job.status !== 'running' || job.activeDownloadId !== null) return null;
    if (job.index !== startIndex) continue;

    if (!resolved.ok) {
      if (resolved.code === 'rate_limited') {
        job.rateLimitStrikes = Math.min((job.rateLimitStrikes || 0) + 1, 6);
        job.waitingUntil = Date.now() + retryAfterMilliseconds(resolved.retryAfter, job.rateLimitStrikes);
        await saveNdcJob(job);
        await publishSharedRateLimit(job.waitingUntil);
        scheduleNdcJobAlarm(job.id, job.waitingUntil);
        notifyNdcJob(job, 'NXT_NDC_WAITING', {
          itemName: item.name,
          until: job.waitingUntil,
          reason: 'rate_limited'
        });
        return null;
      }
      if (resolved.code === 'requires_login') {
        job.status = 'requires_login';
        job.failed.push({ fileId: item.fileId, code: resolved.code });
        clearNdcJobAlarm(job.id);
        await saveNdcJob(job);
        notifyNdcJob(job, 'NXT_NDC_DONE', { outcome: 'requires_login', itemName: item.name });
        dropNdcJobItems(job.id);
        return null;
      }
      const attempts = Number(job.resolveAttempts || 0) + 1;
      job.resolveAttempts = attempts;
      if (attempts < 2) {
        await saveNdcJob(job);
        await sleep(NDC_RESOLVE_RETRY_DELAY_MS);
        continue;
      }
      job.failed.push({ fileId: item.fileId, code: resolved.code || 'request_failed' });
      job.resolveAttempts = 0;
      job.index += 1;
      await saveNdcJob(job);
      notifyNdcJob(job, 'NXT_NDC_PROGRESS', {
        itemName: item.name,
        itemState: 'failed',
        error: resolved.code || 'request_failed'
      });
      continue;
    }

    job.rateLimitStrikes = 0;
    job.waitingUntil = 0;
    job.resolveAttempts = 0;
    const started = await startNdcDownload(job, item, resolved.url);

    const afterStart = await readNdcJob(jobId);
    if (!afterStart || afterStart.status !== 'running') {
      ndcDownloadJobs.delete(started.downloadId);
      pendingTerminalDownloads.delete(started.downloadId);
      chrome.downloads.cancel(started.downloadId, () => void getRuntimeError());
      return null;
    }
    afterStart.activeDownloadId = started.downloadId;
    await saveNdcJob(afterStart);
    notifyNdcJob(afterStart, 'NXT_NDC_PROGRESS', {
      itemName: item.name,
      itemState: 'started'
    });

    const early = pendingTerminalDownloads.get(started.downloadId);
    if (early) {
      pendingTerminalDownloads.delete(started.downloadId);
      return { downloadId: started.downloadId, state: early.state, error: early.error };
    }
    return null;
  }
}

async function failNdcJob(jobId, cause, context = 'background collection queue') {
  let job = null;
  try {
    job = await readNdcJob(jobId);
  } catch (_) { }
  if (job && (job.status === 'running' || job.status === 'paused')) {
    job.status = 'error';
    try {
      job.lastError = NXTK.sanitizeDiagnosticText(cause?.message || cause, 300);
    } catch (_) {
      job.lastError = 'collection queue failed';
    }
    clearNdcJobAlarm(job.id);
    try {
      await saveNdcJob(job);
    } catch (_) { }
    try {
      notifyNdcJob(job, 'NXT_NDC_DONE', { outcome: 'error', error: job.lastError });
    } catch (_) { }
    dropNdcJobItems(job.id);
  }
  recordBackgroundError(context, cause);
}

async function processNdcJob(jobId) {
  if (ndcProcessingJobs.has(jobId)) return;
  ndcProcessingJobs.add(jobId);
  try {
    let currentId = jobId;
    while (currentId) {
      let replay = null;
      try {
        replay = await advanceNdcJob(currentId);
      } catch (cause) {
        await failNdcJob(currentId, cause);
        break;
      }
      if (!replay) break;
      const nextId = await handleNdcDownloadTerminal(replay.downloadId, replay.state, replay.error);
      currentId = nextId === currentId ? currentId : null;
    }
  } finally {
    ndcProcessingJobs.delete(jobId);
  }
}

const handledTerminalDownloads = new Set();

async function handleNdcDownloadTerminal(downloadId, state, error) {
  if (handledTerminalDownloads.has(downloadId)) return null;

  const job = await findNdcJobByDownloadId(downloadId);
  if (!job || job.activeDownloadId !== downloadId) {
    if (ndcDownloadJobs.has(downloadId)) rememberEarlyTerminal(downloadId, state, error);
    return null;
  }

  try {
    return await applyNdcDownloadTerminal(job, downloadId, state, error);
  } catch (cause) {
    await failNdcJob(job.id, cause, 'collection download terminal');
    return null;
  }
}

async function applyNdcDownloadTerminal(job, downloadId, state, error) {
  handledTerminalDownloads.add(downloadId);
  pendingTerminalDownloads.delete(downloadId);
  if (handledTerminalDownloads.size > 1000) {
    for (const id of handledTerminalDownloads) {
      handledTerminalDownloads.delete(id);
      if (handledTerminalDownloads.size <= 500) break;
    }
  }

  ndcDownloadJobs.delete(downloadId);
  job.activeDownloadId = null;

  if (job.status === 'stopped') {
    await saveNdcJob(job);
    return null;
  }

  const item = (await readNdcJobItems(job))[job.index];
  if (!item) {
    await finishNdcJob(job);
    return null;
  }

  let effectiveState = state;
  let effectiveError = error;
  if (state === 'complete') {
    const check = await verifyTransferSize(downloadId, item);
    if (check.suspicious) {
      effectiveState = 'interrupted';
      effectiveError = check.code;
    }
  }

  if (effectiveState === 'complete') {
    job.completed += 1;
    job.transferAttempts = 0;
    job.index += 1;
    if (job.type) {
      await STORAGE_HANDLERS.NDC_HISTORY_ADD({
        gameId: job.gameId,
        collectionId: job.collectionId,
        type: job.type,
        fileId: item.fileId
      });
    }
    await STORAGE_HANDLERS.TOTAL_DOWNLOADS_INCREMENT();
    await saveNdcJob(job);
    notifyNdcJob(job, 'NXT_NDC_PROGRESS', {
      itemName: item.name,
      itemState: 'complete'
    });
  } else if ((job.transferAttempts || 0) < 1) {
    job.transferAttempts = (job.transferAttempts || 0) + 1;
    await saveNdcJob(job);
    notifyNdcJob(job, 'NXT_NDC_PROGRESS', {
      itemName: item.name,
      itemState: 'retrying',
      error: effectiveError || 'interrupted'
    });
  } else {
    job.failed.push({ fileId: item.fileId, code: effectiveError || 'interrupted' });
    job.transferAttempts = 0;
    job.index += 1;
    await saveNdcJob(job);
    notifyNdcJob(job, 'NXT_NDC_PROGRESS', {
      itemName: item.name,
      itemState: 'failed',
      error: effectiveError || 'interrupted'
    });
  }

  return job.status === 'running' ? job.id : null;
}

async function haltNdcJob(job, { notifyTabIds = [] } = {}) {
  job.status = 'stopped';
  const activeDownloadId = job.activeDownloadId;
  job.activeDownloadId = null;
  clearNdcJobAlarm(job.id);
  await saveNdcJob(bumpNdcControl(job));
  if (Number.isInteger(activeDownloadId)) {
    ndcDownloadJobs.delete(activeDownloadId);
    pendingTerminalDownloads.delete(activeDownloadId);
    chrome.downloads.cancel(activeDownloadId, () => void getRuntimeError());
  }
  notifyNdcJob(job, 'NXT_NDC_DONE', { outcome: 'stopped' }, notifyTabIds);
  dropNdcJobItems(job.id);
  return job;
}

async function stopNdcJobsForTab(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  const jobs = await readNdcJobs();
  for (const job of Object.values(jobs)) {
    if (!ndcJobIsActive(job) || job.tabId !== tabId) continue;
    await haltNdcJob(job);
  }
}

if (chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    stopNdcJobsForTab(tabId).catch((cause) => recordBackgroundError('owner tab closed', cause));
  });
}

const NDC_CLAIM_KEY = 'nxtk_ndc_run_claims';
const NDC_CLAIM_TTL_MS = 45000;

function cleanNdcClaims(stored) {
  const claims = Object.create(null);
  const now = Date.now();
  if (!stored || typeof stored !== 'object') return claims;
  for (const [key, claim] of Object.entries(stored)) {
    if (typeof key !== 'string' || !key.includes('/') || FORBIDDEN_KEYS.has(key)) continue;
    const tabId = Number(claim?.tabId);
    const at = Number(claim?.at);
    if (!Number.isInteger(tabId) || tabId < 0 || !Number.isFinite(at)) continue;
    if (now - at > NDC_CLAIM_TTL_MS) continue;
    claims[key] = { tabId, at };
  }
  return claims;
}

async function resolveNdcJob(payload) {
  const jobId = String(payload?.jobId || '');
  if (jobId) {
    const job = await readNdcJob(jobId);
    if (job) return job;
  }
  const gameId = String(payload?.gameId || '');
  const collectionId = String(payload?.collectionId || '');
  if (!isSafeId(gameId) || !isSafeId(collectionId)) return null;
  return findActiveNdcJobForCollection(gameId, collectionId);
}

const NDC_QUEUE_HANDLERS = {
  async NDC_QUEUE_START(payload, sender) {
    const tabId = Number(sender?.tab?.id);
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error('missing-tab');
    const rawItems = Array.isArray(payload?.items) ? payload.items : [];
    if (!rawItems.length || rawItems.length > MAX_NDC_JOB_ITEMS) throw new Error('invalid-job-size');
    const items = rawItems.map(sanitizeNdcJobItem);
    if (items.some((item) => !item)) throw new Error('invalid-job-item');
    const type = payload?.type === null || payload?.type === undefined ? null : payload.type;
    if (type !== null && !HISTORY_TYPES.has(type)) throw new Error('invalid-history-type');
    const gameId = String(payload?.gameId || '');
    const collectionId = String(payload?.collectionId || '');
    if (!isSafeId(gameId) || !isSafeId(collectionId)) throw new Error('invalid-collection-identifier');

    const scopeKey = ndcScopeKey(type, items);
    const existing = await findActiveNdcJobForCollection(gameId, collectionId);
    const isReconnect = !!existing
      && !payload?.restart
      && existing.type === type
      && (type !== null || existing.scopeKey === scopeKey);
    if (isReconnect) {
      existing.tabId = tabId;
      await saveNdcJob(existing);
      if (existing.status === 'running') {
        processNdcJob(existing.id).catch((cause) => recordBackgroundError('resume adopted job', cause));
      }
      return {
        jobId: existing.id,
        total: ndcJobItemCount(existing),
        index: existing.index,
        completed: existing.completed,
        status: existing.status,
        adopted: true
      };
    }

    if (existing) {
      existing.status = 'stopped';
      const supersededDownloadId = existing.activeDownloadId;
      existing.activeDownloadId = null;
      clearNdcJobAlarm(existing.id);
      await saveNdcJob(bumpNdcControl(existing));
      if (Number.isInteger(supersededDownloadId)) {
        ndcDownloadJobs.delete(supersededDownloadId);
        pendingTerminalDownloads.delete(supersededDownloadId);
        chrome.downloads.cancel(supersededDownloadId, () => void getRuntimeError());
      }
      dropNdcJobItems(existing.id);
    }

    const jobId = makeNdcJobId();
    await writeNdcJobItems(jobId, items);
    const job = {
      id: jobId,
      tabId,
      gameId,
      collectionId,
      type,
      scopeKey,
      folder: sanitizePathSegment(payload?.folder, { allowDots: false }),
      requestTimeout: Math.min(Math.max(Number(payload?.requestTimeout) || 30000, 5000), 120000),
      itemCount: items.length,
      index: 0,
      completed: 0,
      failed: [],
      status: 'running',
      activeDownloadId: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await saveNdcJob(job);
    await processNdcJob(job.id);
    return { jobId: job.id, total: items.length };
  },

  async NDC_QUEUE_STATUS(payload) {
    const job = await resolveNdcJob(payload);
    if (!job) return null;
    return {
      jobId: job.id,
      status: job.status,
      index: job.index,
      total: ndcJobItemCount(job),
      completed: job.completed,
      failedCount: job.failed.length,
      waitingUntil: Number(job.waitingUntil) || 0,
      lastError: String(job.lastError || '')
    };
  },

  async NDC_QUEUE_ATTACH(payload, sender) {
    const tabId = Number(sender?.tab?.id);
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error('missing-tab');
    const gameId = String(payload?.gameId || '');
    const collectionId = String(payload?.collectionId || '');
    if (!isSafeId(gameId) || !isSafeId(collectionId)) throw new Error('invalid-collection-identifier');

    const job = await findActiveNdcJobForCollection(gameId, collectionId);
    if (!job) return null;

    job.tabId = tabId;
    await saveNdcJob(job);

    if (job.status === 'running' && job.activeDownloadId === null) {
      processNdcJob(job.id).catch((cause) => recordBackgroundError('attach nudge', cause));
    }

    return {
      jobId: job.id,
      status: job.status,
      index: job.index,
      total: ndcJobItemCount(job),
      completed: job.completed,
      failedCount: job.failed.length,
      type: job.type
    };
  },

  async NDC_QUEUE_STOP(payload, sender) {
    const job = await resolveNdcJob(payload);
    if (!job) throw new Error('job-not-found');
    await haltNdcJob(job, { notifyTabIds: [Number(sender?.tab?.id)] });
    return { stopped: true };
  },

  async NDC_QUEUE_PAUSE(payload) {
    const job = await resolveNdcJob(payload);
    if (!job) throw new Error('job-not-found');
    if (job.status === 'running') job.status = 'paused';
    await saveNdcJob(bumpNdcControl(job));
    notifyNdcJob(job, 'NXT_NDC_STATE');
    return { paused: true };
  },

  async NDC_QUEUE_RESUME(payload) {
    const job = await resolveNdcJob(payload);
    if (!job) throw new Error('job-not-found');
    if (job.status === 'paused') job.status = 'running';
    await saveNdcJob(bumpNdcControl(job));
    notifyNdcJob(job, 'NXT_NDC_STATE');
    await processNdcJob(job.id);
    return { resumed: true };
  },

  async NDC_RUN_CLAIM(payload, sender) {
    const tabId = Number(sender?.tab?.id);
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error('missing-tab');
    const gameId = String(payload?.gameId || '');
    const collectionId = String(payload?.collectionId || '');
    if (!isSafeId(gameId) || !isSafeId(collectionId)) throw new Error('invalid-collection-identifier');

    const liveJob = await findActiveNdcJobForCollection(gameId, collectionId);
    if (liveJob && liveJob.tabId !== tabId) {
      return { granted: false, heldBy: liveJob.tabId, reason: 'background-job' };
    }

    return enqueueStorageTask(NDC_CLAIM_KEY, async () => {
      const claims = cleanNdcClaims(await storageGetLocal(NDC_CLAIM_KEY, null));
      const key = `${gameId}/${collectionId}`;
      const held = claims[key];
      if (held && held.tabId !== tabId) return { granted: false, heldBy: held.tabId, reason: 'lease' };
      claims[key] = { tabId, at: Date.now() };
      await storageSetLocal(NDC_CLAIM_KEY, claims);
      return { granted: true };
    });
  },

  async NDC_RUN_RELEASE(payload, sender) {
    const tabId = Number(sender?.tab?.id);
    const gameId = String(payload?.gameId || '');
    const collectionId = String(payload?.collectionId || '');
    if (!isSafeId(gameId) || !isSafeId(collectionId)) return { released: false };

    return enqueueStorageTask(NDC_CLAIM_KEY, async () => {
      const claims = cleanNdcClaims(await storageGetLocal(NDC_CLAIM_KEY, null));
      const key = `${gameId}/${collectionId}`;
      if (!claims[key] || claims[key].tabId !== tabId) return { released: false };
      delete claims[key];
      await storageSetLocal(NDC_CLAIM_KEY, claims);
      return { released: true };
    });
  }
};

if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    const name = String(alarm?.name || '');
    if (!name.startsWith(NDC_ALARM_PREFIX)) return;
    processNdcJob(name.slice(NDC_ALARM_PREFIX.length))
      .catch((cause) => recordBackgroundError('rate-limit alarm', cause));
  });
}

if (chrome.downloads?.onChanged) {
  chrome.downloads.onChanged.addListener((delta) => {
    const downloadId = Number(delta?.id);
    const state = String(delta?.state?.current || '');
    if (!Number.isInteger(downloadId) || !['complete', 'interrupted'].includes(state)) return;

    handleNdcDownloadTerminal(downloadId, state, delta?.error?.current || null)
      .then((nextJobId) => (nextJobId ? processNdcJob(nextJobId) : undefined))
      .catch((cause) => recordBackgroundError('collection download terminal', cause));
  });
}

function searchDownload(downloadId) {
  return new Promise((resolve) => {
    try {
      chrome.downloads.search({ id: downloadId }, (results) => {
        if (getRuntimeError()) return resolve(null);
        resolve(Array.isArray(results) && results.length ? results[0] : null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

async function reconcileNdcJobs() {
  if (!hasDownloadsApi()) return;
  const jobs = await readNdcJobs();

  for (const job of Object.values(jobs)) {
    if (job.status !== 'running') continue;

    if (Number.isInteger(job.activeDownloadId)) {
      const record = await searchDownload(job.activeDownloadId);
      if (!record) {
        const nextJobId = await handleNdcDownloadTerminal(job.activeDownloadId, 'interrupted', 'download-record-missing');
        if (nextJobId) await processNdcJob(nextJobId);
        continue;
      }
      if (record.state === 'complete' || record.state === 'interrupted') {
        const nextJobId = await handleNdcDownloadTerminal(job.activeDownloadId, record.state, record.error || null);
        if (nextJobId) await processNdcJob(nextJobId);
      }
      continue;
    }

    const waitingUntil = Number(job.waitingUntil) || 0;
    if (waitingUntil > Date.now()) {
      scheduleNdcJobAlarm(job.id, waitingUntil);
      continue;
    }

    await processNdcJob(job.id);
  }
}

async function migrateNdcJobItems() {
  const stored = await storageGetLocal(NDC_JOBS_KEY, null);
  if (!stored || typeof stored !== 'object') return;
  const legacy = Object.entries(stored).filter(([, job]) => Array.isArray(job?.items) && job.items.length);
  if (!legacy.length) return;

  for (const [jobId, job] of legacy) await writeNdcJobItems(jobId, job.items);

  await enqueueStorageTask(NDC_JOBS_KEY, async () => {
    const current = await storageGetLocal(NDC_JOBS_KEY, null);
    if (!current || typeof current !== 'object') return;
    const next = Object.create(null);
    for (const [jobId, job] of Object.entries(current)) {
      if (!job || typeof job !== 'object') continue;
      if (!Array.isArray(job.items)) {
        next[jobId] = job;
        continue;
      }
      const { items, ...cursor } = job;
      cursor.itemCount = items.length;
      next[jobId] = cursor;
    }
    await storageSetLocal(NDC_JOBS_KEY, next);
  });
}

async function pruneOrphanedNdcItems() {
  const jobs = await readNdcJobs();
  const all = await new Promise((resolve) => {
    try {
      chrome.storage.local.get(null, (result) => resolve(getRuntimeError() ? null : result));
    } catch (_) {
      resolve(null);
    }
  });
  if (!all) return;
  const stale = Object.keys(all).filter((key) => (
    key.startsWith(NDC_ITEMS_KEY_PREFIX) && !jobs[key.slice(NDC_ITEMS_KEY_PREFIX.length)]
  ));
  if (!stale.length) return;
  for (const key of stale) ndcItemsCache.delete(key.slice(NDC_ITEMS_KEY_PREFIX.length));
  try {
    chrome.storage.local.remove(stale, () => void getRuntimeError());
  } catch (_) { }
}

migrateNdcJobItems()
  .then(() => reconcileNdcJobs())
  .catch((cause) => recordBackgroundError('reconcile collection jobs', cause));

if (chrome.runtime?.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    migrateNdcJobItems()
      .then(() => pruneOrphanedNdcItems())
      .then(() => reconcileNdcJobs())
      .catch((cause) => recordBackgroundError('reconcile on startup', cause));
  });
}

const TRUSTED_SENDER_URL = /^https:\/\/(?:[\w-]+\.)*nexusmods\.com\//i;

function isTrustedSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  if (!sender.url) return true;
  if (sender.url.startsWith(chrome.runtime.getURL(''))) return true;
  return TRUSTED_SENDER_URL.test(sender.url);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!isTrustedSender(sender)) return false;

  if (msg?.type === 'OPEN_REPORT_ISSUE') {
    const url = typeof msg.url === 'string' && msg.url.startsWith(NXTK.ISSUE_NEW_URL)
      ? msg.url
      : NXTK.REPORT_ISSUE_URL;
    chrome.tabs.create({ url }, (tab) => {
      const error = getRuntimeError();
      if (error) {
        recordBackgroundError('OPEN_REPORT_ISSUE', error);
        sendResponse({ ok: false, error });
        return;
      }
      sendResponse({ ok: true, tabId: tab?.id || null });
    });
    return true;
  }

  if (msg?.type === 'CLOSE_TAB') {
    if (!sender.tab?.id) {
      sendResponse({ ok: false, error: 'No tab is available to close.' });
      return false;
    }
    chrome.tabs.remove(sender.tab.id, () => void getRuntimeError());
    sendResponse({ ok: true });
    return false;
  }

  const storageHandler = STORAGE_HANDLERS[msg?.type]
    || DOWNLOAD_HANDLERS[msg?.type]
    || NDC_QUEUE_HANDLERS[msg?.type];
  if (storageHandler) {
    storageHandler(msg.payload, sender)
      .then((value) => sendResponse({ ok: true, value, error: null }))
      .catch((cause) => {
        const message = String(cause?.message || cause || 'storage-mutation-failed');
        recordBackgroundError(msg.type, message);
        sendResponse({ ok: false, value: null, error: message });
      });
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details?.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/welcome.html') }, () => {
      const error = getRuntimeError();
      if (error) recordBackgroundError('onInstalled welcome', error);
    });
  }

  try {
    chrome.storage.local.remove(RETIRED_STORAGE_KEYS, () => void getRuntimeError());
  } catch (_) { }

  chrome.storage.local.get(NXTK.SETTINGS_KEY, (result) => {
    const readError = getRuntimeError();
    if (readError) {
      recordBackgroundError('onInstalled read', readError);
      return;
    }

    const stored = result?.[NXTK.SETTINGS_KEY];
    let next;
    if (stored) {
      const hasLegacyKeys = LEGACY_SETTINGS_KEYS.some((key) => key in stored);
      const hasStaleSpeed = Number(stored.NDC_downloadSpeed) === LEGACY_SPEED_DEFAULT;
      if (!hasLegacyKeys && !hasStaleSpeed) return;
      next = { ...stored };
      LEGACY_SETTINGS_KEYS.forEach((key) => delete next[key]);
      if (hasStaleSpeed) next.NDC_downloadSpeed = NXTK.DEFAULTS.NDC_downloadSpeed;
    } else {
      next = { ...NXTK.DEFAULTS };
    }

    chrome.storage.local.set({ [NXTK.SETTINGS_KEY]: next }, () => {
      const writeError = getRuntimeError();
      if (writeError) recordBackgroundError('onInstalled write', writeError);
    });
  });
});
