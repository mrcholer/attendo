(() => {
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try {
    const saved = localStorage.getItem('logged-theme');
    if (['light', 'dark', 'system'].includes(saved)) preference = saved;
  } catch { /* Keep system mode when storage is unavailable. */ }

  function applyTheme() {
    document.documentElement.dataset.theme = preference === 'system'
      ? (system.matches ? 'dark' : 'light') : preference;
  }
  applyTheme();
  system.addEventListener('change', applyTheme);
  document.addEventListener('DOMContentLoaded', () => {
    const selector = document.getElementById('theme');
    selector.value = preference;
    selector.addEventListener('change', () => {
      preference = selector.value;
      try { localStorage.setItem('logged-theme', preference); } catch { /* Apply for this visit. */ }
      applyTheme();
    });
  });
})();
