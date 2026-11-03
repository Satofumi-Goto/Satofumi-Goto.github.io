from lib import *
import math
E, M, P = '#1b7a3a', '#1d6cc4', '#583c9c'
def f2(v): return f'{v:,.2f}'
def fs(v): return ('▲' + f2(-v)) if v < 0 else f2(v)

# ---------- donuts ----------
def donut(cx, cy, r, ri, parts, year, total):
    out, a0 = [], -90
    for v, c in parts:
        a1 = a0 + v * 3.6
        L = 1 if v > 50 else 0
        p = lambda a, rr: (cx + rr * math.cos(math.radians(a)), cy + rr * math.sin(math.radians(a)))
        (x0, y0), (x1, y1), (x2, y2), (x3, y3) = p(a0, r), p(a1, r), p(a1, ri), p(a0, ri)
        out.append(f'<path d="M{x0:.1f},{y0:.1f}A{r},{r} 0 {L} 1 {x1:.1f},{y1:.1f}L{x2:.1f},{y2:.1f}A{ri},{ri} 0 {L} 0 {x3:.1f},{y3:.1f}Z" fill="{c}" stroke="#fff" stroke-width="1.5"/>')
        am = (a0 + a1) / 2; lx, ly = p(am, (r + ri) / 2)
        if v >= 10: out.append(f'<text x="{lx:.1f}" y="{ly+3:.1f}" font-size="8.5" font-weight="700" fill="#fff" text-anchor="middle" class="nm">{v:.1f}%</text>')
        a0 = a1
    out.append(f'<text x="{cx}" y="{cy-3}" font-size="10" font-weight="700" fill="#5a6578" text-anchor="middle">{year}</text>')
    out.append(f'<text x="{cx}" y="{cy+11}" font-size="11" font-weight="700" fill="#0b2a6b" text-anchor="middle" class="nm">{total}</text>')
    return ''.join(out)
dn = ['<svg viewBox="0 0 250 132" width="100%" role="img" aria-label="2030年と2035年の売上構成比">',
      donut(62, 60, 52, 31, [(70.7, E), (3.7, M), (25.6, P)], '2030年', '295.48'),
      donut(186, 60, 52, 31, [(60.1, E), (20.8, M), (19.1, P)], '2035年', '1,334.86')]
lg = [(E, 'エネルギー', '208.96', '802.05'), (M, 'MaaS', '10.83', '277.84'), (P, 'Platform', '75.69', '254.97')]
for k, (c, n, a, b) in enumerate(lg):
    x = 6 + k * 83
    dn.append(f'<rect x="{x}" y="124" width="8" height="8" rx="1.5" fill="{c}"/><text x="{x+11}" y="131" font-size="8.6" font-weight="700" fill="#16202f">{n}</text>')
dn.append('</svg>')
dn = ''.join(dn)

# ---------- revenue source bars (2035) ----------
src = [('HPC＋量子演算', E, 20.76, 313.78), ('旅客運行', M, 7.09, 178.07), ('電力（社外向け）', E, 90.00, 157.50),
       ('電力（社内向け）', E, 72.00, 135.00), ('水素（社内向け）', E, 7.14, 124.94), ('自動荷役', P, 59.99, 119.97),
       ('夜間貨物', M, 1.82, 75.77), ('Platform利用料', P, 8.00, 65.00), ('水素（社外向け）', E, 1.78, 53.55),
       ('Nodeサービス', P, 4.20, 48.00), ('移動ストレージ', M, 1.92, 24.00), ('予約連携料', P, 3.50, 22.00), ('チタン材交換', E, 17.28, 17.28)]
bw, x0, rh = 455, 96, 11.2
k = 250 / 313.78
rb = [f'<svg viewBox="0 0 {bw} {len(src)*rh+14}" width="100%" role="img" aria-label="2035年の収益源別売上">',
      f'<text x="{x0}" y="8" font-size="8" fill="#5a6578">2035年（億円）</text><text x="{bw-2}" y="8" font-size="8" fill="#5a6578" text-anchor="end">2030年</text>']
for i, (n, c, a, b) in enumerate(src):
    y = 13 + i * rh
    rb.append(f'<text x="{x0-4}" y="{y+7.3}" font-size="8.4" fill="#16202f" text-anchor="end">{n}</text>')
    rb.append(f'<rect x="{x0}" y="{y+0.8}" width="{b*k:.1f}" height="{rh-2.4}" rx="1.5" fill="{c}"/>')
    rb.append(f'<text x="{x0+b*k+3:.1f}" y="{y+7.3}" font-size="8.4" font-weight="700" fill="#16202f" class="nm">{f2(b)}</text>')
    rb.append(f'<text x="{bw-2}" y="{y+7.3}" font-size="8.2" fill="#5a6578" text-anchor="end" class="nm">{f2(a)}</text>')
rb.append('</svg>')
rb = ''.join(rb)

# ---------- waterfalls ----------
def wf(year, items, w=250, h=168):
    # items: (label, value, kind) kind: t=total bar from 0, d=delta
    lo = min(0, min(v for _, v, _ in items)); hi = max(v for _, v, _ in items)
    top, bot = 28, h - 26
    sy = lambda v: top + (hi - v) / (hi - lo) * (bot - top)
    n = len(items); slot = (w - 8) / n; bwid = slot * 0.62
    out = [f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="{year}の損益ウォーターフォール">',
           f'<line x1="4" x2="{w-4}" y1="{sy(0):.1f}" y2="{sy(0):.1f}" stroke="#9aa6b8" stroke-width="1"/>',
           f'<text x="4" y="10" font-size="10" font-weight="900" fill="#0b2a6b">{year}</text>']
    cur = 0; prev_end = None
    for i, (lab, v, kind) in enumerate(items):
        x = 4 + i * slot + (slot - bwid) / 2
        if kind == 't': a, b = 0, v; cur = v; col = '#0b2a6b' if v >= 0 else '#c4262e'
        else: a, b = cur, cur + v; cur = b; col = '#d9670a' if v < 0 else '#1b7a3a'
        y1, y2 = sy(max(a, b)), sy(min(a, b))
        out.append(f'<rect x="{x:.1f}" y="{y1:.1f}" width="{bwid:.1f}" height="{max(y2-y1,1):.1f}" rx="1.5" fill="{col}"/>')
        if prev_end is not None:
            out.append(f'<line x1="{prev_end[0]:.1f}" x2="{x:.1f}" y1="{prev_end[1]:.1f}" y2="{prev_end[1]:.1f}" stroke="#9aa6b8" stroke-dasharray="2 2"/>')
        prev_end = (x + bwid, sy(cur))
        val = fs(v); ty = y1 - 3 if (kind == 't' and v >= 0) or (kind == 'd' and v >= 0) else y2 + 9
        if kind == 'd' and v < 0: ty = y2 + 9
        if kind == 't' and v < 0: ty = y2 + 9
        out.append(f'<text x="{x+bwid/2:.1f}" y="{ty:.1f}" font-size="8" font-weight="700" fill="#16202f" text-anchor="middle" class="nm">{val}</text>')
        out.append(f'<text x="{x+bwid/2:.1f}" y="{h-12}" font-size="8.2" fill="#16202f" text-anchor="middle">{lab}</text>')
    out.append('</svg>')
    return ''.join(out)
w30 = wf('2030年', [('売上', 295.48, 't'), ('営業費用', -133.29, 'd'), ('販管費', -41.08, 'd'), ('EBITDA', 121.11, 't'), ('償却', -203.06, 'd'), ('営業利益', -81.95, 't')])
w35 = wf('2035年', [('売上', 1334.86, 't'), ('営業費用', -723.83, 'd'), ('販管費', -185.50, 'd'), ('EBITDA', 425.53, 't'), ('償却', -209.11, 'd'), ('営業利益', 216.42, 't')])

# ---------- pillar margin diverging ----------
pl = [('エネルギー', E, 126.14, 556.06), ('MaaS', M, -17.92, -13.16), ('Platform', P, 53.97, 68.13)]
pw, zx = 236, 92; kk = 100 / 556.06
pv = [f'<svg viewBox="0 0 {pw} 168" width="100%" role="img" aria-label="柱ごとの売上から営業費用を引いた差引">',
      f'<line x1="{zx}" x2="{zx}" y1="6" y2="150" stroke="#9aa6b8"/>']
for i, (n, c, a, b) in enumerate(pl):
    y = 12 + i * 48
    pv.append(f'<text x="4" y="{y+16}" font-size="9.5" font-weight="900" fill="{c}">{n}</text>')
    for j, (v, op, yr) in enumerate([(a, .45, '30'), (b, 1, '35')]):
        yy = y + j * 15; wv = abs(v) * kk; xx = zx if v >= 0 else zx - max(wv, 2)
        pv.append(f'<rect x="{xx:.1f}" y="{yy}" width="{max(wv,2):.1f}" height="12" rx="1.5" fill="{c if v>=0 else "#c4262e"}" fill-opacity="{op}"/>')
        tx = zx + wv + 3 if v >= 0 else zx + 3
        pv.append(f'<text x="{tx:.1f}" y="{yy+9.5}" font-size="8.4" font-weight="700" fill="{"#16202f" if v>=0 else "#c4262e"}" class="nm">{fs(v)}</text>')
        pv.append(f'<text x="{zx-4 if v>=0 else xx-3:.1f}" y="{yy+9.5}" font-size="7.8" fill="#5a6578" text-anchor="end" class="nm">20{yr}</text>')
pv.append('<text x="4" y="162" font-size="8" fill="#5a6578">売上 − 営業費用（販管費・償却前、億円）</text></svg>')
pv = ''.join(pv)

steps = [('#5b7fc4', '1', '運賃では届かない', 'MaaSは2030年▲17.92、2035年も▲13.16。運賃だけでは運行費も回収できない'),
         ('#2f5fb3', '2', '拠点のエネルギーを売る', 'Nodeの電力・水素を社内で使い、余剰を社外へ。2035年は売上の60.1%'),
         ('#1a4597', '3', '基盤を他社に開く', '自動荷役・Platform利用料・Nodeサービスで自社運行以外からも課金'),
         ('#0b2a6b', '4', '規模で償却を超える', '2035年はEBITDA 425.53が償却209.11を上回り、営業利益216.42')]
chev = ''.join(f'<div class="s" style="background:{bg}"><b><span class="n">{n}</span>{t}</b>{d}</div>' for bg, n, t, d in steps)

ue = [('ticket', '1運行当たり売上', '¥6,650', '¥9,680', '座席×積載率×運賃'), ('users', '積載率', '0.70', '0.80', '乗客 ÷ 定員'),
      ('zap', 'エネルギー費／運行', '≤¥500', '≤¥350', '燃料・電力の原価'), ('battery-charging', '電力需要／Node・日', '2,080.5', '3,990', 'kWh（28.5kWh×運行回数）'),
      ('droplet', '水素換算／Node・日', '104.1', '171.2', 'kg（効率0.60／0.70）'), ('route', '運行回数／Node・日', '73', '140', '車両25台 → 500台')]
ueh = ''.join(f'<div class="tile"><div class="tl">{ic(i)}{t}</div><div class="tv" style="font-size:14px">{a} <span class="arrow">→</span> {b}</div><div class="td">{d}</div></div>' for i, t, a, b, d in ue)

body = f'''
<div class="hero" style="height:130px;background-image:url({img('vertiport')});background-position:center 40%"><div class="in" style="max-width:100%;flex-direction:row;align-items:center;justify-content:space-between;gap:14px">
  <div style="display:flex;flex-direction:column;gap:5px;max-width:52%"><div class="eb">BUSINESS MODEL ／ ENERGY-LED MOBILITY</div>
  <div class="th">運賃で稼ぐのではなく、エネルギー・演算・<br>運行基盤で稼ぎ、自動運転を需要源にする</div></div>
  <div style="display:flex;gap:6px">
   <div style="background:rgba(7,29,77,.82);border:1px solid rgba(255,255,255,.35);border-radius:6px;padding:5px 9px;min-width:104px"><div style="font-size:9px;font-weight:700;color:#f2b705">2035年 売上</div><div style="font-family:var(--num);font-weight:700;font-size:19px">1,334.86</div><div style="font-size:8.6px">億円（2030年 295.48）</div></div>
   <div style="background:rgba(7,29,77,.82);border:1px solid rgba(255,255,255,.35);border-radius:6px;padding:5px 9px;min-width:104px"><div style="font-size:9px;font-weight:700;color:#f2b705">2035年 営業利益</div><div style="font-family:var(--num);font-weight:700;font-size:19px">216.42</div><div style="font-size:8.6px">億円（利益率16.2%）</div></div>
   <div style="background:rgba(7,29,77,.82);border:1px solid rgba(255,255,255,.35);border-radius:6px;padding:5px 9px;min-width:96px"><div style="font-size:9px;font-weight:700;color:#f2b705">エネルギー比率</div><div style="font-family:var(--num);font-weight:700;font-size:19px">60.1%</div><div style="font-size:8.6px">2035年の売上構成</div></div>
  </div></div></div>

<section class="row" style="grid-template-columns:250px 1fr">
  <div class="sec"><div class="hb">{ic('chart-pie')}売上の構成比</div><div class="panel">{dn}</div></div>
  <div class="sec"><div class="hb g">{ic('coins')}収益源の内訳<small>シナリオP/L、単位：億円</small></div><div class="panel" style="padding:4px 8px">{rb}</div></div>
</section>

<section class="row" style="grid-template-columns:1fr 1fr 236px">
  <div class="sec" style="grid-column:span 2"><div class="hb o">{ic('chart-column')}損益の構造<small>単位：億円。年ごとに縮尺が異なる</small></div>
    <div class="row" style="grid-template-columns:1fr 1fr;gap:5px"><div class="panel" style="padding:3px 5px">{w30}</div><div class="panel" style="padding:3px 5px">{w35}</div></div></div>
  <div class="sec"><div class="hb r">{ic('scale')}柱ごとの収支</div><div class="panel" style="padding:3px 5px">{pv}</div></div>
</section>

<section class="sec"><div class="hb g">{ic('trending-up')}黒字化の筋道</div><div class="chev">{chev}</div></section>

<section class="row" style="grid-template-columns:1.6fr 1fr">
  <div class="sec"><div class="hb">{ic('gauge')}1運行・1Nodeの単位経済<small>2030年 → 2035年</small></div>
    <div class="row" style="grid-template-columns:repeat(3,1fr);gap:5px">{ueh}</div></div>
  <div class="sec"><div class="hb r">{ic('triangle-exclamation-point')}未達の項目と改善レバー</div>
    <div class="card" style="border-color:var(--red);flex:1;display:flex;flex-direction:column;gap:3px">
      <p><span class="tag r">未達</span> プロジェクトIRR <b style="color:var(--red)">▲36.49%</b>（ハードル12%）。2035年までに投資回収は未達</p>
      <p><span class="tag r">要因</span> 2030年の償却203.06の8割が開発投資（車両83.33・Platform 66.67・試作15.00）</p>
      <p><span class="tag n">レバー</span> 水素の社内・社外配分と車両単価（仮入力）、Node売却（基本ケースから除外中）、夜間運行比率の前倒し</p>
    </div></div>
</section>
<p class="note">前提：都市1/5、車両25／500台、Node 4／36、電力販売¥15/kWh・原価¥6.7/kWh、水素販売¥333/kg・原価¥150/kg。一次情報での検証が必要なシナリオ値。</p>
<div class="punch">{ic('sparkles')}運賃で稼ぐ事業ではなく、エネルギー・演算・運行基盤で稼ぎ、自動運転をその需要源にする</div>
'''
page('c', 'Energy-Led Business Model', '自動運転の事業成立', 'エネルギーを柱に、自動運転事業を黒字化する',
     '運賃だけでは開発・車両の固定費を回収できない。拠点のエネルギー・演算と運行プラットフォームの収益を束ねて黒字化する',
     body, '数値は英文ポートフォリオのシナリオP/L（予測ではない）。<br>詳細な項目はFederationとシミュレータで扱う。', 12)
