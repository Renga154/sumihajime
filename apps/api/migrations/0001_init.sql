-- Migration 0001: initial D1 schema for 東京転入ToDo (T-006).
-- 対応: IMPLEMENTATION_PLAN §8.1 D1テーブル。RAG系(rag_chunks)はT-013へ持ち越し。
-- 列名はスキーマ(@tmn/schemas)のフィールドに1:1で対応する。JSON列はTEXTにJSON文字列で保持。
-- ユーザーデータ(プロフィール/完了状態/チャット)はサーバー保存しない方針のため対応テーブルを作らない(§8.1)。

-- 対応自治体マスタ。supportedは0/1(SQLiteにbooleanなし)。official_urlはFR-021の公式導線。
CREATE TABLE municipalities (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  supported INTEGER NOT NULL CHECK (supported IN (0, 1)),
  note TEXT,
  official_url TEXT
);

-- 自治体×カテゴリの対応状況(FR-024)。
CREATE TABLE coverage (
  municipality_code TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('verified', 'partial', 'unavailable')),
  last_verified_at TEXT NOT NULL,
  PRIMARY KEY (municipality_code, category)
);
CREATE INDEX idx_coverage_municipality ON coverage (municipality_code);

-- データソース台帳(registry.csvと同期)。公開ゲートの真実= review_status。
CREATE TABLE sources (
  source_id TEXT PRIMARY KEY,
  source_title TEXT NOT NULL,
  owner_organization TEXT NOT NULL,
  municipality_code TEXT,
  category TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL,
  license TEXT NOT NULL,
  attribution_text TEXT NOT NULL,
  fetch_method TEXT NOT NULL,
  update_frequency TEXT NOT NULL,
  last_fetched_at TEXT,
  last_verified_at TEXT,
  source_last_modified_at TEXT,
  content_hash TEXT,
  review_status TEXT NOT NULL CHECK (review_status IN ('candidate', 'pending', 'approved', 'rejected', 'stale')),
  reviewer TEXT,
  effective_from TEXT,
  effective_to TEXT,
  notes TEXT
);
CREATE INDEX idx_sources_municipality ON sources (municipality_code);

-- 手続きの正準行(現行バージョンのポインタ)。
CREATE TABLE procedures (
  procedure_id TEXT PRIMARY KEY,
  municipality_code TEXT NOT NULL,
  canonical_type TEXT NOT NULL,
  current_version TEXT NOT NULL
);
CREATE INDEX idx_procedures_municipality ON procedures (municipality_code);

-- 手続きバージョン(REQUIREMENTS §10 全フィールド)。JSON列はTEXTにJSON文字列。
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
  PRIMARY KEY (procedure_id, version)
);
CREATE INDEX idx_procedure_versions_municipality ON procedure_versions (municipality_code);

-- ルールセット(ADR-002)。1自治体1行、rulesはJSON配列文字列。
CREATE TABLE rule_sets (
  municipality_code TEXT PRIMARY KEY,
  rule_version TEXT NOT NULL,
  rules TEXT NOT NULL
);

-- 窓口施設(ADR-005: 距離計算なし、lat/lngはnullable)。facility_idはpublish時に採番した一意キー。
CREATE TABLE facilities (
  facility_id TEXT PRIMARY KEY,
  municipality_code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL,
  lng REAL,
  hours TEXT,
  source_id TEXT NOT NULL
);
CREATE INDEX idx_facilities_municipality ON facilities (municipality_code);

-- ごみ収集地区(町丁目選択式の選択肢マスタ)。
CREATE TABLE waste_areas (
  area_id TEXT PRIMARY KEY,
  municipality_code TEXT NOT NULL,
  area_label TEXT NOT NULL
);
CREATE INDEX idx_waste_areas_municipality ON waste_areas (municipality_code);

-- ごみ収集曜日(C-9: 例外日は展開せず。effective_from/toで年度有効期間を必須管理)。
-- municipality_codeはスコープ強制フィルタ用に非正規化して保持。
CREATE TABLE waste_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id TEXT NOT NULL,
  municipality_code TEXT NOT NULL,
  waste_type TEXT NOT NULL,
  weekday TEXT NOT NULL,
  week_of_month TEXT,
  source_id TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT
);
CREATE INDEX idx_waste_schedules_area ON waste_schedules (area_id);
CREATE INDEX idx_waste_schedules_municipality ON waste_schedules (municipality_code);

-- ごみデータセットの自治体単位メタ(C-9 の注意書き caution を応答に必ず含めるため)。
CREATE TABLE waste_datasets (
  municipality_code TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  caution TEXT NOT NULL,
  granularity_note TEXT,
  effective_from TEXT,
  effective_to TEXT
);
