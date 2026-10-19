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
