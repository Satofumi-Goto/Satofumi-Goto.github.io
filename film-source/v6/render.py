"""Five-minute 2.5D concept animation. Deterministic offline render; no live systems."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps
import math, subprocess, sys, json, concurrent.futures, wave, hashlib
import numpy as np

ROOT=Path(__file__).resolve().parent
W,H=1280,720
FPS=24
DURATION=15
ASSETS={}
FONTS={}
CYAN=(62,221,255); GOLD=(255,207,112); GREEN=(110,233,176); WHITE=(244,249,255)
NAVY=(10,29,49)

# Captions describe the author's proposal; no fabricated performance results.
SCENES=[
('city','暮らしから、街をつくる','MOBILITY / ENERGY / INTELLIGENCE',[
 '人の活動を起点に、移動とサービスをつなぐ。',
 'その暮らしを、車両・エネルギー・計算基盤が支える。',
 '後藤悟文のケーパビリティとポートフォリオから描く、未来の街。']),
('plaza','一日の予定から、始まる','01 / SENESCHAL',[
 '買物、仕事、学童、外出。人々の一日は、それぞれ違う。',
 'Seneschalが、活動の予定とサービスの空きを照合する。',
 '人が選んだ過ごし方に、移動と手配を組み合わせる。']),
('plaza','人とサービスの時間を合わせる','01 / SENESCHAL',[
 '高齢者の共同外出、学校から習い事へ、夕方の地域交流。',
 '活動と移動、職員と設備の条件を合わせる。',
 '予定の変更も、次の予約と帰りの移動へつなぐ。']),
('plaza','買物の時間が、補充の時間になる','02 / AVP',[
 '店先で降りたら、車は自動で駐車・充電エリアへ。',
 '駐車枠と補充設備を予約し、AVPで移動する。',
 '人は買物へ。車は次の移動に備える。']),
('node','自動充電を終え、迎えに戻る','02 / AUTOMATED CHARGING',[
 '充電口への自動接続。出発予定に必要な電力を確保する。',
 '補充と利用予定をつなぎ、設備と車両の時間を合わせる。',
 '買物が終わる頃、車が乗車場所へ戻る。']),
('plaza','サービスそのものが、移動する','03 / FC SKATEBOARD',[
 '低床・扁平なFCスケートボードに、サービス空間を載せる。',
 '店舗や地域サービスを、必要な場所と時間へ運ぶ。',
 '車台と上部ボディを分け、用途の違う需要に対応する。']),
('node','店舗を残し、車台は次の仕事へ','04 / SWAP BODY',[
 '支持脚で店舗ボディを保持する。',
 '車高を下げ、FCスケートボードがボディの下から抜ける。',
 '店舗はその場所で営業を続け、車台は次へ向かう。']),
('node','ボディを替え、役割を替える','04 / SWAP BODY',[
 'カフェを残した車台が、隣の青果店の下へ入る。',
 '車高を上げて接合し、支持脚を格納する。',
 '今度は青果店を載せて出発。同じ車台で別の店舗を運ぶ。']),
('plaza','移動と、そこで過ごす時間を一体に','05 / MOBILE SERVICES',[
 '日中は外出支援や学童、夕方は地域の交流。',
 '人と荷物の動きも、相乗り・共同輸送・貨客混載で組み合わせる。',
 'サービスごとに異なる需要の山谷を、共通運用でつなぐ。']),
('node','Nodeは、街の運用を支える拠点','06 / NODE',[
 '昼は買物中の補充。夜はサービス車両の清掃・点検・整備。',
 'PPA・VPPと、電力・水素・熱の運用を組み合わせる。',
 '駐車場、物流拠点、都市ビルを、継続して使う事業基盤へ。']),
('plant','LH2の冷熱を、拠点で活かす','07 / HYDROGEN & COOLING',[
 '液体水素の貯蔵・供給と、冷熱利用を一体で考える。',
 '熱交換と必要な追加冷却を介し、設備と計算基盤を支える。',
 '電力・水素・熱の流れをつなぎ、拠点全体として運用する。']),
('plant','水道管ミルと、資源の循環','08 / WATER-PIPE MILL',[
 '水道管のバイパスで、水流の回転力を取り出す構想。',
 'ミルと発電機、回転式AMRへ、用途に応じて動力をつなぐ。',
 'チタン材の供給・回収・再生も含め、物質とエネルギーを循環させる。']),
('plant','回転式AMRから、液化・冷却へ','08 / ROTARY AMR',[
 '回転式AMRによる磁気冷凍を、液化・冷却の構想に組み込む。',
 '予冷・熱交換・追加冷却を含む系として扱う。',
 'NodeのLH2運用を、次の供給・通信・計算基盤へ広げる。']),
('city','Nodeをつなぐ、地下の基盤','09 / CONNECTED INFRASTRUCTURE',[
 'HTSケーブルとLH2パイプラインが、Node間を結ぶ。',
 'LH2冷却光ネットワークと、量子通信を重ねる将来像。',
 '冷熱・電力・情報。それぞれの役割を保ちながら連携する。']),
('city','Nodeがつながり、街になる','09 / A CITY OF NODES',[
 '一つの拠点から、住宅地・商業・物流・都市ビルへ。',
 '供給と計算の基盤が広がり、サービスの届く範囲が増える。',
 '移動式店舗と交通が、そのネットワークの上で働く。']),
('plant','分散量子コンピューティング','10 / DISTRIBUTED COMPUTING',[
 'LH2冷却を活用するRSUと、分散した計算拠点。',
 '光ネットワーク・量子通信でつなぐ、将来の計算基盤。',
 'AIによる需要・配置・運行の判断を、街全体で支える構想。']),
('city','インフラ協調から、動的編成へ','11 / COOPERATIVE MOBILITY',[
 'RSUと車両が道路・運行の情報を共有する。',
 'FCスケートボード同士を物理連結し、一つの隊列として走る。',
 '需要と行先に合わせ、連結・切離しで編成を組み替える。']),
('city','Seneschal → Federation → 4コンソール','12 / AI-DRIVEN OPERATIONS',[
 'Seneschalが、人々の活動とサービス利用をつなぐ。',
 'Federationが、活動・フリート・サービス拠点・都市運用を連携する。',
 '暮らしの希望を、車両・店舗・エネルギーの運用へつなぐ。']),
('city','地上のNodeから、空へ','13 / eVTOL',[
 '都市ビルの屋上へ。地上の移動と空の移動がつながる。',
 'eVTOLがNode間を結び、行動できる範囲を広げる。',
 '補充・整備と地上サービスを共用し、陸と空の運用を支える。']),
('night_service','夜の駐車場が、明日の運行をつくる','MOBILITY / ENERGY / INTELLIGENCE',[
 '夜の駐車場で、車輪・足回り・機器を点検する。',
 '接地したコンテナ店舗を清掃し、車台は整備して翌日に備える。',
 '構想：後藤悟文　｜　モビリティを、運行事業として成立させる。'])]

# Version 3: replace transport-only coverage with everyday activities.
SCENES[0]=('activity_morning','「ただいま」が、街をつくる','LIFE / A CITY FOR EVERYDAY JOY',[
 '子供たちが集まり、今日の放課後が始まる。',
 '歩いて行ける場所に、学びと遊びの居場所を。',
 '人々の毎日から、未来の街を描く。'])
SCENES[1]=('afterschool','移動式学童。放課後が、やってくる','01 / MOBILE AFTER-SCHOOL',[
 '本を囲む。工作をする。友達と「できた！」を分かち合う。',
 '指導員と過ごす時間を、必要な地域へ届ける。',
 'Seneschalが、学童の利用予定と送迎をつなぐ。'])
SCENES[2]=('senior_community','会いたい人と、今日も会える','01 / MOBILE COMMUNITY',[
 'お茶を飲み、カードを囲み、近況を話す。',
 '高齢者の交流の場が、暮らしの近くへやってくる。',
 'Seneschalが、参加の希望と外出・帰りの移動を合わせる。'])
SCENES[3]=('avp_phone','スマホで依頼。あとは、買物へ','02 / RSU-COOPERATIVE AVP',[
 '人がスマホで、自動駐車・充電を依頼する。',
 'RSUが周囲を把握し、インフラと車両が協調するAVP。',
 '歩行者と駐車枠を確認し、車を充電場所へ誘導する。'])
SCENES[4]=('node','買物をしている間に、自動充電','02 / AUTOMATED CHARGING',[
 '予約した区画へ駐車し、充電設備に自動接続。',
 '次の出発予定に合わせ、必要な電力を補充する。',
 '人々が楽しむ時間を、街の設備が支えている。'])
SCENES[5]=('swap_yard','今日のカフェが、街角に到着する','03 / FC SKATEBOARD',[
 'FCスケートボードが、サービス空間そのものを運ぶ。',
 '必要な地域へ、必要な時間にカフェを届ける。',
 'そこで過ごす、人々の時間が始まる。'])
SCENES[7]=('node','カフェから青果店へ、ボディを載せ替える','04 / SWAP BODY',[
 'カフェを残した車台が、隣の青果店の下へ入る。',
 '車高を上げて接合し、支持脚を格納する。',
 '同じ車台が、今度は青果店を運ぶ準備を終える。'])
SCENES[8]=('afterschool','行きたい場所より、したいことから','05 / SENESCHAL & EVERYDAY LIFE',[
 '子供の学びと遊び。大人の買物と会話。',
 '高齢者が集まり、地域の人たちと過ごす時間。',
 'Seneschalが、一人ひとりの活動に移動とサービスを合わせる。'])

# Version 4: a demounted shop lowers to ground; the empty lot becomes a gathering place.
SCENES[6]=('swap_yard','車台を抜き、店舗を地面へ下ろす','04 / LOWER-TO-GROUND SWAP BODY',[
 '昇降脚で店舗を支え、FCスケートボードが下から抜ける。',
 '車台が離れたら、脚を縮めて店舗ボディを下げる。',
 '床が地面に接し、普通の店舗として開店する。'])
SCENES[7]=('swap_yard','店舗はここで営業。車台は別の店舗へ','04 / SWAP BODY',[
 '次の青果店は、昇降脚を伸ばしてボディを持ち上げる。',
 '車台が下へ入り、接合して支持脚を格納する。',
 '接地したカフェへ、人々が歩いて集まり始める。'])
SCENES[8]=('swap_yard','空いていた駐車場が、人の居場所になる','05 / A PLACE COMES ALIVE',[
 '親子も、高齢者も。カフェを目指して歩いてくる。',
 '店先には列ができ、待ち合わせと会話が生まれる。',
 '店舗を届けることが、地域に人の集まる時間をつくる。'])

SCENES[11]=('plant','水力・風力から、電力・水素・冷却へ','08 / ENERGY',[
 '水力・風力の回転力を活用する。',
 '発電・ミル・AMRへ、回転力を並列に配分する。',
 '電力・水素製造・冷却を、需要に応じて切り替える。'])
SCENES[12]=('plant','建物の鉄骨そのものが、エネルギーを蓄える','08 / STRUCTURAL ENERGY STORAGE',[
 '柱・梁の鉄骨そのものを、H-伝導体MHとして構成する。',
 '水素と電気の貯蔵を切り替え、需給を調整する。',
 '建物構造体とNodeの運用をつなぐ、エネルギーマネジメント。'])

SCENES[5]=SCENES[6]
SCENES[6]=SCENES[7]
SCENES[7]=SCENES[8]
SCENES[8]=('plaza','そして、そこで暮らす人々の生活が始まる','05 / EVERYDAY LIFE',[
 '空いていた駐車場に、人が集まり、会話が生まれる。',
 '買物、学童、地域の交流。いつもの暮らしが動き始める。',
 '移動とサービスが、人々の過ごす時間を豊かにする。'])

def font(size):
 if size not in FONTS:FONTS[size]=ImageFont.truetype(str(ROOT/'assets/NotoSansCJKjp-Regular.otf'),size)
 return FONTS[size]
SCENES[16]=('city','連結して、車両間を行き来する','11 / COOPERATIVE MOBILITY',[
 'RSUと協調し、FCスケートボード同士を物理連結する。',
 '連結部の通路がつながり、人が車両間を行き来する。',
 '人と荷物が乗り移った後、連結を解除してそれぞれの行先へ。'])

def load():
 for n in ['plaza','node','city','plant','night','car','body','body2','chassis','evtol','chassis_side','cafe_side','market_side','passenger_side','car_away','cafe_front','market_rear','night_service','swap_yard','activity_morning','afterschool','afterschool_alt','senior_community','senior_alt','avp_phone','road_panorama','children_walk','walk_family','walk_seniors','walk_friends','crowd_idle','passenger_through','walk_transfer']:
  q=Image.open(ROOT/'assets'/f'{n}.png').convert('RGBA')
  if n in ['car','chassis_side','cafe_side','market_side','passenger_side','car_away','cafe_front','market_rear','passenger_through']:
   # Remove transparent canvas margins only; preserve source image and alpha.
   a=np.asarray(q.getchannel('A'))>40
   ys=np.flatnonzero(a.sum(axis=1)>q.width*.006)
   xs=np.flatnonzero(a.sum(axis=0)>q.height*.006)
   q=q.crop((int(xs[0]),int(ys[0]),int(xs[-1])+1,int(ys[-1])+1))
  ASSETS[n]=q
 # Split a purpose-generated four-pose atlas at equal cell boundaries.
 atlas=ASSETS['children_walk']
 for j in range(4):
  q=atlas.crop((round(j*atlas.width/4),0,round((j+1)*atlas.width/4),atlas.height))
  a=q.getchannel('A');box=a.point(lambda v:255 if v>100 else 0).getbbox()
  ASSETS[f'walk{j}']=q.crop(box)
 for name in ['family','seniors','friends']:
  atlas=ASSETS['walk_'+name]
  for j in range(4):
   q=atlas.crop((round(j*atlas.width/4),0,round((j+1)*atlas.width/4),atlas.height))
   box=q.getchannel('A').point(lambda v:255 if v>100 else 0).getbbox()
   q=q.crop(box);ASSETS[f'{name}_{j}']=q;ASSETS[f'{name}_{j}_r']=ImageOps.mirror(q)
 atlas=ASSETS['crowd_idle'];split=532
 for j,name in enumerate(['family','seniors','friends']):
  for pose,(y0,y1) in enumerate([(0,split),(split,atlas.height)]):
   q=atlas.crop((round(j*atlas.width/3),y0,round((j+1)*atlas.width/3),y1))
   box=q.getchannel('A').point(lambda v:255 if v>100 else 0).getbbox()
   q=q.crop(box);ASSETS[f'{name}_idle{pose}']=q;ASSETS[f'{name}_idle{pose}_r']=ImageOps.mirror(q)
 # Three passenger identities, each with four distinct side-view walking poses.
 atlas=ASSETS['walk_transfer']
 for row,(name,y0,y1) in enumerate([('rider',0,315),('parcel',315,665),('shopper',665,1024)]):
  for j in range(4):
   q=atlas.crop((j*384,y0,(j+1)*384,y1))
   box=q.getchannel('A').point(lambda v:255 if v>100 else 0).getbbox()
   q=q.crop(box)
   ASSETS[f'transfer_{name}_{j}']=q
   ASSETS[f'transfer_{name}_{j}_r']=ImageOps.mirror(q)

def ease(v):
 v=max(0,min(1,v));return v*v*(3-2*v)
def mix(a,b,v):return a+(b-a)*v
def bg(name,p,i):
 if name=='city':return fixed_bg(name)
 im=ASSETS[name];sw,sh=im.size
 z=1.02+.085*(p if i%2==0 else 1-p)
 cw=sw/z;ch=cw*H/W
 x=(sw-cw)*(.35+.3*p);y=(sh-ch)*(.35+.25*(1-p))
 return im.transform((W,H),Image.Transform.EXTENT,(x,y,x+cw,y+ch),Image.Resampling.BILINEAR)
def text(im,xy,s,size=24,fill=WHITE,anchor=None):
 ImageDraw.Draw(im).text(xy,s,font=font(size),fill=fill,anchor=anchor,stroke_width=0)
def panel(im,box,alpha=220,outline=None):
 lay=Image.new('RGBA',(W,H));ImageDraw.Draw(lay).rounded_rectangle(box,18,fill=(*NAVY,alpha),outline=outline,width=2)
 im.alpha_composite(lay)
def sprite(im,n,x,y,width,alpha=1):
 src=ASSETS[n];h=round(width*src.height/src.width);w=max(1,round(width));h=max(1,h)
 q=src.resize((w,h),Image.Resampling.BILINEAR)
 if alpha<1:q.putalpha(q.getchannel('A').point(lambda a:int(a*alpha)))
 im.alpha_composite(q,(round(x),round(y)))
def shadow(im,x,y,w):
 lay=Image.new('RGBA',(W,H));ImageDraw.Draw(lay).ellipse((x,y,x+w,y+w*.075),fill=(0,15,25,55));im.alpha_composite(lay.filter(ImageFilter.GaussianBlur(7)))
def trace(im,pts,t,color=CYAN,width=3,progress=1):
 pts=[tuple(map(float,p)) for p in pts];lengths=[math.dist(a,b) for a,b in zip(pts,pts[1:])];total=sum(lengths)
 if not total:return
 def point(v):
  d=max(0,min(1,v))*total
  for a,b,l in zip(pts,pts[1:],lengths):
   if d<=l:return (mix(a[0],b[0],d/l),mix(a[1],b[1],d/l))
   d-=l
  return pts[-1]
 lay=Image.new('RGBA',(W,H));dr=ImageDraw.Draw(lay)
 path=[point(progress*k/80) for k in range(81)]
 dr.line(path,fill=(*color,55),width=width+10,joint='curve');dr.line(path,fill=(*color,210),width=width,joint='curve')
 for k in range(8):
  u=(t*.07+k/8)%1
  if u<progress:
   x,y=point(u);dr.ellipse((x-4,y-4,x+4,y+4),fill=(*color,255))
 im.alpha_composite(lay)
def badge(im,x,y,s,color=CYAN):
 w=int(ImageDraw.Draw(im).textlength(s,font=font(18)))+30
 panel(im,(x,y,x+w,y+36),220);text(im,(x+15,y+5),s,18,color)
def ring(im,x,y,t,color=CYAN):
 lay=Image.new('RGBA',(W,H));d=ImageDraw.Draw(lay)
 for j in range(3):
  p=(t*.25+j/3)%1;r=12+45*p;d.ellipse((x-r,y-r*.42,x+r,y+r*.42),outline=(*color,int(200*(1-p))),width=2)
 d.ellipse((x-5,y-5,x+5,y+5),fill=(*color,255));im.alpha_composite(lay)

def phone(im,t,mode=0):
 x=780+int(300*(1-ease(t/2)));y=132
 panel(im,(x,y,x+310,y+443),245,(*CYAN,200));d=ImageDraw.Draw(im)
 d.rounded_rectangle((x+108,y+9,x+202,y+22),7,fill=(0,10,22))
 text(im,(x+25,y+42),'Seneschal',29)
 text(im,(x+25,y+85),'今日を、あなたのペースで。',16,(176,204,222))
 entries=[('09:30','買物・自動充電'),('13:00','共同外出・送迎'),('16:00','学童・習い事'),('18:30','地域の交流')]
 for j,(tm,s) in enumerate(entries):
  yy=y+136+j*61;active=j==min(3,int(t/3.75))
  d.rounded_rectangle((x+18,yy-4,x+292,yy+48),8,fill=(27,72,92) if active else (23,43,63))
  text(im,(x+29,yy+9),tm,18,CYAN if active else (170,190,205));text(im,(x+101,yy+9),s,16)
 text(im,(x+25,y+401),'活動 × 移動 × サービス',17,GREEN)

def assembled(im,x,y,w,body=True,lift=0,bodyname='body'):
 shadow(im,x+30,y+w*.265,w*.9)
 sprite(im,'chassis',x,y,w)
 if body:sprite(im,bodyname+'_mounted',x,y-w*.10-lift,w)

def structural_mh(im,t):
 panel(im,(70,178,1210,575),232);d=ImageDraw.Draw(im)
 gold=ease((t-5)/4);c=tuple(round(CYAN[k]*(1-gold)+GOLD[k]*gold) for k in range(3))
 # H-section steel columns and beams are the storage structure itself.
 for x in [155,380,605]:
  d.rectangle((x,245,x+25,530),fill=(89,119,139),outline=c,width=3)
  d.line((x+12,245,x+12,530),fill=c,width=5)
 for y in [255,365,475]:
  d.rectangle((150,y,635,y+22),fill=(89,119,139),outline=c,width=3)
  trace(im,[(155,y+11),(630,y+11)],t,c,4)
 text(im,(400,211),'柱・梁の鉄骨そのもの',25,WHITE,'mm')
 text(im,(890,275),'H-伝導体MH',32,WHITE,'mm')
 text(im,(890,355),'水素貯蔵  ⇄  電気貯蔵',27,c,'mm')
 text(im,(890,425),'需給に合わせて切替',25,WHITE,'mm')
 text(im,(890,480),'エネルギーマネジメント',23,GREEN,'mm')

def mechanics(im,t,kind):
 panel(im,(70,178,1210,575),232)
 d=ImageDraw.Draw(im)
 if kind=='mill':
  text(im,(105,201),'水力・風力の回転力を活用',28)
  text(im,(240,344),'水力・風力',26,WHITE,'mm')
  text(im,(240,390),'回転力',32,CYAN,'mm')
  # Three parallel branches: no serial generator → mill → AMR connection.
  for j,(cy,lab,out,c) in enumerate([(280,'発電','電力',GOLD),(386,'ミル','水素製造',GREEN),(492,'AMR','冷却',CYAN)]):
   trace(im,[(345,385),(450,385),(450,cy),(640,cy)],t,c,4)
   d.rounded_rectangle((650,cy-36,865,cy+36),12,fill=(24,57,76),outline=c,width=3)
   text(im,(758,cy),lab,28,WHITE,'mm')
   trace(im,[(870,cy),(975,cy)],t,c,4)
   text(im,(1080,cy),out,25,c,'mm')
   r=17;cx=605
   for k in range(4):
    ang=t*2+k*math.pi/2
    d.line((cx,cy,cx+r*math.cos(ang),cy+r*math.sin(ang)),fill=c,width=4)
  text(im,(105,549),'需要に応じて、回転力の配分・接続を切り替える',21,WHITE)
 elif kind=='amr':
  text(im,(100,198),'回転式AMR / 液化・冷却系',26)
  cx,cy=360,385;r=105
  for j in range(12):
   a=j*30+t*35
   d.pieslice((cx-r,cy-r,cx+r,cy+r),a,a+23,fill=CYAN if j%2 else (221,139,90),outline=(195,219,233),width=2)
  d.ellipse((cx-49,cy-49,cx+49,cy+49),fill=NAVY,outline=WHITE,width=3)
  text(im,(cx,cy),'AMR',24,WHITE,'mm')
  for x,lab,c in [(570,'予冷・熱交換',GREEN),(790,'LH2 貯蔵',CYAN),(1010,'追加冷却',GOLD)]:
   d.rounded_rectangle((x-70,330,x+70,445),20,fill=(27,61,83),outline=c,width=2)
   text(im,(x,388),lab,19,WHITE,'mm')
  trace(im,[(465,387),(500,387)],t,CYAN,4)
  trace(im,[(640,387),(720,387)],t,CYAN,4)
  trace(im,[(860,387),(940,387)],t,CYAN,4)
  text(im,(100,535),'冷熱利用は、熱交換・予冷・補助冷却を含む系として描写。',18,(171,194,212))
 elif kind=='pipes':
  text(im,(100,198),'Nodeを結ぶ、供給と情報の基盤',26)
  labs=['LH2 パイプライン / 冷熱','HTS ケーブル / 電力','LH2 冷却光ネットワーク','量子通信']
  colors=[CYAN,GOLD,GREEN,(184,154,255)]
  for j,(lab,c) in enumerate(zip(labs,colors)):
   y=280+j*72
   text(im,(100,y-16),lab,20,c)
   trace(im,[(450,y),(1120,y)],t+j,c,8,ease((t-j*1.2)/5))
   if j==1:
    for k in range(22):d.arc((470+k*27,y-13,490+k*27,y+13),70,290,fill=(*c,210),width=2)
  text(im,(100,550),'各系統の接続関係を示す構想図。配管断面・配置の実施設計ではありません。',16,(171,194,212))

def network(im,t,allnodes=True):
 nodes=[(260,470),(520,370),(855,360),(1000,230),(690,510)]
 edges=[(0,1),(1,2),(2,3),(2,4),(4,0),(1,4)]
 for j,(a,b) in enumerate(edges):
  trace(im,[nodes[a],nodes[b]],t+j,[CYAN,GOLD,GREEN][j%3],3,ease((t-j*.8)/4))
 for j,(x,y) in enumerate(nodes):
  if t>j*.8:ring(im,x,y,t+j);badge(im,x-35,y-48,f'NODE {j+1:02}')

def computing(im,t):
 panel(im,(95,175,1185,575),225)
 names=['Node計算拠点','光・量子通信','LH2冷却RSU']
 xs=[270,640,1010]
 for j,(x,lab) in enumerate(zip(xs,names)):
  ring(im,x,360,t+j,CYAN if j!=1 else (184,154,255))
  d=ImageDraw.Draw(im)
  if j!=1:
   for k in range(4):
    xx=x-80+k*43;d.rounded_rectangle((xx,260,xx+34,400),6,fill=(29,57,80),outline=(112,157,187),width=2)
    for v in range(8):d.rectangle((xx+6,272+v*15,xx+27,277+v*15),fill=CYAN if (v+k+int(t*2))%3 else GOLD)
  else:
   for r in [42,65,88]:d.ellipse((x-r,325-r*.5,x+r,325+r*.5),outline=(184,154,255),width=2)
  text(im,(x,444),lab,24,WHITE,'mm')
 trace(im,[(360,335),(550,335)],t,(184,154,255),4)
 trace(im,[(730,335),(920,335)],t,(184,154,255),4)
 text(im,(640,505),'AIによる需要・配置・運行の判断を支える',26,WHITE,'mm')
 text(im,(640,545),'将来構想｜量子方式に応じた追加冷却・接続条件の検証を含む',17,(174,197,217),'mm')

def federation(im,t):
 panel(im,(90,165,1190,580),230)
 d=ImageDraw.Draw(im)
 for x,w,lab,col in [(140,290,'Seneschal',GREEN),(510,630,'Federation',CYAN)]:
  d.rounded_rectangle((x,195,w+ x if x==140 else 1140,265),14,fill=(25,64,83),outline=col,width=2)
  text(im,(x+25,210),lab,27)
 trace(im,[(430,230),(510,230)],t,GREEN,3)
 labels=['活動','フリート運行','サービス拠点','都市運用']
 detail=['予約・利用・精算','配車・運行・復帰','補充・整備・設備','需給・編成・全体運用']
 for j in range(4):
  x=122+j*268;y=350
  trace(im,[(820,265),(820,305),(x+115,305),(x+115,y)],t+j,CYAN,2,ease((t-j)/3))
  d.rounded_rectangle((x,y,x+240,y+175),12,fill=(24,48,68),outline=(90,143,171),width=2)
  text(im,(x+20,y+19),labels[j],24)
  text(im,(x+20,y+61),detail[j],16,(182,208,224))
  for k in range(9):
   hh=18+27*(.5+.5*math.sin(t*.8+j+k*.8));xx=x+20+k*22
   d.rounded_rectangle((xx,y+143-hh,xx+12,y+143),3,fill=CYAN if j%2 else GREEN)
 text(im,(640,553),'連携の概念表現 / 実アプリのライブ画面ではありません',16,(171,194,212),'mm')

def fixed_bg(name):
 cache=getattr(fixed_bg,'cache',{})
 if name not in cache:cache[name]=ASSETS[name].resize((W,H),Image.Resampling.BILINEAR);fixed_bg.cache=cache
 return cache[name].copy()

def ground_sprite(im,name,cx,ground,w,alpha=1):
 q=ASSETS[name];h=w*q.height/q.width
 if name in ['cafe_front','market_rear']:
  lay=Image.new('RGBA',(W,H));dr=ImageDraw.Draw(lay)
  contacts=[(.10,.70),(.345,.835),(.673,.982)] if name=='cafe_front' else [(.31,.99),(.64,.91),(.89,.84)]
  pts=[(cx-w/2+xx*w,ground-h+yy*h) for xx,yy in contacts]
  dr.polygon([(pts[0][0]-w*.08,pts[0][1]+3),(pts[-1][0]+w*.19,pts[-1][1]+7),(pts[-1][0]+w*.10,pts[-1][1]-w*.035),(pts[0][0]-w*.02,pts[0][1]-w*.035)],fill=(0,12,22,58))
  for x,y in pts:dr.ellipse((x-w*.045,y-3,x+w*.045,y+w*.018),fill=(0,12,22,105))
  im.alpha_composite(lay.filter(ImageFilter.GaussianBlur(5)))
 else:shadow(im,cx-w*.44,ground-w*.018,w*.88)
 sprite(im,name,cx-w/2,ground-h,w,alpha)

def module(im,name,x,bottom,w,legs=0,ground=None):
 h=w*.218;q=ASSETS[name].resize((round(w*.97),round(h)),Image.Resampling.BILINEAR)
 im.alpha_composite(q,(round(x+w*.015),round(bottom-h)))
 if legs>0:
  d=ImageDraw.Draw(im);end=bottom+(ground-bottom)*legs
  for lx in [x+w*.032,x+w*.968]:
   # Telescopic support: outer sleeve travels with the body; inner piston reaches the ground.
   d.line((lx,bottom-12,lx,bottom+2),fill=(109,132,144),width=7)
   d.line((lx,bottom-2,lx,end),fill=(210,222,226),width=4)
   d.line((lx-7,end,lx+7,end),fill=(52,73,84),width=3)

def side_unit(im,x,ground,w,name=None,lower=0,legs=0,body_bottom=None):
 shadow(im,x+w*.03,ground-w*.012,w*.94)
 q=ASSETS['chassis_side'];h=w*q.height/q.width
 sprite(im,'chassis_side',x,ground-h+lower,w)
 if name:module(im,name,x,ground-w*.108 if body_bottom is None else body_bottom,w,legs,ground)

def swap_state(T):
 w=360;left=90;right=830;middle=460;g=453
 mounted=g-w*.108;landed=g-1
 cx=mix(left,middle,ease((T-3)/5)) if T<19 else mix(middle,right,ease((T-19)/5))
 cafe_bottom=mix(mounted,landed,ease((T-8.4)/4))
 market_bottom=mix(landed,mounted,ease((T-15)/4))
 cafe_legs=ease(T/1.8)*(1-ease((T-12.4)/1.4))
 market_legs=ease((T-14.5)/.5)*(1-ease((T-26)/2))
 lower=6*ease((T-1.8)/1.2)*(1-ease((T-24)/2))
 return w,left,right,g,cx,cafe_bottom,market_bottom,cafe_legs,market_legs,lower

# Start, journey time, pair, entry point, destination, mirrored heading.
CROWD=[
 (13.5,7,'family',-45,470,165,473,True),
 (15.5,8,'seniors',645,615,380,479,False),
 (18.0,7,'friends',-55,478,232,478,True),
 (20.5,9,'friends',650,615,300,501,False),
 (23.0,8,'seniors',-45,482,132,497,True),
 (25.0,8,'family',645,618,431,498,False),
 (27.0,8,'friends',650,612,465,477,False),
 (28.5,9,'seniors',645,618,369,526,False),
 (31.0,8,'family',-45,486,220,514,True),
 (32.5,9,'friends',660,618,504,511,False),
 (34.0,8,'seniors',-45,470,105,475,True),
 (35.0,9,'family',650,618,310,536,False),
]

def gathering(im,T):
 people=[]
 for j,(start,dur,kind,sx,sy,ex,ey,flip) in enumerate(CROWD):
  if T<start:continue
  u=min(1,(T-start)/dur)
  # Almost constant walking speed, gently decelerating at the shop entrance.
  v=u if u<.85 else .85+.15*ease((u-.85)/.15)
  x=mix(sx,ex,v);y=mix(sy,ey,v)
  h=53+(y-473)*.19
  if u<1:
   n=f'{kind}_{int((T-start)*6+j)%4}';bob=.65*math.sin((T-start)*12+j)
  else:
   pose=0 if T-start-dur<1.5 else 1
   n=f'{kind}_idle{pose}';bob=.12*math.sin(T*1.6+j)
  if flip:n+='_r'
  q=ASSETS[n];w=h*q.width/q.height
  people.append((y,x,n,w,h,bob))
 # People farther from the camera are drawn first.
 for y,x,n,w,h,bob in sorted(people):
  shadow(im,x-w*.35,y-2,w*.72)
  sprite(im,n,x-w/2,y-h+bob,w)
 # The foreground planting stays in front of approaching pedestrians.
 if people:
  mask=Image.new('L',(W,H));d=ImageDraw.Draw(mask)
  for pts in [
   [(0,488),(40,476),(72,503),(52,550),(75,578),(0,608)],
   [(147,538),(175,491),(202,473),(249,482),(292,515),(278,555),(325,579),(310,610),(140,610)],
   [(399,562),(427,520),(462,507),(501,531),(519,566),(546,586),(541,615),(391,615)],
   [(0,582),(548,582),(548,625),(0,625)]]:d.polygon(pts,fill=255)
  im.paste(fixed_bg('swap_yard'),(0,0),mask)

def swap_scene(im,T,labels=True):
 w,left,right,g,cx,cb,mb,cl,ml,lower=swap_state(T)
 shadow(im,left+12,g-4,w*.96);shadow(im,right+12,g-4,w*.96)
 if T<27:side_unit(im,cx,g,w,lower=lower)
 module(im,'cafe_side',left,cb,w,cl,g)
 if T<27:module(im,'market_side',right,mb,w,ml,g)
 elif T<33:
  u=ease((T-27)/6)
  ground_sprite(im,'market_rear',mix(1010,1170,u),mix(453,340,u),mix(360,105,u),1-ease((T-32)/1))
 gathering(im,T)
 if not labels:return
 badge(im,left,281,'カフェ：地面へ下ろす' if T<12.4 else 'カフェ：接地して開店',GOLD)
 badge(im,right,281,'青果店：地上の店舗' if T<15 else '青果店：持上げ・載せ替え' if T<28 else '青果店：載せ替え完了',CYAN)
 if T<3:st='昇降脚を伸ばして支える → 車台を下げる'
 elif T<8.4:st='車台が店舗の下から抜ける'
 elif T<12.4:st='昇降脚を縮め、店舗の床を地面へ下ろす'
 elif T<15:st='床が地面に接し、普通の店舗になる'
 elif T<19:st='次の店舗を、昇降脚で持ち上げる'
 elif T<26:st='車台が下へ入り、ボディを受け取る'
 else:st='店舗は営業を開始。人々が集まってくる。'
 badge(im,78,176,st,GREEN)

def platoon(im,t):
 # A tracking camera stays with the coupled units while street and road move.
 z=1+.8*ease((t-6.4)/2.4)*(1-ease((t-12)/1))
 if z>1:
  x0=625-625/z;y0=500-500/z
  im.paste(im.transform((W,H),Image.Transform.EXTENT,(x0,y0,x0+W/z,y0+H/z),Image.Resampling.BILINEAR))
 road=Image.new('RGBA',(W,H));dr=ImageDraw.Draw(road)
 dr.rectangle((0,464,W,607),fill=(45,65,77,240))
 dr.line((0,604,W,604),fill=(205,215,218),width=3)
 for k in range(14):
  x=(k*135-t*170)%1550-135;dr.line((x,598,x+66,598),fill=(210,220,225),width=3)
 im.alpha_composite(road)
 z=1+.8*ease((t-6.4)/2.4)*(1-ease((t-12)/1))
 project=lambda x:625+(x-625)*z
 w=275*z;g=500+(548-500)*z;close=ease((t-1)/5)
 split=ease((t-13)/2)
 world_xs=[mix(-120,148,close)-115*split,mix(350,435,close),722+115*split]
 jitter=.5*math.sin(t*9)
 xs=[project(x)+jitter for x in world_xs]
 for k in range(4):
  x=(k*520-t*70)%2080-300
  d=ImageDraw.Draw(im);d.line((x,335,x,421),fill=(145,177,190),width=5)
  d.rounded_rectangle((x-16,309,x+16,339),5,fill=(28,65,80),outline=CYAN,width=2)
  if 2<t<7:trace(im,[(x,335),(min(1150,xs[1]+130),430)],t,CYAN,2)
 bottom=g-w*.108;top=bottom-w*.218;floor=bottom-w*.025
 # Rear walls of flexible gangways connect the flat interior floors.
 if 6<=t<12.5:
  d=ImageDraw.Draw(im)
  for l,r in zip(xs,xs[1:]):
   a=l+w*.97;b=r+w*.03
   d.rectangle((a,top+9*z,b,floor+2*z),fill=(188,201,202),outline=(65,92,100),width=max(1,round(2*z)))
   for xx in np.arange(a,b,4*z):
    d.line((xx,top+9*z,xx,floor),fill=(141,161,167),width=max(1,round(z)))
   d.rectangle((a,floor-2*z,b,floor+3*z),fill=(229,220,197))
   d.line((a,top+8*z,b,top+8*z),fill=(43,77,85),width=max(2,round(4*z)))
 for x in xs:side_unit(im,x,g,w,'passenger_through')
 if 5<t<13:
  d=ImageDraw.Draw(im)
  for l,r in zip(xs,xs[1:]):
   y=g-w*.075
   d.rounded_rectangle((l+w-8*z,y-4*z,r+8*z,y+4*z),max(2,round(2*z)),fill=(171,183,193),outline=WHITE,width=2)
   if t<6.6:ring(im,(l+w+r)/2,y,t,GREEN)
 # Once the gangways are locked, walkers cross actual car boundaries in both directions.
 if t>=6:
  actors=[('rider',6.5,270,655,False,0),('parcel',7.0,865,475,True,-2.5),('shopper',8.0,555,875,False,1.5)]
  for name,start,x0,x1,reverse,depth in actors:
   u=max(0,min(1,(t-start)/(11.5-start)))
   dest_shift=(-115 if x1<423 else 115 if x1>710 else 0)*split
   cx=project(mix(x0,x1,u)+dest_shift)+jitter
   phase=int(max(0,t-start)*6.5)%4
   n=f'transfer_{name}_{phase}'+('_r' if reverse else '')
   q=ASSETS[n];h=(46+depth*.35)*z;ww=h*q.width/q.height
   yy=floor+depth*z+.32*z*math.sin(max(0,t-start)*13)
   sprite(im,n,cx-ww/2,yy-h,ww,ease((t-6)/.55))
  # Near-side window mullions and floor edge remain in front of people.
  d=ImageDraw.Draw(im)
  for x in xs:
   for f in [.04,.12,.24,.36,.48,.60,.72,.84,.96]:
    xx=x+w*f
    d.line((xx,top+7*z,xx,bottom-6*z),fill=(26,73,83),width=max(2,round(3*z)))
   d.line((x+w*.02,bottom-5*z,x+w*.98,bottom-5*z),fill=(220,230,232),width=max(2,round(3*z)))
 d=ImageDraw.Draw(im)
 for x in xs:
  for f in [.13,.50,.86]:
   cx=x+w*f;cy=g-14*z;r=9*z;ang=t*9
   d.line((cx-r*math.cos(ang),cy-r*math.sin(ang),cx+r*math.cos(ang),cy+r*math.sin(ang)),fill=(151,169,175),width=max(2,round(z)))
 badge(im,65,180,'接近 → 物理連結 → 一体で隊列走行',GREEN)
 if t>=13:badge(im,65,237,'連結解除 → それぞれの行先へ',GREEN)
 elif t>=11.5:badge(im,65,237,'乗り移り完了 → 通路を閉じる',GOLD)
 elif t>8:badge(im,65,237,'連結した通路を、乗客と荷物が行き来する',GOLD)
 elif t>6:badge(im,510,265,'連結完了 / 車両間の通路を接続',GREEN)
 else:badge(im,510,265,'連結器を合わせる',GOLD)

def night_work(im,t):
 # Inspect left bay, then clean right bay; an animated inspection scan and vacuum
 # tool show work continuing. The source already shows actual technicians.
 q=ASSETS['night_service'];sw,sh=q.size
 if t<5:
  u=ease(t/5);box=(0,sh*.31,sw*.57,sh*.88)
 elif t<10:
  box=(sw*.43,sh*.31,sw,sh*.88)
 else:
  u=ease((t-10)/4);box=(mix(sw*.14,0,u),mix(sh*.20,0,u),mix(sw*.86,sw,u),mix(sh*.92,sh,u))
 # Fit camera crop to the canvas ratio instead of stretching the picture.
 x0,y0,x1,y1=box;cw=x1-x0;ch=cw*H/W;cy=(y0+y1)/2
 im=q.transform((W,H),Image.Transform.EXTENT,(x0,cy-ch/2,x1,cy+ch/2),Image.Resampling.BILINEAR)
 if t<5:
  xx=330+470*ease((t%5)/5)
  trace(im,[(xx,385),(xx,545)],t,CYAN,3)
  badge(im,65,176,'足回り・機器の点検',CYAN)
 elif t<10:
  d=ImageDraw.Draw(im);v=math.sin((t-5)*2.5)
  badge(im,65,176,'コンテナ店舗の清掃 → 翌日の営業準備',GREEN)
 else:
  badge(im,65,172,'昼のサービスを、夜の整備・清掃が支える',GREEN)
  panel(im,(190,235,1090,338),200)
  text(im,(640,269),'モビリティを、運行事業として成立させる。',31,WHITE,'mm')
  text(im,(640,312),'SATOFUMI GOTO',20,CYAN,'mm')
 return im

def camera(name,cx,cy,scale=1.0):
 q=ASSETS[name];sw,sh=q.size;cw=sw/scale;ch=cw*H/W
 x=max(0,min(sw-cw,cx*sw-cw/2));y=max(0,min(sh-ch,cy*sh-ch/2))
 return q.transform((W,H),Image.Transform.EXTENT,(x,y,x+cw,y+ch),Image.Resampling.BILINEAR)

def walk_child(im,t,cx,ground,height=175):
 # Four distinct walk-cycle poses, body anchored to a consistent ground level.
 n=f'walk{int(t*7)%4}';q=ASSETS[n];w=height*q.width/q.height
 shadow(im,cx-w*.3,ground-2,w*.65)
 sprite(im,n,cx-w/2,ground-height+1.4*math.sin(t*14),w)

def activity(name,t):
 # Short shot / reverse-shot edits and alternate action drawings keep people central.
 if name=='afterschool':
  shot=min(2,int(t/5));u=(t%5)/5
  views=[(.52,.55,1.04),(.23,.64,1.65),(.80,.65,1.60)]
  cx,cy,z=views[shot];alt='afterschool_alt'
 else:
  shot=min(2,int(t/5));u=(t%5)/5
  views=[(.50,.56,1.04),(.46,.59,1.50),(.70,.60,1.48)]
  cx,cy,z=views[shot];alt='senior_alt'
 # Two generated key poses show the activity progressing, not just a static portrait.
 pose=ease(((t%5)-1.65)/.45)
 a=camera(name,cx,cy,z+.035*u)
 if pose>0:
  b=camera(alt,cx,cy,z+.035*u);a=Image.blend(a,b,pose)
 return a

def moving_street(t):
 # Continuous rightward camera translation: buildings and trees visibly pass left.
 q=ASSETS['road_panorama'];sw,sh=q.size;cw=sh*W/H
 x=80+(sw-cw-160)*t/15
 return q.transform((W,H),Image.Transform.EXTENT,(x,0,x+cw,sh),Image.Resampling.BILINEAR)

def frame(i,t):
 name,title,kicker,caps=SCENES[i];p=t/15
 im=Image.new('RGBA',(W,H)) if i in [0,1,2,3,4,5,6,7,8,9,16,19] else bg(name,p,i);d=ImageDraw.Draw(im)
 if i==0:
  if t<5:im=camera('activity_morning',.32,.52,1.32+.035*t/5)
  elif t<10:
   im=fixed_bg('activity_morning');walk_child(im,t,710+(t-5)*35,590,180)
  else:im=camera('activity_morning',.78,.54,1.48+.035*(t-10)/5)
  if t>10:badge(im,65,175,'子供の居場所と、地域の交流',GREEN)
 elif i==1:
  im=activity('afterschool',t)
  if t>10:badge(im,62,168,'Seneschal / 学童・送迎の予定をつなぐ',GREEN)
 elif i==2:
  im=activity('senior_community',t)
  if t>10:badge(im,62,168,'Seneschal / 参加と外出をつなぐ',GREEN)
 elif i==3:
  if t<5:
   im=fixed_bg('avp_phone');ring(im,435,435,t,GREEN)
   badge(im,635,168,'スマホで「駐車・充電」を依頼',GREEN)
   if t>2:badge(im,635,214,'依頼を受け、インフラ側が駐車枠を確保',CYAN)
  else:
   im=fixed_bg('swap_yard');u=ease((t-5)/9)
   cx=mix(465,958,u);g=mix(452,365,u);w=mix(255,125,u)
   trace(im,[(465,452),(710,408),(958,365)],t,CYAN,3)
   ground_sprite(im,'car_away',cx,g,w)
   d=ImageDraw.Draw(im);d.line((1090,218,1090,345),fill=(177,197,205),width=5)
   d.rounded_rectangle((1075,204,1105,235),5,fill=(31,66,83),outline=CYAN,width=2)
   trace(im,[(1090,221),(cx, g-w*.25)],t,CYAN,2)
   badge(im,70,177,'RSUによる周辺把握 → インフラ協調AVP',CYAN)
   badge(im,850,275,'駐車・充電区画',GREEN)
 elif i==4:
  im=fixed_bg('node');cx=490;g=507;w=245
  ground_sprite(im,'car_away',cx,g,w)
  end=mix(583,548,ease(t/2));trace(im,[(583,447),(583,472),(end,472)],t,GREEN,4)
  panel(im,(725,170,1200,280),220);text(im,(750,187),'買物の間に、次の出発に備える',23)
  d=ImageDraw.Draw(im);d.rounded_rectangle((750,238,1173,255),6,fill=(52,80,96));d.rounded_rectangle((750,238,750+423*ease(t/12),255),6,fill=GREEN)
  badge(im,360,545,'自動接続 / 充電中' if t<12 else '補充完了 / 呼出し待ち',GREEN)
 elif i in [5,6]:
  im=fixed_bg('swap_yard');swap_scene(im,t+(15 if i==6 else 0))
 elif i==7:
  im=fixed_bg('swap_yard');swap_scene(im,t+30,False)
  badge(im,65,172,'接地した店舗に、人々が集まってくる',GREEN)
 elif i==8:
  im=camera('plaza',.5,.55,1.10+.08*t/15)
  badge(im,65,180,'そして、そこで暮らす人々の生活が始まる',GOLD)
 elif i==9:
  if t<5:
   im=fixed_bg('node');badge(im,65,180,'人々の毎日を支える、Node',GREEN)
  elif t<10:
   im=camera('node',.82,.45,1.55);badge(im,65,180,'水素・電力・熱を、一体で運用',CYAN)
  else:
   im=camera('node',.28,.45,1.55);badge(im,65,180,'学童・交流・補充・整備の拠点',GOLD)
 elif i==10:
  for j,(pts,lab,c) in enumerate([
   ([(170,400),(430,400),(620,370)],'LH2・冷熱',CYAN),
   ([(610,370),(790,370),(1000,330)],'熱交換・追加冷却',GREEN),
   ([(680,420),(950,475),(1150,475)],'電力・熱の運用',GOLD)]):
   trace(im,pts,t,c,5,ease((t-j*2)/4));badge(im,pts[0][0],pts[0][1]-70,lab,c)
 elif i==11:mechanics(im,t,'mill')
 elif i==12:structural_mh(im,t)
 elif i==13:mechanics(im,t,'pipes')
 elif i==14:
  network(im,t)
 elif i==15:computing(im,t)
 elif i==16:
  im=moving_street(t);platoon(im,t)
 elif i==17:federation(im,t)
 elif i==18:
  if t<5:x=835;y=mix(210,90,ease(t/5));w=270
  else:x=mix(835,-700,ease((t-5)/10));y=mix(90,160,ease((t-5)/10));w=mix(270,660,ease((t-5)/10))
  sprite(im,'evtol',x,y,w)
  ring(im,1030,250,t,GOLD)
  badge(im,75,185,'地上のサービスと、空の移動を接続',GOLD)
 elif i==19:
  im=night_work(im,t)
  if t>10:
   panel(im,(210,520,1070,606),205)
   text(im,(640,536),'Music by Scott Buckley — released under CC-BY 4.0',17,WHITE,'mm')
   text(im,(640,558),'Felicity  /  Where Stars Fall  /  Born Of The Sky',16,WHITE,'mm')
   text(im,(640,580),'www.scottbuckley.com.au  •  creativecommons.org/licenses/by/4.0',13,(190,211,224),'mm')
   text(im,(640,597),'Edited, crossfaded and mixed with field recordings.',11,(190,211,224),'mm')
 # Unified framing: subtle top shade, letterbox, captions and progress.
 lay=Image.new('RGBA',(W,H));dd=ImageDraw.Draw(lay)
 for yy in range(150):dd.line((0,yy,W,yy),fill=(5,19,35,int((65 if i in [4,9,13,14,17,18] else 210)*(1-yy/150))))
 dd.rectangle((0,622,W,H),fill=(5,19,35,230));im.alpha_composite(lay)
 text(im,(40,20),kicker,17,CYAN)
 text(im,(40,54),title,30)
 text(im,(1235,26),'未来構想 / CONCEPT',15,WHITE,'ra')
 text(im,(1235,53),'2.5D ANIMATION',12,(190,210,225),'ra')
 text(im,(640,653),caps[min(2,int(t/5))],24,WHITE,'mm')
 text(im,(40,696),'SATOFUMI GOTO',12,(157,182,202),'lm')
 text(im,(1235,696),f'{i*15+int(t)//60:02}' if False else f'{(i*15+int(t))//60:02}:{(i*15+int(t))%60:02} / 05:00',12,(157,182,202),'rm')
 d=ImageDraw.Draw(im);d.rectangle((0,717,int(W*(i*15+t)/300),719),fill=CYAN)
 fade=min(1,1 if i in [7,8] else t/.65,1 if i in [6,7] else (15-t)/.65)
 if fade<1:
  q=Image.new('RGBA',(W,H),(5,17,29,int(255*(1-fade))));im.alpha_composite(q)
 return im.convert('RGB')

def render_scene(i):
 if not ASSETS:load()
 out=ROOT/'segments'/f'{i:02}.mp4'
 temporary=out.with_name(out.stem+'.working.mp4')
 args=['ffmpeg','-y','-loglevel','error','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','fast','-crf','23','-threads','2','-pix_fmt','yuv420p',str(temporary)]
 proc=subprocess.Popen(args,stdin=subprocess.PIPE)
 for k in range(FPS*15):proc.stdin.write(frame(i,k/FPS).tobytes())
 proc.stdin.close()
 if proc.wait()!=0:raise RuntimeError(i)
 temporary.replace(out)
 (ROOT/'segments'/f'{i:02}.v5').write_text(hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
 return i

def soundtrack():
 rate=48000;n=rate*300
 def decode(name,filters=None):
  cmd=['ffmpeg','-v','error','-i',str(ROOT/'audio'/name)]
  if filters:cmd+=['-af',filters]
  return np.frombuffer(subprocess.check_output(cmd+['-ar',str(rate),'-ac','2','-f','f32le','-']),dtype='<f4').reshape(-1,2).copy()
 # Three-act score: warm optimistic piano-pop, orchestral expansion, then
 # brighter orchestral/drum/guitar climax. Excerpts keep their original pitch/tempo.
 stereo=np.zeros((n,2),np.float32)
 def music_cue(name,start,stop,source_start,target,fadein,fadeout):
  duration=stop-start
  q=decode(name,f'atrim=start={source_start}:duration={duration},asetpts=PTS-STARTPTS,apad,atrim=duration={duration}')
  length=min(len(q),round(duration*rate));q=q[:length]
  q*=target/max(float(np.sqrt(np.mean(q**2))),1e-6)
  tt=np.arange(length,dtype=np.float32)/rate
  # Equal-power overlaps and a natural closing tail avoid abrupt edits.
  env=np.minimum(1,tt/fadein) if fadein else np.ones(length,np.float32)
  if fadeout:env=np.minimum(env,np.maximum(0,(duration-tt)/fadeout))
  env=np.sin(env*np.pi/2)
  a=round(start*rate);stereo[a:a+length]+=q*env[:,None]
 music_cue('felicity.oga',0,138,16,.100,.8,4)
 music_cue('music.oga',134,213,110,.115,4,4)
 music_cue('born_of_the_sky.oga',209,300,96,.152,4,2.5)
 def ambience(name,windows,target,offset=0,buildup=0):
  q=decode(name,'highpass=f=120');q*=target/max(np.sqrt(np.mean(q**2)),1e-6)
  # Equal-power overlaps between repeated field-recording excerpts.
  for a,b in windows:
   start=int(a*rate);stop=int(b*rate);length=stop-start
   clip=np.zeros((length,2),np.float32);step=len(q)-rate
   for j,pos in enumerate(range(-int(offset*rate),length,step)):
    z=q.copy();fade=np.minimum(1,np.arange(len(z))/rate)*np.minimum(1,(len(z)-np.arange(len(z)))/rate)
    z*=fade[:,None]
    lo=max(0,pos);hi=min(length,pos+len(z))
    if hi>lo:clip[lo:hi]+=z[lo-pos:hi-pos]
   tt=np.arange(length,dtype=np.float32)/rate
   env=np.minimum(1,tt/1.5)*np.minimum(1,((b-a)-tt)/1.5)
   if buildup:env*=np.clip(tt/buildup,.12,1)
   stereo[start:stop]+=clip*env[:,None]
 ambience('children.mp3',[(0,30)],.034,2)
 ambience('children.mp3',[(111,135)],.030,2,9)
 ambience('crowd.mp3',[(0,45),(84,90)],.025,5)
 ambience('crowd.mp3',[(106,135)],.038,5,15)
 ambience('birds.ogg',[(0,16),(39,50),(60,95),(103,142)],.023,3)
 # Small designed sounds: confirmation, automated connector and two coupler locks.
 def tone(at,freq,dur,gain):
  t=np.arange(round(dur*rate),dtype=np.float32)/rate
  env=np.minimum(1,t/.012)*np.exp(-t*5/dur)
  q=gain*env*(np.sin(2*np.pi*freq*t)+.20*np.sin(4*np.pi*freq*t))
  a=round(at*rate);stereo[a:a+len(q)]+=q[:,None]
 for a,f in [(46.8,880),(47.05,1174),(62,660),(246,190),(246.12,260)]:tone(a,f,.32,.07)
 peak=float(np.max(np.abs(stereo)));stereo*=min(1,.89/max(peak,1e-6))
 with wave.open(str(ROOT/'score.wav'),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(rate);f.writeframes((stereo*32767).astype('<i2').tobytes())
 print('audio peak',peak,'mixed RMS',float(np.sqrt(np.mean(stereo**2))),flush=True)

def subtitles():
 def tc(s):return f'{s//3600:02}:{s//60%60:02}:{s%60:02},000'
 lines=[]
 for i,sc in enumerate(SCENES):
  for j,c in enumerate(sc[3]):
   st=i*15+j*5;lines.append(f'{len(lines)+1}\n{tc(st)} --> {tc(st+5)}\n{c}\n')
 (ROOT/'Mobility_World_ja.srt').write_text('\n'.join(lines))
 (ROOT/'storyboard.json').write_text(json.dumps(SCENES,ensure_ascii=False,indent=2))

if __name__=='__main__':
 (ROOT/'segments').mkdir(exist_ok=True);(ROOT/'frames').mkdir(exist_ok=True)
 load();subtitles()
 if len(sys.argv)>1 and sys.argv[1]=='preview':
  for i in range(20):frame(i,7.5).save(ROOT/'frames'/f'{i:02}.jpg',quality=88)
  print('20 scene previews saved',flush=True)
 elif len(sys.argv)>1 and sys.argv[1]=='one':
  print(render_scene(int(sys.argv[2])),flush=True)
 elif len(sys.argv)>1 and sys.argv[1]=='audio':soundtrack()
 else:
  selected=list(range(20))
  signature=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
  needed=[i for i in range(20) if not (ROOT/'segments'/f'{i:02}.mp4').exists() or (i in selected and (not (ROOT/'segments'/f'{i:02}.v5').exists() or (ROOT/'segments'/f'{i:02}.v5').read_text()!=signature))]
  with concurrent.futures.ProcessPoolExecutor(max_workers=1) as ex:
   for i in ex.map(render_scene,needed):print('rendered',i,flush=True)
  soundtrack()
  (ROOT/'concat.txt').write_text('\n'.join(f"file '{ROOT}/segments/{i:02}.mp4'" for i in range(20)))
  subprocess.run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',str(ROOT/'concat.txt'),'-i',str(ROOT/'score.wav'),'-c:v','copy','-c:a','aac','-b:a','256k','-t','300','-movflags','+faststart',str(ROOT/'Mobility_World_5min_v6.mp4')],check=True)
  print('COMPLETE',flush=True)
