/* Vercel serverless proxy — CogView image generation (Z.ai). Pairs with api/glm.js.
   Set ZAI_API_KEY in Vercel env. NOTE: CogView image generation is a PAID Z.ai model;
   without balance it returns an "insufficient balance" error (the text agents are free). */
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const key = (process.env.ZAI_API_KEY || '').trim();
  if (!key) { res.status(400).json({ error: 'ZAI_API_KEY not set on the server — add it in Vercel → Settings → Environment Variables, then redeploy.' }); return; }
  if (!/^[\x21-\x7E]+$/.test(key)) { res.status(400).json({ error: 'ZAI_API_KEY contains an invalid character — delete it in Vercel and re-paste the raw key from z.ai, then redeploy.' }); return; }
  try {
    const upstream = await fetch('https://api.z.ai/api/paas/v4/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(req.body || {})
    });
    const text = await upstream.text();
    res.status(upstream.status).setHeader('Content-Type', 'application/json');
    try { JSON.parse(text); res.send(text); }
    catch { res.send(JSON.stringify({ error: 'upstream non-JSON', status: upstream.status, body: text.slice(0, 300) })); }
  } catch (e) {
    res.status(502).json({ error: 'Upstream image call failed', detail: String(e) });
  }
}
