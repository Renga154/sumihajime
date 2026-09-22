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

/** URLのホストが公式でなければ例外。取得前の関門。 */
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
  if (!isOfficialHost(parsed.hostname)) {
    throw new DisallowedHostError(url, parsed.hostname);
  }
}

export interface FetchResult {
  bytes: Uint8Array;
  status: number;
  contentType: string | null;
}

export interface FetchOptions {
  timeoutMs?: number;
  /** 追加のリトライ回数(既定1回 = 合計2回試行)。 */
  retries?: number;
}

async function fetchOnce(url: string, timeoutMs: number): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'tokyo-move-navi-ingest/0.0.1 (+official-source re-fetch)' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    return { bytes: buf, status: res.status, contentType: res.headers.get('content-type') };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 公式ドメイン検証 → タイムアウト付き取得 → 失敗時に retries 回だけ再試行。
 * 最終的に失敗したら例外(呼び出し側で fetch_error に分類)。
 */
export async function fetchOfficial(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  assertOfficialUrl(url);
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const retries = opts.retries ?? 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchOnce(url, timeoutMs);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
