import { describe, expect, it } from 'vitest';
import {
  profileSchema,
  destinationSchema,
  householdSchema,
  flagsSchema,
  ageBandSchema,
} from './profile.js';

/**
 * なぜ: REQUIREMENTS §14.1のチェックリスト生成入力例をfixtureとして使う。
 * 設計判断: 原文の ageBands には "preschool" という値があるが、これは
 * §7.3 Step2で定義された6区分の語彙(age0_2/age3_5/elementary/junior_senior/
 * adult/senior65plus)に含まれない。3〜5歳の未就学児を指すと解釈し "age3_5" に
 * 置き換えている(README「スキーマ ↔ REQUIREMENTS対応表」に記載)。
 * また flags のうち dogHasMicrochip/needsVehicleGuidance/isPregnantMember は
 * §14.1の例に含まれないため、Zodのdefault値で補完される(profile.tsのJSDoc参照)。
 * さらに §14.1 の例の destination.postalCode / town は受け付けない(2026-09-29。ADR-016)。
 * ここでは例からその2項目を除いた形を使い、除かない形が 422 相当で拒まれることは下で固定する。
 */
const requirements141FixtureRaw = {
  destination: {
    municipalityCode: '13112',
  },
  moveDate: '2026-08-15',
  originType: 'outside_tokyo',
  household: {
    memberCount: 3,
    ageBands: ['adult', 'adult', 'age3_5'],
  },
  flags: {
    hasMyNumberCard: true,
    needsNationalHealthInsurance: false,
    needsNationalPension: false,
    hasSchoolOrChildcareNeeds: true,
    hasDog: false,
    needsDisabilityOrCareSupport: false,
    needsForeignResidentGuidance: false,
  },
};

describe('profileSchema — §14.1 fixture', () => {
  it('parses the §14.1 example as-is (normal case)', () => {
    const result = profileSchema.safeParse(requirements141FixtureRaw);
    expect(result.success).toBe(true);
    if (result.success) {
      // defaults fill in fields absent from the abbreviated §14.1 example
      expect(result.data.flags.dogHasMicrochip).toBe('unknown');
      expect(result.data.flags.needsVehicleGuidance).toBe(false);
      expect(result.data.flags.isPregnantMember).toBe(false);
    }
  });
});

describe('destinationSchema', () => {
  it('accepts destination with only municipalityCode', () => {
    expect(destinationSchema.safeParse({ municipalityCode: '13112' }).success).toBe(true);
  });

  it('rejects an invalid municipalityCode', () => {
    expect(destinationSchema.safeParse({ municipalityCode: '1' }).success).toBe(false);
  });

  /**
   * なぜ(ADR-016): どの画面も送らず、どのルールも読まない住所の細目を受け付けない
   * (原則6・7: 要らない住所情報を受け取らない=誤って記録する経路自体を持たない)。
   */
  it.each([{ postalCode: '0000000' }, { town: '例町' }])(
    'rejects address detail the service never uses: %o',
    (extra) => {
      expect(destinationSchema.safeParse({ municipalityCode: '13112', ...extra }).success).toBe(
        false,
      );
    },
  );
});

describe('input size limits', () => {
  it('memberCount は 20 まで(過大な値を拒む)', () => {
    expect(householdSchema.safeParse({ memberCount: 20, ageBands: [] }).success).toBe(true);
    expect(householdSchema.safeParse({ memberCount: 21, ageBands: [] }).success).toBe(false);
  });

  it('ageBands は 20 件まで', () => {
    const bands = (n: number) => Array.from({ length: n }, () => 'adult');
    expect(householdSchema.safeParse({ memberCount: 20, ageBands: bands(20) }).success).toBe(true);
    expect(householdSchema.safeParse({ memberCount: 20, ageBands: bands(21) }).success).toBe(false);
  });
});

describe('ageBandSchema', () => {
  it('rejects a value outside the enum', () => {
    expect(ageBandSchema.safeParse('preschool').success).toBe(false);
  });
});

describe('householdSchema', () => {
  it('rejects memberCount = 0 (boundary)', () => {
    expect(householdSchema.safeParse({ memberCount: 0, ageBands: [] }).success).toBe(false);
  });

  it('rejects a negative memberCount', () => {
    expect(householdSchema.safeParse({ memberCount: -1, ageBands: [] }).success).toBe(false);
  });

  it('accepts memberCount = 1 with empty ageBands', () => {
    expect(householdSchema.safeParse({ memberCount: 1, ageBands: [] }).success).toBe(true);
  });
});

describe('flagsSchema', () => {
  it('accepts dogHasMicrochip = "unknown" (C-10 three-value)', () => {
    const result = flagsSchema.safeParse({
      hasMyNumberCard: false,
      needsNationalHealthInsurance: false,
      needsNationalPension: false,
      hasSchoolOrChildcareNeeds: false,
      hasDog: true,
      dogHasMicrochip: 'unknown',
      needsDisabilityOrCareSupport: false,
      needsForeignResidentGuidance: false,
      needsVehicleGuidance: false,
      isPregnantMember: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid dogHasMicrochip value', () => {
    const result = flagsSchema.safeParse({
      hasMyNumberCard: false,
      needsNationalHealthInsurance: false,
      needsNationalPension: false,
      hasSchoolOrChildcareNeeds: false,
      hasDog: true,
      dogHasMicrochip: 'maybe',
      needsDisabilityOrCareSupport: false,
      needsForeignResidentGuidance: false,
    });
    expect(result.success).toBe(false);
  });
});

describe('profileSchema — invalid inputs', () => {
  it('rejects a non-existent calendar date for moveDate', () => {
    const result = profileSchema.safeParse({
      ...requirements141FixtureRaw,
      moveDate: '2026-02-30',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown originType', () => {
    const result = profileSchema.safeParse({
      ...requirements141FixtureRaw,
      originType: 'from_mars',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required top-level field (household)', () => {
    const { household: _household, ...rest } = requirements141FixtureRaw;
    expect(profileSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an unexpected extra top-level property (strict)', () => {
    const result = profileSchema.safeParse({ ...requirements141FixtureRaw, extra: true });
    expect(result.success).toBe(false);
  });
});

/**
 * なぜ: 前住所地の転出予定日(任意)は API 契約(POST /api/checklists の本体)の変更である。
 * 「項目を持たない既存の保存データがそのまま通ること」と「値が入ったときに暦日として
 * 検証されること」の両方を境界で固定する。未入力を空文字で表さない(項目ごと省く)ことも固定する。
 */
describe('profileSchema — moveOutScheduledDate(前住所地の転出予定日・任意)', () => {
  it('項目が無い既存プロフィールをそのまま受理する(後方互換)', () => {
    const parsed = profileSchema.parse(requirements141FixtureRaw);
    expect(parsed.moveOutScheduledDate).toBeUndefined();
  });

  it('暦日が入っていれば保持する', () => {
    const parsed = profileSchema.parse({
      ...requirements141FixtureRaw,
      moveOutScheduledDate: '2026-08-10',
    });
    expect(parsed.moveOutScheduledDate).toBe('2026-08-10');
  });

  it('存在しない暦日は拒否する(2月30日)', () => {
    expect(
      profileSchema.safeParse({
        ...requirements141FixtureRaw,
        moveOutScheduledDate: '2026-02-30',
      }).success,
    ).toBe(false);
  });

  it('空文字は拒否する(未入力は項目を省いて表現する)', () => {
    expect(
      profileSchema.safeParse({ ...requirements141FixtureRaw, moveOutScheduledDate: '' }).success,
    ).toBe(false);
  });

  it('null は拒否する(「答えなかった」を値として送らない)', () => {
    expect(
      profileSchema.safeParse({ ...requirements141FixtureRaw, moveOutScheduledDate: null }).success,
    ).toBe(false);
  });

  it('引越し日より後の日付でもスキーマは受理する(前後関係は境界で断定しない)', () => {
    // なぜ: 転出予定日は前住所地へ届け出た予定であり、実際の引越し日と前後することがある。
    // どちらが正しいかを境界スキーマが決めつけると、実態どおりの入力を弾いてしまう。
    expect(
      profileSchema.safeParse({
        ...requirements141FixtureRaw,
        moveDate: '2026-08-15',
        moveOutScheduledDate: '2026-08-20',
      }).success,
    ).toBe(true);
  });
});
