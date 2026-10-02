import { z } from 'zod';
import { municipalityCodeSchema } from './municipality.js';

/**
 * なぜ: REQUIREMENTS §7.3 Step1/Step2/Step3の入力項目、§9.2 ルール入力、
 * §14.1 チェックリスト生成入力例と1:1で対応する境界スキーマ。
 * UserProfileはサーバーに保存しない(§13.3)ため、ここではDTO形状のみを定義する。
 */

/**
 * なぜ: §7.3 Step1「転入先自治体」。
 *
 * 2026-09-29(ADR-016): 以前は §14.1 の例に合わせて postalCode / town(町丁目)を任意で受け付けて
 * いたが、どの画面も送らず、ルール評価もAPIも読まない項目だった。使わない住所の細目を受け取る口が
 * あると、誤ってログや保存へ流れる経路にもなる(原則6・7)。strictObject なので、送られた場合は
 * 検証エラー(API は 422)になる。町丁目が必要になった時点(ごみ収集地区の自動解決など)で、
 * 用途・保存しないこと・ログに出さないことを決めてから改めて足す。
 */
export const destinationSchema = z.strictObject({
  municipalityCode: municipalityCodeSchema,
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
 * 上限20(人数・年齢帯の件数とも): 巨大な数・配列でルール評価と検証の負荷を上げられないように
 * する。画面(WizardPage)は年齢帯をチェックボックスで選ぶため最大6件・memberCount も最大6で、
 * 20 は正当な入力に十分な余裕を持たせた値(保存済みプロフィールの再読込も落とさない)。
 */
export const MAX_HOUSEHOLD_MEMBERS = 20;

export const householdSchema = z.strictObject({
  memberCount: z.int().positive().max(MAX_HOUSEHOLD_MEMBERS),
  ageBands: z.array(ageBandSchema).max(MAX_HOUSEHOLD_MEMBERS),
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
 * 引越し日・転出予定日として受け付ける暦日の範囲(両端を含む)。
 *
 * なぜ範囲を持つか(2026-10-02 監査): 以前は形式(YYYY-MM-DD)だけを見ていたため、9999-12-31 は
 * 期限計算で1万年に繰り上がって応答の検証に落ち、0001-01-01 は JavaScript の Date が 0〜99 年を
 * 1900 年代と解釈する仕様に当たって、どちらも 500 になっていた。入力の誤りは 422 で返すべきで、
 * 「サーバーの不具合」に見せない。
 *
 * なぜこの広さか: 画面(WizardPage)の受付範囲は「今日の前後1年」で、ここより常に狭い。
 * プロフィールは端末(localStorage)に保存され、読み込むたびにこのスキーマで検証し直す
 * (apps/web/src/lib/storage.ts)。範囲を画面と同じ「今日基準」にすると、1年前に保存した控えが
 * ある日突然読めなくなるため、固定の広い範囲にする。下限はサービス開始(2026年)より十分前、
 * 上限は期限計算(最大でも数百日の加算)が4桁の年に収まる値。
 * 引越し日と転出予定日の前後関係は強制しない(転出予定日はどちらにもなり得る。画面も強制していない)。
 */
export const PROFILE_DATE_MIN = '2000-01-01';
export const PROFILE_DATE_MAX = '2100-12-31';

/** ISO 暦日(存在する日付)かつ受付範囲内。YYYY-MM-DD は文字列の大小が日付の前後と一致する。 */
export const profileDateSchema = z.iso
  .date()
  .refine((d) => d >= PROFILE_DATE_MIN && d <= PROFILE_DATE_MAX, {
    message: `date must be between ${PROFILE_DATE_MIN} and ${PROFILE_DATE_MAX}`,
  });

/**
 * なぜ: §14.1のチェックリスト生成入力例、§9.2 ルール入力の全項目に対応する
 * トップレベルのプロフィールDTO。moveDateはISO日付文字列のまま保持し(CLAUDE.md §7:
 * 日付・期限計算はタイムゾーンを明示してテストする方針をpackages/rulesへ委譲するため)、
 * Dateオブジェクト化しない。
 */
export const profileSchema = z.strictObject({
  destination: destinationSchema,
  moveDate: profileDateSchema,
  /**
   * なぜ任意項目か: 児童手当の15日特例は多くの区が「前住所地の転出予定日の翌日から15日以内」と
   * 明記しており(例: 板橋区「出生日・転入日(前住所地の転出予定日)等の事由発生日の翌日から起算して
   * 15日以内」)、マイナンバーカードの継続利用も「転出予定日から30日以内に転入届」を条件に挙げる区が
   * ある。これらは moveDate では算定できず、この日付が無い限り期日を出せない。
   *
   * ただし転出予定日は「前住所地で転出届を出したときに自分で決めた日」であり、まだ転出届を出して
   * いない利用者や、値を覚えていない利用者が存在する。必須にすると入力を止めてしまうため任意とし、
   * 未入力なら従来どおり期日を算定せず公式文言(要確認)を表示する — 推測で埋めない(CLAUDE.md原則3)。
   *
   * プライバシー: 収集するのは暦日のみで、氏名・電話・完全な生年月日等は増やさない(原則6・7)。
   * 保存先は端末内(localStorage)のみで、moveDate と同じ扱い(サーバーに保存しない §13.3)。
   *
   * 後方互換: optional のため、この項目を持たない既存の保存済みプロフィールもそのまま parse できる。
   */
  moveOutScheduledDate: profileDateSchema.optional(),
  originType: originTypeSchema,
  household: householdSchema,
  flags: flagsSchema,
});
export type Profile = z.infer<typeof profileSchema>;
