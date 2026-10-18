import React from 'react';
import { Link, useLocation, Outlet } from 'react-router-dom';
import { useSim } from '@/lib/SimContext';
import { LayoutDashboard, GitCompareArrows, Calculator, BookOpen, Play, Globe, RotateCcw, FlaskConical, FileText, ShieldAlert, Route } from 'lucide-react';

const NAV = [
  { to: '/', key: 'nav_overview', icon: LayoutDashboard },
  { to: '/planning', key: 'nav_planning', icon: Route },
  { to: '/resilience', key: 'nav_resilience', icon: ShieldAlert },
  { to: '/sensitivity', key: 'nav_sensitivity', icon: FlaskConical },
  { to: '/scenarios', key: 'nav_scenarios', icon: GitCompareArrows },
  { to: '/economics', key: 'nav_economics', icon: Calculator },
  { to: '/report', key: 'nav_report', icon: FileText },
  { to: '/assumptions', key: 'nav_assumptions', icon: BookOpen },
];

export default function Layout() {
  const { t, lang, setLang, run, isStale, resetDefaults, results } = useSim();
  const location = useLocation();
 const demo=location.pathname.startsWith('/demo/');
 const demoLinks=<section className="mt-3 border-t border-[#e6e0d6] pt-3"><div className="px-3 text-xs font-semibold mb-2">Demo — Live Mission</div>{[['service','Seneschal｜サービス予約・運行連携','Seneschal | Booking & operations'],['sharing','Seneschal｜相乗り・貨客混載','Seneschal | Pooling & cargo'],['city','Federation｜障害対応・復旧','Federation | Disruption & recovery'],['control','Federation｜運用崩壊・事前制御','Federation | Collapse prevention']].map(([id,ja,en])=><Link key={id} to={'/demo/'+id} className={'block px-3 py-2 rounded text-[13px] '+(location.pathname==='/demo/'+id?'bg-[#0d7d7a] text-white':'hover:bg-[#e8e2d6]')}>{lang==='ja'?ja:en}</Link>)}</section>;

  return (
    <div className={(demo?'h-dvh overflow-hidden':'min-h-screen')+" bg-[#faf8f4] text-[#1a2238] flex flex-col md:flex-row"}>
      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:overflow-y-auto border-r border-[#e6e0d6] bg-[#f3efe7] flex-shrink-0">
        <div className="px-5 py-5 border-b border-[#e6e0d6]">
          <div className="font-display text-[14px] font-semibold tracking-tight leading-tight break-words">Mobility Operations &amp; Business Simulation</div>
          <div className="text-[11px] text-[#6b7280] mt-0.5">{t('app_subtitle')}</div>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV.map((n) => {
            const active = location.pathname === n.to;
            const Icon = n.icon;
            return (
              <Link key={n.to} to={n.to}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition-colors ${active ? 'bg-[#0d7d7a] text-white' : 'text-[#1a2238] hover:bg-[#e8e2d6]'}`}>
                <Icon size={16} /> {t(n.key)}
              </Link>
            );
          })}
        {demoLinks}</nav>
        <div className="px-3 py-3 border-t border-[#e6e0d6] space-y-2">
          <button onClick={run}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium transition-colors ${isStale ? 'bg-[#0d7d7a] text-white' : 'bg-[#1a2238] text-white opacity-90'}`}>
            <Play size={15} /> {t('run')}
          </button>
          <button onClick={resetDefaults}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-[12px] text-[#6b7280] hover:bg-[#e8e2d6]">
            <RotateCcw size={13} /> {t('reset_defaults')}
          </button>
        </div>
      </aside>

      {/* Mobile top nav */}
      <div className="md:hidden flex-shrink-0 border-b border-[#e6e0d6] bg-[#f3efe7] sticky top-0 z-20">
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="min-w-0 pr-2">
            <div className="font-display text-[13px] font-semibold leading-tight break-words">Mobility Operations &amp; Business Simulation</div>
            <div className="text-[10px] text-[#6b7280]">{t('app_subtitle')}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setLang(lang === 'ja' ? 'en' : 'ja')} className="px-2 py-1 rounded text-[11px] border border-[#d6d0c4] text-[#1a2238]">
              <Globe size={13} className="inline mr-1" />{lang === 'ja' ? 'EN' : 'JA'}
            </button>
            <button onClick={run} className={`px-2.5 py-1 rounded text-[11px] font-medium ${isStale ? 'bg-[#0d7d7a] text-white' : 'bg-[#1a2238] text-white'}`}>
              <Play size={12} className="inline mr-1" />{t('run')}
            </button>
          </div>
        </div>
        <nav className="flex overflow-x-auto px-2 pb-2 gap-1 no-scrollbar">
          {NAV.map((n) => {
            const active = location.pathname === n.to;
            const Icon = n.icon;
            return (
              <Link key={n.to} to={n.to}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[12px] whitespace-nowrap ${active ? 'bg-[#0d7d7a] text-white' : 'text-[#1a2238] bg-[#e8e2d6]'}`}>
                <Icon size={13} /> {t(n.key)}
              </Link>
            );
          })}
        {demoLinks}</nav>
      </div>

      {/* Main */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {/* Desktop header */}
        <header className="hidden md:flex flex-shrink-0 items-center justify-between px-6 py-3 border-b border-[#e6e0d6] bg-[#faf8f4]">
          <div>
            <div className="font-display text-[17px] font-semibold">{t('app_title')}</div>
            <div className="text-[12px] text-[#6b7280]">{t('app_subtitle')}</div>
          </div>
          <div className="flex items-center gap-3">
            {isStale && results && (
              <span className="text-[11px] px-2 py-1 rounded bg-[#fef3c7] text-[#92400e] border border-[#fde68a]">{t('results_stale')}</span>
            )}
            <button onClick={() => setLang(lang === 'ja' ? 'en' : 'ja')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#d6d0c4] text-[12px] text-[#1a2238] hover:bg-[#f0ebe0]">
              <Globe size={14} /> {lang === 'ja' ? 'English' : '日本語'}
            </button>
          </div>
        </header>
        <main className={demo?"flex-1 min-h-0 overflow-hidden":"flex-1 overflow-auto p-4 md:p-6"}>
          {!demo && ["/","/planning"].includes(location.pathname)&&<section className="mb-4 rounded-lg border border-[#e6e0d6] bg-white p-4"><h2 className="font-semibold">{lang==="ja"?"まずは、Demoをご体験ください。":"Start with the Demo."}</h2><p className="text-sm mt-2">{lang==="ja"?"Seneschalと4つの運用コンソールの連携や、Federationによるデータ同期・運用制御の改修を体験できます。それらが事業性にどう効くかを、Before／Afterで比較し、設定を変えながら効果を確かめてください。":"Experience Seneschal working with four operations consoles, and Federation synchronizing data and updating operational controls. Compare the business impact before and after, and change the settings to explore the effects."}</p><Link to="/demo/city" className="inline-block mt-3 text-sm font-semibold text-[#0d7d7a]">{lang==="ja"?"Demoを始める →":"Start Demo →"}</Link></section>}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
