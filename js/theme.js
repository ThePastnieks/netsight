// NetSight Theme Module
// system -> light -> dark, persisted locally, applied before first paint

const Theme = (function() {
  'use strict';

  const KEY = CONFIG.THEME_STORAGE_KEY || 'netsight_theme';
  const ORDER = ['system', 'light', 'dark'];
  const LABELS = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' };

  let current = 'system';
  let media = null;

  function read() {
    try {
      const saved = localStorage.getItem(KEY);
      return ORDER.includes(saved) ? saved : 'system';
    } catch {
      return 'system';
    }
  }

  function apply(mode) {
    current = ORDER.includes(mode) ? mode : 'system';

    const resolved = current === 'system'
      ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : current;

    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.themeMode = current;
    root.style.colorScheme = resolved;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#07131F' : '#0B2A4A');

    try { localStorage.setItem(KEY, current); } catch { /* ignore */ }

    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      btn.setAttribute('aria-label', LABELS[current]);
      btn.setAttribute('title', LABELS[current]);
      btn.dataset.mode = current;
    });

    document.dispatchEvent(new CustomEvent('themechange', { detail: { mode: current, resolved } }));
    return current;
  }

  function cycle() {
    const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
    return apply(next);
  }

  function init() {
    apply(read());

    if (window.matchMedia) {
      media = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => { if (current === 'system') apply('system'); };
      if (media.addEventListener) media.addEventListener('change', onChange);
      else if (media.addListener) media.addListener(onChange);
    }

    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      btn.addEventListener('click', () => cycle());
    });

    return current;
  }

  return { init, apply, cycle, get: () => current };
})();

// Apply as early as possible to avoid a flash of the wrong theme
(function earlyTheme() {
  try {
    const saved = localStorage.getItem((window.CONFIG && CONFIG.THEME_STORAGE_KEY) || 'netsight_theme');
    const dark = saved === 'dark' || (saved !== 'light' &&
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch { /* ignore */ }
})();

window.Theme = Theme;
