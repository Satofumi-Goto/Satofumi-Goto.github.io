import { POOLING_DEFAULTS, CARGO_DEFAULTS, validatePooling, validateCargo } from './sharingDefaults.js';

// Pure pre-departure batch scheduler; NO en-route redispatch or stop changes.
// Units: releaseT/waitStart/deadline in minutes, distance in km, travelMinutes in minutes.
// Only already-released jobs join a batch. Consent is supplied, never randomly generated.
// pooling.enabled / cargo.enabled select all four scenarios using this SAME runner.
// startNode defaults to the earliest job's origin (explicit synthetic initial placement).
export function runSharingRoutes({ requests = [], parcels = [], vehicleCount = 1, startNode,
  distance, travelMinutes, pooling = {}, cargo = {}, endTime = Infinity, startNodes = [], vehicleKmLimits = [] }) {
  if (!Number.isInteger(vehicleCount) || vehicleCount < 0 || typeof distance !== 'function' || typeof travelMinutes !== 'function') throw new TypeError('Invalid fleet or lookups');
  const p = validatePooling({ ...POOLING_DEFAULTS, ...pooling });
  const c = validateCargo({ ...CARGO_DEFAULTS, ...cargo });
  const positive = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new RangeError('Expected a finite nonnegative value');
    return n;
  };
  const jobs = [...requests.map((r, i) => ({ ...r, kind: 'passenger', key: `p${i}` })),
    ...parcels.map((r, i) => ({ ...r, kind: 'cargo', key: `c${i}` }))].map((r) => {
    const releaseT = positive(r.releaseT ?? 0), passenger = r.kind === 'passenger';
    const earliest = Math.max(releaseT, positive(r.waitStart ?? releaseT));
    const latest = passenger ? earliest + positive(r.maxWaitMin ?? r.maxWait ?? p.maxWaitMin)
      : positive(r.deliveryDeadline ?? r.deadline ?? releaseT + c.deliveryWindowMin);
    return { ...r, releaseT, earliest, latest, status: 'pending', vehicleId: null,
      partySize: passenger ? positive(r.partySize ?? 1) : 0,
      kg: passenger ? 0 : positive(r.kg ?? c.parcelKg), m3: passenger ? 0 : positive(r.m3 ?? c.parcelM3),
      consent: (r.poolingConsent ?? r.consent) === true,
      maxDetour: positive(r.maxDetourMin ?? p.maxDetourMin) };
  }).sort((a, b) => a.releaseT - b.releaseT);
  const byKey = new Map(jobs.map((r) => [r.key, r]));
  const fleet = Array.from({ length: vehicleCount }, (_, id) => ({ id, node: startNodes[id] ?? startNode ?? jobs[0]?.origin, ready: 0, km: 0 }));
  const tours = [], legs = [];
  const stop = (r, action) => ({ key: r.key, action, node: action === 'pickup' ? r.origin : r.dest });

  // Recompute the entire proposed tour, including every load interval and dwell.
  function scan(v, stops, departureTime) {
    let node = v.node, clock = departureTime, km = 0;
    const aboard = new Map(), pickups = new Map(), outcomes = new Map(), trace = [], segments = [];
    for (const s of stops) {
      const r = byKey.get(s.key), d = distance(node, s.node), duration = travelMinutes(node, s.node);
      if (![d, duration].every((n) => Number.isFinite(n) && n >= 0)) return null;
      const occupants = [...aboard.values()], passengers = occupants.filter((j) => j.kind === 'passenger');
      const passengerCount = passengers.reduce((n, j) => n + j.partySize, 0);
      const cargoKg = occupants.reduce((n, j) => n + j.kg, 0), cargoM3 = occupants.reduce((n, j) => n + j.m3, 0);
      segments.push({ from: node, to: s.node, startTime: clock, endTime: clock + duration,
        km: d, travelMinutes: duration, passengerCount, cargoKg, cargoM3,
        passengerKeys: passengers.map((j) => j.key), parcelKeys: occupants.filter((j) => j.kind === 'cargo').map((j) => j.key) });
      km += d; clock += duration;
      const arrivalTime = clock;
      if (s.action === 'pickup') {
        clock = Math.max(clock, r.earliest);
        if (clock > r.latest || (r.kind === 'cargo' && !cargo.enabled)) return null;
        aboard.set(r.key, r); pickups.set(r.key, clock);
      } else {
        if (!aboard.has(r.key)) return null;
        if (r.kind === 'passenger' && clock - pickups.get(r.key) > travelMinutes(r.origin, r.dest) + r.maxDetour + 1e-9) return null;
        aboard.delete(r.key);
      }
      const serviceTime = clock;
      clock += r.kind === 'cargo' ? c.handlingMin : 0;
      if (r.kind === 'cargo' && clock > r.latest + 1e-9) return null;
      const load = [...aboard.values()], riding = load.filter((j) => j.kind === 'passenger');
      if (riding.reduce((n, j) => n + j.partySize, 0) > p.seats ||
        load.reduce((n, j) => n + j.kg, 0) > c.cargoCapacityKg + 1e-9 ||
        load.reduce((n, j) => n + j.m3, 0) > c.cargoCapacityM3 + 1e-9) return null;
      if (riding.length > 1 && (!pooling.enabled || riding.some((j) => !j.consent))) return null;
      trace.push({ ...s, kind: r.kind, requestId: r.id ?? r.key, arrivalTime, serviceTime, departureTime: clock, dwellMinutes: clock - serviceTime });
      if (s.action === 'dropoff') outcomes.set(r.key, { pickupTime: pickups.get(r.key), dropoffTime: clock,
        wait: pickups.get(r.key) - r.earliest, rideMinutes: serviceTime - pickups.get(r.key) });
      node = s.node;
    }
    return aboard.size || clock > endTime || v.km + km > (vehicleKmLimits[v.id] ?? Infinity) ? null : { km, arrivalTime: clock, endNode: node, stops: trace, legs: segments, outcomes };
  }

  let now = jobs[0]?.releaseT ?? 0;
  while (jobs.some((r) => r.status === 'pending')) {
    for (const r of jobs) if (r.status === 'pending' && r.latest < now) {
      r.status = 'rejected'; r.reason = r.kind === 'cargo' && !cargo.enabled ? 'cargo_disabled' : 'deadline';
    }
    let dispatched = false;
    for (const v of fleet) {
      if (v.ready > now) continue;
      const released = jobs.filter((r) => r.status === 'pending' && r.releaseT <= now);
      let chosen = [], plan = null, seed = null;
      for (const r of released) {
        const initial = [stop(r, 'pickup'), stop(r, 'dropoff')];
        const result = scan(v, initial, now);
        if (result) { chosen = initial; plan = result; seed = r; break; }
      }
      if (!plan) continue;
      for (const r of released) {
        if (chosen.length >= 16) break; // Bounded greedy search: maximum eight jobs per departure.
        if (r === seed || (r.kind === 'cargo' && !cargo.enabled)) continue;
        let best = null, bestStops = null;
        for (let i = 0; i <= chosen.length; i++) for (let j = i + 1; j <= chosen.length + 1; j++) {
          const candidate = chosen.slice();
          candidate.splice(i, 0, stop(r, 'pickup')); candidate.splice(j, 0, stop(r, 'dropoff'));
          const result = scan(v, candidate, now);
          if (result && (!best || result.km < best.km - 1e-9)) { best = result; bestStops = candidate; }
        }
        if (best) { chosen = bestStops; plan = best; }
      }
      const tourId = tours.length;
      for (const [key, outcome] of plan.outcomes) Object.assign(byKey.get(key), outcome, { status: 'completed', vehicleId: v.id, tourId });
      const tourLegs = plan.legs.map((leg) => ({ ...leg, tourId, vehicleId: v.id }));
      tours.push({ id: tourId, vehicleId: v.id, departureTime: now, arrivalTime: plan.arrivalTime,
        km: plan.km, stops: plan.stops, legs: tourLegs });
      legs.push(...tourLegs);
      v.node = plan.endNode; v.ready = plan.arrivalTime; v.km += plan.km; dispatched = true;
    }
    if (dispatched) continue; // Future completion releases the vehicle; no en-route insertion.
    for (const r of jobs) if (r.status === 'pending' && r.releaseT <= now && r.latest <= now) {
      r.status = 'rejected'; r.reason = r.kind === 'cargo' && !cargo.enabled ? 'cargo_disabled' : 'deadline';
    }
    const pending = jobs.filter((r) => r.status === 'pending');
    const next = Math.min(...pending.flatMap((r) => [r.releaseT, r.latest]).filter((t) => t > now),
      ...fleet.map((v) => v.ready).filter((t) => t > now));
    if (!Number.isFinite(next)) break;
    now = next;
  }
  for (const r of jobs) if (r.status === 'pending') { r.status = 'rejected'; r.reason = 'infeasible'; }
  const terminal = (kind) => jobs.filter((r) => r.kind === kind).map((r) => ({ ...r }));
  return { requests: terminal('passenger'), parcels: terminal('cargo'), tours, legs };
}

export default runSharingRoutes;
// Scenario layer: same released demand and scheduler for all four modes.
// Deliberately separate from the existing charging/queue engine. Initial usable
// energy is a hard daily distance budget; NO intraday replenishment is modelled.
import { generateBaseDemand, applyMechanisms, DEFAULT_ASSUMPTIONS, DEFAULT_CHANNEL_CAPS, CHANNELS } from './touchpoint.js';
import { buildBaselineConfig } from './parameterRegistry.js';
import { buildGraph, distBetween, NODES, EDGES, pathBetween } from './graph.js';
import { mulberry32 } from './rng.js';
export const SHARING_MODES = [
  { id: 'solo', ja: '単独運行', en: 'Solo', pool: false, cargo: false },
  { id: 'pool', ja: '④ 相乗り', en: '④ Pooling', pool: true, cargo: false },
  { id: 'cargo', ja: '⑤ 貨客混載', en: '⑤ Cargo', pool: false, cargo: true },
  { id: 'both', ja: '④＋⑤', en: '④ + ⑤', pool: true, cargo: true },
];
export function runSharingComparison({ cities, profile = '2035', seeds = [42], channel = 'own_app', mechanisms = {m1:true,m2:true,m3:true}, assumptions = {}, pooling = {}, cargo = {} }) {
  if (!CHANNELS.some(ch => ch.id === channel)) throw new Error('Unknown channel');
  if (!cities.length || !seeds.length || seeds.some(s => !Number.isFinite(s))) throw new Error('Cities and finite seeds required');
  if (cities.some(c => c.demandPerDay === '' || !Number.isInteger(Number(c.demandPerDay)) || Number(c.demandPerDay) < 0 || !Number.isInteger(Number(c.fleetSize)) || Number(c.fleetSize) < 0)) throw new Error('Enter nonnegative integer demand and fleet');
  const cfg = buildBaselineConfig(profile), a = {...DEFAULT_ASSUMPTIONS,...assumptions};
  if (Object.values(a).some(v=>!Number.isFinite(Number(v))||Number(v)<0)||a.appDevAmortizationYears<=0||a.acquisitionAmortizationYears<=0||['appAdoption','scheduleConsent','recommendationAcceptance','incrementalFraction','flexibleShare','shiftAcceptance'].some(k=>a[k]>1)||a.discountPercent>100) throw new Error('Invalid app assumptions');
  const p = validatePooling({...POOLING_DEFAULTS,...pooling}), c = validateCargo({...CARGO_DEFAULTS,...cargo});
  // Explicit work limit: reject oversized input; never silently sample requests.
  if (cities.length * seeds.length > 100 || cities.some(x => Number(x.demandPerDay) + c.parcelsPerCityDay > 2500)) throw new Error('Limit: 2,500 jobs/city and 100 city-seed combinations');
  const graph = buildGraph(), distance = (x,y) => distBetween(graph,x,y), travelMinutes = (x,y) => distance(x,y) / cfg.speed * 60;
  const endTime = (cfg.opEnd-cfg.opStart)*60, runs = [];
  for (const seed of seeds) for (const [ci, city] of cities.entries()) {
    const citySeed = (seed + ci*10007) >>> 0;
    const base = generateBaseDemand({...city,demandPerDay:Number(city.demandPerDay)},cfg,citySeed);
    const {reqs} = applyMechanisms(channel,base,city,cfg,mechanisms,a,DEFAULT_CHANNEL_CAPS[channel],citySeed);
    const rng = mulberry32(citySeed ^ 0x76a2bf19);
    const requests = reqs.map(r => ({...r,poolingConsent: !!r.booked && rng()<p.consentRate,maxWaitMin:p.maxWaitMin}));
    const parcelRng = mulberry32(citySeed ^ 0x4d9b21);
    const nodes = Object.keys(NODES).filter(n=>NODES[n].kind!=='depot');
    const parcels = Array.from({length:c.parcelsPerCityDay},(_,i)=>{
      const oi=Math.floor(parcelRng()*nodes.length), di=(oi+1+Math.floor(parcelRng()*(nodes.length-1)))%nodes.length;
      const releaseT=Math.floor(parcelRng()*endTime);
      return {id:`parcel_${i}`,origin:nodes[oi],dest:nodes[di],releaseT,deliveryDeadline:Math.min(endTime,releaseT+c.deliveryWindowMin),kg:c.parcelKg,m3:c.parcelM3};
    });
    const available=Math.floor(Number(city.fleetSize)*Math.max(0,Math.min(1,city.availability??1)));
    const hubs=(city.hubIds||[]).filter(id=>city.hubs[id]?.active).map(id=>city.hubs[id].node).filter(n=>NODES[n]);
    if (available && !hubs.length) throw new Error('Each operating city needs an active hub');
    const bevCount=Math.round(available*cfg.bevShare);
    const limits=Array.from({length:available},(_,i)=>i<bevCount ? cfg.bevCapacityKwh*Math.max(0,cfg.initialEnergyPct-cfg.reserve)/cfg.bevKwhPerKm : cfg.fcTankKg*Math.max(0,cfg.initialEnergyPct-cfg.reserve)/cfg.fcKgPerKm);
    for (const mode of SHARING_MODES) {
      const cargoOn=mode.cargo && c.parcelsPerCityDay>0;
      const trace=runSharingRoutes({requests:requests.filter(r=>!r.willCancel),parcels:cargoOn?parcels:[],vehicleCount:available,startNodes:Array.from({length:available},(_,i)=>hubs[i%hubs.length]),vehicleKmLimits:limits,endTime,distance,travelMinutes,pooling:{...p,enabled:mode.pool},cargo:{...c,enabled:cargoOn}});
      const done=trace.requests.filter(r=>r.status==='completed'), delivered=trace.parcels.filter(r=>r.status==='completed');
      const pooledKeys=new Set(trace.legs.filter(l=>l.km>0 && l.passengerKeys.length>1).flatMap(l=>l.passengerKeys));
      const sharedTours=new Set(trace.legs.filter(l=>l.km>0 && l.passengerKeys.length>1).map(l=>l.tourId));
      const sum=(xs,fn)=>xs.reduce((s,x)=>s+fn(x),0);
      const totalKm=sum(trace.legs,l=>l.km), passengerKm=sum(trace.legs,l=>l.km*l.passengerCount);
      const shiftDiscount=sum(done,r=>r.shifted?cfg.fare*a.discountPercent/100:0);
      const poolDiscount=sum(done,r=>pooledKeys.has(r.key)?cfg.fare*(r.shifted?1-a.discountPercent/100:1)*p.poolDiscount:0);
      const passengerRevenue=done.length*cfg.fare-shiftDiscount-poolDiscount;
      const cargoRevenue=delivered.length*c.deliveryFee;
      const energyCost=sum(trace.legs,l=>l.km*(l.vehicleId<bevCount?cfg.bevKwhPerKm*cfg.electricityPrice/cfg.chargingEfficiency:cfg.fcKgPerKm*cfg.hydrogenPrice));
      const maintenanceCost=totalKm*cfg.maintenancePerKm;
      const handlingCost=sum(trace.tours,t=>t.stops.filter(s=>s.kind==='cargo').length)*c.handlingCost/2;
      const equipmentCost=cargoOn?available*c.equipmentPerVehicle/c.amortizationYears/cfg.operatingDays:0;
      const appCost=channel==='own_app'?a.dailyAppOperatingCost+a.initialAppDevCost/a.appDevAmortizationYears/cfg.operatingDays+Math.round(a.appAdoption*city.demandPerDay)*a.acquisitionCostPerActiveUser/a.acquisitionAmortizationYears/cfg.operatingDays:0;
      const metrics={requested:requests.length,completed:done.length,cancelled:requests.filter(r=>r.willCancel).length,rejected:trace.requests.length-done.length,unfinished:0,late:0,
        pooledBookings:pooledKeys.size,pooledPeople:sum(done.filter(r=>pooledKeys.has(r.key)),r=>r.partySize),sharedTours:sharedTours.size,
        parcelRequested:trace.parcels.length,delivered:delivered.length,parcelRejected:trace.parcels.length-delivered.length,parcelUnfinished:0,parcelOnTime:delivered.filter(r=>r.dropoffTime<=r.latest).length,
        totalKm,passengerKm,emptyKm:sum(trace.legs,l=>l.passengerCount===0&&l.parcelKeys.length===0?l.km:0),noPassengerKm:sum(trace.legs,l=>!l.passengerCount?l.km:0),
        waitSum:sum(done,r=>r.wait),detourSum:sum(done,r=>Math.max(0,r.rideMinutes-travelMinutes(r.origin,r.dest))),peakOccupancy:Math.max(0,...trace.legs.map(l=>l.passengerCount)),
        cargoKgKm:sum(trace.legs,l=>l.km*l.cargoKg),cargoM3Km:sum(trace.legs,l=>l.km*l.cargoM3),passengerRevenue,cargoRevenue,shiftDiscount,poolDiscount,energyCost,maintenanceCost,handlingCost,equipmentCost,appCost,
        contribution:passengerRevenue+cargoRevenue-energyCost-maintenanceCost-handlingCost-equipmentCost-appCost};
      runs.push({seed,cityId:city.id,cityName:city.name,mode:mode.id,available,metrics,trace,cancelled:requests.filter(r=>r.willCancel)});
    }
  }
  const rows=SHARING_MODES.map(mode=>{
    const rr=runs.filter(r=>r.mode===mode.id), m={};
    for(const k of Object.keys(rr[0].metrics)) m[k]=rr.reduce((s,r)=>s+r.metrics[k],0)/seeds.length;
    m.peakOccupancy=Math.max(...rr.map(r=>r.metrics.peakOccupancy));
    m.meanWait=m.completed?m.waitSum/m.completed:0; m.meanDetour=m.completed?m.detourSum/m.completed:0;
    m.occupancy=m.totalKm?m.passengerKm/m.totalKm:0; m.loadKg=m.totalKm&&c.cargoCapacityKg?m.cargoKgKm/m.totalKm/c.cargoCapacityKg:0;
    m.loadM3=m.totalKm&&c.cargoCapacityM3?m.cargoM3Km/m.totalKm/c.cargoCapacityM3:0;
    return {...mode,...m};
  });
  for (const row of rows) {row.dailyDelta=row.contribution-rows[0].contribution;row.annualDelta=row.dailyDelta*cfg.operatingDays;}
  return {revision:'2026-10-15-sharing-1',inputs:{cities,profile,seeds,channel,mechanisms,assumptions:a,pooling:p,cargo:c},model:{endTime,opStart:cfg.opStart,operatingDays:cfg.operatingDays,maxJobsPerTour:8,energy:'initial usable capacity only; no replenishment',placement:'round-robin active hubs',scope:'daily contribution; excludes fleet/hub capital, staffing, rent, insurance; app costs per city'},rows,runs};
}

// Parking v2: no rented space = empty cruising; reserved private space = parked waiting.
// No private charging or private charger CAPEX is modeled. All prices are hypotheses.
export const PARKING_DEFAULTS={fare:2000,electricityMultiplier:1,nightHours:6,maxWaitMin:6,serviceMinutes:15,centralServiceMinutes:10,setupMinutes:30,crews:4,hourlyWage:2000,serviceRentPerSiteDay:4000,nightLotHourly:1500,nightLotCapacity:150,equipmentPerSite:300000,privateSpaces:60,privateHourly:40,cruiseSpeed:15,parkedAuxKw:0.2,storageCoverageHours:6,storageMargin:1.1,storageUsable:0.8,storageYenPerKwh:50000,hydrogenStorageYenPerKg:100000,amortizationYears:10};
export const PARKING_MODES=[
 {id:'base',night:false,private:false,label_ja:'空車巡回',label_en:'Empty cruising'},
 {id:'night',night:true,private:false,label_ja:'① 夜間集約＋巡回',label_en:'① Night lot + cruising'},
 {id:'private',night:false,private:true,label_ja:'② 予測駐車待機',label_en:'② Forecast parking'},
 {id:'both',night:true,private:true,label_ja:'①＋② 併用',label_en:'① + ② Combined'}
];
export function sizeParkingEnergy({bevEnergyKwh,hydrogenKg,assumptions:a}) {
 // Operational energy inventory for a common coverage period, not a charging model.
 const storageKwh=bevEnergyKwh*a.storageCoverageHours/24*a.storageMargin/a.storageUsable;
 const hydrogenStorageKg=hydrogenKg*a.storageCoverageHours/24*a.storageMargin;
 const storageCapex=storageKwh*a.storageYenPerKwh,hydrogenStorageCapex=hydrogenStorageKg*a.hydrogenStorageYenPerKg;
 return {storageKwh,hydrogenStorageKg,storageCapex,hydrogenStorageCapex,energyCapex:storageCapex+hydrogenStorageCapex,privateChargerCapex:0};
}
export function runParkingDay({requests,fleet:initialFleet,endTime,distance,path,neighbors,assumptions:a,speed=25,seed=42}) {
 const fleet=initialFleet.map(v=>({...v,ready:0,clock:0,node:v.home,edge:null,km:0,cruiseKm:0,relocationKm:0,roadMinutes:0,cruiseMinutes:0,parkedMinutes:0,rng:mulberry32((seed+v.id*7919)>>>0)}));
 const trips=[],outcomes=[],idleLegs=[];
 const position=v=>v.edge?{from:v.edge.from,to:v.edge.to,progress:v.edge.progress,length:v.edge.length}:{node:v.node};
 const distanceFrom=(v,node)=>v.edge?Math.min(v.edge.progress+distance(v.edge.from,node),v.edge.length-v.edge.progress+distance(v.edge.to,node)):distance(v.node,node);
 function advance(v,until){
   if(v.ready>until)return;
   v.clock=Math.max(v.clock,v.ready);
   while(v.clock<until-1e-9){
     if(!v.edge){
       if(v.node===v.home&&v.isPrivate){v.parkedMinutes+=until-v.clock;v.clock=until;break;}
       let target,kind;
       if(v.node!==v.home){target=path(v.node,v.home)[1];kind=v.returningFromCruise?'cruise':'relocation';}
       else{const choices=neighbors[v.home];target=choices[Math.floor(v.rng()*choices.length)];kind='cruise';v.returningFromCruise=true;}
       v.edge={from:v.node,to:target,progress:0,length:distance(v.node,target),kind};
     }
     const e=v.edge,velocity=(e.kind==='cruise'?a.cruiseSpeed:speed)/60;
     const minutes=Math.min(until-v.clock,(e.length-e.progress)/velocity),km=minutes*velocity;
     idleLegs.push({vehicleId:v.id,from:e.from,to:e.to,startProgress:e.progress,endProgress:e.progress+km,startTime:v.clock,endTime:v.clock+minutes,km,kind:e.kind});
     e.progress+=km;v.clock+=minutes;v.km+=km;v.roadMinutes+=minutes;
     if(e.kind==='cruise'){v.cruiseKm+=km;v.cruiseMinutes+=minutes;}else v.relocationKm+=km;
     if(e.progress>=e.length-1e-9){v.node=e.to;v.edge=null;if(v.node===v.home)v.returningFromCruise=false;}
   }
 }
 for(const r of [...requests].sort((x,y)=>x.releaseT-y.releaseT)){
   fleet.forEach(v=>advance(v,r.releaseT));let best=null;
   for(const v of fleet){
     const depart=Math.max(r.releaseT,v.ready),pickupKm=distanceFrom(v,r.origin),rideKm=distance(r.origin,r.dest),pickup=depart+pickupKm/speed*60,finish=pickup+rideKm/speed*60;
     if(pickup-r.releaseT>a.maxWaitMin+1e-9||finish>endTime+1e-9)continue;
     if(!best||pickup<best.pickup)best={v,depart,pickup,finish,pickupKm,rideKm,startPosition:position(v)};
   }
   if(!best){outcomes.push({id:r.id,releaseT:r.releaseT,origin:r.origin,dest:r.dest,status:'rejected',reason:'No vehicle can satisfy pickup deadline and service end'});continue;}
   const {v,...trip}=best;
   // A busy vehicle is reserved after its already scheduled dropoff, never teleported.
   if(trip.depart>r.releaseT)v.clock=trip.depart;
   v.km+=trip.pickupKm+trip.rideKm;v.roadMinutes+=(trip.pickupKm+trip.rideKm)/speed*60;
   v.node=r.dest;v.edge=null;v.ready=trip.finish;v.clock=trip.finish;v.returningFromCruise=false;
   trips.push({...trip,vehicleId:v.id,requestId:r.id,releaseT:r.releaseT,origin:r.origin,dest:r.dest});
   outcomes.push({id:r.id,releaseT:r.releaseT,origin:r.origin,dest:r.dest,status:'completed',wait:trip.pickup-r.releaseT});
 }
 fleet.forEach(v=>advance(v,endTime));
 return {fleet:fleet.map(({rng,...v})=>({...v,endPosition:position(v)})),trips,outcomes,idleLegs};
}
export function runParkingComparison({cities,profile='2035',seeds=[42],assumptions={}}){
 const a=Object.fromEntries(Object.entries(PARKING_DEFAULTS).map(([k,v])=>[k,assumptions[k]??v]));
 for(const k of Object.keys(PARKING_DEFAULTS)){if(a[k]===''||!Number.isFinite(Number(a[k]))||Number(a[k])<0)throw new Error('仮定は空欄なし・0以上の数値で入力 / Invalid assumption');a[k]=Number(a[k]);}
 if(a.nightHours<=0||a.nightHours>=24||a.cruiseSpeed<=0||a.crews<1||!Number.isInteger(a.crews)||a.storageUsable<=0||a.storageUsable>1||a.storageMargin<1||a.storageCoverageHours>24||a.amortizationYears<=0||!Number.isInteger(a.privateSpaces)||!Number.isInteger(a.nightLotCapacity))throw new Error('時間・比率・人数・台数の範囲を確認 / Invalid range');
 if(!cities?.length||!seeds.length||seeds.some(s=>!Number.isFinite(s))||cities.length*seeds.length>100||cities.some(c=>c.demandPerDay===''||!Number.isInteger(Number(c.demandPerDay))||c.demandPerDay<0||c.demandPerDay>2500||!Number.isInteger(Number(c.fleetSize))||c.fleetSize<0||c.fleetSize>500||!Number.isFinite(Number(c.availability??1))||(c.availability??1)<0||(c.availability??1)>1))throw new Error('都市・需要・seedを確認（最大2,500件・500台/都市、100都市×seed）');
 if(cities.reduce((s,c)=>s+Number(c.fleetSize)*Math.max(1,Number(c.demandPerDay)),0)*seeds.length>5000000)throw new Error('計算上限：車両×需要×seedは500万以下 / Work limit exceeded');
 const cfg={...buildBaselineConfig(profile),fare:a.fare};cfg.electricityPrice*=a.electricityMultiplier;
 const graph=buildGraph(),dist=(x,y)=>distBetween(graph,x,y),path=(x,y)=>pathBetween(graph,x,y),serviceHours=24-a.nightHours,endTime=serviceHours*60,runs=[];
 for(const seed of seeds)for(const [ci,city] of cities.entries()){
  const homes=city.parkingNodes??['res_n','res_s'],nightNode=city.nightNode??'depot_c';
  if(!Array.isArray(homes)||homes.length!==2||new Set(homes).size!==2||homes.some(n=>!NODES[n])||!NODES[nightNode])throw new Error('Select two distinct parking nodes and a valid night site');
  const neighbors=Object.fromEntries(homes.map(h=>[h,EDGES.filter(e=>e.includes(h)).map(e=>e.find(n=>n!==h)).filter(n=>NODES[h].kind==='depot'||NODES[n].kind!=='depot')]));
  const citySeed=(seed+ci*10007)>>>0,count=Math.floor(Number(city.fleetSize)*(city.availability??1)),bevCount=Math.round(count*cfg.bevShare);
  const hubs=[...new Set((city.hubIds||[]).filter(id=>city.hubs[id]?.active).map(id=>city.hubs[id].node).filter(n=>NODES[n]))];
  if(count&&!hubs.length)throw new Error('有効な作業拠点が必要 / Active service site required');
  if(count>a.nightLotCapacity)throw new Error('夜間駐車場の収容台数不足 / Insufficient night capacity');
  const demand=generateBaseDemand({...city,demandPerDay:Number(city.demandPerDay)},cfg,citySeed).map(r=>({...r,releaseT:r.releaseT*endTime/((cfg.opEnd-cfg.opStart)*60)}));
  const forecastSeed=citySeed^0x4ab73f,forecast=generateBaseDemand({...city,demandPerDay:Math.max(200,Number(city.demandPerDay))},cfg,forecastSeed);
  const weights=homes.map(h=>forecast.reduce((s,r)=>s+(dist(h,r.origin)<=dist(homes.find(n=>n!==h),r.origin)?1:0),0)+1),allocation=[0,0];
  // Both strategies know the same forecast. Only parking access differs.
  const targets=Array.from({length:count},()=>{const i=allocation[0]/weights[0]<=allocation[1]/weights[1]?0:1;allocation[i]++;return homes[i];});
  for(const mode of PARKING_MODES){
   const privateCount=mode.private?Math.min(count,a.privateSpaces):0;
   const fleet=targets.map((home,id)=>({id,home,bev:id<bevCount,isPrivate:Math.floor((id+1)*privateCount/count)>Math.floor(id*privateCount/count)}));
   const trace=runParkingDay({requests:demand,fleet,endTime,distance:dist,path,neighbors,assumptions:a,speed:cfg.speed,seed:citySeed});
   const sum=(xs,f)=>xs.reduce((s,x)=>s+f(x),0);
   for(const v of trace.fleet){
    const node=mode.night?nightNode:hubs.reduce((best,h)=>dist(v.home,h)<dist(v.home,best)?h:best,hubs[0]);
    const p=v.endPosition,toSite=p.node?dist(p.node,node):Math.min(p.progress+dist(p.from,node),p.length-p.progress+dist(p.to,node));
    v.nightKm=toSite+dist(node,v.home);v.km+=v.nightKm;v.roadMinutes+=v.nightKm/cfg.speed*60;
    v.bevKwh=v.bev?v.km*cfg.bevKwhPerKm+v.parkedMinutes/60*a.parkedAuxKw:0;
    v.hydrogenKg=v.bev?0:v.km*cfg.fcKgPerKm; // parked FC auxiliaries supplied by buffer battery; not modeled
   }
   const sites=count?(mode.night?1:hubs.length):0,laborHours=(count*(mode.night?a.centralServiceMinutes:a.serviceMinutes)+sites*a.setupMinutes)/60;
   const nightOverrunMinutes=Math.max(0,laborHours/a.crews+Math.max(0,...trace.fleet.map(v=>v.nightKm/cfg.speed))-a.nightHours)*60;
   const totalKm=sum(trace.fleet,v=>v.km),nightKm=sum(trace.fleet,v=>v.nightKm),bevEnergyKwh=sum(trace.fleet,v=>v.bevKwh)/cfg.chargingEfficiency,hydrogenKg=sum(trace.fleet,v=>v.hydrogenKg);
   const laborCost=laborHours*a.hourlyWage,siteCost=count?(mode.night?a.nightLotHourly*a.nightHours:sites*a.serviceRentPerSiteDay):0,parkingCost=privateCount*a.privateHourly*serviceHours,serviceCapex=sites*a.equipmentPerSite;
   const metrics={requested:demand.length,completed:trace.trips.length,rejected:demand.length-trace.trips.length,waitSum:sum(trace.trips,t=>t.pickup-t.releaseT),pickupKm:sum(trace.trips,t=>t.pickupKm),totalKm,emptyKm:totalKm-sum(trace.trips,t=>t.rideKm),cruiseKm:sum(trace.fleet,v=>v.cruiseKm),relocationKm:sum(trace.fleet,v=>v.relocationKm),nightKm,roadVehicleHours:sum(trace.fleet,v=>v.roadMinutes)/60,cruiseVehicleHours:sum(trace.fleet,v=>v.cruiseMinutes)/60,parkedVehicleHours:sum(trace.fleet,v=>v.parkedMinutes)/60,bevEnergyKwh,hydrogenKg,laborHours,laborCost,siteCost,parkingCost,energyCost:bevEnergyKwh*cfg.electricityPrice+hydrogenKg*cfg.hydrogenPrice,maintenanceCost:totalKm*cfg.maintenancePerKm,serviceCapex,privateCount,nightOverrunMinutes,revenue:trace.trips.length*cfg.fare};
   runs.push({seed,cityId:city.id,cityName:city.name,mode:mode.id,metrics,forecast:{seed:forecastSeed,weights,allocation,homes,nightNode},...trace});
  }
 }
 // One installed inventory capacity per city/scenario, sized from the largest sampled day.
 for(const r of runs){const group=runs.filter(x=>x.cityId===r.cityId&&x.mode===r.mode);Object.assign(r.metrics,sizeParkingEnergy({bevEnergyKwh:Math.max(...group.map(x=>x.metrics.bevEnergyKwh)),hydrogenKg:Math.max(...group.map(x=>x.metrics.hydrogenKg)),assumptions:a}));const m=r.metrics;m.capex=m.serviceCapex+m.energyCapex;m.capexDaily=m.capex/a.amortizationYears/cfg.operatingDays;m.contribution=m.revenue-m.energyCost-m.maintenanceCost-m.laborCost-m.siteCost-m.parkingCost-m.capexDaily;}
 const rows=PARKING_MODES.map(mode=>{const rr=runs.filter(r=>r.mode===mode.id),m={};for(const k of Object.keys(rr[0].metrics))m[k]=rr.reduce((s,r)=>s+r.metrics[k],0)/seeds.length;m.nightOverrunMinutes=Math.max(...rr.map(r=>r.metrics.nightOverrunMinutes));return {...mode,...m,meanWait:m.completed?m.waitSum/m.completed:null,energyPerBooking:m.completed?m.bevEnergyKwh/m.completed:null};});
 rows.forEach(r=>{r.dailyDelta=r.contribution-rows[0].contribution;r.annualDelta=r.dailyDelta*cfg.operatingDays;r.capexDelta=r.capex-rows[0].capex;r.completedDelta=r.completed-rows[0].completed;r.cruiseKmSaved=rows[0].cruiseKm-r.cruiseKm;r.roadHoursSaved=rows[0].roadVehicleHours-r.roadVehicleHours;});
 return {revision:'2026-10-15-parking-2',inputs:{cities,profile,seeds,assumptions:a},model:{serviceHours,operatingDays:cfg.operatingDays,scope:'No parking means empty cruising, including all idle time through closing. Forecast targets shared; private spaces reserve part of fleet, uncovered vehicles cruise. Dispatch may intercept an idle edge via either endpoint. No private charging or charger cost. Energy volume and storage CAPEX follow simulated consumption, coverage hours, margin and usable fraction; maximum sampled day per city. No within-day replenishment/battery-limit simulation; capacity planning rather than energy-feasibility proof. Road vehicle-hours are a congestion proxy, not a travel-time/traffic-flow model. Night overrun reported as infeasible, not silently credited. Excludes vehicle purchase, charging infrastructure, insurance, software, tax and financing.'},rows,runs};
}
