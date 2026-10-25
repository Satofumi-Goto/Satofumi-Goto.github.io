#!/usr/bin/env python3
"""Change only approved phrases in independently linked top/capabilities PDF editions."""
from pathlib import Path
import hashlib, json, re
import fitz

PDFS=[
 ("top","cap","top-documents/Business_Development_Capabilities_20261013.pdf",14,"f1ce7a03f9281795582c00661fb6b0b49650541e3d7274aa139569c445ed1c62"),
 ("capabilities","cap","capabilities/documents/Business_Development_Capabilities_20261013.pdf",14,"f1ce7a03f9281795582c00661fb6b0b49650541e3d7274aa139569c445ed1c62"),
 ("top","concept","top-documents/System_Planning_Initial_Concept_20261012.pdf",30,"c0555fadae4c428eab992a1390f91fc265e76863e4c59b8ba1de99fd4253800a"),
 ("capabilities","concept","capabilities/documents/System_Planning_Initial_Concept_20261012.pdf",30,"c0555fadae4c428eab992a1390f91fc265e76863e4c59b8ba1de99fd4253800a"),
 ("top","business","top-documents/Autonomous_Mobility_Business_Model_Design.pdf",9,"df62f5cea3f9d329f67d0c6f361efdaddd6487513660246adf149ba33e2c49ab"),
 ("capabilities","business","capabilities/documents/Autonomous_Driving_Service_Business_Model_Study.pdf",9,"196f12674d7dc24f917d11ae9d58090442eda5705709ddc62267eff82e7bd591"),
 ("top","feas","top-documents/Autonomous_Mobility_System_Business_Feasibility.pdf",15,"b4ecf87b617c81590394397541995b4624a1ce02182f257cbb7887688ea3e772"),
 ("capabilities","feas","capabilities/documents/Autonomous_Mobility_System_Business_Feasibility.pdf",15,"b4ecf87b617c81590394397541995b4624a1ce02182f257cbb7887688ea3e772"),
]
OLD_CAP="ICEでは困難な扁平・低床化を狙い、FCスケートボードを構想。"
NEW_CAP="ICEでは困難な扁平・低床化を狙い、FCスケートボードを提案。"
CAP_NOTE="※掲載図表は社内資料の転載ではありません。"
OLD_CONCEPT="Proposed concept • Field validation and implementation pending"
NEW_CONCEPT="Proposed concept • Separately prepared models, not copied from Honda internal documents • Validation pending"
OLD_FEAS="This proposal defines a phased development and deployment plan for autonomous mobility business execution."
NEW_FEAS="This study outlines a phased plan using separately prepared models, not copies of Honda internal documents."
BUS_NOTE="※FCスケートボードは構想案。右側のHTS駆動系数値は目標値。"

def textwriter(page,s,font,x,y,size):
    w=fitz.TextWriter(page.rect)
    w.append(fitz.Point(x,y),s,font=font,fontsize=size)
    b=w.text_rect
    if b.x0<0 or b.x1>page.rect.width or b.y0<0 or b.y1>page.rect.height:
        raise ValueError("Text spills off page: "+repr(s)+" "+repr(b))
    page.write_text(writers=[w],overlay=True,color=(.10,.14,.20))
    return [round(b.x0,2),round(b.y0,2),round(b.x1,2),round(b.y1,2)]

def get_meiryo(doc,page,text,bold=False):
    choices=[]
    for row in page.get_fonts(full=True):
        name=row[3]
        if "Meiryo" not in name or ("Bold" in name)!=bold or row[1]!="ttf":
            continue
        try:
            info=doc.extract_font(row[0]); raw=info[3]
            if not raw:continue
            font=fitz.Font(fontbuffer=raw)
            if all(font.has_glyph(ord(c)) for c in text):
                choices.append((len(raw),font,name))
        except Exception:continue
    if not choices:raise ValueError("Source has no Meiryo font covering "+repr(text))
    choices.sort(key=lambda x:x[0])
    print("  FONT",choices[0][2],"size",choices[0][0])
    return choices[0][1]

def preserve_outside(src,dst,page_number,allowed):
    scale=.73
    before=src[page_number].get_pixmap(matrix=fitz.Matrix(scale,scale),colorspace=fitz.csGRAY,alpha=False)
    after=dst[page_number].get_pixmap(matrix=fitz.Matrix(scale,scale),colorspace=fitz.csGRAY,alpha=False)
    if before.width!=after.width or before.height!=after.height:raise ValueError("Page dimensions changed")
    outside=0;first=[]
    for y in range(before.height):
        for x in range(before.width):
            k=y*before.width+x
            if abs(before.samples[k]-after.samples[k])<=2:continue
            X=x/scale;Y=y/scale
            if not any(a-5<=X<=c+5 and b-5<=Y<=d+5 for a,b,c,d in allowed):
                outside+=1
                if len(first)<6:first.append([round(X,1),round(Y,1)])
    if outside:raise ValueError("Unexpected visual changes outside replacements p"+str(page_number+1)+" pixels="+str(outside)+" first="+repr(first))
    return True

def edit(site,kind,path,pages,expected):
    raw=Path(path).read_bytes()
    before_sha=hashlib.sha256(raw).hexdigest()
    if before_sha!=expected:raise ValueError("Source file changed unexpectedly: "+path+" sha "+before_sha)
    src=fitz.open(stream=raw,filetype="pdf")
    dst=fitz.open(stream=raw,filetype="pdf")
    if len(src)!=pages or len(dst)!=pages:raise ValueError("Page count mismatch "+path)
    target=7 if kind=="business" else 0
    p=dst[target]
    allowed=[]
    if kind=="cap":
        if p.get_text().count(OLD_CAP)!=1:raise ValueError("Cap P1 text not unique")
        # Minimal, surgical replacement of the FC skateboard sentence only.
        p.add_redact_annot(fitz.Rect(306.8,493.85,572,505.28),cross_out=False,fill=False)
        p.apply_redactions(images=0,graphics=0,text=0)
        font=get_meiryo(dst,p,NEW_CAP+CAP_NOTE)
        font_size=9.0
        while font.text_length(NEW_CAP,fontsize=font_size)>265 and font_size>8.3:font_size-=.05
        if font.text_length(NEW_CAP,fontsize=font_size)>265:raise ValueError("Cap new wording overflows original line")
        textwriter(p,NEW_CAP,font,307.13,506.34,font_size)
        # The Honda heading has an unused strip on its right, above the main title.
        font_size=7.0
        if font.text_length(CAP_NOTE,fontsize=font_size)>180:raise ValueError("Cap note too long")
        textwriter(p,CAP_NOTE,font,391.0,458.7,font_size)
        if OLD_CAP in p.get_text() or NEW_CAP not in p.get_text():raise ValueError("Cap PDF sentence not correctly replaced")
        print("CAP_NOTE_CHECK",repr(p.get_text()[-420:]),"note_fragment",("掲載図表" in p.get_text() and "転載" in p.get_text()))
        allowed=[(306.0,492.3,578.0,509.9),(385.0,447.0,579.0,460.5)]
    elif kind=="concept":
        if p.get_text().count(OLD_CONCEPT)!=1:raise ValueError("Initial concept footer not unique")
        p.add_redact_annot(fitz.Rect(20.6,813.5,214,822.4),cross_out=False,fill=False)
        p.apply_redactions(images=0,graphics=0,text=0)
        font=fitz.Font("helv")
        if font.text_length(NEW_CONCEPT,fontsize=6.69)>525:raise ValueError("Concept footer overflows")
        textwriter(p,NEW_CONCEPT,font,20.98,821.05,6.69)
        if OLD_CONCEPT in p.get_text() or NEW_CONCEPT not in p.get_text():raise ValueError("Concept footer check failed")
        allowed=[(19.5,811.8,505.0,825.0)]
    elif kind=="feas":
        if p.get_text().count(OLD_FEAS)!=1:raise ValueError("Feas P1 line not unique")
        neighbor="Today’s mobility systems fail to scale because demand, fleet, energy, and operations are still managed separately."
        if neighbor not in p.get_text():raise ValueError("Feas adjacent line missing")
        p.add_redact_annot(fitz.Rect(21.0,232.3,579.8,239.5),cross_out=False,fill=False)
        p.apply_redactions(images=0,graphics=0,text=0)
        font=fitz.Font("helv")
        if font.text_length(NEW_FEAS,fontsize=11.04)>551:raise ValueError("Feas wording overflows old row")
        textwriter(p,NEW_FEAS,font,21.24,240.3,11.04)
        if OLD_FEAS in p.get_text() or NEW_FEAS not in p.get_text() or neighbor not in p.get_text():raise ValueError("Feas P1 check failed")
        allowed=[(20.0,225.0,585,244.0)]
    else:
        # The white strip under the FC skateboard image is reserved for a short clarification.
        if BUS_NOTE in p.get_text():raise ValueError("Business model note already exists")
        clip=fitz.Rect(22,548,304,578)
        px=p.get_pixmap(matrix=fitz.Matrix(.9,.9),clip=clip,colorspace=fitz.csGRAY,alpha=False)
        dark=sum(v<180 for v in px.samples)/max(1,len(px.samples))
        print("  BLANK_BAND_DARK_RATIO",round(dark,4))
        if dark>.17:raise ValueError("Insufficient white space on original page, refusing overlay")
        font=get_meiryo(dst,p,BUS_NOTE)
        size=7.7
        if font.text_length(BUS_NOTE,fontsize=size)>280:raise ValueError("Business annotation too wide")
        textwriter(p,BUS_NOTE,font,25.8,567.0,size)
        if BUS_NOTE not in p.get_text():raise ValueError("Business annotation failed")
        allowed=[(21,551,308,576)]
    # Untouched pages: byte-level independent extraction plus raster hash.
    unchanged=0
    for i in range(pages):
        if i!=target:
            if src[i].get_text()!=dst[i].get_text():
                raise ValueError("Unrequested PDF text change page "+str(i+1))
            im0=src[i].get_pixmap(matrix=fitz.Matrix(.65,.65),colorspace=fitz.csGRAY,alpha=False)
            im1=dst[i].get_pixmap(matrix=fitz.Matrix(.65,.65),colorspace=fitz.csGRAY,alpha=False)
            if hashlib.sha256(im0.samples).digest()!=hashlib.sha256(im1.samples).digest():
                raise ValueError("Unrequested PDF raster change page "+str(i+1))
            unchanged+=1
    preserve_outside(src,dst,target,allowed)
    flat="".join(x.get_text() for x in dst)
    condensed=re.sub(r"\s+","",flat)
    for forbidden in ("トラック開発の着手につなげた","エネルギーサービス開発を後押しした"):
        if forbidden in condensed:raise ValueError("Removed-claim reappeared")
    tmp=Path(path).with_name(Path(path).stem+".edited.tmp.pdf")
    dst.save(str(tmp),garbage=4,deflate=True)
    with fitz.open(str(tmp)) as check:
        if len(check)!=pages:raise ValueError("Changed page count "+path)
        if check[target].get_text()!=dst[target].get_text():raise ValueError("Saved PDF text differed "+path)
        clip=(fitz.Rect(298,441,580,595) if kind=="cap" else
              fitz.Rect(0,799,595,835) if kind=="concept" else
              fitz.Rect(0,0,595,842) if kind=="business" else
              fitz.Rect(0,195,595,265))
        check[target].get_pixmap(matrix=fitz.Matrix(1.2,1.2),clip=clip,alpha=False).save("site-docs-verification/"+site+"-"+kind+".png")
    tmp.replace(path)
    result={"site":site,"document":kind,"path":path,"page_count":pages,"changed_original_pages":[target+1],"unchanged_pages":unchanged,"sha256_before":before_sha,"sha256_after":hashlib.sha256(Path(path).read_bytes()).hexdigest()}
    src.close();dst.close()
    print("VERIFIED",site,kind,"P"+str(target+1),"pages",pages)
    return result

if __name__=="__main__":
    Path("site-docs-verification").mkdir(exist_ok=True)
    report=[edit(*entry) for entry in PDFS]
    Path("site-docs-verification/results.json").write_text(json.dumps({"status":"PASS","records":report},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("ALL SITE DOCUMENTS VERIFIED, NO ORIGINAL OR PORTFOLIO PATHS EDITED")
