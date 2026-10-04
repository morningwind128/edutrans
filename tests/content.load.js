global.self = global;
require(__dirname + '/../src/lib/common.js');
require(__dirname + '/../src/lib/i18n.js');
global.chrome = {
  runtime: {
    sendMessage: async function () { return { ok: true, texts: [] }; },
    onMessage: { addListener: function () {} }
  },
  storage: {
    local: {
      get: async function () { return {}; },
      set: async function () {}
    }
  }
};
global.window = { addEventListener: function () {} };
global.location = { hostname: "example.com", href: "http://example.com/" };
global.document = {
  addEventListener: function () {},
  removeEventListener: function () {},
  querySelectorAll: function () { return []; },
  querySelector: function () { return null; },
  getElementById: function () { return null; },
  createElement: function () {
    return {
      style: {},
      classList: {
        add: function () {}, remove: function () {}, toggle: function () {}
      },
      addEventListener: function () {},
      appendChild: function () {},
      remove: function () {},
      setAttribute: function () {},
      textContent: ''
    };
  },
  documentElement: { appendChild: function () {} },
  body: null
};
global.navigator = { clipboard: { writeText: function () {} } };
global.IntersectionObserver = function () {
  this.observe = function () {};
  this.unobserve = function () {};
  this.disconnect = function () {};
};
require(__dirname + '/../src/content/content.js');
console.log('content.js LOADS OK (no top-level errors)');
