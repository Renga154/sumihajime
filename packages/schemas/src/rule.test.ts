import { describe, expect, it } from 'vitest';
import { ruleConditionSchema, ruleOutcomeSchema, ruleSetSchema, dueRuleSchema } from './rule.js';

describe('ruleConditionSchema (ADR-002 DSL)', () => {
  it('parses a nested all/any/not condition (normal case)', () => {
    const result = ruleConditionSchema.safeParse({
      all: [
        { predicate: 'originTypeIn', values: ['outside_tokyo', 'inside_tokyo'] },
        {
          any: [
            { predicate: 'flagEquals', flag: 'hasDog', equals: true },
            { predicate: 'ageBandsIntersects', values: ['age0_2', 'age3_5'] },
          ],
        },
        { not: { predicate: 'memberCountGte', value: 5 } },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown predicate name', () => {
    const result = ruleConditionSchema.safeParse({ predicate: 'freeformEval', code: '1+1' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty all[] (boundary)', () => {
    expect(ruleConditionSchema.safeParse({ all: [] }).success).toBe(false);
  });
});

describe('dueRuleSchema', () => {
  it('parses an offsetDays due rule', () => {
    expect(
      dueRuleSchema.safeParse({ type: 'offsetDays', from: 'moveDate', days: 14 }).success,
    ).toBe(true);
  });

  it('parses an unknown due rule (needs_confirmation path)', () => {
    expect(dueRuleSchema.safeParse({ type: 'unknown' }).success).toBe(true);
  });

  it('rejects a negative offset (boundary)', () => {
    expect(
      dueRuleSchema.safeParse({ type: 'offsetDays', from: 'moveDate', days: -1 }).success,
    ).toBe(false);
  });

  it('parses moveOutScheduledDate as an origin (児童手当の15日特例)', () => {
    expect(
      dueRuleSchema.safeParse({ type: 'offsetDays', from: 'moveOutScheduledDate', days: 15 })
        .success,
    ).toBe(true);
  });

  it('rejects an origin the profile does not carry (転入届出日は本サービスが知り得ない)', () => {
    // なぜ: 知らない日付を起算日の語彙に入れると、推測で埋める余地を構造的に残してしまう。
    expect(
      dueRuleSchema.safeParse({ type: 'offsetDays', from: 'applicationDate', days: 90 }).success,
    ).toBe(false);
  });

  it('parses earliestOf(区が並べた条件のうち最も早い日)', () => {
    expect(
      dueRuleSchema.safeParse({
        type: 'earliestOf',
        of: [
          { type: 'offsetDays', from: 'moveDate', days: 14 },
          { type: 'offsetDays', from: 'moveOutScheduledDate', days: 30 },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects earliestOf with fewer than 2 candidates (1件なら offsetDays で書く)', () => {
    expect(
      dueRuleSchema.safeParse({
        type: 'earliestOf',
        of: [{ type: 'offsetDays', from: 'moveDate', days: 14 }],
      }).success,
    ).toBe(false);
  });

  it('rejects nested earliestOf (入れ子にせず候補を平らに並べる)', () => {
    expect(
      dueRuleSchema.safeParse({
        type: 'earliestOf',
        of: [
          { type: 'offsetDays', from: 'moveDate', days: 14 },
          {
            type: 'earliestOf',
            of: [
              { type: 'offsetDays', from: 'moveDate', days: 7 },
              { type: 'offsetDays', from: 'moveOutScheduledDate', days: 30 },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('ruleOutcomeSchema (§9.3)', () => {
  const base = {
    procedureId: 'procedure_resident_registration',
    applicable: 'applicable' as const,
    applicabilityReason: '東京都外からこの自治体へ転入するため',
    priority: 'urgent' as const,
    dueDate: '2026-08-29',
    sourceIds: ['source_setagaya_juuminidou'],
    warnings: [],
  };

  it('parses a valid outcome (normal case)', () => {
    expect(ruleOutcomeSchema.safeParse(base).success).toBe(true);
  });

  it('parses needs_confirmation without a resolvable dueDate', () => {
    const { dueDate: _dueDate, ...rest } = base;
    const result = ruleOutcomeSchema.safeParse({
      ...rest,
      applicable: 'needs_confirmation',
      dueDescription: '窓口で確認してください',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty sourceIds array (boundary: every published task needs a source)', () => {
    expect(ruleOutcomeSchema.safeParse({ ...base, sourceIds: [] }).success).toBe(false);
  });

  it('rejects an invalid applicable enum value', () => {
    expect(ruleOutcomeSchema.safeParse({ ...base, applicable: 'yes' }).success).toBe(false);
  });
});

describe('ruleSetSchema', () => {
  it('rejects a municipalityCode that does not scope-isolate correctly (wrong format)', () => {
    const result = ruleSetSchema.safeParse({
      municipalityCode: 'ABCDE',
      ruleVersion: '2026-08-20.1',
      rules: [],
    });
    expect(result.success).toBe(false);
  });

  it('parses an empty rules[] ruleset', () => {
    const result = ruleSetSchema.safeParse({
      municipalityCode: '13112',
      ruleVersion: '2026-08-20.1',
      rules: [],
    });
    expect(result.success).toBe(true);
  });
});
