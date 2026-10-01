import { describe, expect, it } from 'vitest';
import { sourceIdSchema, sourceSchema, sourceSnapshotSchema } from './source.js';

const validSource = {
  sourceId: 'src-13112-resident_registration-001',
  sourceTitle: '転入届 - 世田谷区公式サイト',
  ownerOrganization: '世田谷区',
  municipalityCode: '13112',
  category: 'resident_registration',
  sourceUrl: 'https://www.city.setagaya.lg.jp/example/',
  sourceType: 'html' as const,
  license: 'CC BY 4.0',
  attributionText: '世田谷区公式サイトより',
  fetchMethod: 'scripts/ingest html fetch',
  updateFrequency: 'as-needed',
  reviewStatus: 'approved' as const,
};

describe('sourceSchema (§12.3 registry)', () => {
  it('parses a valid registry entry (normal case)', () => {
    expect(sourceSchema.safeParse(validSource).success).toBe(true);
  });

  it('rejects missing required field sourceUrl', () => {
    const { sourceUrl: _sourceUrl, ...rest } = validSource;
    expect(sourceSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an invalid sourceType enum value', () => {
    expect(sourceSchema.safeParse({ ...validSource, sourceType: 'blog' }).success).toBe(false);
  });

  it("accepts sourceType 'xlsx' (Step5-B: 大田区の収集曜日オープンデータはXLSX配信)", () => {
    expect(sourceSchema.safeParse({ ...validSource, sourceType: 'xlsx' }).success).toBe(true);
  });

  it('rejects an invalid reviewStatus enum value', () => {
    expect(sourceSchema.safeParse({ ...validSource, reviewStatus: 'unofficial' }).success).toBe(
      false,
    );
  });

  it('rejects a non-URL sourceUrl', () => {
    expect(sourceSchema.safeParse({ ...validSource, sourceUrl: 'not-a-url' }).success).toBe(false);
  });

  it('rejects extra unexpected properties (strict)', () => {
    expect(sourceSchema.safeParse({ ...validSource, extraField: 1 }).success).toBe(false);
  });
});

describe('sourceSnapshotSchema', () => {
  it('parses a valid snapshot record', () => {
    const result = sourceSnapshotSchema.safeParse({
      id: 'snap_1',
      sourceId: 'src-13112-resident_registration-001',
      storageKey: 'r2://snapshots/src-13112-resident_registration-001/2026-08-20.html',
      contentHash: 'sha256:abcdef',
      fetchedAt: '2026-08-20T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing contentHash', () => {
    const result = sourceSnapshotSchema.safeParse({
      id: 'snap_1',
      sourceId: 'src-13112-resident_registration-001',
      storageKey: 'r2://x',
      fetchedAt: '2026-08-20T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

/**
 * なぜ: sourceId はファイルパス(data/sources/<code>/snapshots/<id>.<日付>.<ext>)・wrangler の引数・
 * ICS の UID・SQL 文字列にそのまま流れる。台帳の全388件が従う形だけを許し、区切り文字や
 * 先頭の「-」(オプション注入)、パス要素(.. や /)を値の段階で拒否する。
 */
describe('sourceIdSchema', () => {
  it.each([
    'src-13112-resident_registration-001',
    'src-13000-water_supply-002',
    'src-00000-postal_forwarding-001',
    'src-13201-national_health_insurance-001',
  ])('台帳の形式 %s を受け入れる', (id) => {
    expect(sourceIdSchema.safeParse(id).success).toBe(true);
  });

  it.each([
    ['空文字', ''],
    ['パス区切り', 'src-13112-../../etc-001'],
    ['スラッシュ', 'src-13112-a/b-001'],
    ['バックスラッシュ', 'src-13112-a\\b-001'],
    ['先頭のハイフン(オプション注入)', '--remote'],
    ['ドット', 'src-13112-a.b-001'],
    ['改行', 'src-13112-a-001\n'],
    ['NUL', 'src-13112-a-001\u0000'],
    ['引用符', "src-13112-a'b-001"],
    ['大文字', 'src-13112-Resident-001'],
    ['自治体コードが5桁でない', 'src-131-a-001'],
    ['連番が3桁でない', 'src-13112-a-1'],
    ['チャンク接尾辞付き', 'src-13112-a-001#0'],
    ['旧形式', 'source_setagaya_juuminidou'],
    ['長すぎるカテゴリ', `src-13112-${'a'.repeat(49)}-001`],
  ])('%s を拒否する', (_label, id) => {
    expect(sourceIdSchema.safeParse(id).success).toBe(false);
  });

  it('sourceSchema / sourceSnapshotSchema も同じ形式を要求する', () => {
    expect(sourceSchema.safeParse({ ...validSource, sourceId: '../x' }).success).toBe(false);
    expect(
      sourceSnapshotSchema.safeParse({
        id: 'snap_1',
        sourceId: '../x',
        storageKey: 'r2://x',
        contentHash: 'sha256:abcdef',
        fetchedAt: '2026-08-20T00:00:00Z',
      }).success,
    ).toBe(false);
  });
});
