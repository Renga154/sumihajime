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
 * 期限の起算日。Profile が持つ暦日のうち、公式文言が起算日として名指ししているものだけを許す。
 *
 * なぜ moveOutScheduledDate を足すか: 児童手当の15日特例は多くの区が「前住所地の転出予定日の
 * 翌日から15日以内」と明記しており、引越し日(moveDate)からは算定できない。区が書いている
 * 起算日をそのまま表現できるようにするための語彙であって、moveDate で代用してよいという意味ではない。
 *
 * なぜ「転入届出日」を足さないか: マイナンバーカードの継続利用の90日は転入届を出した日が起算で、
 * その日は本サービスが知り得ない(まだ届出していない利用者が大半)。知らない日付を起算日として
 * 語彙に持たせると、推測で埋める誘惑を構造的に残してしまう(CLAUDE.md原則3)。
 */
export const dueOriginSchema = z.enum(['moveDate', 'moveOutScheduledDate']);
export type DueOrigin = z.infer<typeof dueOriginSchema>;

/** 1つの起算日からの日数オフセット。earliestOf の要素にもなるため単体で切り出す。 */
export const offsetDaysDueRuleSchema = z.strictObject({
  type: z.literal('offsetDays'),
  from: dueOriginSchema,
  days: z.int().nonnegative(),
});
export type OffsetDaysDueRule = z.infer<typeof offsetDaysDueRuleSchema>;

/**
 * なぜ: ADR-002の期限表現。dueDateが算定可能な場合はoffsetDays、
 * 算定不能・公式文言のみの場合はunknown(needs_confirmationへ倒す)。
 *
 * earliestOf を足した理由: マイナンバーカードの継続利用は、区が複数の条件を並べて
 * 「いずれかを過ぎるとカードが失効する」と書いている(例: 板橋区「住み始めた日から14日以内
 * または転出予定日から30日以内のどちらか早い期日まで」)。片方だけを期日として出すと、
 * もう片方のほうが早い利用者に実際より遅い期日を見せてしまい、失効という実害につながる。
 * 「区が並べた条件のうち、算定できるものの最も早い日」を期日にするための表現。
 * 算定できない要素(転出予定日が未入力など)は無視し、1つも算定できなければ期日なし。
 */
export const dueRuleSchema = z.union([
  offsetDaysDueRuleSchema,
  z.strictObject({
    type: z.literal('earliestOf'),
    of: z.array(offsetDaysDueRuleSchema).min(2),
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
  /**
   * なぜ: ADR-007(公開単位=verified手続きのみ)。rules.json ファイルが staging(未公開の
   * partial手続き向けルール)を含む場合、ファイル全体の `ruleVersion` は前進するが、実際に
   * 公開(D1シード)される rule_set は verified 部分集合のみで内容は不変である。この「公開
   * 済み成果物の版」を誠実に表すため、publish 時に採用する版を任意で明示する。未指定なら
   * publish は `ruleVersion` をそのまま公開版として用いる(staging を含まない通常ケース)。
   */
  publishedRuleVersion: z.string().min(1).optional(),
  rules: z.array(ruleSchema),
});
export type RuleSet = z.infer<typeof ruleSetSchema>;
