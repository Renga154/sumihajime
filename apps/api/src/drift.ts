import {
  classifyCheck,
  extractPageUpdatedOn,
  isOfficialUrl,
  sha256HexWeb,
  type DriftFetchResult,
  type DriftStatus,
  type DriftVerdict,
} from '@tmn/drift';
import type { Bindings } from './db.js';
import { logEvent } from './log.js';
import { parseDriftBatchSize } from './config.js';

/**
 * 定期巡回(ADR-014): 承認済み公式ソースを少量ずつ再取得し、到達性とページ自身の「更新日」
 * (csv/xlsx は生ハッシュ)を承認時の基準値と比べて source_drift に記録する。
 *
 * 制約(Workers Free): 1回の実行で CPU 10ms・外部サブリクエスト50(リダイレクト込み)・
 * 同時接続6。よって1回に10件、直列に取得し、本文全体のテキスト抽出はしない(更新日の
 * 抽出はラベル直後の200文字だけを見る純関数)。
 *
 * 判定(classifyCheck)は純関数で、この関数は I/O(fetch・D1)と記録の遷移規則だけを担う。
 * ログはソースIDと件数のみ(URL・本文は出さない)。
 */

/** ADR-014 で全32公式ホストが 200 を返すことを確認した UA。変更すると再測定が要る。 */
export const DRIFT_USER_AGENT =
  'Mozilla/5.0 (compatible; SumihajimeDriftCheck/1.0; +https://sumihajime.com)';

const FETCH_TIMEOUT_MS = 15_000;
/** charset 宣言を探す先頭バイト数(<head> 内の meta は通常ここに収まる)。 */
const CHARSET_SNIFF_BYTES = 4096;

/**
 * 辿るリダイレクトの最大ホップ数。
 * なぜ 4 か: Workers Free の外部サブリクエストは1実行50で、各ホップが1件に数える。
 * 1回10件(DRIFT_BATCH_SIZE)× (最初の要求1 + 転送4) = 50 で枠にちょうど収まる。
 * 自治体サイトの転送は実測で www 付け外し・https 化・末尾スラッシュの1〜2段が普通。
 */
export const MAX_REDIRECT_HOPS = 4;

/**
 * 本文の読み取り上限(バイト)。
 * なぜ: 公式ページでも巨大ファイル(PDF 誤登録、全件の xlsx など)を全部メモリへ読むと
 * Worker のメモリ上限(128MB)と CPU 枠を圧迫し、同じ実行の他のソースまで巻き添えにする。
 * 超えたら読むのをやめて検証不能として記録する(推測しない)。
 */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type FollowResult =
  | { kind: 'response'; res: Response; finalUrl: string }
  | { kind: 'rejected'; reason: 'redirect_not_official' | 'too_many_redirects' };

/**
 * リダイレクトを手動で辿る。各ホップの転送先が公式ホストでなければ、その先へは要求を送らない。
 *
 * なぜ redirect: 'follow' をやめたか: 自動追従では、公式ページが第三者サイトへ転送されても
 * Worker がその先へ要求を送り本文まで読んでいた。転送先はページ側の設定次第で任意に変わり得る
 * (乗っ取られたページ・期限切れドメインの再取得など)。非公式ホストの中身は根拠の判定に
 * 使わない(原則5)ので、要求自体を送らないのが筋。
 */
async function fetchFollowingOfficialRedirects(
  url: string,
  opts: DriftRunOptions,
  init: { headers: Record<string, string>; signal: AbortSignal },
): Promise<FollowResult> {
  const doFetch = opts.fetchImpl;
  let current = url;
  for (let hop = 0; ; hop += 1) {
    const res = await doFetch(current, { ...init, redirect: 'manual' });
    const location = res.headers.get('location');
    if (!REDIRECT_STATUSES.has(res.status) || location === null) {
      return { kind: 'response', res, finalUrl: current };
    }
    // 転送応答の本文は使わない。接続を早く返すために捨てる。
    await res.body?.cancel().catch(() => undefined);
    if (hop >= MAX_REDIRECT_HOPS) return { kind: 'rejected', reason: 'too_many_redirects' };
    let next: string;
    try {
      next = new URL(location, current).href;
    } catch {
      return { kind: 'rejected', reason: 'redirect_not_official' };
    }
    if (!isOfficialUrl(next)) return { kind: 'rejected', reason: 'redirect_not_official' };
    current = next;
  }
}

/**
 * 本文を上限付きで読む。上限を超えたら読むのをやめて null を返す。
 * Content-Length が上限を超えると分かっていれば最初から読まない(嘘の申告もあり得るので、
 * 読みながら数える側が本当の防御)。
 */
export async function readBodyCapped(res: Response, maxBytes: number): Promise<ArrayBuffer | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.body) return new ArrayBuffer(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

export interface DriftRunOptions {
  now: Date;
  fetchImpl: typeof fetch;
  batchSize: number;
  userAgent?: string;
}

export interface DriftRunSummary {
  checked: number;
  byStatus: Record<DriftStatus, number>;
  sourceIds: string[];
}

interface BatchRow {
  source_id: string;
  source_url: string;
  source_type: string;
  content_hash: string | null;
  snapshot_page_updated_on: string | null;
  last_verified_at: string | null;
  d_status: string | null;
  d_detected_at: string | null;
  d_verified_at_seen: string | null;
  d_consecutive_failures: number | null;
  d_baseline_last_modified: string | null;
}

interface Observation {
  verdict: DriftVerdict;
  currentPageUpdatedOn: string | null;
  httpStatus: number | null;
  finalUrl: string | null;
  /** 今回の応答の Last-Modified(基準確立時に控える)。 */
  lastModified: string | null;
}

/**
 * content-type ヘッダまたは先頭 4KB の <meta> から charset 宣言を取り出す(無ければ undefined)。
 * なぜ: 非 UTF-8 のページを UTF-8 として読むと日付の文字が化けて「更新日が消えた」と誤検知する。
 * 宣言が UTF-8 以外なら判定側で unverifiable にする(推測しない)。
 */
export function detectDeclaredCharset(
  contentType: string | null,
  head: string,
): string | undefined {
  const fromHeader = /charset\s*=\s*"?([A-Za-z0-9_.:-]+)"?/i.exec(contentType ?? '');
  if (fromHeader?.[1]) return fromHeader[1];
  const meta = /<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_.:-]+)/i.exec(head);
  if (meta?.[1]) return meta[1];
  return undefined;
}

async function observe(
  row: BatchRow,
  opts: DriftRunOptions,
  previousFailures: number,
): Promise<Observation> {
  const none = { currentPageUpdatedOn: null, httpStatus: null, finalUrl: null, lastModified: null };

  // 公式ホスト以外は取得自体をしない(原則5)。台帳の URL が書き換わった場合の安全弁。
  if (!isOfficialUrl(row.source_url)) {
    return {
      ...none,
      verdict: { status: 'unverifiable', reason: 'host_not_official', consecutiveFailures: 0 },
    };
  }

  // なぜ fetchImpl を関数内でローカル変数へ取り出すか: `opts.fetchImpl(...)` と書くと this=opts で
  // 呼ばれ、workerd のグローバル fetch は "Illegal invocation" を投げる(ローカル検証で全件
  // network_error になった)。fetchFollowingOfficialRedirects が取り出して呼ぶ。
  let followed: FollowResult;
  try {
    followed = await fetchFollowingOfficialRedirects(row.source_url, opts, {
      headers: {
        'User-Agent': opts.userAgent ?? DRIFT_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,text/csv,application/octet-stream;q=0.9,*/*;q=0.8',
      },
      // 全ホップ合計の制限時間(転送を重ねても1件あたり15秒を超えない)。
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    const fetchResult: DriftFetchResult = { networkError: true };
    return {
      ...none,
      verdict: classifyCheck({
        sourceType: row.source_type,
        fetch: fetchResult,
        baseline: {},
        current: {},
        previousConsecutiveFailures: previousFailures,
      }),
    };
  }

  if (followed.kind === 'rejected') {
    // 非公式ホストへの転送・転送の重ねすぎ。転送先へは要求を送っていない(URL はログにも出さない)。
    return {
      ...none,
      verdict: classifyCheck({
        sourceType: row.source_type,
        fetch: { redirectRejected: followed.reason },
        baseline: {},
        current: {},
        previousConsecutiveFailures: previousFailures,
      }),
    };
  }

  const { res, finalUrl } = followed;
  const contentType = res.headers.get('content-type');
  const lastModified = res.headers.get('last-modified');
  const base = {
    ok: res.ok,
    status: res.status,
    requestedUrl: row.source_url,
    finalUrl,
    ...(contentType ? { contentType } : {}),
    ...(lastModified ? { lastModified } : {}),
  };

  if (row.source_type === 'csv' || row.source_type === 'xlsx') {
    const bytes = res.ok ? await readBodyCapped(res, MAX_BODY_BYTES) : new ArrayBuffer(0);
    const contentHash = res.ok && bytes !== null ? await sha256HexWeb(bytes) : null;
    return {
      currentPageUpdatedOn: null,
      httpStatus: res.status,
      finalUrl,
      lastModified,
      verdict: classifyCheck({
        sourceType: row.source_type,
        fetch: { ...base, ...(bytes === null ? { bodyTooLarge: true } : {}) },
        baseline: { contentHash: row.content_hash },
        current: { contentHash },
        previousConsecutiveFailures: previousFailures,
      }),
    };
  }

  // HTML: 本文は text/html(または content-type 無し)のときだけ読む。
  let text = '';
  let declaredCharset: string | undefined;
  let bodyTooLarge = false;
  if (res.ok && (!contentType || /text\/html|application\/xhtml/i.test(contentType))) {
    const buf = await readBodyCapped(res, MAX_BODY_BYTES);
    if (buf === null) {
      bodyTooLarge = true;
    } else {
      // 既定(非 fatal)の UTF-8 デコーダ。化けた文字は U+FFFD になるだけで例外にしない。
      const decoder = new TextDecoder();
      const head = decoder.decode(buf.slice(0, CHARSET_SNIFF_BYTES));
      declaredCharset = detectDeclaredCharset(contentType, head);
      text = decoder.decode(buf);
    }
  } else {
    // 読まない本文は捨てて接続を返す。
    await res.body?.cancel().catch(() => undefined);
  }
  const currentPageUpdatedOn = text ? extractPageUpdatedOn(text) : null;
  return {
    currentPageUpdatedOn,
    httpStatus: res.status,
    finalUrl,
    lastModified,
    verdict: classifyCheck({
      sourceType: row.source_type,
      fetch: {
        ...base,
        ...(declaredCharset ? { declaredCharset } : {}),
        ...(bodyTooLarge ? { bodyTooLarge: true } : {}),
      },
      baseline: {
        pageUpdatedOn: row.snapshot_page_updated_on,
        lastModified: row.d_baseline_last_modified,
      },
      current: { pageUpdatedOn: currentPageUpdatedOn },
      previousConsecutiveFailures: previousFailures,
    }),
  };
}

/**
 * 1件ぶんの upsert 文を組み立てる(遷移規則):
 * - detected_at は changed/unreachable へ**別の状態から**遷移したときだけ now。既に同じ
 *   状態なら維持(最初の検知日を残す)。ok に戻れば detected_at / verified_at_seen を消す。
 * - verified_at_seen は検知時点の sources.last_verified_at。人が再監査して台帳を進めれば
 *   これより新しくなり、マークは読み出し側で効力を失う。
 * - baseline_last_modified は reason=baseline_established のときだけ入れ、以後は上書きしない。
 */
function upsertStatement(
  db: D1Database,
  row: BatchRow,
  obs: Observation,
  nowIso: string,
): D1PreparedStatement {
  const { verdict } = obs;
  const wasFlagged = row.d_status === 'changed' || row.d_status === 'unreachable';
  // なぜ据え置くか: 一度立てた要確認は、確認できた(ok)か別種の確定(changed⇔unreachable)のときだけ
  // 動かす。一過性の失敗(transient)や判定不能(unverifiable)で下ろすと、利用者の表示が毎時ちらつき、
  // 次に検知したときに検知日まで今日へ戻ってしまう。reason/http_status/consecutive_failures には
  // 今回の観測をそのまま残すので、据え置いた理由は行を見れば分かる。
  const status: DriftStatus =
    wasFlagged && (verdict.status === 'transient' || verdict.status === 'unverifiable')
      ? (row.d_status as DriftStatus)
      : verdict.status;
  const isFlagged = status === 'changed' || status === 'unreachable';
  const wasSameFlag = row.d_status === status;
  const detectedAt = isFlagged
    ? wasSameFlag
      ? (row.d_detected_at ?? nowIso)
      : nowIso
    : status === 'ok'
      ? null
      : row.d_detected_at;
  const verifiedAtSeen = isFlagged
    ? wasSameFlag
      ? (row.d_verified_at_seen ?? row.last_verified_at)
      : row.last_verified_at
    : status === 'ok'
      ? null
      : row.d_verified_at_seen;
  const baselineLastModified =
    row.d_baseline_last_modified ??
    (verdict.reason === 'baseline_established' ? obs.lastModified : null);

  return db
    .prepare(
      'INSERT INTO source_drift (source_id, status, reason, detected_at, verified_at_seen, ' +
        'last_checked_at, consecutive_failures, baseline_last_modified, current_page_updated_on, ' +
        'http_status, final_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(source_id) DO UPDATE SET status = excluded.status, reason = excluded.reason, ' +
        'detected_at = excluded.detected_at, verified_at_seen = excluded.verified_at_seen, ' +
        'last_checked_at = excluded.last_checked_at, ' +
        'consecutive_failures = excluded.consecutive_failures, ' +
        'baseline_last_modified = excluded.baseline_last_modified, ' +
        'current_page_updated_on = excluded.current_page_updated_on, ' +
        'http_status = excluded.http_status, final_url = excluded.final_url',
    )
    .bind(
      row.source_id,
      status,
      verdict.reason,
      detectedAt,
      verifiedAtSeen,
      nowIso,
      verdict.consecutiveFailures,
      baselineLastModified,
      obs.currentPageUpdatedOn,
      obs.httpStatus,
      obs.finalUrl,
    );
}

export async function runDriftCheck(
  db: D1Database,
  opts: DriftRunOptions,
): Promise<DriftRunSummary> {
  const nowIso = opts.now.toISOString();
  // 未巡回 → 最も古い巡回 の順。source_id で安定化(同時刻の並びを決定論的にする)。
  const batch = await db
    .prepare(
      'SELECT s.source_id, s.source_url, s.source_type, s.content_hash, s.snapshot_page_updated_on, ' +
        's.last_verified_at, d.status AS d_status, d.detected_at AS d_detected_at, ' +
        'd.verified_at_seen AS d_verified_at_seen, d.consecutive_failures AS d_consecutive_failures, ' +
        'd.baseline_last_modified AS d_baseline_last_modified ' +
        'FROM sources s LEFT JOIN source_drift d ON d.source_id = s.source_id ' +
        "WHERE s.review_status = 'approved' " +
        'ORDER BY (d.last_checked_at IS NULL) DESC, d.last_checked_at ASC, s.source_id ASC LIMIT ?',
    )
    .bind(opts.batchSize)
    .all<BatchRow>();

  const byStatus: Record<DriftStatus, number> = {
    ok: 0,
    changed: 0,
    unreachable: 0,
    unverifiable: 0,
    transient: 0,
  };
  const statements: D1PreparedStatement[] = [];
  const sourceIds: string[] = [];

  // 直列に取得する(Free の同時接続上限6と CPU 枠のため)。1件の例外で残りを止めない。
  for (const row of batch.results) {
    const previousFailures = Number(row.d_consecutive_failures ?? 0);
    let obs: Observation;
    try {
      obs = await observe(row, opts, previousFailures);
    } catch {
      obs = {
        currentPageUpdatedOn: null,
        httpStatus: null,
        finalUrl: null,
        lastModified: null,
        verdict: {
          status: 'transient',
          reason: 'exception',
          consecutiveFailures: previousFailures + 1,
        },
      };
    }
    byStatus[obs.verdict.status] += 1;
    sourceIds.push(row.source_id);
    statements.push(upsertStatement(db, row, obs, nowIso));
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }

  logEvent({
    requestId: `drift-${nowIso}`,
    event: 'drift.run',
    count: statements.length,
    driftSourceIds: sourceIds,
    driftFlagged: byStatus.changed + byStatus.unreachable,
  });

  return { checked: statements.length, byStatus, sourceIds };
}

/** Cron(wrangler.jsonc triggers.crons)から呼ばれる入口。応答を待たせないため waitUntil で回す。 */
export const scheduled: ExportedHandlerScheduledHandler<Bindings> = (_event, env, ctx) => {
  ctx.waitUntil(
    runDriftCheck(env.DB, {
      now: new Date(),
      // グローバル fetch をそのまま渡さずラップする(this の取り違えで Illegal invocation にしない)。
      fetchImpl: (input, init) => fetch(input, init),
      // 以前の Number(...) は空文字・誤記で NaN になり、SQL の LIMIT に NaN が入っていた。
      batchSize: parseDriftBatchSize(env.DRIFT_BATCH_SIZE),
    }),
  );
};
