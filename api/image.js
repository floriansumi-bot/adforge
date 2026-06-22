/* Vercel serverless IMAGE proxy — FREE, keyless for visitors.
   Browsers can no longer call Pollinations' image endpoint directly: it Cloudflare-
   Turnstile-gates browser-origin requests (→ 403 "Missing Turnstile token"). A SERVER
   request isn't gated, so the browser points <img src="/api/image?..."> here and we
   fetch the pixels server-side and stream them back. Bonus: the image is then served
   same-origin, so the canvas stays CORS-clean for the in-browser video recorder.

   Query: prompt (required), width, height, seed, model (optional hint). */

// FLUX on the free tier can take ~45s when busy, so allow headroom. (Default is 10s
// on Vercel; without this a slow render would 504.) We do ONE upstream fetch per
// call — the browser client cycles models + backs off across its own retries, so the
// proxy stays fast and bounded instead of trying every model in one invocation.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const q = req.query || {};
  const prompt = String(q.prompt || '').slice(0, 1800).trim();
  if (!prompt) { res.status(400).json({ error: 'prompt required' }); return; }

  const width  = clampInt(q.width, 1024, 256, 1536);
  const height = clampInt(q.height, 1024, 256, 1536);
  const seed   = clampInt(q.seed, Math.floor(Math.random() * 1e9), 0, 2147483647);
  const model  = pickModel(q.model);

  const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) +
    `?width=${width}&height=${height}&nologo=true&nofeed=true&model=${model}&seed=${seed}&referrer=adforge`;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 55000);
    let r;
    try { r = await fetch(url, { headers: { 'Referer': 'https://adforge.app/' }, signal: ctl.signal }); }
    finally { clearTimeout(timer); }

    const ct = r.headers.get('content-type') || '';
    if (r.ok && ct.startsWith('image/')) {
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader('Content-Type', ct);
      // Cache hard: same prompt+seed is deterministic, so the CDN can serve it.
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(200).send(buf);
      return;
    }
    // Pass the upstream status through (429 = rate-limited) so the client can back off.
    res.status(r.status === 429 ? 429 : 502).json({ error: 'upstream ' + r.status, model });
  } catch (e) {
    res.status(504).json({ error: String(e.message || e), model });
  }
}

// Only allow models we know work server-side; default to FLUX (best quality).
function pickModel(hint) {
  const h = String(hint || '').toLowerCase();
  return (h === 'sana' || h === 'flux') ? h : 'flux';
}

function clampInt(v, dflt, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}
