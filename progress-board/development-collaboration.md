# Seneschal／Federation 開発協調チーム 共通指示書

> 2026-11-05 提示方針。GitHub `main` が実装正本。既存の開発オーケストレータの下で協調し、監視ジョブを増殖させない。

## 目的と構成

Seneschal、Federation、Simulator、独立コンソール群の未完了案件を、調査から公開後検証まで責任を持って減らす。成果はPR作成数ではなく**本番で検証済みの案件完了数**で評価する。

- 開発オーケストレータ：1。優先順位、競合、停止案件の引継ぎ、品質、費用を調整する。細かな作業指示や一般案件の承認待ちを作らない。
- 対等な協調開発担当：3〜4枠。**全員が調査・実装・テスト・PR・レビュー・マージ条件確認・公開前QAを担当できる**。工程別の固定専任を設けない。
- 各案件に一時的な主担当を1枠だけ設定する。協力担当は検証・レビュー・追加修正を支援し、停止時は引き継ぐ。
- 役割枠の設定はAI実行環境の起動や実在する担当者の参加を証明しない。実際の担当・作業・証跡はGitHub Issue／PRで別途確認する。
- 新しい定期ジョブは作らず、既存オーケストレータの監視・費用ゲートを継続利用する。

## 着手前の調整・共通台帳

既存の `progress-board/status.json` と各repoのIssue／PRを共通台帳として使う。共通台帳の別系統を新設せず、**案件ID・主担当・協力担当・変更予定ファイル・既存PR・状態・依存条件・証跡**をIssue／PRに記録する。

着手時は以下を確認する。

1. 対象リポジトリの最新 `main` と、現行 `progress-board/orchestrator-policy.json` の凍結・CI枠・公開ゲート。
2. 未完了Issue、既存PR、関連コミット、他担当の作業範囲と変更予定ファイル。
3. 既存PRで続けられるか、新しい `main` からの再作成が安全か。既存修正を無条件に重複して作らない。
4. Issueに次の形式で着手宣言し、他担当の宣言と競合していないことを再確認する。

```text
[WORK CLAIM]
Issue: owner/repo#number
主担当: 協調開発枠 / 実際の実行者
協力: 実際の実行者（未確定なら空欄）
base main SHA:
対象ファイル:
既存PR:
状態: investigating | implementing | reviewing | blocked | source_merged | publication_pending | verifying | done
ブロック条件 / 次の一手:
更新時刻（UTC）:
```

同じファイルへの無秩序な並行編集は禁止。競合の可能性があれば、主担当が変更範囲を再配分し、双方が差分を確認してから作業する。GitHub Issueコメントは厳密な排他ロックではないため、コミットとPRの直前にも最新main・既存PR・宣言を再確認する。

## 各担当が最後まで行う12ステップ

1. `main`／Issue／PRを調査する。
2. 未完了・重複・競合・放置PRを棚卸しする。
3. 担当間の変更予定ファイルを照合する。
4. 共通台帳で案件取得を宣言する。
5. 最新 `main` から `feature/*` ブランチを作る（汚れたworkspaceは使わない）。
6. 狭い差分で実装する。全文上書きやformat-allは禁止。
7. 対象テスト・必要なCI・実ブラウザQAを実施する。
8. PRを作成し、別担当のレビューを受ける。
9. 保護条件・承認・必要CIを満たす場合のみmainへ統合する。
10. 公開前QAを完成させ、**ユーザー本人によるPublish／Deploy／DNS切替後**に実環境QAを行う。
11. 旧PRを「必要で競合なし／必要で競合あり／重複済み／旧仕様不要」に分け、根拠付きでマージ・差分移植・クローズする。
12. GitHub Issueと台帳に完了／未完了・スクリーンショット・公開SHA・検証証跡を記録する。

作業停止・交代時は `Issue / PR / branch / base SHA / changed files / tested / untested / next step / blockers / evidence` を引継ぎ欄に記録し、別担当が途中から再現可能にする。

## PR分類とゲート

| 分類 | 処理 |
| --- | --- |
| 必要・競合なし | CIと別担当レビュー後にマージ |
| 必要・競合あり | 最新mainに必要差分を移植し再検証 |
| 既に実装済み・重複 | 既存mainコミットと機能検証の証拠を示してクローズ |
| 旧仕様・不要 | 現仕様との不整合や採用不要理由を記録してクローズ |

保留PRはブロック理由・解除条件・次の具体的行動を残す。draft、承認不足、required CI失敗／不明、競合、保護対象の未承認変更を無理にマージしない。現在のGitHub Actions quota gateは既存ポリシーを優先し、無証拠で再試行・新規ジョブ起動しない。

## 永久保護と単一正本

- `main`へ直接コミットしない。Base44 AIへの開発指示、全文上書き、同一修正のBase44／独立版二重実装は禁止。
- App、Router、Provider、Google Mapsなどの保護対象はRoot Cause・影響・差分・rollback手順と明示承認なく変更しない。
- Secrets・認証・課金・データ削除・本番設定は無断変更しない。公開・DNS・本番ワークフロー実行はユーザー本人のみ。
- 保護Map経路：`functions/getGoogleMapsApiKey.js`、`loadGoogleMaps()`待機、`precomputeMapData()`再試行、Map表示の実画面を守る。
- 他担当のPRがmainへ入ったら、base SHA・競合ファイル・差分とQAを再点検する。

## 公開と案件完了

開発担当はPR・CI・マージ・公開前QAまで。ユーザー本人の公開後、担当は最新main／公開SHA／配信JS・CSS／実API・認証／Map・Calendar・予約・配車／Federation親子連携／ブラウザ操作とスクリーンショットを検証する。

変更後はChanged Files、GitHub同期、Preview再生成、対象スクリーンショット、画面上の変更箇所の説明を揃える。

**判定を分ける：** `source_merged` はコード統合済み。 `publication_pending` はユーザー公開待ち。 `done` は必須CI・レビュー、旧PR整理、公開、同一SHAと実E2E、証跡、回帰なしを満たした場合に限る。未公開ならIssueは閉じない。

## オーケストレータの最小運用

毎回先に現行 `progress-board/orchestrator-policy.json` を読み、次に `progress-board/development-collaboration-policy.json` を参照する。既存 `status.json` の17行構造と最大10件のキューを壊さず、重要な進展だけ更新する。費用・凍結・CI枠・セキュリティとユーザー公開専任の厳しい条件を優先する。同じ障害の反復調査や監視ジョブ増殖を防ぐ。案件が完了した担当は競合がない次の案件を取得する。
