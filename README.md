# 東京転入ToDo（仮称）

東京への転入者が、最低限の入力（転入先・引越し日・転入元・世帯構成・条件フラグ）から、
**公式根拠と最終確認日つきの期限順ToDoチェックリスト**を得られる MVP です。

- チェックリストの該当判定は決定論的ルールエンジン（LLM は判定に関与しない）
- 全公開タスクは承認済みソース台帳に紐付く（来歴ファースト）
- RAG は後付け可能な独立モジュール
- Cloudflare ネイティブ構成（単一 Worker + 静的アセット）

要件の唯一の基準は [`REQUIREMENTS.md`](./REQUIREMENTS.md)、実装計画は
[`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md) を参照してください。
プロジェクト固有ルールは [`CLAUDE.md`](./CLAUDE.md)、開発環境セットアップは
[`CLAUDE_CODE_SETUP.md`](./CLAUDE_CODE_SETUP.md) にあります。

## 技術スタック

- pnpm monorepo / TypeScript（strict）
- React + Vite SPA（`apps/web`）
- Hono on Cloudflare Workers（静的アセット同居の単一 Worker、`apps/api`）
- Zod / Vitest
- Prettier + ESLint（flat config, typescript-eslint）

## 前提

- Node.js **22** 以上
- pnpm **10** 以上（`corepack enable` で有効化推奨。`packageManager` にバージョン固定済み）

```sh
corepack enable
```

## セットアップ

```sh
pnpm install
```

## 主要コマンド

| コマンド                                           | 内容                                                    |
| -------------------------------------------------- | ------------------------------------------------------- |
| `pnpm format`                                      | Prettier で整形                                         |
| `pnpm format:check`                                | 整形チェック（CI）                                      |
| `pnpm lint`                                        | ESLint                                                  |
| `pnpm typecheck`                                   | 全パッケージの型チェック（再帰）                        |
| `pnpm test`                                        | 全パッケージのテスト（再帰、Vitest。E2E は除外）        |
| `pnpm test:e2e`                                    | E2E（Playwright。`pnpm --filter @tmn/e2e test` と同義） |
| `pnpm --filter web dev`                            | Web SPA のローカル開発サーバ                            |
| `pnpm --filter web build`                          | Web SPA を `apps/web/dist` へビルド                     |
| `pnpm --filter api dev`                            | API Worker のローカル起動（wrangler dev）               |
| `pnpm --filter api exec wrangler deploy --dry-run` | デプロイ構成の検証（dry-run）                           |

## E2E テスト（Playwright + axe-core + 性能計測。T-017）

ブラウザ依存のため **CI には組み込まず、ローカル/手動で実行**します（`ci.yml` では走りません）。
`tests/e2e`（ワークスペースパッケージ `@tmn/e2e`）に基盤があります。

**初回のみ** Chromium を取得します（webkit/firefox は不要）：

```bash
pnpm --filter @tmn/e2e exec playwright install chromium
```

実行：

```bash
pnpm --filter @tmn/e2e test      # = pnpm test:e2e
```

- テスト対象サーバーは **ポート 8788** の `wrangler dev`（`--local`）。8787 は使いません。
- `playwright.config.ts` の `webServer` が **「ローカル D1 シード（3 自治体）→ `web` build →
  `wrangler dev --port 8788`」** を自動実行し、テスト後に自動終了します
  （既に 8788 が起動中なら再利用します）。手動で前提を整える場合は次を実行してください：

  ```bash
  pnpm --filter @tmn/publish exec tsx src/publish.ts   # ローカル D1 に 3 自治体をシード
  pnpm --filter web build                              # SPA を apps/web/dist へ
  ```

- ビューポートは **モバイル(375×812)を主線**、デスクトップ(1280×800)は主要導線 1 本のみ。
- チャット（`/api/chat`）は **Playwright の route interception で決定論的にモック**し、
  実 OpenAI/Vectorize は叩きません。
- カバー範囲: 主要導線（免責 5 項目→世田谷選択→入力→暫定生成→期限順→詳細→根拠カード）、
  条件変更での増減、完了状態のリロード保持、未対応自治体（杉並）、RAG 正常/保留/無効時の劣化、
  自治体切替（江東の学校・保育、新宿のごみ地区）、キーボード操作スモーク、
  **axe-core による主要 5 画面の重大(critical/serious)違反 0 件**、
  `POST /api/checklists` の p95（20 回、`< 2 秒`）と DOMContentLoaded の参考計測。

HTML レポート（生成物は Git 管理外）：

```bash
pnpm --filter @tmn/e2e exec playwright show-report
```

## リポジトリ構成

```text
apps/
  web/        # React + Vite SPA
  api/        # Hono Worker（静的アセット配信同居、wrangler.jsonc）
packages/
  schemas/    # Zod スキーマ・API 契約（単一の真実）
  domain/     # エンティティ型・カテゴリ定数・自治体コード
  rules/      # 決定論的ルール評価器（純関数）+ 期限計算
  rag/        # RAG モジュール（フラグで分離）
  test-fixtures/
data/         # 取得原文参照・正規化データ・RAG 評価
scripts/      # ingest / validate / publish パイプライン
docs/         # 実装計画・ADR・データソース台帳・調査メモ
tests/e2e/    # Playwright + axe-core
```

各ディレクトリの詳細は実装計画 §7 を参照。ドメインロジック（スキーマ・ルール実装）は
後続タスク（T-002 以降）で追加します。

## 重要な原則

- まず 1 自治体の縦切りを完成させる
- チェックリスト判定を LLM に任せない
- 公式根拠と最終確認日を必須にする
- 未対応範囲を隠さない
- 個人情報を収集・ログ保存しない

## ライセンス / データ

オープンデータの帰属表示は Sources ページで実装予定。手続き HTML 本文は転載せず、
要約＋出典リンク＋最終確認日で扱います。
