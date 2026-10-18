#!/usr/bin/env bash
# Layout gate for a pull request: the PDFs may differ from the base branch only by the
# numbers that the ledger change (base published-values.json -> PR published-values.json) rewrites.
set -euo pipefail
BASE=${1:-origin/main}
T=tools/simulation-sync
W=$(mktemp -d)
git show "$BASE:$T/published-values.json" > "$W/base-values.json" 2>/dev/null || cp "$T/bootstrap-values.json" "$W/base-values.json"  # numbers shown by the PDFs before this mechanism
node --input-type=module -e "
import fs from 'node:fs';
import { rewritePlan } from './$T/simulationSync.mjs';
const a=JSON.parse(fs.readFileSync('$W/base-values.json')).values, b=JSON.parse(fs.readFileSync('$T/published-values.json')).values;
const {steps,problems}=rewritePlan(a,b);
if(problems.length){console.error(problems.join('\n'));process.exit(1);}
fs.writeFileSync('$W/plan.json',JSON.stringify({steps}));console.log(steps.length+' planned number changes');"
for f in Autonomous_Mobility_System_Business_Feasibility.pdf portfolio/Autonomous_Mobility_System_Business_Feasibility.pdf; do
  git show "$BASE:$f" > "$W/base.pdf"
  if cmp -s "$W/base.pdf" "$f"; then echo "$f unchanged"; continue; fi
  python3 $T/verify_layout.py "$W/plan.json" "$W/base.pdf" "$f"
done
