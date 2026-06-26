/* AdForge — bootstrap. */
(function () {
  // Kill any previously-installed service worker + caches (the SW was serving
  // stale code). Reload AT MOST ONCE per tab (sessionStorage guard) so this can
  // never become a reload loop, even if unregister is slow to take effect.
  async function purgeStaleSW() {
    if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return false;
    const hadController = !!navigator.serviceWorker.controller;
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
      if (window.caches) { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); }
    } catch {}
    // Only reload if a SW was actively controlling this page (i.e. possibly stale),
    // and only once ever per tab session.
    if (hadController && !sessionStorage.getItem('af_sw_purged')) {
      try { sessionStorage.setItem('af_sw_purged', '1'); } catch {}
      location.reload();
      return true; // halt start()
    }
    return false;
  }

  function start() {
    AF.ui.init();
    AF.log.info('AdForge ready. ' + AF.llm.activeBrain() + '. Describe a product and hit Generate.');
  }

  (async () => {
    const reloading = await purgeStaleSW();
    if (reloading) return;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  })();
})();
