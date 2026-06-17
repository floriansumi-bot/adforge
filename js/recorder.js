/* AdForge — recorder.
   Combines a canvas video track (captureStream) with a scheduled voiceover audio
   track (AudioContext destination) into one MediaStream and records it to a
   downloadable Blob via MediaRecorder. Works on GitHub Pages with no special headers.
   Records in wall-clock real time, so the calling tab must stay foregrounded. */
window.AF = window.AF || {};

AF.recorder = (function () {
  // Prefer a universally-shareable MP4 (Chrome 126+/Safari); fall back to WebM.
  const MIME_CANDIDATES = [
    { type: 'video/mp4;codecs=h264,aac', ext: 'mp4' },
    { type: 'video/mp4', ext: 'mp4' },
    { type: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { type: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { type: 'video/webm', ext: 'webm' }
  ];
  function pickMime() {
    const ok = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported;
    for (const c of MIME_CANDIDATES) { if (ok && MediaRecorder.isTypeSupported(c.type)) return c; }
    return { type: '', ext: 'webm' };
  }
  function supported() {
    return typeof MediaRecorder !== 'undefined' &&
           typeof HTMLCanvasElement !== 'undefined' &&
           !!HTMLCanvasElement.prototype.captureStream;
  }

  /* opts: { canvas, fps, totalMs, audioBuffers:[{buffer,startMs}], render(tMs), onProgress(0..1) }
     Returns { blob, url, mime, ext, durationMs }. */
  async function record(opts) {
    if (!supported()) throw new Error('This browser cannot record canvas video (no MediaRecorder/captureStream).');
    const fps = opts.fps || 30;
    const canvas = opts.canvas;
    const videoStream = canvas.captureStream(fps);
    const tracks = [...videoStream.getVideoTracks()];

    // Build + schedule the audio track.
    let ac = null;
    if (opts.audioBuffers && opts.audioBuffers.length) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      // Resume without blocking — under the Build-button gesture this starts immediately;
      // awaiting it would hang forever if the autoplay policy keeps the context suspended.
      try { ac.resume(); } catch {}
      const dest = ac.createMediaStreamDestination();
      const t0 = ac.currentTime + 0.12; // small lead-in
      for (const a of opts.audioBuffers) {
        if (!a.buffer) continue;
        const src = ac.createBufferSource();
        src.buffer = a.buffer;
        src.connect(dest);
        src.start(t0 + (a.startMs || 0) / 1000);
      }
      tracks.push(...dest.stream.getAudioTracks());
    }

    const stream = new MediaStream(tracks);
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime.type ? { mimeType: mime.type, videoBitsPerSecond: 6_000_000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    const done = new Promise((resolve) => { rec.onstop = () => resolve(); });
    rec.start(100);

    // Drive the animation in real time off the wall clock. setTimeout (not
    // requestAnimationFrame) so a backgrounded tab throttles but never fully
    // freezes — rAF pauses entirely when hidden and would hang the render.
    const startedAt = performance.now();
    const frameMs = 1000 / fps;
    await new Promise((resolve) => {
      function tick() {
        const t = performance.now() - startedAt;
        try { opts.render(Math.min(t, opts.totalMs)); } catch (e) { /* keep recording */ }
        if (opts.onProgress) opts.onProgress(Math.min(1, t / opts.totalMs));
        if (t >= opts.totalMs) return resolve();
        setTimeout(tick, frameMs);
      }
      tick();
    });

    // Let the last frame/audio flush, then stop.
    await new Promise(r => setTimeout(r, 180));
    rec.stop();
    await done;
    try { tracks.forEach(t => t.stop()); } catch {}
    if (ac) { try { await ac.close(); } catch {} }

    const blob = new Blob(chunks, { type: mime.type || 'video/webm' });
    return { blob, url: URL.createObjectURL(blob), mime: mime.type || 'video/webm', ext: mime.ext, durationMs: opts.totalMs };
  }

  return { supported, pickMime, record };
})();
