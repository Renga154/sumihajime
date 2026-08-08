import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DueRule, OffsetDaysDueRule, Profile, RuleSet } from '@tmn/schemas';
import { ruleSetSchema } from '@tmn/schemas';
import { evaluate } from './evaluate.js';

/**
 * なぜこのファイルがあるか
 * ------------------------------------------------------------------
 * 独立点検で「全条件ONのペルソナでも23区300タスク中、実際に日付が出るのは17%だけ」と
 * 指摘された。原因は推測を避けた誠実な結果だったが、**公式ページが実際に日数を書いている
 * 手続きまで「要確認」になっていた**。とくに次の2つは、算定に必要な日付をアプリが
 * 訊いていなかったために出せていなかった。
 *
 *   1. 児童手当の15日特例 … 多くの区が「前住所地の転出予定日の翌日から15日以内」と明記
 *   2. マイナンバーカードの継続利用 … 「転出予定日から30日以内に転入届」を失効条件に挙げる区
 *
 * 2026-08-09、プロフィールに任意項目 moveOutScheduledDate(前住所地の転出予定日)を足し、
 * ルールDSLの起算日にも追加した。このファイルは、その拡張が
 *
 *   (a) 公式文言に根拠がある区にだけ入っていること(根拠の無い区へ広げていないこと)
 *   (b) 転出予定日が未入力なら、従来どおり日付を出さないこと(推測で埋めないこと)
 *   (c) /api/ward-differences の既存分類と食い違わないこと
 *
 * を23区横断で固定する。区ごとの詳細な文言検証は各区・各バッチのテストが担当する。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const WARDS: readonly string[] = readdirSync(resolve(repoRoot, 'data/normalized'))
  .filter((name) => /^131\d\d$/.test(name))
  .sort();

function ruleSetOf(code: string): RuleSet {
  return ruleSetSchema.parse(
    JSON.parse(readFileSync(resolve(repoRoot, `packages/rules/data/${code}/rules.json`), 'utf-8')),
  );
}

const ruleSets = new Map(WARDS.map((code) => [code, ruleSetOf(code)]));

const CHILD_ALLOWANCE = 'procedure_child_allowance';
const CHILD_MEDICAL = 'procedure_child_medical';
const MYNUMBER = 'procedure_mynumber_continued_use';

/**
 * 児童手当の15日特例で「前住所地の転出予定日」を起算日として公式が明記している19区。
 * 明記していない4区(千代田・新宿・台東=定義自体が無いと明記・北=転入日基準)は入れない。
 */
const CHILD_ALLOWANCE_MOVE_OUT = [
  '13102',
  '13103',
  '13105',
  '13107',
  '13108',
  '13109',
  '13110',
  '13111',
  '13112',
  '13113',
  '13114',
  '13115',
  '13116',
  '13118',
  '13119',
  '13120',
  '13121',
  '13122',
  '13123',
] as const;

/** 子ども医療費助成で「転入日から N日以内」と日数で明記している3区(月単位の区は算定しない)。 */
const CHILD_MEDICAL_DAYS: Record<string, number> = {
  '13113': 14,
  '13115': 15,
  '13119': 14,
};

/**
 * マイナンバーカードの継続利用で、カード失効の条件として区自身が明記した期限のうち、
 * 本サービスが持つ日付(引越し日 / 前住所地の転出予定日)から算定できるもの。
 * 90日そのものは「転入届を出した日」起算で、その日を本サービスは知らないため算定しない。
 */
const MYNUMBER_EXPECTED: Record<string, DueRule> = {
  '13102': earliest(15, 30),
  '13104': earliest(14, 30),
  '13105': moveDate(14),
  '13108': earliest(14, 30),
  '13109': moveDate(14),
  '13111': earliest(14, 30),
  '13112': earliest(14, 30),
  '13113': moveOut(30),
  '13114': moveOut(30),
  '13115': earliest(14, 30),
  '13116': earliest(15, 30),
  '13118': earliest(14, 30),
  '13119': earliest(14, 30),
  '13120': moveOut(30),
  '13121': earliest(14, 30),
  '13122': earliest(14, 30),
  '13123': moveDate(14),
};

function moveDate(days: number): OffsetDaysDueRule {
  return { type: 'offsetDays', from: 'moveDate', days };
}

function moveOut(days: number): OffsetDaysDueRule {
  return { type: 'offsetDays', from: 'moveOutScheduledDate', days };
}

function earliest(moveDateDays: number, moveOutDays: number): DueRule {
  return { type: 'earliestOf', of: [moveDate(moveDateDays), moveOut(moveOutDays)] };
}

function ruleOf(code: string, procedureId: string) {
  return ruleSets.get(code)!.rules.find((r) => r.procedureId === procedureId);
}

/** 全条件ONのペルソナ(独立点検が使った条件と同じ:出せる期日を最大化する入力)。 */
function everythingOn(code: string, moveOutScheduledDate?: string): Profile {
  return {
    destination: { municipalityCode: code },
    moveDate: '2026-09-01',
    ...(moveOutScheduledDate !== undefined ? { moveOutScheduledDate } : {}),
    originType: 'outside_tokyo',
    household: {
      memberCount: 4,
      ageBands: ['age0_2', 'age3_5', 'elementary', 'junior_senior', 'adult', 'senior65plus'],
    },
    flags: {
      hasMyNumberCard: true,
      needsNationalHealthInsurance: true,
      needsNationalPension: true,
      hasSchoolOrChildcareNeeds: true,
      hasDog: true,
      dogHasMicrochip: false,
      needsDisabilityOrCareSupport: true,
      needsForeignResidentGuidance: true,
      needsVehicleGuidance: true,
      isPregnantMember: true,
    },
  };
}

/** そのプロフィールで「該当 or 要確認」として出るタスクのうち、日付が出た件数。 */
function datedTaskCount(code: string, profile: Profile): number {
  return evaluate(profile, ruleSets.get(code)!).outcomes.filter(
    (o) => o.applicable !== 'not_applicable' && o.dueDate !== undefined,
  ).length;
}

describe('前住所地の転出予定日を起算日にするルール — 根拠のある区にだけ入っている', () => {
  it('23区すべてが対象(区が増減したら気づけるようにする)', () => {
    expect(WARDS).toHaveLength(23);
  });

  it.each(WARDS)('%s: 児童手当は「転出予定日が起算」と明記した区だけ算定する', (code) => {
    const rule = ruleOf(code, CHILD_ALLOWANCE);
    expect(rule, code).toBeDefined();
    if ((CHILD_ALLOWANCE_MOVE_OUT as readonly string[]).includes(code)) {
      expect(rule!.dueRule, code).toEqual(moveOut(15));
      // 起算日を転出予定日にしてよい根拠が、その区自身の公式文言に残っていること。
      expect(rule!.dueDescription, code).toContain('転出予定日');
    } else {
      // 北区だけは「事由発生日(出生日・転入日等)」と転入日基準で明記しているため引越し日から算定する。
      const expected = code === '13117' ? moveDate(15) : ({ type: 'unknown' } as const);
      expect(rule!.dueRule, code).toEqual(expected);
    }
  });

  it.each(WARDS)('%s: 子ども医療費助成は日数を明記した区だけ引越し日から算定する', (code) => {
    const rule = ruleOf(code, CHILD_MEDICAL);
    expect(rule, code).toBeDefined();
    const days = CHILD_MEDICAL_DAYS[code];
    if (days !== undefined) {
      expect(rule!.dueRule, code).toEqual(moveDate(days));
      expect(rule!.dueDescription, code).toContain(`${days}日`);
    } else {
      // 月単位(3か月等)や記載なしの区は算定しない。暦月の数え方を推測しないため。
      expect(rule!.dueRule.type, code).toBe('unknown');
    }
  });

  it.each(WARDS)('%s: マイナンバー継続利用は区が書いた失効条件のとおりに算定する', (code) => {
    const rule = ruleOf(code, MYNUMBER);
    expect(rule, code).toBeDefined();
    const expected = MYNUMBER_EXPECTED[code] ?? ({ type: 'unknown' } as const);
    expect(rule!.dueRule, code).toEqual(expected);
  });

  it('子ども医療費: 日数を書いていても『転入日』の意味が区の公式ページで定まらない区は算定しない', () => {
    // 港区・墨田区は「出生・転入日から15日以内」と日数を書いているが、同じ区の児童手当のページは
    // 『転入日=前住所地の転出予定日』と定義している。子ども医療費のページにその定義が無いため、
    // 15日をどちらの日から数えるかを区の公式ページから確定できない。
    // 引越し日から数えると、実際は転出予定日起算だった場合に本当の期限より遅い日を見せてしまう。
    // 比較ページ(/differences)は区が書いた「15日以内」をそのまま表示し、
    // チェックリストは期日を出さない — どちらも区の文言どおりで、食い違いではない。
    for (const code of ['13103', '13107']) {
      const rule = ruleOf(code, CHILD_MEDICAL)!;
      expect(rule.dueRule.type, code).toBe('unknown');
      expect(rule.dueDescription, code).toContain('15日以内');
      expect(rule.dueDescription, code).toContain('定義がない');
    }
  });

  it('転出予定日を起算日にするルールは、必ずその区の公式文言に「転出予定日」か「転出日」がある', () => {
    // なぜ: 起算日は区が書いていることだけを根拠にする。他区の書き方を借りない(原則3・4)。
    let checked = 0;
    for (const code of WARDS) {
      for (const rule of ruleSets.get(code)!.rules) {
        const usesMoveOut = collectOrigins(rule.dueRule).includes('moveOutScheduledDate');
        if (!usesMoveOut) continue;
        checked += 1;
        const text = rule.dueDescription ?? '';
        expect(
          text.includes('転出予定日') || text.includes('転出日'),
          `${code} ${rule.procedureId}`,
        ).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

function collectOrigins(dueRule: DueRule): string[] {
  if (dueRule.type === 'offsetDays') return [dueRule.from];
  if (dueRule.type === 'earliestOf') return dueRule.of.map((r) => r.from);
  return [];
}

describe('転出予定日が未入力なら期日を出さない(推測で埋めない)', () => {
  it.each(WARDS)('%s: 児童手当は転出予定日が無ければ日付なし・入力があれば+15日', (code) => {
    const withoutDate = evaluate(everythingOn(code), ruleSets.get(code)!).outcomes.find(
      (o) => o.procedureId === CHILD_ALLOWANCE,
    )!;
    const withDate = evaluate(everythingOn(code, '2026-08-25'), ruleSets.get(code)!).outcomes.find(
      (o) => o.procedureId === CHILD_ALLOWANCE,
    )!;

    if ((CHILD_ALLOWANCE_MOVE_OUT as readonly string[]).includes(code)) {
      expect(withoutDate.dueDate, code).toBeUndefined();
      // 未入力のときは公式文言(要確認)へフォールバックしていること。
      expect(withoutDate.dueDescription, code).toBeDefined();
      // 2026-08-25 + 15日 = 2026-09-09(月末をまたぐ)。
      expect(withDate.dueDate, code).toBe('2026-09-09');
    } else if (code === '13117') {
      // 北区は引越し日基準のため、転出予定日の有無で結果が変わらない。
      expect(withoutDate.dueDate, code).toBe('2026-09-16');
      expect(withDate.dueDate, code).toBe('2026-09-16');
    } else {
      expect(withoutDate.dueDate, code).toBeUndefined();
      expect(withDate.dueDate, code).toBeUndefined();
    }
  });

  it('マイナンバー継続利用: 転出予定日が早い利用者には、より早い期日を出す', () => {
    // 板橋区は「住み始めた日から14日以内 または 転出予定日から30日以内のどちらか早い期日まで」と
    // 明記している。遅いほうを出すと、期限を過ぎてからカードの失効を知ることになる。
    const withoutDate = evaluate(everythingOn('13119'), ruleSets.get('13119')!).outcomes.find(
      (o) => o.procedureId === MYNUMBER,
    )!;
    expect(withoutDate.dueDate).toBe('2026-09-15'); // 引越し日 9/1 + 14日

    const early = evaluate(
      everythingOn('13119', '2026-08-01'),
      ruleSets.get('13119')!,
    ).outcomes.find((o) => o.procedureId === MYNUMBER)!;
    expect(early.dueDate).toBe('2026-08-31'); // 転出予定日 8/1 + 30日のほうが早い
  });

  it('期日は端末のタイムゾーンに左右されない(Asia/Tokyoの暦日で決まる)', () => {
    const originalTz = process.env.TZ;
    try {
      const results = ['UTC', 'Asia/Tokyo', 'America/New_York', 'Pacific/Kiritimati'].map((tz) => {
        process.env.TZ = tz;
        return evaluate(everythingOn('13119', '2026-08-01'), ruleSets.get('13119')!).outcomes.map(
          (o) => o.dueDate ?? '',
        );
      });
      for (const r of results) expect(r).toEqual(results[0]);
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });
});

describe('期日が出るタスク件数(全条件ONのペルソナ)', () => {
  /**
   * なぜ件数を固定するか: 「期限順のToDo」を掲げる以上、日付が出る件数は中核の指標である。
   * 誰かがルールを緩めて(推測で)件数を増やしても、逆に取りこぼして減っても気づけるようにする。
   * 期待値は区ごとの公式文言から積み上げた結果であり、共通の目標値ではない。
   */
  const EXPECTED_WITHOUT_MOVE_OUT: Record<string, number> = {
    '13101': 2,
    '13102': 3,
    '13103': 2,
    '13104': 4,
    '13105': 3,
    '13106': 2,
    '13107': 3,
    '13108': 3,
    '13109': 3,
    '13110': 3,
    '13111': 3,
    '13112': 3,
    '13113': 3,
    '13114': 3,
    '13115': 4,
    '13116': 3,
    '13117': 3,
    '13118': 3,
    '13119': 5,
    '13120': 2,
    '13121': 3,
    '13122': 3,
    '13123': 4,
  };

  const EXPECTED_WITH_MOVE_OUT: Record<string, number> = {
    '13101': 2,
    '13102': 4,
    '13103': 3,
    '13104': 4,
    '13105': 4,
    '13106': 2,
    '13107': 4,
    '13108': 4,
    '13109': 4,
    '13110': 4,
    '13111': 4,
    '13112': 4,
    '13113': 5,
    '13114': 5,
    '13115': 5,
    '13116': 4,
    '13117': 3,
    '13118': 4,
    '13119': 6,
    '13120': 4,
    '13121': 4,
    '13122': 4,
    '13123': 5,
  };

  it.each(WARDS)('%s: 転出予定日が未入力のときの件数', (code) => {
    expect(datedTaskCount(code, everythingOn(code)), code).toBe(EXPECTED_WITHOUT_MOVE_OUT[code]);
  });

  it.each(WARDS)('%s: 転出予定日を入力したときの件数(未入力より減らない)', (code) => {
    const withDate = datedTaskCount(code, everythingOn(code, '2026-08-25'));
    expect(withDate, code).toBe(EXPECTED_WITH_MOVE_OUT[code]);
    expect(withDate, code).toBeGreaterThanOrEqual(EXPECTED_WITHOUT_MOVE_OUT[code]!);
  });

  it('23区合計: 改修前55 → 転出予定日なし70 / 転出予定日ありは92(全322タスク中)', () => {
    // 改修前の55は、この改修の直前コミット(7d10110)の rules.json を同じペルソナで評価した実測値。
    const sumWithout = WARDS.reduce((n, c) => n + datedTaskCount(c, everythingOn(c)), 0);
    const sumWith = WARDS.reduce((n, c) => n + datedTaskCount(c, everythingOn(c, '2026-08-25')), 0);
    expect(sumWithout).toBe(70);
    expect(sumWith).toBe(92);

    const total = WARDS.reduce(
      (n, c) =>
        n +
        evaluate(everythingOn(c), ruleSets.get(c)!).outcomes.filter(
          (o) => o.applicable !== 'not_applicable',
        ).length,
      0,
    );
    expect(total).toBe(322);
  });
});
