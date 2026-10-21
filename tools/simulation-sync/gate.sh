#!/usr/bin/env bash
# Layout gate for a pull request: the PDFs may differ from the base branch only by the
# numbers that the ledger change (base published-values.json -> PR published-values.json) rewrites.
set -euo pipefail
BASE=${1:-origin/main}
T=tools/simulation-sync
W=$(mktemp -d)
PDFS="Autonomous_Mobility_System_Business_Feasibility.pdf portfolio/Autonomous_Mobility_System_Business_Feasibility.pdf capabilities/Autonomous_Mobility_System_Business_Feasibility.pdf"
if git diff --quiet "$BASE" -- $PDFS; then
  echo "PDFs unchanged from $BASE: nothing to gate (ledger-only change; run.py --check verifies the ledger)"
  exit 0
fi
git show "$BASE:$T/published-values.json" > "$W/base-values.json" 2>/dev/null || cp "$T/bootstrap-values.json" "$W/base-values.json"  # numbers shown by the PDFs before this mechanism
node --input-type=module -e "
import fs from 'node:fs';
import { rewritePlan } from './$T/simulationSync.mjs';
const a=JSON.parse(fs.readFileSync('$W/base-values.json')).values, b=JSON.parse(fs.readFileSync('$T/published-values.json')).values;
const {steps,problems}=rewritePlan(a,b);
if(problems.length){console.error(problems.join('\n'));process.exit(1);}
fs.writeFileSync('$W/plan.json',JSON.stringify({steps}));console.log(steps.length+' planned number changes');"
# Index alignment (P10 targets raised to the P1 gates): anchored steps newly added to applied.json since the base.
git show "$BASE:tools/index-alignment/applied.json" > "$W/base-applied.json" 2>/dev/null || echo '{"steps":[]}' > "$W/base-applied.json"
python3 - "$W" <<'PY'
import json, os, sys
w = sys.argv[1]
plan = json.load(open(w + '/plan.json'))
base = {s['key'] for s in json.load(open(w + '/base-applied.json'))['steps']}
cur = json.load(open('tools/index-alignment/applied.json'))['steps'] if os.path.exists('tools/index-alignment/applied.json') else []
new = [s for s in cur if s['key'] not in base]
plan['steps'] += new
json.dump(plan, open(w + '/plan.json', 'w'))
print(f'{len(new)} anchored index-alignment changes')
PY
for f in $PDFS; do
  # A page that gets its own file for the first time is compared with the file it used to link (the /portfolio/ version).
  git show "$BASE:$f" > "$W/base.pdf" 2>/dev/null || git show "$BASE:portfolio/Autonomous_Mobility_System_Business_Feasibility.pdf" > "$W/base.pdf"
  if cmp -s "$W/base.pdf" "$f"; then echo "$f unchanged"; continue; fi
  python3 $T/verify_layout.py "$W/plan.json" "$W/base.pdf" "$f"
done
