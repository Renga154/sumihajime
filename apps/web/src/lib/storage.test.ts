import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearWizardDraft,
  isDone,
  isSameWizardAnswers,
  loadDone,
  loadProfile,
  loadReviewedSteps,
  loadWizardDraft,
  saveDone,
  saveReviewedSteps,
  saveWizardDraft,
  toggleDone,
  type WizardAnswers,
  type WizardDraft,
} from './storage';

/**
 * なぜ: VS1受入6 / FR-010・FR-011 / C-4。完了状態が procedureId キーで永続化され、
 * 条件変更で非該当になっても記録は消えず、再該当時に復元されることを固定する。
 */

const CODE = '13112';

beforeEach(() => {
  localStorage.clear();
});

describe('完了状態(C-4)', () => {
  it('チェックすると localStorage に procedureId キーで保存され、リロード相当でも復元される', () => {
    let map = loadDone(CODE);
    expect(isDone(map, 'procedure_a')).toBe(false);

    map = toggleDone(map, 'procedure_a', 'v1', true);
    saveDone(CODE, map);

    // リロード相当: 別途 loadDone しても残っている。
    const reloaded = loadDone(CODE);
    expect(isDone(reloaded, 'procedure_a')).toBe(true);
    expect(reloaded['procedure_a']?.ruleVersion).toBe('v1');
  });

  it('非該当になっても完了記録は削除されず、再該当時に復元される', () => {
    // procedure_a を完了にする。
    const map = toggleDone(loadDone(CODE), 'procedure_a', 'v1', true);
    saveDone(CODE, map);

    // 条件変更で現在のタスク一覧が procedure_b のみになった状況を模倣。
    // storage 側は現在の一覧に関与しないため、procedure_a の記録はそのまま残る。
    const currentTasks1 = ['procedure_b'];
    const visibleDone1 = currentTasks1.filter((id) => isDone(loadDone(CODE), id));
    expect(visibleDone1).toEqual([]); // 非表示(=UIに出ない)だが…
    expect(isDone(loadDone(CODE), 'procedure_a')).toBe(true); // …記録は消えていない。

    // 再び procedure_a が該当した状況。完了状態が復元される。
    const currentTasks2 = ['procedure_a', 'procedure_b'];
    const visibleDone2 = currentTasks2.filter((id) => isDone(loadDone(CODE), id));
    expect(visibleDone2).toEqual(['procedure_a']);
  });

  it('チェックを外すと記録を削除する', () => {
    let map = toggleDone(loadDone(CODE), 'procedure_a', 'v1', true);
    saveDone(CODE, map);
    map = toggleDone(map, 'procedure_a', 'v1', false);
    saveDone(CODE, map);
    expect(isDone(loadDone(CODE), 'procedure_a')).toBe(false);
  });
});

/**
 * なぜ: 任意ステップの閲覧記録は「未入力です」という断定を出すかどうかの唯一の根拠になる。
 * 記録が無い/壊れている場合に true 側へ倒れると、実際には見ていない利用者への案内が
 * 黙って消える。既定は必ず false(=未閲覧)であることを固定する。
 */
describe('任意ステップの閲覧記録', () => {
  it('記録が無い自治体では両方 false を返す', () => {
    expect(loadReviewedSteps(CODE)).toEqual({ household: false, conditions: false });
  });

  it('保存した内容がリロード相当でも復元される', () => {
    saveReviewedSteps(CODE, { household: true, conditions: true });
    expect(loadReviewedSteps(CODE)).toEqual({ household: true, conditions: true });
  });

  it('自治体ごとに独立して保持される(別の区の記録を流用しない)', () => {
    saveReviewedSteps(CODE, { household: true, conditions: true });
    expect(loadReviewedSteps('13101')).toEqual({ household: false, conditions: false });
  });

  it('壊れたJSON・想定外の型は未閲覧として扱う', () => {
    localStorage.setItem(`tmn:reviewed-steps:${CODE}`, '{壊れた');
    expect(loadReviewedSteps(CODE)).toEqual({ household: false, conditions: false });

    localStorage.setItem(`tmn:reviewed-steps:${CODE}`, '"文字列"');
    expect(loadReviewedSteps(CODE)).toEqual({ household: false, conditions: false });

    // 真偽値以外(例: 文字列 "true")を true と解釈しない。
    localStorage.setItem(`tmn:reviewed-steps:${CODE}`, '{"household":"true","conditions":1}');
    expect(loadReviewedSteps(CODE)).toEqual({ household: false, conditions: false });
  });
});

/**
 * なぜ: ウィザードの入力途中がリロードで消えていた。復元のために保存するが、確定前の値が
 * 確定プロフィールとして扱われると、利用者が見ていない条件でチェックリストの中身が変わる。
 * 別キー(tmn:wizard-draft:<code>)であること、確定側を汚さないことを固定する。
 */
describe('ウィザードの下書き', () => {
  const ANSWERS: WizardAnswers = {
    moveDate: '2026-08-15',
    moveOutScheduledDate: '2026-08-10',
    originType: 'outside_tokyo',
    householdKind: 'multiple',
    ageBands: ['adult', 'age0_2'],
    isPregnant: false,
    flags: {
      hasMyNumberCard: true,
      needsNationalHealthInsurance: false,
      needsNationalPension: false,
      hasSchoolOrChildcareNeeds: false,
      hasDog: false,
      needsDisabilityOrCareSupport: false,
      needsForeignResidentGuidance: false,
      needsVehicleGuidance: false,
    },
    dogMicrochip: 'unknown',
  };
  const DRAFT: WizardDraft = {
    answers: ANSWERS,
    step: 2,
    reviewedSteps: { household: true, conditions: false },
  };

  it('保存した下書きがリロード相当でも復元される', () => {
    expect(loadWizardDraft(CODE)).toBeNull();
    saveWizardDraft(CODE, DRAFT);
    expect(loadWizardDraft(CODE)).toEqual(DRAFT);
  });

  it('確定プロフィールとは別のキーに入り、確定側を書き換えない', () => {
    saveWizardDraft(CODE, DRAFT);
    expect(localStorage.getItem(`tmn:wizard-draft:${CODE}`)).not.toBeNull();
    expect(localStorage.getItem(`tmn:profile:${CODE}`)).toBeNull();
    expect(loadProfile(CODE)).toBeNull();
  });

  it('自治体ごとに独立して保持される(別の区の下書きを流用しない)', () => {
    saveWizardDraft(CODE, DRAFT);
    expect(loadWizardDraft('13101')).toBeNull();
  });

  it('破棄すると消える', () => {
    saveWizardDraft(CODE, DRAFT);
    clearWizardDraft(CODE);
    expect(loadWizardDraft(CODE)).toBeNull();
  });

  it('壊れたJSON・スキーマ違反は「下書き無し」として扱う(確定値へ混ぜない)', () => {
    localStorage.setItem(`tmn:wizard-draft:${CODE}`, '{壊れた');
    expect(loadWizardDraft(CODE)).toBeNull();

    // 未知の転入元区分・不正な日付・範囲外のステップはいずれも受け付けない。
    localStorage.setItem(
      `tmn:wizard-draft:${CODE}`,
      JSON.stringify({ ...DRAFT, answers: { ...ANSWERS, originType: 'mars' } }),
    );
    expect(loadWizardDraft(CODE)).toBeNull();

    localStorage.setItem(
      `tmn:wizard-draft:${CODE}`,
      JSON.stringify({ ...DRAFT, answers: { ...ANSWERS, moveDate: '2026/08/15' } }),
    );
    expect(loadWizardDraft(CODE)).toBeNull();

    localStorage.setItem(`tmn:wizard-draft:${CODE}`, JSON.stringify({ ...DRAFT, step: 9 }));
    expect(loadWizardDraft(CODE)).toBeNull();
  });

  it('未入力(空の引越し日・転入元)も下書きとして保持できる', () => {
    const partial: WizardDraft = {
      ...DRAFT,
      answers: { ...ANSWERS, moveDate: '', originType: '' },
    };
    saveWizardDraft(CODE, partial);
    expect(loadWizardDraft(CODE)).toEqual(partial);
  });

  /**
   * なぜ: 保存するのは確定プロフィールと同じ範囲(引越し日・転入元区分・世帯・条件)だけで、
   * 氏名・電話・メール・番地・生年月日・マイナンバーは入力欄自体が無い(原則6・7)。
   * スキーマが未知のキーを落とすことで、将来うっかり足しても保存先へ漏れない。
   */
  it('スキーマに無いキーは保存内容から落ちる', () => {
    localStorage.setItem(
      `tmn:wizard-draft:${CODE}`,
      JSON.stringify({
        ...DRAFT,
        answers: { ...ANSWERS, fullName: '山田太郎', address: '東京都世田谷区○○1-2-3' },
      }),
    );
    const loaded = loadWizardDraft(CODE);
    expect(loaded).not.toBeNull();
    expect(JSON.stringify(loaded)).not.toContain('山田');
    expect(JSON.stringify(loaded)).not.toContain('1-2-3');
  });

  /**
   * なぜ: 前住所地の転出予定日は 2026-08-09 に足した任意項目。項目を持たない古い下書きが
   * 「下書き無し」に倒れると、利用者が入力途中だった他の回答まで消えてしまう。
   */
  it('転出予定日を持たない古い下書きも読める(未入力として復元される)', () => {
    const { moveOutScheduledDate: _omit, ...legacyAnswers } = ANSWERS;
    localStorage.setItem(
      `tmn:wizard-draft:${CODE}`,
      JSON.stringify({ ...DRAFT, answers: legacyAnswers }),
    );
    const loaded = loadWizardDraft(CODE);
    expect(loaded).not.toBeNull();
    expect(loaded?.answers.moveOutScheduledDate).toBe('');
    expect(loaded?.answers.moveDate).toBe(ANSWERS.moveDate);
  });

  it('転出予定日の未入力(空文字)も下書きとして保持できる', () => {
    const partial: WizardDraft = {
      ...DRAFT,
      answers: { ...ANSWERS, moveOutScheduledDate: '' },
    };
    saveWizardDraft(CODE, partial);
    expect(loadWizardDraft(CODE)).toEqual(partial);
  });

  it('isSameWizardAnswers は年齢帯の並び順の違いを同じ内容とみなす', () => {
    expect(isSameWizardAnswers(ANSWERS, { ...ANSWERS, ageBands: ['age0_2', 'adult'] })).toBe(true);
    expect(isSameWizardAnswers(ANSWERS, { ...ANSWERS, ageBands: ['adult'] })).toBe(false);
    expect(isSameWizardAnswers(ANSWERS, { ...ANSWERS, moveDate: '2026-08-16' })).toBe(false);
    expect(isSameWizardAnswers(ANSWERS, { ...ANSWERS, moveOutScheduledDate: '' })).toBe(false);
  });
});
