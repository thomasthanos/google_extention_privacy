window.NexusExt = window.NexusExt || {};

(function () {
  'use strict';

  const DOWNLOAD_METHOD_VORTEX = 0;
  const DOWNLOAD_METHOD_BROWSER = 1;

  const STATUS_DOWNLOADING = 0;
  const STATUS_PAUSED = 1;
  const STATUS_FINISHED = 2;
  const STATUS_STOPPED = 3;

  const STATUS_TEXT = {
    [STATUS_DOWNLOADING]: 'Downloading...',
    [STATUS_PAUSED]: 'Paused',
    [STATUS_FINISHED]: 'Finished',
    [STATUS_STOPPED]: 'Stopped'
  };
  const Errors = NexusExt.Errors;
  const Auth = NexusExt.Auth;

  const convertSize = (sizeInKB) => {
    const sizeInMB = sizeInKB / 1024;
    const sizeInGB = sizeInMB / 1024;
    return sizeInGB >= 1 ? `${sizeInGB.toFixed(2)} GB` : `${sizeInMB.toFixed(2)} MB`;
  };

  const formatDuration = (totalSeconds) => {
    const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
    if (seconds < 60) return `${seconds}s`;
    const pad = (value) => String(value).padStart(2, '0');
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return hours
      ? `${hours}:${pad(minutes)}:${pad(secs)}`
      : `${minutes}:${pad(secs)}`;
  };

  const escapeHtml = NXTK.escapeHtml;
  const T = (key, fallback) => NXTK.t(key, null, fallback);
  const TS = (key, subs, fallback) => NXTK.t(key, subs.map(String), fallback);

  const DEFAULT_DOWNLOAD_SPEED = 3.2;
  const MAX_PAUSE_SECONDS = 10 * 60;

  const RATE_LIMIT_BASE_SECONDS = 30;
  const RATE_LIMIT_MAX_SECONDS = 10 * 60;
  const RATE_LIMIT_MAX_STRIKES = 6;

  const MAX_QUEUE_POLL_FAILURES = 5;

  const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  class NDC {
    constructor(gameId, collectionId, revision = null) {
      this.gameId = gameId;
      this.collectionId = collectionId;
      this.revision = revision;

      this.mods = { all: [], mandatory: [], optional: [] };
      this.pauseBetweenDownload = 5;
      this.downloadSpeed = DEFAULT_DOWNLOAD_SPEED;
      this.downloadMethod = DOWNLOAD_METHOD_VORTEX;
      this.requestTimeout = Errors.DEFAULT_TIMEOUT_MS;
      this.showAlertsOnError = true;
      this.downloadFolder = 'NexusMods';
      this.lastError = null;
      this.disposed = false;
      this.initialized = false;
      this.lifecycleController = typeof AbortController === 'function' ? new AbortController() : null;
      this.downloadController = null;
      this.backgroundJobId = null;
      this.settleBrowserQueue = null;
      this.claimTimer = null;
      this.onSettingsChanged = null;
      this.running = false;

      this.runStatus = STATUS_DOWNLOADING;

      this.ui = null;
    }

    get lifecycleSignal() {
      return this.lifecycleController?.signal || null;
    }

    get downloadSignal() {
      return this.downloadController?.signal || null;
    }

    stopDownload() {
      this.running = false;
      this.runStatus = STATUS_STOPPED;
      this.stopBackgroundQueue();
      try {
        this.downloadController?.abort();
      } catch (_) { }
      this.downloadController = null;
    }

    queueTarget() {
      return {
        jobId: this.backgroundJobId || null,
        gameId: this.gameId,
        collectionId: this.collectionId
      };
    }

    stopBackgroundQueue() {
      Promise.resolve(NexusExt.Storage.sendDownloadCommand('NDC_QUEUE_STOP', this.queueTarget()))
        .then((reply) => {
          if (!reply?.ok) this.settleBrowserQueue?.('stopped');
        })
        .catch(() => this.settleBrowserQueue?.('stopped'));
    }

    setPaused(paused) {
      NexusExt.Storage.sendDownloadCommand(
        paused ? 'NDC_QUEUE_PAUSE' : 'NDC_QUEUE_RESUME',
        this.queueTarget()
      ).catch?.(() => undefined);
    }

    dispose() {
      this.disposed = true;
      this.running = false;
      this.runStatus = STATUS_STOPPED;
      if (this.onSettingsChanged) {
        try {
          chrome.storage.onChanged.removeListener(this.onSettingsChanged);
        } catch (_) { }
        this.onSettingsChanged = null;
      }
      this.releaseRunClaim();
      this.settleBrowserQueue?.('stopped');
      for (const controller of [this.downloadController, this.lifecycleController]) {
        try {
          controller?.abort();
        } catch (_) { }
      }
      this.downloadController = null;
    }

    // Renew the worker claim to prevent duplicate collection runs across tabs.
    async acquireRunClaim() {
      const reply = await NexusExt.Storage.sendDownloadCommand('NDC_RUN_CLAIM', {
        gameId: this.gameId,
        collectionId: this.collectionId
      });
      if (!reply?.ok) return { granted: true };
      if (!reply.value?.granted) return { granted: false, reason: reply.value?.reason || 'lease' };

      clearInterval(this.claimTimer);
      this.claimTimer = setInterval(() => {
        NexusExt.Storage.sendDownloadCommand('NDC_RUN_CLAIM', {
          gameId: this.gameId,
          collectionId: this.collectionId
        }).catch?.(() => undefined);
      }, 15000);
      return { granted: true };
    }

    releaseRunClaim() {
      clearInterval(this.claimTimer);
      this.claimTimer = null;
      NexusExt.Storage.sendDownloadCommand('NDC_RUN_RELEASE', {
        gameId: this.gameId,
        collectionId: this.collectionId
      }).catch?.(() => undefined);
    }

    isStopped() {
      return this.disposed || this.runStatus === STATUS_STOPPED;
    }

    resolveDownloadSpeed() {
      const manual = Number(this.downloadSpeed);
      const isCustom = Number.isFinite(manual) && manual > 0
        && Math.abs(manual - DEFAULT_DOWNLOAD_SPEED) > 0.001;
      return isCustom
        ? { speed: manual, source: T('speedSourceCustom', 'your setting') }
        : { speed: DEFAULT_DOWNLOAD_SPEED, source: T('speedSourceDefault', 'default') };
    }

    async init() {
      const settings = await NexusExt.Storage.getSettings();
      this.pauseBetweenDownload = settings.NDC_pauseBetweenDownload;
      this.downloadSpeed = settings.NDC_downloadSpeed;
      this.downloadMethod = settings.NDC_downloadMethod;
      this.requestTimeout = settings.RequestTimeout || Errors.DEFAULT_TIMEOUT_MS;
      this.showAlertsOnError = settings.ShowAlertsOnError !== false;
      this.downloadFolder = settings.DownloadFolder ?? '';
      this.wabbajackImport = settings.WabbajackImport === true;

      this.watchSettings();

      const response = await this.fetchMods();
      if (!response) return false;

      const mods = response.modFiles.sort((a, b) => nameCollator.compare(a.file.mod.name, b.file.mod.name));
      this.mods = {
        all: mods,
        mandatory: mods.filter(m => !m.optional),
        optional: mods.filter(m => m.optional)
      };
      this.initialized = true;
      return true;
    }

    watchSettings() {
      if (this.onSettingsChanged) return;
      this.onSettingsChanged = (changes, area) => {
        if (area !== 'local' || !changes?.[NXTK.SETTINGS_KEY]) return;
        this.applySettings(changes[NXTK.SETTINGS_KEY].newValue);
      };
      try {
        chrome.storage.onChanged.addListener(this.onSettingsChanged);
      } catch (_) {
        this.onSettingsChanged = null;
      }
    }

    applySettings(settings) {
      if (!settings || typeof settings !== 'object') return;
      const next = { ...(NexusExt.Storage?.DEFAULTS || {}), ...settings };
      this.pauseBetweenDownload = next.NDC_pauseBetweenDownload;
      this.downloadSpeed = next.NDC_downloadSpeed;
      this.requestTimeout = next.RequestTimeout || Errors.DEFAULT_TIMEOUT_MS;
      this.showAlertsOnError = next.ShowAlertsOnError !== false;
      this.downloadFolder = next.DownloadFolder ?? '';
      this.wabbajackImport = next.WabbajackImport === true;
      NXTK.setForceEnglish(next.ForceEnglish);
    }

    async initFromMods(mods) {
      const settings = await NexusExt.Storage.getSettings();
      this.pauseBetweenDownload = settings.NDC_pauseBetweenDownload;
      this.downloadSpeed = settings.NDC_downloadSpeed;
      this.downloadMethod = settings.NDC_downloadMethod;
      this.requestTimeout = settings.RequestTimeout || Errors.DEFAULT_TIMEOUT_MS;
      this.showAlertsOnError = settings.ShowAlertsOnError !== false;
      this.downloadFolder = settings.DownloadFolder ?? '';
      this.wabbajackImport = settings.WabbajackImport === true;

      this.watchSettings();

      const sorted = [...mods].sort((a, b) => nameCollator.compare(a.file.mod.name, b.file.mod.name));
      this.mods = { all: sorted, mandatory: sorted, optional: [] };
      this.external = true;
      this.initialized = true;
      return true;
    }

    async fetchMods(collectionId = this.collectionId, revision = this.revision) {
      const response = await Errors.request('https://api-router.nexusmods.com/graphql', {
        headers: { 'content-type': 'application/json' },
        referrer: document.location.href,
        referrerPolicy: 'strict-origin-when-cross-origin',
        body: JSON.stringify({
          query: 'query CollectionRevisionMods ($revision: Int, $slug: String!, $viewAdultContent: Boolean) { collectionRevision (revision: $revision, slug: $slug, viewAdultContent: $viewAdultContent) { externalResources { id, name, resourceType, resourceUrl }, modFiles { fileId, optional, file { fileId, name, uri, size, version, date, mod { adult, modId, name, version, game { domainName, id } } } } } }',
          variables: { slug: collectionId, viewAdultContent: true, revision: revision },
          operationName: 'CollectionRevisionMods'
        }),
        method: 'POST',
        mode: 'cors',
        credentials: 'include'
      }, {
        timeoutMs: this.requestTimeout,
        context: 'Loading collection details',
        signal: this.lifecycleSignal
      });

      if (!response.ok) {
        this.lastError = response.error;
        return null;
      }

      let json;
      try {
        json = JSON.parse(response.text);
      } catch (cause) {
        this.lastError = Errors.create('invalid_response', {
          context: 'Reading collection details',
          technicalMessage: String(cause?.message || '')
        });
        return null;
      }

      if (!json?.data?.collectionRevision) {
        this.lastError = Errors.classifyContent(response.text, { context: 'Loading collection details' })
          || Errors.create('invalid_response', { context: 'Loading collection details' });
        return null;
      }

      json.data.collectionRevision.modFiles = json.data.collectionRevision.modFiles.map(modFile => {
        modFile.file.url = `https://www.nexusmods.com/${modFile.file.mod.game.domainName}/mods/${modFile.file.mod.modId}?tab=files&file_id=${modFile.file.fileId}`;
        return modFile;
      });

      this.lastError = null;
      return json.data.collectionRevision;
    }

    async fetchDownloadLink(mod) {
      let pageResponse;
      if (this.downloadMethod === DOWNLOAD_METHOD_VORTEX) {
        pageResponse = await Errors.request(`${mod.file.url}&nmm=1`, {
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        }, {
          timeoutMs: this.requestTimeout,
          context: 'Loading Vortex download link',
          signal: this.downloadSignal
        });
      } else {
        pageResponse = await Errors.request(mod.file.url, {
          credentials: 'include'
        }, {
          timeoutMs: this.requestTimeout,
          context: 'Loading browser download link',
          signal: this.downloadSignal
        });
      }
      const text = pageResponse.text;
      const pageLoginError = Auth?.getResponseLoginError?.(pageResponse, 'Loading collection download link');
      if (pageLoginError) return { downloadUrl: '', text, rateLimit: pageResponse.rateLimit, error: pageLoginError };
      if (!pageResponse.ok) return { downloadUrl: '', text, rateLimit: pageResponse.rateLimit, error: pageResponse.error };

      let downloadUrl = '';
      if (this.downloadMethod === DOWNLOAD_METHOD_VORTEX) {
        const extracted = NexusExt.NNW?.parseDownloadURLFromResponse?.(text);
        downloadUrl = NexusExt.NNW?.parseNxmDownloadLink?.(extracted?.url)
          || NexusExt.NNW?.parseNxmDownloadLink?.(text)
          || '';

        if (!downloadUrl && NexusExt.NNW?.getDownloadUrl) {
          const resolved = await NexusExt.NNW.getDownloadUrl({
            fileId: mod.fileId || mod.file.fileId,
            gameId: mod.file.mod.game.id,
            isNMM: true,
            href: `${mod.file.url}&nmm=1`,
            prefetchedText: text,
            prefetchedFinalUrl: pageResponse.finalUrl,
            prefetchedStatus: pageResponse.status,
            signal: this.downloadSignal
          });
          downloadUrl = resolved?.url || '';
          if (!downloadUrl && resolved?.error) {
            return { downloadUrl: '', text, error: resolved.error };
          }
        }
      } else {
        NexusExt.NNW?.refreshAdTimerCookie?.();
        const generatedResponse = await Errors.request(
          'https://www.nexusmods.com/Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl',
          {
            headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: `fid=${encodeURIComponent(mod.fileId || mod.file.fileId)}&game_id=${encodeURIComponent(mod.file.mod.game.id)}`,
            method: 'POST',
            credentials: 'include'
          }, {
            timeoutMs: this.requestTimeout,
            context: 'Generating collection download link',
            signal: this.downloadSignal
          }
        );
        const generatedLoginError = Auth?.getResponseLoginError?.(generatedResponse, 'Generating collection download link');
        if (generatedLoginError) {
          return { downloadUrl: '', text: generatedResponse.text, rateLimit: generatedResponse.rateLimit, error: generatedLoginError };
        }
        if (!generatedResponse.ok) {
          return { downloadUrl: '', text: generatedResponse.text, rateLimit: generatedResponse.rateLimit, error: generatedResponse.error };
        }
        const extracted = NexusExt.NNW?.parseDownloadURLFromResponse?.(generatedResponse.text);
        if (extracted?.url) {
          downloadUrl = extracted.url;
        }
      }
      return {
        downloadUrl,
        text,
        error: downloadUrl ? null : Errors.create(
          this.downloadMethod === DOWNLOAD_METHOD_VORTEX ? 'no_nmm_link' : 'no_download_url',
          { context: 'Reading collection download link' }
        )
      };
    }

    noteRateLimited(retryAfterSeconds) {
      const explicit = Number(retryAfterSeconds);
      this.rateLimitStrikes = Math.min((this.rateLimitStrikes || 0) + 1, RATE_LIMIT_MAX_STRIKES);
      const backoff = Number.isFinite(explicit) && explicit > 0
        ? explicit
        : Math.min(RATE_LIMIT_BASE_SECONDS * Math.pow(2, this.rateLimitStrikes - 1), RATE_LIMIT_MAX_SECONDS);
      const until = Date.now() + Math.min(backoff, RATE_LIMIT_MAX_SECONDS) * 1000;
      this.rateLimitedUntil = Math.max(this.rateLimitedUntil || 0, until);
      NexusExt.Storage.saveRateLimit?.({ until: this.rateLimitedUntil });
      return Math.round((this.rateLimitedUntil - Date.now()) / 1000);
    }

    noteRateLimitCleared() {
      this.rateLimitStrikes = 0;
    }

    async waitOutRateLimit() {
      const shared = await NexusExt.Storage.getRateLimit();
      const until = Math.max(this.rateLimitedUntil || 0, Number(shared?.until) || 0);
      let remaining = Math.round((until - Date.now()) / 1000);
      if (!(remaining > 0)) return;

      const waitingText = (left) => TS('logRateLimitWaiting', [formatDuration(left)],
        `Nexus Mods is rate limiting requests. Waiting ${formatDuration(left)}...`);
      const logRow = this.ui.logText(waitingText(remaining), 'info');
      await new Promise((resolve) => {
        const intervalId = setInterval(() => {
          if (this.isStopped()) {
            clearInterval(intervalId);
            return resolve();
          }
          const msgSpan = logRow?.querySelector('.nxtk-log-msg');
          remaining = Math.round((until - Date.now()) / 1000);

          if (this.runStatus === STATUS_PAUSED) {
            if (msgSpan) {
              msgSpan.textContent = remaining > 0
                ? TS('logPausedRateLimit', [formatDuration(remaining)],
                    `Paused. Nexus rate limit clears in ${formatDuration(remaining)}.`)
                : T('logPausedRateLimitDone', 'Paused. The rate limit has cleared — press play to continue.');
            }
            return;
          }

          if (remaining > 0) {
            if (msgSpan) msgSpan.textContent = waitingText(remaining);
            return;
          }
          clearInterval(intervalId);
          if (msgSpan) msgSpan.textContent = T('logRateLimitCleared', 'Rate limit cleared. Resuming downloads.');
          resolve();
        }, 1000);
      });
    }

    delayWithPause(totalMs) {
      return new Promise((resolve) => {
        let remaining = Math.max(0, Number(totalMs) || 0);
        let lastTickAt = Date.now();
        const tick = 100;
        const timer = setInterval(() => {
          const now = Date.now();
          if (this.isStopped() || this.downloadSignal?.aborted) {
            clearInterval(timer);
            return resolve();
          }
          if (this.runStatus === STATUS_PAUSED) {
            lastTickAt = now;
            return;
          }
          remaining -= Math.max(0, now - lastTickAt);
          lastTickAt = now;
          if (remaining <= 0) {
            clearInterval(timer);
            resolve();
          }
        }, tick);
      });
    }

    resolveLinkError(result) {
      return Errors.normalize(
        result?.error
        || Errors.classifyContent(result?.text, { context: 'Preparing collection download' })
        || Errors.create(this.downloadMethod === DOWNLOAD_METHOD_VORTEX ? 'no_nmm_link' : 'no_download_url')
      );
    }

    async fetchDownloadLinkWithRetry(mod, { attempts = 2, delayMs = 500, onAttemptFailed = null } = {}) {
      let result;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          result = await this.fetchDownloadLink(mod);
        } catch (cause) {
          result = {
            downloadUrl: '',
            text: '',
            error: Errors.fromException(cause, { context: 'Preparing collection download' })
          };
        }

        if (result.downloadUrl) {
          this.noteRateLimitCleared();
          return result;
        }
        if (this.isStopped()) return result;

        const error = this.resolveLinkError(result);
        result.error = error;

        if (error.code === 'rate_limited') {
          const waitSeconds = this.noteRateLimited(result.rateLimit?.retryAfterSeconds);
          this.ui.logText(TS('logBackingOff', [formatDuration(waitSeconds)],
            `Nexus Mods is rate limiting requests. Backing off ${formatDuration(waitSeconds)}.`), 'info');
          if (attempt >= attempts) return result;
          await this.waitOutRateLimit();
          if (this.isStopped()) return result;
          continue;
        }

        if (attempt >= attempts || !error.retryable || Errors.isBlocking(error)) return result;

        onAttemptFailed?.(error, attempt);
        await this.delayWithPause(delayMs);
        if (this.isStopped()) return result;
      }
      return result;
    }

    fileLinkFor(mod) {
      const url = mod.file.url;
      return this.downloadMethod === DOWNLOAD_METHOD_VORTEX ? `${url}&nmm=1` : url;
    }

    handOffDownload(mod, downloadUrl, prefix) {
      const sizeStr = convertSize(mod.file.size);
      const fileName = escapeHtml(mod.file.name);
      const fileUrl = escapeHtml(this.fileLinkFor(mod));
      const meta = `<span style="opacity:0.6;font-size:11px">(${sizeStr})</span>`;
      const link = `<a href="${fileUrl}" target="_blank" rel="noopener noreferrer">${fileName}</a>`;

      const verdict = NXTK.validateDownloadTarget(downloadUrl, { method: DOWNLOAD_METHOD_VORTEX });
      if (!verdict.ok) {
        const error = Errors.create('unsafe_download_url', {
          context: 'Validating download target',
          technicalMessage: `rejected: ${verdict.detail} | method=vortex`
        });
        this.ui.log(`${prefix} ${escapeHtml(Errors.toLogMessage(error))} ${link}`, 'error');
        return false;
      }

      this.ui.log(`${prefix} ${T('logSendingToVortex', 'Sending to Vortex:')} ${link} ${meta}`);
      document.location.href = downloadUrl;
      return true;
    }

    async retryMod(mod, { type = null, onSucceeded = null } = {}) {
      if (this.isStopped()) {
        this.ui?.logText(T('logRetryIgnored', 'Retry ignored: this collection run was stopped.'), 'info');
        return;
      }

      const result = await this.fetchDownloadLinkWithRetry(mod);
      if (this.isStopped()) return;

      if (result.downloadUrl) {
        if (this.handOffDownload(mod, result.downloadUrl, 'Retry:')) {
          NXTK.bumpTotalDownloads?.();
          if (type !== null) {
            try {
              await this.recordHistoryEntry(type, mod.fileId);
            } catch (_) { }
          }
          onSucceeded?.();
        }
        return;
      }

      const error = this.resolveLinkError(result);
      const link = `<a href="${escapeHtml(this.fileLinkFor(mod))}" target="_blank" rel="noopener noreferrer">${escapeHtml(mod.file.name)}</a>`;
      this.ui.log(`${TS('logRetryFailed', [escapeHtml(Errors.toLogMessage(error))], `Retry failed: ${escapeHtml(Errors.toLogMessage(error))}`)} ${link}`, 'error');
      if (this.showAlertsOnError && error.retryable) {
        NexusExt.UI.showError(error, { title: NXTK.t('dlgDownloadIssue', null, 'Download issue'), onRetry: () => this.retryMod(mod, { type, onSucceeded }) });
      }
    }

    async recordHistoryEntry(type, fileId) {
      return NexusExt.Storage.addHistoryEntry({
        gameId: this.gameId,
        collectionId: this.collectionId,
        type,
        fileId
      });
    }

    async downloadBrowserQueue(mods, type, history, { restart = false } = {}) {
      this.ui.startDownload(mods.length);
      const alreadyDownloaded = type === null
        ? new Set()
        : new Set(history?.[this.gameId]?.[this.collectionId]?.[type] || []);
      const pending = [];

      for (const mod of mods) {
        if (alreadyDownloaded.has(mod.fileId)) {
          this.ui.log(
            `${T('logAlreadyDownloaded', 'Already downloaded')} <a href="${escapeHtml(mod.file.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(mod.file.name)}</a>`
          );
          this.ui.incrementProgress();
          continue;
        }
        pending.push({
          fileId: mod.fileId || mod.file.fileId,
          gameId: mod.file.mod.game.id,
          name: mod.file.name,
          pageUrl: mod.file.url,
          sizeKb: mod.file.size
        });
      }

      if (!pending.length) {
        this.downloadController = null;
        this.ui.endDownload('finished');
        return;
      }

      const queueProgressBase = this.ui.progress;
      const visibleTotal = mods.length;

      await this.watchBackgroundJob({
        queueProgressBase,
        visibleTotal,
        fallbackQueueTotal: pending.length,
        start: () => NexusExt.Storage.sendDownloadCommand('NDC_QUEUE_START', {
          gameId: this.gameId,
          collectionId: this.collectionId,
          type,
          restart,
          folder: this.downloadFolder,
          requestTimeout: this.requestTimeout,
          items: pending
        })
      });
    }

    watchBackgroundJob({
      queueProgressBase = 0,
      visibleTotal = 0,
      fallbackQueueTotal = 0,
      start = null
    } = {}) {
      return new Promise((resolve) => {
        let settled = false;
        let watchdogTimer = null;
        let onVisibilityChange = null;
        let pollFailures = 0;

        const cleanup = () => {
          try {
            chrome.runtime.onMessage.removeListener(onQueueEvent);
          } catch (_) { }
          clearInterval(watchdogTimer);
          watchdogTimer = null;
          if (onVisibilityChange) {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            onVisibilityChange = null;
          }
          this.settleBrowserQueue = null;
          this.backgroundJobId = null;
          this.downloadController = null;
        };

        const finish = (outcome = 'error', error = '') => {
          if (settled) return;
          settled = true;
          cleanup();
          if (error) this.ui.logText(TS('logBackgroundError', [error], `Background collection error: ${error}`), 'error');
          this.ui.endDownload(outcome);
          resolve();
        };

        this.settleBrowserQueue = (outcome = 'stopped') => finish(outcome);

        const TERMINAL_STATUS = {
          finished: 'finished',
          partial: 'partial',
          stopped: 'stopped',
          error: 'error',
          requires_login: 'requires_login'
        };

        const pollQueueStatus = async () => {
          if (settled || !this.backgroundJobId) return;
          let reply;
          try {
            reply = await NexusExt.Storage.sendDownloadCommand('NDC_QUEUE_STATUS', this.queueTarget());
          } catch (_) {
            reply = null;
          }
          if (settled) return;
          if (!reply?.ok) {
            pollFailures += 1;
            if (pollFailures >= MAX_QUEUE_POLL_FAILURES) {
              finish('error', reply?.error || 'the background download job stopped responding');
            }
            return;
          }
          pollFailures = 0;

          const snapshot = reply.value;
          if (!snapshot) {
            finish('error', 'the background download job is no longer available');
            return;
          }

          const queueIndex = Math.max(0, Number(snapshot.index) || 0);
          this.ui.setProgress?.(queueProgressBase + queueIndex, visibleTotal);
          if (snapshot.status === 'paused' || snapshot.status === 'running') {
            this.ui.setDownloadStatus?.(snapshot.status);
            return;
          }
          const outcome = TERMINAL_STATUS[snapshot.status];
          if (outcome) finish(outcome, snapshot.lastError || '');
        };

        const runWatchdog = () => {
          pollQueueStatus().catch(() => undefined);
        };
        watchdogTimer = setInterval(runWatchdog, 7000);
        onVisibilityChange = () => {
          if (!settled && !document.hidden) runWatchdog();
        };
        document.addEventListener('visibilitychange', onVisibilityChange);

        const applyEvent = (message) => {
          const queueIndex = Math.max(0, Number(message.index) || 0);
          this.ui.setProgress?.(queueProgressBase + queueIndex, visibleTotal);
          if (message.status === 'paused' || message.status === 'running') {
            this.ui.setDownloadStatus?.(message.status);
          }
          if (message.type === 'NXT_NDC_PROGRESS') {
            const name = message.itemName || 'Nexus file';
            if (message.itemState === 'started') {
              this.ui.logText(TS('logDownloading', [name], `Downloading: ${name}`));
            } else if (message.itemState === 'complete') {
              this.ui.logText(TS('logCompleted', [name], `Completed: ${name}`), 'info');
            } else if (message.itemState === 'retrying') {
              this.ui.logText(TS('logRetryingInterrupted', [name], `Retrying interrupted download: ${name}`), 'info');
            } else if (message.itemState === 'failed') {
              const reason = message.error || 'download error';
              this.ui.logText(TS('logFailedItem', [name, reason], `Failed: ${name} (${reason})`), 'error');
            }
            return;
          }
          if (message.type === 'NXT_NDC_STATE') return;
          if (message.type === 'NXT_NDC_WAITING') {
            this.ui.logText(T('logQueueRateLimited', 'Nexus Mods rate limit reached. The background queue will resume automatically.'), 'info');
            return;
          }
          if (message.type === 'NXT_NDC_DONE') {
            finish(message.outcome || 'error', message.error || '');
          }
        };

        // Bind progress only after the event is matched to this job.
        const onQueueEvent = (message) => {
          if (!/^NXT_NDC_/.test(String(message?.type || ''))) return false;
          if (this.backgroundJobId) {
            if (message.jobId !== this.backgroundJobId) return false;
          } else {
            if (message.gameId !== this.gameId || message.collectionId !== this.collectionId) return false;
            this.backgroundJobId = message.jobId;
          }
          applyEvent(message);
          return false;
        };

        try {
          chrome.runtime.onMessage.addListener(onQueueEvent);
        } catch (cause) {
          finish('error', String(cause?.message || cause));
          return;
        }

        if (typeof start !== 'function') {
          runWatchdog();
          return;
        }

        Promise.resolve(start()).then((reply) => {
          if (!reply?.ok || !reply.value?.jobId) {
            finish('error', reply?.error || 'background queue did not start');
            return;
          }
          this.backgroundJobId = reply.value.jobId;
          if (!reply.value.adopted) return;
          this.ui.logText(T('logReconnectedAdopted', 'Reconnected to the download already running in the background.'), 'info');
          const queueIndex = Math.min(
            Number(reply.value.index) || 0,
            Number(reply.value.total) || fallbackQueueTotal
          );
          this.ui.setProgress?.(queueProgressBase + queueIndex, visibleTotal);
          this.ui.setDownloadStatus?.(reply.value.status);
        }).catch((cause) => finish('error', String(cause?.message || cause)));
      });
    }

    async resumeBackgroundRun() {
      if (!this.ui || this.disposed) return false;
      const alreadyWatching = this.running;

      let reply;
      try {
        reply = await NexusExt.Storage.sendDownloadCommand('NDC_QUEUE_ATTACH', {
          gameId: this.gameId,
          collectionId: this.collectionId
        });
      } catch (_) {
        return false;
      }
      if (!reply?.ok || !reply.value) return false;

      const snapshot = reply.value;
      if (snapshot.status !== 'running' && snapshot.status !== 'paused') return false;
      if (this.disposed || !this.ui) return false;
      if (this.running !== alreadyWatching) return false;

      const total = Math.max(1, Number(snapshot.total) || 0);
      const index = Math.min(Math.max(0, Number(snapshot.index) || 0), total);

      this.ui.startDownload(total, { resumed: true });
      this.ui.setProgress(index, total);
      this.ui.setDownloadStatus(snapshot.status);

      if (alreadyWatching) {
        this.ui.logText(T('logProgressRestored', 'Progress restored for the download still running in this tab.'), 'info');
        return true;
      }

      this.backgroundJobId = snapshot.jobId;
      this.running = true;
      try {
        this.ui.logText(T('logReconnectedBackground', 'Reconnected to a collection download still running in the background.'), 'info');
        await this.watchBackgroundJob({
          queueProgressBase: 0,
          visibleTotal: total,
          fallbackQueueTotal: total
        });
      } finally {
        this.running = false;
      }
      return true;
    }

    async downloadMods(mods, type = null) {
      if (!this.ui || this.disposed) return;
      if (!mods.length) {
        this.ui.logText(T('logNothingToDownload', 'There are no mods to download for this selection.'), 'info');
        return;
      }
      if (this.running) {
        this.ui.logText(T('logAlreadyRunning', 'A download is already running. Please wait or stop it first.'), 'info');
        return;
      }
      this.running = true;
      NXTK.setActivity?.({
        trigger: 'collection',
        method: this.downloadMethod === DOWNLOAD_METHOD_BROWSER ? 'browser' : 'vortex',
        fileId: '',
        autoClose: false,
        fallbackActive: false
      });
      this.downloadController = typeof AbortController === 'function' ? new AbortController() : null;
      try {
        const claim = await this.acquireRunClaim();
        if (!claim.granted) {
          this.ui.logText(
            claim.reason === 'background-job'
              ? T('logClaimBackground', 'A background download for this collection is still running. Open its tab and stop it there, or close that tab.')
              : T('logClaimOtherTab', 'This collection is already downloading in another tab. Stop it there first, or close that tab.'),
            'error'
          );
          return;
        }
        await this.runCollection(mods, type);
      } finally {
        this.releaseRunClaim();
        this.running = false;
      }
    }

    async runCollection(mods, type) {
      if (this.runStatus === STATUS_STOPPED) this.runStatus = STATUS_DOWNLOADING;

      const loginError = Auth?.getDocumentLoginError?.(document, 'Starting collection download');
      if (loginError) {
        const loginUrl = escapeHtml(Auth.buildLoginUrl());
        this.ui.log(
          `${T('logSignInFirst', 'Sign in to Nexus Mods before starting this collection.')} <a href="${loginUrl}" target="_self">${T('logOpenLogin', 'Open login')}</a>.`,
          'error'
        );
        if (this.showAlertsOnError) {
          NexusExt.UI.showError(loginError, { title: NXTK.t('dlgSignInRequired', null, 'Sign in required') });
        }
        return;
      }

      if (this.downloadMethod === DOWNLOAD_METHOD_VORTEX
        && typeof NexusExt.UI?.showVortexHandoffModal === 'function') {
        const choice = await NexusExt.UI.showVortexHandoffModal();
        if (choice === 'cancel') {
          this.ui.logText(T('logCanceledBeforeStart', 'Download canceled before start.'), 'info');
          return;
        }
        if (choice === 'browser') {
          this.downloadMethod = DOWNLOAD_METHOD_BROWSER;
          this.ui.setDownloadMethod?.(DOWNLOAD_METHOD_BROWSER);
          await NexusExt.Storage.patchSetting('NDC_downloadMethod', DOWNLOAD_METHOD_BROWSER);
          NXTK.setActivity?.({
            trigger: 'collection',
            method: 'browser',
            fileId: '',
            autoClose: false,
            fallbackActive: false
          });
        }
      }

      let history = null;
      let restart = false;
      if (type !== null) {
        history = await NexusExt.Storage.getHistory();
        history[this.gameId] = history[this.gameId] || {};
        history[this.gameId][this.collectionId] = history[this.gameId][this.collectionId] || {};
        history[this.gameId][this.collectionId][type] = history[this.gameId][this.collectionId][type] || [];

        if (history[this.gameId][this.collectionId][type].length) {
          const choice = await NexusExt.UI.showHistoryDecisionModal({
            downloadedCount: history[this.gameId][this.collectionId][type].length,
            totalCount: mods.length
          });

          if (choice === 'cancel') {
            this.ui.logText(T('logCanceledBeforeStart', 'Download canceled before start.'), 'info');
            return;
          }

          if (choice === 'redownload') {
            restart = true;
            history = await NexusExt.Storage.clearHistoryType({
              gameId: this.gameId,
              collectionId: this.collectionId,
              type
            });
            history[this.gameId] = history[this.gameId] || {};
            history[this.gameId][this.collectionId] = history[this.gameId][this.collectionId] || {};
          }
        }
      }

      if (this.downloadMethod === DOWNLOAD_METHOD_BROWSER) {
        await this.downloadBrowserQueue(mods, type, history, { restart });
        return;
      }

      this.ui.startDownload(mods.length);
      let outcome = 'finished';

      try {

        const failedDownload = [];
        let forceStop = false;

        for (const [index, mod] of mods.entries()) {
        const modNumber = `${String(index + 1).padStart(String(mods.length).length, '0')}/${mods.length}`;
        const fileName = escapeHtml(mod.file.name);
        const fileUrl = escapeHtml(this.fileLinkFor(mod));
        let handedOff = false;

        if (this.isStopped()) {
          outcome = 'stopped';
          this.ui.logText(T('logDownloadStopped', 'Download stopped.'), 'info');
          break;
        }

        if (history?.[this.gameId]?.[this.collectionId]?.[type]?.includes(mod.fileId)) {
          this.ui.log(`[${modNumber}] ${T('logAlreadyDownloaded', 'Already downloaded')} <a href="${fileUrl}" target="_blank" rel="noopener noreferrer">${fileName}</a>`);
          this.ui.incrementProgress();
          continue;
        }

        await this.waitOutRateLimit();
        if (this.isStopped()) {
          outcome = 'stopped';
          this.ui.logText(T('logDownloadStopped', 'Download stopped.'), 'info');
          break;
        }

        const downloadResult = await this.fetchDownloadLinkWithRetry(mod, {
          onAttemptFailed: (error, attempt) => this.ui.log(
            `[${modNumber}] ${escapeHtml(error.code)} — retrying (attempt ${attempt + 1}) ${`<a href="${fileUrl}" target="_blank" rel="noopener noreferrer">${fileName}</a>`}`,
            'info'
          )
        });

        if (this.isStopped()) {
          outcome = 'stopped';
          this.ui.logText(T('logDownloadStopped', 'Download stopped.'), 'info');
          break;
        }

        if (!downloadResult.downloadUrl) {
          const downloadError = this.resolveLinkError(downloadResult);
          this.ui.log(
            `[${modNumber}] ${escapeHtml(Errors.toLogMessage(downloadError))} <a href="${fileUrl}" target="_blank" rel="noopener noreferrer">${fileName}</a>`,
            'error'
          );
          if (Errors.isBlocking(downloadError)) {
            forceStop = true;
            outcome = downloadError.code === 'requires_login' ? 'requires_login' : 'blocked';
            if (this.showAlertsOnError) {
              NexusExt.UI.showError(downloadError, {
                title: downloadError.code === 'requires_login'
                  ? T('dlgSignInRequired', 'Sign in required')
                  : T('dlgDownloadPaused', 'Download paused')
              });
            }
          } else {
            this.ui.incrementProgress();
            failedDownload.push({ mod, error: downloadError });
            if (this.showAlertsOnError && downloadError.retryable) {
              NexusExt.UI.showError(downloadError, {
                title: T('dlgDownloadIssue', 'Download issue'),
                onRetry: () => this.retryMod(mod, {
                  type,
                  onSucceeded: () => {
                    const failedIndex = failedDownload.findIndex((entry) => entry.mod === mod);
                    if (failedIndex !== -1) failedDownload.splice(failedIndex, 1);
                  }
                })
              });
            }
          }
        } else if (!this.handOffDownload(mod, downloadResult.downloadUrl, `[${modNumber}]`)) {
          this.ui.incrementProgress();
          failedDownload.push({
            mod,
            error: Errors.create('unsafe_download_url', { context: 'Validating download target' })
          });
        } else {
          this.ui.incrementProgress();
          NXTK.bumpTotalDownloads?.();
          handedOff = true;

          if (history) {
            history = await this.recordHistoryEntry(type, mod.fileId);
          }
        }

        if (forceStop) {
          this.ui.logText(T('logCollectionPaused', 'Collection paused. Completed files remain in history, so you can safely retry after resolving the issue.'), 'info');
          break;
        }

        if (handedOff && index < mods.length - 1) {
          const computePause = () => {
            if (this.pauseBetweenDownload === 0) return 0;
            const { speed } = this.resolveDownloadSpeed();
            const transferSeconds = Math.round(mod.file.size / 1024 / speed);
            return Math.min(transferSeconds + this.pauseBetweenDownload, MAX_PAUSE_SECONDS);
          };
          let pause = computePause();
          if (pause > 0) {
            const sizeStr = convertSize(mod.file.size);
            const pauseMessage = (remaining) => {
              const { speed, source } = this.resolveDownloadSpeed();
              return TS('logPausing',
                [formatDuration(pause), sizeStr, speed.toFixed(1), source, formatDuration(remaining)],
                `Pausing ${formatDuration(pause)} before next download (${sizeStr} @ ${speed.toFixed(1)} MB/s ${source})... ${formatDuration(remaining)} left`);
            };
            const pauseLogRow = this.ui.logText(pauseMessage(pause), 'info');
            let activeElapsedMs = 0;
            let lastTickAt = Date.now();
            await new Promise(resolve => {
              const intervalId = setInterval(() => {
                const now = Date.now();
                const elapsedSinceTick = Math.max(0, now - lastTickAt);
                lastTickAt = now;
                if (this.isStopped()) {
                  clearInterval(intervalId);
                  return resolve();
                }
                if (this.runStatus === STATUS_PAUSED) {
                  return;
                }
                activeElapsedMs += elapsedSinceTick;
                pause = computePause();
                if (pause <= 0) {
                  clearInterval(intervalId);
                  if (pauseLogRow) {
                    const msgSpan = pauseLogRow.querySelector('.nxtk-log-msg');
                    if (msgSpan) msgSpan.textContent = TS('logPauseComplete', [formatDuration(0), sizeStr],
                      `Pause complete (${formatDuration(0)} for ${sizeStr}).`);
                  }
                  return resolve();
                }
                const elapsed = Math.floor(activeElapsedMs / 1000);
                let remainingPause = pause - elapsed;
                if (remainingPause < 0) remainingPause = 0;
                if (pauseLogRow) {
                  const msgSpan = pauseLogRow.querySelector('.nxtk-log-msg');
                  if (msgSpan) msgSpan.textContent = pauseMessage(remainingPause);
                }
                if (activeElapsedMs >= pause * 1000) {
                  clearInterval(intervalId);
                  if (pauseLogRow) {
                    const msgSpan = pauseLogRow.querySelector('.nxtk-log-msg');
                    if (msgSpan) msgSpan.textContent = TS('logPauseComplete', [formatDuration(pause), sizeStr],
                      `Pause complete (${formatDuration(pause)} for ${sizeStr}).`);
                  }
                  return resolve();
                }
              }, 100);
            });
          }
        }
      }

      if (outcome === 'finished' && this.isStopped()) outcome = 'stopped';

      if (history && outcome === 'finished' && !failedDownload.length && this.ui.progress === this.ui.modsCount) {
        await NexusExt.Storage.clearHistoryType({
          gameId: this.gameId,
          collectionId: this.collectionId,
          type
        });
      }

      if (failedDownload.length) {
        if (outcome === 'finished') outcome = 'partial';
        this.ui.logText(NXTK.tPlural('logFailedSummary', failedDownload.length,
          `Failed to download ${failedDownload.length} mods:`), 'info');
        for (const { mod, error } of failedDownload) {
          this.ui.log(
            `${escapeHtml(error.code)} · <a href="${escapeHtml(this.fileLinkFor(mod))}" target="_blank" rel="noopener noreferrer">${escapeHtml(mod.file.name)}</a>`,
            'info'
          );
        }
      }

      } catch (cause) {
        outcome = 'error';
        const error = Errors.fromException(cause, { context: 'Running collection download' });
        this.ui.logText(TS('logRunStopped', [Errors.toLogMessage(error)],
          `Collection download stopped: ${Errors.toLogMessage(error)}`), 'error');
      } finally {
        this.ui.endDownload(outcome);
      }
    }

    async fetchRevisions() {
      const response = await Errors.request('https://api-router.nexusmods.com/graphql', {
        headers: { 'content-type': 'application/json' },
        referrer: document.location.href,
        referrerPolicy: 'strict-origin-when-cross-origin',
        body: JSON.stringify({
          query: 'query CollectionRevisions ($domainName: String, $slug: String!) { collection (domainName: $domainName, slug: $slug) { revisions {adultContent, createdAt, discardedAt, id, latest, revisionNumber, revisionStatus, totalSize, modCount, collectionChangelog { description, id}, gameVersions { reference } } } }',
          variables: { domainName: this.gameId, slug: this.collectionId },
          operationName: 'CollectionRevisions'
        }),
        method: 'POST',
        mode: 'cors',
        credentials: 'include'
      }, {
        timeoutMs: this.requestTimeout,
        context: 'Loading collection revisions',
        signal: this.lifecycleSignal
      });
      if (!response.ok) {
        this.lastError = response.error;
        return null;
      }

      try {
        const revisions = JSON.parse(response.text)?.data?.collection?.revisions || null;
        if (!revisions) {
          this.lastError = Errors.classifyContent(response.text, { context: 'Loading collection revisions' })
            || Errors.create('invalid_response', { context: 'Loading collection revisions' });
        }
        return revisions;
      } catch (cause) {
        this.lastError = Errors.create('invalid_response', {
          context: 'Reading collection revisions',
          technicalMessage: String(cause?.message || '')
        });
        return null;
      }
    }
  }

  window.NexusExt.NDC = NDC;
  window.NexusExt.NDC_CONSTANTS = {
    DOWNLOAD_METHOD_VORTEX,
    DOWNLOAD_METHOD_BROWSER,
    STATUS_DOWNLOADING,
    STATUS_PAUSED,
    STATUS_FINISHED,
    STATUS_STOPPED,
    STATUS_TEXT,
    convertSize
  };
})();
