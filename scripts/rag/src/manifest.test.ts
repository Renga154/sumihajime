import { beforeAll, describe, it, expect } from 'vitest';
import { hasSourceSnapshots } from '@tmn/test-fixtures/source-snapshots';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RAG_MUNICIPALITIES,
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

/** registry.csv の承認済みHTMLソース数(自治体別)。索引対象=23区+八王子市。 */
const APPROVED_HTML_BY_WARD: Record<string, number> = {
  '13101': 10,
  '13102': 12,
  '13103': 14,
  '13104': 12,
  '13105': 14,
  '13106': 13,
  // 2026-09-29: 横川出張所の閉所の告知ページを出典に追加(品質点検)。
  '13107': 13,
  '13108': 13,
  '13109': 10,
  '13110': 14,
  '13111': 12,
  '13112': 12,
  '13113': 22,
  '13114': 13,
  '13115': 12,
  '13116': 11,
  '13117': 15,
  '13118': 12,
  '13119': 11,
  '13120': 10,
  // 2026-09-25: 花畑区民事務所の施設ページを出典に追加(再監査。仮設事務所への移転)。
  '13121': 17,
  '13122': 13,
  '13123': 17,
  // 2026-09-25: 八王子市を承認(23ソースのうち取扱業務表のPDF1件は索引しないので22)。
  '13201': 22,
};
const APPROVED_HTML_TOTAL = Object.values(APPROVED_HTML_BY_WARD).reduce((a, b) => a + b, 0);

describe('loadApprovedHtmlSources', () => {
  it('承認済み自治体(23区+八王子市)の承認済みHTMLソースを返す(CSV/xlsx/pdf/pending/非自治体コードは除外)', () => {
    const sources = loadApprovedHtmlSources(repoRoot);
    expect(sources).toHaveLength(APPROVED_HTML_TOTAL);
    expect(RAG_MUNICIPALITIES).toHaveLength(24);
    for (const [code, n] of Object.entries(APPROVED_HTML_BY_WARD)) {
      expect(
        sources.filter((s) => s.municipalityCode === code),
        code,
      ).toHaveLength(n);
    }
    for (const s of sources) {
      // なぜ: 非自治体コード(13000 東京都水道局等 / 00000 日本郵便等)を索引しない(ADR-009)。
      expect(s.municipalityCode).toMatch(/^(131(0[1-9]|1\d|2[0-3])|13201)$/);
      expect(s.sourceId).toMatch(new RegExp(`^src-${s.municipalityCode}-`));
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.lastVerifiedAt).toMatch(/T\d{2}:\d{2}:\d{2}/); // datetimeに正規化
    }
    // 主要カテゴリを網羅。
    const cats = new Set(sources.map((s) => s.category));
    expect(cats).toContain('resident_registration');
    expect(cats).toContain('child_benefits');
    expect(cats).toContain('dog_registration');
    expect(cats).toContain('my_number');
    expect(cats).toContain('child_medical');
  });
});

// 原文スナップショット(著作権の都合で公開リポジトリには含めない)が無いときだけ skip する。
// skip しても vitest は収集のため describe の本体を実行するので、構築は beforeAll で行う。
describe.skipIf(!hasSourceSnapshots())('buildChunkManifest', () => {
  let manifest: ReturnType<typeof buildChunkManifest>;
  beforeAll(() => {
    manifest = buildChunkManifest(repoRoot);
  });

  it('全チャンクが対象自治体スコープ内で、id/メタデータが健全', () => {
    expect(manifest.municipalityCodes).toEqual([...RAG_MUNICIPALITIES]);
    expect(manifest.sourceCount).toBe(APPROVED_HTML_TOTAL);
    expect(manifest.chunkCount).toBeGreaterThan(APPROVED_HTML_TOTAL);

    const ids = new Set<string>();
    for (const c of manifest.chunks) {
      expect(RAG_MUNICIPALITIES as readonly string[]).toContain(c.metadata.municipalityCode);
      expect(c.metadata.sourceId.startsWith(`src-${c.metadata.municipalityCode}-`)).toBe(true);
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
  // 原文スナップショット(著作権の都合で公開リポジトリには含めない)が無いときだけ skip する。
  it.skipIf(!hasSourceSnapshots())(
    '先頭で対象sourceを DELETE(冪等)し、各チャンクを INSERT する',
    () => {
      const manifest = buildChunkManifest(repoRoot);
      const sql = buildRagChunksSql(manifest.chunks);
      expect(sql[0]).toMatch(/^DELETE FROM rag_chunks WHERE source_id IN \(/);
      const inserts = sql.filter((s) => s.startsWith('INSERT INTO rag_chunks'));
      expect(inserts).toHaveLength(manifest.chunkCount);
    },
  );

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
  // 原文スナップショット(著作権の都合で公開リポジトリには含めない)が無いときだけ skip する。
  it.skipIf(!hasSourceSnapshots())('id/values/metadata を持つ有効なNDJSON行を作る', () => {
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
    expect(parsed.metadata.municipalityCode).toBe(chunk.metadata.municipalityCode);
    expect(parsed.metadata.sourceId).toBe(chunk.metadata.sourceId);
  });
});
