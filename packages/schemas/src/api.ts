import { z } from 'zod';
import { profileSchema } from './profile.js';
import { generatedTaskSchema } from './task.js';
import { municipalityCodeSchema } from './municipality.js';

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
  question: z.string().min(1),
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
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
