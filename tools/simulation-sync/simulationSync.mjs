// Simulator result propagation (numbers only).
// The simulator's results are the source of truth for calculated values. Each consumer
// (Federation, consoles, Seneschal, portfolio site) stores the values it currently shows in
// simulation-published-values.json. When a new result arrives, every changed value is
// rewritten in place as text: same decimals, same sign style, no other characters touched.
// Ambiguous rewrites (one old number mapping to two different new numbers) are refused.

export const SYNC_VERSION = 'simulation-sync-1.0.0';

const r = (x, dp) => Math.round(x * 10 ** dp) / 10 ** dp;

// Flatten a simulator result (as carried in the Federation numeric baseline) into
// published values: key -> { value, dp }.
export function publishedValues(simulationResult, financialAssessment) {
  const out = {};
  const put = (key, value, dp) => { if (value !== null && value !== undefined && Number.isFinite(value)) out[key] = { value: r(value, dp), dp }; };
  for (const year of ['2030', '2035']) {
    const p = simulationResult.pnl[year];
    for (const [k, v] of Object.entries(p.lines || {})) put(`pnl.${year}.${k}`, v, 3);
    // Costs are published as negative values (▲); the engine reports them as positive amounts.
    for (const k of ['revenue', 'ebitda', 'operatingProfit']) put(`pnl.${year}.${k}`, p[k], 3);
    for (const k of ['opex', 'sga', 'depreciation']) put(`pnl.${year}.${k}`, -p[k], 3);
    put(`pnl.${year}.ebitdaMargin`, p.ebitdaMargin, 1);
    put(`pnl.${year}.operatingMargin`, p.operatingMargin, 1);
    put(`hpc.${year}.revenue`, simulationResult.hpc[year].revenue, 3);
    put(`hpc.${year}.ebitda`, simulationResult.hpc[year].ebitda, 3);
  }
  for (const row of simulationResult.cashFlow) {
    for (const k of ['revenue', 'ebitda', 'fcf', 'dcf', 'cumulativeFcf', 'cumulativeDcf']) put(`cf.${row.year}.${k}`, row[k], 3);
    put(`cf.${row.year}.capex`, -row.capex, 3);
  }
  for (const row of simulationResult.paybackExtension || []) put(`cf.${row.year}.cumulativeFcf`, row.cumulativeFcf, 3);
  const s = simulationResult.sensitivity;
  for (const [k, v] of Object.entries(s)) {
    if (k === 'npvBreakEvenExtraEbitda') { put('sens.breakEven.extraEbitda', v.extraEbitdaPerYear2030to2035, 3); put('sens.breakEven.npvHurdle', v.npvHurdle, 3); continue; }
    put(`sens.${k}.irr`, v.irrPercent, 2); put(`sens.${k}.npv8`, v.npv8, 3); put(`sens.${k}.npvHurdle`, v.npvHurdle, 3);
  }
  // The same amounts are also shown in 億円 (1 B JPY = 10 億円, two decimals), e.g. +133.78億円.
  for (const [key, v] of Object.entries({ ...out })) {
    if (/^(pnl\.\d{4}\.(revenue|ebitda|operatingProfit|opex|sga|depreciation)|cf\.\d{4}\.(fcf|cumulativeFcf))$/.test(key)) put(key + '.oku', v.value * 10, 2);
  }
  const f = financialAssessment;
  put('project.irr', f.projectIRRPercent, 2); put('project.npv8', f.NPV8_BJPY, 3); put('project.npv12', f.NPV12_BJPY, 3);
  put('project.npv8.oku', f.NPV8_BJPY * 10, 2);
  put('project.totalCapex', f.totalCapex2025to2035_BJPY, 3);
  if (Number.isInteger(f.nominalPaybackYear)) out['project.paybackYear'] = { value: f.nominalPaybackYear, dp: 0 };
  return out;
}

// Integer values that may change, and the text that must follow them where they are rewritten.
const YEAR_KEYS = { 'project.paybackYear': ' (reference)' };
const fmt = (abs, dp) => abs.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp, useGrouping: false });

// Build the list of textual rewrites between two published-value sets.
export function rewritePlan(previous, next) {
  const plan = [], problems = [];
  for (const [key, n] of Object.entries(next)) {
    const p = previous[key];
    if (!p || p.value === n.value) continue;
    if (n.dp === 0) {
      // The payback year is the only integer that may change, and only where it is labelled as the reference year.
      if (YEAR_KEYS[key] && /^\d{4}$/.test(String(p.value)) && /^\d{4}$/.test(String(n.value))) {
        plan.push({ key, from: p.value, to: n.value, dp: 0, fromText: String(p.value), toText: String(n.value), after: YEAR_KEYS[key] });
        continue;
      }
      problems.push(`${key}: ${p.value} -> ${n.value} is a year/integer change; rewrite needs review`); continue;
    }
    plan.push({ key, from: p.value, to: n.value, dp: n.dp, fromText: fmt(Math.abs(p.value), n.dp), toText: fmt(Math.abs(n.value), n.dp) });
  }
  // A number shown both as a negative (▲, −, -) and as a positive value is told apart by its sign: such steps rewrite
  // only the occurrences with the matching sign. Same-sign collisions are still refused below.
  const signedOf = (v, dp) => `${v < 0 ? '-' : '+'}${fmt(Math.abs(v), dp)}`;
  const tokens = new Map();
  for (const [key, n] of Object.entries(next)) {
    if (n.dp === 0) continue;
    const p = previous[key] ?? n;
    const t = fmt(Math.abs(p.value), n.dp);
    if (!tokens.has(t)) tokens.set(t, new Set());
    tokens.get(t).add(p.value < 0 ? '-' : '+');
  }
  for (const step of plan) if (step.dp > 0 && tokens.get(step.fromText)?.size === 2) step.sign = step.from < 0 ? 'neg' : 'pos';
  // One old token may only map to one new value (compared by digits; sign style comes from the text).
  const byToken = new Map();
  const keyOf = (step) => (step.sign ? (step.sign === 'neg' ? '-' : '+') : '') + step.fromText + (step.after ? '|' + step.after : '');
  for (const step of plan) {
    const k = keyOf(step);
    const seen = byToken.get(k);
    if (seen && seen.to !== step.to) problems.push(`ambiguous: ${step.fromText} is ${seen.key} -> ${seen.to} and ${step.key} -> ${step.to}`);
    else byToken.set(k, step);
  }
  // A token that changes must not also be an unchanged value elsewhere.
  for (const [key, n] of Object.entries(next)) {
    const p = previous[key];
    if (!p || p.value !== n.value || n.dp === 0) continue;
    const t = fmt(Math.abs(n.value), n.dp);
    const strict = tokens.get(t)?.size === 2;
    const k = (strict ? (n.value < 0 ? '-' : '+') : '') + t;
    if (byToken.has(k)) problems.push(`ambiguous: ${t} changes for ${byToken.get(k).key} but stays for ${key}`);
  }
  // The cash-flow extension marks the first year whose cumulative FCF is non-negative with a
  // PAYBACK label. When that year's value turns negative the label goes with it; when a year
  // becomes the first non-negative one it gains the label.
  const cum = (set) => Object.entries(set).map(([k, v]) => [k.match(/^cf\.(\d{4})\.cumulativeFcf$/)?.[1], v.value]).filter(([y]) => y).sort();
  const firstPos = (set) => cum(set).find(([, v]) => v >= 0)?.[0];
  const oldYear = firstPos(previous), newYear = firstPos(next);
  for (const step of byToken.values()) {
    const y = step.key.match(/^cf\.(\d{4})\.cumulativeFcf$/)?.[1];
    if (!y || oldYear === newYear) continue;
    if (y === oldYear) step.dropAfter = PAYBACK_LABEL;
    if (y === newYear) step.addAfter = PAYBACK_LABEL;
  }
  return { steps: [...byToken.values()], problems };
}
const PAYBACK_LABEL = ' PAYBACK';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NEG = '▲−-';

// Apply a plan to one text. Returns { text, count, perStep, signReview }.
// The sign style found in the text is kept (▲, −, - or none). A value that changes sign
// drops or adds the sign character; where the text shows no sign at all the change is
// reported for review instead of guessed.
export function applyPlan(text, steps) {
  let out = text, count = 0; const perStep = {}, signReview = [];
  for (const step of steps) {
    const after = step.after ? `(?=${esc(step.after)})` : '';
    // A PAYBACK label follows the unit (¥28.812B PAYBACK); the unit is kept and the label dropped or added.
    const labelled = step.dropAfter || step.addAfter;
    const drop = labelled ? `(?:(B|%)?${step.dropAfter ? esc(step.dropAfter) : ''})?` : '';
    const re = new RegExp(`([${NEG}]?)(\\s?¥?)(?<![\\d.])${esc(step.fromText)}(?![\\d])(?!\\.\\d)${after}${drop}`, 'g');
    let n = 0;
    const flips = (step.from < 0) !== (step.to < 0);
    out = out.replace(re, (all, sign, mid, unitGroup) => {
      const add = labelled && typeof unitGroup === 'string' ? unitGroup + (step.addAfter ?? '') : '';
      // Sign-strict steps (the number is also shown with the other sign) skip occurrences of the other sign.
      if (step.sign === 'neg' && !sign) return all;
      if (step.sign === 'pos' && sign) return all;
      n += 1;
      if (!flips) return sign + mid + step.toText + add;
      if (sign) return mid.trimStart() + step.toText + add;
      if (step.to < 0 && mid.includes('¥')) return '▲' + mid.trimStart() + step.toText + add;
      signReview.push(step.key);
      return sign + mid + step.toText + add;
    });
    perStep[step.key] = n; count += n;
  }
  return { text: out, count, perStep, signReview };
}
