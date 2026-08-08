import { afterEach, describe, expect, it } from 'vitest';
import type { DueRule } from '@tmn/schemas';
import { addCalendarDays, resolveDueRule } from './dates.js';

describe('addCalendarDays', () => {
  it('adds 14 days within the same month (resident registration deadline, normal case)', () => {
    expect(addCalendarDays('2026-08-01', 14)).toBe('2026-08-15');
  });

  it('adds 15 days crossing a month-end (child allowance special deadline)', () => {
    expect(addCalendarDays('2026-08-20', 15)).toBe('2026-09-04');
  });

  it('adds 90 days crossing multiple months (mynumber card continued-use deadline)', () => {
    expect(addCalendarDays('2026-08-01', 90)).toBe('2026-10-30');
  });

  it('handles a February non-leap-year month-end crossing (2026-02-28 + 3 days)', () => {
    // 2026年は閏年ではない(2月は28日まで)。
    expect(addCalendarDays('2026-02-28', 3)).toBe('2026-03-03');
  });

  it('handles a leap-year February 29 crossing (2028-02-29 + 1 day)', () => {
    // 2028年は閏年(2月29日が存在する)。
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addCalendarDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('handles a year-end crossing (December 31 + offset)', () => {
    expect(addCalendarDays('2026-12-20', 14)).toBe('2027-01-03');
  });

  it('supports offset 0 (boundary: due date equals move date)', () => {
    expect(addCalendarDays('2026-08-01', 0)).toBe('2026-08-01');
  });

  it('rejects a malformed date string', () => {
    expect(() => addCalendarDays('2026/08/01', 1)).toThrow();
  });

  it('rejects a calendar-invalid date (February 30 does not exist)', () => {
    expect(() => addCalendarDays('2026-02-30', 1)).toThrow();
  });
});

describe('addCalendarDays — local timezone independence', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  });

  it('returns the same result regardless of the process local timezone', () => {
    const cases: Array<[string, number]> = [
      ['2026-08-01', 14],
      ['2026-08-20', 15],
      ['2026-08-01', 90],
      ['2026-02-28', 3],
      ['2028-02-28', 1],
      ['2026-12-20', 14],
    ];
    const timezones = ['UTC', 'Asia/Tokyo', 'America/New_York', 'Pacific/Kiritimati'];

    const baseline = cases.map(([iso, days]) => addCalendarDays(iso, days));

    for (const tz of timezones) {
      process.env.TZ = tz;
      const result = cases.map(([iso, days]) => addCalendarDays(iso, days));
      expect(result).toEqual(baseline);
    }
  });
});

describe('resolveDueRule', () => {
  it('resolves an offsetDays due rule to a concrete ISO date (normal case)', () => {
    expect(
      resolveDueRule(
        { type: 'offsetDays', from: 'moveDate', days: 14 },
        { moveDate: '2026-08-01' },
      ),
    ).toEqual({ dueDate: '2026-08-15' });
  });

  it('resolves an unknown due rule to no dueDate (falls back to dueDescription upstream)', () => {
    expect(resolveDueRule({ type: 'unknown' }, { moveDate: '2026-08-01' })).toEqual({});
  });
});

/**
 * なぜ: 児童手当の15日特例は多くの区が「前住所地の転出予定日の翌日から15日以内」と明記している。
 * 転出予定日は任意入力のため、未入力のときに引越し日で代用してはならない(区が言っていない日付になる)。
 * 「入力があれば算定する / 無ければ算定しない」の両方を境界ごと固定する。
 */
describe('resolveDueRule — 前住所地の転出予定日を起算日にする場合', () => {
  const RULE = { type: 'offsetDays', from: 'moveOutScheduledDate', days: 15 } as const;

  it('転出予定日の入力があれば、その日から算定する(引越し日は使わない)', () => {
    expect(
      resolveDueRule(RULE, { moveDate: '2026-08-01', moveOutScheduledDate: '2026-07-28' }),
    ).toEqual({ dueDate: '2026-08-12' });
  });

  it('転出予定日が未入力なら期日を算定しない(引越し日で代用しない)', () => {
    expect(resolveDueRule(RULE, { moveDate: '2026-08-01' })).toEqual({});
  });

  it('月末をまたぐ(8/20 + 15日 = 9/4)', () => {
    expect(
      resolveDueRule(RULE, { moveDate: '2026-09-01', moveOutScheduledDate: '2026-08-20' }),
    ).toEqual({ dueDate: '2026-09-04' });
  });

  it('年をまたぐ(12/25 + 15日 = 翌年1/9)', () => {
    expect(
      resolveDueRule(RULE, { moveDate: '2027-01-05', moveOutScheduledDate: '2026-12-25' }),
    ).toEqual({ dueDate: '2027-01-09' });
  });

  it('閏日をまたぐ(2028-02-20 + 15日 = 3/6。2/29が存在する年)', () => {
    expect(
      resolveDueRule(RULE, { moveDate: '2028-03-01', moveOutScheduledDate: '2028-02-20' }),
    ).toEqual({ dueDate: '2028-03-06' });
  });

  it('閏年でない2月末をまたぐ(2026-02-20 + 15日 = 3/7)', () => {
    expect(
      resolveDueRule(RULE, { moveDate: '2026-03-01', moveOutScheduledDate: '2026-02-20' }),
    ).toEqual({ dueDate: '2026-03-07' });
  });
});

/**
 * なぜ: マイナンバーカードの継続利用は、区が複数の失効条件を並べている(例: 板橋区
 * 「住み始めた日から14日以内 または 転出予定日から30日以内のどちらか早い期日まで」)。
 * 遅いほうを出すと、実際の期限を過ぎてからカードが失効したと知ることになる。
 */
describe('resolveDueRule — earliestOf(区が並べた条件のうち最も早い日)', () => {
  const RULE: DueRule = {
    type: 'earliestOf',
    of: [
      { type: 'offsetDays', from: 'moveDate', days: 14 },
      { type: 'offsetDays', from: 'moveOutScheduledDate', days: 30 },
    ],
  };

  it('両方算定できるとき、早いほうを採る(転出予定日側が早い場合)', () => {
    // 引越し日 2026-08-01 +14 = 8/15、転出予定日 2026-07-01 +30 = 7/31 → 7/31。
    expect(
      resolveDueRule(RULE, { moveDate: '2026-08-01', moveOutScheduledDate: '2026-07-01' }),
    ).toEqual({ dueDate: '2026-07-31' });
  });

  it('両方算定できるとき、早いほうを採る(引越し日側が早い場合)', () => {
    // 引越し日 2026-08-01 +14 = 8/15、転出予定日 2026-07-28 +30 = 8/27 → 8/15。
    expect(
      resolveDueRule(RULE, { moveDate: '2026-08-01', moveOutScheduledDate: '2026-07-28' }),
    ).toEqual({ dueDate: '2026-08-15' });
  });

  it('同じ日になるときも1つの日付を返す(境界)', () => {
    // 引越し日 2026-08-01 +14 = 8/15、転出予定日 2026-07-16 +30 = 8/15。
    expect(
      resolveDueRule(RULE, { moveDate: '2026-08-01', moveOutScheduledDate: '2026-07-16' }),
    ).toEqual({ dueDate: '2026-08-15' });
  });

  it('転出予定日が未入力なら、算定できる条件だけで決める', () => {
    expect(resolveDueRule(RULE, { moveDate: '2026-08-01' })).toEqual({ dueDate: '2026-08-15' });
  });

  it('算定できる条件が1つも無ければ期日を出さない', () => {
    const onlyMoveOut: DueRule = {
      type: 'earliestOf',
      of: [
        { type: 'offsetDays', from: 'moveOutScheduledDate', days: 30 },
        { type: 'offsetDays', from: 'moveOutScheduledDate', days: 14 },
      ],
    };
    expect(resolveDueRule(onlyMoveOut, { moveDate: '2026-08-01' })).toEqual({});
  });

  it('年をまたぐ候補どうしでも早いほうを選べる', () => {
    // 引越し日 2026-12-25 +14 = 2027-01-08、転出予定日 2026-12-01 +30 = 2026-12-31 → 12/31。
    expect(
      resolveDueRule(RULE, { moveDate: '2026-12-25', moveOutScheduledDate: '2026-12-01' }),
    ).toEqual({ dueDate: '2026-12-31' });
  });
});
