import type { MiddlewareHandler } from 'hono';
import { isLoopbackHostname } from './canonical-host.js';
import { fail, type ApiEnv } from './http.js';

/**
 * 全 /api/* に掛ける入口の検査(メソッド・送信元)。ルートごとに付けると新しいルートで付け忘れる
 * ため、index.ts が '/api/*' に一括で登録する(漏れていないことは routes.test.ts が固定する)。
 */

/** 状態を変え得るメソッド。GET/HEAD/OPTIONS は副作用を持たせない前提(REQUIREMENTS §16.3)。 */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * ブラウザがクロスサイトから送ってきた要求か。
 *
 * なぜ要るか(多層防御): POST /api/chat は OpenAI の課金を伴い、POST /api/checklists は世帯属性を
 * 受け取る。Content-Type: application/json の必須化(http.ts)でプリフライトが必要になり、
 * CORS を許可していないので通常は届かないが、それはブラウザの CORS 実装と「単純リクエストに
 * ならない」ことに依存した間接的な防御で、将来ヘッダの扱いが変わると黙って崩れる。
 * ブラウザ自身が付ける送信元(Sec-Fetch-Site / Origin)をサーバー側で直接確かめる。
 *
 * 判断:
 *  - Sec-Fetch-Site があり same-origin / none 以外(cross-site, same-site)→ 拒否。
 *    same-site も断るのは、www や将来のサブドメインに置いた別アプリから送らせないため。
 *  - Origin があり、要求先のオリジンと完全一致しない → 拒否("null"・scheme 違い・ポート違い・
 *    接尾辞の詐称を含む。部分一致は使わない)。
 *  - どちらも無い(curl・評価スクリプト・古いブラウザ)→ 通す。これらはブラウザの利用者を
 *    踏み台にした送信ではなく、本人が直接送る要求で、CSRF の脅威ではない(量の制御はレート制限)。
 *
 * 基準は Host ヘッダではなく要求URLのオリジン: Cloudflare は登録したホスト名でしか Worker を
 * 呼ばないので、要求URLのホストは利用者が任意に作れない。
 *
 * ローカル開発の例外: Vite(:5173)は /api を wrangler dev(:8787)へ中継するため、Origin と要求先の
 * ポートが食い違う。要求先そのものがループバックのときだけ、ループバックの Origin を同一とみなす
 * (本番の要求先がループバックになることは無いので、本番の判定は緩まない)。
 */
export function isCrossSiteRequest(url: URL, headers: Headers): boolean {
  const fetchSite = headers.get('Sec-Fetch-Site');
  if (fetchSite !== null && fetchSite !== 'same-origin' && fetchSite !== 'none') return true;

  const origin = headers.get('Origin');
  if (origin === null) return false;
  if (origin === url.origin) return false;
  if (isLoopbackHostname(url.hostname)) {
    try {
      return !isLoopbackHostname(new URL(origin).hostname);
    } catch {
      return true;
    }
  }
  return true;
}

/** 状態を変える /api/* 要求のうち、クロスサイトのものを 403 で断る。 */
export function rejectCrossSiteWrites(): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    if (
      UNSAFE_METHODS.has(c.req.method) &&
      isCrossSiteRequest(new URL(c.req.url), c.req.raw.headers)
    ) {
      // Origin の値はログに残さない(閲覧していたサイトは利用者の行動履歴そのもの)。
      return fail(
        c,
        403,
        'cross_site_request',
        'この送信は受け付けられません。スミハジメの画面を開き直してから、もう一度お試しください。',
      );
    }
    await next();
  };
}

/** Hono の app.routes の1行(必要な列だけ)。 */
export interface RouteEntry {
  readonly method: string;
  readonly path: string;
}

/** ルートのパス('/api/procedures/:id')→ 実パスに一致する正規表現(ルートの数だけしか作られない)。 */
const patternCache = new Map<string, RegExp>();
function routePattern(path: string): RegExp {
  let pattern = patternCache.get(path);
  if (!pattern) {
    const escaped = path
      .split('/')
      .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('/');
    pattern = new RegExp(`^${escaped}$`);
    patternCache.set(path, pattern);
  }
  return pattern;
}

/**
 * 実パスに対して登録済みのメソッド一覧(GET があれば HEAD も含む)。どのルートにも一致しなければ空。
 * middleware(app.use)と全メソッドの受け皿(app.all)は method が 'ALL' なので数えない。
 */
export function allowedMethodsFor(routes: readonly RouteEntry[], pathname: string): string[] {
  const methods = new Set<string>();
  for (const r of routes) {
    if (r.method === 'ALL') continue;
    if (!routePattern(r.path).test(pathname)) continue;
    methods.add(r.method);
    if (r.method === 'GET') methods.add('HEAD');
  }
  const order = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
  return [...methods].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/**
 * 登録済みの API パスへ想定外のメソッドが来たら 405 + Allow を返す。
 *
 * なぜ: 以前は GET /api/chat が本文検査(Content-Type)に先に当たって 415 を返し、GET 専用の
 * API への POST は 404 になっていた。どちらも「そのメソッドは使えない」を正しく伝えておらず、
 * 本文検査や送信元検査より前で、メソッドの段階で断るのが筋(RFC 9110 §15.5.6)。
 * ルート表は Hono 自身の登録内容(app.routes)から引くので、ルートを足せば自動で追随する。
 */
export function enforceApiMethods(routes: () => readonly RouteEntry[]): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const allowed = allowedMethodsFor(routes(), new URL(c.req.url).pathname);
    if (allowed.length > 0 && !allowed.includes(c.req.method)) {
      return fail(
        c,
        405,
        'method_not_allowed',
        'この操作には対応していません。画面を再読み込みしてから、もう一度お試しください。',
        { headers: { Allow: allowed.join(', ') } },
      );
    }
    await next();
  };
}
