/* AdForge — tiny utilities: event bus, activity log, DOM helpers, a concurrency pool. */
window.AF = window.AF || {};

/* Minimal pub/sub so the orchestrator and UI stay decoupled. */
AF.bus = (function () {
  const map = {};
  return {
    on(evt, fn) { (map[evt] = map[evt] || []).push(fn); return () => { map[evt] = map[evt].filter(f => f !== fn); }; },
    emit(evt, payload) { (map[evt] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } }); }
  };
})();

/* Activity log — what each agent did, surfaced in the UI and console. */
AF.log = (function () {
  const entries = [];
  let n = 0;
  function push(level, msg, agent) {
    const e = { id: ++n, level, msg, agent: agent || null, t: new Date().toLocaleTimeString() };
    entries.push(e);
    AF.bus.emit('log', e);
    const tag = '[AdForge]' + (agent ? ' ' + agent : '');
    (level === 'warn' ? console.warn : level === 'error' ? console.error : console.log)(tag, msg);
    return e;
  }
  return {
    entries,
    info: (m, a) => push('info', m, a),
    warn: (m, a) => push('warn', m, a),
    error: (m, a) => push('error', m, a),
    agent: (a, m) => push('agent', m, a)
  };
})();

/* DOM helpers. */
AF.dom = {
  el(id) { return document.getElementById(id); },
  q(sel, root) { return (root || document).querySelector(sel); },
  qa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); },
  esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },
  create(tag, props, children) {
    const node = document.createElement(tag);
    if (props) Object.entries(props).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v != null) node.setAttribute(k, v);
    });
    (children || []).forEach(c => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return node;
  }
};

/* Run async tasks with a concurrency cap; preserves input order in results. */
AF.pool = async function (items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await worker(items[idx], idx); }
      catch (e) { results[idx] = { __error: e }; }
    }
  });
  await Promise.all(runners);
  return results;
};

AF.uid = () => 's' + Math.floor(Math.random() * 1e9).toString(36);
