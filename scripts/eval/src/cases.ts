import { z } from 'zod';
import { orderedQuestionCategories } from '@tmn/rag';
import type { EvalCase, EvalDataset } from './types.js';

/**
 * なぜ: データセットJSONは人手で編集するため、実行前にZodで形状を固定して壊れた期待値
 * (存在しないキー/型ズレ)を早期に弾く(CLAUDE.md §4 入力のスキーマ検証)。
 */

const abstainExpectation = z.union([z.boolean(), z.literal('either')]);

const caseExpectSchema = z.strictObject({
  abstain: abstainExpectation,
  expectedSourceIds: z.array(z.string()),
  answerMustInclude: z.array(z.string()),
  forbiddenSourcePrefixes: z.array(z.string()),
});

const evalCaseSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(['positive', 'abstain', 'cross']),
  municipalityCode: z.string().regex(/^\d{5}$/),
  question: z.string().min(1),
  expect: caseExpectSchema,
  rationale: z.string().min(1),
});

const datasetSchema = z.strictObject({
  datasetVersion: z.string().min(1),
  generatedFor: z.string().min(1),
  description: z.string().min(1),
  corpus: z.strictObject({
    municipalities: z.array(z.string()),
    indexedSourceType: z.string(),
    note: z.string(),
  }),
  scoring: z.record(z.string(), z.string()),
  cases: z.array(evalCaseSchema),
});

export function parseDataset(raw: unknown): EvalDataset {
  const parsed = datasetSchema.parse(raw);
  return parsed as EvalDataset;
}

/** 1文で複数の手続きを尋ねる「複合質問」ケースの id に付ける印。 */
const COMPOUND_ID_MARKER = '-compound-';
/** 複合質問の最低数。単一トピックだけの評価へ戻らないための下限。 */
const MIN_COMPOUND_CASES = 4;

/** 正答系146/保留系17/越境系16・自治体整合を軽く健全性チェック(23区対応 v2.2)。 */
export function assertDatasetShape(dataset: EvalDataset): void {
  const cases: EvalCase[] = dataset.cases;
  if (cases.length !== 179) throw new Error(`expected 179 cases, got ${cases.length}`);
  const ids = new Set(cases.map((c) => c.id));
  if (ids.size !== cases.length) throw new Error('duplicate case ids');
  const byKind = (k: string) => cases.filter((c) => c.kind === k).length;
  if (byKind('positive') !== 146)
    throw new Error(`expected 146 positive, got ${byKind('positive')}`);
  if (byKind('abstain') !== 17) throw new Error(`expected 17 abstain, got ${byKind('abstain')}`);
  if (byKind('cross') !== 16) throw new Error(`expected 16 cross, got ${byKind('cross')}`);
  // なぜ: v2.1.1 までの175問はすべて単一トピックだったため、「1文で2つ聞かれて片方を無言で落とす」
  // 欠陥を評価が一度も踏めなかった(本番実測 2026-08-08 / 世田谷)。評価が現実より易しい問題を解いて
  // いる状態へ戻らないよう、複合質問の存在をデータセット段階で強制する。
  const compound = cases.filter((c) => c.id.includes(COMPOUND_ID_MARKER));
  if (compound.length < MIN_COMPOUND_CASES) {
    throw new Error(
      `expected at least ${MIN_COMPOUND_CASES} compound cases (id contains "${COMPOUND_ID_MARKER}"), got ${compound.length}`,
    );
  }
  for (const c of compound) {
    // 印だけ付いていて実際は単一トピック、という骨抜きを防ぐ。判定は本番と同じ決定論的関数を使う。
    const categories = orderedQuestionCategories(c.question);
    if (categories.length < 2) {
      throw new Error(
        `compound case ${c.id} asks only ${categories.length} procedure(s): ${categories.join(', ') || '(none)'}`,
      );
    }
    // 尋ねた手続きが2つ以上あるなら、期待キーフレーズも2つ以上必要(片方しか見ない期待値にしない)。
    if (c.expect.answerMustInclude.length < 2) {
      throw new Error(`compound case ${c.id} must assert a phrase per asked topic`);
    }
  }
  // なぜ: v1.2.0にあった書類系のケースが23区化(v2.0.0)で全て失われ、UIのプレースホルダそのものの
  // 質問(必要な持ち物)が未計測になっていた。同じ回帰を二度起こさないよう、
  // **全対応区に必要書類のケースがあること**をデータセット段階で強制する(ADR-010)。
  for (const code of dataset.corpus.municipalities) {
    const hasDocumentCase = cases.some(
      (c) => c.municipalityCode === code && c.id.endsWith('-resident-documents'),
    );
    if (!hasDocumentCase) throw new Error(`municipality ${code} has no required-documents case`);
  }
  // なぜ: 23区展開の目的は「どの区でも品質を測れること」。1区でも実質未検証(3問未満)なら、
  // その区は評価されていないのと同じなので、データセット段階で落とす(CLAUDE.md原則9)。
  for (const code of dataset.corpus.municipalities) {
    const n = cases.filter((c) => c.municipalityCode === code).length;
    if (n < 3) throw new Error(`municipality ${code} has only ${n} cases (min 3)`);
  }
  for (const c of cases) {
    if (c.kind === 'positive' && c.expect.expectedSourceIds.length === 0) {
      throw new Error(`positive case ${c.id} must have expectedSourceIds`);
    }
    // 正答系の期待出典は自区の接頭辞でなければならない(データセット自身の自治体整合)。
    for (const sid of c.expect.expectedSourceIds) {
      if (!sid.startsWith(`src-${c.municipalityCode}-`)) {
        throw new Error(
          `case ${c.id}: expectedSourceId ${sid} not in municipality ${c.municipalityCode}`,
        );
      }
    }
  }
}
