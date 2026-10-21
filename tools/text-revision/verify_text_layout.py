#!/usr/bin/env python3
"""Layout gate for a phrase-rewritten PDF (independent of pdf_text.py: reads both PDFs with pdfplumber/pdfium).

Usage: verify_text_layout.py PLAN.json BEFORE.pdf AFTER.pdf

PASS only when
  1. page count and page sizes are unchanged;
  2. every planned `old` phrase is found in BEFORE the expected number of times, and each `new` phrase
     is found in AFTER inside the box of the old phrase it replaces (same baseline, not wider), or up to the
     step's `extendTo` when that extra space was blank in BEFORE;
  3. every character outside those boxes keeps its text, font, size and position (x within one character
     spacing, 0.06 pt, because pdfminer drops Tc at text-operation ends; top within 0.01 pt);
  4. rendered pixels differ only inside those boxes.
"""
import json, sys
import pdfplumber
import pypdfium2 as pdfium
import numpy as np

SCALE = 2.0
TOL = 0.35


def flat(page):
    chars = [c for c in page.chars if c['text'] not in ('', None)]
    return chars, ''.join(c['text'] for c in chars)


def lines_with(chars, within):
    """Indices of chars on text lines (same top) whose text contains `within`."""
    rows = {}
    for k, c in enumerate(chars):
        rows.setdefault(round(c['top'], 1), []).append(k)
    keep = set()
    for ks in rows.values():
        if within in ''.join(chars[k]['text'] for k in ks) or within.replace(' ', '') in ''.join(chars[k]['text'] for k in ks).replace(' ', ''):
            keep.update(ks)
    return keep


def find_boxes(chars, text, phrase, allowed=None):
    out, start = [], 0
    key = phrase.replace(' ', '')
    # pdfplumber may drop or keep spaces that the plan contains; match ignoring spaces.
    stripped = [(k, c) for k, c in enumerate(text) if c != ' ']
    s = ''.join(c for _, c in stripped)
    pos = s.find(key)
    while pos >= 0:
        ks = [stripped[p][0] for p in range(pos, pos + len(key))]
        cs = [chars[k] for k in ks]
        if allowed is not None and not set(ks) <= allowed:
            pos = s.find(key, pos + 1); continue
        out.append({'x0': min(c['x0'] for c in cs), 'x1': max(c['x1'] for c in cs),
                    'top': min(c['top'] for c in cs), 'bottom': max(c['bottom'] for c in cs), 'idx': set(ks)})
        pos = s.find(key, pos + 1)
    return out


XTOL = 0.06  # pdfminer drops the character spacing (Tc) after the last glyph of each text operation, so a
             # glyph that now follows a rewritten operation can read up to one Tc (≈0.05 pt here) off; pixels are exact.


def unmatched(xs, ys):
    """Characters of xs with no counterpart in ys (same text, font, size, top; x within XTOL)."""
    pool = {}
    for c in ys:
        pool.setdefault((c['text'], c['fontname'], round(c['size'], 2), round(c['top'], 2)), []).append(c['x0'])
    out = []
    for c in xs:
        cand = pool.get((c['text'], c['fontname'], round(c['size'], 2), round(c['top'], 2)), [])
        best = min(range(len(cand)), key=lambda k: abs(cand[k] - c['x0']), default=None)
        if best is None or abs(cand[best] - c['x0']) > XTOL:
            out.append((c['text'], c['fontname'], round(c['x0'], 2), round(c['top'], 2)))
        else:
            cand.pop(best)
    return out


def main(plan_path, before, after):
    steps = json.load(open(plan_path))['steps']
    problems = []
    boxes_by_page = {}
    blank_needed = []
    with pdfplumber.open(before) as A, pdfplumber.open(after) as B:
        if len(A.pages) != len(B.pages):
            print('FAIL page count', len(A.pages), len(B.pages)); return 1
        for pno, (pa, pb) in enumerate(zip(A.pages, B.pages), 1):
            if (pa.width, pa.height) != (pb.width, pb.height):
                problems.append(f'page {pno}: size changed')
            ca, ta = flat(pa)
            cb, tb = flat(pb)
            boxes = []
            for s in [s for s in steps if s['page'] == pno]:
                olds = find_boxes(ca, ta, s['old'], lines_with(ca, s['within']) if s.get('within') else None)
                if s.get('occurrence'):
                    olds = olds[s['occurrence'] - 1:s['occurrence']]
                elif len(olds) != s.get('count', 1):
                    problems.append(f"page {pno}: {s['old']!r} found {len(olds)} times in BEFORE"); continue
                news = find_boxes(cb, tb, s['new']) if s['new'].strip() else []
                for ob in olds:
                    if s.get('extendLeft') and s['extendLeft'] < ob['x0']:
                        ext = {'x0': s['extendLeft'], 'x1': ob['x0'] - TOL, 'top': ob['top'], 'bottom': ob['bottom']}
                        blank_needed.append((pno, ext, s['old']))
                        ob = dict(ob, x0=s['extendLeft'])
                    if s.get('extendTo') and s['extendTo'] > ob['x1']:
                        ext = {'x0': ob['x1'] + TOL, 'x1': s['extendTo'], 'top': ob['top'], 'bottom': ob['bottom']}
                        blank_needed.append((pno, ext, s['old']))
                        ob = dict(ob, x1=s['extendTo'])
                    boxes.append(ob)
                    if not s['new'].strip():
                        continue
                    ok = any(nb['x0'] >= ob['x0'] - TOL and nb['x1'] <= ob['x1'] + TOL and abs(nb['bottom'] - ob['bottom']) < 1.5 for nb in news)
                    if not ok:
                        problems.append(f"page {pno}: {s['new']!r} not drawn inside the box of {s['old']!r}")
            boxes_by_page[pno] = boxes

            def inside(c):
                cx = (c['x0'] + c['x1']) / 2; cy = (c['top'] + c['bottom']) / 2
                return any(b['x0'] - TOL <= cx <= b['x1'] + TOL and b['top'] - 1 <= cy <= b['bottom'] + 1 for b in boxes)
            ra = [c for c in ca if not inside(c)]
            rb = [c for c in cb if not inside(c)]
            lost, added = unmatched(ra, rb), unmatched(rb, ra)
            if lost or added:
                problems.append(f'page {pno}: characters outside the rewritten boxes changed; lost {lost[:6]} added {added[:6]}')
    da, db = pdfium.PdfDocument(before), pdfium.PdfDocument(after)
    for pno, ext, old in blank_needed:
        ia = np.asarray(da[pno - 1].render(scale=SCALE).to_pil().convert('L'), dtype=np.int16)
        h = ext['bottom'] - ext['top']  # glyph band only: table rules above/below the text line are not "content"
        reg = ia[int((ext['top'] + 0.2 * h) * SCALE):int((ext['bottom'] - 0.2 * h) * SCALE), int(ext['x0'] * SCALE) + 2:int(ext['x1'] * SCALE) - 1]
        if reg.size and (reg < 200).any():
            problems.append(f'page {pno}: space after {old!r} up to x={ext["x1"]} was not blank in BEFORE')
    for i in range(len(da)):
        ia = np.asarray(da[i].render(scale=SCALE).to_pil().convert('L'), dtype=np.int16)
        ib = np.asarray(db[i].render(scale=SCALE).to_pil().convert('L'), dtype=np.int16)
        if ia.shape != ib.shape:
            problems.append(f'page {i + 1}: render size changed'); continue
        diff = np.abs(ia - ib) > 8
        mask = np.zeros_like(diff)
        for b in boxes_by_page.get(i + 1, []):
            mask[max(0, int(b['top'] * SCALE) - 3):int(b['bottom'] * SCALE) + 4, max(0, int(b['x0'] * SCALE) - 3):int(b['x1'] * SCALE) + 4] = True
        outside = int((diff & ~mask).sum())
        if outside:
            problems.append(f'page {i + 1}: {outside} pixels changed outside the rewritten boxes')
    if problems:
        print('FAIL'); print('\n'.join(problems[:60])); return 1
    n = sum(len(v) for v in boxes_by_page.values())
    print(f'PASS layout unchanged: {len(da)} pages, {n} phrases rewritten inside their original boxes, all other characters and pixels identical')
    return 0


if __name__ == '__main__':
    sys.exit(main(*sys.argv[1:4]))
