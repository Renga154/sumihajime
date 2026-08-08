import type {
  Applicability,
  Flags,
  Profile,
  Rule,
  RuleCondition,
  RuleOutcome,
  RulePredicate,
  RuleSet,
} from '@tmn/schemas';
import { ruleOutcomeSchema } from '@tmn/schemas';
import { MunicipalityScopeMismatchError } from './errors.js';
import { resolveDueRule } from './dates.js';

/**
 * なぜ: REQUIREMENTS §9.1「LLMは適用可否を自由推論しない」+ 計画ADR-002。
 * 述語の判定材料が確定していない場合(dogHasMicrochip: "unknown"等)、推測せず
 * 3値(Kleene論理: true/false/unknown)で伝播させる。ルール全体がunknownに帰着した
 * 場合のみapplicable="needs_confirmation"とする(REQUIREMENTS §9.1)。
 */
export type TriBool = 'true' | 'false' | 'unknown';

function kleeneNot(value: TriBool): TriBool {
  if (value === 'true') return 'false';
  if (value === 'false') return 'true';
  return 'unknown';
}

/** なぜ: Kleene K3の論理積。1つでもfalseがあれば全体false(unknownより優先)。 */
function kleeneAll(values: TriBool[]): TriBool {
  if (values.some((v) => v === 'false')) return 'false';
  if (values.some((v) => v === 'unknown')) return 'unknown';
  return 'true';
}

/** なぜ: Kleene K3の論理和。1つでもtrueがあれば全体true(unknownより優先)。 */
function kleeneAny(values: TriBool[]): TriBool {
  if (values.some((v) => v === 'true')) return 'true';
  if (values.some((v) => v === 'unknown')) return 'unknown';
  return 'false';
}

function evaluateFlagEquals(
  predicate: Extract<RulePredicate, { predicate: 'flagEquals' }>,
  flags: Flags,
): TriBool {
  if (!Object.prototype.hasOwnProperty.call(flags, predicate.flag)) {
    // なぜ: 存在しないflag名を参照するのはデータ不足(unknown)ではなくルール定義の
    // 誤り。3値のunknownに落とすと自治体越境と同様の「気づかれない誤適用」を招くため
    // 早期に例外化する(評価を継続しない)。
    throw new Error(`rule references an unknown profile flag: "${predicate.flag}"`);
  }
  const actual = flags[predicate.flag as keyof Flags];

  if (predicate.equals === 'unknown') {
    // なぜ: 「このflagが未確認状態かどうか」自体を問う条件は、actualの値に関わらず
    // 常に確定判定できる(3値のunknownにはならない)。
    return actual === 'unknown' ? 'true' : 'false';
  }
  if (actual === 'unknown') {
    return 'unknown';
  }
  return actual === predicate.equals ? 'true' : 'false';
}

function evaluatePredicate(predicate: RulePredicate, profile: Profile): TriBool {
  switch (predicate.predicate) {
    case 'originTypeIn':
      return predicate.values.includes(profile.originType) ? 'true' : 'false';
    case 'memberCountGte':
      return profile.household.memberCount >= predicate.value ? 'true' : 'false';
    case 'ageBandsIntersects':
      return predicate.values.some((band) => profile.household.ageBands.includes(band))
        ? 'true'
        : 'false';
    case 'flagEquals':
      return evaluateFlagEquals(predicate, profile.flags);
  }
}

/**
 * なぜ: 条件DSL(all/any/not + 述語)の再帰評価。任意コード実行を許さない宣言的な木構造
 * のみを解釈する(計画ADR-002)。同一入力に対し常に同一の3値を返す純関数。
 */
export function evaluateCondition(condition: RuleCondition, profile: Profile): TriBool {
  if ('all' in condition) {
    return kleeneAll(condition.all.map((child) => evaluateCondition(child, profile)));
  }
  if ('any' in condition) {
    return kleeneAny(condition.any.map((child) => evaluateCondition(child, profile)));
  }
  if ('not' in condition) {
    return kleeneNot(evaluateCondition(condition.not, profile));
  }
  return evaluatePredicate(condition, profile);
}

function triBoolToApplicability(value: TriBool): Applicability {
  if (value === 'true') return 'applicable';
  if (value === 'false') return 'not_applicable';
  return 'needs_confirmation';
}

/** なぜ: REQUIREMENTS §9.4「情報不足時のneeds_confirmation」の理由文言選択。 */
function resolveApplicabilityReason(rule: Rule, applicable: Applicability): string {
  if (applicable === 'needs_confirmation') {
    return rule.needsConfirmationReason ?? rule.applicabilityReasonTemplate;
  }
  return rule.applicabilityReasonTemplate;
}

/** なぜ: REQUIREMENTS §10「dueDate または dueDescription」を必ずどちらか埋める。 */
function resolveDueFields(
  rule: Rule,
  profile: Profile,
): {
  dueDate?: string;
  dueDescription?: string;
  warning?: string;
} {
  const resolved = resolveDueRule(rule.dueRule, {
    moveDate: profile.moveDate,
    ...(profile.moveOutScheduledDate !== undefined
      ? { moveOutScheduledDate: profile.moveOutScheduledDate }
      : {}),
  });
  if (resolved.dueDate !== undefined) {
    return { dueDate: resolved.dueDate };
  }
  if (rule.dueDescription !== undefined) {
    return { dueDescription: rule.dueDescription };
  }
  // なぜ: dueRuleがunknownかつ公式文言(dueDescription)も未設定というデータ不備。
  // 推測で期日を作らず(原則3)、確認要の警告付きで汎用文言にフォールバックする。
  return {
    dueDescription: '期限は自治体窓口で個別に確認してください(公式文言未登録)。',
    warning: `rule "${rule.procedureId}" has an unresolved due date and no dueDescription fallback`,
  };
}

/** なぜ: 1件のRuleをProfileに対して評価し、§9.3の出力形状ちょうどを生成する。 */
export function evaluateRule(rule: Rule, profile: Profile): RuleOutcome {
  const triBool = evaluateCondition(rule.condition, profile);
  const applicable = triBoolToApplicability(triBool);
  const applicabilityReason = resolveApplicabilityReason(rule, applicable);
  const due = resolveDueFields(rule, profile);

  const warnings: string[] = [];
  if (due.warning !== undefined) {
    warnings.push(due.warning);
  }

  const outcome: RuleOutcome = {
    procedureId: rule.procedureId,
    applicable,
    applicabilityReason,
    priority: rule.priority,
    ...(due.dueDate !== undefined ? { dueDate: due.dueDate } : {}),
    ...(due.dueDescription !== undefined ? { dueDescription: due.dueDescription } : {}),
    sourceIds: rule.sourceIds,
    warnings,
  };

  // なぜ: §9.3の契約を評価器自身が壊さないことをスキーマで裏書きする
  // (境界層以外でのany禁止・入出力スキーマ検証というCLAUDE.md原則の評価器版)。
  return ruleOutcomeSchema.parse(outcome);
}

export interface EvaluationResult {
  ruleVersion: string;
  outcomes: RuleOutcome[];
}

/**
 * なぜ: 計画ADR-002「評価器は純関数 evaluate(profile, ruleSet, ruleVersion) ->
 * RuleOutcome[]」。RuleSet内の全Ruleを決定論的に評価する。
 * 自治体スコープの不一致(CLAUDE.md原則4)は例外にして評価を一切進めない。
 */
export function evaluate(profile: Profile, ruleSet: RuleSet): EvaluationResult {
  if (profile.destination.municipalityCode !== ruleSet.municipalityCode) {
    throw new MunicipalityScopeMismatchError(
      profile.destination.municipalityCode,
      ruleSet.municipalityCode,
    );
  }
  return {
    ruleVersion: ruleSet.ruleVersion,
    outcomes: ruleSet.rules.map((rule) => evaluateRule(rule, profile)),
  };
}
