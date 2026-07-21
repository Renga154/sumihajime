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

  it('期限日が無いものは生活開始へ', () => {
    expect(assignSection(task({ dueDescription: '生活開始まで' }), MOVE)).toBe('life_start');
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
