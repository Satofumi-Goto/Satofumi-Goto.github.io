"""Mobility World v8：ケーパビリティ資料の画風（ChatGPT作画）で全編を組み立てる。
構成・字幕・場面の順は v7 と同じ。1920x1080・60fps、日英2版を1回の描画から同時に書き出す。
絵は art/ に置く（Bxx_*.png＝背景、Sxx_*.png＝透過部品）。動き・注記・光の流れはここで決定的に生成する。"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageEnhance
import math, subprocess, sys, json, glob
from concurrent.futures import ProcessPoolExecutor

ROOT = Path(__file__).resolve().parent
ART_DIR = ROOT / 'art'
W, H = 1920, 1080
FPS = int(next((a.split('=')[1] for a in sys.argv if a.startswith('--fps=')), 60))
CYAN = (62, 221, 255); WHITE = (244, 249, 255); NAVY = (10, 29, 49); GOLD = (255, 207, 112)
YELLOW = (255, 214, 92); BLUE = (90, 190, 255); RED = (255, 96, 72); GREEN = (110, 233, 176)
FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
FONTB = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
_f = {}
def font(size, bold=False):
    k = (size, bold)
    if k not in _f: _f[k] = ImageFont.truetype(FONTB if bold else FONT, size, index=0)
    return _f[k]
def ease(u): u = min(1, max(0, u)); return u * u * (3 - 2 * u)
def ease_out(u): u = min(1, max(0, u)); return 1 - (1 - u) ** 3
def mix(a, b, u): return a + (b - a) * u

# ---------------- 文言（v7 と同一） ----------------
TEXT = json.loads((ROOT / 'text.json').read_text())   # {ja:[[kicker,title,l1,l2,l3]...], en:[...], rows:{ja:[[title,cap]..], en:[..]}}

# ---------------- 素材 ----------------
_art = {}
ALIASES = {'S04_cafe_on_legs': 'S16_container_on_legs', 'S05_produce_on_legs': 'S16_container_on_legs',
           'S02_fc_produce': 'S01_fc_cafe'}     # 未着の部品は近い絵で仮置き（届けば自動で置き換わる）
def art(name):
    """name の前方一致で art/ から読む。無ければ None。"""
    if name not in _art:
        hits = sorted(glob.glob(str(ART_DIR / f'{name}*.png')))
        if not hits and name in ALIASES: hits = sorted(glob.glob(str(ART_DIR / f'{ALIASES[name]}*.png')))
        if not hits: _art[name] = None
        else:
            im = Image.open(hits[0]).convert('RGBA')
            if name.startswith('S'):
                a = im.getchannel('A').point(lambda v: 0 if v < 60 else v); im.putalpha(a)
                b = a.getbbox(); im = im.crop(b) if b else im
            elif im.size != (1672, 941):
                im = im.resize((1672, round(1672 * im.height / im.width)), Image.Resampling.LANCZOS)
            _art[name] = im
    return _art[name]

OUTDOOR = ('B00', 'B01', 'B04', 'B05', 'B06', 'B08', 'B09', 'B14', 'B16', 'B18')
def kites(src, name, t=0.0):
    """大型カイト式の風力ミル（v7 の空の灰色の2基）を上空に小さく浮かべる。注記は付けない。"""
    if not name.startswith(OUTDOOR): return
    night = name.startswith('B06'); d = ImageDraw.Draw(src, 'RGBA')
    for k, (x, y, h) in enumerate(KITES):
        if name.startswith('B00'): y -= 60
        sx = x + 4 * math.sin(t * .5 + k * 2); sy = y + 3 * math.sin(t * .7 + k)
        d.line((sx - h * .2, sy + h * .4, sx - 240 - 120 * k, 941), fill=(200, 205, 215, 70 if not night else 40), width=1)
        q = sprite('S18_kite_mill_hd' if art('S18_kite_mill_hd') is not None else 'S18_kite_mill', h, night=.6 if night else 0)
        if q is not None: src.alpha_composite(q, (int(sx - q.width / 2), int(sy - q.height / 2)))

_occ = {}
OCC = [None]     # 今の背景の「植栽の根元の高さ」マップ（画素ごと、植栽でなければ 0）
def occ_map(n):
    """植栽（木・植え込み・花壇）を連結成分に分け、各成分の根元（最も下の y）を画素に持たせる。
    部品はこれより手前（根元が部品の接地より下）の植栽に隠される＝奥行きが正しくなる。"""
    if n not in _occ:
        import numpy as np
        from scipy import ndimage
        from keepout import obstacle_mask
        hits = sorted(glob.glob(str(ART_DIR / f'{n}*.png')))
        m = obstacle_mask(hits[0], y0=380) if hits else None
        if m is None: _occ[n] = None
        else:
            lab, k = ndimage.label(m)
            base = ndimage.maximum(np.indices(m.shape)[0], lab, index=np.arange(1, k + 1)) if k else []
            bm = np.zeros(m.shape, np.int16)
            if k: bm = np.concatenate([[0], np.asarray(base, np.int16)])[lab].astype(np.int16)
            _occ[n] = bm
    return _occ[n]

def comp(src, q, x0, y0, gy):
    """部品を背景へ合成。手前の植栽に隠れる部分は描かない。"""
    bm = OCC[0]
    if bm is not None and src.size == (1672, 941):
        import numpy as np
        X0, Y0 = max(0, x0), max(0, y0); X1, Y1 = min(1672, x0 + q.width), min(941, y0 + q.height)
        if X1 > X0 and Y1 > Y0:
            hide = bm[Y0:Y1, X0:X1] > gy + 4
            if hide.any():
                q = q.copy(); a = np.asarray(q.getchannel('A')).copy()
                a[Y0 - y0:Y1 - y0, X0 - x0:X1 - x0][hide] = 0
                q.putalpha(Image.fromarray(a))
    src.alpha_composite(q, (x0, y0))

def bg(*names):
    for n in names:
        a = art(n)
        if a is not None:
            a = a.copy(); kites(a, n, _NOW[0])
            OCC[0] = occ_map(n) if n.startswith(('B05', 'B06', 'B08', 'B09', 'B04')) else None
            return a
    return Image.new('RGBA', (1672, 941), (14, 37, 60, 255))

_spr = {}
def sprite(name, height, night=0.0, flip=False):
    src = art(name)
    if src is None: return None
    key = (name, int(height), round(night, 2), flip)
    if key not in _spr:
        q = src.resize((max(1, round(src.width * height / src.height)), max(1, int(height))), Image.Resampling.LANCZOS)
        if flip: q = q.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        if night > 0:
            a = q.getchannel('A'); rgb = q.convert('RGB')
            rgb = ImageEnhance.Brightness(rgb).enhance(mix(1, .6, night))
            rgb = Image.blend(rgb, Image.new('RGB', rgb.size, (30, 50, 95)), .18 * night)
            q = rgb.convert('RGBA'); q.putalpha(a)
        if len(_spr) > 3000: _spr.clear()
        _spr[key] = q
    return _spr[key]

def xf(x, y, h):
    if XF[0] is None: return x, y, h
    tx, ty, sc = XF[0]; return tx + (x - 900) * sc, ty + (y - 640) * sc, h * sc

def shadow(im, cx, gy, w, strength=75):
    h = max(4, int(w * .09)); pad = 24
    q = Image.new('RGBA', (int(w) + 2 * pad, h + 2 * pad))
    ImageDraw.Draw(q).ellipse((pad, pad, pad + w, pad + h), fill=(0, 10, 20, strength))
    im.alpha_composite(q.filter(ImageFilter.GaussianBlur(9)), (int(cx - w / 2 - pad), int(gy - h / 2 - pad)))

def same_width_h(name, ref, h_ref):
    """ref を高さ h_ref で置いた時と同じ横幅になる name の高さ（脚あり→接地など、同じ物の形違いの差し替え用）。"""
    a, b = art(name), art(ref)
    if a is None or b is None: return h_ref
    return h_ref * (b.width / b.height) * (a.height / a.width)

def lower_on_legs(src, legs, grounded, cx, gy, h, u, night=0.0):
    """脚がスライドして縮み、店舗本体が地面まで下りる（u=0 高脚 → u=1 接地）。回収は u を逆に。"""
    u = ease(u)
    if u >= 1:
        place(src, grounded, cx, gy, same_width_h(grounded, legs, h), night=night); return
    cx, gy, h = xf(cx, gy, h)
    q = sprite(legs, h, night)
    if q is None: return
    hg = same_width_h(grounded, legs, h); drop = (h - hg) * u
    q = q.crop((0, 0, q.width, max(1, int(q.height - drop))))          # 地面より下に入った脚の分を切る＝脚が縮んで見える
    shadow(src, cx, gy - 2, q.width * .9)
    comp(src, q, int(round(cx - q.width / 2)), int(round(gy - h + drop)), gy)

def place(im, name, cx, gy, height, night=0.0, flip=False, alpha=1.0, shade=True):
    cx, gy, height = xf(cx, gy, height)
    q = sprite(name, height, night, flip)
    if q is None: return
    if alpha < 1:
        q = q.copy(); q.putalpha(q.getchannel('A').point(lambda v: int(v * alpha)))
    if shade and alpha > .5: shadow(im, cx, gy - 2, q.width * .9)
    comp(im, q, int(round(cx - q.width / 2)), int(round(gy - q.height)), gy)

AXIS = .16   # 部品の車体軸：左へ1進むと下へ0.16（左手前向きの絵）。反転絵は右手前向き。
def drive(src, name, end, h_end, dist, u, night=0.0, flip=False, alpha=1.0):
    """end（接地点）へ向けて車体の向きどおりに前進する。dist は出発点までの軸方向の距離（奥側）。
    flip=False は左手前へ、flip=True は右手前へ進む。u=0 で出発点、u=1 で end。横滑りさせない。"""
    s_ = -1 if flip else 1
    r = dist * (1 - u)
    x = end[0] + s_ * r; y = end[1] - AXIS * r
    h = h_end * (1 - .00042 * r)
    place(src, name, x, y, h, night=night, flip=flip, alpha=alpha)

# ---------------- 人の歩き ----------------
def walker(src, who, start, end, h, t, t0=0.0, flip=None, night=0.0, pace=1.0):
    """自然な歩き：歩幅と速度を身長に合わせ（約1.3m/秒）、2つの姿勢（踏み出し／通過）を歩調で切り替え、
    上下の弾みと小さな揺れを付ける。目的地に着いたら立ち止まって、呼吸程度の動きだけにする。
    姿勢の絵 Sxx_<who>_a / _b が無い時は 1枚の絵に弾みだけ付ける。"""
    (x0, y0), (x1, y1) = start, end
    dist = math.hypot(x1 - x0, y1 - y0); speed = .75 * h * pace          # 身長1.7m・秒速1.3m 相当（px/秒）
    tt = max(0.0, t - t0); u = min(1.0, tt * speed / max(dist, 1))
    walking = 0 < u < 1
    x = mix(x0, x1, u); y = mix(y0, y1, u); hh = h * (1 + (y - y1) * .0012)
    x, y, hh = xf(x, y, hh); hh = max(6, round(hh / 3) * 3)
    if flip is None: flip = x1 > x0
    step = 2.0 * pace ** .6 * tt                                       # 1秒に2歩（急ぎ足では歩調も上がる）
    a, b = f'S12_{who}_a', f'S12_{who}_b'
    two = art(a) is not None and art(b) is not None
    if walking:
        ph = step % 1.0; bob = abs(math.sin(math.pi * step)) * .018 * hh
        name = (a if ph < .5 else b) if two else (a if art(a) is not None else f'S12_{who}')
        q = sprite(name, hh, night, flip)
        if q is None: q = sprite('S12_people', hh, night, flip)
        if q is None: return
        q = q.rotate(1.2 * math.sin(2 * math.pi * step * .5), resample=Image.Resampling.BICUBIC, expand=False)
        shadow(src, x, y - 2, q.width * .7, 55)
        comp(src, q, int(round(x - q.width / 2)), int(round(y - q.height - bob)), y)
    else:
        name = f'S12_{who}_stand' if art(f'S12_{who}_stand') is not None else (a if art(a) is not None else 'S12_people')
        breathe = 1 + .004 * math.sin(t * 2.1 + x)
        q = sprite(name, hh * breathe, night, flip)
        if q is None: return
        shadow(src, x, y - 2, q.width * .7, 55)
        comp(src, q, int(round(x - q.width / 2)), int(round(y - q.height)), y)

def crowd(src, shop, t, t0, n=22, h=150, spread=900, seed=1):
    """店舗が据わった瞬間から、周りの人が四方から押し寄せて店先に群がる。
    出発は0.2〜1.6秒の間に次々と、急ぎ足（秒速1.8〜2.3m相当）で。店先で半円状の人だかりになる。"""
    if t < t0: return
    import random
    R = random.Random(seed); sx, sy = shop; people = []
    whos = ['shopper', 'parent', 'kids', 'elderly']
    for k in range(n):
        ang = R.uniform(-2.9, -.25) if R.random() < .5 else R.uniform(.25, 2.9)
        dist = R.uniform(.55, 1.0) * spread
        start = (sx + math.cos(ang) * dist, sy + abs(math.sin(ang)) * dist * .28 * (1 if R.random() < .6 else -.6))
        ring = R.uniform(.45, 1.0); a2 = R.uniform(-1.25, 1.25)
        big = math.sqrt(n / 24)
        end = (sx + math.sin(a2) * 260 * big * ring, sy + 40 + math.cos(a2) * 70 * big * ring)
        who = whos[k % 4]; pace = R.uniform(1.4, 1.8) if who != 'elderly' else 1.1
        people.append((end[1], who, start, end, h * R.uniform(.88, 1.06), t0 + R.uniform(.1, 1.2), pace))
    for _, who, st, en, hh, ts, pace in sorted(people, key=lambda p: p[0]):   # 奥から手前へ描く
        walker(src, who, st, en, hh, t, ts, pace=pace)

# ---------------- 光の流れ・リング ----------------
def _pts(pts, step=3.0):
    out = []; acc = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0); n = max(1, int(L / step))
        for k in range(n):
            u = k / n; out.append((x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, acc + L * u))
        acc += L
    out.append((pts[-1][0], pts[-1][1], acc)); return out

def flows(im, t, lines, alpha=1.0):
    if alpha <= 0 or not lines: return
    lay = Image.new('RGBA', im.size); d = ImageDraw.Draw(lay)
    for color, pts in lines:
        P = _pts(pts)
        d.line([p[:2] for p in P[::4]] + [P[-1][:2]], fill=(*color, int(70 * alpha)), width=5)
        for x, y, s in P:
            ph = (s / 110.0 - t * 1.15) % 1.0
            v = max(0.0, 1 - abs(ph - .5) * 5) ** 1.6
            if v > .02:
                r = 2.2 + 2.6 * v; d.ellipse((x - r, y - r, x + r, y + r), fill=(*color, int(255 * v * alpha)))
    im.alpha_composite(lay.filter(ImageFilter.GaussianBlur(7))); im.alpha_composite(lay)

def rings(im, x, y, t, color=CYAN, n=3, rmax=120, alpha=1.0):
    d = ImageDraw.Draw(im, 'RGBA')
    for k in range(n):
        u = (t * .6 + k / n) % 1
        r = 12 + rmax * u; a = int(200 * (1 - u) * alpha)
        d.ellipse((x - r, y - r * .45, x + r, y + r * .45), outline=(*color, a), width=3)

def arcs(im, t, nodes, links, grow=1.0, color=CYAN):
    """空撮のNode間をつなぐ光の線（grow は 0→1 で伸びる）。"""
    lines = []
    for k, (a, b) in enumerate(links):
        u = ease((grow * len(links) - k))
        if u <= 0: continue
        (x0, y0), (x1, y1) = nodes[a], nodes[b]
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2 - math.hypot(x1 - x0, y1 - y0) * .12
        P = [((1 - s) ** 2 * x0 + 2 * (1 - s) * s * mx + s * s * x1, (1 - s) ** 2 * y0 + 2 * (1 - s) * s * my + s * s * y1) for s in [j / 24 * u for j in range(25)]]
        lines.append((color, P))
    flows(im, t, lines)
    d = ImageDraw.Draw(im, 'RGBA')
    for x, y in nodes:
        d.ellipse((x - 9, y - 9, x + 9, y + 9), fill=(*GOLD, 230), outline=(255, 255, 255, 230), width=2)

# ---------------- 注記（資料と同じ紺の吹き出し） ----------------
def callout(im, text, box, target, u, color=CYAN):
    u = ease_out(u)
    if u <= 0: return
    d = ImageDraw.Draw(im, 'RGBA'); f = font(26, True)
    x, y = box; y += (1 - u) * 14
    tw = d.textlength(text, font=f); bw, bh = tw + 34, 48
    x = min(max(20, x), W - 20 - bw)
    if target:
        tx, ty = target
        sx = min(max(x + 20, tx), x + bw - 20)
        d.line((sx, y + bh if ty > y + bh else y, tx, ty), fill=(*color, int(220 * u)), width=2)
        d.ellipse((tx - 6, ty - 6, tx + 6, ty + 6), fill=(*color, int(255 * u)))
    d.rounded_rectangle((x, y, x + bw, y + bh), 9, fill=(*NAVY, int(235 * u)), outline=(*color, int(255 * u)), width=2)
    d.text((x + 17, y + bh / 2), text, font=f, fill=(*WHITE, int(255 * u)), anchor='lm')

# ---------------- カメラ ----------------
class Cam:
    def __init__(s, z, cx, cy): s.z, s.cx, s.cy = z, cx, cy
    def box(s):
        cw = 1672 / s.z; ch = cw * H / W
        x0 = min(max(0, s.cx - cw / 2), 1672 - cw); y0 = min(max(0, s.cy - ch / 2), 941 - ch)
        return x0, y0, cw, ch
    def render(s, src):
        x0, y0, cw, ch = s.box()
        return src.transform((W, H), Image.Transform.EXTENT, (x0, y0, x0 + cw, y0 + ch), Image.Resampling.BICUBIC)
    def pos(s, x, y):
        x0, y0, cw, ch = s.box(); k = W / cw; return ((x - x0) * k, (y - y0) * k)

def cam(t, dur, a, b):
    u = ease(t / dur); return Cam(*(mix(p, q, u) for p, q in zip(a, b)))

def keys(t, ks):
    """複数の要所を滑らかにつなぐカメラ（ks = [(時刻, ズーム, 中心x, 中心y), ...]）。後半の動きを付ける。"""
    if t <= ks[0][0]: return Cam(*ks[0][1:])
    for (t0, *a), (t1, *b) in zip(ks, ks[1:]):
        if t <= t1:
            u = ease((t - t0) / (t1 - t0)); return Cam(*(mix(p, q, u) for p, q in zip(a, b)))
    return Cam(*ks[-1][1:])

def wipe(a, b, u, up=True):
    """断面のせり上がり（up）／沈み込みのワイプ。光る走査線つき。"""
    u = ease(u)
    if u <= 0: return a
    if u >= 1: return b
    edge = int(H * (1 - u)) if up else int(H * u)
    m = Image.new('L', (W, H), 0)
    ImageDraw.Draw(m).rectangle((0, edge, W, H) if up else (0, 0, W, edge), fill=255)
    out = Image.composite(b, a, m)
    ImageDraw.Draw(out, 'RGBA').rectangle((0, edge - 3, W, edge + 3), fill=(*CYAN, 200)); return out

def xfade(a, b, u):
    u = ease(u)
    if u <= 0: return a
    if u >= 1: return b
    return Image.blend(a, b, u)

# ---------------- 場面 ----------------
# 各関数は (画像, 注記のリスト) を返す。注記は言語ごとに文字だけ差し替える。
# 注記 = (ja, en, box_xy, target_xy, u, color)
def SIWM(t):
    """冒頭：緑に囲まれた敷地へ、IWMで真横に走ってコンテナ店舗を据える（ここだけ横移動を見せる）。"""
    src = bg('B00'); gy = IWM_PAD[1]; px = IWM_PAD[0]
    if t < 6.5:      # 正面向きのまま、車輪を90°切って真横へ
        u = ease_out(t / 6.5); place(src, 'S15_fc_container_crab', mix(-350, px, u), gy, 240)
    else:
        down = ease((t - 6.5) / 2.5)
        lower_on_legs(src, 'S16_container_on_legs', 'S16g_container_grounded', px, gy, 240, (t - 9.6) / 1.2)
        crowd(src, (px, gy + 20), t, 9.0, n=40, h=150, spread=1000, seed=3)
        if t >= 9.5:   # 店舗を降ろした車台が、そのまま真横へ抜けて次の仕事へ
            u = ease((t - 9.5) / 5); place(src, 'S17_fc_empty_crab', mix(px, 2100, u), gy + 6, 120)
    c = cam(t, 15, (1.0, 836, 470), (1.06, 836, 500)); im = c.render(src)
    return im, [('独立操舵IWM｜4輪を90°切って真横へ', 'Independent-steering IWM | All wheels at 90°', (120, 300), c.pos(px - 120, gy - 30), (t - 1.5) / .5, CYAN),
                ('切り返しなしで据え付け', 'Placed without back-and-forth turns', (1150, 300), c.pos(px, gy - 200), (t - 7) / .5, GOLD)]
IWM_PAD = (836, 700)   # B00 の据え付け区画（受け取り後に調整）

def S00(t):
    c = cam(t, 15, (1.0, 836, 470), (1.08, 900, 500)); src = bg('B01c', 'B01')
    walker(src, 'kids', (1500, 720), (1000, 770), 150, t, 0.5)
    walker(src, 'parent', (1700, 700), (1250, 760), 175, t, 2.0)
    im = c.render(src)
    return im, [('放課後の居場所を、歩いて行ける場所に', 'A place to gather, within walking distance', (120, 300), None, (t - 6) / .5, GOLD)]

def S01(t):
    c = cam(t, 15, (1.0, 836, 470), (1.12, 820, 470)); im = c.render(bg('B02'))
    return im, [('Seneschal｜利用予定と送迎をつなぐ', 'Seneschal | Bookings linked to transport', (120, 260), None, (t - 10.2) / .5, CYAN)]

def S02(t):
    c = cam(t, 15, (1.12, 860, 470), (1.0, 836, 470)); im = c.render(bg('B03'))
    return im, [('Seneschal｜参加の希望と帰りの移動', 'Seneschal | Participation and the trip home', (120, 260), None, (t - 10.2) / .5, CYAN)]

def SSALON(t):
    """移動式の高齢者コミュニティスペースが走る：HTSドライブトレーンの滑らかで揺れない走り。
    車体は上下に揺らさず、加減速もなめらかに。車窓の湯のみの水面が水平のまま、を小窓で見せる。"""
    src = bg('B10_road_salon', 'B10')
    u = t / 15                                  # ほぼ一定速度で静かに流れる（急な加減速なし）
    end = (520, 800)
    drive(src, 'S07_fc_salon', end, 260, 1250, mix(0, 1, u))
    r = 1250 * (1 - u); vx, vy = end[0] + r, end[1] - AXIS * r
    c = Cam(1.35, vx - 40, vy - 140)            # 車両に並走する追従カメラ
    if t > 10: c = keys(t, [(10, 1.35, vx - 40, vy - 140), (15, 1.05, 760, 520)])
    im = c.render(src)
    # 小窓：揺れない水面（湯のみの水面が水平のまま）
    a = ease((t - 6.5) / .6)
    if a > 0:
        d = ImageDraw.Draw(im, 'RGBA'); bx, by, bw, bh = W - 420, 560, 340, 220
        d.rounded_rectangle((bx, by, bx + bw, by + bh), 14, fill=(*NAVY, int(225 * a)), outline=(*CYAN, int(255 * a)), width=2)
        cx, cy = bx + bw / 2, by + 125
        d.polygon([(cx - 60, cy - 40), (cx + 60, cy - 40), (cx + 48, cy + 50), (cx - 48, cy + 50)], fill=(235, 238, 240, int(255 * a)))
        d.rectangle((cx - 57, cy - 30, cx + 57, cy - 22), fill=(120, 170, 110, int(255 * a)))
        d.line((bx + 30, cy - 26, bx + bw - 30, cy - 26), fill=(*CYAN, int(160 * a)), width=1)
    return im, [('HTSドライブトレーン｜滑らかで静かな走り', 'HTS drivetrain | Smooth and quiet', (120, 300), c.pos(vx, vy - 60), (t - 2) / .5, CYAN),
                ('揺れない＝水面は水平のまま', 'No sway: the tea stays level', (W - 470, 500), None, (t - 6.8) / .5, GOLD)]

def S03(t):
    src = bg('B04')
    u = ease((t - 6.5) / 7)
    drive(src, 'S08_avp_minivan', (1250 + 700, 720 + AXIS * 700), 240, 700, u, flip=True)
    c = cam(t, 15, (1.0, 836, 470), (1.06, 900, 480)); im = c.render(src)
    rings(im, *c.pos(1480, 560), t, CYAN, alpha=ease((t - 4.5) / .6))
    return im, [('スマホで「駐車・充電」を依頼', 'Request parking and charging', (120, 260), None, (t - 1.0) / .5, CYAN),
                ('RSU｜周囲を把握し車両と協調', 'RSU | Senses and coordinates', (1180, 300), c.pos(1480, 560), (t - 5) / .5, CYAN),
                ('AVP｜充電区画へ誘導', 'AVP | Guided to a charging bay', (1180, 380), None, (t - 10) / .5, GOLD)]

CHARGE_BAY = (330, 835)   # B05 の緑の充電区画
DAY_SHOPS = [((1180, 655), 150), ((1450, 760), 185)]   # 昼の空き区画に置くコンテナ店舗（受け取り後に調整）
PARKED = []   # B05/B08 の背景に、まばらな乗用車（5台程度）が既に描かれている
def parked_cars(src, night=0.0):
    """自家用車が減った昼の駐車場：広い区画にまばらに数台だけ止まっている（受け取り後に位置を調整）。"""
    for (x, y), n, fl in PARKED:
        if art(n) is None: n = 'S08_avp_minivan'
        place(src, n, x, y, 120 * (1 + (y - 760) * .0015), night=night, flip=fl)

def day_shops(src, night=0.0):
    parked_cars(src, night)
    for (x, y), h in DAY_SHOPS: place(src, 'S04g_cafe_grounded', x, y, same_width_h('S04g_cafe_grounded', 'S04_cafe_on_legs', h), night=night)   # 営業中は地面設置
def S04(t):
    src = bg('B05c', 'B05_node_day', 'B05'); day_shops(src)
    drive(src, 'S08_avp_minivan', (CHARGE_BAY[0] + 120, CHARGE_BAY[1]), 200, 1100, ease_out(t / 6))
    c = cam(t, 15, (1.0, 836, 470), (1.07, 760, 520)); im = c.render(src)
    if t > 6.3:
        flows(im, t, [(YELLOW, [c.pos(CHARGE_BAY[0] - 40, CHARGE_BAY[1] - 120), c.pos(CHARGE_BAY[0] - 40, CHARGE_BAY[1] - 40), c.pos(CHARGE_BAY[0] + 60, CHARGE_BAY[1] - 40)])], ease((t - 6.3) / .6))
    return im, [('予約区画で自動接続', 'Automatic connection in a reserved bay', (120, 300), c.pos(*CHARGE_BAY), (t - 6.5) / .5, YELLOW),
                ('次の出発に合わせて補充', 'Charged for the next departure', (120, 380), None, (t - 10.2) / .5, GOLD)]

def ROWS(t):
    """店舗の載せ替え 26秒：v7 と同じく奥行きの違う3列を時間差で動かす。"""
    src = bg(ROWS_BG + 'c' if False else ROWS_BG, 'B08', 'B05'); parked_cars(src)
    for T, sc, (tx, ty), dep, ent in sorted(ROW_SLOTS(t), key=lambda r: r[2][1]):   # 奥の列から描く
        XF[0] = (tx, ty, sc); row_layer(src, max(0, T), people=(sc == max(r[1] for r in ROW_SLOTS(t))), dep=dep, ent=ent); XF[0] = None
    # 全編で最も大事な場面：手前の列を中心に、追従→全景→寄り→着地の衝撃→引き→出発の追従
    _, sc, (tx, ty), DEP, ENT = ROW_SLOTS(t)[0]
    F = lambda lx, ly: (tx + (lx - 900) * sc, ty + (ly - 640) * sc)   # 手前の列の層座標 → 背景座標
    Cs, Ps = F(900, 640), F(470, 640 + AXIS * 430)
    ent = F(900 + ENT * (1 - ease_out(min(1, t / 6))), 640 - AXIS * ENT * (1 - ease_out(min(1, t / 6))))
    dep = F(470 - DEP * ease((t - 19) / 7), 640 + AXIS * 430 + AXIS * DEP * ease((t - 19) / 7))
    if t < 6:
        c = Cam(1.45, ent[0] - 60, ent[1] - 70)
    else:
        c = keys(t, [(6, 1.45, Cs[0] - 60, Cs[1] - 70), (7.6, 1.0, 836, 470), (8.6, 1.0, 836, 470),
                     (11.5, 1.5, (Cs[0] + Ps[0]) / 2, Cs[1] - 20), (13.0, 1.5, Cs[0] - 40, Cs[1] - 40),
                     (14.6, 1.45, Cs[0] - 40, Cs[1] - 40), (18.6, 1.0, 836, 480), (19.2, 1.0, 836, 480)])
        if t >= 19.2:
            u = ease((t - 19.2) / 1.2); c = Cam(mix(1.0, 1.35, u), mix(836, dep[0] + 80, u), mix(480, dep[1] - 60, u))
            if t >= 24.5: c = keys(t, [(24.5, 1.35, dep[0] + 80, dep[1] - 60), (26, 1.05, 760, 500)])
    hit = max(0.0, 1 - abs(t - 13.4) / .45)                    # カフェの着地の衝撃
    shake(c, t, 9 * hit)
    im = c.render(src)
    if 13.2 < t < 14.4:                                         # 着地の土ぼこり
        d = ImageDraw.Draw(im, 'RGBA'); gx, gy2 = c.pos(Cs[0], Cs[1] + 10); u = (t - 13.2) / 1.2
        for k in range(18):
            ang = k / 18 * math.pi; r = 40 + 220 * u
            x = gx + math.cos(ang) * r * 1.4 * (1 if k % 2 else -1); y = gy2 - math.sin(ang) * r * .18
            rr = 8 + 18 * u; d.ellipse((x - rr, y - rr * .6, x + rr, y + rr * .6), fill=(200, 195, 185, int(45 * (1 - u))))
    return im, [('昇降脚で支え、車台が抜ける', 'Legs hold the body; the chassis slides out', (120, 300), c.pos(*Cs), (t - 8.8) / .5, CYAN),
                ('接地・開店と同時に次の店舗へ接合', 'Opening and loading at the same time', (1100, 300), c.pos(*Ps), (t - 14.8) / .5, GOLD)]

_RS = json.loads((ROOT / 'rows_slots.json').read_text()) if (ROOT / 'rows_slots.json').exists() else None
ROWS_SLOTS_FIXED = _RS['rows'] if _RS else None
ROWS_BG = _RS['bg'] if _RS else 'B08_lot_swap'
def ROW_SLOTS(t):
    # 手前・中・奥の3列（カフェの停車位置＝背景座標、植栽を避けて place_rows.py で決定）。奥ほど遅れて始まる。描く順は奥から。
    S = ROWS_SLOTS_FIXED or [{'sc': .9, 'tx': 900, 'ty': 700, 'dep': 1200}, {'sc': .62, 'tx': 1060, 'ty': 560, 'dep': 1200}, {'sc': .42, 'tx': 1180, 'ty': 470, 'dep': 1200}]
    delay = {0: 0.0, 1: 3.5, 2: 7.0}
    rows = [(t - delay[k], r['sc'], (r['tx'], r['ty']), r['dep'], r.get('ent', 760)) for k, r in enumerate(S)]
    return rows          # [0] が手前の列

XF = [None]   # 入れ替えの列の座標変換（列座標 → 背景座標）
def row_layer(src, t, people=True, dep=1200, ent=760):
    C = (900, 640); P = (C[0] - 430, C[1] + AXIS * 430)      # 青果店は車体軸の前方
    lift = 18 * ease((t - 3) / 2)                              # 交換先を先に持ち上げる
    # 描く順：車台（店舗の下を通る）→ 青果店 → カフェ（奥）… 車台が店舗の上に見えないように
    if 6 <= t < 15:      # 車台がカフェの下から前へ抜け、青果店の下へ
        drive(src, 'S03_fc_empty', P, same_width_h('S03_fc_empty', 'S04_cafe_on_legs', 230) * .97, 430, ease((t - 7) / 6))
    if t < 6:
        drive(src, 'S01_fc_cafe', C, 230, ent, ease_out(t / 6))
    else:
        lower_on_legs(src, 'S04_cafe_on_legs', 'S04g_cafe_grounded', C[0], C[1], 230, (t - 12.2) / 1.2)   # 車台が抜けたら脚がスライドして接地
    if t < 15:
        place(src, 'S05_produce_on_legs', P[0], P[1] - lift, 230)
    elif t < 17:         # 車台と接合し、脚を格納（脚あり→載った姿へ切替）
        u = ease((t - 15) / 2)
        place(src, 'S05_produce_on_legs' if u < .5 else 'S02_fc_produce', P[0], P[1] - lift * (1 - u), 230)
    else:                # 接合して前方へ出発
        u = ease((t - 19) / 7)
        dx = dep * u
        place(src, 'S02_fc_produce', P[0] - dx, P[1] + AXIS * dx, 230 * (1 + .00042 * dx))
    if people:
        crowd(src, (C[0], C[1] + 20), t, 13.2, n=64, h=150, spread=1050, seed=5)

def S08(t):
    src = bg('B09', 'B08'); parked_cars(src); place(src, 'S04g_cafe_grounded', 900, 650, same_width_h('S04g_cafe_grounded', 'S04_cafe_on_legs', 230))
    crowd(src, (900, 670), t, 0.0, n=90, h=150, spread=1150, seed=9)
    c = keys(t, [(0, 1.45, 620, 600), (3, 1.4, 700, 590), (11, 1.0, 836, 470), (15, 1.03, 860, 470)]); im = c.render(src)
    return im, [('空いていた駐車場が、人の居場所に', 'An empty lot becomes a place to meet', (120, 300), None, (t - 5) / .5, GOLD)]

NODE_FLOWS = [  # B07 断面の配管（元絵座標）
    (BLUE, [(160, 690), (150, 690), (150, 600), (150, 525)]),                    # 水素：タンク→地上の供給口
    (BLUE, [(330, 690), (380, 600), (560, 600), (575, 660)]),                    # 冷熱：タンク→熱交換器
    (BLUE, [(700, 600), (1240, 582), (1560, 582), (1560, 650)]),                 # 冷熱：熱交換器→HPC室
    (RED, [(1540, 598), (1250, 596), (720, 612), (690, 660)]),                   # 排熱：HPC→熱交換器
    (YELLOW, [(1250, 525), (1250, 572), (1030, 576), (1030, 670)]),              # 電力：受電→配電盤
    (YELLOW, [(1250, 572), (1300, 600), (1300, 650)]),                           # 電力：配電盤→HPC
]
NODE_LABELS = [('LH2タンク｜水素と冷熱', 'LH2 tank | Hydrogen and cold', (140, 540), (245, 700), BLUE),
               ('熱交換器', 'Heat exchanger', (560, 540), (630, 700), BLUE),
               ('分散HPC｜排熱を回収', 'Distributed HPC | Heat recovery', (1260, 540), (1300, 700), RED),
               ('太陽光｜PPA・VPP', 'Solar | PPA and VPP', (100, 330), (230, 215), YELLOW)]
NIGHT_LOT = (1180, 760)    # B06 で可搬式整備を置く位置

def night_work(src, t, start=0.0, arrive=True):
    """夜だけ来る可搬式の整備：トレーラー型ユニットが入り、清掃ロボと作業員が働く。"""
    x, gy = NIGHT_LOT
    u = ease_out((t - start) / 4) if arrive else 1
    # 整備コンテナ（牽引車なし・本人訂正）は FCスケートボードに載って来て据えられ、車台は去る
    r = 800 * (1 - u); cx_, cy_ = x + 230 + r, gy - 10 - AXIS * r
    if u < 1 or (t - start) < 4.6:
        place(src, 'S03_fc_empty', cx_, cy_ + 4, same_width_h('S03_fc_empty', 'S09_portable_maintenance', 170) * .7, night=.5)
    lift = 0 if u < 1 else 0
    place(src, 'S09_portable_maintenance', cx_, cy_ - (40 if u < 1 else 40 * (1 - ease((t - start - 4) / 1.2))), 170, night=.35)
    place(src, 'S04g_cafe_grounded', x - 330, gy + 10, same_width_h('S04g_cafe_grounded', 'S04_cafe_on_legs', 175), night=.55)
    place(src, 'S03_fc_empty', x - 60, gy + 30, same_width_h('S03_fc_empty', 'S04_cafe_on_legs', 175) * .97, night=.6)
    ur = ease((t - start - 3) / 7); rx = mix(x - 190, x - 470, ur); ry = gy + 50 - AXIS * 280 * (1 - ur)
    place(src, 'S10_cleaning_robot', rx, ry, 95, night=.5)
    d = ImageDraw.Draw(src, 'RGBA')
    for k in range(26):
        ph = (k * .137 + t * 1.7) % 1
        px = rx - 60 - 40 * ph + 8 * math.sin(k * 3.1); py = ry - 70 + 30 * ph * ph + 5 * math.cos(k * 1.7)
        r = 1.6 + 1.2 * (1 - ph); d.ellipse((px - r, py - r, px + r, py + r), fill=(190, 230, 255, int(150 * (1 - ph))))
    place(src, 'S11_worker_kneel', x + 40, gy + 40, 70, night=.5)
    place(src, 'S11_worker_tablet', x + 120, gy + 30, 98, night=.5)

def S09(t):
    out = None; notes = []
    if t < 5.2:
        src = bg('B05c', 'B05_node_day', 'B05'); day_shops(src)
        place(src, 'S08_avp_minivan', CHARGE_BAY[0] + 120, CHARGE_BAY[1], 200)
        c = keys(t, [(0, 1.35, 1100, 560), (4.5, 1.0, 836, 470), (5.2, 1.0, 836, 470)]); out = c.render(src)
        notes.append(('昼｜買物の間に自動充電', 'Day | Charging while people shop', (330, 380), c.pos(*CHARGE_BAY), (t - 1.5) / .5, YELLOW))
    if 4.6 <= t < 10.2:
        ut = t - 4.6; src = bg('B07_node_cutaway', 'B07')
        flows(src, t, NODE_FLOWS, ease((ut - .5) / .8))
        c = keys(ut, [(0, 1.4, 450, 941), (2.5, 1.3, 700, 941), (5.6, 1.0, 836, 941)]); under = c.render(src)
        if t >= 5.2: notes = []
        for k, (ja, en, box, tgt, col) in enumerate(NODE_LABELS):
            notes.append((ja, en, box, c.pos(*tgt), (t - 5.5 - .7 * k) / .45, col))
        out = under if out is None else wipe(out, under, (t - 4.6) / .6, up=True)
    if t >= 9.6:
        src = bg('B06c', 'B06_node_night', 'B06'); night_work(src, t, start=10.0)
        c = keys(t - 9.6, [(0, 1.0, 836, 470), (5.4, 1.35, 1120, 560)]); night = c.render(src)
        if t >= 10.2: notes = []
        notes.append(('夜だけ来る、可搬式の整備・清掃', 'Night only | Portable cleaning and maintenance', (W - 760, 300), c.pos(*NIGHT_LOT), (t - 11.5) / .5, CYAN))
        out = night if out is None else wipe(out, night, (t - 9.6) / .6, up=False)
    return out, notes

def S10(t):
    src = bg('B07_node_cutaway', 'B07'); flows(src, t, NODE_FLOWS[:3], ease((t - .5) / .8))
    c = keys(t, [(0, 1.45, 420, 760), (9, 1.4, 1250, 720), (15, 1.0, 836, 941)]); im = c.render(src)
    return im, [(ja, en, box, c.pos(*tg), (t - 1.5 - k) / .45, col) for k, (ja, en, box, tg, col) in enumerate(NODE_LABELS[:3])]

def plant_scene(name, lines, labels):
    def f(t):
        src = bg(name); flows(src, t, lines, ease((t - .6) / .8))
        c = keys(t, [(0, 1.45, 520, 600), (6, 1.35, 1150, 560), (12, 1.0, 836, 470), (15, 1.02, 836, 470)]); im = c.render(src)
        return im, [(ja, en, box, c.pos(*tg) if tg else None, (t - 1.5 - 1.6 * k) / .45, col) for k, (ja, en, box, tg, col) in enumerate(labels)]
    return f

ANNOT = json.loads((ROOT / 'annot.json').read_text()) if (ROOT / 'annot.json').exists() else {}
def A(key):
    a = ANNOT.get(key, {})
    col = {'Y': YELLOW, 'B': BLUE, 'R': RED, 'C': CYAN, 'G': GOLD, 'N': GREEN}
    return ([(col[c], [tuple(p) for p in pts]) for c, pts in a.get('flows', [])],
            [(ja, en, tuple(b), tuple(tg) if tg else None, col[c]) for ja, en, b, tg, c in a.get('labels', [])])

KITES = [(560, 115, 40), (880, 140, 30)]   # 上空の2基（元絵座標・高さ）
def S11(t):
    """上空のカイト式風力ミルのアップから引いて街の上空を見せ（説明なし）、回転力の配分の断面へつなぐ。"""
    if t < 6.6:
        name = next((n for n in ('B14', 'B05', 'B00') if art(n) is not None), 'B05')
        src = bg(name); hd = art('S18_kite_mill_hd') is not None
        kx, ky, kh = KITES[0]
        zmax = 6.0 if hd else 3.0
        c = keys(t, [(0, zmax, kx, ky + 10), (1.2, zmax * .92, kx, ky + 10), (6.0, 1.0, 836, 470)])
        sky = c.render(src)
        if hd:   # 寄った時も粗くならないよう、高解像度の絵を画面座標で重ねる
            x0, y0, cw, ch = c.box(); k = W / cw
            sx = kx + 4 * math.sin(_NOW[0] * .5); sy = ky + 3 * math.sin(_NOW[0] * .7)
            q = sprite('S18_kite_mill_hd', max(8, kh * k)); px, py = c.pos(sx, sy)
            if q is not None: sky.alpha_composite(q, (int(px - q.width / 2), int(py - q.height / 2)))
        if t < 6.0: return sky, []
        im, notes = plant_scene('B11', *A('B11'))(t)
        return wipe(sky, im, (t - 6.0) / .6, up=True), []
    return plant_scene('B11', *A('B11'))(t)
def S12(t): return plant_scene('B12', *A('B12'))(t)
def S13(t): return plant_scene('B13', *A('B13'))(t)
def S15(t): return plant_scene('B15', *A('B15'))(t)

def S14(t):
    src = bg('B14'); a = ANNOT.get('B14', {})
    nodes = [tuple(p) for p in a.get('nodes', [])]; links = [tuple(l) for l in a.get('links', [])]
    n0 = nodes[0] if nodes else (836, 470)
    c = keys(t, [(0, 1.5, *n0), (2, 1.45, *n0), (12, 1.0, 836, 470), (15, 1.02, 836, 470)]); im = c.render(src)
    if nodes: arcs(im, t, [c.pos(*p) for p in nodes], links, grow=ease((t - .8) / 9))
    return im, [('一つの拠点から、街全体へ', 'From one hub to the whole city', (120, 300), None, (t - 2) / .5, GOLD)]

def shake(c, t, amp):
    """カメラの揺れ（連結の衝撃・eVTOL の通過）。"""
    if amp <= 0: return c
    c.cx += amp * (math.sin(t * 37) + .6 * math.sin(t * 61 + 1)); c.cy += amp * (math.sin(t * 43 + 2) + .5 * math.sin(t * 71)); return c

def blur_place(src, name, x, gy, h, vx, n=6, flip=False):
    """速度方向に尾を引くモーションブラー付きで置く。"""
    for k in range(n, 0, -1):
        q = sprite(name, h, 0, flip)
        if q is None: return
        q = q.copy(); q.putalpha(q.getchannel('A').point(lambda v, a=.10 + .05 * (n - k): int(v * a)))
        src.alpha_composite(q, (int(x - vx * k * .012 - q.width / 2), int(gy - q.height)))
    place(src, name, x, gy, h, flip=flip)

def S16(t):
    """動的編成の新交通：2台が走りながら追いつき連結 → 車内を人が行き来 → 再び分かれて別々の行先へ。"""
    gy = 735
    if t < 5.2 or t >= 10.0:
        src = bg('B16')
        if t < 5.2:      # 後続車が追いつき、走行中に連結する（低い位置からの追従）
            lead = mix(300, 900, t / 5.2); gap = mix(520, 0, ease(t / 4.6))
            pod_w = (sprite('S14_pod', 190) or Image.new('RGBA', (420, 1))).width
            if gap > 2:
                blur_place(src, 'S14_pod', lead, gy, 190, 220)
                blur_place(src, 'S14_pod', lead - pod_w - gap, gy, 190, 320)
            else:
                blur_place(src, 'S14_coupled_pods', lead - pod_w / 2, gy, 190, 220)
            hit = max(0.0, 1 - abs(t - 4.6) / .35)
            c = keys(t, [(0, 1.45, lead - 300, gy - 120), (4.6, 1.35, lead - pod_w / 2, gy - 110), (5.2, 1.3, lead - pod_w / 2, gy - 110)])
            c.cx = mix(c.cx, lead - 200, .5); shake(c, t, 10 * hit)
            im = c.render(src)
            if hit > 0:   # 連結の閃光
                jx, jy = c.pos(lead - pod_w / 2, gy - 95); d = ImageDraw.Draw(im, 'RGBA'); r = 30 + 90 * (1 - hit)
                d.ellipse((jx - r, jy - r, jx + r, jy + r), outline=(*CYAN, int(230 * hit)), width=6)
            notes = [('走行中に物理連結', 'Coupled on the move', (120, 300), c.pos(lead - pod_w / 2, gy - 95), (t - 4.4) / .4, CYAN)]
            return im, notes
        # 10–15：連結を解き、1台は先へ、1台は分岐して別の行先へ。カメラは引き上げて全体を見せる
        u = ease((t - 10) / 5); base = 900 + 300 * (t - 10)
        pod_w = (sprite('S14_pod', 190) or Image.new('RGBA', (420, 1))).width
        place(src, 'S14_pod', base + 180 * u, gy - 40 * u, 190 * (1 - .25 * u))
        place(src, 'S14_pod', base - pod_w - 260 * u, gy + 60 * u, 190 * (1 + .1 * u), flip=False)
        c = keys(t - 10, [(0, 1.35, base - pod_w / 2, gy - 110), (5, 1.0, 836, 470)])
        im = c.render(src)
        return im, [('連結を解除し、それぞれの行先へ', 'Uncoupled for separate destinations', (120, 300), None, (t - 10.4) / .5, GOLD)]
    # 5.2–10：連結した車内の断面。人が通路を通って隣の車両へ移る
    src = bg('S14_pods_interior', 'B16')
    if art('S14_pods_interior') is not None:
        src = Image.new('RGBA', (1672, 941), (12, 30, 50, 255)); q = art('S14_pods_interior')
        q = q.resize((1600, round(1600 * q.height / q.width)), Image.Resampling.LANCZOS); src.alpha_composite(q, (36, (941 - q.height) // 2))
    walker(src, 'shopper', (420, 568), (1180, 568), 150, t, 5.6, flip=True)
    walker(src, 'parent', (1320, 570), (720, 570), 150, t, 6.4, flip=False)
    c = keys(t - 5.2, [(0, 1.3, 600, 520), (4.8, 1.3, 1080, 520)]); im = c.render(src)
    return im, [('通路がつながり、車両間を移動', 'Walk through the connected gangway', (120, 300), None, (t - 5.8) / .5, GOLD)]

def S17(t):
    c = keys(t, [(0, 1.0, 700, 470), (15, 1.18, 960, 470)]); im = c.render(bg('B17'))
    d = ImageDraw.Draw(im, 'RGBA')
    boxes = [('Seneschal', 960, 250, CYAN), ('Federation', 960, 470, GOLD)]
    cons = ['活動', 'フリート', 'サービス拠点', '都市運用']
    for k, (n, x, y, col) in enumerate(boxes):
        u = ease_out((t - 1 - 2.5 * k) / .6)
        if u > 0:
            d.rounded_rectangle((x - 210, y - 50, x + 210, y + 50), 14, fill=(*NAVY, int(235 * u)), outline=(*col, int(255 * u)), width=3)
            d.text((x, y), n, font=font(40, True), fill=(*WHITE, int(255 * u)), anchor='mm')
    for k in range(4):
        u = ease_out((t - 6 - .5 * k) / .6); x = 330 + k * 420
        if u > 0:
            d.rounded_rectangle((x - 180, 650, x + 180, 740), 12, fill=(*NAVY, int(235 * u)), outline=(*GREEN, int(255 * u)), width=3)
    flows(im, t, [(CYAN, [(960, 300), (960, 420)])] + [(GREEN, [(960, 520), (330 + k * 420, 650)]) for k in range(4)], ease((t - 4) / 1))
    return im, [('__CONSOLE__', '__CONSOLE__', (0, 0), None, (t - 6) / .5, GREEN)]
CONSOLES = {'ja': ['活動', 'フリート', 'サービス拠点', '都市運用'], 'en': ['Activity', 'Fleet', 'Service Hub', 'Urban']}

def S18(t):
    """eVTOL が正面からこちらへ迫り、頭上を抜ける → 屋上ポートへ着陸。"""
    if t < 7.4:
        src = bg('B18'); a = ANNOT.get('B18', {}); vx, vy = a.get('approach', (900, 300))
        u = (t / 7.4) ** 2.2                                  # 遠くから加速度的に迫る
        h = mix(40, 2600, u); x = mix(vx, 836, u); y = mix(vy, 1200, u ** 1.4)
        c = Cam(1.0, 836, 470); shake(c, t, 14 * max(0, (t - 6.2) / 1.2))
        im = c.render(src)
        q = sprite('S13_evtol_front', h) or sprite('S13_evtol', h)
        if q is not None:
            if u > .55:   # 近づくほど尾を引く
                for k in range(5, 0, -1):
                    g = q.copy(); g.putalpha(g.getchannel('A').point(lambda v, a=.12: int(v * a)))
                    im.alpha_composite(g, (int(x - q.width / 2), int(y - q.height / 2 + k * 14 * u)))
            im.alpha_composite(q, (int(x - q.width / 2), int(y - q.height / 2)))
        if t > 6.6:      # 通過の閃光
            f = Image.new('RGBA', (W, H), (255, 255, 255, int(160 * max(0, 1 - abs(t - 7.2) / .3)))); im.alpha_composite(f)
        return im, [('eVTOLがNode間を結ぶ', 'eVTOL links the Nodes', (120, 300), None, (t - 1.5) / .5, GOLD)]
    src = bg('B18'); a = ANNOT.get('B18', {}); px, py = a.get('pad', (836, 560))
    u = ease((t - 7.4) / 5.6)
    place(src, 'S13_evtol', mix(px + 600, px, u), mix(py - 420, py, u), mix(150, 260, u), shade=u > .8)
    c = keys(t - 7.4, [(0, 1.0, 900, 380), (5.6, 1.4, px, py - 60), (7.6, 1.45, px, py - 60)]); im = c.render(src)
    rings(im, *c.pos(px, py), t, GOLD, alpha=ease((t - 11) / .6))
    return im, [('屋上のNodeで補充・整備を共用', 'Shared replenishment and maintenance on the rooftop', (120, 300), c.pos(px, py - 60), (t - 11.5) / .5, GOLD)]

def S19(t):
    src = bg('B06c', 'B06_node_night', 'B06'); night_work(src, t, start=-6, arrive=False)
    c = keys(t, [(0, 1.45, NIGHT_LOT[0] - 300, NIGHT_LOT[1] - 40), (12, 1.0, 836, 470), (15, 1.0, 836, 470)]); im = c.render(src)
    notes = [('車輪・足回り・機器を点検', 'Inspecting wheels, running gear and equipment', (W - 760, 300), c.pos(*NIGHT_LOT), (t - 1) / .5, CYAN)]
    return im, notes

SEGMENTS = [('iwm', 15, SIWM), (0, 15, S00), (1, 15, S01), (2, 15, S02), ('salon', 15, SSALON), (3, 15, S03), (4, 15, S04), ('rows', 26, ROWS),
            (8, 15, S08), (9, 15, S09), (10, 15, S10), (11, 15, S11), (12, 15, S12), (13, 15, S13),
            (14, 15, S14), (15, 15, S15), (16, 15, S16), (17, 15, S17), (18, 15, S18), (19, 15, S19)]
TOTAL = sum(d for _, d, _ in SEGMENTS)   # 311 秒（IWMの場面と、移動式コミュニティスペースの走行場面を追加）

def locate(T):
    a = 0
    for idx, d, fn in SEGMENTS:
        if T < a + d: return idx, d, fn, T - a
        a += d
    idx, d, fn = SEGMENTS[-1]; return idx, d, fn, d - 1e-6

# ---------------- 文字（言語ごと） ----------------
def overlay(base, lang, idx, d, t, notes):
    im = base.copy()
    for ja, en, box, tgt, u, col in notes:
        if ja == '__CONSOLE__':
            dd = ImageDraw.Draw(im, 'RGBA')
            for k, n in enumerate(CONSOLES[lang]):
                a = ease_out((t - 6 - .5 * k) / .6)
                if a > 0: dd.text((330 + k * 420, 695), n, font=font(30, True), fill=(*WHITE, int(255 * a)), anchor='mm')
            continue
        callout(im, ja if lang == 'ja' else en, box, tgt, u, col)
    shade = Image.new('RGBA', (W, H)); sd = ImageDraw.Draw(shade)
    for y in range(225): sd.line((0, y, W, y), fill=(5, 19, 35, int(200 * (1 - y / 225))))
    sd.rectangle((0, 933, W, H), fill=(5, 19, 35, 230)); im.alpha_composite(shade)
    dd = ImageDraw.Draw(im, 'RGBA')
    if idx == 'rows':
        ph = 0 if t < 6 else 1 if t < 13 else 2 if t < 19 else 3
        title, cap = TEXT['rows'][lang][ph]; kicker = '04 / SWAP BODY'
        lines = [(cap, 1.0)]
    else:
        kicker, title, l1, l2, l3 = TEXT[idx][lang] if isinstance(idx, str) else TEXT[lang][idx]
        k = min(2, int(t // 5)); a = min(1, (t - 5 * k) / .35, (5 * (k + 1) - t) / .35 if k < 2 else 1)
        lines = [([l1, l2, l3][k], max(0, a))]
    dd.text((60, 30), kicker, font=font(25), fill=CYAN)
    dd.text((60, 74), title, font=font(42, True), fill=WHITE)
    dd.text((1860, 38), '未来構想 / CONCEPT' if lang == 'ja' else 'FUTURE CONCEPT', font=font(22), fill=WHITE, anchor='ra')
    dd.text((60, 1044), 'SATOFUMI GOTO', font=font(18), fill=(157, 182, 202), anchor='lm')
    for s, a in lines:
        size = 34
        while dd.textlength(s, font=font(size)) > 1780: size -= 1
        dd.text((960, 982), s, font=font(size), fill=(*WHITE, int(255 * a)), anchor='mm')
    if idx == 19 and t > 10:   # 音楽の表記（v7 と同じ位置づけ）
        a = ease((t - 10) / .6)
        dd.rounded_rectangle((420, 760, 1500, 900), 12, fill=(*NAVY, int(215 * a)))
        for y, s, sz in [(792, 'Music by Scott Buckley — released under CC-BY 4.0', 24), (830, MUSIC_TITLES, 23),
                         (866, 'www.scottbuckley.com.au  •  creativecommons.org/licenses/by/4.0', 18)]:
            dd.text((960, y), s, font=font(sz), fill=(*WHITE, int(255 * a)), anchor='mm')
    fade = min(1, t / .4, (d - t) / .4)
    if fade < 1: im.alpha_composite(Image.new('RGBA', (W, H), (5, 17, 29, int(255 * (1 - fade)))))
    return im.convert('RGB').tobytes()
MUSIC_TITLES = (ROOT / 'music_titles.txt').read_text().strip() if (ROOT / 'music_titles.txt').exists() else 'Felicity  /  Where Stars Fall  /  Born Of The Sky'

_NOW = [0.0]
def frame_pair(k):
    T = k / FPS; idx, d, fn, t = locate(T); _NOW[0] = T
    base, notes = fn(t)
    base = base.convert('RGBA')
    return overlay(base, 'ja', idx, d, t, notes), overlay(base, 'en', idx, d, t, notes)

def chunk(rng): return [frame_pair(k) for k in rng]

if __name__ == '__main__':
    if '--stills' in sys.argv:
        (ROOT / 'qa').mkdir(exist_ok=True); a = 0
        for idx, d, fn in SEGMENTS:
            for f in [.3, .6, .9]:
                k = int((a + d * f) * FPS); ja, en = frame_pair(k)
                Image.frombytes('RGB', (W, H), ja).resize((960, 540)).save(ROOT / 'qa' / f'{a:03}-{idx}-{f}.jpg', quality=82)
            a += d
        sys.exit()
    rng = next((a.split('=')[1] for a in sys.argv if a.startswith('--range=')), None)
    a0, a1 = (map(float, rng.split(':')) if rng else (0, TOTAL))
    tag = next((a.split('=')[1] for a in sys.argv if a.startswith('--tag=')), 'full')
    out = {l: ROOT / 'out' / f'{tag}-{l}.mp4' for l in ['ja', 'en']}; (ROOT / 'out').mkdir(exist_ok=True)
    enc = {l: subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                                '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-g', str(FPS * 2), '-pix_fmt', 'yuv420p', str(p)], stdin=subprocess.PIPE) for l, p in out.items()}
    K0, K1 = int(a0 * FPS), int(a1 * FPS); step = FPS
    with ProcessPoolExecutor(4) as ex:
        for res in ex.map(chunk, [range(s, min(K1, s + step)) for s in range(K0, K1, step)]):
            for ja, en in res: enc['ja'].stdin.write(ja); enc['en'].stdin.write(en)
    for p in enc.values(): p.stdin.close()
    assert all(p.wait() == 0 for p in enc.values())
    print('done', out)
