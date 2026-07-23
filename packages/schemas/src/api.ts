import { z } from 'zod';
import { profileSchema } from './profile.js';
import { generatedTaskSchema } from './task.js';
import { municipalityCodeSchema, municipalitySchema, coverageSchema } from './municipality.js';
import { procedureVersionSchema } from './procedure.js';
import { sourceSchema } from './source.js';
import {
  facilitySchema,
  wasteAreaSchema,
  wasteScheduleSchema,
  wasteSortingItemSchema,
} from './facility.js';

/**
 * なぜ: REQUIREMENTS §14 API契約(初期案) + 計画§8.2。境界層(HTTPリクエスト/
 * レスポンス)のスキーマのみを扱い、ルール評価・RAG生成のロジックは持たない
 * (T-002の制約: ルール評価器の実装はしない)。
 */

/**
 * なぜ: 計画§8.2「POST /api/checklists: Profile(§14.1) → {tasks[],...}」。
 * ChecklistRequestはProfileそのもの。
 */
export const checklistRequestSchema = profileSchema;
export type ChecklistRequest = z.infer<typeof checklistRequestSchema>;

/**
 * なぜ: 計画§8.2「GET /api/municipalities → {code,name,supported,officialUrl,coverage[]}」
 * (FR-001/021)。municipalitySchema(officialUrl含む)にカテゴリ別カバレッジを合成した
 * 応答契約。coverageは自治体×カテゴリの対応状況(FR-024)。T-006で追加。
 */
export const municipalityWithCoverageSchema = municipalitySchema.extend({
  coverage: z.array(coverageSchema),
});
export type MunicipalityWithCoverage = z.infer<typeof municipalityWithCoverageSchema>;

export const municipalitiesResponseSchema = z.array(municipalityWithCoverageSchema);
export type MunicipalitiesResponse = z.infer<typeof municipalitiesResponseSchema>;

/**
 * なぜ: 計画§8.2「GET /api/procedures/:id → ProcedureVersion全fields+sources」。
 * sourcesは根拠カード用に台帳の公開ビュー(Source)をそのまま返す。T-006で追加。
 */
export const procedureDetailResponseSchema = z.strictObject({
  procedure: procedureVersionSchema,
  sources: z.array(sourceSchema),
});
export type ProcedureDetailResponse = z.infer<typeof procedureDetailResponseSchema>;

/**
 * なぜ: 計画§8.2「GET /api/facilities → Facility[]」。T-006で追加。
 */
export const facilitiesResponseSchema = z.array(facilitySchema);
export type FacilitiesResponse = z.infer<typeof facilitiesResponseSchema>;

/**
 * なぜ: 計画§8.2「GET /api/waste-schedules?municipality=&area= → WasteSchedule[]+areas[]。
 * area未指定なら地区一覧」。cautionはC-9「祝日・年末年始等の例外日は展開せず注意書きで
 * 公式カレンダーへ誘導」を必ず応答に含めるため必須。schedulesはarea指定時のみ返す。T-006で追加。
 */
export const wasteSchedulesResponseSchema = z.strictObject({
  municipalityCode: municipalityCodeSchema,
  areas: z.array(wasteAreaSchema),
  schedules: z.array(wasteScheduleSchema).optional(),
  caution: z.string().min(1),
  granularityNote: z.string().optional(),
  effectiveFrom: z.iso.date().optional(),
  effectiveTo: z.iso.date().optional(),
});
export type WasteSchedulesResponse = z.infer<typeof wasteSchedulesResponseSchema>;

/**
 * なぜ: Wave1-B「GET /api/waste-sorting?municipality=&q=」。
 * q指定時は品目検索結果(items、最大30件)+total(絞り込み後の総件数。UIで
 * 「他にN件あります」等を表示できるように)。q未指定はカテゴリ別件数サマリー
 * (categories)を返す(§8.2の「一覧 or 詳細」形状に倣う。詳細=検索結果、一覧=サマリー)。
 */
export const wasteSortingSearchResponseSchema = z.strictObject({
  municipalityCode: municipalityCodeSchema,
  query: z.string().min(1),
  items: z.array(wasteSortingItemSchema).max(30),
  total: z.int().nonnegative(),
});
export type WasteSortingSearchResponse = z.infer<typeof wasteSortingSearchResponseSchema>;

export const wasteSortingCategorySummarySchema = z.strictObject({
  category: z.string().min(1),
  count: z.int().nonnegative(),
});
export type WasteSortingCategorySummary = z.infer<typeof wasteSortingCategorySummarySchema>;

export const wasteSortingSummaryResponseSchema = z.strictObject({
  municipalityCode: municipalityCodeSchema,
  categories: z.array(wasteSortingCategorySummarySchema),
  total: z.int().nonnegative(),
});
export type WasteSortingSummaryResponse = z.infer<typeof wasteSortingSummaryResponseSchema>;

/**
 * なぜ: 計画§8.2の応答形状。tasksは生成された全GeneratedTask、ruleVersionは
 * 適用したルールセットのバージョン(§13.2「生成時のRuleVersionを保持」)、
 * generatedAtは生成時刻(ステートレスAPIのため毎回算出・保存はしない §8.1)。
 */
export const checklistResponseSchema = z.strictObject({
  tasks: z.array(generatedTaskSchema),
  ruleVersion: z.string().min(1),
  generatedAt: z.iso.datetime(),
});
export type ChecklistResponse = z.infer<typeof checklistResponseSchema>;

/**
 * なぜ: REQUIREMENTS §11.3 検索スコープ「municipalityCode / procedureId or
 * category / language / reviewStatus=approved / effectiveFrom-To」を
 * クライアントから受け取る最小項目に絞る(reviewStatus等はサーバー側で強制するため
 * リクエストに含めない。ADR-004「クライアント指定不可」)。
 * CLAUDE.md原則6・7: 氏名・電話・メール・完全な生年月日・マイナンバー・完全住所・
 * チャット中の個人情報を収集/ログしないため、questionのみを自由入力として扱う。
 */
export const chatRequestSchema = z.strictObject({
  municipalityCode: municipalityCodeSchema,
  // なぜ: 質問は最大500字(T-013。過大入力・コスト・インジェクション面を抑える)。
  question: z.string().min(1).max(500),
  procedureId: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/**
 * なぜ: §11.4 回答フォーマット(端的な回答/条件・注意事項/公式根拠カード/確度or要確認/
 * 問い合わせ先)。citationsは公式根拠カードに対応し、confidenceは確度表示、
 * abstainedは§11.5「根拠が見つからない場合は確認できませんと明示」する保留フラグ。
 */
export const chatCitationSchema = z.strictObject({
  sourceId: z.string().min(1),
  title: z.string().min(1),
  ownerOrganization: z.string().min(1),
  url: z.url(),
  lastVerifiedAt: z.iso.datetime(),
});
export type ChatCitation = z.infer<typeof chatCitationSchema>;

export const chatResponseSchema = z.strictObject({
  answer: z.string().min(1),
  citations: z.array(chatCitationSchema),
  confidence: z.enum(['high', 'medium', 'low', 'unknown']),
  abstained: z.boolean(),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

/**
 * なぜ: 全APIの失敗時契約。CLAUDE.md §7「ユーザー向けエラーは次の行動が分かる
 * 文面にする」ため、messageに加えて機械可読なcodeを持たせる。
 */
export const errorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1).optional(),
    // なぜ: FR-021。未対応自治体などで「次の行動(公式サイトを見る)」を示すため、
    // 該当時のみ公式トップURLを添える追加的optionalフィールド(T-006で追加)。
    officialUrl: z.url().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
