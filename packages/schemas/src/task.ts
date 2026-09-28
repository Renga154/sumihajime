import { z } from 'zod';
import { httpsUrlSchema } from './url.js';
import { requiredDocumentSchema, channelSchema, dataStatusSchema } from './procedure.js';
import { prioritySchema, applicabilitySchema } from './rule.js';

/**
 * なぜ: REQUIREMENTS §14.2 タスク出力例、§13.1 GeneratedTask。ルール評価器
 * (T-003)が生成する、利用者に表示する1件のタスクDTO。sourcesは§14.2のとおり
 * {sourceId,title,url,lastVerifiedAt}を埋め込み、Source本体(source.ts)とは
 * 別の軽量な表示用形状として定義する。
 */

/** なぜ: §14.2 sources[]の埋め込み形状(sourceId/title/url/lastVerifiedAt)。 */
/**
 * ADR-014: 定期巡回が検知した「根拠の揺らぎ」の種類。changed=公式ページの更新日が変わった、
 * unreachable=2回連続で到達できない。どちらも人が再監査するまで手続きを「再確認中」に落とす。
 */
export const driftKindSchema = z.enum(['changed', 'unreachable']);
export type DriftKind = z.infer<typeof driftKindSchema>;

export const taskSourceRefSchema = z.strictObject({
  sourceId: z.string().min(1),
  title: z.string().min(1),
  url: httpsUrlSchema,
  lastVerifiedAt: z.iso.datetime(),
  // ADR-014: 巡回がこのソースの揺らぎを検知していれば、検知日(YYYY-MM-DD)と種類を添える
  // (根拠カードに検知日を出す)。未検知なら両方とも無い(後方互換な追加的optional)。
  driftDetectedOn: z.iso.date().optional(),
  driftKind: driftKindSchema.optional(),
});
export type TaskSourceRef = z.infer<typeof taskSourceRefSchema>;

/**
 * なぜ: §14.2の出力例の全フィールドと1:1対応。ruleVersion/procedureVersionは
 * 「生成時のProcedureVersionとRuleVersionを保持する」(§13.2)ため必須とする。
 */
export const generatedTaskSchema = z.strictObject({
  id: z.string().min(1),
  procedureId: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  priority: prioritySchema,
  applicabilityReason: z.string().min(1),
  dueDate: z.iso.date().optional(),
  dueDescription: z.string().optional(),
  requiredDocuments: z.array(requiredDocumentSchema),
  channels: z.array(channelSchema),
  locations: z.array(z.string().min(1)).optional(),
  sources: z.array(taskSourceRefSchema).min(1),
  dataStatus: dataStatusSchema,
  ruleVersion: z.string().min(1),
  procedureVersion: z.string().min(1),
  // なぜ: REQUIREMENTS §9.3 の applicable を表示側へ伝える追加的optionalフィールド(T-006)。
  // API は applicable / needs_confirmation の両方を返すため、UIが「要確認」バッジを出せるよう
  // applicable を、要確認の理由・注意を warnings を通じて渡す(§14.2の例には無い後方互換な拡張)。
  applicable: applicabilitySchema.optional(),
  warnings: z.array(z.string()).optional(),
});
export type GeneratedTask = z.infer<typeof generatedTaskSchema>;
