'use strict';
const fs = require('fs');
const path = require('path');
const { validate } = require('./schema');
const { slug } = require('./util');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** JSON внутри <script>: экранируем «<» и разделители строк, чтобы данные не закрыли тег. */
const safeJson = (o) => JSON.stringify(o)
  .replace(/</g, '\\u003c')
  .replace(new RegExp('\\u2028', 'g'), '\\u2028')
  .replace(new RegExp('\\u2029', 'g'), '\\u2029');

function buildHtml(test, { webhook = '' } = {}) {
  const errors = validate(test);
  if (errors.length) throw new Error('JSON не прошёл проверку:\n- ' + errors.join('\n- '));
  const tpl = fs.readFileSync(path.join(__dirname, '..', 'template', 'test.html'), 'utf8');
  return tpl
    .replace('__TITLE__', () => esc(`${test.topic} — тест`))
    .replace('__WEBHOOK__', () => esc(webhook))
    .replace('/*__DATA__*/', () => safeJson(test));
}

function outName(test) {
  return `${slug(test.topic)}-${test.created || new Date().toISOString().slice(0, 10)}.html`;
}

module.exports = { buildHtml, outName };
