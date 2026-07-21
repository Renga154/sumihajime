-- Migration 0003: procedures / procedure_versions を複合キー化して越境上書きを防ぐ (T-015 付帯不具合).
-- 背景: 世田谷(13112)と江東(13108)は同一の procedure_id 体系(procedure_resident_registration 等)を
--   共有する。0001 の procedures.procedure_id / procedure_versions.(procedure_id, version) は
--   municipality_code を含まない単独/部分PKのため、両自治体をシードすると片方が他方を
--   上書き(または PK 衝突)し、自治体間でデータが混線する重大バグとなる。
--   → PRIMARY KEY に municipality_code を含める(自治体スコープをキー自体で強制する)。
--
-- 手法: SQLite は ALTER TABLE で PRIMARY KEY を変更できないため DROP → CREATE で作り直す。
--   列定義・型・NOT NULL・インデックスは 0001 の定義をそのまま踏襲し、PK のみ拡張する。
--   注意: これらのテーブルの全データは publish(load→gate→seed)で毎回 DELETE→INSERT により
--   再シードされるため、ここで破棄してよい(ユーザーデータは保持しない方針。§8.1)。
--
-- 触らないテーブル(確認済み):
--   - rule_sets: PK=municipality_code(1自治体1行)。自治体間衝突は起きないため変更不要。
--   - facilities / waste_areas / waste_schedules / waste_datasets / sources:
--       ID に自治体接頭辞が入る(例 13112-fac-001, area-13112-001)か自治体単位で一意なため衝突しない。
--   - coverage: PK=(municipality_code, category) で既に複合キー。
--   - rag_chunks(0002, RAG): 対象外(触れない)。

-- 手続きの正準行(現行バージョンのポインタ)。PKに municipality_code を含める。
DROP TABLE IF EXISTS procedures;
CREATE TABLE procedures (
  procedure_id TEXT NOT NULL,
  municipality_code TEXT NOT NULL,
  canonical_type TEXT NOT NULL,
  current_version TEXT NOT NULL,
  PRIMARY KEY (municipality_code, procedure_id)
);
CREATE INDEX idx_procedures_municipality ON procedures (municipality_code);

-- 手続きバージョン(REQUIREMENTS §10 全フィールド)。JSON列はTEXTにJSON文字列。
-- PKに municipality_code を含め (municipality_code, procedure_id, version) とする。
DROP TABLE IF EXISTS procedure_versions;
CREATE TABLE procedure_versions (
  procedure_id TEXT NOT NULL,
  version TEXT NOT NULL,
  municipality_code TEXT NOT NULL,
  canonical_type TEXT NOT NULL,
  title TEXT NOT NULL,
  short_description TEXT NOT NULL,
  applicability_reason TEXT NOT NULL,
  priority TEXT NOT NULL,
  due_date TEXT,
  due_description TEXT,
  required_documents TEXT NOT NULL,
  channels TEXT NOT NULL,
  locations TEXT,
  online_url TEXT,
  contact TEXT,
  source_ids TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  data_status TEXT NOT NULL,
  cautions TEXT,
  PRIMARY KEY (municipality_code, procedure_id, version)
);
CREATE INDEX idx_procedure_versions_municipality ON procedure_versions (municipality_code);
