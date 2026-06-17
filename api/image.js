/* Optional Vercel serverless proxy — CogView image generation (Z.ai).
   Pairs with api/glm.js. Set "Proxy base" to /api in AdForge Settings and
   add the ZAI_API_KEY env var on Vercel. Ignored on GitHub Pages. */
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const key = process.env.ZAI_API_KEY;
  if (!key) { res.status(500).json({ error: 'ZAI_API_KEY not set on the server' }); return; }
  try {
    const upstream = await fetch('https://api.z.ai/api/paas/v4/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(req.body)
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'Upstream image call failed', detail: String(e) });
  }
}
