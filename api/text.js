/* Vercel serverless TEXT proxy — FREE, multi-provider, keyless for visitors.
   Browsers can't call Pollinations' text endpoint directly (it Cloudflare-
   Turnstile-gates browser-origin requests → 403), but a SERVER request isn't
   gated. So the browser calls this same-origin proxy, and we try free providers
   server-side in order:
     1) Pollinations (keyless)          — works for everyone, no key
     2) Google Gemini (free tier)       — only if GEMINI_API_KEY is set
   Returns { content, provider }. (Z.ai/GLM removed — its free tier was unreliable.) */
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const messages = body.messages;
  const temperature = typeof body.temperature === 'number' ? body.temperature : 0.8;
  const max_tokens = Math.max(body.max_tokens || body.maxTokens || 1024, 1024);
  if (!Array.isArray(messages) || !messages.length) { res.status(400).json({ error: 'messages[] required' }); return; }

  const errors = [];

  // ---- 1) Pollinations (free, keyless) ----
  try {
    const r = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai', messages, temperature, referrer: 'adforge', seed: Math.floor(Math.random() * 1e6) }),
    });
    if (r.ok) {
      const raw = await r.text();
      let text = '';
      try { const j = JSON.parse(raw); text = (j?.choices?.[0]?.message?.content || j?.choices?.[0]?.text || '').trim(); }
      catch { text = raw.trim(); }
      if (text) { res.status(200).json({ content: text, provider: 'pollinations' }); return; }
      errors.push('pollinations: empty');
    } else {
      errors.push('pollinations: ' + r.status);
    }
  } catch (e) { errors.push('pollinations: ' + String(e.message || e)); }

  // ---- 2) Gemini (free tier, only if a server key is set) ----
  const gkey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (gkey && /^[\x21-\x7E]+$/.test(gkey)) {
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + gkey },
        body: JSON.stringify({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash', messages, temperature, max_tokens }),
      });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        const text = (j?.choices?.[0]?.message?.content || '').trim();
        if (text) { res.status(200).json({ content: text, provider: 'gemini' }); return; }
        errors.push('gemini: empty');
      } else {
        const b = await r.text().catch(() => '');
        errors.push('gemini: ' + r.status + (b ? ' ' + b.slice(0, 120) : ''));
      }
    } catch (e) { errors.push('gemini: ' + String(e.message || e)); }
  }

  res.status(502).json({ error: 'All free text providers failed', detail: errors.join(' | ') });
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
