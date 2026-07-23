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
 * 対象は「waste_sorting のスナップショットを持つ3区」のみ(未対応自治体・候補中の
 * 千代田(13101)等は対象外。CLAUDE.md原則9: 未対応を対応済みに見せない)。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

interface Target {
  municipalityCode: string;
  snapshotFile: string;
  sourceId: string;
  /** 世田谷CSVは「品目」「分別区分」列の中身が入れ替わっている(waste-sorting.ts参照)。 */
  itemCategorySwapped?: boolean;
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
];

function main(): void {
  for (const target of TARGETS) {
    const csvText = readFileSync(resolve(repoRoot, target.snapshotFile), 'utf-8');
    const items = parseWasteSortingCsv(csvText, {
      municipalityCode: target.municipalityCode,
      sourceId: target.sourceId,
      itemCategorySwapped: target.itemCategorySwapped,
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
