import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/lib/engines.js', import.meta.url), 'utf8');
const ai = { id: 'mock-ai', type: 'openai', baseUrl: 'https://mock.invalid', model: 'mock' };
const lang = { targetLang: 'zh-CN', targetLangName: 'Chinese' };
function runner(response) {
  let calls = 0;
  const context = vm.createContext({ console, URL, setTimeout, clearTimeout,
    AbortController, fetch: async (url, options) => {
      calls++;
      return response(url, options, calls);
    } });
  vm.runInContext(source, context);
  return { translate: (texts, engine = ai) => context.EduTransEngines.translateBatch(engine, texts, lang),
    calls: () => calls };
}
const ok = (items, finish = 'stop') => ({ ok: true, json: async () => ({ choices: [{
  finish_reason: finish, message: { content: JSON.stringify(items) }
}] }) });

test('AI keeps item order and all results', async () => {
  const r = runner(() => ok(['第一段完整译文。', '第二段完整译文。']));
  assert.deepEqual(Array.from(await r.translate(['First.', 'Second.'])), ['第一段完整译文。', '第二段完整译文。']);
});
test('truncated batch is repaired in the same engine', async () => {
  const r = runner((url, options, call) => call === 1 ? ok(['只返回首句'], 'length') :
    ok(JSON.parse(JSON.parse(options.body).messages[1].content).map(text => '完整补译：' + text)));
  assert.deepEqual(Array.from(await r.translate(['First.', 'Second.'])), ['完整补译：First.', '完整补译：Second.']);
  assert.equal(r.calls(), 2);
});
test('missing items are repaired instead of shifting paragraph alignment', async () => {
  const r = runner((url, options, call) => call === 1 ? ok(['错误的单项回复']) :
    ok(JSON.parse(JSON.parse(options.body).messages[1].content).map(text => '完整补译：' + text)));
  assert.deepEqual(Array.from(await r.translate(['First.', 'Second.'])), ['完整补译：First.', '完整补译：Second.']);
});
test('JSON null and objects never become visible translations', async () => {
  const r = runner(() => ok([null, { text: 'bad' }]));
  await assert.rejects(r.translate(['First.', 'Second.']));
});
test('whitespace-only translations fail', async () => {
  const r = runner(() => ok(['   ']));
  await assert.rejects(r.translate(['First.']));
});
test('persistent upstream failure remains a failure', async () => {
  const r = runner(() => ({ ok: false, status: 503, text: async () => 'mock unavailable' }));
  await assert.rejects(r.translate(['First.', 'Second.']), /503/);
});
test('Google joins every segment of one paragraph', async () => {
  const r = runner(() => ({ ok: true, json: async () => [[['第一句。'], ['第二句。'], ['末句。']]] }));
  assert.deepEqual(Array.from(await r.translate(['Three sentences.'], { type: 'google' })), ['第一句。第二句。末句。']);
});
test('Microsoft malformed non-string result fails', async () => {
  const r = runner(url => url.includes('/auth') ? { ok: true, text: async () => 'synthetic-token' } :
    { ok: true, json: async () => [{ translations: [{ text: { invalid: true } }] }] });
  await assert.rejects(r.translate(['First.'], { type: 'microsoft' }));
});
