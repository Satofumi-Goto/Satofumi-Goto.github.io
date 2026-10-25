#!/usr/bin/env python3
"""Portfolio-only, no-extra-page alignment to public TIER IV / Autoware architecture."""
import fitz
import json
import hashlib
from pathlib import Path

PATHS = [
  ("portfolio/documents/System_Planning_Initial_Concept_Portfolio.pdf", [13]),
  ("portfolio/documents/Autonomous_Driving_Service_Business_Model_Portfolio.pdf", [5]),
  ("portfolio/documents/Autonomous_Mobility_System_Business_Feasibility_Portfolio.pdf", [10,11]),
]

def single_line(page, rect, anchor, text, fontsize, fontname, max_x, min_size):
    page.add_redact_annot(fitz.Rect(rect), fill=False, cross_out=False)
    page.apply_redactions(images=0,graphics=0,text=0)
    size=fontsize
    font=fitz.Font(fontname)
    while font.text_length(text, fontsize=size) > max_x-anchor[0]:
        size-=0.12
        if size<min_size:
            raise RuntimeError("Text overflow: "+text)
    page.insert_text(fitz.Point(anchor),text,fontname=fontname,fontsize=size,color=(0.07,0.10,0.15))
    return round(size,2)

def edit_initial(page):
    before=page.get_text()
    must=["RM-01 / RM-02. Level 4 ADS retains DDT and fallback authority.",
          "permissions and evidence paths.","ADS / local safety authority"]
    for t in must:
        if t not in before: raise RuntimeError("Initial Concept baseline changed: "+t)
    rect=(19.6,62.7,573.6,83.15)
    page.add_redact_annot(fitz.Rect(rect),fill=False,cross_out=False)
    page.apply_redactions(images=0,graphics=0,text=0)
    lines=[
      "RM-01 / RM-02. ADS baseline: TIER IV / Autoware (assumed). Onboard: sensing, map, localization, perception, planning, control,",
      "and vehicle interface. DDT/fallback stay onboard; remote/FMS links use AD API, subject to integration and ODD validation."
    ]
    sizes=[]
    for y,line in zip([71.55,81.85],lines):
        size=8.59
        f=fitz.Font("helv")
        while f.text_length(line,fontsize=size)>552:
            size-=0.12
            if size<7.7:raise RuntimeError("Initial Concept line too long")
        page.insert_text((20.21,y),line,fontname="helv",fontsize=size,color=(0.07,0.10,0.15))
        sizes.append(round(size,2))
    result=page.get_text()
    if "TIER IV / Autoware" not in result or "ADS / local safety authority" not in result:
        raise RuntimeError("Autoware baseline missing or onboard architecture altered")
    return [{"rect":[18,61,574,86],"new":lines,"fontsize":sizes}]

def edit_business(page):
    before=page.get_text()
    old="車載ADSが認知・判断・DDT・Fallback／MRMを担う"
    if old not in before or "OBU / VEHICLE" not in before or "ADS ECU" not in before:
        raise RuntimeError("Business diagram baseline changed")
    text="車載ADS：TIER IV／Autowareを技術前提とし、DDT・Fallback／MRMは車載側で担う。"
    size=single_line(page,(93.8,471.25,455.0,478.9),(94.48,476.4),text,6.96,"japan",480.0,6.6)
    after=page.get_text()
    if old in after or "TIER IV／Autoware" not in after:
        raise RuntimeError("Failed to update vehicle ADS specification")
    for t in ["ADS ECU","DDT Fallback/MRM","OBU / VEHICLE"]:
        if t not in after:raise RuntimeError("Original diagram item lost: "+t)
    return [{"rect":[91,464,480,480.5],"new":text,"fontsize":size}]

def edit_feasibility(page,year):
    text=page.get_text()
    if "3 AD Control" not in text or "AD computer" not in text or "Sensor suite" not in text:
        raise RuntimeError("Feasibility system table altered")
    # This is a named software baseline, not validation of the listed H/W targets.
    label="3 TIER IV/Autoware"
    if year==2030:
        clip=(14.1,528.1,113.1,537.48)
        baseline=(14.4,536.45)
        allowed=[12.5,522.5,113.3,542.0]
    else:
        clip=(14.1,556.5,113.1,564.15)
        baseline=(14.4,564.25)
        allowed=[12.5,550.0,113.3,570.0]
    size=single_line(page,clip,baseline,label,9.0,"helv",112.0,7.65)
    after=page.get_text()
    if label not in after or "3 AD Control" in after:raise RuntimeError("Vehicle system heading not updated")
    for t in ["AD computer","Sensor suite","Fusion/localization","ODD/DDT monitor"]:
        if t not in after:raise RuntimeError("Adjacent AD table entry lost: "+t)
    return [{"rect":allowed,"new":label,"fontsize":size}]

def pixels_outside_unchanged(a,b,areas,scale=.48):
    p=a.get_pixmap(matrix=fitz.Matrix(scale,scale),colorspace=fitz.csGRAY,alpha=False)
    q=b.get_pixmap(matrix=fitz.Matrix(scale,scale),colorspace=fitz.csGRAY,alpha=False)
    if (p.width,p.height)!=(q.width,q.height):raise RuntimeError("Page dimensions changed")
    bad=[]
    for i,(u,v) in enumerate(zip(p.samples,q.samples)):
        if abs(u-v)<=2:continue
        x=i%p.width/scale
        y=i//p.width/scale
        inside=any((r[0]-4<=x<=r[2]+4 and r[1]-4<=y<=r[3]+4) for r in areas)
        if not inside:
            bad.append((round(x,1),round(y,1)))
            if len(bad)>=10:break
    if bad:raise RuntimeError("Visual changes outside edit zones: "+str(bad))

def run():
    records=[]
    for name,targets in PATHS:
        path=Path(name)
        raw=path.read_bytes()
        oldhash=hashlib.sha256(raw).hexdigest()
        original=fitz.open(stream=raw,filetype="pdf")
        doc=fitz.open(stream=raw,filetype="pdf")
        changed={}
        if "Initial_Concept" in name:
            changed[13]=edit_initial(doc[13])
        elif "Business_Model" in name:
            changed[5]=edit_business(doc[5])
        else:
            changed[10]=edit_feasibility(doc[10],2030)
            changed[11]=edit_feasibility(doc[11],2035)
        for i in range(len(doc)):
            if i in changed:
                pixels_outside_unchanged(original[i],doc[i],[part["rect"] for part in changed[i]])
            else:
                a=original[i].get_pixmap(matrix=fitz.Matrix(.48,.48),colorspace=fitz.csGRAY,alpha=False)
                b=doc[i].get_pixmap(matrix=fitz.Matrix(.48,.48),colorspace=fitz.csGRAY,alpha=False)
                if hashlib.sha256(a.samples).digest()!=hashlib.sha256(b.samples).digest():
                    raise RuntimeError("Non-target page changed: "+name+" "+str(i+1))
        if len(original)!=len(doc):raise RuntimeError("Page count changed")
        out=path.with_suffix(".tieriv.tmp.pdf")
        doc.save(str(out),garbage=4,deflate=True)
        with fitz.open(str(out)) as test:
            if len(test)!=len(original):raise RuntimeError("Saved page-count mismatch")
            for index in changed:
                if "Autoware" not in test[index].get_text():
                    raise RuntimeError("Autoware reference missing in saved PDF")
            # Check that no extra cover or blank first page was inserted.
            if not test[0].get_text().strip():raise RuntimeError("Blank cover")
            for index in changed:
                test[index].get_pixmap(matrix=fitz.Matrix(.9,.9),alpha=False).save("portfolio/_tieriv_review_"+path.stem+"_"+str(index+1)+".png")
        out.replace(path)
        records.append({
          "file":name,"pages":len(doc),"changed_pages":[i+1 for i in changed],
          "untouched_pages":len(doc)-len(changed),
          "size":path.stat().st_size,"before_sha256":oldhash,
          "after_sha256":hashlib.sha256(path.read_bytes()).hexdigest(),
          "edits":changed
        })
        original.close();doc.close()
        print("PASSED",name,"pages",records[-1]["pages"],"changed",[i+1 for i in changed])
    Path("portfolio/_tieriv_verification.json").write_text(json.dumps({"result":"PASS","records":records,"sources":"TIER IV / Autoware public architecture and AD API, not proprietary vendor specs"},indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
if __name__=="__main__":
    run()
