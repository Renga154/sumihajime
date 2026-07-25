import { z } from 'zod';
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

/** 正答系28/保留系7/越境系5・自治体整合を軽く健全性チェック(5区対応 v1.1)。 */
export function assertDatasetShape(dataset: EvalDataset): void {
  const cases: EvalCase[] = dataset.cases;
  if (cases.length !== 40) throw new Error(`expected 40 cases, got ${cases.length}`);
  const ids = new Set(cases.map((c) => c.id));
  if (ids.size !== cases.length) throw new Error('duplicate case ids');
  const byKind = (k: string) => cases.filter((c) => c.kind === k).length;
  if (byKind('positive') !== 28) throw new Error(`expected 28 positive, got ${byKind('positive')}`);
  if (byKind('abstain') !== 7) throw new Error(`expected 7 abstain, got ${byKind('abstain')}`);
  if (byKind('cross') !== 5) throw new Error(`expected 5 cross, got ${byKind('cross')}`);
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
