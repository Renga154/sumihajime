import { z } from 'zod';
import { httpsUrlSchema } from './url.js';
import { municipalityCodeSchema } from './municipality.js';

/**
 * なぜ: REQUIREMENTS §12.3 データソース台帳の全フィールド + §12.4 取得・公開フロー。
 * CLAUDE.md原則5「非公式まとめサイトを一次根拠にしない」「10. データのライセンスと
 * 帰属を追跡する」を満たすための境界スキーマ。
 */

/**
 * なぜ: §12.3 sourceType(API/CSV/JSON/HTML/PDF)。
 * 'xlsx' は Step5-B(大田区13111)で追加。収集曜日オープンデータが XLSX(結合セル)でのみ
 * 配信される自治体があり、配信元・ライセンス(opendata.metro CC BY)を HTML 導線ページ
 * (区サイト利用規約)と区別して正直に来歴追跡する(CLAUDE.md原則10)ために必要な追加。
 * 既存値は不変・後方互換(additive)。
 */
export const sourceTypeSchema = z.enum(['api', 'csv', 'json', 'html', 'pdf', 'xlsx']);
export type SourceType = z.infer<typeof sourceTypeSchema>;

/**
 * なぜ: §12.4「人手承認済みデータだけを公開対象にする」、計画ADR-003
 * (Gitベースレビュー+CIの来歴チェック)。candidate→pending→approved/rejected、
 * 有効期限切れはstaleへ遷移する(§12.5)。
 */
export const reviewStatusSchema = z.enum(['candidate', 'pending', 'approved', 'rejected', 'stale']);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

/**
 * なぜ: sourceId は台帳の主キーであると同時に、ファイルパス(data/sources/<code>/snapshots/
 * <id>.<YYYYMMDD>.<ext>)・wrangler の引数・ICS の UID・SQL 文字列へそのまま流れる。
 * `min(1)` だけだと `../`・`/`・先頭の `-`(オプション注入)・改行・引用符まで通ってしまうため、
 * 台帳の全388件(2026-10-02 時点)が従う `src-<5桁の自治体コード>-<カテゴリ>-<3桁の連番>` だけを許す。
 * カテゴリは英小文字始まりの [a-z0-9_] に限り、長さは既存最長(25字)に余裕を持たせて48字まで。
 * 形を変えるときは台帳全件と、この ID をパスに使う scripts(ingest / reaudit / publish / rag)を
 * あわせて見直すこと。
 */
export const SOURCE_ID_PATTERN = /^src-\d{5}-[a-z][a-z0-9_]{0,47}-\d{3}$/;
export const sourceIdSchema = z
  .string()
  .regex(SOURCE_ID_PATTERN, 'sourceId must look like src-<5-digit code>-<category>-<3-digit seq>');
export type SourceId = z.infer<typeof sourceIdSchema>;

/**
 * なぜ: §12.3 データソース台帳の全項目を1:1で表現する。municipalityCodeは
 * 都道府県・国レベルソース等で自治体に紐付かない場合もあるためoptionalとする。
 */
export const sourceSchema = z.strictObject({
  sourceId: sourceIdSchema,
  sourceTitle: z.string().min(1),
  ownerOrganization: z.string().min(1),
  municipalityCode: municipalityCodeSchema.optional(),
  category: z.string().min(1),
  sourceUrl: httpsUrlSchema,
  sourceType: sourceTypeSchema,
  license: z.string().min(1),
  attributionText: z.string().min(1),
  fetchMethod: z.string().min(1),
  updateFrequency: z.string().min(1),
  lastFetchedAt: z.iso.datetime().optional(),
  lastVerifiedAt: z.iso.datetime().optional(),
  sourceLastModifiedAt: z.iso.datetime().optional(),
  contentHash: z.string().optional(),
  /**
   * ADR-014: 承認時スナップショットから抽出器(@tmn/drift)で機械的に得たページ自身の「更新日」。
   * 定期巡回の比較基準。csv/xlsx や更新日表記の無い HTML は未設定。publish が埋め、
   * 公開ビュー(sourceLedgerEntrySchema)には出さない(内部の巡回用メタ)。
   */
  snapshotPageUpdatedOn: z.iso.date().optional(),
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
  sourceId: sourceIdSchema,
  storageKey: z.string().min(1),
  contentHash: z.string().min(1),
  fetchedAt: z.iso.datetime(),
});
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
