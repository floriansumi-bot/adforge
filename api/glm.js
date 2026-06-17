/* Optional Vercel serverless proxy — GLM chat (Z.ai).
   Lets a public demo run without exposing the key in the browser.

   Deploy: put this repo on Vercel, add an env var ZAI_API_KEY = your free z.ai key,
   then in AdForge → Settings set "Proxy base" to /api. Chat goes through here.

   On GitHub Pages this file is simply ignored (no serverless runtime there). */
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const key = process.env.ZAI_API_KEY;
  if (!key) { res.status(500).json({ error: 'ZAI_API_KEY not set on the server' }); return; }
  try {
    const upstream = await fetch('https://api.z.ai/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(req.body)
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'Upstream GLM call failed', detail: String(e) });
  }
}
