import { z } from 'zod';
import { httpsUrlSchema } from './url.js';
import { profileSchema } from './profile.js';
import { driftKindSchema, generatedTaskSchema, taskSourceRefSchema } from './task.js';
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
 * なぜ: 計画§8.2で予約済みの「GET /api/sources(データソース台帳の公開ビュー)」(Wave3)。
 * CLAUDE.md原則2「公開する全タスクに承認済み公式ソースと最終確認日」/ 原則10「ライセンスと
 * 帰属を追跡」を利用者・審査員へ可視化するための台帳ビュー。sourceSchema から公開に必要な
 * 列だけを pick し、内部レビュー用メタ(reviewStatus/reviewer/contentHash/fetchMethod/
 * lastFetchedAt/sourceLastModifiedAt/notes)は公開ビューに含めない(approvedのみを返す前提で
 * reviewStatus自体も出さない)。API側は review_status='approved' をSQLで強制フィルタする。
 */
export const sourceLedgerEntrySchema = sourceSchema.pick({
  sourceId: true,
  sourceTitle: true,
  ownerOrganization: true,
  municipalityCode: true,
  category: true,
  sourceUrl: true,
  sourceType: true,
  license: true,
  attributionText: true,
  lastVerifiedAt: true,
  updateFrequency: true,
  effectiveFrom: true,
  effectiveTo: true,
});
export type SourceLedgerEntry = z.infer<typeof sourceLedgerEntrySchema>;

export const sourcesResponseSchema = z.array(sourceLedgerEntrySchema);
export type SourcesResponse = z.infer<typeof sourcesResponseSchema>;

/**
 * なぜ: GET /api/stats(トップの「このサービスの約束」で使う実測サマリー)。
 *
 * トップに「23区対応 / 公式ソース332件 / 最終確認日」を出したいが、手打ちの数値は必ず古くなる
 * (区・ソースが増減しても追随しない)。かといって /api/sources(332件の台帳全文)をトップで
 * 取得するのは初回転送量の観点で本末転倒なので、集計値だけを返す軽量エンドポイントを用意する。
 * 値はすべて公開済みD1の実データから毎回 COUNT/MAX で導出し、定数を持たない。
 * 母数(totalMunicipalities)も返すのは「62自治体中23が対応」という誠実な文脈を保つため
 * (CLAUDE.md原則9: 未対応を対応済みに見せない)。
 */
export const serviceStatsSchema = z.strictObject({
  /** 対応済み自治体数(supported=1)。 */
  supportedMunicipalities: z.int().nonnegative(),
  /** 掲載している自治体の総数(対応・未対応の合計)。 */
  totalMunicipalities: z.int().nonnegative(),
  /** 承認済み(review_status='approved')の公式ソース件数。 */
  approvedSources: z.int().nonnegative(),
  /** 承認済みソースの最終確認日のうち最も新しいもの(YYYY-MM-DD)。台帳が空なら省略。 */
  lastVerifiedDate: z.iso.date().optional(),
  /**
   * ADR-014: 定期巡回が「再確認中」にしているソース件数(効力のある changed/unreachable)。
   * 対応状況ページの「機械巡回の状況」用。巡回テーブルが無い旧クライアント・旧テストのため optional。
   */
  driftFlaggedSources: z.int().nonnegative().optional(),
  /** 最後に巡回した時刻(ISO datetime)。まだ一度も巡回していなければ省略。 */
  driftLastCheckedAt: z.iso.datetime().optional(),
});
export type ServiceStats = z.infer<typeof serviceStatsSchema>;

/**
 * なぜ: 計画§8.2「GET /api/procedures/:id → ProcedureVersion全fields+sources」。
 * sourcesは根拠カード用の台帳ビュー。当初は sourceSchema(全列)をそのまま返しており、
 * reviewStatus/reviewer(内部レビュー担当者名)/contentHash/fetchMethod といった内部運用列が
 * GET /api/sources とは別経路(このエンドポイント)から漏れていた(2026-08-08発覚。notes列の
 * 内部用語混入と同根の「公開経路が複数あり、片方だけ射影を絞っていた」構造的問題)。
 * sourceLedgerEntrySchema(公開列のみ)を土台にした専用ビューに統一する。
 *
 * 2026-09-29: notes を外した。notes は取り込み・監査の作業メモで利用者向けに書かれておらず、
 * どの画面も表示していなかった。GET /api/sources は当初から除外しており、この経路だけが
 * 出していた(2エンドポイントの射影の食い違い)。API側は publicSourceView 1つで射影する。
 */
export const procedureSourceSchema = sourceLedgerEntrySchema.extend({
  // ADR-014: 巡回の検知結果(根拠カードの「更新を検知」行)。taskSourceRefSchema と同じ2項目。
  driftDetectedOn: z.iso.date().optional(),
  driftKind: driftKindSchema.optional(),
});
export type ProcedureSource = z.infer<typeof procedureSourceSchema>;

export const procedureDetailResponseSchema = z.strictObject({
  procedure: procedureVersionSchema,
  sources: z.array(procedureSourceSchema),
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
 * 「前住所地の転出予定日(Profile.moveOutScheduledDate)を入れたら、この人の期日表示は
 * 何が変わるか」を、そのチェックリストの中身から導いた結果(ADR-013の後日追記)。
 *
 * なぜAPIが返すのか: どの手続きがどの日付を起算日にしているかは**区ごとのルールデータ**にしか
 * 無い。UI側が「この区なら児童手当の期限が出せる」と判断するには区コードの分岐を画面へ
 * 書くしかなく、CLAUDE.md §4「自治体固有ロジックをUIへ直接埋め込まない」に反する。
 * 判定材料そのものをルール由来のデータとして応答へ載せ、UIは受け取った procedureId を
 * 同じ応答の tasks と突き合わせて手続き名を出すだけにする。
 *
 * なぜ procedureId だけで、手続き名を含めないのか: 名前は同じ応答の tasks[].title が唯一の
 * 出どころで、二重に持たせると画面の見出しと案内文がずれうる。ここに載る procedureId は
 * 必ず tasks に含まれる(表に出ないタスク=not_applicableは対象にしない)。
 */
export const moveOutScheduledDateImpactSchema = z.strictObject({
  /**
   * いまは期日を出せておらず(「期限は要確認」)、転出予定日があれば算定できるようになる手続き。
   * 転出予定日が既に入力済みなら空になる(これ以上得られるものが無いため)。
   */
  enablesDueDateFor: z.array(z.string().min(1)),
  /**
   * 既に期日は出ているが、区が転出予定日起算の条件も併記しているため、入力すると
   * **より早い**期日に変わりうる手続き(dueRule = earliestOf)。遅い期日を見せたままにすると
   * マイナンバーカードの失効のような実害につながるため、変わりうること自体を伝える。
   */
  advancesDueDateFor: z.array(z.string().min(1)),
});
export type MoveOutScheduledDateImpact = z.infer<typeof moveOutScheduledDateImpactSchema>;

/**
 * なぜ: 計画§8.2の応答形状。tasksは生成された全GeneratedTask、ruleVersionは
 * 適用したルールセットのバージョン(§13.2「生成時のRuleVersionを保持」)、
 * generatedAtは生成時刻(ステートレスAPIのため毎回算出・保存はしない §8.1)。
 *
 * moveOutScheduledDateImpact を optional にした理由: 端末内の控え(checklist-cache)は
 * このスキーマで読み直す。必須にすると、この項目が無い時点で保存された控えが丸ごと
 * 読めなくなり、電波の弱い場所でチェックリスト本体を失う(原則8)。案内が1つ出ないことより
 * 本体が消えるほうが害が大きいので、無ければ案内を出さないだけにする。
 */
export const checklistResponseSchema = z.strictObject({
  tasks: z.array(generatedTaskSchema),
  ruleVersion: z.string().min(1),
  generatedAt: z.iso.datetime(),
  moveOutScheduledDateImpact: moveOutScheduledDateImpactSchema.optional(),
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
 * なぜ: §11.4 回答フォーマット(端的な回答/条件・注意事項/公式根拠カード/問い合わせ先)。
 * citationsは公式根拠カードに対応し、abstainedは§11.5「根拠が見つからない場合は確認できませんと
 * 明示」する保留フラグ。
 *
 * confidence は **内部値**であり、UIには表示しない(ADR-010)。RAG経路の値は検索スコア
 * (cosine類似度)だけから算出され、回答の正しさを表さない — 実際に持ち物の誤答へ 'high' が
 * 付いていた。誤解を招く指標を確度として見せないため表示を廃止し、評価・計測用にのみ残す。
 */
export const chatCitationSchema = z.strictObject({
  sourceId: z.string().min(1),
  title: z.string().min(1),
  ownerOrganization: z.string().min(1),
  url: httpsUrlSchema,
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
    officialUrl: httpsUrlSchema.optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/**
 * なぜ: GET /api/ward-differences(区をまたぐ期限差分の比較ページ /differences の唯一のデータ源)。
 *
 * 原則4「選択自治体と異なる自治体の情報を混ぜない」との関係:
 *   これは「自治体間の比較」を利用者が明示的に選んで見にいく専用エンドポイントであり、
 *   チェックリスト(POST /api/checklists)・手続き詳細(GET /api/procedures/:id)・
 *   RAG(POST /api/chat)の応答には一切含めない。区ごとの公開データ(procedures.json /
 *   rules.json)へ他区の値を書き戻すことは packages/rules/src/cross-ward-text.test.ts が
 *   禁止しており、この契約はその不変条件に触れない(読むだけで書かない)。
 *
 * 値(valueLabel)は @tmn/rules の純関数が公開済みデータから毎回導出したもので、
 * サーバー側にハードコードした比較表は持たない。根拠(sources)は最低1件を型で強制し、
 * 「公開する全タスクに承認済み公式ソースと最終確認日を付ける」(原則2)を比較ページでも守る。
 */
export const wardDifferenceToneSchema = z.enum(['neutral', 'caution']);
export type WardDifferenceTone = z.infer<typeof wardDifferenceToneSchema>;

export const wardDifferenceCellSchema = z.strictObject({
  municipalityCode: municipalityCodeSchema,
  municipalityName: z.string().min(1),
  valueId: z.string().min(1),
  valueLabel: z.string().min(1),
  tone: wardDifferenceToneSchema,
  /** その区の公式文言(同じ区の利用者がチェックリストで見ている文と同一)。 */
  officialText: z.string().min(1),
  procedureTitle: z.string().min(1),
  sources: z.array(taskSourceRefSchema).min(1),
});
export type WardDifferenceCell = z.infer<typeof wardDifferenceCellSchema>;

export const wardDifferenceValueGroupSchema = z.strictObject({
  valueId: z.string().min(1),
  label: z.string().min(1),
  tone: wardDifferenceToneSchema,
  municipalityCodes: z.array(municipalityCodeSchema).min(1),
});
export type WardDifferenceValueGroup = z.infer<typeof wardDifferenceValueGroupSchema>;

export const wardDifferenceTopicSchema = z.strictObject({
  topicId: z.string().min(1),
  title: z.string().min(1),
  question: z.string().min(1),
  procedureId: z.string().min(1),
  /** 値をどう機械判定したかの説明。推測でないことを利用者へ開示するため必須。 */
  derivationNote: z.string().min(1),
  valueGroups: z.array(wardDifferenceValueGroupSchema),
  cells: z.array(wardDifferenceCellSchema),
  /** 手続き・ルール・承認済み根拠が揃わず比較対象にできなかった区(未整備を隠さない=原則9)。 */
  omittedMunicipalityCodes: z.array(municipalityCodeSchema),
});
export type WardDifferenceTopic = z.infer<typeof wardDifferenceTopicSchema>;

export const wardDifferencesResponseSchema = z.strictObject({
  municipalities: z.array(
    z.strictObject({ code: municipalityCodeSchema, name: z.string().min(1) }),
  ),
  topics: z.array(wardDifferenceTopicSchema),
});
export type WardDifferencesResponse = z.infer<typeof wardDifferencesResponseSchema>;
