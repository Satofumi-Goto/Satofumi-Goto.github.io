import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useSim } from '@/lib/SimContext';
import { runPortfolio, createPresetCities, exportPortfolioJSON, exportPortfolioCSV, SCOPE_OPTIONS, getPortfolioTargets } from '@/lib/simulation/portfolio';
import { runPlanning, generateHubConfigs, exportPlanJSON, exportPlanCSV, exportStudyJSON, exportStudyCSV } from '@/lib/simulation/planner';
import { runStudyScript } from '@/lib/simulation/studyScript';
import PortfolioCityEditor from '@/components/planning/PortfolioCityEditor';
import PortfolioResults from '@/components/planning/PortfolioResults';
import PlanningInputs from '@/components/planning/PlanningInputs';
import PlanningResults from '@/components/planning/PlanningResults';
import TouchpointSection from '@/components/planning/TouchpointSection';
import { runSharingComparison, SHARING_MODES, runParkingComparison, PARKING_DEFAULTS } from '@/lib/simulation/sharingRoutes';
import { POOLING_DEFAULTS, CARGO_DEFAULTS } from '@/lib/simulation/sharingDefaults';
import { CHANNELS, DEFAULT_ASSUMPTIONS } from '@/lib/simulation/touchpoint';
import { NODES, EDGES, buildGraph, pathBetween } from '@/lib/simulation/graph';
import TestBadge from '@/components/TestBadge';
import { Plus, FlaskConical, MapPin, Download, ChevronDown, AlertTriangle, Settings2 } from 'lucide-react';

export default function Planning() {
  const { t, lang } = useSim();
  const [profile, setProfile] = useState('2035');
  const [region,setRegion]=useState('tokyo');
  const [cities, setCities] = useState(() => createPresetCities('2035'));
  const [scope, setScope] = useState('not_selected');
  const [seeds, setSeeds] = useState([42, 123, 7]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(null);
  const [showConditions, setShowConditions] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const cancelRef = useRef({ cancelled: false });

  // Bounded candidate search (advanced)
  const [searchCity, setSearchCity] = useState(() => newSearchCity('2035'));
  const [searchRunning, setSearchRunning] = useState(false);
  const searchCancelRef = useRef({ cancelled: false });

  // Study script (advanced)
  const [studyResults, setStudyResults] = useState(null);
  const [studyRunning, setStudyRunning] = useState(false);

  const targets = getPortfolioTargets(profile);
  const totalFleet = cities.reduce((s, c) => s + (Number(c.fleetSize) || 0), 0);
  const totalHubs = cities.reduce((s, c) => s + c.hubIds.length, 0);
  const allDemandValid = cities.every((c) => Number(c.demandPerDay) > 0);

  const currentSig = useMemo(() => JSON.stringify({ cities, scope, seeds, profile }), [cities, scope, seeds, profile]);
  const [configSig, setConfigSig] = useState('');
  const stale = results && configSig !== currentSig;

  const switchProfile = (p) => {
    setProfile(p);
    setCities(createPresetCities(p));
    setScope('not_selected');
    setResults(null);
    setSearchCity(newSearchCity(p));
  };

  const updateCity = (id, updater) => setCities((prev) => prev.map((c) => (c.id === id ? { ...c, ...updater(c) } : c)));
  const removeCity = (id) => setCities((prev) => prev.filter((c) => c.id !== id));
  const addCity = () => {
    const nc = createPresetCities(profile)[0];
    nc.id = `city_${Date.now()}`;
    setCities((prev) => [...prev, nc]);
  };

  const run = useCallback(async () => {
    if (running || !allDemandValid) return;
    cancelRef.current = { cancelled: false };
    setRunning(true);
    setProgress({ current: 0, total: cities.length * seeds.length });
    setResults(null);
    const portfolioConfig = { cities, seeds, scope, profile };
    await new Promise((r) => setTimeout(r, 10));
    const result = runPortfolio(portfolioConfig, cancelRef.current, (current, total) => setProgress({ current, total }));
    setResults(result);
    setConfigSig(JSON.stringify({ cities, scope, seeds, profile }));
    setRunning(false);
    setProgress(null);
  }, [cities, seeds, scope, profile, running, allDemandValid]);

  const cancel = () => { cancelRef.current.cancelled = true; };

  const exportResult = (fmt) => {
    if (!results || stale) return;
    const portfolioConfig = { cities, seeds, scope, profile };
    const data = fmt === 'json' ? JSON.stringify(exportPortfolioJSON(results, portfolioConfig), null, 2) : exportPortfolioCSV(results, portfolioConfig);
    downloadBlob(new Blob([data], { type: fmt === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }), `planning_${fmt}.${fmt}`);
  };

  // Bounded candidate search
  const runSearch = useCallback(async () => {
    if (searchRunning) return;
    searchCancelRef.current = { cancelled: false };
    setSearchRunning(true);
    const planningConfig = { ...searchCity.config, hubConfigs: generateHubConfigs(searchCity.config.selectedHubs, searchCity.config.hubCapacity, searchCity.config.hubLocations) };
    const result = await runPlanning(planningConfig, searchCancelRef.current, () => {});
    setSearchCity((prev) => ({ ...prev, results: result }));
    setSearchRunning(false);
  }, [searchCity, searchRunning]);
  const cancelSearch = () => { searchCancelRef.current.cancelled = true; };
  const updateSearchConfig = (updater) => setSearchCity((prev) => ({ ...prev, config: updater(prev.config) }));
  const exportSearch = (fmt) => {
    if (!searchCity.results) return;
    const planningConfig = { ...searchCity.config, hubConfigs: generateHubConfigs(searchCity.config.selectedHubs, searchCity.config.hubCapacity, searchCity.config.hubLocations) };
    if (fmt === 'json') downloadBlob(new Blob([JSON.stringify(exportPlanJSON(searchCity.results, planningConfig), null, 2)], { type: 'application/json' }), `search.json`);
    else downloadBlob(new Blob([exportPlanCSV(searchCity.results, planningConfig)], { type: 'text/csv;charset=utf-8' }), `search.csv`);
  };

  // Study script
  const runStudy = () => { setStudyRunning(true); setTimeout(() => { setStudyResults(runStudyScript()); setStudyRunning(false); }, 50); };
  const exportStudy = (fmt) => {
    if (!studyResults) return;
    if (fmt === 'json') downloadBlob(new Blob([JSON.stringify(exportStudyJSON(studyResults), null, 2)], { type: 'application/json' }), `study_script.json`);
    else downloadBlob(new Blob([exportStudyCSV(studyResults)], { type: 'text/csv;charset=utf-8' }), `study_script.csv`);
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <section aria-label="Federation Live Mission" className="rounded-xl border overflow-hidden"><div className="p-3 bg-white text-slate-800 border-b border-slate-200"><h2 className="font-semibold">Federation Live Mission — 都市運行の復旧実演</h2><p className="text-xs mt-1">Seneschalを独立表示し、活動・車両運用・サービス拠点・都市運用の4コンソールを同時表示。Federationが5アプリの受信を確認しながら復旧を進めます。</p></div><iframe title="Federation Live Mission Simulator" src="https://federation.base44.app/?liveMission=1" className="w-full border-0" style={{height:1200}} loading="eager" /></section>
      <div className="flex items-center gap-2 flex-wrap">
        <TestBadge />
        <h1 className="text-lg font-semibold">{lang === 'ja' ? '地域モビリティの事業シミュレーション' : 'Regional mobility business simulation'}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm"><span>{lang==='ja'?'地域：':'Region:'}</span>{Object.entries(UNIFIED_REGIONS).map(([id,r])=><button key={id} aria-pressed={region===id} onClick={()=>setRegion(id)} className={region===id?'text-teal-800 underline underline-offset-4 font-medium':'text-slate-600'}>{lang==='ja'?r.name:r.en}</button>)}</div>
      <RegionalEntry cities={cities} profile={profile} lang={lang} disabled={running || searchRunning || studyRunning}
        onDemand={(total) => setCities(prev => prev.map((city, i) => ({...city, demandPerDay: Math.floor(total / prev.length) + (i < total % prev.length ? 1 : 0)})))} />

      {/* Current totals — neutral */}
      <div className="flex items-center gap-4 flex-wrap text-[11px] text-[#6b7280] bg-[#f3efe7] rounded-md px-3 py-1.5">
        <span>{t('plan_totals_cities')}: <span className="font-mono font-medium text-[#1a2238]">{cities.length}</span></span>
        <span>{t('plan_totals_fleet')}: <span className="font-mono font-medium text-[#1a2238]">{totalFleet}</span></span>
        <span>{t('plan_totals_hubs')}: <span className="font-mono font-medium text-[#1a2238]">{totalHubs}</span></span>
      </div>

      {/* Plan year selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-[12px] text-[#6b7280]">
          {t('plan_profile')}:
          <select value={profile} onChange={(e) => switchProfile(e.target.value)} disabled={running}
            className="px-2 py-1 rounded-md border border-[#d6d0c4] bg-white text-[12px]">
            <option value="2030">2030</option>
            <option value="2035">2035</option>
          </select>
        </label>
      </div>

      <details id="regional-city-settings" className="rounded-xl border border-[#e6e0d6] bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold">{lang === 'ja' ? '都市別の需要・車両・拠点を詳しく設定' : 'Detailed city demand, fleet and hubs'}</summary>
        <div className="space-y-3 pt-4">
      {/* City editors */}
      {cities.map((city, idx) => (
        <PortfolioCityEditor key={city.id} city={city} index={idx} t={t} lang={lang}
          onChange={(updater) => updateCity(city.id, updater)}
          onRemove={() => removeCity(city.id)} canRemove={cities.length > 1} anyRunning={running} />
      ))}
      <button onClick={addCity} disabled={running}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e6e0d6] bg-white text-[12px] hover:bg-[#f3efe7] disabled:opacity-50">
        <Plus size={14} /> {t('pf_city')}
      </button>

        </div>
      </details>

      {/* Seeds */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[#6b7280]">{t('pf_seeds')}:</span>
        <input type="text" value={seeds.join(',')} onChange={(e) => setSeeds(e.target.value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n)))}
          className="px-2 py-1 rounded border border-[#d6d0c4] bg-white text-[12px] font-mono w-32" />
      </div>

      {/* Scope — optional, collapsed */}
      <details className="bg-white rounded-lg border border-[#e6e0d6]">
        <summary className="text-[12px] font-medium px-3 py-2 cursor-pointer hover:bg-[#f3efe7]">{t('plan_scope_optional')}</summary>
        <div className="px-3 pb-3">
          <div className="grid grid-cols-4 gap-2 mb-1.5">
            {Object.entries(SCOPE_OPTIONS).map(([key, opt]) => (
              <button key={key} onClick={() => setScope(key)} disabled={running}
                className={`px-2 py-1.5 rounded-md border text-[11px] ${scope === key ? 'border-[#0d7d7a] bg-[#0d7d7a]/5 text-[#0d7d7a]' : 'border-[#d6d0c4] text-[#6b7280]'}`}>
                {lang === 'ja' ? opt.label_ja : opt.label_en}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-[#9ca3af]">
            {scope === 'not_selected' ? <span className="text-[#92400e]">⚠ {t('pf_scope_explain_not_selected')}</span> : t('pf_scope_explain')}
          </div>
          <div className="text-[10px] text-[#6b7280] mt-1">
            {t('plan_ref_completed')}: {targets.tripsPerDay}/日 · {t('pf_res_target')}: {Math.round(targets.reservationShare*100)}% · {t('pf_avail_target')}: {Math.round(targets.availability*100)}% · {t('pf_util_target')}: {Math.round(targets.utilization*100)}% · {t('pf_dispatch_target')}: ≥{Math.round(targets.dispatchSuccessRate*100)}%
          </div>
        </div>
      </details>

      {/* Run button */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={run} disabled={running || !allDemandValid}
          className="px-4 py-2 rounded-md bg-[#0d7d7a] text-white text-[13px] disabled:opacity-50">
          {running ? t('pf_running') : t('pf_run')}
        </button>
        {running && <button onClick={cancel} className="px-3 py-2 rounded-md border border-[#dc2626] text-[#dc2626] text-[12px]">{t('pf_cancel')}</button>}
        {results && !stale && (
          <>
            <button onClick={() => exportResult('json')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-[#d6d0c4] text-[12px]"><Download size={12} /> {t('pf_export_json')}</button>
            <button onClick={() => exportResult('csv')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-[#d6d0c4] text-[12px]"><Download size={12} /> {t('pf_export_csv')}</button>
          </>
        )}
      </div>
      {!allDemandValid && (
        <div className="flex items-center gap-1.5 text-[11px] text-[#dc2626] bg-[#fee2e2] border border-[#fecaca] rounded-md p-2">
          <AlertTriangle size={13} /> {t('plan_demand_required')}
        </div>
      )}
      {running && progress && (
        <div>
          <div className="h-1.5 bg-[#e6e0d6] rounded-full overflow-hidden">
            <div className="h-full bg-[#0d7d7a] transition-all" style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }} />
          </div>
          <div className="text-[10px] text-[#6b7280] mt-1">{progress.current}/{progress.total}</div>
        </div>
      )}
      {stale && (
        <div className="flex items-center gap-1.5 text-[11px] text-[#92400e] bg-[#fef3c7] border border-[#fde68a] rounded-md p-2">
          <AlertTriangle size={13} /> {t('pf_stale')}
        </div>
      )}

      {/* Results */}
      {results && !stale && <PortfolioResults results={results} t={t} onExport={exportResult} />}

      {/* Customer touchpoint simulation */}
      <ParkingLab cities={cities} profile={profile} seeds={seeds} lang={lang} region={region} onCities={setCities} />

      <SharingLab cities={cities} profile={profile} seeds={seeds} lang={lang} />

      <TouchpointSection cities={cities} profile={profile} seeds={seeds} allDemandValid={allDemandValid} />

      {/* Collapsed conditions */}
      <div>
        <button onClick={() => setShowConditions((s) => !s)} className="flex items-center gap-1 text-[11px] text-[#6b7280] hover:text-[#1a2238]">
          <ChevronDown size={12} className={`transition-transform ${showConditions ? 'rotate-180' : ''}`} /> {t('plan_conditions')}
        </button>
        {showConditions && (
          <div className="text-[11px] text-[#6b7280] space-y-1 bg-[#f3efe7] rounded-md p-3 border border-[#e6e0d6] mt-1">
            <div>{t('plan_legacy_note')}</div>
            <div>{t('plan_demand_label')}</div>
            <div>{t('plan_invariants')}</div>
            <div>{t('plan_scope')} {t('plan_no_intercity')}</div>
            <div>{t('plan_objective')}</div>
            <div>{t('plan_capex_note')}</div>
            <div>{t('plan_service_criteria_note')}</div>
            <div>{t('pf_geo_note')}</div>
            <div>{t('pf_hub_note')}</div>
          </div>
        )}
      </div>

      {/* Advanced: bounded candidate search + study */}
      <div>
        <button onClick={() => setShowAdvanced((s) => !s)} className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-[#e6e0d6] bg-white text-[12px] font-medium hover:bg-[#f3efe7]">
          <span className="flex items-center gap-1.5"><Settings2 size={13} /> {t('plan_advanced_search')}</span>
          <ChevronDown size={14} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
        </button>
        {showAdvanced && (
          <div className="space-y-3 mt-2">
            {/* Bounded candidate search */}
            <div className="border border-[#ece7dd] rounded-md p-2.5 bg-white">
              <div className="text-[12px] font-medium mb-2 flex items-center gap-1"><MapPin size={12} /> {t('sweep_title')}</div>
              <PlanningInputs config={searchCity.config} onChange={updateSearchConfig} t={t} lang={lang} />
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <button onClick={runSearch} disabled={searchRunning}
                  className="px-3 py-1.5 rounded-md bg-[#0d7d7a] text-white text-[12px] disabled:opacity-50">
                  {searchRunning ? t('plan_running') : t('plan_run')}
                </button>
                {searchRunning && <button onClick={cancelSearch} className="px-3 py-1.5 rounded-md border border-[#dc2626] text-[#dc2626] text-[12px]">{t('plan_cancel')}</button>}
                {searchCity.results && !searchRunning && (
                  <>
                    <button onClick={() => exportSearch('json')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-[#d6d0c4] text-[12px]"><Download size={12} /> {t('plan_export_json')}</button>
                    <button onClick={() => exportSearch('csv')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-[#d6d0c4] text-[12px]"><Download size={12} /> {t('plan_export_csv')}</button>
                  </>
                )}
              </div>
              {searchCity.results && <div className="mt-2"><PlanningResults results={searchCity.results} t={t} /></div>}
            </div>

            {/* Study script */}
            <div className="border border-[#ece7dd] rounded-md p-2.5 bg-white">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div className="text-[12px] font-medium flex items-center gap-1"><FlaskConical size={12} /> {t('plan_study')}</div>
                <div className="flex items-center gap-2">
                  {studyResults && (
                    <>
                      <button onClick={() => exportStudy('json')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-[#d6d0c4] text-[12px]"><Download size={12} /> {t('plan_study_export_json')}</button>
                      <button onClick={() => exportStudy('csv')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-[#d6d0c4] text-[12px]"><Download size={12} /> {t('plan_study_export_csv')}</button>
                    </>
                  )}
                  <button onClick={runStudy} disabled={studyRunning}
                    className="px-3 py-1.5 rounded-md bg-[#0d7d7a] text-white text-[12px] disabled:opacity-50">
                    {studyRunning ? t('plan_running') : t('plan_study_run')}
                  </button>
                </div>
              </div>
              {studyResults && (
                <div className="space-y-2">
                  <div className="text-[11px] text-[#6b7280] grid grid-cols-2 gap-2 bg-[#f3efe7] rounded p-2">
                    <div><span className="text-[#9ca3af]">{t('plan_study_seeds')}:</span> {studyResults[0].seeds.join(', ')}</div>
                    <div><span className="text-[#9ca3af]">{t('plan_study_fleet_values')}:</span> {studyResults[0].fleetRange.min}–{studyResults[0].fleetRange.max} step {studyResults[0].fleetRange.step}</div>
                  </div>
                  {studyResults.map((r, i) => (
                    <div key={i} className="border border-[#ece7dd] rounded-md p-2 text-[11px]">
                      <div className="font-medium">{r.label}</div>
                      <div className="text-[#6b7280] mt-1">
                        {t('plan_fleet')}: {r.best?.fleetSize || '—'} · {t('plan_hubs_active')}: {r.best ? Object.entries(r.best.hubs).filter(([, h]) => h.active).map(([id]) => id.replace('depot_', '')).join('+') : '—'} · {t('plan_feasible')}: {r.feasibleCount}/{r.totalCandidates} · {t('plan_study_total_runs')}: {r.totalRuns}
                      </div>
                      {r.best ? (
                        <div className="text-[#0d7d7a] mt-1">
                          {t('plan_fulfilment')}: {r.best.worstFulfilment.toFixed(1)}% · {t('plan_annual_cost')}: ¥{Math.round(r.best.meanAnnualizedCost).toLocaleString()}
                        </div>
                      ) : (
                        <div className="text-[#dc2626] mt-1">{t('plan_no_feasible')}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function newSearchCity(profile) {
  return {
    id: `search_${Date.now()}`,
    config: {
      profile,
      demandPerDay: '',
      fleetRange: { min: 5, max: 30, step: 5 },
      selectedHubs: { depot_n: true, depot_c: true, depot_s: true },
      hubLocations: { depot_n: 'depot_n', depot_c: 'depot_c', depot_s: 'depot_s' },
      hubCapacity: { connectors: 2, connectorKw: 50, siteKw: 100 },
      serviceCriteria: profile === '2035' ? { minFulfilment: 99, maxP95Wait: 3 } : { minFulfilment: 95, maxP95Wait: 6 },
      seeds: [42, 123, 7], bevShare: 0.5,
      deploymentPolicy: 'depot_only', stagingCostPerVehicle: 500000,
      advancedOverrides: {},
    },
    results: null,
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Additional scenario study; existing portfolio and touchpoint panels are preserved.
function SharingLab({cities,profile,seeds,lang}) {
  const ja=lang==='ja', L=(j,e)=>ja?j:e;
  const [pool,setPool]=useState({...POOLING_DEFAULTS}), [cargo,setCargo]=useState({...CARGO_DEFAULTS});
  const [channel,setChannel]=useState('own_app'), [mech,setMech]=useState({m1:true,m2:true,m3:true});
  const [assumptions,setAssumptions]=useState({...DEFAULT_ASSUMPTIONS});
  const [result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [mode,setMode]=useState('both'),[cityIndex,setCityIndex]=useState(0),[minute,setMinute]=useState(0),[playing,setPlaying]=useState(false);
  const input={cities,profile,seeds,channel,mechanisms:mech,assumptions,pooling:pool,cargo}, signature=JSON.stringify(input);
  const stale=result&&result.signature!==signature;
  const values=[...Object.values(pool),...Object.values(cargo),...Object.values(assumptions)];
  const valid=cities.length>0&&cities.every(c=>c.demandPerDay!==''&&Number.isInteger(Number(c.demandPerDay))&&Number(c.demandPerDay)>=0)&&values.every(v=>v!==''&&Number.isFinite(Number(v))&&Number(v)>=0);
  useEffect(()=>{if(!playing||!result)return;const id=setInterval(()=>setMinute(v=>{if(v>=result.model.endTime){setPlaying(false);return v;}return Math.min(result.model.endTime,v+5);}),150);return()=>clearInterval(id);},[playing,result]);
  const run=()=>{setBusy(true);setError('');setPlaying(false);setTimeout(()=>{try {const r=runSharingComparison(input);setResult({...r,signature});setMinute(0);setCityIndex(0);}catch(e){setError(e.message);}finally{setBusy(false);}},30);};
  const num=(v,d=0)=>Number(v||0).toLocaleString(ja?'ja-JP':'en-US',{maximumFractionDigits:d});
  const field=(obj,set,key,label,unit,max,step=1)=><label key={key} className="text-xs text-slate-600 flex flex-col gap-1">{label} ({ja?unit:({"人":"people","件":"jobs","年":"years"}[unit]||unit)})<input aria-label={label} type="number" min={key==='seats'||key==='amortizationYears'?1:0} max={max} step={step} className="border rounded px-2 py-1.5 w-full bg-white text-slate-900" value={obj[key]} onChange={e=>set({...obj,[key]:e.target.value===''?'':Number(e.target.value)})}/></label>;
  const poolingFields=[['seats','座席数','Seats','人',20],['consentRate','予約者の相乗り同意率','Booking consent','0–1',1,.01],['maxWaitMin','許容待ち時間','Maximum wait','min',120],['maxDetourMin','許容迂回時間','Maximum detour','min',120],['poolDiscount','相乗り割引率','Pooling discount','0–1',1,.01]];
  const cargoFields=[['parcelsPerCityDay','荷物需要／都市・日','Parcels/city/day','件',2500],['cargoCapacityKg','積載重量','Cargo capacity','kg',10000],['cargoCapacityM3','積載容積','Cargo volume','m³',100,.01],['parcelKg','荷物重量','Parcel weight','kg',1000,.1],['parcelM3','荷物容積','Parcel volume','m³',10,.01],['deliveryWindowMin','配送期限（受付から）','Delivery window from release','min',480],['handlingMin','積卸時間／各停車','Dwell/stop','min',30],['deliveryFee','配送単価','Delivery fee','JPY',1000000],['handlingCost','荷扱費／荷物往復','Handling/parcel','JPY',100000],['equipmentPerVehicle','設備費／稼働車両','Equipment/active vehicle','JPY',100000000],['amortizationYears','設備償却年数','Equipment amortization','年',50]];
  const appFields=[['appAdoption','アプリ利用率','App adoption','0–1',1,.01],['scheduleConsent','予定共有同意率','Schedule consent','0–1',1,.01],['advanceBookingLeadMin','予約先行時間','Booking lead','min',240],['recommendationAcceptance','提案受諾率','Offer acceptance','0–1',1,.01],['incrementalFraction','純増需要比率','Incremental fraction','0–1',1,.01],['flexibleShare','時刻変更可能率','Flexible share','0–1',1,.01],['shiftAcceptance','時刻変更受諾率','Shift acceptance','0–1',1,.01],['maxShiftMinutes','最大時刻変更','Maximum shift','min',120],['discountPercent','時刻変更割引','Shift discount','%',100],['destinationCapacity','目的地の追加受入枠','Destination offer capacity','件',1000],['dailyAppOperatingCost','アプリ日次運営費／都市','App operations/city/day','JPY',1000000],['initialAppDevCost','アプリ開発費／都市','App development/city','JPY',1000000000],['appDevAmortizationYears','開発費償却年数','Development amortization','年',50],['acquisitionCostPerActiveUser','利用者獲得費','Acquisition/user','JPY',1000000],['acquisitionAmortizationYears','獲得費償却年数','Acquisition amortization','年',50]];
  const selected=result?.runs.find(r=>r.mode===mode&&r.cityId===result.inputs.cities[Math.min(cityIndex,result.inputs.cities.length-1)]?.id&&r.seed===result.inputs.seeds[0]);
  const graph=useMemo(()=>buildGraph(),[]);
  const nodePoint=id=>NODES[id]?[NODES[id].x*6,(100-NODES[id].y)*4]:[0,0];
  const routePoints=leg=>(pathBetween(graph,leg.from,leg.to)||[]).map(nodePoint);
  const active=selected?.trace.legs.filter(l=>l.startTime<=minute&&l.endTime>minute)||[];
  const completedNow=selected?.trace.requests.filter(r=>r.status==='completed'&&r.dropoffTime<=minute).length||0;
  const deliveredNow=selected?.trace.parcels.filter(r=>r.status==='completed'&&r.dropoffTime<=minute).length||0;
  const clock=`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
  const moneyRows=[['contribution','日次貢献','Daily contribution'],['dailyDelta','単独比／日','Daily delta vs solo'],['annualDelta','単独比／年','Annual delta vs solo'],['passengerRevenue','旅客売上','Passenger revenue'],['cargoRevenue','配送売上','Cargo revenue'],['shiftDiscount','時刻変更割引','Shift discount'],['poolDiscount','相乗り割引','Pooling discount'],['energyCost','エネルギー費','Energy cost'],['maintenanceCost','走行維持費','Maintenance'],['handlingCost','荷扱費','Handling'],['equipmentCost','設備費日割','Daily equipment'],['appCost','アプリ費／全都市計','App cost/all cities']];
  const serviceRows=[['requested','旅客需要／予約','Passenger requests'],['completed','完了予約','Completed bookings'],['rejected','未受注／期限不適合','Rejected'],['cancelled','取消予約','Cancelled'],['unfinished','運行未完了','Unfinished'],['late','完了便の遅延','Late completions'],['pooledBookings','実際に相乗りした予約','Pooled bookings'],['pooledPeople','実際に相乗りした人数','Pooled people'],['sharedTours','相乗り便数','Shared tours'],['parcelRequested','荷物需要','Parcel requests'],['delivered','配送完了','Delivered'],['parcelRejected','配送拒否','Parcels rejected'],['parcelUnfinished','配送未完了','Parcels unfinished'],['parcelOnTime','期限内配送','On-time deliveries'],['totalKm','車両走行 km','Vehicle km'],['passengerKm','旅客輸送 人km','Passenger km'],['emptyKm','人・荷物とも空 km','Empty km'],['noPassengerKm','旅客なし km（貨物含む）','No-passenger km'],['meanWait','平均待ち時間 min','Mean wait min'],['meanDetour','平均迂回時間 min','Mean detour min'],['occupancy','距離加重平均乗車人数','Distance-weighted occupancy'],['peakOccupancy','最大乗車人数','Peak occupancy'],['loadKg','重量利用率 0–1','Weight load factor'],['loadM3','容積利用率 0–1','Volume load factor']];
  const table=rows=><div className="overflow-x-auto"><table className="w-full text-xs text-right"><thead><tr className="border-b"><th className="text-left p-2">{L('指標','Metric')}</th>{result.rows.map(r=><th key={r.id} className="p-2 whitespace-nowrap">{ja?r.ja:r.en}</th>)}</tr></thead><tbody>{rows.map(([key,j,e])=><tr key={key} className="border-b border-slate-100"><th className="text-left font-normal p-2 whitespace-nowrap">{L(j,e)}</th>{result.rows.map(r=><td key={r.id} className={`p-2 tabular-nums ${key.includes('Delta')?(r[key]<0?'text-rose-700':'text-emerald-700'):''}`}>{num(r[key],2)}</td>)}</tr>)}</tbody></table></div>;
  return <section id="regional-business-comparison" className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 space-y-4" aria-label={L('地域運行・事業方式ラボ','Regional operations lab')}>
    <div><p className="text-xs font-semibold text-teal-700 tracking-wide">REGIONAL OPERATIONS LAB</p><h2 className="text-lg font-bold text-slate-900 mt-1">{L('地域設定 → 1日の運行 → 事業方式の比較','Region → daily operations → business comparison')}</h2><p className="text-sm text-slate-500 mt-1">{L('上の都市・需要・車両設定を共用。①②③を固定して、④相乗り・⑤貨客混載の4条件を同じ需要で比較します。','Uses the cities, demand and fleet above. Holds ①②③ constant across four sharing modes.')}</p></div>
    <div className="flex flex-wrap gap-3 items-center"><label className="text-sm">{L('顧客接点','Channel')} <select aria-label={L('ラボ顧客接点','Lab channel')} className="border rounded p-2" value={channel} onChange={e=>setChannel(e.target.value)}>{CHANNELS.map(ch=><option key={ch.id} value={ch.id}>{ja?ch.label_ja:ch.label_en}</option>)}</select></label>{[['m1','① 事前予約','① Booking'],['m2','② 需要提案','② Offers'],['m3','③ 時刻分散','③ Time shift']].map(([k,j,e])=><label key={k} className="text-sm flex gap-1"><input type="checkbox" checked={mech[k]} onChange={e=>setMech({...mech,[k]:e.target.checked})}/>{L(j,e)}</label>)}</div>
    <details className="border rounded-lg p-3"><summary className="cursor-pointer text-sm font-medium">{L('④⑤の仮定を編集','Edit sharing assumptions')}</summary><div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3">{poolingFields.map(([k,j,e,u,m,s])=>field(pool,setPool,k,L(j,e),u,m,s))}{cargoFields.map(([k,j,e,u,m,s])=>field(cargo,setCargo,k,L(j,e),u,m,s))}</div></details>
    <details className="border rounded-lg p-3"><summary className="cursor-pointer text-sm font-medium">{L('この比較の①②③・アプリ費用','①②③ and app costs for this comparison')}</summary><p className="text-xs text-slate-500 mt-2">{L('下の従来比較パネルとは入力が独立しています。外部チャネルでは利用できない機能は適用されません。','These inputs are independent of the existing panel below. Channel capability limits apply.')}</p><div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3">{appFields.map(([k,j,e,u,m,s])=>field(assumptions,setAssumptions,k,L(j,e),u,m,s))}</div></details>
    <details className="text-xs text-slate-500"><summary className="cursor-pointer">{L('モデル範囲・仮定・集計定義','Model scope, assumptions and denominators')}</summary><div className="space-y-2 pt-2"><p>{L('追加シナリオの仮定であり、Seneschalの実装済み機能・実績ではありません。合成地理・合成需要、出発前の貪欲バッチ編成（最大8件／便）。走行中の再配車は行いません。予約の同意者だけ相乗り候補になります。','Additional scenario assumptions, not deployed Seneschal features or measured performance. Synthetic geography/demand; greedy departure batches of up to eight jobs; no en-route redispatch; consenting bookings are pooling candidates.')}</p><p>{L('稼働台数＝floor(車両数×availability)。有効ハブへ均等初期配置。初期蓄電・燃料の利用可能量を距離上限とし、途中充電・補給・待ち行列は対象外。従来の充電エンジンとは数値が一致しません。営業時間内の全完了を事前判定するため、遅延・未完了は0、成立しない需要は拒否として集計します。','Available fleet=floor(fleet×availability), distributed over active hubs. Initial usable energy limits daily distance; no charging/refuelling queues. Results differ from the existing charging engine. Whole tours must finish before closing; infeasible jobs are rejected, so late/unfinished counts are zero.')}</p><p>{L('費用範囲は日次貢献。車両・ハブ本体、家賃、人件費、保険は含まず、IRRではありません。アプリ費は既存比較と同じ都市ごとの計上。貨物設備は稼働車両に計上し、荷物需要0は非導入。荷扱費は積卸各1/2。都市を合算した後seed平均、待ち時間は完了予約数、乗車人数・荷物利用率は全車両kmを分母とします。年間差は同じ日次条件×営業日です。','Daily contribution, not project IRR. Excludes fleet/hub capital, rent, staffing and insurance. App costs per city. Cargo equipment covers available vehicles; zero parcel demand means no deployment. Handling cost is half per pickup/dropoff. City sums then seed means; waits weighted by completed bookings, occupancy/load by total vehicle km. Annual delta repeats the daily case over operating days.')}</p></div></details>
    <div className="flex flex-wrap items-center gap-3"><button disabled={!valid||busy} onClick={run} className="bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 text-white rounded-lg px-4 py-2 text-sm font-medium">{busy?L('計算中…','Calculating…'):L('4条件を比較','Compare four modes')}</button><span className="text-xs text-slate-500">{cities.length} {L('都市','cities')} · {num(cities.reduce((s,c)=>s+Number(c.demandPerDay||0),0))} {L('予約/seed','requests/seed')} · {seeds.length} seeds</span>{!valid&&<span className="text-xs text-amber-700">{L('上の都市需要と数値入力を確認してください。','Check city demand and numeric inputs.')}</span>}</div>
    {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
    {result&&<div className="space-y-4">{stale&&<p role="status" className="rounded bg-amber-50 p-3 text-amber-800 text-sm">{L('入力が変更されました。表示は前回結果です。再計算してください。','Inputs changed. These are previous results; rerun the comparison.')}</p>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{result.rows.map(r=><button key={r.id} onClick={()=>setMode(r.id)} className={`rounded-lg border p-3 text-left ${mode===r.id?'border-teal-600 bg-teal-50':'border-slate-200'}`}><span className="text-xs text-slate-500">{ja?r.ja:r.en}</span><div className="text-lg font-semibold mt-1">¥{num(r.contribution)}</div><div className="text-xs">{L('日次貢献／全都市','Daily contribution/all cities')}</div><div className={`text-xs mt-2 ${r.dailyDelta<0?'text-rose-700':'text-teal-700'}`}>{L('単独比','vs solo')} ¥{num(r.dailyDelta)} /{L('日','day')}</div></button>)}</div>
      {table([serviceRows[0],serviceRows[1],serviceRows[6],serviceRows[10],serviceRows[14],serviceRows[18],moneyRows[0],moneyRows[2]])}
      <details className="border rounded p-3"><summary className="text-sm cursor-pointer">{L('サービス・費用内訳をすべて表示','All service and cost metrics')}</summary>{table(serviceRows)}<p className="text-xs mt-4">JPY / {L('日（年間差のみ年）','day (annual delta: per year)')}</p>{table(moneyRows)}</details>
      <div className="rounded-lg bg-slate-50 border p-3 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-sm">{L('1日の運行を再生','Replay a day')} · {clock}</h3><select aria-label={L('再生する都市','Replay city')} value={cityIndex} onChange={e=>setCityIndex(Number(e.target.value))} className="border rounded p-1 text-sm">{result.inputs.cities.map((c,i)=><option key={c.id} value={i}>{c.name}</option>)}</select></div><p className="text-xs text-slate-500">{L('上のカードで方式を切替。再生は先頭seed・選択都市、表は全都市・全seed平均。線は現在走行中の実経路（合成地図）。','Select a mode card. Replay uses the first seed and selected city; tables aggregate all cities/seeds. Lines show active routes on the synthetic map.')} seed {result.inputs.seeds[0]}</p>
      <svg viewBox="110 25 430 335" className="w-full max-h-80 bg-white rounded border" role="img" aria-label={L('合成地域の走行経路','Synthetic region active routes')}>{active.map((leg,i)=><polyline key={i} points={routePoints(leg).map(pt=>pt.join(',')).join(' ')} fill="none" stroke={leg.passengerCount>0?'#0f766e':leg.parcelKeys.length?'#c2410c':'#94a3b8'} strokeWidth="2" opacity=".7"/>)}{Object.entries(NODES).map(([id,n])=>{const [x,y]=nodePoint(id);return <g key={id}><circle cx={x} cy={y} r="4" fill={n.kind==='depot'?'#475569':'#0f766e'}/><text x={x} y={y-8} textAnchor="middle" fontSize="9" fill="#475569">{ja?n.name_ja:n.name_en}</text></g>;})}</svg>
      <div className="flex items-center gap-3"><button onClick={()=>{if(minute>=result.model.endTime)setMinute(0);setPlaying(v=>!v);}} className="border bg-white rounded px-3 py-1 text-sm">{playing?L('停止','Pause'):L('再生','Play')}</button><input aria-label={L('運行時刻','Replay time')} type="range" min="0" max={result.model.endTime} value={minute} onChange={e=>{setPlaying(false);setMinute(Number(e.target.value));}} className="flex-1"/></div><p className="text-xs">{L('旅客完了','Bookings completed')} {completedNow} · {L('配送完了','Parcels delivered')} {deliveredNow} · {L('走行中','Driving')} {active.length} · <span className="text-teal-700">{L('緑：旅客','Green: passengers')}</span> · <span className="text-orange-700">{L('橙：貨物のみ','Orange: cargo only')}</span></p></div>
      <div className="flex gap-3 text-sm"><button className="border rounded px-3 py-2" onClick={()=>downloadBlob(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),'sharing-comparison.json')}>{L('入力・全運行履歴 JSON','Inputs & full traces JSON')}</button><button className="border rounded px-3 py-2" onClick={()=>{const keys=['id',...serviceRows.map(r=>r[0]),...moneyRows.map(r=>r[0])];downloadBlob(new Blob(['\uFEFF'+[keys.join(','),...result.rows.map(r=>keys.map(k=>r[k]).join(','))].join('\n')],{type:'text/csv;charset=utf-8'}),'sharing-comparison.csv');}}>{L('比較表 CSV','Comparison CSV')}</button></div>
    </div>}
  </section>;
}


function RegionalEntry({cities, profile, lang, disabled, onDemand}) {
  const ja = lang === 'ja', L = (j,e) => ja ? j : e;
  const [draft,setDraft] = useState('');
  const complete = cities.length > 0 && cities.every(c=>c.demandPerDay!=='' && Number.isFinite(Number(c.demandPerDay)) && Number(c.demandPerDay)>=0);
  const demand = cities.reduce((s,c)=>s+Number(c.demandPerDay||0),0);
  const fleet = cities.reduce((s,c)=>s+Number(c.fleetSize||0),0);
  const available = cities.reduce((s,c)=>s+Math.floor(Number(c.fleetSize||0)*Math.max(0,Math.min(1,c.availability??1))),0);
  const hubs = cities.reduce((s,c)=>s+(c.hubIds||[]).filter(id=>c.hubs[id]?.active).length,0);
  const fmt = n=>Number(n).toLocaleString(ja?'ja-JP':'en-US',{maximumFractionDigits:1});
  const applyOK = draft!=='' && Number.isInteger(Number(draft)) && Number(draft)>=0 && Number(draft)<=2500*cities.length;
  return <section aria-label={L('地域全体から考える','Start with the whole region')} className="rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-5 md:p-6 space-y-5">
    <div><p className="text-xs font-semibold tracking-wide text-teal-800">REGIONAL BUSINESS DESIGN · {profile}</p><h2 className="text-xl md:text-2xl font-semibold mt-2 text-slate-900">{L('この地域で、どの規模・方式なら事業が成り立つか。','What scale and operating model can serve this region?')}</h2><p className="text-sm text-slate-600 mt-2">{L('まず地域全体の需要と供給規模を置き、駐車場の活用・顧客接点・相乗り・貨客混載で運行と貢献額がどう変わるかを比べます。最後に、都市ごとの1日を再生して結果を確かめます。','Set regional demand and supply first, compare customer channels and sharing modes, then inspect a day of operations in each city.')}</p></div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[[L('対象地域','Coverage'),`${cities.length} ${L('都市','cities')}`],[L('地域の基礎需要／日','Regional base demand/day'),complete?`${fmt(demand)} ${L('予約','bookings')}`:L('未入力','Not set')],[L('保有／稼働可能車両','Total / available fleet'),`${fmt(fleet)} / ${fmt(available)}`],[L('有効な拠点','Active hubs'),fmt(hubs)]].map(([label,value])=><div key={label} className="rounded-lg bg-white border border-teal-100 p-3"><div className="text-xs text-slate-500">{label}</div><div className="text-lg font-semibold text-slate-900 mt-1">{value}</div></div>)}
    </div>
    <div className="rounded-lg bg-white border border-slate-200 p-3 space-y-2"><label className="block text-sm font-medium" htmlFor="regional-total-demand">{L('地域全体の基礎需要を入力する','Enter regional base demand')}</label><div className="flex flex-wrap gap-2 items-center"><input id="regional-total-demand" type="number" min="0" max={2500*cities.length} step="1" value={draft} onChange={e=>setDraft(e.target.value)} placeholder={L('予約件数／日','Bookings/day')} disabled={disabled} className="border rounded-lg px-3 py-2 text-sm w-44 bg-white"/><button onClick={()=>onDemand(Number(draft))} disabled={disabled||!applyOK} className="rounded-lg bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 text-white px-3 py-2 text-sm">{L('各都市に均等配分','Distribute evenly')}</button><a href="#parking-strategy" className="text-sm font-semibold text-teal-800 underline underline-offset-4 px-2 py-1">{L('事業方式の比較へ進む ↓','Compare business models ↓')}</a></div><p className="text-xs text-slate-500">{L('需要は資料から自動設定しません。入力した仮定を都市へ配分します。都市別の設定で配分を変更できます。','Demand is not assumed from source materials. Enter your scenario and distribute it across cities; refine the allocation in city settings.')}</p><p className="text-xs text-slate-600">{L('稼働可能車両1台あたりの基礎需要：','Base demand per available vehicle: ')}{complete&&available>0?fmt(demand/available):'—'} {L('予約／日（完了件数の予測ではありません）','bookings/day (not a completion forecast)')}</p></div>
    <ol className="grid md:grid-cols-3 gap-3 text-sm">
      {[[L('地域の規模を置く','Set regional scale'),L('需要・都市数・車両・拠点。2030／2035の前提を選び、都市別に調整。','Choose 2030/2035 assumptions and refine city demand, fleet and hubs.')],[L('事業方式を比べる','Compare operating models'),L('外部連携／自社アプリと①②③、単独／相乗り／貨客混載。完了件数と日次貢献を確認。','Compare channels, ①②③, and four sharing modes using completions and daily contribution.')],[L('運行で確かめる','Inspect operations'),L('都市・方式を選んで1日を再生。待ち時間、配送、走行距離、費用の根拠へ掘り下げる。','Replay a city and mode. Inspect waits, deliveries, distance and cost drivers.')]].map(([title,body],i)=><li key={title} className="border-t border-teal-200 pt-3"><div className="font-semibold text-slate-900"><span className="text-teal-700 mr-2">0{i+1}</span>{title}</div><p className="text-xs text-slate-600 mt-1 leading-relaxed">{body}</p></li>)}
    </ol>
    <p className="text-xs text-slate-500">{L('都市間の車両融通は行わず、都市ごとの運行結果を地域全体へ合算します。表示する貢献額は事業全体の利益・IRRではありません。','Cities operate independently and their results are summed. Contribution is not full-project profit or IRR.')}</p>
  </section>;
}

function ParkingLab({cities,profile,seeds,lang,region,onCities}) {
 const ja=lang==='ja',L=(j,e)=>ja?j:e;
 const [a,setA]=useState({...PARKING_DEFAULTS}),[result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const signature=JSON.stringify({cities,profile,seeds,assumptions:a}),stale=result&&result.signature!==signature;
 const fmt=n=>n==null?'—':Number(n).toLocaleString(ja?'ja-JP':'en-US',{maximumFractionDigits:2});
 const groups=[
  [L('共通の運賃・電力条件','Shared fare and energy assumptions'),[['fare','運賃 円／完了予約','Fare JPY/completed booking'],['electricityMultiplier','電力単価倍率','Electricity price multiplier']]],
  [L('① 夜間の点検・清掃と場所代','① Night inspection, cleaning and rent'),[
   ['nightHours','夜間作業枠 h／日','Night work window h/day'],['maxWaitMin','迎車の許容待ち時間 min','Maximum pickup wait min'],['serviceMinutes','従来の作業 min／台','Existing work min/vehicle'],['centralServiceMinutes','集約時の作業 min／台','Centralized work min/vehicle'],['setupMinutes','準備 min／作業場所','Setup min/service site'],['crews','作業員 人／都市','Workers/city'],['hourlyWage','作業人件費 円／h','Labor JPY/h'],['serviceRentPerSiteDay','廃止可能な作業場所代 円／箇所日','Avoidable service rent JPY/site/day'],['nightLotHourly','夜間大型駐車場 円／h都市','Night lot JPY/h/city'],['nightLotCapacity','夜間大型駐車場 台／都市','Night lot capacity/city'],['equipmentPerSite','点検清掃設備 円／箇所','Service equipment JPY/site']]],
  [L('② 空車巡回と個人宅駐車待機','② Empty cruising versus private parking'),[
   ['privateSpaces','借りる駐車枠 台／都市','Reserved private spaces/city'],['privateHourly','個人宅駐車場 円／台h','Private parking JPY/space/h'],['cruiseSpeed','空車巡回速度 km／h','Empty cruising speed km/h'],['parkedAuxKw','駐車中のBEV補機電力 kW／台','Parked BEV auxiliary power kW/vehicle']]],
  [L('消費エネルギーから求める貯蔵CAPEX','Storage CAPEX derived from energy consumed'),[
   ['storageCoverageHours','貯蔵で賄う時間 h（24h平均消費基準）','Inventory coverage h (24h average demand)'],['storageMargin','貯蔵の予備係数（1以上）','Inventory safety factor (≥1)'],['storageUsable','蓄電池の使用可能割合 0–1','Battery usable share 0–1'],['storageYenPerKwh','蓄電設備 円／kWh','Battery storage JPY/kWh'],['hydrogenStorageYenPerKg','水素貯蔵設備 円／kg','Hydrogen storage JPY/kg'],['amortizationYears','設備償却 年','Equipment depreciation years']]]
 ];
 const calculate=()=>{setBusy(true);setError('');setTimeout(()=>{try{setResult({...runParkingComparison({cities,profile,seeds,assumptions:a}),signature});}catch(e){setError(e.message);}finally{setBusy(false);}},0);};
 const valid=cities.every(c=>c.demandPerDay!==''&&Number.isFinite(Number(c.demandPerDay)))&&Object.values(a).every(v=>v!==''&&Number.isFinite(Number(v)));
 const rows=result?.rows||[];
 const fields=[['requested','同じ潜在需要 件／日','Same potential bookings/day'],['completed','完了予約 件／日','Completed bookings/day'],['meanWait','完了予約の平均迎車待ち min','Mean pickup wait min (completed)'],['cruiseKm','空車巡回 km／日','Empty cruising km/day'],['cruiseKmSaved','基準比の巡回削減 km／日','Cruising km saved/day'],['roadVehicleHours','道路上の走行 台時／日','Road vehicle-hours/day'],['parkedVehicleHours','個人宅での駐車待機 台時／日','Private parked vehicle-hours/day'],['bevEnergyKwh','BEV電力消費 kWh／日（充電損失含む）','BEV electricity kWh/day incl. charge losses'],['hydrogenKg','FC水素消費 kg／日','FC hydrogen consumption kg/day'],['energyCost','エネルギー費 円／日','Energy cost JPY/day'],['parkingCost','時間借り料金 円／日','Hourly parking cost JPY/day'],['contribution','対象範囲の貢献額 円／日','Contribution within scope JPY/day'],['storageKwh','必要蓄電容量 kWh','Required electricity inventory kWh'],['hydrogenStorageKg','必要水素貯蔵量 kg','Required hydrogen inventory kg'],['capex','貯蔵＋点検清掃設備CAPEX 円','Storage + service equipment CAPEX JPY'],['capexDelta','基準比のCAPEX差 円','CAPEX delta JPY']];
 const costs=[['rejected','未対応予約 件／日','Unserved bookings/day'],['totalKm','総走行 km／日','Total vehicle km/day'],['emptyKm','巡回・迎車・移動・夜間回送 km／日','All empty km/day'],['relocationKm','需要予測地点への移動 km／日','Forecast-zone repositioning km/day'],['nightKm','夜間作業場所への回送・翌朝配置 km／日','Night service and morning staging km/day'],['cruiseVehicleHours','空車巡回 台時／日','Empty cruising vehicle-hours/day'],['roadHoursSaved','基準比の道路走行削減 台時／日','Road vehicle-hours saved/day'],['laborHours','点検清掃 人時／日','Service labor hours/day'],['nightOverrunMinutes','夜間作業枠の最大超過 min','Maximum night work overrun min'],['revenue','旅客売上 円／日','Passenger revenue JPY/day'],['laborCost','点検清掃人件費 円／日','Service labor JPY/day'],['siteCost','点検清掃場所代 円／日','Service site rent JPY/day'],['maintenanceCost','距離連動整備費 円／日','Distance maintenance JPY/day'],['capexDaily','対象設備償却 円／日','Included depreciation JPY/day'],['storageCapex','蓄電設備CAPEX 円','Electricity storage CAPEX JPY'],['hydrogenStorageCapex','水素貯蔵設備CAPEX 円','Hydrogen inventory CAPEX JPY'],['serviceCapex','点検清掃設備CAPEX 円','Service equipment CAPEX JPY'],['privateChargerCapex','個人宅充電器代（計上しない） 円','Private charger cost (excluded) JPY'],['annualDelta','基準比の年間貢献差 円','Annual contribution delta JPY']];
 const table=items=><div className="overflow-x-auto"><table className="w-full text-sm text-right"><thead><tr className="border-b border-slate-300"><th className="text-left py-3 min-w-52">{L('指標（全都市合算）','Metric (all cities summed)')}</th>{rows.map(r=><th key={r.id} className="px-3 min-w-32">{L(r.label_ja,r.label_en)}</th>)}</tr></thead><tbody>{items.map(([k,j,e])=><tr key={k} className="border-b border-slate-200"><th className="text-left font-normal py-2">{L(j,e)}</th>{rows.map(r=><td key={r.id} className="px-3 tabular-nums">{fmt(r[k])}</td>)}</tr>)}</tbody></table></div>;
 return <section id="parking-strategy" aria-label={L('駐車場活用の事業比較','Parking strategy comparison')} className="rounded-2xl border border-teal-200 bg-white p-5 md:p-7 space-y-5 scroll-mt-5">
  <div><p className="text-xs font-bold tracking-widest text-teal-700">PARKING & OPERATING MODEL · v2</p><h2 className="text-xl font-bold mt-2">{L('空車巡回を、需要予測に基づく駐車待機へ','Replace empty cruising with forecast-based parked waiting')}</h2><p className="text-sm text-slate-600 mt-2">{L('① 夜間大型駐車場で点検・清掃を集約。② 需要予測した近隣の個人宅駐車場を時間借り。時間借りがない車両は空車で巡回します。4条件を同じ潜在需要・車両数・需要予測で比較します。','① Consolidate night inspection and cleaning. ② Rent nearby residential parking by the hour using demand forecasts. Vehicles without a reserved space cruise empty. All four cases share potential demand, fleet and forecasts.')}</p></div>
  <div className="grid md:grid-cols-2 gap-3 text-sm"><div className="rounded-xl bg-teal-50 p-4"><strong>{L('① 作業を集約する効果','① Consolidated service work')}</strong><p className="mt-1">{L('点検清掃の作業時間・準備回数・場所代・設備費と、夜間作業場所への回送を計上。','Count work, setup, rent, service equipment and night travel.')}</p></div><div className="rounded-xl bg-slate-50 p-4"><strong>{L('② 無駄な巡回を減らす効果','② Avoid unnecessary cruising')}</strong><p className="mt-1">{L('巡回走行・エネルギー費・道路占有を減らす効果と時間借り料金を比較。消費削減から必要貯蔵量・CAPEXを算出。個人宅の充電可否を条件にせず、充電器代も計上しません。','Compare avoided cruising, energy cost and road use against hourly rent. Storage capacity and CAPEX follow consumption. No private charging condition or private charger cost.')}</p></div></div>
  <p className="text-xs text-slate-600">{L('初期値は検証用の仮定。道路上の台時・巡回kmは渋滞負荷の指標であり、渋滞時間の削減率ではありません。完了予約はユニーク利用者数ではありません。','Defaults are hypotheses. Road vehicle-hours and cruising km indicate traffic load, not a predicted congestion-delay reduction. Completed bookings are not unique users.')}</p>
  <ParkingLocationEditor cities={cities} onCities={onCities} region={region} lang={lang} />
  <UnifiedDesign cities={cities} profile={profile} seeds={seeds} a={a} lang={lang} region={region} onApply={(cs,aa,r)=>{onCities(cs);setA(aa);setResult({...r,signature:JSON.stringify({cities:cs,profile,seeds,assumptions:aa})});}} />
  {groups.map(([title,items])=><details key={title} className="rounded-lg border p-3"><summary className="cursor-pointer font-medium text-sm">{title}</summary><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">{items.map(([key,j,e])=><label key={key} className="text-xs text-slate-600">{L(j,e)}<input type="number" min="0" step="any" aria-label={L(j,e)} value={a[key]} onChange={ev=>setA(s=>({...s,[key]:ev.target.value===''?'':Number(ev.target.value)}))} className="block w-full mt-1 border rounded px-2 py-2 text-slate-900" /></label>)}</div></details>)}
  <details className="text-xs text-slate-600 border rounded-lg p-3"><summary className="cursor-pointer">{L('比較モデルの範囲と計算式','Model scope and formulas')}</summary><div className="space-y-2 mt-3">
   <p>{L('需要予測：当日とは独立した合成過去日から指定した2地点（初期値は住宅地北／南）への配分を求め、全条件に同じ配置を適用。営業時間は24h−夜間作業枠。基礎需要の時刻をこの時間へ圧縮し、全条件で同じ依頼を使用。','Forecast: an independent synthetic historical day allocates the two selected parking targets shared by all cases. Service hours = 24h minus the night window. Identical requests are compressed into that service window.')}</p>
   <p>{L('運行：送迎後は需要予測地点へ移動。予約駐車枠のある車両は駐車待機、枠のない車両は周辺道路を巡回。移動・巡回中にも配車でき、走行途中の位置から迎車距離を計算。最後の依頼後も営業終了まで巡回費用を計上。駐車枠は営業中全時間の予約料金。夜間は最終位置→作業場所→翌朝の配置地点の回送を計上。相乗り・貨客混載はこの比較に含めない。','After trips, vehicles reposition to forecast targets. Reserved-space vehicles park; others cruise nearby roads. Dispatch can intercept moving vehicles using their progress along a road segment. Idle cruising continues through closing, including after the last request. Spaces are billed for all service hours. Night travel covers final position → service site → morning staging. No pooling or cargo in this comparison.')}</p>
   <p>{L('貯蔵：各都市・条件でseed中の最大日消費量×貯蔵時間÷24×予備係数を必要在庫とし、蓄電池は使用可能割合で割る。電力はBEV走行＋駐車中補機＋充電損失、水素はFC走行から算出。水素の駐車中補機は未計上。貯蔵量は運用上のエネルギー在庫の概算で、車載電池の小型化・充電設備設計を意味しない。電池残量・補給時刻・供給能力による運行制約は未統合の容量計画モデル。','Inventory = maximum sampled daily consumption per city/case × coverage hours/24 × safety factor; divide electrical inventory by usable battery fraction. Electricity includes BEV driving, parked auxiliaries and charge losses; hydrogen covers FC driving (parked FC auxiliaries excluded). This is an operational energy inventory estimate, not vehicle-battery downsizing or charger engineering. Battery state, replenishment timing and supply limits are not integrated into dispatch.')}</p>
   <p>{L('夜間枠：人時÷作業員数＋最大回送時間の超過を表示。超過条件では翌日の同一稼働を保証しない。収支は完了運賃−エネルギー−距離連動整備−点検清掃人件費−作業場所代−時間借り料金−対象設備償却。車両本体・充電設備・保険・ソフトウェア・税・金利は対象外。事業全体の利益やIRRではない。','Night feasibility: report labor hours/workers + longest night travel beyond the window; an overrun cannot guarantee repeat-day availability. Contribution deducts energy, distance maintenance, service labor/rent, hourly parking and included depreciation from completed fares. Vehicle purchase, charging infrastructure, insurance, software, tax and financing are excluded. Not full project profit or IRR.')}</p>
  </div></details>
  <div className="flex flex-wrap gap-3 items-center"><button disabled={busy||!valid} onClick={calculate} className="bg-teal-700 text-white rounded-lg px-5 py-2 font-medium disabled:opacity-40">{busy?L('計算中…','Calculating…'):L('駐車場の4条件を比較','Compare four parking strategies')}</button><span className="text-xs text-slate-500">{cities.length} {L('都市','cities')} · {seeds.length} seeds · {L('上の地域需要を使用','Uses regional demand above')}</span></div>
  {!valid&&<p className="text-sm text-amber-800">{L('地域需要を入力・配分し、仮定の空欄を埋めてください。','Enter/distribute regional demand and complete assumptions.')}</p>}
  {error&&<p role="alert" className="text-red-700 text-sm">{error}</p>}
  {stale&&<p role="status" className="text-amber-800 font-medium text-sm">{L('入力が変わりました。以下は前回の結果です。再計算してください。','Inputs changed; recalculate the previous results below.')}</p>}
  {result&&<><ParkingReplay key={result.signature} result={result} region={region} lang={lang}/><p className="text-sm text-slate-600">{L(`運行・費用は${result.inputs.seeds.length} seed平均。貯蔵容量は各都市のseed最大日消費で設計。営業${result.model.serviceHours}h／日。`,`Operations/costs: mean of ${result.inputs.seeds.length} seeds. Inventory: each city's maximum sampled day. ${result.model.serviceHours} service hours/day.`)}</p>{table(fields)}
   {rows.some(r=>r.nightOverrunMinutes>0)&&<p role="alert" className="bg-amber-50 text-amber-900 rounded-lg p-3 text-sm">{L('夜間作業枠を超える条件があります。人員・作業時間・夜間枠を見直すまで、この条件の連日運用と年間貢献額は参考値です。','Some cases exceed the night work window. Repeat-day operations and annual contribution remain provisional until staffing or work windows are revised.')}</p>}
   <details className="border rounded-lg p-3"><summary className="text-sm cursor-pointer">{L('費用・設備・道路負荷の内訳','Cost, equipment and road-load details')}</summary>{table(costs)}</details>
   <div className="flex flex-wrap gap-2"><button disabled={stale} className="border rounded px-3 py-2 text-xs disabled:opacity-40" onClick={()=>downloadBlob(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),'parking-comparison-v2.json')}>{L('駐車場比較・入力・運行履歴 JSON','Parking inputs/results/traces JSON')}</button><button disabled={stale} className="border rounded px-3 py-2 text-xs disabled:opacity-40" onClick={()=>downloadBlob(new Blob(['\uFEFF'+[['metric',...rows.map(r=>r.id)],...[...fields,...costs].map(([k,j,e])=>[L(j,e),...rows.map(r=>r[k]??'')])].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')],{type:'text/csv;charset=utf-8'}),'parking-comparison-v2.csv')}>{L('駐車場比較 CSV','Parking comparison CSV')}</button></div>
  </>}
 </section>;
}

const UNIFIED_REGIONS={tokyo:{name:'東京',en:'Tokyo',lat:35.6812,lng:139.7671},nagoya:{name:'名古屋',en:'Nagoya',lat:35.1709,lng:136.8815},toyota:{name:'豊田',en:'Toyota',lat:35.0868,lng:137.1563}};
function UnifiedDesign({cities,profile,seeds,a,lang,region,onApply}){
 const ja=lang==='ja',L=(j,e)=>ja?j:e,fmt=n=>Number(n).toLocaleString(ja?'ja-JP':'en-US',{maximumFractionDigits:1});
 const [goals,setGoals]=useState({fleet:100,spaces:60,wait:6,completion:95,contribution:0,capex:100000000});
 const [report,setReport]=useState(null),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[chosen,setChosen]=useState(null),[stress,setStress]=useState(null);
 const stop=useRef(false),signature=JSON.stringify({cities,profile,seeds,a,goals});
 const stale=report&&report.signature!==signature;
 const valid=Object.values(goals).every(v=>v!==''&&Number.isFinite(Number(v)))&&goals.fleet>=1&&goals.fleet<=500&&Number.isInteger(goals.fleet)&&goals.spaces>=0&&Number.isInteger(goals.spaces)&&goals.wait>0&&goals.completion>=0&&goals.completion<=100&&goals.capex>=0&&cities.length>0&&cities.every(c=>c.demandPerDay!==''&&Number(c.demandPerDay)>0);
 const assess=r=>{const completion=r.requested?100*r.completed/r.requested:0;const failures=[];if(completion<goals.completion)failures.push(L('完了率','completion'));if(r.meanWait==null||r.meanWait>goals.wait)failures.push(L('待ち時間','wait'));if(r.contribution<goals.contribution)failures.push(L('貢献額','contribution'));if(r.capex>goals.capex)failures.push('CAPEX');if(r.nightOverrunMinutes>0)failures.push(L('夜間枠','night window'));return {completion,failures,feasible:failures.length===0};};
 const search=async()=>{setBusy(true);setError('');setReport(null);setChosen(null);setStress(null);stop.current=false;const candidates=[],errors=[];let count=0;try{
  const fleets=[...new Set([.5,.75,1].map(f=>Math.max(1,Math.floor(goals.fleet*f))))],spaces=[...new Set([0,Math.floor(goals.spaces/2),goals.spaces])];
  for(const fleet of fleets)for(const slots of spaces)for(const layout of ['current','central','distributed']){
   if(stop.current)break;
   const cs=cities.map(c=>({...c,fleetSize:fleet,hubs:Object.fromEntries(Object.entries(c.hubs).map(([id,h],i)=>[id,{...h,node:layout==='current'?h.node:layout==='central'?'depot_c':i%2?'res_s':'res_n'}]))}));
   const aa={...a,privateSpaces:slots,maxWaitMin:goals.wait};
   try{const r=runParkingComparison({cities:cs,profile,seeds,assumptions:aa});for(const row of r.rows)candidates.push({row,cities:cs,a:aa,layout,fleet,slots,...assess(row)});}catch(e){errors.push(e.message);}
   setProgress(`${++count} / ${fleets.length*spaces.length*3}`);await new Promise(r=>setTimeout(r,0));
  }
  if(!stop.current)setReport({candidates,errors:[...new Set(errors)],signature});
 }catch(e){setError(e.message);}finally{setBusy(false);}};
 const select=async c=>{setBusy(true);setError('');setStress(null);try{await new Promise(r=>setTimeout(r,0));const r=runParkingComparison({cities:c.cities,profile,seeds,assumptions:c.a});setChosen({...c,result:r});}catch(e){setError(e.message);}finally{setBusy(false);}};
 const stressTest=async()=>{if(!chosen)return;setBusy(true);setError('');try{const cases=[['需要 −20%','Demand −20%',.8,1,1,1],['需要 −40%','Demand −40%',.6,1,1,1],['電力単価 +50%','Electricity +50%',1,1.5,1,1],['駐車料金 2倍','Parking fee ×2',1,1,2,1],['駐車枠 半減','Half the spaces',1,1,1,.5],['駐車枠 ゼロ','No spaces',1,1,1,0]],out=[];
  for(const [j,e,d,ep,fee,slots]of cases){const r=runParkingComparison({cities:chosen.cities.map(c=>({...c,demandPerDay:Math.round(Number(c.demandPerDay)*d)})),profile,seeds,assumptions:{...chosen.a,electricityMultiplier:chosen.a.electricityMultiplier*ep,privateHourly:chosen.a.privateHourly*fee,privateSpaces:Math.floor(chosen.a.privateSpaces*slots)}});const row=r.rows.find(r=>r.id===chosen.row.id);out.push({name:L(j,e),...row,...assess(row)});await new Promise(r=>setTimeout(r,0));}setStress(out);
 }catch(e){setError(e.message);}finally{setBusy(false);}};
 const feasible=report?.candidates.filter(c=>c.feasible)||[],pool=feasible.length?feasible:(report?.candidates||[]);
 const ranked=[['収支優先','Contribution','contribution',-1],['待ち時間優先','Wait','meanWait',1],['設備投資優先','CAPEX','capex',1]].map(([j,e,key,dir])=>({title:L(j,e),candidate:[...pool].sort((x,y)=>x.failures.length-y.failures.length||dir*((x.row[key]??Infinity)-(y.row[key]??Infinity)))[0]}));
 const rr=chosen?.row,spaceHours=chosen?.result.runs.filter(r=>r.mode===rr.id).reduce((s,r)=>s+r.metrics.privateCount*chosen.result.model.serviceHours,0)/seeds.length;
 const margin=rr?rr.contribution-goals.contribution:0,parkingLimit=spaceHours>0?(margin+rr.parkingCost)/spaceHours:null;
 return <details className="border border-teal-200 rounded-xl p-4" open>
 <summary className="font-semibold cursor-pointer">{L('目標から逆算 → 耐久試験 → 実証条件','Goals → stress tests → pilot conditions')}</summary>
 <p className="text-xs text-slate-500 my-3">{L('この画面の地域需要・seed・駐車場比較エンジンを共用。車両数と駐車枠は都市あたり、貢献額とCAPEXは全都市合算。3段階の車両数・駐車枠と3拠点配置、4運用方式を探索します。世界最適を保証しません。相乗り・貨客混載は下の既存比較で確認します。','Uses this page’s demand, seeds and parking engine. Fleet/spaces per city; contribution/CAPEX across all cities. Searches three fleet/space levels, three service-site layouts and four modes. Bounded search, not global optimization. Sharing/cargo retain their comparison below.')}</p>
 <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{[['fleet','車両上限／都市','Fleet limit/city'],['spaces','駐車枠上限／都市','Space limit/city'],['wait','迎車上限 min','Pickup limit min'],['completion','完了率下限 %','Minimum completion %'],['contribution','日次貢献下限 円','Minimum daily contribution JPY'],['capex','対象設備CAPEX上限 円','Included CAPEX limit JPY']].map(([key,j,e])=><label className="text-xs" key={key}>{L(j,e)}<input aria-label={L(j,e)} type="number" value={goals[key]} disabled={busy} onChange={ev=>setGoals({...goals,[key]:ev.target.value===''?'':Number(ev.target.value)})} className="block border rounded p-2 mt-1 w-full"/></label>)}</div>
 <div className="flex flex-wrap gap-3 mt-4"><button onClick={search} disabled={busy||!valid} className="rounded bg-teal-700 text-white px-4 py-2 text-sm disabled:opacity-40">{busy?L('計算中 ','Calculating ')+progress:L('成立条件を探索','Find feasible conditions')}</button>{busy&&<button onClick={()=>{stop.current=true;}} className="text-sm underline">{L('探索を中止','Cancel search')}</button>}</div>
 {!valid&&<p className="text-xs text-amber-800 mt-2">{L('上で地域需要を入力し、目標の範囲を確認してください（車両1〜500台／都市）。','Enter regional demand and valid targets (1–500 vehicles/city).')}</p>}
 {error&&<p role="alert" className="text-red-700 text-sm mt-2">{error}</p>}
 {report&&<div className="space-y-3 mt-4">{stale&&<p className="text-amber-800 text-sm">{L('入力が変わりました。探索をやり直してください。','Inputs changed. Rerun the search.')}</p>}<p className="font-medium text-sm">{L('成立候補','Feasible candidates')} {feasible.length} / {report.candidates.length}{!feasible.length&&L('：全目標を満たす候補なし。以下は未達条件付きの参考案です。',': no candidate meets all targets; alternatives below are not feasible.')}</p>{report.errors.map(e=><p key={e} className="text-xs text-amber-800">{e}</p>)}
 <div className="grid md:grid-cols-3 gap-3">{ranked.map(({title,candidate:c})=>c&&<div key={title} className="border rounded-lg p-3 text-sm"><h4 className="font-semibold">{title}</h4><p>{L(c.row.label_ja,c.row.label_en)}</p><p>{c.fleet}{L('台',' vehicles')} / {c.slots}{L('枠',' spaces')} · {c.layout}</p><p>¥{fmt(c.row.contribution)} /{L('日','day')} · {fmt(c.completion)}%</p><p>{fmt(c.row.meanWait)} min · CAPEX ¥{fmt(c.row.capex)}</p><p className={c.feasible?'text-teal-700':'text-amber-800'}>{c.feasible?L('目標内','Within targets'):c.failures.join(' / ')}</p><button disabled={busy||stale} onClick={()=>select(c)} className="underline mt-2 disabled:opacity-40">{L('根拠・耐久性を見る','Inspect and stress-test')}</button></div>)}</div>
 </div>}
 {chosen&&!stale&&<div className="border rounded-lg bg-slate-50 p-4 mt-4 space-y-3 text-sm"><h4 className="font-semibold">{L('選択案の交渉条件','Negotiation conditions for selected case')}</h4><p>{L('目標貢献額を維持する駐車料金上限：','Maximum parking fee preserving the contribution target: ')}{parkingLimit==null?'—':parkingLimit<0?L('無料でも目標未達','Below target even at zero fee'):`¥${fmt(parkingLimit)} /${L('枠h','space/h')}`}</p><p>{L('同じ完了件数を保つ場合の必要運賃：','Required fare at unchanged completions: ')}{rr.completed?`¥${fmt(Math.max(0,chosen.a.fare-margin/rr.completed))}`:'—'} · {L('夜間超過：','Night overrun: ')}{fmt(rr.nightOverrunMinutes)} min</p><p className="text-xs text-slate-500">{L('運賃変更による需要変化は未推定。対象範囲の貢献額であり、事業全体の利益ではありません。','Fare elasticity is not modeled. Contribution covers the stated costs, not full project profit.')}</p>
 <div className="flex flex-wrap gap-3"><button disabled={busy} onClick={stressTest} className="border rounded px-3 py-2 bg-white">{L('6つの悪化条件で再計算','Run six stress cases')}</button><button disabled={busy} onClick={()=>{onApply(chosen.cities,chosen.a,chosen.result);setReport(null);setChosen(null);setStress(null);}} className="rounded bg-teal-700 text-white px-3 py-2">{L('この案を共通設定・4条件比較に反映','Apply to shared inputs and comparison')}</button><button onClick={()=>downloadBlob(new Blob([JSON.stringify({revision:'unified-base44-1',region,profile,seeds,goals,candidate:chosen,stress},null,2)],{type:'application/json'}),'unified-pilot-evidence.json')} className="underline">{L('実証条件・根拠JSON','Export pilot evidence')}</button></div>
 {stress&&<div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th>{L('悪化条件','Stress')}</th><th>{L('日次貢献 円','Contribution JPY/day')}</th><th>{L('完了率','Completion')}</th><th>{L('未達','Missed targets')}</th></tr></thead><tbody>{stress.map(r=><tr key={r.name} className="border-t"><td className="py-2">{r.name}</td><td>{fmt(r.contribution)}</td><td>{fmt(r.completion)}%</td><td>{r.failures.join(' / ')||'✓'}</td></tr>)}</tbody></table></div>}
 <ParkingReplay result={chosen.result} region={region} lang={lang} initialMode={chosen.row.id}/>
 </div>}
 </details>;
}
function ParkingReplay({result,region,lang,initialMode='both'}){
 const ja=lang==='ja',L=(j,e)=>ja?j:e,[mode,setMode]=useState(initialMode),[city,setCity]=useState(0),[minute,setMinute]=useState(0),[playing,setPlaying]=useState(false),[requestId,setRequestId]=useState(''),graph=useMemo(()=>buildGraph(),[]);
 const r=UNIFIED_REGIONS[region],z=13,size=256*2**z,lat=r.lat*Math.PI/180,cx=(r.lng+180)/360*size,cy=(1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*size,left=cx-450,top=cy-270,scale=size/(40075.016686*Math.cos(lat));
 const xy=id=>{const n=NODES[id];return n?[450+(n.x-50)*.12*scale,270-(n.y-50)*.12*scale]:[450,270];};
 const tiles=[];for(let x=Math.floor(left/256);x*256<left+900;x++)for(let y=Math.floor(top/256);y*256<top+540;y++)tiles.push(<image key={`${x}/${y}`} x={x*256-left} y={y*256-top} width="256" height="256" href={`https://cyberjapandata.gsi.go.jp/xyz/pale/${z}/${x}/${y}.png`}/>);
 const run=result.runs.find(v=>v.mode===mode&&v.cityId===result.inputs.cities[Math.min(city,result.inputs.cities.length-1)].id&&v.seed===result.inputs.seeds[0]);
 const booking=run?.outcomes.find(o=>String(o.id)===requestId)||run?.outcomes[0];
 const trip=run?.trips.find(t=>t.requestId===booking?.id);
 const selectedPath=trip?(pathBetween(graph,trip.origin,trip.dest)||[]):[];
 const clock=t=>t==null?'—':`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
 const nodeName=id=>NODES[id]?L(NODES[id].name_ja,NODES[id].name_en):id;
 const end=result.model.serviceHours*60,active=run?.trips.filter(t=>t.pickup<=minute&&t.finish>minute)||[];
 useEffect(()=>{setPlaying(false);setMinute(0);},[result]);
 useEffect(()=>{if(!playing)return;const timer=setInterval(()=>setMinute(t=>{if(t>=end){setPlaying(false);return end;}return Math.min(end,t+5);}),150);return()=>clearInterval(timer);},[playing,end]);
 return <div className="rounded-xl border bg-white p-3 space-y-2"><div className="flex flex-wrap gap-3 items-center text-sm"><strong>{L(r.name,r.en)} · {L('同じ計算結果を地図で確認','Inspect the same run on the map')}</strong><select aria-label={L('地図の運用方式','Map operating mode')} value={mode} onChange={e=>setMode(e.target.value)}>{result.rows.map(v=><option key={v.id} value={v.id}>{L(v.label_ja,v.label_en)}</option>)}</select><select aria-label={L('地図の都市','Map city')} value={city} onChange={e=>setCity(Number(e.target.value))}>{result.inputs.cities.map((c,i)=><option key={c.id} value={i}>{c.name}</option>)}</select></div>
 <svg viewBox="0 0 900 540" className="w-full rounded bg-slate-100 max-h-80" role="img" aria-label={L('地域地図と合成経路','Regional map and synthetic routes')}>{tiles}<rect width="900" height="540" fill="white" opacity=".22"/>{Object.entries(NODES).map(([id,n])=>{const [x,y]=xy(id);return <g key={id}><circle cx={x} cy={y} r="5" fill="#0f766e"/><text x={x} y={y-9} fontSize="12" textAnchor="middle" stroke="white" strokeWidth="3" paintOrder="stroke">{L(n.name_ja,n.name_en)}</text></g>;})}{run?.forecast?.homes.map((id,i)=>{const [x,y]=xy(id);return <g key={'parking'+i}><circle cx={x} cy={y} r="14" fill="#0f766e" opacity=".25"/><text x={x+12} y={y+18} fontSize="14">P{i+1}</text></g>;})}{trip&&<polyline points={selectedPath.map(id=>xy(id).join(',')).join(' ')} stroke="#7c3aed" strokeWidth="6" opacity=".6" fill="none"/>}{active.map((t,i)=><polyline key={i} points={(pathBetween(graph,t.origin,t.dest)||[]).map(id=>xy(id).join(',')).join(' ')} stroke="#ea580c" strokeWidth="4" opacity=".8" fill="none"/>)}</svg>
 <div className="flex gap-3 items-center text-sm"><button className="border rounded px-3 py-1" onClick={()=>{if(minute>=end)setMinute(0);setPlaying(!playing);}}>{playing?L('停止','Pause'):L('再生','Play')}</button><input aria-label={L('地図再生時刻','Map replay minute')} className="flex-1" type="range" min="0" max={end} value={minute} onChange={e=>{setPlaying(false);setMinute(Number(e.target.value));}}/><span>{Math.floor(minute/60)}:{String(minute%60).padStart(2,'0')}</span></div>
 <p className="text-xs text-slate-600">{L('完了予約','Completed bookings')} {run?.trips.filter(t=>t.finish<=minute).length||0} · {L('旅客運行中','Passenger trips active')} {active.length} · seed {result.inputs.seeds[0]}</p>
 <details className="border rounded-lg p-3" open><summary className="text-sm font-semibold cursor-pointer">{L('予約1件を追う：受付 → 配車 → 乗車 → 完了 → 売上','Trace one booking: request → dispatch → pickup → completion → revenue')}</summary>
 <label className="block text-sm mt-3">{L('追跡する予約','Booking to trace')}<select aria-label={L('追跡する予約','Booking to trace')} value={booking?String(booking.id):''} onChange={e=>{setRequestId(e.target.value);setPlaying(false);}} className="border rounded p-2 ml-2 max-w-full">{run?.outcomes.map(o=><option key={o.id} value={String(o.id)}>{String(o.id)} · {clock(o.releaseT)} · {nodeName(o.origin)} → {nodeName(o.dest)} · {o.status==='completed'?L('対応','Served'):L('未対応','Unserved')}</option>)}</select></label>
 {booking?<><div className="grid grid-cols-2 md:grid-cols-4 gap-2 my-3 text-sm">{[[L('受付','Request'),clock(booking.releaseT)],[L('迎車出発','Dispatch departure'),clock(trip?.depart)],[L('乗車','Pickup'),clock(trip?.pickup)],[L('完了','Completion'),clock(trip?.finish)]].map(([label,value])=><div key={label} className="bg-slate-50 p-2 rounded"><div className="text-xs text-slate-500">{label}</div><strong>{value}</strong></div>)}</div>
 <p className="text-sm">{trip?L(`車両 ${trip.vehicleId+1} ／ 迎車待ち ${(trip.pickup-trip.releaseT).toFixed(2)} min ／ 迎車 ${trip.pickupKm.toFixed(2)} km ／ 旅客走行 ${trip.rideKm.toFixed(2)} km ／ 完了売上 ¥${result.inputs.assumptions.fare.toLocaleString()}`,`Vehicle ${trip.vehicleId+1} / wait ${(trip.pickup-trip.releaseT).toFixed(2)} min / pickup ${trip.pickupKm.toFixed(2)} km / ride ${trip.rideKm.toFixed(2)} km / completed fare JPY ${result.inputs.assumptions.fare}`):L('未対応：迎車期限と営業終了までの完了を満たす車両なし。売上 ¥0。','Unserved: no vehicle met both pickup deadline and service end. Revenue JPY 0.')}</p>
 <div className="flex flex-wrap gap-2 mt-2">{[[L('受付時点','Request time'),booking.releaseT],[L('乗車時点','Pickup time'),trip?.pickup],[L('完了時点','Completion time'),trip?.finish]].map(([label,time])=><button key={label} disabled={time==null} className="text-xs border rounded px-2 py-1 disabled:opacity-40" onClick={()=>{setPlaying(false);setMinute(Math.min(end,Math.ceil(time)));}}>{label}</button>)}</div>
 <div className="overflow-x-auto mt-3"><table className="w-full text-xs text-right"><thead><tr><th className="text-left">{L('同じ予約を4条件で比較','Same booking across four modes')}</th><th>{L('結果','Status')}</th><th>{L('待ち min','Wait min')}</th><th>{L('完了売上 円','Completed fare JPY')}</th></tr></thead><tbody>{result.rows.map(row=>{const other=result.runs.find(v=>v.cityId===run.cityId&&v.seed===run.seed&&v.mode===row.id),t=other?.trips.find(v=>v.requestId===booking.id);return <tr key={row.id} className="border-t"><td className="text-left py-2">{L(row.label_ja,row.label_en)}</td><td>{t?L('対応','Served'):L('未対応','Unserved')}</td><td>{t?(t.pickup-t.releaseT).toFixed(2):'—'}</td><td>{t?result.inputs.assumptions.fare.toLocaleString():0}</td></tr>;})}</tbody></table></div>
 <p className="text-xs text-slate-500 mt-2">{L('紫線は選択予約の旅客経路。時刻は営業開始からの経過時間。予約の完了売上は比較表の旅客売上に含まれます。固定費を予約単位の利益として配賦していません。','Purple line: selected passenger route. Times are elapsed since service start. Completed fares reconcile to passenger revenue; fixed costs are not allocated as per-booking profit.')}</p></>:<p className="text-sm mt-2">{L('予約がありません。','No bookings.')}</p>}
 </details>
 <p className="text-xs text-slate-500">{L('背景：地理院タイル。地点・道路・需要は共通の合成モデルを実地図へ重ねたもの。地域選択だけでは実際の需要・所要時間は変わりません。橙線は選択都市・先頭seedの運行履歴で、表は全都市・全seedの集計です。','Background: GSI tiles. Nodes, roads and demand are the shared synthetic model overlaid on a real map. Region selection does not infer real demand or travel times. Orange routes show the selected city/first seed; tables aggregate all cities/seeds.')}</p>
 </div>;
}

function ParkingLocationEditor({cities,onCities,region,lang}){
 const ja=lang==='ja',L=(j,e)=>ja?j:e,[cityIndex,setCityIndex]=useState(0),[site,setSite]=useState('p1'),[drag,setDrag]=useState(null),[notice,setNotice]=useState('');
 const city=cities[Math.min(cityIndex,cities.length-1)],r=UNIFIED_REGIONS[region];
 if(!city)return null;
 const parking=city.parkingNodes??['res_n','res_s'],night=city.nightNode??'depot_c',sites={p1:parking[0],p2:parking[1],night};
 const z=13,size=256*2**z,lat=r.lat*Math.PI/180,cx=(r.lng+180)/360*size,cy=(1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*size,left=cx-450,top=cy-270,scale=size/(40075.016686*Math.cos(lat));
 const xy=id=>[450+(NODES[id].x-50)*.12*scale,270-(NODES[id].y-50)*.12*scale];
 const name=id=>L(NODES[id].name_ja,NODES[id].name_en);
 const apply=(key,node)=>{const next=[...parking];if(key==='p1'||key==='p2'){next[key==='p1'?0:1]=node;if(next[0]===next[1]){setNotice(L('2つの駐車待機地点は別の地点を選んでください。','Choose distinct parking locations.'));return;}}
  onCities(cities.map(c=>c.id!==city.id?c:{...c,...(key==='night'?{nightNode:node}:{parkingNodes:next})}));setNotice(L(`${city.name}：${key==='night'?'夜間拠点':key.toUpperCase()}を${name(node)}へ変更。比較・探索を再実行すると計算に反映します。`,`${city.name}: ${key} moved to ${name(node)}. Rerun comparison/search to update results.`));};
 const point=e=>{const svg=e.currentTarget,pt=svg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const p=pt.matrixTransform(svg.getScreenCTM().inverse());return [p.x,p.y];};
 const nearest=p=>Object.keys(NODES).reduce((best,id)=>{const a=xy(id),b=xy(best);return Math.hypot(a[0]-p[0],a[1]-p[1])<Math.hypot(b[0]-p[0],b[1]-p[1])?id:best;},'station');
 const tiles=[];for(let x=Math.floor(left/256);x*256<left+900;x++)for(let y=Math.floor(top/256);y*256<top+540;y++)tiles.push(<image key={`${x}/${y}`} x={x*256-left} y={y*256-top} width="256" height="256" href={`https://cyberjapandata.gsi.go.jp/xyz/pale/${z}/${x}/${y}.png`}/>);
 return <details className="rounded-xl border p-3"><summary className="text-sm font-semibold cursor-pointer">{L('地図で駐車待機地点・夜間拠点を配置','Place parking and night service sites on the map')}</summary>
 <div className="flex flex-wrap gap-3 text-sm mt-3"><label>{L('対象都市','City')} <select aria-label={L('拠点を編集する都市','City for site editing')} value={Math.min(cityIndex,cities.length-1)} onChange={e=>{setCityIndex(Number(e.target.value));setNotice('');}} className="border rounded p-1">{cities.map((c,i)=><option key={c.id} value={i}>{c.name}</option>)}</select></label><label>{L('移動する拠点','Site')} <select aria-label={L('移動する拠点','Site to move')} className="border rounded p-1" value={site} onChange={e=>setSite(e.target.value)}><option value="p1">P1 {L('駐車待機','Parking')}</option><option value="p2">P2 {L('駐車待機','Parking')}</option><option value="night">N {L('夜間点検・清掃','Night service')}</option></select></label><label>{L('配置地点','Location')} <select aria-label={L('拠点の配置地点','Site location')} value={sites[site]} onChange={e=>apply(site,e.target.value)} className="border rounded p-1">{Object.keys(NODES).map(id=><option key={id} value={id}>{name(id)}</option>)}</select></label></div>
 <p className="text-xs text-slate-500 my-2">{L('マーカーをドラッグ、または拠点を選んで地図をクリック。最寄りの合成道路ノードへ配置します。P1/P2は需要予測による待機・巡回・迎車、Nは夜間回送距離に反映。実道路の経路検索ではありません。','Drag a marker, or select a site and click the map. Placement snaps to a synthetic road node. P1/P2 affect forecast staging, cruising and pickups; N affects night travel. This is not real-road routing.')}</p>
 <svg viewBox="0 0 900 540" className="w-full max-h-80 rounded border bg-slate-100" style={{touchAction:'none'}} role="img" aria-label={L('拠点配置地図','Site placement map')} onPointerDown={e=>{const key=e.target.closest('[data-site]')?.getAttribute('data-site')||site;setSite(key);setDrag({key,point:point(e)});e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(drag)setDrag({...drag,point:point(e)});}} onPointerUp={e=>{if(drag){apply(drag.key,nearest(point(e)));setDrag(null);e.currentTarget.releasePointerCapture(e.pointerId);}}} onPointerCancel={()=>setDrag(null)}>
 {tiles}<rect width="900" height="540" fill="white" opacity=".3"/>{EDGES.map(([a,b],i)=><line key={i} x1={xy(a)[0]} y1={xy(a)[1]} x2={xy(b)[0]} y2={xy(b)[1]} stroke="#64748b" strokeWidth="1.5" strokeDasharray="4 3"/>)}{Object.entries(NODES).map(([id,n])=>{const [x,y]=xy(id);return <g key={id}><circle cx={x} cy={y} r="5" fill="#475569"/><text x={x} y={y-16} fontSize="13" textAnchor="middle" stroke="white" strokeWidth="3" paintOrder="stroke">{name(id)}</text></g>;})}{Object.entries(sites).map(([key,id])=>{const [x,y]=drag?.key===key?drag.point:xy(id);return <g key={key} data-site={key} style={{cursor:'grab'}}><circle cx={x} cy={y} r="17" fill={key==='night'?'#c2410c':'#0f766e'} stroke={site===key?'#111827':'white'} strokeWidth="3"/><text x={x} y={y+5} fill="white" fontSize="13" textAnchor="middle" pointerEvents="none">{key==='night'?'N':key.toUpperCase()}</text></g>;})}</svg>
 <p role="status" className="text-xs text-teal-800 mt-2">{notice||`P1: ${name(parking[0])} / P2: ${name(parking[1])} / N: ${name(night)}`}</p><p className="text-xs text-slate-500 mt-1">{L('背景：地理院タイル。地域選択は背景地図を切り替えます。都市ごとの配置は、比較・探索・JSON出力で共用されます。','Background: GSI tiles. Region selection changes the background. City placements are shared by comparisons, search and JSON exports.')}</p>
 </details>;
}
