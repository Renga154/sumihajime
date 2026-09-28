import type { Profile } from '@tmn/schemas';

/**
 * なぜ: REQUIREMENTS §9.4「該当する正例/該当しない負例/境界条件」を横断的に
 * 検証するための代表的なProfile群。packages/rulesのテストから再利用する
 * (T-003)。実自治体コードは使わず、ダミーの municipalityCode "13999" を使う
 * (計画: 実データはT-005で用意)。
 */

const DUMMY_MUNICIPALITY_CODE = '13999';

/** なぜ: 最も単純な正例基準線。単身・都外からの転入・条件フラグはすべてfalse/未確認なし。 */
export const singlePersonFromOutsideTokyo: Profile = {
  destination: { municipalityCode: DUMMY_MUNICIPALITY_CODE },
  moveDate: '2026-08-01',
  originType: 'outside_tokyo',
  household: { memberCount: 1, ageBands: ['adult'] },
  flags: {
    hasMyNumberCard: false,
    needsNationalHealthInsurance: true,
    needsNationalPension: true,
    hasSchoolOrChildcareNeeds: false,
    hasDog: false,
    dogHasMicrochip: 'unknown',
    needsDisabilityOrCareSupport: false,
    needsForeignResidentGuidance: false,
    needsVehicleGuidance: false,
    isPregnantMember: false,
  },
};

/** なぜ: 子育て世帯(児童手当特例等のageBandsIntersects述語を確定trueで踏む)。 */
export const familyWithChildren: Profile = {
  destination: { municipalityCode: DUMMY_MUNICIPALITY_CODE },
  moveDate: '2026-08-01',
  originType: 'outside_tokyo',
  household: {
    memberCount: 4,
    ageBands: ['age0_2', 'elementary', 'adult'],
  },
  flags: {
    hasMyNumberCard: true,
    needsNationalHealthInsurance: true,
    needsNationalPension: false,
    hasSchoolOrChildcareNeeds: true,
    hasDog: false,
    dogHasMicrochip: 'unknown',
    needsDisabilityOrCareSupport: false,
    needsForeignResidentGuidance: false,
    needsVehicleGuidance: false,
    isPregnantMember: false,
  },
};

/**
 * なぜ: 計画C-10(犬のマイクロチップ分岐)+ REQUIREMENTS §9.1「推測しない」の
 * needs_confirmationケース。hasDog=trueだがdogHasMicrochip="unknown"のため、
 * マイクロチップ有無に依存するルールはunknownに帰着する。
 */
export const dogOwnerWithUnknownMicrochip: Profile = {
  destination: { municipalityCode: DUMMY_MUNICIPALITY_CODE },
  moveDate: '2026-08-01',
  originType: 'outside_tokyo',
  household: { memberCount: 2, ageBands: ['adult'] },
  flags: {
    hasMyNumberCard: false,
    needsNationalHealthInsurance: true,
    needsNationalPension: true,
    hasSchoolOrChildcareNeeds: false,
    hasDog: true,
    dogHasMicrochip: 'unknown',
    needsDisabilityOrCareSupport: false,
    needsForeignResidentGuidance: false,
    needsVehicleGuidance: false,
    isPregnantMember: false,
  },
};

/** なぜ: 都内別自治体からの転居(originTypeIn述語のinside_tokyo分岐を踏む)。 */
export const movingWithinTokyo: Profile = {
  destination: { municipalityCode: DUMMY_MUNICIPALITY_CODE },
  moveDate: '2026-12-20',
  originType: 'inside_tokyo',
  household: { memberCount: 1, ageBands: ['senior65plus'] },
  flags: {
    hasMyNumberCard: true,
    needsNationalHealthInsurance: false,
    needsNationalPension: false,
    hasSchoolOrChildcareNeeds: false,
    hasDog: false,
    dogHasMicrochip: 'unknown',
    needsDisabilityOrCareSupport: true,
    needsForeignResidentGuidance: false,
    needsVehicleGuidance: false,
    isPregnantMember: false,
  },
};

/**
 * なぜ: 自治体越境誤適用テスト専用。上記プロフィールと異なるダミー自治体コードを
 * 転入先に持つ(municipalityCode "13998")。この値はruleSets.tsのother municipality
 * RuleSetとのみ一致する。
 */
export const profileForOtherMunicipality: Profile = {
  destination: { municipalityCode: '13998' },
  moveDate: '2026-08-01',
  originType: 'outside_tokyo',
  household: { memberCount: 1, ageBands: ['adult'] },
  flags: {
    hasMyNumberCard: false,
    needsNationalHealthInsurance: true,
    needsNationalPension: true,
    hasSchoolOrChildcareNeeds: false,
    hasDog: false,
    dogHasMicrochip: 'unknown',
    needsDisabilityOrCareSupport: false,
    needsForeignResidentGuidance: false,
    needsVehicleGuidance: false,
    isPregnantMember: false,
  },
};
