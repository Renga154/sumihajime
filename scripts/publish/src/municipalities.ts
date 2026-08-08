import type { Municipality } from '@tmn/schemas';

/**
 * なぜ: 東京都62市区町村(23区+26市+5町+8村)を municipalities テーブルへ投入する静的マスタ。
 * supported=true は縦切り整備済みの23特別区すべて(2026-08-07 の人手レビュー承認で23区が出そろった)。
 * 残る39市町村はチェックリスト未対応だが、
 * FR-021「未対応でも公式サイトへ誘導」のため officialUrl を全件に持たせ、CLAUDE.md原則9
 * 「未対応を対応済みに見せない」を LandingPage 側の折りたたみグループ表示で担保する。
 *
 * 出典: 東京都公式サイト「リンク集／都内区市町村」
 *   https://www.metro.tokyo.lg.jp/sitemap/link/link04
 *   (スナップショット data/sources/tokyo/snapshots/ に保存+SHA-256、registry.csv に登録)。
 * 名称・officialUrl のホスト/パスは上記出典ページに記載された各自治体公式サイトの href のみを採用する
 *   (推測ドメイン禁止=CLAUDE.md原則3/5)。
 *   スキームだけは例外で、都リンク集が http のまま据え置いている 20件について 2026-08-08 に
 *   https 版を実測し、「同一ホストで 200・リダイレクト0・本文に自治体名を確認」できた19件を
 *   https へ引き上げた(利用者を平文HTTPへ誘導しないため。実測記録: docs/data-sources/url-verification-2026-08-08.md)。
 *   到達性を実測できなかった御蔵島村(13382)だけは http のまま据え置く(下記の個別コメント参照)。
 *   ホストを差し替えた唯一の例外は北区(13117)で、都リンク集の href(http://www.city.kita.tokyo.jp/)が
 *   旧ドメインのままであり、実測で https://www.city.kita.lg.jp/ への301恒久リダイレクトを確認したため、
 *   registry.csv に登録した北区の出典URL(すべて www.city.kita.lg.jp)と揃えて新ドメインを採用する
 *   (推測ではなく実測したリダイレクト先。2026-08-07 人手レビュー時に確認)。
 * code は総務省「全国地方公共団体コード」5桁。既存6自治体(世田谷/江東/新宿/杉並/千代田/八王子)の
 *   note・officialUrl は人手レビュー済みの従前値を維持し、新規58はnote無し(=未対応)とする。
 */
export const MUNICIPALITIES: Municipality[] = [
  // ── 23特別区(code=131xx) ──
  {
    // なぜ: Step4-Bで千代田区データ(手続き10件/窓口施設7件=本庁舎+出張所6/ごみ分別辞書446品目)を
    // 整備しsupportedへ。収集曜日は公式PDFのみのため誠実縮退(waste.jsonなし)。全ソースは pending だが
    // publish の承認ゲート(load.ts)で公開ビュー上の supported は承認済みソース有無に従う(承認まで false)。
    code: '13101',
    name: '千代田区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない。
    note: '対応済み',
    officialUrl: 'https://www.city.chiyoda.lg.jp/',
  },
  {
    // なぜ: Batch8で中央区データ(手続き10件+自治体以外のライフライン等4件/窓口施設4件)を整備し、
    // 2026-08-07 ユーザー(maintainer)決裁「5区とも承認」により全件verified・approved化されたため
    // 公開ビュー(seed→D1→API)でも supported=true になる(loadPublishDataのapproved判定で担保)。
    code: '13102',
    name: '中央区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない。
    note: '対応済み',
    officialUrl: 'https://www.city.chuo.lg.jp/',
  },
  {
    // なぜ: Batch8で港区データ(手続き10件+自治体以外のライフライン等4件/窓口施設5件)を整備し、
    // 2026-08-07 ユーザー(maintainer)決裁「5区とも承認」により全件verified・approved化されたため
    // 公開ビュー(seed→D1→API)でも supported=true になる(loadPublishDataのapproved判定で担保)。
    code: '13103',
    name: '港区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない。
    note: '対応済み',
    officialUrl: 'https://www.city.minato.tokyo.jp/',
  },
  {
    // なぜ: T-016で新宿区データ(手続き10件/窓口施設10件/収集日HTML表→171地区)を整備しsupportedへ。
    // 全ソースは pending だが publish の承認ゲートで公開ビュー上の supported は実データに従う。
    code: '13104',
    name: '新宿区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない(Step2)。
    note: '対応済み',
    officialUrl: 'https://www.city.shinjuku.lg.jp/',
  },
  {
    // なぜ: Batch8で文京区データ(手続き10件+自治体以外のライフライン等4件/窓口施設1件)を整備し、
    // 2026-08-07 ユーザー(maintainer)決裁「5区とも承認」により全件verified・approved化されたため
    // 公開ビュー(seed→D1→API)でも supported=true になる(loadPublishDataのapproved判定で担保)。
    code: '13105',
    name: '文京区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない。
    note: '対応済み',
    officialUrl: 'https://www.city.bunkyo.lg.jp/',
  },
  {
    // なぜ: Batch8で台東区データ(手続き10件+自治体以外のライフライン等4件/窓口施設1件)を整備し、
    // 2026-08-07 ユーザー(maintainer)決裁「5区とも承認」により全件verified・approved化されたため
    // 公開ビュー(seed→D1→API)でも supported=true になる(loadPublishDataのapproved判定で担保)。
    code: '13106',
    name: '台東区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない。
    note: '対応済み',
    officialUrl: 'https://www.city.taito.lg.jp/',
  },
  {
    // なぜ: Batch8で墨田区データ(手続き10件+自治体以外のライフライン等4件/窓口施設6件)を整備し、
    // 2026-08-07 ユーザー(maintainer)決裁「5区とも承認」により全件verified・approved化されたため
    // 公開ビュー(seed→D1→API)でも supported=true になる(loadPublishDataのapproved判定で担保)。
    code: '13107',
    name: '墨田区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない。
    note: '対応済み',
    officialUrl: 'https://www.city.sumida.lg.jp/',
  },
  {
    // なぜ: T-015で江東区データ(手続き10件/窓口施設9件/収集日)を整備しsupportedへ。
    // 承認ゲートにより公開ビュー(seed→D1→API)の supported は承認済みソース有無に従う。
    code: '13108',
    name: '江東区',
    supported: true,
    note: '対応済み',
    officialUrl: 'https://www.city.koto.lg.jp/',
  },
  {
    // なぜ: Step5-Aで品川区データ(手続き10件/窓口施設7件=本庁舎3階戸籍住民課+住民異動を扱う
    // 6地域センター/ごみ分別辞書415品目)を整備。収集曜日は収集日CSVが2017年更新の
    // ままで現行年度(令和8年度)と確認できないため恒久的に誠実縮退(waste.jsonなし)。2026-07-26の
    // 人手レビュー承認(ユーザー決裁「2区とも承認」)により全ソースがapproved化・全手続きがverified化
    // されたため、公開ビュー(seed→D1→API)でも supported=true になる(loadPublishDataのapproved判定で担保)。
    code: '13109',
    name: '品川区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない。
    note: '対応済み',
    officialUrl: 'https://www.city.shinagawa.tokyo.jp/',
  },
  {
    // なぜ: Batch9で目黒区データ(手続き10件+自治体以外のライフライン等4件/窓口施設5件)を整備し、
    // 2026-08-07 ユーザー(maintainer)決裁「3区とも承認」により全件verified・approved化されたため
    // 公開ビュー(seed→D1→API)でも supported=true になる(loadPublishDataのapproved判定で担保)。
    code: '13110',
    name: '目黒区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない。
    note: '対応済み',
    officialUrl: 'https://www.city.meguro.tokyo.jp/',
  },
  {
    // なぜ: Step5-Bで大田区データ(手続き10件/窓口施設26件/収集曜日XLSXパーサ)を整備しsupportedへ。
    // 収集曜日はオープンデータ(XLSX)が令和7年度版で公式サイトの令和8年度版より1年度遅れのため
    // 誤案内回避で非公開(誠実縮退)。分別辞書CSVは大田区都カタログに無く未整備。2026-07-26の
    // 人手レビュー承認(ユーザー決裁「2区とも承認」)により全ソースがapproved化・全手続きがverified化
    // されたため、公開ビュー(seed→D1→API)でも supported=true になる(loadPublishDataのapproved判定で担保)。
    code: '13111',
    name: '大田区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない。
    note: '対応済み',
    officialUrl: 'https://www.city.ota.tokyo.jp/',
  },
  {
    // 対応済み。note は利用者向けの「表示専用」文言のみ(内部の進捗・工程用語は出さない=Step2)。
    code: '13112',
    name: '世田谷区',
    supported: true,
    note: '対応済み',
    officialUrl: 'https://www.city.setagaya.lg.jp/',
  },
  {
    // なぜ: Batch9で渋谷区データ(手続き10件+自治体以外のライフライン等4件/窓口施設10件)を整備し、
    // 2026-08-07 ユーザー(maintainer)決裁「3区とも承認」により全件verified・approved化されたため
    // 公開ビュー(seed→D1→API)でも supported=true になる(loadPublishDataのapproved判定で担保)。
    code: '13113',
    name: '渋谷区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない。
    note: '対応済み',
    officialUrl: 'https://www.city.shibuya.tokyo.jp/',
  },
  {
    // なぜ: Batch7で中野区データ(手続き10件/窓口施設6件=本庁舎1+地域事務所5)を整備。
    // 2026-08-07の人手レビュー承認(ユーザー決裁「4区とも承認」)により全ソースがapproved化・
    // 全手続き(自治体以外のライフライン等4件を含む)がverified化されたため、公開ビュー
    // (seed→D1→API)でも supported=true になる(loadPublishDataのapproved判定で担保)。
    // 同日の決裁「wagmapを完全一致で個別許可」で取得許可ホストに www2.wagmap.jp を追加したため、
    // 区の公式オープンデータ(配信は外部GIS基盤)からごみ分別辞書942品目を新規に取り込み、
    // 施設も緯度経度付きへ差し替えた。収集曜日CSVは『最終確認日』列が全行2021-02-08のままで
    // 現行年度と確認できないため恒久的に誠実縮退(waste.jsonなし)。
    // 子ども医療費助成は公式ページに申請期限の記載が無いため『要確認』のまま公開する(同決裁)。
    code: '13114',
    name: '中野区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない。
    note: '対応済み',
    officialUrl: 'https://www.city.tokyo-nakano.lg.jp/',
  },
  {
    // なぜ: Step4-Aで杉並区データ(手続き10件/窓口施設7件/ごみ分別辞書127品目。収集曜日は
    // 第三者SaaS依存で機械取得不可のため恒久的に誠実縮退)を整備。2026-07-25の人手レビュー承認
    // (ユーザー決裁「2区とも承認」)により全ソースがapproved化・全手続きがverified化されたため、
    // 公開ビュー(seed→D1→API)でも supported=true になる(loadPublishDataのapproved判定で担保)。
    code: '13115',
    name: '杉並区',
    supported: true,
    note: '対応済み',
    officialUrl: 'https://www.city.suginami.tokyo.jp/',
  },
  {
    // なぜ: Batch7で豊島区データ(手続き10件/窓口施設3件=区役所3階総合窓口課+東部/西部区民事務所)を
    // 整備。公共施設一覧CSVはファイル名が『R4』(令和4年度)のままで中身の年度整合を確認できないため
    // 採用せず公式ページ由来・座標なし(誠実縮退)。収集曜日・分別辞書は都カタログに機械判読可能な
    // データが無く恒久的に unavailable。2026-08-07の人手レビュー承認(ユーザー決裁「4区とも承認」)に
    // より全ソースがapproved化・全手続き(ライフライン等4件を含む)がverified化された。
    // 子ども医療費助成の申請期限は2か月(北/荒川の3カ月・中野の記載なしと相違)。
    code: '13116',
    name: '豊島区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない。
    note: '対応済み',
    officialUrl: 'https://www.city.toshima.lg.jp/',
  },
  {
    // なぜ: Batch7で北区データ(手続き10件/窓口施設3件=王子・赤羽・滝野川の区民事務所)を整備。
    // 都カタログ登録が7件のみで窓口・ごみのCSVが存在しないため付帯データは恒久的に unavailable。
    // 2026-08-07の人手レビュー承認(ユーザー決裁「4区とも承認」)により全ソースがapproved化・
    // 全手続き(ライフライン等4件を含む)がverified化された。マイナンバーカード継続利用の90日ルールは
    // 北区公式ページのどこにも記載が見当たらないため、他区(中野・豊島・荒川)の90日を当てはめず
    // 「未確認」表示のまま公開する(同決裁。CLAUDE.md原則3)。
    // officialUrl は都リンク集由来の旧ドメイン(city.kita.tokyo.jp)から、移行後の新ドメインへ修正した
    // (旧ドメインは301稼働中だが registry.csv の出典URLと同じ新ドメインに揃え出典整合性を保つ)。
    code: '13117',
    name: '北区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない。
    note: '対応済み',
    officialUrl: 'https://www.city.kita.lg.jp/',
  },
  {
    // なぜ: Batch7で荒川区データ(手続き10件/窓口施設6件=区役所本庁舎/北庁舎+区民事務所4。
    // 自治体標準CSV由来で緯度経度あり/ごみ分別辞書223品目)を整備。収集曜日は機械判読可能な
    // CSVが無いため恒久的に unavailable(誠実縮退)。2026-08-07の人手レビュー承認
    // (ユーザー決裁「4区とも承認」)により全ソースがapproved化・全手続き(ライフライン等4件を
    // 含む)がverified化された。子ども医療費助成の申請期限は3カ月(豊島の2か月と相違)。
    code: '13118',
    name: '荒川区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない。
    note: '対応済み',
    officialUrl: 'https://www.city.arakawa.tokyo.jp/',
  },
  {
    // なぜ: Batch6-Aで板橋区データ(手続き10件/窓口施設7件=本庁舎1+区民事務所6/
    // ごみ分別辞書1,125品目)を整備。収集曜日は都カタログに町名別CSVが無く恒久的に誠実縮退
    // (waste.jsonなし)。2026-08-07の人手レビュー承認(ユーザー決裁「2区とも承認」)により
    // 全ソースがapproved化・全手続き(自治体以外のライフライン等4件を含む)がverified化された
    // ため、公開ビュー(seed→D1→API)でも supported=true になる(loadPublishDataのapproved
    // 判定で担保)。犬の登録事項変更の30日期限(狂犬病予防法第4条第4項)は板橋固有で他区へ
    // 展開しない(同決裁)。
    code: '13119',
    name: '板橋区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない。
    note: '対応済み',
    officialUrl: 'https://www.city.itabashi.tokyo.jp/',
  },
  {
    // なぜ: Batch6-Aで練馬区データ(手続き10件/窓口施設6件=転入届窓口の区民事務所6か所。
    // GIF準拠CSV由来で緯度経度あり)を整備。収集曜日・分別辞書はいずれも都カタログに
    // 機械判読可能なデータが存在せず恒久的に誠実縮退(waste.json・waste-sorting.jsonなし)。
    // 2026-08-07の人手レビュー承認(ユーザー決裁「2区とも承認」)により全ソースがapproved化・
    // 全手続き(自治体以外のライフライン等4件を含む)がverified化されたため、公開ビュー
    // (seed→D1→API)でも supported=true になる(loadPublishDataのapproved判定で担保)。
    code: '13120',
    name: '練馬区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない。
    note: '対応済み',
    officialUrl: 'https://www.city.nerima.tokyo.jp/',
  },
  {
    // なぜ: Batch10で足立区データ(手続き10件+自治体以外のライフライン等4件/窓口施設17件)を整備し、
    // 2026-08-07 ユーザー(maintainer)決裁「2区とも承認」により全件verified・approved化されたため
    // 公開ビュー(seed→D1→API)でも supported=true になる(loadPublishDataのapproved判定で担保)。
    code: '13121',
    name: '足立区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない。
    note: '対応済み',
    officialUrl: 'https://www.city.adachi.tokyo.jp/',
  },
  {
    // なぜ: Batch9で葛飾区データ(手続き10件+自治体以外のライフライン等4件/窓口施設7件)を整備し、
    // 2026-08-07 ユーザー(maintainer)決裁「3区とも承認」により全件verified・approved化されたため
    // 公開ビュー(seed→D1→API)でも supported=true になる(loadPublishDataのapproved判定で担保)。
    code: '13122',
    name: '葛飾区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない。
    note: '対応済み',
    officialUrl: 'https://www.city.katsushika.lg.jp/',
  },
  {
    // なぜ: Batch10で江戸川区データ(手続き10件+自治体以外のライフライン等4件/窓口施設6件)を整備し、
    // 2026-08-07 ユーザー(maintainer)決裁「2区とも承認」により全件verified・approved化されたため
    // 公開ビュー(seed→D1→API)でも supported=true になる(loadPublishDataのapproved判定で担保)。
    code: '13123',
    name: '江戸川区',
    supported: true,
    // note は LandingPage で利用者に表示される「表示専用」文言。内部の進捗・工程用語は出さない。
    note: '対応済み',
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
    officialUrl: 'https://www.city.musashino.lg.jp/',
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
    officialUrl: 'https://www.city.fuchu.tokyo.jp/index.html',
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
    officialUrl: 'https://www.city.koganei.lg.jp/',
  },
  {
    code: '13211',
    name: '小平市',
    supported: false,
    officialUrl: 'https://www.city.kodaira.tokyo.jp/',
  },
  { code: '13212', name: '日野市', supported: false, officialUrl: 'https://www.city.hino.lg.jp/' },
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
    officialUrl: 'https://www.city.komae.tokyo.jp/',
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
  { code: '13224', name: '多摩市', supported: false, officialUrl: 'https://www.city.tama.lg.jp/' },
  {
    code: '13225',
    name: '稲城市',
    supported: false,
    officialUrl: 'https://www.city.inagi.tokyo.jp/',
  },
  {
    code: '13227',
    name: '羽村市',
    supported: false,
    officialUrl: 'https://www.city.hamura.tokyo.jp/',
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
    officialUrl: 'https://www.city.nishitokyo.lg.jp/',
  },

  // ── 5町(code=133xx/134xx) ──
  {
    code: '13303',
    name: '瑞穂町',
    supported: false,
    officialUrl: 'https://www.town.mizuho.tokyo.jp/',
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
    officialUrl: 'https://www.town.okutama.tokyo.jp/',
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
    officialUrl: 'https://www.vill.hinohara.tokyo.jp/',
  },
  { code: '13362', name: '利島村', supported: false, officialUrl: 'https://www.toshimamura.org/' },
  { code: '13363', name: '新島村', supported: false, officialUrl: 'https://www.niijima.com/' },
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
    // なぜ http のまま据え置くか: 2026-08-08 の実測で https://www.mikurasima.jp/ は TLS 証明書の
    // 対象ホスト名が一致せず到達できない(Node fetch=ERR_TLS_CERT_ALTNAME_INVALID / curl=exit 60。
    // 提示される証明書の CN は *.bizmw.com)。到達しない URL へは差し替えない。
    // 一方 http://www.mikurasima.jp/ は稼働しており 301 で https://www.vill.mikurasima.tokyo.jp/
    // (200・本文に「御蔵島村」)へ転送されるため、利用者は公式サイトへ到達できる。
    // 移転先ドメインへの差し替えは出典(都リンク集)の href と異なるホストへの変更にあたるので、
    // 北区(13117)と同様に人手レビュー承認を経てから行う。それまでは出典どおりの値を維持する
    // (CLAUDE.md 原則3/5・§9。実測記録: docs/data-sources/url-verification-2026-08-08.md)。
    code: '13382',
    name: '御蔵島村',
    supported: false,
    officialUrl: 'http://www.mikurasima.jp/',
  },
  {
    code: '13402',
    name: '青ヶ島村',
    supported: false,
    officialUrl: 'https://www.vill.aogashima.tokyo.jp/top.html',
  },
  {
    code: '13421',
    name: '小笠原村',
    supported: false,
    officialUrl: 'https://www.vill.ogasawara.tokyo.jp/',
  },
];
