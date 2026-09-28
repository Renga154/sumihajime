import { describe, expect, it } from 'vitest';
import { daysBetween, tokyoToday } from './date.js';

describe('tokyoToday — JST基準の暦日', () => {
  it('UTC日付が変わる前でもJSTでは翌日になる境界を跨ぐ', () => {
    // 2026-09-22T15:30:00Z = 2026-09-23T00:30:00+09:00(JST日付は既に23日)。
    expect(tokyoToday(new Date('2026-09-22T15:30:00Z'))).toBe('2026-09-23');
  });

  it('JST日付が変わる直前はまだ前日のまま', () => {
    // 2026-09-22T14:59:00Z = 2026-09-22T23:59:00+09:00(JST日付はまだ22日)。
    expect(tokyoToday(new Date('2026-09-22T14:59:00Z'))).toBe('2026-09-22');
  });
});

describe('daysBetween — YYYY-MM-DD間の日数差', () => {
  it('未来日は正の日数を返す', () => {
    expect(daysBetween('2026-09-01', '2026-09-10')).toBe(9);
  });

  it('過去日は負の日数を返す', () => {
    expect(daysBetween('2026-09-10', '2026-09-01')).toBe(-9);
  });

  it('同日は0', () => {
    expect(daysBetween('2026-09-10', '2026-09-10')).toBe(0);
  });

  it('不正な日付はNaN', () => {
    expect(Number.isNaN(daysBetween('not-a-date', '2026-09-10'))).toBe(true);
    expect(Number.isNaN(daysBetween('2026-09-10', 'not-a-date'))).toBe(true);
  });
});
