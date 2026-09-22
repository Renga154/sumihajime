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
  'Mozilla/5.0 (compatible; SumihajimeDriftCheck/1.0; +https://app.sumihajime.workers.dev)';

const FETCH_TIMEOUT_MS = 15_000;
/** charset 宣言を探す先頭バイト数(<head> 内の meta は通常ここに収まる)。 */
const CHARSET_SNIFF_BYTES = 4096;

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

  // なぜローカル変数へ取り出すか: `opts.fetchImpl(...)` と書くと this=opts で呼ばれ、workerd の
  // グローバル fetch は "Illegal invocation" を投げる(ローカル検証で全件 network_error になった)。
  const doFetch = opts.fetchImpl;
  let res: Response;
  try {
    res = await doFetch(row.source_url, {
      redirect: 'follow',
      headers: {
        'User-Agent': opts.userAgent ?? DRIFT_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,text/csv,application/octet-stream;q=0.9,*/*;q=0.8',
      },
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

  const contentType = res.headers.get('content-type');
  const lastModified = res.headers.get('last-modified');
  const finalUrl = res.url || row.source_url;
  const base = {
    ok: res.ok,
    status: res.status,
    requestedUrl: row.source_url,
    finalUrl,
    ...(contentType ? { contentType } : {}),
    ...(lastModified ? { lastModified } : {}),
  };

  if (row.source_type === 'csv' || row.source_type === 'xlsx') {
    const bytes = res.ok ? await res.arrayBuffer() : new ArrayBuffer(0);
    const contentHash = res.ok ? await sha256HexWeb(bytes) : null;
    return {
      currentPageUpdatedOn: null,
      httpStatus: res.status,
      finalUrl,
      lastModified,
      verdict: classifyCheck({
        sourceType: row.source_type,
        fetch: base,
        baseline: { contentHash: row.content_hash },
        current: { contentHash },
        previousConsecutiveFailures: previousFailures,
      }),
    };
  }

  // HTML: 本文は text/html(または content-type 無し)のときだけ読む。
  let text = '';
  let declaredCharset: string | undefined;
  if (res.ok && (!contentType || /text\/html|application\/xhtml/i.test(contentType))) {
    const buf = await res.arrayBuffer();
    // 既定(非 fatal)の UTF-8 デコーダ。化けた文字は U+FFFD になるだけで例外にしない。
    const decoder = new TextDecoder();
    const head = decoder.decode(buf.slice(0, CHARSET_SNIFF_BYTES));
    declaredCharset = detectDeclaredCharset(contentType, head);
    text = decoder.decode(buf);
  }
  const currentPageUpdatedOn = text ? extractPageUpdatedOn(text) : null;
  return {
    currentPageUpdatedOn,
    httpStatus: res.status,
    finalUrl,
    lastModified,
    verdict: classifyCheck({
      sourceType: row.source_type,
      fetch: { ...base, ...(declaredCharset ? { declaredCharset } : {}) },
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
      batchSize: Number(env.DRIFT_BATCH_SIZE ?? 10),
    }),
  );
};
