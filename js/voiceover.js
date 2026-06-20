/* AdForge — voiceover.
   Primary: Kokoro-82M (open-source, Apache-2.0) running 100% in the browser via
   kokoro-js (Transformers.js / ONNX, WebGPU with WASM fallback). ~86MB model
   downloaded once on first use, then cached — no key, no server, no special headers.
   Its WAV output is decodable, so it can be MUXED into the downloadable video.
   Fallback: the browser's built-in Web Speech API — instant, many languages
   (incl. FR/DE/IT), but cannot be embedded into the exported file. */
window.AF = window.AF || {};

AF.voiceover = (function () {
  const KOKORO_CDN = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';
  const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

  // A curated set of the higher-graded English voices (README grades A-/B+).
  const KOKORO_VOICES = [
    { id: 'af_heart', label: 'Heart — US female, warm' },
    { id: 'af_bella', label: 'Bella — US female, bright' },
    { id: 'af_nicole', label: 'Nicole — US female, soft' },
    { id: 'am_michael', label: 'Michael — US male' },
    { id: 'am_adam', label: 'Adam — US male, deep' },
    { id: 'bf_emma', label: 'Emma — UK female' },
    { id: 'bm_george', label: 'George — UK male' }
  ];

  let kokoro = null;        // the loaded KokoroTTS instance
  let loadingPromise = null;

  function kokoroSupported() { return true; } // works via WASM everywhere; WebGPU is a bonus

  /* Lazy-load the model. onProgress(0..1) drives a loading bar. */
  function loadKokoro(onProgress) {
    if (kokoro) return Promise.resolve(kokoro);
    if (loadingPromise) return loadingPromise;
    // IMPORTANT: force WASM. Kokoro's WebGPU backend produces garbled / gibberish
    // audio on many GPUs (known kokoro-js / ONNX-Runtime-WebGPU issue). WASM is a
    // touch slower but reliably correct, which is what matters for a voiceover.
    const device = 'wasm';
    loadingPromise = (async () => {
      const mod = await import(/* @vite-ignore */ KOKORO_CDN);
      const KokoroTTS = mod.KokoroTTS;
      const tts = await KokoroTTS.from_pretrained(KOKORO_MODEL, {
        dtype: 'q8',
        device,
        progress_callback: (p) => {
          // transformers.js reports {status, progress, loaded, total}
          if (onProgress && p && typeof p.progress === 'number') onProgress(p.progress / 100);
        }
      });
      kokoro = tts;
      AF.log?.agent?.('Voice', 'Kokoro voice model ready (' + device + ')');
      return tts;
    })();
    loadingPromise.catch(() => { loadingPromise = null; });
    return loadingPromise;
  }

  /* Synthesize text → WAV Blob (24kHz). Loads the model if needed. */
  async function synthKokoro(text, voiceId, onProgress) {
    const tts = await loadKokoro(onProgress);
    const audio = await tts.generate(String(text).slice(0, 800), { voice: voiceId || 'af_heart' });
    return audio.toBlob(); // WAV blob
  }

  /* ---- Web Speech fallback (cannot be embedded into the exported video) ---- */
  function webSpeechReady() { return typeof window.speechSynthesis !== 'undefined'; }
  function webSpeechVoices(lang) {
    if (!webSpeechReady()) return [];
    const all = window.speechSynthesis.getVoices() || [];
    if (!lang || lang === 'auto') return all;
    return all.filter(v => v.lang && v.lang.toLowerCase().startsWith(lang.toLowerCase().slice(0, 2)));
  }
  function speakWebSpeech(text, { voiceURI, lang } = {}) {
    return new Promise((resolve) => {
      if (!webSpeechReady()) return resolve();
      const u = new SpeechSynthesisUtterance(String(text));
      if (lang) u.lang = lang;
      const v = webSpeechVoices(lang).find(x => x.voiceURI === voiceURI);
      if (v) u.voice = v;
      u.onend = u.onerror = () => resolve();
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    });
  }

  return {
    KOKORO_VOICES, kokoroSupported, loadKokoro, synthKokoro, isKokoroReady: () => !!kokoro,
    webSpeechReady, webSpeechVoices, speakWebSpeech
  };
})();
