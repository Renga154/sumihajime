import { z } from 'zod';
import { httpsUrlSchema } from './url.js';
import { municipalityCodeSchema } from './municipality.js';
import { prioritySchema } from './rule.js';

/**
 * なぜ: REQUIREMENTS §10 タスク詳細要件の表と1:1対応するProcedureVersionスキーマ。
 * 計画§8.1 procedure_versions テーブルに対応する。
 */

/** なぜ: §10 requiredDocuments「書類一覧。未知なら未知と明示」。 */
export const documentStatusSchema = z.enum(['required', 'conditional', 'unknown']);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const requiredDocumentSchema = z.strictObject({
  label: z.string().min(1),
  status: documentStatusSchema,
});
export type RequiredDocument = z.infer<typeof requiredDocumentSchema>;

/** なぜ: §10 channels(counter/online/mail/phone)。 */
export const channelSchema = z.enum(['counter', 'online', 'mail', 'phone']);
export type Channel = z.infer<typeof channelSchema>;

/**
 * なぜ: §10 dataStatus。RAG/チェックリストがデータの鮮度・完全性を利用者へ
 * 誠実に開示するための状態(CLAUDE.md原則3「根拠がない場合は推測しない」)。
 */
export const dataStatusSchema = z.enum(['verified', 'partial', 'stale', 'unavailable']);
export type DataStatus = z.infer<typeof dataStatusSchema>;

/**
 * なぜ: §10 タスク詳細要件の表の全フィールド(id/municipalityCode/canonicalType/title/
 * shortDescription/applicabilityReason/priority/dueDate or dueDescription/
 * requiredDocuments/channels/locations/onlineUrl/contact/sourceIds/lastVerifiedAt/
 * dataStatus/cautions)。versionは計画§8.1 procedure_versionsのバージョン管理キー。
 */
export const procedureVersionSchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
  municipalityCode: municipalityCodeSchema,
  canonicalType: z.string().min(1),
  title: z.string().min(1),
  shortDescription: z.string().min(1),
  applicabilityReason: z.string().min(1),
  priority: prioritySchema,
  dueDate: z.iso.date().optional(),
  dueDescription: z.string().optional(),
  requiredDocuments: z.array(requiredDocumentSchema),
  channels: z.array(channelSchema),
  locations: z.array(z.string().min(1)).optional(),
  onlineUrl: httpsUrlSchema.optional(),
  contact: z.string().optional(),
  sourceIds: z.array(z.string().min(1)).min(1),
  lastVerifiedAt: z.iso.datetime(),
  dataStatus: dataStatusSchema,
  cautions: z.array(z.string()).optional(),
});
export type ProcedureVersion = z.infer<typeof procedureVersionSchema>;
