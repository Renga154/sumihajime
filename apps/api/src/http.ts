import type { Context, MiddlewareHandler } from 'hono';
import type { Bindings } from './db.js';
import { logEvent, type LogEventName } from './log.js';

/**
 * 全ハンドラ共通の HTTP 部品(エラー応答の形・入力の入口の制限)。
 *
 * なぜ別ファイルか: 以前 fail() は index.ts にだけあり、chat.ts はエラー応答を6か所で手書きしていた。
 * その結果チャットの 400/404/422 はログに1行も残らず、形(requestId の有無など)も揃う保証が
 * なかった。エラー応答の作り方を1つにして、どの経路の失敗も同じ形で返り、同じ規則で記録されるようにする。
 */

export type ApiVariables = { requestId: string };
export type ApiEnv = { Bindings: Bindings; Variables: ApiVariables };

export type FailStatus = 400 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 503;

export interface FailExtra {
  municipalityCode?: string;
  officialUrl?: string;
  /**
   * 既定の `error.<code>` の代わりに記録するイベント名。監視が既に数えている名前
   * (chat.rate_limited 等)を変えないために使う。
   */
  event?: LogEventName;
  latencyMs?: number;
}

/**
 * 標準のエラー応答 `{ error: { code, message, requestId, officialUrl? } }` を返し、allowlist ログへ記録する。
 * message は利用者向けの固定文面にする(利用者の入力値を埋め込まない。反射によるなりすまし表示を防ぐ)。
 */
export function fail(
  c: Context<ApiEnv>,
  status: FailStatus,
  code: string,
  message: string,
  extra?: FailExtra,
): Response {
  const requestId = c.get('requestId');
  logEvent({
    requestId,
    event: extra?.event ?? `error.${code}`,
    status,
    municipalityCode: extra?.municipalityCode,
    latencyMs: extra?.latencyMs,
  });
  return c.json(
    {
      error: {
        code,
        message,
        requestId,
        ...(extra?.officialUrl ? { officialUrl: extra.officialUrl } : {}),
      },
    },
    status,
  );
}

/** JSON を受け取る POST の本文上限。質問500字(UTF-8で最大約1.5KB)+プロフィールに十分な余裕を持たせた値。 */
export const JSON_BODY_LIMIT_BYTES = 8 * 1024;

/**
 * Content-Type が application/json でない要求を 415 で断る。
 *
 * なぜ: text/plain・application/x-www-form-urlencoded・multipart/form-data は CORS の「単純リクエスト」
 * で、第三者サイトのフォームや fetch(no-cors) からプリフライト無しで送れてしまう。本文がJSONとして
 * 読めれば以前は処理しており、他サイトから利用者のブラウザ経由でチャット(=OpenAI課金)を
 * 叩かせることができた。application/json を必須にすると、クロスオリジンからはプリフライトが
 * 必要になり、CORSを許可していないこのAPIには届かない。
 */
export function requireJsonContentType(): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const mediaType = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (mediaType !== 'application/json') {
      return fail(
        c,
        415,
        'unsupported_media_type',
        'リクエストの形式が正しくありません。画面を再読み込みしてから、もう一度お試しください。',
      );
    }
    await next();
  };
}
