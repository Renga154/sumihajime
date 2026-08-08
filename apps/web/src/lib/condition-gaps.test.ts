import { describe, expect, it } from 'vitest';
import { profileSchema, type Profile } from '@tmn/schemas';
import {
  CONDITION_TOPICS,
  conditionGapNotice,
  hasNoSelectedConditions,
  isHouseholdUntouched,
  selectedConditionCount,
  unselectedConditions,
} from './condition-gaps';

/**
 * なぜ: ステップ1だけで生成したチェックリストが、期限つきの重要手続き(マイナンバーカードの
 * 継続利用・国民健康保険・国民年金など)を黙って落とす問題への案内表示は、UIの状態ではなく
 * 保存済みプロフィール(データ)だけから決定論的に判定する。その判定をここで固定する。
 */

/** ステップ1のみ入力して生成したときに保存されるプロフィール(既定値のまま)。 */
function step1OnlyProfile(over: Partial<Profile> = {}): Profile {
  return profileSchema.parse({
    destination: { municipalityCode: '13120' },
    moveDate: '2026-08-15',
    originType: 'outside_tokyo',
    household: { memberCount: 1, ageBands: ['adult'] },
    flags: {
      hasMyNumberCard: false,
      needsNationalHealthInsurance: false,
      needsNationalPension: false,
      hasSchoolOrChildcareNeeds: false,
      hasDog: false,
      needsDisabilityOrCareSupport: false,
      needsForeignResidentGuidance: false,
    },
    ...over,
  });
}

describe('condition-gaps', () => {
  it('ステップ1だけで生成したプロフィールでは、全条件が未選択と判定される', () => {
    const p = step1OnlyProfile();
    expect(unselectedConditions(p)).toHaveLength(CONDITION_TOPICS.length);
    expect(selectedConditionCount(p)).toBe(0);
    expect(hasNoSelectedConditions(p)).toBe(true);
  });

  it('未選択の条件にマイナンバーカード・国民健康保険・国民年金が含まれる(実害の大きい順)', () => {
    const labels = unselectedConditions(step1OnlyProfile()).map((t) => t.label);
    expect(labels.slice(0, 3)).toEqual(['マイナンバーカード', '国民健康保険', '国民年金']);
  });

  it('条件を1つでも選んでいれば案内を出さない(境界: 1件)', () => {
    const p = step1OnlyProfile({
      flags: {
        hasMyNumberCard: true,
        needsNationalHealthInsurance: false,
        needsNationalPension: false,
        hasSchoolOrChildcareNeeds: false,
        hasDog: false,
        dogHasMicrochip: 'unknown',
        needsDisabilityOrCareSupport: false,
        needsForeignResidentGuidance: false,
        needsVehicleGuidance: false,
        isPregnantMember: false,
      },
    });
    expect(selectedConditionCount(p)).toBe(1);
    expect(hasNoSelectedConditions(p)).toBe(false);
    expect(conditionGapNotice(p).show).toBe(false);
    // 選んでいない残り8件は「未選択」として数え続ける(表示はしないが判定は保持する)。
    expect(unselectedConditions(p)).toHaveLength(CONDITION_TOPICS.length - 1);
  });

  it('妊娠(ステップ2の設問)だけを選んだ場合も案内は出さない', () => {
    const p = step1OnlyProfile({
      flags: {
        hasMyNumberCard: false,
        needsNationalHealthInsurance: false,
        needsNationalPension: false,
        hasSchoolOrChildcareNeeds: false,
        hasDog: false,
        dogHasMicrochip: 'unknown',
        needsDisabilityOrCareSupport: false,
        needsForeignResidentGuidance: false,
        needsVehicleGuidance: false,
        isPregnantMember: true,
      },
    });
    expect(hasNoSelectedConditions(p)).toBe(false);
  });

  it('全条件を選んだ場合、未選択は0件で案内も出さない(境界: 全件)', () => {
    const p = step1OnlyProfile({
      flags: {
        hasMyNumberCard: true,
        needsNationalHealthInsurance: true,
        needsNationalPension: true,
        hasSchoolOrChildcareNeeds: true,
        hasDog: true,
        dogHasMicrochip: 'unknown',
        needsDisabilityOrCareSupport: true,
        needsForeignResidentGuidance: true,
        needsVehicleGuidance: true,
        isPregnantMember: true,
      },
    });
    expect(unselectedConditions(p)).toHaveLength(0);
    expect(conditionGapNotice(p).show).toBe(false);
  });

  it('世帯が初期値(単身・成人のみ)なら未入力とみなす', () => {
    expect(isHouseholdUntouched(step1OnlyProfile())).toBe(true);
  });

  it('年齢帯を追加した、または複数人にした世帯は未入力とみなさない', () => {
    expect(
      isHouseholdUntouched(
        step1OnlyProfile({ household: { memberCount: 1, ageBands: ['adult', 'age0_2'] } }),
      ),
    ).toBe(false);
    expect(
      isHouseholdUntouched(
        step1OnlyProfile({ household: { memberCount: 2, ageBands: ['adult'] } }),
      ),
    ).toBe(false);
    // 年齢帯を1つも選ばない世帯(ウィザードでは既定へ倒すが、保存データとしては有り得る)。
    expect(
      isHouseholdUntouched(step1OnlyProfile({ household: { memberCount: 1, ageBands: [] } })),
    ).toBe(false);
  });

  it('プロフィールが無い場合は案内を出さない', () => {
    expect(conditionGapNotice(null)).toEqual({
      show: false,
      unselected: [],
      householdUntouched: false,
    });
  });

  it('ステップ1だけのプロフィールでは案内を出し、世帯未入力も併せて伝える', () => {
    const notice = conditionGapNotice(step1OnlyProfile());
    expect(notice.show).toBe(true);
    expect(notice.householdUntouched).toBe(true);
    expect(notice.unselected.map((t) => t.key)).toContain('hasMyNumberCard');
  });
});

/**
 * なぜ(独立点検): フラグが全て false という保存データは、「ステップ3を飛ばした」利用者と
 * 「ステップ3を開いて、正しく1つも当てはまらなかった」利用者の両方から生じる。
 * 後者は会社の健康保険に入っている単身の成人など、転入者としてごく普通の像であり、
 * その人に「条件チェック（ステップ3）が未入力です」と出すのは事実に反する断定になる。
 * ステップを開いたかという観測事実で両者を切り分けることを、ここで固定する。
 */
describe('conditionGapNotice: 閲覧済みステップの扱い', () => {
  const REVIEWED_BOTH = { household: true, conditions: true };
  const REVIEWED_NEITHER = { household: false, conditions: false };

  it('ステップ3を開いて1つも当てはまらなかった利用者には案内を出さない', () => {
    const notice = conditionGapNotice(step1OnlyProfile(), REVIEWED_BOTH);
    expect(notice.show).toBe(false);
    expect(notice.householdUntouched).toBe(false);
  });

  it('ステップ3を開いていなければ、フラグが同じでも案内を出す', () => {
    expect(conditionGapNotice(step1OnlyProfile(), REVIEWED_NEITHER).show).toBe(true);
  });

  it('ステップ2だけ開いた場合、条件の案内は残り世帯の一文だけ消える', () => {
    const notice = conditionGapNotice(step1OnlyProfile(), {
      household: true,
      conditions: false,
    });
    expect(notice.show).toBe(true);
    expect(notice.householdUntouched).toBe(false);
  });

  it('ステップ3だけ開いた場合、条件の案内は消え世帯の一文は残る', () => {
    const notice = conditionGapNotice(step1OnlyProfile(), {
      household: false,
      conditions: true,
    });
    expect(notice.show).toBe(false);
    expect(notice.householdUntouched).toBe(true);
  });

  it('閲覧記録を渡さない呼び出しは従来どおり案内を出す(修正前に保存された利用者を切り捨てない)', () => {
    expect(conditionGapNotice(step1OnlyProfile()).show).toBe(true);
  });

  it('ステップ3を開いていても、プロフィールが無ければ案内は出ない', () => {
    expect(conditionGapNotice(null, REVIEWED_BOTH).show).toBe(false);
  });
});
