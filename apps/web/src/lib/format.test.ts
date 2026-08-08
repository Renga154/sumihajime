import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { updateFrequencyText } from './format';

/**
 * なぜ: 透明性ページの「更新頻度」列に台帳の列挙値(as_needed / annual など)が
 * そのまま出ていた(監査P2-2)。台帳に実在する値がすべて日本語になることを固定する。
 */

const here = dirname(fileURLToPath(import.meta.url));
const registryCsv = join(resolve(here, '../../../..'), 'docs/data-sources/registry.csv');

/** registry.csv の update_frequency 列に実在する値を集める。 */
function updateFrequencyValuesInRegistry(): string[] {
  const lines = readFileSync(registryCsv, 'utf8').split('\n').filter(Boolean);
  const header = lines[0]!.split(',');
  const col = header.indexOf('update_frequency');
  expect(col).toBeGreaterThanOrEqual(0);
  const values = new Set<string>();
  for (const line of lines.slice(1)) {
    // notes 列に読点を含む行があるため、先頭側の固定列だけを素朴に分割して使う。
    const cell = line.split(',')[col];
    if (cell) values.add(cell.trim());
  }
  return [...values];
}

describe('updateFrequencyText', () => {
  it('列挙値を日本語にする', () => {
    expect(updateFrequencyText('as_needed')).toBe('随時');
    expect(updateFrequencyText('annual')).toBe('年1回');
    expect(updateFrequencyText('unknown')).toBe('不明');
  });

  it('未知の値・既に日本語の値はそのまま返す(勝手に言い換えない)', () => {
    expect(updateFrequencyText('年度更新')).toBe('年度更新');
    expect(updateFrequencyText('毎月第2水曜')).toBe('毎月第2水曜');
  });

  it('台帳に実在する値がすべて英字のまま残らない', () => {
    const values = updateFrequencyValuesInRegistry();
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      expect(updateFrequencyText(v), `更新頻度 "${v}" が未翻訳`).not.toMatch(/^[a-z_-]+$/i);
    }
  });
});
