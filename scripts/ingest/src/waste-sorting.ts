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
  /**
   * true の場合、「料金種別」列の代わりに「粗大ごみ回収料金」列(円単位の整数)から feeNote を作る(既定false)。
   * なぜ: 板橋区(13119)のCSVは自治体標準オープンデータセットの別の列構成を採り、「料金種別」(無料/有料)を
   * 持たず「粗大ごみ回収料金」(例 "400")を持つ。列名が示す単位(円)はデータセット定義由来であり推測ではない
   * ため、値がある行のみ『粗大ごみ回収料金 400円』の形で feeNote に載せる(値がなければ feeNote を設定しない)。
   * 他区のCSVはこの列を持たないため、このオプションを有効にしても出力は不変(後方互換)。
   */
  bulkyFeeAmountAsFeeNote?: boolean;
  /**
   * true の場合、「注意点」列(あれば)を「備考」列とあわせて notes に統合する(既定false)。
   * なぜ: 世田谷/江東/新宿の3区は「注意点」列が全行空欄だったため未使用だったが、杉並区の
   * CSVは「注意点」列に実データ(例:『最大辺がおおむね30cmを超えるもの(220cm以内)は粗大ごみです』)
   * を持つ。schema(notes単一フィールド)を変えず、かつ公式が記載した注意情報を落とさないため、
   * 注意点と備考の両方を(いずれも値がある場合のみ)『／』で連結して notes に格納する。3区は
   * 「注意点」が空欄のため、このオプションを有効にしても出力は不変(後方互換)。
   */
  mergeCautionIntoNotes?: boolean;
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
  // なぜ: 「料金種別」列を持たない自治体標準CSV(板橋区13119)があるため、必須にせず -1 を許容する
  // (欠落を捏造で埋めない=CLAUDE.md原則3。代替として bulkyFeeAmountAsFeeNote を用いる)。
  const feeTypeCol = header.findIndex((h) => normalizeHeader(h) === '料金種別');
  const bulkyFeeCol = opts.bulkyFeeAmountAsFeeNote
    ? findCol(header, (h) => normalizeHeader(h) === '粗大ごみ回収料金', '粗大ごみ回収料金')
    : -1;
  const remarksCol = findCol(header, (h) => normalizeHeader(h) === '備考', '備考');
  // なぜ: 「注意点」列は3区では空欄だが杉並区では実データを持つ。mergeCautionIntoNotes 有効時のみ
  // 参照する(列が存在しなければ -1 のまま=統合対象なし)。
  const cautionCol = opts.mergeCautionIntoNotes
    ? header.findIndex((h) => normalizeHeader(h) === '注意点')
    : -1;

  const items: WasteSortingItem[] = [];
  const skipped: string[] = [];
  dataRows.forEach((row, i) => {
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
    const feeType = feeTypeCol >= 0 ? (row[feeTypeCol] ?? '').trim() : '';
    const bulkyFee = bulkyFeeCol >= 0 ? (row[bulkyFeeCol] ?? '').trim() : '';
    const feeNote =
      feeType.length > 0 ? feeType : bulkyFee.length > 0 ? `粗大ごみ回収料金 ${bulkyFee}円` : '';
    const remarks = (row[remarksCol] ?? '').trim();
    const caution = cautionCol >= 0 ? (row[cautionCol] ?? '').trim() : '';
    // 注意点・備考の両方(値があるものだけ)を『／』で連結。3区は注意点が空欄のため remarks のみ=不変。
    const notes = [caution, remarks].filter((s) => s.length > 0).join('／');

    // なぜ: 出典CSVに品目名または分別区分が空欄の行が混ざることがある(墨田区13107の
    // 131075S00210「洗剤の容器・プラスチック製」は分別区分・注意点・備考がすべて空欄)。
    // 空欄をどのカテゴリとみなすかは出典に書かれておらず、推測で埋めれば誤った分別を公開する
    // ことになる(CLAUDE.md原則3)。そのため該当行は正規化せず落とす(=辞書に載せない)。
    // 既存4区のCSVには空欄行が無いため、この分岐を追加しても出力は不変(後方互換)。
    if (name.length === 0 || category.length === 0) {
      skipped.push(itemId.length > 0 ? itemId : `row ${i + 2}`);
      return;
    }

    items.push(
      wasteSortingItemSchema.parse({
        itemId,
        municipalityCode: opts.municipalityCode,
        name,
        category,
        ...(notes.length > 0 ? { notes } : {}),
        ...(feeNote.length > 0 ? { feeNote } : {}),
        sourceId: opts.sourceId,
      }),
    );
  });
  if (skipped.length > 0) {
    console.warn(
      `[waste-sorting] ${opts.sourceId}: skipped ${skipped.length} row(s) with an empty ` +
        `item name or category (source data gap, not inferred): ${skipped.join(', ')}`,
    );
  }
  return items;
}
