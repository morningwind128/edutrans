// Multi-model routing is opt-in per configured service, under one shared account limit.
(function (global) {
  'use strict';
  const active = new Map(); let round = 0;
  function group(engine) {
    if (global.EduTransScheduler) return global.EduTransScheduler.groupId(engine);
    try { return new URL(engine.baseUrl).host; } catch (_) { return engine.baseUrl; }
  }
  function candidates(settings, base, hint) {
    const pipeline = settings.translationPipeline || {};
    if (pipeline.enabled === false || base.type !== 'openai') return [base];
    const pool = Object.values(settings.engines).filter(e => e.type === 'openai' &&
      (e.id === base.id || ['standard', 'complex', 'review', 'all'].includes(e.translationRole)) &&
      group(e) === group(base));
    const preferred = pool.filter(e => hint === 'complex' || hint === 'review'
      ? ['complex', 'review'].includes(e.translationRole)
      : e.translationRole === 'standard');
    const all = pool.filter(e => e.translationRole === 'all' || e.id === base.id);
    return preferred.length ? preferred : all.length ? all : [base];
  }
  function pick(list) {
    const min = Math.min(...list.map(e => active.get(e.id) || 0));
    const idle = list.filter(e => (active.get(e.id) || 0) === min);
    return idle[round++ % idle.length];
  }
  async function run(engine, texts, ctx) {
    active.set(engine.id, (active.get(engine.id) || 0) + 1);
    try { return await global.EduTransEngines.translateBatch(engine, texts, ctx); }
    finally { active.set(engine.id, Math.max(0, (active.get(engine.id) || 1) - 1)); }
  }
  async function translate(settings, engineId, texts, ctx) {
    const base = settings.engines[engineId] || settings.engines[settings.defaultEngineId];
    if (!base || base.type === 'device') throw new Error('本地翻译需在网页中执行');
    const explicit = engineId && engineId !== settings.defaultEngineId;
    const hint = ctx.routingHint || (global.EduTransQuality ? global.EduTransQuality.classify(texts.join(' '), ctx) : 'standard');
    const first = explicit ? base : pick(candidates(settings, base, hint));
    try {
      const out = await run(first, texts, ctx);
      return { texts: out, engineName: first.name || first.id, models: out.models || [first.model || first.id], fellBack: false };
    } catch (error) {
      const repairable = error.quality || error.timeout || error.status >= 500 || /truncated|malformed|incomplete|漏译/.test(error.message);
      if (explicit || !repairable) throw error;
      const reviews = candidates(settings, base, 'review').filter(e => e.id !== first.id);
      if (!reviews.length) throw error;
      const reviewer = pick(reviews);
      const out = await run(reviewer, texts, Object.assign({}, ctx, { repairing: true }));
      return { texts: out, engineName: reviewer.name || reviewer.id, models: out.models || [reviewer.model || reviewer.id], fellBack: true };
    }
  }
  global.EduTransRouter = { translate: translate, candidates: candidates };
})(typeof self !== 'undefined' ? self : this);
