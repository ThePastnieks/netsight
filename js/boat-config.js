// Boat mode: loaded only by the mobile app build (see scripts/build-www.mjs).
// The website keeps its own pages per role; the app has one screen set, and
// administration stays on the website.
(function () {
  'use strict';
  if (!window.CONFIG || !CONFIG.AUTH) return;
  Object.keys(CONFIG.AUTH.roles).forEach(function (id) {
    CONFIG.AUTH.roles[id].page = 'boat.html';
  });

  // "Is it still there?" (js/stillthere.js). The number of "gone" votes that
  // closes a report (2) lives in the database: supabase/migrations/008_gear_checks.sql.
  CONFIG.STILL_THERE = {
    radiusM: 50,
    minAccuracyM: 50,
    cooldownHours: 6,
    snoozeMinutes: 30
  };
})();
