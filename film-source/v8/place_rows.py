"""入れ替えの3列：走る経路と停止位置の接地範囲が植栽（花壇・植え込み・木の根元）に一切かからない配置を探す。"""
import numpy as np, json
from PIL import Image
from keepout import veg_mask, obstacle_mask
AX = .16
import sys
BGN = sys.argv[1] if len(sys.argv) > 1 else 'B08_lot_swap'
m = obstacle_mask(sorted(__import__('glob').glob(f'art/{BGN}*.png'))[0], y0=380); H, W = m.shape
ii = np.pad(np.cumsum(np.cumsum(m.astype(np.int32), 0), 1), ((1, 0), (1, 0)))
def rs(x0, y0, x1, y1):
    x0, y0 = max(0, int(x0)), max(0, int(y0)); x1, y1 = min(W, int(x1)), min(H, int(y1))
    return 0 if x1 <= x0 or y1 <= y0 else int(ii[y1, x1] - ii[y0, x1] - ii[y1, x0] + ii[y0, x0])
def wid(name, h):
    a = Image.open(f'art/{name}.png').getchannel('A').point(lambda v: 255 if v > 60 else 0); b = a.getbbox()
    return h * (b[2] - b[0]) / (b[3] - b[1])
WL, WC = wid('S04_cafe_on_legs', 230), wid('S01_fc_cafe', 230)
def feet(tx, ty, sc, dep, ent=760):
    C = (900, 640); P = (C[0] - 430, C[1] + AX * 430)
    to = lambda lx, ly: (tx + (lx - 900) * sc, ty + (ly - 640) * sc)
    out = []
    def add(lx, ly, w, wgt=1):
        x, y = to(lx, ly); w *= sc; d = w * .22          # 斜め45°の車体の接地範囲（奥行き含む）
        out.append((x - w / 2, y - d, x + w / 2, y + 3, wgt, x, y))
    for u in np.linspace(0, 1, 13): add(C[0] + ent * (1 - u), C[1] - AX * ent * (1 - u), WC)
    add(*C, WL, 4); add(*P, WL, 4)
    for u in np.linspace(0, 1, 13):
        dx = dep * u; add(P[0] - dx, P[1] + AX * dx, WC)
    return out
def cost(tx, ty, sc, dep, ent):
    c = 0
    for x0, y0, x1, y1, wgt, x, y in feet(tx, ty, sc, dep, ent):
        if x < 0 or x > W: continue                    # 画面外（左右）の部分は問わない
        if y > 800: c += 100000 * wgt; continue         # 字幕帯に隠れる位置は不可
        c += rs(x0, y0, x1, y1) * wgt
    return c
best, static = [], []
best_all=None
for sc, yr in [(.78, range(600, 800, 4)), (.58, range(500, 690, 5)), (.4, range(440, 600, 5))]:
    cand = []
    for ty in yr:
        for tx in range(400, 1700, 10):
            for dep, ent in [(d, e) for d in (1300, 1000, 750, 550, 420, 320) for e in (760, 600, 450)]:
                c = cost(tx, ty, sc, dep, ent)
                if c > 0: continue
                f = [r for r in feet(tx, ty, sc, dep, ent) if r[4] == 4]
                ov = sum(max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3] + 60, b[3] + 60) - max(a[1] - 120 * sc, b[1] - 120)) for a in f for b in static)
                centre = abs(tx - 900) * (.3 if sc > .8 else .1)         # 手前の列はなるべく画面中央寄り
                cand.append((ov * 10 + centre - dep / 50 - ent / 50, tx, ty, dep, ent))
    cand.sort()
    if not cand: print('植栽を完全に避ける位置が無い', sc); continue
    _, tx, ty, dep, ent = cand[0]; best.append({'sc': sc, 'tx': tx, 'ty': ty, 'dep': dep, 'ent': ent})
    static += [r for r in feet(tx, ty, sc, dep, ent) if r[4] == 4]
print(BGN, json.dumps(best)); json.dump({'bg': BGN, 'rows': best}, open(f'rows_slots_{BGN}.json', 'w'))
