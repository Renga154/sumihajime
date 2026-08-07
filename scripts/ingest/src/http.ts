/**
 * なぜ: 再取得は公式ドメインのみに限定する(CLAUDE.md原則5「非公式まとめサイトを
 * 一次根拠にしない」/ タスク制約「ネットワークは *.lg.jp / 都オープンデータ / CKAN のみ」)。
 * タイムアウトと1回リトライで一過性の失敗を吸収しつつ、恒久失敗は fetch_error として
 * 分類できるように例外を投げる。
 */

/**
 * 許可するホスト接尾辞。
 * - `.lg.jp` 地方公共団体(都・区市町村・都オープンデータ・CKAN)
 * - `.go.jp` 国の機関(デジタル庁等)。いずれも登録主体が限定されており公式性が担保される。
 *
 * なぜ `.tokyo.jp` を接尾辞で許可しないか: 東京都内に住所があれば誰でも取得できる
 * 地域ドメインで、ドメイン自体が公式性の証明にならない。区の公式サイトが .tokyo.jp の
 * 場合は下の完全一致リストへ個別に登録する。
 */
const ALLOWED_HOST_SUFFIXES = ['.lg.jp', '.go.jp'] as const;
/**
 * 接尾辞では表現できない、監査で公式性を確認済みのホストだけを完全一致で許可する。
 * 追加するときは「その組織の公式サイトであること」または「自治体公式ページから
 * リンクされた公式データの配信先であること」を registry.csv の notes に記録すること。
 */
const ALLOWED_HOST_EXACT = [
  'lg.jp',
  // 公式サイトが .tokyo.jp の区(いずれも当該区の公式サイトであることを監査で確認済み)
  'www.city.suginami.tokyo.jp',
  'www.city.shinagawa.tokyo.jp',
  'www.city.ota.tokyo.jp',
  'www.city.nerima.tokyo.jp',
  'www.city.itabashi.tokyo.jp',
  'www.city.adachi.tokyo.jp',
  'www.city.edogawa.tokyo.jp',
  // Batch9(目黒13110・渋谷13113)。いずれも当該区の公式サイトであることを監査で確認済み
  // (東京都公式「リンク集／都内区市町村」の href と scripts/publish/src/municipalities.ts の
  // officialUrl に一致する)。
  'www.city.meguro.tokyo.jp',
  'www.city.shibuya.tokyo.jp',
  // 渋谷区のオープンデータ配信先(Esri ArcGIS Hub 上の区独自ポータル)。区公式サイトの
  // オープンデータ案内および東京都オープンデータカタログの渋谷区データセット
  // (t131130d0000000027「オープンデータ一覧」)からリンクされた、渋谷区自身が管理する
  // 公式データの配信先であることを監査で確認済み(docs/research/opendata-gaps.md 事例15)。
  // 配信基盤が区公式ドメイン外にあるため、arcgis.com をワイルドカードで開けず
  // このホストだけを完全一致で許可する(ユーザー決裁 2026-08-07「今許可する」)。
  'city-shibuya-data.opendata.arcgis.com',
  // 日本郵便(郵便法上の郵便事業提供者。転居届の一次情報源。ADR-009)
  'www.post.japanpost.jp',
  // 中野区のオープンデータ配信先。区公式ページからリンクされた公式データだが配信は
  // 外部GISサービス上にあるため、ワイルドカードにせずこのホストだけを許可する
  // (ユーザー決裁 2026-08-07)。
  'www2.wagmap.jp',
] as const;

export class DisallowedHostError extends Error {
  constructor(url: string, host: string) {
    super(
      `Refusing to fetch non-official host "${host}" (url: ${url}). ` +
        `Allowed: *.lg.jp / *.go.jp, or a host explicitly audited and listed in ALLOWED_HOST_EXACT.`,
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
