from pathlib import Path
import sys,math,subprocess,json,bisect,pickle
from PIL import Image,ImageDraw,ImageFilter
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'source/Mobility_World_Source_v5'))
import render_v7 as r
r.load()
# Local shadows avoid blurring a full 720p frame for every pedestrian.
def shadow(im,x,y,w):
 pad=18;h=max(1,math.ceil(w*.075));q=Image.new('RGBA',(math.ceil(w)+2*pad,h+2*pad))
 ImageDraw.Draw(q).ellipse((pad,pad,pad+w,pad+h),fill=(0,15,25,55))
 im.alpha_composite(q.filter(ImageFilter.GaussianBlur(7)),(round(x)-pad,round(y)-pad))
r.shadow=shadow
cache={}
def sprite(im,n,x,y,width,alpha=1):
 w=max(1,round(width));key=(n,w)
 if key not in cache:
  src=r.ASSETS[n];cache[key]=src.resize((w,max(1,round(w*src.height/src.width))),Image.Resampling.BILINEAR)
 q=cache[key]
 if alpha<1:q=q.copy();q.putalpha(q.getchannel('A').point(lambda a:int(a*alpha)))
 im.alpha_composite(q,(round(x),round(y)))
r.sprite=sprite
def row(im,T,scale,ox,ground):
 w,left,right,g,cx,cb,mb,cl,ml,lower=r.swap_state(max(0,T))
 q=Image.new('RGBA',(1280,720))
 r.shadow(q,right+12,g-4,w*.96)
 if T<19:r.module(q,'market_side',right,mb,w,ml,g)
 if 1<=T<6:
  u=r.ease((T-1)/5)
  r.ground_sprite(q,'cafe_front',r.mix(170,270,u),r.mix(335,g,u),r.mix(105,w,u))
 elif T>=6:
  if T<19:r.side_unit(q,cx,g,w,lower=lower)
  r.shadow(q,left+12,g-4,w*.96)
  r.module(q,'cafe_side',left,cb,w,cl,g)
 if 19<=T<26:
  u=r.ease((T-19)/7)
  r.ground_sprite(q,'market_rear',r.mix(730,1115,u),r.mix(g,325,u),r.mix(w,95,u),1-r.ease((T-25.5)/.5))
 q=q.resize((round(1280*scale),round(720*scale)),Image.Resampling.BILINEAR)
 im.alpha_composite(q,(round(ox),round(ground-453*scale)))
def frame(T,english=False):
 im=r.fixed_bg('swap_yard')
 # Back to front, with later starts in the two deeper rows.
 row(im,T-7,.45,290,340)
 row(im,T-3.5,.65,255,400)
 row(im,T,.85,40,470)
 r.gathering(im,T-2.5)
 if T<6:
  title=('Three rows, staggered shop exchanges' if english else '奥から進入。３列で時間差の載せ替え')
  cap=('The first FC skateboard enters from the back of the parking lot.' if english else '最初のFCスケートボードが、駐車場の奥からカフェを運んでくる。')
 elif T<13:
  title=('The next shop rises before the chassis arrives' if english else '交換先を先に上げ、車台が潜り込む')
  cap=('The next shop rises first; the released chassis moves underneath it.' if english else '交換先の店舗を先に持ち上げ、カフェを解放した車台が下へ移動する。')
 elif T<19:
  title=('Opening and loading happen together' if english else '接地・開店と、次の店舗への接合を同時に')
  cap=('People gather as the cafe lands, while the next shop connects to the chassis.' if english else 'カフェが地面に下り、人が集まる。同時に次の店舗と接合し、脚を格納する。')
 else:
  title=('The first shop departs; the others keep working' if english else '最初の店舗が出発。奥の２列は交換を続ける')
  cap=('The first loaded chassis departs while the two rear rows continue their exchanges.' if english else '最初の車台は次の店舗を載せて出発。奥の２列では時間差で交換が進む。')
 shade=Image.new('RGBA',(1280,720));d=ImageDraw.Draw(shade)
 for y in range(150):d.line((0,y,1280,y),fill=(5,19,35,round(210*(1-y/150))))
 d.rectangle((0,622,1280,720),fill=(5,19,35,230));im.alpha_composite(shade)
 r.text(im,(40,20),'04 / SWAP BODY',17,r.CYAN)
 r.text(im,(40,54),title,27)
 r.text(im,(1235,26),'FUTURE CONCEPT' if english else '未来構想 / CONCEPT',15,r.WHITE,'ra')
 r.text(im,(1235,53),'2.5D ANIMATION',12,(190,210,225),'ra')
 size=23
 while ImageDraw.Draw(im).textlength(cap,font=r.font(size))>1180:size-=1
 r.text(im,(640,653),cap,size,r.WHITE,'mm')
 r.text(im,(40,696),'SATOFUMI GOTO',12,(157,182,202),'lm')
 # Clock is applied consistently to the complete final edit.
 fade=min(1,T/.4,(26-T)/.35)
 if fade<1:im.alpha_composite(Image.new('RGBA',(1280,720),(5,17,29,int(255*(1-fade)))))
 return im.convert('RGB')
if '--preview' in sys.argv:
 for t in [2,6,10,14,17,20,24,25]:frame(t).save(ROOT/'qa'/f'rows-{t:02}.jpg')
 sys.exit()
enc=[]
for lang in ['ja','en']:
 enc.append(subprocess.Popen(['ffmpeg','-y','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','1280x720','-r','24','-i','-','-an','-c:v','libx264','-preset','veryfast','-crf','23','-threads','2','-pix_fmt','yuv420p',str(ROOT/'v7'/('swap-rows-'+lang+'.mp4'))],stdin=subprocess.PIPE))
for k in range(624):
 for lang,p in zip(['ja','en'],enc):p.stdin.write(frame(k/24,lang=='en').tobytes())
 if k%120==0:print('Three-row scene:',k//24,'/ 26 seconds',flush=True)
for p in enc:p.stdin.close()
for p in enc:
 if p.wait():raise RuntimeError('encode failed')
print('ROWS COMPLETE',flush=True)
