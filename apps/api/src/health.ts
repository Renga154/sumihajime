import type { DriftSummary } from './db.js';

/**
 * /api/health の自己判定(docs/ROADMAP.md A-1-4)。
 *
 * なぜサーバー側で判定するのか: 外形監視(ops/monitoring の Apps Script)は Google アカウント上で
 * 動くためテストもデプロイもこのリポジトリの外になる。判定を向こうに書くと、閾値を変えるたびに
 * 手作業の貼り直しが要り、しかも検証されない。判定はここ(純関数・テスト付き)に置き、監視側は
 * 「HTTP 200 かつ status === 'ok' か」だけを見る。
 *
 * 見るのは「利用者に実害が出る壊れ方」だけ。再確認中の件数(再監査の積み残し)は運用上の
 * 情報であって障害ではないので issues に入れない。
 */

/** 巡回(毎時)が止まったとみなすまでの猶予。2回取りこぼしても誤報にしない。 */
export const PATROL_STALE_AFTER_MS = 3 * 60 * 60 * 1000;

export type HealthIssue =
  /** D1 が読めない(チェックリスト・詳細が全滅する)。 */
  | 'db_unreachable'
  /** 公開データが空(publish の途中失敗など。チェックリストが空になる)。 */
  | 'no_published_data'
  /** 定期巡回が一度も記録されていない(Cron が登録されていない)。 */
  | 'patrol_never_ran'
  /** 定期巡回が猶予を超えて止まっている(根拠の鮮度の約束が黙って崩れる)。 */
  | 'patrol_stalled';

export interface HealthInput {
  /** D1 の読み出しに成功したか。 */
  dbReachable: boolean;
  /** 公開中の手続き件数(読めなかったときは null)。 */
  publishedProcedures: number | null;
  drift: DriftSummary | null;
  now: Date;
}

export interface HealthAssessment {
  status: 'ok' | 'degraded';
  issues: HealthIssue[];
}

export function assessHealth(input: HealthInput): HealthAssessment {
  const issues: HealthIssue[] = [];
  if (!input.dbReachable) {
    // D1 が読めなければ他の項目は判定できない(推測で ok にしない)。
    return { status: 'degraded', issues: ['db_unreachable'] };
  }
  if (input.publishedProcedures === 0) issues.push('no_published_data');

  const last = input.drift?.lastCheckedAt ?? null;
  if (last === null) {
    issues.push('patrol_never_ran');
  } else {
    const age = input.now.getTime() - Date.parse(last);
    if (!Number.isFinite(age) || age > PATROL_STALE_AFTER_MS) issues.push('patrol_stalled');
  }
  return { status: issues.length === 0 ? 'ok' : 'degraded', issues };
}
