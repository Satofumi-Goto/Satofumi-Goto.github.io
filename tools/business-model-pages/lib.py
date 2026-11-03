import base64, pathlib, re, subprocess
B = pathlib.Path('/home/claude/bm2')
ICONS = B / 'lucide/icons'
FIT = (pathlib.Path('/home/claude/bmpages/fit.js')).read_text()

def ic(name, cls='ic'):
    s = (ICONS / f'{name}.svg').read_text()
    s = re.sub(r'\s+', ' ', s).replace('width="24" height="24"', '').strip()
    s = s.replace('<svg ', '<svg aria-hidden="true" ')
    return f'<span class="{cls}">{s}</span>'

def img(name):
    data = base64.b64encode((B / 'src' / f'{name}.jpg').read_bytes()).decode()
    return f'data:image/jpeg;base64,{data}'

def page(key, title, theme, h1, lead, body, msg, pg):
    css = (B / 'style.css').read_text()
    head = (f'<title>{title}</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap">\n'
            f'<style>\n{css}</style>\n')
    sheet = f'''<div class="fit"><div class="sheet">
<div class="hd"><span>ポートフォリオ</span><span class="theme">{theme}</span><span class="au">後藤悟文</span></div>
<h1><span class="k">Business Model</span>｜{h1}</h1>
<p class="lead">{lead}</p>
{body}
<div class="pg">Page {pg}/12</div>
</div></div>
<script>
{FIT}</script>
'''
    out = B / 'out'; out.mkdir(exist_ok=True)
    (out / f'{key}.html').write_text(head + sheet)
    (out / f'{key}_local.html').write_text('<!doctype html><html lang="ja"><head><meta charset="utf-8">' + head + '</head><body>' + sheet + '</body></html>')
    subprocess.run(['google-chrome', '--headless=new', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer',
                    '--virtual-time-budget=4000', f'--print-to-pdf={out}/{key}.pdf', f'{out}/{key}_local.html'],
                   stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
    subprocess.run(['pdftoppm', '-r', '110', '-png', '-singlefile', f'{out}/{key}.pdf', f'{out}/{key}'], stderr=subprocess.DEVNULL)
    pages = subprocess.run(['pdfinfo', f'{out}/{key}.pdf'], capture_output=True, text=True).stdout
    print(key, [l for l in pages.splitlines() if l.startswith('Pages')])

def sic(name, x, y, size, color='#fff', sw=2):
    s = (ICONS / f'{name}.svg').read_text()
    inner = s[s.index('>', s.index('<svg')) + 1: s.rindex('</svg>')]
    return (f'<svg x="{x}" y="{y}" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="{color}" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round">{inner}</svg>')

def pill(cx, cy, text, color, w=None, fs=9):
    w = w or (len(text) * fs * 0.98 + 14)
    return (f'<rect x="{cx-w/2:.1f}" y="{cy-8:.1f}" width="{w:.1f}" height="16" rx="8" fill="#fff" stroke="{color}" stroke-width="1.2"/>'
            f'<text x="{cx:.1f}" y="{cy+3.2:.1f}" font-size="{fs}" font-weight="700" fill="{color}" text-anchor="middle">{text}</text>')

MARKERS = ''.join(f'<marker id="m{k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="{c}"/></marker>'
                  for k, c in dict(b='#1d6cc4', g='#1b7a3a', o='#d9670a', n='#0b2a6b', r='#c4262e').items())
