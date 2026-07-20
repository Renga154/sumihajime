import { z } from 'zod';
import { requiredDocumentSchema, channelSchema, dataStatusSchema } from './procedure.js';
import { prioritySchema } from './rule.js';

/**
 * なぜ: REQUIREMENTS §14.2 タスク出力例、§13.1 GeneratedTask。ルール評価器
 * (T-003)が生成する、利用者に表示する1件のタスクDTO。sourcesは§14.2のとおり
 * {sourceId,title,url,lastVerifiedAt}を埋め込み、Source本体(source.ts)とは
 * 別の軽量な表示用形状として定義する。
 */

/** なぜ: §14.2 sources[]の埋め込み形状(sourceId/title/url/lastVerifiedAt)。 */
export const taskSourceRefSchema = z.strictObject({
  sourceId: z.string().min(1),
  title: z.string().min(1),
  url: z.url(),
  lastVerifiedAt: z.iso.datetime(),
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
});
export type GeneratedTask = z.infer<typeof generatedTaskSchema>;
