#!/usr/bin/env python3
import fitz, json, hashlib, re, sys
from pathlib import Path
DOCS=[
 ("portfolio/documents/Business_Development_Capabilities_Portfolio.pdf",[1,5]),
 ("portfolio/documents/System_Planning_Initial_Concept_Portfolio.pdf",[1]),
 ("portfolio/documents/Autonomous_Driving_Service_Business_Model_Portfolio.pdf",[8,9]),
 ("portfolio/documents/Autonomous_Mobility_System_Business_Feasibility_Portfolio.pdf",[1]),
]
def audit():
  full={}
  for name,pages in DOCS:
    doc=fitz.open(name)
    result={"file":name,"sha256":hashlib.sha256(Path(name).read_bytes()).hexdigest(),"page_count":len(doc),"pages":{}}
    for orig in pages:
      idx=orig
      if idx>=len(doc): continue
      page=doc[idx];parts=[]
      for b in page.get_text("dict",sort=True)["blocks"]:
       for l in b.get("lines",[]):
        spans=l["spans"]
        parts.append({"text":"".join(t["text"] for t in spans),"bbox":[round(v,2) for v in l["bbox"]],"spans":[{"text":t["text"],"bbox":[round(v,2) for v in t["bbox"]],"font":t["font"],"size":round(t["size"],2),"color":t["color"]} for t in spans]})
      result["pages"][str(orig)]={"rect":[page.rect.width,page.rect.height],"lines":parts}
    full[name]=result
    print("AUDIT",name,"count",len(doc),"selected",len(result["pages"]))
  Path("portfolio/_inplace_pdf_audit.json").write_text(json.dumps(full,ensure_ascii=False,indent=2),encoding="utf-8")

EXPECTED={
 "portfolio/documents/Business_Development_Capabilities_Portfolio.pdf":"809745d4115aa28b8cce03a74f6dcc8241d0f2b9ff94c9731eaf14a02c0bd622",
 "portfolio/documents/System_Planning_Initial_Concept_Portfolio.pdf":"fce5901030118f8ba78998400438853793d11adbac200c9b43b414e498726afc",
 "portfolio/documents/Autonomous_Driving_Service_Business_Model_Portfolio.pdf":"b14eedc130804f2d8d136e832cba7e757b369a3798485b12460d1f9f95a1b1e6",
 "portfolio/documents/Autonomous_Mobility_System_Business_Feasibility_Portfolio.pdf":"ea4c0beb5f4038beadf7e71ba37153c185c2b6341c523a41fe4fef5c746bb3a7",
}
COUNTS=[14,30,9,15]
JP_CAP_P1=(
"HondaではPEFC外販の事業成立条件と製品要件を検討。\n"
"FCスケートボードの低床車両構想を提案し、短時間補給・\n"
"スワップボデーによる稼働率と積載率の改善を検討した。\n"
"ミルの水素製造、LH₂冷熱利用、HTS等も事業上の評価対象\n"
"とし、車両・運用・拠点を結ぶFCAD-MaaS構想を提示。\n"
"関係部門の事業・商品検討を前進させた。掲載図表・試算\n"
"は公開情報と独自の前提で再構成した説明用資料であり、\n"
"Hondaの社内資料・承認済み開発計画の転載ではない。"
)
STUDY_HEADING="Federation｜自動運転事業の車両・拠点構想"
STUDY_SUBTITLE="FCスケートボード・拠点の検討案。掲載図はHondaの承認済み開発計画や社内資料ではない"
INITIAL_FOOTER="Portfolio study: diagrams and models separately prepared, not copied from employer documents; validation pending."

def remove_and_draw(page, rects, draw_items):
    for rect in rects:
        page.add_redact_annot(fitz.Rect(rect), fill=False, cross_out=False)
    page.apply_redactions(images=0,graphics=0,text=0)
    for item in draw_items:
        if item["mode"]=="textbox":
            ret=page.insert_textbox(fitz.Rect(item["rect"]),item["text"],
                fontsize=item["size"],fontname=item["font"],lineheight=item.get("lineheight",1.05),color=(.07,.07,.07))
            if ret<0: raise RuntimeError("Text does not fit at "+str(item["rect"])+": "+item["text"][:70]+": "+str(ret))
        else:
            page.insert_text(fitz.Point(item["pos"]),item["text"],
                fontsize=item["size"],fontname=item["font"],color=(.07,.07,.07))

def pixels_unchanged_outside(before,after,allowed):
    scale=.78
    b=before.get_pixmap(matrix=fitz.Matrix(scale,scale),colorspace=fitz.csGRAY,alpha=False)
    a=after.get_pixmap(matrix=fitz.Matrix(scale,scale),colorspace=fitz.csGRAY,alpha=False)
    if b.width!=a.width or b.height!=a.height: raise RuntimeError("Page dimensions changed")
    diff=0;bad=0;first=[]
    for y in range(a.height):
        row=y*a.width
        for x in range(a.width):
            if abs(a.samples[row+x]-b.samples[row+x])<=2:continue
            diff+=1
            xx=x/scale;yy=y/scale
            inside=any((r[0]-4<=xx<=r[2]+4 and r[1]-4<=yy<=r[3]+4) for r in allowed)
            if not inside:
                bad+=1
                if len(first)<8:first.append((round(xx,1),round(yy,1)))
    if bad>0:raise RuntimeError("Unexpected visible page changes: "+str(bad)+" pixels, first="+str(first))
    return diff

def apply():
    results=[]
    for idx,(path,_) in enumerate(DOCS):
        source_bytes=Path(path).read_bytes()
        digest=hashlib.sha256(source_bytes).hexdigest()
        if digest!=EXPECTED[path]:raise RuntimeError("The uploaded PDF has changed; refusing to overwrite "+path)
        source=fitz.open(path)
        doc=fitz.open(path)
        target_count=COUNTS[idx]
        if len(doc)!=target_count+1:raise RuntimeError("Cover/page count mismatch: "+path)
        cover_text=doc[0].get_text("text")
        if not ("PORTFOLIO" in cover_text):raise RuntimeError("First page not recognized as added cover")
        doc.delete_page(0)
        if len(doc)!=target_count:raise RuntimeError("Page count mismatch after cover removal")
        edited={}
        if idx==0:
            page=doc[0]
            before=page.get_text("text")
            if "FCスケートボードを構想。" not in before or "事業化の課題が残った" not in before:
                raise RuntimeError("Cap P1 original target unexpectedly changed")
            r=(306.85,493.80,572.0,584.8)
            remove_and_draw(page,[r],[dict(mode="textbox",rect=(307.13,493.8,572.0,584.8),text=JP_CAP_P1,font="japan",size=9.0,lineheight=1.07)])
            if "FCスケートボードの低床車両構想を提案" not in page.get_text():raise RuntimeError("Cap P1 new text missing")
            edited[0]=[r]
            page=doc[4]
            if "夜間｜FCスケートボードの洗車・整備" not in page.get_text():
                raise RuntimeError("Cap P5 target absent")
            r2=(388.6,390.0,571,405.5)
            remove_and_draw(page,[r2],[dict(mode="text",pos=(388.83,402.6),text="夜間｜FCスケートボード構想の洗車・整備",font="japan",size=9.36)])
            if "FCスケートボード構想の洗車・整備" not in page.get_text():raise RuntimeError("Cap P5 not updated")
            edited[4]=[r2]
        if idx==1:
            page=doc[0]
            if "Proposed concept" not in page.get_text():raise RuntimeError("Initial footer not found")
            r=(20.7,813.4,522,822.65)
            remove_and_draw(page,[r],[dict(mode="textbox",rect=(20.98,813.4,530,823.5),text=INITIAL_FOOTER,font="helv",size=6.69,lineheight=1.05)])
            if INITIAL_FOOTER not in page.get_text():raise RuntimeError("Initial footer not updated")
            edited[0]=[r]
        if idx==2:
            page=doc[7]
            if "積載率・24H稼働・燃料費・快適性" not in page.get_text():
                raise RuntimeError("Business study P8 target absent")
            r=(17.1,20.8,540,66.6)
            remove_and_draw(page,[r],[
                dict(mode="textbox",rect=(17.45,20.8,540,49.8),text=STUDY_HEADING,font="japan",size=18.96,lineheight=1.05),
                dict(mode="textbox",rect=(18.58,47.85,560,66.6),text=STUDY_SUBTITLE,font="japan",size=12.0,lineheight=1.05)])
            after_text=page.get_text()
            if STUDY_HEADING not in after_text or STUDY_SUBTITLE not in after_text:raise RuntimeError("Study title/desc not updated")
            edited[7]=[r]
        for pi in range(target_count):
            # Compare each original document page, excluding the deliberately removed cover.
            if pi not in edited:
                a=source[pi+1].get_pixmap(matrix=fitz.Matrix(.65,.65),colorspace=fitz.csGRAY,alpha=False)
                b=doc[pi].get_pixmap(matrix=fitz.Matrix(.65,.65),colorspace=fitz.csGRAY,alpha=False)
                if hashlib.sha256(a.samples).digest()!=hashlib.sha256(b.samples).digest():
                    raise RuntimeError("Non-target page changed: "+path+" page "+str(pi+1))
            else:
                pixels_unchanged_outside(source[pi+1],doc[pi],edited[pi])
        text_all="\n".join(p.get_text() for p in doc)
        forbidden=["トラック開発の着手につなげた","エネルギーサービス開発を後押しした"]
        if any(q in re.sub(r"\s+","",text_all) for q in forbidden):raise RuntimeError("Forbidden achievement claim retained")
        out_path=Path(path)
        temp=out_path.with_suffix(".tmp.pdf")
        doc.save(str(temp),garbage=4,deflate=True)
        with fitz.open(str(temp)) as check:
            if len(check)!=target_count:raise RuntimeError("Output verification failed")
            if idx==0:
                check[0].get_pixmap(matrix=fitz.Matrix(1.1,1.1),alpha=False).save("portfolio/_inplace_preview_cap_p1.png")
                check[4].get_pixmap(matrix=fitz.Matrix(1.1,1.1),alpha=False).save("portfolio/_inplace_preview_cap_p5.png")
            if idx==2:
                check[7].get_pixmap(matrix=fitz.Matrix(1.1,1.1),alpha=False).save("portfolio/_inplace_preview_study_p8.png")
        temp.replace(out_path)
        results.append({
            "path":path,"pages_before":len(source),"pages_after":target_count,
            "cover_pages_removed":1,"modified_original_pages":[p+1 for p in sorted(edited)],
            "unchanged_original_pages":target_count-len(edited),
            "sha256_before":digest,"sha256_after":hashlib.sha256(out_path.read_bytes()).hexdigest()
        })
        print("PASS",path,"pages",target_count,"body_changed",sorted(edited))
        source.close();doc.close()
    Path("portfolio/_inplace_pdf_verification.json").write_text(json.dumps({"status":"PASS","items":results},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

if __name__=="__main__":
  if sys.argv[1:]==["audit"]:audit()
  elif sys.argv[1:]==["apply"]:apply()
  else:raise SystemExit("usage: audit/apply")
