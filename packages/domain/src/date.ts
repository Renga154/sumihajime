/**
 * 日本時間(Asia/Tokyo)基準の日付計算の単一の真実。
 *
 * なぜ共有パッケージに置くのか: 「今日の日付」「2日付間の日数差」は web(期限表示・来歴ダッシュボード)・
 * api・ingest(有効期限チェック)・eval(レポート日付)がそれぞれ独自に実装していた。
 * タイムゾーンの扱いを間違えると(実行環境のローカルTZに依存すると)日付境界での1日ズレが
 * 環境によって起きる(CLAUDE.md §7「日付・期限計算はタイムゾーンを明示し、テストする」)。
 * 実装を1か所にし、各パッケージはここへ委譲することでブレを構造的に防ぐ。
 */

/** Asia/Tokyo の「今日」を YYYY-MM-DD で返す。 */
export function tokyoToday(now: Date = new Date()): string {
  // en-CA ロケールは YYYY-MM-DD 形式で安定して返す。timeZone指定でJSTの暦日を得る。
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** YYYY-MM-DD 文字列を UTC正午のエポックmsへ(日数差計算用。DST無関係)。 */
function isoDateToUtcNoon(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
}

/**
 * to から from までの日数(to - from)。負なら to が過去。
 * どちらも YYYY-MM-DD。無効な日付は NaN。
 */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = isoDateToUtcNoon(fromIso);
  const to = isoDateToUtcNoon(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return NaN;
  return Math.round((to - from) / 86_400_000);
}
