// All cloud model requests share an account queue; keys do not multiply its capacity.
(function (global) {
  'use strict';
  const groups = new Map();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const bound = (v, fallback, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(v)) ? Number(v) : fallback));

  function groupId(engine) {
    if (String(engine.quotaGroup || '').trim()) return String(engine.quotaGroup).trim();
    try { return new URL(engine.baseUrl).host; } catch (_) { return String(engine.baseUrl || engine.id || 'default'); }
  }
  function getGroup(engine, ctx) {
    const id = groupId(engine), ceiling = Math.floor(bound(ctx.accountConcurrency, 2, 1, 32));
    const initialSpacing = Math.floor(bound(ctx.staggerMs, 180, 0, 1000));
    if (!groups.has(id)) groups.set(id, { id, ceiling, limit: ceiling, active: 0, queue: [], keys: new Map(), round: 0, blockedUntil: 0, recovered: 0, spacing: initialSpacing, initialSpacing, lastStarted: 0, drainTimer: null });
    const g = groups.get(id);
    g.initialSpacing = initialSpacing; g.spacing = Math.max(g.spacing, initialSpacing);
    if (g.ceiling !== ceiling) { g.ceiling = ceiling; g.limit = Math.min(ceiling, g.limit); }
    return g;
  }
  function cancelled() { const error = new Error('翻译已停止'); error.name = 'AbortError'; return error; }
  function drain(g) {
    const due = Math.max(g.blockedUntil, g.lastStarted + g.spacing);
    if (Date.now() < due) {
      if (!g.drainTimer) g.drainTimer = setTimeout(() => { g.drainTimer = null; drain(g); }, Math.max(1, due - Date.now()));
      return;
    }
    g.queue.sort((a, b) => a.priority - b.priority || a.created - b.created);
    while (g.queue.length && g.active < g.limit) {
      const waiter = g.queue.shift(); waiter.cleanup(); g.active++; g.lastStarted = Date.now();
      let released = false;
      waiter.resolve(() => { if (released) return; released = true; g.active--; drain(g); });
      if (g.spacing && g.queue.length) { drain(g); return; }
    }
  }
  function acquire(g, ctx, deadline) {
    return new Promise((resolve, reject) => {
      if (ctx.signal?.aborted) return reject(cancelled());
      if (Date.now() >= deadline) { const e = new Error('翻译等待超时，请重试'); e.timeout = true; return reject(e); }
      let timer;
      const waiter = { resolve, priority: Number(ctx.priority) || 0, created: Date.now(), cleanup: () => { clearTimeout(timer); ctx.signal?.removeEventListener('abort', abort); } };
      const remove = error => { const index = g.queue.indexOf(waiter); if (index < 0) return; g.queue.splice(index, 1); waiter.cleanup(); reject(error); };
      const abort = () => remove(cancelled());
      timer = setTimeout(() => { const e = new Error('翻译等待超时，请重试'); e.timeout = true; remove(e); }, Math.max(1, deadline - Date.now()));
      ctx.signal?.addEventListener('abort', abort, { once: true });
      g.queue.push(waiter); drain(g);
    });
  }
  function keys(engine) {
    return [...new Set([engine.apiKey, ...(Array.isArray(engine.apiKeys) ? engine.apiKeys : [])].filter(k => typeof k === 'string' && k.trim()).map(k => k.trim()))];
  }
  function pickKey(g, engine) {
    const available = keys(engine);
    if (!available.length) return { value: '', state: { active: 0 } };
    const candidates = available.map(value => {
      if (!g.keys.has(value)) g.keys.set(value, { active: 0, unavailableUntil: 0 });
      return { value, state: g.keys.get(value) };
    }).filter(k => k.state.unavailableUntil <= Date.now());
    if (!candidates.length) throw new Error('此账户的已配置密钥暂不可用，请检查设置');
    const min = Math.min(...candidates.map(k => k.state.active));
    const idle = candidates.filter(k => k.state.active === min);
    return idle[g.round++ % idle.length];
  }
  function redact(text, engine) {
    let safe = String(text || ''); for (const key of keys(engine)) safe = safe.split(key).join('[已隐藏]');
    return safe.slice(0, 220);
  }
  function retryDelay(res, attempt) {
    const raw = res.headers && res.headers.get ? res.headers.get('Retry-After') : null;
    if (raw) {
      const secs = Number(raw), date = Date.parse(raw);
      return Math.max(250, Number.isFinite(secs) ? secs * 1000 : Number.isFinite(date) ? date - Date.now() : 1000);
    }
    return Math.min(8000, 1000 * Math.pow(2, attempt));
  }

  async function request(engine, body, ctx) {
    ctx = ctx || {}; const g = getGroup(engine, ctx);
    const timeout = bound(engine.timeoutMs || ctx.timeoutMs, 20000, 100, 180000);
    const deadline = Date.now() + bound(ctx.deadlineMs, Math.max(30000, timeout), 100, 180000);
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      const release = await acquire(g, ctx, deadline); let selected, timer, externalAbort;
      try {
        selected = pickKey(g, engine); selected.state.active++;
        const controller = new AbortController();
        const duration = Math.max(1, Math.min(timeout, deadline - Date.now()));
        externalAbort = () => controller.abort();
        ctx.signal?.addEventListener('abort', externalAbort, { once: true });
        if (ctx.signal?.aborted) throw cancelled();
        const base = String(engine.baseUrl || '').trim().replace(/\/+$/, '');
        const url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
        const headers = { 'Content-Type': 'application/json' };
        if (selected.value) headers.Authorization = 'Bearer ' + selected.value;
        const expiry = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); const e = new Error('翻译请求超时，请重试'); e.timeout = true; reject(e); }, duration); });
        const data = await Promise.race([expiry, (async () => {
          const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
          if (!res.ok) {
            const e = new Error('AI HTTP ' + res.status); e.status = res.status;
            if (res.status === 429) e.delay = retryDelay(res, attempt);
            try { const json = await res.json(); e.message += ': ' + redact(json.error?.message || json.message || '', engine); } catch (_) {}
            throw e;
          }
          const json = await res.json();
          if (json.error) { const e = new Error('AI ' + redact(json.error.message || '请求失败', engine)); e.code = json.error.code; throw e; }
          return json;
        })()]);
        g.recovered++;
        if (g.recovered >= 6 && Date.now() >= g.blockedUntil) {
          if (g.limit < g.ceiling) g.limit++;
          g.spacing = g.spacing <= 500 ? g.initialSpacing : Math.max(g.initialSpacing, Math.floor(g.spacing / 2)); g.recovered = 0;
        }
        return data;
      } catch (e) {
        if (ctx.signal?.aborted) e = cancelled();
        if (!e.status && !e.timeout && e.name !== 'AbortError') e.transport = true;
        last = e; g.recovered = 0;
        if ((e.status === 401 || e.status === 403) && selected && selected.value) selected.state.unavailableUntil = Date.now() + 5 * 60 * 1000;
        if (e.status === 503) g.limit = Math.max(1, Math.floor(g.limit / 2));
        if (e.status === 429) {
          g.limit = Math.max(1, Math.floor(g.limit / 2));
          g.spacing = Math.min(10000, Math.max(500, g.spacing * 2));
          g.blockedUntil = Math.max(g.blockedUntil, Date.now() + Math.max(e.delay, g.spacing));
          setTimeout(() => drain(g), Math.max(0, g.blockedUntil - Date.now()) + 1);
        }
        const retry = e.status === 429 || e.status >= 500 || ((e.status === 401 || e.status === 403) && keys(engine).length > 1);
        if (!retry || attempt === 2) throw e;
      } finally {
        if (timer) clearTimeout(timer);
        if (externalAbort) ctx.signal?.removeEventListener('abort', externalAbort);
        if (selected) selected.state.active = Math.max(0, selected.state.active - 1);
        release();
      }
      if (last.status !== 429) await sleep(Math.min(1500, 300 * (attempt + 1)));
    }
    throw last;
  }
  function snapshot() {
    return [...groups.values()].map(g => ({ account: g.id, configuredCeiling: g.ceiling, effectiveConcurrency: g.limit, active: g.active, queued: g.queue.length, keyCount: g.keys.size, requestSpacingMs: g.spacing }));
  }
  global.EduTransScheduler = { request, snapshot, groupId };
})(typeof self !== 'undefined' ? self : this);
