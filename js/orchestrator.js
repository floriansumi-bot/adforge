/* AdForge — orchestrator.
   Owns the campaign state and drives the agent pipeline + refinement loop.
   Emits 'stage', 'state' and 'scene' events; the UI just renders what it hears. */
window.AF = window.AF || {};

AF.orchestrator = (function () {
  const { agents, images, config, log, bus, pool } = AF;

  const state = {
    input: null,        // {idea, audience, tone, platform, scenes}
    concepts: [],       // [{title,angle,audience,tone,mood,rationale}] — directions to pick from
    chosenConcept: null,
    brief: null,
    masterPrompt: '',
    scenes: [],         // [{id,name,purpose,prompt,seed,imageUrl,copy,critique,status}]
    busy: false,
    stages: {}          // stageName -> 'running'|'done'|'error'
  };

  function setStage(name, status) { state.stages[name] = status; bus.emit('stage', { name, status }); }
  function pushState() { bus.emit('state', state); }
  function pushScene(scene) { bus.emit('scene', scene); }

  function newScene(s) {
    return Object.assign({
      id: AF.uid(), name: s.name || 'Scene', purpose: s.purpose || '',
      prompt: s.prompt || '', imageUrl: '', copy: null,
      critique: null, status: 'pending'
    }, s);
  }

  /* Write copy + (optionally) render an image for one scene.
     Copy is ESSENTIAL; the image is OPTIONAL (CogView is paid / may be unavailable).
     Run them independently so a failed image never discards the copy — the video
     builder falls back to an animated motion-graphics background when there's no image. */
  async function renderScene(scene) {
    scene.status = 'rendering'; scene.imageError = null; pushScene(scene);
    const copyP = scene.copy
      ? Promise.resolve(scene.copy)
      : agents.copywriter(state.brief, scene).catch(e => { log.warn('Copy failed for "' + scene.name + '": ' + e.message, 'Copywriter'); return null; });
    const imgP = images.generate(scene.prompt).then(r => r.url)
      .catch(e => { scene.imageError = e.message; return null; });
    const [copy, url] = await Promise.all([copyP, imgP]);
    if (copy) scene.copy = copy;
    scene.imageUrl = url || '';
    // Usable as long as it has copy; image-free scenes still animate in the video.
    scene.status = scene.copy ? 'done' : 'error';
    if (!scene.copy) { scene.error = 'No copy generated'; log.error('Scene "' + scene.name + '" failed: no copy', 'Render'); }
    else if (!url) { log.warn('Scene "' + scene.name + '": image unavailable — the video will use an animated background', 'Render'); }
    pushScene(scene);
    return scene;
  }

  /* ---------- Step 0: propose 3 creative directions to pick from ---------- */
  async function proposeConcepts(input) {
    if (state.busy) return null;
    state.busy = true;
    state.input = input;
    state.concepts = []; state.chosenConcept = null;
    state.brief = null; state.scenes = []; state.stages = {}; pushState();
    log.info('New idea: "' + input.idea + '" — proposing 3 directions (' + AF.llm.activeBrain() + ')');
    try {
      setStage('concepts', 'running');
      const dirs = await agents.concepts(input);
      if (!dirs.length) throw new Error('No directions returned');
      state.concepts = dirs;
      log.agent('Strategist', 'Proposed ' + dirs.length + ' creative directions — pick one');
      setStage('concepts', 'done'); pushState();
      bus.emit('concepts', dirs);
      return dirs;
    } catch (e) {
      setStage('concepts', 'error');
      log.error('Could not propose directions: ' + e.message);
      return null;
    } finally {
      state.busy = false; pushState();
    }
  }

  /* ---------- Full pipeline (build the campaign for the chosen direction) ---------- */
  async function generateCampaign(input, chosen) {
    if (state.busy) return;
    state.busy = true;
    state.input = input;
    if (chosen) state.chosenConcept = chosen;
    state.scenes = []; pushState();
    log.info('Building campaign: "' + input.idea + '"' +
      (state.chosenConcept ? ' — direction: ' + (state.chosenConcept.title || '(chosen)') : '') +
      ' — brain: ' + AF.llm.activeBrain());

    try {
      if (state.concepts.length) setStage('concepts', 'done');

      // 1) Strategist
      setStage('strategist', 'running');
      state.brief = await agents.strategist(input, state.chosenConcept);
      log.agent('Strategist', 'Brief ready — angle: ' + (state.brief.angle || '(n/a)'));
      setStage('strategist', 'done'); pushState();

      // 2) Prompt Engineer
      setStage('promptEngineer', 'running');
      state.masterPrompt = await agents.promptEngineer(state.brief);
      log.agent('Prompt Engineer', 'Master prompt drafted (' + state.masterPrompt.length + ' chars)');
      setStage('promptEngineer', 'done'); pushState();

      // 3) Art Director
      setStage('artDirector', 'running');
      const nScenes = Math.max(1, Math.min(config.MAX_SCENES, input.scenes || config.DEFAULT_SCENES));
      const planned = await agents.artDirector(state.brief, state.masterPrompt, nScenes);
      state.scenes = planned.map(newScene);
      log.agent('Art Director', 'Planned ' + state.scenes.length + ' scenes');
      setStage('artDirector', 'done'); pushState();

      // 4) Render + copy (parallel, capped)
      setStage('render', 'running');
      await pool(state.scenes, config.IMG_CONCURRENCY, (s) => renderScene(s));
      log.agent('Copywriter', 'Copy written for all scenes');
      setStage('render', 'done'); pushState();

      // 5) Critic pass (scores every scene; refinement is opt-in per scene)
      setStage('critic', 'running');
      await pool(state.scenes.filter(s => s.status === 'done'), config.IMG_CONCURRENCY, async (s) => {
        try {
          s.critique = await agents.critic(state.brief, s);
          pushScene(s);
        } catch (e) { log.warn('Critic skipped "' + s.name + '": ' + e.message, 'Critic'); }
      });
      const avg = scoreAverage();
      log.agent('Critic', 'Reviewed all scenes — average score ' + (avg != null ? avg + '/100' : 'n/a'));
      setStage('critic', 'done'); pushState();

      log.info('Campaign ready.');
    } catch (e) {
      log.error('Pipeline failed: ' + e.message);
      Object.keys(state.stages).forEach(k => { if (state.stages[k] === 'running') setStage(k, 'error'); });
    } finally {
      state.busy = false; pushState();
    }
  }

  function scoreAverage() {
    const scored = state.scenes.map(s => s.critique?.score).filter(n => typeof n === 'number');
    if (!scored.length) return null;
    return Math.round(scored.reduce((a, b) => a + b, 0) / scored.length);
  }

  function getScene(id) { return state.scenes.find(s => s.id === id); }

  /* ---------- Targeted re-runs (the "edit a scene or the master prompt" features) ---------- */

  async function regenerateAll() {
    if (!state.brief || state.busy) return;
    state.busy = true; pushState();
    try {
      setStage('artDirector', 'running');
      const n = state.scenes.length || (state.input?.scenes) || config.DEFAULT_SCENES;
      const planned = await agents.artDirector(state.brief, state.masterPrompt, n);
      state.scenes = planned.map(newScene);
      setStage('artDirector', 'done'); pushState();
      setStage('render', 'running');
      await pool(state.scenes, config.IMG_CONCURRENCY, (s) => renderScene(s));
      setStage('render', 'done');
      log.agent('Art Director', 'Regenerated all scenes from the edited master prompt');
    } finally { state.busy = false; pushState(); }
  }

  async function setMasterPrompt(text) { state.masterPrompt = text; pushState(); }

  async function improveMasterPrompt(instruction) {
    setStage('promptEngineer', 'running'); pushState();
    state.masterPrompt = await agents.improvePrompt(state.masterPrompt, state.brief, instruction);
    log.agent('Prompt Engineer', 'Improved the master prompt');
    setStage('promptEngineer', 'done'); pushState();
    return state.masterPrompt;
  }

  /* Edit one scene's prompt, then re-render just that scene's image. */
  async function updateScenePrompt(id, prompt) {
    const s = getScene(id); if (!s) return;
    s.prompt = prompt; pushScene(s);
  }
  async function regenerateScene(id) {
    const s = getScene(id); if (!s) return;
    log.agent('Render', 'Regenerating scene "' + s.name + '"');
    await renderScene(s);
  }
  async function improveScenePrompt(id, instruction) {
    const s = getScene(id); if (!s) return;
    s.prompt = await agents.improvePrompt(s.prompt, state.brief, instruction);
    log.agent('Prompt Engineer', 'Improved prompt for "' + s.name + '"');
    pushScene(s);
    return s.prompt;
  }
  async function rewriteCopy(id) {
    const s = getScene(id); if (!s) return;
    s.copy = await agents.copywriter(state.brief, s);
    log.agent('Copywriter', 'Rewrote copy for "' + s.name + '"');
    pushScene(s);
  }
  async function critiqueScene(id) {
    const s = getScene(id); if (!s) return;
    s.critique = await agents.critic(state.brief, s);
    log.agent('Critic', '"' + s.name + '" scored ' + (s.critique?.score ?? '?') + '/100');
    pushScene(s);
  }
  async function applyCritique(id) {
    const s = getScene(id); if (!s || !s.critique?.improvedPrompt) return;
    s.prompt = s.critique.improvedPrompt;
    pushScene(s);
    await regenerateScene(id);
    await critiqueScene(id);
  }

  return {
    state, proposeConcepts, generateCampaign, regenerateAll, setMasterPrompt, improveMasterPrompt,
    updateScenePrompt, regenerateScene, improveScenePrompt, rewriteCopy,
    critiqueScene, applyCritique, getScene, scoreAverage
  };
})();
