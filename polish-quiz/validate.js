'use strict';

const TYPES = ['choice', 'input', 'multi'];
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;

/**
 * Проверяет тест. Возвращает массив ошибок (пустой — всё в порядке).
 * strict=true (после генерации) дополнительно требует все три типа вопросов.
 */
function validate(t, { strict = false } = {}) {
  const e = [];
  if (!t || typeof t !== 'object') return ['Корень должен быть объектом'];
  if (!nonEmpty(t.topic)) e.push('topic: нужна непустая строка');
  if (!Array.isArray(t.tasks)) return [...e, 'tasks: нужен массив'];
  if (t.tasks.length < 3 || t.tasks.length > 5) e.push(`tasks: нужно 3–5 заданий, сейчас ${t.tasks.length}`);
  const ids = new Set();
  const seen = new Set();
  let total = 0;
  t.tasks.forEach((task, ti) => {
    const tp = `tasks[${ti}]`;
    if (!nonEmpty(task.title)) e.push(`${tp}.title: пусто`);
    if (!nonEmpty(task.instruction_ru)) e.push(`${tp}.instruction_ru: пусто`);
    if (!Array.isArray(task.questions)) return e.push(`${tp}.questions: нужен массив`);
    if (task.questions.length < 3 || task.questions.length > 6) e.push(`${tp}: нужно 3–6 вопросов, сейчас ${task.questions.length}`);
    task.questions.forEach((q, qi) => {
      total++;
      const p = `${tp}.questions[${qi}]`;
      if (!nonEmpty(q.id)) e.push(`${p}.id: пусто`);
      else if (ids.has(q.id)) e.push(`${p}.id: «${q.id}» повторяется`);
      else ids.add(q.id);
      if (!TYPES.includes(q.type)) return e.push(`${p}.type: допустимо ${TYPES.join('/')}`);
      seen.add(q.type);
      if (!nonEmpty(q.prompt)) e.push(`${p}.prompt: пусто`);
      if (!nonEmpty(q.explanation_ru)) e.push(`${p}.explanation_ru: обязательно объяснение на русском`);
      if (q.type === 'input') {
        if (!nonEmpty(q.prompt) || !q.prompt.includes('___')) e.push(`${p}.prompt: в input-вопросе нужен пропуск ___`);
        if (!Array.isArray(q.answer) || !q.answer.length || !q.answer.every(nonEmpty)) e.push(`${p}.answer: массив непустых строк`);
        return;
      }
      const [lo, hi] = q.type === 'choice' ? [3, 4] : [4, 6];
      if (!Array.isArray(q.options) || q.options.length < lo || q.options.length > hi || !q.options.every(nonEmpty)) {
        return e.push(`${p}.options: нужно ${lo}–${hi} непустых вариантов`);
      }
      if (new Set(q.options).size !== q.options.length) e.push(`${p}.options: варианты повторяются`);
      if (q.type === 'choice') {
        if (!nonEmpty(q.answer) || !q.options.includes(q.answer)) e.push(`${p}.answer: должен быть одним из options`);
      } else if (!Array.isArray(q.answer) || q.answer.length < 2 || q.answer.length >= q.options.length
        || !q.answer.every((a) => q.options.includes(a)) || new Set(q.answer).size !== q.answer.length) {
        e.push(`${p}.answer: массив из ≥2 верных вариантов (не всех) из options`);
      }
    });
  });
  if (total < 12 || total > 20) e.push(`Всего вопросов ${total}, нужно 12–20`);
  if (strict) for (const ty of TYPES) if (!seen.has(ty)) e.push(`Нет вопросов типа ${ty}`);
  return e;
}

if (typeof module !== 'undefined') module.exports = { validate };
else window.validateTest = validate;
