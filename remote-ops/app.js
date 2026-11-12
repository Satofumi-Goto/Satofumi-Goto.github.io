// UI controller for the remote monitoring & operations console.
import { Sim, ITYPES, COMMANDS, CAUSES, CAMS, SLA, ME, RTT_ASSIST_MAX, STATE_SEVERITY } from './sim.js';
import { MapView, drawCam, readTheme, col, MODE_COLOR } from './render.js';
import { t, getLang, setLang, nodeLabel, zoneLabel } from './i18n.js';
import { node, HUB, LINES, nearestNode, zoneAt } from './world.js';

const sim = new Sim();
window.__sim = sim;
window.__ops = { S: null };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { sel: null, selInc: null, qf: 'open', lf: 'all', tab: 'log', zoneSel: null, cam: 'front', speed: 1, paused: false, muteUntil: 0, modal: null, rtt: {}, lastAlarm: 0, flashP1: new Set() };
setTimeout(() => { window.__ops.S = S; });
const store = { get(k, d) { try { const v = localStorage.getItem('rop.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('rop.' + k, JSON.stringify(v)); } catch (e) {} } };

// ---------- formatting ----------
const clockAt = st => new Date(sim.epoch + st * 1000);
const hms = st => clockAt(st).toLocaleTimeString('ja-JP', { hour12: false, timeZone: 'Asia/Tokyo' });
const dur = s => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };
const kmh = v => (v * 3.6).toFixed(0);
const modeBadge = m => `<span class="mode" style="background:${col(MODE_COLOR[m])};${['WAIT_ASSIST'].includes(m) ? 'color:#222' : ''}">${esc(t('m_' + m))}</span>`;
const pp = p => `<span class="pp p${p}">P${p}</span>`;
const opName = id => { const o = sim.op(id); return o ? `${id}${o.me ? ' (' + t('ui_me') + ')' : ''}` : (id === 'SYSTEM' ? t('ui_system') : id || '—'); };
function setHTML(el, html) { if (el && el._h !== html) { el.innerHTML = html; el._h = html; } }

// ---------- static i18n ----------
function applyStatic() {
  document.documentElement.lang = getLang();
  document.querySelectorAll('[data-i]').forEach(el => { el.textContent = t(el.dataset.i); });
  $('btnLang').textContent = getLang() === 'ja' ? 'EN' : 'JA';
  $('btnTheme').textContent = document.documentElement.dataset.theme === 'dark' ? '☀' : '☾';
  document.title = t('ui_title') + ' | UrbanOS';
  $('legend').innerHTML = ['AUTO', 'DWELL', 'WAIT_ASSIST', 'REMOTE_GUIDED', 'MRC', 'MANUAL', 'CHARGING', 'IDLE'].map(m => `<span class="st"><i style="background:${col(MODE_COLOR[m])}"></i>${esc(t('m_' + m))}</span>`).join('');
  document.querySelector('.badge.train').title = t('ui_training_note');
  S.panelKey = null;
  ['qlist', 'ftable', 'bbody', 'kpis', 'fleetchips'].forEach(id => { $(id)._h = null; });
}

// ---------- theme ----------
function applyTheme(th) { document.documentElement.dataset.theme = th; store.set('theme', th); readTheme(); applyStatic(); }

// ---------- map ----------
const map = new MapView($('map'), sim, p => {
  if (p.vid) selectVehicle(p.vid);
  else if (p.zone) { S.zoneSel = p.zone; setTab('zone'); }
});
function resize() { map.resize(); const m = $('camMain'); if (m) sizeCanvas(m); }
function sizeCanvas(c) { const r = c.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1); c.width = Math.max(2, Math.round(r.width * d)); c.height = Math.max(2, Math.round(r.height * d)); c.getContext('2d').setTransform(d, 0, 0, d, 0, 0); c._w = r.width; c._h = r.height; }

// ---------- sound ----------
let AC = null;
function audio() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } return AC; }
function tone(f, d, when = 0, type = 'sine', vol = 0.08) {
  const ac = audio(); if (!ac || muted()) return;
  const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.value = f; g.gain.value = vol;
  o.connect(g); g.connect(ac.destination); const t0 = ac.currentTime + when; o.start(t0); g.gain.setTargetAtTime(0, t0 + d * 0.7, 0.03); o.stop(t0 + d + 0.1);
}
function beep(kind) {
  if (kind === 'p1') { tone(880, .18, 0, 'square', .06); tone(660, .18, .22, 'square', .06); tone(880, .18, .44, 'square', .06); }
  else if (kind === 'p2') { tone(740, .15, 0, 'triangle'); tone(740, .15, .2, 'triangle'); }
  else if (kind === 'p3') tone(620, .12, 0, 'sine', .05);
  else if (kind === 'deny') tone(200, .15, 0, 'sawtooth', .04);
  else if (kind === 'ok') tone(980, .07, 0, 'sine', .04);
}
const muted = () => Date.now() < S.muteUntil;

// ---------- toasts ----------
function toast(msg, lvl = 'info', ms = 4200) {
  const el = document.createElement('div'); el.className = 'toast ' + lvl; el.innerHTML = msg; $('toasts').prepend(el);
  setTimeout(() => el.remove(), ms);
  while ($('toasts').children.length > 5) $('toasts').lastChild.remove();
}

// ---------- events from sim ----------
sim.on(ev => {
  if (ev.type === 'incident') {
    const i = ev.inc;
    beep('p' + i.prio);
    if (i.prio === 1) { $('flash').classList.remove('on'); void $('flash').offsetWidth; $('flash').classList.add('on'); }
    toast(`${pp(i.prio)} <b>${esc(i.vid || zoneLabel(i.zone))}</b> ${esc(t('it_' + i.type))}`, i.prio === 1 ? 'crit' : i.prio === 2 ? 'warn' : 'info');
    if (!S.sel && i.prio === 1) selectVehicle(i.vid, i.id);
  }
  if (ev.type === 'log' && ev.e.op && ev.e.op !== ME && ev.e.op !== 'SYSTEM' && ev.e.key === 'lg_ack') {
    /* teammates take work quietly */
  }
  if (ev.type === 'sla') toast(`${pp(ev.inc.prio)} ${esc(t('ui_sla_breach', { id: ev.inc.id }))}`, 'crit');
});

// ---------- selection ----------
function selectVehicle(vid, incId = null) {
  const v = sim.veh(vid); if (!v) return;
  S.sel = vid; map.sel = vid;
  const top = sim.topInc(v);
  S.selInc = incId || (top && top.id) || null;
  const inc = S.selInc && sim.inc(S.selInc);
  if (inc) { const s = sim.pendingSteps(inc).find(x => x.cam); if (s) S.cam = s.cam; }
  S.panelKey = null; renderPanel();
}
function selectIncident(id) {
  const inc = sim.inc(id); if (!inc) return;
  if (inc.vid) { selectVehicle(inc.vid, id); const v = sim.veh(inc.vid); map.centerOn(v.x, v.y); }
  else { S.sel = null; map.sel = null; S.selInc = id; S.zoneSel = inc.zone; S.panelKey = null; renderPanel(); }
}

// ---------- commands ----------
function doCommand(name, o = {}) {
  const vid = o.vid !== undefined ? o.vid : S.sel;
  const v = vid ? sim.veh(vid) : null;
  const inc = o.incId ? sim.inc(o.incId) : (v ? (S.selInc && sim.inc(S.selInc)?.vid === vid ? sim.inc(S.selInc) : sim.topInc(v)) : (S.selInc ? sim.inc(S.selInc) : null));
  const zone = o.zoneId ? sim.zone(o.zoneId) : null;
  const reason = sim.interlock(name, v, inc, zone);
  if (reason) { toast(`<b>${esc(t('c_' + name))}</b>: ${esc(t(reason, { cam: 'front' }))}`, 'warn'); beep('deny'); return; }
  if (name === 'announce' && !o.args) return openAnnounce(vid, inc);
  if (name === 'e_stop') return send(name, vid, inc, o.zoneId, o.args);
  if (COMMANDS[name].confirm === 1 && !o.confirmed) return openConfirm(name, v, inc, zone, o);
  send(name, vid, inc, o.zoneId, o.args);
}
function send(name, vid, inc, zoneId, args = {}) {
  const res = sim.command(name, { vid, incId: inc && inc.id, zoneId, args });
  if (!res.ok) { toast(esc(t(res.reason)), 'warn'); beep('deny'); return; }
  beep('ok');
  const sc = COMMANDS[name].scope;
  toast(`${esc(t(sc === 'v' ? 'ui_cmd_sent' : 'ui_cmd_done', { cmd: name }))}${vid ? ' · <b>' + esc(vid) + '</b>' : ''}`, 'ok', 2600);
  updateUI(true);
}

// ---------- modals ----------
function openModal(html, wide = false, onKey = null) {
  const m = $('modal'), b = $('mbox'); b.className = 'mbox' + (wide ? ' wide' : ''); b.innerHTML = html; m.hidden = false; S.modal = { onKey };
  const f = b.querySelector('[autofocus]') || b.querySelector('button.pri') || b.querySelector('button'); if (f) f.focus();
}
function closeModal() { $('modal').hidden = true; S.modal = null; }
$('modal').addEventListener('pointerdown', e => { if (e.target === $('modal')) closeModal(); });
$('mbox').addEventListener('click', e => { const b = e.target.closest('[data-close]'); if (b) closeModal(); });

function facts(v) {
  if (!v) return [];
  const r = Math.round(v.net.rtt);
  return [
    [r < RTT_ASSIST_MAX, `RTT ${r} ms（< ${RTT_ASSIST_MAX}）`],
    [true, `${t('ui_speed')} ${kmh(v.v)} km/h · ${t('m_' + v.mode)}`],
    [v.doors === 'CLOSED', `${t('ui_doors')}: ${t('door_' + v.doors)}`],
    [true, `${t('ui_pax')} ${v.pax}/${v.cap} · ${zoneLabel(sim.zoneOf(v))}（${t('odd_' + sim.zone(sim.zoneOf(v)).odd)}）`],
  ];
}
function openConfirm(name, v, inc, zone, o) {
  const f = facts(v);
  let sop = '';
  if (inc) { const steps = ITYPES[inc.type].steps.filter(s => sim.stepRequired(inc, s)); const done = steps.filter(s => inc.steps[s.id]).length; sop = `<li class="${done === steps.length ? '' : 'ng'}">SOP ${done}/${steps.length} · ${esc(inc.id)} ${esc(t('it_' + inc.type))}</li>`; }
  openModal(`<header><h2>${esc(t('ui_confirm'))}: ${esc(t('c_' + name))}</h2><span class="mono">${esc(v ? v.id : zoneLabel(zone && zone.id))}</span></header>
    <div class="mb"><p>${esc(t('cx_' + name))}</p>
    ${v ? `<ul class="pre">${f.map(([ok, s]) => `<li class="${ok ? '' : 'ng'}">${esc(s)}</li>`).join('')}${sop}</ul>` : ''}
    <p class="mut">${esc(t('ui_confirm_note'))}</p></div>
    <footer><button class="btn" data-close>${esc(t('ui_cancel'))} <kbd>Esc</kbd></button><button class="btn pri" id="cfGo">${esc(t('ui_execute'))} <kbd>Enter</kbd></button></footer>`, false,
    e => { if (e.key === 'Enter') { $('cfGo').click(); return true; } });
  $('cfGo').onclick = () => { closeModal(); send(name, v ? v.id : null, inc, zone ? zone.id : o.zoneId, o.args); };
}
function openAnnounce(vid, inc) {
  const list = ['an_safety', 'an_stop', 'an_resume', 'an_seat', 'an_alight', 'an_delay', 'an_door'];
  openModal(`<header><h2>${esc(t('c_announce'))} · ${esc(vid)}</h2></header><div class="mb"><p class="mut">${esc(t('ui_announce_note'))}</p>
    <div class="tgrid">${list.map((k, i) => `<button class="btn" data-an="${k}">${i + 1}. ${esc(t(k))}</button>`).join('')}</div></div>
    <footer><button class="btn" data-close>${esc(t('ui_cancel'))}</button></footer>`, false,
    e => { const n = +e.key; if (n >= 1 && n <= list.length) { $('mbox').querySelector(`[data-an="${list[n - 1]}"]`).click(); return true; } });
  $('mbox').querySelectorAll('[data-an]').forEach(b => b.onclick = () => { closeModal(); send('announce', vid, inc, null, { msg: b.dataset.an }); });
}
function openResolve(incId) {
  const inc = sim.inc(incId); if (!inc || inc.status === 'RESOLVED') return;
  const pend = sim.pendingSteps(inc);
  const def = inc.type === 'sos' && inc.data.subtype === 'mistake' && inc.data.revealed ? 'false_alarm' : ITYPES[inc.type].cause;
  openModal(`<header><h2>${esc(t('ui_resolve'))} · ${esc(inc.id)}</h2>${pp(inc.prio)}</header><div class="mb">
    <p><b>${esc(t('it_' + inc.type))}</b> · ${esc(inc.vid || zoneLabel(inc.zone))} · ${esc(t('ui_elapsed'))} ${dur(sim.t - inc.created)}</p>
    <label class="f">${esc(t('ui_cause'))}</label><select id="rsCause">${CAUSES.map(c => `<option value="${c}" ${c === def ? 'selected' : ''}>${esc(t('cause_' + c))}</option>`).join('')}</select>
    <label class="f">${esc(t('ui_note'))}</label><textarea id="rsNote" placeholder="${esc(t('ui_note_ph'))}"></textarea>
    ${pend.length ? `<p class="bad">${esc(t('il_steps_pending', { n: pend.length }))}</p><ul class="pre">${pend.map(s => `<li class="ng">${esc(t('sp_' + s.id))}</li>`).join('')}</ul>
      <label class="chk"><input type="checkbox" id="rsForce"> ${esc(t('ui_force'))}</label>` : ''}
    </div><footer><button class="btn" data-close>${esc(t('ui_cancel'))}</button><button class="btn pri" id="rsGo">${esc(t('ui_resolve'))}</button></footer>`);
  $('rsGo').onclick = () => {
    const force = $('rsForce') ? $('rsForce').checked : false;
    const res = sim.resolve(incId, $('rsCause').value, $('rsNote').value.trim(), ME, force);
    if (!res.ok) { toast(esc(t(res.reason, res.p)), 'warn'); beep('deny'); return; }
    closeModal(); toast(esc(t('ui_resolved_toast', { id: incId })), 'ok'); updateUI(true);
  };
}
function openReassign(incId) {
  const inc = sim.inc(incId); if (!inc) return;
  openModal(`<header><h2>${esc(t('ui_reassign'))} · ${esc(inc.id)}</h2></header><div class="mb">
    <label class="f">${esc(t('ui_to'))}</label><select id="raTo">${sim.ops.filter(o => o.id !== inc.assignee).map(o => `<option value="${o.id}">${esc(o.id)} ${esc(o.name[getLang()])}</option>`).join('')}</select>
    <label class="f">${esc(t('ui_handover_note'))}</label><textarea id="raNote" placeholder="${esc(t('ui_ra_ph'))}"></textarea></div>
    <footer><button class="btn" data-close>${esc(t('ui_cancel'))}</button><button class="btn pri" id="raGo">${esc(t('ui_reassign'))}</button></footer>`);
  $('raGo').onclick = () => { sim.assign(incId, $('raTo').value, $('raNote').value.trim()); closeModal(); updateUI(true); };
}
function incReport(inc) {
  const v = sim.veh(inc.vid); const L = getLang();
  const rows = [];
  rows.push(`${t('ui_rep_title')}`);
  rows.push('='.repeat(44));
  rows.push(`${t('ui_rep_no')}: ${inc.id}    ${t('ui_rep_prio')}: P${inc.prio}    ${t('ui_rep_status')}: ${t('st_' + inc.status)}`);
  rows.push(`${t('ui_rep_type')}: ${t('it_' + inc.type)}`);
  if (v) rows.push(`${t('ui_rep_vehicle')}: ${v.id} (${t(v.type === 'RT' ? 'ui_robotaxi' : 'ui_shuttle')})`);
  rows.push(`${t('ui_rep_zone')}: ${zoneLabel(inc.zone)}`);
  if (inc.x != null) rows.push(`${t('ui_rep_pos')}: ${t('ui_near')} ${nodeLabel(nearestNode(inc.x, inc.y).id)} (x=${inc.x.toFixed(0)}, y=${inc.y.toFixed(0)})`);
  rows.push(`${t('ui_rep_created')}: ${clockAt(inc.created).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })} ${hms(inc.created)} JST`);
  rows.push(`${t('ui_rep_ack')}: ${inc.ack != null ? '+' + dur(inc.ack - inc.created) + ' · ' + opName(inc.assignee) : '—'}  (SLA ${SLA[inc.prio]}s: ${inc.slaMissed ? t('ui_missed') : t('ui_met')})`);
  rows.push(`${t('ui_rep_resolved')}: ${inc.resolved != null ? '+' + dur(inc.resolved - inc.created) + ' · ' + opName(inc.closedBy) + (inc.autoNote ? ' · ' + t(inc.autoNote) : '') + (inc.forced ? ' · ' + t('ui_forced') : '') : '—'}`);
  rows.push(`${t('ui_rep_pax')}: ${inc.data.pax}    ${t('ui_rep_bookings')}: ${inc.bookings.length ? inc.bookings.join(', ') : '—'}`);
  if (inc.data.cause) rows.push(`${t('ui_rep_detail')}: ${t((inc.type === 'mrm' ? 'mc_' : 'sc_') + inc.data.cause)}`);
  if (inc.type === 'sos' && inc.data.revealed) rows.push(`${t('ui_rep_detail')}: ${t(inc.data.subtype === 'medical' ? 'lg_sos_medical' : 'lg_sos_mistake')}`);
  if (inc.data.g) rows.push(`${t('ui_rep_detail')}: IMU ${inc.data.g} G`);
  rows.push(`${t('ui_cause')}: ${inc.cause ? t('cause_' + inc.cause) : '—'}`);
  rows.push(`${t('ui_note')}: ${inc.note || '—'}`);
  rows.push('');
  rows.push(`[${t('ui_rep_sop')}]`);
  for (const s of ITYPES[inc.type].steps) {
    const d = inc.steps[s.id], req = sim.stepRequired(inc, s);
    rows.push(` ${d ? '[x]' : req ? '[ ]' : '[-]'} ${t('sp_' + s.id)}${d ? `  (${hms(d.t)} ${d.by}${d.cmd ? ' · ' + t('c_' + d.cmd) : ''})` : req ? '' : '  ' + t('ui_na')}`);
  }
  rows.push('');
  rows.push(`[${t('ui_rep_timeline')}]`);
  for (const e of inc.timeline) rows.push(` ${hms(e.t)}  ${e.op ? e.op.padEnd(6) : '      '}  ${t(e.key, e.p)}`);
  rows.push('');
  rows.push(t('ui_rep_footer'));
  return rows.join('\n');
}
function download(name, text, type = 'text/plain') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function openReport(incId) {
  const list = [...sim.incidents].reverse();
  if (!list.length) { toast(esc(t('ui_no_incidents')), 'info'); return; }
  const cur = incId || S.selInc || list[0].id;
  openModal(`<header><h2>${esc(t('ui_report'))}</h2><select id="rpSel" style="max-width:340px">${list.map(i => `<option value="${i.id}" ${i.id === cur ? 'selected' : ''}>${esc(i.id)} · P${i.prio} · ${esc(i.vid || i.zone)} · ${esc(t('it_' + i.type))} · ${esc(t('st_' + i.status))}</option>`).join('')}</select></header>
    <div class="mb"><div class="rep" id="rpText"></div></div>
    <footer><button class="btn" id="rpCsv">${esc(t('ui_log_csv'))}</button><button class="btn" id="rpJson">JSON</button><button class="btn" id="rpTxt">${esc(t('ui_dl_txt'))}</button><button class="btn" id="rpCopy">${esc(t('ui_copy'))}</button><button class="btn pri" data-close>${esc(t('ui_close'))}</button></footer>`, true);
  const show = () => { $('rpText').textContent = incReport(sim.inc($('rpSel').value)); };
  $('rpSel').onchange = show; show();
  $('rpCopy').onclick = () => { navigator.clipboard?.writeText($('rpText').textContent).then(() => toast(esc(t('ui_copied')), 'ok'), () => toast('clipboard ✕', 'warn')); };
  $('rpTxt').onclick = () => download(`${$('rpSel').value}.txt`, $('rpText').textContent);
  $('rpJson').onclick = () => { const i = sim.inc($('rpSel').value); download(`${i.id}.json`, JSON.stringify({ ...i, timeline: i.timeline.map(e => ({ time: clockAt(e.t).toISOString(), op: e.op, level: e.lvl, event: t(e.key, e.p) })) }, null, 2), 'application/json'); };
  $('rpCsv').onclick = () => download(`ops-log-${hms(sim.t).replace(/:/g, '')}.csv`, '﻿time,level,vehicle,incident,operator,event\n' + sim.logs.map(e => [clockAt(e.t).toISOString(), e.lvl, e.vid || '', e.inc || '', e.op || '', '"' + t(e.key, e.p).replace(/"/g, '""') + '"'].join(',')).join('\n'), 'text/csv');
}
function openHandover() {
  const open = sim.incidents.filter(i => i.status !== 'RESOLVED');
  const abn = sim.vehicles.filter(v => !['AUTO', 'IDLE', 'DWELL', 'CHARGING'].includes(v.mode) || v.service === 'OUT_OF_SERVICE' || v.sensors.lidar !== 'OK' || v.net.rtt > RTT_ASSIST_MAX);
  const zones = sim.zones.filter(z => z.odd !== 'NORMAL' || z.rain > 5);
  const k = sim.kpis();
  const prev = store.get('handovers', []);
  const summary = [
    `${t('ui_ho_title')} · ${hms(sim.t)} JST · ${ME}`,
    `${t('ui_ho_open')} (${open.length}):`, ...open.map(i => `  - ${i.id} P${i.prio} ${i.vid || i.zone} ${t('it_' + i.type)} · ${t('st_' + i.status)} · ${opName(i.assignee)} · ${t('ui_pending')} ${sim.pendingSteps(i).length}`),
    `${t('ui_ho_veh')} (${abn.length}):`, ...abn.map(v => `  - ${v.id} ${t('m_' + v.mode)} · ${t('sv_' + v.service)} · LiDAR ${v.sensors.lidar} · RTT ${Math.round(v.net.rtt)}ms · SOC ${v.soc.toFixed(0)}%`),
    `${t('ui_ho_zone')}:`, ...(zones.length ? zones.map(z => `  - ${zoneLabel(z.id)} ${t('odd_' + z.odd)} · ${z.rain.toFixed(0)} mm/h`) : ['  —']),
    `${t('ui_ho_infra')}: ${[...sim.outages.keys()].map(nodeLabel).join(', ') || '—'}`,
    `${t('ui_ho_bk')}: ${k.waiting} (${t('ui_held')} ${k.held}) · ${t('ui_late')} ${k.late}`,
    `KPI: SLA ${k.sla.toFixed(0)}% · ${t('ui_k_ack')} ${k.ackAvg.toFixed(1)}s · ${t('ui_k_assist')} ${k.assistPer100.toFixed(1)}`,
  ].join('\n');
  openModal(`<header><h2>${esc(t('ui_shift_handover'))}</h2></header><div class="mb"><div class="rep">${esc(summary)}</div>
    <label class="f">${esc(t('ui_ho_note'))}</label><textarea id="hoNote" placeholder="${esc(t('ui_ho_ph'))}"></textarea>
    ${prev.length ? `<label class="f">${esc(t('ui_ho_prev'))}</label><div class="rep" style="max-height:120px">${esc(prev.slice(-3).reverse().map(h => `${h.at} · ${h.note || '—'}`).join('\n'))}</div>` : ''}</div>
    <footer><button class="btn" data-close>${esc(t('ui_cancel'))}</button><button class="btn" id="hoDl">${esc(t('ui_dl_txt'))}</button><button class="btn pri" id="hoGo">${esc(t('ui_ho_save'))}</button></footer>`, true);
  $('hoDl').onclick = () => download(`handover-${hms(sim.t).replace(/:/g, '')}.txt`, summary + '\n\n' + $('hoNote').value);
  $('hoGo').onclick = () => {
    const note = $('hoNote').value.trim(); prev.push({ at: `${clockAt(sim.t).toLocaleDateString('ja-JP')} ${hms(sim.t)}`, note, open: open.length }); store.set('handovers', prev.slice(-20));
    sim.log('op', 'lg_shift_handover', { n: open.length }, { op: ME }); if (note) sim.log('op', 'lg_note', { msg: note }, { op: ME });
    closeModal(); toast(esc(t('ui_ho_saved')), 'ok');
  };
}
const INJ = ['obstacle', 'pedestrian', 'signal', 'ev', 'sensor', 'latency', 'door', 'sos', 'mrm', 'collision', 'weather', 'battery'];
function openTraining() {
  const v = S.sel;
  openModal(`<header><h2>${esc(t('ui_scenario'))}</h2><span class="badge train">${esc(t('ui_training'))}</span></header><div class="mb">
    <p class="mut">${esc(t('ui_train_note'))}</p>
    <h3 style="font-size:13px">${esc(t('ui_inject'))} ${v ? '· ' + esc(v) : '· ' + esc(t('ui_random'))}</h3>
    <div class="tgrid">${INJ.map(k => `<button class="btn" data-inj="${k}">${pp(ITYPES[k].prio)} ${esc(t('it_' + k))}</button>`).join('')}</div>
    <p><button class="btn warn" id="trMulti">${esc(t('ui_multi'))}</button></p>
    <h3 style="font-size:13px">${esc(t('ui_simctl'))}</h3>
    <div class="seg" id="trSpeed">${[0, 1, 2, 4].map(s => `<button data-s="${s}" class="${(S.paused ? 0 : S.speed) === s ? 'on' : ''}">${s === 0 ? '⏸' : s + '×'}</button>`).join('')}</div>
    <p><label class="chk"><input type="checkbox" id="trAuto" ${sim.settings.auto ? 'checked' : ''}> ${esc(t('ui_auto_inc'))}</label>
    <label class="chk"><input type="checkbox" id="trTeam" ${sim.settings.team ? 'checked' : ''}> ${esc(t('ui_team_auto'))}</label>
    <label class="chk">${esc(t('ui_intensity'))} <select id="trInt">${[0.5, 1, 2, 3].map(x => `<option ${sim.settings.intensity === x ? 'selected' : ''} value="${x}">${x}×</option>`).join('')}</select></label></p>
    </div><footer><button class="btn" id="trReset">${esc(t('ui_reset'))}</button><button class="btn pri" data-close>${esc(t('ui_close'))}</button></footer>`, true);
  const b = $('mbox');
  b.querySelectorAll('[data-inj]').forEach(x => x.onclick = () => {
    const k = x.dataset.inj; let r;
    if (k === 'battery') { const vv = sim.veh(S.sel) || sim.vehicles.find(q => q.service === 'IN_SERVICE' && !sim.openIncs(q).length); if (vv) { vv.soc = 14.5; r = true; } }
    else r = sim.inject(k, k === 'weather' ? null : S.sel, k === 'weather' && S.sel ? sim.zoneOf(sim.veh(S.sel)) : null);
    if (!r) toast(esc(t('ui_inject_fail')), 'warn'); else closeModal();
  });
  $('trMulti').onclick = () => { sim.inject('mrm'); sim.inject('latency'); sim.inject('weather'); sim.inject('obstacle'); closeModal(); };
  b.querySelectorAll('#trSpeed [data-s]').forEach(x => x.onclick = () => { const s = +x.dataset.s; S.paused = s === 0; if (s) S.speed = s; b.querySelectorAll('#trSpeed button').forEach(y => y.classList.toggle('on', y === x)); });
  $('trAuto').onchange = e => sim.settings.auto = e.target.checked;
  $('trTeam').onchange = e => sim.settings.team = e.target.checked;
  $('trInt').onchange = e => sim.settings.intensity = +e.target.value;
  $('trReset').onclick = () => location.reload();
}
function openHelp() {
  const keys = [['J / K', 'ui_k_jk'], ['Enter', 'ui_k_enter'], ['A', 'ui_k_a'], ['R', 'ui_k_r'], ['1–6', 'ui_k_cam'], ['[ / ]', 'ui_k_veh'], ['F', 'ui_k_f'], ['G', 'ui_k_g'], ['P', 'ui_k_p'], ['T', 'ui_k_t'], ['H', 'ui_k_h'], ['E (hold 1s)', 'ui_k_e'], ['M', 'ui_k_m'], ['Esc', 'ui_k_esc']];
  openModal(`<header><h2>${esc(t('ui_help'))}</h2></header><div class="mb"><div class="keys">${keys.map(([k, d]) => `<kbd>${k}</kbd><span>${esc(t(d))}</span>`).join('')}</div>
    <h3 style="font-size:13px;margin-top:16px">${esc(t('ui_principles'))}</h3><ul>${['ui_pr1', 'ui_pr2', 'ui_pr3', 'ui_pr4', 'ui_pr5', 'ui_pr6'].map(k => `<li>${esc(t(k))}</li>`).join('')}</ul></div>
    <footer><button class="btn pri" data-close>${esc(t('ui_close'))}</button></footer>`, true);
}

// ---------- queue ----------
function queueList() {
  let list = sim.incidents;
  if (S.qf === 'open') list = list.filter(i => i.status !== 'RESOLVED');
  else if (S.qf === 'mine') list = list.filter(i => i.status !== 'RESOLVED' && i.assignee === ME);
  else list = list.filter(i => i.status === 'RESOLVED').slice(-40).reverse();
  if (S.qf !== 'done') list = [...list].sort((a, b) => a.prio - b.prio || (!!a.ack - !!b.ack) || a.created - b.created);
  return list;
}
function renderQueue() {
  const list = queueList();
  const html = list.length ? list.map(i => {
    const age = (i.resolved ?? sim.t) - i.created, sla = SLA[i.prio];
    const slaPct = i.ack ? 100 : Math.min(100, age / sla * 100);
    const over = i.slaMissed || (!i.ack && age > sla);
    const who = i.assignee ? opName(i.assignee) : t('ui_unassigned');
    return `<div class="qc p${i.prio} ${i.ack ? '' : 'new'} ${i.id === S.selInc ? 'sel' : ''} ${i.status === 'RESOLVED' ? 'done' : ''}" data-inc="${i.id}" role="option">
      <div class="r1">${pp(i.prio)}<span class="ty">${esc(t('it_' + i.type))}</span><span class="mono">${dur(age)}</span></div>
      <div class="r2"><b class="mono">${esc(i.vid || i.zone)}</b><span>${esc(i.zone)}</span><span>${esc(t('st_' + i.status))}</span>${i.escalated ? `<span class="esc">▲SV</span>` : ''}${i.data.pax ? `<span>👤${i.data.pax}</span>` : ''}<span class="who">${esc(who)}</span></div>
      ${i.status !== 'RESOLVED' ? `<div class="sla ${over ? 'over' : ''}" title="SLA ${sla}s"><i style="width:${slaPct.toFixed(0)}%"></i></div>` : ''}
    </div>`;
  }).join('') : `<div class="qempty">${esc(t(S.qf === 'done' ? 'ui_q_none_done' : 'ui_q_none'))}</div>`;
  setHTML($('qlist'), html);
}
$('qlist').addEventListener('pointerdown', e => { const c = e.target.closest('[data-inc]'); if (c) selectIncident(c.dataset.inc); });
$('qFilter').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; S.qf = b.dataset.f; $('qFilter').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); renderQueue(); });

// ---------- fleet ----------
function renderFleet() {
  const rows = sim.vehicles.map(v => {
    const r = Math.round(v.net.rtt), inc = sim.topInc(v);
    return `<tr data-vid="${v.id}" class="${v.id === S.sel ? 'sel' : ''}">
      <td class="mono"><b>${v.id}</b>${inc ? ' ' + pp(inc.prio) : ''}</td>
      <td><span class="st"><i style="background:${col(MODE_COLOR[v.mode])}"></i>${esc(t('m_' + v.mode))}</span></td>
      <td class="num">${kmh(v.v)}</td>
      <td class="num ${v.soc < 15 ? 'bad' : v.soc < 25 ? 'mid' : ''}">${v.soc.toFixed(0)}%</td>
      <td class="num">${v.pax}/${v.cap}</td>
      <td class="num ${r >= 1000 ? 'bad' : r >= RTT_ASSIST_MAX ? 'mid' : ''}">${r >= 1000 ? '✕' : r}</td></tr>`;
  }).join('');
  setHTML($('ftable'), rows);
  $('fleetCount').textContent = `${sim.vehicles.filter(v => v.service === 'IN_SERVICE').length}/${sim.vehicles.length} ${t('ui_in_service')}`;
}
$('ftable').addEventListener('pointerdown', e => { const r = e.target.closest('[data-vid]'); if (r) { selectVehicle(r.dataset.vid); const v = sim.veh(r.dataset.vid); map.centerOn(v.x, v.y); } });

// ---------- header / KPI ----------
function renderTop() {
  const c = sim.clock();
  $('clock').textContent = c.toLocaleTimeString('ja-JP', { hour12: false, timeZone: 'Asia/Tokyo' });
  const h = +c.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Tokyo' });
  const sh = h >= 7 && h < 15 ? ['A', '07:00–15:00'] : h >= 15 && h < 23 ? ['B', '15:00–23:00'] : ['C', '23:00–07:00'];
  $('shift').textContent = `${t('ui_shift')} ${sh[0]} ${sh[1]} JST${S.paused ? ' · ⏸' : S.speed > 1 ? ' · ' + S.speed + '×' : ''}`;
  const V = sim.vehicles, cnt = f => V.filter(f).length;
  const p1new = sim.incidents.filter(i => i.status !== 'RESOLVED' && i.prio === 1 && !i.ack).length;
  const chips = [
    ['--ok', 'ui_c_moving', cnt(v => ['AUTO', 'REMOTE_GUIDED'].includes(v.mode)), ''],
    ['--info', 'ui_c_stop', cnt(v => v.mode === 'DWELL'), ''],
    ['--warn', 'ui_c_assist', cnt(v => v.mode === 'WAIT_ASSIST'), 'warm'],
    ['--crit', 'ui_c_mrc', cnt(v => ['MRM', 'MRC'].includes(v.mode)), 'hot'],
    ['--warn', 'ui_c_net', cnt(v => v.net.rtt >= RTT_ASSIST_MAX), 'warm'],
    ['--muted', 'ui_c_chg', cnt(v => v.service !== 'IN_SERVICE'), ''],
    ['--crit', 'ui_c_p1', p1new, 'hot'],
  ];
  setHTML($('fleetchips'), chips.map(([c2, k, n, hot]) => `<span class="chip ${n && hot ? hot : ''}"><i class="dot" style="background:${col(c2)}"></i>${esc(t(k))}<b>${n}</b></span>`).join(''));
  $('top').classList.toggle('alarm', p1new > 0);
  const k = sim.kpis();
  const onDuty = sim.ops.filter(o => !o.sv).length;
  const mine = sim.incidents.filter(i => i.status !== 'RESOLVED' && i.assignee === ME).length;
  const K = [
    ['ui_k_ratio', `1:${Math.round(k.total / onDuty)}`, `${t('ui_k_mine')} ${mine}`, mine >= 3 ? 'mid' : ''],
    ['ui_k_assist', k.assistPer100.toFixed(1), `${k.assists} / ${k.km.toFixed(1)} km`, ''],
    ['ui_k_ack', `${k.ackAvg.toFixed(1)}s`, `P1 ≤${SLA[1]}s · P2 ≤${SLA[2]}s`, k.ackAvg > 20 ? 'bad' : k.ackAvg > 10 ? 'mid' : 'good'],
    ['ui_k_sla', `${k.sla.toFixed(0)}%`, t('ui_k_sla_t'), k.sla < 80 ? 'bad' : k.sla < 95 ? 'mid' : 'good'],
    ['ui_k_res', dur(k.resAvg), `${sim.stats.res.length} ${t('ui_k_cases')}`, ''],
    ['ui_k_wait', `${k.waiting}`, `${t('ui_k_avgwait')} ${dur(k.waitAvg)}${k.held ? ' · ' + t('ui_held') + ' ' + k.held : ''}`, k.held ? 'mid' : ''],
    ['ui_k_late', `${k.late}`, t('ui_k_late_t'), k.late ? 'mid' : 'good'],
    ['ui_k_served', `${k.served}`, `${t('ui_k_avail')} ${k.inSvc}/${k.total}`, ''],
  ];
  setHTML($('kpis'), K.map(([l, v, s, cl]) => `<div class="kpi ${cl}"><small>${esc(t(l))}</small><b>${esc(v)}</b><span>${esc(s)}</span></div>`).join(''));
  const mt = $('muteTxt'); if (muted()) { $('muteIco').textContent = '🔕'; mt.textContent = Math.ceil((S.muteUntil - Date.now()) / 1000) + 's'; } else { $('muteIco').textContent = '🔔'; mt.textContent = ''; }
}

// ---------- bottom tabs ----------
function setTab(tb) { S.tab = tb; $('btabs').querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === tb)); $('logFilter').style.display = tb === 'log' ? '' : 'none'; renderBottom(); }
$('btabs').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) setTab(b.dataset.t); });
$('logFilter').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; S.lf = b.dataset.f; $('logFilter').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); renderBottom(); });
function renderBottom() {
  const el = $('bbody');
  if (S.tab === 'log') {
    let L = sim.logs;
    if (S.lf === 'crit') L = L.filter(e => e.lvl === 'crit' || e.lvl === 'warn');
    if (S.lf === 'op') L = L.filter(e => e.lvl === 'op');
    if (S.lf === 'sel') L = L.filter(e => e.vid && e.vid === S.sel);
    L = L.slice(-220).reverse();
    setHTML(el, `<table class="log">${L.map(e => `<tr class="${e.lvl}" ${e.vid ? `data-vid="${e.vid}"` : ''} ${e.inc ? `data-inc="${e.inc}"` : ''}><td>${hms(e.t)}</td><td>${esc(t(e.key, e.p))}</td><td class="tag">${esc(e.vid || '')}</td><td class="tag">${esc(e.inc || '')}</td><td class="tag">${esc(e.op || '')}</td></tr>`).join('')}</table>`);
  } else if (S.tab === 'bk') {
    const active = sim.bookings.filter(b => !['DONE', 'CANCELLED'].includes(b.status));
    const vInc = new Set(sim.vehicles.filter(v => sim.openIncs(v).length || ['MRC', 'MRM', 'WAIT_ASSIST'].includes(v.mode)).map(v => v.id));
    const score = b => (vInc.has(b.vid) ? 0 : b.status === 'HELD' ? 1 : 2) * 1e6 - (sim.t - b.req);
    const rows = active.sort((a, b) => score(a) - score(b)).map(b => {
      const wait = sim.t - b.req, impacted = vInc.has(b.vid);
      const late = b.promise && !b.pickup && sim.t > b.promise + 60;
      return `<tr ${b.vid ? `data-vid="${b.vid}"` : ''}><td class="mono">${b.id}</td><td>${esc(nodeLabel(b.o))} → ${esc(nodeLabel(b.d))}</td><td>${b.pax}${b.wc ? ' ♿' : ''}</td>
        <td class="${b.status === 'HELD' ? 'mid' : ''}">${esc(t('bk_' + b.status))}</td><td class="mono ${impacted ? 'bad' : ''}">${esc(b.vid || '—')}${impacted ? ' ⚠' : ''}</td>
        <td class="num ${late ? 'bad' : ''}">${dur(wait)}${late ? ' ' + t('ui_late') : ''}</td><td>${b.notified ? '✓' : '—'}</td><td class="mut">${[b.transfer ? t('ui_transfer') : '', b.diverted ? t('ui_diverted') : ''].filter(Boolean).join(' · ')}</td></tr>`;
    }).join('');
    setHTML(el, `<table class="bkt"><thead><tr><th>${t('ui_bk')}</th><th>${t('ui_od')}</th><th>${t('ui_th_pax')}</th><th>${t('ui_th_state')}</th><th>${t('ui_th_id')}</th><th>${t('ui_waited')}</th><th>${t('ui_notified')}</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="8" class="mut">—</td></tr>`}</tbody></table>`);
  } else if (S.tab === 'zone') {
    setHTML(el, `<div class="zgrid">${sim.zones.map(z => {
      const vs = sim.vehicles.filter(v => sim.zoneOf(v) === z.id);
      const wx = sim.incidents.find(i => i.type === 'weather' && i.zone === z.id && i.status !== 'RESOLVED');
      const zb = sim.zoneBookings(z.id).length;
      const btn = (c, cls = '') => { const r = sim.interlock(c, null, wx, z); return `<button class="btn sm ${cls}" data-cmd="${c}" data-zone="${z.id}" ${wx ? `data-inc="${wx.id}"` : ''} ${r ? `disabled title="${esc(t(r))}"` : ''}>${esc(t('c_' + c))}</button>`; };
      return `<div class="zc ${z.odd} ${S.zoneSel === z.id ? 'sel' : ''}"><h4>${esc(zoneLabel(z.id))} <span class="badge">${esc(t('odd_' + z.odd))}</span>${wx ? pp(1) : ''}</h4>
        <div class="kv"><span>${t('ui_rain')}</span><b class="${z.rain > 30 ? 'bad' : z.rain > 10 ? 'mid' : ''}">${z.rain.toFixed(0)} mm/h</b><span>${t('ui_vis')}</span><b class="${z.vis < 500 ? 'bad' : ''}">${z.vis >= 10000 ? '>10 km' : Math.round(z.vis) + ' m'}</b>
        <span>${t('ui_wind')}</span><b>${z.wind.toFixed(1)} m/s</b><span>${t('ui_speedlimit')}</span><b>${(z.odd === 'RESTRICTED' ? 20 : z.speedLimit * 3.6).toFixed(0)} km/h</b>
        <span>${t('ui_vehicles')}</span><b>${vs.length} (${t('ui_pax')} ${vs.reduce((s, v) => s + v.pax, 0)})</b><span>${t('ui_bk_zone')}</span><b>${zb}</b>
        <span>ODD</span><b>${z.rain > 30 || z.vis < 500 ? `<span class="bad">${t('ui_odd_risk')}</span>` : z.rain > 10 ? `<span class="mid">${t('ui_odd_watch')}</span>` : t('ui_odd_in')}</b></div>
        <div class="bl">${btn('zone_restrict')}${btn('zone_suspend', 'warn')}${btn('zone_restore')}${wx ? btn('notify_customers') : ''}</div></div>`;
    }).join('')}</div><p class="mut" style="padding:0 10px">${esc(t('ui_zone_note'))}</p>`);
  } else if (S.tab === 'team') {
    setHTML(el, `<div class="team">${sim.ops.map(o => {
      const my = sim.incidents.filter(i => i.status !== 'RESOLVED' && i.assignee === o.id);
      const done = sim.incidents.filter(i => i.status === 'RESOLVED' && i.closedBy === o.id).length;
      return `<div class="tm ${o.me ? 'me' : ''}"><b>${o.id}</b> ${esc(o.name[getLang()])} ${o.sv ? `<span class="badge">${t('ui_sv')}</span>` : ''}
        <div class="mut">${t('ui_handling')} ${my.length} · ${t('ui_closed')} ${done}</div><div class="bar"><i style="width:${Math.min(100, my.length * 34)}%;background:${my.length >= 3 ? col('--crit') : my.length >= 2 ? col('--warn') : col('--ok')}"></i></div>
        <ul>${my.map(i => `<li data-inc="${i.id}" style="cursor:pointer">P${i.prio} ${esc(i.vid || i.zone)} ${esc(t('it_' + i.type))}</li>`).join('') || `<li class="mut">${t('ui_free')}</li>`}</ul>
        ${o.sv ? `<div class="mut">${t('ui_escalated')}: ${sim.incidents.filter(i => i.escalated && i.status !== 'RESOLVED').length}</div>` : ''}</div>`;
    }).join('')}</div><p class="mut" style="padding:0 10px">${esc(t('ui_team_note'))}</p>`);
  }
}
$('bbody').addEventListener('click', e => { const c = e.target.closest('[data-cmd]'); if (c && !c.disabled && e.detail === 0) doCommand(c.dataset.cmd, { vid: null, zoneId: c.dataset.zone, incId: c.dataset.inc }); });
$('bbody').addEventListener('pointerdown', e => {
  const c = e.target.closest('[data-cmd]'); if (c) return;
  const i = e.target.closest('[data-inc]'); if (i && !e.target.closest('.zc')) return selectIncident(i.dataset.inc);
  const r = e.target.closest('[data-vid]'); if (r) selectVehicle(r.dataset.vid);
});
$('bbody').addEventListener('pointerdown', e => { const c = e.target.closest('[data-cmd]'); if (c && !c.disabled && e.button === 0) doCommand(c.dataset.cmd, { vid: null, zoneId: c.dataset.zone, incId: c.dataset.inc }); });

// ---------- vehicle panel ----------
function legText(v) {
  const L = v.leg; if (!L) return t('ui_leg_none');
  const b = v.job && sim.bookings.find(x => x.id === v.job);
  const tgt = L.target;
  const m = { PICKUP: 'ui_leg_pickup', DROPOFF: 'ui_leg_drop', LINE: 'ui_leg_line', HUB: L.why === 'charge' ? 'ui_leg_hub_c' : 'ui_leg_hub_m', RESCUE: 'ui_leg_rescue', HOSP: 'ui_leg_hosp', DROPGO: 'ui_leg_dropgo', BOARDED: 'ui_leg_boarding', ALIGHT: 'ui_leg_alight', LINE_DWELL: 'ui_leg_linestop', RESCUE_DWELL: 'ui_leg_transfer', HOSP_DWELL: 'ui_leg_hosp', DROP: 'ui_leg_alight' }[L.kind] || 'ui_leg_none';
  const rem = sim.remaining(v);
  return `${t(m, { node: tgt, line: v.line !== null ? LINES[v.line].name[getLang()] : '', rescue: v.rescueOf || '' })}${b ? ` · ${b.id}` : ''}${rem > 1 ? ` · ${(rem / 1000).toFixed(1)} km · ETA ${Math.max(1, Math.ceil(rem / Math.max(4, sim.targetSpeed(v) * 0.8) / 60))} ${t('ui_min')}` : ''}`;
}
function renderPanel() {
  const P = $('vpanel');
  const inc0 = S.selInc && sim.inc(S.selInc);
  const zoneMode = !S.sel && inc0 && !inc0.vid;
  const key = S.sel ? 'v:' + S.sel + getLang() : zoneMode ? 'z:' + inc0.id + getLang() : 'none' + getLang();
  if (S.panelKey !== key) {
    S.panelKey = key;
    if (S.sel) {
      P.innerHTML = `<div class="vh" id="vHead"></div><div class="sec" id="vInc"></div>
        <div class="sec"><h3>${esc(t('ui_cams'))}<span class="grow"></span><span class="mut" id="camHint"></span></h3><canvas id="camMain"></canvas>
          <div class="cams">${CAMS.map((c, i) => `<canvas data-cam="${c}" title="${i + 1}: ${esc(t('cam_' + c))}"></canvas>`).join('')}</div></div>
        <div class="sec" id="vTele"></div>
        <div class="sec"><h3>${esc(t('ui_commands'))}<span class="grow"></span><span class="mut">${esc(t('ui_cmd_note'))}</span></h3>
          <button class="estop" id="estop">${esc(t('c_e_stop'))}<small>${esc(t('ui_estop_hint'))}</small><span class="hold"></span></button>
          <div class="cmdgrid" id="vCmds" style="margin-top:10px"></div></div>
        <div class="sec"><h3>${esc(t('ui_cmd_hist'))}</h3><div id="vHist"></div></div>`;
      sizeCanvas($('camMain')); P.querySelectorAll('.cams canvas').forEach(sizeCanvas);
      buildCmds(); bindEstop();
    } else if (zoneMode) {
      P.innerHTML = `<div class="vh"><div><div class="id">${esc(inc0.zone)}</div><div class="meta">${esc(zoneLabel(inc0.zone))}</div></div></div><div class="sec" id="vInc"></div><div class="sec" id="zVeh"></div>`;
    } else {
      P.innerHTML = `<div class="empty"><h3>${esc(t('ui_nosel'))}</h3><p>${esc(t('ui_nosel_hint'))}</p><p class="mut">${esc(t('ui_nosel_keys'))}</p></div>`;
    }
  }
  if (S.sel) updateVehiclePanel(); else if (zoneMode) updateZonePanel(inc0);
}
function incCard(inc, v) {
  const T = ITYPES[inc.type];
  const pend = sim.pendingSteps(inc); const next = pend[0];
  const others = v ? sim.openIncs(v).filter(i => i.id !== inc.id) : [];
  const steps = T.steps.map(s => {
    const d = inc.steps[s.id], req = sim.stepRequired(inc, s);
    const cls = [d ? 'done' : '', !req && !d ? 'opt' : '', next && next.id === s.id ? 'next' : ''].join(' ');
    let right = '';
    if (s.kind === 'check') right = s.cam ? `<button class="btn sm" data-cam="${s.cam}">📷 ${esc(t('cam_' + s.cam))}</button>` : '';
    else if (!d) right = `<span class="acts">${s.acts.map(a => `<button class="btn sm ${T.rec.includes(a) ? 'rec' : ''}" data-cmd="${a}" data-inc="${inc.id}" ${inc.zone && !inc.vid ? `data-zone="${inc.zone}"` : ''}>${esc(t('c_' + a))}</button>`).join('')}</span>`;
    const by = d ? `<div class="by">${hms(d.t)} · ${esc(d.by)}${d.cmd ? ' · ' + esc(t('c_' + d.cmd)) : ''}</div>` : (!req ? `<div class="by">${esc(t('ui_na'))}</div>` : '');
    const box = s.kind === 'check' ? `<button class="ck" data-step="${s.id}" data-inc="${inc.id}" aria-label="check">${d ? '✓' : ''}</button>` : `<span class="ck" style="cursor:default">${d ? '✓' : '⚙'}</span>`;
    return `<li class="${cls}">${box}<div class="tx">${esc(t('sp_' + s.id))}${by}</div>${right}</li>`;
  }).join('');
  const det = [];
  det.push(`${t('ui_created')} <b>${hms(inc.created)}</b>`);
  det.push(`${t('ui_assignee')} <b>${esc(inc.assignee ? opName(inc.assignee) : t('ui_unassigned'))}</b>`);
  if (inc.data.pax) det.push(`${t('ui_pax')} <b>${inc.data.pax}</b>`);
  det.push(`${t('ui_bk_aff')} <b>${inc.bookings.length}</b>`);
  if (inc.data.cause) det.push(`<b>${esc(t((inc.type === 'mrm' ? 'mc_' : 'sc_') + inc.data.cause))}</b>`);
  if (inc.data.g) det.push(`IMU <b>${inc.data.g} G</b>`);
  if (inc.type === 'sos') det.push(inc.data.revealed ? `<b class="${inc.data.subtype === 'medical' ? 'bad' : ''}">${esc(t(inc.data.subtype === 'medical' ? 'lg_sos_medical' : 'lg_sos_mistake'))}</b>` : `<b class="mid">${esc(t('ui_sos_unknown'))}</b>`);
  if (inc.type === 'signal') det.push(`<b>${esc(nodeLabel(inc.data.node))}</b>`);
  if (inc.escalated) det.push(`<b class="bad">▲ ${t('ui_escalated')}</b>`);
  if (v && v.diag) det.push(`${t('c_run_diag')} <b id="diagSt" class="${v.diag.done ? (v.diag.pass ? 'good' : 'bad') : 'mid'}"></b>`);
  if (v && v.crew) det.push(`${esc(v.crew.id)} <b id="crewSt"></b>`);
  const tr = v && v.call ? `<div class="transcript" id="callBox"></div>` : '';
  return `${others.length ? `<div class="seg" style="margin-bottom:6px">${[inc, ...others].sort((a, b) => a.prio - b.prio).map(i => `<button data-incsel="${i.id}" class="${i.id === inc.id ? 'on' : ''}">P${i.prio} ${esc(t('it_' + i.type)).slice(0, 14)}</button>`).join('')}</div>` : ''}
  <div class="inc p${inc.prio}"><div class="ih">${pp(inc.prio)}<b>${esc(t('it_' + inc.type))}</b><span class="mono">${inc.id}</span><span class="mono" id="incAge"></span></div>
  <div class="iinfo">${det.join('<span>·</span>')}</div>
  <ul class="sop">${steps}</ul>${tr}
  <div class="iact">${!inc.ack ? `<button class="btn pri" data-ack="${inc.id}">${esc(t('ui_ack'))} <kbd>A</kbd></button>` : ''}
    <button class="btn" data-hand="${inc.id}">${esc(t('ui_reassign'))}</button>
    ${!inc.escalated ? `<button class="btn" data-esc="${inc.id}">${esc(t('ui_escalate'))}</button>` : ''}
    <button class="btn ${pend.length ? '' : 'pri'}" data-resolve="${inc.id}">${esc(t('ui_resolve'))} <kbd>R</kbd></button>
    <button class="btn" data-report="${inc.id}">${esc(t('ui_report'))}</button></div></div>`;
}
function updateAge(inc, v) {
  const el = $('incAge'); if (!el || !inc) return;
  if (v) {
    const d = $('diagSt'); if (d && v.diag) d.textContent = v.diag.done ? (v.diag.pass ? 'PASS' : 'FAIL') : Math.max(0, v.diag.end - sim.t).toFixed(0) + 's…';
    const c = $('crewSt'); if (c && v.crew) c.textContent = v.crew.onsite ? t('ui_onsite') : 'ETA ' + dur(v.crew.eta - sim.t);
    const cb = $('callBox'); if (cb && v.call) setHTML(cb, `<p class="mut">🎙 ${esc(t('ui_on_call'))} ${dur(sim.t - v.call.start)} · ${esc(t('ui_call_ch'))}</p>${v.call.transcript.map(x => `<p>${hms(x.t)} ${esc(t(x.key))}</p>`).join('')}${v.call.lines.length ? `<p class="mut">…</p>` : ''}`);
  }
  const age = (inc.resolved ?? sim.t) - inc.created, sla = SLA[inc.prio];
  el.innerHTML = `${dur(age)} · ${inc.ack ? `<span class="${inc.slaMissed ? 'bad' : 'good'}">${t('ui_ack_in')} ${dur(inc.ack - inc.created)}</span>` : `<span class="${age > sla ? 'bad' : 'mid'}">SLA ${Math.max(0, sla - age).toFixed(0)}s</span>`}`;
}
function updateVehiclePanel() {
  const v = sim.veh(S.sel); if (!v) return;
  if (S.selInc) { const i = sim.inc(S.selInc); if (!i || i.vid !== v.id || i.status === 'RESOLVED') { const top = sim.topInc(v); S.selInc = top ? top.id : (i && i.vid === v.id ? i.id : null); } }
  else { const top = sim.topInc(v); if (top) S.selInc = top.id; }
  const z = sim.zone(sim.zoneOf(v));
  setHTML($('vHead'), `<div style="flex:1;min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="id">${v.id}</span>${modeBadge(v.mode)}<span class="badge">${esc(t('sv_' + v.service))}</span>${v.hazard ? `<span class="badge mid">⚠ ${esc(t('c_hazard'))}</span>` : ''}${v.capOp ? `<span class="badge mid">≤20km/h</span>` : ''}</div>
    <div class="meta">${esc(t(v.type === 'RT' ? 'ui_robotaxi' : 'ui_shuttle'))} · ${t('ui_cap')} ${v.cap} · ${esc(zoneLabel(z.id))}（${esc(t('odd_' + z.odd))}）</div>
    <div class="meta">${esc(legText(v))}</div></div>
    <div style="display:flex;gap:4px"><button class="ib sm ${map.follow ? 'on' : ''}" data-follow>${esc(t('ui_follow'))} <kbd>F</kbd></button><button class="ib sm" data-desel title="Esc">✕</button></div>`);
  const inc = S.selInc && sim.inc(S.selInc);
  if (inc && inc.status !== 'RESOLVED') setHTML($('vInc'), `<h3>${esc(t('ui_incident'))}<span class="grow"></span><span class="mut">${esc(t('ui_sop_hint'))}</span></h3>` + incCard(inc, v));
  else {
    const last = [...sim.incidents].reverse().find(i => i.vid === v.id);
    setHTML($('vInc'), `<h3>${esc(t('ui_incident'))}</h3><div class="mut">${esc(t('ui_no_open'))}${last ? ` · ${esc(t('ui_last'))}: ${last.id} ${esc(t('it_' + last.type))} (${hms(last.created)}) <button class="btn sm" data-report="${last.id}">${esc(t('ui_report'))}</button>` : ''}</div>`);
  }
  updateAge(inc, v);
  // telemetry
  const r = Math.round(v.net.rtt), lost = sim.linkLost(v);
  const hist = S.rtt[v.id] || [];
  const sens = Object.entries(v.sensors).map(([k, s]) => `<span class="${s}">${esc(t('sn_' + k))} ${s === 'OK' ? '✓' : s}</span>`).join('');
  const tl = (l, val, extra = '', cls = '') => `<div class="tl"><small>${esc(l)}</small><b class="${cls}">${val}</b>${extra}</div>`;
  const barH = (p, c) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, p))}%;background:${c}"></i></div>`;
  setHTML($('vTele'), `<h3>${esc(t('ui_telemetry'))}</h3><div class="tele">
    ${tl(t('ui_speed'), kmh(v.v) + ' <small>km/h</small>', barH(v.v / v.vmax * 100, col('--accent')))}
    ${tl('SOC', v.soc.toFixed(1) + '%', barH(v.soc, v.soc < 15 ? col('--crit') : v.soc < 25 ? col('--warn') : col('--ok')), v.soc < 15 ? 'bad' : '')}
    ${tl(t('ui_loc'), (v.loc * 100).toFixed(1) + '%', barH((v.loc - 0.7) / 0.3 * 100, v.loc < 0.9 ? col('--warn') : col('--ok')), v.loc < 0.9 ? 'mid' : '')}
    ${tl(t('ui_pax'), `${v.pax}/${v.cap}`)}
    ${tl(t('ui_doors'), esc(t('door_' + v.doors)), '', v.doors === 'FAULT' ? 'bad' : v.doors === 'OPEN' ? 'mid' : '')}
    ${tl(t('ui_odo'), (v.odo / 1000).toFixed(1) + ' km')}
    ${tl(t('ui_temp'), v.temp.toFixed(0) + '°C')}
    ${tl(t('ui_edr'), v.edr ? t('ui_locked') : t('ui_rolling'), '', v.edr ? 'good' : '')}
    </div><div class="sens">${sens}</div>
    <div class="netrow"><div><div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><b class="mono ${lost ? 'bad' : r >= RTT_ASSIST_MAX ? 'mid' : 'good'}" style="font-size:16px">RTT ${lost ? '—' : r + ' ms'}</b>
      <span class="mut mono">loss ${v.net.loss.toFixed(1)}% · ${v.net.bw.toFixed(0)} Mbps · ${t('ui_carrier')} ${v.net.carrier}${v.net.switchCd > 0 ? ' (' + v.net.switchCd.toFixed(0) + 's)' : ''}</span></div>
      ${spark(hist)}</div>
      <div class="assistok ${lost || r >= RTT_ASSIST_MAX ? 'n' : 'y'}">${esc(t(lost ? 'ui_assist_lost' : r >= RTT_ASSIST_MAX ? 'ui_assist_ng' : 'ui_assist_ok'))}</div></div>`);
  // commands (keyed update)
  const top = inc && inc.status !== 'RESOLVED' ? inc : null;
  $('vCmds').querySelectorAll('[data-cmd]').forEach(b => {
    const n = b.dataset.cmd; const why = sim.interlock(n, v, top, null);
    b.disabled = !!why; b.title = why ? t(why, { cam: '' }) : '';
    const w = b.querySelector('.why'); const wt = why ? t(why, { cam: '' }) : '';
    if (w.textContent !== wt) w.textContent = wt;
    b.classList.toggle('rec', !why && !!top && ITYPES[top.type].rec.includes(n));
    if (n === 'intercom') { const lab = b.querySelector('.lab'); const want = v.call ? t('ui_end_call') : t('c_intercom'); if (lab.textContent !== want) lab.textContent = want; }
  });
  $('vInc').querySelectorAll('[data-cmd]').forEach(b => { const why = sim.interlock(b.dataset.cmd, v, top, null); b.disabled = !!why; b.title = why ? t(why, { cam: '' }) : ''; });
  const es = $('estop'); const er = sim.interlock('e_stop', v, top, null); es.disabled = !!er; es.querySelector('small').textContent = er ? t(er) : t('ui_estop_hint');
  setHTML($('vHist'), v.cmds.length ? `<table class="cmdh">${v.cmds.slice(0, 7).map(c => `<tr><td class="mono">${hms(c.issued)}</td><td>${esc(t('c_' + c.name))}</td><td class="s-${c.status}">${esc(t('cs_' + c.status))}</td><td class="mono">${c.rtt != null ? c.rtt + 'ms' : ''}</td><td class="mono mut">${esc(c.op)}</td></tr>`).join('')}</table>` : `<span class="mut">—</span>`);
  $('camHint').textContent = S.cam ? `${t('cam_' + S.cam)} · ${t('ui_viewed')} ${(v.camSec[S.cam] || 0).toFixed(0)}s` : '';
  document.querySelectorAll('.cams canvas').forEach(c => c.classList.toggle('on', c.dataset.cam === S.cam));
}
function updateZonePanel(inc) {
  if (inc.status === 'RESOLVED') { setHTML($('vInc'), `<div class="mut">${esc(t('ui_no_open'))}</div>`); return; }
  setHTML($('vInc'), `<h3>${esc(t('ui_incident'))}</h3>` + incCard(inc, null));
  updateAge(inc);
  const vs = sim.vehicles.filter(v => sim.zoneOf(v) === inc.zone);
  const z = sim.zone(inc.zone);
  setHTML($('zVeh'), `<h3>${esc(t('ui_zone_status'))}: ${esc(t('odd_' + z.odd))} · ☂ ${z.rain.toFixed(0)} mm/h · ${t('ui_vis')} ${Math.round(z.vis)} m</h3>
    <table class="cmdh">${vs.map(v => `<tr data-vid="${v.id}" style="cursor:pointer"><td class="mono"><b>${v.id}</b></td><td>${esc(t('m_' + v.mode))}</td><td>${kmh(v.v)} km/h</td><td>👤${v.pax}</td><td class="mut">${esc(legText(v))}</td></tr>`).join('') || '<tr><td class="mut">—</td></tr>'}</table>
    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">${['zone_restrict', 'zone_suspend', 'zone_restore', 'notify_customers'].map(c => { const r = sim.interlock(c, null, inc, z); return `<button class="btn" data-cmd="${c}" data-zone="${z.id}" data-inc="${inc.id}" ${r ? `disabled title="${esc(t(r))}"` : ''}>${esc(t('c_' + c))}</button>`; }).join('')}</div>`);
}
function spark(h) {
  if (h.length < 2) return '<svg class="spark"></svg>';
  const max = Math.max(400, ...h), W = 300, H = 34;
  const pts = h.map((x, i) => `${(i / (h.length - 1) * W).toFixed(1)},${(H - Math.min(x, max) / max * (H - 2) - 1).toFixed(1)}`).join(' ');
  const ty = (H - RTT_ASSIST_MAX / max * (H - 2) - 1).toFixed(1);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${ty}" y2="${ty}" stroke="${col('--warn')}" stroke-dasharray="4 4" stroke-width="1"/><polyline points="${pts}" fill="none" stroke="${col('--accent')}" stroke-width="1.6"/></svg>`;
}
const CMD_KEYS = { approve_path: '', approve_proceed: '', hold: '', reroute: '', announce: 'P', intercom: 'T', hazard: 'H' };
function buildCmds() {
  const groups = ['assist', 'control', 'vehicle', 'pax', 'ops', 'ext'];
  $('vCmds').innerHTML = groups.map(g => `<div class="cg"><h4>${esc(t('g_' + g))}</h4><div class="bl">${Object.entries(COMMANDS).filter(([n, c]) => c.group === g && n !== 'e_stop').map(([n]) => `<button class="btn" data-cmd="${n}"><span class="lab">${esc(t('c_' + n))}</span>${CMD_KEYS[n] ? `<kbd>${CMD_KEYS[n]}</kbd>` : ''}<span class="why"></span></button>`).join('')}</div></div>`).join('');
}
let holdT = null;
function bindEstop() {
  const b = $('estop'), bar = b.querySelector('.hold');
  const start = () => {
    if (b.disabled || holdT) return; const t0 = performance.now();
    holdT = setInterval(() => { const p = (performance.now() - t0) / 1000; bar.style.width = Math.min(100, p * 100) + '%'; if (p >= 1) { stop(); doCommand('e_stop'); } }, 30);
  };
  const stop = () => { clearInterval(holdT); holdT = null; bar.style.width = '0'; };
  b.addEventListener('pointerdown', e => { e.preventDefault(); start(); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, stop));
  S.estopStart = start; S.estopStop = stop;
}
$('vpanel').addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('#estop')) return;
  const b = e.target.closest('button, [data-vid]'); if (!b || b.disabled) return;
  panelAction(e);
});
$('vpanel').addEventListener('click', e => { if (e.detail === 0) panelAction(e); }); // keyboard activation; mouse handled on pointerdown
function panelAction(e) {
  const q = s => e.target.closest(s);
  let b;
  if ((b = q('[data-cmd]'))) { if (!b.disabled) doCommand(b.dataset.cmd, { incId: b.dataset.inc, zoneId: b.dataset.zone, vid: b.dataset.zone && !S.sel ? null : undefined }); return; }
  if ((b = q('[data-step]'))) { const r = sim.checkStep(b.dataset.inc, b.dataset.step); if (!r.ok && r.reason) { toast(esc(t(r.reason, { cam: r.p.cam })), 'warn'); beep('deny'); const v = sim.veh(S.sel); if (r.p && r.p.cam) S.cam = r.p.cam; } updateUI(true); return; }
  if ((b = q('[data-cam]'))) { S.cam = b.dataset.cam; return; }
  if ((b = q('[data-ack]'))) { sim.ack(b.dataset.ack); updateUI(true); return; }
  if ((b = q('[data-resolve]'))) return openResolve(b.dataset.resolve);
  if ((b = q('[data-hand]'))) return openReassign(b.dataset.hand);
  if ((b = q('[data-esc]'))) { sim.escalate(b.dataset.esc); updateUI(true); return; }
  if ((b = q('[data-report]'))) return openReport(b.dataset.report);
  if ((b = q('[data-incsel]'))) { S.selInc = b.dataset.incsel; updateUI(true); return; }
  if (q('[data-follow]')) { map.follow = !map.follow; return; }
  if (q('[data-desel]')) { deselect(); return; }
  if ((b = q('[data-vid]'))) selectVehicle(b.dataset.vid);
}
function deselect() { S.sel = null; S.selInc = null; map.sel = null; map.follow = false; renderPanel(); }

// ---------- camera drawing ----------
let lastThumb = 0;
function drawCams(now) {
  if (!S.sel) return; const v = sim.veh(S.sel); if (!v) return;
  const m = $('camMain'); if (m && m._w) drawCam(m.getContext('2d'), m._w, m._h, S.cam, v, sim, now);
  if (now - lastThumb > 200) {
    lastThumb = now;
    document.querySelectorAll('.cams canvas').forEach(c => { if (!c._w) sizeCanvas(c); drawCam(c.getContext('2d'), c._w, c._h, c.dataset.cam, v, sim, now, true); });
  }
}

// ---------- update / loop ----------
let lastUI = 0, lastRtt = 0;
function updateUI(force = false) {
  renderTop(); renderQueue(); renderFleet(); renderPanel();
  if (force || S.tab !== 'log' || performance.now() % 2 < 1) renderBottom(); else renderBottom();
}
let last = performance.now();
function frame(now) {
  const dtR = Math.min(0.25, (now - last) / 1000); last = now;
  if (!S.paused) { let d = dtR * S.speed; while (d > 1e-6) { const s = Math.min(0.1, d); sim.step(s); d -= s; } }
  if (S.sel) { const v = sim.veh(S.sel); if (v) v.camSec[S.cam] = (v.camSec[S.cam] || 0) + dtR; }
  if (now - lastRtt > 500) { lastRtt = now; for (const v of sim.vehicles) { const a = S.rtt[v.id] = S.rtt[v.id] || []; a.push(Math.min(1500, v.net.rtt)); if (a.length > 80) a.shift(); } }
  map.draw(now); drawCams(now);
  if (now - lastUI > 250) { lastUI = now; updateUI(); }
  // repeating alarm for unacknowledged P1
  if (now - S.lastAlarm > 2600 && sim.incidents.some(i => i.prio === 1 && !i.ack && i.status !== 'RESOLVED')) { S.lastAlarm = now; beep('p1'); }
  requestAnimationFrame(frame);
}

// ---------- keyboard ----------
document.addEventListener('keydown', e => {
  audio();
  if (S.modal) { if (e.key === 'Escape') { closeModal(); e.preventDefault(); return; } if (S.modal.onKey && !['TEXTAREA', 'SELECT', 'INPUT'].includes(document.activeElement.tagName) && S.modal.onKey(e)) e.preventDefault(); return; }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  const k = e.key;
  const list = queueList();
  const idx = list.findIndex(i => i.id === S.selInc);
  if (k === 'j' || k === 'ArrowDown') { const n = list[Math.min(list.length - 1, idx + 1)]; if (n) selectIncident(n.id); e.preventDefault(); }
  else if (k === 'k' || k === 'ArrowUp') { const n = list[Math.max(0, idx - 1)]; if (n) selectIncident(n.id); e.preventDefault(); }
  else if (k === 'Enter') { if (idx < 0 && list[0]) selectIncident(list[0].id); }
  else if (k === 'a' || k === 'A') { if (S.selInc) { sim.ack(S.selInc); updateUI(true); } }
  else if (k === 'r' || k === 'R') { if (S.selInc) openResolve(S.selInc); }
  else if (k >= '1' && k <= '6') { S.cam = CAMS[+k - 1]; }
  else if (k === '[' || k === ']') { const i = sim.vehicles.findIndex(v => v.id === S.sel); const n = sim.vehicles[(i + (k === ']' ? 1 : -1) + sim.vehicles.length) % sim.vehicles.length]; selectVehicle(n.id); map.centerOn(n.x, n.y); }
  else if (k === 'f' || k === 'F') { if (S.sel) map.follow = !map.follow; }
  else if (k === 'g' || k === 'G') { map.follow = false; map.fit(); }
  else if (k === 'p' || k === 'P') { if (S.sel) doCommand('announce'); }
  else if (k === 't' || k === 'T') { if (S.sel) doCommand('intercom'); }
  else if (k === 'h' || k === 'H') { if (S.sel) doCommand('hazard'); }
  else if ((k === 'e' || k === 'E') && !e.repeat) { if (S.sel && S.estopStart) S.estopStart(); }
  else if (k === 'm' || k === 'M') { S.muteUntil = muted() ? 0 : Date.now() + 60000; }
  else if (k === '?') openHelp();
  else if (k === 'Escape') deselect();
});
document.addEventListener('keyup', e => { if ((e.key === 'e' || e.key === 'E') && S.estopStop) S.estopStop(); });
document.addEventListener('pointerdown', () => audio(), { once: true });

// ---------- header buttons ----------
$('btnMute').onclick = () => { S.muteUntil = muted() ? 0 : Date.now() + 60000; };
$('btnLang').onclick = () => { setLang(getLang() === 'ja' ? 'en' : 'ja'); applyStatic(); updateUI(true); };
$('btnTheme').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
$('btnHandover').onclick = openHandover; $('btnReport').onclick = () => openReport(); $('btnTrain').onclick = openTraining; $('btnHelp').onclick = openHelp;
$('mFit').onclick = () => { map.follow = false; map.fit(); };
$('mFollow').onclick = () => { if (S.sel) map.follow = !map.follow; };
$('lyZones').onchange = e => map.layers.zones = e.target.checked;
$('lyLabels').onchange = e => map.layers.labels = e.target.checked;
$('lyNet').onchange = e => map.layers.net = e.target.checked;

// ---------- boot ----------
applyTheme(store.get('theme', 'dark'));
window.addEventListener('resize', () => { resize(); document.querySelectorAll('.cams canvas').forEach(sizeCanvas); });
resize(); map.fit();
setTab('log');
updateUI(true);
requestAnimationFrame(frame);
