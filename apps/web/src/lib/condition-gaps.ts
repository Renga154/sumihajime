import type { Profile } from '@tmn/schemas';

/**
 * なぜ: ウィザードのステップ2(世帯)・ステップ3(条件チェック)は任意で、ステップ1だけでも
 * チェックリストを生成できる(FR-003)。このとき条件フラグはすべて false のまま評価されるため、
 * マイナンバーカードの継続利用・国民健康保険・国民年金といった期限つきの手続きが一件も出ない。
 * 画面には「あなたのチェックリスト」「n/m件完了」とだけ出るため、利用者はそれが全量だと
 * 受け取ってしまう — 本サービスの中核である「見落としを防ぐ」約束を、既定の導線で裏切る。
 *
 * 対処としてフラグの既定値を true に倒す(=利用者の状況を推測する)ことはしない。
 * CLAUDE.md 原則3「根拠がない場合は推測せず、未確認または要確認を表示する」に反するため。
 * 代わりに「まだ判定していない条件がある」ことを明示するための判定だけをここに置く。
 *
 * 判定の入力は保存済みプロフィール(データ)のみで、ウィザードのUI状態には依存しない。
 * これにより再訪・リロード・別タブでも同じ結果になる(決定論的)。
 */

/** 条件チェック(ステップ3)+ 妊娠(ステップ2)で選ぶ、手続きの該当判定に効くフラグ。 */
export type ConditionKey =
  | 'hasMyNumberCard'
  | 'needsNationalHealthInsurance'
  | 'needsNationalPension'
  | 'hasSchoolOrChildcareNeeds'
  | 'hasDog'
  | 'needsDisabilityOrCareSupport'
  | 'needsForeignResidentGuidance'
  | 'needsVehicleGuidance'
  | 'isPregnantMember';

export interface ConditionTopic {
  key: ConditionKey;
  /** 案内文に出す、利用者の言葉での短いラベル(手続き名ではなく「条件」の呼び名)。 */
  label: string;
}

/**
 * 未選択のときに手続きが出てこなくなる条件の一覧。並び順は実害の大きい順
 * (マイナンバーカードの継続利用は期限を過ぎるとカードが失効しうるため先頭)。
 */
export const CONDITION_TOPICS: readonly ConditionTopic[] = [
  { key: 'hasMyNumberCard', label: 'マイナンバーカード' },
  { key: 'needsNationalHealthInsurance', label: '国民健康保険' },
  { key: 'needsNationalPension', label: '国民年金' },
  { key: 'hasSchoolOrChildcareNeeds', label: 'お子さまの学校・保育' },
  { key: 'hasDog', label: 'ペット（犬）' },
  { key: 'needsDisabilityOrCareSupport', label: '介護・障害福祉' },
  { key: 'needsForeignResidentGuidance', label: '外国籍・在留' },
  { key: 'needsVehicleGuidance', label: '車・バイク' },
  { key: 'isPregnantMember', label: '妊娠中の方' },
] as const;

/** プロフィール上で「選ばれていない(false)」条件を、CONDITION_TOPICS の順で返す。 */
export function unselectedConditions(profile: Profile): ConditionTopic[] {
  return CONDITION_TOPICS.filter((t) => profile.flags[t.key] !== true);
}

/** プロフィール上で「選ばれている(true)」条件の件数。 */
export function selectedConditionCount(profile: Profile): number {
  return CONDITION_TOPICS.length - unselectedConditions(profile).length;
}

/**
 * 条件チェックが一つも選ばれていない = ステップ2/3を通らずに生成した可能性が高い状態。
 * 一つでも選んでいれば利用者は条件欄を認識しているとみなし、案内を出さない(ノイズにしない)。
 */
export function hasNoSelectedConditions(profile: Profile): boolean {
  return selectedConditionCount(profile) === 0;
}

/**
 * 世帯(ステップ2)が初期値のままか。年齢帯は「成人のみ・1人」が初期値で、この状態では
 * 子育て・高齢者向けの手続きが該当しない。犬のマイクロチップ等と違い年齢帯は
 * 「未回答」を表す値を持てないため、初期値との一致で判定する。
 */
export function isHouseholdUntouched(profile: Profile): boolean {
  const { memberCount, ageBands } = profile.household;
  return memberCount === 1 && ageBands.length === 1 && ageBands[0] === 'adult';
}

export interface ConditionGapNotice {
  /** 案内カードを出すか。 */
  show: boolean;
  /** 未選択のため判定対象外になっている条件(案内文に列挙する)。 */
  unselected: ConditionTopic[];
  /** 世帯(ステップ2)も初期値のままか(案内文に一文を足す)。 */
  householdUntouched: boolean;
}

/**
 * チェックリスト画面に「まだ判定していない条件がある」案内を出すかどうかを決める純関数。
 * profile が無い(=チェックリストを出せない)場合は show=false。
 */
export function conditionGapNotice(profile: Profile | null): ConditionGapNotice {
  if (!profile) return { show: false, unselected: [], householdUntouched: false };
  const unselected = unselectedConditions(profile);
  return {
    show: hasNoSelectedConditions(profile),
    unselected,
    householdUntouched: isHouseholdUntouched(profile),
  };
}
