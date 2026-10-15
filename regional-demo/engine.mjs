export const REGIONS={tokyo:{name:'東京駅周辺',lat:35.6812,lng:139.7671},nagoya:{name:'名古屋駅周辺',lat:35.1709,lng:136.8815},toyota:{name:'豊田市駅周辺',lat:35.0887,lng:137.1564}};
export const DEFAULTS={region:'tokyo',fleet:30,demand:400,spaces:24,parkingRate:40,fare:1200,speed:22,maxWait:8,electricity:30,storageHours:4,storageUnit:50000,pool:false,cargo:false,night:true,parking:true,seed:42};
export const NODES=[{name:'駅周辺',p:[0,0],kind:'station'},{name:'住宅エリア A（仮想）',p:[-1.5,-.9],kind:'home'},{name:'住宅エリア B（仮想）',p:[1.3,.9],kind:'home'},{name:'業務エリア（仮想）',p:[.7,-1],kind:'work'},{name:'生活サービス（仮想）',p:[-1,.6],kind:'service'},{name:'商業エリア（仮想）',p:[.3,1.3],kind:'shop'}];
export const HUBS=[[-1.25,-.6],[1,.65],[.25,-.75]];
export const DAY=960;
export const ROAD=1.3;
const clone=p=>[...p];
export const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])*ROAD;
function random(seed){let s=seed>>>0;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296}}
export function validate(c,hubs){for(const [k,lo,hi] of [['fleet',0,80],['demand',0,1500],['spaces',0,80],['parkingRate',0,1000],['fare',0,10000],['speed',5,60],['maxWait',1,60],['electricity',0,200],['storageHours',0,16],['storageUnit',0,200000]])if(!Number.isFinite(c[k])||c[k]<lo||c[k]>hi)throw Error('入力範囲を確認してください: '+k);for(const k of ['fleet','demand','spaces'])if(!Number.isInteger(c[k]))throw Error('台数・件数は整数で指定してください');if(!REGIONS[c.region]||hubs.length!==3||hubs.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v)||Math.abs(v)>3)))throw Error('地域・拠点位置が範囲外です');}
export function makeRequests(c){const rng=random(c.seed),requests=[];for(let i=0;i<c.demand;i++){const peak=rng(),t=Math.floor(peak<.4?60+rng()*150:peak<.7?600+rng()*180:rng()*DAY);let o,d;if(t<240){o=rng()<.5?1:2;d=rng()<.7?0:3}else if(t>600){o=rng()<.6?0:3;d=rng()<.5?1:2}else{o=Math.floor(rng()*6);d=(o+1+Math.floor(rng()*5))%6}requests.push({id:'R'+String(i+1).padStart(4,'0'),type:'passenger',release:t,origin:o,dest:d});}for(let i=0;i<30;i++){const o=Math.floor(rng()*6),d=(o+1+Math.floor(rng()*5))%6;requests.push({id:'C'+String(i+1).padStart(3,'0'),type:'cargo',release:Math.floor(180+rng()*540),origin:o,dest:d});}return requests.sort((a,b)=>a.release-b.release||a.id.localeCompare(b.id));}
function pointOn(leg,t){const f=Math.min(1,Math.max(0,(t-leg.start)/(leg.end-leg.start||1)));return leg.from.map((v,i)=>v+(leg.to[i]-v)*f)}
export function positionAt(car,t){for(let i=car.legs.length-1;i>=0;i--){const l=car.legs[i];if(t>=l.start)return pointOn(l,t)}return clone(car.initial)}
export function run(c,hubs,base=false,requests=makeRequests(c)){
 validate(c,hubs);const parking=!base&&c.parking,night=!base&&c.night,pool=!base&&c.pool,cargo=!base&&c.cargo;
 const cars=Array.from({length:c.fleet},(_,i)=>({id:i+1,initial:clone(NODES[i%6].p),p:clone(NODES[i%6].p),home:clone(hubs[i%3]),reserved:parking&&i<Math.min(c.spaces,c.fleet),busyUntil:0,legs:[],rng:random(c.seed+i*17)}));
 const active=requests.filter(r=>r.type==='passenger'||cargo),outcomes=[],waiting=[];let index=0;
 const addLeg=(car,from,to,start,end,kind,ids=[])=>{if(end>start)car.legs.push({from:clone(from),to:clone(to),start,end,kind,ids,km:distance(from,to)});};
 const stopIdle=(car,t)=>{const l=car.legs.at(-1);if(l&&l.end>t){car.p=pointOn(l,t);l.to=clone(car.p);l.end=t;l.km=distance(l.from,l.to);if(l.end===l.start)car.legs.pop()}else car.p=positionAt(car,t)};
 for(let t=0;t<DAY;t++){
  while(index<active.length&&active[index].release<=t)waiting.push(active[index++]);
  for(let q=0;q<waiting.length;){const r=waiting[q],limit=r.type==='cargo'?30:c.maxWait;if(t-r.release>limit){outcomes.push({...r,status:'rejected',reason:'待ち時間上限',revenue:0});waiting.splice(q,1);continue;}
   const origin=NODES[r.origin].p,dest=NODES[r.dest].p,ride=distance(origin,dest)/c.speed*60;let best=null;
   for(const car of cars){if(car.busyUntil>t)continue;const pos=positionAt(car,t),pickup=t+distance(pos,origin)/c.speed*60;if(pickup-r.release>limit)continue;const end=pickup+ride+(r.type==='cargo'?4:1);if(end>DAY)continue;if(!best||pickup<best.pickup)best={car,pos,pickup,end};}
   if(!best){q++;continue;}
   const group=[r];let pax=r.type==='passenger'?1:0,parcels=r.type==='cargo'?1:0;
   for(const other of waiting){if(other===r||other.origin!==r.origin||other.dest!==r.dest)continue;if(best.pickup-other.release>(other.type==='cargo'?30:c.maxWait))continue;if(other.type==='passenger'&&(pax===0||(pool&&pax<4))){group.push(other);pax++}else if(other.type==='cargo'&&cargo&&parcels<2){group.push(other);parcels++}}
   const end=best.pickup+ride+1+parcels*4;if(end>DAY){q++;continue;}
   const car=best.car;stopIdle(car,t);const ids=group.map(x=>x.id);addLeg(car,best.pos,origin,t,best.pickup,'pickup',ids);addLeg(car,origin,dest,best.pickup,best.pickup+ride,'service',ids);addLeg(car,dest,dest,best.pickup+ride,end,'handling',ids);car.busyUntil=end;
   for(const req of group){outcomes.push({...req,status:'completed',vehicle:car.id,dispatch:t,pickup:best.pickup,dropoff:best.pickup+ride,end,wait:best.pickup-req.release,pooled:req.type==='passenger'&&pax>1,revenue:req.type==='cargo'?500:c.fare*(pax>1?.9:1),group:ids});waiting.splice(waiting.indexOf(req),1)}
  }
  for(const car of cars){if(car.busyUntil>t)continue;const last=car.legs.at(-1);if(last&&last.end>t)continue;car.p=positionAt(car,t);if(car.reserved){const km=distance(car.p,car.home);if(km<.001)continue;const full=km/c.speed*60,dur=Math.min(full,DAY-t),to=car.p.map((v,i)=>v+(car.home[i]-v)*dur/full);addLeg(car,car.p,to,t,t+dur,'relocate');}else{let target=NODES[Math.floor(car.rng()*6)].p;if(distance(car.p,target)<.01)target=NODES[(car.id+t)%6].p;const full=distance(car.p,target)/15*60;if(full>.001){const dur=Math.min(full,DAY-t),to=car.p.map((v,i)=>v+(target[i]-v)*dur/full);addLeg(car,car.p,to,t,t+dur,'cruise')}}}
 }
 for(const r of waiting)outcomes.push({...r,status:'rejected',reason:'営業終了',revenue:0});
 let km=0,cruiseKm=0,emptyKm=0,roadMinutes=0,parkMinutes=0,nightKm=0,maxNightMinutes=0;
 const depots=[[-1.7,1.6],[1.7,-1.4],[1.6,1.5]],central=[-.6,1.7];
 for(const car of cars){for(const l of car.legs){km+=l.km;if(l.kind==='cruise')cruiseKm+=l.km;if(l.kind==='cruise'||l.kind==='relocate'||l.kind==='pickup')emptyKm+=l.km;if(l.km>0)roadMinutes+=l.end-l.start;}const occupied=car.legs.reduce((s,l)=>s+l.end-l.start,0);if(car.reserved)parkMinutes+=DAY-occupied;const end=positionAt(car,DAY),service=night?central:depots[car.id%3],next=car.initial;const n=distance(end,service)+distance(service,next);nightKm+=n;maxNightMinutes=Math.max(maxNightMinutes,n/c.speed*60);}
 km+=nightKm;emptyKm+=nightKm;roadMinutes+=nightKm/c.speed*60;
 const completed=outcomes.filter(r=>r.status==='completed'),passengers=completed.filter(r=>r.type==='passenger'),delivered=completed.filter(r=>r.type==='cargo');
 const energy=(km*.2+parkMinutes/60*.2)/.9,storage=energy*c.storageHours/16*1.1/.8,storageCapex=storage*c.storageUnit;
 const sites=c.fleet?night?1:3:0,serviceHours=(c.fleet*(night?10:15)+sites*30)/60,nightOverrun=Math.max(0,serviceHours/2*60+maxNightMinutes-480);
 const costs={energy:energy*c.electricity,maintenance:km*8,parking:parking?Math.min(c.spaces,c.fleet)*16*c.parkingRate:0,service:serviceHours*2000,rent:sites?(night?8000:12000):0,fleet:c.fleet*1200,operations:c.fleet?5000:0,handling:delivered.length*100,depreciation:(storageCapex+sites*300000)/10/365};
 const revenue=completed.reduce((s,r)=>s+r.revenue,0),cost=Object.values(costs).reduce((a,b)=>a+b,0),contribution=revenue-cost;
 return {base,config:{...c},hubs:hubs.map(clone),requested:c.demand,completed:passengers.length,rejected:c.demand-passengers.length,delivered:delivered.length,pooled:passengers.filter(r=>r.pooled).length,wait:passengers.length?passengers.reduce((s,r)=>s+r.wait,0)/passengers.length:0,km,cruiseKm,emptyKm,roadHours:roadMinutes/60,parkHours:parkMinutes/60,nightKm,nightOverrun,energy,storage,storageCapex,capex:storageCapex+sites*300000,costs,revenue,cost,contribution,outcomes,cars:cars.map(({rng,...car})=>car)};
}
export function compare(c,hubs){const requests=makeRequests(c);return{revision:'regional-lab-1',requests,baseline:run(c,hubs,true,requests),proposal:run(c,hubs,false,requests)}};
