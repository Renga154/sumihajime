import type { DueRule, OffsetDaysDueRule } from '@tmn/schemas';

/**
 * なぜ: 計画ADR-002「日付計算はAsia/Tokyo固定の純関数ユーティリティに集約しテスト」。
 * moveDateは既にAsia/Tokyoの暦日を表すISO文字列("YYYY-MM-DD")であり、時刻・オフセットを
 * 一切含まない(packages/schemas profileSchemaの設計判断)。したがって期限計算は
 * 「暦日 + オフセット日数」という純粋なカレンダー演算であり、実行環境のローカル
 * タイムゾーンとは無関係でなければならない。
 *
 * 実装方針: 文字列を自前でY/M/Dに分解し、Date.UTC / getUTC*系のみを使う。
 * Date.UTC・getUTCFullYear等はprocess.env.TZ(実行環境のローカルタイムゾーン)に一切
 * 依存しない(常にUTC)。これによりローカルタイムゾーンが東京と異なる環境で実行しても
 * 結果が変わらないことを構造的に保証する(テストでTZ切り替えにより証明する)。
 */

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** なぜ: 不正な暦日文字列を早期に検出し、無効な日付が静かに繰り上がるのを防ぐ。 */
function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const match = ISO_DATE_PATTERN.exec(iso);
  if (!match) {
    throw new Error(`invalid calendar date string (expected YYYY-MM-DD): "${iso}"`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, month - 1, day);
  const check = new Date(utcMs);
  // なぜ: Date.UTCは2月30日のような不正日付をロールオーバーして受理してしまうため、
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

function toIsoDate(utcMs: number): string {
  const date = new Date(utcMs);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * なぜ: 期限計算の中核。月末・年跨ぎ・うるう年をDate.UTCのロールオーバーに委ねることで
 * 自前の暦計算バグ(2月の日数分岐など)を避けつつ、UTC固定によりローカルTZ非依存を保つ。
 */
export function addCalendarDays(iso: string, days: number): string {
  const { year, month, day } = parseIsoDate(iso);
  const utcMs = Date.UTC(year, month - 1, day + days);
  return toIsoDate(utcMs);
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
