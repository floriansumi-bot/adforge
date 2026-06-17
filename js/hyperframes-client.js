/* AdForge — HyperFrames render-service client.
   Builds the GSAP composition (AF.hfTemplate), POSTs it to the configured render
   service URL, and returns the MP4 blob. Inlines scene images as data URIs by default
   so the server never has to fetch (avoids expiring Z.ai URLs / non-deterministic frames). */
window.AF = window.AF || {};

AF.hyperframesClient = (function () {
  function toDataUrl(url) {
    return fetch(url).then(r => r.blob()).then(b => new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(b);
    }));
  }

  /* scenes: AdForge done-scenes. opts: { format, fps, quality, brandColor, inlineImages }. */
  async function build(scenes, opts = {}, { onStatus } = {}) {
    const base = (AF.settings.get().renderUrl || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('Set a HyperFrames render service URL in Settings first.');
    if (!scenes.length) throw new Error('Generate a campaign with at least one scene first.');

    onStatus && onStatus('Preparing scenes…');
    const prepared = await Promise.all(scenes.map(async (s) => {
      let imageDataUrl = null;
      if (opts.inlineImages !== false && s.imageUrl) {
        try { imageDataUrl = await toDataUrl(s.imageUrl); } catch { /* fall back to URL */ }
      }
      return {
        imageUrl: s.imageUrl, imageDataUrl,
        copy: s.copy || {}, motion: s.motion || 'kenburns', durMs: s.durMs || 3200
      };
    }));

    const html = AF.hfTemplate.build(prepared, {
      format: opts.format || 'square',
      brandColor: opts.brandColor || '#7c5cff',
      palette: opts.palette || []
    });

    onStatus && onStatus('Rendering on the server (cinematic — this can take ~30–90s)…');
    let res;
    try {
      res = await fetch(base + '/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ html, opts: { fps: opts.fps || 30, quality: opts.quality || 'high' } })
      });
    } catch (e) {
      throw new Error('Could not reach the render service at ' + base + ' (' + e.message + '). Is it deployed and awake?');
    }
    if (!res.ok) {
      let msg = 'render failed (HTTP ' + res.status + ')';
      try { const j = await res.json(); if (j.error) msg = j.error + (j.stderr ? ' — ' + j.stderr.slice(-300) : ''); } catch {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    if (!blob || !blob.size) throw new Error('Render service returned an empty file.');
    return {
      url: URL.createObjectURL(blob), blob, mime: 'video/mp4', ext: 'mp4',
      durationMs: prepared.reduce((a, s) => a + (s.durMs || 3200), 0)
    };
  }

  return { build };
})();
