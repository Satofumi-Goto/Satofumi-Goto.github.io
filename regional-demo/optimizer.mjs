import {run,makeRequests,validate,NODES} from './engine.mjs';
export function assess(r,g){const service=r.requested?r.completed/r.requested*100:0;return {service,issues:[...(service+1e-9<g.service?[`完了率 ${service.toFixed(1)}%：目標まで ${(g.service-service).toFixed(1)}pt`]:[]),...(r.contribution+1e-6<g.profit?[`日次貢献：目標まで ${Math.ceil(g.profit-r.contribution).toLocaleString()}円`]:[]),...(r.capex>g.capex?[`設備投資：上限を ${Math.ceil(r.capex-g.capex).toLocaleString()}円超過`]:[]),...(r.nightOverrun>0?[`夜間作業：${Math.ceil(r.nightOverrun)}分超過`]:[])]}}
export function solve(c,hubs,g,progress=()=>{}){
 for(const k of ['fleet','spaces','fare','wait','service','profit','capex'])if(!Number.isFinite(g[k]))throw Error('目標値を数値で入力してください');
 if(!Number.isInteger(g.fleet)||g.fleet<1||g.fleet>80||!Number.isInteger(g.spaces)||g.spaces<0||g.spaces>80||g.fare<0||g.fare>10000||g.wait<1||g.wait>60||g.service<=0||g.service>100||g.profit<0||g.capex<0)throw Error('目標の入力範囲を確認してください');
 if(c.demand===0)throw Error('需要を1件以上にして探索してください');
 const fleets=[...new Set([Math.max(1,Math.ceil(g.fleet*.5)),Math.ceil(g.fleet*.75),g.fleet])];
 const layouts=[{name:'現在の配置',hubs},{name:'住宅地を重視',hubs:[NODES[1].p,NODES[2].p,NODES[3].p]},{name:'駅・業務地を重視',hubs:[NODES[0].p,NODES[3].p,NODES[5].p]}];
 const candidates=[],requests=makeRequests(c);let count=0;
 for(const fleet of fleets)for(const spaces of [...new Set([0,Math.min(g.spaces,Math.ceil(fleet/2)),Math.min(g.spaces,fleet)])])for(const layout of layouts)for(const pool of [false,true])for(const night of [false,true]){
 const config={...c,fleet,spaces,parking:spaces>0,pool,night,maxWait:g.wait,fare:Math.min(c.fare,g.fare)};validate(config,layout.hubs);
 let r=run(config,layout.hubs,false,requests);
 const weight=r.outcomes.filter(x=>x.status==='completed'&&x.type==='passenger').reduce((s,x)=>s+(x.pooled?.9:1),0);
 const needed=weight?Math.max(0,Math.ceil((r.cost+g.profit-r.delivered*500)/weight)):Infinity;
 config.fare=Math.min(g.fare,Math.max(config.fare,Number.isFinite(needed)?needed:config.fare));
 // Fare does not alter demand or dispatch in this model; reprice the same completed bookings.
 r.config.fare=config.fare;for(const o of r.outcomes)if(o.status==='completed'&&o.type==='passenger')o.revenue=config.fare*(o.pooled?.9:1);
 r.revenue=r.outcomes.reduce((s,o)=>s+o.revenue,0);r.contribution=r.revenue-r.cost;
 const a=assess(r,g),score=Math.max(0,g.service-a.service)/100+Math.max(0,g.profit-r.contribution)/Math.max(10000,g.profit)+Math.max(0,r.capex-g.capex)/Math.max(1,g.capex)+r.nightOverrun/480;
 candidates.push({config,hubs:layout.hubs.map(p=>[...p]),layout:layout.name,r,a,needed,score});count++;progress(count);
 }
 const valid=candidates.filter(x=>!x.a.issues.length),source=valid.length?valid:candidates.sort((a,b)=>a.score-b.score).slice(0,12),selected=[];
 for(const [title,key,sign] of [['収支優先','contribution',-1],['待ち時間優先','wait',1],['投資抑制','capex',1]]){const sorted=[...source].sort((a,b)=>sign*(a.r[key]-b.r[key]));const x=sorted.find(x=>!selected.some(s=>s.candidate===x))||sorted[0];selected.push({title,candidate:x})}
 const cards=selected.map(({title,candidate:x})=>{
 const stress=[['需要20%減',{demand:Math.max(1,Math.floor(c.demand*.8))}],['需要40%減',{demand:Math.max(1,Math.floor(c.demand*.6))}],['電力単価50%増',{electricity:Math.min(200,c.electricity*1.5)}],['駐車単価2倍',{parkingRate:Math.min(1000,c.parkingRate*2)}],['駐車枠半減',{spaces:Math.floor(x.config.spaces/2)}],['駐車枠全離脱',{spaces:0}]].map(([label,patch])=>{const r=run({...x.config,...patch},x.hubs);const a=assess(r,g);return{label,contribution:r.contribution,service:a.service,issues:a.issues}});
 const parkingLimit=x.config.spaces?Math.floor((x.r.contribution-g.profit+x.r.costs.parking)/(x.config.spaces*16)):null;
 const {cars,outcomes,...metrics}=x.r;
 return{title,config:x.config,hubs:x.hubs,layout:x.layout,metrics,service:x.a.service,issues:x.a.issues,needed:Number.isFinite(x.needed)?x.needed:null,parkingLimit,stress,nightMinutes:x.config.fleet*(x.config.night?10:15)+(x.config.night?1:3)*30};
 });return{goals:g,input:c,inputHubs:hubs,tested:count,feasible:valid.length,cards,scope:'限定候補探索。全域の最適解・事業成立の保証ではありません。運賃による需要変化は未推定。'};
}
