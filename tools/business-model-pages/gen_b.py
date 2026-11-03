from lib import *
import math

# ---------- hero: four time slots ----------
slots = [('care', '08:00–15:00', '移動式介護', '介護・福祉事業者／自治体', None),
         ('gakudo', '15:00–21:00', '移動式学童', '子育て世帯／自治体委託', None),
         ('bar', '21:00–03:00', '移動式バー', '夜間利用者・飲食事業者', None),
         (None, '03:00–08:00', '物流・清掃・整備', '荷主・共同配送事業者', 'truck')]
tiles = []
for im, t, name, payer, icn in slots:
    bg = f"background-image:url({img(im)})" if im else "background:linear-gradient(160deg,#123d8f,#071d4d)"
    art = '' if im else f'<div style="position:absolute;inset:0 0 34px;display:grid;place-items:center;color:#ffffff;opacity:.9;font-size:46px">{ic(icn)}</div>'
    tiles.append(f'''<div style="position:relative;border-radius:6px;overflow:hidden;background-size:cover;background-position:center;{bg}">{art}
<div style="position:absolute;left:0;right:0;top:0;padding:4px 7px;background:linear-gradient(180deg,rgba(7,29,77,.85),rgba(7,29,77,0));color:#fff;font-family:var(--num);font-weight:700;font-size:12px">{t}</div>
<div style="position:absolute;left:0;right:0;bottom:0;padding:14px 7px 5px;background:linear-gradient(0deg,rgba(7,29,77,.95) 55%,rgba(7,29,77,0));color:#fff">
<div style="font-weight:900;font-size:12.5px">{name}</div><div style="font-size:9px;font-weight:700;color:#f2b705">支払者：{payer}</div></div></div>''')
hero = f'<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;height:124px;flex:none">{"".join(tiles)}</div>'

# ---------- 24h donut ----------
cx, cy, ro, ri = 112, 112, 100, 62
def pt(h, r):
    a = math.radians(h / 24 * 360 - 90)
    return cx + r * math.cos(a), cy + r * math.sin(a)
def seg(h0, h1, color):
    if h1 <= h0: h1 += 24
    large = 1 if (h1 - h0) > 12 else 0
    x0, y0 = pt(h0, ro); x1, y1 = pt(h1, ro); x2, y2 = pt(h1, ri); x3, y3 = pt(h0, ri)
    return (f'<path d="M{x0:.1f},{y0:.1f} A{ro},{ro} 0 {large} 1 {x1:.1f},{y1:.1f} L{x2:.1f},{y2:.1f} '
            f'A{ri},{ri} 0 {large} 0 {x3:.1f},{y3:.1f} Z" fill="{color}" stroke="#fff" stroke-width="2"/>')
d = [f'<svg viewBox="0 0 224 224" width="100%" role="img" aria-label="24時間の時間帯別サービス">']
segs = [(3, 8, '#5a6578', '物流', 'truck'), (8, 15, '#1b7a3a', '介護', 'heart-handshake'),
        (15, 21, '#1d6cc4', '学童', 'school'), (21, 3, '#583c9c', 'バー', 'wine')]
for h0, h1, col, lab, icn in segs:
    d.append(seg(h0, h1, col))
    hm = (h0 + ((h1 - h0) % 24) / 2)
    x, y = pt(hm, (ro + ri) / 2)
    d.append(sic(icn, x - 8, y - 15, 16))
    d.append(f'<text x="{x:.1f}" y="{y+12:.1f}" font-size="9.5" font-weight="700" fill="#fff" text-anchor="middle">{lab}</text>')
for h in (0, 3, 8, 15, 21):
    x, y = pt(h, ri - 9)
    d.append(f'<text x="{x:.1f}" y="{y+3:.1f}" font-size="8.5" fill="#5a6578" text-anchor="middle" class="nm">{h}</text>')
d.append(f'<text x="{cx}" y="{cy-10}" font-size="20" font-weight="700" fill="#0b2a6b" text-anchor="middle" class="nm">24H</text>')
d.append(f'<text x="{cx}" y="{cy+6}" font-size="8.5" font-weight="700" fill="#5a6578" text-anchor="middle">稼働率</text>')
d.append(f'<text x="{cx}" y="{cy+20}" font-size="10.5" font-weight="700" fill="#d9670a" text-anchor="middle" class="nm">0.75→0.85</text>')
d.append('</svg>')
donut = ''.join(d)

payers = [('landmark', 'n', '自治体', '地域運行の維持・政策KPI', '運行委託＋成果連動', '個別契約', ''),
          ('heart-handshake', 'g', '介護・福祉事業者', '日中の車両と運行時間', 'サービスリース', '¥2,500,000', '／年・台'),
          ('baby', '', '子育て世帯', '学童の送迎と見守り', '月額利用（運賃と相殺）', '¥15,000', '／人'),
          ('wine', 'p', '夜間利用者', '移動式バーの乗車', '夜間運賃', '¥2,700', '／回'),
          ('truck', 'n', '荷主・共同配送', '夜間の貨物輸送', '車両時間単価', '¥5,000', '／台・時'),
          ('store', 'o', '店舗・医療機関', 'Node利用・コンテナ出店', 'Node利用料', '¥200,000', '／月')]
pc = ''.join(f'''<div class="card" style="display:flex;gap:7px;align-items:flex-start;padding:5px 7px"><span class="ib {c}">{ic(i)}</span>
<div style="min-width:0;flex:1"><div style="font-weight:900;font-size:10.8px;color:var(--navy)">{n}</div><div>{what}</div>
<div style="display:flex;justify-content:space-between;align-items:baseline;gap:4px;margin-top:1px"><span class="tag n">{ct}</span>
<span style="font-family:var(--num);font-weight:700;font-size:14px;color:var(--orange);white-space:nowrap">{pr}<small style="font-family:var(--jp);font-size:8.5px;color:var(--muted)">{u}</small></span></div></div></div>''' for i, c, n, what, ct, pr, u in payers)

# ---------- shared stack ----------
cont = [('heart-handshake', '#1b7a3a', '介護'), ('school', '#1d6cc4', '学童'), ('wine', '#583c9c', 'バー'), ('package', '#5a6578', '貨物')]
ctop = ''.join(f'<div style="border:1.5px solid {c};border-radius:4px;background:#fff;text-align:center;padding:3px 0;color:{c};font-weight:900;font-size:10px"><span style="font-size:15px">{ic(i)}</span><br>{t}</div>' for i, c, t in cont)
layers = [('calendar-clock', '予約・認証・決済', 'Seneschal'), ('route', '配車・ルート・遠隔監視', 'Federation'),
          ('wrench', '交換・清掃・充填', 'Node'), ('layers', '車両・データ基盤', 'FCスケートボード')]
lay = ''.join(f'<div style="display:flex;align-items:center;gap:6px;background:linear-gradient(90deg,#0b2a6b,#123d8f);color:#fff;border-radius:3px;padding:3px 8px;font-size:9.8px;font-weight:700;margin-inline:{k*4}px"><span style="color:#f2b705;font-size:12px">{ic(i)}</span>{t}<span style="margin-left:auto;font-size:8.6px;opacity:.85">{s}</span></div>' for k, (i, t, s) in enumerate(layers))

kp = [('gauge', '24H稼働率', '0.75', '0.85', '18h → 20.4h'), ('moon', '夜間運行の比率', '0.35', '0.60', '夜間の売上時間を拡大'),
      ('route', '運行回数／Node・日', '73', '140', '1.92倍'), ('car', '車両台数', '25', '500', 'Node 4 → 36'),
      ('badge-check', '配車成功率', '≥0.95', '≥0.99', '依頼に対する配車'), ('timer', '乗車までの待ち時間', '≤360', '≤180', '依頼から乗車まで（秒）')]
kph = ''.join(f'<div class="tile"><div class="tl">{ic(i)}{t}</div><div class="tv">{a} <span class="arrow">→</span> {b}</div><div class="td">{d}</div></div>' for i, t, a, b, d in kp)

roles = [('landmark', '自治体', '地域要件・政策KPIの設定と承認', '運行委託費（成果連動を含む）', '生活サービスの維持・地域データ'),
         ('users', '運行事業者', 'サービス設計・UX・運行', 'Platform利用料・Node利用料', '運賃・月額利用料'),
         ('cpu', '技術・車両側', '自動運転AI・制御・更新', 'クラウド・開発・保守の費用', 'Platform・OS・配車の利用料'),
         ('building', 'Node運営者', '交換・清掃・充填・保管', '土地・設備・保守の費用', 'Node利用料・施設料')]
rh = ''.join(f'''<div class="card"><div class="ch"><span class="ib p">{ic(i)}</span>{n}</div><p>{a}</p>
<p style="margin-top:2px"><span class="tag">払う</span> {pay}</p><p style="margin-top:2px"><span class="tag g">得る</span> {get}</p></div>''' for i, n, a, pay, get in roles)

pk = [('house', '子育て世帯の転入・定住', '転入世帯数・学童利用世帯'), ('heart-handshake', '介護人材の確保', '職員1人当たりの見守り人数'),
      ('moon', '夜間の移動手段の確保', '夜間運行回数'), ('building', '遊休施設・遊休地の活用', 'Nodeとして使う施設の稼働時間')]
pkh = ''.join(f'<div class="tile" style="background:#fff"><div class="tl" style="color:var(--navy)">{ic(i)}{t}</div><div class="td">{m}</div></div>' for i, t, m in pk)

body = f'''
{hero}
<section class="row" style="grid-template-columns:232px 1fr;margin-top:3px">
  <div class="sec"><div class="hb">{ic('clock')}一つの車両を24時間で売る</div><div class="panel" style="padding:4px">{donut}</div></div>
  <div class="sec"><div class="hb o">{ic('hand-coins')}支払者と契約形態<small>英文ポートフォリオの例示料金</small></div>
    <div class="row" style="grid-template-columns:1fr 1fr;gap:5px">{pc}</div>
    <p class="note">例示シナリオで、検証済みの市場価格ではない。1回の運行に基本運賃は一つだけ適用し、月額利用は基本運賃と相殺する。</p></div>
</section>
<section class="row" style="grid-template-columns:1fr 1.25fr">
  <div class="sec"><div class="hb g">{ic('layers')}共用で固定費を分担する構造</div>
    <div class="panel" style="display:flex;flex-direction:column;gap:4px;background:var(--tint)">
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px">{ctop}</div>
      <div style="text-align:center;font-size:8.8px;color:var(--muted);font-weight:700">▼ コンテナだけを時間帯で入れ替える ▼</div>{lay}</div></div>
  <div class="sec"><div class="hb g">{ic('trending-up')}展開規模と運行指標<small>2030年 → 2035年（計画値）</small></div>
    <div class="row" style="grid-template-columns:repeat(3,1fr);gap:5px">{kph}</div></div>
</section>
<section class="sec"><div class="hb p">{ic('handshake')}役割分担と収益の帰属<small>KPIの監査と変更承認は共同。法的責任は契約で個別に定める</small></div>
  <div class="row" style="grid-template-columns:repeat(4,1fr);gap:5px">{rh}</div></section>
<section class="sec"><div class="hb">{ic('target')}自治体の政策KPIと委託対価の連動</div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr) 22px 150px;gap:5px;align-items:stretch">{pkh}
  <div style="display:grid;place-items:center;color:var(--orange);font-size:20px">{ic('chevron-right')}</div>
  <div style="background:var(--orange-t);border:1.5px solid var(--orange);border-radius:6px;padding:5px 7px;font-size:9.5px;line-height:1.4"><b style="color:var(--orange);font-size:10.5px">委託対価の成果連動部分</b><br>連動の割合は契約で設定（未設定）</div></div>
</section>
<section class="sec"><div class="hb g">{ic('map-pin')}段階展開<small>2030年・2035年は英文ポートフォリオの計画値。PoCは仮入力</small></div>
  <div class="chev">
    <div class="s" style="background:#5b7fc4"><b><span class="n">PoC</span>1地域で立ち上げ</b>Node 1か所。介護・学童の日中2サービスから開始<br><em>自治体委託で運行費を確保</em></div>
    <div class="s" style="background:#2f5fb3"><b><span class="n">2030</span>夜間を加え4Node</b>車両25台・Node 4。稼働率0.75、夜間比率0.35<br><em>運行73回／Node・日</em></div>
    <div class="s" style="background:#0b2a6b"><b><span class="n">2035</span>面展開で36Node</b>車両500台・Node 36。稼働率0.85、夜間比率0.60<br><em>運行140回／Node・日</em></div>
  </div>
</section>

<div class="punch">{ic('sparkles')}三つの専用事業ではなく、一つの運行基盤を24時間で売る。支払者を重ねるほど固定費が薄まる</div>
'''
import re
body=body
page('b', 'Municipal Joint Business Model', '自動運転の社会実装', '24H共用運行を、自治体共同事業として回す',
     'サービスコンテナを時間帯で入れ替え、車両・運行・Node・データの固定費を、複数の支払者で分担する',
     body, '介護・学童・夜間・物流の需要を一つの自動運転基盤で束ね、<br>自治体と事業者が固定費を分担する共同事業にする。', 8)
