/* AdForge — UI layer. Renders state from the orchestrator's events and wires
   every control. Kept deliberately framework-free. */
window.AF = window.AF || {};

AF.ui = (function () {
  const { dom, orchestrator, settings, config, exporter, bus, log } = AF;
  const O = orchestrator;

  const STAGES = [
    { key: 'concepts', name: 'Concepts', role: '3 directions' },
    { key: 'strategist', name: 'Strategist', role: 'Creative brief' },
    { key: 'promptEngineer', name: 'Prompt Engineer', role: 'Master prompt' },
    { key: 'artDirector', name: 'Art Director', role: 'Scene breakdown' },
    { key: 'render', name: 'Render + Copy', role: 'Images & copy' },
    { key: 'critic', name: 'Critic', role: 'Score & refine' }
  ];

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(msg) {
    const t = dom.el('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  /* ---------- brain badge ---------- */
  function refreshBadge() {
    const badge = dom.el('brainBadge');
    badge.textContent = settings.hasGemini() ? 'Free AI · +Gemini' : 'Free AI';
    badge.title = 'Text: Pollinations (free, keyless)' + (settings.hasGemini() ? ' + Gemini fallback' : '') + ' · Images: Pollinations (free)';
    badge.classList.add('glm');
  }

  /* ---------- pipeline ---------- */
  function renderPipeline() {
    const wrap = dom.el('pipeline');
    wrap.innerHTML = '';
    STAGES.forEach(s => {
      const node = dom.create('div', { class: 'stage', id: 'stage-' + s.key }, []);
      node.innerHTML =
        '<div><span class="dot"></span><span class="s-name">' + s.name + '</span></div>' +
        '<div class="s-role">' + s.role + '</div>';
      wrap.appendChild(node);
    });
  }
  function setStageUI(name, status) {
    const node = dom.el('stage-' + name);
    if (!node) return;
    node.classList.remove('running', 'done', 'error');
    if (status) node.classList.add(status);
  }

  /* ---------- creative directions (pick one) ---------- */
  function renderConcepts(dirs) {
    const sec = dom.el('conceptsSection');
    const grid = dom.el('conceptsGrid');
    if (!dirs || !dirs.length) { sec.classList.add('hidden'); return; }
    grid.innerHTML = '';
    dirs.forEach((d, i) => {
      const card = dom.create('div', { class: 'concept', 'data-i': String(i), role: 'button', tabindex: '0' }, []);
      const meta = [d.audience && ('🎯 ' + d.audience), d.mood && ('🎨 ' + d.mood)]
        .filter(Boolean).map(x => dom.esc(x)).join('  ·  ');
      card.innerHTML =
        '<div class="concept-head">' +
          '<div class="concept-title">' + dom.esc(d.title || ('Direction ' + (i + 1))) + '</div>' +
          (d.tone ? '<span class="concept-tone">' + dom.esc(d.tone) + '</span>' : '') +
        '</div>' +
        (d.angle ? '<p class="concept-angle">' + dom.esc(d.angle) + '</p>' : '') +
        (d.rationale ? '<p class="concept-why">' + dom.esc(d.rationale) + '</p>' : '') +
        (meta ? '<div class="concept-meta">' + meta + '</div>' : '') +
        '<span class="concept-pick">Build this campaign →</span>';
      grid.appendChild(card);
    });
    sec.classList.remove('hidden');
  }

  async function pickConcept(i) {
    const dirs = O.state.concepts || [];
    const chosen = dirs[i];
    if (!chosen || O.state.busy) return;
    const cards = dom.qa('.concept', dom.el('conceptsGrid'));
    cards.forEach((c, idx) => {
      c.classList.toggle('chosen', idx === i);
      c.classList.toggle('dimmed', idx !== i);
    });
    await O.generateCampaign(O.state.input, chosen);
  }

  function onConceptsClick(e) {
    const card = e.target.closest('.concept');
    if (!card) return;
    pickConcept(parseInt(card.getAttribute('data-i'), 10));
  }
  function onConceptsKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.concept');
    if (!card) return;
    e.preventDefault();
    pickConcept(parseInt(card.getAttribute('data-i'), 10));
  }

  /* ---------- brief ---------- */
  function renderBrief(state) {
    const sec = dom.el('briefSection');
    if (!state.brief) { sec.classList.add('hidden'); return; }
    sec.classList.remove('hidden');
    const b = state.brief;
    const items = [
      ['Brand', b.brandName], ['Angle', b.angle], ['Audience', b.audience],
      ['Key message', b.keyMessage], ['Tone', b.tone], ['Mood', b.mood], ['Visual style', b.visualStyle]
    ].filter(([, v]) => v);
    let html = items.map(([k, v]) =>
      '<div class="b-item"><div class="b-k">' + dom.esc(k) + '</div><div class="b-v">' + dom.esc(v) + '</div></div>'
    ).join('');
    if (Array.isArray(b.palette) && b.palette.length) {
      html += '<div class="b-item"><div class="b-k">Palette</div><div class="palette">' +
        b.palette.slice(0, 6).map(c => '<span class="swatch" style="background:' + dom.esc(c) + '" title="' + dom.esc(c) + '"></span>').join('') +
        '</div></div>';
    }
    dom.el('brief').innerHTML = html;

    // Keep the master-prompt textarea in sync unless the user is editing it.
    const mp = dom.el('masterPrompt');
    if (document.activeElement !== mp) mp.value = state.masterPrompt || '';

    // Average score pill
    const avg = O.scoreAverage();
    const pill = dom.el('avgScore');
    if (avg != null) { pill.textContent = 'Avg ' + avg + '/100'; pill.style.color = scoreColor(avg); pill.classList.remove('hidden'); }
    else pill.classList.add('hidden');
  }

  function scoreColor(n) { return n >= 75 ? 'var(--good)' : n >= 50 ? 'var(--warn)' : 'var(--bad)'; }

  /* ---------- scenes ---------- */
  function sceneCard(s) {
    const card = dom.create('div', { class: 'scene', id: 'scene-' + s.id }, []);
    patchSceneCard(card, s);
    return card;
  }

  function patchSceneCard(card, s) {
    const imgInner = s.status === 'rendering' || s.status === 'pending'
      ? '<div class="ph"><div class="spinner"></div><span>' + (s.status === 'pending' ? 'queued…' : 'rendering…') + '</span></div>'
      : s.status === 'error'
        ? '<div class="ph"><span>⚠ ' + dom.esc(s.error || 'failed') + '</span></div>'
        : s.imageUrl
          ? '<img src="' + dom.esc(s.imageUrl) + '" alt="' + dom.esc(s.name) + '" loading="lazy" />'
          : '<div class="ph"><span>🎬 ' + dom.esc(s.imageError ? 'Image didn’t generate this time; the video uses an animated background' : 'No image, animated background used in the video') + '</span></div>';
    const scoreBadge = s.critique?.score != null
      ? '<span class="scene-score" style="color:' + scoreColor(s.critique.score) + '">' + s.critique.score + '</span>' : '';
    const c = s.copy || {};
    const copyHtml = s.copy ? (
      '<div class="copy-block">' +
        (c.headline ? '<div class="copy-headline">' + dom.esc(c.headline) + '</div>' : '') +
        (c.subhead ? '<div class="copy-sub">' + dom.esc(c.subhead) + '</div>' : '') +
        (c.body ? '<div class="copy-body">' + dom.esc(c.body) + '</div>' : '') +
        (c.cta ? '<span class="copy-cta">' + dom.esc(c.cta) + '</span>' : '') +
        (c.caption ? '<div class="copy-caption">' + dom.esc(c.caption) + '</div>' : '') +
      '</div>'
    ) : '';
    const critHtml = s.critique?.notes
      ? '<div class="crit-note">🛈 ' + dom.esc(s.critique.notes) +
        (s.critique.improvedPrompt ? ' <button class="ghost-btn" data-act="apply" data-id="' + s.id + '">Apply fix ↻</button>' : '') +
        '</div>'
      : '';

    card.innerHTML =
      '<div class="scene-img">' + imgInner + scoreBadge + '</div>' +
      '<div class="scene-body">' +
        '<div class="scene-name">' + dom.esc(s.name) + '</div>' +
        (s.purpose ? '<div class="scene-purpose">' + dom.esc(s.purpose) + '</div>' : '') +
        copyHtml +
        '<label class="field-label" style="margin-top:4px">Scene prompt</label>' +
        '<textarea class="scene-prompt" data-id="' + s.id + '">' + dom.esc(s.prompt) + '</textarea>' +
        '<div class="scene-motion-row"><span class="field-label" style="margin:0">🎬 Motion</span>' +
          '<select class="scene-motion" data-id="' + s.id + '">' +
            ['kenburns', 'zoom-in', 'zoom-out', 'pan-right', 'pan-left', 'still']
              .map(m => '<option value="' + m + '"' + ((s.motion || 'kenburns') === m ? ' selected' : '') + '>' + m + '</option>').join('') +
          '</select></div>' +
        critHtml +
        '<div class="scene-actions">' +
          '<button class="ghost-btn" data-act="regen" data-id="' + s.id + '">↻ Regenerate</button>' +
          '<button class="ghost-btn" data-act="improve" data-id="' + s.id + '">✦ Improve prompt</button>' +
          '<button class="ghost-btn" data-act="copy" data-id="' + s.id + '">✎ Rewrite copy</button>' +
          '<button class="ghost-btn" data-act="critique" data-id="' + s.id + '">★ Critique</button>' +
          (s.imageUrl ? '<button class="ghost-btn" data-act="download" data-id="' + s.id + '">⤓</button>' : '') +
        '</div>' +
      '</div>';
  }

  function renderScenes(state) {
    const grid = dom.el('scenesGrid');
    grid.innerHTML = '';
    state.scenes.forEach(s => grid.appendChild(sceneCard(s)));
  }
  function updateScene(s) {
    const card = dom.el('scene-' + s.id);
    if (card) patchSceneCard(card, s);
    else renderScenes(O.state);
  }

  /* ---------- scene action handler (event delegation) ---------- */
  async function onScenesClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const act = btn.getAttribute('data-act');
    const promptEl = dom.q('.scene-prompt[data-id="' + id + '"]');
    btn.disabled = true;
    try {
      if (act === 'regen') {
        if (promptEl) await O.updateScenePrompt(id, promptEl.value);
        await O.regenerateScene(id);
      } else if (act === 'improve') {
        if (promptEl) await O.updateScenePrompt(id, promptEl.value);
        await O.improveScenePrompt(id);
        toast('Prompt improved. Hit Regenerate to apply');
      } else if (act === 'copy') {
        await O.rewriteCopy(id); toast('Copy rewritten');
      } else if (act === 'critique') {
        await O.critiqueScene(id);
      } else if (act === 'apply') {
        await O.applyCritique(id); toast('Applied the critic’s fix');
      } else if (act === 'download') {
        const s = O.getScene(id);
        if (s?.imageUrl) AF.images.download(s.imageUrl, (s.name || 'scene').replace(/\W+/g, '-').toLowerCase() + '.png');
      }
    } catch (err) {
      log.error('Action "' + act + '" failed: ' + err.message);
      toast('Something failed. See the activity log');
    } finally { btn.disabled = false; }
  }

  /* ---------- log ---------- */
  function appendLog(e) {
    const box = dom.el('log');
    const line = dom.create('div', { class: 'log-line ' + (e.level === 'warn' ? 'warn' : e.level === 'error' ? 'error' : '') }, []);
    line.innerHTML = '<span class="lt">' + e.t + '</span>' +
      (e.agent ? '<span class="la">' + dom.esc(e.agent) + '</span>' : '') +
      '<span class="lm">' + dom.esc(e.msg) + '</span>';
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  /* ---------- composer ---------- */
  function readInput() {
    return {
      idea: dom.el('idea').value.trim(),
      audience: dom.el('audience').value.trim(),
      tone: dom.el('tone').value.trim(),
      platform: dom.el('platform').value,
      scenes: parseInt(dom.el('scenes').value, 10)
    };
  }

  async function onGenerate() {
    const input = readInput();
    if (!input.idea) { toast('Describe your product or idea first'); dom.el('idea').focus(); return; }
    // No key needed — text runs on free, keyless Pollinations (Gemini optional).
    // Step 0: propose three directions; the campaign builds once the user picks one.
    const dirs = await O.proposeConcepts(input);
    if (dirs && dirs.length) {
      toast('Pick one of the 3 directions to build the campaign');
      dom.el('conceptsSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function setBusy(busy) {
    dom.el('generateBtn').disabled = busy;
    dom.el('generateBtn').textContent = busy ? '⏳ Working…' : '✨ Generate campaign';
    ['improveMasterBtn', 'regenAllBtn'].forEach(id => { dom.el(id).disabled = busy; });
    // While anything is running, lock the direction cards from being re-picked.
    dom.qa('.concept').forEach(c => c.classList.toggle('locked', busy));
  }

  /* ---------- settings modal ---------- */
  function openModal(id) { dom.el(id).classList.remove('hidden'); }
  function closeModal(id) { dom.el(id).classList.add('hidden'); }

  function fillSelect(el, options, value) {
    el.innerHTML = options.map(o => '<option value="' + o + '"' + (o === value ? ' selected' : '') + '>' + o + '</option>').join('');
  }
  function loadSettingsForm() {
    const s = settings.get();
    dom.el('proxyBase').value = s.proxyBase;
    dom.el('renderUrl').value = s.renderUrl;
    dom.el('geminiKey').value = s.geminiKey;
    fillSelect(dom.el('geminiModel'), config.GEMINI_MODELS, s.geminiModel);
  }
  function saveSettingsForm() {
    settings.set({
      proxyBase: dom.el('proxyBase').value.trim(),
      renderUrl: dom.el('renderUrl').value.trim().replace(/\/+$/, ''),
      geminiKey: dom.el('geminiKey').value.trim(),
      geminiModel: dom.el('geminiModel').value
    });
    refreshBadge();
    closeModal('settingsModal');
    toast('Settings saved');
  }

  /* ---------- video ad ---------- */
  let lastVideo = null;     // { blob, url, ext, durationMs }
  let stopPreview = null;
  let videoBusy = false;

  function setVideoProgress(p) {
    const wrap = dom.el('vProgressWrap'), bar = dom.el('vProgressBar');
    if (p == null) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    bar.style.width = Math.round(Math.min(1, Math.max(0, p)) * 100) + '%';
  }
  function vStatus(msg) { dom.el('vStatus').textContent = msg || ''; }

  function populateVoiceSelect() {
    const engine = dom.el('vEngine').value;
    const wrap = dom.el('vVoiceWrap'), sel = dom.el('vVoice'), note = dom.el('vNote');
    if (engine === 'kokoro') {
      wrap.classList.remove('hidden');
      sel.innerHTML = AF.voiceover.KOKORO_VOICES.map(v => '<option value="' + v.id + '">' + dom.esc(v.label) + '</option>').join('');
      note.innerHTML = 'First use of Kokoro downloads a ~86&nbsp;MB voice model once (then cached). Recording happens in real time, so keep this tab in front.';
    } else if (engine === 'webspeech') {
      wrap.classList.remove('hidden');
      const voices = AF.voiceover.webSpeechVoices();
      sel.innerHTML = voices.length
        ? voices.map(v => '<option value="' + dom.esc(v.voiceURI) + '">' + dom.esc(v.name + ' (' + v.lang + ')') + '</option>').join('')
        : '<option value="">(system voices appear on first use)</option>';
      note.textContent = 'Web Speech voices play in the preview but can’t be embedded into the downloaded file. Pick Kokoro for an embedded voice.';
    } else if (engine === 'hyperframes') {
      wrap.classList.add('hidden');
      note.innerHTML = settings.hasRenderService()
        ? 'Cinematic GSAP video rendered on your HyperFrames server (frame-accurate). Silent in this version; voiceover stays on the in-browser engines.'
        : '⚠ No render service set. Add your <strong>HyperFrames render service URL</strong> in ⚙ Settings (see the adforge-render repo to deploy it).';
    } else {
      wrap.classList.add('hidden');
      note.textContent = 'Silent video, rendered instantly in your browser.';
    }
  }

  function updateVideoVisibility(state) {
    // Show the video panel once there are scenes with copy — images are optional
    // (the video renders a brand-palette motion background when a scene has none).
    const any = state.scenes.some(s => s.name || (s.copy && (s.copy.headline || s.copy.subhead)));
    dom.el('videoSection').classList.toggle('hidden', !any);
  }

  async function onPreview() {
    const btn = dom.el('previewBtn');
    if (stopPreview) { stopPreview(); stopPreview = null; btn.textContent = '▶ Preview'; dom.el('videoCanvas').classList.add('hidden'); return; }
    try {
      const canvas = dom.el('videoCanvas'); canvas.classList.remove('hidden');
      dom.el('videoResult').classList.add('hidden');
      stopPreview = await AF.video.preview({ format: dom.el('vFormat').value, canvas });
      btn.textContent = '⏹ Stop preview';
    } catch (e) { toast(e.message || 'Preview failed'); }
  }

  async function onBuildVideo() {
    if (videoBusy) return;
    if (stopPreview) { stopPreview(); stopPreview = null; dom.el('previewBtn').textContent = '▶ Preview'; }
    const engine = dom.el('vEngine').value;
    if (engine === 'hyperframes' && !settings.hasRenderService()) {
      toast('Add your HyperFrames render service URL in Settings first');
      loadSettingsForm(); openModal('settingsModal'); return;
    }
    if (engine === 'webspeech') toast('Web Speech can’t be embedded, so building a silent video. Pick Kokoro for an embedded voice.');
    const useServer = engine === 'hyperframes';
    videoBusy = true;
    const btn = dom.el('buildVideoBtn'); btn.disabled = true; const old = btn.textContent; btn.textContent = '⏳ Building…';
    const canvas = dom.el('videoCanvas'); canvas.classList.toggle('hidden', useServer);
    dom.el('videoResult').classList.add('hidden');
    dom.el('vResultActions').classList.add('hidden');
    setVideoProgress(useServer ? null : 0);
    try {
      let result;
      if (useServer) {
        const scenes = AF.video.adScenes().map(s => Object.assign({}, s, { durMs: s.durMs || 3400 }));
        if (!scenes.length) throw new Error('Generate a campaign first.');
        if (scenes.length > config.MAX_SCENES) throw new Error('Max ' + config.MAX_SCENES + ' scenes for a video.');
        const pal = (O.state.brief && Array.isArray(O.state.brief.palette)) ? O.state.brief.palette : [];
        result = await AF.hyperframesClient.build(scenes,
          { format: dom.el('vFormat').value, fps: 30, quality: 'high',
            brandColor: pal[0] || '#7c5cff', palette: pal, inlineImages: true },
          { onStatus: vStatus });
      } else {
        result = await AF.video.build({
          format: dom.el('vFormat').value,
          voiceEngine: engine === 'kokoro' ? 'kokoro' : 'none',
          voiceId: dom.el('vVoice').value || 'af_heart',
          canvas, onStatus: vStatus, onProgress: setVideoProgress
        });
      }
      if (lastVideo) URL.revokeObjectURL(lastVideo.url);
      lastVideo = result;
      const v = dom.el('videoResult');
      v.src = result.url; v.classList.remove('hidden');
      canvas.classList.add('hidden');
      dom.el('vResultActions').classList.remove('hidden');
      setVideoProgress(null);
      vStatus('Done. ' + result.ext.toUpperCase() + ', ' + Math.round(result.durationMs / 1000) + 's. Press play.');
      toast('Video ad ready');
    } catch (e) {
      setVideoProgress(null);
      vStatus('Failed: ' + (e.message || e));
      log.error('Video build failed: ' + (e.message || e), 'Video');
      toast('Video build failed. See status/log');
    } finally { videoBusy = false; btn.disabled = false; btn.textContent = old; }
  }

  function onDownloadVideo() {
    if (!lastVideo) return;
    const a = document.createElement('a');
    const name = (O.state.brief && O.state.brief.brandName ? O.state.brief.brandName : 'adforge-ad').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    a.href = lastVideo.url; a.download = name + '.' + lastVideo.ext;
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- wire everything ---------- */
  function init() {
    renderPipeline();
    refreshBadge();

    // examples
    const ex = dom.el('examples');
    config.EXAMPLES.forEach(text => {
      ex.appendChild(dom.create('span', { class: 'chip', onclick: () => { dom.el('idea').value = text; } }, [text]));
    });

    // scenes slider
    dom.el('scenes').addEventListener('input', (e) => { dom.el('scenesVal').textContent = e.target.value; });

    // composer
    dom.el('generateBtn').addEventListener('click', onGenerate);

    // creative directions (delegated)
    dom.el('conceptsGrid').addEventListener('click', onConceptsClick);
    dom.el('conceptsGrid').addEventListener('keydown', onConceptsKey);

    // master prompt controls
    dom.el('masterPrompt').addEventListener('change', (e) => O.setMasterPrompt(e.target.value));
    dom.el('improveMasterBtn').addEventListener('click', async () => {
      const btn = dom.el('improveMasterBtn'); btn.disabled = true;
      try { await O.setMasterPrompt(dom.el('masterPrompt').value); await O.improveMasterPrompt(); toast('Master prompt improved'); }
      catch (e) { toast('Improve failed. See log'); } finally { btn.disabled = false; }
    });
    dom.el('regenAllBtn').addEventListener('click', async () => {
      await O.setMasterPrompt(dom.el('masterPrompt').value);
      await O.regenerateAll(); toast('Regenerated all scenes');
    });
    dom.el('exportBtn').addEventListener('click', () => { exporter.downloadCampaign(O.state); toast('Campaign exported as Markdown'); });

    // scenes (delegated)
    dom.el('scenesGrid').addEventListener('click', onScenesClick);
    dom.el('scenesGrid').addEventListener('change', (e) => {
      const sel = e.target.closest('.scene-motion'); if (!sel) return;
      const sc = O.getScene(sel.getAttribute('data-id')); if (sc) sc.motion = sel.value;
    });

    // video ad
    populateVoiceSelect();
    dom.el('vEngine').addEventListener('change', populateVoiceSelect);
    dom.el('previewBtn').addEventListener('click', onPreview);
    dom.el('buildVideoBtn').addEventListener('click', onBuildVideo);
    dom.el('downloadVideoBtn').addEventListener('click', onDownloadVideo);
    dom.el('rebuildVideoBtn').addEventListener('click', onBuildVideo);
    if (AF.voiceover.webSpeechReady() && window.speechSynthesis.addEventListener) {
      window.speechSynthesis.addEventListener('voiceschanged', () => { if (dom.el('vEngine').value === 'webspeech') populateVoiceSelect(); });
    }

    // log toggle
    dom.el('logToggle').addEventListener('click', (e) => {
      const box = dom.el('log'); const open = box.classList.toggle('hidden');
      e.target.setAttribute('aria-expanded', String(!open));
      e.target.textContent = (open ? '▸' : '▾') + ' Agent activity log';
    });

    // modals
    dom.el('settingsBtn').addEventListener('click', () => { loadSettingsForm(); openModal('settingsModal'); });
    dom.el('howBtn').addEventListener('click', () => openModal('howModal'));
    dom.el('saveSettings').addEventListener('click', saveSettingsForm);
    dom.qa('[data-close]').forEach(b => b.addEventListener('click', (e) => e.target.closest('.modal').classList.add('hidden')));
    dom.qa('.modal').forEach(m => m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); }));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dom.qa('.modal').forEach(m => m.classList.add('hidden')); });

    // bus subscriptions
    bus.on('stage', ({ name, status }) => setStageUI(name, status));
    bus.on('concepts', (dirs) => renderConcepts(dirs));
    bus.on('state', (state) => { setBusy(state.busy); renderBrief(state); renderScenes(state); updateVideoVisibility(state); });
    bus.on('scene', (s) => updateScene(s));
    bus.on('log', appendLog);
  }

  return { init, toast };
})();
