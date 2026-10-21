#!/usr/bin/env python3
"""Keep the English portfolio's phase targets (P10) consistent with its minimum gates (P1).

  python3 tools/index-alignment/align_targets.py --check    fail if a 2030 / 2035 phase target is weaker than the P1 gate
  python3 tools/index-alignment/align_targets.py --fix      raise the weaker target to the gate (digits only), verify the
                                                              layout gate, replace both PDFs, append to applied.json
  python3 tools/index-alignment/align_targets.py --federation FILE.json   also compare the P1 gates with Federation's
                                                              parameterRegistry export (list of {id,value}); Federation owns the indices

The gate (P1) is the index held in Federation, so P10 is the side that is rewritten. A target that equals the gate is allowed.
Only digit glyphs are exchanged, through tools/simulation-sync (same refusal rules and layout gate).
"""
import json, os, re, shutil, subprocess, sys, tempfile
import pdfplumber

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SYNC = os.path.join(ROOT, 'tools', 'simulation-sync')
TARGETS = ['Autonomous_Mobility_System_Business_Feasibility.pdf', 'portfolio/Autonomous_Mobility_System_Business_Feasibility.pdf', 'capabilities/Autonomous_Mobility_System_Business_Feasibility.pdf']
M = json.load(open(os.path.join(HERE, 'manifest.json')))


def parse(pdf_path):
    with pdfplumber.open(pdf_path) as p:
        p1 = p.pages[0].extract_text().split('\n')
        p10 = p.pages[9].extract_text().split('\n')
    gates = {}
    for pr in M['pairs']:
        for l in p1:
            if re.match(r'^[A-H] \w+ ' + re.escape(pr['kpi']) + ' ', l):
                m = re.search(r'([≥≤])\s?(\d+(?:\.\d+)?)\s+\w+$', l)
                if m: gates[pr['kpi']] = (m.group(1), m.group(2))
    targets = {}
    for pr in M['pairs']:
        for l in p10:
            if pr['formula'] in l:
                m = re.search(re.escape(pr['formula']) + r'\s+([≥≤])(\d+(?:\.\d+)?)\s+([≥≤])(\d+(?:\.\d+)?)', l)
                if m: targets[pr['item']] = [(m.group(1), m.group(2)), (m.group(3), m.group(4))]
    return gates, targets


def findings(pdf_path):
    gates, targets = parse(pdf_path)
    out, steps = [], []
    for pr in M['pairs']:
        g, t = gates.get(pr['kpi']), targets.get(pr['item'])
        if not g or not t:
            out.append(f"{pr['kpi']}: not found in the PDF (gate {g}, target {t})"); continue
        for yi, year in enumerate(('2030', '2035')):
            sym, val = t[yi]
            weaker = float(val) < float(g[1]) if g[0] == '≥' else float(val) > float(g[1])
            if weaker:
                out.append(f"{pr['item']} {year}: target {sym}{val} is weaker than the P1 gate {g[0]}{g[1]} ({pr['kpi']})")
                if len(val) == len(g[1]):
                    anchor = pr['formula'] + ' ' + g[0] + (t[0][1] + ' ' + t[0][0] if yi else '')
                    steps.append({'key': f"align.{pr['item']}.{year}", 'page': 10, 'anchor': anchor, 'fromText': val, 'toText': g[1], 'from': float(val), 'to': float(g[1]), 'dp': 2})
    return out, steps


def main():
    args = sys.argv[1:]
    src = os.path.join(ROOT, TARGETS[0])
    out, steps = findings(src)
    if '--federation' in args:
        fed = {e['id']: e['value'] for e in json.load(open(args[args.index('--federation') + 1]))}
        gates, _ = parse(src)
        for pid, kpi in (('p-demand-generation-rate', 'Demand generation rate'), ('p-conversion-rate', 'Conversion rate'), ('p-matching-rate', 'Matching rate'), ('p-trip-request-rate', 'Trip request rate')):
            g = gates.get(kpi)
            if g and fed.get(pid, '').lstrip('≥≤') != g[1]:
                out.append(f'{kpi}: Federation {fed.get(pid)} differs from the P1 gate {g[0]}{g[1]}')
    if '--fix' not in args:
        if out:
            print('Phase targets and gates are inconsistent:'); print('\n'.join('  ' + o for o in out)); print('Run: python3 tools/index-alignment/align_targets.py --fix'); return 1
        print('Phase targets (P10) are consistent with the minimum gates (P1).'); return 0
    if not steps:
        print('Nothing to rewrite.'); return 0 if not out else 1
    tmp = tempfile.mkdtemp(); plan = os.path.join(tmp, 'plan.json'); json.dump({'steps': steps}, open(plan, 'w'))
    staged = []
    for rel in TARGETS:
        s = os.path.join(ROOT, rel); o = os.path.join(tmp, rel.replace('/', '__'))
        if subprocess.run([sys.executable, os.path.join(SYNC, 'pdf_numbers.py'), plan, s, o, o + '.report.json']).returncode: print('Kept the previous PDFs: rewrite refused for', rel); return 1
        if subprocess.run([sys.executable, os.path.join(SYNC, 'verify_layout.py'), plan, s, o]).returncode: print('Kept the previous PDFs: layout gate failed for', rel); return 1
        staged.append((o, s))
    for o, s in staged: shutil.copyfile(o, s)
    ledger_path = os.path.join(HERE, 'applied.json')
    ledger = json.load(open(ledger_path)) if os.path.exists(ledger_path) else {'steps': []}
    ledger['steps'] += steps
    json.dump(ledger, open(ledger_path, 'w'), indent=1, ensure_ascii=False); open(ledger_path, 'a').write('\n')
    print(f'{len(steps)} phase targets raised to their gates in {len(staged)} PDFs'); return 0


if __name__ == '__main__':
    sys.exit(main())
