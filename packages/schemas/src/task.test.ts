import { describe, expect, it } from 'vitest';
import { generatedTaskSchema } from './task.js';

/** なぜ: REQUIREMENTS §14.2 タスク出力例をそのままfixtureとして使う。 */
const requirements142Fixture = {
  id: 'task_xxx',
  procedureId: 'procedure_xxx',
  title: '転入届を提出する',
  category: 'resident_registration',
  priority: 'urgent',
  applicabilityReason: '東京都外からこの自治体へ転入するため',
  dueDate: '2026-08-29',
  dueDescription: '期限は公式情報に基づいて算定',
  requiredDocuments: [{ label: '本人確認書類', status: 'required' }],
  channels: ['counter'],
  locations: ['facility_xxx'],
  sources: [
    {
      sourceId: 'source_xxx',
      title: '自治体公式ページ名',
      url: 'https://example.lg.jp/...',
      lastVerifiedAt: '2026-08-20T00:00:00Z',
    },
  ],
  dataStatus: 'verified',
  ruleVersion: '2026-08-20.1',
  procedureVersion: '2026-08-20.1',
};

describe('generatedTaskSchema — §14.2 fixture', () => {
  it('parses the §14.2 example as-is (normal case)', () => {
    const result = generatedTaskSchema.safeParse(requirements142Fixture);
    expect(result.success).toBe(true);
  });

  it('rejects an empty sources array (boundary: every published task needs a source)', () => {
    const result = generatedTaskSchema.safeParse({ ...requirements142Fixture, sources: [] });
    expect(result.success).toBe(false);
  });

  it('rejects missing required field ruleVersion', () => {
    const { ruleVersion: _ruleVersion, ...rest } = requirements142Fixture;
    expect(generatedTaskSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an invalid priority enum value', () => {
    const result = generatedTaskSchema.safeParse({ ...requirements142Fixture, priority: 'meh' });
    expect(result.success).toBe(false);
  });

  it('rejects a source URL that is not well-formed', () => {
    const result = generatedTaskSchema.safeParse({
      ...requirements142Fixture,
      sources: [{ ...requirements142Fixture.sources[0], url: 'not-a-url' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unexpected extra top-level properties (strict)', () => {
    const result = generatedTaskSchema.safeParse({ ...requirements142Fixture, extra: 1 });
    expect(result.success).toBe(false);
  });
});
