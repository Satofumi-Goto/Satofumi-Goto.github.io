#!/usr/bin/env python3
"""Layout gate for a number-rewritten PDF.

Usage: verify_layout.py PLAN.json BEFORE.pdf AFTER.pdf

PASS only when
  1. the page count and page sizes are unchanged,
  2. every character keeps its font, size and position (within 0.01 pt), except inside a
     table cell whose number changes length: that cell must start at the same point, keep its
     font, sit in a left-aligned column, have had at least 6 pt of space after it (a table, not running
     text) and still end at least 1 pt before the next text,
  3. the text changes exactly where the plan rewrites a number, and nowhere else,
  4. rendered pixels differ only inside the boxes of the rewritten characters.
Any failure exits 1; the caller must then keep the previous PDF.
"""
import json, re, sys
import pdfplumber
import pypdfium2 as pdfium
import numpy as np
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdf_numbers import find_replacements, apply_replacements, Refused

SCALE = 2.0


def cell_word(chars, start, end):
    """Extend a span to the whole visual word it sits in (same line, glyphs touching)."""
    def joined(a, b):
        if a['text'] == ' ' or b['text'] == ' ':
            return False
        return abs(a['top'] - b['top']) < 0.01 and a['fontname'] == b['fontname'] and abs(a['size'] - b['size']) < 0.01 and -0.5 < b['x0'] - a['x1'] < 1.0
    while start > 0 and joined(chars[start - 1], chars[start]):
        start -= 1
    while end < len(chars) and joined(chars[end - 1], chars[end]):
        end += 1
    return start, end


def check_cell(page_no, before, after, bs, be, as_, ae, problems):
    """A length-changing cell must start where it did, keep its font, sit in a left-aligned
    column, and end before whatever follows it on the line."""
    b0, a0 = before[bs], after[as_]
    for k in ('x0', 'top', 'bottom', 'size'):
        if abs(b0[k] - a0[k]) > 0.01:
            problems.append(f'page {page_no}: cell {b0["text"]!r} start moved ({k})'); return []
    if any(c['fontname'] != b0['fontname'] or abs(c['size'] - b0['size']) > 0.01 for c in after[as_:ae]):
        problems.append(f'page {page_no}: cell {b0["text"]!r} font changed'); return []
    column = [c for c in before if abs(c['x0'] - b0['x0']) < 0.05 and abs(c['top'] - b0['top']) > 1]
    if len(column) < 2:
        problems.append(f'page {page_no}: cell at x={b0["x0"]:.2f} is not in a left-aligned column'); return []
    old_right = max(c['x1'] for c in before[bs:be])
    old_next = [c['x0'] for c in before if c['text'].strip() and abs(c['top'] - b0['top']) < 1 and c['x0'] >= old_right - 0.01 and c not in before[bs:be]]
    if old_next and min(old_next) - old_right < 6.0:
        problems.append(f'page {page_no}: {b0["text"]!r} is running text (next word {min(old_next) - old_right:.2f} pt away), its length must not change'); return []
    right = max(c['x1'] for c in after[as_:ae])
    nxt = [c['x0'] for c in after if c['text'].strip() and abs(c['top'] - a0['top']) < 1 and c['x0'] >= max(x['x1'] for x in before[bs:be]) - 0.01 and c not in after[as_:ae]]
    if nxt and right > min(nxt) - 1.0:
        problems.append(f'page {page_no}: cell {b0["text"]!r} now reaches {right:.2f}, next text starts at {min(nxt):.2f}')
    boxes = [(c['x0'], c['top'], c['x1'], c['bottom']) for c in before[bs:be] + after[as_:ae]]
    return boxes


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
            ta = ''.join(c['text'] for c in ca); tb = ''.join(c['text'] for c in cb)
            try:
                reps = find_replacements(ta, steps, i)
            except Refused as e:
                problems.append(str(e)); continue
            if apply_replacements(ta, reps) != tb:
                problems.append(f'page {i}: text differs from the planned rewrite'); continue
            # Walk both pages together. Equal-length rewrites keep every glyph in place;
            # a length-changing rewrite is checked as a whole cell, and the rest must not move.
            segs = []
            for start, end, to, _ in reps:
                if len(to) != end - start:
                    ws, we = cell_word(ca, start, end)
                    ws = max(ws, segs[-1][1] if segs else 0)
                    segs.append((ws, we, start, end, to))
            boxes, ia, ib = [], 0, 0
            for ws, we, start, end, to in segs + [(len(ca), len(ca), len(ca), len(ca), '')]:
                while ia < ws:
                    x, y = ca[ia], cb[ib]
                    for k in ('x0', 'x1', 'top', 'bottom', 'size'):
                        if abs(x[k] - y[k]) > 0.01:
                            problems.append(f"page {i}: {x['text']!r} moved ({k})"); break
                    if x['fontname'] != y['fontname']:
                        problems.append(f"page {i}: font changed at {x['text']!r}")
                    if x['text'] != y['text']:
                        boxes.append((x['x0'], x['top'], x['x1'], x['bottom']))
                    ia += 1; ib += 1
                if ws == len(ca):
                    break
                d = len(to) - (end - start)
                boxes += check_cell(i, ca, cb, ws, we, ib, ib + (we - ws) + d, problems)
                ia, ib = we, ib + (we - ws) + d
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
