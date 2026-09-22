import type {
  GeneratedTask,
  ProcedureVersion,
  RuleOutcome,
  Source,
  TaskSourceRef,
} from '@tmn/schemas';
import { generatedTaskSchema } from '@tmn/schemas';
import { sortOutcomesByDue } from '@tmn/rules';
import type { DriftMark } from './db.js';

/**
 * なぜ: ルール評価結果(RuleOutcome[])を §14.2 の GeneratedTask[] に組み立てる純関数。
 * - applicable と needs_confirmation の両方を含める(not_applicable は除外)。
 * - 期限順(sortOutcomesByDue)に並べる。needs_confirmation は期限なしのため優先度で後置。
 * - sources は台帳(Source)から {sourceId,title,url,lastVerifiedAt} を埋め込む(根拠カード)。
 * - driftMarks(ADR-014): 定期巡回が changed/unreachable を検知したソース。根拠に含む手続きは
 *   dataStatus を stale(再確認中)へ落とし、根拠カードに検知日・種類を添える。unavailable は
 *   そのまま(未整備をより良い状態に見せない)。公開データは書き換えず読み出し時に重ねる。
 * D1やHTTPには触れない(入力は全て呼び出し側が用意する)。
 */
export function buildTasks(
  outcomes: RuleOutcome[],
  procedureVersions: Map<string, ProcedureVersion>,
  sources: Map<string, Source>,
  ruleVersion: string,
  driftMarks: ReadonlyMap<string, DriftMark> = new Map(),
): GeneratedTask[] {
  const included = outcomes.filter(
    (o) => o.applicable === 'applicable' || o.applicable === 'needs_confirmation',
  );
  const sorted = sortOutcomesByDue(included);

  return sorted.map((outcome) => {
    const pv = procedureVersions.get(outcome.procedureId);
    if (!pv) {
      // なぜ: ルールが指す手続きの版がD1に無い=公開データの不整合。推測で埋めず即エラー。
      throw new Error(
        `no procedure_version found for procedureId "${outcome.procedureId}" (data integrity)`,
      );
    }

    const taskSources: TaskSourceRef[] = outcome.sourceIds.map((sid) => {
      const s = sources.get(sid);
      if (!s) {
        throw new Error(
          `rule ${outcome.procedureId} references source "${sid}" not present in D1 sources`,
        );
      }
      const mark = driftMarks.get(sid);
      return {
        sourceId: s.sourceId,
        title: s.sourceTitle,
        url: s.sourceUrl,
        // 台帳の検証日時を優先。欠落時は手続きの検証日時にフォールバック(必須項目のため)。
        lastVerifiedAt: s.lastVerifiedAt ?? pv.lastVerifiedAt,
        ...(mark ? { driftDetectedOn: mark.detectedOn, driftKind: mark.status } : {}),
      };
    });
    const drifted = taskSources.some((s) => s.driftKind !== undefined);

    const task: GeneratedTask = {
      id: `task_${outcome.procedureId}`,
      procedureId: outcome.procedureId,
      title: pv.title,
      category: pv.canonicalType,
      priority: outcome.priority,
      applicabilityReason: outcome.applicabilityReason,
      ...(outcome.dueDate !== undefined ? { dueDate: outcome.dueDate } : {}),
      ...(outcome.dueDescription !== undefined ? { dueDescription: outcome.dueDescription } : {}),
      requiredDocuments: pv.requiredDocuments,
      channels: pv.channels,
      ...(pv.locations !== undefined ? { locations: pv.locations } : {}),
      sources: taskSources,
      dataStatus: drifted && pv.dataStatus !== 'unavailable' ? 'stale' : pv.dataStatus,
      ruleVersion,
      procedureVersion: pv.version,
      // applicable/needs_confirmation を表示側へ伝える(UIの「要確認」バッジ用)。
      applicable: outcome.applicable,
      ...(outcome.warnings.length > 0 ? { warnings: outcome.warnings } : {}),
    };

    // 契約(§14.2)を出力側でも裏書き(境界での型保証)。
    return generatedTaskSchema.parse(task);
  });
}
