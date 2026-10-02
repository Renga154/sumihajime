import type { MiddlewareHandler } from 'hono';
import { rateLimitKeyForIp } from '@tmn/rag';
import { fail, type ApiEnv } from './http.js';

/**
 * Workers Rate Limiting バインディング(wrangler.jsonc の ratelimits)による /api/* の流量制限。
 *
 * なぜ既存の制限に重ねるのか:
 *  - chat.ts の in-memory トークンバケットは isolate ごとにしか数えられない(同じ利用者でも
 *    別の isolate に振り分けられれば別勘定)。バインディングは Cloudflare の拠点(colo)単位で
 *    共有されるので、短時間の連打をより確実に止められる。
 *  - D1 の1日上限(CHAT_DAILY_LIMIT)は全体の総量を守るもので、1人が枠を食い尽くすのは止めない。
 *  - チャット以外の読み取り API には、これまで流量の制限が何も無かった(D1 の読み取り・CPU を
 *    無制限に消費させられた)。
 * 上限値と期間は wrangler.jsonc 側(バインディングの設定)にある。コードは結果を見るだけ。
 *
 * バインディングが無い環境(単体テスト・ローカル)では何もしない。バインディング呼び出し自体が
 * 失敗したときも通す(fail-open): これは追加の防御で、ここで閉じると Cloudflare 側の一時障害が
 * そのまま全面停止になる。チャットの費用は in-memory 制限と D1 の1日上限が別に守っている。
 *
 * IP はキーとしてだけ使い、ログ・応答には出さない(原則7)。
 */

/** バインディングの期間(秒)。429 の Retry-After にそのまま使う(wrangler.jsonc の period と揃える)。 */
export const RATE_LIMIT_PERIOD_SECONDS = 60;

/** 流量の制限を掛けないパス。外形監視が数十秒おきに叩くため(止めると監視が誤報する)。 */
const EXEMPT_PATHS = new Set(['/api/health']);

/** ループバック(127.0.0.0/8・::1・IPv4射影の ::ffff:127.x)か。 */
function isLoopback(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  return v === '::1' || /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v);
}

async function allowed(limiter: RateLimit | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch {
    return true;
  }
}

export function apiRateLimit(): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    if (EXEMPT_PATHS.has(pathname)) return next();

    // CF-Connecting-IP は Cloudflare の入口が必ず付ける(利用者が消したり偽ったりはできない)。
    // 本番で無い・ループバックになることはない。そうなるのはローカル(wrangler dev は自分の
    // アドレスを入れる)と単体テストだけで、数えると並列の E2E が自分自身を 429 にしてしまう。
    const ip = c.req.header('CF-Connecting-IP');
    if (!ip || isLoopback(ip)) return next();
    const key = rateLimitKeyForIp(ip);
    const isChat = pathname === '/api/chat' && c.req.method === 'POST';
    // チャットは費用を伴うので専用の厳しい枠だけで数え、読み取り用の枠は消費させない
    // (チャットを数回使っただけで画面の読み込みが 429 にならないように)。
    const limiter = isChat ? c.env?.CHAT_RATE_LIMITER : c.env?.API_RATE_LIMITER;
    if (await allowed(limiter, key)) return next();

    return fail(
      c,
      429,
      'rate_limited',
      isChat
        ? '短時間に多くのご質問をいただきました。1分ほど時間をおいて再度お試しください。'
        : '短時間にアクセスが集中しました。1分ほど時間をおいてから、もう一度お試しください。',
      {
        // 監視が数えている既存のイベント名(chat.rate_limited)を変えない。
        ...(isChat ? { event: 'chat.rate_limited' as const } : {}),
        headers: { 'Retry-After': String(RATE_LIMIT_PERIOD_SECONDS) },
      },
    );
  };
}
