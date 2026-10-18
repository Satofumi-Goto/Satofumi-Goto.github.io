#!/usr/bin/env python3
"""Layout gate for a number-rewritten PDF.

Usage: verify_layout.py PLAN.json BEFORE.pdf AFTER.pdf

PASS only when
  1. the page count, page sizes and the number of text characters are unchanged,
  2. every character keeps its font, size and position (within 0.01 pt),
  3. the text changes exactly where the plan rewrites a number, and nowhere else,
  4. rendered pixels differ only inside the boxes of the rewritten characters.
Any failure exits 1; the caller must then keep the previous PDF.
"""
import json, re, sys
import pdfplumber
import pypdfium2 as pdfium
import numpy as np

SCALE = 2.0


def expected_text(text, steps):
    out = text
    for s in steps:
        out = re.sub(r'(?<![\d.])' + re.escape(s['fromText']) + r'(?!\d)(?!\.\d)', s['toText'], out)
    return out


def main(plan_path, before, after):
    steps = json.load(open(plan_path))['steps']
    problems, changed_boxes = [], {}
    with pdfplumber.open(before) as a, pdfplumber.open(after) as b:
        if len(a.pages) != len(b.pages):
            print('FAIL page count', len(a.pages), len(b.pages)); return 1
        for i, (pa, pb) in enumerate(zip(a.pages, b.pages), 1):
            if (pa.width, pa.height) != (pb.width, pb.height):
                problems.append(f'page {i}: size changed')
            ca, cb = pa.chars, pb.chars
            if len(ca) != len(cb):
                problems.append(f'page {i}: {len(ca)} -> {len(cb)} characters'); continue
            ta = ''.join(c['text'] for c in ca); tb = ''.join(c['text'] for c in cb)
            if expected_text(ta, steps) != tb:
                problems.append(f'page {i}: text differs from the planned rewrite')
            boxes = []
            for x, y in zip(ca, cb):
                for k in ('x0', 'x1', 'top', 'bottom', 'size'):
                    if abs(x[k] - y[k]) > 0.01:
                        problems.append(f"page {i}: {x['text']!r} moved ({k})"); break
                if x['fontname'] != y['fontname']:
                    problems.append(f"page {i}: font changed at {x['text']!r}")
                if x['text'] != y['text']:
                    boxes.append((x['x0'], x['top'], x['x1'], x['bottom']))
            changed_boxes[i] = boxes
    da, db = pdfium.PdfDocument(before), pdfium.PdfDocument(after)
    for i in range(len(da)):
        ia = np.asarray(da[i].render(scale=SCALE).to_pil().convert('L'), dtype=np.int16)
        ib = np.asarray(db[i].render(scale=SCALE).to_pil().convert('L'), dtype=np.int16)
        if ia.shape != ib.shape:
            problems.append(f'page {i + 1}: render size changed'); continue
        diff = np.abs(ia - ib) > 8
        mask = np.zeros_like(diff)
        for x0, t, x1, btm in changed_boxes.get(i + 1, []):
            mask[max(0, int(t * SCALE) - 3):int(btm * SCALE) + 4, max(0, int(x0 * SCALE) - 3):int(x1 * SCALE) + 4] = True
        outside = int((diff & ~mask).sum())
        if outside:
            problems.append(f'page {i + 1}: {outside} pixels changed outside rewritten numbers')
    if problems:
        print('FAIL'); print('\n'.join(problems[:50])); return 1
    n = sum(len(v) for v in changed_boxes.values())
    print(f'PASS layout unchanged: {len(da)} pages, {n} characters rewritten, all pixels outside them identical')
    return 0


if __name__ == '__main__':
    sys.exit(main(*sys.argv[1:4]))
