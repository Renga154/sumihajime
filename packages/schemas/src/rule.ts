import { z } from 'zod';
import { ageBandSchema } from './profile.js';

/**
 * なぜ: 計画ADR-002「ルール表現 = 宣言的JSON+TS純関数評価器」。
 * 条件式は制限DSL(all/any/not + 述語)のみとし、任意コード・LLM呼び出しを禁止する
 * (CLAUDE.md原則1: チェックリストの該当判定をLLMへ任せない)。
 * 述語は4種のみ: originTypeIn / flagEquals / ageBandsIntersects / memberCountGte。
 */

/** なぜ: ADR-002が列挙する述語のうち originType の所属判定。 */
export const originTypeInPredicateSchema = z.strictObject({
  predicate: z.literal('originTypeIn'),
  values: z.array(z.enum(['outside_tokyo', 'inside_tokyo', 'overseas'])).min(1),
});

/** なぜ: ADR-002「flag == true」相当。Profile.flagsの真偽値を比較する。 */
export const flagEqualsPredicateSchema = z.strictObject({
  predicate: z.literal('flagEquals'),
  flag: z.string().min(1),
  equals: z.union([z.boolean(), z.literal('unknown')]),
});

/** なぜ: ADR-002「ageBands intersects [...]」相当。世帯年齢帯との交差判定。 */
export const ageBandsIntersectsPredicateSchema = z.strictObject({
  predicate: z.literal('ageBandsIntersects'),
  values: z.array(ageBandSchema).min(1),
});

/** なぜ: ADR-002「memberCount >= n」相当。世帯人数の下限判定。 */
export const memberCountGtePredicateSchema = z.strictObject({
  predicate: z.literal('memberCountGte'),
  value: z.int().positive(),
});

/** なぜ: DSLの述語をユニオンとしてまとめ、再帰条件の葉ノードとする。 */
export const rulePredicateSchema = z.union([
  originTypeInPredicateSchema,
  flagEqualsPredicateSchema,
  ageBandsIntersectsPredicateSchema,
  memberCountGtePredicateSchema,
]);
export type RulePredicate = z.infer<typeof rulePredicateSchema>;

/**
 * なぜ: ADR-002「all/any/not」の再帰構造。z.lazyで自己参照させ、
 * 任意コード実行を許さない宣言的な木構造のみを許可する。
 */
export type RuleCondition =
  RulePredicate | { all: RuleCondition[] } | { any: RuleCondition[] } | { not: RuleCondition };

export const ruleConditionSchema: z.ZodType<RuleCondition> = z.lazy(() =>
  z.union([
    rulePredicateSchema,
    z.strictObject({ all: z.array(ruleConditionSchema).min(1) }),
    z.strictObject({ any: z.array(ruleConditionSchema).min(1) }),
    z.strictObject({ not: ruleConditionSchema }),
  ]),
);

/**
 * なぜ: ADR-002の期限表現。dueDateが算定可能な場合はoffsetDays、
 * 算定不能・公式文言のみの場合はunknown(needs_confirmationへ倒す)。
 */
export const dueRuleSchema = z.union([
  z.strictObject({
    type: z.literal('offsetDays'),
    from: z.literal('moveDate'),
    days: z.int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('unknown'),
  }),
]);
export type DueRule = z.infer<typeof dueRuleSchema>;

/** なぜ: REQUIREMENTS §9.3 ルール出力のpriority語彙。 */
export const prioritySchema = z.enum(['urgent', 'high', 'normal', 'optional']);
export type Priority = z.infer<typeof prioritySchema>;

/** なぜ: REQUIREMENTS §9.3 applicable の3値(LLM推論を介さない確定判定+不明時の保留)。 */
export const applicabilitySchema = z.enum(['applicable', 'not_applicable', 'needs_confirmation']);
export type Applicability = z.infer<typeof applicabilitySchema>;

/**
 * なぜ: REQUIREMENTS §9.3 ルール出力の全フィールド。procedureIdごとに評価器が
 * 生成する結果であり、sourceIdsは「公開する全タスクに承認済み公式ソースを付ける」
 * (CLAUDE.md原則2)を型で強制するためmin(1)とする。
 */
export const ruleOutcomeSchema = z.strictObject({
  procedureId: z.string().min(1),
  applicable: applicabilitySchema,
  applicabilityReason: z.string().min(1),
  priority: prioritySchema,
  dueDate: z.iso.date().optional(),
  dueDescription: z.string().optional(),
  sourceIds: z.array(z.string().min(1)).min(1),
  warnings: z.array(z.string()),
});
export type RuleOutcome = z.infer<typeof ruleOutcomeSchema>;

/**
 * なぜ: 計画§8.1 rule_sets(municipality_code, rule_version, rules JSON)。
 * 1件のProcedureに対する適用条件+期限+優先度の宣言。
 */
export const ruleSchema = z.strictObject({
  procedureId: z.string().min(1),
  condition: ruleConditionSchema,
  priority: prioritySchema,
  dueRule: dueRuleSchema,
  dueDescription: z.string().optional(),
  sourceIds: z.array(z.string().min(1)).min(1),
  applicabilityReasonTemplate: z.string().min(1),
  needsConfirmationReason: z.string().optional(),
});
export type Rule = z.infer<typeof ruleSchema>;

/**
 * なぜ: 計画ADR-002「ルールセットはruleVersion(日付+連番)で管理」。
 * 自治体スコープの分離(CLAUDE.md原則4)を型で表現するため municipalityCode を持つ。
 */
export const ruleSetSchema = z.strictObject({
  municipalityCode: z.string().regex(/^\d{5}$/),
  ruleVersion: z.string().min(1),
  rules: z.array(ruleSchema),
});
export type RuleSet = z.infer<typeof ruleSetSchema>;
