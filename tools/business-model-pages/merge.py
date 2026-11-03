import sys,io,pdfplumber
from pypdf import PdfReader,PdfWriter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(TTFont('LS','/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'))
pdfmetrics.registerFont(TTFont('LSB','/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'))
src,dst=sys.argv[1],sys.argv[2]
new=[PdfReader('out/%s.pdf'%n).pages[0] for n in 'abc']
# new page number for each original page index (1-based)
newnum={1:1,2:2,3:3,4:5,5:6,6:7,7:9,8:10,9:11}
rd=PdfReader(src); w=PdfWriter()
with pdfplumber.open(src) as pl:
  for i,page in enumerate(rd.pages,1):
    pp=pl.pages[i-1]; H=float(pp.height)
    mb=page.mediabox; ox,oy=float(mb.left),float(mb.bottom)
    ch=sorted([c for c in pp.chars if c['top']>825 and c['size']>7 and c['x0']>520 and c['text'] in 'Page0123456789/ '],key=lambda c:c['x0'])
    assert any(c['text']=='P' for c in ch), i
    for c_ in ch: c_['base']=c_['matrix'][5]
    ref=max([c_ for c_ in ch if c_['text']=='P'],key=lambda c_:c_['size'])
    bold='Bold' in ref['fontname']; size=ref['size']; col=ref['non_stroking_color'] or (0,)
    col=tuple(col) if isinstance(col,(list,tuple)) else (col,)
    rgb=(col[0],)*3 if len(col)==1 else (col[:3] if len(col)==3 else (0,0,0))
    label='Page %d/12'%newnum[i]; fn='LSB' if bold else 'LS'
    x1=max(c_['x1'] for c_ in ch); tw=pdfmetrics.stringWidth(label,fn,size)
    lo=min(c_['base']-0.22*c_['size'] for c_ in ch); hi=min(max(c_['base']+0.74*c_['size'] for c_ in ch), ref['base']+0.74*ref['size'])
    lx=min(min(c_['x0'] for c_ in ch), x1-tw); pad=0.5
    buf=io.BytesIO(); c=canvas.Canvas(buf,pagesize=(float(mb.width),float(mb.height)))
    c.setFillColorRGB(1,1,1)
    c.rect(lx-pad, lo-pad, x1-lx+2*pad, hi-lo+2*pad, fill=1, stroke=0)
    c.setFillColorRGB(*rgb); c.setFont(fn,size)
    c.drawRightString(x1, ref['base'], label)
    print(i, round(lo,2), round(hi,2), round(lx,1), round(x1,1), fn, size, rgb)
    c.save(); buf.seek(0)
    ov=PdfReader(buf).pages[0]
    page.merge_transformed_page(ov,[1,0,0,1,0,0])
    w.add_page(page)
    if i in (3,6,9):
        np=new[(i//3)-1]
        np.mediabox.upper_right=(float(mb.right),float(mb.top))
        w.add_page(np)
w.write(dst)
print(dst,len(w.pages))
