import type { MiddlewareHandler } from 'hono';
import type { ApiEnv } from './http.js';

/**
 * 公開の読み取り API をエッジ(Cloudflare の拠点)の Cache API に 5 分だけ置く。
 *
 * なぜ: これらの応答は全利用者で同じ公開データ(個人の入力を含まない)で、毎回 D1 を読み直す
 * 必要がない。人が集中したとき・機械的に叩かれたときに、D1 の読み取り回数と Worker の CPU を
 * 拠点ごとに 5 分 1 回へ抑えられる(レート制限と並ぶ、可用性側の防御)。
 *
 * トレードオフ(最大 5 分の古さ): データの公開・再監査や、定期巡回(ADR-014)が根拠の揺らぎを
 * 検知して「再確認中」に落とした結果が、拠点によっては最大 5 分遅れて見える。行政手続きの
 * 期限・持ち物は日単位でしか変わらず、巡回自体が毎時であるため、5 分の遅れは案内の正しさを
 * 実質的に損なわないと判断した。これより長くすると巡回の検知(=利用者を誤案内から守る仕組み)の
 * 効きが目に見えて遅れるので、TTL を延ばすときはこの判断を見直す。
 *
 * 置かないもの:
 *  - /api/health(監視は「今」の状態を見たい)、/api/chat と POST 全般(個人の入力を含む)。
 *  - 200 以外(エラーには requestId が入る=要求ごとの値。404 を置くと、後で公開したデータが
 *    最大 5 分見えない壊れ方にもなる)。
 *  - 独自ドメイン以外(workers.dev では Cache API が何もしない。ミラー・ローカルでは常に D1 を読む)。
 *
 * キーは要求URLそのもの(クエリ込み)。クエリを正規化してキーを作ると、キーの解釈とハンドラの
 * 解釈がずれたときに「別の検索語の結果」を返す汚染が起き得るため、URL の完全一致だけで引く。
 *
 * 要求ごとの値を共有応答に入れないこと: 置くのはハンドラが返した 200 の本文と Content-Type だけで、
 * requestId は成功応答の本文にもヘッダにも入らない(fail() のエラー応答にだけ入り、それは置かない)。
 * セキュリティヘッダは置いた後に index.ts の共通ミドルウェアが毎回付け直す。
 */

/** エッジに置く秒数。 */
export const EDGE_CACHE_TTL_SECONDS = 300;

const CACHEABLE_PATHS: readonly RegExp[] = [
  /^\/api\/municipalities$/,
  /^\/api\/stats$/,
  /^\/api\/sources$/,
  /^\/api\/ward-differences$/,
  /^\/api\/facilities$/,
  /^\/api\/waste-schedules$/,
  /^\/api\/waste-sorting$/,
  /^\/api\/procedures\/[^/]+$/,
];

export function isEdgeCacheablePath(pathname: string): boolean {
  return CACHEABLE_PATHS.some((p) => p.test(pathname));
}

/**
 * 利用者(ブラウザ)へ返す Cache-Control。ブラウザには保存させても毎回確かめさせる
 * (エッジの 5 分にブラウザの保存期間が上乗せされて、古さが倍にならないように)。
 */
const CLIENT_CACHE_CONTROL = 'no-cache';

function canonicalOriginOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function edgeCache(): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const url = new URL(c.req.url);
    const canonical = canonicalOriginOf(c.env?.CANONICAL_ORIGIN);
    if (
      c.req.method !== 'GET' ||
      !canonical ||
      url.origin !== canonical ||
      !isEdgeCacheablePath(url.pathname) ||
      typeof caches === 'undefined'
    ) {
      return next();
    }

    const cache = caches.default;
    // Cookie 等の要求ヘッダをキーに持ち込まないよう、URL だけで作った要求をキーにする。
    const key = new Request(url.toString(), { method: 'GET' });
    const hit = await cache.match(key);
    if (hit) {
      const res = new Response(hit.body, hit);
      res.headers.set('Cache-Control', CLIENT_CACHE_CONTROL);
      return res;
    }

    await next();
    if (c.res.status !== 200) return;

    const stored = new Response(c.res.clone().body, {
      status: 200,
      headers: {
        'Content-Type': c.res.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': `public, max-age=${EDGE_CACHE_TTL_SECONDS}`,
      },
    });
    // 置けなくても応答は返す(キャッシュは性能のための追加の層で、失敗を利用者に見せない)。
    const put = cache.put(key, stored).catch(() => undefined);
    try {
      c.executionCtx.waitUntil(put);
    } catch {
      // ExecutionContext の無い実行(テスト)では、応答を返す前に置き終える。
      await put;
    }
    c.res.headers.set('Cache-Control', CLIENT_CACHE_CONTROL);
  };
}
