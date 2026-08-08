import { describe, expect, it } from 'vitest';
import { profileSchema, type ChecklistResponse, type Profile } from '@tmn/schemas';
import { moveOutDateNotice } from './move-out-date-gaps';

/**
 * なぜ: 「転出予定日を入れると期限を日付で出せます」の案内は、関係のある人にだけ出さないと
 * 案内そのものが読まれなくなる。出す・出さないの境界を、保存済みプロフィールと生成済み
 * チェックリスト(データ)だけから決定論的に決めることをここで固定する。
 *
 * 区ごとの「そもそも該当ルールがあるか」は API 応答(moveOutScheduledDateImpact)が持ち、
 * 区コードによる分岐はUI側に一切書かない。その契約もここで固定する。
 */

function profile(over: Partial<Profile> = {}): Profile {
  return profileSchema.parse({
    destination: { municipalityCode: '13120' },
    moveDate: '2026-09-01',
    originType: 'outside_tokyo',
    household: { memberCount: 2, ageBands: ['adult', 'age0_2'] },
    flags: {
      hasMyNumberCard: true,
      needsNationalHealthInsurance: false,
      needsNationalPension: false,
      hasSchoolOrChildcareNeeds: true,
      hasDog: false,
      needsDisabilityOrCareSupport: false,
      needsForeignResidentGuidance: false,
    },
    ...over,
  });
}

function checklist(impact?: {
  enablesDueDateFor: string[];
  advancesDueDateFor: string[];
}): ChecklistResponse {
  return {
    ruleVersion: 'v1',
    generatedAt: '2026-08-09T00:00:00Z',
    tasks: [
      {
        id: 'task_procedure_child_allowance',
        procedureId: 'procedure_child_allowance',
        title: '児童手当の認定請求',
        category: 'child_benefits',
        priority: 'high',
        applicabilityReason: '対象です',
        requiredDocuments: [],
        channels: ['counter'],
        sources: [
          {
            sourceId: 's1',
            title: 's1',
            url: 'https://example.lg.jp/a',
            lastVerifiedAt: '2026-07-21T00:00:00Z',
          },
        ],
        dataStatus: 'verified',
        ruleVersion: 'v1',
        procedureVersion: 'v1',
        applicable: 'applicable',
      },
      {
        id: 'task_procedure_mynumber_continued_use',
        procedureId: 'procedure_mynumber_continued_use',
        title: 'マイナンバーカードの継続利用',
        category: 'my_number',
        priority: 'high',
        dueDate: '2026-09-15',
        applicabilityReason: '対象です',
        requiredDocuments: [],
        channels: ['counter'],
        sources: [
          {
            sourceId: 's2',
            title: 's2',
            url: 'https://example.lg.jp/b',
            lastVerifiedAt: '2026-07-21T00:00:00Z',
          },
        ],
        dataStatus: 'verified',
        ruleVersion: 'v1',
        procedureVersion: 'v1',
        applicable: 'applicable',
      },
    ],
    ...(impact !== undefined ? { moveOutScheduledDateImpact: impact } : {}),
  };
}

const ENABLES_ONLY = {
  enablesDueDateFor: ['procedure_child_allowance'],
  advancesDueDateFor: [],
};
const BOTH = {
  enablesDueDateFor: ['procedure_child_allowance'],
  advancesDueDateFor: ['procedure_mynumber_continued_use'],
};
const EMPTY = { enablesDueDateFor: [], advancesDueDateFor: [] };

describe('moveOutDateNotice — 出す場合', () => {
  it('日付を出せるようになる手続きがあれば、その手続き名つきで案内する', () => {
    const notice = moveOutDateNotice(profile(), checklist(ENABLES_ONLY));
    expect(notice.show).toBe(true);
    expect(notice.enables).toEqual([
      { procedureId: 'procedure_child_allowance', title: '児童手当の認定請求' },
    ]);
    expect(notice.advances).toEqual([]);
  });

  it('既に日付が出ている手続きでも、より早くなりうるなら別枠で案内する', () => {
    const notice = moveOutDateNotice(profile(), checklist(BOTH));
    expect(notice.show).toBe(true);
    expect(notice.enables.map((t) => t.title)).toEqual(['児童手当の認定請求']);
    expect(notice.advances.map((t) => t.title)).toEqual(['マイナンバーカードの継続利用']);
  });

  it('より早くなりうる手続きだけでも案内する(新宿のようにenablesが空の区)', () => {
    const notice = moveOutDateNotice(
      profile(),
      checklist({
        enablesDueDateFor: [],
        advancesDueDateFor: ['procedure_mynumber_continued_use'],
      }),
    );
    expect(notice.show).toBe(true);
    expect(notice.advances).toHaveLength(1);
  });

  it('手続き名はチェックリストのタスク名をそのまま使う(カードの見出しと一致する)', () => {
    const notice = moveOutDateNotice(profile(), checklist(BOTH));
    const titles = checklist(BOTH).tasks.map((t) => t.title);
    for (const topic of [...notice.enables, ...notice.advances]) {
      expect(titles).toContain(topic.title);
    }
  });
});

describe('moveOutDateNotice — 出さない場合(厳密さを守る)', () => {
  it('該当する手続きが1件も無い区では出さない(千代田・台東・北のような区)', () => {
    expect(moveOutDateNotice(profile(), checklist(EMPTY)).show).toBe(false);
  });

  it('転出予定日が既に入力済みなら出さない', () => {
    const p = profile({ moveOutScheduledDate: '2026-08-25' });
    expect(moveOutDateNotice(p, checklist(BOTH)).show).toBe(false);
  });

  it('海外からの転入では出さない(前住所地が国外で、転出予定日という日付が存在しない)', () => {
    const p = profile({ originType: 'overseas' });
    expect(moveOutDateNotice(p, checklist(BOTH)).show).toBe(false);
    // 都外・都内からの転入では出る(originTypeだけが違いであることを示す)。
    expect(moveOutDateNotice(profile({ originType: 'outside_tokyo' }), checklist(BOTH)).show).toBe(
      true,
    );
    expect(moveOutDateNotice(profile({ originType: 'inside_tokyo' }), checklist(BOTH)).show).toBe(
      true,
    );
  });

  it('判定材料を持たない応答(この項目より前に保存された端末内の控え)では出さない', () => {
    // 材料が無いのに出すのは推測になる(CLAUDE.md 原則3)。
    expect(moveOutDateNotice(profile(), checklist()).show).toBe(false);
  });

  it('プロフィールまたはチェックリストが無ければ出さない', () => {
    expect(moveOutDateNotice(null, checklist(BOTH))).toEqual({
      show: false,
      enables: [],
      advances: [],
    });
    expect(moveOutDateNotice(profile(), null).show).toBe(false);
  });

  it('チェックリストに載っていない手続きIDは案内に出さない(名前を出せないものは扱わない)', () => {
    const notice = moveOutDateNotice(
      profile(),
      checklist({ enablesDueDateFor: ['procedure_not_in_list'], advancesDueDateFor: [] }),
    );
    expect(notice.enables).toEqual([]);
    expect(notice.show).toBe(false);
  });
});
