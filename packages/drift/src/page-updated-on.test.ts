import { describe, expect, it } from 'vitest';
import { extractPageUpdatedOn } from './page-updated-on.js';

/**
 * なぜ: ADR-014 の信号は「ページ自身の更新日表記」。表記ゆれ(令和/西暦/区切り/全角コロン/
 * ラベルと日付の間のタグ)を正しく同じ ISO 日付へ畳み、無いものは null と正直に返すことを固定する。
 */
describe('extractPageUpdatedOn — 正例', () => {
  it('令和表記(令和N年 = 2018+N)', () => {
    expect(extractPageUpdatedOn('<p>更新日：令和8年9月15日</p>')).toBe('2026-09-15');
    expect(extractPageUpdatedOn('最終更新日 令和 6 年 1 月 5 日')).toBe('2024-01-05');
  });

  it('西暦「YYYY年M月D日」表記', () => {
    expect(extractPageUpdatedOn('更新日:2026年5月28日')).toBe('2026-05-28');
    expect(extractPageUpdatedOn('ページ更新日 2025年12月3日')).toBe('2025-12-03');
  });

  it('スラッシュ・ドット・ハイフン区切り', () => {
    expect(extractPageUpdatedOn('更新日：2026/9/1')).toBe('2026-09-01');
    expect(extractPageUpdatedOn('最終更新：2026.09.01')).toBe('2026-09-01');
    expect(extractPageUpdatedOn('更新年月日 2026-09-01')).toBe('2026-09-01');
  });

  it('ラベルと日付の間の空白・全角コロンを許す', () => {
    expect(extractPageUpdatedOn('更新日\n　：　2026年9月1日')).toBe('2026-09-01');
  });

  it('渋谷区型: ラベルと日付の間にタグが挟まる', () => {
    const html =
      '<div><p class="update-hdg" data-v-1>更新日</p><p class="update-date" data-v-1>2026年5月28日</p></div>';
    expect(extractPageUpdatedOn(html)).toBe('2026-05-28');
  });

  it('最初に日付が得られたラベル出現を採用する(先勝ち)', () => {
    const html = '更新日：2026年1月1日 ... 更新日：2026年2月2日';
    expect(extractPageUpdatedOn(html)).toBe('2026-01-01');
  });

  it('日付の続かないラベルは読み飛ばし、後続の日付つきラベルを採用する', () => {
    const html =
      '<a href="/updates">更新日一覧を見る</a><nav>' +
      'x'.repeat(300) +
      '</nav><p>最終更新日：令和8年3月31日</p>';
    expect(extractPageUpdatedOn(html)).toBe('2026-03-31');
  });
});

describe('extractPageUpdatedOn — 負例・境界', () => {
  it('ラベルが無ければ null', () => {
    expect(extractPageUpdatedOn('<p>2026年5月28日</p>')).toBeNull();
    expect(extractPageUpdatedOn('')).toBeNull();
  });

  it('ラベルはあるが直後に日付が無ければ null', () => {
    expect(extractPageUpdatedOn('<p>更新日</p><p>未定</p>')).toBeNull();
  });

  it('ラベルから 200 文字より遠い日付は拾わない', () => {
    const html = '更新日' + '<span></span>' + ' '.repeat(210) + '2026年5月28日';
    expect(extractPageUpdatedOn(html)).toBeNull();
  });

  it('壊れた日付(13月・32日)は日付として返さない', () => {
    expect(extractPageUpdatedOn('更新日：2026年13月1日')).toBeNull();
    expect(extractPageUpdatedOn('更新日：2026/2/30')).toBeNull();
  });

  it('年のみ・月日欠落は拾わない', () => {
    expect(extractPageUpdatedOn('更新日：2026年')).toBeNull();
  });
});
