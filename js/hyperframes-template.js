/* AdForge — HyperFrames composition generator.
   Turns AdForge scenes into a self-contained HTML page with ONE paused GSAP master
   timeline registered at window.__timelines["main"] — exactly what the HyperFrames
   engine seeks frame-by-frame. GSAP-only (the engine's supported, deterministic path):
   no Date.now / requestAnimationFrame / unseeded random / render-time fetch of critical
   assets (images are inlined as data URIs by the client when present).

   Image-free by design: every scene gets an animated motion-graphics background built
   from the brand PALETTE (drifting gradient + floating blobs) plus kinetic typography,
   so a campaign renders as a polished video ad even with NO generated imagery. When a
   scene image IS supplied it's layered on top with a Ken-Burns move. */
window.AF = window.AF || {};

AF.hfTemplate = (function () {
  const DIM = { square: [1080, 1080], landscape: [1920, 1080], portrait: [1080, 1920] };
  const KB = {
    kenburns:   { s: [1.04, 1.14], x: [-3, 3], y: [-2, 2] },
    'zoom-in':  { s: [1.00, 1.14], x: [0, 0],  y: [0, 0] },
    'zoom-out': { s: [1.14, 1.00], x: [0, 0],  y: [0, 0] },
    'pan-left': { s: [1.10, 1.10], x: [4, -4], y: [0, 0] },
    'pan-right':{ s: [1.10, 1.10], x: [-4, 4], y: [0, 0] },
    still:      { s: [1.02, 1.02], x: [0, 0],  y: [0, 0] }
  };
  const FADE = 0.5;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Normalise a palette to >=3 usable hex colours, deriving from brandColor if sparse.
  function normPalette(palette, brand) {
    const hex = (Array.isArray(palette) ? palette : [])
      .filter(c => typeof c === 'string' && /^#?[0-9a-f]{3,8}$/i.test(c.trim()))
      .map(c => (c.trim()[0] === '#' ? c.trim() : '#' + c.trim()));
    const base = hex.length ? hex : [brand || '#7c5cff', '#ff5ca8', '#22d3ee'];
    while (base.length < 3) base.push(base[base.length % base.length]);
    return base;
  }

  /* scenes: [{ imageUrl, imageDataUrl?, copy:{headline,subhead,cta}, motion, durMs }] */
  function build(scenes, { format = 'square', brandColor = '#7c5cff', palette = [] } = {}) {
    const [W, H] = DIM[format] || DIM.square;
    const pal = normPalette(palette, brandColor);
    const durSec = scenes.map(s => Math.max(1.8, (s.durMs || 3400) / 1000));
    const startSec = []; let acc = 0;
    durSec.forEach((d, i) => { startSec[i] = acc; acc += d; });
    const total = acc;

    const sections = scenes.map((s, i) => {
      const c = s.copy || {};
      const src = s.imageDataUrl || s.imageUrl || '';
      const a = pal[i % pal.length], b = pal[(i + 1) % pal.length], cc = pal[(i + 2) % pal.length];
      const words = String(c.headline || '').split(/\s+/).filter(Boolean)
        .map(w => '<span class="w">' + esc(w) + '</span>').join(' ');
      const grad = 'linear-gradient(125deg,' + esc(a) + ' 0%,' + esc(b) + ' 55%,' + esc(cc) + ' 100%)';
      const imgHtml = src
        ? '<div class="ph"><img id="img' + i + '" src="' + esc(src) + '" crossorigin="anonymous"></div>'
        : '';
      return '<section class="clip" id="s' + i + '" data-start="' + startSec[i] +
             '" data-duration="' + durSec[i] + '" data-track-index="' + i + '">' +
        '<div class="bg" id="bg' + i + '" style="background:' + grad + '"></div>' +
        '<span class="blob blob-a" id="ba' + i + '" style="background:radial-gradient(circle,' + esc(a) + ' 0%,transparent 70%)"></span>' +
        '<span class="blob blob-b" id="bb' + i + '" style="background:radial-gradient(circle,' + esc(cc) + ' 0%,transparent 70%)"></span>' +
        imgHtml +
        '<div class="scrim"></div>' +
        '<div class="copy">' +
          '<span class="kicker" id="kik' + i + '"></span>' +
          '<h1 class="hl" id="hl' + i + '">' + words + '</h1>' +
          (c.subhead ? '<p class="sub" id="sub' + i + '">' + esc(c.subhead) + '</p>' : '') +
          (c.cta ? '<span class="cta" id="cta' + i + '">' + esc(c.cta) + '</span>' : '') +
        '</div>' +
      '</section>';
    }).join('\n');

    const hasImg = scenes.map(s => !!(s.imageDataUrl || s.imageUrl));
    const sceneMeta = scenes.map((s, i) => ({ i, start: startSec[i], dur: durSec[i], motion: s.motion || 'kenburns', img: hasImg[i] }));

    const css =
      'html,body{margin:0;background:#070512;font-family:ui-sans-serif,system-ui,Arial}' +
      '#main{position:relative;overflow:hidden;background:#070512}' +
      '.clip{position:absolute;inset:0;opacity:0;overflow:hidden}' +
      '.bg{position:absolute;inset:-25%;will-change:transform}' +
      '.blob{position:absolute;width:70%;height:70%;left:0;top:0;filter:blur(40px);opacity:.55;will-change:transform;border-radius:50%}' +
      '.blob-b{left:auto;right:0;bottom:0;top:auto}' +
      '.ph{position:absolute;inset:0;overflow:hidden}' +
      '.ph img{position:absolute;width:100%;height:100%;object-fit:cover;will-change:transform}' +
      '.scrim{position:absolute;inset:0;background:linear-gradient(0deg,rgba(7,5,18,.85) 0%,rgba(7,5,18,.15) 55%,rgba(7,5,18,.35) 100%)}' +
      '.copy{position:absolute;left:7%;right:7%;bottom:8%}' +
      '.kicker{display:block;height:4px;width:0;border-radius:3px;margin-bottom:3.2vmin;background:linear-gradient(90deg,var(--brand,#7c5cff),#fff)}' +
      '.hl{font-weight:800;font-size:6vmin;color:#fff;text-shadow:0 2px 18px rgba(0,0,0,.55);margin:0;line-height:1.08;letter-spacing:-.01em}' +
      '.hl .w{display:inline-block;opacity:0}' +
      '.sub{font-weight:500;font-size:3.3vmin;color:rgba(255,255,255,.92);margin:.6em 0 0;opacity:0;text-shadow:0 1px 10px rgba(0,0,0,.5)}' +
      '.cta{display:inline-block;margin-top:1.1em;padding:.55em 1.2em;border-radius:999px;font-weight:700;' +
        'font-size:3vmin;color:#fff;opacity:0;background:linear-gradient(90deg,var(--brand,#7c5cff),#ff5ca8);box-shadow:0 8px 24px rgba(0,0,0,.35)}';

    const script =
      'const SCENES=' + JSON.stringify(sceneMeta) + ';' +
      'const KB=' + JSON.stringify(KB) + ';' +
      'const FADE=' + FADE + ';' +
      'const tl=gsap.timeline({paused:true});' +
      'SCENES.forEach(function(sc){' +
        'var at=sc.start,end=at+sc.dur,k=KB[sc.motion]||KB.kenburns;' +
        // clip fade in/out
        'tl.fromTo("#s"+sc.i,{opacity:0},{opacity:1,duration:FADE,ease:"power1.inOut"},at);' +
        'if(sc.i<SCENES.length-1)tl.to("#s"+sc.i,{opacity:0,duration:FADE,ease:"power1.inOut"},end-FADE);' +
        // animated gradient background: slow drift + rotate (deterministic, GSAP-driven)
        'tl.fromTo("#bg"+sc.i,{rotation:-6,scale:1.08,xPercent:-4,yPercent:-3},{rotation:6,scale:1.2,xPercent:4,yPercent:3,duration:sc.dur,ease:"sine.inOut"},at);' +
        // floating blobs drift in opposite directions
        'tl.fromTo("#ba"+sc.i,{xPercent:-14,yPercent:-10,scale:1},{xPercent:18,yPercent:12,scale:1.25,duration:sc.dur,ease:"sine.inOut"},at);' +
        'tl.fromTo("#bb"+sc.i,{xPercent:16,yPercent:12,scale:1.2},{xPercent:-14,yPercent:-8,scale:1,duration:sc.dur,ease:"sine.inOut"},at);' +
        // optional product image Ken-Burns (only present when an image was supplied)
        'if(sc.img)tl.fromTo("#img"+sc.i,{scale:k.s[0],xPercent:k.x[0],yPercent:k.y[0]},{scale:k.s[1],xPercent:k.x[1],yPercent:k.y[1],duration:sc.dur,ease:"sine.inOut"},at);' +
        // kicker bar wipe in
        'tl.fromTo("#kik"+sc.i,{width:0,opacity:0},{width:"14vmin",opacity:1,duration:0.5,ease:"power3.out"},at+0.15);' +
        // headline words stagger up
        'tl.to("#hl"+sc.i+" .w",{opacity:1,y:0,duration:0.55,stagger:0.07,ease:"back.out(1.6)",startAt:{y:26}},at+0.3);' +
        'if(document.getElementById("sub"+sc.i))tl.to("#sub"+sc.i,{opacity:1,y:0,duration:0.5,ease:"power2.out",startAt:{y:18}},at+0.7);' +
        'if(document.getElementById("cta"+sc.i))tl.to("#cta"+sc.i,{opacity:1,scale:1,duration:0.45,ease:"back.out(2)",startAt:{scale:0.8}},end-0.9);' +
      '});' +
      'tl.to({},{duration:0.001},' + total + ');' +
      'window.__timelines=window.__timelines||{};' +
      'window.__timelines["main"]=tl;';

    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<style>' + css + '</style></head><body>' +
      '<div id="main" data-composition-id="main" data-width="' + W + '" data-height="' + H + '"' +
        ' style="width:' + W + 'px;height:' + H + 'px;--brand:' + esc(brandColor) + '">' +
      sections +
      '</div>' +
      '<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"><\/script>' +
      '<script>' + script + '<\/script>' +
      '</body></html>';
  }

  return { build, DIM };
})();
