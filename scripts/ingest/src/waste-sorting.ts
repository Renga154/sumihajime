import { wasteSortingItemSchema, type WasteSortingItem } from '@tmn/schemas';
import { parseCsv } from './registry.js';

/**
 * なぜ: Wave1-B。世田谷(13112)/江東(13108)/新宿(13104)の「ごみ分別方法」CSV
 * (自治体標準オープンデータセット準拠)を WasteSortingItem[] へ正規化する。
 *
 * 列見出しの表記ゆれ(実データ確認済み):
 *  - 世田谷: 全列に "ごみの分別方法_" 接頭辞が付く(例 "ごみの分別方法_品目")。
 *  - 江東/新宿: 接頭辞なし。加えて "地方公共団体名" 列を持つ(世田谷は持たない)。
 * → 接頭辞を取り除いた列名の末尾一致で列を特定し、3区とも同じロジックで扱う。
 *
 * 値の採否(CLAUDE.md原則3: 推測禁止・CSVの記載内容のみ):
 *  - 「料金」「料金備考」「注意点」列は3区とも全行空欄(実データ確認済み)のため未使用。
 *  - feeNote は「料金種別」(無料/有料。世田谷のみ値あり)をそのまま採用。
 *  - notes は「備考」(唯一実データを持つ自由記述列。危険表示等の注意書きを含む)を採用。
 *  - reading(よみ)は出典CSVに列がないため常に省略(将来別自治体で列があれば拡張)。
 *
 * 既知のデータ品質問題(世田谷のみ、実データ確認済み):
 *  世田谷のCSVは「品目」列と「分別区分」列の中身が入れ替わっている
 *  (「品目」列に "不燃ごみ"等17種類の値=実質カテゴリ、「分別区分」列に787件の一意な
 *  値=実質品目名が入る。江東/新宿は逆で、こちらが自治体標準の意図通りの並び)。
 *  ヘッダ文字列をそのまま信用すると品目名とカテゴリが逆転した誤情報を公開してしまうため、
 *  opts.itemCategorySwapped=true 指定時のみ2列の割当てを入れ替える(値を書き換えたり
 *  補完したりはしない。CSVが実際に持つ2列の値をどちらのフィールドに対応させるかの
 *  マッピングを自治体ごとに固定するだけ)。
 */

function normalizeHeader(h: string): string {
  const idx = h.lastIndexOf('_');
  return idx === -1 ? h : h.slice(idx + 1);
}

export interface WasteSortingCsvOptions {
  municipalityCode: string;
  sourceId: string;
  /**
   * true の場合、CSVの「品目」列と「分別区分」列の値を入れ替えてマッピングする
   * (世田谷のCSVが2列の中身を入れ替えて出力しているため。上部コメント参照)。既定false。
   */
  itemCategorySwapped?: boolean;
}

function findCol(header: string[], matcher: (h: string) => boolean, label: string): number {
  const idx = header.findIndex(matcher);
  if (idx === -1) {
    throw new Error(`waste-sorting CSV: missing expected column "${label}".`);
  }
  return idx;
}

/** ごみ分別辞書CSV(世田谷/江東/新宿共通フォーマット)→ WasteSortingItem[]。 */
export function parseWasteSortingCsv(
  csvText: string,
  opts: WasteSortingCsvOptions,
): WasteSortingItem[] {
  const rows = parseCsv(csvText).filter((r) => r.some((c) => c.trim().length > 0));
  const [header, ...dataRows] = rows;
  if (!header) return [];

  const idCol = findCol(header, (h) => normalizeHeader(h) === 'ID', 'ID');
  const itemCol = findCol(header, (h) => h.includes('品目'), '品目');
  const categoryCol = findCol(header, (h) => normalizeHeader(h) === '分別区分', '分別区分');
  const feeTypeCol = findCol(header, (h) => normalizeHeader(h) === '料金種別', '料金種別');
  const remarksCol = findCol(header, (h) => normalizeHeader(h) === '備考', '備考');

  return dataRows.map((row, i) => {
    if (row.length !== header.length) {
      throw new Error(
        `waste-sorting CSV (${opts.sourceId}): row ${i + 2} has ${row.length} columns but ` +
          `header has ${header.length}. Refusing to normalize a malformed source.`,
      );
    }
    const itemId = (row[idCol] ?? '').trim();
    const rawName = (row[itemCol] ?? '').trim();
    const rawCategory = (row[categoryCol] ?? '').trim();
    const name = opts.itemCategorySwapped ? rawCategory : rawName;
    const category = opts.itemCategorySwapped ? rawName : rawCategory;
    const feeType = (row[feeTypeCol] ?? '').trim();
    const remarks = (row[remarksCol] ?? '').trim();

    return wasteSortingItemSchema.parse({
      itemId,
      municipalityCode: opts.municipalityCode,
      name,
      category,
      ...(remarks.length > 0 ? { notes: remarks } : {}),
      ...(feeType.length > 0 ? { feeNote: feeType } : {}),
      sourceId: opts.sourceId,
    });
  });
}
