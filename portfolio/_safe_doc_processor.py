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
    p.insert_text((x,40*s if landscape else 54*s),"PORTFOLIO / 個人の自主検討" if japanese else "PORTFOLIO / INDEPENDENT STUDY",fontname=jpfont if japanese else enfont,fontsize=11*s,color=ACC)
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
    desc=("本書は /portfolio 専用の個人検討版です。共通サイトで掲載する原本は変更していません。" if japanese else "Personal portfolio edition. Shared documents on other pages remain unchanged.")
    place(p,descR,desc,12.4*s,f,MUTED)
    p.draw_line(fitz.Point(x,lineY),fitz.Point(r,lineY),color=(.83,.88,.90),width=1.2*s)
    if japanese:
        scope="位置づけ｜公開する個人の検討・提案です。所属企業の公式方針、承認済みの事業計画、開発着手・製品化・実装済みの実績を示しません。\n検証状況｜技術構想、運用モデル、数値・ロードマップは、明記のない限り検証前の仮説・試算です。\n活動区分｜職務経験と自主的な構想・試作は、事実関係に応じて区別します。"
        note="個人提案｜FCスケートボード及びFCAD-MaaSの車両・運用基盤・サービス拠点の一体構想は、筆者個人の検討・提案です。所属企業の正式な開発決定、トラック開発への寄与又はエネルギーサービス開発の成果を主張するものではありません。\n権利・守秘に関する判断は、個々の作成経緯及び契約・規程等に基づきます。"
    else:
        scope="STATUS | This is the author's individual study or proposal, not an official employer strategy, approved program, development decision, commercial deployment or verified result.\nEVIDENCE | Technical options, project stages, targets and calculations require case-specific validation.\nBOUNDARY | Professional experience is distinguished from independent portfolio concepts and prototypes."
        note="ATTRIBUTION | Any FC skateboard or integrated FCAD-MaaS vehicle, operation-platform and service-hub concept is the author's individual study or proposal, not an approved company plan or truck-development outcome.\nOwnership and confidentiality depend on the relevant materials, agreements and development history."
    place(p,scopeR,scope,12.8*s if landscape else 11.8*s,f)
    place(p,noteR,note,12*s if landscape else 11.5*s,f,MUTED)
    p.draw_line(fitz.Point(x,foot-20*s),fitz.Point(r,foot-20*s),color=(.83,.88,.90),width=s)
    p.insert_text((x,foot),"Satofumi Goto  |  Personal portfolio edition  |  2026-10-25",fontname="helv",fontsize=9*s,color=MUTED)
    if not p.get_text():raise RuntimeError("Cover rendering was blank")

def edit_honda_heading(page):
    found=page.search_for("Honda")
    if len(found)!=1:raise RuntimeError("Expected one Honda heading; got "+str(len(found)))
    r=found[0]
    page.add_redact_annot(r,fill=False,cross_out=False)
    page.apply_redactions(images=0,graphics=0,text=0)
    label="私案:"
    font=fitz.Font("japan")
    fs=11.
    while font.text_length(label,fontsize=fs)>r.width-.3:
        fs-=.2
        if fs<6.5:raise RuntimeError("Replacement would be unreadable")
    page.insert_text(fitz.Point(r.x0,r.y1-(r.height-fs)*.37),label,fontname="japan",fontsize=fs,color=INK)
    if "Honda" in page.get_text("text"):raise RuntimeError("Employer name persisted")
    return [round(r.x0,2),round(r.y0,2),round(fs,2)]

def apply():
    plan=json.loads(Path("portfolio/safe-doc-plan.json").read_text())
    if plan.get("scope")!="portfolio-only":raise RuntimeError("Wrong modification scope")
    report=[]
    for src,dst,title,japanese in FILES:
        data=Path(src).read_bytes()
        digest=hashlib.sha256(data).hexdigest()
        if plan["expected_sha256"].get(src)!=digest:raise RuntimeError("Input SHA changed: "+src)
        original=fitz.open(src);modified=fitz.open(src)
        plain=re.sub(r"\s+","",''.join(p.get_text("text") for p in original))
        for prohibited in ("トラック開発の着手につなげた","エネルギーサービス開発を後押しした"):
            if prohibited in plain:raise RuntimeError("Prohibited phrase unexpectedly present: "+src)
        cover(modified,title,japanese)
        changed=None
        if "Business_Development_Capabilities_" in src:
            changed=edit_honda_heading(modified[1])
        if len(modified)!=len(original)+1:raise RuntimeError("Page loss")
        identical=0
        for i,p in enumerate(original):
            if changed is not None and i==0:continue
            left=hashlib.sha256(p.get_pixmap(matrix=fitz.Matrix(.65,.65),alpha=False).samples).hexdigest()
            right=hashlib.sha256(modified[i+1].get_pixmap(matrix=fitz.Matrix(.65,.65),alpha=False).samples).hexdigest()
            if left!=right:raise RuntimeError("Unexpected graphical change to "+src+" page "+str(i+1))
            identical+=1
        Path(dst).parent.mkdir(parents=True,exist_ok=True)
        modified.set_metadata({**modified.metadata,"title":title+" / Personal portfolio edition","subject":"Individual study; not an employer-approved project"})
        modified.save(dst,garbage=4,deflate=True)
        with fitz.open(dst) as check:
            if len(check)!=len(original)+1 or not check[0].get_text():raise RuntimeError("Post-save failure")
            if "Capabilities_" in src:
                check[0].get_pixmap(matrix=fitz.Matrix(.8,.8)).save("portfolio/_temporary_cap_cover.png")
                check[1].get_pixmap(matrix=fitz.Matrix(.8,.8)).save("portfolio/_temporary_cap_body.png")
            if "Business_Model_Study" in src:
                check[8].get_pixmap(matrix=fitz.Matrix(.8,.8)).save("portfolio/_temporary_study_p8.png")
            report.append(dict(source=src,source_sha256=digest,output=dst,size=Path(dst).stat().st_size,pages_old=len(original),pages_new=len(check),identical_original_pages=identical,changed_heading=changed))
        original.close();modified.close()
    Path("portfolio/_temporary_document_verification.json").write_text(json.dumps({"result":"PASS","documents":report},ensure_ascii=False,indent=2),encoding="utf-8")
    print("Verified",len(report),"portfolio-only PDFs")

if __name__=="__main__":
    if sys.argv[1:]==["apply"]:apply()
    else:raise SystemExit("Unsupported mode")
