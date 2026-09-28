import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUNICIPALITIES, loadPublishData } from '@tmn/publish';
import { readRegistryTable, validateRegistryRows } from './registry.js';
import { runValidations } from './validate-core.js';
import { tokyoToday } from './dates.js';

/**
 * オフライン検証CLI(T-012。CIで実行。ネットワーク不要)。
 *
 * 使い方:
 *   pnpm --filter @tmn/ingest validate
 *
 * 検証内容(いずれか違反があれば exit 1):
 *   1. registry.csv 全行が @tmn/schemas の sourceSchema を満たす
 *   2. 公開物(procedures/rules/facilities/waste)の参照 sourceId が実在 かつ approved
 *      (scripts/publish の gate.ts を再利用)
 *   3. last_verified_at(最終確認日)の欠落チェック
 *   4. 有効期限: effective_to < today を列挙して非0終了 / 30日以内は警告
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

// なぜ全supported自治体を明示するのか: loadPublishData は既定値を持たない(引数必須)。
// ここで省略すると意図せず一部の自治体だけを検証してしまい、「全公開データを検証する」という
// このCLIの見出しコメントと実際の挙動が食い違う(過去に世田谷1区のみへ静かに縮退していた不具合)。
const SUPPORTED_MUNICIPALITY_CODES = MUNICIPALITIES.filter((m) => m.supported).map((m) => m.code);

function main(): void {
  const table = readRegistryTable(repoRoot);
  const rows = validateRegistryRows(table);

  // 公開データを読み込み参照とapproved集合を得る。schema/整合の致命エラーは捕捉して報告。
  let references: ReturnType<typeof loadPublishData>['references'] = [];
  let approvedSourceIds = new Set<string>();
  let publishLoadError: string | undefined;
  try {
    const pub = loadPublishData(repoRoot, SUPPORTED_MUNICIPALITY_CODES);
    references = pub.references;
    approvedSourceIds = pub.approvedSourceIds;
  } catch (err) {
    publishLoadError = err instanceof Error ? err.message : String(err);
  }

  const today = tokyoToday();
  const result = runValidations({ rows, references, approvedSourceIds, publishLoadError, today });

  console.log('[validate] offline registry & published-data validation');
  console.log(`[validate] today (Asia/Tokyo) = ${today}`);
  console.log('[validate] stats:', JSON.stringify(result.stats));

  if (result.warnings.length > 0) {
    console.log(`\n[validate] warnings (${result.warnings.length}):`);
    for (const w of result.warnings) console.log(`  ! ${w}`);
  }

  if (result.errors.length > 0) {
    console.error(`\n[validate] errors (${result.errors.length}):`);
    for (const e of result.errors) console.error(`  ✗ ${e}`);
    console.error('\n[validate] FAILED.');
    process.exit(1);
  }

  console.log('\n[validate] OK — all checks passed.');
}

main();
