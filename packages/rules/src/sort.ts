import type { Priority, RuleOutcome } from '@tmn/schemas';

/**
 * なぜ: FR-006(チェックリスト表示準備)の並び替え規則。期限がある項目は昇順、
 * 期限のない項目(needs_confirmation・生活開始系のdueDescriptionのみの項目)は
 * 優先度順で後置する。表示ロジック(UI側のグルーピング等)はここに含めない。
 */
const PRIORITY_RANK: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  optional: 3,
};

function compareIsoDate(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** なぜ: Array#sortは安定ソート(ECMA-262)であるため、同着時は入力順を保持する。 */
export function sortOutcomesByDue(outcomes: RuleOutcome[]): RuleOutcome[] {
  const withDue = outcomes.filter((o) => o.dueDate !== undefined);
  const withoutDue = outcomes.filter((o) => o.dueDate === undefined);

  const sortedWithDue = [...withDue].sort((a, b) =>
    compareIsoDate(a.dueDate as string, b.dueDate as string),
  );
  const sortedWithoutDue = [...withoutDue].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
  );

  return [...sortedWithDue, ...sortedWithoutDue];
}
