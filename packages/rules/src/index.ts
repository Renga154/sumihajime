// @tmn/rules — deterministic rule evaluator (pure functions) + due-date utilities (T-003).

export { evaluate, evaluateRule, evaluateCondition } from './evaluate.js';
export type { EvaluationResult, TriBool } from './evaluate.js';
export { addCalendarDays, resolveDueRule } from './dates.js';
export type { ResolvedDue } from './dates.js';
export { sortOutcomesByDue } from './sort.js';
export { MunicipalityScopeMismatchError } from './errors.js';
