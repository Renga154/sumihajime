import { BROWSER_EXTERNAL_ORIGINS } from '@tmn/domain';

/**
 * ブラウザ向けセキュリティヘッダ(REQUIREMENTS §16.3 / IMPLEMENTATION_PLAN §13)。
 *
 * ■ どこで付けるか(2系統ある理由)
 * この構成は単一Workerだが、応答の作り手は2つある。
 *   1. 静的アセット(index.html / JS / CSS / フォント / 画像)… Cloudflare の Assets が直接返す。
 *      Worker のコードを一切通らないため、ミドルウェアでは付けられない。Cloudflare 標準の
 *      `_headers`(apps/web/public/_headers)で付ける。
 *   2. Worker が自分で作る応答(/api/* のJSON、SPAフォールバックのHTML、robots.txt、sitemap.xml)
 *      … `_headers` は適用されないため、ここの定数をコード側で付ける。
 * `_headers` とこのファイルの値がズレると「トップだけCSPが効いていない」等の見つけにくい穴が
 * できるため、headers.test.ts が `_headers` を読んで文字列一致を検査する(二重管理の防止)。
 *
 * ■ CSP を機能する形にするための実測メモ(2026-08-08、本番相当ビルドで確認)
 *  - script-src 'self': Vite ビルドの出力は外部 `<script src>` のみ。インラインscriptは0件、
 *    `eval` / `new Function` も成果物に無いため 'unsafe-inline' / 'unsafe-eval' は不要。
 *  - style-src 'self': Tailwind/maplibre/@fontsource いずれも外部CSSファイル。唯一のインライン
 *    スタイル(ChecklistPageの進捗バー幅)は React が CSSOM 経由(`node.style.width = ...`)で
 *    書くため CSP の対象外。よって 'unsafe-inline' は入れない。
 *  - img-src / connect-src に地理院タイルのオリジン: 地図はタイル画像を取得する(@tmn/domain の
 *    BROWSER_EXTERNAL_ORIGINS が唯一の定義。CSPと実装のズレを防ぐ)。
 *  - img-src の `data:`: maplibre-gl.css が拡大縮小ボタン等のアイコンを data:image/svg+xml で
 *    39か所埋め込んでいる。外した状態でE2Eを回すと /facilities で img-src 違反が実際に出た。
 *    許可対象は画像だけで、script-src/style-src には data: を入れていない。
 *  - worker-src 'self': maplibre-gl v6 のワーカーは同一オリジンの /assets/ 配下から起動する
 *    (FacilityMap が Vite の `?worker&url` で出力したURLを setWorkerUrl で注入している)。
 *    ワーカーURLがクロスオリジンのときだけ maplibre は blob: へ退避するため、blob: は不要。
 *  - upgrade-insecure-requests は入れない: 参照先は同一オリジンの相対URLと https の地理院タイル
 *    だけで http の参照が存在せず、実効性が無い一方でローカル(http://localhost)の検証を
 *    壊しうる。
 */

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  // プラグイン埋め込み・フォーム送信先の乗っ取りを塞ぐ(このアプリはどちらも使わない)。
  "object-src 'none'",
  "form-action 'self'",
  // なぜ frame-ancestors 'none': 非公式サービスを「行政の公式ページ」に見える枠へ埋め込まれると、
  // 利用者が運営主体を誤認する(REQUIREMENTS §16.2)。クリックジャッキング対策と同時に、
  // 第三者サイトへの取り込み自体を禁じる。X-Frame-Options: DENY は同じ意図の後方互換。
  "frame-ancestors 'none'",
  "script-src 'self'",
  "style-src 'self'",
  `img-src 'self' data: ${BROWSER_EXTERNAL_ORIGINS.join(' ')}`,
  "font-src 'self'",
  `connect-src 'self' ${BROWSER_EXTERNAL_ORIGINS.join(' ')}`,
  "worker-src 'self'",
  "manifest-src 'self'",
].join('; ');

/**
 * 使っていないブラウザ機能を明示的に閉じる。特に geolocation は FR-013 の「現在地を取得しない/
 * 距離計算をしない」という設計上の約束をブラウザ側でも強制する意味がある。
 * Chrome が認識しないトークンを書くとコンソールにエラーが出るため、標準機能名のみへ絞る。
 */
const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'camera=()',
  'display-capture=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'usb=()',
].join(', ');

/**
 * なぜ strict-origin-when-cross-origin: 区の公式サイトなど外部リンクへ遷移するとき、
 * パスやクエリ(選択した自治体コード・地区IDなど利用者の選択)を送らずオリジンだけにする。
 * 同一オリジン内では完全なRefererを保ち、アプリ内の導線調査を妨げない。
 */
const REFERRER_POLICY = 'strict-origin-when-cross-origin';

/** HTML文書とその副資源(静的アセット・SPAフォールバック)へ付けるヘッダ。 */
export const DOCUMENT_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': REFERRER_POLICY,
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': PERMISSIONS_POLICY,
};

/**
 * /api/* のJSON応答へ付けるヘッダ。
 *
 * なぜ文書用と分けるのか: APIの応答は何も読み込まないので `default-src 'none'` まで締められる。
 * ブラウザで直接URLを開かれた場合でも、万一 content-type が誤って解釈されてもスクリプトが
 * 走らない。逆に Permissions-Policy は「文書が使える機能」の宣言なのでJSONには意味がなく、
 * 付けない(意味のないヘッダを増やすと、どれが効いているのか読めなくなる)。
 */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': REFERRER_POLICY,
  'X-Frame-Options': 'DENY',
};

/**
 * Worker が自前で組み立てた文書系の応答へ、静的アセットと同じヘッダを付ける。
 * 応答本体はそのままに、ヘッダだけを足した新しい Response を返す
 * (subrequest 由来の Response はヘッダが変更不可のことがあるため作り直す)。
 */
export function withDocumentSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(DOCUMENT_SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
