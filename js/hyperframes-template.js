/* AdForge — HyperFrames composition generator.
   Turns AdForge scenes into a self-contained HTML page with ONE paused GSAP master
   timeline registered at window.__timelines["main"] — exactly what the HyperFrames
   engine seeks frame-by-frame. GSAP-only (the engine's supported, deterministic path):
   no Date.now / requestAnimationFrame / unseeded random / render-time fetch of critical
   assets (images are inlined as data URIs by the client when possible). */
window.AF = window.AF || {};

AF.hfTemplate = (function () {
  const DIM = { square: [1080, 1080], landscape: [1920, 1080], portrait: [1080, 1920] };
  // Ken-Burns presets mirror animator.motionParams: scale [start,end], pan % [start,end].
  const KB = {
    kenburns:   { s: [1.04, 1.14], x: [-3, 3], y: [-2, 2] },
    'zoom-in':  { s: [1.00, 1.14], x: [0, 0],  y: [0, 0] },
    'zoom-out': { s: [1.14, 1.00], x: [0, 0],  y: [0, 0] },
    'pan-left': { s: [1.10, 1.10], x: [4, -4], y: [0, 0] },
    'pan-right':{ s: [1.10, 1.10], x: [-4, 4], y: [0, 0] },
    still:      { s: [1.02, 1.02], x: [0, 0],  y: [0, 0] }
  };
  const FADE = 0.45;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* scenes: [{ imageUrl, imageDataUrl?, copy:{headline,subhead,cta}, motion, durMs }] */
  function build(scenes, { format = 'square', brandColor = '#7c5cff' } = {}) {
    const [W, H] = DIM[format] || DIM.square;
    const durSec = scenes.map(s => Math.max(1.5, (s.durMs || 3200) / 1000));
    const startSec = []; let acc = 0;
    durSec.forEach((d, i) => { startSec[i] = acc; acc += d; });
    const total = acc;

    const sections = scenes.map((s, i) => {
      const c = s.copy || {};
      const src = s.imageDataUrl || s.imageUrl || '';
      const words = String(c.headline || '').split(/\s+/).filter(Boolean)
        .map(w => '<span class="w">' + esc(w) + '</span>').join(' ');
      return '<section class="clip" id="s' + i + '" data-start="' + startSec[i] +
             '" data-duration="' + durSec[i] + '" data-track-index="' + i + '">' +
        '<div class="ph"><img id="img' + i + '" src="' + esc(src) + '" crossorigin="anonymous"></div>' +
        '<div class="scrim"></div>' +
        '<div class="copy">' +
          '<h1 class="hl" id="hl' + i + '">' + words + '</h1>' +
          (c.subhead ? '<p class="sub" id="sub' + i + '">' + esc(c.subhead) + '</p>' : '') +
          (c.cta ? '<span class="cta" id="cta' + i + '">' + esc(c.cta) + '</span>' : '') +
        '</div>' +
      '</section>';
    }).join('\n');

    const sceneMeta = scenes.map((s, i) => ({ i, start: startSec[i], dur: durSec[i], motion: s.motion || 'kenburns' }));

    const css =
      'html,body{margin:0;background:#08090f;font-family:ui-sans-serif,system-ui,Arial}' +
      '#main{position:relative;overflow:hidden;background:#08090f}' +
      '.clip{position:absolute;inset:0;opacity:0}' +
      '.ph{position:absolute;inset:0;overflow:hidden}' +
      '.ph img{position:absolute;width:100%;height:100%;object-fit:cover;will-change:transform}' +
      '.scrim{position:absolute;inset:0;background:linear-gradient(0deg,rgba(8,9,18,.82) 0%,rgba(8,9,18,0) 55%)}' +
      '.copy{position:absolute;left:6%;right:6%;bottom:7%}' +
      '.hl{font-weight:800;font-size:5.5vmin;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.5);margin:0;line-height:1.1}' +
      '.hl .w{display:inline-block;opacity:0}' +
      '.sub{font-weight:500;font-size:3.2vmin;color:rgba(232,235,247,.92);margin:.6em 0 0;opacity:0}' +
      '.cta{display:inline-block;margin-top:1em;padding:.5em 1.1em;border-radius:999px;font-weight:700;' +
        'font-size:2.8vmin;color:#fff;opacity:0;background:linear-gradient(90deg,var(--brand,#7c5cff),#ff5ca8)}';

    const script =
      'const SCENES=' + JSON.stringify(sceneMeta) + ';' +
      'const KB=' + JSON.stringify(KB) + ';' +
      'const FADE=' + FADE + ';' +
      'const tl=gsap.timeline({paused:true});' +
      'SCENES.forEach(function(sc){' +
        'var at=sc.start,end=at+sc.dur,k=KB[sc.motion]||KB.kenburns;' +
        'tl.fromTo("#s"+sc.i,{opacity:0},{opacity:1,duration:FADE,ease:"power1.inOut"},at);' +
        'if(sc.i<SCENES.length-1)tl.to("#s"+sc.i,{opacity:0,duration:FADE,ease:"power1.inOut"},end-FADE);' +
        'tl.fromTo("#img"+sc.i,{scale:k.s[0],xPercent:k.x[0],yPercent:k.y[0]},' +
          '{scale:k.s[1],xPercent:k.x[1],yPercent:k.y[1],duration:sc.dur,ease:"sine.inOut"},at);' +
        'tl.to("#hl"+sc.i+" .w",{opacity:1,y:0,duration:0.5,stagger:0.08,ease:"back.out(1.6)",startAt:{y:24}},at+0.2);' +
        'if(document.getElementById("sub"+sc.i))tl.to("#sub"+sc.i,{opacity:1,y:0,duration:0.5,ease:"power2.out",startAt:{y:18}},at+0.55);' +
        'if(document.getElementById("cta"+sc.i))tl.to("#cta"+sc.i,{opacity:1,scale:1,duration:0.4,ease:"back.out(2)",startAt:{scale:0.8}},end-0.8);' +
      '});' +
      'tl.to({},{duration:0.001},' + total + ');' +   // pin total length = sum of scene durations
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
