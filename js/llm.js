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
    if (!settings.configured()) return 'Not configured';
    return (settings.usingProxy() ? 'proxy · ' : 'GLM · ') + settings.get().glmModel;
  }

  function chatTarget() {
    const s = settings.get();
    return settings.usingProxy()
      ? { url: s.proxyBase.trim().replace(/\/$/, '') + '/glm', auth: false }
      : { url: config.CHAT_ENDPOINT, auth: true };
  }

  /* messages: [{role, content}]. Returns assistant text. */
  async function chat(messages, opts = {}) {
    const o = Object.assign({ temperature: 0.8, maxTokens: 1400 }, opts);
    const s = settings.get();
    if (!settings.configured()) {
      throw new Error('No Z.ai key set — open ⚙ Settings and add your free key.');
    }
    const t = chatTarget();
    const headers = { 'Content-Type': 'application/json' };
    if (t.auth) headers['Authorization'] = 'Bearer ' + s.zaiKey.trim();
    const body = JSON.stringify({
      model: s.glmModel || 'glm-4.7-flash',
      messages,
      temperature: o.temperature,
      // GLM-4.6/4.7 default to "thinking" ON; the hidden reasoning eats the
      // token budget and returns empty content. Disable it for these direct
      // JSON/text tasks, and keep a comfortable token floor so nothing truncates.
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
      try {
        res = await fetch(t.url, { method: 'POST', headers, body });
      } catch (e) { lastErr = 'network error (' + e.message + ')'; continue; } // transient → retry

      if (res.status === 429 || res.status >= 500) { lastErr = 'GLM ' + res.status + ' (busy)'; continue; }
      if (!res.ok) {
        const b = await res.text().catch(() => '');
        throw new Error('GLM ' + res.status + (b ? ' — ' + b.slice(0, 180) : ''));
      }

      const j = await res.json().catch(() => ({}));
      // Z.ai sometimes returns 200 with an error code in the body (e.g. 1305 overload).
      if (j && j.error) {
        const code = String(j.error.code || '');
        if (RETRY_CODES.has(code)) { lastErr = 'GLM busy (' + code + ')'; continue; }
        throw new Error('GLM error ' + code + (j.error.message ? ' — ' + j.error.message : ''));
      }
      const choice = j?.choices?.[0];
      let text = (choice?.message?.content || '').trim();
      if (!text) text = (choice?.message?.reasoning_content || '').trim(); // fallback
      if (text) return text;
      // Empty reply is usually transient overload — retry, then give up.
      lastErr = 'empty reply' + (choice?.finish_reason ? ' (finish_reason=' + choice.finish_reason + ')' : '');
    }
    throw new Error(lastErr + ' — the free model is busy. Wait ~30s and try again, or switch the Agent model in Settings.');
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
