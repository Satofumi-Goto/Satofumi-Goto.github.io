#!/usr/bin/env node
// 各カードの「更新日」を自動で進める。回(Rev.)の番号は、ユーザーの指示がない限り変えない。
//   node tools/revision-log/update-dates.mjs                 # 監視対象の最終変更日まで進める
//   node tools/revision-log/update-dates.mjs --touch all     # 全カードを今日(JST)にする
//   node tools/revision-log/update-dates.mjs --touch sim,federation
//   node tools/revision-log/update-dates.mjs --new-revision  # 第N+1回に繰り上げ（指示があるときだけ）
// 日付は進む方向にだけ動く（古い日付に戻さない）。JSTで判定する。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = join(root, 'revisions', 'revisions.json');
const data = JSON.parse(readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i < 0 ? null : (args[i + 1] ?? true); };

const jst = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(d); // YYYY-MM-DD
const today = jst(new Date());
const run = (cmd, a, env = {}) =>
  execFileSync(cmd, a, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env, TZ: 'Asia/Tokyo' } }).trim();

function lastLocalChange(paths) {
  let best = '';
  for (const p of paths) {
    const d = run('git', ['log', '-1', '--format=%cd', '--date=format-local:%Y-%m-%d', '--', p]);
    if (d > best) best = d;
  }
  return best;
}

// 非公開リポジトリは読み取りトークンがあるときだけ見る（無ければ黙ってスキップ）
function lastUpstreamChange(repos) {
  const token = process.env.UPSTREAM_READ_TOKEN;
  if (!token) return '';
  let best = '';
  for (const r of repos) {
    try {
      const iso = run('gh', ['api', `repos/${r}/commits?per_page=1`, '-q', '.[0].commit.committer.date'], { GH_TOKEN: token });
      const d = jst(new Date(iso));
      if (d > best) best = d;
    } catch (e) {
      console.warn(`upstream ${r}: unreadable (${String(e.message).split('\n')[0]})`);
    }
  }
  return best;
}

const log = [];
const set = (key, date, why) => {
  const c = data.cards[key];
  if (date && date > c.updated) { log.push(`${key}: ${c.updated} -> ${date} (${why})`); c.updated = date; }
};

if (args.includes('--new-revision')) {
  data.revision += 1;
  for (const k of Object.keys(data.cards)) set(k, today, `Rev. ${data.revision}`);
  log.push(`revision -> ${data.revision}`);
}
const touch = flag('--touch');
if (touch) {
  const keys = touch === 'all' ? Object.keys(data.cards) : String(touch).split(',').map((s) => s.trim());
  for (const k of keys) { if (!data.cards[k]) throw new Error(`unknown card: ${k}`); set(k, today, 'touched'); }
}
for (const [k, c] of Object.entries(data.cards)) {
  set(k, lastLocalChange(c.watch ?? []), 'repo change');
  set(k, lastUpstreamChange(c.upstream ?? []), 'upstream change');
}

if (log.length) writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
console.log(log.length ? log.join('\n') : 'dates already current');
