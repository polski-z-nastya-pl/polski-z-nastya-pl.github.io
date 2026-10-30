#!/usr/bin/env node
// Превращает JSON теста (формат генератора) в массив вопросов для public.test_updates.questions.
// Использование: node to-update-rows.js tests/<файл>.json > rows.json
'use strict';
const fs = require('fs');
const { validate } = require('./src/schema');
const file = process.argv[2];
if (!file) { console.error('Использование: node to-update-rows.js <файл.json>'); process.exit(1); }
const t = JSON.parse(fs.readFileSync(file, 'utf8'));
const errors = validate(t, { strict: process.argv.includes('--strict') });
if (errors.length) { console.error('Тест не прошёл проверку:\n- ' + errors.join('\n- ')); process.exit(1); }
const rows = [];
for (const tk of t.tasks) for (const q of tk.questions) {
  const ans = Array.isArray(q.answer) ? q.answer : [q.answer];
  rows.push({ task_title: tk.title, task_instruction: tk.instruction_ru, type: q.type, prompt: q.prompt, options: q.options || [],
    answer: ans[0], answers: q.type === 'choice' ? [] : ans, explain: q.explanation_ru });
}
console.log(JSON.stringify(rows));
