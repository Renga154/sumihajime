import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSources } from './load.js';
import { buildSeedStatements } from './sql.js';
import { loadPublishData } from './load.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * なぜ: ADR-014 の巡回は「承認時スナップショットから同じ抽出器で得た更新日」を基準にする。
 * publish がその基準値を台帳の行に載せること(あるもの・無いものの両方)を実データで固定する。
 */
describe('loadSources — snapshotPageUpdatedOn(ADR-014 の比較基準)', () => {
  const sources = loadSources(repoRoot);
  const byId = new Map(sources.map((s) => [s.sourceId, s]));

  it('渋谷区(ラベルと日付の間にタグが挟まる形式)の更新日を抽出する', () => {
    // 2026-09-25 の再監査で版付きスナップショット(更新日 2026-09-17)が現行版になった。
    // 形式(ラベルと日付の間にタグ)は承認時と同じで、現行版から抽出できることを確かめる。
    expect(byId.get('src-13113-resident_registration-001')?.snapshotPageUpdatedOn).toBe(
      '2026-09-17',
    );
  });

  it('更新日表記の無いページ(中央区)は undefined(推測で埋めない)', () => {
    const s = byId.get('src-13102-resident_registration-001');
    expect(s).toBeDefined();
    expect(s?.snapshotPageUpdatedOn).toBeUndefined();
  });

  it('csv/xlsx ソースには付けない(生ハッシュで比較する種別)', () => {
    for (const s of sources) {
      if (s.sourceType === 'csv' || s.sourceType === 'xlsx') {
        expect(s.snapshotPageUpdatedOn, s.sourceId).toBeUndefined();
      }
    }
  });

  it('承認済み HTML ソースの大半(250件以上)で更新日が得られる', () => {
    const approvedHtml = sources.filter(
      (s) => s.reviewStatus === 'approved' && s.sourceType === 'html',
    );
    const withDate = approvedHtml.filter((s) => s.snapshotPageUpdatedOn !== undefined);
    expect(withDate.length).toBeGreaterThanOrEqual(250);
  });

  it('seed SQL の sources INSERT に snapshot_page_updated_on 列が含まれる', () => {
    const data = loadPublishData(repoRoot);
    const insert = buildSeedStatements(data).find((s) => s.startsWith('INSERT INTO sources ('));
    expect(insert).toContain('snapshot_page_updated_on');
  });
});
