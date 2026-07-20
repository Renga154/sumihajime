import type { RuleSet } from '@tmn/schemas';

/**
 * なぜ: packages/rulesのテストが4述語+all/any/not+期限3種(14/15/90日+unknown)を
 * 横断的に確認できるよう、ダミー自治体2件分のRuleSetを用意する
 * (実自治体データはT-005。ここでは "13999"/"13998" のダミーコードのみ使用)。
 */

const DUMMY_SOURCE_ID = 'source_dummy_official_page';

/** なぜ: 主目的の自治体。profiles.tsの各Profileはこのコードを転入先に持つ。 */
export const dummyRuleSet: RuleSet = {
  municipalityCode: '13999',
  ruleVersion: '2026-07-01.1',
  rules: [
    {
      procedureId: 'procedure_resident_registration',
      condition: {
        predicate: 'originTypeIn',
        values: ['outside_tokyo', 'inside_tokyo', 'overseas'],
      },
      priority: 'urgent',
      dueRule: { type: 'offsetDays', from: 'moveDate', days: 14 },
      sourceIds: [DUMMY_SOURCE_ID],
      applicabilityReasonTemplate: '転入したすべての世帯が対象の手続きです',
    },
    {
      procedureId: 'procedure_child_allowance_special',
      condition: {
        predicate: 'ageBandsIntersects',
        values: ['age0_2', 'age3_5', 'elementary', 'junior_senior'],
      },
      priority: 'high',
      dueRule: { type: 'offsetDays', from: 'moveDate', days: 15 },
      sourceIds: [DUMMY_SOURCE_ID],
      applicabilityReasonTemplate: '18歳未満の児童がいる世帯が対象の特例手続きです',
    },
    {
      procedureId: 'procedure_mynumber_card_continued_use',
      condition: { predicate: 'flagEquals', flag: 'hasMyNumberCard', equals: true },
      priority: 'normal',
      dueRule: { type: 'offsetDays', from: 'moveDate', days: 90 },
      sourceIds: [DUMMY_SOURCE_ID],
      applicabilityReasonTemplate: 'マイナンバーカードを継続利用する場合の手続きです',
    },
    {
      procedureId: 'procedure_dog_registration',
      condition: { predicate: 'flagEquals', flag: 'hasDog', equals: true },
      priority: 'normal',
      dueRule: { type: 'offsetDays', from: 'moveDate', days: 30 },
      sourceIds: [DUMMY_SOURCE_ID],
      applicabilityReasonTemplate: '犬を飼っている世帯が対象の登録手続きです',
    },
    {
      // なぜ: unknown伝播(all)の実例。hasDog=trueかつdogHasMicrochip="unknown"のとき、
      // allにfalseは無いがunknownが混ざるためneeds_confirmationへ倒れる(推測しない)。
      procedureId: 'procedure_dog_microchip_registration',
      condition: {
        all: [
          { predicate: 'flagEquals', flag: 'hasDog', equals: true },
          { predicate: 'flagEquals', flag: 'dogHasMicrochip', equals: true },
        ],
      },
      priority: 'normal',
      dueRule: { type: 'unknown' },
      dueDescription:
        'マイクロチップ登録済みの場合は30日以内に環境省データベースの届出変更が必要です',
      sourceIds: [DUMMY_SOURCE_ID],
      applicabilityReasonTemplate: 'マイクロチップ登録済みの犬を飼っている世帯が対象です',
      needsConfirmationReason: 'マイクロチップの装着有無が未確認のため、該当するか確認が必要です',
    },
    {
      // なぜ: 期限未確定(dueRule: unknown)でdueDescriptionのみを持つ「生活開始系」の例。
      // sortOutcomesByDueが期限なし項目を優先度で後置する対象になる。
      procedureId: 'procedure_large_household_guidance',
      condition: { predicate: 'memberCountGte', value: 4 },
      priority: 'optional',
      dueRule: { type: 'unknown' },
      dueDescription: '特に期限はありませんが、転入後early対応が推奨されます',
      sourceIds: [DUMMY_SOURCE_ID],
      applicabilityReasonTemplate: '4人以上の世帯向けの生活案内です',
    },
    {
      // なぜ: 入れ子のany/all/notを一度に踏む複合条件の実例。
      procedureId: 'procedure_complex_condition_demo',
      condition: {
        any: [
          {
            all: [
              { predicate: 'originTypeIn', values: ['overseas'] },
              { predicate: 'flagEquals', flag: 'needsForeignResidentGuidance', equals: true },
            ],
          },
          { not: { predicate: 'memberCountGte', value: 2 } },
        ],
      },
      priority: 'high',
      dueRule: { type: 'offsetDays', from: 'moveDate', days: 7 },
      sourceIds: [DUMMY_SOURCE_ID],
      applicabilityReasonTemplate: '外国籍世帯向け案内、または単身世帯向けの複合条件例です',
    },
  ],
};

/**
 * なぜ: 自治体越境誤適用テスト専用。dummyRuleSetとは異なるmunicipalityCodeを持つ。
 * profileForOtherMunicipality と組み合わせて使うと正しく評価が通ることを、
 * dummyRuleSet と組み合わせると必ず例外になることを確認する。
 */
export const otherMunicipalityRuleSet: RuleSet = {
  municipalityCode: '13998',
  ruleVersion: '2026-07-01.1',
  rules: [
    {
      procedureId: 'procedure_resident_registration',
      condition: {
        predicate: 'originTypeIn',
        values: ['outside_tokyo', 'inside_tokyo', 'overseas'],
      },
      priority: 'urgent',
      dueRule: { type: 'offsetDays', from: 'moveDate', days: 14 },
      sourceIds: [DUMMY_SOURCE_ID],
      applicabilityReasonTemplate: '転入したすべての世帯が対象の手続きです(別自治体)',
    },
  ],
};
