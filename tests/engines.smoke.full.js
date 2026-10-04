// EduTrans engines quality regression (fake fetch, no network).
global.self = global;
require('../src/lib/common.js');
require('../src/lib/engines.js');
const E = global.self.EduTransEngines;

const engine = {
  type: 'openai', baseUrl: 'https://x/v1',
  model: 'm', apiKey: 'k'
};
const ctx = {
  targetLang: 'zh-CN',
  targetLangName: '\u7b80\u4f53\u4e2d\u6587',
  title: 't', terms: []
};

function okArr(arr) {
  return {
    ok: true,
    json: async function () {
      return {
        choices: [{
          finish_reason: 'stop',
          message: { content: JSON.stringify(arr) }
        }]
      };
    },
    text: async function () { return ''; }
  };
}

let mode = 'happy';
let calls = 0;
global.fetch = async function (url, opts) {
  calls++;
  const body = JSON.parse(opts.body);
  const texts = JSON.parse(body.messages[1].content);
  if (mode === 'happy') {
    return okArr(texts.map(function (t) { return '\u8bd1:' + t; }));
  }
  if (mode === 'truncated-batch' && texts.length > 1 && !body.messages[0].content.includes('corrective translation')) {
    return {
      ok: true,
      json: async function () {
        return {
          choices: [{
            finish_reason: 'length',
            message: { content: '["\u53ea\u8bd1\u4e86\u7b2c\u4e00' }
          }]
        };
      },
      text: async function () { return ''; }
    };
  }
  if (mode === 'empty-items' && texts.length === 3 && !body.messages[0].content.includes('corrective translation')) {
    return okArr(['\u5b8c\u6574', '', ' ']);
  }
  if (mode === 'all-fail') {
    return {
      ok: false, status: 500,
      json: async function () { return {}; },
      text: async function () { return 'boom'; }
    };
  }
  return okArr(texts.map(t => '\u8865:' + t));
};

async function run(name, fn) {
  calls = 0;
  let err = null;
  let out = null;
  try { out = await fn(); } catch (e) { err = String(e.message || e); }
  console.log('[' + name + '] calls=' + calls +
    ' out=' + JSON.stringify(out) + ' err=' + err);
  return { out: out, err: err, calls: calls };
}

(async () => {
  let pass = true;

  // S1 happy path: strict array accepted
  mode = 'happy';
  const r1 = await run('happy', function () {
    return E.translateBatch(engine, ['Hello', 'World'], ctx);
  });
  const ok1 = r1.out && r1.out.length === 2 &&
    r1.out[0] === '\u8bd1:Hello' && r1.calls === 1;

  // S2 truncated batch (finish_reason=length, malformed JSON):
  // batch fails, per-item repair fills everything, no silent success
  mode = 'truncated-batch';
  const r2 = await run('truncated-batch', function () {
    return E.translateBatch(engine, ['A one.', 'B two.', 'C three.'], ctx);
  });
  const ok2 = r2.out && r2.out.length === 3 &&
    r2.out.every(function (t) { return t.indexOf('\u8865:') === 0; }) &&
    r2.calls === 2;

  // S3 everything fails: must throw, never count as success
  mode = 'all-fail';
  const r3 = await run('all-fail', function () {
    return E.translateBatch(engine, ['X', 'Y', 'Z'], ctx);
  });
  const ok3 = r3.err !== null && r3.out === null;

  // S4 array contains empty/blank items: strict parse rejects,
  // per-item repair fills them
  mode = 'empty-items';
  const r4 = await run('empty-items', function () {
    return E.translateBatch(engine, ['P1', 'P2', 'P3'], ctx);
  });
  const ok4 = r4.out && r4.out.length === 3 &&
    r4.out.every(function (t) { return t && t.length > 0; });

  console.log('S1 happy:', ok1, '| S2 truncate+repair:', ok2,
    '| S3 fail-loud:', ok3, '| S4 empty-repair:', ok4);
  pass = ok1 && ok2 && ok3 && ok4;
  console.log(pass ? 'ENGINES SMOKE PASS' : 'ENGINES SMOKE FAIL');
  process.exit(pass ? 0 : 1);
})().catch(function (e) {
  console.error('SMOKE ERROR', e);
  process.exit(1);
});
