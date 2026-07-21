# web — 東京転入ToDo フロントエンド

React + TypeScript + Vite + Tailwind CSS v4 の SPA。`apps/api`(Cloudflare Worker)が
`dist/` を静的アセットとして配信し、`/api/*` は同じ Worker が処理する(単一 Worker 構成)。

## 画面

| ルート            | 画面                                              |
| ----------------- | ------------------------------------------------- |
| `/`               | ランディング / 自治体選択(未対応は公式リンクのみ) |
| `/wizard`         | 入力ウィザード(3ステップ。Step1のみ必須)          |
| `/checklist`      | チェックリスト(期限順セクション・進捗・完了保存)  |
| `/procedures/:id` | タスク詳細(必要書類・方法・場所・根拠カード)      |
| `/facilities`     | 窓口一覧(カテゴリ別)                              |
| `/waste`          | ごみ収集(地区選択式・例外日注意)                  |
| `/coverage`       | 対応状況表・データ出典(CC BY 帰属表示)            |

利用者データ(プロフィール・完了状態)は端末内の localStorage のみに保存し、サーバーへ送りません。

## ローカル開発の起動手順

前提: リポジトリルートで `pnpm install` 済み。

1. 承認済みデータをローカル D1 へ投入(シード):

   ```sh
   pnpm --filter @tmn/publish publish:local
   ```

2. API(Worker)を起動(ポート 8787):

   ```sh
   pnpm --filter api dev   # = wrangler dev
   ```

3. 別ターミナルで Vite 開発サーバを起動(ポート 5173):

   ```sh
   pnpm --filter web dev
   ```

   `vite.config.ts` の devProxy により `/api` は `http://localhost:8787` へ転送されます。
   ブラウザで `http://localhost:5173` を開きます。

## 本番相当の確認(単一 Worker で配信)

```sh
pnpm --filter web build      # dist/ を生成
pnpm --filter api dev        # Worker が dist/ を配信し /api/* も処理
# http://localhost:8787 を開く
```

## テスト・型・整形

リポジトリルートで:

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
pnpm --filter web build
```
