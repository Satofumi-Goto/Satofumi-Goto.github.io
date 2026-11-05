# Seneschal／Federation 協調開発チーム共通指示書

適用範囲：Seneschal、Federation、Simulator、独立コンソールおよび関連ランタイム。最終決定：2026-11-05。対象7リポジトリ、既存オーケストレータ、および他の参加担当が共通で参照する。

## 1. 目的と責任
目的は未完了案件を減らし、実製品を完成させ品質を継続向上すること。担当は工程別の固定分業をせず、全員が調査、コード修正、テスト、PR整理、レビュー、マージ、公開前QA、公開後実画面検証まで実行可能な開発者として振る舞う。**成果物はPR数でなく案件完遂**である。案件は公開・実機検証が済むまで完了としない。

## 2. チーム構成
既存の**開発オーケストレータ1**の下に**同格の協調開発担当10枠（既存6枠＋追加4枠）**を置く。既存専門担当も必要時に参画する。恒久的な専属工程や上下関係を設けず、案件ごとに一時的な主担当1名を置き、他担当は調査・レビュー・テスト・追加修正で協力する。主担当の停止時は台帳を更新して他担当が引き継ぐ。

**重要：枠を定義することと、実際に実行可能なエージェント・権限を配備することは別。** 登録・稼働・実行証拠のない担当を「起動済み」として報告しない。オーケストレータは交通整理・品質保証・優先順位・コスト制御に徹し、担当が安全に遂行できる案件に細かな許可を要求しない。

## 3. 共通フロー（全員）
1. GitHub各repoの最新main、既存Issue/PR、CI、公開証拠、progress-board/orchestrator-policy.jsonを確認し、凍結・CI quota・費用・秘密情報・承認ゲートを先に判定する。
2. 未完了、放置、競合、重複PRを洗い出し、既存PRへの追補を新規PRより優先する。
3. 着手前に **GitHub Portfolio Issue #74（`https://github.com/Satofumi-Goto/Satofumi-Goto.github.io/issues/74`）のCLAIM/UPDATE/HANDOFF** と `progress-board/cooperative-work-ledger.json` の案件情報を確認し、主担当・協力者・対象ファイル・PR・状態をIssueコメントに記録する。各製品の元Issueを案件固有の状態・検証証拠の正本、本repo #74を横断CLAIM索引の唯一の正本とする。旧索引 #77とFederation #984は参照用とし、競合するCLAIMを新規登録しない。JSON台帳は機械可読スナップショット／スキーマとして扱い、そこへの別PRが完了するまで作業を停止しない。main直接書込を禁止する。
4. 最新mainから専用`feature/*`（既存規約の`fix/*`/`hotfix/*`も可）で最小差分を実装する。汚れた作業ツリーでbranch切替せず、変更ファイル所有を照合する。
5. 差分・依存関係・大規模削除・import欠落・保護ファイル変更を検査し、テスト・必須CI・実ブラウザQAを実施する。
6. PRを作成し**別担当**がレビューする。required CI・承認・保護条件を満たす非draftのみmainへ統合する。CI未実行、quota_blocked、承認不足を迂回しない。
7. 依存するPRや旧PRを整理する。PRは「必要・競合なし→審査後merge」「必要・競合あり→最新mainへ移植して再検証」「実装済み・重複→証拠を添えてclose」「旧仕様・不要→理由を添えてclose」の4分類とする。保留はblocker、解除条件、次の行動を残す。
8. 公開前QA、ユーザーによる本番公開後の読取専用実画面QA、証跡と履歴、回帰確認まで案件を追跡する。別担当へ交代する場合はIssue・PR・ブランチ・変更ファイル・残QAを明記する。

## 4. 競合・品質・安全
- **GitHub mainが唯一のコード正本。** main直接変更、Base44 AI指示/全文overwrite、format-all、関係ない差分、二重実装は禁止。
- 元IssueやPRには個人情報・秘密値を記録しない。引継ぎは必ず元Issueにも記録し、統括索引には参照リンクとファイル所有のみを残す。
- App、Router、Provider、Google Mapsなどの保護対象には事前の明示承認が必要。認証、秘密鍵、課金、データ削除にも承認ゲートを適用。秘密値をチャットやPRに出さない。
- 同時に同じファイルを無秩序に編集しない。主担当の対象ファイルが他のPRで変わったら差分を再確認し、必要なら再分担・再テスト。
- Google Mapsの既知復旧経路（functions直下、ロード待機と再試行、placeId→getDetails）は保護し、関連変更時は回帰テストする。Source merge＝公開完了ではない。
- 現行のrelease_freeze、CI quota、7アプリ順序・費用ゲートを優先。解除証拠のないActions再試行・不要な有料E2E・定期監視ジョブ増設禁止。

## 5. 本番公開と完了判定
**本番Publish／Deploy／DNS切替はユーザー本人のみ実行。** 開発担当はPR・CI・レビュー・merge・公開前QAまでを担当し、本番公開を代行しない。ユーザーが公開した後に公開SHA vs main、配信JS/CSS、実際のhostとAPI/DB・認証境界、Map/Calendar/予約/配車、Federation親→独立コンソール、実ブラウザ操作・スクショ、回帰を確認する。

案件の完了条件：必要差分がmain統合、必須CIと別担当レビュー合格、旧PR整理、必要な本番公開、該当機能の実画面QA、証跡・変更履歴、回帰なし。未公開／本番E2E未実施ならIssueを閉じず「source_integrated」または「awaiting_owner_publish」と明示する。URL 200やSHA一致のみで完了としない。

## 6. オーケストレーションと報告
既存の毎時開発オーケストレータを**唯一の巡回管理役**として使い、同じ監視の定期ジョブは作らない。各回、台帳差分・GitHubの最新証拠を優先して読み、案件停止・競合・主担当不在の引継ぎ、優先順位を調整する。担当が次の案件を取得する前に台帳の占有状態と影響ファイルを確認する。活動がなければ同じログ・サイト・有料APIの再検査を繰り返さない。ユーザーへの通知は重要な障害、必要な承認、公開準備/完了、実E2E達成などの具体的な変化のみ。

## 7. 共通台帳の最低記録項目
統括台帳：`https://github.com/Satofumi-Goto/Satofumi-Goto.github.io/issues/74`。CLAIMは `agent`（認証済み担当識別子）、`repo`、`issue`、`files`、`base SHA`、`reviewer` を含む。**代理での架空のCLAIMは禁止**。実稼働担当は人数を仮定せず各担当の固有CLAIMと実操作ログで確認する。
各案件に一意な`id`、`repo`、`issue_urls`、`pr_urls`、`primary_owner`、`collaborators`、`files`、`status`、`blocker`、`next_action`、`ci`、`review`、`source_sha`、`published_sha`、`browser_qa`、`evidence`、`handoff`を記録する。稼働者がいない場合は`primary_owner: null`とし、根拠なく割当済みとしない。既存の`progress-board/status.json`（17 owner rows等）はそのまま保持し、作業台帳と公開判定を混同しない。
