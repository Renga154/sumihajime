/**
 * なぜ: FR-022〜024 / CLAUDE.md原則2「公開する全タスクに承認済み公式ソースを紐付ける」の
 * 機械的強制。公開対象(procedure_versions / rule_sets)が参照する sourceId が一つでも
 * approved でなければ、publish を例外で停止する。人手レビュー(ADR-003)を経ていない
 * データが D1 に載ることを構造的に防ぐ唯一の関門。
 *
 * 2026-10-02: CLAUDE.md原則4「選択自治体と異なる自治体の情報を混ぜない」も同じ関門で強制する。
 * 自治体Xの公開物が、別の区市町村(municipalityCode が X 以外)のソースを根拠に引いていたら止める。
 * 都道府県・国のソース(コードの下3桁が 000。13000=東京都、00000=国・全国組織)はどの自治体の
 * 公開物から引いてもよい(水道・郵便転居など、区をまたいで共通の手続きの根拠)。
 */

export interface SourceRef {
  /** どの公開物が参照しているか(エラーメッセージ用)。 */
  owner: string;
  /** 参照している公開物が属する自治体コード(その自治体の画面・API に出る)。 */
  municipalityCode: string;
  sourceIds: string[];
}

export interface PublishGateInput {
  /** review_status === 'approved' の source_id 集合(registry.csv 由来)。 */
  approvedSourceIds: Set<string>;
  /**
   * source_id → 台帳の municipality_code(registry.csv の全行。自治体に紐付かないソースは undefined)。
   * なぜ必須か: 省略できると自治体の混在検査が呼び出し側の付け忘れで静かに外れる。
   */
  sourceMunicipalities: ReadonlyMap<string, string | undefined>;
  /** 公開する手続き・ルール等が参照する sourceId 群。 */
  references: SourceRef[];
}

export type GateViolationReason = 'not_approved' | 'municipality_mismatch';

export interface GateViolation {
  owner: string;
  sourceId: string;
  reason: GateViolationReason;
  /** municipality_mismatch のとき: 公開物の自治体とソースの自治体。 */
  ownerMunicipalityCode?: string;
  sourceMunicipalityCode?: string;
}

function describeViolation(v: GateViolation): string {
  if (v.reason === 'municipality_mismatch') {
    return (
      `  - ${v.owner} (municipality ${v.ownerMunicipalityCode}) cites source "${v.sourceId}" ` +
      `of another municipality (${v.sourceMunicipalityCode})`
    );
  }
  return `  - ${v.owner} references non-approved source "${v.sourceId}"`;
}

export class PublishGateError extends Error {
  readonly violations: GateViolation[];
  constructor(violations: GateViolation[]) {
    const lines = violations.map(describeViolation).join('\n');
    super(
      `Publish gate failed: ${violations.length} violation(s). ` +
        `Only review_status=approved sources may be published (FR-022〜024), and a ` +
        `municipality's items may cite only its own, Tokyo-wide or national sources ` +
        `(CLAUDE.md principle 4).\n${lines}`,
    );
    this.name = 'PublishGateError';
    this.violations = violations;
  }
}

/** 都道府県・国レベルのコード(下3桁が 000)。どの自治体の公開物から引いてもよい。 */
export function isPrefectureOrNationalCode(code: string): boolean {
  return /^\d{2}000$/.test(code);
}

/**
 * なぜ: 参照 sourceId を1件ずつ approved 集合・自治体と突き合わせ、違反を全件収集してから
 * まとめて例外にする(最初の1件で止めず、レビュアが全違反を一度に把握できるように)。
 */
export function findGateViolations(input: PublishGateInput): GateViolation[] {
  const violations: GateViolation[] = [];
  for (const ref of input.references) {
    for (const sourceId of ref.sourceIds) {
      if (!input.approvedSourceIds.has(sourceId)) {
        violations.push({ owner: ref.owner, sourceId, reason: 'not_approved' });
        continue;
      }
      const sourceCode = input.sourceMunicipalities.get(sourceId);
      if (
        sourceCode !== undefined &&
        sourceCode !== ref.municipalityCode &&
        !isPrefectureOrNationalCode(sourceCode)
      ) {
        violations.push({
          owner: ref.owner,
          sourceId,
          reason: 'municipality_mismatch',
          ownerMunicipalityCode: ref.municipalityCode,
          sourceMunicipalityCode: sourceCode,
        });
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
