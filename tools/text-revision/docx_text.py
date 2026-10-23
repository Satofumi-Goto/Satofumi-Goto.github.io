#!/usr/bin/env python3
"""Apply a phrase plan (same JSON as pdf_text.py) to the Word master: each `old` is replaced in document order
inside word/document.xml, also when Word has split it across runs. Formatting of the first run is kept.

Usage: docx_text.py PLAN.json IN.docx OUT.docx
`page` and `extendTo` are ignored (Word reflows); `occurrence` and `count` are counted over the whole document.
"""
import json, sys, zipfile, shutil
from lxml import etree

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
XML_NS = 'http://www.w3.org/XML/1998/namespace'


def paragraphs(root):
    for p in root.iter('{%s}p' % W):
        ts = list(p.iter('{%s}t' % W))
        if ts:
            yield ts


def find_all(root, old):
    hits = []
    for ts in paragraphs(root):
        text = ''.join(t.text or '' for t in ts)
        start = 0
        while True:
            k = text.find(old, start)
            if k < 0:
                break
            hits.append((ts, k, k + len(old)))
            start = k + 1
    return hits


def replace(ts, a, b, new):
    pos = []
    for i, t in enumerate(ts):
        for j in range(len(t.text or '')):
            pos.append((i, j))
    (i0, j0), (i1, j1) = pos[a], pos[b - 1]
    if i0 == i1:
        s = ts[i0].text
        ts[i0].text = s[:j0] + new + s[j1 + 1:]
    else:
        ts[i0].text = ts[i0].text[:j0] + new
        for k in range(i0 + 1, i1):
            ts[k].text = ''
        ts[i1].text = ts[i1].text[j1 + 1:]
    for k in range(i0, i1 + 1):
        ts[k].set('{%s}space' % XML_NS, 'preserve')


def main(plan_path, src, dst):
    plan = json.load(open(plan_path))
    z = zipfile.ZipFile(src)
    root = etree.fromstring(z.read('word/document.xml'))
    # Locate every step on the original text first (like pdf_text.py), then rewrite each paragraph from the end.
    todo = {}
    for s in plan['steps']:
        hits = find_all(root, s['old'])
        if s.get('occurrence'):
            if len(hits) < s['occurrence']:
                sys.exit(f"REFUSED: {s['old']!r} occurrence {s['occurrence']} not in the Word master ({len(hits)} found)")
            hits = [hits[s['occurrence'] - 1]]
        elif len(hits) != s.get('count', 1):
            sys.exit(f"REFUSED: {s['old']!r} found {len(hits)} times in the Word master, expected {s.get('count', 1)}")
        for ts, a_, b_ in hits:
            todo.setdefault(id(ts[0]), (ts, []))[1].append((a_, b_, s['new']))
    for ts, spans in todo.values():
        spans.sort()
        for (a1, b1, _), (a2, _, _) in zip(spans, spans[1:]):
            if b1 > a2:
                sys.exit('REFUSED: two steps overlap in one paragraph')
        for a_, b_, new in reversed(spans):
            replace(ts, a_, b_, new)
    data = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, data if item.filename == 'word/document.xml' else zin.read(item.filename))
    print(f"{len(plan['steps'])} steps applied to {dst}")


if __name__ == '__main__':
    main(*sys.argv[1:4])
