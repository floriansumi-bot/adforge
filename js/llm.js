/* AdForge — LLM client. FREE, multi-provider, KEYLESS by default.
   One chat() entry point used by every agent. It tries free providers in order:
     1) Pollinations  — keyless, OpenAI-compatible, CORS-enabled (works for everyone)
     2) Gemini        — free tier, only if a Gemini key/proxy is configured
   Z.ai/GLM has been removed (its free tier was unreliable/unavailable). */
window.AF = window.AF || {};

AF.llm = (function () {
  const { config, settings } = AF;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const backoff = (attempt) => Math.round((900 * Math.pow(1.7, attempt)) + Math.random() * 500);

  function activeBrain() {
    if (settings.usingProxy()) return 'Free AI · Pollinations + Gemini (proxy)';
    const s = settings.get();
    const hasG = s.geminiKey && s.geminiKey.trim();
    return 'Pollinations (free)' + (hasG ? '  (+Gemini)' : '');
  }

  /* ---- Provider 0: serverless proxy /text (FREE, KEYLESS for visitors) -----
     The proxy runs the Pollinations→Gemini fallback SERVER-side, where
     Pollinations is keyless and not Turnstile-gated. This is the primary path on
     the deployed (Vercel) site; browsers can't call Pollinations text directly. */
  async function chatProxyText(messages, o) {
    const s = settings.get();
    const url = s.proxyBase.trim().replace(/\/$/, '') + '/text';
    const body = JSON.stringify({ messages, temperature: o.temperature, max_tokens: o.maxTokens });
    let lastErr = 'proxy failed';
    for (let attempt = 0; attempt <= 2; attempt++) {
      if (attempt > 0) { AF.log?.warn('Free AI busy — retrying (' + attempt + '/2)', 'LLM'); await sleep(backoff(attempt)); }
      let res;
      try { res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }); }
      catch (e) { lastErr = 'network error (' + e.message + ')'; continue; }
      if (res.status === 429 || res.status >= 500) { lastErr = 'proxy ' + res.status + ' (busy)'; continue; }
      if (!res.ok) { const b = await res.text().catch(() => ''); throw new Error('proxy ' + res.status + (b ? ' — ' + b.slice(0, 140) : '')); }
      const j = await res.json().catch(() => ({}));
      const text = (j?.content || j?.choices?.[0]?.message?.content || '').trim();
      if (text) return text;
      lastErr = 'proxy empty reply';
    }
    throw new Error(lastErr);
  }

  /* ---- Provider 1: Pollinations (FREE, KEYLESS) ----------------------------
     OpenAI-compatible chat endpoint. No key, CORS '*'. Retries on busy/empty. */
  async function chatPollinations(messages, o) {
    const body = JSON.stringify({
      model: config.POLLINATIONS_TEXT_MODEL || 'openai',
      messages,
      temperature: o.temperature,
      seed: Math.floor(Math.random() * 1e6),
      referrer: 'adforge',
    });
    let lastErr = 'Pollinations failed';
    for (let attempt = 0; attempt <= 3; attempt++) {
      if (attempt > 0) {
        AF.log?.warn('Pollinations busy — retrying in ' + Math.round(backoff(attempt) / 1000) + 's (' + attempt + '/3)', 'LLM');
        await sleep(backoff(attempt));
      }
      let res;
      try {
        res = await fetch(config.POLLINATIONS_TEXT_ENDPOINT, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        });
      } catch (e) { lastErr = 'network error (' + e.message + ')'; continue; }
      if (res.status === 429 || res.status >= 500) { lastErr = 'Pollinations ' + res.status + ' (busy)'; continue; }
      // 4xx (e.g. 403 Turnstile from a browser origin) won't fix on retry — fail fast.
      if (!res.ok) { const b = await res.text().catch(() => ''); throw new Error('Pollinations ' + res.status + (b ? ' — ' + b.slice(0, 120) : '')); }
      // Response may be OpenAI-shaped JSON, or (rarely) raw text.
      const raw = await res.text();
      let text = '';
      try {
        const j = JSON.parse(raw);
        text = (j?.choices?.[0]?.message?.content || j?.choices?.[0]?.text || '').trim();
      } catch { text = raw.trim(); }
      if (text) return text;
      lastErr = 'Pollinations empty reply';
    }
    throw new Error(lastErr);
  }

  /* ---- Provider 2: Google Gemini (FREE tier, optional) ---------------------
     Via the serverless /gemini proxy when configured (so public visitors get it
     with no key), else directly with the personal key from Settings. */
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
      max_tokens: Math.max(o.maxTokens || 1024, 1024),
    });
    let lastErr = 'Gemini request failed';
    for (let attempt = 0; attempt <= 2; attempt++) {
      if (attempt > 0) await sleep(backoff(attempt));
      let res;
      try { res = await fetch(url, { method: 'POST', headers, body }); }
      catch (e) { lastErr = 'network error (' + e.message + ')'; continue; }
      if (res.status === 429 || res.status >= 500) { lastErr = 'Gemini ' + res.status + ' (busy)'; continue; }
      if (!res.ok) { const b = await res.text().catch(() => ''); throw new Error('Gemini ' + res.status + (b ? ' — ' + b.slice(0, 180) : '')); }
      const j = await res.json().catch(() => ({}));
      const text = (j?.choices?.[0]?.message?.content || '').trim();
      if (text) return text;
      lastErr = 'Gemini empty reply';
    }
    throw new Error(lastErr);
  }

  /* messages: [{role, content}]. Tries each free provider in order. */
  async function chat(messages, opts = {}) {
    const o = Object.assign({ temperature: 0.8, maxTokens: 1400 }, opts);
    const s = settings.get();
    const providers = [];
    // Primary on a serverless host: the proxy (keyless Pollinations + Gemini, server-side).
    if (settings.usingProxy()) providers.push({ name: 'proxy', fn: () => chatProxyText(messages, o) });
    // Direct personal Gemini key (local / GitHub Pages without a proxy).
    if (!settings.usingProxy() && s.geminiKey && s.geminiKey.trim()) providers.push({ name: 'Gemini', fn: () => chatGemini(messages, o) });
    // Direct Pollinations — works server-side / if Turnstile is ever lifted; harmless last resort.
    providers.push({ name: 'Pollinations', fn: () => chatPollinations(messages, o) });

    let lastErr = null;
    for (let i = 0; i < providers.length; i++) {
      const p = providers[i];
      try { return await p.fn(); }
      catch (e) {
        lastErr = e;
        const next = providers[i + 1];
        AF.log?.warn(p.name + ' failed (' + e.message + ')' + (next ? ' — falling back to ' + next.name : ''), 'LLM');
      }
    }
    throw new Error('Free AI is busy right now (' + (lastErr ? lastErr.message : 'unknown') + '). Wait ~20s and try again.');
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
