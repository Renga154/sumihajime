import { z } from 'zod';
import { municipalityCodeSchema } from './municipality.js';

/**
 * なぜ: REQUIREMENTS §12.3 データソース台帳の全フィールド + §12.4 取得・公開フロー。
 * CLAUDE.md原則5「非公式まとめサイトを一次根拠にしない」「10. データのライセンスと
 * 帰属を追跡する」を満たすための境界スキーマ。
 */

/** なぜ: §12.3 sourceType(API/CSV/JSON/HTML/PDF)。 */
export const sourceTypeSchema = z.enum(['api', 'csv', 'json', 'html', 'pdf']);
export type SourceType = z.infer<typeof sourceTypeSchema>;

/**
 * なぜ: §12.4「人手承認済みデータだけを公開対象にする」、計画ADR-003
 * (Gitベースレビュー+CIの来歴チェック)。candidate→pending→approved/rejected、
 * 有効期限切れはstaleへ遷移する(§12.5)。
 */
export const reviewStatusSchema = z.enum(['candidate', 'pending', 'approved', 'rejected', 'stale']);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

/**
 * なぜ: §12.3 データソース台帳の全項目を1:1で表現する。municipalityCodeは
 * 都道府県・国レベルソース等で自治体に紐付かない場合もあるためoptionalとする。
 */
export const sourceSchema = z.strictObject({
  sourceId: z.string().min(1),
  sourceTitle: z.string().min(1),
  ownerOrganization: z.string().min(1),
  municipalityCode: municipalityCodeSchema.optional(),
  category: z.string().min(1),
  sourceUrl: z.url(),
  sourceType: sourceTypeSchema,
  license: z.string().min(1),
  attributionText: z.string().min(1),
  fetchMethod: z.string().min(1),
  updateFrequency: z.string().min(1),
  lastFetchedAt: z.iso.datetime().optional(),
  lastVerifiedAt: z.iso.datetime().optional(),
  sourceLastModifiedAt: z.iso.datetime().optional(),
  contentHash: z.string().optional(),
  reviewStatus: reviewStatusSchema,
  reviewer: z.string().optional(),
  effectiveFrom: z.iso.date().optional(),
  effectiveTo: z.iso.date().optional(),
  notes: z.string().optional(),
});
export type Source = z.infer<typeof sourceSchema>;

/**
 * なぜ: §12.4「原文を取得し、R2等へ不変スナップショット保存」+ 計画§8.1
 * source_snapshots(id, source_id, r2_key, content_hash, fetched_at)。
 */
export const sourceSnapshotSchema = z.strictObject({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  storageKey: z.string().min(1),
  contentHash: z.string().min(1),
  fetchedAt: z.iso.datetime(),
});
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
