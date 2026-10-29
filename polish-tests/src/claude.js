'use strict';
const { need } = require('./util');
const { validate } = require('./schema');

const SYSTEM = `Ты — методист польского языка. Составляешь тесты-домашки для взрослой русскоязычной ученицы уровня A2→B1, которая готовится к экзамену B1.
Отвечай ТОЛЬКО одним JSON-объектом, без пояснений и без markdown-ограждений.`;

function buildPrompt(topic, text, n) {
  return `Составь тест по теме «${topic}» ТОЛЬКО на основе материала ниже.

ТРЕБОВАНИЯ
- Заданий 3–5, в каждом 3–6 вопросов, всего около ${n} (допустимо 12–20).
- Типы вопросов: "choice" (3–4 варианта, один верный), "input" (вписать форму в пропуск ___), "multi" (4–6 вариантов, отметить все верные, верных ≥2 и не все). Используй все три типа.
- Проверяй именно грамматику этой темы и покрой ВСЕ подпункты материала, включая исключения.
- Не копируй упражнения из материала дословно: придумай новые предложения на ту же грамматику. Лексика A2–B1, бытовые темы.
- Неверные варианты в choice/multi — типичные ошибки русскоговорящих: перенос русского рода и падежей, mi/mnie, jego/go, ich/je и т. п.
- Каждый вопрос должен иметь ОДНОЗНАЧНЫЙ правильный ответ: если возможны две допустимые формы, перечисли обе в answer у input и не включай спорные варианты в choice/multi.
- У каждого вопроса обязательно "explanation_ru": 1–2 предложения по-русски, почему именно так.
- Польский текст: prompt вопросов; русский: instruction_ru и explanation_ru. В input-вопросах в prompt есть пропуск ___, при необходимости подсказка в скобках.
- "id": q1, q2, … сквозная нумерация, без повторов.

ФОРМАТ (строго):
{"topic": "${topic}", "tasks": [{"title": "<польский заголовок>", "instruction_ru": "<что делать>", "questions": [
 {"id": "q1", "type": "choice", "prompt": "...___...", "options": ["..","..",".."], "answer": "..", "explanation_ru": "..."},
 {"id": "q2", "type": "input", "prompt": "...___ (ona).", "answer": ["nią"], "explanation_ru": "..."},
 {"id": "q3", "type": "multi", "prompt": "...", "options": ["..","..","..",".."], "answer": ["..",".."], "explanation_ru": "..."}
]}]}

МАТЕРИАЛ ТЕМЫ
"""
${text}
"""`;
}

function extractJson(s) {
  const t = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('в ответе нет JSON');
  return JSON.parse(t.slice(a, b + 1));
}

async function callClaude(messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': need('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5', max_tokens: 8192, system: SYSTEM, messages }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`Anthropic API: ${j.error?.message || r.status}`);
  return j.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
}

/** Генерирует тест; при невалидном ответе повторяет запрос до 2 раз, передавая список ошибок. */
async function generateTest(topic, text, n = 15, { call = callClaude, log = () => {} } = {}) {
  const messages = [{ role: 'user', content: buildPrompt(topic, text, n) }];
  let errors = [];
  for (let attempt = 0; attempt <= 2; attempt++) {
    const reply = await call(messages);
    let data = null;
    try { data = extractJson(reply); errors = validate(data, { strict: true }); }
    catch (e) { errors = [`ответ не разобран как JSON: ${e.message}`]; }
    if (!errors.length) return data;
    log(`Попытка ${attempt + 1}: ${errors.length} замечаний, ${attempt < 2 ? 'повторяю запрос' : 'остановка'}`);
    messages.push({ role: 'assistant', content: reply },
      { role: 'user', content: `В JSON найдены ошибки:\n- ${errors.slice(0, 15).join('\n- ')}\nИсправь и верни полный JSON целиком, только JSON.` });
  }
  throw new Error(`Claude не вернул валидный тест за 3 попытки:\n- ${errors.slice(0, 8).join('\n- ')}`);
}

module.exports = { generateTest, buildPrompt, extractJson };
