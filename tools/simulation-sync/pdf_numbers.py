#!/usr/bin/env python3
"""Rewrite simulator-result numbers inside a published PDF without changing its layout.

Usage: pdf_numbers.py PLAN.json IN.pdf OUT.pdf REPORT.json

Only digit glyphs are exchanged, one for one, inside the existing text-show strings.
A rewrite is refused (exit 2, OUT not written) when it would need anything else:
a different number of characters, a sign change, a glyph missing from the embedded
subset font, or a glyph of a different advance width.
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
            return [(chr(g + 29) if 3 <= g <= 95 else '�', k * 2, 2) for k, g in enumerate(data[i] * 256 + data[i + 1] for i in range(0, len(data), 2))]
        return [(bytes([b]).decode('cp1252', 'replace'), k, 1) for k, b in enumerate(data)]

    def width(self, ch):
        if self.type0:
            g = ord(ch) - 29
            return self.widths.get(g, self.dw)
        c = ord(ch.encode('cp1252'))
        i = c - self.first
        return self.wlist[i] if 0 <= i < len(self.wlist) else 0.0

    def encode(self, ch):
        if self.type0:
            g = ord(ch) - 29
            if self.present and g not in self.present:
                raise Refused(f'glyph {ch!r} absent from {self.font.BaseFont}')
            return bytes([g >> 8, g & 255])
        b = ch.encode('cp1252')
        if self.width(ch) <= 0:
            raise Refused(f'glyph {ch!r} absent from {self.font.BaseFont}')
        return b


def page_chars(page, cache):
    """Return (ops, chars) where chars = [(op_i, part_i, offset, nbytes, ch, fontinfo)]."""
    fonts = {str(k): f for k, f in page.Resources.Font.items()} if '/Font' in page.Resources else {}
    ops = list(pikepdf.parse_content_stream(page))
    chars, current = [], None
    for oi, (operands, op) in enumerate(ops):
        o = str(op)
        if o == 'Tf':
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
            for pi, part in enumerate(parts):
                if isinstance(part, pikepdf.String):
                    dec = current.decode(bytes(part))
                    if dec is None:
                        continue
                    for ch, off, nb in dec:
                        chars.append((oi, pi, off, nb, ch, current))
    return ops, chars


def build_regex(step):
    # An anchored step (index alignment) rewrites only the number that directly follows `anchor`
    # on `page`; non-ASCII characters in the anchor (such as the >= sign) match any glyph.
    if step.get('anchor'):
        a = ''.join(re.escape(c) if ord(c) < 128 else '.' for c in step['anchor'])
        return re.compile('(?P<a>' + a + ')(?P<n>' + re.escape(step['fromText']) + r')(?!\d)(?!\.\d)')
    return re.compile(r'(?<![\d.])' + re.escape(step['fromText']) + r'(?!\d)(?!\.\d)')


def rewrite(plan, src, dst):
    steps = plan['steps']
    for s in steps:
        if len(s['fromText']) != len(s['toText']):
            raise Refused(f"{s['key']}: {s['fromText']} -> {s['toText']} changes the number of characters")
        if (s['from'] < 0) != (s['to'] < 0):
            raise Refused(f"{s['key']}: sign change is not rewritten in place")
    pdf = pikepdf.open(src)
    cache, report = {}, {'pages': len(pdf.pages), 'changes': []}
    for pno, page in enumerate(pdf.pages, 1):
        ops, chars = page_chars(page, cache)
        text = ''.join(c[4] for c in chars)
        edits = {}
        for s in steps:
            if s.get('page') and s['page'] != pno:
                continue
            for m in build_regex(s).finditer(text):
                base = m.start('n') if s.get('anchor') else m.start()
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
        if not edits:
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
