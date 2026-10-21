#!/usr/bin/env python3
"""Layout gate for pdf_lines.py.

Usage: verify_lines.py TARGETS.json BEFORE.pdf AFTER.pdf
PASS only when
  1. the page count and page sizes are unchanged,
  2. outside the target lines every character keeps its text, font, size and position (0.01 pt),
  3. each target line now reads exactly the new text, on the same baseline and from the same
     start, in one font and size, and ends at or before its max_right,
  4. rendered pixels differ only inside the target line bands.
"""
import json, sys
import pdfplumber
import pypdfium2 as pdfium
import numpy as np

SCALE = 2.0


def in_target(c, t):
    return (abs(c['top'] - t['top']) < 1.0 and t['x0'] - 0.5 <= c['x0'] and c['x1'] <= t['x1'] + 0.5
            and abs(c['size'] - t['size']) < 0.05)


def main(tp, before, after):
    targets = json.load(open(tp))
    problems, bands = [], {}
    with pdfplumber.open(before) as a, pdfplumber.open(after) as b:
        if len(a.pages) != len(b.pages):
            print('FAIL page count'); return 1
        for i, (pa, pb) in enumerate(zip(a.pages, b.pages), 1):
            if (pa.width, pa.height) != (pb.width, pb.height):
                problems.append(f'page {i}: size changed')
            ts = [t for t in targets if t['page'] == i]
            keep_a = [c for c in pa.chars if not any(in_target(c, t) for t in ts)]
            keep_b = [c for c in pb.chars if not any(in_target(c, t) for t in ts)]
            if len(keep_a) != len(keep_b):
                problems.append(f'page {i}: {len(keep_a)} -> {len(keep_b)} characters outside the target lines'); continue
            for x, y in zip(keep_a, keep_b):
                if x['text'] != y['text'] or x['fontname'] != y['fontname'] or any(abs(x[k] - y[k]) > 0.01 for k in ('x0', 'x1', 'top', 'size')):
                    problems.append(f"page {i}: {x['text']!r} at {x['x0']:.1f},{x['top']:.1f} changed"); break
            for t in ts:
                old = [c for c in pa.chars if in_target(c, t)]
                new = [c for c in pb.chars if in_target(c, t)]
                text = ''.join(c['text'] for c in new)
                if text.replace(' ', '') != t['new'].replace(' ', ''):
                    problems.append(f'page {i}: line {t["top"]} reads {text!r}')
                o0 = next(c for c in old if not c['text'].isspace()); n0 = next(c for c in new if not c['text'].isspace())
                if abs(n0['x0'] - o0['x0']) > 0.05 or abs(n0['top'] - o0['top']) > 0.05:
                    problems.append(f'page {i}: line {t["top"]} start moved')
                if new and max(c['x1'] for c in new) > t['max_right'] + 0.01:
                    problems.append(f'page {i}: line {t["top"]} ends past {t["max_right"]}')
                if len({(c['fontname'], round(c['size'], 2)) for c in new}) > 1:
                    problems.append(f'page {i}: line {t["top"]} mixes fonts')
                x0 = min(c['x0'] for c in old + new); x1 = max(c['x1'] for c in old + new)
                tp_ = min(c['top'] for c in old + new); bt = max(c['bottom'] for c in old + new)
                bands.setdefault(i, []).append((x0, tp_, x1, bt))
    da, db = pdfium.PdfDocument(before), pdfium.PdfDocument(after)
    for i in range(len(da)):
        ia = np.asarray(da[i].render(scale=SCALE).to_pil().convert('L'), dtype=np.int16)
        ib = np.asarray(db[i].render(scale=SCALE).to_pil().convert('L'), dtype=np.int16)
        diff = np.abs(ia - ib) > 8
        mask = np.zeros_like(diff)
        for x0, t, x1, btm in bands.get(i + 1, []):
            mask[max(0, int(t * SCALE) - 3):int(btm * SCALE) + 4, max(0, int(x0 * SCALE) - 3):int(x1 * SCALE) + 4] = True
        out = int((diff & ~mask).sum())
        if out:
            problems.append(f'page {i + 1}: {out} pixels changed outside the target lines')
    if problems:
        print('FAIL'); print('\n'.join(problems[:30])); return 1
    print(f'PASS: {len(targets)} lines replaced; every other character and pixel unchanged')
    return 0


if __name__ == '__main__':
    sys.exit(main(*sys.argv[1:4]))
