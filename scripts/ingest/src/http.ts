/**
 * なぜ: 再取得は公式ドメインのみに限定する(CLAUDE.md原則5「非公式まとめサイトを
 * 一次根拠にしない」/ タスク制約「ネットワークは *.lg.jp / 都オープンデータ / CKAN のみ」)。
 * タイムアウトと1回リトライで一過性の失敗を吸収しつつ、恒久失敗は fetch_error として
 * 分類できるように例外を投げる。
 */

/**
 * 許可ホスト一覧と判定(isOfficialHost)は @tmn/drift に集約した(ADR-014: Worker の定期巡回も
 * 同じ許可リストで公式性を判定する)。ここでは再エクスポートして既存の呼び出し元を保つ。
 */
import { isOfficialHost } from '@tmn/drift';
export { isOfficialHost };

export class DisallowedHostError extends Error {
  constructor(url: string, host: string) {
    super(
      `Refusing to fetch non-official host "${host}" (url: ${url}). ` +
        `Allowed: *.lg.jp / *.go.jp, or a host explicitly audited and listed in ALLOWED_HOST_EXACT.`,
    );
    this.name = 'DisallowedHostError';
  }
}

/**
 * URL が公式の取得先でなければ例外。取得前の関門で、転送先の各ホップにも同じ判定を掛ける。
 *
 * なぜ userinfo と明示ポートも拒否するか: 公式ページの取得に認証情報付き URL や 443 以外の
 * ポートは要らない。許すと「公式ホスト名のまま別のサービス(管理画面・開発用ポート)へ要求を
 * 送る」経路が残る。台帳の URL(388件)はいずれも userinfo・明示ポートを持たない。
 */
export function assertOfficialUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DisallowedHostError(url, '(invalid url)');
  }
  if (parsed.protocol !== 'https:') {
    throw new DisallowedHostError(url, `${parsed.host} (non-https)`);
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new DisallowedHostError(url, `${parsed.hostname} (userinfo)`);
  }
  // 既定ポート(443)は URL が '' に正規化する。それ以外の明示ポートは拒否する。
  if (parsed.port !== '') {
    throw new DisallowedHostError(url, `${parsed.hostname}:${parsed.port} (non-default port)`);
  }
  if (!isOfficialHost(parsed.hostname)) {
    throw new DisallowedHostError(url, parsed.hostname);
  }
}

/**
 * 辿る転送の最大ホップ数。巡回(apps/api/src/drift.ts の MAX_REDIRECT_HOPS)と同じ値。
 * 自治体サイトの転送は実測で www 付け外し・https 化・末尾スラッシュの1〜2段が普通。
 */
export const MAX_REDIRECT_HOPS = 4;

/**
 * 本文の読み取り上限(バイト)。巡回(drift.ts の MAX_BODY_BYTES)と同じ 5MB。
 * なぜ 5MB で足りるか: 既存スナップショット543件の最大は 544,747 バイト(東京都水道局の HTML。
 * 2026-10-02 時点)で、上限はその約10倍。超えるものは誤登録(巨大 PDF 等)とみなして取り込まない。
 */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type FetchPolicyReason =
  | 'redirect_not_official'
  | 'redirect_downgrade'
  | 'redirect_without_location'
  | 'too_many_redirects'
  | 'body_too_large';

/**
 * 取得方針の違反(非公式ホストへの転送・http への格下げ・転送の重ねすぎ・本文の上限超え)。
 * 一過性の失敗ではないので再試行しない(同じ相手に要求を重ねても結果は変わらない)。
 */
export class FetchPolicyError extends Error {
  readonly reason: FetchPolicyReason;
  constructor(reason: FetchPolicyReason, detail: string) {
    super(`Refusing fetch (${reason}): ${detail}`);
    this.name = 'FetchPolicyError';
    this.reason = reason;
  }
}

export interface FetchResult {
  bytes: Uint8Array;
  status: number;
  contentType: string | null;
  /** 転送を辿った後に実際に本文を読んだ URL(公式ホストであることを検査済み)。 */
  finalUrl: string;
}

export interface FetchOptions {
  /** 1回の試行の総時間(全ホップ + 本文の読み取り)。既定 20 秒。 */
  timeoutMs?: number;
  /** 追加のリトライ回数(既定1回 = 合計2回試行)。方針違反は再試行しない。 */
  retries?: number;
  /** 本文の上限バイト数(既定 MAX_BODY_BYTES)。 */
  maxBytes?: number;
  /** テスト用の fetch 差し替え(既定はグローバル fetch)。 */
  fetchImpl?: typeof fetch;
}

const USER_AGENT = 'tokyo-move-navi-ingest/0.0.1 (+official-source re-fetch)';

/**
 * 本文を上限付きで読む。Content-Length が上限を超えると分かっていれば最初から読まない。
 * 申告は嘘や欠落があり得るので、実際に読んだバイト数で数える側が本当の防御。
 */
async function readBodyCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new FetchPolicyError('body_too_large', `declared ${declared} > ${maxBytes} bytes`);
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new FetchPolicyError('body_too_large', `more than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * 転送を手動で辿りながら1回取得する。
 *
 * なぜ redirect: 'follow' をやめたか: 自動追従では、公式ページが第三者サイト・LAN・localhost・
 * http へ転送されても、この Mac がその先へ要求を送り本文まで読んでいた(読んだ本文は
 * --update でスナップショットとして保存され得る)。転送先はページ側の設定次第で変わり得る
 * (乗っ取られたページ・期限切れドメインの再取得など)ので、各ホップを最初の URL と同じ
 * 方針で検査し、通らなければその先へは要求を送らない。巡回(drift.ts)と同じ方針。
 */
async function fetchOnce(
  url: string,
  timeoutMs: number,
  maxBytes: number,
  doFetch: typeof fetch,
): Promise<FetchResult> {
  // 全ホップと本文の読み取りを合わせた総時間(転送を重ねても1試行あたり timeoutMs を超えない)。
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  for (let hop = 0; ; hop += 1) {
    const res = await doFetch(current, {
      signal,
      redirect: 'manual',
      headers: { 'user-agent': USER_AGENT },
    });
    if (REDIRECT_STATUSES.has(res.status)) {
      // 転送応答の本文は使わない。接続を早く返すために捨てる。
      await res.body?.cancel().catch(() => undefined);
      const location = res.headers.get('location');
      if (location === null || location.trim() === '') {
        throw new FetchPolicyError('redirect_without_location', `HTTP ${res.status} at ${current}`);
      }
      if (hop >= MAX_REDIRECT_HOPS) {
        throw new FetchPolicyError('too_many_redirects', `more than ${MAX_REDIRECT_HOPS} hops`);
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new FetchPolicyError('redirect_not_official', '(invalid location)');
      }
      if (next.protocol === 'http:') {
        throw new FetchPolicyError('redirect_downgrade', `https -> http (${next.hostname})`);
      }
      try {
        assertOfficialUrl(next.href);
      } catch (err) {
        throw new FetchPolicyError(
          'redirect_not_official',
          err instanceof Error ? err.message : String(err),
        );
      }
      current = next.href;
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const bytes = await readBodyCapped(res, maxBytes);
    return {
      bytes,
      status: res.status,
      contentType: res.headers.get('content-type'),
      finalUrl: current,
    };
  }
}

/**
 * 公式ドメイン検証 → 転送を手動で辿る取得(各ホップ再検査・総時間・本文上限)→ 一過性の
 * 失敗時に retries 回だけ再試行。最終的に失敗したら例外(呼び出し側で fetch_error に分類)。
 */
export async function fetchOfficial(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  assertOfficialUrl(url);
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const retries = opts.retries ?? 1;
  const maxBytes = opts.maxBytes ?? MAX_BODY_BYTES;
  // なぜローカル変数へ取り出すか: `opts.fetchImpl(...)` だと this=opts で呼ばれ、実装によっては
  // "Illegal invocation" になる(drift.ts で実際に起きた)。
  const doFetch = opts.fetchImpl ?? fetch;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchOnce(url, timeoutMs, maxBytes, doFetch);
    } catch (err) {
      // 方針違反は決定的なので再試行しない。
      if (err instanceof FetchPolicyError || err instanceof DisallowedHostError) throw err;
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
