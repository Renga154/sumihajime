/**
 * なぜ: RAGモジュールの共有型。Cloudflareの型に依存せず、必要な最小インターフェイスだけを
 * 自前定義することで、Worker(実バインディング)とテスト(モック)の双方を同じ型で扱う。
 */

/** チャンクのメタデータ(Vectorizeのvector metadata / D1 rag_chunks の列に対応)。 */
export interface RagChunkMetadata {
  municipalityCode: string;
  category: string;
  sourceId: string;
  /** 対応する手続きがある場合のみ。 */
  procedureId?: string;
  title: string;
  url: string;
  /** ISO datetime。 */
  lastVerifiedAt: string;
}

/** 索引投入・D1保存の単位。id は Vectorize のベクトルidと一致(= "<sourceId>#<seq>")。 */
export interface RagChunk {
  id: string;
  seq: number;
  text: string;
  metadata: RagChunkMetadata;
}

/** Vectorize query の1マッチ(必要な部分のみ)。 */
export interface VectorizeMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface VectorizeQueryResult {
  matches: VectorizeMatch[];
}

export interface VectorizeQueryOptions {
  topK: number;
  filter?: Record<string, unknown>;
  returnMetadata?: 'none' | 'indexed' | 'all';
  returnValues?: boolean;
}

/**
 * なぜ: Worker の Vectorize バインディングが公開する query の最小形。実バインディングは
 * これを満たし、テストは同形のモックを注入できる(型名の版差に依存しない)。
 */
export interface VectorizeQueryable {
  query(vector: number[], options: VectorizeQueryOptions): Promise<VectorizeQueryResult>;
}

export type Confidence = 'high' | 'medium' | 'low' | 'unknown';
