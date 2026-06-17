/* AdForge — image generation via Z.ai CogView (cogview-3-flash is free).
   Same key as the GLM agents. Calls Z.ai directly (CORS allowed) or via the
   optional serverless proxy. Returns a hosted image URL. */
window.AF = window.AF || {};

AF.images = (function () {
  const { config, settings } = AF;

  function target() {
    const s = settings.get();
    return settings.usingProxy()
      ? { url: s.proxyBase.trim().replace(/\/$/, '') + '/image', auth: false }
      : { url: config.IMAGE_ENDPOINT, auth: true };
  }

  /* Preload so we only show a card once the pixels are ready, and catch failures. */
  function preload(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = () => reject(new Error('Image failed to load'));
      img.src = url;
    });
  }

  /* Generate one image. Returns {url}. */
  async function generate(prompt, opts = {}) {
    if (!settings.configured()) throw new Error('No Z.ai key set');
    const s = settings.get();
    const t = target();
    const headers = { 'Content-Type': 'application/json' };
    if (t.auth) headers['Authorization'] = 'Bearer ' + s.zaiKey.trim();
    const res = await fetch(t.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: s.imageModel || 'cogview-3-flash',
        prompt: String(prompt).slice(0, 1800),
        size: opts.size || config.IMG_SIZE
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Friendly messages for the known Z.ai image errors (text/agents are free;
      // CogView image generation is a PAID model on Z.ai's international endpoint).
      if (/"1113"|insufficient balance|recharge/i.test(body)) {
        throw new Error('Image preview unavailable — Z.ai image generation needs a paid balance (the agents, copy and prompts are free). Add credit at z.ai to render images.');
      }
      if (/"1211"|unknown model/i.test(body)) {
        throw new Error('Image model not available on this Z.ai key — only paid CogView-4 is offered here.');
      }
      throw new Error('Image ' + res.status + (body ? ' — ' + body.slice(0, 160) : ''));
    }
    const j = await res.json();
    const item = j?.data?.[0] || {};
    const url = item.url || (item.b64_json ? 'data:image/png;base64,' + item.b64_json : '');
    if (!url) throw new Error('No image returned');
    await preload(url);
    return { url };
  }

  /* Fetch the rendered image as a blob and trigger a download (falls back to a new tab). */
  async function download(url, filename) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = obj; a.download = filename || 'adforge.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(obj), 4000);
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  }

  return { generate, download };
})();
