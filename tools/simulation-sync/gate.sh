#!/usr/bin/env bash
# Layout gate for a pull request: the PDFs may differ from the base branch only by the
# numbers that the ledger change (base published-values.json -> PR published-values.json) rewrites.
set -euo pipefail
BASE=${1:-origin/main}
T=tools/simulation-sync
W=$(mktemp -d)
PDFS="Autonomous_Mobility_System_Business_Feasibility.pdf"
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
# Wording changes (whole lines, mirroring the Word master) newly added to wording-changes.json since the base.
git show "$BASE:$T/wording-changes.json" > "$W/base-wording.json" 2>/dev/null || echo '{"changes":[]}' > "$W/base-wording.json"
python3 - "$W" <<'PY'
import json, sys
w = sys.argv[1]
base = {c['id'] for c in json.load(open(w + '/base-wording.json'))['changes']}
new = [c for c in json.load(open('tools/simulation-sync/wording-changes.json'))['changes'] if c['id'] not in base]
json.dump(new, open(w + '/wording.json', 'w'))
print(f'{len(new)} wording changes')
PY
# Phrase rewrites (tools/text-revision): plans newly added since the base are replayed and checked by
# verify_text_layout.py (independent pdfplumber/pdfium check: other characters and pixels unchanged).
NEWPLANS=$(git diff --name-only --diff-filter=A "$BASE" -- 'tools/text-revision/*-plan.json' | grep -v revision-E-plan.json || true)
for f in $PDFS; do
  git show "$BASE:$f" > "$W/base.pdf"
  if cmp -s "$W/base.pdf" "$f"; then echo "$f unchanged"; continue; fi
  if [ -n "$NEWPLANS" ]; then
    cp "$W/base.pdf" "$W/cur.pdf"
    for pl in $NEWPLANS; do
      python3 tools/text-revision/pdf_text.py apply "$pl" "$W/cur.pdf" "$W/next.pdf" "$W/rep.json"
      python3 tools/text-revision/verify_text_layout.py "$pl" "$W/cur.pdf" "$W/next.pdf"
      mv "$W/next.pdf" "$W/cur.pdf"
    done
    python3 - "$W/cur.pdf" "$f" <<'PY'
import sys, pdfplumber
a, b = (pdfplumber.open(x) for x in sys.argv[1:3])
ok = all([(c['text'], round(c['x0'], 1), round(c['top'], 1)) for c in pa.chars] == [(c['text'], round(c['x0'], 1), round(c['top'], 1)) for c in pb.chars] for pa, pb in zip(a.pages, b.pages))
print('PASS replayed phrase rewrites match the PR PDF' if ok else 'FAIL the PR PDF differs from the replayed phrase rewrites'); sys.exit(0 if ok else 1)
PY
    continue
  fi
  if [ "$(python3 -c "import json;print(len(json.load(open('$W/wording.json'))))")" != "0" ]; then
    # Replay the wording changes on the base, check them, then check the numbers against that.
    python3 $T/pdf_lines.py "$W/wording.json" "$W/base.pdf" "$W/mid.pdf"
    python3 $T/verify_lines.py "$W/wording.json" "$W/base.pdf" "$W/mid.pdf"
    python3 $T/verify_layout.py "$W/plan.json" "$W/mid.pdf" "$f"
  else
    python3 $T/verify_layout.py "$W/plan.json" "$W/base.pdf" "$f"
  fi
done
