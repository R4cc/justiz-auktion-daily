// Preserve the manifest's stylesheet/script order and load each feature once.
// Kept assets support SPA handoffs without re-executing listeners or losing drafts.
window.pageAssets = (() => {
  const pending = new Map();
  const selected = (selector, path) => {
    const route = new URL(path, location.href).pathname;
    return [...document.querySelectorAll(selector)].filter(node => node.dataset.pages.split(' ').includes(route));
  };
  function loadStyle(link) {
    if (pending.has(link)) return pending.get(link);
    const ready = new Promise((resolve, reject) => {
      const cleanup = () => { link.removeEventListener('load', loaded); link.removeEventListener('error', failed); };
      const loaded = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); pending.delete(link); reject(new Error('stylesheet_load_failed')); };
      link.addEventListener('load', loaded); link.addEventListener('error', failed); link.href = link.dataset.href;
    });
    pending.set(link, ready); return ready;
  }
  function loadScript(manifest) {
    if (pending.has(manifest)) return pending.get(manifest);
    const script = document.createElement('script');
    // Ordered classic scripts keep the application's shared global bindings.
    // Start all downloads together; dependencies execute in manifest order.
    script.async = false; script.src = manifest.dataset.src;
    const ready = new Promise((resolve, reject) => {
      script.onload = () => resolve();
      script.onerror = () => { script.remove(); pending.delete(manifest); reject(new Error('script_load_failed')); };
    });
    pending.set(manifest, ready); document.body.append(script); return ready;
  }
  function load(path) {
    return Promise.all([
      ...selected('link[data-pages]', path).map(loadStyle),
      ...selected('script[data-pages]', path).map(loadScript)
    ]);
  }
  // Fetch initial-route features early, but execute them only after the core
  // scripts have initialized and navigation calls load().
  selected('link[data-pages]', location.pathname).forEach(link => loadStyle(link).catch(() => {}));
  for (const manifest of selected('script[data-pages]', location.pathname)) {
    const preload = document.createElement('link');
    preload.rel = 'preload'; preload.as = 'script'; preload.href = manifest.dataset.src; document.head.append(preload);
  }
  return { load };
})();
