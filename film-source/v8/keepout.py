"""背景の植栽（木・花壇・植え込み）を画素から抜き出し、車両・店舗の接地範囲が重ならない配置を探す。"""
import numpy as np, sys
from PIL import Image, ImageFilter
def veg_mask(path, y0=380):
    a = np.asarray(Image.open(path).convert('RGB')).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    green = (g > r + 12) & (g > b + 4) & (g > 60)
    pink = (r > 150) & (r > g + 40) & (b > g)            # 花壇の花
    m = (green | pink); m[:y0] = False
    im = Image.fromarray((m * 255).astype('uint8')).filter(ImageFilter.MaxFilter(9))   # 少し膨らませて余裕を持たせる
    return np.asarray(im) > 0
CAR_BASE = {'B05c': 'B05_node_day', 'B06c': 'B06_node_night', 'B08c': 'B08_lot_swap'}
def obstacle_mask(path, y0=380):
    """植栽＋（車入りの別版なら）元画像との差分＝追加された車。どちらも部品が重なってはいけない障害物。"""
    import os, glob
    m = veg_mask(path, y0)
    key = os.path.basename(path)[:4]
    if key in CAR_BASE:
        base = sorted(glob.glob(os.path.join(os.path.dirname(path), CAR_BASE[key] + '*.png')))
        if base:
            a = np.asarray(Image.open(path).convert('RGB')).astype(int); b = np.asarray(Image.open(base[0]).convert('RGB')).astype(int)
            if a.shape == b.shape:
                d = np.abs(a - b).sum(2) > 60; d[:y0] = False
                d = np.asarray(Image.fromarray((d * 255).astype('uint8')).filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.MaxFilter(7))) > 0
                m = m | d
    return m

def foot_hits(mask, cx, gy, w):
    """接地範囲（車体幅 w、奥行き w*0.22 の帯）に植栽がいくつ入るか。"""
    h, W = mask.shape; d = max(4, int(w * .22))
    x0, x1 = int(cx - w / 2), int(cx + w / 2); y0, y1 = int(gy - d), int(gy + 4)
    x0, x1 = max(0, x0), min(W, x1); y0, y1 = max(0, y0), min(h, y1)
    if x1 <= x0 or y1 <= y0: return 0
    return int(mask[y0:y1, x0:x1].sum())
if __name__ == '__main__':
    m = veg_mask(sys.argv[1]); Image.fromarray((m * 255).astype('uint8')).save(sys.argv[2])
