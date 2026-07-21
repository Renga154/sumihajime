import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { buildSeed } from '@tmn/publish';

/**
 * なぜ: API+D1 の統合テスト用ハーネス。@cloudflare/vitest-pool-workers は本リポジトリの
 * 非ASCIIパス(開発/東京都ハッカソン)を module-fallback service が扱えず起動不能なため、
 * Miniflare を直接使い「本物のD1(SQLite)」バインディングを Node 側へ取り出す。
 * Hono の app.request(path, init, { DB }) にこの DB を渡すことで、実際の Worker コード・
 * 実SQL・migrations・**承認ゲートを通したシード** を通しで検証する(workerd内実行ではないが、
 * ルール評価・SQL・スキーマ検証という検証対象ロジックは同一)。
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '..');
const repoRoot = resolve(apiDir, '../..');

/** .sql を文単位に分割(本マイグレーションは文字列リテラル内に ; を含まない)。 */
function readMigrationQueries(dir: string): string[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const queries: string[] = [];
  for (const name of files) {
    const sql = readFileSync(resolve(dir, name), 'utf-8');
    for (const q of sql.split(';')) {
      const trimmed = q.trim();
      if (trimmed.length > 0 && !/^(--[^\n]*\n?)+$/.test(trimmed)) queries.push(trimmed);
    }
  }
  return queries;
}

export interface TestDb {
  db: D1Database;
  seedStatementCount: number;
  dispose: () => Promise<void>;
}

/**
 * @param municipalityCodes シード対象の自治体コード。省略時は buildSeed の既定
 *   (DEFAULT_PUBLISH_CODES = 世田谷13112 のみ)。複数指定すると複数自治体を同一D1へ載せ、
 *   越境混線の回帰テスト(世田谷13112 + 江東13108)に使える。
 */
export async function createTestDb(municipalityCodes?: readonly string[]): Promise<TestDb> {
  const mf = new Miniflare({
    modules: true,
    // D1ストレージ専用のダミーWorker(dispatchはしない。getD1Databaseのみ使う)。
    script: 'export default { fetch() { return new Response("unused"); } };',
    compatibilityDate: '2025-09-01',
    d1Databases: { DB: 'tokyo-move-navi-test' },
  });

  const db = (await mf.getD1Database('DB')) as unknown as D1Database;

  // 1) migrations(スキーマ作成)
  const migrationQueries = readMigrationQueries(resolve(apiDir, 'migrations'));
  for (const q of migrationQueries) {
    await db.prepare(q).run();
  }

  // 2) 承認ゲートを通したシード(load→gate→SQL)。ゲート未通過なら buildSeed が例外。
  const { statements } = buildSeed(repoRoot, municipalityCodes);
  await db.batch(statements.map((s) => db.prepare(s)));

  return {
    db,
    seedStatementCount: statements.length,
    dispose: () => mf.dispose(),
  };
}
