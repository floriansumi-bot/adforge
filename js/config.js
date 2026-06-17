/* AdForge — global config, constants & settings store.
   Loaded first. Everything attaches to the window.AF namespace so the app
   works as plain <script> tags (no build step, deployable to GitHub Pages).

   Both the agent brains (GLM) and the image generator (CogView-3-Flash) run on
   ONE free Z.ai key — see https://z.ai (the *-flash models are free). The browser
   can call Z.ai directly (CORS is allowed); an optional serverless proxy can hold
   the key server-side so public visitors never need their own. */
window.AF = window.AF || {};

AF.config = {
  // ---- Z.ai (Zhipu) — one key powers text + images ----
  CHAT_ENDPOINT: 'https://api.z.ai/api/paas/v4/chat/completions',
  IMAGE_ENDPOINT: 'https://api.z.ai/api/paas/v4/images/generations',
  GLM_MODELS: ['glm-4.7-flash', 'glm-4.5-flash', 'glm-4.6', 'glm-5.1'], // *-flash are free
  IMAGE_MODELS: ['cogview-3-flash', 'cogview-4'],                       // cogview-3-flash is free

  // ---- Optional Gemini fallback (separate free tier; rescues the TEXT agents
  //      when Z.ai's free GLM is overloaded). OpenAI-compatible endpoint, CORS-ok. ----
  GEMINI_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  GEMINI_MODELS: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.0-flash-lite'], // free tier

  // ---- Generation defaults ----
  DEFAULT_SCENES: 4,
  MAX_SCENES: 8,
  IMG_SIZE: '1024x1024',
  IMG_CONCURRENCY: 2, // how many scenes render at once (free tier is rate-limited)

  EXAMPLES: [
    'A small-batch oat-milk brand for busy city mornings',
    'Noise-cancelling headphones for focus-craving remote workers',
    'A weekend hiking-boot launch aimed at first-time trekkers',
    'An eco-friendly refillable cleaning spray, premium but playful',
    'A late-night ramen spot targeting students on a budget'
  ]
};

/* ---- Settings store (persisted in localStorage; key never committed) ---- */
AF.settings = (function () {
  const KEY = 'adforge.settings.v2';

  // On a serverless host (Vercel) the bundled /api proxy holds the key server-side,
  // so public visitors need NO key of their own. Locally, on file://, or on GitHub
  // Pages there is no proxy, so we fall back to a personal key entered in Settings.
  function defaultProxyBase() {
    try {
      const h = (location.hostname || '').toLowerCase();
      const isLocal = !h || h === 'localhost' || h === '127.0.0.1' || location.protocol === 'file:';
      if (isLocal || h.endsWith('github.io')) return '';
      return '/api';
    } catch (_) { return ''; }
  }

  const defaults = {
    zaiKey: '',              // free Z.ai API key (powers GLM + CogView)
    glmModel: 'glm-4.7-flash',
    imageModel: 'cogview-3-flash',
    proxyBase: defaultProxyBase(), // '/api' on a serverless host -> keyless for visitors
    renderUrl: '',           // optional HyperFrames render service base URL
    geminiKey: '',           // optional Google Gemini key — TEXT fallback when GLM is busy
    geminiModel: 'gemini-2.0-flash'
  };
  let cache = null;

  function get() {
    if (cache) return cache;
    try { cache = Object.assign({}, defaults, JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch { cache = Object.assign({}, defaults); }
    return cache;
  }
  function set(patch) {
    cache = Object.assign(get(), patch);
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
    return cache;
  }
  // True when we have a way to reach Z.ai: a direct key, or a proxy that holds one.
  function configured() {
    const s = get();
    return !!((s.zaiKey && s.zaiKey.trim()) || (s.proxyBase && s.proxyBase.trim()));
  }
  function usingProxy() {
    const s = get();
    return !!(s.proxyBase && s.proxyBase.trim());
  }
  function hasRenderService() {
    const s = get();
    return !!(s.renderUrl && s.renderUrl.trim());
  }
  // A Gemini TEXT fallback is available (not for images) via a personal key OR via
  // the serverless /gemini proxy (set GEMINI_API_KEY on the host to enable it for
  // public visitors). The proxy returns a clear error if the server key is missing.
  function hasGemini() {
    const s = get();
    return !!((s.geminiKey && s.geminiKey.trim()) || (s.proxyBase && s.proxyBase.trim()));
  }
  return { get, set, configured, usingProxy, hasRenderService, hasGemini };
})();
