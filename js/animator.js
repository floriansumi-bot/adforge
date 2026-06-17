/* AdForge — canvas animator.
   Draws ad scenes onto a <canvas> with Ken Burns motion, crossfades and animated
   text overlays. Stateless render: draw(ctx, timeline, tMs, format) paints the frame
   at time t, so the recorder can drive it frame-by-frame. */
window.AF = window.AF || {};

AF.animator = (function () {
  const FORMATS = {
    square:    { w: 1024, h: 1024, label: 'Square 1:1' },
    landscape: { w: 1280, h: 720,  label: 'Landscape 16:9' },
    portrait:  { w: 720,  h: 1280, label: 'Portrait 9:16' }
  };
  const FADE_MS = 450;
  const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  /* Load an image CORS-clean so the canvas never taints (recording would fail otherwise).
     Strategy: try crossOrigin=anonymous → fetch-as-blob → last-resort tainted load. */
  function loadImage(url) {
    return new Promise((resolve) => {
      const tryLoad = (src, crossOrigin, clean) => new Promise((res, rej) => {
        const img = new Image();
        if (crossOrigin) img.crossOrigin = 'anonymous';
        img.onload = () => res({ img, clean });
        img.onerror = rej;
        img.src = src;
      });
      tryLoad(url, true, true)
        .then(resolve)
        .catch(() => fetch(url).then(r => r.blob()).then(b => {
          const obj = URL.createObjectURL(b);
          return tryLoad(obj, false, true); // same-origin blob → clean
        }).then(resolve))
        .catch(() => tryLoad(url, false, false).then(resolve)) // tainted: preview only
        .catch(() => resolve({ img: null, clean: false }));
    });
  }

  /* Build a timeline from scenes. Each item needs a loaded image + duration (ms). */
  function buildTimeline(items) {
    let t = 0;
    const out = items.map((it, i) => {
      const start = t;
      t += it.durMs;
      return Object.assign({ index: i, startMs: start }, it);
    });
    return { items: out, totalMs: t, allClean: items.every(it => it.clean !== false) };
  }

  /* object-fit: cover draw with a scale + normalized pan offset (-1..1). */
  function drawCover(ctx, img, W, H, scale, panX, panY) {
    if (!img) { ctx.fillStyle = '#11142b'; ctx.fillRect(0, 0, W, H); return; }
    const ir = img.width / img.height, cr = W / H;
    let dw, dh;
    if (ir > cr) { dh = H * scale; dw = dh * ir; } else { dw = W * scale; dh = dw / ir; }
    const maxX = (dw - W) / 2, maxY = (dh - H) / 2;
    const x = (W - dw) / 2 + panX * maxX;
    const y = (H - dh) / 2 + panY * maxY;
    ctx.drawImage(img, x, y, dw, dh);
  }

  function motionParams(motion, p) {
    // p = 0..1 progress through the scene
    const e = easeInOut(p);
    switch (motion) {
      case 'still':     return { scale: 1.02, panX: 0, panY: 0 };
      case 'zoom-in':   return { scale: 1.0 + 0.14 * e, panX: 0, panY: 0 };
      case 'zoom-out':  return { scale: 1.14 - 0.14 * e, panX: 0, panY: 0 };
      case 'pan-right': return { scale: 1.1, panX: -1 + 2 * e, panY: 0 };
      case 'pan-left':  return { scale: 1.1, panX: 1 - 2 * e, panY: 0 };
      case 'kenburns':
      default:          return { scale: 1.04 + 0.1 * e, panX: -0.4 + 0.8 * e, panY: -0.25 + 0.4 * e };
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapText(ctx, text, maxW) {
    const words = String(text).split(/\s+/);
    const lines = []; let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  /* Draw one scene's image + animated text overlay at local progress p (0..1), with alpha. */
  function drawScene(ctx, item, W, H, p, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const m = motionParams(item.motion, p);
    drawCover(ctx, item.img, W, H, m.scale, m.panX, m.panY);

    // bottom scrim for legibility
    const grad = ctx.createLinearGradient(0, H * 0.45, 0, H);
    grad.addColorStop(0, 'rgba(8,9,18,0)');
    grad.addColorStop(1, 'rgba(8,9,18,0.82)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, H * 0.45, W, H * 0.55);

    // text slides up + fades in over the first ~0.6s of the scene (p is 0..1 of the scene)
    const localSec = p * item.durMs / 1000;
    const tIn = Math.min(1, localSec / 0.6);
    const slide = (1 - easeInOut(tIn)) * H * 0.04;
    ctx.globalAlpha = alpha * tIn;

    const pad = W * 0.06;
    let y = H - pad;
    const t = item.text || {};

    // CTA pill
    if (t.cta) {
      ctx.font = `700 ${Math.round(W * 0.028)}px ui-sans-serif, system-ui, Arial`;
      const cw = ctx.measureText(t.cta).width + W * 0.05;
      const ch = W * 0.062;
      const cx = pad, cy = y - ch + slide;
      const g = ctx.createLinearGradient(cx, 0, cx + cw, 0);
      g.addColorStop(0, '#7c5cff'); g.addColorStop(1, '#ff5ca8');
      ctx.fillStyle = g; roundRect(ctx, cx, cy, cw, ch, ch / 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillText(t.cta, cx + W * 0.025, cy + ch / 2);
      y = cy - W * 0.03;
    }

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    // subhead
    if (t.subhead) {
      ctx.font = `500 ${Math.round(W * 0.032)}px ui-sans-serif, system-ui, Arial`;
      ctx.fillStyle = 'rgba(232,235,247,0.92)';
      const lines = wrapText(ctx, t.subhead, W - pad * 2);
      for (let i = lines.length - 1; i >= 0; i--) { ctx.fillText(lines[i], pad, y + slide); y -= W * 0.045; }
      y -= W * 0.01;
    }
    // headline
    if (t.headline) {
      ctx.font = `800 ${Math.round(W * 0.055)}px ui-sans-serif, system-ui, Arial`;
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 2;
      const lines = wrapText(ctx, t.headline, W - pad * 2);
      for (let i = lines.length - 1; i >= 0; i--) { ctx.fillText(lines[i], pad, y + slide); y -= W * 0.07; }
    }
    ctx.restore();
  }

  /* Paint the whole composition at absolute time tMs. */
  function draw(ctx, timeline, tMs, format) {
    const f = FORMATS[format] || FORMATS.square;
    const W = f.w, H = f.h;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#08090f'; ctx.fillRect(0, 0, W, H);
    const items = timeline.items;
    // find current scene
    let cur = items[0];
    for (const it of items) { if (tMs >= it.startMs) cur = it; }
    const idx = cur.index;
    const local = tMs - cur.startMs;
    const p = Math.min(1, Math.max(0, local / cur.durMs));
    drawScene(ctx, cur, W, H, p, 1);
    // crossfade into the next scene near the boundary
    const next = items[idx + 1];
    if (next) {
      const remaining = cur.durMs - local;
      if (remaining < FADE_MS) {
        const fa = 1 - remaining / FADE_MS;
        drawScene(ctx, next, W, H, 0, fa);
      }
    }
  }

  return { FORMATS, FADE_MS, loadImage, buildTimeline, draw };
})();
