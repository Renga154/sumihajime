import { describe, expect, it } from 'vitest';
import {
  isMoveDateWithinRange,
  isOverdue,
  moveDateBounds,
  moveDateRangeMessage,
  overdueDays,
  todayInTokyo,
} from './move-date';

/**
 * なぜ: 期限判定と入力範囲の境界を固定する(CLAUDE.md §8「期限計算」「境界条件」)。
 * 基準日は Asia/Tokyo の暦日で決まることを、UTC日付が前日になる時刻で確認する。
 */

describe('todayInTokyo', () => {
  it('日本時間の暦日を返す(UTCでは前日になる時刻でも当日)', () => {
    // 2026-08-08T16:00Z = 2026-08-09 01:00 JST。
    expect(todayInTokyo(new Date('2026-08-08T16:00:00Z'))).toBe('2026-08-09');
  });

  it('日本時間の日付が変わる直前は前日のまま', () => {
    // 2026-08-08T14:59Z = 2026-08-08 23:59 JST。
    expect(todayInTokyo(new Date('2026-08-08T14:59:00Z'))).toBe('2026-08-08');
  });
});

describe('moveDateBounds / isMoveDateWithinRange', () => {
  const today = '2026-08-08';

  it('前後1年を受付範囲にする', () => {
    expect(moveDateBounds(today)).toEqual({ min: '2025-08-08', max: '2027-08-08' });
  });

  it('境界値は受け付ける', () => {
    expect(isMoveDateWithinRange('2025-08-08', today)).toBe(true);
    expect(isMoveDateWithinRange('2027-08-08', today)).toBe(true);
  });

  it('境界の外側は受け付けない', () => {
    expect(isMoveDateWithinRange('2025-08-07', today)).toBe(false);
    expect(isMoveDateWithinRange('2027-08-09', today)).toBe(false);
  });

  it('1900年のような極端な値を弾く(監査P1-5の再現ケース)', () => {
    expect(isMoveDateWithinRange('1900-01-01', today)).toBe(false);
  });

  it('空文字・書式違い・存在しない日付を弾く', () => {
    expect(isMoveDateWithinRange('', today)).toBe(false);
    expect(isMoveDateWithinRange('2026/08/08', today)).toBe(false);
    expect(isMoveDateWithinRange('2026-02-30', today)).toBe(false);
  });

  it('範囲の説明文に具体的な日付を含む', () => {
    expect(moveDateRangeMessage(today)).toContain('2025-08-08');
    expect(moveDateRangeMessage(today)).toContain('2027-08-08');
  });
});

describe('isOverdue / overdueDays', () => {
  const today = '2026-08-08';

  it('期限が当日なら超過ではない', () => {
    expect(isOverdue('2026-08-08', today)).toBe(false);
    expect(overdueDays('2026-08-08', today)).toBe(0);
  });

  it('期限が前日なら超過(1日)', () => {
    expect(isOverdue('2026-08-07', today)).toBe(true);
    expect(overdueDays('2026-08-07', today)).toBe(1);
  });

  it('未来の期限は超過ではない', () => {
    expect(isOverdue('2026-08-09', today)).toBe(false);
    expect(overdueDays('2026-08-09', today)).toBe(0);
  });

  it('監査の再現ケース(2026-06-15 期限を 2026-08-08 に見る)は54日超過', () => {
    expect(isOverdue('2026-06-15', today)).toBe(true);
    expect(overdueDays('2026-06-15', today)).toBe(54);
  });

  it('期限なし・不正値は超過扱いにしない(推測しない)', () => {
    expect(isOverdue(undefined, today)).toBe(false);
    expect(isOverdue('不明', today)).toBe(false);
    expect(overdueDays(undefined, today)).toBe(0);
  });
});
