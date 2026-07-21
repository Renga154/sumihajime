import { loadPublishData, type PublishData } from './load.js';
import { assertPublishGate } from './gate.js';
import { buildSeedStatements } from './sql.js';

/**
 * なぜ: publish の中核オーケストレーション。load → **ゲート(承認済みのみ)** → SQL生成 の
 * 順序を1か所に固定し、CLI(publish.ts)と pool-workers 統合テスト(vitest.config)の双方が
 * 同じ経路でシード内容を得るようにする。ゲートを通らない限り絶対に文を返さない。
 */
export interface Seed {
  data: PublishData;
  statements: string[];
}

export function buildSeed(repoRoot: string): Seed {
  const data = loadPublishData(repoRoot);
  assertPublishGate({
    approvedSourceIds: data.approvedSourceIds,
    references: data.references,
  });
  return { data, statements: buildSeedStatements(data) };
}
