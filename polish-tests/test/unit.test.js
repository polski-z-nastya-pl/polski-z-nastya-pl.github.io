'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validate } = require('../src/schema');
const { listTopics, findTopic, makeJwt } = require('../src/gdocs');
const { generateTest, extractJson } = require('../src/claude');
const { buildHtml } = require('../src/build');
const { publish } = require('../src/publish');
const { slug, fold } = require('../src/util');

const sample = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'example', 'zaimki-sample.json'), 'utf8'));

test('пример проходит строгую валидацию, 12–20 вопросов, три типа', () => {
  assert.deepEqual(validate(sample(), { strict: true }), []);
});

test('валидатор ловит типичные ошибки', () => {
  const t = sample();
  t.tasks[0].questions[0].answer = 'xxx';
  t.tasks[1].questions[0].prompt = 'bez pustego miejsca';
  delete t.tasks[2].questions[0].explanation_ru;
  t.tasks[3].questions[1].id = 'q1';
  const e = validate(t).join('\n');
  assert.match(e, /answer: должен быть одним из options/);
  assert.match(e, /пропуск ___/);
  assert.match(e, /explanation_ru/);
  assert.match(e, /повторяется/);
});

test('slug и fold', () => {
  assert.equal(slug('Юлия'), 'yuliya');
  assert.equal(slug('Zaimki: łódź'), 'zaimki-lodz');
  assert.equal(fold('Łąka'), 'laka');
});

const para = (t, style) => ({ paragraph: { elements: [{ textRun: { content: t + '\n' } }], paragraphStyle: { namedStyleType: style || 'NORMAL_TEXT' } } });
const table = (rows) => ({ table: { tableRows: rows.map((r) => ({ tableCells: r.map((c) => ({ content: [para(c)] })) })) } });

test('темы: несколько вкладок (включая дочерние)', () => {
  const tab = (title, body, kids) => ({ tabProperties: { title }, documentTab: { body: { content: body } }, childTabs: kids });
  const doc = { tabs: [tab('zaimki', [para('mi | ci')], [tab('rzeczownik', [table([['ten', 'ta']])])]), tab('przymiotnik', [para('dobry')])] };
  const topics = listTopics(doc);
  assert.deepEqual(topics.map((t) => t.title), ['zaimki', 'rzeczownik', 'przymiotnik']);
  assert.equal(topics[1].text, 'ten | ta');
  assert.equal(findTopic(topics, 'PRZYMIOTNIK').title, 'przymiotnik');
  assert.throws(() => findTopic(topics, 'xyz'), /не найдена/);
});

test('темы: одна вкладка, разделы по заголовкам', () => {
  const doc = { tabs: [{ tabProperties: { title: 'x' }, documentTab: { body: { content: [
    para('Zaimki', 'HEADING_1'), para('Tabela', 'HEADING_2'), table([['mi', 'ci'], ['go', 'mu']]), para('Rzeczownik', 'HEADING_1'), para('rodzaj') ] } } }] };
  const topics = listTopics(doc);
  assert.deepEqual(topics.map((t) => t.title), ['Zaimki', 'Rzeczownik']);
  assert.match(topics[0].text, /## Tabela\nmi \| ci\ngo \| mu/);
  assert.equal(topics[1].text, 'rodzaj');
});

test('JWT подписывается RS256 и проверяется публичным ключом', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwt = makeJwt({ client_email: 'sa@x.iam', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }, 1000);
  const [h, c, s] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(c, 'base64url')).iss, 'sa@x.iam');
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url')));
});

test('extractJson снимает markdown-ограждения', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
});

test('generate: при невалидном ответе повторяет с ошибками и принимает исправленный', async () => {
  const bad = JSON.stringify({ topic: 'Zaimki', tasks: [] });
  const calls = [];
  const out = await generateTest('Zaimki', 'материал', 15, {
    call: async (msgs) => { calls.push(msgs.length); return calls.length === 1 ? bad : JSON.stringify(sample()); } });
  assert.deepEqual(calls, [1, 3]);
  assert.equal(out.topic, 'Zaimki');
});

test('generate: после трёх неудач — ошибка', async () => {
  let n = 0;
  await assert.rejects(generateTest('Z', 'm', 15, { call: async () => { n++; return 'не json'; } }), /за 3 попытки/);
  assert.equal(n, 3);
});

test('build: данные не ломают страницу (</script> в тексте)', () => {
  const t = sample();
  t.tasks[0].questions[0].explanation_ru = 'тест </script><b>x</b>';
  const html = buildHtml(t, { webhook: 'https://x/y"z' });
  assert.equal((html.match(/<\/script>/g) || []).length, 2);
  assert.ok(!html.includes('https://x/y"z'));
  assert.ok(!/src="http|href="http|@import/.test(html), 'нет внешних зависимостей');
});

test('publish: PUT в docs/, возвращает ссылку GitHub Pages', async () => {
  const f = path.join(os.tmpdir(), 'zaimki-2026-10-29.html');
  fs.writeFileSync(f, '<html>');
  Object.assign(process.env, { GITHUB_REPO: 'Some-User/polish-tests', GITHUB_TOKEN: 't' });
  const real = global.fetch, calls = [];
  global.fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', url, init.body && JSON.parse(init.body)]);
    return init.method === 'PUT' ? { ok: true, json: async () => ({}) } : { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const url = await publish(f, { student: 'Юлия' });
    assert.equal(url, 'https://some-user.github.io/polish-tests/yuliya-zaimki-2026-10-29.html');
    assert.match(calls[1][1], /contents\/docs\/yuliya-zaimki-2026-10-29\.html$/);
    assert.equal(Buffer.from(calls[1][2].content, 'base64').toString(), '<html>');
  } finally { global.fetch = real; }
});
