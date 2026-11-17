(() => {
  'use strict';
  const key = 'task-board-theme';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try { const stored = localStorage.getItem(key); if (['system', 'light', 'dark'].includes(stored)) preference = stored; } catch {}
  function apply() {
    const dark = preference === 'dark' || (preference === 'system' && system.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#141a18' : '#fafaf7');
    const toggle = document.getElementById('themeToggle');
    if (toggle) { toggle.textContent = dark ? '☀ Светлая тема' : '☾ Тёмная тема'; toggle.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему'); toggle.setAttribute('aria-pressed', String(dark)); }
    const select = document.getElementById('themeSelect'); if (select) select.value = preference;
  }
  function choose(value) { preference = value; try { localStorage.setItem(key, value); } catch {} apply(); }
  apply();
  system.addEventListener('change', () => { if (preference === 'system') apply(); });
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('themeToggle').addEventListener('click', () => choose(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
    document.getElementById('themeSelect').addEventListener('change', event => choose(event.target.value));
    apply();
  });
})();
