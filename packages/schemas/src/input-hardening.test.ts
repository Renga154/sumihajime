import { describe, expect, it } from 'vitest';
import { profileSchema, PROFILE_DATE_MAX, PROFILE_DATE_MIN } from './profile.js';
import { generatedTaskSchema, procedureIdSchema } from './task.js';
import {
  chatRequestSchema,
  facilityCategoryQuerySchema,
  FACILITY_CATEGORIES,
  WASTE_SORTING_QUERY_MAX_LENGTH,
  wasteSortingQuerySchema,
} from './api.js';

/**
 * 入力検証の強化(2026-10-02 監査)。サーバーの検証と画面の制限を同じ定数から作り、
 * 「画面では入れられない値がサーバーでは通る(またはその逆)」ずれを無くす。
 */

const baseProfile = {
  destination: { municipalityCode: '13112' },
  moveDate: '2026-08-15',
  originType: 'outside_tokyo',
  household: { memberCount: 1, ageBands: ['adult'] },
  flags: {
    hasMyNumberCard: true,
    needsNationalHealthInsurance: false,
    needsNationalPension: false,
    hasSchoolOrChildcareNeeds: false,
    hasDog: false,
    needsDisabilityOrCareSupport: false,
    needsForeignResidentGuidance: false,
  },
};

describe('profileSchema — 日付の範囲', () => {
  it.each(['9999-12-31', '0001-01-01', '0099-12-31', '1999-12-31', '2101-01-01'])(
    '攻撃: moveDate=%s は拒否(以前は期限計算で 500 になった)',
    (moveDate) => {
      expect(profileSchema.safeParse({ ...baseProfile, moveDate }).success).toBe(false);
    },
  );

  it.each(['9999-12-31', '0001-01-01'])('攻撃: moveOutScheduledDate=%s も拒否', (d) => {
    expect(profileSchema.safeParse({ ...baseProfile, moveOutScheduledDate: d }).success).toBe(
      false,
    );
  });

  it('境界: 範囲の両端は受理する', () => {
    expect(profileSchema.safeParse({ ...baseProfile, moveDate: PROFILE_DATE_MIN }).success).toBe(
      true,
    );
    expect(profileSchema.safeParse({ ...baseProfile, moveDate: PROFILE_DATE_MAX }).success).toBe(
      true,
    );
  });

  it('正常: 過去に保存したプロフィール(引越し日が過去)は端末から読み直せる', () => {
    // 画面の受付範囲は「今日の前後1年」。1年以上前に保存した控えも、同じスキーマで読み直す
    // (storage.ts loadProfile)。サーバーの範囲は画面より必ず広く取ってあるので落ちない。
    const saved = { ...baseProfile, moveDate: '2025-04-01', moveOutScheduledDate: '2025-03-20' };
    expect(profileSchema.safeParse(saved).success).toBe(true);
  });

  it('正常: 転出予定日が引越し日より後でも受理する(前後関係は画面も強制していない)', () => {
    expect(
      profileSchema.safeParse({
        ...baseProfile,
        moveDate: '2026-08-01',
        moveOutScheduledDate: '2026-08-20',
      }).success,
    ).toBe(true);
  });
});

describe('procedureIdSchema', () => {
  it.each([
    'procedure_resident_registration',
    'procedure_mynumber_continued_use',
    'task_procedure_child_allowance',
    'has-due',
  ])('正常: %s', (id) => {
    expect(procedureIdSchema.safeParse(id).success).toBe(true);
  });

  it.each([
    '',
    '公式発表:こちらへ https://evil.example',
    '../etc/passwd',
    'Procedure_Upper',
    'a b',
    'x'.repeat(81),
  ])('攻撃: %j は拒否', (id) => {
    expect(procedureIdSchema.safeParse(id).success).toBe(false);
  });

  it('タスクの id / procedureId にも同じ形を課す', () => {
    const shape = generatedTaskSchema.shape;
    expect(shape.id.safeParse('task_procedure_x').success).toBe(true);
    expect(shape.id.safeParse('<script>').success).toBe(false);
    expect(shape.procedureId.safeParse('procedure x').success).toBe(false);
  });
});

describe('ごみ分別の検索語', () => {
  it('上限ちょうどは受理し、1文字超えは拒否する', () => {
    expect(
      wasteSortingQuerySchema.safeParse('あ'.repeat(WASTE_SORTING_QUERY_MAX_LENGTH)).success,
    ).toBe(true);
    expect(
      wasteSortingQuerySchema.safeParse('あ'.repeat(WASTE_SORTING_QUERY_MAX_LENGTH + 1)).success,
    ).toBe(false);
  });

  it('攻撃: 2000文字は拒否', () => {
    expect(wasteSortingQuerySchema.safeParse('a'.repeat(2000)).success).toBe(false);
  });
});

describe('窓口のカテゴリ(許可リスト)', () => {
  it.each(FACILITY_CATEGORIES)('正常: %s', (category) => {
    expect(facilityCategoryQuerySchema.safeParse(category).success).toBe(true);
  });

  it.each(['', 'x'.repeat(500), "出張所' OR 1=1 --", '本庁舎 '])('攻撃: %j は拒否', (category) => {
    expect(facilityCategoryQuerySchema.safeParse(category).success).toBe(false);
  });
});

describe('chatRequestSchema.question', () => {
  it.each(['', ' ', '   \n\t ', '　'])('攻撃: 空白だけの質問 %j は拒否', (question) => {
    expect(chatRequestSchema.safeParse({ municipalityCode: '13112', question }).success).toBe(
      false,
    );
  });

  it('正常: 前後の空白は落として受理する', () => {
    const parsed = chatRequestSchema.safeParse({
      municipalityCode: '13112',
      question: '  転入届はいつまで？ ',
    });
    expect(parsed.success && parsed.data.question).toBe('転入届はいつまで？');
  });

  it('境界: 500字は受理、501字は拒否', () => {
    const ok = chatRequestSchema.safeParse({
      municipalityCode: '13112',
      question: 'あ'.repeat(500),
    });
    const ng = chatRequestSchema.safeParse({
      municipalityCode: '13112',
      question: 'あ'.repeat(501),
    });
    expect(ok.success).toBe(true);
    expect(ng.success).toBe(false);
  });
});
