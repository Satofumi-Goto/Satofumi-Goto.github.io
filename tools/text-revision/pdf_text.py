#!/usr/bin/env python3
"""Rewrite phrases inside a published PDF without moving anything else on the page.

Usage:
  pdf_text.py dump IN.pdf PAGE                 list the text lines of a page (for writing a plan)
  pdf_text.py apply PLAN.json IN.pdf OUT.pdf REPORT.json

A plan step is {"page": n, "old": "...", "new": "...", "occurrence": k (optional, 1-based)}.
`old` must be found inside one text line of one text object. The new phrase is written in the
fonts the page already embeds (same size; the bold/regular weight of the replaced text) and fitted
into the horizontal span of the old phrase:
  - shorter: drawn at 100% and the remaining width is advanced, so what follows keeps its position;
  - longer:  compressed horizontally (Tz) to the old span, refused below MIN_SCALE.
A step is refused (exit 2, OUT not written) when a glyph is missing from every embedded font of the
same weight, when `old` is not found, or is found a different number of times than expected.
Everything outside the rewritten spans is left byte-identical in the content stream.
"""
import io, json, re, sys
import pikepdf
from fontTools.ttLib import TTFont

MIN_SCALE = 80.0  # percent


class Refused(Exception):
    pass


def tounicode(font):
    m = {}
    tu = font.get('/ToUnicode')
    if tu is None:
        return m
    s = tu.read_bytes().decode('latin1')
    for blk in re.findall(r'beginbfchar(.*?)endbfchar', s, re.S):
        for a, b in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
            m[int(a, 16)] = bytes.fromhex(b).decode('utf-16-be')
    for blk in re.findall(r'beginbfrange(.*?)endbfrange', s, re.S):
        for a, b, c in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
            a, b, base = int(a, 16), int(b, 16), int(c, 16)
            for k in range(a, b + 1):
                m[k] = chr(base + k - a)
    return m


class Font:
    def __init__(self, name, font):
        self.name, self.font = name, font
        self.base = str(font.BaseFont)
        self.family = self.base.split('+')[-1]
        self.bold = 'Bold' in self.family
        self.type0 = str(font.Subtype) == '/Type0'
        self.cmap = tounicode(font)            # code -> unicode
        self.rev = {}
        self.widths = {}
        self.present = set()                   # codes that have a glyph in the embedded program
        if self.type0:
            d = font.DescendantFonts[0]
            self.dw = float(d.get('/DW', 1000))
            W = list(d.get('/W', []))
            i = 0
            while i < len(W):
                a, b = int(W[i]), W[i + 1]
                if isinstance(b, pikepdf.Array):
                    for j, x in enumerate(b):
                        self.widths[a + j] = float(x)
                    i += 2
                else:
                    for g in range(a, int(b) + 1):
                        self.widths[g] = float(W[i + 2])
                    i += 3
            ff = d.FontDescriptor.get('/FontFile2')
            tt = TTFont(io.BytesIO(ff.read_bytes()))
            order, glyf = tt.getGlyphOrder(), tt['glyf']
            nonempty = {g for g in range(len(order)) if glyf[order[g]].numberOfContours != 0}
            for code, u in self.cmap.items():
                if code in nonempty or u == ' ':
                    self.present.add(code)
        else:
            first = int(font.get('/FirstChar', 0))
            for k, w in enumerate(font.get('/Widths', [])):
                self.widths[first + k] = float(w)
            self.dw = 0.0
            ff = font.FontDescriptor.get('/FontFile2')
            tt = TTFont(io.BytesIO(ff.read_bytes()))
            glyf = tt['glyf']
            cm = {}
            for t in tt['cmap'].tables:
                for c, g in t.cmap.items():
                    cm.setdefault(c & 0xFF if t.platformID == 3 and t.platEncID == 0 else c, g)
            for code, u in self.cmap.items():
                g = cm.get(code)
                if g is not None and (glyf[g].numberOfContours != 0 or u == ' '):
                    self.present.add(code)
        for code, u in self.cmap.items():
            if code in self.present:
                self.rev.setdefault(u, code)

    def decode(self, data):
        if self.type0:
            return [(self.cmap.get(data[i] * 256 + data[i + 1], '�'), data[i] * 256 + data[i + 1], i, 2)
                    for i in range(0, len(data) - 1, 2)]
        return [(self.cmap.get(b, bytes([b]).decode('cp1252', 'replace')), b, i, 1) for i, b in enumerate(data)]

    def width(self, code):
        return self.widths.get(code, self.dw)

    def encode(self, codes):
        if self.type0:
            return b''.join(bytes([c >> 8, c & 255]) for c in codes)
        return bytes(codes)


def num(x):
    return float(x)


def scan(page, fonts):
    """Return (ops, chars, lines). chars carry their user-space pen position; lines group consecutive
    characters (stream order) that share a baseline and advance to the right, across text objects."""
    ops = list(pikepdf.parse_content_stream(page))
    chars = []
    st = {'font': None, 'size': 0.0, 'Tc': 0.0, 'Tw': 0.0, 'Tz': 100.0, 'TL': 0.0}
    tlm = [1, 0, 0, 1, 0, 0]
    pen = 0.0
    def td(tx, ty):
        nonlocal tlm, pen
        a, b, c, d, e, f = tlm
        tlm = [a, b, c, d, e + tx * a + ty * c, f + tx * b + ty * d]
        pen = 0.0
    stack = []
    for oi, (operands, op) in enumerate(ops):
        o = str(op)
        if o == 'q':  # text state (font, Tc, Tw, Tz, TL) is part of the graphics state
            stack.append(dict(st))
        elif o == 'Q':
            if stack:
                st = stack.pop()
        elif o == 'BT':
            tlm = [1, 0, 0, 1, 0, 0]; pen = 0.0
        elif o == 'Tf':
            st['font'] = fonts.get(str(operands[0])); st['size'] = num(operands[1])
        elif o in ('Tc', 'Tw', 'Tz', 'TL'):
            st[o] = num(operands[0])
        elif o == 'Tm':
            tlm = [num(x) for x in operands]; pen = 0.0
        elif o == 'Td':
            td(num(operands[0]), num(operands[1]))
        elif o == 'TD':
            st['TL'] = -num(operands[1]); td(num(operands[0]), num(operands[1]))
        elif o == 'T*':
            td(0, -st['TL'])
        elif o in ('Tj', 'TJ', "'", '"') and st['font'] is not None:
            if o in ("'", '"'):
                td(0, -st['TL'])
            parts = list(operands[0]) if o == 'TJ' else [operands[-1]]
            f = st['font']
            th = st['Tz'] / 100.0
            opx = tlm[4] + pen * tlm[0]
            for pi, part in enumerate(parts):
                if isinstance(part, pikepdf.String):
                    for u, code, off, nb in f.decode(bytes(part)):
                        adv = (f.width(code) / 1000.0 * st['size'] + st['Tc'] + (st['Tw'] if (not f.type0 and code == 32) else 0.0)) * th
                        x0 = tlm[4] + pen * tlm[0]
                        chars.append({'u': u, 'code': code, 'op': oi, 'part': pi, 'off': off, 'nb': nb, 'font': f,
                                      'size': st['size'], 'Tc': st['Tc'], 'Tw': st['Tw'], 'Tz': st['Tz'],
                                      'x0': x0, 'x1': x0 + adv * tlm[0], 'y': tlm[5], 'scale': tlm[0], 'opx': opx})
                        pen += adv
                else:
                    pen += -num(part) / 1000.0 * st['size'] * th
    lines, cur = [], []
    for k, c in enumerate(chars):
        if cur and (abs(chars[cur[-1]]['y'] - c['y']) > 0.6 or c['x0'] < chars[cur[-1]]['x0'] - 0.5):
            lines.append(cur); cur = []
        cur.append(k)
    if cur:
        lines.append(cur)
    return ops, chars, lines


def page_fonts(page):
    return {str(k): Font(str(k), f) for k, f in page.Resources.Font.items()} if '/Font' in page.Resources else {}


def dump(path, pno, cells=False):
    pdf = pikepdf.open(path)
    page = pdf.pages[pno - 1]
    fonts = page_fonts(page)
    for f in fonts.values():
        print('#', f.name, f.base, 'type0' if f.type0 else 'tt', 'glyphs', len(f.present))
    ops, chars, lines = scan(page, fonts)
    for k, idx in enumerate(lines):
        t = ''.join(chars[i]['u'] for i in idx)
        if cells:
            segs, cur = [], [idx[0]]
            for p_, q in zip(idx, idx[1:]):
                if chars[q]['x0'] - chars[p_]['x1'] > 3.0:
                    segs.append(cur); cur = []
                cur.append(q)
            segs.append(cur)
            t = ' | '.join(f"[{chars[g[0]]['x0']:.1f}]" + ''.join(chars[i]['u'] for i in g) for g in segs)
        if t.strip():
            print(f'{k:4d} y={chars[idx[0]]["y"]:7.2f} x={chars[idx[0]]["x0"]:6.1f}-{chars[idx[-1]]["x1"]:6.1f} {t}')


def choose_fonts(new, like, fonts):
    """Pick, per character, an embedded font of the same weight that has the glyph (prefer `like`)."""
    cands = [like] + [f for f in fonts.values() if f is not like and f.bold == like.bold and f.family.replace('MT', '') .split('-')[0] == like.family.replace('MT', '').split('-')[0]]
    runs = []
    for ch in new:
        for f in cands:
            if ch in f.rev:
                break
        else:
            raise Refused(f'glyph {ch!r} is not embedded in any {like.family} font on this page')
        if runs and runs[-1][0] is f:
            runs[-1][1].append(f.rev[ch])
        else:
            runs.append((f, [f.rev[ch]]))
    return runs


def run_width(runs, size):
    return sum(f.width(c) / 1000.0 * size for f, codes in runs for c in codes)


def apply(plan, src, dst):
    pdf = pikepdf.open(src)
    report = {'pages': len(pdf.pages), 'changes': []}
    by_page = {}
    for s in plan['steps']:
        by_page.setdefault(s['page'], []).append(s)
    for pno, steps in sorted(by_page.items()):
        page = pdf.pages[pno - 1]
        fonts = page_fonts(page)
        ops, chars, lines = scan(page, fonts)
        edits = []
        for s in steps:
            hits = []
            for idx in lines:
                t = ''.join(chars[i]['u'] for i in idx)
                if s.get('within') and s['within'] not in t:
                    continue
                for m in re.finditer(re.escape(s['old']), t):
                    hits.append((idx[m.start()], idx[m.end() - 1]))
            if s.get('occurrence'):
                if len(hits) < s['occurrence']:
                    raise Refused(f"page {pno}: {s['old']!r} occurrence {s['occurrence']} not found ({len(hits)} found)")
                hits = [hits[s['occurrence'] - 1]]
            elif len(hits) != s.get('count', 1):
                raise Refused(f"page {pno}: {s['old']!r} found {len(hits)} times, expected {s.get('count', 1)}")
            for h in hits:
                edits.append((chars[h[0]]['op'], chars[h[1]]['op'], h[0], h[1], s))
        edits.sort()
        for e1, e2 in zip(edits, edits[1:]):
            if e1[1] >= e2[0]:
                raise Refused(f'page {pno}: steps share a text operation: {e1[4]["old"]!r} / {e2[4]["old"]!r}')
        for oa, ob, i, j, s in sorted(edits, key=lambda e: -e[0]):
            try:
                ops, rec = rewrite_span(ops, chars, i, j, s['new'], fonts, s.get('extendTo'), s.get('extendLeft'))
            except Refused as e:
                raise Refused(f"page {pno}: {s['old']!r} -> {s['new']!r}: {e}")
            rec.update({'page': pno, 'old': s['old'], 'new': s['new']})
            report['changes'].append(rec)
        page.Contents = pdf.make_stream(pikepdf.unparse_content_stream(ops))
    pdf.save(dst)
    report['changes'].sort(key=lambda r: (r['page'], r['old']))
    return report


def instr(operands, op):
    return pikepdf.ContentStreamInstruction(operands, pikepdf.Operator(op))


def clip_at(ops, k):
    """The rectangle of the last `re … W` clip set before op k (table cells are clipped one by one)."""
    rect = None
    for m in range(k - 1, -1, -1):
        if str(ops[m][1]) == 'W':
            for n in range(m - 1, max(m - 4, -1), -1):
                if str(ops[n][1]) == 're':
                    return tuple(round(float(x), 2) for x in ops[n][0])
            return 'path'
    return rect


def rewrite_span(ops, chars, i, j, new, fonts, extend_to=None, extend_left=None):
    a, b = chars[i], chars[j]
    sc = a['scale']
    old_w = (b['x1'] - a['x0']) / sc          # text-space width of the replaced phrase
    room = max(old_w, (extend_to - a['x0']) / sc) if extend_to else old_w
    if extend_left:  # right-aligned column: the new phrase ends where the old one ended and may grow leftwards
        room = max(old_w, (b['x1'] - extend_left) / sc)
    like, size = a['font'], a['size']
    runs = choose_fonts(new, like, fonts)
    nat = run_width(runs, size)
    scale = 100.0 if nat <= room + 1e-6 else room / nat * 100.0
    if scale < MIN_SCALE:
        raise Refused(f'{new!r} needs {scale:.1f}% horizontal scale (< {MIN_SCALE}%) to fit the span of {chars[i]["u"]}…')
    oa, ob = a['op'], b['op']
    clip = clip_at(ops, oa)
    for k in range(oa + 1, ob):
        if str(ops[k][1]) == 'W' and clip_at(ops, k + 1) != clip:
            raise Refused(f'the old phrase crosses a clipped cell boundary near {a["u"]}…; rewrite each cell separately')
    if extend_to and isinstance(clip, tuple) and extend_to > clip[0] + clip[2] + 0.01:
        raise Refused(f'extendTo {extend_to} lies outside the clipped cell (right edge {clip[0] + clip[2]:.2f})')

    def parts_of(op_index):
        operands, op = ops[op_index]
        return list(operands[0]) if str(op) == 'TJ' else [operands[-1]]

    def keep(op_index, test, number_test):
        f = next(c for c in chars if c['op'] == op_index)['font']
        out = []
        for pi, part in enumerate(parts_of(op_index)):
            if isinstance(part, pikepdf.String):
                data = bytes(part)
                kept = b''.join(data[off:off + nb] for _, _, off, nb in f.decode(data) if test(pi, off))
                if kept:
                    out.append(pikepdf.String(kept))
            elif number_test(pi):
                out.append(part)
        return out

    pre = keep(oa, lambda pi, off: (pi, off) < (a['part'], a['off']), lambda pi: pi < a['part'])
    # Kerning before the first replaced glyph positions it (kept); kerning after the last one positions the
    # next glyph (kept in `post`). old_w spans exactly from the first glyph's origin to the last glyph's end.
    post = keep(ob, lambda pi, off: (pi, off) > (b['part'], b['off']), lambda pi: pi > b['part'])
    seq = []
    if pre:
        seq.append(instr([pikepdf.Array(pre)], 'TJ'))
    seq += [instr([0], 'Tc'), instr([0], 'Tw'), instr([round(scale, 3)], 'Tz')]
    drawn = nat * scale / 100.0
    if extend_left and drawn > old_w:
        seq.append(instr([pikepdf.Array([(drawn - old_w) * 1000.0 / size / (scale / 100.0)])], 'TJ'))
    cur = like
    for f, codes in runs:
        if f is not cur:
            seq.append(instr([pikepdf.Name(f.name), size], 'Tf')); cur = f
        seq.append(instr([pikepdf.Array([pikepdf.String(f.encode(codes))])], 'TJ'))
    if cur is not like:
        seq.append(instr([pikepdf.Name(like.name), size], 'Tf'))
    if extend_left and drawn > old_w:
        drawn = old_w  # started further left by the overhang, so the pen already ends at the old end
    if abs(old_w - drawn) > 1e-4:  # return the pen to where the old phrase ended, so what follows keeps its place
        seq.append(instr([pikepdf.Array([-(old_w - drawn) * 1000.0 / size])], 'TJ'))
    seq += [instr([a['Tz']], 'Tz'), instr([a['Tw']], 'Tw'), instr([a['Tc']], 'Tc')]
    middle = []
    for k in range(oa + 1, ob):
        if str(ops[k][1]) in ('Tj', 'TJ', "'", '"'):
            continue
        middle.append(ops[k])
    positioned = any(str(m[1]) in ('Td', 'TD', 'Tm', 'T*') for m in middle)
    if post and positioned:
        # A positioning operator inside the span reset the pen to the start of op B; move it to where the old
        # phrase ended so the rest of op B keeps its place.
        shift = (b['x1'] - b['opx']) / b['scale']
        post = [-shift * 1000.0 / b['size'] / (b['Tz'] / 100.0)] + post
    tail = [instr([pikepdf.Array(post)], 'TJ')] if post else []
    ops = ops[:oa] + seq + middle + tail + ops[ob + 1:]
    return ops, {'oldWidthPt': round(old_w * sc, 3), 'newNaturalPt': round(nat * sc, 3), 'scalePct': round(scale, 2)}


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'dump':
        dump(sys.argv[2], int(sys.argv[3]), len(sys.argv) > 4 and sys.argv[4] == 'cells')
    elif cmd == 'apply':
        plan_path, src, dst, rep = sys.argv[2:6]
        try:
            report = apply(json.load(open(plan_path)), src, dst)
        except Refused as e:
            json.dump({'refused': str(e)}, open(rep, 'w'), indent=1)
            print('REFUSED:', e)
            sys.exit(2)
        json.dump(report, open(rep, 'w'), indent=1, ensure_ascii=False)
        print(f"{len(report['changes'])} phrases rewritten in {src}")
