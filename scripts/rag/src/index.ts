// @tmn/rag-index — RAG index builder (T-013). Pure manifest/SQL/NDJSON helpers are exported for
// reuse and testing; build.ts is the CLI entrypoint.

export {
  RAG_MUNICIPALITIES,
  loadApprovedHtmlSources,
  buildChunkManifest,
  buildRagChunksSql,
  toVectorLine,
} from './manifest.js';
export type { ApprovedHtmlSource, ChunkManifest } from './manifest.js';
