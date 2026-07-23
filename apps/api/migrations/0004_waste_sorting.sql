-- Migration 0004: ごみ分別辞書(waste_sorting_items)を追加する(Wave1-B)。
-- 背景: 世田谷(13112)/江東(13108)/新宿(13104)の「ごみ分別方法」CSVは台帳で承認済み
--   (review_status=approved)かつスナップショット取得済みだが未活用(coverage.csv上
--   waste_sorting=unavailable)。正規化(data/normalized/<code>/waste-sorting.json)
--   → D1 → 検索API(GET /api/waste-sorting)まで通し、承認済みオープンデータの活用範囲を広げる。
--
-- PK: (municipality_code, item_id)。出典CSVのID列(例 131121S00001)は自治体内で一意だが、
--   自治体を跨いだ一意性は保証されないため、他テーブル(facilities/waste_areas)と同様に
--   municipality_code を含む複合PKでスコープを強制する(原則4)。
-- name/reading の部分一致検索(GET /api/waste-sorting?q=)用にインデックスを張る
--   (readingは現状常にNULLだが将来別自治体のCSVがよみ列を持つ場合に備え索引だけ用意する)。

CREATE TABLE waste_sorting_items (
  municipality_code TEXT NOT NULL,
  item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  reading TEXT,
  category TEXT NOT NULL,
  notes TEXT,
  fee_note TEXT,
  source_id TEXT NOT NULL,
  PRIMARY KEY (municipality_code, item_id)
);
CREATE INDEX idx_waste_sorting_items_municipality ON waste_sorting_items (municipality_code);
CREATE INDEX idx_waste_sorting_items_name ON waste_sorting_items (municipality_code, name);
CREATE INDEX idx_waste_sorting_items_reading ON waste_sorting_items (municipality_code, reading);
