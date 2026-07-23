import type { SourceLedgerEntry } from '@tmn/schemas';
import { daysBetween } from './format';

/**
 * なぜ: 来歴ダッシュボード(Wave3)の「鮮度サマリー」を決定論的に算出する純関数群。
 * CLAUDE.md §7「日付・期限計算はタイムゾーンを明示し、テストする」に従い、基準日は
 * Asia/Tokyo の暦日に固定する(サーバー/端末のTZに依存しない)。UIは算出結果を表示するだけで、
 * 判定ロジックは持たない(§4 UIとルールの分離)。
 */

/** Asia/Tokyo の「今日」を YYYY-MM-DD で返す(鮮度計算の基準日。JST固定)。 */
export function jstDateString(now: Date = new Date()): string {
  // en-CA ロケールは YYYY-MM-DD 形式で安定して返す。timeZone指定でJSTの暦日を得る。
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export type FreshnessBucket = 'within7' | 'within30' | 'older';

/**
 * 最終確認日からの経過日数 → バケツ(7日以内 / 30日以内 / それ以上)。
 * 負値(基準日より未来の確認日=データ不整合)は最も新しい within7 に寄せる(過大評価しない)。
 */
export function freshnessBucketOf(daysElapsed: number): FreshnessBucket {
  if (daysElapsed <= 7) return 'within7';
  if (daysElapsed <= 30) return 'within30';
  return 'older';
}

/** 年度データ(effectiveTo付き)の残日数カウントダウン1件。 */
export interface YearDataCountdown {
  sourceId: string;
  title: string;
  municipalityCode?: string;
  category: string;
  effectiveTo: string;
  /** 基準日(JST)から effectiveTo までの残日数。負値は失効済み。 */
  daysRemaining: number;
  expired: boolean;
}

export interface FreshnessSummary {
  total: number;
  within7: number;
  within30: number;
  older: number;
  /** lastVerifiedAt が無い/解釈不能なソース数(バケツ集計から除外した分)。 */
  unknown: number;
  /** 残日数の少ない順(=失効が近い順)に並べた年度データ。 */
  yearData: YearDataCountdown[];
}

/**
 * データソース台帳(公開ビュー)から鮮度サマリーを算出する。
 * - 経過日数分布は lastVerifiedAt を持つソースのみを対象に3バケツへ振り分ける。
 * - 年度データは effectiveTo を持つソースを残日数の少ない順に列挙する。
 */
export function summarizeFreshness(
  entries: readonly SourceLedgerEntry[],
  todayIso: string,
): FreshnessSummary {
  const today = todayIso.slice(0, 10);
  let within7 = 0;
  let within30 = 0;
  let older = 0;
  let unknown = 0;
  const yearData: YearDataCountdown[] = [];

  for (const e of entries) {
    if (e.lastVerifiedAt) {
      const elapsed = daysBetween(e.lastVerifiedAt, today);
      if (Number.isNaN(elapsed)) {
        unknown += 1;
      } else {
        const bucket = freshnessBucketOf(elapsed);
        if (bucket === 'within7') within7 += 1;
        else if (bucket === 'within30') within30 += 1;
        else older += 1;
      }
    } else {
      unknown += 1;
    }

    if (e.effectiveTo) {
      const remaining = daysBetween(today, e.effectiveTo);
      yearData.push({
        sourceId: e.sourceId,
        title: e.sourceTitle,
        municipalityCode: e.municipalityCode,
        category: e.category,
        effectiveTo: e.effectiveTo,
        daysRemaining: remaining,
        expired: remaining < 0,
      });
    }
  }

  yearData.sort(
    (a, b) => a.daysRemaining - b.daysRemaining || a.sourceId.localeCompare(b.sourceId),
  );

  return { total: entries.length, within7, within30, older, unknown, yearData };
}
