/**
 * なぜ: 有効期限(effective_to)の判定は「今日」の基準タイムゾーンを固定しないと
 * 実行環境依存でブレる(CLAUDE.md §7「日付計算はタイムゾーンを明示」)。
 * 台帳の日付は日本のオープンデータなので Asia/Tokyo を基準とする。
 * 実体は @tmn/domain(web/api/ingest/eval共通の単一実装)。この再エクスポートは
 * 既存の import 元(./dates.js)を変えずに済ませるための後方互換シム。
 */

export { tokyoToday, daysBetween } from '@tmn/domain';
