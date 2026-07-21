import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, parseRegistryTable, serializeRegistry } from './registry.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('registry CSV parser/serializer', () => {
  it('parses quoted cells with commas, escaped quotes, and CRLF', () => {
    const csv = 'a,b,c\r\n"x,1","y""2",z\r\n';
    expect(parseCsv(csv)).toEqual([
      ['a', 'b', 'c'],
      ['x,1', 'y"2', 'z'],
    ]);
  });

  it('quotes only cells that need it on serialize', () => {
    const table = { header: ['a', 'b'], rows: [['plain', 'has,comma']], eol: '\n' };
    expect(serializeRegistry(table)).toBe('a,b\nplain,"has,comma"\n');
  });

  it('round-trips the REAL registry.csv byte-for-byte (proves --update never corrupts untouched rows)', () => {
    // なぜ: --update は台帳を書き戻すため、対象外の行・列を1バイトも壊さないことが要件。
    // 実ファイルを読み込み(read-only)、parse -> serialize が原文と一致することを固定する。
    const original = readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8');
    const table = parseRegistryTable(original);
    // 実台帳は末尾改行の有無が環境で揺れるため、両者を末尾改行正規化して比較。
    const norm = (s: string) => (s.endsWith('\n') ? s : s + '\n');
    expect(serializeRegistry(table)).toBe(norm(original));
  });

  it('every real registry row has the same column count as the header', () => {
    const original = readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8');
    const table = parseRegistryTable(original);
    for (const row of table.rows) {
      expect(row.length).toBe(table.header.length);
    }
  });
});
