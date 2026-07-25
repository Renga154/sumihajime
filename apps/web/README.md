# web — スミハジメ フロントエンド

React + TypeScript + Vite + Tailwind CSS v4 の SPA。`apps/api`(Cloudflare Worker)が
`dist/` を静的アセットとして配信し、`/api/*` は同じ Worker が処理する(単一 Worker 構成)。

## 画面

| ルート            | 画面                                              |
| ----------------- | ------------------------------------------------- |
| `/`               | ランディング / 自治体選択(未対応は公式リンクのみ) |
| `/wizard`         | 入力ウィザード(3ステップ。Step1のみ必須)          |
| `/checklist`      | チェックリスト(期限順セクション・進捗・完了保存)  |
| `/procedures/:id` | タスク詳細(必要書類・方法・場所・根拠カード)      |
| `/facilities`     | 窓口一覧(カテゴリ別)+ 施設地図(地理院タイル)      |
| `/waste`          | ごみ収集(地区選択式・例外日注意)                  |
| `/coverage`       | 対応状況・データの来歴(鮮度・台帳・品質レポート)  |

利用者データ(プロフィール・完了状態)は端末内の localStorage のみに保存し、サーバーへ送りません。

## 外部リクエストについて(施設地図の地理院タイル)

`/facilities` の施設地図(`components/FacilityMap.tsx`)は、背景に**国土地理院の「地理院タイル(標準地図)」**
(`https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png`)を読み込みます。これがアプリ本体以外への
唯一の外部リクエストです。

- **利用条件**: 地理院タイルはウェブアプリでのリアルタイム読込に限り「出典明示のみで申請不要」で利用でき、
  2026-07-23 に一次情報で検証しました(詳細と出典は [docs/adr/ADR-005-facility-map-gsi-tiles.md](../../docs/adr/ADR-005-facility-map-gsi-tiles.md))。
  出典「地理院タイル」を地図隅に常時表示しています。
- **プライバシー**: 送信するのは選択済み施設の座標に基づくタイル座標のみで、利用者の住所・現在地・入力内容は
  送りません(現在地取得・距離計算・ジオコーディングは行いません。FR-013)。
- **縮退**: `maplibre-gl` は動的 import(コード分割)し、地図の読込に失敗しても施設一覧は無傷で表示されます
  (プログレッシブエンハンス)。座標を持たない施設は地図に出さず、一覧で「地図未対応(座標データなし)」と
  注記します。

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
