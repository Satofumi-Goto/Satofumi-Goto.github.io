# Mobility World v8

5分11秒・1920×1080・60fps。日本語版／英語版を1回の描画から同時に書き出す。

## v7 からの変更
- 画風をケーパビリティ資料（Business_Development_Capabilities）と同じ写実・高密度のイラストに全面刷新。絵は ChatGPT 作画（`art/`）。
- 構成（場面の順・字幕）は v7 を維持し、次を追加・変更：
  - 冒頭に「緑に囲まれた敷地へ、店舗を届ける」（独立操舵IWMで真横に走る場面）。
  - 「移動の時間も、集いの時間に」（HTSドライブトレーンの酔わないクルマ）。
  - 駐車場は全てショッピングモール（大型店）の駐車場。自家用車は満車時の半分近く。空き区画にコンテナ店舗を据え、人が押し寄せる。
  - 店舗とFC車台は基本同寸。営業中の店舗は地面設置、載せ替え中だけ脚で上げる。
  - 夜の整備は常設の整備庫ではなく、夜間だけ来る整備コンテナ。
  - 車両は車体の向きどおりに前進（横滑りしない）。IWMの場面だけ真横移動。
  - 植栽・駐車車両に重ならない配置を自動探索（`keepout.py`・`place_rows.py`）、手前の植栽・車は部品の上に重なる。
  - 後半はカメラの寄り・引き・追従、カイト式ミルのアップ、動的編成（連結→車内移動→分裂）と eVTOL の接近を山場に。
- 音楽（Scott Buckley, CC-BY 4.0）：Felicity → Discovery → Age of Wonder → Victor Lux → 静かな結び（Felicity 冒頭＋夜の虫の声）。効果音は合成。

## 書き出し
1. `music/` に Felicity・Discovery・Age of Wonder（`age_of_wonder.mp3`）・Victor Lux（`peak_victor_lux.mp3`）の MP3 を置く（各曲ページから取得）。
2. `python3 audio_v8.py` → `score_v8.wav`
3. `python3 film_v8.py --tag=full` → `out/full-ja.mp4`・`out/full-en.mp4`（`--stills` で確認用静止画、`--range=a:b` で区間）
4. 音を結合し、HLS（fMP4・10秒区切り）にする。

必要：Python 3（Pillow・numpy・scipy）、ffmpeg、Noto Sans CJK。
