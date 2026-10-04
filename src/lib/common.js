// EduTrans common library - shared by content script, popup, options and service worker.
(function (global) {
  'use strict';

  const TARGET_LANGS = [
    { code: 'zh-CN', name: '\u7b80\u4f53\u4e2d\u6587' },
    { code: 'zh-TW', name: '\u7e41\u9ad4\u4e2d\u6587' },
    { code: 'en', name: 'English' },
    { code: 'ja', name: '\u65e5\u672c\u8a9e' },
    { code: 'ko', name: '\ud55c\uad6d\uc5b4' },
    { code: 'fr', name: 'Fran\u00e7ais' },
    { code: 'de', name: 'Deutsch' },
    { code: 'es', name: 'Espa\u00f1ol' },
    { code: 'ru', name: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439' }
  ];

  function langName(code) {
    const hit = TARGET_LANGS.find(function (l) { return l.code === code; });
    return hit ? hit.name : code;
  }

  const DEFAULT_SETTINGS = {
    targetLang: 'zh-CN',
    mode: 'bilingual',
    defaultEngineId: 'device',
    engines: {
      'device': { id: 'device', type: 'device', name: 'Device (built-in, offline)' },
      'google-free': { id: 'google-free', type: 'google', name: 'Google Free (built-in)' },
      'ms-free': { id: 'ms-free', type: 'microsoft', name: 'Microsoft Free (built-in)' }
    },
    translationPipeline: { enabled: true, accountConcurrency: 2, staggerMs: 180, maxPendingParagraphs: 2, localThreshold: 220, complexThreshold: 650 },
    selectionTranslate: true,
    hoverTranslate: true,
    inputTranslate: true,
    blacklist: [],
    terms: [],
    vocab: [],
    sitePrefs: {},
    filters: { ads: true, adult: true }
  };

  function deepMerge(base, patch) {
    if (!patch || typeof patch !== 'object') return base;
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        deepMerge(base[k], v);
      } else {
        base[k] = v;
      }
    }
    return base;
  }

  async function getSettings() {
    const stored = await chrome.storage.local.get('settings');
    const s = deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), stored.settings || {});
    if (!s.engines || typeof s.engines !== 'object') {
      s.engines = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.engines));
    }
    if (!s.engines.device) {
      s.engines.device = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.engines.device));
    }
    if (!s.filters || typeof s.filters !== 'object') {
      s.filters = { ads: true, adult: true };
    }
    // AI-first: once a custom AI engine exists, prefer it as default
    if (!s.defaultEngineExplicit &&
        ['google-free', 'ms-free', 'device'].indexOf(s.defaultEngineId) >= 0) {
      const aiIds = Object.keys(s.engines).filter(function (id) {
        return s.engines[id] && s.engines[id].type === 'openai';
      });
      if (aiIds.length) {
        s.defaultEngineId = aiIds[0];
      }
    }
    return s;
  }

  async function saveSettings(settings) {
    await chrome.storage.local.set({ settings: settings });
    return settings;
  }

  async function patchSettings(patch) {
    const s = await getSettings();
    deepMerge(s, patch);
    await chrome.storage.local.set({ settings: s });
    return s;
  }

  function hostMatches(host, list) {
    if (!host) return false;
    return (list || []).some(function (pat) {
      return host === pat || host.endsWith('.' + pat);
    });
  }

  function engineOrder(s) {
    const ids = Object.keys(s.engines);
    const ai = ids.filter(function (id) {
      return s.engines[id] && s.engines[id].type === 'openai';
    });
    const rest = ids.filter(function (id) {
      return !s.engines[id] || s.engines[id].type !== 'openai';
    });
    const builtin = ['device', 'google-free', 'ms-free'];
    rest.sort(function (a, b) {
      const ia = builtin.indexOf(a);
      const ib = builtin.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return ai.concat(rest);
  }

  global.EduTransCommon = {
    engineOrder: engineOrder,
    TARGET_LANGS: TARGET_LANGS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    langName: langName,
    getSettings: getSettings,
    saveSettings: saveSettings,
    patchSettings: patchSettings,
    hostMatches: hostMatches,
    deepMerge: deepMerge
  };
})(typeof self !== 'undefined' ? self : this);
