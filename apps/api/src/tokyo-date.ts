/**
 * 時刻を Asia/Tokyo の暦日(YYYY-MM-DD)へ変換する純関数。
 *
 * なぜ `toISOString().slice(0, 10)` ではだめか: それは UTC の日付で、日本時間の 0:00〜8:59 は
 * 前日になる。利用者に見せる日付(巡回の検知日)も、日次で区切る集計(チャットの1日上限)も
 * 利用者の暦(日本時間)で数えるべきなので、タイムゾーンを明示して変換する(CLAUDE.md §7)。
 * 'en-CA' を使うのは、この locale の既定書式がちょうど YYYY-MM-DD だから。
 */
const TOKYO_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function tokyoDate(at: Date): string {
  return TOKYO_DATE.format(at);
}
