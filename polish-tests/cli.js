#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { loadEnv, today, slug } = require('./src/util');
const { fetchDoc, listTopics, findTopic } = require('./src/gdocs');
const { generateTest } = require('./src/claude');
const { buildHtml, outName } = require('./src/build');
const { publish } = require('./src/publish');
const { validate } = require('./src/schema');

const HELP = `Использование:
  node cli.js topics                                   список тем документа
  node cli.js generate --topic "<тема>" [--questions 15]   создать tests/<тема>-<дата>.json
  node cli.js build tests/<файл>.json                  собрать dist/<тема>-<дата>.html
  node cli.js publish dist/<файл>.html                 опубликовать и вывести ссылку
  node cli.js all --topic "<тема>" [--questions 15]    generate → правка JSON → build → publish`;

function args(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
    else pos.push(argv[i]);
  }
  return { pos, opt };
}

const ask = (q) => new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(a); }); });

async function cmdGenerate(opt) {
  if (!opt.topic) throw new Error('Укажите --topic "<тема>"');
  const n = Math.min(20, Math.max(12, parseInt(opt.questions || '15', 10) || 15));
  const topic = findTopic(listTopics(await fetchDoc()), opt.topic);
  if (!topic.text.trim()) throw new Error(`В теме «${topic.title}» нет текста`);
  console.log(`Генерирую тест по теме «${topic.title}» (~${n} вопросов)…`);
  const data = await generateTest(topic.title, topic.text, n, { log: (m) => console.log(m) });
  data.student = process.env.STUDENT_NAME || '';
  data.created = today();
  const ordered = { topic: data.topic, student: data.student, created: data.created, tasks: data.tasks };
  fs.mkdirSync('tests', { recursive: true });
  const file = path.join('tests', `${slug(topic.title)}-${data.created}.json`);
  fs.writeFileSync(file, JSON.stringify(ordered, null, 2) + '\n');
  console.log(`Готово: ${file}. Проверьте и при необходимости поправьте JSON перед сборкой.`);
  return file;
}

function cmdBuild(file) {
  if (!file) throw new Error('Укажите файл: build tests/<файл>.json');
  const test = JSON.parse(fs.readFileSync(file, 'utf8'));
  const html = buildHtml(test, { webhook: process.env.RESULTS_WEBHOOK_URL || '' });
  fs.mkdirSync('dist', { recursive: true });
  const out = path.join('dist', outName(test));
  fs.writeFileSync(out, html);
  const n = test.tasks.reduce((s, t) => s + t.questions.length, 0);
  console.log(`Собрано: ${out} (${n} вопросов, ${(html.length / 1024).toFixed(0)} КБ)`);
  return out;
}

async function cmdPublish(file) {
  if (!file) throw new Error('Укажите файл: publish dist/<файл>.html');
  const url = await publish(file);
  console.log(`Опубликовано: ${url}\n(GitHub Pages может обновиться через 1–2 минуты)`);
}

(async () => {
  loadEnv();
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = args(rest);
  try {
    if (cmd === 'topics') {
      const topics = listTopics(await fetchDoc());
      topics.forEach((t, i) => console.log(`${i + 1}. ${t.title}  (${t.text.length} симв.)`));
    } else if (cmd === 'generate') await cmdGenerate(opt);
    else if (cmd === 'build') cmdBuild(pos[0]);
    else if (cmd === 'publish') await cmdPublish(pos[0]);
    else if (cmd === 'all') {
      const json = await cmdGenerate(opt);
      for (;;) {
        await ask(`\nОткройте и проверьте ${json}. Нажмите Enter, когда всё готово… `);
        const errs = validate(JSON.parse(fs.readFileSync(json, 'utf8')));
        if (!errs.length) break;
        console.log('Ошибки в JSON:\n- ' + errs.join('\n- '));
      }
      await cmdPublish(cmdBuild(json));
    } else console.log(HELP);
  } catch (e) { console.error('Ошибка:', e.message); process.exit(1); }
})();
