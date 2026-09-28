import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHAT_DAILY_LIMIT,
  DEFAULT_DRIFT_BATCH_SIZE,
  DEFAULT_MIN_SCORE,
  parseChatDailyLimit,
  parseDriftBatchSize,
  parseMinScore,
} from './config.js';
import { tokyoDate } from './tokyo-date.js';

/**
 * なぜ: vars は文字列で、設定ミス(空文字・誤記)が NaN や既定値へ黙って化けると、上限が消えたり
 * 閾値が勝手に変わったりする。正しい値はそのまま、壊れた値は既定値、を境界で固定する。
 */
describe('parseChatDailyLimit', () => {
  it('正の整数はそのまま使う', () => {
    expect(parseChatDailyLimit('1500')).toBe(1500);
    expect(parseChatDailyLimit(' 20 ')).toBe(20);
  });
  it('0 は有効(本日の生成を止める緊急停止)', () => {
    expect(parseChatDailyLimit('0')).toBe(0);
  });
  it.each([undefined, '', 'abc', '-1', '1.5', '1e3', 'NaN', 'Infinity'])(
    '不正値 %s は既定値(NaNにしない)',
    (raw) => {
      expect(parseChatDailyLimit(raw)).toBe(DEFAULT_CHAT_DAILY_LIMIT);
    },
  );
});

describe('parseMinScore', () => {
  it("'0' は 0 として扱う(以前は || で 0.3 に化けていた)", () => {
    expect(parseMinScore('0')).toBe(0);
  });
  it('0〜1 の小数はそのまま', () => {
    expect(parseMinScore('0.30')).toBe(0.3);
    expect(parseMinScore('1')).toBe(1);
  });
  it.each([undefined, '', 'x', '-0.1', '1.01', '.5'])('不正値 %s は既定値', (raw) => {
    expect(parseMinScore(raw)).toBe(DEFAULT_MIN_SCORE);
  });
});

describe('parseDriftBatchSize', () => {
  it('1〜50 の整数はそのまま', () => {
    expect(parseDriftBatchSize('1')).toBe(1);
    expect(parseDriftBatchSize('10')).toBe(10);
    expect(parseDriftBatchSize('50')).toBe(50);
  });
  it.each([undefined, '', 'ten', '0', '51', '2.5'])('不正値 %s は既定値(NaNにしない)', (raw) => {
    expect(parseDriftBatchSize(raw)).toBe(DEFAULT_DRIFT_BATCH_SIZE);
  });
});

describe('tokyoDate', () => {
  it('UTC 15:30 は日本時間の翌日(巡回の検知日の表示)', () => {
    expect(tokyoDate(new Date('2026-09-22T15:30:00Z'))).toBe('2026-09-23');
  });
  it('日本時間の日付境界(JST 0:00 = UTC 15:00)', () => {
    expect(tokyoDate(new Date('2026-09-22T14:59:59Z'))).toBe('2026-09-22');
    expect(tokyoDate(new Date('2026-09-22T15:00:00Z'))).toBe('2026-09-23');
  });
});
