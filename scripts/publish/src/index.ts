// @tmn/publish — approved-only publish pipeline: load + validate + gate + seed SQL (T-006).

export { DEFAULT_PUBLISH_CODES, loadPublishData } from './load.js';
export type { PublishData, WasteDataset } from './load.js';
export { assertPublishGate, findGateViolations, PublishGateError } from './gate.js';
export type { PublishGateInput, SourceRef, GateViolation } from './gate.js';
export { buildSeedStatements } from './sql.js';
export { buildSeed } from './seed.js';
export type { Seed } from './seed.js';
export { MUNICIPALITIES } from './municipalities.js';
export {
  KNOWN_SNAPSHOT_HASH_MISMATCHES,
  PathContainmentError,
  SnapshotIntegrityError,
  assertRealpathInside,
  findCurrentSnapshot,
  isInside,
  readVerifiedSnapshot,
  resolveInside,
  sha256Hex as snapshotSha256Hex,
  snapshotDir,
  snapshotFileName,
  sourcesRoot,
  verifySnapshotBytes,
  versionedSnapshotPath,
} from './snapshot-files.js';
export type { KnownHashMismatch, SnapshotSourceRef } from './snapshot-files.js';
export {
  CliArgError,
  RAG_CHUNK_ID,
  VECTORIZE_INDEX_NAME,
  WRANGLER_ENV_NAME,
  assertCliValue,
  flagValue,
} from './cli-args.js';
