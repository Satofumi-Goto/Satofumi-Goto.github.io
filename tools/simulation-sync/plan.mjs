#!/usr/bin/env node
// Builds the rewrite plan from the numbers this site currently shows (published-values.json)
// to the simulator's latest results (simulation-results.json, delivered from Federation).
//   node tools/simulation-sync/plan.mjs PLAN.json   -> exit 0 with steps, exit 1 if refused
import fs from 'node:fs';
import { publishedValues, rewritePlan } from './simulationSync.mjs';
const dir = new URL('.', import.meta.url);
const results = JSON.parse(fs.readFileSync(new URL('simulation-results.json', dir)));
const shown = JSON.parse(fs.readFileSync(new URL('published-values.json', dir)));
const next = publishedValues(results.simulationResult, results.financialAssessment);
const { steps, problems } = rewritePlan(shown.values, next);
fs.writeFileSync(process.argv[2], JSON.stringify({ engine: results.engine, steps, next }, null, 1));
if (problems.length) { console.error('Refused:\n' + problems.join('\n')); process.exit(1); }
console.log(`${steps.length} numbers to rewrite`);
