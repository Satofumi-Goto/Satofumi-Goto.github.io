// World model: synthetic city road graph, ODD zones, stops and routing.
// Synthetic geometry only — not a real road network.

export const COLS = 9, ROWS = 6, SX = 260, SY = 230, OX = 130, OY = 110;
export const WORLD = { w: OX * 2 + (COLS - 1) * SX, h: OY * 2 + (ROWS - 1) * SY };
export const RIVER_Y = OY + 3 * SY + SY / 2;           // river between row 3 and row 4
export const BRIDGES = [1, 4, 7];                      // columns with bridges
const REMOVED = new Set(['h:2-4', 'v:6-0', 'h:5-5', 'v:2-1']);

export const nodes = [];
export const nodeById = new Map();
for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
  const n = { id: `${i}-${j}`, i, j, x: OX + i * SX, y: OY + j * SY, adj: [] };
  nodes.push(n); nodeById.set(n.id, n);
}
export const edges = [];
function link(a, b, kind) {
  const len = Math.hypot(a.x - b.x, a.y - b.y);
  const e = { a: a.id, b: b.id, len, kind, bridge: kind === 'v' && a.j === 3 };
  edges.push(e); a.adj.push({ to: b.id, len }); b.adj.push({ to: a.id, len });
}
for (const n of nodes) {
  if (n.i < COLS - 1 && !REMOVED.has(`h:${n.i}-${n.j}`)) link(n, nodeById.get(`${n.i + 1}-${n.j}`), 'h');
  if (n.j < ROWS - 1 && !REMOVED.has(`v:${n.i}-${n.j}`)) {
    if (n.j === 3 && !BRIDGES.includes(n.i)) continue;
    link(n, nodeById.get(`${n.i}-${n.j + 1}`), 'v');
  }
}
export const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const node = id => nodeById.get(id);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ODD zones. Polygons are axis-aligned rectangles in world coordinates.
const midX = OX + 3.5 * SX;
export const ZONES = [
  { id: 'Z1', name: { ja: '駅前・中心市街地', en: 'Central Station Area' }, rect: [0, 0, midX, RIVER_Y], speedLimit: 11.1 },
  { id: 'Z2', name: { ja: '医療・学術地区', en: 'Medical & Campus District' }, rect: [midX, 0, WORLD.w, RIVER_Y], speedLimit: 11.1 },
  { id: 'Z3', name: { ja: '臨海住宅地区', en: 'Bayside Residential' }, rect: [0, RIVER_Y, WORLD.w, WORLD.h], speedLimit: 8.3 },
];
export function zoneAt(x, y) {
  if (y >= RIVER_Y) return 'Z3';
  return x < midX ? 'Z1' : 'Z2';
}

export const STOPS = [
  { node: '1-1', name: { ja: '中央駅東口', en: 'Central Sta. East' } },
  { node: '3-0', name: { ja: '市役所前', en: 'City Hall' } },
  { node: '5-1', name: { ja: '中央公園', en: 'Central Park' } },
  { node: '7-0', name: { ja: '総合病院', en: 'General Hospital' }, hospital: true },
  { node: '8-2', name: { ja: '大学北門', en: 'University N Gate' } },
  { node: '2-3', name: { ja: '商店街', en: 'Shopping Arcade' } },
  { node: '4-2', name: { ja: '文化会館', en: 'Culture Hall' } },
  { node: '6-3', name: { ja: 'オフィス街', en: 'Business District' } },
  { node: '0-3', name: { ja: '西団地', en: 'West Housing' } },
  { node: '1-5', name: { ja: '臨海公園', en: 'Bayside Park' } },
  { node: '4-4', name: { ja: 'みなと住宅', en: 'Minato Residences' } },
  { node: '6-5', name: { ja: 'フェリー乗り場', en: 'Ferry Terminal' } },
  { node: '3-5', name: { ja: '小学校前', en: 'Elementary School' } },
];
export const stopByNode = new Map(STOPS.map(s => [s.node, s]));
export const HUB = { node: '8-5', name: { ja: 'サービスハブ（充電・整備）', en: 'Service Hub (charge & maintenance)' } };
export const HOSPITAL = STOPS.find(s => s.hospital);

// Shuttle loop lines.
export const LINES = [
  { id: 'L1', name: { ja: '循環線（北）', en: 'North Loop' }, stops: ['1-1', '3-0', '5-1', '7-0', '8-2', '6-3', '4-2', '2-3'] },
  { id: 'L2', name: { ja: '臨海線', en: 'Bayside Line' }, stops: ['1-1', '0-3', '1-5', '3-5', '4-4', '6-5', '4-4', '2-3'] },
];

// Dijkstra over the small graph. blocked: Set of edge keys; avoid: Set of node ids (except endpoints).
export function route(from, to, blocked = new Set(), avoid = new Set()) {
  if (from === to) return [from];
  const D = new Map([[from, 0]]), P = new Map(), done = new Set();
  const open = [from];
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (D.get(open[k]) < D.get(open[bi])) bi = k;
    const u = open.splice(bi, 1)[0];
    if (u === to) break;
    if (done.has(u)) continue;
    done.add(u);
    for (const { to: w, len } of nodeById.get(u).adj) {
      if (blocked.has(edgeKey(u, w))) continue;
      if (avoid.has(w) && w !== to) continue;
      const nd = D.get(u) + len;
      if (nd < (D.has(w) ? D.get(w) : Infinity)) { D.set(w, nd); P.set(w, u); open.push(w); }
    }
  }
  if (!P.has(to)) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(P.get(path[0]));
  return path;
}
export function pathLength(path) {
  let s = 0;
  for (let k = 0; k + 1 < path.length; k++) s += dist(node(path[k]), node(path[k + 1]));
  return s;
}
export function nearestNode(x, y) {
  let best = null, bd = Infinity;
  for (const n of nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n; } }
  return best;
}
