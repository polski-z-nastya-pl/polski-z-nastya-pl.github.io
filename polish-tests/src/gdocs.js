'use strict';
const crypto = require('crypto');
const fs = require('fs');
const { fold, need } = require('./util');

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

function readCredentials(raw) {
  const text = raw.trim().startsWith('{') ? raw : fs.readFileSync(raw, 'utf8');
  const c = JSON.parse(text);
  if (!c.client_email || !c.private_key) throw new Error('GOOGLE_CREDENTIALS: нет client_email/private_key');
  return c;
}

/** JWT (RS256) для service account → access token. */
function makeJwt(creds, now = Math.floor(Date.now() / 1000)) {
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({
    iss: creds.client_email, scope: 'https://www.googleapis.com/auth/documents.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(creds.private_key);
  return `${head}.${claim}.${b64u(sig)}`;
}

async function accessToken(creds) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: makeJwt(creds) }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`Google OAuth: ${j.error_description || j.error || r.status}`);
  return j.access_token;
}

async function fetchDoc() {
  const creds = readCredentials(need('GOOGLE_CREDENTIALS'));
  const token = await accessToken(creds);
  const r = await fetch(`https://docs.googleapis.com/v1/documents/${need('DOC_ID')}?includeTabsContent=true`,
    { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!r.ok) {
    const hint = r.status === 403 || r.status === 404
      ? ` Дайте доступ «Читатель» на документ адресу ${creds.client_email}.` : '';
    throw new Error(`Google Docs API: ${j.error?.message || r.status}.${hint}`);
  }
  return j;
}

// ---------- разбор документа ----------
function flattenTabs(tabs = []) {
  return tabs.flatMap((t) => [t, ...flattenTabs(t.childTabs)]);
}

function paraText(p) {
  return (p.elements || []).map((e) => e.textRun?.content ?? '').join('').replace(/\n$/, '');
}

function contentToText(content = []) {
  const out = [];
  for (const el of content) {
    if (el.paragraph) {
      const t = paraText(el.paragraph);
      if (!t.trim()) continue;
      const style = el.paragraph.paragraphStyle?.namedStyleType || '';
      const h = style.match(/^HEADING_(\d)$/);
      out.push(h ? `${'#'.repeat(+h[1])} ${t}` : el.paragraph.bullet ? `- ${t}` : t);
    } else if (el.table) {
      for (const row of el.table.tableRows || []) {
        out.push(row.tableCells.map((c) => contentToText(c.content).replace(/\n+/g, ' / ')).join(' | '));
      }
      out.push('');
    }
  }
  return out.join('\n').trim();
}

function headingLevel(el) {
  const m = el.paragraph?.paragraphStyle?.namedStyleType?.match(/^HEADING_(\d)$/);
  return m && paraText(el.paragraph).trim() ? +m[1] : 0;
}

/** Темы: если вкладок несколько — по вкладке; иначе — по заголовкам верхнего уровня (H1, при их отсутствии H2). */
function listTopics(doc) {
  const tabs = flattenTabs(doc.tabs).filter((t) => t.documentTab);
  if (tabs.length > 1) {
    return tabs.map((t) => ({ title: t.tabProperties?.title || 'Без названия', text: contentToText(t.documentTab.body.content) }));
  }
  const content = tabs.length ? tabs[0].documentTab.body.content : doc.body?.content || [];
  const levels = content.map(headingLevel).filter(Boolean);
  if (!levels.length) return [{ title: doc.title || 'Документ', text: contentToText(content) }];
  const top = Math.min(...levels);
  const topics = [];
  let cur = null;
  for (const el of content) {
    if (headingLevel(el) === top) { cur = { title: paraText(el.paragraph).trim(), parts: [] }; topics.push(cur); }
    else if (cur) cur.parts.push(el);
  }
  return topics.map((t) => ({ title: t.title, text: contentToText(t.parts) }));
}

function findTopic(topics, query) {
  const q = fold(query).trim();
  const exact = topics.filter((t) => fold(t.title).trim() === q);
  const found = exact.length ? exact : topics.filter((t) => fold(t.title).includes(q));
  if (found.length === 1) return found[0];
  throw new Error(found.length
    ? `Тема «${query}» неоднозначна: ${found.map((t) => t.title).join(', ')}`
    : `Тема «${query}» не найдена. Доступные: ${topics.map((t) => t.title).join(', ')}`);
}

module.exports = { fetchDoc, listTopics, findTopic, contentToText, makeJwt, readCredentials };
