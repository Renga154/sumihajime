import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDataset, assertDatasetShape } from './cases.js';

/**
 * なぜ: 実データセット(data/evaluations/rag-eval-cases.json)が常に構造・配分・自治体整合を
 * 満たすことをCIで固定する。期待出典が自区の src- 接頭辞に一致することも検証する。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

describe('rag-eval-cases.json', () => {
  const raw = JSON.parse(
    readFileSync(resolve(repoRoot, 'data/evaluations/rag-eval-cases.json'), 'utf-8'),
  );

  it('Zodスキーマを満たす', () => {
    expect(() => parseDataset(raw)).not.toThrow();
  });

  it('151問・正答119/保留17/越境15・自治体整合を満たす', () => {
    const dataset = parseDataset(raw);
    expect(() => assertDatasetShape(dataset)).not.toThrow();
  });

  it('23区すべてを各区3問以上でカバーする', () => {
    const dataset = parseDataset(raw);
    expect(dataset.corpus.municipalities).toHaveLength(23);
    for (const code of dataset.corpus.municipalities) {
      const n = dataset.cases.filter((c) => c.municipalityCode === code).length;
      expect(n, `municipality ${code}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('区ごとに異なる期限を突く問題を含む(子ども医療費の遡及期限が区で異なることの回帰ガード)', () => {
    const dataset = parseDataset(raw);
    const phrases = new Set(
      dataset.cases
        .filter((c) => c.id.includes('child-medical') && c.kind === 'positive')
        .flatMap((c) => c.expect.answerMustInclude),
    );
    // 14日 / 15日 / 2か月 / 3か月 / 3ヶ月 / 3カ月 / 6か月 / 6カ月 のように複数の期限表記が並ぶ。
    const deadlinePhrases = [...phrases].filter((p) => /^\d/.test(p));
    expect(deadlinePhrases.length).toBeGreaterThanOrEqual(5);
  });

  it('原文に期限の記載が無い区は保留系に置く(他区の期限を答えたら重大な失敗)', () => {
    const dataset = parseDataset(raw);
    const noDeadlineAbstain = dataset.cases.filter(
      (c) => c.kind === 'abstain' && /no-90day|no-deadline/.test(c.id),
    );
    expect(noDeadlineAbstain.length).toBeGreaterThanOrEqual(5);
    for (const c of noDeadlineAbstain) expect(c.expect.abstain).toBe(true);
  });

  it('保留系・越境系は expectedSourceIds を持たない(機械採点の前提)', () => {
    const dataset = parseDataset(raw);
    for (const c of dataset.cases.filter((c) => c.kind !== 'positive')) {
      expect(c.expect.expectedSourceIds).toHaveLength(0);
    }
  });
});
