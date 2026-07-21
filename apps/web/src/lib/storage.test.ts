import { beforeEach, describe, expect, it } from 'vitest';
import { isDone, loadDone, saveDone, toggleDone } from './storage';

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
