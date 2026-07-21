/**
 * なぜ: 再取得は公式ドメインのみに限定する(CLAUDE.md原則5「非公式まとめサイトを
 * 一次根拠にしない」/ タスク制約「ネットワークは *.lg.jp / 都オープンデータ / CKAN のみ」)。
 * タイムアウトと1回リトライで一過性の失敗を吸収しつつ、恒久失敗は fetch_error として
 * 分類できるように例外を投げる。
 */

/** 許可するホスト接尾辞。東京都内自治体・都オープンデータ・CKAN は全て .lg.jp 配下。 */
const ALLOWED_HOST_SUFFIXES = ['.lg.jp'] as const;
/** 例外的に接尾辞一致しない完全一致許可(将来のCKANホスト名等)。現状は .lg.jp で充足。 */
const ALLOWED_HOST_EXACT = ['lg.jp'] as const;

export class DisallowedHostError extends Error {
  constructor(url: string, host: string) {
    super(
      `Refusing to fetch non-official host "${host}" (url: ${url}). ` +
        `Only official domains are allowed: *.lg.jp (municipal / Tokyo open data / CKAN).`,
    );
    this.name = 'DisallowedHostError';
  }
}

/** 公式ドメイン(.lg.jp 配下)か判定する。純関数(テスト可能)。 */
export function isOfficialHost(host: string): boolean {
  const h = host.toLowerCase();
  if (ALLOWED_HOST_EXACT.includes(h as (typeof ALLOWED_HOST_EXACT)[number])) return true;
  return ALLOWED_HOST_SUFFIXES.some((suffix) => h.endsWith(suffix));
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
