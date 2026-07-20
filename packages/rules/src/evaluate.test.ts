import { describe, expect, it } from 'vitest';
import type { Profile, RuleCondition } from '@tmn/schemas';
import {
  dogOwnerWithUnknownMicrochip,
  dummyRuleSet,
  familyWithChildren,
  movingWithinTokyo,
  otherMunicipalityRuleSet,
  profileForOtherMunicipality,
  singlePersonFromOutsideTokyo,
} from '@tmn/test-fixtures';
import { evaluate, evaluateCondition, evaluateRule } from './evaluate.js';
import { MunicipalityScopeMismatchError } from './errors.js';

function withHousehold(base: Profile, household: Partial<Profile['household']>): Profile {
  return { ...base, household: { ...base.household, ...household } };
}

describe('evaluateCondition — predicates (正例/負例/境界)', () => {
  it('originTypeIn: matches when originType is in the list (positive)', () => {
    const condition: RuleCondition = { predicate: 'originTypeIn', values: ['outside_tokyo'] };
    expect(evaluateCondition(condition, singlePersonFromOutsideTokyo)).toBe('true');
  });

  it('originTypeIn: does not match when originType is absent from the list (negative)', () => {
    const condition: RuleCondition = { predicate: 'originTypeIn', values: ['overseas'] };
    expect(evaluateCondition(condition, singlePersonFromOutsideTokyo)).toBe('false');
  });

  it('flagEquals: matches boolean true (positive)', () => {
    const condition: RuleCondition = { predicate: 'flagEquals', flag: 'hasDog', equals: true };
    expect(evaluateCondition(condition, dogOwnerWithUnknownMicrochip)).toBe('true');
  });

  it('flagEquals: does not match boolean false (negative)', () => {
    const condition: RuleCondition = { predicate: 'flagEquals', flag: 'hasDog', equals: true };
    expect(evaluateCondition(condition, singlePersonFromOutsideTokyo)).toBe('false');
  });

  it('flagEquals: yields unknown when the profile flag itself is "unknown" and equals is boolean', () => {
    const condition: RuleCondition = {
      predicate: 'flagEquals',
      flag: 'dogHasMicrochip',
      equals: true,
    };
    expect(evaluateCondition(condition, dogOwnerWithUnknownMicrochip)).toBe('unknown');
  });

  it('flagEquals: equals "unknown" is itself a determinate test (true when flag is unknown)', () => {
    const condition: RuleCondition = {
      predicate: 'flagEquals',
      flag: 'dogHasMicrochip',
      equals: 'unknown',
    };
    expect(evaluateCondition(condition, dogOwnerWithUnknownMicrochip)).toBe('true');
  });

  it('flagEquals: equals "unknown" is false when the flag is a known boolean', () => {
    const condition: RuleCondition = {
      predicate: 'flagEquals',
      flag: 'hasMyNumberCard',
      equals: 'unknown',
    };
    expect(evaluateCondition(condition, singlePersonFromOutsideTokyo)).toBe('false');
  });

  it('flagEquals: throws for a flag name that does not exist on the profile (rule authoring bug, not data-unknown)', () => {
    const condition = {
      predicate: 'flagEquals',
      flag: 'notARealFlag',
      equals: true,
    } as unknown as RuleCondition;
    expect(() => evaluateCondition(condition, singlePersonFromOutsideTokyo)).toThrow();
  });

  it('ageBandsIntersects: matches when there is an overlap (positive)', () => {
    const condition: RuleCondition = {
      predicate: 'ageBandsIntersects',
      values: ['age0_2', 'elementary'],
    };
    expect(evaluateCondition(condition, familyWithChildren)).toBe('true');
  });

  it('ageBandsIntersects: does not match when there is no overlap (negative)', () => {
    const condition: RuleCondition = {
      predicate: 'ageBandsIntersects',
      values: ['senior65plus'],
    };
    expect(evaluateCondition(condition, familyWithChildren)).toBe('false');
  });

  it('ageBandsIntersects: an empty household ageBands array never matches (boundary)', () => {
    const empty = withHousehold(singlePersonFromOutsideTokyo, { ageBands: [] });
    const condition: RuleCondition = { predicate: 'ageBandsIntersects', values: ['adult'] };
    expect(evaluateCondition(condition, empty)).toBe('false');
  });

  it('memberCountGte: matches exactly at the boundary value (>=)', () => {
    const householdOfFour = withHousehold(singlePersonFromOutsideTokyo, { memberCount: 4 });
    const condition: RuleCondition = { predicate: 'memberCountGte', value: 4 };
    expect(evaluateCondition(condition, householdOfFour)).toBe('true');
  });

  it('memberCountGte: does not match one below the boundary (negative, boundary)', () => {
    const householdOfThree = withHousehold(singlePersonFromOutsideTokyo, { memberCount: 3 });
    const condition: RuleCondition = { predicate: 'memberCountGte', value: 4 };
    expect(evaluateCondition(condition, householdOfThree)).toBe('false');
  });

  it('memberCountGte: matches well above the boundary (positive)', () => {
    const condition: RuleCondition = { predicate: 'memberCountGte', value: 1 };
    expect(evaluateCondition(condition, familyWithChildren)).toBe('true');
  });
});

describe('evaluateCondition — Kleene 3-valued logic propagation', () => {
  const T: RuleCondition = { predicate: 'memberCountGte', value: 0 }; // always true (memberCount is a positive int)
  const F: RuleCondition = { predicate: 'memberCountGte', value: 999_999 }; // always false
  const U: RuleCondition = { predicate: 'flagEquals', flag: 'dogHasMicrochip', equals: true }; // unknown for dogOwnerWithUnknownMicrochip

  const profile = dogOwnerWithUnknownMicrochip;

  describe('all (AND)', () => {
    it('all-true is true', () => {
      expect(evaluateCondition({ all: [T, T] }, profile)).toBe('true');
    });
    it('any false makes the whole all false, even with unknown present (false dominates)', () => {
      expect(evaluateCondition({ all: [T, F, U] }, profile)).toBe('false');
    });
    it('unknown with no false present makes all unknown', () => {
      expect(evaluateCondition({ all: [T, U] }, profile)).toBe('unknown');
    });
  });

  describe('any (OR)', () => {
    it('any-false is false', () => {
      expect(evaluateCondition({ any: [F, F] }, profile)).toBe('false');
    });
    it('any true makes the whole any true, even with unknown present (true dominates)', () => {
      expect(evaluateCondition({ any: [F, T, U] }, profile)).toBe('true');
    });
    it('unknown with no true present makes any unknown', () => {
      expect(evaluateCondition({ any: [F, U] }, profile)).toBe('unknown');
    });
  });

  describe('not', () => {
    it('not(true) is false', () => {
      expect(evaluateCondition({ not: T }, profile)).toBe('false');
    });
    it('not(false) is true', () => {
      expect(evaluateCondition({ not: F }, profile)).toBe('true');
    });
    it('not(unknown) is unknown', () => {
      expect(evaluateCondition({ not: U }, profile)).toBe('unknown');
    });
  });

  it('propagates unknown through deeply nested all/any/not combinations', () => {
    const condition: RuleCondition = {
      any: [{ all: [T, { not: U }] }, F],
    };
    // all: [T, not(U)=unknown] -> unknown (no false); any: [unknown, F] -> unknown (no true)
    expect(evaluateCondition(condition, profile)).toBe('unknown');
  });
});

describe('evaluateRule — needs_confirmation and applicability wiring', () => {
  it('resolves to needs_confirmation when the condition is unknown, using needsConfirmationReason', () => {
    const rule = dummyRuleSet.rules.find(
      (r) => r.procedureId === 'procedure_dog_microchip_registration',
    );
    if (!rule) throw new Error('fixture rule missing');
    const result = evaluateRule(rule, dogOwnerWithUnknownMicrochip);
    expect(result.applicable).toBe('needs_confirmation');
    expect(result.applicabilityReason).toBe(rule.needsConfirmationReason);
    expect(result.dueDate).toBeUndefined();
    expect(result.dueDescription).toBe(rule.dueDescription);
  });

  it('resolves to applicable with a computed dueDate for a plain offsetDays rule', () => {
    const rule = dummyRuleSet.rules.find(
      (r) => r.procedureId === 'procedure_resident_registration',
    );
    if (!rule) throw new Error('fixture rule missing');
    const result = evaluateRule(rule, singlePersonFromOutsideTokyo);
    expect(result.applicable).toBe('applicable');
    expect(result.dueDate).toBe('2026-08-15');
    expect(result.sourceIds.length).toBeGreaterThan(0);
  });

  it('resolves to not_applicable when the condition is definitely false', () => {
    const rule = dummyRuleSet.rules.find((r) => r.procedureId === 'procedure_dog_registration');
    if (!rule) throw new Error('fixture rule missing');
    const result = evaluateRule(rule, singlePersonFromOutsideTokyo);
    expect(result.applicable).toBe('not_applicable');
  });

  it('falls back to a generic dueDescription and a warning when due is unresolved and no dueDescription is set', () => {
    const rule = {
      procedureId: 'procedure_no_due_info',
      condition: { predicate: 'memberCountGte' as const, value: 0 },
      priority: 'optional' as const,
      dueRule: { type: 'unknown' as const },
      sourceIds: ['source_dummy_official_page'],
      applicabilityReasonTemplate: 'always applicable for this test',
    };
    const result = evaluateRule(rule, singlePersonFromOutsideTokyo);
    expect(result.dueDescription).toBeDefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('evaluate — municipality scope safety (REQUIREMENTS §9.4, CLAUDE.md原則4)', () => {
  it('throws MunicipalityScopeMismatchError when profile and ruleSet municipalities differ', () => {
    expect(() => evaluate(profileForOtherMunicipality, dummyRuleSet)).toThrow(
      MunicipalityScopeMismatchError,
    );
  });

  it('throws for every mismatched pairing, never silently evaluating (both directions)', () => {
    expect(() => evaluate(singlePersonFromOutsideTokyo, otherMunicipalityRuleSet)).toThrow(
      MunicipalityScopeMismatchError,
    );
  });

  it('evaluates normally when the municipality codes match', () => {
    expect(() => evaluate(singlePersonFromOutsideTokyo, dummyRuleSet)).not.toThrow();
    expect(() => evaluate(profileForOtherMunicipality, otherMunicipalityRuleSet)).not.toThrow();
  });
});

describe('evaluate — determinism (same input + same ruleVersion -> same output)', () => {
  it('produces identical results across repeated calls', () => {
    const first = evaluate(familyWithChildren, dummyRuleSet);
    const second = evaluate(familyWithChildren, dummyRuleSet);
    expect(second).toEqual(first);
  });

  it('matches a snapshot for a representative profile (regression guard)', () => {
    expect(evaluate(familyWithChildren, dummyRuleSet)).toMatchSnapshot();
  });

  it('matches a snapshot for the needs_confirmation-heavy dog-owner profile', () => {
    expect(evaluate(dogOwnerWithUnknownMicrochip, dummyRuleSet)).toMatchSnapshot();
  });

  it('matches a snapshot for the inside-Tokyo move profile', () => {
    expect(evaluate(movingWithinTokyo, dummyRuleSet)).toMatchSnapshot();
  });
});

describe('evaluate — full RuleSet coverage', () => {
  it('returns exactly one RuleOutcome per Rule in the RuleSet', () => {
    const result = evaluate(singlePersonFromOutsideTokyo, dummyRuleSet);
    expect(result.outcomes).toHaveLength(dummyRuleSet.rules.length);
    expect(result.ruleVersion).toBe(dummyRuleSet.ruleVersion);
  });

  it('every outcome carries at least one sourceId (CLAUDE.md原則2)', () => {
    const result = evaluate(familyWithChildren, dummyRuleSet);
    for (const outcome of result.outcomes) {
      expect(outcome.sourceIds.length).toBeGreaterThan(0);
    }
  });
});
