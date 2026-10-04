// EduTrans sentence-splitting smoke (fixture-based, fake DOM).
global.self = global;

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
global.location = {
  hostname: 'example.com',
  href: 'http://example.com/',
  hash: '', search: '', pathname: '/'
};
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
};

require('../src/lib/common.js');
require('../src/lib/i18n.js');
require('../src/content/content.js');

// Fixture: 8-sentence paragraph that used to translate as first-sentence-only.
const fixture = {
  source: 'These, it might seem, are good days for the Islamic Republic of Iran. After years of being diplomatically isolated, economically strangled, and militarily assaulted, the Iranian regime came face-to-face with its nightmare scenario\u2014a full-blown war with Israel and Washington\u2014and survived. The United States began bombing Iran on February 28 with the goal of destroying the country\u2019s nuclear program, its missile program, and even its government, only to fail spectacularly at each objective. In fact, Tehran may now be stronger than it was when the war began. It successfully seized the Strait of Hormuz and shuttered it, sending energy prices skyward. Its armed forces have proved capable of continuing to damage American military bases despite coming under heavy bombardment. U.S. support for the war, always weak, has fallen, and international anger at Washington has spiked. Little wonder, then, that many analysts think Tehran will stay the course over the coming year.'
};

(async () => {
  const S = global.self.EduTransSplit;
  if (!S) { console.log('SPLIT FAIL: no hook'); process.exit(1); }

  const srcSentences = fixture.source.match(
    /[^.!?]+[.!?]+(\s|$)/g).length;
  const chunks = S.splitSentences(fixture.source, 280);
  const maxLen = Math.max.apply(null, chunks.map(function (c) {
    return c.length;
  }));
  const rejoined = chunks.join(' ');
  const reSentences = rejoined.match(/[^.!?]+[.!?]+(\s|$)/g).length;
  const loss = fixture.source.length - rejoined.replace(/\s+/g, ' ').length;

  const joinerZh = S.joinerFor('zh-CN');
  const joinerEn = S.joinerFor('en');

  // zh joining must not introduce spaces between sentences
  const zhJoined = chunks.join(joinerZh);
  const compactOk = zhJoined.replace(/\s+/g, '').length >=
    fixture.source.replace(/\s+/g, '').length * 0.98;

  console.log('srcSentences:', srcSentences,
    '| chunks:', chunks.length, '| maxChunk:', maxLen);
  console.log('reSentences:', reSentences,
    '| length loss:', loss, '| joiner zh/en:',
    JSON.stringify(joinerZh), JSON.stringify(joinerEn));

  const endings = [
    'Republic of Iran.', 'and survived.', 'at each objective.',
    'when the war began.', 'energy prices skyward.',
    'under heavy bombardment.', 'at Washington has spiked.',
    'over the coming year.'
  ];
  const endingsOk = endings.every(function (e) {
    return chunks.join(' ').indexOf(e) >= 0;
  });
  const ok = srcSentences >= 8 &&
    reSentences >= 8 &&
    endingsOk &&
    maxLen <= 280 &&
    chunks.length >= 2 &&
    loss >= -2 && loss <= 2 &&
    joinerZh === '' && joinerEn === ' ' &&
    compactOk;
  console.log(ok ? 'SPLIT SMOKE PASS' : 'SPLIT SMOKE FAIL');
  process.exit(ok ? 0 : 1);
})().catch(function (e) {
  console.error('SPLIT ERROR', e);
  process.exit(1);
});
