import { z } from 'zod';
import { municipalityCodeSchema } from './municipality.js';

/**
 * なぜ: REQUIREMENTS §7.3 Step1/Step2/Step3の入力項目、§9.2 ルール入力、
 * §14.1 チェックリスト生成入力例と1:1で対応する境界スキーマ。
 * UserProfileはサーバーに保存しない(§13.3)ため、ここではDTO形状のみを定義する。
 */

/**
 * なぜ: §7.3 Step1「転入先自治体」「町丁目または郵便番号(必要な自治体のみ)」。
 * postalCode/townは自治体により有無が異なるため任意項目とする(C-1/C-5: 自動解決はP1、
 * MVPは町丁目選択式だが、DTO自体は将来の郵便番号入力にも耐えるようにする)。
 */
export const destinationSchema = z.strictObject({
  municipalityCode: municipalityCodeSchema,
  postalCode: z
    .string()
    .regex(/^\d{7}$/, 'postalCode must be a 7-digit string (no hyphen)')
    .optional(),
  town: z.string().min(1).optional(),
});
export type Destination = z.infer<typeof destinationSchema>;

/**
 * なぜ: §7.3 Step1「転入元区分」。東京都外/都内別自治体/海外で適用ルール・案内文言が
 * 分岐するため必須の列挙。
 */
export const originTypeSchema = z.enum(['outside_tokyo', 'inside_tokyo', 'overseas']);
export type OriginType = z.infer<typeof originTypeSchema>;

/**
 * なぜ: §7.3 Step2「世帯員の年齢帯」の6区分。ルールDSLの ageBandsIntersects 述語
 * (計画ADR-002)が参照する固定語彙のため、自由文字列にせず列挙にする。
 */
export const ageBandSchema = z.enum([
  'age0_2',
  'age3_5',
  'elementary',
  'junior_senior',
  'adult',
  'senior65plus',
]);
export type AgeBand = z.infer<typeof ageBandSchema>;

/**
 * なぜ: §7.3 Step2「単身/複数人」+年齢帯配列。memberCountは正整数(0人世帯は無意味な
 * 入力のため境界値として拒否する)。
 */
export const householdSchema = z.strictObject({
  memberCount: z.int().positive(),
  ageBands: z.array(ageBandSchema),
});
export type Household = z.infer<typeof householdSchema>;

/**
 * なぜ: §7.3 Step3の条件チェック項目 + 計画C-10(犬のマイクロチップ分岐)。
 * dogHasMicrochipは3値(true/false/"unknown")とし、未確認時にルール評価器が
 * needs_confirmationへ倒せるようにする(hasDogがfalseの場合は無関係)。
 *
 * 設計判断: §14.1のJSON例はdogHasMicrochip/needsVehicleGuidance/isPregnantMember
 * を含まない簡略版(計画のC-10や§7.3 Step2「妊娠中の人がいるか」はREQUIREMENTS
 * §14.1より後に明確化された)。完了条件(§14.1の例がそのままparseできること)を
 * 満たしつつ§7.3で要求される全項目を型として保持するため、この3項目のみ
 * デフォルト値付き(false/"unknown" = 「該当なし・未確認」の安全側デフォルト)とする。
 */
export const flagsSchema = z.strictObject({
  hasMyNumberCard: z.boolean(),
  needsNationalHealthInsurance: z.boolean(),
  needsNationalPension: z.boolean(),
  hasSchoolOrChildcareNeeds: z.boolean(),
  hasDog: z.boolean(),
  dogHasMicrochip: z.union([z.boolean(), z.literal('unknown')]).default('unknown'),
  needsDisabilityOrCareSupport: z.boolean(),
  needsForeignResidentGuidance: z.boolean(),
  needsVehicleGuidance: z.boolean().default(false),
  isPregnantMember: z.boolean().default(false),
});
export type Flags = z.infer<typeof flagsSchema>;

/**
 * なぜ: §14.1のチェックリスト生成入力例、§9.2 ルール入力の全項目に対応する
 * トップレベルのプロフィールDTO。moveDateはISO日付文字列のまま保持し(CLAUDE.md §7:
 * 日付・期限計算はタイムゾーンを明示してテストする方針をpackages/rulesへ委譲するため)、
 * Dateオブジェクト化しない。
 */
export const profileSchema = z.strictObject({
  destination: destinationSchema,
  moveDate: z.iso.date(),
  originType: originTypeSchema,
  household: householdSchema,
  flags: flagsSchema,
});
export type Profile = z.infer<typeof profileSchema>;
