import type { Municipality } from '@tmn/schemas';

/**
 * なぜ: 東京都62市区町村(23区+26市+5町+8村)を municipalities テーブルへ投入する静的マスタ。
 * supported=true は縦切り整備済みの3区(世田谷/江東/新宿)のみ。残る59はチェックリスト未対応だが、
 * FR-021「未対応でも公式サイトへ誘導」のため officialUrl を全件に持たせ、CLAUDE.md原則9
 * 「未対応を対応済みに見せない」を LandingPage 側の折りたたみグループ表示で担保する。
 *
 * 出典: 東京都公式サイト「リンク集／都内区市町村」
 *   https://www.metro.tokyo.lg.jp/sitemap/link/link04
 *   (スナップショット data/sources/tokyo/snapshots/ に保存+SHA-256、registry.csv に登録)。
 * 名称・officialUrl は上記出典ページに記載された各自治体公式サイトの href のみを採用する
 *   (推測ドメイン禁止=CLAUDE.md原則3/5。http/https も出典の表記どおり)。
 * code は総務省「全国地方公共団体コード」5桁。既存6自治体(世田谷/江東/新宿/杉並/千代田/八王子)の
 *   note・officialUrl は人手レビュー済みの従前値を維持し、新規58はnote無し(=未対応)とする。
 */
export const MUNICIPALITIES: Municipality[] = [
  // ── 23特別区(code=131xx) ──
  {
    code: '13101',
    name: '千代田区',
    supported: false,
    officialUrl: 'https://www.city.chiyoda.lg.jp/',
  },
  { code: '13102', name: '中央区', supported: false, officialUrl: 'https://www.city.chuo.lg.jp/' },
  {
    code: '13103',
    name: '港区',
    supported: false,
    officialUrl: 'https://www.city.minato.tokyo.jp/',
  },
  {
    // なぜ: T-016で新宿区データ(手続き10件/窓口施設10件/収集日HTML表→171地区)を整備しsupportedへ。
    // 全ソースは pending だが publish の承認ゲートで公開ビュー上の supported は実データに従う。
    code: '13104',
    name: '新宿区',
    supported: true,
    note: '対応準備中(MVP対象。データ整備済み・人手レビュー承認後に有効)',
    officialUrl: 'https://www.city.shinjuku.lg.jp/',
  },
  {
    code: '13105',
    name: '文京区',
    supported: false,
    officialUrl: 'https://www.city.bunkyo.lg.jp/',
  },
  { code: '13106', name: '台東区', supported: false, officialUrl: 'https://www.city.taito.lg.jp/' },
  {
    code: '13107',
    name: '墨田区',
    supported: false,
    officialUrl: 'https://www.city.sumida.lg.jp/',
  },
  {
    // なぜ: T-015で江東区データ(手続き10件/窓口施設9件/収集日)を整備しsupportedへ。
    // 承認ゲートにより公開ビュー(seed→D1→API)の supported は承認済みソース有無に従う。
    code: '13108',
    name: '江東区',
    supported: true,
    note: '対応準備中(MVP対象。データ整備済み・人手レビュー承認後に有効)',
    officialUrl: 'https://www.city.koto.lg.jp/',
  },
  {
    code: '13109',
    name: '品川区',
    supported: false,
    officialUrl: 'https://www.city.shinagawa.tokyo.jp/',
  },
  {
    code: '13110',
    name: '目黒区',
    supported: false,
    officialUrl: 'https://www.city.meguro.tokyo.jp/',
  },
  { code: '13111', name: '大田区', supported: false, officialUrl: 'http://www.city.ota.tokyo.jp/' },
  {
    // 縦切り対応済み(MVP基準ペルソナ)。従前のnote・officialUrlを維持する。
    code: '13112',
    name: '世田谷区',
    supported: true,
    note: 'MVP対象(縦切り対応済み)',
    officialUrl: 'https://www.city.setagaya.lg.jp/',
  },
  {
    code: '13113',
    name: '渋谷区',
    supported: false,
    officialUrl: 'http://www.city.shibuya.tokyo.jp/',
  },
  {
    code: '13114',
    name: '中野区',
    supported: false,
    officialUrl: 'https://www.city.tokyo-nakano.lg.jp/',
  },
  {
    code: '13115',
    name: '杉並区',
    supported: false,
    officialUrl: 'https://www.city.suginami.tokyo.jp/',
  },
  {
    code: '13116',
    name: '豊島区',
    supported: false,
    officialUrl: 'http://www.city.toshima.lg.jp/',
  },
  { code: '13117', name: '北区', supported: false, officialUrl: 'http://www.city.kita.tokyo.jp/' },
  {
    code: '13118',
    name: '荒川区',
    supported: false,
    officialUrl: 'https://www.city.arakawa.tokyo.jp/',
  },
  {
    code: '13119',
    name: '板橋区',
    supported: false,
    officialUrl: 'https://www.city.itabashi.tokyo.jp/',
  },
  {
    code: '13120',
    name: '練馬区',
    supported: false,
    officialUrl: 'https://www.city.nerima.tokyo.jp/',
  },
  {
    code: '13121',
    name: '足立区',
    supported: false,
    officialUrl: 'https://www.city.adachi.tokyo.jp/',
  },
  {
    code: '13122',
    name: '葛飾区',
    supported: false,
    officialUrl: 'https://www.city.katsushika.lg.jp/',
  },
  {
    code: '13123',
    name: '江戸川区',
    supported: false,
    officialUrl: 'https://www.city.edogawa.tokyo.jp/',
  },

  // ── 26市(code=132xx) ──
  {
    code: '13201',
    name: '八王子市',
    supported: false,
    officialUrl: 'https://www.city.hachioji.tokyo.jp/',
  },
  {
    code: '13202',
    name: '立川市',
    supported: false,
    officialUrl: 'https://www.city.tachikawa.lg.jp/',
  },
  {
    code: '13203',
    name: '武蔵野市',
    supported: false,
    officialUrl: 'http://www.city.musashino.lg.jp/',
  },
  {
    code: '13204',
    name: '三鷹市',
    supported: false,
    officialUrl: 'https://www.city.mitaka.lg.jp/',
  },
  {
    code: '13205',
    name: '青梅市',
    supported: false,
    officialUrl: 'https://www.city.ome.tokyo.jp/',
  },
  {
    code: '13206',
    name: '府中市',
    supported: false,
    officialUrl: 'http://www.city.fuchu.tokyo.jp/index.html',
  },
  {
    code: '13207',
    name: '昭島市',
    supported: false,
    officialUrl: 'https://www.city.akishima.lg.jp/',
  },
  {
    code: '13208',
    name: '調布市',
    supported: false,
    officialUrl: 'https://www.city.chofu.tokyo.jp/',
  },
  {
    code: '13209',
    name: '町田市',
    supported: false,
    officialUrl: 'https://www.city.machida.tokyo.jp/',
  },
  {
    code: '13210',
    name: '小金井市',
    supported: false,
    officialUrl: 'http://www.city.koganei.lg.jp/',
  },
  {
    code: '13211',
    name: '小平市',
    supported: false,
    officialUrl: 'http://www.city.kodaira.tokyo.jp/',
  },
  { code: '13212', name: '日野市', supported: false, officialUrl: 'http://www.city.hino.lg.jp/' },
  {
    code: '13213',
    name: '東村山市',
    supported: false,
    officialUrl: 'https://www.city.higashimurayama.tokyo.jp/',
  },
  {
    code: '13214',
    name: '国分寺市',
    supported: false,
    officialUrl: 'https://www.city.kokubunji.tokyo.jp/',
  },
  {
    code: '13215',
    name: '国立市',
    supported: false,
    officialUrl: 'https://www.city.kunitachi.tokyo.jp/',
  },
  {
    code: '13218',
    name: '福生市',
    supported: false,
    officialUrl: 'https://www.city.fussa.tokyo.jp/',
  },
  {
    code: '13219',
    name: '狛江市',
    supported: false,
    officialUrl: 'http://www.city.komae.tokyo.jp/',
  },
  {
    code: '13220',
    name: '東大和市',
    supported: false,
    officialUrl: 'https://www.city.higashiyamato.lg.jp/',
  },
  {
    code: '13221',
    name: '清瀬市',
    supported: false,
    officialUrl: 'https://www.city.kiyose.lg.jp/',
  },
  {
    code: '13222',
    name: '東久留米市',
    supported: false,
    officialUrl: 'https://www.city.higashikurume.lg.jp/',
  },
  {
    code: '13223',
    name: '武蔵村山市',
    supported: false,
    officialUrl: 'https://www.city.musashimurayama.lg.jp/',
  },
  { code: '13224', name: '多摩市', supported: false, officialUrl: 'http://www.city.tama.lg.jp/' },
  {
    code: '13225',
    name: '稲城市',
    supported: false,
    officialUrl: 'http://www.city.inagi.tokyo.jp/',
  },
  {
    code: '13227',
    name: '羽村市',
    supported: false,
    officialUrl: 'http://www.city.hamura.tokyo.jp/',
  },
  {
    code: '13228',
    name: 'あきる野市',
    supported: false,
    officialUrl: 'https://www.city.akiruno.tokyo.jp/',
  },
  {
    code: '13229',
    name: '西東京市',
    supported: false,
    officialUrl: 'http://www.city.nishitokyo.lg.jp/',
  },

  // ── 5町(code=133xx/134xx) ──
  {
    code: '13303',
    name: '瑞穂町',
    supported: false,
    officialUrl: 'http://www.town.mizuho.tokyo.jp/',
  },
  {
    code: '13305',
    name: '日の出町',
    supported: false,
    officialUrl: 'https://www.town.hinode.tokyo.jp/',
  },
  {
    code: '13308',
    name: '奥多摩町',
    supported: false,
    officialUrl: 'http://www.town.okutama.tokyo.jp/',
  },
  {
    code: '13361',
    name: '大島町',
    supported: false,
    officialUrl: 'https://www.town.oshima.tokyo.jp/',
  },
  {
    code: '13401',
    name: '八丈町',
    supported: false,
    officialUrl: 'https://www.town.hachijo.tokyo.jp/',
  },

  // ── 8村(code=133xx/134xx) ──
  {
    code: '13307',
    name: '檜原村',
    supported: false,
    officialUrl: 'http://www.vill.hinohara.tokyo.jp/',
  },
  { code: '13362', name: '利島村', supported: false, officialUrl: 'http://www.toshimamura.org/' },
  { code: '13363', name: '新島村', supported: false, officialUrl: 'http://www.niijima.com/' },
  {
    code: '13364',
    name: '神津島村',
    supported: false,
    officialUrl: 'https://vill.kouzushima.tokyo.jp/',
  },
  {
    code: '13381',
    name: '三宅村',
    supported: false,
    officialUrl: 'https://www.vill.miyake.tokyo.jp/',
  },
  {
    code: '13382',
    name: '御蔵島村',
    supported: false,
    officialUrl: 'http://www.mikurasima.jp/',
  },
  {
    code: '13402',
    name: '青ヶ島村',
    supported: false,
    officialUrl: 'http://www.vill.aogashima.tokyo.jp/top.html',
  },
  {
    code: '13421',
    name: '小笠原村',
    supported: false,
    officialUrl: 'https://www.vill.ogasawara.tokyo.jp/',
  },
];
