// NetSight — language (Latvian / English) for the phone app.
//
// The app and the shared website modules it reuses write their text in English. Rather
// than rewrite every string, this file translates what appears on screen: it watches
// the page, and any text (or placeholder / label) it recognises is swapped for the
// Latvian version from js/i18n-lv.js. English stays the source of truth: the original
// text is remembered, so switching back to English restores it exactly.
//
// Recognition is by exact text, by patterns for sentences with numbers and names in them
// ("3 h ago", "NS-123 is registered to anna ..."), and by splitting "a · b" into parts.
// Anything not recognised is left in English and listed by I18n.missed(), so gaps are
// easy to find.
//
// The language is the saved choice, otherwise Latvian when the phone is set to Latvian,
// otherwise English. Mark an element data-i18n="off" to leave it alone.

const I18n = (function () {
  'use strict';

  const KEY = 'netsight_lang';
  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];

  const exact = Object.create(null);   // English text -> Latvian text
  const patterns = [];                 // [RegExp, (match, translate) => string]
  const missed = new Set();

  let lang = 'en';
  const orig = new WeakMap();          // text node -> the English it was given
  const out = new WeakMap();           // text node -> the text we last wrote into it
  const attrState = new WeakMap();     // element -> { attr: { en, out } }

  // ------------------------------------------------------------ translating

  function register(data) {
    if (data.exact) Object.assign(exact, data.exact);
    if (data.patterns) data.patterns.forEach(p => patterns.push(p));
  }

  // Translate one trimmed piece of text, or return it unchanged.
  function core(text) {
    text = text.replace(/\s+/g, ' ');                  // line breaks inside HTML text
    if (exact[text] !== undefined) return exact[text];

    for (let i = 0; i < patterns.length; i++) {
      const m = text.match(patterns[i][0]);
      if (m) {
        const r = patterns[i][1](m, tr);
        if (r != null) return r;
      }
    }

    // "a · b · c": translate each part.
    if (text.indexOf(' · ') > -1) {
      const parts = text.split(' · ');
      const done = parts.map(p => core(p));
      if (done.some((p, i) => p !== parts[i])) return done.join(' · ');
    }

    // A leading symbol before the words (for example "+ Add"): keep it, translate the rest.
    const sym = text.match(/^([^\p{L}\p{N}\s"'“”(]{1,4}) (.+)$/u);
    if (sym) {
      const rest = core(sym[2]);
      if (rest !== sym[2]) return sym[1] + ' ' + rest;
    }

    if (/[A-Za-z]{3,}/.test(text)) missed.add(text);
    return text;
  }

  // Keeps the spaces around the text, so "  Send " stays "  Sūtīt ".
  function tr(text) {
    if (lang === 'en' || !text) return text;
    const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!m[2]) return text;
    return m[1] + core(m[2]) + m[3];
  }

  // ---------------------------------------------------------------- the page

  function skipped(node) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return true;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') return true;
    return !!el.closest('[data-i18n="off"]');
  }

  function doText(node) {
    if (skipped(node)) return;
    const cur = node.nodeValue;
    if (out.has(node) && cur === out.get(node)) return;       // our own output
    orig.set(node, cur);                                      // new English text
    const t = tr(cur);
    if (t !== cur) { out.set(node, t); node.nodeValue = t; } else { out.delete(node); }
  }

  function doAttrs(el) {
    if (el.nodeType !== 1 || skipped(el)) return;
    let st = attrState.get(el);
    ATTRS.forEach(a => {
      if (!el.hasAttribute(a)) return;
      const cur = el.getAttribute(a);
      const known = st && st[a];
      if (known && cur === known.out) return;                 // our own output
      if (!st) { st = {}; attrState.set(el, st); }
      const t = tr(cur);
      st[a] = { en: cur, out: t };
      if (t !== cur) el.setAttribute(a, t);
    });
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1) return;
    doAttrs(root);
    if (root.tagName === 'SCRIPT' || root.tagName === 'STYLE') return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) doText(n); else doAttrs(n);
    }
  }

  // Re-translate everything from the remembered English (used when the language changes).
  function reapply() {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) {
        if (skipped(n)) continue;
        const en = orig.get(n);
        if (en === undefined) { doText(n); continue; }
        const ours = out.has(n) ? out.get(n) : en;      // what this node should say right now
        if (n.nodeValue === ours) {
          const t = tr(en);
          if (t !== en) out.set(n, t); else out.delete(n);
          if (n.nodeValue !== t) n.nodeValue = t;
        } else {
          doText(n);                                      // someone else changed it meanwhile
        }
      } else if (!skipped(n)) {
        const st = attrState.get(n);
        if (st) {
          ATTRS.forEach(a => {
            if (st[a] && n.getAttribute(a) === st[a].out) {
              const t = tr(st[a].en);
              st[a].out = t;
              n.setAttribute(a, t);
            }
          });
        } else {
          doAttrs(n);
        }
      }
    }
  }

  let observer = null;

  function watch() {
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver(records => {
      records.forEach(r => {
        if (r.type === 'characterData') doText(r.target);
        else if (r.type === 'attributes') doAttrs(r.target);
        else r.addedNodes.forEach(walk);
      });
    });
    observer.observe(document.documentElement, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ATTRS
    });
  }

  // ---------------------------------------------------------------- language

  function saved() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function initial() {
    const s = saved();
    if (s === 'lv' || s === 'en') return s;
    const nav = String((typeof navigator !== 'undefined' && (navigator.language || '')) || '').toLowerCase();
    return nav.indexOf('lv') === 0 ? 'lv' : 'en';
  }

  function paintSwitch() {
    document.querySelectorAll('[data-lang-btn]').forEach(b => {
      const on = b.dataset.langBtn === lang;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  let titleEn = null;
  function paintTitle() {
    if (titleEn === null) titleEn = document.title;
    document.title = tr(titleEn);
  }

  function set(next, remember) {
    if (next !== 'lv' && next !== 'en') return;
    lang = next;
    if (remember !== false) { try { localStorage.setItem(KEY, next); } catch (e) { /* keep for this visit */ } }
    document.documentElement.lang = next;
    reapply();
    paintTitle();
    paintSwitch();
    document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: next } }));
  }

  // A small LV | EN switch for pages that do not have their own (the sign-in page).
  function ensureSwitch() {
    if (document.querySelector('[data-lang-btn]')) return;
    const box = document.createElement('div');
    box.setAttribute('data-i18n', 'off');
    box.className = 'langs langs--float';
    box.innerHTML = '<button type="button" data-lang-btn="lv" aria-label="Latviešu">LV</button>' +
                    '<button type="button" data-lang-btn="en" aria-label="English">EN</button>';
    const style = document.createElement('style');
    style.textContent =
      '.langs--float{position:fixed;top:calc(env(safe-area-inset-top,0px) + 10px);right:10px;z-index:9999;display:flex;gap:6px}' +
      '.langs--float button{min-width:56px;min-height:56px;padding:0 10px;border:2px solid #9aa7b4;border-radius:14px;background:#fff;color:#0B1F2E;font:800 17px system-ui,sans-serif;cursor:pointer}' +
      '.langs--float button.is-on{background:#0B5FA5;border-color:#0B5FA5;color:#fff}';
    box.appendChild(style);
    document.body.appendChild(box);
  }

  function bindSwitch() {
    document.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-lang-btn]');
      if (b) set(b.dataset.langBtn);
    });
  }

  function start() {
    lang = initial();
    document.documentElement.lang = lang;
    ensureSwitch();
    bindSwitch();
    walk(document.body);
    paintTitle();
    watch();
    paintSwitch();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  return {
    register,
    t: tr,
    lang: () => lang,
    set,
    missed: () => Array.from(missed),
    clearMissed: () => missed.clear()
  };
})();

if (typeof window !== 'undefined') window.I18n = I18n;
