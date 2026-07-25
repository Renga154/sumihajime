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

  it('40問・正答28/保留7/越境5・自治体整合を満たす', () => {
    const dataset = parseDataset(raw);
    expect(() => assertDatasetShape(dataset)).not.toThrow();
  });

  it('正答系の自治体配分は 世田谷7 / 江東7 / 新宿6 / 杉並4 / 千代田4', () => {
    const dataset = parseDataset(raw);
    const pos = dataset.cases.filter((c) => c.kind === 'positive');
    const count = (code: string) => pos.filter((c) => c.municipalityCode === code).length;
    expect(count('13112')).toBe(7);
    expect(count('13108')).toBe(7);
    expect(count('13104')).toBe(6);
    expect(count('13115')).toBe(4);
    expect(count('13101')).toBe(4);
  });

  it('保留系・越境系は expectedSourceIds を持たない(機械採点の前提)', () => {
    const dataset = parseDataset(raw);
    for (const c of dataset.cases.filter((c) => c.kind !== 'positive')) {
      expect(c.expect.expectedSourceIds).toHaveLength(0);
    }
  });
});
