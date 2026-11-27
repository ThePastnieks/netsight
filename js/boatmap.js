// NetSight — boat-mode map.
//
// A thin layer over the website's MapModule (js/map.js), which already knows how
// to draw the OpenStreetMap map, the report pins, the blue "you are here" dot, and
// the red 50 m limit line. This file only decides what boat mode shows and what a
// tap on a pin does.
//
// The red lines come from the shore shapes an administrator drew (Shore), not from
// the tiles, so they are identical whichever tile source is used.

const BoatMap = (function () {
  'use strict';

  const REFRESH_MS = 60000;

  let ready = false;
  let centred = false;          // centre on the first GPS fix only; never move the map by itself again
  let timer = null;
  let loading = false;
  let netsLayer = null;
  let current = [];             // reports on the map, for tap lookups
  let lastPos = null;
  let handlers = {};

  // map.js calls UIModule.escapeHtml and UIModule.showDetailView, from the website's
  // ui.js, which the app does not include. A tap on "Details" opens our own sheet.
  if (typeof window.UIModule === 'undefined') {
    window.UIModule = {
      escapeHtml: s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      showDetailView: s => { if (handlers.onPin) handlers.onPin(s); }
    };
  }

  function init(h) { handlers = h || {}; }

  async function build() {
    const map = MapModule.initMap('boat-map', CONFIG.MAP_CENTER, 13);
    if (!map) return false;

    netsLayer = L.layerGroup().addTo(map);

    // One tap on a pin should open the sheet, not a small popup with another button.
    map.on('popupopen', e => {
      const el = e.popup.getElement();
      const btn = el && el.querySelector('.map-popup__btn');
      if (!btn) return;
      const s = current.find(x => x.id === btn.dataset.id);
      map.closePopup();
      if (s && handlers.onPin) handlers.onPin(s);
    });

    try { await Shore.load(); } catch (e) { /* no shoreline yet: the readout says so */ }
    MapModule.toggleZones(true);
    return true;
  }

  async function enter() {
    if (!ready) ready = await build();
    if (!ready) return false;

    // The map was created while its screen was hidden; tell Leaflet its real size.
    setTimeout(() => { const m = MapModule.getMap(); if (m) m.invalidateSize(); }, 150);

    await refresh();
    clearInterval(timer);
    timer = setInterval(refresh, REFRESH_MS);
    if (lastPos) updatePosition(lastPos);
    return true;
  }

  function leave() {
    clearInterval(timer);
    timer = null;
  }

  // Open reports stay on the map day and night. Only the "is it still there?"
  // questions pause at night; the pins do not.
  async function refresh() {
    if (!ready || loading) return;
    loading = true;
    try {
      const raw = await StoreModule.getSightingsUnified(500);
      current = raw.filter(s => CaseModule.isOpen(s) && Number.isFinite(s.lat) && Number.isFinite(s.lon));
      MapModule.renderSightings(current);
      await GearModule.load();
      drawNets();
    } catch (e) { /* keep what is drawn; the next refresh tries again */ }
    loading = false;
  }

  // Registered nets: yours in blue and thick, everyone else's in green and dashed,
  // expired ones in red. A tap opens the details sheet (what is shown depends on who is looking: boat.js).
  // The visible line is thin, so an invisible, much wider line sits on top as the touch
  // target: a fingertip on a wet screen cannot hit a 4 px line.
  function drawNets() {
    if (!netsLayer) return;
    netsLayer.clearLayers();
    const me = Auth.current();

    // All registered gear, expired ones too: a net whose registration ran out is still in
    // the water, and is exactly what an inspector wants to see (drawn in red).
    GearModule.all().forEach(g => {
      const own = !!me && (g.ownerId === me.id || g.ownerName === me.username);
      const expired = GearModule.isExpired(g);
      const color = expired ? '#E5484D' : (own ? '#0B5FA5' : '#2FA36B');
      const open = () => { if (handlers.onGear) handlers.onGear(g); };

      if (Array.isArray(g.span) && g.span.length === 2) {
        L.polyline(g.span, { color, weight: own ? 6 : 4, opacity: 0.9, dashArray: own ? null : '8 6', lineCap: 'round' })
          .on('click', open).addTo(netsLayer);
        L.polyline(g.span, { color, weight: 32, opacity: 0, fill: false, lineCap: 'round' })
          .on('click', open).addTo(netsLayer);
      } else if (Number.isFinite(g.lat) && Number.isFinite(g.lon)) {
        L.circleMarker([g.lat, g.lon], { radius: 14, color, weight: 3, fillColor: color, fillOpacity: 0.5 })
          .on('click', open).addTo(netsLayer);
      }
    });
  }

  // pos: { lat, lon, accuracy } from the GPS loop in boat.js.
  function updatePosition(pos) {
    lastPos = pos;
    if (!ready || !pos || pos.error || !Number.isFinite(pos.lat)) return;
    MapModule.showUserPosition(pos.lat, pos.lon, pos.accuracy);
    if (!centred) {
      MapModule.getMap().setView([pos.lat, pos.lon], 16);
      centred = true;
    }
  }

  function centre() {
    return MapModule.recentre();
  }

  return { init, enter, leave, refresh, updatePosition, centre };
})();

if (typeof window !== 'undefined') window.BoatMap = BoatMap;
