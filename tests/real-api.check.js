// Real-API check: fixture paragraph through actual GLM engine.
// Run manually: node tests/real-api.check.js  (uses key from env GLM_KEY
// or the default below; needs network access to open.bigmodel.cn)
global.self = global;
require(__dirname + '/../src/lib/common.js');
require(__dirname + '/../src/lib/engines.js');
const E = global.self.EduTransEngines;

const KEY = process.env.GLM_KEY;
if (!KEY) {
  console.log('SKIP: set GLM_KEY env to run this check');
  process.exit(0);
}
const engine = {
  type: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  model: 'glm-4.5-flash', apiKey: KEY
};
const ctx = {
  targetLang: 'zh-CN',
  targetLangName: '简体中文',
  title: 'Why Iran Escalates — Foreign Affairs',
  terms: []
};
const source = 'These, it might seem, are good days for the Islamic ' +
  'Republic of Iran. After years of being diplomatically isolated, ' +
  'economically strangled, and militarily assaulted, the Iranian regime ' +
  'came face-to-face with its nightmare scenario\u2014a full-blown war ' +
  'with Israel and Washington\u2014and survived. The United States began ' +
  'bombing Iran on February 28 with the goal of destroying the ' +
  'country\u2019s nuclear program, its missile program, and even its ' +
  'government, only to fail spectacularly at each objective. In fact, ' +
  'Tehran may now be stronger than it was when the war began. It ' +
  'successfully seized the Strait of Hormuz and shuttered it, sending ' +
  'energy prices skyward. Its armed forces have proved capable of ' +
  'continuing to damage American military bases despite coming under ' +
  'heavy bombardment. U.S. support for the war, always weak, has fallen, ' +
  'and international anger at Washington has spiked. Little wonder, ' +
  'then, that many analysts think Tehran will stay the course over the ' +
  'coming year.';

// 8 semantic points from the screenshot's paragraph
const POINTS = [
  ['Islamic Republic of Iran', '伊斯兰共和国'],
  ['nightmare scenario', '噩梦'],
  ['February 28', '2月28'],
  ['nuclear program', '核'],
  ['Strait of Hormuz', '霍尔木兹'],
  ['energy prices', '能源价格'],
  ['military bases', '军事基地'],
  ['coming year', '未来一']
];

(async () => {
  const t0 = Date.now();
  const r = await E.translateBatch(engine, [source], ctx);
  const ms = Date.now() - t0;
  const zh = (r[0] || '').replace(/\s+/g, '');
  const missing = POINTS.filter(function (p) {
    return zh.indexOf(p[1]) < 0;
  }).map(function (p) { return p[0]; });
  const lenOk = zh.length >= source.length * 0.2;
  console.log('elapsed ms:', ms);
  console.log('translation len:', zh.length,
    '(source compact:', source.replace(/\s+/g, '').length + ')');
  console.log('missing semantic points:', missing.length ? missing : 'NONE');
  console.log('---');
  console.log(r[0].slice(0, 400));
  console.log('---');
  const ok = missing.length === 0 && lenOk;
  console.log(ok ? 'REAL-API PASS' : 'REAL-API FAIL');
  process.exit(ok ? 0 : 1);
})().catch(function (e) {
  console.error('REAL-API ERROR', e && e.message ? e.message : e);
  process.exit(1);
});
