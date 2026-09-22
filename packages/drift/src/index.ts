// @tmn/drift — 公式ソースの差分検知(ADR-014)。publish(Node)と Worker(cron)で共有する純関数。

export { extractPageUpdatedOn } from './page-updated-on.js';
export {
  ALLOWED_HOST_EXACT,
  ALLOWED_HOST_SUFFIXES,
  isOfficialHost,
  isOfficialUrl,
} from './official-host.js';
export { classifyCheck } from './classify.js';
export type {
  DriftCheckInput,
  DriftFetchResult,
  DriftStatus,
  DriftVerdict,
} from './classify.js';
export { sha256HexWeb } from './hash.js';
