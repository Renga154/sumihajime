import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeed } from './seed.js';

/**
 * なぜ: ローカルD1へ承認済みデータを投入する publish CLI(T-006)。
 *   1. load → 公開ゲート(承認済みのみ)→ シードSQL生成
 *   2. migrations 適用(--local)
 *   3. シードSQLを --local で流し込み
 * ゲートに通らなければ 2 以降には進まない(非承認ソース混入時はここで異常終了)。
 *
 * 使い方:
 *   pnpm --filter @tmn/publish publish:local            # migrations適用 + シード投入
 *   pnpm --filter @tmn/publish publish:local -- --dry-run   # SQL生成とゲートのみ(wrangler不実行)
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const apiDir = resolve(repoRoot, 'apps/api');
const wranglerBin = resolve(apiDir, 'node_modules/.bin/wrangler');
const DB_NAME = 'tokyo-move-navi';

function main(): void {
  const dryRun = process.argv.includes('--dry-run');

  const { data, statements } = buildSeed(repoRoot);

  const counts = {
    municipalities: data.municipalities.length,
    coverage: data.coverage.length,
    approvedSources: data.approvedSources.length,
    procedures: data.procedures.length,
    ruleSets: data.ruleSets.length,
    rules: data.ruleSets.reduce((n, rs) => n + rs.rules.length, 0),
    facilities: data.facilities.length,
    wasteAreas: data.wasteAreas.length,
    wasteSchedules: data.wasteSchedules.length,
    statements: statements.length,
  };
  console.log('[publish] gate passed (all published sourceIds are approved).');
  console.log('[publish] seed counts:', JSON.stringify(counts, null, 2));

  const seedDir = resolve(apiDir, '.wrangler');
  mkdirSync(seedDir, { recursive: true });
  const seedFile = resolve(seedDir, 'seed.local.sql');
  writeFileSync(seedFile, statements.map((s) => `${s};`).join('\n') + '\n', 'utf-8');
  console.log(`[publish] wrote seed SQL: ${seedFile}`);

  if (dryRun) {
    console.log('[publish] --dry-run: skipped wrangler (no D1 writes).');
    return;
  }

  console.log('[publish] applying migrations (--local)…');
  execFileSync(wranglerBin, ['d1', 'migrations', 'apply', DB_NAME, '--local'], {
    cwd: apiDir,
    stdio: 'inherit',
  });

  console.log('[publish] seeding local D1 (--local)…');
  execFileSync(wranglerBin, ['d1', 'execute', DB_NAME, '--local', '--file', seedFile], {
    cwd: apiDir,
    stdio: 'inherit',
  });

  console.log('[publish] done.');
}

main();
