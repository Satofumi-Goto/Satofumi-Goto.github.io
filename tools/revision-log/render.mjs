#!/usr/bin/env node
// 改訂ログ（各カード下の折り畳み）を revisions/revisions.json から3ページへ描画する。
//   node tools/revision-log/render.mjs          # HTMLを書き換える
//   node tools/revision-log/render.mjs --check  # ずれがあれば終了コード1（書き換えない）
// 何度実行しても結果は同じ（冪等）。ページ内の .rev ブロックは出現順にカードと対応づける。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const data = JSON.parse(readFileSync(join(root, 'revisions', 'revisions.json'), 'utf8'));
const check = process.argv.includes('--check');

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(iso, lang) {
  const [y, m, d] = iso.split('-').map(Number);
  return lang === 'ja' ? `${y}年${m}月${d}日` : `${d} ${MON[m - 1]} ${y}`;
}

function renderBlock(key, lang, indent) {
  const card = data.cards[key];
  const body = card[lang];
  if (!body) throw new Error(`card "${key}" has no "${lang}" text`);
  const label = data.labels[lang];
  const meta = label.meta
    .replace('{rev}', data.revision)
    .replace('{date}', fmtDate(card.updated, lang));
  const i1 = indent + '  ', i2 = i1 + '  ', i3 = i2 + '  ';
  const lines = [
    `<details class="rev" data-rev="${data.revision}" data-card="${esc(key)}">`,
    `${i1}<summary>${esc(label.summary)} <span>${esc(meta)}</span></summary>`,
    `${i1}<div class="rev-body">`,
    `${i2}<p class="rev-head">${esc(body.head)}</p>`,
    // A one-line entry (no items) has no list.
    ...(body.items.length ? [
      `${i2}<ul>`,
      ...body.items.map((it) =>
        `${i3}<li>${it.lead ? `<strong>${esc(it.lead)}</strong>` : ''}${esc(it.text)}</li>`),
      `${i2}</ul>`,
    ] : []),
  ];
  if (body.note) lines.push(`${i2}<p class="rev-note">${esc(body.note)}</p>`);
  lines.push(`${i1}</div>`, `${indent}</details>`);
  return lines.join('\n');
}

const BLOCK = /<details class="rev"[^>]*>[\s\S]*?<\/details>/g;
let drift = 0;

for (const [file, page] of Object.entries(data.pages)) {
  const path = join(root, file);
  const src = readFileSync(path, 'utf8');
  const blocks = [...src.matchAll(BLOCK)];
  if (blocks.length !== page.cards.length) {
    throw new Error(`${file}: ${blocks.length} revision blocks in HTML, ${page.cards.length} cards in JSON`);
  }
  let out = '', pos = 0;
  blocks.forEach((m, n) => {
    const key = page.cards[n];
    const had = /data-card="([^"]*)"/.exec(m[0].split('>')[0]);
    if (had && had[1] !== key) throw new Error(`${file}: block #${n + 1} is "${had[1]}" but JSON expects "${key}"`);
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const lead = src.slice(lineStart, m.index);
    const indent = /^[ \t]*$/.test(lead) ? lead : '';
    out += src.slice(pos, m.index) + renderBlock(key, page.lang, indent);
    pos = m.index + m[0].length;
  });
  out += src.slice(pos);
  if (out !== src) {
    drift++;
    if (check) console.error(`DRIFT: ${file} differs from revisions/revisions.json`);
    else writeFileSync(path, out);
  }
}

if (check && drift) process.exit(1);
console.log(check ? 'revision log is in sync' : drift ? `rendered ${drift} page(s)` : 'already up to date');
