import { DEFAULT_PUBLISH_CODES, loadPublishData, type PublishData } from './load.js';
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

/**
 * @param municipalityCodes 省略時は最小フィクスチャ(DEFAULT_PUBLISH_CODES=世田谷のみ)。
 *   これは軽量な統合テスト用の意図した既定値であり、loadPublishData自体には既定値を
 *   持たせていない(全自治体検証がここへ静かに縮退しないため。scripts/publish/src/load.ts参照)。
 */
export function buildSeed(
  repoRoot: string,
  municipalityCodes: readonly string[] = DEFAULT_PUBLISH_CODES,
): Seed {
  const data = loadPublishData(repoRoot, municipalityCodes);
  assertPublishGate({
    approvedSourceIds: data.approvedSourceIds,
    references: data.references,
  });
  return { data, statements: buildSeedStatements(data) };
}
