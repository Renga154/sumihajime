/**
 * なぜ: FR-022〜024 / CLAUDE.md原則2「公開する全タスクに承認済み公式ソースを紐付ける」の
 * 機械的強制。公開対象(procedure_versions / rule_sets)が参照する sourceId が一つでも
 * approved でなければ、publish を例外で停止する。人手レビュー(ADR-003)を経ていない
 * データが D1 に載ることを構造的に防ぐ唯一の関門。
 */

export interface SourceRef {
  /** どの公開物が参照しているか(エラーメッセージ用)。 */
  owner: string;
  sourceIds: string[];
}

export interface PublishGateInput {
  /** review_status === 'approved' の source_id 集合(registry.csv 由来)。 */
  approvedSourceIds: Set<string>;
  /** 公開する手続き・ルール等が参照する sourceId 群。 */
  references: SourceRef[];
}

export interface GateViolation {
  owner: string;
  sourceId: string;
  reason: 'not_approved';
}

export class PublishGateError extends Error {
  readonly violations: GateViolation[];
  constructor(violations: GateViolation[]) {
    const lines = violations
      .map((v) => `  - ${v.owner} references non-approved source "${v.sourceId}"`)
      .join('\n');
    super(
      `Publish gate failed: ${violations.length} reference(s) to non-approved sources. ` +
        `Only review_status=approved sources may be published (FR-022〜024).\n${lines}`,
    );
    this.name = 'PublishGateError';
    this.violations = violations;
  }
}

/**
 * なぜ: 参照 sourceId を1件ずつ approved 集合と突き合わせ、違反を全件収集してから
 * まとめて例外にする(最初の1件で止めず、レビュアが全違反を一度に把握できるように)。
 */
export function findGateViolations(input: PublishGateInput): GateViolation[] {
  const violations: GateViolation[] = [];
  for (const ref of input.references) {
    for (const sourceId of ref.sourceIds) {
      if (!input.approvedSourceIds.has(sourceId)) {
        violations.push({ owner: ref.owner, sourceId, reason: 'not_approved' });
      }
    }
  }
  return violations;
}

export function assertPublishGate(input: PublishGateInput): void {
  const violations = findGateViolations(input);
  if (violations.length > 0) {
    throw new PublishGateError(violations);
  }
}
