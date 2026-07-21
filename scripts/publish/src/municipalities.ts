import type { Municipality } from '@tmn/schemas';

/**
 * なぜ: 計画D-1(MVP対象=世田谷/江東/新宿、補欠=杉並/千代田、+市部代表の八王子)を
 * municipalitiesテーブルへ投入する静的マスタ。supported=true は縦切り完了済みの世田谷のみ。
 * officialUrl は FR-021「未対応でも公式トップへ誘導」用の各区市の公式サイトトップURL。
 * note は CoveragePage/Wizard(FR-021)で「対応準備中(MVP対象)」/「未対応」を誠実表示するため。
 *
 * 出典URLは各自治体の公式ドメイントップ(city.setagaya.lg.jp 等)。深いフォームURLではなく
 * トップ階層に留める(リンク切れ耐性。計画§16.1の教訓)。
 */
export const MUNICIPALITIES: Municipality[] = [
  {
    code: '13112',
    name: '世田谷区',
    supported: true,
    note: 'MVP対象(縦切り対応済み)',
    officialUrl: 'https://www.city.setagaya.lg.jp/',
  },
  {
    code: '13108',
    name: '江東区',
    supported: false,
    note: '対応準備中(MVP対象)',
    officialUrl: 'https://www.city.koto.lg.jp/',
  },
  {
    code: '13104',
    name: '新宿区',
    supported: false,
    note: '対応準備中(MVP対象)',
    officialUrl: 'https://www.city.shinjuku.lg.jp/',
  },
  {
    code: '13115',
    name: '杉並区',
    supported: false,
    note: '未対応',
    officialUrl: 'https://www.city.suginami.tokyo.jp/',
  },
  {
    code: '13101',
    name: '千代田区',
    supported: false,
    note: '未対応',
    officialUrl: 'https://www.city.chiyoda.lg.jp/',
  },
  {
    code: '13201',
    name: '八王子市',
    supported: false,
    note: '未対応',
    officialUrl: 'https://www.city.hachioji.tokyo.jp/',
  },
];
