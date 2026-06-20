/* AdForge — image generation. DEFAULT = Pollinations (FLUX): free, keyless, works
   for every visitor, so the demo produces real ad images out of the box. Z.ai
   CogView is an optional paid alternative (set Image source = Z.ai in Settings).
   Either way, generate() returns a hosted image URL. */
window.AF = window.AF || {};

AF.images = (function () {
  const { config, settings } = AF;

  function target() {
    const s = settings.get();
    return settings.usingProxy()
      ? { url: s.proxyBase.trim().replace(/\/$/, '') + '/image', auth: false }
      : { url: config.IMAGE_ENDPOINT, auth: true };
  }

  function parseSize(size) {
    const m = /(\d+)\s*x\s*(\d+)/i.exec(String(size || ''));
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [1024, 1024];
  }

  /* Preload so we only show a card once the pixels are ready. Times out so a
     slow/stuck image can never stall the whole scene pipeline. */
  function preload(url, timeoutMs = 40000) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      let done = false;
      const finish = (fn, arg) => { if (!done) { done = true; clearTimeout(to); fn(arg); } };
      const to = setTimeout(() => finish(reject, new Error('Image timed out')), timeoutMs);
      img.onload = () => finish(resolve, url);
      img.onerror = () => finish(reject, new Error('Image failed to load'));
      img.src = url;
    });
  }

  /* Build a free Pollinations image URL — the URL itself returns the image. */
  function pollinationsURL(prompt, opts = {}) {
    const [w, h] = parseSize(opts.size || config.IMG_SIZE);
    const seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9);
    const q = encodeURIComponent(String(prompt).slice(0, 1800));
    return config.POLLINATIONS_BASE + q +
      `?width=${w}&height=${h}&nologo=true&model=${config.POLLINATIONS_MODEL}&seed=${seed}`;
  }

  /* Generate one image. Returns {url}. */
  async function generate(prompt, opts = {}) {
    const s = settings.get();
    // Free keyless default. Only use Z.ai CogView when explicitly chosen AND a key
    // (or proxy) is available; otherwise always fall through to Pollinations.
    if ((s.imageProvider || 'pollinations') !== 'zai' || !settings.configured()) {
      const url = pollinationsURL(prompt, opts);
      await preload(url);
      return { url };
    }
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
