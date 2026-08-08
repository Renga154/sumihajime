import { describe, expect, it } from 'vitest';
import { orderByDocumentPosition } from './order.js';

interface C {
  sourceId: string;
  seq: number;
}
const ids = (cs: C[]) => cs.map((c) => `${c.sourceId}#${c.seq}`);

describe('orderByDocumentPosition', () => {
  it('同一文書内の節を原文順(seq昇順)へ戻す', () => {
    const input: C[] = [
      { sourceId: 'a', seq: 5 },
      { sourceId: 'a', seq: 1 },
      { sourceId: 'a', seq: 3 },
    ];
    expect(ids(orderByDocumentPosition(input))).toEqual(['a#1', 'a#3', 'a#5']);
  });

  it('文書の順序は初出順(=検索スコア順)を保つ', () => {
    const input: C[] = [
      { sourceId: 'b', seq: 4 },
      { sourceId: 'a', seq: 9 },
      { sourceId: 'b', seq: 2 },
      { sourceId: 'a', seq: 0 },
    ];
    // b が先に現れたので b グループが先。各グループ内は seq 昇順。
    expect(ids(orderByDocumentPosition(input))).toEqual(['b#2', 'b#4', 'a#0', 'a#9']);
  });

  it('入力を破壊しない', () => {
    const input: C[] = [
      { sourceId: 'a', seq: 2 },
      { sourceId: 'a', seq: 1 },
    ];
    orderByDocumentPosition(input);
    expect(ids(input)).toEqual(['a#2', 'a#1']);
  });

  it('空配列・単一要素で壊れない', () => {
    expect(orderByDocumentPosition([])).toEqual([]);
    expect(ids(orderByDocumentPosition([{ sourceId: 'a', seq: 7 }]))).toEqual(['a#7']);
  });
});
