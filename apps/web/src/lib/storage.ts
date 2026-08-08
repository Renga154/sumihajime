import { z } from 'zod';
import { ageBandSchema, originTypeSchema, profileSchema, type Profile } from '@tmn/schemas';

/**
 * なぜ: §13 データ最小化 / FR-010・FR-011 / C-4。利用者データは端末内(localStorage)のみに
 * 保存し、サーバーへは送らない。保存対象はプロフィール(再訪時の復元)と完了状態のみ。
 * 氏名・電話・メール・番地などの個人情報はそもそも入力させないため保存しない。
 *
 * 完了状態(C-4): procedureId をキーに {doneAt, ruleVersion} を保持する。条件変更で
 * 非該当になったタスクの完了記録は「削除せず」残し、UIは現在該当するタスクだけ表示する。
 * これにより再度該当したとき完了状態が復元される(削除しない=再該当時に復活)。
 */

const MUNICIPALITY_KEY = 'tmn:municipality';
const profileKey = (code: string) => `tmn:profile:${code}`;
const doneKey = (code: string) => `tmn:done:${code}`;
const reviewedStepsKey = (code: string) => `tmn:reviewed-steps:${code}`;
const wizardDraftKey = (code: string) => `tmn:wizard-draft:${code}`;

export interface DoneRecord {
  doneAt: string;
  ruleVersion: string;
}
export type DoneMap = Record<string, DoneRecord>;

/**
 * 任意ステップ(2:世帯 / 3:条件チェック)を利用者が実際に開いたか。
 *
 * なぜ Profile と別に持つか: Profile は `strictObject` で、そのまま POST /api/checklists の
 * リクエストボディになる。ここへ画面の進行状況を足すと境界スキーマが弾く(=422)。
 * また「どのステップを見たか」は手続きの判定に一切影響しない純粋なUI状態で、
 * サーバーへ送る理由がない(§13 データ最小化)。
 *
 * なぜ必要か: フラグが全て false という状態は「ステップ3を飛ばした」と
 * 「ステップ3を開いて、正しく1つも当てはまらなかった」の両方から生じる。データだけでは
 * 区別できず、後者に「未入力です」と表示するのは事実に反する(原則3: 推測しない)。
 */
export interface ReviewedSteps {
  /** ステップ2(世帯)を開いたか。 */
  household: boolean;
  /** ステップ3(条件チェック)を開いたか。 */
  conditions: boolean;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** ---- 選択中の自治体コード ---- */

export function loadMunicipalityCode(): string | null {
  return safeLocalStorage()?.getItem(MUNICIPALITY_KEY) ?? null;
}

export function saveMunicipalityCode(code: string): void {
  safeLocalStorage()?.setItem(MUNICIPALITY_KEY, code);
}

/** ---- プロフィール(自治体別) ---- */

export function loadProfile(code: string): Profile | null {
  const raw = safeLocalStorage()?.getItem(profileKey(code));
  if (!raw) return null;
  try {
    const parsed = profileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveProfile(code: string, profile: Profile): void {
  safeLocalStorage()?.setItem(profileKey(code), JSON.stringify(profile));
}

/** ---- 任意ステップの閲覧記録(自治体別) ---- */

/**
 * 記録が無い場合は両方 false を返す。修正前に保存されたプロフィールには記録が無いため、
 * 「開いたと分かっている場合だけ案内を消す」保守側に倒れる(誤って案内を隠さない)。
 */
export function loadReviewedSteps(code: string): ReviewedSteps {
  const raw = safeLocalStorage()?.getItem(reviewedStepsKey(code));
  if (!raw) return { household: false, conditions: false };
  try {
    const obj: unknown = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return { household: false, conditions: false };
    const rec = obj as Partial<Record<keyof ReviewedSteps, unknown>>;
    return { household: rec.household === true, conditions: rec.conditions === true };
  } catch {
    return { household: false, conditions: false };
  }
}

export function saveReviewedSteps(code: string, steps: ReviewedSteps): void {
  safeLocalStorage()?.setItem(reviewedStepsKey(code), JSON.stringify(steps));
}

/** ---- ウィザードの下書き(確定前・自治体別) ---- */

/**
 * ウィザードで入力中の回答。確定プロフィール(Profile)へ変換する前の、画面上のままの形。
 *
 * なぜ Profile と別のキー(`tmn:wizard-draft:<code>`)に分けるか:
 *  1. Profile は「この内容でチェックリストを作成」を押して確定した回答であり、チェックリストの
 *     該当判定はこれだけを見る。入力途中の値をここへ書くと、まだ確定していない条件で
 *     タスクが増減し、利用者が見ていない前提のチェックリストが出てしまう。
 *  2. `profileSchema` は strictObject で、そのまま POST /api/checklists のリクエスト本体になる。
 *     未入力(moveDate='' など)や画面状態(現在のステップ)は境界スキーマを通らない。
 *  3. 同じ理由で、閲覧記録は既に `tmn:reviewed-steps:<code>` へ分けてある。下書きもそれに倣う。
 *
 * 保存する範囲は確定プロフィールと同一(引越し日・転入元区分・世帯人数区分・年齢帯・条件フラグ)。
 * 氏名・電話・メール・番地・生年月日・マイナンバーは入力欄自体が無く、当然保存もしない
 * (CLAUDE.md 原則6・7 / §13 データ最小化)。保存先は端末内の localStorage のみ。
 */
export const wizardAnswersSchema = z.object({
  /** 未入力を許すため空文字も受ける(確定時に profileSchema 側で日付として検証される)。 */
  moveDate: z.union([z.iso.date(), z.literal('')]),
  originType: z.union([originTypeSchema, z.literal('')]),
  householdKind: z.enum(['single', 'multiple']),
  ageBands: z.array(ageBandSchema),
  isPregnant: z.boolean(),
  flags: z.object({
    hasMyNumberCard: z.boolean(),
    needsNationalHealthInsurance: z.boolean(),
    needsNationalPension: z.boolean(),
    hasSchoolOrChildcareNeeds: z.boolean(),
    hasDog: z.boolean(),
    needsDisabilityOrCareSupport: z.boolean(),
    needsForeignResidentGuidance: z.boolean(),
    needsVehicleGuidance: z.boolean(),
  }),
  dogMicrochip: z.enum(['yes', 'no', 'unknown']),
});
export type WizardAnswers = z.infer<typeof wizardAnswersSchema>;

export const wizardDraftSchema = z.object({
  answers: wizardAnswersSchema,
  /** 中断したステップ。再開時に同じ画面へ戻すためだけに使う。 */
  step: z.number().int().min(1).max(3),
  /** 任意ステップの閲覧記録。リロードで失うと「未入力です」と誤った案内を出してしまう。 */
  reviewedSteps: z.object({ household: z.boolean(), conditions: z.boolean() }),
});
export type WizardDraft = z.infer<typeof wizardDraftSchema>;

/** 壊れた/古い形式の下書きは「下書き無し」として扱う(確定値へ混ぜない)。 */
export function loadWizardDraft(code: string): WizardDraft | null {
  const raw = safeLocalStorage()?.getItem(wizardDraftKey(code));
  if (!raw) return null;
  try {
    const parsed = wizardDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveWizardDraft(code: string, draft: WizardDraft): void {
  safeLocalStorage()?.setItem(wizardDraftKey(code), JSON.stringify(draft));
}

export function clearWizardDraft(code: string): void {
  safeLocalStorage()?.removeItem(wizardDraftKey(code));
}

/**
 * 回答が同じ内容か(純関数)。画面状態(ステップ・閲覧記録)は比較しない。
 *
 * なぜ回答だけを見るか: 「復元しました」と伝えてよいのは回答が残っているときだけで、
 * ステップを進めただけの状態を復元と呼ぶと、何も入力していない利用者に嘘を伝えることになる。
 */
export function isSameWizardAnswers(a: WizardAnswers, b: WizardAnswers): boolean {
  const normalize = (x: WizardAnswers) => ({ ...x, ageBands: [...x.ageBands].sort() });
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/** ---- 完了状態(自治体別、procedureId キー) ---- */

export function loadDone(code: string): DoneMap {
  const raw = safeLocalStorage()?.getItem(doneKey(code));
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === 'object') return obj as DoneMap;
    return {};
  } catch {
    return {};
  }
}

export function saveDone(code: string, map: DoneMap): void {
  safeLocalStorage()?.setItem(doneKey(code), JSON.stringify(map));
}

/**
 * 完了状態を切り替えた新しいDoneMapを返す(純関数。呼び出し側で saveDone する)。
 * done=false のときも記録は残さず削除する(明示的な「未完了へ戻す」操作)。ただし
 * 「非該当になったタスクを隠す」処理はUI側(現在のタスク一覧との突き合わせ)で行い、
 * ここでは触らない — これがC-4「非該当でも記録を消さない」を成立させる。
 */
export function toggleDone(
  map: DoneMap,
  procedureId: string,
  ruleVersion: string,
  done: boolean,
): DoneMap {
  const next = { ...map };
  if (done) {
    next[procedureId] = { doneAt: new Date().toISOString(), ruleVersion };
  } else {
    delete next[procedureId];
  }
  return next;
}

export function isDone(map: DoneMap, procedureId: string): boolean {
  return Boolean(map[procedureId]);
}
