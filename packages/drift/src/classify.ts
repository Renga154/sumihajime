/**
 * なぜ: 巡回1件ぶんの観測(HTTP結果・抽出した更新日・ハッシュ)から判定(ok/changed/
 * unreachable/unverifiable/transient)を出す純関数。I/O を持たないので、ADR-014 の判定表を
 * 正例・負例・境界のテストで固定できる。Worker(cron)はこの結果をそのまま D1 に記録する。
 */

export type DriftStatus = 'ok' | 'changed' | 'unreachable' | 'unverifiable' | 'transient';

/**
 * HTTP 取得の結果。ネットワーク層で失敗したときは networkError のみ。
 * redirectRejected: リダイレクトを手動で辿った結果、取得を打ち切った(非公式ホストへの転送、
 *   またはホップ数の上限超過)。非公式ホストの本文は読まない(原則5。Worker が任意の転送先へ
 *   要求を送らないためでもある)。
 */
export type DriftFetchResult =
  | {
      ok: boolean;
      status: number;
      requestedUrl: string;
      finalUrl: string;
      contentType?: string;
      lastModified?: string;
      declaredCharset?: string;
      /** 本文が読み取り上限を超えたため読むのをやめた(判定材料が無い=検証不能)。 */
      bodyTooLarge?: boolean;
    }
  | { networkError: true }
  | { redirectRejected: 'redirect_not_official' | 'too_many_redirects' };

export interface DriftCheckInput {
  sourceType: 'html' | 'csv' | 'xlsx' | string;
  fetch: DriftFetchResult;
  /** 承認時の基準値(publish が snapshot から得た更新日・台帳の content_hash・初回巡回の Last-Modified)。 */
  baseline: {
    pageUpdatedOn?: string | null;
    contentHash?: string | null;
    lastModified?: string | null;
  };
  /** 今回の取得から得た値。 */
  current: {
    pageUpdatedOn?: string | null;
    contentHash?: string | null;
  };
  /** 直前までの連続失敗回数(source_drift.consecutive_failures)。 */
  previousConsecutiveFailures: number;
}

export interface DriftVerdict {
  status: DriftStatus;
  /** 短い機械可読コード(例: http_404 / page_updated_on_changed / no_signal)。 */
  reason: string;
  consecutiveFailures: number;
}

/**
 * ホスト名を比較用に正規化する。大文字小文字と `www.` の有無は同一ホストとみなす
 * (自治体サイトは www 付き/無しのリダイレクトを日常的に行う)。
 */
function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * 到達性の失敗理由を返す。失敗でなければ null。
 * - ネットワーク例外 / 2xx 以外
 * - 最終 URL のホストが変わった(別サイトへ飛ばされた=ページが消えた典型)
 * - 深いパスを要求したのにトップ(`/`)へ潰された(ソフト404の典型)
 */
function reachabilityFailure(fetch: DriftFetchResult, sourceType: string): string | null {
  if ('networkError' in fetch) return 'network_error';
  // リダイレクトの打ち切り。HTML では「別サイトへ飛ばされた」は従来から host_changed として
  // 到達性の失敗(2回連続で unreachable)だった。非公式ホストへの転送は必ず別ホストなので、
  // 同じ扱いを理由名だけ変えて保つ。ファイルの非公式転送は classifyCheck 側で検証不能に倒す。
  if ('redirectRejected' in fetch) return fetch.redirectRejected;
  if (!fetch.ok || fetch.status < 200 || fetch.status >= 300) return `http_${fetch.status}`;
  // なぜファイルは到達先を問わないか: オープンデータのダウンロードは、配信基盤が署名付きの
  // 保存先URL(別ホスト)へリダイレクトして返すのが普通(渋谷区の ArcGIS Hub で実際に
  // host_changed の誤検知が出た。2026-09-25)。ファイルは中身のハッシュで判定するので、
  // 行き先のホストやパスは「ページが消えた」の信号にならない。
  if (sourceType === 'csv' || sourceType === 'xlsx') return null;
  const requested = parseUrl(fetch.requestedUrl);
  const final = parseUrl(fetch.finalUrl);
  if (!requested || !final) return 'url_unparseable';
  if (normalizeHost(requested.hostname) !== normalizeHost(final.hostname)) return 'host_changed';
  const requestedDeep = requested.pathname !== '/' && requested.pathname !== '';
  const finalRoot = final.pathname === '/' || final.pathname === '';
  if (requestedDeep && finalRoot) return 'path_collapsed_to_root';
  return null;
}

function isUtf8(charset: string): boolean {
  return (
    charset
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') === 'utf8'
  );
}

export function classifyCheck(input: DriftCheckInput): DriftVerdict {
  const isFile = input.sourceType === 'csv' || input.sourceType === 'xlsx';
  // なぜファイルの非公式転送は失敗に数えないか: オープンデータの配信基盤は署名付きの保存先
  // (別ホスト)へ転送して返すのが普通で、転送そのものは「消えた」の信号ではない(上の
  // reachabilityFailure の注記)。ただし非公式ホストの中身は取りに行かないので、比べる材料が無い
  // =検証不能として記録する(推測で ok にも changed にもしない。原則3)。
  if (isFile && 'redirectRejected' in input.fetch) {
    if (input.fetch.redirectRejected === 'redirect_not_official') {
      return { status: 'unverifiable', reason: 'redirect_not_official', consecutiveFailures: 0 };
    }
  }
  const failure = reachabilityFailure(input.fetch, input.sourceType);
  if (failure !== null) {
    const consecutiveFailures = input.previousConsecutiveFailures + 1;
    // ADR-014: unreachable は2回連続で初めて確定する(一過性の障害を降格理由にしない)。
    return {
      status: consecutiveFailures >= 2 ? 'unreachable' : 'transient',
      reason: failure,
      consecutiveFailures,
    };
  }

  const fetch = input.fetch as Extract<DriftFetchResult, { ok: boolean }>;

  // 本文が上限を超えて読めなかった: 更新日もハッシュも得られない。到達はできているので
  // 失敗には数えず、検証不能として記録する。
  if (fetch.bodyTooLarge === true) {
    return { status: 'unverifiable', reason: 'body_too_large', consecutiveFailures: 0 };
  }

  if (isFile) {
    // 静的ファイルは生バイトの SHA-256 が安定する(ADR-014 測定)。
    const base = input.baseline.contentHash ?? null;
    const cur = input.current.contentHash ?? null;
    if (base === null || cur === null) {
      return { status: 'unverifiable', reason: 'no_signal', consecutiveFailures: 0 };
    }
    if (base !== cur) {
      return { status: 'changed', reason: 'content_hash_changed', consecutiveFailures: 0 };
    }
    return { status: 'ok', reason: 'content_hash_same', consecutiveFailures: 0 };
  }

  // HTML: 非 UTF-8 宣言のページは本文を復号せず(Worker で iconv を持たない)、更新日を
  // 抽出できないため検証不能として記録する(推測しない=原則3)。
  if (fetch.declaredCharset !== undefined && !isUtf8(fetch.declaredCharset)) {
    return { status: 'unverifiable', reason: 'charset_not_utf8', consecutiveFailures: 0 };
  }

  const basePage = input.baseline.pageUpdatedOn ?? null;
  if (basePage !== null) {
    const curPage = input.current.pageUpdatedOn ?? null;
    if (curPage === null) {
      return { status: 'changed', reason: 'page_updated_on_missing_now', consecutiveFailures: 0 };
    }
    if (curPage !== basePage) {
      return { status: 'changed', reason: 'page_updated_on_changed', consecutiveFailures: 0 };
    }
    return { status: 'ok', reason: 'page_updated_on_same', consecutiveFailures: 0 };
  }

  // 更新日表記の無いページ: 初回巡回で控えた Last-Modified と比べる。
  if (fetch.lastModified !== undefined && fetch.lastModified !== '') {
    const baseLm = input.baseline.lastModified ?? null;
    if (baseLm === null) {
      return { status: 'ok', reason: 'baseline_established', consecutiveFailures: 0 };
    }
    if (baseLm !== fetch.lastModified) {
      return { status: 'changed', reason: 'last_modified_changed', consecutiveFailures: 0 };
    }
    return { status: 'ok', reason: 'last_modified_same', consecutiveFailures: 0 };
  }

  return { status: 'unverifiable', reason: 'no_signal', consecutiveFailures: 0 };
}
