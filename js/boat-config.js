// Boat mode: loaded only by the mobile app build (see scripts/build-www.mjs).
// The website keeps its own pages per role; the app has one screen set, and
// administration stays on the website.
(function () {
  'use strict';
  if (!window.CONFIG || !CONFIG.AUTH) return;
  Object.keys(CONFIG.AUTH.roles).forEach(function (id) {
    CONFIG.AUTH.roles[id].page = 'boat.html';
  });
})();
