from lib import *

# ---------- value flow diagram ----------
W, H = 758, 212
s = [f'<svg viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="利用者・車両・保険会社・自治体・開発側と安全データ基盤の間のデータ・価値・対価の流れ"><defs>{MARKERS}'
     '<linearGradient id="hubg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#123d8f"/><stop offset="1" stop-color="#071d4d"/></linearGradient>'
     '<filter id="sh" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.6" flood-color="#0b2a6b" flood-opacity=".22"/></filter></defs>']
# hub
hx, hw = 289, 180
s.append(f'<rect x="{hx}" y="4" width="{hw}" height="{H-8}" rx="10" fill="url(#hubg)" filter="url(#sh)"/>')
s.append(f'<text x="{hx+hw/2}" y="24" fill="#f2b705" font-size="9.5" font-weight="700" text-anchor="middle" letter-spacing="1.5">事業者（構想）</text>')
s.append(f'<text x="{hx+hw/2}" y="44" fill="#fff" font-size="15" font-weight="900" text-anchor="middle">安全データ基盤</text>')
s.append(f'<text x="{hx+hw/2}" y="59" fill="#cfe0ff" font-size="9.5" font-weight="700" text-anchor="middle">判定・評価・権利管理を一体運営</text>')
funcs = [('scan-eye', '統合判定', '人・車・RSUを同時刻で照合'), ('badge-check', '品質評価・アノテーション', '学習データ候補を選別'),
         ('lock', '同意・匿名化・権利管理', '提供範囲を主体ごとに管理'), ('radio-tower', 'RSU・エッジ・クラウド', '警告配信・ログ保存')]
for i, (icn, t, d) in enumerate(funcs):
    y = 68 + i * 34
    s.append(f'<rect x="{hx+8}" y="{y}" width="{hw-16}" height="29" rx="5" fill="#fff" fill-opacity=".1" stroke="#fff" stroke-opacity=".25"/>')
    s.append(sic(icn, hx + 15, y + 6, 17, '#f2b705'))
    s.append(f'<text x="{hx+38}" y="{y+12}" fill="#fff" font-size="9.8" font-weight="700">{t}</text>')
    s.append(f'<text x="{hx+38}" y="{y+24}" fill="#cfe0ff" font-size="8.6">{d}</text>')

def node(x, y, w, h, icn, color, tint, t1, t2, t3=None):
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{tint}" stroke="{color}" stroke-width="1.4" filter="url(#sh)"/>',
           f'<circle cx="{x+22}" cy="{y+h/2}" r="15" fill="{color}"/>', sic(icn, x + 12, y + h / 2 - 10, 20)]
    ty = y + h / 2 - (8 if t3 else 3)
    out.append(f'<text x="{x+43}" y="{ty}" font-size="11.5" font-weight="900" fill="#16202f">{t1}</text>')
    out.append(f'<text x="{x+43}" y="{ty+14}" font-size="9" fill="#16202f">{t2}</text>')
    if t3: out.append(f'<text x="{x+43}" y="{ty+27}" font-size="8.6" fill="#5a6578">{t3}</text>')
    return ''.join(out)

L = [(26, 'user', '歩行者・利用者', 'Seneschal（本人同意）', '無償／保険料割引で参加', '位置・進路・反応履歴', '危険接近の補助警告'),
     (118, 'car', '車両・フリート', 'AI対応ドラレコ／OBU', '運転者・運行事業者', '危険前後の映像・車両状態', '補助警告・ロジック更新')]
for y, icn, a, b, c, up, dn in L:
    s.append(node(0, y, 150, 68, icn, '#1d6cc4', '#e7f0fb', a, b, c))
    cy = y + 34
    s.append(f'<line x1="153" y1="{cy-11}" x2="286" y2="{cy-11}" stroke="#1d6cc4" stroke-width="2" marker-end="url(#mb)"/>')
    s.append(f'<line x1="286" y1="{cy+11}" x2="153" y2="{cy+11}" stroke="#1b7a3a" stroke-width="2" marker-end="url(#mg)"/>')
    s.append(pill(219, cy - 11, up, '#1d6cc4', 126, 8.8)); s.append(pill(219, cy + 11, dn, '#1b7a3a', 126, 8.8))
R = [(4, 'shield-check', '保険会社', '自動車保険・事故対応', '安全サービス料・成果配分', 'リスク評価・事故状況分析'),
     (78, 'landmark', '自治体', '交通安全・道路管理', '安全施策の実証・運用委託', '危険地点マップ・安全KPI'),
     (152, 'cpu', '自動運転開発側', '自動車メーカー・Tier1', 'データ利用料・評価サービス料', '評価済み希少事象（学習候補）')]
for y, icn, a, b, up, dn in R:
    s.append(node(W - 150, y, 150, 56, icn, '#d9670a', '#fdf0e3', a, b))
    cy = y + 28
    s.append(f'<line x1="{W-153}" y1="{cy-10}" x2="472" y2="{cy-10}" stroke="#d9670a" stroke-width="2" marker-end="url(#mo)"/>')
    s.append(f'<line x1="472" y1="{cy+10}" x2="{W-153}" y2="{cy+10}" stroke="#1b7a3a" stroke-width="2" marker-end="url(#mg)"/>')
    s.append(pill(540, cy - 10, up, '#d9670a', 132, 8.6)); s.append(pill(540, cy + 10, dn, '#1b7a3a', 132, 8.6))
s.append('</svg>')
flow = ''.join(s)

cards = [
 ('o', 'hand-coins', '顧客・支払者', ['保険会社、自治体（交通安全・道路管理）', '自動車メーカー・Tier1・フリート事業者']),
 ('g', 'sparkles', '提供価値', ['事故リスク低減、査定・責任判断の支援', '危険地点の可視化、希少事象の補完']),
 ('o', 'coins', '収益源（想定）', ['保険の安全サービス料・成果配分、自治体委託', '開発側へのデータ利用料・評価料']),
 ('', 'gift', '無償側の参加者', ['補助警告を受け、無償／保険料割引で参加', '参加者が増えるほど希少事象が増える']),
 ('n', 'settings', '主要活動', ['人・車・RSU情報の時刻同期と照合', '候補の抽出・品質評価、同意・匿名化の管理']),
 ('n', 'database', '主要資源', ['Seneschalの本人同意データ、車両データ', 'RSU・統合判定基盤、Scenario DB']),
 ('p', 'handshake', 'パートナー', ['保険会社、自治体・道路管理者・警察', '機器ベンダー、自動車メーカー・Tier1']),
 ('r', 'receipt', 'コスト構造', ['RSU・エッジ設備と通信、クラウド', 'アノテーション・品質評価・同意管理']),
 ('t', 'route', 'チャネル', ['保険契約者向けアプリ（Seneschal）', '自治体の実証、開発データ契約']),
]
cards_html = ''.join(f'<div class="card"><div class="ch"><span class="ib {c}">{ic(i)}</span>{t}</div><ul>{"".join(f"<li>{x}</li>" for x in l)}</ul></div>' for c, i, t, l in cards)

steps = [('#5b7fc4', '1', '実証（PoC）', '自治体の実証で警告とログを取得', '対価：実証委託', '条件：回避行動率・誤警告率'),
         ('#2f5fb3', '2', '保険連携', 'リスク評価・事故対応支援を提供', '対価：安全サービス料', '条件：損害率改善の検証'),
         ('#1a4597', '3', 'データ提供', '評価済み希少事象を学習候補へ', '対価：データ利用料', '条件：学習採用率・品質合格率'),
         ('#0b2a6b', '4', '競争優位', 'モデル更新とODD拡張を速める', '対価：車両・サービス価値へ', '到達：ODD拡大・更新周期')]
chev = ''.join(f'<div class="s" style="background:{bg}"><b><span class="n">{n}</span>{t}</b>{d}<br><em>{a}</em><br><em>{k}</em></div>' for bg, n, t, d, a, k in steps)

kpis = [('user', '同意取得率', '同意者 ÷ アプリ利用者'), ('bell-ring', '誤警告率', '誤警告 ÷ 全警告'), ('route', '回避行動率', '警告後の減速・停止 ÷ 警告'),
        ('brain', '学習採用率', '学習に採用 ÷ イベント候補'), ('coins', '1件当たり取得費', '取得・評価費 ÷ 採用イベント'), ('shield-check', '損害率改善', '参加者と非参加者の差')]
kpi_html = ''.join(f'<div class="tile" style="padding:3px 7px"><div class="tl">{ic(i)}{t}</div><div class="td">{d}</div></div>' for i, t, d in kpis)

body = f'''
<div class="hero" style="height:96px;background-image:url({img('rsu_city')})"><div class="in">
  <div class="eb">BUSINESS MODEL ／ SAFETY DATA LOOP</div>
  <div class="th">人・車・路側の相互警告で集めた希少事象を、<br>保険・自治体・開発の3者が払う価値に変える</div>
  <div class="chips"><span class="chip">{ic('hand-coins')}対価を払う主体：保険・自治体・開発側</span><span class="chip">{ic('gift')}参加者は無償／保険料割引</span><span class="chip">{ic('lock')}提供は同意・品質評価済みのみ</span></div>
</div></div>

<section class="sec">
  <div class="hb">{ic('route')}価値・データ・対価の流れ<small>想定。金額は未設定</small></div>
  <div class="panel" style="padding:5px 6px 3px">{flow}
  <p class="note" style="text-align:center;margin-top:2px"><span class="tag b">データ</span> 観測・記録　<span class="tag g">提供価値</span> 基盤から各主体へ　<span class="tag">対価</span> 想定する支払い　※補助警告は車両制御・安全保証を代替しない</p></div>
</section>

<section class="sec">
  <div class="hb">{ic('layers')}ビジネスモデルの構成</div>
  <div class="row" style="grid-template-columns:repeat(3,1fr);gap:5px">{cards_html}</div>
</section>

<section class="sec">
  <div class="hb g">{ic('trending-up')}収益化の段階</div>
  <div class="chev">{chev}</div>
</section>

<section class="row" style="grid-template-columns:1.55fr 1fr">
  <div class="sec">
    <div class="hb">{ic('gauge')}成立条件と検証KPI<small>値はすべてPoCで測定</small></div>
    <div class="row" style="grid-template-columns:repeat(3,1fr);gap:5px">{kpi_html}</div>
  </div>
  <div class="sec">
    <div class="hb r">{ic('triangle-exclamation-point')}前提と制約</div>
    <div class="card" style="border-color:var(--red);flex:1"><ul>
      <li>補助警告であり、車両制御・安全保証を代替しない</li>
      <li>保険料割引・料金水準は保険会社と監督当局の確認が前提</li>
      <li>保険・データ利用の収益は英文ポートフォリオのP/Lに含めていない（上振れ要因として別管理）</li>
    </ul></div>
  </div>
</section>

<section class="sec">
  <div class="hb o">{ic('receipt')}収益と費用の見積もり式<small>単価・数量はPoCと契約で決める（未設定）。1件当たり取得費が1件当たり収入を下回るかで採算を判定</small></div>
  <div class="row" style="grid-template-columns:repeat(4,1fr);gap:5px">
    <div class="card" style="border-top:3px solid var(--orange)"><div class="ch"><span class="ib o">{ic('shield-check')}</span>保険会社から</div>参加契約者数 × 1人当たり安全サービス料<br>＋ 損害額の減少分 × 成果配分率</div>
    <div class="card" style="border-top:3px solid var(--orange)"><div class="ch"><span class="ib o">{ic('landmark')}</span>自治体から</div>対象交差点・区間数 × 運用委託単価<br>＋ 実証期間の委託費</div>
    <div class="card" style="border-top:3px solid var(--orange)"><div class="ch"><span class="ib o">{ic('cpu')}</span>開発側から</div>学習に採用されたイベント数 × データ単価<br>＋ 評価件数 × 評価サービス単価</div>
    <div class="card" style="border-top:3px solid var(--red)"><div class="ch"><span class="ib r">{ic('receipt')}</span>費用</div>RSU台数 ×（設備償却＋通信）<br>＋ イベント候補数 × 品質評価単価<br>＋ 保存量 × クラウド単価</div>
  </div>
</section>

<div class="punch">{ic('sparkles')}警告で集めた希少事象を3者が支払う価値に変え、データ取得費を事業で回収する</div>
'''
page('a', 'Safety Data Business Model', '自動運転の競争優位', '安全データの循環を、保険・自治体・開発の収益へ',
     '相互警告で集めた希少事象を、同意・品質評価を経て各主体が対価を払う価値へ配分し、データ取得費を事業で回収する構想',
     body, '人・車・路側の情報を照合する安全サービスを入口に、<br>希少事象を自動運転の学習資産へ還流させる。', 4)
