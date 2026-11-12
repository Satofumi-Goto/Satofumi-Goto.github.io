// Deterministic simulation of a Level-4 autonomous MaaS fleet under remote supervision.
// All values are synthetic training data, not operating records.
import { node, nodes, route, pathLength, edgeKey, zoneAt, ZONES, STOPS, stopByNode, HUB, HOSPITAL, LINES, nearestNode, dist } from './world.js';

export function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export const ME = 'OP-07';
export const RTT_ASSIST_MAX = 300;   // ms — remote assistance interlock threshold
export const RTT_LINK_LOST = 1000;   // ms — treated as link loss
export const LOSS_LINK_LOST = 15;    // %
export const WATCHDOG_S = 3;         // s of link loss before vehicle-side MRM
export const SLA = { 1: 10, 2: 30, 3: 120 };

const MOVING = new Set(['AUTO', 'REMOTE_GUIDED', 'MANUAL']);
export const STATE_SEVERITY = { MRM: 0, MRC: 1, WAIT_ASSIST: 2, REMOTE_GUIDED: 3, MANUAL: 4, DWELL: 6, AUTO: 7, IDLE: 8, CHARGING: 9, OUT_OF_SERVICE: 10 };

// SOP definitions. kind 'check' = operator visual confirmation (may require a camera view);
// kind 'act' = satisfied when one of the listed commands is executed while the incident is open.
export const ITYPES = {
  obstacle: { prio: 2, auto: true, cause: 'external', steps: [
    { id: 'obs_cam', kind: 'check', cam: 'front' },
    { id: 'obs_side', kind: 'check', cam: 'bev' },
    { id: 'obs_decide', kind: 'act', acts: ['approve_path', 'reroute'] },
    { id: 'pax_announce', kind: 'act', acts: ['announce'], req: i => i.data.pax > 0 },
  ], rec: ['approve_path', 'reroute', 'announce'] },
  pedestrian: { prio: 2, auto: true, cause: 'external', steps: [
    { id: 'ped_cam', kind: 'check', cam: 'front' },
    { id: 'ped_decide', kind: 'act', acts: ['approve_proceed', 'hold'] },
  ], rec: ['approve_proceed', 'hold'] },
  sensor: { prio: 2, auto: true, cause: 'vehicle', steps: [
    { id: 'sen_diag', kind: 'act', acts: ['run_diag'] },
    { id: 'sen_clean', kind: 'act', acts: ['sensor_clean', 'return_hub'] },
  ], rec: ['run_diag', 'sensor_clean', 'return_hub'] },
  latency: { prio: 2, auto: true, cause: 'network', steps: [
    { id: 'net_check', kind: 'check' },
    { id: 'net_switch', kind: 'act', acts: ['switch_carrier'] },
  ], rec: ['switch_carrier'] },
  link_loss: { prio: 1, auto: false, cause: 'network', steps: [
    { id: 'net_switch', kind: 'act', acts: ['switch_carrier'] },
    { id: 'link_cam', kind: 'check', cam: 'front' },
    { id: 'pax_announce', kind: 'act', acts: ['announce', 'intercom'], req: i => i.data.pax > 0 },
    { id: 'diag', kind: 'act', acts: ['run_diag'] },
    { id: 'resume_or_recover', kind: 'act', acts: ['resume', 'dispatch_crew'] },
  ], rec: ['switch_carrier', 'run_diag', 'resume'] },
  sos: { prio: 1, auto: false, cause: 'passenger', steps: [
    { id: 'sos_talk', kind: 'act', acts: ['intercom'] },
    { id: 'sos_cabin', kind: 'check', cam: 'cabin' },
    { id: 'sos_119', kind: 'act', acts: ['call_119'], req: i => i.data.subtype === 'medical' && i.data.revealed },
    { id: 'sos_route', kind: 'act', acts: ['divert_hospital', 'pull_over'], req: i => i.data.subtype === 'medical' && i.data.revealed },
  ], rec: ['intercom', 'call_119', 'divert_hospital'] },
  mrm: { prio: 1, auto: false, cause: 'vehicle', steps: [
    { id: 'mrc_cabin', kind: 'check', cam: 'cabin' },
    { id: 'mrc_rear', kind: 'check', cam: 'rear' },
    { id: 'pax_announce', kind: 'act', acts: ['announce', 'intercom'], req: i => i.data.pax > 0 },
    { id: 'diag', kind: 'act', acts: ['run_diag'] },
    { id: 'resume_or_recover', kind: 'act', acts: ['resume', 'dispatch_crew'] },
    { id: 'alt_arranged', kind: 'act', acts: ['alt_vehicle'], req: i => i.data.pax > 0 && i.data.diagFailed },
  ], rec: ['announce', 'run_diag', 'resume', 'dispatch_crew', 'alt_vehicle'] },
  signal: { prio: 2, auto: true, cause: 'infra', steps: [
    { id: 'sig_cam', kind: 'check', cam: 'front' },
    { id: 'sig_decide', kind: 'act', acts: ['approve_proceed', 'reroute'] },
    { id: 'sig_avoid', kind: 'act', acts: ['avoid_node'] },
    { id: 'sig_report', kind: 'act', acts: ['contact_road'] },
  ], rec: ['approve_proceed', 'avoid_node', 'contact_road'] },
  ev: { prio: 2, auto: true, cause: 'external', steps: [
    { id: 'ev_cam', kind: 'check', cam: 'rear' },
    { id: 'ev_after', kind: 'check', cam: 'front' },
  ], rec: [] },
  weather: { prio: 1, auto: false, cause: 'weather', zoneLevel: true, steps: [
    { id: 'wx_zone', kind: 'act', acts: ['zone_restrict', 'zone_suspend'] },
    { id: 'wx_vehicles', kind: 'check' },
    { id: 'wx_notify', kind: 'act', acts: ['notify_customers'] },
  ], rec: ['zone_restrict', 'zone_suspend', 'notify_customers'] },
  battery: { prio: 3, auto: true, cause: 'vehicle', steps: [
    { id: 'bat_hub', kind: 'act', acts: ['return_hub'] },
  ], rec: ['return_hub'] },
  door: { prio: 2, auto: true, cause: 'vehicle', steps: [
    { id: 'door_cam', kind: 'check', cam: 'cabin' },
    { id: 'door_announce', kind: 'act', acts: ['announce'] },
    { id: 'door_fix', kind: 'act', acts: ['door_cycle', 'dispatch_crew'] },
  ], rec: ['door_cycle', 'announce', 'dispatch_crew'] },
  collision: { prio: 1, auto: false, cause: 'external', steps: [
    { id: 'col_cam', kind: 'check', cam: 'front' },
    { id: 'col_pax', kind: 'act', acts: ['intercom'], req: i => i.data.pax > 0 },
    { id: 'col_edr', kind: 'act', acts: ['edr_lock'] },
    { id: 'col_110', kind: 'act', acts: ['call_110'] },
    { id: 'col_crew', kind: 'act', acts: ['dispatch_crew'] },
    { id: 'alt_arranged', kind: 'act', acts: ['alt_vehicle'], req: i => i.data.pax > 0 },
  ], rec: ['edr_lock', 'call_110', 'dispatch_crew', 'alt_vehicle'] },
  wheelchair: { prio: 3, auto: true, cause: 'passenger', steps: [
    { id: 'wc_cam', kind: 'check', cam: 'cabin' },
    { id: 'wc_ramp', kind: 'act', acts: ['ramp'] },
  ], rec: ['ramp'] },
};
export const CAUSES = ['external', 'vehicle', 'network', 'passenger', 'weather', 'infra', 'false_alarm', 'other'];
export const CAMS = ['front', 'rear', 'left', 'right', 'cabin', 'bev'];

// Commands: confirm 0 none, 1 dialog, 2 hold-to-confirm. scope v=vehicle link, s=server-side, z=zone.
export const COMMANDS = {
  e_stop:          { group: 'control', confirm: 2, scope: 'v', danger: true },
  pull_over:       { group: 'control', confirm: 1, scope: 'v' },
  resume:          { group: 'control', confirm: 1, scope: 'v' },
  hazard:          { group: 'control', confirm: 0, scope: 'v' },
  speed_limit:     { group: 'control', confirm: 0, scope: 'v' },
  approve_path:    { group: 'assist', confirm: 1, scope: 'v', assist: true },
  approve_proceed: { group: 'assist', confirm: 1, scope: 'v', assist: true },
  hold:            { group: 'assist', confirm: 0, scope: 'v', assist: true },
  reroute:         { group: 'assist', confirm: 1, scope: 'v', assist: true },
  run_diag:        { group: 'vehicle', confirm: 0, scope: 'v' },
  sensor_clean:    { group: 'vehicle', confirm: 0, scope: 'v' },
  switch_carrier:  { group: 'vehicle', confirm: 0, scope: 'v', ignoreLink: true },
  door_open:       { group: 'vehicle', confirm: 1, scope: 'v' },
  door_close:      { group: 'vehicle', confirm: 0, scope: 'v' },
  door_cycle:      { group: 'vehicle', confirm: 0, scope: 'v' },
  ramp:            { group: 'vehicle', confirm: 0, scope: 'v' },
  edr_lock:        { group: 'vehicle', confirm: 0, scope: 'v' },
  announce:        { group: 'pax', confirm: 0, scope: 'v' },
  intercom:        { group: 'pax', confirm: 0, scope: 'v' },
  divert_hospital: { group: 'pax', confirm: 1, scope: 'v' },
  notify_customers:{ group: 'pax', confirm: 0, scope: 's' },
  alt_vehicle:     { group: 'pax', confirm: 1, scope: 's' },
  return_hub:      { group: 'ops', confirm: 1, scope: 'v' },
  dispatch_crew:   { group: 'ops', confirm: 1, scope: 's' },
  manual_recover:  { group: 'ops', confirm: 1, scope: 's' },
  avoid_node:      { group: 'ops', confirm: 1, scope: 's' },
  call_119:        { group: 'ext', confirm: 1, scope: 's' },
  call_110:        { group: 'ext', confirm: 1, scope: 's' },
  contact_road:    { group: 'ext', confirm: 0, scope: 's' },
  zone_restrict:   { group: 'zone', confirm: 1, scope: 'z' },
  zone_suspend:    { group: 'zone', confirm: 1, scope: 'z' },
  zone_restore:    { group: 'zone', confirm: 1, scope: 'z' },
};

const r2 = x => Math.round(x * 100) / 100;

export class Sim {
  constructor(seed = 20261112) {
    this.seed = seed;
    this.r = mulberry32(seed);
    this.t = 0;
    this.epoch = Date.now();
    this.vehicles = []; this.incidents = []; this.logs = []; this.bookings = []; this.crews = []; this.handovers = [];
    this.zones = ZONES.map(z => ({ ...z, odd: 'NORMAL', rain: 0, vis: 10000, wind: 2 + this.r() * 3, wxTimer: 0 }));
    this.outages = new Map();      // nodeId -> { until }
    this.avoid = new Set();        // nodes excluded from routing fleet-wide
    this.blocked = new Map();      // edgeKey -> until
    this.settings = { auto: true, intensity: 1, team: true };
    this.ops = [
      { id: ME, me: true, name: { ja: 'あなた', en: 'You' } },
      { id: 'OP-03', name: { ja: '佐藤', en: 'Sato' } },
      { id: 'OP-11', name: { ja: '鈴木', en: 'Suzuki' } },
      { id: 'SV-01', sv: true, name: { ja: '監督者 高橋', en: 'Supervisor Takahashi' } },
    ];
    this.seq = { inc: 0, bk: 0, cmd: 0, crew: 0 };
    this.stats = { ack: [], res: [], slaMet: 0, slaMiss: 0, assists: 0, meters: 0, served: 0, delayed: 0 };
    this.listeners = [];
    this.nextBk = 3; this.nextInc = 12; this.dispatchTimer = 0; this.teamTimer = 0;
    this.initFleet();
    for (let k = 0; k < 6; k++) this.newBooking();
  }

  on(fn) { this.listeners.push(fn); }
  emit(ev) { for (const fn of this.listeners) fn(ev); }
  pick(a) { return a[Math.floor(this.r() * a.length)]; }
  clock() { return new Date(this.epoch + this.t * 1000); }
  zone(id) { return this.zones.find(z => z.id === id); }
  veh(id) { return this.vehicles.find(v => v.id === id); }
  inc(id) { return this.incidents.find(i => i.id === id); }
  op(id) { return this.ops.find(o => o.id === id); }

  log(lvl, key, p = {}, ref = {}) {
    const e = { t: this.t, lvl, key, p, vid: ref.vid || null, inc: ref.inc || null, op: ref.op || null };
    this.logs.push(e);
    if (this.logs.length > 600) this.logs.shift();
    if (ref.inc) { const i = this.inc(ref.inc); if (i) i.timeline.push(e); }
    this.emit({ type: 'log', e });
    return e;
  }

  // ---------------- fleet ----------------
  initFleet() {
    const startStops = ['1-1', '3-0', '7-0', '2-3', '6-3', '4-4', '8-2', '0-3'];
    for (let k = 0; k < 8; k++) this.vehicles.push(this.makeVehicle(`RT-${String(k + 1).padStart(2, '0')}`, 'RT', startStops[k]));
    const shStarts = [[0, 0], [0, 4], [1, 0], [1, 4]];
    shStarts.forEach(([li, si], k) => {
      const v = this.makeVehicle(`SH-${String(k + 1).padStart(2, '0')}`, 'SH', LINES[li].stops[si]);
      v.line = li; v.lineIdx = si; v.pax = Math.floor(this.r() * 6);
      this.vehicles.push(v); this.nextLineLeg(v);
    });
    // a vehicle starting on charge, and one with low SOC for realism
    const c = this.vehicles[7]; c.soc = 34; this.sendHub(c, 'charge', true);
    this.vehicles[5].soc = 23.5;
  }
  makeVehicle(id, type, at) {
    const n = node(at);
    return {
      id, type, cap: type === 'RT' ? 4 : 12, vmax: type === 'RT' ? 11.1 : 8.3,
      x: n.x, y: n.y, hd: 0, path: [at], seg: 0, prog: 0, v: 0, mode: 'IDLE', dwell: 0,
      soc: 45 + this.r() * 50, pax: 0, job: null, leg: null, line: null, lineIdx: 0, service: 'IN_SERVICE',
      sensors: { lidar: 'OK', camF: 'OK', camR: 'OK', camS: 'OK', radar: 'OK', gnss: 'OK', imu: 'OK' }, loc: 0.97 + this.r() * 0.02,
      net: { carrier: 'A', base: 55 + this.r() * 50, rtt: 80, loss: 0.2, degraded: 0, lost: 0, good: 0, switchCd: 0, bw: 32 },
      doors: 'CLOSED', hazard: false, capOp: null, capAuto: null, guided: 0, mrmDecel: 0, diag: null,
      call: null, crew: null, edr: false, ramp: null, incs: [], cmds: [], camSec: {}, odo: 12000 + this.r() * 40000,
      after: null, holdT: 0, evT: 0, rescueOf: null, sigApproved: null, temp: 34 + this.r() * 6,
    };
  }
  curNode(v) { return v.path[Math.min(v.seg + (v.prog > 0 ? 1 : 0), v.path.length - 1)]; }
  atNode(v) { return v.seg >= v.path.length - 1 ? v.path[v.path.length - 1] : (v.prog < 0.5 ? v.path[v.seg] : null); }
  remaining(v) {
    if (v.seg >= v.path.length - 1) return 0;
    let s = dist(node(v.path[v.seg]), node(v.path[v.seg + 1])) - v.prog;
    for (let k = v.seg + 1; k + 1 < v.path.length; k++) s += dist(node(v.path[k]), node(v.path[k + 1]));
    return s;
  }
  distToNode(v, nid) {
    const idx = v.path.indexOf(nid, v.seg + 1);
    if (idx < 0) return Infinity;
    let s = dist(node(v.path[v.seg]), node(v.path[v.seg + 1])) - v.prog;
    for (let k = v.seg + 1; k < idx; k++) s += dist(node(v.path[k]), node(v.path[k + 1]));
    return s;
  }
  blockedSet() { return new Set(this.blocked.keys()); }
  avoidSet() {
    const s = new Set(this.avoid);
    for (const z of this.zones) if (z.odd === 'SUSPENDED') for (const n of nodes) if (zoneAt(n.x, n.y) === z.id) s.add(n.id);
    return s;
  }
  setDest(v, target) {
    const blocked = this.blockedSet(), avoid = this.avoidSet();
    if (v.seg < v.path.length - 1 && v.prog > 0) {
      const a = v.path[v.seg], b = v.path[v.seg + 1];
      const p = route(b, target, blocked, avoid) || route(b, target, blocked) || [b];
      v.path = [a, ...p]; v.seg = 0;
    } else {
      const from = v.path[Math.min(v.seg, v.path.length - 1)];
      const p = route(from, target, blocked, avoid) || route(from, target, blocked) || [from];
      v.path = p; v.seg = 0; v.prog = 0;
    }
    return v.path[v.path.length - 1] === target;
  }
  nextLineLeg(v) {
    const L = LINES[v.line];
    v.lineIdx = (v.lineIdx + 1) % L.stops.length;
    v.leg = { kind: 'LINE', target: L.stops[v.lineIdx] };
    this.setDest(v, v.leg.target);
    if (MOVING.has(v.mode) || v.mode === 'IDLE' || v.mode === 'DWELL') v.mode = 'AUTO';
  }
  sendHub(v, why, instant = false) {
    v.leg = { kind: 'HUB', target: HUB.node, why };
    if (instant) { const n = node(HUB.node); v.path = [HUB.node]; v.seg = 0; v.prog = 0; v.x = n.x; v.y = n.y; v.mode = 'CHARGING'; v.service = 'CHARGING'; return; }
    this.setDest(v, HUB.node);
    if (['IDLE', 'DWELL'].includes(v.mode)) v.mode = 'AUTO';
  }
  nearestStop(v) {
    let best = null, bd = Infinity;
    const from = this.curNode(v);
    for (const s of STOPS) {
      const p = route(from, s.node, this.blockedSet(), this.avoidSet());
      if (!p) continue;
      const d = pathLength(p);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  openIncs(v) { return v.incs.map(id => this.inc(id)).filter(i => i && i.status !== 'RESOLVED'); }
  topInc(v) { const a = this.openIncs(v); a.sort((x, y) => x.prio - y.prio || x.created - y.created); return a[0] || null; }
  linkLost(v) { return v.net.rtt >= RTT_LINK_LOST || v.net.loss >= LOSS_LINK_LOST; }
  zoneOf(v) { return zoneAt(v.x, v.y); }

  // ---------------- bookings (MaaS) ----------------
  newBooking(forced = {}) {
    const o = forced.o || this.pick(STOPS).node;
    let d = forced.d || this.pick(STOPS).node;
    while (d === o) d = this.pick(STOPS).node;
    const id = `BK-${String(4100 + ++this.seq.bk)}`;
    const b = { id, o, d, pax: 1 + Math.floor(this.r() * this.r() * 3.2), wc: forced.wc ?? this.r() < 0.07, req: this.t, status: 'WAITING', vid: null, promise: null, pickup: null, done: null, delay: 0, notified: false, transfer: false };
    this.bookings.push(b);
    if (this.bookings.length > 160) this.bookings.splice(0, this.bookings.findIndex(x => x.status === 'DONE' || x.status === 'CANCELLED') + 1 || 1);
    return b;
  }
  dispatch() {
    const avoid = this.avoidSet();
    for (const v of this.vehicles) if (v.type === 'RT' && v.mode === 'IDLE' && !v.job && v.soc < 22 && v.service === 'IN_SERVICE' && !this.openIncs(v).length) { this.sendHub(v, 'charge'); v.mode = 'AUTO'; }
    for (const b of this.bookings) {
      if (b.status === 'HELD' && !avoid.has(b.o) && !avoid.has(b.d)) b.status = 'WAITING';
      if (b.status !== 'WAITING') continue;
      if (avoid.has(b.o) || avoid.has(b.d)) { b.status = 'HELD'; continue; }
      let best = null, bd = Infinity;
      for (const v of this.vehicles) {
        if (v.type !== 'RT' || v.service !== 'IN_SERVICE' || v.job || v.soc < 22 || v.after) continue;
        if (!['IDLE', 'AUTO'].includes(v.mode) || (v.leg && v.leg.kind !== 'STAGE') || this.openIncs(v).length) continue;
        if (b.pax > v.cap) continue;
        const p = route(this.curNode(v), b.o, this.blockedSet(), avoid);
        if (!p) continue;
        const d = pathLength(p) + this.remaining(v) * 0;
        if (d < bd) { bd = d; best = v; }
      }
      if (!best) continue;
      b.status = 'ASSIGNED'; b.vid = best.id; b.promise = this.t + bd / 8 + 25;
      best.job = b.id; best.leg = { kind: 'PICKUP', target: b.o };
      this.setDest(best, b.o); best.mode = 'AUTO';
    }
  }
  affectedBookings(v) {
    if (!v) return [];
    return this.bookings.filter(b => (b.vid === v.id && ['ASSIGNED', 'ONBOARD'].includes(b.status)));
  }
  zoneBookings(zid) {
    return this.bookings.filter(b => ['WAITING', 'HELD', 'ASSIGNED', 'ONBOARD'].includes(b.status) && (zoneAt(node(b.o).x, node(b.o).y) === zid || zoneAt(node(b.d).x, node(b.d).y) === zid));
  }

  // ---------------- main loop ----------------
  step(dt) {
    this.t += dt;
    for (const v of this.vehicles) this.updateVehicle(v, dt);
    this.updateCrews(dt);
    this.updateZones(dt);
    this.updateCommands();
    this.updateIncidents(dt);
    for (const [k, until] of this.blocked) if (this.t > until) this.blocked.delete(k);
    for (const [n, o] of this.outages) if (this.t > o.until) { this.outages.delete(n); this.avoid.delete(n); this.log('info', 'lg_signal_restored', { node: n }); }
    if ((this.nextBk -= dt) <= 0) { this.newBooking(); this.nextBk = 20 + this.r() * 22; }
    if ((this.dispatchTimer -= dt) <= 0) { this.dispatch(); this.dispatchTimer = 1; }
    if (this.settings.auto && (this.nextInc -= dt * this.settings.intensity) <= 0) { this.randomIncident(); this.nextInc = 30 + this.r() * 45; }
    if (this.settings.team && (this.teamTimer -= dt) <= 0) { this.teamWork(); this.teamTimer = 2; }
  }

  targetSpeed(v) {
    let cap = v.vmax;
    const z = this.zone(this.zoneOf(v));
    cap = Math.min(cap, z.speedLimit);
    if (z.odd === 'RESTRICTED') cap = Math.min(cap, 5.5);
    if (z.rain > 30) cap = Math.min(cap, cap * 0.65);
    if (v.capOp) cap = Math.min(cap, v.capOp);
    if (v.capAuto) cap = Math.min(cap, v.capAuto);
    if (v.mode === 'REMOTE_GUIDED') cap = Math.min(cap, 2.5);
    if (v.mode === 'MANUAL') cap = Math.min(cap, 6);
    if (v.net.rtt > RTT_ASSIST_MAX && !this.linkLost(v)) cap = Math.min(cap, 7); // degraded-comm speed policy
    return cap;
  }

  updateVehicle(v, dt) {
    const n = this.net(v, dt);
    // vehicle-side watchdog: link loss → autonomous MRM
    if (this.linkLost(v) && MOVING.has(v.mode) && v.mode !== 'MANUAL') {
      v.net.lost += dt;
      if (v.net.lost >= WATCHDOG_S) {
        this.startMRM(v, 2.2);
        if (!this.openIncs(v).some(i => i.type === 'link_loss')) this.raise('link_loss', v, { rtt: Math.round(v.net.rtt) });
      }
    } else if (!this.linkLost(v)) v.net.lost = 0;

    // timers
    if (v.diag && this.t >= v.diag.end && !v.diag.done) this.finishDiag(v);
    if (v.ramp && this.t >= v.ramp.end && !v.ramp.done) { v.ramp.done = true; this.log('info', 'lg_ramp_done', {}, { vid: v.id }); }
    if (v.call && v.call.lines.length && this.t >= v.call.nextAt) {
      const line = v.call.lines.shift(); v.call.transcript.push({ t: this.t, who: 'pax', key: line });
      v.call.nextAt = this.t + 4 + this.r() * 3;
      const inc = this.openIncs(v).find(i => i.type === 'sos');
      if (inc && line.startsWith('tr_med') && !inc.data.revealed) { inc.data.revealed = true; this.log('crit', 'lg_sos_medical', {}, { vid: v.id, inc: inc.id }); }
      if (inc && line.startsWith('tr_mis') && !inc.data.revealed) { inc.data.revealed = true; this.log('info', 'lg_sos_mistake', {}, { vid: v.id, inc: inc.id }); }
    }
    if (v.mode === 'WAIT_ASSIST' && v.evT > 0) { v.evT -= dt; if (v.evT <= 0) { v.mode = 'AUTO'; this.log('info', 'lg_ev_passed', {}, { vid: v.id }); } }
    if (v.mode === 'WAIT_ASSIST' && v.holdT > 0) {
      v.holdT -= dt;
      if (v.holdT <= 0) {
        const inc = this.openIncs(v).find(i => i.type === 'pedestrian');
        if (inc && this.r() < 0.7) { inc.data.cleared = true; v.mode = 'AUTO'; this.log('info', 'lg_ped_cleared', {}, { vid: v.id, inc: inc.id }); }
        else if (inc) { this.log('warn', 'lg_ped_still', {}, { vid: v.id, inc: inc.id }); }
      }
    }
    if (v.mode === 'REMOTE_GUIDED') { v.guided -= dt; if (v.guided <= 0) { v.mode = 'AUTO'; this.log('info', 'lg_guided_done', {}, { vid: v.id }); } }

    // dwell
    if (v.mode === 'DWELL') {
      v.dwell -= dt;
      const holdForRamp = v.ramp && !v.ramp.done;
      const needRamp = this.openIncs(v).some(i => i.type === 'wheelchair') && !(v.ramp && v.ramp.done);
      if (v.dwell < 3 && v.doors === 'OPEN' && !holdForRamp && !needRamp) v.doors = 'CLOSED';
      if (v.dwell <= 0 && v.doors === 'CLOSED' && !needRamp && !holdForRamp) { v.ramp = null; this.afterDwell(v); }
      if (v.dwell < -1 && (needRamp || holdForRamp)) v.dwell = 0.5;
    }
    if (v.mode === 'CHARGING') {
      v.soc = Math.min(100, v.soc + 0.12 * dt);
      if (v.soc >= 90 && v.service === 'CHARGING') { v.service = 'IN_SERVICE'; v.mode = 'IDLE'; v.leg = null; this.log('info', 'lg_charged', { soc: Math.round(v.soc) }, { vid: v.id }); }
    }

    // longitudinal control
    const moving = MOVING.has(v.mode) || v.mode === 'MRM';
    let want = moving && v.mode !== 'MRM' ? this.targetSpeed(v) : 0;
    let rem = this.remaining(v);
    for (const [nid] of this.outages) {
      if (v.sigApproved === nid || v.mode === 'MANUAL') continue;
      const d = this.distToNode(v, nid);
      if (d < 120) {
        rem = Math.min(rem, Math.max(0, d - 14));
        if (d - 14 < 2 && v.v < 0.3 && v.mode === 'AUTO' && !this.openIncs(v).some(i => i.type === 'signal')) {
          v.mode = 'WAIT_ASSIST'; this.raise('signal', v, { node: nid });
        }
      }
    }
    if (moving && v.mode !== 'MRM') want = Math.min(want, rem <= 0.3 ? 0 : Math.sqrt(2 * 1.4 * rem) + 0.35);
    const decel = v.mode === 'MRM' ? v.mrmDecel : 2.6;
    if (v.v < want) v.v = Math.min(want, v.v + 1.1 * dt); else v.v = Math.max(want, v.v - decel * dt);
    if (v.mode === 'MRM' && v.v <= 0.02) { v.v = 0; v.mode = 'MRC'; this.log('crit', 'lg_mrc', {}, { vid: v.id }); this.emit({ type: 'mrc', vid: v.id }); }
    if (v.mode === 'WAIT_ASSIST' || v.mode === 'MRC') v.v = Math.max(0, v.v - 3 * dt);

    // integrate along path
    let move = v.v * dt;
    if (move > 0 && v.mode !== 'MRC') {
      this.stats.meters += move; v.odo += move;
      v.soc = Math.max(0, v.soc - move * 0.0011 * (v.type === 'SH' ? 1.3 : 1));
      while (move > 0 && v.seg < v.path.length - 1) {
        const a = node(v.path[v.seg]), b = node(v.path[v.seg + 1]);
        const L = dist(a, b);
        if (v.prog + move < L) { v.prog += move; move = 0; }
        else { move -= (L - v.prog); v.prog = 0; v.seg++; if (v.sigApproved === v.path[v.seg]) v.sigApproved = null; }
      }
      if (v.seg >= v.path.length - 1) v.v = 0;
    }
    // pose
    if (v.seg < v.path.length - 1) {
      const a = node(v.path[v.seg]), b = node(v.path[v.seg + 1]);
      const L = dist(a, b), f = v.prog / L;
      const tx = (b.x - a.x) / L, ty = (b.y - a.y) / L;
      v.x = a.x + (b.x - a.x) * f + (-ty) * -7; v.y = a.y + (b.y - a.y) * f + tx * -7; // keep-left offset
      v.hd = Math.atan2(ty, tx);
    } else {
      const a = node(v.path[v.path.length - 1]);
      v.x += (a.x - v.x) * Math.min(1, dt * 3); v.y += (a.y - v.y) * Math.min(1, dt * 3);
      if (v.leg && MOVING.has(v.mode) && v.v < 0.05) this.arrive(v);
    }
    // SOC monitor
    if (v.soc < 15 && v.service === 'IN_SERVICE' && !(v.leg && v.leg.kind === 'HUB') && !this.openIncs(v).some(i => i.type === 'battery')) this.raise('battery', v, { soc: Math.round(v.soc) });
    v.temp += (34 + v.v * 0.6 - v.temp) * dt * 0.01;
    return n;
  }

  net(v, dt) {
    const N = v.net;
    if (N.switchCd > 0) N.switchCd -= dt;
    const bridge = Math.abs(v.y - (node('0-3').y + 115)) < 60 ? 70 : 0;
    const target = N.base + N.degraded + bridge;
    N.rtt += (target + (this.r() - 0.5) * 30 - N.rtt) * Math.min(1, dt * 1.5);
    N.loss += ((N.degraded > 900 ? 22 : N.degraded > 0 ? 3.5 : 0.2) + this.r() * 0.3 - N.loss) * Math.min(1, dt);
    N.bw = Math.max(1, (N.degraded > 900 ? 0.6 : N.degraded > 0 ? 6 : 28) + (this.r() - 0.5) * 4);
    if (N.rtt < 250) N.good += dt; else N.good = 0;
  }

  arrive(v) {
    const at = v.path[v.path.length - 1];
    const leg = v.leg; if (!leg) return;
    if (v.after === 'DROP_HUB' && stopByNode.get(at) && v.pax > 0) { this.beginDwell(v, 20); v.leg = { kind: 'DROP', target: at }; return; }
    switch (leg.kind) {
      case 'PICKUP': {
        const b = this.bookings.find(x => x.id === v.job);
        this.beginDwell(v, 22);
        if (b) {
          b.status = 'ONBOARD'; b.pickup = this.t; v.pax += b.pax;
          if (b.promise && this.t > b.promise + 60) this.stats.delayed++;
          if (b.wc) this.raise('wheelchair', v, { bk: b.id });
        }
        v.leg = { kind: 'BOARDED', target: at };
        break;
      }
      case 'DROPOFF': {
        const b = this.bookings.find(x => x.id === v.job);
        this.beginDwell(v, 18);
        if (b) { b.status = 'DONE'; b.done = this.t; v.pax = Math.max(0, v.pax - b.pax); this.stats.served++; }
        v.job = null; v.leg = { kind: 'ALIGHT', target: at };
        break;
      }
      case 'LINE': {
        const off = Math.min(v.pax, Math.floor(this.r() * (v.pax + 1)));
        v.pax -= off; v.pax = Math.min(v.cap, v.pax + Math.floor(this.r() * 5));
        this.beginDwell(v, 20); v.leg = { kind: 'LINE_DWELL', target: at };
        break;
      }
      case 'HOSP': {
        this.beginDwell(v, 40); v.leg = { kind: 'HOSP_DWELL', target: at };
        this.log('warn', 'lg_hospital_arrived', {}, { vid: v.id });
        break;
      }
      case 'RESCUE': {
        const s = this.veh(v.rescueOf);
        this.beginDwell(v, 30); v.leg = { kind: 'RESCUE_DWELL', target: at };
        if (s) {
          const n = Math.min(s.pax, v.cap - v.pax); s.pax -= n; v.pax += n;
          const sb = this.bookings.find(x => x.id === s.job && x.status === 'ONBOARD');
          if (sb && !v.job) { sb.vid = v.id; sb.transfer = true; v.job = sb.id; s.job = null; }
          this.log('info', 'lg_rescue_transfer', { n, from: s.id }, { vid: v.id });
        }
        break;
      }
      case 'HUB': {
        v.v = 0; v.after = null;
        if (leg.why === 'maint') { v.mode = 'OUT_OF_SERVICE'; v.service = 'OUT_OF_SERVICE'; this.log('info', 'lg_hub_maint', {}, { vid: v.id }); }
        else { v.mode = 'CHARGING'; v.service = 'CHARGING'; this.log('info', 'lg_hub_charge', { soc: Math.round(v.soc) }, { vid: v.id }); }
        break;
      }
      case 'STAGE': default: v.mode = 'IDLE'; v.leg = null; break;
    }
  }
  beginDwell(v, s) { v.mode = 'DWELL'; v.dwell = s; v.v = 0; v.doors = 'OPEN'; }
  afterDwell(v) {
    const leg = v.leg || {};
    if (v.after === 'DROP_HUB' || v.after === 'HUB') {
      if (leg.kind === 'DROP') { const b = this.bookings.find(x => x.id === v.job); if (b) { b.status = 'WAITING'; b.vid = null; b.transfer = true; b.o = leg.target; } v.job = null; v.pax = 0; }
      v.after = null; this.sendHub(v, v.hubWhy || 'maint'); v.mode = 'AUTO'; return;
    }
    if (leg.kind === 'BOARDED') {
      const b = this.bookings.find(x => x.id === v.job);
      if (b) { v.leg = { kind: 'DROPOFF', target: b.d }; this.setDest(v, b.d); v.mode = 'AUTO'; return; }
    }
    if (leg.kind === 'RESCUE_DWELL') {
      v.rescueOf = null;
      const b = this.bookings.find(x => x.id === v.job);
      if (b) { b.status = 'ONBOARD'; v.leg = { kind: 'DROPOFF', target: b.d }; this.setDest(v, b.d); v.mode = 'AUTO'; return; }
      v.leg = { kind: 'DROPOFF', target: '1-1' }; this.setDest(v, '1-1'); v.mode = 'AUTO'; return;
    }
    if (leg.kind === 'HOSP_DWELL') { v.pax = 0; const b = this.bookings.find(x => x.id === v.job); if (b) { b.status = 'DONE'; b.done = this.t; } v.job = null; }
    if (v.line !== null) { this.nextLineLeg(v); return; }
    if (v.soc < 25) { this.sendHub(v, 'charge'); v.mode = 'AUTO'; return; }
    v.mode = 'IDLE'; v.leg = null;
  }

  // ---------------- incidents ----------------
  raise(type, v, data = {}, zoneId = null) {
    const T = ITYPES[type];
    const id = `INC-${String(++this.seq.inc).padStart(4, '0')}`;
    const z = zoneId || (v ? this.zoneOf(v) : null);
    const inc = {
      id, type, prio: T.prio, vid: v ? v.id : null, zone: z, created: this.t, ack: null, assignee: null,
      status: 'NEW', resolved: null, steps: {}, timeline: [], data: { ...data, pax: v ? v.pax : 0 }, escalated: false,
      camBase: v ? { ...v.camSec } : {}, x: v ? v.x : null, y: v ? v.y : null, cause: null, note: '', slaMissed: false,
      bookings: v ? this.affectedBookings(v).map(b => b.id) : this.zoneBookings(z).map(b => b.id), autoNote: null,
    };
    this.incidents.push(inc);
    if (v) v.incs.push(id);
    this.applyEffect(inc, v);
    this.log(T.prio === 1 ? 'crit' : T.prio === 2 ? 'warn' : 'info', 'lg_raised', { type, prio: T.prio }, { vid: inc.vid, inc: id });
    this.emit({ type: 'incident', inc });
    return inc;
  }
  applyEffect(inc, v) {
    const r = this.r;
    switch (inc.type) {
      case 'obstacle': v.mode = 'WAIT_ASSIST'; inc.data.edge = v.seg < v.path.length - 1 ? edgeKey(v.path[v.seg], v.path[v.seg + 1]) : null; inc.data.obj = this.pick(['parked_truck', 'parked_car', 'debris']); break;
      case 'pedestrian': v.mode = 'WAIT_ASSIST'; break;
      case 'sensor': v.sensors.lidar = 'DEGRADED'; v.loc = 0.83; v.capAuto = 5.5; inc.data.cause = this.pick(['dirt', 'rain', 'calib']); break;
      case 'latency': v.net.degraded = r() < 0.2 ? 1400 : 420 + r() * 420; break;
      case 'link_loss': v.hazard = true; break;
      case 'sos': inc.data.subtype = r() < 0.65 ? 'medical' : 'mistake'; inc.data.revealed = false; break;
      case 'mrm': this.startMRM(v, 2.0); v.hazard = true; inc.data.cause = this.pick(['planner', 'ecu', 'loc']); inc.data.diagPass = r() < 0.65; break;
      case 'ev': v.mode = 'WAIT_ASSIST'; v.evT = 14; break;
      case 'door': v.doors = 'FAULT'; break;
      case 'collision': this.startMRM(v, 4.5); v.hazard = true; inc.data.g = r2(0.6 + r() * 0.9); break;
      case 'weather': { const z = this.zone(inc.zone); z.rain = 46 + r() * 12; z.vis = 220 + r() * 120; z.wind = 11 + r() * 5; z.wxTimer = 300; break; }
      case 'signal': this.outages.set(inc.data.node, { until: this.t + 300 }); break;
    }
  }
  startMRM(v, decel) {
    if (v.mode === 'MRM' || v.mode === 'MRC') return;
    v.mode = 'MRM'; v.mrmDecel = decel; v.hazard = true; v.guided = 0;
    this.log('crit', 'lg_mrm_start', { d: decel }, { vid: v.id });
  }
  finishDiag(v) {
    v.diag.done = true;
    const inc = this.openIncs(v).find(i => ['mrm', 'link_loss', 'sensor', 'collision'].includes(i.type));
    let pass = true;
    if (inc && inc.type === 'mrm') pass = inc.data.diagPass;
    if (inc && inc.type === 'sensor') pass = v.sensors.lidar === 'OK';
    if (inc && inc.type === 'collision') pass = false;
    if (Object.values(v.sensors).includes('FAULT')) pass = false;
    v.diag.pass = pass;
    if (inc) { inc.data.diagDone = true; inc.data.diagFailed = !pass; }
    this.log(pass ? 'info' : 'warn', pass ? 'lg_diag_pass' : 'lg_diag_fail', {}, { vid: v.id, inc: inc && inc.id });
  }
  stepRequired(inc, s) { return s.req ? !!s.req(inc) : true; }
  pendingSteps(inc) { return ITYPES[inc.type].steps.filter(s => this.stepRequired(inc, s) && !inc.steps[s.id]); }
  camSeen(inc, cam) {
    const v = this.veh(inc.vid); if (!v) return 0;
    return (v.camSec[cam] || 0) - (inc.camBase[cam] || 0);
  }
  checkStep(incId, stepId, op = ME) {
    const inc = this.inc(incId); if (!inc || inc.status === 'RESOLVED') return { ok: false };
    const s = ITYPES[inc.type].steps.find(x => x.id === stepId);
    if (!s || s.kind !== 'check') return { ok: false };
    if (s.cam && this.camSeen(inc, s.cam) < 1.5 && op === ME) return { ok: false, reason: 'il_cam_first', p: { cam: s.cam } };
    if (inc.steps[stepId]) { delete inc.steps[stepId]; this.log('op', 'lg_step_undo', { step: stepId }, { vid: inc.vid, inc: inc.id, op }); return { ok: true }; }
    inc.steps[stepId] = { t: this.t, by: op };
    this.touch(inc, op);
    this.log('op', 'lg_step', { step: stepId }, { vid: inc.vid, inc: inc.id, op });
    return { ok: true };
  }
  touch(inc, op) { if (!inc.ack) this.ack(inc.id, op); if (inc.status === 'ACK') inc.status = 'IN_PROGRESS'; }
  ack(incId, op = ME) {
    const inc = this.inc(incId); if (!inc || inc.ack) return;
    inc.ack = this.t; inc.assignee = op; inc.status = 'ACK';
    const took = this.t - inc.created; this.stats.ack.push(took);
    if (took <= SLA[inc.prio]) this.stats.slaMet++; else if (!inc.slaMissed) { this.stats.slaMiss++; inc.slaMissed = true; }
    this.log('op', 'lg_ack', { s: Math.round(took) }, { vid: inc.vid, inc: inc.id, op });
  }
  assign(incId, op, note = '', by = ME) {
    const inc = this.inc(incId); if (!inc) return;
    if (!inc.ack) this.ack(incId, by);
    const from = inc.assignee; inc.assignee = op;
    this.log('op', 'lg_handover', { from, to: op, note }, { vid: inc.vid, inc: inc.id, op: by });
  }
  escalate(incId, op = ME, auto = false) {
    const inc = this.inc(incId); if (!inc || inc.escalated) return;
    inc.escalated = true;
    this.log(auto ? 'warn' : 'op', auto ? 'lg_escalate_auto' : 'lg_escalate', {}, { vid: inc.vid, inc: inc.id, op });
  }
  resolve(incId, cause, note = '', op = ME, force = false) {
    const inc = this.inc(incId); if (!inc || inc.status === 'RESOLVED') return { ok: false };
    const pend = this.pendingSteps(inc);
    if (pend.length && !force) return { ok: false, reason: 'il_steps_pending', p: { n: pend.length } };
    if (!inc.ack) this.ack(incId, op);
    inc.status = 'RESOLVED'; inc.resolved = this.t; inc.cause = cause || ITYPES[inc.type].cause; inc.note = note; inc.closedBy = op; inc.forced = force && pend.length > 0;
    this.stats.res.push(this.t - inc.created);
    const v = this.veh(inc.vid);
    if (v) { v.incs = v.incs.filter(x => x !== inc.id); if (!this.openIncs(v).some(i => i.prio === 1) && v.mode !== 'MRC') v.hazard = false; }
    this.log(inc.forced ? 'warn' : 'op', inc.forced ? 'lg_resolved_forced' : 'lg_resolved', { cause: inc.cause }, { vid: inc.vid, inc: inc.id, op });
    this.emit({ type: 'resolved', inc });
    return { ok: true };
  }
  autoClose(inc, why) {
    if (!inc.ack) { inc.ack = this.t; inc.assignee = inc.assignee || 'SYSTEM'; if (!inc.slaMissed && this.t - inc.created > SLA[inc.prio]) { inc.slaMissed = true; this.stats.slaMiss++; } }
    inc.autoNote = why;
    this.resolve(inc.id, ITYPES[inc.type].cause, '', inc.assignee || 'SYSTEM', true);
    inc.forced = false;
  }
  updateIncidents(dt) {
    for (const inc of this.incidents) {
      if (inc.status === 'RESOLVED') continue;
      const age = this.t - inc.created;
      if (!inc.ack && age > SLA[inc.prio] && !inc.slaMissed) { inc.slaMissed = true; this.stats.slaMiss++; this.escalate(inc.id, 'SYSTEM', true); this.emit({ type: 'sla', inc }); }
      const v = this.veh(inc.vid);
      if (v) { inc.x = v.x; inc.y = v.y; }
      if (inc.type === 'sos' && v && !inc.steps.sos_route && v.leg && ['HOSP', 'HOSP_DWELL'].includes(v.leg.kind)) inc.steps.sos_route = { t: this.t, by: 'SYSTEM', cmd: 'divert_hospital' };
      const T = ITYPES[inc.type]; if (!T.auto) continue;
      const stepsDone = this.pendingSteps(inc).length === 0;
      switch (inc.type) {
        case 'obstacle': if (stepsDone && v.mode === 'AUTO') this.autoClose(inc, 'ac_assist_done'); break;
        case 'pedestrian': if (inc.data.cleared && v.mode === 'AUTO') this.autoClose(inc, 'ac_self_cleared'); else if (stepsDone && v.mode === 'AUTO') this.autoClose(inc, 'ac_assist_done'); break;
        case 'sensor': if (v.sensors.lidar === 'OK' && stepsDone) this.autoClose(inc, 'ac_recovered'); else if (v.service !== 'IN_SERVICE' && stepsDone) this.autoClose(inc, 'ac_withdrawn'); break;
        case 'latency': if (v.net.good > 5 && stepsDone) this.autoClose(inc, 'ac_recovered'); else if (age > 100 && v.net.degraded > 0 && v.net.degraded < 900) { v.net.degraded = 1400; this.log('crit', 'lg_latency_worse', {}, { vid: v.id, inc: inc.id }); } break;
        case 'ev': if (v.mode === 'AUTO' && stepsDone) this.autoClose(inc, 'ac_assist_done'); break;
        case 'battery': if (v.leg && v.leg.kind === 'HUB' || v.mode === 'CHARGING') this.autoClose(inc, 'ac_to_hub'); break;
        case 'door': if (v.doors !== 'FAULT' && stepsDone) this.autoClose(inc, 'ac_recovered'); break;
        case 'wheelchair': if (v.ramp && v.ramp.done && stepsDone) this.autoClose(inc, 'ac_assist_done'); break;
        case 'signal': if (stepsDone && v.mode === 'AUTO' && v.path.indexOf(inc.data.node, v.seg + 1) < 0) this.autoClose(inc, 'ac_assist_done'); break;
      }
    }
  }
  updateZones(dt) {
    for (const z of this.zones) {
      if (z.wxTimer > 0) { z.wxTimer -= dt; if (z.wxTimer <= 0) this.log('info', 'lg_wx_easing', { zone: z.id }); }
      else if (z.rain > 0) { z.rain = Math.max(0, z.rain - dt * 0.8); z.vis = Math.min(10000, z.vis + dt * 120); z.wind = Math.max(3, z.wind - dt * 0.1); }
    }
  }

  randomIncident() {
    const open = this.incidents.filter(i => i.status !== 'RESOLVED').length;
    if (open >= 7) return;
    const w = [['obstacle', 18], ['pedestrian', 14], ['sensor', 9], ['latency', 9], ['sos', 5], ['mrm', 4], ['signal', 4], ['ev', 8], ['weather', 2], ['door', 6], ['collision', 2]];
    let tot = w.reduce((s, x) => s + x[1], 0), x = this.r() * tot, type = 'obstacle';
    for (const [k, n] of w) { if ((x -= n) <= 0) { type = k; break; } }
    this.inject(type);
  }
  eligible(type, v) {
    if (v.service !== 'IN_SERVICE' || this.openIncs(v).length) return false;
    switch (type) {
      case 'door': return v.mode === 'DWELL' && v.dwell > 4;
      case 'sos': return v.pax > 0 && MOVING.has(v.mode);
      case 'ev': return v.mode === 'AUTO' && v.v > 3;
      case 'signal': return v.mode === 'AUTO' && v.v > 2 && v.seg < v.path.length - 1;
      default: return v.mode === 'AUTO' && v.v > 1.5;
    }
  }
  inject(type, vid = null, zoneId = null) {
    if (type === 'weather') {
      const zs = this.zones.filter(z => z.rain < 20);
      const z = zoneId ? this.zone(zoneId) : (zs.length ? this.pick(zs) : null);
      if (!z) return null;
      if (this.incidents.some(i => i.type === 'weather' && i.zone === z.id && i.status !== 'RESOLVED')) return null;
      return this.raise('weather', null, {}, z.id);
    }
    let cands = this.vehicles.filter(v => this.eligible(type, v));
    if (vid) { const v = this.veh(vid); cands = v && (this.eligible(type, v) || type === 'latency' || type === 'sensor') ? [v] : []; }
    if (!cands.length) return null;
    const v = this.pick(cands);
    if (type === 'signal') {
      const nid = v.path[v.seg + 1];
      if (stopByNode.get(nid) || nid === HUB.node) return null;
      this.outages.set(nid, { until: this.t + 300 });
      this.log('warn', 'lg_signal_out', { node: nid }, {});
      return { pending: true };
    }
    return this.raise(type, v);
  }

  // ---------------- commands ----------------
  interlock(name, v, inc, zone) {
    const C = COMMANDS[name]; if (!C) return 'il_unknown';
    if (C.scope === 'z') {
      if (!zone) return 'il_no_zone';
      if (name === 'zone_restore' && zone.odd === 'NORMAL') return 'il_zone_normal';
      if (name === 'zone_restrict' && zone.odd === 'RESTRICTED') return 'il_already';
      if (name === 'zone_suspend' && zone.odd === 'SUSPENDED') return 'il_already';
      return null;
    }
    if (name === 'notify_customers') {
      const n = inc && inc.zone && !inc.vid ? this.zoneBookings(inc.zone).length : this.affectedBookings(v).length;
      return n ? null : 'il_no_bookings';
    }
    if (!v) return 'il_no_vehicle';
    if (C.scope === 'v' && !C.ignoreLink && this.linkLost(v) && name !== 'e_stop') return 'il_link_lost';
    const stopped = v.v < 0.15;
    const rttOk = v.net.rtt < RTT_ASSIST_MAX;
    const assistInc = t => this.openIncs(v).find(i => t.includes(i.type));
    switch (name) {
      case 'e_stop': if (this.linkLost(v)) return 'il_link_lost_wd'; if (v.mode === 'MRC' || (stopped && v.mode !== 'AUTO' && v.mode !== 'DWELL')) return 'il_already_stopped'; return null;
      case 'pull_over': if (!MOVING.has(v.mode)) return 'il_not_moving'; return null;
      case 'resume': {
        if (!['MRC', 'WAIT_ASSIST'].includes(v.mode)) return 'il_not_stopped_state';
        if (!rttOk) return 'il_rtt';
        if (v.doors !== 'CLOSED') return 'il_doors';
        if (this.zone(this.zoneOf(v)).odd === 'SUSPENDED') return 'il_zone_suspended';
        if (Object.values(v.sensors).includes('FAULT')) return 'il_sensor_fault';
        if (this.openIncs(v).some(i => i.type === 'collision')) return 'il_collision';
        const need = this.openIncs(v).find(i => ['mrm', 'link_loss'].includes(i.type));
        if (need && !(v.diag && v.diag.done && v.diag.pass && v.diag.at >= need.created)) return 'il_diag_required';
        if (v.mode === 'WAIT_ASSIST' && assistInc(['obstacle', 'pedestrian', 'signal'])) return 'il_use_assist';
        if (v.mode === 'WAIT_ASSIST' && assistInc(['ev'])) return 'il_ev_wait';
        if (need) { const cab = ITYPES[need.type].steps.find(s => s.cam === 'cabin'); if (cab && !need.steps[cab.id] && need.data.pax > 0) return 'il_cabin_check'; }
        return null;
      }
      case 'approve_path': case 'approve_proceed': {
        const types = name === 'approve_path' ? ['obstacle'] : ['pedestrian', 'signal'];
        const i = assistInc(types); if (!i) return 'il_no_request';
        if (v.mode !== 'WAIT_ASSIST' || !stopped) return 'il_not_stopped';
        if (!rttOk) return 'il_rtt';
        const checks = ITYPES[i.type].steps.filter(s => s.kind === 'check' && !i.steps[s.id]);
        if (checks.length) return 'il_sop_first';
        return null;
      }
      case 'hold': return assistInc(['pedestrian', 'obstacle', 'signal']) && v.mode === 'WAIT_ASSIST' ? null : 'il_no_request';
      case 'reroute': {
        if (!['WAIT_ASSIST', 'AUTO'].includes(v.mode)) return 'il_not_moving';
        if (v.mode === 'WAIT_ASSIST' && !rttOk) return 'il_rtt';
        if (!v.leg || ['BOARDED', 'ALIGHT', 'LINE_DWELL'].includes(v.leg.kind)) return 'il_no_route';
        return null;
      }
      case 'run_diag': if (!stopped) return 'il_must_stop'; if (v.diag && !v.diag.done) return 'il_running'; return null;
      case 'sensor_clean': return v.sensors.lidar === 'DEGRADED' ? (v.cleaning ? 'il_running' : null) : 'il_sensor_ok';
      case 'switch_carrier': return v.net.switchCd > 0 ? 'il_cooldown' : null;
      case 'door_open': if (!stopped) return 'il_must_stop'; if (v.doors !== 'CLOSED') return 'il_already'; return null;
      case 'door_close': return v.doors === 'OPEN' ? null : 'il_already';
      case 'door_cycle': return v.doors === 'FAULT' ? (v.cycling ? 'il_running' : null) : 'il_door_ok';
      case 'ramp': if (!stopped) return 'il_must_stop'; if (v.ramp && !v.ramp.done) return 'il_running'; if (!this.openIncs(v).some(i => i.type === 'wheelchair')) return 'il_no_request'; if (v.ramp && v.ramp.done) return 'il_already'; return null;
      case 'edr_lock': return v.edr ? 'il_already' : null;
      case 'announce': case 'intercom': case 'hazard': case 'speed_limit': return null;
      case 'divert_hospital': if (v.pax <= 0) return 'il_no_pax'; if (v.leg && v.leg.kind === 'HOSP') return 'il_already'; if (!['AUTO', 'WAIT_ASSIST', 'DWELL', 'MRC', 'IDLE'].includes(v.mode)) return 'il_not_moving'; if (v.mode === 'MRC') return 'il_mrc_resume_first'; return null;
      case 'alt_vehicle': if (v.pax <= 0) return 'il_no_pax'; if (!stopped) return 'il_must_stop'; if (this.vehicles.some(x => x.rescueOf === v.id)) return 'il_already'; return this.findRescue(v) ? null : 'il_no_idle';
      case 'return_hub': if (v.service !== 'IN_SERVICE') return 'il_already'; if (v.leg && v.leg.kind === 'HUB') return 'il_already'; if (['MRC', 'MRM'].includes(v.mode)) return 'il_mrc_resume_first'; return null;
      case 'dispatch_crew': return v.crew ? 'il_already' : null;
      case 'manual_recover': if (!v.crew || !v.crew.onsite) return 'il_crew_not_onsite'; if (v.pax > 0) return 'il_pax_onboard'; if (v.mode === 'MANUAL') return 'il_already'; return null;
      case 'avoid_node': { const i = assistInc(['signal']); if (!i) return 'il_no_request'; if (this.avoid.has(i.data.node)) return 'il_already'; return null; }
      case 'call_119': case 'call_110': case 'contact_road': return null;
    }
    return null;
  }
  findRescue(v) {
    let best = null, bd = Infinity;
    for (const x of this.vehicles) {
      if (x === v || x.type !== 'RT' || x.service !== 'IN_SERVICE' || x.job || x.pax || x.rescueOf || this.openIncs(x).length) continue;
      if (!['IDLE', 'AUTO'].includes(x.mode) || (x.leg && x.leg.kind !== 'STAGE')) continue;
      const p = route(this.curNode(x), nearestNode(v.x, v.y).id, this.blockedSet());
      if (!p) continue; const d = pathLength(p);
      if (d < bd) { bd = d; best = x; }
    }
    return best;
  }
  command(name, { vid = null, incId = null, zoneId = null, op = ME, args = {} } = {}) {
    const v = vid ? this.veh(vid) : null;
    const inc = incId ? this.inc(incId) : (v ? this.topInc(v) : null);
    const zone = zoneId ? this.zone(zoneId) : null;
    const reason = this.interlock(name, v, inc, zone);
    if (reason) return { ok: false, reason };
    const C = COMMANDS[name];
    const id = `CMD-${String(++this.seq.cmd).padStart(5, '0')}`;
    const lat = C.scope === 'v' ? (v.net.rtt * 2 / 1000 + 0.15) : 0.05;
    const cmd = { id, name, vid, zone: zoneId, inc: inc ? inc.id : null, op, args, issued: this.t, eta: this.t + lat, status: 'SENT', done: null };
    this.pendingCmds = this.pendingCmds || [];
    this.pendingCmds.push(cmd);
    if (v) { v.cmds.unshift(cmd); if (v.cmds.length > 10) v.cmds.pop(); }
    if (inc) this.touch(inc, op);
    if (C.assist) this.stats.assists++;
    this.log('op', 'lg_cmd_sent', { cmd: name, ...this.cmdParams(name, args) }, { vid, inc: inc && inc.id, op });
    return { ok: true, cmd };
  }
  cmdParams(name, args) { return args.msg ? { msg: args.msg } : {}; }
  updateCommands() {
    if (!this.pendingCmds) return;
    for (const c of this.pendingCmds) {
      if (c.status !== 'SENT') continue;
      const v = c.vid ? this.veh(c.vid) : null;
      if (v && COMMANDS[c.name].scope === 'v' && this.linkLost(v) && !COMMANDS[c.name].ignoreLink) {
        if (this.t - c.issued > 5) { c.status = 'FAILED'; this.log('crit', 'lg_cmd_timeout', { cmd: c.name }, { vid: c.vid, inc: c.inc, op: c.op }); }
        continue;
      }
      if (this.t < c.eta) continue;
      c.status = 'DONE'; c.done = this.t; c.rtt = Math.round((c.done - c.issued) * 1000);
      this.exec(c, v);
      const inc = c.inc ? this.inc(c.inc) : null;
      if (inc && inc.status !== 'RESOLVED') {
        for (const s of ITYPES[inc.type].steps) if (s.kind === 'act' && s.acts.includes(c.name) && !inc.steps[s.id]) inc.steps[s.id] = { t: this.t, by: c.op, cmd: c.name };
      }
      // zone-level incidents also satisfied by zone commands issued from zone panel
      if (c.zone) for (const i of this.incidents) if (i.status !== 'RESOLVED' && i.zone === c.zone && ITYPES[i.type].zoneLevel)
        for (const s of ITYPES[i.type].steps) if (s.kind === 'act' && s.acts.includes(c.name) && !i.steps[s.id]) { i.steps[s.id] = { t: this.t, by: c.op, cmd: c.name }; this.touch(i, c.op); }
    }
    this.pendingCmds = this.pendingCmds.filter(c => c.status === 'SENT');
  }
  exec(c, v) {
    const r = this.r, ref = { vid: c.vid, inc: c.inc, op: c.op };
    const inc = c.inc ? this.inc(c.inc) : null;
    switch (c.name) {
      case 'e_stop': this.startMRM(v, 4.5); this.log('crit', 'lg_estop', {}, ref); break;
      case 'pull_over': this.startMRM(v, 1.8); break;
      case 'resume': v.mode = 'AUTO'; v.hazard = false; v.mrmDecel = 0; if (!v.leg) { this.nextOrIdle(v); } else this.setDest(v, v.leg.target); this.log('info', 'lg_resumed', {}, ref); break;
      case 'hazard': v.hazard = !v.hazard; break;
      case 'speed_limit': v.capOp = v.capOp ? null : 5.6; this.log('info', v.capOp ? 'lg_cap_on' : 'lg_cap_off', {}, ref); break;
      case 'approve_path': {
        v.mode = 'REMOTE_GUIDED'; v.guided = 14;
        const i = this.openIncs(v).find(x => x.type === 'obstacle'); if (i) i.data.approved = this.t; break;
      }
      case 'approve_proceed': {
        const i = this.openIncs(v).find(x => ['pedestrian', 'signal'].includes(x.type));
        if (i && i.type === 'signal') v.sigApproved = i.data.node;
        v.mode = 'REMOTE_GUIDED'; v.guided = 9; break;
      }
      case 'hold': v.holdT = 8; this.log('info', 'lg_hold', {}, ref); break;
      case 'reroute': {
        const i = this.openIncs(v).find(x => ['obstacle', 'signal'].includes(x.type));
        if (v.seg < v.path.length - 1) {
          const a = v.path[v.seg], b = v.path[v.seg + 1];
          if (i && i.type === 'obstacle') {
            this.blocked.set(edgeKey(a, b), this.t + 240);
            const L = dist(node(a), node(b)); v.path = [b, a]; v.seg = 0; v.prog = Math.max(0, L - v.prog);
          }
        }
        const avoid = i && i.type === 'signal' ? i.data.node : null;
        if (avoid) this.avoid.add(avoid);
        const ok = this.setDest(v, v.leg.target);
        if (avoid && !i.steps.sig_avoid) { /* local avoid only */ this.avoid.delete(avoid); }
        if (i && i.type === 'signal') v.sigApproved = null;
        v.mode = i ? 'REMOTE_GUIDED' : 'AUTO'; v.guided = i ? 8 : 0;
        this.log(ok ? 'info' : 'warn', ok ? 'lg_rerouted' : 'lg_reroute_fail', { km: (this.remaining(v) / 1000).toFixed(1) }, ref);
        break;
      }
      case 'run_diag': v.diag = { start: this.t, end: this.t + 18, done: false, pass: null, at: this.t }; this.log('info', 'lg_diag_start', {}, ref); break;
      case 'sensor_clean': v.cleaning = true; setTimeoutSim(this, 8, () => { v.cleaning = false; if (r() < 0.75) { v.sensors.lidar = 'OK'; v.loc = 0.97; v.capAuto = null; this.log('info', 'lg_clean_ok', {}, ref); } else this.log('warn', 'lg_clean_fail', {}, ref); }); break;
      case 'switch_carrier': {
        v.net.carrier = v.net.carrier === 'A' ? 'B' : 'A'; v.net.switchCd = 10;
        const fix = r() < 0.85; if (fix) { v.net.degraded = 0; v.net.base = 60 + r() * 60; }
        this.log(fix ? 'info' : 'warn', fix ? 'lg_carrier_ok' : 'lg_carrier_fail', { c: v.net.carrier }, ref); break;
      }
      case 'door_open': v.doors = 'OPEN'; break;
      case 'door_close': v.doors = 'CLOSED'; break;
      case 'door_cycle': v.cycling = true; setTimeoutSim(this, 6, () => { v.cycling = false; if (r() < 0.6) { v.doors = 'CLOSED'; this.log('info', 'lg_door_ok', {}, ref); } else this.log('warn', 'lg_door_fail', {}, ref); }); break;
      case 'ramp': v.ramp = { end: this.t + 12, done: false }; v.dwell = Math.max(v.dwell, 14); break;
      case 'edr_lock': v.edr = true; this.log('info', 'lg_edr', {}, ref); break;
      case 'announce': this.log('info', 'lg_announce', { msg: c.args.msg || 'an_safety' }, ref); break;
      case 'intercom': {
        if (v.call) { this.log('info', 'lg_call_end', { s: Math.round(this.t - v.call.start) }, ref); v.call = null; break; }
        const sos = this.openIncs(v).find(x => x.type === 'sos');
        const col = this.openIncs(v).find(x => x.type === 'collision');
        let lines = ['tr_gen_1', 'tr_gen_2'];
        if (sos) lines = sos.data.subtype === 'medical' ? ['tr_med_1', 'tr_med_2', 'tr_med_3'] : ['tr_mis_1', 'tr_mis_2'];
        else if (col) lines = ['tr_col_1', 'tr_col_2'];
        else if (v.pax === 0) lines = ['tr_empty'];
        v.call = { start: this.t, lines, transcript: [], nextAt: this.t + 2.5 };
        this.log('info', 'lg_call_start', {}, ref); break;
      }
      case 'divert_hospital': v.leg = { kind: 'HOSP', target: HOSPITAL.node }; this.setDest(v, HOSPITAL.node); if (v.mode === 'WAIT_ASSIST' || v.mode === 'DWELL' || v.mode === 'IDLE') v.mode = 'AUTO'; v.doors = 'CLOSED';
        { const b = this.bookings.find(x => x.id === v.job); if (b) b.diverted = true; }
        this.log('warn', 'lg_divert', { min: Math.ceil(this.remaining(v) / 7 / 60) }, ref); break;
      case 'notify_customers': {
        const list = inc && !inc.vid ? this.zoneBookings(inc.zone) : this.affectedBookings(v);
        list.forEach(b => b.notified = true);
        this.log('info', 'lg_notified', { n: list.length }, ref); break;
      }
      case 'alt_vehicle': {
        const x = this.findRescue(v); if (!x) { this.log('warn', 'lg_no_idle', {}, ref); break; }
        x.rescueOf = v.id; x.leg = { kind: 'RESCUE', target: nearestNode(v.x, v.y).id }; this.setDest(x, x.leg.target); x.mode = 'AUTO';
        this.log('info', 'lg_alt', { x: x.id, min: Math.ceil(this.remaining(x) / 8 / 60) }, ref); break;
      }
      case 'return_hub': {
        v.hubWhy = inc && inc.type === 'battery' ? 'charge' : 'maint';
        if (v.pax > 0) { v.after = 'DROP_HUB'; const s = this.nearestStop(v); v.leg = { kind: 'DROPGO', target: s.node }; this.setDest(v, s.node); this.log('info', 'lg_hub_after_drop', { stop: s.node }, ref); }
        else { if (v.job) { const b = this.bookings.find(x => x.id === v.job); if (b) { b.status = 'WAITING'; b.vid = null; } v.job = null; } this.sendHub(v, v.hubWhy); this.log('info', 'lg_hub_go', {}, ref); }
        if (['WAIT_ASSIST', 'IDLE'].includes(v.mode)) v.mode = 'AUTO';
        break;
      }
      case 'dispatch_crew': {
        const h = node(HUB.node);
        const p = route(HUB.node, nearestNode(v.x, v.y).id) || [HUB.node];
        const cr = { id: `CRW-${++this.seq.crew}`, vid: v.id, path: p, seg: 0, prog: 0, x: h.x, y: h.y, sp: 9, onsite: false, eta: this.t + 60 + pathLength(p) / 9 };
        cr.depart = this.t + 60; // mobilisation time
        this.crews.push(cr); v.crew = cr;
        this.log('info', 'lg_crew', { id: cr.id, min: Math.ceil((cr.eta - this.t) / 60) }, ref); break;
      }
      case 'manual_recover': {
        v.mode = 'MANUAL'; v.hazard = true; v.service = 'OUT_OF_SERVICE'; v.leg = { kind: 'HUB', target: HUB.node, why: 'maint' }; this.setDest(v, HUB.node);
        this.log('info', 'lg_manual', {}, ref);
        for (const i of this.openIncs(v)) if (i.type === 'collision') i.data.recovered = true;
        break;
      }
      case 'avoid_node': { const i = this.openIncs(v).find(x => x.type === 'signal'); if (i) { this.avoid.add(i.data.node); for (const x of this.vehicles) if (x !== v && x.leg && MOVING.has(x.mode) && x.path.indexOf(i.data.node, x.seg + 1) >= 0) this.setDest(x, x.leg.target); this.log('info', 'lg_avoid', { node: i.data.node }, ref); } break; }
      case 'call_119': this.log('crit', 'lg_119', {}, ref); break;
      case 'call_110': this.log('crit', 'lg_110', {}, ref); break;
      case 'contact_road': this.log('info', 'lg_road', {}, ref); break;
      case 'zone_restrict': case 'zone_suspend': case 'zone_restore': {
        const z = this.zone(c.zone);
        z.odd = c.name === 'zone_restrict' ? 'RESTRICTED' : c.name === 'zone_suspend' ? 'SUSPENDED' : 'NORMAL';
        if (z.odd === 'SUSPENDED') {
          for (const x of this.vehicles) if (x.leg && MOVING.has(x.mode)) { const inside = zoneAt(x.x, x.y) === z.id; if (!inside) this.setDest(x, x.leg.target); else if (x.pax === 0 && x.type === 'RT') { const b = this.bookings.find(q => q.id === x.job && q.status === 'ASSIGNED'); if (b) { b.status = 'HELD'; b.vid = null; x.job = null; x.leg = null; x.mode = 'IDLE'; } } }
          for (const b of this.bookings) if (b.status === 'WAITING') { const av = this.avoidSet(); if (av.has(b.o) || av.has(b.d)) b.status = 'HELD'; }
        }
        this.log(z.odd === 'NORMAL' ? 'info' : 'warn', 'lg_zone', { zone: z.id, odd: z.odd }, ref); break;
      }
    }
  }
  nextOrIdle(v) { if (v.line !== null) { v.lineIdx--; this.nextLineLeg(v); } else v.mode = 'IDLE'; }
  updateCrews(dt) {
    for (const cr of this.crews) {
      if (cr.onsite || this.t < cr.depart) continue;
      let move = cr.sp * dt;
      while (move > 0 && cr.seg < cr.path.length - 1) {
        const a = node(cr.path[cr.seg]), b = node(cr.path[cr.seg + 1]), L = dist(a, b);
        if (cr.prog + move < L) { cr.prog += move; move = 0; } else { move -= L - cr.prog; cr.prog = 0; cr.seg++; }
      }
      if (cr.seg < cr.path.length - 1) { const a = node(cr.path[cr.seg]), b = node(cr.path[cr.seg + 1]), f = cr.prog / dist(a, b); cr.x = a.x + (b.x - a.x) * f; cr.y = a.y + (b.y - a.y) * f; }
      else {
        const v = this.veh(cr.vid); cr.x = v.x + 10; cr.y = v.y + 10; cr.onsite = true;
        this.log('info', 'lg_crew_onsite', { id: cr.id }, { vid: cr.vid });
        if (v.doors === 'FAULT') { v.doors = 'CLOSED'; this.log('info', 'lg_crew_door', {}, { vid: v.id }); }
      }
    }
    this.crews = this.crews.filter(cr => { const v = this.veh(cr.vid); if (cr.onsite && v && (v.service !== 'IN_SERVICE' && v.mode !== 'MRC' && v.mode !== 'MANUAL' || (v.mode === 'AUTO' && v.v > 3))) { v.crew = null; return false; } return true; });
  }

  // Virtual teammates take low-priority work so the operator can focus on safety-critical events.
  teamWork() {
    const mine = this.incidents.filter(i => i.status !== 'RESOLVED' && i.assignee === ME).length;
    for (const inc of this.incidents) {
      if (inc.status === 'RESOLVED') continue;
      const age = this.t - inc.created;
      const mates = ['OP-03', 'OP-11'];
      if (!inc.assignee && ((inc.prio === 3 && age > 25) || (inc.prio === 2 && mine >= 2 && age > 18))) {
        const load = op => this.incidents.filter(i => i.status !== 'RESOLVED' && i.assignee === op).length;
        const op = mates.sort((a, b) => load(a) - load(b))[0];
        if (load(op) >= 2) continue;
        this.ack(inc.id, op); inc.status = 'IN_PROGRESS'; inc.teamAt = this.t + 12 + this.r() * 18;
      }
      if (mates.includes(inc.assignee) && inc.teamAt && this.t > inc.teamAt) {
        inc.teamAt = this.t + 6;
        const v = this.veh(inc.vid);
        const step = this.pendingSteps(inc)[0];
        if (!step) { if (!ITYPES[inc.type].auto) this.resolve(inc.id, ITYPES[inc.type].cause, '', inc.assignee); continue; }
        if (step.kind === 'check') this.checkStep(inc.id, step.id, inc.assignee);
        else for (const a of step.acts) { const res = this.command(a, { vid: v && v.id, incId: inc.id, zoneId: inc.zone, op: inc.assignee }); if (res.ok) break; }
      }
    }
  }

  kpis() {
    const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
    const inSvc = this.vehicles.filter(v => v.service === 'IN_SERVICE').length;
    const active = this.vehicles.filter(v => v.service === 'IN_SERVICE' && (v.job || v.line !== null || v.rescueOf)).length;
    const km = this.stats.meters / 1000;
    const waiting = this.bookings.filter(b => b.status === 'WAITING' || b.status === 'HELD');
    const late = this.bookings.filter(b => ['ASSIGNED', 'ONBOARD'].includes(b.status) && b.promise && this.t > b.promise + 60 && !b.pickup).length;
    return {
      inSvc, active, total: this.vehicles.length, km, assists: this.stats.assists,
      assistPer100: km > 0.5 ? this.stats.assists / km * 100 : 0,
      ackAvg: avg(this.stats.ack), resAvg: avg(this.stats.res),
      sla: this.stats.slaMet + this.stats.slaMiss ? this.stats.slaMet / (this.stats.slaMet + this.stats.slaMiss) * 100 : 100,
      waiting: waiting.length, held: waiting.filter(b => b.status === 'HELD').length, late, served: this.stats.served,
      waitAvg: avg(waiting.map(b => this.t - b.req)),
    };
  }
}

// sim-time timers (so pause / speed changes stay consistent)
function setTimeoutSim(sim, s, fn) {
  sim.timers = sim.timers || [];
  sim.timers.push({ at: sim.t + s, fn });
  if (!sim._timerHooked) {
    sim._timerHooked = true;
    const orig = sim.step.bind(sim);
    sim.step = dt => { orig(dt); const due = sim.timers.filter(x => sim.t >= x.at); sim.timers = sim.timers.filter(x => sim.t < x.at); due.forEach(x => x.fn()); };
  }
}
