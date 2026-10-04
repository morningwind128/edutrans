// EduTrans content script: bilingual page translation + selection popup.
(function () {
  'use strict';

  const BLOCK_SEL = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,dd,dt,figcaption,td,th,caption';
  const SKIP_SEL = 'script,style,noscript,textarea,svg,canvas,code,pre';
  const MIN_LEN = 2;

  const S = {
    active: false,
    settings: null,
    engineId: null,
    mode: 'bilingual',
    queue: [],
    inflight: 0,
    io: null,
    seq: 0,
    runId: 0,
    lite: [],
    liteInflight: 0,
    mo: null
  };

  function textOf(el) {
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function visible(el) {
    if (el.closest('[hidden],[aria-hidden="true"]')) return false;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }

  function hasBlockChild(el) {
    return !!el.querySelector(BLOCK_SEL);
  }

  function pageControl(el) {
    if (el.closest('nav,[role="navigation"],[role="menu"],[role="menubar"],[role="banner"]')) return true;
    const header = el.closest('header');
    // Site mastheads have fixed list/grid layouts. Article headers still contain translatable titles.
    return !!header && !header.closest('article,main,[role="main"]');
  }

  function foreignEnough(t) {
    return /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u3040-\u30FF\uAC00-\uD7AF]/.test(t);
  }

  function inBlacklist() {
    return EduTransCommon.hostMatches(
      location.hostname,
      (S.settings && S.settings.blacklist) || []
    );
  }

  function findMainRoot() {
    if (S.mainRoot !== undefined) return S.mainRoot;
    S.mainRoot = document.querySelector(
      'article, main, [role="main"], [itemprop="articleBody"],' +
      ' section[name="articleBody"], div[class*="article-body"],' +
      ' div[class*="post-content"]'
    ) || null;
    return S.mainRoot;
  }

  function paraPriority(el) {
    if (el.closest('aside,nav,footer,[role="navigation"],[class*="author-bio"],[class*="copyright"]')) return 1;
    const main = findMainRoot();
    if (el.matches('h1,h2,h3')) return main && main.contains(el) ? 4 : 2;
    return main && main.contains(el) ? 3 : 1;
  }

  function collectParas() {
    const out = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: function (el) {
          if (!(el.matches && el.matches(BLOCK_SEL))) {
            return NodeFilter.FILTER_SKIP;
          }
          if (el.closest(SKIP_SEL)) return NodeFilter.FILTER_REJECT;
          if (el.closest('.edutrans-ui')) return NodeFilter.FILTER_REJECT;
          if (pageControl(el)) return NodeFilter.FILTER_REJECT;
          if (hasBlockChild(el)) return NodeFilter.FILTER_SKIP;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    let el;
    while ((el = walker.nextNode())) {
      if (el.hasAttribute('data-edutrans-id')) continue;
      if (el.isContentEditable) continue;
      const tag = el.tagName;
      if (tag === 'BUTTON' || tag === 'OPTION' || tag === 'TIME') continue;
      if (el.closest('button, label, select')) continue;
      const t = textOf(el);
      if (t.length < MIN_LEN) continue;
      if (!foreignEnough(t)) continue;
      if (!visible(el)) continue;
      el.__etPrio = paraPriority(el);
      out.push(el);
    }
    return out;
  }

  function ensureObserver() {
  if (S.io) return S.io;
  const runId = S.runId;
  const observer = new IntersectionObserver(entries => {
    if (!live(runId) || S.io !== observer) return;
    entries.forEach(entry => {
      if (entry.isIntersecting) { observer.unobserve(entry.target); schedule(entry.target); }
    });
  }, { rootMargin: '200px 0px 1500px 0px' });
  S.io = observer;
  return observer;
}

  function inject(el, translation) {
    dropSkeleton(el);
    if (!el.isConnected || !translation) return;
    const div = el.__etTarget && el.__etTarget.isConnected ? el.__etTarget : document.createElement('div');
    div.className = 'edutrans-ui edutrans-target edutrans-anim';
    div.removeAttribute('data-edutrans-partial');
    try {
      const cs = getComputedStyle(el);
      div.style.color = cs.color;
      div.style.fontFamily = cs.fontFamily;
      div.style.fontSize = cs.fontSize;
      div.style.lineHeight = cs.lineHeight;
      div.style.fontWeight = cs.fontWeight;
      div.style.textAlign = cs.textAlign;
      div.style.margin = '2px 0 10px';
    } catch (e) { /* fall back to stylesheet defaults */ }
    div.textContent = translation;
    const started = el.__etItem?.startedAt;
    if (started !== undefined && !div.hasAttribute('data-edutrans-first-ms')) div.setAttribute('data-edutrans-first-ms', String(Math.round(performance.now() - started)));
    el.__etTarget = div;
    if (!div.isConnected) el.insertAdjacentElement('afterend', div);
  }

  function schedule(el) {
    if (el.hasAttribute('data-edutrans-id')) return;
    markDone(el);
    const t = textOf(el);
    const item = { el: el, prio: el.__etPrio || 1, text: t, len: t.length, marker: el.getAttribute('data-edutrans-id') };
    item.startedAt = performance.now();
    el.__etSource = t; el.__etItem = item; el.__etPhase = 'queued';
    S.lite = S.lite || [];
    S.stats = S.stats || { total: 0, done: 0, fail: 0 };
    addSkeleton(el, t.length);
    S.stats.total += 1;
    updateProgress();
    const policy = Object.assign({}, S.settings.translationPipeline || {}, { terms: S.settings.terms || [] });
    item.tier = policy.enabled === false ? 'standard' : el.matches('h1,h2,h3') ? 'complex' : EduTransQuality.classify(t, policy);
    if (item.tier === 'local') S.lite.push(item); else S.queue.push(item);
    queueMicrotask(pump);
  }

  function markDone(el) {
  el.setAttribute('data-edutrans-id', String(++S.seq));
}

  function live(runId) { return S.active && runId === S.runId; }

  function matchesItem(it) {
  return !it.cancelled && it.el.isConnected && it.marker === it.el.getAttribute('data-edutrans-id') &&
    textOf(it.el) === it.text;
}

  function currentEngine() {
    return S.settings.engines[S.engineId || S.settings.defaultEngineId];
  }

  function viewportRank(el) {
    const r = el.getBoundingClientRect(), height = innerHeight || document.documentElement.clientHeight;
    if (r.bottom >= 0 && r.top <= height) return 0;
    if (r.top > height) return 1 + (r.top - height) / Math.max(1, height);
    return 4 + Math.abs(r.bottom) / Math.max(1, height);
  }

  function byOrder(a, b) {
    const delta = viewportRank(a.el) - viewportRank(b.el);
    if (Math.abs(delta) > 0.1) return delta;
    if (b.prio !== a.prio) return b.prio - a.prio;
    return (a.el.compareDocumentPosition(b.el) & 4) ? -1 : 1;
  }

  function secondaryEngineId() {
    return S.settings.engines.device ? 'device' : null;
  }

  function joinerFor(lang) {
    return (lang === 'zh-CN' || lang === 'zh-TW' ||
      lang === 'ja') ? '' : ' ';
  }

  function splitSentences(text, maxLen) {
  text = String(text);
  maxLen = Math.max(16, maxLen || 280);
  let sentences;
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    sentences = Array.from(new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text), x => x.segment);
  } else {
    sentences = text.match(/[\s\S]+?(?:[.!?]+(?=\s|$)|[。！？]+|$)/g) || [text];
  }
  const chunks = [];
  for (let sentence of sentences) {
    while (sentence.length > maxLen) {
      let boundary = sentence.lastIndexOf(' ', maxLen - 1);
      boundary = boundary >= Math.floor(maxLen / 2) ? boundary + 1 : maxLen;
      const char = sentence.charCodeAt(boundary - 1);
      if (char >= 0xd800 && char <= 0xdbff) boundary--;
      chunks.push(sentence.slice(0, boundary));
      sentence = sentence.slice(boundary);
    }
    if (sentence) chunks.push(sentence);
  }
  return chunks.length ? chunks : [text];
}

  async function translateVia(texts, engineId, partialState, onProgress, priorityHint, deferDeviceRepair) {
  const requestRun = S.runId;
  const engineKey = engineId || S.engineId || S.settings.defaultEngineId;
  const engine = S.settings.engines[engineKey];
  if (!engine) throw new Error('所选翻译服务不可用，请检查设置。');
  const flat = [], ranges = [];
  texts.forEach(text => {
    const chunks = splitSentences(text, 280);
    ranges.push({ start: flat.length, count: chunks.length, src: text });
    flat.push(...chunks);
  });
  const translated = partialState ? [...(partialState.texts || [])] : [], models = new Set(partialState?.models || []);
  const qualityCtx = { targetLang: S.settings.targetLang, terms: S.settings.terms || [] };
  const policy = Object.assign({}, S.settings.translationPipeline || {}, { terms: S.settings.terms || [] });
  const routingHint = EduTransQuality.classify(texts.join(' '), policy);
  let tail = S.lastTail || null;
  for (let start = translated.length; start < flat.length;) {
    if (!live(requestRun)) throw new Error('翻译已停止');
    let end = start, chars = 0;
    while (end < flat.length && end - start < 4 && chars + flat[end].length <= 900) {
      chars += flat[end++].length;
    }
    if (end === start) end++;
    const batch = flat.slice(start, end);
    let response = engine.type === 'device'
      ? { ok: true, texts: await deviceTranslate(batch, S.settings.targetLang) }
      : await chrome.runtime.sendMessage({ type: 'TRANSLATE_BATCH', runId: requestRun, engineId: engineKey, texts: batch,
        ctx: { title: document.title, url: location.href, tail, routingHint, priority: onProgress ? viewportRank(partialState.el) * 10 + 4 - (partialState.el.__etPrio || 1) : Number(priorityHint) || 0 } });
    if (response && !response.ok && response.quality && engine.type === 'openai' && policy.enabled !== false &&
        Array.isArray(response.partial) && response.partial.length === batch.length) {
      // The cloud already retried these sentences. A ready local reviewer only fills the failed positions.
      const partial = response.partial.slice();
      const failed = batch.map((text, i) => EduTransQuality.inspect(text, partial[i], qualityCtx).ok ? -1 : i).filter(i => i >= 0);
      if (failed.length) {
        try {
          const local = await deviceTranslate(failed.map(i => batch[i]), S.settings.targetLang);
          failed.forEach((index, i) => {
            const check = EduTransQuality.inspect(batch[index], local[i], qualityCtx);
            if (!check.ok) throw new Error(check.reason);
            partial[index] = local[i];
          });
          response = { ok: true, texts: partial, models: [...(response.models || [engine.model || engineKey]), 'local-review'] };
        } catch (_) { /* Keep the original visible failure when local review is unavailable or inadequate. */ }
      }
    }
    if (!response || !response.ok) {
      throw new Error((response && response.error) || '翻译请求失败，请重试。');
    }
    if (!Array.isArray(response.texts) || response.texts.length !== batch.length ||
        response.texts.some(text => typeof text !== 'string' || !text.trim())) {
      throw new Error('翻译结果不完整，请重试。');
    }
    const bad = batch.map((text, i) => EduTransQuality.inspect(text, response.texts[i], qualityCtx).ok ? -1 : i).filter(i => i >= 0);
    if (bad.length && engine.type === 'device') {
      if (deferDeviceRepair) throw new Error('本地译文尚未通过：' + EduTransQuality.inspect(batch[bad[0]], response.texts[bad[0]], qualityCtx).reason);
      const primary = S.engineId || S.settings.defaultEngineId;
      if (S.settings.engines[primary]?.type === 'device') throw new Error('本地译文有漏译，请配置大模型补译');
      const repair = await chrome.runtime.sendMessage({ type: 'TRANSLATE_BATCH', runId: requestRun, engineId: primary, texts: bad.map(i => batch[i]), ctx: { title: document.title, url: location.href, tail, routingHint: 'review' } });
      if (!repair || !repair.ok || !Array.isArray(repair.texts) || repair.texts.length !== bad.length) throw new Error('本地译文补译失败，请重试');
      bad.forEach((index, i) => { response.texts[index] = repair.texts[i]; });
      (repair.models || [S.settings.engines[primary].model || primary]).forEach(model => models.add(model));
    }
    batch.forEach((text, i) => { const check = EduTransQuality.inspect(text, response.texts[i], qualityCtx); if (!check.ok) throw new Error(check.reason); });
    if (engine.type === 'device') { if (bad.length < batch.length) models.add('local'); }
    else (response.models || [engine.model || engineKey]).forEach(model => models.add(model));
    translated.push(...response.texts);
    tail = { src: batch[batch.length - 1].slice(0, 200), zh: response.texts[batch.length - 1].slice(0, 300) };
    start = end;
    if (!live(requestRun)) throw new Error('翻译已停止');
    if (partialState) { partialState.texts = [...translated]; partialState.models = [...models]; }
    if (onProgress && start < flat.length) onProgress(translated.join(joinerFor(S.settings.targetLang)), [...models]);
  }
  const result = ranges.map(range => {
    const text = translated.slice(range.start, range.start + range.count).join(joinerFor(S.settings.targetLang));
    const srcLength = range.src.replace(/\s/g, '').length;
    if (range.count >= 3 && srcLength > 400 && text.replace(/\s/g, '').length < srcLength * 0.18) {
      throw new Error('这一段的译文明显过短，请重试完整翻译。');
    }
    return text;
  });
  return { ok: true, texts: result, models: [...models] };
}

  async function dispatchMain(batch, runId) {
  try {
    const texts = batch.map(it => it.text);
    const item = batch[0];
    item.partial = item.partial || { texts: [], models: [], el: item.el };
    const response = await translateVia(texts, S.engineId || null, item.partial, (prefix, models) => {
      if (!live(runId) || !matchesItem(item)) return;
      inject(item.el, prefix);
      item.el.__etTarget.setAttribute('data-edutrans-partial', 'true');
      item.el.__etTarget.setAttribute('data-edutrans-models', models.join(', '));
      item.el.__etTarget.setAttribute('aria-busy', 'true');
    });
    if (!live(runId)) return;
    batch.forEach((it, index) => {
      if (!matchesItem(it)) { if (!it.cancelled) S.stats.total--; return; }
      inject(it.el, response.texts[index]);
      if (it.el.__etTarget) it.el.__etTarget.setAttribute('data-edutrans-models', (response.models || []).join(', '));
      if (it.el.__etTarget) { it.el.__etTarget.setAttribute('aria-busy', 'false'); it.el.__etTarget.setAttribute('data-edutrans-completed-ms', String(Math.round(performance.now() - it.startedAt))); }
      it.el.__etPhase = 'done';
      S.stats.done++;
    });
    if (texts.length) S.lastTail = { src: texts[texts.length - 1].slice(0, 200),
      zh: response.texts[response.texts.length - 1].slice(0, 300) };
  } catch (error) {
    if (!live(runId)) return;
    failBatch(batch, String(error.message || error));
    showError(String(error.message || error));
  }
}

  async function dispatchLite(batch, runId) {
  const secondary = secondaryEngineId();
  for (const it of batch) {
    if (!live(runId)) return;
    try {
      const priority = viewportRank(it.el) * 10 + 4 - (it.prio || 1);
      const response = await translateVia([it.text], secondary, null, null, priority, true);
      if (!live(runId)) return;
      if (!matchesItem(it)) { if (!it.cancelled) S.stats.total--; continue; }
      inject(it.el, response.texts[0]);
      if (it.el.__etTarget) it.el.__etTarget.setAttribute('data-edutrans-models', (response.models || []).join(', '));
      if (it.el.__etTarget) { it.el.__etTarget.setAttribute('aria-busy', 'false'); it.el.__etTarget.setAttribute('data-edutrans-completed-ms', String(Math.round(performance.now() - it.startedAt))); }
      it.el.__etPhase = 'done';
      S.stats.done++;
      updateProgress();
    } catch (error) {
      if (!live(runId)) return;
      const primary = S.engineId || S.settings.defaultEngineId;
      if (secondary && secondary !== primary) {
        // A bad local item goes to the cloud queue alone; other local items keep rendering.
        S.queue.push(it); pump();
      } else {
        failBatch([it], String(error.message || error));
        showError(String(error.message || error));
      }
    }
  }
}

  function pump() {
  if (!S.active) return;
  const runId = S.runId;
  if (S.queue.length && S.inflight < Math.max(1, Math.min(4, (S.settings.translationPipeline || {}).accountConcurrency || 2))) {
    S.queue.sort(byOrder);
    // Complete and render one paragraph without waiting for unrelated paragraphs.
    const batch = S.queue.splice(0, 1);
    S.inflight++;
    dispatchMain(batch, runId).finally(() => {
      if (!live(runId)) return;
      S.inflight = Math.max(0, S.inflight - 1);
      updateProgress(); pump();
    });
  }
  if (S.lite.length && S.liteInflight < 1) {
    S.lite.sort(byOrder);
    const batch = S.lite.splice(0, 12);
    S.liteInflight++;
    dispatchLite(batch, runId).finally(() => {
      if (!live(runId)) return;
      S.liteInflight = Math.max(0, S.liteInflight - 1);
      updateProgress(); pump();
    });
  }
}

  function observeChanges(runId) {
  if (typeof MutationObserver === 'undefined' || !document.body) return;
  let queued = false;
  S.mo = new MutationObserver(records => {
    let changed = false;
    records.forEach(record => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (target && target.closest('.edutrans-ui')) return;
      const source = target && target.closest(BLOCK_SEL);
      if (source && source.hasAttribute('data-edutrans-id') && source.__etSource !== textOf(source)) {
        if (source.__etPhase === 'done') S.stats.done--;
        if (source.__etPhase === 'fail') S.stats.fail--;
        S.stats.total--;
        if (source.__etItem) source.__etItem.cancelled = true;
        source.removeAttribute('data-edutrans-id');
        dropSkeleton(source);
        if (source.__etTarget) source.__etTarget.remove();
        source.__etPhase = null;
      }
      if (record.type === 'characterData') { changed = true; return; }
      const nodes = [...record.addedNodes, ...record.removedNodes];
      if (nodes.some(node => node.nodeType !== 1 || !node.classList.contains('edutrans-ui'))) changed = true;
    });
    if (!changed || queued || !live(runId)) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!live(runId)) return;
      S.mainRoot = undefined;
      collectParas().forEach(el => ensureObserver().observe(el));
    });
  });
  S.mo.observe(document.body, { childList: true, characterData: true, subtree: true });
}

  async function start() {
  if (S.active) return;
  const runId = ++S.runId;
  S.active = true;
  S.queue = []; S.lite = []; S.inflight = 0; S.liteInflight = 0;
  S.stats = { total: 0, done: 0, fail: 0 };
  try {
    const settings = await EduTransCommon.getSettings();
    if (!live(runId)) return;
    S.settings = settings;
    if (inBlacklist()) { stop(); toast(EduTransI18n.content.blacklist, true); return; }
    S.mode = S.settings.mode || 'bilingual';
    S.mainRoot = undefined;
    collectParas().forEach(el => ensureObserver().observe(el));
    observeChanges(runId);
  } catch (error) {
    if (!live(runId)) return;
    stop(); showError(String(error.message || error));
  }
}

  function stop() {
  const cancelledRun = S.runId;
  S.active = false; S.runId++;
  Promise.resolve(chrome.runtime.sendMessage({ type: 'CANCEL_TRANSLATIONS', runId: cancelledRun })).catch(() => {});
  if (S.io) S.io.disconnect(); S.io = null;
  if (S.mo) S.mo.disconnect(); S.mo = null;
  S.queue = []; S.lite = []; S.inflight = 0; S.liteInflight = 0;
  S.stats = { total: 0, done: 0, fail: 0 }; S.lastTail = null; S.mainRoot = undefined;
  const progress = document.getElementById('edutrans-progress');
  if (progress && progress.__fadeTimer) clearTimeout(progress.__fadeTimer);
  document.querySelectorAll('.edutrans-target,.edutrans-skeleton,#edutrans-progress,#edutrans-error-pill')
    .forEach(el => el.remove());
  document.querySelectorAll('[data-edutrans-id]').forEach(el => el.removeAttribute('data-edutrans-id'));
}

  function toggle() {
    if (S.active) stop(); else start();
  }

  function toast(msg, isErr) {
    const t = document.createElement('div');
    t.className = 'edutrans-ui edutrans-toast';
    if (isErr) t.classList.add('edutrans-err');
    t.textContent = msg;
    document.documentElement.appendChild(t);
    setTimeout(function () { t.remove(); }, 4000);
  }

  function showError(msg) {
    let pill = document.getElementById('edutrans-error-pill');
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'edutrans-error-pill';
      pill.className = 'edutrans-ui edutrans-pill';
      const m = document.createElement('span');
      m.className = 'edutrans-ui edutrans-pill-msg';
      const retry = document.createElement('button');
      retry.className = 'edutrans-ui edutrans-mini';
      retry.textContent = EduTransI18n.content.retry;
      retry.addEventListener('click', async function () {
        pill.remove();
        retryFailed();
      });
      pill.appendChild(m);
      pill.appendChild(retry);
      document.documentElement.appendChild(pill);
    }
    const m = pill.querySelector('.edutrans-pill-msg');
    m.textContent = EduTransI18n.content.failed + ': ' + msg;
  }

  let bubble = null;

  function closeBubble() {
    if (bubble) {
      bubble.remove();
      bubble = null;
    }
  }

  function positionBubble(rect) {
    if (!bubble || !rect) return;
    const bw = bubble.offsetWidth || 260;
    const bh = bubble.offsetHeight || 70;
    let x = 24;
    let y = 24;
    if (typeof rect.left === 'number') {
      x = Math.min(Math.max(8, rect.left), window.innerWidth - bw - 8);
      y = rect.bottom + 8;
      if (y + bh > window.innerHeight - 8) {
        y = Math.max(8, rect.top - bh - 8);
      }
    }
    bubble.style.left = x + 'px';
    bubble.style.top = y + 'px';
  }

  function renderResult(text, resp) {
    if (!bubble) return;
    bubble.textContent = '';
    const src = document.createElement('div');
    src.className = 'edutrans-ui edutrans-src';
    src.textContent = text.length > 120 ? text.slice(0, 120) + '…' : text;
    bubble.appendChild(src);
    const out = document.createElement('div');
    out.className = 'edutrans-ui edutrans-out';
    if (resp && resp.ok) {
      out.textContent = resp.texts[0] || '-';
    } else {
      out.textContent = (resp && resp.error) || EduTransI18n.content.failed;
      out.classList.add('edutrans-err');
    }
    bubble.appendChild(out);
    if (resp && resp.ok) {
      const row = document.createElement('div');
      row.className = 'edutrans-ui edutrans-row';
      const save = document.createElement('button');
      const copy = document.createElement('button');
      save.className = 'edutrans-ui edutrans-mini';
      copy.className = 'edutrans-ui edutrans-mini';
      save.textContent = EduTransI18n.content.collect;
      copy.textContent = EduTransI18n.content.copy;
      save.addEventListener('click', async function () {
        const s = await EduTransCommon.getSettings();
        s.vocab.unshift({
          source: text,
          translation: resp.texts[0] || '',
          url: location.href,
          title: document.title,
          ts: Date.now()
        });
        if (s.vocab.length > 2000) s.vocab.length = 2000;
        await EduTransCommon.saveSettings(s);
        save.textContent = EduTransI18n.content.collected;
        save.disabled = true;
      });
      copy.addEventListener('click', function () {
        navigator.clipboard.writeText(resp.texts[0] || '');
        copy.textContent = EduTransI18n.content.copied;
      });
      row.appendChild(save);
      row.appendChild(copy);
      bubble.appendChild(row);
    }
  }

  document.addEventListener('mouseup', function (ev) {
    if (bubble && bubble.contains(ev.target)) return;
    const sel = window.getSelection();
    const text = sel ? String(sel).trim() : '';
    if (!S.settings || !S.settings.selectionTranslate ||
        text.length < 2 || text.length > 1000 || !foreignEnough(text)) {
      closeBubble();
      return;
    }
    let rect = null;
    try {
      rect = sel.getRangeAt(0).getBoundingClientRect();
    } catch (e) {
      closeBubble();
      return;
    }
    closeBubble();
    bubble = document.createElement('div');
    bubble.className = 'edutrans-ui edutrans-bubble';
    const btn = document.createElement('button');
    btn.className = 'edutrans-ui edutrans-bubble-btn';
    btn.textContent = EduTransI18n.content.translateBtn;
    btn.addEventListener('click', async function () {
      btn.textContent = EduTransI18n.content.translating;
      btn.disabled = true;
      const resp = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_BATCH',
        texts: [text],
        ctx: { title: document.title, url: location.href }
      }).catch(function (e) {
        return { ok: false, error: String((e && e.message) || e) };
      });
      renderResult(text, resp);
    });
    bubble.appendChild(btn);
    document.documentElement.appendChild(bubble);
    positionBubble(rect);
  });

  document.addEventListener('mousedown', function (ev) {
    if (bubble && !bubble.contains(ev.target)) closeBubble();
  }, true);

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeBubble();
  });

  async function showSelectionTranslation(text) {
    closeBubble();
    bubble = document.createElement('div');
    bubble.className = 'edutrans-ui edutrans-bubble';
    bubble.textContent = EduTransI18n.content.translating;
    document.documentElement.appendChild(bubble);
    positionBubble({ left: 24, bottom: 24, top: 24 });
    const resp = await chrome.runtime.sendMessage({
      type: 'TRANSLATE_BATCH',
      texts: [text],
      ctx: { title: document.title, url: location.href }
    }).catch(function (e) {
      return { ok: false, error: String((e && e.message) || e) };
    });
    renderResult(text, resp);
  }

  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'TOGGLE_PAGE') toggle();
    if (msg.type === 'GET_STATE') return { active: S.active };
    if (msg.type === 'MODE_CHANGED' && msg.mode) {
      S.mode = msg.mode;
      document.querySelectorAll('.edutrans-target').forEach(function (n) {
        n.classList.toggle('edutrans-bilingual', S.mode === 'bilingual');
      });
    }
    if (msg.type === 'TRANSLATE_SELECTION' && msg.text) {
      showSelectionTranslation(msg.text);
    }
  });

  (async function init() {
    S.settings = await EduTransCommon.getSettings();
    const prefs = S.settings.sitePrefs || {};
    const pref = prefs[location.hostname];
    if (pref && pref.enabled) {
      S.engineId = pref.engineId || null;
      await start();
    }
  })();


  const deviceCache = { key: '', translator: null };

  async function getDeviceTranslator(targetLang, sample) {
    let src = 'en';
    try {
      if (window.LanguageDetector && (!LanguageDetector.availability || await LanguageDetector.availability() === 'available')) {
        const det = await LanguageDetector.create();
        const res = await det.detect(sample || 'hello world');
        if (res && res[0] && res[0].detectedLanguage) {
          src = res[0].detectedLanguage;
        }
      }
    } catch (e) { /* fallback to en */ }
    if (src === 'und' || !src) src = 'en';
    const key = src + '>' + targetLang;
    if (deviceCache.key === key && deviceCache.translator) {
      return deviceCache.translator;
    }
    if (!window.Translator) {
      throw new Error(EduTransI18n.content.deviceOld);
    }
    let avail = 'available';
    try {
      avail = await Translator.availability({
        sourceLanguage: src,
        targetLanguage: targetLang
      });
    } catch (e) { /* assume available */ }
    if (avail !== 'available' && currentEngine()?.type !== 'device') throw new Error('本地语言包未就绪，改用所选翻译服务');
    if (avail === 'unavailable') {
      throw new Error(EduTransI18n.content.devicePair);
    }
    deviceCache.translator = await Translator.create({
      sourceLanguage: src,
      targetLanguage: targetLang
    });
    deviceCache.key = key;
    return deviceCache.translator;
  }

  let deviceTail = Promise.resolve();
  async function deviceTranslate(texts, targetLang) {
    const sample = texts.slice(0, 3).join(' ').slice(0, 300);
    const tr = await getDeviceTranslator(targetLang, sample);
    const out = new Array(texts.length);
    let idx = 0;
    const workers = [];
    const conc = 1;
    for (let w = 0; w < conc; w++) {
      workers.push((async function () {
        while (idx < texts.length) {
          const i = idx++;
          out[i] = await (async function () { const pending = deviceTail.then(async () => {
            const controller = new AbortController(); let timer;
            try { return await Promise.race([tr.translate(texts[i], { signal: controller.signal }), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('本地翻译超时')); }, 5000); })]); }
            finally { clearTimeout(timer); }
          }); deviceTail = pending.catch(() => {}); return pending; })();
        }
      })());
    }
    await Promise.all(workers);
    return out;
  }

  let hoverTimer = null;

  function paraLike(el) {
    if (!el || !el.matches) return null;
    const t = el.closest(BLOCK_SEL);
    if (!t) return null;
    if (t.closest(SKIP_SEL)) return null;
    if (t.closest('button, label, select, a[href]')) return null;
    if (t.closest('.edutrans-ui')) return null;
    if (hasBlockChild(t)) return null;
    return t;
  }

  function hoverOk(t) {
    if (!S.settings || !S.settings.hoverTranslate) return false;
    if (!t || t.hasAttribute('data-edutrans-id')) return false;
    const text = textOf(t);
    if (text.length < MIN_LEN || text.length > 800) return false;
    return foreignEnough(text);
  }

  document.addEventListener('mouseover', function (ev) {
    if (!ev.ctrlKey && !ev.metaKey) return;
    if (hoverTimer) return;
    hoverTimer = setTimeout(function () { hoverTimer = null; }, 600);
    const t = paraLike(ev.target);
    if (!hoverOk(t)) return;
    translateAt(textOf(t), t.getBoundingClientRect());
  });

  async function translateAt(text, rect) {
    closeBubble();
    bubble = document.createElement('div');
    bubble.className = 'edutrans-ui edutrans-bubble';
    bubble.textContent = EduTransI18n.content.translating;
    document.documentElement.appendChild(bubble);
    positionBubble(rect);
    const resp = await chrome.runtime.sendMessage({
      type: 'TRANSLATE_BATCH',
      texts: [text],
      ctx: { title: document.title, url: location.href }
    }).catch(function (e) {
      return { ok: false, error: String((e && e.message) || e) };
    });
    renderResult(text, resp);
    positionBubble(rect);
  }

  const inputOrig = new WeakMap();
  let inputBtn = null;

  function hideInputBtn() {
    if (inputBtn) {
      inputBtn.remove();
      inputBtn = null;
    }
  }

  function setInputValue(input, v) {
    const proto = input.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function makeInputBtn(input) {
    hideInputBtn();
    const r = input.getBoundingClientRect();
    inputBtn = document.createElement('button');
    inputBtn.className = 'edutrans-ui edutrans-inputbtn';
    inputBtn.textContent = EduTransI18n.content.translateBtn;
    inputBtn.style.left = Math.max(8, r.right - 36) + 'px';
    inputBtn.style.top = Math.max(8, r.top - 16) + 'px';
    inputBtn.addEventListener('mousedown', function (e) {
      e.preventDefault();
    });
    inputBtn.addEventListener('click', async function () {
      const original = inputOrig.get(input);
      if (typeof original === 'string') {
        setInputValue(input, original);
        inputOrig.delete(input);
        hideInputBtn();
        return;
      }
      const val = String(input.value || '');
      if (!val.trim()) return;
      inputBtn.textContent = '…';
      const resp = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_BATCH',
        texts: [val],
        ctx: { title: document.title, url: location.href }
      }).catch(function (e) {
        return { ok: false, error: String((e && e.message) || e) };
      });
      if (resp && resp.ok && resp.texts[0]) {
        inputOrig.set(input, val);
        setInputValue(input, resp.texts[0]);
        inputBtn.textContent = EduTransI18n.content.inputRestore;
      } else {
        inputBtn.textContent = EduTransI18n.content.translateBtn;
      }
    });
    document.documentElement.appendChild(inputBtn);
  }

  document.addEventListener('focusin', function (ev) {
    hideInputBtn();
    if (!S.settings || !S.settings.inputTranslate) return;
    const t = ev.target;
    if (!t || !t.matches) return;
    let isText = false;
    if (t.tagName === 'TEXTAREA') isText = true;
    if (t.tagName === 'INPUT') {
      if (t.type === 'text' || t.type === 'url') isText = true;
    }
    if (!isText) return;
    if (t.closest('.edutrans-ui')) return;
    const val = String(t.value || '');
    if (val.trim().length < 4 || !foreignEnough(val)) return;
    makeInputBtn(t);
  });

  let summaryPanel = null;
  let lastSummary = null;

  function closeSummary() {
    if (summaryPanel) {
      summaryPanel.remove();
      summaryPanel = null;
    }
  }

  function collectPageText() {
    const parts = [];
    document.querySelectorAll(
      'p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th'
    ).forEach(function (el) {
      if (el.closest(SKIP_SEL)) return;
      if (el.closest('.edutrans-ui')) return;
      if (el.closest('nav, header, footer')) return;
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (t.length > 12) parts.push(t);
    });
    return parts.join('\n').slice(0, 12000);
  }

  function ensureSummaryPanel() {
    if (summaryPanel) return summaryPanel;
    summaryPanel = document.createElement('div');
    summaryPanel.className = 'edutrans-ui edutrans-summary';
    const head = document.createElement('div');
    head.className = 'edutrans-ui edutrans-sum-head';
    const title = document.createElement('strong');
    title.textContent = EduTransI18n.content.summaryTitle;
    const close = document.createElement('button');
    close.className = 'edutrans-ui edutrans-mini';
    close.textContent = '×';
    close.addEventListener('click', closeSummary);
    head.appendChild(title);
    head.appendChild(close);
    const body = document.createElement('div');
    body.className = 'edutrans-ui edutrans-sum-body';
    body.textContent = EduTransI18n.content.summarizing;
    summaryPanel.appendChild(head);
    summaryPanel.appendChild(body);
    document.documentElement.appendChild(summaryPanel);
    return summaryPanel;
  }

  async function runSummary() {
    const panel = ensureSummaryPanel();
    const body = panel.querySelector('.edutrans-sum-body');
    body.classList.remove('edutrans-err');
    if (lastSummary) {
      body.textContent = lastSummary;
      return;
    }
    body.textContent = EduTransI18n.content.summarizing;
    const text = collectPageText();
    if (!text) {
      body.textContent = EduTransI18n.content.noText;
      return;
    }
    const resp = await chrome.runtime.sendMessage({
      type: 'SUMMARIZE',
      text: text,
      title: document.title
    }).catch(function (e) {
      return { ok: false, error: String((e && e.message) || e) };
    });
    if (resp && resp.ok) {
      lastSummary = resp.summary;
      body.textContent = resp.summary;
      return;
    }
    body.classList.add('edutrans-err');
    const err = resp && resp.error;
    body.textContent = err === 'NO_AI_ENGINE'
      ? EduTransI18n.content.noAi
      : ((resp && resp.error) || EduTransI18n.content.failed);
  }

  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === 'SHOW_SUMMARY') runSummary();
  });
  self.EduTransSplit = {
    splitSentences: splitSentences,
    joinerFor: joinerFor
  };

  function addSkeleton(el, len) {
    if (el.__etSk && el.__etSk.isConnected) return;
    const sk = document.createElement('div');
    sk.className = 'edutrans-ui edutrans-skeleton';
    const lines = Math.max(1, Math.min(6, Math.ceil(len / 70)));
    sk.style.height = 'calc(' + lines + ' * 1.55em)';
    el.insertAdjacentElement('afterend', sk);
    el.__etSk = sk;
  }

  function dropSkeleton(el) {
    if (el.__etSk) {
      el.__etSk.remove();
      el.__etSk = null;
    }
  }

  function retryItems(items) {
    if (!S.active) return;
    for (const it of items) {
      if (!matchesItem(it) || it.el.__etPhase !== 'fail') continue;
      S.stats.fail--; it.el.__etPhase = 'queued';
      dropSkeleton(it.el);
      if (!it.el.__etTarget) addSkeleton(it.el, it.len);
      if (it.el.__etTarget) it.el.__etTarget.setAttribute('aria-busy', 'true');
      (it.tier === 'local' ? S.lite : S.queue).push(it);
    }
    updateProgress(); pump();
  }

  function retryFailed() {
    retryItems(Array.from(document.querySelectorAll('[data-edutrans-id]')).map(el => el.__etItem).filter(Boolean));
  }

  function failBatch(batch, reason) {
    S.stats = S.stats || { total: 0, done: 0, fail: 0 };
    batch.forEach(it => {
      if (!matchesItem(it)) { if (!it.cancelled) S.stats.total--; return; }
      if (!it.el.__etSk || !it.el.__etSk.isConnected) {
        const sk = document.createElement('div'); sk.className = 'edutrans-ui edutrans-skeleton';
        (it.el.__etTarget || it.el).insertAdjacentElement('afterend', sk); it.el.__etSk = sk;
      }
      const sk = it.el.__etSk;
      sk.classList.add('edutrans-sk-err'); sk.style.height = 'auto';
      sk.textContent = '本段未完成：' + (reason || '翻译失败');
      sk.setAttribute('role', 'status');
      const retry = document.createElement('button'); retry.className = 'edutrans-ui edutrans-mini';
      retry.textContent = '重试本段'; retry.addEventListener('click', () => retryItems([it])); sk.appendChild(retry);
      if (it.el.__etTarget) it.el.__etTarget.setAttribute('aria-busy', 'false');
      S.stats.fail++; it.el.__etPhase = 'fail';
    });
    updateProgress();
  }

  function ensureProgress() {
    let p = document.getElementById('edutrans-progress');
    if (!p) {
      p = document.createElement('div');
      p.id = 'edutrans-progress';
      p.className = 'edutrans-ui';
      const txt = document.createElement('span');
      txt.className = 'edutrans-ui edutrans-prog-txt';
      const bar = document.createElement('div');
      bar.className = 'edutrans-ui edutrans-prog-bar';
      const fill = document.createElement('div');
      fill.className = 'edutrans-ui edutrans-prog-fill';
      bar.appendChild(fill);
      p.appendChild(txt);
      p.appendChild(bar);
      document.documentElement.appendChild(p);
    }
    return p;
  }

  function updateProgress() {
  const stats = S.stats || { total: 0, done: 0, fail: 0 };
  if (!stats.total) return;
  if (!stats.fail) document.getElementById('edutrans-error-pill')?.remove();
  const progress = ensureProgress(), text = progress.querySelector('.edutrans-prog-txt');
  const fill = progress.querySelector('.edutrans-prog-fill');
  const settled = stats.done + stats.fail;
  if (!text || !fill) return;
  fill.style.width = Math.round(100 * settled / stats.total) + '%';
  const complete = settled >= stats.total && !S.inflight && !S.liteInflight && !S.queue.length && !S.lite.length;
  progress.classList.toggle('edutrans-prog-done', complete && !stats.fail);
  text.textContent = complete
    ? (stats.fail ? '已翻译 ' + stats.done + '/' + stats.total + ' 段，失败 ' + stats.fail + ' 段' : '✓ 翻译完成 ' + stats.done + ' 段')
    : '译中 ' + stats.done + '/' + stats.total + (stats.fail ? '（失败 ' + stats.fail + '）' : '');
  if (progress.__fadeTimer) { clearTimeout(progress.__fadeTimer); progress.__fadeTimer = null; }
  if (complete && !stats.fail) {
    progress.__fadeTimer = setTimeout(() => progress.remove(), 2400);
  }
}
})();
