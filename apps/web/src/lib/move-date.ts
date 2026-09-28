import { daysBetween, tokyoToday } from '@tmn/domain';

/**
 * 引越し日の妥当範囲と「期限を過ぎている可能性」の判定。
 *
 * なぜ純関数か: 期限まわりの判定はテストで境界を固定したい(CLAUDE.md §7/§8)。
 * なぜ Asia/Tokyo 固定か: 対象は東京都内の手続きで、期限は日本時間の暦日で決まる。
 * 端末のタイムゾーン設定に判定が左右されないよう、基準日を明示的に日本時間で求める。
 *
 * 断定しない方針: 過去日の期限は「過ぎている可能性があります」までにとどめる。
 * 実際に届出済みか、個別の事情で扱いが変わるかは本サービスでは分からない(原則3)。
 */

/** 引越し日として受け付ける前後の年数。転入直後の利用者と、先の予定の両方を通す幅。 */
export const MOVE_DATE_RANGE_YEARS = 1;

/**
 * 日本時間の「今日」を YYYY-MM-DD で返す。
 * 実体は @tmn/domain の tokyoToday(web/api/ingest/eval共通の単一実装)。
 */
export function todayInTokyo(now: Date = new Date()): string {
  return tokyoToday(now);
}

/** YYYY-MM-DD を years 年ずらす。うるう日(2/29)は JS の Date 準拠で 3/1 に送られる。 */
function shiftYears(iso: string, years: number): string {
  const ms = Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** `input[type=date]` の min/max に入れる受付範囲。 */
export function moveDateBounds(today: string): { min: string; max: string } {
  return {
    min: shiftYears(today, -MOVE_DATE_RANGE_YEARS),
    max: shiftYears(today, MOVE_DATE_RANGE_YEARS),
  };
}

/** 引越し日が受付範囲内か(空文字・不正な日付は false)。 */
export function isMoveDateWithinRange(value: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  // 2026-02-30 のような存在しない日付は繰り上がって解釈されるため、往復で弾く。
  if (parsed.toISOString().slice(0, 10) !== value) return false;
  const { min, max } = moveDateBounds(today);
  return value >= min && value <= max;
}

/** 範囲外のときに出す説明文(範囲を具体的に示し、次の行動が分かるようにする)。 */
export function moveDateRangeMessage(today: string): string {
  const { min, max } = moveDateBounds(today);
  return `引越し日は ${min} 〜 ${max} の範囲で入力してください。`;
}

/**
 * 前住所地の転出予定日が範囲外のときの説明文。
 * 受付範囲は引越し日と同じ幅にする(転出予定日は引越し日の前後どちらにもなり得るため)。
 */
export function moveOutScheduledDateRangeMessage(today: string): string {
  const { min, max } = moveDateBounds(today);
  return `前住所地の転出予定日は ${min} 〜 ${max} の範囲で入力してください。`;
}

/** 期限が基準日より前か(= 過ぎている可能性がある)。期限なし・不正値は false。 */
export function isOverdue(dueDate: string | undefined, today: string): boolean {
  if (!dueDate) return false;
  const diff = daysBetween(today, dueDate);
  return Number.isFinite(diff) && diff < 0;
}

/** 期限を何日過ぎているか(過ぎていなければ 0)。 */
export function overdueDays(dueDate: string | undefined, today: string): number {
  if (!dueDate) return 0;
  const diff = daysBetween(today, dueDate);
  return Number.isFinite(diff) && diff < 0 ? -diff : 0;
}
