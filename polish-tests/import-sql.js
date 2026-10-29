#!/usr/bin/env node
// Печатает SQL для импорта теста (JSON генератора/чата) в Supabase как черновик.
// Использование: node import-sql.js tests/<файл>.json [A2|B1] > import.sql
'use strict';
const fs = require('fs');
const { validate } = require('./src/schema');

const [file, level = 'B1'] = process.argv.slice(2);
if (!file || !['A2', 'B1'].includes(level)) { console.error('Использование: node import-sql.js <файл.json> [A2|B1]'); process.exit(1); }
const t = JSON.parse(fs.readFileSync(file, 'utf8'));
const errors = validate(t);
if (errors.length) { console.error('Тест не прошёл проверку:\n- ' + errors.join('\n- ')); process.exit(1); }
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const title = t.topic + (t.student ? ` (${t.student})` : '');
const json = JSON.stringify(t);
if (json.includes('$json$')) { console.error('В тексте теста есть запрещённая последовательность $json$'); process.exit(1); }
console.log(`with t as (insert into public.tests (title,description,level,topic,published,for_all,created_by) values (${q(title)},${q('Создан ' + (t.created || '') + '. Черновик — проверить перед публикацией')},${q(level)},'Грамматика',false,false,null) returning id),
d as (select $json$${json}$json$::jsonb j)
insert into public.questions (test_id,position,type,prompt,options,answer,answers,explain,task_title,task_instruction)
select t.id, row_number() over (order by tko, qo), q->>'type', q->>'prompt', coalesce(q->'options','[]'::jsonb),
 case when jsonb_typeof(q->'answer')='array' then q->'answer'->>0 else q->>'answer' end,
 case when q->>'type'='choice' then '[]'::jsonb else q->'answer' end, q->>'explanation_ru', tk->>'title', tk->>'instruction_ru'
from t, d, jsonb_array_elements(d.j->'tasks') with ordinality as a(tk,tko), jsonb_array_elements(tk->'questions') with ordinality as b(q,qo);`);
