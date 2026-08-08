import type { GeneratedTask } from '@tmn/schemas';
import { daysBetween } from './format';

/**
 * なぜ: §7.4/§9-3 の期限順セクションへ、各タスクを dueDate / priority / applicable(要確認)
 * から決定論的に振り分ける(LLM等の非決定的判定を挟まない)。UIはこの結果で見出しごとに
 * まとめて表示する。自治体固有の分岐は持たず、schemaの値のみで判定する。
 */

export type SectionKey =
  'before_move' | 'right_after' | 'within_14' | 'within_month' | 'life_start' | 'conditional';

/** 表示順(§7.4のセクション順)。 */
export const SECTION_ORDER: SectionKey[] = [
  'before_move',
  'right_after',
  'within_14',
  'within_month',
  'life_start',
  'conditional',
];

export const sectionLabel: Record<SectionKey, string> = {
  before_move: '引越し前',
  right_after: '転入後すぐ',
  within_14: '14日以内',
  within_month: '1か月以内',
  life_start: '生活開始',
  conditional: '該当者のみ・要確認',
};

export const sectionDescription: Record<SectionKey, string> = {
  before_move: '引越し日より前に済ませておくと安心な手続きです。',
  right_after: '転入後、できるだけ早く行う手続きです。',
  within_14: '引越し日から14日以内が目安の手続きです。',
  within_month: '引越し日からおおむね1か月以内が目安の手続きです。',
  life_start: '生活を始めてから落ち着いて確認する項目です。',
  conditional: '条件に当てはまる方向けの項目、または内容の確認が必要な項目です。',
};

/**
 * 1件のタスクをセクションへ割り当てる。
 * - applicable === 'needs_confirmation' は最優先で「該当者のみ・要確認」へ。
 * - 期限日(dueDate)が無いものは優先度で振り分ける(urgent/high は「転入後すぐ」、
 *   それ以外は「生活開始」)。理由は下記。
 * - dueDate が引越し日より前なら「引越し前」。
 * - priority === 'urgent' は「転入後すぐ」。
 * - 引越し日から14日以内なら「14日以内」、31日以内なら「1か月以内」、それ以外は「生活開始」。
 */
export function assignSection(task: GeneratedTask, moveDate: string): SectionKey {
  if (task.applicable === 'needs_confirmation') return 'conditional';
  /**
   * なぜ期限日が無いものを優先度で分けるのか(2026-08-09 修正):
   * dueDate が無い理由は「急がなくてよい」ではなく「起算日が前住所地の転出予定日で、
   * 本サービスが収集しない日付だから算定できない」であることが多い。児童手当の15日特例、
   * 子ども医療費助成の遡及期限、マイナンバーカードの継続利用がこれに当たる。
   * これらを一律に「生活開始」へ送ると、見出しの説明文(「生活を始めてから落ち着いて
   * 確認する項目です。」)が、実際には期限のある手続きに対する誤った助言になる
   * (実測: 港区の子育て世帯では12件中10件が「生活開始」へ入り、うち4件が優先度「重要」だった)。
   * 期限を推測して作ることは原則3に反するのでせず、優先度という既に確定している情報で
   * 置き場所だけを正す。文面上の期限は各カードの dueDescription が引き続き示す。
   */
  if (!task.dueDate) {
    return task.priority === 'urgent' || task.priority === 'high' ? 'right_after' : 'life_start';
  }

  const days = daysBetween(moveDate, task.dueDate);
  if (Number.isNaN(days)) return 'life_start';
  if (days < 0) return 'before_move';
  if (task.priority === 'urgent') return 'right_after';
  if (days <= 14) return 'within_14';
  if (days <= 31) return 'within_month';
  return 'life_start';
}

export interface Section {
  key: SectionKey;
  tasks: GeneratedTask[];
}

/** タスク配列をセクションへ分配し、表示順(SECTION_ORDER)で空でないセクションのみ返す。 */
export function groupIntoSections(tasks: GeneratedTask[], moveDate: string): Section[] {
  const buckets = new Map<SectionKey, GeneratedTask[]>();
  for (const key of SECTION_ORDER) buckets.set(key, []);
  for (const task of tasks) {
    buckets.get(assignSection(task, moveDate))!.push(task);
  }
  return SECTION_ORDER.map((key) => ({ key, tasks: buckets.get(key)! })).filter(
    (s) => s.tasks.length > 0,
  );
}
