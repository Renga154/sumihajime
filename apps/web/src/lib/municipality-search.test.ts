import { describe, expect, it } from 'vitest';
import {
  MUNICIPALITY_READINGS,
  filterByQuery,
  matchesQuery,
  normalizeSearchText,
} from './municipality-search';

/**
 * なぜ: 自治体選択の絞り込みは最初の操作の体験を決める。漢字しか通らない/カタカナで
 * 外れるといった取りこぼしが起きないことを固定する。読みは検索専用の補助データのため、
 * 東京都62市区町村すべてに漏れなく用意されていることも併せて担保する。
 */

const NERIMA = { code: '13120', name: '練馬区' };
const HACHIOJI = { code: '13201', name: '八王子市' };
const OGASAWARA = { code: '13421', name: '小笠原村' };

describe('normalizeSearchText', () => {
  it('カタカナ・全角英数・大文字・空白のゆれを吸収する', () => {
    expect(normalizeSearchText('ネリマ')).toBe('ねりま');
    expect(normalizeSearchText('ﾈﾘﾏ')).toBe('ねりま');
    expect(normalizeSearchText('ねりま')).toBe('ねりま');
    expect(normalizeSearchText('Ｎｅｒｉｍａ')).toBe('nerima');
    expect(normalizeSearchText(' NERIMA ')).toBe('nerima');
    expect(normalizeSearchText('世田谷 区')).toBe('世田谷区');
    expect(normalizeSearchText('')).toBe('');
  });

  it('濁点・半濁点つきのカタカナも1文字のひらがなになる', () => {
    expect(normalizeSearchText('シブヤ')).toBe('しぶや');
    expect(normalizeSearchText('ｼﾌﾞﾔ')).toBe('しぶや');
  });
});

describe('matchesQuery', () => {
  it('漢字の部分一致で引ける(区の字を付けても付けなくても)', () => {
    expect(matchesQuery(NERIMA, '練馬')).toBe(true);
    expect(matchesQuery(NERIMA, '練馬区')).toBe(true);
  });

  it('ひらがな・カタカナ・ローマ字で引ける', () => {
    expect(matchesQuery(NERIMA, 'ねりま')).toBe(true);
    expect(matchesQuery(NERIMA, 'ネリマ')).toBe(true);
    expect(matchesQuery(NERIMA, 'nerima')).toBe(true);
    expect(matchesQuery(NERIMA, 'neri')).toBe(true);
  });

  it('自治体コードで引ける', () => {
    expect(matchesQuery(NERIMA, '13120')).toBe(true);
  });

  it('一致しない語では外れる', () => {
    expect(matchesQuery(NERIMA, '世田谷')).toBe(false);
    expect(matchesQuery(NERIMA, 'setagaya')).toBe(false);
    expect(matchesQuery(NERIMA, '99999')).toBe(false);
  });

  it('空の検索語はすべて一致する(絞り込みなし)', () => {
    expect(matchesQuery(NERIMA, '')).toBe(true);
    expect(matchesQuery(NERIMA, '   ')).toBe(true);
  });

  it('読みを持たない自治体でも表示名で引ける(将来の追加に耐える)', () => {
    const unknown = { code: '99999', name: '東京都（都の機関）' };
    expect(matchesQuery(unknown, '都の機関')).toBe(true);
    expect(matchesQuery(unknown, 'ねりま')).toBe(false);
  });
});

describe('filterByQuery', () => {
  const list = [NERIMA, HACHIOJI, OGASAWARA];

  it('対応・未対応を問わず同じ規則で絞り込み、元の並び順を保つ', () => {
    expect(filterByQuery(list, '')).toEqual(list);
    expect(filterByQuery(list, 'は')).toEqual([HACHIOJI]);
    expect(filterByQuery(list, 'おがさわら')).toEqual([OGASAWARA]);
    expect(filterByQuery(list, 'ぜったいにない')).toEqual([]);
  });

  it('複数件が一致する場合も元の順序で返す', () => {
    const many = [
      { code: '13213', name: '東村山市' },
      { code: '13220', name: '東大和市' },
      { code: '13222', name: '東久留米市' },
    ];
    expect(filterByQuery(many, 'ひがし').map((m) => m.code)).toEqual(['13213', '13220', '13222']);
    expect(filterByQuery(many, 'higashi')).toHaveLength(3);
  });
});

describe('MUNICIPALITY_READINGS', () => {
  it('東京都62市区町村すべての読みを持つ', () => {
    expect(Object.keys(MUNICIPALITY_READINGS)).toHaveLength(62);
  });

  it('読みはひらがな(と長音符)のみ、ローマ字は英小文字のみ', () => {
    for (const [code, r] of Object.entries(MUNICIPALITY_READINGS)) {
      expect(code, `${code} は5桁の自治体コード`).toMatch(/^\d{5}$/);
      expect(r.kana, `${code} の読み: ${r.kana}`).toMatch(/^[ぁ-んー]+$/);
      expect(r.romaji, `${code} のローマ字: ${r.romaji}`).toMatch(/^[a-z]+$/);
    }
  });
});
