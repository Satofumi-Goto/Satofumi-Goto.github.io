#!/usr/bin/env python3
"""Replace the text of whole lines (or one table cell) in the English portfolio PDF.

Used when the Word master's wording changes and only the corrected PDF lines must follow,
without re-typesetting the page. Each target names a page, the line's top (pt), an x range,
the exact old text and the new text. The new text is drawn from the same start point, in the
font of the line's first glyph, at the line's size; every glyph of the old text is blanked.
Nothing else on the page is touched. `verify_lines.py` then checks that all other characters
and pixels are unchanged and that the new text stays inside its allowed width.

Usage: pdf_lines.py TARGETS.json IN.pdf OUT.pdf
TARGETS.json: [{"page": 15, "top": 583.1, "size": 9.0, "x0": 0, "x1": 600, "old": "...", "new": "...",
                "max_right": 581.0}, ...]
Refused (exit 2, OUT not written) when the old text does not match exactly, a glyph is missing
from the chosen embedded font, or the new text would run past max_right.
"""
import json, sys, os
import pikepdf
import pdfplumber
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdf_numbers import page_chars, Refused


def line_chars(pl_page, t):
    cs = [(k, c) for k, c in enumerate(pl_page.chars)
          if abs(c['top'] - t['top']) < 1.0 and t['x0'] - 0.5 <= c['x0'] and c['x1'] <= t['x1'] + 0.5
          and abs(c['size'] - t['size']) < 0.05]
    return cs


def main(targets_path, src, dst):
    targets = json.load(open(targets_path))
    pl = pdfplumber.open(src)
    pdf = pikepdf.open(src)
    cache = {}
    by_page = {}
    for t in targets:
        by_page.setdefault(t['page'], []).append(t)
    for pno, ts in by_page.items():
        page = pdf.pages[pno - 1]
        ops, chars, state = page_chars(page, cache)
        plc = pl.pages[pno - 1].chars
        # Locate each line in the content stream by its text (spaces ignored); it must occur once.
        flat, where = [], []
        for k, c in enumerate(chars):
            if not c[4].isspace():
                flat.append(c[4]); where.append(k)
        flat = ''.join(flat)
        for t in ts:
            sel = line_chars(pl.pages[pno - 1], t)
            got = ''.join(c['text'] for _, c in sel)
            if got.replace(' ', '') != t['old'].replace(' ', ''):
                raise Refused(f'page {pno}: old text mismatch\n  found: {got}\n  want:  {t["old"]}')
            key = t['old'].replace(' ', '')
            at = flat.find(key)
            if at < 0 or flat.find(key, at + 1) >= 0:
                raise Refused(f'page {pno}: the old text is not found exactly once in the content stream')
            idx = where[at:at + len(key)]
            # The line's glyphs must be contiguous in the content stream apart from spaces; anything
            # else drawn in between belongs to other text and stops the rewrite.
            between = [k for k in range(idx[0], idx[-1] + 1) if k not in set(idx)]
            if any(not chars[k][4].isspace() for k in between):
                raise Refused(f'page {pno}: other text is drawn in the middle of this line')
            idx = list(range(idx[0], idx[-1] + 1))
            start_x = next(c['x0'] for _, c in sel if not c['text'].isspace())
            first = min(idx)
            op_ids = sorted({chars[k][0] for k in idx})
            # every glyph of these operations must belong to the line
            for oi in op_ids:
                own = [k for k, c in enumerate(chars) if c[0] == oi]
                if any(not chars[k][4].isspace() for k in set(own) - set(idx)):
                    raise Refused(f'page {pno}: an operation mixes this line with other text')
            # Fonts: the embedded subsets of the line's typeface (same BaseFont). Each glyph is drawn
            # from a subset that has it: one the page already draws it in, or a CID subset whose
            # outline is embedded. Runs switch font without moving the pen.
            base = chars[idx[0]][5].font.BaseFont if not chars[idx[0]][4].isspace() else next(chars[k][5].font.BaseFont for k in idx if not chars[k][4].isspace())
            cands = [f for f in dict.fromkeys(c[5] for c in chars) if f.font.BaseFont == base]
            cands.sort(key=lambda f: not f.type0)
            shown_by = {id(f): {c[4] for c in chars if c[5] is f} for f in cands}
            def has(f, ch):
                return ch in shown_by[id(f)] or (f.type0 and f.gid.get(ch) in f.present)
            runs = []
            for ch in t['new']:
                f = next((f for f in cands if has(f, ch)), None)
                if f is None:
                    raise Refused(f'page {pno}: glyph {ch!r} is not embedded in {base}')
                if runs and runs[-1][0] is f:
                    runs[-1][1].append(ch)
                else:
                    runs.append((f, [ch]))
            size = next(c['size'] for _, c in sel if not c['text'].isspace())
            width = sum(f.width(ch) for f, chs in runs for ch in chs) / 1000 * size
            right = start_x + width
            if right > t['max_right']:
                raise Refused(f'page {pno}: new text ends at {right:.1f} > {t["max_right"]}')
            # blank the old glyphs
            for oi in op_ids:
                operands, op = ops[oi]
                if str(op) == 'TJ':
                    ops[oi] = pikepdf.ContentStreamInstruction([pikepdf.Array([pikepdf.String(b'')])], op)
                else:
                    ops[oi] = pikepdf.ContentStreamInstruction(list(operands[:-1]) + [pikepdf.String(b'')], op)
            # draw the new text from the first operation's position, no extra spacing
            first_op = chars[first][0]
            names = {f.objgen: str(k) for k, f in page.Resources.Font.items()}
            new_ops = [pikepdf.ContentStreamInstruction([0], pikepdf.Operator('Tc')),
                       pikepdf.ContentStreamInstruction([0], pikepdf.Operator('Tw'))]
            for f, chs in runs:
                sh = shown_by[id(f)]
                new_ops.append(pikepdf.ContentStreamInstruction([pikepdf.Name(names[f.font.objgen]), 1], pikepdf.Operator('Tf')))
                new_ops.append(pikepdf.ContentStreamInstruction([pikepdf.Array([pikepdf.String(b''.join(f.encode(ch, sh) for ch in chs))])], pikepdf.Operator('TJ')))
            # Put the text state back for whatever this text object draws after the line.
            restore = {}
            for j in range(first_op - 1, -1, -1):
                o = str(ops[j][1])
                if o in ('Tf', 'Tc', 'Tw') and o not in restore:
                    restore[o] = list(ops[j][0])
                if len(restore) == 3:
                    break
            new_ops.append(ops[first_op])  # the original (already blanked) operation keeps its place
            for o in ('Tf', 'Tc', 'Tw'):
                if o in restore:
                    new_ops.insert(-1, pikepdf.ContentStreamInstruction(restore[o], pikepdf.Operator(o)))
            ops[first_op:first_op + 1] = new_ops
            shift = len(new_ops) - 1  # the original op moved to the end of new_ops
            chars = [(c[0] + shift if c[0] > first_op else c[0],) + tuple(c[1:]) for c in chars]
            state = {(k + shift if k > first_op else k): v for k, v in state.items()}
            print(f'page {pno}: line at {t["top"]} replaced, new text ends at {right:.1f}')
        page.Contents = pdf.make_stream(pikepdf.unparse_content_stream(ops))
    pdf.save(dst)


if __name__ == '__main__':
    try:
        main(*sys.argv[1:4])
    except Refused as e:
        print('REFUSED:', e)
        sys.exit(2)
