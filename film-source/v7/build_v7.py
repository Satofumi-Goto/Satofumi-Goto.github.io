from pathlib import Path
import sys,json,re,subprocess,bisect,time,pickle
from PIL import Image,ImageDraw
import numpy as np
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'source/Mobility_World_Source_v5'))
import render_v7 as r
r.load()
english=json.loads((ROOT/'english.json').read_text())
tr=english['labels']
for sc,en in zip(r.SCENES,english['scenes']):
 tr[sc[1]]=en[0]
 tr.update(zip(sc[3],en[1:]))
original_text=r.text
calls=[]
def record(im,xy,s,size=24,fill=r.WHITE,anchor=None):
 calls.append((xy,s,size,fill,anchor))
r.text=record
cuts=[0,1,2,4,5,6,8,10,11.5,12,13,14]
cache=ROOT/'english-layers.pkl'
layers=pickle.loads(cache.read_bytes()) if cache.exists() else {};missing=set()
for i in range(0 if layers else 20):
 for j,t in enumerate(cuts):
  calls.clear();r.frame(i,t+1/24)
  layer=Image.new('RGBA',(1280,720));d=ImageDraw.Draw(layer)
  for xy,s,size,fill,anchor in calls:
   if not re.search('[\u3040-\u9fff]',s):continue
   if s not in tr:missing.add(s);continue
   en=tr[s];x,y=xy
   old=d.textbbox(xy,s,font=r.font(size),anchor=anchor)
   # Preserve diagram geometry; constrain English to each original label area.
   if y==54:limit=1090
   elif y==653:limit=1180
   elif i==11 and x==758:limit=195
   elif i==11 and x==1080:limit=190
   elif i==11 and x==240:limit=230
   elif i==12 and x==400:limit=480
   elif i==12 and x==890:limit=560
   elif i==13 and 260<y<510:limit=335
   elif i==15 and y==444:limit=310
   elif i==17 and 350<y<450:limit=210
   else:limit=min(1180,max(old[2]-old[0]+60,310))
   if anchor and anchor[0]=='m':limit=min(limit,2*min(x-24,1256-x))
   elif anchor and anchor[0]=='r':limit=min(limit,x-24)
   else:limit=min(limit,1256-x)
   sz=size
   while sz>12 and d.textlength(en,font=r.font(sz))>limit:sz-=1
   box=d.textbbox(xy,en,font=r.font(sz),anchor=anchor)
   rect=(min(old[0],box[0])-5,min(old[1],box[1])-4,max(old[2],box[2])+5,max(old[3],box[3])+4)
   d.rounded_rectangle(rect,4,fill=(10,29,49,255))
   d.text(xy,en,font=r.font(sz),fill=fill,anchor=anchor)
  layers[(i,j)]=layer
 if i%5==0:print('English overlays',i,flush=True)
if missing:raise RuntimeError('Missing translations: '+repr(missing))
if not cache.exists():cache.write_bytes(pickle.dumps(layers))
r.text=original_text
(ROOT/'qa').mkdir(exist_ok=True)
for t in [0,2,5,7,9,12,14,16,18,21,25,32]:
 im=r.frame(5+int(t//15),t%15);im.save(ROOT/'qa'/f'swap-{t:02}.jpg')
if '--preview' in sys.argv:
 for i in [0,4,5,6,11,12,13,15,17,19]:
  im=r.frame(i,7.5).convert('RGBA');im.alpha_composite(layers[(i,bisect.bisect_right(cuts,7.5)-1)]);im.convert('RGB').save(ROOT/'qa'/f'en-{i:02}.jpg')
 print('PREVIEWS COMPLETE',flush=True);sys.exit()
out=ROOT/'v7';out.mkdir(exist_ok=True)
dec=subprocess.Popen(['ffmpeg','-v','error','-i',str(ROOT/'published_v6.mp4'),'-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE)
enc=[]
for lang in ['ja','en']:
 enc.append(subprocess.Popen(['ffmpeg','-y','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','1280x720','-r','24','-i','-','-an','-c:v','libx264','-preset','veryfast','-crf','23','-threads','2','-g','120','-keyint_min','120','-sc_threshold','0','-pix_fmt','yuv420p',str(out/(lang+'-silent.mp4'))],stdin=subprocess.PIPE))
for k in range(7200):
 raw=dec.stdout.read(1280*720*3)
 if len(raw)!=1280*720*3:raise RuntimeError(('Short decode',k,len(raw)))
 i=k//360;t=(k%360)/24
 if 5<=i<=7:
  im=r.frame(i,t);raw=im.tobytes()
 else:im=Image.frombytes('RGB',(1280,720),raw)
 enc[0].stdin.write(raw)
 layer=layers[(i,bisect.bisect_right(cuts,t)-1)]
 fade=min(1,1 if i in [6,7,8] else t/.65,1 if i in [5,6,7] else (15-t)/.65)
 if fade<1:
  layer=layer.copy();layer.putalpha(layer.getchannel('A').point(lambda a:int(a*fade)))
 im=im.convert('RGBA');im.alpha_composite(layer)
 enc[1].stdin.write(im.convert('RGB').tobytes())
 if k%360==0:print('Encoded scene',i,'/',20,flush=True)
for p in enc:p.stdin.close()
for p in enc:
 if p.wait()!=0:raise RuntimeError('Encode failed')
if dec.wait()!=0:raise RuntimeError('Decode failed')
for lang in ['ja','en']:
 subprocess.run(['ffmpeg','-y','-v','error','-i',str(out/(lang+'-silent.mp4')),'-i',str(ROOT/'published_v6.mp4'),'-map','0:v','-map','1:a','-c','copy','-movflags','+faststart',str(out/('Mobility_World_v7_'+lang+'.mp4'))],check=True)
print('COMPLETE',flush=True)
