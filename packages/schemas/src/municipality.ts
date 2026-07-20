import { z } from 'zod';

/**
 * なぜ: REQUIREMENTS §12.6/§13.1/計画§8.1 municipalities テーブル。
 * 自治体コード(5桁)は全ドメインで共有する境界値のため、他ファイルから参照できるよう
 * ここで定義する(originatingフィールドの単一の真実)。
 */
export const municipalityCodeSchema = z
  .string()
  .regex(/^\d{5}$/, 'municipalityCode must be a 5-digit string');

/**
 * なぜ: REQUIREMENTS §14 GET /api/municipalities の応答契約、
 * および原則4「選択自治体と異なる自治体の情報を混ぜない」を型で保証する基礎。
 */
export const municipalitySchema = z.strictObject({
  code: municipalityCodeSchema,
  name: z.string().min(1),
  supported: z.boolean(),
  note: z.string().optional(),
});
export type Municipality = z.infer<typeof municipalitySchema>;

/**
 * なぜ: REQUIREMENTS §13.1 MunicipalityCoverage / §15.5 未対応自治体・カテゴリを
 * 対応済みに見せない(CLAUDE.md原則9)ための状態表現。計画§8.1 coverageテーブルと対応。
 */
export const coverageStatusSchema = z.enum(['verified', 'partial', 'unavailable']);
export type CoverageStatus = z.infer<typeof coverageStatusSchema>;

/**
 * なぜ: FR-024(coverage表示)。カテゴリ別・自治体別の対応状況を保持する。
 */
export const coverageSchema = z.strictObject({
  municipalityCode: municipalityCodeSchema,
  category: z.string().min(1),
  status: coverageStatusSchema,
  lastVerifiedAt: z.iso.datetime(),
});
export type Coverage = z.infer<typeof coverageSchema>;
