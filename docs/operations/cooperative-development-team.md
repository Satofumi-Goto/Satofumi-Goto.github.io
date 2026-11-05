# Seneschal / Federation 協調開発チーム共通運用規約

適用日: 2026-11-05。既存の `progress-board/orchestrator-policy.json` が実行時の凍結・CI・費用・公開ゲートの正本であり、本書は協調作業規約を追加する。競合する場合は、ユーザーの最新の本番公開専任方針と安全ゲートを優先する。

## 目的と体制
既存の毎時開発オーケストレータ1枠を維持し、その調整下で同等の権限・能力を持つ協調開発担当3〜4枠を運用する。これは作業枠の定義であり、実際の並列エージェントの起動や常駐を保証しない。各案件に一時的な主担当を1名置き、他担当は調査・実装・テスト・レビュー・引継ぎを協力する。工程別の固定分業は禁止する。

## 案件の着手から完了まで
1. 最新main、Issue、PR、既存の共通進捗台帳を読み、重複・放置・競合を確認する。
2. 着手前に台帳へ案件ID、repo、主担当、協力担当、変更予定ファイル、既存PR、依存関係、開始時SHA、ロック期限を記録する。書込競合時は取得をやり直す。同一ファイルの無秩序な同時編集は禁止。
3. 既存PRを修正するか最新mainから専用ブランチで作り直すかを判断し、最小差分を実装する。main直接変更、Base44 AI指示、全文上書き、format-allは禁止。
4. 差分、依存関係、保護対象(App/Router/Provider/Google Maps)、秘密情報・認証・課金・データ削除の有無を検査する。保護対象は明示承認を待つ。
5. 必須テスト、CI、ブラウザQAを実施し、別担当のレビューを受ける。CI quota_blocked時は無意味な再実行をせず、未検証としてHOLD。draft・競合・承認不足をマージしない。
6. 条件を満たしたPRのみmainへマージし、公開前QAまで実施する。本番Publish/Deploy/DNS切替はユーザー本人のみが実施する。
7. 公開後は公開SHA、配信JS/CSSのバイト整合、環境・API接続、Map/Calendar/予約/配車、Federation親子連携、実ブラウザ操作、スクリーンショットを検証する。
8. 統合済みと案件完了を区別し、公開・実画面検証が未完了ならIssueを閉じない。証拠・変更履歴・回帰検証を台帳へ記録する。

## PR分類
- 必要・競合なし: CI・レビュー後にマージ
- 必要・競合あり: 最新mainへ必要差分を移植し再検証
- 実装済み・重複: 対応コミットと検証証拠を添えてクローズ
- 旧仕様・不要: 不採用理由を記録してクローズ

保留PRにはblocker、解除条件、次の具体的作業、主担当を必ず残す。主担当停止時はIssue、PR、ブランチ、変更ファイル、未検証項目を引継ぎ、別担当が継続する。

## 共通台帳レコードの最低項目
`case_id, repo, issue, pr, owner, helpers, base_sha, planned_files, touched_files, dependencies, lease_until, state, blocker, next_action, ci_evidence, review_evidence, merged_sha, published_sha, browser_evidence, screenshot_evidence, updated_at`

状態は `unclaimed / claimed / implementing / review / source_integrated / awaiting_owner_publish / verifying / completed / blocked` とし、`completed` は必要な公開と実画面検証まで成立した時だけ使う。台帳は既存progress-board/Issueを優先し、別の競合正本を増やさない。

## オーケストレータ
細かな承認待ちを作らず、優先順位、競合、停止引継ぎ、PR・CI・公開証拠、費用・実行回数を調整する。既存の毎時ジョブと監視を再利用し、新規の重複定期ジョブを作らない。安全ゲート・既存の7アプリ依存順・ユーザーの本番公開専任方針を守る。PR作成件数ではなく、未完了案件の減少と本番検証済み案件の増加を成果指標とする。
