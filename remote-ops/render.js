// Canvas renderers: operations map and synthetic camera / BEV feeds.
import { nodes, edges, node, WORLD, RIVER_Y, ZONES, STOPS, HUB, OX, OY, SX, SY, COLS, ROWS, edgeKey } from './world.js';
import { t, getLang } from './i18n.js';
import { RTT_ASSIST_MAX } from './sim.js';

export const MODE_COLOR = {
  AUTO: '--ok', IDLE: '--muted', DWELL: '--info', WAIT_ASSIST: '--warn', REMOTE_GUIDED: '--accent',
  MRM: '--crit', MRC: '--crit', MANUAL: '--violet', CHARGING: '--info', OUT_OF_SERVICE: '--muted',
};
let C = {};
export function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['--bg', '--panel', '--panel2', '--ink', '--muted', '--line', '--ok', '--warn', '--crit', '--info', '--accent', '--violet', '--map-bg', '--map-block', '--map-road', '--map-river', '--map-park', '--map-mark'])
    C[k] = cs.getPropertyValue(k).trim();
}
export const col = k => C[k] || '#888';

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

export class MapView {
  constructor(canvas, sim, onPick) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.sim = sim; this.onPick = onPick;
    this.cx = WORLD.w / 2; this.cy = WORLD.h / 2; this.z = 0.5; this.sel = null; this.follow = false; this.selInc = null;
    this.layers = { zones: true, labels: true, routes: true, net: false };
    let drag = null;
    canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy, moved: false }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; this.follow = false; }
      this.cx = drag.cx - dx / this.z; this.cy = drag.cy - dy / this.z;
    });
    canvas.addEventListener('pointerup', e => { if (drag && !drag.moved) this.pick(e); drag = null; });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const [wx, wy] = this.toWorld(mx, my);
      this.z = Math.min(2.5, Math.max(0.25, this.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const [nx, ny] = this.toWorld(mx, my); this.cx += wx - nx; this.cy += wy - ny;
    }, { passive: false });
  }
  resize() {
    const r = this.c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height; this.c.width = Math.round(r.width * d); this.c.height = Math.round(r.height * d);
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
  }
  fit() { this.cx = WORLD.w / 2; this.cy = WORLD.h / 2; this.z = Math.min(this.w / (WORLD.w + 40), this.h / (WORLD.h + 40)); }
  toScreen(x, y) { return [(x - this.cx) * this.z + this.w / 2, (y - this.cy) * this.z + this.h / 2]; }
  toWorld(x, y) { return [(x - this.w / 2) / this.z + this.cx, (y - this.h / 2) / this.z + this.cy]; }
  centerOn(x, y) { this.cx = x; this.cy = y; }
  pick(e) {
    const r = this.c.getBoundingClientRect(); const [wx, wy] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
    let best = null, bd = 26 / this.z;
    for (const v of this.sim.vehicles) { const d = Math.hypot(v.x - wx, v.y - wy); if (d < bd) { bd = d; best = v; } }
    if (best) return this.onPick({ vid: best.id });
    const zid = wy >= RIVER_Y ? 'Z3' : (wx < OX + 3.5 * SX ? 'Z1' : 'Z2');
    this.onPick({ zone: zid });
  }
  draw(now) {
    const { ctx, sim } = this; const z = this.z;
    if (this.follow && this.sel) { const v = sim.veh(this.sel); if (v) { this.cx += (v.x - this.cx) * 0.15; this.cy += (v.y - this.cy) * 0.15; } }
    ctx.fillStyle = col('--map-bg'); ctx.fillRect(0, 0, this.w, this.h);
    ctx.save(); ctx.translate(this.w / 2, this.h / 2); ctx.scale(z, z); ctx.translate(-this.cx, -this.cy);
    // city blocks
    ctx.fillStyle = col('--map-block');
    for (let j = 0; j < ROWS - 1; j++) for (let i = 0; i < COLS - 1; i++) {
      if (j === 3) continue;
      const x = OX + i * SX + 16, y = OY + j * SY + 16;
      const park = (i === 5 && j === 1) || (i === 1 && j === 4);
      ctx.fillStyle = park ? col('--map-park') : col('--map-block');
      rr(ctx, x, y, SX - 32, SY - 32, 10); ctx.fill();
    }
    // river
    ctx.fillStyle = col('--map-river'); ctx.fillRect(-200, RIVER_Y - 52, WORLD.w + 400, 104);
    // zones
    if (this.layers.zones) for (const zn of sim.zones) {
      const [x0, y0, x1, y1] = zn.rect;
      const c = zn.odd === 'SUSPENDED' ? col('--crit') : zn.odd === 'RESTRICTED' ? col('--warn') : col('--accent');
      ctx.save(); ctx.globalAlpha = zn.odd === 'NORMAL' ? 0.05 : 0.14; ctx.fillStyle = c; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.globalAlpha = zn.odd === 'NORMAL' ? 0.35 : 0.9; ctx.strokeStyle = c; ctx.lineWidth = 3 / z; ctx.setLineDash(zn.odd === 'NORMAL' ? [14 / z, 10 / z] : []);
      ctx.strokeRect(x0 + 4, y0 + 4, x1 - x0 - 8, y1 - y0 - 8); ctx.restore();
      if (zn.rain > 5) this.rain(ctx, zn, now);
    }
    // roads
    ctx.lineCap = 'round';
    ctx.strokeStyle = col('--map-road'); ctx.lineWidth = 22;
    ctx.beginPath(); for (const e of edges) { const a = node(e.a), b = node(e.b); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } ctx.stroke();
    ctx.strokeStyle = col('--map-mark'); ctx.lineWidth = 1.5; ctx.setLineDash([10, 12]);
    ctx.beginPath(); for (const e of edges) { const a = node(e.a), b = node(e.b); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } ctx.stroke(); ctx.setLineDash([]);
    // blocked edges
    for (const [k] of sim.blocked) {
      const [a, b] = k.split('|').map(node); const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      ctx.strokeStyle = col('--crit'); ctx.lineWidth = 6; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(mx - 10, my - 10); ctx.lineTo(mx + 10, my + 10); ctx.moveTo(mx + 10, my - 10); ctx.lineTo(mx - 10, my + 10); ctx.stroke();
    }
    // outages / avoided nodes
    for (const [nid] of sim.outages) {
      const n = node(nid), p = 0.5 + 0.5 * Math.sin(now / 200);
      ctx.strokeStyle = col('--warn'); ctx.lineWidth = 3 + p * 3; ctx.beginPath(); ctx.arc(n.x, n.y, 26 + p * 6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = col('--warn'); ctx.font = 'bold 18px system-ui'; ctx.textAlign = 'center'; ctx.fillText('⚠', n.x, n.y + 6);
    }
    for (const nid of sim.avoid) { const n = node(nid); ctx.strokeStyle = col('--crit'); ctx.setLineDash([6, 6]); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(n.x, n.y, 38, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    // stops & hub
    ctx.textAlign = 'center';
    for (const s of STOPS) {
      const n = node(s.node);
      ctx.fillStyle = col('--panel'); ctx.strokeStyle = col('--info'); ctx.lineWidth = 3; rr(ctx, n.x - 9, n.y - 9, 18, 18, 4); ctx.fill(); ctx.stroke();
      if (this.layers.labels && z > 0.33) { ctx.fillStyle = col('--muted'); ctx.font = `${Math.max(11, 12 / z * 0.9)}px system-ui`; ctx.fillText(s.name[getLang()], n.x, n.y + 32 / Math.max(z, 0.6)); }
    }
    { const n = node(HUB.node); ctx.fillStyle = col('--info'); rr(ctx, n.x - 18, n.y - 18, 36, 36, 6); ctx.fill(); ctx.fillStyle = col('--bg'); ctx.font = 'bold 20px system-ui'; ctx.fillText('H', n.x, n.y + 7);
      if (this.layers.labels) { ctx.fillStyle = col('--muted'); ctx.font = `${Math.max(11, 12 / z * 0.9)}px system-ui`; ctx.fillText(HUB.name[getLang()], n.x, n.y + 44); } }
    // zone labels
    if (this.layers.zones) for (const zn of sim.zones) {
      const [x0, y0] = zn.rect; ctx.textAlign = 'left'; ctx.font = `bold ${13 / z}px system-ui`;
      ctx.fillStyle = zn.odd === 'SUSPENDED' ? col('--crit') : zn.odd === 'RESTRICTED' ? col('--warn') : col('--muted');
      ctx.fillText(`${zn.id} ${zn.name[getLang()]} · ${t('odd_' + zn.odd)}${zn.rain > 5 ? ` · ☂ ${Math.round(zn.rain)}mm/h` : ''}`, x0 + 14 / z + 6, y0 + 22 / z + 4);
    }
    // selected route
    const selV = this.sel ? sim.veh(this.sel) : null;
    if (selV && this.layers.routes && selV.seg < selV.path.length - 1) {
      ctx.strokeStyle = col('--accent'); ctx.lineWidth = 6; ctx.globalAlpha = 0.85; ctx.setLineDash([16, 10]);
      ctx.beginPath(); ctx.moveTo(selV.x, selV.y);
      for (let k = selV.seg + 1; k < selV.path.length; k++) { const n = node(selV.path[k]); ctx.lineTo(n.x, n.y); }
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      const end = node(selV.path[selV.path.length - 1]);
      ctx.fillStyle = col('--accent'); ctx.beginPath(); ctx.moveTo(end.x, end.y); ctx.lineTo(end.x, end.y - 40); ctx.lineTo(end.x + 24, end.y - 32); ctx.lineTo(end.x, end.y - 24); ctx.fill();
    }
    // crews
    for (const cr of sim.crews) {
      const v = sim.veh(cr.vid);
      ctx.strokeStyle = col('--violet'); ctx.setLineDash([4, 6]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cr.x, cr.y); ctx.lineTo(v.x, v.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = col('--violet'); ctx.save(); ctx.translate(cr.x, cr.y); ctx.rotate(Math.PI / 4); ctx.fillRect(-9, -9, 18, 18); ctx.restore();
      ctx.fillStyle = col('--ink'); ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(cr.id, cr.x, cr.y - 16);
    }
    // incidents halo
    for (const inc of sim.incidents) {
      if (inc.status === 'RESOLVED' || inc.x == null) continue;
      const p = (now / (inc.prio === 1 ? 500 : 900)) % 1;
      ctx.strokeStyle = inc.prio === 1 ? col('--crit') : inc.prio === 2 ? col('--warn') : col('--info');
      ctx.globalAlpha = (1 - p) * (inc.ack ? 0.5 : 1); ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(inc.x, inc.y, 20 + p * 46, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // vehicles
    for (const v of sim.vehicles) this.vehicle(ctx, v, v.id === this.sel, now);
    ctx.restore();
    // scale bar
    const m = 200, px = m * z; ctx.fillStyle = col('--muted'); ctx.fillRect(14, this.h - 18, px, 3); ctx.font = '11px system-ui'; ctx.textAlign = 'left'; ctx.fillText('200 m', 14, this.h - 24);
  }
  rain(ctx, zn, now) {
    const [x0, y0, x1, y1] = zn.rect; ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    ctx.strokeStyle = col('--info'); ctx.globalAlpha = Math.min(0.45, zn.rain / 90); ctx.lineWidth = 1.5;
    const off = (now / 6) % 60; ctx.beginPath();
    for (let x = x0 - 200; x < x1; x += 34) for (let y = y0 - 60; y < y1; y += 60) { const yy = y + off + ((x * 7) % 60); ctx.moveTo(x + yy * 0.3, yy); ctx.lineTo(x + yy * 0.3 + 6, yy + 18); }
    ctx.stroke(); ctx.restore();
  }
  vehicle(ctx, v, sel, now) {
    const c = col(MODE_COLOR[v.mode] || '--muted'); const z = this.z;
    const s = (v.type === 'SH' ? 15 : 12) / Math.max(0.55, Math.min(1.3, z));
    ctx.save(); ctx.translate(v.x, v.y);
    if (sel) { ctx.strokeStyle = col('--ink'); ctx.lineWidth = 3 / z; ctx.beginPath(); ctx.arc(0, 0, s * 2.1, 0, Math.PI * 2); ctx.stroke(); }
    if (this.layers.net) { const r = v.net.rtt; ctx.fillStyle = r > 1000 ? col('--crit') : r > RTT_ASSIST_MAX ? col('--warn') : col('--ok'); ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(0, 0, s * 2.8, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.rotate(v.hd);
    const blink = (v.hazard && Math.floor(now / 350) % 2 === 0);
    ctx.fillStyle = c; ctx.strokeStyle = blink ? col('--warn') : col('--bg'); ctx.lineWidth = blink ? 4 / z : 2 / z;
    if (v.type === 'SH') { rr(ctx, -s * 1.3, -s * 0.75, s * 2.6, s * 1.5, s * 0.35); ctx.fill(); ctx.stroke(); ctx.fillStyle = col('--bg'); ctx.fillRect(s * 0.75, -s * 0.5, s * 0.35, s); }
    else { ctx.beginPath(); ctx.moveTo(s * 1.3, 0); ctx.lineTo(-s, s * 0.85); ctx.lineTo(-s * 0.55, 0); ctx.lineTo(-s, -s * 0.85); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.restore();
    if (this.layers.labels || sel) {
      ctx.font = `bold ${Math.max(11, 11 / z * 0.8)}px ui-monospace, monospace`; ctx.textAlign = 'center';
      const label = v.id + (v.pax ? ` 👤${v.pax}` : '');
      const w = ctx.measureText(label).width + 8, y = v.y - s * 1.9 - 4;
      ctx.fillStyle = col('--panel'); ctx.globalAlpha = 0.85; rr(ctx, v.x - w / 2, y - 12, w, 16, 4); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = col('--ink'); ctx.fillText(label, v.x, y);
    }
  }
}

// ---------------- camera feeds ----------------
const noiseCache = {};
function noise(ctx, w, h, seed) {
  const key = w + 'x' + h + ':' + (seed % 4);
  if (!noiseCache[key]) {
    const c = document.createElement('canvas'); c.width = Math.max(1, w >> 1); c.height = Math.max(1, h >> 1); const x = c.getContext('2d');
    const img = x.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) { const g = Math.random() * 120; img.data[i] = img.data[i + 1] = img.data[i + 2] = g; img.data[i + 3] = 255; }
    x.putImageData(img, 0, 0); noiseCache[key] = c;
  }
  ctx.imageSmoothingEnabled = false; ctx.drawImage(noiseCache[key], 0, 0, w, h);
}

export function drawCam(ctx, w, h, view, v, sim, now, small = false) {
  ctx.save();
  const lost = sim.linkLost(v);
  if (lost) {
    noise(ctx, w, h, Math.floor(now / 80));
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, h / 2 - 22, w, 44);
    ctx.fillStyle = '#ff6b6b'; ctx.font = `bold ${small ? 11 : 16}px system-ui`; ctx.textAlign = 'center';
    ctx.fillText(getLang() === 'ja' ? '映像途絶 — NO SIGNAL' : 'NO SIGNAL', w / 2, h / 2 + 6);
    overlay(ctx, w, h, view, v, sim, small); ctx.restore(); return;
  }
  // latency stutter: frames only refresh every RTT
  const frameT = v.net.rtt > RTT_ASSIST_MAX ? Math.floor(now / v.net.rtt) * v.net.rtt : now;
  if (view === 'cabin') cabin(ctx, w, h, v, sim, frameT);
  else if (view === 'bev') bev(ctx, w, h, v, sim, frameT);
  else road(ctx, w, h, view, v, sim, frameT);
  overlay(ctx, w, h, view, v, sim, small);
  ctx.restore();
}

function overlay(ctx, w, h, view, v, sim, small) {
  const fs = small ? 10 : 12;
  ctx.font = `600 ${fs}px ui-monospace, monospace`; ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, w, fs + 8);
  ctx.fillStyle = '#e8f1f2'; ctx.fillText(`${v.id} · ${t('cam_' + view)}`, 6, fs + 2);
  if (!small) {
    const clk = sim.clock(); const ts = clk.toLocaleTimeString('ja-JP', { hour12: false, timeZone: 'Asia/Tokyo' }) + '.' + String(Math.floor(clk.getMilliseconds() / 100));
    ctx.textAlign = 'right'; ctx.fillText(`${ts} JST`, w - 6, fs + 2);
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, h - fs - 8, w, fs + 8);
    ctx.textAlign = 'left'; ctx.fillStyle = '#e8f1f2'; ctx.fillText(`${(v.v * 3.6).toFixed(0)} km/h  ·  ${t('m_' + v.mode)}`, 6, h - 5);
    const r = Math.round(v.net.rtt); ctx.textAlign = 'right';
    ctx.fillStyle = r > 1000 ? '#ff6b6b' : r > RTT_ASSIST_MAX ? '#ffc65c' : '#7ee0a1';
    ctx.fillText(`${getLang() === 'ja' ? '映像遅延' : 'latency'} ${r}ms · ${v.net.bw.toFixed(0)}Mbps · ${v.net.carrier}`, w - 6, h - 5);
    ctx.fillStyle = '#ff5050'; ctx.beginPath(); ctx.arc(w - 10, fs + 14, 4, 0, Math.PI * 2); if (Math.floor(Date.now() / 600) % 2) ctx.fill();
  }
}

function road(ctx, w, h, view, v, sim, now) {
  const zn = sim.zone(sim.zoneOf(v)); const rain = zn.rain;
  const hz = h * 0.42;
  const sky = ctx.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, rain > 20 ? '#59646b' : '#7fa9c9'); sky.addColorStop(1, rain > 20 ? '#8b959b' : '#cfe0ea');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, hz);
  ctx.fillStyle = rain > 20 ? '#3d4446' : '#59625f'; ctx.fillRect(0, hz, w, h - hz);
  const back = view === 'rear';
  if (view === 'left' || view === 'right') { side(ctx, w, h, view, v, now, rain); return; }
  const odo = back ? -v.odo : v.odo;
  // buildings
  for (let k = 0; k < 7; k++) {
    const d = ((k * 37 - odo * 0.6) % 259 + 259) % 259 / 259; const s = 1 - d;
    const bx = w / 2 + (k % 2 ? 1 : -1) * (w * 0.18 + s * w * 0.55), bh = 30 + s * h * 0.5, bw = 20 + s * w * 0.22;
    ctx.fillStyle = k % 3 ? '#8a8f94' : '#a2a39c'; ctx.globalAlpha = 0.55 + s * 0.4;
    ctx.fillRect(bx - bw / 2, hz - bh * 0.6, bw, bh * 0.6 + 2); ctx.globalAlpha = 1;
  }
  // road
  ctx.fillStyle = rain > 20 ? '#2b3033' : '#3a3f42';
  ctx.beginPath(); ctx.moveTo(w * 0.47, hz); ctx.lineTo(w * 0.53, hz); ctx.lineTo(w * 1.05, h); ctx.lineTo(-w * 0.05, h); ctx.closePath(); ctx.fill();
  // lane lines moving
  ctx.strokeStyle = '#e6e6d8'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(w * 0.47, hz); ctx.lineTo(-w * 0.05, h); ctx.moveTo(w * 0.53, hz); ctx.lineTo(w * 1.05, h); ctx.stroke();
  const off = ((odo % 12) + 12) % 12 / 12;
  ctx.fillStyle = '#f2d36b';
  for (let k = 0; k < 9; k++) {
    const d0 = (k + off) / 9, d1 = (k + off + 0.45) / 9;
    const y0 = hz + (h - hz) * d0 * d0, y1 = hz + (h - hz) * d1 * d1;
    const wd0 = 1 + d0 * 4, wd1 = 1 + d1 * 4;
    ctx.beginPath(); ctx.moveTo(w / 2 - wd0, y0); ctx.lineTo(w / 2 + wd0, y0); ctx.lineTo(w / 2 + wd1, y1); ctx.lineTo(w / 2 - wd1, y1); ctx.fill();
  }
  const incs = sim.openIncs(v).map(i => i.type);
  const atSignal = incs.includes('signal');
  if (!back) {
    if (atSignal || v.path.some((n, k) => k > v.seg && sim.outages.has(n) && sim.distToNode(v, n) < 60)) {
      ctx.fillStyle = '#ddd'; for (let k = 0; k < 8; k++) ctx.fillRect(w * 0.2 + k * w * 0.08, hz + (h - hz) * 0.28, w * 0.05, 5);
      ctx.fillStyle = '#222'; ctx.fillRect(w * 0.72, hz - 70, 10, 70); ctx.fillRect(w * 0.68, hz - 82, 44, 16);
      ctx.fillStyle = '#444'; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(w * 0.68 + 8 + k * 14, hz - 74, 5, 0, Math.PI * 2); ctx.fill(); }
      label(ctx, w * 0.68, hz - 90, getLang() === 'ja' ? '信号 滅灯' : 'SIGNAL DARK', '#ffc65c');
    }
    if (incs.includes('obstacle')) {
      const i = sim.openIncs(v).find(x => x.type === 'obstacle'); const near = v.mode === 'REMOTE_GUIDED' ? 0.05 : 0;
      const y = hz + (h - hz) * (0.35 + near), bw = w * 0.22, bh = h * 0.2;
      const bx = w * 0.5 - bw * 0.2 - near * w * 3;
      ctx.fillStyle = i.data.obj === 'debris' ? '#7a5b3a' : i.data.obj === 'parked_car' ? '#c7c9cc' : '#e8e8e8';
      if (i.data.obj === 'debris') { ctx.beginPath(); ctx.ellipse(w * 0.48, y + bh * 0.6, bw * 0.3, bh * 0.2, 0, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.fillRect(bx, y - bh * 0.4, bw, bh); ctx.fillStyle = '#c33'; ctx.fillRect(bx + 6, y + bh * 0.35, 10, 6); ctx.fillRect(bx + bw - 16, y + bh * 0.35, 10, 6);
        if (Math.floor(now / 400) % 2) { ctx.fillStyle = '#ffb000'; ctx.fillRect(bx + 4, y + bh * 0.3, 14, 4); ctx.fillRect(bx + bw - 18, y + bh * 0.3, 14, 4); } }
      if (v.mode === 'REMOTE_GUIDED') { ctx.strokeStyle = '#4fd1c5'; ctx.lineWidth = 4; ctx.setLineDash([10, 8]); ctx.beginPath(); ctx.moveTo(w * 0.5, h); ctx.quadraticCurveTo(w * 0.85, hz + (h - hz) * 0.5, w * 0.58, hz + 10); ctx.stroke(); ctx.setLineDash([]); }
      label(ctx, bx, y - bh * 0.5, `${t('obj_' + i.data.obj)} · 18m`, '#ffc65c');
    }
    if (incs.includes('pedestrian')) {
      const x = w * (0.62 + Math.sin(now / 1500) * 0.03), y = hz + (h - hz) * 0.42;
      ctx.fillStyle = '#ddd'; for (let k = 0; k < 8; k++) ctx.fillRect(w * 0.18 + k * w * 0.085, y + 26, w * 0.05, 6);
      person(ctx, x, y, h * 0.16, '#e76f51'); person(ctx, x + 24, y + 4, h * 0.14, '#2a9d8f');
      label(ctx, x - 20, y - h * 0.12, getLang() === 'ja' ? '歩行者 ×2 · 意図不明' : 'PED ×2 · intent unclear', '#ffc65c');
    }
    if (incs.includes('collision')) {
      const x = w * 0.45, y = hz + (h - hz) * 0.62;
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.arc(x + 46, y, 16, 0, Math.PI * 2); ctx.moveTo(x, y); ctx.lineTo(x + 22, y - 18); ctx.lineTo(x + 46, y); ctx.stroke();
      label(ctx, x - 10, y - 36, getLang() === 'ja' ? '自転車（転倒）· 4m' : 'Bicycle (fallen) · 4 m', '#ff6b6b');
    }
    if (!incs.length && v.v > 2 && (v.id.charCodeAt(4) + Math.floor(v.odo / 300)) % 3 === 0) {
      const y = hz + (h - hz) * 0.28; ctx.fillStyle = '#5577aa'; ctx.fillRect(w * 0.45, y - 12, w * 0.1, 22); ctx.fillStyle = '#c33'; ctx.fillRect(w * 0.455, y + 4, 6, 4); ctx.fillRect(w * 0.535, y + 4, 6, 4);
    }
  } else if (incs.includes('ev') && v.evT > 0) {
    const s = 1 - v.evT / 14, y = hz + (h - hz) * (0.25 + s * 0.4), bw = w * (0.1 + s * 0.25);
    ctx.fillStyle = '#f4f4f4'; ctx.fillRect(w * 0.55 - bw / 2 + s * w * 0.15, y - bw * 0.4, bw, bw * 0.7);
    ctx.fillStyle = Math.floor(now / 150) % 2 ? '#ff2a2a' : '#ff9a9a'; ctx.fillRect(w * 0.55 - bw / 3 + s * w * 0.15, y - bw * 0.48, bw * 0.66, bw * 0.1);
    label(ctx, w * 0.45, y - bw * 0.6, getLang() === 'ja' ? '救急車 · 接近中' : 'Ambulance · approaching', '#ff6b6b');
  }
  if (rain > 15) {
    ctx.strokeStyle = 'rgba(220,230,240,.45)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let k = 0; k < rain * 2; k++) { const x = (k * 97 + now / 3) % w, y = (k * 53 + now / 1.2) % h; ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 12); }
    ctx.stroke();
  }
  if (v.sensors.lidar === 'DEGRADED' && !back) {
    ctx.fillStyle = 'rgba(120,100,70,.18)'; for (let k = 0; k < 12; k++) { ctx.beginPath(); ctx.arc((k * 131) % w, (k * 71) % h, 8 + (k % 4) * 6, 0, Math.PI * 2); ctx.fill(); }
  }
}
function side(ctx, w, h, view, v, now, rain) {
  const hz = h * 0.42, dir = view === 'left' ? 1 : -1, off = (v.odo * 6 * dir) % 200;
  ctx.fillStyle = '#9aa0a3'; ctx.fillRect(0, hz + (h - hz) * 0.25, w, (h - hz) * 0.3);
  for (let k = -1; k < w / 120 + 2; k++) {
    const x = k * 120 + ((off % 120) + 120) % 120 - 60;
    ctx.fillStyle = k % 2 ? '#7d8288' : '#8f8a80'; ctx.fillRect(x, hz - 90 + (k % 3) * 15, 100, 90 - (k % 3) * 15 + (h - hz) * 0.25);
    ctx.fillStyle = '#c9d5dc'; for (let r = 0; r < 3; r++) ctx.fillRect(x + 12 + r * 28, hz - 70 + (k % 3) * 15, 16, 14);
    ctx.fillStyle = '#555'; ctx.fillRect(x + 110, hz - 40, 4, (h - hz) * 0.5 + 40);
  }
  ctx.fillStyle = '#3a3f42'; ctx.fillRect(0, hz + (h - hz) * 0.55, w, h);
  if (rain > 15) { ctx.strokeStyle = 'rgba(220,230,240,.4)'; ctx.beginPath(); for (let k = 0; k < rain; k++) { const x = (k * 97 + now / 3) % w, y = (k * 53 + now) % h; ctx.moveTo(x, y); ctx.lineTo(x - 2, y + 10); } ctx.stroke(); }
}
function person(ctx, x, y, s, c) {
  ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y - s * 0.75, s * 0.13, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(x - s * 0.12, y - s * 0.6, s * 0.24, s * 0.4); ctx.fillRect(x - s * 0.1, y - s * 0.2, s * 0.08, s * 0.35); ctx.fillRect(x + s * 0.02, y - s * 0.2, s * 0.08, s * 0.35);
}
function label(ctx, x, y, s, c) {
  ctx.font = '600 12px system-ui'; const w = ctx.measureText(s).width + 10;
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x, y - 15, w, 19); ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.strokeRect(x, y - 15, w, 19);
  ctx.fillStyle = c; ctx.textAlign = 'left'; ctx.fillText(s, x + 5, y);
}
function cabin(ctx, w, h, v, sim, now) {
  ctx.fillStyle = '#2b2f36'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#3a404a'; ctx.beginPath(); ctx.moveTo(w * 0.15, 0); ctx.lineTo(w * 0.85, 0); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
  const rows = v.type === 'SH' ? 3 : 2, cols = v.type === 'SH' ? 4 : 2;
  const seats = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) seats.push({ x: w * (0.2 + c * (0.6 / (cols - 1 || 1))), y: h * (0.3 + r * (0.5 / (rows - 1 || 1))), s: 0.7 + r * 0.25 });
  const incs = sim.openIncs(v); const sos = incs.find(i => i.type === 'sos'); const door = incs.find(i => i.type === 'door'); const wc = incs.find(i => i.type === 'wheelchair');
  seats.forEach((p, k) => {
    ctx.fillStyle = '#4c5563'; rr(ctx, p.x - 26 * p.s, p.y - 10 * p.s, 52 * p.s, 50 * p.s, 8); ctx.fill();
    if (k < v.pax) {
      const slump = sos && sos.data.subtype === 'medical' && k === 0;
      ctx.save(); ctx.translate(p.x, p.y); if (slump) ctx.rotate(0.6);
      ctx.fillStyle = ['#e9c46a', '#8ab17d', '#e76f51', '#9d8df1'][k % 4];
      ctx.beginPath(); ctx.arc(0, -18 * p.s, 11 * p.s, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(-14 * p.s, -6 * p.s, 28 * p.s, 30 * p.s); ctx.restore();
      if (slump) { ctx.strokeStyle = '#ff5050'; ctx.lineWidth = 2; ctx.strokeRect(p.x - 36 * p.s, p.y - 40 * p.s, 72 * p.s, 84 * p.s); label(ctx, p.x - 36 * p.s, p.y - 44 * p.s, getLang() === 'ja' ? '姿勢異常検知 92%' : 'Posture anomaly 92%', '#ff6b6b'); }
    }
  });
  if (door) { ctx.strokeStyle = Math.floor(now / 300) % 2 ? '#ffc65c' : '#a07a2a'; ctx.lineWidth = 4; ctx.strokeRect(w * 0.86, h * 0.2, w * 0.12, h * 0.7); label(ctx, w * 0.6, h * 0.18, getLang() === 'ja' ? 'ドア 閉扉異常' : 'Door fault', '#ffc65c'); }
  if (wc) { ctx.strokeStyle = '#4fd1c5'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(w * 0.5, h * 0.8, 20, 0, Math.PI * 2); ctx.stroke(); label(ctx, w * 0.4, h * 0.68, v.ramp && v.ramp.done ? (getLang() === 'ja' ? '車椅子 固定済' : 'Wheelchair secured') : (getLang() === 'ja' ? '車椅子 乗車待ち' : 'Wheelchair waiting'), '#4fd1c5'); }
  if (v.call) { label(ctx, 8, h - 30, getLang() === 'ja' ? `🎙 通話中 ${Math.round(sim.t - v.call.start)}s` : `🎙 On call ${Math.round(sim.t - v.call.start)}s`, '#7ee0a1'); }
  ctx.fillStyle = 'rgba(255,255,255,.04)'; for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
}
function bev(ctx, w, h, v, sim, now) {
  ctx.fillStyle = '#0b1418'; ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.6, sc = Math.min(w, h) / 70; // px per metre
  ctx.strokeStyle = 'rgba(80,200,200,.15)'; ctx.lineWidth = 1;
  for (let r = 10; r <= 40; r += 10) { ctx.beginPath(); ctx.arc(cx, cy, r * sc, 0, Math.PI * 2); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(200,200,200,.4)'; ctx.setLineDash([6, 6]);
  ctx.beginPath(); ctx.moveTo(cx - 3.5 * sc, 0); ctx.lineTo(cx - 3.5 * sc, h); ctx.moveTo(cx + 3.5 * sc, 0); ctx.lineTo(cx + 3.5 * sc, h); ctx.moveTo(cx + 10.5 * sc, 0); ctx.lineTo(cx + 10.5 * sc, h); ctx.stroke(); ctx.setLineDash([]);
  const deg = v.sensors.lidar === 'DEGRADED';
  const n = deg ? 380 : 900; let seed = Math.floor(now / 100) * 7 + 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < n; k++) {
    const a = rnd() * Math.PI * 2, r = 4 + rnd() * 34;
    if (deg && a > -2.2 && a < -0.9) continue;
    const x = cx + Math.cos(a) * r * sc, y = cy + Math.sin(a) * r * sc;
    const edge = Math.abs(Math.cos(a) * r) > 9 && Math.abs(Math.cos(a) * r) < 12;
    ctx.fillStyle = edge ? 'rgba(120,230,255,.9)' : 'rgba(90,170,200,.35)'; ctx.fillRect(x, y, 1.6, 1.6);
  }
  if (deg) { ctx.fillStyle = 'rgba(255,80,80,.12)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, 40 * sc, -2.2, -0.9); ctx.fill(); label(ctx, cx - 60, cy - 30 * sc, getLang() === 'ja' ? '低信頼領域' : 'Low-confidence sector', '#ff6b6b'); }
  // ego
  ctx.fillStyle = '#4fd1c5'; rr(ctx, cx - 1.0 * sc, cy - 2.3 * sc, 2 * sc, 4.6 * sc, 3); ctx.fill();
  const box = (dx, dy, bw, bl, c, txt) => { ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.strokeRect(cx + (dx - bw / 2) * sc, cy - (dy + bl / 2) * sc, bw * sc, bl * sc); ctx.fillStyle = c; ctx.font = '600 11px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.fillText(txt, cx + (dx + bw / 2) * sc + 4, cy - dy * sc); };
  const incs = sim.openIncs(v).map(i => i.type);
  if (incs.includes('obstacle')) box(0.4, 18, 2.4, 7, '#ffc65c', 'TRUCK 18.2m  v=0');
  if (incs.includes('pedestrian')) { box(5, 9, 0.8, 0.8, '#ffc65c', 'PED 10m'); box(6.2, 9.4, 0.8, 0.8, '#ffc65c', 'PED'); }
  if (incs.includes('collision')) box(-0.6, 4, 0.8, 1.8, '#ff6b6b', 'BICYCLE 4.1m');
  if (incs.includes('ev') && v.evT > 0) box(7, -12 + (14 - v.evT) * 1.5, 2.2, 6, '#ff6b6b', 'EMERGENCY');
  const o1 = ((v.odo * 0.7) % 60) - 30; box(7, -o1, 2, 4.5, 'rgba(160,220,255,.8)', 'CAR');
  if (v.v > 1) box(0, 25 - ((v.odo * 0.2) % 8), 2, 4.5, 'rgba(160,220,255,.8)', `CAR ${(25 - ((v.odo * 0.2) % 8)).toFixed(0)}m`);
  ctx.fillStyle = '#9fb3b8'; ctx.font = '11px ui-monospace, monospace'; ctx.textAlign = 'left';
  ctx.fillText(`LOC ${(v.loc * 100).toFixed(1)}%  ·  LiDAR ${v.sensors.lidar}  ·  ${getLang() === 'ja' ? '点群' : 'pts'} ${n * 64}`, 8, 34);
}
