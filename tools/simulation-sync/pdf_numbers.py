#!/usr/bin/env python3
"""Rewrite simulator-result numbers inside a published PDF without changing its layout.

Usage: pdf_numbers.py PLAN.json IN.pdf OUT.pdf REPORT.json

Digit glyphs are exchanged, one for one, inside the existing text-show strings.
A number whose length or sign changes (17.200 -> 6.000, ¥28.812B -> ▲¥82.588B) is
re-encoded in place, and a TJ adjustment right after it absorbs the change in advance, so
every later glyph keeps its position. The layout gate then accepts it only as a table cell:
same start, a left-aligned column, a wide gap after it before, and still at least 1 pt after.
A rewrite is refused (exit 2, OUT not written) when a number spans several text operations,
a glyph is missing from the embedded subset font, or a same-length digit swap would change
the advance width.
"""
import io, json, re, sys
import pikepdf
from fontTools.ttLib import TTFont

DIGITS = '0123456789'


class Refused(Exception):
    pass


class FontInfo:
    def __init__(self, font):
        self.font = font
        self.type0 = str(font.Subtype) == '/Type0'
        self.widths = {}
        self.present = set()
        if self.type0:
            d = font.DescendantFonts[0]
            if str(font.get('/Encoding')) != '/Identity-H' or str(d.get('/CIDToGIDMap', '/Identity')) != '/Identity':
                raise Refused('unsupported CID font encoding: ' + str(font.BaseFont))
            dw = float(d.get('/DW', 1000))
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
            self.dw = dw
            # ToUnicode gives the real characters (▲, ¥, ≥ ...) and lets a cell gain or lose a sign.
            self.uni = {}
            tu = font.get('/ToUnicode')
            if tu is not None:
                cmap = tu.read_bytes().decode('latin1')
                for block in re.findall(r'beginbfchar(.*?)endbfchar', cmap, re.S):
                    for g, u in re.findall(r'<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4})>', block):
                        self.uni[int(g, 16)] = chr(int(u, 16))
                for block in re.findall(r'beginbfrange(.*?)endbfrange', cmap, re.S):
                    for a, b, u in re.findall(r'<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4})>', block):
                        for k in range(int(a, 16), int(b, 16) + 1):
                            self.uni[k] = chr(int(u, 16) + k - int(a, 16))
            self.gid = {u: g for g, u in self.uni.items()}
            ff = d.FontDescriptor.get('/FontFile2')
            if ff is not None:
                tt = TTFont(io.BytesIO(ff.read_bytes()))
                order, glyf = tt.getGlyphOrder(), tt['glyf']
                self.present = {g for g in range(len(order)) if glyf[order[g]].numberOfContours != 0}
        else:
            self.first = int(font.get('/FirstChar', 0))
            self.wlist = [float(x) for x in font.get('/Widths', [])]

    # Text decoding: the embedded Arial subsets keep standard glyph ids (ASCII = gid + 29).
    def decode(self, data):
        if self.type0:
            if len(data) % 2:
                return None
            return [(self.uni.get(g) or (chr(g + 29) if 3 <= g <= 95 else '�'), k * 2, 2) for k, g in enumerate(data[i] * 256 + data[i + 1] for i in range(0, len(data), 2))]
        return [(bytes([b]).decode('cp1252', 'replace'), k, 1) for k, b in enumerate(data)]

    def width(self, ch):
        if self.type0:
            g = self.gid.get(ch, ord(ch) - 29)
            return self.widths.get(g, self.dw)
        c = ord(ch.encode('cp1252'))
        i = c - self.first
        return self.wlist[i] if 0 <= i < len(self.wlist) else 0.0

    def encode(self, ch, shown=()):
        # shown: characters this font already draws on the page; a space has no outline but is real.
        if self.type0:
            g = self.gid.get(ch, ord(ch) - 29)
            if self.present and g not in self.present and ch not in shown:
                raise Refused(f'glyph {ch!r} absent from {self.font.BaseFont}')
            return bytes([g >> 8, g & 255])
        b = ch.encode('cp1252')
        if self.width(ch) <= 0:
            raise Refused(f'glyph {ch!r} absent from {self.font.BaseFont}')
        return b


def page_chars(page, cache):
    """Return (ops, chars, state) where chars = [(op_i, part_i, offset, nbytes, ch, fontinfo)]
    and state[op_i] = (font size, character spacing) in force for that text-show op."""
    fonts = {str(k): f for k, f in page.Resources.Font.items()} if '/Font' in page.Resources else {}
    ops = list(pikepdf.parse_content_stream(page))
    chars, current, state = [], None, {}
    fs, tc, stack = 1.0, 0.0, []
    for oi, (operands, op) in enumerate(ops):
        o = str(op)
        if o == 'q':
            stack.append((fs, tc))
        elif o == 'Q' and stack:
            fs, tc = stack.pop()
        elif o == 'Tc':
            tc = float(operands[0])
        if o == 'Tf':
            fs = float(operands[1])
            f = fonts.get(str(operands[0]))
            if f is not None:
                key = f.objgen
                if key not in cache:
                    cache[key] = FontInfo(f)
                current = cache[key]
            else:
                current = None
        elif o in ('Tj', 'TJ', "'", '"') and current is not None:
            parts = list(operands[0]) if o == 'TJ' else [operands[-1]]
            state[oi] = (fs, tc)
            for pi, part in enumerate(parts):
                if isinstance(part, pikepdf.String):
                    dec = current.decode(bytes(part))
                    if dec is None:
                        continue
                    for ch, off, nb in dec:
                        chars.append((oi, pi, off, nb, ch, current))
    return ops, chars, state


def build_regex(step):
    # An anchored step (index alignment) rewrites only the number that directly follows `anchor`
    # on `page`; non-ASCII characters in the anchor (such as the >= sign) match any glyph.
    if step.get('anchor'):
        a = ''.join(re.escape(c) if ord(c) < 128 else '.' for c in step['anchor'])
        return re.compile('(?P<a>' + a + ')(?P<n>' + re.escape(step['fromText']) + r')(?!\d)(?!\.\d)')
    # sign: 'neg' rewrites only a number directly preceded by a minus sign (▲, −, -, optionally then ¥); 'pos' only one
    # without it. Used when the same digits are shown for a negative and a positive value. after: text that must follow.
    sign = ''
    if step.get('sign') == 'neg':
        sign = r'(?:(?<=[▲−-])|(?<=[▲−-]¥)|(?<=[▲−-] ¥))'
    elif step.get('sign') == 'pos':
        sign = r'(?<![▲−-])(?<![▲−-]¥)(?<![▲−-] ¥)'
    after = '(?=' + re.escape(step['after']) + ')' if step.get('after') else ''
    return re.compile(sign + r'(?<![\d.])' + re.escape(step['fromText']) + r'(?!\d)(?!\.\d)' + after)


def find_replacements(text, steps, pno):
    """All rewrites on one page, matched against the original text: [(start, end, toText, step)]."""
    out = []
    for s in steps:
        if s.get('page') and s['page'] != pno:
            continue
        flip = (s['from'] < 0) != (s['to'] < 0)
        for m in build_regex(s).finditer(text):
            base = m.start('n') if s.get('anchor') else m.start()
            start, to = base, s['toText']
            if flip:
                # The sign travels with the number: ▲¥28.812B <-> ¥82.588B. The marker follows
                # the page's own convention for negatives.
                yen = start > 0 and text[start - 1] == '¥'
                if yen:
                    start -= 1
                if s['to'] < 0:
                    to = ('▲' if '▲' in text else '-') + ('¥' if yen else '') + to
                else:
                    if start == 0 or text[start - 1] not in '▲−-':
                        continue
                    start -= 1
                    to = ('¥' if yen else '') + to
            end = base + len(s['fromText'])
            # A label that belongs to the old value (PAYBACK) leaves with it; a new one is added.
            # The label sits after the unit (¥28.812B PAYBACK), so the unit is carried over.
            if s.get('dropAfter') or s.get('addAfter'):
                m2 = re.compile(r'(B|%)?' + re.escape(s.get('dropAfter', ''))).match(text, end)
                if m2 and (s.get('dropAfter') is None or m2.group(0).endswith(s['dropAfter'])):
                    end = m2.end()
                    to += (m2.group(1) or '') + s.get('addAfter', '')
            out.append((start, end, to, s))
    out.sort(key=lambda r: r[0])
    for a, b in zip(out, out[1:]):
        if b[0] < a[1]:
            raise Refused(f"page {pno}: overlapping rewrites {a[3]['key']} and {b[3]['key']}")
    return out


def apply_replacements(text, reps):
    for start, end, to, _ in sorted(reps, key=lambda r: -r[0]):
        text = text[:start] + to + text[end:]
    return text


def rewrite(plan, src, dst):
    steps = plan['steps']
    pdf = pikepdf.open(src)
    cache, report = {}, {'pages': len(pdf.pages), 'changes': []}
    for pno, page in enumerate(pdf.pages, 1):
        ops, chars, state = page_chars(page, cache)
        text = ''.join(c[4] for c in chars)
        edits, cells = {}, {}
        for base, end, to, s in find_replacements(text, steps, pno):
            if end - base != len(to):
                oi = chars[base][0]
                if any(chars[k][0] != oi for k in range(base, end)) or str(ops[oi][1]) not in ('Tj', 'TJ'):
                    raise Refused(f"page {pno}: {s['key']}: {s['fromText']} -> {to} spans several text operations")
                cells.setdefault(oi, []).append((base, end, to))
                report['changes'].append({'page': pno, 'key': s['key'], 'from': s['fromText'], 'to': to, 'index': base, 'cell': True})
                continue
            for k, (a, b) in enumerate(zip(s['fromText'], s['toText'])):
                idx = base + k
                if a == b:
                    continue
                fi = chars[idx][5]
                if fi.width(a) != fi.width(b):
                    raise Refused(f'page {pno}: {a!r}->{b!r} width differs in {fi.font.BaseFont}')
                if idx in edits and edits[idx] != b:
                    raise Refused(f'page {pno}: overlapping rewrites at {idx}')
                edits[idx] = b
            report['changes'].append({'page': pno, 'key': s['key'], 'from': s['fromText'], 'to': s['toText'], 'index': base})
        if not edits and not cells:
            continue
        # Apply byte edits per text string.
        by_part = {}
        for idx, ch in edits.items():
            oi, pi, off, nb, old, fi = chars[idx]
            by_part.setdefault((oi, pi), []).append((off, nb, fi.encode(ch)))
        for (oi, pi), items in by_part.items():
            operands, op = ops[oi]
            o = str(op)
            container = list(operands[0]) if o == 'TJ' else None
            target = container[pi] if container is not None else operands[-1]
            data = bytearray(bytes(target))
            for off, nb, enc in items:
                assert len(enc) == nb
                data[off:off + nb] = enc
            new = pikepdf.String(bytes(data))
            if container is not None:
                container[pi] = new
                operands = [pikepdf.Array(container)] + list(operands[1:])
            else:
                operands = list(operands[:-1]) + [new]
            ops[oi] = pikepdf.ContentStreamInstruction(operands, op)
        # A number that changes length is re-encoded in place, and a TJ adjustment right after it
        # absorbs the difference in advance, so every glyph after it keeps its position.
        for oi, reps in cells.items():
            fs, tc = state[oi]
            operands, op = ops[oi]
            items = list(operands[0]) if str(op) == 'TJ' else [operands[-1]]
            for base, end, to in sorted(reps, key=lambda r: -r[0]):
                span = chars[base:end]
                fi = span[0][5]
                if any(c[5] is not fi for c in span):
                    raise Refused(f'page {pno}: {to}: the number mixes fonts')
                pf, pl = span[0][1], span[-1][1]
                shown = {c[4] for c in chars if c[5] is fi}
                try:
                    enc = b''.join(fi.encode(ch, shown) for ch in to)
                except Refused as e:
                    raise Refused(f'page {pno}: {to}: {e}')
                old = sum(fi.width(c[4]) / 1000 * fs + tc for c in span)
                old -= sum(float(x) / 1000 * fs for x in items[pf:pl + 1] if not isinstance(x, pikepdf.String))
                new = sum(fi.width(ch) / 1000 * fs + tc for ch in to)
                comp = round((new - old) * 1000 / fs, 4)
                merged = bytes(items[pf])[:span[0][2]] + enc + bytes(items[pl])[span[-1][2] + span[-1][3]:]
                tail = items[pl + 1:]
                if comp:
                    if tail and not isinstance(tail[0], pikepdf.String):
                        tail = [round(float(tail[0]) + comp, 4)] + tail[1:]
                    else:
                        tail = [comp] + tail
                items = items[:pf] + [pikepdf.String(merged)] + tail
            ops[oi] = pikepdf.ContentStreamInstruction([pikepdf.Array(items)], pikepdf.Operator('TJ'))
        page.Contents = pdf.make_stream(pikepdf.unparse_content_stream(ops))
    pdf.save(dst)
    return report


if __name__ == '__main__':
    plan_path, src, dst, rep = sys.argv[1:5]
    try:
        report = rewrite(json.load(open(plan_path)), src, dst)
    except Refused as e:
        json.dump({'refused': str(e)}, open(rep, 'w'), indent=1)
        print('REFUSED:', e)
        sys.exit(2)
    json.dump(report, open(rep, 'w'), indent=1)
    print(f"{len(report['changes'])} number occurrences rewritten in {src}")
