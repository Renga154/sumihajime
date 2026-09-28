/**
 * なぜ: 自治体選択はサービス最初の操作なのに、都内62自治体(対応済み・未対応を合わせて)が
 * 同じ形のカードで縦に並ぶだけで、モバイルでは自分の自治体に辿り着くまで何度もスワイプが
 * 必要だった。一覧の上に絞り込みを置き、漢字・ひらがな・カタカナ・ローマ字・自治体コードの
 * どれでも引けるようにする。
 *
 * 読みは表示ではなく「検索の当たり判定」にのみ使う補助データで、公開する事実(手続き・期限)
 * ではない。したがって出典付きの公開データ(data/sources)ではなくUI側の定数として持つ。
 * 判定は純関数に閉じ込め、UIからは filterByQuery を呼ぶだけにする。
 */

/** 検索用の読み(ひらがな)とローマ字。自治体コード5桁をキーにする。 */
interface Reading {
  kana: string;
  /**
   * ローマ字。語の切れ目を `-` で示す(例: 東村山 = `higashi-murayama`)。表示には使わない。
   *
   * なぜ切れ目を持つか: ローマ字は1音を複数文字で綴るため、単純な部分一致は音の途中で
   * 切れて無関係な自治体に当たる(`hino`→武蔵野 `musas|hino` / `oshima`→豊島 `t|oshima`)。
   * 一致は「先頭またはこの切れ目から」だけに限る(matchesRomaji)。
   * 切れ目を入れるのは、後半だけを打って探すのが自然な語(東-村山、西-東京、奥-多摩、
   * および島名の -shima/-jima)に限る。かなは1文字=1音で音の途中に切れ目が入りようがないため、
   * かな・漢字は従来どおり部分一致のままにする。
   */
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
  '13116': { kana: 'としま', romaji: 'to-shima' },
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
  '13207': { kana: 'あきしま', romaji: 'aki-shima' },
  '13208': { kana: 'ちょうふ', romaji: 'chofu' },
  '13209': { kana: 'まちだ', romaji: 'machida' },
  '13210': { kana: 'こがねい', romaji: 'koganei' },
  '13211': { kana: 'こだいら', romaji: 'kodaira' },
  '13212': { kana: 'ひの', romaji: 'hino' },
  '13213': { kana: 'ひがしむらやま', romaji: 'higashi-murayama' },
  '13214': { kana: 'こくぶんじ', romaji: 'kokubunji' },
  '13215': { kana: 'くにたち', romaji: 'kunitachi' },
  '13218': { kana: 'ふっさ', romaji: 'fussa' },
  '13219': { kana: 'こまえ', romaji: 'komae' },
  '13220': { kana: 'ひがしやまと', romaji: 'higashi-yamato' },
  '13221': { kana: 'きよせ', romaji: 'kiyose' },
  '13222': { kana: 'ひがしくるめ', romaji: 'higashi-kurume' },
  '13223': { kana: 'むさしむらやま', romaji: 'musashi-murayama' },
  '13224': { kana: 'たま', romaji: 'tama' },
  '13225': { kana: 'いなぎ', romaji: 'inagi' },
  '13227': { kana: 'はむら', romaji: 'hamura' },
  '13228': { kana: 'あきるの', romaji: 'akiruno' },
  '13229': { kana: 'にしとうきょう', romaji: 'nishi-tokyo' },
  // 町村部(13)
  '13303': { kana: 'みずほ', romaji: 'mizuho' },
  '13305': { kana: 'ひので', romaji: 'hinode' },
  '13307': { kana: 'ひのはら', romaji: 'hinohara' },
  '13308': { kana: 'おくたま', romaji: 'oku-tama' },
  '13361': { kana: 'おおしま', romaji: 'o-shima' },
  '13362': { kana: 'としま', romaji: 'to-shima' },
  '13363': { kana: 'にいじま', romaji: 'nii-jima' },
  '13364': { kana: 'こうづしま', romaji: 'kozu-shima' },
  '13381': { kana: 'みやけ', romaji: 'miyake' },
  '13382': { kana: 'みくらじま', romaji: 'mikura-jima' },
  '13401': { kana: 'はちじょう', romaji: 'hachijo' },
  // 「ヶ」は語をつなぐ字。かなの「しま」で引けるのと同じく、ローマ字も shima で引けるようにする。
  '13402': { kana: 'あおがしま', romaji: 'ao-ga-shima' },
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
 * ローマ字が検索語に一致するか(語境界からの前方一致のみ)。
 *
 * `romaji` は語の切れ目を `-` で示した文字列(例: `higashi-murayama`)。一致を認めるのは
 * 「先頭から」または「切れ目から」始まる前方一致だけで、語の途中からは一致させない。
 * 単純な部分一致だと `hino` が武蔵野(musas|hino)に、`oshima` が豊島(t|oshima)に当たるため。
 * 切れ目をまたぐ入力(`higashimura`)は先頭からの前方一致として通る。
 *
 * 検索語側のハイフン(`higashi-murayama` と手で打った場合)は無視する。
 */
export function matchesRomaji(romaji: string, query: string): boolean {
  const q = query.replace(/-/g, '');
  if (q === '') return true;
  if (romaji === '') return false;
  const flat = romaji.replace(/-/g, '');
  let offset = 0;
  for (const segment of romaji.split('-')) {
    if (flat.startsWith(q, offset)) return true;
    offset += segment.length;
  }
  return false;
}

/**
 * 自治体が検索語に一致するか。空の検索語はすべて一致(絞り込みなし)とする。
 * 一致対象は 表示名(漢字) / 読み(ひらがな) / 自治体コード の部分一致と、
 * ローマ字の語境界からの前方一致(matchesRomaji)。
 *
 * なぜローマ字だけ規則が違うか: かな・漢字は1文字が1音(1語)に対応するため部分一致でも
 * 音の途中で切れない。ローマ字は1音が複数文字なので部分一致だと音の内側で当たってしまう。
 */
export function matchesQuery(municipality: SearchableMunicipality, query: string): boolean {
  const q = normalizeSearchText(query);
  if (q === '') return true;
  const reading = MUNICIPALITY_READINGS[municipality.code];
  const haystacks = [
    normalizeSearchText(municipality.name),
    municipality.code,
    reading?.kana ?? '',
  ];
  if (haystacks.some((h) => h !== '' && h.includes(q))) return true;
  return reading ? matchesRomaji(reading.romaji, q) : false;
}

/** 検索語で絞り込む(元の並び順は保つ)。 */
export function filterByQuery<T extends SearchableMunicipality>(list: T[], query: string): T[] {
  const q = normalizeSearchText(query);
  if (q === '') return list;
  return list.filter((m) => matchesQuery(m, q));
}
