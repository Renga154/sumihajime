import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { ChecklistResponse, Profile } from '@tmn/schemas';
import { checklistResponseSchema } from '@tmn/schemas';
import { MUNICIPALITIES } from '@tmn/publish';
import { createTestDb, type TestDb } from '../test/d1-harness.js';
import { app } from './index.js';

/**
 * なぜ: チェックリスト画面の「転出予定日を入れると期限を日付で出せます」の案内は、
 * どの区でどの手続きが該当するかを **API 応答(moveOutScheduledDateImpact)** だけから決める。
 * 画面に区コードの分岐を書かない代わりに、この応答が公開済みD1(承認ゲートを通したシード)で
 * 実際に何を返すかを23区ぶん通しで固定する。
 *
 * ここが packages/rules のユニットテストと別に要る理由: publish は verified の手続きだけを
 * 公開するため、rules.json にあるルールが D1 に無いことがありうる。案内に出す手続きが
 * 「実際に公開されていて、そのタスクがチェックリストに載る」ことは、公開経路で確かめないと
 * 保証できない(原則9: 未整備を整備済みに見せない)。
 */

const WARD_CODES = MUNICIPALITIES.filter((m) => m.supported && /^131\d\d$/.test(m.code))
  .map((m) => m.code)
  .sort();

let harness: TestDb;
let db: D1Database;

beforeAll(async () => {
  harness = await createTestDb(WARD_CODES);
  db = harness.db as unknown as D1Database;
}, 180_000);

afterAll(async () => {
  await harness.dispose();
});

const CHILD_ALLOWANCE = 'procedure_child_allowance';
const MYNUMBER = 'procedure_mynumber_continued_use';

/** 全条件ONのペルソナ(ADR-013の計測と同じ入力)。 */
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

async function getChecklist(profile: Profile): Promise<ChecklistResponse> {
  const res = await app.request(
    '/api/checklists',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(profile),
    },
    { DB: db },
  );
  expect(res.status).toBe(200);
  // 応答契約(@tmn/schemas)で境界検証する。
  return checklistResponseSchema.parse(await res.json());
}

/** 全条件ONのペルソナに対して、公開済みD1が返す案内対象(23区の実測)。 */
const EXPECTED: Record<string, { enables: string[]; advances: string[] }> = {
  '13101': { enables: [], advances: [] }, // 千代田: 該当ルールなし
  '13102': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  '13103': { enables: [CHILD_ALLOWANCE], advances: [] },
  '13104': { enables: [], advances: [MYNUMBER] }, // 新宿: 期日は既に出るが早まりうる
  '13105': { enables: [CHILD_ALLOWANCE], advances: [] },
  '13106': { enables: [], advances: [] }, // 台東: 該当ルールなし
  '13107': { enables: [CHILD_ALLOWANCE], advances: [] },
  '13108': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  '13109': { enables: [CHILD_ALLOWANCE], advances: [] },
  '13110': { enables: [CHILD_ALLOWANCE], advances: [] },
  '13111': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  '13112': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  '13113': { enables: [MYNUMBER, CHILD_ALLOWANCE], advances: [] },
  '13114': { enables: [MYNUMBER, CHILD_ALLOWANCE], advances: [] },
  '13115': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  '13116': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  '13117': { enables: [], advances: [] }, // 北: 該当ルールなし(児童手当は転入日基準)
  '13118': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  '13119': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  '13120': { enables: [MYNUMBER, CHILD_ALLOWANCE], advances: [] },
  '13121': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  '13122': { enables: [CHILD_ALLOWANCE], advances: [MYNUMBER] },
  '13123': { enables: [CHILD_ALLOWANCE], advances: [] },
};

describe('POST /api/checklists — 転出予定日で何が変わるか(公開済みD1・23区)', () => {
  it('対応している23特別区すべてを検証対象にする', () => {
    expect(WARD_CODES).toHaveLength(23);
  });

  it.each(WARD_CODES)('%s: 案内に出す手続きが公開データと一致する', async (code) => {
    const body = await getChecklist(everythingOn(code));
    const impact = body.moveOutScheduledDateImpact;
    expect(impact, code).toBeDefined();
    expect(impact!.enablesDueDateFor, code).toEqual(EXPECTED[code]!.enables);
    expect(impact!.advancesDueDateFor, code).toEqual(EXPECTED[code]!.advances);

    // 案内に出す手続きは必ずチェックリストに載っている(名前を tasks[].title から引けること)。
    const ids = new Set(body.tasks.map((t) => t.procedureId));
    for (const id of [...impact!.enablesDueDateFor, ...impact!.advancesDueDateFor]) {
      expect(ids.has(id), `${code} ${id}`).toBe(true);
    }
  });

  it('案内が出るのは20区、出ないのは千代田・台東・北の3区', async () => {
    const off: string[] = [];
    for (const code of WARD_CODES) {
      const impact = (await getChecklist(everythingOn(code))).moveOutScheduledDateImpact!;
      if (impact.enablesDueDateFor.length + impact.advancesDueDateFor.length === 0) off.push(code);
    }
    expect(off).toEqual(['13101', '13106', '13117']);
  });

  it.each(WARD_CODES)('%s: enables に挙げた手続きは、入力すると実際に日付が出る', async (code) => {
    const before = await getChecklist(everythingOn(code));
    const ids = before.moveOutScheduledDateImpact!.enablesDueDateFor;
    if (ids.length === 0) return;

    const after = await getChecklist(everythingOn(code, '2026-08-25'));
    for (const id of ids) {
      expect(
        before.tasks.find((t) => t.procedureId === id)?.dueDate,
        `${code} ${id}`,
      ).toBeUndefined();
      expect(after.tasks.find((t) => t.procedureId === id)?.dueDate, `${code} ${id}`).toBeDefined();
    }
    // 入力済みの応答では、もう案内するものが無い。
    expect(after.moveOutScheduledDateImpact, code).toEqual({
      enablesDueDateFor: [],
      advancesDueDateFor: [],
    });
  });

  it.each(WARD_CODES)('%s: ステップ1だけで生成した単身の成人には案内対象が出ない', async (code) => {
    const impact = (await getChecklist(step1Only(code))).moveOutScheduledDateImpact!;
    expect(impact, code).toEqual({ enablesDueDateFor: [], advancesDueDateFor: [] });
  });
});
