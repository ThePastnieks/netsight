// NetSight Water Patrol
//
// Written for cold hands. Every control is at least 56 px tall, decisions happen
// inline on the card rather than behind a modal, and there are two tabs instead
// of four. If something needs a second tap it is because it is destructive or
// irreversible, not because the layout ran out of room.
//
// What a patrol actually does, in order:
//   1. Open the app. See what is waiting.
//   2. Accept it (and say how urgent) or decline it (and say why).
//   3. If it is unclear, ask the reporter a question.
//   4. If they find gear in the water, identify it without driving to it.

const Patrol = (function() {
  'use strict';

  let cases = [];
  let filter = 'open';
  let expanded = new Set();     // ids of cards showing their detail
  let deciding = new Set();     // ids mid-decision, to stop double taps
  let pending = {};             // id -> 'accept' | 'decline' while choosing
  let idMap = null;
  let idMarker = null;

  // ------------------------------------------------------------------ init

  async function init() {
    const session = await Auth.require(['patrol', 'admin']);
    if (!session) return;

    Theme.init();
    Auth.mount(session);

    bindTabs();
    bindFilters();
    bindIdentify();

    await RegistryModule.loadRegistry();
    await Shore.load();
    await Devices.load();
    await GearModule.load();

    await loadCases();
    renderIdList();

    console.log('Water Patrol ready');
  }

  async function loadCases() {
    try {
      cases = await StoreModule.getSightingsUnified(500);
    } catch (err) {
      console.error('Could not load cases:', err);
      UIModule.showToast('Could not load cases', 'error');
      cases = [];
    }

    renderCases();
    renderCounts();
  }

  function renderCounts() {
    const open = cases.filter(c => CaseModule.isOpen(c) && !c.verdict).length;
    const tabCount = document.getElementById('tab-count');
    if (tabCount) tabCount.textContent = String(open);

    const sub = document.getElementById('patrol-sub');
    if (sub) {
      sub.textContent = open === 0
        ? 'Nothing waiting'
        : open + (open === 1 ? ' case needs' : ' cases need') + ' action';
    }
  }

  // ------------------------------------------------------------------ tabs

  function bindTabs() {
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');

        document.querySelectorAll('[data-pane]').forEach(pane => {
          pane.classList.toggle('is-active', pane.dataset.pane === btn.dataset.tab);
        });

        document.querySelector('.screen__body').scrollTop = 0;
      });
    });
  }

  function bindFilters() {
    document.querySelectorAll('[data-filter]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('[data-filter]').forEach(c => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        filter = chip.dataset.filter;
        renderCases();
      });
    });
  }

  // ---------------------------------------------------------------- cases

  function visibleCases() {
    if (filter === 'all') return CaseModule.sortForPatrol(cases);
    if (filter === 'declined') {
      return cases.filter(c => c.verdict === 'declined')
        .sort((a, b) => new Date(b.handled_at || b.created_at) - new Date(a.handled_at || a.created_at));
    }
    return CaseModule.sortForPatrol(cases.filter(c => CaseModule.isOpen(c) && !c.verdict));
  }

  function timeAgo(iso) {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '—';

    const mins = Math.floor((Date.now() - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';

    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');

    const days = Math.floor(hours / 24);
    if (days < 7) return days + (days === 1 ? ' day ago' : ' days ago');

    return new Date(iso).toLocaleDateString();
  }

  function gearTypeLabel(cls) {
    const map = {
      net: 'Net', trap: 'Trap', buoy: 'Buoy', float: 'Float', unknown: 'Unknown'
    };
    return map[cls] || (cls ? cls.charAt(0).toUpperCase() + cls.slice(1) : 'Unknown');
  }

  // Everything the patrol needs to know, in the fewest words that still say it.
  function ownershipLine(c) {
    if (!c.registry_match) {
      return '<span class="case-owner case-owner--none">Nobody registered it</span>';
    }

    const gear = typeof GearModule !== 'undefined' ? GearModule.findByCode(c.registry_id) : null;

    if (gear) {
      const expired = GearModule.isExpired(gear);
      return '<span class="case-owner case-owner--' + (expired ? 'warn' : 'ok') + '">' +
        UIModule.escapeHtml(gear.ownerName) +
        ' · ' + UIModule.escapeHtml(gear.code) +
        (expired ? ' · expired' : '') + '</span>';
    }

    return '<span class="case-owner case-owner--ok">Registered</span>';
  }

  function lengthLine(c) {
    if (!Array.isArray(c.span) || c.span.length !== 2) return '';
    const m = Math.round(Shore.spanLength(c.span[0], c.span[1]));
    return m + ' m long';
  }

  function renderCases() {
    const host = document.getElementById('case-list');
    const empty = document.getElementById('case-empty');
    if (!host) return;

    const list = visibleCases();

    if (!list.length) {
      host.innerHTML = '';
      if (empty) {
        empty.hidden = false;
        const p = empty.querySelector('p');
        if (p) {
          p.textContent = filter === 'declined' ? 'Nothing declined' : 'Nothing waiting';
        }
      }
      return;
    }

    if (empty) empty.hidden = true;

    host.innerHTML = list.map(c => caseCard(c)).join('');

    // Wire each card. Delegation would be shorter but this keeps the handlers
    // obvious and the cards are few.
    host.querySelectorAll('[data-open]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        toggleExpanded(el.dataset.open);
      });
    });

    host.querySelectorAll('[data-accept]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        chooseSeverity(btn.dataset.accept);
      });
    });

    host.querySelectorAll('[data-decline]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        chooseDecline(btn.dataset.decline);
      });
    });

    host.querySelectorAll('[data-severity]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        commitAccept(btn.dataset.caseId, btn.dataset.severity);
      });
    });

    host.querySelectorAll('[data-reason]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        commitDecline(btn.dataset.caseId, btn.dataset.reason);
      });
    });

    host.querySelectorAll('[data-cancel]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        pending[btn.dataset.cancel] = null;
        renderCases();
      });
    });

    host.querySelectorAll('[data-photo]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const c = cases.find(x => x.id === btn.dataset.photo);
        if (c) openPhoto(photoUrl(c));
      });
    });

    host.querySelectorAll('[data-send]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        sendMessage(btn.dataset.send);
      });
    });

    host.querySelectorAll('[data-msg-input]').forEach(input => {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage(input.dataset.msgInput);
        }
      });
    });

    // Load any threads that are open.
    expanded.forEach(id => loadThread(id));
  }

// A photo is the evidence. If it will not load it is worse than nothing, so
  // unusable values are treated as absent rather than shown as a broken box.
  function photoUrl(c) {
    const url = c && c.photo_url;
    if (!url || typeof url !== 'string') return null;
    if (!url.startsWith('data:') && !url.startsWith('http')) return null;
    return url;
  }

  function caseCard(c) {
    const isOpen = expanded.has(c.id);
    const mode = pending[c.id];
    const done = !!c.verdict;

    const severity = CaseModule.severityInfo(c.severity);
    const length = lengthLine(c);

    return [
      '<article class="case-card' + (done ? ' case-card--done' : '') + '" data-open="' + UIModule.escapeHtml(c.id) + '">',

      '  <div class="case-card__top">',
      '    <span class="case-type">' + UIModule.escapeHtml(gearTypeLabel(c.user_class)) + '</span>',
      severity
        ? '    <span class="case-sev case-sev--' + severity.tone + '">' + UIModule.escapeHtml(severity.label) + '</span>'
        : '',
      '    <span class="case-time">' + UIModule.escapeHtml(timeAgo(c.created_at)) + '</span>',
      '  </div>',

      '  <div class="case-card__body">',
      photoUrl(c)
        ? '    <button type="button" class="case-photo" data-photo="' +
            UIModule.escapeHtml(c.id) + '" aria-label="Photo">' +
            '<img src="' + UIModule.escapeHtml(photoUrl(c)) + '" alt="" loading="lazy">' +
            '<span class="case-photo__zoom">Tap to enlarge</span></button>'
        : '',
      '    <span class="case-owner-line">' + ownershipLine(c) + '</span>',
      length ? '    <span class="case-meta">' + UIModule.escapeHtml(length) + '</span>' : '',
      '  </div>',

      done
        ? '  <div class="case-card__verdict">' + UIModule.escapeHtml(CaseModule.summary(c)) + '</div>'
        : renderActions(c, mode),

      isOpen ? renderDetail(c) : '',

      '</article>'
    ].join('');
  }

  // The two buttons that matter. Both full width, both enormous.
  function renderActions(c, mode) {
    if (mode === 'accept') {
      const buttons = CaseModule.SEVERITY_ORDER.map(id => {
        const s = CaseModule.SEVERITY[id];
        return [
          '<button type="button" class="sev-btn sev-btn--' + s.tone + '"',
          ' data-severity="' + s.id + '" data-case-id="' + UIModule.escapeHtml(c.id) + '">',
          '  <span class="sev-btn__label">' + UIModule.escapeHtml(s.label) + '</span>',
          '  <span class="sev-btn__hint">' + UIModule.escapeHtml(s.short) + '</span>',
          '</button>'
        ].join('');
      }).join('');

      return [
        '<div class="case-actions case-actions--choosing">',
        '  <p class="case-ask">How urgent is it?</p>',
        '  <div class="sev-grid">' + buttons + '</div>',
        '  <button type="button" class="big-btn big-btn--ghost" data-cancel="' + UIModule.escapeHtml(c.id) + '">Cancel</button>',
        '</div>'
      ].join('');
    }

    if (mode === 'decline') {
      const buttons = Object.values(CaseModule.DECLINE_REASONS).map(r => [
        '<button type="button" class="reason-btn" data-reason="' + r.id + '"',
        ' data-case-id="' + UIModule.escapeHtml(c.id) + '">',
        '  <span class="reason-btn__label">' + UIModule.escapeHtml(r.label) + '</span>',
        '  <span class="reason-btn__hint">' + UIModule.escapeHtml(r.hint) + '</span>',
        '</button>'
      ].join('')).join('');

      return [
        '<div class="case-actions case-actions--choosing">',
        '  <p class="case-ask">Why not?</p>',
        '  <div class="reason-grid">' + buttons + '</div>',
        '  <button type="button" class="big-btn big-btn--ghost" data-cancel="' + UIModule.escapeHtml(c.id) + '">Cancel</button>',
        '</div>'
      ].join('');
    }

    return [
      '<div class="case-actions">',
      '  <button type="button" class="big-btn big-btn--primary" data-accept="' + UIModule.escapeHtml(c.id) + '">',
      '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true">',
      '      <path d="M20 6L9 17l-5-5"></path>',
      '    </svg>',
      '    Accept',
      '  </button>',
      '  <button type="button" class="big-btn big-btn--ghost" data-decline="' + UIModule.escapeHtml(c.id) + '">',
      '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true">',
      '      <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
      '    </svg>',
      '    Not gear',
      '  </button>',
      '</div>'
    ].join('');
  }

  // The expanded half: what was said, and a way to ask.
  function renderDetail(c) {
    const note = (c.note || '').trim();
    const coords = Number.isFinite(c.lat)
      ? c.lat.toFixed(4) + ', ' + c.lon.toFixed(4)
      : 'no coordinates';

    return [
      '<div class="case-detail">',

      photoUrl(c)
        ? '  <button type="button" class="case-detail__photo-btn" data-photo="' +
            UIModule.escapeHtml(c.id) + '" aria-label="Photo">' +
            '<img class="case-detail__photo" src="' + UIModule.escapeHtml(photoUrl(c)) +
            '" alt="" loading="lazy"></button>'
        : '  <p class="case-note case-note--empty">No photo — the reporter did not attach one.</p>',

      note
        ? '  <p class="case-note">' + UIModule.escapeHtml(note) + '</p>'
        : '  <p class="case-note case-note--empty">No description given.</p>',

      '  <p class="case-coords">' + UIModule.escapeHtml(coords) + '</p>',

      '  <div class="thread" id="thread-' + UIModule.escapeHtml(c.id) + '">',
      '    <p class="thread__empty">No messages yet.</p>',
      '  </div>',

      '  <div class="thread-input">',
      '    <input class="big-input big-input--compact" data-msg-input="' + UIModule.escapeHtml(c.id) + '"',
      '           placeholder="Ask the reporter…" maxlength="500">',
      '    <button type="button" class="big-btn big-btn--soft big-btn--square" data-send="' + UIModule.escapeHtml(c.id) + '"',
      '            aria-label="Send">',
      '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">',
      '        <line x1="22" y1="2" x2="11" y2="13"></line>',
      '        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>',
      '      </svg>',
      '    </button>',
      '  </div>',

      '</div>'
    ].join('');
  }

  function toggleExpanded(id) {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    renderCases();
  }

  // ------------------------------------------------------------- decisions

  function chooseSeverity(id) {
    pending[id] = 'accept';
    expanded.add(id);
    renderCases();
  }

  function chooseDecline(id) {
    pending[id] = 'decline';
    expanded.add(id);
    renderCases();
  }

  async function commitAccept(id, severity) {
    if (deciding.has(id)) return;
    deciding.add(id);

    try {
      const result = await CaseModule.decide(id, { kind: 'accept', severity });

      if (!result.ok) {
        UIModule.showToast(result.message, 'error');
        return;
      }

      pending[id] = null;
      UIModule.showToast('Accepted · ' + CaseModule.severityLabel(severity), 'success');
      await loadCases();
    } catch (err) {
      console.error('Accept failed:', err);
      UIModule.showToast('Could not save: ' + err.message, 'error');
    } finally {
      deciding.delete(id);
    }
  }

  async function commitDecline(id, reason) {
    if (deciding.has(id)) return;
    deciding.add(id);

    try {
      const result = await CaseModule.decide(id, { kind: 'decline', reason });

      if (!result.ok) {
        UIModule.showToast(result.message, 'error');
        return;
      }

      pending[id] = null;
      UIModule.showToast('Declined', 'info');
      await loadCases();
    } catch (err) {
      console.error('Decline failed:', err);
      UIModule.showToast('Could not save: ' + err.message, 'error');
    } finally {
      deciding.delete(id);
    }
  }

  // ------------------------------------------------------------ conversation

  async function loadThread(id) {
    const host = document.getElementById('thread-' + id);
    if (!host) return;

    let list = [];
    try {
      list = await CaseModule.messages(id);
    } catch (err) {
      console.warn('Could not load thread:', err);
      return;
    }

    if (!list.length) {
      host.innerHTML = '<p class="thread__empty">No messages yet.</p>';
      return;
    }

    const me = Auth.current();

    host.innerHTML = list.map(m => {
      const mine = me && m.authorName === me.username;
      return [
        '<div class="bubble' + (mine ? ' bubble--me' : '') + '">',
        '  <span class="bubble__who">' + UIModule.escapeHtml(m.authorName) + '</span>',
        '  <span class="bubble__text">' + UIModule.escapeHtml(m.text) + '</span>',
        '  <span class="bubble__when">' + UIModule.escapeHtml(timeAgo(m.createdAt)) + '</span>',
        '</div>'
      ].join('');
    }).join('');

    host.scrollTop = host.scrollHeight;
  }

  async function sendMessage(id) {
    const input = document.querySelector('[data-msg-input="' + id + '"]');
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.disabled = true;

    try {
      const result = await CaseModule.sendMessage(id, text);
      if (!result.ok) {
        UIModule.showToast(result.message, 'error');
        input.value = text;
        return;
      }
      await loadThread(id);
    } catch (err) {
      UIModule.showToast('Could not send', 'error');
      input.value = text;
    } finally {
      input.disabled = false;
      input.focus();
    }
  }

// ------------------------------------------------------------- QR scanning

  let scanStop = false;

  function bindScan() {
    document.getElementById('btn-id-scan')?.addEventListener('click', startScan);
    document.getElementById('btn-scan-cancel')?.addEventListener('click', () => {
      scanStop = true;
      closeScan();
    });
  }

  async function startScan() {
    const modal = document.getElementById('scan-modal');
    const note = document.getElementById('scan-note');
    const video = document.getElementById('scan-video');
    if (!modal) return;

    if (typeof QrModule === 'undefined' || !QrModule.scannerSupported()) {
      UIModule.showToast(
        'This browser cannot scan QR codes. Type the code instead.',
        'warning'
      );
      return;
    }

    scanStop = false;
    modal.hidden = false;
    void modal.offsetHeight;
    modal.classList.add('sheet--visible');
    if (note) note.textContent = 'Starting the camera…';

    const result = await QrModule.scan({
      shouldStop: () => scanStop,
      onVideo: stream => {
        if (video) {
          video.srcObject = stream;
          video.play().catch(() => {});
        }
        if (note) note.textContent = 'Looking for a code…';
      }
    });

    closeScan();

    if (!result.ok) {
      UIModule.showToast(result.reason, 'warning');
      return;
    }

    const code = QrModule.extractCode(result.text);

    if (!code) {
      UIModule.showToast('That QR is not a NetSight code', 'warning');
      return;
    }

    const input = document.getElementById('id-code');
    if (input) input.value = code;

    showIdentification(IdentifyModule.byCode(code));
    UIModule.showToast('Scanned ' + code, 'success');
  }

  function closeScan() {
    const modal = document.getElementById('scan-modal');
    if (!modal) return;

    const video = document.getElementById('scan-video');
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }

    modal.classList.remove('sheet--visible');
    modal.hidden = true;
  }

// Full screen, pinch-to-zoom, tap anywhere to dismiss. Looking at a photo is
  // the whole point of having one, so it gets the screen.
  function openPhoto(url) {
    if (!url) return;

    let host = document.getElementById('photo-lightbox');
    if (!host) {
      host = document.createElement('div');
      host.id = 'photo-lightbox';
      host.className = 'lightbox';
      document.body.appendChild(host);

      host.addEventListener('click', () => {
        host.classList.remove('lightbox--visible');
        setTimeout(() => { host.hidden = true; host.innerHTML = ''; }, 180);
      });
    }

    host.innerHTML = '<img class="lightbox__img" src="' + UIModule.escapeHtml(url) + '" alt="">';
    host.hidden = false;
    void host.offsetHeight;
    host.classList.add('lightbox--visible');
  }

  // ------------------------------------------------------------- identify

  function bindIdentify() {
    const codeInput = document.getElementById('id-code');

    document.getElementById('btn-id-code')?.addEventListener('click', () => {
      showIdentification(IdentifyModule.byCode(codeInput ? codeInput.value : ''));
    });

    codeInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        showIdentification(IdentifyModule.byCode(codeInput.value));
      }
    });

    document.getElementById('btn-id-here')?.addEventListener('click', async () => {
      UIModule.showLoading('Finding you…');
      try {
        const pos = await LocationModule.getCurrentPosition();
        showIdentification(IdentifyModule.byPosition(pos.lat, pos.lon));
      } catch (err) {
        UIModule.showToast('No GPS fix — tap it on the map instead', 'warning');
      } finally {
        UIModule.hideLoading();
      }
    });

    document.getElementById('btn-id-map')?.addEventListener('click', openIdMap);
    bindScan();
    document.getElementById('btn-id-map-cancel')?.addEventListener('click', closeIdMap);
  }

  function showIdentification(result) {
    const host = document.getElementById('id-result');
    if (!host) return;

    host.hidden = false;

    const verdict = IdentifyModule.VERDICTS[result.verdict] || IdentifyModule.VERDICTS.unknown;
    const advice = IdentifyModule.recommendation(result);

    // The headline is the answer. Everything else is supporting detail, and it
    // is deliberately smaller so the answer reads first.
    let headline;
    if (result.found && result.kind === 'gear') {
      headline = result.gear.ownerName;
    } else if (result.found && result.best) {
      headline = result.best.record.ownerName || result.best.record.owner || 'Registered';
    } else {
      headline = verdict.label;
    }

    const rows = [];

    if (result.code) {
      rows.push(['Code', result.code]);
    }

    if (result.found && result.best) {
      const r = result.best.record;
      rows.push(['Distance', Math.round(result.best.distance) + ' m']);
      if (r.label) rows.push(['Name', r.label]);
      if (r.validUntil) rows.push(['Valid until', new Date(r.validUntil).toLocaleDateString()]);
    }

    if (result.found && result.gear && !result.best) {
      const g = result.gear;
      if (Array.isArray(g.span)) {
        rows.push(['Length', Math.round(Shore.spanLength(g.span[0], g.span[1])) + ' m']);
      }
      if (g.validUntil) rows.push(['Valid until', new Date(g.validUntil).toLocaleDateString()]);
    }

    host.dataset.tone = verdict.tone;
    host.innerHTML = [
      '<div class="id-result__head">',
      '  <span class="id-result__verdict">' + UIModule.escapeHtml(verdict.label) + '</span>',
      '  <span class="id-result__owner">' + UIModule.escapeHtml(headline) + '</span>',
      '</div>',
      '<p class="id-result__why">' + UIModule.escapeHtml(result.reason || '') + '</p>',
      rows.length
        ? '<dl class="id-rows">' + rows.map(([k, v]) =>
            '<div><dt>' + UIModule.escapeHtml(k) + '</dt><dd>' + UIModule.escapeHtml(String(v)) + '</dd></div>'
          ).join('') + '</dl>'
        : '',
      '<div class="id-result__advice" data-tone="' + advice.tone + '">' + UIModule.escapeHtml(advice.label) + '</div>',
      result.found && result.best && Number.isFinite(result.best.record.lat)
        ? '<button type="button" class="big-btn big-btn--soft" id="btn-id-show">Show it on the map</button>'
        : ''
    ].join('');

    document.getElementById('btn-id-show')?.addEventListener('click', () => {
      const r = result.best ? result.best.record : result.gear;
      if (!r) return;
      const lat = Array.isArray(r.span) ? r.span[0][0] : r.lat;
      const lon = Array.isArray(r.span) ? r.span[0][1] : r.lon;
      if (Number.isFinite(lat)) openIdMapAt(lat, lon);
    });
  }

  function renderIdList() {
    const host = document.getElementById('id-list');
    const none = document.getElementById('id-none');
    const total = document.getElementById('id-total');
    if (!host) return;

    const list = GearModule.activeOnly();
    if (total) total.textContent = String(list.length);

    if (!list.length) {
      host.innerHTML = '';
      if (none) none.hidden = false;
      return;
    }

    if (none) none.hidden = true;

    host.innerHTML = list.map(g => {
      const metres = Array.isArray(g.span)
        ? Math.round(Shore.spanLength(g.span[0], g.span[1]))
        : null;

      return [
        '<button type="button" class="id-row" data-id-gear="' + UIModule.escapeHtml(g.code) + '">',
        '  <span class="id-row__code">' + UIModule.escapeHtml(g.code) + '</span>',
        '  <span class="id-row__owner">' + UIModule.escapeHtml(g.ownerName) + '</span>',
        '  <span class="id-row__meta">' + UIModule.escapeHtml(g.label) +
          (metres ? ' · ' + metres + ' m' : '') + '</span>',
        '</button>'
      ].join('');
    }).join('');

    host.querySelectorAll('[data-id-gear]').forEach(btn => {
      btn.addEventListener('click', () => {
        showIdentification(IdentifyModule.byCode(btn.dataset.idGear));
        document.querySelector('.screen__body').scrollTop = 0;
      });
    });
  }

  // ------------------------------------------------------------- id map

  function openIdMap() {
    openIdMapAt(CONFIG.MAP_CENTER[0], CONFIG.MAP_CENTER[1]);
  }

  function openIdMapAt(lat, lon) {
    const modal = document.getElementById('id-map-modal');
    if (!modal) return;

    modal.hidden = false;
    void modal.offsetHeight;
    modal.classList.add('sheet--visible');

    setTimeout(() => {
      if (!idMap) {
        idMap = L.map('id-map').setView([lat, lon], 15);
        L.tileLayer(CONFIG.TILE_URL, {
          maxZoom: 19,
          attribution: CONFIG.TILE_ATTRIBUTION
        }).addTo(idMap);

        if (typeof Shore !== 'undefined') {
          Shore.permittedAreas().forEach(area => {
            const pts = area.kind === 'circle'
              ? circlePoints(area)
              : (area.coords || []).map(p => [p[0], p[1]]);
            if (pts.length) {
              L.polygon(pts, {
                color: '#2FA36B', weight: 2, opacity: 0.5, dashArray: '6 6',
                fillColor: '#2FA36B', fillOpacity: 0.1, interactive: false
              }).addTo(idMap);
            }
          });
        }

        idMap.on('click', e => {
          if (idMarker) idMarker.setLatLng(e.latlng);
          else idMarker = L.circleMarker(e.latlng, {
            radius: 9, color: '#fff', weight: 3, fillColor: '#1FA6D8', fillOpacity: 1
          }).addTo(idMap);

          showIdentification(IdentifyModule.byPosition(e.latlng.lat, e.latlng.lng));
          closeIdMap();
        });
      } else {
        idMap.setView([lat, lon], 15);
        idMap.invalidateSize();
      }
    }, 60);
  }

  function circlePoints(shape) {
    const R = 6371000;
    const dLat = (shape.radius / R) * 180 / Math.PI;
    const dLon = (shape.radius / (R * Math.cos(shape.lat * Math.PI / 180))) * 180 / Math.PI;
    const pts = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * 2 * Math.PI;
      pts.push([shape.lat + dLat * Math.cos(a), shape.lon + dLon * Math.sin(a)]);
    }
    return pts;
  }

  function closeIdMap() {
    const modal = document.getElementById('id-map-modal');
    if (!modal) return;
    modal.classList.remove('sheet--visible');
    modal.hidden = true;
  }

  return { init, reload: loadCases };
})();

document.addEventListener('DOMContentLoaded', () => Patrol.init());
window.Patrol = Patrol;





