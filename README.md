# AdForge — Multi-Agent Ad Studio

A self-contained web app where a **team of five AI agents** turns one line of product brief into a finished ad concept: a **creative brief**, **ad copy**, a set of **editable visual scenes**, and a downloadable **animated video ad with an AI voiceover** — all generated in the browser.

> One idea in → strategy, copy, a grid of on-brand visuals, and a voiced video ad out. Edit the master prompt to regenerate everything, edit any single scene to regenerate just that image, then animate the scenes into a video.

## Why it's a good portfolio piece

- **Multi-agent architecture** — a real pipeline of specialised agents with a refinement loop, not a single prompt.
- **Iterative & editable** — edit the master prompt (regenerates all scenes) or any one scene's prompt (regenerates that image); rewrite copy or apply the critic's fix per scene.
- **One free key, whole pipeline** — text *and* images run on a single free Z.ai key.
- **No backend, no build step** — plain HTML/CSS/JS; deploys to GitHub Pages as-is. An optional 2-file Vercel proxy makes a public, no-key-required demo.

## The agent team

| # | Agent | Job |
|---|-------|-----|
| 1 | **Strategist** | Idea → creative brief (angle, audience, key message, tone, mood, palette) |
| 2 | **Prompt Engineer** | Brief → strong master image prompt; powers the *Improve prompt* button |
| 3 | **Art Director** | Splits the campaign into N distinct scenes (hero, lifestyle, detail, CTA…) |
| 4 | **Copywriter** | Headline, subhead, body, CTA and a social caption per scene |
| 5 | **Critic** *(loop)* | Scores each scene vs. the brief and proposes one concrete fix to apply in a click |

## The stack (all free)

Everything runs on one free **[Z.ai](https://z.ai)** (Zhipu) key:

- **Agent brains** — **GLM-4.7-Flash** / GLM-5.1 (the `*-flash` models are free, MIT-licensed open weights).
- **Images** — **CogView-3-Flash** (free) via Z.ai's OpenAI-style image endpoint.

The browser calls Z.ai directly (CORS is allowed), so no server is needed for your own use.

## Animated video ads + AI voiceover

Once scenes are generated, the **🎬 Video ad** panel turns them into a downloadable video — entirely in the browser, no server, no GPU:

- **Animation** — each scene is drawn to a `<canvas>` with Ken Burns pan/zoom, crossfades and animated copy overlays (per-scene motion is selectable: Ken Burns / zoom / pan / still). The canvas is captured with `MediaRecorder` → an **MP4** (Chrome/Edge/Safari) or **WebM** (Firefox) file. Verified to work on GitHub Pages with **no special headers**.
- **Voiceover** — **Kokoro‑82M** (open-source, Apache‑2.0) runs 100% in the browser via `kokoro-js` (WebGPU, WASM fallback) — the most realistic open-source voice that runs free client-side. ~86 MB model downloads once on first use, then cached. The synthesized audio is muxed straight into the video. **Web Speech API** is offered as an instant, multi-language fallback (preview only — browser voices can't be embedded into the file).
- Formats: **Square 1:1 / Landscape 16:9 / Portrait 9:16**.

> Note: in-browser recording happens in **real time** (a 15 s ad takes 15 s) and the tab must stay foregrounded.

### Cinematic engine — HyperFrames (optional server)
For **frame-accurate, deterministic** video (no real-time/foreground limitation, smoother GSAP motion), AdForge can offload rendering to **[HeyGen HyperFrames](https://github.com/heygen-com/hyperframes)** (Apache‑2.0). HyperFrames renders HTML+GSAP compositions by seeking headless Chrome frame-by-frame and encoding with FFmpeg — which needs a server, so it can't run on GitHub Pages itself.

The companion **`adforge-render`** service (a small Dockerized Node app — see that folder's README) hosts it in a few clicks on Railway/Render. Then in AdForge → **⚙ Settings**, paste the service URL into *HyperFrames render service*, and pick **"HyperFrames (server) — cinematic"** in the Video panel. AdForge builds the GSAP composition (`js/hyperframes-template.js`), POSTs it (`js/hyperframes-client.js`, images inlined to keep rendering deterministic), and gets back an MP4. This engine is **silent** in v1 (voiceover stays on the in-browser engines). The in-browser recorder remains the default no-server fallback.

### Optional future upgrade — real AI motion
The same Z.ai family has **CogVideoX** (true image-to-video). It's **not free** (`cogvideox-3` ≈ $0.20/video on your key; the free `cogvideox-flash` needs a second free [BigModel](https://open.bigmodel.cn) account and a serverless proxy to hide the key). Not wired into the free default — a clearly-flagged optional path.

> ℹ️ AdForge originally used Pollinations.ai for keyless images/text, but in 2026 Pollinations put both endpoints behind a bot-check (token required), so a truly zero-key demo is no longer possible there. Consolidating on one free Z.ai key is simpler and more reliable — and it's the "GLM as a free LLM" idea taken to its logical end.

## Get your free key (30 seconds)

1. Sign up at **[z.ai](https://z.ai)** and create an API key (GLM-4.7-Flash and CogView-3-Flash are free).
2. Open AdForge → **⚙ Settings**, paste the key, **Save**. It's stored only in your browser and sent only to Z.ai.

## Run it locally

`fetch` needs `http://` (not `file://`), so serve the folder:

```bash
# from the ad-forge directory:
python -m http.server 8000
# or: npx serve .
```

Then open <http://localhost:8000>.

## Deploy

### Option A — GitHub Pages (simplest)

1. Push this folder to a repo.
2. **Settings → Pages → Build from branch → `main` / root**.
3. Live at `https://<you>.github.io/<repo>/`. Link it from your CV.

Each visitor adds their own free Z.ai key in Settings (Pages can't keep a key secret).

### Option B — Vercel (public demo, no key for visitors)

If you want anyone to try it without their own key:

1. Import the repo on [Vercel](https://vercel.com).
2. Add an env var **`ZAI_API_KEY`** = your free z.ai key.
3. In AdForge → Settings, set **Proxy base** = `/api` and Save.

The included [`api/glm.js`](api/glm.js) and [`api/image.js`](api/image.js) then proxy calls server-side, so the key never reaches the browser. On GitHub Pages these files are simply ignored.

## Project layout

```
index.html              # app shell
css/styles.css          # studio theme
js/config.js            # endpoints, constants, settings store
js/util.js              # event bus, activity log, DOM helpers, concurrency pool
js/llm.js               # GLM chat client + robust JSON parsing
js/images.js            # CogView image generation + download
js/agents.js            # the 5 agents
js/orchestrator.js      # pipeline + refinement loop + state
js/ui.js                # rendering & event wiring
js/export.js            # export campaign as Markdown
js/voiceover.js         # Kokoro-82M in-browser TTS + Web Speech fallback
js/animator.js          # canvas Ken Burns / crossfade / text-overlay renderer
js/recorder.js          # canvas + audio -> MediaRecorder -> MP4/WebM blob
js/hyperframes-template.js # builds the HTML+GSAP composition for HyperFrames
js/hyperframes-client.js   # POSTs the composition to the render service, gets MP4
js/video.js             # builds the animated video ad (scenes + voiceover)
js/app.js               # bootstrap
../adforge-render/      # the optional HyperFrames render service (Docker + Node)
api/glm.js, api/image.js# optional Vercel proxies (key stays server-side)
manifest.webmanifest    # PWA
sw.js                   # offline app-shell cache
```

## Notes & limits

- The free tier is rate-limited, so AdForge renders ~2 scenes at a time; occasional slow or failed renders are expected — just hit **Regenerate**.
- Generated copy/images are AI output; review before any real use, and check brand/IP/licensing for production campaigns.
