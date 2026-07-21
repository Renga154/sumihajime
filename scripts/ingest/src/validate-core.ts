import { findGateViolations, type SourceRef } from '@tmn/publish';
import { daysBetween } from './dates.js';
import type { RegistryRowResult } from './registry.js';

/**
 * なぜ: オフライン検証(CIで実行)の中核を純関数化し、ファイル読み込みと分離して
 * テスト可能にする。REQUIREMENTS §12.4/§12.5 と CLAUDE.md原則2・10・9 を機械強制する:
 *   - 台帳全行が sourceSchema を満たす
 *   - 公開物(procedures/rules/facilities/waste)の参照 sourceId が「実在 かつ approved」
 *     (publish の gate.ts を再利用。§12.4「承認済み版のみ公開」)
 *   - lastVerifiedAt(最終確認日)の欠落チェック(原則2)
 *   - 有効期限切れ effective_to < today の列挙で非0終了(§12.5 stale検知)+30日以内警告
 */

export interface ValidateInput {
  /** registry全行の schema検証結果。 */
  rows: RegistryRowResult[];
  /** 公開物が参照する sourceId 群(loadPublishData().references)。 */
  references: SourceRef[];
  /** review_status=approved の sourceId 集合(loadPublishData().approvedSourceIds)。 */
  approvedSourceIds: Set<string>;
  /** loadPublishData が例外を投げた場合のメッセージ(公開データ整合の致命的失敗)。 */
  publishLoadError?: string;
  /** 基準日 YYYY-MM-DD(Asia/Tokyo)。 */
  today: string;
  /** 期限切れ警告の日数しきい値(既定30)。 */
  expiryWarnDays?: number;
}

export interface ValidateResult {
  errors: string[];
  warnings: string[];
  /** 集計(レポート表示用)。 */
  stats: {
    rowCount: number;
    approvedCount: number;
    schemaErrorCount: number;
    gateViolationCount: number;
    missingLastVerifiedCount: number;
    expiredCount: number;
    expiringSoonCount: number;
  };
  ok: boolean;
}

export function runValidations(input: ValidateInput): ValidateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const warnDays = input.expiryWarnDays ?? 30;

  // 0. loadPublishData 段階の致命的失敗(公開JSONのschema不正等)。
  if (input.publishLoadError) {
    errors.push(`Publish data failed to load (schema/integrity): ${input.publishLoadError}`);
  }

  // 1. 台帳スキーマ検証。
  let schemaErrorCount = 0;
  for (const row of input.rows) {
    if (row.source === null) {
      schemaErrorCount++;
      const id = row.record.source_id || `(row ${row.rowIndex + 2})`;
      errors.push(`Registry schema invalid — ${id}: ${row.schemaError ?? 'unknown'}`);
    }
  }

  // 2. 公開データ整合: 参照 sourceId が実在 かつ approved(publish gate を再利用)。
  const registryIds = new Set(
    input.rows.map((r) => r.record.source_id).filter((s): s is string => !!s),
  );
  const violations = findGateViolations({
    approvedSourceIds: input.approvedSourceIds,
    references: input.references,
  });
  for (const v of violations) {
    // 実在しない参照と、実在するが未承認の参照でメッセージを分ける(修正の指針を明確化)。
    if (!registryIds.has(v.sourceId)) {
      errors.push(
        `Published ${v.owner} references sourceId "${v.sourceId}" that does NOT exist in registry.`,
      );
    } else {
      errors.push(
        `Published ${v.owner} references sourceId "${v.sourceId}" whose review_status is not approved.`,
      );
    }
  }

  // 3. lastVerifiedAt(最終確認日)欠落チェック(schema上はoptionalだが公開運用上は必須)。
  let missingLastVerifiedCount = 0;
  for (const row of input.rows) {
    if (row.source === null) continue;
    if (row.source.lastVerifiedAt === undefined) {
      missingLastVerifiedCount++;
      errors.push(`Source "${row.source.sourceId}" is missing last_verified_at (最終確認日).`);
    }
  }

  // 4. 有効期限チェック: effective_to < today は期限切れ(§12.5 stale)。30日以内は警告。
  let expiredCount = 0;
  let expiringSoonCount = 0;
  for (const row of input.rows) {
    const effectiveTo = row.record.effective_to?.trim();
    if (!effectiveTo) continue; // 期限なしはスキップ。
    const remaining = daysBetween(input.today, effectiveTo);
    if (Number.isNaN(remaining)) {
      errors.push(`Source "${row.record.source_id}" has invalid effective_to "${effectiveTo}".`);
      continue;
    }
    if (remaining < 0) {
      expiredCount++;
      errors.push(
        `Source "${row.record.source_id}" is EXPIRED: effective_to=${effectiveTo} < today=${input.today} ` +
          `(${-remaining} day(s) past). Re-verify or set review_status=stale.`,
      );
    } else if (remaining <= warnDays) {
      expiringSoonCount++;
      warnings.push(
        `Source "${row.record.source_id}" expires in ${remaining} day(s) (effective_to=${effectiveTo}). Re-verify soon.`,
      );
    }
  }

  const approvedCount = input.rows.filter((r) => r.source?.reviewStatus === 'approved').length;

  return {
    errors,
    warnings,
    stats: {
      rowCount: input.rows.length,
      approvedCount,
      schemaErrorCount,
      gateViolationCount: violations.length,
      missingLastVerifiedCount,
      expiredCount,
      expiringSoonCount,
    },
    ok: errors.length === 0,
  };
}
