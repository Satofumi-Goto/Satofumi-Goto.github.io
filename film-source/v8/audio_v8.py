"""v8 の音：明るい日常（Felicity＋小鳥・子供）→ 未来へ（Discovery）→ 頂点（Age of Wonder／Clarion、場面18で迎える）
→ 静かな結び（Felicity 冒頭を静かに戻し、夜の虫の声と遠い街の音から無音へ）。
曲が music/ に無い場合は v7 の音を下敷きにする（--fallback）。"""
from pathlib import Path
import numpy as np, subprocess, wave, sys, glob
ROOT = Path(__file__).resolve().parent
RATE = 48000; TOTAL = 311.0
S2, S3, PEAK_END = 105.0, 221.0, 296.0
CLIMAX = 251.0          # 動的編成（場面16）から eVTOL（場面18）まで：最高潮。別の曲に切り替えてよい（本人）
COUPLE_AT, FLYBY_AT = 255.6, 288.2   # 連結の衝撃／eVTOL の通過
SWAP0, SWAP_LAND = 105.0, 118.4        # 店舗の入れ替え（全編で最も大事な場面）の始まり／カフェの着地      # 冒頭のIWM場面（15秒）を加えた後の時刻      # 段階2の始まり／段階3の始まり／頂点の終わり（場面18の終わり）

def decode(path, start=0, dur=None, filt=None):
    af = [f'atrim=start={start}' + (f':duration={dur}' if dur else ''), 'asetpts=PTS-STARTPTS']
    if filt: af.append(filt)
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-af', ','.join(af), '-ar', str(RATE), '-ac', '2', '-f', 'f32le', '-'])
    return np.frombuffer(raw, '<f4').reshape(-1, 2).copy()

def duration(path):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)]))

def rms(x): return float(np.sqrt(np.mean(x ** 2))) + 1e-9

out = np.zeros((int(TOTAL * RATE), 2), np.float32)
def put(x, at, gain=1.0, fin=0.0, fout=0.0):
    n = len(x); t = np.arange(n) / RATE; env = np.ones(n, np.float32)
    if fin: env = np.minimum(env, t / fin)
    if fout: env = np.minimum(env, np.maximum(0, (n / RATE - t) / fout))
    env = np.sin(np.clip(env, 0, 1) * np.pi / 2)        # 等パワーのクロスフェード
    a = int(at * RATE); b = min(len(out), a + n)
    out[a:b] += (x[:b - a] * env[:b - a, None] * gain)

def crickets(dur, seed=7):
    """夜の虫の声（合成）：4.2〜5.1kHz の短いさえずりの列＋遠い街の低いざわめき。"""
    rng = np.random.default_rng(seed); n = int(dur * RATE); t = np.arange(n) / RATE
    y = np.zeros((n, 2), np.float32)
    for k in range(7):
        f = rng.uniform(4200, 5100); rate = rng.uniform(2.2, 3.4); pan = rng.uniform(.2, .8); ph = rng.uniform(0, 1)
        gate = ((t * rate + ph) % 1 < .32) * (np.sin(2 * np.pi * 38 * t) > 0)
        s = np.sin(2 * np.pi * f * t) * gate * rng.uniform(.4, 1)
        y[:, 0] += s * (1 - pan); y[:, 1] += s * pan
    hum = rng.standard_normal((n, 2)).astype(np.float32)
    for _ in range(3): hum = np.cumsum(hum, 0) * .02; hum -= hum.mean(0)
    hum /= np.abs(hum).max() + 1e-9
    return y / (np.abs(y).max() + 1e-9) * .5 + hum * .25

def sfx():
    """効果音（合成）：最高潮の入りの衝撃音、連結の金属音、eVTOL の接近と通過（ドップラー）。"""
    rng = np.random.default_rng(3)
    def boom(at, g):
        n = int(2.5 * RATE); t = np.arange(n) / RATE
        y = (np.sin(2 * np.pi * (48 - 14 * t) * t) * np.exp(-t * 2.2) + rng.standard_normal(n) * np.exp(-t * 18) * .3)
        put(np.stack([y, y], 1).astype(np.float32), at, g)
    def clunk(at, g):
        n = int(.9 * RATE); t = np.arange(n) / RATE
        y = sum(np.sin(2 * np.pi * f * t) * np.exp(-t * d) for f, d in [(180, 9), (410, 14), (1230, 22), (2710, 30)])
        y += rng.standard_normal(n) * np.exp(-t * 40) * .6
        put(np.stack([y, y * .9], 1).astype(np.float32), at, g)
    def flyby(peak_at, g, dur=7.0):
        n = int(dur * RATE); t = np.arange(n) / RATE - (dur - 1.2)    # 0 で通過
        noise = rng.standard_normal((n, 2)).astype(np.float32)
        for _ in range(2): noise = np.cumsum(noise, 0) * .08; noise -= noise.mean(0)
        amp = 1 / (1 + (t / .55) ** 2); f0 = 95 * (1 + .18 * np.tanh(-t * 2))    # 近づくと高く、過ぎると低く
        hum = np.sin(2 * np.pi * np.cumsum(f0) / RATE)[:, None] * np.ones((1, 2)) * .6
        pan = np.clip(.5 + .35 * np.tanh(t * 2), 0, 1)
        y = (noise / (np.abs(noise).max() + 1e-9) + hum) * amp[:, None]
        y[:, 0] *= (1 - pan) * 2; y[:, 1] *= pan * 2
        put(y.astype(np.float32), peak_at - (dur - 1.2), g, .5, 1.2)
    def servo(at, dur, g):   # 昇降脚の作動音
        n = int(dur * RATE); t = np.arange(n) / RATE
        y = np.sin(2 * np.pi * (320 + 180 * np.sin(np.pi * t / dur)) * t) * .5 + np.sin(2 * np.pi * 960 * t) * .15
        put(np.stack([y, y], 1).astype(np.float32), at, g, .08, .12)
    def whoosh(at, dur, g):
        n = int(dur * RATE); t = np.arange(n) / RATE
        noise = rng.standard_normal((n, 2)).astype(np.float32)
        for _ in range(2): noise = np.cumsum(noise, 0) * .1; noise -= noise.mean(0)
        y = noise / (np.abs(noise).max() + 1e-9) * np.sin(np.pi * t / dur)[:, None]
        put(y, at, g, .1, .3)
    # 店舗の入れ替え：進入→脚の伸長→車台が抜ける→着地の衝撃→接合→出発
    boom(SWAP0 - .05, .28); whoosh(SWAP0 + .3, 4.5, .12)
    servo(SWAP0 + 3.0, 1.8, .05); servo(SWAP0 + 6.2, 1.6, .05)
    boom(SWAP_LAND, .32); clunk(SWAP0 + 15.0, .22); servo(SWAP0 + 16.0, 1.4, .05); whoosh(SWAP0 + 19.0, 5.5, .14)
    boom(CLIMAX - .05, .35); clunk(COUPLE_AT, .25); flyby(FLYBY_AT, .30)

def build(music):
    fel, dis, cli = music['felicity'], music['discovery'], music['climax']
    put(decode(fel, 16, 109), 0, .10 / rms(decode(fel, 16, 109)), .8, 4)                 # 段階1：明るい日常
    # 段階2：未来へ。入れ替えの場面（26秒）に Discovery の最も力強い区間を当て、その盛り上がりが着地に来るようにする
    L = duration(dis); need = S3 + 4 - (S2 - 2)
    whole = decode(dis); env = np.sqrt(np.convolve((whole ** 2).mean(1), np.ones(RATE) / RATE, 'valid')[::RATE // 4] + 1e-9)
    best, start = -1, 0.0
    for k in range(0, max(1, len(env) - 26 * 4)):
        if k / 4 - (SWAP0 - (S2 - 2)) + need > L: break
        sc = env[k + 10 * 4:k + 26 * 4].mean() + (env[k + 13 * 4:k + 15 * 4].mean() - env[k + 9 * 4:k + 12 * 4].mean())
        if sc > best: best, start = sc, k / 4
    src0 = max(0.0, start - (SWAP0 - (S2 - 2)))
    d = decode(dis, src0, need)
    if len(d) < need * RATE: d = np.concatenate([d, decode(dis, 0, need - len(d) / RATE)])
    put(d, S2 - 2, .115 / rms(d), 3, 4)
    print('Discovery の配置：曲の', round(start, 1), '秒を入れ替え場面の始まりへ')
    peak = music.get('peak')
    if peak:   # 段階3の前半は climax 曲、場面16からは最高潮用の別の曲で、終わりの和音を場面18の終わりへ
        c = decode(cli, 60, CLIMAX + 2 - (S3 - 2)); put(c, S3 - 2, .14 / rms(c), 4, 2)   # Age of Wonder の盛り上がり始める区間
        L = duration(peak); seg = PEAK_END + 3 - (CLIMAX - .5)
        q = decode(peak, max(0, L - seg), seg); put(q, CLIMAX - .5, .17 / rms(q), .5, 0)
    else:
        L = duration(cli); seg = PEAK_END + 3 - (S3 - 2)
        c = decode(cli, max(0, L - seg), seg); put(c, S3 - 2, .15 / rms(c), 4, 0)          # 段階3：曲の終わりの和音を場面18の終わりへ
    intro = decode(fel, 0, 16); put(intro, PEAK_END - .5, .055 / rms(intro), 2, 4)     # 結び：朝の曲を静かに戻す
    amb = ROOT / 'ambience'
    for name, windows, g in [('birds', [(0, 70), (90, 106)], .022), ('children', [(15, 45)], .03)]:
        hits = glob.glob(str(amb / f'{name}*'))
        if hits:
            x = decode(hits[0], 0, None, 'highpass=f=120')
            for a, b in windows: put(np.resize(x, (int((b - a) * RATE), 2)), a, g / rms(x), 1.5, 1.5)
    night = crickets(TOTAL - PEAK_END + 1); put(night, PEAK_END - 1, .018 / rms(night), 3, 5)

def build_fallback():
    """曲が届かない時：v7 の音（Felicity・Where Stars Fall・Born Of The Sky と環境音）を下敷きに、結びだけ静かにする。"""
    v7 = ROOT / 'v7_ja.mp4'
    head = decode(v7, 0, 15); put(head, 0, 1.0, 0, 2)          # 冒頭15秒は v7 の始まりを使う
    x = decode(v7, 0, 45); put(x, 15, 1.0, 2, 2)              # 学童・コミュニティまで
    y = decode(v7, 30, 15); put(y, 60, 1.0, 2, 2)             # 走行場面（追加分）
    z = decode(v7, 45, PEAK_END - 75 + 3); put(z, 75, 1.0, 2, 4)
    calm = decode(v7, 2, 16); put(calm, PEAK_END - .5, .5, 2, 4)
    night = crickets(TOTAL - PEAK_END + 1); put(night, PEAK_END - 1, .018 / rms(night), 3, 5)

if __name__ == '__main__':
    files = {k: (glob.glob(str(ROOT / 'music' / f'*{p}*')) or [None])[0] for k, p in
             [('felicity', 'elicity'), ('discovery', 'iscovery'), ('climax', sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else 'ge')]}
    files['peak'] = (glob.glob(str(ROOT / 'music' / '*peak*')) or [None])[0]
    if '--fallback' in sys.argv or not all(files[k] for k in ('felicity', 'discovery', 'climax')):
        print('曲が揃っていないため v7 の音を下敷きにする', files); build_fallback()
    else:
        build(files)
    sfx()
    # 最後の4秒で無音へ
    n = len(out); tail = int(4 * RATE); out[n - tail:] *= np.linspace(1, 0, tail)[:, None] ** 2
    peak = float(np.abs(out).max()); out *= min(1, .89 / peak)
    with wave.open(str(ROOT / 'score_v8.wav'), 'wb') as f:
        f.setnchannels(2); f.setsampwidth(2); f.setframerate(RATE); f.writeframes((out * 32767).astype('<i2').tobytes())
    print('peak', peak, 'rms', rms(out))
