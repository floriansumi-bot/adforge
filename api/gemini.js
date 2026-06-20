/* Vercel serverless proxy — Gemini TEXT fallback (Google AI Studio), OpenAI-compatible.
   When Z.ai's free GLM is busy, the agents fall back to Gemini through here, so public
   visitors get the fallback without their own key. Set GEMINI_API_KEY in Vercel env. */
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const key = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  // 400 (not 500) so these read as clear config errors, not a fake "busy".
  if (!key) { res.status(400).json({ error: 'GEMINI_API_KEY not set on the server — add it in Vercel → Settings → Environment Variables, then redeploy.' }); return; }
  if (!/^[\x21-\x7E]+$/.test(key)) { res.status(400).json({ error: 'GEMINI_API_KEY contains an invalid character — delete it in Vercel and re-paste the raw key, then redeploy.' }); return; }
  try {
    const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(req.body || {})
    });
    const text = await upstream.text();
    res.status(upstream.status).setHeader('Content-Type', 'application/json');
    try { JSON.parse(text); res.send(text); }
    catch { res.send(JSON.stringify({ error: 'upstream non-JSON', status: upstream.status, body: text.slice(0, 300) })); }
  } catch (e) {
    res.status(502).json({ error: 'Upstream Gemini call failed', detail: String(e) });
  }
}
