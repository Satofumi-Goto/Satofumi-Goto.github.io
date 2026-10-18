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
  const f = financialAssessment;
  put('project.irr', f.projectIRRPercent, 2); put('project.npv8', f.NPV8_BJPY, 3); put('project.npv12', f.NPV12_BJPY, 3);
  put('project.totalCapex', f.totalCapex2025to2035_BJPY, 3);
  if (Number.isInteger(f.nominalPaybackYear)) out['project.paybackYear'] = { value: f.nominalPaybackYear, dp: 0 };
  return out;
}

const fmt = (abs, dp) => abs.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp, useGrouping: false });

// Build the list of textual rewrites between two published-value sets.
export function rewritePlan(previous, next) {
  const plan = [], problems = [];
  for (const [key, n] of Object.entries(next)) {
    const p = previous[key];
    if (!p || p.value === n.value) continue;
    if (n.dp === 0) { problems.push(`${key}: ${p.value} -> ${n.value} is a year/integer change; rewrite needs review`); continue; }
    plan.push({ key, from: p.value, to: n.value, dp: n.dp, fromText: fmt(Math.abs(p.value), n.dp), toText: fmt(Math.abs(n.value), n.dp) });
  }
  // One old token may only map to one new value (compared by digits; sign style comes from the text).
  const byToken = new Map();
  for (const step of plan) {
    const k = step.fromText;
    const seen = byToken.get(k);
    if (seen && seen.to !== step.to) problems.push(`ambiguous: ${step.fromText} is ${seen.key} -> ${seen.to} and ${step.key} -> ${step.to}`);
    else byToken.set(k, step);
  }
  // A token that changes must not also be an unchanged value elsewhere.
  for (const [key, n] of Object.entries(next)) {
    const p = previous[key];
    if (!p || p.value !== n.value) continue;
    const k = fmt(Math.abs(n.value), n.dp);
    if (byToken.has(k)) problems.push(`ambiguous: ${fmt(Math.abs(n.value), n.dp)} changes for ${byToken.get(k).key} but stays for ${key}`);
  }
  return { steps: [...byToken.values()], problems };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NEG = '▲−-';

// Apply a plan to one text. Returns { text, count, perStep, signReview }.
// The sign style found in the text is kept (▲, −, - or none). A value that changes sign
// drops or adds the sign character; where the text shows no sign at all the change is
// reported for review instead of guessed.
export function applyPlan(text, steps) {
  let out = text, count = 0; const perStep = {}, signReview = [];
  for (const step of steps) {
    const re = new RegExp(`([${NEG}]?)(\\s?¥?)(?<![\\d.])${esc(step.fromText)}(?![\\d])(?!\\.\\d)`, 'g');
    let n = 0;
    const flips = (step.from < 0) !== (step.to < 0);
    out = out.replace(re, (all, sign, mid) => {
      n += 1;
      if (!flips) return sign + mid + step.toText;
      if (sign) return mid.trimStart() + step.toText;
      if (step.to < 0 && mid.includes('¥')) return '▲' + mid.trimStart() + step.toText;
      signReview.push(step.key);
      return sign + mid + step.toText;
    });
    perStep[step.key] = n; count += n;
  }
  return { text: out, count, perStep, signReview };
}
