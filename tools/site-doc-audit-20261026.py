#!/usr/bin/env python3
from pathlib import Path
import fitz, json, hashlib, re, sys
FILES={
 "top_cap":"top-documents/Business_Development_Capabilities_20261013.pdf",
 "cap_cap":"capabilities/documents/Business_Development_Capabilities_20261013.pdf",
 "top_concept":"top-documents/System_Planning_Initial_Concept_20261012.pdf",
 "cap_concept":"capabilities/documents/System_Planning_Initial_Concept_20261012.pdf",
 "top_business":"top-documents/Autonomous_Mobility_Business_Model_Design.pdf",
 "cap_business":"capabilities/documents/Autonomous_Driving_Service_Business_Model_Study.pdf",
 "top_feas":"top-documents/Autonomous_Mobility_System_Business_Feasibility.pdf",
 "cap_feas":"capabilities/documents/Autonomous_Mobility_System_Business_Feasibility.pdf",
}
def audit():
 report={}
 for key,path in FILES.items():
  d=fitz.open(path)
  selected=[0]
  if key.endswith("business") and len(d)>=8:selected.append(7)
  page_results=[]
  for p in selected:
   page=d[p]
   lines=[]
   for b in page.get_text("dict",sort=True).get("blocks",[]):
    for l in b.get("lines",[]):
     spans=l.get("spans",[])
     text="".join(z["text"] for z in spans)
     bbox=l.get("bbox")
     lines.append({"text":text,"bbox":[round(x,1) for x in bbox],"font":[z["font"] for z in spans],"size":[round(z["size"],1) for z in spans]})
   important=[]
   pat=re.compile(r"Honda|ホンダ|FCAD|スケート|HTS|車両|事業|開発|構想|Proposed|proposal|This study|plans?|designed|implementation",re.I)
   for ln in lines:
    if pat.search(ln["text"]):important.append(ln)
   page_results.append({"page":p+1,"width":page.rect.width,"height":page.rect.height,"lines":len(lines),"important":important[:90],"top":lines[:10],"footer":lines[-6:]})
   name="site-doc-audit-"+key+"-p"+str(p+1)+".png"
   clip=None
   if key.endswith("cap") and p==0: clip=fitz.Rect(295,425,593,622)
   if key.endswith("concept") and p==0: clip=fitz.Rect(0,785,page.rect.width,page.rect.height)
   if key.endswith("feas") and p==0: clip=fitz.Rect(0,165,page.rect.width,285)
   if key.endswith("business") and p==7: clip=fitz.Rect(0,0,page.rect.width,page.rect.height)
   if clip is not None:
    page.get_pixmap(matrix=fitz.Matrix(1.05,1.05),clip=clip,alpha=False).save("site-docs-audit/"+name)
  report[key]={"source":path,"sha256":hashlib.sha256(Path(path).read_bytes()).hexdigest(),"pages":len(d),"selected":page_results}
  print("AUDIT",key,"PAGES",len(d),"SHA",report[key]["sha256"])
  d.close()
 Path("site-docs-audit/inventory.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
 print("SUCCESS: 8 PDF sources audited")
if __name__=="__main__":
 Path("site-docs-audit").mkdir(exist_ok=True)
 audit()
