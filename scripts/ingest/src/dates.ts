/**
 * なぜ: 有効期限(effective_to)の判定は「今日」の基準タイムゾーンを固定しないと
 * 実行環境依存でブレる(CLAUDE.md §7「日付計算はタイムゾーンを明示」)。
 * 台帳の日付は日本のオープンデータなので Asia/Tokyo を基準とする。
 */

/** Asia/Tokyo の今日を YYYY-MM-DD で返す。 */
export function tokyoToday(now: Date = new Date()): string {
  // en-CA ロケールは YYYY-MM-DD 形式を返す。
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(now);
}

/** YYYY-MM-DD 文字列を UTC正午のエポックms へ(日数差計算用。DST無関係)。 */
function isoDateToUtcNoon(iso: string): number {
  return Date.parse(`${iso}T12:00:00Z`);
}

/**
 * to から from までの日数(to - from)。負なら to が過去。
 * どちらも YYYY-MM-DD。無効な日付は NaN。
 */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = isoDateToUtcNoon(fromIso);
  const b = isoDateToUtcNoon(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / 86_400_000);
}
