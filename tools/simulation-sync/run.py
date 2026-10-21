#!/usr/bin/env python3
"""Apply the simulator's latest results to the English portfolio PDFs (numbers only).

  python3 tools/simulation-sync/run.py            rewrite, verify, then replace files
  python3 tools/simulation-sync/run.py --check    fail if the shown numbers differ from the results

Targets: the Toyota / Woven version at the site root (/), the version under /portfolio/ and the
version under /capabilities/ (each page keeps its own file). A PDF is replaced only after the layout gate passes;
if any target fails, nothing is replaced and the ledger is left unchanged.
"""
import json, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
# One file per site page: / (Toyota / Woven), /portfolio/ (Honda) and /capabilities/ (general). Each is kept separately.
TARGETS = ['Autonomous_Mobility_System_Business_Feasibility.pdf',
           'portfolio/Autonomous_Mobility_System_Business_Feasibility.pdf',
           'capabilities/Autonomous_Mobility_System_Business_Feasibility.pdf']


def main():
    tmp = tempfile.mkdtemp()
    plan_path = os.path.join(tmp, 'plan.json')
    r = subprocess.run(['node', os.path.join(HERE, 'plan.mjs'), plan_path])
    if r.returncode:
        return 1
    plan = json.load(open(plan_path))
    if '--check' in sys.argv:
        if plan['steps']:
            print('Portfolio numbers differ from the simulator results:')
            for s in plan['steps']:
                print(f"  {s['key']}: shown {s['from']}, simulator {s['to']}")
            print('Run: python3 tools/simulation-sync/run.py')
            return 1
        print('Portfolio numbers match the simulator results.')
        return 0
    if not plan['steps']:
        print('Nothing to rewrite.')
        return 0
    staged = []
    for rel in TARGETS:
        src = os.path.join(ROOT, rel)
        out = os.path.join(tmp, rel.replace('/', '__'))
        rep = out + '.report.json'
        if subprocess.run([sys.executable, os.path.join(HERE, 'pdf_numbers.py'), plan_path, src, out, rep]).returncode:
            print('Kept the previous PDFs: rewrite refused for', rel)
            return 1
        if subprocess.run([sys.executable, os.path.join(HERE, 'verify_layout.py'), plan_path, src, out]).returncode:
            print('Kept the previous PDFs: layout gate failed for', rel)
            return 1
        staged.append((out, src))
    for out, src in staged:
        shutil.copyfile(out, src)
    ledger = {'engine': plan['engine'], 'values': plan['next']}
    with open(os.path.join(HERE, 'published-values.json'), 'w') as f:
        json.dump(ledger, f, indent=1)
        f.write('\n')
    print(f"{len(plan['steps'])} numbers updated in {len(staged)} PDFs")
    return 0


if __name__ == '__main__':
    sys.exit(main())
