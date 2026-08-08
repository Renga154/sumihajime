import { describe, expect, it } from 'vitest';
import {
  MUNICIPALITY_READINGS,
  filterByQuery,
  matchesQuery,
  matchesRomaji,
  normalizeSearchText,
} from './municipality-search';

/**
 * 東京都62市区町村の表示名(テスト用フィクスチャ)。
 *
 * なぜテスト側に置くか: 表示名の正はAPI(D1のmunicipalitiesマスタ=scripts/publish)であって
 * UIではない。検索の全数確認にはコードと名称の対応が要るため、ここでは「その時点の62件」を
 * 固定値として持ち、検索規則の網羅確認にだけ使う(UI側へ名称マスタを二重に持たせない)。
 */
const MUNICIPALITY_NAMES: Readonly<Record<string, string>> = {
  '13101': '千代田区',
  '13102': '中央区',
  '13103': '港区',
  '13104': '新宿区',
  '13105': '文京区',
  '13106': '台東区',
  '13107': '墨田区',
  '13108': '江東区',
  '13109': '品川区',
  '13110': '目黒区',
  '13111': '大田区',
  '13112': '世田谷区',
  '13113': '渋谷区',
  '13114': '中野区',
  '13115': '杉並区',
  '13116': '豊島区',
  '13117': '北区',
  '13118': '荒川区',
  '13119': '板橋区',
  '13120': '練馬区',
  '13121': '足立区',
  '13122': '葛飾区',
  '13123': '江戸川区',
  '13201': '八王子市',
  '13202': '立川市',
  '13203': '武蔵野市',
  '13204': '三鷹市',
  '13205': '青梅市',
  '13206': '府中市',
  '13207': '昭島市',
  '13208': '調布市',
  '13209': '町田市',
  '13210': '小金井市',
  '13211': '小平市',
  '13212': '日野市',
  '13213': '東村山市',
  '13214': '国分寺市',
  '13215': '国立市',
  '13218': '福生市',
  '13219': '狛江市',
  '13220': '東大和市',
  '13221': '清瀬市',
  '13222': '東久留米市',
  '13223': '武蔵村山市',
  '13224': '多摩市',
  '13225': '稲城市',
  '13227': '羽村市',
  '13228': 'あきる野市',
  '13229': '西東京市',
  '13303': '瑞穂町',
  '13305': '日の出町',
  '13307': '檜原村',
  '13308': '奥多摩町',
  '13361': '大島町',
  '13362': '利島村',
  '13363': '新島村',
  '13364': '神津島村',
  '13381': '三宅村',
  '13382': '御蔵島村',
  '13401': '八丈町',
  '13402': '青ヶ島村',
  '13421': '小笠原村',
};

const ALL = Object.entries(MUNICIPALITY_NAMES).map(([code, name]) => ({ code, name }));
const namesFor = (query: string) => filterByQuery(ALL, query).map((m) => m.name);

/** 読みは62件そろっている前提(直下のテストで担保)。取り出しでの undefined 分岐を避ける。 */
function readingOf(code: string) {
  const reading = MUNICIPALITY_READINGS[code];
  if (!reading) throw new Error(`読みが未登録: ${code}`);
  return reading;
}

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

  it('読みはひらがな(と長音符)のみ、ローマ字は英小文字と語の切れ目(-)のみ', () => {
    for (const [code, r] of Object.entries(MUNICIPALITY_READINGS)) {
      expect(code, `${code} は5桁の自治体コード`).toMatch(/^\d{5}$/);
      expect(r.kana, `${code} の読み: ${r.kana}`).toMatch(/^[ぁ-んー]+$/);
      // 先頭・末尾のハイフンや連続ハイフン(空の語)は許さない。
      expect(r.romaji, `${code} のローマ字: ${r.romaji}`).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it('テスト用の名称フィクスチャは読みと同じ62件・同じコードを持つ', () => {
    expect(Object.keys(MUNICIPALITY_NAMES).sort()).toEqual(
      Object.keys(MUNICIPALITY_READINGS).sort(),
    );
  });
});

/**
 * なぜ: ローマ字は1音を複数文字で綴るため、単純な部分一致は音の途中で当たる。
 * 実際に `hino` が武蔵野(musas|hino)、`oshima` が豊島(t|oshima)を拾っていた。
 * 語境界(先頭 or 読みデータの `-`)からの前方一致だけを認めることで塞ぐ。
 */
describe('matchesRomaji(ローマ字の語境界一致)', () => {
  it('先頭からの前方一致は当たる', () => {
    expect(matchesRomaji('nerima', 'neri')).toBe(true);
    expect(matchesRomaji('nerima', 'nerima')).toBe(true);
    expect(matchesRomaji('higashi-murayama', 'higashi')).toBe(true);
    // 語の切れ目をまたぐ入力も、先頭からつながっていれば当たる。
    expect(matchesRomaji('higashi-murayama', 'higashimura')).toBe(true);
    expect(matchesRomaji('higashi-murayama', 'higashimurayama')).toBe(true);
  });

  it('語の切れ目からの前方一致は当たる', () => {
    expect(matchesRomaji('higashi-murayama', 'murayama')).toBe(true);
    expect(matchesRomaji('nishi-tokyo', 'tokyo')).toBe(true);
    expect(matchesRomaji('oku-tama', 'tama')).toBe(true);
  });

  it('語の途中からは当たらない(誤ヒットの原因)', () => {
    expect(matchesRomaji('musashi-no', 'hino')).toBe(false);
    expect(matchesRomaji('to-shima', 'oshima')).toBe(false);
    expect(matchesRomaji('nerima', 'erima')).toBe(false);
    expect(matchesRomaji('higashi-murayama', 'urayama')).toBe(false);
  });

  it('検索語のハイフンは無視する(higashi-murayama と手で打てる)', () => {
    expect(matchesRomaji('higashi-murayama', 'higashi-murayama')).toBe(true);
    expect(matchesRomaji('higashi-murayama', '-murayama')).toBe(true);
  });

  it('空の検索語はすべて一致、読みが無ければ一致しない', () => {
    expect(matchesRomaji('nerima', '')).toBe(true);
    expect(matchesRomaji('', 'nerima')).toBe(false);
  });
});

describe('62自治体の全数確認', () => {
  it('62件すべてが自分の名前・かな・ローマ字(・コード)で自分に到達できる', () => {
    const unreachable: string[] = [];
    for (const m of ALL) {
      const reading = readingOf(m.code);
      const queries = [
        m.name,
        reading.kana,
        reading.romaji.replace(/-/g, ''), // 続けて打つ: higashimurayama
        reading.romaji, // 区切って打つ: higashi-murayama
        m.code,
      ];
      for (const q of queries) {
        if (!filterByQuery(ALL, q).some((hit) => hit.code === m.code)) {
          unreachable.push(`${m.code} ${m.name} ← "${q}"`);
        }
      }
    }
    expect(unreachable, `自己到達できない組み合わせ:\n${unreachable.join('\n')}`).toEqual([]);
  });

  it('ローマ字のフル入力で無関係な自治体が混ざらない(同音のみ許す)', () => {
    // 「としま」は豊島区(13116)と利島村(13362)、「たま」は多摩市と奥多摩町のように
    // 名称そのものが含み合う組み合わせだけが複数ヒットしてよい。
    const allowedMultiHits: Record<string, string[]> = {
      toshima: ['豊島区', '利島村'],
      hino: ['日野市', '日の出町', '檜原村'],
      tama: ['多摩市', '奥多摩町'],
    };
    for (const m of ALL) {
      const flat = readingOf(m.code).romaji.replace(/-/g, '');
      const hits = namesFor(flat);
      expect(hits, `"${flat}" のヒット`).toEqual(allowedMultiHits[flat] ?? [m.name]);
    }
  });

  it('報告された誤ヒットが再発しない', () => {
    // hino が武蔵野市(musas|hino)を拾っていた。
    expect(namesFor('hino')).toEqual(['日野市', '日の出町', '檜原村']);
    // oshima が豊島区(t|oshima)を拾っていた。
    expect(namesFor('oshima')).toEqual(['大島町']);
  });

  it('語の後半だけでも探せる(語境界からの前方一致)', () => {
    expect(namesFor('murayama')).toEqual(['東村山市', '武蔵村山市']);
    expect(namesFor('shima')).toEqual([
      '豊島区',
      '昭島市',
      '大島町',
      '利島村',
      '神津島村',
      '青ヶ島村',
    ]);
    expect(namesFor('tokyo')).toEqual(['西東京市']);
  });

  it('既存の正しい挙動を保つ(漢字・かなの部分一致)', () => {
    // 「中央」で中野が出ない/「北」で他区が出ない。
    expect(namesFor('中央')).toEqual(['中央区']);
    expect(namesFor('北')).toEqual(['北区']);
    expect(namesFor('ひがし')).toEqual(['東村山市', '東大和市', '東久留米市']);
    expect(namesFor('higashi')).toEqual(['東村山市', '東大和市', '東久留米市']);
    // かなは1文字=1音のため部分一致のままでよい(音の途中で切れようがない)。
    expect(namesFor('しま')).toEqual([
      '豊島区',
      '昭島市',
      '大島町',
      '利島村',
      '神津島村',
      '青ヶ島村',
    ]);
    expect(namesFor('ネリマ')).toEqual(['練馬区']);
  });
});
