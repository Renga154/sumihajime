// @tmn/rules — deterministic rule evaluator (pure functions) + due-date utilities (T-003).

export { evaluate, evaluateRule, evaluateCondition } from './evaluate.js';
export type { EvaluationResult, TriBool } from './evaluate.js';
export { addCalendarDays, resolveDueRule } from './dates.js';
export type { ResolvedDue } from './dates.js';
export { sortOutcomesByDue } from './sort.js';
export { MunicipalityScopeMismatchError } from './errors.js';
export {
  buildWardDifferences,
  extractStatedDeadline,
  WARD_DIFFERENCE_TOPICS,
} from './ward-differences.js';
// なぜ: セル・トピック等の表示形状は @tmn/schemas 側にも同名の型(API契約)がある。
// 呼び出し側が両方をimportしたときに紛れないよう、@tmn/rules からは「入力」と「レポート全体」
// および抽出器の型だけを公開する(内部の細かい型は package 内のテストから直接importする)。
export type {
  DeadlineUnit,
  StatedDeadline,
  WardDifferenceInput,
  WardDifferenceReport,
  WardDifferenceSourceRef,
  WardDifferenceTopicSpec,
} from './ward-differences.js';
