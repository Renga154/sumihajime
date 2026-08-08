/**
 * なぜ: 自治体選択はサービス最初の操作なのに、62件(対応23+未対応39)が同じ形のカードで
 * 縦に並ぶだけで、モバイルでは自分の区に辿り着くまで何度もスワイプが必要だった。
 * 一覧の上に絞り込みを置き、漢字・ひらがな・カタカナ・ローマ字・自治体コードのどれでも
 * 引けるようにする。
 *
 * 読みは表示ではなく「検索の当たり判定」にのみ使う補助データで、公開する事実(手続き・期限)
 * ではない。したがって出典付きの公開データ(data/sources)ではなくUI側の定数として持つ。
 * 判定は純関数に閉じ込め、UIからは filterByQuery を呼ぶだけにする。
 */

/** 検索用の読み(ひらがな)とローマ字。自治体コード5桁をキーにする。 */
interface Reading {
  kana: string;
  romaji: string;
}

export const MUNICIPALITY_READINGS: Readonly<Record<string, Reading>> = {
  // 特別区(23)
  '13101': { kana: 'ちよだ', romaji: 'chiyoda' },
  '13102': { kana: 'ちゅうおう', romaji: 'chuo' },
  '13103': { kana: 'みなと', romaji: 'minato' },
  '13104': { kana: 'しんじゅく', romaji: 'shinjuku' },
  '13105': { kana: 'ぶんきょう', romaji: 'bunkyo' },
  '13106': { kana: 'たいとう', romaji: 'taito' },
  '13107': { kana: 'すみだ', romaji: 'sumida' },
  '13108': { kana: 'こうとう', romaji: 'koto' },
  '13109': { kana: 'しながわ', romaji: 'shinagawa' },
  '13110': { kana: 'めぐろ', romaji: 'meguro' },
  '13111': { kana: 'おおた', romaji: 'ota' },
  '13112': { kana: 'せたがや', romaji: 'setagaya' },
  '13113': { kana: 'しぶや', romaji: 'shibuya' },
  '13114': { kana: 'なかの', romaji: 'nakano' },
  '13115': { kana: 'すぎなみ', romaji: 'suginami' },
  '13116': { kana: 'としま', romaji: 'toshima' },
  '13117': { kana: 'きた', romaji: 'kita' },
  '13118': { kana: 'あらかわ', romaji: 'arakawa' },
  '13119': { kana: 'いたばし', romaji: 'itabashi' },
  '13120': { kana: 'ねりま', romaji: 'nerima' },
  '13121': { kana: 'あだち', romaji: 'adachi' },
  '13122': { kana: 'かつしか', romaji: 'katsushika' },
  '13123': { kana: 'えどがわ', romaji: 'edogawa' },
  // 市部(26)
  '13201': { kana: 'はちおうじ', romaji: 'hachioji' },
  '13202': { kana: 'たちかわ', romaji: 'tachikawa' },
  '13203': { kana: 'むさしの', romaji: 'musashino' },
  '13204': { kana: 'みたか', romaji: 'mitaka' },
  '13205': { kana: 'おうめ', romaji: 'ome' },
  '13206': { kana: 'ふちゅう', romaji: 'fuchu' },
  '13207': { kana: 'あきしま', romaji: 'akishima' },
  '13208': { kana: 'ちょうふ', romaji: 'chofu' },
  '13209': { kana: 'まちだ', romaji: 'machida' },
  '13210': { kana: 'こがねい', romaji: 'koganei' },
  '13211': { kana: 'こだいら', romaji: 'kodaira' },
  '13212': { kana: 'ひの', romaji: 'hino' },
  '13213': { kana: 'ひがしむらやま', romaji: 'higashimurayama' },
  '13214': { kana: 'こくぶんじ', romaji: 'kokubunji' },
  '13215': { kana: 'くにたち', romaji: 'kunitachi' },
  '13218': { kana: 'ふっさ', romaji: 'fussa' },
  '13219': { kana: 'こまえ', romaji: 'komae' },
  '13220': { kana: 'ひがしやまと', romaji: 'higashiyamato' },
  '13221': { kana: 'きよせ', romaji: 'kiyose' },
  '13222': { kana: 'ひがしくるめ', romaji: 'higashikurume' },
  '13223': { kana: 'むさしむらやま', romaji: 'musashimurayama' },
  '13224': { kana: 'たま', romaji: 'tama' },
  '13225': { kana: 'いなぎ', romaji: 'inagi' },
  '13227': { kana: 'はむら', romaji: 'hamura' },
  '13228': { kana: 'あきるの', romaji: 'akiruno' },
  '13229': { kana: 'にしとうきょう', romaji: 'nishitokyo' },
  // 町村部(13)
  '13303': { kana: 'みずほ', romaji: 'mizuho' },
  '13305': { kana: 'ひので', romaji: 'hinode' },
  '13307': { kana: 'ひのはら', romaji: 'hinohara' },
  '13308': { kana: 'おくたま', romaji: 'okutama' },
  '13361': { kana: 'おおしま', romaji: 'oshima' },
  '13362': { kana: 'としま', romaji: 'toshima' },
  '13363': { kana: 'にいじま', romaji: 'niijima' },
  '13364': { kana: 'こうづしま', romaji: 'kozushima' },
  '13381': { kana: 'みやけ', romaji: 'miyake' },
  '13382': { kana: 'みくらじま', romaji: 'mikurajima' },
  '13401': { kana: 'はちじょう', romaji: 'hachijo' },
  '13402': { kana: 'あおがしま', romaji: 'aogashima' },
  '13421': { kana: 'おがさわら', romaji: 'ogasawara' },
};

/** カタカナをひらがなへ寄せる(長音符「ー」はそのまま。濁点・半濁点はNFKCで合成済み)。 */
function katakanaToHiragana(input: string): string {
  return input.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * 検索文字列の正規化。全角英数・半角カナをNFKCで統一し、小文字化・カタカナのひらがな化・
 * 空白除去を行う。「ネリマ」「ﾈﾘﾏ」「ねりま」「Nerima」「ｎｅｒｉｍａ」がすべて同じ形になる。
 */
export function normalizeSearchText(input: string): string {
  // U+3000(全角スペース)はNFKCで半角化されるが、念のため明示的に落とす
  // (正規表現へ全角スペースを直書きすると no-irregular-whitespace に触れるためエスケープする)。
  return katakanaToHiragana(input.normalize('NFKC').toLowerCase()).replace(/[\s\u3000]+/g, '');
}

export interface SearchableMunicipality {
  code: string;
  name: string;
}

/**
 * 自治体が検索語に一致するか。空の検索語はすべて一致(絞り込みなし)とする。
 * 一致対象は 表示名(漢字) / 読み(ひらがな) / ローマ字 / 自治体コード の部分一致。
 */
export function matchesQuery(municipality: SearchableMunicipality, query: string): boolean {
  const q = normalizeSearchText(query);
  if (q === '') return true;
  const reading = MUNICIPALITY_READINGS[municipality.code];
  const haystacks = [
    normalizeSearchText(municipality.name),
    municipality.code,
    reading?.kana ?? '',
    reading?.romaji ?? '',
  ];
  return haystacks.some((h) => h !== '' && h.includes(q));
}

/** 検索語で絞り込む(元の並び順は保つ)。 */
export function filterByQuery<T extends SearchableMunicipality>(list: T[], query: string): T[] {
  const q = normalizeSearchText(query);
  if (q === '') return list;
  return list.filter((m) => matchesQuery(m, q));
}
