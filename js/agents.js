/* AdForge — the agent team.
   Five specialists, each a focused LLM role. They return structured data so the
   orchestrator can wire them into a pipeline and a refinement loop. */
window.AF = window.AF || {};

AF.agents = (function () {
  const { llm } = AF;

  const sys = (content) => ({ role: 'system', content });
  const usr = (content) => ({ role: 'user', content });

  /* 0) CONCEPTS — rough idea -> THREE distinct creative directions to pick from. */
  async function concepts(input) {
    const messages = [
      sys('You are a senior advertising strategist pitching creative directions to a client. ' +
          'Propose THREE genuinely DISTINCT directions for the product — different angles, tones and visual ' +
          'worlds, not three variations of one idea. Each must be commercially viable on its own. ' +
          'Respond with ONLY minified JSON, no prose, no markdown.'),
      usr(JSON.stringify({
        task: 'Propose exactly 3 distinct creative directions.',
        product_idea: input.idea,
        audience_hint: input.audience || '(infer the most valuable audience)',
        tone_hint: input.tone || '(deliberately vary the tone across the three)',
        platform: input.platform || 'general',
        json_shape: {
          directions: [{
            title: 'short punchy name for the direction, 2-4 words',
            angle: 'the single big creative idea, one sentence',
            audience: 'who this direction targets, a few words',
            tone: 'one or two words, e.g. bold / minimal / playful',
            mood: 'visual mood in 3-6 words',
            rationale: 'why this direction could win, one sentence'
          }]
        }
      }))
    ];
    const out = await llm.chatJson(messages, { temperature: 0.95, maxTokens: 1000 });
    const arr = Array.isArray(out) ? out : (out.directions || out.concepts || []);
    return arr.slice(0, 3);
  }

  /* 1) STRATEGIST — rough idea (+ a chosen direction) -> tight creative brief. */
  async function strategist(input, chosen) {
    const messages = [
      sys('You are a senior advertising strategist. Turn a rough product idea into a tight creative brief. ' +
          'Be concrete and commercially sharp. If a chosen_direction is given, stay faithful to its angle, ' +
          'tone and mood — the brief must express THAT direction. ' +
          'Respond with ONLY minified JSON, no prose, no markdown.'),
      usr(JSON.stringify({
        task: 'Write a creative brief.',
        product_idea: input.idea,
        audience_hint: input.audience || '(infer the most valuable audience)',
        tone_hint: input.tone || '(choose a tone that fits)',
        platform: input.platform || 'general',
        chosen_direction: chosen || '(none — pick the strongest angle yourself)',
        json_shape: {
          brandName: 'short inventable brand name',
          angle: 'the single big creative idea, one sentence',
          audience: 'who we target, one sentence',
          keyMessage: 'the one thing they must remember',
          tone: 'e.g. playful, premium, bold',
          mood: 'visual mood in 3-6 words',
          visualStyle: 'photography/illustration style direction',
          palette: ['#hex', '#hex', '#hex']
        }
      }))
    ];
    return llm.chatJson(messages, { temperature: 0.85, maxTokens: 700 });
  }

  /* 2) PROMPT ENGINEER — brief -> strong master image prompt. */
  async function promptEngineer(brief) {
    const messages = [
      sys('You are an expert AI-image prompt engineer (Flux/SD). Write ONE vivid, structured master prompt ' +
          'for an advertising key visual: subject, setting, composition, lighting, lens/style, mood, color. ' +
          'No camera brand names, no text-in-image requests. Reply with ONLY the prompt text, one paragraph, no quotes.'),
      usr('Creative brief:\n' + JSON.stringify(brief))
    ];
    const t = await llm.chat(messages, { temperature: 0.8, maxTokens: 320 });
    return t.trim().replace(/^["'`]+|["'`]+$/g, '');
  }

  /* Improve / rewrite an existing prompt on demand ("Improve my prompt" button). */
  async function improvePrompt(currentPrompt, brief, instruction) {
    const messages = [
      sys('You are an expert AI-image prompt engineer. Improve the given advertising image prompt: ' +
          'sharper composition, lighting and style cues, stronger mood, keep it on-brief. ' +
          'Reply with ONLY the improved prompt text, one paragraph, no quotes, no commentary.'),
      usr(JSON.stringify({
        brief: brief || '(none)',
        current_prompt: currentPrompt,
        instruction: instruction || 'Make it more striking and ad-ready while staying realistic.'
      }))
    ];
    const t = await llm.chat(messages, { temperature: 0.75, maxTokens: 320 });
    return t.trim().replace(/^["'`]+|["'`]+$/g, '');
  }

  /* 3) ART DIRECTOR — brief + master prompt -> N distinct scenes. */
  async function artDirector(brief, masterPrompt, nScenes) {
    const messages = [
      sys('You are an art director building an ad campaign as a set of distinct scenes ' +
          '(e.g. hero shot, lifestyle in-use, detail/macro close-up, call-to-action frame). ' +
          'Each scene must be visually different but share the same brand world and master prompt DNA. ' +
          'Respond with ONLY minified JSON, no prose.'),
      usr(JSON.stringify({
        task: 'Create exactly ' + nScenes + ' scenes.',
        brief,
        masterPrompt,
        json_shape: { scenes: [{ name: 'short scene title', purpose: 'why it exists in the funnel', prompt: 'a full standalone image prompt for this scene' }] }
      }))
    ];
    const out = await llm.chatJson(messages, { temperature: 0.85, maxTokens: 1500 });
    const scenes = Array.isArray(out) ? out : (out.scenes || []);
    return scenes.slice(0, nScenes);
  }

  /* 4) COPYWRITER — scene -> ad copy. */
  async function copywriter(brief, scene) {
    const messages = [
      sys('You are a punchy advertising copywriter. Write copy for ONE ad scene. ' +
          'Headline <= 7 words, subhead <= 14 words, body <= 30 words, a strong CTA, ' +
          'and a social caption with 2-3 hashtags. Respond with ONLY minified JSON.'),
      usr(JSON.stringify({
        brief,
        scene: { name: scene.name, purpose: scene.purpose, prompt: scene.prompt },
        json_shape: { headline: '', subhead: '', body: '', cta: '', caption: '' }
      }))
    ];
    return llm.chatJson(messages, { temperature: 0.9, maxTokens: 500 });
  }

  /* 5) CRITIC — score a scene against the brief and propose ONE concrete fix. */
  async function critic(brief, scene) {
    const messages = [
      sys('You are a tough creative director reviewing one ad scene against the brief. ' +
          'Score it 0-100 on how well visual + copy sell the key message. Give 1-2 sentences of notes ' +
          'and an improvedPrompt that fixes the biggest visual weakness (keep it on-brief). ' +
          'Respond with ONLY minified JSON.'),
      usr(JSON.stringify({
        brief,
        scene: { name: scene.name, prompt: scene.prompt, copy: scene.copy || null },
        json_shape: { score: 0, notes: '', improvedPrompt: '' }
      }))
    ];
    return llm.chatJson(messages, { temperature: 0.4, maxTokens: 500 });
  }

  return { concepts, strategist, promptEngineer, improvePrompt, artDirector, copywriter, critic };
})();
