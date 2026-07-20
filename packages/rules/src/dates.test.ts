import { afterEach, describe, expect, it } from 'vitest';
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
      resolveDueRule({ type: 'offsetDays', from: 'moveDate', days: 14 }, '2026-08-01'),
    ).toEqual({ dueDate: '2026-08-15' });
  });

  it('resolves an unknown due rule to no dueDate (falls back to dueDescription upstream)', () => {
    expect(resolveDueRule({ type: 'unknown' }, '2026-08-01')).toEqual({});
  });
});
