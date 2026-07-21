-- Migration 0002: rag_chunks — RAGチャンク本文の保存先 (T-013).
-- 対応: IMPLEMENTATION_PLAN §8.1 rag_chunks / ADR-004。
-- ベクトルはVectorize側に持ち、D1は「回答生成時に引用チャンクの本文を突き合わせる」ための原文を保持する。
-- chunk_id は Vectorize のベクトルidと一致させる(= "<source_id>#<連番>")。冪等な再構築のため source_id 単位で差し替える。
-- municipality_code はスコープ健全性のため非正規化して保持し、検索結果の二重チェックに使う。
CREATE TABLE rag_chunks (
  chunk_id TEXT PRIMARY KEY,
  municipality_code TEXT NOT NULL,
  source_id TEXT NOT NULL,
  procedure_id TEXT,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  seq INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX idx_rag_chunks_municipality ON rag_chunks (municipality_code);
CREATE INDEX idx_rag_chunks_source ON rag_chunks (source_id);
