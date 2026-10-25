#!/usr/bin/env python3
# Portfolio-only surgical PDF updates; never edit shared PDF originals.
from pathlib import Path
import fitz,hashlib,json,sys

DOCS=[
 ("portfolio/documents/Business_Development_Capabilities_Portfolio.pdf",14,"cap"),
 ("portfolio/documents/System_Planning_Initial_Concept_Portfolio.pdf",30,"initial"),
 ("portfolio/documents/Autonomous_Driving_Service_Business_Model_Portfolio.pdf",9,"business"),
 ("portfolio/documents/Autonomous_Mobility_System_Business_Feasibility_Portfolio.pdf",15,"feasibility"),
]
EXPECTED={
 "cap":"809745d4115aa28b8cce03a74f6dcc8241d0f2b9ff94c9731eaf14a02c0bd622",
 "initial":"fce5901030118f8ba78998400438853793d11adbac200c9b43b414e498726afc",
 "business":"b14eedc130804f2d8d136e832cba7e757b369a3798485b12460d1f9f95a1b1e6",
 "feasibility":"ea4c0beb5f4038beadf7e71ba37153c185c2b6341c523a41fe4fef5c746bb3a7",
}

CAP_OLD="ICEでは困難な扁平・低床化を狙い、FCスケートボードを構想。"
CAP_NEW="ICEでは困難な扁平・低床化を狙い、FCスケートボードを検討・提案。"
CAP_NOTE="※掲載図表は社内資料の転載ではない"
INITIAL_OLD="Proposed concept • Field validation and implementation pending"
INITIAL_NEW="Proposed concept • Separately prepared models, not copied from Honda internal documents • Validation pending"
FEAS_OLD="This proposal defines a phased development and deployment plan for autonomous mobility business execution."
FEAS_NEW="This study presents a proposed phased plan using separately prepared models, not Honda internal documents."
BUS_NOTE="※FCスケートボードは構想案。右のHTS駆動系数値は目標値。"

def find_font(doc,page,txt,bold=False):
    pool=[]
    for entry in page.get_fonts(full=True):
        if "Meiryo" not in entry[3] or ("Bold" in entry[3])!=bold or entry[1]!="ttf":
            continue
        try:
            name,ext,typ,buffer=doc.extract_font(entry[0])
            if not buffer:continue
            font=fitz.Font(fontbuffer=buffer)
            if all(font.has_glyph(ord(c)) for c in txt):
                pool.append((len(buffer),font,name))
        except Exception:
            continue
    if not pool:raise RuntimeError("Suitable embedded Meiryo not found")
    pool.sort(key=lambda a:a[0])
    print("FONT",pool[0][2],"size",pool[0][0])
    return pool[0][1]

def append_text(page, text, point, font, fontsize):
    w=fitz.TextWriter(page.rect)
    w.append(fitz.Point(point),text,font=font,fontsize=fontsize)
    rect=w.text_rect
    if rect.x0<-3 or rect.x1>page.rect.width+3 or rect.y0<-3 or rect.y1>page.rect.height+3:
        raise RuntimeError("Text out of page "+repr(text)+" "+str(rect))
    page.write_text(writers=[w],overlay=True,color=(0.10,0.13,0.17))
    return [round(x,2) for x in rect]

def redact_text(page, text, rect):
    if page.get_text().count(text)!=1:raise RuntimeError("Original text not unique: "+text)
    page.add_redact_annot(fitz.Rect(rect),cross_out=False,fill=False)
    page.apply_redactions(images=0,graphics=0,text=0)
    if text in page.get_text():raise RuntimeError("Old text remains: "+text)

def diff_pages(old,new,edited):
    unchanged=0
    for i in range(len(new)):
        before=old[i+1].get_pixmap(matrix=fitz.Matrix(.68,.68),colorspace=fitz.csGRAY,alpha=False)
        after=new[i].get_pixmap(matrix=fitz.Matrix(.68,.68),colorspace=fitz.csGRAY,alpha=False)
        if before.width!=after.width or before.height!=after.height:raise RuntimeError("Page dimensions changed")
        if i not in edited:
            if hashlib.sha256(before.samples).digest()!=hashlib.sha256(after.samples).digest():
                raise RuntimeError("Unmodified page visual change: "+str(i+1))
            unchanged+=1
            continue
        boxes=edited[i]
        bad=0;first=[]
        for y in range(before.height):
            for x in range(before.width):
                at=y*before.width+x
                if abs(before.samples[at]-after.samples[at])<=2:continue
                px=x/.68;py=y/.68
                if not any(r[0]-6<=px<=r[2]+6 and r[1]-6<=py<=r[3]+6 for r in boxes):
                    bad+=1
                    if len(first)<10:first.append((round(px,1),round(py,1)))
        if bad>0:raise RuntimeError("Unexpected pixels outside approved zone p"+str(i+1)+" bad="+str(bad)+" "+str(first))
    return unchanged

def process(path,orig_count,kind):
    path=Path(path)
    got=hashlib.sha256(path.read_bytes()).hexdigest()
    if got!=EXPECTED[kind]:raise RuntimeError("Input PDF changed, stop: "+str(path)+" sha="+got)
    old=fitz.open(str(path))
    if len(old)!=orig_count+1:raise RuntimeError("Unexpected page count "+str(path))
    cover=old[0].get_text()
    if "PORTFOLIO" not in cover:raise RuntimeError("Page 1 is not the added cover!")
    out=fitz.open(str(path));out.delete_page(0)
    if len(out)!=orig_count:raise RuntimeError("Page count lost during cover removal")
    beforeText=[old[i+1].get_text() for i in range(orig_count)]
    edited={}
    if kind=="cap":
        page=out[0];font=find_font(out,page,CAP_NEW+CAP_NOTE,False)
        otherLine="短時間補給とバッテリー依存低減でBEVの稼働率・積載率制約を"
        if otherLine not in page.get_text():raise RuntimeError("Cap following line not found")
        redact_text(page,CAP_OLD,(306.85,493.90,572.0,505.29))
        size=9
        while font.text_length(CAP_NEW,fontsize=size)>265.0 and size>8:
            size-=.1
        bbox=append_text(page,CAP_NEW,(307.13,506.35),font,size)
        if otherLine not in page.get_text():raise RuntimeError("Cap following line damaged")
        # Small clarification in empty right area of Honda heading.
        note_size=7.05
        if font.text_length(CAP_NOTE,fontsize=note_size)>138:raise RuntimeError("Cap note too wide")
        note_bbox=append_text(page,CAP_NOTE,(451.9,489.4),font,note_size)
        if not (CAP_NEW in page.get_text() and CAP_NOTE in page.get_text()):
            raise RuntimeError("Cap replacement not text-searchable")
        edited[0]=[(306.0,492.5,580.5,510.0),(446.0,474.5,594,494)]
    elif kind=="initial":
        page=out[0]
        redact_text(page,INITIAL_OLD,(20.7,813.6,540.0,821.95))
        b=append_text(page,INITIAL_NEW,(20.98,821.18),fitz.Font("helv"),6.69)
        if INITIAL_NEW not in page.get_text():raise RuntimeError("Initial footer not text-searchable")
        edited[0]=[(19.5,811.0,541.0,825.0)]
    elif kind=="feasibility":
        page=out[0]
        following="Today’s mobility systems fail to scale because demand, fleet, energy, and operations are still managed separately."
        if following not in page.get_text():raise RuntimeError("Feas following line missing")
        redact_text(page,FEAS_OLD,(21.0,227.35,580.0,239.50))
        font=fitz.Font("helv")
        if font.text_length(FEAS_NEW,fontsize=11.04)>549:
            raise RuntimeError("Feas text wider than source")
        append_text(page,FEAS_NEW,(21.24,240.3),font,11.04)
        if FEAS_NEW not in page.get_text() or following not in page.get_text():raise RuntimeError("Feas text damaged")
        edited[0]=[(20.0,225.0,585.0,244.0)]
    elif kind=="business":
        page=out[7]
        font=find_font(out,page,BUS_NOTE,False)
        size=7.8
        while font.text_length(BUS_NOTE,fontsize=size)>265 and size>6.5:
            size-=.1
        # The reserved white band is directly beneath the FC skateboard illustration.
        clip=fitz.Rect(25,544,304,570)
        pix=page.get_pixmap(matrix=fitz.Matrix(1,1),clip=clip,colorspace=fitz.csGRAY,alpha=False)
        dark=sum(v<185 for v in pix.samples)
        ratio=dark/len(pix.samples)
        print("BUS_BAND_DARK_RATIO",round(ratio,4))
        if ratio>.09:raise RuntimeError("No blank room for the note; refuse overlay")
        rect=append_text(page,BUS_NOTE,(25.8,561.0),font,size)
        if BUS_NOTE not in page.get_text():raise RuntimeError("Business model note missing")
        edited[7]=[(22.0,543.0,307.0,567.0)]
    assert len(edited)==1
    alltext="\n".join(p.get_text() for p in out)
    for prohibited in ("トラック開発の着手につなげた","エネルギーサービス開発を後押しした"):
        if prohibited in alltext.replace("\n",""):raise RuntimeError("Prohibited achievement text still in PDF")
    # All original text remains identical on untouched pages.
    for i in range(orig_count):
        if i not in edited and out[i].get_text()!=beforeText[i]:
            raise RuntimeError("Untouched page text modified "+str(i+1))
    visual_unchanged=diff_pages(old,out,edited)
    tmp=path.with_suffix(".approved.tmp.pdf")
    out.save(str(tmp),garbage=4,deflate=True)
    with fitz.open(str(tmp)) as check:
        if len(check)!=orig_count or "PORTFOLIO /" in check[0].get_text():raise RuntimeError("New cover/page count invalid")
        if kind=="cap":
            check[0].get_pixmap(matrix=fitz.Matrix(1.4,1.4),alpha=False).save("portfolio/_approved_preview_cap_p1.png")
        if kind=="initial":
            check[0].get_pixmap(matrix=fitz.Matrix(1.15,1.15),clip=fitz.Rect(0,778,595,842)).save("portfolio/_approved_preview_initial_p1.png")
        if kind=="business":
            check[7].get_pixmap(matrix=fitz.Matrix(1.4,1.4),alpha=False).save("portfolio/_approved_preview_business_p8.png")
        if kind=="feasibility":
            check[0].get_pixmap(matrix=fitz.Matrix(1.15,1.15),clip=fitz.Rect(0,180,595,282)).save("portfolio/_approved_preview_feas_p1.png")
    tmp.replace(path)
    report={"path":str(path),"pages_before":len(old),"pages_after":orig_count,
            "removed_extra_cover":True,"modified_original_pages":[i+1 for i in edited],
            "unchanged_original_pages":visual_unchanged,"sha256_source":got,
            "sha256_final":hashlib.sha256(path.read_bytes()).hexdigest()}
    old.close();out.close()
    print("PASS",json.dumps(report,ensure_ascii=False))
    return report

def inspect_latest():
    report=[]
    for path,count,kind in DOCS:
        d=fitz.open(path)
        source_digest=hashlib.sha256(Path(path).read_bytes()).hexdigest()
        print("AUDIT",kind,path,"PAGES",len(d),"sha256",source_digest)
        indexes=[0,7] if kind=="business" else [0]
        for i in indexes:
            if i>=len(d):continue
            txt=d[i].get_text("text",sort=True)
            print("PAGE",kind,i+1,"TEXT_BEGIN")
            for j,line in enumerate(txt.splitlines()):
                if kind=="cap" and (i!=0 or (j<10 or "スケート" in line or "Honda" in line or "資料" in line or "転載" in line)):print(j+1,repr(line))
                elif kind=="initial" and (j<6 or "Proposed concept" in line or "Portfolio study" in line or "Honda" in line):print(j+1,repr(line))
                elif kind=="feasibility" and (j<22 or "propos" in line.lower() or "Honda" in line):print(j+1,repr(line))
                elif kind=="business" and ("FCスケート" in line or "HTS" in line or "目標" in line or "構想" in line or "検討案" in line):print(j+1,repr(line))
            print("PAGE",kind,i+1,"TEXT_END")
        if kind=="cap":
            d[0].get_pixmap(matrix=fitz.Matrix(1.1,1.1),alpha=False).save("portfolio/_approved_preview_cap_p1.png")
        if kind=="initial":
            d[0].get_pixmap(matrix=fitz.Matrix(1.0,1.0),clip=fitz.Rect(0,782,595,842)).save("portfolio/_approved_preview_initial_p1.png")
        if kind=="business":
            d[7].get_pixmap(matrix=fitz.Matrix(1.1,1.1),alpha=False).save("portfolio/_approved_preview_business_p8.png")
        if kind=="feasibility":
            d[0].get_pixmap(matrix=fitz.Matrix(1.0,1.0),clip=fitz.Rect(0,180,595,285)).save("portfolio/_approved_preview_feas_p1.png")
        report.append({"file":path,"current_pages":len(d),"expected_base_pages":count,"sha256":source_digest})
    Path("portfolio/_approved_pdf_verification.json").write_text(json.dumps({"status":"AUDITED_NOT_EDITED","documents":report},ensure_ascii=False,indent=2),encoding="utf-8")
    print("AUDIT COMPLETE")

if __name__=="__main__":
    inspect_latest()
