// Preserve the manifest's stylesheet/script order and load each feature once.
// Kept assets support SPA handoffs without re-executing listeners or losing drafts.
export function createPageAssets(document, location) {
  const pending = new Map(), preloaded = new Set();
  const selected = (selector, path) => {
    const route = new URL(path, location.href).pathname;
    return [...document.querySelectorAll(selector)].filter(node => node.dataset.pages.split(' ').includes(route));
  };
  function loadStyle(link) {
    if (pending.has(link)) return pending.get(link);
    const ready = new Promise((resolve, reject) => {
      const cleanup = () => { link.removeEventListener('load', loaded); link.removeEventListener('error', failed); };
      const loaded = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); link.removeAttribute('href'); pending.delete(link); reject(new Error('stylesheet_load_failed')); };
      link.addEventListener('load', loaded); link.addEventListener('error', failed); link.href = link.dataset.href;
    });
    pending.set(link, ready); return ready;
  }
  function loadScript(manifest) {
    if (pending.has(manifest)) return pending.get(manifest);
    const script = document.createElement('script');
    // Ordered classic scripts keep the application's shared global bindings.
    // Dependencies must finish successfully before their consumers execute.
    script.async = false; script.src = manifest.dataset.src;
    const ready = new Promise((resolve, reject) => {
      script.onload = () => resolve();
      script.onerror = () => { script.remove(); pending.delete(manifest); reject(new Error('script_load_failed')); };
    });
    pending.set(manifest, ready); document.body.append(script); return ready;
  }
  function preloadScript(manifest) {
    if (preloaded.has(manifest.dataset.src)) return;
    preloaded.add(manifest.dataset.src);
    const preload = document.createElement('link');
    preload.rel = 'preload'; preload.as = 'script'; preload.href = manifest.dataset.src; document.head.append(preload);
  }
  function prefetch(path) {
    selected('script[data-pages]',path).forEach(preloadScript);
  }
  function load(path) {
    const scripts = selected('script[data-pages]', path);
    // Fetch together, then execute in order. A failed dependency stops the
    // chain so a retry can load it before any dependent code is evaluated.
    scripts.forEach(preloadScript);
    const ready = scripts.reduce((previous, manifest) => previous.then(() => loadScript(manifest)), Promise.resolve());
    return Promise.all([...selected('link[data-pages]', path).map(loadStyle), ready]);
  }
  // Fetch initial-route features early, but execute them only after the core
  // scripts have initialized and navigation calls load().
  selected('link[data-pages]', location.pathname).forEach(link => loadStyle(link).catch(() => {}));
  selected('script[data-pages]', location.pathname).forEach(preloadScript);
  return { load, prefetch };
}
