import { describe, expect, it } from 'vitest';
import type { RuleOutcome } from '@tmn/schemas';
import { sortOutcomesByDue } from './sort.js';

function outcome(partial: Partial<RuleOutcome> & Pick<RuleOutcome, 'procedureId'>): RuleOutcome {
  return {
    procedureId: partial.procedureId,
    applicable: partial.applicable ?? 'applicable',
    applicabilityReason: partial.applicabilityReason ?? 'because',
    priority: partial.priority ?? 'normal',
    dueDate: partial.dueDate,
    dueDescription: partial.dueDescription,
    sourceIds: partial.sourceIds ?? ['source_x'],
    warnings: partial.warnings ?? [],
  };
}

describe('sortOutcomesByDue', () => {
  it('sorts due-dated outcomes ascending by dueDate (normal case)', () => {
    const outcomes = [
      outcome({ procedureId: 'b', dueDate: '2026-09-01' }),
      outcome({ procedureId: 'a', dueDate: '2026-08-15' }),
      outcome({ procedureId: 'c', dueDate: '2026-12-01' }),
    ];
    expect(sortOutcomesByDue(outcomes).map((o) => o.procedureId)).toEqual(['a', 'b', 'c']);
  });

  it('places due-less outcomes after due-dated ones, ordered by priority (FR-006)', () => {
    const outcomes = [
      outcome({ procedureId: 'no-due-optional', priority: 'optional', dueDescription: 'later' }),
      outcome({ procedureId: 'has-due', dueDate: '2026-12-31' }),
      outcome({
        procedureId: 'no-due-urgent',
        applicable: 'needs_confirmation',
        priority: 'urgent',
        dueDescription: 'confirm first',
      }),
    ];
    expect(sortOutcomesByDue(outcomes).map((o) => o.procedureId)).toEqual([
      'has-due',
      'no-due-urgent',
      'no-due-optional',
    ]);
  });

  it('preserves input order for equal dueDate (stable sort, boundary)', () => {
    const outcomes = [
      outcome({ procedureId: 'first', dueDate: '2026-08-15' }),
      outcome({ procedureId: 'second', dueDate: '2026-08-15' }),
    ];
    expect(sortOutcomesByDue(outcomes).map((o) => o.procedureId)).toEqual(['first', 'second']);
  });

  it('preserves input order for equal priority among due-less outcomes (stable sort, boundary)', () => {
    const outcomes = [
      outcome({ procedureId: 'first', priority: 'high', dueDescription: 'x' }),
      outcome({ procedureId: 'second', priority: 'high', dueDescription: 'y' }),
    ];
    expect(sortOutcomesByDue(outcomes).map((o) => o.procedureId)).toEqual(['first', 'second']);
  });

  it('handles an empty outcome list (boundary)', () => {
    expect(sortOutcomesByDue([])).toEqual([]);
  });

  it('orders all four priority levels correctly when none have a due date', () => {
    const outcomes = [
      outcome({ procedureId: 'optional', priority: 'optional', dueDescription: 'x' }),
      outcome({ procedureId: 'normal', priority: 'normal', dueDescription: 'x' }),
      outcome({ procedureId: 'urgent', priority: 'urgent', dueDescription: 'x' }),
      outcome({ procedureId: 'high', priority: 'high', dueDescription: 'x' }),
    ];
    expect(sortOutcomesByDue(outcomes).map((o) => o.procedureId)).toEqual([
      'urgent',
      'high',
      'normal',
      'optional',
    ]);
  });
});
