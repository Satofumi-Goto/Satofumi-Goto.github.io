#!/usr/bin/env python3
"""One-time, portfolio-only audit and PDF text safety edits; source PDFs are read-only."""
from pathlib import Path
import hashlib
import json
import re
import sys
import fitz

FILES = [
 ("capabilities/Business_Development_Capabilities_20261013.pdf", "portfolio/documents/Business_Development_Capabilities_Portfolio.pdf"),
 ("capabilities/System_Planning_Initial_Concept_20261012.pdf", "portfolio/documents/System_Planning_Initial_Concept_Portfolio.pdf"),
 ("capabilities/Autonomous_Driving_Service_Business_Model_Study.pdf", "portfolio/documents/Autonomous_Driving_Service_Business_Model_Portfolio.pdf"),
 ("Autonomous_Mobility_System_Business_Feasibility.pdf", "portfolio/documents/Autonomous_Mobility_System_Business_Feasibility_Portfolio.pdf"),
]
TRIGGERS = ["ホンダ", "Honda", "HONDA", "FCAD", "MaaS", "スケートボード", "トラック", "エネルギーサービス", "事業化", "承認", "成果", "主導", "成立", "会社", "個人", "自主", "提案", "企画", "業務", "開発", "実装", "investment", "implemented", "business"]

def audit():
    lines=[]
    for source,output in FILES:
        p=Path(source)
        if not p.exists():raise SystemExit("Source not found: "+source)
        doc=fitz.open(str(p))
        lines.extend(["="*60,"SOURCE "+source,"OUTPUT "+output,"SOURCE_SHA256 "+hashlib.sha256(p.read_bytes()).hexdigest(),"PAGES "+str(len(doc))])
        for i,page in enumerate(doc):
            text=page.get_text("text",sort=True)
            row=[t.strip() for t in text.splitlines() if t.strip()]
            lines.append("----PAGE "+str(i+1)+": "+str(len(row))+" text rows----")
            for j,item in enumerate(row):
                lines.append(str(i+1)+"."+str(j+1)+": "+item.replace(chr(9)," "))
        doc.close()
    out=Path("portfolio/_temporary_document_audit.txt")
    out.parent.mkdir(exist_ok=True,parents=True)
    out.write_text("\n".join(lines)+"\n",encoding="utf-8")
    print("Extracted",len(lines),"lines ->",out,"bytes",out.stat().st_size)

if __name__=="__main__":
    if len(sys.argv)>1 and sys.argv[1]=="audit": audit()
    else: raise SystemExit("Only audit phase is enabled until the replacement plan is validated.")
