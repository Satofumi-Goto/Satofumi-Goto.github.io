#!/usr/bin/env python3
"""Portfolio-only PDF editions; shared source files are never modified."""
import fitz, hashlib, json, re, sys
from pathlib import Path

FILES=[
("capabilities/Business_Development_Capabilities_20261013.pdf","portfolio/documents/Business_Development_Capabilities_Portfolio.pdf","ケーパビリティ｜自動運転×コネクティッドの事業開発",True),
("capabilities/System_Planning_Initial_Concept_20261012.pdf","portfolio/documents/System_Planning_Initial_Concept_Portfolio.pdf","System Planning - Initial Concept",False),
("capabilities/Autonomous_Driving_Service_Business_Model_Study.pdf","portfolio/documents/Autonomous_Driving_Service_Business_Model_Portfolio.pdf","自動運転サービスの事業検討",True),
("Autonomous_Mobility_System_Business_Feasibility.pdf","portfolio/documents/Autonomous_Mobility_System_Business_Feasibility_Portfolio.pdf","Autonomous Mobility Business Feasibility",False)]
INK=(.09,.16,.23);ACC=(.03,.40,.44);MUTED=(.31,.37,.42);BG=(.967,.98,.985)

def place(page,rect,text,size,font,colour=INK):
    x=size
    while x>=size*.70:
        spare=page.insert_textbox(rect,text,fontname=font,fontsize=x,color=colour,lineheight=1.28)
        if spare >= -0.01:return
        x-=.25
    raise RuntimeError("Cover text overflow: "+text[:110])

def render_line(page, left, baseline, sentence, fontsize, right, script='japan'):
    f = fitz.Font(script)
    while f.text_length(sentence, fontsize=fontsize) > right-left:
        fontsize -= .15
        if fontsize < 8.0:
            raise RuntimeError("Text exceeds available width: " + sentence)
    page.insert_text(fitz.Point(left, baseline), sentence,
                     fontname=script, fontsize=fontsize, color=(.06,.12,.18))
    return round(fontsize, 2)

def cover(doc,title,japanese):
    W,H=doc[0].rect.width,doc[0].rect.height
    landscape=W>H
    s=min(W/(960 if landscape else 595),H/(540 if landscape else 842))
    x=45*s
    r=W-x
    p=doc.new_page(pno=0,width=W,height=H)
    p.draw_rect(fitz.Rect(0,0,W,H),fill=BG,color=BG)
    p.draw_rect(fitz.Rect(0,0,W,7*s),fill=ACC,color=ACC)
    jpfont='japan';enfont='helv'
    p.insert_text((x,40*s if landscape else 54*s),
        "PORTFOLIO / 掲載内容の位置づけ" if japanese else "PORTFOLIO / STATUS OF THE CONTENT",
        fontname=jpfont if japanese else enfont,fontsize=11*s,color=ACC)
    if landscape:
        titleR=fitz.Rect(x,66*s,r,150*s)
        descR=fitz.Rect(x,160*s,r,203*s)
        lineY=215*s
        scopeR=fitz.Rect(x,233*s,r,330*s)
        noteR=fitz.Rect(x,341*s,r,441*s)
        foot=503*s
    else:
        titleR=fitz.Rect(x,84*s,r,196*s)
        descR=fitz.Rect(x,208*s,r,259*s)
        lineY=286*s
        scopeR=fitz.Rect(x,309*s,r,479*s)
        noteR=fitz.Rect(x,505*s,r,685*s)
        foot=785*s
    f=jpfont if japanese else enfont
    place(p,titleR,title,26*s,f)
    desc=("本書は公開上の位置づけを明示した /portfolio 専用版です。元資料の技術内容及び職務経験の説明は維持しています。"
          if japanese else
          "This portfolio-only edition clarifies publication status while retaining technical material and professional experience.")
    place(p,descR,desc,12.4*s,f,MUTED)
    p.draw_line(fitz.Point(x,lineY),fitz.Point(r,lineY),color=(.83,.88,.90),width=1.2*s)
    if japanese:
        scope=("FCスケートボードは、自動運転モビリティの事業成立条件を検討するための車両構想の一例として示したものであり、Hondaによる正式な採用、製品化方針の決定又は開発着手を示すものではありません。")
        note=("FCAD-MaaSに関連する車両・運用基盤・サービス拠点の一体的な検討は、自動運転事業を成立させるための構想及び検討内容を説明するものです。Hondaとして当該構想全体を正式に採用・承認し、実行又は開発着手を決定したことを示すものではありません。\n"
              "本書は、過去の活動の業務該当性又は知的財産権の帰属を確定するものではありません。")
    else:
        scope=("The FC skateboard is shown as an example vehicle concept for examining autonomous-mobility business viability. It does not indicate Honda's formal adoption, a product decision, or commencement of development.")
        note=("The integrated examination of FCAD-MaaS vehicles, operating platforms and service hubs describes business-viability concepts. It does not indicate Honda's formal approval, adoption, decision to implement, or commencement of development.\n"
              "This publication does not determine whether past activities were company work or self-development, or the ownership of intellectual property.")
    place(p,scopeR,scope,11.6*s if landscape else 11.2*s,f)
    place(p,noteR,note,11*s if landscape else 10.8*s,f,MUTED)
    p.draw_line(fitz.Point(x,foot-20*s),fitz.Point(r,foot-20*s),color=(.83,.88,.90),width=s)
    p.insert_text((x,foot),"Satofumi Goto  |  Portfolio publication note  |  2026-10-25",fontname="helv",fontsize=9*s,color=MUTED)
    full=p.get_text()
    if not full:raise RuntimeError("Cover rendering was blank")
    for wrong in ("INDEPENDENT STUDY","個人の自主検討","個人提案","私案"):
        if wrong in full:raise RuntimeError("Outdated work-classification text on cover: "+wrong)

def in_page_revisions(doc, source):
    revised_pages = []
    if "Business_Development_Capabilities_" in source:
        p = doc[0]
        before = p.get_text()
        if "進める必要があり、統合化・事業化の課題が残った。" not in before:
            raise RuntimeError("Capability page changed")
        p.add_redact_annot(fitz.Rect(306.1,563.0,574.5,583.7), fill=False)
        p.apply_redactions(images=0, graphics=0, text=0)
        render_line(p,307.13,569.93,
            "を狙った。FCAD-MaaSの車両・運用基盤・拠点の検討は、",9.0,574.0)
        render_line(p,307.13,580.97,
            "Hondaの正式採用・承認・開発着手を示すものではない。",9.0,574.0)
        if "FCスケートボードを構想。" not in p.get_text():
            raise RuntimeError("Core vehicle concept was lost")
        revised_pages.append(1)
    if "Business_Model_Study.pdf" in source:
        p = doc[7]
        p.add_redact_annot(fitz.Rect(100.5,377,211,391.6), fill=False)
        p.apply_redactions(images=0, graphics=0, text=0)
        render_line(p,101.37,389.2,"FCスケートボード（構想例）",12.4,302.0)
        if "（構想例）" not in p.get_text():
            raise RuntimeError("Concept label missing")
        revised_pages.append(8)
    if source == "Autonomous_Mobility_System_Business_Feasibility.pdf":
        page = doc[14]
        if "independently constructed models" not in page.get_text():
            raise RuntimeError("Feasibility closing note changed")
        page.add_redact_annot(fitz.Rect(13.7,796.8,583.1,820.8),fill=False)
        page.apply_redactions(images=0,graphics=0,text=0)
        sentences = [
            "This study presents technical and business scenarios; assumptions and results require validation.",
            "It does not indicate formal approval, adoption or development commencement by Honda or other employers.",
            "Past work classification and intellectual-property ownership are not determined by this publication."
        ]
        for line,y in zip(sentences,(801.4,811.35,821.3)):
            render_line(page,14.16,y,line,9.48,580.0,"helv")
        if "independently constructed models" in page.get_text():
            raise RuntimeError("Unqualified ownership statement was not removed")
        revised_pages.append(15)
    return revised_pages

def geometry_probe():
    focus={
        "capabilities/Business_Development_Capabilities_20261013.pdf":[0],
        "capabilities/Autonomous_Driving_Service_Business_Model_Study.pdf":[2,5,7],
        "Autonomous_Mobility_System_Business_Feasibility.pdf":[1,10,11],
        "capabilities/System_Planning_Initial_Concept_20261012.pdf":[13,14]
    }
    report=[]
    for filename,pages in focus.items():
        with fitz.open(filename) as d:
            for page_no in pages:
                pg=d[page_no]
                raw=pg.get_text("dict")
                blocks=[]
                for bi,b in enumerate(raw["blocks"]):
                    if "lines" not in b:continue
                    for line in b["lines"]:
                        spans=[]
                        for span in line.get("spans",[]):
                            text=span.get("text","")
                            if text.strip():
                                spans.append({"text":text,"rect":list(map(lambda x:round(x,2),span["bbox"])),
                                              "font":span.get("font"),"size":span.get("size")})
                        if spans:blocks.append({"block":bi,"bbox":list(map(lambda x:round(x,2),line["bbox"])),"spans":spans})
                report.append({"filename":filename,"page":page_no+1,"rect":list(pg.rect),"lines":blocks})
    Path("portfolio/_temporary_layout_probe.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print("Captured layout",len(report))

def apply():
    plan=json.loads(Path("portfolio/safe-doc-plan.json").read_text())
    if plan.get("scope")!="portfolio-only":raise RuntimeError("Wrong scope")
    report=[]
    for src,dst,title,japanese in FILES:
        data=Path(src).read_bytes()
        digest=hashlib.sha256(data).hexdigest()
        if plan["expected_sha256"].get(src)!=digest:raise RuntimeError("Source changed: "+src)
        original=fitz.open(src);modified=fitz.open(src)
        plain=re.sub(r"\s+","",''.join(p.get_text("text") for p in original))
        for prohibited in ("トラック開発の着手につなげた","エネルギーサービス開発を後押しした"):
            if prohibited in plain:raise RuntimeError("Disallowed claim: "+src)
        revised=in_page_revisions(modified,src)
        if len(modified)!=len(original):raise RuntimeError("Page count changed "+src)
        same=0
        for i,p in enumerate(original):
            oldhash=hashlib.sha256(p.get_pixmap(matrix=fitz.Matrix(.65,.65),alpha=False).samples).digest()
            newhash=hashlib.sha256(modified[i].get_pixmap(matrix=fitz.Matrix(.65,.65),alpha=False).samples).digest()
            if i+1 not in revised:
                if oldhash!=newhash:raise RuntimeError("Unexpected change "+src+" page "+str(i+1))
                same+=1
            elif oldhash==newhash:
                raise RuntimeError("Intended copy edit missing "+src+" page "+str(i+1))
        Path(dst).parent.mkdir(parents=True,exist_ok=True)
        modified.save(dst,garbage=4,deflate=True)
        with fitz.open(dst) as check:
            if len(check)!=len(original):raise RuntimeError("Post-save page-count failure")
            if "Capabilities_" in src:
                if "Honda" not in check[0].get_text():raise RuntimeError("Honda experience lost")
                check[0].get_pixmap(matrix=fitz.Matrix(.8,.8)).save("portfolio/_temporary_cap_body.png")
            if "Business_Model_Study" in src:
                check[7].get_pixmap(matrix=fitz.Matrix(.8,.8)).save("portfolio/_temporary_study_p8.png")
            report.append(dict(source=src,output=dst,source_sha256=digest,pages_old=len(original),pages_new=len(check),identical_original_pages=same,edited_pages=revised,size=Path(dst).stat().st_size))
        original.close();modified.close()
    Path("portfolio/_temporary_document_verification.json").write_text(json.dumps({"result":"PASS","no_added_covers":True,"documents":report},ensure_ascii=False,indent=2),encoding="utf-8")
    print("Verified unchanged pagination for",len(report),"portfolio-only PDFs")

if __name__=="__main__":
    if sys.argv[1:]==["apply"]:apply()
    else:raise SystemExit("Unsupported mode")
