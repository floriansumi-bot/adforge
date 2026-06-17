/* AdForge — LLM client (GLM via Z.ai).
   One chat() entry point used by every agent. Calls Z.ai directly from the
   browser (CORS is allowed) or, when a proxy base is configured, through a
   serverless proxy that holds the key server-side. */
window.AF = window.AF || {};

AF.llm = (function () {
  const { config, settings } = AF;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // Z.ai's free tier (glm-*-flash) gets globally overloaded (HTTP 429 / body code
  // 1305 "访问量过大"), and an overloaded reply can also come back empty. These are
  // transient, so we retry with exponential backoff + jitter rather than failing.
  const MAX_RETRIES = 4;
  const RETRY_CODES = new Set(['1302', '1305', '429']);
  const backoff = (attempt) => Math.round((1200 * Math.pow(1.8, attempt)) + Math.random() * 600);

  function activeBrain() {
    const hasZ = settings.configured(), hasG = settings.hasGemini();
    if (!hasZ && !hasG) return 'Not configured';
    const primary = hasZ
      ? ((settings.usingProxy() ? 'proxy · ' : 'GLM · ') + settings.get().glmModel)
      : ('Gemini · ' + settings.get().geminiModel);
    return primary + (hasZ && hasG ? '  (+Gemini fallback)' : '');
  }

  function chatTarget() {
    const s = settings.get();
    return settings.usingProxy()
      ? { url: s.proxyBase.trim().replace(/\/$/, '') + '/glm', auth: false }
      : { url: config.CHAT_ENDPOINT, auth: true };
  }

  /* Primary: GLM via Z.ai, with retry/backoff on busy/overload/empty. Throws on exhaustion. */
  async function chatGlm(messages, o) {
    const s = settings.get();
    const t = chatTarget();
    const headers = { 'Content-Type': 'application/json' };
    if (t.auth) headers['Authorization'] = 'Bearer ' + s.zaiKey.trim();
    const body = JSON.stringify({
      model: s.glmModel || 'glm-4.7-flash',
      messages,
      temperature: o.temperature,
      // GLM-4.6/4.7 default to "thinking" ON; the hidden reasoning eats the token
      // budget and returns empty content. Disable it and keep a comfortable floor.
      max_tokens: Math.max(o.maxTokens || 1024, 1024),
      thinking: { type: 'disabled' }
    });
    let lastErr = 'GLM request failed';
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        AF.log?.warn('Z.ai busy — retrying in ' + Math.round(backoff(attempt) / 1000) + 's (' + attempt + '/' + MAX_RETRIES + ')', 'GLM');
        await sleep(backoff(attempt));
      }
      let res;
      try { res = await fetch(t.url, { method: 'POST', headers, body }); }
      catch (e) { lastErr = 'network error (' + e.message + ')'; continue; }
      if (res.status === 429 || res.status >= 500) { lastErr = 'GLM ' + res.status + ' (busy)'; continue; }
      if (!res.ok) { const b = await res.text().catch(() => ''); throw new Error('GLM ' + res.status + (b ? ' — ' + b.slice(0, 180) : '')); }
      const j = await res.json().catch(() => ({}));
      if (j && j.error) {
        const code = String(j.error.code || '');
        if (RETRY_CODES.has(code)) { lastErr = 'GLM busy (' + code + ')'; continue; }
        throw new Error('GLM error ' + code + (j.error.message ? ' — ' + j.error.message : ''));
      }
      const choice = j?.choices?.[0];
      let text = (choice?.message?.content || '').trim();
      if (!text) text = (choice?.message?.reasoning_content || '').trim();
      if (text) return text;
      lastErr = 'empty reply' + (choice?.finish_reason ? ' (finish_reason=' + choice.finish_reason + ')' : '');
    }
    throw new Error(lastErr);
  }

  /* Fallback: Google Gemini (separate free tier), OpenAI-compatible endpoint.
     Goes through the serverless /gemini proxy when one is configured (so the
     public demo gets the fallback with no key of its own), else calls Gemini
     directly with the personal key from Settings. */
  async function chatGemini(messages, o) {
    const s = settings.get();
    const useProxy = settings.usingProxy();
    const url = useProxy ? (s.proxyBase.trim().replace(/\/$/, '') + '/gemini') : config.GEMINI_ENDPOINT;
    const headers = { 'Content-Type': 'application/json' };
    if (!useProxy) headers['Authorization'] = 'Bearer ' + s.geminiKey.trim();
    const body = JSON.stringify({
      model: s.geminiModel || 'gemini-2.0-flash',
      messages,
      temperature: o.temperature,
      max_tokens: Math.max(o.maxTokens || 1024, 1024)
    });
    let lastErr = 'Gemini request failed';
    for (let attempt = 0; attempt <= 2; attempt++) {
      if (attempt > 0) await sleep(backoff(attempt));
      let res;
      try {
        res = await fetch(url, { method: 'POST', headers, body });
      } catch (e) { lastErr = 'network error (' + e.message + ')'; continue; }
      if (res.status === 429 || res.status >= 500) { lastErr = 'Gemini ' + res.status + ' (busy)'; continue; }
      if (!res.ok) { const b = await res.text().catch(() => ''); throw new Error('Gemini ' + res.status + (b ? ' — ' + b.slice(0, 180) : '')); }
      const j = await res.json().catch(() => ({}));
      const text = (j?.choices?.[0]?.message?.content || '').trim();
      if (text) return text;
      lastErr = 'Gemini empty reply';
    }
    throw new Error(lastErr);
  }

  /* messages: [{role, content}]. Tries GLM (Z.ai), falls back to Gemini if configured. */
  async function chat(messages, opts = {}) {
    const o = Object.assign({ temperature: 0.8, maxTokens: 1400 }, opts);
    const hasZ = settings.configured(), hasG = settings.hasGemini();
    if (!hasZ && !hasG) {
      throw new Error('No model key set — open ⚙ Settings and add your free Z.ai key (optionally a Gemini fallback key).');
    }
    if (hasZ) {
      try { return await chatGlm(messages, o); }
      catch (e) {
        if (!hasG) throw new Error(e.message + ' — the free model is busy. Wait ~30s and try again, switch the Agent model, or add a Gemini fallback key in Settings.');
        AF.log?.warn('GLM failed (' + e.message + ') — falling back to Gemini ' + (settings.get().geminiModel || 'gemini-2.0-flash'), 'LLM');
      }
    }
    try { return await chatGemini(messages, o); }
    catch (e) { throw new Error('Both providers failed — ' + e.message + '. Try again shortly.'); }
  }

  /* Robustly pull a JSON object/array out of a model reply, even if it
     wrapped it in prose or ```json fences. */
  function extractJson(text) {
    if (!text) throw new Error('Empty model reply');
    let t = String(text).trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    try { return JSON.parse(t); } catch {}
    const start = t.search(/[\[{]/);
    if (start === -1) throw new Error('No JSON found in reply');
    const open = t[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else {
        if (c === '"') inStr = true;
        else if (c === open) depth++;
        else if (c === close) { depth--; if (depth === 0) return JSON.parse(t.slice(start, i + 1)); }
      }
    }
    throw new Error('Unbalanced JSON in reply');
  }

  /* Ask for JSON, parse it, retry once with a stricter nudge if it fails. */
  async function chatJson(messages, opts = {}) {
    const reply = await chat(messages, opts);
    try {
      return extractJson(reply);
    } catch {
      const retry = await chat(
        messages.concat([
          { role: 'assistant', content: reply },
          { role: 'user', content: 'That was not valid JSON. Reply again with ONLY a single valid minified JSON value and nothing else.' }
        ]),
        Object.assign({}, opts, { temperature: 0.2 })
      );
      return extractJson(retry);
    }
  }

  return { chat, chatJson, extractJson, activeBrain };
})();
