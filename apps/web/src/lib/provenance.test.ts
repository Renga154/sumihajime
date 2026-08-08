import { describe, expect, it } from 'vitest';
import type { SourceLedgerEntry } from '@tmn/schemas';
import {
  freshnessBucketOf,
  jstDateString,
  latestVerifiedDate,
  summarizeFreshness,
} from './provenance';

/**
 * なぜ: 鮮度サマリーは来歴ダッシュボードの中核表示であり、日付計算(JST基準日・経過日数・
 * 残日数)の境界条件を純関数テストで固定する(§8 期限計算・§7 TZ明示)。
 */

function entry(over: Partial<SourceLedgerEntry>): SourceLedgerEntry {
  return {
    sourceId: 'src-x',
    sourceTitle: 'タイトル',
    ownerOrganization: '世田谷区',
    municipalityCode: '13112',
    category: 'waste_schedule',
    sourceUrl: 'https://example.gov/x',
    sourceType: 'csv',
    license: 'CC BY 4.0',
    attributionText: '出典: 世田谷区',
    lastVerifiedAt: '2026-07-21T00:00:00Z',
    updateFrequency: '随時',
    ...over,
  };
}

describe('jstDateString', () => {
  it('UTC 14:30 は JST 同日(23:30)', () => {
    expect(jstDateString(new Date('2026-07-23T14:30:00Z'))).toBe('2026-07-23');
  });

  it('UTC 15:30 は JST 翌日(00:30) — 日付境界が +9h でずれる', () => {
    expect(jstDateString(new Date('2026-07-23T15:30:00Z'))).toBe('2026-07-24');
  });
});

describe('freshnessBucketOf', () => {
  it('境界: 0/7日以内は within7', () => {
    expect(freshnessBucketOf(0)).toBe('within7');
    expect(freshnessBucketOf(7)).toBe('within7');
  });
  it('境界: 8〜30日は within30', () => {
    expect(freshnessBucketOf(8)).toBe('within30');
    expect(freshnessBucketOf(30)).toBe('within30');
  });
  it('境界: 31日以上は older', () => {
    expect(freshnessBucketOf(31)).toBe('older');
  });
  it('未来日(負値)は最新扱い(within7)', () => {
    expect(freshnessBucketOf(-3)).toBe('within7');
  });
});

describe('summarizeFreshness', () => {
  const today = '2026-07-23';

  it('経過日数を3バケツへ振り分ける', () => {
    const s = summarizeFreshness(
      [
        entry({ sourceId: 'a', lastVerifiedAt: '2026-07-20T00:00:00Z', effectiveTo: undefined }), // 3日
        entry({ sourceId: 'b', lastVerifiedAt: '2026-07-01T00:00:00Z', effectiveTo: undefined }), // 22日
        entry({ sourceId: 'c', lastVerifiedAt: '2026-05-01T00:00:00Z', effectiveTo: undefined }), // 83日
      ],
      today,
    );
    expect(s.total).toBe(3);
    expect(s.within7).toBe(1);
    expect(s.within30).toBe(1);
    expect(s.older).toBe(1);
    expect(s.unknown).toBe(0);
    expect(s.yearData).toEqual([]);
  });

  it('lastVerifiedAt が無いソースは unknown に数え、バケツからは除外する', () => {
    const s = summarizeFreshness(
      [entry({ lastVerifiedAt: undefined, effectiveTo: undefined })],
      today,
    );
    expect(s.unknown).toBe(1);
    expect(s.within7 + s.within30 + s.older).toBe(0);
    expect(s.total).toBe(1);
  });

  it('年度データの残日数を算出し、少ない順(失効が近い順)に並べる', () => {
    const s = summarizeFreshness(
      [
        entry({ sourceId: 'far', effectiveTo: '2027-03-31' }),
        entry({ sourceId: 'near', effectiveTo: '2026-08-01' }),
      ],
      today,
    );
    expect(s.yearData.map((y) => y.sourceId)).toEqual(['near', 'far']);
    // 2026-07-23 → 2027-03-31 は 251日。
    const far = s.yearData.find((y) => y.sourceId === 'far')!;
    expect(far.daysRemaining).toBe(251);
    expect(far.expired).toBe(false);
    // 2026-07-23 → 2026-08-01 は 9日。
    expect(s.yearData.find((y) => y.sourceId === 'near')!.daysRemaining).toBe(9);
  });

  it('effectiveTo が基準日より過去なら expired=true(残日数は負)', () => {
    const s = summarizeFreshness([entry({ sourceId: 'old', effectiveTo: '2026-03-31' })], today);
    const y = s.yearData[0]!;
    expect(y.expired).toBe(true);
    expect(y.daysRemaining).toBeLessThan(0);
  });
});

/**
 * なぜ: 透明性ページ冒頭の要約に出す「最終更新日」。台帳全体で最も新しい最終確認日を
 * 代表させるため、欠損・不正値を混ぜても壊れないことを固定する。
 */
describe('latestVerifiedDate', () => {
  it('最も新しい最終確認日(暦日)を返す', () => {
    expect(
      latestVerifiedDate([
        entry({ sourceId: 'a', lastVerifiedAt: '2026-07-21T00:00:00Z' }),
        entry({ sourceId: 'b', lastVerifiedAt: '2026-08-01T09:00:00Z' }),
        entry({ sourceId: 'c', lastVerifiedAt: '2026-06-30T00:00:00Z' }),
      ]),
    ).toBe('2026-08-01');
  });

  it('1件も無い/最終確認日が無い/不正な値なら null', () => {
    expect(latestVerifiedDate([])).toBeNull();
    expect(latestVerifiedDate([entry({ lastVerifiedAt: '' })])).toBeNull();
    expect(latestVerifiedDate([entry({ lastVerifiedAt: 'not-a-date' })])).toBeNull();
  });

  it('解釈できる値だけを対象にする(不正値が混ざっても落とさない)', () => {
    expect(
      latestVerifiedDate([
        entry({ sourceId: 'bad', lastVerifiedAt: 'not-a-date' }),
        entry({ sourceId: 'ok', lastVerifiedAt: '2026-07-21T00:00:00Z' }),
      ]),
    ).toBe('2026-07-21');
  });
});
