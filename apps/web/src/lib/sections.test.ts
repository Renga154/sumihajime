import { describe, expect, it } from 'vitest';
import type { GeneratedTask } from '@tmn/schemas';
import { assignSection, groupIntoSections } from './sections';

/**
 * なぜ: VS1受入3/5。dueDate/priority/applicable から期限順セクションへ決定論的に振り分ける
 * ロジックの代表ケースを固定する。
 */

function task(overrides: Partial<GeneratedTask>): GeneratedTask {
  return {
    id: overrides.id ?? 'id',
    procedureId: overrides.procedureId ?? 'p',
    title: 't',
    category: 'c',
    priority: overrides.priority ?? 'normal',
    applicabilityReason: 'r',
    requiredDocuments: [],
    channels: ['counter'],
    sources: [
      {
        sourceId: 's',
        title: 's',
        url: 'https://e.example/x',
        lastVerifiedAt: '2026-07-21T00:00:00Z',
      },
    ],
    dataStatus: 'partial',
    ruleVersion: 'v1',
    procedureVersion: 'v1',
    ...overrides,
  };
}

const MOVE = '2026-08-01';

describe('assignSection', () => {
  it('needs_confirmation は該当者のみ・要確認へ(期限があっても優先)', () => {
    expect(
      assignSection(task({ applicable: 'needs_confirmation', dueDate: '2026-08-05' }), MOVE),
    ).toBe('conditional');
  });

  it('urgent かつ期限ありは転入後すぐへ', () => {
    expect(assignSection(task({ priority: 'urgent', dueDate: '2026-08-15' }), MOVE)).toBe(
      'right_after',
    );
  });

  it('期限が14日以内(urgent以外)は14日以内へ', () => {
    expect(assignSection(task({ priority: 'high', dueDate: '2026-08-15' }), MOVE)).toBe(
      'within_14',
    );
  });

  it('期限が31日以内は1か月以内へ', () => {
    expect(assignSection(task({ priority: 'normal', dueDate: '2026-08-30' }), MOVE)).toBe(
      'within_month',
    );
  });

  it('期限日が無く優先度が通常のものは生活開始へ', () => {
    expect(assignSection(task({ dueDescription: '生活開始まで' }), MOVE)).toBe('life_start');
  });

  /**
   * なぜ: 期限日が算定できない理由は「急がなくてよい」ではなく「起算日が前住所地の
   * 転出予定日で本サービスが持たないから」である場合が多い(児童手当の15日特例など)。
   * それを「生活開始(落ち着いて確認する項目)」へ送ると助言として誤りになるため、
   * 優先度が urgent/high のものは「転入後すぐ」へ置く。
   */
  it('期限日が無くても優先度が重要なら転入後すぐへ(児童手当の15日特例など)', () => {
    expect(
      assignSection(
        task({ priority: 'high', dueDescription: '転入日の翌日から15日以内に申請してください。' }),
        MOVE,
      ),
    ).toBe('right_after');
  });

  it('期限日が無く優先度が至急なら転入後すぐへ', () => {
    expect(
      assignSection(task({ priority: 'urgent', dueDescription: 'できるだけ早く' }), MOVE),
    ).toBe('right_after');
  });

  it('期限日が無い任意項目は生活開始のまま', () => {
    expect(assignSection(task({ priority: 'optional', dueDescription: '任意' }), MOVE)).toBe(
      'life_start',
    );
  });

  it('要確認は優先度が重要でも該当者のみ・要確認が優先される', () => {
    expect(assignSection(task({ applicable: 'needs_confirmation', priority: 'high' }), MOVE)).toBe(
      'conditional',
    );
  });

  it('期限が引越し日より前は引越し前へ', () => {
    expect(assignSection(task({ dueDate: '2026-07-25' }), MOVE)).toBe('before_move');
  });
});

describe('groupIntoSections', () => {
  it('空でないセクションのみを表示順で返す', () => {
    const tasks = [
      task({ id: '1', priority: 'urgent', dueDate: '2026-08-15' }), // right_after
      task({ id: '2', priority: 'high', dueDate: '2026-08-14' }), // within_14
      task({ id: '3', applicable: 'needs_confirmation' }), // conditional
    ];
    const sections = groupIntoSections(tasks, MOVE);
    expect(sections.map((s) => s.key)).toEqual(['right_after', 'within_14', 'conditional']);
    expect(sections.every((s) => s.tasks.length > 0)).toBe(true);
  });
});
