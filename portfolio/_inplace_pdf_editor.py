#!/usr/bin/env python3
import fitz, json, hashlib, re, sys
from pathlib import Path
DOCS=[
 ("portfolio/documents/Business_Development_Capabilities_Portfolio.pdf",[1,5,8,14]),
 ("portfolio/documents/System_Planning_Initial_Concept_Portfolio.pdf",[1,2,30]),
 ("portfolio/documents/Autonomous_Driving_Service_Business_Model_Portfolio.pdf",[1,8,9]),
 ("portfolio/documents/Autonomous_Mobility_System_Business_Feasibility_Portfolio.pdf",[1,2,15]),
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
if __name__=="__main__":
  if sys.argv[1:]==["audit"]:audit()
  elif sys.argv[1:]==["apply"]:raise SystemExit("apply not implemented yet")
  else:raise SystemExit("usage: audit/apply")
