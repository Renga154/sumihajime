# ADR-008: ハッカソン提供Cloudflare環境の位置づけとURL方針

- Status: Accepted(2026-07-26)
- 決裁: ユーザー依頼(2026-07-26「(提供環境に入ったので)こちらの対応もお願いします」)を受け、方針提示のうえ実施

## Context

- 事務局からCloudflare Paidプラン相当のチームアカウント `tokyo_odh_145`(account_id `<ACCOUNT_ID>`)が提供された(利用案内: odh-tokyo2026.code4japan.org の提供環境ページ)。
- 提供条件の要点: **Paid権限は2026年9月末まで**(ファイナリストは延長あり。アカウント自体は継続)。期間終了前のバックアップ必須(R2/D1は権限停止後アクセス不可になり得る)。Workers AIの高額モデル($1/1M tokens超)使用禁止。デモURLを提供環境にする指定はない。
- 一方、本ハッカソンの **Final Stageは2026-10-17** で、Paid失効(9月末)の後にある。
- 既存の本番は個人アカウント(`<ACCOUNT_ID>`)の Worker `tokyo-move-navi` で稼働し、無料枠内に収まっている(Vectorize 約98万次元/D1数MB)。

## Decision

1. **正典(canonical)は個人アカウント側を維持する。** 審査本番(10/17)の直前に失効し得る環境を唯一のデモ基盤にしない。本作は無料枠で成立しており、個人アカウントは期限の影響を受けない。
2. **提供環境にはミラーを構築する**(wrangler env `odh`)。提供環境の活用実績とデモ冗長化のため。
   - Worker: `sumihajime`(チームアカウント)/ D1: `sumihajime`(`7f95495f-a18b-4079-9eb8-287bfe579bfe`)/ Vectorize: `sumihajime-rag`(1536次元 cosine、metadata index: municipalityCode, category を投入前作成)
   - チームアカウントのサブドメインは `tokyo-odh-145`(登録済み)。ミラーURL: `https://sumihajime.tokyo-odh-145.workers.dev`
3. **個人アカウントのサブドメインを旧名（個人のハンドル）から `sumihajime` に変更し、正典Workerを `app` に改名**(2026-07-26 ユーザー決裁: 「sumihajime」は失効リスクのない個人側に割当・Worker名はapp)。正典URLは **`https://app.sumihajime.workers.dev`**。旧サブドメインのURLは即時失効(提出資料は未確定だったため影響なし。リポジトリ内の参照は一括更新済み)。
4. 運用コマンド(publish/rag-index)は `--env`(および `--index`)透過に対応し、D1指定は環境非依存のbinding名 `DB` に統一。既定動作(個人アカウント)は不変。
5. バックアップ方針: **Gitリポジトリが唯一の原本**(正規化データ・ルール・スナップショット・migrations)。提供環境のD1/Vectorizeは `publish --remote --env odh` と `build:index --remote --env odh --index sumihajime-rag` でいつでも全再構築できるため、失効時に失うものはない。
6. 提供環境の禁止事項への適合: Workers AIは不使用(LLM/埋め込みはOpenAI自前キー)。ハッカソン成果物以外をデプロイしない。他チームリソースに触れない。

## Consequences

- デプロイは2系統になる: `pnpm --filter api deploy`(正典 `app`)/ `deploy:odh`(ミラー)。リリース時は両方更新する。
- **SecretはWorkerごとに独立**。OPENAI_API_KEY は `app`(個人)と `sumihajime`(チーム、`--env odh`)へ各自投入が必要(値の投入はユーザーのみが行う)。
- 旧Worker `tokyo-move-navi`(個人)は新URL移行完了(appのSecret投入・動作確認)後に削除する。移行中の暫定アクセス先: `https://tokyo-move-navi.sumihajime.workers.dev`。一時的に作成した個人側別名Worker `sumihajime` は正典URL決定(app)により削除済み。
- ミラーのデータ更新は正典と同じコマンドに `--env odh` を付けるだけ。更新忘れによる乖離はあり得るが、正典が常に優先(提出資料のURLは個人アカウント側)。
- 9月末にPaid権限が停止してもミラーは無料枠相当で動く可能性が高いが、保証はないため依存しない。
- チームアカウントの workers.dev サブドメインは初回のみダッシュボードでの登録が必要(wrangler v4にsubdomainコマンドなし)。
