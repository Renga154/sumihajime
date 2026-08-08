import { describe, expect, it } from 'vitest';
import { normalizeForWasteSortingSearch } from './db.js';

/**
 * なぜ: GET /api/waste-sorting の検索正規化は D1(SQLite)にICU正規化がないためアプリ側の
 * 純粋関数として実装している。検索語と品目名の両方に同じ関数を通すため、ここで検証すべき
 * 性質は「同じ品目を指す複数の表記が同一の鍵へ畳まれること」であって、出力そのものの
 * 見た目ではない。したがって具体値ではなく主に表記どうしの等価性を検証する。
 */
describe('normalizeForWasteSortingSearch', () => {
  it('lowercases ASCII letters', () => {
    expect(normalizeForWasteSortingSearch('ABC')).toBe('abc');
  });

  it('converts full-width alnum to half-width', () => {
    expect(normalizeForWasteSortingSearch('ＡＢＣ１２３')).toBe('abc123');
  });

  it('combines case-folding and width normalization', () => {
    expect(normalizeForWasteSortingSearch('ＩHケース')).toBe(
      normalizeForWasteSortingSearch('ihけーす'),
    );
  });

  /**
   * なぜこの群が要るのか: 本番実測(2026-08-09)で、世田谷区の品目「折りたたみ傘」に対し
   * 「かさ」「カサ」「ｶｻ」がいずれも0件、「ペットボトル」に対し「ぺっとぼとる」
   * 「ﾍﾟｯﾄﾎﾞﾄﾙ」「ペット ボトル」が0件だった。日本語話者が最も普通に行う入力で
   * 0件になるため、表記ゆれの吸収は機能の前提条件として固定する。
   */
  describe('表記ゆれの吸収(同じ品目を指す入力は同じ鍵になる)', () => {
    it('カタカナとひらがなを同一視する', () => {
      expect(normalizeForWasteSortingSearch('カサ')).toBe(normalizeForWasteSortingSearch('かさ'));
      expect(normalizeForWasteSortingSearch('ペットボトル')).toBe(
        normalizeForWasteSortingSearch('ぺっとぼとる'),
      );
    });

    it('半角カナを全角カナと同一視する(濁点の合成を含む)', () => {
      expect(normalizeForWasteSortingSearch('ｶｻ')).toBe(normalizeForWasteSortingSearch('カサ'));
      expect(normalizeForWasteSortingSearch('ﾍﾟｯﾄﾎﾞﾄﾙ')).toBe(
        normalizeForWasteSortingSearch('ペットボトル'),
      );
    });

    it('語中・前後の空白(半角/全角)を無視する', () => {
      expect(normalizeForWasteSortingSearch('ペット ボトル')).toBe(
        normalizeForWasteSortingSearch('ペットボトル'),
      );
      expect(normalizeForWasteSortingSearch('　傘　')).toBe(normalizeForWasteSortingSearch('傘'));
    });

    it('長音符の有無を無視する', () => {
      expect(normalizeForWasteSortingSearch('スプレー缶')).toBe(
        normalizeForWasteSortingSearch('すぷれ缶'),
      );
    });

    it('カタカナ表記と混在表記を同一視する(スプレーかん/スプレーカン)', () => {
      expect(normalizeForWasteSortingSearch('スプレーかん')).toBe(
        normalizeForWasteSortingSearch('スプレーカン'),
      );
    });
  });

  /**
   * なぜ: 正規化は「畳む」方向にしか働かないため、畳みすぎると別品目が誤って一致する。
   * 漢字は落とさない・別語は衝突しないことを負例として固定する。
   */
  describe('畳みすぎない(別の品目は別の鍵のまま)', () => {
    it('漢字を落とさない', () => {
      expect(normalizeForWasteSortingSearch('乾電池')).toBe('乾電池');
    });

    it('異なる品目を同一視しない', () => {
      expect(normalizeForWasteSortingSearch('かさ')).not.toBe(
        normalizeForWasteSortingSearch('かさい'),
      );
      expect(normalizeForWasteSortingSearch('びん')).not.toBe(
        normalizeForWasteSortingSearch('かん'),
      );
    });

    it('漢字とかなは同一視しない(よみ列でのみ一致させる設計)', () => {
      expect(normalizeForWasteSortingSearch('傘')).not.toBe(normalizeForWasteSortingSearch('かさ'));
    });
  });
});
