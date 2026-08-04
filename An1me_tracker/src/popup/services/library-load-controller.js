(function () {
  "use strict";

  const AT = (window.AnimeTracker = window.AnimeTracker || {});

  const PHASES = Object.freeze({
    IDLE: "idle",
    QUEUED: "queued",
    CLOUD: "cloud",
    LOCAL: "local",
    MAINTENANCE: "maintenance",
    FINALIZING: "finalizing",
    READY: "ready",
    ERROR: "error",
  });

  const CLOUD_PRIORITY = Object.freeze({
    none: 0,
    regular: 1,
    force: 2,
  });

  function normalizeCloudMode(value) {
    return Object.prototype.hasOwnProperty.call(CLOUD_PRIORITY, value) ? value : "none";
  }

  function normalizeRequest(options = {}) {
    const reason = String(options.reason || "library-load").trim() || "library-load";
    return {
      cloudMode: normalizeCloudMode(options.cloudMode),
      skipAutoFetch: options.skipAutoFetch === true,
      forceHydrate: options.forceHydrate === true,
      allowRevisionSkip: options.allowRevisionSkip !== false,
      loadPreferences: options.loadPreferences === true,
      reasons: [reason],
    };
  }

  function mergeRequests(left, right) {
    if (!left) return right;
    if (!right) return left;

    const cloudMode = CLOUD_PRIORITY[right.cloudMode] > CLOUD_PRIORITY[left.cloudMode] ? right.cloudMode : left.cloudMode;
    return {
      cloudMode,
      skipAutoFetch: left.skipAutoFetch && right.skipAutoFetch,
      forceHydrate: left.forceHydrate || right.forceHydrate,
      allowRevisionSkip: left.allowRevisionSkip && right.allowRevisionSkip,
      loadPreferences: left.loadPreferences || right.loadPreferences,
      reasons: [...new Set([...(left.reasons || []), ...(right.reasons || [])])],
    };
  }

  function requestCovers(active, incoming) {
    if (!active) return false;
    if (CLOUD_PRIORITY[active.cloudMode] < CLOUD_PRIORITY[incoming.cloudMode]) return false;
    if (active.skipAutoFetch && !incoming.skipAutoFetch) return false;
    if (!active.forceHydrate && incoming.forceHydrate) return false;
    if (active.allowRevisionSkip && !incoming.allowRevisionSkip) return false;
    if (!active.loadPreferences && incoming.loadPreferences) return false;
    return true;
  }

  function create(options = {}) {
    if (typeof options.execute !== "function") {
      throw new TypeError("LibraryLoadController requires an execute function");
    }

    let activeRequest = null;
    let pendingRequest = null;
    let inFlight = null;
    let generation = 0;
    let state = Object.freeze({
      phase: PHASES.IDLE,
      busy: false,
      error: null,
      generation,
      reason: null,
    });

    function publish(phase, detail = {}) {
      const busy = ![PHASES.IDLE, PHASES.READY, PHASES.ERROR].includes(phase);
      state = Object.freeze({
        phase,
        busy,
        error: detail.error || null,
        generation: detail.generation ?? generation,
        reason: detail.reason || activeRequest?.reasons?.join(", ") || null,
      });
      if (typeof options.onStateChange === "function") options.onStateChange(state);
      return state;
    }

    async function drain() {
      let lastResult = null;
      try {
        while (pendingRequest) {
          activeRequest = pendingRequest;
          pendingRequest = null;
          generation += 1;

          const context = {
            generation,
            setPhase(phase, detail = {}) {
              return publish(phase, { ...detail, generation });
            },
          };
          lastResult = await options.execute(activeRequest, context);
          activeRequest = null;
        }

        publish(PHASES.READY, { generation, reason: state.reason });
        return lastResult;
      } catch (error) {
        pendingRequest = null;
        activeRequest = null;
        publish(PHASES.ERROR, { generation, error, reason: state.reason });
        throw error;
      }
    }

    function request(rawOptions = {}) {
      const incoming = normalizeRequest(rawOptions);

      if (inFlight) {
        const scheduled = mergeRequests(activeRequest, pendingRequest);
        if (!requestCovers(scheduled, incoming)) {
          pendingRequest = mergeRequests(pendingRequest, incoming);
        }
        return inFlight;
      }

      pendingRequest = incoming;
      publish(PHASES.QUEUED, { generation: generation + 1, reason: incoming.reasons.join(", ") });
      inFlight = drain().finally(() => {
        inFlight = null;
        activeRequest = null;
      });
      return inFlight;
    }

    return Object.freeze({ request });
  }

  AT.LibraryLoadController = Object.freeze({ PHASES, create });
})();
