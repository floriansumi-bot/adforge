/* AdForge — image generation. Free + keyless via Pollinations (FLUX). On a host with
   the serverless proxy (Vercel) images go through /api/image, which fetches the pixels
   server-side — browsers can no longer call Pollinations' image endpoint directly (it
   Turnstile-gates browser requests → 403). generate() returns a hosted image URL.

   Reliability: the free tier 429s on concurrent requests and FLUX can be slow when
   busy, so generate() RETRIES with backoff + a fresh seed (giving the rate limit time
   to clear), and the final attempt falls back to the 'sana' model. Scenes also render
   one at a time (IMG_CONCURRENCY = 1) to avoid tripping the rate limit. */
window.AF = window.AF || {};

AF.images = (function () {
  const { config, settings } = AF;

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

  /* Build the image URL. On a host with the serverless proxy (Vercel) we go through
     /api/image, which fetches the pixels server-side — browsers can't call
     Pollinations' image endpoint directly anymore (it's Turnstile-gated → 403). The
     proxy image is also same-origin, so the canvas stays CORS-clean for recording.
     With no proxy (local / GitHub Pages) we fall back to the direct URL. */
  function imageURL(prompt, opts = {}) {
    const [w, h] = parseSize(opts.size || config.IMG_SIZE);
    const seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9);
    const model = opts.model || config.POLLINATIONS_MODEL;
    const q = encodeURIComponent(String(prompt).slice(0, 1800));
    if (settings.usingProxy()) {
      const base = settings.get().proxyBase.trim().replace(/\/$/, '');
      return `${base}/image?prompt=${q}&width=${w}&height=${h}&model=${model}&seed=${seed}`;
    }
    return config.POLLINATIONS_BASE + q +
      `?width=${w}&height=${h}&nologo=true&nofeed=true&model=${model}&seed=${seed}&referrer=adforge`;
  }

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  /* Each attempt waits a little longer (backoff) and uses a fresh seed, so a rate-
     limited free tier gets time to cool down between tries. The last attempt falls
     back to 'sana' (the model Pollinations currently advertises) when FLUX is busy. */
  const ATTEMPTS = [
    { model: 'flux', timeoutMs: 58000, backoffMs: 0 },
    { model: 'flux', timeoutMs: 58000, backoffMs: 2500 },
    { model: 'sana', timeoutMs: 58000, backoffMs: 4000 }
  ];

  /* Generate one image. Returns {url, model}. Retries with backoff before giving up. */
  async function generate(prompt, opts = {}) {
    const baseSeed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9);
    let lastErr;
    for (let i = 0; i < ATTEMPTS.length; i++) {
      const a = ATTEMPTS[i];
      if (a.backoffMs) await delay(a.backoffMs);
      const url = imageURL(prompt, { ...opts, model: a.model, seed: baseSeed + i * 7919 });
      try {
        await preload(url, a.timeoutMs);
        return { url, model: a.model };
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Image generation failed');
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
