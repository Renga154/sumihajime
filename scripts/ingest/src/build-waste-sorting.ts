import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
];

function main(): void {
  for (const target of TARGETS) {
    const csvText = readFileSync(resolve(repoRoot, target.snapshotFile), 'utf-8');
    const items = parseWasteSortingCsv(csvText, {
      municipalityCode: target.municipalityCode,
      sourceId: target.sourceId,
      itemCategorySwapped: target.itemCategorySwapped,
      mergeCautionIntoNotes: target.mergeCautionIntoNotes,
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
