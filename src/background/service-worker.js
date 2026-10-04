// EduTrans background service worker.
importScripts('../lib/common.js', '../lib/quality.js', '../lib/scheduler.js', '../lib/engines.js', '../lib/router.js', '../lib/i18n.js');

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.create({
    id: 'edutrans-selection',
    title: EduTransI18n.bg.menuSelection,
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'edutrans-page',
    title: EduTransI18n.bg.menuPage,
    contexts: ['page']
  });
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (!tab || !tab.id) return;
  if (info.menuItemId === 'edutrans-selection') {
    chrome.tabs.sendMessage(tab.id, {
      type: 'TRANSLATE_SELECTION',
      text: info.selectionText || ''
    }).catch(function () {});
  } else if (info.menuItemId === 'edutrans-page') {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PAGE' }).catch(function () {});
  }
});
chrome.commands.onCommand.addListener(function (command) {
  if (command !== 'toggle-translate' && command !== 'summarize-page') return;
  chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
    if (!tabs[0] || !tabs[0].id) return;
    const type = command === 'summarize-page' ? 'SHOW_SUMMARY' : 'TOGGLE_PAGE';
    chrome.tabs.sendMessage(tabs[0].id, { type: type }).catch(function () {});
  });
});

chrome.runtime.onInstalled.addListener(function () {
  applyFilters();
});

chrome.runtime.onStartup.addListener(function () {
  applyFilters();
});

const translationRuns = new Map();

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'CANCEL_TRANSLATIONS') {
    const controllers = translationRuns.get(String(sender.tab?.id) + ':' + msg.runId);
    if (controllers) controllers.forEach(controller => controller.abort());
    sendResponse({ ok: true }); return;
  }
  if (msg.type === 'TRANSLATE_BATCH') {
    handleBatch(msg, sender).then(sendResponse).catch(function (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e), quality: !!e.quality, partial: e.partial, failedIndices: e.failedIndices, models: e.models });
    });
    return true;
  }
  if (msg.type === 'TEST_ENGINE') {
    handleTest(msg.engine).then(sendResponse).catch(function (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    });
    return true;
  }
  if (msg.type === 'SUMMARIZE') {
    handleSummarize(msg).then(sendResponse).catch(function (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    });
    return true;
  }
  if (msg.type === 'APPLY_FILTERS') {
    applyFilters().then(function () { sendResponse({ ok: true }); });
    return true;
  }
});

async function translateWithFallback(settings, engineId, texts, ctx) {
  return EduTransRouter.translate(settings, engineId, texts, ctx);
}

async function handleBatch(msg, sender) {
  const runKey = String(sender.tab?.id) + ':' + msg.runId;
  const controller = new AbortController();
  if (!translationRuns.has(runKey)) translationRuns.set(runKey, new Set());
  translationRuns.get(runKey).add(controller);
  try {
  const settings = await EduTransCommon.getSettings();
  const engineId = msg.engineId || settings.defaultEngineId;
  const ctx = {
    accountConcurrency: (settings.translationPipeline || {}).accountConcurrency || 2,
    staggerMs: (settings.translationPipeline || {}).staggerMs,
    routingHint: msg.ctx && msg.ctx.routingHint,
    priority: msg.ctx && msg.ctx.priority,
    signal: controller.signal,
    targetLang: settings.targetLang,
    targetLangName: EduTransCommon.langName(settings.targetLang),
    title: (msg.ctx && msg.ctx.title) || '',
    terms: settings.terms || [],
    tail: (msg.ctx && msg.ctx.tail) || null
  };
  const r = await translateWithFallback(settings, engineId, msg.texts, ctx);
  return { ok: true, texts: r.texts, engineName: r.engineName, models: r.models, fellBack: r.fellBack };
  } finally {
    const controllers = translationRuns.get(runKey);
    if (controllers) { controllers.delete(controller); if (!controllers.size) translationRuns.delete(runKey); }
  }
}

async function handleTest(engine) {
  const settings = await EduTransCommon.getSettings();
  const ctx = {
    targetLang: settings.targetLang,
    targetLangName: EduTransCommon.langName(settings.targetLang),
    title: 'Engine connectivity test',
    accountConcurrency: (settings.translationPipeline || {}).accountConcurrency || 2,
    terms: []
  };
  const texts = await EduTransEngines.translateBatch(engine, ['Hello, world!'], ctx);
  return { ok: true, texts: texts };
}

function pickAiEngine(settings) {
  const def = settings.engines[settings.defaultEngineId];
  if (def && def.type === 'openai') return def;
  const ids = Object.keys(settings.engines);
  for (const id of ids) {
    if (settings.engines[id] && settings.engines[id].type === 'openai') {
      return settings.engines[id];
    }
  }
  return null;
}

async function handleSummarize(msg) {
  const settings = await EduTransCommon.getSettings();
  const engine = pickAiEngine(settings);
  if (!engine) throw new Error('NO_AI_ENGINE');
  const base = String(engine.baseUrl || '').trim().replace(/\/+$/, '');
  const url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
  const sys = [
    'You are a reading assistant for students and teachers.',
    'Summarize the following web page content in ' +
      EduTransCommon.langName(settings.targetLang) + '.',
    'Format: first a 2-3 sentence overview, then 3-5 bullet points.',
    'Keep key terms in the original language with a brief note.',
    'Output only the summary.'
  ].join('\n');
  const text = String(msg.text || '').slice(0, 12000);
  if (!text.trim()) throw new Error('EMPTY_TEXT');
  const body = {
    model: engine.model || '',
    temperature: 0.2,
    stream: false,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: 'PAGE TITLE: ' + (msg.title || '') +
        '\n\nCONTENT:\n' + text }
    ]
  };
  const data = await EduTransScheduler.request(engine, body, { accountConcurrency: (settings.translationPipeline || {}).accountConcurrency || 2 });
  const choice = data.choices && data.choices[0];
  const content = choice && choice.message ? (choice.message.content || '') : '';
  if (!content) throw new Error('empty summary');
  return { ok: true, summary: content };
}

async function applyFilters() {
  const settings = await EduTransCommon.getSettings();
  const enable = [];
  const disable = [];
  const f = settings.filters || {};
  if (f.ads) enable.push('ads'); else disable.push('ads');
  if (f.adult) enable.push('adult'); else disable.push('adult');
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enable,
      disableRulesetIds: disable
    });
  } catch (e) {
    console.warn('EduTrans applyFilters:', e);
  }
}

async function handleFetchJson(msg) {
  const res = await fetch(msg.url, { credentials: 'omit' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return { ok: true, json: await res.json() };
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === 'FETCH_JSON') {
    handleFetchJson(msg).then(sendResponse).catch(function (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    });
    return true;
  }
});
