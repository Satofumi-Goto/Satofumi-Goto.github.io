# Seneschal／Federation 協調開発チーム共通運用ルール

制定日: 2026-11-05（ユーザー指示）
状態: **運用提案／mainへのPR統合後にリポジトリ正本化**。既存の [orchestrator-policy.json](./orchestrator-policy.json) と [status.json](./status.json) を置き換えず、矛盾時は現行ポリシーのfreeze・CI・権限ゲートを優先する。

## 目的と構成
目的はPRを増やすことではなく、Seneschal／Federation／Simulator／独立コンソールの未完了案件を、実機確認まで減らし切ること。

- 既存の**毎時の開発オーケストレータ1つ**を唯一の周期実行基盤とする。監視する別の定期ジョブを作らない。
- 協調開発担当の**作業枠を3つ（必要時4つ）**設ける。これは作業台帳上のロールであり、作業者／独立エージェントが実際に起動・接続済みであるという意味ではない。
- 各担当は機能・工程の専属を持たず、調査→実装→検証→PR整理→公開前QA→ユーザー公開後の実画面検証まで遂行可能とする。
- 案件ごとに主担当1名を宣言。協力者はレビュー、原因調査、QA、差分提案を支援し、同一ファイルの同時無秩序編集を避ける。
- 1サイクル1リポジトリの主たる変更は原則1件（既存policyの `cycle.max_primary_change_per_repo=1`）とし、全体同時実行による衝突を避ける。
- Agentを実際に並列起動できない場合、担当A/B/C(/D)は「未割当／準備中」と明記し、架空の作業・承認・レビューを記録しない。

## 着手・共通台帳プロトコル
- 最初に現行 [orchestrator-policy.json](./orchestrator-policy.json) の `release_freeze.enabled`、`ci.quota_recovery`、deployment/auto_mergeゲートを読み、[status.json](./status.json) の**17 owner rows**および action_queue を参照する。両者はその用途の正本として維持する。
- 対象リポジトリの最新 `main`、既存Issue、open/draft/blocked PR、差分・CI・依存関係、他担当の着手宣言を取得する。
- **共通の着手記録は対象リポジトリの既存の正本Issue**を使用し、既存Issueがない場合のみ必要に応じて作成する。横断状況のみstatus.jsonに反映し、全担当が同時にこのファイルを書かない。
- Issue上の着手宣言テンプレート:
  ```text
  WORK-CLAIM | <担当ID> | <対象repo/Issue> | <開始時刻JST>
  lead: <実行可能な担当者/agent識別子> / helpers: <識別子 or なし>
  base-main: <full SHA>
  existing-pr: <番号/なし>
  intended-files: <相対パスの列挙>
  scope: <Root Cause/最小目的>
  gates: <CI/レビュー/保護ファイル/費用/権限>
  state: claimed | blocked | review | merged | awaiting-owner-publish | verified | handoff
  next: <具体的な一手>
  ```
- 着手宣言が重複・矛盾した場合は**停止して主担当とファイル所有を調整**。任意の時限ロックによる無条件の所有権奪取は禁止。主担当が停止した場合は、Issue/PR/ブランチ/差分/未完了QA/次の操作をHANDOFFとして引継ぎ、再宣言する。
- 既存PRがある案件に新規PRを無条件で増やさない。既存PR継続と最新mainでの作り直しを比較し、選択理由をIssueへ記録する。

## 各担当の共通作業フロー
1. 最新main・Issue・PRと、共通台帳・ファイル衝突を確認する。
2. 未完了、重複、放置、旧仕様、競合を分類する。優先案件を選び、WORK-CLAIMを残す。
3. クリーンなワークスペースを確認し、mainから専用 `feature/*` 等のブランチを切る。**mainへ直接commitしない**。
4. Root Cause・影響範囲・Revert条件を記載し、必要最小差分で実装する。関係ないformat-all/大量rewriteを禁止する。
5. 静的テスト、必要CI、実ブラウザQA、回帰テストを実施する。CIが `quota_blocked` ならActionsの無意味な再試行や成功の偽装をしない。
6. PRを作るか既存PRを更新し、変更ファイル・diff・テスト証拠・依存と公開影響を記録する。
7. **実際の別担当／権限を持つ別レビュアー**によるレビューを受ける。自分のコメントを別担当承認と偽らない。
8. `non_draft` / required CI success / approvals / mergeable / protection / current main 差分の必須ゲートが揃った場合のみmain統合する。CI実行不可や承認不足ならHOLD。
9. 旧PRは「必要・競合なし→確認し統合」「必要・競合あり→最新mainへ差分移植」「重複→証拠付きクローズ」「旧仕様→理由付きクローズ」に分類し、無断破棄しない。
10. 公開前QAと公開待ちの受入チェックを整理し、**本番Publish・Deploy・DNS切替はユーザー本人のみ**が行う。担当は公開操作を開始しない。
11. ユーザーが公開した後、公開SHA・実配信JS/CSS・API・認証・DB・Map・Calendar・予約・配車・Federation親子・実ブラウザ操作・スクリーンショットを案件に応じ検証する。
12. 検証証拠とChanged Files、PR、SHA、スクリーンショットを記録。公開・実画面・回帰のいずれか未完なら「source integrated」「awaiting-owner-publish」「blocked」「qa-unverified」などとし、**doneにしない**。

## PR状態分類と停止規則
| 状態 | 次の操作 |
| --- | --- |
| 必要・競合なし | 必須CIとレビュー後にマージ |
| 必要・競合あり | mainとの差分を調べ最小差分を再適用、再レビュー |
| 実装済み・重複 | mainとQAの証拠を付けて旧PRを閉じる |
| 旧仕様・不要 | 採用不要理由を明記して閉じる |
| draft/CI不可/承認不足/本番未公開 | BLOCKEDまたはHOLD、理由と解除条件・担当を明記 |

## 保護領域／本番安全
- GitHub mainが唯一の**コード**正本。Base44 AIへの開発指示、Base44全文上書き、二環境への同じ修正の二重実装は禁止。
- App/Router/Provider/共通UI/Google Maps、特に `functions/getGoogleMapsApiKey.js` と `src/lib/map/precomputeMapData.js` / `src/pages/MapPage.jsx` は保護対象。承認なしに変更せず、Google Mapsを先読み済みとみなさず、起動時ロード待ちと再試行を壊さない。
- データ削除、シークレット、認証、課金、ゲートウェイ切替、保護対象、本番公開に関する明示承認条件は越えない。
- 外部APIが有料／未承認の場合に調査目的で実行しない。ゼロ件を「成功」とみなさない。
- 新しい監視ジョブ、不要なActions再実行、重複PR、公開マーカーの増殖を禁止。
- 各アプリの公開依存関係は Activity→Fleet→Service Hub→Urban→Simulator→Seneschal→Federation。GitHub Actionsのソース品質CIと本番公開操作を混同しない。

## 完了の証拠
記録には `repo` / `issue` / `main_sha` / `pr` / `changed_files` / `required_ci` / `independent_review` / `duplicate_pr_cleanup` / `deployment_owner` / `published_sha` / `asset_hashes` / `browser_qa` / `screenshots` / `regression` / `remaining_blockers` / `next_action` を含める。

- **source integrated** = レビュー・CI合格のコードがmainへ統合済み。
- **awaiting-owner-publish** = main統合済み、本番公開操作をユーザー本人が実施する段階。
- **published-awaiting-qa** = 公開の事実は確認できるが、実操作QAが未完了。
- **done** = 既存旧PR整理、公開SHA/JS/CSS整合、API・画面・回帰テスト、写真等の実証跡、必要認証付きE2Eすべて満たす。
- **blocked** = CI枠、認証、権限、保護対象の承認、実環境不足等、具体的な阻害要因を記録。

## 最終原則
**全員が同じ仕事を完遂可能。案件ごとに協力し、競合せず、PR作成を成果と勘違いしない。** オーケストレータは監督者ではなく、着手調整・品質・費用・公開判定の調停役とする。
