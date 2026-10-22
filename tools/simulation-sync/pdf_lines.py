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
import json, sys, os, re
import pikepdf
import pdfplumber
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdf_numbers import page_chars, Refused


def line_chars(pl_page, t):
    cs = [(k, c) for k, c in enumerate(pl_page.chars)
          if abs(c['top'] - t['top']) < 1.0 and t['x0'] - 0.5 <= c['x0'] and c['x1'] <= t['x1'] + 0.5
          and abs(c['size'] - t['size']) < 0.05]
    return cs


def text_state_at(ops, index):
    st = {'Tf': None, 'Tc': [0], 'Tw': [0]}
    stack = []
    for j in range(index):
        o = str(ops[j][1])
        if o == 'q':
            stack.append(dict(st))
        elif o == 'Q' and stack:
            st = stack.pop()
        elif o in st:
            st[o] = list(ops[j][0])
    return st


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
        plan = []
        for t in ts:
            sel = line_chars(pl.pages[pno - 1], t)
            got = ''.join(c['text'] for _, c in sel)
            if got.replace(' ', '') != t['old'].replace(' ', ''):
                raise Refused(f'page {pno}: old text mismatch\n  found: {got}\n  want:  {t["old"]}')
            key = t['old'].replace(' ', '')
            # Which occurrence on the page is this line? Count occurrences in drawing order
            # (pdfplumber keeps content order) and take the same one in the content stream.
            pflat, pidx = [], []
            for k, c in enumerate(plc):
                if not c['text'].isspace():
                    pflat.append(c['text']); pidx.append(k)
            pflat = ''.join(pflat)
            sel_first = min(k for k, c in sel if not c['text'].isspace())
            occ = [m.start() for m in re.finditer(re.escape(key), pflat)]
            nth = next((i for i, a in enumerate(occ) if pidx[a] == sel_first), None)
            hits = [m.start() for m in re.finditer(re.escape(key), flat)]
            if nth is None or len(hits) != len(occ):
                raise Refused(f'page {pno}: the old text cannot be matched one-to-one in the content stream')
            at = hits[nth]
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
            # Every glyph of these operations must belong to the line, except that the last operation
            # may continue after the line's end (e.g. 'x (1' when only 'x' is replaced): its remaining
            # glyphs are kept and moved back to where they were with a TJ adjustment.
            tail = None
            for oi in op_ids:
                own = [k for k, c in enumerate(chars) if c[0] == oi]
                rest = [k for k in own if k not in set(idx)]
                if not any(not chars[k][4].isspace() for k in rest):
                    continue
                if oi != op_ids[-1] or min(rest) < max(k for k in own if k in set(idx)) or str(ops[oi][1]) != 'TJ':
                    raise Refused(f'page {pno}: an operation mixes this line with other text')
                # x (user space) of the first kept glyph and of the op's first glyph, from pdfplumber
                line = sorted([c for c in plc if abs(c['top'] - sel[0][1]['top']) < 0.5], key=lambda c: c['x0'])
                last_sel_x = max(c['x1'] for _, c in sel)
                keep_x = min(c['x0'] for c in line if c['x0'] >= last_sel_x - 0.05)  # first kept glyph, spaces included
                first_in_op = min(own)
                op_sel = [c for _, c in sel if not c['text'].isspace()]
                n_before = sum(1 for k in own if k in set(idx) and not chars[k][4].isspace())
                op_start_x = op_sel[len(op_sel) - n_before]['x0'] if n_before else keep_x
                tail = (oi, own, rest, keep_x - op_start_x)
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
            plan.append((chars[first][0], op_ids, runs, shown_by, right, t, tail, size))
        # Apply on the original parse, last operation first, so earlier indices stay valid.
        used = [oi for e in plan for oi in e[1]]
        if len(used) != len(set(used)):
            raise Refused(f'page {pno}: two targets share a text operation')
        names = {f.objgen: str(k) for k, f in page.Resources.Font.items()}
        for first_op, op_ids, runs, shown_by, right, t, tail, size in sorted(plan, key=lambda e: -e[0]):
            for oi in op_ids:
                operands, op = ops[oi]
                if tail and oi == tail[0]:
                    # keep the glyphs after the line; shift them right by the removed glyphs' advance
                    _, own, rest, dx_user = tail
                    fs = state[oi][0]
                    scale = size / fs
                    keep = set(rest)
                    items, gi = [], 0
                    order = own
                    for part in list(operands[0]):
                        if isinstance(part, pikepdf.String):
                            dec_bytes = bytes(part)
                            fi_ = chars[order[gi]][5]
                            step = 2 if fi_.type0 else 1
                            kept = b''
                            for off in range(0, len(dec_bytes), step):
                                if order[gi] in keep:
                                    kept += dec_bytes[off:off + step]
                                gi += 1
                            if kept:
                                items.append(pikepdf.String(kept))
                        elif any(order[j] in keep for j in range(gi, len(order))) and items:
                            items.append(part)
                    n = -(dx_user / scale) * 1000 / fs
                    ops[oi] = pikepdf.ContentStreamInstruction([pikepdf.Array([round(n, 4)] + items)], op)
                    continue
                if str(op) == 'TJ':
                    ops[oi] = pikepdf.ContentStreamInstruction([pikepdf.Array([pikepdf.String(b'')])], op)
                else:
                    ops[oi] = pikepdf.ContentStreamInstruction(list(operands[:-1]) + [pikepdf.String(b'')], op)
            # draw the new text from the first operation's position, no extra spacing
            new_ops = [pikepdf.ContentStreamInstruction([0], pikepdf.Operator('Tc')),
                       pikepdf.ContentStreamInstruction([0], pikepdf.Operator('Tw'))]
            for f, chs in runs:
                sh = shown_by[id(f)]
                new_ops.append(pikepdf.ContentStreamInstruction([pikepdf.Name(names[f.font.objgen]), 1], pikepdf.Operator('Tf')))
                new_ops.append(pikepdf.ContentStreamInstruction([pikepdf.Array([pikepdf.String(b''.join(f.encode(ch, sh) for ch in chs))])], pikepdf.Operator('TJ')))
            # Put the text state back for whatever this text object draws after the line: the
            # font, character and word spacing in force at this operation (q/Q respected).
            restore = text_state_at(ops, first_op)
            new_ops.append(ops[first_op])  # the original (already blanked) operation keeps its place
            for o in ('Tf', 'Tc', 'Tw'):
                if restore.get(o) is not None:
                    new_ops.insert(-1, pikepdf.ContentStreamInstruction(restore[o], pikepdf.Operator(o)))
            ops[first_op:first_op + 1] = new_ops
            print(f'page {pno}: line at {t["top"]} replaced, new text ends at {right:.1f}')
        # Optional per target: erase filled rectangles drawn on the line (e.g. a hyperlink underline),
        # given in PDF user space [x, y, w, h], and remove link annotations over the line band.
        for t in ts:
            for r in t.get('erase_fills', []):
                hit = [i for i, (o, op) in enumerate(ops) if str(op) == 're' and len(o) == 4
                       and all(abs(float(o[j]) - r[j]) < 0.02 for j in range(4))
                       and i + 1 < len(ops) and str(ops[i + 1][1]) in ('f', 'f*', 'F')]
                if len(hit) != 1:
                    raise Refused(f'page {pno}: fill {r} found {len(hit)} times')
                del ops[hit[0]:hit[0] + 2]
                print(f'page {pno}: fill {r} erased')
            if t.get('remove_links'):
                ph = float(page.obj.MediaBox[3])
                y0, y1 = ph - t['top'] - t['size'] * 1.3, ph - t['top'] + t['size'] * 0.3
                annots = page.obj.get('/Annots')
                if annots is not None:
                    keep = [a for a in annots if not (a.get('/Subtype') == '/Link'
                            and float(a.Rect[1]) < y1 and float(a.Rect[3]) > y0)]
                    print(f'page {pno}: {len(annots) - len(keep)} link annotation(s) removed at {t["top"]}')
                    page.obj.Annots = pikepdf.Array(keep)
        page.Contents = pdf.make_stream(pikepdf.unparse_content_stream(ops))
    pdf.save(dst)


if __name__ == '__main__':
    try:
        main(*sys.argv[1:4])
    except Refused as e:
        print('REFUSED:', e)
        sys.exit(2)
