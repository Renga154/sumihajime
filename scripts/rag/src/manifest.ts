import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readRegistryTable, tableToRecords, extractTextLines } from '@tmn/ingest';
import {
  buildSourceChunks,
  type ChunkOptions,
  type RagChunk,
  type RagChunkMetadata,
} from '@tmn/rag';

/**
 * なぜ: RAG索引の「コーパス構築」部分(ネットワーク非依存の純ロジック)。承認済みかつ
 * source_type=html の 世田谷区(13112)ソースのスナップショットから本文抽出→チャンク化し、
 * メタデータ付きの RagChunk[] を作る(§5.4 実行時クロール禁止=スナップショットのみ使用)。
 * embeddings/Vectorize投入は build.ts が担う。
 */

/** 索引対象 = 人手レビュー承認済みの対応自治体(世田谷13112・江東13108・新宿13104)。 */
export const RAG_MUNICIPALITIES = ['13112', '13108', '13104'] as const;

function toDateTime(v: string): string {
  const s = (v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s;
}

export interface ApprovedHtmlSource {
  municipalityCode: string;
  sourceId: string;
  category: string;
  title: string;
  url: string;
  lastVerifiedAt: string;
}

/** registry.csv → 承認済み(approved)かつ html かつ対象自治体のソースのみ。 */
export function loadApprovedHtmlSources(repoRoot: string): ApprovedHtmlSource[] {
  const records = tableToRecords(readRegistryTable(repoRoot));
  return records
    .filter(
      (r) =>
        r.review_status === 'approved' &&
        r.source_type === 'html' &&
        (RAG_MUNICIPALITIES as readonly string[]).includes(r.municipality_code ?? ''),
    )
    .map((r) => ({
      municipalityCode: r.municipality_code!,
      sourceId: r.source_id!,
      category: r.category!,
      title: r.source_title!,
      url: r.source_url!,
      lastVerifiedAt: toDateTime(r.last_verified_at!),
    }));
}

/** canonicalType(=category) → procedureId(対応する手続きがあれば)。 */
function categoryToProcedure(repoRoot: string, municipalityCode: string): Map<string, string> {
  const raw = JSON.parse(
    readFileSync(resolve(repoRoot, `data/normalized/${municipalityCode}/procedures.json`), 'utf-8'),
  ) as { procedures: { id: string; canonicalType: string }[] };
  const map = new Map<string, string>();
  for (const p of raw.procedures) map.set(p.canonicalType, p.id);
  return map;
}

export interface ChunkManifest {
  municipalityCodes: string[];
  generatedAt: string;
  sourceCount: number;
  chunkCount: number;
  chunks: RagChunk[];
}

/**
 * 承認済みHTMLスナップショット → RagChunk[] の完全なマニフェスト(ベクトルは含まない)。
 * OPENAI_API_KEY 無しでもここまでは常に生成できる。
 */
export function buildChunkManifest(repoRoot: string, opts?: ChunkOptions): ChunkManifest {
  const sources = loadApprovedHtmlSources(repoRoot);
  const catToProcByMuni = new Map<string, Map<string, string>>(
    RAG_MUNICIPALITIES.map((code) => [code, categoryToProcedure(repoRoot, code)]),
  );
  const chunks: RagChunk[] = [];

  for (const s of sources) {
    const snapshotPath = resolve(
      repoRoot,
      `data/sources/${s.municipalityCode}/snapshots/${s.sourceId}.html`,
    );
    const html = readFileSync(snapshotPath, 'utf-8');
    const lines = extractTextLines(html);
    const metadata: RagChunkMetadata = {
      municipalityCode: s.municipalityCode,
      category: s.category,
      sourceId: s.sourceId,
      procedureId: catToProcByMuni.get(s.municipalityCode)?.get(s.category),
      title: s.title,
      url: s.url,
      lastVerifiedAt: s.lastVerifiedAt,
    };
    chunks.push(...buildSourceChunks(lines, metadata, opts));
  }

  return {
    municipalityCodes: [...RAG_MUNICIPALITIES],
    generatedAt: new Date().toISOString(),
    sourceCount: sources.length,
    chunkCount: chunks.length,
    chunks,
  };
}

/* ---- SQL / NDJSON シリアライズ ---- */

function str(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}
function nstr(v: string | undefined): string {
  return v === undefined ? 'NULL' : str(v);
}

/**
 * D1 rag_chunks への冪等シードSQL。対象sourceを一度DELETEしてから INSERT(sourceId単位で差し替え)。
 */
export function buildRagChunksSql(chunks: RagChunk[]): string[] {
  const out: string[] = [];
  const sourceIds = [...new Set(chunks.map((c) => c.metadata.sourceId))];
  if (sourceIds.length > 0) {
    out.push(`DELETE FROM rag_chunks WHERE source_id IN (${sourceIds.map(str).join(', ')})`);
  }
  for (const c of chunks) {
    const m = c.metadata;
    out.push(
      `INSERT INTO rag_chunks (chunk_id, municipality_code, source_id, procedure_id, category, ` +
        `title, url, last_verified_at, seq, text) VALUES (` +
        `${str(c.id)}, ${str(m.municipalityCode)}, ${str(m.sourceId)}, ${nstr(m.procedureId)}, ` +
        `${str(m.category)}, ${str(m.title)}, ${str(m.url)}, ${str(m.lastVerifiedAt)}, ${c.seq}, ` +
        `${str(c.text)})`,
    );
  }
  return out;
}

/** 1チャンク + 埋め込み → Vectorize upsert 用の NDJSON 1行。 */
export function toVectorLine(chunk: RagChunk, values: number[]): string {
  const m = chunk.metadata;
  const metadata: Record<string, string> = {
    municipalityCode: m.municipalityCode,
    category: m.category,
    sourceId: m.sourceId,
    title: m.title,
    url: m.url,
    lastVerifiedAt: m.lastVerifiedAt,
  };
  if (m.procedureId) metadata.procedureId = m.procedureId;
  return JSON.stringify({ id: chunk.id, values, metadata });
}
