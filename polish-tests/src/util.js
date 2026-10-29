'use strict';
const fs = require('fs');
const path = require('path');

const CYR = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',і:'i',ї:'yi',є:'ye',ґ:'g' };

/** Убирает диакритику (включая ł), приводит к нижнему регистру. */
function fold(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();
}

function slug(s) {
  const t = fold(s).split('').map((c) => (c in CYR ? CYR[c] : c)).join('');
  return t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'test';
}

const today = () => new Date().toISOString().slice(0, 10);

/** Минимальный загрузчик .env (без зависимостей). Уже заданные переменные окружения не перезаписываются. */
function loadEnv(file = path.join(process.cwd(), '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана переменная ${name} (см. .env.example)`);
  return v;
}

module.exports = { fold, slug, today, loadEnv, need };
