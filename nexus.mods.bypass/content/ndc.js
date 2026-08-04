/* ndc.js — Nexus Download Collection logic (ported from Tampermonkey script1) */
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

  /* Countdown label: plain seconds under a minute, m:ss at or above one minute
     (and h:mm:ss past an hour). Used by BOTH the per-file pause and the
     rate-limit cooldown so every wait in the log reads the same way. */
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
  /* T = plain, TS = with substitutions. Markup and links are always built in code.
     Values passed to TS are pre-escaped by the caller, so nothing is escaped twice. */
  const T = (key, fallback) => NXTK.t(key, null, fallback);
  const TS = (key, subs, fallback) => NXTK.t(key, subs.map(String), fallback);

  /* Must equal DEFAULTS.NDC_downloadSpeed. resolveDownloadSpeed() compares against it to
     decide whether the stored value is the stock one or the user's own, so a mismatch
     would label every untouched install as customised. */
  const DEFAULT_DOWNLOAD_SPEED = 3.2;
  // Ceiling on the size/speed formula: without it a very large file asks for a wait so
  // long that the queue reads as frozen.
  const MAX_PAUSE_SECONDS = 10 * 60;

  /* Backoff bounds used when Nexus returns 429 without a Retry-After header.
     Doubles per consecutive 429, capped so a run never stalls indefinitely. */
  const RATE_LIMIT_BASE_SECONDS = 30;
  const RATE_LIMIT_MAX_SECONDS = 10 * 60;
  const RATE_LIMIT_MAX_STRIKES = 6;

  const MAX_QUEUE_POLL_FAILURES = 5;

  /* One collator instead of a lookup per comparison, and `numeric` so "Patch 10" sorts
     after "Patch 2" rather than before it. */
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
      /* Two scopes: lifecycleController covers page-owned work (fetchMods, revisions) and
         is aborted only by dispose(); downloadController covers the active run, so Stop
         cancels it without making the instance unusable. */
      this.lifecycleController = typeof AbortController === 'function' ? new AbortController() : null;
      this.downloadController = null;
      this.backgroundJobId = null;
      /* Set while a browser-mode run is waiting on the worker. Stop and dispose() use
         it to end that wait when no NXT_NDC_DONE can arrive. */
      this.settleBrowserQueue = null;
      // Renews this tab's cross-tab run lease while a run is active.
      this.claimTimer = null;
      // storage.onChanged subscription that keeps the pacing tunables live.
      this.onSettingsChanged = null;
      /* Guards against a second concurrent run (double-click on "Download all",
         or starting a selection while a run is live). Deliberately NOT derived
         from runStatus: that is initialised to STATUS_DOWNLOADING before anything
         starts, so testing it would reject the very first download. */
      this.running = false;

      /* The loop's stop/pause condition. It used to live on the deck's state object,
         so isStopped() answered "not stopped" whenever no deck was mounted and every
         pause check reached through the DOM. The deck now mirrors this field instead
         of owning it. */
      this.runStatus = STATUS_DOWNLOADING;

      // UI references (set by ui.js)
      this.ui = null;
    }

    // Requests that belong to the page/route rather than to a download run.
    get lifecycleSignal() {
      return this.lifecycleController?.signal || null;
    }

    // Requests that belong to the active download run.
    get downloadSignal() {
      return this.downloadController?.signal || null;
    }

    /* Cancels the active download run only. The instance stays usable, so pressing
       Stop and then Download again works without a route change. */
    stopDownload() {
      this.running = false;
      this.runStatus = STATUS_STOPPED;
      this.stopBackgroundQueue();
      try {
        this.downloadController?.abort();
      } catch (_) { }
      this.downloadController = null;
    }

    /* Addressed by collection as well as by jobId: a page that lost track of a live job
       could otherwise never stop it. */
    queueTarget() {
      return {
        jobId: this.backgroundJobId || null,
        gameId: this.gameId,
        collectionId: this.collectionId
      };
    }

    /* `ownedOnly` separates an explicit Stop from an incidental teardown. Stop may address
       the job by collection; a route change must not, or it would kill a job another tab
       is driving. */
    stopBackgroundQueue({ ownedOnly = false } = {}) {
      if (ownedOnly && !this.backgroundJobId) {
        /* Nothing to stop in the worker, but a browser-mode wait may still be pending here.
           Settling it removes the queue listener — otherwise each route change leaks one,
           still driving a detached deck. */
        this.settleBrowserQueue?.('stopped');
        return;
      }
      Promise.resolve(NexusExt.Storage.sendDownloadCommand('NDC_QUEUE_STOP', this.queueTarget()))
        .then((reply) => {
          /* `job-not-found`: the worker has no record, so NXT_NDC_DONE can never
             arrive. Without settling here the deck stayed frozen mid-progress and
             `running` stayed latched, so every later Download was refused. */
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

    /* Called by main.js when the route changes away from this collection.
       Tears the instance down for good: both request scopes, the download loop, and
       the UI surfaces that close over it. */
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
      this.stopBackgroundQueue({ ownedOnly: true });
      // Belt and braces: stopBackgroundQueue settles on both of its paths, but the
      // listener must not survive this instance under any circumstance.
      this.settleBrowserQueue?.('stopped');
      for (const controller of [this.downloadController, this.lifecycleController]) {
        try {
          controller?.abort();
        } catch (_) { }
      }
      this.downloadController = null;
    }

    /* Held for the whole run so a second tab cannot start a parallel one. Vortex has no
       worker-side job to collide on, so without this two tabs each handed every mod to
       Vortex. Lease-based: the heartbeat keeps it alive, and it expires if this tab dies. */
    async acquireRunClaim() {
      const reply = await NexusExt.Storage.sendDownloadCommand('NDC_RUN_CLAIM', {
        gameId: this.gameId,
        collectionId: this.collectionId
      });
      // Worker unreachable: fail OPEN. A claim is a duplicate guard, not a
      // correctness gate, and refusing to download because a message dropped would
      // be a worse failure than the duplication it prevents.
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

    /* Auto-detection is deliberately NOT used: navigator.connection.downlink is capped at
       10 Mbps so it can never report a fast link, and Resource Timing on our own ~8 KB
       fetches cannot predict sustained throughput. Browser-queue byte rates say nothing
       about Vortex's own speed either. */
    resolveDownloadSpeed() {
      const manual = Number(this.downloadSpeed);
      const isCustom = Number.isFinite(manual) && manual > 0
        && Math.abs(manual - DEFAULT_DOWNLOAD_SPEED) > 0.001;
      /* The old label nagged "set your real speed" on EVERY countdown tick, pointing at
         a setting that was not exposed on any surface — so it was both noise and a dead
         end. The control now exists in the settings panel, where the explanation
         belongs; this just states which value is in play. */
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
      // Empty means the Downloads root; the worker decides the final path.
      this.downloadFolder = settings.DownloadFolder ?? '';

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

    /* Read once in init() and never again before this, so changing pacing mid-run did
       nothing until a reload. Subscribing to storage covers every writer — popup,
       in-page modal, other tabs — at once. */
    watchSettings() {
      if (this.onSettingsChanged) return;
      this.onSettingsChanged = (changes, area) => {
        if (area !== 'local' || !changes?.[NXTK.SETTINGS_KEY]) return;
        this.applySettings(changes[NXTK.SETTINGS_KEY].newValue);
      };
      try {
        chrome.storage.onChanged.addListener(this.onSettingsChanged);
      } catch (_) {
        // Orphaned content script — keep whatever init() loaded.
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
      NXTK.setForceEnglish(next.ForceEnglish);
      /* downloadMethod is deliberately NOT applied. The deck's radio owns it, and
         swapping Vortex <-> Browser underneath a run in progress would leave the loop
         and the worker queue disagreeing about who owns the transfer. */
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
        // Page-scoped: also used by the revision comparison, which must survive a
        // Stop but be cancelled by a route change.
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
          /* Hand over the response already fetched above. getDownloadUrl would
             otherwise GET this exact URL again with the same credentials and
             headers, doubling the authenticated requests per mod. */
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

    /* Records a rate-limit response so this run — and any other tab — backs off.
       `retryAfterSeconds` comes from the response when Nexus sends Retry-After;
       otherwise a bounded exponential backoff is used, doubling per consecutive
       429 so a server that is still refusing is not hammered. */
    noteRateLimited(retryAfterSeconds) {
      const explicit = Number(retryAfterSeconds);
      this.rateLimitStrikes = Math.min((this.rateLimitStrikes || 0) + 1, RATE_LIMIT_MAX_STRIKES);
      const backoff = Number.isFinite(explicit) && explicit > 0
        ? explicit
        : Math.min(RATE_LIMIT_BASE_SECONDS * Math.pow(2, this.rateLimitStrikes - 1), RATE_LIMIT_MAX_SECONDS);
      const until = Date.now() + Math.min(backoff, RATE_LIMIT_MAX_SECONDS) * 1000;
      this.rateLimitedUntil = Math.max(this.rateLimitedUntil || 0, until);
      // Shared so a second tab downloading the same collection also backs off.
      NexusExt.Storage.saveRateLimit?.({ until: this.rateLimitedUntil });
      return Math.round((this.rateLimitedUntil - Date.now()) / 1000);
    }

    noteRateLimitCleared() {
      this.rateLimitStrikes = 0;
    }

    /* Blocks until any active cooldown expires. Reads the shared value first so a
       cooldown started in another tab is honoured here too. */
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

          /* Paused: keep WAITING, but keep the label honest. The cooldown is a server
             clock and runs down whether or not the user has paused, so freezing the
             whole tick left a stale countdown frozen on screen — it read as a hung
             queue. Only the resume is withheld, which is what Pause actually means. */
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

    /* Sleep that honours Stop and Pause. Uses elapsed wall-clock rather than a fixed
       100 ms per tick: Chromium throttles background-tab timers, which turned a 2 s wait
       into ~20 s. Time spent explicitly paused is still excluded. */
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

    /* Normalizes whatever fetchDownloadLink returned into a concrete error. */
    resolveLinkError(result) {
      return Errors.normalize(
        result?.error
        || Errors.classifyContent(result?.text, { context: 'Preparing collection download' })
        || Errors.create(this.downloadMethod === DOWNLOAD_METHOD_VORTEX ? 'no_nmm_link' : 'no_download_url')
      );
    }

    /* Bounded retry around fetchDownloadLink. Blocking errors are never retried — they
       need the user to act first. The caller sees one final result, so progress and
       failed bookkeeping still happen once. */
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

        /* A real 429 sets the shared cooldown, honouring Retry-After when the
           response exposed it and falling back to bounded backoff when it did not
           (the cross-origin GraphQL endpoint typically hides the header). */
        if (error.code === 'rate_limited') {
          const waitSeconds = this.noteRateLimited(result.rateLimit?.retryAfterSeconds);
          this.ui.logText(TS('logBackingOff', [formatDuration(waitSeconds)],
            `Nexus Mods is rate limiting requests. Backing off ${formatDuration(waitSeconds)}.`), 'info');
          await this.waitOutRateLimit();
          if (this.isStopped()) return result;
          if (attempt < attempts) continue;
          return result;
        }

        if (attempt >= attempts || !error.retryable || Errors.isBlocking(error)) return result;

        onAttemptFailed?.(error, attempt);
        await this.delayWithPause(delayMs);
        if (this.isStopped()) return result;
      }
      return result;
    }

    /* Hands a resolved link to Vortex via its nxm:// handler. Vortex-only: browser-mode
       collections go to the worker queue instead. Shared by the main loop and Retry so
       both use the same fail-closed validator. Returns whether the hand-off happened. */
    handOffDownload(mod, downloadUrl, prefix) {
      const sizeStr = convertSize(mod.file.size);
      const fileName = escapeHtml(mod.file.name);
      const fileUrl = escapeHtml(mod.file.url);
      const meta = `<span style="opacity:0.6;font-size:11px">(${sizeStr})</span>`;
      const link = `<a href="${fileUrl}" target="_blank" rel="noopener noreferrer">${fileName}</a>`;

      const verdict = NXTK.validateDownloadTarget(downloadUrl, { method: DOWNLOAD_METHOD_VORTEX });
      if (!verdict.ok) {
        // detail is a fixed slug (never the URL itself) so it is safe in a report.
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

    /* Retries one mod outside the main loop — wired to the Retry button on the
       error dialog. History/progress bookkeeping is intentionally left alone: the
       main run already accounted for this file as failed. */
    async retryMod(mod) {
      /* The error dialog outlives the failure that raised it, so Retry can be pressed after
         Stop. Without these guards it handed Vortex a download the user had cancelled. */
      if (this.isStopped()) {
        this.ui?.logText(T('logRetryIgnored', 'Retry ignored: this collection run was stopped.'), 'info');
        return;
      }

      const result = await this.fetchDownloadLinkWithRetry(mod);
      // Re-checked: the fetch above is two network round-trips, which is exactly the
      // window in which Stop gets pressed.
      if (this.isStopped()) return;

      if (result.downloadUrl) {
        // Only count it once the hand-off actually happened.
        if (this.handOffDownload(mod, result.downloadUrl, 'Retry:')) NXTK.bumpTotalDownloads?.();
        return;
      }

      const error = this.resolveLinkError(result);
      const link = `<a href="${escapeHtml(mod.file.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(mod.file.name)}</a>`;
      this.ui.log(`${TS('logRetryFailed', [escapeHtml(Errors.toLogMessage(error))], `Retry failed: ${escapeHtml(Errors.toLogMessage(error))}`)} ${link}`, 'error');
      /* Re-display here rather than throwing: ui.js's retry handler funnels a
         thrown value through Errors.fromException, which reads cause.message and
         would flatten this into a generic network_error, losing the real code. */
      if (this.showAlertsOnError && error.retryable) {
        NexusExt.UI.showError(error, { title: NXTK.t('dlgDownloadIssue', null, 'Download issue'), onRetry: () => this.retryMod(mod) });
      }
    }

    /* Serialised in the service worker so a concurrent run (another tab, an
       overlapping "all"/"mandatory" run) cannot drop this entry. Still returns the
       merged object, which the loop assigns back to its local `history`. */
    async recordHistoryEntry(type, fileId) {
      return NexusExt.Storage.addHistoryEntry({
        gameId: this.gameId,
        collectionId: this.collectionId,
        type,
        fileId
      });
    }

    /* Browser-mode collections are owned by the worker: it persists the queue, resolves
       each signed URL and advances on downloads.onChanged even if this page is frozen. */
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
          /* Nexus publishes this in the same GraphQL payload as the file list (KB).
             The worker checks the finished transfer against it, so a truncated or
             empty archive is caught instead of being recorded as a success. */
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

    /* ===== Reconnecting to a run already in the worker =====
       Split out of downloadBrowserQueue so it can also be entered WITHOUT starting
       anything (see resumeBackgroundRun). `start` is the only difference between the
       two callers: omit it and this simply attaches to whatever is already running. */
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
          // `running` is released by downloadMods' finally — single owner.
        };

        const finish = (outcome = 'error', error = '') => {
          if (settled) return;
          settled = true;
          cleanup();
          if (error) this.ui.logText(TS('logBackgroundError', [error], `Background collection error: ${error}`), 'error');
          this.ui.endDownload(outcome);
          resolve();
        };

        /* Exposed so Stop and dispose() can end this wait even when the worker will
           never send NXT_NDC_DONE (no such job, or the page is being torn down). */
        this.settleBrowserQueue = (outcome = 'stopped') => finish(outcome);

        /* Every queue event is a fire-and-forget tabs.sendMessage that a frozen tab never
           receives, and nothing is re-sent on wake. One lost NXT_NDC_DONE stranded the deck
           forever with `running` latched. Polling the worker's own state closes that. */
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
        // Timers are throttled hard in a hidden tab, so also resync on refocus —
        // which is exactly when a frozen tab needs to catch up on what it missed.
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

        /* Claimed by collection, not only by jobId: events arriving before backgroundJobId
           was set used to be dropped, so a run downloaded correctly while the deck showed
           nothing. The id is latched from the first event for the fast path. */
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

        // Reattach mode: the job already exists and the listener above is all that
        // was missing. Nothing to start.
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
          /* The worker handed back a job that was already downloading this collection
             instead of starting a rival one. Re-baseline the bar against it, otherwise
             the deck counts from zero over a run that is already part-done. */
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

    /* A browser-mode run deliberately survives its page, but the whole receiving end —
       listener, watchdog, deck, and the Stop button that only exists inside the progress
       area — used to be created solely by clicking Download. A reopened tab therefore
       showed an idle deck over a live run with no way to stop it. Called by main.js once
       the deck mounts; re-points the worker at this tab and re-enters the wait loop. */
    async resumeBackgroundRun() {
      if (!this.ui || this.disposed) return false;
      /* A watch loop can already be live while React rebuilds the deck. It closes over
         `this`, so it already drives the new bridge — only the visible state is missing.
         Bailing out here left a remounted deck showing the idle panel over a live run. */
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
      // Re-checked after the await: a route change or a click could have landed.
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
      /* Claimed here so the Download buttons refuse while the reattached run is live,
         exactly as they do for a run started in this tab. */
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
      /* Checked before `running` is claimed, so there is nothing to release. A
         collection with no optional mods otherwise flashed the whole start/finish
         sequence at 0/0 and issued a pointless history clear on an empty list. */
      if (!mods.length) {
        this.ui.logText(T('logNothingToDownload', 'There are no mods to download for this selection.'), 'info');
        return;
      }
      if (this.running) {
        this.ui.logText(T('logAlreadyRunning', 'A download is already running. Please wait or stop it first.'), 'info');
        return;
      }
      /* This wrapper exists purely to own the `running` lifetime: with the claim inline,
         a rejection from any of the awaits before the loop left it stuck true for the
         page's lifetime, and every later Download was refused. */
      this.running = true;
      // Fresh per-run scope, so a previous Stop cannot cancel this run's requests.
      this.downloadController = typeof AbortController === 'function' ? new AbortController() : null;
      try {
        /* One run per collection across the whole browser. Browser mode is already
           protected by the worker's one-job-per-collection rule, but Vortex mode had
           nothing at all: two tabs on the same collection each walked the full list and
           handed every mod to Vortex twice. */
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
      // A new run clears the stopped state the previous Stop left behind.
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

      let history = null;
      /* "Re-download all" is an explicit instruction to start over. Without carrying it
         to the worker, a job still running for this collection got adopted instead and
         the bar resumed mid-way (59/258) as though nothing had been asked. */
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
      /* Stated up front because the queue cannot tell: a hand-off is a navigation to
         nxm://, and the transfer happens inside Vortex where the browser sees nothing. If
         Vortex is not running, files are still recorded as sent and a resume skips them. */
      if (history) {
        this.ui.logText(T('logVortexNotice',
          'Vortex must be running. Files are recorded once sent to it — the browser cannot see whether Vortex actually received them.'
        ), 'info');
      }
      let outcome = 'finished';

      try {

        const failedDownload = [];
        let forceStop = false;

        for (const [index, mod] of mods.entries()) {
        const modNumber = `${String(index + 1).padStart(String(mods.length).length, '0')}/${mods.length}`;
        const fileName = escapeHtml(mod.file.name);
        const fileUrl = escapeHtml(mod.file.url);

        /* Stop is checked BEFORE the history skip. With the order reversed, pressing
           Stop over a stretch of already-downloaded files kept logging and advancing
           the bar through all of them until it happened to reach one that still needed
           fetching — so Stop looked ignored for as long as that stretch lasted. */
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

        /* Immediately before the request, not after the previous one: the cooldown is
           shared through storage, so another tab can start one while we were pausing —
           and the first mod of a run was never checked at all. */
        await this.waitOutRateLimit();
        // The wait can last minutes; Stop during it must end the run, not fetch once more.
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

        // Stop pressed (or route changed) while the link fetch was in flight —
        // without this check the mod would still download one extra time.
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
            // Retries are already exhausted by fetchDownloadLinkWithRetry, so this
            // counts once. onRetry lets the user re-attempt just this mod — the
            // Retry button was previously unreachable from collections.
            this.ui.incrementProgress();
            failedDownload.push({ mod, error: downloadError });
            if (this.showAlertsOnError && downloadError.retryable) {
              NexusExt.UI.showError(downloadError, {
                title: T('dlgDownloadIssue', 'Download issue'),
                onRetry: () => this.retryMod(mod)
              });
            }
          }
        } else if (!this.handOffDownload(mod, downloadResult.downloadUrl, `[${modNumber}]`)) {
          /* The link failed validation, so nothing was handed to Vortex. Advance the
             bar but do NOT record history — otherwise a re-run would skip a file that
             never arrived. */
          this.ui.incrementProgress();
          failedDownload.push({
            mod,
            error: Errors.create('unsafe_download_url', { context: 'Validating download target' })
          });
        } else {
          this.ui.incrementProgress();
          NXTK.bumpTotalDownloads?.();

          if (history) {
            history = await this.recordHistoryEntry(type, mod.fileId);
          }
        }

        if (forceStop) {
          this.ui.logText(T('logCollectionPaused', 'Collection paused. Completed files remain in history, so you can safely retry after resolving the issue.'), 'info');
          break;
        }

        if (index < mods.length - 1) {
          /* The size term ESTIMATES the transfer, which is required because Vortex gives no
             completion event. Values are re-read each tick so a settings change lands
             mid-countdown. */
          const computePause = () => {
            if (this.pauseBetweenDownload === 0) return 0;
            const { speed } = this.resolveDownloadSpeed();
            const transferSeconds = Math.round(mod.file.size / 1024 / speed);
            return Math.min(transferSeconds + this.pauseBetweenDownload, MAX_PAUSE_SECONDS);
          };
          let pause = computePause();
          if (pause > 0) {
            const sizeStr = convertSize(mod.file.size);
            // Shows the speed actually used and its origin, so an unexpectedly
            // long or short wait is self-explanatory in the log.
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
                // Explicit Pause freezes active elapsed time. Background-tab timer
                // throttling does not: the next tick accounts for the full gap.
                if (this.runStatus === STATUS_PAUSED) {
                  return;
                }
                activeElapsedMs += elapsedSinceTick;
                // Re-read the configured values while the countdown is active.
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
        /* Clears only this gameId + collectionId + type. Serialised in the worker,
           so entries another tab added meanwhile are preserved. */
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
            `${escapeHtml(error.code)} · <a href="${escapeHtml(mod.file.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(mod.file.name)}</a>`,
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
        // Only endDownload here: `running` belongs to downloadMods' finally, which
        // also covers the awaits above this try block.
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
        // Page-scoped: a route change must cancel this, a Stop must not.
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

  // Public
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
