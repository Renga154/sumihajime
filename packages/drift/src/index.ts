// @tmn/drift — 公式ソースの差分検知(ADR-014)。publish(Node)と Worker(cron)で共有する純関数。

export { extractPageUpdatedOn } from './page-updated-on.js';
// 公式ホストの許可リストは @tmn/domain が唯一の定義(web の回答リンク化の判定と共有するため
// 移設した)。巡回・ingest・ルールテストの既存の import 先を変えずに済むよう、ここから再エクスポートする。
export {
  ALLOWED_HOST_EXACT,
  ALLOWED_HOST_SUFFIXES,
  isOfficialHost,
  isOfficialUrl,
} from '@tmn/domain';
export { classifyCheck } from './classify.js';
export type { DriftCheckInput, DriftFetchResult, DriftStatus, DriftVerdict } from './classify.js';
export { sha256HexWeb } from './hash.js';
export { pickCurrentSnapshot } from './snapshot.js';
