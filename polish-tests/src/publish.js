'use strict';
const fs = require('fs');
const path = require('path');
const { need, slug } = require('./util');

/** Кладёт файл в docs/ репозитория через GitHub Contents API; GitHub Pages должен отдавать папку /docs. */
async function publish(file, { student = process.env.STUDENT_NAME || '' } = {}) {
  const repo = need('GITHUB_REPO'), token = need('GITHUB_TOKEN');
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error('GITHUB_REPO должен быть вида owner/name');
  const fname = `${student ? slug(student) + '-' : ''}${path.basename(file)}`;
  const api = `https://api.github.com/repos/${repo}/contents/docs/${encodeURIComponent(fname)}`;
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'polish-tests', 'X-GitHub-Api-Version': '2022-11-28' };
  const cur = await fetch(api, { headers: h });
  const sha = cur.ok ? (await cur.json()).sha : undefined;
  if (!cur.ok && cur.status !== 404) throw new Error(`GitHub: ${cur.status} ${(await cur.json()).message || ''}`);
  const r = await fetch(api, { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Add test ${fname}`, content: fs.readFileSync(file).toString('base64'), sha }) });
  if (!r.ok) throw new Error(`GitHub: ${r.status} ${(await r.json()).message || ''}`);
  return `https://${owner.toLowerCase()}.github.io/${name}/${encodeURIComponent(fname)}`;
}

module.exports = { publish };
