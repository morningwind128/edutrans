// EduTrans options page controller - part 1.
(function () {
  'use strict';

  let settings = null;
  let editingId = null;

  const $ = function (id) { return document.getElementById(id); };

  function tagChip(text, cls) {
    const s = document.createElement('span');
    s.className = 'chip ' + cls;
    s.textContent = text;
    return s;
  }

  function engineName(id, eng) {
    const O = EduTransI18n.options;
    if (eng.type === 'device') return O.engineDevice;
    if (eng.type === 'google') return O.engineGoogle;
    if (eng.type === 'microsoft') return O.engineMs;
    return eng.name || id;
  }

  function engineRow(id, eng) {
    const row = document.createElement('label');
    row.className = 'engine-card' +
      (settings.defaultEngineId === id ? ' active' : '');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'default-engine';
    radio.checked = settings.defaultEngineId === id;
    radio.addEventListener('change', async function () {
      if (!radio.checked) return;
      settings.defaultEngineId = id;
      settings.defaultEngineExplicit = true;
      await EduTransCommon.saveSettings(settings);
      renderEngines();
    });
    row.appendChild(radio);
    const name = document.createElement('span');
    name.className = 'eng-name';
    name.textContent = engineName(id, eng);
    row.appendChild(name);
    if (eng.type === 'openai') {
      row.appendChild(tagChip(EduTransI18n.options.tagAI, 'chip-ai'));
    }
    if (eng.type === 'device') {
      row.appendChild(tagChip(EduTransI18n.options.tagOffline, 'chip-ok'));
    }
    if (eng.type === 'google' || eng.type === 'microsoft') {
      row.appendChild(tagChip(EduTransI18n.options.tagFree, 'chip-free'));
    }
    if (settings.defaultEngineId === id) {
      row.appendChild(tagChip(EduTransI18n.options.tagDefault, 'chip-def'));
    }
    const ops = document.createElement('span');
    ops.className = 'engine-ops';
    if (eng.type === 'openai') {
      const edit = document.createElement('button');
      edit.textContent = EduTransI18n.options.edit;
      edit.addEventListener('click', function (e) {
        e.preventDefault();
        openForm(id);
      });
      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = EduTransI18n.options.del;
      del.addEventListener('click', async function (e) {
        e.preventDefault();
        if (!confirm(EduTransI18n.options.delConfirm)) return;
        delete settings.engines[id];
        if (settings.defaultEngineId === id) {
          settings.defaultEngineId = 'device';
        }
        await EduTransCommon.saveSettings(settings);
        renderEngines();
      });
      ops.appendChild(edit);
      ops.appendChild(del);
    }
    row.appendChild(ops);
    return row;
  }

  function renderEngines() {
    const box = $('engine-list');
    box.textContent = '';
    EduTransCommon.engineOrder(settings).forEach(function (id) {
      box.appendChild(engineRow(id, settings.engines[id]));
    });
    updateCfgStatus();
  }

  function openForm(id) {
    editingId = id || null;
    const eng = id ? settings.engines[id] : null;
    $('ef-name').value = eng ? eng.name : '';
    $('ef-baseurl').value = eng ? (eng.baseUrl || '') : '';
    $('ef-apikey').value = eng ? (eng.apiKey || '') : '';
    $('ef-model').value = eng ? (eng.model || '') : '';
    $('ef-morekeys').value = eng && Array.isArray(eng.apiKeys) ? eng.apiKeys.filter(k => k !== eng.apiKey).join('\n') : '';
    $('ef-account').value = eng ? (eng.quotaGroup || '') : '';
    $('ef-role').value = eng ? (eng.translationRole || 'off') : 'off';
    $('ef-temp').value = eng && typeof eng.temperature === 'number'
      ? eng.temperature : 0.1;
    $('ef-sysprompt').value = eng ? (eng.systemPrompt || '') : '';
    $('engine-form').classList.remove('hidden');
    $('ef-test-out').textContent = '';
  }

  function closeForm() {
    $('engine-form').classList.add('hidden');
    editingId = null;
  }

  async function saveForm() {
    const baseUrl = $('ef-baseurl').value.trim();
    if (!baseUrl) {
      alert(EduTransI18n.options.needUrl);
      return;
    }
    const eng = {
      id: editingId || ('ai-' + Date.now().toString(36)),
      type: 'openai',
      name: $('ef-name').value.trim() || 'Custom AI',
      baseUrl: baseUrl,
      apiKey: $('ef-apikey').value.trim(),
      apiKeys: [...new Set(($('ef-morekeys').value || '').split(/[\s,;]+/).filter(Boolean))],
      quotaGroup: $('ef-account').value.trim(),
      translationRole: $('ef-role').value || 'off',
      model: $('ef-model').value.trim(),
      temperature: parseFloat($('ef-temp').value),
      systemPrompt: $('ef-sysprompt').value.trim()
    };
    settings.engines[eng.id] = eng;
    await EduTransCommon.saveSettings(settings);
    closeForm();
    renderEngines();
  }

  async function testForm() {
    const out = $('ef-test-out');
    out.classList.remove('err');
    out.textContent = EduTransI18n.options.testing;
    const eng = {
      type: 'openai',
      baseUrl: $('ef-baseurl').value.trim(),
      apiKey: $('ef-apikey').value.trim(),
      apiKeys: [...new Set(($('ef-morekeys').value || '').split(/[\s,;]+/).filter(Boolean))],
      quotaGroup: $('ef-account').value.trim(),
      translationRole: $('ef-role').value || 'off',
      model: $('ef-model').value.trim(),
      temperature: parseFloat($('ef-temp').value),
      systemPrompt: $('ef-sysprompt').value.trim()
    };
    const resp = await chrome.runtime.sendMessage({
      type: 'TEST_ENGINE',
      engine: eng
    }).catch(function (e) {
      return { ok: false, error: String((e && e.message) || e) };
    });
    if (resp && resp.ok) {
      out.textContent = EduTransI18n.options.testOk + ' ' + resp.texts[0];
    } else {
      out.classList.add('err');
      out.textContent = EduTransI18n.options.testFail + ' ' +
        ((resp && resp.error) || 'unknown');
    }
  }

  let flashTimer = null;
  let saveTimer = null;

  function flash(msg) {
    const f = $('flash');
    f.textContent = msg;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { f.textContent = ''; }, 1800);
  }

  function scheduleBasicSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async function () {
      settings.targetLang = $('opt-lang').value;
      settings.mode = $('opt-mode').value;
      settings.selectionTranslate = $('opt-selection').checked;
      settings.hoverTranslate = $('opt-hover').checked;
      settings.inputTranslate = $('opt-input').checked;
      settings.blacklist = $('opt-blacklist').value.split('\n')
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
      await EduTransCommon.saveSettings(settings);
      flash(EduTransI18n.options.autoSaved);
    }, 500);
  }

  function bindBasicAutoSave() {
    $('opt-lang').addEventListener('change', scheduleBasicSave);
    $('opt-mode').addEventListener('change', scheduleBasicSave);
    $('opt-selection').addEventListener('change', scheduleBasicSave);
    $('opt-hover').addEventListener('change', scheduleBasicSave);
    $('opt-input').addEventListener('change', scheduleBasicSave);
    $('opt-blacklist').addEventListener('input', scheduleBasicSave);
  }

  async function saveTermsNow() {
    const terms = [];
    $('terms-text').value.split('\n').forEach(function (line) {
      const idx = line.indexOf('=');
      if (idx < 1) return;
      const from = line.slice(0, idx).trim();
      const to = line.slice(idx + 1).trim();
      if (from && to) terms.push({ from: from, to: to });
    });
    settings.terms = terms;
    await EduTransCommon.saveSettings(settings);
    flash(EduTransI18n.options.autoSaved +
      ' (' + terms.length + ')');
  }

  function renderVocab() {
    const tb = $('vocab-body');
    tb.textContent = '';
    if (!settings.vocab.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.textContent = EduTransI18n.options.vocabEmpty;
      tr.appendChild(td);
      tb.appendChild(tr);
      return;
    }
    settings.vocab.forEach(function (v) {
      const tr = document.createElement('tr');
      [v.source, v.translation, v.title || ''].forEach(function (text) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      const td = document.createElement('td');
      const a = document.createElement('a');
      a.href = v.url || '#';
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.textContent = new Date(v.ts).toLocaleString();
      td.appendChild(a);
      tr.appendChild(td);
      tb.appendChild(tr);
    });
  }

  function exportVocab() {
    const esc = function (s) {
      return '"' + String(s || '').replace(/"/g, '""') + '"';
    };
    const head = 'source,translation,title,url,time';
    const rows = settings.vocab.map(function (v) {
      return [
        esc(v.source),
        esc(v.translation),
        esc(v.title),
        esc(v.url),
        esc(new Date(v.ts).toISOString())
      ].join(',');
    }).join('\n');
    const blob = new Blob(['\ufeff' + head + '\n' + rows], {
      type: 'text/csv'
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'edutrans-vocab.csv';
    a.click();
  }

  async function clearVocab() {
    if (!confirm(EduTransI18n.options.vocabClearConfirm)) return;
    settings.vocab = [];
    await EduTransCommon.saveSettings(settings);
    renderVocab();
  }

  async function init() {
    settings = await EduTransCommon.getSettings();
    EduTransCommon.TARGET_LANGS.forEach(function (l) {
      const o = document.createElement('option');
      o.value = l.code;
      o.textContent = l.name;
      $('opt-lang').appendChild(o);
    });
    renderEngines();
    const pipeline = settings.translationPipeline || {};
    $('opt-pipeline').checked = pipeline.enabled !== false;
    $('opt-concurrency').value = pipeline.accountConcurrency || 2;
    $('opt-local-threshold').value = pipeline.localThreshold || 220;
    ['opt-pipeline', 'opt-concurrency', 'opt-local-threshold'].forEach(id => $(id).addEventListener('change', savePipeline));
    $('opt-lang').value = settings.targetLang;
    $('opt-mode').value = settings.mode;
    $('opt-selection').checked = !!settings.selectionTranslate;
    $('opt-hover').checked = settings.hoverTranslate !== false;
    $('opt-input').checked = settings.inputTranslate !== false;
    $('opt-blacklist').value = (settings.blacklist || []).join('\n');
    $('terms-text').value = (settings.terms || []).map(function (t) {
      return t.from + ' = ' + t.to;
    }).join('\n');
    $('opt-ads').checked = !!(settings.filters && settings.filters.ads);
    $('opt-adult').checked = settings.filters
      ? settings.filters.adult !== false : true;
    renderVocab();
    $('btn-add-engine').addEventListener('click', function () {
      openForm(null);
    });
    $('btn-glm-preset').addEventListener('click', function () {
      openForm(null);
      $('ef-name').value = 'GLM';
      $('ef-baseurl').value = 'https://open.bigmodel.cn/api/paas/v4';
      $('ef-model').value = 'glm-4.5-flash';
      $('ef-apikey').value = '';
      $('ef-apikey').focus();
    });
    window.addEventListener('hashchange', applyAutoCfg);
    $('ef-save').addEventListener('click', saveForm);
    $('ef-cancel').addEventListener('click', closeForm);
    $('ef-test').addEventListener('click', testForm);
    bindBasicAutoSave();
    bindFiltersAutoSave();
    $('vocab-export').addEventListener('click', exportVocab);
    $('vocab-clear').addEventListener('click', clearVocab);
    if (location.hash === '#vocab') {
      document.getElementById('sec-vocab').scrollIntoView();
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  async function savePipeline() {
    const clamp = (value, fallback, min, max) => Math.max(min, Math.min(max, Math.floor(Number(value) || fallback)));
    settings.translationPipeline = Object.assign({}, settings.translationPipeline || {}, {
      enabled: $('opt-pipeline').checked,
      accountConcurrency: clamp($('opt-concurrency').value, 2, 1, 32),
      localThreshold: clamp($('opt-local-threshold').value, 220, 40, 400),
      staggerMs: 180,
      maxPendingParagraphs: 2
    });
    await EduTransCommon.saveSettings(settings);
    flash(EduTransI18n.options.autoSaved);
  }

  function bindFiltersAutoSave() {
    const saveFilters = async function () {
      settings.filters = {
        ads: $('opt-ads').checked,
        adult: $('opt-adult').checked
      };
      await EduTransCommon.saveSettings(settings);
      chrome.runtime.sendMessage({ type: 'APPLY_FILTERS' })
        .catch(function () {});
      flash(EduTransI18n.options.autoSaved);
    };
    $('opt-ads').addEventListener('change', saveFilters);
    $('opt-adult').addEventListener('change', saveFilters);
    let tt = null;
    $('terms-text').addEventListener('input', function () {
      if (tt) clearTimeout(tt);
      tt = setTimeout(saveTermsNow, 700);
    });
  }

  async function applyAutoCfg() {
    let payload = null;
    const h = location.hash.match(/#autocfg=([A-Za-z0-9_-]+)/);
    if (h) payload = h[1];
    if (!payload) {
      const q = location.search.match(/[?&]autocfg=([A-Za-z0-9_-]+)/);
      if (q) payload = q[1];
    }
    if (!payload) return false;
    try {
      const raw = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = Uint8Array.from(raw, function (c) {
        return c.charCodeAt(0);
      });
      const cfg = JSON.parse(new TextDecoder().decode(bytes));
      const s = await EduTransCommon.getSettings();
      Object.assign(s.engines, cfg.engines || {});
      if (cfg.defaultEngineId && s.engines[cfg.defaultEngineId]) {
        s.defaultEngineId = cfg.defaultEngineId;
      }
      if (cfg.targetLang) s.targetLang = cfg.targetLang;
      if (cfg.mode) s.mode = cfg.mode;
      if (cfg.filters) s.filters = cfg.filters;
      await EduTransCommon.saveSettings(s);
      settings = s;
      renderEngines();
      const def = s.engines[s.defaultEngineId] || {};
      $('cfg-status').textContent =
        EduTransI18n.options.cfgImported +
        ' (默认: ' + (def.name || s.defaultEngineId) + ')';
      history.replaceState(null, '',
        location.pathname + location.search);
      return true;
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      $('cfg-status').textContent = 'autocfg error: ' + msg;
      return false;
    }
  }

  function updateCfgStatus() {
    const el = $('cfg-status');
    if (!el || !settings) return;
    const def = settings.engines[settings.defaultEngineId];
    let aiCount = 0;
    Object.keys(settings.engines).forEach(function (id) {
      if (settings.engines[id].type === 'openai') aiCount += 1;
    });
    el.textContent = '当前默认: ' +
      (def ? engineName(settings.defaultEngineId, def) : '(未设置)') +
      ' | 已配置大模型服务: ' + aiCount + ' 个';
  }
})();
