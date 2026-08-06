import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBuffer } from './encoding.js';
import { parseWasteSortingCsv } from './waste-sorting.js';

/**
 * なぜ: Wave1-B。承認済みスナップショット(data/sources/<code>/snapshots/…csv)を
 * data/normalized/<code>/waste-sorting.json へ正規化する一度きりのビルドスクリプト
 * (procedures.json/facilities.json 等、他の正規化済み成果物と同じ「静的JSONとして
 * リポジトリにコミットする」流儀を踏襲。実行時に毎回CSVを読み直すことはしない)。
 *
 * 使い方: pnpm --filter @tmn/ingest build-waste-sorting
 *
 * 対象は「waste_sorting のスナップショットを持つ自治体」のみ。Step4-Bで千代田(13101)を追加。
 * 千代田は収集曜日がPDFのみ(waste.jsonは作らない=誠実縮退)だが、ごみ分別辞書CSVは
 * 自治体標準オープンデータ(CC BY 4.0)として実在するため正規化対象に含める。ただし出典CSVは
 * まだ pending(人手レビュー未了)であり、公開ゲート(ADR-007 / gate.ts)が未承認ソース参照を
 * 弾くため、正規化しても承認までは公開(D1シード)されない(CLAUDE.md原則9: 未対応を対応済みに
 * 見せない、は registry の review_status と publish ゲートで担保)。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

interface Target {
  municipalityCode: string;
  snapshotFile: string;
  sourceId: string;
  /** 世田谷CSVは「品目」「分別区分」列の中身が入れ替わっている(waste-sorting.ts参照)。 */
  itemCategorySwapped?: boolean;
  /** 杉並CSVは「注意点」列に実データを持つため notes に統合する(waste-sorting.ts参照)。 */
  mergeCautionIntoNotes?: boolean;
  /** 板橋CSVは「料金種別」を持たず「粗大ごみ回収料金」(円)を持つため feeNote をそこから作る。 */
  bulkyFeeAmountAsFeeNote?: boolean;
}

const TARGETS: Target[] = [
  {
    municipalityCode: '13112',
    snapshotFile: 'data/sources/13112/snapshots/src-13112-waste_sorting-001.csv',
    sourceId: 'src-13112-waste_sorting-001',
    itemCategorySwapped: true,
  },
  {
    municipalityCode: '13108',
    snapshotFile: 'data/sources/13108/snapshots/src-13108-waste_sorting-001.csv',
    sourceId: 'src-13108-waste_sorting-001',
  },
  {
    municipalityCode: '13104',
    snapshotFile: 'data/sources/13104/snapshots/src-13104-waste_sorting-001.csv',
    sourceId: 'src-13104-waste_sorting-001',
  },
  {
    // Step4-A 杉並区。杉並CSVは「注意点」列に実データを持つため notes に統合する
    // (mergeCautionIntoNotes)。収集曜日は第三者SaaS依存で機械取得不可のため waste.json は作らない。
    municipalityCode: '13115',
    snapshotFile: 'data/sources/13115/snapshots/src-13115-waste_sorting-001.csv',
    sourceId: 'src-13115-waste_sorting-001',
    mergeCautionIntoNotes: true,
  },
  {
    // なぜ: Step4-B。千代田区(13101)ごみ分別辞書(東京都オープンデータ・自治体標準準拠。
    // 品目=「ゴミの品目」/分別区分=「分別区分」で江東・新宿と同じ並び=itemCategorySwapped不要)。
    municipalityCode: '13101',
    snapshotFile: 'data/sources/13101/snapshots/src-13101-waste_sorting-001.csv',
    sourceId: 'src-13101-waste_sorting-001',
  },
  {
    // なぜ: Step5-A 品川区(13109)ごみ分別辞書(東京都オープンデータ・自治体標準準拠、
    // last-modified 2026-01-15=現行年度で鮮度良好)。品目=「ゴミの品目」/分別区分=「分別区分」で
    // 江東・新宿・千代田と同じ並び=itemCategorySwapped不要。品川CSVは「注意点」列に実データを持つ
    // (例:『汚れの落とせないもの、紙製のものは燃やすごみにお出しください。』)ため杉並と同様に
    // mergeCautionIntoNotes で notes へ統合する。なお収集曜日CSV(gomisyusyubi.csv)は
    // HTTP Last-Modified が2017-03-15で9年更新なしのため正規化せず(waste.json不在=誠実縮退)。
    municipalityCode: '13109',
    snapshotFile: 'data/sources/13109/snapshots/src-13109-waste_sorting-001.csv',
    sourceId: 'src-13109-waste_sorting-001',
    mergeCautionIntoNotes: true,
  },
  {
    // なぜ: Batch6-A 板橋区(13119)ごみ分別辞書(東京都オープンデータ・自治体標準準拠、
    // HTTP Last-Modified 2026-01-15=現行年度で鮮度良好)。CP932配信のため UTF-8 BOM へ変換して
    // スナップショット保存済み。板橋CSVは他区と列構成が異なり「料金種別」を持たず
    // 「粗大ごみ回収料金」(円、473品目に実値)を持つため bulkyFeeAmountAsFeeNote で feeNote を作る。
    // 「注意点」列は全1,125行が空欄のため mergeCautionIntoNotes は不要(notes は「備考」列のみ)。
    // 収集曜日は板橋区に機械判読可能なCSVが無いため waste.json は作らない(誠実縮退)。
    municipalityCode: '13119',
    snapshotFile: 'data/sources/13119/snapshots/src-13119-waste_sorting-001.csv',
    sourceId: 'src-13119-waste_sorting-001',
    bulkyFeeAmountAsFeeNote: true,
  },
  {
    // なぜ: Batch7 荒川区(13118)ごみの分別方法一覧(東京都オープンデータ・自治体標準準拠、
    // 区公式ドメイン配信 www.city.arakawa.tokyo.jp、HTTP Last-Modified 2026-03-22 で鮮度良好)。
    // 品目=「ゴミの品目」/分別区分=「分別区分」で江東・新宿・千代田と同じ並び=itemCategorySwapped不要。
    // 荒川CSVは「注意点」列に実データを持つ(例:『最大辺が30cmを超えるものは粗大ごみです。』)ため
    // 杉並・品川と同様に mergeCautionIntoNotes で notes へ統合する。
    // なお本ファイルは **Shift-JIS**(同じ荒川区でも公共施設一覧CSVはUTF-8 BOM)であり、区単位ではなく
    // ファイル単位で文字コードを判定する必要がある(下の decodeBuffer による自動判定で対応)。
    municipalityCode: '13118',
    snapshotFile: 'data/sources/13118/snapshots/src-13118-waste_sorting-001.csv',
    sourceId: 'src-13118-waste_sorting-001',
    mergeCautionIntoNotes: true,
  },
  {
    // なぜ: Batch8 墨田区(13107)ゴミの分別方法一覧(自治体標準オープンデータセット準拠、UTF-8 BOM、476品目)。
    // 全列に「ゴミの分別方法_」接頭辞が付く形式(世田谷と同型)だが、品目=「品目」/分別区分=「分別区分」の
    // 並びは自治体標準の意図通りなので itemCategorySwapped は不要。「注意点」列に実データを持つため
    // mergeCautionIntoNotes で notes へ統合する。ID列(131075S00001形式)は全行に実値があり、itemId を
    // 捏造せずに正規化できる。
    // 本バッチの他4区が waste-sorting.json を持たない理由(誠実縮退): 中央区はCSVのID列が388行中381行で空欄、
    // 文京区・港区のCSVは自治体標準の列構成(ID/品目/分別区分/備考)ではなく既存パーサで読めない、
    // 台東区は東京都カタログ登録のCSV2件がいずれもHTTP 404。いずれも itemId を捏造しないため採用しない。
    // 配信元は区公式ドメインではなく東京都提供の共有ホスト(opendata.metro.tokyo.lg.jp)。
    municipalityCode: '13107',
    snapshotFile: 'data/sources/13107/snapshots/src-13107-waste_sorting-001.csv',
    sourceId: 'src-13107-waste_sorting-001',
    mergeCautionIntoNotes: true,
  },
];

function main(): void {
  for (const target of TARGETS) {
    // なぜ: 出典CSVの文字コードは自治体ごとではなく **ファイルごと** に異なる(荒川区は
    // ごみ分別=Shift-JIS / 公共施設=UTF-8 BOM)。utf-8 決め打ちで読むと Shift-JIS が
    // 文字化けし、品目名・分別区分が壊れたまま正規化されるため、生バイトから自動判定する。
    // 既存の UTF-8(BOM有無問わず)ソースは decodeBuffer でも同一のテキストになる=出力不変。
    const csvText = decodeBuffer(
      new Uint8Array(readFileSync(resolve(repoRoot, target.snapshotFile))),
    ).text;
    const items = parseWasteSortingCsv(csvText, {
      municipalityCode: target.municipalityCode,
      sourceId: target.sourceId,
      itemCategorySwapped: target.itemCategorySwapped,
      mergeCautionIntoNotes: target.mergeCautionIntoNotes,
      bulkyFeeAmountAsFeeNote: target.bulkyFeeAmountAsFeeNote,
    });

    const outDir = resolve(repoRoot, `data/normalized/${target.municipalityCode}`);
    mkdirSync(outDir, { recursive: true });
    const outFile = resolve(outDir, 'waste-sorting.json');
    const payload = {
      municipalityCode: target.municipalityCode,
      sourceId: target.sourceId,
      items,
    };
    writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
    console.log(
      `[build-waste-sorting] ${target.municipalityCode}: ${items.length} items -> ${outFile}`,
    );
  }
}

main();
