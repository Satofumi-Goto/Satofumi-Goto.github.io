// Regression tests for the remote-ops simulation engine. Run: node remote-ops/tests/sim.test.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Sim, ITYPES, COMMANDS, CAUSES } from '../sim.js';
import { D } from '../i18n.js';

const dir = fileURLToPath(new URL('..', import.meta.url));
let fail = 0, pass = 0;
const ok = (cond, name, info = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, info); } };
const run = (s, sec) => { for (let i = 0; i < sec * 10; i++) s.step(0.1); };
const fresh = (seed = 11) => { const s = new Sim(seed); s.settings.auto = false; s.settings.team = false; run(s, 40); return s; };

// 1. fleet serves demand without an operator
{ const s = fresh(); run(s, 1800); ok(s.stats.served >= 10, 'serves trips unattended', s.stats.served); }

// 2. every incident type can be completed by following its SOP (team auto-demo operator)
for (const type of Object.keys(ITYPES)) {
  let done = false, info = '';
  for (const seed of [3, 5, 8]) {
    const s = fresh(seed); s.settings.team = true; s.settings.teamAll = true;
    let inc = null;
    for (let k = 0; k < 300 && !inc; k++) {
      if (type === 'battery') { const v = s.vehicles.find(v => v.mode === 'AUTO' && !s.openIncs(v).length); if (v) { v.soc = 14.9; run(s, 1); inc = s.incidents.find(i => i.type === 'battery'); } }
      else if (type === 'wheelchair') { const b = s.newBooking({ wc: true }); run(s, 1); inc = s.incidents.find(i => i.type === 'wheelchair'); if (!inc) run(s, 5); }
      else if (type === 'link_loss') { const v = s.vehicles.find(v => v.mode === 'AUTO' && v.v > 3 && !s.openIncs(v).length); if (v) { s.raise('latency', v); v.net.degraded = 1400; run(s, 6); inc = s.incidents.find(i => i.type === 'link_loss'); } }
      else if (type === 'signal') { s.inject('signal'); run(s, 2); inc = s.incidents.find(i => i.type === 'signal'); }
      else { const r = s.inject(type); if (r && r.id) inc = r; else run(s, 1); }
    }
    if (!inc) { info = 'could not raise'; continue; }
    for (let k = 0; k < 900 && inc.status !== 'RESOLVED'; k++) run(s, 1);
    info = `${inc.status} pending=${s.pendingSteps(inc).map(x => x.id)}`;
    if (inc.status === 'RESOLVED' && !inc.forced) { done = true; break; }
  }
  ok(done, `SOP completes: ${type}`, info);
}

// 3. interlocks
{
  const s = fresh();
  const inc = (() => { for (let k = 0; k < 100; k++) { const r = s.inject('obstacle'); if (r && r.id) return r; run(s, 1); } })();
  run(s, 6); const v = s.veh(inc.vid);
  ok(s.interlock('approve_path', v, inc) === 'il_sop_first', 'approve_path needs SOP visual checks');
  ok(s.checkStep(inc.id, 'obs_cam').reason === 'il_cam_first', 'visual check needs camera view');
  v.camSec.front = (v.camSec.front || 0) + 2; v.camSec.bev = (v.camSec.bev || 0) + 2;
  s.checkStep(inc.id, 'obs_cam'); s.checkStep(inc.id, 'obs_side');
  v.net.degraded = 500; run(s, 4);
  ok(s.interlock('approve_path', v, inc) === 'il_rtt', 'approve_path blocked at RTT >= 300 ms', s.interlock('approve_path', v, inc));
  v.net.degraded = 0; run(s, 5);
  ok(s.interlock('approve_path', v, inc) === null, 'approve_path allowed after checks with good link');
  ok(s.interlock('resume', v, inc) === 'il_use_assist', 'plain resume refused during assist request');
}
{
  const s = fresh();
  const inc = (() => { for (let k = 0; k < 100; k++) { const r = s.inject('collision'); if (r && r.id) return r; run(s, 1); } })();
  run(s, 8); const v = s.veh(inc.vid);
  ok(v.mode === 'MRC', 'collision ends in MRC', v.mode);
  ok(s.interlock('resume', v, inc) === 'il_collision', 'no resume after contact');
  ok(s.resolve(inc.id, 'external').ok === false, 'cannot close with pending steps');
}
{
  const s = fresh(); const w = s.inject('weather'); const z = s.zone(w.zone);
  ok(s.interlock('zone_suspend', null, w, z) === null, 'zone can be suspended');
  s.command('zone_suspend', { zoneId: z.id, incId: w.id }); run(s, 1);
  ok(z.odd === 'SUSPENDED', 'zone suspended');
  ok(s.interlock('zone_restore', null, w, z) === 'il_wx_active', 'zone restore blocked while raining');
}
{
  const s = fresh(); const v = s.vehicles.find(v => v.mode === 'AUTO' && v.v > 3);
  v.net.degraded = 1400; run(s, 6);
  ok(['MRM', 'MRC'].includes(v.mode), 'watchdog MRM on link loss', v.mode);
  const r = s.command('door_open', { vid: v.id });
  ok(!r.ok && r.reason === 'il_link_lost', 'commands refused while link lost');
}

// 4. soak: auto-demo operator, no stuck incidents
for (const seed of [1, 42, 20261112]) {
  const s = new Sim(seed); s.settings.intensity = 2; s.settings.teamAll = true; run(s, 2 * 3600);
  const stale = s.incidents.filter(i => i.status !== 'RESOLVED' && s.t - i.created > 900);
  ok(stale.length === 0, `soak seed ${seed}: no incident open >15 min`, stale.map(i => i.type + ':' + s.pendingSteps(i).map(x => x.id)).join(' '));
  ok(!s.incidents.some(i => i.forced), `soak seed ${seed}: no forced closures`);
  ok(s.stats.served > 40, `soak seed ${seed}: trips served`, s.stats.served);
}

// 5. i18n completeness
{
  const src = ['app.js', 'render.js', 'sim.js', 'index.html'].map(f => fs.readFileSync(dir + f, 'utf8')).join('\n');
  const used = new Set();
  for (const m of src.matchAll(/t\('([a-z]+_[A-Za-z0-9_]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/data-i="([a-z_0-9]+)"/g)) used.add(m[1]);
  for (const m of src.matchAll(/'((?:ui|lg|il|ac|an)_[a-z0-9_]+|tr_[a-z]+_\d)'/g)) used.add(m[1]);
  for (const c of Object.keys(COMMANDS)) { used.add('c_' + c); if (COMMANDS[c].confirm === 1) used.add('cx_' + c); }
  for (const k of Object.keys(ITYPES)) { used.add('it_' + k); ITYPES[k].steps.forEach(st => used.add('sp_' + st.id)); }
  CAUSES.forEach(c => used.add('cause_' + c));
  const missing = [...used].filter(k => !D[k]);
  ok(missing.length === 0, 'all i18n keys defined', missing.join(' '));
  ok(Object.values(D).every(v => Array.isArray(v) && v.length === 2 && v[0] && v[1]), 'every key has ja and en');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
