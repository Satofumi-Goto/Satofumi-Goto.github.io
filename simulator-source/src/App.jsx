import {useSim} from '@/lib/SimContext';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, useParams } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import { SimProvider } from '@/lib/SimContext';
import Layout from '@/components/Layout';
// Add page imports here
import Overview from '@/pages/Overview';
import Scenarios from '@/pages/Scenarios';
import Economics from '@/pages/Economics';
import Assumptions from '@/pages/Assumptions';
import Sensitivity from '@/pages/Sensitivity';
import Report from '@/pages/Report';
import Resilience from '@/pages/Resilience';
import Planning from '@/pages/Planning';

import React,{useEffect,useState,useRef} from 'react';
import {simulate} from '@/lib/simulation/engine';
import {buildBaselineConfig} from '@/lib/simulation/parameterRegistry';
import {runTouchpoint,DEFAULT_ASSUMPTIONS} from '@/lib/simulation/touchpoint';
import {runSharingComparison} from '@/lib/simulation/sharingRoutes';
import {createPresetCities} from '@/lib/simulation/portfolio';
const CHANNEL='federation.mission.business.v1',ORIGIN='https://federation.base44.app';
export function MissionBusiness({controlledSnapshot,controlledSide,onPatch}){
 const params=new URLSearchParams(window.location.search),mode=controlledSnapshot?.mode||(['city','service','sharing','control'].includes(params.get('mode'))?params.get('mode'):'city'),side=controlledSide||(params.get('side')==='after'?'after':'before');
 const [received,setSnapshot]=useState(null),[result,setResult]=useState(null),[error,setError]=useState('');
 const snapshot=controlledSnapshot||received;
 const en=snapshot?.language==='en',t=(ja,enText)=>en?enText:ja,s=snapshot?.settings;
 useEffect(()=>{if(controlledSnapshot)return;const receive=e=>{const d=e.data;if(e.source!==window.parent||e.origin!==ORIGIN||d?.channel!==CHANNEL||d.type!=='snapshot'||d.mode!==mode||!d.settings||!Number.isInteger(d.revision))return;setSnapshot(old=>old&&old.revision>d.revision?old:d);};
 const hello=()=>window.parent.postMessage({channel:CHANNEL,type:'ready',mode},ORIGIN);window.addEventListener('message',receive);hello();const timer=setInterval(hello,1500);return()=>{clearInterval(timer);window.removeEventListener('message',receive);};},[mode]);
 const patch=(key,value)=>onPatch?onPatch({[key]:value}):window.parent.postMessage({channel:CHANNEL,type:'settings.patch',mode,patch:{[key]:value}},ORIGIN);
 useEffect(()=>{setResult(null);setError('');if(!s)return;const timer=setTimeout(()=>{try{
 if(mode==='control'){const b=snapshot.business?.[side];if(b){setResult({requested:b.served+b.rejected+b.unserved,completed:b.served,wait:null,revenue:b.served*s.fare,cost:b.served*s.variableCost+s.fixedCost,contribution:b.served*(s.fare-s.variableCost)-s.fixedCost,violations:b.violations,deferred:b.rejected});}return;}
 if(mode==='sharing'){
 const cities=createPresetCities('2030').map(c=>({...c,demandPerDay:s.demand,fleetSize:s.fleet}));
 const r=runSharingComparison({profile:'2030',cities,seeds:[s.seed],channel:'own_app',mechanisms:{m1:true,m2:true,m3:true},pooling:{maxDetourMin:s.detour,poolDiscount:s.discount/100,consentRate:s.consent/100},cargo:{parcelsPerCityDay:s.parcels,deliveryFee:s.deliveryFee}});
 const m=r.rows.find(x=>x.id===(side==='before'?'solo':'both'));if(!m)throw new Error('Missing sharing comparison');
 const revenue=m.passengerRevenue+m.cargoRevenue;
 setResult({requested:m.requested,completed:m.completed,wait:m.meanWait,revenue,cost:revenue-m.contribution,contribution:m.contribution,delivered:m.delivered,pooled:m.pooledBookings,km:m.totalKm});
 }else if(mode==='service'){
 const cities=createPresetCities('2030').map(c=>({...c,demandPerDay:s.demand,fleetSize:s.fleet}));
 const r=runTouchpoint({profile:'2030',cities,seeds:[s.seed],mechanisms:{m1:s.m1,m2:s.m2,m3:s.m3},assumptions:{...DEFAULT_ASSUMPTIONS}});
 const c=r.channels.find(c=>c.id===(side==='before'?'on_demand':'own_app'));if(!c)throw new Error('Missing comparison channel');
 setResult({requested:c.metrics.requested,completed:c.metrics.completed,wait:c.metrics.meanWait,revenue:c.financial.adjustedRevenue,cost:c.financial.adjustedRevenue-c.financial.netContribution,contribution:c.financial.netContribution});
 }else{
 const duration=side==='before'?s.duration:Math.min(s.duration,s.recovery);
 const events=[{type:'road_closure',startMinute:360,duration,severity:1,target:'station|shopping'},{type:'hub_outage',startMinute:360,duration,severity:1,target:'depot_c'}];
 const r=simulate({...buildBaselineConfig('2030'),seed:s.seed,dailyRequests:s.demand,fleetSize:s.fleet,maxWait:s.maxWait,deploymentPolicy:'staged',events}),m=r.metrics;
 const cost=m.energyCost+m.maintenanceCost+(side==='after'?s.cost:0);
 setResult({requested:m.requested,completed:m.completed,wait:m.meanWait,revenue:m.revenue,cost,contribution:m.revenue-cost});
 }
 }catch(e){setError(String(e.message||e));}},100);return()=>clearTimeout(timer);},[mode,side,JSON.stringify(s),JSON.stringify(snapshot?.business)]);
 const fmt=n=>Number.isFinite(n)?Math.round(n).toLocaleString(en?'en-US':'ja-JP'):'—';
 const fields=mode==='control'?[['fare','運賃（円/件）','Fare (JPY/trip)',0,100000],['variableCost','変動費（円/件）','Variable cost (JPY/trip)',0,100000],['fixedCost','期間固定費（円）','Fixed cost (JPY/period)',0,100000000]]:[['demand','需要（件/日）','Demand/day',0,mode==='sharing'?2300:3000],['fleet','車両数','Vehicles',1,500],['seed','乱数seed','Seed',0,2147483647],...(mode==='sharing'?[['parcels','荷物（件/日）','Parcels/day',0,200],['detour','迂回上限（分）','Detour limit (min)',0,120],['discount','相乗り割引（%）','Pooling discount (%)',0,100],['consent','相乗り同意（%）','Pooling consent (%)',0,100],['deliveryFee','配送単価（円）','Delivery fee (JPY)',0,100000]]:mode==='city'?[['maxWait','迎車期限（分）','Pickup limit (min)',1,120],['duration','Before 障害継続（分）','Before disruption (min)',1,1440],['recovery','After 復旧（分）','After recovery (min)',1,1440],['cost','After 追加費用（円/日）','After extra cost (JPY/day)',0,10000000]]:[])];
 return <main style={{padding:8,fontFamily:'system-ui',fontSize:13,color:'#1e293b',height:'100%',overflow:'auto',boxSizing:'border-box',background:'#fff'}}>
 <strong>{side==='before'?'Before':'After'} · {mode==='sharing'?(side==='before'?t('旅客単独運行','Solo passenger operation'):t('相乗り＋貨客混載','Pooling + cargo')):mode==='control'?(side==='before'?t('制御適用前','Before control'):t('制御適用後','After control')):mode==='city'?(side==='before'?t('障害継続','Continued disruption'):t('連携復旧','Coordinated recovery')):(side==='before'?t('外部オンデマンド','External on-demand'):t('自社アプリ','Own app'))}</strong>
 <p style={{margin:'5px 0',color:'#64748b'}}>{t('共通設定によるモデル試算。実際の売上ではありません。','Counterfactual estimate under shared settings, not measured mission revenue.')}</p>
 <p>{snapshot?t('実演接続済み','Mission connected'):t('共通設定を受信待ち','Waiting for shared settings')} · {snapshot?.eventCount||0} {t('イベント','events')}</p>
 {mode==='control'&&<p>{t('対象期間','Period')}: {snapshot?.business?.periodMinutes||'—'} {t('分。同じ完了件数・受付抑制の結果に共通の運賃と費用を適用します。','min. Shared fares and costs apply to the verified completed and deferred trip counts.')}</p>}
 {mode==='sharing'&&<details><summary>{t('今回の実演結果（計算モデルと区別）','Current mission evidence (separate from model)')}</summary>{(snapshot?.business?.sharedResults?.rows||[]).map(r=><p key={r.tripId}>{r.missionKind==='seneschal-rideshare'?t('相乗り','Pooling'):t('貨客混載','Cargo')} · {r.tripId} · {r.state} · {t('試算売上','Simulated revenue')} ¥{fmt(r.completedRevenueYen)} · {t('実課金','Actual charge')} ¥{fmt(r.chargedAmountYen)} · {fmt(r.consumedKWh)} kWh</p>)}<p>{t('実演の料金を同乗者全員の売上に置き換えたり、単純に年換算したりしません。日次試算は既存モデルの需要・運賃・原価条件を使用します。','Mission fares are not total fares for all co-riders and are not annualized. The daily model uses its existing demand, fare and cost assumptions.')}</p></details>}
 {result&&mode==='sharing'&&<p>{t('相乗り予約','Pooled bookings')}: {fmt(result.pooled)} · {t('配送完了','Deliveries')}: {fmt(result.delivered)} · {fmt(result.km)} km</p>}
 {error&&<p role="alert">{error}</p>}
 {s&&!result&&!error&&<p>{t('計算中…','Calculating…')}</p>}
 {result&&mode==='control'&&<p>{t('制約違反','Violations')}: {fmt(result.violations)} · {t('受付抑制','Deferred')}: {fmt(result.deferred)}</p>}
 {result&&<table style={{width:'100%',borderCollapse:'collapse'}}><tbody>{[[t('完了 / 依頼','Completed / requested'),fmt(result.completed)+' / '+fmt(result.requested)],[t('平均待ち時間（分）','Mean wait (min)'),fmt(result.wait)],[t(mode==='control'?'売上（円/対象期間）':'売上（円/日）',mode==='control'?'Revenue (JPY/period)':'Revenue (JPY/day)'),fmt(result.revenue)],[t(mode==='control'?'費用（円/対象期間）':'対象費用（円/日）',mode==='control'?'Costs (JPY/period)':'Included costs (JPY/day)'),fmt(result.cost)],[t(mode==='control'?'期間利益（円）':'営業貢献（円/日）',mode==='control'?'Period contribution (JPY)':'Contribution (JPY/day)'),fmt(result.contribution)]].map(([label,value])=><tr key={label} style={{borderBottom:'1px solid #e2e8f0'}}><td style={{padding:4}}>{label}</td><td style={{textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{value}</td></tr>)}</tbody></table>}
 {s&&<details open style={{marginTop:8}}><summary style={{cursor:'pointer'}}>{t('設定（両画面・説明文に連動）','Settings (linked to both views and description)')}</summary>{fields.map(([key,ja,eng,min,max])=><label key={key} style={{display:'flex',justifyContent:'space-between',marginTop:4}}>{t(ja,eng)}<input aria-label={t(ja,eng)} type="number" min={min} max={max} step="1" value={s[key]} onChange={e=>{if(e.target.value!==''&&Number.isFinite(e.target.valueAsNumber))patch(key,e.target.valueAsNumber);}} style={{width:85}}/></label>)}{mode==='service'&&[['m1','予定先読み配車','Calendar pre-positioning'],['m2','空き時間提案','Gap offers'],['m3','時間帯平準化','Demand levelling']].map(([key,ja,eng])=><label key={key} style={{display:'block'}}><input type="checkbox" checked={s[key]} onChange={e=>patch(key,e.target.checked)}/>{t(ja,eng)} (After)</label>)}<p>{mode==='sharing'?t('既存の経路共有モデルを使用。運行・アプリ・荷扱い・混載設備償却を控除。車両／拠点投資、人件費、賃料、保険を除外。初期エネルギーのみで日中補給はモデル外。','Uses the existing shared-route model. Deducts operations, app, handling and cargo equipment amortization. Excludes fleet/hub capital, staffing, rent and insurance. Initial energy only; no intraday replenishment.'):mode==='control'?t('期間利益＝完了件数×（運賃−変動費）−期間固定費。運用結果は検証済み実行を使用し、金額条件だけを再計算します。','Period contribution = completed trips × (fare − variable cost) − fixed cost. Uses verified operational results; financial settings only.'):mode==='service'?t('費用には運行費と自社アプリの開発・運営・獲得費用を含みます。車両・拠点投資は除きます。','Costs include operations and app development, operation and acquisition costs; fleet and hub investment excluded.'):t('営業貢献＝売上−エネルギー−走行保守−復旧追加費用。年間固定費・車両／拠点投資は除きます。','Contribution = revenue − energy − maintenance − recovery costs. Excludes annual fixed costs and fleet/hub investment.')}</p></details>}
 </main>;
}

const MISSION_DEFAULTS={city:{demand:300,fleet:25,seed:42,maxWait:15,duration:120,recovery:15,cost:50000},service:{demand:300,fleet:25,seed:42,m1:true,m2:true,m3:true},sharing:{demand:300,fleet:25,seed:42,parcels:50,detour:10,discount:20,consent:60,deliveryFee:1200},control:{fare:1200,variableCost:450,fixedCost:18000}};
const MISSION_LIMITS={parcels:[0,200],detour:[0,120],discount:[0,100],consent:[0,100],deliveryFee:[0,100000],demand:[0,3000],fleet:[1,500],seed:[0,2147483647],maxWait:[1,120],duration:[1,1440],recovery:[1,1440],cost:[0,10000000],fare:[0,100000],variableCost:[0,100000],fixedCost:[0,100000000]};
function LiveMissionPage(){const {mission}=useParams();return <LiveMissionWorkspace key={mission} mode={['city','service','sharing','control'].includes(mission)?mission:'city'}/>;}
function LiveMissionWorkspace({mode}){
 const {lang}=useSim(),frame=useRef(null),runRef=useRef(null),stateRef=useRef(null),[state,setState]=useState({settings:{...MISSION_DEFAULTS[mode]},revision:0}),[workspace,setWorkspace]=useState(null);
 // A locale change must not navigate the iframe and discard the running mission.
 const [frameSrc]=useState(()=>ORIGIN+'/?liveMission=1&embedded=1&mission='+mode+'&language='+lang);
 stateRef.current={...state,language:lang};
 const update=patch=>setState(old=>{const next={};for(const [key,value] of Object.entries(patch||{})){if(!(key in MISSION_DEFAULTS[mode]))continue;if(typeof MISSION_DEFAULTS[mode][key]==='boolean'){if(typeof value==='boolean')next[key]=value;}else if(typeof value==='number'&&Number.isFinite(value)){const [baseMin,baseMax]=MISSION_LIMITS[key];const min=baseMin,max=mode==='sharing'&&key==='demand'?2300:baseMax;next[key]=Math.round(Math.max(min,Math.min(max,value)));}}return {settings:{...old.settings,...next},revision:old.revision+1};});
 useEffect(()=>{const receive=e=>{const d=e.data;if(e.source!==frame.current?.contentWindow||e.origin!==ORIGIN||d?.channel!==CHANNEL||d.mode!==mode)return;if(d.type==='workspace.snapshot'){
 if(mode==='control'&&d.business?.runId&&runRef.current!==d.business.runId){runRef.current=d.business.runId;update(d.business.assumptions);}
 setWorkspace(d);frame.current?.contentWindow?.postMessage({channel:CHANNEL,type:'settings.snapshot',mode,...stateRef.current},ORIGIN);
 }else if(d.type==='settings.patch')update(d.patch);};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[mode]);
 useEffect(()=>{frame.current?.contentWindow?.postMessage({channel:CHANNEL,type:'settings.snapshot',mode,...state,language:lang},ORIGIN);},[state,lang,mode]);
 const snapshot={...workspace,...state,mode,language:lang};
 return <div style={{position:'relative',height:'100%',width:'100%',overflow:'hidden'}}><iframe ref={frame} title="Demo — Live Mission" src={frameSrc} style={{width:'100%',height:'100%',border:0,display:'block'}}/>{['before','after'].map(side=>{const r=workspace?.rects?.[side];return r&&r.width>0&&r.height>0?<div key={side} style={{position:'absolute',left:r.x,top:r.y,width:r.width,height:r.height,background:'#fff',overflow:'hidden',borderRadius:4}}><MissionBusiness controlledSnapshot={snapshot} controlledSide={side} onPatch={update}/></div>:null;})}</div>;
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <SimProvider>
      <ScrollToTop />
      <Routes>
        <Route path="/mission" element={<MissionBusiness />} />
        {/* Add your page Route elements here */}
        <Route element={<Layout />}>
          <Route path="/" element={<Overview />} />
          <Route path="/demo/:mission" element={<LiveMissionPage />} />
          <Route path="/planning" element={<Planning />} />
          <Route path="/resilience" element={<Resilience />} />
          <Route path="/sensitivity" element={<Sensitivity />} />
          <Route path="/scenarios" element={<Scenarios />} />
          <Route path="/economics" element={<Economics />} />
          <Route path="/report" element={<Report />} />
          <Route path="/assumptions" element={<Assumptions />} />
        </Route>
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </SimProvider>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
