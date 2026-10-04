// EduTrans options page smoke test with fake DOM.
global.self = global;

const store = {};
const setCalls = [];
const els = {};

global.chrome = {
  runtime: {
    getManifest: function () {
      return { version: '0.2.2', name: 'EduTrans' };
    },
    sendMessage: async function (msg) {
      if (msg.type === 'APPLY_FILTERS') setCalls.push('APPLY');
      return { ok: true };
    },
    getURL: function (p) { return 'chrome-extension://x/' + p; },
    onMessage: { addListener: function () {} }
  },
  storage: {
    local: {
      get: async function (k) {
        const o = {};
        [].concat(k).forEach(function (key) {
          if (store[key] !== undefined) o[key] = store[key];
        });
        return o;
      },
      set: async function (o) {
        Object.keys(o).forEach(function (k) { store[k] = o[k]; });
        setCalls.push('set');
      }
    }
  },
  declarativeNetRequest: {
    getEnabledRulesets: async function () { return ['ads', 'adult']; },
    updateEnabledRulesets: async function () { setCalls.push('DNR'); }
  },
  tabs: {
    query: async function () { return []; },
    sendMessage: async function () { return {}; },
    create: function () {}
  }
};

function fakeEl(id) {
  const e = {
    id: id || '', textContent: '', value: '', checked: false,
    disabled: false, style: {}, listeners: {},
    addEventListener: function (t, f) {
      e.listeners[t] = e.listeners[t] || [];
      e.listeners[t].push(f);
    },
    appendChild: function () {},
    insertAdjacentElement: function () {},
    querySelector: function () { return fakeEl(); },
    querySelectorAll: function () { return []; },
    classList: {
      add: function () {}, remove: function () {}, toggle: function () {}
    },
    setAttribute: function () {},
    getAttribute: function () { return null; },
    removeAttribute: function () {},
    remove: function () {},
    focus: function () {},
    click: function () {},
    scrollIntoView: function () {},
    closest: function () { return null; },
    matches: function () { return false; }
  };
  return e;
}

global.__domReady = null;
global.__hashChange = null;
global.document = {
  addEventListener: function (t, f) {
    if (t === 'DOMContentLoaded') global.__domReady = f;
  },
  createElement: function (tag) { return fakeEl(tag); },
  querySelectorAll: function () { return []; },
  querySelector: function () { return null; },
  getElementById: function (id) {
    if (!els[id]) els[id] = fakeEl(id);
    return els[id];
  },
  documentElement: fakeEl('html')
};
global.window = {
  addEventListener: function (t, f) {
    if (t === 'hashchange') global.__hashChange = f;
  }
};
global.location = {
  hash: '', search: '',
  pathname: '/src/options/options.html',
  href: 'chrome-extension://x/src/options/options.html'
};
global.history = { replaceState: function () {} };
global.confirm = function () { return false; };
global.alert = function () {};

require(__dirname + '/../src/lib/common.js');
require('../src/lib/i18n.js');
require('../src/options/options.js');

(async () => {
  await global.__domReady();
  await new Promise(function (r) { setTimeout(r, 50); });
  const cfgStatus1 = els['cfg-status'].textContent;
  console.log('status after init:', cfgStatus1.slice(0, 50));

  const c = {
    defaultEngineId: 'glm1',
    targetLang: 'zh-CN',
    mode: 'bilingual',
    engines: {
      glm1: {
        id: 'glm1', type: 'openai', name: 'GLM',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'test-key', model: 'glm-4.5-flash',
        temperature: 0.1, systemPrompt: ''
      }
    }
  };
  const b = Buffer.from(JSON.stringify(c))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
    .replace(/=+$/, '');
  global.location.hash = '#autocfg=' + b;
  if (global.__hashChange) await global.__hashChange();
  await new Promise(function (r) { setTimeout(r, 100); });

  const s = store.settings || {};
  const ok1 = !!(s.engines && s.engines.glm1);
  const ok2 = s.defaultEngineId === 'glm1';
  const ok3 = els['cfg-status'].textContent.indexOf('GLM') >= 0;

  els['opt-blacklist'].value = 'example.com\nfoo.org';
  (els['opt-blacklist'].listeners['input'] || [])[0]();
  await new Promise(function (r) { setTimeout(r, 800); });
  const bl = (store.settings && store.settings.blacklist) || [];
  const ok4 = bl.indexOf('example.com') >= 0 && bl.indexOf('foo.org') >= 0;

  els['opt-ads'].checked = false;
  (els['opt-ads'].listeners['change'] || [])[0]();
  await new Promise(function (r) { setTimeout(r, 100); });
  const ok5 = store.settings.filters.ads === false;

  console.log('autocfg engines:', ok1, '| default:', ok2,
    '| status text:', ok3);
  console.log('autosave blacklist:', ok4, JSON.stringify(bl));
  console.log('filters autosave + DNR:', ok5,
    '| setCalls:', JSON.stringify(setCalls));
  const pass = ok1 && ok2 && ok3 && ok4 && ok5;
  console.log(pass ? 'OPTIONS SMOKE PASS' : 'OPTIONS SMOKE FAIL');
  process.exit(pass ? 0 : 1);
})().catch(function (e) {
  console.error('SMOKE ERROR', e);
  process.exit(1);
});
