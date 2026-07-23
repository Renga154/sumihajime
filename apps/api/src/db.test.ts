import { describe, expect, it } from 'vitest';
import { normalizeForWasteSortingSearch } from './db.js';

/**
 * なぜ: GET /api/waste-sorting の検索正規化(大文字小文字・全半角を「素朴に」正規化)は
 * D1(SQLite)にICU正規化がないためアプリ側の純粋関数として実装している。ロジックの
 * 正例・境界条件を統合テスト(api.integration.test.ts)より軽く・速く検証する。
 */
describe('normalizeForWasteSortingSearch', () => {
  it('lowercases ASCII letters', () => {
    expect(normalizeForWasteSortingSearch('ABC')).toBe('abc');
  });

  it('converts full-width alnum to half-width', () => {
    expect(normalizeForWasteSortingSearch('ＡＢＣ１２３')).toBe('abc123');
  });

  it('converts full-width space to half-width space', () => {
    expect(normalizeForWasteSortingSearch('あ　い')).toBe('あ い');
  });

  it('leaves plain Japanese text (kanji/kana) untouched', () => {
    expect(normalizeForWasteSortingSearch('アイロン')).toBe('アイロン');
  });

  it('combines case-folding and width normalization', () => {
    expect(normalizeForWasteSortingSearch('Ｉhケース')).toBe('ihケース');
  });
});
