# 改訂ログ（各カード下の折り畳み）

- 単一データ源：`revisions/revisions.json`（本文・更新日・監視対象）。HTMLのブロックは直接編集しない。
- `node tools/revision-log/render.mjs` ：JSON→3ページへ描画（`--check` はずれの検出のみ）。
- `node tools/revision-log/update-dates.mjs` ：更新日を進める（日付は進む方向だけ。回の番号は変えない）。
- 自動実行：`.github/workflows/revision-log.yml`（監視対象のpush、毎日05:10 JST、手動）。
  - 更新日 ＝ 監視パスの最終コミット日（JST）。非公開の他リポジトリ（seneschal / federation-portal / mobility-business-lab）は、
    Actionsのシークレット `UPSTREAM_READ_TOKEN`（読み取り専用）がある場合だけ参照する。
  - 手動実行の `touch` で任意のカードを今日にでき、`new_revision` を true にしたときだけ第N+1回に繰り上がる。

## 本文を書くかどうかの判定
- 更新日は変更があれば自動で進む。本文は `revisions/IMPACT-RULES.md` の採点基準で、既存項目に対するインパクトがあるときだけ書く。
- 判定は毎朝の定期タスクが行い、結果を `revisions/decisions.jsonl` に残す（書かなかった判断も記録）。

## 未公開下書き

- 下書きも正本 `revisions/revisions.json` の既存カード内 `drafts` に置く。別台帳やカードは作らない。`drafts` は今回追加した編集用の規約で、描画対象ではない。renderer が読むのは各カードの公開用 `en` / `ja` 本文と日付。
- 各下書きの `ja` / `en` は現在の未公開・実装中表現。`releaseCandidate` は証拠確認後にのみ使用する候補文であり、現在の機能説明ではない。`source.observedHeadSha` は読んだソース版で、本番検証済みの版ではない。
- `promotionChecks` を満たす正確な実装・Federation API・配信SHAとQA証拠を `publicationEvidence` に記録する。空欄は未検証のまま扱う。特に音声通話は実アプリ・実providerで音声入力からAI応答・音声出力・ミュート・終了まで確認する。
- 公開へ移す際は `IMPACT-RULES.md` で評価し、日英を同時に更新する。Seneschalは既に10項目あるため、`proposedReplacement` を確認して既存の低優先項目と置換し、キャラクター選択と音声通話は独立した見出しとして保つ。実際の判断を `decisions.jsonl` に記録してから描画する。
- 下書き作成だけでは公開本文・`updated`・`reviewed_at`・改訂番号を進めない。今回の既存台帳の `skipped` は「公開への追加を保留」の意味で、下書き自体を破棄した意味ではない。
