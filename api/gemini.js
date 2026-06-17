/* Optional Vercel serverless proxy — Gemini TEXT fallback (Google AI Studio).
   Pairs with api/glm.js: when Z.ai's free GLM is busy, the agents fall back to
   Gemini through here, so public visitors get the fallback without their own key.

   Deploy: add an env var GEMINI_API_KEY = your free Google AI Studio key on Vercel.
   Uses Gemini's OpenAI-compatible endpoint. Ignored on GitHub Pages. */
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) { res.status(500).json({ error: 'GEMINI_API_KEY not set on the server' }); return; }
  try {
    const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(req.body)
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'Upstream Gemini call failed', detail: String(e) });
  }
}
