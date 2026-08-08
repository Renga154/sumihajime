# ADR-011: セキュリティヘッダの二系統配置と、SPAフォールバックをWorkerへ移す

- Status: **Accepted — 2026-08-08**
- Date: 2026-08-08
- 関連: REQUIREMENTS.md §16.2(利用者への説明・非公式である旨)・§16.3(ブラウザセキュリティヘッダ)、IMPLEMENTATION_PLAN.md §13(Security / privacy plan)、CLAUDE.md 原則3(推測しない)・原則9(未対応を対応済みに見せない)、ADR-005(地理院タイル)、ADR-008(単一Worker/ミラー環境)

## Context

独立点検で、§13 で自ら約束していた次の3点が未実装だと分かった。実測(2026-08-08、本番 https://app.sumihajime.workers.dev)の結果:

| 項目                 | 実測                                                           |
| -------------------- | -------------------------------------------------------------- |
| セキュリティヘッダ   | CSP・nosniff・Referrer-Policy・X-Frame-Options いずれも**0件** |
| 未定義URL            | `/no-such-page` が **HTTP 200**(画面は日本語の404案内)         |
| robots.txt / sitemap | 存在せず。`/robots.txt` はSPAのHTMLが **200** で返る           |

未定義URLが200を返す状態(ソフト404)は、利用者には正しく見えるぶん厄介で、クローラは
存在しないURLを「正常なページ」として索引し、外形監視は壊れたリンクを検知できない。

構成上の制約は次のとおり。

- 単一Worker。`assets.run_worker_first` が `/api/*` に限定されているため、静的アセットの応答は
  **Workerのコードを一度も通らない**。Honoミドルウェアで付けたヘッダはそれらに載らない。
- 逆に `assets.not_found_handling: "single-page-application"` の間は、未定義URLにも
  Assets が index.html を 200 で返すため、**Workerはステータスを決められない**。

## Decision

### 1. ヘッダは「静的アセット= `_headers`」「Worker応答=コード」の二系統で付け、テストで一致を固定する

- 静的アセット(index.html / JS / CSS / フォント / 画像): `apps/web/public/_headers` の `/*` 規則。
- Worker が自分で作る応答(/api/\* のJSON・SPAフォールバックHTML・robots.txt・sitemap.xml):
  `apps/api/src/headers.ts` の定数。
- 二重管理のズレ(「トップだけCSPが効いていない」等)は見つけにくいので、
  `apps/api/src/headers.test.ts` が `_headers` を読んで**文字列一致**を検査する。

APIのJSONは文書用より締めて `default-src 'none'` にする(何も読み込まないため)。

CSPの各ディレクティブは推測せず**実測**で決めた。特に:

- `img-src` に `data:` が必要 — maplibre-gl.css が操作ボタンのアイコンを
  `data:image/svg+xml` で39か所埋め込んでいる(外すと `/facilities` で実際に違反が出た)。
- `worker-src 'self'` で足りる — maplibre のワーカーは同一オリジンの `/assets/` から起動する。
  クロスオリジンのときだけ maplibre は `blob:` へ退避するため、`blob:` は入れない。
- `'unsafe-inline'` / `'unsafe-eval'` は**入れない**。唯一 `eval` を踏んでいたのは Zod v4 の
  JIT機能検出(`new Function('')` の可否を try/catch で試す)だったので、CSPを緩めるのではなく
  ブラウザ側で `z.config({ jitless: true })` にして機能検出自体を起こさせない。

### 2. SPAフォールバックを Assets から Worker へ移し、未定義URLに404を返す

- `assets.not_found_handling` を `"none"` にし、`assets.binding: "ASSETS"` を追加する。
- 実ファイルの無いパスは Worker へ落ちる。Worker は既知ルートなら 200、それ以外は **404** で
  同じ index.html を返す。本文が同じなのでクライアントルーティングは無傷のまま、
  クローラと監視には正しく「無い」と伝わる。
- 404応答からは ETag / Last-Modified を落とし `Cache-Control: no-store` を付ける
  (あとで有効になったURLの404が居座らないように)。

### 3. 既知ルートの一覧は `@tmn/domain` を単一の真実にする

`SPA_ROUTES`(パス + sitemapに載せるか)を `packages/domain` に置き、

- `apps/web/src/main.tsx` はこの表から**ルータを生成**する。要素の対応は
  `Record<SpaRoutePath, …>` なので、表に足して画面を足し忘れても、画面だけ足して表に
  書き忘れても**型エラー**になる。
- `apps/api` は同じ表で 200/404 を判定し、`sitemap.xml` を生成する。

同じ理由で、地理院タイルのオリジンも `@tmn/domain` に置き、FacilityMap と CSP が同じ値を見る。

### 4. robots.txt / sitemap.xml は静的ファイルではなく Worker が返す

Sitemap 行と `<loc>` には絶対URLが要る。静的ファイルにすると本番と ADR-008 のミラー環境で
オリジンが違うぶんどちらかが必ず嘘になるため、リクエストのオリジンから組み立てる。
`run_worker_first` に両パスを明示して、「アセットが無いから偶然Workerに来る」状態に依存しない。

sitemap に載せるのは、アプリ状態なしで中身が出るページだけ(`/`, `/differences`, `/about-data`)。
自治体未選択では「先に自治体を選んでください」しか出ないページ・動的URL・旧URLは載せない。

### 5. OGP の description は「非公式サービス」と分かる文にする

共有カードは本文より先に目に入る。ここで運営主体を誤解されると、行政の公式案内だと
思い込んだまま利用されうる(REQUIREMENTS §16.2)。`og:url` は置かない — SPAで全ルートが
同じHTMLを返すため、単一の値を書くと sub-page の共有時に実際と違うURLを名乗ることになる。

## Consequences

- **良い点**: 全応答にCSPが載る。未定義URLが404になり、クローラ・外形監視が正しく動く。
  ルート追加時の追随漏れが型と単体テストで塞がれる。
- **代償**: 静的ファイルの無いパスすべてで Worker が1回起動する(従来はAssetsだけで完結)。
  既存の実ファイル(JS/CSS/フォント)は従来どおりAssetsが直接返すため、通常閲覧での増加は
  ページ遷移1回あたり最大1リクエスト。
- **代償**: ブラウザ側の Zod は JIT を使わない。検証結果は同じで、対象は高々数十件のAPI応答。
- **運用上の注意**: `_headers` と `apps/api/src/headers.ts` は必ず同時に変更する
  (ズレると `apps/api/src/headers.test.ts` が落ちる)。
- **未着手**: Strict-Transport-Security と CSP の report-to は入れていない。前者は独自ドメイン
  移行時、後者はレポート収集先を持ったときに再検討する。
