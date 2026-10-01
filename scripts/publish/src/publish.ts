import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeed } from './seed.js';
import { MUNICIPALITIES } from './municipalities.js';
import { WRANGLER_ENV_NAME, assertCliValue, flagValue } from './cli-args.js';

/**
 * なぜ: D1へ承認済みデータを投入する publish CLI(T-006/T-011)。
 *   1. load → 公開ゲート(承認済みのみ)→ シードSQL生成
 *   2. migrations 適用
 *   3. シードSQLを流し込み
 * ゲートに通らなければ 2 以降には進まない(非承認ソース混入時はここで異常終了)。
 *
 * 使い方:
 *   pnpm --filter @tmn/publish publish:local             # ローカルD1(--local)へ
 *   pnpm --filter @tmn/publish publish:local -- --remote # 本番D1(--remote)へ(T-011。Cloudflare認証必須)
 *   pnpm --filter @tmn/publish publish:local -- --dry-run    # SQL生成とゲートのみ(wrangler不実行)
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const apiDir = resolve(repoRoot, 'apps/api');
const wranglerBin = resolve(apiDir, 'node_modules/.bin/wrangler');
// なぜbinding名: wrangler env(--env odh のミラー等)では database_name が環境ごとに異なるが、
// binding名 "DB" は全環境で共通のため、環境非依存にD1を特定できる(ADR-008)。
const DB_NAME = 'DB';

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  const remote = process.argv.includes('--remote');
  const targetFlag = remote ? '--remote' : '--local';
  // --env <name> があれば wrangler へ渡す(ミラー環境への投入。既定は従来通り)。
  // なぜ検証するか: 以前は直後の値をそのまま渡しており、`--env --remote` のように次のフラグを
  // 環境名として wrangler へ渡せた(オプション注入)。値の欠落・「-」始まり・形の違いは拒否する。
  const envName = flagValue(process.argv, '--env');
  const envArgs: string[] =
    envName !== undefined ? ['--env', assertCliValue('--env', envName, WRANGLER_ENV_NAME)] : [];

  // なぜ: CLIは supported な全自治体を公開対象にする。承認ゲート(buildSeed内)が
  // 未承認ソース(江東=pending/candidate 等)を参照する自治体を拒否し、publishを止める。
  // これが「未レビューデータをD1へ載せない」構造的関門の実運用挙動(T-015)。
  const supportedCodes = MUNICIPALITIES.filter((m) => m.supported).map((m) => m.code);
  console.log(`[publish] target supported municipalities: ${supportedCodes.join(', ')}`);
  const { data, statements } = buildSeed(repoRoot, supportedCodes);

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
    wasteSortingItems: data.wasteSortingItems.length,
    statements: statements.length,
  };
  console.log('[publish] gate passed (all published sourceIds are approved).');
  // ADR-007: 公開単位=verified手続きのみ。partial/stale(staging)は seed から除外した。
  // 除外はゲート違反ではなく「人手レビュー未了データを公開しない」正常動作(件数を明示)。
  console.log(
    `[publish] excluded ${data.excludedProcedures.length} non-verified procedure(s) and ` +
      `${data.excludedRuleRefs.length} associated rule(s) from publish (ADR-007 staging; not seeded).`,
  );
  for (const p of data.excludedProcedures) {
    console.log(`[publish]   - staged (dataStatus=${p.dataStatus}): ${p.municipalityCode}/${p.id}`);
  }
  // ADR-007 第4項: ソース未approvedのため除外した非手続きデータ(施設・ごみ・分別辞書)。
  if (data.excludedNonProcedureSources.length > 0) {
    console.log(
      `[publish] excluded ${data.excludedNonProcedureSources.length} non-procedure source(s) ` +
        `(facilities/waste; source not approved) from publish (ADR-007 staging; not seeded).`,
    );
    for (const s of data.excludedNonProcedureSources) {
      console.log(
        `[publish]   - staged (source not approved): ${s.municipalityCode}/${s.sourceId}`,
      );
    }
  }
  console.log('[publish] seed counts:', JSON.stringify(counts, null, 2));

  const seedDir = resolve(apiDir, '.wrangler');
  mkdirSync(seedDir, { recursive: true });
  const seedFile = resolve(seedDir, remote ? 'seed.remote.sql' : 'seed.local.sql');
  writeFileSync(seedFile, statements.map((s) => `${s};`).join('\n') + '\n', 'utf-8');
  console.log(`[publish] wrote seed SQL: ${seedFile}`);

  if (dryRun) {
    console.log('[publish] --dry-run: skipped wrangler (no D1 writes).');
    return;
  }

  console.log(`[publish] applying migrations (${targetFlag})…`);
  execFileSync(wranglerBin, ['d1', 'migrations', 'apply', DB_NAME, targetFlag, ...envArgs], {
    cwd: apiDir,
    stdio: 'inherit',
  });

  console.log(`[publish] seeding D1 (${targetFlag})…`);
  execFileSync(
    wranglerBin,
    ['d1', 'execute', DB_NAME, targetFlag, '--file', seedFile, ...envArgs],
    {
      cwd: apiDir,
      stdio: 'inherit',
    },
  );

  console.log('[publish] done.');
}

main();
