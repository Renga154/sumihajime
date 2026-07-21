import { describe, it, expect } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RAG_MUNICIPALITY,
  buildChunkManifest,
  buildRagChunksSql,
  loadApprovedHtmlSources,
  toVectorLine,
} from './manifest.js';

/**
 * なぜ: 索引コーパス構築(承認済みHTMLのみ・自治体スコープ・冪等id・メタデータ完全性)を
 * 実スナップショットに対して検証する。実行時クロールはせず data/ のスナップショットのみを読む。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

describe('loadApprovedHtmlSources', () => {
  it('世田谷区の承認済みHTMLソース8件のみを返す(CSV/candidateは除外)', () => {
    const sources = loadApprovedHtmlSources(repoRoot);
    expect(sources).toHaveLength(8);
    for (const s of sources) {
      expect(s.sourceId).toMatch(/^src-13112-/);
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.lastVerifiedAt).toMatch(/T\d{2}:\d{2}:\d{2}/); // datetimeに正規化
    }
    // 8カテゴリを網羅。
    const cats = new Set(sources.map((s) => s.category));
    expect(cats).toContain('resident_registration');
    expect(cats).toContain('child_benefits');
    expect(cats).toContain('dog_registration');
  });
});

describe('buildChunkManifest', () => {
  const manifest = buildChunkManifest(repoRoot);

  it('全チャンクが municipality 13112 スコープで、id/メタデータが健全', () => {
    expect(manifest.municipalityCode).toBe(RAG_MUNICIPALITY);
    expect(manifest.sourceCount).toBe(8);
    expect(manifest.chunkCount).toBeGreaterThan(8);

    const ids = new Set<string>();
    for (const c of manifest.chunks) {
      expect(c.metadata.municipalityCode).toBe('13112');
      expect(c.id).toBe(`${c.metadata.sourceId}#${c.seq}`);
      expect(ids.has(c.id)).toBe(false); // idは一意
      ids.add(c.id);
      expect(c.text.trim().length).toBeGreaterThan(0);
      expect(c.metadata.lastVerifiedAt).toMatch(/T\d{2}:\d{2}:\d{2}/);
    }
  });

  it('カテゴリに対応する procedureId がメタデータに解決される', () => {
    const resident = manifest.chunks.find((c) => c.metadata.category === 'resident_registration');
    expect(resident?.metadata.procedureId).toBe('procedure_resident_registration');
  });
});

describe('buildRagChunksSql', () => {
  it('先頭で対象sourceを DELETE(冪等)し、各チャンクを INSERT する', () => {
    const manifest = buildChunkManifest(repoRoot);
    const sql = buildRagChunksSql(manifest.chunks);
    expect(sql[0]).toMatch(/^DELETE FROM rag_chunks WHERE source_id IN \(/);
    const inserts = sql.filter((s) => s.startsWith('INSERT INTO rag_chunks'));
    expect(inserts).toHaveLength(manifest.chunkCount);
  });

  it("本文中のシングルクォートを '' にエスケープする(SQLインジェクション回避)", () => {
    const chunk = {
      id: 'src-x#0',
      seq: 0,
      text: "It's a test with 'quotes'.",
      metadata: {
        municipalityCode: '13112',
        category: 'resident_registration',
        sourceId: 'src-x',
        title: '転入届',
        url: 'https://example.lg.jp/x',
        lastVerifiedAt: '2026-07-21T00:00:00Z',
      },
    };
    const sql = buildRagChunksSql([chunk]);
    const insert = sql.find((s) => s.startsWith('INSERT INTO rag_chunks'))!;
    expect(insert).toContain("It''s a test with ''quotes''.");
  });
});

describe('toVectorLine', () => {
  it('id/values/metadata を持つ有効なNDJSON行を作る', () => {
    const manifest = buildChunkManifest(repoRoot);
    const chunk = manifest.chunks[0]!;
    const line = toVectorLine(chunk, [0.1, 0.2, 0.3]);
    const parsed = JSON.parse(line) as {
      id: string;
      values: number[];
      metadata: Record<string, string>;
    };
    expect(parsed.id).toBe(chunk.id);
    expect(parsed.values).toEqual([0.1, 0.2, 0.3]);
    expect(parsed.metadata.municipalityCode).toBe('13112');
    expect(parsed.metadata.sourceId).toBe(chunk.metadata.sourceId);
  });
});
