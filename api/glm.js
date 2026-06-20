/* Vercel serverless proxy — GLM chat (Z.ai). Holds the key server-side so the
   public demo needs none. Set ZAI_API_KEY in Vercel env. Ignored on GitHub Pages. */
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const key = (process.env.ZAI_API_KEY || '').trim();
  // 400 (not 500) so the client treats these as clear config errors, not "busy".
  if (!key) { res.status(400).json({ error: 'ZAI_API_KEY not set on the server — add it in Vercel → Settings → Environment Variables, then redeploy.' }); return; }
  if (!/^[\x21-\x7E]+$/.test(key)) { res.status(400).json({ error: 'ZAI_API_KEY contains an invalid character (e.g. a bullet or space) — delete it in Vercel and re-paste the raw key from z.ai, then redeploy.' }); return; }
  try {
    const upstream = await fetch('https://api.z.ai/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(req.body || {})
    });
    // Forward the upstream's REAL status + body (so 429/503 "busy" passes through and
    // the client retries correctly). Wrap non-JSON gateway errors instead of crashing.
    const text = await upstream.text();
    res.status(upstream.status).setHeader('Content-Type', 'application/json');
    try { JSON.parse(text); res.send(text); }
    catch { res.send(JSON.stringify({ error: 'upstream non-JSON (Z.ai busy?)', status: upstream.status, body: text.slice(0, 300) })); }
  } catch (e) {
    res.status(502).json({ error: 'Upstream GLM call failed', detail: String(e) });
  }
}
