// boot-check.js — loaded last in each big context (popup, /watch, background). Verifies
// the critical namespace members actually loaded and logs a clear error if any are missing,
// catching script-load-order regressions at runtime (replaces a build-time check).
(function () {
  "use strict";
  let label, ns, required;
  if (typeof window === "undefined") {
    label = "background";
    ns = self;
    required = ["firebaseConfig", "AnimeTrackerMergeUtils", "AnimeTrackerNotificationCoordinator", "AnimeTrackerAnimeResolver"];
  } else if (location.protocol === "chrome-extension:") {
    // popup / side panel. NB: the shared logger.js also creates window.AnimeTrackerContent
    // here, so detect the context by protocol — not by which namespace object exists.
    label = "popup";
    ns = window.AnimeTracker || {};
    required = [
      "CONFIG",
      "Storage",
      "LibraryMutations",
      "LibraryLoadController",
      "SyncStatusController",
      "AnimeResolver",
      "StatsEngine",
      "BadgeEngine",
      "GoalEngine",
      "ProgressInsights",
      "GoalsView",
      "Logger",
      "UIHelpers",
      "AnimeCardRenderer",
    ];
  } else {
    label = "content";
    ns = window.AnimeTrackerContent || {};
    required = ["CONFIG", "Storage", "Logger", "AnimeParser", "ProgressTracker", "VideoMonitor"];
  }
  const missing = required.filter((key) => ns == null || ns[key] == null);
  if (missing.length) console.error(`[boot-check] ${label}: missing modules → ${missing.join(", ")}`);
})();
