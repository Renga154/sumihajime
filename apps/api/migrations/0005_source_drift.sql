-- Migration 0005: 公式ソースの定期巡回(ADR-014)。
--
-- 1) sources.snapshot_page_updated_on
--    承認時スナップショットから抽出器(@tmn/drift extractPageUpdatedOn)で機械的に得た
--    ページ自身の「更新日」(YYYY-MM-DD)。巡回はこの値と現在のページの更新日を比べる。
--    人手記入の source_last_modified_at を基準にしないのは、248件中17件が本文表記と
--    食い違っており初回から誤検知するため(ADR-014 §1)。publish が seed で埋める。
--    csv/xlsx と更新日表記の無い HTML は NULL。
--
-- 2) source_drift
--    ソースごとに1行の「巡回の記憶」。publish の DELETE→INSERT 対象(scripts/publish/src/sql.ts
--    の TABLES)には**含めない**。再publish のたびに消えると、検知した changed/unreachable が
--    黙ってリセットされて「要確認」が解除されてしまうため、公開データとは独立に残す。
--
--    検知が効力を持つかどうかは、行を消して決めるのではなく、検知時に控えた
--    verified_at_seen(= その時点の sources.last_verified_at)と、いまの sources.last_verified_at
--    の比較で決める(読み出し側 db.ts getActiveDriftMarks)。人が再監査して台帳の
--    last_verified_at を進め、再publish すれば sources 側がそれより新しくなり、マークは
--    自動で効力を失う(復帰は人手のみ・機械は消さない=ADR-014 §2)。
--
--    列: status(ok/changed/unreachable/unverifiable/transient) / reason(機械可読コード) /
--        detected_at(changed・unreachable へ遷移した時刻。ok に戻れば NULL) /
--        verified_at_seen(検知時の sources.last_verified_at) / last_checked_at(最終巡回) /
--        consecutive_failures(unreachable は2回連続で確定) /
--        baseline_last_modified(更新日表記の無い HTML の初回巡回で控える Last-Modified) /
--        current_page_updated_on・http_status・final_url(観測値。調査用)。

ALTER TABLE sources ADD COLUMN snapshot_page_updated_on TEXT;

CREATE TABLE source_drift (
  source_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('ok', 'changed', 'unreachable', 'unverifiable', 'transient')),
  reason TEXT NOT NULL,
  detected_at TEXT,
  verified_at_seen TEXT,
  last_checked_at TEXT NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  baseline_last_modified TEXT,
  current_page_updated_on TEXT,
  http_status INTEGER,
  final_url TEXT
);
CREATE INDEX idx_source_drift_last_checked ON source_drift (last_checked_at);
