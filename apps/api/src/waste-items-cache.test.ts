import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchWasteSortingItems } from './db.js';

/**
 * 品目一覧の isolate 内キャッシュ(db.ts の loadIndexedWasteItems)。
 * 検索語を変えても D1 の全件読みが毎回は起きないこと(読み取り枠の消費を抑える)と、
 * 別の DB・別の自治体・期限切れでは使い回さないこと(誤った結果を返さない)を確かめる。
 */

function fakeDb(rows: Record<string, unknown>[]) {
  const all = vi.fn(() => Promise.resolve({ results: rows }));
  const db = {
    prepare: vi.fn(() => ({ bind: vi.fn(() => ({ all })) })),
  } as unknown as D1Database;
  return { db, all };
}

const row = (itemId: string, code: string, name: string, reading?: string) => ({
  item_id: itemId,
  municipality_code: code,
  name,
  reading: reading ?? null,
  category: '可燃ごみ',
  notes: null,
  fee_note: null,
  source_id: `src-${code}-waste_sorting-001`,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('searchWasteSortingItems の品目キャッシュ', () => {
  it('同じ DB・同じ自治体なら、検索語を変えても D1 の全件読みは1回だけ', async () => {
    const { db, all } = fakeDb([
      row('a', '13112', 'スプレー缶', 'すぷれーかん'),
      row('b', '13112', 'ノート'),
    ]);
    const first = await searchWasteSortingItems(db, '13112', 'スプレー');
    const second = await searchWasteSortingItems(db, '13112', 'ノート');
    const third = await searchWasteSortingItems(db, '13112', 'すぷれ');
    expect(first.items.map((i) => i.itemId)).toEqual(['a']);
    expect(second.items.map((i) => i.itemId)).toEqual(['b']);
    expect(third.items.map((i) => i.itemId)).toEqual(['a']);
    expect(all).toHaveBeenCalledTimes(1);
  });

  it('別の DB(別環境・別テスト)や別の自治体の結果を使い回さない', async () => {
    const a = fakeDb([row('a', '13112', 'スプレー缶')]);
    const b = fakeDb([row('z', '13113', 'スプレー缶')]);
    expect((await searchWasteSortingItems(a.db, '13112', 'スプレー')).items[0]?.itemId).toBe('a');
    expect((await searchWasteSortingItems(b.db, '13113', 'スプレー')).items[0]?.itemId).toBe('z');
    // 同じ DB でも自治体が違えば読み直す(原則4: 自治体の情報を混ぜない)。
    await searchWasteSortingItems(a.db, '13113', 'スプレー');
    expect(a.all).toHaveBeenCalledTimes(2);
  });

  it('5分を過ぎたら読み直す(publish の反映は最大5分遅れ)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T00:00:00Z'));
    const { db, all } = fakeDb([row('a', '13112', 'スプレー缶')]);
    await searchWasteSortingItems(db, '13112', 'スプレー');
    vi.setSystemTime(new Date('2026-10-02T00:04:59Z'));
    await searchWasteSortingItems(db, '13112', 'スプレー');
    expect(all).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-10-02T00:05:01Z'));
    await searchWasteSortingItems(db, '13112', 'スプレー');
    expect(all).toHaveBeenCalledTimes(2);
  });
});
