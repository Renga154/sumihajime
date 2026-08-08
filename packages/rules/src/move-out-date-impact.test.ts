import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Profile, RuleSet } from '@tmn/schemas';
import { ruleSetSchema } from '@tmn/schemas';
import { evaluate } from './evaluate.js';
import { moveOutScheduledDateImpact } from './move-out-date-impact.js';
import { MunicipalityScopeMismatchError } from './errors.js';

/**
 * なぜこのファイルがあるか
 * ------------------------------------------------------------------
 * 前住所地の転出予定日は任意入力(ADR-013)なので、多くの利用者は空欄のまま進み、
 * 「入れれば期限が日付で出せる」と知らないまま「期限は要確認」を見ることになる。
 * チェックリスト画面から案内するにあたり、**誰に出して誰に出さないか**をここで固定する。
 *
 * 案内の価値は厳密さで決まる。関係の無い人に出せば読まれなくなるため、
 * 「その人のチェックリストに、転出予定日を起算日とする手続きが実際にある」ときだけ出す。
 * 判定材料は区のルールデータだけで、画面には区コードの分岐を一切書かない(CLAUDE.md §4)。
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
const MYNUMBER = 'procedure_mynumber_continued_use';

/** 全条件ONのペルソナ(ADR-013の計測と同じ入力。出せる期日を最大化する)。 */
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

/** ステップ2・3を通らずに生成した既定のプロフィール(単身の成人・条件なし)。 */
function step1Only(code: string): Profile {
  return {
    destination: { municipalityCode: code },
    moveDate: '2026-09-01',
    originType: 'outside_tokyo',
    household: { memberCount: 1, ageBands: ['adult'] },
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
      isPregnantMember: false,
    },
  };
}

/** マイナンバーカードだけを持つ単身者(子育て条件なし)。 */
function cardOnly(code: string): Profile {
  const base = step1Only(code);
  return { ...base, flags: { ...base.flags, hasMyNumberCard: true } };
}

/**
 * 全条件ONのペルソナで案内に出る手続き(実測値。23区ぶんを1件ずつ固定する)。
 *
 * enables … いまは期日が出ておらず、転出予定日を入れると日付が出る手続き
 * advances … 既に日付は出ているが、入れるとより早い期日に変わりうる手続き(earliestOf)
 *
 * この表は区の公式文言から積み上げたルールデータの結果であって、目標値ではない。
 * ルールを緩めて(推測で)案内を増やしても、取りこぼして減らしても、ここで気づける。
 */
const EXPECTED: Record<string, { enables: string[]; advances: string[] }> = {
  // 千代田: 児童手当もマイナンバーも転出予定日起算の記載が無い(=案内を出さない区)。
  '13101': { enables: [], advances: [] },
  '13102': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  '13103': { enables: [CHILD_ALLOWANCE], advances: [] },
  // 新宿: 児童手当は転出予定日起算でないが、マイナンバーが earliestOf(引越し日+14/転出予定日+30)。
  '13104': { enables: [], advances: [MYNUMBER] },
  '13105': { enables: [CHILD_ALLOWANCE], advances: [] },
  // 台東: 区自身が「継続利用の期限を確認できない」と明記。児童手当も転出予定日起算でない。
  '13106': { enables: [], advances: [] },
  '13107': { enables: [CHILD_ALLOWANCE], advances: [] },
  '13108': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  '13109': { enables: [CHILD_ALLOWANCE], advances: [] },
  '13110': { enables: [CHILD_ALLOWANCE], advances: [] },
  '13111': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  '13112': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  // 渋谷・中野・練馬: マイナンバーの期限が転出予定日+30日のみ(引越し日からは算定できない)。
  '13113': { enables: [MYNUMBER, CHILD_ALLOWANCE], advances: [] },
  '13114': { enables: [MYNUMBER, CHILD_ALLOWANCE], advances: [] },
  '13115': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  '13116': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  // 北: 児童手当は「事由発生日(転入日)」起算と明記、マイナンバーは期限の記載なし。
  '13117': { enables: [], advances: [] },
  '13118': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  '13119': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  '13120': { enables: [MYNUMBER, CHILD_ALLOWANCE], advances: [] },
  '13121': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  '13122': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  '13123': { enables: [CHILD_ALLOWANCE], advances: [] },
};

function impactOf(code: string, profile: Profile) {
  return moveOutScheduledDateImpact(profile, ruleSets.get(code)!);
}

function shows(code: string, profile: Profile): boolean {
  const i = impactOf(code, profile);
  return i.enablesDueDateFor.length + i.advancesDueDateFor.length > 0;
}

describe('転出予定日を入れると何が変わるか — 23区の実測', () => {
  it('23区すべてが対象(区が増減したら気づけるようにする)', () => {
    expect(WARDS).toHaveLength(23);
  });

  it.each(WARDS)('%s: 全条件ONのペルソナで案内に出る手続き', (code) => {
    const impact = impactOf(code, everythingOn(code));
    expect(impact.enablesDueDateFor, code).toEqual(EXPECTED[code]!.enables);
    expect(impact.advancesDueDateFor, code).toEqual(EXPECTED[code]!.advances);
  });

  it('案内が出るのは20区、出ないのは千代田・台東・北の3区', () => {
    const on = WARDS.filter((c) => shows(c, everythingOn(c)));
    const off = WARDS.filter((c) => !shows(c, everythingOn(c)));
    expect(on).toHaveLength(20);
    expect(off).toEqual(['13101', '13106', '13117']);
  });

  it('出ない3区は、転出予定日を起算日とするルールを1件も持たない', () => {
    // 「案内を出さない」の根拠が区コードの決め打ちではなく、ルールデータの事実であること。
    for (const code of ['13101', '13106', '13117']) {
      const uses = ruleSets
        .get(code)!
        .rules.filter((r) => JSON.stringify(r.dueRule).includes('moveOutScheduledDate'));
      expect(uses, code).toHaveLength(0);
    }
  });

  it('23区合計で、日付を出せるようになる手続きは22件(ADR-013の実測 70→92 と一致する)', () => {
    const enables = WARDS.reduce(
      (n, c) => n + impactOf(c, everythingOn(c)).enablesDueDateFor.length,
      0,
    );
    expect(enables).toBe(22);
  });
});

describe('無関係な利用者には出さない(案内の価値を守る)', () => {
  it.each(WARDS)('%s: ステップ1だけで生成した単身の成人には出ない', (code) => {
    // 児童手当は子どもがいないため not_applicable、マイナンバーはカードを持っていない。
    // その人にとっては転出予定日を入れても何も変わらないので、案内を出す理由が無い。
    expect(shows(code, step1Only(code)), code).toBe(false);
  });

  it.each(WARDS)('%s: 転出予定日が入力済みなら、これ以上得られるものが無いので出ない', (code) => {
    const impact = impactOf(code, everythingOn(code, '2026-08-25'));
    expect(impact.enablesDueDateFor, code).toEqual([]);
    expect(impact.advancesDueDateFor, code).toEqual([]);
  });

  it('マイナンバーカードだけを持つ単身者には、マイナンバーの1件だけを出す(児童手当は出さない)', () => {
    // 練馬(転出予定日+30日のみ)は enables に、板橋(earliestOf)は advances に入る。
    expect(impactOf('13120', cardOnly('13120'))).toEqual({
      enablesDueDateFor: [MYNUMBER],
      advancesDueDateFor: [],
    });
    expect(impactOf('13119', cardOnly('13119'))).toEqual({
      enablesDueDateFor: [],
      advancesDueDateFor: [MYNUMBER],
    });
    // 児童手当しか該当ルールが無い区では、この人に案内は出ない。
    expect(shows('13123', cardOnly('13123'))).toBe(false);
  });

  it('選択自治体と異なるルールセットで判定しようとしたら評価を進めない(原則4)', () => {
    expect(() => moveOutScheduledDateImpact(everythingOn('13112'), ruleSets.get('13120')!)).toThrow(
      MunicipalityScopeMismatchError,
    );
  });
});

describe('案内の内容が、実際の再評価結果と食い違わない', () => {
  const MOVE_OUT = '2026-08-25';

  it.each(WARDS)('%s: enables に挙げた手続きは、入力すると必ず日付が出る', (code) => {
    const before = evaluate(everythingOn(code), ruleSets.get(code)!).outcomes;
    const after = evaluate(everythingOn(code, MOVE_OUT), ruleSets.get(code)!).outcomes;
    const impact = impactOf(code, everythingOn(code));

    for (const id of impact.enablesDueDateFor) {
      const b = before.find((o) => o.procedureId === id)!;
      const a = after.find((o) => o.procedureId === id)!;
      expect(b.dueDate, `${code} ${id}`).toBeUndefined();
      expect(a.dueDate, `${code} ${id}`).toBeDefined();
    }
  });

  it.each(WARDS)('%s: advances に挙げた手続きは、入力しても期日が遅くならない', (code) => {
    const before = evaluate(everythingOn(code), ruleSets.get(code)!).outcomes;
    const impact = impactOf(code, everythingOn(code));

    for (const id of impact.advancesDueDateFor) {
      const b = before.find((o) => o.procedureId === id)!;
      expect(b.dueDate, `${code} ${id}`).toBeDefined();
      // 転出予定日が引越し日より前でも後でも、earliestOf は最も早い候補を採る。
      for (const moveOut of ['2026-07-01', '2026-08-25', '2026-09-01']) {
        const a = evaluate(everythingOn(code, moveOut), ruleSets.get(code)!).outcomes.find(
          (o) => o.procedureId === id,
        )!;
        expect(a.dueDate! <= b.dueDate!, `${code} ${id} ${moveOut}`).toBe(true);
      }
    }
  });

  it.each(WARDS)('%s: 案内に出す手続きは、必ずチェックリストに載るタスクである', (code) => {
    const shown = new Set(
      evaluate(everythingOn(code), ruleSets.get(code)!)
        .outcomes.filter((o) => o.applicable !== 'not_applicable')
        .map((o) => o.procedureId),
    );
    const impact = impactOf(code, everythingOn(code));
    for (const id of [...impact.enablesDueDateFor, ...impact.advancesDueDateFor]) {
      expect(shown.has(id), `${code} ${id}`).toBe(true);
    }
  });
});

describe('要確認(needs_confirmation)のタスクも案内の対象にする', () => {
  /**
   * なぜ: 判定材料が揃わず needs_confirmation になったタスクもチェックリストには載り、
   * 「期限は要確認」と表示される。載っている以上、期日を出せる手段があるなら伝えるべきで、
   * not_applicable(そもそも載らない)と同じ扱いにはしない。
   * 実データにこの組み合わせが無いため、DSLの分岐として固定する。
   */
  const ruleSet: RuleSet = {
    municipalityCode: '13112',
    ruleVersion: 'test-1',
    rules: [
      {
        procedureId: 'procedure_unknown_flag',
        condition: { predicate: 'flagEquals', flag: 'dogHasMicrochip', equals: true },
        priority: 'normal',
        dueRule: { type: 'offsetDays', from: 'moveOutScheduledDate', days: 15 },
        dueDescription: '転出予定日の翌日から15日以内',
        sourceIds: ['src-13112-test-001'],
        applicabilityReasonTemplate: 'テスト用',
      },
    ],
  };

  it('3値のunknownに帰着するルールでも、転出予定日で期日を出せるなら案内に含める', () => {
    const profile = everythingOn('13112');
    profile.flags.dogHasMicrochip = 'unknown';
    expect(evaluate(profile, ruleSet).outcomes[0]!.applicable).toBe('needs_confirmation');
    expect(moveOutScheduledDateImpact(profile, ruleSet).enablesDueDateFor).toEqual([
      'procedure_unknown_flag',
    ]);
  });

  it('条件がfalseに確定したタスク(チェックリストに載らない)は含めない', () => {
    const profile = everythingOn('13112');
    profile.flags.dogHasMicrochip = false;
    expect(evaluate(profile, ruleSet).outcomes[0]!.applicable).toBe('not_applicable');
    expect(moveOutScheduledDateImpact(profile, ruleSet).enablesDueDateFor).toEqual([]);
  });
});
