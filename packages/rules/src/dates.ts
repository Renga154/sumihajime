import type { DueRule, OffsetDaysDueRule } from '@tmn/schemas';

/**
 * なぜ: 計画ADR-002「日付計算はAsia/Tokyo固定の純関数ユーティリティに集約しテスト」。
 * moveDateは既にAsia/Tokyoの暦日を表すISO文字列("YYYY-MM-DD")であり、時刻・オフセットを
 * 一切含まない(packages/schemas profileSchemaの設計判断)。したがって期限計算は
 * 「暦日 + オフセット日数」という純粋なカレンダー演算であり、実行環境のローカル
 * タイムゾーンとは無関係でなければならない。
 *
 * 実装方針: 文字列を自前でY/M/Dに分解し、setUTCFullYear / getUTC*系のみを使う。
 * これらはprocess.env.TZ(実行環境のローカルタイムゾーン)に一切
 * 依存しない(常にUTC)。これによりローカルタイムゾーンが東京と異なる環境で実行しても
 * 結果が変わらないことを構造的に保証する(テストでTZ切り替えにより証明する)。
 */

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 暦日(年・月・日)→ UTC のエポックミリ秒。
 *
 * なぜ Date.UTC を直接使わないか: Date.UTC は年が 0〜99 のとき 1900〜1999 年として解釈する
 * (ECMAScript の仕様)。0001-01-01 が 1901 年になり、下の往復チェックで「存在しない日付」として
 * 例外になっていた(API の 500。2026-10-02 監査)。setUTCFullYear は年をそのまま受け取る。
 */
function utcMsOf(year: number, monthIndex: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

/** なぜ: 不正な暦日文字列を早期に検出し、無効な日付が静かに繰り上がるのを防ぐ。 */
function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const match = ISO_DATE_PATTERN.exec(iso);
  if (!match) {
    throw new Error(`invalid calendar date string (expected YYYY-MM-DD): "${iso}"`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(utcMsOf(year, month - 1, day));
  // なぜ: 2月30日のような不正日付もロールオーバーして受理されてしまうため、
  // 往復チェックで構造的に弾く(暦日の整合性を保証する)。
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`invalid calendar date (out of range for its month): "${iso}"`);
  }
  return { year, month, day };
}

/**
 * なぜ範囲外で例外にするか: 9999-12-31 に加算すると5桁の年になり、"10000-01-14" のような
 * YYYY-MM-DD ではない文字列を期日として返していた。黙って壊れた値を返すより、計算できないことを
 * 呼び出し元に知らせる(API は受付範囲外の日付を入口で 422 にするため、通常ここへは来ない)。
 */
function toIsoDate(utcMs: number): string {
  const date = new Date(utcMs);
  const yearNumber = date.getUTCFullYear();
  if (!Number.isFinite(yearNumber) || yearNumber < 0 || yearNumber > 9999) {
    throw new RangeError('calendar date out of the 4-digit year range (0000-9999)');
  }
  const year = String(yearNumber).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * なぜ: 期限計算の中核。月末・年跨ぎ・うるう年をDateのロールオーバーに委ねることで
 * 自前の暦計算バグ(2月の日数分岐など)を避けつつ、UTC固定によりローカルTZ非依存を保つ。
 */
export function addCalendarDays(iso: string, days: number): string {
  const { year, month, day } = parseIsoDate(iso);
  return toIsoDate(utcMsOf(year, month - 1, day + days));
}

/** なぜ: 評価器(evaluate.ts)からDueRuleを解決するための唯一の窓口。純関数。 */
export interface ResolvedDue {
  dueDate?: string;
}

/**
 * 期限の起算日として使える、利用者から受け取った暦日。
 *
 * moveOutScheduledDate(前住所地の転出予定日)は任意入力のため undefined になり得る。
 * その場合は「算定しない」であって「moveDate で代用する」ではない — 区が転出予定日起算だと
 * 書いている期限を引越し日から作れば、それは公式が言っていない日付になる(CLAUDE.md原則3)。
 */
export interface DueOriginDates {
  readonly moveDate: string;
  readonly moveOutScheduledDate?: string;
}

/** 起算日が未入力なら undefined(=算定不能)を返す。ここが「推測しない」の実装点。 */
function resolveOffsetDays(rule: OffsetDaysDueRule, dates: DueOriginDates): string | undefined {
  const origin = rule.from === 'moveDate' ? dates.moveDate : dates.moveOutScheduledDate;
  if (origin === undefined) return undefined;
  return addCalendarDays(origin, rule.days);
}

export function resolveDueRule(dueRule: DueRule, dates: DueOriginDates): ResolvedDue {
  if (dueRule.type === 'offsetDays') {
    const dueDate = resolveOffsetDays(dueRule, dates);
    return dueDate === undefined ? {} : { dueDate };
  }
  if (dueRule.type === 'earliestOf') {
    // 算定できた候補のうち最も早い日。ISO日付(YYYY-MM-DD)は辞書順=時系列順なので文字列比較で足りる。
    const candidates = dueRule.of
      .map((r) => resolveOffsetDays(r, dates))
      .filter((d): d is string => d !== undefined);
    if (candidates.length === 0) return {};
    return { dueDate: candidates.reduce((a, b) => (a <= b ? a : b)) };
  }
  // type === 'unknown': 算定不能。呼び出し元(evaluate.ts)がdueDescriptionへフォールバックする。
  return {};
}
