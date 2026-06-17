/* AdForge — video ad builder.
   Ties the agents' scenes + copy together with the animator, the Kokoro voiceover
   and the recorder to produce a downloadable animated video ad entirely in-browser. */
window.AF = window.AF || {};

AF.video = (function () {
  const { animator, recorder, voiceover, orchestrator } = AF;

  function doneScenes() {
    return orchestrator.state.scenes.filter(s => s.status === 'done' && s.imageUrl);
  }

  // Scenes usable in a video ad: any planned scene with copy or a name. The image is
  // OPTIONAL — when a scene has no rendered image (e.g. the free tier can't generate
  // one) the animator / HyperFrames paint a brand-palette motion background instead.
  function adScenes() {
    return orchestrator.state.scenes.filter(s => s.name || (s.copy && (s.copy.headline || s.copy.subhead)));
  }

  function brandPalette() {
    const p = orchestrator.state.brief && orchestrator.state.brief.palette;
    return (Array.isArray(p) && p.length) ? p : ['#7c5cff', '#ff5ca8', '#22d3ee'];
  }
  function sceneBg(i) {
    const p = brandPalette();
    return [p[i % p.length], p[(i + 1) % p.length], p[(i + 2) % p.length]];
  }

  /* The line of voiceover spoken over a scene. */
  function sceneScript(scene, isLast) {
    const c = scene.copy || {};
    let s = c.headline || scene.name || '';
    const second = c.subhead || c.body || '';
    if (second) s += '. ' + second;
    if (isLast && c.cta) s += '. ' + c.cta + '.';
    return s.replace(/\s+/g, ' ').trim();
  }

  function sceneText(s, isLast) {
    const c = s.copy || {};
    return { headline: c.headline || s.name, subhead: c.subhead || '', cta: isLast ? (c.cta || '') : '' };
  }

  async function prepare({ voiceEngine, voiceId, onStatus, onProgress }) {
    const scenes = adScenes();
    if (!scenes.length) throw new Error('Generate a campaign first.');

    onStatus && onStatus('Loading scenes…');
    const loaded = await Promise.all(scenes.map(s =>
      s.imageUrl ? animator.loadImage(s.imageUrl) : Promise.resolve({ img: null, clean: true })));

    const durations = scenes.map(() => 3200);  // default ms when there is no embeddable audio
    const audioBuffers = [];

    if (voiceEngine === 'kokoro') {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < scenes.length; i++) {
        onStatus && onStatus('Synthesizing voiceover ' + (i + 1) + '/' + scenes.length + '…');
        const blob = await voiceover.synthKokoro(sceneScript(scenes[i], i === scenes.length - 1), voiceId, onProgress);
        const buf = await ac.decodeAudioData(await blob.arrayBuffer());
        durations[i] = Math.max(2600, Math.round(buf.duration * 1000) + 700);
        audioBuffers.push({ buffer: buf, _i: i });
      }
      // assign start times now that durations are known
      let t = 0;
      for (let i = 0; i < durations.length; i++) {
        const ab = audioBuffers.find(a => a._i === i);
        if (ab) ab.startMs = t + 250;
        t += durations[i];
      }
    }

    const items = scenes.map((s, i) => ({
      img: loaded[i].img, clean: loaded[i].clean, bg: sceneBg(i),
      durMs: durations[i], motion: s.motion || 'kenburns',
      text: sceneText(s, i === scenes.length - 1)
    }));
    return { timeline: animator.buildTimeline(items), audioBuffers };
  }

  async function build({ format = 'square', voiceEngine = 'kokoro', voiceId = 'af_heart', canvas, onStatus, onProgress } = {}) {
    if (!recorder.supported()) throw new Error('This browser cannot record video (needs MediaRecorder + canvas.captureStream).');
    const f = (animator.FORMATS[format] || animator.FORMATS.square);
    canvas.width = f.w; canvas.height = f.h;
    const ctx = canvas.getContext('2d');

    const { timeline, audioBuffers } = await prepare({ voiceEngine, voiceId, onStatus, onProgress });
    if (!timeline.allClean) {
      AF.log?.warn('Some images would not load CORS-clean — the recording may fail with a canvas-taint error.', 'Video');
    }
    AF.log?.agent?.('Video', 'Rendering ' + timeline.items.length + ' scenes (' + Math.round(timeline.totalMs / 1000) + 's)');
    onStatus && onStatus('Recording… keep this tab in the foreground');
    const result = await recorder.record({
      canvas, fps: 30, totalMs: timeline.totalMs, audioBuffers,
      render: (t) => animator.draw(ctx, timeline, t, format),
      onProgress
    });
    AF.log?.agent?.('Video', 'Video ad ready (' + result.ext.toUpperCase() + ', ' + Math.round(result.durationMs / 1000) + 's)');
    onStatus && onStatus('Done');
    return result;
  }

  /* Live, audio-less preview loop. Returns a stop() function. */
  async function preview({ format = 'square', canvas } = {}) {
    const scenes = adScenes();
    if (!scenes.length) throw new Error('No scenes yet.');
    const f = (animator.FORMATS[format] || animator.FORMATS.square);
    canvas.width = f.w; canvas.height = f.h;
    const ctx = canvas.getContext('2d');
    const loaded = await Promise.all(scenes.map(s =>
      s.imageUrl ? animator.loadImage(s.imageUrl) : Promise.resolve({ img: null, clean: true })));
    const items = scenes.map((s, i) => ({
      img: loaded[i].img, clean: loaded[i].clean, bg: sceneBg(i), durMs: 3000,
      motion: s.motion || 'kenburns', text: sceneText(s, i === scenes.length - 1)
    }));
    const timeline = animator.buildTimeline(items);
    let raf, stopped = false; const start = performance.now();
    function loop(now) {
      if (stopped) return;
      animator.draw(ctx, timeline, (now - start) % timeline.totalMs, format);
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }

  return { build, preview, sceneScript, doneScenes, adScenes };
})();
